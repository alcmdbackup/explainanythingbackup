-- Phase 5 production-reset SQL for the explainanything DB. Executed once on
-- prod (project ref qbxhivoezkfbjbsctdzo) on 2026-05-24 — see
-- docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/_progress.md
-- for the run record (365 explanations + 622 topics wiped; evolution preserved).
--
-- Wipes all explainanything user content (16 tables + explanations + topics)
-- while preserving every evolution row and every shared analytics table.
-- Paste this into Supabase Studio → SQL Editor against the prod project
-- (verify the URL contains the prod project ref before clicking Run).
--
-- Gotchas this SQL avoids (each one tripped us on the first attempt):
--   1. TRUNCATE checks FK references at the schema level (not data level), so
--      tables with FK refs among themselves must be in ONE TRUNCATE statement.
--   2. evolution_explanations.explanation_id → explanations(id) is NO ACTION
--      (not SET NULL), so we MUST null those rows before DELETE FROM
--      explanations, otherwise the DELETE violates the FK.
--   3. topics needs DELETE not TRUNCATE — explanations.primary_topic_id FK
--      constraint persists in schema even when explanations is empty, and
--      blocks TRUNCATE topics.
--   4. evolution_runs.explanation_id → explanations(id) IS ON DELETE SET NULL
--      (per migration 20260524000012). The DELETE FROM explanations relies on
--      that trigger firing.

BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '30s';

-- All explainanything tables with FK relationships among themselves in ONE
-- statement. PG requires this — TRUNCATE checks FK schema, not data.
TRUNCATE TABLE
  "userExplanationEvents",
  "userQueries",
  "userLibrary",
  "explanationMetrics",
  content_reports,
  candidate_occurrences,
  link_candidates,
  article_link_overrides,
  article_heading_links,
  article_sources,
  link_whitelist_snapshot,
  link_whitelist_aliases,
  link_whitelist,
  source_cache,
  explanation_tags
RESTART IDENTITY;

-- BEFORE deleting explanations: null evolution_explanations.explanation_id.
-- That FK is NO ACTION (not SET NULL), so DELETE FROM explanations would
-- otherwise fail with violates foreign key constraint.
UPDATE evolution_explanations
   SET explanation_id = NULL
 WHERE explanation_id IS NOT NULL;

-- Now safe. evolution_runs.explanation_id has ON DELETE SET NULL from
-- migration 20260524000012, so its trigger fires here too.
DELETE FROM explanations;

-- DELETE (not TRUNCATE) because explanations.primary_topic_id FK constraint
-- blocks TRUNCATE topics even when explanations is empty.
DELETE FROM topics;

COMMIT;
