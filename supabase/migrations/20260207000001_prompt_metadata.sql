-- Migration 1a: Add prompt metadata columns to article_bank_topics.
-- Repurposes article_bank_topics as the prompt registry with difficulty, domain, and status.

ALTER TABLE article_bank_topics
  ADD COLUMN IF NOT EXISTS difficulty_tier TEXT,
  ADD COLUMN IF NOT EXISTS domain_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Constraint: status must be 'active' or 'archived'
ALTER TABLE article_bank_topics
  ADD CONSTRAINT article_bank_topics_status_check
  CHECK (status IN ('active', 'archived'));

COMMENT ON COLUMN article_bank_topics.difficulty_tier IS 'Prompt difficulty: NULL = unrated';
COMMENT ON COLUMN article_bank_topics.domain_tags IS 'Domain categories (e.g., science, math)';
COMMENT ON COLUMN article_bank_topics.status IS 'active = available for runs, archived = hidden from run-queue';

-- Rollback:
-- ALTER TABLE article_bank_topics DROP CONSTRAINT IF EXISTS article_bank_topics_status_check;
-- ALTER TABLE article_bank_topics DROP COLUMN IF EXISTS difficulty_tier, DROP COLUMN IF EXISTS domain_tags, DROP COLUMN IF EXISTS status;
