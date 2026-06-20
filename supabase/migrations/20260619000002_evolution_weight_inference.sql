-- Weight-inference: infer judge-rubric WEIGHTS from human (or LLM) pairwise verdicts.
--
-- A "session" pools N article variants from an arena topic and collects, per pair:
-- an overall A/B/TIE verdict + a per-criterion A/B/TIE verdict; a fit then backs out
-- the weights so the weighted per-criterion vote predicts the overall verdict (the
-- production rubricJudge.scorePass rule). The fitted weights export to a real
-- evolution_judge_rubrics row.
--
-- Two modes share these tables (distinguished by sessions.mode + comparisons.source):
--   * human — a person gives the verdicts (interactive).
--   * auto  — an LLM-as-judge gives both verdicts (batch); auto-mode columns
--             (judge_model/temperature/cost/forward_winner/reverse_winner/...) are
--             additive + nullable so no second migration is needed.
--
-- Five tables:
--   * evolution_weight_inference_sessions            — the run entity (DB-first;
--     soft-delete, status, is_test_content auto-classified by a BEFORE trigger).
--   * evolution_weight_inference_criteria            — junction (session -> criteria),
--     the chosen criteria set; weight is the OUTPUT (not stored here).
--   * evolution_weight_inference_articles            — snapshot of the sampled pool.
--   * evolution_weight_inference_comparisons         — one row per pair PER PASS
--     (pass 0 = original, pass 1 = reversal replica); verdicts canonical-oriented.
--   * evolution_weight_inference_dimension_verdicts  — per-criterion verdict for a
--     comparison (criteria_id bare + criteria_name snapshot, like judge_eval).
--
-- The evolution_is_test_name(text) IMMUTABLE function from migration 20260415000001
-- is reused as-is — do NOT redefine.

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── evolution_weight_inference_sessions ───────────────────────────────────

CREATE TABLE IF NOT EXISTS evolution_weight_inference_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  mode TEXT NOT NULL DEFAULT 'human' CHECK (mode IN ('human', 'auto')),
  prompt_id UUID,
  sample_size INT NOT NULL DEFAULT 30,
  replication_rate NUMERIC NOT NULL DEFAULT 0.15 CHECK (replication_rate >= 0 AND replication_rate <= 1),
  -- auto-mode judge settings (null for human)
  judge_model TEXT,
  judge_temperature NUMERIC,
  judge_reasoning_effort TEXT,
  auto_repeats INT NOT NULL DEFAULT 1 CHECK (auto_repeats >= 1),
  auto_run_error TEXT,
  is_test_content BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evolution_wi_sessions_name_len CHECK (char_length(name) BETWEEN 1 AND 200)
);

-- ─── evolution_weight_inference_criteria (junction: session -> criteria) ────

CREATE TABLE IF NOT EXISTS evolution_weight_inference_criteria (
  session_id UUID NOT NULL REFERENCES evolution_weight_inference_sessions(id) ON DELETE CASCADE,
  criteria_id UUID NOT NULL REFERENCES evolution_criteria(id) ON DELETE RESTRICT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (session_id, criteria_id)
);

-- ─── evolution_weight_inference_articles (snapshot of sampled pool) ─────────

CREATE TABLE IF NOT EXISTS evolution_weight_inference_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES evolution_weight_inference_sessions(id) ON DELETE CASCADE,
  variant_id UUID,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  mu NUMERIC,
  sigma NUMERIC,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (session_id, label)
);

-- ─── evolution_weight_inference_comparisons (one row per pair PER PASS) ─────

CREATE TABLE IF NOT EXISTS evolution_weight_inference_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES evolution_weight_inference_sessions(id) ON DELETE CASCADE,
  article_a_id UUID NOT NULL REFERENCES evolution_weight_inference_articles(id) ON DELETE CASCADE,
  article_b_id UUID NOT NULL REFERENCES evolution_weight_inference_articles(id) ON DELETE CASCADE,
  pass INT NOT NULL DEFAULT 0 CHECK (pass IN (0, 1)),
  shown_swapped BOOLEAN NOT NULL DEFAULT FALSE,
  -- overall verdict, canonical-oriented (null until the overall step is done)
  overall_winner TEXT CHECK (overall_winner IN ('a', 'b', 'tie')),
  source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'llm')),
  rater_id TEXT NOT NULL,
  -- auto-mode columns (null for human)
  confidence NUMERIC,
  judge_model TEXT,
  cost NUMERIC,
  forward_winner TEXT CHECK (forward_winner IN ('a', 'b', 'tie')),
  reverse_winner TEXT CHECK (reverse_winner IN ('a', 'b', 'tie')),
  forward_raw JSONB,
  reverse_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- canonical pair ordering: article_a_id < article_b_id (PG uuid order == JS
  -- lowercase-UUID string order). Guarantees pass 0/1 of a pair share the tuple.
  CONSTRAINT evolution_wi_comparisons_canonical CHECK (article_a_id < article_b_id),
  UNIQUE (session_id, article_a_id, article_b_id, rater_id, pass)
);

-- ─── evolution_weight_inference_dimension_verdicts (per-criterion per pair) ─

CREATE TABLE IF NOT EXISTS evolution_weight_inference_dimension_verdicts (
  comparison_id UUID NOT NULL REFERENCES evolution_weight_inference_comparisons(id) ON DELETE CASCADE,
  criteria_id UUID NOT NULL,  -- bare (snapshot-tolerant, mirrors judge_eval_dimension_verdicts)
  criteria_name TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('a', 'b', 'tie')),
  confidence NUMERIC,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (comparison_id, criteria_id)
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_evolution_wi_sessions_status
  ON evolution_weight_inference_sessions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_wi_sessions_non_test
  ON evolution_weight_inference_sessions(id) WHERE is_test_content = FALSE;
CREATE INDEX IF NOT EXISTS idx_evolution_wi_sessions_active
  ON evolution_weight_inference_sessions(id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_wi_criteria_criteria
  ON evolution_weight_inference_criteria(criteria_id);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_articles_session
  ON evolution_weight_inference_articles(session_id);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_comparisons_session
  ON evolution_weight_inference_comparisons(session_id);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_comparisons_session_source
  ON evolution_weight_inference_comparisons(session_id, source);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_comparisons_article_a
  ON evolution_weight_inference_comparisons(article_a_id);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_comparisons_article_b
  ON evolution_weight_inference_comparisons(article_b_id);
CREATE INDEX IF NOT EXISTS idx_evolution_wi_dimension_verdicts_criteria
  ON evolution_weight_inference_dimension_verdicts(criteria_id);

-- ─── RLS: deny-all default + service_role bypass + readonly_local SELECT ────

ALTER TABLE evolution_weight_inference_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_weight_inference_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_weight_inference_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_weight_inference_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_weight_inference_dimension_verdicts ENABLE ROW LEVEL SECURITY;

-- sessions
DROP POLICY IF EXISTS "deny_all" ON evolution_weight_inference_sessions;
CREATE POLICY "deny_all" ON evolution_weight_inference_sessions FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_weight_inference_sessions;
CREATE POLICY "service_role_all" ON evolution_weight_inference_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_weight_inference_sessions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_weight_inference_sessions FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

-- criteria junction
DROP POLICY IF EXISTS "deny_all" ON evolution_weight_inference_criteria;
CREATE POLICY "deny_all" ON evolution_weight_inference_criteria FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_weight_inference_criteria;
CREATE POLICY "service_role_all" ON evolution_weight_inference_criteria FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_weight_inference_criteria;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_weight_inference_criteria FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

-- articles
DROP POLICY IF EXISTS "deny_all" ON evolution_weight_inference_articles;
CREATE POLICY "deny_all" ON evolution_weight_inference_articles FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_weight_inference_articles;
CREATE POLICY "service_role_all" ON evolution_weight_inference_articles FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_weight_inference_articles;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_weight_inference_articles FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

-- comparisons
DROP POLICY IF EXISTS "deny_all" ON evolution_weight_inference_comparisons;
CREATE POLICY "deny_all" ON evolution_weight_inference_comparisons FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_weight_inference_comparisons;
CREATE POLICY "service_role_all" ON evolution_weight_inference_comparisons FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_weight_inference_comparisons;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_weight_inference_comparisons FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

-- dimension_verdicts
DROP POLICY IF EXISTS "deny_all" ON evolution_weight_inference_dimension_verdicts;
CREATE POLICY "deny_all" ON evolution_weight_inference_dimension_verdicts FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "service_role_all" ON evolution_weight_inference_dimension_verdicts;
CREATE POLICY "service_role_all" ON evolution_weight_inference_dimension_verdicts FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "readonly_select" ON evolution_weight_inference_dimension_verdicts;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY "readonly_select" ON evolution_weight_inference_dimension_verdicts FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_weight_inference_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON evolution_weight_inference_criteria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON evolution_weight_inference_articles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON evolution_weight_inference_comparisons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON evolution_weight_inference_dimension_verdicts FROM PUBLIC, anon, authenticated;

-- ─── is_test_content auto-classification trigger (sessions only) ────────────

CREATE OR REPLACE FUNCTION evolution_wi_sessions_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_wi_sessions_set_is_test_content_tg ON evolution_weight_inference_sessions;
CREATE TRIGGER evolution_wi_sessions_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_weight_inference_sessions
  FOR EACH ROW
  EXECUTE FUNCTION evolution_wi_sessions_set_is_test_content();

COMMENT ON TABLE evolution_weight_inference_sessions IS 'Weight-inference run: pools article variants from a topic + a criteria set; collects pairwise verdicts to infer rubric weights. mode=human|auto.';
COMMENT ON TABLE evolution_weight_inference_comparisons IS 'One row per pair per pass (0=original, 1=reversal replica). Verdicts canonical-oriented to article_a_id<article_b_id. source=human|llm.';
COMMENT ON TABLE evolution_weight_inference_dimension_verdicts IS 'Per-criterion A/B/TIE verdict for a comparison. criteria_id is bare (snapshot-tolerant) + criteria_name snapshot.';

COMMIT;
