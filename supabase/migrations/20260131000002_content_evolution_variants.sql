-- Stores generated text variants and their Elo scores within an evolution run.
-- Variants compete via pairwise comparison to determine the best rewrite.

CREATE TABLE content_evolution_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  variant_content TEXT NOT NULL,
  elo_score NUMERIC(8, 2) NOT NULL DEFAULT 1200
    CHECK (elo_score >= 0 AND elo_score <= 3000),
  generation INT NOT NULL DEFAULT 0
    CHECK (generation >= 0),
  parent_variant_id UUID REFERENCES content_evolution_variants(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  quality_scores JSONB NOT NULL DEFAULT '{}',
  match_count INT NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Critical for getTopByElo() queries
CREATE INDEX idx_variants_run_elo
  ON content_evolution_variants (run_id, elo_score DESC);

-- For lineage tracking queries
CREATE INDEX idx_variants_parent
  ON content_evolution_variants (parent_variant_id)
  WHERE parent_variant_id IS NOT NULL;
