import { EventEmitter } from 'node:events';
import type { Logger } from '../../logger';
import { DeviceDisconnectedError, DeviceTimeoutError } from '../errors';
import { JsonObjectExtractor } from './framing';
import { commandTypeName, encodeMessage, parseMessage, type DeviceMessage } from './protocol';
import type { DeviceTransport, TransportEvents } from './transport';

/** The part of a serialport stream we use; SerialPort and SerialPortMock both satisfy it. */
export interface PortLike {
  readonly isOpen: boolean;
  open(callback: (error: Error | null) => void): void;
  close(callback?: (error: Error | null) => void): void;
  write(data: string, callback?: (error: Error | null | undefined) => void): boolean;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (error?: Error | null) => void): unknown;
}

export type PortFactory = (options: { path: string; baudRate: number }) => PortLike;

export interface SerialTransportOptions {
  path: string;
  baudRate?: number;
  /** what follows each JSON message we send; "\n" confirmed on the device on 20 Sep 2026 */
  terminator?: '\n' | '\r\n';
  openPort: PortFactory;
  logger?: Logger;
}

interface Pending {
  resolve: (message: DeviceMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** JSON over a serial port: compact JSON + terminator out, brace-matched framing in (the board pretty-prints and sends
 *  no terminator). Replies match requests by CommandType, so StopWorking can coexist with a pending pour. */
export class SerialTransport extends EventEmitter<TransportEvents> implements DeviceTransport {
  readonly kind = 'serial' as const;
  private port: PortLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly extractor = new JsonObjectExtractor();

  constructor(private readonly options: SerialTransportOptions) {
    super();
  }

  get connected(): boolean {
    return this.port?.isOpen ?? false;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    const port = this.options.openPort({ path: this.options.path, baudRate: this.options.baudRate ?? 115200 });
    return new Promise((resolve, reject) => {
      port.open((error) => {
        if (error) {
          reject(error);
          return;
        }
        this.port = port;
        this.extractor.reset();
        port.on('data', (chunk) => this.onData(chunk));
        port.on('error', (error) => this.options.logger?.warn({ err: error }, 'serial port error'));
        port.on('close', (error) => this.onClose(error?.message ?? 'port closed'));
        this.emit('connected');
        resolve();
      });
    });
  }

  disconnect(): Promise<void> {
    const port = this.port;
    if (!port || !port.isOpen) {
      this.port = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => port.close(() => resolve()));
  }

  request(message: DeviceMessage, timeoutMs: number): Promise<DeviceMessage> {
    const port = this.port;
    if (!port || !port.isOpen) return Promise.reject(new DeviceDisconnectedError());
    const name = commandTypeName(message.CommandType);
    if (this.pending.has(message.CommandType)) {
      return Promise.reject(new Error(`a ${name} request is already waiting for its reply`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.CommandType);
        reject(new DeviceTimeoutError(`no reply to ${name} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(message.CommandType, { resolve, reject, timer });

      const text = encodeMessage(message, this.options.terminator ?? '\n');
      this.options.logger?.debug({ tx: text.trim() }, 'serial tx');
      port.write(text, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(message.CommandType);
        reject(error);
      });
    });
  }

  private onData(chunk: Buffer): void {
    for (const text of this.extractor.feed(chunk.toString('latin1'))) this.onObject(text);
  }

  private onObject(text: string): void {
    const parsed = parseMessage(text);
    this.options.logger?.debug({ rx: text.replace(/\s+/g, ' ') }, 'serial rx');
    if (!parsed.ok) {
      this.options.logger?.warn({ text, error: parsed.error }, 'unparseable message from device');
      return;
    }
    let pending = this.pending.get(parsed.message.CommandType);
    if (pending) {
      this.pending.delete(parsed.message.CommandType);
    } else if (this.pending.size === 1) {
      // A rejected or unknown request is answered with the CommandType of the command the device
      // is running (or last ran), not the one we sent. With one request in flight it is ours.
      const [[type, only]] = this.pending.entries();
      this.pending.delete(type);
      pending = only;
    }
    if (!pending) {
      this.emit('unsolicited', parsed.message);
      return;
    }
    clearTimeout(pending.timer);
    pending.resolve(parsed.message);
  }

  private onClose(reason: string): void {
    this.port = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DeviceDisconnectedError(`disconnected while waiting for a reply: ${reason}`));
    }
    this.pending.clear();
    this.emit('disconnected', reason);
  }
}
