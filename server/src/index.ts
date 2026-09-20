import { resolve } from 'node:path';
import { createApp } from './api/app';
import { loadConfig } from './config/load';
import { openDatabase } from './db/database';
import { OrderRepository } from './db/order-repository';
import { SettingsRepository, defaultSettings } from './db/settings-repository';
import { OrderService } from './domain/order-service';
import { loadEnv } from './env';
import { EventBus } from './events/bus';
import { DeviceController } from './hardware/device-controller';
import { assertChannelsMatchDriver, createDriver } from './hardware/registry';
import { createLogger } from './logger';
import { MockPaymentAdapter } from './payment/mock-payment';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV !== 'production' && Boolean(process.stdout.isTTY));
  const cwd = process.cwd();

  const config = loadConfig(resolve(cwd, env.CONFIG_PATH));
  const db = openDatabase(env.DB_PATH === ':memory:' ? env.DB_PATH : resolve(cwd, env.DB_PATH));
  const settings = new SettingsRepository(db, defaultSettings(config));
  const orders = new OrderRepository(db);

  const { driver, mock } = createDriver(env, config, settings.get(), logger);
  assertChannelsMatchDriver(config, driver);
  const device = new DeviceController(driver, { ...config.device, logger });
  const bus = new EventBus();
  device.on('status', (status) => bus.emit('device.status', status));

  const payment = new MockPaymentAdapter();
  const service = new OrderService({ config, settings, orders, device, payment, bus, logger });

  const { app, sse } = createApp({
    service,
    device,
    bus,
    settings,
    orders,
    adminPin: env.ADMIN_PIN,
    clientUrl: env.CLIENT_URL,
    clientDist: resolve(cwd, env.CLIENT_DIST),
    pourOverheadMs: config.device.pourOverheadMs,
    mock,
    logger,
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, driver: driver.name, payment: payment.kind }, 'Drinko server listening');
  });

  await device.start();

  const sweeper = setInterval(() => {
    const expired = service.sweep();
    if (expired > 0) logger.info({ expired }, 'expired stale orders');
  }, 30_000);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    clearInterval(sweeper);
    sse.close();
    server.close();
    await device.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
