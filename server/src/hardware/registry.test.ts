import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load';
import { assertChannelsMatchDriver, createDriver } from './registry';

const config = loadConfig(join(__dirname, '..', '..', 'config', 'drinko.json'));
const settings = { flowRateGps: [15, 15, 15, 15] };

describe('driver registry', () => {
  it('builds the simulated Drinko driver for HARDWARE=mock', () => {
    const bundle = createDriver({ HARDWARE: 'mock', SERIAL_TERMINATOR: 'lf', MOCK_TIME_SCALE: 0 }, config, settings);
    expect(bundle.driver.name).toBe('drinko-json/mock');
    expect(bundle.driver.capabilities.channelCount).toBe(4);
    expect(bundle.mock).toBeDefined();
    expect(() => assertChannelsMatchDriver(config, bundle.driver)).not.toThrow();
  });

  it('builds the serial Drinko driver without touching the port', () => {
    const bundle = createDriver(
      { HARDWARE: 'serial', SERIAL_PATH: 'COM99', SERIAL_TERMINATOR: 'lf', MOCK_TIME_SCALE: 1 },
      config,
      settings,
    );
    expect(bundle.driver.name).toBe('drinko-json/serial');
    expect(bundle.driver.connected).toBe(false);
    expect(bundle.mock).toBeUndefined();
  });

  it('refuses a menu config whose channel count differs from the board', () => {
    const driver = {
      name: 'other-board',
      capabilities: { channelCount: 6, tankLevels: true, cupSensor: false, cupDispenser: false, rinse: false },
    };
    expect(() => assertChannelsMatchDriver(config, driver)).toThrow(/4 channels but driver other-board has 6/);
  });
});
