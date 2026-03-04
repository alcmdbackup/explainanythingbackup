-- Add prompt_id FK to evolution_experiments, replacing the TEXT[] prompts column.
-- Backfills from prompts[1] text → evolution_arena_topics.id via case-insensitive match.

-- 1. Guard: reject multi-prompt experiments (unsupported going forward)
DO $$
DECLARE multi_count INTEGER;
BEGIN
  SELECT count(*) INTO multi_count
  FROM evolution_experiments
  WHERE array_length(prompts, 1) > 1;
  IF multi_count > 0 THEN
    RAISE EXCEPTION 'Found % experiments with multiple prompts — cannot migrate', multi_count;
  END IF;
END $$;

-- 2. Add prompt_id column
ALTER TABLE evolution_experiments
  ADD COLUMN prompt_id UUID REFERENCES evolution_arena_topics(id);

-- 3. Backfill prompt_id from prompts[1] text → arena_topics.id
UPDATE evolution_experiments e
SET prompt_id = t.id
FROM evolution_arena_topics t
WHERE lower(trim(e.prompts[1])) = lower(trim(t.prompt))
  AND e.prompts IS NOT NULL
  AND array_length(e.prompts, 1) = 1;

-- 3b. Auto-create arena topics for unmatched prompt text, then backfill again
INSERT INTO evolution_arena_topics (prompt)
SELECT DISTINCT trim(e.prompts[1])
FROM evolution_experiments e
WHERE e.prompt_id IS NULL
  AND e.prompts IS NOT NULL
  AND array_length(e.prompts, 1) = 1
  AND trim(e.prompts[1]) != ''
  AND NOT EXISTS (
    SELECT 1 FROM evolution_arena_topics t
    WHERE lower(trim(t.prompt)) = lower(trim(e.prompts[1]))
  );

UPDATE evolution_experiments e
SET prompt_id = t.id
FROM evolution_arena_topics t
WHERE lower(trim(e.prompts[1])) = lower(trim(t.prompt))
  AND e.prompt_id IS NULL
  AND e.prompts IS NOT NULL
  AND array_length(e.prompts, 1) = 1;

-- 3c. Delete orphaned experiments with NULL or empty prompts (no valid prompt to link)
DELETE FROM evolution_experiments
WHERE prompt_id IS NULL
  AND (prompts IS NULL OR array_length(prompts, 1) IS NULL OR trim(prompts[1]) = '');

-- 4. Guard: ALL experiments must now have prompt_id (including those with NULL prompts)
DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT count(*) INTO null_count
  FROM evolution_experiments
  WHERE prompt_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Found % experiments with NULL prompt_id after backfill — check for NULL/empty prompts or unmatched text', null_count;
  END IF;
END $$;

-- 5. Set NOT NULL + index
ALTER TABLE evolution_experiments
  ALTER COLUMN prompt_id SET NOT NULL;

CREATE INDEX idx_evolution_experiments_prompt ON evolution_experiments(prompt_id);

-- 6. Rename old column to deprecated
ALTER TABLE evolution_experiments
  RENAME COLUMN prompts TO _prompts_deprecated;

-- 7. Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
