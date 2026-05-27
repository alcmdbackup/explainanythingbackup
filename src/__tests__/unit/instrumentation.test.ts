// Unit tests for the OTel withActiveSpan helper added in Phase 1 of
// rename_agents_subagents_evolution_20260508. The helper auto-nests child spans
// under their parent's context via AsyncLocalStorageContextManager and falls back
// to a no-op span when appTracer is null (FAST_DEV mode + test environment).

import { withActiveSpan } from '../../../instrumentation';

describe('withActiveSpan (FAST_DEV / test-environment branch)', () => {
  // In the test environment appTracer is never initialized (register() requires
  // Next.js runtime context), so withActiveSpan exercises its no-op branch:
  // returns fn(noopSpan) directly, no tracer.startActiveSpan call.

  it('returns the result of fn synchronously through Promise resolution', async () => {
    const result = await withActiveSpan('subagent.test', { 'subagent.path': 'test' }, async () => 42);
    expect(result).toBe(42);
  });

  it('passes a span object to fn that supports the Span surface', async () => {
    let spanRef: { setAttribute?: unknown; setAttributes?: unknown; recordException?: unknown; setStatus?: unknown; end?: unknown; isRecording?: unknown } | null = null;
    await withActiveSpan('subagent.test', {}, async (span) => {
      spanRef = span as unknown as typeof spanRef;
      return null;
    });
    expect(spanRef).not.toBeNull();
    const span = spanRef as unknown as Record<string, () => boolean>;
    expect(typeof span['setAttribute']).toBe('function');
    expect(typeof span['setAttributes']).toBe('function');
    expect(typeof span['recordException']).toBe('function');
    expect(typeof span['setStatus']).toBe('function');
    expect(typeof span['end']).toBe('function');
    expect(typeof span['isRecording']).toBe('function');
    expect(span['isRecording']!()).toBe(false);
  });

  it('propagates errors from fn', async () => {
    await expect(
      withActiveSpan('subagent.test', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('handles nested withActiveSpan calls without crashing', async () => {
    const result = await withActiveSpan('agent.outer', { 'subagent.path': 'outer' }, async () => {
      return withActiveSpan('subagent.inner', { 'subagent.path': 'outer.inner' }, async () => {
        return 'nested-ok';
      });
    });
    expect(result).toBe('nested-ok');
  });

  it('handles concurrent calls inside Promise.allSettled (parallel-context invariant)', async () => {
    // Sibling agents under Promise.allSettled each get their own AsyncLocalStorage slot.
    // In FAST_DEV/test-env (no real tracer), the noop path doesn't manage context — but
    // the call shape itself must be safe under parallel dispatch.
    const results = await Promise.allSettled([
      withActiveSpan('agent.A', { 'subagent.path': 'A' }, async () => 'A-result'),
      withActiveSpan('agent.B', { 'subagent.path': 'B' }, async () => 'B-result'),
      withActiveSpan('agent.C', { 'subagent.path': 'C' }, async () => 'C-result'),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
    expect(fulfilled.map((r) => r.value).sort()).toEqual(['A-result', 'B-result', 'C-result']);
  });
});
