// Integration test: getVariantParentDiffAction against a real DB — verifies the article
// parent-content fetch and the paragraph prompt_id -> paragraph_original fallback for a
// legacy slot rewrite persisted with empty parent_variant_ids (the path mocked unit tests
// cannot prove against the real schema/query).
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { evolutionTablesExist, cleanupEvolutionData } from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Mocks (must be before importing the module under test) ────
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id') }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));

import { getVariantParentDiffAction } from '@evolution/services/variantDetailActions';

describe('getVariantParentDiffAction integration', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const strategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const slotTopicId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const parentVariantId = crypto.randomUUID();
  const childVariantId = crypto.randomUUID();
  const originalSlotVariantId = crypto.randomUUID();
  const legacyRewriteId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping variant-parent-diff integration tests');
      return;
    }

    const ins = async (table: string, rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const { error } = await supabase.from(table).insert(rows as never);
      if (error) throw new Error(`insert ${table} failed: ${error.message}`);
    };

    await ins('evolution_strategies', {
      id: strategyId, name: '[TEST_EVO] diff-strategy', label: '[TEST_EVO] diff', config: { test: true },
      config_hash: `test-diff-hash-${strategyId}`,
    });
    await ins('evolution_prompts', [
      { id: promptId, prompt: '[TEST_EVO] diff prompt', name: '[TEST_EVO] diff prompt', prompt_kind: 'article' },
      {
        id: slotTopicId,
        prompt: `[para] V${parentVariantId.slice(0, 8)}.P2`,
        name: `[para] V${parentVariantId.slice(0, 8)}.P2`,
        prompt_kind: 'paragraph',
      },
    ]);
    await ins('evolution_runs', { id: runId, strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
    await ins('evolution_variants', [
      { id: parentVariantId, run_id: runId, prompt_id: promptId, variant_content: 'PARENT article body', elo_score: 1200, variant_kind: 'article', parent_variant_ids: [] },
      { id: childVariantId, run_id: runId, prompt_id: promptId, variant_content: 'CHILD article body', elo_score: 1300, variant_kind: 'article', parent_variant_ids: [parentVariantId] },
      // Paragraph slot: original-paragraph variant + a LEGACY rewrite with empty parent_variant_ids.
      { id: originalSlotVariantId, run_id: runId, prompt_id: slotTopicId, variant_content: 'ORIGINAL paragraph text', elo_score: 1200, variant_kind: 'paragraph', agent_name: 'paragraph_original', parent_variant_ids: [] },
      { id: legacyRewriteId, run_id: runId, prompt_id: slotTopicId, variant_content: 'REWRITTEN paragraph text', elo_score: 1260, variant_kind: 'paragraph', agent_name: 'paragraph_rewrite', parent_variant_ids: [] },
    ]);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, { runIds: [runId], strategyIds: [strategyId], promptIds: [promptId, slotTopicId] });
  });

  it('returns the parent article content for an article variant', async () => {
    if (!tablesExist) return;
    const res = await getVariantParentDiffAction(childVariantId);
    expect(res.success).toBe(true);
    expect(res.data?.variantKind).toBe('article');
    expect(res.data?.parent?.id).toBe(parentVariantId);
    expect(res.data?.parent?.content).toBe('PARENT article body');
    expect(res.data?.variantContent).toBe('CHILD article body');
    expect(res.data?.slotContext).toBeNull();
  });

  it('recovers the original paragraph via prompt_id fallback for a legacy empty-lineage rewrite', async () => {
    if (!tablesExist) return;
    const res = await getVariantParentDiffAction(legacyRewriteId);
    expect(res.success).toBe(true);
    expect(res.data?.variantKind).toBe('paragraph');
    expect(res.data?.parent?.id).toBe(originalSlotVariantId);
    expect(res.data?.parent?.content).toBe('ORIGINAL paragraph text');
    expect(res.data?.slotContext).toEqual({ paragraphNumber: 2 });
  });
});
