# Implementation Plan: Unified AI Editing Panel (Hybrid Approach)

## Status: READY TO IMPLEMENT

**Last Reviewed**: 2024-12-31
**Review Notes**: Plan updated after critical evaluation. All gaps addressed - source infrastructure reused from import_sources, state architecture specified, testing expanded.

---

## Background

The AI editing experience is currently fragmented across multiple UI components with overlapping functionality. Users have three separate ways to interact with AI-powered editing: the AI Suggestions Panel (inline diffs), the FeedbackPanel (sources + tags for rewrite), and TagBar special modes (RewriteWithTags, EditWithTags). This creates confusion about which tool to use and increases codebase complexity with duplicated state management.

## Problem

Users cannot add source URLs to AI suggestions (inline diff mode) - sources are only available in FeedbackPanel which forces a full rewrite. The TagBar has three modes (Normal, RewriteWithTags, EditWithTags) that duplicate functionality now moving to a unified modal. FeedbackPanel is a 204-line component that will be entirely replaced. The lack of output mode control means users cannot choose between quick inline edits and full rewrites from the same interface.

## Options Considered

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A: Unified Sidebar + Modal (Hybrid)** | Keep sidebar for quick edits, add modal for advanced settings with tags | Familiar UX, progressive disclosure, reuses existing components | Two components to maintain | ✅ **Selected** |
| **B: Full-Screen Editor Only** | Replace sidebar with full-screen editor | Maximum space for editing | Disrupts workflow, loses context | ❌ Rejected |
| **C: Expandable Sidebar** | Sidebar that resizes from 340px to 600px | Single component | Complex drag logic, limited space even at 600px | ❌ Rejected |
| **D: Keep Current System** | Maintain FeedbackPanel and special tag modes | No work needed | Fragmented UX, duplicated code, sources not in suggestions | ❌ Rejected |

---

## Goals

1. **Consolidate UI** - Single entry point for AI editing (sidebar + modal)
2. **Add sources everywhere** - SourceList available in both sidebar and modal
3. **User controls output** - Toggle between inline diff and rewrite
4. **Reduce codebase complexity** - Deprecate FeedbackPanel and simplify TagBar modes

## Non-Goals (Explicitly Out of Scope)

- **Icon rail collapsed state** - Current collapsible sidebar is sufficient for MVP
- **Continuous drag-to-resize** - Complex to implement, questionable value
- **600px intermediate state** - Jump straight to modal for "expanded" editing
- **Real-time collaborative editing** - Out of scope entirely

---

## Critical Design Decisions (from Code Review)

These decisions were made after exploring the existing codebase architecture:

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Rewrite behavior** | Creates NEW explanation (uses existing `handleUserAction` with `UserInputType.Rewrite`) | Reuses existing generation pipeline. Simpler than building in-place replacement. Note: explanation_id will change. |
| **Modal design** | Advanced AI editor modal only (no preview pane) | Modal is for configuring AI request, not viewing content. User sees content on results page behind modal. Simpler implementation. |
| **Source wiring approach** | Reuse existing source infrastructure | `getOrCreateCachedSource`, `SourceForPromptType`, and `createExplanationWithSourcesPrompt` already exist from import_sources feature. |

### Existing Source Infrastructure (from import_sources)

The following utilities already exist and will be reused:

| Component | Location | Purpose |
|-----------|----------|---------|
| `SourceChipType` | `schemas.ts:1008-1017` | UI-layer source representation |
| `SourceForPromptType` | `schemas.ts:1031-1039` | Prompt-layer source representation |
| `getOrCreateCachedSource` | `sourceCache.ts:136-242` | Fetches/caches source content with summarization |
| `createExplanationWithSourcesPrompt` | `prompts.ts:253-294` | Formats sources for LLM with `[n]` citation notation |
| `SourceList`, `SourceChip`, `SourceInput` | `components/sources/` | Complete UI component ecosystem |

### Key Codebase Findings

1. **AI Suggestions Pipeline** (`runAISuggestionsPipelineAction` in `actions.ts:331-396`)
   - Current signature: `(currentContent, userPrompt, sessionData)`
   - `sessionData` does NOT include sources - needs extension
   - Returns CriticMarkup diffs, not streaming

2. **Generation Pipeline** (`handleUserAction` in `page.tsx:267-501`)
   - Uses `UserInputType.Rewrite` for full regeneration
   - Streams response, creates NEW explanation
   - Already accepts `sourceUrls` parameter

3. **Source Pipeline** (ALREADY EXISTS)
   - `createExplanationWithSourcesPrompt` formats sources with `[VERBATIM]` / `[SUMMARIZED]` markers
   - `getOrCreateCachedSource` handles fetching, caching, and summarization
   - Just needs wiring to AI suggestions pipeline (currently only used in generation)

4. **Components Ready for Reuse**
   - `SourceList`, `SourceChip`, `SourceInput` ecosystem is complete and tested
   - Tag chip rendering from `TagBar.tsx` can be extracted

---

## Architecture

### MVP Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│  Results Page                                               │
│  ┌─────────────────────────────┐  ┌──────────────────────┐ │
│  │                             │  │ AI Editor Panel (340px)   │ │
│  │  Content Area               │  │                      │ │
│  │                             │  │ [Quick Actions]      │ │
│  │                             │  │ [Prompt textarea]    │ │
│  │                             │  │ [Sources] ← NEW      │ │
│  │                             │  │ [Output mode] ← NEW  │ │
│  │                             │  │ [Get Suggestions]    │ │
│  │                             │  │ [Expand ⤢] ← NEW     │ │
│  │                             │  │ [History]            │ │
│  └─────────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                            ↓ Click "Expand"
┌─────────────────────────────────────────────────────────────┐
│  AI EDITOR SETTINGS MODAL (centered, ~500px wide)           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  AI Editor                                      [✕]   │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │                                                       │  │
│  │  [Quick Actions]                                      │  │
│  │  [Simplify] [Expand] [Fix Grammar] [Make Formal]      │  │
│  │                                                       │  │
│  │  [Prompt]                                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ Larger textarea for detailed prompts...         │  │  │
│  │  │                                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  [Tags]                                               │  │
│  │  [chip][chip][chip][+ Add tag]                        │  │
│  │                                                       │  │
│  │  [Sources]                                            │  │
│  │  [url][url][+ Add source]                             │  │
│  │                                                       │  │
│  │  [Output Mode]                                        │  │
│  │  ○ Inline diff    ● Rewrite                           │  │
│  │                                                       │  │
│  │  ┌─────────────┐                    ┌─────────────┐   │  │
│  │  │   Cancel    │                    │    Apply    │   │  │
│  │  └─────────────┘                    └─────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No preview pane in modal** | Modal is for configuring the AI request, not viewing content. User sees content on results page behind modal. Avoids duplicating results page layout. |
| **No intermediate 600px state** | Adds complexity without clear value. Binary: sidebar OR modal. |
| **Results page lifts state** | Single source of truth for AI editor state. Both sidebar and modal receive props. |
| **Tags in modal only** | Tags are a "power feature". Sidebar stays simple (prompt + sources). |

### UI Component Relationships (After Implementation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Results Page                                                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  TagBar (Normal Mode Only)                                       │   │
│  │  ────────────────────────────────────────────────────────────── │   │
│  │  Purpose: Quick tag updates WITHOUT AI                          │   │
│  │  - Add/remove/switch tags on current explanation                │   │
│  │  - "Apply" → updates DB directly (no regeneration)              │   │
│  │  - Separate from AI editing workflow                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌───────────────────────────────┐  ┌──────────────────────────────┐   │
│  │  Content Area                 │  │  AI Editor Panel        │   │
│  │                               │  │  (Sidebar)                   │   │
│  │  [Lexical Editor]             │  │                              │   │
│  │                               │  │  [Prompt]                    │   │
│  │                               │  │  [Sources] ← NEW             │   │
│  │                               │  │  [Output Mode] ← NEW         │   │
│  │                               │  │  [Get Suggestions]           │   │
│  │                               │  │  [Expand ⤢] → Opens Modal    │   │
│  └───────────────────────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼ Click "Expand"
┌─────────────────────────────────────────────────────────────────────────┐
│  AdvancedAIEditorModal (Settings Panel, ~500px centered)                        │
│  ─────────────────────────────────────────────────────────────────────  │
│  Purpose: Advanced AI settings WITH tags                                │
│  - All sidebar features PLUS tag selection                              │
│  - Tags passed to AI prompt (replaces RewriteWithTags/EditWithTags)    │
│  - NO preview pane - user sees content on results page behind modal    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Separation:**
- **TagBar** = Tag metadata management (no AI)
- **AI Editor Panel/Modal** = AI-powered content editing (with optional tags in modal)

### State Architecture

**State is LIFTED to results/page.tsx** to avoid prop drilling and ensure single source of truth:

```typescript
// In results/page.tsx (parent owns all state)

// AI Editor State (shared between sidebar and modal)
const [aiEditorState, setAIEditorState] = useState<AIEditorState>({
  prompt: '',
  sources: [] as SourceChipType[],
  outputMode: 'inline-diff' as 'inline-diff' | 'rewrite',
});

// Modal-specific state
const [isModalOpen, setIsModalOpen] = useState(false);

// Derived callbacks passed to children
const updatePrompt = useCallback((p: string) =>
  setAIEditorState(s => ({ ...s, prompt: p })), []);
const updateSources = useCallback((sources: SourceChipType[]) =>
  setAIEditorState(s => ({ ...s, sources })), []);
const updateOutputMode = useCallback((mode: 'inline-diff' | 'rewrite') =>
  setAIEditorState(s => ({ ...s, outputMode: mode })), []);

// Unified execute callback (hides handleUserAction complexity)
const executeAIEdit = useCallback(async (request: {
  prompt: string;
  sources: SourceChipType[];
  outputMode: 'inline-diff' | 'rewrite';
  tags?: string[]; // Tag descriptions for rewrite
}) => {
  if (request.outputMode === 'inline-diff') {
    // Call existing runAISuggestionsPipelineAction with sources
    const formattedSources = await formatSourcesForPrompt(request.sources, userid);
    await runAISuggestionsPipelineAction(currentContent, request.prompt, {
      ...sessionData,
      sources: formattedSources
    });
  } else {
    // Call handleUserAction for rewrite (creates new explanation)
    await handleUserAction(
      request.prompt,
      UserInputType.Rewrite,
      mode,
      userid,
      request.tags || [],
      explanationId,
      explanationVector,
      request.sources
    );
  }
}, [handleUserAction, mode, userid, explanationId, explanationVector, currentContent, sessionData]);
```

### Props Flow Diagram

```
results/page.tsx
├── aiEditorState: { prompt, sources, outputMode }
├── executeAIEdit: (request) => Promise<void>
├── isModalOpen: boolean
├── setIsModalOpen: (open: boolean) => void
│
├─→ AIEditorPanel (sidebar)
│     Props:
│     ├── prompt, onPromptChange
│     ├── sources, onSourcesChange
│     ├── outputMode, onOutputModeChange
│     ├── onExecute: () => executeAIEdit({...state})
│     ├── onOpenModal: () => setIsModalOpen(true)
│     └── isLoading, history, lastResult (internal state)
│
└─→ AdvancedAIEditorModal
      Props:
      ├── isOpen, onClose
      ├── initialPrompt, initialSources, initialOutputMode (from parent state)
      ├── tagState, dispatchTagAction (for tag selection)
      ├── onApply: (localState) => {
      │     updatePrompt(localState.prompt);
      │     updateSources(localState.sources);
      │     updateOutputMode(localState.outputMode);
      │     executeAIEdit({...localState, tags: extractTagDescriptions()});
      │     setIsModalOpen(false);
      │   }
      └── explanationId (for tag loading)
```

### Modal State Flow

```
Modal opens:
  → Local state initialized from parent props (prompt, sources, outputMode)
  → Tags loaded from explanation via explanationId
  → isDirty = false

User makes changes:
  → Local state updates (localPrompt, localSources, localOutputMode, localTags)
  → isDirty = true (if any differ from initial)

Modal Apply:
  → Call onApply callback with local state
  → Parent updates aiEditorState
  → Parent calls executeAIEdit
  → For Inline Diff: wait for result, then close modal
  → For Rewrite: close modal immediately, streaming shows on page

Modal Cancel:
  → If isDirty: show warning dialog ("Discard changes?")
  → If confirmed or not dirty: close modal, discard local state
```

### Dirty State Detection

```typescript
// In AdvancedAIEditorModal.tsx
const isDirty = useMemo(() => {
  // Simple comparisons
  if (localPrompt !== initialPrompt) return true;
  if (localOutputMode !== initialOutputMode) return true;

  // Sources comparison (by URL)
  if (localSources.length !== initialSources.length) return true;
  if (localSources.some((s, i) => s.url !== initialSources[i]?.url)) return true;

  // Tags comparison (reuse existing helper)
  if (hasModifiedTags(localTags)) return true;

  return false;
}, [localPrompt, localSources, localOutputMode, localTags,
    initialPrompt, initialSources, initialOutputMode]);
```

### Rewrite Streaming Timing

When "Rewrite" is selected in modal:

```
1. User clicks Apply
2. Modal shows "Applying..." button state (2 seconds max)
3. onApply callback fires:
   a. Updates parent state
   b. Calls executeAIEdit (async)
   c. Does NOT await result
4. Modal closes immediately after executeAIEdit call starts
5. User sees streaming on main page
6. If error occurs: toast notification (not modal - it's already closed)
```

This approach:
- ✅ Provides immediate feedback
- ✅ Consistent with sidebar behavior
- ✅ Errors shown via toast, not lost
- ❌ If error before streaming starts, user might not see it (acceptable tradeoff)

---

## Implementation Phases

### Phase 0: Foundation - Wire Sources to AI Suggestions Pipeline

**Goal**: Enable source URLs in AI suggestions pipeline before adding UI.

**Existing Infrastructure to Reuse**:
```typescript
// Already exists in schemas.ts:1031-1039
export const sourceForPromptSchema = z.object({
  index: z.number().int().min(1).max(5),
  title: z.string(),
  domain: z.string(),
  content: z.string(),
  isVerbatim: z.boolean(),
});
export type SourceForPromptType = z.infer<typeof sourceForPromptSchema>;

// Already exists in sourceCache.ts:136-242
export async function getOrCreateCachedSource(
  url: string,
  userid: string
): Promise<{
  source: SourceCacheFullType | null;
  isFromCache: boolean;
  error: string | null;
}>
```

**Changes**:

1. **Add SessionData schema** (`src/lib/schemas/schemas.ts`):
```typescript
// Add after line 1039
export const aiSuggestionSessionDataSchema = z.object({
  explanation_id: z.number().int().positive(),
  explanation_title: z.string(),
  user_prompt: z.string().optional(),
  sources: z.array(sourceForPromptSchema).optional(),
});
export type AISuggestionSessionDataType = z.infer<typeof aiSuggestionSessionDataSchema>;
```

2. **Add source formatting utility** (`src/editorFiles/aiSuggestion.ts`):
```typescript
import { getOrCreateCachedSource } from '@/lib/services/sourceCache';
import type { SourceChipType, SourceForPromptType } from '@/lib/schemas/schemas';

/**
 * Converts UI-layer sources to prompt-layer format
 * Fetches content via getOrCreateCachedSource (handles caching/summarization)
 */
export async function formatSourcesForPrompt(
  sources: SourceChipType[],
  userid: string
): Promise<SourceForPromptType[]> {
  const formatted: SourceForPromptType[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source.status !== 'success') continue; // Skip failed/loading

    try {
      const result = await getOrCreateCachedSource(source.url, userid);
      if (!result.source?.extracted_text) continue;

      formatted.push({
        index: i + 1,
        title: result.source.title || source.domain,
        domain: source.domain,
        content: result.source.extracted_text,
        isVerbatim: !result.source.is_summarized,
      });
    } catch (error) {
      logger.warn('Failed to fetch source for prompt', { url: source.url, error });
      // Continue with other sources
    }
  }

  return formatted;
}
```

3. **Modify createAISuggestionPrompt** (`src/editorFiles/aiSuggestion.ts:55-104`):
```typescript
export function createAISuggestionPrompt(
  currentText: string,
  userPrompt: string,
  sources?: SourceForPromptType[]  // NEW optional parameter
): string {
  // Format sources section if provided
  const sourcesSection = sources && sources.length > 0
    ? `
## Reference Sources
${sources.map(s => `[Source ${s.index}] ${s.title} (${s.domain}) [${s.isVerbatim ? 'VERBATIM' : 'SUMMARIZED'}]
---
${s.content}
---`).join('\n\n')}

Use these sources to inform your edits. Cite with [n] notation where appropriate.
`
    : '';

  return `Apply the following edit instruction to the article below:
"${userPrompt}"

Only make edits relevant to this instruction. Do not make other improvements.
${sourcesSection}
<output_format>
... (rest of existing prompt)
`;
}
```

4. **Update runAISuggestionsPipelineAction** (`src/editorFiles/actions/actions.ts:331-396`):
```typescript
export const runAISuggestionsPipelineAction = withLogging(
    async function runAISuggestionsPipelineAction(
        currentContent: string,
        userPrompt: string,
        sessionData?: {
            explanation_id: number;
            explanation_title: string;
            sources?: SourceForPromptType[];  // NEW field
        }
    ): Promise<{...}> {
        // ... existing code ...

        // Pass sources to prompt construction
        const { getAndApplyAISuggestions } = await import('../aiSuggestion');
        const result = await getAndApplyAISuggestions(
            currentContent,
            null,
            undefined,
            {
                ...sessionRequestData,
                sources: sessionData?.sources  // Pass through
            }
        );
        // ...
    }
);
```

**Files Modified**:
- `src/lib/schemas/schemas.ts` - Add `AISuggestionSessionDataType`
- `src/editorFiles/aiSuggestion.ts` - Add `formatSourcesForPrompt`, modify `createAISuggestionPrompt`
- `src/editorFiles/actions/actions.ts` - Add sources to sessionData type

**Verification**:
- Unit test: `createAISuggestionPrompt` without sources (backward compatible)
- Unit test: `createAISuggestionPrompt` with sources includes formatted content
- Unit test: `formatSourcesForPrompt` handles failed sources gracefully
- Integration test: full pipeline with sources end-to-end

---

### Phase 1: Add Sources to Sidebar (Low Risk, High Value)

**Goal**: Enable source URLs in existing AI suggestions pipeline.

**Changes**:
1. Rename `AISuggestionsPanel.tsx` → `AIEditorPanel.tsx`
2. Update imports across codebase
3. Add `sources` state to component (lifted to parent)
4. Embed compact `SourceList` component below prompt
5. Pass sources to `runAISuggestionsPipelineAction` via `formatSourcesForPrompt`

**Files**:
- `src/components/AISuggestionsPanel.tsx` → `src/components/AIEditorPanel.tsx` (rename)
- `src/app/results/page.tsx` - Update import, add sources state
- All files importing `AISuggestionsPanel` - Update imports

**Verification**:
- Add source URL in sidebar
- Run AI suggestions
- Verify source content appears in AI prompt (check logs)

---

### Phase 2: Add Output Mode Toggle (Medium Risk)

**Goal**: Let user choose between inline diff and rewrite.

**Changes**:
1. Create `OutputModeToggle` component (radio group)
2. Add to sidebar (below sources)
3. Route to different backends based on selection:
   - `inline-diff` → existing `runAISuggestionsPipelineAction`
   - `rewrite` → existing `handleUserAction` with `UserInputType.Rewrite`

**Files**:
- `src/components/OutputModeToggle.tsx` - New component
- `src/components/AIEditorPanel.tsx` - Add toggle, routing logic
- `src/app/results/page.tsx` - Pass `executeAIEdit` callback

**OutputModeToggle Component**:
```typescript
interface OutputModeToggleProps {
  value: 'inline-diff' | 'rewrite';
  onChange: (mode: 'inline-diff' | 'rewrite') => void;
  disabled?: boolean;
}

// data-testid attributes:
// - output-mode-toggle
// - output-mode-inline-diff
// - output-mode-rewrite
```

**Key Implementation Detail**:
"Rewrite" uses the EXISTING generation pipeline (`handleUserAction`), NOT a new action. This means:
- Creates a NEW explanation (explanation_id changes)
- Uses streaming response pattern
- Label clearly communicates that this generates fresh content

**Verification**:
- Toggle to "Inline diff" → see CriticMarkup diffs
- Toggle to "Rewrite" → new explanation generates with streaming

---

### Phase 3: Create Advanced AI Editor Modal (Medium Risk)

**Goal**: Expanded advanced AI editor modal with tags (power feature not in sidebar).

**Changes**:
1. Create `AdvancedAIEditorModal.tsx` - single-column advanced AI editor modal (~500px centered)
2. Extract tag selection UI from `TagBar.tsx` → `TagSelector.tsx`
3. Add "Expand" button to sidebar that opens modal
4. Modal receives state from parent, has own local state for dirty tracking
5. Apply button calls parent callback and closes

**Files**:
- `src/components/AdvancedAIEditorModal.tsx` - New modal component
- `src/components/TagSelector.tsx` - Extracted from TagBar
- `src/components/AIEditorPanel.tsx` - Add expand button
- `src/app/results/page.tsx` - Add modal state, pass props

**TagSelector Interface**:
```typescript
interface TagSelectorProps {
  tags: TagUIType[];
  onChange: (tags: TagUIType[]) => void;
  explanationId?: number;
  disabled?: boolean;
  className?: string;
}

// Extracts from TagBar.tsx:
// - Lines 302-396: TagChip rendering (simple + preset)
// - Lines 187-270: Add tag functionality
// - Lines 167-185: Remove/restore handlers

// Does NOT include:
// - Apply/Reset buttons (modal handles this)
// - Mode-specific routing (removed in Phase 5)
// - Panel container styling

// data-testid attributes:
// - tag-selector
// - tag-chip-{id}
// - add-tag-button
```

**AdvancedAIEditorModal Interface**:
```typescript
interface AdvancedAIEditorModalProps {
  isOpen: boolean;
  onClose: () => void;

  // Inherited from parent state
  initialPrompt: string;
  initialSources: SourceChipType[];
  initialOutputMode: 'inline-diff' | 'rewrite';

  // Tags (from results page)
  tagState: TagModeState;
  dispatchTagAction: React.Dispatch<TagModeAction>;
  explanationId?: number;

  // Callbacks
  onApply: (data: {
    prompt: string;
    sources: SourceChipType[];
    outputMode: 'inline-diff' | 'rewrite';
    tags: TagUIType[];
  }) => Promise<void>;

  isLoading?: boolean;
}

// data-testid attributes:
// - advanced-ai-modal
// - modal-prompt-textarea
// - modal-apply-button
// - modal-cancel-button
// - modal-expand-button (on sidebar, opens this)
```

**Why No Preview Pane**:
- Modal is for configuring AI request settings, not viewing content
- User can see content on results page behind the modal
- Avoids duplicating the results page layout
- Simpler implementation

**Verification**:
- Click "Expand" → modal opens with sidebar state
- Modify prompt in modal → Apply → sidebar state updated
- Cancel with changes → warning shown

---

### Phase 4: Wire Both Pipelines in Modal (Medium Risk)

**Goal**: Modal can execute both inline diff and rewrite.

**Changes**:
1. Add output mode toggle to modal
2. Route Apply to correct backend via `onApply` callback
3. Handle loading states for both pipelines
4. Implement streaming timing (close modal when rewrite starts)

**Files**:
- `src/components/AdvancedAIEditorModal.tsx` - Add toggle, dual routing
- `src/app/results/page.tsx` - Implement `executeAIEdit` callback

**Streaming Timing Implementation**:
```typescript
// In AdvancedAIEditorModal.tsx
const handleApply = async () => {
  setIsApplying(true);

  try {
    if (localOutputMode === 'inline-diff') {
      // Wait for result before closing
      await onApply({...});
      onClose();
    } else {
      // Rewrite: close immediately, streaming shows on page
      onApply({...}); // Fire and forget
      onClose();
    }
  } catch (error) {
    // For inline-diff errors, show in modal
    if (localOutputMode === 'inline-diff') {
      setError(error.message);
    }
    // For rewrite errors, toast will show on page
  } finally {
    setIsApplying(false);
  }
};
```

**Error Handling**:
- Inline diff errors: Show in modal (modal stays open)
- Rewrite errors: Toast notification on page (modal already closed)

**Verification**:
- Modal with "Inline diff" → diffs appear in editor, stay on same page
- Modal with "Rewrite" → modal closes, new explanation loads with streaming

---

### Phase 5: Deprecate FeedbackPanel & Special Tag Modes (Low Risk, High Value)

**Goal**: Remove parallel UI system, simplify codebase, but PRESERVE TagBar's quick tag update functionality.

#### What We're Keeping vs Removing

| Component/Feature | Action | Rationale |
|-------------------|--------|-----------|
| **TagBar (Normal mode)** | ✅ KEEP | Quick tag updates without AI editing - distinct use case |
| **TagBar (RewriteWithTags mode)** | ❌ REMOVE | Moves to modal with "Rewrite" + tags |
| **TagBar (EditWithTags mode)** | ❌ REMOVE | Moves to modal with "Inline Diff" + tags |
| **FeedbackPanel** | ❌ DELETE | Entirely replaced by modal |
| **tagModeReducer special modes** | ❌ SIMPLIFY | Only Normal mode needed |

#### TagBar Behavior After Changes

**PRESERVED functionality** (Normal mode):
- User clicks tag chips to add/remove/switch tags
- "Apply" button calls `handleApplyForModifyTags(explanationId, tags)` directly
- Updates explanation's tags in database WITHOUT regenerating content
- No AI involvement - just tag metadata updates
- Title always renders as "Apply Tags"

**REMOVED functionality**:
- `modeOverride === TagBarMode.RewriteWithTags` branch
- `modeOverride === TagBarMode.EditWithTags` branch
- `tagBarApplyClickHandler` prop usage for special modes
- `modeOverride` variable (no longer needed)
- `extractActiveTagDescriptions` helper function
- `handleApplyRewriteWithTags` and `handleApplyEditWithTags` functions

#### Dropdown Menu Changes

**Current dropdown items** (actual code, to be removed):
- "Rewrite with tags" → Opens TagBar in RewriteWithTags mode
- "Edit with tags" → Opens TagBar in EditWithTags mode
- "Rewrite with feedback" → Opens FeedbackPanel

**New dropdown item** (replacement):
- **"Advanced AI editor..."** → Opens `AdvancedAIEditorModal`

#### Files to Modify

**`src/app/results/page.tsx`**:
- Remove `FeedbackPanel` import and usage
- Remove `showFeedbackPanel` state variable (line 56)
- Remove `handleFeedbackPanelApply` (lines 537-560)
- Remove `handleFeedbackPanelReset` (lines 565-568)
- Remove `handleOpenFeedbackPanel` (lines 573-579)
- Remove sources state for feedback panel
- Replace dropdown items with "Advanced AI editor..."
- Wire new dropdown to open `AdvancedAIEditorModal`

**`src/reducers/tagModeReducer.ts`**:
- Remove `RewriteWithTagsModeState` type (lines 37-43)
- Remove `EditWithTagsModeState` type (lines 50-56)
- Remove `ENTER_REWRITE_MODE` action handling (lines 173-180)
- Remove `ENTER_EDIT_MODE` action handling (lines 185-196)
- Simplify `TagModeAction` type
- Keep: `NormalModeState`, `LOAD_TAGS`, `UPDATE_TAGS`, `RESET_TAGS`, `APPLY_TAGS`, `EXIT_TO_NORMAL`, `TOGGLE_DROPDOWN`

**`src/components/TagBar.tsx`**:
- Remove `tagBarApplyClickHandler` prop from interface (line 16)
- Remove `modeOverride` variable usage (line 26)
- Remove `handleApplyRewriteWithTags` function (lines 105-108)
- Remove `handleApplyEditWithTags` function (lines 109-117)
- Remove mode-specific routing in `handleApplyRouter` (lines 77-80)
- Simplify to always call `handleApplyNormal`
- Remove `extractActiveTagDescriptions` function (lines 86-103)
- Remove mode-specific title rendering (lines 500-502) - always show "Apply Tags"

**`src/components/FeedbackPanel.tsx`**:
- DELETE entirely

#### Test Files to Modify

**`src/reducers/tagModeReducer.test.ts`** (delete ~150 lines):
- Lines 114-156: Tests for `ENTER_REWRITE_MODE` action
- Lines 159-198: Tests for `ENTER_EDIT_MODE` action
- Lines 420-434: Reset from rewrite mode test
- Lines 436-452: Reset from edit mode test
- Lines 497-512: Apply from rewrite mode test
- Lines 514-528: Apply from edit mode test
- Lines 570-580: isTagsModified in rewrite mode test
- Lines 581-591: isTagsModified in edit mode test
- Lines 607-617: getCurrentTags in rewrite mode test
- Lines 644-653: getTagBarMode for RewriteWithTags test
- Lines 655-664: getTagBarMode for EditWithTags test

**`src/components/TagBar.test.tsx`** (delete ~100 lines):
- Lines 148-162: "RewriteWithTags" title rendering test
- Lines 164-178: "EditWithTags" title rendering test
- Lines 926-946: Apply with RewriteWithTags mode test
- Lines 948-968: Apply with EditWithTags mode test
- Lines 970-994: Extract active tags for rewrite test
- Lines 996-1023: Extract descriptions from preset tags test

**Migration**:
- Users who used "Edit with tags" → now use modal with tags + inline diff
- Users who used "Rewrite with tags" → now use modal with tags + rewrite
- Users who just want to update tags → **unchanged experience** via TagBar

**Verification**:
- ✅ TagBar still shows tags in Normal mode
- ✅ Users can add/remove/switch tags
- ✅ "Apply" button updates tags on explanation (no AI)
- ✅ "Advanced AI editor..." dropdown opens modal
- ✅ All AI-powered editing flows work through sidebar/modal
- ✅ Codebase is simpler (fewer modes, fewer components)
- ✅ All tests pass after removing deprecated test cases

---

## Future Enhancements (Post-MVP)

These are explicitly deferred:

1. **Resizable sidebar** - Drag handle for continuous resize
2. **Icon rail** - Collapsed state showing only icons
3. **Editable preview** - Full Lexical editor in modal
4. **History in modal** - Show suggestion history
5. **Keyboard shortcuts** - Cmd+Shift+E for modal

---

## Technical Risks & Mitigations

| Risk | Impact | Mitigation | Status |
|------|--------|------------|--------|
| Rewrite streaming differs from inline diff | Medium | Use existing `handleUserAction` - no new streaming code needed | ✅ Resolved |
| Tag loading requires explanation context | Low | Pass explanationId through props from results page | ✅ Resolved |
| Modal state sync with sidebar | Medium | Parent owns state, modal copies on open | ✅ Resolved |
| SourceList behavior in compact mode | Low | Already used in FeedbackPanel, proven | ✅ Resolved |
| Sources not accepted by AI pipeline | High | Reuse existing `getOrCreateCachedSource` and `SourceForPromptType` | ✅ Resolved |
| `createAISuggestionPrompt` doesn't include sources | High | Add optional sources parameter, format with existing infrastructure | ✅ Resolved |
| Prop drilling for handleUserAction | Medium | Create `executeAIEdit` wrapper that hides complexity | ✅ Resolved |
| Rewrite modal close timing | Medium | Close immediately after starting, errors via toast | ✅ Resolved |

### Resolved Architecture Questions

1. **Q: How does Rewrite work without new pipeline?**
   A: Reuses `handleUserAction` with `UserInputType.Rewrite`. Creates new explanation (acceptable).

2. **Q: Why no preview pane in modal?**
   A: Modal is for configuring AI request settings. User can see content on results page behind modal. Avoids duplicating the layout.

3. **Q: How are sources wired to AI suggestions?**
   A: Reuse existing `getOrCreateCachedSource` for fetching and `SourceForPromptType` for formatting. Add to `createAISuggestionPrompt` as optional parameter.

4. **Q: How to avoid prop drilling?**
   A: Lift state to results/page.tsx. Create `executeAIEdit` wrapper callback that hides `handleUserAction` complexity.

---

## File Changes Summary

### New Files
| File | Purpose | Phase |
|------|---------|-------|
| `src/components/AdvancedAIEditorModal.tsx` | Advanced AI editor modal with tags, sources, output mode | 3 |
| `src/components/OutputModeToggle.tsx` | Radio toggle for inline diff vs rewrite | 2 |
| `src/components/TagSelector.tsx` | Extracted tag selection UI | 3 |

### Renamed Files
| From | To | Phase |
|------|-----|-------|
| `src/components/AISuggestionsPanel.tsx` | `src/components/AIEditorPanel.tsx` | 1 |

### Modified Files
| File | Changes | Phase |
|------|---------|-------|
| `src/lib/schemas/schemas.ts` | Add `AISuggestionSessionDataType` | 0 |
| `src/editorFiles/aiSuggestion.ts` | Add `formatSourcesForPrompt`, modify `createAISuggestionPrompt` | 0 |
| `src/editorFiles/actions/actions.ts:331-396` | Add sources to sessionData | 0 |
| `src/components/AIEditorPanel.tsx` | Add sources UI, output mode, expand button | 1-2 |
| `src/app/results/page.tsx` | Lift state, add executeAIEdit, add modal, remove FeedbackPanel | 1-5 |
| `src/reducers/tagModeReducer.ts` | Remove RewriteWithTags/EditWithTags modes | 5 |
| `src/reducers/tagModeReducer.test.ts` | Remove ~150 lines of special mode tests | 5 |
| `src/components/TagBar.tsx` | Remove special mode handling | 5 |
| `src/components/TagBar.test.tsx` | Remove ~100 lines of special mode tests | 5 |

### Deleted Files
| File | Reason | Phase |
|------|--------|-------|
| `src/components/FeedbackPanel.tsx` | Replaced by modal | 5 |

### Key Code Locations Reference
| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| AI Pipeline Action | `actions.ts` | 331-396 | `runAISuggestionsPipelineAction` signature |
| Prompt Construction | `aiSuggestion.ts` | 55-104 | `createAISuggestionPrompt` |
| Source Fetcher | `sourceCache.ts` | 136-242 | `getOrCreateCachedSource` |
| Source Prompt Format | `prompts.ts` | 253-294 | `createExplanationWithSourcesPrompt` (reference) |
| Generation Handler | `page.tsx` | 267-501 | `handleUserAction` for rewrite |
| Panel State | `AISuggestionsPanel.tsx` | 209-235 | Current state variables |
| Panel Submit | `AISuggestionsPanel.tsx` | 241-366 | Submit handler logic |
| Sidebar Rendering | `page.tsx` | 1393-1427 | AIEditorPanel props |
| Tag/Feedback Toggle | `page.tsx` | 1285-1314 | Conditional rendering |

---

## Testing Strategy

### data-testid Attributes (Required for E2E)

| Component | Attribute | Purpose |
|-----------|-----------|---------|
| OutputModeToggle | `output-mode-toggle` | Container |
| OutputModeToggle | `output-mode-inline-diff` | Inline diff radio |
| OutputModeToggle | `output-mode-rewrite` | Rewrite radio |
| AdvancedAIEditorModal | `advanced-ai-modal` | Modal container |
| AdvancedAIEditorModal | `modal-prompt-textarea` | Prompt input |
| AdvancedAIEditorModal | `modal-apply-button` | Apply button |
| AdvancedAIEditorModal | `modal-cancel-button` | Cancel button |
| AIEditorPanel | `modal-expand-button` | Opens modal |
| AIEditorPanel | `sidebar-source-list` | Source list container |
| TagSelector | `tag-selector` | Tag selection container |
| TagSelector | `tag-chip-{id}` | Individual tag chips |
| TagSelector | `add-tag-button` | Add tag button |

### Unit Tests

**Phase 0: Source Integration (6 tests)**
- `createAISuggestionPrompt` without sources (backward compatible)
- `createAISuggestionPrompt` with sources includes formatted content
- `createAISuggestionPrompt` with empty sources array
- `formatSourcesForPrompt` handles successful sources
- `formatSourcesForPrompt` skips failed/loading sources
- `formatSourcesForPrompt` handles fetch errors gracefully

**Phase 1-2: AIEditorPanel (10 tests)**
- Sources state add/remove
- SourceList renders correctly
- Sources passed to pipeline action
- Output mode toggle default state
- Output mode toggle fires onChange
- Output mode disabled state
- Expand button renders and fires onClick
- Submit button disabled states
- Loading state display
- Success/error message display

**Phase 3-4: Modal Components (15 tests)**
- Modal opens with correct initial state
- Modal local state can diverge from initial
- isDirty detection for prompt changes
- isDirty detection for source changes
- isDirty detection for output mode changes
- isDirty detection for tag changes
- Warning dialog on dirty cancel
- Apply button disabled when not dirty
- Apply button calls onApply with correct data
- Tags load from explanationId
- TagSelector selection/deselection
- TagSelector preset switching
- TagSelector add tag functionality
- Output mode toggle in modal
- Loading state during apply

**Phase 5: Deprecation (update existing tests)**
- Remove ~150 lines from tagModeReducer.test.ts
- Remove ~100 lines from TagBar.test.tsx
- Verify remaining tests pass

### Integration Tests

**Phase 0: Source Pipeline (4 tests)**
- Sources fetched from source_cache
- Source content passed to AI model
- Source fetch errors don't block pipeline
- Existing calls without sources still work (backward compatible)

**Phase 1-2: Sidebar Integration (4 tests)**
- Sidebar sources → action → pipeline → prompt includes sources
- Output mode toggle → correct backend called
- Inline diff → runAISuggestionsPipelineAction
- Rewrite → handleUserAction with streaming

**Phase 3-4: Modal Integration (4 tests)**
- Modal Apply → parent state updated → pipeline executes
- Tags from modal → passed to pipeline
- Inline diff from modal → diffs in editor
- Rewrite from modal → new explanation created

**Phase 5: Deprecation Regression (3 tests)**
- TagBar Normal mode: add tag → Apply → DB updated (no AI)
- TagBar Normal mode: switch preset → Apply → DB updated
- AI editing flows only work through sidebar/modal

### E2E Tests

**Source Flow (3 tests)**
- Add source URL in sidebar → Get Suggestions → success
- Add multiple sources → all included in prompt
- Failed source → warning shown → suggestion still works

**Output Mode Flow (3 tests)**
- Sidebar inline-diff → CriticMarkup diffs shown
- Sidebar rewrite → new explanation streams
- Toggle between modes → correct behavior

**Modal Flow (5 tests)**
- Click "Expand" → modal opens with sidebar state
- Change prompt in modal → Apply → diffs in editor
- Change tags in modal → Apply → tags in rewrite
- Cancel with changes → warning shown
- "Advanced AI editor..." dropdown → modal opens

**Regression Tests (3 tests)**
- Existing AI suggestions flow still works
- TagBar Normal mode unaffected
- Diff accept/reject still works

### Test Count Summary

| Category | Count |
|----------|-------|
| Unit Tests | 31 |
| Integration Tests | 15 |
| E2E Tests | 14 |
| **Total** | **60** |

---

## Success Metrics

1. **Codebase reduction**: FeedbackPanel deleted, tagModeReducer simplified, ~250 lines of test code removed
2. **Feature parity**: All current editing flows work through new UI
3. **User clarity**: Single entry point (sidebar) with clear escalation (modal)
4. **No regressions**: Existing AI suggestions continue to work, tests pass
5. **Source integration**: Sources work in both inline diff and rewrite modes

---

## Implementation Checklist

### Phase 0: Foundation
- [ ] Add `AISuggestionSessionDataType` to `schemas.ts`
- [ ] Add `formatSourcesForPrompt` to `aiSuggestion.ts`
- [ ] Modify `createAISuggestionPrompt` to accept optional sources
- [ ] Update `runAISuggestionsPipelineAction` sessionData type
- [ ] Unit tests for source injection (6 tests)
- [ ] Integration test: pipeline with sources end-to-end
- [ ] Verify existing calls still work (backward compatible)

### Phase 1: Sources in Sidebar
- [ ] Rename `AISuggestionsPanel.tsx` → `AIEditorPanel.tsx`
- [ ] Update all imports referencing the old filename
- [ ] Lift sources state to `results/page.tsx`
- [ ] Add sources props to `AIEditorPanel`
- [ ] Embed `SourceList` component below prompt textarea
- [ ] Wire sources through to pipeline action via `formatSourcesForPrompt`
- [ ] Add `data-testid="sidebar-source-list"`
- [ ] Manual test: sources appear in AI prompt

### Phase 2: Output Mode Toggle
- [ ] Create `OutputModeToggle` component with data-testid attributes
- [ ] Add to sidebar below sources
- [ ] Lift outputMode state to `results/page.tsx`
- [ ] Create `executeAIEdit` wrapper callback
- [ ] Route toggle selection to correct pipeline
- [ ] Unit tests for OutputModeToggle (5 tests)
- [ ] Manual test: both modes work from sidebar

### Phase 3: Advanced AI Editor Modal
- [ ] Create `TagSelector.tsx` extracting from TagBar
- [ ] Create `AdvancedAIEditorModal.tsx` with data-testid attributes
- [ ] Add modal state to `results/page.tsx`
- [ ] Add "Expand" button to sidebar with `data-testid="modal-expand-button"`
- [ ] Implement dirty state tracking using `isDirty` memo
- [ ] Implement warning dialog on dirty cancel
- [ ] Unit tests for modal state management (12 tests)
- [ ] Manual test: modal opens/closes with state preservation

### Phase 4: Wire Pipelines in Modal
- [ ] Add output mode toggle to modal
- [ ] Wire Apply button to `onApply` callback
- [ ] Implement streaming timing (close on rewrite start)
- [ ] Handle loading states for both pipelines
- [ ] Integration tests for modal apply (4 tests)
- [ ] Manual test: both pipelines work from modal

### Phase 5: Deprecate FeedbackPanel & Special Tag Modes
- [ ] Remove FeedbackPanel import and component from results page
- [ ] Remove `showFeedbackPanel` state and related handlers (6 items)
- [ ] Replace dropdown items with "Advanced AI editor..."
- [ ] Wire new dropdown item to open modal
- [ ] Simplify tagModeReducer (remove 2 mode types, 2 actions)
- [ ] Remove TagBar's special mode handlers (4 functions)
- [ ] Remove TagBar's `tagBarApplyClickHandler` prop
- [ ] Remove `modeOverride` variable from TagBar
- [ ] Keep TagBar's Normal mode fully functional
- [ ] Delete `FeedbackPanel.tsx`
- [ ] Remove ~150 lines from `tagModeReducer.test.ts`
- [ ] Remove ~100 lines from `TagBar.test.tsx`
- [ ] Run full test suite - all tests pass
- [ ] Manual test: TagBar Normal mode still works
- [ ] Manual test: "Advanced AI editor..." opens modal correctly
- [ ] Manual test: AI editing flows work through sidebar/modal only

### Final Verification
- [ ] Run `npm run build` - no errors
- [ ] Run `npm run tsc` - no type errors
- [ ] Run `npm run lint` - no lint errors
- [ ] Run `npm test` - all unit tests pass
- [ ] Run `npm run test:integration` - all integration tests pass
- [ ] Run `npm run test:e2e` - all E2E tests pass
- [ ] Update documentation if needed

---

## Documentation Updates

The following documentation files should be reviewed and updated after implementation:

| File | Updates Needed |
|------|----------------|
| `docs/docs_overall/architecture.md` | Update component diagram to show AIEditorPanel instead of AISuggestionsPanel; remove FeedbackPanel reference |
| `docs/docs_overall/product_overview.md` | Update AI editing workflow description; mention unified sidebar + modal approach |
| `docs/feature_deep_dives/ai_suggestions.md` | Major update - document sources support, output mode toggle, modal for advanced settings |
| `docs/feature_deep_dives/tags.md` | Update to reflect TagBar simplified to Normal mode only; document tags in modal |

### New Documentation (if needed)
- Consider adding `docs/feature_deep_dives/ai_editor_panel.md` if the feature becomes complex enough to warrant dedicated documentation
