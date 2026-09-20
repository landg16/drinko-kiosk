import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, type ZodType } from 'zod';
import type { OrderRepository } from '../db/order-repository';
import type { SettingsRepository } from '../db/settings-repository';
import { ServiceError, type OrderService } from '../domain/order-service';
import type { EventBus } from '../events/bus';
import type { DeviceController } from '../hardware/device-controller';
import type { MockTransport } from '../hardware/drinko-json/mock-transport';
import { DeviceUnavailableError } from '../hardware/errors';
import type { Logger } from '../logger';
import { SseHub } from './sse';

export interface AppDeps {
  service: OrderService;
  device: DeviceController;
  bus: EventBus;
  settings: SettingsRepository;
  orders: OrderRepository;
  adminPin: string;
  clientUrl: string;
  /** built client to serve; skipped when the folder does not exist (dev uses Vite) */
  clientDist?: string;
  pourOverheadMs: number;
  /** present when running against the simulated device; enables /api/dev/mock */
  mock?: MockTransport;
  logger?: Logger;
}

export class ValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid request: ${issues.join('; ')}`);
    this.name = 'ValidationError';
  }
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`));
  }
  return result.data;
}

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        drinkId: z.string().min(1),
        size: z.enum(['single', 'double']),
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .min(1),
});

const testPourSchema = z.object({
  channel: z.number().int().min(1).max(16),
  grams: z.number().int().min(1).max(500),
});

const rinseSchema = z.object({ channels: z.array(z.boolean()).min(1).max(16) });

const settingsPatchSchema = z.object({
  calibration: z.array(z.number().positive()).min(1).optional(),
  flowRateGps: z.array(z.number().positive()).min(1).optional(),
  disabledDrinks: z.array(z.string()).optional(),
});

const mockPatchSchema = z.object({
  tankGrams: z.array(z.number().nonnegative()).length(4).optional(),
  lowThresholdGrams: z.number().nonnegative().optional(),
  flowRateGps: z.array(z.number().positive()).length(4).optional(),
  faults: z.array(z.enum(['flowmeter', 'hardware']).nullable()).length(4).optional(),
  cupsAvailable: z.boolean().optional(),
  timeScale: z.number().min(0).optional(),
  replyStyle: z.enum(['status', 'echo']).optional(),
});

export function createApp(deps: AppDeps): { app: express.Express; sse: SseHub } {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(cors({ origin: deps.clientUrl }));

  const sse = new SseHub(deps.bus, () => ({
    device: deps.device.getStatus(),
    order: deps.service.getActiveOrder(),
  }));

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true, uptimeSec: Math.round(process.uptime()), device: deps.device.getStatus().state });
  });

  api.get('/menu', (_req, res) => {
    res.json(deps.service.getMenu());
  });

  api.get('/device/status', (_req, res) => {
    res.json(deps.device.getStatus());
  });

  api.post('/device/stop', async (_req, res) => {
    await deps.device.stopNow();
    res.status(202).json({ ok: true });
  });

  api.get('/events', sse.handle);

  api.get('/orders/active', (_req, res) => {
    res.json({ order: deps.service.getActiveOrder() });
  });

  api.post('/orders', (req, res) => {
    const body = parseBody(createOrderSchema, req.body);
    res.status(201).json(deps.service.createOrder(body.items));
  });

  api.get('/orders/:id', (req, res) => {
    res.json(deps.service.getOrder(req.params.id));
  });

  api.post('/orders/:id/pay', (req, res) => {
    res.status(202).json(deps.service.pay(req.params.id));
  });

  api.post('/orders/:id/pour', (req, res) => {
    res.status(202).json(deps.service.pour(req.params.id));
  });

  api.post('/orders/:id/cancel', (req, res) => {
    res.json(deps.service.cancel(req.params.id));
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    if (req.get('x-admin-pin') !== deps.adminPin) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'invalid admin PIN' } });
      return;
    }
    next();
  });
  admin.get('/tanks', async (_req, res) => {
    res.json({ tanks: await deps.device.checkTank() });
  });
  admin.post('/clear-fault', async (_req, res) => {
    await deps.device.clearFault();
    res.json(deps.device.getStatus());
  });
  admin.post('/test-pour', async (req, res) => {
    const { channel, grams } = parseBody(testPourSchema, req.body);
    const channelCount = deps.device.channelCount;
    if (channel > channelCount) throw new ValidationError([`channel must be between 1 and ${channelCount}`]);
    const request = Array.from({ length: channelCount }, (_, index) => (index === channel - 1 ? grams : 0));
    const rate = deps.settings.get().flowRateGps[channel - 1] ?? 1;
    const expectedMs = Math.round((grams / rate) * 1000 + deps.pourOverheadMs);
    res.json(await deps.device.pour(request, { expectedMs, withCup: false }));
  });
  admin.post('/rinse', async (req, res) => {
    const { channels } = parseBody(rinseSchema, req.body);
    if (channels.length !== deps.device.channelCount) {
      throw new ValidationError([`channels needs ${deps.device.channelCount} entries`]);
    }
    await deps.device.rinse(channels);
    res.json({ ok: true });
  });
  admin.get('/settings', (_req, res) => {
    res.json(deps.settings.get());
  });
  admin.put('/settings', (req, res) => {
    const patch = parseBody(settingsPatchSchema, req.body);
    for (const key of ['calibration', 'flowRateGps'] as const) {
      const values = patch[key];
      if (values && values.length !== deps.device.channelCount) {
        throw new ValidationError([`${key} needs ${deps.device.channelCount} values, one per channel`]);
      }
    }
    res.json(deps.settings.update(patch));
  });
  admin.get('/orders', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ orders: deps.orders.list(limit) });
  });
  api.use('/admin', admin);

  const mock = deps.mock;
  if (mock) {
    const dev = express.Router();
    dev.get('/mock', (_req, res) => {
      res.json(mock.state);
    });
    dev.put('/mock', (req, res) => {
      const patch = parseBody(mockPatchSchema, req.body);
      const state = mock.state as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) state[key] = value;
      }
      res.json(mock.state);
    });
    dev.post('/mock/disconnect', (_req, res) => {
      mock.simulateDisconnect('unplugged via /api/dev/mock/disconnect');
      res.status(202).json({ ok: true });
    });
    api.use('/dev', dev);
  }

  app.use('/api', api);

  if (deps.clientDist && existsSync(join(deps.clientDist, 'index.html'))) {
    const indexHtml = join(deps.clientDist, 'index.html');
    app.use(express.static(deps.clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `${req.method} ${req.path} not found` } });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ServiceError) {
      res.status(error.httpStatus).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ValidationError) {
      res.status(400).json({ error: { code: 'validation', message: error.message, issues: error.issues } });
      return;
    }
    if (error instanceof DeviceUnavailableError) {
      res.status(503).json({ error: { code: 'device_unavailable', message: error.message } });
      return;
    }
    if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_json', message: 'request body is not valid JSON' } });
      return;
    }
    deps.logger?.error({ err: error, method: req.method, path: req.path }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'internal error' } });
  });

  return { app, sse };
}
