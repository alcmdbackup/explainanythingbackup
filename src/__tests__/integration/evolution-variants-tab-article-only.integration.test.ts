// Integration test: the run/strategy Variants tab + Lineage graph default to article-only, hiding
// paragraph_recombine slot rewrites (variant_kind='paragraph') that carry run_id via sync_to_arena.
// Verifies the real PostgREST `.or(NON_DISCARDED_OR_FILTER).eq('variant_kind', ...)` AND-combine
// semantics against a live DB — which mocked unit tests cannot prove.
// hide_paragraphs_from_run_variants_tab_evolution_20260603.
//
// LOCAL SETUP: run `supabase db reset` before `npm run test:integration` so the variant_kind column
// (migration 20260527000001) exists. The test silently skips when evolution tables/columns are absent.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { evolutionTablesExist, cleanupEvolutionData } from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Mocks (must precede importing the modules under test) ────
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id') }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));

import { getEvolutionVariantsAction, getRunSnapshotsAction } from '@evolution/services/evolutionActions';
import { getEvolutionRunLineageAction } from '@evolution/services/evolutionVisualizationActions';

describe('Variants tab + Lineage article-only default (integration)', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const strategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const slotTopicId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const articleVariantId = crypto.randomUUID();
  const paragraphVariantId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping article-only integration tests');
      return;
    }

    const ins = async (table: string, rows: Record<string, unknown> | Record<string, unknown>[]): Promise<void> => {
      const { error } = await supabase.from(table).insert(rows as never);
      if (error) throw new Error(`insert ${table} failed: ${error.message}`);
    };

    await ins('evolution_strategies', {
      id: strategyId, name: '[TEST_EVO] article-only', label: '[TEST_EVO] article-only',
      config: { test: true }, config_hash: `test-article-only-${strategyId}`,
    });
    await ins('evolution_prompts', [
      { id: promptId, prompt: '[TEST_EVO] article-only prompt', name: '[TEST_EVO] article-only prompt', prompt_kind: 'article' },
      { id: slotTopicId, prompt: `[para] V${articleVariantId.slice(0, 8)}.P1`, name: `[para] V${articleVariantId.slice(0, 8)}.P1`, prompt_kind: 'paragraph' },
    ]);
    // iteration_snapshots holds the run's ARTICLE pool only (production behavior) — per-slot paragraph
    // variants live in per-slot local pools and never enter it. Seeding article-only here lets the
    // Snapshots guard test prove the paragraph variant (which DOES carry run_id) is not surfaced.
    await ins('evolution_runs', {
      id: runId, strategy_id: strategyId, prompt_id: promptId, status: 'completed',
      iteration_snapshots: [
        { iteration: 0, phase: 'end', capturedAt: '2026-06-03T00:00:00Z', iterationType: 'generate', poolVariantIds: [articleVariantId] },
      ],
    });
    await ins('evolution_variants', [
      // Article variant (persisted, in the run pool).
      { id: articleVariantId, run_id: runId, prompt_id: promptId, variant_content: 'ARTICLE body', elo_score: 1300, mu: 30, sigma: 6, persisted: true, variant_kind: 'article', parent_variant_ids: [] },
      // Paragraph rewrite — carries run_id (as sync_to_arena writes), persisted=false by design.
      { id: paragraphVariantId, run_id: runId, prompt_id: slotTopicId, variant_content: 'PARAGRAPH rewrite', elo_score: 1260, mu: 27, sigma: 6, persisted: false, variant_kind: 'paragraph', agent_name: 'paragraph_rewrite', parent_variant_ids: [] },
    ]);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, { runIds: [runId], strategyIds: [strategyId], promptIds: [promptId, slotTopicId] });
  });

  it('getEvolutionVariantsAction defaults to article-only (paragraph rewrite hidden)', async () => {
    if (!tablesExist) return;
    const res = await getEvolutionVariantsAction({ runId });
    expect(res.success).toBe(true);
    const ids = (res.data ?? []).map(v => v.id);
    expect(ids).toContain(articleVariantId);
    expect(ids).not.toContain(paragraphVariantId);
  });

  it("variantKind 'paragraph' returns the paragraph rewrite; 'any' returns both", async () => {
    if (!tablesExist) return;

    const para = await getEvolutionVariantsAction({ runId, variantKind: 'paragraph' });
    expect(para.success).toBe(true);
    const paraIds = (para.data ?? []).map(v => v.id);
    expect(paraIds).toContain(paragraphVariantId);
    expect(paraIds).not.toContain(articleVariantId);

    const both = await getEvolutionVariantsAction({ runId, variantKind: 'any' });
    expect(both.success).toBe(true);
    const bothIds = (both.data ?? []).map(v => v.id);
    expect(bothIds).toContain(articleVariantId);
    expect(bothIds).toContain(paragraphVariantId);
  });

  it('getEvolutionRunLineageAction returns only article nodes', async () => {
    if (!tablesExist) return;
    const res = await getEvolutionRunLineageAction(runId);
    expect(res.success).toBe(true);
    const ids = (res.data ?? []).map(n => n.id);
    expect(ids).toContain(articleVariantId);
    expect(ids).not.toContain(paragraphVariantId);
  });

  it('getRunSnapshotsAction pool is article-only (paragraph variant on the run is not surfaced)', async () => {
    if (!tablesExist) return;
    const res = await getRunSnapshotsAction(runId);
    expect(res.success).toBe(true);
    const poolIds = (res.data?.snapshots ?? []).flatMap(s => s.poolVariantIds ?? []);
    expect(poolIds).toContain(articleVariantId);
    expect(poolIds).not.toContain(paragraphVariantId);
    // variantInfo is keyed only by ids referenced in the snapshot pool — never the run's paragraph variant.
    expect(res.data?.variantInfo[paragraphVariantId]).toBeUndefined();
  });
});
