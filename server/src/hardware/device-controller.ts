import { EventEmitter } from 'node:events';
import type { DeviceErrorKind, DeviceState, DeviceStatus, TankStatus } from '../domain/types';
import type { Logger } from '../logger';
import type { DeviceDriver, PourOutcome } from './driver';
import {
  DeviceBusyError,
  DeviceDisconnectedError,
  DeviceProtocolError,
  DeviceTimeoutError,
  DeviceUnavailableError,
} from './errors';

export interface DeviceControllerOptions {
  /** pour timeout = expectedMs × multiplier + extra */
  pourTimeoutMultiplier: number;
  pourTimeoutExtraMs: number;
  tankPollMs: number;
  reconnectMs: number;
  /** A pour ending before expectedMs × ratio with no result from the board counts as "nothing flowed"; 0 disables. Default 0.25. */
  suspiciousPourRatio?: number;
  /** poll interval while the board is unresponsive, so recovery is noticed quickly. Default 5 s. */
  errorPollMs?: number;
  /** consecutive failed polls before the link is closed and reopened. Default 3. */
  pollFailuresBeforeReconnect?: number;
  logger?: Logger;
}

type ControllerEvents = { status: [status: DeviceStatus]; cup: [present: boolean] };

interface DeviceError {
  kind: DeviceErrorKind;
  message: string;
}

const unknownTanks = (count: number): TankStatus[] => Array.from({ length: count }, () => 'unknown' as const);

/** Board-agnostic device management over a DeviceDriver: one command at a time, reconnects, tank polling,
 *  timeouts and the error state. The failure rules are listed in README "Error handling". */
export class DeviceController extends EventEmitter<ControllerEvents> {
  private running = false;
  private error: DeviceError | null = null;
  private lastError: string | null = null;
  private tanks: TankStatus[];
  private lastTankCheckAt: string | null = null;
  private pollFailures = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private stopped = true;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly logger?: Logger;

  constructor(
    private readonly driver: DeviceDriver,
    private readonly options: DeviceControllerOptions,
  ) {
    super();
    this.logger = options.logger;
    this.tanks = unknownTanks(driver.capabilities.channelCount);
    driver.on('disconnected', (reason) => this.onDisconnected(reason));
    driver.on('cup', (present) => this.emit('cup', present));
    driver.on('fault', (detail) => {
      this.logger?.error({ detail }, 'board reported a fault');
      this.markError('fault', `board reported a fault: ${detail}`);
    });
  }

  get channelCount(): number {
    return this.driver.capabilities.channelCount;
  }

  getStatus(): DeviceStatus {
    return {
      driver: this.driver.name,
      capabilities: { ...this.driver.capabilities },
      connected: this.driver.connected,
      state: this.computeState(),
      errorKind: this.error?.kind ?? null,
      tanks: [...this.tanks],
      lastError: this.lastError,
      lastTankCheckAt: this.lastTankCheckAt,
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.tryConnect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    await this.driver.disconnect().catch(() => undefined);
    this.emitStatus();
  }

  /** Emergency stop. Bypasses the queue, so it works while a pour is running. */
  async stopNow(): Promise<void> {
    if (!this.driver.connected) throw new DeviceUnavailableError('device is not connected');
    await this.driver.stop();
    this.logger?.warn('emergency stop sent');
  }

  checkTank(): Promise<TankStatus[]> {
    return this.enqueue('checkTank', async () => {
      const tanks = await this.driver.checkTanks();
      this.tanks = Array.from({ length: this.channelCount }, (_, index) => tanks[index] ?? 'unknown');
      this.lastTankCheckAt = new Date().toISOString();
      this.pollFailures = 0;
      if (this.error?.kind === 'unresponsive') {
        this.logger?.info('board is answering again');
        this.error = null;
      }
      return [...this.tanks];
    });
  }

  /** Staff confirmed the machine was fixed: drop the fault and check the board is answering. */
  async clearFault(): Promise<TankStatus[]> {
    if (this.error?.kind === 'fault') {
      this.logger?.warn({ fault: this.error.message }, 'fault cleared by staff');
      this.error = null;
      this.emitStatus();
    }
    return this.checkTank();
  }

  pour(grams: number[], options: { expectedMs: number; withCup?: boolean }): Promise<PourOutcome> {
    return this.enqueue('pour', async () => {
      if (grams.length !== this.channelCount) {
        throw new Error(`a pour needs ${this.channelCount} channel values, got ${grams.length}`);
      }
      const timeoutMs = Math.round(
        options.expectedMs * this.options.pourTimeoutMultiplier + this.options.pourTimeoutExtraMs,
      );
      const ratio = this.options.suspiciousPourRatio ?? 0.25;
      const minDurationMs = ratio > 0 ? Math.round(options.expectedMs * ratio) : undefined;
      const withCup = options.withCup ?? this.driver.capabilities.cupDispenser;
      this.logger?.info({ grams, expectedMs: options.expectedMs, timeoutMs, minDurationMs, withCup }, 'pour started');
      try {
        const outcome = await this.driver.pour({ grams: [...grams], withCup, timeoutMs, minDurationMs });
        return this.recordOutcome(outcome);
      } catch (error) {
        if (error instanceof DeviceTimeoutError) {
          this.logger?.error({ timeoutMs }, 'pour timed out; stopping the device');
          await this.driver.stop().catch(() => undefined);
          this.markError('fault', `pour timed out after ${timeoutMs} ms`);
          return { ok: false, failure: 'timeout', detail: error.message, channels: [] };
        }
        if (error instanceof DeviceDisconnectedError) {
          return { ok: false, failure: 'device_offline', detail: error.message, channels: [] };
        }
        if (error instanceof DeviceProtocolError) {
          this.markError('fault', error.message);
          return { ok: false, failure: 'protocol', detail: error.message, channels: [] };
        }
        if (error instanceof DeviceBusyError) {
          this.markError('fault', error.message);
          return { ok: false, failure: 'busy', detail: error.message, channels: [] };
        }
        throw error;
      }
    });
  }

  rinse(channels: boolean[]): Promise<void> {
    return this.enqueue('rinse', () => this.driver.rinse(channels));
  }

  private recordOutcome(outcome: PourOutcome): PourOutcome {
    if (outcome.ok) return outcome;
    for (const { channel, failure } of outcome.channels) {
      if (failure === 'tank_empty' && channel < this.tanks.length) this.tanks[channel] = 'low';
    }
    if (outcome.failure === 'flowmeter' || outcome.failure === 'hardware') {
      // a pump or sensor fault needs staff; a working tank check would not prove it is fixed
      this.markError('fault', outcome.detail);
    } else {
      this.emitStatus();
    }
    this.logger?.warn({ failure: outcome.failure, detail: outcome.detail }, 'pour failed');
    return outcome;
  }

  /** Serializes commands: boards accept one at a time. */
  private enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      if (!this.driver.connected) throw new DeviceUnavailableError('device is not connected');
      if (this.error && label !== 'checkTank') {
        throw new DeviceUnavailableError(`device needs attention: ${this.error.message}`);
      }
      this.running = true;
      this.emitStatus();
      try {
        return await task();
      } finally {
        this.running = false;
        this.emitStatus();
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private computeState(): DeviceState {
    if (!this.driver.connected) return 'disconnected';
    if (this.error) return 'error';
    return this.running ? 'busy' : 'idle';
  }

  private markError(kind: DeviceErrorKind, message: string): void {
    this.error = { kind, message };
    this.lastError = message;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private async tryConnect(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.driver.connect();
      this.lastError = this.error?.message ?? null;
      this.logger?.info({ driver: this.driver.name }, 'device connected');
      this.emitStatus();
      await this.poll();
      this.schedulePoll();
    } catch (error) {
      this.lastError = (error as Error).message;
      this.logger?.warn({ err: error }, 'device connect failed');
      this.emitStatus();
      this.scheduleReconnect();
    }
  }

  /** A tank check that also acts as the liveness probe for the board. */
  private async poll(): Promise<void> {
    try {
      await this.checkTank();
    } catch (error) {
      await this.onPollFailure(error as Error);
    }
  }

  private async onPollFailure(error: Error): Promise<void> {
    if (error instanceof DeviceUnavailableError) return; // offline: the reconnect loop owns this
    this.pollFailures++;
    this.logger?.warn({ err: error, failures: this.pollFailures }, 'tank poll failed');
    if (this.error?.kind !== 'fault') this.markError('unresponsive', `device not responding: ${error.message}`);
    if (this.pollFailures >= (this.options.pollFailuresBeforeReconnect ?? 3)) {
      this.logger?.error({ failures: this.pollFailures }, 'device unresponsive; reopening the link');
      this.pollFailures = 0;
      await this.driver.disconnect().catch(() => undefined);
      if (!this.reconnectTimer && !this.stopped) this.scheduleReconnect();
    }
  }

  private onDisconnected(reason: string): void {
    this.logger?.warn({ reason }, 'device disconnected');
    this.lastError = reason;
    // a fault survives the reconnect: replugging the cable does not fix a pump
    if (this.error?.kind === 'unresponsive') this.error = null;
    this.tanks = unknownTanks(this.channelCount);
    this.clearTimers();
    this.emitStatus();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryConnect();
    }, this.options.reconnectMs);
    this.reconnectTimer.unref();
  }

  private schedulePoll(): void {
    if (this.stopped || this.pollTimer) return;
    const delayMs =
      this.error?.kind === 'unresponsive' ? (this.options.errorPollMs ?? 5_000) : this.options.tankPollMs;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      if (this.driver.connected && !this.running) await this.poll();
      this.schedulePoll();
    }, delayMs);
    this.pollTimer.unref();
  }

  private clearTimers(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pollTimer = null;
    this.reconnectTimer = null;
  }
}
