# Small UI Fixes Evolution Dash Research

## Problem Statement
Small UX fixes for the evolution dashboard. The runs and experiment history tables on the evolution dashboard overview use a different list layout than the rest of the admin pages. This project standardizes them to use the shared EntityListPage component, improves the visual appeal of the standardized list view, and adds a model dropdown to the strategy creation form. Additionally, test content filtering is missing on the Runs page, and E2E test cleanup for evolution entities has significant gaps.

## Requirements (from GH Issue #796)
- Runs and experiment history tables overview lists in evolution dash different than rest - let's use standardized list view.
- Let's make the standardized list view more visually appealing.
- Strategy creation should have dropdown of available models.
- (Added) Runs page should filter out `[TEST]` content by default.
- (Added) E2E tests must clean up evolution entities; add ESLint rule to enforce cleanup.

## High Level Summary

Five workstreams identified:

1. **List view standardization**: The Runs list (`/admin/evolution/runs`) uses `RunsTable` directly with manual state. The Experiments list (`/admin/evolution/experiments`) uses a custom `ExperimentHistory` component with card-style `ExperimentRow` divs. Meanwhile, Variants, Invocations, Arena use the standardized `EntityListPage`, and Prompts/Strategies use `RegistryPage`. The goal is to migrate Runs and Experiments to EntityListPage. EntityListPage currently hardcodes `EntityTable` — it needs a `renderTable` prop or similar for RunsTable's budget visualization.

2. **Visual improvements to EntityListPage/EntityTable**: ExperimentHistory and RunsTable look nicer because of Card wrappers with `paper-texture`, CardHeader/CardTitle for headers, filters right-aligned in header, card-like bordered rows. EntityListPage should adopt these patterns. The design system has underutilized shadows (shadow-warm-sm/md), status colors, and surface variants.

3. **Model dropdown**: Strategy creation form uses free-text inputs for `generationModel` and `judgeModel`. Minimal fix: change field type to `'select'`, import `MODEL_OPTIONS`. FormDialog already supports selects.

4. **Test content filtering for Runs**: Runs page has no `filterTestContent` support. Runs created by `[TEST]` strategies show up on staging. Need UI checkbox + server action filtering on joined strategy name.

5. **E2E test cleanup enforcement**: Global teardown cleans zero `evolution_*` tables. Three specs create entities without cleanup. No ESLint rule enforces cleanup. Need: global teardown extension, per-spec afterAll blocks, and a new `require-test-cleanup` ESLint rule.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md — 15 admin pages, shared component library, server action architecture
- evolution/docs/evolution/architecture.md — pipeline execution, data model integration

## Code Files Read

### Navigation & Layout
- `src/components/admin/EvolutionSidebar.tsx` — Sidebar with 3 groups: Overview (Dashboard, Start Experiment), Entities (Experiments, Prompts, Strategies, Runs, Invocations, Variants), Results (Arena)
- `src/app/admin/layout.tsx` — Admin layout with SidebarSwitcher

### Dashboard & List Pages
- `src/app/admin/evolution-dashboard/page.tsx` — MetricGrid (6 metrics) + RunsTable (10 recent, compact). Dashboard overview only.
- `src/app/admin/evolution/runs/page.tsx` — Custom: manual filter/pagination state, RunsTable directly, NOT EntityListPage
- `src/app/admin/evolution/experiments/page.tsx` — Wrapper delegating to ExperimentHistory
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` — Card-style list with ExperimentRow divs, StatusDot, filter dropdown, "Hide test content" checkbox, cancel actions. Uses Card/CardHeader/CardContent. NOT EntityListPage.
- `src/app/admin/evolution/start-experiment/page.tsx` — 3-step wizard, not a list page.
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — Multi-step form, not related to list standardization.

### Shared Components
- `evolution/src/components/evolution/EntityListPage.tsx` (192 lines) — Title + filters + EntityTable + pagination. **Hardcodes EntityTable on line 7/141**
- `evolution/src/components/evolution/EntityTable.tsx` (114 lines) — Generic sortable table, row linking, loading skeleton, empty state
- `evolution/src/components/evolution/RunsTable.tsx` (249 lines) — Specialized: budget progress bars, cost warnings, getBaseColumns(), compact mode
- `evolution/src/components/evolution/MetricGrid.tsx` — Configurable metric display
- `evolution/src/components/evolution/RegistryPage.tsx` (189 lines) — CRUD wrapper over EntityListPage
- `evolution/src/components/evolution/FormDialog.tsx` (190 lines) — Supports text/textarea/select/number/checkbox/custom field types
- `evolution/src/components/evolution/EvolutionStatusBadge.tsx` — Color-coded status pills using CSS variables

### Strategy & Model Config
- `src/app/admin/evolution/strategies/page.tsx` — Lines 77-78: generationModel/judgeModel as `type: 'text'`
- `src/lib/schemas/schemas.ts` (lines 72-79) — `allowedLLMModelSchema` z.enum with 12 models
- `src/lib/utils/modelOptions.ts` — `MODEL_OPTIONS` export derived from allowedLLMModelSchema

### Data Actions
- `evolution/src/services/evolutionVisualizationActions.ts` — Dashboard data action, extensible for experiments
- `evolution/src/services/experimentActionsV2.ts` — `listExperimentsAction` with status filter, run count enrichment
- `evolution/src/services/evolutionActions.ts` — `getEvolutionRunsAction` — NO `filterTestContent` support

### Design System
- `src/app/globals.css` — Day/Night Study themes with status colors, surfaces, shadows
- `tailwind.config.ts` — shadow-warm-{sm,md,lg,xl}, shadow-page, rounded-book/page, font-{display,body,ui,mono}

### Test Infrastructure
- `src/__tests__/e2e/setup/global-teardown.ts` — Cleans explanations/topics/tags only. NO evolution tables. Uses service role client. Each step has own try/catch.
- `src/__tests__/e2e/setup/global-setup.ts` — Seeds test topic/explanation/tag
- `src/__tests__/e2e/helpers/test-data-factory.ts` — `TEST_CONTENT_PREFIX = '[TEST]'`. Factories for explanations/tags/reports with auto-tracking. NO evolution entity factories.
- `evolution/src/testing/evolution-test-helpers.ts` — `cleanupEvolutionData()` for integration tests. Cleans invocations/variants/runs/strategies/prompts but **NOT evolution_logs**.
- `eslint-rules/index.js` — Custom plugin with 6 flakiness rules
- `eslint.config.mjs` — Rules applied to `**/*.spec.ts`

### E2E Spec Audit (36 specs total, 18 create entities)
- `admin-strategy-crud.spec.ts` — Creates `[E2E]` strategy, **NO cleanup**
- `admin-prompt-registry.spec.ts` — Creates `[E2E]` prompt, archives only (not deleted), **NO cleanup**
- `admin-experiment-wizard.spec.ts` — Creates `[E2E]` experiment + runs via UI, **NO cleanup**
- `admin-strategy-registry.spec.ts` — Creates `[TEST]` strategies, **HAS cleanup** ✓
- `admin-arena.spec.ts` — Complex seeding, **HAS cleanup** ✓
- `admin-strategy-budget.spec.ts` — Multi-table seeding, **HAS cleanup** ✓
- 14/18 entity-creating specs have cleanup, 3 do not, 1 partial (archive only)

## Key Findings

### List Standardization
1. **Three different list patterns coexist**: EntityListPage (variants, arena, invocations), RunsTable direct (runs), ExperimentHistory card-divs (experiments).
2. **ExperimentHistory is furthest from standard** — card-style rows, StatusDot, cancel actions, Card wrapper.
3. **Runs list is closer** — already a table, just needs EntityListPage wrapping.
4. **EntityListPage hardcodes EntityTable** — needs `renderTable` prop or similar.

### Visual Design
5. **ExperimentHistory looks nicer because of**: Card/paper-texture wrapper, CardHeader with right-aligned filters, card-like bordered rows with rounded-page, gold spinner loading state.
6. **EntityListPage lacks**: Card wrapper, header integration with filters, row visual separation, larger button padding.
7. **Design system underutilized**: shadow-warm-sm/md, status color vars, surface-code, accent-copper.

### Test Content Filtering
8. **Runs page has no `filterTestContent`** — neither UI nor server action. Runs from `[TEST]` strategies visible on staging.
9. **Pages WITH test filtering** (default hide): Strategies, Prompts, Arena, Experiments.
10. **Pages WITHOUT test filtering**: Runs, Variants, Invocations.

### E2E Test Cleanup
11. **Global teardown cleans ZERO evolution tables** — only explanations/topics/tags/user data.
12. **3 specs create entities without cleanup**: strategy-crud, prompt-registry, experiment-wizard.
13. **`cleanupEvolutionData()` helper missing `evolution_logs`** — cleans invocations/variants/runs but not logs.
14. **`llmCallTracking` for evolution not cleaned** — evolution uses system UUID `00000000-0000-4000-8000-000000000001`, teardown only cleans test user ID.
15. **No ESLint rule enforces test cleanup** — existing 6 rules cover flakiness but not data pollution.

### Safe FK Deletion Order for Evolution Tables
```
1. evolution_arena_comparisons  (leaf)
2. evolution_logs               (leaf)
3. evolution_metrics            (leaf)
4. evolution_agent_invocations  (→ runs)
5. evolution_variants           (→ runs, prompts)
6. evolution_runs               (→ strategies, experiments, prompts)
7. evolution_experiments        (→ prompts)
8. evolution_strategies         (root)
9. evolution_prompts            (root)
```

## Open Questions

1. For EntityListPage flexibility — should we add a `renderTable` prop, or use EntityTable with custom column renderers for budget viz?
2. How aggressive should visual improvements be? Adopt Card/paper-texture pattern or lighter touch?
3. Should the dashboard overview page also be updated, or only the Runs and Experiments list pages?
