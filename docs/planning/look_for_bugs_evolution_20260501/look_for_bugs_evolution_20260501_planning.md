# Look For Bugs Evolution Plan

## Background

A multi-agent code scan + verification pass surfaced **157 net real bugs**
(140 CONFIRMED + 17 PARTIAL) in the evolution pipeline + admin panel, plus
12 false positives dropped and 1 cross-slice duplicate collapsed. This plan
covers the **HIGH + MEDIUM severity subset (~125 issues)**. The 32 LOW
severity items are deferred to a follow-up cleanup PR.

Two cross-cutting themes drive the worst severity and are addressed first:

1. **Two cost trackers per run** (B001-S1/S2). `executePipeline` builds a
   fresh `createCostTracker` for the seed phase AND `evolveArticle` builds a
   separate one for the loop. Seed cost is never deducted from the loop
   budget; combined spend can exceed `budget_cap_usd`. Multiple downstream
   bugs (B003-S2, B004-S2, B005-S2, B007-S2, B013-S2, B015-S2) compound on
   this shared abstraction.
2. **Dynamic-prefix metrics never refreshed by recompute** (B001-S4 +
   B007-S4). `recomputeRunEloMetrics` only iterates static `atFinalization`
   defs; the cascade trigger marks `eloAttrDelta:*`, `eloAttrDeltaHist:*`,
   `agentCost:*`, and most cost-estimation metrics stale, but
   `lock_stale_metrics` then clears the flag and nothing refills the rows.
   They sit at `stale=false` with stale values until the next finalize.

## Requirements (from user, 2026-05-01)

Tackle every issue at MEDIUM severity or higher from the bug catalog in
`look_for_bugs_evolution_20260501_research.md`. LOW severity is out of scope
for this plan (cleanup-PR follow-up).

## Problem

The two prior bug-hunt projects (look_for_bugs_evolution_20260401 +
use_playwright_find_bugs_ux_issues_20260422) confirmed 51 issues combined.
The 2026-05-01 scan found 157 fresh real bugs across 8 slices. Recent merges
(multi_iteration_strategy_support_evolution_20260415,
track_tactic_effectiveness_evolution_20260422,
develop_reflection_and_generateFromParentArticle_agent_evolution_20260430)
introduced new code paths that weren't covered by prior sweeps; the
attribution metrics, reflection wrapper, per-iteration budget tracker, and
cost calibration all surfaced bugs. Two cross-cutting abstractions
(cost-tracker, recompute path) account for ~10 of the highest-severity
findings each — fixing those first reduces the rest of the workload.

## Options Considered

- [ ] **Option A: Single mega-PR with all ~125 fixes.** Mirrors the
  2026-04-22 sweep's selected option. Fastest to ship, hardest to review;
  bisecting regressions is painful. Acceptable risk for the LOW-severity
  cleanup follow-up but not for HIGH/MEDIUM here.
- [x] **Option B: 10 phased PRs by severity-and-theme.** Easier review,
  longer total cycle, isolates blast radius per phase. Cross-cutting fixes
  go first so downstream phases inherit the improvements. *(Selected.)*
- [ ] **Option C: One PR per cross-cutting theme + per-slice PRs for
  remainder.** Best risk isolation but most coordination overhead.

**Selected: Option B.** Cross-cutting first, then HIGH-severity per-slice,
then MEDIUM consolidations.

## Phased Execution Plan

### Phase 1 — Cross-cutting: cost tracking & budget enforcement (HIGH)

The cost-tracker and per-LLM-call accounting touch every other slice. Land
this first so downstream phases inherit a single, correct tracker.

- [ ] **B001-S1 + B001-S2 (cost tracker unification)** — Refactor
  `claimAndExecuteRun.executePipeline` (claimAndExecuteRun.ts:289-313) to
  pass the same `V2CostTracker` instance into `evolveArticle` instead of
  creating a separate seed tracker. Update the seed-generation flow at
  buildRunContext.ts / generateSeedArticle.ts to accept an injected tracker,
  reserving + recording against the same budget envelope. Add an integration
  test: budget=$0.10, seed cost=$0.03; assert run terminates if loop spend +
  seed spend would exceed cap.
- [ ] **B003-S2 (LLM client retries spend $$ but tracker only releases)** —
  In `createEvolutionLLMClient.ts:188-200`, **re-reserve before each retry
  attempt** (so the budget gate genuinely rejects when retries would breach
  the cap), then on attempt-exhaustion finalize via `recordSpend(actualCost,
  totalReservedAcrossAttempts)`. Pseudocode: `for (attempt of attempts) {
  reserved = reserve(estimate); try { ... recordSpend(actual, reserved); break;
  } catch transient { release(reserved); /* loop */ } }`. Maintains existing
  `reserve/recordSpend/release` API; no new contract. Cross-check
  llmCallTracking row count vs. tracker delta in a unit test.
- [ ] **B004-S2 (empty-response throw releases $ already paid)** — Same
  treatment as B003-S2: per-attempt reserve+recordSpend instead of
  reserve-once-then-release. Empty-response is the same code path as
  transient; no separate fix.
- [ ] **B005-S2 (cost-write awaited but documented fire-and-forget)** —
  Drop the `await`s at createEvolutionLLMClient.ts:159,162 and call
  `writeMetricMax(...).catch((err) => logger.warn('cost-metric write
  failed', {err}))` directly (no `Promise.resolve()` wrapper — that
  syntactic form is wrong; the call already returns a Promise). Update
  header comment to match.
- [ ] **B007-S2 (RESERVE_MARGIN double-applied in iteration tracker)** — In
  `trackBudget.ts:115-132`, change `createIterationBudgetTracker.reserve`
  to **peek both budgets without mutating** before any reservation: compute
  `runMargined = runTracker.computeMargined(estimate)`, check
  `runTracker.canReserve(runMargined)` AND `iterRemaining >= runMargined`;
  ONLY THEN call `runTracker.reserve(estimate)` (single mutation). On iter
  reject the run-tracker is never mutated, so no leak. Property test:
  `iterationBudget=0.13, reserve(0.1)` succeeds; subsequent `reserve(0.001)`
  also succeeds; iter reject leaves `runTracker.totalReserved` unchanged.
- [ ] **B013-S2 (per-purpose cost write reads SHARED tracker under
  parallel)** — In `createEvolutionLLMClient.ts:155-167`, when the client
  was built inside an `AgentCostScope`, read `scope.getOwnSpentByPhase()`
  instead of the shared `getPhaseCosts()`. Add `getOwnSpentByPhase()` to
  `AgentCostScope` (parallels existing `getOwnSpent()`). Maintains the
  `writeMetricMax` GREATEST semantics for run-aggregate metrics.
- [ ] **B015-S2 (cost-write try/catch read outside try)** — Move
  `getTotalSpent()` and `getPhaseCosts()` reads inside the try block at
  createEvolutionLLMClient.ts:158.
- [ ] **B009-S2 (variant cost null guard)** — In `persistRunResults.ts:392`,
  enrich variant `costUsd` from `evolution_agent_invocations` join when not
  set on the in-memory variant; ensures per-variant cost rollup is complete.
- [ ] **B002-S2 (calibration cache hydration never called in production)** —
  Wire `hydrateCalibrationCache(db)` into the `processRunQueue.ts` startup
  path AND into `claimAndExecuteRun.executePipeline` lazy-init (gated on
  `process.env.COST_CALIBRATION_ENABLED === 'true'` so disabled installs
  pay nothing). Without this call, the in-memory cache stays empty for
  the whole runner lifetime and the entire shadow-deploy is silently
  inert. Add unit test asserting `getCalibrationRow` returns a populated
  row after an initial `hydrateCalibrationCache` call.

### Phase 2 — Cross-cutting: metrics integrity & recompute (HIGH)

The recompute path is the second cross-cutting abstraction; fix it before
per-slice metric bugs that depend on it.

- [ ] **B002-S4 + B003-S4 (percentile interpolation inconsistency)** —
  Standardize on **nearest-rank ceil(p\*n)−1** across both
  `experimentMetrics.ts:331` (per-run) and `:207-220` (bootstrap). Update
  computeMedianElo (`finalization.ts:41-44`) to drop the average-of-two
  middle behavior in favor of ceil-1. Add property test asserting same
  percentile resolves identically across all three paths.
- [ ] **B004-S4 (dimension validator rejects ':')** — In
  `experimentMetrics.ts:472,478`, change the validator to accept ':' but
  escape it (replace `:` → `_COLON_`) when building the metric key
  `eloAttrDelta:<agent>:<dim>`. Add unit test for dim='gpt-4:turbo'.
- [ ] **B005-S4 (transition fallback misfires on legitimate-zero cost)** —
  In `tacticMetrics.ts:111-113`, change condition from `if (totalCost === 0)`
  to `if (invocationCount === 0)`. Real "no invocation rows" is the case
  that needs the fallback; zero-cost-with-rows is legitimate.
- [ ] **B006-S4 (invocation recompute missing Number.isFinite guard)** — In
  `recomputeMetrics.ts:217`, add the same `Number.isFinite` guard pattern
  used at lines 100-102.
- [ ] **B008-S4 (propagation aggregates stale source rows blindly)** — In
  `propagation.ts:8-67` and `readMetrics.ts:71` (`getMetricsForEntities`),
  add an option to filter `stale=false` for aggregation calls; default true.
  Document via inline comment that `stale=true` rows must not be included in
  aggregates.
- [ ] **B009-S4 (RPC error swallowed in recompute claim)** — In
  `recomputeMetrics.ts:23-30`, destructure both `data` and `error`, log
  `error` at warn level if present, and skip recompute (treat as race-loss).
- [ ] **B010-S4 (`.not('parent_variant_id','is',null)` excludes seed
  variants)** — In `experimentMetrics.ts:415-419`, drop the
  `parent_variant_id IS NOT NULL` filter and let the legacy-fallback path
  (referenced in the B052 comment) handle seed variants. Verify with a
  fixture run containing only a seed variant.
- [ ] **B011-S4 (attribution writeMetric calls omit aggregation_method)** —
  In `experimentMetrics.ts:525-530`, add `aggregation_method: 'avg'` (for
  eloAttrDelta) and `'count'` (for histogram buckets) to the opts. The CI
  itself still renders without this, but the badge is missing — and a
  future formatter that keys off `aggregation_method` (per the doc) will
  break otherwise.
- [ ] **B012-S4 (N+1 sequential writes per finalize)** — Replace the loop
  at `experimentMetrics.ts:531-569` with a batched `writeMetrics(rows)` call
  per entity-level. Build all 3-level rows in memory, then 3 batched DB
  writes (one per `entity_type`).
- [ ] **B013-S4 (backfill script `--run-id=UUID` only)** — In
  `backfillRunCostMetric.ts:54`, add support for `--run-id UUID` (space
  form) by checking `process.argv[i+1]` after a bare `--run-id` token.
  Update docstring to show both forms.
- [ ] **B014-S4 (existing-cost-row check ignores stale)** — In
  `backfillRunCostMetricHelpers.ts:14`, add `.eq('stale', false)` to the
  existence check so stale rows trigger backfill.
- [ ] **B015-S4 (filter `v > 0` drops zero-cost runs)** — In
  `backfillRunCostMetricHelpers.ts:58`, change to
  `if (Number.isFinite(v) && v >= 0)`. Zero is legitimate (test runs,
  fully-cached calls).
- [ ] **B016-S4 (refreshCostCalibration reads only `detail.strategy`)** —
  In `refreshCostCalibration.ts:131`, fall back to `detail.tactic` when
  `detail.strategy` is missing. Or use the
  `attributionExtractors` registry directly to get the dimension.
- [ ] **B028-S4 (writeMetrics hardcodes stale=false — TWO-LAYER fix)** —
  TS layer: add `preserveStale: boolean` (default `false`) to `writeMetrics`
  and `writeMetric`; when `true`, write `stale: COALESCE(EXCLUDED.stale,
  evolution_metrics.stale)` semantics via raw SQL, OR (simpler) split the
  upsert into INSERT-on-not-exist + UPDATE-without-touching-stale. SQL
  layer: the actual cascade race lives in the `mark_elo_metrics_stale`
  trigger and `lock_stale_metrics` RPC. New migration adds an `updated_at`
  predicate to lock_stale_metrics so writes that landed AFTER the
  stale-flip don't have their stale=true reset by a `writeMetrics` running
  with `preserveStale=false` (the default). Update the cascade trigger
  documentation in evolution/docs/metrics.md to describe the contract.
- [ ] **B001-S4 + B007-S4 (recompute path skips dynamic-prefix metrics —
  COMPUTE FUNCTION MAPPING)** — In `recomputeMetrics.ts:39-77,81`, add
  explicit dispatch: for each row currently flagged stale, look up the
  metric_name → compute function mapping. Mapping table (must add to plan):
    - `eloAttrDelta:<agent>:<dim>` and `eloAttrDeltaHist:...` →
      `computeEloAttributionMetrics(runId, db, opts)` from
      `experimentMetrics.ts` (already extracts these per-run).
    - `agentCost:<agent>` → re-aggregate from
      `evolution_agent_invocations` per agent_name within the run.
    - Cost-estimation metrics (`cost_estimation_error_pct`, etc.) — **leave
      stale=true and skip recompute** because ctx.invocationDetails /
      ctx.budgetFloorObservables aren't available at recompute time;
      document that they are populated only at finalize. Annotate with a
      `RECOMPUTE_SKIPPED` set so the next finalize repopulates them
      transactionally.
  Add unit test asserting that a stale-flag flip on `eloAttrDelta:*`
  triggers the attribution recompute path (not just the static
  atFinalization defs).

### Phase 3 — HIGH severity: pipeline core (Slice 1)

- [ ] **B002-S1 (absorbResult discards subsequent fulfilled results)** — In
  `runIterationLoop.ts:526-555,558-564`, restructure to absorb ALL fulfilled
  results into `surfacedVariants`/`surfacedBuffers` first, THEN check for
  any rejected `BudgetExceededError` and set `iterStopReason` accordingly.
  Pre-merge the variants we already paid for.
- [ ] **B003-S1 (Swiss inner loop no abort/deadline/kill)** — Add
  `signal.aborted`, `Date.now() < deadlineMs`, and `await isRunKilled(db,
  runId)` checks to the inner `while` at `runIterationLoop.ts:723`. Check
  every 5 swiss rounds (cheap) and on abort signal (immediate).
- [ ] **B004-S1 (arena-only finalize never sets error_code)** — In
  `persistRunResults.ts:154,157`, set `error_code: null` (success) and
  `error_code: 'finalize_empty_pool'` respectively, and add `.is('error_code',
  null)` predicate to maintain race-freedom contract.
- [ ] **B005-S1 (uncertaintyHistory + diversityHistory unused)** — Either
  populate both arrays (push after each ranking phase, mirroring eloHistory)
  OR remove from `EvolutionResult`, `run_summary` schema, and `EloTab`. Pick
  populate — the EloTab uncertainty band is documented behavior.
- [ ] **B006-S1 (actualAvgCostPerAgent only updates from iter 0)** — In
  `runIterationLoop.ts:570`, drop the `if (iterIdx === 0)` guard. Update
  budget_floor_observables from every generate iteration's parallel batch.
- [ ] **B007-S1 (random_seed BigUint64Array overflow)** — Mask the upper
  bit at `runIterationLoop.ts:225-228`: `buf[0] = buf[0] &
  0x7fffffffffffffffn`. Postgres BIGINT signed clamp.
- [ ] **B008-S1 (arena-only path passes UNFILTERED pool to buildRunSummary)**
  — In `persistRunResults.ts:152`, build `arenaOnlyResult = {...result, pool:
  result.pool.filter(v => !v.fromArena)}` before passing to buildRunSummary.
  Or pass the pre-filtered `summaryPool` (existing variable in main path).
- [ ] **B009-S1 (seed-failed markRunFailed uses generic 'unhandled_error')**
  — In `claimAndExecuteRun.ts:322`, pass
  `errorCode: 'missing_seed_article'` per the classifyError taxonomy.
- [ ] **B011-S1 (failed top-up sets stopReason='budget_exhausted' for LLM
  errors)** — In `runIterationLoop.ts:630-633`, distinguish: if the rejected
  reason is `BudgetExceededError`, keep `'budget_exhausted'`; otherwise set
  `'top_up_dispatch_failed'`. Add the new value to `IterationStopReason`
  schema enum.
- [ ] **B012-S1 (sequential GFSA durations filter wrong)** — In
  `persistRunResults.ts:311-322`, filter by `execution_detail.dispatch_phase
  === 'sequential'` (a new field set by the top-up loop) instead of
  `iteration >= 2`. **Schema migration handling**: add
  `dispatch_phase: z.enum(['parallel', 'sequential']).optional()` to
  `gfpaExecutionDetailSchema` in `evolution/src/lib/schemas.ts`. Historical
  rows have undefined `dispatch_phase`; persistRunResults must treat
  undefined as "unknown — skip from sequential aggregation" (mirroring
  the legacy filter behavior). Add an inline comment that historical rows
  are eventually-displaced by new rows; no backfill needed (sequential GFSA
  durations are an observability metric, not a durability invariant).
  Update the invocation-detail-page reader to render the new field when
  present.
- [ ] **B014-S1 (swissPairing maxPairs=0 silently returns [])** — In
  `swissPairing.ts:40`, add `if (maxPairs <= 0) throw new Error('maxPairs
  must be positive');`. Catch upstream and treat as config bug.
- [ ] **B015-S1 (dead `generation_method='seed'` in syncToArena)** — Remove
  the conditional at `persistRunResults.ts:550`; hardcode `'pipeline'`. Add
  inline comment noting the seed is now persisted separately by
  `claimAndExecuteRun`.
- [ ] **B016-S1 (seed lookup `.single()` errors on multiple rows)** — In
  `buildRunContext.ts:166-176`, change `.single()` to `.maybeSingle()` and
  add `.is('archived_at', null)` (NOT `.eq` — PostgREST treats `.eq(col,
  null)` as `col = NULL` which never matches). Log warn if `.error` is set.
  This bug is OWNED BY PHASE 3; the duplicate listing in Phase 8 is removed.
- [ ] **B010-S1 (parallelSuccesses=0 falls back to estPerAgent — direction
  inverted)** — Per verification, this UNDER-dispatches not OVER-dispatches.
  Still real: when initial estimate was conservative (high), top-up
  unnecessarily skips dispatches. Fix: when `parallelSuccesses=0`, set
  `actualAvgCostPerAgent = null` and skip top-up entirely (avoid
  cascading failures). Document in inline comment.
- [ ] **B013-S1 (random_seed TOCTOU — bounded by claim_evolution_run)** —
  In `buildRunContext.ts:336-354`, do the read+update in a single SQL
  `UPDATE ... WHERE random_seed IS NULL RETURNING random_seed` so only one
  writer wins. Detect race via empty RETURNING.

### Phase 4 — HIGH severity: core agents & entities (Slice 3)

- [ ] **B001-S3 + B007-S3 (RunEntity.executeAction drops payload, breaking
  cascade-delete invariants)** — In `entities/RunEntity.ts:113-121`, restore
  the `payload?: Record<string, unknown>` parameter and forward it to
  `super.executeAction(key, id, db, payload)`. The base's `_visited` Set and
  `_skipStaleMarking` flag must propagate.
- [ ] **B002-S3 (`edit` action declared but no handler)** — In
  `core/Entity.ts:115` (`executeAction` switch), add an `'edit'` case that
  delegates to `this.editConfig?.onSubmit(id, db, payload)`. Or remove
  `'edit'` from `actions` arrays on Strategy + Prompt entities and rely on
  the dedicated `updateStrategyAction` / `updatePromptAction` server
  actions. Pick: remove from actions arrays and document the bypass.
- [ ] **B003-S3 (CreateSeedArticleAgent missing from getAgentClasses())** —
  In `core/agentRegistry.ts:21-26`, add `new CreateSeedArticleAgent()` to
  the array.
- [ ] **B004-S3 (DETAIL_VIEW_CONFIGS missing `create_seed_article`)** — In
  `core/detailViewConfigs.ts`, add the key by importing from
  `agents/createSeedArticle.ts`.
- [ ] **B005-S3 (createSeedArticle missing registerAttributionExtractor)**
  — Add `registerAttributionExtractor('create_seed_article', () => 'seed')`
  at the bottom of `core/agents/createSeedArticle.ts`. Seed variants get a
  `seed` bucket in attribution rollups.
- [ ] **B006-S3 (InvocationEntity agent_name filter options stale)** — In
  `entities/InvocationEntity.ts:50-54`, replace the legacy phase labels with
  the actual snake_case agent_name values:
  `['generate_from_previous_article',
  'reflect_and_generate_from_previous_article', 'swiss_ranking',
  'merge_ratings', 'create_seed_article']`. Sort A-Z for UI consistency.

### Phase 5 — HIGH severity: server actions, API, security (Slice 5)

- [ ] **B001-S5 (clone config_hash collision)** — In
  `strategyRegistryActions.ts:250`, the issue is that the current
  `${configHash}_clone_${Date.now()}` is meant to make clones distinct
  from the source, NOT content-addressable (clones SHOULD be different
  rows). Replace `Date.now()` with a deterministic discriminator: derive
  from `(sourceStrategyId, max(existing_clones_of_source).clone_index +
  1)` so concurrent clones serialize via a UNIQUE constraint on
  `(parent_strategy_id, clone_index)`. Add migration: new column
  `parent_strategy_id UUID NULL REFERENCES evolution_strategies(id)` and
  `clone_index INT NULL`, partial UNIQUE INDEX on `(parent_strategy_id,
  clone_index) WHERE clone_index IS NOT NULL`. Audit `findOrCreateStrategy`
  upsert (B021-S1) — clone hashes still differ from source's content hash
  so dedup-on-content remains intact.
- [ ] **B002-S5 (IN-list URL truncation regression)** — In
  `invocationActions.ts:91`, switch to the inner-join pattern from the
  2026-04-22 fix:
  `.select('*, evolution_runs!inner(strategy_id, evolution_strategies!inner(is_test_content))')`
  with `.eq('evolution_runs.evolution_strategies.is_test_content', false)`.
  Same shape as `applyNonTestStrategyFilter`.
- [ ] **B003-S5 (listStrategiesAction TypeError on undefined input)** — Add
  Zod schema `listStrategiesInputSchema` with `.default({limit: 50, offset:
  0})`; parse before access.
- [ ] **B004-S5 (getArenaComparisonsAction limit not capped)** — Add
  `.max(200)` to the input schema for `limit`.
- [ ] **B005-S5 (getTacticRunsAction filters by stale `tactic` column)** —
  In `tacticActions.ts:177`, change `.eq('tactic', input.tacticName)` to
  `.eq('agent_name', input.tacticName)` matching sibling actions.
- [ ] **B006-S5 + B017-S5 (queueEvolutionRun missing explanationId
  validation + existence check)** — Add Zod
  `explanationId: z.number().int().positive().optional()` to input schema.
  For existence check, **rely on the FK constraint** rather than a
  SELECT-then-INSERT (which is itself TOCTOU): verify
  `evolution_runs.explanation_id` already has `REFERENCES explanations(id)
  ON DELETE SET NULL`; if not, add the FK in this PR's migration. On
  insert, catch `23503` foreign_key_violation → throw structured
  `ExplanationNotFoundError` with the supplied id. No race window remains.
- [ ] **B007-S5 (executeEntityAction missing audit log)** — Wrap the
  dispatcher in `entityActions.ts:75-97` with `logAdminAction(adminUserId,
  'entityAction', {entityType, entityId, actionKey})` before delegating.
- [ ] **B008-S5 (revalidatePath missing across multiple actions)** — Add
  `revalidatePath('/admin/evolution/...')` calls after every mutation in
  experimentActions, arenaActions, strategyRegistryActions. Audit list:
  createExperimentWithRunsAction, addRunToExperimentAction,
  createArenaTopic, archiveArenaTopic, deleteArenaTopic, createPromptAction,
  updatePromptAction, archivePromptAction, deletePromptAction,
  createStrategyAction, updateStrategyAction, cloneStrategyAction,
  archiveStrategyAction, deleteStrategyAction.
- [ ] **B009-S5 (deleteStrategyAction TOCTOU)** — `WHERE NOT EXISTS` does
  NOT close the race in READ COMMITTED (concurrent INSERT into
  evolution_runs can commit between subquery and DELETE). Two-part fix:
  (1) verify `evolution_runs.strategy_id` FK declares `ON DELETE
  RESTRICT` (NO ACTION is the default and is sufficient — Postgres rejects
  the DELETE if the FK violation would result, atomically). If the FK is
  currently `CASCADE`, change to `RESTRICT` via migration. (2) In the JS
  action, catch `23503` foreign_key_violation from the DELETE → return
  structured `StrategyHasRunsError` (HTTP 409). Drop the SELECT count
  query entirely. Add integration test: concurrent
  `queueEvolutionRunAction(strategyId)` + `deleteStrategyAction(strategyId)`
  with timing instrumentation; one must succeed, the other must fail
  cleanly with a non-zero error code.

### Phase 6 — HIGH severity: shared utilities, UI, doc drift (Slices 6/7/8)

- [ ] **B001-S6 (HORIZONTAL_RULE_PATTERN missing `g` flag)** — In
  `enforceVariantFormat.ts:21`, add `g` to the regex flags. Add unit test
  asserting two `---` separators are both stripped.
- [ ] **B002-S6 + B003-S6 (parseWinner regex + first-word fallback)** — In
  `computeRatings.ts:340-371`, remove plain `IS` from the verb alternation
  (require BETTER/WINS/SUPERIOR). Extend first-word fallback to
  `/^(?:\*\*|__)?\s*(?:Actually,?\s+|Final\s+answer:?\s+)?(A|B)(?:\.|,)?\s*(?:\*\*|__)?\b/i`.
  Add 8-case unit test for "Actually, B." / "**B**" / "Final answer A" /
  "Text A is original; Text B is better" / etc.
- [ ] **B004-S6 (V1/V2 → V3 transform produces mu-scale assigned to
  Elo-scale fields — BACKWARD-COMPAT)** — In `schemas.ts:1313-1450`, pipe
  every legacy `legacyToMu(ord)` output through `toEloScale(mu)` before
  assigning to eloHistory / topVariants.elo / seedVariantElo /
  tacticEffectiveness.avgElo. **Persisted-row strategy**: Already-persisted
  `evolution_runs.run_summary` rows that contain mu-scale values in
  Elo-scale fields are read through this same Zod transform — fixing the
  transform repairs them on-read without a backfill (read-side migration).
  However, downstream consumers that wrote derivative metrics off those
  bad reads have already produced bad data; flag for a follow-up
  recompute-on-detection script tracked as out-of-scope here. Add migration
  test on a real V2 row asserting eloHistory values land in ~1100-1300
  range, not ~25-50.
- [ ] **B005-S6 (AGENT_TO_COST_METRIC missing reflect_and_generate)** — In
  `backfillInvocationCostFromTokens.ts:61-66`, add `'reflect_and_generate_from_previous_article':
  'generation_cost'` (or 'reflection_cost' if the per-purpose split applies).
- [ ] **B006-S6 (refreshCostCalibration reads non-existent
  detail.seedTitle/seedArticle)** — In `refreshCostCalibration.ts:154-172`,
  read `detail.generation` and `detail.ranking` (the actual fields per
  `createSeedArticleExecutionDetailSchema`). Bucket as
  phase='seed_generation' / phase='seed_ranking'.
- [ ] **B001-S7 (Tailwind dynamic class produces no CSS)** — In
  `RunsTable.tsx:30`, replace dynamic class strings with branchy static
  classes: a `bg-warning/15` branch (≥80%) and a `bg-error/15` branch
  (≥90%). Or add a `safelist` to `tailwind.config.ts` (less preferred —
  bloats CSS).
- [ ] **B002-S7 (VariantsTab colSpan off-by-one)** — In `VariantsTab.tsx`,
  change `colSpan={8}` to `colSpan={9}` at lines 171 and 268.
- [ ] **B004-S8 (agents/overview.md describes non-existent functions)** —
  Rewrite `evolution/docs/agents/overview.md`. Drop the
  `generateVariants() / rankPool() / evolveVariants()` sections entirely.
  Replace with `evolveArticle() / Agent.run() / rankNewVariant() /
  swissPairing()` per current code. Cross-link to architecture.md.

### Phase 7 — Doc-vs-code drift (HIGH + MEDIUM, Slice 8)

Low-blast-radius, high-fix-rate. Bundle into one PR.

- [ ] **B001-S8** — `architecture.md:14-17`: change `maxDuration = 800` →
  `300`, pipeline gets `(300 - 60) * 1000 ms`.
- [ ] **B002-S8** — Replace `pipeline/cost-tracker.ts` mentions with
  `pipeline/infra/trackBudget.ts` in architecture.md, reference.md,
  cost_optimization.md.
- [ ] **B003-S8** — Rewrite the reference.md key-files table to match
  current paths. Drop the 13 non-existent files listed; replace with actual
  files (claimAndExecuteRun.ts, classifyError.ts, manageExperiments.ts,
  loop/runIterationLoop.ts, loop/rankSingleVariant.ts, loop/swissPairing.ts,
  loop/projectDispatchPlan.ts, finalize/persistRunResults.ts,
  finalize/buildRunSummary.ts, setup/buildRunContext.ts,
  setup/findOrCreateStrategy.ts, setup/generateSeedArticle.ts,
  setup/resolveParent.ts, infra/*).
- [ ] **B005-S8** — Update docs to show 3-param `claim_evolution_run(p_runner_id
  TEXT, p_run_id UUID DEFAULT NULL, p_max_concurrent INT DEFAULT 5)` in
  architecture.md, reference.md, data_model.md.
- [ ] **B006-S8** — Update sync_to_arena docs to 5-param signature incl.
  `p_arena_updates JSONB DEFAULT '[]'`. Note that p_matches is deprecated.
  Drop the "max 1000 matches" claim.
- [ ] **B007-S8** — Update reference.md model pricing table to match
  src/config/llmPricing.ts: deepseek-chat $0.28/$0.42, drop
  claude-haiku-4-5-20251001 (not in registry), fallback $10/$30.
- [ ] **B010-S8** — In `rating_and_comparison.md:185-323`, rewrite the
  "Two-Phase Ranking Pipeline" section to describe the orchestrator-driven
  flow (rankNewVariant + swissPairing + MergeRatingsAgent). Drop legacy
  rank.ts / rankPool / selectOpponents / getBudgetTier references.
- [ ] **Bundle-MEDIUM-S8 (B011-B017-S8 + LOW S8)** — Same PR also fixes:
  `tactics/tacticRegistry.ts` → `tactics/generateTactics.ts`,
  page-count drift (15/19 → 22), stop reasons enum mismatch, agentType enum
  drift, `pipeline/arena.ts` → setup/buildRunContext.ts +
  finalize/persistRunResults.ts, `pipeline/seed-article.ts` →
  setup/generateSeedArticle.ts. Plus B012-S8 (`maxVariantsToGenerateFromSeedArticle`):
  delete from strategies_and_experiments.md AND remove the lingering reads
  in StrategyConfigDisplay.tsx:38,123-124.

### Phase 8 — MEDIUM severity: pipeline core + infra (Slices 1 + 2)

_(B016-S1 owned by Phase 3 — no Phase 8 entry to avoid duplicate scope.)_
- [ ] **B017-S1 (Number.isFinite gap on string mu)** — In
  `buildRunContext.ts:71-73`, coerce via `Number(rawMu)` before the finite
  check. Apply same fix in `loadArenaEntries`.
- [ ] **B018-S1 (claim RPC budget_cap_usd no warn)** — In
  `claimAndExecuteRun.ts:144,151`, add
  `logger.warn('budget_cap_usd missing or invalid, defaulting to $1', {runId,
  raw: claimedRow.budget_cap_usd})` on the fallback branch.
- [ ] **B019-S1 (rankSingleVariant LLM-error swallow no warn)** — In
  `rankSingleVariant.ts:328-330`, add
  `logger.warn('Comparison LLM call failed, recording as TIE',
  {variantId, opponentId, error})`.
- [ ] **B021-S1 (upsertStrategy onConflict overwrites name/label)** —
  In `findOrCreateStrategy.ts:88-113`, change to
  `.upsert(payload, {onConflict: 'config_hash', ignoreDuplicates: true})`
  followed by SELECT to fetch the existing row's id. Preserves name/label of
  prior insert.
- [ ] **B022-S1 (iteration result push doesn't run on uncaught throw)** —
  Move the iteration result push into a `finally` block around the
  per-iteration try/catch at `runIterationLoop.ts:825-856`.
- [ ] **B006-S2, B018-S2 (parallelSpend underestimates → top-up over-
  dispatch)** — In `runIterationLoop.ts:560-563,608`, replace `parallelSpend`
  with `iterTracker.getTotalSpent() - preIterSpent` for the `remaining`
  calc. Authoritative.
- [ ] **B008-S2 (heartbeat catches errors, no escalation)** — In
  `claimAndExecuteRun.ts:54-69`, track consecutive failures; after 3
  consecutive, escalate to `logger.error` and emit `runFailed('heartbeat_loss')`
  if more than `STALENESS_THRESHOLD_MINUTES` × 60s pass without success.
- [ ] **B010-S2 (setTimeout no AbortController)** — In
  `createEvolutionLLMClient.ts:120-127`, wire an `AbortController` into the
  rawProvider call when the SDK supports it (OpenAI SDK does). Cancel the
  in-flight request when timeout fires.
- [ ] **B011-S2 (createEntityLogger swallows DB errors silently)** — In
  `createEntityLogger.ts:56-82`, replace the `Promise.resolve().then(...).catch(...)`
  pattern with `await logger.queueWrite(...)` that catches and warns at the
  console level for both Postgrest errors AND .catch errors.
- [ ] **B012-S2 (createCostTracker rejects 0 with generic error)** — In
  `trackBudget.ts:103-104`, throw a `BudgetTooSmallError extends Error` with
  classifiable message; update classifyError to map this to
  `'budget_too_small'` code.
- [ ] **B014-S2 (calibration lookup uses `__unspecified__` tactic)** — In
  `createEvolutionLLMClient.ts:100-111`, accept an optional `tactic` param;
  pass it to `getCalibrationRow` so tactic-specific rows take priority over
  the SENTINEL fallback.
- [ ] **B016-S2, B019-S2 (syncToArena retry sleep not abort-aware)** —
  Replace `setTimeout(2000)` with a cancellable Promise that races against
  `signal.aborted`. Threading the AbortSignal through finalize is the bigger
  lift — track as a follow-up if it expands scope.
- [ ] **B020-S2 (minLevel resolved at logger creation)** — In
  `createEntityLogger.ts:43-44`, read `process.env.EVOLUTION_LOG_LEVEL` per
  log call (cheap; map.get O(1)).

### Phase 9 — MEDIUM severity: core agents + entities + metrics (Slices 3 + 4)

- [ ] **B008-S3 (SwissRankingAgent status='success' on all-fail)** — In
  `SwissRankingAgent.ts:179`, add status='no_pairs' when
  `pairsSucceeded === 0 && budgetCount === 0` (treat as no-progress, not
  success). Extend schema enum if needed; add a 'failure' value.
- [ ] **B011-S3 (RunEntity status options miss claimed/cancelled)** — In
  `entities/RunEntity.ts:83`, add 'claimed' and 'cancelled' to the
  status filter options array.
- [ ] **B012-S3 (Entity.ts N+1 SELECT for parent stale-mark)** — In
  `core/Entity.ts:142-151`, batch the SELECT with
  `select(parents.map(p => p.foreignKey).join(','))` in a single query.
- [ ] **B013-S3 (MergeRatingsAgent twin Rating instances on idA===idB)** —
  In `MergeRatingsAgent.ts:234-238`, dedupe: if `idA === idB`, return early
  with a warn log (self-pair shouldn't reach merge).
- [ ] **B014-S3 (new variants show eloDelta:0 in after-snapshot)** — In
  `MergeRatingsAgent.ts:339,360-362`, when `before` lacks the key, set
  `eloDelta: a.elo - DEFAULT_ELO` (1200) so newly-added variants show their
  actual displacement from the default.
- [ ] **B015-S3 (Entity.getById swallows non-row errors as null)** — In
  `core/Entity.ts:120`, return null only when `error.code === 'PGRST116'`;
  rethrow otherwise (or return a typed `{notFound: true}` shape).
- [ ] **B016-S3 (reflectAndGenerate isValidTactic dead code)** — In
  `reflectAndGenerateFromPreviousArticle.ts:367-395`, delete the unreachable
  branch. Add an inline comment that `parseReflectionRanking` guarantees
  validity.
- [ ] **B017-S3 (Agent.run BudgetExceeded catch no execution_detail)** — In
  `core/Agent.ts:175-189`, write `execution_detail: {error:
  'BudgetExceededError', spent, reserved, cap}` in the catch path so
  invocation pages have at least minimal context.
- [ ] **B018-S3 (StrategyEntity propagation defs spread wrong timing)** —
  In `entities/StrategyEntity.ts:102-152` and `ExperimentEntity` analogue,
  override `timing: 'at_propagation'` after the spread:
  `{...METRIC_CATALOG.X, timing: 'at_propagation', ...rest}`.
- [ ] **B019-S3 (`'evolution'` in AGENT_NAMES dead)** — In
  `core/agentNames.ts:10`, remove `'evolution'` from the array. Update the
  docblock to say "five labels".
- [ ] **B020-S3 (TIE result yields nonsensical winnerId=idA — BACKWARD-COMPAT)** —
  In `SwissRankingAgent.ts:143-152`, set `winnerId: null` when
  `result === 'draw'`. Update `v2MatchSchema` in
  `evolution/src/lib/schemas.ts` to `winnerId: z.string().uuid().nullable()`.
  **Consumer audit (must list each)**:
  (1) `MergeRatingsAgent.ts:281` — already branches on `result === 'draw'`
  separately; no change needed. (2) `persistRunResults.ts` match
  serialization — verify it doesn't dereference `winnerId` without a draw
  guard. (3) `evolution_runs.match_history` JSONB rows — historical rows
  have draws stored with `winnerId=idA`. Backfill in same migration:
  `UPDATE evolution_runs SET match_history = jsonb_path_query_array(...)`
  rewriting draws' winnerId to null. (4) Admin UI consumers
  (`evolutionVisualizationActions.ts`, variant-detail match list) —
  re-render draws as "—" when winnerId is null. (5) Read-side Zod parse
  via `EvolutionRunSummarySchema` — already a discriminated union with
  auto-migration; extend the migration arm to coerce legacy `idA`-on-draw
  to null. Test: integration test seeds run with draws stored both ways;
  asserts both render correctly.
- [ ] **B017-S4 (median uncertainty arithmetic average)** — In
  `finalization.ts:43-44`, use quadrature: `Math.sqrt((u1**2 + u2**2) / 4)`.
  Add unit test asserting symmetric inputs (u1=u2=10) yield ~7.07, not 10.
- [ ] **B018-S4 (Math.max spread risks stack overflow)** — In
  `tacticMetrics.ts:86`, use `ratings.reduce((max, r) => r.elo > max ? r.elo
  : max, -Infinity)`.
- [ ] **B019-S4 (hardcoded TrueSkill defaults)** — In `tacticMetrics.ts:72`,
  import `_INTERNAL_DEFAULT_MU / _INTERNAL_DEFAULT_SIGMA` from
  computeRatings.
- [ ] **B020-S4 (win_rate row drops uncertainty but keeps CI)** — In
  `tacticMetrics.ts:131-135`, set `uncertainty:
  winRateResult.uncertainty ?? null` (don't hardcode null).
- [ ] **B021-S4 (n=1 case uses sample sigma as SE-of-mean)** — In
  `experimentMetrics.ts:130-138`, return `ci: null` for n=1 (no CI is
  meaningful with one observation). Document.
- [ ] **B022-S4 (aggregateAvg normal-approx CI for n=2 no min guard)** —
  In `propagation.ts:17-22`, return `ci: null` for `n < 5` (or use t-table
  multiplier instead of 1.96). Choose null since dashboards prefer "no CI"
  to "wrong CI".
- [ ] **B023-S4 (double-fault swallows re-mark error silently)** — In
  `recomputeMetrics.ts:62-73`, replace the silent catch with
  `console.warn('[recomputeMetrics] double-fault on stale re-mark', {error:
  _remarErr, originalError: err})`.
- [ ] **B025-S4 (bootstrapPercentileCI runs full loop when nRuns<2)** — In
  `experimentMetrics.ts:188-214`, add early return `if (validRuns.length <
  2) return null;` before the bootstrap loop.

### Phase 10 — MEDIUM severity: server actions + spending gate (Slice 5)

- [ ] **B010-S5 (killEvolutionRunAction conflates cases)** — In
  `evolutionActions.ts:646`, split the error check: `if (!data) throw new
  Error('Run not found')` then `if (data.status === 'completed' || ...) throw
  new Error('Run already in terminal state')`.
- [ ] **B011-S5 (getCostSummaryAction sequential awaits)** — In
  `costAnalytics.ts:62-100`, wrap the two queries in `await Promise.all([...])`.
- [ ] **B012-S5 (kill-switch fail-closed cache after DB error)** — In
  `llmSpendingGate.ts:208-227`, after a DB error: do NOT cache `value:
  true`. Instead, set a **negative-cache window** (1s TTL) that returns
  the structured `LLMKillSwitchError` from cache for 1s WITHOUT marking the
  switch enabled in the cached state, then expires; subsequent calls retry
  the DB. Add exponential backoff per consecutive DB failure (1s → 2s → 4s,
  cap 16s). Resets on first successful DB read. Logs at warn on every
  backoff bump. Avoids both (a) the original 5s-of-stale-fail-closed bug
  and (b) the alternative DB-hammer failure mode.
- [ ] **B013-S5 (monthlyCap default 500 vs 0)** — In `llmSpendingGate.ts:288`
  and `:171`, share a single `DEFAULT_MONTHLY_CAP_USD = 500` constant. Apply
  to both checkMonthlyCap and getSpendingSummary.
- [ ] **B014-S5 (getEvolutionVariantsAction no pagination cap)** — Add Zod
  schema with `limit: z.number().int().max(200).default(50)` and `.range()`
  in the query.
- [ ] **B015-S5 (countDescendants N+1)** — In `entityActions.ts:42-71`,
  rewrite as a single recursive CTE / RPC
  `count_descendants(p_entity_type TEXT, p_entity_id UUID)` returning
  total count. **RPC contract**: `SECURITY DEFINER` with `search_path =
  public`; explicit allowlist `IF p_entity_type NOT IN ('run', 'invocation',
  'variant', 'strategy', 'experiment', 'prompt', 'tactic') THEN RAISE
  EXCEPTION ...`; no dynamic SQL (use a CASE expression to dispatch to
  fixed-table queries). Grant: `EXECUTE` only to `service_role`. RLS:
  inherits service_role bypass; explicit `REVOKE EXECUTE ... FROM PUBLIC,
  anon, authenticated`. Migration ships in same PR as the code change;
  CI's deploy-migrations runs before integration tests via the existing
  `needs: [deploy-migrations]` gate.
- [ ] **B016-S5 (createExperimentWithRunsAction non-transactional)** —
  New RPC `create_experiment_with_runs(p_name TEXT, p_prompt_id UUID,
  p_run_configs JSONB)` returns `{experiment_id, run_ids[]}`. **Contract**:
  `SECURITY DEFINER`; `search_path = public`; **JSONB shape validation
  inside the function** via Zod-equivalent `jsonb_typeof` checks +
  required-key existence assertions; reject input where any required field
  is missing or wrong type with `RAISE EXCEPTION 'invalid run_configs:
  ...'`. RLS / grants identical to B015-S5. Wrap experiment+runs INSERT
  in a single transaction (the function body IS the transaction). Migration
  ships in same PR.
- [ ] **B018-S5 (getTacticPromptPerformanceAction no input validation)** —
  Add Zod schema with UUID validation for promptId and length cap on
  tacticName.
- [ ] **B019-S5 (date range parsing loses TZ)** — In `costAnalytics.ts:80`,
  accept ISO datetime in the schema (require T component); document UTC
  expectation.
- [ ] **B020-S5 (dashboard SE math uses biased denominator + zero-default)**
  — In `evolutionVisualizationActions.ts:122-145`, exclude runs whose cost
  lookup returned null (use a sentinel) instead of substituting 0. Update
  SE formula to use only successful lookups.

### Phase 11 — MEDIUM severity: shared utilities + UI (Slices 6 + 7)

- [ ] **B007-S6 (deriveSeed namespace collision on `:`)** — In
  `seededRandom.ts:74-83`, change payload format to length-prefix:
  `${seed}:${namespace.map(s => `${s.length}.${s}`).join(':')}`.
- [ ] **B008-S6 (compareWithBiasMitigation cache unbounded Map)** — In
  `computeRatings.ts:430-459`, accept `cache?: ComparisonCache` instead of
  `Map<string, ComparisonResult>`. Document the LRU evict semantics.
- [ ] **B010-S6 (toDisplayElo NaN propagation)** — In `computeRatings.ts:64-67`,
  add `if (!Number.isFinite(elo)) return DEFAULT_ELO;` guard at top.
- [ ] **B011-S6 (BULLET_PATTERN matches indented code)** — In
  `enforceVariantFormat.ts`, extend `stripCodeBlocks` to handle indented
  fences (any leading whitespace, not just column 0).
- [ ] **B012-S6 (run-evolution-local parseInt invalid)** — In
  `run-evolution-local.ts:102`, validate parsed values: `if
  (!Number.isInteger(iters) || iters < 1) throw new Error('--iterations must
  be a positive integer')`. Same for budget parseFloat.
- [ ] **B013-S6 (refreshCostCalibration `|` in strategy label corrupts
  key)** — In `refreshCostCalibration.ts:62-64`, use a control-character
  delimiter (`\x1f` = unit separator) that can't appear in tactic names.
  Or escape `|` chars in the keyOf format.
- [ ] **B015-S6 (formatDate emits literal "Invalid Date")** — In
  `lib/utils/formatters.ts:111-124`, return `'—'` (em dash) when
  `isNaN(date.getTime())`.
- [ ] **B016-S6 (snapshot rename cannot disambiguate mu/elo collisions)** —
  In `lib/schemas.ts:874-883`, throw if both `mu` and `elo` keys are present
  on the same input object (legitimate writers should never emit both).
- [ ] **B003-S7 (ConfirmDialog onConfirm error swallowed)** — In
  `ConfirmDialog.tsx:36-45`, add a `.catch((err) => { toast.error(err.message);
  setLoading(false); })` block.
- [ ] **B004-S7 (AttributionCharts catch empty + returns null)** — In
  `AttributionCharts.tsx:42-51`, `console.warn` the error and render an
  empty-state with "Failed to load attribution data" instead of returning
  null.
- [ ] **B006-S7 (EloTab x-axis label uses iteration-1)** — In
  `EloTab.tsx:100-101`, use array index `i` for label position to match
  line/dot positions.
- [ ] **B007-S7 (allocation bar widths don't normalize)** — In
  `strategies/new/page.tsx:1009-1023`, normalize each segment width by
  `(percent / Math.max(100, totalPercent)) * 100`. Or use a flex
  proportional layout (`flex-1` with `flex-grow: percent`).
- [ ] **B008-S7 (sortable th lacks keyboard/aria support)** — In
  `EntityTable.tsx:73-86`, mirror the arena page's pattern: `tabIndex={0}`,
  `role="button"`, `aria-sort={...}`, `onKeyDown` handling Enter/Space.
- [ ] **B009-S7 (MetricsTab lacks try/catch)** — In `MetricsTab.tsx:33-36`,
  wrap the Promise.all in try/catch; render error state on failure.
- [ ] **B012-S7 (InvocationDetailContent toLocaleString hydration)** — In
  `InvocationDetailContent.tsx:109`, use the shared `formatDateTime` helper
  that's locale-stable.
- [ ] **B013-S7 (CostEstimatesTab UTC-only date)** — In
  `CostEstimatesTab.tsx:637`, use the shared `formatDate` helper.
- [ ] **B014-S7 (EntityListPage throw during render)** — In
  `EntityListPage.tsx:214-216`, replace the throw with `console.error` +
  render a placeholder div with the error message in dev. Production
  behavior unchanged (no throw, no placeholder).
- [ ] **B015-S7 (preview useEffect early-return without aborting)** — In
  `strategies/new/page.tsx:336-339`, set `setPreviewLoading(false)` in the
  early-return branch and abort any existing controller.
- [ ] **B016-S7 (doLoad fired without await)** — In `EntityListPage.tsx:418,
  433`, `await doLoad()` before calling `props.onActionComplete?.()`.
- [ ] **B017-S7 (execCommand return value ignored)** — In
  `EntityDetailHeader.tsx:48-50`, branch on the return: `if
  (document.execCommand('copy')) setCopied(true); else
  toast.error('Copy failed')`.

## Testing

### Unit Tests

- [ ] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — Phase 1: cost
  tracker unification scenarios (seed + loop share tracker; budget enforced
  across both phases). _(File already exists — extend it. The plan-doc
  Phase 7 fixes the doc-drift that previously cited `pipeline/cost-tracker.ts`.)_
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Phase 3:
  `absorbResult` discards-results regression; Swiss inner-loop abort/kill;
  uncertaintyHistory population.
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` —
  Phase 3: arena-only finalize sets error_code; UNFILTERED pool fix.
- [ ] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — Phase 8:
  `Number.isFinite` on string mu; seed lookup `.maybeSingle()`.
- [ ] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts` —
  Phase 1: retries record cumulative cost; per-purpose write reads from
  scope under parallel; AbortController on timeout.
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — Phase 1:
  RESERVE_MARGIN not double-applied; iteration tracker respects unmargined
  estimate.
- [ ] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — Phase 2:
  dynamic-prefix recompute; invocation-detail-dependent metrics left stale;
  RPC error logged.
- [ ] `evolution/src/lib/metrics/writeMetrics.test.ts` — Phase 2:
  `preserveStale` option behavior.
- [ ] `evolution/src/lib/metrics/computations/propagation.test.ts` — Phase 2:
  filter stale=true rows from aggregations.
- [ ] `evolution/src/lib/metrics/computations/finalization.test.ts` —
  Phase 9: median uncertainty in quadrature.
- [ ] `evolution/src/lib/metrics/computations/tacticMetrics.test.ts` —
  Phase 2: invocation/variant fallback semantics; reduce instead of spread.
- [ ] `evolution/src/lib/metrics/computations/experimentMetrics.test.ts` —
  Phase 2: percentile interpolation parity; dimension validator accepts
  colons; seed-variant inclusion in attribution.
- [ ] `evolution/src/lib/core/Agent.test.ts` — Phase 4: BudgetExceeded catch
  writes execution_detail.
- [ ] `evolution/src/lib/core/Entity.test.ts` — Phase 4: cascade payload
  propagation; getById error semantics; batched parent SELECT.
- [ ] `evolution/src/lib/core/agents/SwissRankingAgent.test.ts` — Phase 9:
  status='no_pairs' when all fail; null winnerId on draw.
- [ ] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — Phase 9:
  idA===idB dedup; new-variant eloDelta from default.
- [ ] `evolution/src/lib/core/entities/InvocationEntity.test.ts` — Phase 4:
  agent_name filter options match real values.
- [ ] `evolution/src/lib/core/agentRegistry.test.ts` (NEW FILE) — Phase 4:
  asserts `getAgentClasses()` returns CreateSeedArticleAgent (B003-S3) and
  that `DETAIL_VIEW_CONFIGS` has a `create_seed_article` key (B004-S3).
  Regression-pin so future agents must register too.
- [ ] `evolution/src/lib/metrics/attributionExtractors.test.ts` (extend) —
  Phase 4: asserts `'create_seed_article'` extractor returns `'seed'`
  (B005-S3). Regression-pin for the missing
  `registerAttributionExtractor` side-effect.
- [ ] `evolution/scripts/refreshCostCalibration.test.ts` (NEW FILE) —
  Phase 2 + Phase 6: covers (a) detail.tactic fallback when detail.strategy
  missing (B016-S4), (b) seed bucket reads detail.generation/ranking not
  detail.seedTitle/seedArticle (B006-S6), (c) `|` in tactic name doesn't
  corrupt key split (B013-S6).
- [ ] `evolution/scripts/backfillInvocationCostFromTokens.test.ts` (NEW
  FILE) — Phase 6: asserts AGENT_TO_COST_METRIC includes
  `reflect_and_generate_from_previous_article` and that costMetric=undefined
  is treated as a hard error, not silent skip (B005-S6).
- [ ] `evolution/scripts/backfillRunCostMetric.test.ts` (NEW FILE; sibling
  to existing `backfillRunCostMetricHelpers.test.ts`) — Phase 2: covers
  argv parser at line 54 — `--run-id=UUID` and `--run-id UUID` (space
  form) both resolve to the same target run (B013-S4).
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — Phase 5:
  clone uses randomUUID; listStrategies handles undefined input;
  deleteStrategy atomic.
- [ ] `evolution/src/services/invocationActions.test.ts` — Phase 5:
  inner-join filter (no IN-list).
- [ ] `evolution/src/services/evolutionActions.test.ts` — Phase 5:
  explanationId validation; queueEvolutionRun rejects invalid input.
- [ ] `evolution/src/services/entityActions.test.ts` — Phase 5: audit log
  fired; recursive CTE descendant count.
- [ ] `src/lib/services/llmSpendingGate.test.ts` — Phase 10: kill-switch
  fail-closed doesn't cache; monthlyCap default unified.
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — Phase 6:
  parseWinner regex + first-word fallback; toDisplayElo NaN guard.
- [ ] `evolution/src/lib/shared/enforceVariantFormat.test.ts` — Phase 6:
  multi-`---` stripping; indented code-fence handling.
- [ ] `evolution/src/lib/shared/seededRandom.test.ts` — Phase 11: deriveSeed
  namespace length-prefix.
- [ ] `evolution/src/lib/schemas.test.ts` — Phase 6: V1/V2 → V3 transform
  pipes through toEloScale; mu/elo collision throws.
- [ ] `evolution/scripts/backfillRunCostMetricHelpers.test.ts` — Phase 2:
  stale-row inclusion, zero-cost inclusion, --run-id parsing.
- [ ] `evolution/scripts/refreshCostCalibration.test.ts` — Phase 2:
  detail.tactic fallback; seed-bucket reads correct fields.

### Integration Tests

- [ ] `src/__tests__/integration/evolution-cost-tracker-unified.integration.test.ts`
  — Phase 1: end-to-end run with budget=$0.10, seed cost=$0.03; assert run
  terminates if loop spend would exceed cap.
- [ ] `src/__tests__/integration/evolution-recompute-dynamic-prefix.integration.test.ts`
  — Phase 2: variant rating drift → cascade marks dynamic prefix stale →
  recompute refills correctly.
- [ ] `src/__tests__/integration/evolution-invocations-test-content-filter.integration.test.ts`
  — Phase 5: 500+ test invocations seeded; assert filter excludes them
  (regression for B002-S5).
- [ ] `src/__tests__/integration/evolution-cascade-delete-payload.integration.test.ts`
  — Phase 4: cascade delete of strategy with N runs; assert visited Set
  prevents re-entry; _skipStaleMarking respected.
- [ ] `src/__tests__/integration/evolution-attribution-seed-included.integration.test.ts`
  — Phase 2: run with seed-only attribution → eloAttrDelta:create_seed_article:seed
  row exists.

### E2E Tests

- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-runs-budget-cliff.spec.ts`
  — Phase 1+3: trigger a budget-cliff run via the wizard; assert run status
  is 'failed' (not 'completed') and dashboard total cost ≤ cap.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-variants-table.spec.ts`
  — Phase 6: assert no console errors (B002-S7 colSpan); assert sortable
  headers respond to keyboard (B008-S7).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategies-wizard.spec.ts`
  — Phase 11: 3-iteration strategy with 60/60/60 percentages; assert
  validation error AND allocation bar normalizes; preview spinner clears
  when totals drop below 100%.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-runs-table-budget-warning.spec.ts`
  — Phase 6: assert ≥80% budget runs render with `bg-warning/15` class
  (B001-S7).

### Manual Verification

- [ ] Run a 3-iteration strategy on staging with a tight budget; verify
  total spend equals seed + iteration spend (not greater).
- [ ] Trigger a variant rating change post-completion; verify
  `eloAttrDelta:*` rows refresh on next read.
- [ ] Click Edit on a Strategy and a Prompt in admin UI; verify the form
  submits without throwing "Unknown action 'edit'".
- [ ] Open the Invocations list and filter by each agent_name option;
  verify each returns non-empty results (B006-S3).
- [ ] Open a run with parent variants in the Variants tab; verify the table
  has 9 properly-styled columns and sortable headers respond to keyboard.

## Verification

### A) Playwright Verification (required for UI changes)

- [ ] Phase 6 UI fixes covered by the new admin-evolution-runs-table-budget-warning,
  admin-evolution-variants-table, admin-evolution-strategies-wizard,
  admin-evolution-runs-budget-cliff specs.
- [ ] Manually walk the strategies wizard, run detail, experiment detail,
  arena leaderboard, and invocations list pages on staging post-merge; diff
  against the .playwright-mcp snapshots from prior sessions.

### B) Automated Tests

- [ ] `npm run test:unit -- --testPathPattern="evolution"` — all green.
- [ ] `npm run test:integration -- --testPathPattern="evolution"` — runs
  against staging DB on CI.
- [ ] `npm run test:e2e -- --grep @evolution` — runs on PRs to main.

## Documentation Updates

Every Phase that touches behavior described in `evolution/docs/**` must
update the matching docs in the SAME PR (per CLAUDE.md docs gate).

- [ ] **Phase 1** → `evolution/docs/cost_optimization.md` (cost-tracker
  unification, RESERVE_MARGIN), `evolution/docs/architecture.md` (seed flow
  shares run-tracker).
- [ ] **Phase 2** → `evolution/docs/metrics.md` (dynamic-prefix recompute,
  percentile interpolation, propagation stale-filter, write-options).
- [ ] **Phase 3** → `evolution/docs/architecture.md` (Swiss inner-loop
  abort/kill semantics, sequential-vs-parallel dispatch_phase field).
- [ ] **Phase 4** → `evolution/docs/entities.md` (cascade payload contract,
  edit action removal), `evolution/docs/agents/overview.md` (CSAA in
  registry, agent_name filter options).
- [ ] **Phase 5** → `evolution/docs/visualization.md` (revalidatePath
  behavior, audit log on entity actions).
- [ ] **Phase 6** → `evolution/docs/rating_and_comparison.md` (parseWinner
  regex), `evolution/docs/visualization.md` (Tailwind safelist /
  static-class branching).
- [ ] **Phase 7** → all 18 docs already have changes scoped above.
- [ ] **Phases 8-11** → relevant section updates per medium fix; each PR
  reviewer enforces.

## Inter-Phase Merge Order & File-Conflict Map

Several files are touched by multiple phases. Phases land in numerical
order (1 → 11) and later phases rebase on earlier-phase merges. Conflict
hot-spots (per-file) and the merge-order resolution:

| File | Phases that touch it | Resolution |
|------|----------------------|------------|
| `runIterationLoop.ts` | 1 (B007-S2 trackBudget caller, B013-S2 LLM client wiring), 3 (B002-S1 absorbResult, B003-S1 Swiss inner loop, B005-S1 history arrays, B007-S1 random_seed mask, B011-S1 stopReason), 8 (B006-S2 parallelSpend correction) | Phase 1 lands first (cost-tracker shape change is the foundation); Phase 3 rebases on Phase 1's cost-tracker call sites; Phase 8 rebases on Phase 3's iteration-result push location. |
| `persistRunResults.ts` | 1 (B009-S2 variant cost null guard), 3 (B004-S1 error_code, B008-S1 unfiltered pool, B012-S1 dispatch_phase, B015-S1 dead seed branch), 9 (B020-S3 v2match draw migration) | Phase 1 first (variant-cost is additive); Phase 3 rebases (error_code + dispatch_phase + dead-branch removal in same area); Phase 9 rebases for match_history migration. |
| `core/Entity.ts` | 4 (B001-S3 + B007-S3 cascade payload, B002-S3 edit handler removal), 9 (B012-S3 N+1 batched SELECT, B015-S3 getById error semantics) | Phase 4 first (cascade payload contract is the API change); Phase 9 rebases on Phase 4's executeAction signature and parent-stale-mark loop. |
| `core/agents/SwissRankingAgent.ts` | 9 (B008-S3 status enum, B020-S3 winnerId null) | Single phase — no cross-phase conflict. |
| `core/agents/MergeRatingsAgent.ts` | 9 (B013-S3 idA===idB dedup, B014-S3 new-variant eloDelta) | Single phase. |
| `services/strategyRegistryActions.ts` | 5 (B001-S5 clone discriminator + migration, B003-S5 Zod input schema, B009-S5 FK constraint + catch) | Single phase — sequence within phase: migration first, then code. |
| `services/entityActions.ts` | 4 (B002-S3 edit removal awareness — entityActions delegates), 5 (B007-S5 audit log, B008-S5 revalidatePath cluster), 10 (B015-S5 count_descendants RPC + caller swap) | Phase 4 lands action removal; Phase 5 audit-log + revalidatePath; Phase 10 swaps the recursive countDescendants for an RPC call (additive — no conflict with Phase 5's logging additions). |
| `evolution/src/lib/schemas.ts` | 3 (B012-S1 dispatch_phase enum addition), 6 (B004-S6 V1/V2→V3 toEloScale wrap), 9 (B020-S3 v2match.winnerId nullable) | Phase 3 first (additive enum field on GFPA detail); Phase 6 rebases (separate transform function); Phase 9 rebases (v2match schema is independent). |
| `evolution/docs/architecture.md`, `metrics.md`, `cost_optimization.md`, `rating_and_comparison.md`, `agents/overview.md`, `reference.md` | 1, 2, 3, 4, 5, 6 (each phase updates per CLAUDE.md docs gate), 7 (bulk drift fixes) | Phase 7 is the LAST PR — it lands after Phase 6 and rebases on every prior phase's doc updates. Phase 7 reviewer specifically validates that Phase 1-6 functional doc updates are preserved beneath Phase 7's drift-fix layer. |

## Per-Phase Rollback Strategy

| Phase | Rollback strategy |
|---|---|
| 1 | Code revert. Cost-tracker unification is API-shape change; revert restores legacy double-tracker. No data writes, no migration. |
| 2 | Code revert + DB rollback for any new RPCs (e.g. preserveStale option). Stale rows continue to drift but no data loss. |
| 3 | Code revert. Pipeline behavior changes are runtime-only. |
| 4 | Code revert. Edit action removal is purely deletion; restore actions array entries. CSAA registration is additive — revert makes seed invocations slightly less attributed. |
| 5 | Code revert per service-action. Each is independent. New `count_descendants` RPC is additive — revert keeps it harmless in DB. |
| 6 | Code revert. Doc rewrites in Phase 7 should land separately so revert affects only docs. |
| 7 | `git revert <sha>` on the doc-only commit. Reviewer post-revert checklist: (a) verify `evolution/docs/README.md` table of contents still resolves all 14 links; (b) verify `architecture.md` "Key File Reference" table paths still match `find evolution/src/lib/pipeline -name '*.ts'`; (c) verify any product surfaces that embed doc snippets (e.g. invocation detail page reads from doc) still render. Doc-only revert affects no runtime behavior, but stale links erode trust. |
| 8 | Code revert per fix. Most are observability additions (logger.warn) — safe. |
| 9 | Code revert. Schema changes (allow null winnerId, agent_status enum extension) require migration revert too. |
| 10 | Code revert per service-action. New RPCs (count_descendants, create_experiment_with_runs) are additive in DB. |
| 11 | Code revert per UI fix. UI fixes are blast-radius-isolated to single components. |

## CI / Deployment Notes

- Each phase ships as its own PR. PR reviewer rejects if matching doc
  updates missing.
- **Migration-bearing phases** (must include `needs: [deploy-migrations]`
  on `integration-evolution` job in the SAME PR — per 2026-04-22 hardening):
  - **Phase 2** — `b028-s4_lock_stale_metrics_updated_at_predicate.sql`
    (extends RPC to honor `preserveStale` semantics under concurrent
    writeMetrics; column `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    is already on `evolution_metrics` per data_model.md:241; existing
    `idx_metrics_stale` partial index covers the predicate).
  - **Phase 5** — `b001-s5_evolution_strategies_clone_lineage.sql` (adds
    `parent_strategy_id`, `clone_index`, partial UNIQUE INDEX),
    `b006-s5_explanation_id_fk.sql` (adds FK if missing),
    `b009-s5_strategy_runs_fk_restrict.sql` (changes FK to RESTRICT).
  - **Phase 9** — `b020-s3_v2match_winnerid_nullable.sql` (allows NULL
    winnerId; backfill historical draws as part of same migration:
    `UPDATE evolution_runs SET match_history = ... WHERE result='draw'
    AND winnerId=idA`), `b008-s3_swissranking_status_enum.sql` (extends
    detail schema enum).
  - **Phase 10** — `b015-s5_count_descendants_rpc.sql`,
    `b016-s5_create_experiment_with_runs_rpc.sql` — both `SECURITY DEFINER`
    with explicit allowlist + JSONB validation; grants restricted to
    `service_role`.
- Phase 7 doc-only PR has NO migration; ships independently. **Doc-update
  conflict resolution**: each Phase 1-6 PR also touches the same docs
  Phase 7 rewrites (cost_optimization.md, architecture.md, metrics.md,
  rating_and_comparison.md, agents/overview.md, reference.md). To avoid
  merge conflicts, **Phase 7 lands LAST** — after Phase 6 — and rebases
  on each prior phase's doc updates. Phase 7's diff is then purely the
  bulk drift fixes (file path renames, RPC signature corrections, model
  pricing) layered on top of the per-phase functional updates.
- No new env vars introduced; B002-S2 calibration loader was already gated
  by `COST_CALIBRATION_ENABLED` (Phase 1 wires the missing init call).

## Bugs Intentionally Out of Scope (LOW severity, defer to cleanup PR)

The user requested coverage of MEDIUM-severity-or-higher only. The
following 32 LOW-severity items from the catalog are deferred to a
follow-up cleanup PR (not this plan):

- Slice 1: B016-S1, B017-S1, B018-S1, B019-S1, B021-S1, B022-S1 (note:
  B016-S1 is bundled into Phase 3 because it's adjacent to seed-context
  changes; the rest defer)
- Slice 2: B017-S2, B018-S2, B019-S2 (B018-S2 is a subset of B007-S2 in
  Phase 1; B019-S2 is a subset of B016-S2 in Phase 8)
- Slice 3: B020-S3, B022-S3
- Slice 4: B026-S4, B027-S4
- Slice 5: B021-S5, B022-S5, B023-S5, B024-S5
- Slice 6: B017-S6, B018-S6, B019-S6 (these were also flagged NOT-A-BUG
  during verification)
- Slice 7: B012-S7, B013-S7, B016-S7, B017-S7 (note: B012-S7 hydration +
  B013-S7 timezone are bundled into Phase 11 because they share UI
  formatter helpers; the rest defer)
- Slice 8: B008-S8, B009-S8, B011-S8, B012-S8, B013-S8, B014-S8, B015-S8,
  B016-S8, B017-S8 (most are bundled into Phase 7's doc rewrite as a
  bulk operation since they all live in the same docs)

Reviewers: do not block this plan on LOW-severity coverage; that's the
follow-up PR's scope.

## Review & Discussion

### Iteration 1 (3 reviewers — Sec/Tech 3, Arch/Integ 3, Test/CI 3)

28 critical gaps surfaced. Headline fixes folded into the plan:

- **B003-S2** (retry recordSpend): rewrote with per-attempt re-reserve so
  budget gate genuinely rejects on retry-overspend.
- **B007-S2** (RESERVE_MARGIN): rewrote with peek-then-reserve so iter
  reject leaves run-tracker untouched (no leak).
- **B009-S5** (deleteStrategy TOCTOU): switched to FK ON DELETE RESTRICT
  + catch 23503; closes the race in READ COMMITTED.
- **B001-S5** (config_hash): reframed — clones SHOULD differ from source;
  use deterministic `(parent_strategy_id, clone_index)` discriminator
  with UNIQUE constraint instead of `Date.now()`/`randomUUID()`.
- **B016-S1**: caught `.eq(col, null)` PostgREST pitfall; switched to
  `.is(...)`. Phase 8 duplicate removed (single owner: Phase 3).
- **B028-S4** (preserveStale): expanded to TWO-LAYER fix — TS option
  + new SQL migration extending `lock_stale_metrics` with `updated_at`
  predicate.
- **B001-S4 + B007-S4** (recompute mapping): added explicit prefix →
  compute-function dispatch table covering `eloAttrDelta:*`,
  `eloAttrDeltaHist:*`, `agentCost:*`, with `RECOMPUTE_SKIPPED` for
  invocation-detail-dependent metrics.
- **B020-S3** (winnerId nullable): enumerated 5 consumers + match_history
  JSONB backfill + Zod auto-migration arm in same PR.
- **B012-S5** (kill-switch fail-closed): added negative-cache window +
  exponential backoff with reset-on-success.
- **B015-S5 / B016-S5** (RPCs): full contract specified — SECURITY
  DEFINER, search_path, allowlist, JSONB validation, REVOKE PUBLIC,
  GRANT service_role.
- **B006-S5** (explanationId existence): switched to FK + catch 23503;
  drops the SELECT-then-INSERT TOCTOU.
- **B002-S2** (calibration cache hydration): added missing fix to Phase 1.
- Phase 1 test path corrected (`infra/trackBudget.test.ts`).
- Migration list now enumerates per-phase migrations with explicit
  `needs: [deploy-migrations]` gate per Phase (Phases 2/5/9/10).
- Phase 7 doc rollback: replaced "trivially revert" with concrete 3-item
  reviewer checklist; Phase 7 explicitly lands LAST to avoid merge
  conflicts with per-phase doc updates.
- Inter-Phase Merge Order & File-Conflict Map added: covers
  runIterationLoop.ts, persistRunResults.ts, Entity.ts, schemas.ts,
  entityActions.ts.
- LOW-severity bugs explicitly listed as out-of-scope (cleanup PR
  follow-up).
- New test files added for B003-S3 / B005-S3 (agentRegistry +
  attributionExtractors), B005-S6 (backfillInvocationCostFromTokens),
  B006-S6 + B016-S4 + B013-S6 (refreshCostCalibration), B013-S4
  (backfillRunCostMetric argv).

### Iteration 2 (3 reviewers — Sec/Tech 5/5 ✓, Arch/Integ 5/5 ✓, Test/CI 5/5 ✓)

**✅ CONSENSUS REACHED.** All 28 iteration-1 critical gaps verified as
resolved. Remaining items were minor cross-reference cleanups (migration
phase mislabel for `b001-s5`, conflict-map row for B015-S5 phase
attribution, two duplicate test entries) — fixed in this same iteration's
clean-up pass.

The plan is ready for execution.
