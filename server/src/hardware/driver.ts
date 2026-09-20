/** The seam between the kiosk and a specific board: everything above speaks channels, grams and tank statuses;
 *  each board folder (e.g. drinko-json/) implements this and registers in registry.ts. */
import type { EventEmitter } from 'node:events';
import type { DeviceCapabilities, PourFailure, TankStatus } from '../domain/types';

export interface PourRequest {
  /** grams per channel, exactly `capabilities.channelCount` long; 0 = channel not used */
  grams: number[];
  /** ask the board to drop a cup first; only meaningful when `capabilities.cupDispenser` */
  withCup: boolean;
  /** the pour must have ended within this time, or the driver rejects with DeviceTimeoutError */
  timeoutMs: number;
  /** For boards that report no result: a pour ending sooner than this is implausible and must come back as a `flowmeter` failure. */
  minDurationMs?: number;
}

export interface ChannelFailure {
  channel: number;
  failure: PourFailure;
}

export type PourOutcome =
  | { ok: true }
  | { ok: false; failure: PourFailure; detail: string; channels: ChannelFailure[] };

export type DriverEvents = {
  connected: [];
  disconnected: [reason: string];
  /** only boards with `capabilities.cupSensor` emit this */
  cup: [present: boolean];
  /** the board reported a problem outside a pour (a pump or sensor fault, an error message) */
  fault: [detail: string];
};

export interface DeviceDriver extends EventEmitter<DriverEvents> {
  /** shown in status and logs, e.g. "drinko-json/serial" */
  readonly name: string;
  readonly capabilities: DeviceCapabilities;
  readonly connected: boolean;

  /** Opens the link to the board. Rejects if it cannot; the controller retries. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** One status per channel ('unknown' without level sensing). Rejects with DeviceTimeoutError when the board is silent. */
  checkTanks(): Promise<TankStatus[]>;

  /** Resolves once the pour has ended, successfully or not. Rejects with DeviceTimeoutError (the controller then calls
   *  stop()), DeviceDisconnectedError, DeviceProtocolError or DeviceBusyError. */
  pour(request: PourRequest): Promise<PourOutcome>;

  /** Emergency stop. Must work while a pour is running. */
  stop(): Promise<void>;

  /** Cleaning cycle for the selected channels; boards without `capabilities.rinse` may reject. */
  rinse(channels: boolean[]): Promise<void>;
}
