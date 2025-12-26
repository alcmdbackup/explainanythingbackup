-- Migration: Create source tables for Import Sources feature
-- Purpose: Enable user-provided source URLs to ground AI explanations with inline citations

-- =============================================================================
-- SOURCE CACHE TABLE
-- =============================================================================
-- Stores fetched and extracted content from user-provided URLs
-- Shared cache across all users for efficiency

CREATE TABLE source_cache (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  url_hash TEXT GENERATED ALWAYS AS (encode(sha256(url::bytea), 'hex')) STORED,
  title TEXT,
  favicon_url TEXT,
  domain TEXT NOT NULL,
  extracted_text TEXT,
  is_summarized BOOLEAN DEFAULT FALSE,
  original_length INTEGER,
  fetch_status TEXT DEFAULT 'pending' CHECK (fetch_status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  fetched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast URL hash lookups
CREATE INDEX idx_source_cache_url_hash ON source_cache(url_hash);

-- Index for cache expiry cleanup
CREATE INDEX idx_source_cache_expires ON source_cache(expires_at);

-- =============================================================================
-- ARTICLE SOURCES JUNCTION TABLE
-- =============================================================================
-- Links explanations to their source references with ordering

CREATE TABLE article_sources (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  source_cache_id INTEGER NOT NULL REFERENCES source_cache(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, source_cache_id),
  UNIQUE(explanation_id, position)
);

-- Index for efficient explanation lookups
CREATE INDEX idx_article_sources_explanation ON article_sources(explanation_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on both tables
ALTER TABLE source_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_sources ENABLE ROW LEVEL SECURITY;

-- source_cache: public read (shared cache), authenticated insert/update
CREATE POLICY "Anyone can read source cache"
  ON source_cache
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert sources"
  ON source_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update sources"
  ON source_cache
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- article_sources: authenticated users can read and manage
CREATE POLICY "Anyone can read article sources"
  ON article_sources
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert article sources"
  ON article_sources
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete article sources"
  ON article_sources
  FOR DELETE
  USING (auth.role() = 'authenticated');
