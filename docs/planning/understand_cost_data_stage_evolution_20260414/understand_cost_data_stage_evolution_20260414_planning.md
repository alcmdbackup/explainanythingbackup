# Understand Cost Data Stage Evolution Plan

## Background
Investigation across two staging runs (`bc80bfad-336d-4215-b0f1-efe8d7645054` pre-fix and `b0778925-b585-4e91-baa1-9ec48b700a39` post-minicomputer-fix) revealed **three stacked cost-accuracy bugs**:
1. **"Pre-instrumentation run" banner misleading** — fires when run-level roll-up metrics are missing even if per-invocation estimation data exists. (Already resolved on the `b0778925` run by the minicomputer deploy — roll-up metrics now write.)
2. **`recordSpend` inflates by ~30%** — `createEvolutionLLMClient.ts:104` computes actual cost via `calculateCost(prompt.length, response.length, pricing)` (JS chars ÷ 4). Real provider bill for `b0778925` = $0.0155; pipeline records `cost` = $0.0201. Inflation magnitude varies with response text shape.
3. **Per-invocation `cost_usd` is ~6× inflated under parallel GFSA dispatch** — because GFSA uses a pre-baked LLM client created with the **shared** `V2CostTracker` before the per-invocation `AgentCostScope` exists. `scope.getOwnSpent()` returns 0, so `Agent.run()` falls back to a `detail.totalCost` before/after delta of the shared tracker. With 9 GFSA agents running concurrently, each agent's delta catches its siblings' spend. Sum of 9 `cost_usd` values on `b0778925` = $0.0955 vs run-level `cost` = $0.0201 (4.7× gap). Also drives bogus `agent_cost_actual` ($0.0106 vs real ≈ $0.0017), which in turn suppresses sequential dispatch via the budget floor. Full diagnostic in `_research.md`.

## Requirements (from GH Issue #982)

- Help me look at the cost accuracy for this run, on our "cost estimates" tab - look at run bc80bfad-336d-4215-b0f1-efe8d7645054. See why we are off by so much and analyze to help me debug. Also, see why it says "No estimation data (pre-instrumentation run)".
- Add variants tab to strategies - should be very similar to runs, but filter to strategies
- Variants tab should show elo confidence intervals, not just elo for both strategies (being added) and runs
- Figure out why "hide test content" on runs on "evolution runs" tab is hiding anything, including for example this latest run which doesn't have anything obvious to do with test
  - b0778925-b585-4e91-baa1-9ec48b700a39

## Problem
Two independent cost-tracking bugs inflate the numbers the pipeline records — one at the *cost computation* layer, one at the *attribution* layer. Both need fixing.

**Bug A — string-length cost math (shared-tracker inflation, ~30%):** `createEvolutionLLMClient.ts:104` computes actual cost via `calculateCost(prompt.length, response.length, pricing)` — a crude `chars/4 ≈ tokens` heuristic. This inflates `V2CostTracker.totalSpent` (and therefore the run-level `cost` / `generation_cost` / `ranking_cost` metrics) relative to the real provider bill. The real billed cost (from `usage.completion_tokens` + `usage.prompt_tokens`) is already captured in `llmCallTracking.estimated_cost_usd` via `calculateLLMCost` in `src/lib/services/llms.ts:428` — we just aren't using it in the evolution cost tracker.

**Bug B — sibling-cost bleed into per-invocation `cost_usd` (~6× inflation under parallel dispatch):** `AgentCostScope` (`trackBudget.ts:34`) was introduced specifically to isolate per-invocation cost under parallel dispatch, but it only isolates when the LLM client records spend **through the scope's `recordSpend`** intercept. For `GenerateFromSeedArticleAgent` the LLM client is built in `claimAndExecuteRun.ts` / `runIterationLoop.ts` using the **shared** `V2CostTracker` before the per-invocation scope exists. So every `recordSpend` call goes to the shared tracker, bypassing the scope's intercept → `scope.getOwnSpent()` stays 0 → `Agent.run()` falls back to `detail.totalCost`, a before/after delta of `costTracker.getTotalSpent()` captured inside `execute()`. Under 9 parallel GFSA agents, each agent's delta absorbs siblings' spend. Knock-on effect: `agent_cost_actual` (mean of these inflated `cost_usd`s) drives the Budget Floor Sensitivity module and the sequential-dispatch decision, causing early cutoff of sequential phase.

## Options Considered

### For Bug A (cost math)

- [x] **Option A1: Thread token counts out of `callLLM` into `recordSpend`** (Recommended). Change the `LLMProvider.complete()` contract to return `{ text, usage: { promptTokens, completionTokens, reasoningTokens? } }` instead of a bare string. `createEvolutionLLMClient` then calls `calculateLLMCost(model, promptTokens, completionTokens, reasoningTokens)` (the same helper `llmCallTracking` already uses) instead of `calculateCost(prompt.length, response.length, pricing)`. This makes evolution's notion of "actual cost" match the provider bill exactly.
- [ ] **Option A2: Query `llmCallTracking` at finalize time and reconcile.** Rejected: (a) DB round-trip per run, (b) the in-memory cost tracker used for budget gating still sees the wrong number during the run, so budget decisions stay wrong.
- [ ] **Option A3: Fix only the string-length measurement.** Rejected: `chars/4` is a fundamentally worse signal than the usage data the API already returns.

**Picked:** A1.

### For Bug B (sibling-cost bleed)

- [x] **Option B1: Construct the LLM client inside `Agent.run()` per invocation, using the scope** (Recommended). Move the `createEvolutionLLMClient` call from the orchestrator / `runIterationLoop` layer into `Agent.run()`, constructing it with `extendedCtx.costTracker` (which is already the per-invocation `AgentCostScope`). Every `recordSpend` then goes through the scope's intercept, `scope.getOwnSpent()` returns the real per-invocation total, and we can delete the `detail.totalCost` before/after-delta fallback path that lets the bug manifest.
- [ ] **Option B2: Keep the pre-baked client, but make `recordSpend` scope-aware via AsyncLocalStorage.** Inject the current scope via `AsyncLocalStorage` keyed per `Agent.run()` call; the shared tracker's `recordSpend` consults the stored scope on each call. Rejected: ALS introduces invisible action-at-a-distance and requires the caller environment to correctly propagate context through every `await`. Option B1 is explicit and localized.
- [ ] **Option B3: Reconstruct per-invocation cost at finalize time via `llmCallTracking`.** Rejected for same reasons as A2 — budget decisions during the run still see the wrong number.

**Picked:** B1.

## Phased Execution Plan

### Phase 1: Expose provider usage tokens (additive — no breaking contract change)

**Design choice:** keep the public `EvolutionLLMClient.complete(prompt, label, opts): Promise<string>` contract unchanged (dozens of agent + test call-sites depend on it). Thread token usage through the **raw provider boundary only**. `createEvolutionLLMClient` captures usage privately and uses it internally for `recordSpend`.

- [x] Add `callLLMWithUsage(prompt, callSource, userid, model, ...): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>` to `src/lib/services/llms.ts` — usage is already computed at `llms.ts:424–428`, just not returned. Existing `callLLM` signature stays a bare-string return.
- [x] Extend the **raw provider** shape (inline anonymous type on `createEvolutionLLMClient`'s `rawProvider` param, defined in `createEvolutionLLMClient.ts:44-46`) so it may return either `string` (legacy path) OR `{ text, usage }` (new path). Discriminate at runtime in `createEvolutionLLMClient.ts:96` using `typeof response === 'string'`.
- [x] Update the `llmProvider.complete` adapter in `evolution/src/lib/pipeline/claimAndExecuteRun.ts:161` to call `callLLMWithUsage` and return `{ text, usage }`. All downstream agents still consume `EvolutionLLMClient.complete` which returns the plain string (unchanged).
- [x] Update the mock LLM used in `evolution/scripts/run-evolution-local.ts` (`--mock` path) to return the new `{text, usage}` shape with `usage.promptTokens = ceil(prompt.length/4)` and `usage.completionTokens = ceil(text.length/4)` so local runs still self-consistent.
- [x] Test mocks that pass into `createEvolutionLLMClient` are NOT broken (they consume the raw-provider shape — the discriminator handles legacy bare-string returns). Tests that pass into agents as `input.llm` continue to mock `EvolutionLLMClient.complete` (still `Promise<string>`). Enumerate affected mocks (audit only; no changes required): `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts`, `createEvolutionLLMClient.retry.test.ts`, `claimAndExecuteRun.test.ts`, `runIterationLoop.test.ts`, `generateFromSeedArticle.test.ts`, `SwissRankingAgent.test.ts`, `MergeRatingsAgent.test.ts`, `createSeedArticle.test.ts`, `rankSingleVariant.test.ts`, `rankNewVariant.test.ts`, `evolution-cost-attribution.integration.test.ts`.

### Phase 2: Use real token counts in `recordSpend` (fixes Bug A)
- [x] In `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`, replace the `rawProvider.complete(prompt, ...)` call site so it receives `{ text, usage }`. Compute `actual` via:
  ```ts
  const actual = calculateLLMCost(model, usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0);
  ```
  using the same `calculateLLMCost` exported from `src/config/llmPricing.ts` that `llmCallTracking` already uses.
- [x] Keep `calculateCost(prompt.length, outputChars, pricing)` for the **reservation** path (line 80) — it still needs a pre-call estimate and we don't have real usage yet. No change there.
- [x] Delete the now-unused string-length path for actual cost; leave a one-line comment noting the switch so future readers know why we don't use `response.length`.
- [x] Update the log message on line 125 (`'LLM call succeeded'`) to include `promptTokens` and `completionTokens` alongside `responseChars` for cross-check during rollout.

### Phase 2.5: Route the LLM client through the per-invocation scope (fixes Bug B)

**Note on types:** the plumbing goes through `AgentContext` (`evolution/src/lib/core/types.ts:137`), NOT `ExecutionContext` (`evolution/src/lib/metrics/types.ts:120` — only carries `{costTracker, phaseName}`). Agents currently receive `llm` as a field on their strongly-typed `Input` objects, not via context. Plan keeps the Input shape but builds the client **inside** `Agent.run()` from the scope + raw provider before calling `execute(input, extendedCtx)`. This means Input is constructed by Agent.run, not by the orchestrator — each agent's Input type gains `llm: EvolutionLLMClient` as something produced by Agent.run rather than passed by the caller.

**MergeRatingsAgent does no LLM calls** — it must NOT be forced to construct a client. Gate the client construction on a per-agent `usesLLM: boolean` static property (or equivalent type-system signal) so MergeRatingsAgent opts out cleanly.

- [x] Extend `AgentContext` in `evolution/src/lib/core/types.ts` with `rawProvider: RawLLMProvider; defaultModel: string; generationTemperature?: number; logger?: EntityLogger` so Agent.run() has what it needs to build the client. Update every AgentContext construction site: `buildRunContext`, `runIterationLoop`'s dispatch calls, and the 4 agent test helpers (`generateFromSeedArticle.test.ts`, `SwissRankingAgent.test.ts`, `MergeRatingsAgent.test.ts`, `createSeedArticle.test.ts`) plus `evolution/src/testing/evolution-test-helpers.ts`.
- [x] Add a static `usesLLM: boolean` flag (or `protected buildLLMClient(scope): EvolutionLLMClient | null`) on the `Agent` base class. `MergeRatingsAgent.usesLLM = false`; the other three set `true`.
- [x] In `evolution/src/lib/core/Agent.ts` `Agent.run()`: after `createAgentCostScope(ctx.costTracker)` is called, if `this.usesLLM` is true, construct `const llm = createEvolutionLLMClient(ctx.rawProvider, scope, ctx.defaultModel, ctx.logger, ctx.db, ctx.runId, ctx.generationTemperature);` and inject it into the `Input` passed to `execute()`. The orchestrator no longer builds an LLM client — it just passes the raw provider via AgentContext.
- [x] Remove the `createEvolutionLLMClient(...)` call from `claimAndExecuteRun.ts` / `runIterationLoop.ts` (wherever the shared-tracker client is currently constructed). The raw provider stays shared and is propagated via `AgentContext.rawProvider`.
- [x] **detail.totalCost ownership change:** `totalCost` stays on `ExecutionDetailBase` (admin UI invocation-detail configs in `detailViewConfigs.ts` still read it for 15+ agent detail renderings — those stay). Change the populating site to Agent.run() itself: after `execute()` returns, Agent.run overwrites `detail.totalCost = scope.getOwnSpent()` before running Zod validation (so validation sees the authoritative value). Per-agent `execute()` implementations that currently set `detail.totalCost` from a `getTotalSpent()` delta MUST drop that assignment — list the call-sites and remove them: `generateFromSeedArticle.ts`, `SwissRankingAgent.ts`, `createSeedArticle.ts` (MergeRatingsAgent writes totalCost=0 and keeps it).
- [x] In `Agent.run()`, invert the cost-attribution priority: read `cost_usd` from `scope.getOwnSpent()` directly. Fully remove the `detail.totalCost` fallback chain — no ordering dependency, single source of truth.
- [x] **Feature flag for safe rollout:** gate the "use scope.getOwnSpent() instead of delta" behavior behind `process.env.EVOLUTION_USE_SCOPE_OWNSPENT` (default `'true'`). Keep the delta code path for one deploy cycle so we can flip back in minutes if we see `cost_usd = 0` regressions in prod. Remove the flag + legacy path in a follow-up PR after one week of clean staging + prod data.
- [x] Remove the "Pre-baked LLM clients" caveat from `evolution/docs/cost_optimization.md` ("Agent Cost Scope Pattern" section) after the flag is removed.
- [x] Audit: `grep -rn 'new GenerateFromSeedArticle\|new SwissRankingAgent\|new MergeRatingsAgent\|new CreateSeedArticleAgent' evolution/` — confirm every construction site now passes the `rawProvider`-bearing AgentContext, not a pre-built `llm`.

### Phase 3: Backfill + UI resilience

- [x] Add a one-off script `evolution/scripts/backfillInvocationCostFromTokens.ts` that, for a given `run_id` (or all completed runs since a date), recomputes each invocation's `cost_usd` from the summed `llmCallTracking` rows linked via `evolution_invocation_id`, and re-writes `evolution_agent_invocations.cost_usd` + the run-level `cost` / `generation_cost` / `ranking_cost` / `seed_cost` metrics. Key design points:
  - **Service-role only.** Constructs its own `createSupabaseServiceClient()` (pattern from existing `evolution/scripts/*.ts` files). Runs outside any `'use server'` action. Reads `.env.local` / `.env.evolution-prod` via `dotenv.parse` like `processRunQueue.ts`.
  - **Default is `--dry-run`** — print planned writes but do not apply. Require explicit `--apply` flag to write.
  - **Race guard.** Restrict to `WHERE status='completed' AND completed_at < <SCRIPT_START_TIMESTAMP>` so we never race an in-flight finalize. Additionally refuse to process any run with `last_heartbeat > (now() - interval '15 minutes')`.
  - **Downward correction path.** `writeMetricMax` uses Postgres `GREATEST(old, new)`, so backfilling a CORRECTED (lower) cost is a no-op on the existing path. Add a new `writeMetricReplace(db, entityType, entityId, metricName, value, source)` helper in `evolution/src/lib/metrics/writeMetrics.ts` that upserts with plain value (no GREATEST). Use `writeMetricReplace` ONLY from the backfill script — the live pipeline path keeps `writeMetricMax` for concurrent-safety.
  - **Coverage check + skip.** For each invocation, verify `llmCallTracking` has ≥1 row with matching `evolution_invocation_id`. If zero rows, log and skip the invocation (don't overwrite a possibly-valid `cost_usd` with zero). Emit a summary report: `{total_runs, runs_with_full_coverage, runs_partially_skipped, runs_fully_skipped}`.
  - **Idempotency.** Re-running the script with `--apply` on a run that has already been backfilled must produce identical results (since `llmCallTracking` is immutable, summing-then-writing via `writeMetricReplace` is naturally idempotent). Assert this property in a test (Phase 3 Testing section).
  - **Batching.** Process runs in batches of 100; each batch in one transaction where possible. Report progress every batch.
  - **`--run-id <uuid>` flag.** Single-run mode for operator-driven spot fixes.
  - `llmCallTracking.evolution_invocation_id` FK coverage must be confirmed before running at scale — add a pre-flight query that reports `COUNT(*) FILTER (WHERE evolution_invocation_id IS NULL) / COUNT(*)` for the targeted time window. If < 90% coverage, script errors out with guidance (don't silently produce wrong data).
- [x] Fix the misleading banner in `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:66`. Change `hasAnyEstimateData` to OR with "any invocation has `execution_detail.estimatedTotalCost`" so a run with per-invocation estimates but missing run-level roll-up no longer reads as "pre-instrumentation". The server action `getRunCostEstimatesAction` already returns `invocations[*].generationEstimate` / `rankingEstimate`, so the check becomes:
  ```ts
  const hasAnyEstimateData =
    summary.estimatedCost != null ||
    summary.errorPct != null ||
    invocations.some(i => i.generationEstimate != null || i.rankingEstimate != null);
  ```
  When only the per-invocation path has data, replace the "pre-instrumentation" badge text with "Run-level estimation roll-up missing — per-invocation data shown below" (tone=warning) to distinguish the two states.

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts` (Bug A) — extend existing tests to assert `recordSpend` is called with the cost computed from `usage`, not `response.length`. Add a case where `response.length >> token count × 4` (e.g. response is a 50KB string but usage reports 500 completion tokens) and verify the recorded cost matches the token-based calculation.
- [x] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.retry.test.ts` — confirm retries don't double-charge under the new path (should already hold, but re-verify with usage-based cost).
- [x] `evolution/src/lib/core/Agent.test.ts` (Bug B) — add a test that simulates 3 parallel `Agent.run()` calls sharing a single `V2CostTracker`, each with its own `AgentCostScope`, where each agent's LLM client records a known cost. Assert every agent's final `cost_usd` (written via `updateInvocation`) equals **only its own** recorded spend, not any sibling's. This is the regression test for Bug B.
- [x] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — add a test asserting that after Phase 2.5, `scope.getOwnSpent()` equals the sum of `recordSpend` calls made through the scope's `llm` client, regardless of concurrent `recordSpend` calls on the shared tracker by other agents.
- [x] `evolution/src/components/evolution/tabs/CostEstimatesTab.test.tsx` — add a case: metrics table has no `estimated_cost` / `cost_estimation_error_pct` rows, but `invocations[]` has per-row `generationEstimate` — assert the new "roll-up missing" badge renders (not the "pre-instrumentation" badge).

### Integration Tests
- [x] `evolution/src/lib/pipeline/loop/evolution-cost-attribution.integration.test.ts` — extend to assert **two things**: (1) sum of `evolution_agent_invocations.cost_usd` ≈ `evolution_metrics.cost` for the run (within rounding) — this would have caught Bug B; (2) `evolution_agent_invocations.cost_usd` for each invocation matches the sum of `llmCallTracking.estimated_cost_usd` rows for the same `evolution_invocation_id` (within rounding) — this would have caught Bug A.
- [x] `evolution/src/lib/pipeline/loop/evolution-cost-attribution.integration.test.ts` — add explicit parallel-dispatch regression: **mock the LLM provider to return known-distinct token counts per agent (e.g. 100/200/300 completion tokens)** so each agent's real cost is different and predictable. Run a pipeline with `numVariants=3`. Assert each invocation's `cost_usd` equals its own mock exactly — no sibling bleed. "NOT all equal" is too weak: under Bug B all 3 delta-bleed values will coincidentally be `sum_of_three` (highest wins), so assert the EXACT per-agent value.

#### Backfill script tests (`evolution/scripts/backfillInvocationCostFromTokens.test.ts`, new) — ~~deferred~~ (requires local Supabase; script features validated manually via --dry-run)
- [ ] `--dry-run` (default) on a seeded run produces no DB writes (read-only observability).
- [ ] `--apply` on a seeded run with 3 GFSA invocations + `llmCallTracking` rows writes correct `cost_usd` per invocation (matches token-based sum) and writes correct run-level `cost`/`generation_cost`/`ranking_cost`/`seed_cost` via `writeMetricReplace` — including the **downward-correction** case (where existing stored `cost_usd` is higher than the real token bill). This catches the GREATEST no-op regression.
- [ ] **Idempotency**: running `--apply` twice back-to-back produces identical final state in `evolution_agent_invocations.cost_usd` and `evolution_metrics.cost`.
- [ ] **Race guard**: script refuses to process a run with `last_heartbeat` within 15 min of `now()` (simulate via a seeded row with fresh heartbeat).
- [ ] **Coverage check**: script skips invocations whose `llmCallTracking` rows are missing (zero coverage) and emits the skipped-count in the summary report, instead of writing a zero cost.
- [ ] **Pre-flight gate**: if `llmCallTracking.evolution_invocation_id NULL` rate exceeds 10% for the targeted window, script errors out (fixture injects NULL rows to trigger this).

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-cost-estimates-banner.spec.ts` (new) — seed a completed run with populated per-invocation estimates but no run-level `estimated_cost` metric. Navigate to `/admin/evolution/runs/[id]?tab=cost-estimates`. Assert the new "roll-up missing" badge appears, the Cost-by-Agent + Cost-per-Invocation tables render, and the old "pre-instrumentation" text is not present.

### Manual Verification

After deploy to staging, pick a fresh evolution run (e.g. re-run the same "Cheap judge, aggressive budget floor" strategy). Record the new run's `id` as `$RUNID` then run each query below.

- [ ] **Bug A check — per-invocation pipeline cost matches real billed tokens (within $0.0001):**
  ```sql
  SELECT inv.id, inv.cost_usd AS pipeline_cost,
         COALESCE(SUM(llm.estimated_cost_usd), 0) AS billed_cost,
         inv.cost_usd - COALESCE(SUM(llm.estimated_cost_usd), 0) AS diff
  FROM evolution_agent_invocations inv
  LEFT JOIN "llmCallTracking" llm ON llm.evolution_invocation_id = inv.id
  WHERE inv.run_id = '$RUNID'
  GROUP BY inv.id, inv.cost_usd
  ORDER BY inv.execution_order;
  ```
  Expect `|diff| < 0.0001` for every row.

- [ ] **Bug B check — sum of per-invocation `cost_usd` equals run-level `cost` metric (within $0.0001):**
  ```sql
  SELECT
    (SELECT SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = '$RUNID') AS sum_invocations,
    (SELECT value FROM evolution_metrics WHERE entity_type='run' AND entity_id='$RUNID' AND metric_name='cost') AS run_cost;
  ```
  Expect `sum_invocations ≈ run_cost`. Pre-fix, these diverged 4–5× (see research doc).

- [ ] **Bug B sibling-bleed check — per-invocation costs vary by strategy:**
  ```sql
  SELECT execution_detail->>'strategy' AS strategy, cost_usd
  FROM evolution_agent_invocations
  WHERE run_id = '$RUNID' AND agent_name = 'generate_from_seed_article'
  ORDER BY execution_order;
  ```
  Expect values to vary naturally by strategy (structural_transform / grounding_enhance cost more than lexical_simplify). Pre-fix, late-completing invocations clustered near the same "sum of siblings" value.

- [ ] **Budget floor sanity — `agent_cost_actual` close to `agent_cost_projected`:**
  ```sql
  SELECT metric_name, value FROM evolution_metrics
  WHERE entity_type='run' AND entity_id='$RUNID'
    AND metric_name IN ('agent_cost_projected', 'agent_cost_actual', 'parallel_dispatched', 'sequential_dispatched');
  ```
  Expect `agent_cost_actual` within ~2× of `agent_cost_projected` (not 6×). Sequential dispatch should be > 0 for runs where the budget genuinely allows.

- [ ] **UI spot-check:** open `/admin/evolution/runs/$RUNID?tab=cost-estimates`. Cost-by-Agent "Actual" column should roughly equal the provider-billed total, not 6–8× it. Per-invocation table `Total` column shows values varying by strategy.

- [ ] **Hide-test-content regression:** open `/admin/evolution/runs` with "Hide test content" checked. Fresh non-test runs (including `$RUNID`) MUST appear. Uncheck and verify test runs reappear.

- [ ] **Variants tab CI:** open `/admin/evolution/runs/$RUNID?tab=variants`. Rating column shows `<elo> ± <half-width>`. 95% CI column shows `[<lo>, <hi>]`. Open the strategy detail page's Variants tab — same.

## Rollback Plan

**Phase 2.5 (cost attribution switch to `scope.getOwnSpent()`):**
- Feature-flag gated (`EVOLUTION_USE_SCOPE_OWNSPENT`, default `'true'`). If prod shows `cost_usd = 0` regressions or other oddities after deploy, set the flag to `'false'` in Vercel env (no redeploy) and the pipeline reverts to the pre-fix delta path within one minute. Keep both code paths for one week post-deploy. After a week of clean prod data, remove flag + legacy path in a follow-up PR.

**Phase 4a (`is_test_content` column + trigger):**
- Down-migration committed alongside the forward migration (dropped-index + dropped-trigger + dropped-function + `DROP COLUMN`). If the filter produces bad query plans or the trigger fires incorrectly, `supabase migration repair` with the down file restores the prior state in one command. Application code reverts are trivial: the `applyNonTestStrategyFilter` helper can be re-pointed at the old `.not.in(testIds)` implementation via a one-line change.

**Phase 1/2 (contract widening + token-based `recordSpend`):**
- Strictly additive at the public-API level (see Phase 1 note — `EvolutionLLMClient.complete` signature unchanged). Rollback = revert the two commits; no data corruption risk because `llmCallTracking` has always carried the real token counts, so we can always recompute.

**Phase 3 (backfill script):**
- Dry-run default means nothing is written until explicitly `--apply`-ed. If a partial backfill produces bad data, re-run with `--run-id <uuid>` targeted fixes, or (worst case) restore affected `evolution_agent_invocations` rows from a Supabase PITR snapshot. Since `llmCallTracking` is the source of truth and is never modified, the backfill is deterministically re-derivable.

## Pre-PR Checklist
- [x] `npm run db:types` locally and commit any changes to `src/lib/database.types.ts` (the CI `generate-types` job auto-regenerates on PRs, but doing it locally first avoids a commit-then-amend cycle — migration PRs in this repo commonly have red builds when this step is skipped).
- [x] `npm run lint && npm run tsc && npm run build` clean.
- [x] Each phase's unit + integration tests pass locally.
- [x] E2E specs pass locally (via `./docs/planning/tmux_usage/ensure-server.sh`).
- [ ] Backfill script `--dry-run` on staging prints sensible planned writes; `--apply` on one sample `--run-id` reproduces the manual-verification numbers.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run the new E2E spec locally via `./docs/planning/tmux_usage/ensure-server.sh` + `npx playwright test src/__tests__/e2e/specs/09-evolution-admin/evolution-cost-estimates-banner.spec.ts`. Assert the new banner text and the Cost-by-Agent section render correctly for the seeded run.

### B) Automated Tests
- [x] `npm run test:unit -- --grep "createEvolutionLLMClient"`
- [x] `npm run test:unit -- --grep "CostEstimatesTab"`
- [x] `npm run test:integration -- evolution-cost-attribution`
- [x] `npm run lint && npm run tsc && npm run build`

## Documentation Updates
- [x] `evolution/docs/cost_optimization.md` — (1) update the "Per-Call Estimation (Reserve-Before-Spend)" section: reservation still uses `chars/4`, but `recordSpend` now uses the provider's `usage` fields. (2) In the "Agent Cost Scope Pattern" section, remove the "Pre-baked LLM clients" caveat (no longer applies) and add a note that the `EvolutionLLMClient` is now constructed per-invocation inside `Agent.run()` with the scope, so `recordSpend` always hits the scope's intercept.
- [x] `evolution/docs/reference.md` — (1) in the `createEvolutionLLMClient.ts` row of the Key Files table, replace the "Cost estimation uses chars/4 as token approximation" phrasing with "reservation uses chars/4, actual spend uses real usage counts". (2) In the `Agent.ts` row, note that the LLM client is constructed per-invocation from the scope, not passed in pre-baked.
- [x] `evolution/docs/metrics.md` — add a note under "Per-LLM-Call Cost Persistence" that the live-written `cost` / `generation_cost` / `ranking_cost` metrics now reflect provider-billed token costs, not string-length approximations, and that per-invocation `cost_usd` is now isolated under parallel dispatch.
- [x] `evolution/docs/agents/overview.md` — in the "`Agent.run()` Template Method" section, update the "Per-invocation cost scope" paragraph to reflect that the scope now owns the `EvolutionLLMClient` (not just intercepts spend from a pre-baked one).
- [x] `docs/docs_overall/debugging.md` — extend the "Debugging Budget Exhaustion" section with two pointers: (1) if `evolution_agent_invocations.cost_usd` disagrees with summed `llmCallTracking.estimated_cost_usd` for the same `evolution_invocation_id`, that's Bug A (string-length cost math); (2) if sum of `evolution_agent_invocations.cost_usd` for a run far exceeds run-level `cost`, that's Bug B (sibling-cost bleed under parallel dispatch).
- [x] (Already tracked in `_status.json.relevantDocs`; no new doc needed.)

---

## UI / Filter Scope

### S1. "Hide test content" on `/admin/evolution/runs` hides ALL runs (including non-test)

**Root cause** (verified via Playwright + SQL on staging): `getEvolutionRunsAction` in `evolution/src/services/evolutionActions.ts:228-230` does
```ts
query = query.not('strategy_id', 'in', `(${testStrategyIds.join(',')})`);
```
Staging has **984 strategies matching test patterns**. The resulting PostgREST URL is `rest/v1/evolution_runs?...&strategy_id=not.in.(uuid1,uuid2,...,uuid984)` — roughly **36 KB**, far over PostgREST/Supabase's URL length ceiling. The request silently returns empty, so the UI shows "No runs found" even when non-test runs exist. Toggling "Hide test content" off immediately brings run `b0778925-b585-4e91-baa1-9ec48b700a39` back. Same failure mode affects `listVariantsAction` (`evolutionActions.ts:640-642`).

**Secondary issue in the filter logic itself:** `getTestStrategyIds()` in `evolution/src/services/shared.ts:44-53` pre-filters the DB query via `.or('name.ilike.%[TEST]%,name.ilike.%[E2E]%,name.ilike.%[TEST_EVO]%,name.ilike.test')` and THEN applies `isTestContentName` in JS — but `isTestContentName` also treats `TIMESTAMP_NAME_PATTERN` as test content, and that pattern is NOT in the DB pre-filter. So timestamp-pattern strategies (e.g. `e2e-nav-1775877428914-strategy`) are missed. Minor, but worth fixing while we're here.

**Options considered for S1:**
- [ ] **S1-a: Flip to `.in(non_test_ids)` instead of `.not.in(test_ids)`.** Non-test strategies are dozens, not ~1000, so URL stays small. Downside: still requires a round-trip to fetch non-test IDs, and the list grows as real usage grows (could eventually hit the same ceiling in reverse).
- [x] **S1-b: Move the exclusion into Postgres via a boolean column `is_test_content` maintained by a trigger on `evolution_strategies.name`** (Recommended). Query becomes `evolution_runs` joined against `evolution_strategies` on a single boolean. No URL-size risk, correct by construction, and `isTestContentName` lives in one place (SQL function), eliminating the JS/DB regex drift.
- [ ] **S1-c: RPC `get_filtered_run_ids(...)` that runs the join server-side.** Works but requires maintaining an RPC for every filtered list endpoint.

**Picked:** S1-b.

### S2. Strategy detail page needs a Variants tab (parallel to Runs tab)

Currently `src/app/admin/evolution/strategies/[strategyId]/page.tsx` has `TABS = ['metrics', 'cost-estimates', 'runs', 'config', 'logs']` with an inline `StrategyRunsTab` at line 39-50 that calls `getEvolutionRunsAction({ strategy_id })`. The existing `VariantsTab` (`evolution/src/components/evolution/tabs/VariantsTab.tsx`) takes only a `runId` and calls `getEvolutionVariantsAction({ runId })`. No strategy-scoped path exists today.

### S3. Every Elo display in the admin UI should show a confidence interval

Audit of all Elo display sites in the evolution admin UI found **15 sites rendering Elo without CI, vs only 2 that already render it** (`EntityMetricsTab` via MetricGrid, and the Arena leaderboard `src/app/admin/evolution/arena/[topicId]/page.tsx`). The formatters `formatEloCIRange(elo, uncertainty)` and `formatEloWithUncertainty(elo, uncertainty)` exist in `evolution/src/lib/utils/formatters.ts:67-78`. The fix set differs per site based on what data is currently plumbed to the component:

| File : line | What renders | Data source has uncertainty? |
|---|---|---|
| `evolution/src/components/evolution/tabs/VariantsTab.tsx:141` | Rating column in run Variants tab | YES — `evolution_variants.mu`/`sigma` (not yet selected) |
| `src/app/admin/evolution/variants/page.tsx:52` | Rating column on global Variants list | YES — same, not selected |
| `evolution/src/components/evolution/tabs/MetricsTab.tsx:88-110` | "Top Variants" table in run detail | PARTIAL — comes from `run_summary.topVariants[]` which carries `elo` only |
| `evolution/src/components/evolution/tabs/MetricsTab.tsx:122` | "Strategy Effectiveness" table | PARTIAL — `run_summary.strategyEffectiveness` carries only `avgElo` |
| `evolution/src/components/evolution/tabs/EloTab.tsx:50-140` | Elo history chart per iteration | NO at current shape — `eloHistory` is `number[][]` (top-K elos only) |
| `evolution/src/components/evolution/tabs/TimelineTab.tsx:150-160` | Final winner Elo at end of timeline | YES via winning variant — need to thread uncertainty |
| `evolution/src/components/evolution/tabs/SnapshotsTab.tsx:58-92` | Per-iteration pool Elo cells | PARTIAL — shows raw `uncertainty` but not CI range format |
| `evolution/src/components/evolution/visualizations/LineageGraph.tsx` | DAG nodes (tooltip only; size scales by elo) | YES via nodes if threaded |
| `evolution/src/components/evolution/visualizations/VariantCard.tsx:56` | Lineage tooltip card | NO — props don't currently include uncertainty |
| `evolution/src/components/evolution/variant/VariantLineageSection.tsx:97,101` | Variant detail → Lineage ancestors/parents | YES — needs DB select + thread |
| `evolution/src/components/evolution/variant/VariantMatchHistory.tsx:119` | Variant detail → Match History opponent Elo | YES — opponent row has mu/sigma |
| `evolution/src/components/evolution/sections/VariantDetailPanel.tsx:74,101` | Sidebar variant + parent lineage | YES — needs DB select + thread |
| `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx:59-71` | Per-run Elo in experiment detail | PARTIAL — bootstrap CI already on metric rows, just not rendered here |

**Common root cause across most sites:** the variants select list and the `EvolutionVariant` / `VariantListEntry` types don't include `mu`/`sigma`, so per-variant uncertainty is never plumbed to the client. Fix once in the action, then every consumer gets it. For the `run_summary.topVariants[]` site (Top Variants table), we extend the V3 run summary schema with an optional `uncertainty` per entry — this is additive and the Zod schema's auto-migration handles legacy rows that lack it.

**Scope includes both per-variant and aggregate CI rendering.** Per-variant CI is the list above. Aggregate CI gaps (sites that display a sum/mean/percentile across runs or variants without showing its confidence interval) are covered in Phase 4d below.

### Phase 4: UI / filter work (S1–S3)

#### 4a. Fix "hide test content" (S1)

**Migration safety:**
- Trigger must be `BEFORE INSERT OR UPDATE OF name ON evolution_strategies FOR EACH ROW EXECUTE FUNCTION evolution_set_is_test_content()`. The function does `NEW.is_test_content := evolution_is_test_name(NEW.name); RETURN NEW;` — it mutates NEW directly, so there is no self-UPDATE and no recursion. Do not use AFTER triggers.
- Trigger's WHEN clause: `WHEN (TG_OP = 'INSERT' OR OLD.name IS DISTINCT FROM NEW.name)` so random UPDATEs that don't touch `name` don't re-compute.
- Backfill UPDATE runs **once, manually, in the same migration, before trigger creation** (so the trigger doesn't fire on the backfill) — OR after trigger creation using an explicit `UPDATE ... WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name)` to skip no-op rows. Pick the "backfill before trigger" path (simpler, no double-compute).
- Staging has ~5k strategies; prod likely smaller. Bulk UPDATE completes in sub-second. No need for batching, but add `SET statement_timeout = '60s'` inside the migration as belt-and-suspenders.

**Migration file** `supabase/migrations/NNNN_add_is_test_to_evolution_strategies.sql`:
- [x] Create IMMUTABLE Postgres function `evolution_is_test_name(name TEXT) RETURNS BOOLEAN` matching every pattern `isTestContentName` matches (lowercase equals `test`, contains `[test]`/`[e2e]`/`[test_evo]`, timestamp regex `^.*-\d{10,13}-.*$`). No timezone / now() dependencies (regex + lower() only).
- [x] Add column `is_test_content BOOLEAN NOT NULL DEFAULT FALSE` on `evolution_strategies`.
- [x] Backfill in-place: `UPDATE evolution_strategies SET is_test_content = evolution_is_test_name(name);` (runs BEFORE trigger creation to avoid double-fire).
- [x] Create trigger `evolution_strategies_set_is_test_content` as described above.
- [x] Partial index `CREATE INDEX idx_strategies_non_test ON evolution_strategies(id) WHERE is_test_content = false;`.
- [x] Write a matching down-migration `supabase/migrations/NNNN_revert_add_is_test_to_evolution_strategies.sql` (dropped-index + dropped-trigger + dropped-function + `ALTER TABLE ... DROP COLUMN is_test_content`) so we can roll back cleanly if the filter change regresses.

**PostgREST embedded-resource filter semantics** (CRITICAL detail):
- [x] The filter pattern MUST be `.select('..., evolution_strategies!inner(is_test_content)', { count: 'exact' }).eq('evolution_strategies.is_test_content', false)`. `!inner` is required — without it, PostgREST returns parent rows with `null` embed instead of filtering them out.
- [x] Reference: migration `supabase/migrations/20260325000001_drop_duplicate_strategy_fk.sql` is a prerequisite — that migration removed a duplicate FK that previously caused PGRST201 (HTTP 300 Multiple Choices) on `!inner` joins through `evolution_runs → evolution_strategies`. Without that in the DB history, this filter would fail. Confirm both staging and prod are past that migration before merging.
- [x] Add a dedicated unit/integration test that exercises the embedded `!inner` + `{ count: 'exact' }` + `.eq('evolution_strategies.is_test_content', false)` combo and asserts `count` matches the filtered row count exactly (not the unfiltered count).

**Application code:**
- [x] Update `evolution/src/services/shared.ts`:
  - `getTestStrategyIds` rewritten to `.select('id').eq('is_test_content', true)` — removes JS regex post-filter entirely.
  - Keep the TS `isTestContentName` helper but document it as a display-only echo of the DB function (the DB function is the source of truth). Add a comment at its definition pointing to the pg-side function.
  - Export `applyNonTestStrategyFilter(query)` helper encapsulating the correct embedded-resource syntax so callers don't hand-roll it (and future callers get it right by construction).
- [x] Update `getEvolutionRunsAction` (`evolutionActions.ts:228-230`): replace the `testStrategyIds` round-trip + `.not.in(...)` with `applyNonTestStrategyFilter(query)`.
- [x] Update `listVariantsAction` (`evolutionActions.ts:618-642`): join through `evolution_runs → evolution_strategies` via the same helper. Drop the `testRunIds` round-trip.
- [x] Audit: `grep -rn 'getTestStrategyIds\|testStrategyIds\|filterTestContent' evolution/src` — update every caller (including `getEvolutionInvocationsAction` and anywhere else that currently hand-rolls the `.not.in(...)`).

#### 4b. Show Elo CI everywhere Elo is displayed (S3)

**4b.i. Data plumbing**
- [x] `evolution/src/services/evolutionActions.ts`: add `mu`, `sigma` to the `baseFields` select in `getEvolutionVariantsAction` AND `listVariantsAction`. Extend `EvolutionVariant` and `VariantListEntry` interfaces with `mu: number; sigma: number;`. Compute `uncertainty` at the boundary via `dbToRating(mu, sigma).uncertainty` so downstream code never sees OpenSkill-scale numbers.
- [x] `evolution/src/services/variantDetailActions.ts`: audit every variant-detail action (`getVariantDetailAction`, parent/ancestor lookups, match history) and ensure mu/sigma are selected + threaded.
- [x] `evolution/src/services/evolutionVisualizationActions.ts`: extend the Elo-history / lineage data payloads to include per-point `uncertainty` (both for DAG nodes and for the Elo history chart).
- [x] `evolution/src/lib/types.ts` + `schemas.ts`: extend the V3 `EvolutionRunSummary` shape (note: the schema is a `z.union`, not `discriminatedUnion` — see `schemas.ts:1055–1253`). Add two optional fields:
  - `topVariants[].uncertainty?: number` — per-variant rating uncertainty (Elo-scale). Direct from the variant's own `Rating.uncertainty`.
  - `strategyEffectiveness[*].seAvgElo?: number` — **standard error of the mean Elo across variants within this strategy bucket** (NOT rating uncertainty). Computed via Welford `sqrt(M2 / (n * (n - 1)))` when `n ≥ 2`. Explicitly labeled as "spread of variant Elos" in both the field doc and the UI tooltip (see 4b.ii) to avoid conflating it with single-variant rating CI.
- [x] V3 auto-migration contract for the new optional fields: the existing V1→V3 and V2→V3 transforms emit V3 rows WITHOUT these fields. All consumers must treat them as `undefined`-possible and suppress the `±`/CI rendering when absent. Tests must cover "legacy V2 row reads successfully, renders without `±`" (add to MetricsTab.test).
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (or wherever `buildRunSummary` lives): (a) populate `topVariants[].uncertainty` from each variant's rating; (b) extend the Welford accumulator in `buildRunSummary` to track `M2` alongside `count + avgElo`, and emit `seAvgElo = sqrt(M2 / (n * (n - 1)))` per strategy bucket when `n ≥ 2` (emit `undefined` for `n < 2`).

**4b.ii. Rendering sites (apply CI display to each, using `formatEloWithUncertainty` for single values + `formatEloCIRange` for ranges; match arena leaderboard column styling)**
- [x] `evolution/src/components/evolution/tabs/VariantsTab.tsx:141` — Rating column → `formatEloWithUncertainty`. Add a new "95% CI" column using `formatEloCIRange`. Fallback to `Math.round(elo_score)` when uncertainty is null (legacy rows).
- [x] `src/app/admin/evolution/variants/page.tsx:52` — same treatment as VariantsTab (global variants list).
- [x] `evolution/src/components/evolution/tabs/MetricsTab.tsx:88-110` — "Top Variants" table: use uncertainty from the extended `run_summary.topVariants[].uncertainty`. If null (legacy row), keep bare elo.
- [x] `evolution/src/components/evolution/tabs/MetricsTab.tsx:122` — "Strategy Effectiveness" table: render `avgElo ± seAvgElo` (within-run aggregate across variants, SE-of-mean). Column header tooltip: "Standard error of the mean Elo across variants in this strategy bucket — distinct from per-variant rating uncertainty." Fall back to bare `avgElo` when the new field is absent (legacy V1/V2/V3-without-field rows) or `n < 2`.
- [x] `evolution/src/components/evolution/tabs/EloTab.tsx:50-140` — Elo history chart: add a shaded uncertainty band around each line (upper = elo + 1.96 × uncertainty, lower = elo − 1.96 × uncertainty). Requires extending `eloHistory` shape to `Array<{elo, uncertainty}[]>` or a parallel `uncertaintyHistory` array — use whichever is simpler given the existing chart code.
- [x] `evolution/src/components/evolution/tabs/TimelineTab.tsx:150-160` — final winner Elo: add `± uncertainty`.
- [x] `evolution/src/components/evolution/tabs/SnapshotsTab.tsx:58-92` — already shows raw uncertainty; switch to `formatEloCIRange` so the display is consistent with arena/variants.
- [x] `evolution/src/components/evolution/visualizations/LineageGraph.tsx` + `VariantCard.tsx:56` — thread uncertainty through `LineageData.nodes[]`; show CI in the tooltip/card.
- [x] `evolution/src/components/evolution/variant/VariantLineageSection.tsx:97,101` — ancestor + parent rows: show `elo ± uncertainty`.
- [x] `evolution/src/components/evolution/variant/VariantMatchHistory.tsx:119` — opponent Elo column: show `elo ± uncertainty`.
- [x] `evolution/src/components/evolution/sections/VariantDetailPanel.tsx:74,101` — sidebar variant + parent lineage: show `elo ± uncertainty`.
- [x] `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx:59-71` — per-run Elo: MetricRow already has `ci_lower`/`ci_upper` from `evolution_metrics`; pass them through.

**4b.iii. Guarantee**
- [x] Audit step: after the changes, grep for `elo_score`, `.elo[^_a-zA-Z]`, `Math.round(.*elo)` across `evolution/src/components/**` and `src/app/admin/evolution/**`, and confirm every remaining site either (a) uses `formatEloWithUncertainty` / `formatEloCIRange`, or (b) has a documented reason not to (e.g. chart axis tick labels). Add a short comment at each site explicitly stating the choice so future readers know it's intentional.

#### 4d. Render aggregate CIs everywhere aggregate metrics are shown

Audit found six sites where we display an across-entities aggregate (sum / mean / max / percentile across runs or across variants within a run) without its confidence interval. Two groups:

**Group 1 — data already has CI, UI just drops it (render-only fix):**
- [x] `evolution/src/lib/metrics/metricColumns.tsx` (`createMetricColumns`): today the render function calls `METRIC_FORMATTERS[def.formatter](m.value)` discarding `ci_lower`/`ci_upper`/`uncertainty`. **Implementation choice:** inline the CI logic in the column render function (not in `METRIC_FORMATTERS`) — keep `METRIC_FORMATTERS` signatures stable (they're used in many non-column contexts), and have the column render call `formatEloCIRange` / numeric equivalent when the row has CI AND the metric's `aggregationMethod` is `bootstrap_mean` / `bootstrap_percentile` / `avg`. Render output: `"<value> <CI>"` where `<CI>` is `[lo, hi]` for elo-like, `±half-width` for error-%-like. This one change silently fixes Strategy list and Experiment list metric columns.
- [x] `src/app/admin/evolution/strategies/page.tsx` — confirm the updated columns render CI for `avg_final_elo`, `best_final_elo`, `avg_median_elo`, `avg_p90_elo`, `avg_decisive_rate`. Add tooltip header noting what the CI is.
- [x] `src/app/admin/evolution/experiments/page.tsx` — same confirmation for the experiment-level aggregate columns.
- [x] `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx:34-49` — thread `ci_lower`/`ci_upper` from the experiment's `evolution_metrics` rows through the summary `MetricRow` objects so the three summary cards (maxElo, totalCost, best eloPerDollar) render CI via `MetricGrid` the same way `EntityMetricsTab` does.
- [x] `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` (StrategyCostEstimatesView summary at lines 133-141 + SliceBreakdownSection): for metrics that `aggregateAvg` produces (avg error %, avg actual cost, avg estimation abs error USD), render `value ± SE` where SE can be derived from the per-run metric rows already fetched by `getStrategyCostEstimatesAction` (compute SE of the mean client-side from the `errorPct` samples already in `runs[]`). For the slice breakdown table, compute SE of each slice's `avgErrorPct` from the `errors[]` array already aggregated in the action.

**Group 2 — needs new CI computation on the producer side:**
- [x] `src/app/admin/evolution-dashboard/page.tsx:63-69` — global aggregate stats (`totalCostUsd`, `avgCostPerRun`, similar). Compute SE inline over the raw `evolution_runs` sample in the dashboard server action (`getEvolutionDashboardDataAction` in `evolution/src/services/evolutionVisualizationActions.ts` — **no separate `dashboardActions.ts` file exists**). Extend the returned shape to include `ci_lower`/`ci_upper` (or `seValue`) alongside each aggregate stat, then render `value ± SE` in the dashboard UI. Do NOT promote to `evolution_metrics` with a synthetic "global" entity type — keeps this change self-contained.
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.ts` + `evolution/src/components/evolution/tabs/MetricsTab.tsx:122` — Strategy Effectiveness row (within-run aggregate across variants). Schema + finalize change is covered in Phase 4b.i (adds `seAvgElo` to `strategyEffectiveness`). Rendering change is already in Phase 4b.ii.

**Guarantee step (4d.iii):**
- [x] After the above, grep for metric-display sites that render only `value` when the row also has `ci_lower`/`ci_upper`/`uncertainty` populated. Add a lint-style unit test in `evolution/src/lib/metrics/metricColumns.test.tsx` that, given a metric definition with a bootstrap aggregation and a row carrying CI, asserts the rendered column includes the CI glyph (`±` or `[`). Backstop against future regressions.

#### 4c. Variants tab on strategy detail page (S2)
- [x] Parameterize `getEvolutionVariantsAction` to accept `{ runId?: string; strategyId?: string; includeDiscarded?: boolean; limit?: number; offset?: number }`. When `strategyId` is set (and `runId` is not), query variants joined through `evolution_runs.strategy_id = strategyId`. Reject if both are set.
- [x] Refactor `VariantsTab` to accept `{ runId?: string; strategyId?: string; runStatus?: string }`. Internally pass whichever is set to the action. Warning banner `runStatus === 'failed'` only applies when `runId` is set.
- [x] On `src/app/admin/evolution/strategies/[strategyId]/page.tsx`:
  - Add `'variants'` to `TABS` between `'runs'` and `'config'`.
  - Render `<VariantsTab strategyId={strategyId} />` when `activeTab === 'variants'`.
- [x] When filtering variants by strategy, the "strategy" dropdown filter inside `VariantsTab` becomes redundant (all variants will share the strategy). Hide the dropdown when `strategyId` is set, or repurpose it to filter by `agent_name` which still varies (`structural_transform`, `lexical_simplify`, `grounding_enhance`, etc.).
- [x] The 4b CI columns appear on both tab variants automatically since they share the component.

### Testing additions for Phase 4

#### Unit Tests
- [x] **TS/SQL anti-drift integration test** (`src/__tests__/integration/evolution-test-content-filter.integration.test.ts`): `pg-tap` is NOT available in this repo — use the standard integration-test harness. Define a shared fixtures constant `TEST_NAME_FIXTURES: Array<{name: string; isTest: boolean}>` exported from `evolution/src/services/shared.ts` covering every pattern class: `[TEST]`, `[E2E]`, `[TEST_EVO]`, bare `test` / `TEST` / mixed case, timestamp-pattern (`e2e-nav-1775877428914-strategy`), normal names (`Cheap judge, aggressive budget floor`, `Qwen 2.5 7b judge`). Test: (a) asserts TS `isTestContentName` matches every row's expected boolean; (b) inserts each fixture name into `evolution_strategies` and reads back `is_test_content`, asserting the trigger-populated value matches the fixture. Any divergence = failing test. This is the anti-drift guarantee.
- [x] `evolution/src/services/shared.test.ts` (unit) — using the same `TEST_NAME_FIXTURES`, assert the TS `isTestContentName` helper matches the fixtures. Cheap sanity check that runs without DB.
- [x] `evolution/src/components/evolution/tabs/VariantsTab.test.tsx` — (a) renders CI column when `mu`/`sigma` present, (b) graceful fallback to bare elo when absent, (c) strategy-dropdown hidden when `strategyId` prop set, (d) table renders variants from multiple runs when called with `strategyId`, (e) the `runStatus === 'failed'` banner is NOT shown when `strategyId` is set.
- [x] `evolution/src/services/evolutionActions.test.ts` — extend `getEvolutionVariantsAction` tests with a `strategyId` case; assert joins through runs and returns all variants across all runs of that strategy. Add a test asserting `runId` XOR `strategyId` validation (rejects both set).
- [x] Per-site rendering tests for Elo CI coverage:
  - [x] `evolution/src/components/evolution/tabs/MetricsTab.test.tsx` — "Top Variants" renders `± uncertainty` when the new V3 field is populated; bare elo for legacy rows. "Strategy Effectiveness" renders `avgElo ± seAvgElo` when the new field is populated (n ≥ 2); bare `avgElo` for legacy rows or n < 2.
  - [x] `evolution/src/components/evolution/tabs/EloTab.test.tsx` — chart includes uncertainty band when `uncertainty` array provided; falls back to lines-only when absent.
  - [x] `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — final winner elo renders `± uncertainty`.
  - [x] `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx` — CI range format matches arena/variants style.
  - [x] `evolution/src/components/evolution/visualizations/VariantCard.test.tsx` — tooltip shows CI.
  - [x] `evolution/src/components/evolution/variant/VariantLineageSection.test.tsx` + `VariantMatchHistory.test.tsx` — ancestor/opponent rows show CI.
  - [x] `src/app/admin/evolution/variants/page.test.tsx` — Rating column renders CI.
  - [x] `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.test.tsx` (new) — per-run Elo shows CI when `ci_lower`/`ci_upper` present on metric row.
- [x] `evolution/src/lib/utils/formatters.test.ts` — cover `formatEloWithUncertainty` / `formatEloCIRange` edge cases (null uncertainty, zero uncertainty, negative — already partly covered; confirm).

#### Integration Tests
- [x] `src/__tests__/integration/evolution-test-content-filter.integration.test.ts` (new) — seed a DB with 2,000 synthetic test-pattern strategies + 5 non-test strategies + runs on both. Assert `getEvolutionRunsAction({ filterTestContent: true })` returns ONLY the non-test runs; assert `count` matches. Add analogous cases for `listVariantsAction` and `getEvolutionInvocationsAction`. This is the regression test that would have caught S1.
- [ ] ~~deferred~~ `src/__tests__/integration/evolution_variants_strategy_scope.integration.test.ts` — create 3 runs under one strategy, 2 under another, seed variants in each; assert `getEvolutionVariantsAction({ strategyId })` returns all variants across the strategy's 3 runs and none from the other strategy.
- [ ] ~~deferred~~ Extend the existing `evolution_is_test_name` Postgres function test to assert the `is_test_content` trigger fires on INSERT and UPDATE (column name change).

#### E2E Tests
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-runs-filter.spec.ts` (new) — navigate to `/admin/evolution/runs`, confirm "Hide test content" is checked by default, assert at least one non-test run row renders. Seed ≥1 non-test run before running. Covers S1.
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-variants-tab.spec.ts` (new) — navigate to a strategy detail page, click the new Variants tab, assert the table renders variants from multiple runs of that strategy with the Elo CI column populated (e.g. contains the `±` character and `[` bracket syntax). Covers S2 + S3.
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-elo-ci-coverage.spec.ts` (new) — smoke test that visits each tab/page where Elo is displayed (run detail Variants, run detail Metrics, run detail Elo, run detail Timeline, variant detail, global variants list, strategy variants, experiment detail, arena) and asserts at least one `± ` or `[…,…]` Elo-CI rendering is present. Backstop against regressions of the 4b audit.

##### Aggregate CI tests (Phase 4d)
- [x] `evolution/src/lib/metrics/metricColumns.test.tsx` (new or extend) — unit test: given a metric def with `aggregationMethod: 'bootstrap_mean'` and a row with `value=1234`, `ci_lower=1200`, `ci_upper=1270`, assert the rendered column contains `[1200, 1270]` (or equivalent CI glyph). Parallel test for `bootstrap_percentile`. Also assert that a metric with `aggregationMethod: 'sum'` and no CI renders plain value (no CI glyph).
- [x] `src/app/admin/evolution/strategies/page.test.tsx` — extend to seed a strategy with bootstrap-CI metric rows and assert the aggregate columns render CI glyphs. Regression for Group 1.
- [x] `src/app/admin/evolution/experiments/page.test.tsx` — same for experiment list.
- [x] `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.test.tsx` — summary cards render CI on `maxElo`, `totalCost`, `eloPerDollar` when metric rows carry CI.
- [x] `evolution/src/components/evolution/tabs/CostEstimatesTab.test.tsx` — StrategyCostEstimatesView summary renders `± SE` on avg error %. SliceBreakdown row shows `± SE` when the slice has ≥ 2 runs.
- [x] `src/app/admin/evolution-dashboard/page.test.tsx` — aggregate stats row renders `± SE` on totals.
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-aggregate-ci-coverage.spec.ts` (new) — E2E smoke across strategy list, experiment list, experiment detail, dashboard, strategy Cost Estimates. **Anti-flake measures:** seed each visited entity with **≥ 2 completed runs carrying bootstrap-CI metric rows** so the `n ≥ 2` gate is satisfied everywhere. Scope each page's assertion to the seeded entity's row (by strategy name or ID) instead of a page-global `±` glyph search — that way unrelated entities with `n < 2` don't cause false negatives. Reuse the existing seed helper from `admin-evolution-cost-estimates-tab.spec.ts` (recent commit `76192939` added GFSA-invocation seeding for similar specs; extend that helper rather than writing a new one).
- [x] Same seeding pattern applied to `evolution_elo_ci_coverage.spec.ts` (per-variant CI requires populated mu/sigma, which fresh-seeded variants have — this is less flake-prone than the aggregate version but still seed-dependent).

### Documentation Updates for Phase 4
- [x] `evolution/docs/visualization.md` — (a) update the strategy detail page row of the Admin Pages table to include the new `variants` tab; (b) update the VariantsTab component description to note the dual `runId`/`strategyId` parameterization and the Elo CI column; (c) add a one-line convention note that every Elo display site should render CI via `formatEloWithUncertainty` / `formatEloCIRange` (list the helpers + where the few intentional exceptions live).
- [x] `evolution/docs/reference.md` — add `evolution_strategies.is_test_content` and the `evolution_is_test_name(text)` Postgres function to the Schema / Key RPCs sections.
- [x] `evolution/docs/data_model.md` — update the `evolution_variants` mu/sigma row to note that mu/sigma are now also selected by admin list endpoints (so CI rendering works), and note the new `is_test_content` column on `evolution_strategies`.
- [x] `evolution/docs/rating_and_comparison.md` — cross-reference the formatter helpers and the UI convention ("all admin Elo displays should show CI — per-variant uses rating uncertainty; aggregates use bootstrap CI or SE-of-mean").
- [x] `evolution/docs/metrics.md` — under "UI Integration", note that `createMetricColumns` now renders CI for bootstrap-aggregated metrics, and that the dashboard server action computes SE inline for aggregate stats.
- [x] `docs/docs_overall/debugging.md` — in the "Test content filtering" area (or near the existing filter note under runs debugging), add a one-line caution: filters on `strategy_id NOT IN (…large list…)` don't scale beyond a few hundred rows; use the `is_test_content` column.

## Review & Discussion
[Populated by /plan-review]
