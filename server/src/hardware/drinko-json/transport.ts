import type { EventEmitter } from 'node:events';
import type { DeviceMessage } from './protocol';

export type TransportEvents = {
  connected: [];
  disconnected: [reason: string];
  unsolicited: [message: DeviceMessage];
};

/** Wire level of the Drinko JSON protocol: one request, one reply. DrinkoJsonDriver adds the semantics. */
export interface DeviceTransport extends EventEmitter<TransportEvents> {
  readonly kind: 'serial' | 'mock';
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Rejects with DeviceTimeoutError or DeviceDisconnectedError (hardware/errors.ts). */
  request(message: DeviceMessage, timeoutMs: number): Promise<DeviceMessage>;
}
