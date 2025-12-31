# Implementation Plan: Unified AI Editing Panel (Hybrid Approach)

## Status: READY TO IMPLEMENT

**Last Reviewed**: 2024-12-31
**Review Notes**: Codebase exploration completed. Critical gaps identified and resolved via design decisions below.

---

## Goals

1. **Consolidate UI** - Single entry point for AI editing (sidebar + modal)
2. **Add sources everywhere** - SourceList available in both sidebar and modal
3. **User controls output** - Toggle between inline diff and full replace
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
| **Full Replace behavior** | Creates NEW explanation (uses existing `handleUserAction` with `UserInputType.Rewrite`) | Reuses existing generation pipeline. Simpler than building in-place replacement. Note: explanation_id will change. |
| **Preview pane content** | Shows current editor state | May include CriticMarkup if user has pending diffs - this is acceptable for context. |
| **Source wiring approach** | Phase 0 foundation first | Wire sources to AI pipeline BEFORE adding UI. Clean backend-first approach. |

### Key Codebase Findings

1. **AI Suggestions Pipeline** (`runAISuggestionsPipelineAction` in `actions.ts:331-396`)
   - Current signature: `(currentContent, userPrompt, sessionData)`
   - `sessionData` does NOT include sources - needs extension
   - Returns CriticMarkup diffs, not streaming

2. **Generation Pipeline** (`handleUserAction` in `page.tsx:267-501`)
   - Uses `UserInputType.Rewrite` for full regeneration
   - Streams response, creates NEW explanation
   - Already accepts `sourceUrls` parameter

3. **Source Pipeline Gap**
   - `createAISuggestionPrompt` (`aiSuggestion.ts:55-104`) only takes `currentText` and `userPrompt`
   - Sources need to be fetched and injected into prompt
   - Database already has `source_content` field (ready for storage)

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
│  │                             │  │ AI Sidebar (340px)   │ │
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
│  FULLSCREEN MODAL                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  AI Editor                                      [✕]   │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  ┌──────────────────┐  ┌────────────────────────────┐ │  │
│  │  │ CONTROLS (400px) │  │ PREVIEW (flex-1)           │ │  │
│  │  │                  │  │                            │ │  │
│  │  │ [Quick Actions]  │  │ ┌────────────────────────┐ │ │  │
│  │  │                  │  │ │ Read-only preview of   │ │ │  │
│  │  │ [Prompt]         │  │ │ current content        │ │ │  │
│  │  │ ________________ │  │ │                        │ │ │  │
│  │  │                  │  │ │ (Scrollable)           │ │ │  │
│  │  │ [Tags]           │  │ │                        │ │ │  │
│  │  │ [chip][chip][+]  │  │ └────────────────────────┘ │ │  │
│  │  │                  │  │                            │ │  │
│  │  │ [Sources]        │  │                            │ │  │
│  │  │ [url][+ Add]     │  │                            │ │  │
│  │  │                  │  │                            │ │  │
│  │  │ [Output Mode]    │  │                            │ │  │
│  │  │ ○ Inline diff    │  │                            │ │  │
│  │  │ ● Full replace   │  │                            │ │  │
│  │  │                  │  │                            │ │  │
│  │  │ [Apply Changes]  │  │                            │ │  │
│  │  └──────────────────┘  └────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Read-only preview** (not editable) | Simpler than embedding full Lexical editor in modal. User edits via prompts, not direct manipulation. |
| **No intermediate 600px state** | Adds complexity without clear value. Binary: sidebar OR modal. |
| **Sidebar owns state** | Single source of truth. Modal reads on open, writes back on Apply. |
| **Tags in modal only** | Tags are a "power feature". Sidebar stays simple (prompt + sources). |

### State Flow

```
AISuggestionsPanelState (persists in sidebar)
├── prompt: string
├── sources: SourceChipType[]
├── outputMode: 'inline-diff' | 'full-replace'
├── history: SuggestionHistoryItem[]
├── isLoading: boolean
└── lastResult: PipelineResult | null

Modal (transient):
├── isOpen: boolean
├── tags: TagUIType[] (loaded from explanation on open)
├── localPrompt: string (copied from sidebar, can diverge)
├── localSources: SourceChipType[] (copied from sidebar)
├── localOutputMode: 'inline-diff' | 'full-replace'
└── isDirty: boolean (tracks if user made changes)

On Modal Apply:
  → Write localPrompt, localSources, localOutputMode back to sidebar state
  → Execute pipeline
  → Close modal
  → Show result in editor

On Modal Cancel:
  → If isDirty: show warning dialog
  → Discard local state
  → Close modal
```

---

## Implementation Phases

### Phase 0: Foundation - Wire Sources to AI Pipeline (NEW)

**Goal**: Enable source URLs in AI suggestions pipeline before adding UI.

**Why This Phase**: The original plan assumed sources could be "passed to" the pipeline, but the pipeline doesn't accept them. This foundation work is required first.

**Changes**:
1. Extend `sessionData` type to include `sources: SourceChipType[]`
2. Modify `createAISuggestionPrompt` to include fetched source content in prompt
3. Add source content fetching utility (or accept pre-fetched content)

**Files**:
- `src/editorFiles/actions/actions.ts:331-396` - Add sources to signature
- `src/editorFiles/aiSuggestion.ts:55-104` - Include sources in prompt construction
- `src/types/schemas.ts` - Extend SessionData type if needed

**Verification**:
- Unit test: prompt includes source content when provided
- Integration test: pipeline accepts sources parameter without breaking existing calls

---

### Phase 1: Add Sources to Sidebar (Low Risk, High Value)

**Goal**: Enable source URLs in existing AI suggestions pipeline.

**Changes**:
1. Add `sources` state to `AISuggestionsPanel`
2. Embed compact `SourceList` component below prompt
3. Pass sources to `runAISuggestionsPipelineAction`
4. Update action to accept and use sources in AI prompt

**Files**:
- `src/components/AISuggestionsPanel.tsx` - Add sources UI and state
- `src/editorFiles/actions/actions.ts` - Accept sources parameter
- `src/editorFiles/aiSuggestion.ts` - Include sources in prompts

**Verification**:
- Add source URL in sidebar
- Run AI suggestions
- Verify source content appears in AI prompt (check logs)

---

### Phase 2: Add Output Mode Toggle (Medium Risk)

**Goal**: Let user choose between inline diff and full replace.

**Changes**:
1. Create `OutputModeToggle` component (radio group)
2. Add to sidebar (below sources)
3. Route to different backends based on selection:
   - `inline-diff` → existing `runAISuggestionsPipelineAction`
   - `full-replace` → existing `handleUserAction` with `UserInputType.Rewrite`

**Files**:
- `src/components/OutputModeToggle.tsx` - New component
- `src/components/AISuggestionsPanel.tsx` - Add toggle, routing logic
- Need to pass `handleUserAction` callback from results page to sidebar

**Key Implementation Detail**:
Full replace uses the EXISTING generation pipeline (`handleUserAction`), NOT a new action. This means:
- Creates a NEW explanation (explanation_id changes)
- Uses streaming response pattern
- User should be warned that this generates fresh content

**UX Consideration**: Consider labeling as "Generate New" instead of "Full Replace" to set correct expectations.

**Verification**:
- Toggle to "Inline diff" → see CriticMarkup diffs
- Toggle to "Full replace" → new explanation generates with streaming

---

### Phase 3: Create Fullscreen Modal (Medium Risk)

**Goal**: Rich editing experience with tags and preview.

**Changes**:
1. Create `AIEditorModal.tsx` with two-column layout
2. Extract tag selector from `TagBar.tsx` → `TagSelector.tsx`
3. Add "Expand" button to sidebar that opens modal
4. Modal inherits state from sidebar, has own local state
5. Apply button writes back to sidebar and executes

**Files**:
- `src/components/AIEditorModal.tsx` - New modal component
- `src/components/TagSelector.tsx` - Extracted from TagBar
- `src/components/AISuggestionsPanel.tsx` - Add expand button, modal state

**State Flow** (Clarified):
```
Modal opens:
  → Copy sidebar state (prompt, sources, outputMode)
  → Pass currentContent from editor ref for preview pane
  → Inherit tagState from results page parent

Modal Apply:
  → Write local state back to sidebar
  → Execute appropriate pipeline (inline diff OR full replace)
  → Close modal

Modal Cancel:
  → If isDirty: show warning dialog
  → Discard local state
  → Close modal (sidebar state unchanged)
```

**Preview Pane Content**:
- Shows current editor state (passed via prop)
- Read-only rendered markdown view
- May show CriticMarkup if user has pending diffs (acceptable for context)

**Technical Risk**:
- Tag loading depends on `explanationId` - pass via props from results page
- Preview pane needs current content - pass via props from editor ref

**Verification**:
- Click "Expand" → modal opens with sidebar state
- Modify prompt in modal → Apply → sidebar state updated
- Cancel with changes → warning shown

---

### Phase 4: Wire Both Pipelines in Modal (Medium Risk)

**Goal**: Modal can execute both inline diff and full replace.

**Changes**:
1. Add output mode toggle to modal
2. Route Apply to correct backend:
   - Inline diff: call `runAISuggestionsPipelineAction`, close modal, show diffs in editor
   - Full replace: call `handleUserAction`, navigate to new explanation (or show loading in modal)
3. Handle streaming response for full replace (loading state)

**Files**:
- `src/components/AIEditorModal.tsx` - Add toggle, dual routing
- `src/app/results/page.tsx` - Lift `handleUserAction` or pass as callback to modal

**UX Decision Needed**: When "Full Replace" runs from modal:
- Option A: Close modal immediately, show streaming on main page
- Option B: Keep modal open with loading state, close when complete
- **Recommendation**: Option A (simpler, consistent with sidebar behavior)

**Verification**:
- Modal with "Inline diff" → diffs appear in editor, stay on same page
- Modal with "Full replace" → new explanation loads (new explanation_id)

---

### Phase 5: Deprecate FeedbackPanel (Low Risk, High Value)

**Goal**: Remove parallel UI system, simplify codebase.

**Changes**:
1. Remove `FeedbackPanel` from results page
2. Remove "Edit with tags" / "Rewrite with tags" dropdown items
3. Simplify `tagModeReducer` (remove RewriteWithTags, EditWithTags modes)
4. Keep TagBar in normal mode only (for tag display)

**Files**:
- `src/app/results/page.tsx` - Remove FeedbackPanel, dropdown items
- `src/reducers/tagModeReducer.ts` - Simplify to normal mode only
- `src/components/FeedbackPanel.tsx` - Delete entirely
- `src/components/TagBar.tsx` - Remove special mode handling

**Migration**:
- Users who used "Edit with tags" → now use modal with tags
- Users who used "Rewrite with tags" → now use modal with tags + full replace

**Verification**:
- No regression in tag display
- All editing flows work through sidebar/modal
- Codebase is simpler (fewer modes, fewer components)

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
| Full replace streaming differs from inline diff | Medium | Use existing `handleUserAction` - no new streaming code needed | ✅ Resolved |
| Tag loading requires explanation context | Low | Pass explanationId through props from results page | ✅ Resolved |
| Modal state sync with sidebar | Medium | Clear ownership: sidebar owns, modal copies on open | ✅ Resolved |
| SourceList behavior in compact mode | Low | Already used in FeedbackPanel, proven | ✅ Resolved |
| Sources not accepted by AI pipeline | High | **Phase 0 added** - wire sources before UI work | ✅ Addressed |
| `createAISuggestionPrompt` doesn't include sources | High | Modify in Phase 0 to inject source content | ✅ Addressed |

### Resolved Architecture Questions

1. **Q: How does Full Replace work without new pipeline?**
   A: Reuses `handleUserAction` with `UserInputType.Rewrite`. Creates new explanation (acceptable).

2. **Q: What does preview pane show?**
   A: Current editor state via prop. May include CriticMarkup - acceptable for context.

3. **Q: When should sources be wired?**
   A: Phase 0 (foundation) before any UI work. Backend capability first.

---

## File Changes Summary

### New Files
| File | Purpose | Phase |
|------|---------|-------|
| `src/components/AIEditorModal.tsx` | Fullscreen modal with controls + preview | 3 |
| `src/components/OutputModeToggle.tsx` | Radio toggle for diff vs replace | 2 |
| `src/components/TagSelector.tsx` | Extracted tag selection UI | 3 |

### Modified Files
| File | Changes | Phase |
|------|---------|-------|
| `src/editorFiles/actions/actions.ts:331-396` | Add sources to sessionData, extend signature | 0 |
| `src/editorFiles/aiSuggestion.ts:55-104` | Include sources in prompt construction | 0 |
| `src/components/AISuggestionsPanel.tsx:209-366` | Add sources state/UI, output mode, expand button | 1-2 |
| `src/app/results/page.tsx:267-501, 1393-1427` | Pass handleUserAction to sidebar, add modal, remove FeedbackPanel | 2-5 |
| `src/reducers/tagModeReducer.ts` | Simplify to normal mode only | 5 |
| `src/components/TagBar.tsx` | Remove special mode handling | 5 |

### Deleted Files
| File | Reason | Phase |
|------|--------|-------|
| `src/components/FeedbackPanel.tsx` | Replaced by modal | 5 |

### Key Code Locations Reference
| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| AI Pipeline Action | `actions.ts` | 331-396 | `runAISuggestionsPipelineAction` signature |
| Prompt Construction | `aiSuggestion.ts` | 55-104 | `createAISuggestionPrompt` |
| Generation Handler | `page.tsx` | 267-501 | `handleUserAction` for full replace |
| Panel State | `AISuggestionsPanel.tsx` | 209-235 | Current state variables |
| Panel Submit | `AISuggestionsPanel.tsx` | 241-366 | Submit handler logic |
| Sidebar Rendering | `page.tsx` | 1393-1427 | AISuggestionsPanel props |
| Tag/Feedback Toggle | `page.tsx` | 1285-1314 | Conditional rendering |

---

## Testing Strategy

### Unit Tests
- `OutputModeToggle` renders correctly, fires onChange
- `TagSelector` loads and displays tags
- `AIEditorModal` state management (dirty tracking, Apply/Cancel)

### Integration Tests
- Sidebar with sources → AI pipeline receives sources
- Output mode toggle → correct backend called
- Modal Apply → sidebar state updated

### E2E Tests
- Full flow: sidebar → expand → modal → Apply → diffs in editor
- Full flow: modal with full replace → content replaced
- Cancel with dirty state → warning shown

---

## Success Metrics

1. **Codebase reduction**: FeedbackPanel deleted, tagModeReducer simplified
2. **Feature parity**: All current editing flows work through new UI
3. **User clarity**: Single entry point (sidebar) with clear escalation (modal)
4. **No regressions**: Existing AI suggestions continue to work

---

## Implementation Checklist

### Phase 0: Foundation
- [ ] Extend `sessionData` type to include `sources`
- [ ] Modify `createAISuggestionPrompt` to include source content
- [ ] Add unit tests for source injection in prompts
- [ ] Verify existing calls still work (backward compatible)

### Phase 1: Sources in Sidebar
- [ ] Add `sources` state to `AISuggestionsPanel`
- [ ] Embed `SourceList` component below prompt textarea
- [ ] Pass sources through to pipeline action
- [ ] Manual test: sources appear in AI prompt

### Phase 2: Output Mode Toggle
- [ ] Create `OutputModeToggle` component
- [ ] Add to sidebar below sources
- [ ] Pass `handleUserAction` callback from results page
- [ ] Route toggle selection to correct pipeline
- [ ] Manual test: both modes work from sidebar

### Phase 3: Fullscreen Modal
- [ ] Create `AIEditorModal.tsx` with two-column layout
- [ ] Extract `TagSelector.tsx` from TagBar
- [ ] Add "Expand" button to sidebar
- [ ] Implement dirty state tracking
- [ ] Manual test: modal opens/closes with state preservation

### Phase 4: Wire Pipelines in Modal
- [ ] Add output mode toggle to modal
- [ ] Wire Apply button to correct pipeline
- [ ] Handle loading states for both pipelines
- [ ] Manual test: both pipelines work from modal

### Phase 5: Deprecate FeedbackPanel
- [ ] Remove FeedbackPanel from results page
- [ ] Remove dropdown menu items for tag modes
- [ ] Simplify tagModeReducer
- [ ] Clean up TagBar special mode handling
- [ ] Delete FeedbackPanel.tsx
- [ ] Manual test: no regressions in tag display
