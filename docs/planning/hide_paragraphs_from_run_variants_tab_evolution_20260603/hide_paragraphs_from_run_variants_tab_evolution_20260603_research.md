# Hide Paragraphs From Run Variants Tab Evolution Research

## Problem Statement
recent recents showing paragraphs in variants tab

## Requirements (from GH Issue #NNN)
Recent runs have been showing paragraph rewrites in run variants tab. Please filter them out

## High Level Summary
`ParagraphRecombineAgent` (rank_individual_paragraphs_evolution_20260525) persists per-slot
paragraph rewrites as `evolution_variants` rows with `variant_kind='paragraph'`. These are
machinery — slot-level building blocks, not article variants the researcher cares about on a run.

The **standalone** variants list (`/admin/evolution/variants`) already defaults to article-only:
it uses the `NON_DISCARDED_OR_FILTER` (`persisted.eq.true,variant_kind.neq.article`) and a Kind
dropdown (Articles only / Paragraph snippets / Both), per data_model.md and visualization.md.

The bug: the **run-detail Variants tab** (`VariantsTab.tsx`, also reused on strategy detail) does
NOT apply the article-only default, so paragraph snippets leak into the run's Variants tab. The fix
is to bring the run/strategy Variants tab in line with the standalone list's article-only default
(ideally reusing the same filter/Kind-dropdown mechanism so behavior stays consistent).

Note (investigate_banner_on_paragraph_rewrite_paragraph_variant_20260531): paragraph variants are
always `persisted=false` by design (written only via `sync_to_arena`, never `finalizeRun`), so a
blanket `persisted=true` filter would WRONGLY hide them as "discarded". The correct gate is
`variant_kind`-aware — `NON_DISCARDED_OR_FILTER` (`persisted.eq.true,variant_kind.neq.article`) and
`isDiscardedGenerateVariant(persisted, variantKind)` in `evolution/src/lib/utils/variantStatus.ts`.

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

### Relevant Docs (all evolution docs read per request)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/cost_optimization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/evolution_metrics.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/reference.md
- evolution/docs/visualization.md  (primary — VariantsTab + variants-list filter semantics)
- evolution/docs/paragraph_recombine.md  (primary — variant_kind='paragraph' provenance)
- evolution/docs/variant_lineage.md  (primary — NON_DISCARDED_OR_FILTER / isDiscardedGenerateVariant)
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/editing_agents.md
- evolution/docs/criteria_agents.md
- evolution/docs/logging.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md

## Code Files Read
- (to be populated during /research — likely
  evolution/src/components/evolution/tabs/VariantsTab.tsx,
  src/app/admin/evolution/variants/page.tsx,
  evolution/src/lib/utils/variantStatus.ts,
  evolution/src/services/variantDetailActions.ts / listVariantsAction)
