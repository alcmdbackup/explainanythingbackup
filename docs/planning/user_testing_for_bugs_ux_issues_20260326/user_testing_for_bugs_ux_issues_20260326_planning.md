# User Testing For Bugs UX Issues Plan

## Background
Conduct comprehensive user testing of the ExplainAnything platform and evolution admin UI using Playwright to identify 50 bugs and UX issues. Fix all identified issues and write Playwright regression tests to ensure bugs do not recur. All 50 bugs have been validated by reading actual source code.

## Requirements (from GH Issue #851)
I want to do comprehensive testing using playwright to identify 50 bugs and UX issues, then fix them all. Write tests to make sure any bugs do not re-occur.

Focus: Everything — test all areas including main app, evolution admin, arena, experiments, and all user flows.

## Problem
The ExplainAnything platform has accumulated 50 validated bugs across security (open redirects), error handling (missing try-catch, unhandled JSON), accessibility (missing aria attributes, no focus traps), UX (stale form state, missing confirmations), and data integrity (race conditions, missing null checks). These span the main app, evolution admin UI, server actions, API routes, hooks, and services. Each bug needs a targeted fix plus a regression test to prevent recurrence.

## Options Considered
- [x] **Option A: Phased by severity** — Fix critical/security first, then high, then medium. Each phase runs lint/tsc/build + tests before proceeding.
- [ ] **Option B: Phased by area** — Fix all main app bugs, then all evolution bugs, then all admin bugs. Harder to prioritize security.
- [ ] **Option C: All at once** — Fix everything in a single pass. Too risky — a single broken fix blocks everything.

Selected: **Option A** — severity-based phases ensure security issues are fixed first and each phase is independently testable.

## Phased Execution Plan

### Phase 1: Security & Critical Fixes (Bugs 1-8, 30, 49)
- [ ] Bug 1: Validate `next` param in `/auth/callback` — use `new URL(next, origin)` and verify `url.origin === origin` to block protocol-relative and absolute URLs (e.g. `//evil.com`, `/\evil.com`). Reject if origin mismatches, fallback to `/`.
- [ ] Bug 2: Validate `next` param in `/auth/confirm` — different code path from Bug 1 (uses bare `redirect(next)` not origin concat). Extract shared `sanitizeRedirectPath(next: string): string` helper used by both routes. Helper parses with `new URL()`, verifies same-origin, returns sanitized path or `/`.
- [ ] Bug 49: Add `NODE_ENV !== 'production'` guard for `/debug-critic` and `/test-global-error` route exclusions in middleware — security issue, must be Phase 1
- [ ] Bug 30: Change auth check from `authResult.error` to `!authResult.data` in runAISuggestionsPipeline — auth bypass risk, must be Phase 1
- [ ] Bug 3: Remove dead `/forgot-password` link from login page (replace with inline text or implement route)
- [ ] Bug 4: Reset `isSubmitting` in HomeSearchPanel after `router.push()` completes or in a finally block
- [ ] Bug 5: Return 400 (not 500) for malformed JSON in API routes — add `try { body = await request.json() } catch { return NextResponse.json({error: 'Invalid JSON'}, {status: 400}) }` to each route. Also check `Content-Type` header.
- [ ] Bug 6: Add `useEffect` to FormDialog to reset state when `open` changes to `true`
- [ ] Bug 7: Migrate FormDialog from raw `<div>` to Radix Dialog primitives (from existing `src/components/ui/dialog.tsx`). This provides `role="dialog"`, `aria-modal`, focus trap, Escape key, and backdrop click for free. Also fix ConfirmDialog (same raw-div issue) to use Radix Dialog.
- [ ] Bug 8: Reset ExperimentForm state after successful submission
- [ ] Write unit tests for this phase: auth redirect validation, FormDialog reset, ConfirmDialog a11y
- [ ] Write E2E test: `src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts` (tag `@critical`)
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` to catch regressions in evolution pages (FormDialog blast radius)
- [ ] Commit phase 1

### Phase 2: High-Severity Fixes — Hooks & React (Bugs 9-10, 23-25)
- [ ] Bug 9: Wrap `saveUserQuery` with `serverReadRequestId`
- [ ] Bug 10: Add `isMountedRef` to `useExplanationLoader` — check before each setState in the async chain. Set `isMountedRef.current = false` in useEffect cleanup.
- [ ] Bug 23: Memoize callback props in `src/app/results/page.tsx` before passing to `useExplanationLoader` — wrap `onTagsLoad`, `onMatchesLoad`, `onClearPrompt`, `onSetOriginalValues`, `onSourcesLoad` with `useCallback`
- [ ] Bug 24: Fix stale closure in `useStreamingEditor` — use `useRef` for `isStreaming` value read inside setTimeout, keeping the state variable for re-renders
- [ ] Bug 25: Store RAF IDs in a `Set<number>` ref in `TextRevealPlugin`; cancel all in cleanup function via `cancelAnimationFrame`
- [ ] Write unit tests: `useExplanationLoader` abort on unmount, `useStreamingEditor` debounce timing
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` — verify no regressions
- [ ] Commit phase 2

### Phase 3: High-Severity Fixes — Evolution Pipeline & UI (Bugs 11-17)
- [ ] Bug 11: Add null guards around `osRate()` result access in `computeRatings.ts` — check `result[0]?.length` before indexing
- [ ] Bug 12: Add null check before using `localRatings.get()` results in `rankVariants.ts` — log warning and skip match if missing
- [ ] Bug 13: Replace hardcoded `bg-white`/`dark:bg-slate-900` in Sheet with `bg-[var(--surface-secondary)]` and `border-[var(--border-default)]`
- [ ] Bug 14: Add D3 zoom cleanup in `LineageGraph` useEffect return — call `svg.on('.zoom', null)` to remove zoom listeners
- [ ] Bug 15: Compute LogsTab iteration dropdown max from actual data — use `Math.max(...logs.map(l => l.iteration ?? 0))` without the `Math.max(..., 20)` floor
- [ ] Bug 16: Pre-compute rank map from unfiltered list, display `rankMap[v.id]` instead of filtered index
- [ ] Bug 17: Read actual cost from run data in `RelatedRunsTab.normalizeExperimentRun` — use `Number(r.total_cost ?? r.cost_usd ?? 0)`
- [ ] Write unit tests: computeRatings null input, rankVariants missing map entry, LogsTab dropdown, VariantsTab rank with filter
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:evolution` — verify no regressions in evolution E2E suite
- [ ] Commit phase 3

### Phase 4: High-Severity Fixes — Admin & Data Integrity (Bugs 18-22)
- [ ] Bug 18: Add confirmation dialog to feature flag toggle — reuse the now-fixed ConfirmDialog from Phase 1
- [ ] Bug 19: Replace `confirm()` with ConfirmDialog in WhitelistContent delete — reuse existing component
- [ ] Bug 20: Add error checking to rollback deletes in experiment batch creation — log rollback failures and include in error message to surface to admin. Define escalation: if rollback fails, log error with orphaned IDs for manual cleanup.
- [ ] Bug 21: Add `if (!data)` null check after `.single()` calls in arena actions — return proper "not found" error
- [ ] Bug 22: Add limit clamping (`Math.min(Math.max(limit, 1), 200)`) and offset validation (`Math.max(offset, 0)`) to listPrompts/listStrategies — match pattern in getEvolutionRunsAction
- [ ] Write unit tests: arena actions null handling, pagination clamping, rollback error handling
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` — verify no regressions
- [ ] Commit phase 4

### Phase 5: Medium Fixes — Server Actions & API (Bugs 26-29)
- [ ] Bug 26: Replace `!` non-null assertions with `?? null` in `loadAISuggestionSessionAction`
- [ ] Bug 27: Standardize error response shapes — add `success` field to source actions (`getTopSourcesAction`, `getPopularSourcesByTopicAction`, `getSimilarArticleSourcesAction`). Ensure JSON shape matches `{ success: boolean; data: T | null; error: ErrorResponse | null }`
- [ ] Bug 28: Return `NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })` (not plain text) in stream-chat catch block. Verify client parser expects JSON.
- [ ] Bug 29: Add `export const maxDuration = 540` to returnExplanation and stream-chat routes
- [ ] Write unit tests: stream-chat JSON error format, source action response shapes, maxDuration exports present
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` — verify no regressions
- [ ] Commit phase 5

> Note: Bug 30 moved to Phase 1 (security). Bug numbering preserved for traceability.

### Phase 6: Medium Fixes — Admin UX (Bugs 31, 34, 36-42)
- [ ] Bug 31: Add ConfirmDialog for hide/restore in ExplanationDetailModal — reuse existing component
- [ ] Bug 34: Add pre-apply source count validation in SourceEditor — check `sources.filter(s => s.status === 'success').length <= 5` before calling action, show toast if exceeded
- [ ] Bug 36: Add `error` state to admin dashboard — wrap Promise.all in try-catch, show error banner when any fetch fails
- [ ] Bug 37: Add "No variants match this filter" empty state to VariantsTab when `filtered.length === 0 && !loading`
- [ ] Bug 39: Add JS-side budget validation in ExperimentForm — `onChange` handler clamps: `Math.min(Math.max(val, 0.01), 1.00)`
- [ ] Bug 40: Add `disabled={isToggling}` to kill switch confirm button during async submission
- [ ] Bug 41: Add missing audit action types (`toggle_kill_switch`, `update_cost_config`, `queue_evolution_run`) and entity types to filter dropdown
- [ ] Bug 42: Use single-statement atomic version increment in whitelist snapshot rebuild: `INSERT INTO ... SELECT COALESCE(MAX(version), 0) + 1 FROM ... ON CONFLICT DO UPDATE` — a single SQL statement is atomic within its own transaction
- [ ] Write unit tests: SourceEditor count validation, VariantsTab empty state, budget clamping, kill switch button disabled state, whitelist version increment atomicity
- [ ] Write E2E test: `src/__tests__/e2e/specs/09-admin/admin-confirmations.spec.ts` — verify feature flag, whitelist, content modal confirmations (tag `@critical`)
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` — verify no regressions
- [ ] Commit phase 6

### Phase 7: Medium Fixes — Accessibility & UX Polish (Bugs 32-33, 35, 38, 43-48, 50)
- [ ] Bug 32: Guard content sync to allow empty string — change `if (contentToSync)` to `if (contentToSync !== undefined)`
- [ ] Bug 33: Remove dead CitationTooltip component (unused, adds bundle weight). If tooltip is desired later, can be rebuilt.
- [ ] Bug 35: Add pagination to explore page — convert to client-side load-more pattern: ExploreGalleryPage fetches initial 20 via server action, client "Load more" button calls `getRecentExplanationsAction` for next page and appends
- [ ] Bug 38: Verify EntityDetailHeader copy button is a native `<button>` (validated as false positive during review — if already a button, skip)
- [ ] Bug 43: Add `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>` to Navigation, add `id="main-content"` to main content wrapper
- [ ] Bug 44: Replace `confirm()` with ConfirmDialog in CandidatesContent delete — reuse existing component
- [ ] Bug 45: Add `focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2` to FilterPills buttons
- [ ] Bug 46: Add `scope="col"` to all `<th>` elements in MetricsTab tables (3 tables, 11 headers total)
- [ ] Bug 47: Add `id` attributes to FormDialog inputs, `htmlFor` to labels, `aria-describedby` linking inputs to error div
- [ ] Bug 48: Add `export const metadata = { title: 'Explore Explanations', description: '...' }` to explore page
- [ ] Bug 50: Add `aria-expanded={isOpen}` to HomeTagSelector dropdown trigger buttons
- [ ] Write E2E tests: accessibility spec (skip-nav, focus rings, aria attributes), explore pagination spec
- [ ] Run lint, tsc, build, unit tests
- [ ] Run `npm run test:e2e:critical` — final regression check
- [ ] Commit phase 7

> Note: Bug 49 moved to Phase 1 (security). Bug 38 may be skipped if already a native button.

### Phase 8: Final Regression Suite & Cleanup
> Tests are now written per-phase (Phases 1-7 each include their own tests). Phase 8 runs the full suite and adds any remaining coverage.

- [ ] Write E2E test: `src/__tests__/e2e/specs/09-admin/admin-confirmations.spec.ts` — verify feature flag, whitelist, candidates, content modal all require confirmation (tag `@critical`)
- [ ] Write E2E test: `src/__tests__/e2e/specs/09-admin/evolution-ui-fixes.spec.ts` — verify LogsTab dropdown, VariantsTab ranks, RelatedRunsTab cost (tag `@evolution`)
- [ ] Audit test coverage: verify every bug has at least one unit OR E2E test
- [ ] Run FULL test suite: `npm run lint && npm run tsc && npm run build && npm test && npm run test:e2e`
- [ ] Verify existing 178 E2E tests still pass (no regressions)
- [ ] Commit phase 8

### Rollback Strategy
- Each phase is a separate commit on a feature branch — can `git revert` any phase independently
- If build breaks mid-phase, `git stash` partial work and fix before committing
- If E2E suite breaks after a phase commit, revert that phase's commit and investigate before proceeding

## Testing

> Tests are written per-phase alongside fixes (not deferred). Each phase includes "Write tests" + "Run tests" steps.

### Test Coverage Matrix (all 50 bugs)

| Bug | Test Type | Phase | Notes |
|-----|-----------|-------|-------|
| 1 | Unit + E2E | P1 | sanitizeRedirectPath rejects external URLs |
| 2 | Unit + E2E | P1 | shared sanitizer for confirm route |
| 3 | E2E | P1 | existing auth.unauth.spec covers login page links |
| 4 | Unit | P1 | HomeSearchPanel isSubmitting reset test |
| 5 | Unit | P1 | API route returns 400 for malformed JSON (test each route) |
| 6 | Unit | P1 | FormDialog state reset on reopen |
| 7 | Unit | P1 | ConfirmDialog/FormDialog Radix migration: aria-modal, Escape, focus |
| 8 | Unit | P1 | ExperimentForm reset after submit |
| 9 | Unit | P2 | verify serverReadRequestId wrapping |
| 10 | Unit | P2 | isMountedRef prevents setState after unmount |
| 11 | Unit | P3 | computeRatings null guard |
| 12 | Unit | P3 | rankVariants missing map entry |
| 13 | Manual | P3 | theme switch — visual check across 7 palettes |
| 14 | Unit | P3 | LineageGraph cleanup removes zoom listeners |
| 15 | Unit | P3 | LogsTab dropdown matches actual iterations |
| 16 | Unit | P3 | VariantsTab rank from unfiltered list |
| 17 | E2E | P8 | evolution-ui-fixes.spec covers cost display |
| 18 | E2E | P6 | admin-confirmations.spec covers feature flags |
| 19 | E2E | P6 | admin-confirmations.spec covers whitelist delete |
| 20 | Unit | P4 | rollback error handling test |
| 21 | Unit | P4 | arena actions null data after .single() |
| 22 | Unit | P4 | pagination clamping test |
| 23 | Unit | P2 | callback memoization verified via render count |
| 24 | Unit | P2 | useStreamingEditor ref-based isStreaming |
| 25 | Unit | P2 | TextRevealPlugin RAF cancellation |
| 26 | Unit | P5 | non-null assertion replaced, null fields handled |
| 27 | Unit | P5 | source action response shape standardized |
| 28 | Unit | P5 | stream-chat JSON error response |
| 29 | Unit | P5 | maxDuration export presence check |
| 30 | Unit | P1 | auth check uses !authResult.data |
| 31 | E2E | P6 | admin-confirmations.spec covers content modal |
| 32 | Unit | P7 | content sync allows empty string |
| 33 | N/A | P7 | dead code removal — no test needed |
| 34 | Unit | P6 | SourceEditor count validation |
| 35 | E2E | P7 | explore-pagination.spec |
| 36 | Unit | P6 | admin dashboard error state |
| 37 | Unit | P6 | VariantsTab empty state after filter |
| 38 | Skip | P7 | already native button (validated false positive) |
| 39 | Unit | P6 | budget input clamping |
| 40 | Unit | P6 | kill switch button disabled during submission |
| 41 | Unit | P6 | audit filter dropdown includes all action types |
| 42 | Unit | P6 | whitelist version atomic increment |
| 43 | E2E | P7 | accessibility.spec covers skip-nav |
| 44 | E2E | P6 | admin-confirmations.spec covers candidates |
| 45 | E2E | P7 | accessibility.spec covers focus rings |
| 46 | Unit | P7 | th scope="col" presence check |
| 47 | Unit | P7 | FormDialog input id, label htmlFor, aria-describedby |
| 48 | Unit | P7 | generateMetadata export present |
| 49 | Unit | P1 | middleware NODE_ENV guard test |
| 50 | E2E | P7 | accessibility.spec covers aria-expanded |

### Unit Tests (written in Phases 1-6)
- [ ] `src/app/auth/callback/route.test.ts` — test `sanitizeRedirectPath` rejects `//evil.com`, `https://evil.com`, `/\evil.com` (Phase 1)
- [ ] `src/app/auth/confirm/route.test.ts` — test shared sanitizer works for confirm route (Phase 1)
- [ ] `evolution/src/components/evolution/dialogs/FormDialog.test.tsx` — test state reset on reopen, Escape key closes, focus trapped (Phase 1)
- [ ] `evolution/src/components/evolution/dialogs/ConfirmDialog.test.tsx` — test Radix Dialog a11y attributes present (Phase 1)
- [ ] `src/hooks/useExplanationLoader.test.ts` — test isMountedRef prevents setState after unmount (Phase 2)
- [ ] `src/hooks/useStreamingEditor.test.ts` — test debounce uses current isStreaming via ref (Phase 2)
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — test null/empty openskill result handling (Phase 3)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test missing map entry logs warning and skips (Phase 3)
- [ ] `evolution/src/components/evolution/tabs/LogsTab.test.tsx` — test dropdown max matches actual iteration count (Phase 3)
- [ ] `evolution/src/components/evolution/tabs/VariantsTab.test.tsx` — test rank shows unfiltered position (Phase 3)
- [ ] `evolution/src/services/arenaActions.test.ts` — test null data after .single() returns error (Phase 4)
- [ ] `src/app/api/stream-chat/route.test.ts` — test error returns JSON not plain text (Phase 5)
- [ ] `src/components/sources/SourceEditor.test.tsx` — test count validation before apply (Phase 6)

### E2E Tests (written per-phase, following existing conventions)
- [ ] `src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts` — verify auth redirects stay on-origin (Phase 1, tag `@critical`)
- [ ] `src/__tests__/e2e/specs/09-admin/admin-confirmations.spec.ts` — verify feature flag, whitelist, candidates require confirmation (Phase 8, tag `@critical`)
- [ ] `src/__tests__/e2e/specs/09-admin/evolution-ui-fixes.spec.ts` — verify LogsTab, VariantsTab, RelatedRunsTab fixes (Phase 8, tag `@evolution`)
- [ ] `src/__tests__/e2e/specs/10-accessibility/accessibility.spec.ts` — verify skip-nav, focus rings, aria-expanded (Phase 7)
- [ ] `src/__tests__/e2e/specs/04-content-viewing/explore-pagination.spec.ts` — verify load-more works (Phase 7)

### Manual Verification
- [ ] Test theme switching with Sheet component (verify no white/gray flash in all 7 palettes)
- [ ] Test FormDialog in evolution admin (create prompt, cancel, reopen — verify clean state)
- [ ] Test keyboard navigation: Tab through FilterPills, FormDialog, admin confirmations
- [ ] Test login page — verify no /forgot-password 404
- [ ] Test explore page — verify load-more button loads additional content
- [ ] Test admin dashboard — verify error banner appears when backend is down
- [ ] Test evolution variants tab — verify ranks don't change when filtering by strategy

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npm run test:e2e:critical` — run after each phase to catch regressions early
- [ ] `npm run test:e2e:evolution` — run after Phases 3, 4, 6 (evolution UI changes)
- [ ] `npm run test:e2e` — full suite run in Phase 8

### B) Automated Tests (run per-phase)
- [ ] `npm run lint` — no lint errors (per-phase)
- [ ] `npm run tsc` — no type errors (per-phase)
- [ ] `npm run build` — successful build (per-phase)
- [ ] `npm test` — all unit tests pass (per-phase)
- [ ] `npm run test:e2e` — all E2E tests pass including new specs (Phase 8 final)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/visualization.md` — update FormDialog, LogsTab, VariantsTab, LineageGraph descriptions
- [ ] `evolution/docs/entities.md` — update entity action matrix if confirmation behavior changes
- [ ] `evolution/docs/reference.md` — update if file references change

## Review & Discussion

### Iteration 1 (Scores: Security 3/5, Architecture 3/5, Testing 2/5)

**Critical gaps fixed:**

1. **[Security] Open redirect validation underspecified** → Fixed: Now uses `new URL(next, origin)` with hostname comparison. Handles `//evil.com`, `/\evil.com`, protocol-relative URLs.
2. **[Security] Bug 2 different code path from Bug 1** → Fixed: Extracted shared `sanitizeRedirectPath()` helper. Plan acknowledges `/auth/confirm` uses bare `redirect()` vs `/auth/callback` origin concat.
3. **[Security] Bug 49 (debug routes) in wrong phase** → Fixed: Moved to Phase 1 alongside open redirects.
4. **[Security] Bug 30 (auth bypass) in wrong phase** → Fixed: Moved to Phase 1.
5. **[Architecture] FormDialog should use Radix Dialog** → Fixed: Phase 1 now migrates FormDialog AND ConfirmDialog to Radix Dialog primitives from existing `src/components/ui/dialog.tsx`.
6. **[Architecture] ConfirmDialog has same issues but not listed** → Fixed: ConfirmDialog included in Bug 7 fix scope. All phases using ConfirmDialog (18, 19, 31, 44) now reference the fixed component.
7. **[Architecture] No regression safeguard after FormDialog change** → Fixed: Phase 1 now runs `npm run test:e2e:critical` after changes to catch evolution page regressions.
8. **[Testing] Tests deferred to Phase 8** → Fixed: Every phase now includes "Write tests" and "Run tests" steps. Tests written alongside fixes.
9. **[Testing] E2E paths break conventions** → Fixed: E2E specs placed in existing directories (01-auth/, 09-admin/, 04-content-viewing/) plus new 10-accessibility/.
10. **[Testing] No per-phase critical E2E run** → Fixed: Every phase runs `npm run test:e2e:critical` before commit.
11. **[Testing] No rollback plan** → Fixed: Added Rollback Strategy section with per-commit revert approach.

### Iteration 2 (Scores: Security 4/5, Architecture 5/5, Testing 3/5)

**Critical gaps fixed:**

1. **[Testing] 16 bugs lacked explicit test coverage** → Fixed: Added comprehensive Test Coverage Matrix mapping all 50 bugs to test type, phase, and notes. Bug 33 (dead code removal) marked N/A, Bug 38 (false positive) marked Skip, Bug 13 (visual) marked Manual. All others have unit or E2E test.
2. **[Testing] Phase 5 omitted test:e2e:critical** → Fixed: Added `npm run test:e2e:critical` to Phase 5 and Phase 6.

**Minor issues addressed:**
- Phase 6 now includes E2E admin-confirmations.spec written alongside fixes (not deferred to Phase 8)
- Phase 6 unit tests expanded to cover kill switch disabled state and whitelist version atomicity

### Iteration 3 — CONSENSUS REACHED (Security 5/5, Architecture 5/5, Testing 5/5)

All reviewers voted 5/5 with zero critical gaps. Plan is ready for execution.

**Remaining minor notes for implementation:**
- Bug 42: Consider advisory lock if high concurrency expected on whitelist snapshot rebuild
- Bug 5: Define fallback when Content-Type header is missing (attempt parse, return 400 on failure)
- Bug 28: Verify client-side SSE parser handles JSON error response after stream start
- Phase 8 admin-confirmations.spec: already written in Phase 6 — Phase 8 just runs it, does not re-create
- Bug 36: Admin dashboard error state may need E2E test in addition to unit test (server-rendered page)
