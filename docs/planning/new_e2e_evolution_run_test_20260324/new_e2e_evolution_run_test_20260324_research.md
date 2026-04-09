# New E2E Evolution Run Test Research

## Problem Statement
Design a comprehensive E2E test that runs on both main and production PRs, testing that an evolution run can be created via experiment and successfully runs to completion using real LLM calls. The test should verify metrics computation, arena sync, and the full pipeline lifecycle. Max budget: $0.02 per run.

## Requirements (from GH Issue #813)
- E2E test that runs on both main→production merges
- Creates experiment → queues run → executes with real LLM calls → verifies completion
- Max budget: $0.02 per run
- Verifies: metrics correctly calculated, arena sync works, experiment auto-completes
- As comprehensive as possible within budget constraints

## High Level Summary

### Architecture of an E2E Evolution Run Test

The test cannot use Playwright browser interactions to trigger a run — evolution runs are executed server-side via `claimAndExecuteRun()`. The approach is:

1. **Seed test data** via direct Supabase service client (strategy, prompt, experiment, run)
2. **Trigger execution** via the `/api/evolution/run` POST endpoint (admin-only) or directly insert a pending run and call `claimAndExecuteRun()` programmatically
3. **Poll for completion** via Supabase queries on `evolution_runs.status`
4. **Assert results** via DB queries on variants, metrics, arena entries, experiment status

### Key Constraint: $0.02 Budget

With `gpt-4.1-nano` ($0.10/$0.40 per 1M tokens) as both generation and judge model:
- Seed article generation: ~$0.001
- 1 iteration × 1 strategy = 1 generated variant: ~$0.001
- Triage + ranking (2-3 comparisons): ~$0.002-0.005
- **Total: ~$0.005-0.008** — well within $0.02

Config: `iterations: 1, strategiesPerRound: 1, generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano'`

### How Runs Execute

`claimAndExecuteRun()` in `evolution/src/lib/pipeline/claimAndExecuteRun.ts`:
1. Claims via `claim_evolution_run` RPC (atomic, FIFO, SKIP LOCKED)
2. Builds context: resolves strategy config, generates seed article from prompt, loads arena entries
3. Runs `evolveArticle()` loop: generate → rank → evolve for N iterations
4. `finalizeRun()`: persists variants, computes metrics, propagates to strategy/experiment
5. `syncToArena()`: upserts winning variant with `synced_to_arena=true`

### How to Trigger from E2E

Two options:
- **Option A**: POST to `/api/evolution/run` with admin auth cookie — BUT this route may not exist (agent found no such route)
- **Option B**: Insert pending run via Supabase, then call the pipeline directly — BUT E2E tests run in browser, can't call Node functions
- **Option C (Best)**: Seed a pending run via Supabase service client in `beforeAll`, then use `page.request.post()` to hit an API route that triggers the run, or use a dedicated test API route

**Actual approach**: The existing `claimAndExecuteRun()` is a server-side function that creates its own Supabase client. For E2E, we need an API endpoint. Looking at the codebase:
- No public API route for evolution run exists
- The batch runner script (`processRunQueue.ts`) calls `claimAndExecuteRun()` directly
- The admin UI uses server actions (not API routes) to queue runs

**Recommended approach**:
1. Seed pending run via direct DB insert (like existing evolution E2E tests)
2. Call `claimAndExecuteRun()` from a **test API route** or via `fetch()` to a new lightweight endpoint
3. OR: use Playwright's `page.evaluate()` is not viable (server-side code)
4. **Best**: Create a test-only API route at `/api/test/evolution-run` that calls `claimAndExecuteRun()` — guarded by `E2E_TEST_MODE` or admin auth

Actually, looking more carefully: the test can just **directly call the Supabase RPC and the pipeline functions from the test process itself** using the Supabase service client. Playwright E2E tests run in Node.js — the test files can import and call server-side code directly, just like `beforeAll` already uses `createClient()` to seed data.

**Wait** — the test process runs in Node but `claimAndExecuteRun()` uses `createSupabaseServiceClient()` which is a Next.js server-only function. It also imports `callLLM` from the main app. This would fail in the Playwright test runner.

**Final recommended approach**:
1. Seed data (strategy + prompt + experiment + run) via Supabase service client
2. Use `page.request.post('/api/evolution/run')` to trigger execution (BUT route doesn't exist)
3. **Create a minimal test API route** or repurpose existing admin endpoints
4. **Or**: Run the pipeline via the batch runner script as a subprocess

**Simplest viable approach**:
1. Seed pending run in `beforeAll`
2. Execute `npx tsx evolution/scripts/processRunQueue.ts --max-runs=1` as a child process
3. Poll DB for completion
4. Assert all results

### CI Integration

**For main PRs**: Tests tagged `@critical` run via `npm run test:e2e:critical` (chromium-critical project)
**For production PRs**: Tests tagged `@evolution` run via `npm run test:e2e:evolution` (chromium project, `--grep=@evolution`)

This test should use `{ tag: '@evolution' }` to run on production PRs. It should NOT use `@critical` since it's expensive and slow.

**E2E_TEST_MODE**: Set in CI for the web server, but doesn't affect Supabase queries or pipeline execution. The test doesn't need to opt out of it — it's about SSE mocking for the frontend, not evolution.

**Secrets available in CI**:
- `OPENAI_API_KEY` — repository-level, available in all workflows
- `SUPABASE_SERVICE_ROLE_KEY` — environment-level (staging for main PRs, production for nightly)
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — for admin auth fixture

**Timeout**: Evolution runs with $0.02 budget and 1 iteration should complete in 30-60 seconds. CI timeout for evolution tests is 30 minutes. Test should use `test.slow()` to triple the default timeout.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — doc structure and reading order
- docs/docs_overall/architecture.md — system design, data flow, tech stack
- docs/docs_overall/project_workflow.md — project lifecycle and templates

### Relevant Docs
- docs/feature_deep_dives/testing_setup.md — four-tier testing, E2E patterns, test data factories
- docs/docs_overall/testing_overview.md — testing rules, CI workflows, tag strategy
- evolution/docs/architecture.md — V2 pipeline: claim→execute→finalize→arena
- evolution/docs/reference.md — file inventory, CLI scripts, testing infrastructure
- evolution/docs/data_model.md — all evolution tables, RPCs, RLS, lineage
- evolution/docs/strategies_and_experiments.md — strategy/experiment lifecycle, metrics
- evolution/docs/visualization.md — admin UI pages, server actions, components

## Code Files Read

### E2E Test Infrastructure
- `src/__tests__/e2e/specs/09-admin/admin-evolution-experiment-lifecycle.spec.ts` — existing experiment lifecycle test (seeds data, mocks completion)
- `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` — factory for strategies, prompts, runs, variants with FK-safe cleanup
- `src/__tests__/e2e/fixtures/admin-auth.ts` — admin auth fixture with retry logic

### Evolution Pipeline
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — full claim→execute→finalize flow, heartbeat, error handling
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — strategy config resolution, content resolution (explanation or seed), arena loading
- `evolution/src/services/evolutionActions.ts` — `queueEvolutionRunAction` server action

### Configuration
- `playwright.config.ts` — projects (chromium-critical, chromium, chromium-unauth, firefox), timeouts, webServer config
- `.github/workflows/ci.yml` — e2e-critical (main), e2e-evolution (production), e2e-non-evolution (production)
- `package.json` — npm scripts: `test:e2e:critical`, `test:e2e:evolution`, `test:e2e:non-evolution`
- `src/lib/schemas/schemas.ts` — `allowedLLMModelSchema` includes `gpt-4.1-nano` (cheapest option)

## Key Findings

1. **No HTTP API route exists for triggering evolution runs** — runs are queued via server actions and executed by batch scripts or `claimAndExecuteRun()` server-side function
2. **Existing E2E evolution tests only seed static data** — no test currently executes a real pipeline run
3. **`gpt-4.1-nano` is the cheapest model** at $0.10/$0.40 per 1M tokens — well within $0.02 budget for a 1-iteration run
4. **The test data factory already handles FK-safe cleanup** — strategies, prompts, runs, variants, experiments all tracked
5. **`@evolution` tag** is the correct tag for production PR tests — runs via `npm run test:e2e:evolution`
6. **Strategy config requires `config_hash`** — must be computed or provided when seeding directly
7. **`evolution_prompts` uses `prompt` column** (not `prompt_text`) and `title` column (confirmed in existing test)
8. **Pipeline execution takes 30-60s** for a minimal run — test needs `test.slow()` or custom timeout
9. **The test can spawn `processRunQueue.ts` as a subprocess** to execute the run — avoids importing server-only code into Playwright
10. **Arena sync happens automatically** for prompt-based runs — `syncToArena()` called in `executePipeline()`
11. **Experiment auto-completion** happens in `finalizeRun()` via `complete_experiment_if_done` RPC
12. **Metrics are persisted** to `evolution_metrics` table during finalization

## Additional Findings

13. **No API route exists for evolution runs** — confirmed by scanning `src/app/api/` (only 10 routes, none for evolution). Need to create one.
14. **`processRunQueue.ts` uses multi-DB env loading** — requires `.env.local` and `.env.evolution-prod`, too heavy for E2E subprocess approach
15. **`processRunQueue.ts` calls `executeV2Run()`** (deprecated bridge), not `claimAndExecuteRun()` — uses its own claim logic and LLM provider construction
16. **`claimAndExecuteRun()` uses `createSupabaseServiceClient()`** (Next.js server-only) and `callLLM()` (main app) — must run within Next.js server context
17. **Best approach: Create `/api/evolution/run` API route** that calls `claimAndExecuteRun()`, guarded by admin auth. This is the natural endpoint that's been missing from the codebase.

## Open Questions (Resolved)

1. **How to trigger run execution from E2E?** → Create a new API route `/api/evolution/run` that calls `claimAndExecuteRun()`. Guard with `requireAdmin()`. E2E test uses `page.request.post()` with admin auth cookie.
2. **Does CI have OPENAI_API_KEY?** → Yes, repository-level secret.
3. **Will `evolution_explanations` cause issues?** → `buildRunContext` handles seed generation automatically for prompt-based runs. No manual `evolution_explanations` insert needed.
4. **Should this test verify admin UI?** → Yes, navigate to run detail page after completion for free UI verification.
