// DB persistence for the judge-evaluation tool: load/upsert pair-banks, materialize + freeze
// test sets, resolve frozen members back to full pairs, upsert eval runs by settings_key
// (idempotent), and bulk-insert call rows. All access goes through the service-role client
// (deny-all RLS). The pure selection/hashing logic lives in testSet.ts / settings.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  judgeEvalPairSchema,
  type JudgeEvalPair,
  type JudgeEvalPairBank,
  type JudgeEvalTestSet,
  type JudgeEvalCallResult,
  type JudgeKindFilter,
  type JudgeReasoningEffort,
} from './schemas';
import { selectTestSetMembers, assertMembersExist } from './testSet';
import { buildPromptVariantHash, buildSettingsKey } from './settings';

type Db = SupabaseClient<Database>;

function parsePairs(raw: unknown): JudgeEvalPair[] {
  const parsed = judgeEvalPairSchema.array().safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Pair-bank pairs failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function loadPairBankByName(db: Db, name: string): Promise<JudgeEvalPairBank | null> {
  const { data, error } = await db
    .from('judge_eval_pair_banks')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    source_topic_id: data.source_topic_id,
    pairs: parsePairs(data.pairs),
    created_at: data.created_at,
  };
}

export async function upsertPairBank(
  db: Db,
  input: { name: string; description?: string | null; sourceTopicId?: string | null; pairs: JudgeEvalPair[] },
): Promise<string> {
  const { data, error } = await db
    .from('judge_eval_pair_banks')
    .upsert(
      {
        name: input.name,
        description: input.description ?? null,
        source_topic_id: input.sourceTopicId ?? null,
        pairs: input.pairs as unknown as Database['public']['Tables']['judge_eval_pair_banks']['Insert']['pairs'],
      },
      { onConflict: 'name' },
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export interface CreateTestSetInput {
  name: string;
  description?: string | null;
  strategy: 'random' | 'stratified_confidence' | 'stratified_gap' | 'manual';
  seed: number;
  sizeArticle: number;
  sizeParagraph: number;
  manualLabels?: string[];
}

/**
 * Get-or-create a frozen test set. If a set with this name already exists, it is returned
 * UNCHANGED (membership is frozen — re-seeding the bank never mutates an existing set).
 */
export async function getOrCreateTestSet(
  db: Db,
  bank: JudgeEvalPairBank,
  input: CreateTestSetInput,
): Promise<{ testSet: JudgeEvalTestSet; created: boolean }> {
  const existing = await db
    .from('judge_eval_test_sets')
    .select('*')
    .eq('name', input.name)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    return { testSet: existing.data as JudgeEvalTestSet, created: false };
  }

  const members = selectTestSetMembers(bank.pairs, {
    strategy: input.strategy,
    seed: input.seed,
    sizeArticle: input.sizeArticle,
    sizeParagraph: input.sizeParagraph,
    manualLabels: input.manualLabels,
  });
  assertMembersExist(members, bank.pairs);

  const { data: ts, error: tsErr } = await db
    .from('judge_eval_test_sets')
    .insert({
      pair_bank_id: bank.id,
      name: input.name,
      description: input.description ?? null,
      strategy: input.strategy,
      seed: input.seed,
      size_article: input.sizeArticle,
      size_paragraph: input.sizeParagraph,
    })
    .select('*')
    .single();
  if (tsErr) throw tsErr;

  if (members.length > 0) {
    const { error: mErr } = await db.from('judge_eval_test_set_members').insert(
      members.map((m) => ({ test_set_id: ts.id, pair_label: m.pair_label, pair_kind: m.pair_kind })),
    );
    if (mErr) throw mErr;
  }
  return { testSet: ts as JudgeEvalTestSet, created: true };
}

/** Resolve a test set's frozen members back to full pairs from its bank, kind-filtered. */
export async function loadTestSetPairs(
  db: Db,
  testSetId: string,
  kindFilter: JudgeKindFilter,
): Promise<{ testSet: JudgeEvalTestSet; pairs: JudgeEvalPair[] }> {
  const { data: ts, error: tsErr } = await db
    .from('judge_eval_test_sets')
    .select('*')
    .eq('id', testSetId)
    .single();
  if (tsErr) throw tsErr;

  const { data: bankRow, error: bErr } = await db
    .from('judge_eval_pair_banks')
    .select('pairs')
    .eq('id', ts.pair_bank_id)
    .single();
  if (bErr) throw bErr;
  const allPairs = parsePairs(bankRow.pairs);

  const { data: members, error: mErr } = await db
    .from('judge_eval_test_set_members')
    .select('pair_label, pair_kind')
    .eq('test_set_id', testSetId);
  if (mErr) throw mErr;

  const wanted = new Set(
    (members ?? [])
      .filter((m) => kindFilter === 'both' || m.pair_kind === kindFilter)
      .map((m) => m.pair_label),
  );
  const pairs = allPairs.filter((p) => wanted.has(p.label));
  return { testSet: ts as JudgeEvalTestSet, pairs };
}

export interface UpsertRunInput {
  testSetId: string;
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  kindFilter: JudgeKindFilter;
  promptVariant: string | null;
  repeats: number;
  notes?: string | null;
}

/** Upsert an eval run by settings_key (idempotent: same settings + test set → one row). */
export async function upsertRun(db: Db, input: UpsertRunInput): Promise<{ runId: string; settingsKey: string }> {
  const promptVariantHash = buildPromptVariantHash(input.promptVariant);
  const settingsKey = buildSettingsKey({
    judgeModel: input.judgeModel,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort,
    promptVariantHash,
    kindFilter: input.kindFilter,
    testSetId: input.testSetId,
  });
  const { data, error } = await db
    .from('judge_eval_runs')
    .upsert(
      {
        test_set_id: input.testSetId,
        judge_model: input.judgeModel,
        temperature: input.temperature,
        reasoning_effort: input.reasoningEffort,
        kind_filter: input.kindFilter,
        prompt_variant: input.promptVariant,
        prompt_variant_hash: promptVariantHash,
        repeats: input.repeats,
        settings_key: settingsKey,
        notes: input.notes ?? null,
      },
      { onConflict: 'settings_key' },
    )
    .select('id')
    .single();
  if (error) throw error;
  return { runId: data.id, settingsKey };
}

/** Replace a run's call rows, then bulk-insert the fresh results (idempotent re-run). */
export async function replaceCalls(db: Db, runId: string, results: JudgeEvalCallResult[]): Promise<void> {
  const del = await db.from('judge_eval_calls').delete().eq('eval_run_id', runId);
  if (del.error) throw del.error;
  if (results.length === 0) return;
  const rows = results.map((r) => ({ eval_run_id: runId, ...r }));
  const { error } = await db.from('judge_eval_calls').insert(rows);
  if (error) throw error;
}
