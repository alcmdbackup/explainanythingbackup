-- Migration 1b: Add prompt FK to content_evolution_runs.
-- Links each run to a specific prompt from article_bank_topics.

ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES article_bank_topics(id);

CREATE INDEX IF NOT EXISTS idx_evolution_runs_prompt
  ON content_evolution_runs(prompt_id);

COMMENT ON COLUMN content_evolution_runs.prompt_id IS 'FK to article_bank_topics prompt registry (nullable during transition)';

-- Rollback:
-- DROP INDEX IF EXISTS idx_evolution_runs_prompt;
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS prompt_id;
