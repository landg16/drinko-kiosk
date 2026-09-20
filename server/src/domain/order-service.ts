import { randomUUID } from 'node:crypto';
import type { DrinkoConfig } from '../config/schema';
import type { OrderRepository } from '../db/order-repository';
import type { SettingsRepository } from '../db/settings-repository';
import type { EventBus } from '../events/bus';
import type { DeviceController } from '../hardware/device-controller';
import type { PourOutcome } from '../hardware/driver';
import { DeviceUnavailableError } from '../hardware/errors';
import type { Logger } from '../logger';
import type { PaymentAdapter } from '../payment/adapter';
import { buildMenu } from './catalog';
import { planPour, type PlannerSettings } from './pour-planner';
import type { Menu, Order, OrderItem, OrderItemInput, Pour } from './types';

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface OrderServiceDeps {
  config: DrinkoConfig;
  settings: SettingsRepository;
  orders: OrderRepository;
  device: DeviceController;
  payment: PaymentAdapter;
  bus: EventBus;
  logger?: Logger;
  /** injectable clock for tests */
  now?: () => Date;
  newId?: () => string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Order state machine (PLAN.md §4.3): one order at a time; payment and pours run in the background, followed over SSE. */
export class OrderService {
  private background: Promise<void> = Promise.resolve();

  constructor(private readonly deps: OrderServiceDeps) {}

  getMenu(): Menu {
    return buildMenu(this.deps.config, this.deps.device.getStatus(), this.deps.settings.get());
  }

  getOrder(id: string): Order {
    const order = this.deps.orders.get(id);
    if (!order) throw new ServiceError('order_not_found', 404, `order ${id} not found`);
    return order;
  }

  getActiveOrder(): Order | null {
    return this.deps.orders.findActive() ?? null;
  }

  createOrder(input: OrderItemInput[]): Order {
    this.requireDeviceReady();
    const active = this.deps.orders.findActive();
    if (active) throw new ServiceError('order_in_progress', 409, `order #${active.number} is still in progress`);
    if (input.length === 0) throw new ServiceError('empty_order', 422, 'an order needs at least one drink');

    const { config } = this.deps;
    const menu = this.getMenu();
    const planner = this.plannerSettings();
    const items: OrderItem[] = [];
    const pours: Pour[] = [];
    let total = 0;

    for (const line of input) {
      const drink = config.drinks.find((candidate) => candidate.id === line.drinkId);
      const menuDrink = menu.drinks.find((candidate) => candidate.id === line.drinkId);
      if (!drink || !menuDrink) throw new ServiceError('unknown_drink', 422, `unknown drink "${line.drinkId}"`);
      const size = drink.sizes[line.size];
      const menuSize = menuDrink.sizes[line.size];
      if (!size || !menuSize) {
        throw new ServiceError('unknown_size', 422, `${drink.name.en} has no "${line.size}" size`);
      }
      if (!menuSize.available) {
        throw new ServiceError('drink_unavailable', 422, `${drink.name.en} is not available right now`);
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new ServiceError('invalid_quantity', 422, 'quantity must be a positive integer');
      }

      const lineTotal = round2(size.price * line.quantity);
      total += lineTotal;
      items.push({ drinkId: drink.id, size: line.size, quantity: line.quantity, name: drink.name, unitPrice: size.price, lineTotal });

      const plan = planPour(size.recipe, config, planner);
      for (let count = 0; count < line.quantity; count++) {
        pours.push({
          index: pours.length,
          drinkId: drink.id,
          name: drink.name,
          size: line.size,
          cup: drink.cup,
          grams: [...plan.grams],
          expectedMs: plan.expectedMs,
          status: 'pending',
          failure: null,
          startedAt: null,
          finishedAt: null,
        });
      }
    }

    if (pours.length > config.order.maxPoursPerOrder) {
      throw new ServiceError('too_many_drinks', 422, `at most ${config.order.maxPoursPerOrder} drinks per order`);
    }

    const now = this.now();
    const order: Order = {
      id: (this.deps.newId ?? randomUUID)(),
      number: this.deps.orders.nextNumber(now),
      status: 'created',
      items,
      pours,
      currentPour: null,
      total: round2(total),
      currency: config.currency,
      paymentReference: null,
      failure: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      paidAt: null,
    };
    this.persist(order);
    this.deps.logger?.info({ orderId: order.id, number: order.number, total: order.total }, 'order created');
    return order;
  }

  /** Starts payment; the result arrives as an order.updated event. */
  pay(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== 'created') {
      throw new ServiceError('invalid_state', 409, `cannot pay an order that is ${order.status}`);
    }
    this.requireDeviceReady();
    order.status = 'paying';
    order.failure = null;
    this.persist(order);

    this.runInBackground(async () => {
      const result = await this.deps.payment.charge({ orderId: order.id, amount: order.total, currency: order.currency });
      const current = this.deps.orders.get(order.id);
      if (!current || current.status !== 'paying') return;
      if (result.ok) {
        current.status = 'awaiting_cup';
        current.currentPour = 0;
        current.paidAt = this.now().toISOString();
        current.paymentReference = result.reference;
        this.deps.logger?.info({ orderId: current.id, reference: result.reference }, 'order paid');
      } else {
        current.status = 'created';
        current.failure = `payment failed: ${result.reason}`;
        this.deps.logger?.warn({ orderId: current.id, reason: result.reason }, 'payment declined');
      }
      this.persist(current);
    });
    return order;
  }

  /** The guest confirmed the cup is under the nozzle: pour the current item. */
  pour(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== 'awaiting_cup' || order.currentPour === null) {
      throw new ServiceError('invalid_state', 409, `order is ${order.status}, not waiting for a cup`);
    }
    this.requireDeviceReady();
    const pour = order.pours[order.currentPour];
    order.status = 'pouring';
    pour.status = 'pouring';
    pour.startedAt = this.now().toISOString();
    this.persist(order);
    this.deps.bus.emit('pour.started', { orderId: order.id, pourIndex: pour.index, expectedMs: pour.expectedMs });

    this.runInBackground(async () => {
      let outcome: PourOutcome;
      try {
        outcome = await this.deps.device.pour(pour.grams, { expectedMs: pour.expectedMs });
      } catch (error) {
        outcome = {
          ok: false,
          failure: error instanceof DeviceUnavailableError ? 'device_offline' : 'hardware',
          detail: (error as Error).message,
          channels: [],
        };
      }

      const current = this.deps.orders.get(order.id);
      if (!current) return;
      const finished = current.pours[pour.index];
      finished.finishedAt = this.now().toISOString();

      if (outcome.ok) {
        finished.status = 'done';
        const next = current.pours.find((candidate) => candidate.status === 'pending');
        if (next) {
          current.currentPour = next.index;
          current.status = 'awaiting_cup';
        } else {
          current.currentPour = null;
          current.status = 'completed';
        }
        this.persist(current);
        this.deps.bus.emit('pour.done', { orderId: current.id, pourIndex: pour.index });
        return;
      }

      finished.status = 'failed';
      finished.failure = outcome.failure;
      for (const candidate of current.pours) {
        if (candidate.status === 'pending') candidate.status = 'skipped';
      }
      current.status = 'failed';
      current.currentPour = null;
      current.failure = `${outcome.failure}: ${outcome.detail}`;
      this.persist(current);
      this.deps.logger?.error({ orderId: current.id, number: current.number, failure: current.failure }, 'pour failed');
      this.deps.bus.emit('pour.failed', { orderId: current.id, pourIndex: pour.index, failure: outcome.failure });
    });
    return order;
  }

  cancel(id: string): Order {
    const order = this.getOrder(id);
    if (order.status !== 'created') {
      throw new ServiceError('invalid_state', 409, `cannot cancel an order that is ${order.status}`);
    }
    order.status = 'cancelled';
    this.persist(order);
    return order;
  }

  /** Expires orders the guest walked away from, so the kiosk frees itself. Returns how many. */
  sweep(): number {
    const now = this.now().getTime();
    const { unpaidTtlMs, awaitingCupTtlMs } = this.deps.config.order;
    let count = 0;
    for (const order of this.deps.orders.findStale(['created'], new Date(now - unpaidTtlMs).toISOString())) {
      order.status = 'cancelled';
      order.failure = 'expired before payment';
      this.persist(order);
      count++;
    }
    for (const order of this.deps.orders.findStale(['awaiting_cup'], new Date(now - awaitingCupTtlMs).toISOString())) {
      order.status = 'abandoned';
      order.currentPour = null;
      order.failure = 'guest did not place a cup in time';
      for (const pour of order.pours) {
        if (pour.status === 'pending') pour.status = 'skipped';
      }
      this.persist(order);
      this.deps.logger?.warn({ orderId: order.id, number: order.number }, 'paid order abandoned');
      count++;
    }
    return count;
  }

  /** Resolves once queued background work (payment, pours) has finished. */
  async idle(): Promise<void> {
    await this.background;
  }

  private plannerSettings(): PlannerSettings {
    const settings = this.deps.settings.get();
    return {
      calibration: settings.calibration,
      flowRateGps: settings.flowRateGps,
      overheadMs: this.deps.config.device.pourOverheadMs,
    };
  }

  private runInBackground(task: () => Promise<void>): void {
    this.background = this.background
      .then(task)
      .catch((error: Error) => this.deps.logger?.error({ err: error }, 'background task failed'));
  }

  private persist(order: Order): void {
    order.updatedAt = this.now().toISOString();
    this.deps.orders.save(order);
    this.deps.bus.emit('order.updated', structuredClone(order));
  }

  private requireDeviceReady(): void {
    const status = this.deps.device.getStatus();
    if (!status.connected) throw new ServiceError('device_offline', 503, 'the machine is offline');
    if (status.state === 'error') {
      throw new ServiceError('device_error', 503, `the machine needs attention: ${status.lastError}`);
    }
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
