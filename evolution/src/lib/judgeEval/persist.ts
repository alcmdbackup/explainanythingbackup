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
import { dbToRating, toDisplayElo } from '../shared/computeRatings';

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

export async function loadTestSetByName(db: Db, name: string): Promise<JudgeEvalTestSet | null> {
  const { data, error } = await db
    .from('judge_eval_test_sets')
    .select('*')
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return (data as JudgeEvalTestSet | null) ?? null;
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

/** One member pair for the contents view. Ratings are surfaced as display **Elo** (+ uncertainty),
 *  NOT the raw OpenSkill mu/sigma stored on the pair — the rest of the admin UI speaks Elo. */
export interface TestSetContentPair {
  label: string;
  pair_kind: JudgeEvalPair['pair_kind'];
  variant_a_id: string;
  variant_b_id: string;
  elo_a: number | null;
  elo_b: number | null;
  uncertainty_a: number | null;
  uncertainty_b: number | null;
  /** |elo_a - elo_b| — the Elo-gap ground-truth signal; null when either side lacks a rating. */
  elo_gap: number | null;
  expected_winner: JudgeEvalPair['expected_winner'];
  gap_kind: JudgeEvalPair['gap_kind'];
  baseline_confidence: JudgeEvalPair['baseline_confidence'];
}

export interface TestSetContents {
  testSet: JudgeEvalTestSet;
  /** Member pairs WITHOUT the snapshot texts (see getTestSetPairTexts for lazy per-pair fetch). */
  pairs: TestSetContentPair[];
  /** Frozen members for the kind filter. */
  memberCount: number;
  /** Members that still resolve against the (possibly re-seeded) bank. */
  resolvedCount: number;
  /** memberCount - resolvedCount: frozen members whose label is no longer in the bank. */
  orphanCount: number;
}

// Stored mu/sigma are OpenSkill-scale; project to display Elo so the UI never shows raw mu.
// mu/sigma are nullable on a pair — Elo is null unless both are present.
function oneSideElo(mu: number | null, sigma: number | null): { elo: number; uncertainty: number } | null {
  if (mu == null || sigma == null) return null;
  const r = dbToRating(mu, sigma);
  return { elo: Math.round(toDisplayElo(r.elo)), uncertainty: Math.round(r.uncertainty) };
}

/** Project a stored pair to the Elo-bearing, text-stripped shape shared by the contents + curation views. */
function projectPairElo(p: JudgeEvalPair): TestSetContentPair {
  const a = oneSideElo(p.mu_a, p.sigma_a);
  const b = oneSideElo(p.mu_b, p.sigma_b);
  return {
    label: p.label,
    pair_kind: p.pair_kind,
    variant_a_id: p.variant_a_id,
    variant_b_id: p.variant_b_id,
    elo_a: a?.elo ?? null,
    elo_b: b?.elo ?? null,
    uncertainty_a: a?.uncertainty ?? null,
    uncertainty_b: b?.uncertainty ?? null,
    elo_gap: a && b ? Math.abs(a.elo - b.elo) : null,
    expected_winner: p.expected_winner,
    gap_kind: p.gap_kind,
    baseline_confidence: p.baseline_confidence,
  };
}

/**
 * Load a test set's metadata + member pairs for the contents view, WITHOUT the snapshot texts
 * (a large set's texts can be megabytes; the detail page fetches them per-row via
 * getTestSetPairTexts). Also returns member-vs-resolved counts so the UI can warn when the bank
 * was re-seeded and some frozen members no longer resolve — loadTestSetPairs silently drops those.
 */
export async function loadTestSetContents(
  db: Db,
  testSetId: string,
  kindFilter: JudgeKindFilter,
): Promise<TestSetContents> {
  const { testSet, pairs: full } = await loadTestSetPairs(db, testSetId, kindFilter);

  let memberQ = db
    .from('judge_eval_test_set_members')
    .select('pair_label', { count: 'exact', head: true })
    .eq('test_set_id', testSetId);
  if (kindFilter !== 'both') memberQ = memberQ.eq('pair_kind', kindFilter);
  const { count, error } = await memberQ;
  if (error) throw error;
  const memberCount = count ?? 0;

  const pairs: TestSetContentPair[] = full.map(projectPairElo);

  return {
    testSet,
    pairs,
    memberCount,
    resolvedCount: pairs.length,
    orphanCount: Math.max(0, memberCount - pairs.length),
  };
}

/** Fetch the two snapshot texts for one member pair (lazy row-expand on the contents page). */
export async function getTestSetPairTexts(
  db: Db,
  testSetId: string,
  pairLabel: string,
): Promise<{ text_a: string; text_b: string }> {
  const { pairs } = await loadTestSetPairs(db, testSetId, 'both');
  const pair = pairs.find((p) => p.label === pairLabel);
  if (!pair) throw new Error(`Pair not found in test set: ${pairLabel}`);
  return { text_a: pair.text_a, text_b: pair.text_b };
}

/** One bank pair for the Clone & curate picker — projected Elo + whether it's a current member. */
export interface CurationPair extends TestSetContentPair {
  isMember: boolean;
}

export interface CurationFilters {
  kind?: JudgeKindFilter;
  /** 'member' = current members of the source set; 'non_member' = bank pairs not in the set. */
  membership?: 'all' | 'member' | 'non_member';
  gapKind?: 'all' | 'large' | 'close';
  /** Case-insensitive substring match on pair_label. */
  search?: string;
  /** Elo bounds — a pair passes only when BOTH sides are within them (null Elo → excluded if set). */
  eloMin?: number | null;
  eloMax?: number | null;
  limit?: number;
  offset?: number;
}

export interface CurationResult {
  pairs: CurationPair[];
  /** Filtered count (for pagination). */
  total: number;
  /** Current member count of the source set (across both kinds). */
  memberCount: number;
  /** ALL current member labels of the source set (labels are tiny — seeds the picker's initial
   *  selection without a second query, regardless of the active filter). */
  memberLabels: string[];
  /** ALL labels matching the filter (labels are tiny — powers "select all (filtered)"). */
  filteredLabels: string[];
}

/**
 * List the source set's BANK pairs (the available universe for a curated clone), projected to Elo +
 * text-stripped, each flagged `isMember`. Filtering happens in-memory over the parsed bank JSONB
 * (one row) then paginates; the Elo filter requires BOTH sides within bounds. Powers the Clone &
 * curate picker — the chosen labels feed `cloneTestSet({ strategy:'manual', manualLabels })`.
 */
export async function loadBankPairsForCuration(
  db: Db,
  testSetId: string,
  filters: CurationFilters = {},
): Promise<CurationResult> {
  const { data: ts, error: tsErr } = await db
    .from('judge_eval_test_sets')
    .select('pair_bank_id')
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
    .select('pair_label')
    .eq('test_set_id', testSetId);
  if (mErr) throw mErr;
  const memberLabels = new Set((members ?? []).map((m) => m.pair_label));

  const kind = filters.kind ?? 'both';
  const membership = filters.membership ?? 'all';
  const gapKind = filters.gapKind ?? 'all';
  const search = filters.search?.trim().toLowerCase() ?? '';
  const { eloMin, eloMax } = filters;

  const withinElo = (p: CurationPair): boolean => {
    if (eloMin == null && eloMax == null) return true;
    if (p.elo_a == null || p.elo_b == null) return false; // both sides required
    if (eloMin != null && (p.elo_a < eloMin || p.elo_b < eloMin)) return false;
    if (eloMax != null && (p.elo_a > eloMax || p.elo_b > eloMax)) return false;
    return true;
  };

  const projected = allPairs
    .map((p): CurationPair => ({ ...projectPairElo(p), isMember: memberLabels.has(p.label) }))
    .filter((p) => kind === 'both' || p.pair_kind === kind)
    .filter((p) => membership === 'all' || (membership === 'member' ? p.isMember : !p.isMember))
    .filter((p) => gapKind === 'all' || p.gap_kind === gapKind)
    .filter((p) => !search || p.label.toLowerCase().includes(search))
    .filter(withinElo)
    .sort((a, b) =>
      a.pair_kind !== b.pair_kind ? (a.pair_kind < b.pair_kind ? -1 : 1) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );

  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  return {
    pairs: projected.slice(offset, offset + limit),
    total: projected.length,
    memberCount: memberLabels.size,
    memberLabels: [...memberLabels].sort(),
    filteredLabels: projected.map((p) => p.label),
  };
}

/**
 * Edit a test set's METADATA only (name/description). Membership is frozen — strategy/seed/size
 * are intentionally not editable (they determine membership; an in-place change would silently
 * corrupt comparability for existing runs sharing the same settings_key). Maps a unique-name
 * violation (23505) to a friendly error since `name` is the createEvalRun/CLI lookup key.
 */
export async function updateTestSetMetadata(
  db: Db,
  input: { testSetId: string; name?: string; description?: string | null },
): Promise<JudgeEvalTestSet> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (Object.keys(patch).length === 0) {
    const { data, error } = await db
      .from('judge_eval_test_sets')
      .select('*')
      .eq('id', input.testSetId)
      .single();
    if (error) throw error;
    return data as JudgeEvalTestSet;
  }
  const { data, error } = await db
    .from('judge_eval_test_sets')
    .update(patch)
    .eq('id', input.testSetId)
    .select('*')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        `A test set named "${input.name}" already exists — names must be unique. ` +
          `(Renaming may also break saved CLI --test-set scripts.)`,
      );
    }
    throw error;
  }
  return data as JudgeEvalTestSet;
}

export interface CloneTestSetInput {
  sourceTestSetId: string;
  newName: string;
  sizeArticle?: number;
  sizeParagraph?: number;
  strategy?: CreateTestSetInput['strategy'];
  seed?: number;
  manualLabels?: string[];
  description?: string | null;
}

/**
 * Clone a test set into a NEW frozen set — the only safe way to change membership/strategy/seed/
 * size. Re-samples the source's CURRENT pair-bank with the given (or inherited) params, yielding a
 * new id → new settings_keys, so the source's existing eval runs stay comparable. Throws on name
 * collision (never mutates an existing set), including the TOCTOU 23505 race.
 */
export async function cloneTestSet(
  db: Db,
  input: CloneTestSetInput,
): Promise<{ testSet: JudgeEvalTestSet; created: boolean }> {
  const { data: src, error: srcErr } = await db
    .from('judge_eval_test_sets')
    .select('*')
    .eq('id', input.sourceTestSetId)
    .single();
  if (srcErr) throw srcErr;
  const source = src as JudgeEvalTestSet;

  const { data: bankRow, error: bErr } = await db
    .from('judge_eval_pair_banks')
    .select('*')
    .eq('id', source.pair_bank_id)
    .single();
  if (bErr) throw bErr;
  const bank: JudgeEvalPairBank = {
    id: bankRow.id,
    name: bankRow.name,
    description: bankRow.description,
    source_topic_id: bankRow.source_topic_id,
    pairs: parsePairs(bankRow.pairs),
    created_at: bankRow.created_at,
  };

  const strategy = input.strategy ?? (source.strategy as CreateTestSetInput['strategy']);
  // For a manual (curated) clone, membership is exactly the chosen labels — so record the actual
  // per-kind selected counts as the new set's sizes (manual ignores seed/size for selection).
  let sizeArticle = input.sizeArticle ?? source.size_article;
  let sizeParagraph = input.sizeParagraph ?? source.size_paragraph;
  if (strategy === 'manual') {
    const labels = new Set(input.manualLabels ?? []);
    const chosen = bank.pairs.filter((p) => labels.has(p.label));
    sizeArticle = chosen.filter((p) => p.pair_kind === 'article').length;
    sizeParagraph = chosen.filter((p) => p.pair_kind === 'paragraph').length;
  }

  let result: { testSet: JudgeEvalTestSet; created: boolean };
  try {
    result = await getOrCreateTestSet(db, bank, {
      name: input.newName,
      description: input.description ?? null,
      strategy,
      seed: input.seed ?? source.seed,
      sizeArticle,
      sizeParagraph,
      manualLabels: input.manualLabels,
    });
  } catch (e) {
    // TOCTOU: another clone with the same name inserted between get-or-create's check and insert.
    if ((e as { code?: string }).code === '23505') {
      throw new Error(`A test set named "${input.newName}" already exists — choose a different name.`);
    }
    throw e;
  }
  if (!result.created) {
    // Name already existed: get-or-create returned it UNCHANGED. Clone must never alias/mutate it.
    throw new Error(`A test set named "${input.newName}" already exists — choose a different name.`);
  }
  return result;
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
