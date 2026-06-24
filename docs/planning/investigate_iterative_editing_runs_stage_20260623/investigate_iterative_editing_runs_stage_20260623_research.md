[//]: # (Research doc for understanding iterative-editing agent edit-proposal/acceptance telemetry and tuning prompts to elicit more proposed edits.)

# Investigate Iterative Editing Runs (Stage) Research

## Problem Statement
Understand and improve the behavior of the iterative-editing-class agents on staging — specifically how many edits each propose vs. how many the approver accepts — and then change the system so both flavors of these agents (the multi-cycle `IterativeEditingAgent` and the single-cycle `ProposerApproverCriteriaGenerateAgent`) propose more edits per cycle.

## Requirements (from GH Issue #1280)
- Understand how many edits are proposed vs. accepted in logging
- Encourage both types of agents to propose more edits

## High Level Summary
_To be populated during /research._

Open questions to investigate:
- Where in `execution_detail` is per-cycle proposed-vs-accepted edit count surfaced today? (`cycles[i].proposedGroupsRaw` vs accepted groups; `iterative_edit_accept_rate` metric exists with a rubber-stamp upper-bound alert at 0.95 — is there a *lower-bound* signal for "proposer is being too timid"?)
- What's the current distribution of `groupCount` per cycle on recent staging runs for both `iterative_editing` and `proposer_approver_criteria_generate`?
- What controls "how many edits" the proposer emits today? (`editingProposerSoftCap` for `iterative_editing_rewrite`, default soft-cap behavior elsewhere, proposer system prompt's "prefer one-sentence edits" wording, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5`, `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`.)
- Does the proposer system prompt currently bias *down* (e.g. "prefer one-sentence edits"), and would relaxing/inverting that wording move the proposed-count distribution up without breaking guardrails (size-ratio, length cap, drift)?
- How is the "accepted" count surfaced for `proposer_approver_criteria_generate`'s strict-binary aggregator (`(forward, mirror) === ('accept', 'reject')` ⇒ APPLY)? Is the "proposed" count equivalent across both agent types?
- Are the operational health metrics (`iterative_edit_drift_rate`, `iterative_edit_recovery_success_rate`, `iterative_edit_accept_rate`) currently visible per-strategy in the admin UI? Should a "proposed_per_cycle" sibling metric be added?

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

### Relevant Docs (tagged in _status.json)
- evolution/docs/architecture.md
- evolution/docs/agents/overview.md
- evolution/docs/editing_agents.md
- evolution/docs/criteria_agents.md
- evolution/docs/logging.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/paragraph_recombine_with_coherence_pass.md
- evolution/docs/cost_optimization.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/reference.md
- evolution/docs/data_model.md
- evolution/docs/prompt_editor.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/variant_lineage.md
- evolution/docs/arena.md
- evolution/docs/curriculum.md
- evolution/docs/implicit_rubric_weights.md
- evolution/docs/evolution_metrics.md
- evolution/docs/metrics.md
- evolution/docs/visualization.md
- evolution/docs/minicomputer_deployment.md
- docs/feature_deep_dives/ai_suggestions_overview.md
- docs/feature_deep_dives/writing_pipeline.md
- docs/feature_deep_dives/markdown_ast_diffing.md

## Code Files Read
_To be populated during /research._
