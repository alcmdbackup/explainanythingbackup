-- Drop the deprecated prompts TEXT[] column from evolution_experiments.
-- The prompt_id UUID FK added in 20260304000001 replaces it.

ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS _prompts_deprecated;

NOTIFY pgrst, 'reload schema';
