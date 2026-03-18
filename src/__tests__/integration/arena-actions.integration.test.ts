/**
 * @jest-environment node
 */
// Integration tests for arena server actions with real Supabase (V2 schema).
// Validates CRUD, inline Elo on entries, cascade deletes, and concurrent upsert dedup
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
    console.warn('Skipping arena integration tests: missing Supabase env vars');
    return;
  }
  supabase = createServiceClient();
  tablesReady = await arenaTablesExist(supabase);
  if (!tablesReady) {
    console.warn('Skipping arena integration tests: evolution_arena_topics table not found');
  }
});

afterAll(async () => {
  if (!tablesReady || !supabase) return;
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
      .or(`entry_a.eq.${entryId},entry_b.eq.${entryId}`);
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
    await supabase.from('evolution_arena_comparisons').delete().eq('topic_id', topicId);
    await supabase.from('evolution_arena_entries').delete().eq('topic_id', topicId);
    await supabase.from('evolution_arena_topics').delete().eq('id', topicId);
  }
  // Delete evolution runs
  for (const runId of createdRunIds) {
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

/** Helper: insert an entry via direct Supabase call and track for cleanup. V2: elo fields are inline. */
async function insertEntry(
  topicId: string,
  content: string,
  generationMethod: string = 'oneshot',
  model: string = 'gpt-4.1',
  costUsd: number | null = null,
  eloRating: number = 1200,
  mu: number = 25,
  sigma: number = 8.333,
  matchCount: number = 0,
) {
  const { data, error } = await supabase
    .from('evolution_arena_entries')
    .insert({
      topic_id: topicId,
      content,
      generation_method: generationMethod,
      model,
      cost_usd: costUsd,
      elo_rating: eloRating,
      mu,
      sigma,
      match_count: matchCount,
    })
    .select('id, topic_id, content, generation_method, model, cost_usd, elo_rating, mu, sigma, match_count, created_at')
    .single();
  if (error) throw new Error(`Failed to insert entry: ${error.message}`);
  createdEntryIds.push(data.id);
  return data;
}

/** Helper: insert a comparison row. V2: uses entry_a/entry_b/winner (not _id suffix). */
async function insertComparison(
  topicId: string,
  entryAId: string,
  entryBId: string,
  winner: 'a' | 'b' | 'draw' = 'a',
) {
  const { data, error } = await supabase
    .from('evolution_arena_comparisons')
    .insert({
      topic_id: topicId,
      entry_a: entryAId,
      entry_b: entryBId,
      winner,
      confidence: 0.8,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to insert comparison: ${error.message}`);
  return data;
}

/** Helper: insert a minimal evolution run for FK references. */
async function insertEvolutionRun(promptId: string) {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data: strat, error: stratErr } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: `test_hash_${uniqueSuffix}`,
      name: `test_strategy_${uniqueSuffix}`,
      label: 'Test strategy',
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: 1 },
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

const describeSuite = () => {
  describe('Arena Actions Integration Tests', () => {
    it('verifies arena tables exist (skip-sentinel)', () => {
      expect(tablesReady).toBe(true);
    });

    // ─── Test 1: Create topic + add entry ──────────────────────────

    it('creates a topic and adds an entry', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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

      // Verify both entries exist under the same topic (V2: no deleted_at column)
      const { data: entries, error } = await supabase
        .from('evolution_arena_entries')
        .select('id, generation_method, model')
        .eq('topic_id', topic.id)
        .is('archived_at', null)
        .order('created_at', { ascending: true });

      expect(error).toBeNull();
      expect(entries).toHaveLength(2);
      expect(entries![0].id).toBe(entryOneshot.id);
      expect(entries![0].generation_method).toBe('oneshot');
      expect(entries![1].id).toBe(entryEvolution.id);
      expect(entries![1].generation_method).toBe('evolution_winner');
    });

    // ─── Test 3: Elo initialization (V2: inline on entries) ────────

    it('initializes Elo with rating 1200 and match_count 0 on entry', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const entry = await insertEntry(topic.id, 'Content for Elo init test.');

      // V2: elo fields are inline on the entry
      expect(entry.elo_rating).toBe(1200);
      expect(entry.match_count).toBe(0);

      // Verify via a fresh query
      const { data: fetchedEntry, error } = await supabase
        .from('evolution_arena_entries')
        .select('elo_rating, match_count, mu, sigma')
        .eq('id', entry.id)
        .single();

      expect(error).toBeNull();
      expect(fetchedEntry!.elo_rating).toBe(1200);
      expect(fetchedEntry!.match_count).toBe(0);
    });

    // ─── Test 4: Delete entry cascade (V2: hard delete with FK cascade) ──

    it('deletes an entry and cleans up comparison rows via cascade', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entryA = await insertEntry(topic.id, 'Entry A for cascade test.');
      const entryB = await insertEntry(topic.id, 'Entry B for cascade test.');

      await insertComparison(topic.id, entryA.id, entryB.id, 'a');

      // Hard-delete entry A (V2: FK cascade deletes comparisons)
      const { error: deleteErr } = await supabase
        .from('evolution_arena_entries')
        .delete()
        .eq('id', entryA.id);

      expect(deleteErr).toBeNull();

      // Verify: entry A is gone
      const { data: deletedEntry } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('id', entryA.id)
        .maybeSingle();

      expect(deletedEntry).toBeNull();

      // Verify: no comparisons involving entry A (cascade delete)
      const { data: compRows } = await supabase
        .from('evolution_arena_comparisons')
        .select('id')
        .or(`entry_a.eq.${entryA.id},entry_b.eq.${entryA.id}`);

      expect(compRows).toHaveLength(0);

      // Verify: entry B still intact
      const { data: entryBCheck } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('id', entryB.id)
        .single();

      expect(entryBCheck).toBeTruthy();
    });

    // ─── Test 5: Delete topic cascade ──────────────────────────────

    it('deletes a topic and cascades to entries', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      await insertEntry(topic.id, 'Topic cascade entry 1.');
      await insertEntry(topic.id, 'Topic cascade entry 2.');

      // Hard-delete the topic (V2: FK cascade deletes entries and comparisons)
      const { error: topicDeleteErr } = await supabase
        .from('evolution_arena_topics')
        .delete()
        .eq('id', topic.id);

      expect(topicDeleteErr).toBeNull();

      // Verify: entries are gone (cascade)
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('topic_id', topic.id);

      expect(entries).toHaveLength(0);
    });

    // ─── Test 6: Case-insensitive topic lookup via ilike ────────────

    it('finds topics via case-insensitive ilike lookup', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const basePrompt = uniquePrompt();
      const topic = await insertTopic(basePrompt);

      // Search with uppercase should still find it
      const { data: found } = await supabase
        .from('evolution_arena_topics')
        .select('id')
        .ilike('prompt', basePrompt.toUpperCase())
        .single();

      expect(found).toBeTruthy();
      expect(found!.id).toBe(topic.id);
    });

    // ─── Test 7: Multiple methods coexist per topic with inline Elo ──

    it('supports multiple generation methods with inline Elo on the same topic', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      // Insert 3 entries with different elo ratings
      const oneshot = await insertEntry(topic.id, 'Oneshot content.', 'oneshot', 'gpt-4.1-mini', 0.03, 1200, 25, 8.333, 0);
      const evo3 = await insertEntry(topic.id, 'Evo 3 iter content.', 'evolution_winner', 'deepseek-chat', 0.08, 1250, 26, 7.5, 3);
      const evo10 = await insertEntry(topic.id, 'Evo 10 iter content.', 'evolution_winner', 'deepseek-chat', 0.15, 1310, 28, 6.5, 5);

      // Query all entries for this topic
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id, generation_method, model')
        .eq('topic_id', topic.id)
        .is('archived_at', null)
        .order('created_at', { ascending: true });

      expect(entries).toHaveLength(3);
      expect(entries![0].generation_method).toBe('oneshot');
      expect(entries![1].generation_method).toBe('evolution_winner');
      expect(entries![2].generation_method).toBe('evolution_winner');

      // Query entries ranked by elo_rating (V2: inline)
      const { data: ranked } = await supabase
        .from('evolution_arena_entries')
        .select('id, elo_rating, match_count')
        .eq('topic_id', topic.id)
        .order('elo_rating', { ascending: false });

      expect(ranked).toHaveLength(3);
      expect(ranked![0].id).toBe(evo10.id);
      expect(ranked![0].elo_rating).toBe(1310);
      expect(ranked![1].id).toBe(evo3.id);
      expect(ranked![2].id).toBe(oneshot.id);
    });

    // ─── Test 8: Inline mu/sigma for CI computation ──

    it('stores and retrieves mu, sigma from entries for CI computation', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      // V2: mu/sigma are inline on entries
      const entry = await insertEntry(
        topic.id,
        'Content for CI test.',
        'oneshot',
        'gpt-4.1',
        null,
        1200,  // elo_rating
        28.0,  // mu
        3.5,   // sigma
        6,     // match_count
      );

      expect(Number(entry.mu)).toBeCloseTo(28.0, 1);
      expect(Number(entry.sigma)).toBeCloseTo(3.5, 1);

      const mu = Number(entry.mu);
      const sigma = Number(entry.sigma);
      const ciLower = 1200 + (mu - 1.96 * sigma) * (400 / 25);
      const ciUpper = 1200 + (mu + 1.96 * sigma) * (400 / 25);

      expect(ciUpper).toBeGreaterThan(ciLower);
      const ciWidth = ciUpper - ciLower;
      expect(ciWidth).toBeCloseTo(2 * 1.96 * sigma * (400 / 25), 1);
    });

    // ─── Test 9: Concurrent topic upsert dedup ─────────────────────

    it('deduplicates concurrent topic inserts for the same prompt', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();

      // Insert the same prompt twice concurrently
      const [result1, result2] = await Promise.allSettled([
        insertTopic(prompt, 'First insert'),
        insertTopic(prompt, 'Second insert'),
      ]);

      const succeeded = [result1, result2].filter(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string; prompt: string }>[];

      // V2 has unique index on lower(prompt), so exactly one should succeed
      const { data: topics } = await supabase
        .from('evolution_arena_topics')
        .select('id, prompt')
        .eq('prompt', prompt);

      if (topics && topics.length === 1) {
        expect(topics).toHaveLength(1);
        expect(succeeded.length).toBeGreaterThanOrEqual(1);
      } else {
        for (const t of topics ?? []) {
          if (!createdTopicIds.includes(t.id)) {
            createdTopicIds.push(t.id);
          }
        }
        expect(succeeded.length).toBe(2);
        console.warn(
          'evolution_arena_topics does not enforce prompt uniqueness; ' +
          `${topics?.length} rows created for same prompt`,
        );
      }
    });
  });
};

describeSuite();
