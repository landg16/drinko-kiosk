import { EventEmitter } from 'node:events';
import { DeviceDisconnectedError, DeviceTimeoutError } from '../errors';
import { CommandStatus, CommandType, ProtocolStatus, type DeviceMessage, type Payload } from './protocol';
import type { DeviceTransport, TransportEvents } from './transport';

export type MockFault = 'flowmeter' | 'hardware';

/** 'status' answers a pour at the end with per-channel statuses (as documented); 'echo' echoes the request at once,
 *  stays BUSY while working and sends no result (as the firmware behaved on 20 Sep 2026). */
export type MockReplyStyle = 'status' | 'echo';

/** Everything about the simulated Drinko board that a test or the /api/dev/mock endpoint can change. */
export interface MockDeviceState {
  /** liquid left per channel */
  tankGrams: number[];
  /** CheckTank reports TankLow below this */
  lowThresholdGrams: number;
  flowRateGps: number[];
  /** injected pump faults per channel */
  faults: (MockFault | null)[];
  /** only matters for PourCap (dispenser) */
  cupsAvailable: boolean;
  /** 1 = real time, 0 = instant */
  timeScale: number;
  replyStyle: MockReplyStyle;
}

export type MockTransportOptions = Partial<MockDeviceState>;

const DEFAULT_STATE: MockDeviceState = {
  tankGrams: [2000, 2000, 2000, 2000],
  lowThresholdGrams: 300,
  flowRateGps: [15, 15, 15, 15],
  faults: [null, null, null, null],
  cupsAvailable: true,
  timeScale: 1,
  replyStyle: 'status',
};

function reply(request: DeviceMessage, payload: Payload): DeviceMessage {
  return { Status: ProtocolStatus.DeviceOK, CommandType: request.CommandType, Payload: payload };
}

/** Simulates the Drinko board at the wire level: tank check, cup check, faults, simultaneous pumps, BUSY, StopWorking. */
export class MockTransport extends EventEmitter<TransportEvents> implements DeviceTransport {
  readonly kind = 'mock' as const;
  readonly state: MockDeviceState;
  /** every request the mock received, oldest first */
  readonly received: DeviceMessage[] = [];
  /** makes the next connect() fail once, to test reconnect handling */
  failNextConnect = false;

  private _connected = false;
  private busy: { abort: () => void } | null = null;

  constructor(options: MockTransportOptions = {}) {
    super();
    this.state = {
      ...DEFAULT_STATE,
      ...options,
      tankGrams: [...(options.tankGrams ?? DEFAULT_STATE.tankGrams)],
      flowRateGps: [...(options.flowRateGps ?? DEFAULT_STATE.flowRateGps)],
      faults: [...(options.faults ?? DEFAULT_STATE.faults)],
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this.failNextConnect) {
      this.failNextConnect = false;
      throw new Error('mock: connect failed');
    }
    if (this._connected) return;
    this._connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this.busy?.abort();
    this.emit('disconnected', 'closed');
  }

  /** Pretend the USB cable was pulled. The controller's reconnect loop will call connect() again. */
  simulateDisconnect(reason = 'usb unplugged'): void {
    if (!this._connected) return;
    this._connected = false;
    this.busy?.abort();
    this.emit('disconnected', reason);
  }

  async request(message: DeviceMessage, timeoutMs: number): Promise<DeviceMessage> {
    if (!this._connected) throw new DeviceDisconnectedError();
    this.received.push(message);

    if (message.CommandType === CommandType.StopWorking) {
      this.busy?.abort();
      return reply(message, [0, 0, 0, 0]);
    }
    if (this.busy) {
      return { Status: ProtocolStatus.DeviceBUSY, CommandType: message.CommandType, Payload: [0, 0, 0, 0] };
    }

    switch (message.CommandType) {
      case CommandType.CheckTank:
        return reply(
          message,
          this.state.tankGrams.map((grams) =>
            grams < this.state.lowThresholdGrams ? CommandStatus.TankLow : CommandStatus.TankOK,
          ) as Payload,
        );
      case CommandType.PourCap:
      case CommandType.PourWithoutCap:
        return this.pour(message, message.CommandType === CommandType.PourCap, timeoutMs);
      case CommandType.Rinse: {
        const outcome = await this.runBusy(2000 * this.state.timeScale, timeoutMs);
        if (outcome === 'timeout') throw new DeviceTimeoutError();
        return reply(message, [0, 0, 0, 0]);
      }
      default:
        return { Status: ProtocolStatus.ProtocolError, CommandType: message.CommandType, Payload: [0, 0, 0, 0] };
    }
  }

  private async pour(message: DeviceMessage, withCup: boolean, timeoutMs: number): Promise<DeviceMessage> {
    const grams = message.Payload;
    const statuses: Payload = [0, 0, 0, 0];

    let tankEmpty = false;
    grams.forEach((amount, channel) => {
      if (amount > 0 && this.state.tankGrams[channel] < amount) {
        statuses[channel] = CommandStatus.PouringFailedTankEmpty;
        tankEmpty = true;
      }
    });
    if (tankEmpty) return reply(message, statuses);

    if (withCup && !this.state.cupsAvailable) {
      grams.forEach((amount, channel) => {
        if (amount > 0) statuses[channel] = CommandStatus.PouringFailedNoCup;
      });
      return reply(message, statuses);
    }

    let faulted = false;
    grams.forEach((amount, channel) => {
      const fault = this.state.faults[channel];
      if (amount > 0 && fault) {
        statuses[channel] =
          fault === 'flowmeter' ? CommandStatus.PouringFailedFlowmeterError : CommandStatus.PouringFailedHardwareError;
        faulted = true;
      }
    });
    if (faulted) {
      // the real device notices missing flow only after the pump has run for a moment
      const outcome = await this.runBusy(500 * this.state.timeScale, timeoutMs);
      if (outcome === 'timeout') throw new DeviceTimeoutError();
      return reply(message, statuses);
    }

    const durationMs =
      Math.max(
        0,
        ...grams.map((amount, channel) => (amount > 0 ? (amount / this.state.flowRateGps[channel]) * 1000 : 0)),
      ) * this.state.timeScale;
    const drain = () =>
      grams.forEach((amount, channel) => {
        this.state.tankGrams[channel] = Math.max(0, this.state.tankGrams[channel] - amount);
      });

    if (this.state.replyStyle === 'echo') {
      void this.startBusy(durationMs, drain);
      return reply(message, [...grams] as Payload);
    }

    const outcome = await this.runBusy(durationMs, timeoutMs, drain);
    if (outcome === 'timeout') throw new DeviceTimeoutError();
    if (outcome === 'aborted') {
      grams.forEach((amount, channel) => {
        if (amount > 0) statuses[channel] = CommandStatus.PouringFailedHardwareError;
      });
      return reply(message, statuses);
    }
    return reply(message, statuses);
  }

  /** Occupies the device for durationMs; StopWorking aborts it. */
  private startBusy(durationMs: number, onDone?: () => void): Promise<'done' | 'aborted'> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.busy = null;
        onDone?.();
        resolve('done');
      }, durationMs);
      this.busy = {
        abort: () => {
          clearTimeout(timer);
          this.busy = null;
          resolve('aborted');
        },
      };
    });
  }

  /** Like startBusy, but resolves 'timeout' if the caller's timeout elapses first while the device keeps working. */
  private runBusy(
    durationMs: number,
    timeoutMs: number,
    onDone?: () => void,
  ): Promise<'done' | 'aborted' | 'timeout'> {
    const work = this.startBusy(durationMs, onDone);
    const timeout = new Promise<'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      void work.then(() => clearTimeout(timer));
    });
    return Promise.race([work, timeout]);
  }
}
