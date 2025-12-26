# Simplify Rewrite and Edit Workflow

## Requirements

> - 3 actions under Action menu: **Rewrite**, **Rewrite with feedback**, **Edit with feedback**
> - Feedback = tags (how to rewrite/edit) + sources (links to supplement)
> - Single Apply button initiates regeneration/editing
> - Remove "Rewrite with tags" and "Edit with tags" (replaced by feedback variants)
> - Rename enum values: `TagBarMode` → `FeedbackMode` with new string values

## Target Behavior

| Action | Opens Panel? | Initial Tags | Result |
|--------|--------------|--------------|--------|
| Rewrite | No | — | Immediate regeneration from original query |
| Rewrite with feedback | Yes | Preset temp tags | Regenerate with tags + sources |
| Edit with feedback | Yes | Original explanation tags | Edit current content with tags + sources |

---

## Implementation Steps

### Step 1: Add Edit with Sources Prompt

**File:** `src/lib/prompts.ts`

Create new prompt function that combines editing behavior with source citations:

```typescript
/**
 * Creates a prompt for editing explanations with source citations
 *
 * • Takes existing content and modifies it (vs rewriting from scratch)
 * • Incorporates source material with [n] citation notation
 * • Preserves structure while adding/updating information from sources
 */
export function editExplanationWithSourcesPrompt(
  title: string,
  sources: Array<{
    index: number;
    title: string;
    domain: string;
    content: string;
    isVerbatim: boolean;
  }>,
  additionalRules: string[],
  existingContent: string
): string {
  const sourcesSection = sources.map(source => {
    const sourceType = source.isVerbatim ? 'VERBATIM' : 'SUMMARIZED';
    return `[Source ${source.index}] ${source.title} (${source.domain}) [${sourceType}]
---
${source.content}
---`;
  }).join('\n\n');

  return `You are editing an existing explanation. Modify the content below to incorporate information from the provided sources.

Topic: ${title}

## Sources
${sourcesSection}

## Existing Content
${existingContent}

## Rules
- Make targeted modifications to incorporate source information
- Add inline citations using [n] notation where n is the source number
- Preserve the overall structure and flow of the existing content
- Always format using Markdown. Content should not include anything larger than section headers (##)
- Highlight key terms using bold formatting **keyterm**
- For inline math use single dollars: $\\frac{2}{5}$, for block math use double dollars
- Use lists and bullets sparingly
- Prefer direct information from VERBATIM sources; use SUMMARIZED sources for context
- If sources conflict with existing content, update with source information and cite
- Only modify sections that benefit from source material${additionalRules.length > 0 ? '\n' + additionalRules.map(rule => `- ${rule}`).join('\n') : ''}

`;
}
```

**Key differences from `createExplanationWithSourcesPrompt`:**
- Instruction is "modify existing" not "write new"
- Takes `existingContent` parameter
- Preserves structure while adding citations
- More conservative editing approach

### Step 2: Update API Decision Logic

**File:** `src/lib/services/returnExplanation.ts`

Update `generateNewExplanation` (lines ~233-254) to handle all 4 combinations:

```typescript
// Import new prompt
import {
  createExplanationPrompt,
  editExplanationPrompt,
  createExplanationWithSourcesPrompt,
  editExplanationWithSourcesPrompt  // NEW
} from '@/lib/prompts';

// Updated decision logic
let formattedPrompt: string;

if (sources && sources.length > 0) {
  // Sources provided - check if edit or rewrite
  if (userInputType === UserInputType.EditWithTags && existingContent) {
    formattedPrompt = editExplanationWithSourcesPrompt(
      titleResult, sources, additionalRules, existingContent
    );
    logger.debug('Using editExplanationWithSourcesPrompt for EditWithTags + sources');
  } else {
    formattedPrompt = createExplanationWithSourcesPrompt(
      titleResult, sources, additionalRules
    );
    logger.debug('Using createExplanationWithSourcesPrompt with sources');
  }
} else if (userInputType === UserInputType.EditWithTags && existingContent) {
  formattedPrompt = editExplanationPrompt(titleResult, additionalRules, existingContent);
  logger.debug('Using editExplanationPrompt for EditWithTags mode');
} else {
  formattedPrompt = createExplanationPrompt(titleResult, additionalRules);
  logger.debug('Using createExplanationPrompt for standard mode');
}
```

**Decision matrix:**

| UserInputType | Sources? | ExistingContent? | Prompt Function |
|---------------|----------|------------------|-----------------|
| Any | Yes | Yes (EditWithTags) | `editExplanationWithSourcesPrompt` |
| Any | Yes | No | `createExplanationWithSourcesPrompt` |
| EditWithTags | No | Yes | `editExplanationPrompt` |
| Other | No | — | `createExplanationPrompt` |

### Step 3: Rename Enum (Breaking Change)

**File:** `src/lib/schemas/schemas.ts`

```typescript
// Before
export enum TagBarMode {
  Normal = "normal",
  RewriteWithTags = "rewrite with tags",
  EditWithTags = "edit with tags"
}

// After
export enum FeedbackMode {
  Normal = "normal",
  RewriteWithFeedback = "rewrite with feedback",
  EditWithFeedback = "edit with feedback"
}
```

**Files requiring update for this rename:**
- `src/lib/schemas/schemas.ts` - Definition
- `src/lib/schemas/schemas.test.ts` - Test assertions
- `src/reducers/tagModeReducer.ts` - `getTagBarMode` → `getFeedbackMode`
- `src/components/FeedbackPanel.tsx` - Import and switch statement
- `src/components/TagBar.tsx` - Import and mode checks

### Step 4: Update Reducer

**File:** `src/reducers/tagModeReducer.ts`

Rename types and actions:

```typescript
// Type renames
export type FeedbackModeState = NormalModeState | RewriteWithFeedbackModeState | EditWithFeedbackModeState;
export type FeedbackModeAction =
  | { type: 'ENTER_REWRITE_FEEDBACK_MODE'; tempTags: TagUIType[] }
  | { type: 'ENTER_EDIT_FEEDBACK_MODE' }
  | { type: 'EXIT_TO_NORMAL' }
  | { type: 'APPLY_TAGS' }
  | { type: 'RESET_TAGS' }
  | { type: 'UPDATE_TAGS'; tags: TagUIType[] }
  | { type: 'TOGGLE_DROPDOWN' };

// State type renames
type RewriteWithFeedbackModeState = {
  mode: 'rewriteWithFeedback';
  tempTags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

type EditWithFeedbackModeState = {
  mode: 'editWithFeedback';
  tags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

// Helper function rename
export function getFeedbackMode(state: FeedbackModeState): FeedbackMode {
  switch (state.mode) {
    case 'rewriteWithFeedback': return FeedbackMode.RewriteWithFeedback;
    case 'editWithFeedback': return FeedbackMode.EditWithFeedback;
    default: return FeedbackMode.Normal;
  }
}
```

### Step 5: Update FeedbackPanel for Mode Awareness

**File:** `src/components/FeedbackPanel.tsx`

The panel can derive mode from `tagState.mode` - no new prop needed:

```typescript
import { FeedbackMode } from '@/lib/schemas/schemas';
import { getFeedbackMode } from '@/reducers/tagModeReducer';

// Update onApply signature to include mode
interface FeedbackPanelProps {
  // ...existing props
  onApply: (tagDescriptions: string[], sources: SourceChipType[], mode: 'rewrite' | 'edit') => void;
}

// Derive mode from state
const feedbackMode = getFeedbackMode(tagState);
const isEditMode = feedbackMode === FeedbackMode.EditWithFeedback;

// Update title
const getPanelTitle = () => {
  switch (feedbackMode) {
    case FeedbackMode.RewriteWithFeedback:
      return 'Rewrite with Feedback';
    case FeedbackMode.EditWithFeedback:
      return 'Edit with Feedback';
    default:
      return 'Apply Feedback';
  }
};

// Pass mode on apply
const handleApply = useCallback(() => {
  const tagDescriptions = extractActiveTagDescriptions();
  const validSources = sources.filter(s => s.status === 'success');
  onApply(tagDescriptions, validSources, isEditMode ? 'edit' : 'rewrite');
}, [extractActiveTagDescriptions, sources, onApply, isEditMode]);
```

### Step 6: Update Results Page Handlers

**File:** `src/app/results/page.tsx`

**6a. Update `handleFeedbackPanelApply` to branch on mode:**

```typescript
const handleFeedbackPanelApply = async (
  tagDescriptions: string[],
  panelSources: SourceChipType[],
  feedbackMode: 'rewrite' | 'edit'
) => {
  setShowFeedbackPanel(false);

  if (feedbackMode === 'edit') {
    const inputForEdit = explanationTitle || prompt;
    if (!inputForEdit) {
      dispatchLifecycle({ type: 'ERROR', error: 'No input available for editing.' });
      return;
    }
    await handleUserAction(
      inputForEdit,
      UserInputType.EditWithTags,
      mode,
      userid,
      tagDescriptions,
      null,
      null,
      panelSources  // NOW PASSES SOURCES FOR EDIT
    );
  } else {
    const inputForRewrite = explanationTitle || prompt;
    if (!inputForRewrite) {
      dispatchLifecycle({ type: 'ERROR', error: 'No input available for rewriting.' });
      return;
    }
    await handleUserAction(
      inputForRewrite,
      UserInputType.RewriteWithTags,
      mode,
      userid,
      tagDescriptions,
      null,
      null,
      panelSources
    );
  }
};
```

**6b. Add `handleEditWithFeedback` handler:**

```typescript
const handleEditWithFeedback = () => {
  // Use original tags (not temp tags like rewrite mode)
  dispatchTagAction({ type: 'ENTER_EDIT_FEEDBACK_MODE' });
  setShowFeedbackPanel(true);
};
```

**6c. Update `handleOpenFeedbackPanel` (rename for clarity):**

```typescript
const handleRewriteWithFeedback = async () => {
  await initializeTempTagsForRewriteWithTags();
  dispatchTagAction({ type: 'ENTER_REWRITE_FEEDBACK_MODE' });
  setShowFeedbackPanel(true);
};
```

### Step 7: Replace UI Action Buttons

**File:** `src/app/results/page.tsx`

Remove split button with dropdown. Replace with simpler dropdown menu:

```tsx
{(explanationTitle || content) && (
  <div className="relative inline-flex" ref={regenerateDropdownRef}>
    {/* Main button with dropdown */}
    <button
      type="button"
      data-testid="action-menu-button"
      disabled={isPageLoading || isStreaming}
      onClick={() => dispatchTagAction({ type: 'TOGGLE_DROPDOWN' })}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-page bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-sm font-sans font-medium text-[var(--text-on-primary)] shadow-warm transition-all duration-200 hover:shadow-warm-md disabled:cursor-not-allowed disabled:opacity-50 h-9"
    >
      Actions
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {/* Dropdown menu */}
    {tagState.mode === 'normal' && tagState.showRegenerateDropdown && (
      <div className="absolute top-full left-0 mt-1 w-52 bg-[var(--surface-secondary)] rounded-page shadow-warm-lg border border-[var(--border-default)] z-10">
        <div className="py-1">
          <button
            data-testid="rewrite-action"
            disabled={isPageLoading || isStreaming}
            onClick={async () => {
              const userInput = prompt.trim() || explanationTitle;
              if (userInput) {
                await handleUserAction(userInput, UserInputType.Rewrite, mode, userid, [], explanationId, explanationVector);
              }
            }}
            className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors"
          >
            Rewrite
          </button>
          <button
            data-testid="rewrite-with-feedback"
            disabled={isPageLoading || isStreaming}
            onClick={handleRewriteWithFeedback}
            className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors"
          >
            Rewrite with feedback
          </button>
          <button
            data-testid="edit-with-feedback"
            disabled={isPageLoading || isStreaming}
            onClick={handleEditWithFeedback}
            className="block w-full text-left px-4 py-2 text-sm font-sans text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)] transition-colors"
          >
            Edit with feedback
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

**Removed items:**
- "Rewrite with tags" (replaced by "Rewrite with feedback")
- "Edit with tags" (replaced by "Edit with feedback")
- Split button design (now single "Actions" button)

### Step 8: Update TagBar

**File:** `src/components/TagBar.tsx`

Update imports and mode checks:

```typescript
import { FeedbackMode } from '@/lib/schemas/schemas';
import { getFeedbackMode } from '@/reducers/tagModeReducer';

// Update mode checks
const feedbackMode = getFeedbackMode(tagState);

// Update title logic
const getTitle = () => {
  switch (feedbackMode) {
    case FeedbackMode.RewriteWithFeedback:
      return 'Rewrite with Feedback';
    case FeedbackMode.EditWithFeedback:
      return 'Edit with Feedback';
    default:
      return 'Apply Tags';
  }
};
```

### Step 9: Update Tests

| File | Changes |
|------|---------|
| `src/lib/schemas/schemas.test.ts` | Update enum name and values: `FeedbackMode`, `'rewrite with feedback'`, `'edit with feedback'` |
| `src/reducers/tagModeReducer.test.ts` | Rename types, actions, helper function; update mode strings |
| `src/components/TagBar.test.tsx` | Update mode refs and assertions |
| `src/components/FeedbackPanel.test.tsx` | Add tests for mode derivation and passing mode to onApply |
| `src/app/results/page.test.tsx` | Update UI tests for new menu structure; remove "with tags" tests |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Update selectors: remove `rewrite-with-tags`, `edit-with-tags`; update `rewrite-with-feedback`, add `edit-with-feedback` |

---

## Files Summary

| File | Change |
|------|--------|
| `src/lib/prompts.ts` | Add `editExplanationWithSourcesPrompt` function |
| `src/lib/services/returnExplanation.ts` | Update decision logic for 4 prompt combinations |
| `src/lib/schemas/schemas.ts` | Rename `TagBarMode` → `FeedbackMode`, update values |
| `src/reducers/tagModeReducer.ts` | Rename types/actions/helper, update mode strings |
| `src/components/FeedbackPanel.tsx` | Derive mode from state, pass to onApply |
| `src/components/TagBar.tsx` | Update imports and mode checks |
| `src/app/results/page.tsx` | New handlers, updated UI, remove "with tags" options |
| Tests (6 files) | Update references and assertions |

---

## Verification

1. `npm run type-check` after each step
2. `npm test` for unit tests
3. `npm run test:e2e -- --project=chromium-unauth` for E2E
4. Manual test matrix:

| Test Case | Expected |
|-----------|----------|
| Rewrite (no feedback) | Immediate regeneration |
| Rewrite with feedback (tags only) | Regenerate with tag rules |
| Rewrite with feedback (sources only) | Regenerate with citations |
| Rewrite with feedback (tags + sources) | Regenerate with rules + citations |
| Edit with feedback (tags only) | Modify existing with tag rules |
| Edit with feedback (sources only) | Modify existing with citations |
| Edit with feedback (tags + sources) | Modify existing with rules + citations |
