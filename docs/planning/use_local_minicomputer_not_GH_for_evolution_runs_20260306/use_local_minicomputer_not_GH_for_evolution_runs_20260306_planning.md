# Use Local Minicomputer Not GH For Evolution Runs Plan

## Background
Migrate evolution pipeline execution from Vercel serverless cron to a local minicomputer. The current Vercel cron path has inherent limitations: 800s timeout per invocation, 1 run at a time, and continuation-passing overhead for long runs. A local minicomputer removes all these constraints. Research revealed that the batch runner script already exists (`evolution/scripts/evolution-runner.ts`) and no GitHub Actions dispatch was ever implemented despite documentation references.

## Requirements (from GH Issue #654)
1. Set up evolution batch runner on local minicomputer
2. Configure env vars (Supabase, OpenAI, DeepSeek, Pinecone) on minicomputer
3. Replace GitHub Actions workflow dispatch with local cron/systemd service
4. Update dashboard Batch Dispatch card to trigger local runner instead of GH Actions
5. Ensure heartbeat/watchdog still works for local runs
6. Update docs to reflect new local runner setup

## Problem
Evolution pipeline runs currently execute on Vercel serverless with an 800-second timeout, processing only 1 run per 5-minute cron cycle. Long runs require multiple continuation-passing handoffs, adding latency and complexity. The batch runner script exists but has two gaps: it rejects prompt-based runs and lacks database logging (making batch run logs invisible in the admin UI). Documentation incorrectly references a GitHub Actions batch dispatch that was never built.

## Options Considered

### Runner Scheduling
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **systemd timer (5 min)** | Native journaling, predictable, no script changes, easy monitoring | Requires two files (.service + .timer) | **Chosen** |
| Simple cron job | Lightweight, portable | No journaling, harder debugging | Not ideal |
| systemd service (daemon) | Good monitoring | Script not designed for continuous loop, needs rewrite | Over-engineered |
| Keep Vercel cron | Zero setup | Same 800s timeout, 1 run limit | Defeats purpose |

### Vercel Cron Coexistence
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Remove cron from vercel.json** | Clean, no race conditions, no wasted invocations | Requires Vercel deploy | **Chosen** |
| Set EVOLUTION_MAX_CONCURRENT_RUNS=0 | No deploy needed, reversible | Cron still fires, wastes invocations, confusing | Fallback only |
| Leave both active | Belt-and-suspenders | Wasteful, both compete for runs | Not recommended |

### Dashboard Trigger
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **DB-based signaling (current)** | Zero new code, admin queues run, minicomputer claims it next cycle | Up to 5 min delay | **Chosen** |
| SSH trigger to minicomputer | Instant | Complex, requires SSH from Vercel | Over-engineered |
| Webhook/tunnel on minicomputer | Instant | Opens inbound port, security risk | Against requirements |
| Keep Vercel POST for urgent runs | Instant single-run trigger, already works | 800s limit | **Keep as complement** |

## Phased Execution Plan

### Phase 1: Fix Batch Runner Gaps (Code Changes)
**Goal**: Make the batch runner production-ready with full feature parity.

#### 1a. Add prompt-based run support
- **File**: `evolution/scripts/evolution-runner.ts`

**Step 1: Extend `ClaimedRun` interface** (line 43-49) to include `prompt_id`:
```typescript
interface ClaimedRun {
  id: string;
  explanation_id: number | null;
  prompt_id: string | null;  // ADD THIS
  config: Record<string, unknown> | null;
  budget_cap_usd: number | null;
  continuation_count: number;
}
```

**Step 2: Update fallback claim query** (line 83) to select `prompt_id`:
```typescript
.select('id, explanation_id, prompt_id, config, budget_cap_usd')
```

**Step 3: Remove the explicit rejection** at lines 170-175 (the `if (run.explanation_id === null && !isResume)` guard)

**Step 4: Import dependencies for seed article generation.** Two import paths are needed:

**From the barrel file** (`await import('../src/lib/index')` — already used by batch runner):
- `createEvolutionLLMClient` — create LLM client for seed generation
- `resolveConfig` — resolve model config from run config
- `createCostTracker` — budget tracking during seed generation
- `createEvolutionLogger` — console-only logger for seed generation (not the DB variant)

**Separate dynamic import** (following the pattern in `evolutionRunnerCore.ts` line 161):
```typescript
const { generateSeedArticle } = await import('../src/lib/core/seedArticle');
```
Note: `generateSeedArticle` is NOT exported from the barrel file (`evolution/src/lib/index.ts`). The cron runner (`evolutionRunnerCore.ts`) also uses a separate dynamic import for it. We follow the same pattern rather than modifying the barrel file.

**Step 5: Implement the three-way content resolution** (matching `evolutionRunnerCore.ts` lines 150-177):
```typescript
if (run.explanation_id !== null) {
  // Existing path: fetch from explanations table
} else if (run.prompt_id) {
  // New path: fetch prompt from evolution_arena_topics, generate seed article
  // Create seed-specific cost tracker and logger (separate from pipeline's)
  const seedConfig = resolveConfig(run.config ?? {});
  const seedCostTracker = createCostTracker(seedConfig);
  const seedLogger = createEvolutionLogger(run.id);
  const seedLlmClient = createEvolutionLLMClient(seedCostTracker, seedLogger);

  // Fetch prompt text from DB
  const { data: topic } = await supabase
    .from('evolution_arena_topics')
    .select('prompt')
    .eq('id', run.prompt_id)
    .single();
  if (!topic) { await markRunFailed(run.id, 'Prompt not found'); return; }

  const { generateSeedArticle } = await import('../src/lib/core/seedArticle');
  const seed = await generateSeedArticle(topic.prompt, seedLlmClient, seedLogger);
  originalText = seed.content;
  title = seed.title;
} else {
  await markRunFailed(run.id, 'Run has no explanation_id and no prompt_id');
  return;
}
```

#### 1b. Add database logging for runner operational messages
- **File**: `evolution/scripts/evolution-runner.ts`

**Clarification on logging scope**: Pipeline-level logs (agent execution, LLM calls, variant creation) are already written to the `evolution_run_logs` DB table because `preparePipelineRun()` internally creates a `createDbEvolutionLogger()`. The gap is only the runner's own operational messages ("claiming run", "batch start/stop", "skipping run") which currently go to stdout via the inline `log()` function.

**Approach**: Rather than replacing the inline `log()` with `createDbEvolutionLogger()` (which imports `@/lib/server_utilities` → `@sentry/nextjs` and may not work correctly outside Next.js server context), use a simpler approach:
- Keep the inline `log()` for runner operational messages (captured by systemd journal)
- Pipeline logs already go to DB via `preparePipelineRun()` — no changes needed
- The admin UI Logs tab already shows pipeline logs for all runs regardless of runner

**If DB logging of operational messages is desired later**: Create a lightweight `createBatchRunnerLogger()` that writes directly to `evolution_run_logs` via Supabase client (which the batch runner already imports) without the `@/lib/server_utilities` dependency chain. This avoids the Next.js/Sentry/OTel coupling.

**Ensure `process.exit(0)` doesn't kill pending flushes**: The batch runner calls `process.exit(0)` at line 366. Any async LogBuffer flush must complete before exit. Add `await logger.flush()` before `process.exit(0)` if a DB logger is introduced. For now (stdout-only operational logs), this is not a concern.

#### 1c. Tests
- **File**: `evolution/scripts/evolution-runner.test.ts`

**Mock strategy for dynamic imports**: The batch runner uses TWO dynamic import paths. Both need separate `jest.mock()` calls:
```typescript
// Mock 1: barrel file (already used by batch runner)
jest.mock('../src/lib/index', () => ({
  createEvolutionLLMClient: jest.fn(),
  resolveConfig: jest.fn(),
  createCostTracker: jest.fn(),
  createEvolutionLogger: jest.fn(),
  preparePipelineRun: jest.fn(),
  executeFullPipeline: jest.fn(),
  // ... other exports as needed
}));

// Mock 2: seedArticle (new, separate import path)
jest.mock('../src/lib/core/seedArticle', () => ({
  generateSeedArticle: jest.fn(),
}));
```

**Testability note**: The prompt-based logic lives inside the `executeRun()` function which is not currently exported. Either export it for direct testing, or test via the main flow with mocked Supabase + dynamic imports. Existing mock data objects need `prompt_id: null` added for type safety after the interface change.

**RPC verification**: The `claim_evolution_run` RPC uses `RETURNS SETOF evolution_runs` + `RETURNING *`, so all columns including `prompt_id` are returned automatically. No migration needed.

**New tests to add**:
1. Test that `ClaimedRun` with `prompt_id` set and `explanation_id` null triggers the seed article path (mock `generateSeedArticle` to return test content)
2. Test that `ClaimedRun` with both `explanation_id` and `prompt_id` null calls `markRunFailed`
3. Test that existing explanation-based path still works (regression)
4. Existing test mock objects updated with `prompt_id: null`

### Phase 2: Disable Vercel Evolution Cron
**Goal**: Stop Vercel from competing with the minicomputer for runs.

#### 2a. Remove evolution cron from vercel.json
- **File**: `vercel.json`
- Remove: `{ "path": "/api/evolution/run", "schedule": "*/5 * * * *" }`
- Keep all other crons:
  - `/api/cron/evolution-watchdog` (15 min) — still needed for stale run detection
  - `/api/cron/experiment-driver` (1 min) — experiment state machine
  - `/api/cron/reset-orphaned-reservations` (5 min) — serverless-specific, must stay

#### 2b. Preserve admin trigger
- The POST endpoint at `/api/evolution/run` still works for per-run "Trigger" button clicks
- No changes needed to the route or dashboard — only the cron schedule is removed

### Phase 3: Documentation Updates
**Goal**: Fix inaccurate docs and add minicomputer setup instructions.

#### 3a. Fix inaccurate GitHub Actions references
- `evolution/docs/evolution/architecture.md` line 306 — replace "Batch Dispatch" card + GH Actions reference with local minicomputer batch runner description
- `evolution/docs/evolution/reference.md` line 372 — replace "Batch Dispatch card" with accurate runner description
- `evolution/docs/evolution/reference.md` lines 405-406 — remove `GITHUB_TOKEN` and `GITHUB_REPO` env vars (never used)
- Update runner comparison table in architecture.md to include local minicomputer runner

#### 3b. Add minicomputer setup to docs
- `docs/docs_overall/environments.md` — add "Local Minicomputer" row to environment table
- `evolution/docs/evolution/reference.md` — add minicomputer deployment section with:
  - Prerequisites (Node.js 18+, git clone, npm install, npm run build)
  - Required env vars
  - systemd timer setup
  - Monitoring via `journalctl -u evolution-runner -f`
  - Testing with `--dry-run`

#### 3c. Update runner comparison table
- `evolution/docs/evolution/architecture.md` — add Minicomputer Runner column:
  - Claim mechanism: `claim_evolution_run` RPC
  - runner_id: `runner-<uuid>`
  - Heartbeat: 60s interval
  - maxDurationMs: Not set (no timeout)
  - Resume support: Full
  - Timeout yielding: No (runs to completion)
  - Auth: Direct Supabase service role

### Phase 4: Minicomputer Setup (Ops)
**Goal**: Get the minicomputer running evolution pipelines.

#### 4a. Prerequisites on minicomputer
```bash
# Clone repo
git clone <repo-url> && cd explainanything

# Set up environment
cp .env.example .env.local
# Edit .env.local with:
#   NEXT_PUBLIC_SUPABASE_URL=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   DEEPSEEK_API_KEY=...
#   PINECONE_API_KEY=...
#   PINECONE_INDEX_NAME_ALL=...

# Secure the env file
chmod 600 .env.local

# Install and build
npm install
npm run build
```

#### 4b. Create systemd unit files

**`/etc/systemd/system/evolution-runner.service`**:
```ini
[Unit]
Description=Evolution Batch Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=<minicomputer-user>
WorkingDirectory=/path/to/explainanything
EnvironmentFile=/path/to/explainanything/.env.local
ExecStart=/usr/bin/npx tsx evolution/scripts/evolution-runner.ts --max-runs 10 --parallel 2 --max-concurrent-llm 20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=evolution-runner
TimeoutStartSec=infinity
```

**`/etc/systemd/system/evolution-runner.timer`**:
```ini
[Unit]
Description=Evolution Batch Runner Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true
# Note: systemd Type=oneshot with timer will NOT start a second instance
# if the previous invocation is still running. The next tick is skipped
# and rescheduled from when the current run finishes.

[Install]
WantedBy=timers.target
```

#### 4c. Enable and test
```bash
# Dry run test
npx tsx evolution/scripts/evolution-runner.ts --dry-run --max-runs 1

# Enable timer
sudo systemctl daemon-reload
sudo systemctl enable evolution-runner.timer
sudo systemctl start evolution-runner.timer

# Monitor
sudo systemctl status evolution-runner.timer
journalctl -u evolution-runner -f
```

#### 4d. Security hardening
- `.env.local` with `chmod 600` AND `chown <service-user>:<service-user>` (owner-only read, owned by service user)
- Dedicated user account with minimal privileges (no sudo, no SSH key for other machines)
- Disk encryption if machine could be physically accessed
- Keep OS, Node.js, npm dependencies updated
- No inbound ports needed — all outbound HTTPS
- Consider API key rotation schedule

#### 4e. Environment variables reference
**Required** (minicomputer will not work without these):
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (full DB access, bypasses RLS)
- `PINECONE_API_KEY` — Pinecone vector DB
- `PINECONE_INDEX_NAME_ALL` — Pinecone index name

**At least one LLM key required** (depends on models used):
- `DEEPSEEK_API_KEY` — for `deepseek-chat` and `deepseek-reasoner` models (most common)
- `OPENAI_API_KEY` — for `gpt-4.1-*` models
- `ANTHROPIC_API_KEY` — for `claude-*` models (optional, only if using Anthropic)

**Not needed on minicomputer**:
- `CRON_SECRET` — only for Vercel cron auth
- `GITHUB_TOKEN` / `GITHUB_REPO` — never used (docs were inaccurate)
- `OTEL_*` / `SENTRY_DSN` — observability, optional (logs go to systemd journal instead)

## Testing

### Unit Tests
- Test prompt-based run handling in batch runner (new)
- Test DB logger integration in batch runner (new)
- Existing batch runner tests should still pass

### Manual Verification
1. **Phase 1 verification**: Run batch runner locally with `--max-runs 1` against dev DB, verify:
   - Prompt-based run executes successfully
   - Logs appear in admin UI Logs tab
   - Variants, Elo ratings, cost visible in dashboard during execution
2. **Phase 2 verification**: Deploy vercel.json change, monitor for 1 hour, verify:
   - No cron-triggered evolution runs appear — check `runner_id` column: Vercel cron uses `cron-runner-<uuid>`, minicomputer uses `runner-<uuid>`, admin trigger uses `admin-trigger`
   - Admin UI "Trigger" button still works (POST path unaffected)
   - Watchdog cron still fires every 15 min (separate cron entry in vercel.json)
3. **Phase 4 verification**: On minicomputer, verify:
   - `--dry-run` connects to Supabase successfully
   - systemd timer fires every 5 min (`systemctl list-timers`)
   - Full run completes end-to-end with results in dashboard
   - `journalctl -u evolution-runner` shows expected output

### Rollback Plan
- **Phase 1 rollback**: Revert batch runner code changes (git revert). Prompt-based runs fall back to Vercel POST trigger
- **Phase 2 rollback**: Re-add evolution cron line to `vercel.json` and deploy (~5 min). Vercel cron resumes claiming runs
- **Phase 4 rollback**: `sudo systemctl stop evolution-runner.timer && sudo systemctl disable evolution-runner.timer`
- **No data loss**: All run state is in Supabase. Switching between runners is seamless since they use the same atomic claiming RPC
- **Coexistence is safe**: If both Vercel cron and minicomputer run simultaneously during rollback, `claim_evolution_run` RPC prevents double-claiming via `FOR UPDATE SKIP LOCKED`

### CI Safety
- Removing the evolution cron from `vercel.json` does NOT affect CI — `.github/workflows/ci.yml` has no references to evolution cron schedules
- The POST endpoint at `/api/evolution/run` is unaffected — only the Vercel-triggered GET cron schedule is removed

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/environments.md` — add Local Minicomputer environment row
- `evolution/docs/evolution/architecture.md` — fix Batch Dispatch reference, update runner comparison table
- `evolution/docs/evolution/reference.md` — fix Batch Dispatch card, remove GITHUB_TOKEN/GITHUB_REPO, add minicomputer deployment section
