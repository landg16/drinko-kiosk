import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load';
import { openDatabase } from '../db/database';
import { OrderRepository } from '../db/order-repository';
import { SettingsRepository, defaultSettings } from '../db/settings-repository';
import { OrderService } from '../domain/order-service';
import { EventBus } from '../events/bus';
import { DeviceController } from '../hardware/device-controller';
import { DrinkoJsonDriver } from '../hardware/drinko-json/driver';
import { MockTransport } from '../hardware/drinko-json/mock-transport';
import { MockPaymentAdapter } from '../payment/mock-payment';
import { createApp } from './app';
import type { SseHub } from './sse';

const PIN = '4321';

let server: Server;
let sse: SseHub;
let base: string;
let service: OrderService;
let device: DeviceController;
let mock: MockTransport;
let closeDb: () => void;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  const config = loadConfig(join(__dirname, '..', '..', 'config', 'drinko.json'));
  const db = openDatabase(':memory:');
  closeDb = () => db.close();
  const settings = new SettingsRepository(db, defaultSettings(config));
  const orders = new OrderRepository(db);
  mock = new MockTransport({ timeScale: 0 });
  device = new DeviceController(new DrinkoJsonDriver(mock, { pollMs: 5 }), { ...config.device, reconnectMs: 20 });
  const bus = new EventBus();
  device.on('status', (status) => bus.emit('device.status', status));
  service = new OrderService({
    config,
    settings,
    orders,
    device,
    payment: new MockPaymentAdapter({ delayMs: 0 }),
    bus,
  });
  const created = createApp({
    service,
    device,
    bus,
    settings,
    orders,
    adminPin: PIN,
    clientUrl: '*',
    pourOverheadMs: config.device.pourOverheadMs,
    mock,
  });
  sse = created.sse;
  server = created.app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await device.start();
});

afterAll(async () => {
  sse.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await device.stop();
  closeDb();
});

describe('HTTP API', () => {
  it('reports health and the menu', async () => {
    const health = await call('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true, device: 'idle' });

    const menu = await call('GET', '/api/menu');
    expect(menu.status).toBe(200);
    expect(menu.json.drinks).toHaveLength(8);
    expect(menu.json.ingredients.find((i: any) => i.id === 'gin')).toMatchObject({ channel: 1, tank: 'ok' });
  });

  it('validates order bodies', async () => {
    const bad = await call('POST', '/api/orders', { items: [{ drinkId: 'gin-tonic', size: 'triple', quantity: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('validation');
    const empty = await call('POST', '/api/orders', {});
    expect(empty.status).toBe(400);
  });

  it('takes an order through payment and pouring', async () => {
    const created = await call('POST', '/api/orders', {
      items: [{ drinkId: 'gin-tonic', size: 'double', quantity: 1 }],
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ status: 'created', total: 18 });
    const id: string = created.json.id;

    const active = await call('GET', '/api/orders/active');
    expect(active.json.order.id).toBe(id);

    const paying = await call('POST', `/api/orders/${id}/pay`);
    expect(paying.status).toBe(202);
    expect(paying.json.status).toBe('paying');
    await service.idle();

    const fetched = await call('GET', `/api/orders/${id}`);
    expect(fetched.json.status).toBe('awaiting_cup');

    const pouring = await call('POST', `/api/orders/${id}/pour`);
    expect(pouring.status).toBe(202);
    expect(pouring.json.status).toBe('pouring');
    await service.idle();

    const done = await call('GET', `/api/orders/${id}`);
    expect(done.json.status).toBe('completed');

    const again = await call('POST', `/api/orders/${id}/pour`);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('invalid_state');
  });

  it('protects admin routes with the PIN', async () => {
    const denied = await call('GET', '/api/admin/tanks');
    expect(denied.status).toBe(401);
    const allowed = await call('GET', '/api/admin/tanks', undefined, { 'x-admin-pin': PIN });
    expect(allowed.status).toBe(200);
    expect(allowed.json.tanks).toEqual(['ok', 'ok', 'ok', 'ok']);

    const settings = await call('PUT', '/api/admin/settings', { calibration: [1, 1.05, 1, 1] }, { 'x-admin-pin': PIN });
    expect(settings.status).toBe(200);
    expect(settings.json.calibration).toEqual([1, 1.05, 1, 1]);
  });

  it('lets staff clear a fault after a failed pour', async () => {
    await call('PUT', '/api/dev/mock', { faults: ['flowmeter', null, null, null] });
    const pour = await call('POST', '/api/admin/test-pour', { channel: 1, grams: 20 }, { 'x-admin-pin': PIN });
    expect(pour.json).toMatchObject({ ok: false, failure: 'flowmeter' });
    const status = await call('GET', '/api/device/status');
    expect(status.json).toMatchObject({ state: 'error', errorKind: 'fault' });
    const refused = await call('POST', '/api/orders', { items: [{ drinkId: 'tonic', size: 'single', quantity: 1 }] });
    expect(refused.status).toBe(503);

    await call('PUT', '/api/dev/mock', { faults: [null, null, null, null] });
    const cleared = await call('POST', '/api/admin/clear-fault', undefined, { 'x-admin-pin': PIN });
    expect(cleared.status).toBe(200);
    expect(cleared.json).toMatchObject({ state: 'idle', errorKind: null });
  });

  it('lets developers steer the mock device', async () => {
    const patched = await call('PUT', '/api/dev/mock', { tankGrams: [2000, 100, 2000, 2000] });
    expect(patched.status).toBe(200);
    expect(patched.json.tankGrams[1]).toBe(100);
    await device.checkTank();
    const menu = await call('GET', '/api/menu');
    expect(menu.json.drinks.find((d: any) => d.id === 'gin-tonic').available).toBe(false);
    await call('PUT', '/api/dev/mock', { tankGrams: [2000, 2000, 2000, 2000] });
    await device.checkTank();
  });

  it('streams a device snapshot over SSE on connect', async () => {
    const controller = new AbortController();
    const res = await fetch(base + '/api/events', { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: device.status');
    expect(text).toContain('"state":"idle"');
    controller.abort();
  });

  it('answers 404 as JSON for unknown routes', async () => {
    const missing = await call('GET', '/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('not_found');
  });
});
