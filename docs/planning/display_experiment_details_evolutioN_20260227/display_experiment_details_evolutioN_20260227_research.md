# Display Experiment Details Evolution Research

## Problem Statement
Add a new page/feature to display detailed experiment information in the evolution admin UI. Currently, the experiment system has ExperimentStatusCard and ExperimentHistory components on the optimization dashboard, but there is no dedicated detail page for drilling into individual experiments. This project will create a dedicated experiment detail page showing comprehensive experiment data including rounds, runs, factor analysis results, and status progression.

## Requirements (from GH Issue #586)
- [ ] Show experiment ID under experiment history module on ratings optimization > experiments > experiment history
- [ ] This should link to a new experiment details view
- [ ] Experiment detail view should show all available details - e.g. runs called, experiment conclusion (newly generated, see below)
- [ ] Experiment should have built in analysis at the end - summarize data findings. Figure out a way to analyze and write this into a report that can be viewed

## High Level Summary

The experiment system already has substantial infrastructure: DB tables (`evolution_experiments`, `evolution_experiment_rounds`), server actions (`experimentActions.ts`), analysis engine (`analysis.ts`), and UI components (`ExperimentHistory`, `ExperimentStatusCard`, `ExperimentForm`). However:

1. **No experiment ID shown in history** — `ExperimentHistory` renders experiment names/status but does not display the ID
2. **No dedicated detail page** — No route at `/admin/quality/optimization/experiment/[id]` exists
3. **Analysis data exists but is raw JSON** — Round analysis results and terminal `results_summary` are stored as JSONB but displayed as raw JSON in the UI
4. **No generated report** — There is no LLM-generated or formatted human-readable analysis report

The existing `getExperimentStatusAction` already returns rich data (rounds, run counts, analysis results, factor rankings). The analysis engine (`analyzeExperiment()`) computes main effects, interactions, factor rankings, and recommendations. The gap is purely on the **display** and **report generation** side.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/article_detail_view.md — Pattern for detail pages (article/variant)
- evolution/docs/evolution/strategy_experiments.md — Experiment system architecture
- evolution/docs/evolution/visualization.md — Dashboard routes and component patterns
- evolution/docs/evolution/data_model.md — Core primitives and DB schema
- evolution/docs/evolution/reference.md — Key files, config, testing
- evolution/docs/evolution/cost_optimization.md — Strategy configs and cost tracking
- All other evolution docs (architecture, agents, hall of fame, rating)

## Code Files Read

### UI Components
- `src/app/admin/quality/optimization/page.tsx` — Main optimization dashboard with 5 tabs, Experiments tab hosts ExperimentForm + ExperimentStatusCard + ExperimentHistory. Client component with `activeExperimentId` state. No sub-routes exist under this directory.
- `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx` — Expandable experiment list. Shows name, status dot (colored circle), round progress, budget, creation date. Expandable rows show per-round details with run counts. Does NOT display experiment ID. No links to detail page. Uses `listExperimentsAction` for initial load, `getExperimentStatusAction` on expand.
- `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` — Active experiment status card with auto-refresh (15s). Shows status, round progress, budget bars, rounds table, raw results JSON via `JSON.stringify(status.resultsSummary, null, 2)` in a `<pre>` element. StatusBadge with 9 state mappings. ProgressBar component for budget/runs. Cancel button for active states.
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — Experiment creation form with factor checkboxes, prompt selection, budget/target/rounds inputs, debounced server validation preview.

### Detail Page Patterns (for reference)
- `src/app/admin/quality/evolution/article/[explanationId]/page.tsx` — Article detail page: async server component, uses `params: Promise<{explanationId: string}>`, fetches overview via server action, returns `notFound()` on invalid data. Renders EvolutionBreadcrumb + ArticleOverviewCard + ArticleDetailTabs.
- `src/app/admin/quality/evolution/article/[explanationId]/ArticleDetailTabs.tsx` — Client component with `useState<TabId>`. Tab buttons with gold underline active state. Lazy-loads tab content components conditionally.
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — Variant detail page: same server component pattern (overview card + content sections).
- `evolution/src/components/evolution/EvolutionBreadcrumb.tsx` — Breadcrumb nav with `BreadcrumbItem[]` (label + optional href).
- `src/components/admin/EvolutionSidebar.tsx` — Sidebar with 4 nav groups. No experiment-specific nav item exists.
- `evolution/src/lib/utils/evolutionUrls.ts` — URL builders including `buildRunUrl(runId)`.

### Server Actions
- `evolution/src/services/experimentActions.ts` — 6 actions: `validateExperimentConfigAction`, `startExperimentAction`, `getExperimentStatusAction`, `listExperimentsAction`, `cancelExperimentAction`, `getFactorMetadataAction`. Key types: `ExperimentSummary` (id, name, status, currentRound, maxRounds, totalBudgetUsd, spentUsd, createdAt), `ExperimentStatus` (adds optimizationTarget, convergenceThreshold, factorDefinitions, prompts, resultsSummary, rounds[]).

### Analysis Engine
- `evolution/src/experiments/evolution/analysis.ts` — `analyzeExperiment()`, `computeMainEffects`, `computeFullFactorialEffects`, `computeInteractionEffects`, `rankFactors`, `generateRecommendations`. Returns `AnalysisResult` with mainEffects, interactions, factorRanking, recommendations, warnings, completedRuns, totalRuns.
- `evolution/src/experiments/evolution/factorial.ts` — L8 design generation, full-factorial design, factor-to-pipeline mapping. `DEFAULT_ROUND1_FACTORS` defines 5 factors.
- `evolution/src/experiments/evolution/factorRegistry.ts` — Type-safe factor definitions with validate, getValidValues, orderValues, expandAroundWinner methods
- `evolution/src/experiments/evolution/experimentValidation.ts` — Multi-stage validation: guards → registry → L8 → config → strategy → run → cost estimation

### Cron & Infrastructure
- `src/app/api/cron/experiment-driver/route.ts` — State machine cron (every minute, up to 5 experiments). Three active state handlers: `handleRoundRunning`, `handleRoundAnalyzing`, `handlePendingNextRound`. `writeTerminalState()` builds `results_summary` JSONB with bestElo, bestConfig, bestStrategyId, factorRanking, recommendations, finalRound, terminationReason. This is the best hook point for report generation.

### Database
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — Creates `evolution_experiments` and `evolution_experiment_rounds` tables. `results_summary` JSONB on experiments, `analysis_results` JSONB on rounds.

## Key Findings

### 1. ExperimentHistory Does Not Show Experiment ID
The `ExperimentHistory` component iterates over `ExperimentSummary[]` but only renders: name, status dot (colored circle), round progress, budget, creation date. The `id` field is available in the data but not displayed.
- **Insertion point**: Make the experiment name a clickable `<Link>` pointing to `/admin/quality/optimization/experiment/${exp.id}` and show truncated ID below it
- The component uses `listExperimentsAction` for initial load and `getExperimentStatusAction` on expand — both return `id`

### 2. No Detail Page Route Exists
There is no route at `/admin/quality/optimization/experiment/[experimentId]`. No directory structure exists under `optimization/` for sub-routes. Current navigation is inline on the optimization dashboard:
- User creates experiment → `onStarted` callback sets `activeExperimentId` → `ExperimentStatusCard` mounts
- History shows expandable rows, but no deep-link to a dedicated page

### 3. `getExperimentStatusAction` Already Returns Rich Data
The `ExperimentStatus` type includes: id, name, status, optimization target, budget, max rounds, current round, convergence threshold, factor definitions, prompts, results summary, error message, and rounds with run counts. This is sufficient for a detail page — no new server actions needed for the overview.

### 4. Analysis Results Are Available But Displayed as Raw JSON
Each completed round stores `analysis_results` (JSONB) containing: mainEffects, interactions, factorRanking, recommendations, warnings, completedRuns, totalRuns. The terminal experiment stores `results_summary` with: bestElo, bestConfig, bestStrategyId, factorRanking, recommendations, finalRound, terminationReason.
- **Current rendering**: `ExperimentStatusCard` uses literal `JSON.stringify(status.resultsSummary, null, 2)` in a `<pre>` element
- This is the primary UX gap to address — structured rendering with tables and charts

### 5. Missing: Runs List for an Experiment
`getExperimentStatusAction` returns run counts per round but NOT the individual runs. To show "runs called" on the detail page, we need a new server action.
- **FK chain**: experiment → rounds (via `experiment_id`) → `batch_run_id` → `evolution_batch_runs` → `evolution_runs` (via `batch_run_id`)
- Runs also carry `config._experimentRow` for L8 row mapping
- `buildRunUrl(runId)` exists in `evolutionUrls.ts` for linking to run detail pages

### 6. Report Generation — Hybrid Approach (Template + LLM)
The `AnalysisResult` from `analysis.ts` contains structured data (main effects, factor rankings, recommendations) but no prose report. Decision: **Hybrid approach**.

- **Rounds tab**: Template-based rendering (tables, stat cards) — deterministic, instant, $0 cost
- **Report tab**: LLM-generated narrative via `callLLM()` — richer analysis with actionable insights

**LLM infrastructure already exists** in codebase:
- `callLLM()` in `src/lib/services/llms.ts` — multi-provider (OpenAI, Anthropic, DeepSeek)
- Structured output via Zod schemas supported
- Cost tracking in `llmCallTracking` table with `call_source` field
- Existing patterns: `explanationSummarizer.ts` uses `callLLM` with `LIGHTER_MODEL`

**Model choice**: `gpt-4.1-nano` (~$0.001/report) — fast, cheap, sufficient for structured data analysis

**No migration needed**: Cache LLM report in `results_summary.report` JSONB field. No schema changes.

**Generation timing**: Auto-generate in `writeTerminalState()` cron with fire-and-forget. `gpt-4.1-nano` responds in 1-3s. `writeTerminalState()` only fires at experiment termination (~once per hour max). If LLM call fails, log error and continue — experiment completion never blocked. Manual regeneration available via server action.

### 6b. Data Access for Report Generation
**No readonly pg connection needed.** The existing `createSupabaseServiceClient()` (service role key) already has full read access to all tables. This is the same client used by all experiment server actions.

**Proven multi-table aggregation patterns exist:**
- `articleDetailActions.ts` — parallel queries with `Promise.all()`, FK chain navigation
- `costAnalyticsActions.ts` — cost aggregation with grouping and statistics
- `eloBudgetActions.ts` — agent metrics aggregation across runs

**Data the report action will gather:**
1. Experiment metadata + rounds + analysis results (via existing `getExperimentStatusAction`)
2. Individual runs with Elo, costs, configs (FK chain: rounds → batch_run_id → runs)
3. Agent metrics per run (`evolution_run_agent_metrics` table — agent_name, cost_usd, elo_gain, elo_per_dollar)

**Why not a separate readonly connection or agent?**
- `query:prod` is CLI-only (`scripts/query-prod.ts`) — no server-side utility exists
- `pg` connection lifecycle is tricky in Vercel serverless (cold starts, connection pooling)
- Supabase service client already works everywhere in the codebase
- Safety comes from `requireAdmin()` + `withLogging()` + no mutations (beyond caching)

### 7. Article Detail Page Pattern (Reference Implementation)
Studied the article detail page at `/admin/quality/evolution/article/[explanationId]` in depth:
- **Server component** (`page.tsx`): Async, uses `params: Promise<{explanationId: string}>`, fetches overview via server action, returns `notFound()` on invalid data
- **Client tabs** (`ArticleDetailTabs.tsx`): `useState<TabId>`, tab buttons with gold underline active state, lazy-loads tab content conditionally
- **Layout**: EvolutionBreadcrumb → Overview Card → Tabs
- **Styling**: CSS variables (`--accent-gold`, `--surface-secondary`, `--text-primary`), `paper-texture` class, `font-display`/`font-ui` typography, `rounded-page` border radius

### 8. Database Schema Summary

**`evolution_experiments`** columns: id, name, status (9 states: pending, round_running, round_analyzing, pending_next_round, converged, budget_exhausted, max_rounds, failed, cancelled), optimization_target, total_budget_usd, spent_usd, max_rounds, current_round, convergence_threshold, factor_definitions (JSONB), prompts (TEXT[]), config_defaults (JSONB), results_summary (JSONB), error_message, created_at, updated_at, completed_at.

**`evolution_experiment_rounds`** columns: id, experiment_id (FK), round_number, type (screening/refinement), design (L8/full-factorial), factor_definitions (JSONB), locked_factors (JSONB), batch_run_id (FK), analysis_results (JSONB), status, created_at, completed_at.

**`evolution_runs`** link: runs have `batch_run_id` FK → `evolution_batch_runs.id`, rounds have `batch_run_id` FK → same table. Runs also carry `config._experimentRow` for L8 row mapping.

### 9. Visualization Patterns Available
- **Recharts** already used with dynamic imports and SSR disabled (via `next/dynamic` with `ssr: false`)
- **Stat cards**: Existing patterns with colored borders and metric values
- **Bar/line charts**: Recharts with CSS variable colors, responsive containers
- **No markdown rendering library** currently installed — report should use structured HTML/React components, not markdown

### 10. Cron State Machine — Report Hook Point
The experiment-driver cron's `writeTerminalState()` function is the ideal place to generate analysis reports:
1. It already has access to all rounds and their `analysis_results`
2. It already builds the `results_summary` JSONB with bestElo, bestConfig, factorRanking, recommendations
3. It runs only once at experiment termination (converged, budget_exhausted, max_rounds)
4. Adding a `report` field to `results_summary` would require no schema changes
5. Alternative: render the report entirely client-side from existing structured data (simpler, no cron changes)

### 11. Component Hierarchy for Detail Page

```
/admin/quality/optimization/experiment/[experimentId] (new page)
├── Breadcrumbs: Rating Optimization > Experiment Detail
├── ExperimentOverviewCard (new)
│   ├── Name, ID (copyable), status badge, dates (created, completed)
│   ├── Budget progress bar (reuse ProgressBar pattern from ExperimentStatusCard)
│   ├── Optimization target, convergence threshold
│   ├── Factor definitions table
│   └── Prompts list
├── ExperimentDetailTabs (new, client component)
│   ├── Rounds — Per-round cards with structured analysis (main effects table, factor rankings, recommendations)
│   ├── Runs — All runs across rounds with Elo scores and links to run detail
│   └── Report — LLM-generated narrative analysis (on-demand, cached in results_summary.report)
└── Footer actions (cancel if active, back to dashboard)
```

## Open Questions (Resolved)

1. **Report generation approach** — ~~Template-based for v1~~ → **Hybrid**: template for Rounds tab, LLM narrative for Report tab. ~$0.001/report with `gpt-4.1-nano`.
2. **Run detail linking** — **Yes** — `buildRunUrl(runId)` already exists in `evolutionUrls.ts`.
3. **Sidebar navigation** — **No** — keep navigation through Optimization dashboard. Experiments are a sub-feature, not a top-level nav item.
4. **Chart library scope** — **Tables + stat cards only for v1**. Recharts charts can be added as a follow-up.
5. **Data access for reports** — **Supabase service client** (existing). No readonly pg connection or agent needed.
6. **Report generation timing** — **Auto-generate** in `writeTerminalState()` cron with fire-and-forget. `gpt-4.1-nano` is fast enough (~2-3s). Manual regeneration as fallback.
