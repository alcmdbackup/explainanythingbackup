# Meta Analysis: How to Get Top Arena (Federal Reserve 2) Progress

## Phase 1: Establish the data baseline
### Work Done
- Resolved `Federal Reserve 2` prompt UUID `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` on staging (not on prod).
- Pulled 2,388 active arena variants, decile-banded by Elo (top 10% range 1287–1431; bottom 10% range 1058–1093).
- Snapshotted top-30 variants joined to runs, strategies, models, judge, num_iters, budget; identified five top-producing strategies (Sequential iteration 2, Sequential paragraph rewrite initial, Ligther strategy 2, Iterative editing - markup, Iterative editing - whole article).
- Pulled `iterationConfigs[]` JSONB for all 5 top strategies — all $0.05 budget, qwen judge, cheap gen model, temp 1.0.
- Walked `get_variant_full_chain` for top-3 winners: shallow (depth=1) and deep (depth=4, 14-iter run) both work.
- Pulled global tactic leaderboard (`avg_elo`, `avg_elo_delta`, `win_rate` from `evolution_metrics` entity_type='tactic').
- Pulled `sentence_verbatim_ratio` distribution per agent for federal_reserve_2 — bimodal: paragraph_recombine 0.50, criteria_propose_approve 0.95 (too conservative), lexical_simplify 0.02 (wholesale).
- Computed cost averages for the 50 runs that produced top-50 arena variants (avg $0.038, avg winner_elo 1383).
- Compared top-10% vs middle vs bottom 50% agent distributions — structural_transform 33% / grounding_enhance 20% / criteria_driven_single_pass 8% of the top 239.

### Issues Encountered
- The strategy-level `eloAttrDelta:*` rows are sparse — only one of the five top strategies had any (Ligther strategy 2 had 3 rows; Sequential paragraph rewrite initial had 1). Attribution coverage hasn't backfilled across older runs.
- `run_summary.iterationResults` was NULL on the #1 winner's run — couldn't extract per-iteration budget/variants/matches from the summary. Would need to walk `evolution_agent_invocations` per run to reconstruct.
- The tactic-level `n` values are capped at 1000 in `evolution_metrics`, masking the actual variant count for `structural_transform`/`grounding_enhance`/`lexical_simplify`/`criteria_driven` (each shows n=1000 globally but federal_reserve_2 alone has 540/423/464/372).

### User Clarifications
- None requested. User explicitly said federal_reserve_2 — staging prompt `a546b7e9-...` (not the prod "Federal reserve policy" or the older staging "Federal Reserve").

## Phase 2: Characterize the top cohort

Per-agent and per-strategy characterizations of the top cohort are written up under "Key Findings" in `_research.md`. Findings 1–12 cover: editing-style agent advantage, structural_transform paradox, two failure modes (propose/approve over-conservatism, lexical_simplify wholesale-low-quality), cheap-model sufficiency, budget sufficiency at $0.05, reflection absence, paragraph_recombine bimodality, debate_synthesis highest win rate, custom-rubric usage, universal temp=1.0, and tight `maxComparisonsPerVariant: 2-3`.

## Phase 3: Contrast against the rest of the leaderboard
*(deferred — /research focused on Phase 1+2; planning doc Phase 3 will be done as part of the analysis-report writeup)*

## Phase 2: Characterize the top cohort
*(populated during execution)*

## Phase 3: Contrast against the rest of the leaderboard
*(populated during execution)*

## Phase 4: Synthesize new improvement ideas
*(populated during execution)*

## Phase 5: Write the analysis report
*(populated during execution)*
