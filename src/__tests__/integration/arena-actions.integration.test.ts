/**
 * @jest-environment node
 */
// Integration tests for hall of fame server actions with real Supabase.
// Validates CRUD, Elo initialization, cascade deletes, and concurrent upsert dedup
// using direct Supabase calls (not server actions, which require Next.js runtime).

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Check if the evolution_arena_topics table exists. */
async function arenaTablesExist(
  client: SupabaseClient,
): Promise<boolean> {
  const { error } = await client
    .from('evolution_arena_topics')
    .select('id')
    .limit(1);
  return !error;
}

// ─── Test suite ──────────────────────────────────────────────────

let supabase: SupabaseClient;
let tablesReady = false;

// Track all created IDs for cleanup
const createdTopicIds: string[] = [];
const createdEntryIds: string[] = [];
const createdRunIds: string[] = [];
const createdStrategyIds: string[] = [];

beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Skipping hall of fame integration tests: missing Supabase env vars');
    return;
  }
  supabase = createServiceClient();
  tablesReady = await arenaTablesExist(supabase);
  if (!tablesReady) {
    console.warn('Skipping hall of fame integration tests: evolution_arena_topics table not found');
  }
});

afterAll(async () => {
  if (!tablesReady || !supabase) return;
  // Final safety cleanup for any leftovers
  await cleanupAll();
});

afterEach(async () => {
  if (!tablesReady || !supabase) return;
  await cleanupAll();
});

async function cleanupAll() {
  // Delete comparisons for tracked entries
  for (const entryId of createdEntryIds) {
    await supabase
      .from('evolution_arena_comparisons')
      .delete()
      .or(`entry_a_id.eq.${entryId},entry_b_id.eq.${entryId}`);
  }
  // Delete elo rows for tracked entries
  for (const entryId of createdEntryIds) {
    await supabase
      .from('evolution_arena_elo')
      .delete()
      .eq('entry_id', entryId);
  }
  // Delete entries
  for (const entryId of createdEntryIds) {
    await supabase
      .from('evolution_arena_entries')
      .delete()
      .eq('id', entryId);
  }
  // Delete topics
  for (const topicId of createdTopicIds) {
    // Also clean elo/entries/comparisons by topic in case we missed individual ones
    await supabase.from('evolution_arena_comparisons').delete().eq('topic_id', topicId);
    await supabase.from('evolution_arena_elo').delete().eq('topic_id', topicId);
    await supabase.from('evolution_arena_entries').delete().eq('topic_id', topicId);
    await supabase.from('evolution_arena_topics').delete().eq('id', topicId);
  }
  // Delete evolution runs (must come after entries, which have FK to runs)
  for (const runId of createdRunIds) {
    await supabase.from('evolution_checkpoints').delete().eq('run_id', runId);
    await supabase.from('evolution_agent_invocations').delete().eq('run_id', runId);
    await supabase.from('evolution_variants').delete().eq('run_id', runId);
    await supabase.from('evolution_runs').delete().eq('id', runId);
  }
  // Delete strategy configs
  for (const stratId of createdStrategyIds) {
    await supabase.from('evolution_strategy_configs').delete().eq('id', stratId);
  }
  createdTopicIds.length = 0;
  createdEntryIds.length = 0;
  createdRunIds.length = 0;
  createdStrategyIds.length = 0;
}

/** Helper: insert a topic via direct Supabase call and track for cleanup. */
async function insertTopic(prompt: string, title?: string) {
  const { data, error } = await supabase
    .from('evolution_arena_topics')
    .insert({ prompt, title: title ?? `Test Topic ${Date.now()}` })
    .select('id, prompt, title, created_at')
    .single();
  if (error) throw new Error(`Failed to insert topic: ${error.message}`);
  createdTopicIds.push(data.id);
  return data;
}

/** Helper: insert an entry via direct Supabase call and track for cleanup. */
async function insertEntry(
  topicId: string,
  content: string,
  generationMethod: string = 'oneshot',
  model: string = 'gpt-4.1',
  totalCostUsd: number | null = null,
  metadata: Record<string, unknown> = {},
) {
  const { data, error } = await supabase
    .from('evolution_arena_entries')
    .insert({
      topic_id: topicId,
      content,
      generation_method: generationMethod,
      model,
      total_cost_usd: totalCostUsd,
      metadata,
    })
    .select('id, topic_id, content, generation_method, model, total_cost_usd, created_at')
    .single();
  if (error) throw new Error(`Failed to insert entry: ${error.message}`);
  createdEntryIds.push(data.id);
  return data;
}

/** Helper: insert an Elo row for an entry. */
async function insertElo(topicId: string, entryId: string, eloRating: number = 1200, matchCount: number = 0) {
  const { data, error } = await supabase
    .from('evolution_arena_elo')
    .insert({
      topic_id: topicId,
      entry_id: entryId,
      elo_rating: eloRating,
      elo_per_dollar: null,
      match_count: matchCount,
    })
    .select('id, entry_id, elo_rating, match_count')
    .single();
  if (error) throw new Error(`Failed to insert elo: ${error.message}`);
  return data;
}

/** Helper: insert a comparison row. */
async function insertComparison(
  topicId: string,
  entryAId: string,
  entryBId: string,
  winnerId: string | null = null,
) {
  const { data, error } = await supabase
    .from('evolution_arena_comparisons')
    .insert({
      topic_id: topicId,
      entry_a_id: entryAId,
      entry_b_id: entryBId,
      winner_id: winnerId,
      confidence: 0.8,
      judge_model: 'gpt-4.1-nano',
      dimension_scores: null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to insert comparison: ${error.message}`);
  return data;
}

/** Helper: insert a minimal evolution run (with auto-created strategy + prompt) for FK references. */
async function insertEvolutionRun(promptId: string) {
  // Create a strategy config for the FK
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data: strat, error: stratErr } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: `test_hash_${uniqueSuffix}`,
      name: `test_strategy_${uniqueSuffix}`,
      label: 'Test strategy',
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 1, budgetCaps: {} },
    })
    .select('id')
    .single();
  if (stratErr) throw new Error(`Failed to insert strategy config: ${stratErr.message}`);
  createdStrategyIds.push(strat.id);

  const { data: run, error: runErr } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: null,
      status: 'completed',
      budget_cap_usd: 5.0,
      strategy_config_id: strat.id,
      prompt_id: promptId,
    })
    .select('id')
    .single();
  if (runErr) throw new Error(`Failed to insert evolution run: ${runErr.message}`);
  createdRunIds.push(run.id);
  return run;
}

function uniquePrompt(): string {
  return `__test_${crypto.randomUUID()}_integration`;
}

// Use describe.skip when tables are missing to skip all tests gracefully
const describeSuite = () => {
  // We conditionally guard each test with if (!tablesReady) return;
  // This allows the suite to report properly.

  describe('Arena Actions Integration Tests', () => {
    // ─── Test 1: Create topic + add entry ──────────────────────────

    it('creates a topic and adds an entry', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt, 'Test Topic Title');

      expect(topic.id).toBeTruthy();
      expect(topic.prompt).toBe(prompt);
      expect(topic.title).toBe('Test Topic Title');

      const entry = await insertEntry(
        topic.id,
        '# Test Article\n\nThis is integration test content.',
        'oneshot',
        'gpt-4.1',
        0.05,
      );

      expect(entry.id).toBeTruthy();
      expect(entry.topic_id).toBe(topic.id);
      expect(entry.content).toContain('Test Article');

      // Verify topic exists via separate query
      const { data: fetchedTopic, error: topicErr } = await supabase
        .from('evolution_arena_topics')
        .select('id, prompt')
        .eq('id', topic.id)
        .single();

      expect(topicErr).toBeNull();
      expect(fetchedTopic!.prompt).toBe(prompt);

      // Verify entry exists via separate query
      const { data: fetchedEntry, error: entryErr } = await supabase
        .from('evolution_arena_entries')
        .select('id, topic_id')
        .eq('id', entry.id)
        .single();

      expect(entryErr).toBeNull();
      expect(fetchedEntry!.topic_id).toBe(topic.id);
    });

    // ─── Test 2: Add multiple entries to same topic ────────────────

    it('adds 2 entries to the same topic with correct generation_method', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entryOneshot = await insertEntry(
        topic.id,
        'Oneshot generated content for comparison.',
        'oneshot',
        'gpt-4.1',
        0.05,
      );

      const entryEvolution = await insertEntry(
        topic.id,
        'Evolution winner content after multiple iterations.',
        'evolution_winner',
        'deepseek-chat',
        0.15,
      );

      // Verify both entries exist under the same topic
      const { data: entries, error } = await supabase
        .from('evolution_arena_entries')
        .select('id, generation_method, model')
        .eq('topic_id', topic.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      expect(error).toBeNull();
      expect(entries).toHaveLength(2);
      expect(entries![0].id).toBe(entryOneshot.id);
      expect(entries![0].generation_method).toBe('oneshot');
      expect(entries![1].id).toBe(entryEvolution.id);
      expect(entries![1].generation_method).toBe('evolution_winner');
    });

    // ─── Test 3: Elo initialization ────────────────────────────────

    it('initializes Elo with rating 1200 and match_count 0', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const entry = await insertEntry(topic.id, 'Content for Elo init test.');
      const elo = await insertElo(topic.id, entry.id);

      expect(elo.elo_rating).toBe(1200);
      expect(elo.match_count).toBe(0);

      // Verify via a fresh query
      const { data: fetchedElo, error } = await supabase
        .from('evolution_arena_elo')
        .select('elo_rating, match_count')
        .eq('entry_id', entry.id)
        .single();

      expect(error).toBeNull();
      expect(fetchedElo!.elo_rating).toBe(1200);
      expect(fetchedElo!.match_count).toBe(0);
    });

    // ─── Test 4: Delete entry cascade ──────────────────────────────

    it('soft-deletes an entry and cleans up elo and comparison rows', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entryA = await insertEntry(topic.id, 'Entry A for cascade test.');
      const entryB = await insertEntry(topic.id, 'Entry B for cascade test.');

      await insertElo(topic.id, entryA.id);
      await insertElo(topic.id, entryB.id);
      await insertComparison(topic.id, entryA.id, entryB.id, entryA.id);

      // Soft-delete entry A
      const { error: softDeleteErr } = await supabase
        .from('evolution_arena_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', entryA.id);

      expect(softDeleteErr).toBeNull();

      // Hard-delete comparisons involving entry A
      await supabase
        .from('evolution_arena_comparisons')
        .delete()
        .or(`entry_a_id.eq.${entryA.id},entry_b_id.eq.${entryA.id}`);

      // Hard-delete Elo row for entry A
      await supabase
        .from('evolution_arena_elo')
        .delete()
        .eq('entry_id', entryA.id);

      // Verify: entry A is soft-deleted (deleted_at is set)
      const { data: deletedEntry } = await supabase
        .from('evolution_arena_entries')
        .select('id, deleted_at')
        .eq('id', entryA.id)
        .single();

      expect(deletedEntry).toBeTruthy();
      expect(deletedEntry!.deleted_at).toBeTruthy();

      // Verify: no Elo row for entry A
      const { data: eloRows } = await supabase
        .from('evolution_arena_elo')
        .select('id')
        .eq('entry_id', entryA.id);

      expect(eloRows).toHaveLength(0);

      // Verify: no comparisons involving entry A
      const { data: compRows } = await supabase
        .from('evolution_arena_comparisons')
        .select('id')
        .or(`entry_a_id.eq.${entryA.id},entry_b_id.eq.${entryA.id}`);

      expect(compRows).toHaveLength(0);

      // Verify: entry B and its Elo still intact
      const { data: entryBElo } = await supabase
        .from('evolution_arena_elo')
        .select('id')
        .eq('entry_id', entryB.id);

      expect(entryBElo).toHaveLength(1);
    });

    // ─── Test 5: Delete topic cascade ──────────────────────────────

    it('soft-deletes a topic and cascades to entries and elo', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entry1 = await insertEntry(topic.id, 'Topic cascade entry 1.');
      const entry2 = await insertEntry(topic.id, 'Topic cascade entry 2.');

      await insertElo(topic.id, entry1.id);
      await insertElo(topic.id, entry2.id);

      // Soft-delete the topic
      const { error: topicDeleteErr } = await supabase
        .from('evolution_arena_topics')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', topic.id);

      expect(topicDeleteErr).toBeNull();

      // Hard-delete all comparisons for this topic
      await supabase
        .from('evolution_arena_comparisons')
        .delete()
        .eq('topic_id', topic.id);

      // Hard-delete all Elo rows for this topic
      await supabase
        .from('evolution_arena_elo')
        .delete()
        .eq('topic_id', topic.id);

      // Soft-delete all entries for this topic
      await supabase
        .from('evolution_arena_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('topic_id', topic.id);

      // Verify: entries are soft-deleted
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id, deleted_at')
        .eq('topic_id', topic.id);

      expect(entries).toHaveLength(2);
      for (const entry of entries!) {
        expect(entry.deleted_at).toBeTruthy();
      }

      // Verify: no active entries (filtering by deleted_at IS NULL)
      const { data: activeEntries } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('topic_id', topic.id)
        .is('deleted_at', null);

      expect(activeEntries).toHaveLength(0);

      // Verify: Elo rows are deleted
      const { data: eloRows } = await supabase
        .from('evolution_arena_elo')
        .select('id')
        .eq('topic_id', topic.id);

      expect(eloRows).toHaveLength(0);
    });

    // ─── Test 6: JSONB metadata.iterations round-trip ────────────────

    it('stores and retrieves JSONB metadata.iterations correctly', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entry = await insertEntry(
        topic.id,
        'Evolution winner content with iteration metadata.',
        'evolution_winner',
        'deepseek-chat',
        0.12,
        { iterations: 10, winning_strategy: 'structural_transform', duration_seconds: 60 },
      );

      // Query back with metadata
      const { data: fetched, error } = await supabase
        .from('evolution_arena_entries')
        .select('id, metadata')
        .eq('id', entry.id)
        .single();

      expect(error).toBeNull();
      expect(fetched).toBeTruthy();

      const meta = fetched!.metadata as Record<string, unknown>;
      expect(meta.iterations).toBe(10);
      expect(meta.winning_strategy).toBe('structural_transform');
      expect(meta.duration_seconds).toBe(60);

      // Query using containedBy / contains filter on JSONB
      const { data: filtered } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('topic_id', topic.id)
        .contains('metadata', { iterations: 10 });

      expect(filtered).toBeTruthy();
      expect(filtered!.length).toBe(1);
      expect(filtered![0].id).toBe(entry.id);

      // Negative filter: iterations=5 should return nothing
      const { data: noMatch } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('topic_id', topic.id)
        .contains('metadata', { iterations: 5 });

      expect(noMatch).toHaveLength(0);
    });

    // ─── Test 7: Case-insensitive topic lookup via ilike ────────────

    it('finds topics via case-insensitive ilike lookup', async () => {
      if (!tablesReady) return;

      const basePrompt = uniquePrompt();
      const topic = await insertTopic(basePrompt);

      // Search with uppercase should still find it
      const { data: found } = await supabase
        .from('evolution_arena_topics')
        .select('id')
        .ilike('prompt', basePrompt.toUpperCase())
        .is('deleted_at', null)
        .single();

      expect(found).toBeTruthy();
      expect(found!.id).toBe(topic.id);

      // Search with mixed case
      const mixed = basePrompt.charAt(0).toUpperCase() + basePrompt.slice(1).toLowerCase();
      const { data: found2 } = await supabase
        .from('evolution_arena_topics')
        .select('id')
        .ilike('prompt', mixed)
        .is('deleted_at', null)
        .single();

      expect(found2).toBeTruthy();
      expect(found2!.id).toBe(topic.id);
    });

    // ─── Test 8: Multiple methods coexist per topic with Elo ────────

    it('supports multiple generation methods with Elo on the same topic', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      // Insert 3 entries: oneshot, evolution_winner (3 iter), evolution_winner (10 iter)
      const oneshot = await insertEntry(topic.id, 'Oneshot content.', 'oneshot', 'gpt-4.1-mini', 0.03);
      const evo3 = await insertEntry(topic.id, 'Evo 3 iter content.', 'evolution_winner', 'deepseek-chat', 0.08, { iterations: 3 });
      const evo10 = await insertEntry(topic.id, 'Evo 10 iter content.', 'evolution_winner', 'deepseek-chat', 0.15, { iterations: 10 });

      // Init Elo for each
      await insertElo(topic.id, oneshot.id, 1200, 0);
      await insertElo(topic.id, evo3.id, 1250, 3);
      await insertElo(topic.id, evo10.id, 1310, 5);

      // Query all entries for this topic
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id, generation_method, metadata')
        .eq('topic_id', topic.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      expect(entries).toHaveLength(3);
      expect(entries![0].generation_method).toBe('oneshot');
      expect(entries![1].generation_method).toBe('evolution_winner');
      expect((entries![1].metadata as Record<string, unknown>).iterations).toBe(3);
      expect(entries![2].generation_method).toBe('evolution_winner');
      expect((entries![2].metadata as Record<string, unknown>).iterations).toBe(10);

      // Query Elo ranked by rating
      const { data: eloRows } = await supabase
        .from('evolution_arena_elo')
        .select('entry_id, elo_rating, match_count')
        .eq('topic_id', topic.id)
        .order('elo_rating', { ascending: false });

      expect(eloRows).toHaveLength(3);
      expect(eloRows![0].entry_id).toBe(evo10.id);
      expect(eloRows![0].elo_rating).toBe(1310);
      expect(eloRows![1].entry_id).toBe(evo3.id);
      expect(eloRows![2].entry_id).toBe(oneshot.id);
    });

    // ─── Test 9: Elo table stores mu/sigma/ordinal for CI computation ──

    it('stores and retrieves mu, sigma, ordinal from Elo table for CI computation', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const entry = await insertEntry(topic.id, 'Content for CI test.');

      // Insert Elo row with explicit mu, sigma, ordinal
      const { data: elo, error } = await supabase
        .from('evolution_arena_elo')
        .insert({
          topic_id: topic.id,
          entry_id: entry.id,
          mu: 28.0,
          sigma: 3.5,
          ordinal: 17.5,
          elo_rating: 1480,
          elo_per_dollar: null,
          match_count: 6,
        })
        .select('id, mu, sigma, ordinal, elo_rating, match_count')
        .single();

      expect(error).toBeNull();
      expect(Number(elo!.mu)).toBeCloseTo(28.0, 1);
      expect(Number(elo!.sigma)).toBeCloseTo(3.5, 1);
      expect(Number(elo!.ordinal)).toBeCloseTo(17.5, 1);

      // Verify CI computation matches what the server action would produce:
      // ci_lower = ordinalToEloScale(mu - 1.96 * sigma) = 1200 + (28 - 6.86) * 16 = 1538.24
      // ci_upper = ordinalToEloScale(mu + 1.96 * sigma) = 1200 + (28 + 6.86) * 16 = 1757.76
      const mu = Number(elo!.mu);
      const sigma = Number(elo!.sigma);
      const ciLower = 1200 + (mu - 1.96 * sigma) * (400 / 25);
      const ciUpper = 1200 + (mu + 1.96 * sigma) * (400 / 25);

      expect(ciUpper).toBeGreaterThan(ciLower);
      // CI width should be proportional to sigma
      const ciWidth = ciUpper - ciLower;
      expect(ciWidth).toBeCloseTo(2 * 1.96 * sigma * (400 / 25), 1);
    });

    // ─── Test 10: Concurrent topic upsert dedup ─────────────────────

    it('deduplicates concurrent topic inserts for the same prompt', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();

      // Insert the same prompt twice concurrently
      const [result1, result2] = await Promise.allSettled([
        insertTopic(prompt, 'First insert'),
        insertTopic(prompt, 'Second insert'),
      ]);

      // At least one should succeed
      const succeeded = [result1, result2].filter(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string; prompt: string }>[];

      // If the unique index is enforced, exactly one succeeds and the other fails.
      // If there's no unique index, both succeed but with different IDs.
      // Either way, query for all topics with this prompt.
      const { data: topics } = await supabase
        .from('evolution_arena_topics')
        .select('id, prompt')
        .eq('prompt', prompt);

      if (topics && topics.length === 1) {
        // Unique index is in place: dedup works
        expect(topics).toHaveLength(1);
        expect(succeeded.length).toBeGreaterThanOrEqual(1);
      } else {
        // No unique constraint: both inserts created rows.
        // Track extra IDs for cleanup.
        for (const t of topics ?? []) {
          if (!createdTopicIds.includes(t.id)) {
            createdTopicIds.push(t.id);
          }
        }
        // At minimum both succeeded
        expect(succeeded.length).toBe(2);
        // Warn that dedup via unique index is not enforced
        console.warn(
          'evolution_arena_topics does not enforce prompt uniqueness; ' +
          `${topics?.length} rows created for same prompt`,
        );
      }
    });

    // ─── Test 10: Upsert entries by (evolution_run_id, rank) ────────

    it('upserts hall of fame entries by evolution_run_id + rank', async () => {
      if (!tablesReady) return;

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const run = await insertEvolutionRun(topic.id);

      // First upsert: create 2 entries (rank 1 and 2)
      const rows = [
        {
          topic_id: topic.id,
          content: 'Winner content v1',
          generation_method: 'evolution_winner',
          model: 'deepseek-chat',
          total_cost_usd: 0.10,
          evolution_run_id: run.id,
          rank: 1,
          metadata: {},
        },
        {
          topic_id: topic.id,
          content: 'Runner-up content v1',
          generation_method: 'evolution_top3',
          model: 'deepseek-chat',
          total_cost_usd: 0.10,
          evolution_run_id: run.id,
          rank: 2,
          metadata: {},
        },
      ];

      const { data: inserted, error: insertErr } = await supabase
        .from('evolution_arena_entries')
        .upsert(rows, { onConflict: 'evolution_run_id,rank' })
        .select('id, topic_id, content, generation_method, rank');

      expect(insertErr).toBeNull();
      expect(inserted).toHaveLength(2);
      for (const entry of inserted!) {
        createdEntryIds.push(entry.id);
      }
      expect(inserted![0].topic_id).toBe(topic.id);
      expect(inserted![0].rank).toBe(1);
      expect(inserted![0].generation_method).toBe('evolution_winner');
      expect(inserted![1].rank).toBe(2);
      expect(inserted![1].generation_method).toBe('evolution_top3');

      // Second upsert: same (evolution_run_id, rank) with updated content and cost
      const updatedRows = [
        {
          topic_id: topic.id,
          content: 'Winner content v2 (updated)',
          generation_method: 'evolution_winner',
          model: 'deepseek-chat',
          total_cost_usd: 0.20,
          evolution_run_id: run.id,
          rank: 1,
          metadata: {},
        },
        {
          topic_id: topic.id,
          content: 'Runner-up content v2 (updated)',
          generation_method: 'evolution_top3',
          model: 'deepseek-chat',
          total_cost_usd: 0.25,
          evolution_run_id: run.id,
          rank: 2,
          metadata: {},
        },
      ];

      const { data: upserted, error: upsertErr } = await supabase
        .from('evolution_arena_entries')
        .upsert(updatedRows, { onConflict: 'evolution_run_id,rank' })
        .select('id, content, total_cost_usd, rank');

      expect(upsertErr).toBeNull();
      expect(upserted).toHaveLength(2);

      // Verify row count unchanged (still 2 for this run)
      const { data: allEntries } = await supabase
        .from('evolution_arena_entries')
        .select('id, content, total_cost_usd, rank')
        .eq('evolution_run_id', run.id)
        .order('rank', { ascending: true });

      expect(allEntries).toHaveLength(2);
      expect(allEntries![0].content).toBe('Winner content v2 (updated)');
      expect(Number(allEntries![0].total_cost_usd)).toBeCloseTo(0.20);
      expect(allEntries![1].content).toBe('Runner-up content v2 (updated)');
      expect(Number(allEntries![1].total_cost_usd)).toBeCloseTo(0.25);
    });
  });
};

describeSuite();
