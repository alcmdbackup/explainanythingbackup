# Fixes to Evolution Admin Dashboard Research

## Problem Statement
Four small fixes to the evolution admin dashboard, identified by the user during exploratory testing:
1. Match history is empty for variants (Variant detail → Matches tab)
2. Run timeline tab — invocation rows should show the agent type (not "Generate #29") and link to invocation detail
3. Variant detail view should link to the invocation that produced it
4. Eval & Suggest tab on `evaluate_criteria_then_generate_from_previous_article` invocation detail should show more detail, including the example passages

## Requirements (from GH Issue #NNN)
- Match history is empty for variants
- Run timeline tab on run details view should:
    - List invocation agent type instead of "Generate #29"
    - Should link to the invocation detail view on click
- Variant detail view should link to invocation that produced it, somewhere
- Add more detail (including examples suggested) to eval & suggest tab for agent invocation detail view for **evaluate_criteria_then_generate_from_previous_article**

## High Level Summary

Five rounds of 4 parallel Explore agents each (20 agents total) traced each issue end-to-end through code, schemas, and live staging data. Key findings:

### Issue 1 — Match history empty (root cause: stub action)
- `getVariantMatchHistoryAction` at `evolution/src/services/variantDetailActions.ts:216-222` is a deliberate stub that returns `[]`. The inline comment claims "V2: match history not persisted per-variant — aggregated in run_summary JSONB" — but this is **stale**. Per `evolution/docs/architecture.md`, `MergeRatingsAgent` IS the sole writer of in-run `evolution_arena_comparisons` rows, and `sync_to_arena` later backfills `prompt_id`. Staging confirms: **8,819 comparison rows exist** (8,723 arena-synced, 96 in-run-only); top variant has 379 matches.
- The stub was introduced in commit `cad78cb5` (Phases 1-7 PR #997, 2026-04-18) during V2 schema redesign, intentionally deferring per-variant match history. Now it needs implementing.
- Implementation strategy: use Supabase `.or('entry_a.eq.<id>,entry_b.eq.<id>')` syntax (the codebase uses this pattern in `VariantEntity.ts` cleanup paths and `evolution-test-helpers.ts`). Batch-fetch opponent rows from `evolution_variants` to populate `opponentElo` / `opponentUncertainty` via `dbToRating()` from `evolution/src/lib/shared/rating.ts`.
- **Performance**: no leading-column index on `entry_a` or `entry_b`. Existing indexes on `evolution_arena_comparisons`: `(run_id, iteration)`, `(invocation_id)`, partial on `(prompt_id IS NULL)`. With ~9k rows on staging, a sequential scan is fine for v1; revisit if perf degrades. RLS is safe — admin pages flow through `service_role` via `adminAction`.
- The consuming UI (`evolution/src/components/evolution/variant/VariantMatchHistory.tsx`) is fully wired — only the action implementation is missing.

### Issue 2 — Timeline label + click-through
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` `InvocationBar` (lines 133-173) currently renders the left label as `{KIND_CONFIG[kind].label} #{execution_order}` — e.g. "Generate #29". `KIND_CONFIG` maps a coarse `agentKind` (generate / swiss / merge / edit / reflect_generate / other) to a human label.
- The label is a standalone `<span>` outside any `<Link>`. `GanttBar` itself has `href={buildInvocationUrl(inv.id)}`, so only the bar (not the label) is clickable today.
- Required change: (a) show `agent_name` directly (e.g. `evaluate_criteria_then_generate_from_previous_article`), and (b) wrap the entire row (label + bar) in `<Link>` so click anywhere navigates to invocation detail. Recommended layout: two-line label — `agent_name` on top (truncated, full in `title=`), `#{execution_order}` on the bottom — fits the existing `w-32` column.
- Staging shows 11 distinct agent_name strings; longest is `evaluate_criteria_then_generate_from_previous_article` (50 chars). With `truncate` + `title` tooltip, this is fine.
- No existing E2E test asserts on the old "Generate #29" string. The unit test at `TimelineTab.test.tsx` does not assert on label text either, so the change is safe.

### Issue 3 — Variant detail → producing invocation link
- Per `evolution/docs/data_model.md`, `evolution_variants.agent_invocation_id` (UUID, nullable) was added by migration `20260418000003`. It references `evolution_agent_invocations(id) ON DELETE SET NULL`. **Staging coverage: 1,086 of 1,980 variants (54.8%) populated.** Historic rows are NULL — render no link, gracefully.
- Best surface: `EntityDetailHeader.links` slot on the variant detail page (`src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`, lines 62-78). This matches the pattern used by run/invocation detail headers. The slot already renders `Run` and (optional) `Explanation` cross-links — adding "Produced by" alongside is consistent and discoverable.
- Better label than UUID-8: render the agent's `agent_name` (e.g. `Produced by generate_from_previous_article`). Requires the variant detail server action (`getVariantFullDetailAction`) to add `agent_invocation_id` to its select and embed `evolution_agent_invocations(id, agent_name)` via PostgREST embedded select (handles null FK gracefully — returns `null` for the embedded record).
- No need to add this to the global variants list page or the lineage graph node tooltip — the header link is sufficient (Round 3 confirmed).

### Issue 4 — Eval & Suggest tab — TWO root causes
- `DETAIL_VIEW_CONFIGS['evaluate_criteria_then_generate_from_previous_article']` in `evolution/src/lib/core/detailViewConfigs.ts` (lines 122-172) DOES define a Suggestions table with columns `criteriaName`, `examplePassage`, `whatNeedsAddressing`, `suggestedFix`. The Zod schema requires all four. So in principle the data is structured.
- **Root cause A (parser, dominant)**: `parseEvaluateAndSuggest` (in or near `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts:216-238`) uses regex `(.+?)` which requires at least one non-whitespace char. If the LLM omits the `Example:` line, or returns it with whitespace only, the entire suggestion is dropped silently with `continue`. **Staging confirms**: some `evaluate_criteria_then_generate_from_previous_article` invocations have `suggestions = []` — Possibility B is real.
- **Root cause B (rendering)**: `ConfigDrivenDetailRenderer.tsx` `<td>` cells (line 73) have NO max-width, no `break-words`, no `whitespace-pre-wrap`. Long `examplePassage` text expands the table unboundedly (parent `overflow-x-auto` enables horizontal scroll). Visually cramped or hidden off-screen.
- Fix both: (a) parser regex `(.+?)` → `(.*?)` so partial suggestions still surface; UI renders empty fields as `—`. (b) Add an optional `cellClassName?: string` to `DetailFieldDef` so we can scope `max-w-md break-words whitespace-pre-wrap` to the suggestions table specifically — NOT global, to avoid regressing other agents' detail tables.
- Schema fields confirmed in staging: a real suggestion JSON shape is `{ criteriaName, suggestedFix, examplePassage, whatNeedsAddressing }` — Round 1's claims are accurate.

## Implementation Outline

### Fix 1 — variant match history (file: `evolution/src/services/variantDetailActions.ts:216`)
Replace the stub. Query `evolution_arena_comparisons` with `.or('entry_a.eq.<id>,entry_b.eq.<id>')`, batch-fetch opponents from `evolution_variants` (id, mu, sigma, elo_score), map to `VariantMatchEntry[]` with `won` computed as `(entry_a == variantId && winner == 'a') || (entry_b == variantId && winner == 'b')`. Use `dbToRating()` to lift opponent uncertainty.

### Fix 2 — timeline label (file: `evolution/src/components/evolution/tabs/TimelineTab.tsx:133-173`)
Two-line label: line 1 = `inv.agent_name` (truncated, `title={inv.agent_name}`); line 2 = `#{inv.execution_order}`. Wrap entire row in `<Link href={buildInvocationUrl(inv.id)}>`; remove redundant `href` from `GanttBar` to avoid nested anchors. Test fixtures use PascalCase agent names — keep a fallback to `KIND_CONFIG.label` if `agent_name` lacks underscore (or update fixtures).

### Fix 3 — variant detail → invocation link (files: `evolution/src/services/variantDetailActions.ts` + `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`)
Add fields `agentInvocationId: string | null` and `agentInvocationName: string | null` to `VariantFullDetail`. Update the server action's `.select(...)` to embed `evolution_agent_invocations(id, agent_name)`. In `VariantDetailContent.tsx:72-77`, conditionally spread a third `EntityLink`:
```ts
...(variant.agentInvocationId
  ? [{ prefix: 'Produced by', label: variant.agentInvocationName ?? variant.agentInvocationId.slice(0,8), href: `/admin/evolution/invocations/${variant.agentInvocationId}` }]
  : []),
```

### Fix 4 — eval & suggest (files: `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` + `evolution/src/lib/core/types.ts` + `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` + `evolution/src/lib/core/detailViewConfigs.ts`)
- 4a (parser): regex `(.+?)` → `(.*?)` for Example/Issue/Fix lines; render empty values as `—` (or pass-through and let UI handle).
- 4b (renderer): add optional `cellClassName?: string` to `DetailFieldDef`. `renderTable()` accepts third arg `cellClassName`; falls through to default class when undefined.
- 4c (config): suggestions table entry adds `cellClassName: 'max-w-md break-words whitespace-pre-wrap py-1.5 px-2 text-[var(--text-primary)]'`.

## Phasing (recommended)
- **Commit 1 — Fix 2** (timeline UI only, isolated) — XS
- **Commit 2 — Fix 1 + Fix 3** (both touch `variantDetailActions.ts`; ship together) — S
- **Commit 3 — Fix 4a + 4b + 4c** (parser + renderer + config; tightly scoped) — S/M

## Risks (none blocking)
- Fix 1: missing index on entry_a/b — mitigated by current low row counts (~9k); revisit if perf regresses
- Fix 2: long agent names truncated — full in tooltip via `title=`
- Fix 3: response shape gains optional fields — defensive `?.` access in consumers
- Fix 4: parser `(.+?)` → `(.*?)` does not affect historical immutable rows; per-field `cellClassName` avoids cross-tab regression

## Verification (high-level)
- Unit: extend `variantDetailActions.test.ts`, `TimelineTab.test.tsx`, `EntityDetailHeader.test.tsx`, `ConfigDrivenDetailRenderer.test.tsx`, parser test
- Integration: `evolution-visualization.integration.test.ts` extension for match history
- E2E: `admin-evolution-variants.spec.ts` (matches tab + producing invocation link), `admin-evolution-run-pipeline.spec.ts` (timeline labels), `admin-evolution-invocation-detail.spec.ts` (eval&suggest)
- Manual Playwright: navigate to known staging variant `1e1bee71-…` (379 matches), confirm match table populates; navigate to a `evaluate_criteria_then_generate_from_previous_article` invocation, confirm Eval & Suggest renders examples and wraps long passages

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/design_style_guide.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/evolution_metrics.md
- evolution/docs/README.md, architecture.md, visualization.md, metrics.md, logging.md, entities.md, data_model.md, arena.md, cost_optimization.md, strategies_and_experiments.md, rating_and_comparison.md, curriculum.md, minicomputer_deployment.md, reference.md, agents/overview.md, sample_content/filler_words.md, sample_content/api_design_sections.md
- evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md

## Code Files Read (via Explore agents)
- `evolution/src/services/variantDetailActions.ts` (lines 18-222) — `VariantFullDetail`, `getVariantFullDetailAction`, stubbed `getVariantMatchHistoryAction`
- `evolution/src/services/adminAction.ts` — service-role wrapping
- `evolution/src/services/arenaActions.ts` — patterns for `evolution_arena_comparisons` queries
- `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` — UI consumer of the stubbed action
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` (lines 27-173, 352-398) — `InvocationBar`, `KIND_CONFIG`, iteration card header
- `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — existing assertions
- `evolution/src/components/evolution/sections/EntityDetailHeader.tsx` — `EntityLink` interface
- `evolution/src/components/evolution/sections/EntityDetailHeader.test.tsx` — cross-link pattern
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` (lines 62-78) — links slot
- `evolution/src/lib/core/detailViewConfigs.ts` (lines 122-172) — `evaluate_criteria_then_generate_from_previous_article` entry, suggestions table cols
- `evolution/src/lib/core/types.ts` — `DetailFieldDef` interface
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` (lines 216-238) — parser regex
- `evolution/src/lib/schemas.ts` — `evaluateAndSuggest.suggestions` Zod schema (lines 1344-1349)
- `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` (lines 47-83) — `renderTable`, `<td>` styling
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` (line 235) — `keyFilter` for Eval & Suggest tab
- `evolution/src/lib/shared/rating.ts` — `dbToRating()` boundary helper
- `evolution/src/lib/core/agentNames.ts` — `AgentName` typed labels
- `supabase/migrations/20260331000001_evolution_parallel_pipeline_schema.sql` — `evolution_arena_comparisons` indexes
- `supabase/migrations/20260418000003_variants_add_agent_invocation_id.sql` — variants → invocation FK
- E2E specs: `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`, `admin-evolution-run-pipeline.spec.ts`, `admin-evolution-invocation-detail.spec.ts`

## Key Findings
1. Match history stub is the root cause — implement, don't redesign. Data exists in `evolution_arena_comparisons` (8,819 rows on staging).
2. ~55% of variants have `agent_invocation_id` populated; the new "Produced by" link will surface for those, gracefully no-op for legacy.
3. Eval & Suggest has TWO independent bugs: parser silently drops empty Example fields AND renderer has no width constraint. Fix both.
4. Timeline label change is a 2-line CSS-only refactor with no e2e/test selector breakage.
5. No DB migrations required for any fix. The `agent_invocation_id` FK already exists.
6. Phasing: 3 commits (Fix 2 alone, Fix 1+3 together since same file, Fix 4 atomic).

## Open Questions
None blocking. All defaults selected: render empty fields as `—` (no DB pollution), per-field `cellClassName` (no global CSS regression), no DB index for v1 (~9k rows is fine), no pagination (.limit(1000) suffices), header-only surface for Producing Invocation (no list/lineage clutter).
