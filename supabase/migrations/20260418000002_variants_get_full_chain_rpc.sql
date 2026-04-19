-- RPC get_variant_full_chain(variant_id): walks parent_variant_id up to the root seed.
-- Uses WITH RECURSIVE with explicit path tracking for cycle protection (parent_variant_id
-- has no FK today, so corrupt rows are technically possible).
--
-- Returns rows ordered root-first (seed → leaf). Caps at 20 hops to match iterationConfigs.max.
-- Caller: getVariantFullChainAction (Phase 4).

CREATE OR REPLACE FUNCTION get_variant_full_chain(target_variant_id UUID)
RETURNS TABLE (
  id UUID,
  run_id UUID,
  variant_content TEXT,
  elo_score DOUBLE PRECISION,
  mu DOUBLE PRECISION,
  sigma DOUBLE PRECISION,
  generation INTEGER,
  agent_name TEXT,
  parent_variant_id UUID,
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
      v.parent_variant_id,
      0 AS depth,
      ARRAY[v.id] AS path
    FROM evolution_variants v
    WHERE v.id = target_variant_id

    UNION ALL

    -- Recursive: walk up via parent_variant_id. Terminate on:
    --   (a) NULL parent (reached seed / root),
    --   (b) cycle detected (parent already in path),
    --   (c) depth >= 20 (safety cap matching iterationConfigs max).
    SELECT
      p.id,
      p.run_id,
      p.variant_content,
      p.elo_score,
      p.mu,
      p.sigma,
      p.generation,
      p.agent_name,
      p.parent_variant_id,
      c.depth + 1,
      c.path || p.id
    FROM chain c
    JOIN evolution_variants p ON p.id = c.parent_variant_id
    WHERE c.parent_variant_id IS NOT NULL
      AND NOT (p.id = ANY(c.path))
      AND c.depth < 20
  )
  SELECT id, run_id, variant_content, elo_score, mu, sigma, generation, agent_name, parent_variant_id, depth
  FROM chain
  ORDER BY depth DESC;  -- root first, leaf last
$$;

GRANT EXECUTE ON FUNCTION get_variant_full_chain(UUID) TO authenticated, service_role;
