-- bring_back_debate_agent_20260506 PR 2 — Phase 1.18 — rewrite get_variant_full_chain RPC.
--
-- Walks parent_variant_ids[1] (PostgreSQL 1-indexed) for the linear primary-parent chain,
-- AND returns the full parent_variant_ids array per row so callers can surface
-- multi-parent edges (debate's [winner, loser] per Decision §20). The legacy
-- parent_variant_id field is removed from the return shape — callers update to
-- read parent_variant_ids[0] (in-memory 0-indexed) for the primary parent.
--
-- Cycle detection: array-path tracking, same approach as the V1 RPC.
-- Hop cap: 20 (matches iterationConfigs.max).
--
-- Forward-only. CREATE OR REPLACE FUNCTION; signature changes (return type) so we
-- DROP first to avoid 'cannot change return type' errors.

DROP FUNCTION IF EXISTS get_variant_full_chain(UUID);

CREATE FUNCTION get_variant_full_chain(target_variant_id UUID)
RETURNS TABLE (
  id UUID,
  run_id UUID,
  variant_content TEXT,
  elo_score DOUBLE PRECISION,
  mu DOUBLE PRECISION,
  sigma DOUBLE PRECISION,
  generation INTEGER,
  agent_name TEXT,
  parent_variant_ids UUID[],
  depth INTEGER
) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    -- Anchor: the target variant at depth 0 (leaf).
    SELECT
      v.id,
      v.run_id,
      v.variant_content,
      v.elo_score,
      v.mu,
      v.sigma,
      v.generation,
      v.agent_name,
      v.parent_variant_ids,
      0 AS depth,
      ARRAY[v.id] AS path
    FROM evolution_variants v
    WHERE v.id = target_variant_id

    UNION ALL

    -- Recursive: walk up via parent_variant_ids[1] (the canonical primary parent
    -- per Decision §20). PostgreSQL arrays are 1-indexed.
    -- Terminate on:
    --   (a) Empty array (root variant — no further ancestors),
    --   (b) Cycle detected (parent already in path),
    --   (c) Depth >= 20 (safety cap matching iterationConfigs.max).
    SELECT
      p.id,
      p.run_id,
      p.variant_content,
      p.elo_score,
      p.mu,
      p.sigma,
      p.generation,
      p.agent_name,
      p.parent_variant_ids,
      c.depth + 1,
      c.path || p.id
    FROM chain c
    JOIN evolution_variants p ON p.id = c.parent_variant_ids[1]
    WHERE c.parent_variant_ids[1] IS NOT NULL
      AND NOT (p.id = ANY(c.path))
      AND c.depth < 20
  )
  SELECT id, run_id, variant_content, elo_score, mu, sigma, generation, agent_name, parent_variant_ids, depth
  FROM chain
  ORDER BY depth DESC;  -- root first, leaf last
$$;

GRANT EXECUTE ON FUNCTION get_variant_full_chain(UUID) TO authenticated, service_role;
