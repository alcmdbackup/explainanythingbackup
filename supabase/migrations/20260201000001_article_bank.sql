-- Article bank: persistent cross-method comparison system for article generation.
-- Groups articles by topic/prompt, stores entries from different generation methods,
-- and maintains Elo ratings for head-to-head quality comparisons.
-- No RLS: admin-only access via service client in server actions (requireAdmin guard)

-- ─── Topics ──────────────────────────────────────────────────────

CREATE TABLE article_bank_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt TEXT NOT NULL,
  title TEXT,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Case-insensitive, trimmed prompt matching for topic grouping (supports ON CONFLICT upsert)
CREATE UNIQUE INDEX idx_article_bank_topics_prompt_unique
  ON article_bank_topics (LOWER(TRIM(prompt)));

-- ─── Entries ─────────────────────────────────────────────────────

CREATE TABLE article_bank_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES article_bank_topics(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  generation_method TEXT NOT NULL
    CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline')),
  model TEXT NOT NULL,
  total_cost_usd NUMERIC(10, 6),
  evolution_run_id UUID REFERENCES content_evolution_runs(id) ON DELETE SET NULL,
  evolution_variant_id UUID REFERENCES content_evolution_variants(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Entries by topic for leaderboard queries
CREATE INDEX idx_article_bank_entries_topic
  ON article_bank_entries (topic_id, created_at DESC);

-- ─── Comparisons (match history) ─────────────────────────────────

CREATE TABLE article_bank_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES article_bank_topics(id) ON DELETE CASCADE,
  entry_a_id UUID NOT NULL REFERENCES article_bank_entries(id) ON DELETE CASCADE,
  entry_b_id UUID NOT NULL REFERENCES article_bank_entries(id) ON DELETE CASCADE,
  winner_id UUID REFERENCES article_bank_entries(id) ON DELETE SET NULL,
  confidence NUMERIC(3, 2) CHECK (confidence >= 0 AND confidence <= 1),
  judge_model TEXT NOT NULL,
  dimension_scores JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Comparisons by topic for match history display
CREATE INDEX idx_article_bank_comparisons_topic
  ON article_bank_comparisons (topic_id, created_at DESC);

-- ─── Elo Ratings ─────────────────────────────────────────────────

CREATE TABLE article_bank_elo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES article_bank_topics(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES article_bank_entries(id) ON DELETE CASCADE,
  elo_rating NUMERIC(8, 2) NOT NULL DEFAULT 1200
    CHECK (elo_rating >= 0 AND elo_rating <= 3000),
  elo_per_dollar NUMERIC(12, 2),
  match_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (topic_id, entry_id)
);

-- Leaderboard queries: top Elo by topic
CREATE INDEX idx_article_bank_elo_leaderboard
  ON article_bank_elo (topic_id, elo_rating DESC);
