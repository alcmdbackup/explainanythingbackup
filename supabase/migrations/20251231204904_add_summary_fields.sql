-- Add summary fields to explanations table for AI-generated article summaries.
-- These fields improve discoverability, SEO, and internal search.

-- Add summary fields to explanations table
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS summary_teaser TEXT;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS meta_description VARCHAR(160);
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS keywords TEXT[];

-- GIN index for keyword array search
CREATE INDEX IF NOT EXISTS idx_explanations_keywords ON explanations USING GIN (keywords);

-- Partial index for articles needing summaries (for backfill queries)
CREATE INDEX IF NOT EXISTS idx_explanations_missing_summary
  ON explanations (id)
  WHERE summary_teaser IS NULL AND status = 'published';

COMMENT ON COLUMN explanations.summary_teaser IS '1-2 sentence preview, 30-50 words';
COMMENT ON COLUMN explanations.meta_description IS 'SEO description, max 160 chars';
COMMENT ON COLUMN explanations.keywords IS 'Array of 5-10 search terms';
