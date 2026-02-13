-- Rename article_bank_* tables to hall_of_fame_* for branding consistency.

ALTER TABLE article_bank_topics RENAME TO hall_of_fame_topics;
ALTER TABLE article_bank_entries RENAME TO hall_of_fame_entries;
ALTER TABLE article_bank_comparisons RENAME TO hall_of_fame_comparisons;
ALTER TABLE article_bank_elo RENAME TO hall_of_fame_elo;

-- Rename indexes (from 20260201000001_article_bank.sql)
ALTER INDEX idx_article_bank_topics_prompt_unique RENAME TO idx_hall_of_fame_topics_prompt_unique;
ALTER INDEX idx_article_bank_entries_topic RENAME TO idx_hall_of_fame_entries_topic;
ALTER INDEX idx_article_bank_comparisons_topic RENAME TO idx_hall_of_fame_comparisons_topic;
ALTER INDEX idx_article_bank_elo_leaderboard RENAME TO idx_hall_of_fame_elo_leaderboard;

-- Rename indexes (from 20260207000005_hall_of_fame_rank.sql)
ALTER INDEX idx_bank_entries_run_rank RENAME TO idx_hall_of_fame_entries_run_rank;

-- Rename constraints
ALTER TABLE hall_of_fame_entries RENAME CONSTRAINT article_bank_entries_rank_check TO hall_of_fame_entries_rank_check;
ALTER TABLE hall_of_fame_entries RENAME CONSTRAINT article_bank_entries_generation_method_check TO hall_of_fame_entries_generation_method_check;
