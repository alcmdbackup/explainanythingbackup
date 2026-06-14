// Persistence for escalation sweeps: map each SubmatchRecord to a judge_eval_calls row (one row
// per submatch, grouped into a "match" by submatch_group_key), upsert the escalation run (chain +
// rule), and replace its call rows. The pure mapper (submatchToCallRow) is unit-tested; the DB
// wrappers mirror persist.ts (delete-then-insert / upsert-by-settings_key).

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeEvalCallResult, JudgeEvalPair, JudgeKindFilter, JudgeReasoningEffort } from './schemas';
import type { SubmatchRecord } from './escalation';
import { buildEscalationSettingsKey, buildPromptVariantHash } from './settings';
import { reconcilePasses, type RubricBreakdown } from '../shared/rubricJudge';
import type { Verdict } from '../shared/judgeEnsemble/types';

type Db = SupabaseClient<Database>;

/** A judge_eval_calls row for one submatch (the existing call shape + the submatch identity cols).
 *  `id` is client-generated so rubric-mode dimension-verdict rows can FK to it without a returning insert. */
export interface EscalationCallRow extends JudgeEvalCallResult {
  id: string;
  submatch_group_key: string;
  escalation_step: number;
  triggered_escalation: boolean;
  judge_model: string;
}

/** Group key that ties a match's submatches together (scoped within a run by eval_run_id). */
export function submatchGroupKey(pairLabel: string, repeatIndex: number): string {
  return `${pairLabel}#${repeatIndex}`;
}

/** Map one submatch (+ its pair + group key) to a persistable judge_eval_calls row. Pure. */
export function submatchToCallRow(
  pair: JudgeEvalPair,
  sub: SubmatchRecord,
  groupKey: string,
  repeatIndex: number,
): EscalationCallRow {
  return {
    id: randomUUID(),
    pair_label: pair.label,
    pair_kind: pair.pair_kind,
    comparison_mode: pair.pair_kind,
    repeat_index: repeatIndex,
    forward_winner: sub.forwardWinner,
    reverse_winner: sub.reverseWinner,
    winner: sub.winner,
    confidence: sub.confidence,
    wall_ms: null,
    fwd_ms: null,
    rev_ms: null,
    prompt_tokens: sub.promptTokens,
    output_tokens: sub.outputTokens,
    reasoning_tokens: sub.reasoningTokens,
    cost_usd: sub.costUsd,
    forward_raw: sub.forwardRaw,
    reverse_raw: sub.reverseRaw,
    error: sub.error,
    forward_prompt: sub.forwardPrompt,
    reverse_prompt: sub.reversePrompt,
    forward_reasoning: sub.forwardReasoning,
    reverse_reasoning: sub.reverseReasoning,
    reasoning_trace_format: null,
    // frozen ground-truth snapshot (same as the single-judge path)
    mu_a: pair.mu_a,
    mu_b: pair.mu_b,
    sigma_a: pair.sigma_a,
    sigma_b: pair.sigma_b,
    baseline_confidence: pair.baseline_confidence,
    gap_kind: pair.gap_kind,
    expected_winner: pair.expected_winner,
    variant_a_id: pair.variant_a_id,
    variant_b_id: pair.variant_b_id,
    // submatch identity
    submatch_group_key: groupKey,
    escalation_step: sub.escalationStep,
    triggered_escalation: sub.triggeredEscalation,
    judge_model: sub.model,
  };
}

export interface UpsertEscalationRunInput {
  testSetId: string;
  chainId: string;
  chainModels: { article: string[]; paragraph: string[] };
  aggregationRule: string;
  aggregationRuleVersion: number;
  cap: number;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  kindFilter: JudgeKindFilter;
  promptVariant: string | null;
  repeats: number;
  notes?: string | null;
}

/** Upsert an escalation eval run by its escalation settings_key (idempotent re-run). judge_model is a
 *  label (the column is NOT NULL); the real identity lives in chain_id + aggregation_rule. */
export async function upsertEscalationRun(
  db: Db,
  input: UpsertEscalationRunInput,
): Promise<{ runId: string; settingsKey: string }> {
  const promptVariantHash = buildPromptVariantHash(input.promptVariant);
  const settingsKey = buildEscalationSettingsKey({
    chainModels: input.chainModels,
    aggregationRule: input.aggregationRule,
    aggregationRuleVersion: input.aggregationRuleVersion,
    cap: input.cap,
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
        judge_model: `escalation:${input.aggregationRule}`,
        temperature: input.temperature,
        reasoning_effort: input.reasoningEffort,
        kind_filter: input.kindFilter,
        prompt_variant: input.promptVariant,
        prompt_variant_hash: promptVariantHash,
        repeats: input.repeats,
        settings_key: settingsKey,
        notes: input.notes ?? null,
        chain_id: input.chainId,
        aggregation_rule: input.aggregationRule,
        aggregation_rule_version: input.aggregationRuleVersion,
      },
      { onConflict: 'settings_key' },
    )
    .select('id')
    .single();
  if (error) throw error;
  return { runId: data.id, settingsKey };
}

/** Replace an escalation run's submatch rows (delete-then-insert; idempotent re-run). */
export async function replaceEscalationCalls(
  db: Db,
  runId: string,
  rows: EscalationCallRow[],
): Promise<void> {
  const del = await db.from('judge_eval_calls').delete().eq('eval_run_id', runId);
  if (del.error) throw del.error;
  if (rows.length === 0) return;
  const insert = rows.map((r) => ({ eval_run_id: runId, ...r }));
  const { error } = await db.from('judge_eval_calls').insert(insert);
  if (error) throw error;
}

/** A per-dimension verdict row for a rubric-mode submatch (judge_eval_dimension_verdicts). */
export interface DimensionVerdictRow {
  judge_eval_call_id: string;
  criteria_id: string | null;
  criteria_name: string;
  weight: number;
  forward_verdict: string | null;
  reverse_verdict: string | null;
  dimension_winner: string | null;
  favored_match_winner: boolean | null;
  position: number;
}

/** Build the per-dimension verdict rows for a rubric-mode submatch. `matchWinner` is the
 *  consolidated escalation verdict, so `favored_match_winner` is relative to the MATCH (not the
 *  submatch). `dimension_winner` reconciles the two passes (both already real-frame). Pure. */
export function dimensionVerdictRows(
  callId: string,
  breakdown: RubricBreakdown,
  matchWinner: Verdict,
): DimensionVerdictRow[] {
  return breakdown.dimensions.map((d, i) => {
    const dimWinner = reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner;
    return {
      judge_eval_call_id: callId,
      criteria_id: d.criteriaId,
      criteria_name: d.name,
      weight: d.weight,
      forward_verdict: d.forwardVerdict,
      reverse_verdict: d.reverseVerdict,
      dimension_winner: dimWinner,
      favored_match_winner: dimWinner === 'TIE' ? null : dimWinner === matchWinner,
      position: i,
    };
  });
}

/** Insert dimension-verdict rows. The CASCADE from judge_eval_calls handles deletion on re-run, so
 *  callers `replaceEscalationCalls` first (which clears the old calls + their dimension rows). */
export async function insertDimensionVerdicts(db: Db, rows: DimensionVerdictRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from('judge_eval_dimension_verdicts').insert(rows);
  if (error) throw error;
}
