<!-- Research findings for inferring implicit rubric criteria weights from human pairwise preferences + per-criterion gradings in the evolution pipeline. -->

# Calculate Implied Rubric Weights (Evolution) Research

## Problem Statement
Allow user preferences to support implicitly calculating implicit rubric criteria and weights. Rather than an admin hand-setting each judging dimension's weight, infer the rough weights from two kinds of human input — (1) which of a pair of articles is better, and (2) per-criterion grades on individual articles — and find the weighting that best reconciles the two. Serve a preview upfront estimating how many ratings of each type are needed.

## Requirements (from GH Issue #NNN)
- Let user choose which variant is better, for a given pair.
- Let user grade articles on rubric components, separately.
- Figure out implied rough weightings that allow the two to match.
- This is a high-level idea, figure out how to do this and serve up a preview upfront of how many ratings of each type are necessary.

## High Level Summary

The codebase **already has the explicit version of this feature** and most of the substrate this project needs. The gap is purely the *inference* layer (human-data collection + a statistical fit) on top:

- **Rubric components already exist** as `evolution_criteria` rows: `{ name, label, description, min_rating, max_rating, evaluation_guidance: [{score, description}] }` (anchors). 7 starter criteria are seeded (`clarity`, `engagement`, `structure`, `depth`, `tone`, `point_of_view`, `sentence_variety`). Admin CRUD at `/admin/evolution/criteria`.
- **Weighted rubrics already exist** as `evolution_judge_rubrics` + `evolution_judge_rubric_dimensions` (`criteria_id` FK, `weight NUMERIC ≥ 0`, `position`). Weights are **normalized at read time** (`getJudgeRubricForEvaluation`). Today an admin types these weights in by hand at `/admin/evolution/judge-rubrics`; rubric-based pairwise judging (`rubricJudge.ts`) sums per-dimension winners by weight. **This project's output is exactly these weights — inferred instead of typed.**
- **Pairwise comparison infra exists**: `compareWithBiasMitigation` / `buildComparisonPrompt` / `parseWinner` / `aggregateWinners`, plus the `evolution_arena_comparisons` table (`entry_a`, `entry_b`, `winner ∈ {a,b,draw}`, `confidence`). Today the judge is an **LLM**; here the judge for the *training data* is a **human** (LLM judging is the eventual *consumer* of the inferred weights).
- **Judge Lab (`judge_eval_*` tables)** is the closest analog: it persists pairs (pair-banks), frozen test sets, and per-call verdicts, and computes accuracy vs. an Elo-gap ground truth. This is the right architectural pattern to imitate for the human-labelling + sample-set machinery.

### The core mechanic ("make the two match")
Each article `a` has a per-criterion score vector `s(a) = [s_1 … s_K]` (from human grading on the K criteria, on each criterion's `[min,max]` scale). For a graded pair `(a, b)` the human also states a pairwise preference. We want weights `w = [w_1 … w_K] (w_i ≥ 0, Σw_i = 1)` such that the **weighted score difference predicts the pairwise winner**:

```
predicted_winner(a,b) = sign( w · (s(a) − s(b)) )
```

This is a **logistic regression / Bradley–Terry fit** on score-*difference* features:
- Feature vector per labelled pair = `s(a) − s(b)` (length K).
- Label = human pairwise choice (A wins / B wins / tie).
- Fit `w` (optionally with a non-negativity + sum-to-1 constraint, or via L2/Dirichlet regularization) maximizing agreement with the human pairwise labels.
- The fitted coefficients, renormalized, ARE the implied rubric weights. Tie handling and per-criterion grader noise mirror existing patterns (draw threshold, 2-pass reversal for the human pairwise step is optional).

This is the standard "learning a linear value function from pairwise comparisons + feature scores" problem (a.k.a. preference learning / RankSVM / Bradley-Terry with observed item features). It is small-K (typically 3–8 criteria), so it is cheap to fit and the open questions are about **data collection ergonomics and identifiability**, not compute.

### The "preview of how many ratings necessary"
Emphasized in the brief. There are **two rating types** to size independently:
1. **Per-criterion gradings** — needed so each article in the labelled pairs has a score vector. Grader noise ⇒ may want ≥1 grading per article (or repeat-and-average). Drives how many *articles* must be graded across K criteria.
2. **Pairwise comparisons** — the regression labels. Identifiability of K weights needs the score-difference vectors to **span** the K-dimensional space (criteria that never vary, or always move together, can't be separated → flag collinearity). Rule-of-thumb floor ~10–20× K labelled pairs for stable coefficients; tighter weight CIs need more.

The preview is a **power/sample-size estimate** computed before the user starts: given K criteria (and optionally a target weight-CI width or held-out prediction accuracy), output e.g. *"≈ M articles graded (K scores each) + ≈ N pairwise comparisons"*. Candidate approaches to compute it (to decide in /planning): closed-form logistic-regression rule-of-thumb, a small Monte-Carlo simulation over plausible score distributions, or a D-optimal design heuristic. The preview should also update **live** as data comes in (current weight CIs / collinearity warnings / "≈ X more comparisons to converge").

### Integration target
Inferred weights → write/seed an `evolution_judge_rubrics` + `evolution_judge_rubric_dimensions` set (or recommend weights for an existing rubric). That closes the loop: human preference → inferred weights → rubric-based LLM judging (`EVOLUTION_RUBRIC_JUDGING_ENABLED`) drives the live arena. Aligns with white_paper.md's "aggregated scoring of similar articles … DAG-like voting" and "maximize feedback collection."

### Open questions to resolve in /research + /planning
- **Where do the article pairs come from?** Likely seed from `evolution_arena_comparisons` (like Judge Lab pair-banks) or from a chosen arena topic's variants. Must variants in a pair be graded, or can grading be on any article?
- **Who grades / who picks the winner?** Single admin user vs. multiple human raters (inter-rater agreement). MVP likely single admin.
- **Constraints on `w`**: non-negativity + sum-to-1 (interpretable as rubric weights) vs. unconstrained logistic coefficients then projected. Negative inferred weight = criterion that *anti*-correlates with preference (surface as a warning, not silently clamp).
- **Tie handling** in both the pairwise label and the fit (reuse the existing `<0.3 confidence → draw` semantics?).
- **Grader-noise model** for the preview's sample-size math.
- **Statistical library**: implement the small logistic/BT fit in TS (no heavy dep) vs. a minimal gradient-descent / IRLS. K is small so a hand-rolled fit is feasible and keeps the bundle clean.
- **Storage**: new tables for human gradings + human pairwise labels + a "weight-inference run" entity (mirroring `judge_eval_*`), all under the standard evolution RLS (deny-all + `service_role_all` + `readonly_local`).
- Does this also *discover* criteria ("implicit rubric criteria"), or only weight a fixed criteria set? Brief says "criteria and weights" — MVP almost certainly = weight an admin-chosen criteria set; criterion *discovery* (e.g., which criteria matter / dropping zero-weight ones) is a stretch goal that falls out of the fit (near-zero weight ⇒ criterion doesn't matter to this user).

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

### Relevant Docs (read for this project)
- evolution/docs/rating_and_comparison.md — Elo/uncertainty, 2-pass reversal, **Rubric-Based Judging** (existing explicit-weight system), comparison cache
- evolution/docs/criteria_agents.md — `evolution_criteria` rubric components, evaluate-and-suggest scoring
- evolution/docs/arena.md — pairwise comparisons, `evolution_arena_comparisons`, leaderboard
- evolution/docs/data_model.md — `evolution_criteria`, `evolution_judge_rubrics`(+dimensions), `evolution_arena_comparisons`, metrics EAV, RLS pattern, `judge_eval_*`
- evolution/docs/metrics.md + evolution/docs/evolution_metrics.md — EAV metrics registry, bootstrap CIs, propagation
- evolution/docs/strategies_and_experiments.md — `StrategyConfig`, `judgeRubricId`, config hashing
- evolution/docs/visualization.md — admin UI patterns (EntityListPage, MetricGrid, server actions, Tools nav group, Judge Lab pages)
- evolution/docs/reference.md — file inventory, env-var/kill-switch conventions, CLI, error classes
- evolution/docs/entities.md — entity registry + relationships
- evolution/docs/architecture.md — pipeline, `buildRunContext` rubric resolution
- evolution/docs/agents/overview.md — criteria-driven agents, comparison primitive
- docs/feature_deep_dives/judge_evaluation.md — **Judge Lab**: pair-banks, frozen test sets, per-call verdicts, criteria-split/aggregation — the closest data-collection/measurement analog
- evolution/docs/cost_optimization.md, editing_agents.md, variant_lineage.md, paragraph_recombine.md, prompt_editor.md, logging.md, multi_iteration_strategies.md, curriculum.md, minicomputer_deployment.md — read for full evolution context
- docs/docs_overall/white_paper.md — product philosophy: maximize feedback, aggregated/DAG-like article scoring
- docs/docs_overall/design_style_guide.md — Midnight Scholar tokens/components + ESLint design enforcement (for the new admin UI)

## Code Files Read
- (none yet — research phase reads the docs first; `/research` will drill into `evolution/src/lib/shared/rubricJudge.ts`, `evolution/src/services/judgeRubricActions.ts`, `evolution/src/services/criteriaActions.ts`, `evolution/src/lib/judgeEval/*`, and `evolution/src/lib/shared/computeRatings.ts` to confirm the integration seams before planning.)
