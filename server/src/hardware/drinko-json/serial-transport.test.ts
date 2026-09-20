import { SerialPortMock } from 'serialport';
import { afterEach, describe, expect, it } from 'vitest';
import { sleep } from '../../util/sleep';
import { DeviceDisconnectedError, DeviceTimeoutError } from '../errors';
import { CommandType, buildCommand, type DeviceMessage } from './protocol';
import { SerialTransport, type SerialTransportOptions } from './serial-transport';

const PATH = '/dev/drinko-test';

/** The mock binding's port object: what the "device" reads and writes. */
interface MockDevicePort {
  emitData(data: Buffer | string): void;
  lastWrite: Buffer | null;
  recording: Buffer;
}

function setup(options: Partial<SerialTransportOptions> = {}) {
  SerialPortMock.binding.createPort(PATH, { echo: false, record: true });
  let port: SerialPortMock | undefined;
  const transport = new SerialTransport({
    path: PATH,
    openPort: (portOptions) => {
      port = new SerialPortMock({ ...portOptions, autoOpen: false });
      return port;
    },
    ...options,
  });
  return {
    transport,
    port: () => port!,
    device: () => port!.port as unknown as MockDevicePort,
  };
}

afterEach(() => {
  SerialPortMock.binding.reset();
});

describe('SerialTransport', () => {
  it('writes newline-terminated JSON and resolves with the matching reply', async () => {
    const { transport, device } = setup();
    await transport.connect();
    expect(transport.connected).toBe(true);

    const pending = transport.request(buildCommand(CommandType.CheckTank), 500);
    await sleep(20);
    expect(device().lastWrite?.toString('utf8')).toBe('{"Status":0,"CommandType":2,"Payload":[0,0,0,0]}\n');

    device().emitData('{"Status":0,"CommandType":2,"Payload":[5,5,6,5]}\r\n');
    const reply = await pending;
    expect(reply.Payload).toEqual([5, 5, 6, 5]);
    await transport.disconnect();
  });

  it('can use CRLF framing', async () => {
    const { transport, device } = setup({ terminator: '\r\n' });
    await transport.connect();
    const pending = transport.request(buildCommand(CommandType.CheckTank), 200);
    await sleep(20);
    expect(device().lastWrite?.toString('utf8')).toMatch(/\r\n$/);
    device().emitData('{"Status":0,"CommandType":2,"Payload":[5,5,5,5]}\n');
    await pending;
    await transport.disconnect();
  });

  it('times out when the device stays silent', async () => {
    const { transport } = setup();
    await transport.connect();
    await expect(transport.request(buildCommand(CommandType.CheckTank), 30)).rejects.toBeInstanceOf(
      DeviceTimeoutError,
    );
    await transport.disconnect();
  });

  it('reports messages nobody asked for as unsolicited', async () => {
    const { transport, device } = setup();
    await transport.connect();
    const seen: DeviceMessage[] = [];
    transport.on('unsolicited', (message) => seen.push(message));
    device().emitData('{"Status":0,"CommandType":4,"Payload":[0,0,0,0]}\n');
    await sleep(20);
    expect(seen).toHaveLength(1);
    expect(seen[0].CommandType).toBe(CommandType.StopWorking);
    await transport.disconnect();
  });

  it('reassembles the pretty-printed reply the real device sends, with no terminator', async () => {
    const { transport, device } = setup();
    await transport.connect();
    const pending = transport.request(buildCommand(CommandType.CheckTank), 500);
    await sleep(10);
    device().emitData('{\n\t"Status":\t0,\n\t"CommandType":\t2,\n');
    await sleep(10);
    device().emitData('\t"Payload":\t[0, 0, 0, 0]\n}');
    const reply = await pending;
    expect(reply).toEqual({ Status: 0, CommandType: 2, Payload: [0, 0, 0, 0] });
    await transport.disconnect();
  });

  it('gives a reply with a different CommandType to the only pending request', async () => {
    const { transport, device } = setup();
    await transport.connect();
    const pending = transport.request(buildCommand(CommandType.CheckTank), 500);
    await sleep(10);
    // the firmware answers a poll during a pour with the pour's CommandType
    device().emitData('{"Status":2,"CommandType":1,"Payload":[20,0,0,0]}');
    const reply = await pending;
    expect(reply.Status).toBe(2);
    expect(reply.CommandType).toBe(1);
    await transport.disconnect();
  });

  it('ignores garbage lines and keeps waiting for the real reply', async () => {
    const { transport, device } = setup();
    await transport.connect();
    const pending = transport.request(buildCommand(CommandType.CheckTank), 500);
    device().emitData('boot banner v1.2\n{"Status":0,"CommandType":2,"Payload":[5,5,5,5]}\n');
    const reply = await pending;
    expect(reply.Payload).toEqual([5, 5, 5, 5]);
    await transport.disconnect();
  });

  it('rejects pending requests and emits disconnected when the port closes', async () => {
    const { transport, port } = setup();
    await transport.connect();
    const reasons: string[] = [];
    transport.on('disconnected', (reason) => reasons.push(reason));
    const pending = transport.request(buildCommand(CommandType.PourWithoutCap, [40, 0, 0, 0]), 1000);
    await sleep(10);
    port().close();
    await expect(pending).rejects.toBeInstanceOf(DeviceDisconnectedError);
    expect(transport.connected).toBe(false);
    expect(reasons).toHaveLength(1);
  });
});
