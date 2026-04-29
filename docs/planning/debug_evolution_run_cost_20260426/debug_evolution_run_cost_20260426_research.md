# debug_evolution_run_cost_20260426 Research

## Problem Statement
Originally: for invocation `a824f9e0-0f23-47ef-93cb-8fb24ed50a83` on staging, understand the generation and ranking cost breakdown and what is driving those.

The investigation expanded to cover: per-run cost summaries across the latest 20 runs, a deeper look at one outlier run (`f90c1693`), comparison of cost drivers across two reference runs, evidence on whether thinking-mode generation models produce better content, cost-effectiveness rankings per output token, and isolation of a legacy cost-computation bug that inflated some historic numbers.

## High-Level Summary

1. **Per-invocation cost on the original target (`a824f9e0`)** was $0.001115, split **44% generation / 56% ranking** despite the qwen judge being ~10× cheaper per token than the gemini-flash-lite generator. Three multipliers stack on the ranking side: each comparison feeds *both* article texts (~2× input vs generation), each is run twice for position-bias mitigation, and each variant gets up to `maxComparisonsPerVariant=5` comparisons.
2. **At the run level the same ratio holds**: `d790381c` totalled $0.0882 ($0.038 generation / $0.050 ranking), well under its $0.50 budget cap. 100 generate-agent invocations + 1 merge.
3. **Cross-run cost variance is large** — some runs hit ~70% of budget cap, others use <2%. The dominant lever for total per-run cost is the choice of generation model. Switching from gemini-flash-lite to gpt-5-nano increases per-invocation cost ~4×, almost entirely due to hidden reasoning tokens.
4. **No evidence that thinking models produce better content for our use case.** On the most-tested prompt ("Federal Reserve", n=43 runs), best thinking model (gpt-5-mini, 1388 Elo) statistically ties best non-thinking (deepseek-chat, 1395). gpt-5-nano is the worst quality-per-dollar option in the lineup.
5. **Best Elo per dollar overall: gemini-2.5-flash-lite** (6,376 Elo/$ — 60% better than the next best). Ranks 2nd-cheapest per output token AND produces ~95% of deepseek's quality at 45% of deepseek's cost.
6. **A historic cost-computation bug** (Bug A in `debugging.md`) inflated cost numbers for runs created before ~2026-04-20 by ~3× for gemini. Recent run cost numbers are trustworthy; older run-level cost metrics may be over-stated and have not been backfilled.

---

## Detailed Findings

### 1. Original target — invocation `a824f9e0` (run `d790381c`)

**Run context.**
- Run `d790381c-8596-4977-81b3-21477c286b5b`, status completed, budget cap **$0.50**, actual cost **$0.0882**.
- Strategy: 1 generate iteration, 100% budget. Generation model `google/gemini-2.5-flash-lite`, judge `qwen-2.5-7b-instruct`, `maxComparisonsPerVariant: 5`. 24 tactics weighted equally.
- 101 invocations total: 100 × `generate_from_previous_article` (avg $0.000882) + 1 × `merge_ratings` ($0).

**Per-purpose cost (from `evolution_metrics`).**
| Metric | Value |
|--------|------:|
| `cost` | $0.08816 |
| `generation_cost` | $0.037962 (43%) |
| `ranking_cost` | $0.050198 (57%) |
| `seed_cost` | $0 |

**Invocation `a824f9e0` breakdown.**
| Phase | Cost | % | LLM calls | Duration |
|-------|------:|----:|---:|---:|
| Generation | $0.000489 | 44% | 1 (gemini-flash-lite) | 19.1 s |
| Ranking | $0.000626 | 56% | 8 = 4 comparisons × 2 (qwen) | ~115 s |
| **Total** | $0.001115 | 100% | 9 | 134.8 s |

This invocation cost 27% above the run average. It hit only 4 ranking comparisons before the variant was eliminated; surfaced `ee891f37` (final local Elo 1101.8 vs top-15% cutoff 1313.7).

**Why ranking dominates despite using a 10× cheaper judge.**
- 2× input — each comparison feeds both article texts.
- 2× call count — forward + reverse for bias mitigation.
- Up to 5× comparisons per variant.
- Net: ranking processes ~20× the input volume of one generation, so even at 10× lower price it still costs ~2× more.

**Notable: comparison 1 took 87 s** — 11× longer than comparisons 3–4. Diagnostic: forward and reverse calls run via `Promise.all`, each capped at 20 s × 3 retries + backoff = ~67 s. 87 s indicates one direction exhausted retries (likely a transient qwen failure on the staging endpoint). Cost was preserved (failed reservations are released) but wall time inflated by ~7×.

**Estimation pessimism.** Estimated total $0.002176 vs actual $0.001115 → −48.76% (over-estimated by ~50%). By design — 1.3× reservation margin and conservative output-token upper bounds.

**`llmCallTracking` is empty for this entire run** (zero rows for any of the 100 invocations). Cost numbers are still trustworthy because `cost_usd` comes from `scope.getOwnSpent()`, which is the authoritative source under the post-2026-04-23 B012 invariant. The missing tracking rows are a separate audit-trail bug — the fire-and-forget `llmCallTracking` write is silently failing for non-OpenAI provider responses (gemini, qwen, gpt-5, gpt-oss all have zero rows).

### 2. Cross-run summary — latest 20 runs

| # | Run (short) | Status | Budget | Spent | Inv. | Avg cost/inv |
|---|---|---|---:|---:|---:|---:|
| 1 | d790381c | completed | $0.50 | $0.0882 | 101 | $0.000873 |
| 2 | e32a2900 | completed | $0.50 | $0.0066 | 101 | $0.000065 |
| 3 | 0dfda6f3 | completed | $0.50 | $0.0084 | 10 | $0.000836 |
| 4 | 67c5942e | completed | $0.05 | $0.0230 | 18 | $0.001278 |
| 5 | 6743c119 | completed | $0.05 | $0.0259 | 16 | $0.001618 |
| 6 | 0743ead5 | completed | $0.05 | $0.0283 | 14 | $0.002020 |
| 7 | 2fd03e7f | completed | $0.05 | $0.0158 | 8 | data missing |
| 8 | f56992e7 | completed | $0.05 | $0.0128 | 8 | data missing |
| 9 | 8c4c8eb4 | completed | $0.05 | $0.0135 | 8 | data missing |
| 10 | 6b92ab7f | completed | $0.05 | $0.0250 | 15 | $0.001341 |
| 11 | f90c1693 | completed | $0.05 | $0.0345 | 12 | $0.002495 |
| 12 | 8d78a0e0 | completed | $0.05 | $0.0186 | 20 | $0.000724 |

(Plus four "ghost" rows with 0 invocations and three runs with status=failed or missing metric — flagged in Open Questions.)

**Observation: per-invocation cost varies 30×** ($0.000065 to $0.002495), driven primarily by generation model choice and secondarily by what fraction of the budget is consumed by ranking vs generation.

### 3. Outlier deep-dive — run `f90c1693` ("Testing faster gen - GPT 5 nano")

**Top-line.** $0.0345 spent of $0.05 budget (69%), 4 min 11 s wall clock, 12 invocations, **avg $0.00288/inv** — the most expensive per-invocation in the latest 20 runs.

**Strategy config (legacy, pre-`iterationConfigs[]`):**
- generation model: `gpt-5-nano` 🧠 (reasoning model)
- judge model: `qwen-2.5-7b-instruct`
- legacy fields: `iterations: 50, maxVariantsToGenerateFromSeedArticle: 9` (pre-Phase 1 schema)

**Invocations (12 total):** 9 × `generate_from_seed_article` (legacy agent name pre-rename) + 1 × `swiss_ranking` + 2 × `merge_ratings`. Run completed 2 iterations (1 generate + 1 swiss) and stopped — swiss exhausted candidate pairs.

**Cost split:**
| Metric | Value | % |
|--------|------:|---:|
| `cost` | $0.034513 | 100% |
| `generation_cost` | $0.022179 | 64% |
| `ranking_cost` | $0.012334 | 36% |

**Generation dominates here**, inverted from `d790381c`. Reason: only 1 generation iteration ran (9 agents × 4 ranking comparisons each + a swiss round of 20 matches), and gpt-5-nano is much more expensive per generation call than gemini-flash-lite.

**Ranking comparisons per invocation (f90c1693):**
| Generate invocation | Comparisons | Hit cap (5)? |
|---|---:|:--|
| #1, #3, #4, #6, #7, #9 | 5 | yes (6 of 9) |
| #2, #5, #8 | 2 | no — eliminated early |
| swiss_ranking | 20 (one shot) | n/a |

Avg comparisons per generate agent: **4.0**. Total ranking LLM calls: 56 comparisons × 2 = **112 calls**.

**Catastrophic estimation error:**
- `agent_cost_projected`: $0.001099 → `agent_cost_actual`: $0.003327 (3× the estimate)
- `cost_estimation_error_pct`: **+646%**
- `generation_estimation_error_pct`: **+1267%**

Cause: pre-dispatch estimator uses chars/4 heuristic for output tokens, which doesn't model reasoning tokens. gpt-5-nano produces ~493 hidden reasoning tokens per call (verified for sibling gpt-5-mini, see §5 below) at output rates, so it costs ~3× the estimate.

### 4. Per-invocation cost difference: `f90c1693` vs `d790381c`

f90c1693 cost **4.3× more per generate-agent invocation** ($0.00383 vs $0.00088). Decomposed:

| Component | f90c1693 (gpt-5-nano) | d790381c (gemini-flash-lite) | Ratio | Driver |
|---|---:|---:|---:|---|
| Generation per agent | $0.002464 | $0.000380 | **6.5×** ↑ | gpt-5-nano hidden reasoning tokens |
| Ranking per agent | $0.001370 | $0.000502 | **2.7×** ↑ | f90c1693 ran more comparisons per agent + a swiss round |
| Cost per ranking LLM call | $0.000110 | $0.000103 | ~same (7%) | same judge + similar inputs |
| **Total per agent** | **$0.003835** | **$0.000882** | **4.3×** ↑ | |

**Important correction.** I initially claimed d790381c had 992 ranking LLM calls (from 100 agents × 4.96 avg = 496 comparisons × 2). That was wrong: only **49 of the 100 generate agents had ranking work recorded** (the other 51 had `execution_detail.ranking = NULL`, likely discarded before ranking or budget-cut). True call count is **243 comparisons → 486 LLM calls** (matches `evolution_metrics.total_matches = 243`). Per-call cost recomputed at **$0.000103 (d790381c)** vs **$0.000110 (f90c1693)** — these are essentially identical. Cache-hit rate is *not* the explanation for any cost gap — it's purely comparisons-per-agent.

### 5. Thinking-vs-non-thinking models — direct evidence and quality

**Direct verification from `llmCallTracking.reasoning_tokens`:**
| Model | Calls | Avg reasoning tk | Max reasoning | Verdict |
|-------|---:|---:|---:|---|
| `gpt-5-mini-2025-08-07` | 48 | **493** | 1,664 | 🧠 confirmed thinking |
| `gpt-4.1-mini-2025-04-14` | 315 | 0 | 0 | confirmed non-thinking |
| `gpt-4.1-2025-04-14` | 12 | 0 | 0 | confirmed non-thinking |
| `deepseek-chat` | 1,750 | 0 | 0 | confirmed non-thinking |

For gpt-5-mini, hidden reasoning is **108% of visible completion tokens** (493 vs 458) — users see less than half of what they pay for.

**Inferred for models with no `llmCallTracking` data** (gpt-5-nano, gpt-oss-20b, gemini, qwen, claude all have zero tracking rows):
- `gpt-5-nano` — **🧠 thinking** (10× cost-per-output-char vs gemini-flash-lite at same nominal output price; 6× duration ratio).
- `gpt-oss-20b` — **non-thinking in this pipeline** despite the model being capable. Per-output-char cost is **28× cheaper than gpt-5-nano** and avg duration is **5× shorter**. Likely the API client doesn't pass `reasoning_effort: "medium"`.
- `gemini-2.5-flash-lite`, `qwen-2.5-7b`, `claude-sonnet-4` — non-thinking (cost ratios ~1× theoretical or low).

**Quality on shared prompt ("Federal Reserve", n=43 runs):**
| Model | Type | n | Mean max_elo | SD | Min | Max |
|-------|------|--:|-----:|---:|---:|---:|
| deepseek-chat | non-thinking | 10 | **1395.3** | 53.7 | 1324.6 | 1502.8 |
| gpt-5-mini | 🧠 thinking | 11 | 1388.0 | **139.9** | 1200.0 | 1565.7 |
| gemini-2.5-flash-lite | non-thinking | 2 | 1340.4 | 30.8 | 1318.6 | 1362.2 |
| gpt-5-nano | 🧠 thinking | 7 | 1326.2 | 68.3 | 1200.0 | 1407.7 |
| gpt-oss-20b | non-thinking | 8 | 1325.5 | 52.8 | 1259.2 | 1407.2 |

**Conclusions:**
1. Quality is statistically a wash. Best thinking (gpt-5-mini, 1388) loses to best non-thinking (deepseek, 1395) by 7 Elo — within 1 SD.
2. Thinking models have **3× higher variance** (gpt-5-mini SD=140 vs deepseek SD=54). Bigger peaks (1565 vs 1503) but also more zeros (1200 = no improvement on 2 of 11 runs).
3. Cost is dramatically worse for thinking models — see §6.

Caveats: judge model is qwen-2.5-7b-instruct for all rankings; if qwen has stylistic preferences (e.g., favors prose-heavy explanations over reasoning-dense ones), thinking-model output could be unfairly penalized. Worth re-running a sample with a different judge to detect bias.

### 6. Cost-effectiveness ranking (per output token)

For the 6 generation models with `execution_detail.generation` data, sorted by raw token efficiency:

| Rank | Model | Type | $/M visible output tokens | Output chars per $ |
|----:|-------|------|---:|---:|
| 1 | gpt-oss-20b | non-thinking | **$0.14** | 27.7M |
| 2 | google/gemini-2.5-flash-lite | non-thinking | $0.45 | 8.9M |
| 3 | qwen-2.5-7b-instruct | non-thinking | $0.73 | 5.5M |
| 4 | deepseek-chat | non-thinking | $3.15 | 1.3M |
| 5 | gpt-5-nano | 🧠 thinking | $4.02 | 0.99M |
| 6 | gpt-5-mini | 🧠 thinking | $9.59 | 0.42M |

gpt-oss-20b is **68× more cost-effective per token than gpt-5-mini**, but pair with quality (Federal Reserve, Elo improvement ÷ run cost):

| Model | Δ Elo | Cost | **Elo/$** | Verdict |
|-------|---:|---:|---:|---|
| **gemini-2.5-flash-lite** | 140.4 | $0.022 | **6,376** | 🏆 best overall value |
| gpt-5-mini (🧠) | 188.0 | $0.047 | 3,974 | top quality, high variance, no cost edge |
| deepseek-chat | 195.3 | $0.049 | 3,964 | top quality, low variance, expensive |
| gpt-5-nano (🧠) | 126.2 | $0.049 | 2,562 | worst combination — expensive AND mediocre |
| gpt-oss-20b | 125.5 | $0.050 | 2,517 | cheap per token but low quality drags it down |

### 7. Canonical per-call costs (current pipeline, post-fix)

| Call type | Model | Sample | Avg cost | Median cost |
|---|---|---:|---:|---:|
| Generation | google/gemini-2.5-flash-lite | 90 calls (post-2026-04-20) | **$0.000742** | $0.000733 |
| Ranking (1 comparison = 2 calls) | qwen-2.5-7b-instruct | 1,145 comparisons | **$0.000201** | — |
| Ranking (1 LLM call) | qwen-2.5-7b-instruct | 2,290 calls | **$0.000101** | — |

A gemini generation call costs roughly **7.4× one qwen ranking LLM call**, or **3.7× one full bias-mitigated comparison**.

### 8. Outlier driver — Bug A (legacy chars/4 cost path)

The widely-quoted gemini "max" cost of $0.004649 (~5× median) traces entirely to a single old run.

| Era | Calls | Avg cost | Avg output chars | Implied $/M output tokens |
|-----|---:|---:|---:|---:|
| Post-2026-04-20 (real provider tokens) | 90 | $0.000742 | 7,778 | $0.38 |
| **Pre-2026-04-20** (legacy `response.length / 4`) | 9 | **$0.002233** | 7,817 | **$1.14** |

**~3× cost difference for the same model with the same output sizes** — caused entirely by the legacy `response.length / 4` heuristic which over-counted tokens for gemini (whose tokenizer is denser than 4 chars/token). All 9 pre-fix outlier calls are in run `6b92ab7f-ff57-4a73-a2eb-20a47b6a505b` (created 2026-04-17). The fix landed in `createEvolutionLLMClient.ts` between April 17 and April 22.

**Implication for historical run-level cost metrics**: any run created before ~2026-04-20 may have inflated `cost`/`generation_cost`/`ranking_cost` rows. `evolution/scripts/backfillInvocationCostFromTokens.ts` exists to repair these from `llmCallTracking`, but has not been applied to all runs (and won't help for runs whose `llmCallTracking` is empty — see Open Question 1).

There are no other systematic outlier drivers — the band of "long output → moderately higher cost" (e.g., 11k-char outputs at $0.0009-$0.0015) is normal token-length scaling, not a bug.

---

## Documents Read
- `docs/docs_overall/getting_started.md` — project doc map
- `docs/docs_overall/architecture.md` — overall ExplainAnything system
- `docs/docs_overall/project_workflow.md` — research/plan flow
- `docs/docs_overall/debugging.md` — `npm run query:staging`, Bug A/B cost-accuracy debugging recipes, `backfillInvocationCostFromTokens.ts`
- `evolution/docs/cost_optimization.md` — three-layer budget, reserve-before-spend, bias-mitigation 2× cost, `COST_METRIC_BY_AGENT` mapping
- `evolution/docs/metrics.md` — `evolution_metrics` EAV table, `generation_cost`/`ranking_cost`/`seed_cost` write path, `eloAttrDelta:*` attribution
- `evolution/docs/rating_and_comparison.md` — Swiss/triage, `parseWinner`, `compareWithBiasMitigation`, `ComparisonCache`
- `evolution/docs/data_model.md` — `evolution_agent_invocations.execution_detail` schema, `evolution_metrics` columns
- `evolution/docs/architecture.md` — config-driven iteration loop, `GenerateFromPreviousArticleAgent` (gen + binary-search rank in one invocation)
- `evolution/docs/agents/overview.md` — `Agent.run()` template, per-invocation `AgentCostScope`, `EvolutionLLMClient` retry policy (3 retries, 1s/2s/4s, 20s timeout)
- `evolution/docs/reference.md` — `createEvolutionLLMClient` pricing table, env vars
- `docs/feature_deep_dives/evolution_metrics.md` — Cost Estimates tab structure, `projectDispatchPlan`

## Code Files Read
None directly — all answers came from staging DB queries against `evolution_agent_invocations.execution_detail`, `evolution_metrics`, `evolution_strategies.config`, `evolution_runs`, `llmCallTracking`, and `evolution_variants`.

## Open Questions / Follow-ups

1. **`llmCallTracking` is missing rows for entire model families** (gpt-5-nano, gpt-oss-20b, gemini, qwen, claude all have zero rows). The fire-and-forget write in `createEvolutionLLMClient.ts` is silently failing for non-OpenAI provider responses. This is the audit gap — without it, we can't directly verify reasoning-token counts for these models, only infer from cost ratios. Worth filing as a separate bug.
2. **Three "ghost" runs** in the latest 20 (`8904e84c`, `ad892043`, `99dd9f51`) completed with 0 invocations and no `cost` metric row. Should these have been marked `failed`?
3. **Comparison-1's 87 s duration on invocation `a824f9e0`** suggests qwen-2.5-7b retries on staging. Is judge tail latency systemic? A query for invocations whose median comparison duration > 30 s would quantify; if widespread, consider a different judge or shorter timeout.
4. **`maxComparisonsPerVariant=5` is the dominant ranking-cost lever.** Reducing to 3 would cut ranking cost ~40%. Trade-off: less reliable per-variant Elo. Worth A/B testing on a low-stakes prompt.
5. **Judge bias possibility.** All 43 Federal Reserve runs were judged by qwen-2.5-7b. If qwen prefers prose-heavy explanations (the kind non-thinking models produce), thinking models could be unfairly penalized. Re-running 5-10 of those runs with gpt-4.1-mini as judge and seeing whether the model ranking flips would test this.
6. **Backfill historic runs.** `evolution/scripts/backfillInvocationCostFromTokens.ts` (per `debugging.md`) repairs pre-fix Bug A cost rows. Hasn't been applied — historic strategy/experiment aggregates may be skewed.
