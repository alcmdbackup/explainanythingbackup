# Adhoc Evolution Testing Progress

## Summary
4 rounds of 4 parallel agents each (16 agents total) explored the evolution admin dashboard. Found **~60 unique issues** across bugs, UX problems, accessibility, responsive layout, and data accuracy.

## All Issues by Priority

### P0 — Critical / High

| # | Type | Issue | File(s) |
|---|------|-------|---------|
| 1 | Bug | **Row action buttons (Edit/Archive/Delete) navigate away instead of performing action** — `<Link>` wraps entire row including action buttons, `e.stopPropagation()` doesn't prevent `<a>` navigation | `EntityTable.tsx:88-96`, `RegistryPage.tsx:111-125` |
| 2 | Bug | **Sidebar never collapses on mobile** — fixed `w-64` (256px) consumes 68% of 375px viewport, all mobile pages unusable | `BaseSidebar.tsx:63`, `admin/layout.tsx` |
| 3 | Bug | **Strategy budget field never displays** — config stores `budgetUsd` but display checks `budgetCapUsd` (field name mismatch) | `StrategyConfigDisplay.tsx:80`, `schemas.ts:288` |
| 4 | Bug | **Strategy detail 404 exposes raw database error** — shows `"JSON object requested, multiple (or no) rows returned"` instead of friendly error | Strategy detail page |
| 5 | Bug | **Dashboard Total Cost ignores all filters** — includes test runs and archived runs, while status counts respect filters; Avg Cost divides mismatched populations | `evolutionVisualizationActions.ts:90,103-105` |

### P1 — Medium Bugs

| # | Type | Issue | File(s) |
|---|------|-------|---------|
| 6 | Bug | "Hide test content" filter inconsistent — doesn't filter on Experiments and Strategies pages | Various list pages |
| 7 | Bug | Prompt cross-link shows raw UUID, links to list page not detail | Run detail header |
| 8 | Bug | Run/arena topic detail 404 shows inline error with no navigation (unlike variant detail which uses `notFound()`) | `runs/[runId]/page.tsx`, `arena/[topicId]/page.tsx` |
| 9 | Bug | Duplicate "Runs" column on Strategies list — one from baseColumns, one from metric columns, neither shows data | `strategies/page.tsx:41,44` |
| 10 | Bug | Dashboard Recent Runs hardcodes `budget_cap_usd: 0` and `explanation_id: null` — budget column always $0.00 | `evolution-dashboard/page.tsx:71,75` |
| 11 | Bug | Status counts include archived runs but Recent Runs table excludes them — inconsistent | `evolutionVisualizationActions.ts:74,79-83` |
| 12 | Bug | `mu.toFixed(1)` / `sigma.toFixed(1)` on leaderboard will crash if DB returns null | `arena/[topicId]/page.tsx:173-174` |
| 13 | Bug | Whitespace-only names accepted for prompts (HTML `required` passes spaces) | Prompt create dialog |
| 14 | Bug | Experiment breadcrumb has redundant "Experiment" segment (4 segments vs 3 for all others) | `experiments/[experimentId]/page.tsx:22-29` |

### P1 — Medium UX

| # | Type | Issue | File(s) |
|---|------|-------|---------|
| 15 | UX | Table columns truncated on Runs, Strategies, Prompts — key info hidden off-screen | Multiple list pages |
| 16 | UX | Experiment name truncated in header despite short name and available space | `ExperimentOverviewCard.tsx:46-48` |
| 17 | UX | Leaderboard rank is positional (changes with sort) not Elo-based | `arena/[topicId]/page.tsx:160` |
| 18 | UX | Default sort direction always ascending — wrong for Elo/Mu (should default descending) | `arena/[topicId]/page.tsx:49-55` |
| 19 | UX | Null costs sort to top in descending order (should stay at bottom) | `arena/[topicId]/page.tsx:36-47` |
| 20 | UX | Variant preview is single-expand accordion — can't compare two variants side by side | `VariantsTab.tsx:26` |
| 21 | UX | Run detail missing cost metric section in Metrics tab | Run detail page |
| 22 | UX | No "Runs" tab on strategy detail — can't see which runs used a strategy | Strategy detail page |
| 23 | UX | Invocations list: "Run ID" column links to invocation detail instead of run detail | `EntityTable.tsx:88-99` |
| 24 | UX | Wizard review step doesn't show which prompt was selected | `ExperimentForm.tsx:440-445` |
| 25 | UX | Wizard stepper labels not clickable for back-navigation | `ExperimentForm.tsx:177-192` |
| 26 | UX | Logs: expanded context JSON renders after entire table, disconnected from clicked row | `LogsTab.tsx:211-218` |
| 27 | UX | Match history tab exists as component but is never rendered on variant detail | `VariantMatchHistory.tsx` (unused) |

### P2 — Accessibility

| # | Type | Issue | File(s) |
|---|------|-------|---------|
| 28 | A11y | **Broken `aria-labelledby`** — tab buttons use `data-testid` but tabpanel references `id` | `EntityDetailTabs.tsx:49-72` |
| 29 | A11y | FormDialog/ConfirmDialog missing `role="dialog"`, `aria-modal`, `aria-labelledby` | `FormDialog.tsx:88`, `ConfirmDialog.tsx:42` |
| 30 | A11y | Dialogs don't close on Escape key | FormDialog, ConfirmDialog |
| 31 | A11y | Dialogs don't close on backdrop click | FormDialog, ConfirmDialog |
| 32 | A11y | Dialogs don't trap focus — Tab escapes to elements behind overlay | FormDialog |
| 33 | A11y | No skip navigation link on any admin page | All pages |
| 34 | A11y | Duplicate `<h1>` on every page (sidebar + content) | `BaseSidebar.tsx:66` |
| 35 | A11y | Tablist missing `aria-label` | `EntityDetailTabs.tsx:46` |
| 36 | A11y | Copy-ID button missing `aria-label` | `EntityDetailHeader.tsx:133-144` |
| 37 | A11y | Lineage graph SVG has no `role`, `aria-label`, or `<title>` | `LineageGraph.tsx:150-156` |
| 38 | A11y | Preview/Detail buttons missing `aria-label` (no variant context) | VariantsTab |
| 39 | A11y | EvolutionStatusBadge missing `role="status"` and `aria-label` | `EvolutionStatusBadge.tsx:44-58` |
| 40 | A11y | Experiment wizard inputs not programmatically labeled (`htmlFor`/`id` missing) | `ExperimentForm.tsx:199-283` |
| 41 | A11y | Wizard inputs suppress native focus outline (`focus:outline-none`) | `ExperimentForm.tsx:207,282` |
| 42 | A11y | Rename input in EntityDetailHeader has no `aria-label` | `EntityDetailHeader.tsx:84-95` |
| 43 | A11y | Dashboard table missing `<caption>` and `scope="col"` on `<th>` | Dashboard page |
| 44 | A11y | Pagination buttons lack `aria-label` and active page lacks `aria-current` | `EntityListPage.tsx:177-206` |
| 45 | A11y | Column headers not exposed to a11y tree during initial load (loading skeleton) | Arena topics list |

### P2 — Low UX / Polish

| # | Type | Issue | File(s) |
|---|------|-------|---------|
| 46 | UX | "Explanation" column header misleading on Runs list (shows run IDs) | Runs list |
| 47 | UX | No item count on Prompts and Strategies registry pages | Registry pages |
| 48 | UX | Stale experiments stuck in "running" despite all runs done | Experiments list |
| 49 | UX | `cancelled` and `failed` statuses share identical visual style | `EvolutionStatusBadge.tsx:18-20` |
| 50 | UX | Tailwind opacity modifiers on CSS custom variables may not work (`bg-[var(--status-warning)]/20`) | `EvolutionStatusBadge.tsx` |
| 51 | UX | MetricGrid shows blank cell for null values — no "N/A" fallback | `MetricGrid.tsx:69` |
| 52 | UX | `stripMarkdownTitle` only strips headings, not bold/italic/links | `computeRatings.ts:65-68` |
| 53 | UX | Lineage graph: no edges when all variants are gen-0 — looks broken | `LineageGraph.tsx` |
| 54 | UX | Lineage graph: excessive empty space (500px fixed height for single-layer) | `LineageGraph.tsx:29,153` |
| 55 | UX | Baseline strategy has no color in STRATEGY_PALETTE | `VariantCard.tsx:6-18` |
| 56 | UX | VariantCard shows "iter 0" vs Variants table showing "Gen" — inconsistent label | `VariantCard.tsx` |
| 57 | UX | Variant detail breadcrumb loses arena context | `variants/[variantId]/page.tsx:22-24` |
| 58 | UX | Variant detail: no sigma/uncertainty shown (leaderboard shows it) | `VariantDetailContent.tsx:46-52` |
| 59 | UX | Agent/phase filter in Logs tab has no debounce (fires per keystroke) | `LogsTab.tsx:59,70` |
| 60 | UX | No edit/archive buttons on strategy detail page | Strategy detail |
| 61 | UX | All agents show as "enabled" — no `enabledAgents` field stored | `StrategyConfigDisplay.tsx:64` |
| 62 | UX | Invocations: duration always "---", execution detail always empty | Invocations |
| 63 | UX | Variant detail Lineage tab: empty gray box with no empty-state message | Variant detail |
| 64 | UX | FormDialog doesn't reset state when `initial` prop changes | `FormDialog.tsx:46` |
| 65 | UX | Experiment name input has no maxLength constraint | `ExperimentForm.tsx` |
| 66 | UX | Budget field accepts negative/over-limit values without validation | `ExperimentForm.tsx` |
| 67 | Dev | **HMR infinite loop** — `.playwright-mcp/` and screenshot writes trigger continuous Fast Refresh | `next.config.ts` watchOptions |

## What Works Well
- Sidebar navigation clear and well-organized
- Run detail 5-tab layout well-structured
- Variants tab with strategy filter dropdown
- Failed run error banner clear and informative
- Start Experiment 3-step wizard flow clean
- Cross-link chips (Strategy, Experiment) work correctly
- Log level color-coding, entity badges, timestamps all proper
- Pagination on logs works (100/page with prev/next)
- Log filters (level, entity, iteration, message search) all functional
- Arena topics page clean with item count
- Keyboard tab switching with arrow keys works
- All sidebar links reachable via Tab key
- Browser back button works from detail pages
- Active sidebar highlighting correct on every page
