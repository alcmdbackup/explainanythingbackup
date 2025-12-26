# Test Coverage Plan: Results Page Action Buttons

## Current Coverage Summary

| Button/Feature | Unit | Integration | E2E | Status |
|----------------|------|-------------|-----|--------|
| Rewrite dropdown | None | None | 4 (visibility only) | Gaps |
| Save/Publish | None | 3 | 1 (skipped) | Gaps |
| Edit mode | 8 (state only) | None | None | Gaps |
| Apply/Reset tags | 5+ | 5+ | 1 | Good |
| Format toggle | None | None | None | **Gaps** |
| Mode dropdown | None | None | None | **Gaps** |
| Add tag full flow | None | None | Partial | **Gaps** |
| Tag chip switching | None | None | None | **Gaps** |
| Changes panel | None | None | None | **Gaps** |

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

#### Format Toggle Tests
**Location:** `page.tsx:1117-1123`
```
- should toggle from markdown to plain text view
- should toggle from plain text back to markdown
- should preserve content when toggling format
- should be disabled during streaming
```

#### Mode Dropdown Tests
**Location:** `page.tsx:1134-1151`
```
- should change mode to Skip Match
- should change mode to Force Match
- should preserve mode selection after rewrite
- should be disabled during streaming
```

#### Add Tag Flow Tests
**Location:** `TagBar.tsx:472-481`
```
- should open tag input when add button clicked
- should show searchable dropdown of available tags
- should filter dropdown as user types
- should add selected tag to explanation
- should close input field after selection
- should handle cancel button click
```

#### Tag Chip Preset Switching Tests
**Location:** `TagBar.tsx:345-365`
```
- should open preset dropdown when preset tag clicked
- should switch to alternative tag from dropdown
- should show switch indicator (~) in changes panel
```

#### Changes Panel Tests
**Location:** `TagBar.tsx:549-557`
```
- should toggle changes panel visibility
- should display added tags with + indicator
- should display removed tags with - indicator
- should display switched tags with ~ indicator
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

### Phase 1: Critical (P0)
1. **Save button flow** - unblock skipped test in search-generate.spec.ts
2. **Edit mode E2E** - enter, edit, save, cancel

### Phase 2: Important (P1)
3. **Rewrite actual regeneration flow**
4. **Rewrite with tags complete flow**
5. **Edit with tags complete flow**

### Phase 3: Complete Coverage (P2)
6. **Format toggle tests**
7. **Mode dropdown tests**
8. **Add tag complete flow**
9. **Tag chip preset switching**
10. **Changes panel toggle**

### Phase 4: Unit Tests
11. Button click handlers
12. State transitions

## Files to Modify/Create

| File | Action |
|------|--------|
| `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` | Create |
| `src/__tests__/e2e/specs/04-content-viewing/tags.spec.ts` | Extend |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Extend with new helpers |
| `src/app/results/page.test.tsx` | Extend |
| `src/__tests__/integration/results-actions.integration.test.ts` | Create |

## New ResultsPage.ts Helpers Needed

```typescript
// Format toggle
clickFormatToggle(): Promise<void>
isMarkdownMode(): Promise<boolean>
isPlainTextMode(): Promise<boolean>

// Mode dropdown
selectMode(mode: 'normal' | 'skip' | 'force'): Promise<void>
getSelectedMode(): Promise<string>

// Tag additions
clickAddTagButton(): Promise<void>
getTagDropdownOptions(): Promise<string[]>
filterTagDropdown(text: string): Promise<void>
selectTagFromDropdown(tagName: string): Promise<void>
cancelAddTag(): Promise<void>

// Preset switching
clickPresetTag(tagName: string): Promise<void>
getPresetAlternatives(tagName: string): Promise<string[]>
switchPresetTag(from: string, to: string): Promise<void>

// Changes panel
toggleChangesPanel(): Promise<void>
isChangesPanelVisible(): Promise<boolean>
getAddedTags(): Promise<string[]>
getRemovedTags(): Promise<string[]>
getSwitchedTags(): Promise<{from: string, to: string}[]>
```

## Test Data Requirements

- Existing explanation with ID for edit/save tests
- Explanation with preset tags for switching tests
- Explanation with multiple tag types
- User with auth session
- Tags for rewrite-with-tags tests
