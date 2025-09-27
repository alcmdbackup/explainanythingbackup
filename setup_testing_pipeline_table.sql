-- Complete setup script for testing_edits_pipeline table
-- Run this in your Supabase SQL Editor

-- First, create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS testing_edits_pipeline (
    id SERIAL PRIMARY KEY,
    set_name VARCHAR(255) NOT NULL CHECK (set_name != ''),
    step VARCHAR(255) NOT NULL CHECK (step != ''),
    content TEXT NOT NULL CHECK (content != ''),
    session_id UUID,
    explanation_id INTEGER,
    explanation_title TEXT,
    user_prompt TEXT,
    source_content TEXT,
    session_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add comments for documentation
COMMENT ON TABLE testing_edits_pipeline IS 'Stores incremental test results for each step of the edits processing pipeline and AI suggestion sessions';
COMMENT ON COLUMN testing_edits_pipeline.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN testing_edits_pipeline.set_name IS 'Name of the test set or scenario being processed';
COMMENT ON COLUMN testing_edits_pipeline.step IS 'Pipeline step identifier (e.g., "step1_ai_suggestions", "step2_applied_edits")';
COMMENT ON COLUMN testing_edits_pipeline.content IS 'The content/result at this pipeline step';
COMMENT ON COLUMN testing_edits_pipeline.session_id IS 'Unique identifier for each AI suggestion session (UUID)';
COMMENT ON COLUMN testing_edits_pipeline.explanation_id IS 'Reference to the source explanation for AI suggestions';
COMMENT ON COLUMN testing_edits_pipeline.explanation_title IS 'Title of the source explanation for display purposes';
COMMENT ON COLUMN testing_edits_pipeline.user_prompt IS 'User input prompt from AISuggestionsPanel';
COMMENT ON COLUMN testing_edits_pipeline.source_content IS 'Original content before AI suggestions were applied';
COMMENT ON COLUMN testing_edits_pipeline.session_metadata IS 'Additional session data stored as JSON';
COMMENT ON COLUMN testing_edits_pipeline.created_at IS 'Timestamp when record was created';
COMMENT ON COLUMN testing_edits_pipeline.updated_at IS 'Timestamp when record was last updated';

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_testing_edits_set_name ON testing_edits_pipeline(set_name);
CREATE INDEX IF NOT EXISTS idx_testing_edits_step ON testing_edits_pipeline(step);
CREATE INDEX IF NOT EXISTS idx_testing_edits_set_step ON testing_edits_pipeline(set_name, step);
CREATE INDEX IF NOT EXISTS idx_testing_edits_created_at ON testing_edits_pipeline(created_at);
CREATE INDEX IF NOT EXISTS idx_testing_edits_pipeline_session_id ON testing_edits_pipeline(session_id);
CREATE INDEX IF NOT EXISTS idx_testing_edits_pipeline_explanation_id ON testing_edits_pipeline(explanation_id);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER IF NOT EXISTS update_testing_edits_pipeline_updated_at
    BEFORE UPDATE ON testing_edits_pipeline
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert a sample record to verify the table works
INSERT INTO testing_edits_pipeline (set_name, step, content, session_id, explanation_id, explanation_title, user_prompt, source_content, session_metadata)
VALUES (
    'sample-test',
    'step1_ai_suggestions',
    'This is sample AI suggestions content for testing the table structure.',
    gen_random_uuid(),
    1,
    'Sample Explanation Title',
    'Make this content better',
    'Original sample content before AI suggestions',
    '{"step": "ai_suggestions", "processing_time": 1500}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Verify the table structure and sample data
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'testing_edits_pipeline'
ORDER BY ordinal_position;

-- Show sample data
SELECT
    id,
    set_name,
    step,
    session_id,
    explanation_id,
    explanation_title,
    user_prompt,
    created_at
FROM testing_edits_pipeline
LIMIT 5;