-- Add source column to explanations table
-- Tracks where content was imported from (ChatGPT, Claude, Gemini, etc.)

ALTER TABLE explanations
ADD COLUMN source TEXT CHECK (source IN ('chatgpt', 'claude', 'gemini', 'other', 'generated'));

-- Add index for filtering by source
CREATE INDEX idx_explanations_source ON explanations(source) WHERE source IS NOT NULL;

COMMENT ON COLUMN explanations.source IS 'Source of content: chatgpt, claude, gemini, other (imported), generated (created in app), NULL (legacy)';
