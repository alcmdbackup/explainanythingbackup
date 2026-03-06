# Evolution Run and Invocation Details Research

## Problem Statement
Enhance the evolution run detail page to show a persistent timeline of rounds and agent invocations, add agent invocation detail pages across all agent types, and show before/after article examples with Elo differences on invocation detail pages.

## Requirements (from GH Issue)
- [ ] Evolution run detail page should show timeline of rounds and agents invoked during each round. This should persist even after the round finishes.
- [ ] Clicking into agent invocation should show details page. Make sure we have this across different types of agents
- [ ] Ratings optimization > agent invocations detail pages should show before/after examples of articles and elo differences

## High Level Summary

The evolution run detail page already has a **TimelineTab** that shows iterations and agent invocations with inline expandable detail panels. The timeline persists after runs complete (data from `evolution_agent_invocations` table + checkpoint diffs). However, there is NO before/after text comparison on any agent detail view, and only CalibrationDetail shows rating changes (mu before/after). The project needs to:

1. Verify timeline persistence (already DB-backed — confirmed working)
2. Create a dedicated invocation detail page with before/after text content
3. Add Elo/rating delta displays across all relevant agent detail views
4. Surface hidden data already fetched but not rendered

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/agents/overview.md — Agent framework, ExecutionContext, execution detail tracking
- evolution/docs/evolution/architecture.md — Pipeline orchestration, two-phase invocation lifecycle
- evolution/docs/evolution/reference.md — DB schema, key files, agent invocations table
- evolution/docs/evolution/data_model.md — Core primitives, invocation lifecycle, variant vs explanation
- evolution/docs/evolution/agents/generation.md — GenerationAgent detail structure
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill rating, Elo attribution
- evolution/docs/evolution/visualization.md — Dashboard, tabs, 12 server actions, detail views
- evolution/docs/evolution/README.md — Reading order and document map

## Code Files Read

### Run Detail Page & Timeline
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — 5 tabs (timeline/elo/lineage/variants/logs), auto-refresh
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — BudgetSection + TimelineIterations, inline agent expand with AgentDetailPanel + ExecutionDetailContent
- `evolution/src/services/evolutionVisualizationActions.ts` — 12 actions

### Agent Detail Views (all 12)
- `evolution/src/components/evolution/agentDetails/AgentExecutionDetailView.tsx` — Router, exhaustive switch
- `evolution/src/components/evolution/agentDetails/shared.tsx` — StatusBadge, DetailSection, Metric, CostDisplay, ShortId, DimensionScoresDisplay
- All 12 detail components: Generation, Calibration, Tournament, IterativeEditing, Reflection, Debate, Evolution, SectionDecomposition, TreeSearch, OutlineGeneration, Proximity, MetaReview

### Variant Detail Page & Components
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — Server component, 4 sections
- `evolution/src/components/evolution/variant/VariantContentSection.tsx` — Plain text, 500-char truncation toggle
- `evolution/src/components/evolution/variant/VariantOverviewCard.tsx` — Metadata, Elo, attribution badge
- `evolution/src/components/evolution/variant/VariantLineageSection.tsx` — Parent/children/ancestor chain
- `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` — W/L table from checkpoint
- `evolution/src/services/variantDetailActions.ts` — 5 actions (full detail, parents, children, matches, lineage chain)

### Compare Page (Before/After Pattern)
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — Word-level diff via `diffWordsWithSpace`, StatCards
- Uses `diff` npm package (already in deps), reusable `TextDiff` component

### Variants Tab & Detail Panel
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Table with sparklines, two-level expand
- `evolution/src/components/evolution/VariantDetailPanel.tsx` — Match history, dimension scores, parent diff toggle, text preview (1000 chars)
- `evolution/src/components/evolution/EloSparkline.tsx` — 60x20px Recharts mini-chart
- `evolution/src/components/evolution/AttributionBadge.tsx` — gain±CI with z-score color coding
- `evolution/src/components/evolution/VariantCard.tsx` — Compact card with STRATEGY_PALETTE

### Data Infrastructure
- `supabase/migrations/20260212000001_evolution_agent_invocations.sql` — Table schema
- `evolution/src/lib/core/pipelineUtilities.ts` — Two-phase lifecycle, computeDiffMetrics()
- `evolution/src/lib/types.ts` — All 12 ExecutionDetail interfaces, DiffMetrics
- `evolution/src/lib/core/state.ts` — Checkpoint serialization with full pool[].text
- `evolution/src/lib/core/persistence.ts` — persistVariants() at run finalization only
- `evolution/src/lib/core/rating.ts` — ordinalToEloScale: `clamp(1200 + ordinal * 16, 0, 3000)`
- `evolution/src/lib/utils/evolutionUrls.ts` — URL builders (no invocation URL exists yet)
- `evolution/src/lib/utils/formatters.ts` — formatElo (rounded int), formatScore (2dp)

### Route Structure
```
/admin/quality/evolution/
├── page.tsx                           — Run list dashboard
├── run/[runId]/
│   ├── page.tsx                       — Run detail (5 tabs)
│   └── compare/page.tsx               — Before/after text diff
├── article/[explanationId]/page.tsx   — Article evolution history
└── variant/[variantId]/page.tsx       — Variant detail
```

### Test Files
- `agentDetails/AgentExecutionDetailView.test.tsx` — 12 tests (one per detailType)
- `tabs/TimelineTab.test.tsx` — 18 tests (expand/collapse, detail loading, Elo chips)
- `services/evolutionVisualizationActions.test.ts` — 27 tests (timeline, budget, invocations)
- `evolution/src/testing/evolution-test-helpers.ts` — Factories: createTestEvolutionRun, createTestVariant, createTestCheckpoint, createTestAgentInvocation, createMockEvolutionLLMClient

## Key Findings

### 1. Timeline Already Persists After Run Completion
The TimelineTab reads from `evolution_agent_invocations` (DB table) and checkpoint diffs. Data persists for completed runs. Requirement satisfied at data layer.

### 2. No Before/After Text in Any Agent Detail View
None of the 12 views show variant text content. Only variant IDs (ShortId links), text lengths, and metadata.

### 3. Only CalibrationDetail Shows Rating Changes
CalibrationDetail displays `mu before → after`. No other view shows Elo/rating deltas, despite `_diffMetrics.eloChanges` being available on every invocation.

### 4. Variant Text Access Pattern for Before/After
**Checkpoints are the right source**, not `evolution_variants` (which is only populated at run finalization). Each checkpoint at `(run_id, iteration, last_agent)` contains full `pool[].text`. To get before/after for a specific agent:
- **After state**: checkpoint at `(runId, iteration, agentName)`
- **Before state**: previous checkpoint by `created_at` order
- New variants identified by set-differencing pool IDs
- Parent text found via `parentIds` lookup in the pool

### 5. `_diffMetrics.eloChanges` Available But Underused
Every invocation row has `eloChanges: Record<string, number>` — Elo-scale deltas per variant. `AgentDetailPanel` renders Elo chips from this, but the 12 agent-specific detail views ignore it.

### 6. Data Available But Not Rendered
| Agent | Unrendered fields |
|---|---|
| Reflection | `goodExamples`, `badExamples`, `notes` (rich qualitative text) |
| Tournament | `rounds[].matches[]` (winner, confidence, dimensionScores, frictionSpots) |
| Debate | `judgeVerdict.improvements[]`, transcript truncated to 2 lines |
| SectionDecomposition | `weakness.description` |
| MetaReview | `analysis.strategyOrdinals` |
| Calibration | `ratingBefore/After.sigma` |

### 7. Reusable Components for New Pages
| Component | What it provides |
|---|---|
| `TextDiff` (compare page) | Word-level diff via `diffWordsWithSpace`, green adds/red strikethrough removes |
| `StatCard` (compare page) | Generic label/value card |
| `AttributionBadge` | gain±CI with z-score color bands (grey/amber/green/red) |
| `EloSparkline` | 60x20 inline Recharts line chart |
| `DimensionScoresDisplay` | Inline dimension:score badges |
| `ShortId` | 8-char truncated ID with auto-link |
| `VariantContentSection` | Text with 500-char expand/collapse |

### 8. Route Pattern for Invocation Detail Page
Two options identified:
- **Option A** (sub-route): `/run/[runId]/invocation/[invocationId]` — matches `compare` precedent
- **Option B** (flat): `/invocation/[invocationId]` — matches `variant/[variantId]` pattern

Recommendation: **Option B** (flat, UUID-addressed) — simpler, consistent with variant detail page.

### 9. Elo Display Consistency
| Context | Format | Color |
|---|---|---|
| Static rating | `Math.round(elo)` integer | neutral |
| Delta chip | `±integer` with sign | green (positive) / red (negative) |
| Attribution badge | `±gain ± CI` | z-score bands |
| Sparkline | continuous curve | accent-gold |
| EloTab chart | multi-line with CI bands | strategy palette |

### 10. Test Patterns to Follow
- Component tests: mock full service module, use `jest.fn()`, `waitFor` for async
- Service tests: chainable Supabase mock builder, override terminal methods per test
- Detail views: inline-construct typed `AgentExecutionDetail`, render, assert `data-testid` + visible data
- Factories: `createTestAgentInvocation()`, `createTestCheckpoint()` in test helpers

## Architecture Decision: Invocation Detail Page

### New Server Action Needed
`getInvocationFullDetailAction(invocationId)` — fetches:
1. The invocation row (all columns including `execution_detail`)
2. The "after" checkpoint at `(run_id, iteration, agent_name)` — for new variant text
3. The "before" checkpoint (previous by `created_at`) — for parent/input variant text
4. Run metadata (status, phase, explanation title)
5. Computes before/after text pairs for each new variant

### New Page Structure
```
/admin/quality/evolution/invocation/[invocationId]/page.tsx
├── Breadcrumb: Evolution > Run {id} > Invocation {id}
├── InvocationOverviewCard (agent name, iteration, cost, success, attribution)
├── EloChangesSection (per-variant delta chips from _diffMetrics.eloChanges)
├── BeforeAfterSection (for each new variant: parent text → new text diff)
│   └── TextDiff component (word-level, from compare page)
└── AgentExecutionDetailView (existing 12-type router, enhanced)
```

### Agent Detail View Enhancements
For each of the 12 agent types, add:
1. **Elo delta display** — use `_diffMetrics.eloChanges` passed as additional prop
2. **Surface hidden data** — render already-fetched but unrendered fields
3. **Variant text previews** — optional expandable text snippets for key variants

## Open Questions
1. For agents producing multiple variants (Generation=3, Evolution=3-4), show all diffs or just top-rated?
2. Should "before" be the parent variant or the original baseline article?
3. Max text preview length for inline before/after? (500 chars like VariantContentSection? 1000 like VariantDetailPanel?)
4. Should the invocation page also show a mini Elo sparkline for variants affected?
