# Planning: Multi-Database Evolution Runner

## Goal

Enable the evolution batch runner to always claim and execute runs from both staging and production Supabase databases, so staging runs like `591666e6` don't get stuck in `pending`.

## Approach

The runner always creates two Supabase clients (staging + prod) and round-robin claims across both. No toggle — both databases are always checked. Requires 4 explicit env vars for the two targets (`SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING`, `SUPABASE_URL_PROD`, `SUPABASE_KEY_PROD`).

## Implementation Plan

### Step 1: Add types and `buildDbTargets()` to `evolution-runner.ts`

New interfaces:
```typescript
interface DbTarget { name: string; client: SupabaseClient }
interface TaggedRun { run: ClaimedRun; db: DbTarget }
```

New function `buildDbTargets(): Promise<DbTarget[]>`:
- Hardcoded targets: `['staging', 'prod']`
- For each, read `SUPABASE_URL_<NAME>` and `SUPABASE_KEY_<NAME>` (uppercased). These vars are already validated at module load (Step 6), so no re-validation needed here — just read and create clients.
- **Pre-flight connectivity check**: Check **all** targets before throwing. Collect failures. Sanitize error messages to exclude URLs or credentials:
  ```typescript
  const failures: string[] = [];
  for (const target of targets) {
    const { error } = await target.client.from('evolution_runs').select('id').limit(1);
    if (error) failures.push(`${target.name}: ${error.message}`);
  }
  if (failures.length > 0) throw new Error(`[FATAL] Unreachable targets:\n${failures.join('\n')}`);
  ```
  This checks all targets and reports all failures at once so operators see the full picture. Supabase error messages do not include credentials, only generic connection/table errors, so no sanitization beyond this is needed.
- Returns `DbTarget[]` with exactly 2 entries

**Note on RPC availability**: Each target may or may not have `claim_evolution_run` RPC. This is fine — `claimNextRun(db)` already handles RPC 42883 by falling back to `claimNextRunFallback(db)`. The pre-flight check validates table access only, not RPC availability, which is the correct level of abstraction.

### Step 2: Refactor `claimNextRun` and `claimNextRunFallback`

- Add `db: DbTarget` parameter to **both** `claimNextRun(db)` and `claimNextRunFallback(db)`
- Replace all `getSupabase()` calls with `db.client` in both functions
- Update fallback call (line 68) to pass `db` through:
  ```typescript
  // Before: return claimNextRunFallback();
  // After:
  return claimNextRunFallback(db);
  ```
- Add `db: db.name` to log context for all log calls in both functions

### Step 3: Refactor `claimBatch`

- Change signature to `claimBatch(batchSize: number, targets: DbTarget[]): Promise<TaggedRun[]>`
- **Exhaustion tracking**: use `Set<string>` of exhausted target names, initialized empty each batch call
- Round-robin logic:
  ```
  let targetIdx = 0;
  while (claimed.length < batchSize && exhausted.size < targets.length) {
    const target = targets[targetIdx % targets.length];
    targetIdx++;
    if (exhausted.has(target.name)) continue;
    const run = await claimNextRun(target);
    if (!run) { exhausted.add(target.name); continue; }
    claimed.push({ run, db: target });
  }
  ```
- **Note**: `targetIdx` resets per `claimBatch` call (not persisted across batches). Intentional — each batch starts fresh, simpler and sufficient since batch intervals are timer-driven.
- Return `TaggedRun[]` instead of `ClaimedRun[]`

### Step 4: Refactor `executeRun`

- Change signature to `executeRun(tagged: TaggedRun): Promise<void>`
- Extract `const { run, db } = tagged;` at top for readability
- Pass `db.client` to `executeV2Run` (line 177): `executeV2Run(run.id, run, db.client, llmProvider)`
- **Dry-run path** (lines 164-169): replace `const supabase = getSupabase()` with `db.client`:
  ```typescript
  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', { runId: run.id, db: db.name });
    await db.client.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }
  ```
- **Error path**: `await markRunFailed(db.client, run.id, String(error))` — passes the same client
- Add `db: db.name` to ALL log calls (start, dry-run, complete, error)

### Step 5: Refactor `markRunFailed` (in `evolution-runner.ts`, NOT `pipeline/runner.ts`)

**Clarification**: There is ONE `markRunFailed` function in `evolution-runner.ts` (line 187). It is being REFACTORED in-place (not adding a second function). `pipeline/runner.ts` has a separate `markRunFailed` — we are NOT touching that one.

Current signature: `markRunFailed(runId: string, errorMessage: string)` — calls `getSupabase()` internally.
New signature: `markRunFailed(db: SupabaseClient, runId: string, errorMessage: string)` — uses passed `db` param.

```typescript
// Before:
async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('evolution_runs').update({...}).eq('id', runId)...;
}

// After:
async function markRunFailed(db: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
  await db.from('evolution_runs').update({...}).eq('id', runId)...;
}
```

Update caller in `executeRun` (step 4): `await markRunFailed(db.client, run.id, String(error))`

### Step 6: Update env var validation (module-level, lines 12-18)

Replace the current `REQUIRED_ENV_VARS` check with:

```typescript
const REQUIRED_ENV_VARS = [
  'OPENAI_API_KEY',
  'SUPABASE_URL_STAGING',
  'SUPABASE_KEY_STAGING',
  'SUPABASE_URL_PROD',
  'SUPABASE_KEY_PROD',
] as const;
```

All 5 vars are always required. No conditional logic needed. This is the **only** env var check — `buildDbTargets()` reads these vars but does NOT re-validate them (they're already guaranteed present by the module-level check).

Remove `getSupabase()` function — it's no longer used since all DB access goes through `DbTarget.client`.

**Old env vars**: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are silently ignored if present. No error, no warning — they're simply not read anymore. This allows a gradual migration where old env files can coexist.

### Step 7: Update `main()`

- Call `const targets = await buildDbTargets()` at startup (after `initLLMSemaphore`)
- Log target names: `log('info', 'Connected to databases', { targets: targets.map(t => t.name) })`
- Pass targets to `claimBatch`: `const batch = await claimBatch(batchSize, targets)`
- Adapt batch result handling for `TaggedRun`:
  ```typescript
  // Before: batch.map((run) => executeRun(run))
  // After:
  const results = await Promise.allSettled(batch.map((tagged) => executeRun(tagged)));
  results.forEach((result, i) => {
    const runId = batch[i].run.id;  // was batch[i].id
    if (result.status === 'rejected') {
      log('error', 'Run rejected (unhandled)', { runId, db: batch[i].db.name, reason: String(result.reason) });
    }
  });
  ```

### Step 8: Update exports

Updated export line:
```typescript
export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed, buildDbTargets };
export type { ClaimedRun, DbTarget, TaggedRun };
```
- Added: `buildDbTargets`, `DbTarget`, `TaggedRun`
- Removed: `getSupabase` (deleted function)

### Step 9: Update `evolution-runner.test.ts`

**Test environment setup:**
All 5 required env vars must be set **at the top of the test file, BEFORE any `import`/`require` of `evolution-runner`** (module-level check runs at import time, before `beforeAll`). Place this block at the very top of the file, before mocks:
```typescript
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.SUPABASE_URL_STAGING = 'https://staging.supabase.co';
process.env.SUPABASE_KEY_STAGING = 'test-staging-key';
process.env.SUPABASE_URL_PROD = 'https://prod.supabase.co';
process.env.SUPABASE_KEY_PROD = 'test-prod-key';
```

**Test cleanup**: These env vars are test-only values and harmless if left in the process. Jest runs tests in isolated worker processes, so they don't leak to other test files or CI environments. No explicit cleanup needed.

**Multi-client mocking strategy:**
The existing `createClient` mock returns a single mock object. For multi-DB tests, make it return distinct mock clients keyed by URL:
```typescript
const mockClients: Record<string, { rpc: jest.Mock; from: jest.Mock }> = {};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => {
    if (!mockClients[url]) {
      mockClients[url] = { rpc: jest.fn(), from: jest.fn() };
    }
    return mockClients[url];
  }),
}));
```
This lets tests configure per-target mock behavior (e.g., staging returns runs, prod returns null).

**Update existing tests:**
- `executeRun` tests (3 tests in "executeRun V2 delegation" block): wrap `run` objects in `TaggedRun`:
  ```typescript
  const mockClient = { rpc: mockRpc, from: mockFrom } as unknown as SupabaseClient;
  const mockTarget: DbTarget = { name: 'test', client: mockClient };
  await executeRun({ run, db: mockTarget });
  ```
- `REQUIRED_ENV_VARS` test: update to verify all 5 new var names
- Remove references to `getSupabase` (deleted function)

**New test: `buildDbTargets`:**
- Returns 2 targets named 'staging' and 'prod' when all env vars set
- Each target's client was created with the corresponding URL
- Throws when env vars partially missing (e.g., `SUPABASE_URL_STAGING` present but `SUPABASE_KEY_STAGING` missing) — test by temporarily deleting env var, re-importing module
- Pre-flight check: mock `.from().select().limit()` to return `{ error: { message: 'connection refused' } }` for one target → verify error includes target name

**New test: round-robin `claimBatch`:**
- Create two mock `DbTarget`s: `targetA` (`name: 'a'`) and `targetB` (`name: 'b'`)
- Mock `claimNextRun` to inspect `db.name` and return per-target results:
  ```typescript
  jest.spyOn(runner, 'claimNextRun').mockImplementation(async (db: DbTarget) => {
    if (db.name === 'a') return aRuns.shift() ?? null;
    if (db.name === 'b') return bRuns.shift() ?? null;
    return null;
  });
  ```
  Where `aRuns = [runA1, runA2]` and `bRuns = [runB1]`
- Call `claimBatch(4, [targetA, targetB])`
- Assert exact claim order: `[{run: A1, db: targetA}, {run: B1, db: targetB}, {run: A2, db: targetA}]`
- Assert `TaggedRun[].db.name` matches `['a', 'b', 'a']`
- Assert total claimed = 3 (both targets exhausted before batchSize=4 reached)

**New test: `markRunFailed` with db param:**
- Create a mock `SupabaseClient` with mock `.from().update().eq().in()`
- Call `markRunFailed(mockClient, 'run-1', 'some error')`
- Assert `mockClient.from` was called (not some other client)

**New test: dry-run with TaggedRun:**
- Set `--dry-run` flag
- Call `executeRun({ run, db: mockTarget })`
- Assert `mockTarget.client.from` was called with update `{ status: 'completed' }`
- Assert `executeV2Run` was NOT called

### Step 10: Update `evolution-runner.service`

- Replace the two existing `EnvironmentFile` lines (`/opt/explainanything/.env.local` and `/opt/explainanything/.env.evolution-prod`) with a single file:
  ```
  EnvironmentFile=/opt/explainanything/.env.evolution-targets
  ```
- This file contains all 5 required vars (`OPENAI_API_KEY`, `SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING`, `SUPABASE_URL_PROD`, `SUPABASE_KEY_PROD`)
- **File permissions**: `chmod 600` — must be enforced since it contains service role keys

**Deployment ordering**:
1. Create `.env.evolution-targets` securely: `touch .env.evolution-targets && chmod 600 .env.evolution-targets` then populate with new vars (can coexist with old files)
2. Deploy new code
3. Update service file to point to new env file
4. `sudo systemctl daemon-reload && sudo systemctl restart evolution-runner.timer`
5. Verify via `journalctl -u evolution-runner.service -n 20` — look for "Connected to databases" log with both target names

### Step 11: Update `minicomputer_deployment.md`

- Replace "2. Environment Variables" section to document the new required vars:
  - `SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING` — staging Supabase credentials
  - `SUPABASE_URL_PROD`, `SUPABASE_KEY_PROD` — production Supabase credentials
  - `OPENAI_API_KEY` — shared LLM key
  - Example `.env.evolution-targets` file
  - File permissions (`chmod 600`)
  - Verification: dry-run to see both targets logged at startup
  - Note on log format change: all log entries now include `db` field in context JSON — update any monitoring/alerting rules that parse log output

## Files Modified

| File | Changes |
|------|---------|
| `evolution/scripts/evolution-runner.ts` | Core multi-DB logic (steps 1-8) |
| `evolution/scripts/evolution-runner.test.ts` | Updated + new tests (step 9) |
| `evolution/deploy/evolution-runner.service` | Update EnvironmentFile (step 10) |
| `evolution/docs/evolution/minicomputer_deployment.md` | Document multi-DB (step 11) |

## Files NOT Modified

| File | Reason |
|------|--------|
| `evolution/src/lib/pipeline/runner.ts` | `executeV2Run` already accepts `db` param |
| LLM provider code | Shared across all DB targets |
| Shutdown/timer logic | Unchanged |

## Verification

1. `npm run lint && npx tsc --noEmit` — type check
2. `npx jest evolution/scripts/evolution-runner.test.ts` — unit tests pass
3. Manual dry-run: `SUPABASE_URL_STAGING=... SUPABASE_KEY_STAGING=... SUPABASE_URL_PROD=... SUPABASE_KEY_PROD=... npx tsx evolution/scripts/evolution-runner.ts --dry-run --max-runs 1`
4. Deploy and verify run `591666e6` gets claimed from staging

## Rollback Plan

1. **Code revert**: `git revert <commit>`, restore old service file pointing to `.env.local` + `.env.evolution-prod`, `sudo systemctl daemon-reload && sudo systemctl restart evolution-runner.timer`. Restores original single-DB behavior.
2. **Partial failure at startup**: If one target is unreachable, the pre-flight check reports ALL failures at once. Fix the unreachable target's env vars or network, then restart.
3. **Runtime failure**: If a target becomes unreachable mid-run, `markRunFailed` handles it per-run. The other target continues working. Next batch retries the failed target.

## Risks

- **Low**: Race conditions between targets — each DB is independent, no cross-DB atomicity needed
- **Low**: Target unavailability — pre-flight check catches at startup; runtime failures handled per-run by `markRunFailed`
- **Low**: Breaking change migration — old env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are silently ignored if still present. New vars must be set up before deploying. Deployment ordering is specified in Step 10.
- **Low**: RPC availability mismatch — one target may have `claim_evolution_run` RPC while the other doesn't. Handled by existing 42883 fallback logic which now correctly passes `db` through.
