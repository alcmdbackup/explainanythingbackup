# Minicomputer / Server Deployment

This guide covers deploying the evolution system on a dedicated server or minicomputer, replacing Vercel cron-based execution with a persistent local runner.

## Prerequisites

### Runtime

- **Node.js** >= 18 (LTS recommended)
- **npm** >= 9
- **tsx** — installed globally or via `npx`

### Environment Files

The batch runner (`processRunQueue.ts`) connects to **both staging and production** Supabase databases, round-robin claiming runs from each. It uses two existing env files with `dotenv.parse()` to read separate credential sets without variable name collisions.

#### `.env.local` (staging + shared API keys)

This file contains staging Supabase credentials and shared API keys (OpenAI, DeepSeek). It's also loaded into `process.env` via `dotenv.config()` so `callLLM` can access the API keys.

```
NEXT_PUBLIC_SUPABASE_URL=https://<staging-project-id>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<staging service role key>
OPENAI_API_KEY=<your OpenAI API key>
DEEPSEEK_API_KEY=<your DeepSeek API key>
ANTHROPIC_API_KEY=<your Anthropic API key>
```

#### `.env.evolution-prod` (prod Supabase only)

```
NEXT_PUBLIC_SUPABASE_URL=https://<prod-project-id>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<prod service role key>
```

Get service role keys from the Supabase dashboard for each project (Settings → API → service_role key).

**File permissions**: Both env files must be `chmod 600` since they contain service role keys.

```bash
chmod 600 .env.local .env.evolution-prod
```

**Optional:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOCAL_LLM_BASE_URL` | Ollama or other local LLM endpoint | `http://localhost:11434/v1` |
| `EVOLUTION_MAX_CONCURRENT_RUNS` | Max parallel runs across all runners | `5` |

## CLI Runner Scripts

The system provides runner scripts with different use cases. All live under `evolution/scripts/`.

### Primary: `processRunQueue.ts`

The main batch runner for production workloads. Claims pending runs from both staging and production databases using round-robin scheduling and executes them with configurable parallelism.

```bash
# Run with defaults (1 parallel executor, 20 LLM concurrency)
npx tsx evolution/scripts/processRunQueue.ts

# Run 3 executors in parallel, cap at 50 total runs
npx tsx evolution/scripts/processRunQueue.ts --parallel 3 --max-runs 50

# Limit concurrent LLM API calls to 10
npx tsx evolution/scripts/processRunQueue.ts --parallel 2 --max-concurrent-llm 10

# Preview what would be claimed without executing
npx tsx evolution/scripts/processRunQueue.ts --dry-run --max-runs 1
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Test mode — claim and log but do not execute | off |
| `--max-runs N` | Stop after N total runs | `10` |
| `--parallel N` | Number of parallel run executors | `1` |
| `--max-concurrent-llm N` | Global LLM API concurrency cap | `20` |

The runner generates an ID in the format `v2-<hostname>-<pid>-<timestamp>` and writes it to the `runner_id` column on claimed runs.

The round-robin strategy alternates between targets when claiming: it tries staging, then prod, then staging again, etc. If one target has no pending runs it is skipped. At startup, a pre-flight connectivity check verifies each target is reachable; unreachable targets are skipped with a warning. If no targets are reachable, the runner exits with a fatal error.

When no pending runs remain, it exits cleanly. It handles SIGTERM/SIGINT for graceful shutdown — on the first signal it stops claiming new runs and waits for in-flight executions to finish.

### Local Standalone: `run-evolution-local.ts`

For development, testing, and one-off runs. Creates its own LLM provider directly (bypassing the Next.js import chain) and writes results to a local JSON file.

```bash
# Evolve an existing markdown file with mock LLM (no API keys needed)
npx tsx evolution/scripts/run-evolution-local.ts \
  --file docs/sample_evolution_content/filler_words.md --mock

# Evolve from a topic prompt using DeepSeek
npx tsx evolution/scripts/run-evolution-local.ts \
  --prompt "Explain quantum entanglement" --model deepseek-chat --iterations 5

# Use Claude with a budget cap
npx tsx evolution/scripts/run-evolution-local.ts \
  --prompt "How neural networks learn" --model claude-sonnet-4-20250514 --budget 2.00

# Run against a local Ollama model
npx tsx evolution/scripts/run-evolution-local.ts \
  --file article.md --model LOCAL_llama3 --iterations 3
```

| Flag | Description | Default |
|------|-------------|---------|
| `--file <path>` | Markdown file to evolve | — |
| `--prompt <text>` | Topic prompt (generates seed then evolves) | — |
| `--mock` | Use mock LLM — no API keys needed | off |
| `--model <name>` | LLM model for generation | `deepseek-chat` |
| `--seed-model <name>` | Model for seed article generation | same as `--model` |
| `--judge-model <name>` | Override judge model for comparisons | same as `--model` |
| `--iterations <n>` | Number of evolution iterations | `3` |
| `--budget <n>` | Budget cap in USD | `5.00` |
| `--strategies-per-round <n>` | Generation strategies per iteration | `3` |
| `--output <path>` | Output JSON file path | auto-timestamped |
| `--explanation-id <n>` | Link run to an explanation in DB | — |

> **Note:** `--file` and `--prompt` are mutually exclusive. One of them is required.

## LLM Provider Configuration

The local runner (`run-evolution-local.ts`) creates direct LLM clients based on the model name prefix. See [Reference](./reference.md) for the full model list.

| Provider | Model prefix | SDK | Key env var | Base URL |
|----------|-------------|-----|-------------|----------|
| OpenAI | `gpt-*` | `openai` | `OPENAI_API_KEY` | default (api.openai.com) |
| DeepSeek | `deepseek-*` | `openai` with baseURL override | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` |
| Anthropic | `claude-*` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` | default (api.anthropic.com) |
| Ollama | `LOCAL_*` | `openai` with baseURL override | none (key = `"local"`) | `LOCAL_LLM_BASE_URL` or `http://localhost:11434/v1` |

Anthropic calls use `max_tokens: 8192`. OpenAI-compatible providers (OpenAI, DeepSeek, Ollama) use `temperature: 0.7`. All providers are configured with `maxRetries: 3`. Ollama gets a longer timeout of 300 seconds; all others use 60 seconds.

> **Warning:** Local models (`LOCAL_*` prefix) strip the prefix before sending to the API. A model specified as `LOCAL_llama3` sends `llama3` to the Ollama endpoint.

## Systemd Service Setup

For persistent operation, run the batch runner as a systemd oneshot service triggered by a timer.

### Dry-Run Test

Before installing the service, verify credentials work:

```bash
npx tsx evolution/scripts/processRunQueue.ts --dry-run --max-runs 1
```

Expected output:

```
[...] [INFO] Connected to databases {"targets":["staging","prod"]}
[...] [INFO] Evolution runner starting {"runnerId":"v2-...","dryRun":true,...}
[...] [INFO] No pending runs found, exiting
[...] [INFO] Runner finished {"processedRuns":0,"shuttingDown":false}
```

If a target is unreachable, the runner logs a warning and continues with the remaining target. If both are unreachable, it exits with a fatal error.

### Install Unit Files

```bash
sudo cp evolution/deploy/evolution-runner.service /etc/systemd/system/
sudo cp evolution/deploy/evolution-runner.timer /etc/systemd/system/
```

### Edit the Service File

```bash
sudo nano /etc/systemd/system/evolution-runner.service
```

Update these lines to match your machine:

| Line | Default | Change to |
|------|---------|-----------|
| `WorkingDirectory=` | `/opt/explainanything` | Your repo path (e.g. `/home/ac/Documents/ac/explainanything-worktree0`) |
| `Environment=PATH=` | `/usr/local/bin:/usr/bin:/bin` | Add your Node.js bin dir (e.g. `/home/ac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin`) |
| `ExecStart=` | `/usr/bin/npx` | Your npx path (find with `which npx`) |
| `User=` | `evolution` | Your username |
| `Group=` | `evolution` | Your username |

**nvm users:** systemd doesn't load your shell profile, so it can't find `node`. You must add the nvm bin directory to `Environment=PATH=`. Find it with `which npx`.

**Note:** There is no `EnvironmentFile` line — the script loads `.env.local` and `.env.evolution-prod` directly via `dotenv`.

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now evolution-runner.timer
```

### Verify

```bash
# Check timer is active and when it last/next fires
systemctl list-timers | grep evolution

# View recent logs
journalctl -u evolution-runner.service --no-pager -n 20

# Follow logs in real-time
journalctl -u evolution-runner.service -f
```

The timer fires every minute. If a run is still executing, systemd skips that tick — no overlap.

Look for `Connected to databases` with both targets listed to confirm multi-DB is working.

## Common Operations

### Stop the runner temporarily

```bash
sudo systemctl stop evolution-runner.timer
```

### Restart after a code update

```bash
cd ~/explainanything
git pull origin main
npm ci
sudo systemctl restart evolution-runner.timer
```

### Disable permanently

```bash
sudo systemctl stop evolution-runner.timer
sudo systemctl disable evolution-runner.timer
```

### Check if a run is currently executing

```bash
systemctl status evolution-runner.service
```

## Operational Considerations

### How It Works

1. The systemd **timer** fires every 60 seconds
2. It starts the **service**, which runs `npx tsx evolution/scripts/processRunQueue.ts`
3. The script loads `.env.local` (staging) and `.env.evolution-prod` (prod) via `dotenv.parse()`, creating separate Supabase clients for each
4. `dotenv.config({ path: '.env.local' })` loads shared API keys (OpenAI, DeepSeek) into `process.env` for `callLLM`
5. Pre-flight connectivity check verifies each target is reachable; unreachable targets are skipped
6. Round-robin loop iterates targets, calling `claimAndExecuteRun({ runnerId, db: target.client })` for each. Up to `--parallel N` runs execute concurrently via `Promise.allSettled`
7. `claimAndExecuteRun` handles the full lifecycle per run: claim → heartbeat → pipeline → finalize → cleanup
8. When no targets have pending runs, the process exits. Systemd starts it again on the next timer tick

The runner supports `--parallel N` and `--max-concurrent-llm N` CLI flags for parallel execution. All log entries include a `db` field in the context JSON indicating which database target (staging/prod) the operation is for. **Note:** The ops modules (watchdog, orphaned reservation cleanup) exist in `evolution/src/lib/ops/` but are **not currently wired** into the batch runner.

### Concurrent Run Limits

The `EVOLUTION_MAX_CONCURRENT_RUNS` environment variable (default `5`) is checked at claim time. Before claiming a new run, the runner counts all rows with status `'claimed'` or `'running'`. If the count meets or exceeds the limit, the claim is refused. This is a soft limit — multiple runners respect it independently by querying the same database. See [Architecture](./architecture.md) for details on the claim flow.

### Heartbeat and Stale Detection

Runners write a heartbeat timestamp to `last_heartbeat` on each claimed run every 30 seconds. Stale run cleanup happens automatically inside the `claim_evolution_run` RPC — every claim attempt expires runs that have been in `'claimed'` or `'running'` status for more than 10 minutes without a heartbeat update (or with a NULL heartbeat and `created_at` older than 10 minutes). This means dead runners never permanently block the claim queue.

A standalone watchdog in `evolution/src/lib/ops/watchdog.ts` provides defense-in-depth for environments where claim attempts are infrequent.

> **Warning:** If your server clock drifts significantly from the database server, stale detection may trigger prematurely. Ensure NTP is configured.

### Budget Caps

Cost control operates at two levels:

- **Per-run budget**: Set in the strategy configuration (`budget_cap_usd`). The runner tracks cumulative LLM spend during execution and aborts if the cap is reached.
- **Global spending gate**: Configured in the admin dashboard. Blocks new run claims when total spend exceeds the threshold.

See [Cost Optimization](./cost_optimization.md) for detailed budgeting strategies.

### Monitoring

- **Database**: Query `evolution_runs` for run status, duration, and cost. The `evolution_run_logs` table contains per-phase execution logs.
- **Admin dashboard**: The web UI shows active runs, runner status, and aggregate metrics.
- **Systemd journal**: Use `journalctl -u evolution-runner.service` for runner process logs.

```bash
# Check recent run outcomes
# (run from a machine with database access)
npx tsx -e "
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await db.from('evolution_runs')
    .select('id, status, runner_id, started_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.table(data);
"
```

### Disabling Vercel Cron

When migrating to minicomputer-based execution, remove the evolution cron entry from `vercel.json` to prevent the Vercel-hosted runner from competing for the same runs. The `claim_evolution_run` RPC is safe against double-claiming (it uses `FOR UPDATE SKIP LOCKED`), but running both wastes Vercel invocations.

> **Note:** The admin UI's manual "trigger run" button continues to work regardless of cron configuration — it creates a `pending` row that any runner can claim.

## Ollama Setup (Local LLM)

To run evolution with local models instead of cloud APIs:

### Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Pull Model

```bash
ollama pull qwen2.5:14b
```

### Verify Ollama is Running

```bash
curl http://localhost:11434/v1/models
```

### Run Evolution with Local Model

```bash
npx tsx evolution/scripts/run-evolution-local.ts \
  --prompt "Your topic" \
  --model LOCAL_qwen2.5:14b \
  --full --iterations 5
```

The `LOCAL_` prefix routes requests to Ollama's OpenAI-compatible API at `http://localhost:11434/v1`. Override with `LOCAL_LLM_BASE_URL` env var. Local model calls are tracked at $0 cost.

**Hardware note:** qwen2.5:14b requires ~10GB RAM. The 32GB minicomputer can run it alongside the evolution runner without issues. Expect ~30-60s per generation (vs ~2-5s for cloud APIs).

## Fallback: Manual Trigger via Admin UI

If the minicomputer is down and you need runs to execute:

1. Go to the admin UI at `/admin/evolution/experiments`
2. Create an experiment and add runs via the start-experiment page
3. Runs will be picked up by the batch runner when it comes back online
