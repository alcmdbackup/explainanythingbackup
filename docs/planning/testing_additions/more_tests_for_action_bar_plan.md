# Test Coverage Plan: Results Page Action Buttons

## Current Coverage Summary

| Button | Unit | Integration | E2E | Status |
|--------|------|-------------|-----|--------|
| Rewrite dropdown | None | None | 4 (visibility only) | Gaps |
| Save/Publish | None | 3 | 1 (skipped) | Gaps |
| Edit mode | 8 (state only) | None | None | Gaps |
| Apply/Reset tags | 5+ | 5+ | 1 | Good |

## Tests to Add

### 1. E2E Tests (High Priority)

**File:** `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` (new)

#### Rewrite Button Tests
```
- should trigger regeneration when rewrite button clicked
- should show loading state during regeneration
- should display new content after rewrite completes
- should trigger rewrite with tags flow when option selected
- should enter edit-with-tags mode when option selected
```

#### Save/Publish Button Tests
```
- should save explanation to library when save button clicked
- should show success feedback after save
- should disable save button after successful save
- should handle save errors gracefully
- should update button text from "Save" to "Saved" after save
```

#### Edit Mode Tests
```
- should enter edit mode when edit button clicked
- should make editor content editable in edit mode
- should show save/cancel buttons in edit mode
- should save edited content when save clicked
- should discard changes when cancel clicked
- should preserve changes when navigating away (or warn user)
```

### 2. Unit Tests (Medium Priority)

**File:** `src/app/results/page.test.tsx` (extend)

#### Rewrite Button Handler Tests
```
- should call regeneration handler when rewrite clicked
- should dispatch correct action for rewrite with tags
- should dispatch ENTER_EDIT_MODE for edit with tags
- should disable rewrite during streaming
```

#### Save Button Handler Tests
```
- should call saveExplanationToLibrary action on click
- should set isSaving state during save
- should handle save success
- should handle save error
- should be disabled when already saved
```

### 3. Integration Tests (Medium Priority)

**File:** `src/__tests__/integration/results-actions.integration.test.ts` (new)

```
- should persist regenerated content to database
- should update explanation status on publish
- should create user_saved_explanations record on save
- should handle concurrent save attempts
```

## Implementation Order

1. **Phase 1: E2E for Save button** (most critical gap)
   - Unblock skipped test in search-generate.spec.ts
   - Add save success verification

2. **Phase 2: E2E for Edit mode**
   - Enter edit mode
   - Save edited content
   - Cancel edit

3. **Phase 3: E2E for Rewrite flow**
   - Full regeneration flow
   - Rewrite with tags

4. **Phase 4: Unit tests for handlers**
   - Button click handlers
   - State transitions

## Files to Modify/Create

| File | Action |
|------|--------|
| `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` | Create |
| `src/__tests__/e2e/pages/ResultsPage.ts` | Extend with new helpers |
| `src/app/results/page.test.tsx` | Extend |
| `src/__tests__/integration/results-actions.integration.test.ts` | Create |

## Test Data Requirements

- Existing explanation with ID for edit/save tests
- User with auth session
- Tags for rewrite-with-tags tests

## Estimated Effort

- E2E tests: 4-6 hours
- Unit tests: 2-3 hours
- Integration tests: 2-3 hours
- **Total: 8-12 hours**
