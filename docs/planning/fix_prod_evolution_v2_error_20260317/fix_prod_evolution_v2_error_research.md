# Fix Prod Evolution V2 Error Research

## Problem Statement
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check" in production, when trying to create an evolution experiment.

## Requirements (from GH Issue #723)
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check"

## High Level Summary

The V2 experiment code (`evolution/src/lib/v2/experiments.ts`) inserts experiments with `status: 'pending'`, but the V2 database schema (`20260315000001_evolution_v2.sql`) defines the CHECK constraint as `('draft', 'running', 'completed', 'cancelled', 'archived')`. The status `'pending'` is not in the allowed set, so every `createExperiment` call fails.

The V2 schema intentionally uses `'draft'` (not `'pending'`) as the initial experiment status, with `DEFAULT 'draft'` on the column. The V2 TypeScript code was written using V1 status vocabulary (`'pending'`) instead of the V2 vocabulary (`'draft'`).

## Root Cause

### Production DB Schema (confirmed via `npm run query:prod`)

**`evolution_experiments` table:**
| Column | Default | Nullable |
|--------|---------|----------|
| id | gen_random_uuid() | NO |
| name | NULL | NO |
| prompt_id | NULL | YES |
| status | `'draft'` | NO |
| config | NULL | YES |
| created_at | now() | NO |
| updated_at | now() | NO |

**Status CHECK constraint (prod):**
```sql
CHECK (status IN ('draft', 'running', 'completed', 'cancelled', 'archived'))
```

### V2 Code Bug — Status Mismatch

| File | Line | Bug | Fix |
|------|------|-----|-----|
| `experiments.ts` | 33 | `status: 'pending'` in INSERT | Remove (use DB default `'draft'`) or change to `'draft'` |
| `experiments.ts` | 55 | `exp.status === 'pending'` | `exp.status === 'draft'` |
| `experiments.ts` | 74 | `if (exp.status === 'pending')` | `if (exp.status === 'draft')` |
| `experiments.ts` | 79 | `.eq('status', 'pending')` | `.eq('status', 'draft')` |
| `experiments.test.ts` | 34 | Default mock returns `status: 'pending'` | `status: 'draft'` |
| `experiments.test.ts` | 67 | Asserts `status: 'pending'` in insert | `status: 'draft'` |
| `experiments.test.ts` | 82-83 | Test name + mock uses `pending` | Change to `draft` |

### Not affected
- `evolution_runs.status` uses `'pending'` correctly (runs have a different CHECK constraint that includes `'pending'`)
- `runner.ts:60` — `.in('status', ['pending', 'claimed', 'running'])` is for runs, not experiments
- V1 `experimentActions.ts` — separate code path, not called by V2

## Proposed Fix

**Option A (Recommended): Omit status on insert, let DB default work**
- Remove `status: 'pending'` from the INSERT in `createExperiment()` — the DB default `'draft'` handles it
- Change all `'pending'` references in `addRunToExperiment()` to `'draft'`
- Update tests to use `'draft'`
- No migration needed — DB schema is already correct

**Option B: Explicitly set `'draft'`**
- Replace `status: 'pending'` with `status: 'draft'` everywhere
- Same test updates
- More explicit but slightly more code

Option A is preferred because it's impossible for the status to drift from the DB default again.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/request_tracing_observability.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/realtime_streaming.md

### Evolution Pipeline Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- `evolution/src/lib/v2/experiments.ts` — V2 experiment core functions (createExperiment, addRunToExperiment, computeExperimentMetrics)
- `evolution/src/lib/v2/experiments.test.ts` — Unit tests for V2 experiments
- `evolution/src/lib/v2/runner.ts` — V2 run execution lifecycle (confirmed runs use 'pending' correctly)
- `evolution/src/services/experimentActionsV2.ts` — V2 server action wrappers
- `evolution/src/services/experimentActions.ts` — V1 experiment actions (separate code path)
- `supabase/migrations/20260315000001_evolution_v2.sql` — V2 schema migration (defines 'draft' status)
- `supabase/migrations/20260309000001_archive_improvements.sql` — V1 status constraint (had 'pending')
- `supabase/migrations/20260303000001_flatten_experiment_model.sql` — V1 flatten migration
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — Original V1 experiment tables
- `supabase/migrations/20260304000003_manual_experiment_design.sql` — V1 design constraint
