-- Migration: Repair missing source tables for Import Sources feature
-- Purpose: Idempotently create source_cache and article_sources tables
-- Context: Original migration 20251222000000 was tracked but tables weren't created

-- =============================================================================
-- SOURCE CACHE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS source_cache (
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

-- Indexes (IF NOT EXISTS requires PG 9.5+)
CREATE INDEX IF NOT EXISTS idx_source_cache_url_hash ON source_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_source_cache_expires ON source_cache(expires_at);

-- =============================================================================
-- ARTICLE SOURCES JUNCTION TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS article_sources (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  source_cache_id INTEGER NOT NULL REFERENCES source_cache(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, source_cache_id),
  UNIQUE(explanation_id, position)
);

CREATE INDEX IF NOT EXISTS idx_article_sources_explanation ON article_sources(explanation_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS (idempotent - no-op if already enabled)
ALTER TABLE source_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_sources ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first if they exist, then recreate
DROP POLICY IF EXISTS "Anyone can read source cache" ON source_cache;
DROP POLICY IF EXISTS "Authenticated users can insert sources" ON source_cache;
DROP POLICY IF EXISTS "Authenticated users can update sources" ON source_cache;
DROP POLICY IF EXISTS "Anyone can read article sources" ON article_sources;
DROP POLICY IF EXISTS "Authenticated users can insert article sources" ON article_sources;
DROP POLICY IF EXISTS "Authenticated users can delete article sources" ON article_sources;

-- source_cache policies
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

-- article_sources policies
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
