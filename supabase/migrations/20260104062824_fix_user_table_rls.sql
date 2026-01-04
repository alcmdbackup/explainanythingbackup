-- Phase 1A: Fix user table RLS policies
-- This migration is safe and doesn't require code changes
-- Fixes: userLibrary INSERT, userQueries duplicate INSERT, userExplanationEvents public visibility

BEGIN;

-- 1A.1 Fix userLibrary INSERT policy
-- Drop permissive INSERT policy (allows any authenticated user to insert for any userid)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userLibrary";

-- Create user-isolated INSERT policy (users can only insert for themselves)
CREATE POLICY "Enable insert for own user only" ON public."userLibrary"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = userid);

-- 1A.2 Fix userQueries duplicate INSERT policies
-- Drop the overly permissive INSERT policy (keep the user-isolated one)
-- "Enable insert for users based on user_id" remains with proper check: (auth.uid() = userid)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."userQueries";

-- 1A.3 Fix userExplanationEvents public visibility
-- Decision: Make user-isolated (users can only see their own events)
-- Public metrics like view counts should come from explanationMetrics table instead
DROP POLICY IF EXISTS "Enable read access for all users" ON public."userExplanationEvents";

-- Create user-isolated SELECT policy
CREATE POLICY "Enable users to view their own events only" ON public."userExplanationEvents"
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = userid);

COMMIT;
