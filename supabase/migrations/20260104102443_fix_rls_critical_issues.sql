-- Comprehensive RLS fix for both staging and production
-- Ensures all tables have RLS enabled with appropriate policies
-- Idempotent - safe to run on both environments
--
-- Production issues:
--   1. explanationMetrics: RLS ON but no policies (blocks all access)
--   2. explanation_tags: RLS OFF, no policies (full access)
--   3. explanations: RLS OFF, policies ignored, missing UPDATE
--   4. tags: RLS OFF, no policies (full access)
--   5. testing_edits_pipeline: RLS OFF, policies ignored
--
-- Note: source_cache and article_sources are created by earlier migration
-- (20251222000000_create_source_tables.sql) which staging may be missing

-- ============================================
-- Step 1: Enable RLS on all tables
-- (idempotent - no-op if already enabled)
-- ============================================
ALTER TABLE public."explanationMetrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."explanation_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."explanations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."testing_edits_pipeline" ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Step 2: Add missing policies (idempotent)
-- ============================================
DO $$
BEGIN
  -- ----------------------------------------
  -- explanationMetrics: public read, auth insert
  -- ----------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explanationMetrics'
    AND policyname = 'Enable read access for all users'
  ) THEN
    CREATE POLICY "Enable read access for all users" ON public."explanationMetrics"
      FOR SELECT TO public USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explanationMetrics'
    AND policyname = 'Enable insert for authenticated users only'
  ) THEN
    CREATE POLICY "Enable insert for authenticated users only" ON public."explanationMetrics"
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  -- ----------------------------------------
  -- explanation_tags: public read, auth insert
  -- ----------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explanation_tags'
    AND policyname = 'Enable read access for all users'
  ) THEN
    CREATE POLICY "Enable read access for all users" ON public."explanation_tags"
      FOR SELECT TO public USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explanation_tags'
    AND policyname = 'Enable insert for authenticated users only'
  ) THEN
    CREATE POLICY "Enable insert for authenticated users only" ON public."explanation_tags"
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  -- ----------------------------------------
  -- explanations: add UPDATE policy (SELECT/INSERT exist in prod)
  -- ----------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explanations'
    AND policyname = 'Enable update for authenticated users only'
  ) THEN
    CREATE POLICY "Enable update for authenticated users only" ON public."explanations"
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- ----------------------------------------
  -- tags: public read, auth insert
  -- ----------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags'
    AND policyname = 'Enable read access for all users'
  ) THEN
    CREATE POLICY "Enable read access for all users" ON public."tags"
      FOR SELECT TO public USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tags'
    AND policyname = 'Enable insert for authenticated users only'
  ) THEN
    CREATE POLICY "Enable insert for authenticated users only" ON public."tags"
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  -- ----------------------------------------
  -- testing_edits_pipeline: policies already exist, just needed RLS enabled
  -- ----------------------------------------
  -- No new policies needed

END $$;
