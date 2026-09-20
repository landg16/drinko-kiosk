// Serial probe for the Drinko board. Read-only unless --pour (with --i-placed-a-cup) or --stop is given; --help lists options.
// Every byte in both directions is printed and appended to server/probe-logs/<timestamp>.log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SerialPort } from 'serialport';
import { JsonObjectExtractor } from '../hardware/drinko-json/framing';
import {
  CommandType,
  DeviceMessage,
  Payload,
  buildCommand,
  commandStatusName,
  describeMessage,
  encodeMessage,
  parseMessage,
} from '../hardware/drinko-json/protocol';

const BAUD_RATE = 115200;
const TERMINATORS: Record<string, string> = { lf: '\n', crlf: '\r\n', none: '' };
const USAGE = `Usage:
  pnpm probe                                  list serial ports
  pnpm probe --port <path> [options]          probe the device on <path>

Options:
  --terminator lf|crlf|none   framing to use (default: try lf, then crlf, then none)
  --all-framings              keep trying every framing even after one works
  --timeout <ms>              wait this long for a reply (default 3000)
  --listen <ms>               listen for unsolicited data after opening (default 2000)
  --raw '<json>'              send this text instead of CheckTank
  --pour <channel>:<grams>    after CheckTank, PourWithoutCap that much from that channel (1-4)
  --i-placed-a-cup            required with --pour; confirms a cup is under the nozzle
  --stop                      send StopWorking only`;

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    port: { type: 'string' },
    terminator: { type: 'string' },
    timeout: { type: 'string', default: '3000' },
    listen: { type: 'string', default: '2000' },
    raw: { type: 'string' },
    pour: { type: 'string' },
    stop: { type: 'boolean', default: false },
    'i-placed-a-cup': { type: 'boolean', default: false },
    'all-framings': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

// ---------- logging ----------

const startedAt = Date.now();
const logDir = join(__dirname, '..', '..', 'probe-logs');
const logFile = join(logDir, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

function log(line: string): void {
  const stamped = `[+${String(Date.now() - startedAt).padStart(6, ' ')} ms] ${line}`;
  console.log(stamped);
  appendFileSync(logFile, `${stamped}\n`);
}

function visible(text: string): string {
  return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\0/g, '\\0');
}

function hex(buffer: Buffer): string {
  return buffer.toString('hex').replace(/(..)/g, '$1 ').trim();
}

// ---------- serial wrapper ----------

class Probe {
  private readonly port: SerialPort;
  private readonly extractor = new JsonObjectExtractor();
  private readonly ready: string[] = [];
  private waiter: ((text: string | undefined) => void) | undefined;

  constructor(path: string) {
    this.port = new SerialPort({
      path,
      baudRate: BAUD_RATE,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    });
    this.port.on('data', (chunk: Buffer) => this.onData(chunk));
    this.port.on('error', (error: Error) => log(`PORT ERROR ${error.message}`));
    this.port.on('close', () => log('PORT CLOSED'));
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.open((error) => (error ? reject(error) : resolve()));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }

  send(text: string): Promise<void> {
    log(`TX  ${hex(Buffer.from(text, 'latin1'))}  |${visible(text)}|`);
    return new Promise((resolve, reject) => {
      this.port.write(text, (writeError) => {
        if (writeError) {
          reject(writeError);
          return;
        }
        this.port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
      });
    });
  }

  /** Resolves with the next complete JSON object, or undefined after timeoutMs. */
  next(timeoutMs: number): Promise<string | undefined> {
    const queued = this.ready.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        resolve(undefined);
      }, timeoutMs);
      this.waiter = (text) => {
        clearTimeout(timer);
        this.waiter = undefined;
        resolve(text);
      };
    });
  }

  /** Forget anything received so far, so a reply cannot be confused with an earlier one. */
  discard(): void {
    this.ready.length = 0;
    this.extractor.reset();
  }

  private onData(chunk: Buffer): void {
    const text = chunk.toString('latin1');
    log(`RX  ${hex(chunk)}  |${visible(text)}|`);
    // Brace matching, so the probe works whatever the device uses as a terminator.
    for (const object of this.extractor.feed(text)) {
      if (this.waiter) this.waiter(object);
      else this.ready.push(object);
    }
  }
}

// ---------- steps ----------

async function listPorts(): Promise<void> {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    log('No serial ports found. Is the device plugged in and powered?');
    return;
  }
  log('Serial ports:');
  for (const port of ports) {
    log(
      `  ${port.path}  ${port.manufacturer ?? ''}  vid=${port.vendorId ?? '-'} pid=${port.productId ?? '-'}  ${port.pnpId ?? ''}`,
    );
  }
}

interface Reply {
  message: DeviceMessage | undefined;
  elapsedMs: number;
}

async function request(
  probe: Probe,
  message: DeviceMessage,
  terminator: string,
  timeoutMs: number,
): Promise<Reply> {
  probe.discard();
  const sentAt = Date.now();
  await probe.send(encodeMessage(message, terminator));
  const text = await probe.next(timeoutMs);
  const elapsedMs = Date.now() - sentAt;
  if (text === undefined) {
    log(`    no reply within ${timeoutMs} ms`);
    return { message: undefined, elapsedMs };
  }
  const parsed = parseMessage(text);
  if (!parsed.ok) {
    log(`    reply after ${elapsedMs} ms is not a valid message: ${parsed.error}`);
    return { message: undefined, elapsedMs };
  }
  log(`    reply after ${elapsedMs} ms: ${describeMessage(parsed.message)}`);
  return { message: parsed.message, elapsedMs };
}

function parsePourArg(value: string): { channel: number; grams: number } {
  const match = /^([1-4]):(\d{1,3})$/.exec(value);
  if (!match) throw new Error('--pour expects <channel 1-4>:<grams>, for example --pour 1:20');
  const grams = Number(match[2]);
  if (grams < 1 || grams > 250) throw new Error('grams must be between 1 and 250 for a test pour');
  return { channel: Number(match[1]), grams };
}

async function main(): Promise<void> {
  if (args.help) {
    console.log(USAGE);
    return;
  }
  mkdirSync(logDir, { recursive: true });

  if (!args.port) {
    await listPorts();
    console.log('\nPass --port <path> to probe a device. --help for options.');
    return;
  }

  const timeoutMs = Number(args.timeout);
  const listenMs = Number(args.listen);
  if (!Number.isFinite(timeoutMs) || !Number.isFinite(listenMs)) {
    throw new Error('--timeout and --listen must be numbers (milliseconds)');
  }
  if (args.terminator !== undefined && TERMINATORS[args.terminator] === undefined) {
    throw new Error(`unknown terminator "${args.terminator}" (use lf, crlf or none)`);
  }
  const pour = args.pour ? parsePourArg(args.pour) : undefined;
  if (pour && !args['i-placed-a-cup']) {
    throw new Error('Refusing to pour: place a cup under the nozzle, then add --i-placed-a-cup');
  }

  log(`Log file: ${logFile}`);
  const probe = new Probe(args.port);
  let terminator = TERMINATORS[args.terminator ?? 'lf'];
  let stopping = false;

  process.on('SIGINT', async () => {
    if (stopping) process.exit(130);
    stopping = true;
    log('SIGINT: sending StopWorking and closing the port');
    try {
      await probe.send(encodeMessage(buildCommand(CommandType.StopWorking), terminator));
    } catch (error) {
      log(`    could not send StopWorking: ${(error as Error).message}`);
    }
    await probe.close();
    process.exit(130);
  });

  await probe.open();
  log(`OPEN ${args.port} @ ${BAUD_RATE} 8N1`);

  try {
    // 1. Does the device talk on its own? (boot banner, status spam)
    log(`Listening ${listenMs} ms for unsolicited data...`);
    const unsolicited = await probe.next(listenMs);
    log(unsolicited === undefined ? '    nothing unsolicited' : `    unsolicited message: ${unsolicited}`);

    if (args.raw) {
      log(`Sending raw text with terminator "${args.terminator ?? 'lf'}"`);
      probe.discard();
      await probe.send(args.raw + terminator);
      const reply = await probe.next(timeoutMs);
      log(reply === undefined ? `    no reply within ${timeoutMs} ms` : `    reply: ${reply}`);
      return;
    }

    if (args.stop) {
      log('Sending StopWorking');
      await request(probe, buildCommand(CommandType.StopWorking), terminator, timeoutMs);
      return;
    }

    // 2. CheckTank with each candidate framing until one gets a reply.
    const candidates = args.terminator ? [args.terminator] : ['lf', 'crlf', 'none'];
    let working: string | undefined;
    for (const name of candidates) {
      log(`CheckTank with terminator "${name}"`);
      const reply = await request(probe, buildCommand(CommandType.CheckTank), TERMINATORS[name], timeoutMs);
      if (reply.message) {
        working = name;
        terminator = TERMINATORS[name];
        if (!args['all-framings']) break;
      }
    }
    if (!working) {
      log('RESULT no reply to CheckTank with any framing. Check the port, baud rate, power, and the RX lines above.');
      return;
    }
    log(`RESULT framing "${working}" works; the CheckTank reply above shows the tank status format`);

    // 3. Optional single test pour, timed, to learn flow rate and response shape.
    if (pour) {
      const payload: Payload = [0, 0, 0, 0];
      payload[pour.channel - 1] = pour.grams;
      const pourTimeoutMs = Math.max(timeoutMs, 60_000);
      log(
        `PourWithoutCap ${pour.grams} g from channel ${pour.channel} (waiting up to ${pourTimeoutMs} ms; Ctrl+C sends StopWorking)`,
      );
      const reply = await request(
        probe,
        buildCommand(CommandType.PourWithoutCap, payload),
        terminator,
        pourTimeoutMs,
      );
      if (!reply.message) {
        log('No reply to the pour: sending StopWorking as a precaution');
        await request(probe, buildCommand(CommandType.StopWorking), terminator, timeoutMs);
        return;
      }
      const status = commandStatusName(reply.message.Payload[pour.channel - 1]);
      const gramsPerSecond = (pour.grams / (reply.elapsedMs / 1000)).toFixed(1);
      log(
        `RESULT pour of ${pour.grams} g took ${reply.elapsedMs} ms (~${gramsPerSecond} g/s including overhead); channel status ${status}`,
      );
    }
  } finally {
    await probe.close();
  }
}

main().catch((error: Error) => {
  console.error(`ERROR ${error.message}`);
  process.exit(1);
});
