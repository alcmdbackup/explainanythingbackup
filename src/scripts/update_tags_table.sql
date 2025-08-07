-- Migration to update tags table
-- 1. Make tag_description required (NOT NULL)
-- 2. Add presetTagId column (nullable)
-- 3. Remove ispreset column (replaced by presetTagId)

-- First, update any existing NULL tag_description values to a default value
UPDATE tags 
SET tag_description = 'No description provided' 
WHERE tag_description IS NULL;

-- Make tag_description NOT NULL
ALTER TABLE tags 
ALTER COLUMN tag_description SET NOT NULL;

-- Add the new presetTagId column
ALTER TABLE tags 
ADD COLUMN presetTagId INTEGER NULL;

-- Remove the ispreset column
ALTER TABLE tags 
DROP COLUMN ispreset; 