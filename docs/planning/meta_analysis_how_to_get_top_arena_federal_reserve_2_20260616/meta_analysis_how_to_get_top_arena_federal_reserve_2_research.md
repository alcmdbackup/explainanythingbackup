# Meta Analysis: How to Get Top Arena (Federal Reserve 2) Research

## Problem Statement
Analyze what approaches are effective at generating variants that reach the very top of the Arena leaderboard for federal reserve 2. Generate new ideas for how to improve our existing system.

## Requirements (from GH Issue #NNN)
Same as summary - analyze and then generate new suggestions.

Concretely:
- Identify which approaches (strategies / agents / tactics / models / iteration shapes / criteria / rubrics / sourceMode+cutoff / floor configs / temperatures) produce variants that land at the **top of the Arena leaderboard** for the prompt currently named "federal reserve 2".
- Quantify the effect: who wins, by how much (Elo Δ + CI), at what cost (eloPer$), and how reliably (win rate, variance, decisive rate).
- Generate new ideas — concrete, implementable proposals — for system changes that should lift top-of-arena performance further.

## High Level Summary

**Prompt:** "Federal Reserve 2" lives on **staging** with UUID `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (`prompt_kind='article'`, created 2026-04-15). It does NOT exist on production. The canonical baseline (id `26ab2327-6f14-488d-b68f-9e155a7ed278`, `agent_name='baseline'`, `generation_method='seed'`, Elo 1104.6, 7,682 chars) is the most-common starting article for evolution runs against this prompt.

**Arena population:** 2,388 active article variants synced to arena, decile-banded:

| Decile | n | Elo range | Avg |
|---|---|---|---|
| 1 (top 10%) | 239 | 1286.8 – 1431.0 | 1327.8 |
| 2 | 239 | 1257.1 – 1286.5 | 1269.5 |
| 5 | 239 | 1200.5 – 1222.3 | 1209.2 |
| 10 (bottom) | 238 | 1057.7 – 1092.7 | 1075.3 |

**Three independent perspectives converge** on the same shortlist of winning approaches:

1. **Per-variant quality (avg_elo by producing agent)** — top-of-arena average Elo per producer:
   - `iterative_editing` (n=14): **1328.2** (max 1392)
   - `iterative_editing_rewrite` (n=18): **1312.3** (max 1391)
   - `engagement_amplify` (n=45): **1263.9** (max 1400)
   - `expansion_elaborate` (n=8): 1254.8
   - `historical_context` (n=14): 1254.6
   - `debate_synthesis` (n=19): **1242.7** + win_rate 0.316 (highest win rate)
   - `paragraph_recombine` (n=76): 1240.2 (max **1403**)
   - `criteria_driven_single_pass` (n=122): 1229.8
   - `structural_transform` (n=540): 1219.8 (max **1416**)
   - `grounding_enhance` (n=423): 1218.8 (max **1403**)
   - `criteria_driven_propose_approve` (n=75): **1138.5** ← underperforms
   - `lexical_simplify` (n=464): **1105.2** ← worst
2. **Volume → top-10% slots (composition of top 239)**: `structural_transform` 80 (33%), `grounding_enhance` 49 (20%), `criteria_driven_single_pass` 20 (8%), legacy `criteria_driven` 15 (6%), `paragraph_recombine` 14 (6%), `engagement_amplify` 13 (5%), `iterative_editing` 12 (5%), `iterative_editing_rewrite` 8 (3%). High-volume generic tactics flood the top 10% even though their per-variant means are mediocre — they buy lottery tickets cheaply and the tail lands well.
3. **Global Δ-Elo vs parent (`avg_elo_delta` on tactic leaderboard)** — children's Elo minus parent's: `engagement_amplify` +63, `expansion_elaborate` +51, `historical_context` +48, `contrast_frame` +44, **`debate_synthesis` +43 with win_rate 0.32**, `expert_deepdive` +36, `analogy_bridge` +32, `counterpoint_integrate` +28, `zoom_lens` +25, `narrative_weave` +24; `grounding_enhance` +7, `structural_transform` **−5** (negative), `lexical_simplify` **−14**, `progressive_disclosure` **−49**, `compression_distill` **−45**.

**Top 5 strategies producing top-30 variants** (all `judgeModel='qwen-2.5-7b-instruct'`, all `budgetUsd=$0.05`, all `generationTemperature=1`):

| Strategy | Gen model | Shape |
|---|---|---|
| Sequential iteration 2 | gemini-2.5-flash-lite | 14 iters: generate seed (9%) + 13× generate pool top-1/3 (7% each) with full-24-tactic guidance. Produced **#1 winner: zoom_lens, Elo 1431, gen 7, depth-4 lineage** (baseline→pedagogy_scaffold→curiosity_hook→historical_context→zoom_lens) |
| Sequential paragraph rewrite initial | gemini-2.5-flash-lite + custom rubric `f3c1af7a` | 2 iters: generate (40%) + paragraph_recombine pool top-3 (60%, maxDispatches=3, rewritesPerParagraph=3, maxComparisonsPerParagraph=3, max 12 paragraphs). Produced 3 of top 10 |
| Ligther strategy 2 | deepseek-v4-flash | 2 iters: generate (50%) + paragraph_recombine pool top-4 (50%, rewritesPerParagraph=3, maxComparisonsPerParagraph=8, max 12 paragraphs). Produced **grounding_enhance Elo 1403** and **paragraph_recombine Elo 1403** |
| Iterative editing - markup | gemini-2.5-flash-lite | 3 iters: generate seed (34%) + iterative_editing (33%) + iterative_editing (33%) — markup mode. Produced top iterative_editing variants up to **Elo 1392** |
| Iterative editing - whole article | gemini-2.5-flash-lite | 3 iters: generate seed (34%) + iterative_editing_rewrite (33%) + iterative_editing_rewrite (33%). Produced top iterative_editing_rewrite variants up to **Elo 1391** |
| Paragraph rewrites, better model | deepseek-v4-pro | 2 iters: generate + paragraph_recombine. Top variant **Elo 1403** |

**Sentence-verbatim-ratio pattern** (federal_reserve_2 only):

| Agent | avg ratio | avg Elo | n |
|---|---|---|---|
| paragraph_recombine | 0.502 | 1250 | 48 |
| debate_synthesis | 0.195 | 1243 | 19 |
| criteria_driven_single_pass | 0.766 | 1230 | 122 |
| structural_transform | 0.026 | 1222 | 359 |
| grounding_enhance | 0.013 | 1216 | 288 |
| criteria_driven_propose_approve | 0.951 | 1139 | 75 |
| lexical_simplify | 0.023 | 1104 | 331 |

Two winning regimes: **(a) ~50% preservation with strong rewrites** (paragraph_recombine) or **(b) wholesale rewrites done well** (structural_transform's max-Elo tail). The catastrophic failures cluster at the extremes — propose/approve agent edits *too little* (0.951 ratio → 1139 Elo) while lexical_simplify rewrites everything *poorly* (0.023 ratio → 1104 Elo).

**Cost economics for top-50-producing runs**: avg total cost **$0.038** (just under the $0.05 cap), avg variants/run 16.8, avg winner_elo 1383. Roughly **$1 buys ~25 attempts at a top-100 arena slot**. Reflection is barely used at the top (n=2 of 50). Seed cost is ~0 — runs reuse the persisted seed.

**Lineage depth pattern**: top-tier winners reach the top via TWO distinct lineage shapes:
- **Shallow (depth=1)**: a single high-variance hop off the canonical baseline produces winners like the Elo-1416 `structural_transform` and the Elo-1392 `iterative_editing`.
- **Deep (depth=4+)**: the 14-iteration "Sequential iteration 2" strategy walked through `pedagogy_scaffold` (gen 1, Δ-tactic −23) → `curiosity_hook` (gen 2, Δ-tactic −5) → `historical_context` (gen 3, Δ-tactic +48) → `zoom_lens` (gen 7, Δ-tactic +25), and the final `zoom_lens` hop produced the **Elo 1431 winner** — the highest variant in the entire arena. The intermediate "weak" parents were still chosen by pool-mode top-N selection because the gen-7 pool was already enriched. Deep iteration works when each iteration's pool-cutoff filters out bad branches before they re-enter parent selection.

## Documents Read

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

### Relevant Docs (discovered in step 2.7)
- evolution/docs/arena.md
- evolution/docs/architecture.md
- evolution/docs/agents/overview.md
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/variant_lineage.md
- evolution/docs/metrics.md
- evolution/docs/cost_optimization.md
- evolution/docs/data_model.md
- evolution/docs/visualization.md
- evolution/docs/README.md
- evolution/docs/agents/overview.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/evolution_metrics.md
- evolution/docs/reference.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/prompt_editor.md
- evolution/docs/curriculum.md

## Code Files Read

Conducted via SQL against staging Supabase via `npm run query:staging`. No source files read in this research pass — analysis was data-driven against `evolution_variants`, `evolution_runs`, `evolution_strategies`, `evolution_agent_invocations`, `evolution_metrics`, `evolution_tactics`, `evolution_prompts`, and RPC `get_variant_full_chain`. Source files referenced for context in the planning doc and relevant evolution docs (architecture, arena, agents/overview, etc.).

## Key Findings

1. **Two paths to the top.** The top 30 contains both **shallow single-hop winners** (`structural_transform`/`grounding_enhance` directly off the baseline at gen 1) AND **deep iterative winners** (14-iteration `zoom_lens` at gen 7). Either path can produce a top-3 variant.
2. **Editing-style agents beat generate-style agents on per-variant Elo.** `iterative_editing` (1328 avg) and `iterative_editing_rewrite` (1312 avg) are the highest-mean producers. They outperform every pure generate tactic. But their volume is small (n=14, 18) compared to `structural_transform` (n=540), so they don't dominate top-10% composition by count.
3. **`structural_transform` paradox.** Negative average Δ-Elo vs parent (−5) yet **highest absolute Elo achieved** (1416) and 33% of the top 10%. Mechanism: high-variance wholesale rewrites — most are bad, the tail is excellent. Volume + variance + judge-selection — not per-variant quality — is the winning recipe.
4. **Two failure modes to avoid.** (a) `criteria_driven_propose_approve` edits too conservatively (avg sentence_verbatim_ratio 0.951 → mean Elo 1139) — the mirror-approver bias-mitigation is dropping too many useful edits, leaving variants nearly identical to parents. (b) `lexical_simplify` rewrites wholesale but with low quality (avg ratio 0.023 → mean Elo 1104). Both are net-negative producers and should be turned off for this prompt.
5. **Cheap models suffice.** Every top variant came from `gemini-2.5-flash-lite`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gpt-oss-20b`, or `deepseek-chat` — never from `gpt-4o` or `claude-sonnet-4`. The constant is `qwen-2.5-7b-instruct` as judge. The judge is the bottleneck, not the generator.
6. **Budget at $0.05 is sufficient.** Top-50-producing runs averaged $0.038 actual spend. Strategies that ran at $0.50 budget (`Tactic baselining` and `Tactic baselining - Gemini`) did NOT outperform the $0.05 strategies. More budget per run did NOT buy more top variants.
7. **Reflection is essentially absent from the top.** Only 2 of the top-50-producing runs had any `reflection_cost`. Either reflection isn't being used by the top strategies or it isn't helping when it is.
8. **`paragraph_recombine` is bimodal.** Among federal_reserve_2 variants, paragraph_recombine has avg sentence_verbatim_ratio 0.502 — the most balanced preservation/transformation. Hits avg Elo 1250 (4th-highest by agent type) with one winner at 1403. But strategy-level `eloAttrDelta:paragraph_recombine:paragraph_recombine` is −2.8 (Ligther strategy 2) — parent-delta is slightly negative on average. So it produces high-absolute-Elo variants when the parent was already strong, but doesn't reliably *improve* over a strong parent.
9. **Debate has the highest win rate at +43 Δ-Elo.** `debate_synthesis` win_rate 0.316 globally (and across federal_reserve_2 it produces 19 variants with avg Elo 1243). When debate fires, its produced variant is the run winner ~32% of the time — far higher than any other agent. Yet debate doesn't appear in the top 10 producers by absolute Elo; it produces consistently good but not breakthrough variants.
10. **Custom judge rubric is in use on one top-producing strategy.** "Sequential paragraph rewrite initial" sets `judgeRubricId: f3c1af7a-6829-4445-9b89-5935155f4718`. This is the only top-5 strategy using a custom rubric — every other one uses the default holistic judge. The strategy still produces top-2-arena variants, so the rubric does not seem to be a blocker.
11. **`generationTemperature: 1.0` is universal among top producers.** Every one of the top 5 strategies uses `generationTemperature: 1` (the default). No top strategy currently tunes temperature.
12. **`maxComparisonsPerVariant` is tight (2–3) in top strategies.** All five top strategies set `maxComparisonsPerVariant: 2` or `3` — much lower than the 15 default. This concentrates comparison budget on more variants and is probably an optimization for the $0.05 budget envelope.

## Efficiency: Most $-Efficient Way to Generate Very-High-Elo Variants

> **Why this section exists.** The "avg_elo by agent" view in Finding 2 above is misleading because it gives credit to variants whose high Elo was *inherited* from a strong parent rather than *produced* by the agent. To answer "what is the most efficient way to generate very high Elo," we have to (a) only count variants that actually improved on their parent (`child_elo > parent_elo`), and (b) normalize by the dollar cost of the invocation that produced them.

### Methodology

For every federal_reserve_2 article variant with a real pipeline parent (`generation > 0`, `parent_variant_ids` non-empty, `agent_invocation_id` populated), join to `evolution_variants` for parent Elo and to `evolution_agent_invocations` for `cost_usd`. Compute:

- **Δ-Elo** = `child.elo_score - parent.elo_score`
- **Improver rate** = fraction of variants where Δ > 0
- **Avg Δ on improvers** = mean Δ among the variants that did improve (failures don't get credit)
- **Lift per $** = `Σ max(Δ, 0) / Σ invocation_cost` — total positive Elo lift the agent produced per dollar
- **True top-10% wins per $** = number of variants that landed in the arena's top decile AND improved on their parent, divided by total invocation cost. This is the strictest "very high Elo, paid for by genuine improvement" metric.

`paragraph_recombine` invocations cost ~$0.010 each (full agent, multi-slot) vs `generate`-style agents at ~$0.0015 — so the per-dollar columns penalize expensive agents accordingly.

### Δ-Elo over parent (improvement-only) — top of table

| Agent | n | improver % | avg Δ | avg Δ on improvers | max Δ |
|---|---:|---:|---:|---:|---:|
| structural_transform | 514 | 90.9% | **+101.7** | +119.5 | +311.6 |
| grounding_enhance | 404 | 93.6% | **+100.8** | +110.9 | +299.2 |
| expansion_elaborate | 8 | 100.0% | +92.4 | +92.4 | +244.0 |
| precision_tighten | 4 | 100.0% | +60.3 | +60.3 | +100.1 |
| narrative_weave | 13 | 76.9% | +58.2 | +89.9 | +285.5 |
| counterpoint_integrate | 7 | 57.1% | +37.9 | +121.3 | +161.5 |
| argument_fortify | 7 | 57.1% | +25.0 | +99.2 | +193.0 |
| practitioner_orient | 6 | 66.7% | +24.8 | +63.2 | +95.1 |
| pedagogy_scaffold | 7 | 71.4% | +21.3 | +87.6 | +147.2 |
| historical_context | 14 | 50.0% | +20.7 | +99.5 | +243.1 |
| engagement_amplify | 45 | 64.4% | +19.6 | +64.1 | +284.2 |
| style_polish | 5 | 40.0% | +14.6 | +96.1 | +119.6 |
| zoom_lens | 17 | 52.9% | +13.2 | +77.5 | +245.4 |

### Δ-Elo over parent — bottom of table (net-negative producers)

| Agent | n | improver % | avg Δ | max Δ | notes |
|---|---:|---:|---:|---:|---|
| criteria_driven_propose_approve | 75 | 45.3% | +4.0 | +80.6 | barely positive |
| criteria_driven_single_pass | 122 | 41.8% | **−5.8** | +166.1 | net-negative |
| paragraph_recombine | 76 | 30.3% | **−20.3** | +160.5 | net-negative; 5× cost/call |
| debate_synthesis | 19 | 31.6% | **−27.0** | +51.1 | net-negative |
| criteria_driven (legacy) | 372 | 18.5% | **−34.7** | +92.8 | very bad — should retire |
| coherence_thread | 7 | 0.0% | **−46.6** | −1.8 | never improved |
| iterative_editing | 14 | 28.6% | **−58.6** | +14.7 | net-negative on parent! |
| iterative_editing_rewrite | 18 | 11.1% | **−75.4** | +30.7 | worst — destroys Elo on average |

> **Major correction to the earlier `avg_elo` view.** `iterative_editing` and `iterative_editing_rewrite` looked like the highest per-variant producers (1328 / 1312 avg Elo) but that was *parent inheritance*. When measured properly, both are net-negative — `iterative_editing_rewrite` only improves on its parent 11% of the time and averages −75 Elo. Their high absolute Elo comes from starting with already-evolved parents and dragging them down slightly. They do not produce high-Elo variants efficiently.

### Cost efficiency — true top-10% wins per dollar (strictest metric)

Top-decile cutoff for federal_reserve_2 is **Elo ≥ 1287**. A "true top-10% win" = child Elo above 1287 AND child Elo > parent Elo. Per-dollar of `evolution_agent_invocations.cost_usd`:

| Agent | attempts | true top-10% wins | true-top10 rate | total cost | **wins per $1** |
|---|---:|---:|---:|---:|---:|
| **expansion_elaborate** | 8 | 4 | 50.0% | $0.0135 | **297.2** |
| debate_synthesis | 19 | 5 | 26.3% | $0.0335 | 149.2 |
| engagement_amplify | 45 | 12 | 26.7% | $0.0982 | 122.2 |
| iterative_editing | 14 | 4 | 28.6% | $0.0354 | 113.1 |
| narrative_weave | 13 | 2 | 15.4% | $0.0194 | 103.1 |
| historical_context | 14 | 3 | 21.4% | $0.0307 | 97.9 |
| argument_fortify | 7 | 1 | 14.3% | $0.0104 | 96.3 |
| **structural_transform** | 510 | 73 | 14.3% | $0.8171 | **89.3** |
| counterpoint_integrate | 7 | 1 | 14.3% | $0.0127 | 79.0 |
| expert_deepdive | 16 | 2 | 12.5% | $0.0265 | 75.6 |
| iterative_editing_rewrite | 18 | 2 | 11.1% | $0.0268 | 74.7 |
| zoom_lens | 17 | 2 | 11.8% | $0.0280 | 71.5 |
| **grounding_enhance** | 400 | 36 | 9.0% | $0.6870 | **52.4** |
| criteria_driven_single_pass | 122 | 13 | 10.7% | $0.3288 | 39.5 |
| analogy_bridge | 37 | 2 | 5.4% | $0.0814 | 24.6 |
| criteria_driven (legacy) | 372 | 11 | 3.0% | $0.6801 | 16.2 |
| paragraph_recombine | 76 | 7 | 9.2% | $0.7759 | **9.0** ← worst-in-top-10 |
| criteria_driven_propose_approve | 75 | 1 | 1.3% | $0.2505 | 4.0 |
| **Zero true-top10 wins** | | | | | |
| progressive_disclosure, sensory_concretize, compression_distill, style_polish, tone_transform, first_principles, coherence_thread | varies | 0 | 0.0% | — | **0** |

### Findings

13. **Expansion_elaborate, debate_synthesis, and engagement_amplify are the three most cost-efficient ways to put a variant in the very top of the arena.** They produce 100–300 true top-10% wins per dollar of invocation cost, with conversion rates of 27–50%. Their absolute volume is small (8, 19, 45 attempts) — they have headroom: dispatching more invocations should produce more top-arena variants linearly.
14. **Iterative_editing has a paradoxical efficiency profile.** Net-negative avg Δ (−58.6) but 29% true-top10 rate when it *does* improve, and 113 wins/$. The high rate happens because its parents are already top-quartile — when it lifts even slightly above parent, the result is automatically top-10%. Use it ONLY as a polish stage on already-top-tier parents; never as the first or second iteration on a fresh seed.
15. **Paragraph_recombine is the least efficient way to produce top-arena variants.** Net-negative avg Δ (−20.3), 9.2% true-top10 rate, and ~5× the per-invocation cost. It delivers **9 true top-10% wins per dollar** — worst among agents that produce any top-10 wins at all. The Sequential Context-Aware Generation feature added cost and didn't move the needle on this prompt's leaderboard.
16. **Structural_transform and grounding_enhance are the volume workhorses.** They each have ~90% improver rates and +100 avg Δ from parent. Per-dollar they deliver 89 and 52 top-10% wins respectively. Their lower wins-per-dollar than expansion_elaborate is partly volume saturation (517 + 400 attempts on a 2,388-variant arena means many of their improvements are stacking on already-high parents). For new prompts they are the cost-efficient starting point.
17. **Seven tactics have produced ZERO true-top-10% wins.** `progressive_disclosure`, `sensory_concretize`, `compression_distill`, `style_polish`, `tone_transform`, `first_principles`, `coherence_thread`. Either their sample sizes are too small (≤16 each) or these tactics are wrong for federal_reserve_2. They consumed compute and produced nothing in the top decile.
18. **`criteria_driven_propose_approve` is the worst-value agent that's run at scale.** 75 attempts, 1 true top-10% win, 1.3% rate, **4 wins per dollar** — 25× worse than expansion_elaborate. The mirror-approver bias-mitigation drops too many edits; the resulting variants barely change from their parents and rarely break into the top decile. Strong candidate to disable for this prompt.
19. **The legacy `criteria_driven` tactic is similarly low-yield**: 372 attempts, 11 true-top10 wins, 16 wins per dollar. ~5× worse than the per-dollar leader; should be retired in favor of `criteria_driven_single_pass` (which at 39.5 wins/$ is itself middling).
20. **Improver-rate × volume × cost framing changes the strategic picture.** Earlier I named "Iterative editing - markup" and "Iterative editing - whole article" as top-producing strategies — but their winning variants got there by inheriting a strong parent, not by the editing step improving it. The strategies actually pushing variants up cheaply are **"Sequential iteration 2"** (cheap deep iteration via cheap generate-pool tactics with rich tactic guidance) and **"Tactic baselining"** / **"Tactic baselining - Gemini"** (1-iteration with big budget per-tactic exploration). The wholesale-rewrite tactics they spawn (`structural_transform`, `grounding_enhance`, `engagement_amplify`, `expansion_elaborate`) are the real efficient producers.

### Implications for Strategy Design

The efficient recipe for "generate very high Elo variants cheaply" given this data:

1. **Stack the deck with high-improver-rate, low-cost tactics**: `structural_transform`, `grounding_enhance`, `expansion_elaborate`, `engagement_amplify`, `narrative_weave`. Set `generationGuidance` to weight these heavily and starve the zero-win tactics (`progressive_disclosure`, `coherence_thread`, `tone_transform`, `first_principles`).
2. **Use `iterative_editing` only as a final polish step on top-3 pool variants** — never on the seed and never as the only late-stage iteration. Its net-negative average means using it earlier removes Elo on average.
3. **Disable `paragraph_recombine`, `criteria_driven_propose_approve`, and legacy `criteria_driven`** for this prompt (and probably similar arena-mature prompts) — they consume budget for negligible top-10% yield.
4. **Prefer many cheap generate iterations over fewer expensive recombine iterations.** $0.05 spent on 30 `structural_transform`/`grounding_enhance` invocations produces ~3 true top-10% wins on average; the same $0.05 on a single `paragraph_recombine` invocation produces ~0.46 expected top-10% wins.
5. **The volume model + cheap-judge sufficiency confirms**: throw more attempts at cheap-but-high-improver-rate tactics; let the judge's variance do the selection. This is the "lottery ticket" thesis, and the data supports it — even the top variant in the arena (Elo 1431) is a single deep-iteration sample.

### Strong-parent analysis (parent Elo > 1350)

> Even if an agent reliably lifts the average parent (which most don't), the strategic question for top-of-arena is whether it can push an already-strong parent further. Filtering children to those whose parent has Elo > 1350 (n=53 such parents exist in the arena; n=64 child-invocations have been run against them) is the hardest test.

**Per-agent improvement on parents with Elo > 1350**:

| Agent | n | improvers | improver % | avg Δ | avg Δ when improving | max Δ | avg parent Elo | improvers / $1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| paragraph_recombine | 8 | 1 | 12.5% | −54.0 | +4.5 | +4.5 | 1379.5 | 11.8 |
| **iterative_editing** | **14** | **4** | **28.6%** | −58.6 | +7.0 | +14.7 | 1386.8 | **113.1** |
| engagement_amplify | 3 | 1 | 33.3% | −64.8 | **+41.9** | **+41.9** | 1382.5 | **213.4** |
| coherence_thread | 1 | 0 | 0% | −72.7 | — | — | 1431.0 | 0 |
| iterative_editing_rewrite | 18 | 2 | 11.1% | −75.4 | +15.7 | +30.7 | 1387.7 | 74.7 |
| criteria_driven_single_pass | 5 | 1 | 20.0% | −85.7 | +4.2 | +4.2 | 1369.0 | 74.6 |
| grounding_enhance | 1 | 0 | 0% | −89.9 | — | — | 1388.5 | 0 |
| historical_context | 1 | 0 | 0% | −105.3 | — | — | 1358.3 | 0 |
| structural_transform | 5 | 0 | 0% | −139.0 | — | — | 1383.7 | 0 |
| contrast_frame | 1 | 0 | 0% | −156.6 | — | — | 1358.3 | 0 |
| zoom_lens | 1 | 0 | 0% | −231.5 | — | — | 1431.0 | 0 |
| first_principles | 1 | 0 | 0% | −252.3 | — | — | 1400.2 | 0 |
| lexical_simplify | 5 | 0 | 0% | −253.0 | — | — | 1379.6 | 0 |

**Broader cross-check at parent Elo > 1300** (n ≥ 3 samples only, for stability):

| Agent | n | improvers | improver % | avg Δ | avg Δ improvers | max Δ | improvers / $1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| analogy_bridge | 6 | 0 | 0% | −36.5 | — | −3.5 | 0 |
| **engagement_amplify** | **8** | **4** | **50.0%** | −40.7 | **+21.6** | **+41.9** | **206.2** |
| **iterative_editing** | 14 | 4 | 28.6% | −58.6 | +7.0 | +14.7 | **113.1** |
| grounding_enhance | 5 | 1 | 20.0% | −60.4 | +2.1 | +2.1 | 78.5 |
| criteria_driven_single_pass | 17 | 2 | 11.8% | −61.9 | +3.2 | +4.2 | 44.6 |
| paragraph_recombine | 24 | 3 | 12.5% | −63.1 | +17.3 | +43.6 | 12.4 |
| historical_context | 5 | 0 | 0% | −64.3 | — | −32.2 | 0 |
| iterative_editing_rewrite | 18 | 2 | 11.1% | −75.4 | +15.7 | +30.7 | 74.7 |
| criteria_driven (legacy) | 25 | 0 | 0% | −101.5 | — | −2.3 | 0 |
| structural_transform | 18 | 0 | 0% | −129.9 | — | −27.8 | 0 |
| lexical_simplify | 17 | 0 | 0% | −176.5 | — | −59.5 | 0 |

**All 9 actual improvements on parents > 1350 Elo** (exhaustive list — the entire population of successes):

| Δ | Agent | child Elo | parent Elo | cost | strategy |
|---:|---|---:|---:|---:|---|
| **+41.9** | engagement_amplify | 1400.2 | 1358.3 | $0.0015 | Sequential iteration 2 (gen 12) |
| +30.7 | iterative_editing_rewrite | 1389.2 | 1358.5 | $0.0024 | Iterative editing - whole article |
| +14.7 | iterative_editing | 1388.8 | 1374.1 | $0.0026 | Iterative editing - markup |
| +8.0 | iterative_editing | 1392.1 | 1384.1 | $0.0021 | Iterative editing - markup |
| +5.1 | iterative_editing | 1389.2 | 1384.1 | $0.0022 | Iterative editing - markup |
| +4.5 | paragraph_recombine | 1403.2 | 1398.6 | $0.0049 | Ligther strategy 2 |
| +4.2 | criteria_driven_single_pass | 1358.5 | 1354.3 | $0.0032 | Criteria one pass |
| +0.7 | iterative_editing_rewrite | 1390.7 | 1390.1 | $0.0005 | Iterative editing - whole article |
| +0.2 | iterative_editing | 1390.2 | 1390.1 | $0.0020 | Iterative editing - markup |

### Findings (strong-parent regime)

> **Framing note.** All percentages below are **per-agent attempt-success rates** (= the agent's own improvers ÷ its own attempts), NOT shares of total improvers across all agents. So "28.6% improver rate" means *this agent succeeded on 28.6% of its own attempts against a parent > 1350*.

21. **`engagement_amplify` has the highest attempt-success rate at parent > 1300.** 4 of its **own** 8 attempts improved on parent = **50.0% success rate**, with avg +21.6 Δ on the wins and a max of +41.9 (the largest improvement on a strong parent in the entire arena). At parent > 1350 it's 1 of 3 attempts (33.3%) — same single +41.9 win. Per-dollar: **206 improvers per $1** — the per-dollar leader. Sample is thin but the signal is unambiguous: this tactic, dispatched repeatedly against top-tier pool variants, should be the highest-leverage move.
22. **`iterative_editing` has the most-replicated success on parent > 1350.** 4 of its **own** 14 attempts improved on parent = **28.6% success rate**, all 4 from the "Iterative editing - markup" strategy. Improvements are small (mean +7) but real and replicable. Per-dollar: **113 improvers per $1**. Use it as the polish stage on already-strong parents.
23. **The volume workhorses collapse on strong parents.** `structural_transform` had +101.7 avg Δ overall and 90.9% attempt-success rate against weak parents — but at parent > 1300 its attempt-success rate is **0% (0 of 18 attempts) with avg −130 Δ**. `grounding_enhance` falls from 93.6% → **20% (1 of 5)** with avg −60 Δ. These are regression-to-mean tactics: wholesale rewrites from a weak baseline succeed; wholesale rewrites from a strong parent destroy hard-won quality. Strategic implication: **gate these tactics to `sourceMode: 'seed'` only**, never let them touch a top-quartile pool variant.
24. **`paragraph_recombine` has a low attempt-success rate on strong parents.** Improves on parent in **12.5% of attempts** at both parent>1300 (3 of 24) and parent>1350 (1 of 8). The wins are decent in size (max +43.6) but per-dollar it's the worst of the relevant agents (**12.4 improvers/$1**) because each invocation costs ~5× a generate call. Sequential Context-Aware mode (debug_performance_paragraph_recombine_20260612) hasn't moved the strong-parent attempt-success rate — the lone strong-parent improver came from `Ligther strategy 2` (non-sequential).
25. **Several tactics have 0% attempt-success rate on strong parents.** At parent > 1300 with n ≥ 3: `analogy_bridge` (0 of 6), `historical_context` (0 of 5), `criteria_driven` (legacy) (0 of 25), `structural_transform` (0 of 18), `lexical_simplify` (0 of 17). Their attempt-success rate at this regime is exactly 0. They should NOT be dispatched against high-Elo pool parents.
26. **`iterative_editing_rewrite` attempt-success rate is roughly half of `iterative_editing`.** 2 of its 18 attempts improved (11.1%) vs 4 of 14 (28.6%) for `iterative_editing`. The 'rewrite' variant rebuilds more aggressively; the 'markup' variant edits surgically. Markup is the better polish tool for strong parents.
27. **`criteria_driven_single_pass` has a 20% attempt-success rate at parent > 1350 but the gain is trivial.** 1 of 5 attempts improved, by +4.2 Δ. Avg Δ across all attempts is −85.7. This is the same conservative-edit pattern visible globally (sentence_verbatim_ratio 0.766) — it preserves too much to meaningfully improve top variants. Not useful here.
28. **The improvement budget on strong parents is small.** Looking at the 9 actual successes, mean lift is +12 Δ (median +5). Even the biggest jump (+42) is shy of what's seen on weak parents (+311 max for structural_transform from baseline). Strong-parent improvements buy you 5–50 Elo, not 100+. Plan strategy budgets accordingly: don't expect a single iteration on a strong parent to produce a breakthrough; expect a polish.
29. **The "Sequential iteration 2" strategy is doubly validated.** It produced both the #1 arena winner (zoom_lens Elo 1431, gen 7) AND the largest improvement on a strong parent (engagement_amplify +41.9 at gen 12). Its 14-iteration deep recipe with broad tactic guidance + top-N pool selection is the only strategy demonstrating sustained gain at the top of the arena.
30. **Sample sparsity is itself a finding.** Only 64 total invocations against parents > 1350 Elo exist in the entire history of this prompt. The system has barely tested its agents against strong parents. Most of the agent population was dispatched against weak (baseline-ish) parents. To learn more about the strong-parent regime, the system needs to *deliberately dispatch* more invocations with pool-sourceMode + tight cutoffs (topN=1 or 2) — currently pool-mode topN defaults to 3–5 which dilutes the strong-parent sample.

### Strategic implications (refined)

The "produce very high Elo" question now splits into two regimes:

1. **Cold-start regime (parent ≤ 1300 Elo)**: maximize attempts at high-improver-rate cheap tactics — `structural_transform`, `grounding_enhance`, `expansion_elaborate`, `engagement_amplify`. Their wholesale rewrites efficiently lift weak parents.
2. **Hot-finish regime (parent > 1300 Elo)**: dispatch primarily `engagement_amplify` (highest per-dollar improver) and `iterative_editing` (highest improver count) against top-pool variants. Disable wholesale-rewrite tactics in the late stages of a strategy — they actively destroy quality.

This implies an explicit **two-stage strategy template** is the efficient frontier:

- **Stage 1** (40-60% budget, seed mode): high-volume cheap generate iterations with broad tactic guidance (favoring `structural_transform`, `grounding_enhance`, `expansion_elaborate`, `engagement_amplify`) to build a top-tier pool.
- **Stage 2** (40-60% budget, pool mode with `qualityCutoff: {topN: 1-2}`): `iterative_editing` and `engagement_amplify` only — polish the top pool variants. Block other tactics here.

Current top strategies approximate this but don't enforce it. "Sequential iteration 2" uses uniform tactic guidance for all 14 iterations and gets lucky when the late iterations happen to dispatch `engagement_amplify` or `zoom_lens`. Skewing the late-iteration guidance toward proven strong-parent improvers should compound the strategy's edge.

### Rewrite efficacy decay — all-rewrites pooled, 50-Elo parent buckets

Across all federal_reserve_2 article rewrites with a pipeline parent (n = 2,323 attempts pooled, agent-agnostic):

| Parent Elo | n | improver % | mean Δ | median Δ | mean Δ when ↑ | mean Δ when ↓ | min / max Δ |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1050–1100 | 3 | 100.0% | +136.6 | +165.4 | +136.6 | — | +1.2 / +243.1 |
| 1100–1150 | 1,433 | **78.1%** | **+73.6** | **+69.1** | +100.9 | −23.7 | −68.6 / +311.6 |
| 1150–1200 | 54 | 51.9% | +6.6 | +1.0 | +39.2 | −28.4 | −109.9 / +111.7 |
| 1200–1250 | 186 | 44.1% | −4.2 | −2.1 | +36.9 | −36.7 | −162.7 / +115.6 |
| 1250–1300 | 475 | 16.8% | −39.3 | −41.5 | +21.9 | −51.7 | −214.7 / +113.6 |
| 1300–1350 | 108 | 7.4% | −86.7 | −91.4 | +27.0 | −95.8 | −261.8 / +119.5 |
| 1350–1400 | 53 | **17.0%** | −85.3 | −90.2 | +12.2 | −105.3 | −296.4 / +41.9 |
| 1400–1450 | 11 | **0.0%** | −143.5 | −144.9 | — | −143.5 | −252.3 / −58.0 |

### Findings (decay curve)

31. **The system has a clean phase transition between parent Elo 1150 and 1250.** Below 1200, rewrites are net positive (mean Δ +73.6 at 1100–1150, +6.6 at 1150–1200). At 1200+, mean Δ goes negative. The crossover happens between the 1150–1200 bucket (median +1.0, mean +6.6) and the 1200–1250 bucket (median −2.1, mean −4.2). **Elo 1200 is the rewrite-efficacy threshold** — past it, the average attempt destroys quality.
32. **The improver rate decays from 78% → 7% across the 1100→1350 parent range.** Within a single dataset: 78.1% (1100–1150) → 51.9% → 44.1% → 16.8% → 7.4% → bottom at 1300–1350. The drop from 44% to 17% (between buckets 1200–1250 and 1250–1300) is the steepest single cliff — that's where rewrites start losing more often than winning. Past 1400 it's 0% in this sample (n=11).
33. **Losses on strong parents are bigger than gains.** Avg Δ when going up shrinks: +100.9 (weak) → +36.9 (mid) → +27.0 (strong) → +12.2 (very strong). Avg Δ when going down grows: −23.7 (weak) → −51.7 (mid) → −95.8 (strong) → −143.5 (very strong). **The downside scales ~6× across the range; the upside shrinks by ~8×.** Combined: expected value per attempt collapses as parent strengthens.
34. **The 1100–1150 bucket dominates the dataset (1,433 of 2,323 = 62%).** This is because the canonical baseline sits at Elo 1104.6, and most pipeline rewrites are direct children of it. The system has effectively measured rewrite efficacy against the baseline thousands of times; against parents > 1300 it has only measured 172 attempts total. **The strong-parent dataset is undersampled by 8×** relative to where the system spends most of its compute.
35. **The 1350–1400 bucket is mildly better than the 1300–1350 bucket** (17.0% vs 7.4% improver). This isn't because the rewrites are easier on a stronger parent — they aren't, the magnitudes are worse (mean Δ when down −105 vs −96). It's because **the 1300–1350 bucket includes many regression-prone tactics** (the volume workhorses occasionally land here when pool topN=5 selects further down) while the 1350+ bucket is dominated by polish-oriented agents (`iterative_editing`, `iterative_editing_rewrite`) that at least *try* the right pattern. This confirms the prior finding that **the agent-selection mix matters more than the parent Elo** at the top of the curve — gate the right agents to the right parent range and the 7% floor lifts to 17–28%.
36. **The 1400–1450 bucket is the absolute ceiling for federal_reserve_2.** 11 attempts, 0 improvers, mean Δ −143.5. No agent has ever lifted a parent above Elo 1400 on this prompt. The current arena ceiling (1431) is therefore not a "next iteration breaks the record" boundary — it's a wall the system hasn't pushed past despite 11 dedicated attempts. To break it would require either (a) deliberately dispatching the proven strong-parent improvers (`engagement_amplify`, `iterative_editing`) at this regime, or (b) a new agent / judge / criteria configuration the system hasn't tried.

### Caveats

- **Sample sizes at parent > 1350 are small (n=64 total).** The 5-attempt-or-fewer rows in the table should be treated as anecdotal. The 113/$ for iterative_editing and the +41.9 for engagement_amplify rest on robust replication (4 improvers, 3 strategies) and a single dramatic improvement respectively.
- **Cost is invocation-cost only.** I did not include the ranking-call cost spent comparing the new variant against the pool. Including ranking cost would shift the picture against agents that trigger many comparisons (`paragraph_recombine` in particular).
- **The 1Δ ≥ 1 cutoff for "improver" is generous.** Even a +1 Elo bump counts as improvement. A stricter threshold (e.g., Δ ≥ 30, the rough noise floor at high uncertainty) would shrink the improver counts for the marginal tactics but wouldn't change the ranking of the top efficient producers.
- **Top-of-decile cutoff is computed once over the whole arena**, not per-strategy. A strategy that didn't run early in the arena's life gets penalized vs older strategies whose variants helped define the cutoff. Re-running with a more recent time window would test this.
- **`criteria_driven_propose_approve` data is small (75 variants on this prompt).** The 1.3% top-10 rate could be sampling noise — but it's directionally aligned with the global tactic leaderboard's "0.951 sentence verbatim ratio → 1138 avg Elo" pattern, so the underperformance is real.
- **`expansion_elaborate` has only 8 samples.** It's the apparent per-dollar leader but with wide uncertainty; a follow-up should run ≥30 invocations of this tactic specifically to validate.

## Open Questions

- **Q1.** What does the lineage chain look like for "Sequential iteration 2" run `e6ed1cbb` from gen 0 → gen 7 in detail? The intermediate iterations (gen 2–6) presumably introduced the parents that the gen-7 zoom_lens won from — are any of those also still in the top arena? (Variant `4bdf2615-8c35-49d4-bf19-17261e65abc2` `coherence_thread` gen 8 from the same run was in the top 30 at Elo 1358; that's one direct descendant.) Worth pulling the run's full variant list and looking at the intra-run Elo trajectory.
- **Q2.** Does "Sequential iteration 2" reliably produce a top-of-arena winner, or was the Elo 1431 result a single lucky run? The run_summary lacks `iterationResults` (null) but variant_count and cost are queryable. How many distinct runs of this strategy exist? Spot-checking would tell us repeatability.
- **Q3.** Why does `criteria_driven_propose_approve` underperform so badly? Is it dropping too many edits at the mirror-approver stage, or are the edits it does keep low-quality? Worth pulling `execution_detail.cycles[0]` for a sample of propose/approve invocations on federal_reserve_2 to look at `appliedGroups / approverGroups` (the `invocation_mirror_agreement_rate`).
- **Q4.** What custom rubric is being used by `Sequential paragraph rewrite initial`? Is it driving the win, or are the wins coming despite the rubric? Querying `evolution_judge_rubrics` and `evolution_judge_rubric_dimensions` for `f3c1af7a-6829-4445-9b89-5935155f4718` would clarify.
- **Q5.** What is the eloPer$ champion at the strategy level? My summary computed cost-per-run averages but not (top-Elo lift / cost) per strategy. The "Tactic baselining" run at $0.50 budget produced a 1390 variant with `narrative_weave` — much higher cost per top-variant than the $0.05 strategies.
- **Q6.** Is the judge (qwen-2.5-7b-instruct) preferring `structural_transform` because of stylistic affinity (long, restructured articles) rather than substantive quality? Without varying the judge it's impossible to tell whether the dominance is real quality or judge bias. The Judge Lab could quantify this.
- **Q7.** Is there a "Sequential iteration 2"-style 14-iteration strategy with `iterative_editing` (instead of generate-pool) iterations? That would test whether deep iteration of the *best* per-hop agent dominates the current best.

## Data sources (to be queried during /research)

- `npm run query:staging` / `query:prod` against:
  - `evolution_prompts WHERE name ILIKE '%federal%reserve%2%'` — identify the prompt UUID.
  - `evolution_variants WHERE prompt_id=<fr2> AND synced_to_arena=true AND archived_at IS NULL ORDER BY elo_score DESC LIMIT 50` — top-of-arena cohort.
  - `evolution_arena_comparisons WHERE prompt_id=<fr2>` — head-to-head match history of top variants.
  - `evolution_metrics WHERE entity_id IN (<strategies of top variants>) AND metric_name LIKE 'eloAttrDelta:%'` — per-(agent, tactic) attribution deltas at strategy level.
  - `evolution_metrics WHERE entity_type='tactic' AND metric_name IN ('avg_elo', 'avg_elo_delta', 'win_rate')` — global tactic leaderboard for context.
  - `evolution_agent_invocations` joined to top variants via `agent_invocation_id` — agent + tactic + execution_detail for each top winner.
  - `get_variant_full_chain(<top_variant_id>)` — full lineage walk.
  - `evolution_runs` joined to top variants — strategy_id, budget_cap_usd, run_summary (iterationConfigs + stopReason).

## Investigation lenses

1. **Agent-level**: Which agent types dominate the top-N? Generate vs reflect vs criteria vs debate vs paragraph_recombine vs iterative_editing.
2. **Tactic-level**: Within `generate`/`reflect_and_generate`, which of the 24 tactics produced top variants? Cross-reference `evolution_tactics` leaderboard.
3. **Model-level**: Generation model + judge model pairings. Cheap+strong vs strong+strong vs strong+strong with reasoning.
4. **Iteration-shape level**: How many generate iterations? When do swiss rounds appear? Pool sourceMode + qualityCutoff used?
5. **Lineage depth**: Are top variants single-step children of the seed, or descendants several iterations deep?
6. **Cost-efficiency**: eloPer$ — does the top of arena cost dramatically more than mid-tier?
7. **Criteria-driven hypothesis (H1 vs H2)**: Do single-pass guardrails (`single_pass_evaluate_criteria_and_generate`) or propose/approve architecture (`proposer_approver_criteria_generate`) reach the top, or do legacy single-call agents still win?
8. **Sentence verbatim ratio**: Are top variants surgical edits (high ratio, well-preserved structure) or wholesale rewrites (low ratio, novel structure)?
9. **Debate winners**: Did `debate_and_generate` ever surface a top variant? With which judge model + reasoning effort?
10. **Paragraph recombine**: Does the sequential context-aware path lift recombined-article Elo above parent at scale on this prompt?

## Cross-references for tracked literature

- Existing analyses in `docs/analysis/` that may bear on this question (judge agreement, judging accuracy, cost estimation accuracy) — to be enumerated.
- Recent planning docs that touched federal_reserve_2 specifically — to be greppped under `docs/planning/`.

## Promoted Analyses

- docs/analysis/rewrite-efficacy-decay-federal-reserve-2-20260617/ — Δ-Elo decay curve across 50-Elo parent buckets; findings 31–36 promoted to the formal report.
- docs/analysis/arena-elo-distribution-federal-reserve-2-20260617/ — static Elo distribution (standard percentiles + 20-ventile breakdown) of the active arena leaderboard; cross-references the decay-curve crossover at Elo 1200 and translates `qualityCutoff: topN` into concrete Elo thresholds.
- docs/analysis/rewrite-success-by-top-tier-federal-reserve-2-20260618/ — per-agent attempt-success rate against parents in the top 10 % (Elo ≥ 1287) and top 5 % (Elo ≥ 1319). At top-5 % only `engagement_amplify` (50 %) and `iterative_editing` (29 %) sustain meaningful improver rates; everything else ≤ 12.5 % or zero.
- docs/analysis/cost-to-reach-p90-from-seed-federal-reserve-2-20260618/ — geometric-cost calculation for producing one p90 variant from the canonical seed (Elo 1104.6, NOT the default 1200). Empirical answer: 75 % confidence in ~$0.031 (18 invocations); cheapest deliberate path is `structural_transform`-only at $0.015 (9 invocations).
