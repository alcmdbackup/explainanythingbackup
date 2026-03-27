# Reorganize Code Files Src Evolution Folder Research

## Problem Statement
Reorganize the files in the evolution folder for better organization and maintainability. The current file structure has grown organically and needs a clearer layout with better module boundaries. Also consolidate misplaced evolution docs from `docs/` into `evolution/docs/`.

## Requirements (from GH Issue #TBD)
To be determined — requirements derived from research findings below.

## High Level Summary

3 rounds of 12 parallel agents explored the evolution codebase. Key findings:

1. **Two overly flat directories** need reorganization: `components/evolution/` (49 files at root) and `services/` (26 files)
2. **lib/ is well-organized** — pipeline/, core/, metrics/, shared/ have clear boundaries; only minor improvements needed
3. **Two misplaced docs** (`docs/feature_deep_dives/evolution_logging.md` and `evolution_metrics.md`) should move to `evolution/docs/`
4. **Barrel exports are underutilized** — metrics and pipeline barrels have missing exports; fixing them enables safe reorganization
5. **Config changes are minimal** — path aliases use top-level globs, so internal reorganization requires almost no config updates
6. **Prior reorganization projects** (Feb 2026) established proven patterns: phased execution, config-first, path aliases, ESLint boundary enforcement

## Key Findings

### 1. Directory Structure Overview (~280 files in evolution/src/)

```
evolution/src/
├── components/evolution/  (49 root files + 3 subdirs) ⚠️ OVERLY FLAT
├── services/              (26 files)                   ⚠️ OVERLY FLAT
├── lib/
│   ├── core/              (12 files — agents, entities, registries) ✓ GOOD
│   ├── metrics/           (11 files + computations/)               ✓ GOOD
│   ├── pipeline/          (6 root + infra/, setup/, loop/, finalize/) ✓ EXCELLENT
│   ├── shared/            (12 files — ratings, validation, errors) ✓ GOOD
│   ├── utils/             (8 files — 2 misplaced)                 ⚠️ PARTIAL
│   └── ops/               (4 files — vague naming)                ⚠️ MINOR
├── config/                (2 files) ✓ FINE
├── experiments/           (4 files) ✓ FINE
└── testing/               (5 files) ✓ FINE
```

### 2. Components: 49 Root Files Need Subdirectories

**Proposed structure:**
- Keep at root (3 page shells): `EntityDetailPageClient`, `EntityListPage`, `EvolutionErrorBoundary`
- `tables/`: EntityTable, RunsTable, TableSkeleton
- `sections/`: EntityDetailHeader, EntityDetailTabs, InputArticleSection, VariantDetailPanel
- `primitives/`: EvolutionStatusBadge, StatusBadge, MetricGrid, EmptyState, NotFoundCard, ElapsedTime, EvolutionBreadcrumb
- `visualizations/`: LineageGraph, EloSparkline, TextDiff, VariantCard
- `dialogs/`: FormDialog, ConfirmDialog
- `context/`: AutoRefreshProvider
- Keep existing: `tabs/`, `variant/`, `agentDetails/`

**Result:** Root drops from 49 to ~9 files (3 shells + index + 6 subdirectories)

### 3. Services: 26 Files Could Be Domain-Grouped

**6 natural domain clusters identified:**
- **Arena** (17 exports): arenaActions (topics, entries, prompts)
- **Evolution pipeline** (20 exports): evolutionActions, invocationActions, experimentActions
- **Configuration** (7 exports): strategyRegistryActions
- **Analytics** (11 exports): costAnalytics, metricsActions, evolutionVisualizationActions
- **Inspection** (6 exports): logActions, variantDetailActions
- **Infrastructure** (utilities): adminAction, shared

**Key finding:** Zero cross-service dependencies — services can be reorganized freely.

**Recommendation:** Either group into subdirectories or add barrel exports as intermediate step. Services are manageable at 13 files (26 including tests), so subdirectory grouping is optional.

### 4. lib/ Is Mostly Well-Organized

**Two minor improvements identified:**
- `lib/utils/frictionSpots.ts` and `lib/utils/metaFeedback.ts` are pipeline-specific → move to `lib/pipeline/loop/`
- `lib/ops/` naming is vague → rename to `lib/maintenance/` or move to `/services/`

**Everything else stays as-is:** core/, metrics/, pipeline/, shared/ are all well-structured.

### 5. Barrel Exports Need Fixing Before Reorganization

| Barrel | Exports | Used? | Issues |
|--------|---------|-------|--------|
| `components/evolution/index.ts` | 30 | ✓ 30 barrel imports | Working well |
| `lib/index.ts` | 24 | Partial | Missing some core exports |
| `lib/metrics/index.ts` | 9 | ✗ 0 barrel imports | `metricColumns` not exported |
| `lib/pipeline/index.ts` | 33 | ✗ 0 barrel imports | `claimAndExecuteRun` not exported |

**Fix before reorganizing:** Add missing exports, then migrate deep-path imports to use barrels. This makes barrels a stable API layer that absorbs internal moves.

### 6. Documentation Consolidation

**Move to `evolution/docs/`:**
- `docs/feature_deep_dives/evolution_logging.md` → `evolution/docs/logging.md`
- `docs/feature_deep_dives/evolution_metrics.md` → merge into existing `evolution/docs/metrics.md` or delete (stub only, 11 lines)

**Already in correct location (13 docs, 4,685 lines):**
- `evolution/docs/` has comprehensive coverage: architecture, data_model, entities, metrics, arena, rating, strategies, visualization, reference, curriculum, deployment, cost_optimization, agents

### 7. Import/Dependency Patterns

- **Clean module boundaries** with `@evolution/` and `@/` path aliases
- **One known circular dep** (Entity ↔ entityRegistry) handled with lazy require
- **Cross-boundary imports:** evolution → main src via `@/` (supabase, adminAuth, error handling); main src → evolution via `@evolution/` (components, services)
- **Evolution is admin-only** — no consumer-facing pages import evolution code

### 8. Config Impact Is Minimal

All configs use top-level globs (`evolution/src/**`). Internal reorganization requires:
- ❌ tsconfig.json — no change
- ❌ jest.config.js — no change
- ❌ next.config.ts — no change
- ❌ eslint.config.mjs — no change
- ❌ tailwind.config.ts — no change
- ⚠️ package.json — only if test path patterns change (e.g., `evolution/src/lib/`)
- ⚠️ .claude/doc-mapping.json — only if doc paths change

### 9. Prior Reorganization Lessons (Feb 2026)

From `reorganize_code_files_evolution_20260216` (234 files moved, ~195 import rewrites):
1. **Phased execution** — 4-6 phases, each producing working build
2. **Config-first** — update tsconfig/jest BEFORE moving files
3. **Path aliases beat manual rewrites** — `@evolution/*` alias minimizes churn
4. **TypeScript catches errors** — `tsc --noEmit` validates all imports
5. **Dynamic imports need manual audit** — `await import()` not checked by tsc
6. **Batch regex can introduce bugs** — use careful two-step approach
7. **Remove dead code first** — simplifies the reorganization

### 10. Testing Infrastructure

- **Resilient:** Jest config (aliases), colocated tests, no snapshots, integration tests (aliases), E2E tests (tag-based filtering)
- **At risk:** Script test mocks (hardcoded .env paths), npm test scripts (path patterns), V1 regression filter

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_logging.md — entity hierarchy, logger factory, LogsTab
- docs/feature_deep_dives/evolution_metrics.md — stub, 11 lines

### Prior Reorganization Projects
- docs/planning/reorganize_code_files_evolution_20260216/ — full evolution extraction (234 files)
- docs/planning/simplify_reorganize_evolution_pipeline_rules_20260221/ — dead code removal

## Code Files Read

### Directory Structure
- evolution/src/components/evolution/ — 49 root files + tabs/, variant/, agentDetails/
- evolution/src/services/ — 13 service files + 13 test files
- evolution/src/lib/ — core/, metrics/, pipeline/, shared/, utils/, ops/
- evolution/src/config/ — promptBankConfig
- evolution/src/experiments/evolution/ — analysis, experimentMetrics
- evolution/src/testing/ — 5 test utility files

### Barrel Exports
- evolution/src/components/evolution/index.ts — 30 exports
- evolution/src/lib/index.ts — 24 exports
- evolution/src/lib/metrics/index.ts — 9 exports
- evolution/src/lib/pipeline/index.ts — 33 exports

### Configuration
- tsconfig.json — @evolution/* alias
- jest.config.js — moduleNameMapper, testMatch
- jest.integration.config.js — same pattern
- next.config.ts — turbopack alias
- eslint.config.mjs — boundary enforcement rules
- tailwind.config.ts — content paths
- package.json — test script path patterns

## Open Questions

1. **Services reorganization scope** — Should services stay flat (13 files is manageable) or be domain-grouped? User preference needed.
2. **Barrel-first vs move-first** — Fix barrels first (safer) or reorganize and fix imports simultaneously?
3. **ops/ naming** — Rename to `maintenance/` or move to `services/`?
4. **StatusBadge consolidation** — Two overlapping badge components; consolidate during or after reorg?
