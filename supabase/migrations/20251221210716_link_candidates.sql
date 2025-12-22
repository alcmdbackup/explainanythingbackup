-- Link Candidates System
-- Stores LLM-generated link candidate terms for admin approval

-- Enum for candidate status
CREATE TYPE candidate_status AS ENUM ('pending', 'approved', 'rejected');

-- Main candidates table
CREATE TABLE link_candidates (
  id SERIAL PRIMARY KEY,
  term VARCHAR(255) NOT NULL,
  term_lower VARCHAR(255) NOT NULL UNIQUE,
  source VARCHAR(20) NOT NULL DEFAULT 'llm',
  status candidate_status NOT NULL DEFAULT 'pending',
  total_occurrences INT DEFAULT 0,
  article_count INT DEFAULT 0,
  first_seen_explanation_id INT REFERENCES explanations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for link_candidates
CREATE INDEX idx_candidates_status ON link_candidates(status);
CREATE INDEX idx_candidates_term_lower ON link_candidates(term_lower);
CREATE INDEX idx_candidates_occurrences ON link_candidates(total_occurrences DESC);
CREATE INDEX idx_candidates_pending ON link_candidates(status, total_occurrences DESC) WHERE status = 'pending';

-- Per-article occurrence tracking
CREATE TABLE candidate_occurrences (
  id SERIAL PRIMARY KEY,
  candidate_id INT REFERENCES link_candidates(id) ON DELETE CASCADE,
  explanation_id INT REFERENCES explanations(id) ON DELETE CASCADE,
  occurrence_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, explanation_id)
);

-- Indexes for candidate_occurrences
CREATE INDEX idx_co_candidate ON candidate_occurrences(candidate_id);
CREATE INDEX idx_co_explanation ON candidate_occurrences(explanation_id);

-- RLS Policies for link_candidates
ALTER TABLE link_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON link_candidates FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON link_candidates FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON link_candidates FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON link_candidates FOR DELETE
TO authenticated
USING (true);

-- RLS Policies for candidate_occurrences
ALTER TABLE candidate_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users"
ON candidate_occurrences FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert for authenticated users"
ON candidate_occurrences FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users"
ON candidate_occurrences FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Enable delete for authenticated users"
ON candidate_occurrences FOR DELETE
TO authenticated
USING (true);
