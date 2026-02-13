-- Enforce mandatory short names on prompts (title) and strategies (name).
-- Backfills NULL titles from prompt text before adding NOT NULL constraint.

-- Backfill NULL titles with truncated prompt text
UPDATE article_bank_topics SET title = LEFT(prompt, 60) WHERE title IS NULL;

-- Enforce NOT NULL and non-empty
ALTER TABLE article_bank_topics ALTER COLUMN title SET NOT NULL;
ALTER TABLE article_bank_topics ADD CONSTRAINT prompt_title_not_empty CHECK (LENGTH(TRIM(title)) > 0);

-- Enforce non-empty strategy name
ALTER TABLE strategy_configs ADD CONSTRAINT strategy_name_not_empty CHECK (LENGTH(TRIM(name)) > 0);
