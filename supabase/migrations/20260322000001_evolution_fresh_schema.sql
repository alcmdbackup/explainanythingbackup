-- Fresh evolution schema: documents the desired state of all evolution tables.
-- This migration is idempotent — it uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- It can be applied to both dev (where tables already exist) and prod (which needs renames + new columns).
--
-- Context: The evolution migration history accumulated ~48 migrations across V1→V2,
-- with a clean-slate wipe (20260315) that created discontinuities. This migration
-- replaces all prior evolution migrations as the single source of truth.

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 0: DROP legacy objects that should not exist
-- ═══════════════════════════════════════════════════════════════════

-- Drop V1 tables that V2 should have removed
DROP TABLE IF EXISTS evolution_checkpoints CASCADE;
DROP TABLE IF EXISTS evolution_run_agent_metrics CASCADE;
DROP TABLE IF EXISTS evolution_agent_cost_baselines CASCADE;
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_arena_elo CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;

-- Drop budget_events (created in 20260306, dropped by V2, never needed again)
DROP TABLE IF EXISTS evolution_budget_events CASCADE;

-- Drop arena_batch_runs (unused rate-limiting table)
DROP TABLE IF EXISTS evolution_arena_batch_runs CASCADE;

-- Drop arena_entries (consolidated into evolution_variants in 20260321000002)
DROP TABLE IF EXISTS evolution_arena_entries CASCADE;

-- Drop legacy RPCs
DROP FUNCTION IF EXISTS apply_evolution_winner(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS compute_run_variant_stats(UUID);
DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, JSONB);
DROP FUNCTION IF EXISTS get_non_archived_runs();
DROP FUNCTION IF EXISTS archive_experiment(UUID);
DROP FUNCTION IF EXISTS unarchive_experiment(UUID);
DROP FUNCTION IF EXISTS checkpoint_pruning_rpc(UUID, INT);
DROP FUNCTION IF EXISTS get_latest_checkpoint_ids_per_iteration(UUID);

-- Drop legacy views
DROP VIEW IF EXISTS content_evolution_runs CASCADE;
DROP VIEW IF EXISTS content_evolution_variants CASCADE;
DROP VIEW IF EXISTS hall_of_fame_entries CASCADE;
DROP VIEW IF EXISTS hall_of_fame_comparisons CASCADE;
DROP VIEW IF EXISTS strategy_configs CASCADE;
DROP VIEW IF EXISTS batch_runs CASCADE;
DROP VIEW IF EXISTS agent_cost_baselines CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: RENAME tables if they still have old names (prod)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Rename evolution_strategy_configs → evolution_strategies
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evolution_strategy_configs' AND table_schema = 'public')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evolution_strategies' AND table_schema = 'public') THEN
    ALTER TABLE evolution_strategy_configs RENAME TO evolution_strategies;
  END IF;

  -- Rename evolution_arena_topics → evolution_prompts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evolution_arena_topics' AND table_schema = 'public')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evolution_prompts' AND table_schema = 'public') THEN
    ALTER TABLE evolution_arena_topics RENAME TO evolution_prompts;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2: RENAME columns if they still have old names (prod)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- evolution_runs.strategy_config_id → strategy_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evolution_runs' AND column_name = 'strategy_config_id' AND table_schema = 'public'
  ) THEN
    ALTER TABLE evolution_runs RENAME COLUMN strategy_config_id TO strategy_id;
  END IF;

  -- evolution_arena_entries.topic_id → prompt_id (if table still exists — handled by DROP above)
  -- evolution_arena_comparisons.topic_id → prompt_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evolution_arena_comparisons' AND column_name = 'topic_id' AND table_schema = 'public'
  ) THEN
    ALTER TABLE evolution_arena_comparisons RENAME COLUMN topic_id TO prompt_id;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 3: ADD missing columns
-- ═══════════════════════════════════════════════════════════════════

-- evolution_runs: add budget_cap_usd if missing
ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS budget_cap_usd NUMERIC(10,4) DEFAULT 1.00;

-- evolution_runs: drop config JSONB if still present (prod)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evolution_runs' AND column_name = 'config' AND table_schema = 'public'
  ) THEN
    ALTER TABLE evolution_runs DROP COLUMN config;
  END IF;
END $$;

-- evolution_runs: add evolution_explanation_id if missing (lost during V2 wipe)
ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS evolution_explanation_id UUID REFERENCES evolution_explanations(id);

-- evolution_experiments: add evolution_explanation_id if missing
ALTER TABLE evolution_experiments ADD COLUMN IF NOT EXISTS evolution_explanation_id UUID REFERENCES evolution_explanations(id);

-- evolution_variants: add arena columns if missing (prod doesn't have them)
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS mu NUMERIC NOT NULL DEFAULT 25;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS sigma NUMERIC NOT NULL DEFAULT 8.333;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES evolution_prompts(id) ON DELETE SET NULL;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS synced_to_arena BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS arena_match_count INT NOT NULL DEFAULT 0;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS generation_method TEXT DEFAULT 'pipeline';
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS cost_usd NUMERIC;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE evolution_variants ADD COLUMN IF NOT EXISTS evolution_explanation_id UUID REFERENCES evolution_explanations(id);

-- evolution_prompts: drop V1 columns if present
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS difficulty_tier;
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS domain_tags;

-- evolution_variants: drop dead columns
ALTER TABLE evolution_variants DROP COLUMN IF EXISTS elo_attribution;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 4: ENFORCE NOT NULL where needed
-- ═══════════════════════════════════════════════════════════════════

-- strategy_id must be NOT NULL (backfill check)
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM evolution_runs WHERE strategy_id IS NULL;
  IF missing_count = 0 THEN
    -- Safe to enforce NOT NULL
    ALTER TABLE evolution_runs ALTER COLUMN strategy_id SET NOT NULL;
  ELSE
    RAISE NOTICE '% runs have NULL strategy_id — skipping NOT NULL enforcement', missing_count;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: FIX missing FK on evolution_explanations.prompt_id
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'evolution_explanations'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'prompt_id'
  ) THEN
    ALTER TABLE evolution_explanations
      ADD CONSTRAINT evolution_explanations_prompt_id_fkey
      FOREIGN KEY (prompt_id) REFERENCES evolution_prompts(id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6: RETARGET arena_comparisons FKs to evolution_variants
--          (prod still points to evolution_arena_entries which was dropped)
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fk_target TEXT;
BEGIN
  -- Check if entry_a FK points to evolution_variants or something else
  SELECT ccu.table_name INTO fk_target
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_name = 'evolution_arena_comparisons'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'entry_a';

  IF fk_target IS NOT NULL AND fk_target != 'evolution_variants' THEN
    ALTER TABLE evolution_arena_comparisons
      DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_a_fkey,
      DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_b_fkey;

    ALTER TABLE evolution_arena_comparisons
      ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey
        FOREIGN KEY (entry_a) REFERENCES evolution_variants(id) ON DELETE CASCADE,
      ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey
        FOREIGN KEY (entry_b) REFERENCES evolution_variants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 7: INDEXES (idempotent — IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════════

-- Runs
CREATE INDEX IF NOT EXISTS idx_runs_pending_claim ON evolution_runs (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_runs_heartbeat_stale ON evolution_runs (last_heartbeat) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON evolution_runs (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_strategy ON evolution_runs (strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_archived ON evolution_runs (archived, status);

-- Variants
CREATE INDEX IF NOT EXISTS idx_variants_run ON evolution_variants (run_id);
CREATE INDEX IF NOT EXISTS idx_variants_winner ON evolution_variants (run_id) WHERE is_winner = true;
CREATE INDEX IF NOT EXISTS idx_variants_arena_prompt ON evolution_variants (prompt_id, mu DESC) WHERE synced_to_arena = true AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_variants_arena_active ON evolution_variants (prompt_id) WHERE synced_to_arena = true AND archived_at IS NULL;

-- Agent invocations
CREATE INDEX IF NOT EXISTS idx_invocations_run ON evolution_agent_invocations (run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_invocations_run_cost ON evolution_agent_invocations (run_id, cost_usd);

-- Run logs
CREATE INDEX IF NOT EXISTS idx_logs_run_created ON evolution_run_logs (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_run_iteration ON evolution_run_logs (run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_logs_run_agent ON evolution_run_logs (run_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_logs_run_variant ON evolution_run_logs (run_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_logs_run_level ON evolution_run_logs (run_id, level);

-- Arena comparisons
CREATE INDEX IF NOT EXISTS idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- Experiments
CREATE INDEX IF NOT EXISTS idx_experiments_status ON evolution_experiments (status);

-- Explanations
CREATE INDEX IF NOT EXISTS idx_evolution_explanations_explanation_id ON evolution_explanations (explanation_id) WHERE explanation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_explanations_prompt_id ON evolution_explanations (prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_runs_evo_explanation_id ON evolution_runs (evolution_explanation_id);
CREATE INDEX IF NOT EXISTS idx_evolution_experiments_evo_explanation_id ON evolution_experiments (evolution_explanation_id);
CREATE INDEX IF NOT EXISTS idx_evolution_arena_entries_evo_explanation_id ON evolution_variants (evolution_explanation_id) WHERE evolution_explanation_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 8: RLS POLICIES (idempotent)
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'evolution_strategies',
    'evolution_prompts',
    'evolution_experiments',
    'evolution_runs',
    'evolution_variants',
    'evolution_agent_invocations',
    'evolution_run_logs',
    'evolution_explanations',
    'evolution_arena_comparisons'
  ] LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- deny_all policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'deny_all') THEN
      EXECUTE format('CREATE POLICY deny_all ON %I FOR ALL USING (false) WITH CHECK (false)', tbl);
    END IF;

    -- service_role_all policy
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', tbl);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl);
  END LOOP;

  -- readonly_select for readonly_local role (if it exists)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    FOREACH tbl IN ARRAY ARRAY[
      'evolution_strategies',
      'evolution_prompts',
      'evolution_experiments',
      'evolution_runs',
      'evolution_variants',
      'evolution_agent_invocations',
      'evolution_run_logs',
      'evolution_explanations',
      'evolution_arena_comparisons'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS readonly_select ON %I', tbl);
      EXECUTE format('CREATE POLICY readonly_select ON %I FOR SELECT TO readonly_local USING (true)', tbl);
    END LOOP;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 9: RPCs (CREATE OR REPLACE — idempotent)
-- ═══════════════════════════════════════════════════════════════════

-- Drop old function signatures that may conflict
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);

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
  UPDATE evolution_strategies
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

-- sync_to_arena: Upsert variants + insert comparisons (targets evolution_variants)
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
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
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, synced_to_arena, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method, created_at
    )
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      true,
      p_run_id,
      COALESCE(entry->>'variant_content', ''),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'elo_score')::NUMERIC, 1200),
      0,
      COALESCE(entry->>'generation_method', 'pipeline'),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
  END LOOP;

  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (prompt_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_prompt_id,
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

-- get_run_total_cost: Sum cost from invocations
CREATE OR REPLACE FUNCTION get_run_total_cost(p_run_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM evolution_agent_invocations WHERE run_id = p_run_id;
$$;

REVOKE ALL ON FUNCTION get_run_total_cost(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_run_total_cost(UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 10: VIEW (CREATE OR REPLACE)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW evolution_run_costs AS
  SELECT run_id, COALESCE(SUM(cost_usd), 0) AS total_cost_usd
  FROM evolution_agent_invocations
  GROUP BY run_id;

REVOKE ALL ON evolution_run_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON evolution_run_costs TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 11: MIGRATE arena data from evolution_arena_entries to
--           evolution_variants (prod only — dev already done)
-- ═══════════════════════════════════════════════════════════════════

-- This is a no-op if evolution_arena_entries was already dropped (dev).
-- On prod, the table may have data that needs to be migrated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evolution_arena_entries' AND table_schema = 'public') THEN
    -- Update existing variants that have matching arena entries
    UPDATE evolution_variants ev
    SET
      prompt_id = eae.prompt_id,
      synced_to_arena = true,
      mu = COALESCE(eae.mu, ev.mu),
      sigma = COALESCE(eae.sigma, ev.sigma),
      elo_score = COALESCE(eae.elo_rating, ev.elo_score),
      arena_match_count = eae.match_count,
      generation_method = eae.generation_method,
      model = eae.model,
      cost_usd = eae.cost_usd,
      archived_at = eae.archived_at
    FROM evolution_arena_entries eae
    WHERE ev.id = eae.id;

    -- Insert non-pipeline arena entries that have no matching variant
    INSERT INTO evolution_variants (
      id, run_id, variant_content, mu, sigma, elo_score,
      prompt_id, synced_to_arena, arena_match_count, generation_method, model,
      cost_usd, archived_at, created_at
    )
    SELECT
      eae.id, eae.run_id, eae.content, eae.mu, eae.sigma, eae.elo_rating,
      eae.prompt_id, true, eae.match_count, eae.generation_method, eae.model,
      eae.cost_usd, eae.archived_at, eae.created_at
    FROM evolution_arena_entries eae
    WHERE NOT EXISTS (SELECT 1 FROM evolution_variants ev WHERE ev.id = eae.id);

    -- Drop the table now that data is migrated
    DROP TABLE evolution_arena_entries CASCADE;
  END IF;
END $$;
