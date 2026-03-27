-- Rename openai/gpt-oss-20b to gpt-oss-20b in existing strategy configs.
-- The slash in the model name breaks dropdown rendering in the strategy creation UI.

UPDATE evolution_strategies
SET config = jsonb_set(config, '{generationModel}', '"gpt-oss-20b"')
WHERE config->>'generationModel' = 'openai/gpt-oss-20b';

UPDATE evolution_strategies
SET config = jsonb_set(config, '{judgeModel}', '"gpt-oss-20b"')
WHERE config->>'judgeModel' = 'openai/gpt-oss-20b';
