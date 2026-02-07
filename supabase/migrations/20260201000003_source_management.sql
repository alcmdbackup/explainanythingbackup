-- Source management stored procedures and supporting infrastructure.
-- Enables CRUD operations on article_sources with atomic position management.

-- ROLLBACK: DROP FUNCTION IF EXISTS replace_explanation_sources, remove_and_renumber_source,
--   reorder_explanation_sources, get_source_citation_counts, get_co_cited_sources;
-- ROLLBACK: DROP INDEX IF EXISTS idx_article_sources_source_cache;
-- ROLLBACK: DROP POLICY IF EXISTS "Authenticated users can update article_sources" ON article_sources;

-- =============================================================================
-- RLS UPDATE POLICY
-- =============================================================================

-- article_sources already has RLS enabled. Add UPDATE policy for defense-in-depth.
-- Stored procedures use SECURITY DEFINER and bypass this, but direct client UPDATEs
-- are blocked unless user is authenticated.
DROP POLICY IF EXISTS "Authenticated users can update article_sources" ON article_sources;
CREATE POLICY "Authenticated users can update article_sources"
  ON article_sources FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- =============================================================================
-- PERFORMANCE INDEX
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_article_sources_source_cache
  ON article_sources(source_cache_id);

-- =============================================================================
-- STORED PROCEDURES
-- =============================================================================

-- replace_explanation_sources: Atomically replace all sources for an explanation.
-- Deletes existing sources then inserts new ones with sequential positions.
-- Empty array = remove all sources.
CREATE OR REPLACE FUNCTION replace_explanation_sources(
  p_explanation_id INT,
  p_source_ids INT[]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Guard: empty array = remove all sources
  IF array_length(p_source_ids, 1) IS NULL THEN
    DELETE FROM article_sources WHERE explanation_id = p_explanation_id;
    RETURN;
  END IF;

  -- Delete all existing sources for this explanation
  DELETE FROM article_sources WHERE explanation_id = p_explanation_id;

  -- Insert new sources with sequential positions
  INSERT INTO article_sources (explanation_id, source_cache_id, position)
  SELECT p_explanation_id, source_id, ordinality::int
  FROM unnest(p_source_ids) WITH ORDINALITY AS t(source_id, ordinality);
END;
$$;

GRANT EXECUTE ON FUNCTION replace_explanation_sources TO authenticated, anon, service_role;


-- remove_and_renumber_source: Remove a specific source and renumber remaining positions.
-- After removing source at position N, all sources at positions > N are decremented by 1.
CREATE OR REPLACE FUNCTION remove_and_renumber_source(
  p_explanation_id INT,
  p_source_cache_id INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed_position INT;
BEGIN
  -- Get the position of the source being removed
  SELECT position INTO removed_position
  FROM article_sources
  WHERE explanation_id = p_explanation_id AND source_cache_id = p_source_cache_id;

  IF removed_position IS NULL THEN
    RAISE EXCEPTION 'Source % not linked to explanation %', p_source_cache_id, p_explanation_id;
  END IF;

  -- Delete the source
  DELETE FROM article_sources
  WHERE explanation_id = p_explanation_id AND source_cache_id = p_source_cache_id;

  -- Renumber: update positions of remaining sources to be sequential.
  -- Uses a CTE to calculate new positions, then updates only changed rows.
  -- Since we decrement positions (3→2, 4→3), updates flow downward without
  -- UNIQUE(explanation_id, position) violations.
  WITH ordered_remaining AS (
    SELECT source_cache_id, ROW_NUMBER() OVER (ORDER BY position) AS new_position
    FROM article_sources
    WHERE explanation_id = p_explanation_id
  )
  UPDATE article_sources AS a
  SET position = o.new_position
  FROM ordered_remaining o
  WHERE a.explanation_id = p_explanation_id
    AND a.source_cache_id = o.source_cache_id
    AND a.position != o.new_position;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_and_renumber_source TO authenticated, anon, service_role;


-- reorder_explanation_sources: Atomically reorder sources by replacing positions.
-- p_source_ids must contain exactly the same source_cache_ids currently linked.
CREATE OR REPLACE FUNCTION reorder_explanation_sources(
  p_explanation_id INT,
  p_source_ids INT[]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Validate: p_source_ids must match existing source count
  IF (
    SELECT COUNT(*) FROM article_sources WHERE explanation_id = p_explanation_id
  ) != array_length(p_source_ids, 1) THEN
    RAISE EXCEPTION 'Source count mismatch: provided % but explanation has % sources',
      array_length(p_source_ids, 1),
      (SELECT COUNT(*) FROM article_sources WHERE explanation_id = p_explanation_id);
  END IF;

  -- Delete and reinsert to avoid UNIQUE constraint issues during position shuffling
  DELETE FROM article_sources WHERE explanation_id = p_explanation_id;

  INSERT INTO article_sources (explanation_id, source_cache_id, position)
  SELECT p_explanation_id, source_id, ordinality::int
  FROM unnest(p_source_ids) WITH ORDINALITY AS t(source_id, ordinality);
END;
$$;

GRANT EXECUTE ON FUNCTION reorder_explanation_sources TO authenticated, anon, service_role;


-- get_source_citation_counts: Aggregate citation counts across all explanations.
-- Returns sources ranked by how many explanations cite them.
-- p_period: 'all', '7d', '30d', '90d'
-- p_limit: max results (default 50)
CREATE OR REPLACE FUNCTION get_source_citation_counts(
  p_period TEXT DEFAULT 'all',
  p_limit INT DEFAULT 50
) RETURNS TABLE (
  source_cache_id INT,
  total_citations BIGINT,
  unique_explanations BIGINT,
  domain TEXT,
  title TEXT,
  favicon_url TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id AS source_cache_id,
    COUNT(a_s.id) AS total_citations,
    COUNT(DISTINCT a_s.explanation_id) AS unique_explanations,
    sc.domain,
    sc.title,
    sc.favicon_url
  FROM source_cache sc
  INNER JOIN article_sources a_s ON a_s.source_cache_id = sc.id
  WHERE
    CASE p_period
      WHEN '7d' THEN a_s.created_at >= NOW() - INTERVAL '7 days'
      WHEN '30d' THEN a_s.created_at >= NOW() - INTERVAL '30 days'
      WHEN '90d' THEN a_s.created_at >= NOW() - INTERVAL '90 days'
      ELSE TRUE
    END
  GROUP BY sc.id, sc.domain, sc.title, sc.favicon_url
  ORDER BY total_citations DESC, unique_explanations DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_source_citation_counts TO authenticated, anon, service_role;


-- get_co_cited_sources: Find sources frequently co-cited with a given source.
-- "Co-cited" = appears in the same explanation as p_source_id.
CREATE OR REPLACE FUNCTION get_co_cited_sources(
  p_source_id INT,
  p_limit INT DEFAULT 10
) RETURNS TABLE (
  source_cache_id INT,
  co_citation_count BIGINT,
  domain TEXT,
  title TEXT,
  favicon_url TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id AS source_cache_id,
    COUNT(DISTINCT a_s2.explanation_id) AS co_citation_count,
    sc.domain,
    sc.title,
    sc.favicon_url
  FROM article_sources a_s1
  INNER JOIN article_sources a_s2 ON a_s1.explanation_id = a_s2.explanation_id
    AND a_s1.source_cache_id != a_s2.source_cache_id
  INNER JOIN source_cache sc ON sc.id = a_s2.source_cache_id
  WHERE a_s1.source_cache_id = p_source_id
  GROUP BY sc.id, sc.domain, sc.title, sc.favicon_url
  ORDER BY co_citation_count DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_co_cited_sources TO authenticated, anon, service_role;
