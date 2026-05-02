-- Add criteria_set_used + weakest_criteria_ids columns to evolution_variants.
-- These columns are populated only by the new
-- EvaluateCriteriaThenGenerateFromPreviousArticleAgent wrapper agent; NULL for
-- all other variants (vanilla GFPA, reflection, swiss).
--
-- criteria_set_used = the full set of criteria UUIDs that were evaluated for
--   this variant's generation (matches iterCfg.criteriaIds for the iteration
--   that produced it, filtered to active criteria at fetch time).
-- weakest_criteria_ids = the K criteria the wrapper auto-picked as the focus
--   for the suggestions step (deterministic, normalized-score-based ranking).
--
-- Postgres can't enforce FK constraints on UUID array elements; soft-delete on
-- evolution_criteria preserves referential integrity at the application layer.
--
-- GIN indexes support the @> containment query used by getCriteriaVariantsAction
-- ("variants where this criteria was in weakest_criteria_ids") and the
-- computeCriteriaMetricsForRun aggregator.

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS criteria_set_used UUID[];
ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS weakest_criteria_ids UUID[];

CREATE INDEX IF NOT EXISTS idx_evolution_variants_criteria_set_used
  ON evolution_variants USING GIN (criteria_set_used);

CREATE INDEX IF NOT EXISTS idx_evolution_variants_weakest_criteria_ids
  ON evolution_variants USING GIN (weakest_criteria_ids);

COMMIT;
