// Zod schemas + derived types for the systematic judge-evaluation tool. Mirrors the
// judge_eval_* DB tables (migration 20260606000001) and the in-memory pair/result shapes
// used by the eval engine, CLI, and Judge Lab admin page.

import { z } from 'zod';

export const PAIR_KINDS = ['article', 'paragraph'] as const;
export const WINNERS = ['A', 'B', 'TIE'] as const;
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high'] as const;
export const GAP_KINDS = ['large', 'close'] as const;
// Mirrors LLMUsageMetadata.reasoningTraceFormat (src/lib/services/llms.ts). NULL on a call =
// thinking not requested / no usage callback fired.
export const REASONING_TRACE_FORMATS = ['verbatim', 'summary', 'unavailable'] as const;
export const TEST_SET_STRATEGIES = [
  'random',
  'stratified_confidence',
  'stratified_gap',
  'manual',
] as const;
export const KIND_FILTERS = ['article', 'paragraph', 'both'] as const;
// aggregateWinners() emits exactly these confidence values (computeRatings.ts).
export const CONFIDENCE_VALUES = [0, 0.3, 0.5, 0.7, 1.0] as const;

export const pairKindSchema = z.enum(PAIR_KINDS);
export const winnerSchema = z.enum(WINNERS);
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export const gapKindSchema = z.enum(GAP_KINDS);
export const reasoningTraceFormatSchema = z.enum(REASONING_TRACE_FORMATS);
export const testSetStrategySchema = z.enum(TEST_SET_STRATEGIES);
export const kindFilterSchema = z.enum(KIND_FILTERS);
export const confidenceSchema = z
  .number()
  .refine((v) => (CONFIDENCE_VALUES as readonly number[]).includes(v), {
    message: 'confidence must be one of 0, 0.3, 0.5, 0.7, 1.0',
  });

/** One pair stored in a pair-bank's `pairs` JSONB array. */
export const judgeEvalPairSchema = z.object({
  label: z.string().min(1),
  pair_kind: pairKindSchema,
  variant_a_id: z.string().uuid(),
  variant_b_id: z.string().uuid(),
  text_a: z.string(),
  text_b: z.string(),
  mu_a: z.number().nullable(),
  mu_b: z.number().nullable(),
  sigma_a: z.number().nullable(),
  sigma_b: z.number().nullable(),
  // 'A' | 'B' when a large mu gap gives ground truth; null when tie-acceptable.
  expected_winner: z.enum(['A', 'B']).nullable(),
  gap_kind: gapKindSchema,
  // The production judge's recorded confidence on this pair (reference column).
  baseline_confidence: z.number().nullable(),
});
export type JudgeEvalPair = z.infer<typeof judgeEvalPairSchema>;

export const judgeEvalPairBankSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  source_topic_id: z.string().uuid().nullable(),
  pairs: z.array(judgeEvalPairSchema),
  created_at: z.string(),
});
export type JudgeEvalPairBank = z.infer<typeof judgeEvalPairBankSchema>;

export const judgeEvalTestSetSchema = z.object({
  id: z.string().uuid(),
  pair_bank_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  strategy: testSetStrategySchema,
  seed: z.number().int(),
  size_article: z.number().int().min(0),
  size_paragraph: z.number().int().min(0),
  created_at: z.string(),
});
export type JudgeEvalTestSet = z.infer<typeof judgeEvalTestSetSchema>;

export const judgeEvalTestSetMemberSchema = z.object({
  test_set_id: z.string().uuid(),
  pair_label: z.string().min(1),
  pair_kind: pairKindSchema,
});
export type JudgeEvalTestSetMember = z.infer<typeof judgeEvalTestSetMemberSchema>;

export const judgeEvalRunSchema = z.object({
  id: z.string().uuid(),
  test_set_id: z.string().uuid(),
  judge_model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  reasoning_effort: reasoningEffortSchema.nullable(),
  kind_filter: kindFilterSchema,
  prompt_variant: z.string().nullable(),
  prompt_variant_hash: z.string().min(1),
  repeats: z.number().int().min(1),
  settings_key: z.string().min(1),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type JudgeEvalRun = z.infer<typeof judgeEvalRunSchema>;

export const judgeEvalCallSchema = z.object({
  id: z.string().uuid(),
  eval_run_id: z.string().uuid(),
  pair_label: z.string().min(1),
  pair_kind: pairKindSchema,
  comparison_mode: pairKindSchema, // mode mirrors pair_kind: 'article' | 'paragraph'
  repeat_index: z.number().int().min(0),
  forward_winner: winnerSchema.nullable(),
  reverse_winner: winnerSchema.nullable(),
  winner: winnerSchema,
  confidence: confidenceSchema,
  wall_ms: z.number().int().nullable(),
  fwd_ms: z.number().int().nullable(),
  rev_ms: z.number().int().nullable(),
  prompt_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  reasoning_tokens: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  forward_raw: z.string().nullable(),
  reverse_raw: z.string().nullable(),
  error: z.string().nullable(),
  // --- Audit payload (verbatim judge I/O). All nullable: errored passes + legacy pre-migration rows. ---
  forward_prompt: z.string().nullable(),
  reverse_prompt: z.string().nullable(),
  forward_reasoning: z.string().nullable(),
  reverse_reasoning: z.string().nullable(),
  reasoning_trace_format: reasoningTraceFormatSchema.nullable(),
  // --- Ground-truth snapshot, frozen from the resolved pair at write time (durable vs bank re-seeding). ---
  mu_a: z.number().nullable(),
  mu_b: z.number().nullable(),
  sigma_a: z.number().nullable(),
  sigma_b: z.number().nullable(),
  baseline_confidence: z.number().nullable(),
  gap_kind: gapKindSchema.nullable(),
  expected_winner: z.enum(['A', 'B']).nullable(),
  variant_a_id: z.string().uuid().nullable(),
  variant_b_id: z.string().uuid().nullable(),
});
export type JudgeEvalCall = z.infer<typeof judgeEvalCallSchema>;

/** The per-repeat result the engine produces before it is persisted as a call row. */
export type JudgeEvalCallResult = Omit<
  JudgeEvalCall,
  'id' | 'eval_run_id'
>;

/** Heavy audit columns — fetched only for a single expanded match (keeps the list query off TOAST). */
export const JUDGE_EVAL_CALL_AUDIT_KEYS = [
  'forward_prompt',
  'reverse_prompt',
  'forward_reasoning',
  'reverse_reasoning',
  'forward_raw',
  'reverse_raw',
  'reasoning_trace_format',
] as const;
export type JudgeEvalCallAuditKey = (typeof JUDGE_EVAL_CALL_AUDIT_KEYS)[number];

/** Light per-call row for the match LIST + aggregates: verdict + metrics + ground-truth snapshot,
 *  WITHOUT the heavy audit text. Mirrors the column list `getJudgeEvalCallsAction` selects.
 *  Adds `decisive` — a DB GENERATED column (confidence > 0.6) absent from the insert-shaped base
 *  schema but present in every read. */
export type JudgeEvalCallCore = Omit<JudgeEvalCall, JudgeEvalCallAuditKey> & { decisive: boolean };
/** The heavy audit payload for one expanded match (see getJudgeEvalCallDetailAction). */
export type JudgeEvalCallAudit = Pick<JudgeEvalCall, 'id' | JudgeEvalCallAuditKey>;

/** Read the partial call rows the engine attaches to a thrown error (see runJudgeEval/executeSweep),
 *  so a failed sweep cell persists what completed instead of leaving a 0-call orphan. */
export function readPartialResults(e: unknown): JudgeEvalCallResult[] {
  if (e && typeof e === 'object' && 'partialResults' in e) {
    const partial = (e as { partialResults: unknown }).partialResults;
    if (Array.isArray(partial)) return partial as JudgeEvalCallResult[];
  }
  return [];
}

export type JudgeKindFilter = z.infer<typeof kindFilterSchema>;
export type JudgeReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type JudgeReasoningTraceFormat = z.infer<typeof reasoningTraceFormatSchema>;
export type Winner = z.infer<typeof winnerSchema>;
export type PairKind = z.infer<typeof pairKindSchema>;
