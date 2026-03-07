# Evolution Dash UI Cleanup Research

## Problem Statement
The evolution dashboard UI has grown complex with many scattered pages, inconsistent navigation, and features like the Explorer tab that add complexity without sufficient value. The side navigation needs restructuring around entities (Experiments, Prompts, Strategies, Runs, Agent Invocations, Variants) with a consistent list/detail pattern. Several naming inconsistencies ("Hall of Fame" vs "Arena", "Rating Optimization" vs "Analysis") need resolution, and detail pages need consolidation into a consistent directory structure.

## Requirements (from GH Issue #640)
- [ ] Deprecate explorer tab and all related code - it's too complex and not needed
- [ ] Rename Hall of Fame in UI to "Arena"
- [ ] Side nav reordering
    - Dashboard
    - Analysis -> renamed from "rating optimization", with "experiments" tab removed (see next bullet)
    - Start Experiment section pulled out of (existing ratings > experiments)
- [ ] Entities reframing
    - [ ] New section of side nav focused on entities with pattern
        - [ ] Have overview page listing all of that thing
        - [ ] Clicking in shows detail view of that thing
    - [ ] Move all detail pages to same code directory so easier to track
        - [ ] Make sure detail pages are clearly labeled and have URL reflecting this
    - [ ] Help draw up a plan with wireframes for how to do this
- [ ] Entities section
    - Experiments - add experiment detail section - grab this from existing section
    - Prompts - use existing
    - Strategies - use existing
    - Runs - from pipeline runs
        - Remove everything except the table of runs, page title, and filters
        - Show just the table of runs
    - Agent Invocations - see if has existing detail view
    - Variants - see if has existing detail view

## High Level Summary

15 pages exist across the evolution admin section. Pages are scattered across different directories with inconsistent URL patterns. Several entities lack either an overview or detail page. The Explorer page is the most complex and least used — it should be deprecated.

## Entity Page Inventory

| Entity | Overview Page? | Overview Route | Detail Page? | Detail Route | Detail Code Location |
|--------|---------------|----------------|--------------|--------------|---------------------|
| **Experiments** | No (tab in optimization) | `/admin/quality/optimization` | Yes | `/admin/quality/optimization/experiment/[experimentId]` | `src/app/admin/quality/optimization/experiment/[experimentId]/` |
| **Prompts** | Yes | `/admin/quality/prompts` | **No** | — | — |
| **Strategies** | Yes | `/admin/quality/strategies` | Yes | `/admin/quality/strategies/[strategyId]` | `src/app/admin/quality/strategies/[strategyId]/` |
| **Runs** | Yes (overloaded) | `/admin/quality/evolution` | Yes | `/admin/quality/evolution/run/[runId]` | `src/app/admin/quality/evolution/run/[runId]/` |
| **Agent Invocations** | **No** | — | Yes | `/admin/quality/evolution/invocation/[invocationId]` | `src/app/admin/quality/evolution/invocation/[invocationId]/` |
| **Variants** | **No** | — | Yes | `/admin/quality/evolution/variant/[variantId]` | `src/app/admin/quality/evolution/variant/[variantId]/` |
| **Arena Topics** | Yes | `/admin/quality/arena` | Yes | `/admin/quality/arena/[topicId]` | `src/app/admin/quality/arena/[topicId]/` |

### Current Sidebar Structure (EvolutionSidebar.tsx)

```
Overview
  📊 Dashboard               → /admin/evolution-dashboard

Runs
  🔄 Pipeline Runs            → /admin/quality/evolution

Analysis
  🔍 Explorer                 → /admin/quality/explorer        ← TO DEPRECATE
  🎯 Rating Optimization      → /admin/quality/optimization

Reference
  📝 Prompts                  → /admin/quality/prompts
  🧪 Strategies               → /admin/quality/strategies
  📚 Arena                    → /admin/quality/arena
```

### Gaps for Entity-Centric Redesign

1. **Experiments** — no standalone overview page (buried as tab in optimization page)
2. **Prompts** — no detail page at all
3. **Runs overview** — overloaded with queue card, variant panel, cost/quality charts (need to strip to just table + filters)
4. **Agent Invocations** — no overview/list page (detail only, linked from run timeline)
5. **Variants** — no overview/list page (detail only, linked from run variants tab)
6. **Detail pages scattered** — 6 different directory trees for detail pages

### Pages to Deprecate/Remove
- `/admin/quality/explorer` — Explorer page and all related code (`unifiedExplorerActions.ts`, explorer components)

### Naming Inconsistencies Found
- "Rating Optimization" → should be "Analysis"
- Sidebar already says "Arena" but the code/docs still reference "Hall of Fame" in places

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md — Page routes, component inventory, server actions
- evolution/docs/evolution/arena.md — Arena pages and actions
- evolution/docs/evolution/data_model.md — Core entities and relationships
- evolution/docs/evolution/README.md — Navigation overview
- evolution/docs/evolution/architecture.md — Pipeline orchestration
- evolution/docs/evolution/strategy_experiments.md — Experiment UI and detail page
- evolution/docs/evolution/cost_optimization.md — Optimization dashboard tabs
- evolution/docs/evolution/reference.md — Key files index, all page routes
- evolution/docs/evolution/entity_diagram.md — Entity relationships and detail page routes
- docs/docs_overall/design_style_guide.md — Design tokens and component patterns

## Code Files Read
- `src/components/admin/EvolutionSidebar.tsx` — Current sidebar nav groups
- `src/components/admin/SidebarSwitcher.tsx` — Routes to EvolutionSidebar for quality paths
- `src/app/admin/quality/evolution/page.tsx` — Runs overview (overloaded)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — Variant detail
- `src/app/admin/quality/evolution/invocation/[invocationId]/page.tsx` — Invocation detail
- `src/app/admin/quality/arena/page.tsx` — Arena topics list
- `src/app/admin/quality/arena/[topicId]/page.tsx` — Arena topic detail
- `src/app/admin/quality/strategies/page.tsx` — Strategies list
- `src/app/admin/quality/strategies/[strategyId]/page.tsx` — Strategy detail
- `src/app/admin/quality/prompts/page.tsx` — Prompts list (no detail page)
- `src/app/admin/quality/optimization/page.tsx` — Optimization dashboard with experiments tab
- `src/app/admin/quality/optimization/experiment/[experimentId]/page.tsx` — Experiment detail
- `src/app/admin/quality/explorer/page.tsx` — Explorer (to deprecate)
- `src/app/admin/evolution-dashboard/page.tsx` — Dashboard overview

## Open Questions
1. Should Agent Invocations and Variants get new overview/list pages, or remain detail-only (linked from Runs)?
2. Should Prompts get a detail page, or is the list view with inline editing sufficient?
3. Where should the "Start Run" / queue functionality live after simplifying the Runs page?
4. Should the run compare page (`/run/[runId]/compare`) stay as a sub-route or become its own entity?
