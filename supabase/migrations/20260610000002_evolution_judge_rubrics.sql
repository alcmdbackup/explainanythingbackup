-- Create the judge-rubric entity for rubric-based pairwise judging.
--
-- A "judge rubric" is a named, reusable bundle of judging DIMENSIONS, where each
-- dimension references an existing evolution_criteria row plus a weight. The
-- rubric judge scores which of two texts wins each dimension, then combines the
-- per-dimension winners against the weights to decide the overall match.
--
-- Two tables:
--   * evolution_judge_rubrics            — thin entity (identity + metadata),
--     DB-first like evolution_criteria/evolution_prompts (soft-delete, status,
--     is_test_content auto-classified by a BEFORE trigger).
--   * evolution_judge_rubric_dimensions  — junction (rubric -> criteria + weight).
--     Real FK to evolution_criteria so the rubric reuses existing criteria as
--     its dimension source. criteria_id is ON DELETE RESTRICT (a criterion still
--     used by a rubric cannot be HARD-deleted; criteria use soft-delete, and a
--     soft-deleted criterion is dropped at read time by normalize-on-read).
--
-- Weights are NOT constrained to sum to 1 — they are normalized at read time
-- (getJudgeRubricForEvaluation), which is robust to a criterion being archived
-- after the rubric was built.
--
-- The evolution_is_test_name(text) IMMUTABLE function from migration
-- 20260415000001 is reused as-is — do NOT redefine.

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── evolution_judge_rubrics table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evolution_judge_rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_test_content BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evolution_judge_rubrics_name_len CHECK (char_length(name) BETWEEN 1 AND 200)
);

-- ─── evolution_judge_rubric_dimensions junction ────────────────────────────

CREATE TABLE IF NOT EXISTS evolution_judge_rubric_dimensions (
  rubric_id UUID NOT NULL REFERENCES evolution_judge_rubrics(id) ON DELETE CASCADE,
  criteria_id UUID NOT NULL REFERENCES evolution_criteria(id) ON DELETE RESTRICT,
  weight NUMERIC NOT NULL DEFAULT 1 CHECK (weight >= 0),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (rubric_id, criteria_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evolution_judge_rubrics_status
  ON evolution_judge_rubrics(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_judge_rubrics_non_test
  ON evolution_judge_rubrics(id) WHERE is_test_content = FALSE;
CREATE INDEX IF NOT EXISTS idx_evolution_judge_rubrics_active
  ON evolution_judge_rubrics(id) WHERE deleted_at IS NULL AND status = 'active';
-- PK already covers (rubric_id, ...); add a criteria_id index for the
-- ON DELETE RESTRICT lookups + reverse "which rubrics use this criterion".
CREATE INDEX IF NOT EXISTS idx_evolution_judge_rubric_dimensions_criteria
  ON evolution_judge_rubric_dimensions(criteria_id);

-- ─── RLS: deny-all default + service_role bypass + readonly_local SELECT ────

ALTER TABLE evolution_judge_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_judge_rubric_dimensions ENABLE ROW LEVEL SECURITY;

-- evolution_judge_rubrics policies (DROP-then-CREATE for idempotency-lint)
DROP POLICY IF EXISTS "deny_all" ON evolution_judge_rubrics;
CREATE POLICY "deny_all" ON evolution_judge_rubrics FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_judge_rubrics;
CREATE POLICY "service_role_all" ON evolution_judge_rubrics FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_judge_rubrics;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_judge_rubrics FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

-- evolution_judge_rubric_dimensions policies
DROP POLICY IF EXISTS "deny_all" ON evolution_judge_rubric_dimensions;
CREATE POLICY "deny_all" ON evolution_judge_rubric_dimensions FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_judge_rubric_dimensions;
CREATE POLICY "service_role_all" ON evolution_judge_rubric_dimensions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_judge_rubric_dimensions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_judge_rubric_dimensions FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_judge_rubrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON evolution_judge_rubric_dimensions FROM PUBLIC, anon, authenticated;

-- ─── is_test_content auto-classification trigger (rubrics only) ─────────────

CREATE OR REPLACE FUNCTION evolution_judge_rubrics_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_judge_rubrics_set_is_test_content_tg ON evolution_judge_rubrics;
CREATE TRIGGER evolution_judge_rubrics_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_judge_rubrics
  FOR EACH ROW
  EXECUTE FUNCTION evolution_judge_rubrics_set_is_test_content();

COMMIT;
