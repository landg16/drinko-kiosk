import { EventEmitter } from 'node:events';
import type { DeviceCapabilities, PourFailure, TankStatus } from '../../domain/types';
import type { Logger } from '../../logger';
import { sleep } from '../../util/sleep';
import type { ChannelFailure, DeviceDriver, DriverEvents, PourOutcome, PourRequest } from '../driver';
import { DeviceBusyError, DeviceProtocolError, DeviceTimeoutError } from '../errors';
import {
  CHANNEL_COUNT,
  CommandStatus,
  CommandType,
  ProtocolStatus,
  buildCommand,
  commandStatusName,
  commandTypeName,
  describeMessage,
  type DeviceMessage,
  type Payload,
} from './protocol';
import type { DeviceTransport } from './transport';

export interface DrinkoJsonDriverOptions {
  checkTankTimeoutMs?: number;
  /** how often CheckTank is polled while a pour runs after an echo acknowledgement */
  pollMs?: number;
  busyRetries?: number;
  busyRetryMs?: number;
  rinseTimeoutMs?: number;
  logger?: Logger;
}

function toTankStatus(value: number): TankStatus {
  if (value === CommandStatus.TankOK) return 'ok';
  if (value === CommandStatus.TankLow) return 'low';
  return 'unknown';
}

function toPourFailure(status: number): PourFailure {
  switch (status) {
    case CommandStatus.PouringFailedTankEmpty:
      return 'tank_empty';
    case CommandStatus.PouringFailedNoCup:
      return 'no_cup';
    case CommandStatus.PouringFailedFlowmeterError:
      return 'flowmeter';
    default:
      return 'hardware';
  }
}

const isPourType = (type: number): boolean =>
  type === CommandType.PourCap || type === CommandType.PourWithoutCap;

/** The firmware (as of 20 Sep 2026) acknowledges a pour by echoing the request payload. */
function isEcho(reply: DeviceMessage, grams: Payload): boolean {
  return reply.Status === ProtocolStatus.DeviceOK && reply.Payload.every((value, index) => value === grams[index]);
}

function toPayload(grams: number[]): Payload {
  if (grams.length !== CHANNEL_COUNT) {
    throw new Error(`the Drinko board has ${CHANNEL_COUNT} channels, got ${grams.length} values`);
  }
  return [grams[0], grams[1], grams[2], grams[3]];
}

/** Reads a documented status reply: one Vending_CommandStatus per requested channel. */
function interpretPour(reply: DeviceMessage, grams: Payload): PourOutcome {
  const channels: ChannelFailure[] = [];
  const details: string[] = [];
  grams.forEach((amount, channel) => {
    if (amount === 0) return;
    const status = reply.Payload[channel];
    if (status === CommandStatus.PouringOK) return;
    channels.push({ channel, failure: toPourFailure(status) });
    details.push(`ch${channel + 1}: ${commandStatusName(status)}`);
  });
  if (channels.length === 0) return { ok: true };
  return { ok: false, failure: channels[0].failure, detail: details.join(', '), channels };
}

/** Driver for the Drinko board's JSON-over-serial protocol (docs/HARDWARE_PROTOCOL.md); works over the serial port or the mock. */
export class DrinkoJsonDriver extends EventEmitter<DriverEvents> implements DeviceDriver {
  readonly name: string;
  readonly capabilities: DeviceCapabilities = {
    channelCount: CHANNEL_COUNT,
    tankLevels: true,
    cupSensor: false,
    cupDispenser: false,
    rinse: true,
  };
  private pouring = false;

  constructor(
    private readonly transport: DeviceTransport,
    private readonly options: DrinkoJsonDriverOptions = {},
  ) {
    super();
    this.name = `drinko-json/${transport.kind}`;
    transport.on('connected', () => this.emit('connected'));
    transport.on('disconnected', (reason) => this.emit('disconnected', reason));
    transport.on('unsolicited', (message) => this.onUnsolicited(message));
  }

  get connected(): boolean {
    return this.transport.connected;
  }

  connect(): Promise<void> {
    return this.transport.connect();
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  async checkTanks(): Promise<TankStatus[]> {
    const reply = await this.send(buildCommand(CommandType.CheckTank), this.options.checkTankTimeoutMs ?? 2000);
    return reply.Payload.map(toTankStatus);
  }

  async pour(request: PourRequest): Promise<PourOutcome> {
    const grams = toPayload(request.grams);
    const command = buildCommand(request.withCup ? CommandType.PourCap : CommandType.PourWithoutCap, grams);
    this.pouring = true;
    try {
      const startedAt = Date.now();
      const reply = await this.send(command, request.timeoutMs);
      if (!isEcho(reply, grams)) return interpretPour(reply, grams);

      // Echo acknowledgement: the pour runs now, CheckTank answers BUSY until it ends, and no
      // result message has been observed. Poll until idle, but accept a result if one shows up.
      const result = await this.awaitPourEnd(command.CommandType, request.timeoutMs);
      if (result === 'timeout') {
        throw new DeviceTimeoutError(`device stayed busy for ${request.timeoutMs} ms after the pour`);
      }
      if (result) return interpretPour(result, grams);

      const busyMs = Date.now() - startedAt;
      if (request.minDurationMs !== undefined && busyMs < request.minDurationMs) {
        // The board went idle far too soon for the requested amount: nothing flowed.
        const channels: ChannelFailure[] = [];
        grams.forEach((amount, channel) => {
          if (amount > 0) channels.push({ channel, failure: 'flowmeter' });
        });
        return {
          ok: false,
          failure: 'flowmeter',
          detail: `pour ended after ${busyMs} ms, at least ${request.minDurationMs} ms expected: nothing flowed`,
          channels,
        };
      }
      this.options.logger?.info({ busyMs }, 'pour ended without a result message; assuming success');
      return { ok: true };
    } finally {
      this.pouring = false;
    }
  }

  async stop(): Promise<void> {
    await this.transport.request(buildCommand(CommandType.StopWorking), 2000);
  }

  /** Payload semantics are still unconfirmed; 1 marks a channel for rinsing. */
  async rinse(channels: boolean[]): Promise<void> {
    const payload = Array.from({ length: CHANNEL_COUNT }, (_, index) => (channels[index] ? 1 : 0)) as Payload;
    await this.send(buildCommand(CommandType.Rinse, payload), this.options.rinseTimeoutMs ?? 60_000);
  }

  /** A pour status with failures arriving while nothing is being poured means the board found a fault. */
  private onUnsolicited(message: DeviceMessage): void {
    const reportsFailure =
      isPourType(message.CommandType) &&
      message.Status === ProtocolStatus.DeviceOK &&
      message.Payload.some((value) => value !== CommandStatus.PouringOK);
    if (!this.pouring && reportsFailure) {
      this.emit('fault', describeMessage(message));
      return;
    }
    this.options.logger?.info({ message }, 'unsolicited device message');
  }

  private async send(message: DeviceMessage, timeoutMs: number): Promise<DeviceMessage> {
    const retries = this.options.busyRetries ?? 5;
    const retryMs = this.options.busyRetryMs ?? 500;
    const name = commandTypeName(message.CommandType);
    for (let attempt = 0; attempt <= retries; attempt++) {
      const reply = await this.transport.request(message, timeoutMs);
      if (reply.Status === ProtocolStatus.DeviceBUSY) {
        this.options.logger?.warn({ attempt, command: name }, 'device busy, retrying');
        await sleep(retryMs);
        continue;
      }
      if (reply.Status === ProtocolStatus.ProtocolError) {
        throw new DeviceProtocolError(`device rejected ${name} with ProtocolError`);
      }
      if (reply.Status !== ProtocolStatus.DeviceOK) {
        throw new DeviceProtocolError(`device answered ${name} with unknown status ${reply.Status}`);
      }
      return reply;
    }
    throw new DeviceBusyError(`device stayed busy through ${retries} retries of ${name}`);
  }

  /** Polls CheckTank until the board stops answering BUSY; returns a result message if one arrives, undefined if it just goes idle. */
  private async awaitPourEnd(
    pourType: CommandType,
    timeoutMs: number,
  ): Promise<DeviceMessage | undefined | 'timeout'> {
    const deadline = Date.now() + timeoutMs;
    let result: DeviceMessage | undefined;
    const onUnsolicited = (message: DeviceMessage): void => {
      if (message.CommandType === pourType) result = message;
    };
    this.transport.on('unsolicited', onUnsolicited);
    try {
      while (Date.now() < deadline) {
        await sleep(this.options.pollMs ?? 500);
        if (result) return result;
        const poll = await this.transport.request(
          buildCommand(CommandType.CheckTank),
          this.options.checkTankTimeoutMs ?? 2000,
        );
        if (poll.CommandType === pourType && poll.Status === ProtocolStatus.DeviceOK) return poll;
        if (poll.Status !== ProtocolStatus.DeviceBUSY) return result;
      }
      return 'timeout';
    } finally {
      this.transport.off('unsolicited', onUnsolicited);
    }
  }
}
