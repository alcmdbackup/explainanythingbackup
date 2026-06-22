-- Create the evolution_style_fingerprints entity + its article-set junction,
-- wire run-binding columns, extend the metrics entity_type CHECK, and seed the
-- stylistic_accuracy criterion.
--
-- A style fingerprint is a DB-first, user-authored entity (mirrors evolution_criteria /
-- evolution_prompts): a short, accurate description of a writer's style computed over a
-- SET of one-or-more source articles. It is injected into generation prompts (to steer
-- voice) and into the judging rubric (to score stylistic accuracy). Full CRUD via the
-- admin UI, soft-delete via deleted_at, is_test_content auto-classified by a BEFORE
-- trigger calling evolution_is_test_name(text) (from 20260415000001 — do NOT redefine).
--
--   * fingerprint            JSONB structured traits (sentence length, spelling region,
--                            signature phrases, tone, …) — see styleFingerprintTraitsSchema.
--   * fingerprint_prose      TEXT rendered article-scope prose used in prompts/judging.
--   * article_count          denormalized count of rows in the junction.
--
-- The junction (evolution_style_fingerprint_articles) holds each set member as EITHER a
-- reference to an existing explanations row (explanation_id) OR pasted raw text
-- (article_text) — enforced by an exactly-one-non-empty-source CHECK.
--
-- evolution_runs gains style_fingerprint_id + style_fingerprint_snapshot (JSONB): a run
-- that opts in snapshots the fingerprint at run start so later edits never retroactively
-- change what historical runs were generated/judged against. There is intentionally NO FK
-- on style_fingerprint_id — runs must survive a fingerprint hard-delete and rely on the
-- snapshot.

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── evolution_style_fingerprints table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS evolution_style_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  fingerprint JSONB,
  fingerprint_prose TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_test_content BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evolution_style_fingerprints_name_format CHECK (name ~ '^[A-Za-z][a-zA-Z0-9_-]{0,128}$')
);

CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprints_status
  ON evolution_style_fingerprints(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprints_non_test
  ON evolution_style_fingerprints(id) WHERE is_test_content = FALSE;
CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprints_active
  ON evolution_style_fingerprints(id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprints_name
  ON evolution_style_fingerprints(name) WHERE status = 'active' AND deleted_at IS NULL;

ALTER TABLE evolution_style_fingerprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON evolution_style_fingerprints;
CREATE POLICY deny_all ON evolution_style_fingerprints FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_all ON evolution_style_fingerprints;
CREATE POLICY service_role_all ON evolution_style_fingerprints
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    DROP POLICY IF EXISTS readonly_select ON evolution_style_fingerprints;
    CREATE POLICY readonly_select ON evolution_style_fingerprints
      FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_style_fingerprints FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION evolution_style_fingerprints_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_style_fingerprints_set_is_test_content_tg ON evolution_style_fingerprints;
CREATE TRIGGER evolution_style_fingerprints_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_style_fingerprints
  FOR EACH ROW
  EXECUTE FUNCTION evolution_style_fingerprints_set_is_test_content();

-- ─── evolution_style_fingerprint_articles junction ─────────────────────────
-- Each row is EITHER an explanation reference OR pasted text (exactly one,
-- non-empty). ON DELETE CASCADE from the fingerprint; explanation_id is
-- SET NULL on delete only when it is the source — but since a row must always
-- have exactly one source, a deleted explanation would violate the CHECK, so we
-- snapshot pasted text instead by leaving explanation rows intact (ON DELETE
-- RESTRICT would block explanation deletion). We use SET NULL + a partial
-- cleanup is out of scope; for v1 explanation_id rows simply reference live rows.

CREATE TABLE IF NOT EXISTS evolution_style_fingerprint_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id UUID NOT NULL REFERENCES evolution_style_fingerprints(id) ON DELETE CASCADE,
  explanation_id BIGINT REFERENCES explanations(id) ON DELETE CASCADE,
  article_text TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT evolution_style_fingerprint_articles_one_source CHECK (
    ((explanation_id IS NOT NULL) <> (article_text IS NOT NULL))
    AND (article_text IS NULL OR length(trim(article_text)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprint_articles_fp
  ON evolution_style_fingerprint_articles(fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_evolution_style_fingerprint_articles_fp_pos
  ON evolution_style_fingerprint_articles(fingerprint_id, position);

ALTER TABLE evolution_style_fingerprint_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON evolution_style_fingerprint_articles;
CREATE POLICY deny_all ON evolution_style_fingerprint_articles FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_all ON evolution_style_fingerprint_articles;
CREATE POLICY service_role_all ON evolution_style_fingerprint_articles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    DROP POLICY IF EXISTS readonly_select ON evolution_style_fingerprint_articles;
    CREATE POLICY readonly_select ON evolution_style_fingerprint_articles
      FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_style_fingerprint_articles FROM PUBLIC, anon, authenticated;

-- ─── evolution_runs run-binding columns ────────────────────────────────────
-- No FK on style_fingerprint_id (run must survive fingerprint hard-delete; the
-- snapshot is the source of truth for historical reproducibility).

ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS style_fingerprint_id UUID;
ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS style_fingerprint_snapshot JSONB;

-- ─── extend evolution_metrics.entity_type CHECK ────────────────────────────
-- Current values (after 20260610000003):
--   run, invocation, variant, strategy, experiment, prompt, tactic, criteria, judge_rubric
-- Adding: style_fingerprint (for total_extraction_cost).

ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run','invocation','variant','strategy','experiment','prompt','tactic','criteria','judge_rubric','style_fingerprint'))
  NOT VALID;
ALTER TABLE evolution_metrics VALIDATE CONSTRAINT evolution_metrics_entity_type_check;

-- ─── seed the stylistic_accuracy criterion ─────────────────────────────────
-- Attachable to a strategy's judgeRubricId (article) and/or paragraphJudgeRubricId
-- (paragraph) bundle. The low anchor penalizes over-saturation of signature phrases
-- (anti-overuse); the high anchor rewards faithful voice match. Idempotent.

INSERT INTO evolution_criteria (name, description, min_rating, max_rating, evaluation_guidance)
VALUES (
  'stylistic_accuracy',
  'How closely the text matches the target style fingerprint (sentence length, spelling region, tone, signature phrases) without over-saturating the author''s signature phrases.',
  1,
  5,
  '[
    {"score": 1, "description": "Ignores the target style: wrong register/spelling, or forces signature phrases unnaturally (over-saturation)."},
    {"score": 3, "description": "Partially matches the target style; some divergence in sentence rhythm, spelling, or tone, but recognizable."},
    {"score": 5, "description": "Faithfully matches the target voice (sentence length, spelling region, tone) and uses any signature phrases sparingly and naturally."}
  ]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
