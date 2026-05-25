# rank_individual_paragraphs_evolution_20260525 Research

## Problem Statement
I want to think of a plan to improve articles by breaking it up into paragraphs, then rewriting each paragraph, then picking the best versions of each paragraph to recombine.

## Requirements (from GH Issue #NNN)
Use the above Problem Statement as the requirements anchor; specific implementation choices will be brainstormed in `_planning.md` before being finalized.

## High Level Summary
[To be populated during the research phase. Initial hypotheses to verify:
- Paragraph-level evolution is a structurally new agent type (compared to whole-article `generate`, `iterative_editing`, `criteria_and_generate`, `debate_and_generate`) — it decomposes the parent into N paragraph slots, evolves each independently, then recombines.
- Ranking individual paragraphs reuses the existing `compareWithBiasMitigation` + `Rating {elo, uncertainty}` machinery (rating_and_comparison.md), scoped per paragraph slot rather than per article.
- Lineage representation likely needs paragraph-level provenance — multiple paragraph parents merge into one recombined variant, which is structurally similar to the multi-parent pattern that `DebateThenGenerateFromPreviousArticleAgent` introduced (`parent_variant_ids: UUID[]`).
- New iteration type (e.g., `agentType: 'paragraph_recombine'`) plugs into `iterationConfigs[]` per the multi-iteration strategies doc.
- Metrics propagation, format validation (paragraph re-assembly must pass `validateFormat`), and cost attribution all follow the existing patterns from metrics.md and evolution_metrics.md.]

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/criteria_agents.md
- evolution/docs/agents/overview.md
- evolution/docs/editing_agents.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/cost_optimization.md
- evolution/docs/arena.md
- evolution/docs/visualization.md
- evolution/docs/entities.md
- evolution/docs/reference.md (partial)
- evolution/docs/variant_lineage.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/evolution_metrics.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- [list of code files reviewed]
