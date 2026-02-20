# Reorganize Code Files Evolution Research

## Problem Statement
Reorganize the codebase to cleanly separate evolution pipeline code from the main ExplainAnything application code. The goal is to enable two distinct top-level folders (e.g. src_evolution and src_explainanything) while avoiding a messy renaming exercise. This will improve maintainability and make it easier to reason about, develop, and potentially deploy the two systems independently.

## Requirements (from GH Issue #461)
- Separate evolution pipeline code from the rest of the ExplainAnything codebase
- Prefer two different top-level folders (e.g. `src_evolution` and `src_explainanything`) but open to other options
- Avoid creating a messy renaming exercise
- Maintain working builds, tests, and imports throughout the reorganization

## High Level Summary

The evolution pipeline is **remarkably well-isolated** from the main ExplainAnything app. Key findings:

1. **240 files** belong to the evolution pipeline across 14 directory locations
2. **Zero user-facing pages** depend on evolution — it is a fully isolated admin surface
3. **No shared components** — `src/components/evolution/` is never imported by non-evolution components
4. **No actions coupling** — `src/actions/actions.ts` (the main app's server action hub) has zero evolution imports
5. **Narrow hard dependencies** — evolution imports only ~8 modules from the main app (Supabase client, callLLM, LLM pricing, prompts, admin auth, cron auth, audit log, logger)
6. **Single shared DB schema** — all tables coexist in Supabase's `public` schema with 17 evolution-specific migrations
7. **3 evolution-only npm packages** — `openskill`, `d3`, `d3-dag` (plus `recharts` used only in evolution admin UI)

The separation boundary is clean. The main challenge is the **server action wiring pattern** (withLogging, serverReadRequestId, requireAdmin, handleError) which is boilerplate applied uniformly to all evolution service files — these could be duplicated or extracted to a shared interface.

---

## Detailed Findings

### 1. Evolution File Inventory (240 files)

| Location | Files | Description |
|----------|-------|-------------|
| `src/lib/evolution/` | 113 | Core library: agents (30), core (46), section (10), treeOfThought (10), root (11+6 barrel/types) |
| `src/components/evolution/` | 51 | UI: root (26), tabs (9), agentDetails (19) |
| `src/lib/services/evolution*.ts` | 6 | Server actions (3 impl + 3 tests) |
| `src/app/admin/quality/evolution/` | 5 | Admin pages (evolution run management, detail, compare) |
| `src/app/admin/evolution-dashboard/` | 2 | Dashboard overview page + test |
| `src/app/api/cron/evolution*` | 4 | Cron routes (runner + watchdog, each with test) |
| `scripts/` (evolution-related) | 13 | CLI: batch runner, local runner, hall-of-fame, prompt-bank, experiments |
| `scripts/lib/` | 6 | Shared utils: hallOfFameUtils, oneshotGenerator, bankUtils |
| `src/config/promptBankConfig.ts` | 1 | Prompt bank configuration |
| `src/lib/experiments/evolution/` | 4 | Factorial design for strategy experiments |
| `supabase/migrations/` | 17 | Evolution-specific DB migrations (20260131–20260215) |
| `.github/workflows/` | 1 | evolution-batch.yml (weekly batch runner) |
| `docs/evolution/` | 15 | Documentation (README + 14 topic docs) |
| `docs/sample_evolution_content/` | 2 | Sample markdown files for testing |

#### Additional evolution-adjacent files in non-evolution directories

These files in `src/lib/services/` and `src/app/admin/quality/` serve the evolution system but live outside the core evolution directories:

| File | Purpose |
|------|---------|
| `src/lib/services/promptRegistryActions.ts` | Prompt CRUD for evolution prompts |
| `src/lib/services/strategyRegistryActions.ts` | Strategy CRUD for evolution strategies |
| `src/lib/services/unifiedExplorerActions.ts` | Dimensional explorer views |
| `src/lib/services/costAnalytics.ts` | Cost aggregation queries |
| `src/lib/services/costAnalyticsActions.ts` | Cost analytics server actions |
| `src/lib/services/contentQualityActions.ts` | Content quality CRUD |
| `src/lib/services/contentQualityEval.ts` | Quality eval execution |
| `src/lib/services/contentQualityCompare.ts` | Quality comparison logic |
| `src/lib/services/contentQualityCriteria.ts` | Quality eval criteria |
| `src/lib/services/hallOfFameActions.ts` | Hall of Fame server actions |
| `src/lib/services/eloBudgetActions.ts` | Elo budget optimization actions |
| `src/lib/services/llmSemaphore.ts` | Concurrent LLM call throttling |
| `src/app/admin/quality/strategies/page.tsx` | Strategy management page |
| `src/app/admin/quality/strategies/strategyFormUtils.ts` | Strategy form utilities |
| `src/app/admin/quality/explorer/page.tsx` | Dimensional explorer page |
| `src/app/admin/quality/prompts/page.tsx` | Prompt management page |
| `src/app/admin/quality/hall-of-fame/page.tsx` | Hall of Fame listing |
| `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` | Hall of Fame topic detail |
| `src/app/admin/quality/optimization/_components/*.tsx` | Cost optimization components |
| `src/app/admin/quality/optimization/page.tsx` | Cost optimization page |
| `src/app/api/cron/content-quality-eval/route.ts` | Quality eval cron |

These ~20+ additional files bring the true evolution surface to approximately **260+ files**.

---

### 2. Evolution → Main App Dependencies

#### Hard Dependencies (evolution MUST have these)

| Module | Exports Used | Files Using |
|--------|-------------|-------------|
| `@/lib/utils/supabase/server` | `createSupabaseServiceClient` | 21 files (every persistence layer) |
| `@/lib/services/llms` | `callLLM`, `LLMUsageMetadata` | `llmClient.ts` (single entry point for all evolution LLM calls) |
| `@/config/llmPricing` | `calculateLLMCost`, `getModelPricing`, `formatCost` | `costEstimator.ts`, `llmClient.ts`, scripts |
| `@/lib/prompts` | `createTitlePrompt`, `createExplanationPrompt` | `seedArticle.ts`, `oneshotGenerator.ts` |
| `@/lib/services/adminAuth` | `requireAdmin` | 9 server action files |
| `@/lib/utils/cronAuth` | `requireCronAuth` | 2 cron routes |
| `@/lib/services/auditLog` | `logAdminAction` | 2 service files |

#### Shared Utilities

| Module | Exports Used | Files Using |
|--------|-------------|-------------|
| `@/lib/server_utilities` | `logger` | 10 files |
| `@/lib/logging/server/automaticServerLoggingBase` | `withLogging` | 9 server action files |
| `@/lib/serverReadRequestId` | `serverReadRequestId` | 9 server action files |
| `@/lib/errorHandling` | `handleError`, `ERROR_CODES`, `ErrorResponse` | 9 server action files |
| `@/lib/utils/formatters` | `formatCost`, `formatScore`, etc. | 12 component files |
| `@/lib/utils/evolutionUrls` | `buildRunUrl`, `buildExplanationUrl` | 2 component files |

#### Schema/Type Dependencies

| Module | Exports Used | Files Using |
|--------|-------------|-------------|
| `@/lib/schemas/schemas` | `AllowedLLMModelType`, `allowedLLMModelSchema`, `titleQuerySchema` | 11 files |

#### Test-Only Dependencies

| Module | Files Using |
|--------|-------------|
| `@/testing/utils/evolution-test-helpers` | 19 test files (11 unit, 9 integration, but overlap) |
| `@/testing/utils/integration-helpers` | 6 integration test files |
| `@/testing/fixtures/executionDetailFixtures` | 2 test files |

---

### 3. Main App → Evolution Dependencies

**The evolution pipeline is a fully isolated admin surface.**

| Category | Finding |
|----------|---------|
| Non-admin pages (`src/app/` excl. admin, api) | **Zero imports** from evolution |
| Non-evolution components (`src/components/` excl. evolution) | **Zero imports** from evolution |
| Main actions (`src/actions/`) | **Zero imports** from evolution |
| Non-evolution services | **Zero imports** from `@/lib/evolution/` |

The ONLY entry points from the main application into evolution code are:
1. `src/app/admin/` pages (evolution dashboard, quality management, strategies, prompts, explorer, hall of fame, optimization)
2. Their associated `*Actions.ts` service files in `src/lib/services/`
3. Cron API routes in `src/app/api/cron/`

Some admin pages (e.g., `src/app/admin/quality/page.tsx`, `src/app/admin/page.tsx`) import from `contentQualityActions.ts` and `costAnalytics.ts` which do NOT themselves import from `@/lib/evolution/` — they only query DB tables that happen to be evolution-related. This is a data-level coupling, not a code-level coupling.

---

### 4. Test Organization

| Category | Files | Tests | Key Dependencies |
|----------|-------|-------|------------------|
| Unit: `src/lib/evolution/**` | 58 | 1,094 | `evolution-test-helpers`, `executionDetailFixtures`, inline mocks |
| Unit: `src/components/evolution/**` | 17 | 142 | React Testing Library, jest.mock for D3/router |
| Unit: `src/lib/services/evolution*` | 3 | 79 | jest.mock for Supabase, auth |
| Unit: scripts (evolution-related) | 7 | 120 | Inline mocks |
| Integration: `evolution*.integration.test.ts` | 9 | 80 | `evolution-test-helpers`, `integration-helpers`, real Supabase |
| E2E: `admin-evolution*.spec.ts` | 2 | 13 | Playwright adminTest (both suites `describe.skip`'d) |
| **Total** | **96** | **~1,528** | |

Key observations:
- Most unit tests use pure function testing or inline jest.fn() mocks — minimal coupling to test infrastructure
- `evolution-test-helpers.ts` provides factories for mock LLM client, logger, cost tracker, execution context, and DB seed data
- Component tests never import from `@/testing/` — they use only RTL + jest.mock
- Integration tests need both evolution-specific and general integration helpers

---

### 5. Build/Config Coupling

| Config | Current State | Evolution-Specific Concerns |
|--------|--------------|---------------------------|
| `tsconfig.json` | Single config, `@/*` → `./src/*` | No evolution-specific paths. `moduleResolution: "bundler"` ties to Next.js |
| `next.config.ts` | Minimal webpack config + Sentry | No evolution-specific configuration |
| `jest.config.js` | Single config, global mocks | `d3`, `d3-dag`, `openskill` mocks exist solely for evolution |
| `package.json` | Single root package | Evolution-only: `openskill`, `d3`, `d3-dag`, `@types/d3`. Shared: `recharts`, `diff` |
| `.env` | Shared env vars | 4 evolution-only vars not in `.env.example`: `EVOLUTION_STALENESS_THRESHOLD_MINUTES`, `EVOLUTION_MAX_CONCURRENT_LLM`, `FORMAT_VALIDATION_MODE`, `GITHUB_TOKEN` |
| Supabase | Single project, `public` schema | 17 evolution migrations, all tables in shared schema |
| GitHub Actions | Shared CI workflows | 1 evolution-specific: `evolution-batch.yml` |

#### Evolution-Only npm Packages

| Package | Version | Where Used |
|---------|---------|-----------|
| `openskill` | ^4.1.0 | `src/lib/evolution/core/rating.ts` only |
| `d3` | ^7.9.0 | `src/components/evolution/LineageGraph.tsx`, `LineageTab.tsx` |
| `d3-dag` | ^1.1.0 | `src/components/evolution/LineageGraph.tsx` |
| `@types/d3` | ^7.4.3 | TypeScript types for d3 |

---

### 6. Dependency Graph Visualization

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN APP (ExplainAnything)                │
│                                                             │
│  src/app/ (user pages)    src/components/    src/actions/    │
│  src/lib/services/        src/lib/utils/     src/lib/schemas/│
│         │                                                    │
│         │ ZERO dependencies on evolution                     │
│         │                                                    │
│  ┌──────┴──────────────────────────────────────────────┐    │
│  │            ADMIN SURFACE (src/app/admin/)            │    │
│  │  quality/evolution/  evolution-dashboard/             │    │
│  │  quality/strategies/ quality/prompts/                 │    │
│  │  quality/explorer/   quality/hall-of-fame/            │    │
│  │  quality/optimization/                                │    │
│  └──────┬──────────────────────────────────────────────┘    │
│         │ imports                                            │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  EVOLUTION SERVER ACTIONS (src/lib/services/)        │    │
│  │  evolutionActions, evolutionVisualizationActions,     │    │
│  │  evolutionBatchActions, promptRegistryActions,        │    │
│  │  strategyRegistryActions, unifiedExplorerActions,     │    │
│  │  hallOfFameActions, costAnalyticsActions,             │    │
│  │  contentQualityActions, eloBudgetActions              │    │
│  └──────┬──────────────────────────────────────────────┘    │
│         │ imports                                            │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  EVOLUTION CORE (src/lib/evolution/)                  │    │
│  │  113 files: core/, agents/, section/, treeOfThought/  │    │
│  └──────┬──────────────────────────────────────────────┘    │
│         │                                                    │
│         │ imports (narrow interface)                         │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  SHARED INFRASTRUCTURE                                │    │
│  │  createSupabaseServiceClient  callLLM                 │    │
│  │  calculateLLMCost             logger                  │    │
│  │  requireAdmin                 withLogging             │    │
│  │  handleError                  AllowedLLMModelType     │    │
│  │  createTitlePrompt            requireCronAuth         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

  ALSO EVOLUTION (outside src/):
  ├── scripts/ (13 CLI tools + 6 lib utils)
  ├── src/components/evolution/ (51 UI files)
  ├── src/app/api/cron/evolution* (4 cron routes)
  ├── src/config/promptBankConfig.ts
  ├── src/lib/experiments/evolution/ (4 files)
  ├── supabase/migrations/ (17 evolution-specific)
  ├── .github/workflows/evolution-batch.yml
  └── docs/evolution/ (15 docs)
```

---

## Verification Findings (Round 2)

A second research pass verified the initial findings and uncovered additional considerations.

### 7. Zero User-Facing Coupling: CONFIRMED

- Searched all of `src/app/` (excluding admin and api) for any reference to "evolution" — only false positive was the word "revolutionary" in an Einstein test string in `editorTest/page.tsx`
- No dynamic `import()`, no string literals, no CSS classes reference evolution
- No shared layouts (`layout.tsx`) or middleware (`middleware.ts`) import evolution code

### 8. Shared Infrastructure Contamination

Two shared infra files contain evolution-specific code:

| File | What | Severity |
|------|------|----------|
| `src/lib/services/llms.ts` | `callLLMModelRaw` branches on `call_source.startsWith('evolution_')` to gate the LLM semaphore — evolution calls get rate-throttled, non-evolution calls bypass it | **Behavioral coupling** — runtime branch in shared code |
| `src/lib/services/llmSemaphore.ts` | Generic FIFO counting semaphore, but env var is `EVOLUTION_MAX_CONCURRENT_LLM` and comments say "evolution pipelines" | **Naming/documentation coupling** — mechanism is generic |

All other shared infra modules are clean: `llmPricing.ts`, `supabase/server.ts`, `adminAuth.ts`, `server_utilities.ts`, `errorHandling.ts`, `prompts.ts`.

### 9. Admin Quality Directory Boundaries

`SidebarSwitcher.tsx` classifies ALL `/admin/quality/*` as evolution paths:
```typescript
const isEvolutionPath =
  pathname.startsWith('/admin/evolution-dashboard') ||
  pathname === '/admin/quality' ||
  pathname.startsWith('/admin/quality/');
```

Route classification:

| Route | Category |
|-------|----------|
| `/admin/quality` (top-level page.tsx) | **Mixed** — standalone content quality page (no evolution imports), but claimed by EvolutionSidebar via URL prefix match |
| `/admin/quality/evolution/**` | Purely evolution |
| `/admin/quality/explorer/` | Purely evolution |
| `/admin/quality/hall-of-fame/**` | Purely evolution |
| `/admin/quality/optimization/**` | Purely evolution |
| `/admin/quality/prompts/` | Purely evolution |
| `/admin/quality/strategies/` | Purely evolution |

The content quality system (`contentQualityActions.ts`, `contentQualityEval.ts`, etc.) is **shared infrastructure** — evolution borrows it for post-apply quality evaluation, but the quality system itself has no evolution imports. The cron route `content-quality-eval` creates a **feedback loop**: it auto-queues low-scoring articles into evolution.

### 10. Database-Level Coupling

#### Shared State: `explanations.content`
- Main app creates and reads `explanations.content`
- Evolution reads it as pipeline input and **overwrites** it via `applyWinnerAction` / `apply_evolution_winner` RPC
- This is the single most important coupling point

#### Foreign Key Cascades (evolution → main app)
All FKs run FROM evolution tables INTO main-app tables (never reverse):

| Evolution Table | FK → Main App |
|-----------------|--------------|
| `content_evolution_runs.explanation_id` | → `explanations(id) ON DELETE CASCADE` |
| `content_evolution_variants.explanation_id` | → `explanations(id) ON DELETE CASCADE` |
| `content_history.explanation_id` | → `explanations(id) ON DELETE CASCADE` |
| `content_quality_scores.explanation_id` | → `explanations(id) ON DELETE CASCADE` |

Deleting a main-app article cascades into all four evolution tables.

#### Shared Tables

| Table | Evolution Use | Main App Use |
|-------|-------------|-------------|
| `explanations` | Reads content as input, overwrites on winner apply | Core content storage |
| `feature_flags` | 2 flags: `content_quality_eval_enabled`, `evolution_pipeline_enabled` | Generic flag system for all features |
| `content_history` | Written by applyWinner/rollback; read by quality comparison | Schema supports `manual_edit` and `import` sources but currently only evolution writes |

#### Cross-Domain RPC
Only `apply_evolution_winner` crosses the boundary — it atomically reads `explanations`, writes `explanations.content`, inserts `content_history`, and marks `content_evolution_variants.is_winner`.

#### No Generated Types File
Supabase types are NOT auto-generated. Table shapes are typed inline per service file. No shared `Database` type couples evolution to main-app TypeScript code.

### 11. Out-of-Place Files

Evolution-specific files living outside evolution directories:

| File | Location | Should Move? |
|------|----------|-------------|
| `src/lib/utils/evolutionUrls.ts` | Main app utils | URL builders for admin evolution pages |
| `src/lib/utils/formatters.ts` | Main app utils | Header comment says "evolution dashboard" but content is generic formatting |
| `src/lib/services/llmSemaphore.ts` | Main app services | Generic mechanism, evolution-named |

The barrel `src/lib/evolution/index.ts` exports a massive public API (all agents, all types, pipeline functions) but **nobody imports the barrel directly** — all imports use deeper paths like `@/lib/evolution/types`.

### 12. Historical Context

Two prior simplification projects have already been executed on this codebase:

**Project 1: `simplify_evolution_pipeline_20260214`** (COMPLETED)
- Reduced `pipeline.ts` from 1,363 → 751 LOC (45% reduction)
- Extracted 4 modules: `persistence.ts`, `metricsWriter.ts`, `hallOfFameIntegration.ts`, `pipelineUtilities.ts`
- Removed dead code, collapsed DB-backed feature flags to env vars
- Created shared utilities: `textVariationFactory.ts`, `formatValidationRules.ts`, `reversalComparison.ts`, `critiqueBatch.ts`
- **Phase 3 deferred**: budget simplification, pipeline mode consolidation, gating collapse — needs production data

**Project 2: `further_simplify_ev_pipeline_20260215`** (COMPLETED, parent branch)
- Collapsed agent gating from 4 layers → 2 layers (`getActiveAgents()` + `canExecute()`)
- Deleted `featureFlags.ts` entirely
- Removed `MUTEX_AGENTS` (TreeSearch and IterativeEditing can now coexist)
- Promoted `flowCritique` to first-class strategy option
- Net -319 lines across 19 files

**No monorepo tools** (turborepo, nx, lerna, pnpm workspaces) have ever been considered.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/evolution/architecture.md
- docs/evolution/reference.md
- docs/evolution/data_model.md
- docs/evolution/agents/overview.md
- docs/evolution/README.md
- docs/evolution/visualization.md
- docs/evolution/agents/generation.md
- docs/evolution/agents/editing.md
- docs/evolution/agents/tree_search.md
- docs/docs_overall/instructions_for_updating.md

## Code Files Read

### Round 1 (5 parallel agents)
- All files matching `src/lib/evolution/**`, `src/components/evolution/**`, `scripts/*evolution*`, `scripts/*hall*`, `scripts/*prompt*`, `scripts/*strategy*`
- All import statements in evolution files referencing `@/` paths outside evolution
- All import statements in main app files referencing evolution modules
- All `*.test.ts` and `*.test.tsx` files related to evolution
- `tsconfig.json`, `next.config.ts`, `jest.config.js`, `package.json`, `supabase/config.toml`

### Round 2 — Verification (5 parallel agents)
- All of `src/app/` (excl. admin, api) for any evolution reference (dynamic imports, string literals, CSS)
- Shared infra files: `llms.ts`, `llmPricing.ts`, `supabase/server.ts`, `adminAuth.ts`, `server_utilities.ts`, `llmSemaphore.ts`, `errorHandling.ts`, `prompts.ts`
- DB coupling: `content_history`, `explanations`, `content_quality_scores`, `feature_flags` table references; FK relationships; RPC functions
- Admin quality directory: `SidebarSwitcher.tsx`, all `/admin/quality/` pages, `contentQuality*.ts` files
- Historical planning docs: `simplify_evolution_pipeline_20260214/`, `further_simplify_ev_pipeline_20260215/`, archive search for monorepo/workspace tooling

---

## Round 3: In-Place Directory Reorganization Options

### Baseline: Current State Measurements

| Metric | Count |
|--------|-------|
| Total files in `src/` | 715 |
| Files in `src/lib/evolution/` | 119 |
| Files in `src/components/evolution/` | 52 |
| Files in `src/app/admin/quality/` | 24 |
| Files in `src/app/admin/evolution-dashboard/` | 2 |
| Files in `src/app/api/cron/evolution*` | 4 |
| Files in `src/lib/services/evolution*.ts` | 6 |
| Files in `src/config/promptBankConfig.ts` | 1 |
| Files in `src/lib/experiments/evolution/` | 4 |
| Evolution-related scripts in `scripts/` | 22 |
| Integration tests (`evolution*.integration.test.ts`) | 9 |
| Test helpers (`evolution-test-helpers.ts`, fixtures) | 3 |

#### Import Counts Within Evolution Code

| Import Pattern | Occurrences | Files |
|---------------|-------------|-------|
| Relative `../` imports (within evolution/) | 212 | 78 files |
| Relative `./` imports (within evolution/) | 255 | 95 files |
| `@/lib/evolution/` self-reference | 1 | 1 file (strategyConfig.test.ts) |
| **Total internal imports** | **~468** | -- |

#### Evolution → Shared Infrastructure Imports (non-test, non-self)

| Shared Module | Import Count | Evolution Files Using |
|--------------|-------------|---------------------|
| `@/lib/utils/supabase/server` | 10 | 10 (persistence, pipeline, costEstimator, logger, metricsWriter, etc.) |
| `@/lib/schemas/schemas` | 8 | 8 (config, types, llmClient, costEstimator, configValidation, etc.) |
| `@/lib/services/llms` | 3 | 2 (llmClient.ts, llmClient.test.ts) |
| `@/config/llmPricing` | 2 | 2 (llmClient.ts, costEstimator.ts) |
| `@/lib/server_utilities` | 1 | 1 (logger.ts) |
| `@/lib/prompts` | 1 | 1 (seedArticle.ts) |
| **Total shared infra imports** | **25** | **~15 unique files** |

#### External → Evolution Imports (non-evolution code importing evolution)

| Importer Category | Files | Import Statements |
|-------------------|-------|-------------------|
| Admin pages (`src/app/admin/`) | 15 | ~30 |
| Evolution server actions (`src/lib/services/evolution*.ts`) | 3 | ~12 |
| Other server actions (hallOfFame, strategy, unified, prompt) | 5 | ~8 |
| Integration tests | 9 | ~18 |
| Test helpers/fixtures | 3 | ~5 |
| **Total** | **~35** | **~73** |

#### Components → Shared Imports

| Shared Module | Component Files Using |
|--------------|---------------------|
| `@/lib/utils/formatters` | 12 files |
| `@/lib/utils/evolutionUrls` | 3 files |
| `@/lib/services/evolutionActions` | 8 files |
| `@/lib/services/evolutionVisualizationActions` | 10 files |

#### Scripts → Evolution Imports

Scripts use relative paths (`../src/lib/evolution/...`), not `@/` aliases:
- 8 script files contain 21 relative imports into `src/lib/evolution/`
- Scripts also import `../src/config/llmPricing`, `../src/config/promptBankConfig`, `../src/lib/prompts`, `../src/lib/schemas`

---

### Key Constraint: Next.js App Router

Next.js 15 App Router requires all route files (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`) to live under the app directory. This project uses `src/app/` as the app directory (detected by Next.js because `src/` exists with an `app/` subdirectory inside it).

**Files that CANNOT move outside `src/app/`:**
- `src/app/admin/quality/**` (24 files) -- pages, error boundaries
- `src/app/admin/evolution-dashboard/**` (2 files) -- pages
- `src/app/api/cron/evolution-runner/**` (2 files) -- API routes
- `src/app/api/cron/evolution-watchdog/**` (2 files) -- API routes

**Total: 30 files must remain in `src/app/`**

---

### Option A: Two Top-Level Source Directories (`src/` + `src_evolution/`)

#### Concept

Move evolution library code and components to `src_evolution/`:
```
src_evolution/
  lib/evolution/          (119 files from src/lib/evolution/)
  components/evolution/   (52 files from src/components/evolution/)
  services/               (6 files from src/lib/services/evolution*.ts)
  config/                 (1 file: promptBankConfig.ts)
  experiments/            (4 files from src/lib/experiments/evolution/)
src/
  app/admin/quality/      (stays -- Next.js requirement)
  app/admin/evolution-dashboard/  (stays)
  app/api/cron/evolution*/        (stays)
  ... (rest of main app)
scripts/                  (stays at root)
```

Admin pages in `src/app/` would import from `@evolution/...` instead of `@/lib/evolution/...`.

#### Config Changes Required

**1. `tsconfig.json`**

Current:
```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

Changes needed:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@evolution/*": ["./src_evolution/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

The `include: ["**/*.ts", "**/*.tsx"]` already covers `src_evolution/` because `**` globs from root. So TypeScript compilation picks up the new directory automatically. The path alias addition is straightforward -- TypeScript supports multiple path aliases.

**2. `next.config.ts`**

Next.js uses `tsconfig.json` paths for module resolution in bundler mode (`moduleResolution: "bundler"`). The Next.js compiler (SWC/Turbopack) reads `paths` from `tsconfig.json` directly. No changes to `next.config.ts` are needed for path resolution.

However, Turbopack (used in dev via `next dev --turbopack`) resolves modules through `tsconfig.json` paths. This has been stable since Next.js 14+. The `@evolution/*` alias would work identically to `@/*` for bundling.

**3. `jest.config.js`**

Current:
```js
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1',
  // ... other mocks
}
```

Needed addition:
```js
moduleNameMapper: {
  '^@evolution/(.*)$': '<rootDir>/src_evolution/$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  // ... other mocks
}
```

Jest `moduleNameMapper` is ordered -- the `@evolution/` pattern must come before `@/` to avoid false matches. No other Jest config changes needed because `testMatch: ['**/*.test.ts']` already globs from root.

**4. `jest.integration.config.js`**

Same `moduleNameMapper` addition as above.

**5. `eslint.config.mjs`**

Current design-system rules target `src/**/*.ts`:
```js
files: ["src/**/*.ts", "src/**/*.tsx"],
```

Would need expansion to include `src_evolution/`:
```js
files: ["src/**/*.ts", "src/**/*.tsx", "src_evolution/**/*.ts", "src_evolution/**/*.tsx"],
```

However, `src_evolution/` contains mostly non-UI library code. The design-system rules (hardcoded colors, arbitrary text sizes, warm shadows) are irrelevant for `src_evolution/lib/`. Only `src_evolution/components/` would need them. This could be a targeted override.

**6. `tailwind.config.ts`**

Current content paths:
```js
content: [
  './pages/**/*.{js,ts,jsx,tsx,mdx}',
  './components/**/*.{js,ts,jsx,tsx,mdx}',
  './app/**/*.{js,ts,jsx,tsx,mdx}',
  './src/**/*.{js,ts,jsx,tsx,mdx}',
],
```

Needed addition:
```js
'./src_evolution/**/*.{js,ts,jsx,tsx,mdx}',
```

Without this, Tailwind would purge CSS classes used in `src_evolution/components/` files.

**7. `playwright.config.ts`**

No changes needed. Playwright only tests via HTTP -- it does not resolve imports.

**8. Scripts (`scripts/*.ts`)**

Scripts currently use relative paths: `../src/lib/evolution/...`. After the move, these would change to `../src_evolution/lib/evolution/...` OR scripts could be updated to use `@evolution/` aliases (but scripts run via `npx tsx` which does not natively resolve tsconfig paths without `tsconfig-paths/register`).

The `scripts/evolution-runner.ts` also uses `../src/lib/services/llmSemaphore` -- this stays in `src/`.

#### Import Rewriting Scope

| Category | Imports to Rewrite | Notes |
|----------|--------------------|-------|
| Admin pages → evolution lib | ~30 | Change `@/lib/evolution/` → `@evolution/lib/evolution/` |
| Admin pages → evolution components | ~23 | Change `@/components/evolution/` → `@evolution/components/evolution/` |
| Admin pages → evolution services | ~28 | Change `@/lib/services/evolution*` → `@evolution/services/evolution*` |
| Evolution lib → shared infra | 0 | Still uses `@/lib/utils/supabase/server` etc. -- no change |
| Evolution lib internal | 0 | All relative imports (`./`, `../`) -- no change needed |
| Evolution components → evolution lib | ~25 | Change `@/lib/evolution/` → `@evolution/lib/evolution/` |
| Evolution components → shared utils | ~15 | `@/lib/utils/formatters` stays as-is |
| Evolution components → evolution services | ~15 | Change `@/lib/services/evolution*` → `@evolution/services/evolution*` |
| Integration tests | ~18 | Update to `@evolution/` |
| Test helpers/fixtures | ~5 | Update to `@evolution/` |
| Scripts | ~21 | Change `../src/lib/evolution/` → `../src_evolution/lib/evolution/` |
| **Total** | **~180** | |

Evolution code's internal relative imports (468 occurrences) would NOT need rewriting since files move together preserving relative paths.

#### Pros and Concerns

**Works cleanly:** TypeScript path aliases, Jest moduleNameMapper, and Turbopack all support multiple source roots. This is well-trodden territory.

**Concern: Two `@` prefixes.** Developers must choose between `@/` and `@evolution/` based on where the file lives. Code in `src_evolution/` would import shared infra as `@/lib/utils/supabase/server` (reaching INTO `src/`) while code in `src/` would import evolution as `@evolution/lib/evolution/types` (reaching INTO `src_evolution/`). The bidirectional cross-prefix imports could be confusing.

**Concern: Directory naming.** `src_evolution/` is unconventional. Some alternatives: `evolution/`, `packages/evolution/src/`, `modules/evolution/`.

**Concern: Coverage collection.** `jest.config.js` has `collectCoverageFrom: ['src/**/*.{ts,tsx}']`. Would need `src_evolution/**/*.{ts,tsx}` added.

---

### Option B: Self-Contained Subdirectory Within `src/` (`src/evolution/`)

#### Concept

Consolidate all evolution code currently spread across `src/lib/evolution/`, `src/components/evolution/`, `src/lib/services/evolution*.ts`, `src/config/promptBankConfig.ts`, and `src/lib/experiments/evolution/` into a single `src/evolution/` directory:

```
src/evolution/
  lib/                    (from src/lib/evolution/ -- 119 files)
  components/             (from src/components/evolution/ -- 52 files)
  services/               (from src/lib/services/evolution*.ts -- 6 files)
  config/                 (promptBankConfig.ts)
  experiments/            (from src/lib/experiments/evolution/ -- 4 files)
src/
  app/admin/quality/      (stays)
  app/admin/evolution-dashboard/  (stays)
  app/api/cron/evolution*/        (stays)
  lib/ (minus evolution/)
  components/ (minus evolution/)
  ... (rest of main app)
```

#### Config Changes Required

**1. `tsconfig.json`**

Option B-1 (no alias): No config change. Files would import via `@/evolution/lib/...`, `@/evolution/components/...` since `@/*` maps to `./src/*`.

Option B-2 (with alias): Add `@evolution/*` → `./src/evolution/*` for shorter imports.

Either way, `include` does not change.

**2. All other configs:** No changes if using `@/evolution/...` imports. Everything stays under `src/` so all existing config patterns (`src/**/*.ts`, `<rootDir>/src/$1`) continue to work.

#### Import Rewriting Scope

| Category | Imports to Rewrite | Notes |
|----------|--------------------|-------|
| Admin pages → evolution lib | ~30 | `@/lib/evolution/` → `@/evolution/lib/` |
| Admin pages → evolution components | ~23 | `@/components/evolution/` → `@/evolution/components/` |
| Admin pages → evolution services | ~28 | `@/lib/services/evolution*` → `@/evolution/services/evolution*` |
| Evolution components → evolution lib | ~25 | `@/lib/evolution/` → `@/evolution/lib/` |
| Evolution components → evolution services | ~15 | Same pattern |
| Integration tests | ~18 | Same pattern |
| Test helpers/fixtures | ~5 | Same pattern |
| Scripts | ~21 | `../src/lib/evolution/` → `../src/evolution/lib/` |
| **Total** | **~165** | |

Note: internal relative imports within `src/lib/evolution/` (468 occurrences) do NOT change if `src/lib/evolution/` moves intact to `src/evolution/lib/`.

#### Comparison to Current State

What exists today:
```
src/lib/evolution/           (119 files -- the core)
src/components/evolution/    (52 files -- UI)
src/lib/services/evolution*  (6 files -- server actions)
src/config/promptBankConfig  (1 file)
src/lib/experiments/evolution (4 files)
```

What Option B proposes:
```
src/evolution/lib/           (119 files)
src/evolution/components/    (52 files)
src/evolution/services/      (6 files)
src/evolution/config/        (1 file)
src/evolution/experiments/   (4 files)
```

**This is essentially the same structure, just un-nested by one level.** The code moves from being "scattered across multiple `src/` subtrees" to being "grouped under `src/evolution/`". However:

- It still lives inside `src/`, so it does not visually separate at the top level
- The `@/` prefix is shared -- no namespace distinction at import time
- `src/evolution/lib/` vs `src/lib/evolution/` is barely different
- IDE file tree would show `src/evolution/` as a sibling to `src/lib/`, `src/components/`, `src/app/` which could read as "evolution is a Next.js app-level concept" (confusing)

#### Does It "Feel" Like Two Separate Parts?

Not strongly. The directory tree improvement is marginal. The key difference from today is consolidating the 6 scattered locations into 1, but the visual signal at the repo root is unchanged -- everything is still under `src/`.

---

### Option C: Internal Package (`packages/evolution/`)

#### Concept

Create `packages/evolution/` as an internal TypeScript package with its own `package.json` and `tsconfig.json`:

```
packages/
  evolution/
    package.json           (name: "@explainanything/evolution")
    tsconfig.json          (extends root, adds own paths)
    src/
      lib/                 (from src/lib/evolution/)
      components/          (from src/components/evolution/)
      services/            (from src/lib/services/evolution*.ts)
      config/              (promptBankConfig.ts)
      experiments/         (from src/lib/experiments/evolution/)
      index.ts             (barrel export)
src/
  app/admin/quality/       (stays)
  ... (main app)
scripts/                   (stays, imports from packages/evolution)
```

#### Monorepo Tooling: Is It Required?

**Short answer: Not strictly required for a single internal package, but helpful.**

Without tooling (just npm workspaces or bare `package.json` references):
- Add `"workspaces": ["packages/*"]` to root `package.json`
- The internal package resolves via Node's workspace symlinks
- No build step needed if the package is TypeScript-only (ts-jest and Next.js both compile TS directly)

With tooling (Turborepo):
- Turborepo adds caching, task orchestration, and dependency-aware builds
- For a single internal package, this is overhead with minimal benefit
- Turborepo would become valuable if more packages are extracted later

**The project has never used monorepo tooling** (confirmed in prior research). Adding it for one package is heavy.

#### Config Changes Required

**1. Root `package.json`**

Add workspace:
```json
{
  "workspaces": ["packages/*"],
  ...
}
```

**2. `packages/evolution/package.json`**

```json
{
  "name": "@explainanything/evolution",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

**3. Root `tsconfig.json`**

Two approaches:

Approach C-1 (path alias):
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@evolution/*": ["./packages/evolution/src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

Approach C-2 (project references):
```json
{
  "references": [
    { "path": "./packages/evolution" }
  ]
}
```
Plus `packages/evolution/tsconfig.json` with `composite: true`. This enables incremental compilation but requires a build step to generate `.d.ts` files -- incompatible with Next.js's "just compile TS on the fly" approach.

**Approach C-1 (path alias) is simpler and consistent with Option A.**

**4. `next.config.ts`**

Next.js does not transpile code outside `src/` by default (Turbopack respects tsconfig paths, but the webpack bundler may not without configuration). For the webpack path, add:

```js
transpilePackages: ['@explainanything/evolution'],
```

With Turbopack (used in dev), this may not be needed since Turbopack resolves via tsconfig paths. But for production builds (webpack), `transpilePackages` ensures the package is compiled.

**5. `jest.config.js`**

```js
moduleNameMapper: {
  '^@evolution/(.*)$': '<rootDir>/packages/evolution/src/$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  // ...
}
```

Also update `collectCoverageFrom`:
```js
collectCoverageFrom: [
  'src/**/*.{ts,tsx}',
  'packages/evolution/src/**/*.{ts,tsx}',
  // ...
]
```

**6. `jest.integration.config.js`** -- same moduleNameMapper addition.

**7. `eslint.config.mjs`** -- add `packages/evolution/src/**` to relevant file patterns.

**8. `tailwind.config.ts`** -- add `'./packages/evolution/src/**/*.{js,ts,jsx,tsx,mdx}'` to content array.

**9. `playwright.config.ts`** -- no changes.

#### How Would `@/` Imports Change?

Evolution code currently imports shared infra as `@/lib/utils/supabase/server`. After moving to `packages/evolution/`, the `@/` path alias would still resolve to `./src/*` (from root tsconfig). Two sub-options:

**C-1a: Evolution code continues using `@/` to reach shared infra.** This works if `packages/evolution/` inherits the root tsconfig (which it would with `"extends": "../../tsconfig.json"`). But it creates an odd pattern: code in `packages/evolution/` using `@/` actually reaches into `src/` -- the alias meaning changes depending on which package you're in.

**C-1b: Evolution code uses relative paths or a `@shared/` alias for shared infra.** This is cleaner semantically but means rewriting the 25 shared-infra imports in evolution code. Could define `@shared/*` → `./src/lib/*` as a shared-infra alias.

**C-1c: Extract shared infra to `packages/shared/`.** Create a second package:
```
packages/shared/
  src/
    supabase/server.ts
    llms.ts
    llmPricing.ts
    schemas.ts
    prompts.ts
    adminAuth.ts
    cronAuth.ts
    logger.ts
```
Both `src/` and `packages/evolution/` import from `@shared/`. This is the cleanest separation but doubles the package count and moves 8+ files out of `src/`.

#### Import Rewriting Scope

Same as Option A (~180 imports), PLUS:

| Additional Rewrites | Count | Notes |
|--------------------|-------|-------|
| Evolution → shared infra (if not using `@/`) | 25 | `@/lib/utils/supabase/server` → `@shared/supabase/server` or similar |
| `packages/evolution/package.json` deps | -- | Would need to declare deps on shared packages if using true package boundaries |

#### Pros and Concerns

**Strongest separation.** A `packages/` directory at the repo root is the universal signal that this is a separable unit.

**Concern: `npm install` changes.** Adding workspaces to `package.json` triggers npm/yarn to hoist `packages/evolution/`'s dependencies. Since all deps are already in the root, this is mostly transparent, but it changes `node_modules/` layout and `package-lock.json` significantly. Every developer must `npm install` again.

**Concern: Test runner complexity.** Jest must be configured to resolve `@evolution/` paths AND potentially run tests inside `packages/evolution/` with a different `testEnvironment` (node for lib, jsdom for components). Currently everything uses a single Jest config.

**Concern: `next build` transpilation.** Must ensure `packages/evolution/` is transpiled during production builds. The `transpilePackages` config handles this, but it's another thing that can break.

**Concern: CI changes.** GitHub Actions cache keys, coverage paths, and test commands may need updating.

---

### Summary Table: All Three Options

| Dimension | Option A: `src_evolution/` | Option B: `src/evolution/` | Option C: `packages/evolution/` |
|-----------|---------------------------|---------------------------|--------------------------------|
| **Visual separation** | Strong (top-level dir) | Weak (nested in src/) | Strongest (packages/ convention) |
| **Files that CANNOT move** | 30 (admin pages + cron routes) | 30 (same) | 30 (same) |
| **Files that CAN move** | ~182 (lib+components+services+config+experiments) | ~182 (same) | ~182 (same) |
| **Import rewrites needed** | ~180 | ~165 | ~180-205 |
| **Config files changed** | 6 (tsconfig, jest x2, eslint, tailwind, coverage) | 0-1 (optional alias in tsconfig) | 8+ (tsconfig, jest x2, eslint, tailwind, next.config, package.json x2) |
| **Monorepo tooling needed** | No | No | Optional but recommended |
| **Risk of breaking `next build`** | Low (path aliases well-supported) | Lowest (stays in src/) | Medium (transpilePackages, workspace hoisting) |
| **Risk of breaking Jest** | Low (moduleNameMapper addition) | Lowest (no change) | Medium (path resolution across packages) |
| **Git diff size** | Large (file moves + import rewrites) | Medium (file moves + import rewrites) | Largest (file moves + import rewrites + new configs) |
| **Scripts impact** | Relative path changes (21 imports) | Relative path changes (21 imports) | Relative path changes (21 imports) + potential workspace resolution |
| **Bidirectional imports** | Yes (`@/` → shared, `@evolution/` → evolution) | No (single `@/` prefix) | Yes (unless `@shared/` extracted) |
| **Future: deploy independently** | Hard (still one Next.js app) | Hard (same) | Easier (package boundary exists) |
| **Precedent in codebase** | None | Partial (src/lib/evolution/ exists) | None |

---

### Cross-Cutting Concerns (All Options)

#### 1. Test Helpers and Fixtures

Three test-support files reference evolution code:
- `src/testing/utils/evolution-test-helpers.ts` (11 evolution test files import this)
- `src/testing/fixtures/executionDetailFixtures.ts` (2 test files)
- 9 integration tests in `src/__tests__/integration/evolution*.test.ts`

These could move with evolution code OR stay as bridge files. Moving them means integration tests (which stay in `src/`) must import across the boundary.

#### 2. `src/lib/utils/evolutionUrls.ts`

This is an evolution-only utility (8 files import it, all in evolution admin pages or components). It should move with evolution code in any option.

#### 3. `src/lib/utils/formatters.ts`

Used by both evolution components (12 files) and non-evolution admin pages. This is truly shared infrastructure and should NOT move.

#### 4. Cron Routes: Deep Evolution Imports

`src/app/api/cron/evolution-runner/route.ts` uses `await import('@/lib/evolution')` (dynamic import). After any reorganization, this single dynamic import path would change. The watchdog route has no evolution imports at all (it only queries the DB directly).

#### 5. Server Actions Boilerplate

All 6 `evolution*Actions.ts` files follow the same pattern:
```typescript
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
```

These 5 shared-infra imports appear in every server action file. After moving server actions, they would import from `@/` (reaching back into main app). This cross-boundary pattern exists regardless of option chosen.

#### 6. `src/lib/services/llms.ts` Behavioral Coupling

The `callLLMModelRaw()` function in the shared `llms.ts` contains an evolution-specific branch:
```typescript
if (call_source.startsWith('evolution_')) { /* use semaphore */ }
```

This branch stays in `src/` regardless of option. It means the shared LLM service has runtime knowledge of evolution. Decoupling this would require a callback/plugin pattern (e.g., pass a `beforeCall` hook from evolution code).

### Round 3 Files Read

- `tsconfig.json`, `next.config.ts`, `jest.config.js`, `jest.integration.config.js`
- `eslint.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`
- `playwright.config.ts`, `package.json`
- `src/lib/evolution/index.ts` (barrel exports)
- `src/app/api/cron/evolution-runner/route.ts`
- `src/app/api/cron/evolution-watchdog/route.ts`
- `scripts/evolution-runner.ts`
- `scripts/run-evolution-local.ts` (first 30 lines)
- `src/config/promptBankConfig.ts`
- `src/lib/utils/evolutionUrls.ts`
- All import patterns via grep across `src/`, `scripts/`

---

## Round 4: Next.js Source Directory Constraints

### 13. Next.js App Router Directory Rules

**App directory location:** Next.js supports exactly two placements — `<root>/app/` or `<root>/src/app/`. There is no configuration option to place the App Router at an arbitrary path like `src_evolution/app/`. The `src` convention is hardcoded. If both `app/` and `src/app/` exist, root-level `app/` takes precedence.

**Implication:** The `src/app/` directory must stay where it is. Evolution admin pages and cron routes cannot move out of `src/app/`.

### 14. Code Outside `src/` — Transpilation

**Webpack (production build):** The Next.js webpack config sets `include: [dir]` where `dir` is the project root. Any TypeScript file within the project root tree — including a hypothetical `src_evolution/` — is automatically compiled. `transpilePackages` is only needed for code in `node_modules/` or outside the project root (e.g., monorepo sibling packages via symlinks).

**Turbopack (dev via `--turbopack`):** Turbopack resolves modules relative to the root directory (auto-detected from lockfile location). A `src_evolution/` directory within the project root is in scope. No additional config needed.

**TypeScript:** The current `include: ["**/*.ts", "**/*.tsx"]` already matches all `.ts` files from the project root recursively. A `src_evolution/` directory's files would already be covered.

**Bottom line:** Creating a `src_evolution/` sibling to `src/` requires NO transpilation config changes — both webpack and Turbopack handle it out of the box.

### 15. TypeScript Path Aliases with Next.js

Adding `@evolution/*` → `./src_evolution/*` to tsconfig `paths` is supported by:
- **Turbopack (dev):** Reads `tsconfig.json` paths natively
- **Webpack (build):** Next.js has built-in support for tsconfig paths
- **Jest:** Requires corresponding `moduleNameMapper` entry
- **ESLint:** Needs file glob expansion

**Risk with Next.js 15.2.8:** A Turbopack path alias resolution bug existed in early 15.x versions (GitHub issues #71886, #71879), fixed in Next.js 15.3.3. If `@evolution/*` aliases fail in `next dev --turbopack`, workaround is to add `turbopack.resolveAlias` to `next.config.ts`. Upgrading to 15.3.x+ eliminates this risk.

### 16. Server Components and `'use server'` Outside `src/`

**No file location constraints.** Server Components, `'use client'`, and `'use server'` directives all work from any directory — Next.js only requires the directive annotation in the file, not a specific location.

### 17. Required Config Changes for `src_evolution/`

| File | Change | Reason |
|------|--------|--------|
| `tsconfig.json` | Add `@evolution/*` path | Path alias resolution |
| `jest.config.js` | Add `moduleNameMapper` entry | Jest module resolution |
| `jest.integration.config.js` | Same as above | Integration test resolution |
| `tailwind.config.ts` | Add `./src_evolution/**` to content | Tailwind class scanning |
| `eslint.config.mjs` | Extend file globs | Lint coverage |
| `next.config.ts` | **None required** (unless Turbopack alias bug on 15.2.8) | Already covers project root |
| `tsconfig.json` include | **None required** | `**/*.ts` already inclusive |

---

## Round 5: Shared Infrastructure Module Deep Analysis

### 18. Module-by-Module Assessment

| # | Module | LOC | Dependencies | Domain Classification | Extraction Difficulty |
|---|--------|-----|-------------|----------------------|----------------------|
| 1 | `llms.ts` | 542 | 11 imports | **Mixed** — 1 evolution branch | Moderate |
| 2 | `llmSemaphore.ts` | 91 | **0** | Class: pure infra; Singleton: evolution-named | Very easy |
| 3 | `adminAuth.ts` | 130 | 2 (Supabase, logger) | Pure shared infra | Easy |
| 4 | `cronAuth.ts` | 29 | 1 (NextResponse) | Pure shared infra | Very easy |
| 5 | `automaticServerLoggingBase.ts` | 393 | 3 (logger, OTel, schemas) | Pure shared infra | Moderate |
| 6 | `serverReadRequestId.ts` | 40 | 3 (RequestIdContext, crypto, Sentry) | Pure shared infra | Medium |
| 7 | `errorHandling.ts` | 220 | 3 (logger, Sentry, RequestIdContext) | Mostly pure (domain error code names) | Medium |
| 8 | `server_utilities.ts` | 166 | 5 (fs, path, Sentry, RequestIdContext, OTLP) | Pure shared infra | **Hard** |
| 9 | `prompts.ts` | 324 | **0** | Main-app domain (evolution uses 2 of 8) | Very easy |
| 10 | `llmPricing.ts` | 135 | **0** | Pure shared infra | Trivial |
| 11 | `schemas.ts` | 1271 | 1 (zod) | **Mixed monolith** — app + evolution schemas | **Hard** (needs splitting) |
| 12 | `formatters.ts` | 59 | **0** | Generic (only used by evolution UI) | Trivial |
| 13 | `evolutionUrls.ts` | 55 | **0** | Evolution-specific | Trivial |

### 19. Key Module Details

#### `llms.ts` (542 LOC) — The Evolution Branch

The `callLLMModelRaw` function checks `call_source.startsWith('evolution_')`. When true, it wraps the LLM call in `LLMSemaphore.acquire()/release()` — evolution calls get rate-throttled, non-evolution calls bypass the semaphore entirely. This is the **only** evolution-aware behavior in any shared module. The routing itself (`routeLLMCall`) dispatches to Anthropic or OpenAI based on model prefix, with no domain knowledge.

This file has 11 imports including provider SDKs, Supabase for call tracking, OTel for tracing, and the semaphore. It is the most heavily integrated shared module.

#### `server_utilities.ts` (166 LOC) — The Logger Hub

The `logger` object writes to **five destinations**: console, file (`server.log`), OTLP (Honeycomb), Sentry breadcrumbs, and Sentry Logs. It's imported by almost every other shared module. This is the hardest module to extract because of its deep integration with Sentry, OTel, and the filesystem.

#### `schemas.ts` (1271 LOC) — The Monolith

Contains schemas for the entire app mixed together: core app (explanations, topics, tags, user library, link system, sources), shared types (LLM models, call tracking, log config), and evolution-specific types (quality scoring, hall of fame). Evolution imports only `AllowedLLMModelType`, `allowedLLMModelSchema`, `titleQuerySchema`, and the quality evaluation schemas. Would benefit from splitting into domain-specific modules, but that's a separate refactoring.

#### Zero-Dependency Modules (5 of 13)

`llmSemaphore.ts`, `prompts.ts`, `llmPricing.ts`, `formatters.ts`, and `evolutionUrls.ts` have zero imports. These are trivially movable or extractable. Among them, `formatters.ts` and `evolutionUrls.ts` are used exclusively by evolution code despite living in main app utils.

### 20. Shared Infra Handling Strategies

For any reorganization option, the ~10 shared modules must remain accessible to both systems. Three strategies exist:

**Strategy 1: Leave in `src/`, evolution imports via `@/`**
- Simplest. No shared module files move.
- Evolution code reaches back into `src/` for shared infra — a cross-boundary import.
- Works with Options A, B, and C.
- Con: evolution package has a runtime dependency on the main app's source tree.

**Strategy 2: Extract to `packages/shared/` or `src/shared/`**
- Cleanest separation. Shared modules get their own home.
- Both `src/` and evolution code import from `@shared/`.
- Adds ~13 files to the move scope. Requires updating 100+ import statements in the main app too.
- Con: Significantly increases migration scope. The main app's imports also change.

**Strategy 3: Duplicate the thin interface**
- Copy the 5 server-action boilerplate modules (`withLogging`, `serverReadRequestId`, `requireAdmin`, `handleError`, `logger`) into evolution.
- Keep heavier modules (`llms.ts`, `schemas.ts`) as shared imports.
- Con: Maintenance burden — two copies must stay in sync.

**Strategy 1 is the pragmatic choice for any option**, keeping migration scope minimal. Strategy 2 is the right long-term answer but doubles the migration effort.

---

## Round 6: Monorepo Tooling Comparison

### 21. Four Tooling Options Evaluated

| Dimension | Turborepo | pnpm Workspaces | npm Workspaces | Nx |
|-----------|-----------|-----------------|----------------|-----|
| **New config files** | 2 | 2 + lockfile migration | 1 | 3-5 |
| **Package manager change** | No | **Yes (npm → pnpm)** | No | No |
| **`@/` alias in evolution pkg** | **Breaks** (must rewrite) | **Breaks** | **Breaks** | **Breaks** |
| **Jest impact** | Separate config per pkg | Same | Same | Must use `@nx/jest` executor |
| **CI workflow changes** | Minor | Moderate (npm→pnpm) | **None** | Major rewrite |
| **Task caching** | Yes (local + remote) | No | No | Yes |
| **Learning curve** | Low | Low | **Lowest** | High |
| **Overkill for 2 packages?** | No | No | No | **Likely yes** |

### 22. Universal Constraint: `@/` Alias Rewrite

All monorepo approaches require that the evolution package NOT use `@/*` imports — TypeScript path aliases only resolve in the package where they are defined. The ~260 evolution files contain approximately 300+ `@/` import statements that must be rewritten. This is unavoidable with any monorepo tooling.

### 23. Tooling Assessment for This Project

**npm workspaces** is the path of least resistance — no package manager migration, no new tools, CI stays unchanged. The cost is no task caching and weaker phantom dependency protection.

**Turborepo** adds value if CI speed matters — caching ~1,500 evolution tests when only app code changes could save significant CI minutes. Native Vercel integration is a natural fit.

**pnpm + Turborepo** is the industry-standard stack for Next.js monorepos (2025-2026), but the package manager migration is orthogonal to the separation goal and adds risk.

**Nx** is designed for 10+ package monorepos with multiple teams. For a 2-package split, configuration overhead and learning curve are disproportionate.

### 24. Monorepo vs. No-Monorepo

The three reorganization options (Round 3) and monorepo tooling are **orthogonal choices**:
- **Option A** (`src_evolution/`) works without any monorepo tooling
- **Option B** (`src/evolution/`) works without any monorepo tooling
- **Option C** (`packages/evolution/`) benefits from npm workspaces or Turborepo but can also work with bare `file:` references

The only scenario where monorepo tooling is strongly recommended is Option C, where `packages/evolution/` has its own `package.json` and needs proper dependency resolution.

---

## Round 6 Files Read

### Next.js Constraints Research
- `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`
- `jest.config.js`, `eslint.config.mjs`, `playwright.config.ts`
- Next.js 15 docs: src folder convention, project structure, turbopack config, transpilePackages, use-server directive

### Shared Infrastructure Analysis
- `src/lib/services/llms.ts` (542 LOC)
- `src/lib/services/llmSemaphore.ts` (91 LOC)
- `src/lib/services/adminAuth.ts` (130 LOC)
- `src/lib/utils/cronAuth.ts` (29 LOC)
- `src/lib/logging/server/automaticServerLoggingBase.ts` (393 LOC)
- `src/lib/serverReadRequestId.ts` (40 LOC)
- `src/lib/errorHandling.ts` (220 LOC)
- `src/lib/server_utilities.ts` (166 LOC)
- `src/lib/prompts.ts` (324 LOC)
- `src/config/llmPricing.ts` (135 LOC)
- `src/lib/schemas/schemas.ts` (1271 LOC)
- `src/lib/utils/formatters.ts` (59 LOC)
- `src/lib/utils/evolutionUrls.ts` (55 LOC)

### Monorepo Tooling Research
- Turborepo docs: internal packages, Next.js guide, TypeScript
- pnpm docs: workspaces
- npm docs: workspaces
- Nx docs: Next.js plugin
- Community comparisons and real-world monorepo examples
