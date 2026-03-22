# Research: Multi-Database Evolution Runner

## Problem

Evolution run `591666e6` is stuck in `pending` on staging because the batch runner (`evolution/scripts/evolution-runner.ts`) only connects to one Supabase instance. The systemd service loads `.env.evolution-prod` second, which overrides `.env.local`, so only production gets polled. Staging runs are never claimed.

## Root Cause Analysis

### How env loading works today
- `evolution-runner.service` loads two `EnvironmentFile`s in order:
  1. `/opt/explainanything/.env.local` — dev/staging Supabase URL + shared keys
  2. `/opt/explainanything/.env.evolution-prod` — prod overrides (wins for `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- The runner calls `getSupabase()` which reads `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — always a single client

### Why staging runs get stuck
- Staging runs are created via the staging admin UI, writing to the staging Supabase
- The minicomputer runner only connects to prod Supabase
- No runner ever polls staging → runs stay `pending` forever

## Key Files

| File | Role |
|------|------|
| `evolution/scripts/evolution-runner.ts` | Batch runner — claims & executes pending runs |
| `evolution/scripts/evolution-runner.test.ts` | Unit tests for runner |
| `evolution/src/lib/pipeline/runner.ts` | `executeV2Run(runId, run, db, llmProvider)` — already accepts `db` param |
| `evolution/deploy/evolution-runner.service` | Systemd unit (loads env files) |
| `evolution/docs/evolution/minicomputer_deployment.md` | Deployment docs |

## Key Findings

1. **`executeV2Run` already takes a `db: SupabaseClient` param** — no changes needed in `runner.ts`
2. **`markRunFailed` in `runner.ts` (pipeline)** already takes `db` param — only the wrapper in `evolution-runner.ts` hardcodes `getSupabase()`
3. **`claimNextRun` and `claimNextRunFallback`** both call `getSupabase()` internally — need to accept a client param
4. **`claimBatch`** calls `claimNextRun()` — needs to iterate across multiple targets
5. **The `REQUIRED_ENV_VARS` check** runs at module load and would fail if staging vars are set but prod vars are missing — need conditional validation

## Design Considerations

- **Backward compatible**: When `EVOLUTION_DB_TARGETS` is unset, behavior is identical to today
- **Naming convention**: `SUPABASE_URL_STAGING`, `SUPABASE_KEY_STAGING` etc. — simple suffix convention
- **Round-robin claiming**: Alternate between targets when claiming a batch, skip exhausted targets
- **Observability**: Include `db.name` in log context so we can tell which database a run came from
- **LLM provider is shared**: All targets use the same OpenAI key — no per-target LLM config needed
