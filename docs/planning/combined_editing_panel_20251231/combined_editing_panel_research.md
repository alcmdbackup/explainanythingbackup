# Research: Consolidate AI Editing UI Components

## Problem Statement
Two parallel UI systems exist for AI-powered content editing:
1. **AISuggestionsPanel** (sidebar) - Free-form prompts + quick actions → CriticMarkup diffs
2. **FeedbackPanel/TagBar** (inline) - Tag-based editing + sources → Full regeneration

This creates a fragmented UX. Goal is to combine them with sources support.

---

## Current Architecture

### UI System 1: AISuggestionsPanel
- **File**: `src/components/AISuggestionsPanel.tsx`
- **Location**: Right sidebar, collapsible (340px width)
- **Input**: Free-form text prompt
- **Actions**: Quick action buttons (Simplify, Expand, Fix Grammar, Make Formal)
- **Output**: CriticMarkup diffs applied to Lexical editor
- **Backend**: `runAISuggestionsPipelineAction`
- **Features**: History tracking, validation results display, progress indicators

### UI System 2: FeedbackPanel + TagBar
- **Files**: `src/components/FeedbackPanel.tsx`, `src/components/TagBar.tsx`, `src/reducers/tagModeReducer.ts`
- **Location**: Inline above content area
- **Input**: Tag selection + Source URLs
- **Actions**: Apply tags for rewrite/edit
- **Output**: Full explanation regeneration via streaming API
- **Backend**: `handleUserAction` with `UserInputType.EditWithTags` or `RewriteWithTags`
- **Features**: Tag state machine (3 modes), source URL validation/fetching

### Key Architectural Differences
| Aspect | AISuggestionsPanel | FeedbackPanel/TagBar |
|--------|-------------------|---------------------|
| Edit Type | Inline diff (CriticMarkup) | Full regeneration |
| Input | Free text prompt | Structured tags + sources |
| Output | Preserves original with tracked changes | Replaces content entirely |
| Undo | Accept/reject individual changes | None (page reload to get old) |

---

## Brainstormed Approaches

### 1. Unified Command Bar (Slack/Linear style)
- Cmd+K triggered palette above content
- Combines prompt + tags + sources in one interface
- **Pros**: Familiar pattern, no sidebar space
- **Cons**: Loses history visibility, complex routing
- **Complexity**: Medium

### 2. Smart Sidebar with Tabs
- Enhance AISuggestionsPanel with tabs: Prompt | Tags | Sources
- Sources shared across all operations
- **Pros**: Minimal disruption, history preserved, progressive disclosure
- **Cons**: Still takes sidebar space
- **Complexity**: Low-Medium

### 3. Contextual Floating Panel
- Appears on text selection near cursor
- All options in compact floating UI
- **Pros**: Maximum content space, context-aware
- **Cons**: Low discoverability, no history, complex positioning
- **Complexity**: High

### 4. Editor Toolbar Dropdown
- AI button in Lexical toolbar with expanded dropdown
- **Pros**: Integrates with editor, scalable
- **Cons**: Crowded toolbar, deep hierarchy
- **Complexity**: Medium-High

### 5. Expandable Sidebar with Takeover Mode (Recommended)
Inspired by how TagBar expands in-place for "edit with tags":
- **Collapsed**: Icon-only rail on right edge
- **Expanded**: Current 340px sidebar with all features
- **Takeover**: Expands to overlay/replace content area (like TagBar's expanded state)

```
[Collapsed]     [Expanded Sidebar]     [Takeover Mode]
   |✨|         |  Edit Article    |    |═══════════════════════════|
   |📝|    →    |  [Prompt][Tags]  | →  |     AI Edit - Full Mode   |
   |🏷️|         |  Quick actions   |    |  ┌─────────────────────┐  |
                |  [Get Suggestions]|    |  | Large prompt area   |  |
                                        |  └─────────────────────┘  |
                                        |  Tags: [chip][chip]       |
                                        |  Sources: [url][+ Add]    |
                                        |  [Apply]  [Cancel]        |
                                        |═══════════════════════════|
```

- **Pros**: Progressive complexity, matches existing TagBar pattern, maximum flexibility
- **Cons**: Three states to manage, animation complexity
- **Complexity**: Medium

---

## Recommendation
**Approach 5: Expandable Sidebar with Takeover Mode** - matches existing UX patterns in codebase

---

## Implementation Steps (for Approach 5)

### Phase 1: Add Panel State Machine
1. Create `panelModeReducer.ts` with 3 states: `collapsed` | `expanded` | `takeover`
2. Add state management to `AISuggestionsPanel`

### Phase 2: Collapsed State (Icon Rail)
1. Add minimized view with icon buttons (AI, Tags, Sources)
2. Click any icon → expand to full sidebar

### Phase 3: Enhanced Sidebar (Expanded State)
1. Add tabs/sections: Prompt | Tags | Sources
2. Extract tag selector from `TagBar.tsx` into reusable component
3. Embed `SourceList` component for URL inputs
4. Add "Expand to full" button → takeover mode

### Phase 4: Takeover Mode
1. Panel expands to overlay content area (like TagBar's expanded state)
2. Larger prompt area, full tag management, source list visible at once
3. Preview pane showing content being edited
4. "Minimize" button → return to sidebar

### Phase 5: Wire Backends
1. Pass sources to `runAISuggestionsPipelineAction`
2. Pass sources to tag-based `handleUserAction`
3. Unified Apply button routes to correct pipeline based on input type

### Phase 6: Deprecate FeedbackPanel
1. Remove FeedbackPanel from results page
2. Route all AI editing through unified panel

---

## Critical Files
- `src/components/AISuggestionsPanel.tsx` - Core refactor (3 view modes)
- `src/components/FeedbackPanel.tsx` - Deprecate, extract patterns
- `src/components/TagBar.tsx` - Extract tag selector widget
- `src/reducers/tagModeReducer.ts` - May merge with new panel reducer
- `src/app/results/page.tsx` - Integration point
- `src/components/sources/SourceList.tsx` - Embed in unified panel
- NEW: `src/reducers/aiPanelModeReducer.ts` - Panel state machine

---

## Revised Recommendation: Fullscreen Modal + Sidebar Integration

After critical review, the "Expandable Sidebar with Takeover Mode" (Approach 5) may be over-engineered. A cleaner alternative:

### Why Modal Instead of Takeover Mode

**Takeover mode problems:**
- 3 states to manage (collapsed/expanded/takeover)
- Animation complexity
- State persistence issues (what if user refreshes mid-takeover?)
- Essentially reinvents what a modal does

**Modal approach benefits:**
- Binary state (open/closed)
- Standard pattern users understand
- No animation complexity
- Clean separation - modal has its own state
- Can use existing dialog/modal primitives

---

### Architecture: Sidebar + Modal

```
┌─────────────────────────────────────────────────────────────┐
│  Results Page                                               │
│  ┌─────────────────────────────────┐  ┌──────────────────┐ │
│  │                                 │  │ AI Sidebar       │ │
│  │  Content Area                   │  │ (Quick edits)    │ │
│  │                                 │  │                  │ │
│  │  [🎨 Full AI Editor] button     │  │ • Quick actions  │ │
│  │                                 │  │ • Simple prompt  │ │
│  └─────────────────────────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         ↓ Click "Full AI Editor"
┌─────────────────────────────────────────────────────────────┐
│  ██████████████ FULLSCREEN MODAL ██████████████████████████ │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  AI Editor - Full Mode                          [✕]   │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │                                                       │ │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐│ │
│  │  │ PROMPT          │  │ PREVIEW                     ││ │
│  │  │ _______________│  │ (Content being edited)      ││ │
│  │  │                 │  │                             ││ │
│  │  │ TAGS            │  │                             ││ │
│  │  │ [chip][chip][+] │  │                             ││ │
│  │  │                 │  │                             ││ │
│  │  │ SOURCES         │  │                             ││ │
│  │  │ [url][+ Add]    │  │                             ││ │
│  │  │                 │  │                             ││ │
│  │  │ OUTPUT MODE     │  │                             ││ │
│  │  │ ○ Inline diff   │  │                             ││ │
│  │  │ ● Full replace  │  │                             ││ │
│  │  │                 │  │                             ││ │
│  │  │ [Apply Changes] │  │                             ││ │
│  │  └─────────────────┘  └─────────────────────────────┘│ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

### User Flows

#### Flow 1: Quick Edit (Sidebar)
```
User is on Results page viewing their explanation
    ↓
Sidebar is visible on right (current AISuggestionsPanel)
    ↓
User types "Make this more concise" in prompt
    ↓
Optionally adds a source URL (NEW capability)
    ↓
Clicks "Get Suggestions"
    ↓
Content updates with CriticMarkup diffs (accept/reject inline)
```
**Same as today, but with optional sources**

#### Flow 2: Full Power Edit (Modal)
```
User wants more control (tags, multiple sources, choose output mode)
    ↓
Clicks "Full AI Editor" button (in toolbar or sidebar)
    ↓
Modal opens with two-column layout:
  - Left: Prompt, Tags, Sources, Output Mode toggle
  - Right: Preview of content being edited
    ↓
User fills in prompt, selects tags, adds sources
    ↓
Chooses output mode:
  • "Inline diff" → Uses CriticMarkup pipeline (granular accept/reject)
  • "Full replace" → Uses tag-based regeneration (streaming full rewrite)
    ↓
Clicks "Apply Changes"
    ↓
Modal closes, content is updated (diffs shown OR replaced)
```

---

### Key Differences from Current System

| Today | New Approach |
|-------|--------------|
| Sidebar = free-form prompts only | Sidebar = prompts + optional sources |
| TagBar/FeedbackPanel = tags + sources inline | Modal = tags + sources + prompts + output mode |
| Two separate entry points | Single "Full AI Editor" for power use |
| User must know which system to use | Clear: sidebar = quick, modal = full control |
| Output is determined by which system you use | User explicitly chooses output mode |

---

### What Gets Simplified/Removed

1. **FeedbackPanel.tsx** - Entirely deprecated (modal replaces it)
2. **TagBar mode states** - No more `RewriteWithTags` / `EditWithTags` modes needed
3. **Dropdown menu complexity** - No more "Rewrite with tags" / "Edit with tags" menu items
4. **tagModeReducer.ts** - Can be simplified significantly (only normal mode needed for tag display)

---

### Implementation Steps (Modal Approach)

#### Phase 1: Create Unified AI Editor Modal
1. Create `src/components/AIEditorModal.tsx`
2. Two-column layout: Controls (left) + Preview (right)
3. Include: Prompt, Tags, Sources, Output Mode toggle

#### Phase 2: Extract Reusable Components
1. Extract tag selector from `TagBar.tsx` → `TagSelector.tsx`
2. Ensure `SourceList.tsx` works standalone
3. Create `OutputModeToggle.tsx` (inline diff vs full replace)

#### Phase 3: Add Sources to Sidebar
1. Add compact SourceList to `AISuggestionsPanel.tsx`
2. Wire sources to `runAISuggestionsPipelineAction`

#### Phase 4: Wire Both Pipelines to Modal
1. Output mode toggle determines which backend to call:
   - Inline diff → `runAISuggestionsPipelineAction` (CriticMarkup)
   - Full replace → `handleUserAction` with `UserInputType.EditWithTags`
2. Pass tags + sources to both pipelines

#### Phase 5: Add Modal Trigger
1. Add "Full AI Editor" button in results page
2. Optionally add to sidebar as "Expand" action

#### Phase 6: Deprecate FeedbackPanel
1. Remove `FeedbackPanel.tsx` from results page
2. Remove "Edit with tags" / "Rewrite with tags" dropdown items
3. All editing flows through sidebar or modal

---

### Critical Files (Modal Approach)

**New:**
- `src/components/AIEditorModal.tsx` - Main modal component
- `src/components/TagSelector.tsx` - Extracted from TagBar
- `src/components/OutputModeToggle.tsx` - Diff vs Replace toggle

**Modified:**
- `src/components/AISuggestionsPanel.tsx` - Add sources, add "expand to modal" button
- `src/app/results/page.tsx` - Add modal, remove FeedbackPanel
- `src/editorFiles/actions/actions.ts` - Accept sources in AI pipeline

**Deprecated:**
- `src/components/FeedbackPanel.tsx` - Remove after migration
- `src/reducers/tagModeReducer.ts` - Simplify or remove (modal has own state)

---

### Open Questions
1. Should sidebar auto-close when modal opens?
2. Should modal have history like sidebar does?
3. Should "Quick actions" in sidebar also support sources?

---

## Final Recommendation: Hybrid Approach (Resizable Sidebar + Fullscreen Modal)

After further discussion, a hybrid approach emerged as the optimal solution. The key insight: **modal vs takeover mode is primarily a presentation difference, not a functional one.** A resizable sidebar provides the most cohesive UX.

### Why Hybrid?

| Approach | Problem |
|----------|---------|
| Pure Modal | Feels like interruption, separate context |
| Takeover Mode | 3 states to manage, complex animations |
| Pure Resizable | Full-screen editing in sidebar feels cramped |
| **Hybrid** | Best of both: continuous resize + focused modal |

### Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  RESIZABLE SIDEBAR (drag to resize, up to 600px)                       │
│                                                                        │
│  [Icon Rail]  ←→  [340px]  ←→  [600px Expanded]                       │
│     |✨|           | Edit Article |    | Edit Article      |           │
│     |📝|    drag   | [Prompt]     |drag| [Prompt]          |           │
│     |🏷️|    ───→   | [Tags]       |───→| [Tags] [Sources]  |           │
│                    | Quick actions|    | [Output mode]     |           │
│                                        | [Expand ⤢] button |           │
└────────────────────────────────────────────────────────────────────────┘
                                                     ↓ Click "Expand"
┌────────────────────────────────────────────────────────────────────────┐
│  FULLSCREEN MODAL                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  AI Editor - Full Mode                              [Minimize ⤡] │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  ┌─────────────────────┐  ┌───────────────────────────────────┐  │  │
│  │  │ CONTROLS            │  │ EDITABLE PREVIEW                 │  │  │
│  │  │ [Prompt]            │  │ (Live content)                    │  │  │
│  │  │ [Tags]              │  │                                   │  │  │
│  │  │ [Sources]           │  │                                   │  │  │
│  │  │ [Output mode]       │  │                                   │  │  │
│  │  │ [Apply Changes]     │  │                                   │  │  │
│  │  └─────────────────────┘  └───────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Behaviors

| Aspect | Sidebar | Modal |
|--------|---------|-------|
| Entry | Always visible | Click "Expand" from expanded sidebar |
| Resize | Drag left edge (icon rail → 340px → 600px) | Fixed fullscreen |
| State | Persistent (prompt, tags, sources, history) | Inherits from sidebar |
| Preview | Not visible | Editable preview pane |
| Exit | Resize smaller | Warn if unsaved → close (no return to sidebar) |
| Inline diff output | Apply → show in editor | Close modal → show in editor |

### State Management

```
Shared State (sidebar owns, persists across resizes)
├── prompt: string
├── tags: TagUIType[]
├── sources: SourceChipType[]
├── history: SuggestionHistoryItem[]
└── outputMode: 'inline-diff' | 'full-replace'

Modal:
├── Reads shared state on open
├── Writes back on Apply
└── Discards on Cancel (with warning if dirty)
```

### Design Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Preview editable? | Yes - user can edit while seeing controls |
| Modal→Sidebar allowed? | No - warn if unsaved, then exit entirely |
| Shared state? | Yes - sidebar owns state, modal inherits |
| Build incrementally? | Yes - 6 phases |
| Inline diff output? | Close modal, show diffs in editor |

---

### Implementation Phases (Hybrid)

#### Phase 1: Add Sources to Sidebar
1. Add compact SourceList to `AISuggestionsPanel.tsx`
2. Wire sources to `runAISuggestionsPipelineAction`
3. Test that sources work with existing AI pipeline

#### Phase 2: Make Sidebar Resizable
1. Add drag handle on left edge
2. Define snap points: icon rail (~48px), 340px, 600px
3. Progressive disclosure: more controls visible as width increases
4. Add "Expand" button visible at 600px width

#### Phase 3: Add Output Mode Toggle
1. Create toggle: "Inline diff" vs "Full replace"
2. Route to correct backend based on selection
3. Visible in expanded sidebar (600px) and modal

#### Phase 4: Create Fullscreen Modal
1. Create `AIEditorModal.tsx`
2. Two-column: controls (left) + editable preview (right)
3. Inherits state from sidebar on open
4. "Apply" writes back and closes
5. "Cancel" warns if dirty, then closes

#### Phase 5: Wire Both Pipelines
1. Inline diff → `runAISuggestionsPipelineAction` (CriticMarkup)
2. Full replace → `handleUserAction` with tags/sources
3. Ensure sources pass through to both backends

#### Phase 6: Deprecate FeedbackPanel
1. Remove FeedbackPanel from results page
2. Remove "Edit with tags" / "Rewrite with tags" dropdown
3. Simplify tagModeReducer (only normal mode needed)

---

### Critical Files (Hybrid Approach)

**New:**
- `src/components/AIEditorModal.tsx` - Fullscreen modal with editable preview
- `src/components/OutputModeToggle.tsx` - Diff vs Replace toggle
- `src/components/TagSelector.tsx` - Extracted from TagBar

**Modified:**
- `src/components/AISuggestionsPanel.tsx` - Add sources, make resizable, add expand button
- `src/app/results/page.tsx` - Add modal, remove FeedbackPanel
- `src/editorFiles/actions/actions.ts` - Accept sources in AI pipeline

**Deprecated:**
- `src/components/FeedbackPanel.tsx` - Remove after migration
- `src/reducers/tagModeReducer.ts` - Simplify (remove RewriteWithTags/EditWithTags modes)
