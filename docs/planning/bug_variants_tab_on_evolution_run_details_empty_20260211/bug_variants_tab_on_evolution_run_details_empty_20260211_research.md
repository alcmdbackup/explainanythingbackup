# Bug Variants Tab On Evolution Run Details Empty Research

**Date**: 2026-02-11T16:11:20Z
**Git Commit**: 28e59ca7b4b82100ba425a862b4114bb937deeff
**Branch**: fix/bug_variants_tab_on_evolution_run_details_empty_20260211

## Problem Statement
The Variants tab on the evolution run detail page (`/admin/quality/evolution/run/[runId]`) shows empty/no data even when the run has been through 8-10 iterations of COMPETITION phase. The tab renders table headers (Rank, ID, Elo, Trend, Matches, Strategy, Gen, Actions) but zero rows. This occurs for both `running` and `failed` run statuses. Other tabs (Timeline, Elo, Lineage) display data correctly for the same runs.

## Requirements (from GH Issue #404)
- Fix the Variants tab on the evolution run detail page to show variant data
- Investigate why data is not being fetched or rendered
- Ensure the fix works for both completed and in-progress runs

## High Level Summary

**Root cause identified**: The Variants tab uses a fundamentally different data source than all other tabs.

- **Variants tab** queries `content_evolution_variants` DB table via `getEvolutionVariantsAction(runId)` — a simple `SELECT * WHERE run_id = ? ORDER BY elo_score DESC`
- **All other tabs** (Timeline, Elo, Lineage, Tree) query `evolution_checkpoints` table and reconstruct data from JSONB `state_snapshot` fields

The critical issue: variants are **only persisted** to the `content_evolution_variants` table during `finalizePipelineRun()`, which is called **only on successful pipeline completion**. Failed, paused, and running runs **never call `finalizePipelineRun()`**, so the DB table remains empty.

Meanwhile, checkpoints are written after every agent execution during the run, which is why the other tabs display data correctly for running/failed runs.

## Detailed Findings

### 1. VariantsTab Component Data Flow

**File**: `src/components/evolution/tabs/VariantsTab.tsx`

The component loads three data sources in parallel on mount (line 32-36):
```typescript
const [varResult, eloResult, stepResult] = await Promise.all([
  getEvolutionVariantsAction(runId),        // ← DB table query
  getEvolutionRunEloHistoryAction(runId),   // ← Checkpoint-based
  getEvolutionRunStepScoresAction(runId),   // ← Checkpoint-based
]);
```

- `getEvolutionVariantsAction` → queries `content_evolution_variants` table (empty for non-completed runs)
- `getEvolutionRunEloHistoryAction` → reads from `evolution_checkpoints` (has data during/after run)
- `getEvolutionRunStepScoresAction` → reads from `evolution_checkpoints` (has data during/after run)

When `varResult.data` is an empty array (which it is for non-completed runs), the table renders headers but zero rows.

### 2. Variant Persistence Lifecycle

**File**: `src/lib/evolution/core/pipeline.ts`

**`persistVariants()` (lines 68-101)**:
- Persists all pool variants to `content_evolution_variants` via upsert
- Maps in-memory OpenSkill ratings to Elo scale via `ordinalToEloScale()`
- Best-effort: errors are logged as warnings, not thrown
- Called ONLY from `finalizePipelineRun()` (line 401)

**`finalizePipelineRun()` (lines 377-467)**:
- Called ONLY on successful pipeline completion (both minimal and full pipelines)
- Orchestrates: persist run summary → persist variants → persist agent metrics → link strategy → feed hall of fame → flush logs

**Failure paths (lines 745-760 in both pipeline modes)**:
```
Agent error → persistCheckpoint() → markRunFailed() → throw (NO finalizePipelineRun)
Budget exceeded → persistCheckpoint() → markRunPaused() → throw (NO finalizePipelineRun)
```

### 3. Two Data Pathways Architecture

| Data Source | Written When | Used By |
|---|---|---|
| `content_evolution_variants` (DB) | Only at pipeline completion via `finalizePipelineRun()` | Variants tab |
| `evolution_checkpoints` (JSONB) | After every agent execution during the run | Timeline, Elo, Lineage, Tree tabs |
| `llmCallTracking` | During LLM calls | Budget tab |

### 4. Checkpoint State Structure

Each checkpoint's `state_snapshot` contains the complete pipeline state:
- `pool: TextVariation[]` — all variants with id, text, version, parentIds, strategy
- `ratings: Record<string, { mu, sigma }>` — OpenSkill ratings per variant
- `matchCounts: Record<string, number>` — comparison match counts
- `matchHistory: Match[]` — all pairwise comparison results
- `diversityScore`, `allCritiques`, `metaFeedback`, etc.

This is the same data that would eventually be persisted to `content_evolution_variants`, but it's available during the run.

### 5. How Other Tabs Successfully Read Data

**Elo tab** (`getEvolutionRunEloHistoryAction`):
- Loads checkpoints ordered by iteration
- De-duplicates to latest per iteration
- Extracts `ratings` from each snapshot → converts to Elo scale
- Returns variant metadata from latest snapshot pool

**Timeline tab** (`getEvolutionRunTimelineAction`):
- Loads ALL checkpoints for the run
- Diffs sequential checkpoints to compute per-agent metrics
- Correlates with LLM cost tracking via time windows

**Lineage tab** (`getEvolutionRunLineageAction`):
- Loads latest checkpoint only
- Deserializes full state
- Builds node/edge graph from `pool` and `parentIds`

### 6. Test Coverage

| Component | Unit Tests | Integration | E2E |
|---|---|---|---|
| `getEvolutionVariantsAction` | None | None | Indirect only |
| `VariantsTab` component | None | None | Tab visibility only |
| Other tab components | Yes (TimelineTab: 14, BudgetTab: varies) | Yes | Skipped |
| `getEvolutionRunEloHistoryAction` | Yes | Yes | Skipped |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/visualization.md
- docs/evolution/data_model.md
- docs/evolution/reference.md
- docs/evolution/architecture.md
- docs/evolution/README.md
- docs/evolution/agents/overview.md
- docs/evolution/hall_of_fame.md

## Code Files Read
- `src/components/evolution/tabs/VariantsTab.tsx` — Component that renders the variants table
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail page shell with tab routing
- `src/lib/services/evolutionActions.ts` — Server actions including `getEvolutionVariantsAction`
- `src/lib/services/evolutionVisualizationActions.ts` — Server actions for other tabs (via agent)
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator with `persistVariants` and `finalizePipelineRun` (via agent)

## Open Questions
1. Should the fix modify `getEvolutionVariantsAction` to fall back to checkpoint data when no DB variants exist?
2. Or should `persistVariants` be called more frequently (e.g., after each iteration)?
3. Should the Variants tab use checkpoints as primary data source (like all other tabs)?
