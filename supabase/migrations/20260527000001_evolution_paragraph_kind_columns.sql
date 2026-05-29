-- Add variant_kind to evolution_variants and prompt_kind to evolution_prompts.
-- Per D13 of rank_individual_paragraphs_evolution_20260525.
--
-- variant_kind distinguishes article-level variants from paragraph snippets.
-- prompt_kind distinguishes article-level arena topics from per-(parent, slot)
-- paragraph topics. Both default to 'article' so existing rows are zero-touch
-- and existing callers see identical behavior.
--
-- Extensible: the CHECK constraints accept exactly ('article','paragraph') today
-- but extend trivially to ('article','paragraph','sentence','section') later via
-- a single-line follow-up migration.
--
-- Partial indexes target the NEW 'paragraph' partition (the sparser set) so
-- queries filtering for paragraph rows are fast without bloating writes for
-- the existing 'article' majority. Mirrors the is_test_content pattern from
-- 20260415000001_evolution_is_test_content.sql.

ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS variant_kind TEXT NOT NULL DEFAULT 'article'
    CHECK (variant_kind IN ('article', 'paragraph'));

ALTER TABLE evolution_prompts
  ADD COLUMN IF NOT EXISTS prompt_kind TEXT NOT NULL DEFAULT 'article'
    CHECK (prompt_kind IN ('article', 'paragraph'));

CREATE INDEX IF NOT EXISTS idx_evolution_variants_paragraph
  ON evolution_variants(prompt_id, synced_to_arena)
  WHERE variant_kind = 'paragraph';

CREATE INDEX IF NOT EXISTS idx_evolution_prompts_paragraph
  ON evolution_prompts(status)
  WHERE prompt_kind = 'paragraph';
