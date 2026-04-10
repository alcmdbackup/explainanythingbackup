# Investigate Cost Controls Evolution Parallel Generation Plan

## Background
The parallel generate-rank pipeline dispatches N agents concurrently. Research confirmed the core budget gate (`reserve()`) is race-safe, but found two bugs and one design flaw in cost attribution. See `_research.md` for full findings.

## What We're Fixing

**Bug 1 (DONE):** `persistRunResults.ts` used plain `writeMetric` for the finalization cost write, which could overwrite a higher live-written value with a lower one. Fixed by changing to `writeMetricMax`.

**Bug 2 (TODO):** `Agent.run()` computes invocation cost as `getTotalSpent() - costBefore` on a shared tracker. Under parallel dispatch, this delta captures costs from *all* agents active during the window, not just the current agent. Result: `cost_usd` on invocations is timing-dependent and unreliable. Confirmed via run `7e482d75` where `costTracker.getTotalSpent()` at finalization = `$0.013468` while true total = `$0.026608`.

**Root cause of Bug 2:** The shared `V2CostTracker` serves two purposes — budget gating (must be shared, synchronous `reserve()`) and cost attribution (should be per-agent). These need to be separated.

## Decision: Agent Cost Scope (Option C)

Wrap the shared tracker in a per-invocation scope object. The scope:
- Delegates `reserve()`, `release()`, `getTotalSpent()`, `getAvailableBudget()` to the shared tracker — budget gate unchanged
- Intercepts `recordSpend()` to also increment a private `ownSpent` counter
- Exposes `getOwnSpent()` — this agent's LLM costs only, independent of other agents

`Agent.run()` creates a scope per invocation and passes it as `costTracker` in `extendedCtx`. Reads `scope.getOwnSpent()` instead of the global delta. **No changes to individual agents or the LLM client interface.**

Rejected alternatives:
- **Option A** (return `{ text, cost }` from `complete()`): clean but touches every call site in every agent
- **Option B** (accumulator in `AgentContext`): mutable side-channel, no cleaner than current approach

## Execution Plan

### Phase 1: Fix finalization metric downgrade — DONE
- [x] `persistRunResults.ts:255`: `writeMetric` → `writeMetricMax`

### Phase 2: Implement agent cost scope
- [x] Add to `evolution/src/lib/pipeline/infra/trackBudget.ts`:
  - `AgentCostScope` interface extending `V2CostTracker` with `getOwnSpent(): number`
  - `createAgentCostScope(shared: V2CostTracker): AgentCostScope` — delegates all methods to shared, intercepts `recordSpend` to track `ownSpent`
- [x] Update `evolution/src/lib/core/Agent.ts`:
  - Remove `const costBefore = ctx.costTracker.getTotalSpent()`
  - After `createInvocation` resolves: `const costScope = createAgentCostScope(ctx.costTracker)`
  - Pass `costScope` as `costTracker` in `extendedCtx`
  - Replace `getTotalSpent() - costBefore` with `costScope.getOwnSpent()` in both success and error paths

### Phase 3: Tests
- [x] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — new tests for `createAgentCostScope`:
  - `getOwnSpent()` returns only this scope's costs, not other scopes'
  - `getTotalSpent()` returns the shared tracker total
  - Two scopes on same shared tracker: each `getOwnSpent()` independent; `getTotalSpent()` = combined
  - `reserve()` on scope blocks when shared budget exhausted
  - `release()` on scope decrements shared `totalReserved`
- [x] `evolution/src/lib/core/Agent.test.ts` — update cost tracking:
  - Remove "computes cost as difference in total spent" (tests the buggy delta)
  - Add: two parallel `agent.run()` on same shared tracker — each `cost_usd` reflects only that agent's calls
  - Add: agent completes mid-way through another agent's execution — `cost_usd` unaffected by other agent's spend

## Testing

### Phase 2 — Agent Cost Scope

**`evolution/src/lib/pipeline/infra/trackBudget.test.ts`** — new `createAgentCostScope` suite:
- [x] `getOwnSpent()` returns 0 before any recordSpend
- [x] `getOwnSpent()` increments only for this scope's `recordSpend()` calls
- [x] Two scopes on same shared tracker: each `getOwnSpent()` is independent (scope A's spend doesn't appear in scope B)
- [x] `getTotalSpent()` on scope returns the shared tracker total (includes all scopes' spend)
- [x] `getAvailableBudget()` reflects the shared available budget after both scopes spend
- [x] `reserve()` delegates to shared tracker — throws `BudgetExceededError` when shared budget exhausted, even if this scope has spent nothing
- [x] `release()` decrements shared `totalReserved` (verified via `getAvailableBudget()`)
- [x] `getPhaseCosts()` returns shared phase costs, not just this scope's

**`evolution/src/lib/core/Agent.test.ts`** — cost tracking update:
- [x] Remove existing "computes cost as difference in total spent" test (was testing the buggy delta)
- [x] `cost_usd` on successful invocation = `scope.getOwnSpent()` (not global delta)
- [x] Two agents run **concurrently** (`Promise.all([agentA.run(input, ctx), agentB.run(input, ctx)])` started before either resolves, with mocked `execute()` using `Promise.resolve` to yield between steps) — each `cost_usd` reflects only its own calls; `cost_usd_A + cost_usd_B = totalSpent`
- [x] Interleaved spend: Agent B's `recordSpend()` injected mid-way through Agent A's execution (via Promise ordering) — Agent A's final `cost_usd` unchanged
- [x] `cost_usd` correct on error path (BudgetExceededError) — only this agent's pre-error spend (note: `recordSpend()` is not called after the error is thrown; `ownSpent` reflects only completed LLM calls)

---

### Phase 4 — rankNewVariant + CreateSeedArticleAgent

**`evolution/src/lib/pipeline/loop/rankNewVariant.test.ts`** — new file:
- [x] Adds variant to local pool and assigns `createRating()` before calling `rankSingleVariant`
- [x] `surfaced = true` when `rankResult.status` = `converged`, `eliminated`, or `no_more_opponents`
- [x] `surfaced = false` when `status = 'budget'` AND `localMu < top15Cutoff`; `discardReason` populated
- [x] `surfaced = true` when `status = 'budget'` AND `localMu >= top15Cutoff` (above cutoff, keep despite budget)
- [x] Empty pool: exits immediately with `no_more_opponents`, `surfaced = true`, zero ranking cost
- [x] `rankingCost` = cost delta incurred during `rankSingleVariant` call
- [x] Input `localPool`/`localRatings`/`localMatchCounts` mutated (local state updated by ranking)
- [x] `BudgetExceededError` thrown by `rankSingleVariant` surfaces as `status = 'budget'`

**`evolution/src/lib/core/agents/generateFromSeedArticle.test.ts`** — regression after refactor:
- [x] All existing tests pass unchanged (behavior preserved after extracting `rankNewVariant`)

**`evolution/src/lib/core/agents/createSeedArticle.test.ts`** — new file:
- [x] Makes `seed_title` LLM call first, then `seed_article` LLM call
- [x] Creates variant from generated content with `strategy: 'create_seed_article'`
- [x] Calls `rankNewVariant()` with the seed variant and provided pool snapshot
- [x] `surfaced = true` when pool is empty (no_more_opponents, unconditional surface)
- [x] `surfaced = false` when pool has arena entries, budget exhausted, seed mu below cutoff
- [x] Format validation failure on article → `result.status = 'generation_failed'`, no ranking call
- [x] `BudgetExceededError` on title call → `result.status = 'budget'`, `cost_usd` = 0
- [x] `BudgetExceededError` on article call → `result.status = 'budget'`, `cost_usd` = title cost only
- [x] Input `initialPool`/`initialRatings` snapshots not mutated
- [x] `cost_usd` (via `Agent.run()` scope) reflects only this agent's two LLM calls — not sibling agents

**`evolution/src/lib/pipeline/setup/buildRunContext.test.ts`** — additions:
- [x] `explanation_id`-based run: `seedPrompt` absent in returned context, `originalText` from explanations table, LLM provider never called
- [x] `prompt_id`-based run, arena has one `generation_method = 'seed'` entry: `seedPrompt` absent, `originalText` = that variant's content, LLM provider never called
- [x] `prompt_id`-based run, arena has multiple `generation_method = 'seed'` entries: `originalText` = content of the highest `elo_score` entry
- [x] `prompt_id`-based run, no seed in arena: `seedPrompt` = full prompt text, `originalText` absent, LLM provider never called (deferred to CreateSeedArticleAgent)
- [x] `prompt_id`-based run, seed entry has `archived_at` set (archived): not selected; treated as no-seed case

**`evolution/src/lib/pipeline/loop/runIterationLoop.test.ts`** — additions:
- [x] `seedPrompt` absent: iteration 1 dispatches generation agents normally, no seed agent run
- [x] `seedPrompt` present: `CreateSeedArticleAgent` runs before generation agents in iteration 1
- [x] Seed variant in pool before generation agents receive their input snapshot
- [x] Generation agents' `initialPool` includes the seed variant
- [x] `originalText` passed to generation agents = seed content
- [x] Seed agent budget failure (`status = 'budget'`): run stops, no generation agents dispatched
- [x] `seedPrompt` only triggers seed agent in iteration 1 — not in subsequent iterations
- [x] When `seedPrompt` present: baseline variant created AFTER seed agent from `seedVariant.text` (not at initialization); assert `baseline.text === seedVariant.text`
- [x] When `seedPrompt` absent: baseline created at initialization as usual
- [x] `EvolutionResult.isSeeded = true` when seed agent ran; `false`/`undefined` otherwise
- [x] Seed agent `surfaced = false` (budget exhausted, below cutoff): run still stops (`stopReason = 'seed_failed'`); **baseline is NOT created** (no originalText available); `isSeeded = false`
- [x] Seed agent `status = 'generation_failed'`: same as budget failure — run stops, no baseline created

**`evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`** — additions:
- [x] When `isSeeded = true`: baseline variant (`strategy = 'baseline'`) synced with `generation_method = 'seed'`; regular variants get `'pipeline'`
- [x] When `isSeeded = false` (explanation-based): baseline variant synced with `generation_method = 'pipeline'` — not 'seed'
- [x] Arena entries (fromArena=true) still excluded from new entries, regardless of `isSeeded`
- [x] Baseline variant created from seed `originalText` still present in pool and ranked correctly

**`evolution/src/lib/pipeline/loop/runIterationLoop.test.ts`** — additional cases:
- [x] After seed agent succeeds, baseline variant is created from seed `originalText` and added to pool before generation dispatch

---

### Integration Tests

**`src/__tests__/integration/evolution-cost-attribution.integration.test.ts`** — new file:
- Uses mocked `V2CostTracker.recordSpend()` to inject predictable costs (avoids real API flakiness while preserving cost accounting logic)
- [x] N agents run concurrently on same shared tracker — `SUM(cost_usd)` across invocations = `totalSpent` (`.toBeCloseTo(expected, 4)`); no double-counting
- [x] Per-agent `cost_usd` values are distinct and positive; no two invocations report the same cost value when costs are unique

**`src/__tests__/integration/evolution-seed-cost.integration.test.ts`** — new file:
- Uses mocked LLM client with deterministic responses (avoids real API; preserves cost propagation logic)
- [x] Prompt-based run (first time, empty arena): `seed_cost` metric populated at run level; propagated to strategy/experiment level via `SHARED_PROPAGATION_DEFS`; `generation_method = 'seed'` variant in arena; `create_seed_article` invocation row created; `seed_cost` value ≈ `invocation.cost_usd` (`.toBeCloseTo(..., 4)`)
- [x] Prompt-based run (second time, arena has seed): no `create_seed_article` invocation; `seed_cost = 0`; `originalText` matches prior seed
- [x] `explanation_id`-based run: no `create_seed_article` invocation; `seed_cost` absent or 0; baseline synced with `generation_method = 'pipeline'`
- [x] Two concurrent prompt-based runs on same prompt (both start with empty arena): both runs complete without error; assert arena has exactly 2 `generation_method = 'seed'` entries for the prompt BEFORE cleanup; test cleanup removes both entries after assertion

---

### Manual Verification
- [ ] Run evolution job with `numVariants >= 3` (prompt-based), verify: `SUM(evolution_agent_invocations.cost_usd)` ≈ `evolution_metrics.cost`; `seed_cost` metric populated; arena has `generation_method = 'seed'` entry
- [ ] Run a second job on the same prompt, verify: no new `create_seed_article` invocation; `originalText` matches first run's seed

### Phase 4: Track seed costs via CreateSeedArticleAgent

**Problem:** Prompt-based runs call `generateSeedArticle()` inside `buildRunContext()` using the V1 `callLLM` path, before the V2CostTracker exists. Seed costs (~5-20% of total spend) are invisible in `evolution_metrics` and the UI cost columns.

**Fix:** Introduce `CreateSeedArticleAgent` (extends `Agent`). Move seed generation from `buildRunContext` into iteration 1 of `runIterationLoop`, where the V2CostTracker already exists. The seed result is the first pool entry — iteration 1's generation agents then produce variants from it. The agent also ranks the seed via binary search (same as `GenerateFromSeedArticleAgent`), using a shared `rankNewVariant()` helper extracted from the inline ranking block in `generateFromSeedArticle.ts`.

**Iteration 1 flow (prompt-based runs, after this change):**
1. `CreateSeedArticleAgent` runs (sequential, before generation dispatch):
   - 2 LLM calls: `seed_title` + `seed_article`
   - Seed variant created and added to the iteration-start pool snapshot (which may include pre-loaded arena entries); `rankNewVariant()` called against that snapshot
   - If pool had no arena entries: `rankSingleVariant` exits with `no_more_opponents` — seed surfaces unconditionally, zero ranking cost
   - If pool had arena entries: full ranking runs; seed may be discarded if budget exhausted and mu < top-15% cutoff
   - `originalText` set to `seedVariant.text`; this is stored in `runIterationLoop` local state for use by generation agents
2. Seed variant added to the shared pool with its rating; generation agents receive it in their `initialPool` snapshot
3. Normal generation agents dispatch in parallel, generating from `originalText`
4. Ranking proceeds as usual (each generation agent ranks against the pool that includes the seed)

**`explanation_id`-based runs are unaffected** — they fetch existing content with no LLM call, `seedPrompt` is absent, iteration 1 starts normally.

**Failure handling for CreateSeedArticleAgent:** If seed agent returns `status = 'budget'` or `status = 'generation_failed'`, `runIterationLoop` sets `stopReason = 'seed_failed'` and exits the loop immediately — no generation agents are dispatched. The run is finalized as a failed run.

**Multiple seed entries / concurrent creation race:** `buildRunContext` queries arena for `generation_method = 'seed'`, ordered by `elo_score DESC`, takes the first result. If two concurrent runs simultaneously find no seed and both call `CreateSeedArticleAgent`, both seeds get synced to arena with `generation_method = 'seed'` — this is acceptable (two seeds for a prompt is harmless; future runs pick the higher-rated one). No DB-level uniqueness constraint needed.

**Shared ranking helper — `rankNewVariant()`:**
Extract from `generateFromSeedArticle.ts` lines 276-305 into `evolution/src/lib/pipeline/loop/rankNewVariant.ts`:
```typescript
rankNewVariant({
  variant, localPool, localRatings, localMatchCounts, completedPairs,
  cache, llm, config, invocationId, logger, costTracker
}): Promise<{
  rankingCost: number;
  rankResult: { status: RankSingleVariantStatus; matches: V2Match[]; detail: RankSingleVariantDetail };
  surfaced: boolean;
  discardReason?: { localMu: number; localTop15Cutoff: number };
}>
```
The helper includes the full surface/discard logic: `computeTop15Cutoff` check, `surfaced = false` only when `status === 'budget' && localMu < cutoff`. Both `CreateSeedArticleAgent` and `GenerateFromSeedArticleAgent` call this instead of inlining the ranking block.

**`CreateSeedArticleAgent` ExecutionDetail schema:** Mirrors `GenerateFromSeedExecutionDetail` shape — `detailType: 'create_seed_article'`, `generation: { cost, promptLength, titleLength, contentLength, formatValid }`, `ranking: { cost, ...RankSingleVariantDetail }`, `surfaced`, `totalCost`. Define `createSeedArticleExecutionDetailSchema` in `schemas.ts`.

**`seed_cost` metric propagation:** `seed_cost` follows the same pattern as `generation_cost` / `ranking_cost` — live-written per LLM call by `createLLMClient.ts`, and propagated to strategy/experiment level via `SHARED_PROPAGATION_DEFS` in `registry.ts`. Add `seed_cost` to `SHARED_PROPAGATION_DEFS`.

- [x] **`evolution/src/lib/pipeline/loop/rankNewVariant.ts`**: extract inline ranking block from `generateFromSeedArticle.ts:276-305` into shared `rankNewVariant()` helper with the signature above
- [x] **`evolution/src/lib/core/agents/generateFromSeedArticle.ts`**: refactor to call `rankNewVariant()` instead of inline block (no behavior change)
- [x] **`evolution/src/lib/core/agentNames.ts`**: add `create_seed_article` to `AGENT_NAMES`; add `create_seed_article: 'seed_cost'` to `COST_METRIC_BY_AGENT`
- [x] **`evolution/src/lib/metrics/registry.ts`** (and METRIC_CATALOG): add `seed_cost` metric following same three-tier pattern as `generation_cost`; add to `SHARED_PROPAGATION_DEFS` for strategy/experiment propagation
- [x] **`evolution/src/lib/schemas.ts`**: add `createSeedArticleExecutionDetailSchema`
- [x] **`evolution/src/lib/core/agents/createSeedArticle.ts`**: new `CreateSeedArticleAgent` — `execute()` calls `generateTitle` + article LLM call (V2 client, `seed_title`/`seed_article` labels); then calls `rankNewVariant()` against the provided pool snapshot; returns `GenerateFromSeedOutput`-shaped result
- [x] **`evolution/src/lib/pipeline/setup/buildRunContext.ts`**: for `prompt_id`-based runs, query arena for `generation_method = 'seed'` ordered by `elo_score DESC` first — if found, return `originalText = variant.content`; otherwise skip `generateSeedArticle`, add `seedPrompt?: string` to `RunContext`, return raw prompt text there
- [x] **`evolution/src/lib/pipeline/loop/runIterationLoop.ts`**: at the start of iteration 1, if `options.seedPrompt` present — run `CreateSeedArticleAgent` with the loaded arena entries as `initialPool`; on failure set `stopReason = 'seed_failed'` and exit; on success add seed variant to pool, set local `originalText`; generation agents proceed normally; seed agent NOT re-run in subsequent iterations
- [x] **`evolution/src/lib/pipeline/finalize/persistRunResults.ts`**: add `isSeeded: boolean` to `syncToArena` signature — new signature: `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase, isSeeded, logger?)`; when `isSeeded && variant.strategy === 'baseline'`, use `generation_method: 'seed'`; all other variants keep `'pipeline'`
- [x] **`evolution/src/lib/pipeline/claimAndExecuteRun.ts`**: add `seed_cost` to zero-init metric list (lines 225-233)

**isSeeded flag threading (full call chain):**
1. `buildRunContext` returns `seedPrompt?: string` in `RunContext` — if present, this run is seeded
2. `runIterationLoop` knows it's seeded (via `options.seedPrompt`); after seed agent succeeds, sets local `isSeeded = true`
3. `EvolutionResult` (returned by `evolveArticle`/`runIterationLoop`) gets an `isSeeded?: boolean` field
4. `executePipeline` (`claimAndExecuteRun.ts:249`) receives `result.isSeeded` and passes it to `syncToArena`
5. `syncToArena` uses `isSeeded` to conditionally set `generation_method: 'seed'` on the baseline variant

**Baseline creation when seedPrompt present:**
The current baseline creation at `runIterationLoop.ts:216-225` runs at initialization, before `originalText` is known for seeded runs. Fix: if `options.seedPrompt` is present, **skip** baseline creation at initialization; after `CreateSeedArticleAgent` completes and `originalText` is set, create the baseline variant from `seedVariant.text` and add it to the pool. This ensures baseline uses the actual seed content, not a null/empty string. Seeded baseline has `strategy: 'baseline'` (unchanged) and is synced to arena as `generation_method: 'seed'`.

## Verification

### A) Playwright Verification
- [x] Not applicable — no UI changes

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="trackBudget|Agent|rankNewVariant|createSeedArticle|generateFromSeedArticle|buildRunContext|runIterationLoop|persistRunResults"`
- [x] `npm run test:integration -- --testPathPattern="evolution-cost-attribution|evolution-seed-cost"`

## Documentation Updates
- [x] `evolution/docs/cost_optimization.md` — update to describe agent cost scope pattern
- [x] `evolution/docs/agents/overview.md` — note that `cost_usd` now reflects only that agent's LLM calls; add `CreateSeedArticleAgent` entry
- [x] `evolution/docs/metrics.md` — document `seed_cost` metric and the fact that seed was previously excluded

## Key Files
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — add `AgentCostScope` + `createAgentCostScope()`
- `evolution/src/lib/core/Agent.ts` — use scope instead of global delta
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — ✅ already fixed
- `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — new scope tests
- `evolution/src/lib/core/Agent.test.ts` — updated cost tracking tests
- `evolution/src/lib/core/agents/createSeedArticle.ts` — new agent (Phase 4)
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts` — shared ranking helper (Phase 4)
- `evolution/src/lib/core/agentNames.ts` — add `create_seed_article` + `seed_cost` mapping
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — return `seedPrompt` instead of calling V1 seed
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — run `CreateSeedArticleAgent` if `seedPrompt` present; defer baseline creation; return `isSeeded` in `EvolutionResult`
- `evolution/src/lib/pipeline/infra/types.ts` (or wherever `EvolutionResult` is defined) — add `isSeeded?: boolean` field

## Review & Discussion

### /plan-review — Consensus reached after 4 iterations (2026-04-09)

**Final scores:** Security 5/5 · Architecture 5/5 · Testing 5/5

**Gaps resolved across iterations:**
- **Iter 1→2:** `generation_method='seed'` scoped to prompt-based runs via `isSeeded` flag; `originalText` propagation from seed agent specified; seed agent receives `initialPool` (not empty); `seed_cost` added to `SHARED_PROPAGATION_DEFS`; multiple seed entries handled (order by `elo_score DESC`); concurrent seed creation accepted (both sync, future picks highest); seed agent failure mode specified (`stopReason='seed_failed'`); `ExecutionDetail` schema specified; `rankNewVariant()` return type fully typed
- **Iter 2→3:** `isSeeded` flag threading fully specified (5-step chain: `buildRunContext` → `RunContext` → `runIterationLoop` → `EvolutionResult` → `syncToArena`); baseline creation deferred when `seedPrompt` present; boundary conditions specified (seed fails → no baseline, run stops); `EvolutionResult.isSeeded` added to Key Files; `syncToArena` new signature specified
- **Iter 3→4:** Agent.test.ts parallel test changed to `Promise.all` concurrent dispatch; `baseline.text === seedVariant.text` assertion added; concurrent seed integration test asserts 2 entries exist before cleanup; integration tests specify mocked LLM/tracker; `seed_cost` metric propagation verification added
