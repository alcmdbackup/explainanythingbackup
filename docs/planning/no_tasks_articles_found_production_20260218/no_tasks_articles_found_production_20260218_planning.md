# No Tasks Articles Found Production Plan

## Background
The article and task tabs under "explorer" in production currently have no data. The "task" tab needs to be renamed to "agents", and both tabs need to be fixed to correctly populate with data.

## Requirements (from GH Issue #467)
1. Rename the "task" tab to "agents" under explorer
2. Fix the articles tab to display data correctly in production
3. Fix the agents (formerly tasks) tab to display data correctly in production

## Root Cause (from research)

**No evolution run has ever completed in production.** All 10 production runs are `failed` (8) or `pending` (2). Variants and agent metrics are only written to the database during `finalizePipelineRun()`, which only executes on run completion. The data exists in checkpoint `state_snapshot` JSONB blobs but never reaches `evolution_variants` or `evolution_run_agent_metrics`.

**Why runs fail:** Vercel was hard-killing the serverless function before the pipeline's soft timeout could fire. Fluid Compute was not enabled, so the actual timeout was ~300s (5 min) instead of the configured 800s (13 min). Hard-kills leave no JavaScript cleanup — no error_message, no completed_at, no checkpoint.

**Why tournament is the bottleneck:** The tournament agent makes 80+ parallel LLM calls in a single `execute()` call. The pipeline only checks time between iterations, not between agents. A tournament that exceeds the remaining time budget causes a hard-kill.

## Solution

### Phase 1: UI Rename (DONE)
- [x] Changed tab label from "Task" to "Agents"
- [x] Updated page subtitle and empty state text
- [x] Changed default date preset to "All Time"
- [x] Added error toasts for visibility

**Files modified:** `src/app/admin/quality/explorer/page.tsx`

### Phase 2: Time-Aware Tournament

Add time awareness to the tournament agent so it yields gracefully before the Vercel function deadline, rather than being hard-killed.

**IMPORTANT — Execution order:** Steps 2.1 and 2.4 (type changes in `types.ts`) MUST be applied before Steps 2.2 and 2.3. TypeScript strict mode will reject `ctx.timeContext` assignment and `exitReason = 'time_limit'` if the types are not already extended. Apply types.ts changes first, then pipeline.ts and tournament.ts.

#### Step 2.1: Add `timeContext` to ExecutionContext + `time_limit` exit reason

**File:** `src/lib/evolution/types.ts`

Both type changes go in the same file, applied together as a single commit-safe unit:

```typescript
// 1. Add to ExecutionContext interface (around line 355):
export interface ExecutionContext {
  // ... existing fields ...
  timeContext?: {
    startMs: number;
    maxDurationMs: number;
  };
}

// 2. Update TournamentExecutionDetail.exitReason union (around line 185):
exitReason: 'convergence' | 'budget' | 'stale' | 'maxRounds' | 'time_limit';
```

Run `npx tsc --noEmit` after this step to confirm no downstream breakage. Adding a new member to a string union is backward compatible — existing switch statements with a default case will still compile. Scan for exhaustive switches on `exitReason` (grep for `case 'maxRounds'`) and add `case 'time_limit'` handling if found.

#### Step 2.2: Pipeline passes time context to agents

**File:** `src/lib/evolution/core/pipeline.ts`

**Exact insertion point:** Line 387, immediately BEFORE `for (const agentName of config.activeAgents)` at line 388. This is inside the iteration loop but after all setup code (time check at 331, status check at 340, supervisor.beginIteration at 352, shouldStop at 381). The `ctx` object is shared, so timeContext only needs to be set once — but placing it inside the loop is harmless (same values each iteration) and keeps it close to where agents consume it.

```typescript
// Pass time context to agents for intra-agent time awareness
if (options.maxDurationMs && options.startMs) {
  ctx.timeContext = { startMs: options.startMs, maxDurationMs: options.maxDurationMs };
}
```

Note: Using truthiness check (`&&`) to match the existing guard pattern at line 331. Both guards use the same semantics for consistency. The only scenario where `!= null` would differ is `startMs === 0`, which cannot occur in practice (startMs is `Date.now()`).

**Known limitation:** Runs triggered via `evolutionActions.ts` (admin dashboard) pass `startMs` but do NOT pass `maxDurationMs`, so the truthiness guard prevents `ctx.timeContext` from being set. The tournament time check gracefully no-ops when `ctx.timeContext` is undefined. Admin-triggered runs on Vercel are still subject to the same hard-kill risk, but they run less frequently and can be addressed in a follow-up by passing time options from the admin action.

#### Step 2.3: Tournament checks time at TOP of each round

**File:** `src/lib/evolution/agents/tournament.ts`

**CRITICAL: Placement must be at the TOP of the round loop** (line 244, immediately after `for (let round = 0; ...)`), BEFORE `swissPairing()` (line 251) and BEFORE `Promise.allSettled` (line 279). Placing the check after the convergence block (~line 393) would be too late — a slow round with 80+ LLM calls via `Promise.allSettled` would already have run to completion.

Insert at line 245, before the existing `if (totalComparisons >= maxComparisons)` check:

```typescript
// Time-based yield: exit BEFORE committing to an expensive round
if (ctx.timeContext) {
  const elapsed = Date.now() - ctx.timeContext.startMs;
  const remaining = ctx.timeContext.maxDurationMs - elapsed;
  // 120s buffer for: remaining fast agents, iteration_complete checkpoint, continuation checkpoint
  if (remaining < 120_000) {
    logger.info('Tournament yielding due to time pressure', {
      round, elapsed, remaining, comparisons: totalComparisons,
    });
    exitReason = 'time_limit';
    break;
  }
}
```

The check runs at O(1) cost (just `Date.now()`) so adding it before every round has zero performance impact. This ensures we never START a round we can't finish.

The 120s buffer leaves time for: remaining fast agents in the iteration (proximity, meta_review), the `iteration_complete` checkpoint, and the continuation checkpoint. The constant is hardcoded rather than derived from `safetyMarginMs` in pipeline.ts because the tournament's buffer serves a different purpose (agent-level yield vs iteration-level yield).

### Phase 3: Tournament Resume (Pair Skipping)

Prevent redundant LLM calls when a tournament resumes after continuation by reconstructing the set of already-compared pairs from checkpointed `matchHistory`.

#### Step 3.1: Reconstruct `completedPairs` from `state.matchHistory`

**File:** `src/lib/evolution/agents/tournament.ts`

Replace the `completedPairs` initialization in `execute()` (currently line 235), BEFORE the round loop at line 244:

```typescript
// Reconstruct completed pairs from checkpointed matchHistory to avoid
// redundant LLM calls on resume after continuation timeout.
const completedPairs = new Set<string>();
for (const match of state.matchHistory) {
  completedPairs.add(normalizePair(match.variationA, match.variationB));
}
```

This works because:
- `state.matchHistory` is serialized during checkpoint (state.ts:92) and restored on resume (state.ts:128)
- `Match` stores `variationA` and `variationB` IDs (types.ts:98-99)
- `normalizePair` is module-scoped in tournament.ts (line 50), accessible within `execute()`
- `swissPairing()` already skips pairs present in `completedPairs` (tournament.ts:93)
- No changes needed to checkpoint format, state serialization, or continuation mechanism

**Not preserving** `totalComparisons`, `convergenceStreak`, or `multiTurnCount`:
- `totalComparisons` resets → fresh budget per continuation, self-regulates via budget pressure (higher spend → higher pressure → lower maxComparisons cap)
- `convergenceStreak` resets → reconverges in 1-5 rounds (sigma checks only, no LLM cost)
- `multiTurnCount` resets → bounded by budget pressure system

**Cost note:** Resetting `totalComparisons` means each continuation gets up to `maxComparisons` new comparisons. With `completedPairs` preventing re-comparison, this budget is spent on genuinely new pairs. Budget pressure increases across continuations (costTracker preserved), naturally reducing `maxComparisons` from 40 → 25 → 15 as spend accumulates.

### Phase 4: Clean Up Stale Production Runs

#### Step 4.1: Preview stale runs before cleanup (dry-run)

Run against production Supabase FIRST as a SELECT to verify:
```sql
-- DRY RUN: preview what will be updated
SELECT id, status, current_iteration, total_cost_usd, created_at,
       (SELECT count(*) FROM evolution_checkpoints WHERE run_id = r.id) AS checkpoint_count
FROM evolution_runs r
WHERE status IN ('pending', 'claimed', 'running')
  AND created_at < NOW() - INTERVAL '1 hour';
```

#### Step 4.2: Mark stale runs as failed

After verifying the dry-run output is correct:
```sql
UPDATE evolution_runs
SET status = 'failed',
    error_message = 'Manually failed: stale from pre-Fluid-Compute timeout'
WHERE status IN ('pending', 'claimed', 'running')
  AND created_at < NOW() - INTERVAL '1 hour';
```

Note: This marks the 2 orphaned pending runs (30d01212, 0197aa4b) as failed. Their checkpoint data is preserved in `evolution_checkpoints` but will not be resumed. New runs must be created to generate fresh data.

#### Step 4.3: Redeploy and verify Fluid Compute is active

```bash
# Trigger production redeployment
vercel --prod
```

After redeployment, create a test run and monitor:
- Check Vercel function logs for duration > 300s (confirms 800s timeout is active)
- Verify checkpoint writes via: `SELECT count(*) FROM evolution_checkpoints WHERE run_id = '<new-run-id>'`
- Confirm run reaches `completed` status
- Confirm `evolution_variants` and `evolution_run_agent_metrics` get populated

## Files to Modify

| File | Phase | Change | Depends on |
|------|-------|--------|------------|
| `src/app/admin/quality/explorer/page.tsx` | 1 (DONE) | UI rename + date filter | — |
| `src/lib/evolution/types.ts` | 2.1 | Add `timeContext` to ExecutionContext + `time_limit` exit reason | — |
| `src/lib/evolution/core/pipeline.ts` | 2.2 | Pass `timeContext` to ctx before agent execution | types.ts (2.1) |
| `src/lib/evolution/agents/tournament.ts` | 2.3, 3.1 | Time check between rounds + completedPairs reconstruction | types.ts (2.1) |

## Testing Strategy

### Required new tests (MUST be written in this PR):

**Timer strategy:** Do NOT use `jest.useFakeTimers()` — it intercepts microtask scheduling and will deadlock `Promise.allSettled` inside the tournament round loop. Instead, mock `Date.now` directly with `jest.spyOn(Date, 'now')`, since the time check only reads `Date.now()`.

**`makeCtx()` extension:** The existing signature is `makeCtx(responses: string[], poolSize?, availableBudget?)`. Add an optional 4th parameter:
```typescript
function makeCtx(
  responses: string[],
  poolSize = 4,
  availableBudget = 5,
  options?: { timeContext?: { startMs: number; maxDurationMs: number } },
): { ctx: ExecutionContext; state: PipelineStateImpl } {
  // ... existing body ...
  const ctx: ExecutionContext = {
    // ... existing fields ...
    ...(options?.timeContext && { timeContext: options.timeContext }),
  };
  return { ctx, state };
}
```

**`runComparison` mocking:** All tournament tests that call `execute()` rely on the existing `makeMockLLMClient(responses)` which mocks `llmClient.complete()`. The `PairwiseRanker.compareWithBiasMitigation` calls flow through this mock. No additional mock is needed for `runComparison` — it's a private method.

#### Test 1: Tournament time-limit exit (`tournament.test.ts`)
```typescript
it('exits with time_limit when remaining time < 120s', async () => {
  const realStartMs = 1000;
  // maxDurationMs=180_000, so buffer triggers when remaining < 120_000
  // elapsed must be > 60_000 to trigger
  const { ctx, state } = makeCtx(['A', 'B'], 4, 5, {
    timeContext: { startMs: realStartMs, maxDurationMs: 180_000 },
  });
  // Mock Date.now to return startMs + 61_000 (remaining = 119_000 < 120_000)
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realStartMs + 61_000);
  const result = await tournament.execute(ctx);
  expect(result.executionDetail!.exitReason).toBe('time_limit');
  expect(result.success).toBe(true);
  spy.mockRestore();
});

it('does not exit early when time is sufficient', async () => {
  const realStartMs = 1000;
  const { ctx } = makeCtx(['A', 'B'], 4, 5, {
    timeContext: { startMs: realStartMs, maxDurationMs: 600_000 },
  });
  // remaining = 599_000 → plenty of time
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realStartMs + 1_000);
  const result = await tournament.execute(ctx);
  expect(result.executionDetail!.exitReason).not.toBe('time_limit');
  spy.mockRestore();
});

it('works normally when timeContext is undefined', async () => {
  const { ctx } = makeCtx(['A', 'B'], 4);
  // No timeContext → time check is a no-op
  const result = await tournament.execute(ctx);
  expect(result.success).toBe(true);
  expect(result.executionDetail!.exitReason).not.toBe('time_limit');
});
```

#### Test 2: CompletedPairs reconstruction (`tournament.test.ts`)
```typescript
it('skips previously compared pairs from matchHistory on resume', async () => {
  const { ctx, state } = makeCtx(['A', 'B'], 3);
  // Pre-populate matchHistory with known pairs (simulating checkpoint restore)
  // Use variant IDs that match the pool (v-0, v-1, v-2 from makeState)
  state.matchHistory = [
    { variationA: 'v-0', variationB: 'v-1', winner: 'v-0', confidence: 0.8, turns: 2, dimensionScores: {} },
  ];
  const result = await tournament.execute(ctx);
  // Verify no new matches between v-0 and v-1
  const newMatches = state.matchHistory.slice(1); // skip pre-populated
  for (const m of newMatches) {
    const pair = [m.variationA, m.variationB].sort().join('|');
    expect(pair).not.toBe('v-0|v-1');
  }
});
```

#### Test 3: Pipeline timeContext wiring (`pipeline.test.ts`)
```typescript
it('sets timeContext on ExecutionContext when startMs and maxDurationMs provided', async () => {
  // Use spy or mock to capture the ctx passed to agent.execute()
  // Call executeFullPipeline with options: { startMs: 1000, maxDurationMs: 740000 }
  // Verify ctx.timeContext === { startMs: 1000, maxDurationMs: 740000 }
});

it('does not set timeContext when options are missing', async () => {
  // Call executeFullPipeline without startMs/maxDurationMs
  // Verify ctx.timeContext is undefined
});
```

#### Test 4: 120s buffer boundary validation (`tournament.test.ts`)
```typescript
it('does NOT exit when remaining time is exactly 120_001ms', async () => {
  const realStartMs = 1000;
  const { ctx } = makeCtx(['A', 'B'], 4, 5, {
    timeContext: { startMs: realStartMs, maxDurationMs: 200_000 },
  });
  // remaining = 200_000 - 79_999 = 120_001 → above threshold → no time_limit
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realStartMs + 79_999);
  const result = await tournament.execute(ctx);
  expect(result.executionDetail!.exitReason).not.toBe('time_limit');
  spy.mockRestore();
});

it('exits when remaining time is exactly 119_999ms', async () => {
  const realStartMs = 1000;
  const { ctx } = makeCtx(['A', 'B'], 4, 5, {
    timeContext: { startMs: realStartMs, maxDurationMs: 200_000 },
  });
  // remaining = 200_000 - 80_001 = 119_999 → below threshold → time_limit
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realStartMs + 80_001);
  const result = await tournament.execute(ctx);
  expect(result.executionDetail!.exitReason).toBe('time_limit');
  spy.mockRestore();
});
```

#### Required update to existing test: exitReason assertion (`tournament.test.ts`)

Line 470 of the existing test asserts `expect(['budget', 'convergence', 'stale', 'maxRounds']).toContain(detail.exitReason)`. This MUST be updated to include `'time_limit'`:

```typescript
// tournament.test.ts line 470 — add 'time_limit' to valid exit reasons
expect(['budget', 'convergence', 'stale', 'maxRounds', 'time_limit']).toContain(detail.exitReason);
```

This is a **blocking** requirement — without it, existing tests will fail when the new exit reason is added to the union type.

### Existing tests that must still pass:
- `src/lib/evolution/agents/__tests__/tournament.test.ts`
- `src/lib/evolution/core/__tests__/pipeline.test.ts`
- `src/lib/evolution/core/__tests__/pipelineFlow.test.ts`
- `src/lib/evolution/core/__tests__/pipelineUtilities.test.ts`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

## Rollback Plan

| Phase | Rollback method |
|-------|----------------|
| Phase 1 (UI) | Revert the single commit to `page.tsx` |
| Phase 2+3 (tournament) | Revert commits to `types.ts`, `pipeline.ts`, `tournament.ts`. The `timeContext` field is optional, so removing it is backward compatible. No schema/migration changes involved. |
| Phase 4 (SQL cleanup) | Irreversible — the stale runs cannot be automatically un-failed. To retry them, create new runs manually. Checkpoint data in `evolution_checkpoints` is preserved and could theoretically be used to seed new runs. |
| Vercel Fluid Compute | Dashboard setting — can be toggled off if needed, though this would re-introduce the 300s timeout. |

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Tournament yields too early, ratings not useful | 120s buffer is conservative; partial ratings are valid since updated per-round |
| Other agents also slow (debate, sectionDecomposition) | `timeContext` is on ExecutionContext — can add checks to other agents later |
| `loadCheckpointForResume` only finds `iteration_complete` checkpoints | Tournament yields early → remaining fast agents finish → `iteration_complete` checkpoint written normally |
| Status guard race conditions (Bug 2 from research) | Out of scope for this PR — tracked as separate improvement |
| Vercel Fluid Compute setting not in version control | Document in CLAUDE.md or vercel.json comment; setting is project-wide and visible in Vercel dashboard |
| `totalComparisons` reset allows more LLM spend per run | Self-regulates via budget pressure: costTracker preserved across continuations → pressure rises → maxComparisons cap drops |
| Downstream code exhaustively switches on exitReason | Scan for `case 'maxRounds'` patterns; add `case 'time_limit'` or ensure default clause exists. Update existing test assertion at tournament.test.ts line 470 (now an explicit step in Testing Strategy). |
| Admin-triggered runs lack timeContext | `evolutionActions.ts` passes `startMs` but not `maxDurationMs` → guard skips → tournament time check is a no-op. Gracefully degrades (same behavior as before this PR). Follow-up: pass `maxDurationMs` from admin action. |

## Out of Scope (Future Work)

- Incremental variant persistence during checkpoints (show data for in-progress runs)
- Status guard assertion improvements (log/throw on no-op updates)
- Agent-level resume within an iteration (skip already-completed agents)
- Time-awareness for other long-running agents (debate, sectionDecomposition)
- Extract 120_000ms buffer as a named constant shared across tournament and pipeline
- Pass `startMs`/`maxDurationMs` from admin-triggered runs (`evolutionActions.ts`) for time-aware tournament
