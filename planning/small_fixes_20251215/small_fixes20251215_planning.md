# Small Fixes Plan - 2025-12-15

## Summary
5 small UI fixes across 4 files.

---

## 1. Search Box Enter Key Behavior
**File:** `src/components/SearchBar.tsx`

**Problem:** Home page search uses `<textarea>`. Enter creates newline instead of submitting.

**Fix:** Add `onKeyDown` handler to intercept Enter key (without Shift) and submit the form.

---

## 2. Filter Drafts from "All Explanations"
**File:** `src/lib/services/explanations.ts`

**Problem:** `getRecentExplanations()` returns all explanations including drafts.

**Fix:** Add `.eq('status', 'published')` filter to the query.

---

## 3. Library Empty State
**File:** `src/components/ExplanationsTablePage.tsx`

**Problem:** Empty table shows no message when library is empty.

**Fix:** Add conditional empty state message when no items.

---

## 4. Remove Library Loading State
**File:** `src/app/userlibrary/page.tsx`

**Problem:** Shows "Loading your library..." while fetching.

**Fix:** Remove the loading conditional, always render ExplanationsTablePage.

---

## 5. Capitalize "All Explanations" in Nav
**File:** `src/components/Navigation.tsx`

**Problem:** Shows "All explanations" (lowercase 'e').

**Fix:** Change to "All Explanations" (capital 'E').

---

## Files Modified
1. `src/components/SearchBar.tsx`
2. `src/lib/services/explanations.ts`
3. `src/components/ExplanationsTablePage.tsx`
4. `src/app/userlibrary/page.tsx`
5. `src/components/Navigation.tsx`
