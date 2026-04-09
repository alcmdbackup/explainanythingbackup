# Fix Bugs Evolution 20260409 Research

## Problem Statement

This project fixes several bugs and UX gaps in the Evolution pipeline admin UI. Key issues include cost display discrepancies where run list entries show cost exceeding the budget cap while detail pages show lower values, incorrect "hide test content" filtering that excludes non-test runs, and broken dropdown/filter controls in the logs tab. Additional work includes adding jump-to-page navigation across all entity list views, fixing an incorrect "explanation" column in the run list view, adding agent name filtering to the invocation list view, and covering all fixes with E2E/integration/unit tests.

## Requirements (from GH Issue #938)

- Cost for some runs can exceed components
    - Runs c4057835 and eb62d393 have cost exceeding budget on run list overview entry
    - Cost on details is much lower
    - Verify this via playwright
- Run c4057835 only has 4 variants
- Hide test content on runs list view hides runs not related to test
    - c4057835 is NOT a test run, figure out why its being hidden
- Improve logs tab for runs (and also generally)
    - Add a way to jump to a given page (including last page)
    - Dropdowns and filters all seem broken. Fix and then add E2E/integration/unit tests
- List view improvements
    - All entity list views should have ways to jump to a given page
    - Improve list of filters based on UX
    - Invocation list view specifically should allow filtering based on agent name
- Run list view has a column called "explanation" - this seems wrong

## High Level Summary

5 rounds of 4-agent parallel research identified root causes for all bugs:

1. **Cost discrepancy**: Run list sums ALL `evolution_agent_invocations.cost_usd` (including post-budget invocations), while detail Metrics tab shows the `cost` metric from `evolution_metrics` (written at finalization via costTracker). Separately, the detail page has duplicate "Generation Cost"/"Ranking Cost" cards because both static finalization metrics (`total_generation_cost`, `total_ranking_cost`) and live dynamic metrics (`agentCost:generation`, `agentCost:ranking`) exist with the same rendered labels. `MetricGrid` uses label as React key, causing duplicate key errors.

2. **Hide test content filters all runs**: The NOT IN filter syntax `query.not('strategy_id', 'in', \`(${ids.join(',')})\`)` passes a parenthesized string rather than an array. Supabase JS v2 `.not(col, 'in', value)` expects an array like `.not(col, 'in', [id1, id2])`. The string format may cause undefined behavior. Used in 4 files: `evolutionActions.ts`, `invocationActions.ts`, `evolutionVisualizationActions.ts`, and the integration test.

3. **Explanation column**: The `evolution_runs.explanation_id` column was intentionally dropped during the V2 schema migration (noted in migration comment). It's not in the SELECT query, so always null — the column always shows the run ID fallback. Options: restore the column via migration, or remove the column from the runs table.

4. **LogsTab filter bugs**: (a) Agent name filter uses `.eq()` (exact match) in `logActions.ts:69` — should use `.ilike()` for partial matching. (b) Iteration dropdown renders with `value={i}` (number) but state is string — visual selection mismatch, fix with `value={String(i)}`. (c) No debounce on agent and variant ID text filter inputs in LogsTab.

5. **Run c4057835 only has 4 variants**: Not a code bug. The budget cap is $0.05 — very small. The pipeline stops generating variants when budget is exhausted. 4 variants were generated before budget ran out.

6. **Jump-to-page missing**: All 6 entity list pages use `EntityListPage`'s sliding-window paginator. `LogsTab` has Previous/Next only. Neither has jump-to-page. Infrastructure is in place — just needs UI input + wiring.

7. **Invocation list missing agent name filter**: Variants page already has the pattern. 3-file change needed.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/reference.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/visualization.md
- evolution/docs/logging.md
- evolution/docs/cost_optimization.md
- evolution/docs/agents/overview.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/debugging_skill.md
- docs/feature_deep_dives/request_tracing_observability.md

## Code Files Read

### Cost / Run List
- `evolution/src/services/evolutionActions.ts` — `getEvolutionRunsAction` (lines 193-281), `getEvolutionRunByIdAction` (lines 309-344)
- `evolution/src/components/evolution/tables/RunsTable.tsx` — `getBaseColumns()`, cost rendering
- `src/app/admin/evolution/runs/page.tsx` — filter definitions, page size, fetchData
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — `resolveLabel()`, MetricGrid grouping, key bug
- `evolution/src/components/evolution/primitives/MetricGrid.tsx` — `key={metric.label}` bug on line 62
- `evolution/src/lib/metrics/registry.ts` — metric definitions, `agentCost:*` dynamic metrics
- `evolution/src/lib/metrics/RunEntity.ts` — run entity metric registry
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — cost metric writes at finalization

### Hide Test Content Filter
- `evolution/src/services/shared.ts` — `getTestStrategyIds()`, `isTestContentName()`, `TIMESTAMP_NAME_PATTERN`, `applyTestContentNameFilter()`
- `evolution/src/services/invocationActions.ts` — same broken NOT IN pattern (line 82)
- `evolution/src/services/evolutionVisualizationActions.ts` — same broken NOT IN pattern (lines 83, 91)
- `evolution/src/services/experimentActions.ts` — correct pattern using `applyTestContentNameFilter()`

### LogsTab
- `evolution/src/components/evolution/tabs/LogsTab.tsx` — full component, filter state, dependency arrays
- `evolution/src/services/logActions.ts` — `getEntityLogsAction`, filter application, `.eq()` vs `.ilike()`

### EntityListPage / Pagination
- `evolution/src/components/evolution/EntityListPage.tsx` — paginator render (lines 295-327), props interface
- `src/app/admin/evolution/variants/page.tsx` — agent name filter reference
- `src/app/admin/evolution/invocations/page.tsx` — invocations page (no agent name filter)

### Explanation Column
- `evolution/src/services/evolutionActions.ts` line 212 — SELECT missing `explanation_id`
- `evolution/src/components/evolution/tables/RunsTable.tsx` lines 68-92 — explanation column render

## Key Findings

### Finding 1: Cost Discrepancy — Two Cost-Tracking Systems, Both Correct But Confusing

**Note: The underlying cost tracking bugs are being fixed in a separate project. This project only needs to fix the UI display.**

**Confirmed via DB query on run c4057835 (`evolution_metrics` rows):**

| metric_name | value | system |
|---|---|---|
| `cost` | $0.0498 | Budget tracker (in-process, has race conditions) |
| `agentCost:generation` | $0.0085 | `createLLMClient` live writes |
| `agentCost:ranking` | $0.0413 | `createLLMClient` live writes |
| `total_generation_cost` | $0.1565 | `persistRunResults` at finalization (50% of invocation sum) |
| `total_ranking_cost` | $0.1565 | `persistRunResults` at finalization (50% of invocation sum) |

**Invocation sum (what run list shows):** 9 `generate_from_seed_article` invocations × ~$0.035 = **$0.31307**

`total_generation_cost + total_ranking_cost = $0.313 ≈ $0.31307` ✓ — the pair is correct.

**Root cause of `generate_from_seed_article` 50/50 split** (`persistRunResults.ts:309-311`):
```typescript
if (inv.agent_name === 'generate_from_seed_article') {
  totalGenerationCost += cost / 2;   // deliberate coarse approximation
  totalRankingCost    += cost / 2;   // comment says: "follow-up to fix properly"
}
```
The run list shows $0.31 (invocation sum) which is accurate. The "Total Cost" card shows $0.05 (budget tracker) — misleading because it's the budget-enforced view with known race conditions.

**Duplicate metric cards bug** (UI fix needed):
- `agentCost:generation` + `total_generation_cost` both resolve to label "Generation Cost" via `resolveLabel()` in `EntityMetricsTab.tsx:44-54`
- `agentCost:ranking` + `total_ranking_cost` both resolve to "Ranking Cost"
- `MetricGrid.tsx:62` uses `key={metric.label}` → duplicate React keys → console error
- **Fix**: use `metric.name` as key in MetricGrid; suppress/hide `agentCost:*` metrics in the cost section since `total_generation_cost`/`total_ranking_cost` supersede them

### Finding 2: Hide Test Content — Broken NOT IN Syntax

**File**: `evolution/src/services/evolutionActions.ts:224`
```typescript
// BROKEN - string format:
query = query.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);

// CORRECT - array format:
query = query.not('strategy_id', 'in', testStrategyIds);
```

Supabase JS v2 `.not(col, 'in', value)` expects an array, not a parenthesized string. Same bug in:
- `evolutionActions.ts:600` (variants filter)
- `invocationActions.ts:82` (invocations filter)
- `evolutionVisualizationActions.ts:83,91` (visualization filter)
- `src/__tests__/integration/evolution-test-content-filter.integration.test.ts:108,167`

**Secondary issue**: `TIMESTAMP_NAME_PATTERN` (`/^.*-\d{10,13}-.*$/`) is applied in `isTestContentName()` client-side but NOT in the DB query in `getTestStrategyIds()`. Timestamp-named strategies won't be returned by the DB query and thus won't be filtered. However this is a secondary/separate issue from the core NOT IN syntax bug.

### Finding 3: Explanation Column — Missing DB Column

`evolution_runs.explanation_id` was dropped during V2 migration and not restored (migration comment: "lost during V2 wipe, deferred to separate work"). It is NOT in the SELECT query (`evolutionActions.ts:212`), so always `null`. The column renders run ID as fallback.

Fix options:
- **(a) Remove** the "Explanation" column from `getBaseColumns()` — simplest, since the feature is non-functional
- **(b) Restore** — requires new migration + add `explanation_id` to SELECT + select query

The `buildExplanationUrl()` and batch-fetch code (lines 256-270) are already correct; only the SELECT is missing if restoring.

### Finding 4: LogsTab Filter Issues

1. **Agent name exact match** (`logActions.ts:69`): Uses `.eq('agent_name', filters.agentName)` — change to `.ilike('agent_name', \`%${filters.agentName}%\`)` 
2. **Iteration dropdown type mismatch** (`LogsTab.tsx:136`): `value={i}` (number) but state is string. Change to `value={String(i)}`
3. **Missing debounce**: Agent and variantId text inputs trigger immediate fetches. Add debounce (~300ms) matching the messageSearch pattern
4. The filter application logic (useCallback + useEffect dependency chain) is fundamentally correct — filters DO get applied when state changes

### Finding 5: Run c4057835 — 4 Variants Expected

- `budget_cap_usd` is very small (confirmed $0.05 via Playwright)
- Pipeline stops generating variants on budget exhaustion
- 4 variants generated before budget ran out — this is correct behavior
- Not a code bug; it's working as designed

### Finding 6: Jump-to-Page Infrastructure Ready

**EntityListPage** (`EntityListPage.tsx:295-327`):
- Has `page`, `totalPages`, `onPageChange` available
- Just needs: number input + Enter handler calling `onPageChange(clampedPage)`
- Also add "Last" button calling `onPageChange(totalPages)`

**LogsTab** (`LogsTab.tsx:223-241`):
- Has `currentPage`, `totalPages`, `offset`, `PAGE_SIZE` available  
- Just needs: number input + Enter handler calling `setOffset((pageNum-1) * PAGE_SIZE)`

### Finding 7: Filter Audit — Gaps Across All Entity List Pages

| Page | Current Filters | Missing (high-impact) |
|---|---|---|
| **Runs** | Status, Hide test content | Strategy filter (backend supports `strategy_id`), Prompt filter (backend supports `promptId`) |
| **Variants** | Agent Name, Winner, Hide test content | Run ID filter (backend supports `runId` but not exposed) |
| **Invocations** | Status, Hide test content | **Agent name** (known, planned), Run ID (backend supports `runId`) |
| **Experiments** | Status, Hide test content | **Name text search** (no search despite Name being primary column) |
| **Strategies** | Status, Pipeline type, Origin, Hide test content | Label/description search (low priority) |
| **Prompts** | Status, Hide test content | **Name text search**, prompt text search |

**Priority additions for this project:**
1. **Experiments**: add name text search — requires backend change to `experimentActionsV2.ts`
2. **Prompts**: add name text search — requires backend change to prompts service
3. **Invocations**: add agent name filter (already planned in Finding 8)
4. **Runs**: expose strategy filter — backend already supports `strategy_id`, just needs UI filter def

### Finding 8: Agent Name Filter for Invocations — 3-File Change

1. **`invocationActions.ts`**: Add `agentName: z.string().optional()` to Zod schema; add `.ilike('agent_name', \`%${parsed.agentName}%\`)` to query
2. **`invocations/page.tsx`**: Add `{ key: 'agentName', label: 'Agent Name', type: 'text', placeholder: 'Filter by agent...' }` to FILTERS; add `agentName: filters.agentName || undefined` to action call

## Open Questions

1. **Explanation column**: Remove or restore? Remove is simpler; restore adds useful feature. Recommend: **remove the column** from RunsTable to avoid confusion, add TODO comment for future restoration.
2. **Cost display**: Should we align both to use invocation sum (consistent) or fix the finalization cost metric to be more accurate? The invocation sum is the "source of truth" per code comments.
3. **NOT IN syntax**: Confirm the broken syntax actually causes the "all runs hidden" behavior by checking the Supabase JS docs or running tests.
