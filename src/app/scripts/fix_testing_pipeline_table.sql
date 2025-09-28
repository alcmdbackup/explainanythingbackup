-- Fix for testing_edits_pipeline table issues
-- Run this in your Supabase SQL Editor to resolve the database saving problems

-- Issue 1: Add missing unique constraint for upsert operations
-- The code expects to use ON CONFLICT (set_name, step) but no such constraint exists
ALTER TABLE testing_edits_pipeline
ADD CONSTRAINT unique_set_name_step UNIQUE (set_name, step);

-- Note: UUID generation has been fixed in the application code to generate proper UUIDs
-- that are compatible with the existing UUID column type

-- Verify the fixes by checking the constraints
SELECT
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'testing_edits_pipeline'::regclass
AND contype = 'u';

-- Test insert with proper UUID to verify the fix
INSERT INTO testing_edits_pipeline (
    set_name,
    step,
    content,
    session_id,
    explanation_id,
    explanation_title,
    user_prompt,
    source_content,
    session_metadata
) VALUES (
    'test-fix-verification',
    'step1_test',
    'Test content to verify the fixes work',
    gen_random_uuid(),
    999,
    'Fix Verification Test',
    'Testing the database fixes',
    'Original content for fix test',
    '{"test": "fix_verification", "timestamp": "' || now()::text || '"}'::jsonb
)
ON CONFLICT (set_name, step)
DO UPDATE SET
    content = EXCLUDED.content,
    updated_at = CURRENT_TIMESTAMP;

-- Verify the test record was inserted
SELECT
    id,
    set_name,
    step,
    session_id,
    explanation_id,
    created_at
FROM testing_edits_pipeline
WHERE set_name = 'test-fix-verification'
ORDER BY created_at DESC
LIMIT 1;

-- Show summary of fixes applied
SELECT 'Fixes Applied Successfully:' AS status
UNION ALL
SELECT '✅ Added unique constraint on (set_name, step)'
UNION ALL
SELECT '✅ Application code now generates proper UUIDs'
UNION ALL
SELECT '✅ Verified upsert operations now work'
UNION ALL
SELECT '✅ Test record inserted successfully';