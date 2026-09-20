import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { TankStatus } from '../domain/types';
import { sleep } from '../util/sleep';
import { DeviceController, type DeviceControllerOptions } from './device-controller';
import { DrinkoJsonDriver } from './drinko-json/driver';
import { MockTransport, type MockTransportOptions } from './drinko-json/mock-transport';
import { CommandType } from './drinko-json/protocol';
import type { DeviceDriver, DriverEvents, PourOutcome, PourRequest } from './driver';
import { DeviceTimeoutError, DeviceUnavailableError } from './errors';

const controllers: DeviceController[] = [];
const CONTROLLER_OPTIONS: DeviceControllerOptions = {
  pourTimeoutMultiplier: 2,
  pourTimeoutExtraMs: 100,
  tankPollMs: 60_000,
  reconnectMs: 20,
};

/** The Drinko driver over the simulated board. */
function setup(mockOptions: MockTransportOptions = {}, overrides: Partial<DeviceControllerOptions> = {}) {
  const mock = new MockTransport({ timeScale: 0, ...mockOptions });
  const driver = new DrinkoJsonDriver(mock, { checkTankTimeoutMs: 200, busyRetryMs: 5, pollMs: 20 });
  const device = new DeviceController(driver, { ...CONTROLLER_OPTIONS, ...overrides });
  controllers.push(device);
  return { mock, driver, device };
}

/** A pretend board with six channels, a cup sensor and a dispenser: proves the driver seam is real. */
class FakeDriver extends EventEmitter<DriverEvents> implements DeviceDriver {
  readonly name = 'fake-board';
  readonly capabilities = { channelCount: 6, tankLevels: true, cupSensor: true, cupDispenser: true, rinse: false };
  connected = false;
  stops = 0;
  disconnects = 0;
  readonly pours: PourRequest[] = [];
  nextOutcome: PourOutcome | Error = { ok: true };
  tanks: TankStatus[] = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'];
  tanksError: Error | null = null;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.disconnects++;
    this.emit('disconnected', 'closed');
  }

  async checkTanks(): Promise<TankStatus[]> {
    if (this.tanksError) throw this.tanksError;
    return [...this.tanks];
  }

  async pour(request: PourRequest): Promise<PourOutcome> {
    this.pours.push(request);
    if (this.nextOutcome instanceof Error) throw this.nextOutcome;
    return this.nextOutcome;
  }

  async stop(): Promise<void> {
    this.stops++;
  }

  async rinse(): Promise<void> {}
}

function setupFake(overrides: Partial<DeviceControllerOptions> = {}) {
  const driver = new FakeDriver();
  const device = new DeviceController(driver, { ...CONTROLLER_OPTIONS, ...overrides });
  controllers.push(device);
  return { driver, device };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((device) => device.stop()));
});

describe('DeviceController with the Drinko driver', () => {
  it('connects and reads the tanks on start', async () => {
    const { device } = setup();
    await device.start();
    const status = device.getStatus();
    expect(status.driver).toBe('drinko-json/mock');
    expect(status.capabilities.channelCount).toBe(4);
    expect(status.connected).toBe(true);
    expect(status.state).toBe('idle');
    expect(status.tanks).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(status.lastTankCheckAt).not.toBeNull();
  });

  it('pours and the mock tanks go down', async () => {
    const { mock, device } = setup();
    await device.start();
    const outcome = await device.pour([0, 38, 165, 0], { expectedMs: 50 });
    expect(outcome).toEqual({ ok: true });
    expect(mock.state.tankGrams).toEqual([2000, 1962, 1835, 2000]);
    expect(device.getStatus().state).toBe('idle');
  });

  it('reports an empty tank and marks that channel low without erroring the device', async () => {
    const { mock, device } = setup();
    await device.start();
    mock.state.tankGrams[0] = 10;
    const outcome = await device.pour([50, 0, 0, 0], { expectedMs: 50 });
    expect(outcome).toMatchObject({ ok: false, failure: 'tank_empty' });
    expect(device.getStatus().tanks[0]).toBe('low');
    expect(device.getStatus().state).toBe('idle');
  });

  it('a flow meter fault blocks pouring until staff clear it, even though tank checks still work', async () => {
    const { mock, device } = setup();
    await device.start();
    mock.state.faults[0] = 'flowmeter';
    const outcome = await device.pour([40, 0, 0, 0], { expectedMs: 50 });
    expect(outcome).toMatchObject({ ok: false, failure: 'flowmeter' });
    expect(device.getStatus()).toMatchObject({ state: 'error', errorKind: 'fault' });
    await expect(device.pour([40, 0, 0, 0], { expectedMs: 50 })).rejects.toBeInstanceOf(DeviceUnavailableError);
    await device.checkTank();
    expect(device.getStatus().state).toBe('error');
    mock.state.faults[0] = null;
    await device.clearFault();
    expect(device.getStatus()).toMatchObject({ state: 'idle', errorKind: null });
  });

  it('keeps a fault across a reconnect', async () => {
    const { mock, device } = setup();
    await device.start();
    mock.state.faults[1] = 'hardware';
    await device.pour([0, 40, 0, 0], { expectedMs: 50 });
    expect(device.getStatus().errorKind).toBe('fault');
    mock.simulateDisconnect();
    await sleep(80);
    expect(device.getStatus()).toMatchObject({ connected: true, state: 'error', errorKind: 'fault' });
  });

  it('stops a pour that never answers and flags the device', async () => {
    const { mock, device } = setup({ timeScale: 1, flowRateGps: [1, 1, 1, 1] });
    await device.start();
    // 100 g at 1 g/s would take 100 s; we allow 2 × 10 + 100 = 120 ms
    const outcome = await device.pour([100, 0, 0, 0], { expectedMs: 10 });
    expect(outcome).toMatchObject({ ok: false, failure: 'timeout' });
    expect(mock.received.map((message) => message.CommandType)).toContain(CommandType.StopWorking);
    expect(device.getStatus().state).toBe('error');
  });

  it('accepts an echo acknowledgement and waits for the device to go idle again', async () => {
    const { mock, device } = setup({ replyStyle: 'echo', timeScale: 1, flowRateGps: [100, 100, 100, 100] });
    await device.start();
    const startedAt = Date.now();
    const outcome = await device.pour([20, 0, 0, 0], { expectedMs: 200 });
    expect(outcome).toEqual({ ok: true });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(180);
    expect(mock.state.tankGrams[0]).toBe(1980);
    const types = mock.received.map((message) => message.CommandType);
    expect(types.indexOf(CommandType.PourWithoutCap)).toBeLessThan(types.lastIndexOf(CommandType.CheckTank));
    expect(device.getStatus().state).toBe('idle');
  });

  it('treats a pour that ends far too early for its size as nothing having flowed', async () => {
    // the pump "finishes" 20 g in 200 ms, but the recipe expected 2 s: below 25 % is implausible
    const { device } = setup({ replyStyle: 'echo', timeScale: 1, flowRateGps: [100, 100, 100, 100] });
    await device.start();
    const outcome = await device.pour([20, 0, 0, 0], { expectedMs: 2000 });
    expect(outcome).toMatchObject({ ok: false, failure: 'flowmeter' });
    expect(device.getStatus().state).toBe('error');
    expect(device.getStatus().lastError).toMatch(/nothing flowed/);
  });

  it('stops a device that stays busy after an echo acknowledgement', async () => {
    const { mock, device } = setup({ replyStyle: 'echo', timeScale: 1, flowRateGps: [1, 1, 1, 1] });
    await device.start();
    const outcome = await device.pour([100, 0, 0, 0], { expectedMs: 10 });
    expect(outcome).toMatchObject({ ok: false, failure: 'timeout' });
    expect(mock.received.map((message) => message.CommandType)).toContain(CommandType.StopWorking);
    expect(device.getStatus().state).toBe('error');
  });

  it('runs commands one at a time', async () => {
    const { mock, device } = setup();
    await device.start();
    const [first, second, tanks] = await Promise.all([
      device.pour([40, 0, 0, 0], { expectedMs: 50 }),
      device.pour([0, 40, 0, 0], { expectedMs: 50 }),
      device.checkTank(),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(tanks).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(mock.received.map((message) => message.CommandType)).toEqual([
      CommandType.CheckTank,
      CommandType.PourWithoutCap,
      CommandType.PourWithoutCap,
      CommandType.CheckTank,
    ]);
  });

  it('reconnects after the cable is pulled', async () => {
    const { mock, device } = setup();
    const states: string[] = [];
    device.on('status', (status) => states.push(status.state));
    await device.start();
    mock.simulateDisconnect();
    expect(device.getStatus().state).toBe('disconnected');
    expect(device.getStatus().tanks).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    await sleep(80);
    expect(device.getStatus().state).toBe('idle');
    expect(device.getStatus().tanks).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(states).toContain('disconnected');
  });

  it('keeps retrying when the first connect fails', async () => {
    const { mock, device } = setup();
    mock.failNextConnect = true;
    await device.start();
    expect(device.getStatus().connected).toBe(false);
    await sleep(80);
    expect(device.getStatus().state).toBe('idle');
  });

  it('refuses commands after stop', async () => {
    const { device } = setup();
    await device.start();
    await device.stop();
    await expect(device.checkTank()).rejects.toBeInstanceOf(DeviceUnavailableError);
  });
});

describe('DeviceController with another board', () => {
  it('drives a six-channel board with a cup sensor and dispenser through the same controller', async () => {
    const { driver, device } = setupFake();
    const cups: boolean[] = [];
    device.on('cup', (present) => cups.push(present));
    await device.start();

    const status = device.getStatus();
    expect(status.driver).toBe('fake-board');
    expect(status.capabilities).toMatchObject({ channelCount: 6, cupSensor: true, cupDispenser: true });
    expect(status.tanks).toHaveLength(6);

    const outcome = await device.pour([0, 0, 0, 0, 0, 10], { expectedMs: 100 });
    expect(outcome).toEqual({ ok: true });
    expect(driver.pours[0]).toMatchObject({
      grams: [0, 0, 0, 0, 0, 10],
      withCup: true,
      timeoutMs: 300,
      minDurationMs: 25,
    });

    await expect(device.pour([1, 0, 0, 0], { expectedMs: 10 })).rejects.toThrow(/6 channel values/);

    driver.emit('cup', true);
    expect(cups).toEqual([true]);
  });

  it('stops the board and flags an error when the driver times out', async () => {
    const { driver, device } = setupFake();
    await device.start();
    driver.nextOutcome = new DeviceTimeoutError('never finished');
    const outcome = await device.pour([5, 0, 0, 0, 0, 0], { expectedMs: 10 });
    expect(outcome).toMatchObject({ ok: false, failure: 'timeout' });
    expect(driver.stops).toBe(1);
    expect(device.getStatus()).toMatchObject({ state: 'error', errorKind: 'fault' });
    driver.nextOutcome = { ok: true };
    await device.checkTank();
    expect(device.getStatus().state).toBe('error');
    await device.clearFault();
    expect(device.getStatus().state).toBe('idle');
  });

  it('marks a channel low when the driver reports an empty tank', async () => {
    const { driver, device } = setupFake();
    await device.start();
    driver.nextOutcome = { ok: false, failure: 'tank_empty', detail: 'ch3', channels: [{ channel: 2, failure: 'tank_empty' }] };
    await device.pour([0, 0, 5, 0, 0, 0], { expectedMs: 10 });
    expect(device.getStatus().tanks).toEqual(['ok', 'ok', 'low', 'ok', 'ok', 'ok']);
    expect(device.getStatus().state).toBe('idle');
  });

  it('goes into error when the board stops answering polls, and recovers when it answers again', async () => {
    const { driver, device } = setupFake({ tankPollMs: 10, errorPollMs: 10, pollFailuresBeforeReconnect: 100 });
    await device.start();
    expect(device.getStatus().state).toBe('idle');

    driver.tanksError = new DeviceTimeoutError('silent');
    await sleep(60);
    expect(device.getStatus()).toMatchObject({ state: 'error', errorKind: 'unresponsive' });
    expect(device.getStatus().lastError).toMatch(/not responding/);
    await expect(device.pour([5, 0, 0, 0, 0, 0], { expectedMs: 10 })).rejects.toBeInstanceOf(DeviceUnavailableError);

    driver.tanksError = null;
    await sleep(60);
    expect(device.getStatus().state).toBe('idle');
  });

  it('closes and reopens the link after repeated failed polls', async () => {
    const { driver, device } = setupFake({ tankPollMs: 10, errorPollMs: 10, pollFailuresBeforeReconnect: 2, reconnectMs: 10 });
    await device.start();
    driver.tanksError = new DeviceTimeoutError('silent');
    await sleep(120);
    expect(driver.disconnects).toBeGreaterThanOrEqual(1);
    driver.tanksError = null;
    await sleep(80);
    expect(device.getStatus().state).toBe('idle');
  });

  it('treats a fault reported by the board as an error until staff clear it', async () => {
    const { driver, device } = setupFake();
    await device.start();
    driver.emit('fault', 'pump 2 stalled');
    expect(device.getStatus()).toMatchObject({ state: 'error', errorKind: 'fault' });
    expect(device.getStatus().lastError).toMatch(/pump 2 stalled/);
    await device.checkTank();
    expect(device.getStatus().state).toBe('error');
    await device.clearFault();
    expect(device.getStatus().state).toBe('idle');
  });
});
