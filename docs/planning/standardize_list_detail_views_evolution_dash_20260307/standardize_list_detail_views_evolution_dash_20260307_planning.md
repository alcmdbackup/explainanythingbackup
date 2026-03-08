# Standardize List Detail Views Evolution Dash Plan

## Background
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

## Problem
[3-5 sentences describing the problem -- refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Update component list, key files, page descriptions
- `evolution/docs/evolution/architecture.md` - Update if shared component architecture changes data flow
- `evolution/docs/evolution/data_model.md` - Update entity summary table with new detail page routes
- `evolution/docs/evolution/README.md` - Update if new pages/components added
- `evolution/docs/evolution/entity_diagram.md` - Update entity summary table with new detail page info
- `docs/feature_deep_dives/admin_panel.md` - Update routes section, sidebar items, component patterns
