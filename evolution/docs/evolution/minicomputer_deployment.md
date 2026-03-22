# Minicomputer / Server Deployment

This guide covers deploying the evolution system on a dedicated server or minicomputer, replacing Vercel cron-based execution with a persistent local runner.

## Prerequisites

### Runtime

- **Node.js** >= 18 (LTS recommended)
- **npm** >= 9
- **tsx** — installed globally or via `npx`

### Environment Variables

Create an `.env.local` file in the `evolution/` directory (or use a systemd `EnvironmentFile`).

**Required — at least one LLM provider:**

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI (GPT-4, etc.) |
| `DEEPSEEK_API_KEY` | DeepSeek (deepseek-chat, etc.) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude models) |

**Required — database connection:**

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for server-side access |

For the multi-target runner, you need separate staging and production credentials:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL_STAGING` | Staging Supabase URL |
| `SUPABASE_KEY_STAGING` | Staging service-role key |
| `SUPABASE_URL_PROD` | Production Supabase URL |
| `SUPABASE_KEY_PROD` | Production service-role key |

**Optional:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOCAL_LLM_BASE_URL` | Ollama or other local LLM endpoint | `http://localhost:11434/v1` |
| `EVOLUTION_MAX_CONCURRENT_RUNS` | Max parallel runs across all runners | `5` |

## CLI Runner Scripts

The system provides three runner scripts with different use cases. All live under `evolution/scripts/`.

### Primary: `evolution-runner-v2.ts`

The main batch runner for production workloads. It claims pending runs from the database and executes them with configurable parallelism.

```bash
# Run with defaults (1 parallel executor, 20 LLM concurrency)
npx tsx evolution/scripts/evolution-runner-v2.ts

# Run 3 executors in parallel, cap at 50 total runs
npx tsx evolution/scripts/evolution-runner-v2.ts --parallel 3 --max-runs 50

# Limit concurrent LLM API calls to 10
npx tsx evolution/scripts/evolution-runner-v2.ts --parallel 2 --max-concurrent-llm 10
```

| Flag | Description | Default |
|------|-------------|---------|
| `--parallel N` | Number of parallel run executors | `1` |
| `--max-runs N` | Stop after N runs completed | unlimited |
| `--max-concurrent-llm N` | Global LLM API concurrency cap | `20` |

The runner generates an ID in the format `v2-<hostname>-<pid>-<timestamp>` and writes it to the `runner_id` column on claimed runs.

When no pending runs remain, it exits cleanly. It handles SIGTERM/SIGINT for graceful shutdown — on the first signal it stops claiming new runs and waits for in-flight executions to finish; on a second signal it force-exits.

### Multi-Target: `evolution-runner.ts`

Claims runs from both staging and production databases using round-robin scheduling. Requires `SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING`, `SUPABASE_URL_PROD`, and `SUPABASE_KEY_PROD`.

```bash
# Preview what would be claimed without executing
npx tsx evolution/scripts/evolution-runner.ts --dry-run

# Run up to 20 runs across staging + prod, 2 parallel executors
npx tsx evolution/scripts/evolution-runner.ts --max-runs 20 --parallel 2

# With LLM concurrency cap
npx tsx evolution/scripts/evolution-runner.ts --max-runs 10 --max-concurrent-llm 5
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Test mode — claim and log but do not execute | off |
| `--max-runs N` | Stop after N total runs | `10` |
| `--parallel N` | Parallel executors | `1` |
| `--max-concurrent-llm N` | Global LLM concurrency cap | `20` |

The round-robin strategy alternates between targets when claiming: it tries staging, then prod, then staging again, etc. If one target has no pending runs it is skipped. The runner ID format is `runner-<uuid8>`.

> **Note:** The multi-target runner validates connectivity to both databases at startup. If either is unreachable, it exits with a fatal error.

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

For persistent operation, run the V2 runner as a systemd service.

### Environment File

Create `/etc/evolution-runner.env`:

```ini
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
EVOLUTION_MAX_CONCURRENT_RUNS=5
```

### Unit File

Create `/etc/systemd/system/evolution-runner.service`:

```ini
[Unit]
Description=Evolution V2 Batch Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=evolution
Group=evolution
WorkingDirectory=/opt/evolution
EnvironmentFile=/etc/evolution-runner.env
ExecStart=/usr/bin/npx tsx evolution/scripts/evolution-runner-v2.ts --parallel 2 --max-concurrent-llm 10

# Graceful shutdown: send SIGTERM, wait up to 30 min for in-flight runs
KillSignal=SIGTERM
TimeoutStopSec=1800

Restart=on-failure
RestartSec=30

StandardOutput=journal
StandardError=journal
SyslogIdentifier=evolution-runner

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable evolution-runner.service
sudo systemctl start evolution-runner.service

# Check status and logs
sudo systemctl status evolution-runner.service
sudo journalctl -u evolution-runner.service -f
```

> **Note:** The 30-minute `TimeoutStopSec` is intentional. Evolution runs can take several minutes each, and the runner needs time to finish in-flight work after receiving SIGTERM. A second SIGTERM (or SIGKILL after timeout) forces immediate exit.

## Operational Considerations

### Concurrent Run Limits

The `EVOLUTION_MAX_CONCURRENT_RUNS` environment variable (default `5`) is checked at claim time. Before claiming a new run, the runner counts all rows with status `'claimed'` or `'running'`. If the count meets or exceeds the limit, the claim is refused. This is a soft limit — multiple runners respect it independently by querying the same database. See [Architecture](./architecture.md) for details on the claim flow.

### Heartbeat and Stale Detection

Runners write a heartbeat timestamp to `last_heartbeat` on each claimed run every 30 seconds. A background watchdog detects runs whose heartbeat is older than 10 minutes (`EVOLUTION_STALENESS_THRESHOLD_MINUTES`) and marks them as failed, freeing them for retry.

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
