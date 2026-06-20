// Weight-inference server actions (human mode): create a session (seed an article pool
// from an arena topic + materialize the pair set), record overall + per-criterion
// verdicts, serve the next pair, preview ratings-needed, compute the fit, and export the
// inferred weights as a real evolution_judge_rubrics row. Auto-mode batch judging lives
// in the API route (Phase 5); create/preview/fit/export stay plain server actions.
//
// rater_id is ALWAYS server-derived from ctx.adminUserId — never a client input.

'use server';

import { z } from 'zod';
import { adminAction, type AdminContext } from './adminAction';
import { validateCriteriaIds, getCriteriaForEvaluation } from './criteriaActions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSeededRng } from '@evolution/lib/metrics/experimentMetrics';
import {
  evolutionWiSessionInsertSchema,
  type EvolutionWiSessionRow,
} from '@evolution/lib/schemas';
import {
  auditConsistency,
  fitWeights,
  orientToCanonical,
  pairConfidence,
  remainingPairs,
  requiredRatings,
  weightCIs,
  type ConsistencyAudit,
  type PairObservation,
  type ReplicatedPair,
  type Verdict3,
  type WeightFitResult,
} from '@evolution/lib/weightInference';

// ─── Kill switch ───────────────────────────────────────────────────

function assertEnabled(): void {
  if (process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED === 'false') {
    throw new Error('Weight inference is disabled (EVOLUTION_WEIGHT_INFERENCE_ENABLED=false).');
  }
}

function pgMsg(e: { message?: string; details?: string; hint?: string; code?: string } | null): string {
  if (!e) return 'unknown error';
  return e.message || e.details || e.hint || (e.code ? `code ${e.code}` : '') || JSON.stringify(e);
}

/** Deterministic uint32 seed from a session id (for reproducible pair selection). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Types ─────────────────────────────────────────────────────────

export interface WiSessionListItem {
  id: string;
  name: string;
  mode: 'human' | 'auto';
  status: string;
  judge_model: string | null;
  criteria_count: number;
  pairs_total: number;
  pairs_overall_done: number;
  created_at: string;
}

export interface WiNextPair {
  comparisonId: string;
  pass: number;
  shownSwapped: boolean;
  /** Article rendered on the LEFT / RIGHT (already oriented for display). */
  left: { id: string; label: string; content: string };
  right: { id: string; label: string; content: string };
  /** Present for the per-criterion step. */
  criteria?: Array<{ id: string; name: string; description: string | null }>;
}

export interface WiWeightOut {
  criteriaId: string;
  name: string;
  weight: number;
  ciLow: number;
  ciHigh: number;
}

export interface WiFitResult {
  weights: WiWeightOut[];
  trainAccuracy: number;
  heldOutAccuracy: number | null;
  nPairs: number;
  degenerate: boolean;
  flags: WeightFitResult['flags'];
  audit: ConsistencyAudit;
  judgeModel: string | null;
  mode: 'human' | 'auto';
}

interface ArticleRow {
  id: string;
  label: string;
  content: string;
  mu: number | null;
  sigma: number | null;
}

interface SessionCriterion {
  id: string;
  name: string;
  description: string | null;
}

interface CompPickRow {
  id: string;
  article_a_id: string;
  article_b_id: string;
  pass: number;
  shown_swapped: boolean;
}

// ─── Internal helpers (not server actions, but async — safe in a 'use server' file) ──

async function loadSession(db: SupabaseClient, sessionId: string): Promise<EvolutionWiSessionRow> {
  const { data, error } = await db
    .from('evolution_weight_inference_sessions')
    .select('*')
    .eq('id', sessionId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new Error(`weight-inference session not found: ${pgMsg(error)}`);
  return data as unknown as EvolutionWiSessionRow;
}

async function loadSessionCriteria(
  db: SupabaseClient,
  sessionId: string,
): Promise<SessionCriterion[]> {
  const { data, error } = await db
    .from('evolution_weight_inference_criteria')
    .select('criteria_id, position')
    .eq('session_id', sessionId)
    .order('position', { ascending: true });
  if (error) throw new Error(`load criteria failed: ${pgMsg(error)}`);
  const ids = (data ?? []).map((r) => r.criteria_id as string);
  const byId = await getCriteriaForEvaluation(db, ids);
  return ids.map((id) => {
    const c = byId.get(id);
    return { id, name: c?.name ?? id, description: c?.description ?? null };
  });
}

/** Build PairObservation rows + the replica set for the fit/audit from persisted rows. */
async function loadFitData(
  db: SupabaseClient,
  sessionId: string,
  mode: 'human' | 'auto',
): Promise<{ observations: PairObservation[]; replicas: ReplicatedPair[] }> {
  const source = mode === 'auto' ? 'llm' : 'human';
  const { data: comps, error: cErr } = await db
    .from('evolution_weight_inference_comparisons')
    .select('id, article_a_id, article_b_id, pass, overall_winner')
    .eq('session_id', sessionId)
    .eq('source', source);
  if (cErr) throw new Error(`load comparisons failed: ${pgMsg(cErr)}`);
  const comparisons = comps ?? [];

  const compIds = comparisons.map((c) => c.id as string);
  const verdictsByComp = new Map<string, Record<string, Verdict3>>();
  for (const id of compIds) verdictsByComp.set(id, {});
  // chunk the verdict fetch to stay under PostgREST URL limits
  for (let i = 0; i < compIds.length; i += 100) {
    const chunk = compIds.slice(i, i + 100);
    const { data: dv, error: dErr } = await db
      .from('evolution_weight_inference_dimension_verdicts')
      .select('comparison_id, criteria_id, verdict')
      .in('comparison_id', chunk);
    if (dErr) throw new Error(`load verdicts failed: ${pgMsg(dErr)}`);
    for (const row of dv ?? []) {
      const m = verdictsByComp.get(row.comparison_id as string);
      if (m) m[row.criteria_id as string] = row.verdict as Verdict3;
    }
  }

  const pairKey = (a: string, b: string): string => `${a}|${b}`;
  const byKeyPass = new Map<string, PairObservation>();
  for (const c of comparisons) {
    if (c.overall_winner == null) continue;
    const obs: PairObservation = {
      overall: c.overall_winner as Verdict3,
      dims: verdictsByComp.get(c.id as string) ?? {},
    };
    byKeyPass.set(`${pairKey(c.article_a_id as string, c.article_b_id as string)}#${c.pass}`, obs);
  }

  // pass-0 observations + replica agreement -> per-pair confidence
  const observations: PairObservation[] = [];
  const replicas: ReplicatedPair[] = [];
  for (const c of comparisons) {
    if (c.pass !== 0 || c.overall_winner == null) continue;
    const key = pairKey(c.article_a_id as string, c.article_b_id as string);
    const pass0 = byKeyPass.get(`${key}#0`);
    if (!pass0) continue;
    const pass1 = byKeyPass.get(`${key}#1`);
    const replica = pass1 ? { pass0, pass1 } : undefined;
    if (replica) replicas.push(replica);
    observations.push({ ...pass0, confidence: pairConfidence(replica) });
  }

  return { observations, replicas };
}

async function computeSessionFit(db: SupabaseClient, sessionId: string): Promise<WiFitResult> {
  const session = await loadSession(db, sessionId);
  const mode = session.mode;
  const criteria = await loadSessionCriteria(db, sessionId);
  const criteriaIds = criteria.map((c) => c.id);
  const nameById = new Map(criteria.map((c) => [c.id, c.name]));

  const { observations, replicas } = await loadFitData(db, sessionId, mode);
  const fit = fitWeights(observations, criteriaIds);
  const cis = weightCIs(observations, criteriaIds, { seed: hashSeed(sessionId) });
  const ciById = new Map(cis.map((c) => [c.criteriaId, c]));
  const audit = auditConsistency(replicas);

  const weights: WiWeightOut[] = fit.weights.map((w) => {
    const ci = ciById.get(w.criteriaId);
    return {
      criteriaId: w.criteriaId,
      name: nameById.get(w.criteriaId) ?? w.criteriaId,
      weight: w.weight,
      ciLow: ci?.ciLow ?? w.weight,
      ciHigh: ci?.ciHigh ?? w.weight,
    };
  });

  return {
    weights,
    trainAccuracy: fit.trainAccuracy,
    heldOutAccuracy: fit.heldOutAccuracy,
    nPairs: fit.nPairs,
    degenerate: fit.degenerate,
    flags: fit.flags,
    audit,
    judgeModel: session.judge_model,
    mode,
  };
}

// ─── Action input schemas ──────────────────────────────────────────

const createSessionInput = evolutionWiSessionInsertSchema.extend({
  criteriaIds: z.array(z.string().uuid()).min(2).max(20),
});

// ─── Actions ───────────────────────────────────────────────────────

export const createWeightInferenceSessionAction = adminAction(
  'createWeightInferenceSession',
  async (input: unknown, ctx: AdminContext): Promise<{ sessionId: string }> => {
    assertEnabled();
    const parsed = createSessionInput.parse(input);
    const { supabase, adminUserId } = ctx;
    await validateCriteriaIds(parsed.criteriaIds, supabase);
    if (!parsed.prompt_id) throw new Error('prompt_id (arena topic) is required');

    // 1. sample the article pool from the topic's arena variants
    const { data: variants, error: vErr } = await supabase
      .from('evolution_variants')
      .select('id, variant_content, mu, sigma, elo_score')
      .eq('prompt_id', parsed.prompt_id)
      .eq('synced_to_arena', true)
      .eq('variant_kind', 'article')
      .is('archived_at', null)
      .order('elo_score', { ascending: false })
      .limit(parsed.sample_size);
    if (vErr) throw new Error(`pool sampling failed: ${pgMsg(vErr)}`);
    const pool = variants ?? [];
    if (pool.length < 2) {
      throw new Error(`topic has only ${pool.length} arena article variants — need at least 2 to form pairs`);
    }

    // 2. create the session row (is_test_content set by trigger)
    const { data: sessionRow, error: sErr } = await supabase
      .from('evolution_weight_inference_sessions')
      .insert({
        name: parsed.name,
        description: parsed.description ?? null,
        status: parsed.status,
        mode: parsed.mode,
        prompt_id: parsed.prompt_id,
        sample_size: parsed.sample_size,
        replication_rate: parsed.replication_rate,
        judge_model: parsed.judge_model ?? null,
        judge_temperature: parsed.judge_temperature ?? null,
        judge_reasoning_effort: parsed.judge_reasoning_effort ?? null,
        auto_repeats: parsed.auto_repeats,
      })
      .select('id')
      .single();
    if (sErr || !sessionRow) throw new Error(`create session failed: ${pgMsg(sErr)}`);
    const sessionId = sessionRow.id as string;

    // 3. criteria junction
    const critRows = parsed.criteriaIds.map((criteria_id, position) => ({
      session_id: sessionId,
      criteria_id,
      position,
    }));
    const { error: cjErr } = await supabase.from('evolution_weight_inference_criteria').insert(critRows);
    if (cjErr) throw new Error(`criteria junction insert failed: ${pgMsg(cjErr)}`);

    // 4. snapshot articles
    const articleRows = pool.map((v, i) => ({
      session_id: sessionId,
      variant_id: v.id as string,
      label: `art#${String(i + 1).padStart(5, '0')}`,
      content: (v.variant_content as string) ?? '',
      mu: (v.mu as number | null) ?? null,
      sigma: (v.sigma as number | null) ?? null,
      position: i,
    }));
    const { data: inserted, error: aErr } = await supabase
      .from('evolution_weight_inference_articles')
      .insert(articleRows)
      .select('id');
    if (aErr || !inserted) throw new Error(`article snapshot failed: ${pgMsg(aErr)}`);
    const articleIds = inserted.map((r) => r.id as string);

    // 5. materialize the pair set (seeded), pass 0 + reversal replicas
    const rng = createSeededRng(hashSeed(sessionId));
    const candidates: Array<[string, string]> = [];
    for (let i = 0; i < articleIds.length; i++) {
      for (let j = i + 1; j < articleIds.length; j++) {
        const a = articleIds[i]!;
        const b = articleIds[j]!;
        candidates.push(a < b ? [a, b] : [b, a]); // canonical order
      }
    }
    // Fisher-Yates shuffle (seeded)
    for (let i = candidates.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      const tmp = candidates[i]!;
      candidates[i] = candidates[k]!;
      candidates[k] = tmp;
    }
    const targetPairs = Math.min(candidates.length, requiredRatings(parsed.criteriaIds.length).pairs);
    const chosen = candidates.slice(0, targetPairs);
    const replicaCount = Math.floor(targetPairs * parsed.replication_rate);

    const compRows: Array<Record<string, unknown>> = [];
    chosen.forEach(([aId, bId], idx) => {
      const swapped = rng() < 0.5;
      compRows.push({
        session_id: sessionId,
        article_a_id: aId,
        article_b_id: bId,
        pass: 0,
        shown_swapped: swapped,
        source: 'human',
        rater_id: adminUserId,
      });
      if (idx < replicaCount) {
        compRows.push({
          session_id: sessionId,
          article_a_id: aId,
          article_b_id: bId,
          pass: 1,
          shown_swapped: !swapped,
          source: 'human',
          rater_id: adminUserId,
        });
      }
    });
    // chunked insert
    for (let i = 0; i < compRows.length; i += 500) {
      const { error: compErr } = await supabase
        .from('evolution_weight_inference_comparisons')
        .insert(compRows.slice(i, i + 500));
      if (compErr) throw new Error(`comparison materialize failed: ${pgMsg(compErr)}`);
    }

    return { sessionId };
  },
);

export const listWeightInferenceSessionsAction = adminAction(
  'listWeightInferenceSessions',
  async (
    input: { filterTestContent?: boolean } | undefined,
    ctx: AdminContext,
  ): Promise<{ items: WiSessionListItem[] }> => {
    assertEnabled();
    const { supabase } = ctx;
    let q = supabase
      .from('evolution_weight_inference_sessions')
      .select('id, name, mode, status, judge_model, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (input?.filterTestContent !== false) q = q.eq('is_test_content', false);
    const { data, error } = await q;
    if (error) throw new Error(`list sessions failed: ${pgMsg(error)}`);

    const sessions = data ?? [];
    const items: WiSessionListItem[] = [];
    for (const s of sessions) {
      const sid = s.id as string;
      const [{ count: critCount }, { count: pairsTotal }, { count: overallDone }] = await Promise.all([
        supabase
          .from('evolution_weight_inference_criteria')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', sid),
        supabase
          .from('evolution_weight_inference_comparisons')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', sid)
          .eq('pass', 0),
        supabase
          .from('evolution_weight_inference_comparisons')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', sid)
          .eq('pass', 0)
          .not('overall_winner', 'is', null),
      ]);
      items.push({
        id: sid,
        name: s.name as string,
        mode: s.mode as 'human' | 'auto',
        status: s.status as string,
        judge_model: (s.judge_model as string | null) ?? null,
        criteria_count: critCount ?? 0,
        pairs_total: pairsTotal ?? 0,
        pairs_overall_done: overallDone ?? 0,
        created_at: s.created_at as string,
      });
    }
    return { items };
  },
);

export const getWeightInferencePreviewAction = adminAction(
  'getWeightInferencePreview',
  async (
    input: { sessionId?: string; criteriaCount?: number; replicationRate?: number },
    ctx: AdminContext,
  ): Promise<{
    required: ReturnType<typeof requiredRatings>;
    pairsTotal: number;
    overallDone: number;
    criteriaDone: number;
    remaining: number;
  }> => {
    assertEnabled();
    const { supabase } = ctx;
    if (!input.sessionId) {
      const K = input.criteriaCount ?? 0;
      const required = requiredRatings(K, { replicationRate: input.replicationRate });
      return { required, pairsTotal: 0, overallDone: 0, criteriaDone: 0, remaining: required.pairs };
    }
    const criteria = await loadSessionCriteria(supabase, input.sessionId);
    const required = requiredRatings(criteria.length, { replicationRate: input.replicationRate });
    const [{ count: pairsTotal }, { count: overallDone }] = await Promise.all([
      supabase
        .from('evolution_weight_inference_comparisons')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', input.sessionId)
        .eq('pass', 0),
      supabase
        .from('evolution_weight_inference_comparisons')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', input.sessionId)
        .eq('pass', 0)
        .not('overall_winner', 'is', null),
    ]);
    return {
      required,
      pairsTotal: pairsTotal ?? 0,
      overallDone: overallDone ?? 0,
      criteriaDone: 0,
      remaining: remainingPairs(overallDone ?? 0, pairsTotal ?? 0),
    };
  },
);

const nextPairInput = z.object({
  sessionId: z.string().uuid(),
  step: z.enum(['overall', 'criteria']),
});

export const getNextPairAction = adminAction(
  'getNextPair',
  async (input: unknown, ctx: AdminContext): Promise<WiNextPair | null> => {
    assertEnabled();
    const { sessionId, step } = nextPairInput.parse(input);
    const { supabase } = ctx;

    let comparison: CompPickRow | null = null;

    if (step === 'overall') {
      const { data, error } = await supabase
        .from('evolution_weight_inference_comparisons')
        .select('id, article_a_id, article_b_id, pass, shown_swapped')
        .eq('session_id', sessionId)
        .eq('source', 'human')
        .is('overall_winner', null)
        .order('pass', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`next pair failed: ${pgMsg(error)}`);
      comparison = (data as unknown as CompPickRow | null) ?? null;
    } else {
      // criteria step: gated on overall already recorded, missing complete verdict set
      const criteria = await loadSessionCriteria(supabase, sessionId);
      const { data, error } = await supabase
        .from('evolution_weight_inference_comparisons')
        .select('id, article_a_id, article_b_id, pass, shown_swapped')
        .eq('session_id', sessionId)
        .eq('source', 'human')
        .not('overall_winner', 'is', null)
        .order('pass', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw new Error(`next pair failed: ${pgMsg(error)}`);
      for (const c of (data ?? []) as unknown as CompPickRow[]) {
        const { count } = await supabase
          .from('evolution_weight_inference_dimension_verdicts')
          .select('*', { count: 'exact', head: true })
          .eq('comparison_id', c.id);
        if ((count ?? 0) < criteria.length) {
          comparison = c;
          break;
        }
      }
    }

    if (!comparison) return null;

    const { data: arts, error: aErr } = await supabase
      .from('evolution_weight_inference_articles')
      .select('id, label, content')
      .in('id', [comparison.article_a_id, comparison.article_b_id]);
    if (aErr) throw new Error(`load articles failed: ${pgMsg(aErr)}`);
    const byId = new Map((arts ?? []).map((a) => [a.id as string, a as unknown as ArticleRow]));
    const canA = byId.get(comparison.article_a_id);
    const canB = byId.get(comparison.article_b_id);
    if (!canA || !canB) throw new Error('comparison references missing article');

    // orient for display: shown_swapped => canonical-B on the left
    const left = comparison.shown_swapped ? canB : canA;
    const right = comparison.shown_swapped ? canA : canB;

    const result: WiNextPair = {
      comparisonId: comparison.id,
      pass: comparison.pass,
      shownSwapped: comparison.shown_swapped,
      left: { id: left.id, label: left.label, content: left.content },
      right: { id: right.id, label: right.label, content: right.content },
    };
    if (step === 'criteria') {
      const criteria = await loadSessionCriteria(supabase, sessionId);
      result.criteria = criteria.map((c) => ({ id: c.id, name: c.name, description: c.description }));
    }
    return result;
  },
);

const onScreenVerdict = z.enum(['a', 'b', 'tie']); // a = on-screen left, b = on-screen right

const recordOverallInput = z.object({
  sessionId: z.string().uuid(),
  comparisonId: z.string().uuid(),
  onScreenWinner: onScreenVerdict,
});

export const recordOverallVerdictAction = adminAction(
  'recordOverallVerdict',
  async (input: unknown, ctx: AdminContext): Promise<{ ok: true }> => {
    assertEnabled();
    const { sessionId, comparisonId, onScreenWinner } = recordOverallInput.parse(input);
    const { supabase } = ctx;
    const { data: comp, error } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('id, shown_swapped')
      .eq('id', comparisonId)
      .eq('session_id', sessionId)
      .single();
    if (error || !comp) throw new Error(`comparison not found: ${pgMsg(error)}`);
    const canonical = orientToCanonical(onScreenWinner, comp.shown_swapped as boolean);
    const { error: uErr } = await supabase
      .from('evolution_weight_inference_comparisons')
      .update({ overall_winner: canonical, updated_at: new Date().toISOString() })
      .eq('id', comparisonId);
    if (uErr) throw new Error(`record overall failed: ${pgMsg(uErr)}`);
    return { ok: true };
  },
);

const recordDimsInput = z.object({
  sessionId: z.string().uuid(),
  comparisonId: z.string().uuid(),
  verdicts: z.array(z.object({ criteriaId: z.string().uuid(), onScreenVerdict })).min(1),
});

export const recordDimensionVerdictsAction = adminAction(
  'recordDimensionVerdicts',
  async (input: unknown, ctx: AdminContext): Promise<{ ok: true }> => {
    assertEnabled();
    const { sessionId, comparisonId, verdicts } = recordDimsInput.parse(input);
    const { supabase } = ctx;
    const { data: comp, error } = await supabase
      .from('evolution_weight_inference_comparisons')
      .select('id, shown_swapped')
      .eq('id', comparisonId)
      .eq('session_id', sessionId)
      .single();
    if (error || !comp) throw new Error(`comparison not found: ${pgMsg(error)}`);
    const shownSwapped = comp.shown_swapped as boolean;

    const criteria = await loadSessionCriteria(supabase, sessionId);
    const nameById = new Map(criteria.map((c) => [c.id, c.name]));
    const posById = new Map(criteria.map((c, i) => [c.id, i]));

    const rows = verdicts.map((v) => ({
      comparison_id: comparisonId,
      criteria_id: v.criteriaId,
      criteria_name: nameById.get(v.criteriaId) ?? v.criteriaId,
      verdict: orientToCanonical(v.onScreenVerdict, shownSwapped),
      position: posById.get(v.criteriaId) ?? 0,
    }));
    const { error: upErr } = await supabase
      .from('evolution_weight_inference_dimension_verdicts')
      .upsert(rows, { onConflict: 'comparison_id,criteria_id' });
    if (upErr) throw new Error(`record verdicts failed: ${pgMsg(upErr)}`);
    return { ok: true };
  },
);

export const getWeightInferenceFitAction = adminAction(
  'getWeightInferenceFit',
  async (input: { sessionId: string }, ctx: AdminContext): Promise<WiFitResult> => {
    assertEnabled();
    return computeSessionFit(ctx.supabase, input.sessionId);
  },
);

const exportInput = z.object({
  sessionId: z.string().uuid(),
  rubricName: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  dropBarelyMatters: z.boolean().optional(),
});

export const exportWeightInferenceRubricAction = adminAction(
  'exportWeightInferenceRubric',
  async (input: unknown, ctx: AdminContext): Promise<{ rubricId: string }> => {
    assertEnabled();
    const { sessionId, rubricName, label, description, dropBarelyMatters } = exportInput.parse(input);
    const { supabase } = ctx;
    const fit = await computeSessionFit(supabase, sessionId);

    let dims = fit.weights.filter((w) => w.weight > 0);
    if (dropBarelyMatters) {
      dims = dims.filter((w) => !fit.flags.barelyMatters.includes(w.criteriaId));
    }
    if (dims.length === 0) {
      throw new Error(
        'Cannot export: the fit produced no positive weights yet (collect more verdicts first).',
      );
    }
    await validateCriteriaIds(dims.map((d) => d.criteriaId), supabase);

    const { data: rubric, error: rErr } = await supabase
      .from('evolution_judge_rubrics')
      .insert({ name: rubricName, label: label ?? '', description: description ?? null, status: 'active' })
      .select('id')
      .single();
    if (rErr || !rubric) {
      if (rErr?.code === '23505') throw new Error(`A rubric named "${rubricName}" already exists — choose another name.`);
      throw new Error(`export failed: ${pgMsg(rErr)}`);
    }
    const rubricId = rubric.id as string;
    const dimRows = dims.map((d, i) => ({
      rubric_id: rubricId,
      criteria_id: d.criteriaId,
      weight: d.weight,
      position: i,
    }));
    const { error: dErr } = await supabase.from('evolution_judge_rubric_dimensions').insert(dimRows);
    if (dErr) throw new Error(`export dimensions failed: ${pgMsg(dErr)}`);
    return { rubricId };
  },
);
