# Enable Side-By-Side Variant Comparisons vs Parent Research

## Problem Statement
The variant detail view should allow a simple way to view the diff between a variant and its parent variant, both for explanation-level (article) variants and paragraph-level variants (which are created specifically by paragraph recombine).

## Requirements (from GH Issue #1153)
Variant detail view should allow simple way to view diff between a variant and its parent variant, both for explanation level and paragraph level variants (which are created specifically by paragraph recombine).

(Description: same as summary.)

## High Level Summary
Much of the diffing infrastructure already exists but is not surfaced as a "simple" top-level affordance on the variant detail page, and paragraph-level (`variant_kind='paragraph'`) variants are not first-class in the variant detail view.

Existing building blocks found during research:
- **`TextDiff` component** (`evolution/src/components/evolution/visualizations/TextDiff.tsx`) — already renders inline text diffs and is reused across the lineage UI.
- **`VariantLineageSection`** (`evolution/src/components/evolution/variant/VariantLineageSection.tsx`) — already shows a collapsed `TextDiff` between consecutive chain nodes AND a "Compare any two in this chain" From/To pair picker. This is article/explanation-level and lives on the Lineage tab.
- **`get_variant_full_chain(target_variant_id)` RPC** + `getVariantFullChainAction` (`evolution/src/services/variantDetailActions.ts`) — walks `parent_variant_ids[1]` (PG 1-indexed primary parent) to the root, cycle-guarded, 20-hop cap. Linear-walk only follows the primary parent.
- **`VariantParentBadge`** — renders `Parent #abc · elo · Δ` (or `Seed · no parent`), used in the detail header and lineage.
- **Variant detail page** — `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` + `page.tsx`; tabs include full prompt text, metrics, lineage context, Matches.

Key gaps / open questions for planning:
1. **Discoverability** — a parent↔child diff exists only inside the Lineage tab pair-picker (article variants). The ask is a *simple* affordance, likely a default/top-level "Diff vs parent" view on the variant detail page.
2. **Paragraph-level variants** — `variant_kind='paragraph'` rewrites have `parent_variant_ids = [originalSlotVariantId]` (the slot's original-paragraph variant); the original itself is parentless. The variants list default-hides paragraph snippets (Kind dropdown), and `get_variant_full_chain` follows `parent_variant_ids[1]` (article primary parent) — need to confirm whether paragraph variants render a usable detail page + parent diff today.
3. **Lineage semantics** — `parent_variant_ids[0]` is the canonical primary parent for multi-parent (debate) article variants; the chain walker uses index `[1]` (1-indexed = [0]). The "vs parent" diff should target the primary parent consistently.
4. **Paragraph slot context** — paragraph slot rewrites are also surfaced via `SlotsTab`/`RecombinedOutputTab` on the paragraph_recombine *invocation* detail; need to decide whether the variant-detail diff reuses that or the lineage path.

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

### Relevant Docs (all evolution docs read at user request)
- evolution/docs/README.md
- evolution/docs/variant_lineage.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- evolution/docs/architecture.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/agents/overview.md
- evolution/docs/entities.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/editing_agents.md
- evolution/docs/criteria_agents.md
- evolution/docs/cost_optimization.md
- evolution/docs/evolution_metrics.md
- evolution/docs/logging.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md

## Code Files Read
- (confirmed present; to be read in depth during planning)
  - evolution/src/components/evolution/visualizations/TextDiff.tsx
  - evolution/src/components/evolution/variant/VariantLineageSection.tsx
  - evolution/src/components/evolution/variant/VariantParentBadge.tsx
  - evolution/src/services/variantDetailActions.ts
  - src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx
  - src/app/admin/evolution/variants/[variantId]/page.tsx
  - evolution/src/components/evolution/tabs/SlotsTab.tsx
