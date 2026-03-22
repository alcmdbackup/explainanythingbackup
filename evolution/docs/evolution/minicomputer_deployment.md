# Minicomputer Deployment

Step-by-step guide for deploying the evolution batch runner on a local minicomputer.

## Prerequisites

- Ubuntu (or similar Linux with systemd)
- Node.js 20+ (nvm recommended)
- Git clone of the repo
- Production credentials (Supabase, OpenAI)

## 1. Clone and Install

```bash
git clone <repo-url> ~/explainanything
cd ~/explainanything
npm ci
```

## 2. Environment Variables

The runner connects to **both staging and production** Supabase databases, round-robin claiming runs from each. All credentials go in a single env file.

### Create `.env.evolution-targets`

```bash
touch .env.evolution-targets && chmod 600 .env.evolution-targets
nano .env.evolution-targets
```

Add all 5 required variables:

```
OPENAI_API_KEY=<your OpenAI API key>
SUPABASE_URL_STAGING=https://<staging-project-id>.supabase.co
SUPABASE_KEY_STAGING=<staging service role key>
SUPABASE_URL_PROD=https://<prod-project-id>.supabase.co
SUPABASE_KEY_PROD=<prod service role key>
```

Get service role keys from the Supabase dashboard for each project (Settings → API → service_role key).

### Required env vars

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (required for LLM calls) |
| `SUPABASE_URL_STAGING` | Staging Supabase project URL |
| `SUPABASE_KEY_STAGING` | Staging Supabase service role key |
| `SUPABASE_URL_PROD` | Production Supabase project URL |
| `SUPABASE_KEY_PROD` | Production Supabase service role key |

**File permissions**: The env file must be `chmod 600` since it contains service role keys.

**Migration note**: The old env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and old env files (`.env.local`, `.env.evolution-prod`) are no longer used. They can be left in place — the runner ignores them.

## 3. Dry-Run Test

Verify credentials work without executing any real runs:

```bash
set -a
source .env.evolution-targets
set +a
npx tsx evolution/scripts/evolution-runner.ts --dry-run --max-runs 1
```

Expected output:

```
[...] [INFO] Connected to databases {"targets":["staging","prod"]}
[...] [INFO] Evolution runner starting {"runnerId":"runner-...","dryRun":true,...}
[...] [INFO] No pending runs found, exiting
[...] [INFO] Runner finished {"processedRuns":0,"shuttingDown":false}
```

If this fails, check your env vars. If it says "Missing required environment variables", the env file didn't load correctly. If it says "Unreachable targets", verify the Supabase URLs and keys are correct.

## 4. Install Systemd Files

```bash
sudo cp evolution/deploy/evolution-runner.service /etc/systemd/system/
sudo cp evolution/deploy/evolution-runner.timer /etc/systemd/system/
```

### Edit the service file

```bash
sudo nano /etc/systemd/system/evolution-runner.service
```

Update these lines to match your machine:

| Line | Default | Change to |
|------|---------|-----------|
| `WorkingDirectory=` | `/opt/explainanything` | Your repo path (e.g. `/home/ac/Documents/ac/explainanything-worktree0`) |
| `EnvironmentFile=` | `/opt/explainanything/.env.evolution-targets` | Your `.env.evolution-targets` path |
| `Environment=PATH=` | `/usr/local/bin:/usr/bin:/bin` | Add your Node.js bin dir (e.g. `/home/ac/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin`) |
| `ExecStart=` | `/usr/bin/npx` | Your npx path (find with `which npx`) |
| `User=` | `evolution` | Your username |
| `Group=` | `evolution` | Your username |

**nvm users:** systemd doesn't load your shell profile, so it can't find `node`. You must add the nvm bin directory to `Environment=PATH=`. Find it with `which npx`.

## 5. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now evolution-runner.timer
```

- `daemon-reload` — tells systemd to read the new unit files
- `enable` — starts the timer on boot
- `--now` — also starts it immediately

## 6. Verify

```bash
# Check timer is active and when it last/next fires
systemctl list-timers | grep evolution

# View recent logs
journalctl -u evolution-runner.service --no-pager -n 20

# Follow logs in real-time
journalctl -u evolution-runner.service -f
```

The timer fires every minute. If a run is still executing, systemd skips that tick — no overlap.

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

## How It Works

1. The systemd **timer** fires every 60 seconds
2. It starts the **service**, which runs `npx tsx evolution/scripts/evolution-runner.ts`
3. The script connects to both staging and production Supabase, round-robin claims up to 10 pending runs
4. Each run executes the V2 evolution pipeline (no timeout, runs to completion)
5. When done, the process exits. Systemd starts it again on the next timer tick

The runner supports `--parallel N` and `--max-concurrent-llm N` CLI flags for parallel execution. All log entries include a `db` field in the context JSON indicating which database target (staging/prod) the operation is for. **Note:** The ops modules (watchdog, orphaned reservation cleanup) exist in `evolution/src/lib/ops/` but are **not currently wired** into the batch runner.

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
