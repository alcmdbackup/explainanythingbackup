-- V2 Evolution Schema: Drop all V1 tables/RPCs/views and recreate with simplified V2 schema.
-- This is an intentional clean-slate migration. All historical evolution data is dropped.

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: DROP V1 objects
-- ═══════════════════════════════════════════════════════════════════

-- Drop backward-compatible views first (they reference tables)
DROP VIEW IF EXISTS content_evolution_runs CASCADE;
DROP VIEW IF EXISTS content_evolution_variants CASCADE;
DROP VIEW IF EXISTS hall_of_fame_entries CASCADE;
DROP VIEW IF EXISTS hall_of_fame_comparisons CASCADE;
DROP VIEW IF EXISTS strategy_configs CASCADE;
DROP VIEW IF EXISTS batch_runs CASCADE;
DROP VIEW IF EXISTS agent_cost_baselines CASCADE;

-- Drop V1 RPCs (explicit argument signatures for overloads)
DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, JSONB);
DROP FUNCTION IF EXISTS apply_evolution_winner(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS compute_run_variant_stats(UUID);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS update_strategy_aggregates(UUID, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS get_non_archived_runs();
DROP FUNCTION IF EXISTS archive_experiment(UUID);
DROP FUNCTION IF EXISTS unarchive_experiment(UUID);
DROP FUNCTION IF EXISTS checkpoint_pruning_rpc(UUID, INT);
DROP FUNCTION IF EXISTS get_latest_checkpoint_ids_per_iteration(UUID);

-- Drop V1 tables (CASCADE handles FK dependencies)
DROP TABLE IF EXISTS evolution_checkpoints CASCADE;
DROP TABLE IF EXISTS evolution_budget_events CASCADE;
DROP TABLE IF EXISTS evolution_agent_cost_baselines CASCADE;
DROP TABLE IF EXISTS evolution_run_agent_metrics CASCADE;
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_arena_comparisons CASCADE;
DROP TABLE IF EXISTS evolution_arena_elo CASCADE;
DROP TABLE IF EXISTS evolution_arena_entries CASCADE;
DROP TABLE IF EXISTS evolution_arena_topics CASCADE;
DROP TABLE IF EXISTS evolution_run_logs CASCADE;
DROP TABLE IF EXISTS evolution_agent_invocations CASCADE;
DROP TABLE IF EXISTS evolution_variants CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;
DROP TABLE IF EXISTS evolution_experiments CASCADE;
DROP TABLE IF EXISTS evolution_runs CASCADE;
DROP TABLE IF EXISTS evolution_strategy_configs CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2: CREATE V2 schema (10 tables)
-- ═══════════════════════════════════════════════════════════════════

-- V2.0 Core: Strategy configs
CREATE TABLE evolution_strategy_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT,
  config JSONB NOT NULL,
  config_hash TEXT NOT NULL,
  is_predefined BOOLEAN NOT NULL DEFAULT false,
  pipeline_type TEXT DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL DEFAULT 'system',
  run_count INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC NOT NULL DEFAULT 0,
  avg_final_elo NUMERIC,
  best_final_elo NUMERIC,
  worst_final_elo NUMERIC,
  stddev_final_elo NUMERIC,
  avg_elo_per_dollar NUMERIC,
  first_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_strategy_config_hash UNIQUE (config_hash)
);

-- V2.1 Arena: Topics (prompts)
CREATE TABLE evolution_arena_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  difficulty_tier TEXT,
  domain_tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  deleted_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_arena_topic_prompt UNIQUE (lower(prompt))
);

-- V2.2 Experiments
CREATE TABLE evolution_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prompt_id UUID REFERENCES evolution_arena_topics(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'cancelled', 'archived')),
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V2.0 Core: Runs
CREATE TABLE evolution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT,
  prompt_id UUID REFERENCES evolution_arena_topics(id),
  experiment_id UUID REFERENCES evolution_experiments(id),
  strategy_config_id UUID REFERENCES evolution_strategy_configs(id),
  config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
  pipeline_version TEXT NOT NULL DEFAULT 'v2',
  runner_id TEXT,
  error_message TEXT,
  run_summary JSONB,
  last_heartbeat TIMESTAMPTZ,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- V2.0 Core: Variants
CREATE TABLE evolution_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES evolution_runs(id) ON DELETE CASCADE,
  explanation_id INT,
  variant_content TEXT NOT NULL,
  elo_score NUMERIC NOT NULL DEFAULT 1200,
  generation INT NOT NULL DEFAULT 0,
  parent_variant_id UUID,
  agent_name TEXT,
  match_count INT NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V2.0 Core: Agent invocations (per-phase timeline)
CREATE TABLE evolution_agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  iteration INT NOT NULL DEFAULT 0,
  execution_order INT NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT false,
  skipped BOOLEAN NOT NULL DEFAULT false,
  cost_usd NUMERIC,
  execution_detail JSONB,
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V2.0 Core: Run logs
CREATE TABLE evolution_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'info',
  agent_name TEXT,
  iteration INT,
  variant_id TEXT,
  message TEXT NOT NULL,
  context JSONB
);

-- V2.1 Arena: Entries (with merged Elo)
CREATE TABLE evolution_arena_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES evolution_arena_topics(id) ON DELETE CASCADE,
  run_id UUID REFERENCES evolution_runs(id) ON DELETE SET NULL,
  variant_id UUID,
  content TEXT NOT NULL,
  generation_method TEXT NOT NULL DEFAULT 'pipeline',
  model TEXT,
  cost_usd NUMERIC,
  elo_rating NUMERIC NOT NULL DEFAULT 1200,
  mu NUMERIC NOT NULL DEFAULT 25,
  sigma NUMERIC NOT NULL DEFAULT 8.333,
  match_count INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V2.1 Arena: Comparisons (minimal)
CREATE TABLE evolution_arena_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES evolution_arena_topics(id) ON DELETE CASCADE,
  entry_a UUID NOT NULL REFERENCES evolution_arena_entries(id) ON DELETE CASCADE,
  entry_b UUID NOT NULL REFERENCES evolution_arena_entries(id) ON DELETE CASCADE,
  winner TEXT NOT NULL CHECK (winner IN ('a', 'b', 'draw')),
  confidence NUMERIC NOT NULL DEFAULT 0,
  run_id UUID REFERENCES evolution_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V2.1 Arena: Batch runs (rate limiting)
CREATE TABLE evolution_arena_batch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES evolution_arena_topics(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 3: Indexes
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX idx_runs_pending_claim ON evolution_runs (status, created_at) WHERE status = 'pending';
CREATE INDEX idx_runs_heartbeat_stale ON evolution_runs (last_heartbeat) WHERE status = 'running';
CREATE INDEX idx_runs_experiment ON evolution_runs (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX idx_runs_strategy ON evolution_runs (strategy_config_id) WHERE strategy_config_id IS NOT NULL;
CREATE INDEX idx_runs_archived ON evolution_runs (archived, status);
CREATE INDEX idx_variants_run ON evolution_variants (run_id);
CREATE INDEX idx_variants_winner ON evolution_variants (run_id) WHERE is_winner = true;
CREATE INDEX idx_invocations_run ON evolution_agent_invocations (run_id, iteration);
CREATE INDEX idx_logs_run_created ON evolution_run_logs (run_id, created_at DESC);
CREATE INDEX idx_logs_run_iteration ON evolution_run_logs (run_id, iteration);
CREATE INDEX idx_logs_run_agent ON evolution_run_logs (run_id, agent_name);
CREATE INDEX idx_logs_run_variant ON evolution_run_logs (run_id, variant_id);
CREATE INDEX idx_logs_run_level ON evolution_run_logs (run_id, level);
CREATE INDEX idx_arena_entries_topic ON evolution_arena_entries (topic_id, elo_rating DESC);
CREATE INDEX idx_arena_entries_active ON evolution_arena_entries (topic_id) WHERE archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_topic ON evolution_arena_comparisons (topic_id, created_at DESC);
CREATE INDEX idx_arena_batch_active ON evolution_arena_batch_runs (finished_at) WHERE finished_at IS NULL;
CREATE INDEX idx_experiments_status ON evolution_experiments (status);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 4: RLS (default-deny on all tables)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE evolution_strategy_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_arena_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_agent_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_arena_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_arena_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolution_arena_batch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all ON evolution_strategy_configs FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_arena_topics FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_experiments FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_runs FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_variants FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_agent_invocations FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_run_logs FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_arena_entries FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_arena_comparisons FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_all ON evolution_arena_batch_runs FOR ALL USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: RPCs
-- ═══════════════════════════════════════════════════════════════════

-- claim_evolution_run: Atomic claim with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE evolution_runs
  SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT id FROM evolution_runs
    WHERE status = 'pending'
      AND (p_run_id IS NULL OR id = p_run_id)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) TO service_role;

-- update_strategy_aggregates: Update metrics after run finalization
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_strategy_configs
  SET
    run_count = run_count + 1,
    total_cost_usd = total_cost_usd + COALESCE(p_cost_usd, 0),
    avg_final_elo = CASE
      WHEN run_count = 0 THEN p_final_elo
      ELSE (avg_final_elo * run_count + p_final_elo) / (run_count + 1)
    END,
    best_final_elo = GREATEST(COALESCE(best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = now()
  WHERE id = p_strategy_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) TO service_role;

-- sync_to_arena: Atomic sync of pipeline results to arena
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_topic_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  match JSONB;
BEGIN
  -- Validate input sizes
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  -- Upsert entries
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_arena_entries (id, topic_id, run_id, content, elo_rating, mu, sigma, match_count, generation_method)
    VALUES (
      (entry->>'id')::UUID,
      p_topic_id,
      p_run_id,
      entry->>'content',
      COALESCE((entry->>'elo_rating')::NUMERIC, 1200),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'match_count')::INT, 0),
      COALESCE(entry->>'generation_method', 'pipeline')
    )
    ON CONFLICT (id) DO UPDATE SET
      elo_rating = COALESCE((entry->>'elo_rating')::NUMERIC, evolution_arena_entries.elo_rating),
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_arena_entries.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_arena_entries.sigma),
      match_count = COALESCE((entry->>'match_count')::INT, evolution_arena_entries.match_count);
  END LOOP;

  -- Insert match history
  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (topic_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_topic_id,
      (match->>'entry_a')::UUID,
      (match->>'entry_b')::UUID,
      match->>'winner',
      COALESCE((match->>'confidence')::NUMERIC, 0),
      p_run_id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) TO service_role;

-- cancel_experiment: Atomically cancel experiment + fail its runs
CREATE OR REPLACE FUNCTION cancel_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_experiments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_experiment_id AND status = 'running';

  UPDATE evolution_runs
  SET status = 'failed', error_message = 'Experiment cancelled', completed_at = now()
  WHERE experiment_id = p_experiment_id AND status IN ('pending', 'claimed', 'running');
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_experiment(UUID) TO service_role;
