# Minicomputer Deployment

Step-by-step guide for deploying the evolution batch runner on a local minicomputer.

## Prerequisites

- Ubuntu (or similar Linux with systemd)
- Node.js 20+ (nvm recommended)
- Git clone of the repo
- Production credentials (Supabase, DeepSeek/OpenAI, Pinecone)

## 1. Clone and Install

```bash
git clone <repo-url> ~/explainanything
cd ~/explainanything
npm ci
```

## 2. Environment Variables

The runner needs two env files:

- **`.env.local`** — shared keys (DEEPSEEK, PINECONE, etc.) and dev Supabase credentials for local testing
- **`.env.evolution-prod`** — production overrides (loaded second, so prod values win)

### Create `.env.evolution-prod`

```bash
nano .env.evolution-prod
```

Add these 3 lines with your production values:

```
NEXT_PUBLIC_SUPABASE_URL=https://<prod-project-id>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<prod service role key>
PINECONE_INDEX_NAME_ALL=explainanythingprodlarge
```

Get the prod service role key from the Vercel dashboard (Settings → Environment Variables → Production) or the Supabase dashboard.

Lock down permissions:

```bash
chmod 600 .env.evolution-prod
```

### Required env vars (across both files)

| Variable | Source file | Description |
|----------|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.evolution-prod` | Production Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.evolution-prod` | Production service role key |
| `PINECONE_INDEX_NAME_ALL` | `.env.evolution-prod` | `explainanythingprodlarge` |
| `DEEPSEEK_API_KEY` | `.env.local` | DeepSeek API key (same across environments) |
| `PINECONE_API_KEY` | `.env.local` | Pinecone API key (same across environments) |

### Troubleshooting `.env.local`

If `source .env.local` fails with errors like `x-honeycomb-team=...: command not found`, there's a bare line without a variable name. Remove it:

```bash
sed -i '/^x-honeycomb-team=/d' .env.local
```

## 3. Dry-Run Test

Verify credentials work without executing any real runs:

```bash
set -a
source .env.local
source .env.evolution-prod
set +a
npx tsx evolution/scripts/evolution-runner.ts --dry-run --max-runs 1
```

Expected output:

```
[...] [INFO] Evolution runner starting {"runnerId":"runner-...","dryRun":true,...}
[...] [INFO] No pending runs found, exiting
[...] [INFO] Runner finished {"processedRuns":0,"shuttingDown":false}
```

If this fails, check your env vars. If it says "Missing SUPABASE_URL", the env files didn't load correctly.

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
| `EnvironmentFile=` (first) | `/opt/explainanything/.env.local` | Your `.env.local` path |
| `EnvironmentFile=` (second) | `/opt/explainanything/.env.evolution-prod` | Your `.env.evolution-prod` path |
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
3. The script connects to production Supabase, claims up to 10 pending runs (2 in parallel)
4. Each run executes the full evolution pipeline (no timeout, runs to completion)
5. When done, the process exits. Systemd starts it again on the next timer tick

Before claiming runs, the script runs housekeeping: watchdog (stale run detection/recovery), experiment driver (state machine transitions), and orphaned reservation cleanup. The admin UI "Trigger" button on Vercel still works for ad-hoc single runs.

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

1. Go to the admin UI at `/admin/evolution/runs`
2. Click "Trigger" on a pending run to execute it via Vercel serverless
3. Note: Vercel has a ~13 minute timeout per invocation; long runs will checkpoint and require re-triggering
