// Zod schemas for all evolution DB entities and internal pipeline types.
// Dependency rule: schemas.ts → types.ts → index.ts (never reverse).

import { z } from 'zod';
import { _INTERNAL_DEFAULT_SIGMA } from './shared/computeRatings';
import type { EnsembleSubmatches } from './shared/computeRatings';
import type { EnsembleConfig } from './shared/judgeEnsemble/chainRegistry';
import { getModelMaxTemperature, getModelInfo, MODEL_REGISTRY } from '@/config/modelRegistry';
// Type-only imports (erased at runtime → no cycle with rubricJudge, which imports
// only types from this file).
import type { RubricBreakdown, ResolvedJudgeRubric } from './shared/rubricJudge';

// ═══════════════════════════════════════════════════════════════════
// Shared enums & helpers
// ═══════════════════════════════════════════════════════════════════

export const evolutionRunStatusEnum = z.enum([
  'pending', 'claimed', 'running', 'completed', 'failed', 'cancelled',
]);

export const pipelineTypeEnum = z.enum(['full', 'single']);

export const promptStatusEnum = z.enum(['active', 'archived']);

export const criteriaStatusEnum = z.enum(['active', 'archived']);

export const experimentStatusEnum = z.enum(['draft', 'running', 'completed', 'cancelled']);

export const logLevelEnum = z.enum(['info', 'warn', 'error', 'debug']);

export const arenaWinnerEnum = z.enum(['a', 'b', 'draw']);

export const explanationSourceEnum = z.enum(['explanation', 'prompt_seed']);

export const pipelinePhaseEnum = z.enum(['EXPANSION', 'COMPETITION']);

export const agentNameEnum = z.enum([
  'generation', 'ranking', 'evolution',
  'reflection', 'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'proximity', 'metaReview', 'outlineGeneration',
  'flowCritique',
]);

// ═══════════════════════════════════════════════════════════════════
// DB Entity Schemas — InsertSchema (client-supplied) + FullDbSchema (DB row)
// ═══════════════════════════════════════════════════════════════════

// ─── 1. evolution_strategies ─────────────────────────────────────

export const evolutionStrategyInsertSchema = z.object({
  name: z.string().min(1).max(200),
  label: z.string().max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  config: z.record(z.string(), z.unknown()),
  config_hash: z.string().min(1).max(100),
  pipeline_type: pipelineTypeEnum.optional().default('full'),
  status: z.enum(['active', 'archived']).optional().default('active'),
  created_by: z.string().max(200).optional().nullable(),
});

export const evolutionStrategyFullDbSchema = evolutionStrategyInsertSchema.extend({
  id: z.string().uuid(),
  is_predefined: z.boolean().default(false),
  avg_elo_per_dollar: z.number().nullable().default(null),
  stddev_final_elo: z.number().nullable().default(null),
  first_used_at: z.string().nullable().default(null),
  last_used_at: z.string().nullable().default(null),
  created_at: z.string(),
});

export type EvolutionStrategyInsert = z.infer<typeof evolutionStrategyInsertSchema>;
export type EvolutionStrategyFullDb = z.infer<typeof evolutionStrategyFullDbSchema>;

// ─── 2. evolution_prompts ────────────────────────────────────────

export const evolutionPromptInsertSchema = z.object({
  prompt: z.string().min(1),
  name: z.string().min(1).max(500),
  status: promptStatusEnum.optional().default('active'),
  deleted_at: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
});

export const evolutionPromptFullDbSchema = evolutionPromptInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionPromptInsert = z.infer<typeof evolutionPromptInsertSchema>;
export type EvolutionPromptFullDb = z.infer<typeof evolutionPromptFullDbSchema>;

// ─── 2b. evolution_criteria ──────────────────────────────────────
// User-defined evaluation criteria used by the
// EvaluateCriteriaThenGenerateFromPreviousArticleAgent. DB-first (NOT
// code-first like evolution_tactics); soft-delete via deleted_at; rubric
// stored as JSONB array of {score, description} anchors that the LLM
// interpolates between when scoring.

/** Single rubric anchor: a (score, description) pair telling the LLM what
 *  this score value means for a specific criterion. Score must be within
 *  [min_rating, max_rating] of its parent criterion (validated cross-field
 *  on the insert schema). */
export const evaluationGuidanceAnchorSchema = z.object({
  score: z.number().refine(Number.isFinite, { message: 'score must be finite' }),
  description: z.string().min(1).max(500),
});

/** Optional rubric: array of anchor scores with descriptions. Empty / null
 *  means no rubric (LLM receives only name + description + range). */
export const evaluationGuidanceSchema = z.array(evaluationGuidanceAnchorSchema);

export const evolutionCriteriaInsertSchema = z.object({
  name: z.string().min(1).max(128).regex(
    /^[A-Za-z][a-zA-Z0-9_-]*$/,
    'name must match /^[A-Za-z][a-zA-Z0-9_-]*$/ (parser-safe)',
  ),
  description: z.string().nullable().optional(),
  min_rating: z.number().refine(Number.isFinite, { message: 'min_rating must be finite' }),
  max_rating: z.number().refine(Number.isFinite, { message: 'max_rating must be finite' }),
  evaluation_guidance: evaluationGuidanceSchema.nullable().optional(),
  status: criteriaStatusEnum.optional().default('active'),
  is_test_content: z.boolean().optional(),
  archived_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
}).refine(
  (c) => c.max_rating > c.min_rating,
  { message: 'max_rating must exceed min_rating', path: ['max_rating'] },
).refine(
  (c) => !c.evaluation_guidance
    || c.evaluation_guidance.every((a) => a.score >= c.min_rating && a.score <= c.max_rating),
  { message: 'every rubric anchor score must be in [min_rating, max_rating]', path: ['evaluation_guidance'] },
);

export const evolutionCriteriaFullDbSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128).regex(/^[A-Za-z][a-zA-Z0-9_-]*$/),
  description: z.string().nullable(),
  min_rating: z.number().refine(Number.isFinite),
  max_rating: z.number().refine(Number.isFinite),
  evaluation_guidance: evaluationGuidanceSchema.nullable(),
  status: criteriaStatusEnum,
  is_test_content: z.boolean(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type EvaluationGuidanceAnchor = z.infer<typeof evaluationGuidanceAnchorSchema>;
export type EvaluationGuidance = z.infer<typeof evaluationGuidanceSchema>;
export type EvolutionCriteriaInsert = z.infer<typeof evolutionCriteriaInsertSchema>;
export type EvolutionCriteriaFullDb = z.infer<typeof evolutionCriteriaFullDbSchema>;

// ─── 2b-2. evolution_style_fingerprints ──────────────────────────
// A style fingerprint is a DB-first user-authored entity (mirrors evolution_criteria):
// a structured + prose description of a writer's style, computed over a SET of articles,
// injected into generation prompts and the judging rubric. See migration
// 20260621000001_create_evolution_style_fingerprints.sql.

/** Structured style traits extracted from the article set. Produced by
 *  extractStyleFingerprint (Phase 3) and rendered to prose by renderFingerprintProse. */
export const styleFingerprintTraitsSchema = z.object({
  sentenceLength: z.object({
    // Bounded to a sane sentence-length range so a bad extraction OR a manual trait edit can't
    // persist a nonsensical value (e.g. negative / 1e9) that would render absurd prose.
    avgWords: z.number().min(1).max(200).refine(Number.isFinite, { message: 'avgWords must be finite' }),
    distribution: z.string().min(1).max(300),
  }),
  spellingRegion: z.enum(['american', 'british', 'mixed']),
  vocabularyLevel: z.string().min(1).max(300),
  tone: z.array(z.string().min(1).max(120)).max(12),
  signaturePhrases: z.array(z.object({
    phrase: z.string().min(1).max(200),
    frequency: z.enum(['rare', 'occasional', 'frequent']),
  })).max(40),
  structuralHabits: z.array(z.string().min(1).max(300)).max(20),
  punctuationHabits: z.array(z.string().min(1).max(300)).max(20),
  summary: z.string().min(1).max(2000),
});

export const styleFingerprintStatusEnum = criteriaStatusEnum;

export const evolutionStyleFingerprintInsertSchema = z.object({
  name: z.string().min(1).max(128).regex(
    /^[A-Za-z][a-zA-Z0-9_-]*$/,
    'name must match /^[A-Za-z][a-zA-Z0-9_-]*$/ (parser-safe)',
  ),
  description: z.string().nullable().optional(),
  fingerprint: styleFingerprintTraitsSchema.nullable().optional(),
  fingerprint_prose: z.string().nullable().optional(),
  article_count: z.number().int().nonnegative().optional(),
  status: styleFingerprintStatusEnum.optional().default('active'),
  is_test_content: z.boolean().optional(),
  archived_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
});

export const evolutionStyleFingerprintFullDbSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128).regex(/^[A-Za-z][a-zA-Z0-9_-]*$/),
  description: z.string().nullable(),
  fingerprint: styleFingerprintTraitsSchema.nullable(),
  fingerprint_prose: z.string().nullable(),
  article_count: z.number().int().nonnegative(),
  status: styleFingerprintStatusEnum,
  is_test_content: z.boolean(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** A single member of a fingerprint's article set: EITHER an explanation
 *  reference OR pasted text (exactly one, non-empty). */
export const evolutionStyleFingerprintArticleSchema = z.object({
  id: z.string().uuid(),
  fingerprint_id: z.string().uuid(),
  // explanations.id is BIGINT (see migration 20260409000002), so this is a number, not a UUID.
  explanation_id: z.number().int().nullable(),
  article_text: z.string().min(1).nullable(),
  position: z.number().int().nonnegative(),
  added_at: z.string(),
}).refine(
  (a) => (a.explanation_id !== null) !== (a.article_text !== null),
  { message: 'exactly one of explanation_id / article_text must be set', path: ['article_text'] },
);

/** Input for adding an article to a fingerprint's set (one source). */
export const addStyleFingerprintArticleInputSchema = z.object({
  fingerprintId: z.string().uuid(),
  explanationId: z.number().int().optional(),
  articleText: z.string().min(1).optional(),
}).refine(
  (a) => (a.explanationId !== undefined) !== (a.articleText !== undefined),
  { message: 'provide exactly one of explanationId / articleText', path: ['articleText'] },
);

export type StyleFingerprintTraits = z.infer<typeof styleFingerprintTraitsSchema>;
export type EvolutionStyleFingerprintInsert = z.infer<typeof evolutionStyleFingerprintInsertSchema>;
export type EvolutionStyleFingerprintFullDb = z.infer<typeof evolutionStyleFingerprintFullDbSchema>;
export type EvolutionStyleFingerprintArticle = z.infer<typeof evolutionStyleFingerprintArticleSchema>;
export type AddStyleFingerprintArticleInput = z.infer<typeof addStyleFingerprintArticleInputSchema>;

// ─── 2c. evolution_judge_rubrics ─────────────────────────────────
// Reusable named bundle of judging DIMENSIONS for rubric-based pairwise judging.
// Thin entity (identity + metadata); the dimensions live in the
// evolution_judge_rubric_dimensions junction, each a real FK to evolution_criteria
// plus a weight. Weights are NOT constrained to sum to 1 — they are normalized at
// read time (getJudgeRubricForEvaluation), which is robust to a criterion being
// archived after the rubric was built.

export const judgeRubricStatusEnum = z.enum(['active', 'archived']);

/** One rubric dimension on input: which criterion + its (un-normalized) weight. */
export const judgeRubricDimensionInputSchema = z.object({
  criteria_id: z.string().uuid(),
  weight: z.number().min(0).refine(Number.isFinite, { message: 'weight must be finite' }),
  position: z.number().int().min(0).optional(),
});

export const evolutionJudgeRubricInsertSchema = z
  .object({
    name: z.string().min(1).max(200),
    label: z.string().max(200).optional(),
    description: z.string().nullable().optional(),
    status: judgeRubricStatusEnum.optional().default('active'),
    /** At least one dimension; unique criteria_id. */
    dimensions: z.array(judgeRubricDimensionInputSchema).min(1),
  })
  .refine(
    (r) => new Set(r.dimensions.map((d) => d.criteria_id)).size === r.dimensions.length,
    { message: 'duplicate criteria_id in rubric dimensions', path: ['dimensions'] },
  );

export const evolutionJudgeRubricRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  status: judgeRubricStatusEnum,
  is_test_content: z.boolean(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type JudgeRubricDimensionInput = z.infer<typeof judgeRubricDimensionInputSchema>;
export type EvolutionJudgeRubricInsert = z.infer<typeof evolutionJudgeRubricInsertSchema>;
export type EvolutionJudgeRubricRow = z.infer<typeof evolutionJudgeRubricRowSchema>;

// ─── 3. evolution_experiments ────────────────────────────────────

export const evolutionExperimentInsertSchema = z.object({
  name: z.string().min(1).max(500),
  prompt_id: z.string().uuid(),
  status: experimentStatusEnum.optional().default('draft'),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const evolutionExperimentFullDbSchema = evolutionExperimentInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
});

export type EvolutionExperimentInsert = z.infer<typeof evolutionExperimentInsertSchema>;
export type EvolutionExperimentFullDb = z.infer<typeof evolutionExperimentFullDbSchema>;

// ─── 4. evolution_runs ───────────────────────────────────────────

export const evolutionRunInsertSchema = z.object({
  explanation_id: z.number().int().nullable().optional(),
  status: evolutionRunStatusEnum.optional().default('pending'),
  budget_cap_usd: z.number().min(0).optional(),
  // B075: cap error_message length so a 1 MB stack trace doesn't bloat the row.
  error_message: z.string().max(10000).nullable().optional(),
  prompt_id: z.string().uuid().nullable().optional(),
  pipeline_version: z.string().max(50).optional(),
  // DB migration 20260322000007 conditionally applies NOT NULL — keep nullable for safety
  strategy_id: z.string().uuid().nullable().optional(),
  experiment_id: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional().default(false),
  run_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  runner_id: z.string().max(200).nullable().optional(),
  // generate_enforce_style_fingerprint_evolution_20260620: optional reference to the
  // style fingerprint this run opted into (no FK — run survives fingerprint hard-delete).
  style_fingerprint_id: z.string().uuid().nullable().optional(),
  // Immutable snapshot of the fingerprint (traits + rendered prose) captured at run start,
  // so later fingerprint edits never retroactively change what this run was judged against.
  style_fingerprint_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const evolutionRunFullDbSchema = evolutionRunInsertSchema.extend({
  id: z.string().uuid(),
  completed_at: z.string().nullable().default(null),
  created_at: z.string(),
  last_heartbeat: z.string().nullable().default(null),
  // Run-level error surface (Phase 9, generate_rank_evolution_parallel_20260331).
  error_code: z.string().nullable().optional(),
  error_details: z.record(z.string(), z.unknown()).nullable().optional(),
  failed_at_iteration: z.number().int().nullable().optional(),
  failed_at_invocation: z.string().uuid().nullable().optional(),
  // Reproducibility seed (BIGINT in DB; TS read as string).
  random_seed: z.string().nullable().optional(),
  // Iteration snapshots persisted at finalization (JSONB array on the run row).
  // Validated separately on read via iterationSnapshotSchema (declared later in this file).
  iteration_snapshots: z.array(z.unknown()).nullable().optional(),
});

export type EvolutionRunInsert = z.infer<typeof evolutionRunInsertSchema>;
export type EvolutionRunFullDb = z.infer<typeof evolutionRunFullDbSchema>;

// ─── 5. evolution_variants ───────────────────────────────────────

export const evolutionVariantInsertSchema = z.object({
  id: z.string().uuid(), // client-generated UUID
  run_id: z.string().uuid(),
  explanation_id: z.number().int().nullable().optional(),
  variant_content: z.string().min(1),
  // B071: reject NaN/Infinity on elo_score — corrupt values kill leaderboard sort silently.
  elo_score: z.number().refine(Number.isFinite, 'elo_score must be finite').optional(),
  generation: z.number().int().min(0).optional(),
  agent_name: z.string().max(200).optional().nullable(),
  match_count: z.number().int().min(0).optional().default(0),
  is_winner: z.boolean().optional().default(false),
  // bring_back_debate_agent_20260506 Phase 1.16b — array column (additive).
  // The legacy parent_variant_id column still exists at the DB level (its DROP
  // is deferred to a follow-up PR after a soak window). Insert-time we only
  // write parent_variant_ids; the legacy column lands NULL on new rows and
  // existing rows keep their values. parent_variant_ids[0] (in-memory 0-indexed)
  // is the canonical primary parent by convention (e.g. judge's winner for
  // debate variants per Decision §20). Empty array for root/seed variants.
  parent_variant_ids: z.array(z.string().uuid()).optional().default([]),
  prompt_id: z.string().uuid().nullable().optional(),
  synced_to_arena: z.boolean().optional().default(false),
  // B066: reject NaN/Infinity on mu/sigma — these back the Rating {elo, uncertainty} abstraction.
  mu: z.number().refine(Number.isFinite, 'mu must be finite').optional(),
  sigma: z.number().refine(Number.isFinite, 'sigma must be finite').optional(),
  arena_match_count: z.number().int().min(0).optional().default(0),
  // B065: `.min(1)` when non-null so empty strings don't confuse admin filters / group-bys.
  generation_method: z.string().min(1).max(200).optional().nullable(),
  cost_usd: z.number().min(0).optional().nullable(),
  archived_at: z.string().nullable().optional(),
  model: z.string().max(200).optional().nullable(),
  evolution_explanation_id: z.string().uuid().optional().nullable(),
  /** Whether this variant survived to the final pool. False = generated but discarded by
   *  its owning generateFromPreviousArticle agent (budget + low local mu). Default false on
   *  insert; the finalization step writes true for surfaced variants. */
  persisted: z.boolean().optional().default(false),
  /** Phase 5: ID of the agent invocation that produced this variant. Null for historic rows
   *  (no backfill). Used by experimentMetrics to group variants by (agent_name, dimension). */
  agent_invocation_id: z.string().uuid().nullable().optional(),
  /** Full set of criteria UUIDs evaluated by EvaluateCriteriaThenGenerateFromPreviousArticleAgent.
   *  NULL for non-criteria-driven variants. */
  criteria_set_used: z.array(z.string().uuid()).nullable().optional(),
  /** Subset of criteria_set_used auto-picked as the focus for the suggestions step.
   *  NULL for non-criteria-driven variants. */
  weakest_criteria_ids: z.array(z.string().uuid()).nullable().optional(),
  /** Sentence-overlap quality metric (0-1): fraction of parent sentences appearing in child.
   *  Computed at variant creation by all variant-producing agents. NULL for legacy variants
   *  (pre-migration) and where computation failed (defensive try/catch). */
  sentence_verbatim_ratio: z.number().min(0).max(1).nullable().optional(),
});

export const evolutionVariantFullDbSchema = evolutionVariantInsertSchema.extend({
  created_at: z.string(),
});

export type EvolutionVariantInsert = z.infer<typeof evolutionVariantInsertSchema>;
export type EvolutionVariantFullDb = z.infer<typeof evolutionVariantFullDbSchema>;

// ─── 6. evolution_agent_invocations ──────────────────────────────

export const evolutionAgentInvocationInsertSchema = z.object({
  run_id: z.string().uuid(),
  agent_name: z.string().max(200),
  iteration: z.number().int().min(0),
  execution_order: z.number().int().min(0),
  success: z.boolean().optional().nullable(),
  cost_usd: z.number().min(0).optional().nullable(),
  duration_ms: z.number().int().min(0).optional().nullable(),
  // B075: cap error_message length.
  error_message: z.string().max(10000).nullable().optional(),
  execution_detail: z.record(z.string(), z.unknown()).nullable().optional(),
  // B074: `tactic` column exists on the DB (migration 20260417000001_evolution_tactics.sql)
  // but was missing from this Zod schema — new TS-inserted rows were silently NULL.
  tactic: z.string().max(200).nullable().optional(),
  // B048: added by migration 20260423081159. true=surfaced, false=discarded, null=historic.
  variant_surfaced: z.boolean().nullable().optional(),
});

export const evolutionAgentInvocationFullDbSchema = evolutionAgentInvocationInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionAgentInvocationInsert = z.infer<typeof evolutionAgentInvocationInsertSchema>;
export type EvolutionAgentInvocationFullDb = z.infer<typeof evolutionAgentInvocationFullDbSchema>;

// ─── 7. evolution_run_logs ───────────────────────────────────────

export const evolutionRunLogInsertSchema = z.object({
  run_id: z.string().uuid(),
  level: logLevelEnum,
  message: z.string(),
  agent_name: z.string().max(200).nullable().optional(),
  iteration: z.number().int().min(0).nullable().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const evolutionRunLogFullDbSchema = evolutionRunLogInsertSchema.extend({
  id: z.number().int(),
  created_at: z.string(),
});

export type EvolutionRunLogInsert = z.infer<typeof evolutionRunLogInsertSchema>;
export type EvolutionRunLogFullDb = z.infer<typeof evolutionRunLogFullDbSchema>;

// ─── 8. evolution_arena_comparisons ──────────────────────────────

export const evolutionArenaComparisonInsertSchema = z.object({
  prompt_id: z.string().uuid(),
  entry_a: z.string().uuid(),
  entry_b: z.string().uuid(),
  winner: arenaWinnerEnum,
  confidence: z.number().min(0).max(1),
  run_id: z.string().uuid().nullable().optional(),
  status: z.string().max(50).optional(),
  // Rubric judging (20260610000004). rubric_breakdown is a JSONB snapshot whose
  // authoritative shape is RubricBreakdown (evolution/src/lib/shared/rubricJudge.ts);
  // kept loose here since it is validated at creation by the pure aggregator.
  // NOTE: this insert schema intentionally does NOT model the mu/sigma/iteration/
  // invocation columns that MergeRatingsAgent inserts via the raw client — that
  // pre-existing gap is out of scope; only the 2 rubric columns are added here.
  rubric_breakdown: z.unknown().nullable().optional(),
  judge_rubric_id: z.string().uuid().nullable().optional(),
});

export const evolutionArenaComparisonFullDbSchema = evolutionArenaComparisonInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionArenaComparisonInsert = z.infer<typeof evolutionArenaComparisonInsertSchema>;
export type EvolutionArenaComparisonFullDb = z.infer<typeof evolutionArenaComparisonFullDbSchema>;

// ─── 9. evolution_budget_events ──────────────────────────────────

export const budgetEventTypeEnum = z.enum(['reserve', 'spend', 'release_ok', 'release_failed']);

export const evolutionBudgetEventInsertSchema = z.object({
  run_id: z.string().uuid(),
  event_type: budgetEventTypeEnum,
  agent_name: z.string().max(200),
  // B063 + B072: finite + non-negative. A negative refund event (`amount_usd: -100`) would
  // silently deflate reported spend and could un-trip the gate, so `.min(0)` guards it.
  amount_usd: z.number().min(0).refine(Number.isFinite, 'amount_usd must be finite'),
  total_spent_usd: z.number().min(0),
  total_reserved_usd: z.number().min(0),
  // B063: finite guard on available_budget_usd.
  available_budget_usd: z.number().refine(Number.isFinite, 'available_budget_usd must be finite'),
  invocation_id: z.string().uuid().nullable().optional(),
  iteration: z.number().int().min(0).nullable().optional(),
});

export const evolutionBudgetEventFullDbSchema = evolutionBudgetEventInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionBudgetEventInsert = z.infer<typeof evolutionBudgetEventInsertSchema>;
export type EvolutionBudgetEventFullDb = z.infer<typeof evolutionBudgetEventFullDbSchema>;

// ─── 10. evolution_explanations ──────────────────────────────────

export const evolutionExplanationInsertSchema = z.object({
  explanation_id: z.number().int().nullable().optional(),
  prompt_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  source: explanationSourceEnum,
});

export const evolutionExplanationFullDbSchema = evolutionExplanationInsertSchema.extend({
  id: z.number().int(),
  created_at: z.string(),
});

export type EvolutionExplanationInsert = z.infer<typeof evolutionExplanationInsertSchema>;
export type EvolutionExplanationFullDb = z.infer<typeof evolutionExplanationFullDbSchema>;

// ═══════════════════════════════════════════════════════════════════
// Internal Pipeline Type Schemas (Phase 2)
// ═══════════════════════════════════════════════════════════════════

// ─── Variant (in-memory pipeline representation) ─────────────────

export const variantSchema = z.object({
  id: z.string(),
  text: z.string(),
  version: z.number().int().min(0),
  parentIds: z.array(z.string()),
  tactic: z.string(),
  createdAt: z.number(),
  iterationBorn: z.number().int().min(0),
  costUsd: z.number().min(0).optional(),
  fromArena: z.boolean().optional(),
  reusedFromSeed: z.boolean().optional(),
  arenaMatchCount: z.number().int().min(0).optional(),
  /** ID of the agent invocation that produced this variant. Phase 5 attribution uses this
   *  to group variants by (agentName, dimensionValue) for ELO-delta metrics. Optional at
   *  the in-memory layer; persisted as `agent_invocation_id` in `evolution_variants`. */
  agentInvocationId: z.string().optional(),
  /** Full set of criteria UUIDs evaluated by EvaluateCriteriaThenGenerateFromPreviousArticleAgent.
   *  NULL for non-criteria-driven variants (vanilla GFPA, reflection, swiss). Persisted as
   *  `criteria_set_used` UUID[] in `evolution_variants`. */
  criteriaSetUsed: z.array(z.string().uuid()).optional(),
  /** Subset of criteriaSetUsed that the wrapper agent auto-picked as the focus
   *  for the suggestions step (deterministic, normalized-score-based). NULL for
   *  non-criteria-driven variants. Length === effectiveWeakestK at the time of
   *  generation (may be < iterCfg.weakestK if criteria were archived between
   *  configure and run). Persisted as `weakest_criteria_ids` UUID[]. */
  weakestCriteriaIds: z.array(z.string().uuid()).optional(),
  /** Sentence-overlap quality metric (0-1): fraction of parent sentences appearing in child.
   *  Computed at variant creation by all variant-producing agents (vanilla GFPA + wrappers
   *  via inheritance, plus IterativeEditingAgent and ProposerApproverCriteriaGenerateAgent
   *  at their direct apply sites). Persisted as `sentence_verbatim_ratio` NUMERIC. Optional
   *  at in-memory layer; legacy variants and helper-failure cases stay undefined. */
  sentenceVerbatimRatio: z.number().min(0).max(1).optional(),
  /** Provenance label persisted as `agent_name` on `evolution_variants`. For paragraph_recombine
   *  per D10 of rank_individual_paragraphs_evolution_20260525: paragraph rewrites carry
   *  `'paragraph_rewrite'` and originals carry `'paragraph_original'`. Optional at the
   *  in-memory layer — article-level variants leave this undefined and the syncToArena
   *  RPC writes NULL. */
  agentName: z.string().optional(),
  /** Granularity discriminator persisted as `variant_kind` on `evolution_variants` per D13.
   *  Defaults to 'article' for whole-article variants; 'paragraph' for paragraph snippets
   *  produced by paragraph_recombine. Optional at in-memory layer (defaults via Postgres). */
  variantKind: z.enum(['article', 'paragraph']).optional(),
});

export type VariantSchema = z.infer<typeof variantSchema>;

// ─── Generation Guidance ─────────────────────────────────────────

/** Accepts both legacy {strategy, percent} and new {tactic, percent} on read; canonical key is 'tactic'. */
export const generationGuidanceEntrySchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && 'strategy' in val && !('tactic' in val)) {
      const { strategy, ...rest } = val as Record<string, unknown>;
      return { tactic: strategy, ...rest };
    }
    return val;
  },
  z.object({
    tactic: z.string().min(1),
    percent: z.number().min(0).max(100),
  }),
);

export const generationGuidanceSchema = z
  .array(generationGuidanceEntrySchema)
  .min(1)
  .refine(
    (entries: Array<{ tactic: string; percent: number }>) => {
      const names = entries.map((e) => e.tactic);
      return new Set(names).size === names.length;
    },
    { message: 'Duplicate tactic names in generationGuidance' },
  );

export type GenerationGuidanceEntry = z.infer<typeof generationGuidanceEntrySchema>;

// ─── Budget Floor Migration Helpers ───────────────────────────

/**
 * Preprocess legacy budget buffer fields into the new min-budget-floor shape.
 * - If new `minBudgetAfter*Fraction` is set → it wins, legacy is overwritten to match.
 * - If only legacy `budgetBufferAfter*` is set → copy into new Fraction field.
 * - Legacy aliases are kept in the output for ONE release cycle (rollback safety).
 * - Agent-multiple mode has no legacy equivalent — legacy aliases stay undefined.
 */
function preprocessBudgetFloor(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const c = { ...(input as Record<string, unknown>) };

  // Legacy → new (only if new is absent)
  if (c.minBudgetAfterParallelFraction === undefined && c.budgetBufferAfterParallel !== undefined) {
    c.minBudgetAfterParallelFraction = c.budgetBufferAfterParallel;
  }
  if (c.minBudgetAfterSequentialFraction === undefined && c.budgetBufferAfterSequential !== undefined) {
    c.minBudgetAfterSequentialFraction = c.budgetBufferAfterSequential;
  }

  // Sync legacy alias from new Fraction for rollback safety (one-release deprecation).
  // If in agent-multiple mode, legacy stays undefined — there is no fraction equivalent.
  if (c.minBudgetAfterParallelFraction !== undefined) {
    c.budgetBufferAfterParallel = c.minBudgetAfterParallelFraction;
  }
  if (c.minBudgetAfterSequentialFraction !== undefined) {
    c.budgetBufferAfterSequential = c.minBudgetAfterSequentialFraction;
  }

  return c;
}

// ─── Iteration Config ─────────────────────────────────────────

/** Iteration agent type enum.
 *  - `generate`: vanilla GenerateFromPreviousArticleAgent (orchestrator picks tactic).
 *  - `reflect_and_generate`: ReflectAndGenerateFromPreviousArticleAgent — runs a
 *    reflection LLM call to pick the tactic, then delegates to the generation+ranking
 *    flow. Variant-producing like `generate`. Mutually exclusive with generationGuidance.
 *  - `criteria_and_generate`: EvaluateCriteriaThenGenerateFromPreviousArticleAgent —
 *    scores the parent against user-defined criteriaIds in a single LLM call (combined
 *    evaluate + suggest), then delegates to GFPA with a customPrompt built from the
 *    suggestions for the K weakest criteria. Variant-producing.
 *  - `debate_and_generate`: DebateThenGenerateFromPreviousArticleAgent —
 *    runs a single combined "analyze + judge" LLM call comparing the top-2 pool
 *    variants (Option C from bring_back_debate_agent_20260506 Decision §17), then
 *    delegates to GFPA with a customPrompt built from the judge's verdict (strengths
 *    from each parent + improvements). Variant-producing; emits multi-parent lineage
 *    (parentIds=[higher-Elo, lower-Elo] sorted at dispatch — see DebateAgent header).
 *    Cannot be first iteration — requires ≥2 pool variants.
 *  - `swiss`: SwissRankingAgent — re-ranks the existing pool, no new variants.
 */
// 'iterative_editing_rewrite' (Mode B) is the rewrite-then-diff sibling of
// 'iterative_editing' (Mode A). It uses the same dispatch helpers (eligibility
// cutoff, max-cycles), shares the same approver, and produces final variants
// with `parent_variant_id = input.parent.variantId` per Decisions §14. The two
// types are distinct enum values so analytics partition cleanly via
// `evolution_agent_invocations.agent_name` (Agent.name is `abstract readonly`).
export const iterationAgentTypeEnum = z.enum([
  'generate',
  'reflect_and_generate',
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
  'debate_and_generate',
  'iterative_editing',
  'iterative_editing_rewrite',
  'paragraph_recombine',
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — sibling to
  // paragraph_recombine that forces the legacy parallel rewrite path (no priorPicks,
  // no coordinator, no sequential mode), uses isolation-oriented rewrite directives,
  // and runs a Phase D coherence pass on the assembled article via the shared
  // runEditingCycle() helper extracted from IterativeEditingAgent.
  'paragraph_recombine_with_coherence_pass',
  'swiss',
]);

/** Type alias for the iteration-agent-type union. Exported separately from the
 *  Zod enum so client components and boundary types can `import type` it without
 *  pulling Zod into the client bundle. Single source of truth — replaces inline
 *  duplicate unions previously scattered across IterationPlanEntry, IterationResult,
 *  IterationPlanEntryClient, IterationRow, IterationConfigPayload, etc. */
export type IterationAgentType = z.infer<typeof iterationAgentTypeEnum>;

/** Set of agent types that drive criteria-based generation. All three reference criteriaIds + weakestK. */
const CRITERIA_BASED_AGENT_TYPES = new Set<IterationAgentType>([
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
]);

/** Helper: agent types that may appear as the FIRST iteration of a strategy.
 *  Swiss is excluded — it only re-ranks. Debate is excluded — it requires ≥2 pool
 *  variants (top-2 selection). Editing modes (Mode A / Mode B) ARE allowed as the
 *  first iteration when `sourceMode='seed'`: the runtime synthesizes a seed parent
 *  Variant from the run's seed text and dispatches budget-fill editing invocations
 *  off it (design_elo_improvement_experiment_20260626 Phase 1b). All
 *  variant-producing-from-seed agents qualify. */
export function canBeFirstIteration(t: z.infer<typeof iterationAgentTypeEnum>): boolean {
  return t === 'generate'
    || t === 'reflect_and_generate'
    || t === 'criteria_and_generate'
    || t === 'single_pass_evaluate_criteria_and_generate'
    || t === 'proposer_approver_criteria_generate'
    || t === 'iterative_editing'
    || t === 'iterative_editing_rewrite'
    || t === 'paragraph_recombine'
    || t === 'paragraph_recombine_with_coherence_pass';
}

/** Helper: agent types that produce new variants via parallel-batch dispatch + sourceMode/qualityCutoff.
 *  Editing modes are variant-producing but use a different dispatch path (per-parent), so they're not in this set.
 *  Debate produces variants via its own dispatch path (top-2 pool selection inside the agent), so it
 *  also stays out of the parallel-batch sourceMode/qualityCutoff family. */
export function isVariantProducingAgentType(t: IterationAgentType): boolean {
  return t === 'generate'
    || t === 'reflect_and_generate'
    || t === 'criteria_and_generate'
    || t === 'single_pass_evaluate_criteria_and_generate'
    || t === 'proposer_approver_criteria_generate';
}

/** Helper: agent types that produce new variants in the pool. Includes editing
 *  modes per Decisions §14 (final cycle's text is materialized as a Variant). Includes
 *  debate per bring_back_debate_agent_20260506 Decision §15 (synthesis variant
 *  materialized when surfaced=true). Used by the swiss-precedence refine to
 *  ensure swiss never runs before any iteration that would put variants in the pool. */
export function producesNewVariants(t: IterationAgentType): boolean {
  return t === 'generate'
    || t === 'reflect_and_generate'
    || t === 'criteria_and_generate'
    || t === 'single_pass_evaluate_criteria_and_generate'
    || t === 'proposer_approver_criteria_generate'
    || t === 'iterative_editing'
    || t === 'iterative_editing_rewrite'
    || t === 'debate_and_generate'
    || t === 'paragraph_recombine'
    || t === 'paragraph_recombine_with_coherence_pass';
}

/** Helper: agent types that share the iterative-editing config bag (max cycles,
 *  eligibility cutoff, proposer/approver models). Both Mode A and Mode B share
 *  these settings; they differ only in the proposer pathway. */
export function isEditingAgentType(t: z.infer<typeof iterationAgentTypeEnum>): boolean {
  return t === 'iterative_editing' || t === 'iterative_editing_rewrite';
}

/** Source of the parent article for a generate iteration. 'seed' = the run's seed article; 'pool' = a variant drawn from the current run's pool. */
export const sourceModeEnum = z.enum(['seed', 'pool']);

/** Quality cutoff for pool-mode parent selection. topN = absolute count; topPercent = percentile. */
export const qualityCutoffSchema = z.object({
  mode: z.enum(['topN', 'topPercent']),
  value: z.number().positive(),
}).refine(
  (c) => c.mode !== 'topN' || (Number.isInteger(c.value) && c.value >= 1),
  { message: 'topN cutoff must be an integer ≥ 1' },
).refine(
  (c) => c.mode !== 'topPercent' || (c.value > 0 && c.value <= 100),
  { message: 'topPercent cutoff must be in (0, 100]' },
);

export type QualityCutoff = z.infer<typeof qualityCutoffSchema>;

/** Per-iteration config within a strategy. Percentages are stored; dollar amounts computed at runtime. */
export const iterationConfigSchema = z.object({
  /** Agent type for this iteration. See iterationAgentTypeEnum. */
  agentType: iterationAgentTypeEnum,
  /** Percentage of total budget allocated to this iteration (1-100). Dollar amount = budgetPercent / 100 * totalBudgetUsd. */
  budgetPercent: z.number().min(1).max(100),
  /** Source of the parent article: 'seed' (default) or 'pool'. Valid for variant-producing
   *  iterations (generate, reflect_and_generate) AND editing iterations — `sourceMode='seed'`
   *  on an editing iteration makes the runtime synthesize a seed parent and budget-fill editing
   *  invocations off it (Phase 1b). swiss/debate are refined out separately. */
  sourceMode: sourceModeEnum.optional(),
  /** Quality cutoff for pool-mode parent selection. Required when sourceMode='pool'. */
  qualityCutoff: qualityCutoffSchema.optional(),
  /** Per-iteration tactic guidance. Overrides strategy-level generationGuidance for this iteration. Only valid for `agentType: 'generate'` (mutually exclusive with reflect_and_generate which lets the LLM pick). */
  generationGuidance: generationGuidanceSchema.optional(),
  /** How many top tactics the reflection LLM returns (1-10, default 3). Only valid when `agentType === 'reflect_and_generate'`. */
  reflectionTopN: z.number().int().min(1).max(10).optional(),
  /** Per-iteration override for how many propose-review-apply cycles the editing agent runs per parent (1-5, default 3). Only valid for editing agent types (Mode A or Mode B). */
  editingMaxCycles: z.number().int().min(1).max(5).optional(),
  /** Caps how many of the top-Elo variants are eligible for editing per iteration. Defaults to `{ mode: 'topN', value: 10 }` at consumption time (resolveEditingDispatch* helpers). Only valid for editing agent types. Reuses qualityCutoffSchema's value-validation refines. */
  editingEligibilityCutoff: qualityCutoffSchema.optional(),
  // editingProposerSoftCap (Mode B per-iteration soft cap on proposed-edit count) was
  // removed by investigate_iterative_editing_runs_stage_20260623 — see _planning.md.
  // disableApproverFiltering (Mode B opt-out of post-parse coalesce+cap) was removed
  // in the same project; the post-parse coalesce/cap is now DEFAULT-OFF (max approver
  // granularity per the new prompt's "each contiguous change is its own decision" line).
  // Zod default behavior strips unknown keys, so existing strategy JSONB rows that
  // still carry these fields parse cleanly with the fields silently dropped — no
  // migration required.
  /** Criteria UUIDs evaluated by the EvaluateCriteriaThenGenerateFromPreviousArticleAgent.
   *  Required + non-empty when agentType === 'criteria_and_generate'. Mutually exclusive
   *  with generationGuidance (criteria drive the prompt directly). */
  criteriaIds: z.array(z.string().uuid()).optional(),
  /** How many of the lowest-scoring criteria drive the suggestions step (1-5, default 1).
   *  Valid for all 3 criteria-based agent types. Cross-field constraint:
   *  weakestK <= criteriaIds.length. */
  weakestK: z.number().int().min(1).max(5).optional(),
  /** Hard cap on output-length ratio (newText.length / parentText.length) for the
   *  proposer/approve agent's deterministic validator. Default 1.10 at consumption time.
   *  Drops highest-numbered groups until projected article length stays within this ratio.
   *  Range 1.01–1.50. Only valid when agentType === 'proposer_approver_criteria_generate'. */
  lengthCapRatio: z.number().min(1.01).max(1.50).optional(),
  /** Whether the propose/approve agent runs the mirror-approver pass.
   *  Default true at runtime (`?? true`). Only valid when
   *  agentType === 'proposer_approver_criteria_generate'. Hash canonicalization
   *  emits this field ONLY when explicitly false (compact hash for default-on strategies). */
  includesMirrorApprover: z.boolean().optional(),
  /** Per-iteration override for the debate judge's reasoning effort. Only meaningful
   *  when agentType === 'debate_and_generate'. Cascade resolver in debateDispatch.ts
   *  walks: iterCfg.debateJudgeReasoningEffort → strategyCfg.debateJudgeReasoningEffort
   *  → registry's defaultReasoningEffort. Cross-field refinement on the strategy schema
   *  asserts the strategy's judgeModel has supportsReasoning=true when set.
   *  bring_back_debate_agent_20260506 Decision §18 + Phase 1.14. */
  debateJudgeReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  /** rank_individual_paragraphs_evolution_20260525 — paragraph_recombine knobs.
   *  All paragraph_recombine fields below are only valid when agentType === 'paragraph_recombine'. */
  rewritesPerParagraph: z.number().int().min(1).max(6).optional(),
  maxComparisonsPerParagraph: z.number().int().min(1).max(20).optional(),
  maxParagraphsPerInvocation: z.number().int().min(1).max(50).optional(),
  paragraphRewriteModel: z.string().optional(),
  /** Per-invocation safety cap (USD). Default in `ParagraphRecombineAgent` is $0.05;
   *  raise here when the iteration genuinely needs a larger envelope (e.g. high
   *  `rewritesPerParagraph × maxComparisonsPerParagraph`). Upper bound 0.5 catches
   *  order-of-magnitude config errors. Added by
   *  investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Option F).
   *  MUST be emitted by `canonicalizeIterationConfig` to participate in config_hash. */
  perInvocationCapUsd: z.number().min(0.001).max(0.5).optional(),
  /** Hard upper bound on the number of parent variants paragraph_recombine will
   *  process per iteration. Default behavior when unset: `1` (the existing
   *  single-dispatch behavior pre-J). Set to `>1` to opt into multi-dispatch:
   *  the dispatch loop selects up to `maxDispatches` distinct parents from the
   *  `qualityCutoff`-filtered eligible set and runs `ParagraphRecombineAgent`
   *  in parallel against each, mirroring the `generate` iteration's parallel+top-up
   *  pattern. Cap of 10 matches the practical eligible-parent pool size. Added by
   *  investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Option J).
   *  MUST be emitted by `canonicalizeIterationConfig` to participate in config_hash. */
  maxDispatches: z.number().int().min(1).max(10).optional(),
  /** J3 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
   *  per-iteration budget-floor overrides. When set, these take precedence over
   *  the strategy-level `minBudgetAfter*Fraction` / `minBudgetAfter*AgentMultiple`
   *  fields for THIS iteration only. Useful when paragraph_recombine and generate
   *  iterations within the same strategy want different floor profiles (e.g.
   *  generate uses a conservative parallel floor, paragraph_recombine wants
   *  aggressive multi-dispatch with no parallel floor). Fraction takes precedence
   *  over AgentMultiple per `budgetFloorResolvers.ts` selection rules. Honored only
   *  for paragraph_recombine in the current J refactor; the generate runtime path
   *  ignores these (it consults strategy-level fields only). */
  parallelFloorFraction: z.number().min(0).max(1).optional(),
  parallelFloorAgentMultiple: z.number().min(0).optional(),
  sequentialFloorFraction: z.number().min(0).max(1).optional(),
  sequentialFloorAgentMultiple: z.number().min(0).optional(),
  /** paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — coherence-pass
   *  knobs. All five fields below are ONLY valid when agentType === 'paragraph_recombine_with_coherence_pass'
   *  (gated via Zod refinements below; FIELD_GATES in findOrCreateStrategy.ts gates them
   *  out of `config_hash` for other agent types). */
  /** Whether to run the Phase D coherence pass on the assembled article. Default true at
   *  consumption (FIELD_GATES normalizes undefined → true so strategies that omit the
   *  field dedupe to ones that explicitly enable). When false, the per-invocation cap
   *  default flips from $0.10 → $0.05. Used for A/B isolation: run two strategies that
   *  differ only in this field to measure the coherence pass's contribution to Elo lift. */
  coherencePassEnabled: z.boolean().optional(),
  /** Override the proposer model for the coherence pass. Default: strategy.generationModel. */
  coherencePassProposerModel: z.string().optional(),
  /** Override the approver model for the coherence pass. Default: strategy.judgeModel. */
  coherencePassApproverModel: z.string().optional(),
  /** Lower bound of the per-rewrite temperature ladder used by the per-slot pipeline.
   *  Default 0.6. Combined with `coherencePassRewriteTempCeiling`, ops can re-tune at
   *  staging without a redeploy if per-slot TIE rate exceeds 70%. */
  coherencePassRewriteTempFloor: z.number().min(0).max(2).optional(),
  /** Upper bound of the per-rewrite temperature ladder. Default 1.0. Refine: ceiling >= floor. */
  coherencePassRewriteTempCeiling: z.number().min(0).max(2).optional(),
  /** Per investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 3.
   *  Maximum article-growth ratio the coherence-pass propose/approve cycle is allowed.
   *  Default 1.10 (10%). Range 1.0–2.0. Only valid when
   *  agentType === 'paragraph_recombine_with_coherence_pass'. */
  coherencePassLengthCapRatio: z.number().min(1.0).max(2.0).optional(),
  /** Per investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 4.
   *  Maximum number of propose-approve-apply cycles in the coherence pass.
   *  Default 2. Range 1–5. Only valid when
   *  agentType === 'paragraph_recombine_with_coherence_pass'. */
  coherencePassMaxCycles: z.number().int().min(1).max(5).optional(),
  /** Per rebuild_coherence_pass_agent_mode_ab_configurable_20260624.
   *  Editing mode for the coherence pass. 'mode_a' = legacy CriticMarkup-in path
   *  (proposer emits inline {++…++}/{--…--}/{~~old~>new~~} spans, runEditingCycle
   *  parses them directly). 'mode_b' = rewrite-then-diff (proposer emits
   *  ## Rationale + ## Rewrite blocks, runEditingCycle derives CriticMarkup via diff
   *  with rewriteMode: { coalesceAndCap: false }). Default 'mode_b'. Only valid when
   *  agentType === 'paragraph_recombine_with_coherence_pass'. */
  coherencePassEditingMode: z.enum(['mode_a', 'mode_b']).optional(),
}).refine(
  // sourceMode is for parent-article selection in variant-producing iterations.
  // Debate selects parents internally (top-2 from pool snapshot per Decision §16) so
  // it does NOT accept sourceMode.
  (c) => (c.agentType !== 'swiss' && c.agentType !== 'debate_and_generate') || c.sourceMode === undefined,
  { message: 'sourceMode is not valid for swiss or debate_and_generate iterations (swiss does not produce variants; debate selects parents internally). It is valid for generate, reflect_and_generate, the criteria agents, and paragraph_recombine.' },
).refine(
  (c) => (c.agentType !== 'swiss' && c.agentType !== 'debate_and_generate') || c.qualityCutoff === undefined,
  { message: 'qualityCutoff is not valid for swiss or debate_and_generate iterations. It is valid (and required when sourceMode=pool) for generate, reflect_and_generate, the criteria agents, and paragraph_recombine.' },
).refine(
  (c) => c.sourceMode !== 'pool' || c.qualityCutoff !== undefined,
  { message: 'qualityCutoff required when sourceMode is pool' },
).refine(
  // generationGuidance is the "weighted random" tactic selection mechanism — only valid for vanilla generate.
  // reflect_and_generate has its own LLM-driven tactic selection that supersedes guidance.
  (c) => c.agentType === 'generate' || c.generationGuidance === undefined,
  { message: 'generationGuidance only valid for agentType=generate (use reflect_and_generate or criteria_and_generate instead)' },
).refine(
  // reflectionTopN belongs exclusively to reflect_and_generate iterations.
  (c) => c.agentType === 'reflect_and_generate' || c.reflectionTopN === undefined,
  { message: 'reflectionTopN only valid when agentType is reflect_and_generate' },
).refine(
  // editingMaxCycles is shared between editing modes (iterative_editing,
  // iterative_editing_rewrite) AND proposer_approver_criteria_generate (which
  // is single-cycle by definition; the value-must-be-1 refine below enforces).
  (c) => isEditingAgentType(c.agentType) || c.agentType === 'proposer_approver_criteria_generate' || c.editingMaxCycles === undefined,
  { message: 'editingMaxCycles only valid for editing agent types or proposer_approver_criteria_generate' },
).refine(
  // editingEligibilityCutoff is shared between editing modes AND proposer_approver_criteria_generate.
  (c) => isEditingAgentType(c.agentType) || c.agentType === 'proposer_approver_criteria_generate' || c.editingEligibilityCutoff === undefined,
  { message: 'editingEligibilityCutoff only valid for editing agent types or proposer_approver_criteria_generate' },
// (editingProposerSoftCap + disableApproverFiltering Zod refines removed by
//  investigate_iterative_editing_runs_stage_20260623 — see _planning.md.)
).refine(
  // proposer_approver_criteria_generate is single-cycle by definition: editingMaxCycles must be 1 if present.
  (c) => c.agentType !== 'proposer_approver_criteria_generate' || c.editingMaxCycles === undefined || c.editingMaxCycles === 1,
  { message: 'proposer_approver_criteria_generate is single-cycle by definition; editingMaxCycles must be omitted or 1', path: ['editingMaxCycles'] },
).refine(
  // WIDENED: criteriaIds is valid for all 3 criteria-based agent types.
  (c) => CRITERIA_BASED_AGENT_TYPES.has(c.agentType) || c.criteriaIds === undefined,
  { message: 'criteriaIds only valid when agentType is a criteria-based type (criteria_and_generate, single_pass_evaluate_criteria_and_generate, proposer_approver_criteria_generate)' },
).refine(
  (c) => !c.criteriaIds || c.criteriaIds.length > 0,
  { message: 'criteriaIds must have at least 1 entry when present', path: ['criteriaIds'] },
).refine(
  // WIDENED: weakestK is valid for all 3 criteria-based agent types.
  (c) => CRITERIA_BASED_AGENT_TYPES.has(c.agentType) || c.weakestK === undefined,
  { message: 'weakestK only valid when agentType is a criteria-based type (criteria_and_generate, single_pass_evaluate_criteria_and_generate, proposer_approver_criteria_generate)' },
).refine(
  // Cross-field: weakestK <= criteriaIds.length
  (c) => c.weakestK === undefined || !c.criteriaIds || c.weakestK <= c.criteriaIds.length,
  {
    message: 'weakestK cannot exceed the number of selected criteria',
    path: ['weakestK'],
  },
).refine(
  // WIDENED: All 3 criteria-based agent types require criteriaIds (non-empty).
  (c) => !CRITERIA_BASED_AGENT_TYPES.has(c.agentType) || (c.criteriaIds !== undefined && c.criteriaIds.length > 0),
  { message: 'criteria-based agent types require criteriaIds (at least 1)', path: ['criteriaIds'] },
).refine(
  // criteriaIds mutually exclusive with generationGuidance (criteria drive the prompt)
  (c) => !c.criteriaIds || c.generationGuidance === undefined,
  { message: 'criteriaIds and generationGuidance are mutually exclusive', path: ['generationGuidance'] },
).refine(
  // NEW: lengthCapRatio is only valid for proposer_approver_criteria_generate.
  (c) => c.agentType === 'proposer_approver_criteria_generate' || c.lengthCapRatio === undefined,
  { message: 'lengthCapRatio only valid when agentType is proposer_approver_criteria_generate' },
).refine(
  // NEW: includesMirrorApprover is only valid for proposer_approver_criteria_generate.
  (c) => c.agentType === 'proposer_approver_criteria_generate' || c.includesMirrorApprover === undefined,
  { message: 'includesMirrorApprover only valid when agentType is proposer_approver_criteria_generate' },
).refine(
  // rank_individual_paragraphs_evolution_20260525 — paragraph knobs. WIDENED by
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 to also accept
  // the new sibling agent type (which reuses the per-slot rewrite + ranking infrastructure).
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.rewritesPerParagraph === undefined,
  { message: 'rewritesPerParagraph only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.maxComparisonsPerParagraph === undefined,
  { message: 'maxComparisonsPerParagraph only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.maxParagraphsPerInvocation === undefined,
  { message: 'maxParagraphsPerInvocation only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.paragraphRewriteModel === undefined,
  { message: 'paragraphRewriteModel only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.perInvocationCapUsd === undefined,
  { message: 'perInvocationCapUsd only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine'
    || c.agentType === 'paragraph_recombine_with_coherence_pass'
    || c.maxDispatches === undefined,
  { message: 'maxDispatches only valid for paragraph_recombine or paragraph_recombine_with_coherence_pass' },
).refine(
  // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — coherence-pass-only refinements.
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassEnabled === undefined,
  { message: 'coherencePassEnabled only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassProposerModel === undefined,
  { message: 'coherencePassProposerModel only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassApproverModel === undefined,
  { message: 'coherencePassApproverModel only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassRewriteTempFloor === undefined,
  { message: 'coherencePassRewriteTempFloor only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassRewriteTempCeiling === undefined,
  { message: 'coherencePassRewriteTempCeiling only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  // Cross-field: ceiling must be >= floor when both are set.
  (c) => c.coherencePassRewriteTempCeiling === undefined
    || c.coherencePassRewriteTempFloor === undefined
    || c.coherencePassRewriteTempCeiling >= c.coherencePassRewriteTempFloor,
  { message: 'coherencePassRewriteTempCeiling must be >= coherencePassRewriteTempFloor', path: ['coherencePassRewriteTempCeiling'] },
).refine(
  // investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 3.
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassLengthCapRatio === undefined,
  { message: 'coherencePassLengthCapRatio only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  // investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 4.
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassMaxCycles === undefined,
  { message: 'coherencePassMaxCycles only valid when agentType is paragraph_recombine_with_coherence_pass' },
).refine(
  // rebuild_coherence_pass_agent_mode_ab_configurable_20260624.
  (c) => c.agentType === 'paragraph_recombine_with_coherence_pass' || c.coherencePassEditingMode === undefined,
  { message: 'coherencePassEditingMode only valid when agentType is paragraph_recombine_with_coherence_pass' },
);

export type IterationConfig = z.infer<typeof iterationConfigSchema>;

/** Max iterations allowed (safety cap). */
export const MAX_ITERATION_CONFIGS = 20;

// ─── Strategy Config ──────────────────────────────────────────

const strategyConfigBaseSchema = z.object({
  generationModel: z.string(),
  judgeModel: z.string(),
  /** Optional rubric-set id for rubric-based pairwise judging. When set, the ranking
   *  judge returns a per-dimension verdict combined by the rubric's weights instead of
   *  a single holistic A/B/TIE. Strategy-level (applies to all ranking), config-hashed,
   *  validated by validateJudgeRubricId. Omit for holistic judging. */
  judgeRubricId: z.string().uuid().optional(),
  /** investigate_sequential_paragraph_recombine_performance_20260615 Phase 1d (Fix 5b):
   *  Optional rubric-set id for PER-PARAGRAPH rubric-based judging at the slot level
   *  (paragraph_recombine). When set, the per-slot judge uses this rubric's dimensions
   *  instead of the hardcoded paragraph rubric in computeRatings.ts. Independent of
   *  judgeRubricId — that one applies to article-level ranking only (and is stripped
   *  at slot level because article-shaped dimensions like "structure" don't apply at
   *  single-paragraph scale). Strategy authors should design paragraph-shaped
   *  dimensions here. Omit for the hardcoded default. */
  paragraphJudgeRubricId: z.string().uuid().optional(),
  /** Phase 4 (gated, default OFF): named multi-judge escalation chain to use for ranking. Resolved in
   *  buildRunContext to an EnsembleRunner ONLY when EVOLUTION_JUDGE_ESCALATION_ENABLED !== 'false'.
   *  Omit (the default) for single-judge ranking — byte-identical to today. */
  ensembleConfigId: z.string().optional(),
  /** generate_enforce_style_fingerprint_evolution_20260620: per-strategy opt-in for style
   *  enforcement. When true AND styleFingerprintId is set, each run snapshots the referenced
   *  fingerprint at run start and injects it into generation + the stylistic_accuracy judge
   *  dimension. Default off (no fingerprint ⇒ clean no-op). Validated by validateStyleFingerprintId. */
  styleFingerprintEnabled: z.boolean().optional(),
  styleFingerprintId: z.string().uuid().optional(),
  /** Total budget for the run in USD. Per-iteration amounts computed from iterationConfigs[].budgetPercent. */
  budgetUsd: z.number().min(0).optional(),
  generationGuidance: generationGuidanceSchema.optional(),
  /** Hard cap on pairwise comparisons per variant during ranking. Default 15. */
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  /** Minimum budget to reserve after parallel generation, as fraction of totalBudget (0-1). Exactly one of *Fraction or *AgentMultiple may be set per phase. */
  minBudgetAfterParallelFraction: z.number().min(0).max(1).optional(),
  /** Minimum budget to reserve after parallel generation, as multiple of estimated agent cost. Lazy-resolved at runtime. */
  minBudgetAfterParallelAgentMultiple: z.number().min(0).optional(),
  /** Minimum budget to reserve after sequential generation, as fraction of totalBudget (0-1). */
  minBudgetAfterSequentialFraction: z.number().min(0).max(1).optional(),
  /** Minimum budget to reserve after sequential generation, as multiple of actualAvgCostPerAgent (runtime). Falls back to initial estimate if unavailable. */
  minBudgetAfterSequentialAgentMultiple: z.number().min(0).optional(),
  /** @deprecated Use minBudgetAfterParallelFraction. Kept in output for one release (rollback safety). */
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  /** @deprecated Use minBudgetAfterSequentialFraction. Kept in output for one release (rollback safety). */
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  /** Temperature for generation LLM calls (0-2). Omit for provider default. Ranking always uses 0. */
  generationTemperature: z.number().min(0).max(2).optional(),
  /** Model used by the Proposer LLM call in iterative_editing iterations. Falls back to generationModel when unset. (Drift recovery has its own driftRecoveryModel; not exposed at strategy level — defaults to gpt-4.1-nano per Decisions §11.) */
  editingModel: z.string().optional(),
  /** Model used by the Approver LLM call in iterative_editing iterations. Falls back to editingModel (which falls back to generationModel) when unset. When approverModel === editingModel (resolved values), the wizard surfaces a soft rubber-stamping warning per Decisions §16. */
  approverModel: z.string().optional(),
  /** Phase 4d (investigate_sequential_paragraph_recombine_performance_20260615):
   *  model used by the paragraph_recombine COORDINATOR (initial-plan + replan) — the
   *  agent that writes per-slot directives. Falls back to generationModel at runtime
   *  when unset. Reads via (ctx.config as { coordinatorModel?: string }).coordinatorModel
   *  at the two runCoordinator call sites — mirrors the existing editingModel/approverModel
   *  pattern at IterativeEditingAgent.ts:155-167 (no AgentContext mutation). Recommended
   *  upgrade path: flash-lite (default) → gpt-5-mini (safe lift) → claude-sonnet-4 (premium). */
  coordinatorModel: z.string().optional(),
  /** Phase 5 (investigate_sequential_paragraph_recombine_performance_20260615 / 5a-1):
   *  controls which seed variant is picked as `originalText` when a topic has multiple
   *  seeds. 'highest_elo' (default) preserves pre-Phase-5 behavior — `.limit(1)` by
   *  elo_score DESC. 'random' picks a deterministic-per-run seed via SHA-256 of run.id,
   *  spreading parent selection across the seed pool over N runs without losing
   *  reproducibility. Single-seed topics are unaffected. */
  seedSelection: z.enum(['highest_elo', 'random']).optional(),
  /** Strategy-wide default for the debate judge's reasoning effort. Only meaningful
   *  when at least one iteration has agentType: 'debate_and_generate'. Per-iteration
   *  override via iterCfg.debateJudgeReasoningEffort. Cross-field refinement below
   *  asserts judgeModel has supportsReasoning=true when this OR any iteration's
   *  override is set.
   *  bring_back_debate_agent_20260506 Decision §18 + Phase 1.14. */
  debateJudgeReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  /** Ordered sequence of iterations. Each specifies agent type, budget percentage, and optional maxAgents. */
  iterationConfigs: z.array(iterationConfigSchema).min(1).max(MAX_ITERATION_CONFIGS),
}).refine((c) => {
  // Budget percentages must sum to 100 (with floating-point tolerance).
  const sum = c.iterationConfigs.reduce((acc, ic) => acc + ic.budgetPercent, 0);
  return Math.abs(sum - 100) < 0.01;
}, { message: 'iterationConfigs budgetPercent values must sum to 100' }).refine((c) => {
  // First iteration must be one that can run on an empty pool. Editing requires
  // existing variants to edit; swiss only re-ranks. Both excluded by canBeFirstIteration.
  const first = c.iterationConfigs[0];
  return first != null && canBeFirstIteration(first.agentType);
}, { message: 'First iteration must be generate or reflect_and_generate; iterative_editing needs existing variants and swiss on empty pool is invalid' }).refine((c) => {
  // First iteration cannot use pool-mode (pool is empty at start).
  return c.iterationConfigs[0]?.sourceMode !== 'pool';
}, { message: 'First iteration cannot use sourceMode=pool (pool is empty at start); use seed mode' }).refine((c) => {
  // No swiss iteration may precede ALL variant-producing iterations.
  // Editing IS variant-producing per Decisions §14 (final cycle materializes a Variant).
  let hasVariantProducing = false;
  for (const ic of c.iterationConfigs) {
    if (producesNewVariants(ic.agentType)) hasVariantProducing = true;
    if (ic.agentType === 'swiss' && !hasVariantProducing) return false;
  }
  return true;
}, { message: 'A swiss iteration cannot precede all variant-producing iterations (generate, reflect_and_generate, or iterative_editing)' }).refine((c) => {
  // Exactly one parallel unit may be set (both unset is allowed).
  return !(c.minBudgetAfterParallelFraction != null && c.minBudgetAfterParallelAgentMultiple != null);
}, { message: 'Only one of minBudgetAfterParallelFraction or minBudgetAfterParallelAgentMultiple may be set' }).refine((c) => {
  // Exactly one sequential unit may be set (both unset is allowed).
  return !(c.minBudgetAfterSequentialFraction != null && c.minBudgetAfterSequentialAgentMultiple != null);
}, { message: 'Only one of minBudgetAfterSequentialFraction or minBudgetAfterSequentialAgentMultiple may be set' }).refine((c) => {
  // Same unit mode across phases — but only enforced if BOTH phases have a value set.
  const parallelIsFraction = c.minBudgetAfterParallelFraction != null;
  const parallelIsMultiple = c.minBudgetAfterParallelAgentMultiple != null;
  const sequentialIsFraction = c.minBudgetAfterSequentialFraction != null;
  const sequentialIsMultiple = c.minBudgetAfterSequentialAgentMultiple != null;
  if (!sequentialIsFraction && !sequentialIsMultiple) return true;
  if (!parallelIsFraction && !parallelIsMultiple) return true;
  if (parallelIsFraction && sequentialIsFraction) return true;
  if (parallelIsMultiple && sequentialIsMultiple) return true;
  return false;
}, { message: 'Parallel and sequential budget floors must use the same unit mode (both fraction or both agent-multiple)' }).refine((c) => {
  // Ordering: parallel floor must be >= sequential floor.
  const pF = c.minBudgetAfterParallelFraction;
  const pM = c.minBudgetAfterParallelAgentMultiple;
  const sF = c.minBudgetAfterSequentialFraction;
  const sM = c.minBudgetAfterSequentialAgentMultiple;
  if (pF != null && sF != null) return pF >= sF;
  if (pM != null && sM != null) return pM >= sM;
  const sequentialSetAboveZero = (sF != null && sF > 0) || (sM != null && sM > 0);
  const parallelUnset = pF == null && pM == null;
  if (sequentialSetAboveZero && parallelUnset) return false;
  return true;
}, { message: 'Parallel floor must be >= sequential floor (or parallel must be set when sequential is set)' }).refine((c) => {
  if (c.generationTemperature == null) return true;
  const maxTemp = getModelMaxTemperature(c.generationModel);
  if (maxTemp === undefined) return true; // unknown model — let it through
  if (maxTemp === null) return false; // model doesn't support temperature
  return c.generationTemperature <= maxTemp;
}, { message: 'generationTemperature exceeds the model\'s maximum temperature' }).superRefine((cfg, ctx) => {
  // bring_back_debate_agent_20260506 Phase 1.14 — debate reasoning-effort capability check.
  // Appended AFTER all 9 existing .refine() calls (do NOT replace them).
  // When any iteration sets debateJudgeReasoningEffort OR the strategy-level field is set,
  // assert that the strategy's judgeModel has supportsReasoning=true. Otherwise the
  // cascade resolver in debateDispatch.ts would silently drop the effort at runtime,
  // creating a hard-to-debug "I asked for thinking but it didn't think" failure mode.
  for (const [iterIdx, iterCfg] of cfg.iterationConfigs.entries()) {
    const effortSetOnIter = iterCfg.debateJudgeReasoningEffort !== undefined;
    const effortSetOnStrategy = cfg.debateJudgeReasoningEffort !== undefined;
    if (!effortSetOnIter && !effortSetOnStrategy) continue;
    if (!getModelInfo(cfg.judgeModel)?.supportsReasoning) {
      const reasoningModels = Object.entries(MODEL_REGISTRY)
        .filter(([, m]) => m.supportsReasoning)
        .map(([id]) => id)
        .join(', ');
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: effortSetOnIter
          ? ['iterationConfigs', iterIdx, 'debateJudgeReasoningEffort']
          : ['debateJudgeReasoningEffort'],
        message:
          `Strategy's judgeModel (${cfg.judgeModel}) does not support reasoning effort. ` +
          `Either pick a reasoning-capable model or unset debateJudgeReasoningEffort. ` +
          `Reasoning-capable models: ${reasoningModels}.`,
      });
      // Strategy-level error fires once even if multiple iterations also have it set;
      // iteration-level errors fire once per iteration that has it set.
      if (!effortSetOnIter) break;
    }
  }
});

export const strategyConfigSchema = z.preprocess(preprocessBudgetFloor, strategyConfigBaseSchema);

export type StrategyConfigSchema = z.infer<typeof strategyConfigSchema>;

// ─── Evolution Config ────────────────────────────────────────────

// Re-export from the tactic registry (single source of truth).
export { DEFAULT_TACTICS } from './core/tactics';

/** @deprecated Use DEFAULT_TACTICS */
export { DEFAULT_TACTICS as DEFAULT_GENERATE_STRATEGIES } from './core/tactics';

const evolutionConfigBaseSchema = z.object({
  budgetUsd: z.number().gt(0).lte(50),
  judgeModel: z.string(),
  generationModel: z.string(),
  /** Ordered iteration sequence — each specifies agent type, budget percentage, optional maxAgents. */
  iterationConfigs: z.array(iterationConfigSchema).min(1).max(MAX_ITERATION_CONFIGS),
  /** @deprecated Triage calibration opponent count (legacy ranking). */
  calibrationOpponents: z.number().int().min(1).optional(),
  /** @deprecated Top-K eligibility floor (legacy ranking). */
  tournamentTopK: z.number().int().min(1).optional(),
  /** Optional weighted strategy selection from main (predates parallel pipeline). */
  generationGuidance: generationGuidanceSchema.optional(),
  /** Strategy names to round-robin across the N parallel generate agents. */
  strategies: z.array(z.string().min(1)).optional(),
  /** Hard cap on pairwise comparisons per variant during ranking (default 15). */
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  /** Minimum budget to reserve after parallel generation, as fraction of totalBudget (0-1). */
  minBudgetAfterParallelFraction: z.number().min(0).max(1).optional(),
  /** Minimum budget to reserve after parallel generation, as multiple of estimated agent cost. */
  minBudgetAfterParallelAgentMultiple: z.number().min(0).optional(),
  /** Minimum budget to reserve after sequential generation, as fraction of totalBudget (0-1). */
  minBudgetAfterSequentialFraction: z.number().min(0).max(1).optional(),
  /** Minimum budget to reserve after sequential generation, as multiple of actualAvgCostPerAgent. */
  minBudgetAfterSequentialAgentMultiple: z.number().min(0).optional(),
  /** @deprecated Use minBudgetAfterParallelFraction. Kept in output for one release (rollback safety). */
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  /** @deprecated Use minBudgetAfterSequentialFraction. Kept in output for one release (rollback safety). */
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  /** Temperature for generation LLM calls (0-2). Omit for provider default. Ranking always uses 0. */
  generationTemperature: z.number().min(0).max(2).optional(),
  /** Comparison prompt mode for ranking. 'paragraph' selects the paragraph-level judge prompt
   *  (set on the per-slot config by ParagraphRecombineAgent). Run-internal override — never set
   *  at strategy level, so it is NOT part of the strategy config_hash. Default/omitted = 'article'. */
  comparisonMode: z.enum(['article', 'paragraph']).optional(),
  /** Rubric-set id (from StrategyConfig). Resolved to `judgeRubric` in buildRunContext. */
  judgeRubricId: z.string().uuid().optional(),
  /** Resolved rubric (dimensions + normalized weights + criteria text). Present only
   *  when judgeRubricId resolved AND the kill switch is on; undefined → holistic. */
  judgeRubric: z.custom<ResolvedJudgeRubric>().optional(),
  /** Phase 1d (Fix 5b): per-paragraph rubric id from StrategyConfig. Resolved to
   *  `paragraphJudgeRubric` in buildRunContext (same kill switch as the article rubric).
   *  At slot level the article-rubric is stripped (article-shaped dimensions don't
   *  apply at single-paragraph scale) and this one is attached instead. Omit → slot
   *  judge falls back to the hardcoded paragraph rubric. */
  paragraphJudgeRubricId: z.string().uuid().optional(),
  /** Phase 1d: resolved per-paragraph rubric. Present only when paragraphJudgeRubricId
   *  resolved AND EVOLUTION_RUBRIC_JUDGING_ENABLED is on; undefined → hardcoded paragraph rubric. */
  paragraphJudgeRubric: z.custom<ResolvedJudgeRubric>().optional(),
  /** generate_enforce_style_fingerprint_evolution_20260620: resolved per-run style fingerprint
   *  (article-shaped prose + structured traits). Carried on the run config (parallel to judgeRubric),
   *  sourced from the run's style_fingerprint_snapshot in buildRunContext; undefined when the strategy
   *  did not opt in. Generation reads it via AgentContext.styleFingerprint. Article ranking reads
   *  `prose` and threads it into buildRubricComparisonPrompt; paragraph slot judging renders the
   *  PARAGRAPH-shaped prose from `traits` and OVERRIDES it on perSlotConfig. */
  styleFingerprint: z.object({
    prose: z.string(),
    traits: styleFingerprintTraitsSchema,
  }).optional(),
  /** Named ensemble chain id (from StrategyConfig). Resolved to `ensemble` in buildRunContext. */
  ensembleConfigId: z.string().optional(),
  /** Resolved ensemble chain + aggregation rule. Present ONLY when ensembleConfigId resolved AND the
   *  EVOLUTION_JUDGE_ESCALATION_ENABLED kill switch is on; undefined → single-judge ranking. */
  ensemble: z.custom<EnsembleConfig>().optional(),
  /** Optional model overrides propagated from StrategyConfig. The agent layer reads
   *  them off ctx.config via cast (mirrors IterativeEditingAgent.ts:155-167 pattern).
   *  Required here in the resolved EvolutionConfig so the propagation from
   *  stratConfig → ctx.config doesn't silently drop them (Phase 4d canary B
   *  silent-fallback bug observed 2026-06-19). */
  editingModel: z.string().optional(),
  approverModel: z.string().optional(),
  coordinatorModel: z.string().optional(),
});

export const evolutionConfigSchema = z.preprocess(preprocessBudgetFloor, evolutionConfigBaseSchema);

export type EvolutionConfigSchema = z.infer<typeof evolutionConfigSchema>;

// ─── V2 Match ────────────────────────────────────────────────────

export const v2MatchSchema = z.object({
  winnerId: z.string(),
  loserId: z.string(),
  result: z.enum(['win', 'draw']),
  confidence: z.number().min(0).max(1),
  judgeModel: z.string(),
  reversed: z.boolean(),
  /** Per-dimension rubric snapshot when this match was rubric-judged (else absent). */
  rubricBreakdown: z.custom<RubricBreakdown>().optional(),
  /** Phase 4: the multi-judge escalation fold (chain + rule + submatches) when this match was
   *  ensemble-judged. Absent for single-judge matches (the default). */
  submatches: z.custom<EnsembleSubmatches>().optional(),
});

export type V2MatchSchema = z.infer<typeof v2MatchSchema>;

// ─── Rating ──────────────────────────────────────────────────────

export const ratingSchema = z.object({
  // B028: reject NaN/Infinity on rating fields — plain `z.number()` accepts both, and
  // `.positive()` on `uncertainty` accepts `Infinity` too (Infinity > 0 is true). Corrupt
  // values would poison updateRating(), toDisplayElo(), and the arena leaderboard.
  elo: z.number().refine(Number.isFinite, 'elo must be finite'),
  uncertainty: z.number().positive().refine(Number.isFinite, 'uncertainty must be finite'),
});

export type RatingSchema = z.infer<typeof ratingSchema>;

// ─── Cached Match ────────────────────────────────────────────────

export const cachedMatchSchema = z.object({
  winnerId: z.string().nullable(),
  loserId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  isDraw: z.boolean(),
});

export type CachedMatchSchema = z.infer<typeof cachedMatchSchema>;

// ─── Evolution Result ────────────────────────────────────────────

export const evolutionResultSchema = z.object({
  winner: variantSchema,
  pool: z.array(variantSchema),
  ratings: z.map(z.string(), ratingSchema),
  matchHistory: z.array(v2MatchSchema),
  totalCost: z.number().min(0),
  iterationsRun: z.number().int().min(0),
  stopReason: z.enum(['total_budget_exceeded', 'killed', 'deadline', 'completed', 'budget_exceeded', 'iterations_complete', 'converged', 'time_limit', 'no_pairs', 'seed_failed']),
  eloHistory: z.array(z.array(z.number())),
  diversityHistory: z.array(z.number()),
  matchCounts: z.record(z.string(), z.number().int().min(0)),
});

export type EvolutionResultSchema = z.infer<typeof evolutionResultSchema>;

// ─── Critique ────────────────────────────────────────────────────

export const critiqueSchema = z.object({
  variationId: z.string(),
  dimensionScores: z.record(z.string(), z.number()),
  goodExamples: z.record(z.string(), z.array(z.string())),
  badExamples: z.record(z.string(), z.array(z.string())),
  notes: z.record(z.string(), z.string()),
  reviewer: z.string(),
  scale: z.enum(['1-10', '0-5']).optional(),
});

export type CritiqueSchema = z.infer<typeof critiqueSchema>;

// ─── Meta Feedback ───────────────────────────────────────────────

export const metaFeedbackSchema = z.object({
  recurringWeaknesses: z.array(z.string()),
  priorityImprovements: z.array(z.string()),
  successfulStrategies: z.array(z.string()),
  patternsToAvoid: z.array(z.string()),
});

export type MetaFeedbackSchema = z.infer<typeof metaFeedbackSchema>;

// ─── Agent Execution Detail (11-variant discriminated union) ─────

const executionDetailBaseSchema = z.object({
  totalCost: z.number().min(0),
  _truncated: z.boolean().optional(),
});

export const generationExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('generation'),
  strategies: z.array(z.object({
    name: z.string(),
    promptLength: z.number().int().min(0),
    status: z.enum(['success', 'format_rejected', 'error']),
    formatIssues: z.array(z.string()).optional(),
    variantId: z.string().optional(),
    textLength: z.number().int().min(0).optional(),
    error: z.string().optional(),
  })),
  feedbackUsed: z.boolean(),
});

// IterativeEditingAgent execution_detail (v2 redesign — replaces the orphaned V1
// rubric-driven schema). Captures the full Proposer / pre-check / Approver /
// Implementer audit trail per cycle, plus per-purpose cost split per
// Decisions §13 invariant I2. See bring_back_editing_agents_evolution_20260430
// planning doc Phase 1.8 for the full specification.

const editingAtomicEditSchema = z.object({
  /** Atomic edit number from the markup `[#N]`. Multiple atomic edits can share a
   *  number — they form an atomic accept/reject group. */
  groupNumber: z.number().int().min(1),
  /** Edit kind: insert / delete / replace. Paired add+delete with the same [#N]
   *  is normalized to 'replace' by the parser. */
  kind: z.enum(['insert', 'delete', 'replace']),
  /** Position in the current article text (post-strip-markup) where the edit applies. */
  range: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }),
  /** Position in the proposer's marked-up output (used for AnnotatedProposals UI). */
  markupRange: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }),
  /** Original text being deleted/replaced (empty for inserts). */
  oldText: z.string(),
  /** New text being inserted (empty for deletes). */
  newText: z.string(),
  /** Up to 30 chars before/after the edit in the source — context-string failsafe. */
  contextBefore: z.string(),
  contextAfter: z.string(),
});

const editingGroupSchema = z.object({
  groupNumber: z.number().int().min(1),
  atomicEdits: z.array(editingAtomicEditSchema).min(1),
});

const editingReviewDecisionSchema = z.object({
  groupNumber: z.number().int().min(1),
  decision: z.enum(['accept', 'reject']),
  reason: z.string(),
  /** Optional guardrail violation flags — populated by ProposerApproverCriteriaGenerateAgent's
   *  approver only (legacy IterativeEditingAgent's approver doesn't emit these). Backward-compat:
   *  optional fields default to undefined on missing input. parseReviewDecisions preserves these
   *  when present in the LLM JSONL. */
  redundancy_violation: z.boolean().optional(),
  flow_violation: z.boolean().optional(),
  length_violation: z.boolean().optional(),
});

const editingDriftRegionSchema = z.object({
  offset: z.number().int().min(0),
  driftedText: z.string(),
  classification: z.enum(['benign', 'intentional']).optional(),
  patch: z.string().optional(),
});

const editingDroppedGroupSchema = z.object({
  groupNumber: z.number().int().min(1),
  reason: z.string(),
  detail: z.string().optional(),
});

const editingCycleSchema = z.object({
  cycleNumber: z.number().int().min(1),
  /** Proposer's full marked-up output (article body + inline CriticMarkup). */
  proposedMarkup: z.string(),
  /** Raw groups parsed from proposedMarkup BEFORE any filtering. */
  proposedGroupsRaw: z.array(editingGroupSchema),
  /** Groups dropped by the pre-check (parser failures, hard-rule violations,
   *  size-ratio guardrail, cycle/group caps). */
  droppedPreApprover: z.array(editingDroppedGroupSchema),
  /** Groups sent to the Approver after pre-check filtering. */
  approverGroups: z.array(editingGroupSchema),
  /** Approver's per-group decisions. */
  reviewDecisions: z.array(editingReviewDecisionSchema),
  /** Groups dropped post-Approver (range overlap, context-failsafe mismatch). */
  droppedPostApprover: z.array(editingDroppedGroupSchema),
  /** Groups successfully applied to current.text. */
  appliedGroups: z.array(editingGroupSchema),
  acceptedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  appliedCount: z.number().int().min(0),
  formatValid: z.boolean(),
  /** ID of the materialized Variant if this was the FINAL cycle that produced
   *  output; undefined for intermediate cycles (per Decisions §14 — only the
   *  final cycle materializes as a Variant). */
  newVariantId: z.string().optional(),
  /** Cycle's input text (parent.text for cycle 1, prior cycle's childText otherwise). */
  parentText: z.string(),
  /** Cycle's output text after applying accepted edits. */
  childText: z.string().optional(),
  /** Drift recovery details (only present when the strip-markup drift check fired). */
  driftRecovery: z.object({
    outcome: z.enum(['recovered', 'unrecoverable_residual', 'unrecoverable_intentional', 'skipped_major_drift']),
    regions: z.array(editingDriftRegionSchema),
    classifications: z.array(editingDriftRegionSchema).optional(),
    patchedMarkup: z.string().optional(),
    costUsd: z.number().min(0).optional(),
  }).optional(),
  /** Per-purpose cost split per Decisions §13 invariant I2. */
  proposeCostUsd: z.number().min(0),
  approveCostUsd: z.number().min(0),
  driftRecoveryCostUsd: z.number().min(0).optional(),
  /** Final-newText / cycle-input-text length ratio for monitoring (≤1.5× per
   *  Decisions §17). */
  sizeRatio: z.number().min(0),
  // Phase 3 (Mode B) — optional fields populated only when this cycle ran
  // through IterativeEditingRewriteAgent. Mode A leaves them undefined.
  /** Discriminator: 'markup' for Mode A, 'rewrite' for Mode B. */
  proposerMode: z.enum(['markup', 'rewrite']).optional(),
  /** Mode B: prose paragraph the proposer wrote explaining its intent. Surfaced
   *  to the approver as priming context (with red-team caveat) and to operators
   *  via the run-detail UI. */
  rationale: z.string().optional(),
  /** Mode B: full rewritten article body, truncated to 8 KB before persistence. */
  rewriteText: z.string().optional(),
  /** Mode B: CriticMarkup string the diff engine computed from (source, rewrite).
   *  Identical to proposedMarkup; persisted separately for forensics so a
   *  Mode B cycle can be replayed against a different parser/diff version. */
  computedMarkup: z.string().optional(),
  /** Mode B: serialized originalError when stopReason ∈ {rewrite_parse_failed,
   *  diff_engine_failed} — for forensic inspection. */
  errorContext: z.object({
    type: z.string(),
    message: z.string(),
    line: z.number().optional(),
    col: z.number().optional(),
  }).optional(),
  /** Mode B: free-form error message attached to abort cases. */
  errorMessage: z.string().optional(),
});

// ─── Ranking sub-schemas (relocated up from the parallel-pipeline section) ─────
// These were originally defined further down (alongside the parallel pipeline
// agents). They are hoisted here so iterativeEditingExecutionDetailSchema can
// reference them without forward-reference errors at module load
// (add_ranking_iterative_editing_agent_evolution_20260502 Phase 1.1).

/** Shallow key-rename preprocessor for Zod backward-compat normalization.
 *  Leaves non-object values untouched; replaces old key names with new ones. */
function renameKeys(mapping: Record<string, string>): (val: unknown) => unknown {
  return (val: unknown) => {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[mapping[k] ?? k] = v;
    }
    return out;
  };
}

/** generateFromPreviousArticle: ranking comparison record (one per binary-search comparison). */
const rankNewVariantComparisonInnerSchema = z.object({
  round: z.number().int().min(1),
  opponentId: z.string(),
  selectionScore: z.number(),
  pWin: z.number().min(0).max(1),
  variantEloBefore: z.number(),
  variantUncertaintyBefore: z.number().min(0),
  opponentEloBefore: z.number(),
  opponentUncertaintyBefore: z.number().min(0),
  outcome: z.enum(['win', 'loss', 'draw']),
  confidence: z.number().min(0).max(1),
  variantEloAfter: z.number(),
  variantUncertaintyAfter: z.number().min(0),
  opponentEloAfter: z.number(),
  opponentUncertaintyAfter: z.number().min(0),
  top15CutoffAfter: z.number(),
  eloPlusTwoUncertainty: z.number(),
  eliminated: z.boolean(),
  converged: z.boolean(),
  /** Wall-clock duration of this comparison (both 2-pass reversal LLM calls, parallel). Optional — historical invocations have no timing data. */
  durationMs: z.number().int().min(0).optional(),
  /** Forward-pass LLM call duration. Optional — historical invocations have no timing data. */
  forwardCallDurationMs: z.number().int().min(0).optional(),
  /** Reverse-pass LLM call duration. Optional — historical invocations have no timing data. */
  reverseCallDurationMs: z.number().int().min(0).optional(),
});

export const rankNewVariantComparisonSchema = z.preprocess(
  renameKeys({
    variantMuBefore: 'variantEloBefore',
    variantSigmaBefore: 'variantUncertaintyBefore',
    opponentMuBefore: 'opponentEloBefore',
    opponentSigmaBefore: 'opponentUncertaintyBefore',
    variantMuAfter: 'variantEloAfter',
    variantSigmaAfter: 'variantUncertaintyAfter',
    opponentMuAfter: 'opponentEloAfter',
    opponentSigmaAfter: 'opponentUncertaintyAfter',
    muPlusTwoSigma: 'eloPlusTwoUncertainty',
  }),
  rankNewVariantComparisonInnerSchema,
);

const rankNewVariantDetailInnerSchema = z.object({
  variantId: z.string(),
  localPoolSize: z.number().int().min(0),
  localPoolVariantIds: z.array(z.string()),
  initialTop15Cutoff: z.number(),
  comparisons: z.array(rankNewVariantComparisonSchema),
  stopReason: z.enum(['converged', 'eliminated', 'no_more_opponents', 'budget']),
  totalComparisons: z.number().int().min(0),
  finalLocalElo: z.number(),
  finalLocalUncertainty: z.number().min(0),
  finalLocalTop15Cutoff: z.number(),
  /** Wall-clock duration of the full ranking phase for this variant. Optional — historical invocations have no timing data. */
  durationMs: z.number().int().min(0).optional(),
});

const rankingDetailRenameKeys = renameKeys({
  finalLocalMu: 'finalLocalElo',
  finalLocalSigma: 'finalLocalUncertainty',
});

export const rankNewVariantDetailSchema = z.preprocess(
  rankingDetailRenameKeys,
  rankNewVariantDetailInnerSchema,
);

export const iterativeEditingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('iterative_editing'),
  /** ID of the input parent variant (the original parent assigned by dispatch — not a
   *  cycle-N-1 intermediate). */
  parentVariantId: z.string(),
  /** Resolved per-iteration / strategy config. */
  config: z.object({
    maxCycles: z.number().int().min(1).max(5),
    editingModel: z.string(),
    approverModel: z.string(),
    driftRecoveryModel: z.string(),
    perInvocationBudgetUsd: z.number().min(0),
  }),
  cycles: z.array(editingCycleSchema),
  /** Per-iteration termination reason. */
  stopReason: z.enum([
    'all_cycles_completed',
    'all_edits_rejected',
    'no_edits_proposed',
    'parse_failed',
    'proposer_drift_major',
    'proposer_drift_intentional',
    'proposer_drift_unrecoverable',
    'invocation_budget_near_exhaustion',
    'article_size_explosion',
    'format_invalid',
    'helper_threw',
    'budget_exceeded',
    // Phase 2 (Mode A): pre-flight structural rejection
    'structural_rewrite',
    // Phase 3 (Mode B): rewrite-mode error paths
    'proposer_format_violation',
    'rewrite_parse_failed',
    'diff_engine_failed',
    'rewrite_too_large',
  ]),
  /** Set when stopReason === 'helper_threw' — which helper failed. */
  errorPhase: z.enum(['propose', 'parse', 'approve', 'recovery', 'apply']).optional(),
  errorMessage: z.string().optional(),
  /** ID of the final materialized variant (undefined when no cycle accepted edits). */
  finalVariantId: z.string().optional(),
  /** True iff the final variant was emitted AND surfaced (passed ranking discard if ranking ran). */
  surfaced: z.boolean().optional(),
  /** Local-rank rating from the post-cycle binary-search ranking phase. Populated whenever
   *  ranking runs (input.initialPool present and final variant emitted). null when ranking
   *  was skipped via the input-presence gate. Both `.optional()` (back-compat for DB rows
   *  written before this schema field existed) and `.nullable()` (allows explicit null). */
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).optional().nullable(),
});

export const reflectionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('reflection'),
  variantsCritiqued: z.array(z.object({
    variantId: z.string(),
    status: z.enum(['success', 'parse_failed', 'error']),
    avgScore: z.number().optional(),
    dimensionScores: z.record(z.string(), z.number()).optional(),
    goodExamples: z.record(z.string(), z.array(z.string())).optional(),
    badExamples: z.record(z.string(), z.array(z.string())).optional(),
    notes: z.record(z.string(), z.string()).optional(),
    error: z.string().optional(),
  })),
  dimensions: z.array(z.string()),
});

/**
 * DebateThenGenerateFromPreviousArticleAgent execution detail (V2 Option-C revival —
 * see bring_back_debate_agent_20260506 Decisions §17, §19, §20).
 *
 * Option C shape: ONE combined "analyze + judge" LLM call producing structured
 * {prosA, consA, prosB, consB, winner, reasoning, strengthsFromA, strengthsFromB,
 * improvements}, THEN delegate to inner GFPA via .execute() with customPrompt
 * built from the verdict. Mirrors evaluate_criteria_then_generate shape exactly.
 *
 * Multi-parent lineage: the synthesized variant's parentIds is sorted in ELO order
 * at debate dispatch time — parentIds[0] = highest-Elo input (canonical primary),
 * parentIds[1] = second-highest-Elo input. Independent of the judge's content-based
 * pick (which lives in execution_detail.debate.combined.winner). Order is load-bearing
 * because elo_delta_vs_parent reads parentIds[0] for the baseline. (Originally
 * Decision §20 emitted [winner.id, loser.id]; revised 2026-05-09 — see DebateAgent header.)
 *
 * Reasoning trace (Phase 1.20): when debateJudgeReasoningEffort is set, the
 * combined call records reasoningTokens and (provider-permitting) reasoningTrace
 * + reasoningTraceFormat. Three-state semantics:
 *   - reasoningTokens === 0 + reasoningTraceFormat undefined: thinking not requested.
 *   - reasoningTokens > 0 + reasoningTraceFormat 'verbatim'|'summary': trace surfaced.
 *   - reasoningTokens > 0 + reasoningTraceFormat 'unavailable': thinking happened
 *     but provider dropped trace text.
 *
 * Mu→Elo preprocess: {variantA, variantB} accept legacy `{id, mu}` from V1 fixtures.
 */
const debateMuRename = renameKeys({ mu: 'elo' });
const debateVariantSchema = z.preprocess(debateMuRename, z.object({
  id: z.string(),
  elo: z.number(),
}));

export const debateExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('debate_then_generate_from_previous_article'),
  /** Static marker tactic per Decision §9; lineage graph + tactic leaderboard
   *  groups all debate-synthesized variants under this. */
  tactic: z.literal('debate_synthesis'),
  /** Pool variant the wrapper selected as parent A (top-Elo). Captured for direct
   *  rendering without joining. */
  variantA: debateVariantSchema,
  /** Pool variant the wrapper selected as parent B (second-highest Elo with id-tiebreak). */
  variantB: debateVariantSchema,
  /** Combined "analyze + judge" sub-detail. Single LLM call source per Option C
   *  (Decision §17). Optional so partial-failure rows still validate. */
  debate: z.object({
    combined: z.object({
      // The 9 verdict fields are populated only when parse succeeds. On combined_call
      // or parse failure paths, the wrapper writes `combined` with only the metadata
      // fields (cost, durationMs, rawResponse, parseError) and omits the verdict.
      /** Specific strengths LLM identified for parent A. */
      prosA: z.array(z.string()).optional(),
      /** Specific weaknesses LLM identified for parent A. */
      consA: z.array(z.string()).optional(),
      /** Specific strengths LLM identified for parent B. */
      prosB: z.array(z.string()).optional(),
      /** Specific weaknesses LLM identified for parent B. */
      consB: z.array(z.string()).optional(),
      /** Legacy field — retained for backward-compat with rows persisted before
       *  2026-05-09 when the judge picked a winner. Removed from new outputs:
       *  ELO determines synthesis base. */
      winner: z.enum(['A', 'B', 'tie']).optional(),
      /** 1-2 sentence rationale framing for the synthesis. */
      reasoning: z.string().optional(),
      /** Specific strengths to preserve from parent A — feeds inner GFPA customPrompt. */
      strengthsFromA: z.array(z.string()).optional(),
      /** Specific strengths to preserve from parent B — feeds inner GFPA customPrompt. */
      strengthsFromB: z.array(z.string()).optional(),
      /** Actionable improvements for the synthesis — feeds inner GFPA customPrompt. */
      improvements: z.array(z.string()).optional(),
      /** Cost of the combined LLM call. Recorded under 'debate_judge' AgentName. */
      cost: z.number().min(0).optional(),
      /** Wall-clock duration of the combined call. */
      durationMs: z.number().int().min(0).optional(),
      /** Raw LLM response — captured on parse failure for forensic debugging. */
      rawResponse: z.string().optional(),
      /** Set when JSON parse or schema validation failed. */
      parseError: z.string().optional(),
      /** Cascade-resolved reasoning effort actually used (per Decision §18). */
      reasoningEffortResolved: z.enum(['none', 'low', 'medium', 'high']).optional(),
      /** Number of reasoning tokens consumed (always populated when thinking-mode active). */
      reasoningTokens: z.number().int().min(0).optional(),
      /** Reasoning trace text. Format depends on provider — see reasoningTraceFormat. */
      reasoningTrace: z.string().optional(),
      /** Provider-specific shape: 'verbatim' (OpenRouter), 'summary' (OpenAI/Anthropic),
       *  or 'unavailable' (thinking happened but trace dropped). */
      reasoningTraceFormat: z.enum(['verbatim', 'summary', 'unavailable']).optional(),
    }).optional(),
    /** Failure point along the execution path. Used for partial-detail-on-throw observability.
     *  `judge_tie` is retained in the enum for backward-compat with rows persisted before
     *  2026-05-09 (when the judge had a `winner` field). New code paths never emit it. */
    failurePoint: z.enum([
      'gate',
      'selection',
      'combined_call',
      'parse',
      'judge_tie',
      'synthesis',
      'synthesis_empty',
      'synthesis_no_op',
      'budget',
    ]).optional(),
  }).optional(),
  /** Generation sub-detail. Reused from GFPA shape. */
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
  }).optional(),
  /** Ranking sub-detail. Reused from GFPA shape. */
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable().optional(),
  /** Total cost = combined.cost + generation.cost + ranking.cost. */
  totalCost: z.number().min(0).optional(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

export const sectionDecompositionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('sectionDecomposition'),
  targetVariantId: z.string(),
  weakness: z.object({ dimension: z.string(), description: z.string() }),
  sections: z.array(z.object({
    index: z.number().int().min(0),
    heading: z.string().nullable(),
    eligible: z.boolean(),
    improved: z.boolean(),
    charCount: z.number().int().min(0),
  })),
  sectionsImproved: z.number().int().min(0),
  totalEligible: z.number().int().min(0),
  formatValid: z.boolean(),
  newVariantId: z.string().optional(),
});

export const evolutionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('evolution'),
  parents: z.array(z.object({ id: z.string(), mu: z.number() })),
  mutations: z.array(z.object({
    tactic: z.string(),
    status: z.enum(['success', 'format_rejected', 'error']),
    variantId: z.string().optional(),
    textLength: z.number().int().min(0).optional(),
    error: z.string().optional(),
  })),
  creativeExploration: z.boolean(),
  creativeReason: z.enum(['random', 'low_diversity']).optional(),
  overrepresentedTactics: z.array(z.string()).optional(),
  feedbackUsed: z.boolean(),
});

export const treeSearchExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('treeSearch'),
  rootVariantId: z.string(),
  config: z.object({
    beamWidth: z.number().int().min(1),
    branchingFactor: z.number().int().min(1),
    maxDepth: z.number().int().min(1),
  }),
  result: z.object({
    treeSize: z.number().int().min(0),
    maxDepth: z.number().int().min(0),
    prunedBranches: z.number().int().min(0),
    revisionPath: z.array(z.object({
      type: z.string(),
      dimension: z.string().optional(),
      description: z.string(),
    })),
  }),
  bestLeafVariantId: z.string().optional(),
  addedToPool: z.boolean(),
});

export const outlineGenerationExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('outlineGeneration'),
  steps: z.array(z.object({
    name: z.enum(['outline', 'expand', 'polish', 'verify']),
    score: z.number().min(0).max(1),
    costUsd: z.number().min(0),
    inputLength: z.number().int().min(0),
    outputLength: z.number().int().min(0),
  })),
  weakestStep: z.string().nullable(),
  variantId: z.string(),
});

export const rankingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('ranking'),
  triage: z.array(z.object({
    variantId: z.string(),
    opponents: z.array(z.string()),
    matches: z.array(z.object({
      opponentId: z.string(),
      winner: z.string(),
      confidence: z.number().min(0).max(1),
      cacheHit: z.boolean(),
    })),
    eliminated: z.boolean(),
    ratingBefore: ratingSchema,
    ratingAfter: ratingSchema,
  })),
  fineRanking: z.object({
    rounds: z.number().int().min(0),
    exitReason: z.enum(['budget', 'convergence', 'stale', 'maxRounds', 'time_limit', 'no_contenders']),
    convergenceStreak: z.number().int().min(0),
  }),
  budgetPressure: z.number().min(0),
  budgetTier: z.enum(['low', 'medium', 'high']),
  top20Cutoff: z.number(),
  eligibleContenders: z.number().int().min(0),
  totalComparisons: z.number().int().min(0),
  flowEnabled: z.boolean(),
  low_uncertainty_opponents_count: z.number().int().min(0).optional(),
});

export const proximityExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('proximity'),
  newEntrants: z.number().int().min(0),
  existingVariants: z.number().int().min(0),
  diversityScore: z.number().min(0),
  totalPairsComputed: z.number().int().min(0),
});

export const metaReviewExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('metaReview'),
  successfulStrategies: z.array(z.string()),
  recurringWeaknesses: z.array(z.string()),
  patternsToAvoid: z.array(z.string()),
  priorityImprovements: z.array(z.string()),
  analysis: z.object({
    tacticMus: z.record(z.string(), z.number()),
    bottomQuartileCount: z.number().int().min(0),
    poolDiversity: z.number().min(0),
    muRange: z.number().min(0),
    activeTactics: z.number().int().min(0),
    topVariantAge: z.number().int().min(0),
  }),
});

// ─── New parallel pipeline agents (generate_rank_evolution_parallel_20260331) ─────
// NOTE: renameKeys, rankNewVariantComparisonSchema, rankNewVariantDetailInnerSchema,
// rankingDetailRenameKeys, rankNewVariantDetailSchema are now defined ABOVE (just before
// iterativeEditingExecutionDetailSchema) so they can be consumed by both editing and GFPA
// schemas without forward-reference errors at module load.

export const generateFromPreviousExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('generate_from_previous_article'),
  variantId: z.string().nullable(),
  tactic: z.string(),
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
    /** Wall-clock duration of the generation phase. Optional — historical invocations have no timing. */
    durationMs: z.number().int().min(0).optional(),
  }),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/**
 * ReflectAndGenerateFromPreviousArticleAgent execution detail.
 * Wraps GFPA with a reflection LLM call up front. Sub-objects (`reflection`, `generation`,
 * `ranking`) are individually optional so partial-failure rows still validate (e.g.,
 * reflection succeeds but generation throws → only `reflection` is populated).
 */
export const reflectAndGenerateFromPreviousArticleExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('reflect_and_generate_from_previous_article'),
  variantId: z.string().nullable().optional(),
  /** The chosen tactic used for downstream generation. Top-level for SQL/aggregator query convenience. */
  tactic: z.string(),
  /** Reflection sub-detail. Optional so partial-failure rows (e.g. LLM throw before parsing) still validate. */
  reflection: z.object({
    /** All 24 tactic names presented to the LLM in the order they appeared in the prompt (post-shuffle). */
    candidatesPresented: z.array(z.string()),
    /** Top-N tactics ranked by the LLM with reasoning for each. */
    tacticRanking: z.array(z.object({
      tactic: z.string(),
      reasoning: z.string(),
    })),
    /** = tacticRanking[0].tactic, denormalized for SQL filters. */
    tacticChosen: z.string(),
    /** Raw LLM response preserved on parser failure for debugging (capped to 8KB upstream). */
    rawResponse: z.string().optional(),
    /** Error message when parsing fails; absent on success. */
    parseError: z.string().optional(),
    /** Wall-clock duration of the reflection LLM call. */
    durationMs: z.number().int().min(0).optional(),
    /** Cost of the reflection LLM call (incremental — does not include generation/ranking). */
    cost: z.number().min(0).optional(),
  }).optional(),
  /** Generation sub-detail. Reused from GFPA. Optional for partial-failure population. */
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
  }).optional(),
  /** Ranking sub-detail. Reused from GFPA. Optional. */
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable().optional(),
  /** Total cost = reflectionCost + gfpaDetail.totalCost. Recomputed by wrapper merge step (Phase 6). */
  totalCost: z.number().min(0).optional(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/**
 * EvaluateCriteriaThenGenerateFromPreviousArticleAgent execution detail.
 * Single combined LLM call (evaluate + suggest), then inner GFPA execute().
 * `evaluateAndSuggest` is a single sub-object (not split eval/suggest) — sourced
 * from one LLM response, shares cost + duration. droppedSuggestions captures
 * blocks the LLM wrote about non-weakest criteria (LLM-vs-wrapper disagreement
 * on tied scores, kept for forensic display).
 */
export const evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('evaluate_criteria_then_generate_from_previous_article'),
  variantId: z.string().nullable().optional(),
  /** Static marker tactic; lineage graph + tactic leaderboard groups all criteria-driven variants under this. */
  tactic: z.literal('criteria_driven'),
  /** UUIDs of criteria the wrapper auto-picked as the focus (sorted by normalized score asc). */
  weakestCriteriaIds: z.array(z.string().uuid()),
  /** Resolved names for chart labels + attribution dimension extractor. Same length + order as weakestCriteriaIds. */
  weakestCriteriaNames: z.array(z.string()),
  /** Combined evaluate + suggest sub-detail. Single LLM call source. Optional so partial-failure rows still validate. */
  evaluateAndSuggest: z.object({
    /** Per-criteria scoring from the LLM. Each entry's score validated within its criterion's [min, max] range. */
    criteriaScored: z.array(z.object({
      criteriaId: z.string().uuid(),
      criteriaName: z.string(),
      score: z.number(),
      minRating: z.number(),
      maxRating: z.number(),
    })),
    /** Suggestions kept (Criterion ∈ wrapper-determined weakest set) — fed into inner GFPA's customPrompt. */
    suggestions: z.array(z.object({
      examplePassage: z.string(),
      whatNeedsAddressing: z.string(),
      suggestedFix: z.string(),
      criteriaName: z.string(),
    })),
    /** Suggestions the LLM wrote about non-weakest criteria — dropped, kept for forensic display only. */
    droppedSuggestions: z.array(z.object({
      criteriaName: z.string(),
      reason: z.string(),
    })).optional(),
    rawResponse: z.string().optional(),
    parseError: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
    cost: z.number().min(0).optional(),
  }).optional(),
  /** Generation sub-detail. Reused from GFPA. */
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
  }).optional(),
  /** Ranking sub-detail. Reused from GFPA. */
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable().optional(),
  /** Total cost = combinedCost + gfpaDetail.totalCost. Recomputed by wrapper merge step. */
  totalCost: z.number().min(0).optional(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/** SinglePassEvaluateCriteriaAndGenerateAgent execution detail. Near-clone of the legacy
 *  evaluateCriteriaThenGenerate variant; differs in detailType + tactic marker + the new
 *  guardrails sub-object for observational guardrail telemetry. sentenceVerbatimRatio is
 *  NOT in execution_detail — it lives on `evolution_variants.sentence_verbatim_ratio` column. */
export const singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('single_pass_evaluate_criteria_and_generate'),
  variantId: z.string().nullable().optional(),
  tactic: z.literal('criteria_driven_single_pass'),
  weakestCriteriaIds: z.array(z.string().uuid()),
  weakestCriteriaNames: z.array(z.string()),
  evaluateAndSuggest: z.object({
    criteriaScored: z.array(z.object({
      criteriaId: z.string().uuid(),
      criteriaName: z.string(),
      score: z.number(),
      minRating: z.number(),
      maxRating: z.number(),
    })),
    suggestions: z.array(z.object({
      examplePassage: z.string(),
      whatNeedsAddressing: z.string(),
      suggestedFix: z.string(),
      criteriaName: z.string(),
    })),
    droppedSuggestions: z.array(z.object({
      criteriaName: z.string(),
      reason: z.string(),
    })).optional(),
    rawResponse: z.string().optional(),
    parseError: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
    cost: z.number().min(0).optional(),
  }).optional(),
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
  }).optional(),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable().optional(),
  totalCost: z.number().min(0).optional(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
  /** Guardrail telemetry — observational only (single-pass has no edit groups, so
   *  redundancyDropCount and flowDropCount are placeholders staying at 0; only
   *  lengthCapHit is meaningful as a post-hoc check on the LLM's output length). */
  guardrails: z.object({
    redundancyDropCount: z.number().int().min(0),
    flowDropCount: z.number().int().min(0),
    lengthCapHit: z.boolean(),
  }).optional(),
});

/** ProposerApproverCriteriaGenerateAgent execution detail. Single-cycle propose/forward-approve/
 *  mirror-approve/apply protocol. cycles[] is enforced length-1 (single-cycle by definition).
 *  sentenceVerbatimRatio lives on `evolution_variants.sentence_verbatim_ratio` column, not here. */
export const proposerApproverCriteriaGenerateExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('proposer_approver_criteria_generate'),
  variantId: z.string().nullable().optional(),
  tactic: z.literal('criteria_driven_propose_approve'),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
  weakestCriteriaIds: z.array(z.string().uuid()),
  weakestCriteriaNames: z.array(z.string()),
  evaluateAndSuggest: z.object({
    criteriaScored: z.array(z.object({
      criteriaId: z.string().uuid(),
      criteriaName: z.string(),
      score: z.number(),
      minRating: z.number(),
      maxRating: z.number(),
    })),
    suggestions: z.array(z.object({
      examplePassage: z.string(),
      whatNeedsAddressing: z.string(),
      suggestedFix: z.string(),
      criteriaName: z.string(),
    })),
    droppedSuggestions: z.array(z.object({
      criteriaName: z.string(),
      reason: z.string(),
    })).optional(),
    rawResponse: z.string().optional(),
    parseError: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
    cost: z.number().min(0).optional(),
  }).optional(),
  /** Single propose/approve cycle. Length-1 array to mirror IterativeEditingAgent's `cycles[]` shape
   *  (Open Question 5 resolution). Zod refine below enforces single-cycle. */
  cycles: z.array(z.object({
    proposedGroupsRaw: z.number().int().min(0),
    droppedPreApprover: z.array(z.object({
      groupNumber: z.number().int().min(1),
      reason: z.string(),
    })),
    approverGroups: z.number().int().min(0),
    forwardDecisions: z.array(z.object({
      groupNumber: z.number().int().min(1),
      decision: z.enum(['accept', 'reject']),
      reason: z.string(),
      redundancy_violation: z.boolean().optional(),
      flow_violation: z.boolean().optional(),
      length_violation: z.boolean().optional(),
    })),
    /** Mirror decisions per group. `null` decision encodes either short-circuit
     *  (forward already rejected — no mirror call made) or mirror parse failure
     *  (LLM returned malformed JSONL). Aggregator strict-binary rule treats both as DROP. */
    mirrorDecisions: z.array(z.object({
      groupNumber: z.number().int().min(1),
      decision: z.enum(['accept', 'reject']).nullable(),
      reason: z.string(),
      redundancy_violation: z.boolean().optional(),
      flow_violation: z.boolean().optional(),
      length_violation: z.boolean().optional(),
    })),
    appliedGroups: z.number().int().min(0),
    droppedPostApprover: z.array(z.object({
      groupNumber: z.number().int().min(1),
      reason: z.string(),
    })),
    proposeCostUsd: z.number().min(0),
    approveForwardCostUsd: z.number().min(0),
    approveMirrorCostUsd: z.number().min(0),
    /** Optional post-apply article text. Feature-flag in prod (large payloads). */
    childText: z.string().optional(),
    /** Diagnostic block populated only on `mirrorAbortReason: 'a_prime_format_invalid'`.
     *  Captures which format issues are net-new vs already in parent so we can debug
     *  without one-off scripts. Bounded snippet to keep execution_detail small. */
    formatGateDiagnostic: z.object({
      newIssues: z.array(z.string()),
      parentIssues: z.array(z.string()),
      aPrimeArticleSnippet: z.string(),
    }).optional(),
  })).max(1),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable().optional(),
  totalCost: z.number().min(0).optional(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  /** Mirror agreement rate = appliedGroups / approverGroups. Computed at finalization. */
  mirrorAgreementRate: z.number().min(0).max(1).optional(),
  /** Set when mirror pass was aborted at the whole-pass level (distinct from per-group nulls). */
  mirrorAbortReason: z.enum(['a_prime_format_invalid', 'mirror_parse_null']).optional(),
});

/** CreateSeedArticleAgent execution detail. */
export const createSeedArticleExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('create_seed_article'),
  generation: z.object({
    cost: z.number().min(0),
    promptLength: z.number().int().min(0),
    titleLength: z.number().int().min(0).optional(),
    contentLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    error: z.string().optional(),
  }),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    rankNewVariantDetailInnerSchema.extend({
      cost: z.number().min(0),
    }),
  ).nullable(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/** SwissRankingAgent execution detail. */
export const swissRankingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('swiss_ranking'),
  eligibleIds: z.array(z.string()),
  eligibleCount: z.number().int().min(0),
  pairsConsidered: z.number().int().min(0),
  pairsDispatched: z.number().int().min(0),
  pairsSucceeded: z.number().int().min(0),
  pairsFailedBudget: z.number().int().min(0),
  pairsFailedOther: z.number().int().min(0),
  matchesProduced: z.array(z.object({
    winnerId: z.string(),
    loserId: z.string(),
    result: z.enum(['win', 'draw']),
    confidence: z.number().min(0).max(1),
  })),
  matchesProducedTotal: z.number().int().min(0),
  matchesTruncated: z.boolean(),
  // B008-S3: extended enum with 'failure' so SwissRankingAgent can report a non-success
  // when all pairs fail with non-budget errors. Was previously forced to set 'success'
  // even with 0 successful pairs, masking provider outages as success in dashboards.
  status: z.enum(['success', 'budget', 'no_pairs', 'failure']),
});

/** MergeRatingsAgent execution detail.
 *  Backward compat: accepts legacy `mu`/`sigma`/`muDelta`/`sigmaDelta` field names
 *  inside before.variants / after.variants and normalizes to `elo`/`uncertainty`/etc. */
const beforeVariantRenameKeys = renameKeys({ mu: 'elo', sigma: 'uncertainty' });
const afterVariantRenameKeys = renameKeys({
  mu: 'elo',
  sigma: 'uncertainty',
  muDelta: 'eloDelta',
  sigmaDelta: 'uncertaintyDelta',
});

export const mergeRatingsExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('merge_ratings'),
  iterationType: z.enum(['generate', 'reflect_and_generate', 'criteria_and_generate', 'single_pass_evaluate_criteria_and_generate', 'proposer_approver_criteria_generate', 'debate_and_generate', 'iterative_editing', 'iterative_editing_rewrite', 'paragraph_recombine', 'paragraph_recombine_with_coherence_pass', 'swiss']),
  before: z.object({
    poolSize: z.number().int().min(0),
    variants: z.array(z.preprocess(
      beforeVariantRenameKeys,
      z.object({
        id: z.string(),
        elo: z.number(),
        uncertainty: z.number().min(0),
        matchCount: z.number().int().min(0),
      }),
    )),
    top15Cutoff: z.number(),
  }),
  input: z.object({
    matchBufferCount: z.number().int().min(0),
    totalMatchesIn: z.number().int().min(0),
    matchesPerBuffer: z.array(z.number().int().min(0)),
    newVariantsAdded: z.number().int().min(0),
  }),
  matchesApplied: z.array(z.object({
    indexInShuffledOrder: z.number().int().min(0),
    winnerId: z.string(),
    loserId: z.string(),
    result: z.enum(['win', 'draw']),
    confidence: z.number().min(0).max(1),
  })),
  matchesAppliedTotal: z.number().int().min(0),
  matchesAppliedTruncated: z.boolean(),
  after: z.object({
    poolSize: z.number().int().min(0),
    variants: z.array(z.preprocess(
      afterVariantRenameKeys,
      z.object({
        id: z.string(),
        elo: z.number(),
        uncertainty: z.number().min(0),
        matchCount: z.number().int().min(0),
        eloDelta: z.number(),
        uncertaintyDelta: z.number(),
      }),
    )),
    top15Cutoff: z.number(),
    top15CutoffDelta: z.number(),
  }),
  variantsAddedToPool: z.array(z.string()),
  durationMs: z.number().min(0),
});

/** IterationSnapshot — captured at the start and end of every orchestrator iteration.
 *  Backward compat: accepts legacy `{mu, sigma}` ratings and `{mu, top15Cutoff}` discardReasons. */
const snapshotRatingRename = renameKeys({ mu: 'elo', sigma: 'uncertainty' });
const snapshotDiscardReasonRename = renameKeys({ mu: 'elo' });

// Note: iterationType accepts 'reflect_and_generate' (Shape A) — pre-existing snapshots
// only contain 'generate' or 'swiss' so backward-compat reads remain valid.
export const iterationSnapshotSchema = z.object({
  iteration: z.number().int().min(1),
  iterationType: z.enum(['generate', 'reflect_and_generate', 'criteria_and_generate', 'single_pass_evaluate_criteria_and_generate', 'proposer_approver_criteria_generate', 'debate_and_generate', 'iterative_editing', 'iterative_editing_rewrite', 'paragraph_recombine', 'paragraph_recombine_with_coherence_pass', 'swiss']),
  phase: z.enum(['start', 'end']),
  capturedAt: z.string(),
  poolVariantIds: z.array(z.string()),
  ratings: z.record(z.string(), z.preprocess(
    snapshotRatingRename,
    z.object({ elo: z.number(), uncertainty: z.number().min(0) }),
  )),
  matchCounts: z.record(z.string(), z.number().int().min(0)),
  discardedVariantIds: z.array(z.string()).optional(),
  discardReasons: z.record(z.string(), z.preprocess(
    snapshotDiscardReasonRename,
    z.object({
      elo: z.number(),
      top15Cutoff: z.number(),
    }),
  )).optional(),
  /** Per-iteration stop reason (only present on 'end' snapshots). */
  stopReason: z.string().optional(),
  /** Budget allocated for this iteration in USD. */
  budgetAllocated: z.number().min(0).optional(),
  /** Budget actually spent during this iteration in USD. */
  budgetSpent: z.number().min(0).optional(),
});

export type IterationSnapshot = z.infer<typeof iterationSnapshotSchema>;

// ─── Sequential Coordinator (debug_performance_paragraph_recombine_20260612) ─
//
// The coordinator's output drives Phase B's sequential per-paragraph loop. One
// per-paragraph plan with M variation directives + temperatures + skip flag.
// No structured analogy/acronym/voice fields — coordinator embeds article-level
// intent in directive TEXT.

const coordinatorCandidateSchema = z.object({
  /** Bespoke instruction for this variation (embeds analogy/acronym/voice guidance inline). */
  directive: z.string(),
  /** 0.7 conservative ... 1.2 generative. The coordinator picks per directive. */
  temperature: z.number().min(0).max(2),
});

const coordinatorParagraphPlanSchema = z.object({
  paragraphIndex: z.number().int().min(0),
  role: z.enum(['lede', 'body', 'closer', 'sub_opener', 'technical_dense', 'header']),
  /** When false, parent paragraph flows onto priorPicks unchanged; no generation calls fire. */
  shouldRewrite: z.boolean(),
  priority: z.enum(['high', 'medium', 'low']),
  M: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  candidates: z.array(coordinatorCandidateSchema),
  rationale: z.string(),
});

export const coordinatorPlanSchema = z.object({
  paragraphPlans: z.array(coordinatorParagraphPlanSchema),
});

export type CoordinatorPlan = z.infer<typeof coordinatorPlanSchema>;
export type CoordinatorParagraphPlan = z.infer<typeof coordinatorParagraphPlanSchema>;

// ─── slotRecombineExecutionDetailSchema ──────────────────────────
//
// Per D11/D14/D20 of rank_individual_paragraphs_evolution_20260525.
// Discriminated-union shape: v1 ships one variant `detailType:'paragraph_recombine'`.
// Future granularities (`'sentence_recombine'`, `'section_recombine'`) extend
// this union without renaming the file. Field names use `slot*` so the schema
// generalizes naturally across granularities.

export const slotRecombineExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('paragraph_recombine'),
  parentVariantId: z.string().uuid(),
  /** N slots — one per paragraph in the parent article. */
  slots: z.array(z.object({
    slotIndex: z.number().int().min(0),
    originalText: z.string(),
    /** UUID of the slot's original-paragraph variant (in `evolution_variants`). Created
     *  by `upsertSlotTopic` so this always exists, even when the rewrite/ranking phase
     *  is skipped (e.g. self-aborted). */
    originalSlotVariantId: z.string().uuid(),
    /** UUID of this slot's arena topic in `evolution_prompts`. Deterministic per
     *  (parentVariantId, slotIndex) per D10. */
    slotTopicId: z.string().uuid(),
    /** Per-slot budget allocated (USD). perInvocationCap / paragraphCount per D16. */
    perSlotBudgetUsd: z.number().min(0),
    /** Per-slot LLM spend (USD) from slotScope.getOwnSpent() at end of slot. */
    spentUsd: z.number().min(0),
    /** M rewrite attempts. Includes pre-rank-dropped ones (with dropReason). */
    rewrites: z.array(z.object({
      index: z.number().int().min(0),
      text: z.string(),
      /** UUID of this rewrite's `evolution_variants` row. Undefined for rewrites
       *  dropped pre-rank (those are never inserted). */
      slotVariantId: z.string().uuid().optional(),
      costUsd: z.number().min(0),
      durationMs: z.number().int().min(0).optional(),
      sentenceVerbatimRatio: z.number().min(0).max(1).optional(),
      formatValid: z.boolean(),
      dropReason: z.enum([
        'no_bullets', 'no_lists', 'no_tables', 'no_h1',
        'length_under', 'length_over', 'zero_sentences',
      ]).optional(),
      /** G1 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
       *  Temperature used for this rewrite (from the ladder index). Undefined when
       *  the model rejects temperature options. Pre-G1 rows lack this field. */
      temperature: z.number().min(0).max(2).optional(),
      /** G1: lifecycle status of this rewrite. `succeeded` = LLM call returned and
       *  passed `validateParagraphRewrite`; `dropped` = LLM call returned but failed
       *  the validator (see `dropReason`); `skipped_slot_abort` = the slot's
       *  self-abort fired before this rewrite's call; `llm_error` = the LLM call
       *  threw (reservation was released, so `costUsd` is 0). Pre-G1 rows lack this. */
      status: z.enum(['succeeded', 'dropped', 'skipped_slot_abort', 'llm_error']).optional(),
    })),
    /** Per-slot ranking results. Undefined when slot was self-aborted before ranking. */
    ranking: z.object({
      matchCount: z.number().int().min(0),
      /** G2 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
       *  paragraph_rank phase cost delta over THIS slot's ranking loop only. Pre-G2
       *  ranking spend was only visible at the invocation level (paragraph_recombine_cost
       *  rollup) which mixed rewrite + rank. Optional for back-compat with older rows. */
      cost: z.number().min(0).optional(),
      /** G2: comparison count for THIS slot's ranking loop. Same as matchCount in
       *  practice; declared separately so future agents can disambiguate (e.g. if
       *  comparisons-per-match becomes >1 via bias mitigation). Optional. */
      comparisonCount: z.number().int().min(0).optional(),
      /** G2: lifecycle status of the ranking loop. `completed` = all candidates ranked;
       *  `self_aborted` = slot self-abort fired mid-loop; `skipped_insufficient_pool` =
       *  zero or one surviving rewrite, so no comparisons happened. Optional. */
      status: z.enum(['completed', 'self_aborted', 'skipped_insufficient_pool']).optional(),
      ratings: z.array(z.object({
        variantId: z.string().uuid(),
        elo: z.number(),
        uncertainty: z.number().min(0),
      })),
      /** UUID of the winning candidate (rewrite slotVariantId OR originalSlotVariantId). */
      winnerSlotVariantId: z.string().uuid(),
      /** Whether the winner is the original (true) or a rewrite (false). */
      winnerIsOriginal: z.boolean(),
      /** Source of the winning candidate. 'this_invocation' if this invocation
       *  produced the winning rewrite; 'prior_invocation' if a previously-persisted
       *  rewrite (loaded via loadArenaEntries) won; 'original' if the original kept. */
      winnerSource: z.enum(['this_invocation', 'prior_invocation', 'original']),
    }).optional(),
    /** Set when the slot was discarded mid-execution. */
    discardReason: z.object({
      failurePoint: z.enum(['slot_budget', 'sync_failed', 'no_valid_rewrites']),
      message: z.string().optional(),
    }).optional(),
  })),
  /** Final recombined article + format-validation result. */
  recombined: z.object({
    text: z.string(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
  }),
  /** Post-emit ranking results (against the article-level run pool). */
  postEmitRanking: z.object({
    matchCount: z.number().int().min(0),
    elo: z.number(),
    uncertainty: z.number().min(0),
    costUsd: z.number().min(0),
  }).optional(),
  /** G4 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): projector
   *  output captured at dispatch time + per-phase breakdown. Persisted so that
   *  paragraph_recombine joins the existing `cost_estimation_error_pct` / `estimated_cost`
   *  run-level metric family AUTOMATICALLY (the finalization compute functions iterate
   *  all invocation details agnostic to agent_name and look for `estimationErrorPct`
   *  + `estimatedTotalCost` at the top level).
   *
   *  - `estimatedTotalCost`: projector's `expected` (per-invocation, USD).
   *  - `estimatedTotalCostUpperBound`: projector's `upperBound` (1.3× expected).
   *  - `estimationErrorPct`: `(actualCost - estimatedCost) / estimatedCost × 100`.
   *  - `paragraph_rewrite.{estimatedCost,cost,estimationErrorPct}`: per-phase split.
   *  - `paragraph_rank.{estimatedCost,cost,estimationErrorPct}`: per-phase split.
   *
   *  All `.optional()` for back-compat with existing rows. */
  estimatedTotalCost: z.number().min(0).optional(),
  estimatedTotalCostUpperBound: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  paragraph_rewrite: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
  }).optional(),
  paragraph_rank: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
  }).optional(),
  // ─── Sequential Coordinator (debug_performance_paragraph_recombine_20260612) ─
  /** Per-phase coordinator rollup mirroring paragraph_rewrite + paragraph_rank shape.
   *  Populated on the sequential path; absent on the legacy parallel path.
   *  rawResponse + parseError are populated only on coordinator throw paths
   *  (truncated to 4K chars for storage efficiency). */
  coordinator: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
    retried: z.boolean().optional(),
    rawResponse: z.string().optional(),
    parseError: z.string().optional(),
  }).optional(),
  /** The full coordinator plan returned by Phase A — persisted for admin UI rendering
   *  + post-hoc analysis. Absent when sequential is disabled (legacy path). Absent
   *  also when the coordinator threw before producing a valid plan. */
  coordinatorPlan: coordinatorPlanSchema.optional(),
  /** Phase B mid-loop throw markers (B.7 partial-detail-on-throw invariant). When set,
   *  `slots` is truncated to length === completedSlotCount (NOT N-with-nulls). */
  partialAt: z.number().int().min(0).optional(),
  abortReason: z.string().optional(),
  completedSlotCount: z.number().int().min(0).optional(),
  /** Sequential Context-Aware Generation per-invocation counters (debug_performance_paragraph_recombine_20260612).
   *  Sourced from runSequentialLoop's SequentialCounters; missing on the legacy parallel path.
   *  Used by metric extractors to compute parent_fallback_rate, prior_picks_sanitization_count,
   *  prior_picks_truncation_count. */
  sequentialCounters: z.object({
    parentFallbackCount: z.number().int().min(0),
    skippedSlotCount: z.number().int().min(0),
    rewrittenSlotCount: z.number().int().min(0),
    priorPicksSanitizationCount: z.number().int().min(0),
    priorPicksTruncationCount: z.number().int().min(0),
    // investigate_sequential_paragraph_recombine_performance_20260615 Phase 1c-i:
    // Forward-context counters mirror the priorPicks* counters. Default 0 so
    // historical execution_detail rows (which predate Phase 1c-i) remain valid.
    nextPicksSanitizationCount: z.number().int().min(0).default(0),
    nextPicksTruncationCount: z.number().int().min(0).default(0),
    // investigate_sequential_paragraph_recombine_performance_20260615 Phase 2 (Fix 2):
    // Replan counters. 0 or 1 per invocation today; the .max(1) cap may grow to N
    // in a future "replan every K slots" iteration.
    replanCount: z.number().int().min(0).max(1).default(0),
    replanFailureCount: z.number().int().min(0).max(1).default(0),
    replanSkippedCount: z.number().int().min(0).max(1).default(0),
    replanSkippedReason: z.enum([
      'single_slot', 'budget_exhausted',
      'slot0_all_failed', 'slot0_parent_won', 'budget_floor',
    ]).optional(),
  }).optional(),
  /** Phase 2 (Fix 2): post-replan merged coordinator plan. Present only when the
   *  replan ran AND succeeded. The original (pre-replan) plan stays in
   *  `coordinatorPlan` for forensics. */
  coordinatorPlanReplanned: coordinatorPlanSchema.optional(),
});

export type SlotRecombineExecutionDetail = z.infer<typeof slotRecombineExecutionDetailSchema>;

// ─── paragraphRecombineWithCoherencePassExecutionDetailSchema ────────────
//
// paragraph_recombine_agent_with_coherence_pass_evolution_20260620.
// Mirrors slotRecombineExecutionDetailSchema's slot-side fields (same per-slot
// arena, same recombine output) and adds:
//  - `coherencePass`: optional cycle data from the Phase D propose/review/apply step.
//    cycles[] reuses iterativeEditingExecutionDetailSchema's cycle shape so the
//    existing parseIterativeEditingTree subagent parser can walk it directly.
//    `skipped` is set when the coherence pass didn't run (env kill switch,
//    coherencePassEnabled=false, or pre-pass budget gate).
//  - `recombinedBeforeCoherencePass`: forensic snapshot of the assembled article
//    BEFORE the coherence pass smoothing edits. Truncated to 8KB to mirror Mode B's
//    truncation of `rewriteText`. The final post-pass text stays in `recombined.text`.
export const paragraphRecombineWithCoherencePassExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('paragraph_recombine_with_coherence_pass'),
  parentVariantId: z.string().uuid(),
  /** Same slot shape as slotRecombineExecutionDetailSchema. The new agent's per-slot
   *  pipeline reuses the same primitives (extractParagraphsWithRanges, upsertSlotTopic,
   *  loadArenaEntries, rankNewVariant with comparisonMode='paragraph', persistSlotMatches). */
  slots: z.array(z.object({
    slotIndex: z.number().int().min(0),
    originalText: z.string(),
    originalSlotVariantId: z.string().uuid(),
    slotTopicId: z.string().uuid(),
    perSlotBudgetUsd: z.number().min(0),
    spentUsd: z.number().min(0),
    rewrites: z.array(z.object({
      index: z.number().int().min(0),
      text: z.string(),
      slotVariantId: z.string().uuid().optional(),
      costUsd: z.number().min(0),
      durationMs: z.number().int().min(0).optional(),
      sentenceVerbatimRatio: z.number().min(0).max(1).optional(),
      /** Q8 observational metric — slot-level provenance (fraction of CHILD sentences
       *  appearing in PARENT, asymmetric to sentenceVerbatimRatio which is parent→child).
       *  NOISY for REORDER + RESTRUCTURE directives; reliable for TIGHTEN. */
      provenanceRatio: z.number().min(0).max(1).optional(),
      formatValid: z.boolean(),
      dropReason: z.enum([
        'no_bullets', 'no_lists', 'no_tables', 'no_h1',
        'length_under', 'length_over', 'zero_sentences',
      ]).optional(),
      temperature: z.number().min(0).max(2).optional(),
      status: z.enum(['succeeded', 'dropped', 'skipped_slot_abort', 'llm_error']).optional(),
      /** REORDER (idx 0) / TIGHTEN (idx 1) / RESTRUCTURE (idx 2) directive name. */
      directive: z.enum(['REORDER', 'TIGHTEN', 'RESTRUCTURE']).optional(),
    })),
    ranking: z.object({
      matchCount: z.number().int().min(0),
      cost: z.number().min(0).optional(),
      comparisonCount: z.number().int().min(0).optional(),
      status: z.enum(['completed', 'self_aborted', 'skipped_insufficient_pool']).optional(),
      ratings: z.array(z.object({
        variantId: z.string().uuid(),
        elo: z.number(),
        uncertainty: z.number().min(0),
      })),
      winnerSlotVariantId: z.string().uuid(),
      winnerIsOriginal: z.boolean(),
      winnerSource: z.enum(['this_invocation', 'prior_invocation', 'original']),
    }).optional(),
    discardReason: z.object({
      failurePoint: z.enum(['slot_budget', 'sync_failed', 'no_valid_rewrites']),
      message: z.string().optional(),
    }).optional(),
  })),
  /** Q6: forensic snapshot of the assembled article BEFORE coherence pass smoothing.
   *  Truncated to 8KB. Final post-pass text lives in `recombined.text`. */
  recombinedBeforeCoherencePass: z.string().optional(),
  recombined: z.object({
    text: z.string(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
  }),
  /** Q5: coherence-pass cycle data. cycles[0] uses editingCycleSchema shape so
   *  parseIterativeEditingTree can walk it (Phase 6 subagent tree). */
  coherencePass: z.union([
    z.object({
      cycles: z.array(editingCycleSchema),
      /** Coherence-pass-specific config snapshot for the invocation detail UI.
       *  Per investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 2a:
       *  redundancyJaccardThreshold + flowGuardrailEnabled removed (the agent no longer
       *  applies those guardrails). Legacy detail rows with those keys still parse
       *  cleanly because zod's default object behavior ignores unknown keys. */
      config: z.object({
        proposerModel: z.string(),
        approverModel: z.string(),
        lengthCapRatio: z.number(),
        /** Per rebuild_coherence_pass_agent_mode_ab_configurable_20260624.
         *  Resolved editing mode for the coherence pass (Mode A = CriticMarkup-in;
         *  Mode B = rewrite-then-diff). */
        editingMode: z.enum(['mode_a', 'mode_b']),
        /** Per rebuild_coherence_pass_agent_mode_ab_configurable_20260624 — opportunistic
         *  add closing a #1282 observability gap. Resolved per-cycle loop cap. */
        maxCycles: z.number().int().min(1).max(5),
      }),
      /** Silent-rejection observability: approver returned > 0 groups but apply count == 0. */
      silentRejection: z.boolean().optional(),
    }),
    z.object({
      skipped: z.enum(['budget', 'disabled', 'format_invalid_recombine']),
      spentAtSkip: z.number().min(0).optional(),
      capUsd: z.number().min(0).optional(),
    }),
  ]).optional(),
  /** Projector outputs for the new agent (matches slotRecombine shape; coherence-pass
   *  cost is rolled in via the umbrella). All optional for back-compat. */
  estimatedTotalCost: z.number().min(0).optional(),
  estimatedTotalCostUpperBound: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  paragraph_rewrite: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
  }).optional(),
  paragraph_rank: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
  }).optional(),
  coherence_pass: z.object({
    estimatedCost: z.number().min(0),
    cost: z.number().min(0),
    estimationErrorPct: z.number().optional(),
  }).optional(),
});

export type ParagraphRecombineWithCoherencePassExecutionDetail =
  z.infer<typeof paragraphRecombineWithCoherencePassExecutionDetailSchema>;

export const agentExecutionDetailSchema = z.discriminatedUnion('detailType', [
  generationExecutionDetailSchema,
  iterativeEditingExecutionDetailSchema,
  reflectionExecutionDetailSchema,
  debateExecutionDetailSchema,
  sectionDecompositionExecutionDetailSchema,
  evolutionExecutionDetailSchema,
  treeSearchExecutionDetailSchema,
  outlineGenerationExecutionDetailSchema,
  rankingExecutionDetailSchema,
  proximityExecutionDetailSchema,
  metaReviewExecutionDetailSchema,
  generateFromPreviousExecutionDetailSchema,
  reflectAndGenerateFromPreviousArticleExecutionDetailSchema,
  evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema,
  singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema,
  proposerApproverCriteriaGenerateExecutionDetailSchema,
  createSeedArticleExecutionDetailSchema,
  swissRankingExecutionDetailSchema,
  mergeRatingsExecutionDetailSchema,
  slotRecombineExecutionDetailSchema,
  paragraphRecombineWithCoherencePassExecutionDetailSchema,
]);

export type AgentExecutionDetailSchema = z.infer<typeof agentExecutionDetailSchema>;

// ═══════════════════════════════════════════════════════════════════
// Run Summary Schemas (moved from types.ts)
// ═══════════════════════════════════════════════════════════════════

/** V3: run summary. New runs write Elo-scale fields directly.
 *  Backward compat: legacy V3 runs wrote these as `muHistory`/`baselineMu`/`avgMu`/`mu`; the
 *  preprocess step renames those to `eloHistory`/`baselineElo`/`avgElo`/`elo`. Values in
 *  legacy payloads are already Elo-scale (per persistRunResults refactor); truly old mu-scale
 *  values (<100) are handled by display-layer heuristics in MetricsTab/visualizationActions. */
const topVariantRename = renameKeys({ mu: 'elo', isBaseline: 'isSeedVariant', strategy: 'tactic' });
const tacticEffectivenessEntryRename = renameKeys({ avgMu: 'avgElo' });
// 2026-04-14: rename baseline → seed variant. 2026-04-17: rename strategy → tactic.
// Legacy V3 rows still use baselineRank/baselineElo/strategyEffectiveness;
// preprocess maps them so .strict() schema accepts both shapes. New writes emit new names only.
// renameKeys is single-pass, so map every legacy alias directly to the current key name.
const runSummaryV3Rename = renameKeys({
  muHistory: 'eloHistory',
  baselineMu: 'seedVariantElo',
  baselineElo: 'seedVariantElo',
  baselineRank: 'seedVariantRank',
  strategyEffectiveness: 'tacticEffectiveness',
  // Note: strategyMus is NOT a V3 run summary field (it lives in metaReview execution detail).
  // Do NOT include it here — the .strict() schema would reject the renamed tacticMus key.
});

const _EvolutionRunSummaryV3Inner = z.object({
  version: z.literal(3),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.union([
    z.array(z.array(z.number())),  // New format: number[][] (top-K per iteration)
    z.array(z.number()).transform(arr => arr.map(v => [v]))  // Legacy: number[] → wrap each as [v]
  ]).pipe(z.array(z.array(z.number())).max(100)),
  /** Phase 4b: parallel array — uncertainty per top-K entry per iteration. Optional;
   *  legacy rows omit it. EloTab renders an uncertainty band when present. */
  uncertaintyHistory: z.array(z.array(z.number().min(0))).max(100).optional(),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.preprocess(
    topVariantRename,
    z.object({
      id: z.string().max(200),
      tactic: z.string().max(100),
      elo: z.number(),
      // Per-variant rating uncertainty (Elo-scale). Optional for legacy rows that
      // predate Phase 4b; consumers suppress the ± rendering when absent.
      uncertainty: z.number().min(0).optional(),
      isSeedVariant: z.boolean(),
    }),
  )).max(10),
  seedVariantRank: z.number().int().min(1).nullable(),
  seedVariantElo: z.number().nullable(),
  tacticEffectiveness: z.record(z.string(), z.preprocess(
    tacticEffectivenessEntryRename,
    z.object({
      count: z.number().int().min(0),
      avgElo: z.number(),
      // Standard error of the mean Elo across variants in this tactic bucket.
      // NOT per-variant rating uncertainty — it's the spread of variant Elos within
      // this run's tactic group. Computed via Welford M2 in buildRunSummary.
      // Only populated when count >= 2; optional for legacy rows.
      seAvgElo: z.number().min(0).optional(),
    }),
  )),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
  actionCounts: z.record(z.string(), z.number().int().min(0)).optional(),
  // Static floor config captured at run start so the Cost Estimates tab can render
  // the projected-vs-actual Budget Floor Sensitivity module post-hoc. Optional for
  // backward compatibility — runs finalized before this field existed omit it.
  // Observable numerics (initial_agent_cost_estimate, actual_avg_cost_per_agent,
  // parallel_dispatched, sequential_dispatched, duration medians/means) are written
  // as first-class evolution_metrics rows, not here.
  budgetFloorConfig: z.object({
    minBudgetAfterParallelFraction: z.number().min(0).max(1).optional(),
    minBudgetAfterParallelAgentMultiple: z.number().min(0).optional(),
    minBudgetAfterSequentialFraction: z.number().min(0).max(1).optional(),
    minBudgetAfterSequentialAgentMultiple: z.number().min(0).optional(),
    /** @deprecated Replaced by DISPATCH_SAFETY_CAP constant in code. Legacy rows persisted this value; reading still tolerates it. */
    numVariants: z.number().int().min(0).optional(),
  }).optional(),
}).strict();

export const EvolutionRunSummaryV3Schema = z.preprocess(runSummaryV3Rename, _EvolutionRunSummaryV3Inner);

/** TrueSkill default sigma used for V1/V2 → V3 migration: ordinal + 3*sigma ≈ mu */
const V2_DEFAULT_SIGMA = _INTERNAL_DEFAULT_SIGMA;

interface EvolutionRunSummaryV3 {
  version: 3;
  stopReason: string;
  finalPhase: 'EXPANSION' | 'COMPETITION';
  totalIterations: number;
  durationSeconds: number;
  eloHistory: number[][];
  /** Phase 4b: optional parallel array of per-top-K uncertainty values matching eloHistory. */
  uncertaintyHistory?: number[][];
  diversityHistory: number[];
  matchStats: { totalMatches: number; avgConfidence: number; decisiveRate: number };
  topVariants: Array<{ id: string; tactic: string; elo: number; uncertainty?: number; isSeedVariant: boolean }>;
  seedVariantRank: number | null;
  seedVariantElo: number | null;
  tacticEffectiveness: Record<string, { count: number; avgElo: number; seAvgElo?: number }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
  actionCounts?: Record<string, number>;
  budgetFloorConfig?: {
    minBudgetAfterParallelFraction?: number;
    minBudgetAfterParallelAgentMultiple?: number;
    minBudgetAfterSequentialFraction?: number;
    minBudgetAfterSequentialAgentMultiple?: number;
    numVariants: number;
  };
}

/** Shared transform helper: convert a legacy ordinal/elo value to a mu estimate. */
function legacyToMu(ordinal: number): number {
  return ordinal + 3 * V2_DEFAULT_SIGMA;
}

/** Legacy V2 schema with ordinal field names. Auto-transforms to V3 on parse. */
const EvolutionRunSummaryV2Schema = z.object({
  version: z.literal(2),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  ordinalHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    ordinal: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineOrdinal: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgOrdinal: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).transform((v2): EvolutionRunSummaryV3 => ({
  version: 3,
  stopReason: v2.stopReason,
  finalPhase: v2.finalPhase,
  totalIterations: v2.totalIterations,
  durationSeconds: v2.durationSeconds,
  eloHistory: v2.ordinalHistory.map((ord) => [legacyToMu(ord)]),
  diversityHistory: v2.diversityHistory,
  matchStats: v2.matchStats,
  topVariants: v2.topVariants.map((tv) => ({ id: tv.id, tactic: tv.strategy, elo: legacyToMu(tv.ordinal), isSeedVariant: tv.isBaseline })),
  seedVariantRank: v2.baselineRank,
  seedVariantElo: v2.baselineOrdinal != null ? legacyToMu(v2.baselineOrdinal) : null,
  tacticEffectiveness: Object.fromEntries(
    Object.entries(v2.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgElo: legacyToMu(v.avgOrdinal) }]),
  ),
  metaFeedback: v2.metaFeedback,
}));

/** Legacy V1 schema with Elo field names. Auto-transforms to V3 on parse (V1→V3 direct). */
const EvolutionRunSummaryV1Schema = z.object({
  version: z.literal(1).optional(),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    elo: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineElo: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgElo: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).transform((v1): EvolutionRunSummaryV3 => ({
  version: 3,
  stopReason: v1.stopReason,
  finalPhase: v1.finalPhase,
  totalIterations: v1.totalIterations,
  durationSeconds: v1.durationSeconds,
  eloHistory: v1.eloHistory.map((ord) => [legacyToMu(ord)]),
  diversityHistory: v1.diversityHistory,
  matchStats: v1.matchStats,
  topVariants: v1.topVariants.map((tv) => ({ id: tv.id, tactic: tv.strategy, elo: legacyToMu(tv.elo), isSeedVariant: tv.isBaseline })),
  seedVariantRank: v1.baselineRank,
  seedVariantElo: v1.baselineElo != null ? legacyToMu(v1.baselineElo) : null,
  tacticEffectiveness: Object.fromEntries(
    Object.entries(v1.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgElo: legacyToMu(v.avgElo) }]),
  ),
  metaFeedback: v1.metaFeedback,
}));

export const EvolutionRunSummarySchema = z.union([
  EvolutionRunSummaryV3Schema,
  EvolutionRunSummaryV2Schema,
  EvolutionRunSummaryV1Schema,
]);

// ─── Weight Inference (calculate_implifed_rubric_weights_evolution_20260619) ──
// Infer judge-rubric weights from pairwise verdicts. mode=human|auto; source=human|llm.

export const wiVerdict3Enum = z.enum(['a', 'b', 'tie']);
export const wiSessionStatusEnum = z.enum(['active', 'archived']);
export const wiSessionModeEnum = z.enum(['human', 'auto']);
export const wiSourceEnum = z.enum(['human', 'llm']);
export const wiSourceKindEnum = z.enum(['topic', 'test_set']);
export const wiPairKindEnum = z.enum(['article', 'paragraph']);

/** Reserved markers an operator-supplied holistic-prompt override may not contain. Case-sensitive
 *  literal substrings. `## Text A`/`## Text B` would let an injected payload pre-position fake
 *  body text ahead of the real Text A/B sections (parseWinner would mis-route on a "TEXT A"
 *  phrase match — computeRatings.ts:610-612). `Your answer:` is the rejudge-sandbox's reasoning
 *  marker — including it would conflict with the strict-tail contract auto-mode emits. `<|`/`|>`
 *  are common jailbreak delimiters. Operators rarely intend these in a rubric block, and the
 *  override flows directly into an LLM prompt so the deny-list is fail-loud at insert time. */
export const WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS = ['## Text A', '## Text B', 'Your answer:', '<|', '|>'] as const;

const holisticPromptOverrideSchema = z
  .string()
  .max(8000, 'holistic_prompt_override must be ≤ 8000 characters (the DB CHECK constraint).')
  .refine(
    (s) => !WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS.some((m) => s.includes(m)),
    {
      message: `holistic_prompt_override may not contain reserved markers (${WI_HOLISTIC_OVERRIDE_RESERVED_MARKERS.join(', ')}).`,
    },
  );

export const evolutionWiSessionInsertSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  status: wiSessionStatusEnum.optional().default('active'),
  mode: wiSessionModeEnum.optional().default('human'),
  source_kind: wiSourceKindEnum.optional().default('topic'),
  prompt_id: z.string().uuid().nullable().optional(),
  judge_eval_test_set_id: z.string().uuid().nullable().optional(),
  pair_kind: wiPairKindEnum.optional().default('article'),
  sample_size: z.number().int().min(2).max(100).optional().default(30),
  replication_rate: z.number().min(0).max(1).optional().default(0.15),
  judge_model: z.string().nullable().optional(),
  judge_temperature: z.number().nullable().optional(),
  judge_reasoning_effort: z.string().nullable().optional(),
  auto_repeats: z.number().int().min(1).max(10).optional().default(1),
  /** Optional override for the holistic comparison prompt body (auto-mode only). NULL/undefined =
   *  use the hardcoded checklist in buildComparisonPrompt. See migration 20260623000003. */
  holistic_prompt_override: holisticPromptOverrideSchema.nullable().optional(),
});

export const evolutionWiSessionRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: wiSessionStatusEnum,
  mode: wiSessionModeEnum,
  source_kind: wiSourceKindEnum,
  prompt_id: z.string().uuid().nullable(),
  judge_eval_test_set_id: z.string().uuid().nullable(),
  pair_kind: wiPairKindEnum,
  sample_size: z.number().int(),
  replication_rate: z.number(),
  judge_model: z.string().nullable(),
  judge_temperature: z.number().nullable(),
  judge_reasoning_effort: z.string().nullable(),
  auto_repeats: z.number().int(),
  auto_run_error: z.string().nullable(),
  is_test_content: z.boolean(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  holistic_prompt_override: z.string().nullable(),
});

export const evolutionWiArticleRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  label: z.string(),
  content: z.string(),
  mu: z.number().nullable(),
  sigma: z.number().nullable(),
  position: z.number().int(),
  created_at: z.string(),
});

export const evolutionWiComparisonRowSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  article_a_id: z.string().uuid(),
  article_b_id: z.string().uuid(),
  pass: z.number().int(),
  shown_swapped: z.boolean(),
  overall_winner: wiVerdict3Enum.nullable(),
  source: wiSourceEnum,
  rater_id: z.string(),
  confidence: z.number().nullable(),
  judge_model: z.string().nullable(),
  cost: z.number().nullable(),
  forward_winner: wiVerdict3Enum.nullable(),
  reverse_winner: wiVerdict3Enum.nullable(),
  forward_raw: z.unknown().nullable(),
  reverse_raw: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const evolutionWiDimensionVerdictRowSchema = z.object({
  comparison_id: z.string().uuid(),
  criteria_id: z.string().uuid(),
  criteria_name: z.string(),
  verdict: wiVerdict3Enum,
  confidence: z.number().nullable(),
  position: z.number().int(),
  created_at: z.string(),
});

export type WiVerdict3 = z.infer<typeof wiVerdict3Enum>;
export type EvolutionWiSessionInsert = z.infer<typeof evolutionWiSessionInsertSchema>;
export type EvolutionWiSessionRow = z.infer<typeof evolutionWiSessionRowSchema>;
export type EvolutionWiArticleRow = z.infer<typeof evolutionWiArticleRowSchema>;
export type EvolutionWiComparisonRow = z.infer<typeof evolutionWiComparisonRowSchema>;
export type EvolutionWiDimensionVerdictRow = z.infer<typeof evolutionWiDimensionVerdictRowSchema>;
