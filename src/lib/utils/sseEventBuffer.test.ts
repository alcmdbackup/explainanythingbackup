// Unit tests for the SSE event buffer that fixes the chunk-boundary bug
// in src/app/results/page.tsx (hotfix/sse_client_parser_chunk_boundary_20260524).

import { createSseEventBuffer, parseSseDataLine } from './sseEventBuffer';

describe('createSseEventBuffer', () => {
  it('returns no events when a chunk contains no terminator', () => {
    const buf = createSseEventBuffer();
    expect(buf.push('data: {"type":"content","content":"hi"')).toEqual([]);
  });

  it('emits a single event once the terminator arrives', () => {
    const buf = createSseEventBuffer();
    buf.push('event: content\ndata: {"type":"content","content":"hi"}');
    const events = buf.push('\n\nevent: con');
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"content":"hi"');
  });

  it('joins data across multiple chunks split mid-payload', () => {
    const buf = createSseEventBuffer();
    // `complete` event payload split into three arbitrary chunks.
    buf.push('event: complete\ndata: {"type":"comp');
    buf.push('lete","result":{"explanationId":');
    const events = buf.push('42,"sources":[]}}\n\n');
    expect(events).toHaveLength(1);
    const parsed = parseSseDataLine<{ type: string; result: { explanationId: number } }>(events[0]!);
    expect(parsed?.type).toBe('complete');
    expect(parsed?.result.explanationId).toBe(42);
  });

  it('emits multiple events present in one chunk', () => {
    const buf = createSseEventBuffer();
    const events = buf.push(
      'event: message\ndata: {"type":"streaming_start"}\n\nevent: content\ndata: {"type":"content","content":"a"}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(parseSseDataLine<{ type: string }>(events[0]!)?.type).toBe('streaming_start');
    expect(parseSseDataLine<{ type: string }>(events[1]!)?.type).toBe('content');
  });

  it('preserves a trailing partial event for the next chunk', () => {
    const buf = createSseEventBuffer();
    const first = buf.push('event: a\ndata: {"i":1}\n\nevent: b\ndata: {"i":');
    expect(first).toHaveLength(1);
    const second = buf.push('2}\n\n');
    expect(second).toHaveLength(1);
    expect(parseSseDataLine<{ i: number }>(second[0]!)?.i).toBe(2);
  });
});

describe('parseSseDataLine', () => {
  it('returns parsed JSON for a well-formed event', () => {
    expect(parseSseDataLine('event: x\ndata: {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null when no data line is present (event:-only or comment)', () => {
    expect(parseSseDataLine('event: ping')).toBeNull();
    expect(parseSseDataLine(': keep-alive comment')).toBeNull();
  });

  it('returns null on malformed JSON instead of throwing', () => {
    expect(parseSseDataLine('data: {not json')).toBeNull();
  });

  it('skips event: lines and picks the data: line', () => {
    expect(parseSseDataLine('event: complete\ndata: {"done":true}')).toEqual({ done: true });
  });
});
