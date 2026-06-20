// Persistence for the Judge Lab Agreement Sweep: upsert the agreement run by its settings_key
// (idempotent re-run), and replace its call rows + per-criterion verdict rows (delete-then-insert).
// The `id` on each call row is client-generated so the criterion-verdict rows can FK to it without a
// returning insert. Mirrors escalationPersist.ts.

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeKindFilter, JudgeReasoningEffort } from './schemas';
import type { AgreementCallResult } from './agreement';
import { buildAgreementSettingsKey } from './settings';

type Db = SupabaseClient<Database>;

export interface UpsertAgreementRunInput {
  testSetId: string;
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  judgeRubricId: string;
  kindFilter: JudgeKindFilter;
  repeats: number;
  notes?: string | null;
}

/** Upsert an agreement run by its agreement settings_key (idempotent re-run). */
export async function upsertAgreementRun(
  db: Db,
  input: UpsertAgreementRunInput,
): Promise<{ runId: string; settingsKey: string }> {
  const settingsKey = buildAgreementSettingsKey({
    judgeModel: input.judgeModel,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort,
    judgeRubricId: input.judgeRubricId,
    kindFilter: input.kindFilter,
    repeats: input.repeats,
    testSetId: input.testSetId,
  });
  const { data, error } = await db
    .from('judge_eval_agreement_runs')
    .upsert(
      {
        test_set_id: input.testSetId,
        judge_model: input.judgeModel,
        temperature: input.temperature,
        reasoning_effort: input.reasoningEffort,
        kind_filter: input.kindFilter,
        judge_rubric_id: input.judgeRubricId,
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

type CallInsert = Database['public']['Tables']['judge_eval_agreement_calls']['Insert'];
type CriterionInsert =
  Database['public']['Tables']['judge_eval_agreement_criterion_verdicts']['Insert'];

/** Map one engine result to a persistable call-insert row (sans the criterionVerdicts sidecar). */
function toCallInsert(runId: string, callId: string, r: AgreementCallResult): CallInsert {
  return {
    id: callId,
    agreement_run_id: runId,
    pair_label: r.pair_label,
    pair_kind: r.pair_kind,
    repeat_index: r.repeat_index,
    holistic_winner: r.holistic_winner,
    holistic_confidence: r.holistic_confidence,
    rubric_winner: r.rubric_winner,
    rubric_confidence: r.rubric_confidence,
    rubric_matches_holistic: r.rubric_matches_holistic,
    holistic_cost_usd: r.holistic_cost_usd,
    rubric_cost_usd: r.rubric_cost_usd,
    cost_usd: r.cost_usd,
    prompt_tokens: r.prompt_tokens,
    output_tokens: r.output_tokens,
    reasoning_tokens: r.reasoning_tokens,
    wall_ms: r.wall_ms,
    holistic_forward_raw: r.holistic_forward_raw,
    holistic_reverse_raw: r.holistic_reverse_raw,
    rubric_forward_raw: r.rubric_forward_raw,
    rubric_reverse_raw: r.rubric_reverse_raw,
    error: r.error,
    mu_a: r.mu_a,
    mu_b: r.mu_b,
    sigma_a: r.sigma_a,
    sigma_b: r.sigma_b,
    baseline_confidence: r.baseline_confidence,
    gap_kind: r.gap_kind,
    expected_winner: r.expected_winner,
    variant_a_id: r.variant_a_id,
    variant_b_id: r.variant_b_id,
  };
}

/** Replace an agreement run's call rows + criterion-verdict rows (delete-then-insert; idempotent).
 *  Criterion rows CASCADE-delete with their parent call, so deleting the calls clears them first. */
export async function replaceAgreementCalls(
  db: Db,
  runId: string,
  results: AgreementCallResult[],
): Promise<{ callCount: number; criterionCount: number }> {
  const del = await db.from('judge_eval_agreement_calls').delete().eq('agreement_run_id', runId);
  if (del.error) throw del.error;
  if (results.length === 0) return { callCount: 0, criterionCount: 0 };

  const callRows: CallInsert[] = [];
  const criterionRows: CriterionInsert[] = [];
  for (const r of results) {
    const callId = randomUUID();
    callRows.push(toCallInsert(runId, callId, r));
    for (const cv of r.criterionVerdicts) {
      criterionRows.push({
        agreement_call_id: callId,
        criteria_id: cv.criteria_id,
        criteria_name: cv.criteria_name,
        weight: cv.weight,
        forward_verdict: cv.forward_verdict,
        reverse_verdict: cv.reverse_verdict,
        dimension_winner: cv.dimension_winner,
        agrees_with_holistic: cv.agrees_with_holistic,
        matches_ground_truth: cv.matches_ground_truth,
        position: cv.position,
      });
    }
  }

  const callIns = await db.from('judge_eval_agreement_calls').insert(callRows);
  if (callIns.error) throw callIns.error;
  if (criterionRows.length > 0) {
    const critIns = await db
      .from('judge_eval_agreement_criterion_verdicts')
      .insert(criterionRows);
    if (critIns.error) throw critIns.error;
  }
  return { callCount: callRows.length, criterionCount: criterionRows.length };
}
