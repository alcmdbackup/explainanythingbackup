# Metrics Integrity Fixes Evolution Research

## Problem Statement
Identify gaps in the current evolution metrics implementation. Metrics need to be calculated correctly for all entities, updated when runs fail or are marked failed, displayed on all UI pages, and recomputed when stale. Prior analysis identified a missing `lock_stale_metrics` RPC and `getBatchMetricsAction` not checking stale flags.

## Requirements (from GH Issue #NNN)
- Prior gaps identified
- Metrics are calculated for all entities
    - Confirm for each of 7 entities separately
- Metrics are updated for runs marked as failed by system somehow
- Metrics are updated for runs that fail suddenly
- Metrics are displayed for each list and detail page in the UI
    - Verify this using codebase
    - Verify this using Playwright to look at each section
- Stale metrics get updated correctly
- Make sure we have unit/integration/e2e tests to verify all of the individual points above

## High Level Summary
[Summary of findings]

## Prior Gaps Identified

### 1. Missing `lock_stale_metrics` RPC (BLOCKER)
`recomputeStaleMetrics()` at `evolution/src/lib/metrics/recomputeMetrics.ts:22` calls `db.rpc('lock_stale_metrics', ...)` but no migration creates this RPC. The call returns `{ data: null }`, causing the function to return early at line 29 — stale metrics are never recomputed.

### 2. `getBatchMetricsAction` skips stale check
`metricsActions.ts:70` — `getBatchMetricsAction` (used by list views) reads metrics via `getMetricsForEntities` without checking the `stale` flag. Only `getEntityMetricsAction` (single-entity detail views) triggers recomputation. List views serve stale ELO values indefinitely.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- evolution/docs/architecture.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md

## Code Files Read
- evolution/src/lib/metrics/recomputeMetrics.ts
- evolution/src/services/metricsActions.ts
- supabase/migrations/20260323000003_evolution_metrics_table.sql
- supabase/migrations/20260326000003_expand_stale_trigger.sql
- supabase/migrations/20260327000001_sync_to_arena_arena_updates.sql
