import type { Request, Response } from 'express';
import type { DeviceStatus, Order } from '../domain/types';
import type { EventBus } from '../events/bus';

function format(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Server-sent events: every domain event goes to every connected client, with a snapshot on connect. */
export class SseHub {
  private readonly clients = new Set<Response>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    bus: EventBus,
    private readonly snapshot: () => { device: DeviceStatus; order: Order | null },
  ) {
    bus.on('device.status', (status) => this.broadcast('device.status', status));
    bus.on('order.updated', (order) => this.broadcast('order.updated', order));
    bus.on('pour.started', (event) => this.broadcast('pour.started', event));
    bus.on('pour.done', (event) => this.broadcast('pour.done', event));
    bus.on('pour.failed', (event) => this.broadcast('pour.failed', event));
    this.heartbeat = setInterval(() => this.writeRaw(': ping\n\n'), 15_000);
    this.heartbeat.unref();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  readonly handle = (req: Request, res: Response): void => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const { device, order } = this.snapshot();
    res.write(format('device.status', device));
    if (order) res.write(format('order.updated', order));

    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  };

  broadcast(event: string, data: unknown): void {
    this.writeRaw(format(event, data));
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private writeRaw(chunk: string): void {
    for (const res of this.clients) res.write(chunk);
  }
}
