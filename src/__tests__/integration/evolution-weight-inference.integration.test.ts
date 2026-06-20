// Integration tests for weight-inference server actions against real Supabase: session
// creation (pool seeding + pair materialization), server-derived rater_id, verdict
// persistence (canonical round-trip), the fit, export-to-rubric, and the kill switch.
// Filename is `evolution-` prefixed so it runs under test:integration:evolution. Skips
// when the weight-inference tables aren't migrated yet (CI applies them first).

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionTablesExist, cleanupEvolutionData } from '@evolution/testing/evolution-test-helpers';

// Mock the adminAction infra so the wrapped actions are callable in node with the REAL
// integration client (set in beforeAll). rater_id resolves from this mocked requireAdmin.
jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue('test-admin') }));
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('next/headers', () => ({ headers: jest.fn().mockResolvedValue({ get: () => null }) }));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import {
  createWeightInferenceSessionAction,
  getNextPairAction,
  recordOverallVerdictAction,
  recordDimensionVerdictsAction,
  getWeightInferenceFitAction,
  exportWeightInferenceRubricAction,
} from '@evolution/services/weightInferenceActions';
import { runAutoChunk, type JudgeFactory } from '@evolution/lib/weightInference/autoRun';

const TS = Date.now();
const PROMPT_TEXT = `[TEST_EVO] wi-topic ${TS}`;

describe('weight-inference integration', () => {
  let supabase: SupabaseClient;
  let ok = false;

  let promptId: string;
  const variantIds: string[] = [];
  const criteriaIds: string[] = [];
  const criteriaNames = ['clarity', 'depth', 'tone'].map((n) => `${n}-${TS}-t`);
  let sessionId: string | null = null;
  let autoSessionId: string | null = null;
  let rubricId: string | null = null;

  async function wiTablesExist(db: SupabaseClient): Promise<boolean> {
    const { error } = await db.from('evolution_weight_inference_sessions').select('id').limit(1);
    return !error;
  }

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
    ok = (await evolutionTablesExist(supabase)) && (await wiTablesExist(supabase));
    if (!ok) return;

    // topic prompt
    const { data: p, error: pErr } = await supabase
      .from('evolution_prompts')
      .insert({ prompt: PROMPT_TEXT, name: PROMPT_TEXT })
      .select('id')
      .single();
    if (pErr) throw new Error(`seed prompt: ${pErr.message}`);
    promptId = p.id as string;

    // arena article variants for the topic
    const variantRows = Array.from({ length: 8 }, (_, i) => ({
      prompt_id: promptId,
      variant_content: `[TEST_EVO] wi article ${i} ${TS}`,
      synced_to_arena: true,
      variant_kind: 'article',
      mu: 25 + i,
      sigma: 8,
      elo_score: 1200 + i * 10,
      generation_method: 'manual',
    }));
    const { data: vs, error: vErr } = await supabase
      .from('evolution_variants')
      .insert(variantRows)
      .select('id');
    if (vErr) throw new Error(`seed variants: ${vErr.message}`);
    for (const v of vs ?? []) variantIds.push(v.id as string);

    // criteria (TESTEVO-…-<ms> form; brackets illegal in evolution_criteria.name)
    const critRows = ['clarity', 'depth', 'tone'].map((n) => ({
      name: `${n}-${TS}-t`,
      description: `test ${n}`,
      min_rating: 1,
      max_rating: 10,
      status: 'active',
    }));
    const { data: cs, error: cErr } = await supabase
      .from('evolution_criteria')
      .insert(critRows)
      .select('id');
    if (cErr) throw new Error(`seed criteria: ${cErr.message}`);
    for (const c of cs ?? []) criteriaIds.push(c.id as string);
  }, 60000);

  afterAll(async () => {
    if (!ok) return;
    if (sessionId) {
      await supabase.from('evolution_weight_inference_sessions').delete().eq('id', sessionId);
    }
    if (autoSessionId) {
      await supabase.from('evolution_weight_inference_sessions').delete().eq('id', autoSessionId);
    }
    if (rubricId) {
      await supabase.from('evolution_judge_rubric_dimensions').delete().eq('rubric_id', rubricId);
      await supabase.from('evolution_judge_rubrics').delete().eq('id', rubricId);
    }
    if (criteriaIds.length) {
      await supabase.from('evolution_criteria').delete().in('id', criteriaIds);
    }
    await cleanupEvolutionData(supabase, { promptIds: promptId ? [promptId] : [] });
  }, 60000);

  it('creates a session: seeds the pool, materializes pairs with server-derived rater_id', async () => {
    if (!ok) return;
    const res = await createWeightInferenceSessionAction({
      name: `[TEST_EVO] wi-session ${TS}`,
      mode: 'human',
      prompt_id: promptId,
      sample_size: 8,
      replication_rate: 0.15,
      criteriaIds,
    });
    expect(res.success).toBe(true);
    sessionId = res.data!.sessionId;

    const { count: artCount } = await supabase
      .from('evolution_weight_inference_articles')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);
    expect(artCount).toBe(8);

    const { data: comps } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('rater_id, pass')
      .eq('session_id', sessionId);
    expect((comps ?? []).length).toBeGreaterThan(0);
    // rater_id is server-derived from the mocked requireAdmin (never a client input)
    expect((comps ?? []).every((c) => c.rater_id === 'test-admin')).toBe(true);
  }, 60000);

  it('records verdicts (canonical round-trip), fits, and exports a rubric', async () => {
    if (!ok || !sessionId) return;

    // judge several pairs: overall first, then per-criterion, with a consistent rule
    for (let i = 0; i < 8; i++) {
      const pair = await getNextPairAction({ sessionId, step: 'overall' });
      if (!pair.success || !pair.data) break;
      await recordOverallVerdictAction({
        sessionId,
        comparisonId: pair.data.comparisonId,
        onScreenWinner: 'a',
      });
    }
    for (let i = 0; i < 8; i++) {
      const pair = await getNextPairAction({ sessionId, step: 'criteria' });
      if (!pair.success || !pair.data) break;
      const verdicts = (pair.data.criteria ?? []).map((c) => ({
        criteriaId: c.id,
        onScreenVerdict: 'a' as const,
      }));
      await recordDimensionVerdictsAction({ sessionId, comparisonId: pair.data.comparisonId, verdicts });
    }

    const fit = await getWeightInferenceFitAction({ sessionId });
    expect(fit.success).toBe(true);
    expect(fit.data!.weights.length).toBe(3);

    const exported = await exportWeightInferenceRubricAction({
      sessionId,
      rubricName: `[TEST_EVO] wi-rubric ${TS}`,
    });
    expect(exported.success).toBe(true);
    rubricId = exported.data!.rubricId;

    const { data: rubric } = await supabase
      .from('evolution_judge_rubrics')
      .select('id')
      .eq('id', rubricId)
      .single();
    expect(rubric?.id).toBe(rubricId);
  }, 120000);

  it('auto mode: runAutoChunk judges llm pairs with a fake judge (zero real LLM) + idempotent re-run', async () => {
    if (!ok) return;
    const created = await createWeightInferenceSessionAction({
      name: `[TEST_EVO] wi-auto ${TS}`,
      mode: 'auto',
      prompt_id: promptId,
      sample_size: 6,
      criteriaIds,
      judge_model: 'qwen-2.5-7b-instruct',
    });
    expect(created.success).toBe(true);
    autoSessionId = created.data!.sessionId;

    const { count: llmRows } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', autoSessionId)
      .eq('source', 'llm');
    expect((llmRows ?? 0)).toBeGreaterThan(0);

    // Fake judge — the ONLY judge (no callLLM): 'A' token for the holistic prompt,
    // per-criterion "name: A" lines for the rubric prompt. Proves zero real LLM calls.
    const costAcc = { usd: 0 };
    // 4th arg is the per-pair cost sink (concurrency-safe attribution); write there, and
    // runAutoChunk folds each pair's isolated spend into the shared costAcc total.
    const factory: JudgeFactory = (_model, _temp, _reasoning, costSink) => async (prompt: string) => {
      costSink.usd += 0.0001;
      if (criteriaNames.some((n) => prompt.includes(n))) {
        return criteriaNames.map((n) => `${n}: A`).join('\n');
      }
      return 'A';
    };

    const res1 = await runAutoChunk(supabase, autoSessionId, factory, costAcc);
    expect(res1.judged).toBeGreaterThan(0);
    expect(costAcc.usd).toBeGreaterThan(0);

    // Per-pair `cost` must NOT cross-attribute under concurrency: the sum of persisted
    // per-pair costs equals the chunk total (each pair had its own cost sink).
    const { data: costRows } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('cost')
      .eq('session_id', autoSessionId)
      .eq('source', 'llm')
      .eq('pass', 0)
      .not('overall_winner', 'is', null);
    const summedCost = (costRows ?? []).reduce((s, r) => s + ((r.cost as number | null) ?? 0), 0);
    expect(summedCost).toBeCloseTo(costAcc.usd, 6);

    const { count: judged } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', autoSessionId)
      .eq('source', 'llm')
      .not('overall_winner', 'is', null);
    expect((judged ?? 0)).toBe(res1.judged);

    // idempotent re-run: nothing left to judge, no extra spend
    const costBefore = costAcc.usd;
    const res2 = await runAutoChunk(supabase, autoSessionId, factory, costAcc);
    expect(res2.judged).toBe(0);
    expect(res2.done).toBe(true);
    expect(costAcc.usd).toBe(costBefore);

    const fit = await getWeightInferenceFitAction({ sessionId: autoSessionId });
    expect(fit.success).toBe(true);
    expect(fit.data!.mode).toBe('auto');
  }, 120000);

  it('rejects when the kill switch is off', async () => {
    if (!ok) return;
    const prev = process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED;
    process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED = 'false';
    try {
      const res = await getWeightInferenceFitAction({ sessionId: sessionId ?? '00000000-0000-0000-0000-000000000000' });
      expect(res.success).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED;
      else process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED = prev;
    }
  });
});
