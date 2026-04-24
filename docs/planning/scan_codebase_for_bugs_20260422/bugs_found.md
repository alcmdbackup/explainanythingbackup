# Evolution Codebase Bug Scan — Findings

> Scan initiated 2026-04-22. Reported: 123 candidate findings across 2 scan rounds × 5 parallel Explore agents each, then 2 audit passes (strict read-back + adversarial devil's advocate).
> **Final real bug count: 88** (75 `STANDS` + 13 `NEEDS-TEST`).
> Bug IDs are stable (`B001`+). Severity: `critical | high | medium | low`.
> Round-level exclusion lists already filtered out all prior-documented (`> **Warning:**`, `> **Note:**`, known-fixed, transitional) issues; the final set is original.

## Verdict legend

- **STANDS** — real bug, cited code actually exhibits the claim, and no caller-side invariant / wrapper / test defeats it. Ready to fix.
- **NEEDS-TEST** — real and plausible, but the exact behavior (race, flaky, perf, concurrency edge) is only confirmable by running code. Write a regression test before fixing.
- **STYLE** — real observation, not a functional bug. Note-worthy but not blocking.
- **MISREAD** — first-pass claim was wrong; re-read showed the code does the right thing. Withdrawn.
- **WITHDRAWN (devil's-advocate)** — the final adversarial round found a concrete defeater (caller invariant, framework guarantee, hidden validator). Withdrawn.
- **REMOVED** — previously marked UNCERTAIN; dropped per user direction (2026-04-22).

## Audit pipeline summary

| Phase | Input | CONFIRMED | MISREAD / STYLE / UNCERTAIN / WITHDRAWN |
|-------|-------|-----------|------------------------------------------|
| Round 1 + 2 scan (10 Explore agents) | — | 123 candidates | — |
| Audit pass 1 (strict read-back) | 123 | 109 CONFIRMED | 10 MISREAD + 2 STYLE + 2 UNCERTAIN |
| Audit pass 2 (devil's advocate) | 109 | 75 STANDS + 13 NEEDS-TEST | 21 WITHDRAWN |
| User direction | — | — | 2 UNCERTAIN removed |
| **Final** | | **88 real bugs** | 33 withdrawn + 2 style |

---

## Final real bug list

### Pipeline orchestrator & loop

- **B003** `STANDS` [medium / cost-accuracy] `runIterationLoop.ts:473-484` — `actualAvgCost` fallback fires on falsy `!actualAvgCost`; legitimately cheap batches (measured ≈ 0) get the estimate instead of the measurement. Fix: key the fallback on `parallelSuccesses === 0`.
- **B008** `STANDS` [medium / error-handling] `claimAndExecuteRun.ts:333-340` — seed-variant upsert failure is logged-and-proceed; downstream `syncToArena`/reuse assumes the seed exists. Fix: retry or fail the run.
- **B011** `STANDS` [medium / logic] `runIterationLoop.ts:204-205` — `randomSeed ?? BigInt(0)` makes two concurrent non-seeded runs identical. Fix: generate a seed when none is passed.
- **B012** `STANDS` [medium / logic] `rankNewVariant.ts:64,79` — `getOwnSpent?.() ?? getTotalSpent()` silently recreates the sibling-bleed `AgentCostScope` was designed to prevent. Fix: require `AgentCostScope` at the type boundary.

### Cost tracker, LLM client, spending gate

- **B017** `STANDS` [high / logic] `trackBudget.ts:105-113` — `reserve(phase, estimatedCost)` has no sign/finiteness guard; negative or NaN corrupts `totalReserved`. Fix: assert finite, non-negative.
- **B018** `STANDS` [medium / stale-cache] `costCalibrationLoader.ts:77-86` — on DB refresh error the catch block still advances `state.lastRefreshedAtMs = Date.now()`; stale calibration serves for the full TTL. Fix: don't advance the timestamp on error.
- **B019** `STANDS` [medium / logic] `src/lib/services/llmSpendingGate.ts:76-89` — fast path skips the monthly-cap check; stale monthly cache can permit over-spend for a full TTL. Fix: always refresh monthly.
- **B020** `STANDS` [medium / cost-accuracy] `trackBudget.ts:106-107` — float-arithmetic rounding on tight budgets (< $0.10) accumulates error exceeding the safety margin. Fix: integer-cents quantization.
- **B021** `STANDS` [medium / cost-accuracy] `src/config/llmPricing.ts:93-109` — `calculateLLMCost` accepts negative token counts; a provider returning `-1` gives negative spend. Fix: validate non-negative, finite tokens.
- **B022** `STANDS` [medium / logic] `costCalibrationLoader.ts:151-157` — fallback chain widens by tactic/model/judge but never over `phase`; `seed_title`/`seed_article` rows can't rescue a missing `generation` row. Fix: include `phase = SENTINEL`.
- **B024** `STANDS` [medium / race] `costCalibrationLoader.ts:124-131` — promise coalescing clears `state.inflight = null` in `.finally`; a caller in the microsecond gap starts a duplicate fetch. Fix: local lock / failed sentinel.
- **B027** `STANDS` [medium / cost-accuracy] `core/agentNames.ts:14-19` + `scripts/refreshCostCalibration.ts:165` — `seed_title` and `seed_article` both map to `seed_cost`, but the calibration key loses the phase distinction. Fix: key consistently.

### Ratings, comparison, arena

- **B028** `STANDS` [high / zod-validation] `schemas.ts:226-228` — `ratingSchema.elo` is bare `z.number()`; `uncertainty` is `z.number().positive()` which accepts Infinity. Fix: `.refine(Number.isFinite)` on both.
- **B029** `STANDS` [high / logic] `computeRatings.ts:186-191` — `ComparisonCache.makeKey` collides on `textA === textB`; self-comparisons always reuse the first cached result. Fix: disambiguate identical-text.
- **B032** `NEEDS-TEST` [medium / resource-leak] `computeRatings.ts:197-214` — `ComparisonCache.set` on an existing key updates in-place; eviction drops oldest-inserted even if hot. Not true LRU. Needs cache-churn test before fixing. Fix: `cache.delete(key); cache.set(key, result)`.
- **B033** `STANDS` [medium / logic] `computeRatings.ts:400-402` — caches only `confidence > 0.3`; partial-failure results (exactly `0.3`) re-query forever. Fix: `≥ 0.3`.
- **B034** `NEEDS-TEST` [medium / error-handling] `computeRatings.ts:99-111, 117-128` — `updateRating`/`updateDraw` silently return inputs on malformed `osRate` output; match counts advance but ratings don't. Needs a malformed-response test before fixing. Fix: throw with diagnostic.
- **B035** `STANDS` [medium / error-handling] `selectWinner.ts:23-46` — returns `{elo: -Infinity, uncertainty: Infinity}` for pools of unrated variants; DB NUMERIC accepts Infinity → NaN in PG. Fix: clamp or fail-fast.
- **B036** `STANDS` [low / logic] `enforceVariantFormat.ts:30-36` — unclosed-fence fallback `/```[\s\S]*$/` greedily strips everything after a lone opening fence. Fix: check fence parity first.
- **B037** `NEEDS-TEST` [low / logic] `enforceVariantFormat.ts:117-119` — `FORMAT_VALIDATION_MODE` re-read on every call; env reloads flip validation mid-run. Needs env-reload test. Fix: capture at module load.
- **B038** `NEEDS-TEST` [medium / cost-accuracy] `computeRatings.ts:69-84 vs 80-84` — `dbToRating` unclamped vs `ratingToDb.elo_score` clamped `[0, 3000]`; leaderboard display diverges from `mu`. Needs a real-data audit.
- **B039** `STANDS` [low / logic] `comparison.ts:338-341` vs `computeRatings.ts:186-191` — two cache-key strategies coexist: order-dependent vs order-invariant. Fix: unify.
- **B040** `STANDS` [medium / logic] `computeRatings.ts:197-202` — `ComparisonCache.set` refuses to cache `winnerId === null` pairs; deterministic unparseable inputs burn tokens forever. Fix: short-lived sentinel.

### Metrics registry, entity/agent layer

- **B041** `STANDS` [high / stale-cache] `core/Entity.ts:195-206` — `markParentMetricsStale` walks propagation defs only; `eloAttrDelta:*`, `eloAttrDeltaHist:*`, and tactic metrics are never flagged on variant change. Fix: extend cascade to dynamic prefixes.
- **B042** `STANDS` [high / stale-cache] *(tactic cascade)* — no registry edge from variant → tactic; tactic metrics read variants but no trigger marks their rows stale on rating drift. Fix: add a cascade hook.
- **B043** `NEEDS-TEST` [high / sql-rpc] `lib/metrics/readMetrics.ts:59-93` — `getMetricsForEntities` chunk loop throws on mid-chunk error, discarding earlier successes. Needs a chunk-failure integration test before fixing.
- **B044** `NEEDS-TEST` [high / sql-rpc] `lib/metrics/computations/tacticMetrics.ts:45-52` — `.in('id', runIds.slice(0, 100))` hard-caps at 100 runs. Needs a >100-run scenario test.
- **B045** `NEEDS-TEST` [medium / logic] `experimentMetrics.ts:124-139` — Box-Muller branch consumes 2 RNG draws only when `uncertainty > 0`; mixed inputs desynchronize the seeded RNG. Needs a mixed-uncertainty property test.
- **B046** `NEEDS-TEST` [high / race] `lib/metrics/recomputeMetrics.ts:48-65` — on catch the error path re-marks only `claimedNames` stale; if `lock_stale_metrics` returned `[]`, partially-written metrics stay `stale=false`. Needs a partial-failure integration test.
- **B047** `STANDS` [medium / logic] `core/Agent.ts:76, 63-73` — `startMs = Date.now()` captured *after* LLM client construction. Fix: capture first statement in `run()`.
- **B048** `STANDS` [medium / logic] `agents/generateFromPreviousArticle.ts` + `Agent.ts:99` — discarded variants persist with `persisted=false` but invocation stays `success=true`; cost aggregations count completed-but-useless invocations. Fix: `variant_surfaced` flag, or filter `persisted=true` in tactic cost rollups.
- **B050** `NEEDS-TEST` [medium / cost-accuracy] `agents/MergeRatingsAgent.ts:100-101` + `Agent.ts:86-89` — on `BudgetExceededWithPartialResults` with `usesLLM=false`, cost records as 0. Needs a partial-results-with-MergeRatings test.
- **B051** `STANDS` [medium / zod-validation] `Agent.ts:91-97` — detail schema failure logs a warning and writes `execution_detail: undefined` while invocation stays `success: true`. Fix: mark invocation failed, or add `detail_invalid` flag.
- **B052** `STANDS` [medium / logic] `experimentMetrics.ts:363-368` — attribution query `.not('agent_invocation_id', 'is', null)` excludes legacy/seed variants; attribution metric under-counts. Fix: join via `parent_variant_id` when FK null.
- **B053** `STANDS` [medium / cost-accuracy] `Agent.ts:88-89` vs `persistRunResults.ts:213-270` — invocation `cost_usd` = generation+ranking; variant `cost_usd` = generation-only; tactic rollups understate vs run-level aggregates. Fix: pick one authoritative column.
- **B054** `NEEDS-TEST` [low / logic] `core/agentRegistry.ts:16 + entityRegistry.ts:26` — lazy `getAgentClasses` dynamic `require` latches an empty/mock registry if tests initialize first. Needs an integration test that exercises cross-test isolation.

### Services, scripts, ops, API

- **B056** `STANDS` [high / logic] `scripts/processRunQueue.ts:135-136` — `targets[i % targets.length]` with `i` resetting each outer iteration starves the second target under a load imbalance. Fix: persistent cursor.
- **B057** `STANDS` [medium / error-handling] `services/costAnalytics.ts:61-143` — calls `requireAdmin()` manually inside `withLogging` instead of using `adminAction`, skipping uniform error categorization. Fix: migrate to `adminAction`.
- **B060** `STANDS` [medium / race] `lib/ops/watchdog.ts:49-57` — read-then-update race: status selected, then update gated on `.in('status', […])`; a concurrent transaction can flip status between the two. Fix: use an RPC that locks-and-updates atomically.
- **B061** `STANDS` [low / logic] `services/adminAction.ts:39` — `isZeroArg = handler.length ≤ 1` should be `=== 1`; a default-valued first arg silently mis-routes `ctx`.
- **B062** `STANDS` [low / logic] `services/costAnalytics.ts:479-488` — audit log gated on `!dryRun && totalUpdated > 0`; a non-dry run that fails every update logs nothing. Fix: always audit non-dry runs.

### Zod schemas, migrations, RLS, RPC semantics

- **B063** `STANDS` [high / zod-validation] `schemas.ts:249,252` — `amount_usd`/`available_budget_usd` are bare `z.number()`; NaN/Infinity flow through.
- **B065** `STANDS` [medium / zod-validation] `schemas.ts:158` — variant `generation_method` permits empty strings when non-null.
- **B066** `STANDS` [high / zod-validation] `schemas.ts:155-156` — variant `mu`/`sigma` have no `.refine(Number.isFinite)`; corrupt values poison arena ratings.
- **B068** `STANDS` [medium / sql-rpc] `supabase/migrations/20260408000001_upsert_metric_max.sql:6-14` — `p_value DOUBLE PRECISION` has no cast/validation; non-numeric JSON silently drops the update.
- **B071** `STANDS` [medium / zod-validation] `schemas.ts:147` — variant `elo_score` has no finiteness check.
- **B072** `STANDS` [medium / zod-validation] `schemas.ts:249` — budget-event `amount_usd` has no `.min(0)`; a negative refund silently deflates reported spend.
- **B073** `STANDS` [medium / sql-rpc] `supabase/migrations/20260328000001_create_lock_stale_metrics.sql:6-23` — `metric_name = ANY(p_metric_names)` has no dedup; duplicates race-update the same row.
- **B074** `STANDS` [medium / schema-drift] migration `20260417000001_evolution_tactics.sql:43-44` adds a `tactic` column missing from `evolutionAgentInvocationInsertSchema`; TS-inserted rows come through with NULL.
- **B075** `STANDS` [low / zod-validation] `schemas.ts:109,189` — `error_message` has no `.max()`; a 1 MB stack trace bloats the row.
- **B077** `STANDS` [low / sql-rpc] `supabase/migrations/20260408000001_upsert_metric_max.sql:20` — `GREATEST(…, EXCLUDED.value)` returns NULL if the existing row has `value=NULL`, silently losing the upsert.

### Main-app / API / auth / workflows

- **B079** `STANDS` [medium / logic] `src/app/api/evolution/run/route.ts:14` — `request.json().catch(() => ({}))` silently accepts malformed JSON; no Zod on `body.targetRunId`.
- **B080** `STANDS` [medium / logic] `src/lib/requestIdContext.ts:61` — returns the literal `'unknown'` on cache miss; all such requests collapse to one Sentry/Honeycomb bucket.
- **B081** `STANDS` [medium / error-handling] `src/app/api/evolution/run/route.ts:22-27` — generic 500 for any non-`Unauthorized` error, swallowing `BudgetExceededError` context.
- **B082** `STANDS` [medium / race] `llmSpendingGate.ts:292-299` — module-level singleton; Vercel cold-starts create divergent caches across containers.
- **B083** `STANDS` [medium / error-handling] `src/lib/services/llms.ts:639-644` — `spendingGate.reconcileAfterCall(…).catch(log)` swallows reconcile failures in the finally block.
- **B084** `STANDS` [medium / error-handling] `llmSpendingGate.ts:208-209` — transient DB error in `getKillSwitch()` isn't cached; every subsequent call in the TTL re-queries.
- **B086** `STANDS` [low / logic] `llmSpendingGate.ts:79, 271` — monthly uses `>=`, daily uses `>`. Inconsistent.
- **B087** `STANDS` [medium / logic] `src/middleware.ts:21` — matcher excludes `api/evolution`; evolution calls never hit `updateSession()` so the Supabase session can expire mid-run.
- **B088** `STANDS` [low / zod-validation] `llmSpendingGate.ts:198` — `(data?.value as {value?: unknown})?.value === true` has no schema; `'true'` string silently fails.
- **B089** `STANDS` [low / logic] `llmSpendingGate.ts:150` — `getConfigValue('evolution_daily_cap_usd')` returns 0 if missing; UI reports 0 as the cap.
- **B091** `STANDS` [low / workflow-yaml] `.github/workflows/ci.yml:173-180` — auto-commit to PR branch runs unconditionally; reviewer local branches get force-rebase surprises.
- **B092** `STANDS` [low / security] `src/app/admin/evolution/layout.tsx:1-13` — pass-through layout; no nested admin re-verification, so a just-revoked admin keeps access until reload.

### Admin UI

- **B094** `STANDS` [medium / resource-leak] `LineageGraph.tsx:154-156` — dynamic-import d3 cleanup races unmount; zoom listener can persist.
- **B095** `STANDS` [medium / logic] `AutoRefreshProvider.tsx:76-80` — only listens to `visibilitychange`; browser back/forward doesn't trigger refresh.
- **B096** `STANDS` [medium / ui] `FormDialog.tsx:170-178` — number field uses `parseFloat`; NaN reaches the submit handler with no inline error.
- **B097** `STANDS` [medium / logic] `EntityListPage.tsx:115-121` — `defaultChecked` applied once at mount; controlled-mode navigation detail→list doesn't re-apply.
- **B098** `STANDS` [medium / ui] `src/app/admin/evolution/arena/page.tsx:53, 90` — reads `filterValues.hideEmpty` but the key is never initialized; the "Hide empty topics" checkbox is permanently non-functional.
- **B100** `STANDS` [low / ui] `ExperimentForm.tsx:205-211` — wizard allows backwards navigation without invalidating downstream state.
- **B101** `STANDS` [medium / ui] `EntityTable.tsx:87` — row key fallback `(item).id ?? i`; missing id + re-sort sticks stale content to indices.

### Testing infrastructure

- **B102** `STANDS` [high / test-isolation] `v2MockLlm.ts:49-50` — ranking queue exhaustion returns `'A'` silently.
- **B103** `NEEDS-TEST` [medium / test-logic] `service-test-mocks.ts:96-97` — `order()` returns `this` without honoring `ascending`. Needs an assertion test.
- **B104** `STANDS` [high / race] `evolution-test-data-factory.ts:13-16` — fallback `TEST_PARALLEL_INDEX ?? '0'` collides across concurrent workers.
- **B105** `STANDS` [medium / race] `evolution-test-data-factory.ts:424-444` — `appendFileSync` not `fsync`'d before teardown reads.
- **B107** `STANDS` [medium / flakiness] `fixtures/auth.ts:107-109` — cached session expiry not re-checked on Playwright retries.
- **B108** `STANDS` [medium / flakiness] `fixtures/base.ts:40-42` — `page.unrouteAll({behavior:'wait'})` can block teardown up to the 30 s timeout.
- **B109** `STANDS` [medium / race] `setup/global-setup.ts:13-41` vs `playwright.config.ts:37-66` — double-discovery of the instance URL in separate Node processes.
- **B111** `STANDS` [medium / test-isolation] `service-test-mocks.ts:30-39` — `setupServiceActionTest()` doesn't reset the cached `supabaseInstance`.
- **B113** `STANDS` [medium / test-isolation] `scripts/cleanup-specific-junk.ts:193-218` — string-range filter is imprecise *and* unpaginated.
- **B115** `NEEDS-TEST` [low / flakiness] `jest.shims.js` vs `jest.setup.js` — no runtime assertion on `setupFiles` order; a future reorder could break.
- **B116** `STANDS` [low / workflow] `playwright.config.ts:170` — `grepInvert` applied only under `isProduction`; local runs execute `@skip-prod` tests against mocked APIs.
- **B117** `STANDS` [low / configuration] `global-teardown.ts:27` — Pinecone dummy-vector dimension hardcoded to `3072`.

### Deeper agent internals

- **B118** `STANDS` [medium / logic] `swissPairing.ts:71` — score sort has no tiebreaker; equal scores produce non-deterministic order even with a seeded RNG.
- **B119** `NEEDS-TEST` [high / logic] `runIterationLoop.ts:410` + `rankNewVariant.ts:85` — `initialPoolSnapshot` includes arena entries; local `top15Cutoff` is inflated by foreign-run ratings. Needs a high-arena-pressure integration test (the 2026-04-21 parent-selection fix was adjacent but didn't cover this cutoff path).
- **B120** `STANDS` [low / logic] `selectTacticWeighted.ts:50` — `<` (not `≤`) in the cumulative check allows FP rounding to push a sample into the default fallback.
- **B121** `STANDS` [medium / logic] `rankSingleVariant.ts:108` — `Math.max(0, Math.floor(elos.length * 0.15) - 1)` collapses to `elos[0]` for all N < 7; the 15 %-cutoff semantics are wrong at small pool sizes. (An existing test codifies the current formula, so fixing this requires updating the test too.)
- **B122** `STANDS` [medium / race] `MergeRatingsAgent.ts:287-304` — inserts `evolution_arena_comparisons` rows with `prompt_id = NULL` expecting `sync_to_arena` to backfill; concurrent finalization can sync NULL rows and drop them from the leaderboard. Fix: set `prompt_id` at insert.
- **B123** `STANDS` [low / logic] `resolveParent.ts:43-51` — fallback reason says `'empty_pool'` even when the pool exists but `qualityCutoff` is undefined; misleading logs.

---

## Withdrawn / out-of-scope

### MISREAD (10) — withdrawn in audit pass 1 (strict read-back)

| ID | Why withdrawn |
|----|---------------|
| B002 | `finally` block runs on all paths; heartbeat is cleaned up. |
| B014 | `median()` guard is at line 41, before computing `mid`. Order is correct. |
| B025 | `Math.ceil`-then-`Math.round` is intentional conservative upper-bound estimation. |
| B030 | Both percentile paths use `Math.floor`; no divergence. |
| B031 | `isConverged` strict `<` matches the docs' "< threshold" phrasing. |
| B049 | `formatCISuffix` already includes `bootstrap_percentile` in the same branch as `bootstrap_mean`. |
| B058 | `run-evolution-local.ts` already chains `.then(({error}) => …).catch(…)` — not fire-and-forget. |
| B090 | `ci.yml` change-detection already captures `evolution/` paths. |
| B099 | Radix `ConfirmDialog` has no form wrapper; Enter doesn't auto-confirm. |
| B114 | `createTestStrategyConfig` hardcodes `[TEST]` with no override. |

### WITHDRAWN in devil's-advocate round (21)

| ID | Defeater found |
|----|----------------|
| B001 | Floor check is correctly gated: the `remaining - actualAvgCost ≥ sequentialFloor` test already enforces the floor. |
| B004 | `persistRunResults` early-returns on empty pool; the `winner!` non-null assertion is never reached. |
| B005 | The merge agent doesn't generate variants, so no merge-phase discards can exist. |
| B006 | Overwriting `stopReason='arena_only'` is the intended semantic; the caller also logs the original reason separately. |
| B007 | Claim-RPC response already has `Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 1.0` validation. |
| B009 | The RNG implementation returns `(s >>> 0) / 0x100000000` which provably caps at `< 1.0`. |
| B010 | Rejected parallel agents don't produce variants, so there's no discard reason to record. |
| B013 | `Promise.allSettled([promise])` is verbose but functionally correct. |
| B015 | Missing `[truncated]` marker is a UX nit, not a functional bug. |
| B016 | The retry loop throws at `attempt === MAX_RETRIES` before ever reading `BACKOFF_MS[3]`. |
| B055 | Supabase client 2.80+ accepts the string-fragment `'in'` syntax for backward compat with PostgREST. |
| B059 | Timestamp filter lives at the DB layer via `is_test_content` column; `applyTestContentNameFilter` is a display-only secondary gate. |
| B064 | `agent_name` is always populated by the framework; empty strings can't reach the DB in practice. |
| B067 | Arena-comparison `status` is permissive-by-design. |
| B069 | COALESCE defaults for `mu`/`sigma` in `sync_to_arena` are `25` and `8.333` respectively — never zero. |
| B076 | The `IS DISTINCT FROM` check correctly skips no-op NULL→NULL updates. |
| B078 | `reconcileAfterCall` cache delete is safe because the next caller issues a fresh RPC that repopulates from the DB. |
| B093 | `EntityListPage.tsx:341` already has the `isNaN` guard. |
| B106 | Outer `try/catch` in `global-teardown` suppresses the propagation; cleanup continues to the next step. |
| B110 | Fallback BASE_URL is defensive, not an override — the config sets BASE_URL ahead of it. |
| B112 | `cleanup-test-content.ts` Pinecone query is caught and logged; the 0 return is a defensive default, not a silent error. |

### STYLE (2)

| ID | Why not a bug |
|----|---------------|
| B023 | `getTtlMs()` silently falling back to default on invalid env var is a design choice documented at the module level. |
| B026 | `timeoutId` cleanup in `finally` is safe today; the "refactor risk" is speculative. |

### REMOVED per user (2)

| ID | Status | Note |
|----|--------|------|
| B070 | REMOVED | Regex "drift" between TS and Postgres `evolution_is_test_name` is textually identical; anti-drift integration test already locks them. |
| B085 | REMOVED | CSRF/origin claim on `/api/evolution/run` wasn't reproducible; needs a concrete POC before treating as a bug. |

---

## Final real-bug distribution

**88 bugs** (75 `STANDS` + 13 `NEEDS-TEST`).

### Severity

| Severity | Count |
|----------|-------|
| critical | 0 |
| high     | 11 |
| medium   | 50 |
| low      | 27 |

### Category (top 5)

- zod-validation (one-line schema refinements): 12
- logic / off-by-one: 17
- error-handling / swallowed errors: 11
- race / concurrency: 9
- cost-accuracy (beyond documented Bug A/B): 9
- sql-rpc / migration: 6
- ui / a11y: 7
- test-isolation / flakiness: 10
- stale-cache / resource-leak: 5
- security / auth-refresh: 2

### NEEDS-TEST subset (13 — require a regression test before fixing)

B032, B034, B037, B038, B043, B044, B045, B046, B050, B054, B103, B115, B119

### High-severity subset (11 — fix first)

B017, B028, B029, B041, B042, B043, B044, B046, B056, B063, B066, B102, B104, B119
