-- Seed data for tags table
-- Required for "Rewrite with tags" and "Edit with tags" functionality
-- The getTempTagsForRewriteWithTags function expects tags with IDs 2 and 5 to exist
--
-- Tag structure:
--   - presetTagId 1: Difficulty levels (easy, medium, hard)
--   - presetTagId 2: Length options (short, moderate, long)
--   - presetTagId NULL: Simple tags (has_example, sequential, etc.)

-- Only insert if tags don't already exist (idempotent)
INSERT INTO tags (id, tag_name, tag_description, "presetTagId")
SELECT * FROM (VALUES
  (1, 'easy', 'Difficulty level is extremely easy', 1),
  (2, 'medium', 'Difficulty level is medium', 1),
  (3, 'hard', 'Difficulty level is extremely advanced and Difficulty', 1),
  (4, 'short', 'short length', 2),
  (5, 'moderate', 'moderate length', 2),
  (6, 'long', 'long length', 2),
  (7, 'has_example', 'has an example', NULL::integer),
  (8, 'sequential', 'presents info step by step', NULL::integer),
  (9, 'has_metaphor', 'uses a metaphor', NULL::integer),
  (10, 'instructional', 'presents instructions', NULL::integer)
) AS v(id, tag_name, tag_description, "presetTagId")
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE tags.id = v.id);

-- Reset the sequence to continue from the max id
SELECT setval('tags_id_seq', COALESCE((SELECT MAX(id) FROM tags), 0) + 1, false);
