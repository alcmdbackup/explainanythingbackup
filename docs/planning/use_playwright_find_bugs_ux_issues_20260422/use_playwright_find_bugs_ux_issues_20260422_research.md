# Use Playwright Find Bugs UX Issues Research

## Problem Statement
Use Playwright MCP to systematically explore the Evolution admin dashboard and find as many bugs and UX issues as possible.

## Requirements (from GH Issue #1005)
Look at Evolution admin dashboard and use Playwright to look for 100 bugs and UX issues to solve.

## High Level Summary

### Methodology

1. **Auth setup.** Seeded the existing `TEST_USER_EMAIL` (`abecha@gmail.com`) into `admin_users` via `npx tsx scripts/seed-admin-test-user.ts`.
2. **Surface walk.** Drove a real browser via Playwright MCP through every reachable evolution admin route:
   - `/admin/evolution-dashboard`
   - `/admin/evolution/runs` (incl. status filter, strategy filter, hide-test toggle, all 14 columns, pagination, failed-status view)
   - `/admin/evolution/runs/[id]` — Timeline, Metrics, Cost Estimates, Variants, Logs tabs
   - `/admin/evolution/start-experiment` — all three wizard steps (no run created)
   - `/admin/evolution/arena` topics list + `/admin/evolution/arena/[topicId]` detail (Federal Reserve 2)
   - `/admin/evolution/prompts`
   - `/admin/evolution/strategies/new`
   - `/admin/evolution/tactics`
   - `/admin/evolution/invocations`
   - `/admin/evolution/variants`
3. **Capture.** For each page: accessibility snapshot, console messages (errors + warnings), and inspected interactive widgets.
4. **First-pass classification.** 22 "bugs" + 30 "UX issues" = 52 findings into `test-results/user-testing/findings.md`.
5. **Source-code audit (3 passes).** Two `Explore` agents and a self-pass cross-checked every finding against the actual code path. False positives dropped, root causes pinned.

### Outcome

- **9 confirmed bugs** (8 firm + 1 partial — B14)
- **28 UX issues** (P2/P3, code-confirmed or judgment calls; 3 more dropped during planning as intentional behavior or snapshot artifacts — see `_planning.md` "Considered and dropped")
- **15 first-pass findings dropped as false positives** during the bug+UX audits (with code refs in `_progress.md`)

User asked for 100 findings; honest yield is **37 actionable items** with verified root causes.

### Reading guide for fixers

The `_progress.md` doc has the complete catalogue. Each item has:
- Severity (P1 = broken/blocked · P2 = visible glitch/friction · P3 = nit)
- Symptom I observed
- Code reference (`file:line`) for the root cause where applicable
- Suggested fix

Two systemic patterns drive ~6 of the 9 confirmed bugs and several UX issues:

- **Test-content filter scope gap.** `applyTestContentNameFilter` in `evolution/src/services/shared.ts:103-109` filters only three literal substrings (`[TEST]`, `[E2E]`, `[TEST_EVO]`) and omits the `/^.*-\d{10,13}-.*$/` timestamp regex that `isTestContentName` already exports. Entities without an `is_test_content` column (prompts, arena topics) leak `e2e-*` test rows. Fixing the JS filter clears B17 + several UX surfaces.
- **Cost-metric population gap.** Some completed runs lack a `cost` row in `evolution_metrics` (only `generation_cost` / `ranking_cost` rows exist). The dashboard falls back to summing `evolution_agent_invocations.cost_usd`; the runs list does not. This drives B1 + B2.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/agents/overview.md
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/sample_content/api_design_sections.md
- evolution/docs/sample_content/filler_words.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- docs/feature_deep_dives/user_testing.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md

## Code Files Read (during audit)

Service / data layer:
- `evolution/src/services/shared.ts` — `isTestContentName`, `applyTestContentNameFilter`
- `evolution/src/services/evolutionActions.ts` — `listVariantsAction` (B6 root cause at :763)
- `evolution/src/services/evolutionVisualizationActions.ts` — `getEvolutionDashboardDataAction` (B1)
- `evolution/src/services/strategyRegistryActions.ts` — `listStrategiesAction` (B3)
- `evolution/src/services/costEstimationActions.ts` — Estimation Error % formula (B7)
- `evolution/src/services/logActions.ts:65` — log sort (B13)
- `evolution/src/lib/metrics/computations/finalization.ts` — cost metric writes
- `evolution/src/lib/metrics/metricColumns.tsx` — runs-list column generation

UI components:
- `src/app/admin/evolution-dashboard/page.tsx` — dashboard, recent runs, quick links
- `src/app/admin/evolution/runs/page.tsx` — runs list, strategy filter call
- `src/app/admin/evolution/runs/[runId]/page.tsx` — run detail tabs
- `src/app/admin/evolution/variants/page.tsx` — variants list (B5 wrapping)
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — wizard (B12, U13)
- `evolution/src/components/evolution/tables/RunsTable.tsx` — runs Spent column (B2)
- `evolution/src/components/evolution/variant/VariantParentBadge.tsx` — parent rendering (B5, B9)
- `evolution/src/components/evolution/primitives/StatusBadge.tsx` — "Failed (has errors)" label (U5)
- `evolution/src/components/evolution/EntityListPage.tsx` — pagination + getRowHref (U30, B5)
- `evolution/src/components/evolution/AutoRefreshProvider.tsx` — RefreshIndicator (U2)
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — metrics rendering
- `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` — coverage column (U11)
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — star icon (U9)

Schema / migrations:
- `supabase/migrations/20260415000001_evolution_is_test_content.sql` — trigger / regex

## Confidence

- B1 root cause is approximate; symptom is mathematically wrong and reproducible, but a runtime trace would tighten the explanation.
- B14 partial: 0.2s gap is rounding, the 3s drift between `153.x s` cards and `2m 37s` is two clock sources.
- The audit caught 15 false positives in two passes — there is residual risk of more in the UX items I marked "judgment call". Fix authors should sanity-check before committing.

## Out of scope for this exploration

Not covered (would yield more findings on a follow-up):
- Lineage tab D3 graph
- Snapshots tab
- Elo chart
- Individual variant detail
- Individual invocation detail
- Edit dialogs
- Keyboard accessibility (tab order, focus visible, aria-current)
- Narrow-viewport rendering (mobile, < 800px)
