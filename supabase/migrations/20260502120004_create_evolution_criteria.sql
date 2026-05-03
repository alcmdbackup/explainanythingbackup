-- Create evolution_criteria entity table.
--
-- Criteria are user-defined evaluation dimensions used by the new
-- EvaluateCriteriaThenGenerateFromPreviousArticleAgent. Unlike evolution_tactics
-- (code-first, synced from ALL_SYSTEM_TACTICS), this is a DB-first user-defined
-- entity following the evolution_prompts pattern: full CRUD via the admin UI,
-- soft-delete via deleted_at, is_test_content auto-classified by a BEFORE
-- trigger.
--
-- Each criteria has min_rating/max_rating bounds and an optional JSONB rubric
-- (evaluation_guidance) of {score, description} anchor pairs that the LLM
-- interpolates between when scoring an article.
--
-- Constraints:
--   * max_rating > min_rating
--   * name matches /^[A-Za-z][a-zA-Z0-9_-]{0,128}$/ — keeps names parser-safe
--     (the score-line regex /^([A-Za-z][\w_-]*)/ at parse time would silently
--     drop scores for names with `:` / newlines / control chars). Length 128
--     also bounds metric_name length: prefix
--     'eloAttrDelta:evaluate_criteria_then_generate_from_previous_article:'
--     is 67 chars; 67 + 128 = 195 < 200 (MetricRowSchema cap).
--   * evaluation_guidance anchor scores ∈ [min_rating, max_rating] — enforced
--     via IMMUTABLE function CHECK so direct service_role inserts (bypassing
--     Zod) cannot persist out-of-range anchors.
--
-- The evolution_is_test_name(text) IMMUTABLE function from migration
-- 20260415000001 is reused as-is — do NOT redefine.

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── evolution_criteria_rubric_anchors_in_range function ───────────────────
-- IMMUTABLE function used in the table-level CHECK constraint to validate
-- every JSONB anchor's score is within [min_rating, max_rating]. Returns true
-- when evaluation_guidance is NULL or empty (no rubric is fine), false if any
-- anchor's score is out of range. NULL-safe on min/max.

CREATE OR REPLACE FUNCTION evolution_criteria_rubric_anchors_in_range(
  p_min_rating NUMERIC,
  p_max_rating NUMERIC,
  p_evaluation_guidance JSONB
) RETURNS BOOLEAN
  LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  anchor JSONB;
  anchor_score NUMERIC;
BEGIN
  IF p_evaluation_guidance IS NULL OR jsonb_typeof(p_evaluation_guidance) <> 'array' THEN
    RETURN TRUE;
  END IF;

  IF p_min_rating IS NULL OR p_max_rating IS NULL THEN
    -- Defensive: if range is unset for any reason, be permissive (insert
    -- will fail on the NOT NULL constraint elsewhere).
    RETURN TRUE;
  END IF;

  FOR anchor IN SELECT * FROM jsonb_array_elements(p_evaluation_guidance) LOOP
    anchor_score := (anchor->>'score')::NUMERIC;
    IF anchor_score IS NULL OR anchor_score < p_min_rating OR anchor_score > p_max_rating THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ─── evolution_criteria table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evolution_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  min_rating NUMERIC NOT NULL,
  max_rating NUMERIC NOT NULL,
  evaluation_guidance JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_test_content BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evolution_criteria_max_gt_min CHECK (max_rating > min_rating),
  CONSTRAINT evolution_criteria_name_format CHECK (name ~ '^[A-Za-z][a-zA-Z0-9_-]{0,128}$'),
  CONSTRAINT evolution_criteria_rubric_in_range
    CHECK (evolution_criteria_rubric_anchors_in_range(min_rating, max_rating, evaluation_guidance))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evolution_criteria_status
  ON evolution_criteria(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_criteria_non_test
  ON evolution_criteria(id) WHERE is_test_content = FALSE;
CREATE INDEX IF NOT EXISTS idx_evolution_criteria_active
  ON evolution_criteria(id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_criteria_name
  ON evolution_criteria(name) WHERE status = 'active' AND deleted_at IS NULL;

-- RLS: deny-all default + service_role bypass + readonly_local SELECT
ALTER TABLE evolution_criteria ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_criteria' AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON evolution_criteria FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_criteria' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON evolution_criteria
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_criteria' AND policyname = 'readonly_select') THEN
    CREATE POLICY readonly_select ON evolution_criteria
      FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_criteria FROM PUBLIC, anon, authenticated;

-- BEFORE trigger that auto-classifies is_test_content from name
-- (mirrors evolution_strategies / evolution_prompts / evolution_experiments
-- pattern from 20260415000001 and 20260423081160).

CREATE OR REPLACE FUNCTION evolution_criteria_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_criteria_set_is_test_content_tg ON evolution_criteria;
CREATE TRIGGER evolution_criteria_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_criteria
  FOR EACH ROW
  EXECUTE FUNCTION evolution_criteria_set_is_test_content();

COMMIT;
