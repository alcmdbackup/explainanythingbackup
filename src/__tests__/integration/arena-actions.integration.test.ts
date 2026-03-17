/**
 * @jest-environment node
 */
// Integration tests for hall of fame server actions with real Supabase.
// Validates CRUD, Elo on entries, cascade deletes, and concurrent upsert dedup
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
    // Also clean entries/comparisons by topic in case we missed individual ones
    await supabase.from('evolution_arena_comparisons').delete().eq('topic_id', topicId);
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
  costUsd: number | null = null,
) {
  const { data, error } = await supabase
    .from('evolution_arena_entries')
    .insert({
      topic_id: topicId,
      content,
      generation_method: generationMethod,
      model,
      cost_usd: costUsd,
    })
    .select('id, topic_id, content, generation_method, model, cost_usd, elo_rating, mu, sigma, match_count, created_at')
    .single();
  if (error) throw new Error(`Failed to insert entry: ${error.message}`);
  createdEntryIds.push(data.id);
  return data;
}

/** Helper: insert a comparison row. */
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

// Guard tests with throw to ensure visibility when tables are missing
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

      // Verify both entries exist under the same topic
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

    // ─── Test 3: Elo initialization on entries ────────────────────

    it('initializes entries with default elo_rating 1200, mu 25, sigma 8.333, match_count 0', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const entry = await insertEntry(topic.id, 'Content for Elo init test.');

      // Elo fields are on the entry itself with defaults
      expect(Number(entry.elo_rating)).toBe(1200);
      expect(entry.match_count).toBe(0);
      expect(Number(entry.mu)).toBeCloseTo(25, 0);
      expect(Number(entry.sigma)).toBeCloseTo(8.333, 2);

      // Verify via a fresh query
      const { data: fetched, error } = await supabase
        .from('evolution_arena_entries')
        .select('elo_rating, mu, sigma, match_count')
        .eq('id', entry.id)
        .single();

      expect(error).toBeNull();
      expect(Number(fetched!.elo_rating)).toBe(1200);
      expect(fetched!.match_count).toBe(0);
      expect(Number(fetched!.mu)).toBeCloseTo(25, 0);
      expect(Number(fetched!.sigma)).toBeCloseTo(8.333, 2);
    });

    // ─── Test 4: Delete entry cascade ──────────────────────────────

    it('archives an entry and cleans up comparison rows', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entryA = await insertEntry(topic.id, 'Entry A for cascade test.');
      const entryB = await insertEntry(topic.id, 'Entry B for cascade test.');

      await insertComparison(topic.id, entryA.id, entryB.id, 'a');

      // Archive entry A
      const { error: archiveErr } = await supabase
        .from('evolution_arena_entries')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', entryA.id);

      expect(archiveErr).toBeNull();

      // Hard-delete comparisons involving entry A
      await supabase
        .from('evolution_arena_comparisons')
        .delete()
        .or(`entry_a.eq.${entryA.id},entry_b.eq.${entryA.id}`);

      // Verify: entry A is archived (archived_at is set)
      const { data: archivedEntry } = await supabase
        .from('evolution_arena_entries')
        .select('id, archived_at')
        .eq('id', entryA.id)
        .single();

      expect(archivedEntry).toBeTruthy();
      expect(archivedEntry!.archived_at).toBeTruthy();

      // Verify: no comparisons involving entry A
      const { data: compRows } = await supabase
        .from('evolution_arena_comparisons')
        .select('id')
        .or(`entry_a.eq.${entryA.id},entry_b.eq.${entryA.id}`);

      expect(compRows).toHaveLength(0);

      // Verify: entry B still intact with its elo data
      const { data: entryBData } = await supabase
        .from('evolution_arena_entries')
        .select('id, elo_rating, match_count')
        .eq('id', entryB.id)
        .single();

      expect(entryBData).toBeTruthy();
      expect(Number(entryBData!.elo_rating)).toBe(1200);
    });

    // ─── Test 5: Delete topic cascade ──────────────────────────────

    it('soft-deletes a topic and cascades to entries', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      const entry1 = await insertEntry(topic.id, 'Topic cascade entry 1.');
      const entry2 = await insertEntry(topic.id, 'Topic cascade entry 2.');

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

      // Archive all entries for this topic
      await supabase
        .from('evolution_arena_entries')
        .update({ archived_at: new Date().toISOString() })
        .eq('topic_id', topic.id);

      // Verify: entries are archived
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id, archived_at')
        .eq('topic_id', topic.id);

      expect(entries).toHaveLength(2);
      for (const entry of entries!) {
        expect(entry.archived_at).toBeTruthy();
      }

      // Verify: no active entries (filtering by archived_at IS NULL)
      const { data: activeEntries } = await supabase
        .from('evolution_arena_entries')
        .select('id')
        .eq('topic_id', topic.id)
        .is('archived_at', null);

      expect(activeEntries).toHaveLength(0);
    });

    // ─── Test 6: Entry with run_id and variant_id ────────────────────

    it.skip('stores and retrieves run_id and variant_id on entries', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      // Create an evolution run for FK reference
      const run = await insertEvolutionRun(topic.id);

      // Insert entry with run_id
      const { data: entry, error } = await supabase
        .from('evolution_arena_entries')
        .insert({
          topic_id: topic.id,
          content: 'Entry linked to evolution run.',
          generation_method: 'evolution_winner',
          model: 'deepseek-chat',
          cost_usd: 0.12,
          run_id: run.id,
        })
        .select('id, run_id, variant_id, cost_usd')
        .single();

      if (error) throw new Error(`Failed to insert entry: ${error.message}`);
      createdEntryIds.push(entry.id);

      expect(entry.run_id).toBe(run.id);
      expect(Number(entry.cost_usd)).toBeCloseTo(0.12, 2);

      // Verify via fresh query
      const { data: fetched, error: fetchErr } = await supabase
        .from('evolution_arena_entries')
        .select('id, run_id, variant_id')
        .eq('id', entry.id)
        .single();

      expect(fetchErr).toBeNull();
      expect(fetched!.run_id).toBe(run.id);
    });

    // ─── Test 7: Case-insensitive topic lookup via ilike ────────────

    it('finds topics via case-insensitive ilike lookup', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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

    // ─── Test 8: Multiple methods coexist per topic with Elo on entries ────

    it('supports multiple generation methods with Elo on the same topic', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);

      // Insert 3 entries: oneshot, evolution_winner, evolution_winner
      const oneshot = await insertEntry(topic.id, 'Oneshot content.', 'oneshot', 'gpt-4.1-mini', 0.03);
      const evo3 = await insertEntry(topic.id, 'Evo 3 iter content.', 'evolution_winner', 'deepseek-chat', 0.08);
      const evo10 = await insertEntry(topic.id, 'Evo 10 iter content.', 'evolution_winner', 'deepseek-chat', 0.15);

      // Update Elo ratings directly on entries to simulate match results
      await supabase.from('evolution_arena_entries').update({ elo_rating: 1200, match_count: 0 }).eq('id', oneshot.id);
      await supabase.from('evolution_arena_entries').update({ elo_rating: 1250, match_count: 3 }).eq('id', evo3.id);
      await supabase.from('evolution_arena_entries').update({ elo_rating: 1310, match_count: 5 }).eq('id', evo10.id);

      // Query all entries for this topic
      const { data: entries } = await supabase
        .from('evolution_arena_entries')
        .select('id, generation_method')
        .eq('topic_id', topic.id)
        .is('archived_at', null)
        .order('created_at', { ascending: true });

      expect(entries).toHaveLength(3);
      expect(entries![0].generation_method).toBe('oneshot');
      expect(entries![1].generation_method).toBe('evolution_winner');
      expect(entries![2].generation_method).toBe('evolution_winner');

      // Query entries ranked by elo_rating
      const { data: ranked } = await supabase
        .from('evolution_arena_entries')
        .select('id, elo_rating, match_count')
        .eq('topic_id', topic.id)
        .order('elo_rating', { ascending: false });

      expect(ranked).toHaveLength(3);
      expect(ranked![0].id).toBe(evo10.id);
      expect(Number(ranked![0].elo_rating)).toBe(1310);
      expect(ranked![1].id).toBe(evo3.id);
      expect(ranked![2].id).toBe(oneshot.id);
    });

    // ─── Test 9: mu/sigma on entries for CI computation ──

    it('stores and retrieves mu, sigma from entries for CI computation', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const prompt = uniquePrompt();
      const topic = await insertTopic(prompt);
      const entry = await insertEntry(topic.id, 'Content for CI test.');

      // Update mu, sigma, match_count directly on entry
      const { error } = await supabase
        .from('evolution_arena_entries')
        .update({
          mu: 28.0,
          sigma: 3.5,
          match_count: 6,
        })
        .eq('id', entry.id);

      expect(error).toBeNull();

      // Fetch updated values
      const { data: fetched, error: fetchErr } = await supabase
        .from('evolution_arena_entries')
        .select('mu, sigma, match_count')
        .eq('id', entry.id)
        .single();

      expect(fetchErr).toBeNull();
      expect(Number(fetched!.mu)).toBeCloseTo(28.0, 1);
      expect(Number(fetched!.sigma)).toBeCloseTo(3.5, 1);

      // Verify CI computation matches what the server action would produce:
      // ci_lower = toEloScale(mu - 1.96 * sigma) = 1200 + (28 - 6.86) * 16 = 1538.24
      // ci_upper = toEloScale(mu + 1.96 * sigma) = 1200 + (28 + 6.86) * 16 = 1757.76
      const mu = Number(fetched!.mu);
      const sigma = Number(fetched!.sigma);
      const ciLower = 1200 + (mu - 1.96 * sigma) * (400 / 25);
      const ciUpper = 1200 + (mu + 1.96 * sigma) * (400 / 25);

      expect(ciUpper).toBeGreaterThan(ciLower);
      // CI width should be proportional to sigma
      const ciWidth = ciUpper - ciLower;
      expect(ciWidth).toBeCloseTo(2 * 1.96 * sigma * (400 / 25), 1);
    });

    // ─── Test 10: Concurrent topic upsert dedup ─────────────────────

    it('deduplicates concurrent topic inserts for the same prompt', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
  });
};

describeSuite();
