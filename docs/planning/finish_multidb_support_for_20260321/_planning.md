# Finish Multi-DB Support Plan

## Background
PR #750 added multi-DB support to evolution-runner.ts, but PR #757 consolidated scripts into processRunQueue.ts and lost the multi-DB changes. The runner currently only connects to one Supabase DB via createSupabaseServiceClient(). This project restores multi-DB support in processRunQueue.ts, reading staging creds from .env.local and prod creds from .env.evolution-prod (the existing env files on the minicomputer), so the runner round-robin claims runs from both databases.

## Requirements (from GH Issue)
1. Modify processRunQueue.ts to use dotenv to parse .env.local (staging) and .env.evolution-prod (prod) and build two Supabase clients
2. Add DbTarget/TaggedRun types and round-robin claimBatch logic
3. Update systemd service to point to processRunQueue.ts (currently pointing to nonexistent evolution-runner.ts)
4. Update minicomputer_deployment.md to reflect the actual env file setup
5. Update tests for multi-DB support
6. Verify run 591666e6 gets claimed from staging

## Problem
The evolution batch runner on the minicomputer is completely broken — the systemd service references `evolution-runner.ts` which was deleted during PR #757's consolidation. Even before that, the single-DB design meant staging runs like 591666e6 never got claimed because the runner only connected to prod. The existing `.env.local` and `.env.evolution-prod` files already contain the correct staging and prod credentials respectively, but use the same variable names (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), so we can't just load both into process.env.

## Options Considered

### Option A: New `.env.evolution-targets` file (PR #750 approach)
Create a single file with renamed vars (`SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING`, etc.).
- Pro: Clean naming, single file
- Con: Requires creating new file on minicomputer, introduces convention not used elsewhere

### Option B: `dotenv.parse()` from existing files (chosen)
Use `dotenv.parse(fs.readFileSync('.env.local'))` and `dotenv.parse(fs.readFileSync('.env.evolution-prod'))` to get separate objects, then `createClient()` directly.
- Pro: Zero deployment friction — uses files already on machine, matches existing codebase patterns
- Con: Slightly more code than reading env vars directly

**Decision:** Option B — user explicitly requested reusing existing env files.

## Phased Execution Plan

### Phase 1: Add multi-DB types, env loading, and buildDbTargets

**Changes to `evolution/scripts/processRunQueue.ts`:**

Replace import of `createSupabaseServiceClient` with direct `createClient` from `@supabase/supabase-js` plus dotenv/fs:

```typescript
// REMOVE:
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

// ADD:
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
```

Add types (after imports):

```typescript
interface DbTarget { name: string; client: SupabaseClient }
interface TaggedRun { run: ClaimedRun; db: DbTarget }
```

Replace `ServiceClient` type alias:

```typescript
// REMOVE:
type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

// (Functions will now use SupabaseClient directly)
```

Add env loading and `buildDbTargets()`:

```typescript
const ENV_TARGETS: { name: string; envFile: string }[] = [
  { name: 'staging', envFile: '.env.local' },
  { name: 'prod', envFile: '.env.evolution-prod' },
];

function loadEnvFile(filename: string): Record<string, string> {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[FATAL] Missing env file: ${filePath}`);
  }
  return dotenv.parse(fs.readFileSync(filePath));
}

async function buildDbTargets(): Promise<DbTarget[]> {
  // Load shared vars (API keys) into process.env from .env.local
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const targets: DbTarget[] = [];
  for (const { name, envFile } of ENV_TARGETS) {
    try {
      const env = loadEnvFile(envFile);
      const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!url || !key) {
        log('error', `Skipping target: ${envFile} missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`, { db: name });
        continue;
      }
      targets.push({
        name,
        client: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
      });
    } catch (err) {
      log('error', `Skipping target: failed to load ${envFile}`, { db: name, error: String(err) });
    }
  }

  // Pre-flight connectivity check — warn on failure, don't block other targets
  const reachable: DbTarget[] = [];
  for (const target of targets) {
    const { error } = await target.client.from('evolution_runs').select('id').limit(1);
    if (error) {
      log('error', `Target unreachable, skipping`, { db: target.name, error: error.message });
    } else {
      reachable.push(target);
    }
  }
  if (reachable.length === 0) {
    throw new Error(`[FATAL] No reachable targets — check env files and network`);
  }

  return reachable;
}
```

**Lint/tsc/build after this step.**

### Phase 2: Refactor claimNextRun, claimBatch, executeRun, markRunFailed for multi-DB

**`claimNextRun`** — change param from `ServiceClient` to `DbTarget`:

```typescript
async function claimNextRun(db: DbTarget): Promise<ClaimedRun | null> {
  const { data, error } = await db.client.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
  });

  if (error) {
    log('error', 'Failed to claim run', { db: db.name, error: error.message });
    return null;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const run = Array.isArray(data) ? data[0] : data;
  return run as ClaimedRun;
}
```

**`claimBatch`** — round-robin across targets:

```typescript
async function claimBatch(batchSize: number, targets: DbTarget[]): Promise<TaggedRun[]> {
  const claimed: TaggedRun[] = [];
  const exhausted = new Set<string>();
  let targetIdx = 0;

  while (claimed.length < batchSize && exhausted.size < targets.length) {
    const target = targets[targetIdx % targets.length];
    targetIdx++;
    if (exhausted.has(target.name)) continue;

    const run = await claimNextRun(target);
    if (!run) {
      exhausted.add(target.name);
      continue;
    }
    claimed.push({ run, db: target });
  }
  return claimed;
}
```

**`markRunFailed`** — change first param to `SupabaseClient`:

```typescript
async function markRunFailed(db: SupabaseClient, runId: string, errorMessage: string): Promise<void> {
  // body stays the same, just uses db directly instead of ServiceClient
}
```

**`executeRun`** — accept `TaggedRun`:

```typescript
async function executeRun(tagged: TaggedRun): Promise<void> {
  const { run, db } = tagged;
  log('info', 'Starting evolution run', {
    runId: run.id,
    db: db.name,
    explanationId: run.explanation_id,
    promptId: run.prompt_id,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    log('info', 'DRY RUN: would execute full pipeline here', { runId: run.id, db: db.name });
    await db.client.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: 'dry-run: no execution performed',
    }).eq('id', run.id);
    return;
  }

  const llmProvider = createRawLLMProvider();

  try {
    await executeV2Run(run.id, run, db.client, llmProvider);
    log('info', 'Run completed', { runId: run.id, db: db.name });
  } catch (error) {
    log('error', 'Run failed', { runId: run.id, db: db.name, error: String(error) });
    await markRunFailed(db.client, run.id, String(error));
  }
}
```

**Lint/tsc/build after this step.**

### Phase 3: Update main() and exports

```typescript
async function main() {
  initLLMSemaphore(MAX_CONCURRENT_LLM);

  log('info', 'Evolution runner starting', {
    runnerId: RUNNER_ID,
    dryRun: DRY_RUN,
    maxRuns: MAX_RUNS,
    parallel: PARALLEL,
    maxConcurrentLLM: MAX_CONCURRENT_LLM,
  });

  setupGracefulShutdown();

  const targets = await buildDbTargets();
  log('info', 'Connected to databases', { targets: targets.map(t => t.name) });

  let processedRuns = 0;

  while (processedRuns < MAX_RUNS && !shuttingDown) {
    const remaining = MAX_RUNS - processedRuns;
    const batchSize = Math.min(PARALLEL, remaining);

    const batch = await claimBatch(batchSize, targets);

    if (batch.length === 0) {
      log('info', 'No pending runs found, exiting');
      break;
    }

    log('info', 'Processing batch', {
      batchSize: batch.length,
      runIds: batch.map((t) => t.run.id),
      dbs: batch.map((t) => t.db.name),
      processed: processedRuns,
      max: MAX_RUNS,
    });

    const results = await Promise.allSettled(batch.map((tagged) => executeRun(tagged)));

    results.forEach((result, i) => {
      const runId = batch[i].run.id;
      if (result.status === 'rejected') {
        log('error', 'Run rejected (unhandled)', { runId, db: batch[i].db.name, reason: String(result.reason) });
      }
    });

    processedRuns += batch.length;

    if (processedRuns < MAX_RUNS && !shuttingDown) {
      log('info', 'Batch complete, looking for more runs', { processed: processedRuns, max: MAX_RUNS });
    }
  }

  log('info', 'Runner finished', { processedRuns, shuttingDown });
  process.exit(0);
}
```

Update exports:

```typescript
export { claimBatch, claimNextRun, parseIntArg, log, executeRun, markRunFailed, buildDbTargets, loadEnvFile };
export type { DbTarget, TaggedRun };
```

**Lint/tsc/build after this step.**

### Phase 4: Update tests

**Changes to `evolution/scripts/processRunQueue.test.ts`:**

1. Replace `createSupabaseServiceClient` mock with `@supabase/supabase-js` mock:

```typescript
const mockClients: Record<string, { rpc: jest.Mock; from: jest.Mock }> = {};
function getMockClient(url: string) {
  if (!mockClients[url]) {
    mockClients[url] = { rpc: jest.fn(), from: jest.fn() };
  }
  return mockClients[url];
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => getMockClient(url)),
}));
```

2. Mock `fs` and `dotenv` for `buildDbTargets`/`loadEnvFile`. Key: mock `fs.existsSync` and `fs.readFileSync` so no real files are touched in CI. The dotenv.parse mock keys off the *path* argument passed to readFileSync (not file content):

```typescript
jest.mock('fs', () => ({
  existsSync: jest.fn((p: string) => p.includes('.env.local') || p.includes('.env.evolution-prod')),
  readFileSync: jest.fn((p: string) => {
    if (p.includes('.env.local')) return 'NEXT_PUBLIC_SUPABASE_URL=https://staging.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=staging-key';
    if (p.includes('.env.evolution-prod')) return 'NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=prod-key';
    throw new Error('ENOENT');
  }),
}));

jest.mock('dotenv', () => {
  const actual = jest.requireActual('dotenv');
  return { ...actual, config: jest.fn() };
});
```

This uses the real `dotenv.parse()` (it's a pure parser with no side effects) and only mocks `dotenv.config()` (which would pollute process.env). The `fs` mock prevents filesystem access entirely — safe in CI where .env files don't exist.

3. Update **all** existing `executeRun` tests atomically (signature changes from 2-arg to 1-arg TaggedRun):

```typescript
// BEFORE: await executeRun(run, mockSupabase as never);
// AFTER:
const mockTarget: DbTarget = { name: 'test', client: mockSupabase as never };
await executeRun({ run, db: mockTarget });
```

Every `executeRun` call site in the test file must be updated in the same commit as the source change. There are 2 test calls to update (lines ~207 and ~243).

4. Add new test: **round-robin claimBatch** — call the real exported `claimBatch`, not a re-implementation:

```typescript
it('round-robins across multiple DbTargets', async () => {
  const { claimBatch } = await import('./processRunQueue');

  const aRuns = [{ id: 'a1', ... }, { id: 'a2', ... }];
  const bRuns = [{ id: 'b1', ... }];

  const rpcA = jest.fn().mockImplementation(async () => {
    const run = aRuns.shift();
    return run ? { data: run, error: null } : { data: null, error: null };
  });
  const rpcB = jest.fn().mockImplementation(async () => {
    const run = bRuns.shift();
    return run ? { data: run, error: null } : { data: null, error: null };
  });

  const targetA: DbTarget = { name: 'a', client: { rpc: rpcA } as never };
  const targetB: DbTarget = { name: 'b', client: { rpc: rpcB } as never };

  const batch = await claimBatch(4, [targetA, targetB]);

  expect(batch).toHaveLength(3);
  expect(batch.map(t => t.run.id)).toEqual(['a1', 'b1', 'a2']);
  expect(batch.map(t => t.db.name)).toEqual(['a', 'b', 'a']);
});
```

5. Add new test: **buildDbTargets returns reachable targets** (mock fs + dotenv + createClient pre-flight)

6. Add new test: **loadEnvFile throws on missing file** (mock fs.existsSync to return false)

7. Add new test: **dry-run with TaggedRun writes to correct db.client**

8. Add new test: **buildDbTargets skips unreachable target, returns remaining** — mock one target's pre-flight `.from().select().limit()` to return `{ error: { message: 'connection refused' } }`, verify only the reachable target is returned

9. Add new test: **buildDbTargets skips target with missing env file** — mock fs.existsSync to return false for one file, verify the other target still loads and the missing one is skipped with a log

10. Add new test: **claimBatch with single target** (degraded mode) — pass only 1 DbTarget, verify it claims all runs from that single target without errors

11. Remove dead `createSupabaseServiceClient` mock (no longer imported by processRunQueue.ts)

**Run unit tests after this step.**

### Phase 5: Update systemd service and deployment docs

**`evolution/deploy/evolution-runner.service`:**

Remove the `EnvironmentFile` line entirely. The script now loads its own env via `dotenv.config()` and `dotenv.parse()` — systemd EnvironmentFile is no longer needed.

```ini
ExecStart=/usr/bin/npx tsx evolution/scripts/processRunQueue.ts --max-runs 10 --parallel 2
# No EnvironmentFile — script loads .env.local and .env.evolution-prod directly via dotenv
```

**`evolution/docs/evolution/minicomputer_deployment.md`:**
- Update script name from `evolution-runner.ts` to `processRunQueue.ts`
- Update env section to explain the two-file approach (`.env.local` for staging, `.env.evolution-prod` for prod)
- Remove references to `.env.evolution-targets`
- Update verification steps

### Phase 6: Deploy to minicomputer

1. Update installed systemd service: change ExecStart to reference `processRunQueue.ts`
2. `sudo systemctl daemon-reload && sudo systemctl restart evolution-runner.timer`
3. Verify via `journalctl -u evolution-runner.service -n 20` — look for "Connected to databases" with both targets
4. Verify run 591666e6 gets claimed from staging

## Testing

### Unit tests (Phase 4)
- **Modified:** All existing `executeRun` tests → use TaggedRun wrapper
- **Modified:** `claimBatch` tests → multi-target round-robin
- **New:** `buildDbTargets` returns staging + prod targets
- **New:** `loadEnvFile` throws on missing file
- **New:** round-robin claimBatch alternation order
- **New:** dry-run with TaggedRun writes to correct db target

### Manual verification (Phase 6)
- Dry-run: `npx tsx evolution/scripts/processRunQueue.ts --dry-run --max-runs 1`
- Verify "Connected to databases" log shows both staging and prod
- Verify run 591666e6 gets claimed from staging DB

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/minicomputer_deployment.md` - Update script name, env file approach, verification steps

## Files Modified

| File | Changes |
|------|---------|
| `evolution/scripts/processRunQueue.ts` | Multi-DB support: dotenv.parse, DbTarget, TaggedRun, round-robin claimBatch, buildDbTargets |
| `evolution/scripts/processRunQueue.test.ts` | Updated mocks + new multi-DB tests |
| `evolution/deploy/evolution-runner.service` | Fix ExecStart script name |
| `evolution/docs/evolution/minicomputer_deployment.md` | Update env file docs, script name |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src/lib/utils/supabase/server.ts` | No longer imported by runner |
| `evolution/src/lib/pipeline/claimAndExecuteRun.ts` | Already accepts SupabaseClient param |
| `.env.local` | Existing file, no changes |
| `.env.evolution-prod` | Existing file, no changes |

## Env File Strategy Summary

**No new env files or var names.** Existing files used as-is:

| File | Purpose | Key Vars Used |
|------|---------|---------------|
| `.env.local` | Staging Supabase creds + shared API keys | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` |
| `.env.evolution-prod` | Prod Supabase creds | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

`dotenv.parse()` reads each into a separate object → no var name collisions.
`dotenv.config({ path: '.env.local' })` loads shared vars (API keys) into process.env for callLLM.

## Rollback Plan

1. **Code revert:** `git revert <commit>` on main, then on minicomputer: `git pull origin main && npm ci`
2. **Restore systemd service:** Re-add `EnvironmentFile` lines for `.env.local` and `.env.evolution-prod`, change ExecStart back to `evolution-runner.ts` (but note: this file doesn't exist on current main either — the runner was already broken before this PR)
3. **Quick fix if multi-DB breaks:** Edit the installed systemd service to add `EnvironmentFile=.env.evolution-prod` and change ExecStart to reference `processRunQueue.ts` — this gives single-DB (prod-only) behavior as a stopgap
4. **Restart:** `sudo systemctl daemon-reload && sudo systemctl restart evolution-runner.timer`

## Security Note

`.env.local` currently has 664 permissions (group+other readable) and contains service role keys and API keys. Run `chmod 600 .env.local` on the minicomputer during Phase 6 deployment.

## Risks

- **Low:** LLM tracking (`callLLM`) writes to staging DB (loaded into process.env via dotenv.config) — acceptable, staging is the dev instance
- **Low:** If either env file is missing, buildDbTargets logs error and skips that target; throws only if zero targets reachable
- **Low:** If one target is unreachable at startup, pre-flight check logs warning and continues with remaining targets
- **Low:** Runtime target failure handled per-run by markRunFailed; other target continues working
