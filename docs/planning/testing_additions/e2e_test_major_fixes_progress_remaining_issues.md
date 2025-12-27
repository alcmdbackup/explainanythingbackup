# E2E Test Remaining Issues

Status tracking for remaining E2E test issues after the major fixes implementation.

---

## Summary

After implementing the major E2E test fixes (auth, data seeding, streaming mock, lifecycle waits), there are still several categories of test failures. This document tracks the remaining issues and their root causes.

**Latest Run (2025-12-27):**
- ~16 failed (after retries)
- ~50+ flaky (pass on retry)
- ~50+ passed

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

### userSavedLoaded Race Condition ✅

**Original Issue:** "should show already saved state for existing saved explanations" failing with `Expected: "Saved", Received: "Save"`

**Root Cause:** `checkUserSaved()` async call completed after test checked button text

**Fix Applied:**
1. Added `userSavedLoaded` state to `useExplanationLoader.ts`
2. Added `data-user-saved-loaded` attribute to Save button
3. Updated `waitForUserSavedState()` to wait for `data-user-saved-loaded="true"`

**Status:** Test now passes when navigation succeeds (flaky due to server issues, not assertion)

---

## Recommended Actions

### Immediate (P1)
1. **Reduce workers to 2:** Stabilize server
2. **Debug streaming mock:** Fix stream-complete indicator

### Short-term (P2)
3. **Add Edit Mode to AI tests:** Enter edit mode before suggestions
4. **Fix null title assertion:** Handle null case in save-blocking tests

### Later (P3)
5. **Investigate add-tag-trigger:** Verify UI element exists
6. **Consider production build:** For CI, use `npm start` not dev server

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
