-- PostgreSQL table for testing edits pipeline
-- This table stores incremental results at each step of the processing pipeline

CREATE TABLE TESTING_edits_pipeline (
    id SERIAL PRIMARY KEY,
    set_name VARCHAR(255) NOT NULL CHECK (set_name != ''),
    step VARCHAR(255) NOT NULL CHECK (step != ''),
    content TEXT NOT NULL CHECK (content != ''),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add comments for documentation
COMMENT ON TABLE TESTING_edits_pipeline IS 'Stores incremental test results for each step of the edits processing pipeline';
COMMENT ON COLUMN TESTING_edits_pipeline.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN TESTING_edits_pipeline.set_name IS 'Name of the test set or scenario being processed';
COMMENT ON COLUMN TESTING_edits_pipeline.step IS 'Pipeline step identifier (e.g., "preprocessing", "normalize", "fixHeadings")';
COMMENT ON COLUMN TESTING_edits_pipeline.content IS 'The content/result at this pipeline step';
COMMENT ON COLUMN TESTING_edits_pipeline.created_at IS 'Timestamp when record was created';
COMMENT ON COLUMN TESTING_edits_pipeline.updated_at IS 'Timestamp when record was last updated';

-- Create indexes for common query patterns
CREATE INDEX idx_testing_edits_set_name ON TESTING_edits_pipeline(set_name);
CREATE INDEX idx_testing_edits_step ON TESTING_edits_pipeline(step);
CREATE INDEX idx_testing_edits_set_step ON TESTING_edits_pipeline(set_name, step);
CREATE INDEX idx_testing_edits_created_at ON TESTING_edits_pipeline(created_at);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_testing_edits_pipeline_updated_at
    BEFORE UPDATE ON TESTING_edits_pipeline
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Example usage:
/*
INSERT INTO TESTING_edits_pipeline (set_name, step, content) VALUES
('critic_markup_test_1', 'input', '# Albert Einstein\n\n{~~old text~>new text~~}## Heading'),
('critic_markup_test_1', 'preprocessing', '# Albert Einstein\n\n{~~old text<br>~>new text<br>~~}\n## Heading'),
('critic_markup_test_1', 'fix_headings', '# Albert Einstein\n\n{~~old text<br>~>new text<br>~~}\n## Heading');

-- Query to see all steps for a test set:
SELECT step, content FROM TESTING_edits_pipeline
WHERE set_name = 'critic_markup_test_1'
ORDER BY id;
*/