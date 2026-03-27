# Systematic Fix Data Wrong Missing Issues Evolution Research

## Problem Statement
Our existing approach to managing data & migrations works poorly. Frequent bugs due to data mismatches between staging vs. code, failed tests, etc. I want a systematic approach to solve this.

## Requirements (from GH Issue #844)
[To be refined based on research findings — detailed requirements below]

## High Level Summary

Research across 3 rounds (12 agents) reveals a systemic problem: **the evolution pipeline lacks automated mechanisms to keep SQL schema, TypeScript types, test data, and environment state in sync.** The codebase relies entirely on developer discipline for schema coordination, and this has produced 40+ data-related bug-fix commits in the last 2 months.

The root causes cluster into 5 categories:
1. **No schema drift detection** — Zod schemas are manually maintained, Supabase client is untyped (`any`), no CI check compares TS types to DB
2. **Column/table renames cascade across 50+ files** — each rename generates 3+ follow-up fix commits
3. **Staging/prod schema divergence** — shared dev/staging DB, no automated schema comparison before prod deploy
4. **Test data fragility** — hardcoded column names, incomplete cleanup, fire-and-forget timing assumptions
5. **Missing database constraints** — 3 FKs lost in V2 migration, no agent_name enum, no variant count limits

## Key Findings

### Finding 1: CI Failures Are Overwhelmingly Schema Mismatches

Out of 20 recent CI failures (Mar 23-26):
- **4 runs** blocked by missing `evolution_run_costs` view and `get_run_total_cost` RPC (actively blocking Mar 26 production release)
- **2 runs** failed due to Zod UUID validation (test fixtures use non-UUID strings)
- **5 runs** failed from migration deployment issues (duplicate timestamps, stale files)
- **4 runs** failed from E2E `DYNAMIC_SERVER_USAGE` errors (not data-related)
- **2 runs** failed from lint rule issues

The schema mismatch failures are the **top blocker for releases**.

### Finding 2: 40+ Data-Related Bug-Fix Commits in History

Categorized by severity:

**Critical (caused production/staging outages):**
- `4783993c` — Hardcoded `"legacy-runId"` as runner ID, causing `persistRunResults` WHERE clause to match 0 rows. **Killed all runs on staging.**
- `ff398595` — Duplicate FK constraints on `evolution_runs.strategy_id` caused PostgREST PGRST201 (HTTP 300). **Silently returned 0 results on all filter queries.**
- `40e09926` — 350x wrong cost estimation rates. 14 systemic cost issues.

**High (broke multiple features):**
- `96f97f18` — 11 references to dropped V1 tables, 11 files importing V1 actions instead of V2. 30 files changed, -2062 lines.
- `342ed974` — 7 E2E specs seeded V1-only columns that no longer existed in V2.
- `3602469e` — 48 bugs in evolution admin dashboard (filter loops, wrong counts, empty fields).

**Recurring patterns:**
- Column renames (`title`→`name`, `topic_id`→`prompt_id`) not propagated: at least 6 separate fix commits
- PostgREST-specific query issues (ambiguous columns, duplicate FKs, URL size limits): 3+ incidents
- V1→V2 stale column references: persisted across 6+ fix commits spanning weeks

### Finding 3: No Automated Schema Drift Detection

- **Supabase generated types have NEVER been used** — no `database.types.ts`, no `supabase gen types` in scripts or CI
- **Supabase client is completely untyped** — all `.from('table')` calls return `any`
- **20+ `as` type casts** in evolution service files, each a silent drift point
- **Each service file defines its own local interfaces** (`ArenaTopic`, `ArenaEntry`, `EvolutionRun`) — no shared type source
- **No CI step validates TypeScript schemas match database schema**
- TypeScript strict mode catches code-level type errors but NOT database mismatches

### Finding 4: Column Renames Generate Cascading Multi-Commit Bug Chains

| Rename | Initial Commit Files | Follow-up Fix Files | Fix Commits Needed |
|--------|---------------------|--------------------|--------------------|
| Tables + FK columns (Mar 20) | 56 files | 2 + 6 files + 200-line convergence SQL | 4+ |
| `title` → `name` (Mar 24) | 59 files | 12 + 4 + 158 (restore) | 3+ |

Current state: **TypeScript source is clean** (no stale references found). One doc staleness: `evolution/docs/metrics.md:101` still lists `arena_topic` as valid entity type.

### Finding 5: Test Infrastructure Has Structural Fragility

**Integration tests (17 files, 2848 lines):**
- Fire-and-forget logging pattern uses `setTimeout(200ms)` — race condition in CI
- Hardcoded column names in `.insert()` and `.select()` — break on rename
- Numeric precision assumptions (`.toBeCloseTo(0.05, 4)`) — fragile
- Missing RPC validation — tests silently skip when RPCs don't exist

**E2E tests (18 specs):**
- Incomplete cleanup: only 2 of 18 specs clean `evolution_metrics` rows
- Mixed cleanup patterns: some delete by `prompt_id`, others by `run_id`
- Silent cleanup failures: `cleanupEvolutionData()` swallows all errors
- 11 specs use serial mode with timestamp-based isolation (no true transaction isolation)

**E2E seed data:**
- `[TEST]` prefix convention for UI filtering but no namespace enforcement
- ID tracking via `/tmp/e2e-tracked-evolution-ids-worker-*.txt` but not all specs use it

### Finding 6: Staging/Prod Environment Management Has Gaps

- **Shared dev/staging database** — local dev, CI, Vercel previews all share one Supabase instance
- **No staging-to-prod schema comparison gate** — schema divergence undetected until migration fails
- **No automatic rollback** — workflow header explicitly states migrations are NOT auto-rolled back
- **`supabase db reset` is broken locally** — fresh schema migration depends on deleted prior migrations
- **Manual production promotion** — requires manual push to `production` branch

**What works well:**
- Migration timestamp reordering on PRs (auto-renumbers out-of-order files)
- Orphan repair in migration workflow (handles deleted files)
- Dry-run step previews migrations before applying
- Post-deploy smoke tests catch issues after production deployment

### Finding 7: Existing Guardrails Are Good but Have Critical Gaps

**Strong:**
- Zod schema validation on all 10 entity types (strict mode on run summaries)
- RLS deny-all default on all evolution tables with service_role bypass
- Pre-commit hooks: secret scanning, `@ts-ignore` blocking, migration timestamp validation
- Atomic claiming via `FOR UPDATE SKIP LOCKED`
- Budget enforcement with reserve-before-spend pattern

**Missing:**
- No runtime schema drift detection (TS types vs actual DB)
- No pre-execution config validation (strategy/prompt existence not checked before pipeline starts)
- 3 missing FKs: `evolution_runs.evolution_explanation_id`, `evolution_experiments.evolution_explanation_id`, `evolution_explanations.prompt_id`
- No evolution-specific health checks in `/api/health`
- No agent_name enum constraint (free text, 200 char max)
- No variant/invocation count limits at DB level

## Root Cause Analysis

The fundamental issue is **absence of automated schema-to-code synchronization**. Each schema change requires manual updates to:
1. SQL migration file
2. Zod schemas in `evolution/src/lib/schemas.ts`
3. Local TypeScript interfaces in each service action file
4. Test fixtures and factories (3 separate locations)
5. E2E seed data
6. Documentation

With 10 tables, 260+ fields, 50+ server actions, 17 integration tests, and 18 E2E specs, the surface area for manual drift is enormous. The V2 migration amplified this by touching every table simultaneously.

## Proposed Requirements

Based on research findings, the systematic fix should address:

1. **Schema drift prevention** — Add Supabase generated types + CI validation
2. **Type safety at query boundaries** — Wire generated `Database` type into Supabase clients
3. **Test data robustness** — Factory-based test data that derives from schemas, not hardcoded columns
4. **Environment alignment** — Schema comparison between staging and prod before deploy
5. **Missing constraints** — Add the 3 lost FKs, agent_name enum, explanation integrity
6. **Active CI blockers** — Fix the `evolution_run_costs` view issue and Zod UUID test fixtures
7. **Documentation accuracy** — Fix stale `arena_topic` reference in metrics.md

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/environments.md

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/cost_optimization.md
- evolution/docs/metrics.md
- evolution/docs/entities.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md

### CI/CD & Infrastructure
- .github/workflows/ci.yml
- .github/workflows/supabase-migrations.yml
- .github/workflows/migration-reorder.yml
- .github/workflows/post-deploy-smoke.yml
- .githooks/pre-commit
- supabase/migrations/EVOLUTION_HISTORY.md

## Code Files Read

### Schema & Types
- evolution/src/lib/schemas.ts — 10 entity Zod schemas, run summary V1/V2/V3
- evolution/src/lib/types.ts — Core type definitions (Variant, Rating, Match, etc.)
- evolution/src/lib/schemas.test.ts — Schema validation tests

### Migration Files
- supabase/migrations/20260322000006_evolution_fresh_schema.sql — Idempotent staging documentation
- supabase/migrations/20260322000007_evolution_prod_convergence.sql — 407-line prod convergence
- supabase/migrations/20260323000003_evolution_metrics_table.sql — Metrics EAV table
- supabase/migrations/20260324000001_entity_evolution_phase0.sql — title→name rename
- supabase/migrations/20260325000001_*.sql — Duplicate FK fix
- supabase/migrations/20260326000001_*.sql — Unarchive after archive removal

### Supabase Client
- src/lib/utils/supabase/client.ts — Browser client (untyped)
- src/lib/utils/supabase/server.ts — Server client (untyped)
- src/lib/supabase.ts — Legacy client (untyped)

### Service Actions
- evolution/src/services/arenaActions.ts
- evolution/src/services/evolutionActions.ts
- evolution/src/services/experimentActions.ts
- evolution/src/services/invocationActions.ts
- evolution/src/services/strategyRegistryActions.ts
- evolution/src/services/metricsActions.ts
- evolution/src/services/adminAction.ts
- evolution/src/services/shared.ts

### Test Infrastructure
- evolution/src/testing/evolution-test-helpers.ts — DB factories and cleanup
- evolution/src/testing/schema-fixtures.ts — Zod-validated fixtures
- evolution/src/testing/service-test-mocks.ts — Supabase mock utilities
- src/__tests__/e2e/helpers/evolution-test-data-factory.ts — E2E factories
- src/__tests__/e2e/setup/global-setup.ts — E2E global setup
- src/__tests__/integration/evolution-*.ts — 17 integration test files

### Pipeline Core
- evolution/src/lib/pipeline/claimAndExecuteRun.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/core/entityRegistry.ts
- evolution/src/lib/shared/enforceVariantFormat.ts

### Operational
- evolution/src/lib/ops/watchdog.ts
- src/app/api/health/route.ts
- src/app/api/evolution/run/route.ts
- supabase/config.toml

## Open Questions

1. **Scope decision**: Should we fix only evolution tables or also extend Supabase generated types to main app tables?
2. **Migration strategy for generated types**: Big-bang or incremental rollout? Wire into all clients at once or start with evolution services only?
3. **CI performance**: Will adding `supabase gen types` to CI add significant time? Need local Supabase or can introspect remote?
4. **Test data approach**: Replace all hardcoded inserts with schema-derived factories, or just fix the broken ones?
5. **Prod convergence recurrence**: Is another major schema restructuring planned that would need convergence migrations?
