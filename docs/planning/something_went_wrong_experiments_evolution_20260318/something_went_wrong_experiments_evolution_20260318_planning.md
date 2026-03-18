# Something Went Wrong Experiments Evolution Plan

## Background
Bugs in production - 1. going to experiments page after starting a single experiment gives "something is wrong" error 2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist" 3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## Requirements (from GH Issue #729)
1. Going to experiments page after starting a single experiment gives "something is wrong" error
2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist"
3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## Problem
All 3 bugs stem from the V2 evolution migration (`20260315000001_evolution_v2.sql`) dropping and recreating tables with a simplified schema, while the V2 UI code still references V1-only columns. The experiments page crashes because `ExperimentHistory.tsx` calls `.toFixed(2)` on `spentUsd`/`totalBudgetUsd` fields that don't exist in V2. The run detail page crashes because `getEvolutionRunTimelineAction` queries the `agent_attribution` column which was dropped in V2. The run itself likely completed successfully — the failure is purely in the display layer.

## Options Considered

### Option A: Minimal fix — remove V1 column references (Recommended)
- Remove `agent_attribution` from SELECT queries, types, and all downstream consumers
- Fix `ExperimentHistory.tsx` to handle V2 data shape (no budget fields, snake_case dates)
- **Pros**: Smallest change, directly addresses all 3 symptoms
- **Cons**: Loses attribution display (but column doesn't exist anyway)

### Option B: Re-add columns via migration
- Create migration to add `agent_attribution` back to the V2 schema
- Add `spentUsd`/`totalBudgetUsd` computed fields to experiments
- **Pros**: Restores V1 functionality
- **Cons**: Over-engineering — V2 intentionally simplified the schema

### Decision: Option A
The V2 schema intentionally simplified these tables. Fix the code to match the schema.

## Rollback Plan
All changes are purely subtractive (removing references to non-existent columns). If regressions occur, the commit can be reverted with `git revert <sha>`. No migrations or data changes are involved beyond the already-committed RLS fix.

## Phased Execution Plan

### Phase 1: Remove `agent_attribution` from visualization actions + types

**File: `evolution/src/services/evolutionVisualizationActions.ts`**

1. **Line 16** — Remove unused `AgentAttribution` import (lint will fail if kept)

2. **Line ~71** — Remove `agentAttribution` from `TimelineData` agent interface:
```typescript
// Remove this field from the interface
agentAttribution?: AgentAttribution;
```

3. **Line ~204** — Remove `agentAttribution` from `InvocationFullDetail` interface:
```typescript
// Remove this field from the interface
agentAttribution: AgentAttribution | null;
```

4. **Line 339** — Remove `agent_attribution` from timeline SELECT:
```typescript
// Before
.select('id, iteration, agent_name, cost_usd, execution_detail, agent_attribution, execution_order')
// After
.select('id, iteration, agent_name, cost_usd, execution_detail, execution_order')
```

5. **Line 399** — Remove `agentAttribution` mapping in timeline builder:
```typescript
// Remove this line
agentAttribution: (inv.agent_attribution as AgentAttribution) ?? undefined,
```

6. **Line 966** — Remove `agent_attribution` from invocation detail SELECT:
```typescript
// Before
.select('id, run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, error_message, execution_detail, agent_attribution, created_at')
// After
.select('id, run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, error_message, execution_detail, created_at')
```

7. **Line 1108** — Remove `agentAttribution` from invocation detail return:
```typescript
// Remove this line
agentAttribution: (inv.agent_attribution as AgentAttribution) ?? null,
```

### Phase 1b: Remove `agentAttribution` from downstream UI consumers

**File: `evolution/src/components/evolution/tabs/TimelineTab.tsx`**

8. **Lines 473-488** — Remove the `agentAttribution` rendering block. This code conditionally renders `AttributionBadge` using `agent.agentAttribution`. After Phase 1, this field will always be `undefined`, making the code dead. Remove the entire conditional block.

### Phase 2: Fix `ExperimentHistory.tsx` (Issue 1)

**File: `src/app/admin/evolution/_components/ExperimentHistory.tsx`**

1. **Lines 19-22** — Update `ExperimentSummary` interface to match V2 shape:
```typescript
interface ExperimentSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;  // V2 returns snake_case from raw DB
  runCount: number;
}
```

2. **Line 86** — Replace budget display with run count:
```typescript
// Before
<span>${experiment.spentUsd.toFixed(2)} / ${experiment.totalBudgetUsd.toFixed(2)}</span>
// After
<span>{experiment.runCount} run{experiment.runCount !== 1 ? 's' : ''}</span>
```

3. **Line 88** — Fix date field to use snake_case `created_at`:
```typescript
// Before
{new Date(experiment.createdAt).toLocaleDateString()}
// After
{new Date(experiment.created_at).toLocaleDateString()}
```

### Phase 3: Fix RLS for debugging (already done)

Migration `20260318000001_evolution_readonly_select_policy.sql` already committed — adds SELECT policies for `readonly_local` on all evolution tables.

### Phase 4: Update tests

**File: `evolution/src/services/evolutionVisualizationActions.test.ts`**
- Remove all `agent_attribution` fields from mock data (~17 occurrences)
- Remove any assertions on `agentAttribution` in result objects

**File: `src/app/admin/evolution/_components/ExperimentHistory.test.tsx`**
- Remove `spentUsd` and `totalBudgetUsd` from mock experiment data
- Update any rendered output assertions (budget → run count)
- Change `createdAt` to `created_at` in mock data

**File: `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.test.tsx`**
- Remove `agentAttribution: null` from `baseInvocation` mock (line 37)

### Phase 5: Verify

1. Run lint: `npm run lint`
2. Run tsc: `npx tsc --noEmit`
3. Run build: `npm run build`
4. Run unit tests: `npm test`
5. Specifically verify these test files pass:
   - `evolutionVisualizationActions.test.ts`
   - `ExperimentHistory.test.tsx`
   - `InvocationDetailContent.test.tsx`
   - `TimelineTab.test.tsx`

## Testing

### Unit tests to modify
- `evolution/src/services/evolutionVisualizationActions.test.ts` — Remove `agent_attribution` from ~17 mock data entries
- `src/app/admin/evolution/_components/ExperimentHistory.test.tsx` — Update mock data to V2 shape, update rendered output assertions
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.test.tsx` — Remove `agentAttribution: null` from mock

### No new tests needed
- Existing tests cover the affected code paths; just need updating to match V2 schema

### Manual verification
- After deploy, visit `/admin/evolution/experiments` — should load without crash
- Visit run detail page for run 2e34834a — timeline should load without agent_attribution error
- Confirm run status displays correctly

## Documentation Updates
No documentation updates needed — this is a V2 schema alignment fix.
- `docs/docs_overall/debugging.md` — no change
- `docs/feature_deep_dives/error_handling.md` — no change
- `docs/docs_overall/environments.md` — no change (RLS migration is self-documenting)

## Dead code note (out of scope)
The following are left as dead code by this fix and can be cleaned up separately:
- `AgentAttribution` type in `evolution/src/lib/types.ts` (line 671) and re-export in `evolution/src/lib/index.ts`
- `AttributionBadge` component in `evolution/src/components/evolution/AttributionBadge.tsx`
- V1 `experimentActions.ts` budget-related code
