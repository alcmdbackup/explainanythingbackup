# Look For Bugs Evolution Research

## Problem Statement

Use the `.claude/skills/maintenance/bugs-code/` skill to systematically scan
for bugs in the evolution pipeline (`evolution/src/`, `evolution/scripts/`)
and admin panel (`src/app/api/`, `src/lib/`, plus `src/app/admin/evolution/`).
The skill defines a 4-angle scan methodology (error-handling gaps, race
conditions, null/undefined risks, logic errors), but this project broadens
the scope to ANY type of bug. Output: a deduplicated, severity-ranked list of
confirmed bugs with file/line citations, modeled after the prior bug-hunt
projects.

## Requirements (from user, 2026-05-01)

Look for any type of bug — not just the 4 listed in the skill. Expand to all
bug categories that could affect correctness, data integrity, performance,
security, observability, UX, or test reliability across the evolution
pipeline and admin panel.

## High Level Summary

Eight parallel scan agents covered eight slices of the codebase with
broadened bug categories. Raw yield: **170 candidate bugs**.

A second-pass verification (8 parallel verification agents, each re-reading
the cited code) classified each finding:

| Verdict          | Count | %    |
|------------------|------:|-----:|
| **CONFIRMED** (real bug, accurate description) | **140** | 82% |
| **PARTIAL** (real underlying issue, description needs nuance) | **17**  | 10% |
| **NOT-A-BUG** (claim doesn't hold; false positive) | **12**  | 7% |
| **STALE-DUPLICATE** (cross-slice duplicate, counted once) | **1** | 1% |
| **Total** | **170** | 100% |

**Net real bugs (CONFIRMED + PARTIAL): 157.** Comfortably above the
100-bug target. Per-slice breakdown:

| Slice | Files                          | Total | CONF | PART | NOT  | DUP |
|------:|--------------------------------|------:|-----:|-----:|-----:|----:|
| 1     | Pipeline core                  |  22   |  18  |  3   |  1   |  0  |
| 2     | Pipeline infra                 |  20   |  18  |  1   |  0   |  1  |
| 3     | Core (Agent/Entity/registries) |  22   |  17  |  3   |  2   |  0  |
| 4     | Metrics + bootstrap            |  28   |  21  |  6   |  1   |  0  |
| 5     | Server actions + API + gate    |  24   |  24  |  0   |  0   |  0  |
| 6     | Shared + scripts               |  19   |  13  |  2   |  4   |  0  |
| 7     | Admin UI                       |  18   |  13  |  1   |  4   |  0  |
| 8     | Doc-vs-code drift              |  17   |  16  |  1   |  0   |  0  |
| **Total** |                            | **170** | **140** | **17** | **12** | **1** |

False-positive rate (~7%) is in line with what the prior bug-hunt projects
saw. The PARTIAL category mostly captures cases where the bug is real but
the original description got the direction wrong, the severity wrong, the
practical exploitability wrong, or claimed a downstream consequence that's
masked by an unrelated guard. They still belong in the fix list.

## Verification Verdicts (one line per bug)

Format: `B<id>: <verdict> — <≤25-word justification with file:line>`.
Where the verifier added context that changes severity or scope, the
note appears verbatim.

### Slice 1 — Pipeline core (22 bugs: 18 CONFIRMED, 3 PARTIAL, 1 NOT-A-BUG)

```
B001-S1: CONFIRMED — claimAndExecuteRun.ts:289 builds fresh createCostTracker(config.budgetUsd); runIterationLoop.ts:212 builds another. Seed spend never counted toward run budget.
B002-S1: CONFIRMED — runIterationLoop.ts:534 absorbResult throws BudgetExceededError; for-loop at 558-564 aborts before later fulfilled results are absorbed.
B003-S1: CONFIRMED — Swiss while at runIterationLoop.ts:723 only breaks on no_pairs/converged/budget; no signal/deadline/isRunKilled inside.
B004-S1: PARTIAL — persistRunResults.ts:154/157 don't set error_code, but their status updates ('completed'/'failed') sit outside markRunFailed's `.in('status',[pending|claimed|running])` predicate so race-freedom still holds via status.
B005-S1: CONFIRMED — runIterationLoop.ts:246-247 declares both arrays; grep finds no .push() for uncertaintyHistory or diversityHistory anywhere in file; returned empty.
B006-S1: CONFIRMED — runIterationLoop.ts:570 `if (iterIdx === 0)` inside `if (parallelSuccesses > 0)`; if iter 0 is swiss or has 0 successes, actualAvgCostPerAgent stays null.
B007-S1: CONFIRMED — runIterationLoop.ts:219-228 fallback uses unsigned 64-bit (BigUint64Array); Postgres random_seed BIGINT signed (2^63-1 max), top half overflows.
B008-S1: CONFIRMED — persistRunResults.ts:152 passes raw `result` (unfiltered pool with arena entries) to buildRunSummary in arena-only branch; topVariants/tacticEffectiveness contaminated.
B009-S1: CONFIRMED — claimAndExecuteRun.ts:322 markRunFailed without errorCode; defaults to 'unhandled_error' though classifyError taxonomy defines 'missing_seed_article'.
B010-S1: PARTIAL — direction inverted: parallelSuccesses=0 sets actualAvgCost=estPerAgent (worst-case high); top-up UNDER-dispatches (fewer affordable), not over-dispatches.
B011-S1: CONFIRMED — runIterationLoop.ts:630-633 else hardcodes topUpStopReason='budget_exhausted' for any non-success including LLM error.
B012-S1: CONFIRMED — persistRunResults.ts:316-318 filter `iteration >= 2` excludes top-ups in iter 1 (which ARE sequential) AND includes parallel batches in iter>=2.
B013-S1: PARTIAL — TOCTOU at buildRunContext.ts:336-346 is real but bounded: claim_evolution_run RPC ensures one runner_id per runId; race only on stale-claim re-takeover.
B014-S1: CONFIRMED — swissPairing.ts:40-46 has no maxPairs validation; maxPairs=0 returns [], surfacing as iteration_no_pairs.
B015-S1: CONFIRMED — persistRunResults.ts:550 conditional dead post-Phase 2: pool excludes arena, no in-pool variant has tactic='seed_variant'.
B016-S1: CONFIRMED — buildRunContext.ts:167-176 `.single()` errors on multiple rows; error not checked, falls through to seed regeneration.
B017-S1: CONFIRMED — buildRunContext.ts:71-73 Number.isFinite(rawMu) returns false for Postgres NUMERIC-as-string ('25.0'); silently uses default mu/sigma.
B018-S1: CONFIRMED — claimAndExecuteRun.ts:144,151 silent fallback to 1.0 when budget_cap_usd non-finite; no logger.warn.
B019-S1: CONFIRMED — rankSingleVariant.ts:328-330 catch records {winner:'TIE',confidence:0} with no warn; outage indistinguishable from genuine TIE.
B020-S1: NOT-A-BUG — rankSingleVariant.ts:272 comment matches code; pool.length-1 = opponents excluding self.
B021-S1: CONFIRMED — findOrCreateStrategy.ts:97-104 upsert onConflict 'config_hash' rewrites name+label on existing row.
B022-S1: CONFIRMED — runIterationLoop.ts:844 re-throws non-Budget errors; iterationResults.push at 848-856 never runs, accounting lost.
```

### Slice 2 — Pipeline infra (20 bugs: 18 CONFIRMED, 1 PARTIAL, 1 STALE-DUPLICATE)

```
B001-S2: STALE-DUPLICATE — same as B001-S1.
B002-S2: CONFIRMED — grep shows hydrateCalibrationCache called only from costCalibrationLoader.test.ts; no production caller; cache stays empty.
B003-S2: CONFIRMED — createEvolutionLLMClient.ts:188-200 retries on transient errors; saveLlmCallTracking writes a row per attempt; tracker only debits/releases once.
B004-S2: CONFIRMED — createEvolutionLLMClient.ts:138-140 throws on empty response after rawProvider.complete already returned; reservation released, real $$ paid.
B005-S2: CONFIRMED — createEvolutionLLMClient.ts:159,162 use `await writeMetricMax`; file header comment promises "fire-and-forget" — divergence is real.
B006-S2: CONFIRMED — runIterationLoop.ts:560-561 only adds to parallelSpend when success && cost>0; failed/discarded variants' costs excluded from `remaining` calc.
B007-S2: CONFIRMED — trackBudget.ts:206 calls runTracker.reserve which already applies RESERVE_MARGIN; iter check on :208 uses already-margined value, tightening cap implicitly.
B008-S2: CONFIRMED — claimAndExecuteRun.ts:54-69 catches each tick error to logger.warn; no consecutive-failure counter, no escalation, no backoff.
B009-S2: CONFIRMED — persistRunResults.ts:392 reads `v.costUsd ?? null`; many code paths (arena entries, discarded variants) leave costUsd unset.
B010-S2: CONFIRMED — createEvolutionLLMClient.ts:120-127 uses Promise.race with setTimeout but no AbortController; provider call continues running after timeout fires.
B011-S2: CONFIRMED — createEntityLogger.ts:74-79 only `if (error)` warns Postgrest errors; .catch on line 77 swallows network/auth/exceptions silently.
B012-S2: CONFIRMED — trackBudget.ts:104 throws "must be a positive finite number, got 0"; classifyError.ts:62 only matches "budget" + "too small", surfaces as 'unhandled_error'.
B013-S2: CONFIRMED — trackBudget.ts:62 binds getPhaseCosts to shared; createEvolutionLLMClient.ts:157 reads cumulative totals across siblings — racy under parallel dispatch.
B014-S2: CONFIRMED — createEvolutionLLMClient.ts:108 hardcodes '__unspecified__' for tactic in getCalibrationRow; tactic-keyed rows never tried first.
B015-S2: CONFIRMED — createEvolutionLLMClient.ts:156-157 reads getTotalSpent()/getPhaseCosts() BEFORE the try at line 158; throws would surface after spend recorded.
B016-S2: CONFIRMED — persistRunResults.ts:606 `await new Promise(resolve => setTimeout(resolve, 2000))`; not signal-aware, blocks SIGTERM during finalize.
B017-S2: PARTIAL — trackInvocations.ts:13-49 returns null on DB error; original claim of `invocationId=''` is wrong (function returns null not ''); core issue (silent invocation row loss) still real.
B018-S2: CONFIRMED — runIterationLoop.ts:608 uses raw `actualAvgCost` (unmargined) against `remaining` derived from iter-margined budget; can over-dispatch.
B019-S2: CONFIRMED — persistRunResults.ts:606 sleep is plain setTimeout, not AbortSignal-aware; subset of B016-S2.
B020-S2: CONFIRMED — createEntityLogger.ts:41 reads process.env.EVOLUTION_LOG_LEVEL once at logger creation into closure-bound `minLevel`; runtime env changes ignored.
```

### Slice 3 — Core (22 bugs: 17 CONFIRMED, 3 PARTIAL, 2 NOT-A-BUG)

```
B001-S3: CONFIRMED — RunEntity.ts:113 override signature omits payload; super call line 120 also omits it; cascade _visited/_skipStaleMarking dropped.
B002-S3: PARTIAL — actions[].edit defined (StrategyEntity:169, PromptEntity:55) with no Entity.executeAction handler; UI bypasses via custom updateStrategyAction so not reached, but executeEntityAction('edit') would throw.
B003-S3: CONFIRMED — agentRegistry.ts:21-26 lists only 4 agents (GFPA, RAG, Swiss, Merge); CreateSeedArticleAgent absent.
B004-S3: CONFIRMED — detailViewConfigs.ts has no `create_seed_article` key; CSAA's detailViewConfig not exported into DETAIL_VIEW_CONFIGS map.
B005-S3: CONFIRMED — createSeedArticle.ts has zero registerAttributionExtractor calls; GFPA:311 and RAG:480 do register.
B006-S3: CONFIRMED — InvocationEntity.ts:50-54 lists legacy phase labels; real agent_name values are snake_case (generate_from_previous_article, swiss_ranking, etc.).
B007-S3: CONFIRMED — Entity.ts:135 starts a fresh Set on each top-level delete; B001 makes RunEntity.executeAction drop the payload, breaking cycle protection.
B008-S3: CONFIRMED — SwissRankingAgent.ts:179 `status = budgetCount > 0 ? 'budget' : 'success'`; pure non-budget failures yield 'success' regardless of pairsSucceeded.
B009-S3: NOT-A-BUG — ListFilters.filters typed Record<string, string>; `if (value)` only strips empty strings (intentional). Type-drift hypothetical.
B010-S3: PARTIAL — Entity.ts:82 cast narrows to 4-value union; createEntityLogger's own EntityType matches the cast, no caller invokes createLogger() on variant/prompt/tactic, never fires in practice.
B011-S3: CONFIRMED — RunEntity.ts:83 status options omit 'claimed' (visible-predicate value, line 89) and 'cancelled' (cancel-handler write, line 116).
B012-S3: CONFIRMED — Entity.ts:142-151 issues one SELECT per parent for the same row; RunEntity has 3 parents → 3 round-trips fetching identical rows.
B013-S3: CONFIRMED — MergeRatingsAgent.ts:235-238 calls createRating() twice when idA===idB; second `set(idB, bBefore)` clobbers `set(idA, aBefore)`.
B014-S3: CONFIRMED — MergeRatingsAgent.ts:85 returns eloDelta:0 for variants absent from `before`; newly-added variants always render Δ=0.
B015-S3: CONFIRMED — Entity.ts:120 `if (error) return null;` swallows all errors including transient/RLS, not just no-rows PGRST116.
B016-S3: CONFIRMED — parseReflectionRanking (line 186) drops unknown tactics; by line 367 every entry is valid; the `!isValidTactic` branch unreachable.
B017-S3: CONFIRMED — Agent.ts:179 catch-path writes only cost_usd/success/error_message/duration_ms; execution_detail stays NULL for all non-partial throws.
B018-S3: CONFIRMED — StrategyEntity.ts:102 spreads METRIC_CATALOG.total_matches (timing='at_finalization') into atPropagation; def.timing now misreports lifecycle.
B019-S3: CONFIRMED — agentNames.ts:10 includes 'evolution' but no llm.complete() passes 'evolution'; docblock claims "all four labels" while array has six.
B020-S3: CONFIRMED — SwissRankingAgent.ts:143-148 sets winnerId=idA when result is draw; consumers reading winnerId without `result==='draw'` guard mis-attribute.
B021-S3: NOT-A-BUG — `new GenerateFromPreviousArticleAgent()` per-call (RAG:414) is trivial allocation of stateless class; singleton would suffice but no functional impact.
B022-S3: PARTIAL — tactics/index.ts:53 regex `/[.!?](\s|$)/` stops at period after acronyms (e.g. "U.S." → returns "U.S."); doesn't truncate mid-acronym but mis-detects sentence boundary.
```

### Slice 4 — Metrics + bootstrap (28 bugs: 21 CONFIRMED, 6 PARTIAL, 1 NOT-A-BUG)

```
B001-S4: CONFIRMED — recomputeMetrics.ts:120 iterates only `getEntity('run').metrics.atFinalization` static defs; lock_stale_metrics already cleared dynamic-prefix rows; recompute never refills.
B002-S4: CONFIRMED — experimentMetrics.ts:331 (per-run) uses ceil(n*0.9)-1 vs :207-208 (bootstrap) uses floor(p*n); same nominal percentile resolves to different indices.
B003-S4: CONFIRMED — experimentMetrics.ts:217-220 picks elos[floor(p*n)] (upper of two middle for even n); finalization.ts:41-44 (computeMedianElo) averages two middle.
B004-S4: CONFIRMED — experimentMetrics.ts:472,478 reject any extracted value containing ':'; legitimate dims like 'gpt-4:turbo' silently dropped.
B005-S4: PARTIAL — tacticMetrics.ts:111-113 fallback fires when invocation sum==0; not double-counting (alternatives, not overlap), but fallback misfires on legitimate-zero invocation cost.
B006-S4: CONFIRMED — recomputeMetrics.ts:217 uses `v.mu ?? DEFAULT` with no Number.isFinite guard; inconsistent with :100-102.
B007-S4: CONFIRMED — recomputeMetrics.ts:81 set omits invocation-detail-dependent metrics (cost_estimation_error_pct etc.); compute returns null leaving row at stale=false with old value.
B008-S4: CONFIRMED — propagation.ts:8-67 aggregators read r.value directly; getMetricsForEntities returns all rows incl. stale=true.
B009-S4: CONFIRMED — recomputeMetrics.ts:23 destructures only `data`, discards `error`; RPC failure indistinguishable from race-loss.
B010-S4: CONFIRMED — experimentMetrics.ts:419 `.not('parent_variant_id','is',null)` excludes seed variants, contradicting B052 comment at :411-413.
B011-S4: PARTIAL — experimentMetrics.ts:525-530 deltaOpts omits aggregation_method, but ci_lower/ci_upper are set; UI renders CI from ci_lower/upper regardless; only aggregation badge affected.
B012-S4: CONFIRMED — experimentMetrics.ts:531-569 awaits each writeMetric per (group × level × bucket); no batching.
B013-S4: CONFIRMED — backfillRunCostMetric.ts:54 matches only `--run-id=UUID`; docstring at :12 shows `--run-id UUID` (space form) which silently fails.
B014-S4: CONFIRMED — backfillRunCostMetricHelpers.ts:14 selects any existing 'cost' row without filtering on stale=false; stale rows cause skip-and-leave-stale.
B015-S4: CONFIRMED — backfillRunCostMetricHelpers.ts:58 filters `v > 0`; legitimately-zero-cost runs never get a cost row backfilled.
B016-S4: CONFIRMED — refreshCostCalibration.ts:131 reads only `detail.strategy`; generateFromPreviousArticle.ts:311 registers extractor returning `detail.tactic`; calibration buckets these under SENTINEL.
B017-S4: PARTIAL — finalization.ts:43-44 averages u1+u2 arithmetically (not quadrature); claim's direction reversed — arithmetic OVERestimates vs sqrt(u1²+u2²)/2 for similar magnitudes.
B018-S4: CONFIRMED — tacticMetrics.ts:86 spreads ratings.map result into Math.max; risks RangeError on >~100k variants.
B019-S4: PARTIAL — tacticMetrics.ts:72 hardcodes 25, 8.333; numerically equal to _INTERNAL_DEFAULT_MU/SIGMA; DRY/drift-risk only, no current divergence.
B020-S4: CONFIRMED — tacticMetrics.ts:131-135 hardcodes uncertainty:null while keeping ci_lower/ci_upper; inconsistent shape vs sibling rows.
B021-S4: PARTIAL — experimentMetrics.ts:130-138 uses per-sample sigma as estimator uncertainty for n=1; mathematically SE-of-mean = sigma/sqrt(1) = sigma; conceptually conflated.
B022-S4: CONFIRMED — propagation.ts:17-22 uses 1.96*SE normal-approx for any n>=2; n=2 has 1 dof and 1.96 dramatically under-covers.
B023-S4: CONFIRMED — recomputeMetrics.ts:70-73 catch block comment promises log but no console call exists; double-fault is fully silent.
B024-S4: NOT-A-BUG — experimentMetrics.ts:168 uses (iterations-1) Bessel correction; standard convention; difference vs N is <0.1% at iterations=1000.
B025-S4: CONFIRMED — experimentMetrics.ts:188-214 runs full 1000-iteration loop unconditionally; ci returned null when nRuns<2 but bootstrap work wasted.
B026-S4: PARTIAL — types.ts:189-206 validates outbound only; getEntityMetrics with bad uuid returns [] silently; no crash, no validation.
B027-S4: PARTIAL — tacticMetrics.ts:103 uses `false as unknown as null` double cast; PostgREST `is` accepts boolean literal at runtime; brittle but functional.
B028-S4: CONFIRMED — writeMetrics.ts:84 hardcodes stale:false; race window where markStale's true flip can be reverted.
```

### Slice 5 — Server actions + API + spending gate (24 bugs: 24 CONFIRMED)

```
B001-S5: CONFIRMED — strategyRegistryActions.ts:250 uses `${configHash}_clone_${Date.now()}`; UNIQUE constraint at migration 20260329000001:40 makes ms-collision a real violation.
B002-S5: CONFIRMED — invocationActions.ts:91 still uses `.not('run_id', 'in', '(uuids)')`; 2026-04-22 inner-join fix not applied here.
B003-S5: CONFIRMED — listStrategiesAction at line 99 dereferences input.limit/offset directly; calling without args throws TypeError.
B004-S5: CONFIRMED — arenaActions.ts:321 `.limit(input.limit ?? 100)` with no Math.min cap.
B005-S5: CONFIRMED — tacticActions.ts:177 filters `.eq('tactic', input.tacticName)` while sibling getTacticVariantsAction:157 uses `agent_name`.
B006-S5: CONFIRMED — evolutionActions.ts:143-191 declares `explanationId?: number` with zero validation; floats/Infinity/negatives pass through to BIGINT insert.
B007-S5: CONFIRMED — entityActions.ts:75-97 dispatches delete/archive without ever calling logAdminAction.
B008-S5: CONFIRMED — only cancelExperimentAction calls revalidatePath; create/add/archive/delete actions across experiments, arena, prompts, strategies do not.
B009-S5: CONFIRMED — strategyRegistryActions.ts:299-317 SELECT count then DELETE in two separate statements; queueEvolutionRunAction can race in between.
B010-S5: CONFIRMED — evolutionActions.ts:663 throws "run not found or already in terminal state" for both branches.
B011-S5: CONFIRMED — costAnalytics.ts:95 and :117 await two queries sequentially with no inter-dependency; trivially Promise.all-able.
B012-S5: CONFIRMED — llmSpendingGate.ts:227 caches `{value:true, expiresAt:now+5_000}` after DB error; 5s of cached fail-closed even after recovery.
B013-S5: CONFIRMED — llmSpendingGate.ts:288 defaults `?? 500` while getSpendingSummary:171 returns raw value defaulting to 0; two divergent defaults.
B014-S5: CONFIRMED — getEvolutionVariantsAction (evolutionActions.ts:495-562) has no .range() or .limit().
B015-S5: CONFIRMED — entityActions.ts:42-71 countDescendants recursively for-awaits per-child; deep tree → exponential sequential round-trips.
B016-S5: CONFIRMED — experimentActions.ts:212-242 wraps multi-step inserts in try/catch with manual DELETE rollback; not a DB transaction.
B017-S5: CONFIRMED — evolutionActions.ts:163-171 SELECTs to validate promptId but never validates explanationId existence before insert at :193.
B018-S5: CONFIRMED — tacticPromptActions.ts:32-50 has no Zod schema or input validation.
B019-S5: CONFIRMED — costAnalytics.ts:79-80 hardcodes 'Z' UTC suffix; non-UTC submitter loses up to TZ-offset hours.
B020-S5: CONFIRMED — evolutionVisualizationActions.ts:127 uses `costMap.get(id) ?? 0`; missing-cost runs become 0 in mean+SE math, biasing both downward.
B021-S5: CONFIRMED — shared.ts:94 and :112 type query parameter as `any` with eslint-disable comment.
B022-S5: CONFIRMED — api/evolution/run/route.ts:66 uses `msg.startsWith('Unauthorized')` for 403 routing; brittle.
B023-S5: CONFIRMED — watchdog.ts:83 exports cleanupOrphanedReservations as plain async function with no auth wrapper.
B024-S5: CONFIRMED — evolutionVisualizationActions.ts:109 builds filteredRunIds and :154 builds runIds; both go through getRunCostsWithFallback separately.
```

### Slice 6 — Shared + scripts (19 bugs: 13 CONFIRMED, 2 PARTIAL, 4 NOT-A-BUG)

```
B001-S6: CONFIRMED — enforceVariantFormat.ts:21 HORIZONTAL_RULE_PATTERN has only `m` flag, no `g`; line 49 `replace` strips first match only.
B002-S6: CONFIRMED — computeRatings.ts:351-352 regex `(IS|WINS|...)` matches plain "IS"; both winnerA and winnerB true → falls through to null.
B003-S6: CONFIRMED — computeRatings.ts:367-368 first-word fallback hardcoded to ['A','A.','A,','B','B.','B,']; "Actually B" or "**B**" not matched.
B004-S6: CONFIRMED — schemas.ts:1348-1350 legacyToMu(ord)=ord+25 → ~25-50 range; written directly to eloHistory/seedVariantElo/avgElo without toEloScale.
B005-S6: CONFIRMED — backfillInvocationCostFromTokens.ts:61-66 AGENT_TO_COST_METRIC missing reflect_and_generate_from_previous_article; falls through, skips per-phase metric.
B006-S6: CONFIRMED — refreshCostCalibration.ts:157-158 reads detail.seedTitle/seedArticle but createSeedArticleExecutionDetailSchema only declares generation/ranking; always undefined.
B007-S6: CONFIRMED — seededRandom.ts:75 payload `${seed}:${namespace.join(':')}` collides on `:` chars; deriveSeed(s,'a:b')===deriveSeed(s,'a','b').
B008-S6: CONFIRMED — computeRatings.ts:434 cache param `Map<string, ComparisonResult>` unbounded.
B009-S6: NOT-A-BUG — computeRatings.ts:267-274 truncation drops head; LRU promotion at lines 222-227, 237-238 ensures head IS coldest, not hottest.
B010-S6: PARTIAL — computeRatings.ts:65-66 NaN propagates; +Infinity→3000 and -Infinity→0 (both collapse, NOT "asymmetric" as claimed).
B011-S6: CONFIRMED — enforceVariantFormat.ts:18 BULLET_PATTERN `^\s*[-*+]\s/m` matches indented lines; stripCodeBlocks (line 42) only strips unclosed fences anchored at column 0.
B012-S6: CONFIRMED — run-evolution-local.ts:102 parseInt invalid arg returns NaN; default '3' only applies on undefined; 0 also accepted.
B013-S6: CONFIRMED — refreshCostCalibration.ts:63 keyOf joins with `|`; line 180 split('|') destructures 4 parts — strategy with `|` shifts genModel/judgeModel/phase out of position.
B014-S6: NOT-A-BUG — computeRatings.ts:455 `confidence >= 0.3` cache write is intentional per B033 inline comment.
B015-S6: CONFIRMED — formatters.ts:111-124 `new Date('garbage').toLocaleDateString(...)` returns literal "Invalid Date" with no validity check.
B016-S6: CONFIRMED — schemas.ts:874-883 renameKeys does `out[mapping[k] ?? k] = v`; payload with both legacy `mu` and migrated `elo` collides on `elo`; last-iterated key wins.
B017-S6: NOT-A-BUG — computeRatings.ts:207,219,231 all use identical mode='quality' default; sentinel applies only to identical-text disambiguation.
B018-S6: PARTIAL — processRunQueue.ts:14-19 parseIntArg enforces `val > 0` (claim of "no min" wrong) but no upper bound; --max-duration 1 still accepted.
B019-S6: NOT-A-BUG — computeRatings.ts:267-274 cache.set naturally dedupes (Map semantics); entries() source is a Map so duplicates impossible in normal flow.
```

### Slice 7 — Admin UI (18 bugs: 13 CONFIRMED, 1 PARTIAL, 4 NOT-A-BUG)

```
B001-S7: CONFIRMED — RunsTable.tsx:30 builds class strings via template literal with runtime ${colorVar}; tailwind.config.ts has no safelist.
B002-S7: CONFIRMED — VariantsTab.tsx:157-165 declares 9 <th>; colSpan={8} at lines 171 and 268 leaves the last cell unspanned.
B003-S7: CONFIRMED — ConfirmDialog.tsx:36-45 wraps onConfirm in try/finally with no catch; throws propagate uncaught.
B004-S7: CONFIRMED — AttributionCharts.tsx:42-51 .catch() empty body; line 101 returns null when both entries.length and histogram.total are zero.
B005-S7: NOT-A-BUG — experiments/page.tsx:254-266 omits page/pageSize/onPageChange entirely; EntityListPage.tsx:332 only renders pagination when onPageChange is set.
B006-S7: CONFIRMED — EloTab.tsx:101 uses (h.iteration - 1) while lines/dots at lines 75, 145 use array index i; misalign for non-1..N values.
B007-S7: CONFIRMED — strategies/new/page.tsx:1019 sets each segment width to min(percent, 100) inside flex row; overflow-hidden only clips visually.
B008-S7: CONFIRMED — EntityTable.tsx:74-79 sortable <th> has cursor-pointer + onClick but no tabIndex/role/aria-sort/onKeyDown.
B009-S7: PARTIAL — MetricsTab.tsx:25-40 lacks try/catch (a thrown action would leave loading=true); summary.data null is handled at line 33.
B010-S7: NOT-A-BUG — TacticPromptPerformanceTable.tsx:95-97 reads row.avgElo typed as `number` (tacticPromptActions.ts:14); always finite.
B011-S7: NOT-A-BUG — TacticStrategyPerformanceTable.tsx:133 row.winRate typed `number`; computed with `variantCount > 0 ? ratio : 0` guard at source.
B012-S7: CONFIRMED — InvocationDetailContent.tsx:109 calls new Date(...).toLocaleString() during render; server vs client locale differ → hydration mismatch.
B013-S7: CONFIRMED — CostEstimatesTab.tsx:637 uses .toISOString().slice(0,10); always shows UTC date.
B014-S7: CONFIRMED — EntityListPage.tsx:214-216 throws synchronously inside function body in development with no ErrorBoundary noted; dev-only severity.
B015-S7: CONFIRMED — strategies/new/page.tsx:336-339 early-returns without resetting setPreviewLoading; spinner stays on after total drops below 100%.
B016-S7: CONFIRMED — EntityListPage.tsx:418, 433 fire doLoad() without await before props.onActionComplete?.(); reload errors swallowed.
B017-S7: CONFIRMED — EntityDetailHeader.tsx:48-50 ignores document.execCommand('copy') return value; setCopied(true) fires unconditionally.
B018-S7: NOT-A-BUG — CostEstimatesTab.tsx:474-487 useMemo deps [filtered, sortDir]/[invocations, iterFilter] are stable; sorted only recomputes when these change.
```

### Slice 8 — Doc-vs-code drift (17 bugs: 16 CONFIRMED, 1 PARTIAL)

```
B001-S8: CONFIRMED — architecture.md:17 says maxDuration=800; route.ts:15 sets 300, line 59 uses maxDurationMs:240_000.
B002-S8: CONFIRMED — `cost-tracker.ts` not present anywhere; only `infra/trackBudget.ts` exists; 3 docs cite the wrong path.
B003-S8: CONFIRMED — none of the 13 listed files exist anywhere under evolution/src.
B004-S8: CONFIRMED — `generateVariants`, `rankPool`, `evolveVariants` not found anywhere; legacy text-only docs.
B005-S8: CONFIRMED — migration 20260323000002:12-16 has 3 params (incl. p_max_concurrent INT DEFAULT 5); docs list 2.
B006-S8: CONFIRMED — migration 20260331000002:17-23 has 5-param sync_to_arena incl. p_arena_updates JSONB; docs cite 4-param.
B007-S8: CONFIRMED — modelRegistry.ts deepseek $0.28/$0.42 (not $0.27/$1.10), claude-haiku-4-5 absent from registry, fallback $10/$30 (not $15/$60).
B008-S8: CONFIRMED — `20260319000001_evolution_run_cost_helpers.sql` does not exist.
B009-S8: CONFIRMED — neither `20260321000001` nor `20260318000001` migration files exist.
B010-S8: CONFIRMED — rating_and_comparison.md:185-323 (~141 lines) describes rankPool() in non-existent rank.ts even though preface admits flow replaced.
B011-S8: CONFIRMED — `tacticRegistry.ts` does not exist; only generateTactics.ts/selectTacticWeighted.ts/types.ts/index.ts present.
B012-S8: PARTIAL — field absent from current Zod strategySchema (replaced by per-iteration `maxAgents`), but StrategyConfigDisplay.tsx:38,123-124 still reads it; doc out of date but code drift partial.
B013-S8: CONFIRMED — visualization.md:3 says 15 pages; reference.md:488 says 19; actual page.tsx count is 22.
B014-S8: CONFIRMED — architecture.md:227-228 lists 4 stop reasons; schemas.ts:630 enum has 10.
B015-S8: CONFIRMED — architecture.md:160 says agentType is "generate or swiss"; schemas.ts:394 enum is 3-value incl. 'reflect_and_generate'.
B016-S8: CONFIRMED — arena.md:43,66 cite `pipeline/arena.ts` (file does not exist); functions live in setup/buildRunContext.ts:37 and finalize/persistRunResults.ts:516.
B017-S8: CONFIRMED — architecture.md:142 cites `pipeline/seed-article.ts`; actual file is setup/generateSeedArticle.ts.
```

## False Positives & Direction-Wrong Findings (12 NOT-A-BUG + 17 PARTIAL — note for the planning pass)

**Pure false positives (12 — drop from fix list):**
B020-S1, B009-S3, B021-S3, B024-S4, B009-S6, B014-S6, B017-S6, B019-S6, B005-S7, B010-S7, B011-S7, B018-S7.

**PARTIAL (17 — keep, but adjust the description before fixing):**
- B004-S1 (race-freedom claim partial), B010-S1 (direction inverted), B013-S1 (TOCTOU bounded by claim_evolution_run)
- B017-S2 (invocationId='' was wrong; null is correct)
- B002-S3 (UI bypasses the broken handler), B010-S3 (cast lies but unreachable today), B022-S3 (acronym claim wrong; sentence-boundary issue real)
- B005-S4 (not double-counting — fallback misfire), B011-S4 (CI still renders; only badge missing), B017-S4 (overestimates not underweights), B019-S4 (numerically equal, drift-risk only), B021-S4 (mathematically equal for n=1), B026-S4, B027-S4
- B010-S6 (collapse symmetric, not asymmetric — NaN concern still real), B018-S6 (no min IS guarded, still no max)
- B009-S7 (try/catch concern real, summary.data null is handled), B012-S8 (field still in display code)

**Cross-slice duplicate (1 — already collapsed):** B001-S2 = B001-S1.

## Net Real Bug Count: 157 (CONFIRMED 140 + PARTIAL 17)

Cross-cutting themes that surfaced repeatedly:

1. **Two cost trackers per run** — Agent 1 B1 + Agent 2 B1 both flag that
   `executePipeline` builds a fresh `createCostTracker` for the seed phase
   AND `evolveArticle` builds a separate one for the loop. Seed cost is
   never deducted from the loop budget; combined spend can exceed the
   `budget_cap_usd` cap.
2. **Dynamic-prefix metrics never refreshed by recompute** — Agent 4 B1 +
   Agent 4 B7. `recomputeRunEloMetrics` only iterates static
   `atFinalization` defs; cascade marks `eloAttrDelta:*`, `eloAttrDeltaHist:*`,
   `agentCost:*`, and most cost-estimation metrics stale, but nothing re-fills
   them. After `lock_stale_metrics` clears the flag, those rows sit at
   `stale=false` with stale values until the next finalize.
3. **Pagination + `.in()` URL truncation regressions** — Agent 5 B2 (still
   uses `.not('run_id', 'in', '(uuids)')`), Agent 5 B4/B14 (no limit caps
   on multiple actions), Agent 4 B5 (similar pattern in tactic metrics).
4. **Doc-vs-code drift after the orchestrator refactor** — Agent 8 B3/B4/B16
   confirm three top-level pipeline functions (`generateVariants`, `rankPool`,
   `evolveVariants`) and several files (`rate.ts`, `arena.ts`,
   `cost-tracker.ts`, `seed-article.ts`) are documented but **do not exist** in
   the current codebase.
5. **Format validator + parser logic gaps** — Agent 6 B1 (HORIZONTAL_RULE
   regex missing `g` flag → only first rule stripped per article), Agent 6
   B3 (`parseWinner` first-word fallback misses common LLM prefixes).
6. **Silent error swallowing in finalize / arena / logger** — Agent 1 B2
   (BudgetExceededError aborts loop discarding subsequent fulfilled
   results), Agent 1 B19 (LLM-error catch records confidence=0 with no
   warn), Agent 2 B11 (Promise.resolve().then().catch() swallowing all
   logger DB errors).
7. **Edit action declared but never handled** — Agent 3 B2 (Strategy +
   Prompt expose an `edit` action; `Entity.executeAction` only handles
   rename + delete → submitting Edit form throws).

## Bug Catalog

Organized by slice (so a fix-team can claim a slice). Within each slice,
findings are listed in agent order. Severity in `[BRACKETS]`. Bugs that
overlap across slices are marked with `↔ Bxxx-S<n>` cross-references.

Numbering scheme: `B<NNN>-S<slice>` — e.g. `B001-S1` is bug #1 from slice 1.

---

### Slice 1 — Pipeline core orchestration + run lifecycle (22 findings)

Files: `evolution/src/lib/pipeline/claimAndExecuteRun.ts`,
`loop/runIterationLoop.ts`, `loop/rankSingleVariant.ts`,
`loop/swissPairing.ts`, `finalize/persistRunResults.ts`,
`setup/buildRunContext.ts`, `setup/findOrCreateStrategy.ts`,
`setup/generateSeedArticle.ts`, `classifyError.ts`.

```
B001-S1. [HIGH] claimAndExecuteRun.ts:289-313 — Seed-phase cost tracker detached from run-level cost tracker (↔ B001-S2)
   Category: data integrity / cost attribution
   What's wrong: pre-iteration seed creates fresh createCostTracker(config.budgetUsd); evolveArticle builds its OWN tracker. Seed cost never counted toward total run budget enforcement; result.totalCost understates true spend.
   Repro: budget close to seed cost; observe spend > budget_cap_usd.

B002-S1. [HIGH] runIterationLoop.ts:526-555 — `absorbResult` throw on BudgetExceededError discards subsequent fulfilled results
   Category: data integrity / error handling
   What's wrong: for-loop absorbs Promise.allSettled results; if one rejects with BudgetExceededError, absorbResult re-throws and aborts. Variants from later fulfilled results are paid for but never absorbed.
   Repro: 4 parallel agents, idx 1 rejects BudgetExceeded, idx 2-3 surfaced=true; assert surfacedVariants count.

B003-S1. [HIGH] runIterationLoop.ts:720-803 — Swiss inner loop has no abort/deadline/kill checks
   Category: error handling / observability
   What's wrong: while(swissRound < MAX_SWISS_ROUNDS) only checks signal/deadline/kill at OUTER iteration boundary. SIGTERM/deadline/kill ignored for entire swiss iteration duration.
   Repro: deadlineMs=1s mid-swiss; observe iteration runs to completion.

B004-S1. [HIGH] persistRunResults.ts:149-159 — Arena-only / empty-pool finalize never sets error_code
   Category: data integrity / observability
   What's wrong: both branches update evolution_runs without setting error_code. The race-freedom contract relies on error_code IS NULL to detect "already finalized." Outer catch's markRunFailed could overwrite finalize's error_message.

B005-S1. [HIGH] runIterationLoop.ts:243,246-247,885-886 — uncertaintyHistory + diversityHistory declared, never populated
   Category: doc drift / observability
   What's wrong: arrays init empty, returned in EvolutionResult, persisted into run_summary, rendered by EloTab — but never pushed to. EloTab uncertainty band silently broken.

B006-S1. [MEDIUM] runIterationLoop.ts:570 — actualAvgCostPerAgent only updates from iter 0
   Category: logic / observability
   What's wrong: `if (iterIdx === 0)` means later iterations never update. If iter 0 is swiss or has 0 successes, value stays null forever; budget_floor_observables.actualAvgCostPerAgent is null.

B007-S1. [MEDIUM] runIterationLoop.ts:225-228 — random_seed BigUint64Array can overflow signed BIGINT
   Category: data integrity
   What's wrong: fallback uses unsigned 64-bit (max 2^64-1); Postgres `random_seed BIGINT` is signed (max 2^63-1). Eventually fails write. buildRunContext clamps; direct caller of evolveArticle does not.

B008-S1. [MEDIUM] persistRunResults.ts:149-154 — Arena-only path passes UNFILTERED pool to buildRunSummary
   Category: data integrity
   What's wrong: arena-only branch passes raw `result` (still has arena entries in pool); summary.topVariants/tacticEffectiveness aggregate over arena entries with tactic='arena_*'.

B009-S1. [MEDIUM] claimAndExecuteRun.ts:322 — Seed-failed markRunFailed uses generic 'unhandled_error'
   Category: observability
   What's wrong: classifyError taxonomy has 'missing_seed_article' + budget-exceeded codes; seed-failure path uses default 'unhandled_error'. Operators triaging by error_code can't distinguish.

B010-S1. [MEDIUM] runIterationLoop.ts:580-582 — Parallel-success-zero path silently uses estPerAgent in top-up
   Category: logic
   What's wrong: when parallelSuccesses=0, actualAvgCost := estPerAgent (worst-case); top-up dispatches sequential agents on a worst-case estimate, overshooting budget when 0 successes was due to LLM outage still ongoing.

B011-S1. [MEDIUM] runIterationLoop.ts:633 — Failed top-up sets stopReason='budget_exhausted' even when LLM error
   Category: observability
   What's wrong: `else` branch hardcodes topUpStopReason='budget_exhausted' regardless of actual failure reason; mislabels in dashboards.

B012-S1. [MEDIUM] persistRunResults.ts:311-322 — "Sequential GFSA durations" filter `iteration >= 2` doesn't capture sequential top-ups
   Category: doc drift / observability
   What's wrong: comment claims iter 1 = parallel, later = sequential; reality: top-up shares iteration value with its parallel batch. `iteration >= 2` filters by outer iteration index, not parallel-vs-sequential. Median/avg sequential GFSA duration mis-attributed.

B013-S1. [MEDIUM] buildRunContext.ts:336-354 — random_seed read-then-update race with concurrent runners
   Category: race condition
   What's wrong: not atomic. Two runners reading NULL → both generate distinct seeds → both UPDATE → second wins. Reproducibility broken under stale-claim re-claim.

B014-S1. [MEDIUM] swissPairing.ts:37-44 — `maxPairs=0` silently returns [], masquerades as `iteration_no_pairs`
   Category: input validation
   What's wrong: no validation; caller bug surfaces as legitimate convergence stop.

B015-S1. [MEDIUM] persistRunResults.ts:550 — Dead-code: `generation_method='seed'` unreachable in syncToArena
   Category: doc drift
   What's wrong: after Phase 2 decoupling, no in-pool variant has tactic='seed_variant'. Conditional always returns 'pipeline'.

B016-S1. [LOW] buildRunContext.ts:166-176 — Seed lookup `.single()` errors on multiple rows
   Category: error handling
   What's wrong: silent fall-through to "no arena seed" → re-generates seed → rating-reuse invariant broken + wasteful.

B017-S1. [LOW] buildRunContext.ts:71-74 — Number.isFinite gap on string-typed mu from Postgres NUMERIC
   Category: type safety
   What's wrong: arena entries with NUMERIC-as-string mu/sigma silently get default ratings.

B018-S1. [LOW] claimAndExecuteRun.ts:131-141 — Claim RPC validation accepts strategy_id but doesn't validate budget_cap_usd presence
   Category: input validation
   What's wrong: silent fallback to 1.0 with no log warning if RPC returns NULL/missing.

B019-S1. [LOW] rankSingleVariant.ts:328-330 — LLM-error swallow records {winner:'TIE', confidence:0} with NO warn
   Category: error handling
   What's wrong: transient LLM outage indistinguishable from genuine ties; matchCounts inflated.

B020-S1. [LOW] rankSingleVariant.ts:272 — Off-by-one comment vs actual opponent cap
   Category: logic / docs
   What's wrong: comment misleading; real cap depends on completedPairs.

B021-S1. [LOW] findOrCreateStrategy.ts:88-113 — upsert onConflict overwrites label/name on existing rows
   Category: data integrity
   What's wrong: race-create with different label silently replaces earlier; UI bookmarks of old name break.

B022-S1. [LOW] runIterationLoop.ts:856 — Iteration result push doesn't run on uncaught throw outside known catch
   Category: observability
   What's wrong: non-BudgetExceeded throw from MergeRatingsAgent loses iteration accounting.
```

---

### Slice 2 — Pipeline infra (cost, budget, LLM client, arena) (20 findings)

Files: `cost-tracker.ts` (per docs; actually `infra/trackBudget.ts`),
`infra/createEvolutionLLMClient.ts`, `infra/trackInvocations.ts`,
`infra/createEntityLogger.ts`, `infra/estimateCosts.ts`,
`infra/costCalibrationLoader.ts`, `pipeline/arena.ts` (per docs; actually
spread across setup/buildRunContext.ts + finalize/persistRunResults.ts).

```
B001-S2. [HIGH] claimAndExecuteRun.ts:289 — Seed phase uses isolated cost tracker, double-spending budget (↔ B001-S1)
   Category: data integrity / cost attribution
   What's wrong: same as B001-S1.

B002-S2. [HIGH] infra/costCalibrationLoader.ts:134 — hydrateCalibrationCache never called in production
   Category: doc drift / dead-code feature
   What's wrong: only test callers; cache always empty; even with COST_CALIBRATION_ENABLED=true, EMPIRICAL_OUTPUT_CHARS always wins. Whole shadow-deploy is silently inert.

B003-S2. [HIGH] infra/createEvolutionLLMClient.ts:188-200 — Retries spend real provider $$ while tracker only deducts once
   Category: cost attribution / data integrity
   What's wrong: on attempt === MAX_RETRIES, costTracker.release() — but real provider calls already billed (saveLlmCallTracking row written each attempt). Tracker shows $0 for ~$0.004 spent. Budget gate blind.

B004-S2. [MEDIUM] infra/createEvolutionLLMClient.ts:138-140 — Empty-response throw releases reservation but still pays provider
   Category: cost attribution
   What's wrong: same accounting issue as B003-S2 for empty-response path.

B005-S2. [HIGH] infra/createEvolutionLLMClient.ts:159-167 — Cost-write awaited inside hot path; failures rate-limit pipeline
   Category: performance / observability
   What's wrong: two `await writeMetricMax` per LLM call adds DB round-trips; file header comment promises "fire-and-forget" but they ARE awaited.

B006-S2. [MEDIUM] runIterationLoop.ts:560-563 — parallelSpend excludes discarded-variant cost, inflating top-up headroom
   Category: cost / logic
   What's wrong: accumulator only adds when success && cost > 0; but Agent.run captures own spend even on discard. `remaining = iterBudgetUsd - parallelSpend - topUpSpend` underestimates true spend → top-up over-dispatches.

B007-S2. [HIGH] infra/trackBudget.ts:115-132 — RESERVE_MARGIN double-applied in iteration tracker
   Category: logic / cost
   What's wrong: createIterationBudgetTracker.reserve uses already-margined value from runTracker.reserve in its own check, inflating against iter budget. Net effect: can't fully consume iteration budget.

B008-S2. [MEDIUM] claimAndExecuteRun.ts:54-69 — Heartbeat catches errors but never escalates after N failures
   Category: observability / reliability
   What's wrong: no exponential backoff, no escalation to error level after N consecutive failures, no termination signal back into running pipeline.

B009-S2. [MEDIUM] persistRunResults.ts:392 — Variant-level cost metric uses `v.costUsd ?? null`; many code paths leave costUsd unset
   Category: data integrity / observability
   What's wrong: per-variant cost rollup silently incomplete.

B010-S2. [MEDIUM] infra/createEvolutionLLMClient.ts:120-127 — setTimeout reference leak risk + no AbortController for in-flight provider call after timeout
   Category: races / lifecycle
   What's wrong: timeout fires → catch handles → underlying provider call still in-flight without abort.

B011-S2. [MEDIUM] infra/createEntityLogger.ts:56-82 — Promise.resolve().then().catch() swallows ALL DB errors
   Category: observability / error handling
   What's wrong: only Postgrest-error path warns; network errors / auth failures are silently dropped → log writes can fail invisibly for entire run lifecycle.

B012-S2. [MEDIUM] infra/trackBudget.ts:103-104 — createCostTracker rejects budgetUsd=0 with generic error → surfaces as 'unhandled_error'
   Category: type safety / API design
   What's wrong: classifyError has 'budget_too_small' code; not used.

B013-S2. [HIGH] infra/createEvolutionLLMClient.ts:155-167 — Per-purpose cost write reads SHARED tracker getPhaseCosts under parallel dispatch
   Category: cost attribution / races
   What's wrong: `costTracker.getPhaseCosts()[agentName]` reads SHARED total even when wired through a scope; parallel agents emit racing writes with different aggregates.

B014-S2. [MEDIUM] infra/createEvolutionLLMClient.ts:100-111 — Calibrated lookup uses '__unspecified__' tactic for known-tactic per-call estimate
   Category: cost / logic
   What's wrong: discards agent's actual tactic context. Tactic-specific calibration row never tried even if it exists.

B015-S2. [MEDIUM] infra/createEvolutionLLMClient.ts:155-167 — Cost-write try/catch only wraps the awaits, not the read
   Category: error handling
   What's wrong: getTotalSpent / getPhaseCosts run outside try; if they throw (defensive wrapper), LLM call appears succeeded but function throws.

B016-S2. [MEDIUM] persistRunResults.ts:516-617 — syncToArena retry uses sleep without abort/signal awareness
   Category: lifecycle / responsiveness
   What's wrong: 2s ignore of SIGTERM mid-finalize.

B017-S2. [LOW] infra/trackInvocations.ts:13-49 — createInvocation swallows DB errors and returns null silently
   Category: data integrity
   What's wrong: invocationId='' on null → updateInvocation no-ops → entire invocation row + cost lost on every DB hiccup.

B018-S2. [LOW] runIterationLoop.ts:608 — Top-up loop uses unmargined estPerAgent against iter-tracker-margined budget
   Category: logic
   What's wrong: optimistically over-dispatches when initial estimate too low. (subset of B007-S2)

B019-S2. [LOW] persistRunResults.ts:587-606 — syncToArena retry sleep not cancellable (subset of B016-S2)
   Category: lifecycle

B020-S2. [MEDIUM] infra/createEntityLogger.ts:43-44 — minLevel resolved at logger creation, not per-call; runtime env changes ignored
   Category: observability / config drift
   What's wrong: changing EVOLUTION_LOG_LEVEL after logger build has no effect; matters for long-lived workers.
```

---

### Slice 3 — Core (Agent, agents, entities, registries, tactics) (22 findings)

Files: `core/Agent.ts`, `core/Entity.ts`, `core/agentRegistry.ts`,
`core/entityRegistry.ts`, `core/agentNames.ts`, `core/agents/*`,
`core/entities/*`, `core/tactics/*`, `core/detailViewConfigs.ts`.

```
B001-S3. [HIGH] entities/RunEntity.ts:113-121 — RunEntity.executeAction drops payload, breaking cascade-delete invariants
   Category: data integrity / logic
   What's wrong: override signature is `(key, id, db)` (no `payload?`); cascade calls pass {_visited, _skipStaleMarking:true} — all dropped. Stale-marks duplicated; cycle guard reset.

B002-S3. [HIGH] entities/StrategyEntity.ts:169 + PromptEntity.ts:55 — `edit` action declared but no handler in any entity
   Category: logic / error handling
   What's wrong: Strategy + Prompt expose `edit` action; Entity.executeAction only handles 'rename' and 'delete'. Submitting Edit form throws "Unknown action 'edit'".

B003-S3. [HIGH] core/agentRegistry.ts:21-26 — CreateSeedArticleAgent missing from getAgentClasses()
   Category: data integrity / observability
   What's wrong: only 4 agents registered; any future invocationMetrics CSAA adds won't merge into InvocationEntity. Parity test (entities.test.ts:339) skips CSAA.

B004-S3. [HIGH] core/detailViewConfigs.ts — DETAIL_VIEW_CONFIGS missing `create_seed_article` key
   Category: doc drift / UX
   What's wrong: CSAA declares its own detailViewConfig but no entry in DETAIL_VIEW_CONFIGS; seed invocation pages render fallback. (linked to B003-S3)

B005-S3. [HIGH] agents/createSeedArticle.ts — missing `registerAttributionExtractor` side-effect
   Category: observability / data integrity
   What's wrong: GFPA + ReflectAndGenerate register; CSAA doesn't. Seed variants fall through to legacy fallback that reads detail.strategy (absent on seed) → silently dropped from ELO-attribution rollups.

B006-S3. [HIGH] entities/InvocationEntity.ts:50-54 — agent_name filter options match no real agent_name
   Category: doc drift / data integrity
   What's wrong: filter options are legacy phase labels (generation/ranking/evolution/reflection/iterativeEditing/treeSearch); actual values are generate_from_previous_article/reflect_and_generate_from_previous_article/swiss_ranking/merge_ratings/create_seed_article. Selecting any filter returns 0 rows.

B007-S3. [HIGH] core/Entity.ts:135-138 — cascade-delete `_visited` cycle guard reset on each top-level call (compounded by B001-S3)
   Category: logic / data integrity
   What's wrong: `const visited = (payload?._visited as Set<string>) ?? new Set<string>();` — first top-level delete starts fresh; with B001-S3 dropping payload, recursive descendants lose Set entirely.

B008-S3. [MEDIUM] agents/SwissRankingAgent.ts:179 — status='success' even when 100% pairs fail with non-budget errors
   Category: logic / observability
   What's wrong: `status = budgetCount > 0 ? 'budget' : 'success'`. All-pairs-throw → status='success' despite 0 matches. Schema enum has no 'failure' option.

B009-S3. [MEDIUM] core/Entity.ts:101 — `if (value)` silently drops falsy filter values when type drifts
   Category: logic
   What's wrong: with Record<string,string> drift to allow boolean false, false silently strips filter clause → returns ALL rows.

B010-S3. [MEDIUM] core/Entity.ts:75-86 — `createLogger` `as` cast lies about this.type for variant/prompt/tactic
   Category: type safety / observability
   What's wrong: cast narrows to 4-value union; getEntity('variant').createLogger() writes wrong entity_type.

B011-S3. [MEDIUM] entities/RunEntity.ts:83 — listFilters status options miss `claimed` and `cancelled`
   Category: doc drift / UX
   What's wrong: cancel-action visible predicate reads 'claimed', cancel handler writes 'cancelled' — neither filterable.

B012-S3. [MEDIUM] core/Entity.ts:142-151 — N+1 SELECT for parent stale-mark in delete cascade
   Category: performance
   What's wrong: 3 round-trips per row deleted (3 parents); same row fetched 3x. Same pattern in markParentMetricsStale (lines 186-220).

B013-S3. [MEDIUM] agents/MergeRatingsAgent.ts:234-238 — twin Rating instances when idA===idB
   Category: data integrity / null-safety
   What's wrong: when idA === idB (self-pair sneaks through), TWO independent default Rating objects created; second `set` clobbers first. Pre/post snapshot reads inconsistent state.

B014-S3. [MEDIUM] agents/MergeRatingsAgent.ts:339,360-362 — new variants always show eloDelta:0 in after-snapshot
   Category: logic / observability
   What's wrong: `b ? a.elo - b.elo : 0` — for newly added variants (absent from before), eloDelta=0 even though their actual rating equals OpenSkill default (1500).

B015-S3. [MEDIUM] core/Entity.ts:114-121 — `getById` swallows non-row errors as null
   Category: error handling / observability
   What's wrong: PGRST116 (no rows) AND transient/RLS errors both return null; callers cannot distinguish "missing" from "broken".

B016-S3. [MEDIUM] agents/reflectAndGenerateFromPreviousArticle.ts:367-395 — `isValidTactic(tacticChosen)` branch is dead code
   Category: logic / dead code
   What's wrong: parseReflectionRanking already drops unknowns and throws when result.length===0; the validation block is unreachable.

B017-S3. [MEDIUM] core/Agent.ts:175-189 — non-partial BudgetExceededError catch-path writes no execution_detail
   Category: error handling / observability
   What's wrong: row keeps NULL detail for GFPA/SwissRanking that throw mid-execute; UI shows a failed-budget invocation with no breadcrumbs.

B018-S3. [MEDIUM] entities/StrategyEntity.ts:102-152 — propagation defs spread `METRIC_CATALOG.X` whose timing='at_finalization'
   Category: type safety / data integrity
   What's wrong: spread carries wrong timing into propagation entry; callers reading def.timing get misclassified metric.

B019-S3. [MEDIUM] core/agentNames.ts:10 — `'evolution'` member of AGENT_NAMES is unused/dead
   Category: doc drift
   What's wrong: docblock says "all four labels"; array has six. No caller uses 'evolution' as complete() label.

B020-S3. [LOW] agents/SwissRankingAgent.ts:143-152 — TIE result yields nonsensical winnerId=idA on V2Match
   Category: data integrity
   What's wrong: future consumer joining winnerId without first guarding on result === 'draw' silently attributes draws to idA.

B021-S3. [LOW] agents/reflectAndGenerateFromPreviousArticle.ts:414 — `new GenerateFromPreviousArticleAgent()` allocated per invocation
   Category: performance
   What's wrong: stateless class; module-level singleton would suffice.

B022-S3. [LOW] core/tactics/index.ts:48-64 — `getTacticSummary` regex truncates at acronyms (U.S., e.g.)
   Category: logic
   What's wrong: first-sentence detection splits at first dot+whitespace; "U.S. Constitution" truncates mid-acronym.
```

---

### Slice 4 — Metrics + bootstrap + experimentMetrics (28 findings)

Files: `metrics/registry.ts`, `metrics/writeMetrics.ts`,
`metrics/readMetrics.ts`, `metrics/recomputeMetrics.ts`,
`metrics/computations/{execution,finalization,propagation,tacticMetrics,experimentMetrics}.ts`,
`metrics/attributionExtractors.ts`, `experiments/evolution/experimentMetrics.ts`,
`lib/cost/getRunCostWithFallback.ts`, `scripts/backfillRunCostMetric.ts`,
`scripts/refreshCostCalibration.ts`.

```
B001-S4. [HIGH] metrics/recomputeMetrics.ts:39-77 — Recompute path never refreshes dynamic-prefix attribution metrics
   Category: data integrity
   What's wrong: only iterates static `atFinalization` defs; cascade marks `eloAttrDelta:*`, `eloAttrDeltaHist:*`, `agentCost:*` stale, but lock_stale_metrics clears them and nothing refills. Stale values masquerade as fresh.

B002-S4. [HIGH] experimentMetrics.ts:331 vs 207-210 — Same percentile uses ceil-1 for per-run, floor for bootstrap
   Category: logic
   What's wrong: per-run computeRunMetrics uses Math.ceil(elos.length*0.9)-1; bootstrapPercentileCI uses Math.floor(percentile*n). p90Elo's "value" field disagrees with itself between scalar and aggregate paths.

B003-S4. [HIGH] experimentMetrics.ts:217-220 — `actuals` always picks upper-of-two-middle, never averages — wrong for even-n medians
   Category: logic
   What's wrong: bootstrapPercentileCI returns higher of two middle values for even n; computeMedianElo does average. n=2, elos=[100,200] → bootstrap=200, finalization=150.

B004-S4. [HIGH] experimentMetrics.ts:472,478 — Dimension validator rejects values containing ':'
   Category: data integrity
   What's wrong: `!extracted.includes(':')` blanket-rejects; legitimate dims like model versions ('gpt-4:turbo') silently dropped.

B005-S4. [HIGH] computations/tacticMetrics.ts:111-113 — Transition fallback double-counts when invocation sum legitimately 0
   Category: data integrity
   What's wrong: when filter via `.not('variant_surfaced','is',false)` returns 0, falls through to summing variant.cost_usd from the same (filtered) variants → double-count.

B006-S4. [HIGH] metrics/recomputeMetrics.ts:217 — `recomputeInvocationMetrics` skips Number.isFinite guard on raw mu/sigma
   Category: data integrity
   What's wrong: NaN/Infinity passes through to dbToRating, poisoning all elo computations; writeMetric throws on the finite check.

B007-S4. [HIGH] metrics/recomputeMetrics.ts:81 — MATCH_DEPENDENT_METRICS Set omits invocation-detail-dependent metrics
   Category: data integrity
   What's wrong: cost_estimation_error_pct, estimated_cost, *_estimation_error_pct, agent_cost_*, *_dispatched, *_duration_ms all depend on ctx fields not populated in recompute → compute returns null → loop skips → row sits at stale=false with stale value.

B008-S4. [HIGH] computations/propagation.ts:8-67 — Aggregations include stale source rows blindly
   Category: data integrity / races
   What's wrong: getMetricsForEntities returns ALL rows including stale=true; aggregateSum/Avg use r.value directly. Mid-recompute child reads gives parent intermediate values.

B009-S4. [HIGH] metrics/recomputeMetrics.ts:23-30 — RPC error swallowed — failure to claim treated identically to "another worker won the race"
   Category: error handling / observability
   What's wrong: RPC outage / typo / permission denial returns null/empty → function returns silently → stale rows stay stale forever.

B010-S4. [HIGH] experimentMetrics.ts:415-419 — `.not('parent_variant_id','is',null)` excludes seed variants — contradicts B052 fix comment
   Category: data integrity / doc drift
   What's wrong: B052 comment claims seed/legacy variants now included via 'agent_name + legacy' path, but SQL filter still excludes any with null parent_variant_id (which seed variants always have).

B011-S4. [HIGH] experimentMetrics.ts:523-537 — Attribution writeMetric calls omit `aggregation_method` opt
   Category: observability
   What's wrong: opts has uncertainty/ci_lower/ci_upper/n but no aggregation_method. metricColumns formatCISuffix conditions on aggregation_method ∈ {bootstrap_*, avg}; with NULL it returns empty → CI never rendered.

B012-S4. [HIGH] experimentMetrics.ts:531-569 — N+1 sequential writes per finalize; no batching
   Category: performance
   What's wrong: writeMetric awaited individually for each (group × level × bucket); 5 agents × 5 dims × 10 buckets × 3 levels ≈ 750 sequential round-trips.

B013-S4. [HIGH] scripts/backfillRunCostMetric.ts:54 vs docstring — Code only parses `--run-id=UUID` but docs show `--run-id UUID`
   Category: doc drift
   What's wrong: process.argv.find(a => a.startsWith('--run-id=')) only catches equals form; space form falls through to ALL-COMPLETED-RUNS mode silently.

B014-S4. [HIGH] scripts/backfillRunCostMetricHelpers.ts:14 — Existing-cost-row check ignores stale flag
   Category: data integrity
   What's wrong: backfill skips runs with stale-but-existing cost rows that may have wrong values.

B015-S4. [HIGH] scripts/backfillRunCostMetricHelpers.ts:58 — Filter `v > 0` drops legitimately-zero-cost runs
   Category: data integrity
   What's wrong: zero-cost runs never get backfilled; perpetually appear as "no cost data" in fallback warn loop.

B016-S4. [HIGH] scripts/refreshCostCalibration.ts:131 — Strategy bucket reads `detail.strategy` only — blind to Phase 8's `detail.tactic`
   Category: data integrity / doc drift
   What's wrong: GFPA-family agents put dimension under detail.tactic; calibration buckets every new-agent invocation under SENTINEL strategy.

B017-S4. [MEDIUM] computations/finalization.ts:43-44 — Median uncertainty averaged arithmetically instead of in quadrature
   Category: logic / statistics
   What's wrong: (u1+u2)/2 underweights joint uncertainty; correct: sqrt(u1²+u2²)/2.

B018-S4. [MEDIUM] computations/tacticMetrics.ts:86 — `Math.max(...ratings.map(...))` risks stack overflow on large tactics
   Category: performance
   What's wrong: spread on 200k+ variants → "Maximum call stack size exceeded".

B019-S4. [MEDIUM] computations/tacticMetrics.ts:72 — Hardcoded TrueSkill defaults (25, 8.333) drift from canonical _INTERNAL_DEFAULT_MU/SIGMA
   Category: doc drift
   What's wrong: every other recompute path imports the constants; tacticMetrics inlines literals.

B020-S4. [MEDIUM] computations/tacticMetrics.ts:131-135 — `win_rate` row drops uncertainty but keeps CI — inconsistent shape
   Category: data integrity / observability

B021-S4. [MEDIUM] experimentMetrics.ts:130-138 — n=1 case treats per-sample uncertainty as SE-of-mean
   Category: logic / doc drift
   What's wrong: ci=[val ± 1.96*s] uses sample SD as if SE-of-mean; semantically wrong for population mean CI.

B022-S4. [MEDIUM] computations/propagation.ts:17-22 — `aggregateAvg` uses normal-approx CI for n=2 with no minimum sample guard
   Category: logic / observability
   What's wrong: no min-n threshold; n=2 normal-approx CI is highly unreliable but rendered as ±X in UI.

B023-S4. [MEDIUM] metrics/recomputeMetrics.ts:62-73 — Double-fault swallows re-mark error silently (no log)
   Category: observability

B024-S4. [MEDIUM] experimentMetrics.ts:144-176 — bootstrapSE uses `iterations-1` (Bessel) on bootstrap distribution itself
   Category: logic / statistics

B025-S4. [MEDIUM] experimentMetrics.ts:188-214 — bootstrapPercentileCI runs 1000 iterations even when nRuns<2
   Category: performance
   What's wrong: full bootstrap loop done, result discarded; should early-return.

B026-S4. [LOW] metrics/types.ts:189-206 — MetricRowSchema validates rows out of DB but no validation on entityId args going in
   Category: type safety / observability
   What's wrong: getEntityMetrics(db, 'run', 'undefined') returns [] silently.

B027-S4. [LOW] computations/tacticMetrics.ts:103 — `false as unknown as null` double-cast on PostgREST `.not('variant_surfaced','is',false)`
   Category: type safety
   What's wrong: bypasses TS type system; brittle to PostgREST wire-format changes.

B028-S4. [LOW] metrics/writeMetrics.ts:71-86 — Every plain upsert hardcodes `stale: false` regardless of caller intent
   Category: races
   What's wrong: race window where Entity.markStale's true flip can be reverted by slightly-later writeMetrics that has stale value.
```

---

### Slice 5 — Server actions + API + spending gate (24 findings)

Files: `services/{adminAction,shared,evolutionActions,experimentActions,strategyRegistryActions,arenaActions,variantDetailActions,invocationActions,logActions,costAnalytics,costEstimationActions,entityActions,tacticActions,tacticPromptActions,tacticStrategyActions,evolutionVisualizationActions}.ts`,
`src/app/api/evolution/run/route.ts`, `src/lib/services/llmSpendingGate.ts`,
`evolution/src/lib/ops/{watchdog,orphanedReservations}.ts`.

```
B001-S5. [HIGH] strategyRegistryActions.ts:250 — Date.now() in clone config_hash collides on concurrent millisecond
   Category: data integrity
   What's wrong: two admins cloning same source in same ms → identical config_hash; unique index violation OR breaks "find or create" lookups. Use randomUUID().

B002-S5. [HIGH] invocationActions.ts:91 — `.not('run_id', 'in', '(uuids)')` regression — IN list URL overflow
   Category: data integrity
   What's wrong: still uses the pattern that the 2026-04-22 sweep identified as broken at scale (~36KB at 984 test strategies); test invocations leak into page when list >400 ids.

B003-S5. [HIGH] strategyRegistryActions.ts:202 — listStrategiesAction crashes when input is undefined
   Category: null/undef
   What's wrong: no Zod schema, no input?.limit guard; calling without args throws TypeError, surfaces as 500.

B004-S5. [HIGH] arenaActions.ts:321 — getArenaComparisonsAction limit not capped (DoS)
   Category: performance / security
   What's wrong: limit: 10_000_000 attempted; OOM risk.

B005-S5. [HIGH] tacticActions.ts:177 — getTacticRunsAction filters by `tactic` column while sibling actions use `agent_name`
   Category: data integrity
   What's wrong: tactic column population may not run on legacy invocations; silent zero-results regression vs sibling getTacticVariantsAction.

B006-S5. [HIGH] evolutionActions.ts:159 — queueEvolutionRunAction missing explanationId integer validation
   Category: type safety / security
   What's wrong: no Zod int().positive(); 1.5/Infinity/-1/MAX_SAFE_INTEGER+1 all accepted; floats silently rounded by BIGINT.

B007-S5. [HIGH] entityActions.ts:75 — executeEntityAction missing audit log of admin action
   Category: observability / security
   What's wrong: dispatcher for delete/archive on any entity (incl. cascade); never calls logAdminAction. Forensic gap.

B008-S5. [HIGH] experimentActions.ts:230 — cancelExperimentAction has revalidatePath; createExperimentWithRunsAction does not
   Category: doc drift / UX correctness
   What's wrong: also missing on addRunToExperimentAction, createArenaTopic, archiveArenaTopic, deleteArenaTopic, archivePrompt, deletePrompt, createPrompt, updatePrompt, create/update/clone/archive/deleteStrategyAction.

B009-S5. [HIGH] strategyRegistryActions.ts:296 — deleteStrategyAction count check not atomic with delete (TOCTOU)
   Category: races / data integrity
   What's wrong: SELECT count then DELETE — between, queueEvolutionRun targeting that strategy → orphaned run.

B010-S5. [MEDIUM] evolutionActions.ts:646 — killEvolutionRunAction conflates "not found" with "already completed"
   Category: error handling / UX

B011-S5. [MEDIUM] costAnalytics.ts:62-100 — getCostSummaryAction issues two sequential awaits that could be parallel
   Category: performance

B012-S5. [MEDIUM] llmSpendingGate.ts:208 — kill-switch fail-closed caches `value: true` after DB error
   Category: logic / observability
   What's wrong: 5s of LLMKillSwitchError thrown for transient DB blip even after recovery; alarm fires from no real toggle.

B013-S5. [MEDIUM] llmSpendingGate.ts:288 — monthlyCap default 500 conflicts with documented defaults
   Category: doc drift / data integrity
   What's wrong: checkMonthlyCap defaults to 500 if config row missing; getSpendingSummary defaults to 0. Two different defaults for same setting.

B014-S5. [MEDIUM] evolutionActions.ts:560 — getEvolutionVariantsAction has no pagination cap
   Category: performance / DoS

B015-S5. [MEDIUM] entityActions.ts:42-71 — countDescendants runs N+1 sequential queries
   Category: performance
   What's wrong: ~5,000 sequential round-trips on a strategy with 100 runs × 50 variants.

B016-S5. [MEDIUM] experimentActions.ts:213-240 — createExperimentWithRunsAction rollback is best-effort, not transactional
   Category: data integrity
   What's wrong: partial commit + rollback failure → orphaned IDs logged only; partial experiment left behind.

B017-S5. [MEDIUM] evolutionActions.ts:141-223 — queueEvolutionRunAction does not validate explanationId existence
   Category: data integrity
   What's wrong: promptId checked via SELECT; explanationId inserted blindly. Inconsistent error UX.

B018-S5. [MEDIUM] tacticPromptActions.ts:33-50 — getTacticPromptPerformanceAction is open: no input validation
   Category: security
   What's wrong: tacticName 10MB string accepted; promptId malformed UUID surfaces raw PostgREST error (info leak).

B019-S5. [MEDIUM] costAnalytics.ts:80 — date range parsing loses timezone control
   Category: logic / data integrity
   What's wrong: appends UTC Z to date-only string; PST "today" submission silently drops up to 8 hours.

B020-S5. [MEDIUM] evolutionVisualizationActions.ts:122-145 — dashboard SE math uses biased denominator + zero-default cost
   Category: logic
   What's wrong: cost lookups silently returning 0 pull mean+SE toward zero, falsely inflating dashboard precision.

B021-S5. [LOW] services/shared.ts:94-114 — applyNonTestStrategyFilter / applyTestContentColumnFilter use `any` for query type
   Category: type safety
   What's wrong: column-name typo silently passes tsc; only fails at PostgREST runtime.

B022-S5. [LOW] api/evolution/run/route.ts:66 — unauthorized check uses `msg.startsWith('Unauthorized')`
   Category: security / fragility
   What's wrong: string-prefix-matching error message; if requireAdmin's wording changes, regresses to 500 for unauth.

B023-S5. [LOW] ops/orphanedReservations.ts (or watchdog.ts):84 — cleanupOrphanedReservations exported with no auth wrapper
   Category: security
   What's wrong: any future server-context import bypasses requireAdmin; future API route exposing it would be unauthenticated DB-mutating endpoint.

B024-S5. [LOW] evolutionVisualizationActions.ts:163-169 — runIds vs filteredRunIds compute different lists, get queried twice
   Category: logic
   What's wrong: same run hit by two parallel cost queries, racing the cost cache.
```

---

### Slice 6 — Shared utilities + scripts + types (19 findings)

Files: `lib/types.ts`, `lib/schemas.ts`, `lib/shared/{rating,computeRatings,reversalComparison,comparisonCache,formatValidator,formatValidationRules,formatRules,selectWinner,textVariationFactory,errorClassification,strategyConfig,seedArticle,validation,seededRandom,hashStrategyConfig,enforceVariantFormat}.ts`,
`lib/comparison.ts`, `lib/utils/formatters.ts`,
`scripts/{processRunQueue,run-evolution-local,syncSystemTactics,refreshCostCalibration,backfillInvocationCostFromTokens}.ts`.

```
B001-S6. [HIGH] shared/enforceVariantFormat.ts:48-50 — stripHorizontalRules drops only ONE rule per article (no `g` flag)
   Category: logic / data integrity
   What's wrong: HORIZONTAL_RULE_PATTERN has `m` flag but NOT `g`; replace strips first match only. Articles with two `---` separators keep the second → trips bullet rejection.

B002-S6. [HIGH] shared/computeRatings.ts:340-371 — parseWinner's "TEXT A IS|WINS|..." regex includes plain `IS` → ambiguous matches
   Category: logic / data integrity
   What's wrong: "Text A is the original draft; Text B is more polished" matches both winnerA and winnerB via plain IS; misclassified as TIE. Should require verb like BETTER/WINS/SUPERIOR.

B003-S6. [HIGH] shared/computeRatings.ts:367-368 — parseWinner first-word fallback misses common LLM prefixes ("Actually B", "**B**")
   Category: logic
   What's wrong: hardcoded ['A','A.','A,','B','B.','B,'] fallback; "Actually, B." returns null; comparison falls into 0.3 partial-failure rating.

B004-S6. [HIGH] lib/schemas.ts:1313-1450 — V1/V2 → V3 transform produces mu-scale (~25-50) values but assigns to eloHistory (Elo scale ~1200)
   Category: data integrity / units mismatch
   What's wrong: `legacyToMu(ord) = ord + 3*V2_DEFAULT_SIGMA` returns ~25-50; written directly into eloHistory/topVariants[].elo/seedVariantElo/tacticEffectiveness.avgElo. Should pipe through toEloScale().

B005-S6. [HIGH] scripts/backfillInvocationCostFromTokens.ts:61-66 — AGENT_TO_COST_METRIC missing reflect_and_generate_from_previous_article
   Category: data integrity / observability
   What's wrong: new agent type's cost falls through all `if (costMetric === ...)` branches; contributes to plan.runLevel.cost but $0 to generation_cost / ranking_cost / seed_cost.

B006-S6. [HIGH] scripts/refreshCostCalibration.ts:154-172 — seed_title/seed_article buckets read non-existent keys from execution_detail
   Category: doc drift / data integrity
   What's wrong: reads detail.seedTitle / detail.seedArticle but createSeedArticleExecutionDetailSchema only has `generation` and `ranking`. Both lookups always undefined; calibration table never gets seed rows.

B007-S6. [MEDIUM] shared/seededRandom.ts:74-83 — deriveSeed namespace join collisions on `:` characters
   Category: data integrity / reproducibility
   What's wrong: payload joined by ':'; deriveSeed(s, 'a:b') === deriveSeed(s, 'a', 'b'). Breaks parallel-safe reproducibility guarantee.

B008-S6. [MEDIUM] shared/computeRatings.ts:430-459 — compareWithBiasMitigation cache parameter is unbounded Map
   Category: performance / memory
   What's wrong: optional `cache?: Map<string, ComparisonResult>` has no eviction.

B009-S6. [MEDIUM] shared/computeRatings.ts:267-274 — ComparisonCache.fromEntries truncation drops oldest, but the "head" may be hot
   Category: logic / cache correctness
   What's wrong: LRU promotion in get() moves hits to tail; truncation by tail-N silently drops never-promoted but recently-set entries.

B010-S6. [MEDIUM] shared/computeRatings.ts:64-67 — toDisplayElo clamp creates asymmetric +Infinity/-Infinity collapse + NaN propagation
   Category: data integrity / display
   What's wrong: NaN / +Inf / -Inf each produce different non-finite outcomes; no NaN guard.

B011-S6. [MEDIUM] shared/enforceVariantFormat.ts:18-21 — BULLET_PATTERN matches inside fenced code that escaped stripCodeBlocks
   Category: false-positive validation
   What's wrong: indented openers ("    ```") not stripped; bullet line inside survives → "Contains bullet points" rejection.

B012-S6. [MEDIUM] scripts/run-evolution-local.ts:102 — parseInt('--iterations 0' / invalid) silently produces 0/NaN; loop blows up
   Category: error handling / input validation
   What's wrong: `Math.floor(100/0) === Infinity`; `--iterations foo` → NaN → empty iterationConfigs → schema reject deep in pipeline. Budget parseFloat similarly accepts NaN.

B013-S6. [MEDIUM] scripts/refreshCostCalibration.ts:62-64,178-180 — strategy label containing `|` corrupts bucket key split
   Category: data integrity
   What's wrong: keyOf joins with `|`, key.split('|') destructures 4 parts; "foo|bar" tactic name yields 5 parts → wrong column values.

B014-S6. [MEDIUM] shared/computeRatings.ts:455 — partial-failure cache writes lock in transient low-confidence results
   Category: logic
   What's wrong: confidence===0.3 (one pass null) cached; subsequent calls return cached value instead of retrying the LLM that failed once. Locks in transient loss.

B015-S6. [MEDIUM] lib/utils/formatters.ts:111-124 — formatDate / formatDateTime emit literal "Invalid Date" for bad input
   Category: error handling / observability
   What's wrong: no validation, no '—' fallback like numeric formatters; renders garbage.

B016-S6. [MEDIUM] lib/schemas.ts:1163,1180 — snapshot rename preprocessor cannot disambiguate genuine `mu` from legacy `mu→elo` migration
   Category: data integrity / migration
   What's wrong: renameKeys does `out[mapping[k] ?? k] = v`; two source keys mapping to same destination collide on Object.entries() iteration order.

B017-S6. [LOW] shared/computeRatings.ts:217 — ComparisonCache.makeKey "identical" sentinel on missing-mode default mismatch
   Category: logic
   What's wrong: caller forgetting optional 4th `mode` arg silently bypasses cache.

B018-S6. [LOW] scripts/processRunQueue.ts:25 — --max-duration default 6_000_000 ms but parseIntArg accepts any positive int (no min)
   Category: input validation
   What's wrong: --max-duration 5 starts runner with 5ms budget; runs immediately abort.

B019-S6. [LOW] shared/computeRatings.ts:267-274 — fromEntries does not deduplicate keys
   Category: data integrity
   What's wrong: duplicate keys silently collapsed by Map.set; later wins regardless of which was live.
```

---

### Slice 7 — Admin UI (React, hydration, filters, a11y) (18 findings)

Files: `src/app/admin/evolution/**/*.tsx`,
`evolution/src/components/evolution/**/*.{ts,tsx}`.

```
B001-S7. [HIGH] components/evolution/tables/RunsTable.tsx:30 — Dynamic Tailwind class `bg-[var(${colorVar})]/15` produces no CSS
   Category: logic / styling (data integrity)
   What's wrong: Tailwind JIT only ships static class strings; runtime-constructed classes never make it into the bundle. !/!! budget warning renders without background or color tint — visual signal broken for runs ≥80%/≥90% of budget.

B002-S7. [HIGH] components/evolution/tabs/VariantsTab.tsx:171,268 — `colSpan={8}` but table has 9 columns
   Category: UX / data integrity
   What's wrong: 9 columns declared (Rank, Rating, 95% CI, Matches, Tactic, Iteration, Parent, Persisted, Actions); empty + expanded rows span 8 → unstyled extra cell.

B003-S7. [MEDIUM] components/evolution/dialogs/ConfirmDialog.tsx:36-45 — Errors in onConfirm swallowed; dialog stays open with no toast
   Category: error handling / UX
   What's wrong: try/finally with no catch; loading flips back to false but no feedback. Failure looks like "nothing happened".

B004-S7. [MEDIUM] components/evolution/tabs/AttributionCharts.tsx:42-51 — Catch swallows errors silently and component returns null, hiding fetch failures
   Category: observability / error handling
   What's wrong: empty .catch + early return null when entries.length===0 → fetch failure indistinguishable from "no data".

B005-S7. [HIGH] src/app/admin/evolution/experiments/page.tsx:260 — `totalCount={experiments.length}` defeats pagination
   Category: logic / UX
   What's wrong: totalPages = ceil(loaded/pageSize) always equals 1; deeper experiments unreachable.

B006-S7. [MEDIUM] components/evolution/tabs/EloTab.tsx:100-101 — X-axis label uses `iteration - 1` while line/dots use array index
   Category: data integrity / UX
   What's wrong: labels drift when iteration values aren't strictly 1..N.

B007-S7. [MEDIUM] src/app/admin/evolution/strategies/new/page.tsx:1009-1023 — Allocation bar widths don't normalize, overflow on total > 100
   Category: UX
   What's wrong: each segment width is min(percent, 100); 3 segments at 60% each overflow container; last iteration hidden past right edge.

B008-S7. [MEDIUM] components/evolution/tables/EntityTable.tsx:73-86 — Sortable `<th>` lacks keyboard / aria support
   Category: accessibility
   What's wrong: cursor-pointer + onClick, no tabIndex/role/aria-sort/onKeyDown; keyboard users can't sort. Used by Variants/Experiments/Invocations/Strategies.

B009-S7. [MEDIUM] components/evolution/tabs/MetricsTab.tsx:33-36 — No try/catch + summary.data may be null despite success
   Category: error handling / null safety
   What's wrong: action throws → setLoading never cleared → loading skeleton forever. Action returns data:null → downstream .totalIterations crashes.

B010-S7. [LOW] components/evolution/tabs/TacticPromptPerformanceTable.tsx:95-97 — "Elo Delta" column ignores null avgElo, renders no CI
   Category: data integrity / doc drift
   What's wrong: row.avgElo - 1200 = NaN/-1200 for null avgElo; sibling tables render with [CI lower, CI upper] — inconsistent.

B011-S7. [LOW] components/evolution/tabs/TacticStrategyPerformanceTable.tsx:133 — `row.winRate` not null-guarded
   Category: data integrity
   What's wrong: (null * 100).toFixed(1) renders "NaN%".

B012-S7. [LOW] src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx:109 — `toLocaleString()` hydration mismatch
   Category: SSR / hydration
   What's wrong: server vs client locale differ for non-en-US users; hydration warning. Use formatDate (already in repo).

B013-S7. [LOW] components/evolution/tabs/CostEstimatesTab.tsx:637 — Date renders as raw UTC ISO; misleads non-UTC users
   Category: UX / timezone
   What's wrong: `toISOString().slice(0,10)`; PT 23:30 shows as next day. Sort breaks at midnight UTC.

B014-S7. [MEDIUM] components/evolution/EntityListPage.tsx:214-216 — `throw new Error` during render in dev
   Category: error handling / DX
   What's wrong: synchronous throw without ErrorBoundary unmounts entire admin shell.

B015-S7. [MEDIUM] src/app/admin/evolution/strategies/new/page.tsx:336-339 — Preview useEffect early-returns without aborting in-flight request
   Category: races / observability
   What's wrong: spinner stays on after total drops below 100%; stale response can land into setDispatchPlan after user changed inputs.

B016-S7. [LOW] components/evolution/EntityListPage.tsx:418,433 — `doLoad` fired without await after async operations; errors swallowed
   Category: error handling
   What's wrong: parent's onActionComplete runs as if everything succeeded even when reload fails.

B017-S7. [LOW] components/evolution/sections/EntityDetailHeader.tsx:48-50 — `document.execCommand('copy')` fallback can return false silently
   Category: error handling / observability
   What's wrong: "Copied!" indicator flashes even when nothing landed on clipboard.

B018-S7. [LOW] components/evolution/tabs/CostEstimatesTab.tsx:474-487 — Sort+filter useMemo array spread+sort runs on every parent render
   Category: performance (minor)
   What's wrong: useMemo invalidates on every render; duplicated work.
```

---

### Slice 8 — Doc-vs-code drift (17 findings)

Files: 18 docs under `evolution/docs/**/*.md` cross-checked against the
actual code paths they cite.

```
B001-S8. [MEDIUM] architecture.md:14-17 vs api/evolution/run/route.ts:15,59 — API maxDuration doc claims 800s, code uses 300s
   Category: doc-drift / doc-stale-constant
   What's wrong: doc says maxDuration=800 (Vercel limit) and pipeline gets (800-60)*1000ms; code: maxDuration=300 and maxDurationMs=240_000.

B002-S8. [MEDIUM] architecture.md:405,623 + reference.md:24 + cost_optimization.md:86 vs infra/trackBudget.ts — `cost-tracker.ts` file path doesn't exist
   Category: doc-drift / doc-stale-path
   What's wrong: docs reference evolution/src/lib/pipeline/cost-tracker.ts; actual: infra/trackBudget.ts.

B003-S8. [MEDIUM] rating_and_comparison.md:41,187 + agents/overview.md:125 + reference.md:20-25 vs codebase — `rating.ts`, `pipeline/rank.ts`, `generate.ts`, `evolve.ts`, `finalize.ts`, `arena.ts`, `run-logger.ts`, `invocations.ts`, `seed-article.ts`, `strategy.ts`, `experiments.ts`, `prompts.ts`, `errors.ts` — none exist
   Category: doc-drift / doc-stale-path
   What's wrong: massive file-path drift in reference.md key files table; 12 files documented that don't exist.

B004-S8. [HIGH] agents/overview.md:36,123,171 + rating_and_comparison.md:189 vs codebase — `generateVariants()`, `rankPool()`, `evolveVariants()` functions DO NOT EXIST
   Category: doc-drift / doc-claim-unimplemented
   What's wrong: agents/overview.md describes three top-level pipeline functions in detail. None exist anywhere in the codebase. Orchestrator-driven pipeline uses evolveArticle() + Agent.run() + rankNewVariant() + swissPairing() instead.

B005-S8. [MEDIUM] architecture.md:128 + reference.md:349 + data_model.md:354 vs supabase/migrations/20260323000002:12-16 — `claim_evolution_run` RPC signature drift
   Category: doc-drift / doc-stale-signature
   What's wrong: docs say (p_runner_id TEXT, p_run_id UUID DEFAULT NULL); actual has third param p_max_concurrent INT DEFAULT 5.

B006-S8. [MEDIUM] data_model.md:374-376 + arena.md:86 vs supabase/migrations/20260331000002:17-23 — `sync_to_arena` signature + limits drift
   Category: doc-drift / doc-stale-signature
   What's wrong: 4-param signature documented; actual 5-param incl p_arena_updates JSONB. p_matches deprecated/ignored. 1000-matches limit doesn't exist.

B007-S8. [MEDIUM] reference.md:256-259 vs src/config/{modelRegistry,llmPricing}.ts — model pricing table out of date
   Category: doc-drift / doc-stale-constant
   What's wrong: deepseek-chat docs $0.27/$1.10 vs actual $0.28/$0.42; claude-haiku-4-5 not in registry; fallback pricing $15/$60 documented vs actual $10/$30.

B008-S8. [LOW] cost_optimization.md:460 vs supabase/migrations/ — referenced cost-helpers migration doesn't exist
   Category: doc-drift / doc-stale-path
   What's wrong: 20260319000001_evolution_run_cost_helpers.sql doesn't exist; schema in 20260322000006.

B009-S8. [LOW] reference.md:430-431 + data_model.md:330-340 vs supabase/migrations/ — referenced RLS migrations 20260321000001 + 20260318000001 don't exist
   Category: doc-drift / doc-stale-path

B010-S8. [MEDIUM] rating_and_comparison.md:185-323 vs codebase — entire "Two-Phase Ranking Pipeline" section describes non-existent code
   Category: doc-drift / doc-claim-deprecated
   What's wrong: 140 lines reasserting the legacy flow as authoritative even though the section preface admits it's replaced. References to MIN_TRIAGE_OPPONENTS, selectOpponents, getBudgetTier, top20Cutoff — none exist.

B011-S8. [LOW] architecture.md:251 + reference.md:283 vs core/tactics/generateTactics.ts — claimed file path tactics/tacticRegistry.ts doesn't exist
   Category: doc-drift / doc-stale-path

B012-S8. [LOW] strategies_and_experiments.md:70 vs codebase — `maxVariantsToGenerateFromSeedArticle` field documented but doesn't exist
   Category: doc-drift / doc-claim-unimplemented

B013-S8. [LOW] visualization.md:3 + reference.md:488 vs src/app/admin/evolution* — admin page count drift (15/19 vs actual 22)
   Category: doc-drift / doc-stale-list

B014-S8. [LOW] architecture.md:227-228 vs schemas.ts:630 — Stop reasons list incomplete
   Category: doc-drift / doc-stale-list
   What's wrong: doc lists 4; schema enum has 10. agents/overview.md documents seed_failed which architecture.md omits.

B015-S8. [LOW] architecture.md:161 vs schemas.ts:394 — IterationConfig agentType enum drift (2 vs 3)
   Category: doc-drift / doc-stale-list
   What's wrong: doc mentions only 'generate' and 'swiss'; actual enum is 3-value incl 'reflect_and_generate'. Doc inconsistent with itself.

B016-S8. [LOW] arena.md:43,66 vs setup/buildRunContext.ts:37 + finalize/persistRunResults.ts:516 — `pipeline/arena.ts` file doesn't exist
   Category: doc-drift / doc-stale-path

B017-S8. [LOW] architecture.md:143 vs setup/generateSeedArticle.ts — claimed file `pipeline/seed-article.ts` doesn't exist
   Category: doc-drift / doc-stale-path
   What's wrong: doc internally inconsistent (line 143 vs the key files table at line 629).
```

## Summary Counts

| Slice | Files                          | Total | HIGH | MEDIUM | LOW |
|-------|--------------------------------|-------|------|--------|-----|
| 1     | Pipeline core                  | 22    | 5    | 12     | 5   |
| 2     | Pipeline infra                 | 20    | 5    | 11     | 4   |
| 3     | Core (Agent/Entity/registries) | 22    | 7    | 12     | 3   |
| 4     | Metrics + bootstrap            | 28    | 16   | 9      | 3   |
| 5     | Server actions + API + gate    | 24    | 9    | 11     | 4   |
| 6     | Shared + scripts               | 19    | 6    | 10     | 3   |
| 7     | Admin UI                       | 18    | 3    | 8      | 7   |
| 8     | Doc-vs-code drift              | 17    | 1    | 6      | 10  |
| **Total** |                            | **170** | **52** | **79** | **39** |

Known cross-slice duplicates / overlaps (collapse during planning):
- B001-S1 ↔ B001-S2 (seed cost tracker isolation) — 2 reports, 1 bug
- B007-S2 (RESERVE_MARGIN double-applied) ↔ B018-S2 (top-up unmargined) — partial overlap
- B017-S3 (Agent.run BudgetExceeded catch detail loss) ↔ B019-S1 (rankSingleVariant LLM-error swallow) — different layers, related
- B016-S2 ↔ B019-S2 (syncToArena retry sleep not cancellable) — duplicate in same slice

Rough unique count after dedup-pass-1: **~150-155 unique bugs**, comfortably
exceeding the 100-bug target.

## Documents Read

### Core docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### All evolution docs (18 files under evolution/docs/**/*.md)
- evolution/docs/README.md, architecture.md, arena.md, cost_optimization.md,
  curriculum.md, data_model.md, entities.md, logging.md, metrics.md,
  minicomputer_deployment.md, rating_and_comparison.md, reference.md,
  strategies_and_experiments.md, visualization.md, agents/overview.md,
  sample_content/{api_design_sections,filler_words}.md,
  planning/multi_iteration_strategy_support_evolution_20260415/...

### Project-relevant docs
- docs/planning/use_playwright_find_bugs_ux_issues_20260422/...planning.md
- docs/planning/look_for_bugs_evolution_20260401/...planning.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/error_handling.md

### Skill spec
- .claude/skills/maintenance/bugs-code/SKILL.md

## Code Files Read

By the 8 scan agents — broadly: every file under
`evolution/src/lib/pipeline/`, `evolution/src/lib/core/`,
`evolution/src/lib/metrics/`, `evolution/src/lib/shared/`,
`evolution/src/services/`, `evolution/scripts/`, `evolution/src/components/`,
`src/app/admin/evolution/`, `src/app/api/evolution/`,
`src/lib/services/llmSpendingGate.ts`, plus selected migration files in
`supabase/migrations/`. Per-agent file lists are in agent transcripts.
