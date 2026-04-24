# Scan Codebase For Bugs Plan

## Background
Scan my evolution codebase for bugs until you find 100.

## Requirements (from GH Issue #NNN)
Scan my evolution codebase for bugs until you find 100.

## Problem

The evolution subsystem has 88 real, unaddressed bugs across 6 themes: missing Zod / SQL validation lets NaN/Infinity/empty strings reach DB columns (12); cost tracker + spending gate have reserve-side and calibration-cache holes (10); metric stale-flag cascade misses dynamic-prefix metrics (5); race conditions lurk in watchdog, merge agent, test temp files (8); error swallows hide reconcile/detail/DB failures (11); admin UI has a dead filter and several NaN/back-nav gaps (7); plus ratings cache, agent internals, testing-harness, and small logic fixes (35). See [`bugs_found.md`](./bugs_found.md) for the per-bug file:line evidence and suggested fix.

11 of the 88 are `high`-severity (Zod holes reaching NUMERIC columns, chunk-partial-read silent truncation, stale-cascade miss, race in parallel workers); the rest are medium (50) and low (27). There are no critical/data-loss bugs, but several race/stale-cache items need regression tests written before any fix lands.

## Options Considered

- [x] **Option B: Tranched by theme, 10 phases + pre-flight** — each phase is one reviewable PR. Chosen.
- [ ] **Option A: All 88 in one PR** — unreviewable; rejected.
- [ ] **Option C: Severity-only tranches** — splits related fixes across phases; rejected.

The 13 bugs tagged `[T]` (NEEDS-TEST) require a regression test *before* the fix lands. The remaining 75 are `[S]` (STANDS) and can be fixed directly.

## Plan vs Execution State

**This is a forward-looking plan.** The 88 bugs documented in [`bugs_found.md`](./bugs_found.md) are present in HEAD today. Each phase's PR is what *brings the code in line with this plan's specifications*. A code-review finding that "the cited line still has the bug" is expected — that's precisely what the phase exists to fix. Plan-review verdicts should focus on whether each bug's target fix is specified clearly enough to be implemented, tested, reviewed, and rolled back.

## Pre-flight Checks (hard gate)

All pre-flight items are **blocking**: Phase 1 does not start until each pre-flight checkbox is checked, merged, and CI-green. They are atomic one-line or docs-only PRs that establish invariants later phases depend on.

**Sign-off**: any repo owner / maintainer can close each pre-flight item once the PR is merged and the subsequent CI run on `main` is green. Docs-only pre-flight items (historic-run Zod tolerance audit, B012 AgentCostScope invariant) are "CI-green" once their PR merges without lint/typecheck failures on the touched doc — no runtime CI is expected.

**Escalation**: if a pre-flight item blocks Phase 1 for > 5 business days, post in the PR thread to unblock; the Phase 1 lead owns the escalation.

- [ ] **Supabase client version pin**: `package.json` must pin `@supabase/supabase-js ≥ 2.80`. The string-fragment `'in'` syntax in `invocationActions.ts:91` (retained post-audit per bugs_found.md WITHDRAWN reason for B055) relies on this. If pinned lower, bump before Phase 1.
- [ ] **B061 arity fix ahead of B057** (moved from Phase 10): `services/adminAction.ts:39` — change `handler.length <= 1` to `=== 1`. B057 (adopt `adminAction` in costAnalytics) can't land until this is fixed, otherwise the new adopter inherits the arity bug and it becomes load-bearing on the canonical pattern. Ship B061 in a 1-line PR before Phase 5.
- [ ] **B012 AgentCostScope invariant**: declare that after Phase 6 lands, *every* cost-tracker caller routes through `AgentCostScope`; `getTotalSpent()` is no longer valid as a scope fallback. This is the implicit assumption under Phase 2's `trackBudget` validation. Document the invariant in `evolution/docs/cost_optimization.md` in the Phase 2 PR; code-side enforcement lands in Phase 6.
- [ ] **Historic-run Zod tolerance**: any `readX.safeParse()` currently soft-tolerating NaN/Infinity will start emitting parse errors after Phase 1. Audit read paths for `mu`/`sigma`/`amount_usd`/`elo_score` and wrap with explicit `onError: 'log-and-skip'` before Phase 1 ships. Document in `evolution/docs/data_model.md`.
- [ ] **B019 + B086 atomicity**: Phase 2 must ship both in one PR — adding the fast-path monthly refresh (B019) with mismatched comparison operators (B086) leaves the fast-path and slow-path gates inconsistent.

## Phased Execution Plan

> Legend: `[S]` STANDS (ready to fix), `[T]` NEEDS-TEST (write regression test first), severity in parentheses.

### Phase 1: Zod + SQL validation hardening (12 bugs)

Goal: one-line `.refine(Number.isFinite)` / `.min(0)` / `.min(1)` on schemas + SQL guards. Low risk, closes silent-data-corruption.

- [ ] **B028** [S] `schemas.ts:226-228` — `.refine(Number.isFinite)` on `ratingSchema.elo` / `uncertainty` (high)
- [ ] **B063** [S] `schemas.ts:249,252` — `.refine(Number.isFinite)` on `amount_usd` / `available_budget_usd` (high)
- [ ] **B066** [S] `schemas.ts:155-156` — `.refine(Number.isFinite)` on variant `mu` / `sigma` (high)
- [ ] **B071** [S] `schemas.ts:147` — `.refine(Number.isFinite)` on variant `elo_score` (medium)
- [ ] **B072** [S] `schemas.ts:249` — `.min(0)` on budget-event `amount_usd` (medium)
- [ ] **B065** [S] `schemas.ts:158` — `.min(1)` on variant `generation_method` when non-null (medium)
- [ ] **B074** [S] add `tactic` field to `evolutionAgentInvocationInsertSchema` matching migration `20260417000001` (medium)
- [ ] **B075** [S] `schemas.ts:109,189` — `.max(10000)` on `error_message` (low)
- [ ] **B088** [S] `llmSpendingGate.ts:198` — replace unchecked cast with `z.object({value: z.boolean()}).safeParse(data.value)` (low)
- [ ] **B068** [S] migration `20260408000001_upsert_metric_max.sql:6-14` — cast `p_value::DOUBLE PRECISION` at entry + validate `Number.isFinite` at callers (medium)
- [ ] **B073** [S] migration `20260328000001_create_lock_stale_metrics.sql:6-23` — `SELECT DISTINCT unnest(p_metric_names)` before the UPDATE (medium)
- [ ] **B077** [S] migration `20260408000001_upsert_metric_max.sql:20` — `GREATEST(COALESCE(evolution_metrics.value, '-Infinity'::float8), EXCLUDED.value)` (low)

### Phase 2: Cost tracker & budget invariants (10 bugs — B019 + B086 ship atomically)

- [ ] **B017** [S] `trackBudget.ts:105-113` — at `reserve()` entry: `if (!Number.isFinite(estimatedCost) || estimatedCost < 0) throw new Error(...)` (high)
- [ ] **B020** [S] `trackBudget.ts:106-107` — quantize to integer cents: multiply by 100, `Math.round`, divide back (medium)
- [ ] **B021** [S] `src/config/llmPricing.ts:93-109` — at entry: `if (promptTokens < 0 || completionTokens < 0 || !Number.isFinite(…)) throw` (medium)
- [ ] **B019** [S] `llmSpendingGate.ts:76-89` — target location: move the `checkMonthlyCap()` call that currently lives in the slow-path at line 106 to a new invocation at the very top of `checkBudget()`, immediately after the kill-switch check (currently ~line 73) and **before** the daily-cache headroom test at line 76. This way every call — fast-path daily-hit *and* slow-path daily-miss — runs the monthly check. Ship atomically with B086 in a single PR. (medium)
- [ ] **B086** [S] `llmSpendingGate.ts:79, 271` — change the monthly-cap comparison to `>` at **both** the fast-path site (line 79: currently `cached.monthlyTotal + estimatedCost >= cached.monthlyCap`) and the slow-path site (line 271: same pattern). Confirm the daily path's operator at line 76 is already `<` (so "within headroom" → proceed; the monthly side reads `>` as "exceeded"). Ship atomically with B019. (low)
- [ ] **B089** [S] `llmSpendingGate.ts:150` — `(getConfigValue('evolution_daily_cap_usd') as number) ?? 25` to match the 25-USD documented default (low)
- [ ] **B018** [S] `costCalibrationLoader.ts:77-86` — on error, do **not** advance `state.lastRefreshedAtMs`; simply log and return the pre-existing cache. Next caller retries on next tick. (medium)
- [ ] **B022** [S] `costCalibrationLoader.ts:151-157` — widen the fallback chain to include `phase = SENTINEL` as the last step before the hardcoded default (medium)
- [ ] **B027** [S] `agentNames.ts` + `refreshCostCalibration.ts:165` — when writing calibration rows, key seed phases separately: `(SENTINEL, generationModel, SENTINEL, 'seed_title')` vs `(..., 'seed_article')`, not both collapsed to `'seed'` (medium)
- [ ] **B024** [S] `costCalibrationLoader.ts:124-131` — change the coalescing primitive from `state.inflight = null` (cleared in `.finally`) to a sentinel state machine. At module top declare `const FAILED_RETRY_MS = 30_000` and `type InflightState = { status: 'idle' } | { status: 'running'; promise: Promise<void> } | { status: 'failed'; at: number }`. On error, set `state.inflight = { status: 'failed', at: Date.now() }`. At the top of `hydrateCalibrationCache()`, if `state.inflight.status === 'failed' && Date.now() - state.inflight.at < FAILED_RETRY_MS`, return cached value without a new fetch; otherwise transition to `'idle'` and proceed. Prevents the microsecond-gap duplicate-fetch + cascading-retry path. (medium)

### Phase 3: Stale-cache cascades & metric propagation (6 bugs)

- [ ] **B041** [S] `core/Entity.ts:195-206` — extend `markParentMetricsStale` to also mark rows whose `metric_name` matches any entry in `DYNAMIC_METRIC_PREFIXES` (currently `['agentCost:', 'eloAttrDelta:', 'eloAttrDeltaHist:']` per `lib/metrics/types.ts`). **Implementation:** since `markParentMetricsStale` runs in TS (builds the `UPDATE` via the Supabase client, not a DB trigger), iterate `DYNAMIC_METRIC_PREFIXES` in TS and issue one `.or('metric_name.like.prefix%')` per entry via `supabase.from('evolution_metrics').update(...).or(...)`. Add a helper `isDynamicMetricName(name: string): boolean` in `lib/metrics/types.ts` (near `DYNAMIC_METRIC_PREFIXES`) and export it. Adding a new dynamic prefix to the constant array then automatically extends the cascade — no SQL changes needed, because the cascade is TS-side. (high)
- [ ] **B042** [S] add a variant→tactic cascade hook in `Entity.ts` — when a variant's rating changes, also mark the matching row in `evolution_tactics` (via `agent_name` → tactic UUID join) stale. Uses the same SQL trigger pattern as B041. (high)
- [ ] **B043** [T] `readMetrics.ts:59-93` — write chunk-failure integration test first; then change return shape from `Map<id, MetricRow[]>` to `{ data: Map<...>, errors: Array<{chunkIndex, error}> }`. **Caller audit is mandatory**: see the unified caller-audit template in the "Caller-audit PR description template" subsection of "Rollback & Backward Compatibility" below. TypeScript's structural typing automatically catches callers still expecting the old `Map<...>` return (TS2322 / TS2339 on `.get()`/`.set()`), so a missed caller fails `tsc` — no separate exhaustiveness guard needed. (high)
- [ ] **B044** [T] `tacticMetrics.ts:45-52` — write > 100-run test first; then wrap the `.in()` call in a `chunk(runIds, 100)` loop and merge results. (high)
- [ ] **B045** [T] `experimentMetrics.ts:124-139` — write property test with `fast-check` asserting that for any `values[]` with mixed `uncertainty` (some 0, some > 0), a seeded RNG produces identical output regardless of ordering; then in `bootstrapMeanCI`, always consume two `rng()` draws per iteration even when the else branch (no uncertainty) runs — either by moving the RNG advance to before the `if`, or by a no-op `rng(); rng();` in the else branch. (medium)
- [ ] **B046** [T] `recomputeMetrics.ts:48-65` — write partial-failure integration test: lock N metrics, succeed on N-1 writes, throw on the Nth; assert the Nth stays `stale=true` but the N-1 don't revert. Then change the catch block to track per-metric-name persistence status and re-mark only unpersisted rows. (high)

### Phase 4: Race / concurrency fixes — regression tests required (7 bugs)

Phase 4 infrastructure-race fixes (B104, B105, B109) ship in **Sub-PR 1** which must merge and land green in CI *before* **Sub-PR 2** (the functional-race fixes B056, B060, B122 — **B082 is docs-only, moved to Phase 5**) opens. Gating is explicit:

- Sub-PR 2 **branches from `main`** — not from the Sub-PR 1 branch — and is **opened only after** Sub-PR 1's merge commit appears on `main`.
- The subsequent nightly `@evolution` run on `main` must be green before Sub-PR 2 opens for review; Sub-PR 2 otherwise sits in draft.
- **If Sub-PR 2's branch ages > 7 days** against `main` (e.g., Sub-PR 1 review stretches long), rebase off the latest `main` and force-update the branch before opening Sub-PR 2 for review. This keeps its diff small and avoids merge-conflict surprises from unrelated main landings.
- Rationale: branching Sub-PR 2 off a pre-merge Sub-PR 1 creates conflict/rebase risk once the real merge commits; requiring Sub-PR 2 to branch off post-merge `main` makes each sub-PR independently reviewable.

This prevents test-infra flakiness from masking functional regressions in Sub-PR 2.

- [ ] **B104** [S] `evolution-test-data-factory.ts:13-16` — two-worker race test first; then UUID-fallback when `TEST_PARALLEL_INDEX` unset (high). **Sub-PR 1.**
- [ ] **B105** [S] `evolution-test-data-factory.ts:424-444` — `fsyncSync(fd)` after every `appendFileSync` (medium). **Sub-PR 1.**
- [ ] **B109** [S] `global-setup.ts` vs `playwright.config.ts` — discover once in config; pass discovered URL via `process.env.E2E_BASE_URL`; assert presence in global-setup (medium). **Sub-PR 1.**
- [ ] **B056** [S] `processRunQueue.ts:135-136` — 3-target load-imbalance test first; then hoist `targetCursor` outside the outer loop; persist across batches. Test oracle: feed 10 pending runs to 3 targets (2 fast, 1 slow); assert each gets ≥ 2 claims. (high). **Sub-PR 2.**
- [ ] **B060** [S] `watchdog.ts:49-57` — concurrent status-change test first; then migrate to a new RPC `expire_stale_runs(p_heartbeat_cutoff TIMESTAMPTZ)` that atomically `UPDATE … WHERE status IN ('claimed','running') AND last_heartbeat < p_heartbeat_cutoff RETURNING id`. (medium). **Sub-PR 2.**
- [ ] **B082** — *moved to Phase 5* (docs-only observability note, not a functional race fix; ships with error-handling items). See Phase 5 for the item.
- [ ] **B122** [S] `MergeRatingsAgent.ts:287-304` — concurrent-sync regression test first; then set `prompt_id` at insert by reading it from the enclosing `ctx.promptId`. (medium). **Sub-PR 2.**

Phase 4 items total: **6** (Sub-PR 1: B104, B105, B109; Sub-PR 2: B056, B060, B122). B082 relocated to Phase 5.

### Phase 5: Error handling & observability (11 bugs)

Ships **after** the B061 pre-flight (so B057 inherits a working pattern).

- [ ] **B008** [S] `claimAndExecuteRun.ts:333-340` — wrap the seed-variant upsert in a `retry({maxAttempts: 3, backoff: 'exponential'})` helper; on permanent failure, log + mark the run `status='failed'` and return early. (medium)
- [ ] **B034** [T] `computeRatings.ts:99-128` — malformed-openskill-response test first (mock `osRate` returning `undefined`, `{newRatings: []}`, `null`); then in the else branch throw `new Error(\`osRate returned malformed pair: ${JSON.stringify(result)}\`)`. (medium)
- [ ] **B035** [S] `selectWinner.ts:23-46` — when all candidates are unrated, `throw new NoRatedCandidatesError(\`pool=${pool.length}, rated=${rated}\`)`. (medium)
- [ ] **B051** [S] `Agent.ts:91-97` — on `executionDetailSchema.safeParse` failure, `updateInvocation({success: false, error_message: \`detail validation failed: ${errors.format()}\`})`. (medium)
- [ ] **B057** [S] `costAnalytics.ts:61-143` + siblings — migrate all 4 cost-analytics actions (`getCostSummaryAction`, `getDailyCostsAction`, `getCostByModelAction`, `getCostByUserAction`) to the `adminAction` wrapper; drop the inline `requireAdmin()` calls. Depends on pre-flight B061. (medium)
- [ ] **B079** [S] `src/app/api/evolution/run/route.ts:14` — declare in the same file (above the handler): `const runRequestSchema = z.object({ targetRunId: z.string().uuid().optional() }).strict();`. Replace `request.json().catch(() => ({}))` with a parse: wrap `await request.json()` in a try/catch that returns 400 on JSON parse failure; then `const parsed = runRequestSchema.safeParse(body)`; on validation failure `return NextResponse.json({error: 'Invalid request body', issues: parsed.error.issues}, {status: 400})`. Downstream call uses `parsed.data.targetRunId`. **Caller audit** (mandatory, `.strict()` is a breaking change): run `grep -rn "api/evolution/run\|/evolution/run'" src/ evolution/` to enumerate POST callers. Any caller currently sending fields beyond `targetRunId` must be listed in the PR description with one of `ADD_TO_SCHEMA` (field is valid, add to `runRequestSchema`) or `DROP` (field was never honored by the handler, caller updated to stop sending). (medium)
- [ ] **B080** [S] `src/lib/requestIdContext.ts:61` — `return this.get()?.requestId ?? \`unknown-${crypto.randomUUID()}\`` (medium)
- [ ] **B081** [S] `src/app/api/evolution/run/route.ts:22-27` — use `ServiceError.categorize(err)` to map to 400/402/500; log original error details. (medium)
- [ ] **B083** [S] `src/lib/services/llms.ts:639-644` — change `.catch((err) => logger.error(...))` to `.catch((err) => { logger.error(...); throw err; })`; callers already have outer try/catch for other failures. (medium)
- [ ] **B084** [S] `llmSpendingGate.ts:208-209` — on transient DB error, write `this.killSwitchCache = { value: true, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS }` before throwing, so the TTL caches the fail-closed state. (medium)
- [ ] **B108** [S] `fixtures/base.ts:40-42` — wrap `page.unrouteAll({behavior:'wait'})` in `Promise.race([..., timeout(5000)])`; fall back to `{behavior:'ignore'}` on timeout. (medium)
- [ ] **B082** [S] *(relocated from Phase 4)* `llmSpendingGate.ts:292-299` — docs-only item: add a paragraph to `evolution/docs/cost_optimization.md` explaining that the module-level `LLMSpendingGate` singleton is per-Vercel-container, so cache state diverges across cold starts; the RPC (`check_and_reserve_llm_budget`) remains the authoritative gate. Switch to KV/Redis only if concrete over-spend is observed. **Observability spike**: also add a one-time Honeycomb dashboard link (or saved query) that tracks the ratio of `reserved_before_rpc_spend / rpc_spend` over a 7-day window — if the ratio exceeds 1.05 for any day, the singleton-divergence hypothesis has evidence and the KV/Redis migration should be scheduled. No code change in this PR. (medium)

### Phase 6: Cost attribution & orchestrator (8 bugs)

- [ ] **B003** [S] `runIterationLoop.ts:473-484` — change guard to `if (parallelSuccesses === 0) actualAvgCost = estPerAgent`; don't gate on the value itself (medium)
- [ ] **B011** [S] `runIterationLoop.ts:204-205` — `randomSeed = options?.randomSeed ?? BigInt(crypto.getRandomValues(new BigUint64Array(1))[0])` (medium)
- [ ] **B012** [S] `rankNewVariant.ts:64,79` — change the `costTracker` parameter type from `CostTrackerLike` to strict `AgentCostScope`; drop the `getOwnSpent?.() ?? getTotalSpent()` fallback; remove `getTotalSpent` from the `AgentCostScope` type entirely. **Depends on B048 + B053 landing first in this same phase**: those two establish `evolution_agent_invocations.cost_usd` as the authoritative per-invocation cost, which is what `getOwnSpent()` returns. Until B053 lands, `getTotalSpent()` is still the only accurate cost source for some paths, so the B012 fallback can't be removed. Ship order within Phase 6: `B048 migration → B053 dual-write switch → B012 type-boundary tightening`. TypeScript's structural typing will catch any caller still relying on `getTotalSpent` on the scope type (TS2551 "property does not exist"); reviewer does not need a separate exhaustiveness pass. (medium)
- [ ] **B047** [S] `core/Agent.ts:76` — move `startMs = Date.now()` to be the first statement in `run()`, before `createInvocation` and before the per-invocation LLM-client construction (medium)
- [ ] **B048** [S] `agents/generateFromPreviousArticle.ts` + `Agent.ts:99` — add `variant_surfaced boolean DEFAULT NULL` column to `evolution_agent_invocations` via a new migration named `YYYYMMDDHHMMSS_add_variant_surfaced_to_evolution_agent_invocations.sql` (timestamp-at-PR-time, matching the existing convention in `supabase/migrations/`). UP: `ALTER TABLE evolution_agent_invocations ADD COLUMN variant_surfaced boolean;`. DOWN: `ALTER TABLE evolution_agent_invocations DROP COLUMN IF EXISTS variant_surfaced;`. RLS: no change needed — `service_role_all` (migration `20260321000001_evolution_service_role_rls.sql`) and `readonly_select` (migration `20260318000001_evolution_readonly_select_policy.sql`) apply to the whole table and therefore the new column inherits them; cite these two migrations in the PR description. Write `true` on surface, `false` on discard in `Agent.run()`. NULL = historic rows (pre-migration); treat as opaque — **tactic-cost rollups filter `variant_surfaced IS NOT FALSE`** (which keeps both new-true and historic-NULL, excludes only new-false discards; this preserves the old rollup behavior for historic data). Ships atomically with B053 in Phase 6. (medium)
- [ ] **B050** [T] `MergeRatingsAgent.ts` + `Agent.ts:86-89` — test first: simulate `BudgetExceededWithPartialResults` mid-merge; assert the persisted `cost_usd` equals the partial-merge cost, not 0. Then in `Agent.run`'s catch block, if the error carries partial-results metadata, use that cost instead of `detail?.totalCost ?? 0`. (medium)
- [ ] **B052** [S] `experimentMetrics.ts:363-368` — change the attribution query to `.or('agent_invocation_id.not.is.null,parent_variant_id.not.is.null')`; join on `parent_variant_id` in the aggregation path for rows where `agent_invocation_id` is null. (medium)
- [ ] **B053** [S] `Agent.ts:88-89` vs `persistRunResults.ts:213-270` — pick **invocation `cost_usd`** as the authoritative column (already aggregates gen+ranking). **Caller audit is mandatory**: run `grep -rn "variant\.cost_usd\|variants?\.cost_usd" evolution/src/ src/` at HEAD, paste the list into the PR description. Each hit must be annotated `SWITCH` (migrated to invocation sum) or `KEEP` (with a one-line justification). **Definition of done**: every grep hit has `SWITCH` or `KEEP` in the PR description; no unannotated hits. Update `evolution_variants.cost_usd` writer to persist the per-variant gen+ranking cost (parity during the transition); switch tactic-cost rollups to `SELECT SUM(cost_usd) FROM evolution_agent_invocations WHERE agent_name = ? AND variant_surfaced IS NOT FALSE` (ships atomically with B048 in Phase 6). **Transition timeline, with deadline**: the dual-write on `evolution_variants.cost_usd` remains in place through Phase 6 + Phase 7 and **must be removed within 30 days** of the B053 merge via a follow-up PR. When B053 merges, **file a GitHub issue tagged `tech-debt` titled "Remove dual-write on evolution_variants.cost_usd (post-B053 cleanup)"** with due date = merge-date + 30 days, link the merge commit, and assign to the B053 author. Success criteria to close the issue: `SELECT COUNT(*) FROM evolution_runs WHERE created_at < '<B053-merge-timestamp>' AND status IN ('pending','claimed','running')` returns 0 (all pre-B053 runs have finalized). Until the cleanup PR lands, readers can fall back to `variant.cost_usd` if invocation `cost_usd` is NULL (historic rows). (medium)

### Phase 7: Comparison cache & rating enforcement (8 bugs)

- [ ] **B029** [S] `computeRatings.ts:186-191` — when `hA === hB`, return the key `\`${hA}|identical|${structured}|${mode}\`` instead of `\`${hA}|${hB}|...\`` (high)
- [ ] **B032** [T] `computeRatings.ts:197-214` — cache-churn test first (set-existing-key then assert hot key isn't evicted before cold); then change `set()` to always `cache.delete(key); cache.set(key, result)` (medium)
- [ ] **B033** [S] `computeRatings.ts:400-402` — `>= 0.3` instead of `> 0.3` (medium)
- [ ] **B036** [S] `enforceVariantFormat.ts:30-36` — count backtick fences; only apply greedy fallback if count is odd; otherwise leave text untouched (low)
- [ ] **B037** [T] `enforceVariantFormat.ts:117-119` — env-reload test first (mutate `process.env` mid-test); then capture `FORMAT_VALIDATION_MODE` at module load into a const (low)
- [ ] **B038** [T] `computeRatings.ts:69-84` — run `npm run query:prod -- "SELECT COUNT(*) FROM evolution_variants WHERE mu > 200"` to audit how often the clamp actually triggers. If count > 0, document the display/internal split clearly in `rating_and_comparison.md` with a UI note; no code change. If count = 0, narrow the clamp range. (medium)
- [ ] **B039** [S] `comparison.ts:338-341` vs `computeRatings.ts:186-191` — delete the one-off `makeCacheKey` in `comparison.ts`; route all callers through `ComparisonCache.makeKey` (low)
- [ ] **B040** [S] `computeRatings.ts:197-202` — cache deterministic unparseable pairs with a short TTL (5 min) sentinel so the next call doesn't re-LLM (medium)

### Phase 8: Admin UI (7 bugs)

- [ ] **B094** [S] `LineageGraph.tsx:154-156` — store the d3 zoom behavior in a `useRef`; in the cleanup return, `if (zoomRef.current) zoomRef.current.on('.zoom', null)` synchronously (medium)
- [ ] **B095** [S] `AutoRefreshProvider.tsx:76-80` — add `window.addEventListener('pageshow', handleVisibilityChange)` alongside the existing visibilitychange listener; clean up both on unmount (medium)
- [ ] **B096** [S] `FormDialog.tsx:170-178` — on `parseFloat(…) === NaN`, set a field-level error state, don't propagate to submit (medium)
- [ ] **B097** [S] `EntityListPage.tsx:115-121` — in controlled mode, add `useEffect(() => rebuildDefaults(), [filters])` that re-applies `defaultChecked` when the `filters` prop identity changes (medium)
- [ ] **B098** [S] `src/app/admin/evolution/arena/page.tsx:53,90` — extend the initial `filterValues` state to include `hideEmpty: 'false'`; plumb into the existing checkbox `onChange` (medium)
- [ ] **B100** [S] `ExperimentForm.tsx:205-211` — on step-N back-nav, clear `strategiesPicked`/`budgetCapUsd` state for steps > N (low)
- [ ] **B101** [S] `EntityTable.tsx:87` — make `id: string` a required column on `EntityTable`'s generic; change the fallback `i` to a thrown error with a message pointing to the missing `id` (medium)

### Phase 9: Testing infrastructure (8 bugs)

- [ ] **B102** [S] `v2MockLlm.ts:49-50` — on queue exhaustion throw `new Error(\`v2MockLlm ranking queue exhausted; tests must pre-populate expected responses\`)` (high)
- [ ] **B103** [T] `service-test-mocks.ts:96-97` — assertion test first: `.order('col', {ascending: false}).data` should return rows sorted desc; then implement proper ascending-aware ordering in the mock. (medium)
- [ ] **B107** [S] `fixtures/auth.ts:107-109` — on Playwright `test.info().retry > 0`, force re-auth regardless of cached-session age (medium)
- [ ] **B111** [S] `service-test-mocks.ts:30-39` — `setupServiceActionTest()` should reset `supabaseInstance = null` before any per-test mock setup (medium)
- [ ] **B113** [S] `scripts/cleanup-specific-junk.ts:193-218` — wrap the `.select()` in a `while(hasMore)` loop with `.range(from, from+999)` offsets until the API returns < 1000 rows (medium)
- [ ] **B115** [T] `jest.shims.js` — add a runtime sentinel export `export const SHIMS_LOADED = true;`; in `jest.setup.js` first line, `assert(require('./jest.shims.js').SHIMS_LOADED, 'jest.shims.js must load before jest.setup.js')` (low)
- [ ] **B116** [S] `playwright.config.ts:170` — apply `grepInvert: /@skip-prod/` unconditionally (remove the `isProduction` gate); `@skip-prod` tests have always needed to be skipped regardless of target URL (low)
- [ ] **B117** [S] `global-teardown.ts:27` — read `PINECONE_VECTOR_DIMENSION` env var (default 3072); use it for the dummy vector (low)

### Phase 10: Agent internals & small logic (10 bugs — B061 moved to pre-flight)

- [ ] **B054** [T] `core/agentRegistry.ts:16` + `entityRegistry.ts:26` — cross-test-mocking integration test first; then replace the dynamic `require` with a static import at the module top (low)
- [ ] **B062** [S] `services/costAnalytics.ts:479-488` — always write an audit log entry on non-dry runs; success flag in the payload (low)
- [ ] **B087** [S] `src/middleware.ts:21` — remove `api/evolution` from the negative lookahead in the matcher; evolution API routes then run `updateSession` like other protected paths (medium)
- [ ] **B091** [S] `.github/workflows/ci.yml:173-180` — gate `generate-types` auto-commit on a non-empty `git diff`; on change, post a PR comment instead of force-pushing silently (low)
- [ ] **B092** [S] `src/app/admin/evolution/layout.tsx:1-13` — convert to a server component that awaits `requireAdmin()`; redirects on revocation (low)
- [ ] **B118** [S] `swissPairing.ts:71` — change the comparator to `(a, b) => b.score - a.score || (a.idA + a.idB).localeCompare(b.idA + b.idB)` (medium)
- [ ] **B119** [T] `runIterationLoop.ts:410` + `rankNewVariant.ts:85` — integration test first: seed 20 arena entries at Elo `[1500, 1550, ..., 2500]` (inflated), dispatch a generate iteration with an empty in-run pool, assert ≥ 1 generated variant passes the local `top15Cutoff` (under the buggy formula all would be discarded). Then in `runIterationLoop.ts:410`, filter arena entries from `initialPoolSnapshot` before passing to the agent: `const inRunPoolSnapshot = initialPoolSnapshot.filter(v => !v.fromArena)`. (high)
- [ ] **B120** [S] `selectTacticWeighted.ts:50` — change `<` to `<=` (low)
- [ ] **B121** [S] `rankSingleVariant.ts:108` — **breaking test change.** Replace the formula at line 108 — `Math.max(0, Math.floor(elos.length * TOP_PERCENTILE) - 1)` — with `Math.floor(elos.length * (1 - TOP_PERCENTILE))`. The existing locking test at `rankSingleVariant.test.ts:77-89` asserts the buggy formula ("returns the top-15% (top 1 of 7) elo" for N=7, expecting `elos[0]`). **This test must be updated, not augmented.** Replace the single assertion at line ~87 with two new assertions: for a sorted-ascending elos array of length 7, `computeTop15Cutoff` returns `elos[5]`; for length 3, returns `elos[2]`. Delete the comment at ~line 85-86 that justifies the old formula. Cite the old test line range in the PR description and flag the change as "expected test update, not regression." (medium)
- [ ] **B123** [S] `resolveParent.ts:43-51` — distinguish the two fallback reasons: log `'missing_cutoff_config'` when `qualityCutoff` is undefined but pool has eligible candidates; `'empty_pool'` only when the candidate pool is genuinely empty (low)

## Rollback & Backward Compatibility

### Phase 1 (Zod refinements + SQL guards)

- **Zod refinement rollback**: Zod changes are additive on *write* paths. Revert via `git revert` of the Phase 1 PR. Pre-existing rows persisted before Phase 1 are not re-validated on write-path revert because inserts only apply the schema; reads use `.passthrough()` or explicit `.safeParse()` in most paths.
- **Historic-run compatibility** (pre-flight item): add `onError: 'log-and-skip'` wrapping to any `safeParse()` call on the hot read paths for `mu`/`sigma`/`elo_score` before Phase 1 lands. Any existing row with NaN/Infinity is surfaced via logs, not a thrown exception.
- **SQL migration rollback (B068, B073, B077)**: each migration ships with an explicit DOWN migration. If Phase 1 must roll back after deploy, `supabase migration down --count 3` restores the prior RPC bodies.

### Phase 3 (metric cascade + chunking)

- **Cascade logic rollback (B041, B042)**: revert the `markParentMetricsStale` diff. Rows already marked stale remain stale (soft flag); the read-path lazy recompute eventually clears them. No data migration required.
- **Chunk API contract change (B043)**: this is a *breaking* API change to `readMetrics.ts`. Mitigation: the PR must include an audit of all callers (`grep -rn 'getMetricsForEntities(' evolution/ src/`) and update each in the same PR. Ship as one atomic commit so revert is clean.
- **Tactic chunking (B044)**: pure behavior-only change; safe to revert anytime.

### Phase 6 (cost attribution)

- **B048 migration** (new `variant_surfaced` column): DOWN migration drops the column; tactic rollups revert to the old formula. Existing rows stay.
- **B053 column authority switch**: changes read paths but writes stay on both columns during the transition; safe to revert.

### Other phases

All other phases are logic-only or test-infrastructure changes; rollback is `git revert`.

### Caller-audit PR description template (used by B043, B053, B079)

When a fix requires enumerating every caller of a symbol, the PR description must include a code block in this format:

```
## Caller audit: <bug-id>
Command: grep -rn "<pattern>" <paths>

Results:
<file>:<line>   <CODE>   — <one-line justification>
<file>:<line>   <CODE>   — <one-line justification>
...
```

Valid response codes by bug:
- **B043** (`getMetricsForEntities` return shape): `IGNORE` (drop errors array, add code comment), `LOG` (log + continue), `PROPAGATE` (return/throw upward)
- **B053** (`variant.cost_usd` reads): `SWITCH` (moved to invocation-sum), `KEEP` (variant read intentional, justification in code comment)
- **B079** (`/api/evolution/run` POST body): `ADD_TO_SCHEMA` (field valid, add to `runRequestSchema`), `DROP` (field never honored, caller updated)

**Approval blocker**: every grep hit must have a response code inline in the PR description. Unannotated lines block merge.

## Testing

### Test Coverage Matrix (88 bugs → test file)

Every bug has a named test file or explicit `manual/docs` with rationale. `(new)` = file created by this plan.

**Phase 1 (12)**:

| ID | Test file | Type |
|----|-----------|------|
| B028, B063, B065, B066, B071, B072, B074, B075, B088 | `evolution/src/lib/schemas.test.ts` | unit |
| B068, B073, B077 | `src/__tests__/integration/evolution-rpc-guards.integration.test.ts` (new) | integration |

**Phase 2 (10)**:

| ID | Test file | Type |
|----|-----------|------|
| B017, B020 | `evolution/src/lib/pipeline/infra/trackBudget.test.ts` | unit |
| B021 | `src/config/llmPricing.test.ts` | unit |
| B019, B086, B089, B084 | `src/lib/services/llmSpendingGate.test.ts` | unit |
| B018, B022, B027 | `evolution/src/lib/pipeline/infra/costCalibrationLoader.test.ts` | unit |
| B024 | `evolution/src/lib/pipeline/infra/costCalibrationLoader.race.integration.test.ts` (new) | integration |

**Phase 3 (6)**:

| ID | Test file | Type |
|----|-----------|------|
| B041, B042 | `src/__tests__/integration/evolution-metrics-cascade.integration.test.ts` (new) | integration |
| B043 | `src/__tests__/integration/evolution-metrics-chunk-failure.integration.test.ts` (new) | integration |
| B044 | `src/__tests__/integration/evolution-metrics-tactic-scale.integration.test.ts` (new) | integration |
| B045 | `evolution/src/experiments/evolution/experimentMetrics.property.test.ts` | unit (property) |
| B046 | `src/__tests__/integration/evolution-metrics-recompute.integration.test.ts` (new) | integration |

**Phase 4 (7)**:

| ID | Test file | Type |
|----|-----------|------|
| B056 | `src/__tests__/integration/evolution-processrunqueue-roundrobin.integration.test.ts` (new) | integration |
| B060 | `src/__tests__/integration/evolution-watchdog.integration.test.ts` (new) | integration |
| B082 | `evolution/docs/cost_optimization.md` | docs (rationale in pre-flight) |
| B104, B105 | `src/__tests__/integration/evolution-test-factory-worker-race.integration.test.ts` (new) | integration |
| B109 | `src/__tests__/e2e/setup/global-setup.test.ts` (new; unit) | unit |
| B122 | `src/__tests__/integration/evolution-merge-arena-race.integration.test.ts` (new) | integration |

**Phase 5 (11)**:

| ID | Test file | Type |
|----|-----------|------|
| B008 | `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` | unit |
| B034 | `evolution/src/lib/shared/computeRatings.test.ts` | unit |
| B035 | `evolution/src/lib/shared/selectWinner.test.ts` | unit |
| B051 | `evolution/src/lib/core/Agent.test.ts` | unit |
| B057 | `evolution/src/services/costAnalytics.test.ts` (new or existing) | unit |
| B079, B081 | `src/app/api/evolution/run/route.test.ts` (new) | unit |
| B080 | `src/lib/requestIdContext.test.ts` (new) | unit |
| B083 | `src/lib/services/llms.test.ts` | unit |
| B108 | manual: verify via existing `@critical` E2E run after B108 lands — if the suite speeds up under forced-fail scenarios, fix worked | manual |

**Phase 6 (8)**:

| ID | Test file | Type |
|----|-----------|------|
| B003, B011 | `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` | unit |
| B012 | `evolution/src/lib/pipeline/loop/rankNewVariant.test.ts` | unit |
| B047, B048 | `evolution/src/lib/core/Agent.test.ts` | unit |
| B050 | `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` | unit |
| B052 | `evolution/src/experiments/evolution/experimentMetrics.test.ts` | unit |
| B053 | `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` (existing) | integration (extend existing) |

**Phase 7 (8)**:

| ID | Test file | Type |
|----|-----------|------|
| B029, B032, B033, B040 | `evolution/src/lib/shared/computeRatings.test.ts` | unit |
| B036, B037 | `evolution/src/lib/shared/enforceVariantFormat.test.ts` | unit |
| B038 | manual: `npm run query:prod` audit documented in PR description; no code change if count=0 | manual |
| B039 | `evolution/src/lib/comparison.test.ts` (new if absent) | unit |

**Phase 8 (7 — all E2E, all tagged `@evolution`, all require `afterAll(cleanupAllTrackedEvolutionData)`)**:

| ID | Test file | Type |
|----|-----------|------|
| B094 | `src/__tests__/e2e/specs/09-admin/admin-evolution-lineage-graph.spec.ts` (new) | E2E |
| B095 | `src/__tests__/e2e/specs/09-admin/admin-evolution-autorefresh-back-nav.spec.ts` (new) | E2E |
| B096 | `src/__tests__/e2e/specs/09-admin/admin-evolution-form-validation.spec.ts` (new) | E2E |
| B097 | `src/__tests__/e2e/specs/09-admin/admin-evolution-filter-defaults.spec.ts` (new) | E2E |
| B098 | `src/__tests__/e2e/specs/09-admin/admin-evolution-arena-filters.spec.ts` (new) | E2E |
| B100 | extend existing `admin-evolution-experiment-wizard-e2e.spec.ts` | E2E |
| B101 | `src/__tests__/e2e/specs/09-admin/admin-evolution-table-resort.spec.ts` (new) | E2E |

**Phase 9 (8)**:

| ID | Test file | Type |
|----|-----------|------|
| B102 | `evolution/src/testing/v2MockLlm.test.ts` (new) | unit |
| B103, B111 | `evolution/src/testing/service-test-mocks.test.ts` (new) | unit |
| B107 | manual: verify under `--retries=3` CI run | manual |
| B113 | `scripts/cleanup-specific-junk.test.ts` (new) | unit |
| B115 | `jest.shims.test.js` (new; asserts SHIMS_LOADED sentinel before setup) | unit |
| B116 | manual: run `npm run test:e2e -- --grep @skip-prod` locally, assert skipped | manual |
| B117 | `evolution/src/testing/global-teardown.test.ts` (new; asserts env-var read) | unit |

**Phase 10 (10)**:

| ID | Test file | Type |
|----|-----------|------|
| B054 | `src/__tests__/integration/evolution-agent-registry.integration.test.ts` (new) | integration |
| B062 | `evolution/src/services/costAnalytics.test.ts` | unit |
| B087 | `src/middleware.test.ts` (new) | unit |
| B091 | manual: CI workflow dry-run on a test PR | manual |
| B092 | `src/__tests__/e2e/specs/09-admin/admin-evolution-post-revocation.spec.ts` (new; `@evolution`, `afterAll` cleanup) | E2E |
| B118 | `evolution/src/lib/pipeline/loop/swissPairing.test.ts` | unit |
| B119 | `src/__tests__/integration/evolution-pool-arena-cutoff.integration.test.ts` (new) | integration |
| B120 | `evolution/src/lib/core/tactics/selectTacticWeighted.test.ts` | unit |
| B121 | `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` (existing test needs update — see Phase 10 note on B121) | unit |
| B123 | `evolution/src/lib/pipeline/loop/resolveParent.test.ts` (existing or new) | unit |

**Pre-flight (3)**:

| ID | Test file | Type |
|----|-----------|------|
| B061 | `evolution/src/services/adminAction.test.ts` | unit |
| (version pin) | `package.json` + `npm ls @supabase/supabase-js` assert in CI | CI |
| (historic Zod tolerance) | `evolution/src/lib/schemas.test.ts` (round-trip NaN rows in safeParse with log-and-skip) | unit |

### CI tag assignments (new E2E specs)

All 7 new specs in `src/__tests__/e2e/specs/09-admin/` carry `{ tag: '@evolution' }`. They run:
- on PRs to `production` (full suite, `ci.yml` path) — blocking merge
- on nightly production runs (`e2e-nightly.yml`) — non-blocking but visible
- **Not** on PRs to `main` (which run only `@critical`).

This matches existing project convention: `@critical` is the fast-feedback lane for main-PRs; `@evolution` is the comprehensive lane for production-PRs. See `docs/docs_overall/testing_overview.md` lines ~229-244.

**Main-PR safety net**: to avoid a regression hitting main without E2E coverage, two of the new specs carry an **additional** `@critical` tag so they also run on main PRs:
- `admin-evolution-arena-filters.spec.ts` — covers the dead-filter bug B098 (most user-visible)
- `admin-evolution-post-revocation.spec.ts` — covers B092 (security-adjacent)

The remaining 5 specs are `@evolution` only.

Specs: `admin-evolution-lineage-graph`, `admin-evolution-autorefresh-back-nav`, `admin-evolution-form-validation`, `admin-evolution-filter-defaults`, `admin-evolution-arena-filters` (`+@critical`), `admin-evolution-table-resort`, `admin-evolution-post-revocation` (`+@critical`).

### Mandatory `afterAll` cleanup on all new E2E specs

Every new spec that imports from `evolution-test-data-factory` or seeds evolution entities **must** include:

```ts
import { cleanupAllTrackedEvolutionData } from '../../helpers/evolution-test-data-factory';

test.afterAll(async () => {
  await cleanupAllTrackedEvolutionData();
});
```

ESLint rule `flakiness/require-test-cleanup` will block merge without it.

### Manual Verification

- **B053** cost-attribution reconciliation: tail `llmCallTracking` vs `evolution_agent_invocations` vs `evolution_metrics` for one live run; assert `cost`/`generation_cost`/`ranking_cost` match within 1 %.
- **B082** cold-start divergence: run two concurrent `/api/evolution/run` requests on a fresh Vercel cold start; inspect singleton cache state in a debug log.
- **B038** display-clamp audit: `npm run query:prod -- "SELECT COUNT(*) FROM evolution_variants WHERE mu > 200"`.
- **B091** CI auto-commit: dry-run the workflow on a test PR with and without a type change.
- **B107** Playwright retry auth: force an `@critical` spec to fail twice, confirm re-auth on retry 2.
- **B116** local `@skip-prod` filter: run `npm run test:e2e:evolution -- --grep @skip-prod` and confirm 0 tests executed.

## Verification

### A) Playwright Verification (required for UI + auth changes)

- [ ] `npm run test:e2e:evolution` — full `@evolution` tag suite on local build
- [ ] Each new spec file listed in Phase 8 + Phase 10 runs green individually
- [ ] `npm run test:e2e -- --grep @skip-prod` returns 0 tests (B116)

### B) Automated Tests

- [ ] `cd evolution && npx vitest run` — all evolution unit suites pass
- [ ] `npm run test:integration -- --testPathPattern=evolution` — all integration suites pass (existing + 11 new)
- [ ] `npm run typecheck` — no TS regressions (B012 type-boundary change may surface new errors; fix them in the same PR)
- [ ] `npm run lint` — no new violations; in particular `flakiness/require-test-cleanup` passes on all new specs
- [ ] `npm run build` — Next build succeeds

### C) Schema / migration checks

- [ ] `npx supabase db diff --linked` — clean after each migration
- [ ] `npx supabase migration up --local` then `down --count N` — rollback cleanly for B068/B073/B077/B048

## Documentation Updates

- [ ] `evolution/docs/cost_optimization.md` — updated `reserve()` validation, monthly fast-path refresh, phase-sentinel calibration fallback, seed-cost-by-phase key, singleton-scope note (Phase 2 + B082)
- [ ] `evolution/docs/metrics.md` — extended stale cascade to dynamic prefixes, chunk-partial-failure return shape, > 100-run chunking, Box-Muller RNG invariant, recompute re-mark semantics (Phase 3)
- [ ] `evolution/docs/rating_and_comparison.md` — identical-text cache disambiguation, ≥ 0.3 partial-failure caching, `selectWinner` no-rated-candidates contract, unified cache-key strategy, small-N cutoff correction (Phase 7 + B121), internal-vs-display elo distinction (B038)
- [ ] `evolution/docs/architecture.md` — seed-failed run transition, `AgentCostScope` type-boundary invariant, swiss tiebreaker, arena-filtered cutoff pool (Phase 4, 6, 10 + pre-flight)
- [ ] `evolution/docs/data_model.md` — Zod refinements + CHECK constraints, `tactic` column in invocation schema (B074), new `variant_surfaced` column on invocation (B048)
- [ ] `evolution/docs/arena.md` — `prompt_id`-at-insert rule for in-run `evolution_arena_comparisons` (B122)
- [ ] `evolution/docs/agents/overview.md` — `Agent.run()` duration-start rule (B047), detail-invalid marker (B051), partial-results cost rule (B050), variant-surfaced flag (B048)

## Review & Discussion

*Populated by `/plan-review` with agent scores, reasoning, and gap resolutions per iteration.*

### Iteration 1 (2026-04-22)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 5 (B019 fast-path, B024 sentinel, B121 test, B119 oracle, Supabase pin) |
| Architecture & Integration | 3/5 | 8 (B061 ordering, B012 invariant, dynamic prefix enum, cost-column authority, race-test ordering, B019+B086 atomicity) |
| Testing & CI/CD | 1/5 | 7 (48 bugs unmapped, 11 test files absent, 4 NEEDS-TEST underspec, no rollback, no CI tags, no cleanup) |

Resolutions landed in this revision:
- Added **Pre-flight Checks** section (Supabase pin, B061 ahead of B057, B012 AgentCostScope invariant, historic-run Zod tolerance, B019+B086 atomicity note)
- **Tightened fix descriptions** for B017, B019, B022, B024, B027, B029, B034, B035, B045, B050, B051, B057, B079, B080, B081, B083, B084, B091, B092, B103, B118, B119, B121, B122, B123
- Added full **Test Coverage Matrix** — 88 bugs, each mapped to unit/integration/E2E/manual with named file paths
- Added **Rollback & Backward Compatibility** section for Phase 1/3/6 schema changes
- Added **CI tag assignments** for 7 new E2E specs (`@evolution`)
- Added **mandatory `afterAll` cleanup** requirement for all new E2E specs that seed evolution data
- Added **schema/migration checks** (section C) in Verification
- Reordered **Phase 4** into two sub-PRs: infra-race first (B104, B105, B109), then functional-race (B056, B060, B122). B082 subsequently relocated to Phase 5 (docs-only observability item).

### Iteration 2 (2026-04-22)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 2/5 | 4 — B019 fast-path bypass, B024 implementation gap, B121 test codifies buggy formula, B012 invariant ordering |
| Architecture & Integration | 2/5 | 5 — B043 caller-audit strategy, B048 migration missing, B012 enforcement timing, Phase 4 sub-PR gating, B053 caller audit |
| Testing & CI/CD | 2/5 | 7 — 11 test files don't exist, 4 NEEDS-TEST underspec'd, no rollback, no CI tags, no cleanup |

Key finding: Security/Architecture reviewers flagged "code still has bug" as critical gaps — a plan-vs-execution category error. Added **`Plan vs Execution State`** note at the top of the plan to head this off.

Resolutions landed in iteration 3:
- Tightened B019 (explicit line target for `checkMonthlyCap` move), B024 (3-state machine + `FAILED_RETRY_MS`), B121 (test-update scope explicit), B048 (migration file naming + DDL + RLS citations), B079 (Zod schema declaration), B086 (both operator line citations), B053 caller-audit + dual-write timeline.
- Made Pre-flight a **hard gate** with sign-off + escalation semantics.
- Phase 4 split into Sub-PR 1 (infra-race) and Sub-PR 2 (functional-race); Sub-PR 2 branches from post-merge `main`.
- Added **main-PR safety net**: B098 and B092 dual-tagged `@critical + @evolution` so they run on main PRs too.

### Iteration 3 (2026-04-22)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 7 — B019/B048/B024 spec ambiguity, B086 line citation, B079 schema, B121 scope, B019+B086 atomicity gate |
| Architecture & Integration | 2/5 | 6 — B019+B086 line target, B048+B053 rollback semantics, caller-audit ops, Phase 4 branch timing, B053 transition, B041 SQL impl |
| Testing & CI/CD | 5/5 | 0 |

Resolutions landed in iteration 4:
- B019: explicit target location (move `checkMonthlyCap` before the daily-cache headroom test).
- B024: full `InflightState` discriminated-union spec with `FAILED_RETRY_MS = 30_000`.
- B048: migration DDL UP/DOWN + RLS citations + historic-NULL handling via `IS NOT FALSE`.
- B079: inline schema declaration.
- B086: exact operator at both line 79 and 271.
- B121: flagged as expected breaking test change with line-specific instructions.
- B043: caller-audit mandate with inline response codes; TS structural typing as exhaustiveness guard.
- B053: caller-audit mandate + transition timeline.
- Phase 4 sub-PR branch-timing: explicit (Sub-PR 2 branches from post-merge `main`, blocked in draft until nightly green).
- B082 relocated: moved to Phase 5 (docs-only).
- B041 implementation: clarified — TS-side `.or()` iteration, no SQL trigger needed.

### Iteration 4 (2026-04-22)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 1 — B079 `.strict()` breaking-change caller audit |
| Architecture & Integration | 3/5 | 4 — B053 indefinite cleanup timeline, B012 phase-6 dependency chain, B043 TS exhaustiveness, caller-audit operational template |
| Testing & CI/CD | 5/5 | 0 |

Resolutions landed in iteration 5:
- B079: caller audit added with `ADD_TO_SCHEMA` / `DROP` response codes.
- B053: 30-day cleanup deadline, GitHub-issue tracking, concrete success criteria SQL.
- B012: explicit Phase 6 ship order `B048 → B053 → B012` with dependency rationale; TS structural typing as exhaustiveness guard.
- B043: TS structural typing cited as automatic exhaustiveness guard.
- Caller-audit: unified **PR description template** added as a new subsection, covering B043 / B053 / B079 with per-bug response codes.
- Phase 4 Sub-PR 2 branch drift > 7 days: explicit rebase rule.
- Pre-flight sign-off: any repo owner; docs-only "CI-green" = lint/typecheck OK; 5-business-day escalation.
- B082: added Honeycomb observability spike (`reserved_before_rpc_spend / rpc_spend` threshold 1.05).

### Iteration 5 (2026-04-22) — ✅ CONSENSUS

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | **5/5** | 0 |
| Architecture & Integration | **5/5** | 0 |
| Testing & CI/CD | **5/5** | 0 |

All three reviewers voted 5/5 with no critical gaps. Plan is ready for execution.

Remaining minor polish items (non-blocking):
- Phase 4 Sub-PR 2 rebase responsibility could name the author explicitly (obvious from context; not a blocker).
- B082 Honeycomb dashboard query is sketched; the Phase 5 PR should include the concrete query in the doc update.
- Pre-flight sign-off could specify "PR CI" vs "manual" for docs-only lint/typecheck (implicit but could be explicit).
