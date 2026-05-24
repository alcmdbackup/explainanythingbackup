-- Phase 0 dry-run: execute against the STAGING project after PITR-restoring
-- prod data into staging. Mirrors the Phase 5 production-reset SQL exactly.
-- Wrapped in a transaction; review post-COMMIT row counts via diff-counts.ts
-- before declaring success.
--
-- DO NOT run against production. The capture-counts.ts harness has a
-- prod-URL guard; this SQL file does NOT. Run it only from the Supabase
-- Studio SQL Editor on the staging project.

BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '30s';

TRUNCATE TABLE "userExplanationEvents" RESTART IDENTITY;
TRUNCATE TABLE "userQueries" RESTART IDENTITY;
TRUNCATE TABLE "userLibrary" RESTART IDENTITY;
TRUNCATE TABLE "explanationMetrics" RESTART IDENTITY;
TRUNCATE TABLE content_reports RESTART IDENTITY;
TRUNCATE TABLE candidate_occurrences RESTART IDENTITY;
TRUNCATE TABLE link_candidates RESTART IDENTITY;
TRUNCATE TABLE article_link_overrides RESTART IDENTITY;
TRUNCATE TABLE article_heading_links RESTART IDENTITY;
TRUNCATE TABLE article_sources RESTART IDENTITY;
TRUNCATE TABLE link_whitelist_snapshot RESTART IDENTITY;
TRUNCATE TABLE link_whitelist_aliases RESTART IDENTITY;
TRUNCATE TABLE link_whitelist RESTART IDENTITY;
TRUNCATE TABLE source_cache RESTART IDENTITY;
TRUNCATE TABLE explanation_tags RESTART IDENTITY;

-- DELETE not TRUNCATE so ON DELETE SET NULL fires on evolution_runs.explanation_id.
DELETE FROM explanations;

TRUNCATE TABLE topics RESTART IDENTITY;

-- Sever the link from evolution_explanations to (now-empty) public explanations.
UPDATE evolution_explanations
   SET explanation_id = NULL
 WHERE explanation_id IS NOT NULL;

COMMIT;
