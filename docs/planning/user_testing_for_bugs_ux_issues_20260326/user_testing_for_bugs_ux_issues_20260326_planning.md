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

### Phase 1: Security & Critical Fixes (Bugs 1-8)
- [ ] Bug 1: Validate `next` param in `/auth/callback` — ensure it starts with `/` and has no protocol
- [ ] Bug 2: Validate `next` param in `/auth/confirm` — same validation as Bug 1
- [ ] Bug 3: Remove dead `/forgot-password` link from login page (replace with inline text or implement route)
- [ ] Bug 4: Reset `isSubmitting` in HomeSearchPanel after `router.push()` completes or in a finally block
- [ ] Bug 5: Return 400 (not 500) for malformed JSON in API routes — add specific SyntaxError catch
- [ ] Bug 6: Add `useEffect` to FormDialog to reset state when `open` changes to `true`
- [ ] Bug 7: Add `role="dialog"`, `aria-modal="true"`, Escape key handler, and focus trap to FormDialog
- [ ] Bug 8: Reset ExperimentForm state after successful submission
- [ ] Run lint, tsc, build
- [ ] Run unit tests for changed files
- [ ] Commit phase 1

### Phase 2: High-Severity Fixes — Hooks & React (Bugs 9-10, 23-25)
- [ ] Bug 9: Wrap `saveUserQuery` with `serverReadRequestId`
- [ ] Bug 10: Add `AbortController` or `isMountedRef` to `useExplanationLoader` for async cleanup
- [ ] Bug 23: Memoize callback props passed to `useExplanationLoader` in results page
- [ ] Bug 24: Fix stale closure in `useStreamingEditor` debounce — capture `isStreaming` at call time
- [ ] Bug 25: Store RAF IDs in `TextRevealPlugin` and cancel them in cleanup function
- [ ] Run lint, tsc, build
- [ ] Run unit tests for hooks
- [ ] Commit phase 2

### Phase 3: High-Severity Fixes — Evolution Pipeline & UI (Bugs 11-17)
- [ ] Bug 11: Add null guards around `osRate()` result access in `computeRatings.ts`
- [ ] Bug 12: Add null check before using `localRatings.get()` results in `rankVariants.ts`
- [ ] Bug 13: Replace hardcoded `bg-white`/`dark:bg-slate-900` in Sheet with CSS variable classes
- [ ] Bug 14: Add D3 zoom cleanup in `LineageGraph` useEffect return function
- [ ] Bug 15: Compute LogsTab iteration dropdown max from actual data (remove `Math.max(..., 20)`)
- [ ] Bug 16: Show original rank (from unfiltered list) in VariantsTab instead of filtered index
- [ ] Bug 17: Read actual cost from run data in `RelatedRunsTab.normalizeExperimentRun`
- [ ] Run lint, tsc, build
- [ ] Run evolution unit tests
- [ ] Commit phase 3

### Phase 4: High-Severity Fixes — Admin & Data Integrity (Bugs 18-22)
- [ ] Bug 18: Add confirmation dialog to feature flag toggle in admin settings
- [ ] Bug 19: Replace `confirm()` with accessible modal in WhitelistContent delete
- [ ] Bug 20: Add error checking to rollback deletes in experiment batch creation
- [ ] Bug 21: Add `if (!data)` null check after `.single()` calls in arena actions
- [ ] Bug 22: Add limit clamping (1-200) and offset validation (>=0) to listPrompts/listStrategies actions
- [ ] Run lint, tsc, build
- [ ] Run admin + evolution unit tests
- [ ] Commit phase 4

### Phase 5: Medium Fixes — Server Actions & API (Bugs 26-30)
- [ ] Bug 26: Replace `!` non-null assertions with `?? null` in `loadAISuggestionSessionAction`
- [ ] Bug 27: Standardize error response shapes — add `success` field to source actions
- [ ] Bug 28: Return JSON error (not plain text) in stream-chat catch block
- [ ] Bug 29: Add `export const maxDuration = 540` to returnExplanation and stream-chat routes
- [ ] Bug 30: Change auth check to `!authResult.data` in runAISuggestionsPipeline route
- [ ] Run lint, tsc, build
- [ ] Run API route tests
- [ ] Commit phase 5

### Phase 6: Medium Fixes — Admin UX (Bugs 31, 34, 36-42)
- [ ] Bug 31: Add confirmation dialog for hide/restore in ExplanationDetailModal
- [ ] Bug 34: Add pre-apply source count validation in SourceEditor (check <= 5 before submit)
- [ ] Bug 36: Add error state to admin dashboard — show banner when API calls fail
- [ ] Bug 37: Add "No variants match this filter" empty state to VariantsTab
- [ ] Bug 39: Add JS-side budget validation in ExperimentForm (clamp to min/max on change)
- [ ] Bug 40: Disable kill switch confirm button during async submission
- [ ] Bug 41: Add missing audit action types to filter dropdown
- [ ] Bug 42: Use atomic version increment in whitelist snapshot rebuild (SQL `max(version)+1`)
- [ ] Run lint, tsc, build
- [ ] Commit phase 6

### Phase 7: Medium Fixes — Accessibility & UX Polish (Bugs 32-33, 35, 38, 43-50)
- [ ] Bug 32: Guard content sync to allow empty string (check `!== undefined` not falsy)
- [ ] Bug 33: Wire CitationTooltip into inline citation rendering (or remove dead code)
- [ ] Bug 35: Add pagination (load-more button) to explore page
- [ ] Bug 38: Ensure EntityDetailHeader copy button is a `<button>` with proper keyboard support
- [ ] Bug 43: Add skip-navigation link to Navigation component
- [ ] Bug 44: Replace `confirm()` with accessible modal in CandidatesContent delete
- [ ] Bug 45: Add `focus-visible:ring-2` classes to FilterPills buttons
- [ ] Bug 46: Add `scope="col"` to `<th>` elements in MetricsTab tables
- [ ] Bug 47: Add `id` to inputs, `htmlFor` to labels, `aria-describedby` to error messages in FormDialog
- [ ] Bug 48: Add `generateMetadata` export to explore page with title/description
- [ ] Bug 49: Add `NODE_ENV` guard for debug routes in middleware
- [ ] Bug 50: Add `aria-expanded` attribute to HomeTagSelector dropdown buttons
- [ ] Run lint, tsc, build
- [ ] Commit phase 7

### Phase 8: Regression Tests
- [ ] Write E2E tests for security fixes (auth redirect validation)
- [ ] Write E2E tests for FormDialog reset behavior
- [ ] Write E2E tests for admin confirmation dialogs
- [ ] Write E2E tests for evolution UI fixes (LogsTab, VariantsTab, LineageGraph)
- [ ] Write unit tests for hook fixes (useExplanationLoader, useStreamingEditor)
- [ ] Write unit tests for server action fixes (response shapes, null checks)
- [ ] Write unit tests for API route error handling
- [ ] Run full test suite: `npm run lint && npm run tsc && npm run build && npm run test:unit && npm run test:e2e`
- [ ] Commit phase 8

## Testing

### Unit Tests
- [ ] `src/app/auth/callback/route.test.ts` — test redirect validation rejects external URLs
- [ ] `src/app/auth/confirm/route.test.ts` — test redirect validation rejects external URLs
- [ ] `src/hooks/useExplanationLoader.test.ts` — test abort on unmount
- [ ] `src/hooks/useStreamingEditor.test.ts` — test debounce with streaming state changes
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — test empty openskill result handling
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test missing map entry handling
- [ ] `evolution/src/components/evolution/dialogs/FormDialog.test.tsx` — test state reset on reopen
- [ ] `evolution/src/components/evolution/tabs/LogsTab.test.tsx` — test iteration dropdown matches data
- [ ] `evolution/src/components/evolution/tabs/VariantsTab.test.tsx` — test rank preservation with filters
- [ ] `evolution/src/services/arenaActions.test.ts` — test null data handling after .single()
- [ ] `src/app/api/stream-chat/route.test.ts` — test JSON error response format

### Integration Tests
- [ ] `src/__tests__/integration/auth-redirect.integration.test.ts` — test open redirect prevention end-to-end

### E2E Tests
- [ ] `src/__tests__/e2e/specs/10-bugfixes/auth-security.spec.ts` — verify auth redirects stay on-origin
- [ ] `src/__tests__/e2e/specs/10-bugfixes/form-dialog-reset.spec.ts` — verify FormDialog clears on reopen
- [ ] `src/__tests__/e2e/specs/10-bugfixes/admin-confirmations.spec.ts` — verify destructive actions need confirmation
- [ ] `src/__tests__/e2e/specs/10-bugfixes/evolution-ui-fixes.spec.ts` — verify LogsTab, VariantsTab, LineageGraph fixes
- [ ] `src/__tests__/e2e/specs/10-bugfixes/accessibility.spec.ts` — verify skip-nav, focus rings, aria attributes
- [ ] `src/__tests__/e2e/specs/10-bugfixes/explore-pagination.spec.ts` — verify explore load-more works

### Manual Verification
- [ ] Test theme switching with Sheet component (verify no white/gray flash)
- [ ] Test FormDialog in evolution admin (create prompt, cancel, reopen — verify clean state)
- [ ] Test keyboard navigation through FilterPills, FormDialog, admin pages
- [ ] Test login page — verify no /forgot-password 404

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/10-bugfixes/` — run all bugfix E2E specs
- [ ] `npx playwright test --grep "@critical"` — verify no regressions in critical tests

### B) Automated Tests
- [ ] `npm run lint` — no lint errors
- [ ] `npm run tsc` — no type errors
- [ ] `npm run build` — successful build
- [ ] `npm run test:unit` — all unit tests pass
- [ ] `npm run test:e2e` — all E2E tests pass (existing + new)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/visualization.md` — update FormDialog, LogsTab, VariantsTab, LineageGraph descriptions
- [ ] `evolution/docs/entities.md` — update entity action matrix if confirmation behavior changes
- [ ] `evolution/docs/reference.md` — update if file references change

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
