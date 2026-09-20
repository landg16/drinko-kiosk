import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load';
import { openDatabase } from '../db/database';
import { OrderRepository } from '../db/order-repository';
import { SettingsRepository, defaultSettings } from '../db/settings-repository';
import { EventBus } from '../events/bus';
import { DeviceController } from '../hardware/device-controller';
import { DrinkoJsonDriver } from '../hardware/drinko-json/driver';
import { MockTransport, type MockTransportOptions } from '../hardware/drinko-json/mock-transport';
import { MockPaymentAdapter, type MockPaymentOptions } from '../payment/mock-payment';
import { OrderService, ServiceError } from './order-service';

const configPath = join(__dirname, '..', '..', 'config', 'drinko.json');
const cleanups: (() => Promise<void>)[] = [];

async function setup(options: { payment?: MockPaymentOptions; mock?: MockTransportOptions } = {}) {
  const config = loadConfig(configPath);
  const db = openDatabase(':memory:');
  const settings = new SettingsRepository(db, defaultSettings(config));
  const orders = new OrderRepository(db);
  const mock = new MockTransport({ timeScale: 0, ...options.mock });
  const device = new DeviceController(new DrinkoJsonDriver(mock, { pollMs: 5, busyRetryMs: 5 }), {
    ...config.device,
    reconnectMs: 20,
  });
  const bus = new EventBus();
  device.on('status', (status) => bus.emit('device.status', status));
  let clock = Date.parse('2026-09-21T18:00:00.000Z');
  const service = new OrderService({
    config,
    settings,
    orders,
    device,
    payment: new MockPaymentAdapter({ delayMs: 0, ...options.payment }),
    bus,
    now: () => new Date(clock),
  });
  await device.start();
  cleanups.push(async () => {
    await device.stop();
    db.close();
  });
  return { config, settings, orders, mock, device, bus, service, advance: (ms: number) => (clock += ms) };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('OrderService', () => {
  it('lists every drink as available when all tanks are ok', async () => {
    const { service } = await setup();
    const menu = service.getMenu();
    expect(menu.drinks).toHaveLength(8);
    expect(menu.drinks.every((drink) => drink.available)).toBe(true);
    expect(menu.currency).toBe('GEL');
  });

  it('runs an order from creation through payment and two pours to completion', async () => {
    const { service, bus, mock } = await setup();
    const events: string[] = [];
    bus.on('pour.started', () => events.push('pour.started'));
    bus.on('pour.done', () => events.push('pour.done'));
    bus.on('order.updated', (order) => events.push(`order:${order.status}`));

    const created = service.createOrder([
      { drinkId: 'gin-tonic', size: 'single', quantity: 1 },
      { drinkId: 'vodka-shot', size: 'single', quantity: 1 },
    ]);
    expect(created.status).toBe('created');
    expect(created.number).toBe(1);
    expect(created.total).toBe(20);
    expect(created.pours).toHaveLength(2);
    expect(created.pours[0].grams).toEqual([0, 38, 165, 0]);
    expect(created.pours[1].cup).toBe('small');

    expect(service.pay(created.id).status).toBe('paying');
    await service.idle();
    let order = service.getOrder(created.id);
    expect(order.status).toBe('awaiting_cup');
    expect(order.currentPour).toBe(0);
    expect(order.paidAt).not.toBeNull();
    expect(order.paymentReference).toMatch(/^mock-/);

    expect(service.pour(order.id).status).toBe('pouring');
    await service.idle();
    order = service.getOrder(created.id);
    expect(order.status).toBe('awaiting_cup');
    expect(order.currentPour).toBe(1);
    expect(order.pours[0].status).toBe('done');

    service.pour(order.id);
    await service.idle();
    order = service.getOrder(created.id);
    expect(order.status).toBe('completed');
    expect(order.currentPour).toBeNull();
    expect(order.pours.map((pour) => pour.status)).toEqual(['done', 'done']);
    expect(service.getActiveOrder()).toBeNull();

    expect(mock.state.tankGrams).toEqual([1952, 1962, 1835, 2000]);
    expect(events.filter((event) => event === 'pour.started')).toHaveLength(2);
    expect(events.filter((event) => event === 'pour.done')).toHaveLength(2);
    expect(events).toContain('order:completed');
  });

  it('returns a declined order to created so the guest can retry', async () => {
    const { service } = await setup({ payment: { outcome: 'decline' } });
    const order = service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }]);
    service.pay(order.id);
    await service.idle();
    const current = service.getOrder(order.id);
    expect(current.status).toBe('created');
    expect(current.failure).toMatch(/declined/);
  });

  it('allows only one active order at a time', async () => {
    const { service } = await setup();
    const first = service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }]);
    expect(() => service.createOrder([{ drinkId: 'energy', size: 'single', quantity: 1 }])).toThrow(
      expect.objectContaining({ code: 'order_in_progress' }),
    );
    service.cancel(first.id);
    expect(service.createOrder([{ drinkId: 'energy', size: 'single', quantity: 1 }]).status).toBe('created');
  });

  it('hides drinks whose ingredient tank is low and refuses to sell them', async () => {
    const { service, device, mock } = await setup();
    mock.state.tankGrams[1] = 100; // gin below the low threshold
    await device.checkTank();
    const menu = service.getMenu();
    expect(menu.drinks.find((drink) => drink.id === 'gin-tonic')?.available).toBe(false);
    expect(menu.drinks.find((drink) => drink.id === 'vodka-tonic')?.available).toBe(true);
    expect(() => service.createOrder([{ drinkId: 'gin-tonic', size: 'single', quantity: 1 }])).toThrow(
      expect.objectContaining({ code: 'drink_unavailable' }),
    );
  });

  it('fails the order and skips the rest when a pour fails', async () => {
    const { service, device, mock, bus } = await setup();
    const failures: string[] = [];
    bus.on('pour.failed', (event) => failures.push(event.failure));

    const order = service.createOrder([{ drinkId: 'vodka-tonic', size: 'single', quantity: 2 }]);
    service.pay(order.id);
    await service.idle();
    mock.state.faults[0] = 'flowmeter';
    service.pour(order.id);
    await service.idle();

    const current = service.getOrder(order.id);
    expect(current.status).toBe('failed');
    expect(current.pours.map((pour) => pour.status)).toEqual(['failed', 'skipped']);
    expect(current.pours[0].failure).toBe('flowmeter');
    expect(failures).toEqual(['flowmeter']);
    expect(device.getStatus().state).toBe('error');
    expect(() => service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }])).toThrow(
      expect.objectContaining({ code: 'device_error' }),
    );
  });

  it('caps an order at maxPoursPerOrder', async () => {
    const { service } = await setup();
    expect(() => service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 5 }])).toThrow(
      expect.objectContaining({ code: 'too_many_drinks' }),
    );
  });

  it('rejects state transitions that do not apply', async () => {
    const { service } = await setup();
    const order = service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }]);
    expect(() => service.pour(order.id)).toThrow(ServiceError);
    expect(() => service.getOrder('nope')).toThrow(expect.objectContaining({ httpStatus: 404 }));
  });

  it('sweeps unpaid orders and abandons paid ones nobody claimed', async () => {
    const { service, config, advance } = await setup();
    const unpaid = service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }]);
    advance(config.order.unpaidTtlMs + 1);
    expect(service.sweep()).toBe(1);
    expect(service.getOrder(unpaid.id).status).toBe('cancelled');

    const paid = service.createOrder([{ drinkId: 'tonic', size: 'single', quantity: 1 }]);
    service.pay(paid.id);
    await service.idle();
    expect(service.getOrder(paid.id).status).toBe('awaiting_cup');
    advance(config.order.awaitingCupTtlMs + 1);
    expect(service.sweep()).toBe(1);
    const abandoned = service.getOrder(paid.id);
    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.pours[0].status).toBe('skipped');
    expect(service.getActiveOrder()).toBeNull();
  });
});
