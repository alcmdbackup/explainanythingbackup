# Fix UX Bugs Judge Lab Agreement Research

## Problem Statement
Fix UX issues and bugs surfaced while using the Judge Lab Agreement sweep tool (rubric ↔ holistic agreement mode at `/admin/evolution/judge-lab/agreement`). Improve in-context explanations of sweep knobs (`repeats`, judging temperature default) and metric labels (`per-rep`, `both-dec`, `abstain`), make pre-flight cost preview use the existing cost-estimation infrastructure, and build a detail/drill-down view that surfaces individual matches with per-criterion agreement vs. the holistic verdict. Add a summary view that aggregates forward vs. reverse pass agreement and per-criterion disagreement rates against the holistic assessment.

## Requirements (from GH Issue #NNN)
- Explain more clearly in UI/UX what "repeats" does
- Preview cost accurately using pre-existing infrastructure
- What is the best judging temperature? Do we have a default to advise?
- Build a detail view that allows you to view the results in much more detail - e.g. individual matches, which criteria agreed vs. didn't with overall
- Compute useful summary view that shows how often we had forward vs. reverse pass for holistic vs. criteria runs agreeing, how often individual criteria disagreed with wholistic assessment, etc
- Clearly explain what "per-rep", "both-dec" and "abstain" mean

## High Level Summary
TBD — populate during `/research` phase. Key research targets:
- Locate the Agreement launcher + run-detail pages (`src/app/admin/evolution/judge-lab/agreement/**`) and identify the current `repeats` / temperature / cost-preview affordances.
- Read the agreement reducer (`computeAgreementMetrics` in `evolution/src/lib/judgeEval/agreementMetrics.ts`) to understand what `per-rep`, `both-dec`, and `abstain` mean in the data model, so the UI tooltips/labels stay faithful to the metric definitions.
- Read `evolution/src/services/judgeEvalActions.ts::createAgreementSweepAction` and the pre-flight cap (`assertWithinJudgeEvalCap`) to understand the existing cost estimation surface — the goal is to reuse `JUDGE_EVAL_MAX_USD`/`MAX_CALLS` plumbing for the new in-UI cost preview rather than rolling a new estimator.
- Find the current judge-eval results-detail surface (the per-(pair × repeat) match-history sub-route exists for regular sweeps at `/admin/evolution/judge-lab/runs/[evalRunId]/matches`); the parallel "agreement matches" view is what we need to build (paginated `judge_eval_agreement_calls` + lazy criterion-verdict expansion via `judge_eval_agreement_criterion_verdicts`).
- Survey staging `judge_eval_agreement_calls` / `_criterion_verdicts` data to decide which temperature defaults to recommend (likely 0.0 mirroring the production judge path; verify against `docs/analysis/judge_agreement_summary_tables.md` if relevant).

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

### Relevant Docs (discovered for this project)
- docs/feature_deep_dives/judge_evaluation.md — Judge Lab feature deep dive (test sets, sweeps, agreement-sweep tables, leaderboard, admin pages)
- evolution/docs/implicit_rubric_weights.md — closest analog tool; reuses 2-pass + cost-cap pattern; auto-mode UX hints
- evolution/docs/rating_and_comparison.md — rubric-based judging, `buildRubricComparisonPrompt`, `parseRubricVerdict`, 2-pass reversal, judge agreement research note
- evolution/docs/visualization.md — `/admin/evolution/judge-lab/**` route inventory and shared components (`EntityListPage`, `EntityDetailTabs`, `MetricGrid`)
- evolution/docs/cost_optimization.md — `assertWithinJudgeEvalCap`, `JUDGE_EVAL_MAX_USD`, `calculateLLMCost` — what to reuse for the cost preview
- evolution/docs/criteria_agents.md — criteria/rubric dimensions context; `evolution_criteria` + `evolution_judge_rubrics` relationship
- evolution/docs/data_model.md — `judge_eval_agreement_runs` / `judge_eval_agreement_calls` / `judge_eval_agreement_criterion_verdicts` schema and the leaderboard VIEW
- evolution/docs/metrics.md — `decisive_rate` definition (`confidence > 0.6`), invocation/run metric registry
- evolution/docs/strategies_and_experiments.md — confidence/agreement framing (bootstrap CI patterns we can mirror)
- evolution/docs/architecture.md — V2 pipeline context (orientation)
- evolution/docs/arena.md — match-data origin context
- evolution/docs/entities.md — admin-UI entity registry shape
- evolution/docs/reference.md — file index + env vars (`JUDGE_EVAL_*`)
- evolution/docs/README.md — evolution doc map

## Code Files Read
- (to be populated during `/research`)
