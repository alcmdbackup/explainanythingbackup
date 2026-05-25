// SSE event buffer — accumulates raw bytes from a streaming response and
// splits them on the `\n\n` event terminator. Holds any trailing partial
// event in the buffer until the next chunk completes it.
//
// Replaces the per-chunk `chunk.split('\n')` parser that silently dropped
// any event whose payload crossed a network-chunk boundary (notably the
// `complete` event carrying the full article markdown).

export interface SseEventBuffer {
  push(chunk: string): string[];
}

export function createSseEventBuffer(): SseEventBuffer {
  let buf = '';
  return {
    push(chunk: string): string[] {
      buf += chunk;
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      return events;
    },
  };
}

// Extract the JSON payload from an SSE event's `data: ` line, if present.
// Returns `null` for keep-alive comments, `event:`-only lines, or unparseable
// payloads. Caller decides how to handle null (typically: skip).
export function parseSseDataLine<T = unknown>(event: string): T | null {
  const dataLine = event.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(6)) as T;
  } catch {
    return null;
  }
}
