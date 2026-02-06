# Understand Pipeline Agent Execution Progress

## Phase 5: Update TimelineData Type
### Work Done
- Extended `TimelineData` interface with new optional fields for per-agent detail:
  - `newVariantIds?: string[]`
  - `eloChanges?: Record<string, number>`
  - `critiquesAdded?: number`
  - `debatesAdded?: number`
  - `diversityScoreAfter?: number | null`
  - `metaFeedbackPopulated?: boolean`
  - `skipped?: boolean`
  - `executionOrder?: number`
- Added iteration-level totals: `totalCostUsd`, `totalVariantsAdded`, `totalMatchesPlayed`

### Issues Encountered
None - straightforward type extension.

## Phase 1: Fetch All Checkpoints Per Iteration
### Work Done
- Removed de-duplication logic that kept only last checkpoint per iteration
- Changed query to include `created_at` with ASC ordering for correct execution sequence
- Grouped checkpoints by iteration while preserving all agents

## Phase 2: Add diffCheckpoints Helper
### Work Done
- Created `diffCheckpoints()` function to compute per-agent metrics by diffing sequential checkpoints
- Created `computeEloDelta()` helper for Elo rating changes
- First agent diffs against previous iteration's final checkpoint (or empty baseline for iter 0)
- Each subsequent agent diffs against previous agent's checkpoint

## Phase 3: Per-Iteration Cost Attribution
### Work Done
- Built checkpoint time boundaries from `created_at` timestamps
- Fetched LLM calls for run's time window from `llmCallTracking`
- Attributed calls to appropriate iteration+agent by timestamp and call_source matching
- Added fallback attribution for calls that don't match exact boundaries

## Phase 4: UI with Expandable Agent Rows
### Work Done
- Updated TimelineTab.tsx with expandable agent rows
- Created `AgentDetailPanel` component showing metrics grid (variants, matches, cost, diversity)
- Added iteration header with summary (agent count, total variants, total cost)
- Added `AGENT_PALETTE` for color-coded agent indicators
- Used `expandedAgents` Set state for multi-expand support

### Issues Encountered
- Workflow hook blocked edits until `_status.json` was properly configured with prerequisites
- Resolved by reading required docs and updating status file

## Phase 6: Unit Tests
### Work Done
- Created `evolutionVisualizationActions.test.ts` with 7 tests for:
  - Multiple agents per iteration
  - variantsAdded diffing
  - matchesPlayed diffing
  - eloChanges diffing
  - Iteration totals
  - Invalid run ID handling
  - Empty checkpoints handling
- Created `TimelineTab.test.tsx` with 14 tests for:
  - Rendering, loading, error states
  - Expandable row behavior (expand, collapse, multi-expand)
  - AgentDetailPanel metrics display
  - Null/error handling

### All Tests Passing
- 7/7 server action tests
- 14/14 UI component tests
