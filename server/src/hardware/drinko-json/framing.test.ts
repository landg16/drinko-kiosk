import { describe, expect, it } from 'vitest';
import { JsonObjectExtractor } from './framing';

const DEVICE_REPLY = '{\n\t"Status":\t0,\n\t"CommandType":\t2,\n\t"Payload":\t[0, 0, 0, 0]\n}';

describe('JsonObjectExtractor', () => {
  it('extracts a compact object with a trailing newline', () => {
    const extractor = new JsonObjectExtractor();
    expect(extractor.feed('{"Status":0,"CommandType":2,"Payload":[5,5,6,5]}\r\n')).toEqual([
      '{"Status":0,"CommandType":2,"Payload":[5,5,6,5]}',
    ]);
  });

  it('reassembles the pretty-printed device reply without a terminator, across chunks', () => {
    const extractor = new JsonObjectExtractor();
    expect(extractor.feed(DEVICE_REPLY.slice(0, 12))).toEqual([]);
    expect(extractor.feed(DEVICE_REPLY.slice(12, 40))).toEqual([]);
    expect(extractor.feed(DEVICE_REPLY.slice(40))).toEqual([DEVICE_REPLY]);
    expect(JSON.parse(DEVICE_REPLY)).toMatchObject({ CommandType: 2 });
  });

  it('drops noise before and between objects', () => {
    const extractor = new JsonObjectExtractor();
    expect(extractor.feed('boot v1.2\n{"a":1}\r\ngarbage{"b":2}')).toEqual(['{"a":1}', '{"b":2}']);
    expect(extractor.feed('trailing noise with no object')).toEqual([]);
  });

  it('ignores braces inside strings', () => {
    const extractor = new JsonObjectExtractor();
    expect(extractor.feed('{"s":"}{\\"{"}')).toEqual(['{"s":"}{\\"{"}']);
  });

  it('handles nested objects', () => {
    const extractor = new JsonObjectExtractor();
    expect(extractor.feed('{"a":{"b":[1,{"c":2}]}}')).toEqual(['{"a":{"b":[1,{"c":2}]}}']);
  });

  it('recovers from a runaway unterminated object', () => {
    const extractor = new JsonObjectExtractor(100);
    expect(extractor.feed('{' + 'x'.repeat(200))).toEqual([]);
    expect(extractor.feed('{"ok":true}')).toEqual(['{"ok":true}']);
  });
});
