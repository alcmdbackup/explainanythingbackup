-- Add isDeleted column to explanation_tags table for soft delete support
ALTER TABLE explanation_tags ADD COLUMN isDeleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for better performance on soft delete queries
CREATE INDEX idx_explanation_tags_isDeleted ON explanation_tags(isDeleted);

-- Add composite index for common query patterns
CREATE INDEX idx_explanation_tags_explanation_isDeleted ON explanation_tags(explanation_id, isDeleted);
CREATE INDEX idx_explanation_tags_tag_isDeleted ON explanation_tags(tag_id, isDeleted);
