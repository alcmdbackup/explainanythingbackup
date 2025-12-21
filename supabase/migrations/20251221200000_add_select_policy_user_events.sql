-- Add SELECT policy to allow reading view counts for public display
-- This fixes the bug where view counts show as 0 due to RLS blocking reads
CREATE POLICY "Enable read access for all users"
ON "userExplanationEvents"
FOR SELECT
USING (true);
