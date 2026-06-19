# Implicit Rubric Weights

## Overview
[To be filled during implementation]

Infers rubric-dimension **weights** from human preference data instead of an admin typing them in by hand. Two human inputs — per-criterion gradings on individual articles and pairwise "which is better" choices — are reconciled by fitting weights `w` such that the weighted per-criterion score difference predicts the pairwise winner (`sign(w · (s(a) − s(b)))`). Surfaces an upfront + live preview of how many ratings of each type are needed. Output weights seed an `evolution_judge_rubrics` set, closing the loop into rubric-based LLM judging.

## Key Files
- [To be filled during implementation — likely `evolution/src/lib/<weightFit>.ts`, `evolution/src/services/<weightInferenceActions>.ts`, `src/app/admin/evolution/<page>/`]

## Implementation
[To be filled during implementation]

## Cross-references
- [Rating & Comparison — Rubric-Based Judging](./rating_and_comparison.md#rubric-based-judging-structured_judging_evolution_20260610) — the explicit-weight system this feature feeds
- [Criteria Agents](./criteria_agents.md) — `evolution_criteria` rubric components being graded
- [Judge Evaluation (Judge Lab)](../../docs/feature_deep_dives/judge_evaluation.md) — closest data-collection analog (pair-banks, frozen test sets)
- [Data Model](./data_model.md) — new tables + RLS
