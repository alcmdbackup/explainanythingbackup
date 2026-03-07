# Use Local Minicomputer Not GH For Evolution Runs Research

## Problem Statement
Migrate evolution batch runner from GitHub Actions to local minicomputer. Currently, evolution pipeline runs are dispatched via Vercel cron (every 5 min, 1 run at a time, 800s max per invocation) with continuation-passing for long runs. Running the batch runner locally on a minicomputer provides unlimited execution time, parallelism, lower cost, and easier debugging.

## Requirements (from GH Issue #654)
1. Set up evolution batch runner on local minicomputer
2. Configure env vars (Supabase, OpenAI, DeepSeek, Pinecone) on minicomputer
3. Replace GitHub Actions workflow dispatch with local cron/systemd service
4. Update dashboard Batch Dispatch card to trigger local runner instead of GH Actions
5. Ensure heartbeat/watchdog still works for local runs
6. Update docs to reflect new local runner setup

## High Level Summary

### Key Discovery: No GitHub Actions Dispatch Exists
The docs reference a "Batch Dispatch" card triggering GitHub Actions and `GITHUB_TOKEN`/`GITHUB_REPO` env vars, but **no such implementation exists**:
- No `.github/workflows/*evolution*` workflow files
- No GitHub dispatch code in any UI components
- No `GITHUB_TOKEN` usage in `src/` code

### Current Architecture
1. **Vercel Cron** (`vercel.json`): `GET /api/evolution/run` every 5 min — 1 run, 800s max, continuation-passing
2. **Admin UI Trigger** (`runs/page.tsx`): Per-run "Trigger" button — POST with `{ runId }`, same 800s limit
3. **Batch Runner Script** (`evolution/scripts/evolution-runner.ts`): Already exists — `--parallel N`, no timeout, direct Supabase auth

### Revised Scope
The batch runner script already exists. The actual work is:
1. **Ops/Config**: Set up minicomputer to run `evolution-runner.ts` via systemd timer
2. **Code fixes**: Fix batch runner gaps (prompt-based runs, DB logging)
3. **Vercel cron**: Disable evolution run cron in `vercel.json`
4. **Doc updates**: Fix inaccurate GH Actions references

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md — references "Batch Dispatch" card triggering GH Actions (not implemented)
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/environments.md — env var reference, no minicomputer section yet

### Evolution Docs
- evolution/docs/evolution/README.md — overview, code layout
- evolution/docs/evolution/architecture.md — pipeline phases, runner comparison, continuation flow
- evolution/docs/evolution/reference.md — CLI commands, env vars, inaccurate GITHUB_TOKEN/GITHUB_REPO refs
- evolution/docs/evolution/cost_optimization.md — cost tracking, strategy analysis

## Code Files Read

### Runner Infrastructure
- `src/app/api/evolution/run/route.ts` — unified endpoint, GET (cron) + POST (admin), 800s maxDuration, dual auth
- `src/app/api/cron/evolution-runner/route.ts` — legacy re-export of unified endpoint
- `src/app/api/cron/evolution-watchdog/route.ts` — stale run detection (10min), checkpoint recovery, continuation abandonment (30min)
- `evolution/src/services/evolutionRunnerCore.ts` — shared claim+execute, supports all run types (explanation, prompt, resume)
- `evolution/scripts/evolution-runner.ts` — standalone batch runner, parallel execution, graceful shutdown
- `evolution/src/services/evolutionRunClient.ts` — client-side fetch wrapper for `/api/evolution/run`
- `src/lib/services/llmSemaphore.ts` — FIFO counting semaphore for LLM call throttling

### Other Crons
- `src/app/api/cron/experiment-driver/route.ts` — experiment state machine (pending→running→analyzing→completed), does NOT queue runs
- `src/app/api/cron/reset-orphaned-reservations/route.ts` — serverless-specific cleanup, must stay on Vercel
- No `/api/cron/content-quality-eval` endpoint exists (referenced in docs but not implemented)

### Logging
- `evolution/src/lib/core/logger.ts` — `createEvolutionLogger` (stdout) vs `createDbEvolutionLogger` (stdout + DB via LogBuffer)
- `evolution/src/lib/core/seedArticle.ts` — generates seed article from prompt via 2 LLM calls

### Dashboard
- `src/app/admin/evolution/runs/page.tsx` — per-run Trigger + Kill buttons, NO batch dispatch card
- `src/app/admin/evolution-dashboard/page.tsx` — overview stats, no batch trigger

### Config
- `vercel.json` — cron schedules
- `.env.example` — env var template
- `tsconfig.json` — `@/*` and `@evolution/*` path aliases (required for tsx execution)

## Key Findings

### Round 1: Core Architecture
1. **Batch runner script already exists** and supports parallel execution, resume, graceful shutdown
2. **No GitHub Actions evolution workflow exists** — docs are inaccurate
3. **Vercel cron limitations**: 800s timeout, 1 run per invocation, continuation overhead
4. **Local batch runner bypasses all Vercel limitations**: no timeout, parallel, direct Supabase auth
5. **Watchdog works regardless of runner source** — monitors heartbeat timestamps
6. **Atomic claiming** via `claim_evolution_run` RPC (`FOR UPDATE SKIP LOCKED`) — safe for concurrent runners

### Round 2: Deeper Analysis

#### Minicomputer Setup Requirements
7. **Minimal footprint**: Node.js 18+, `npm install`, `npm run build` (for `@/` path alias resolution), env vars
8. **No Next.js server needed** — batch runner imports evolution lib modules directly
9. **Dynamic imports**: `evolution-runner.ts` uses `await import()` for evolution library — must run from repo root
10. **Required env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY` (or `OPENAI_API_KEY`), `PINECONE_API_KEY`, `PINECONE_INDEX_NAME_ALL`

#### Scheduling
11. **Script is one-shot** (runs once, exits) — NOT a daemon. No `--loop` or `--daemon` flag
12. **Best scheduling**: systemd timer (every 5 min) — native journaling, predictable, no script changes needed
13. **Exit behavior**: exits 0 when no pending runs or max-runs reached; exits 1 on crash

#### Batch Runner Gaps
14. **Prompt-based runs NOT supported** — batch runner explicitly rejects `explanation_id === null` for new runs (lines 170-175), marks as failed. evolutionRunnerCore handles them fine via `generateSeedArticle()`
15. **No database logging** — batch runner uses inline `console.log()` only. Web runner uses `createDbEvolutionLogger()` which writes to `evolution_run_logs` table. Batch run logs are invisible in admin UI
16. **No OpenTelemetry** — tracing only works in Next.js server context

#### Cron Job Dependencies
17. **Must stay on Vercel**: `/api/cron/reset-orphaned-reservations` (serverless-specific cleanup)
18. **Should disable on Vercel**: `/api/evolution/run` cron (avoid duplicate claims with local runner)
19. **Can stay or move**: watchdog (works anywhere with Supabase), experiment-driver (pure DB state machine)
20. **No auto-queuing exists** — all runs are manually queued by admin UI actions

#### Vercel Cron Disable Options
21. **Best option**: Remove `/api/evolution/run` cron line from `vercel.json` — clean, no race conditions
22. **Fallback**: Set `EVOLUTION_MAX_CONCURRENT_RUNS=0` in Vercel env — blocks claiming but wastes invocations
23. **Race condition risk if both active**: `claim_evolution_run` RPC has no runner-type preference — both compete for same runs. Safe (no double-claiming) but wasteful
24. **Admin UI POST still works** after removing cron — only GET (cron-triggered) path is disabled

#### Doc Inaccuracies to Fix
25. `evolution/docs/evolution/architecture.md` line 306 — "Batch Dispatch" card references
26. `evolution/docs/evolution/reference.md` line 372 — "Batch Dispatch card" description
27. `evolution/docs/evolution/reference.md` lines 405-406 — `GITHUB_TOKEN` and `GITHUB_REPO` env vars
28. `docs/plans/2026-02-13-parallel-evolution-runner-design.md` — design for unimplemented `dispatchEvolutionBatchAction`
29. Several planning docs reference nonexistent GH Actions dispatch flow

## Network & Communication Model

The batch runner is **100% outbound-only**. It makes HTTPS calls to cloud services and accepts zero inbound connections:

| Service | Protocol | Direction |
|---------|----------|-----------|
| Supabase (PostgreSQL) | HTTPS | Outbound |
| OpenAI / DeepSeek / Anthropic | HTTPS | Outbound |
| Pinecone (vectors) | HTTPS | Outbound |

- Minicomputer can sit behind NAT with no port forwarding, no public IP, no firewall rules
- No direct communication between dashboard and minicomputer — both talk to Supabase
- DB-based signaling: admin queues a run (status=`pending`), minicomputer's next timer cycle claims it
- For urgent one-off runs, the existing Vercel POST endpoint still works (800s limit)

### In-Progress Visibility

All pipeline data is written to the database by `executeFullPipeline()` — the same code path regardless of runner. The dashboard reads from Supabase, so all in-progress updates are visible:
- Variants, Elo ratings, cost per agent, checkpoints, phase transitions, iteration count, heartbeat
- Only gap: batch runner's own operational log messages (not pipeline logs) currently go to stdout only — fixing this is in the plan

## Security Considerations

### Credential Exposure
- Minicomputer stores `SUPABASE_SERVICE_ROLE_KEY` — a **full admin key** bypassing all row-level security. If the machine is compromised, attacker gets full DB read/write access
- LLM API keys (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`) carry spending risk
- **Mitigations**: `.env` file with `chmod 600`, dedicated user account with minimal system privileges, disk encryption if machine could be physically accessed, keep OS and Node.js updated

### Network Attack Surface
- **Zero inbound attack surface** — no ports open, no HTTP server, no public IP needed
- All connections are outbound HTTPS with TLS
- Standard home/office NAT provides sufficient isolation

### Not New Risks
- Same API keys already exist in Vercel env vars and on dev machines
- `claim_evolution_run` RPC is injection-safe (parameterized SQL)
- Batch runner runs the same pipeline code as the Vercel cron — no new code paths
- Atomic claiming prevents any tampering with run ownership

### Operational Risk
- Unattended minicomputer with long-lived API keys is the main real-world risk
- Keep OS, Node.js, and npm dependencies updated
- Consider key rotation schedule for API keys
- Monitor systemd journal for unexpected failures

## Open Questions

1. What minicomputer hardware/OS is being used? (affects systemd setup details)
2. Should the Vercel cron for evolution runs be disabled immediately or after a testing period?
3. What parallelism level for the minicomputer? (depends on CPU/RAM and API rate limits)
4. Should watchdog and experiment-driver crons also move to minicomputer?
5. Should a new dashboard "Batch Dispatch" card be built, or is cron-based execution + per-run Trigger sufficient?
6. How should minicomputer logs be monitored? (systemd journal, push to observability stack?)

## Action Items for Planning

### Code Changes Needed
1. **Fix batch runner prompt support**: Remove rejection at lines 170-175, add `generateSeedArticle()` path (port from evolutionRunnerCore.ts lines 130-185)
2. **Add DB logging to batch runner**: Replace inline `log()` with `createDbEvolutionLogger()`, call `flush()` at end of run
3. **Disable Vercel evolution cron**: Remove `/api/evolution/run` cron from `vercel.json`
4. **Fix inaccurate docs**: Update architecture.md and reference.md to reflect local minicomputer runner

### Ops Setup (Not Code)
5. **Create systemd unit files**: `evolution-runner.service` (Type=oneshot) + `evolution-runner.timer` (5min interval)
6. **Configure env vars on minicomputer**: `.env.local` or systemd `Environment=` directives
7. **Clone repo, npm install, npm run build** on minicomputer
8. **Test with `--dry-run`** before enabling timer
