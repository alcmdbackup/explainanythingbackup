# Brainstorm New Agents With Reflection Research

## Problem Statement
Come up with new agent types for the evolution pipeline that leverage reflection (a meta-cognitive pattern where an agent reviews its own or another agent's output and proposes improvements). Note how well reflection-style agents have performed in recent analyses. Special focus from `/research`: **how to adapt reflection to EDITING cheaply and flexibly — without the structural overhead of `paragraph_recombine`** (per-slot arena topics, N×M LLM calls, per-slot ranking, sync_to_arena, merge).

## Requirements (from GH Issue #1324)
Same as summary — come up with new agent types that leverage reflection. Note how well reflection agents performed in recent analyses performed.

## High Level Summary

### What "reflection" means in this codebase today
There is exactly one agent named for reflection — `reflect_and_generate_from_previous_article` — but at least five agents implement a "look at the artifact → propose improvements" pattern. Mapping them all by shape:

| Agent | Reflection step | What it produces | Cost shape |
|---|---|---|---|
| `reflect_and_generate` (`reflectAndGenerateFromPreviousArticle.ts`) | 1 LLM call: rank top-N of 24 tactics for THIS article given parent text + recent per-tactic Elo boost | Picks ONE tactic → delegates to `GenerateFromPreviousArticleAgent.execute()` (full regenerate) | reflection ($600 out toks) + GFPA generate + ranking. ~1.05× GFPA cost. |
| `criteria_and_generate` / `single_pass_evaluate_criteria_and_generate` (legacy + guardrails-only) | 1 combined eval+suggest LLM call: score against rubric + draft fix suggestions for K weakest | Builds `customPrompt` → delegates to GFPA with `tactic='criteria_driven'` (full regenerate) | eval+suggest call + GFPA generate + ranking. Comparable to reflect. |
| `proposer_approver_criteria_generate` (architectural-selectivity hypothesis) | eval+suggest → proposer (full-article CriticMarkup) → forward approver → mirror approver | Strict-binary aggregator (only `forward=accept, mirror=reject` applies) → mechanical position-based splice | 4 LLM calls + ranking. **~3-4× GFPA cost.** |
| `iterative_editing` / `iterative_editing_rewrite` (Mode A / Mode B of the same machinery) | Per-cycle Proposer + Approver up to N cycles. Mode A: inline CriticMarkup. Mode B: `## Rationale + ## Rewrite` then mechanical diff. | Mechanical splice of accepted groups. Final variant ranked once. | **~5× GFPA cost at default 3 cycles** — Proposer output is the full article (1.4× input) per cycle. |
| `paragraph_recombine_with_coherence_pass` Phase C | After per-slot recombine: bounded propose-review-apply loop (now Mode B default after `rebuild_coherence_pass_agent_mode_ab_configurable_20260624`) | Splice mechanical-diff edits into the recombined article | Phase A + B cost + ~$0.0070 typical / $0.014 worst Phase C. |

The common shape: **a small "what should change" reasoning step, then mechanical / templated execution.** Reflection is doing the *decision*; the agent that follows it does the *labor*.

### What recent analyses say about reflection-style performance
Three analyses dated 2026-06-24, 2026-06-27, and 2026-06-28 give a clear-enough picture:

**elo-agent-comparison-federal-reserve-2-20260628 (today)** — 9-arm comparison, 10 runs/arm, equal $0.10 budget, `google/gemini-2.5-flash-lite` both gen + judge:

| Arm | median max-lift | P(best) | %impr≥40 | %var>seed | spent $ |
|---|---|---|---|---|---|
| **`reflect_and_generate`** | **+165.5** | **96%** | 90% | **94%** | 0.980 |
| `generate` (control) | +131.3 | 4% | 90% | 64% | 0.969 |
| `iterative_editing_rewrite` (Mode B) | +81.7 | 0% | 90% | 63% | 0.978 |
| `criteria_and_generate` | +77.4 | 0% | 80% | **81%** | 0.954 |
| `single_pass_criteria` | +73.5 | 0% | 70% | **76%** | 0.964 |
| `iterative_editing` (Mode A) | +54.9 | 0% | 80% | **78%** | 0.991 |
| `proposer_approver` | +41.6 | 0% | 70% | 57% | 0.986 |
| `coherence_pass` | +6.9 | 0% | 20% | 44% | 0.866 |
| `paragraph_recombine` | +2.9 | 0% (4/10 failed) | 20% | 71% | 0.586 |

Key reads:
1. `reflect_and_generate` is the only arm that leads on **every** metric — ceiling (median max-lift) **and** density (`%var>seed` 94%).
2. The selection-style reflection (pick tactic → regenerate) BEATS the most expensive edit-style reflection (`proposer_approver` 4 LLM calls/parent) by **+124 Elo at median** for **3-4× lower cost**.
3. `iterative_editing_rewrite` (Mode B — cheap editing) lands middle of pack on ceiling (+81.7) but has 90% reliability (`%impr≥40`). It under-performs on density (`%var>seed` 63%) — the variants it produces are less consistently above the seed.
4. The criteria-style arms (criteria, single_pass, iterative_editing) have notably high **density** (76-81% `%var>seed`) despite middling ceilings — targeted-edit arms produce a *higher share* of seed-beating variants. `generate` and `editing_rewrite` win the ceiling on high-variance outliers.
5. **The +34 Elo edge of reflect over generate is NOT statistically significant at n=10** (95% CI [−6, +78], Holm p=0.23). reflect is "likely best", not proven.

**coherence-pass-enabled-ab-results-20260627** — Phase C ON vs OFF, same agent, n=8/arm: point estimate +0.3 Elo difference (CP-Off marginally ahead), Mann-Whitney p ≈ 0.56. Phase C is statistically indistinguishable from no Phase C at this resolution. Costs +5% per variant when on. Recommendation: ship `coherencePassEnabled: false` default. Constraints noted: ~80% judge draw bias caps effective resolution; only ~150-Elo gaps register as non-draws.

**coherence-pass-perf-ab-results-20260624** — Predecessor experiment FAILED by decision rule, but the deep dive found the proposer (`gemini-2.5-flash-lite`) emits clean rewritten articles instead of CriticMarkup in **~93% of invocations** under Mode A. Mode A asks the wrong shape of weaker models; Mode B (rewrite-then-diff) was the rebuild. **This is the load-bearing lesson for any reflection-driven edit agent:** weaker/cheaper models naturally produce "I rewrote it" output, not "here are my CriticMarkup edits."

### The paragraph_recombine overhead the user asked to avoid
Concretely, `paragraph_recombine` carries:
- **Per-invocation cost envelope $0.012-0.020** with coherence pass, sequential mode mean ~$0.016, worst $0.045 (cap $0.060). Legacy parallel-slot mean ~$0.005, cap $0.050.
- **Structural infrastructure**: per-slot arena topics in `evolution_prompts` (with `prompt_kind='paragraph'`), `upsertSlotTopic` + `loadArenaEntries` per slot, per-slot `AgentCostScope`, `sync_to_arena` payload threading + `persistSlotMatches` bulk insert per slot, `assembleRecombinedArticle` right-to-left splice, per-slot LLM-client proxy that relabels `'ranking'` → `'paragraph_rank'` for cost bucketing.
- **Schema dependencies**: `evolution_variants.variant_kind`, `evolution_prompts.prompt_kind`, the `sync_to_arena` JSONB extensions for `agent_name`/`variant_kind`/`parent_variant_ids`/`match_count` (migrations 20260527-20260529).
- **LLM-call density**: ~336 LLM calls per invocation at default knobs (12 slots × 3 rewrites × ranking) — vs ~5-10 for a vanilla `generate`.
- **Recent perf history**: per `elo-agent-comparison-federal-reserve-2-20260628`, `paragraph_recombine` failed 4/10 runs and landed +2.9 median lift in the 6 that completed.

So "without paragraph_recombine overhead" really means: **no per-slot arena topics, no sync_to_arena scaffolding, no merge-slot logic, no per-slot ranking infrastructure**, and ideally **no full-article markup output** (which is the cost lever for both iterative_editing and proposer_approver).

### Design directions for cheap, flexible reflection-driven editing
From the data + the existing patterns, four cheap-and-flexible reflection-to-editing patterns are available without touching the paragraph_recombine machinery:

1. **Reflect-and-localize** (closest analog to today's `reflect_and_generate`). Reflection LLM is asked NOT to pick a tactic from 24 candidates, but to pick a **region** (sentence index, paragraph index, or character span) AND a **directive** (tighten / clarify / expand / cite / strengthen-transition). The agent then does one focused LLM call that rewrites *only that span* and splices it back. Mechanically simple — no markup parser, no approver. Cost ≈ reflection LLM (small) + 1 short-output LLM call (rewrites a sentence or paragraph, not the full article). ~1.3-1.5× vanilla generate. **Avoids: full-article output, multi-cycle, per-slot infrastructure.**

2. **Reflect-then-rewrite-then-diff** (graft `reflect_and_generate` selection onto `iterative_editing_rewrite` Mode B). Reflection LLM picks a *focus area* (a heading, the intro, the worst paragraph by some heuristic), then a Mode-B proposer rewrites WITH SCOPE LIMITED to that area, then the mechanical diff is applied. The system-prompt scope constraint is the lever — Mode B's per-cycle output is still full-article, but the reflection focuses *what changes go through the approver*. Cheaper than today's `iterative_editing_rewrite` because the approver pass shrinks (fewer accepted groups expected) and we can drop to 1 cycle. **Avoids: multi-cycle compounding, expensive 1.4× output across many cycles.**

3. **Self-critique-then-revise** (no approver, no markup parser). One small reflection LLM call produces a *list of weaknesses* against a rubric (criteria-style eval, but lighter). One follow-up call to the generator rewrites with those weaknesses pinned in the prompt. NO Mode A markup, NO approver, NO mechanical-splice plumbing. This is what `single_pass_criteria_and_generate` already does (and it has 76% `%var>seed`), but with the reflection step itself being self-generated rather than tied to user-defined `evolution_criteria` rows — so it works on any topic without operator setup. ~2-2.2× vanilla generate (eval call + regenerate). **Avoids: criteria-table dependency, approver round trips.**

4. **Reflect-on-pool** (cross-variant reflection). Use the *pool* as input to reflection, not a single parent. The reflector reads the top-K Elo variants + their `rubric_breakdown` rows from `evolution_arena_comparisons` and identifies the dimension on which the pool is *uniformly weakest*. It then picks ONE variant + ONE tactic to dispatch GFPA against. Same dispatch cost as `reflect_and_generate`, but the reflection signal is pool-aware, so the picked tactic is one the pool *hasn't already saturated*. **Avoids: per-variant overhead; reflection is a single one-shot call per iteration regardless of dispatch count.**

A fifth, more speculative direction: **reflection as an opportunistic localizer ON TOP OF the existing rewriter.** I.e. the reflection call decides whether to dispatch GFPA (regenerate) OR a region-rewrite agent (edit) — a "should I edit or rewrite?" gating signal. This builds on the fact that targeted-edit arms have higher density (`%var>seed` 76-81%) while regenerate arms have higher ceiling. Reflection picks the right one per parent.

### Why these designs survive the data
- `reflect_and_generate` already won by **using reflection as a selection signal, not as an execution mechanism**. All 4 designs above keep reflection in the selection role.
- The proposer_approver and iterative_editing arms LOSE on cost ($0.10/run cap was tight enough that they ran fewer variants — `iterative_editing` 117 variants total vs `generate` 317, `reflect_and_generate` 244). Designs 1-3 keep cost-per-variant near the GFPA baseline so throughput stays comparable.
- The Mode A failure (proposer outputs clean rewrite, not markup) means **any new design must NOT depend on the proposer LLM emitting CriticMarkup as primary output**. Mode B (rewrite-then-diff) is the safe substrate.
- The 80% draw-rate judge ceiling means small-Δ edits won't register in arena ranking anyway — favoring fewer-but-larger interventions (reflect-and-localize on a worst paragraph) over many-tiny-edits (iterative_editing default).

### Open questions for `/plan-review`
1. Should reflection LLM use a stronger model than the generator (so the *decision* is high-quality even if the execution model is cheap)? Today, `reflect_and_generate` uses `generationModel` for the reflection call. The selectAndRevise / criteria-style results suggest splitting reflection-model from generation-model could unlock further gains.
2. How do we evaluate cheaply? `paragraph_recombine` got its rubric judging cheap because the slot's `comparisonMode='paragraph'` rubric is short. A reflect-and-localize agent that only edits one sentence might want a `sentence` comparison mode — but at $0.10/run we may not have budget for the rubric build-out.
3. Cross-variant reflection (Design 4) needs to read `rubric_breakdown` JSONB — which is populated only when `EVOLUTION_RUBRIC_JUDGING_ENABLED` is on. Should we gate the design on that, or design a holistic fallback?
4. Is reflection-as-gate (Design 5) worth a dedicated agent type, or should it ride along inside `reflect_and_generate` itself (the agent gets a 3-way choice — regenerate / edit-a-region / no-op)?

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Evolution Docs (full reads)
- evolution/docs/README.md
- evolution/docs/architecture.md — config-driven iteration loop, Agent base class, AgentCostScope, agent / subagent / level vocabulary, the I1-I4 wrapper-agent invariants
- evolution/docs/data_model.md — evolution_variants/prompts/strategies/runs/agent_invocations/judge_rubrics/criteria/style_fingerprints schema; `variant_kind` + `prompt_kind` paragraph/article partition
- evolution/docs/arena.md — `synced_to_arena` flag, `loadArenaEntries`, `syncToArena`, rubric_breakdown JSONB on `evolution_arena_comparisons`
- evolution/docs/rating_and_comparison.md — Elo + uncertainty (OpenSkill internally), `rankPool`, 2-pass A/B reversal, `buildComparisonPrompt` ('article' vs 'paragraph' modes), rubric judging path
- evolution/docs/strategies_and_experiments.md — StrategyConfig + IterationConfig + judgeRubricId + config_hash v2 normalization
- evolution/docs/agents/overview.md — Agent base class, `ReflectAndGenerateFromPreviousArticleAgent`, `EvaluateCriteriaThenGenerateFromPreviousArticleAgent`, `SinglePassEvaluateCriteriaAndGenerateAgent`, `ProposerApproverCriteriaGenerateAgent`, `IterativeEditingAgent`
- evolution/docs/criteria_agents.md — the 3 criteria agents in depth, propose/approve mirror protocol, sentence_verbatim_ratio metric
- evolution/docs/editing_agents.md — `IterativeEditingAgent` per-cycle cost anatomy (Proposer output is 1.4× input ⇒ output-heavy), 5× GFPA cost at 3 cycles, Mode A/B split
- evolution/docs/paragraph_recombine.md — per-slot infra, sequential context-aware path, coordinator replan, sequential perf tuning project (continuity directive, length target, next-context, paragraph-judge rubric)
- evolution/docs/paragraph_recombine_with_coherence_pass.md — Phase A+B+C structure, Mode A/B configurable coherence pass, cost envelope, A/B experiment design

### Analyses (most recent, reflection-relevant — full reads)
- docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/elo-agent-comparison-federal-reserve-2-20260628.md
- docs/analysis/coherence-pass-enabled-ab-results-20260627/coherence-pass-enabled-ab-results-20260627.md
- docs/analysis/coherence-pass-perf-ab-results-20260624/coherence-pass-perf-ab-results-20260624.md

### Code files read
- evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts — confirmed prompt shape, parser tolerance, load-bearing invariants (inner GFPA via `.execute()` not `.run()`; `costBeforeReflection` snapshot; partial-detail persistence on every throw path)
- evolution/src/lib/core/agents/editing/ — directory listing showing `IterativeEditingRewriteAgent.ts`, `proposerPromptRewrite.ts`, `runEditingCycle.ts`, full editing toolkit (parser, drift check, validator, applier, prompts for both proposer + approver, mirror primitives)

## Key Findings
1. **Reflection-as-selection beats reflection-as-execution on both Elo and cost.** `reflect_and_generate` won the 2026-06-28 ceiling at near-GFPA cost; the propose/approve and iterative_editing arms paid 3-5× the cost for lower ceiling. The data does NOT support adding more "review-the-output-with-an-approver" loops.
2. **Editing variants currently lose on density too.** `proposer_approver` 57% `%var>seed`, `iterative_editing_rewrite` 63%, `coherence_pass` 44%. The reflection-driven arm (`reflect_and_generate` 94%) and the criteria arms (76-81%) win density. Targeted-edit overhead doesn't pay off at current judge resolution.
3. **The cheap-editing path that already exists (`iterative_editing_rewrite`, Mode B) has 90% reliability but only middling density.** It's the best floor for "low-overhead editing" today; a reflection-driven version that *chooses where to edit* could lift its density without raising cost much.
4. **Paragraph_recombine overhead is heavy AND that overhead does not currently pay off** — it failed 4/10 runs at $0.10 budget and the surviving runs landed +2.9 Elo. Any new editing agent should structurally avoid: per-slot arena topics, `sync_to_arena` extensions, per-slot ranking, per-slot AgentCostScope nesting.
5. **Mode A (CriticMarkup-in proposer output) is now considered a foot-gun for cheap proposer models.** ~93% of `gemini-2.5-flash-lite` invocations produced clean rewrites instead of markup in coherence-pass-perf-ab-results-20260624. Any new editing agent must default to Mode B (rewrite-then-diff) or skip diff-based editing entirely.
6. **The judge currently caps detectable Elo deltas at ~150 Elo (~80% draw rate).** Small surgical edits (`iterative_editing` typical ~5-15 atomic edits) routinely fall under this resolution. Designs should favor *fewer, larger* interventions (one targeted paragraph rewrite) over *many tiny* ones.
7. **Reflection-driven cost can be split from execution-driven cost.** `reflectAndGenerateFromPreviousArticle.ts:281` snapshots `costBeforeReflection = ctx.costTracker.getOwnSpent()` precisely so the reflection cost is observable separately from inner GFPA spend. This pattern is the template for any new wrapper that wants to budget reflection independently — including reflect-and-localize, reflect-then-Mode-B, and reflect-on-pool.

## Open Questions
1. Should reflection use a stronger model (sonnet-class) than generation (lite-class) so the *decision* is high-quality even when execution is cheap? This is the "reflect-cheap-execute" inversion of today's setup.
2. How do we evaluate small surgical edits when the judge has 80% draw bias? Options: paragraph-mode comparison prompt (already exists), a `sentence` comparison mode (new — would need rubric work), or paired direct-comparison runs (sidesteps Elo).
3. Is there appetite for cross-variant reflection (reading rubric_breakdown JSONB across the pool), or is that gated behind broader rubric-judging adoption?
4. Should reflection-as-gate (choose regenerate vs edit-a-region vs no-op) be a new agent or a new *mode* of `reflect_and_generate`?
5. What's the smallest meaningful experiment to validate a reflect-and-localize agent against `reflect_and_generate`? Re-using the same 9-arm methodology with $0.10/run would let us compare apples-to-apples.
