-- Index for querying variants by Elo attribution gain.
-- NOTE: Do NOT use CONCURRENTLY — Supabase migrations run inside transactions.

CREATE INDEX IF NOT EXISTS idx_evolution_variants_elo_attribution_gain
  ON evolution_variants (CAST(elo_attribution->>'gain' AS numeric))
  WHERE elo_attribution IS NOT NULL AND elo_attribution->>'gain' IS NOT NULL;
