# Analyzing Migration Behavior Research

## Problem Statement
Analyze how the project handles database (Supabase SQL) migrations end-to-end: how migrations are tested locally, how they are deployed to staging/production, and how we protect against idempotency failures (e.g. enforcing guards via hooks or lint). Also assess how to clean up the existing backlog of migrations, how to better prevent migration bugs generally, and review GitHub history to catalog the migration-related bugs we've already had.

## Requirements (from GH Issue — TBD)
I want to analyze how we're handling migrations. E.g. how we are testing migrations locally, how we are doing it in staging/prod. How to protect against idempotency failures e.g. by enforcing using hooks or lint. How to clean up our existing migrations. How we can better prevent migration bugs. Analyze GH history to see what migration related bugs we've had.

## High Level Summary
[To be populated during /research — synthesize findings on the current migration lifecycle, enforcement gaps, cleanup opportunities, and the GH-history bug catalog.]

## Documents Read
- docs/docs_overall/environments.md — migration deploy workflow, idempotency lint, staging→prod gating, 62-day silent-drift incident, release cadence
- docs/feature_deep_dives/pr_verification_gate.md — migration-touch PR gating, Docker migration-verify harness, fail-closed high-blast path
- docs/feature_deep_dives/testing_setup.md — migration idempotency lint enforcement, migration-verify Docker suite
- docs/docs_overall/testing_overview.md — Check Parity (migration:verify in /finalize Step 5.5), CI migration jobs
- docs/docs_overall/debugging.md — Supabase CLI schema inspection, migration list/diff commands
- docs/docs_overall/project_workflow.md — push/PR gates for migration-touching branches
- docs/docs_overall/architecture.md — schema-first development, Supabase backend, DB table overview

## Code Files Read
- [To be populated during /research — e.g. scripts/lint-migrations-idempotent.ts, scripts/verify-migrations-local.sh, .github/workflows/supabase-migrations.yml, supabase/migrations/**]
