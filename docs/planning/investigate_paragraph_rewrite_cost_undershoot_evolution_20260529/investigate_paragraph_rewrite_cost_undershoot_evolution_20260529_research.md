# Investigate Paragraph Rewrite Cost Undershoot Evolution Research

## Problem Statement
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## Requirements (from GH Issue #1138)
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## High Level Summary

**Where did the budget go? Mostly nowhere — the "98.8% under cap" headline is a cap-sizing illusion, not a runtime leak.** The strategy `863bc454…` never sets `perInvocationCapUsd` (the field isn't even on `IterationConfig`'s zod schema), so the agent falls back to `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` (`ParagraphRecombineAgent.ts:54`). That cap is roughly 33× the projector's `upperBound` ($0.012) and ~80× the actual median spend ($0.0048). The cap is a decorative safety rail; comparing against it inflates the perceived undershoot. The user is most likely seeing the `SlotsTab.tsx:138-139` per-slot row (`budget: $0.0333 spent: $0.0004`, 1.2%) — that ratio is a derivation off the oversized default cap, not a real budget signal.

**The only "real" gap is ~50%, vs the projector's `expected = $0.0093`.** When the projector is recomputed with each invocation's actual inputs (parent length, slot count, output chars), it matches actual spend within 1–7% — the math is mechanically correct. The 50% delta to the static-defaults projection comes almost entirely from inputs, dominated by `length_under` rewrite drops collapsing per-slot rank counts (53–98% of the gap) and shorter actual rewrite outputs (~620–790 chars vs 1000 assumed, 11–32% of the gap).

**The 20260529 length_under fix is deployed but the LLM ignores it.** Commit `72ebfa80` landed in main at 2026-05-29 19:29 UTC; source confirms the 1.2 temperature floor (`ParagraphRecombineAgent.ts:62-76`) and "never below ~0.85x" directive (`buildParagraphRewritePrompt.ts:26`). Three post-fix invocations ran ~6 hours later and their index-0 `length_under` drop rates are 100% / 92% / 100% — worse than the pre-fix 89%. Per Round 4 quantification: index-0 output ratios are 0.50–0.74 (mean 0.67), well below the 0.8 validator floor — the model isn't barely missing, it's over-compressing aggressively at temp 1.2.

### Findings

- **Cap is decorative**: `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` is ~33× projector upperBound ($0.012); no strategy can override it because `IterationConfig` (`schemas.ts:664-666`) doesn't expose `perInvocationCapUsd`.
- **Projector math is right**: when re-run with each invocation's actual inputs, predicts actual cost within 1–7%.
- **Dominant attributable cause**: `length_under` drops collapse per-slot rank pools (16.7% of slots end with 1 surviving rewrite and skip ranking entirely). Drop rates: 37.0% / 41.7% / 30.6% / 40.7% across the four invocations.
- **20260529 fix shipped but failed**: post-fix index-0 drop rates (100%/92%/100%) are worse than pre-fix (89%). LLM is ignoring the explicit length-floor directive. Index-0 output ratios are 0.50–0.74 (mean 0.67) — well below the 0.8 validator floor.
- **Per-slot self-abort and pre-final-ranking gates never fire**: per-slot spend is 0.5–1.5% of per-slot budget; both gates are safety rails sized against the oversized default cap.
- **llmCallTracking regression (evolution-wide)**: zero `evolution_*` `call_source` rows since 2026-02-22; 0 of 1,009 staging tracking rows on May 29–30 have evolution call_sources; no "save failed" warn logs — the INSERT isn't even being attempted. Per R4C: the wiring through `claimAndExecuteRun.ts:187-229` → `callLLM` → `saveTrackingAndNotify` (`llms.ts:145-149`) is structurally correct in main; the regression is likely either (a) staging running stale pre-April-28 code (commit `3e6a7290`) or (b) the spending gate's `getKillSwitch` throwing `LLMKillSwitchError` before tracking writes. **Not fixable inside this project** — flag as follow-up.
- **`execution_detail` is under-instrumented**: every `rewrites[i].costUsd === 0`, no per-slot rank cost, no rewrite temperature, no slot status for self-abort.
- **Display surfaces silently drop `paragraph_recombine_cost`**: `RunsTable.tsx:143-158` inline "Spent" fallback and `getRunCostWithFallback.ts:114-131` Layer 2 both omit it (plus `debate_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`). Latent for these 4 runs (Layer 1 catches), active for any future paragraph-recombine-only run with a missing rollup.
- **Dead Layer 3**: `getRunCostWithFallback.ts:66-86` references the `evolution_run_costs` view dropped in `20260323000004_drop_legacy_metrics.sql`. Layer 3 errors and falls through to Layer 4 = 0.
- **Cost attribution is correct**: invocation `cost_usd` ≈ `paragraph_recombine_cost` rollup + ~$0.0007 article-level rank (correctly bucketed to `ranking_cost`). MAX-vs-SUM `writeMetricMax` is benign today because each run has exactly 1 paragraph_recombine invocation.

### Recommendation

- **Ship now (G + F + H)**: (G) observability — instrument `execution_detail` with per-rewrite cost/temp/status, fix the targeted slice of the `llmCallTracking` regression (wire `db`/`runId`/`invocationId` into the per-slot LLM client at `ParagraphRecombineAgent.ts:352-354`), delete or rebuild the dead Layer 3 view; (F) cap right-sizing — lower `DEFAULT_PER_INVOCATION_CAP_USD` to `$0.05` and add `perInvocationCapUsd` to `IterationConfig`'s zod schema so strategies can override; (H) display fixes — add `paragraph_recombine_cost` (and the other missing purposes) to `RunsTable.tsx:143-158` and `getRunCostWithFallback.ts` Layer 2.
- **Conditional (I → C)**: re-diagnose why gemini-2.5-flash-lite ignores the 20260529 length-floor directive at temp 1.2 before attempting another drop-rate fix. Per R4D, the concrete fix is likely **(a) hard char-count directive** ("at least N characters" instead of "~0.85x") **plus (b) per-index temperature override** (drop index-0 to ~0.7 while keeping 1/2 at 1.6/2.0). If neither works, accept ~35–40% drop rate and recalibrate the projector to assume it.
- **Reject**: B (per-slot budget rebalance — self-abort never fires, nothing to rebalance) and D (cost-attribution audit — accounting confirmed correct).
- **Frame the user response**: lead with "the cap is decorative, the real gap is ~50% vs the projector and driven by `length_under` drops the 20260529 fix did not move." Don't lead with the 98.8% number.

### Out of scope but flag

The **evolution-wide `llmCallTracking` regression** is bigger than this investigation: zero evolution call_source rows have been written since 2026-02-22, across all agents (not just paragraph_recombine). It silently breaks every per-call cost audit, drilldown, and any dashboard that depends on `llmCallTracking`. `evolution/docs/cost_optimization.md` claims this audit gap ended 2026-04-30 — it did not. Per R4C, the fix that closed the original Feb 22 regression (commit `3e6a7290`, April 28) is in main and structurally correct; the remaining gap is either (a) staging is running stale pre-fix code, or (b) a new regression in the spending gate's Next.js coupling that throws pre-tracking. **Fixing the broader regression is part of (G) above for the paragraph_recombine slice only; the full diagnosis deserves its own tracked project.**

### Original Round-1 hypothesis list (kept for traceability)

1. Population is tiny (n=4 invocations from a single strategy).
2. Hard cap is decorative.
3. Projector over-estimates by ~2×.
4. Per-slot self-abort + pre-final-ranking gate never fire.
5. `length_under` drops drive most of the gap.
6. No `llmCallTracking` audit rows.
7. `getRunCostWithFallback.ts` Layer 2 omits `paragraph_recombine_cost`.
8. Potential MAX-vs-SUM artifact in `writeMetricMax(paragraph_recombine_cost)` (latent, not active).

### Where the gap actually lives (Round 1 working hypothesis, confirmed by Round 2-3)

| Layer | Gap fraction | Mechanism |
|---|---|---|
| Cap vs. projector envelope | ~97% of the gap | Cap = $0.40 is ~33× the projector's `expected`. The cap is essentially decorative; comparing against it inflates the perceived undershoot. |
| Projector vs. actual | ~50% of the projector | Projector assumes 12 slots; staging used 9 slots in 2 of 4 invocations. Also `length_under` drops short-circuit ranking calls. And the projector's `avgParaChars = 8000/N` assumption may not match the actual seed article length. |
| Effective cap ($0.030) vs. actual ($0.0048) | ~84% of the effective cap | Same as above plus the strategy itself runs at a much smaller `budgetUsd` ($0.05 × 60% = $0.030) than the documented envelope, so the cap derivation isn't matching the agent's default. |

### Open questions (for Round 2+)

- What's the actual seed article length on each invocation? Does the projector's `8000` assumption match reality?
- Why 9 slots in 2 invocations (vs. the doc's claim of 12-default)? Are those articles smaller, or is `maxParagraphsPerInvocation` configured lower on this strategy?
- Are the 4 invocations all post-`20260529` fix (which raised the temperature ladder floor and tightened the "tighten" directive)? If yes, the `length_under` drop rate should be lower than the pre-fix 89%/37%; check `execution_detail.slots[*].rewrites[*].dropReason`.
- Is `evolution_cost_calibration` populated for `paragraph_rewrite` on staging? (Calibration loader includes `paragraph_rewrite` but NOT `paragraph_rank`.) If unpopulated, projector falls back to hardcoded 1000-char output estimate.
- Does the projector's expected match the cost the agent ACTUALLY incurs when broken down by phase (rewrite vs rank)? Or is one layer overshooting projector while the other undershoots?

## Round 2 Findings

### Where the gap really lives (Round 2 attribution, ranked)

When the projector is RECALCULATED with each invocation's ACTUAL inputs (parent length, slot count, rewrite count, output chars, models), it predicts within **1–7% of actual cost**. So the projector math is mechanically correct; the gap is entirely from inputs:

| Contributor | Share of projector→actual gap | Mechanism |
|---|---|---|
| **(c) Rewrite drops collapsing per-slot rank count** | **53–98%** (dominant) | Projector assumes `slots × M × min(M, cap) = 81–108` matches; reality is `23–37` matches because ~30–42% of rewrites are `length_under`-dropped. Each drop kills the per-slot rank pool — slots with 1 surviving rewrite skip ranking entirely (16.7% of slots / 7 of 42). |
| **(d) Shorter actual rewrite outputs** | 11–32% | Projector assumes 1000 chars/rewrite; reality is 620–790 chars. Output token cost is 4× input pricing on gemini-flash-lite, so this leverages outsized. |
| **(b) Fewer slots than the 12-cap** | 0–30% | 2 of 4 invocations had 9 slots (article shorter than expected); projector uses static `maxParagraphsPerInvocation = 12`. |
| (a) Article length variance | small, signed both ways | One article was 11,163 chars (longer than 8000 default); mostly cancels across the median. |
| (e) Residual | 0–7% | Calculation rounding + minor prompt-overhead variance. |

### What's NOT the gap (ruled out by Round 2)

- **Cost calibration is not in play.** `evolution_cost_calibration` is **empty** on staging (0 rows). Even with `COST_CALIBRATION_ENABLED='true'`, the loader would return null and hardcoded constants would be used. Calibration is irrelevant to this investigation.
- **Per-slot self-abort never fires.** Per-slot `spentUsd` is 0.5–1.5% of `perSlotBudgetUsd` ($0.0003–$0.0006 vs $0.0333–$0.0444). The 0.9× threshold is nowhere near being hit.
- **Pre-final-ranking gate never fires.** Invocation-level `spentUsd` is ~1% of `perInvocationCap`.
- **No format-validation discards.** All 4 invocations surfaced their recombined variant.
- **Metric-write GREATEST is not corrupting data.** Each run has exactly 1 paragraph_recombine invocation (1:1 ratio), so the MAX-vs-SUM hypothesis is moot here. (Still a latent risk if a strategy ever uses multiple paragraph_recombine iterations.)
- **`getRunCostWithFallback` Layer-2 omission is dormant** for these runs — the `cost` rollup row exists for all 4 (Layer 1 catches them). The Layer 2 omission is real but latent.

### Active observability/display defects surfaced in Round 2

1. **`evolution_run_costs` view (Layer 3 of `getRunCostsWithFallback`) was DROPPED in `20260323000004_drop_legacy_metrics.sql` and never recreated.** Layer 3 calls error and fall through to Layer 4 = 0 + warn. Latent here but a real bug for any run that falls through Layer 1+2.
2. **`RunsTable.tsx:143-158` inlines its OWN sum** that omits `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost` from the "Spent" column fallback. Active code, latent only because `cost` rollup exists for these runs. **Any future paragraph_recombine-only run with a missing rollup would under-report by the full paragraph_recombine spend.**
3. **`llmCallTracking` is empty for ALL 4 invocations** — not just the per-slot LLM calls (expected — db-less client) but also the article-level rank call (which uses the invocation-scoped client WITH db/runId). This is a broader audit gap than just paragraph_recombine. Across the entire staging DB, only 1 row exists with `evolution_invocation_id IS NOT NULL`, and even that row has `estimated_cost_usd=NULL`. **Either the evolution LLM-call-tracking write path is largely unwired, or it's silently failing.**
4. **`execution_detail` is missing per-rewrite cost, per-slot rank cost, and rewrite temperature** — every `rewrites[i].costUsd === 0`, no `slot.ranking.cost`, no `slot.status` for self-abort, no temperature record. Phase split (rewrite vs per-slot rank) must be inferred from token counts which aren't persisted either. **Major instrumentation gap.**
5. **Cost-attribution split confirmed**: invocation `cost_usd` ($0.0043–$0.0054) ≈ `paragraph_recombine_cost` rollup ($0.0036–$0.0046) PLUS a consistent $0.0007 residual = the article-level rank call (which flows to `ranking_cost`, not `paragraph_recombine_cost`). So `paragraph_recombine_cost` rollup is correctly the rewrite+per-slot-rank cost; the article rank cost is correctly bucketed separately.
6. **Total run cost breakdown** — these 4 runs each spend ~$0.023–$0.025, of which paragraph_recombine accounts for ~$0.005 (~20%) and the rest is the run's seed-generation iteration (`generation_cost ≈ $0.010` + `ranking_cost ≈ $0.009`). So **the "paragraph_recombine undershoot" question is really about that 20% slice, not the whole run.**

### Length_under fix status check (anomaly)

Drop rates per invocation:
- `83c9a188` (pre-20260529 fix run): 10/27 = **37.0%**
- `5786ecc0` (post-fix): 15/36 = **41.7%** (HIGHER than pre-fix)
- `97bf53eb` (post-fix): 11/36 = **30.6%**
- `e0d5c052` (post-fix): 11/27 = **40.7%**

**The 20260529 fix (raised temperature floor + explicit lower-length-floor directive) does NOT appear to have reduced `length_under` drops on staging.** Possible explanations:
- The fix was for the index-0 "tighten" directive specifically (the worst offender at 89% drop on slot 0); the aggregate drop rate over all rewrites may not move much if drops are now more uniformly distributed.
- The deployed code path on staging may differ from main branch (e.g., the runs ran before the fix actually deployed, or the migration sequence affects which path is hit).
- The fix landed but its impact on the aggregate drop rate is marginal because temperature-1.2 still has many short generations.

This is the highest-priority Round 3 question because if drops can be cut to ~5–10%, the projector's match count would be hit and the projector→actual gap would shrink dramatically.

### Working answer to the user's question (provisional, to refine in Round 4)

**The headline "98.8% under cap" is a CAP-MISCONFIGURATION artifact, not a runtime bug.** The default `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` is ~33× the projector's `upperBound` ($0.012) and ~80× actual median spend ($0.0048). The cap exists as a safety rail, not a target. Three derived gaps:

1. **Vs cap ($0.40) → ~99% gap**: cap is comically oversized; not a real signal.
2. **Vs effective derived cap ($0.030 from `budgetUsd × budgetPercent`)** → 84% gap: still mostly cap-sizing, plus the strategy uses a small total budget.
3. **Vs projector `expected` ($0.0093) → ~50% gap, ATTRIBUTABLE**: the only "real" gap, driven primarily by length_under drops collapsing rank counts (53–98% of the gap) and shorter rewrite outputs (11–32%).

So the user's intuition that "budget is being undershot" is partially right (the projector IS optimistic by ~2×) but the magnitude (98.8% vs $0.40) is a cap-sizing illusion. The real lever is `length_under` quality, which the 20260529 fix targeted but doesn't yet appear to have moved on staging.

## Round 3 Findings

### Where the user's "undershoot" perception comes from
**The SlotsTab** (`evolution/src/components/evolution/tabs/SlotsTab.tsx:138-139`) is the only UI surface that renders the cap-derived per-slot budget alongside actual spend: `budget: $0.0333  spent: $0.0004`. This 1.2% ratio is the artifact the user almost certainly observed. The wizard preview correctly shows the projector envelope ($0.009–$0.012), but the SlotsTab pulls `perSlotBudgetUsd` from the persisted `execution_detail` (which is `perInvocationCapUsd / slotCount = $0.40 / 12 = $0.0333`).

### The 20260529 length_under fix does NOT work (R3A)
- Fix commit `72ebfa80` landed in main at **2026-05-29 19:29 UTC**, released to production at **22:06 UTC**.
- Source code confirms the fix is present: `buildParagraphRewritePrompt.ts:26` carries the "never below ~0.85x" floor language; `ParagraphRecombineAgent.ts:62-76` confirms `PARAGRAPH_REWRITE_TEMP_FLOOR = 1.2` and the M=3 ladder `[1.2, 1.6, 2.0]`.
- Three post-fix invocations ran ~6 hours after the fix landed. Their **index-0 length_under drop rates** are: 100% (12/12), 92% (11/12), 100% (9/9). **Worse than the pre-fix invocation's 89% (8/9).**
- Conclusion: **The fix is deployed but the LLM (gemini-2.5-flash-lite) is ignoring the "never below ~0.85x" directive at higher temperatures.** The 1.2-temp floor + explicit length-floor directive does not produce length-compliant rewrites for the "tighten" intent.

### `DEFAULT_PER_INVOCATION_CAP_USD` is unreferenced from IterationConfig (R3B)
- `ParagraphRecombineAgent.ts:54` defines the static constant; `:91` accepts a per-invocation override; **`IterationConfig` zod schema (`schemas.ts:664-666`) does NOT expose `perInvocationCapUsd`.** No strategy can override the default. The strategy `863bc454…` doesn't because there's no field for it.
- Wizard preview is `EstPerAgentValue.paragraphRecombine` from the projector — NOT the cap. Wizard is correct.
- RunsTable "Spent" column uses `run.budget_cap_usd` (run-level), not the per-invocation cap — correct.
- Recommended cap: **dynamically computed from the projector** (`max(0.05, projector.upperBound × 3)`), or **static `$0.05`** as the simpler one-line change. Either choice gives the per-slot self-abort and pre-final-ranking gates meaningful behavior.

### Evolution-wide `llmCallTracking` regression — back to 2026-02-22 (R3C)
**This is bigger than the paragraph_recombine investigation.** R3C discovered:
- The last `evolution_*` call_source row in `llmCallTracking` is from **2026-02-22** — over 3 months ago.
- Across 1,009 LLM-tracking rows written on staging on May 29–30, **zero** have evolution call_sources.
- Zero `evolution_invocation_id IS NOT NULL` rows on these 4 runs (or any May 2026 runs).
- Zero "LLM call tracking save failed" warn/error logs in `evolution_logs` — meaning the INSERT isn't even being attempted.
- The wiring LOOKS correct: `claimAndExecuteRun.ts:187-229` constructs `llmProvider` that calls `callLLM` with `trackingDb` + `evolutionInvocationId`; `callLLM` → `saveTrackingAndNotify` → `llmCallTracking` INSERT (`llms.ts:145-149`).
- So either: (a) V2 staging deploys use a different `llmProvider` shape that bypasses `callLLM`; (b) `callLLM` short-circuits before `saveTrackingAndNotify` for the `EVOLUTION_SYSTEM_USERID` path; or (c) some other route is being taken.
- The Feb 22 cutoff aligns with the documented "2026-02-23 → 2026-04-30 (audit-gap window)" in `evolution/docs/cost_optimization.md` — the doc describes this as a known issue but suggests it ended on 2026-04-30. **It did NOT end.** This is a real, currently-active regression.

### Display surface defects (R3D), priority-ranked
- **P0**: `RunsTable.tsx:143-158` — inline "Spent" column fallback omits `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`, `debate_cost`. Latent for current 4 runs (`cost` rollup exists), active for any paragraph-recombine-only run with missing rollup.
- **P0**: `getRunCostWithFallback.ts:114-138` — Layer 2 sum omits `paragraph_recombine_cost` AND `debate_cost`. Dashboard total + runs-list source. Latent because Layer 1 catches.
- **P1**: `getRunCostWithFallback.ts:66-86` Layer 3 references the dropped `evolution_run_costs` view (`20260323000004_drop_legacy_metrics.sql`). Dead code; either delete the layer or rebase on `evolution_agent_invocations`.
- **P2**: `EntityMetricsTab.tsx:71-84` `COST_DESCRIPTIONS` missing entries for `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`, `reflection_cost`, `debate_cost`. The `cost` description (`"= generation + ranking + seed"`) is factually wrong post-Phase-6.

### Decision-support scorecard (R3E)

| Option (planning doc) | Score | Notes |
|---|---|---|
| A: Projector recalibration | 3 | Closes 11–32% via output-char tightening; not the dominant lever. |
| B: Per-slot budget rebalance | 1 | Self-abort never fires; nothing to rebalance. Rejected. |
| C: Drop-rate quality fix | 4 | Dominant lever IF a different fix would work; 20260529 already tried and failed. |
| D: Cost-attribution audit | 1 | Accounting confirmed correct. Rejected. |
| E: No-op / document | 3 | Captures the "cap is decorative" reality; partial answer. |

**Synthesis options (newly proposed):**

| Option | Score | Notes |
|---|---|---|
| F: Lower `DEFAULT_PER_INVOCATION_CAP_USD` to $0.05 + wire into IterationConfig | 4 | Collapses the "98.8% under cap" SlotsTab artifact immediately. Pure config. |
| G: Observability fix (instrument execution_detail, fix llmCallTracking regression, recreate evolution_run_costs view) | 5 | Unblocks every future investigation; the llmCallTracking regression is a major bug on its own. |
| H: Display surface fixes (RunsTable inline sum, getRunCostsWithFallback Layer 2) | 3 | Latent here; ship while the area is hot. |
| I: Re-diagnose why 20260529 fix didn't work | 5 | Mandatory before any new drop-rate fix; the LLM is ignoring the directive. |

### Working recommendation (to firm up in Round 4)
**Ship-now combo: G + F + H.**
- **G** (observability) is the highest-leverage: fix `llmCallTracking` wiring, instrument `execution_detail` with per-rewrite cost/temperature/status, recreate or remove the dead `evolution_run_costs` view. Unblocks all future investigations.
- **F** (cap right-sizing) resolves the user's headline perception in one PR. Lower `DEFAULT_PER_INVOCATION_CAP_USD` from $0.40 to $0.05 and wire `perInvocationCapUsd` into `IterationConfig` zod schema so strategies can override.
- **H** (display fixes) bundles cleanly with G — small, well-scoped, prevents future under-reporting.

**Conditional: I → C.** Re-diagnose why the 20260529 fix didn't move the staging drop rate (it's deployed but the LLM ignores it). If the new diagnosis identifies a fixable root cause (e.g., gemini-2.5-flash-lite specifically ignores length directives; need a different rewrite model or harder constraint), implement C. Otherwise, accept the 30–42% drop rate and adjust the projector to assume it (a variant of A).

**Out of scope for this project, but flag as a separate follow-up:** the evolution-wide `llmCallTracking` regression (R3C). Fixing this is part of G, but the regression has been live for 3+ months and may affect every evolution-cost dashboard — worth tracking as its own project.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/cost_optimization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md
- evolution/docs/logging.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/variant_lineage.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/evolution_metrics.md

## Code Files Read

### Round 1
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` — mapped every cost-gating decision (per-slot budget allocation `:166`, per-slot self-abort `:422/:486/:574`, validate-drop path `:436/:461/:468/:470`, per-slot ranking call `:514`, pre-final-ranking gate `:243`, article-level rank `:271/:277`, rollup write `:208-215`).
- `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts` — content-additive directive, length-floor language (post-20260529 fix).
- `evolution/src/lib/shared/paragraphSlots.ts` — `validateParagraphRewrite` drop reasons (`length_under`, `length_over`, `no_bullets`, `no_lists`, `no_tables`, `no_h1`, `zero_sentences`).
- `evolution/src/lib/pipeline/infra/estimateCosts.ts:596-637` — `estimateParagraphRecombineCost` math: `expected = N × M × (rewrite + perSlotRank); upperBound = expected × 1.3`. Worked example at defaults yields `expected ≈ $0.0093`, `upperBound ≈ $0.0120`.
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts:458-507` — `paragraphRecombine` cost threading through `EstPerAgentValue`. Dispatch count is always 0 or 1 (single recombined article variant per iteration). Kill-switch gated at the dispatch branch.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:39-77, 127-241` — `OUTPUT_TOKEN_ESTIMATES.paragraph_rewrite = 250`, `.paragraph_rank = 100`. Reserve at 1.3×, record actual via `calculateLLMCost` from `usage.prompt_tokens`/`completion_tokens` (token-based, NOT chars/4). `llmCallTracking` write gated by `if (db && runId)`.
- `evolution/src/lib/pipeline/infra/trackBudget.ts:67-87, 129-158` — `createAgentCostScope` intercepts `recordSpend` to feed both `shared.phaseCosts[phase]` AND a private `ownSpent` counter. `getPhaseCosts()` is delegated to the shared run-cumulative tracker.
- `evolution/src/lib/core/agentNames.ts:66, 94-95` — `COST_METRIC_BY_AGENT['paragraph_rewrite'] = 'paragraph_recombine_cost'`, `['paragraph_rank'] = 'paragraph_recombine_cost'`, `['ranking'] = 'ranking_cost'`. `paragraph_rank` is force-temp=0 like vanilla `ranking`.
- `evolution/src/lib/metrics/writeMetrics.ts:163-169` — `writeMetricMax` upsert via `upsert_metric_max` RPC: `ON CONFLICT (entity_type, entity_id, metric_name) DO UPDATE SET value = GREATEST(...)`.
- `evolution/src/lib/metrics/registry.ts:94-97` — `total_paragraph_recombine_cost` (sum), `avg_paragraph_recombine_cost_per_run` (avg) propagation defs.
- `evolution/src/lib/cost/getRunCostWithFallback.ts:114-131` — **Layer 2 OMITS `paragraph_recombine_cost`** from the per-purpose sum (sums only `generation_cost + ranking_cost + reflection_cost + seed_cost + evaluation_cost + iterative_edit_cost + proposer_approver_criteria_cost`).
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts:24-39` — calibration phase enum includes `paragraph_rewrite` but NOT `paragraph_rank` (rank falls back to hardcoded 100-token estimate).

### Round 2+
- TBD

## Round 1 Staging Data Summary (n=4)

| Invocation | Run | Slots | cost_usd | duration_ms |
|---|---|---|---|---|
| `83c9a188-cb83-4cd0-bdbc-3356cbc537fc` | `b3406b91…` | 9 | $0.004311 | ~22134 |
| `5786ecc0-c911-4434-80db-e2d328259f01` | `2f5ba6a3…` | 12 | $0.005389 | ~25373 |
| `97bf53eb-b5c1-4b50-b2dc-6fc0b4468b3c` | `d9cab420…` | 12 | $0.005153 | ~22626 |
| `e0d5c052-c375-4f1c-bc26-6218c7ba897f` | `f00b9744…` | 9 | $0.004473 | ~23000 |

Strategy `863bc454-9717-4103-83c4-6c65e4b1bcbf` "New paragraph strategy updated": `budgetUsd = 0.05`, `iterationConfigs[paragraph_recombine].budgetPercent = 60` → derived invocation cap ≈ $0.030. No top-level `perInvocationCap` field. Models: `generationModel = google/gemini-2.5-flash-lite`, `judgeModel = qwen-2.5-7b-instruct`. Knobs: `rewritesPerParagraph = 3`, `maxComparisonsPerParagraph = 8`, `maxParagraphsPerInvocation = 12`. No `paragraphRewriteModel` override.

## Round 4 Deep-Dive Evidence

### Why the 20260529 length_under fix didn't work (R4D)
Per-rewrite text mined from `execution_detail` for invocation `5786ecc0` (100% index-0 drop rate). 12 slots, all at temp 1.2 (index-0 of the ladder):

| Slot | Original chars | 0.8× floor | Index-0 output chars | Ratio | Drop reason |
|---|---:|---:|---:|---:|---|
| 0 | 679 | 543 | 472 | 0.695 | length_under |
| 1 | 954 | 763 | 688 | 0.721 | length_under |
| 2 | 611 | 488 | 446 | 0.730 | length_under |
| 3 | 1046 | 836 | 721 | 0.689 | length_under |
| 4 | 828 | 662 | 515 | 0.622 | length_under |
| 5 | 994 | 795 | 598 | 0.602 | length_under |
| 6 | 883 | 706 | 567 | 0.642 | length_under |
| 7 | 926 | 740 | 661 | 0.714 | length_under |
| 8 | 480 | 384 | 357 | 0.744 | length_under |
| 9 | 615 | 492 | 430 | 0.699 | length_under |
| 10 | 926 | 740 | 655 | 0.707 | length_under |
| 11 | 963 | 770 | 487 | 0.506 | length_under |

**Distribution: min 0.506, max 0.744, mean 0.673. Zero outputs land in the 0.75–0.85 "barely missed the floor" band.** The model is over-compressing aggressively, not just slightly undershooting. Index-1 and index-2 outputs in the same slots are healthy (0.78–1.05 ratio).

Verbatim directive (`buildParagraphRewritePrompt.ts:26`): `"Tighten and simplify. Cut padding, hedging, and redundant phrasing; prefer plain words and shorter sentences. Do NOT add new information. Keep the result within the ±20% length window — never below ~0.85x the original length: trim wordiness, do not delete substance or drop whole sentences."`

Validator (`paragraphSlots.ts:127`): `ratio < 0.8 → length_under`. Hardcoded.

**Diagnosis**: A + B (with E as the operative mechanism). The directive is explicit but uses ratio language (`"~0.85x"`) which LLMs poorly map to character counts. At temperature 1.2, the "Tighten" instruction outweighs the countervailing length-floor clause. Pre-fix temp 0.7 was forgiving; 1.2 broke length compliance for the most length-sensitive directive in the ladder.

**Recommended fix combo (in priority order)**:
1. **Hard char-count directive** (cheapest): inject computed minimum into prompt — `"at least ${Math.ceil(0.85 * paragraphText.length)} characters and at most ${Math.floor(1.20 * paragraphText.length)} characters (original is ${paragraphText.length})"`. LLMs follow numeric constraints far better than ratios.
2. **Per-index temperature override**: drop index-0 back to ~0.7, keep index-1/index-2 at 1.6/2.0. The "tighten" directive gets diversity from its prompt, not from high-temp sampling.
3. **One-shot retry on `length_under`**: re-prompt with stricter directive. Cheap (~$0.0001/retry).
4. **Do NOT loosen the validator** — outputs land at 0.50–0.74, so even dropping the gate to 0.75 still drops most.

### llmCallTracking regression — not paragraph_recombine-specific (R4C)
Static analysis falsified hypotheses 1–5 of the regression's mechanism. The V2 evolution call path through `claimAndExecuteRun.ts → executePipeline → Agent.run → createEvolutionLLMClient → rawProvider.complete → callLLM → callOpenAICompatibleModel → saveTrackingAndNotify` is **structurally intact** in main. `saveTrackingAndNotify` is called unconditionally at `llms.ts:657-671` (OpenAI) and `:784-798` (Anthropic). `injectedDb` is supplied via `trackingDb: supabase` from `claimAndExecuteRun.ts:194-222`.

The April 28 fix `3e6a7290` ("debug_evolution_run_cost_20260426") closed the original Feb 22 regression — and the fix is in the current tree.

**Two remaining hypotheses** for why staging still shows zero evolution rows:
1. **Staging running stale pre-April-28 code.** Verify via `vercel ls explainanythingstage` → confirm deployed SHA contains commit `3e6a7290` or later. If staging deploys lag main by weeks, this is the most likely cause and the fix is to redeploy.
2. **Spending gate fail-closed before tracking writes.** `llmSpendingGate.ts:280` (`getKillSwitch`) always uses the broken `createSupabaseServiceClient` helper; if it throws `LLMKillSwitchError` (line 311), the API call (and its tracking write) never happens. R3C says runs complete and rollups land, which argues against this — but worth checking.

**Recommended next step**: add `logger.info('saveTrackingAndNotify entered', { call_source, hadInjectedDb, userId })` at `llms.ts:202` and redeploy staging. If the log line never appears for `evolution_*`, the regression is upstream of `saveTrackingAndNotify`. **This is NOT fixable inside the current Phase 1 — should be its own follow-up project (`debug_evolution_tracking_still_broken_20260529`).**

### Option F implementation sketch (R4E)
Concrete file-by-file changes for the cap right-sizing (covered in detail in the planning doc):
- `ParagraphRecombineAgent.ts:54` — `DEFAULT_PER_INVOCATION_CAP_USD = 0.4` → `0.05`. Sanity: at 12 slots → perSlot $0.00417; pre-final-ranking gate `0.9 × 0.05 = $0.045` retains 9× headroom over median spend.
- `evolution/src/lib/schemas.ts` — add `perInvocationCapUsd: z.number().min(0.001).max(2.0).optional()` to `iterationConfigSchema` plus a refinement that rejects it on non-paragraph_recombine agent types. No DB migration needed (JSONB-additive).
- `runIterationLoop.ts:1312-1322` — thread `iterCfg.perInvocationCapUsd` into the agent input.
- Tests: schema accept/reject, agent default-vs-override.
- Docs: `evolution/docs/paragraph_recombine.md` Cost envelope + Configuration knobs update.

Risks: (a) audit existing strategies for any whose paragraph_recombine cost exceeded $0.045 — they'd hit the pre-final-ranking gate post-F; (b) long-article degenerate cases may push per-slot spend above the new $0.00375 self-abort floor.
