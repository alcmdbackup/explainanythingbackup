# Implicit Rubric Weights

## Overview
[To be filled during implementation]

Infers rubric-dimension **weights** from human preference data instead of an admin typing them in by hand. The rubric works **on pairs**, exactly like the production match rubric (`rubricJudge.scorePass`): for each article pair the human gives a per-criterion verdict ("is A or B better on this criterion") plus an independent **overall** verdict, and weights `w` are fit so the weighted vote of the per-criterion verdicts predicts the overall winner (`sign(Σ wᵢ·vᵢ)`, `vᵢ∈{−1,0,+1}`). Because that IS the production voting rule, the inferred weights plug straight in with no semantic mismatch. Surfaces an upfront + live preview of how many ratings are needed. Output weights seed an `evolution_judge_rubrics` set, closing the loop into rubric-based LLM judging.

Two modes share the same tables, fit, results, and export: **human mode** (a person gives the verdicts) and **auto mode** (an LLM-as-judge gives both the holistic overall verdict and the per-criterion verdicts via the existing 2-pass comparison primitives, under a pre-flight cost cap) — auto mode reverse-engineers the judge model's *implicit* rubric.

## Key Files
- [To be filled during implementation — likely `evolution/src/lib/<weightFit>.ts`, `evolution/src/services/<weightInferenceActions>.ts`, `src/app/admin/evolution/<page>/`]

## Implementation
[To be filled during implementation]

## Cross-references
- [Rating & Comparison — Rubric-Based Judging](./rating_and_comparison.md#rubric-based-judging-structured_judging_evolution_20260610) — the explicit-weight system this feature feeds
- [Criteria Agents](./criteria_agents.md) — `evolution_criteria` rubric components being graded
- [Judge Evaluation (Judge Lab)](../../docs/feature_deep_dives/judge_evaluation.md) — closest data-collection analog (pair-banks, frozen test sets)
- [Data Model](./data_model.md) — new tables + RLS
