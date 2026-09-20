/** API contract types shared with the client; move to packages/shared with the client refactor. */
import type { Localized } from '../config/schema';

export type { Localized };

export type SizeId = 'single' | 'double';
export type CupSize = 'large' | 'small';
export type TankStatus = 'ok' | 'low' | 'unknown';

export interface RecipeLine {
  ingredient: string;
  ml: number;
}

export interface MenuSize {
  price: number;
  recipe: RecipeLine[];
  available: boolean;
}

export interface MenuDrink {
  id: string;
  name: Localized;
  category: string;
  strength: number;
  cup: CupSize;
  ingredients: string[];
  sizes: { single: MenuSize; double?: MenuSize };
  available: boolean;
}

export interface MenuIngredient {
  id: string;
  name: Localized;
  color: string;
  abv: number;
  channel: number | null;
  tank: TankStatus;
}

export interface MenuCategory {
  id: string;
  name: Localized;
}

export interface Menu {
  currency: string;
  maxPoursPerOrder: number;
  categories: MenuCategory[];
  ingredients: MenuIngredient[];
  drinks: MenuDrink[];
}

export type DeviceState = 'disconnected' | 'idle' | 'busy' | 'error';

/** Why the device is in error: `unresponsive` clears itself when the board answers again, `fault` stays until staff clear it. */
export type DeviceErrorKind = 'unresponsive' | 'fault';

/** What the connected board can do. Drivers declare it; the server and the UI adapt to it. */
export interface DeviceCapabilities {
  /** liquid channels on the board; config.channels must have exactly this many entries */
  channelCount: number;
  /** checkTanks reports real levels */
  tankLevels: boolean;
  /** the board knows whether a cup is under the nozzle (the UI can skip the "tap Pour" step) */
  cupSensor: boolean;
  /** the board can drop a cup itself */
  cupDispenser: boolean;
  rinse: boolean;
}

export interface DeviceStatus {
  /** driver name, e.g. "drinko-json/serial" */
  driver: string;
  capabilities: DeviceCapabilities;
  connected: boolean;
  state: DeviceState;
  /** set while state is `error` */
  errorKind: DeviceErrorKind | null;
  tanks: TankStatus[];
  lastError: string | null;
  lastTankCheckAt: string | null;
}

export type OrderStatus =
  | 'created'
  | 'paying'
  | 'awaiting_cup'
  | 'pouring'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'abandoned';

export type PourStatus = 'pending' | 'pouring' | 'done' | 'failed' | 'skipped';

export type PourFailure =
  | 'tank_empty'
  | 'no_cup'
  | 'flowmeter'
  | 'hardware'
  | 'timeout'
  | 'device_offline'
  | 'protocol'
  | 'busy';

export interface OrderItemInput {
  drinkId: string;
  size: SizeId;
  quantity: number;
}

export interface OrderItem extends OrderItemInput {
  name: Localized;
  unitPrice: number;
  lineTotal: number;
}

/** One cup. An order with quantity 2 of a drink has two pours. */
export interface Pour {
  index: number;
  drinkId: string;
  name: Localized;
  size: SizeId;
  cup: CupSize;
  /** grams per channel, one entry per board channel */
  grams: number[];
  expectedMs: number;
  status: PourStatus;
  failure: PourFailure | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Order {
  id: string;
  /** short daily sequence number for staff ("order #17") */
  number: number;
  status: OrderStatus;
  items: OrderItem[];
  pours: Pour[];
  /** index into pours while awaiting_cup or pouring */
  currentPour: number | null;
  total: number;
  currency: string;
  paymentReference: string | null;
  failure: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface PourStartedEvent {
  orderId: string;
  pourIndex: number;
  expectedMs: number;
}

export interface PourDoneEvent {
  orderId: string;
  pourIndex: number;
}

export interface PourFailedEvent {
  orderId: string;
  pourIndex: number;
  failure: PourFailure;
}
