# Timeline View Evolution Runs Plan

## Background
Add a Timeline tab to evolution run detail pages showing a Gantt-style view of agent invocations grouped by iteration. Parallel generate agents are shown as stacked rows starting at the same x-position. Each bar links to the invocation detail page and shows duration. The run outcome (stop reason, winner, cost, match stats) is displayed below the chart.

## Requirements (from GH Issue #953)
- Tab called "timeline" on the run detail page
- Shows which agent invocations were run for each iteration
- Parallel agents shown visually as parallel (stacked rows, same x-position)
- Easy to click through to individual agent invocation detail pages
- Shows how long different things took and how they influenced overall run time
- Shows the final outcome of the run

## Problem
The run detail page has a Metrics tab, Logs tab, and Snapshots tab, but no view that shows the execution timeline of a run at a glance. There is no way to quickly see which agents ran in each iteration, whether they ran in parallel, how long each phase took, or what slowed down the overall run. This makes it hard to diagnose slow or expensive runs without digging through raw logs.

## Options Considered
- [x] **Option A: Gantt chart with CSS absolute positioning**: Position each invocation bar using `left: X%` and `width: Y%` computed from `created_at` offset and `duration_ms`. Grouped by iteration, one row per invocation. No D3 or canvas needed. Chosen for simplicity and consistency with existing component patterns.
- [x] **Option B: D3 timeline**: Would allow richer interactions (zoom, pan) but adds a heavy dependency and is overkill for the data volume (<200 rows).
- [x] **Option C: Table with duration column**: Simpler but loses the visual parallel/sequential distinction that makes the timeline useful.

## Phased Execution Plan

### Phase 1: TimelineTab component
- [x] Create `evolution/src/components/evolution/tabs/TimelineTab.tsx`
- [x] Fetch invocations via existing `listInvocationsAction` with `limit: 200`, sort by `created_at` ASC
- [x] Compute timeline bounds: `runStartMs` from first invocation `created_at`; `runEndMs` from `run.completed_at` or last invocation end
- [x] Group invocations by `iteration` (null → −1 → "Setup" label)
- [x] Render time axis with 5 ticks at 0/25/50/75/100%
- [x] Render one `InvocationBar` row per invocation; bar position = `left: (offset/total)*100%`, width = `(duration/total)*100%` (min 0.5%)
- [x] Color-code by agent kind: Generate=`#3b82f6`, Swiss=`#8b5cf6`, Merge=`#10b981`
- [x] Each bar is a `<Link>` to `/admin/evolution/invocations/[id]` with tooltip showing agent, iteration, order, duration, cost, success
- [x] Iteration header shows type (`generate` / `swiss`) and parallel count (`N× parallel`) for generate iterations
- [x] Failed invocations show ✗ indicator after bar
- [x] Legend at top; total invocation count + wall-clock in top-right
- [x] Run outcome section below chart (from `run.run_summary`): stop reason, iterations, wall-clock, total cost, total matches, decisive rate, winner strategy (linked), baseline rank
- [x] Loading / empty / error states with `data-testid` attributes

### Phase 2: Wire into run detail page
- [x] Import `TimelineTab` in `src/app/admin/evolution/runs/[runId]/page.tsx`
- [x] Add `{ id: 'timeline', label: 'Timeline' }` as first entry in `TABS`
- [x] Render `<TimelineTab runId={runId} run={run} />` in the tab switch

### Phase 3: Per-invocation cost column
- [x] Add `fmtCost(usd)` helper: `$0.0000` for values ≥ $0.0001, `—` for null/zero
- [x] Add a `w-16` cost column to the right of the duration column in each `InvocationBar` row, with `data-testid="timeline-cost-{id}"`
- [x] Align the time axis header spacer to match the new column (add `w-16` spacer on the right)
- [x] Add per-iteration cost subtotal in the iteration header (right side, after duration), with `data-testid="timeline-iter-cost-{iter}"`
- [x] Add tests: cost column renders `$X.XXXX`, zero-cost renders `—`, iteration cost subtotal shown

### Phase 4: `/pushForLocalViewing` command
- [x] Create `.claude/commands/pushForLocalViewing.md`
- [x] Stage all outstanding changes (untracked + modified), skipping sensitive files (`.env*`)
- [x] Commit with a WIP message derived from the branch name
- [x] Push branch to remote (create upstream if needed)
- [x] Print a ready-to-copy command block the user can run on another machine: `git fetch && git checkout <branch> && git pull && npm run dev`

## Testing

### Unit Tests
- [x] `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — loading skeleton, empty state, error state, gantt renders with iteration groups, run outcome section, bar href links, no outcome section when `run_summary` null

### Integration Tests
- [ ] Not required — component fetches via existing `listInvocationsAction` which has its own tests; no new server-side logic added

### E2E Tests
- [ ] Not added for this feature; visual layout verified locally

### Manual Verification
- [x] Navigate to any completed run at `/admin/evolution/runs/[id]?tab=timeline`
- [x] Verify Gantt bars appear with correct colors and proportional widths
- [x] Verify clicking a bar navigates to invocation detail

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/evolution_run_detail.spec.ts` (if it exists) — check Timeline tab renders

### B) Automated Tests
- [x] `npx jest evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — 13/13 pass
- [x] `npx tsc --noEmit` — clean
- [x] `npm run build` — clean

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/visualization.md` — add Timeline tab to the admin pages table under `/admin/evolution/runs/[runId]`

## Known Constraints & Design Decisions

### 200-invocation cap
`listInvocationsAction` is called with `limit: 200`. Typical runs have 20–50 invocations; 200 is sufficient for foreseeable scale. If `total > items.length` after the fetch, a visible warning banner is shown: "Showing N of M invocations — timeline may be incomplete." This ensures users are never silently misled. A future improvement could add pagination or a higher limit.

### `completed_at=null` fallback
When `run.completed_at` is null (e.g. a still-running or abandoned run), the timeline `runEndMs` falls back to `lastInv.created_at + (lastInv.duration_ms ?? 30_000)`. This ensures the Gantt renders without crashing. Covered by the `completed_at=null` test.

### Full `EvolutionRun` prop vs. scalar props
The component receives the full `EvolutionRun` object because the run detail page already has it in scope and passing it avoids prop-drilling individual fields from `run_summary`. This is consistent with how `MetricsTab` and other detail tabs accept the full run. The prop is typed strictly as `EvolutionRun` from `evolutionActions.ts`.

### Untrusted string fields rendered as text
Fields like `error_message`, `stopReason`, and `strategy` are DB-sourced strings rendered via React's text interpolation (not `dangerouslySetInnerHTML`), so XSS is not a concern. The only exception is `error_message` in the bar tooltip (`title=` attribute), which React escapes automatically.

### `finalPhase` fixture type
Test fixture uses `'COMPETITION'` (a valid `PipelinePhase`). The field is present in `EvolutionRunSummary` V3 but not displayed in the outcome section — it is included in the fixture for type completeness only.

## Review & Discussion

### Plan Review — Iteration 1 (2026-04-10)
| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 3/5 | Silent truncation at 200 invocations |
| Architecture & Integration | 3/5 | `run` prop pattern undocumented |
| Testing & CI/CD | 3/5 | Missing edge-case tests |

Fixes applied: truncation warning UI added, 5 new tests added, Known Constraints section added.

### Plan Review — Iteration 2 (2026-04-10)
| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 4/5 | None |
| Architecture & Integration | 5/5 | None |
| Testing & CI/CD | 3/5 | `completed_at=null` branch untested |

Fixes applied: added `completed_at=null` test (13th test); confirmed `buildInvocationUrl` module alias works in Jest.

### Plan Review — Iteration 3 (2026-04-10)
| Perspective | Score | Critical Gaps |
|---|---|---|
| Security & Technical | 5/5 | None |
| Architecture & Integration | 5/5 | None |
| Testing & CI/CD | 5/5 | None |

✅ CONSENSUS REACHED — Plan ready for execution. All 13 tests pass, tsc clean.
