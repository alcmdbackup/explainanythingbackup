# Standardize List Detail Views Evolution Dash Research

## Problem Statement
The evolution dashboard has grown organically with 6 entity types (Experiment, Prompt, Strategy, Run, Agent Invocation, Variant), each with their own list and detail views built independently. This has led to inconsistent UI patterns, duplicated code, and no cross-linking between related entities. The goal is to standardize all list/detail views with shared components, add entity relationship headers with cross-links (per the entity diagram), and ensure metrics are prominently displayed across all views.

## Requirements (from GH Issue #NNN)
1. **Shared List Component**: Create a reusable list/table component used by all 6 entity list views (experiments, prompts, strategies, runs, invocations, variants) with consistent filtering, sorting, pagination, and empty states
2. **Shared Detail Header Component**: Create a reusable detail page header that shows:
   - Entity name/title and status badge
   - Cross-links to all related entities based on the entity relationship diagram:
     - Experiment → Prompt, Runs
     - Prompt → Experiments, Runs
     - Strategy → Runs
     - Run → Experiment, Prompt, Strategy, Invocations, Variants
     - Agent Invocation → Run, Variants produced
     - Variant → Run, Parent Variant, Child Variants
   - Key metrics for that entity prominently displayed
3. **Metrics Display**: Each entity's list and detail view should prominently display relevant metrics:
   - Experiment: total runs, completed count, total spend, best Elo
   - Prompt: run count, avg Elo, best Elo, difficulty tier
   - Strategy: run count, avg Elo, cost efficiency (Elo/$), agent selection
   - Run: status, cost, iteration count, winner Elo, variant count
   - Agent Invocation: agent type, cost, duration, variants produced, Elo delta
   - Variant: Elo rating, parent lineage depth, is_winner status, agent creator
4. **Consistent Styling**: Use design system tokens (Midnight Scholar theme) consistently across all views
5. **Breadcrumb Navigation**: Ensure EvolutionBreadcrumb covers all entity pages consistently
6. **Empty/Loading States**: Use shared TableSkeleton and EmptyState components across all list views

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/entity_diagram.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read
- [list of code files reviewed]
