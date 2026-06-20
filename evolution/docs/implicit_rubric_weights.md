# Implicit Rubric Weights

## Overview

Infers rubric-dimension **weights** from human preference data instead of an admin typing them in by hand. The rubric works **on pairs**, exactly like the production match rubric (`rubricJudge.scorePass`): for each article pair the judge gives a per-criterion verdict ("is A or B better on this criterion") plus an independent **overall** verdict, and weights `w` are fit so the weighted vote of the per-criterion verdicts predicts the overall winner (`sign(Σ wᵢ·vᵢ)`, `vᵢ∈{−1,0,+1}`). Because that IS the production voting rule, the inferred weights plug straight into the existing rubric vote with no semantic mismatch. Output weights export to a real `evolution_judge_rubrics` row, closing the loop into rubric-based LLM judging.

Two modes share the same tables, fit, results, and export:
- **human mode** — a person gives the verdicts (interactive; overall judged first, per-criterion on a separate gated step, with a sampled reversal audit for bias).
- **auto mode** — an LLM-as-judge gives both verdicts via the existing 2-pass comparison primitives, under a pre-flight cost cap (Phase 5). Auto mode reverse-engineers the judge model's *implicit* rubric.

Project: `docs/planning/calculate_implifed_rubric_weights_evolution_20260619/`.

## The fit

Each labelled pair contributes a feature vector `v ∈ {−1,0,+1}ᴷ` (per-criterion verdict: a=+1, b=−1, tie=0, canonical-oriented) and a label (the overall verdict, a=1/b=0; overall-ties dropped). `fitWeights` runs **ridge-regularized logistic regression (IRLS)** on the verdict vectors, then **clamps negative coefficients to 0 and refits on the survivors** (softmax was rejected — it can't yield exact-0 weights), and renormalizes to a non-negative, sum-to-1 weight per criterion. Guards: mandatory non-zero ridge λ (handles perfect separation), an IRLS iteration cap, sigmoid/logit clamping (no `log(0)`/overflow), and zero-variance (always-tie/constant) columns pinned to 0. Flags: `barelyMatters` (near-0 weight), `disagreesWithOverall` (negative pre-clamp), `nonIdentifiable` (pinned), `collinear` (columns moving together). Confidence intervals come from `weightCIs` — a bootstrap that resamples pairs and **re-runs the full fit** per iteration (NOT a reuse of the scalar `bootstrapMeanCI`), with a finite-CI fallback to the point estimate on degenerate resamples.

The fitted weights are stored RAW in the rubric; the existing `normalizeDimensions` (read-time, in `rubricJudge.ts`) renormalizes — so non-negative output is required (a negative would be silently zeroed downstream).

## Reviewer-bias audit

A configurable `replication_rate` (default 0.15) re-shows a sample of pairs a second time with sides **swapped** (`pass=1`). Verdicts are stored **canonical-oriented** (flipped on save via `shown_swapped`), so the two passes are directly comparable. `auditConsistency` computes a **position-bias rate** (verdict flipped under reversal) and a **self-consistency rate** (verdict agreed) for the overall verdict and per criterion — the human analogs of Judge Lab's LLM-judge metrics. Replicated-pair agreement feeds a **per-pair confidence** (`pairConfidence`) that weights the pair in the fit. Replica (`pass=1`) rows feed ONLY the audit/confidence — never the training matrix (no double-counting).

## Sample-size preview

`requiredRatings(K)` estimates the distinct pairs needed (≈ `max(20, 12·K)`), the comparisons (pairs + the `replication_rate` audit overhead), and the total verdicts (`comparisons × (1 + K)`). Shown upfront in the new-session dialog and live on the session detail (`remainingPairs`).

## Data model

See [Data Model → Weight-inference tables](./data_model.md#weight-inference-tables-calculate_implifed_rubric_weights_evolution_20260619). Five tables (migration `20260619000001`), all on the standard evolution RLS (deny-all + `service_role_all` + `readonly_local`), `is_test_content` trigger on the name-bearing `sessions` table:

- `evolution_weight_inference_sessions` — the run entity (mode, prompt_id, sample_size, replication_rate, auto-mode judge settings).
- `evolution_weight_inference_criteria` — junction (session → criteria; the chosen set; weight is the OUTPUT, not stored here).
- `evolution_weight_inference_articles` — snapshot of the sampled pool (content + mu/sigma).
- `evolution_weight_inference_comparisons` — one row per pair PER PASS; canonical ordering enforced by a CHECK (`article_a_id < article_b_id`); overall_winner + source + (auto) confidence/judge_model/cost/forward_winner/reverse_winner.
- `evolution_weight_inference_dimension_verdicts` — per-criterion verdict (criteria_id bare + criteria_name snapshot).

## Key Files
- `evolution/src/lib/weightInference/` — `types`, `verdicts` (`flipPairVerdict`/canonical orientation), `fit` (`fitWeights`/`predictOverall`), `ci` (`weightCIs`), `sampleSize` (`requiredRatings`), `audit` (`auditConsistency`/`pairConfidence`). All pure + unit-tested.
- `evolution/src/services/weightInferenceActions.ts` — `adminAction`-wrapped server actions: create session (seed pool from an arena topic + materialize pairs), list, preview, getNextPair (overall-first / criteria-gated), recordOverall/recordDimensionVerdicts (canonical flip-on-save), getFit, exportRubric. `rater_id` is server-derived; kill switch `EVOLUTION_WEIGHT_INFERENCE_ENABLED`.
- `src/app/admin/evolution/weight-inference/{page.tsx,[sessionId]/page.tsx,loading.tsx}` — sessions landing + new-session form; session detail (Judge / Results + export).
- `src/components/admin/EvolutionSidebar.tsx` — "Implied Rubric Weights" Tools nav entry.
- `supabase/migrations/20260619000001_evolution_weight_inference.sql` — the five tables.

## Implementation notes
- The article pool is sampled directly from `evolution_variants WHERE prompt_id = <topic> AND synced_to_arena AND variant_kind='article' AND archived_at IS NULL` (NOT the Judge-Lab `seed.ts` path, which snapshots already-judged comparisons into a capped JSONB bank).
- Pairs are materialized eagerly at session create: all `C(M,2)` candidates are seeded-shuffled (`createSeededRng(hash(sessionId))`), the first `requiredRatings(K).pairs` are kept as `pass=0` rows, and a `replication_rate` fraction get a `pass=1` reversal replica.
- `fitWeights` filters by the session's `source` (human XOR auto) — a session is single-source, never a mixed fit.
- Export blocks when the fit is degenerate / all-zero, and surfaces a friendly message on the `evolution_judge_rubrics.name` UNIQUE collision.

## Cross-references
- [Rating & Comparison — Rubric-Based Judging](./rating_and_comparison.md#rubric-based-judging-structured_judging_evolution_20260610) — the explicit-weight system this feature feeds.
- [Criteria Agents](./criteria_agents.md) — `evolution_criteria` rubric components being judged.
- [Judge Evaluation (Judge Lab)](../../docs/feature_deep_dives/judge_evaluation.md) — closest data-collection analog; auto mode reuses its 2-pass / `buildRubricComparisonPrompt` primitives + cost-cap pattern.
- [Data Model](./data_model.md) — the five new tables + RLS.
