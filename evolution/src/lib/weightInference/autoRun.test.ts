// Unit tests for runAutoChunk — focused on the Phase 1 holistic_prompt_override plumbing:
// (a) the override loaded from the session row forwards to judgePairOnce on every pair;
// (b) EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED=true causes it to be ignored even when persisted;
// (c) null override matches pre-Phase-1 behavior (default hardcoded checklist).
//
// The supabase client is mocked with a chainable builder + per-table return values. The judge
// LLM closure is injected via judgeFactory and captures the prompts it sees, so we can assert
// which prompts the override flowed into.

import { runAutoChunk, type JudgeFactory } from './autoRun';
import type { SupabaseClient } from '@supabase/supabase-js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

interface MockSessionFields {
  mode?: string;
  pair_kind?: 'article' | 'paragraph';
  judge_model?: string | null;
  judge_temperature?: number | null;
  judge_reasoning_effort?: string | null;
  auto_repeats?: number;
  holistic_prompt_override?: string | null;
}

interface MockState {
  session: MockSessionFields;
  criteria: Array<{ criteria_id: string; position: number }>;
  criteria_rows: Array<{ id: string; name: string; description: string | null; min_rating: number; max_rating: number; evaluation_guidance: unknown }>;
  comparisons: Array<{ id: string; article_a_id: string; article_b_id: string; overall_winner: string | null }>;
  dim_verdicts: Array<{ comparison_id: string }>;
  articles: Array<{ id: string; content: string }>;
  /** Side-effects: writes captured for assertions. */
  comparison_updates: Array<Record<string, unknown>>;
  dim_verdict_upserts: Array<Record<string, unknown>>;
}

/** Minimal chainable supabase mock — only the surface runAutoChunk touches. */
function makeSupabase(state: MockState): SupabaseClient {
  function builder(table: string): unknown {
    const _eq: Array<[string, unknown]> = [];
    const _in: Array<[string, unknown[]]> = [];
    let _isNull = false;
    let _updatePayload: Record<string, unknown> | undefined;
    let _upsertRows: Array<Record<string, unknown>> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {};
    api.select = (): unknown => api;
    api.eq = (col: unknown, val: unknown): unknown => {
      _eq.push([String(col), val]);
      return api;
    };
    api.is = (): unknown => {
      _isNull = true;
      return api;
    };
    api.in = (col: unknown, vals: unknown): unknown => {
      _in.push([String(col), vals as unknown[]]);
      return api;
    };
    api.single = async (): Promise<{ data: unknown; error: unknown }> => {
      if (table === 'evolution_weight_inference_sessions') {
        return { data: state.session, error: null };
      }
      return { data: null, error: { message: 'no row' } };
    };
    api.then = async (onFulfilled: (v: { data: unknown; error: unknown }) => unknown): Promise<unknown> => {
      if (table === 'evolution_weight_inference_criteria') {
        return onFulfilled({ data: state.criteria, error: null });
      }
      if (table === 'evolution_criteria') {
        return onFulfilled({ data: state.criteria_rows, error: null });
      }
      if (table === 'evolution_weight_inference_comparisons') {
        if (_updatePayload) {
          state.comparison_updates.push({ ..._updatePayload, _eq });
          return onFulfilled({ data: null, error: null });
        }
        return onFulfilled({ data: state.comparisons, error: null });
      }
      if (table === 'evolution_weight_inference_dimension_verdicts') {
        if (_upsertRows) {
          for (const row of _upsertRows) state.dim_verdict_upserts.push(row);
          return onFulfilled({ data: null, error: null });
        }
        const ids = (_in.find(([c]) => c === 'comparison_id')?.[1] ?? []) as string[];
        const rows = state.dim_verdicts.filter((d) => ids.includes(d.comparison_id));
        return onFulfilled({ data: rows, error: null });
      }
      if (table === 'evolution_weight_inference_articles') {
        const ids = (_in.find(([c]) => c === 'id')?.[1] ?? []) as string[];
        const arts = state.articles.filter((a) => ids.includes(a.id));
        return onFulfilled({ data: arts, error: null });
      }
      return onFulfilled({ data: null, error: { message: `unhandled table ${table}` } });
    };
    api.update = (payload: unknown): unknown => {
      _updatePayload = payload as Record<string, unknown>;
      return api;
    };
    api.upsert = (rows: unknown): unknown => {
      _upsertRows = rows as Array<Record<string, unknown>>;
      return api;
    };
    api.order = (): unknown => api;
    api.limit = (): unknown => api;
    api.maybeSingle = async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null });
    void _isNull;
    return api;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

function makeBaselineState(holisticOverride: string | null = null): MockState {
  return {
    session: {
      mode: 'auto',
      pair_kind: 'article',
      judge_model: 'google/gemini-2.5-flash-lite',
      judge_temperature: 0,
      judge_reasoning_effort: null,
      auto_repeats: 1,
      holistic_prompt_override: holisticOverride,
    },
    criteria: [
      { criteria_id: 'cid-1', position: 0 },
      { criteria_id: 'cid-2', position: 1 },
    ],
    criteria_rows: [
      { id: 'cid-1', name: 'c1', description: 'desc-1', min_rating: 1, max_rating: 10, evaluation_guidance: null },
      { id: 'cid-2', name: 'c2', description: 'desc-2', min_rating: 1, max_rating: 10, evaluation_guidance: null },
    ],
    comparisons: [
      { id: 'comp-1', article_a_id: 'art-A', article_b_id: 'art-B', overall_winner: null },
    ],
    dim_verdicts: [],
    articles: [
      // AAA in content lets the content-aware mock judge consistently prefer textA across
      // both passes (so the 2-pass reversal aggregates to 'a', not 'tie').
      { id: 'art-A', content: 'Article AAA body' },
      { id: 'art-B', content: 'Article BBB body' },
    ],
    comparison_updates: [],
    dim_verdict_upserts: [],
  };
}

interface CapturedJudgeCall {
  prompt: string;
}

/** A judgeFactory that captures every prompt sent and returns a content-aware verdict. The
 *  mock prefers whichever text body contains "AAA" — so the canonical winner is consistent
 *  across forward and reverse passes (the 2-pass reversal aggregates to a decisive 'a'). */
function makeCapturingFactory(captured: CapturedJudgeCall[]): JudgeFactory {
  return (_model, _temp, _reasoning, costSink) => async (prompt: string) => {
    captured.push({ prompt });
    costSink.usd += 0.0001;
    const pick = prompt.indexOf('AAA') < prompt.indexOf('BBB') ? 'A' : 'B';
    // Per-dimension rubric prompts contain "Dimensions:" header + dim names; return one
    // verdict line per dimension for those, and a single token for the holistic prompts.
    if (prompt.includes('Dimensions:') || /^c[12]:/m.test(prompt)) {
      return ['c1', 'c2'].map((n) => `${n}: ${pick}`).join('\n');
    }
    return pick;
  };
}

describe('runAutoChunk — Phase 1 holistic_prompt_override plumbing', () => {
  it('forwards a non-empty override into every holistic prompt of every pair', async () => {
    const OVERRIDE = '## Custom Eval\nDecide which version is better overall.';
    const state = makeBaselineState(OVERRIDE);
    const db = makeSupabase(state);
    const captured: CapturedJudgeCall[] = [];
    delete process.env.EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED;
    await runAutoChunk(db, SESSION_ID, makeCapturingFactory(captured), { usd: 0 });
    const holisticPrompts = captured.filter((c) => c.prompt.includes('## Custom Eval'));
    // 2 holistic calls per pair × 1 pair × 1 repeat = 2.
    expect(holisticPrompts).toHaveLength(2);
    // The default hardcoded checklist is NOT used.
    expect(captured.every((c) => !c.prompt.includes('Clarity and readability'))).toBe(true);
  });

  it('null override falls back to the default hardcoded checklist (pre-Phase-1 behavior)', async () => {
    const state = makeBaselineState(null);
    const db = makeSupabase(state);
    const captured: CapturedJudgeCall[] = [];
    delete process.env.EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED;
    await runAutoChunk(db, SESSION_ID, makeCapturingFactory(captured), { usd: 0 });
    const defaultPrompts = captured.filter((c) => c.prompt.includes('Clarity and readability'));
    expect(defaultPrompts).toHaveLength(2);
  });

  it('EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED=true forces the override to be ignored', async () => {
    const OVERRIDE = '## Custom Eval\nDecide which version is better overall.';
    const state = makeBaselineState(OVERRIDE);
    const db = makeSupabase(state);
    const captured: CapturedJudgeCall[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED = 'true';
    try {
      await runAutoChunk(db, SESSION_ID, makeCapturingFactory(captured), { usd: 0 });
      // The override should NOT appear in any prompt.
      expect(captured.every((c) => !c.prompt.includes('## Custom Eval'))).toBe(true);
      // The default checklist DOES appear (override was suppressed).
      const defaultPrompts = captured.filter((c) => c.prompt.includes('Clarity and readability'));
      expect(defaultPrompts).toHaveLength(2);
      // Exactly one warn log per chunk.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain('EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED');
    } finally {
      warnSpy.mockRestore();
      delete process.env.EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED;
    }
  });

  it('auto_repeats=3 folds 3 results into one persisted comparison with cross-repeat confidence', async () => {
    const state = makeBaselineState(null);
    state.session.auto_repeats = 3;
    const db = makeSupabase(state);
    const captured: CapturedJudgeCall[] = [];
    delete process.env.EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED;
    await runAutoChunk(db, SESSION_ID, makeCapturingFactory(captured), { usd: 0 });
    // 3 repeats × (2 holistic + 2 rubric) = 12 LLM calls for 1 pair.
    expect(captured).toHaveLength(12);
    // Exactly 1 persisted comparison update with confidence = 1.0 (all 3 repeats agree).
    expect(state.comparison_updates).toHaveLength(1);
    expect(state.comparison_updates[0]!.confidence).toBeCloseTo(1, 5);
    expect(state.comparison_updates[0]!.overall_winner).toBe('a');
  });
});
