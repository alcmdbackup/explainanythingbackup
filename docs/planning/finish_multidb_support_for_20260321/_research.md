# Finish Multi-DB Support Research

## Problem Statement
PR #750 added multi-DB support to evolution-runner.ts, but PR #757 consolidated scripts into processRunQueue.ts and lost the multi-DB changes. The runner currently only connects to one Supabase DB via createSupabaseServiceClient(). This project restores multi-DB support in processRunQueue.ts, reading staging creds from .env.local and prod creds from .env.evolution-prod (the existing env files on the minicomputer), so the runner round-robin claims runs from both databases.

## Requirements (from GH Issue)
1. Modify processRunQueue.ts to use dotenv to parse .env.local (staging) and .env.evolution-prod (prod) and build two Supabase clients
2. Add DbTarget/TaggedRun types and round-robin claimBatch logic
3. Update systemd service to point to processRunQueue.ts (currently pointing to nonexistent evolution-runner.ts)
4. Update minicomputer_deployment.md to reflect the actual env file setup
5. Update tests for multi-DB support
6. Verify run 591666e6 gets claimed from staging

## High Level Summary

### Current State
- `processRunQueue.ts` creates a single Supabase client via `createSupabaseServiceClient()` which reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from process.env
- The systemd service on the minicomputer points to `evolution-runner.ts` which **no longer exists** → every 60s tick fails with `ERR_MODULE_NOT_FOUND`
- `.env.local` has staging creds, `.env.evolution-prod` has prod creds — both use the same var names
- Run 591666e6 is stuck pending on staging because no runner ever connects to the staging DB

### PR #750 Multi-DB Implementation (Lost)
PR #750 implemented a complete multi-DB runner in `evolution-runner.ts` (284 lines):
- `DbTarget` and `TaggedRun` types
- `buildDbTargets()` creating two Supabase clients from `SUPABASE_URL_STAGING/PROD` env vars
- Round-robin `claimBatch()` alternating between targets with exhaustion tracking
- RPC fallback (`claimNextRunFallback`) when `claim_evolution_run` RPC unavailable (error code 42883)
- Pre-flight connectivity check for all targets
- 513 lines of tests including round-robin verification

PR #757 consolidated `evolution-runner.ts` + `evolution-runner-v2.ts` → `processRunQueue.ts`, intentionally choosing v2's simpler single-DB architecture. The multi-DB code was dropped.

### Design Decision: dotenv.parse() over New Env File
User requested using existing `.env.local` and `.env.evolution-prod` rather than creating a new `.env.evolution-targets` file.

**Approach:** Use `dotenv.parse(fs.readFileSync(path))` to read each file into a separate plain object (does NOT touch process.env), then create Supabase clients with the respective creds. Load shared vars (API keys) via `dotenv.config()`.

**Confirmed safe:**
- `dotenv.parse()` returns `Record<string, string>` with zero side effects
- Handles comments, empty lines, quoted values, whitespace correctly
- `dotenv.config()` is independent from `parse()` — order doesn't matter
- Works in both systemd (env vars pre-loaded but dotenv reads files directly) and CLI contexts

### Client Type Compatibility
- `createSupabaseServiceClient()` returns `createClient(url, key)` from `@supabase/supabase-js` — same type
- `executeV2Run()` accepts `SupabaseClient` — fully compatible with `createClient()` directly
- We can drop the `createSupabaseServiceClient` import entirely

### Critical Finding: LLM Tracking
`callLLM()` internally calls `createSupabaseServiceClient()` to write to `llmCallTracking`. This always uses `process.env.NEXT_PUBLIC_SUPABASE_URL` (the primary/shared instance). LLM tracking will go to whichever DB's creds are in process.env — acceptable since we load `.env.local` (staging) into process.env for shared vars.

### Env Vars Needed

**Shared (in process.env via dotenv.config from .env.local):**
- `OPENAI_API_KEY` — required
- `DEEPSEEK_API_KEY` — required (default model is deepseek-chat)
- `ANTHROPIC_API_KEY` — optional
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — used by callLLM's tracking (will be staging's)
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME_ALL` — if needed by pipeline

**Per-target (from dotenv.parse):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key

### Systemd Service Status
| Item | Repo Template | Installed on System | Issue |
|------|---|---|---|
| ExecStart script | `processRunQueue.ts` | `evolution-runner.ts` | **File doesn't exist** |
| EnvironmentFile | `.env.evolution-targets` | `.env.local` + `.env.evolution-prod` | Template wrong |
| WorkingDirectory | `/opt/explainanything` | Correct dev path | Template needs update |

### RPC and Schema Notes
- `claim_evolution_run` RPC exists in migration `20260315000001`
- Column `strategy_config_id` was renamed to `strategy_id` in migration `20260320000001` — code references `strategy_config_id` in ClaimedRun interface
- The RPC returns `SETOF evolution_runs` so column name change is transparent to the RPC signature but affects the returned field names

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/minicomputer_deployment.md

## Code Files Read
- evolution/scripts/processRunQueue.ts — current single-DB runner (219 lines)
- evolution/scripts/processRunQueue.test.ts — current tests (253 lines)
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — executeV2Run signature
- evolution/src/lib/pipeline/setup/buildRunContext.ts — ClaimedRun type
- src/lib/utils/supabase/server.ts — createSupabaseServiceClient implementation
- src/lib/services/llms.ts — callLLM and env var dependencies
- src/lib/services/llmSemaphore.ts — semaphore init
- evolution/deploy/evolution-runner.service — systemd service template
- evolution/deploy/evolution-runner.timer — systemd timer
- /etc/systemd/system/evolution-runner.service — installed (outdated) service
- git show 3fa65675:evolution/scripts/evolution-runner.ts — PR #750 multi-DB implementation
- git show 3fa65675:evolution/scripts/evolution-runner.test.ts — PR #750 tests
- supabase/migrations/20260315000001_evolution_v2.sql — V2 schema + RPC
- supabase/migrations/20260320000001_rename_evolution_tables.sql — column renames
