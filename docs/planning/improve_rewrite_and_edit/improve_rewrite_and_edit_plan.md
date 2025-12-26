# Simplify Rewrite and Edit Workflow

## Requirements

> - 3 actions under Action menu: **Rewrite**, **Rewrite with feedback**, **Edit with feedback**
> - Feedback = tags (how to rewrite/edit) + sources (links to supplement)
> - Single Apply button initiates regeneration/editing

## Target Behavior

| Action | Opens Panel? | Initial Tags | Result |
|--------|--------------|--------------|--------|
| Rewrite | No | — | Immediate regeneration from original query |
| Rewrite with feedback | Yes | Preset temp tags | Regenerate with tags + sources |
| Edit with feedback | Yes | Original explanation tags | Edit current content with tags + sources |

---

## Implementation Steps

### Step 1: API - Add Edit with Sources Support

**File:** `src/lib/services/returnExplanation.ts`

The API currently supports sources only for Rewrite. Add support for Edit + sources:

```typescript
// Add new prompt function
export function editExplanationWithSourcesPrompt(
  title: string,
  sources: SourceCacheFullType[],
  additionalRules: string[],
  existingContent: string
): string { ... }

// Update decision logic (lines ~233-254)
if (sources && sources.length > 0) {
  if (userInputType === UserInputType.EditWithTags && existingContent) {
    formattedPrompt = editExplanationWithSourcesPrompt(...);
  } else {
    formattedPrompt = createExplanationWithSourcesPrompt(...);
  }
} else if (userInputType === UserInputType.EditWithTags && existingContent) {
  formattedPrompt = editExplanationPrompt(...);
} else {
  formattedPrompt = createExplanationPrompt(...);
}
```

### Step 2: Rename Types

**File:** `src/lib/schemas/schemas.ts`

```typescript
// Before
enum TagBarMode { Normal = 0, RewriteWithTags = 1, EditWithTags = 2 }

// After
enum FeedbackMode { Normal = 0, RewriteWithFeedback = 1, EditWithFeedback = 2 }
```

### Step 3: Update Reducer

**File:** `src/reducers/tagModeReducer.ts`

- Rename `TagModeState` → `FeedbackModeState`, `TagModeAction` → `FeedbackModeAction`
- Rename actions: `ENTER_REWRITE_MODE` → `ENTER_REWRITE_FEEDBACK_MODE`, etc.
- `ENTER_EDIT_FEEDBACK_MODE`: Use `originalTags` (not temp tags)

### Step 4: Update FeedbackPanel for Mode Awareness

**File:** `src/components/FeedbackPanel.tsx`

```typescript
interface FeedbackPanelProps {
  feedbackMode: 'rewrite' | 'edit';  // NEW prop
  // ...existing props
}

// Dynamic title
const title = feedbackMode === 'edit' ? 'Edit with Feedback' : 'Rewrite with Feedback';

// Pass mode to parent on apply
const handleApply = () => onApply(tagDescriptions, validSources, feedbackMode);
```

### Step 5: Update Results Page Handlers

**File:** `src/app/results/page.tsx`

Update `handleFeedbackPanelApply` to branch on mode:

```typescript
const handleFeedbackPanelApply = async (
  tagDescriptions: string[],
  panelSources: SourceChipType[],
  feedbackMode: 'rewrite' | 'edit'
) => {
  if (feedbackMode === 'edit') {
    await handleUserAction(
      inputForEdit, UserInputType.EditWithTags, mode, userid,
      tagDescriptions, null, null, panelSources  // NOW PASSES SOURCES
    );
  } else {
    await handleUserAction(
      userInput, UserInputType.RewriteWithTags, mode, userid,
      tagDescriptions, explanationId, explanationVector, panelSources
    );
  }
};
```

### Step 6: Replace Action Buttons

**File:** `src/app/results/page.tsx`

Remove split button. Add Action dropdown:

```tsx
<ActionDropdown>
  <ActionItem onClick={handleRewrite}>Rewrite</ActionItem>
  <ActionItem onClick={handleRewriteWithFeedback}>Rewrite with feedback</ActionItem>
  <ActionItem onClick={handleEditWithFeedback}>Edit with feedback</ActionItem>
</ActionDropdown>
```

Handler wiring:
- `handleRewrite`: Immediate `handleUserAction(...)` with `UserInputType.Rewrite`
- `handleRewriteWithFeedback`: Fetch temp tags → dispatch `ENTER_REWRITE_FEEDBACK_MODE` → show FeedbackPanel
- `handleEditWithFeedback`: Dispatch `ENTER_EDIT_FEEDBACK_MODE` → show FeedbackPanel

### Step 7: Update TagBar

**File:** `src/components/TagBar.tsx`

Update mode checks to use `FeedbackMode` enum.

### Step 8: Update Tests

| File | Changes |
|------|---------|
| `src/lib/schemas/schemas.test.ts` | Rename enum refs |
| `src/reducers/tagModeReducer.test.ts` | Rename types/actions |
| `src/components/TagBar.test.tsx` | Update mode refs |
| `src/components/FeedbackPanel.test.tsx` | Add mode prop tests |
| `src/app/results/page.test.tsx` | Update UI tests |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Update selectors |

---

## Files Summary

| File | Change |
|------|--------|
| `src/lib/services/returnExplanation.ts` | Add `editExplanationWithSourcesPrompt`, update logic |
| `src/lib/schemas/schemas.ts` | Rename enum |
| `src/reducers/tagModeReducer.ts` | Rename types/actions |
| `src/components/FeedbackPanel.tsx` | Add `feedbackMode` prop |
| `src/components/TagBar.tsx` | Update mode refs |
| `src/app/results/page.tsx` | Replace UI, update handlers |
| Tests (6 files) | Update references |

---

## Verification

1. `npm run type-check` after each step
2. `npm test` for unit tests
3. `npm run test:e2e -- --project=chromium-unauth` for E2E
4. Manual test all 3 actions with various tag/source combinations
