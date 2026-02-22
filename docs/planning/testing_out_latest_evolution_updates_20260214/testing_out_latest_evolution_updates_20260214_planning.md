# Testing Out Latest Evolution Updates Plan

## Background
Run the full evolution pipeline locally and on staging to validate all recent changes work correctly together. Test new features on the evolution pipeline and dashboard to ensure they function properly end-to-end. During testing, two bugs were discovered: (1) supervisor config validation crashes on strategies with low iteration counts, leaving runs permanently stuck in "running" status, and (2) the inline trigger action doesn't mark runs as failed when the pipeline throws before any agent executes.

## Requirements (from GH Issue #434)
- Run all evolution-related unit and integration tests to validate correctness
- Run evolution-local.ts with --full --mock and --full with real LLM, check all agents execute, budget/iteration stops work
- Test new features on the evolution pipeline and dashboard
- Fix discovered bugs: supervisor config validation crash and missing error status update

## Problem
When a strategy specifies `iterations: 3` (or any value ≤ 8), the `PoolSupervisor` constructor throws because `maxIterations (3) <= expansion.maxIterations (8)`. This error occurs after `executeFullPipeline` sets the run status to 'running' but before any agent runs. The `triggerEvolutionRunAction` catch block returns an error to the client but never updates the run's DB status to 'failed', leaving zombie runs that show no data on the dashboard and can never be recovered.

## Options Considered

### Option A: Auto-adjust expansion config when maxIterations is small
- In `resolveConfig()`, clamp `expansion.maxIterations` to `Math.min(expansion.maxIterations, maxIterations - plateauWindow - 1)`
- Pro: Allows short runs (3-7 iterations) to work by auto-skipping EXPANSION
- Pro: No user-facing validation error
- Con: Silently changes behavior — user might not realize EXPANSION was skipped

### Option B: Validate at queue time and reject bad configs
- Add validation in `queueEvolutionRunAction` that checks `maxIterations > expansion.maxIterations`
- Pro: Fails fast with clear error before run is created
- Con: Requires user to understand expansion config internals
- Con: Doesn't fix the zombie run problem for other crash scenarios

### Option C: Both — auto-adjust config AND add fail-safe error handling (Recommended)
- Auto-adjust expansion config in `resolveConfig()` for small iteration counts
- Add `markRunFailed()` in `triggerEvolutionRunAction` catch block as defense-in-depth
- Add `markRunFailed()` in `executeFullPipeline` catch block before re-throwing
- Clean up the two existing zombie runs
- Pro: Short runs work naturally, AND future crashes can't leave zombie runs
- Con: Slightly more code changes

## Phased Execution Plan

### Phase 1: Fix error handling gap (defense-in-depth)
**Files modified:**
- `src/lib/services/evolutionActions.ts` — Add `markRunFailed()` call in `triggerEvolutionRunAction` catch block
- `src/lib/evolution/core/pipeline.ts` — Add `markRunFailed()` in `executeFullPipeline` outer catch before re-throwing

**Changes:**

**1. Refactor `markRunFailed` in pipeline.ts (line 107-113):**
The existing signature is `markRunFailed(runId: string, agentName: string, error: unknown)`. Widen the `agentName` parameter type to `string | null` so the same helper supports pipeline-level failures (no agent context). Also add `completed_at` and a status guard `.in('status', ['pending', 'claimed', 'running'])` to prevent overwriting a terminal status.

**Behavior changes from the refactor** (intentional):
- **`completed_at` added**: Previously not set by `markRunFailed`. Now set so failed runs have a completion timestamp.
- **Status guard added**: Previously no guard — `markRunFailed` would overwrite any status. Now only transitions from non-terminal states. This is strictly safer: existing call sites (lines 758 and 1207 in `runAgent`) only call `markRunFailed` when the run is still active, so the guard is a no-op for them but prevents double-marking if another path already failed the run.
- **`agentName` type widened** from `string` to `string | null`: Existing call sites pass `agent.name` (a `string`), which satisfies `string | null`. No changes needed at call sites — this is a backward-compatible type widening.

```typescript
async function markRunFailed(runId: string, agentName: string | null, error: unknown): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const message = agentName
    ? `Agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`
    : `Pipeline error: ${error instanceof Error ? error.message : String(error)}`;
  await supabase.from('evolution_runs').update({
    status: 'failed',
    error_message: message.substring(0, 500),
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
}
```

**2. Pipeline.ts `executeFullPipeline` outer catch (line 1044-1049) — reuse `markRunFailed`:**
```typescript
catch (error) {
  pipelineSpan.recordException(error as Error);
  pipelineSpan.setStatus({ code: 2, message: (error as Error).message });
  if (logger.flush) await logger.flush().catch(() => {});
  // Mark run as failed if not already in a terminal status
  await markRunFailed(runId, null, error);
  throw error;
}
```

**3. evolutionActions.ts triggerEvolutionRunAction catch block (line 623-624):**
`markRunFailed` is a file-local function in pipeline.ts (not exported), so we inline the same DB update logic here. The status guard `.in('status', ['pending', 'claimed', 'running'])` matches the refactored `markRunFailed` to ensure idempotency — if `executeFullPipeline`'s catch already marked the run as failed, this is a no-op:
```typescript
catch (error) {
  // Mark run as failed so it doesn't stay stuck in 'running'/'pending' forever
  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from('evolution_runs').update({
      status: 'failed',
      error_message: ((error as Error).message || 'Pipeline trigger failed').substring(0, 500),
      completed_at: new Date().toISOString(),
    }).eq('id', runId).in('status', ['pending', 'claimed', 'running']);
  } catch (dbError) {
    // Log but don't throw — original error takes priority
    console.error('Failed to mark run as failed:', dbError);
  }
  return { success: false, error: handleError(error, 'triggerEvolutionRunAction', { runId }) };
}
```

### Phase 2: Auto-adjust expansion config for short runs
**Files modified:**
- `src/lib/evolution/config.ts` — Add clamping logic in `resolveConfig()`

**Changes:**
In `resolveConfig()`, after merging overrides, add:
```typescript
// Auto-adjust expansion.maxIterations so supervisor validation passes
// For short runs (e.g. 3 iterations), skip EXPANSION entirely
const minCompetitionIters = resolved.plateau.window + 1; // typically 4
if (resolved.maxIterations <= resolved.expansion.maxIterations + minCompetitionIters) {
  const original = resolved.expansion.maxIterations;
  resolved.expansion.maxIterations = Math.max(0, resolved.maxIterations - minCompetitionIters);
  console.warn(
    `[resolveConfig] Auto-clamped expansion.maxIterations from ${original} to ${resolved.expansion.maxIterations} ` +
    `(maxIterations=${resolved.maxIterations} too small for default expansion window). EXPANSION phase will be shortened/skipped.`
  );
}
```

This ensures:
- `maxIterations: 3` → `expansion.maxIterations: 0` (skip EXPANSION, all 3 iterations are COMPETITION)
- `maxIterations: 10` → `expansion.maxIterations: 6` (shortened EXPANSION)
- `maxIterations: 15` → `expansion.maxIterations: 8` (default, unchanged)

### Phase 3: Clean up zombie runs
**Manual via Supabase dashboard or `psql`:**

First, verify the zombie runs exist and are still in 'running' status:
```sql
SELECT id, status, error_message, created_at, completed_at
FROM evolution_runs
WHERE id IN ('61333094-0525-455d-8e6d-b734dd2cb719', '6267637e-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
  AND status = 'running';
```

If results returned (zombie runs confirmed), apply the fix:
```sql
UPDATE evolution_runs
SET status = 'failed',
    error_message = 'Zombie run: supervisor config validation failed (maxIterations <= expansion.maxIterations)',
    completed_at = NOW()
WHERE id IN ('61333094-0525-455d-8e6d-b734dd2cb719', '6267637e-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
  AND status = 'running';
```
The `AND status = 'running'` guard makes this idempotent — safe to re-run. Replace the placeholder `6267637e-xxxx-xxxx-xxxx-xxxxxxxxxxxx` with the actual full UUID from the dashboard before executing.

### Phase 4: Verify with real run
- Trigger a new run with `iterations: 3` strategy → should succeed (EXPANSION auto-skipped)
- Trigger a run with invalid config that throws → should be marked 'failed' immediately
- Run existing unit tests to confirm no regressions

## Testing

### Unit Tests to Add/Modify

**`src/lib/evolution/config.test.ts`** — Expansion auto-clamping in `resolveConfig()`:
- `maxIterations: 3` → `expansion.maxIterations: 0` (EXPANSION skipped)
- `maxIterations: 10` → `expansion.maxIterations: 6` (EXPANSION shortened)
- `maxIterations: 15` → `expansion.maxIterations: 8` (unchanged, no clamping needed)
- Verify `console.warn` is called when clamping occurs:
  ```typescript
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const config = resolveConfig({ maxIterations: 3 });
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-clamped'));
  warnSpy.mockRestore();
  ```
- Verify `console.warn` is NOT called when no clamping needed (`maxIterations: 15`)

**`src/lib/evolution/core/supervisor.test.ts`** — Supervisor accepts clamped config:
- Supervisor accepts config with `expansion.maxIterations: 0` and `maxIterations: 3`

**`src/lib/evolution/core/pipeline.test.ts`** — `executeFullPipeline` marks run as failed:
- Chainable Supabase mock pattern for `.in()` guard:
  ```typescript
  const mockIn = vi.fn().mockResolvedValue({ error: null });
  const mockEq = vi.fn().mockReturnValue({ in: mockIn });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
  vi.mocked(createSupabaseServiceClient).mockResolvedValue({ from: mockFrom } as any);
  ```
- Mock `PoolSupervisor` constructor to throw: `vi.mock('../core/supervisor', () => ({ PoolSupervisor: vi.fn(() => { throw new Error('validation failed'); }) }))`
- Mock `trace.getTracer` to return a no-op tracer/span
- Test: when `PoolSupervisor` throws, verify `mockUpdate` was called with `{ status: 'failed', error_message: expect.stringContaining('validation failed'), completed_at: expect.any(String) }` and `mockIn` was called with `'status', ['pending', 'claimed', 'running']`
- **Idempotency test**: The `.in()` guard is a DB-level filter, not application-level. To test idempotency, verify the `.in()` call includes only non-terminal statuses. If the run is already `'failed'`, the `.in()` filter matches zero rows and the update is a no-op — no application-level assertion needed beyond verifying the correct statuses are passed to `.in()`

**`src/lib/services/evolutionActions.test.ts`** — `triggerEvolutionRunAction` marks run as failed:
- Mock setup: same chainable Supabase mock pattern as pipeline.test.ts (`.from().update().eq().in()` returning `{ error: null }`). Mock `executeFullPipeline` (imported from `@/lib/evolution/core/pipeline`) to throw:
  ```typescript
  vi.mock('@/lib/evolution/core/pipeline', () => ({
    executeFullPipeline: vi.fn().mockRejectedValue(new Error('supervisor crash')),
  }));
  ```
- Test: verify `mockUpdate` was called with `{ status: 'failed', error_message: expect.stringContaining('supervisor crash'), completed_at: expect.any(String) }` and `mockIn` received `'status', ['pending', 'claimed', 'running']`
- Test: the function still returns `{ success: false, error: ... }` (existing behavior preserved)
- **DB error resilience test**: mock the Supabase update to throw, then verify the function still returns `{ success: false }` with the original pipeline error (not the DB error). Verify `console.error` was called with the DB error.

### Regression Test Commands
Run these to ensure no regressions:
```bash
npx vitest run src/lib/evolution/config.test.ts
npx vitest run src/lib/evolution/core/supervisor.test.ts
npx vitest run src/lib/evolution/core/pipeline.test.ts
npx vitest run src/lib/services/evolutionActions.test.ts
npm run test:unit
npm run test:integration
```

### Manual Verification
- Start a pipeline with a 3-iteration strategy via the admin UI
- Confirm run progresses through COMPETITION-only iterations
- Confirm run completes with variants and data visible on dashboard
- Verify zombie runs show as "failed" with error message

### Rollback Plan
If issues are discovered after deployment:
1. **Phase 1 (error handling)**: Revert the catch block changes in `evolutionActions.ts` and `pipeline.ts`. Risk is low — the changes only add DB updates in error paths that previously did nothing.
2. **Phase 2 (auto-clamping)**: Revert the `resolveConfig()` clamping in `config.ts`. Users will need to manually set `iterations >= 13` (or adjust expansion config) to avoid the supervisor validation error. The error handling from Phase 1 will still mark these as failed instead of zombies.
3. **Phase 3 (zombie cleanup)**: No rollback needed — the SQL update is idempotent and correct.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Update config section to note auto-adjustment of expansion.maxIterations for short runs
- `docs/evolution/architecture.md` - Note that short runs auto-skip EXPANSION
