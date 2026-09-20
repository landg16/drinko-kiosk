import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DeviceBusyError, DeviceProtocolError, DeviceTimeoutError } from '../errors';
import { DrinkoJsonDriver } from './driver';
import { CommandType, type DeviceMessage, type Payload } from './protocol';
import type { DeviceTransport, TransportEvents } from './transport';

type Reply = (request: DeviceMessage) => DeviceMessage;

/** Answers requests from a script, so each protocol behaviour can be pinned down exactly. */
class ScriptedTransport extends EventEmitter<TransportEvents> implements DeviceTransport {
  readonly kind = 'mock' as const;
  connected = true;
  readonly sent: DeviceMessage[] = [];
  private readonly replies: Reply[] = [];
  private fallback: Reply | undefined;

  script(...replies: Reply[]): this {
    this.replies.push(...replies);
    return this;
  }

  always(reply: Reply): this {
    this.fallback = reply;
    return this;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async request(message: DeviceMessage): Promise<DeviceMessage> {
    this.sent.push(message);
    const reply = this.replies.shift() ?? this.fallback;
    if (!reply) throw new Error(`no scripted reply for CommandType ${message.CommandType}`);
    return reply(message);
  }
}

const ok =
  (payload: Payload): Reply =>
  (request) => ({ Status: 0, CommandType: request.CommandType, Payload: payload });
const echo: Reply = (request) => ({ ...request, Status: 0 });
const busy: Reply = (request) => ({ Status: 2, CommandType: request.CommandType, Payload: [0, 0, 0, 0] });
const protocolError: Reply = (request) => ({ Status: 1, CommandType: request.CommandType, Payload: [0, 0, 0, 0] });

const driverOver = (transport: DeviceTransport) =>
  new DrinkoJsonDriver(transport, { pollMs: 1, busyRetryMs: 1, busyRetries: 2, checkTankTimeoutMs: 50 });

describe('DrinkoJsonDriver', () => {
  it('maps tank statuses and treats the firmware zeros as unknown', async () => {
    const transport = new ScriptedTransport().script(ok([5, 6, 0, 5]));
    await expect(driverOver(transport).checkTanks()).resolves.toEqual(['ok', 'low', 'unknown', 'ok']);
    expect(transport.sent[0].CommandType).toBe(CommandType.CheckTank);
  });

  it('reads a documented status reply into per-channel failures', async () => {
    const transport = new ScriptedTransport().script(ok([0, 1, 0, 0]));
    const outcome = await driverOver(transport).pour({ grams: [40, 160, 0, 0], withCup: false, timeoutMs: 100 });
    expect(outcome).toEqual({
      ok: false,
      failure: 'tank_empty',
      detail: 'ch2: PouringFailedTankEmpty',
      channels: [{ channel: 1, failure: 'tank_empty' }],
    });
    expect(transport.sent[0].CommandType).toBe(CommandType.PourWithoutCap);
  });

  it('uses PourCap when a cup should be dropped first', async () => {
    const transport = new ScriptedTransport().script(ok([0, 0, 0, 0]));
    await driverOver(transport).pour({ grams: [40, 0, 0, 0], withCup: true, timeoutMs: 100 });
    expect(transport.sent[0].CommandType).toBe(CommandType.PourCap);
  });

  it('after an echo acknowledgement, polls CheckTank until the board is idle', async () => {
    const transport = new ScriptedTransport().script(echo, busy, busy, ok([0, 0, 0, 0]));
    const outcome = await driverOver(transport).pour({ grams: [20, 0, 0, 0], withCup: false, timeoutMs: 500 });
    expect(outcome).toEqual({ ok: true });
    expect(transport.sent.map((message) => message.CommandType)).toEqual([
      CommandType.PourWithoutCap,
      CommandType.CheckTank,
      CommandType.CheckTank,
      CommandType.CheckTank,
    ]);
  });

  it('takes a result delivered in place of a poll reply', async () => {
    const transport = new ScriptedTransport().script(echo, busy, () => ({
      Status: 0,
      CommandType: CommandType.PourWithoutCap,
      Payload: [0, 3, 0, 0],
    }));
    const outcome = await driverOver(transport).pour({ grams: [0, 40, 0, 0], withCup: false, timeoutMs: 500 });
    expect(outcome).toMatchObject({ ok: false, failure: 'flowmeter', channels: [{ channel: 1, failure: 'flowmeter' }] });
  });

  it('uses an unsolicited result during a pour instead of raising a fault', async () => {
    const transport = new ScriptedTransport();
    transport.script(echo, (request) => {
      transport.emit('unsolicited', { Status: 0, CommandType: CommandType.PourWithoutCap, Payload: [2, 0, 0, 0] });
      return busy(request);
    });
    const driver = driverOver(transport);
    const faults: string[] = [];
    driver.on('fault', (detail) => faults.push(detail));
    const outcome = await driver.pour({ grams: [40, 0, 0, 0], withCup: false, timeoutMs: 500 });
    expect(outcome).toMatchObject({ ok: false, failure: 'no_cup' });
    expect(faults).toEqual([]);
  });

  it('flags a pour that ends implausibly fast when the board reports nothing', async () => {
    const transport = new ScriptedTransport().script(echo, ok([0, 0, 0, 0]));
    const outcome = await driverOver(transport).pour({
      grams: [200, 0, 0, 0],
      withCup: false,
      timeoutMs: 500,
      minDurationMs: 200,
    });
    expect(outcome).toMatchObject({
      ok: false,
      failure: 'flowmeter',
      channels: [{ channel: 0, failure: 'flowmeter' }],
    });
    expect((outcome as { detail: string }).detail).toMatch(/nothing flowed/);
  });

  it('assumes success when the board reports nothing and no minimum duration is set', async () => {
    const transport = new ScriptedTransport().script(echo, ok([0, 0, 0, 0]));
    const outcome = await driverOver(transport).pour({ grams: [200, 0, 0, 0], withCup: false, timeoutMs: 500 });
    expect(outcome).toEqual({ ok: true });
  });

  it('reports an unsolicited failure status as a fault while idle', async () => {
    const transport = new ScriptedTransport();
    const driver = driverOver(transport);
    const faults: string[] = [];
    driver.on('fault', (detail) => faults.push(detail));
    transport.emit('unsolicited', { Status: 0, CommandType: CommandType.PourWithoutCap, Payload: [0, 3, 0, 0] });
    transport.emit('unsolicited', { Status: 0, CommandType: CommandType.CheckTank, Payload: [5, 5, 5, 5] });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/PouringFailedFlowmeterError/);
  });

  it('gives up when the board never goes idle', async () => {
    const transport = new ScriptedTransport().script(echo).always(busy);
    await expect(
      driverOver(transport).pour({ grams: [20, 0, 0, 0], withCup: false, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(DeviceTimeoutError);
  });

  it('retries BUSY a few times, then reports the board as stuck', async () => {
    const transport = new ScriptedTransport().always(busy);
    await expect(driverOver(transport).checkTanks()).rejects.toBeInstanceOf(DeviceBusyError);
    expect(transport.sent).toHaveLength(3);
  });

  it('reports a ProtocolError', async () => {
    const transport = new ScriptedTransport().script(protocolError);
    await expect(driverOver(transport).checkTanks()).rejects.toBeInstanceOf(DeviceProtocolError);
  });

  it('refuses a pour with the wrong number of channels', async () => {
    const transport = new ScriptedTransport();
    await expect(driverOver(transport).pour({ grams: [1, 2, 3], withCup: false, timeoutMs: 100 })).rejects.toThrow(
      /4 channels/,
    );
  });
});
