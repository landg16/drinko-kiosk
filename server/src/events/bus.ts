import { EventEmitter } from 'node:events';
import type { DeviceStatus, Order, PourDoneEvent, PourFailedEvent, PourStartedEvent } from '../domain/types';

/** Everything the client can subscribe to over SSE. */
export type DomainEvents = {
  'device.status': [status: DeviceStatus];
  'order.updated': [order: Order];
  'pour.started': [event: PourStartedEvent];
  'pour.done': [event: PourDoneEvent];
  'pour.failed': [event: PourFailedEvent];
};

export class EventBus extends EventEmitter<DomainEvents> {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}
