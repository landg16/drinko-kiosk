/** Wire protocol of the Drinko board. Source of truth: docs/HARDWARE_PROTOCOL.md; keep the two in sync. */
import { z } from 'zod';

/** `Status` field of a device response. The master always sends 0. */
export enum ProtocolStatus {
  DeviceOK = 0,
  /** documented, never observed: rejections come back as DeviceBUSY */
  ProtocolError = 1,
  DeviceBUSY = 2,
}

/** `CommandType` field. Values mirror the firmware's Vending_CommandType enum. */
export enum CommandType {
  /** Drop a cup from the dispenser, then pour. Unused while cups are placed by the guest. */
  PourCap = 0,
  /** Pour into whatever cup is under the nozzle. Default for v1. */
  PourWithoutCap = 1,
  CheckTank = 2,
  /** Spelled "Rising" in the hardware doc; assumed to be a rinsing cycle. */
  Rinse = 3,
  /** Emergency stop. The only command accepted while the device is busy. */
  StopWorking = 4,
}

/** Per-channel values in a documented response `Payload`. */
export enum CommandStatus {
  PouringOK = 0,
  PouringFailedTankEmpty = 1,
  PouringFailedNoCup = 2,
  PouringFailedFlowmeterError = 3,
  PouringFailedHardwareError = 4,
  TankOK = 5,
  TankLow = 6,
}

export const CHANNEL_COUNT = 4;

/** One integer per channel. Meaning depends on the command (grams in a pour request, status in a response). */
export type Payload = [number, number, number, number];

export const EMPTY_PAYLOAD: Payload = [0, 0, 0, 0];

export interface DeviceMessage {
  Status: number;
  CommandType: number;
  Payload: Payload;
}

const int = z.number().int();

export const deviceMessageSchema = z.object({
  Status: int,
  CommandType: int,
  Payload: z.tuple([int, int, int, int]),
});

export function buildCommand(type: CommandType, payload: Payload = EMPTY_PAYLOAD): DeviceMessage {
  return { Status: 0, CommandType: type, Payload: [...payload] as Payload };
}

/** Serialize a message for the wire. "\n" after compact JSON is confirmed to work. */
export function encodeMessage(message: DeviceMessage, terminator = '\n'): string {
  return JSON.stringify(message) + terminator;
}

export type ParseResult = { ok: true; message: DeviceMessage } | { ok: false; error: string };

export function parseMessage(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${(error as Error).message}` };
  }
  const result = deviceMessageSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return { ok: false, error: issues.join('; ') };
  }
  return { ok: true, message: result.data as DeviceMessage };
}

function enumName(table: object, value: number): string {
  const name = (table as Record<number, string | undefined>)[value];
  return name ?? `Unknown(${value})`;
}

export const protocolStatusName = (value: number): string => enumName(ProtocolStatus, value);
export const commandTypeName = (value: number): string => enumName(CommandType, value);
export const commandStatusName = (value: number): string => enumName(CommandStatus, value);

/** One-line human-readable rendering of a device response, for logs. */
export function describeMessage(message: DeviceMessage): string {
  const channels = message.Payload.map(
    (value, index) => `ch${index + 1}=${value} (${commandStatusName(value)})`,
  ).join(', ');
  return (
    `Status=${message.Status} (${protocolStatusName(message.Status)}) ` +
    `CommandType=${message.CommandType} (${commandTypeName(message.CommandType)}) ` +
    `Payload=[${message.Payload.join(', ')}] -> ${channels}`
  );
}
