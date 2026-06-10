# Findings — paragraph_recombine effectiveness on run `88b5e860-1690-41c4-9128-2c1fb85d5297`

## TL;DR

For this single staging run, **paragraph_recombine did NOT demonstrate effectiveness**:

- Article-level Elo delta vs parent: **[+52, -47, -49, -54, -149], median -49**. Only 1 of 5 recombined variants beat its parent.
- `eloAttrDelta:paragraph_recombine:paragraph_recombine = -3.08 ± 4.4` (negative).
- Run-level winner = a `structural_transform` variant @ Elo 1322.9, NOT paragraph_recombine.
- Rewrite drop rate: **47.5% aggregate** (target 5-15%). Index-0 drop = **44.7%** (target <30% post-Options I3a/I3b).
- Projector underestimates paragraph_rewrite by ~3× (`paragraph_rewrite_estimation_error_pct = +183.9%`).

But this is also the **first-ever paragraph_recombine run on staging** — multi-dispatch (Option J) shipped 2026-05-30 (commit `5e482fa0`), and this is its debut. No baseline run exists to disentangle "multi-dispatch artifact" from "intrinsic agent behavior on these inputs". Critical recommendation: **run a `maxDispatches=1` baseline** before further iterations.

Persistence is healthy (migration `20260529000001` delivered; 121/121 variants persisted with `parent_variant_ids` + `match_count`). The `investigate_paragraph_recombine_invocation_20260529` symptoms are resolved.

## Run characterization

| Field | Value |
|---|---|
| Run ID | `88b5e860-1690-41c4-9128-2c1fb85d5297` |
| Status | `completed` |
| Wall clock | 3m 7.7s (2026-05-31 05:31:59 → 05:35:06 UTC) |
| Budget cap | $0.05; actual spend $0.0423 (~85% utilization) |
| Strategy | `New paragraph strategy` (`ce9799fa-…`) |
| Models | gen=`google/gemini-2.5-flash-lite`, judge=`qwen-2.5-7b-instruct` |
| Prompt | `Federal Reserve 2` (28-char prompt, `prompt_seed` run, no `evolution_explanation_id`) |
| Experiment | `b89f9ce9-…` |
| Iter 0 | `generate` 40% budget, sourceMode=seed (14 invocations) |
| Iter 1 | `paragraph_recombine` 60% budget, sourceMode=pool, **maxDispatches=10**, qualityCutoff=topN:5, defaults otherwise (`rewritesPerParagraph=3`, `maxComparisonsPerParagraph=8`, `maxParagraphsPerInvocation=12`, `perInvocationCapUsd` **not set** → default $0.05) |
| Run-level invocations | 14 `generate_from_previous_article` + 5 `paragraph_recombine` + 2 `merge_ratings` |
| Winner | `72a07e9e` (`structural_transform`) @ Elo 1322.913 |

The 5 paragraph_recombine invocations targeted 5 distinct parents (multi-dispatch K=5; cut off at 5 of 10 by `qualityCutoff` topN:5 against the 14-variant pool).

## Article-level outcomes — the headline failure

| invocation | child | parent | child_elo | parent_elo | **delta** | match record (W-L-D) |
|---|---|---|---|---|---|---|
| 17c06ec8 | 44454c9e | cdaa50e1 (grounding_enhance) | 1321.253 | 1269.134 | **+52.119** | 1-0-2 |
| ad7c4f3b | a281177c | 72a07e9e (run winner, structural) | 1276.157 | 1322.913 | -46.755 | 0-0-3 |
| 7babbc39 | d3bc3e83 | 61132e6b (structural) | 1226.200 | 1275.545 | -49.346 | 0-1-2 |
| 42c0a146 | ca93ac52 | 97902043 (grounding) | 1123.534 | 1177.222 | -53.687 | 0-3-0 |
| 46ab0b35 | decfb249 | 093584ca (structural) | 1123.143 | 1271.643 | **-148.500** | 0-3-0 |
| **aggregate** | — | — | — | — | **median -49.3** | **1-7-7** (15 matches, avg conf 0.77) |

Only 44454c9e (`grounding_enhance` parent → +52) outperforms its parent. The other 4 lose, including a281177c which recombined from the run winner (`72a07e9e`) and dropped 47 Elo doing so. The bottom case (decfb249, -149 Elo) shows the operator can severely degrade an already-strong structural parent.

## Per-slot outcomes — the contradictory signal

47 slot topics across the 5 invocations. **Per-slot ranking outcomes:**

| winnerSource | count | % |
|---|---|---|
| `this_invocation` | 28 | 59.6% |
| `original` | 17 | 36.2% |
| `prior_invocation` | 0 | 0.0% |
| NULL (slot discarded) | 2 | 4.3% |

So at the slot level, the agent's NEW rewrites win 59.6% of slots — sounds positive. But the matching match-row analysis tells a different story:

- 108 slot-level `evolution_arena_comparisons` rows (avg 2.3 per slot).
- Decisive (conf ~1.0): **60 rows, all `winner='a'`** (this is a persistence-layer artifact — see "False alarms" below).
- Draws (conf 0.5): 48 rows.
- **44.4% slot-level draw rate** — much improved from the documented pre-Option-B1 ~98% draws, but still high. The B1 paragraph-mode rubric helps but doesn't eliminate the draw problem.

Among original-vs-rewrite slot pairs (the meaningful subset): **18 original wins, 23 rewrite wins, 33 draws.** Rewrites edge out originals by 5 decisive wins out of 74 pairs — a very narrow margin.

**The contradiction**: per-slot rewrites narrowly edge originals (23 vs 18 decisive), but the recombined articles consistently lose at the article level (1W-7L-7D). Hypothesis: narrow per-slot edges compound to neutral article quality, but the **length inflation from index-1/2 directives drags article Elo down** (children are +350 to +840 chars longer than parents in all 5 cases — see "Content shape" below).

## Per-rewrite drop rate

141 rewrites attempted (47 slots × 3 rewrites). **74 succeeded, 67 dropped (47.5%).**

| index | n | dropped | drop % | dropReason | avg temp | avg cost | avg ms |
|---|---|---|---|---|---|---|---|
| 0 ("tighten") | 47 | 21 | **44.7%** | 100% `length_under` (ratios 0.62-0.80) | 0.70 | $0.0031 | 3482 |
| 1 ("add example") | 47 | 28 | **59.6%** | 100% `length_over` | 1.20 | $0.0043 | 4195 |
| 2 ("improve flow") | 47 | 18 | **38.3%** | 100% `length_over` | 2.00 | $0.0042 | 4160 |

**Documented targets** (per `evolution/docs/paragraph_recombine.md` after Options I3a/I3b):
- Index-0 < 30%. **Missed by 14.7pp.**
- Aggregate 5-15%. **Missed by 32-42pp.**

The temperature ladder is bifurcating: index-0 too short (despite hard char-count directive `>= ceil(0.85 × original)`), indices 1/2 too long. Index-0 length ratios cluster in 0.62-0.73 — well below the 0.8 floor; a marginal floor relaxation would not rescue most. Wasted cost on dropped rewrites: ~$0.0034 per invocation (~15% of paragraph_recombine spend).

No `no_bullets` / `no_lists` / `no_tables` / `no_h1` / `zero_sentences` drops, no `llm_error`, no `skipped_slot_abort` — the format guardrails are working, the length window is the entire failure mode.

## Cost shape

| Source | Amount | Status |
|---|---|---|
| `paragraph_recombine_cost` metric | **$0.019756** | correct (MAX(phase_sum) per `writeMetricMax` contract) |
| SUM(invocation `cost_usd`) | $0.023144 | correct (sum of per-invocation `scope.getOwnSpent()`) |
| Gap | **$0.003388 (~15%)** | LLM spend bucketed under non-`paragraph_rewrite` / non-`paragraph_rank` labels |
| Per-invocation cost | $0.004–$0.005 | well under documented median $0.0048 |
| Per-invocation cap (default $0.05) | 8-11% utilization | abundant headroom; perInvocationCapUsd was not set on iter config |
| Per-slot budget utilization | 7-13% per slot | 0.9× self-abort threshold never fired |

**Estimator accuracy (alarming):**
- Run-level `paragraph_rewrite_estimation_error_pct = +183.9%` (rewrites ran ~3× over per-phase projection).
- Per-invocation `estimationErrorPct` ranges 39%-164%.
- The projector is systematically underestimating paragraph_rewrite spend on this model (gemini-2.5-flash-lite) — possibly stale calibration constants.

`paragraph_rank_estimation_error_pct = -8.4%` (small under-actual) — ranking projection is fine.

**Reconciliation deep dive:** Per `evolution/docs/paragraph_recombine.md`, the metric is written via `writeMetricMax` summing `getPhaseCosts()['paragraph_rewrite'] + ['paragraph_rank']` once per invocation. Because `getPhaseCosts` is bound to the **shared run-level** tracker (via `createAgentCostScope` delegation), the metric is the MAX of run-cumulative snapshots — and that snapshot equals $0.019756, the value of the final invocation's snapshot. The contract is honored.

The $0.003388 gap between metric ($0.0198) and sum(invocation own-spent) ($0.0231) means ~15% of paragraph_recombine LLM spend is being recorded under a label that isn't `paragraph_rewrite` or `paragraph_rank`. Worth tracing in a follow-up, but it's an accounting hole, not a Bug-A/B regression.

## Persistence health — clean

121/121 expected variants persisted (47 originals + 74 succeeded rewrites). All 74 rewrite variants have:
- `parent_variant_ids` populated with 1-element arrays pointing to the slot's `paragraph_original` (migration `20260529000001` delivering).
- `match_count == arena_match_count > 0` (range 1-3 per variant).
- `synced_to_arena = true`.

Slot topic naming follows `[para] V<parent8>.P<slot>` per D19 exactly. No `paragraph_slot_match_persist_failures`. The `investigate_paragraph_recombine_invocation_20260529` symptoms (empty parent_variant_ids, 0 match_count on slot rows) are **fully resolved** on this post-migration run.

## D10 cross-invocation Elo accumulation — not measurable

0% `prior_invocation` wins. Root cause: **all 5 parents were freshly generated in this run's iter 0**, and no prior staging run had ever invoked paragraph_recombine on this prompt (`a546b7e9-…` / "Federal Reserve 2"). Slot topics keyed `[para] V<parent8>.P<slot>` had no prior history.

D10 requires same-parent + same-slot reuse — that didn't happen here. **Not a regression; topology artifact.** To exercise D10, a future test should either pin K dispatches to the same parent or seed a run from a parent that was paragraph_recombined in a prior run.

## Logs — clean

1,550 log rows: 815 debug + 734 info + **1 warn + 0 error**. The lone warn:

> `paragraph_rewrite` subagent: "Budget 80% consumed" at totalSpent $0.04004 vs cap $0.05. Soft pacing, not an overrun.

No `length_*`, `topic_arena_growth_warn`, `persistSlotMatches failed`, `no_valid_rewrites`, slot self-abort, or budget-exceeded log rows. Note: the 2 known `no_valid_rewrites` discards on invocation `46ab0b35` (slots 3, 4) do NOT appear in `evolution_logs` — they're recorded only in `execution_detail.slots[*].discardReason`. **Observability gap** worth surfacing.

## Content shape

Recombined variants are **structurally faithful** to their parents:
- Identical H1 + same H2 section headings + same paragraph count.
- `decfb249` (worst delta -149) even kept slot 0 verbatim (the 'original' winnerSource case).

**Length inflation** consistent across all 5: children are +354 to +801 chars longer than parents. Source: longer synonym phrasings inside same paragraphs (e.g. "sophisticated blend of public oversight and private entity operation" → "complex fusion of public supervision and private sector engagement, built upon a decentralized network of regional banks that answer to a central authority"). NOT added sections/paragraphs.

For `decfb249` specifically: of 9 slots, 2 kept verbatim, 1 had no_valid_rewrites (kept original), 6 swapped to this_invocation rewrites that ran +35 to +199 chars each (total +801 across rewritten slots = the article-level +801 delta).

## False alarms / clarifications from this investigation

These were flagged mid-analysis but turned out NOT to be problems:

1. **"100% winner='a' bias" is NOT judge position bias.** It's a persistence-layer convention — `persistSlotMatches` (slot path) and `MergeRatingsAgent.ts:281` + `runIterationLoop.ts` (article path) both set `entry_a := winnerId` for decisive rows. Reversal IS executing correctly via `run2PassReversal` (`computeRatings.ts:495-503`). Bimodal {0.5, 1.0} confidence distribution is exactly what `aggregateWinners` produces under no-partial-failure cases. (Round 3 misread; Round 4 cleared this.)

2. **`cost_usd = NULL` on article variants is documented/deprecated**, not a regression. Per `evolution/docs/arena.md` U33 (2026-04-22), the Cost column was removed because cost is tracked at invocation level. Authoritative source is `evolution_agent_invocations.cost_usd`. 0% populated across **all** agents on staging, not specific to paragraph_recombine.

3. **`sentence_verbatim_ratio = NULL` on paragraph_recombine IS a code oversight** — but a fixable, narrow one. `ParagraphRecombineAgent.ts:325-334` builds the Variant without calling `sentenceVerbatimOverlap`. Peer agents (GFPA path) compute it at `generateFromPreviousArticle.ts:259-261`. One-line addition fixes it. The recombined variant has a single comparable parent (`parent_variant_ids[0]` = parentVariantId per D4), so the metric is meaningful here.

4. **0% `prior_invocation` is topology, not regression** — see D10 section above.

## Open questions / unanswered

1. **Is paragraph_recombine intrinsically negative-Elo, or is this run an outlier?** Cannot answer — n=1 staging run.
2. **Is multi-dispatch (`maxDispatches=10`) responsible for the drop rate / Elo / cost shape?** Cannot answer without a `maxDispatches=1` baseline.
3. **Why is the projector underestimating `paragraph_rewrite` by 184%?** Possibly stale calibration constants for gemini-2.5-flash-lite, or the projector treats successful-only rewrites where reality bills all M attempts including drops. Worth tracing in `evolution/src/lib/pipeline/infra/estimateCosts.ts → estimateParagraphRecombineCost`.
4. **Where is the missing $0.0034 of paragraph_recombine LLM spend going?** ~15% of spend is bucketed under a non-`paragraph_rewrite`/`paragraph_rank` label.
5. **Would index-0 do better with a different model?** gemini-2.5-flash-lite at temp 0.7 is producing ratios 0.62-0.80 on the "tighten" directive. May be a model-fidelity problem.

## Recommended follow-up projects

Priority order:

1. **Baseline run with `maxDispatches=1`** (and ideally other-knobs-equal) on the same parent set. Compare drop rate, projector accuracy, article-level Elo delta. This is the single most valuable next experiment.
2. **Investigate index-0 length_under at depth.** Options I3a/I3b were the most recent prompt fixes; they're underperforming on gemini-2.5-flash-lite. Candidate experiments:
   - Lower temp (0.7 → 0.5) for index-0.
   - Stronger char-count phrasing in the prompt.
   - Or: collapse the ladder — drop the "tighten" directive entirely (since it dominantly fails) and use 3 different additive-or-equal-length directives.
3. **Fix `sentence_verbatim_ratio` for paragraph_recombine** — one-line addition in `ParagraphRecombineAgent.ts:325-334` mirroring `generateFromPreviousArticle.ts:259-280`. Cheap, gives us a quality signal for future runs.
4. **Surface slot-level discard outcomes to `evolution_logs`** — `no_valid_rewrites`, `length_*` drops, slot self-abort should emit warn-level logs so dashboards/alerts can fire on degraded runs.
5. **Trace the $0.0034 cost accounting hole** — identify which LLM calls inside `ParagraphRecombineAgent` use AgentNames other than `paragraph_rewrite` / `paragraph_rank`, and either re-label them or extend the metric write.
6. **Investigate projector under-estimation** — `paragraph_rewrite_estimation_error_pct = +184%` is alarming. Look at `estimateParagraphRecombineCost`'s assumed output-char counts vs actuals, and consider COST_CALIBRATION_ENABLED for paragraph phases.
7. **Restore evolution `llmCallTracking` writes** — known regression since 2026-02-23, documented in `docs/docs_overall/debugging.md`. Without these, per-call cost audit is impossible.

## Elo bucket analysis (added 2026-05-31)

### Methodology note

Per `docs/planning/updated_criteria_agent_20260505/` (D2 spec), bucket variants by a quality dimension (parent Elo and/or sentence-overlap), then report per-bucket mean + percentiles (p10, p25, p50, p75, p90). At n=5 article-level recombined variants, percentile bucketing collapses; instead this section reports raw individual rows + two qualitative slicings (parent Elo bin, parent agent_name) and supplements with the larger n=15 article-match record and n=108 slot-match record.

### Bucketed by parent Elo

| Bucket | n | parent variants (short / agent_name / Elo) | individual Δ | mean Δ |
|---|---|---|---|---|
| **High (≥1300)** | 1 | 72a07e9e structural 1322.9 | -46.8 | **-46.8** |
| **Mid (1250-1299)** | 3 | 61132e6b structural 1275.5 / 093584ca structural 1271.6 / cdaa50e1 grounding 1269.1 | -49.3, **-148.5**, **+52.1** | -48.6 |
| **Low (<1200)** | 1 | 97902043 grounding 1177.2 | -53.7 | -53.7 |

Parent Elo alone shows no monotonic pattern at this sample size. The +52 outlier and the -149 outlier sit in the same bin.

### Bucketed by parent `agent_name` (stronger signal)

| Parent agent | n | individual Δ | mean Δ | median Δ |
|---|---|---|---|---|
| **`grounding_enhance`** | 2 | +52.1, -53.7 | -0.8 | -0.8 |
| **`structural_transform`** | 3 | -46.8, -49.3, -148.5 | **-81.5** | -49.3 |

Even at n=5, this slice is sharp: paragraph_recombine recombines `grounding_enhance` parents roughly break-even but **destroys an average -82 Elo when recombining `structural_transform` parents**. All 3 structural parents lost; both grounding outcomes are within ±54 of zero. Hypothesis (cross-checked qualitatively below): structural_transform parents have crisp section ordering + dense topic sentences; recombination loses that structure by paraphrasing transition sentences and inflating prose. Already-grounded prose has more "swap-able" content where rewrites preserve information density.

### Article-level match record (n=15 matches)

Every paragraph_recombine variant fought the **same 3 cross-run arena opponents** (pulled by `loadArenaEntries` from prior runs of this prompt):

| Opponent | agent_name | Elo |
|---|---|---|
| `d4491361` | structural_transform | **1362.7** |
| `45a0a042` | grounding_enhance | **1374.9** |
| `a4c4fc15` | structural_transform | **1281.4** |

Per-variant record:

| pr variant | parent_Elo | child_Elo | record (W-L-D) | avg conf | Notes |
|---|---|---|---|---|---|
| 44454c9e | 1269 (grounding) | 1321 | **1-0-2** | 0.67 | The +52 outlier. Upset a4c4fc15 at conf=1; drew the other two. |
| a281177c | 1322 (winner structural) | 1276 | 0-0-3 | 0.50 | All draws. Three opponents couldn't decisively beat or be beaten. |
| d3bc3e83 | 1275 (structural) | 1226 | 0-1-2 | 0.67 | Lost decisively to top-Elo structural d4491361. |
| ca93ac52 | 1177 (grounding) | 1123 | **0-3-0** | 1.00 | Swept; every loss conf=1. |
| decfb249 | 1272 (structural) | 1123 | **0-3-0** | 1.00 | Swept; every loss conf=1. Worst regression (-149). |

**Sampling bias**: arena pool drew 3 opponents averaging Elo 1340. paragraph_recombine variants averaged Elo 1214. So a -126 baseline-Elo gap. Some of the losses are expected from that. But the **conf=1 losses to the 1281-Elo opponent** (the lowest of the 3) confirm the judge isn't just chasing Elo — it's judging content quality.

Counter-evidence: 44454c9e (1321) BEAT a4c4fc15 (1281) at conf=1. Same opponent, same rubric, same judge. The judge cares about quality, and 44454c9e had it.

### Per-slot quality lift (n=108 slot matches)

Per-slot match record (originals vs rewrites only): **23 rewrite wins / 18 original wins / 33 draws** (44% draw rate). Bucketed by `winnerSource`:

| winnerSource | n | % |
|---|---|---|
| this_invocation | 28 | 59.6% |
| original | 17 | 36.2% |
| prior_invocation | 0 | 0.0% (topology artifact — see "D10" section above) |
| NULL (discard) | 2 | 4.3% |

The per-slot judge picks rewrites 59.6% of the time. Yet at the article level, paragraph_recombine loses 7 of 15 matches. **Per-slot success does not predict article-level success.** This is the central effectiveness paradox.

### Why? Drilling into the worst regression (decfb249, -148.5 Elo)

Full investigation in Agent C's drilldown. Key findings:

**1. Slot disposition was actually GOOD**: 6 `this_invocation` wins, 1 `original` kept (slot 0), 2 `no_valid_rewrites` discards (slots 3, 4 — kept as original). Per-slot signal said success.

**2. The discards did NOT cause flow breaks** — they sat inside a self-contained H2 section ("The Fed's Arsenal"), so the seams were absorbed at section boundaries. Hypothesis H1 (flow break) rejected.

**3. Length inflation +801 chars (~13%) across 6 rewritten slots.** Every winning rewrite was longer (+35 to +199 chars per slot).

**4. Stacked analogy injection across 3 slots** — the LLM kept appending "much like a [X]" similes:
- Slot 1: "...much like a seasoned captain steering a ship through changing currents to maintain a steady course"
- Slot 7: "...much like a gardener turning up the heat in a greenhouse to help plants grow"
- Slot 8: "Think of it like a seasoned rescuer with a fire extinguisher, ready to douse small flames before they become uncontrollable infernos"

**5. Synonym-swap with no information added**:
- Original: "a sophisticated blend of public oversight and private entity operation"
- Rewrite: "a complex fusion of public supervision and private sector engagement, built upon a decentralized network of regional banks that answer to a central authority"

**6. Concrete-terminology dilution**:
- Original: "solvent institutions experiencing temporary liquidity problems"
- Rewrite: "sound banks facing short-term cash flow challenges"

**7. Comparison to the opponents that beat decfb249 at conf=1**: each opponent uses **one** controlling metaphor or concrete sensory hook, not three stacked similes:
- d4491361 (structural, 1362): "*Operating at the very heart of the United States economy is the Federal Reserve System...*" (clean opening, no forced analogy).
- 45a0a042 (grounding, 1374): "*The marble columns of the Federal Reserve's headquarters in Washington, D.C., stand because of a crowd of panicked depositors in New York City in 1907...*" (concrete sensory + named historical actor).
- a4c4fc15 (structural, 1281): "*If the economy were a body, its central bank would be the heart, regulating the vital flow of money and credit...*" (ONE clear controlling metaphor).

### Verdict (new hypothesis H5)

The per-slot judge evaluates each rewrite **in isolation** against ONE parent paragraph using the paragraph-mode B1 rubric (clarity/concision/fidelity/usefulness), which rewards "vividness" via added similes and synonym variety. The **article judge sees cumulative effect** — 3-4 stacked similes within 5 paragraphs reads as overwritten and is judged inferior to a parent that used 0-1 controlling metaphors. The per-slot optimization is anti-correlated with whole-article quality when applied to 6 of 9 slots simultaneously.

This is also why the +52 winner (44454c9e from a `grounding_enhance` parent) succeeded: grounding_enhance parents already had concrete imagery, so rewrites that added vividness didn't compound into bloat — they had to compete with existing strong sensory language and so came out neutral-to-better.

### Implications

1. **Don't recombine `structural_transform` parents** with the current prompt. Sample size is small, but the mechanism is now understood — structural prose loses crispness when paraphrased per-slot, and gains stacked metaphors. Add a strategy-level guard or a parent-tactic filter.
2. **Tune the index-1/index-2 rewrite directives** to suppress new-similes when the parent already has one. Currently the "add example" directive at index 1 + the "improve flow" directive at index 2 both encourage analogies. With 3 rewrites per slot × 6 slots, the LLM stacks them.
3. **Consider article-level format validation post-recombination** that catches stacked-analogy patterns ("Think of it like..."/"Much like..." > 2 occurrences in a 10-paragraph article).
4. **Add per-slot length-delta tracking to the article judge** so cumulative bloat is visible at slot-judging time.
5. **The slot-vs-article judge disagreement is a measurement bug worth surfacing.** Track `arena_match_winner` vs `slot_judge_win_count` per recombined variant — when slot wins are 6/9 but the article loses 0/3, that's the hallmark of the stacked-vividness failure mode.

## Evidence trail (key queries)

All queries via `npm run query:staging` (read-only `readonly_local` role).

Run + strategy + invocation summary, full execution_detail breakdown, all slot rankings, all 121 persisted variants, all 108 slot-level comparisons + 57 article comparisons, all 1,550 log rows, and all run-level metrics rows were inspected. Specific queries that produced the headline numbers are quoted in `_planning.md` Phases 1-5 and referenced inline above.

Source files inspected for shape + semantics:
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts`
- `evolution/src/lib/schemas.ts` (`slotRecombineExecutionDetailSchema`)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (paragraph_recombine branch + J multi-dispatch)
- `evolution/src/lib/shared/paragraphSlots.ts` (`validateParagraphRewrite`)
- `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts`
- `evolution/src/services/slotTopicActions.ts` (`persistSlotMatches`, entry_a := winnerId convention)
- `evolution/src/lib/shared/reversalComparison.ts` + `evolution/src/lib/shared/computeRatings.ts`
- `evolution/src/lib/pipeline/infra/trackBudget.ts` + `createEvolutionLLMClient.ts`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (cost_usd write-path + SVR write-path)
