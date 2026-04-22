// Integration test for Bug 2 (20260421): pool-mode iterations must draw parents
// from variants produced by the CURRENT run only — never from arena entries that
// came from prior runs of the same prompt.
//
// Rather than running the full pipeline (which requires LLM mocking), this test
// exercises the integration boundary between loadArenaEntries (DB read) and the
// call-site filter in runIterationLoop: arena-loaded variants carry
// `fromArena: true`, the orchestrator filters them out before calling
// resolveParent, and the resolved parent's variantId is never an arena UUID.
//
// The plain-JS assertion finishing the test (`arenaIds.every(aid => !picked)`)
// is the exact inverse of the bug signature observed on staging run
// 6743c119-8a52-44e5-8102-0b1f4b212f40.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  VALID_VARIANT_TEXT,
} from '@evolution/testing/evolution-test-helpers';
import { loadArenaEntries } from '@evolution/lib/pipeline/setup/buildRunContext';
import { resolveParent } from '@evolution/lib/pipeline/loop/resolveParent';
import type { Variant } from '@evolution/lib/types';

describe('Pool-source same-run integration (Bug 2 regression)', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  const promptIds: string[] = [];
  const variantIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    if (variantIds.length > 0) {
      await supabase.from('evolution_variants').delete().in('id', variantIds);
    }
    await cleanupEvolutionData(supabase, { promptIds });
  });

  it('arena variants are loaded with fromArena=true and are filtered out at the call site', async () => {
    if (!tablesExist) return;

    // Create a prompt we'll use to isolate this test's arena.
    const { data: prompt, error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ name: '[TEST_EVO] pool-source-same-run', prompt: 'test prompt body' })
      .select()
      .single();
    if (promptErr || !prompt) throw new Error(`Failed to create prompt: ${promptErr?.message}`);
    const promptId = prompt.id as string;
    promptIds.push(promptId);

    // Seed 3 arena variants (synced_to_arena=true) tied to this prompt. They come from
    // no run in particular — the shape we care about is generation_method='pipeline',
    // synced_to_arena=true. Give them distinct mu values so they have different elos.
    const arenaRows = [
      { id: crypto.randomUUID(), variant_content: VALID_VARIANT_TEXT, prompt_id: promptId, synced_to_arena: true, generation_method: 'pipeline', mu: 32, sigma: 4, elo_score: 1400 },
      { id: crypto.randomUUID(), variant_content: VALID_VARIANT_TEXT, prompt_id: promptId, synced_to_arena: true, generation_method: 'pipeline', mu: 30, sigma: 4, elo_score: 1350 },
      { id: crypto.randomUUID(), variant_content: VALID_VARIANT_TEXT, prompt_id: promptId, synced_to_arena: true, generation_method: 'pipeline', mu: 28, sigma: 4, elo_score: 1300 },
    ];
    arenaRows.forEach((r) => variantIds.push(r.id));
    const { error: arenaErr } = await supabase.from('evolution_variants').insert(arenaRows);
    if (arenaErr) throw new Error(`Failed to seed arena variants: ${arenaErr.message}`);
    const arenaIds = new Set(arenaRows.map((r) => r.id));

    // Load arena entries via the same path runIterationLoop uses.
    const { variants: arenaVariants, ratings: arenaRatings } = await loadArenaEntries(promptId, supabase);
    expect(arenaVariants.length).toBe(3);
    for (const v of arenaVariants) {
      expect(v.fromArena).toBe(true);
      expect(arenaIds.has(v.id)).toBe(true);
      expect(arenaRatings.has(v.id)).toBe(true);
    }

    // Simulate 2 in-run variants (would have been produced by iteration 1 of the new run).
    // These are the only variants that should be eligible as parents in a pool-mode iter.
    const inRunVariants: Variant[] = [
      { id: 'in-run-1', text: 'text-a', version: 0, parentIds: [], tactic: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 1 } as Variant,
      { id: 'in-run-2', text: 'text-b', version: 0, parentIds: [], tactic: 'lexical_simplify', createdAt: Date.now() / 1000, iterationBorn: 1 } as Variant,
    ];
    const inRunIds = new Set(inRunVariants.map((v) => v.id));
    const inRunRatings = new Map<string, { elo: number; uncertainty: number }>([
      ['in-run-1', { elo: 1250, uncertainty: 60 }],
      ['in-run-2', { elo: 1220, uncertainty: 70 }],
    ]);

    // Build the iteration-start snapshot (what runIterationLoop does on line 303).
    const initialPoolSnapshot: Variant[] = [...inRunVariants, ...arenaVariants];
    const initialRatingsSnapshot = new Map([...arenaRatings, ...inRunRatings]);

    // Apply the call-site filter exactly as runIterationLoop now does.
    const inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena);
    expect(inRunPool.length).toBe(2);
    expect(inRunPool.every((v) => inRunIds.has(v.id))).toBe(true);

    // Call resolveParent many times with different RNG values. Even though arena
    // variants have higher elo_scores (1300-1400) than the in-run variants (1220-1250),
    // none of the 20 probes should return an arena id.
    for (let i = 0; i < 20; i++) {
      const resolved = resolveParent({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topN', value: 4 },
        seedVariant: { id: 'seed-uuid', text: 'seed-text' },
        pool: inRunPool,
        ratings: initialRatingsSnapshot,
        rng: () => i / 20,
      });
      expect(resolved.effectiveMode).toBe('pool');
      // The cardinal assertion — the exact inverse of the bug signature.
      expect(arenaIds.has(resolved.variantId)).toBe(false);
      expect(inRunIds.has(resolved.variantId)).toBe(true);
    }
  });

  it('when the filtered pool is empty, resolveParent falls back to seed (empty_pool)', async () => {
    if (!tablesExist) return;

    const { data: prompt, error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ name: '[TEST_EVO] pool-source-arena-only', prompt: 'test prompt body 2' })
      .select()
      .single();
    if (promptErr || !prompt) throw new Error(`Failed to create prompt: ${promptErr?.message}`);
    const promptId = prompt.id as string;
    promptIds.push(promptId);

    const arenaId = crypto.randomUUID();
    variantIds.push(arenaId);
    const { error: arenaErr } = await supabase
      .from('evolution_variants')
      .insert({ id: arenaId, variant_content: VALID_VARIANT_TEXT, prompt_id: promptId, synced_to_arena: true, generation_method: 'pipeline', mu: 30, sigma: 4, elo_score: 1350 });
    if (arenaErr) throw new Error(`Failed to seed arena variant: ${arenaErr.message}`);

    const { variants: arenaVariants, ratings: arenaRatings } = await loadArenaEntries(promptId, supabase);
    expect(arenaVariants.length).toBe(1);

    // No in-run variants yet. Filter drops everything.
    const initialPoolSnapshot: Variant[] = [...arenaVariants];
    const inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena);
    expect(inRunPool).toEqual([]);

    const resolved = resolveParent({
      sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 4 },
      seedVariant: { id: 'seed-uuid', text: 'seed-text' },
      pool: inRunPool,
      ratings: arenaRatings,
      rng: () => 0,
    });
    expect(resolved.effectiveMode).toBe('seed_fallback_from_pool');
    expect(resolved.fallbackReason).toBe('empty_pool');
    expect(resolved.variantId).toBe('seed-uuid');
    // Critically: arena variant's id is NOT returned, even as a last resort.
    expect(resolved.variantId).not.toBe(arenaId);
  });
});
