-- Migration script to update testing_edits_pipeline table for AI suggestions session support
-- This should be run on the database to add the new columns

-- Add the new columns for session support
ALTER TABLE testing_edits_pipeline
ADD COLUMN IF NOT EXISTS session_id UUID,
ADD COLUMN IF NOT EXISTS explanation_id INTEGER,
ADD COLUMN IF NOT EXISTS explanation_title TEXT,
ADD COLUMN IF NOT EXISTS user_prompt TEXT,
ADD COLUMN IF NOT EXISTS source_content TEXT,
ADD COLUMN IF NOT EXISTS session_metadata JSONB;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_testing_edits_pipeline_session_id ON testing_edits_pipeline(session_id);
CREATE INDEX IF NOT EXISTS idx_testing_edits_pipeline_explanation_id ON testing_edits_pipeline(explanation_id);

-- Add comments for the new columns
COMMENT ON COLUMN testing_edits_pipeline.session_id IS 'Unique identifier for each AI suggestion session (UUID)';
COMMENT ON COLUMN testing_edits_pipeline.explanation_id IS 'Reference to the source explanation for AI suggestions';
COMMENT ON COLUMN testing_edits_pipeline.explanation_title IS 'Title of the source explanation for display purposes';
COMMENT ON COLUMN testing_edits_pipeline.user_prompt IS 'User input prompt from AISuggestionsPanel';
COMMENT ON COLUMN testing_edits_pipeline.source_content IS 'Original content before AI suggestions were applied';
COMMENT ON COLUMN testing_edits_pipeline.session_metadata IS 'Additional session data stored as JSON';

-- Verify the schema after migration
-- You can run: \d testing_edits_pipeline to see the updated table structure