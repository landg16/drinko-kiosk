/** Picks the driver named by HARDWARE. New board: implement DeviceDriver in its own folder, add a HARDWARE value in env.ts and a case here. */
import { SerialPort } from 'serialport';
import type { DrinkoConfig } from '../config/schema';
import type { Env } from '../env';
import type { Logger } from '../logger';
import type { DeviceDriver } from './driver';
import { DrinkoJsonDriver } from './drinko-json/driver';
import { MockTransport } from './drinko-json/mock-transport';
import { SerialTransport } from './drinko-json/serial-transport';

export interface DriverBundle {
  driver: DeviceDriver;
  /** present only for the simulated Drinko board; steered through /api/dev/mock */
  mock?: MockTransport;
}

export function createDriver(
  env: Pick<Env, 'HARDWARE' | 'SERIAL_PATH' | 'SERIAL_TERMINATOR' | 'MOCK_TIME_SCALE'>,
  config: DrinkoConfig,
  settings: { flowRateGps: number[] },
  logger?: Logger,
): DriverBundle {
  const drinkoOptions = {
    checkTankTimeoutMs: config.device.checkTankTimeoutMs,
    pollMs: config.device.pourPollMs,
    logger,
  };
  switch (env.HARDWARE) {
    case 'mock': {
      const mock = new MockTransport({ flowRateGps: settings.flowRateGps, timeScale: env.MOCK_TIME_SCALE });
      return { driver: new DrinkoJsonDriver(mock, drinkoOptions), mock };
    }
    case 'serial': {
      if (!env.SERIAL_PATH) throw new Error('SERIAL_PATH is required when HARDWARE=serial');
      const transport = new SerialTransport({
        path: env.SERIAL_PATH,
        terminator: env.SERIAL_TERMINATOR === 'crlf' ? '\r\n' : '\n',
        openPort: (options) => new SerialPort({ ...options, autoOpen: false }),
        logger,
      });
      return { driver: new DrinkoJsonDriver(transport, drinkoOptions) };
    }
    default: {
      const never: never = env.HARDWARE;
      throw new Error(`unknown HARDWARE "${String(never)}"`);
    }
  }
}

/** The menu config and the board must agree on how many channels there are. */
export function assertChannelsMatchDriver(
  config: Pick<DrinkoConfig, 'channels'>,
  driver: Pick<DeviceDriver, 'name' | 'capabilities'>,
): void {
  if (config.channels.length !== driver.capabilities.channelCount) {
    throw new Error(
      `config lists ${config.channels.length} channels but driver ${driver.name} has ${driver.capabilities.channelCount}`,
    );
  }
}
