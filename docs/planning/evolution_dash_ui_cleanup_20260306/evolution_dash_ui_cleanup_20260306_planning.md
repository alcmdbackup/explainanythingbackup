# Evolution Dash UI Cleanup Plan

## Background
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

## Problem

The evolution admin section has 15 pages scattered across 6 different directory trees with inconsistent URL patterns. The sidebar groups pages by function (Overview, Runs, Analysis, Reference) rather than by entity, making it hard to find related pages. The Explorer page adds complexity without clear value. The Runs page is overloaded with a queue card, variant panel, and charts when it should just be a table. Experiments are buried as a tab inside the optimization page rather than being a first-class entity.

## New Sidebar Structure (Wireframe)

```
┌─────────────────────────────┐
│ ← Back to Admin             │
│                             │
│ Evolution Dashboard         │
│ ─────────────────────────── │
│                             │
│ 📊 Dashboard                │
│ 📈 Analysis                 │
│ 🧪 Start Experiment         │
│                             │
│ ENTITIES                    │
│ ─────────────────────────── │
│ 🔬 Experiments              │
│ 📝 Prompts                  │
│ ⚙️  Strategies               │
│ 🔄 Runs                     │
│ 🤖 Invocations              │
│ 📄 Variants                 │
│                             │
│ RESULTS                     │
│ ─────────────────────────── │
│ 🏟️  Arena                    │
│                             │
└─────────────────────────────┘
```

## New URL Structure

All entity pages consolidated under `/admin/evolution/`:

| Entity | List Route | Detail Route | Code Directory |
|--------|-----------|--------------|----------------|
| Experiments | `/admin/evolution/experiments` | `/admin/evolution/experiments/[id]` | `src/app/admin/evolution/experiments/` |
| Prompts | `/admin/evolution/prompts` | `/admin/evolution/prompts/[id]` | `src/app/admin/evolution/prompts/` |
| Strategies | `/admin/evolution/strategies` | `/admin/evolution/strategies/[id]` | `src/app/admin/evolution/strategies/` |
| Runs | `/admin/evolution/runs` | `/admin/evolution/runs/[id]` | `src/app/admin/evolution/runs/` |
| Invocations | `/admin/evolution/invocations` | `/admin/evolution/invocations/[id]` | `src/app/admin/evolution/invocations/` |
| Variants | `/admin/evolution/variants` | `/admin/evolution/variants/[id]` | `src/app/admin/evolution/variants/` |

Results pages:
| Page | List Route | Detail Route | Code Directory |
|------|-----------|--------------|----------------|
| Arena | `/admin/evolution/arena` | `/admin/evolution/arena/[id]` | `src/app/admin/evolution/arena/` |

Non-entity pages:
| Page | Route | Code Directory |
|------|-------|----------------|
| Dashboard | `/admin/evolution-dashboard` | `src/app/admin/evolution-dashboard/` (keep) |
| Analysis | `/admin/evolution/analysis` | `src/app/admin/evolution/analysis/` |
| Start Experiment | `/admin/evolution/start-experiment` | `src/app/admin/evolution/start-experiment/` |
| Run Compare | `/admin/evolution/runs/[id]/compare` | sub-route of run detail |

## Entity List → Detail Wireframes

### Runs List (simplified from current overloaded page)
```
┌──────────────────────────────────────────────────────────┐
│ Runs                                          [Refresh]  │
│                                                          │
│ Status: [All ▾]  Date: [30d ▾]                          │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ID      Status     Prompt    Strategy  Elo   Cost    │ │
│ │ abc123  completed  quantum   balanced  1847  $2.31   │ │ → click → /runs/abc123
│ │ def456  running    blockchain economy  —     $0.89   │ │
│ │ ghi789  failed     genetics  quality   —     $4.12   │ │
│ │ ...                                                   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Experiments List (extracted from optimization tab)
```
┌──────────────────────────────────────────────────────────┐
│ Experiments                                   [Refresh]  │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ID      Status     Prompt     Runs  Budget  Created  │ │
│ │ exp01   completed  quantum    8/8   $40     2d ago   │ │ → click → /experiments/exp01
│ │ exp02   running    blockchain 3/8   $15     1h ago   │ │
│ │ ...                                                   │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ (ExperimentHistory component, repurposed)                │
└──────────────────────────────────────────────────────────┘
```

### Invocations List (new)
```
┌──────────────────────────────────────────────────────────┐
│ Agent Invocations                             [Refresh]  │
│                                                          │
│ Run: [All ▾]  Agent: [All ▾]                            │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ID      Run     Agent        Iter  Cost   Status     │ │
│ │ inv01   abc123  generation   3     $0.12  success    │ │ → click → /invocations/inv01
│ │ inv02   abc123  tournament   3     $0.34  success    │ │
│ │ ...                                                   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Variants List (new)
```
┌──────────────────────────────────────────────────────────┐
│ Variants                                      [Refresh]  │
│                                                          │
│ Run: [All ▾]  Agent: [All ▾]                            │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ID      Run     Agent       Elo    Winner  Created   │ │
│ │ var01   abc123  generation  1847   ✓       2d ago    │ │ → click → /variants/var01
│ │ var02   abc123  evolution   1790           2d ago    │ │
│ │ ...                                                   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Options Considered

### URL structure
1. **`/admin/evolution/*`** (chosen) — Clean, all evolution under one prefix. Requires moving pages but gives a fresh start.
2. **`/admin/quality/*`** (current) — Keep existing paths, just reorganize sidebar. Less disruption but perpetuates the confusing "quality" prefix.

Option 1 chosen because the "quality" prefix is confusing and this is a good opportunity to clean up.

### How to handle the "Start Run" queue functionality
1. **Keep on Runs page as a button/dialog** — Simple, keeps queue near runs table
2. **Move to Dashboard** — Makes dashboard the action hub
3. **Pull into its own sidebar item** — Matches "Start Experiment" pattern

Decision: Keep "Start Run" as a button on the Runs list page that opens a dialog. It's the most natural place.

### Invocations & Variants list pages
Decision: Build list pages as part of this project. All entities need both overview and detail pages for consistency.

## Phased Execution Plan

### Phase 1: Foundation — New route structure + sidebar
**Goal:** New `/admin/evolution/` route tree, updated sidebar, deprecate explorer

1. Create new directory structure under `src/app/admin/evolution/`
2. Move existing pages to new routes (keeping old routes as redirects temporarily):
   - `quality/evolution` → `evolution/runs` (strip down to table + filters only)
   - `quality/strategies` → `evolution/strategies`
   - `quality/strategies/[strategyId]` → `evolution/strategies/[strategyId]`
   - `quality/prompts` → `evolution/prompts`
   - `quality/arena` → `evolution/arena`
   - `quality/arena/[topicId]` → `evolution/arena/[topicId]`
   - `quality/evolution/run/[runId]` → `evolution/runs/[runId]`
   - `quality/evolution/run/[runId]/compare` → `evolution/runs/[runId]/compare`
   - `quality/evolution/variant/[variantId]` → `evolution/variants/[variantId]`
   - `quality/evolution/invocation/[invocationId]` → `evolution/invocations/[invocationId]`
   - `quality/optimization` → `evolution/analysis` (rename, remove experiments tab)
   - `quality/optimization/experiment/[experimentId]` → `evolution/experiments/[experimentId]`
3. Update `EvolutionSidebar.tsx` with new nav groups, routes, and `activeOverrides` for `/admin/evolution/runs` prefix
4. Update `SidebarSwitcher.tsx`: add `pathname.startsWith('/admin/evolution/')` to `isEvolutionPath` check (keep `/admin/quality` matching during transition)
5. Delete `quality/explorer/page.tsx`
6. Update `evolutionUrls.ts` URL builders — update all `build*Url` functions, remove `buildExplorerUrl` and `ExplorerUrlFilters`, update/remove `buildPromptUrl` alias (currently points to arena topic), remove dead `buildArticleUrl`
7. **Grep-and-fix hardcoded `/admin/quality/` URLs** across all component files. Known files with hardcoded URLs that bypass URL builders:
   - `evolution/src/components/evolution/tabs/TimelineTab.tsx` (lines ~674, ~712)
   - `evolution/src/components/evolution/agentDetails/shared.tsx` (line ~80)
   - `evolution/src/components/evolution/VariantsTab.tsx` (line ~132)
   - `evolution/src/components/evolution/RunsTable.tsx` (line ~257)
   - `src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx`
   - `src/app/admin/evolution-dashboard/page.tsx` (~3 hardcoded links)
   - `src/app/admin/quality/evolution/run/[runId]/error.tsx` (hardcoded fallback URL)
   - Run `grep -r '/admin/quality/' evolution/src/components/ src/app/admin/` to catch any others
   - Note: supplementary route files (error.tsx, loading.tsx) must also be moved and their hardcoded URLs updated
8. Add Next.js redirects in `next.config.ts` **immediately** for all old routes → new routes. Note: `next.config.ts` currently has no `redirects` block — add a new `async redirects()` function. Example:
   ```ts
   async redirects() {
     return [
       { source: '/admin/quality/evolution/run/:path*', destination: '/admin/evolution/runs/:path*', permanent: true },
       { source: '/admin/quality/evolution', destination: '/admin/evolution/runs', permanent: true },
       // ... all other route mappings
     ];
   }
   ```
   Do NOT defer to Phase 4 — redirects must go live with the route moves to avoid broken bookmarks/links.
9. Lint, tsc, build, test

### Phase 2: Experiments standalone + Start Experiment page
**Goal:** Pull experiments out of optimization tab into standalone entity

1. Create `evolution/experiments/page.tsx` — list page using `ExperimentHistory` component
2. Create `evolution/start-experiment/page.tsx` — uses `ExperimentForm` + `ExperimentStatusCard`
3. Move experiment detail components from `quality/optimization/experiment/[experimentId]/` to `evolution/experiments/[experimentId]/`
4. Remove "Experiments" tab from Analysis page
5. Lint, tsc, build, test

### Phase 3: Simplify Runs page + new list/detail pages
**Goal:** Strip runs page down to just table + filters; add missing list and detail pages

1. Remove from runs page:
   - Start Run card (move queue to button + dialog)
   - Variant preview panel
   - Cost/quality charts
2. Keep: page title, status/date filters, runs table, refresh button
3. Create new server actions for cross-run listing (existing actions are run-scoped):
   - `listInvocationsAction(filters?)` in `evolutionVisualizationActions.ts` — query `evolution_agent_invocations` with optional run/agent/status filters, pagination (limit/offset). Validate inputs with Zod (UUID for runId, enum for agent/status, z.number().int().min(0).max(100) for limit, z.number().int().min(0) for offset)
   - `listVariantsAction(filters?)` in `evolutionActions.ts` — query `evolution_variants` with optional run/agent/winner filters, pagination (limit/offset). Same Zod validation pattern
   - Both must include `requireAdmin()` + `withLogging` pattern, following existing patterns in their respective files
4. Create `evolution/invocations/page.tsx` — list page with run/agent filters, uses `listInvocationsAction`
5. Create `evolution/variants/page.tsx` — list page with run/agent filters, uses `listVariantsAction`
5. Create `evolution/prompts/[promptId]/page.tsx` — detail page showing prompt metadata, run history (via `getPromptRunsAction`), linked experiments, and arena topic entries
6. Lint, tsc, build, test

### Phase 4: Naming cleanup + old route removal
**Goal:** Fix all naming, remove old route directories

1. Rename "Rating Optimization" → "Analysis" in breadcrumbs, titles, sidebar
2. Ensure "Arena" naming is consistent everywhere (no "Hall of Fame" in UI — grep for "hall of fame" in UI code and test descriptions)
3. Remove old `/admin/quality/*` route directories (redirects already in place from Phase 1)
4. Lint, tsc, build, test

### Phase 5: Cleanup + documentation
**Goal:** Remove dead code, update docs

1. Delete `unifiedExplorerActions.ts` and any explorer-only components
2. Update all evolution docs with new routes and sidebar structure
3. Update `evolutionUrls.ts` helpers
4. Final lint, tsc, build, full test suite

## Testing

### Unit tests to update (route changes)
- `src/components/admin/EvolutionSidebar.test.tsx` — update 5 hardcoded `/admin/quality/` hrefs and testId assertions
- `src/components/admin/SidebarSwitcher.test.tsx` — update 6 path assertions, add edge case for `/admin/evolution-dashboard` not matching `/admin/evolution/` prefix
- `evolution/src/lib/utils/evolutionUrls.test.ts` — update all URL assertions from `/admin/quality/` to `/admin/evolution/`, delete `buildExplorerUrl` test suite (5 cases)
- `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — update hardcoded URL assertions
- `evolution/src/components/evolution/VariantDetailPanel.test.tsx` — update URL assertions
- `evolution/src/components/evolution/variant/VariantOverviewCard.test.tsx` — update URL assertions
- `evolution/src/components/evolution/variant/VariantMatchHistory.test.tsx` — update mocked `buildVariantDetailUrl` return values
- `evolution/src/components/evolution/agentDetails/shared.test.tsx` — update URL assertions
- `evolution/src/components/evolution/EvolutionBreadcrumb.test.tsx` — update route assertions
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.test.tsx` — update mocked `buildRunUrl` returns
- `src/app/admin/quality/optimization/_components/ExperimentHistory.test.tsx` — update route assertions
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.test.tsx` — update route assertions
- `src/app/admin/evolution-dashboard/page.test.tsx` — update 3 hardcoded `/admin/quality/` URL assertions
- Note: all co-located test files under `src/app/admin/quality/` (ExperimentForm.test.tsx, ExperimentDetailTabs.test.tsx, ExperimentAnalysisCard.test.tsx, ReportTab.test.tsx, StrategyConfigDisplay.test.tsx, CostAccuracyPanel.test.tsx, runFormUtils.test.ts, etc.) must move alongside their page files during Phase 1-2

### Unit tests to delete
- `evolution/src/services/unifiedExplorerActions.test.ts`
- `evolutionUrls.test.ts` — `buildExplorerUrl` test suite (5 cases)

### Unit tests to write (new pages)
- `evolution/invocations/page.test.tsx` — list rendering, filters, pagination, click-through to detail
- `evolution/variants/page.test.tsx` — list rendering, filters, pagination, click-through to detail
- `evolution/experiments/page.test.tsx` — list rendering, click-through to detail
- `evolution/start-experiment/page.test.tsx` — form rendering, experiment start flow
- `evolution/prompts/[promptId]/page.test.tsx` — detail page rendering with run history
- `listInvocationsAction.test.ts` — new server action with filter/pagination
- `listVariantsAction.test.ts` — new server action with filter/pagination

### E2E tests to update
- `admin-evolution.spec.ts` — update routes; rewrite/remove tests for variant panel and summary cards (being removed from runs page)
- `admin-evolution-visualization.spec.ts` — update routes
- `admin-article-variant-detail.spec.ts` — update routes
- `admin-experiment-detail.spec.ts` — update routes (currently .skip'd but should still be updated)
- `admin-arena.spec.ts` — update 18+ route references from `/admin/quality/arena` and `/admin/quality/evolution/run`
- `admin-elo-optimization.spec.ts` — update 6 references to `/admin/quality/optimization`
- `admin-strategy-registry.spec.ts` — update 2 references to `/admin/quality/strategies`

### E2E smoke test (new)
- Add redirect smoke test: verify old `/admin/quality/*` URLs 301-redirect to `/admin/evolution/*`

### Manual verification
- Navigate all sidebar links
- Verify all entity list → detail click-through works
- Verify old URLs redirect correctly
- Verify breadcrumbs show correct hierarchy
- Verify active-state highlighting in sidebar for all routes

### Rollback plan
- Old route directories are kept until Phase 4 — if issues arise, revert sidebar changes and old pages still work
- Next.js redirects in `next.config.ts` can be removed to restore old routes
- Feature can be deployed incrementally: Phase 1 (routes + redirects) can ship alone and be validated before Phases 2-5

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Update page routes, navigation structure, component references
- `evolution/docs/evolution/arena.md` - Update Hall of Fame -> Arena naming, route references
- `evolution/docs/evolution/data_model.md` - Update page route references
- `evolution/docs/evolution/README.md` - Update navigation and page references
- `evolution/docs/evolution/strategy_experiments.md` - Update experiment UI references, new standalone page
- `evolution/docs/evolution/cost_optimization.md` - Update dashboard tab references, "Analysis" rename
- `evolution/docs/evolution/reference.md` - Update key files, page routes, admin UI section
- `evolution/docs/evolution/entity_diagram.md` - Update detail page references
