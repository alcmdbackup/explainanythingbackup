-- Create evolution_explanations table and add FK columns to runs, experiments, and arena entries.
-- Phase 1 of the data types evolution rework.

BEGIN;

-- ─── 1. Create evolution_explanations table ───────────────────────
CREATE TABLE evolution_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NULL REFERENCES explanations(id),
  prompt_id UUID NULL REFERENCES evolution_arena_topics(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('explanation', 'prompt_seed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE evolution_explanations IS 'Decoupled evolution article identity — stores the seed text that started a run, whether from an explanation or a generated prompt.';
COMMENT ON COLUMN evolution_explanations.explanation_id IS 'FK to explanations table for explanation-based runs. NULL for prompt-based runs.';
COMMENT ON COLUMN evolution_explanations.prompt_id IS 'FK to evolution_arena_topics for prompt-based runs. NULL for explanation-based runs.';
COMMENT ON COLUMN evolution_explanations.source IS 'How this article was sourced: explanation (from explanations table) or prompt_seed (LLM-generated from prompt).';

CREATE INDEX idx_evolution_explanations_explanation_id ON evolution_explanations(explanation_id) WHERE explanation_id IS NOT NULL;
CREATE INDEX idx_evolution_explanations_prompt_id ON evolution_explanations(prompt_id) WHERE prompt_id IS NOT NULL;

-- ─── 2. Add NULLABLE FK columns to 3 tables ──────────────────────
ALTER TABLE evolution_runs
  ADD COLUMN evolution_explanation_id UUID NULL REFERENCES evolution_explanations(id);

ALTER TABLE evolution_experiments
  ADD COLUMN evolution_explanation_id UUID NULL REFERENCES evolution_explanations(id);

ALTER TABLE evolution_arena_entries
  ADD COLUMN evolution_explanation_id UUID NULL REFERENCES evolution_explanations(id);

-- ─── 3. Backfill: explanation-based runs ──────────────────────────
-- For each distinct explanation_id used in runs, create one evolution_explanations row.
INSERT INTO evolution_explanations (explanation_id, title, content, source)
SELECT DISTINCT ON (r.explanation_id)
  r.explanation_id,
  COALESCE(e.explanation_title, 'Untitled'),
  COALESCE(e.content, ''),
  'explanation'
FROM evolution_runs r
JOIN explanations e ON e.id = r.explanation_id
WHERE r.explanation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM evolution_explanations ee
    WHERE ee.explanation_id = r.explanation_id
  );

-- ─── 4. Backfill: prompt-based runs (no explanation_id) ──────────
-- Each prompt-based run gets its own evolution_explanation row with content from checkpoint.
-- We insert+update in a single loop to avoid ambiguous join on non-unique keys.
DO $$
DECLARE
  run_row RECORD;
  checkpoint_text TEXT;
  new_evo_expl_id UUID;
BEGIN
  FOR run_row IN
    SELECT r.id, r.prompt_id, r.created_at
    FROM evolution_runs r
    WHERE r.explanation_id IS NULL
      AND r.evolution_explanation_id IS NULL
  LOOP
    -- Try to get seed text from latest checkpoint
    SELECT c.state_snapshot->>'originalText' INTO checkpoint_text
    FROM evolution_checkpoints c
    WHERE c.run_id = run_row.id
    ORDER BY c.created_at DESC
    LIMIT 1;

    INSERT INTO evolution_explanations (prompt_id, title, content, source, created_at)
    VALUES (
      run_row.prompt_id,
      COALESCE(LEFT(checkpoint_text, 80), 'Unknown (no checkpoint)'),
      COALESCE(checkpoint_text, ''),
      'prompt_seed',
      run_row.created_at
    )
    RETURNING id INTO new_evo_expl_id;

    UPDATE evolution_runs SET evolution_explanation_id = new_evo_expl_id WHERE id = run_row.id;
  END LOOP;
END $$;

-- ─── 5. Backfill evolution_explanation_id on runs ─────────────────
-- Explanation-based runs: match by explanation_id
UPDATE evolution_runs r
SET evolution_explanation_id = ee.id
FROM evolution_explanations ee
WHERE ee.explanation_id = r.explanation_id
  AND r.explanation_id IS NOT NULL
  AND r.evolution_explanation_id IS NULL;

-- ─── 6. Backfill evolution_explanation_id on experiments ──────────
-- Experiments: inherit from their first run that has the value set.
UPDATE evolution_experiments exp
SET evolution_explanation_id = sub.evolution_explanation_id
FROM (
  SELECT DISTINCT ON (r.experiment_id) r.experiment_id, r.evolution_explanation_id
  FROM evolution_runs r
  WHERE r.experiment_id IS NOT NULL
    AND r.evolution_explanation_id IS NOT NULL
  ORDER BY r.experiment_id, r.created_at
) sub
WHERE sub.experiment_id = exp.id
  AND exp.evolution_explanation_id IS NULL;

-- Experiments without runs: create placeholder from prompt_id
INSERT INTO evolution_explanations (prompt_id, title, content, source)
SELECT
  exp.prompt_id,
  COALESCE(LEFT(t.prompt, 80), 'Untitled experiment prompt'),
  COALESCE(t.prompt, ''),
  'prompt_seed'
FROM evolution_experiments exp
LEFT JOIN evolution_arena_topics t ON t.id = exp.prompt_id
WHERE exp.evolution_explanation_id IS NULL
  AND exp.prompt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM evolution_explanations ee
    WHERE ee.prompt_id = exp.prompt_id AND ee.source = 'prompt_seed'
  );

UPDATE evolution_experiments exp
SET evolution_explanation_id = ee.id
FROM evolution_explanations ee
WHERE ee.prompt_id = exp.prompt_id
  AND ee.source = 'prompt_seed'
  AND exp.evolution_explanation_id IS NULL;

-- ─── 7. Backfill evolution_explanation_id on arena entries ────────
UPDATE evolution_arena_entries ae
SET evolution_explanation_id = r.evolution_explanation_id
FROM evolution_runs r
WHERE r.id = ae.evolution_run_id
  AND r.evolution_explanation_id IS NOT NULL
  AND ae.evolution_explanation_id IS NULL;

-- ─── 8. Verify NULL counts = 0 on runs and experiments ───────────
DO $$
DECLARE
  null_runs INT;
  null_experiments INT;
BEGIN
  SELECT COUNT(*) INTO null_runs FROM evolution_runs WHERE evolution_explanation_id IS NULL;
  SELECT COUNT(*) INTO null_experiments FROM evolution_experiments WHERE evolution_explanation_id IS NULL;

  IF null_runs > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % evolution_runs still have NULL evolution_explanation_id', null_runs;
  END IF;

  IF null_experiments > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % evolution_experiments still have NULL evolution_explanation_id', null_experiments;
  END IF;
END $$;

-- ─── 9. SET NOT NULL on runs and experiments ──────────────────────
ALTER TABLE evolution_runs
  ALTER COLUMN evolution_explanation_id SET NOT NULL;

ALTER TABLE evolution_experiments
  ALTER COLUMN evolution_explanation_id SET NOT NULL;

-- Arena entries left NULLABLE — oneshot entries have no linked run.

-- ─── 10. Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_evolution_runs_evo_explanation_id
  ON evolution_runs(evolution_explanation_id);

CREATE INDEX idx_evolution_experiments_evo_explanation_id
  ON evolution_experiments(evolution_explanation_id);

CREATE INDEX idx_evolution_arena_entries_evo_explanation_id
  ON evolution_arena_entries(evolution_explanation_id)
  WHERE evolution_explanation_id IS NOT NULL;

COMMIT;

-- ROLLBACK:
-- ALTER TABLE evolution_arena_entries DROP COLUMN IF EXISTS evolution_explanation_id;
-- ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS evolution_explanation_id;
-- ALTER TABLE evolution_runs DROP COLUMN IF EXISTS evolution_explanation_id;
-- DROP TABLE IF EXISTS evolution_explanations;
