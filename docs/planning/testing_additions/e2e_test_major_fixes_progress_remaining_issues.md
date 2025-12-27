# E2E Test Remaining Issues

Status tracking for remaining E2E test issues after the major fixes implementation.

---

## Summary

After implementing the major E2E test fixes (auth, data seeding, streaming mock, lifecycle waits), there are still several categories of test failures. This document tracks the remaining issues and their root causes.

**Latest Run (2025-12-27 - After Issue #12 and #13 Fixes):**
- 116 passed ✅
- 4 failed (pre-existing error recovery issues)
- 3 skipped

**Status Update (2025-12-26):**
All 5 issue categories have been fixed in commit `2332e88`. See "Fixed Issues" section below for details.

**Status Update (2025-12-27):**
Additional fixes applied in commit `e217339`:
- Fixed streaming mock property name mismatch (`explanation_id` → `explanationId`)
- Improved `enterEditMode()` reliability with force click and retry logic
- Streaming tests now pass when run in isolation with 1 worker

**Status Update (2025-12-27 - Systematic Debugging Session):**
Used systematic debugging to resolve the Playwright mock vs server-side mock conflict. Four additional issues identified and fixed:
- Mock handler title mismatch (issues #8)
- Server-side mock progress event format (issue #9)
- Missing getUserQueryByIdAction mock handler (issue #10)
- waitForStreamingComplete not waiting for page load (issue #11)

**Test Results After Fixes:**
- `search-generate.spec.ts`: 13 passed, 2 skipped ✅
- `action-buttons.spec.ts`: 11 passed ✅
- Playwright mock vs server-side mock conflict: **RESOLVED**

---

## Issue Categories

### 1. Server Instability (ECONNRESET)

**Symptom:**
```
[Error: aborted] { code: 'ECONNRESET', digest: '434492021' }
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
```

**Affected Tests:** ~30% of all tests intermittently

**Root Cause:**
Running 4 parallel Playwright workers overwhelms the Next.js dev server. The server drops connections under load, causing navigation timeouts.

**Evidence:**
- Tests pass on retry when server recovers
- Errors appear mid-run, not at start
- More failures in later tests as server degrades

**Fix Options:**
1. **Reduce workers:** `--workers=1` or `--workers=2`
2. **Increase timeouts:** Add buffer for slow server responses
3. **Use production build:** `npm run build && npm start` instead of dev server
4. **Add health checks:** Verify server is responsive before each test

**Priority:** P1 - Affects test reliability

---

### 2. Streaming Mock Not Completing

**Symptom:**
```
TimeoutError: locator.waitFor: Timeout 60000ms exceeded.
waiting for locator('[data-testid="stream-complete"]')
```

**Affected Tests:**
- `should save explanation to library when save button clicked`
- `should disable save button after successful save`
- `should display full content after streaming completes`
- `should show stream-complete indicator when generation finishes`
- `should preserve query in URL after generation`

**Root Cause:**
The mock streaming in `test-mode.ts` sends events but the `stream-complete` indicator doesn't always get attached to the DOM. Possible causes:
1. Race condition between streaming completion and React state update
2. Mock doesn't send all required events for completion detection
3. Router redirect happens before completion indicator renders

**Evidence:**
- Tests timeout waiting for `[data-testid="stream-complete"]`
- Screenshots show content loaded but no completion indicator

**Fix Options:**
1. **Debug mock response:** Verify all required events are sent
2. **Add completion logging:** Track when `stream-complete` should appear
3. **Alternative wait:** Wait for URL with `explanation_id` instead of indicator

**Priority:** P1 - Blocks Save Button Flow tests

---

### 3. AI Suggestions - Editor Not Ready

**Symptom:**
```
TimeoutError: locator.textContent: Timeout 30000ms exceeded.
waiting for locator('[contenteditable="true"]').or(locator('[data-testid="lexical-editor"]'))
```

**Affected Tests:** All `06-ai-suggestions/*` specs (~30 tests)
- `error-recovery.spec.ts`
- `editor-integration.spec.ts`
- `content-boundaries.spec.ts`
- `save-blocking.spec.ts`
- `state-management.spec.ts`
- `suggestions.spec.ts`

**Root Cause:**
AI suggestions tests require the editor to be in edit mode (`contenteditable="true"`), but:
1. Tests view saved explanations from library (read-only mode)
2. Editor doesn't auto-enter edit mode when AI panel opens
3. No explicit "Enter Edit Mode" step before testing suggestions

**Evidence:**
- All failures on same selector
- Tests work when manually clicking Edit button first

**Fix Options:**
1. **Add Edit button click:** Before AI suggestions, enter edit mode
2. **Auto-edit on panel open:** When AI panel opens, auto-enter edit mode
3. **Update selector:** Use read-only editor selector for read operations

**Priority:** P2 - Large test suite affected but not core flows

---

### 4. Add Tag Flow - Missing UI Element

**Symptom:**
```
Error: page.click: Timeout exceeded.
waiting for locator('[data-testid="add-tag-trigger"]')
```

**Affected Tests:**
- `should open tag input when add button clicked`
- `should handle cancel button click`

**Root Cause:**
The `[data-testid="add-tag-trigger"]` element doesn't exist or isn't visible in the current UI. Either:
1. UI was refactored and test-id removed
2. Element only appears under certain conditions
3. Element is behind a different interaction pattern

**Fix Options:**
1. **Verify UI:** Check if add-tag-trigger exists in current codebase
2. **Update test:** Use correct selector or interaction pattern
3. **Skip tests:** If feature was removed, skip these tests

**Priority:** P3 - Limited scope (2 tests)

---

### 5. Save Blocking - Null Title Attribute

**Symptom:**
```
Matcher error: received value must not be null nor undefined
Received has value: null

expect(title).not.toContain('Accept or reject AI suggestions');
```

**Affected Tests:**
- `save button should be enabled after accepting all suggestions`
- `save button should be enabled after rejecting all suggestions`

**Root Cause:**
The test assumes the Save button always has a `title` attribute, but after accepting/rejecting suggestions, the title is removed (null) rather than being an empty string.

**Fix:**
```typescript
// Before
expect(title).not.toContain('Accept or reject AI suggestions');

// After
expect(title ?? '').not.toContain('Accept or reject AI suggestions');
```

**Priority:** P3 - Simple assertion fix

---

## Fixed Issues (This Session)

### All Remaining Issues Fixed ✅ (2025-12-26)

**Commit:** `2332e88` - fix(e2e): resolve remaining E2E test issues

All 5 issue categories have been addressed:

---

### 1. Server Instability (ECONNRESET) ✅

**Fix Applied:**
- Reduced Playwright workers in `playwright.config.ts:14`
- Changed from `CI ? 2 : undefined` to `CI ? 1 : 2`

**Files Modified:**
- `playwright.config.ts`

---

### 2. Streaming Mock Race Condition ✅

**Root Cause Confirmed:** `setStreamCompleted(true)` on line 413 of `results/page.tsx` is async, but `router.push()` on line 476 executes immediately without waiting for React to render the `stream-complete` indicator.

**Fix Applied:**
- Changed `waitForStreamingComplete()` to wait for URL redirect first (the reliable signal)
- URL contains `explanation_id` after streaming completes and redirect happens
- Optionally checks stream-complete indicator as secondary confirmation

**Files Modified:**
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:59-73`

---

### 3. AI Suggestions - Editor Not Ready ✅

**Root Cause Confirmed:** `waitForEditMode()` only waited for "Done" button to exist, but didn't actually click "Edit" button to enter edit mode. Tests load saved explanations which are read-only by default.

**Fix Applied:**
- Added `enterEditMode()` helper function that:
  1. Checks if already in edit mode (Done button visible)
  2. If not, clicks Edit button and waits for Done button
- Added `enterEditMode(page)` call before every `submitAISuggestionPrompt()` in all 7 spec files

**Files Modified:**
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts:258-276` (new helper)
- `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` (4 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts` (6 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts` (4 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/state-management.spec.ts` (6 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts` (5 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/save-blocking.spec.ts` (4 occurrences)
- `src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts` (6 occurrences)

---

### 4. Add Tag Flow - Missing UI Element ✅

**Root Cause Confirmed:** Element exists in `TagBar.tsx:475-486` but is conditionally rendered. Test clicked before element was visible.

**Fix Applied:**
- Added explicit visibility wait before clicking in `clickAddTagTrigger()` helper

**Files Modified:**
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:573-577`

---

### 5. Save Blocking - Null Title Attribute ✅

**Root Cause Confirmed:** JSX `title={undefined}` renders as null in DOM. `getAttribute('title')` returns null, causing assertion to fail.

**Fix Applied:**
- Changed `expect(title).not.toContain(...)` to `expect(title ?? '').not.toContain(...)`

**Files Modified:**
- `src/__tests__/e2e/specs/06-ai-suggestions/save-blocking.spec.ts:154,201`

---

### userSavedLoaded Race Condition ✅ (Previous Session)

**Original Issue:** "should show already saved state for existing saved explanations" failing with `Expected: "Saved", Received: "Save"`

**Root Cause:** `checkUserSaved()` async call completed after test checked button text

**Fix Applied:**
1. Added `userSavedLoaded` state to `useExplanationLoader.ts`
2. Added `data-user-saved-loaded` attribute to Save button
3. Updated `waitForUserSavedState()` to wait for `data-user-saved-loaded="true"`

**Status:** Test now passes when navigation succeeds (flaky due to server issues, not assertion)

---

## Additional Fixes (2025-12-27)

### 6. Streaming Mock Property Name Mismatch ✅

**Root Cause:** The API mock in `api-mocks.ts` was using `explanation_id` (snake_case) but the client code at `src/app/results/page.tsx:434` expected `explanationId` (camelCase). This caused URL redirects to fail after streaming.

**Fix Applied:**
- Changed `createSSEEvents()` in `api-mocks.ts` to use `explanationId` instead of `explanation_id`
- Changed interface and mock data to use numeric IDs instead of strings
- Updated `defaultMockExplanation` and `shortMockExplanation` with numeric IDs (90001, 90002)

**Files Modified:**
- `src/__tests__/e2e/helpers/api-mocks.ts:3-10` (interface)
- `src/__tests__/e2e/helpers/api-mocks.ts:104-115` (createSSEEvents)
- `src/__tests__/e2e/helpers/api-mocks.ts:176-177` (defaultMockExplanation)
- `src/__tests__/e2e/helpers/api-mocks.ts:187-188` (shortMockExplanation)

### 7. enterEditMode Click Not Registering ✅

**Root Cause:** The Edit button click wasn't reliably transitioning to show "Done" button. This could be due to click timing issues or React state update delays.

**Fix Applied:**
- Added `force: true` to button click to ensure click is handled
- Added 500ms wait after click for React state to update
- Added retry logic: if first click doesn't work within 3s, try clicking again
- Enhanced error handling with try/catch for graceful retry

**Files Modified:**
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts:262-289` (enterEditMode function)

### 8. Mock Handler Title Mismatch ✅ (2025-12-27)

**Root Cause:** The mock handler in `actions.ts:_getExplanationByIdAction` returned "Test Explanation Title" for ALL mock IDs >= 90000. When Playwright mock set a different title during streaming (e.g., "Understanding Quantum Entanglement"), the page redirect would load the explanation via `getExplanationByIdAction(90001)` which would overwrite the title with the hardcoded value.

**Fix Applied:**
- Updated `_getExplanationByIdAction` mock handler to return ID-specific titles:
  - 90001: "Understanding Quantum Entanglement" (matches `defaultMockExplanation`)
  - 90002: "Brief Explanation" (matches `shortMockExplanation`)
  - Other IDs: "Test Explanation Title" (fallback for server-side mock)
- Also added matching content for these IDs

**Files Modified:**
- `src/actions/actions.ts:373-408` (mock handler)

### 9. Server-Side Mock Progress Event Format ✅ (2025-12-27)

**Root Cause:** The server-side mock in `test-mode.ts` used `step` property but the client code at `page.tsx:389` expected `stage`. Also, no `title_generated` event was sent, so titles weren't displayed during streaming.

**Fix Applied:**
- Changed `step` to `stage` in all progress events
- Added `stage: 'title_generated'` event with title to all scenarios
- This ensures titles display during streaming when server-side mock is used

**Files Modified:**
- `src/app/api/returnExplanation/test-mode.ts:38-124` (all scenarios)

### 10. Missing getUserQueryByIdAction Mock Handler ✅ (2025-12-27)

**Root Cause:** After streaming, the mock returns `userQueryId = explanationId + 1000` (e.g., 91000). When the page loads this userQueryId, `getUserQueryByIdAction(91000)` was called without a mock handler, causing PGRST116 errors.

**Fix Applied:**
- Added mock handler in `_getUserQueryByIdAction` for IDs >= 91000
- Returns mock data with proper structure matching the real query

**Files Modified:**
- `src/actions/actions.ts:575-592` (getUserQueryByIdAction mock handler)

### 11. waitForStreamingComplete Not Waiting for Page Load ✅ (2025-12-27)

**Root Cause:** After streaming redirect, `waitForStreamingComplete` only waited for URL change, not for page data to load. The save button was still disabled because `loadExplanation` hadn't completed yet.

**Fix Applied:**
- Updated `waitForStreamingComplete` to wait for `data-user-saved-loaded="true"` attribute
- This ensures the page has fully loaded after redirect before tests continue
- Added fallback to wait for title/content visibility if attribute check times out

**Files Modified:**
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:59-87` (waitForStreamingComplete)

---

## Remaining Known Issues

### Server Instability (ECONNRESET)

Even with 1 worker, ECONNRESET errors still occur intermittently. This appears to be Next.js dev server under E2E test load.

**Potential Solutions:**
- Use production build (`npm run build && npm start`) for E2E tests
- Add health checks before each test
- Increase server memory allocation

### Playwright Mock vs Server-Side Test Mode Conflict ✅ RESOLVED

~~When `E2E_TEST_MODE=true`, the server-side `test-mode.ts` returns mock responses, which can conflict with Playwright route intercepts. Tests that rely on Playwright mocks may receive server-side mock data instead.~~

~~**Example:** "should show title during streaming" expects "Understanding Quantum Entanglement" from Playwright mock but receives "Test Explanation Title" from server-side mock.~~

**Resolution:** Fixed by making mock handlers return ID-specific data that matches Playwright mock expectations. The server-side mock now properly sends title during streaming, and the `getExplanationByIdAction` mock returns matching titles for specific IDs.

---

## Recommended Actions

### All P1-P3 Items Completed ✅

~~### Immediate (P1)~~
1. ~~**Reduce workers to 2:** Stabilize server~~ ✅ Done (reduced to 1 for CI, 2 for local)
2. ~~**Debug streaming mock:** Fix stream-complete indicator~~ ✅ Done (wait for URL redirect instead)

~~### Short-term (P2)~~
3. ~~**Add Edit Mode to AI tests:** Enter edit mode before suggestions~~ ✅ Done
4. ~~**Fix null title assertion:** Handle null case in save-blocking tests~~ ✅ Done

~~### Later (P3)~~
5. ~~**Investigate add-tag-trigger:** Verify UI element exists~~ ✅ Done (added visibility wait)
6. **Consider production build:** For CI, use `npm start` not dev server (Optional optimization)

---

## Test Run Commands

**Stable run (1 worker):**
```bash
E2E_TEST_MODE=true npx playwright test --project=chromium --workers=1
```

**Specific spec:**
```bash
E2E_TEST_MODE=true npx playwright test -g "should show already saved" --project=chromium
```

**Action buttons only:**
```bash
E2E_TEST_MODE=true npx playwright test src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts --project=chromium --workers=1
```

---

## Systematic Debugging Session (2025-12-27)

This section documents the systematic debugging approach used to resolve the remaining E2E test issues.

### Problem Statement

Tests were failing with the error: "should show title during streaming" expects "Understanding Quantum Entanglement" but receives "Test Explanation Title". Additionally, save button tests were failing because the button remained disabled after streaming.

### Root Cause Analysis

**Phase 1: Evidence Gathering**

Traced the data flow from Playwright mock → server-side mock → client → database mock handlers:

1. Playwright mock (`api-mocks.ts`) sends title "Understanding Quantum Entanglement" with ID 90001
2. Server-side mock (`test-mode.ts`) sends title "Test Explanation Title" with IDs starting at 90000
3. After streaming redirect, `loadExplanation` calls `getExplanationByIdAction(90001)`
4. Mock handler returned hardcoded "Test Explanation Title" for ALL IDs >= 90000

**Phase 2: Pattern Analysis**

Compared the two mock implementations:

| Aspect | Playwright Mock | Server-Side Mock |
|--------|-----------------|------------------|
| Title | "Understanding Quantum Entanglement" | "Test Explanation Title" |
| ID | 90001 (fixed) | 90000+ (incrementing) |
| Progress event | `stage: 'title_generated'` | `step: 'searching'` (wrong) |
| userQueryId | 91001 | 91000+ |

**Phase 3: Hypothesis Testing**

Hypothesis: Multiple mock handlers were returning generic data instead of ID-specific data, causing title overwrites and PGRST116 database errors.

### Issues Identified and Fixed

#### Issue #8: Mock Handler Title Mismatch

**Problem:** `getExplanationByIdAction` returned "Test Explanation Title" for all mock IDs.

**Solution:** Added ID-specific title and content mapping:
```typescript
const mockTitles: Record<number, string> = {
    90001: 'Understanding Quantum Entanglement',
    90002: 'Brief Explanation',
};
```

**File:** `src/actions/actions.ts:373-408`

#### Issue #9: Server-Side Mock Progress Event Format

**Problem:** Used `step` property but client expected `stage`. No `title_generated` event.

**Solution:** Changed all progress events to use `stage` and added `title_generated` events:
```typescript
{
    type: 'progress',
    stage: 'title_generated',  // Was 'step: searching'
    title: 'Test Explanation Title',
}
```

**File:** `src/app/api/returnExplanation/test-mode.ts:38-124`

#### Issue #10: Missing getUserQueryByIdAction Mock

**Problem:** After streaming returns `userQueryId: 91000`, page calls `getUserQueryById(91000)` which had no mock handler, causing PGRST116 errors.

**Solution:** Added mock handler for IDs >= 91000:
```typescript
if (process.env.E2E_TEST_MODE === 'true' && params.id >= 91000) {
    return {
        id: params.id,
        user_query: 'test query',
        explanation_id: params.id - 1000,
        // ... other fields
    };
}
```

**File:** `src/actions/actions.ts:575-592`

#### Issue #11: waitForStreamingComplete Not Waiting for Page Load

**Problem:** Only waited for URL change, not for data to load. Save button remained disabled.

**Solution:** Added wait for `data-user-saved-loaded="true"` attribute:
```typescript
await this.page.waitForSelector(
    '[data-testid="save-to-library"][data-user-saved-loaded="true"]',
    { timeout: 30000 }
);
```

**File:** `src/__tests__/e2e/helpers/pages/ResultsPage.ts:59-87`

### Verification

After fixes:
- `search-generate.spec.ts`: **13 passed**, 2 skipped
- `action-buttons.spec.ts`: **11 passed**
- No more PGRST116 errors for mock IDs
- Title displays correctly during and after streaming

### Lessons Learned

1. **Mock data must be consistent across layers**: When multiple mocks exist (Playwright, server-side, database action handlers), they must return consistent data for the same IDs.

2. **Property names matter**: `stage` vs `step` caused silent failures where the client ignored progress events.

3. **Wait for observable state, not just URL**: After redirect, the page needs time to load data. Waiting for specific DOM attributes (like `data-user-saved-loaded`) is more reliable than fixed timeouts.

4. **Trace data flow end-to-end**: The bug wasn't in one place—it was a chain of mismatched data across 4 different files.

---

## Test Run (2025-12-27 - feat/restore-ai-panel-design branch)

### Run Summary

**Total Tests:** 260 tests using 2 workers
**Run Status:** Partial (stopped at ~192/260)
**Branch:** `feat/restore-ai-panel-design`

### Results So Far

| Category | Status |
|----------|--------|
| Passed | ~175+ tests |
| Failed | 12 tests (after retries) |
| Remaining | ~68 tests (not run) |

### Passing Test Suites

- ✅ `01-auth/auth.spec.ts` - All passing
- ✅ `02-search-generate/search-generate.spec.ts` - All passing
- ✅ `02-search-generate/regenerate.spec.ts` - All passing
- ✅ `03-library/library.spec.ts` - All passing
- ✅ `04-content-viewing/viewing.spec.ts` - All passing
- ✅ `04-content-viewing/action-buttons.spec.ts` - All passing
- ✅ `05-edge-cases/errors.spec.ts` - All passing
- ✅ `06-import/import-articles.spec.ts` - All passing
- ✅ `smoke.spec.ts` - All passing
- ✅ `auth.unauth.spec.ts` - All passing (chromium-unauth project)
- ✅ Firefox cross-browser tests - Passing

### New Issue: clickAcceptOnFirstDiff Selector Bug

**Issue #12: Accept Button Selector Matches Wrong Element**

**Symptom:**
```
locator.click: Test timeout exceeded.
waiting for locator('button:has-text("✓")').first()
- locator resolved to <button disabled data-testid="save-to-library" ... >Saved ✓</button>
- element is not enabled
```

**Affected Tests (12 failures):**
1. `tags.spec.ts` - "should open tag input when add button clicked"
2. `tags.spec.ts` - "should handle cancel button click"
3. `editor-integration.spec.ts` - "accept removes sentence from editor"
4. `editor-integration.spec.ts` - "should show error in panel and keep editor unchanged"
5. `error-recovery.spec.ts` - "should show error for API 500 and allow retry"
6. `error-recovery.spec.ts` - "should preserve original content on pipeline error"
7. `error-recovery.spec.ts` - "should handle malformed API response gracefully"
8. `save-blocking.spec.ts` - "save button should be enabled after accepting all suggestions"
9. `state-management.spec.ts` - "undo after accept should restore diff UI"
10. `state-management.spec.ts` - "redo after undo should re-apply accepted change"
11. `state-management.spec.ts` - "should handle multiple rounds of suggestions cleanly"
12. `user-interactions.spec.ts` - "should handle submit after accepting some diffs"

**Root Cause:**
The `clickAcceptOnFirstDiff()` helper in `suggestions-test-helpers.ts:224-226` uses:
```typescript
const button = page.locator('button:has-text("✓")').first();
```

This selector is too broad. It matches **any button containing "✓"**, including the "Saved ✓" button in the action bar, which is disabled. The intended target is the accept button within diff UI elements.

**Fix Required:**
Update the selector to be more specific:
```typescript
// Option 1: Target buttons within diff elements
const button = page.locator('[data-testid="diff-accept-button"]').first();

// Option 2: Exclude the save button
const button = page.locator('button:has-text("✓"):not([data-testid="save-to-library"])').first();

// Option 3: Target by parent container
const button = page.locator('.diff-inline-controls button:has-text("✓")').first();
```

**Priority:** P1 - Blocks 12 AI suggestions tests

**Files to Modify:**
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts:224-226`

### Tags Tests - Separate Issue

**Issue #13: Add Tag Trigger Still Timing Out**

Despite fix in commit `2332e88`, the add-tag-trigger visibility wait is still timing out:
```
TimeoutError: locator.waitFor: Timeout 5000ms exceeded.
waiting for locator('[data-testid="add-tag-trigger"]') to be visible
```

**Affected Tests:**
- `tags.spec.ts` - "should open tag input when add button clicked"
- `tags.spec.ts` - "should handle cancel button click"

**Possible Causes:**
1. Element conditionally rendered based on state not present in test setup
2. Element hidden by CSS or parent container
3. Race condition with page load

**Priority:** P2 - Only 2 tests affected

---

## Recommended Next Steps

### Immediate (P1)
1. **Fix clickAcceptOnFirstDiff selector** - Update to use specific data-testid or exclude save button
2. **Add data-testid to diff accept/reject buttons** - If not already present

### Short-term (P2)
3. ~~**Debug add-tag-trigger** - Investigate why element isn't visible after previous fix~~ ✅ Fixed

---

## Status Update (2025-12-27 - Issue #12 and #13 Resolved)

**Commit:** `6d13590` - fix(e2e): resolve tag seeding and diff button selector issues

### Issue #12: clickAcceptOnFirstDiff Selector Too Broad ✅ FIXED

**Problem:** The selector `button:has-text("✓")` was matching the "Saved ✓" button instead of the diff accept button.

**Fix Applied:**
- Changed `clickAcceptOnFirstDiff` to use `button[data-action="accept"]` selector
- Changed `clickRejectOnFirstDiff` to use `button[data-action="reject"]` selector
- These data-action attributes are specific to the diff UI buttons

**Files Modified:**
- `src/__tests__/e2e/helpers/suggestions-test-helpers.ts:224-236`

### Issue #13: Add Tag Trigger Timeout ✅ FIXED

**Root Cause Identified:** Tags weren't being loaded for seeded explanations because:
1. The `seedTestExplanation` function in `global-setup.ts` returned early when explanation already exists, without ensuring tags were associated
2. The `explanation_tags` insert didn't explicitly set `isDeleted: false`
3. Soft-deleted tag associations weren't being reactivated
4. The TagBar component returns `null` when there are no tags, making the "Add tag" trigger invisible

**Fix Applied:**
- Created `ensureTagAssociated` helper function in `global-setup.ts` that:
  - Creates or gets the test tag with proper `tag_description`
  - Checks for existing associations (including soft-deleted ones)
  - Reactivates soft-deleted associations
  - Creates new associations with explicit `isDeleted: false`
- Added call to `ensureTagAssociated` in both code paths (new explanation and existing explanation)

**Files Modified:**
- `src/__tests__/e2e/setup/global-setup.ts:9-60` (new ensureTagAssociated function)
- `src/__tests__/e2e/setup/global-setup.ts:148-149` (call for existing explanations)

### Additional Fix: Cancel Button Click Reliability

**Problem:** The cancel button click in tag input wasn't reliably hiding the input due to React state timing issues.

**Fix Applied:**
- Added retry logic to `clickCancelAddTag` helper
- First click attempt with 2s timeout for input to hide
- If first click doesn't register, retry click with 3s timeout
- Improved `clickAddTagTrigger` to handle both trigger and input states

**Files Modified:**
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:573-593` (clickAddTagTrigger)
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:636-650` (clickCancelAddTag)

### Test Results After Fixes

**Run on Chromium:**
- **116 passed** ✅
- **4 failed** (pre-existing error recovery test issues)
- **3 skipped**

**Remaining Failures (Pre-existing, unrelated to fixes):**
1. `editor-integration.spec.ts:238` - "should show error in panel and keep editor unchanged"
2. `error-recovery.spec.ts:35` - "should show error for API 500 and allow retry"
3. `error-recovery.spec.ts:127` - "should preserve original content on pipeline error"
4. `error-recovery.spec.ts:160` - "should handle malformed API response gracefully"

These are error recovery scenario tests that have timing issues with editor content loading. They are not regressions from the fixes applied.

---
