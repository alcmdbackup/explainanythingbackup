-- Fix metrics function search_path setting that broke stored procedures
-- Issue: Migration 20251216143228 incorrectly set search_path = '' on non-SECURITY DEFINER functions
-- These functions use unqualified table names, so empty search_path breaks them
--
-- This migration resets the search_path to allow the functions to work normally

-- Reset search_path on metrics-related functions
-- These are SECURITY INVOKER (default), so search_path setting was incorrect
ALTER FUNCTION public.increment_explanation_views RESET search_path;
ALTER FUNCTION public.increment_explanation_saves RESET search_path;
ALTER FUNCTION public.refresh_explanation_metrics RESET search_path;
ALTER FUNCTION public.refresh_all_explanation_metrics RESET search_path;
