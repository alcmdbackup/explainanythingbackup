# Evolution Run and Invocation Details Plan

## Background
Enhance the evolution run detail page to show a persistent timeline of rounds and agent invocations, add agent invocation detail pages across all agent types, and show before/after article examples with Elo differences on invocation detail pages. Currently, the run detail page has timeline data but the invocation drill-down experience needs improvement with richer before/after content comparisons and Elo delta visualization.

## Requirements (from GH Issue)
- [ ] Evolution run detail page should show timeline of rounds and agents invoked during each round. This should persist even after the round finishes.
- [ ] Clicking into agent invocation should show details page. Make sure we have this across different types of agents
- [ ] Ratings optimization > agent invocations detail pages should show before/after examples of articles and elo differences

## User Decisions
- Show diffs for **all** variants produced by an invocation (not just top-rated)
- "Before" text = **parent variant** (via `parentIds`); empty if no parent exists
- Text preview length = **~paragraph** (~300 chars, expandable to full)
- Include **mini Elo sparkline** on invocation detail page for affected variants

## Problem
The evolution pipeline already persists detailed per-agent invocation data (12 typed `execution_detail` structures, `_diffMetrics` with Elo deltas, full variant text in checkpoints). However, no UI surface exposes before/after text comparisons or per-variant Elo changes at the invocation level. Users must manually navigate to individual variant pages to see content, losing the invocation context. The 12 agent detail views also leave significant data unrendered (reflection examples, tournament match outcomes, debate improvements). A dedicated invocation detail page with text diffs and Elo visualization would make the pipeline's work legible at each step.

## Options Considered

### Option A: Enhance Inline Detail Views Only
Add before/after text and Elo to the existing inline expand panels in TimelineTab.
- **Pro**: No new routes, minimal new code
- **Con**: Inline panels become very tall with text diffs; loading checkpoint data for text on every expand is expensive; cramped layout

### Option B: Dedicated Invocation Detail Page (Selected)
Create `/admin/quality/evolution/invocation/[invocationId]` as a full page with text diffs, Elo charts, and enhanced agent detail.
- **Pro**: Ample space for text diffs, consistent with variant detail page pattern, lazy-loads expensive data only when user navigates
- **Con**: New route, new server action, more code

### Option C: Hybrid (Inline Summary + Page Link)
Keep current inline expand for quick metrics, add "View Full Detail →" link to the new page.
- **Pro**: Best of both — quick glance inline, deep dive on page
- **Con**: Most code to write

**Decision**: Option B with a lightweight link from TimelineTab (essentially Option C minus duplicating data in inline views — the inline expand stays as-is, we just add a "View Details →" link).

### Design Principle: Invocation Page = Enhanced Agent Detail View
The invocation detail page is NOT a separate layout with stacked sections. Instead, it **is** the agent-type detail view (e.g., `GenerationDetail`, `CalibrationDetail`, etc.) for that single invocation — enhanced with before/after text diffs and Elo data woven directly into the existing component structure. Each agent detail component gains optional props for variant text and Elo data, and renders them inline alongside its existing metrics when available. A thin page shell provides the breadcrumb header, but the content IS the agent detail view.

## Phased Execution Plan

### Phase 1: Server Action + URL Builder
**Goal**: Backend data access for the invocation detail page.

**Files to create/modify:**
- `evolution/src/services/evolutionVisualizationActions.ts` — add `getInvocationFullDetailAction(invocationId: string)`
- `evolution/src/lib/utils/evolutionUrls.ts` — add `buildInvocationUrl(invocationId: string)`

**New action `getInvocationFullDetailAction`:**
```typescript
// Input: invocationId (UUID, validated with z.string().uuid())
// Returns: InvocationFullDetail
// MUST call requireAdmin() as first line (matches all existing actions)

interface VariantBeforeAfter {
  variantId: string;
  strategy: string;
  parentId: string | null;       // primary parent (first parent for debate)
  parentIds: string[];           // all parent IDs (debate has 2, most agents have 0-1)
  beforeText: string;            // parent text, or '' if no parent; for debate: both parents concatenated with separator
  afterText: string;             // new variant text, or '' if checkpoint text missing
  textMissing?: boolean;         // true if checkpoint text was unavailable (in-progress/failed run)
  eloDelta: number | null;       // from _diffMetrics.eloChanges
  eloAfter: number | null;       // absolute Elo after this agent
}

interface InvocationFullDetail {
  invocation: {
    id: string;
    runId: string;
    iteration: number;
    agentName: string;
    executionOrder: number;
    success: boolean;
    skipped: boolean;
    costUsd: number;
    errorMessage: string | null;
    executionDetail: AgentExecutionDetail | null;
    agentAttribution: AgentAttribution | null;
    createdAt: string;
  };
  run: {
    status: string;
    phase: string | null;
    explanationId: string | null;
    explanationTitle: string | null;
  };
  diffMetrics: DiffMetrics | null;
  inputVariant: {                        // the primary input/parent article for this agent invocation
    variantId: string;
    strategy: string;
    text: string;                        // full article text (from checkpoint pool)
    textMissing?: boolean;               // true if text unavailable
    elo: number | null;                  // Elo rating at time of this invocation
  } | null;                              // null for agents with no input (e.g., OutlineGeneration on first iteration)
  variantDiffs: VariantBeforeAfter[];    // all variants this agent produced
  eloHistory: Record<string, { iteration: number; elo: number }[]>;  // sparkline data per variant ID
}
```

**Existing types referenced** (all in `evolution/src/lib/types.ts`):
- `AgentExecutionDetail` — discriminated union of all 12 agent detail interfaces
- `DiffMetrics` — `{ eloChanges: Record<string, number>; newVariantIds: string[]; ... }`
- `AgentAttribution` — `{ gain: number; ci: number; zScore: number; ... }`

**Existing components referenced:**
- `EloSparkline` — `@evolution/components/evolution/EloSparkline` (60x20px Recharts mini-chart, already exists)
- `EvolutionBreadcrumb` — `@evolution/components/evolution/EvolutionBreadcrumb` (already used on run/variant pages)

**Input validation:**
- Validate `invocationId` with `z.string().uuid()` before any DB query (matches existing action patterns using Zod at the boundary)

**Authorization:**
- Call `requireAdmin()` as the first line of the action (mandatory — matches all 12 existing actions in the file)

**Data fetching strategy:**
1. Fetch invocation row by UUID from `evolution_agent_invocations`
2. Fetch run metadata from `evolution_runs` (+ optional `explanations` join for title)
3. Extract `_diffMetrics` from `execution_detail`
4. For `variantDiffs`: fetch the "after" checkpoint at `(run_id, iteration, agent_name)` and the "before" checkpoint ordered by `(created_at DESC, execution_order DESC)` where `created_at <= after.created_at AND id != after.id`. The `execution_order` tiebreaker handles agents executing in the same iteration with identical timestamps. If no prior checkpoint exists (first agent in run), return empty `variantDiffs` array. Set-diff pool IDs between before and after checkpoint to find new variants. Look up parent text via `parentIds` in the after pool.
5. **`inputVariant`**: From the "before" checkpoint (or "after" checkpoint if no before), identify the top-rated variant by Elo. This is the primary input article the agent operated on. Extract its `{ id, strategy, text, elo }`. For agents that select a specific target (e.g., IterativeEditing uses `targetVariantId`), use that variant instead of top-rated. For agents with no meaningful input (OutlineGeneration on first iteration), set `inputVariant: null`.
6. **Missing text fallback**: If a variant's `text` field is missing/null in the checkpoint pool (can happen for in-progress or failed runs), set `afterText: ''` / `text: ''` and add `textMissing: true`. The UI shows a "Text not yet available" placeholder.
7. For `eloHistory`: fetch all checkpoints for the run, extract rating trajectory for each new variant ID across iterations (reuse pattern from `getEvolutionRunEloHistoryAction`). Returns `Record<string, ...>` keyed by variant ID.

**URL builder:**
```typescript
export function buildInvocationUrl(invocationId: string): string {
  return `/admin/quality/evolution/invocation/${invocationId}`;
}
```

**Tests:**
- `evolutionVisualizationActions.test.ts` — add ~6 tests: happy path, no invocation found, no checkpoint, no new variants, variant with no parent (empty before), invalid UUID

---

### Phase 2: Invocation Detail Page (Thin Shell + Enhanced Agent Detail View)
**Goal**: New page route that renders the agent's own detail view, enhanced with before/after text and Elo data.

**Files to create:**
- `src/app/admin/quality/evolution/invocation/[invocationId]/page.tsx`
- `evolution/src/components/evolution/TextDiff.tsx` (new component inspired by compare page)
- `evolution/src/components/evolution/InputArticleSection.tsx` (input variant display)

**Page params pattern** (Next.js 15 async params — matches variant detail page):
```typescript
export default async function InvocationDetailPage({
  params,
}: {
  params: Promise<{ invocationId: string }>;
}) {
  const { invocationId } = await params;
  // ...
}
```

**Page structure — thin shell only:**
```
<div className="space-y-6 pb-12">
  <EvolutionBreadcrumb items={['Pipeline Runs', `Run ${runId}`, `${agentName} (Iter ${iteration})`]} />

  <header>
    — Agent name (large heading) + iteration badge
    — Status badge (success/skipped/error) + Cost (formatCostMicro)
    — Attribution badge (if agentAttribution exists)
    — Error message (if present)
    — Links: "View Run" → buildRunUrl, "View Logs" → run?tab=logs&agent=X&iteration=N
  </header>

  {/* Input Article — shown on EVERY invocation page when inputVariant exists */}
  {inputVariant && (
    <InputArticleSection
      variant={inputVariant}              // { variantId, strategy, text, elo }
      runId={invocation.runId}
    />
  )}

  <AgentExecutionDetailView
    detail={invocation.executionDetail}
    eloChanges={diffMetrics?.eloChanges}
    variantDiffs={variantDiffs}          ← NEW optional prop
    eloHistory={eloHistory}              ← NEW optional prop
    runId={invocation.runId}
  />
</div>
```

**`InputArticleSection`** — new shared component in `evolution/src/components/evolution/InputArticleSection.tsx`:
```
┌─ Input Article ──────────────────────────────────────────────┐
│  ShortId link + strategy badge + Elo (e.g., "1248")          │
│                                                               │
│  "The quantum computing landscape has evolved significantly   │
│  since the first demonstrations of quantum supremacy..."      │
│                                           [Show full ▼]       │
└───────────────────────────────────────────────────────────────┘
```
- Shows the parent/input variant that this agent operated on
- ~300 char preview with expand toggle (reuses same pattern as TextDiff)
- ShortId links to variant detail page; Elo shown as static badge
- When `textMissing`, shows "Text not yet available" placeholder
- When `inputVariant` is null (no input, e.g., OutlineGeneration on first iteration), section is hidden
- For agents with multiple inputs (Debate: 2 parents), `inputVariant` is the primary input; debate's `VariantDiffSection` shows both parents inline

The page is intentionally minimal — it provides context (breadcrumb, header, input article) and passes enriched data down to the existing `AgentExecutionDetailView` router, which delegates to the correct agent-type component (e.g., `GenerationDetail`). The agent detail component itself renders the output diffs and Elo sparklines inline alongside its own metrics (see Phase 4).

**New shared component (inspired by compare page pattern):**
- Create `evolution/src/components/evolution/TextDiff.tsx` — new component authoring based on the diff pattern in `compare/page.tsx` (that page inlines its diff logic; this extracts and extends it into a reusable component)
- Uses `diffWordsWithSpace` from `diff` package (already a dependency)
- Accepts `{ original: string; modified: string; previewLength?: number }` — defaults to ~300 char preview with "Show full" toggle
- **Three-view layout**: Tabbed or stacked display with three modes:
  1. **Before** — full original text (parent variant), muted styling, ~300 char preview with expand
  2. **After** — full modified text (new variant), muted styling, ~300 char preview with expand
  3. **Diff** — combined word-level diff (green adds / red strikethrough removes), ~300 char preview with expand
- Default active view: **Diff** (most useful at a glance)
- Implementation: tabs (`Before | After | Diff`) above the text area. Each tab shows its own ~300 char preview with independent "Show full" toggle. The tab bar is compact (text-xs) and uses existing accent styling.
- When `original` is empty (no parent), hide the "Before" tab and show only "After" + "Diff" (diff will be all-green)
- Reuse in both compare page and agent detail views

**Tests:**
- `invocation/[invocationId]/page.test.tsx` — ~8 tests: renders header with agent name, renders input article section when inputVariant present, hides input article when inputVariant null, passes data to AgentExecutionDetailView, handles error state, handles skipped invocation, breadcrumb links, loading skeleton. **Mock pattern**: `jest.mock('@evolution/services/evolutionVisualizationActions')` to mock `getInvocationFullDetailAction`, returning typed `InvocationFullDetail` fixtures. Follow existing pattern from variant detail page tests.
- `InputArticleSection.test.tsx` — ~4 tests: renders variant text with preview, expand toggle shows full text, shows ShortId link and Elo badge, shows placeholder when textMissing
- `TextDiff.test.tsx` — ~7 tests: additions (green), removals (red strikethrough), unchanged, empty input, tab switching (before/after/diff), hides Before tab when original empty, expand toggle per tab. Uses `@testing-library/react` `fireEvent.click` for tab interaction.

---

### Phase 3: Timeline Link to Invocation Page
**Goal**: Wire up navigation from TimelineTab to the new invocation page.

**Files to modify:**
- `evolution/src/services/evolutionVisualizationActions.ts` — update `getEvolutionRunTimelineAction` to include `id` in invocation select
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — add "View Details →" link in expanded agent panel; update `TimelineAgent` type to include `invocationId`

**Changes:**
1. In `getEvolutionRunTimelineAction`: include `invocationId` (the UUID from `evolution_agent_invocations.id`) in the timeline response data for each agent entry. Currently the timeline fetches invocations but only extracts `cost_usd`, `execution_detail`, and `agent_attribution` — add `id` to the select. Update the `TimelineAgent` type (or equivalent local type) to include `invocationId: string | null`.

2. In `TimelineTab.tsx`, the `AgentDetailPanel` section (rendered when an agent row is expanded):
   - Add a "View Details →" link below the existing metrics grid
   - Link target: `buildInvocationUrl(agent.invocationId)` (uses new field from step 1)
   - Style: `text-xs text-[var(--accent-gold)] hover:underline` (matches existing link patterns)
   - Only render link when `invocationId` is non-null

3. Update test fixtures in `TimelineTab.test.tsx` to include `invocationId` field in mock timeline data.

**Tests:**
- Update `TimelineTab.test.tsx` — add ~2 tests: "View Details" link renders with correct URL, link not rendered when invocationId is null

---

### Phase 4: Enhance Agent Detail Views with Inline Before/After + Elo
**Goal**: Each of the 12 agent detail views becomes the invocation detail view for its agent type. When optional enrichment props are provided (from the invocation page), the component renders before/after text diffs and Elo data inline alongside its existing metrics. When props are absent (inline TimelineTab expand), the component renders as it does today.

**Core prop additions to `AgentExecutionDetailView.tsx` (router):**
```typescript
interface AgentDetailEnrichment {
  eloChanges?: Record<string, number>;       // variant ID → Elo delta
  variantDiffs?: VariantBeforeAfter[];        // before/after text per variant
  eloHistory?: Record<string, { iteration: number; elo: number }[]>; // sparkline per variant
}
```
The router forwards these to each agent-type component. All are optional — existing inline usage passes nothing.

**Files to modify (all in `evolution/src/components/evolution/agentDetails/`):**
1. `AgentExecutionDetailView.tsx` — add `AgentDetailEnrichment` to props, forward to each case
2. `shared.tsx` — add `EloDeltaChip`, `VariantDiffSection` components
3. `GenerationDetail.tsx` — add enrichment props, render `VariantDiffSection` per strategy
4. `CalibrationDetail.tsx` — add enrichment props, render `EloDeltaChip` per entrant, show sigma
5. `TournamentDetail.tsx` — add enrichment props, render `EloDeltaChip` per pair, show match outcomes
6. `IterativeEditingDetail.tsx` — add enrichment props, render `VariantDiffSection` per edit cycle
7. `ReflectionDetail.tsx` — add enrichment props, render goodExamples/badExamples/notes
8. `DebateDetail.tsx` — add enrichment props, render `VariantDiffSection` for synthesis, expand transcript, show improvements
9. `EvolutionDetail.tsx` — add enrichment props, render `VariantDiffSection` per mutation
10. `SectionDecompositionDetail.tsx` — add enrichment props, render `VariantDiffSection`, show weakness
11. `TreeSearchDetail.tsx` — add enrichment props, render `VariantDiffSection` for best leaf
12. `OutlineGenerationDetail.tsx` — add enrichment props, render `VariantDiffSection`
13. `ProximityDetail.tsx` — add enrichment props (no rendering changes — no variants)
14. `MetaReviewDetail.tsx` — add enrichment props, render strategyOrdinals table

#### 4a. Shared components — add to `shared.tsx`

**`EloDeltaChip`** — inline Elo delta badge:
```typescript
function EloDeltaChip({ delta }: { delta: number }) {
  const sign = delta > 0 ? '+' : '';
  const colorVar = delta > 0 ? '--status-success' : delta < 0 ? '--status-error' : '--text-secondary';
  return (
    <span className={`text-xs font-mono bg-[var(${colorVar})]/10 text-[var(${colorVar})] px-1.5 py-0.5 rounded`}>
      {sign}{Math.round(delta)}
    </span>
  );
}
```
Note: delta=0 uses neutral `--text-secondary` color, not error color.

**`VariantDiffSection`** — reusable before/after block for a single variant:
```typescript
function VariantDiffSection({ diff, eloHistory, runId }: {
  diff: VariantBeforeAfter;
  eloHistory?: { iteration: number; elo: number }[];
  runId?: string;
}) {
  // Renders:
  // - ShortId link + strategy badge + EloDeltaChip
  // - If parentId: "Parent: {ShortId}" link
  // - EloSparkline (if eloHistory provided) — import from existing @evolution/components/evolution/EloSparkline
  // - TextDiff with three-view tabs (Before | After | Diff):
  //     Before tab: full parent text (~300 char preview, expandable)
  //     After tab: full new variant text (~300 char preview, expandable)
  //     Diff tab (default): combined word-level diff (~300 char preview, expandable)
  // - If no parent: hides Before tab, shows After + Diff (all-green)
}
```

#### 4b. Per-agent enhancements — each renders diffs + Elo inline

Each agent detail component gains the enrichment props and renders them **contextually within its own layout**, not as a separate stacked section.

| Agent | Where before/after + Elo renders | Additional enhancements |
|---|---|---|
| **GenerationDetail** | Below each strategy row: if `variantDiffs` has a match for `s.variantId`, render `VariantDiffSection`. EloDeltaChip next to ShortId. | — |
| **CalibrationDetail** | EloDeltaChip next to each entrant's ShortId (from `eloChanges`). Already shows mu before/after — add sigma display too. | Show sigma alongside mu |
| **TournamentDetail** | EloDeltaChip next to each pair's variantA/variantB. | Show match outcomes per round: winner ShortId, confidence badge |
| **IterativeEditingDetail** | Below each accepted edit cycle: `VariantDiffSection` showing parent→edited text. EloDeltaChip next to `newVariantId`. | — |
| **ReflectionDetail** | No variants produced — no diffs. EloDeltaChip not applicable. | Render `goodExamples`, `badExamples`, `notes` in collapsible sections |
| **DebateDetail** | `VariantDiffSection` for synthesis variant (parents A+B as context). EloDeltaChip next to synthesis. | Expand transcript (remove `line-clamp-2`, add toggle). Render `improvements[]`. |
| **EvolutionDetail** | Below each mutation row: `VariantDiffSection` for parent→mutation. EloDeltaChip next to each `mutations[].variantId`. | — |
| **SectionDecompositionDetail** | `VariantDiffSection` for target→stitched variant. EloDeltaChip next to `newVariantId`. | Render `weakness.description` |
| **TreeSearchDetail** | `VariantDiffSection` for root→best leaf. EloDeltaChip next to `bestLeafVariantId`. | — |
| **OutlineGenerationDetail** | `VariantDiffSection` for the produced variant (no parent → empty before). EloDeltaChip next to `variantId`. | — |
| **ProximityDetail** | No variants produced — no changes. | — |
| **MetaReviewDetail** | No variants produced — no changes. | Render `analysis.strategyOrdinals` as sorted table |

**Input article is page-level, not per-agent**: The `InputArticleSection` is rendered by the page shell (Phase 2), NOT by the agent detail components. Every invocation page shows the input article at the top, regardless of agent type. This means:
- Agents that transform variants (Generation, IterativeEditing, Evolution, Debate, etc.) — input article shows the primary parent/input they worked from
- Agents that only rate/analyze (Calibration, Tournament, Reflection, Proximity, MetaReview) — input article shows the top-rated variant at time of invocation (useful context for understanding what was being rated)
- OutlineGeneration on first iteration — `inputVariant` is null, section hidden

The agent detail components below the input article then show their **output** diffs (what the agent produced relative to the input).

**Key pattern**: Each detail component checks `if (variantDiffs?.length)` before rendering diff sections. When called from TimelineTab inline expand (no enrichment props), the component renders identically to today. When called from the invocation page (with enrichment), the diffs and sparklines appear naturally within the agent's own layout.

**`textMissing` handling**: When `VariantBeforeAfter.textMissing` is true, `VariantDiffSection` renders a muted placeholder: "Text not yet available — run may be in progress" instead of the TextDiff tabs. The EloDeltaChip and ShortId links still render normally.

**For agents producing multiple variants** (Generation=3, Evolution=3-4): render a `VariantDiffSection` for each. The diff section is compact (~300 char preview by default) so multiple diffs stack neatly.

**For the debate agent**: Debate has 2 parent variants synthesized into 1. The `VariantBeforeAfter` for the synthesis variant uses `beforeText = parentA.text + '\n---\n' + parentB.text` (concatenated with separator) and `afterText = synthesis.text`. The `TextDiff` diff view will show the synthesis as mostly new text (all-green) since it differs substantially from concatenated parents. The `Before` tab shows both parents stacked, the `After` tab shows synthesis. Additionally, `parentId` in this case references the first parent; a supplemental `parentIds: string[]` field on `VariantBeforeAfter` is used by `VariantDiffSection` to render ShortId links for both parents.

**Tests:**
- `shared.test.tsx` — **add to existing file** ~5 tests for new components: `EloDeltaChip` (positive/negative/zero), `VariantDiffSection` (with parent, without parent). The file already tests ShortId, StatusBadge, etc. — append new `describe` blocks.
- `AgentExecutionDetailView.test.tsx` — add ~8 tests: enrichment props forwarded, GenerationDetail renders diffs when provided, IterativeEditingDetail renders diffs per cycle, no diffs when props absent, Elo chips render for tournament pairs, reflection renders hidden fields, debate renders improvements

---

### Phase 5: Lint, Build, and Polish
**Goal**: Ensure everything compiles, passes lint, and looks correct.

1. Run `tsc --noEmit` — fix any type errors
2. Run lint — fix any violations
3. Run build — ensure no SSR issues with new page
4. Run existing unit tests — ensure no regressions
5. Run new unit tests
6. Manual verification with a real completed evolution run (check timeline links, invocation page renders, diffs display correctly)

## Testing

### Unit Tests (new)
| File | Tests | What |
|---|---|---|
| `evolutionVisualizationActions.test.ts` | +6 | `getInvocationFullDetailAction` happy path, edge cases |
| `invocation/[invocationId]/page.test.tsx` | +8 | Page shell, input article section, data passing, error/loading states |
| `InputArticleSection.test.tsx` | +4 | Text preview, expand, ShortId/Elo, textMissing placeholder |
| `TimelineTab.test.tsx` | +2 | "View Details" link presence and URL |
| `AgentExecutionDetailView.test.tsx` | +8 | Enrichment prop forwarding, diffs render per agent, Elo chips, hidden data |
| `shared.test.tsx` (existing, add to) | +5 | `EloDeltaChip` (3), `VariantDiffSection` (2) |
| `TextDiff.test.tsx` | +7 | Three-view tabs (before/after/diff), additions, removals, unchanged, empty, tab switching, expand toggle |

**Total: ~40 new tests**

### Test Fixture Strategy
- Add `createTestInvocationFullDetail()` factory to `evolution/src/testing/evolution-test-helpers.ts` — returns typed `InvocationFullDetail` with realistic defaults (1 variant diff, non-empty before/after text, Elo delta, eloHistory with 3 data points)
- Add `createTestVariantBeforeAfter()` factory — returns typed `VariantBeforeAfter` with configurable `parentId`, `textMissing`, `parentIds`
- Page tests use `jest.mock('@evolution/services/evolutionVisualizationActions')` and return factory output
- Agent detail tests inline-construct `AgentDetailEnrichment` objects (matches existing pattern of inline detail construction)

### Unit Tests (modified)
- `AgentExecutionDetailView.test.tsx` — update existing 12 tests if prop signatures change (add optional enrichment props)

### E2E Smoke Test (Phase 5)
- Add a lightweight Playwright smoke test: navigate to a known completed run → Timeline tab → verify "View Details" link → click → verify invocation page loads with agent name heading and at least one variant diff section
- This catches SSR/hydration issues on the new page route that unit tests cannot detect

### Manual Verification
- Navigate to a completed run → Timeline tab → expand an agent → click "View Details"
- Verify invocation page shows: overview card, Elo changes, before/after diffs for all variants, execution detail
- Test agents with no variants (Proximity, MetaReview) — should show empty states gracefully
- Test agents with multiple variants (Generation=3, Evolution=3-4) — all diffs visible
- Test variant with no parent (baseline) — shows empty "before" with full "after" text
- Verify sparklines render for variants with history

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` — **Must update**: add invocation detail page to Pages table, add `getInvocationFullDetailAction` to server actions list, document the new route and components
- `evolution/docs/evolution/reference.md` — **Must update**: add new page file to Key Files table, add `buildInvocationUrl` to URL builders
- `evolution/docs/evolution/agents/overview.md` — **Should update**: update "Execution Detail Tracking" section to mention invocation detail page and Elo delta display
- `evolution/docs/evolution/data_model.md` — Minor: mention invocation detail page in Agent Invocation section
- `evolution/docs/evolution/architecture.md` — No change needed
- `evolution/docs/evolution/agents/generation.md` — No change needed
- `evolution/docs/evolution/rating_and_comparison.md` — No change needed
- `evolution/docs/evolution/README.md` — No change needed
