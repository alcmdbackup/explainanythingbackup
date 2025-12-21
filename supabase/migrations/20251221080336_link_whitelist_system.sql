-- Link Whitelist System Tables
-- Phase 1: Database schema for link overlay system

-- Core whitelist for KEY TERMS (not headings)
CREATE TABLE link_whitelist (
  id SERIAL PRIMARY KEY,
  canonical_term VARCHAR(255) NOT NULL UNIQUE,
  canonical_term_lower VARCHAR(255) NOT NULL UNIQUE,
  standalone_title VARCHAR(500) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active term lookups
CREATE INDEX idx_link_whitelist_active ON link_whitelist(is_active) WHERE is_active = true;
CREATE INDEX idx_link_whitelist_term_lower ON link_whitelist(canonical_term_lower);

-- Cached heading links per article (AI-generated, cached to avoid repeated calls)
CREATE TABLE article_heading_links (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) ON DELETE CASCADE,
  heading_text VARCHAR(500) NOT NULL,
  heading_text_lower VARCHAR(500) NOT NULL,
  standalone_title VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, heading_text_lower)
);

-- Index for explanation lookups
CREATE INDEX idx_article_heading_links_explanation ON article_heading_links(explanation_id);

-- Aliases (many-to-one -> whitelist)
CREATE TABLE link_whitelist_aliases (
  id SERIAL PRIMARY KEY,
  whitelist_id INTEGER REFERENCES link_whitelist(id) ON DELETE CASCADE,
  alias_term VARCHAR(255) NOT NULL,
  alias_term_lower VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for alias lookups
CREATE INDEX idx_link_whitelist_aliases_whitelist ON link_whitelist_aliases(whitelist_id);
CREATE INDEX idx_link_whitelist_aliases_term_lower ON link_whitelist_aliases(alias_term_lower);

-- Per-article overrides
CREATE TABLE article_link_overrides (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER REFERENCES explanations(id) ON DELETE CASCADE,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL,
  override_type VARCHAR(50) NOT NULL CHECK (override_type IN ('custom_title', 'disabled')),
  custom_standalone_title VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(explanation_id, term_lower)
);

-- Index for explanation lookups
CREATE INDEX idx_article_link_overrides_explanation ON article_link_overrides(explanation_id);

-- Snapshot for fast single-query fetch (includes version for cache invalidation)
CREATE TABLE link_whitelist_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial snapshot row
INSERT INTO link_whitelist_snapshot (id, version, data, updated_at)
VALUES (1, 0, '{}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for link_whitelist
ALTER TABLE link_whitelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON link_whitelist FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON link_whitelist FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON link_whitelist FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON link_whitelist FOR DELETE
TO authenticated
USING (true);

-- RLS Policies for article_heading_links
ALTER TABLE article_heading_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON article_heading_links FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON article_heading_links FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON article_heading_links FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON article_heading_links FOR DELETE
TO authenticated
USING (true);

-- RLS Policies for link_whitelist_aliases
ALTER TABLE link_whitelist_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON link_whitelist_aliases FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON link_whitelist_aliases FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON link_whitelist_aliases FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON link_whitelist_aliases FOR DELETE
TO authenticated
USING (true);

-- RLS Policies for article_link_overrides
ALTER TABLE article_link_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON article_link_overrides FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON article_link_overrides FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON article_link_overrides FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON article_link_overrides FOR DELETE
TO authenticated
USING (true);

-- RLS Policies for link_whitelist_snapshot
ALTER TABLE link_whitelist_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON link_whitelist_snapshot FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON link_whitelist_snapshot FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON link_whitelist_snapshot FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON link_whitelist_snapshot FOR DELETE
TO authenticated
USING (true);
