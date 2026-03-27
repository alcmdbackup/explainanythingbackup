# Adhoc Evolution Testing Research

## Problem Statement
The evolution admin dashboard (15+ pages) had no systematic exploratory testing. We ran 16 parallel Playwright agents across 4 rounds to find bugs, UX issues, and accessibility problems. Found 67 issues total; this project fixes the P0 (5) and P1 (22) issues.

## Requirements (from GH Issue #826)
- Fix all P0 critical bugs (5 items)
- Fix all P1 medium bugs (9 items) and medium UX issues (13 items)
- Run lint, tsc, build, and unit tests after each phase
- Write unit tests for fixed code

## High Level Summary

### P0 Critical Bugs (5)
1. **Row action buttons broken** — Edit/Archive/Delete on registry pages navigate to detail instead of performing action. `EntityTable.tsx` wraps entire row in `<Link>`, `e.stopPropagation()` doesn't prevent `<a>` navigation.
2. **Strategy budget never displays** — `StrategyConfigDisplay.tsx:80` checks `budgetCapUsd` but schema field is `budgetUsd`.
3. **Strategy 404 leaks raw DB error** — `strategyRegistryActions.ts:90` throws raw Supabase error instead of friendly message.
4. **Dashboard cost metrics wrong** — `evolutionVisualizationActions.ts:90` cost query has no filters but status counts are filtered; avg cost divides mismatched populations.
5. **Dashboard Recent Runs hardcodes budget/explanation** — `evolution-dashboard/page.tsx:71,75` sets `budget_cap_usd: 0` and `explanation_id: null`.

### P1 Medium Bugs (9)
6. "Hide test content" inconsistent on Experiments/Strategies pages
7. Prompt cross-link shows raw UUID, links to list not detail
8. Run/arena 404 shows inline error (no navigation) vs variants/experiments using `notFound()`
9. Duplicate "Runs" column on strategies list
10. Dashboard status counts include archived; Recent Runs excludes them
11. `mu.toFixed(1)` crash risk on null in arena leaderboard
12. Whitespace-only prompt names accepted
13. Redundant "Experiment" breadcrumb segment
14. *(Sidebar mobile collapse is P0 but deferred — requires significant layout redesign)*

### P1 Medium UX (13)
15. Table columns truncated (runs, strategies, prompts)
16. Experiment name truncated in header
17. Leaderboard rank positional not Elo-based
18. Default sort direction always ascending (wrong for Elo/Mu)
19. Null costs sort to top in descending
20. Variant preview single-expand only
21. Run detail missing cost metric
22. No Runs tab on strategy detail
23. Invocations "Run ID" column links to invocation detail
24. Wizard review doesn't show selected prompt
25. Wizard stepper labels not clickable
26. Logs expanded context disconnected from row
27. Match history component exists but unused on variant detail

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- All 14 evolution docs (README through agents/overview)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md

## Code Files Read
- `evolution/src/components/evolution/EntityTable.tsx` — row Link wrapping (lines 81-101)
- `evolution/src/components/evolution/RegistryPage.tsx` — action buttons, stopPropagation (lines 104-128)
- `evolution/src/services/evolutionVisualizationActions.ts` — dashboard queries (lines 74-105)
- `src/app/admin/evolution-dashboard/page.tsx` — recentRuns mapping (lines 70-80)
- `src/app/admin/evolution/runs/[runId]/page.tsx` — prompt link (line 81-83), 404 handling (lines 58-59)
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — sort logic (49-56), null risk (173-174), 404 (95-100)
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — budgetCapUsd mismatch (line 80)
- `evolution/src/lib/schemas.ts` — v2StrategyConfigSchema budgetUsd (line 288)
- `evolution/src/services/strategyRegistryActions.ts` — raw error throw (line 90)
- `src/app/admin/evolution/strategies/page.tsx` — duplicate Runs column (line 41, 44)
- `src/app/admin/evolution/experiments/[experimentId]/page.tsx` — breadcrumb (lines 22-28)
- `evolution/src/services/arenaActions.ts` — createPromptSchema whitespace (min(1))
- `evolution/src/components/evolution/FormDialog.tsx` — no validate prop usage
- `evolution/src/components/evolution/RunsTable.tsx` — budget progress bar (lines 111-117)
- `evolution/src/lib/core/metricCatalog.ts` — run_count metric listView:true (line 66-67)
