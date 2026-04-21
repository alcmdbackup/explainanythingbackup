# Investigate Under-Budget Run Evolution Research

## Problem Statement
Help me investigate why so few agents were launched (6 total) for run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f` on stage. With gemini 2.5 flash lite model, strategy creation prediction says 20+ agents should be created, but the run features <7.

## Requirements (from GH Issue #NNN)
Use @docs/docs_overall/debugging.md to see how to query supabase dev to investigate.

- Query staging Supabase (`npm run query:staging`) following debugging.md patterns.
- Start from run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f`: fetch status, `budget_cap_usd`, `strategy_id`, `run_summary`, `error_message`.
- Pull the strategy config (`evolution_strategies.config`) to see `iterationConfigs[]`, `generationModel` (gemini-2.5-flash-lite), `budgetUsd`, `generationGuidance`, and the budget-floor fields (`minBudgetAfterParallel*`, `minBudgetAfterSequential*`).
- Read `evolution_metrics` for the run: `cost`, `generation_cost`, `ranking_cost`, `seed_cost`, `agent_cost_projected`, `agent_cost_actual`, `parallel_dispatched`, `sequential_dispatched`, `estimated_cost`, `cost_estimation_error_pct`.
- List `evolution_agent_invocations` rows by iteration + agent_name + success to confirm the agent count (~6) and which iterations they landed in.
- Correlate against `evolution_logs` for `kill_check`, `budget`, `iteration_budget_exceeded`, and `seed_failed` events.
- Reconcile the strategy creation wizard's predicted 20+ agents with actual dispatch — likely branches: (a) budget-floor gating (parallel/sequential floor too conservative for flash-lite pricing), (b) wizard's `estimateAgentCost()` underestimating flash-lite cost vs runtime actual, (c) per-iteration budget exhaustion, (d) seed_failed short-circuit, (e) run killed/cancelled early.
- Identify the root cause and propose a fix (wizard prediction, runtime dispatch math, or budget-floor defaults).

## High Level Summary

The run behaved **correctly according to the runtime code path**. It completed normally at 31.5 % of its $0.05 budget with no error, no kill, no budget exception. The 6-agent count is the mathematically correct output of the runtime formula for this strategy config. The **discrepancy with the user's expectation traces to the strategy-creation wizard, whose dispatch-preview formula diverges from the runtime loop in four concrete ways**. This is a wizard-vs-runtime prediction bug, not a runtime dispatch bug.

### What the runtime actually does

`evolution/src/lib/pipeline/loop/runIterationLoop.ts`:
```
line 188:  const numVariants = config.numVariants ?? 9;             // silent default cap
line 316:  const maxAgentsForIter = iterCfg.maxAgents ?? numVariants;
line 317:  const dispatchCount = Math.min(maxAgentsForIter, maxAffordable);
line 320:  if (iterIdx === 0) parallelDispatchedCount = dispatchCount;
line 322:  else sequentialDispatchedCount += dispatchCount;
```

For this run:
- `iterCfg.maxAgents` = null → `maxAgentsForIter = 9`
- `maxAffordable` = 3 per iteration (logs confirm `dispatchCount: 3, maxAffordable: 3, iterBudgetUsd: 0.025`)
- `dispatchCount = min(9, 3) = 3` per iteration, 2 iterations → **6 generate agents**
- Iter 0 labeled `parallel_dispatched = 3`, iter 1 labeled `sequential_dispatched = 3` (purely a per-iteration temporal label, not a within-iteration split)

### What the wizard predicts

`src/app/admin/evolution/strategies/new/page.tsx:217-252` (`dispatchEstimates` memo):
```
seedChars = 5000                                              // hardcoded constant
estPerAgent = estimateAgentCost(5000, 'structural_transform', genModel, judgeModel, 1, 15)
parallelFloorUsd = estPerAgent * 2                            // agentMultiple path
availForParallel = iterBudget - parallelFloorUsd
uncappedParallel = floor(availForParallel / estPerAgent)
parallel = min(maxAgents /* default 100 */, max(1, uncappedParallel))
remainAfterParallel = iterBudget - parallel * estPerAgent
sequential = floor(remainAfterParallel / estPerAgent)         // wizard adds a sequential phase
```
Reproduced for this strategy: `estPerAgent ≈ $0.00453` → parallel = 3, sequential = 2 per iteration → **5 per iteration × 2 = 10** predicted. (Persisted `numVariants: 9` is the runtime default cap, not the wizard's output; the user's "20+" recollection likely conflated the wizard preview with an earlier strategy build.)

### The five concrete wizard/runtime divergences (ordered by impact on this run)

| # | Area | Wizard (preview) | Runtime (actual) | Effect on run 2fd03e7f |
|---|------|------------------|------------------|------------------------|
| **1 (dominant)** | `poolSize` for rankCost | Hardcoded `poolSize = 1` → `numComparisons=0` → rankCost=0 (`page.tsx:228`) | Actual `pool.length` at dispatch = 494 (arena entries for this prompt) → `numComparisons=min(493,15)=15` → rankCost=$0.006210 (`runIterationLoop.ts:312`) | Wizard estPerAgent=$0.001216 vs runtime $0.007426 (**6.1× gap**). maxAffordable 20 vs 3. |
| 2 | Seed article length | Hardcoded `seedChars = 5000` (`page.tsx:225`) | Actual `originalText.length` ≈ 8,316 chars (`runIterationLoop.ts:260, 311`) | ~1.7× higher genCost; secondary to #1 |
| 3 | Within-iteration phases | Wizard models `parallel + sequential` inside ONE iteration (`page.tsx:236-250`) | Runtime does ONE `dispatchCount` per iteration (`runIterationLoop.ts:317, 319-323`) | Wizard inflates prediction by ~+2 agents per iteration that runtime never dispatches |
| 4 | Global variant ceiling | Wizard uses `maxAgents` default 100 | Runtime uses `numVariants` default 9 (silent cap, not in UI) | Runtime ceiling is lower and invisible to the strategy author |
| 5 | `projectDispatchCounts()` | Not used by wizard | Not used by runtime dispatch either — what-if model for cost-sensitivity (`costEstimationActions.ts:320-335`) | Third "truth" in the codebase, further confusing the mental model |

### The math, end-to-end (answering "why maxAffordable = 3?")

Staging log (both iterations identical):
```
availBudget=0.025, estPerAgent=0.007426, maxAffordable=3
```

`maxAffordable = floor($0.025 / $0.007426) = floor(3.3666) = 3`.

`estPerAgent = genCost + rankCost` where:

| Component | Inputs | Formula | Value |
|-----------|--------|---------|-------|
| genCost | gemini-2.5-flash-lite @ $0.10 / $0.40 per 1M; inputChars=8,316+500; outputChars=9,956 (`EMPIRICAL_OUTPUT_CHARS['structural_transform']`) | `(ceil(8816/4)*0.10 + ceil(9956/4)*0.40)/1e6` | **$0.001216** |
| rankCost | qwen-2.5-7b-instruct @ $0.04 / $0.10 per 1M; **poolSize=494** (arena) → numComparisons=min(493,15)=**15**; 2 calls/comparison (bias reversal); 20,610 inputChars per call (698 overhead + 2×9956) | `15 × 2 × calculateCost(20610, 20, qwenPricing)` | **$0.006210** |

**Ranking is 84% of estPerAgent.** If this prompt had no arena entries, rankCost would be 0 and `maxAffordable = floor($0.025 / $0.001216) = 20` — which is exactly the "20+" the user remembers seeing in the wizard preview. The wizard's `poolSize=1` hardcode models the empty-arena case; the runtime hit the full 494-entry arena for prompt `50514a24-cdf3-40e4-a1c1-922009ebd74d` ("What is the Federal Reserve…").

### Per-agent cost, fully decomposed

**Generation (1 gemini-2.5-flash-lite call @ $0.10/$0.40 per 1M tokens):**

| Step | Value |
|---|---|
| seedArticleChars (back-derived) | 8,316 |
| + GENERATION_PROMPT_OVERHEAD | 500 |
| inputChars | 8,816 |
| inputTokens = ceil(8816/4) | 2,204 |
| inputCost = 2,204 × $0.10 / 1M | $0.0002204 |
| outputChars = EMPIRICAL_OUTPUT_CHARS['structural_transform'] | 9,956 |
| outputTokens = ceil(9956/4) | 2,489 |
| outputCost = 2,489 × $0.40 / 1M | $0.0009956 |
| **genCost** | **$0.001216** |

**Ranking (30 qwen-2.5-7b-instruct calls @ $0.04/$0.10 per 1M tokens):**

| Step | Value |
|---|---|
| poolSize at dispatch | 494 (arena-loaded) |
| numComparisons = min(max(494−1,0), 15) | **15** (capped) |
| Calls per comparison (forward + reverse reversal) | 2 |
| **Total ranking LLM calls per agent** | **30** |
| Per-call inputChars = 698 (overhead) + 2 × 9,956 (both variants) | 20,610 |
| Per-call inputTokens = ceil(20610/4) | 5,153 |
| Per-call inputCost = 5,153 × $0.04 / 1M | $0.00020612 |
| Per-call outputChars (COMPARISON_OUTPUT_CHARS "A"/"B"/"TIE") | 20 |
| Per-call outputTokens = ceil(20/4) | 5 |
| Per-call outputCost = 5 × $0.10 / 1M | $0.0000005 |
| costPerCall (rounded to 6 decimals) | $0.000207 |
| **rankCost = 30 × $0.000207** | **$0.006210** |

**estPerAgent = $0.001216 + $0.006210 = $0.007426** (ranking is **83.6%**). 31 LLM calls per agent estimated; ~16 observed per agent (binary search exits early on convergence). Across the 6-agent run: ~96 LLM calls in the logs.

### Why only 31.5 % of budget was consumed (two compounding effects)

The run consumed $0.01575 of the $0.05 cap. This breaks into two independent under-utilization factors:

**Effect 1 — structural 6-agent cap.** `maxAffordable = 3` per iteration × 2 iterations = 6 agents dispatched. Budget math assumed $0.00743 × 6 = $0.0446 would be spent (≈90 % of budget). That's what the runtime *expected* to spend.

**Effect 2 — per-agent cost was 35 % of estimate.** Each agent actually cost $0.00263, not $0.00743. Compound:

| | Estimated | Actual | Ratio |
|---|---|---|---|
| LLM calls per agent | 1 gen + 30 ranking = **31** | 1 gen + 15 ranking = **16** | 52 % |
| Total LLM calls (run) | 186 | 96 | 52 % |
| Total comparisons (run) | 90 (= 6 × 15) | **45** | 50 % |
| Generation cost per agent | $0.001216 (structural\_transform bound) | $0.000790 (avg across 3 tactics) | 65 % |
| Ranking cost per agent | $0.006210 | $0.001836 | **30 %** |
| Total per-agent cost | $0.007426 | $0.002626 | **35 %** |
| Total run cost | $0.04456 | **$0.01575** | 35 % |

**Why ranking realized 30 % of estimate (the dominant saving):**

1. **Binary-search early exit.** `rankSingleVariant` stops when a variant's uncertainty drops below 72 (convergence) OR when `elo + 2·uncertainty < top20Cutoff` (elimination). With a 494-entry arena pool and 10/45 matches being draws (22 %), most variants converged or were eliminated in ~7.5 comparisons instead of the 15-cap. Observed: 45 total comparisons / 6 agents = 7.5 avg (50 % of the cap).
2. **Actual variants shorter than empirical assumption.** The 6 variants averaged 8,389 chars vs `EMPIRICAL_OUTPUT_CHARS['structural_transform'] = 9,956`. That shrinks comparison input from 20,610 → ~17,476 chars → ~15 % cheaper per ranking LLM call.
3. **Round-robin across 3 tactics.** Estimate uses only `tactics[0]`'s empirical output size; runtime cycled structural_transform / lexical_simplify / grounding_enhance. `lexical_simplify` produces shorter output (5,836 empirical), bringing the 6-agent generation cost to 69 % of upper-bound estimate.

**Why this matters for the refactor.** The estimate used at the dispatch gate is a **worst-case upper bound**, not an expected value. This is safe (won't overspend) but leaves budget on the table:

- A calibrated "expected comparisons per agent" (say, empirical median of ~8 from past runs) would let roughly 2× more agents fit per iteration at the same budget.
- Users interpret the wizard preview "estimated cost" as expected spend; the 3× gap between upper-bound and reality drives under-confidence in the preview and causes exactly the kind of surprise that triggered this investigation.
- The fix is not "make the estimate lower" (that breaks the reservation safety). The fix is **display the range** — show expected value alongside upper bound, so the dispatch gate stays conservative while the UI communicates likely outcome.

### Levers that would raise the agent count

| Lever | New maxAffordable per iter | Runtime total |
|---|---|---|
| Drop `maxComparisonsPerVariant` from 15 → 5 | rankCost → $0.00207; estPerAgent → $0.00329; maxAffordable = **7** | 14 agents |
| Raise budget from $0.05 → $0.25 | iterBudget $0.125; maxAffordable = 16 → capped by `numVariants=9` | 18 agents (2 iters × 9) |
| Use fresh prompt (no arena) | rankCost → $0; estPerAgent = $0.001216; maxAffordable = **20** → capped by `numVariants=9` | 18 agents |
| Set `numVariants` on config (currently invisible in wizard) to e.g. 20, AND use fresh prompt or lower maxComparisons | uncapped | up to 40 across 2 iters |

### Why the run spent only 31.5 % of budget

`cost = 6 × ~$0.00262 ≈ $0.01575`. The remaining budget was never touched because the per-iteration budget ($0.025) gated `maxAffordable = 3`, and the second iteration also stopped at 3 (same budget, similar per-agent cost). There was never a code path to dispatch a 4th-9th agent in either iteration.

### Secondary finding (separate bug, worth flagging)

Every invocation row has `cost_usd = 0` and `execution_detail.totalCost = 0`, but run-level `generation_cost = $0.004738` / `ranking_cost = $0.011016` are correct. Signature: `AgentCostScope.getOwnSpent()` is returning 0 so per-invocation `cost_usd` falls back to the empty `detail.totalCost`. `writeMetricMax` continues to populate run-level metrics from the LLM-client layer, which is why the run totals are right. This matches the "Bug B extension" described in `docs/docs_overall/debugging.md:428`. It also produces the bogus `cost_estimation_error_pct = -100 %` on every generate invocation (actual 0 vs estimated ~$0.0068).

Not the cause of the 6-agent outcome, but should be its own fix.

### Dead config surfaces

| Field | Status | Location |
|-------|--------|----------|
| `strategiesPerRound` | Declared in schema (`schemas.ts:526`), defaulted to 3 in `runIterationLoop.ts:197`, **never read** in tactic selection or dispatch | Safe to remove or document as no-op |
| `numVariants` | `@deprecated` in `schemas.ts:534`, yet load-bearing at runtime (`runIterationLoop.ts:316`). Not exposed in wizard UI. | Either surface in wizard or rely exclusively on per-iteration `maxAgents` |
| Wizard's within-iteration sequential phase | Models behavior the runtime does not implement | Remove from wizard OR implement at runtime |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/* (all 15 canonical evolution docs read via Glob)

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/multi_iteration_strategies.md
- docs/feature_deep_dives/evolution_metrics.md

### Referenced in requirements
- docs/docs_overall/debugging.md — staging query patterns, Bug B extension note

## Code Files Read
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — runtime dispatch math (lines 181-340, 660-680)
- `evolution/src/lib/pipeline/loop/projectDispatchCount.ts` — cost-estimation what-if model (not used at runtime)
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `estimateAgentCost()` cost formula (lines 67-122)
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — legacy `strategiesPerRound` default (line 280)
- `evolution/src/lib/schemas.ts` — `strategiesPerRound` (526), `numVariants` (534, `@deprecated`)
- `evolution/src/lib/core/tactics/generateTactics.ts` — `DEFAULT_TACTICS = [structural_transform, lexical_simplify, grounding_enhance]` (index.ts:108-113)
- `evolution/src/lib/core/tactics/selectTacticWeighted.ts` — guidance-based path
- `src/app/admin/evolution/strategies/new/page.tsx:217-252` — wizard `dispatchEstimates` memo
- `src/config/llmPricing.ts` + `src/config/modelRegistry.ts:111-115` — gemini-2.5-flash-lite pricing ($0.10 / $0.40 per 1M tokens, correctly wired)
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — runtime cost recording path
- `evolution/src/services/costEstimationActions.ts:316-335` — sensitivity analysis using `projectDispatchCounts()`

## Key Findings

1. **The run behaved correctly.** `stopReason: 'completed'`, 6 agents dispatched = `min(numVariants=9, maxAffordable=3) × 2 iterations`. 31.5 % of budget spent is the natural outcome when `maxAffordable` is the binding constraint per iteration.
2. **The 20+ expectation came from the wizard, whose formula diverges from runtime in 4 ways:** hardcoded 5000-char seed, within-iteration sequential phase, different max-agents ceiling (100 vs 9), and a third `projectDispatchCounts()` simulation model used only for cost-estimate sensitivity.
3. **`numVariants` is `@deprecated` in the schema but still load-bearing at runtime** and **invisible in the wizard UI** — users cannot lift the silent cap of 9 without hand-editing the config.
4. **`strategiesPerRound` is dead configuration** — declared, defaulted, but never consulted for tactic selection or dispatch sizing.
5. **Tactic selection caps at `DEFAULT_TACTICS.length = 3`** via round-robin when `generationGuidance` is null; tactics are not the binding constraint on agent count (budget is), but users setting `strategiesPerRound > 3` without `generationGuidance` get no effect.
6. **A cost-attribution bug is co-resident** (not the cause): `Agent.run()`'s `AgentCostScope` is not capturing `recordSpend` for this code path, leaving `cost_usd = 0` on invocation rows and `cost_estimation_error_pct = -100 %`. Run-level metrics remain correct via the LLM client's `writeMetricMax`. See `debugging.md:428` "Bug B extension".

## Open Questions

1. **Is the wizard's sequential phase aspirational?** Was there a plan to add within-iteration sequential dispatch at runtime that was never completed, leaving the wizard ahead of reality — or is the wizard simply wrong? If aspirational, the fix is runtime; if wrong, the fix is wizard.
2. **Should `numVariants` default be raised, removed, or surfaced?** Options: (a) delete the deprecation and keep 9 as a documented cap in the UI, (b) change the default to `Infinity` / `100` so `maxAgents` governs alone, (c) remove the field entirely and require per-iteration `maxAgents`.
3. **What wizard number did the user actually see?** The reproduced wizard math yields ~10 for this config, not 20+. Possibilities: a prior strategy build with `strategiesPerRound` set higher, a different preview component, or a different input article length assumption. Worth a follow-up playwright check on the wizard UI.
4. **Should the Bug-B-extension cost-attribution fix be folded into this project's scope, or tracked separately?** It produces the `-100 %` estimation error that shows up in our metrics report and would be a clean companion fix.
