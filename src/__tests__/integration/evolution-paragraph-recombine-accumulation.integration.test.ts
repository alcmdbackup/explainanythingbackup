// Integration test for D10 cross-invocation Elo accumulation in paragraph_recombine.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.
//
// Exercises the load-bearing data-persistence contracts WITHOUT running the full
// pipeline orchestrator (which would require a real LLM provider + run loop):
//   - upsertSlotTopic idempotency across invocations (deterministic topicId per
//     (parent, slot) per D10).
//   - persistSlotMatches writes to evolution_arena_comparisons with the slot's
//     prompt_id (NOT the article's).
//   - loadArenaEntries surfaces prior-invocation rewrites as competitors via
//     the topK + alwaysIncludeIds union path (per D15).
//   - extended sync_to_arena RPC reads agent_name + variant_kind from the JSONB
//     payload and persists them onto evolution_variants; ON CONFLICT leaves
//     them untouched (so re-syncs don't clobber).
//   - cleanupEvolutionData paragraphTopicParentPrefixes option cascades
//     paragraph topics + variants + arena_comparisons.
//
// LOCAL SETUP: Run `supabase db reset` before `npm run test:integration` so the
// migrations for paragraph_kind + slot-topic unique-index + sync_to_arena extension
// are applied. The test silently skips when migrations are not detected.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import {
  upsertSlotTopic,
  persistSlotMatches,
  makeMatchKey,
  type BeforeAfterRatingsMap,
} from '@evolution/services/slotTopicActions';
import { loadArenaEntries } from '@evolution/lib/pipeline/setup/buildRunContext';
import { syncToArena } from '@evolution/lib/pipeline/finalize/persistRunResults';
import { formatSlotTopicName } from '@evolution/lib/shared/paragraphLabels';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { V2Match, Variant } from '@evolution/lib/pipeline/infra/types';

const TEST_PREFIX = '[TEST_EVO] paragraph-accumulation';

function makeRating(elo: number, uncertainty = 50) {
  return { elo, uncertainty };
}

async function paragraphKindMigrationApplied(sb: SupabaseClient): Promise<boolean> {
  // Probe by inserting a dummy paragraph-kind row; cleanup immediately.
  const probeName = `${TEST_PREFIX}-probe-${Date.now()}`;
  const { error } = await sb
    .from('evolution_prompts')
    .insert({ prompt: probeName, name: probeName, status: 'active', prompt_kind: 'paragraph' })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '42703' /* column does not exist */) return false;
    // Other errors (RLS, etc.) — best to skip rather than misinterpret.
    if (error.message?.includes('prompt_kind')) return false;
    return true; // some other error, assume migration is there
  }
  // Cleanup the probe row.
  await sb.from('evolution_prompts').delete().eq('prompt', probeName);
  return true;
}

describe('Paragraph recombine — cross-invocation Elo accumulation (D10)', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let migrationApplied: boolean;

  const strategyId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const parentVariantId = crypto.randomUUID();
  const parentPrefix = parentVariantId.slice(0, 8);

  // Use a hand-crafted parent variant ID prefix so cleanupEvolutionData can
  // cascade-delete via paragraphTopicParentPrefixes. formatSlotTopicName uses
  // `[para] V<8-hex>.P<n>` — strip the trailing 'V' so the prefix matches.
  const slotIndex = 0;

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping accumulation tests');
      return;
    }
    migrationApplied = await paragraphKindMigrationApplied(supabase);
    if (!migrationApplied) {
      console.warn('prompt_kind/variant_kind columns missing — run `supabase db reset` locally');
      return;
    }

    // Seed strategy + run + parent variant (article-kind).
    await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: `${TEST_PREFIX} strategy`,
        label: `${TEST_PREFIX} strategy`,
        config: { test: true },
        config_hash: `test-paragraph-accumulation-${strategyId}`,
      });
    await supabase
      .from('evolution_runs')
      .insert({ id: runId, strategy_id: strategyId, status: 'running' });
    await supabase
      .from('evolution_variants')
      .insert({
        id: parentVariantId,
        run_id: runId,
        variant_content: '# Title\n\n## Section\n\nFirst paragraph. Second sentence.\n\nMore content. Extra sentence.',
        generation_method: 'llm',
        agent_name: 'generate_from_previous_article',
        mu: 25, sigma: 8.333,
        variant_kind: 'article',
      });
  });

  afterAll(async () => {
    if (!tablesExist || !migrationApplied) return;
    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
      paragraphTopicParentPrefixes: [parentPrefix],
    });
  });

  it('upsertSlotTopic returns the SAME topicId on the second call (deterministic per (parent, slot) per D10)', async () => {
    if (!tablesExist || !migrationApplied) return;

    const first = await upsertSlotTopic(supabase, 'paragraph', parentVariantId, slotIndex, 'First paragraph. Second sentence.');
    expect(first.isNew).toBe(true);
    expect(first.topicId).toBeTruthy();
    expect(first.originalSlotVariantId).toBeTruthy();

    const second = await upsertSlotTopic(supabase, 'paragraph', parentVariantId, slotIndex, 'First paragraph. Second sentence.');
    expect(second.isNew).toBe(false);
    expect(second.topicId).toBe(first.topicId);
    expect(second.originalSlotVariantId).toBe(first.originalSlotVariantId);

    // Verify the slot topic was created with the deterministic name.
    const { data: topic } = await supabase
      .from('evolution_prompts')
      .select('id, prompt, prompt_kind')
      .eq('id', first.topicId)
      .single();
    expect(topic).toBeTruthy();
    expect(topic!.prompt).toBe(formatSlotTopicName(parentVariantId, slotIndex));
    expect(topic!.prompt_kind).toBe('paragraph');
  });

  it('persistSlotMatches writes rows with the slot prompt_id (proves D10 routing — NOT article prompt_id)', async () => {
    if (!tablesExist || !migrationApplied) return;

    const { topicId, originalSlotVariantId } = await upsertSlotTopic(
      supabase, 'paragraph', parentVariantId, slotIndex, 'First paragraph. Second sentence.',
    );

    // Insert a couple of rewrite variants so we have entry_a/entry_b targets that exist.
    const rewriteId1 = crypto.randomUUID();
    const rewriteId2 = crypto.randomUUID();
    await supabase.from('evolution_variants').insert([
      {
        id: rewriteId1,
        prompt_id: topicId,
        run_id: runId,
        variant_content: 'Rewritten paragraph one. Same length.',
        agent_name: 'paragraph_rewrite',
        variant_kind: 'paragraph',
        generation_method: 'llm',
        mu: 26, sigma: 8.0,
        synced_to_arena: true,
      },
      {
        id: rewriteId2,
        prompt_id: topicId,
        run_id: runId,
        variant_content: 'Another rewritten paragraph. Two sentences.',
        agent_name: 'paragraph_rewrite',
        variant_kind: 'paragraph',
        generation_method: 'llm',
        mu: 24, sigma: 8.5,
        synced_to_arena: true,
      },
    ]);

    const matches: V2Match[] = [
      { winnerId: rewriteId1, loserId: originalSlotVariantId, result: 'a-wins', confidence: 0.85, cost: 0, durationMs: 0 } as unknown as V2Match,
      { winnerId: rewriteId1, loserId: rewriteId2, result: 'a-wins', confidence: 0.7, cost: 0, durationMs: 0 } as unknown as V2Match,
    ];
    const beforeAfter: BeforeAfterRatingsMap = new Map();
    beforeAfter.set(makeMatchKey(rewriteId1, originalSlotVariantId), {
      aBefore: makeRating(1300), aAfter: makeRating(1320),
      bBefore: makeRating(1200), bAfter: makeRating(1180),
    });
    beforeAfter.set(makeMatchKey(rewriteId1, rewriteId2), {
      aBefore: makeRating(1320), aAfter: makeRating(1340),
      bBefore: makeRating(1250), bAfter: makeRating(1230),
    });

    const result = await persistSlotMatches(supabase, topicId, runId, '', 1, matches, beforeAfter);
    expect(result.inserted).toBe(2);
    expect(result.error).toBeUndefined();

    // Verify the rows landed with the slot's prompt_id (NOT the article's).
    const { data: comparisons } = await supabase
      .from('evolution_arena_comparisons')
      .select('prompt_id, entry_a, entry_b, winner, entry_a_mu_before, entry_a_mu_after')
      .eq('prompt_id', topicId);

    expect(comparisons).toBeDefined();
    expect(comparisons!.length).toBeGreaterThanOrEqual(2);
    // mu_before/after columns populated from ratingToDb.
    const withRatings = comparisons!.filter((c) => c.entry_a_mu_before != null);
    expect(withRatings.length).toBeGreaterThanOrEqual(2);
  });

  // investigate_paragraph_recombine_invocation_20260529: per-slot syncToArena must persist
  // parent_variant_ids + match_count + arena_match_count for paragraph rewrites. This is the
  // ONLY automated guard that exercises the migration's jsonb-array→uuid[] cast at RUNTIME
  // (migration:verify only checks the function APPLIES, not that the cast populates the column).
  // Runs in CI after the deploy-migrations job applies 20260529000001 to staging; locally needs
  // a DB with that migration (`supabase db reset`).
  it('syncToArena round-trips parent_variant_ids + match_count + arena_match_count for a paragraph rewrite', async () => {
    if (!tablesExist || !migrationApplied) return;

    const { topicId, originalSlotVariantId } = await upsertSlotTopic(
      supabase, 'paragraph', parentVariantId, slotIndex, 'First paragraph. Second sentence.',
    );

    // A fresh rewrite minted in-memory (as ParagraphRecombineAgent does), single-parent = slot original.
    const rewriteId = crypto.randomUUID();
    const variant = {
      id: rewriteId,
      text: 'A fresh rewrite of the paragraph. Second sentence keeps the length steady.',
      version: 0,
      parentIds: [originalSlotVariantId],
      strategy: 'paragraph_rewrite',
      createdAt: Date.now(),
      iterationBorn: 0,
      variantKind: 'paragraph',
      agentName: 'paragraph_rewrite',
    } as unknown as Variant;
    const ratings = new Map([[rewriteId, makeRating(1280, 60)]]);
    // Two matches involving the rewrite → variantMatchCounts.get(rewriteId) === 2.
    const matches: V2Match[] = [
      { winnerId: rewriteId, loserId: originalSlotVariantId, result: 'a-wins', confidence: 0.8, cost: 0, durationMs: 0 } as unknown as V2Match,
      { winnerId: originalSlotVariantId, loserId: rewriteId, result: 'a-wins', confidence: 0.7, cost: 0, durationMs: 0 } as unknown as V2Match,
    ];

    await syncToArena(runId, topicId, [variant], ratings, matches, supabase, false);

    const { data: row } = await supabase
      .from('evolution_variants')
      .select('parent_variant_ids, match_count, arena_match_count')
      .eq('id', rewriteId)
      .single();
    expect(row).toBeTruthy();
    // The migration round-trips the jsonb array → uuid[] (was '{}' before the fix).
    expect(row!.parent_variant_ids).toEqual([originalSlotVariantId]);
    // match_count + arena_match_count tallied from the 2 matches (were 0 before the fix).
    expect(row!.match_count).toBe(2);
    expect(row!.arena_match_count).toBe(2);
  });

  it('loadArenaEntries with topK surfaces prior-invocation rewrites as competitors (warm-state inheritance for next invocation)', async () => {
    if (!tablesExist || !migrationApplied) return;

    const { topicId, originalSlotVariantId } = await upsertSlotTopic(
      supabase, 'paragraph', parentVariantId, slotIndex, 'First paragraph. Second sentence.',
    );

    // The variants from the prior test should still be there (within this describe block's
    // serial scope). Load arena entries with topK=20 + alwaysIncludeIds=[original].
    const { variants, ratings } = await loadArenaEntries(topicId, supabase, undefined, {
      topK: 20,
      alwaysIncludeIds: [originalSlotVariantId],
    });

    // We should see the original variant + the prior rewrites (R1 + R2 from prior test).
    expect(variants.length).toBeGreaterThanOrEqual(3);
    const originalLoaded = variants.find((v) => v.id === originalSlotVariantId);
    expect(originalLoaded).toBeDefined();

    // Their ratings should reflect the persisted mu/sigma (not freshly initialized).
    // R1 was inserted with mu=26 above, which projects to elo > 1200 (default).
    const rewriteRatings = [...ratings.entries()].filter(([id]) => id !== originalSlotVariantId);
    expect(rewriteRatings.length).toBeGreaterThanOrEqual(1);
    // At least one rewrite should have elo above the default 1200 (proves warm-state inheritance).
    const aboveDefault = rewriteRatings.some(([, r]) => r.elo > 1200);
    expect(aboveDefault).toBe(true);
  });

  it('paragraph topics + variants + comparisons are cleanly deletable via cleanupEvolutionData paragraphTopicParentPrefixes (D10 cascade)', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Spawn a fresh parent prefix so this test can independently verify cleanup.
    const ephemeralParentId = crypto.randomUUID();
    const ephemeralPrefix = ephemeralParentId.slice(0, 8);

    const { topicId, originalSlotVariantId } = await upsertSlotTopic(
      supabase, 'paragraph', ephemeralParentId, 0, 'Ephemeral paragraph.',
    );

    // Insert a rewrite + a comparison row.
    const rwId = crypto.randomUUID();
    await supabase.from('evolution_variants').insert({
      id: rwId, prompt_id: topicId, run_id: runId,
      variant_content: 'Ephemeral rewrite.',
      agent_name: 'paragraph_rewrite', variant_kind: 'paragraph',
      generation_method: 'llm', mu: 25, sigma: 8,
      synced_to_arena: true,
    });
    await persistSlotMatches(supabase, topicId, runId, '', 1, [
      { winnerId: rwId, loserId: originalSlotVariantId, result: 'a-wins', confidence: 0.8, cost: 0, durationMs: 0 } as unknown as V2Match,
    ], new Map());

    // Cleanup just this prefix.
    await cleanupEvolutionData(supabase, { paragraphTopicParentPrefixes: [ephemeralPrefix] });

    // Topic + variants + comparisons should be gone.
    const { data: topic } = await supabase.from('evolution_prompts').select('id').eq('id', topicId).maybeSingle();
    expect(topic).toBeNull();
    const { data: variants } = await supabase.from('evolution_variants').select('id').eq('prompt_id', topicId);
    expect(variants ?? []).toEqual([]);
    const { data: comparisons } = await supabase.from('evolution_arena_comparisons').select('id').eq('prompt_id', topicId);
    expect(comparisons ?? []).toEqual([]);
  });
});
