# Brainstorm New Agents With Reflection Research

## Problem Statement
Come up with new agent types for the evolution pipeline that leverage reflection (a meta-cognitive pattern where an agent reviews its own or another agent's output and proposes improvements). Note how well reflection-style agents have performed in recent analyses. The deliverable is a slate of candidate new agent designs grounded in what the data already says about reflection's strengths and failure modes.

## Requirements (from GH Issue #NNN)
Same as summary — come up with new agent types that leverage reflection. Note how well reflection agents performed in recent analyses performed.

## High Level Summary
_To be populated during /research._

### Reflection in the pipeline today (initial scan)
- **`reflect_and_generate`** — the only first-class "reflection" agent. One reflection LLM call picks the best of 24 tactics for the parent article (sees parent text + recent Elo boost per tactic), then delegates to `GenerateFromPreviousArticleAgent.execute()` with the chosen tactic.
- Reflection-adjacent generate-then-critique-then-apply patterns also exist: `criteria_and_generate` (1 combined eval+suggest LLM call → GFPA), `single_pass_evaluate_criteria_and_generate` (same shape + guardrails), `proposer_approver_criteria_generate` (single-cycle propose / forward-approve / mirror-approve / strict-binary aggregate), `iterative_editing` (N propose-review-apply cycles), and `paragraph_recombine_with_coherence_pass` Phase C (a bounded propose-review-apply loop on the recombined article).

### Recent analyses to lean on
- **elo-agent-comparison-federal-reserve-2-20260628** (today) — `reflect_and_generate` is the only arm that leads on every metric: median max-lift +165 Elo, P(best) 96%, %impr≥40 90%, %var>seed 94%. But +34 Elo over `generate` has 95% CI [−6, +78], Holm p=0.23 at n=10 → likely-best, not proven. Per-variant density ranking flips the ceiling order: reflect > criteria-style arms > generate > coherence_pass > paragraph_recombine.
- **coherence-pass-enabled-ab-results-20260627** — Phase C is statistically indistinguishable from no Phase C at n=8/arm (mean Δ within ~0.3 Elo). Multi-dispatch asymmetry + n=8 + an 80% draw-rate judge cap the resolution; an n=30+ paired design with rubric judging would distinguish "neutral" from "unmeasurable."
- **coherence-pass-perf-ab-results-20260624** — predecessor experiment: Phase C looked FAIL by decision rule, but deep dive found the proposer (`gemini-2.5-flash-lite`) emits clean rewritten articles instead of CriticMarkup in ~93% of invocations under Mode A. Root cause was a Mode A/B mismatch, not a Phase C capability gap.

These three datapoints already imply two design moves: (1) reflection that *selects* among predefined moves works (reflect_and_generate); (2) reflection that *authors free-form edits* needs Mode B (rewrite-then-diff) — Mode A asks the wrong output shape of weaker models.

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

### Evolution Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/agents/overview.md (partial — reflection + criteria + iterative_editing sections)
- evolution/docs/paragraph_recombine_with_coherence_pass.md

### Analyses (most recent, reflection-relevant)
- docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/elo-agent-comparison-federal-reserve-2-20260628.md
- docs/analysis/coherence-pass-enabled-ab-results-20260627/coherence-pass-enabled-ab-results-20260627.md
- docs/analysis/coherence-pass-perf-ab-results-20260624/coherence-pass-perf-ab-results-20260624.md

### Relevant Docs (queued for /research)
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/metrics.md
- evolution/docs/cost_optimization.md
- evolution/docs/reference.md
- docs/feature_deep_dives/judge_evaluation.md
- docs/feature_deep_dives/iterative_planning_agent.md
- docs/feature_deep_dives/style_fingerprint.md

## Code Files Read
_To be populated during /research._
