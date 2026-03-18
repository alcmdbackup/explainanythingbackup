# Assess Test Coverage Evolution V2 Research

## Problem Statement
Evaluate test coverage for the evolution v2 system across all testing tiers (unit, integration, E2E). The evolution pipeline includes complex code paths for pipeline execution, arena comparisons, cost optimization, visualization, and strategy experiments. This project will audit existing tests, identify coverage gaps, and produce a prioritized report of areas needing additional test coverage.

## Requirements (from GH Issue #727)
1. Audit all evolution v2 code files and map them to existing unit tests
2. Audit evolution integration tests for coverage gaps
3. Audit evolution E2E tests for admin evolution UI flow coverage
4. Identify untested services, components, and code paths
5. Produce a coverage gap report with prioritized recommendations
6. Identify any dead code or unused exports in evolution modules

## High Level Summary

The evolution v2 system has **1,525 test cases** across **~120 test files**. Coverage is strong for V2 core library (16 files, 157 tests) and V1 shared modules (13 files, 299 tests), but has significant gaps in integration tests, admin pages, and agent detail components.

### Key Statistics
| Category | Test Files | Test Cases | Coverage |
|----------|-----------|------------|----------|
| V2 Core Unit | 16 | 157 | Excellent (2 untested: arena.ts, errors.ts) |
| V1 Core Unit | 13 | 299 | Excellent (4 V1-only untested) |
| Service Unit | 14 | 281 | Good (4 services untested) |
| Component Unit | 35 | 283 | Good (22 components untested) |
| Shared/Utils | 7 | 68 | Good |
| Scripts | 8 | 149 | Good |
| Admin Pages | 24 | 125 | Moderate (18+ pages untested) |
| Integration | 4 | 34 | **WEAK** (6 listed in docs don't exist) |
| E2E | 5 | 36 | Moderate |
| Config/Experiments | 3 | 44 | Good |
| **TOTAL** | **~120** | **1,525** | |

### Critical Findings

1. **Documentation is outdated**: `testing_setup.md` lists 6 evolution integration test files that don't exist (`evolution-cost-attribution`, `evolution-cost-estimation`, `evolution-outline`, `evolution-pipeline`, `evolution-tree-search`, `evolution-visualization`). Docs claim 26 integration tests total but only 24 exist.

2. **49 source files have NO test coverage** (see detailed breakdown below)

3. **`adminAction.ts` has zero tests** — this is the factory function powering ALL admin server actions (auth, logging, error handling). Critical infrastructure.

4. **`experimentActions.ts` (V1) is dead code** — fully superseded by `experimentActionsV2.ts`, but V2 has no tests either.

5. **Integration test coverage is the weakest tier** — only 4 evolution integration tests exist (34 test cases) for a system with 80+ server actions.

---

## Detailed Coverage Gap Analysis

### 1. Files WITHOUT Test Coverage (49 total)

#### V2 Core Library (2 files)
| File | Status | Risk |
|------|--------|------|
| `evolution/src/lib/v2/arena.ts` | ACTIVE (used in runner.ts) | Medium — arena load/sync functions |
| `evolution/src/lib/v2/errors.ts` | ACTIVE (used in generate.ts) | Low — tested indirectly in generate.test.ts |

#### Services (4 files)
| File | Status | Risk |
|------|--------|------|
| `evolution/src/services/adminAction.ts` | **CRITICAL INFRASTRUCTURE** | **Critical** — factory for ALL admin actions, zero tests |
| `evolution/src/services/experimentActionsV2.ts` | ACTIVE (V2 replacement) | **High** — 5 actions used throughout UI |
| `evolution/src/services/experimentHelpers.ts` | ACTIVE | Low — tested indirectly via experimentActions.test.ts |
| `evolution/src/services/shared.ts` | ACTIVE (83+ refs) | **High** — foundational validation utilities |

#### Components — Top Level (6 files)
| File | LOC | Risk |
|------|-----|------|
| `EntityDetailPageClient.tsx` | ~60 | Medium |
| `FormDialog.tsx` | ~50 | Low |
| `PhaseIndicator.tsx` | ~30 | Low |
| `RegistryPage.tsx` | ~80 | Medium |
| `RunsTable.tsx` | ~100 | Medium |
| `VariantCard.tsx` | ~60 | Low |

#### Components — Agent Details (13 files, none tested)
| File | LOC | Risk |
|------|-----|------|
| CalibrationDetail.tsx | 50 | Medium |
| GenerationDetail.tsx | 40 | Low |
| RankingDetail.tsx | 68 | Medium |
| ReflectionDetail.tsx | 38 | Low |
| IterativeEditingDetail.tsx | 59 | Medium |
| **DebateDetail.tsx** | 69 | **Medium-High** (complex nested conditionals) |
| EvolutionDetail.tsx | 57 | Medium |
| MetaReviewDetail.tsx | 51 | Low |
| OutlineGenerationDetail.tsx | 43 | Low-Medium |
| ProximityDetail.tsx | 22 | Low |
| SectionDecompositionDetail.tsx | 47 | Medium |
| TreeSearchDetail.tsx | 50 | Low-Medium |
| TournamentDetail.tsx | 49 | Medium |

#### Components — Tabs (2 files)
| File | LOC | Risk |
|------|-----|------|
| **EloTab.tsx** | 159 | **HIGH** — Recharts with data transforms, range slider, async loading |
| **LineageTab.tsx** | 373 | **VERY HIGH** — D3.js tree visualization, zoom/pan, tree search toggle |

#### Admin Pages (18+ files)
| File | LOC | Risk |
|------|-----|------|
| **strategies/page.tsx** | 942 | **VERY HIGH** — Complex CRUD with dialogs, sorting, filtering |
| **arena/page.tsx** | 692 | **VERY HIGH** — Multiple dialogs, comparisons, data fetches |
| ExperimentStatusCard.tsx | 197 | Medium — status polling, cancel action |
| ExperimentDetailContent.tsx | 135 | Medium — tabs, cancel, MetricGrid |
| StrategyDetailContent.tsx | 158 | Medium — tabs, metrics |
| VariantDetailContent.tsx | 90 | Medium — tabs, status badges |
| runs/[runId]/compare/page.tsx | 125 | Medium — TextDiff, stats |
| StrategyMetricsSection.tsx | 14 | Low |
| + 10 more page.tsx files | ~20-50 each | Low (wrapper pages) |

#### V1 Core (4 files, not re-exported to V2)
| File | LOC | Risk |
|------|-----|------|
| validation.ts | 127 | Medium — state contract validation |
| configValidation.ts | 123 | Medium — config + model allowlist |
| agentToggle.ts | 37 | Low — pure toggle utility |
| budgetRedistribution.ts | 75 | Medium — agent dependency graph |

### 2. Integration Test Gaps

**Existing (4 files, 34 tests):**
- `evolution-actions.integration.test.ts` — 12 tests (queue, get, kill, config)
- `evolution-infrastructure.integration.test.ts` — 8 tests (claims, heartbeat, split-brain)
- `evolution-explanations.integration.test.ts` — 8 tests (dual-column FKs, cleanup)
- `strategy-resolution.integration.test.ts` — 5 tests (hash dedup, created_by)

**Missing integration coverage for:**
- Cost attribution accuracy (estimated vs actual)
- Cost estimation predictions
- Evolution pipeline end-to-end (generate→rank→evolve→finalize)
- Outline generation pipeline
- Tree search checkpoint round-trip
- Visualization data actions
- Arena sync atomicity
- Experiment state machine transitions
- Watchdog recovery paths
- Checkpoint resume from saved state

### 3. E2E Test Gaps

**Existing (5 files, 36 tests):**
- `admin-evolution.spec.ts` — 5 tests (page load, filters, variants panel)
- `admin-evolution-visualization.spec.ts` — 7 tests (dashboard, tabs, lineage, timeline)
- `admin-strategy-registry.spec.ts` — 2 tests (page load, origin filter)
- `admin-article-variant-detail.spec.ts` — 5 tests (overview, lineage, breadcrumb)
- `admin-arena.spec.ts` — 17 tests (leaderboard, entries, prompt bank, cost chart)

**Missing E2E flows:**
- Run lifecycle (queue → running → completed)
- Experiment creation and execution flow
- Strategy CRUD (create, edit, clone, archive)
- Variant comparison and diff viewing
- Cost optimization dashboard interactions
- Run detail tab navigation with real data
- Arena comparison workflow (head-to-head)
- Error states and empty states

### 4. Dead Code Identified

| File | Status | Recommendation |
|------|--------|---------------|
| `experimentActions.ts` (V1) | DEAD — 8 actions never imported in UI | Remove or mark deprecated |

### 5. Unit Test Coverage Strengths

**Well-tested areas (24+ tests each):**
- `rank.test.ts` (24) — triage, fine-ranking, convergence, budget pressure
- `evolve-article.test.ts` (25) — full pipeline, all stop reasons, config validation
- `finalize.test.ts` (17) — persistence, summary computation, baseline tracking
- `strategy.test.ts` (17) — config hashing, labeling, model shortening
- `cost-tracker.test.ts` (15) — reserve-before-spend, parallel scenarios
- `evolve.test.ts` (14) — mutation, crossover, diversity triggers

**Coverage gaps within tested files:**
- `compose.test.ts` has only 4 tests (missing multi-round composition)
- No checkpoint recovery tests anywhere
- No cache eviction tests for ComparisonCache
- No Swiss pairing algorithm validation

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/feature_deep_dives/error_handling.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/request_tracing_observability.md
- evolution/docs/evolution/README.md (via agent)
- evolution/docs/evolution/architecture.md (via agent)
- evolution/docs/evolution/data_model.md (via agent)
- evolution/docs/evolution/visualization.md (via agent)
- evolution/docs/evolution/arena.md (via agent)
- evolution/docs/evolution/cost_optimization.md (via agent)
- evolution/docs/evolution/reference.md (via agent)
- evolution/docs/evolution/strategy_experiments.md (via agent)
- evolution/docs/evolution/hall_of_fame.md (via agent)

## Code Files Read (via 12 research agents across 3 rounds)

### V2 Core (18 files)
- evolution/src/lib/v2/*.ts — all source and test files

### V1 Core (17 files)
- evolution/src/lib/core/*.ts — all source and test files

### Services (18 files)
- evolution/src/services/*.ts — all source and test files

### Components (~70 files)
- evolution/src/components/evolution/**/*.tsx — all source and test files

### Admin Pages (~33 files)
- src/app/admin/evolution/**/*.tsx — all pages and component files

### Integration Tests (4 files)
- src/__tests__/integration/evolution-*.integration.test.ts
- src/__tests__/integration/strategy-resolution.integration.test.ts

### E2E Tests (5 files)
- src/__tests__/e2e/specs/09-admin/admin-evolution*.spec.ts
- src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts
- src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts
- src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts

## Open Questions

1. Should the 6 non-existent integration test files listed in testing_setup.md be created, or should the docs be corrected?
2. What priority should be given to testing the 13 agent detail components (mostly display-only, LOW-MEDIUM risk)?
3. Should the dead code in `experimentActions.ts` (V1) be removed as part of this project?
4. Are the two complex admin pages (strategies/page.tsx at 942 LOC, arena/page.tsx at 692 LOC) considered high-priority for testing?
5. Should `adminAction.ts` (the factory for all admin actions) be tested as a standalone unit, or only through its consumers?
