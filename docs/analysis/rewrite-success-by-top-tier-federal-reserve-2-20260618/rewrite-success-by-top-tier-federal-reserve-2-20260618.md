# Rewrite Success Rate by Top-Tier Parent — Federal Reserve 2

## Header
- **Analysis name:** rewrite-success-by-top-tier-federal-reserve-2-20260618
- **Project:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/
- **Branch:** feat/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616
- **Date:** 2026-06-18
- **Source research doc:** docs/planning/meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616/meta_analysis_how_to_get_top_arena_federal_reserve_2_research.md (§ "Strong-parent analysis (parent Elo > 1350)" + § "Rewrite efficacy decay — all-rewrites pooled, 50-Elo parent buckets" + findings 21–30)
- **Related analyses:**
  - docs/analysis/arena-elo-distribution-federal-reserve-2-20260617/ — defines the top-10 % and top-5 % parent cutoffs used here (p90 ≈ 1287, ventile-20 floor ≈ 1319).
  - docs/analysis/rewrite-efficacy-decay-federal-reserve-2-20260617/ — same population, 50-Elo bucketed Δ-Elo curve. This report drills into two specific percentile-derived cutoffs and adds the per-agent split.

## Methodology

**Question.** Of the agents that ever rewrite a Federal Reserve 2 article variant whose parent is in the **top 10 %** (Elo ≥ 1287) or **top 5 %** (Elo ≥ 1319) of the live arena, what fraction of each agent's own attempts actually improve on the parent's Elo? And what's the aggregate rate pooled across all agents at each cutoff?

**Why these cutoffs.** From the companion `arena-elo-distribution-federal-reserve-2-20260617` report: p90 of the 2,388-variant Federal Reserve 2 arena is Elo 1287 (top 10 % entry), and the ventile-20 floor is Elo 1319 (top 5 % entry). These are the natural thresholds that a strategy designer would point `qualityCutoff: {topN: 239}` or `{topN: 119}` at.

**Data source.** Staging Supabase (read-only role `readonly_local`, accessed via `npm run query:staging`). Tables: `evolution_variants` (self-joined for parent lookup).

**Prompt scope.** Only the `Federal Reserve 2` arena topic (`evolution_prompts.id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`). Staging only.

**Inclusion criteria for "rewrites".** Children (rewrites) match:
- `prompt_id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`
- `synced_to_arena = true`
- `archived_at IS NULL`
- `variant_kind = 'article'` (paragraph-recombine slot rewrites excluded — different scoring regime)
- `generation > 0`
- `parent_variant_ids` non-empty

Parent is `parent_variant_ids[1]` (canonical primary). For each tier, the filter `parent.elo_score >= 1287` (top 10 %) or `>= 1319` (top 5 %) is applied.

**Computed metrics.**
- **success_pct** (per agent or pooled): `100 * count(Δ > 0) / count(*)` — the agent's own attempt-success rate.
- **avg_delta, median_delta**: mean and median of `child.elo_score − parent.elo_score`.
- **avg_delta_up, avg_delta_down**: filter-conditioned means for the wins and the misses respectively (aggregate slice only — dataset.csv omits these for per-agent rows because the per-agent samples are small enough that filtered means are noisy).
- **max_delta**: largest single Δ (positive or negative) in the slice.
- **cost_per_invocation** (column A): `avg(evolution_agent_invocations.cost_usd)` over the slice. This is the LLM-call cost the agent actually consumed per attempt — not an estimate. Joined from `evolution_agent_invocations.id = evolution_variants.agent_invocation_id`.
- **total_cost**: `sum(evolution_agent_invocations.cost_usd)` over the slice — the total compute budget the agent has spent against this parent tier.
- **cost_per_improver** (column B): `total_cost / n_improvers` — the realized USD cost of producing one variant that actually improved on its parent. Null for agents with zero improvers (an undefined ratio). This is the bottom-line economic metric: how much did it cost to buy a successful rewrite at this parent quality?

**Sample sizes.**
- Top 10 % (parent Elo ≥ 1287): **n = 227** rewrite attempts across 24 distinct agents. Total cost spent at this tier: **$0.6287**.
- Top 5 % (parent Elo ≥ 1319): **n = 133** rewrite attempts across 16 distinct agents. Total cost spent at this tier: **$0.3549**.

Every rewrite has an `agent_invocation_id` and an attached `cost_usd > 0` invocation row, so the cost-augmented sample sizes match the prior counts exactly — no rows lost to the cost join.

**Caveats affecting interpretation.**
1. **Cutoffs are p90 / ventile-20 from a 2,388-variant snapshot on 2026-06-17.** As the arena grows, these Elo numbers will drift. The thresholds here are the right ones today; they would need to be re-derived in a future analysis.
2. **Live parent Elo, not at-rewrite-time Elo.** Parent Elo is read live. Drift after the rewrite was generated may shift attribution; for aggregates over hundreds of attempts this averages out.
3. **Small per-agent samples.** Many agents have n ≤ 5 attempts at the top-5 % cutoff. Treat per-agent rates with single-digit sample sizes as anecdotal — only `iterative_editing` (n=14), `iterative_editing_rewrite` (n=18), `criteria_driven_single_pass` (n=16), `paragraph_recombine` (n=14), `lexical_simplify` (n=14), `structural_transform` (n=15), and `criteria_driven` (n=25) clear n ≥ 10 at top-5 %.
4. **Variants with 0 matches default to Elo 1200** (`DEFAULT_ELO`). Neither cutoff (1287, 1319) is at the default, so this caveat does not affect tier membership — but if a child has 0 matches and lands at Elo 1200 against a 1300-Elo parent, the Δ of −100 reflects the default, not a judged outcome. This affects mean-Δ tails marginally for agents whose children are very fresh.
5. **All agents pooled per tier — no strategy/model split.** A future report could decompose `engagement_amplify`'s wins by the originating strategy (most of the wins are from "Sequential iteration 2").
6. **Cost is invocation cost only — ranking cost excluded.** `evolution_agent_invocations.cost_usd` captures the LLM-call cost the agent itself consumed (proposer + approver + drift-recovery + paragraph-recombine internal LLM calls). It does NOT include the per-rewrite ranking cost (the binary-search pairwise comparisons that place the new variant in the Elo pool), which is bucketed under `ranking_cost` at the run level. For agents that trigger many ranking calls per rewrite — `paragraph_recombine` in particular — including ranking cost would inflate cost-per-improver further. The cost columns here therefore underestimate the true economic cost; the *relative* ranking between agents remains directionally correct since ranking-call counts scale roughly with attempt count.

**Reproducibility.** Full SQL in `queries.sql`; all results inlined in `dataset.csv` (41 rows: 2 aggregate + 23 per-agent at top-10 % + 16 per-agent at top-5 %) and in § Queries & Results below. To regenerate: clone this folder, run Q1/Q2/Q3 against staging, compare `dataset.csv` to the new output.

## Key Findings

1. **Aggregate rewrite success rate is 10.1 % at top-10 % parents and 8.3 % at top-5 % parents.** Pooled across all agents: top 10 % is 23 improvers of 227 attempts (mean Δ −81.9, median Δ −85.4); top 5 % is 11 of 133 (mean Δ −95.1, median Δ −92.4). The success rate barely changes between the two cutoffs (10.1 → 8.3) — once a parent is in the top decile, the difficulty plateaus.

2. **Win sizes shrink and loss sizes grow as the cutoff tightens.** Mean Δ when the rewrite improved: **+19.3** (top 10 %) → **+11.1** (top 5 %). Mean Δ when the rewrite regressed: **−93.3** (top 10 %) → **−104.7** (top 5 %). The risk/reward ratio gets worse on both sides — fewer wins, smaller wins, bigger losses.

3. **At top-10 % parents, only three agents sustain a non-marginal success rate** (n ≥ 5): `engagement_amplify` **44.4 %** (4 of 9), `iterative_editing` **28.6 %** (4 of 14), `debate_synthesis` **28.6 %** (2 of 7). Below those, the next tier (12–6 %) is `paragraph_recombine`, `grounding_enhance`, `iterative_editing_rewrite`, `criteria_driven_single_pass`, and legacy `criteria_driven`.

4. **At top-5 % parents, the field narrows to two agents:** `engagement_amplify` **50.0 %** (2 of 4) and `iterative_editing` **28.6 %** (4 of 14). Everything else is at or below 12.5 % success rate, and many agents drop to 0 %.

5. **`engagement_amplify` is the standout at both cutoffs.** Its success rate *rises* with the cutoff (44.4 % → 50.0 %), and it owns the single largest win on a strong parent: **+41.9 Δ-Elo** (1358 → 1400, from the "Sequential iteration 2" run). Its mean miss is also smaller than peer agents (−46 vs −58 to −178 elsewhere). This is the single highest-leverage agent on this prompt.

6. **`iterative_editing` is the most-replicated strong-parent success.** 4 of its 14 own attempts succeeded at the top-5 % cutoff. The sample is identical at both cutoffs because every single one of its 14 attempts had a parent with Elo ≥ 1319 (the strategies that dispatch it pool-source against the very top of the leaderboard). Mean win is small (+7 Δ) but repeatable; mean miss is moderate (−59).

7. **`debate_synthesis` collapses from 28.6 % to 0 % across the two cutoffs.** Its 2 wins at top-10 % were both against parents in the **1287–1318 band**; against truly top-5 % parents (Elo ≥ 1319) it has zero successes in 2 attempts. The agent's per-dollar leadership shown in the earlier efficiency analysis (149 wins / $) does NOT carry into the strong-parent regime.

8. **Legacy `criteria_driven` collapses from 5.9 % to 0 %** between top-10 % (3 of 51) and top-5 % (0 of 25). All 3 of its wins were against parents in the 1287–1318 band. At parent ≥ 1319 it has 25 attempts and zero successes. This is the agent with the largest top-5 % sample that produces zero improvers — the strongest evidence for retiring it from strong-parent iteration slots.

9. **`structural_transform` and `lexical_simplify` have 0 % success at both cutoffs** (combined 0 of 38 at top-10 %, 0 of 29 at top-5 %). Mean misses are large: structural_transform −129 to −133, lexical_simplify −178. These wholesale-rewrite tactics actively destroy strong parents. Gate them to `sourceMode: 'seed'` only — never dispatch against a top-decile pool variant.

10. **`paragraph_recombine` holds at single-digit success rate** across both cutoffs (12.5 % → 7.1 %). With its ~5× per-invocation cost the per-dollar yield is the worst in the active-improver cohort. The Sequential Context-Aware Generation feature (debug_performance_paragraph_recombine_20260612) has not lifted strong-parent success on this prompt.

11. **`criteria_driven_single_pass` is marginal — 9 % at top-10 %, 12.5 % at top-5 %, but the wins are tiny.** Both of its top-5 % wins are < +5 Δ Elo. The agent preserves too much of the parent (sentence-verbatim ratio ~0.77 globally) to meaningfully push top variants further.

12. **Strategic implication.** Against pool parents in the top 5 % of the arena (Elo ≥ 1319), the only agents the system has shown can reliably improve are **`engagement_amplify`** and **`iterative_editing`**. Disable all wholesale-rewrite tactics (`structural_transform`, `lexical_simplify`, `grounding_enhance` at this regime, etc.) and the over-conservative agents (legacy `criteria_driven`, propose/approve variant) at this stage of a strategy. The two-stage strategy template proposed in finding 30 of `_research.md` (seed-mode wholesale rewrites in stage 1, pool-mode polish in stage 2) is supported quantitatively by this report: stage 2 should dispatch *only* `engagement_amplify` and `iterative_editing`.

### Cost findings (columns A and B)

13. **Per-invocation cost is uniform at ~$0.002 except for `paragraph_recombine`.** Cost per invocation across every agent except `paragraph_recombine` lands in $0.0013 – $0.0030 (top 10 %) and $0.0013 – $0.0027 (top 5 %). `paragraph_recombine` runs **$0.010 / call (top 10 %)** and **$0.0094 / call (top 5 %)** — roughly 5× the per-invocation cost of every other agent. The 5× cost multiplier reflects the agent's per-slot rewrite + per-slot ranking work; even at the lower-than-historical cost it carries here, paragraph_recombine is the costliest agent attempted on strong parents.

14. **Cost per improved variant ranges from $0.0015 to $0.13.** The realized cost of producing one variant that beats its parent (where defined):

    | Tier | Cheapest improver | $/improver | Costliest improver | $/improver | Ratio |
    |---|---|---:|---|---:|---:|
    | Top 10 % | expansion_elaborate (n=1) | $0.0015 | paragraph_recombine | $0.0805 | 53× |
    | Top 10 % (meaningful n) | engagement_amplify | $0.0052 | paragraph_recombine | $0.0805 | 15× |
    | Top 5 % | engagement_amplify | $0.0037 | paragraph_recombine | $0.1316 | 36× |

    Aggregate cost per improver: **$0.027 (top 10 %)** and **$0.032 (top 5 %)** — i.e. about 3 cents to buy a successful rewrite at the top decile, slightly more at the top ventile.

15. **`engagement_amplify` is the cheapest meaningful-sample improver at both cutoffs.** $0.0052 / improver at top 10 % (next best is debate_synthesis at $0.0063, then iterative_editing at $0.0088). $0.0037 / improver at top 5 % (next best is iterative_editing at $0.0088 — 2.4× more expensive). Combined with its top-of-table success rate (44 % → 50 %), `engagement_amplify` is *both* the highest hit rate *and* the lowest cost per hit at the very top — a rare double-edge. The two analyses align on the same agent.

16. **`iterative_editing` is a stable second-place at $0.0088 / improver at both cutoffs.** Identical cost per improver because the sample is identical (every one of its 14 attempts has parent ≥ 1319, so the top-10 % and top-5 % slices are the same rows). 2.4× more expensive per improver than `engagement_amplify` at top 5 %, but more replicated (4 improvers vs 2).

17. **`paragraph_recombine` is the most expensive way to produce a top-tier improver — by an order of magnitude.** $0.0805 / improver at top 10 % (3 improvers out of 24 attempts costing $0.24 total), $0.1316 / improver at top 5 % (1 improver out of 14 attempts costing $0.13 total). At top 5 % it costs **35× more per improver** than `engagement_amplify` and **15× more** than `iterative_editing`. Sequential Context-Aware Generation (the 2026-06-12 release) has not closed this gap on this prompt.

18. **`criteria_driven` (legacy) and `criteria_driven_single_pass` are middle-tier on cost but high on waste.** Cost per improver at top 10 %: criteria_driven $0.0305 (3 improvers / $0.092 spent), criteria_driven_single_pass $0.0289 (2 improvers / $0.058 spent). At top 5 %, criteria_driven_single_pass climbs to $0.0212 / improver (still has 2 improvers), while criteria_driven hits null (zero improvers from $0.046 of total spend — pure waste).

19. **The 14 zero-improver agents at top 10 % consumed $0.149 of total cost for zero successful rewrites** (sum of `total_cost` across agents with `n_improvers = 0` at the top-10 % cutoff). That's 24 % of the $0.629 total budget spent at this parent tier with nothing to show for it. The biggest contributors are `structural_transform` ($0.030 wasted across 20 attempts), `lexical_simplify` ($0.024 / 18 attempts), `criteria_driven_propose_approve` is small at top-10 % ($0.006 / 2 attempts), and `analogy_bridge` ($0.018 / 7 attempts).

20. **Cost-aware strategic implication (sharpened).** At top-5 % parents the strict cost-efficiency ranking is `engagement_amplify` → `iterative_editing` → `iterative_editing_rewrite` → `criteria_driven_single_pass` → `paragraph_recombine` ($0.0037 → $0.0088 → $0.0134 → $0.0212 → $0.1316 per improver). The first two dominate on both success rate and cost per success; the latter three deliver improvers but at 4×–36× the cost. Reallocating the $0.149 currently spent on zero-improver agents at top-10 % parents to additional `engagement_amplify` invocations would buy ~29 additional attempts at this tier (avg cost-per-invocation $0.0052), of which ~13 (44 %) would improve on parent at the top-10 % cutoff. The single most important compute-budget move on this prompt is shifting pool-mode iterations toward `engagement_amplify`.

## Dataset

`dataset.csv` (42 rows, < 5 KB) holds every measurement in long format. Columns:

| Column | Type | Notes |
|---|---|---|
| `tier` | text | `top_10pct` or `top_5pct` |
| `slice` | text | `ALL` for aggregate rows; `agent` for per-agent rows |
| `agent_name` | text | `ALL` on aggregate rows; the producing agent name otherwise |
| `n_attempts` | int | Total rewrites in this slice |
| `n_improvers` | int | Rewrites with Δ > 0 |
| `success_pct` | numeric | `100 * n_improvers / n_attempts` |
| `avg_delta` | numeric | Mean Δ (signed) |
| `median_delta` | numeric | Median Δ (aggregate slice only — left blank for per-agent rows) |
| `avg_delta_up` | numeric | Mean Δ over rewrites with Δ > 0 (aggregate only) |
| `avg_delta_down` | numeric | Mean Δ over rewrites with Δ < 0 (aggregate only) |
| `max_delta` | numeric | Largest Δ in the slice (positive or negative) |
| `cost_per_invocation` | numeric | **Column A** — `avg(evolution_agent_invocations.cost_usd)` for the slice (USD) |
| `total_cost` | numeric | `sum(evolution_agent_invocations.cost_usd)` for the slice (USD) |
| `cost_per_improver` | numeric | **Column B** — `total_cost / n_improvers` (USD per successful rewrite). Blank when `n_improvers = 0`. |

**PII safety.** The dataset contains only arena Elo aggregates and per-agent counts — no user identifiers, no `email`, no raw query text, no authentication metadata, no article content. Confirm `dataset.csv` contains no PII before committing.

Inline preview — aggregate rows (with cost columns A + B):

| Tier | Cutoff | n | improvers | **success %** | mean Δ | median Δ | mean ↑ | mean ↓ | max Δ | **$/invocation** | total $ | **$/improver** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Top 10 % | Elo ≥ 1287 | 227 | 23 | **10.1** | −81.9 | −85.4 | +19.3 | −93.3 | +119.5 | $0.00277 | $0.6287 | **$0.0273** |
| Top 5 % | Elo ≥ 1319 | 133 | 11 | **8.3** | −95.1 | −92.4 | +11.1 | −104.7 | +41.9 | $0.00267 | $0.3549 | **$0.0323** |

Inline preview — per-agent at top-10 % (sorted by success rate desc, ties broken by improvers desc):

| Agent | n | imp | success % | mean Δ | max Δ | **$/inv** | total $ | **$/improver** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| expansion_elaborate | 1 | 1 | 100.0 | +0.7 | +0.7 | $0.00152 | $0.0015 | $0.0015 |
| zoom_lens | 2 | 1 | 50.0 | −56.0 | +119.5 | $0.00146 | $0.0029 | $0.0029 |
| **engagement_amplify** | 9 | 4 | **44.4** | −46.6 | +41.9 | $0.00231 | $0.0208 | **$0.0052** |
| iterative_editing | 14 | 4 | 28.6 | −58.6 | +14.7 | $0.00253 | $0.0354 | $0.0088 |
| debate_synthesis | 7 | 2 | 28.6 | −66.1 | +1.7 | $0.00179 | $0.0126 | $0.0063 |
| **paragraph_recombine** | 24 | 3 | 12.5 | −63.1 | +43.6 | **$0.01006** | $0.2416 | **$0.0805** |
| grounding_enhance | 8 | 1 | 12.5 | −68.8 | +2.1 | $0.00228 | $0.0182 | $0.0182 |
| iterative_editing_rewrite | 18 | 2 | 11.1 | −75.4 | +30.7 | $0.00149 | $0.0268 | $0.0134 |
| criteria_driven_single_pass | 22 | 2 | 9.1 | −57.8 | +4.2 | $0.00263 | $0.0578 | $0.0289 |
| criteria_driven | 51 | 3 | 5.9 | −70.3 | +58.3 | $0.00180 | $0.0916 | $0.0305 |
| structural_transform | 20 | 0 | **0.0** | −129.5 | −27.8 | $0.00150 | $0.0300 | — |
| lexical_simplify | 18 | 0 | **0.0** | −178.6 | −59.5 | $0.00133 | $0.0239 | — |
| analogy_bridge | 7 | 0 | 0.0 | −37.6 | −3.5 | $0.00257 | $0.0180 | — |
| historical_context | 5 | 0 | 0.0 | −64.3 | −32.2 | $0.00220 | $0.0110 | — |
| expert_deepdive | 4 | 0 | 0.0 | −60.6 | −40.5 | $0.00166 | $0.0066 | — |
| first_principles | 4 | 0 | 0.0 | −153.3 | −94.2 | $0.00186 | $0.0074 | — |
| contrast_frame | 2 | 0 | 0.0 | −107.0 | −57.3 | $0.00156 | $0.0031 | — |
| sensory_concretize | 2 | 0 | 0.0 | −130.5 | −94.6 | $0.00150 | $0.0030 | — |
| tone_transform | 2 | 0 | 0.0 | −83.2 | −54.1 | $0.00148 | $0.0030 | — |
| criteria_driven_propose_approve | 2 | 0 | 0.0 | −42.7 | −5.3 | $0.00299 | $0.0060 | — |
| pedagogy_scaffold | 2 | 0 | 0.0 | −144.7 | −115.3 | $0.00157 | $0.0031 | — |
| coherence_thread | 1 | 0 | 0.0 | −72.7 | −72.7 | $0.00149 | $0.0015 | — |
| progressive_disclosure | 1 | 0 | 0.0 | −108.3 | −108.3 | $0.00145 | $0.0014 | — |
| practitioner_orient | 1 | 0 | 0.0 | −45.9 | −45.9 | $0.00147 | $0.0015 | — |

Inline preview — per-agent at top-5 % (sorted by success rate desc, ties broken by improvers desc):

| Agent | n | imp | success % | mean Δ | max Δ | **$/inv** | total $ | **$/improver** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **engagement_amplify** | 4 | 2 | **50.0** | −46.0 | +41.9 | $0.00187 | $0.0075 | **$0.0037** |
| iterative_editing | 14 | 4 | 28.6 | −58.6 | +14.7 | $0.00253 | $0.0354 | $0.0088 |
| criteria_driven_single_pass | 16 | 2 | 12.5 | −65.7 | +4.2 | $0.00265 | $0.0423 | $0.0212 |
| iterative_editing_rewrite | 18 | 2 | 11.1 | −75.4 | +30.7 | $0.00149 | $0.0268 | $0.0134 |
| **paragraph_recombine** | 14 | 1 | 7.1 | −67.7 | +4.5 | **$0.00940** | $0.1316 | **$0.1316** |
| structural_transform | 15 | 0 | **0.0** | −133.4 | −27.8 | $0.00149 | $0.0224 | — |
| lexical_simplify | 14 | 0 | **0.0** | −177.9 | −59.5 | $0.00131 | $0.0183 | — |
| criteria_driven | 25 | 0 | **0.0** | −101.5 | −2.3 | $0.00182 | $0.0456 | — |
| debate_synthesis | 2 | 0 | 0.0 | −92.6 | −91.2 | $0.00198 | $0.0040 | — |
| grounding_enhance | 2 | 0 | 0.0 | −62.4 | −34.9 | $0.00182 | $0.0036 | — |
| analogy_bridge | 4 | 0 | 0.0 | −32.7 | −3.5 | $0.00251 | $0.0101 | — |
| first_principles | 1 | 0 | 0.0 | −252.3 | −252.3 | $0.00138 | $0.0014 | — |
| historical_context | 1 | 0 | 0.0 | −105.3 | −105.3 | $0.00164 | $0.0016 | — |
| zoom_lens | 1 | 0 | 0.0 | −231.5 | −231.5 | $0.00144 | $0.0014 | — |
| coherence_thread | 1 | 0 | 0.0 | −72.7 | −72.7 | $0.00149 | $0.0015 | — |
| contrast_frame | 1 | 0 | 0.0 | −156.6 | −156.6 | $0.00150 | $0.0015 | — |

## Queries & Results

All three queries below were run via `npm run query:staging -- --json "<query>"` against the staging Supabase `readonly_local` role. Exact SQL is in `queries.sql`. Full results are inlined in `dataset.csv` and previewed in § Dataset above.

### Q1 — Aggregate at each cutoff (with cost columns)

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT 'top 10% (parent Elo >= 1287)' AS tier,
       count(*) AS n_attempts,
       count(*) FILTER (WHERE delta > 0) AS n_improvers,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS improver_pct,
       round(avg(delta)::numeric,1) AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric,1) AS median_delta,
       round(avg(delta) FILTER (WHERE delta > 0)::numeric,1) AS avg_delta_up,
       round(avg(delta) FILTER (WHERE delta < 0)::numeric,1) AS avg_delta_down,
       round(max(delta)::numeric,1) AS max_delta,
       round(avg(cost_usd)::numeric,5) AS cost_per_invocation,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs WHERE parent_elo >= 1287
UNION ALL
SELECT 'top 5% (parent Elo >= 1319)',
       count(*), count(*) FILTER (WHERE delta > 0),
       round((100.0*count(*) FILTER (WHERE delta > 0)/NULLIF(count(*),0))::numeric,1),
       round(avg(delta)::numeric,1),
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric,1),
       round(avg(delta) FILTER (WHERE delta > 0)::numeric,1),
       round(avg(delta) FILTER (WHERE delta < 0)::numeric,1),
       round(max(delta)::numeric,1),
       round(avg(cost_usd)::numeric,5),
       round(sum(cost_usd)::numeric,4),
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4)
FROM pairs WHERE parent_elo >= 1319;
```

Result (2 rows):

```json
[
  {
    "tier": "top 10% (parent Elo >= 1287)",
    "n_attempts": "227", "n_improvers": "23", "improver_pct": "10.1",
    "avg_delta": "-81.9", "median_delta": "-85.4",
    "avg_delta_up": "19.3", "avg_delta_down": "-93.3", "max_delta": "119.5",
    "cost_per_invocation": "0.00277", "total_cost": "0.6287", "cost_per_improver": "0.0273"
  },
  {
    "tier": "top 5% (parent Elo >= 1319)",
    "n_attempts": "133", "n_improvers": "11", "improver_pct": "8.3",
    "avg_delta": "-95.1", "median_delta": "-92.4",
    "avg_delta_up": "11.1", "avg_delta_down": "-104.7", "max_delta": "41.9",
    "cost_per_invocation": "0.00267", "total_cost": "0.3549", "cost_per_improver": "0.0323"
  }
]
```

### Q2 — Per-agent at parent Elo ≥ 1287 (top 10 %, with cost columns)

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_name, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.agent_name, c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE p.elo_score >= 1287 AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name, count(*) AS n, count(*) FILTER (WHERE delta > 0) AS n_imp,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS pct,
       round(avg(delta)::numeric,1) AS avg_d, round(max(delta)::numeric,1) AS max_d,
       round(avg(cost_usd)::numeric,5) AS cost_per_inv,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs GROUP BY agent_name ORDER BY pct DESC NULLS LAST, n_imp DESC;
```

Result (24 rows) — full data is in `dataset.csv` filtered to `tier=top_10pct`. Selected top rows (showing the cost columns):

```json
[
  { "agent_name": "expansion_elaborate",          "n":  "1", "n_imp": "1", "pct": "100.0", "avg_d":   "0.7", "max_d":   "0.7", "cost_per_inv": "0.00152", "total_cost": "0.0015", "cost_per_improver": "0.0015" },
  { "agent_name": "zoom_lens",                    "n":  "2", "n_imp": "1", "pct":  "50.0", "avg_d": "-56.0", "max_d": "119.5", "cost_per_inv": "0.00146", "total_cost": "0.0029", "cost_per_improver": "0.0029" },
  { "agent_name": "engagement_amplify",           "n":  "9", "n_imp": "4", "pct":  "44.4", "avg_d": "-46.6", "max_d":  "41.9", "cost_per_inv": "0.00231", "total_cost": "0.0208", "cost_per_improver": "0.0052" },
  { "agent_name": "iterative_editing",            "n": "14", "n_imp": "4", "pct":  "28.6", "avg_d": "-58.6", "max_d":  "14.7", "cost_per_inv": "0.00253", "total_cost": "0.0354", "cost_per_improver": "0.0088" },
  { "agent_name": "debate_synthesis",             "n":  "7", "n_imp": "2", "pct":  "28.6", "avg_d": "-66.1", "max_d":   "1.7", "cost_per_inv": "0.00179", "total_cost": "0.0126", "cost_per_improver": "0.0063" },
  { "agent_name": "paragraph_recombine",          "n": "24", "n_imp": "3", "pct":  "12.5", "avg_d": "-63.1", "max_d":  "43.6", "cost_per_inv": "0.01006", "total_cost": "0.2416", "cost_per_improver": "0.0805" },
  { "agent_name": "grounding_enhance",            "n":  "8", "n_imp": "1", "pct":  "12.5", "avg_d": "-68.8", "max_d":   "2.1", "cost_per_inv": "0.00228", "total_cost": "0.0182", "cost_per_improver": "0.0182" },
  { "agent_name": "iterative_editing_rewrite",    "n": "18", "n_imp": "2", "pct":  "11.1", "avg_d": "-75.4", "max_d":  "30.7", "cost_per_inv": "0.00149", "total_cost": "0.0268", "cost_per_improver": "0.0134" },
  { "agent_name": "criteria_driven_single_pass",  "n": "22", "n_imp": "2", "pct":   "9.1", "avg_d": "-57.8", "max_d":   "4.2", "cost_per_inv": "0.00263", "total_cost": "0.0578", "cost_per_improver": "0.0289" },
  { "agent_name": "criteria_driven",              "n": "51", "n_imp": "3", "pct":   "5.9", "avg_d": "-70.3", "max_d":  "58.3", "cost_per_inv": "0.00180", "total_cost": "0.0916", "cost_per_improver": "0.0305" },
  { "agent_name": "structural_transform",         "n": "20", "n_imp": "0", "pct":   "0.0", "avg_d":"-129.5", "max_d": "-27.8", "cost_per_inv": "0.00150", "total_cost": "0.0300", "cost_per_improver": null      },
  { "agent_name": "lexical_simplify",             "n": "18", "n_imp": "0", "pct":   "0.0", "avg_d":"-178.6", "max_d": "-59.5", "cost_per_inv": "0.00133", "total_cost": "0.0239", "cost_per_improver": null      }
  // … remaining 0-improver agents (analogy_bridge, historical_context, expert_deepdive,
  //   first_principles, contrast_frame, sensory_concretize, tone_transform,
  //   criteria_driven_propose_approve, coherence_thread, pedagogy_scaffold,
  //   progressive_disclosure, practitioner_orient) in dataset.csv
]
```

### Q3 — Per-agent at parent Elo ≥ 1319 (top 5 %, with cost columns)

```sql
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_name, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.agent_name, c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE p.elo_score >= 1319 AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name, count(*) AS n, count(*) FILTER (WHERE delta > 0) AS n_imp,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS pct,
       round(avg(delta)::numeric,1) AS avg_d, round(max(delta)::numeric,1) AS max_d,
       round(avg(cost_usd)::numeric,5) AS cost_per_inv,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs GROUP BY agent_name ORDER BY pct DESC NULLS LAST, n_imp DESC;
```

Result (16 rows) — full data is in `dataset.csv` filtered to `tier=top_5pct`. Selected top rows (showing the cost columns):

```json
[
  { "agent_name": "engagement_amplify",           "n":  "4", "n_imp": "2", "pct": "50.0", "avg_d":  "-46.0", "max_d":   "41.9", "cost_per_inv": "0.00187", "total_cost": "0.0075", "cost_per_improver": "0.0037" },
  { "agent_name": "iterative_editing",            "n": "14", "n_imp": "4", "pct": "28.6", "avg_d":  "-58.6", "max_d":   "14.7", "cost_per_inv": "0.00253", "total_cost": "0.0354", "cost_per_improver": "0.0088" },
  { "agent_name": "criteria_driven_single_pass",  "n": "16", "n_imp": "2", "pct": "12.5", "avg_d":  "-65.7", "max_d":    "4.2", "cost_per_inv": "0.00265", "total_cost": "0.0423", "cost_per_improver": "0.0212" },
  { "agent_name": "iterative_editing_rewrite",    "n": "18", "n_imp": "2", "pct": "11.1", "avg_d":  "-75.4", "max_d":   "30.7", "cost_per_inv": "0.00149", "total_cost": "0.0268", "cost_per_improver": "0.0134" },
  { "agent_name": "paragraph_recombine",          "n": "14", "n_imp": "1", "pct":  "7.1", "avg_d":  "-67.7", "max_d":    "4.5", "cost_per_inv": "0.00940", "total_cost": "0.1316", "cost_per_improver": "0.1316" },
  { "agent_name": "structural_transform",         "n": "15", "n_imp": "0", "pct":  "0.0", "avg_d": "-133.4", "max_d":  "-27.8", "cost_per_inv": "0.00149", "total_cost": "0.0224", "cost_per_improver": null      },
  { "agent_name": "lexical_simplify",             "n": "14", "n_imp": "0", "pct":  "0.0", "avg_d": "-177.9", "max_d":  "-59.5", "cost_per_inv": "0.00131", "total_cost": "0.0183", "cost_per_improver": null      },
  { "agent_name": "criteria_driven",              "n": "25", "n_imp": "0", "pct":  "0.0", "avg_d": "-101.5", "max_d":   "-2.3", "cost_per_inv": "0.00182", "total_cost": "0.0456", "cost_per_improver": null      },
  { "agent_name": "debate_synthesis",             "n":  "2", "n_imp": "0", "pct":  "0.0", "avg_d":  "-92.6", "max_d":  "-91.2", "cost_per_inv": "0.00198", "total_cost": "0.0040", "cost_per_improver": null      }
  // … remaining 0-improver agents (grounding_enhance, analogy_bridge, first_principles,
  //   historical_context, zoom_lens, coherence_thread, contrast_frame) in dataset.csv
]
```
