[1 tool called]

Looking at the 28 state variables, here are the **obvious reducer candidates** based on interdependencies and state machine patterns:

## 🔴 **Critical Reducer 1: Tag Mode State Machine** (6 variables → 1 reducer)

```typescript
// Currently scattered across 6 state variables:
const [tags, setTags] = useState<TagUIType[]>([]);
const [originalTags, setOriginalTags] = useState<TagUIType[]>([]);
const [tempTagsForRewriteWithTags, setTempTagsForRewriteWithTags] = useState<TagUIType[]>([]);
const [showRegenerateDropdown, setShowRegenerateDropdown] = useState(false);
const [modeOverride, setModeOverride] = useState<TagBarMode>(TagBarMode.Normal);
const [isTagsModified, setIsTagsModified] = useState(false);
```

**Why it's a perfect reducer candidate:**
- ✅ Clear state machine: `Normal` → `RewriteWithTags` → `EditWithTags` → back to `Normal`
- ✅ Impossible states currently possible: `modeOverride=Normal` but `tempTagsForRewriteWithTags` has data
- ✅ Complex transitions: Closing dropdown should reset tags, entering modes should load different tag sets
- ✅ 6 interdependent variables that must stay in sync

**Proposed reducer:**
```typescript
type TagState = 
  | { mode: 'normal'; tags: TagUIType[]; dropdownOpen: boolean }
  | { mode: 'rewriteWithTags'; tags: TagUIType[]; tempTags: TagUIType[]; dropdownOpen: false }
  | { mode: 'editWithTags'; tags: TagUIType[]; originalTags: TagUIType[]; dropdownOpen: false };

type TagAction =
  | { type: 'LOAD_TAGS'; tags: TagUIType[] }
  | { type: 'ENTER_REWRITE_MODE'; tempTags: TagUIType[] }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_SPECIAL_MODE' }
  | { type: 'TOGGLE_DROPDOWN' }
  | { type: 'UPDATE_TAGS'; tags: TagUIType[] };
```

**Lines affected:** 40-45, 60-84, 135-147, 256-268, 589-606, 1100-1139

---

## 🔴 **Critical Reducer 2: Page Lifecycle State Machine (COMBINED)** (12 variables → 1 reducer)

**Key insight:** Loading/generation and edit/publishing states are **mutually exclusive** - you cannot be loading AND editing simultaneously. These should be combined into one unified state machine.

```typescript
// Currently scattered across 12 state variables:
// Loading/generation states:
const [isPageLoading, setIsPageLoading] = useState(false);
const [isStreaming, setIsStreaming] = useState(false);
const [error, setError] = useState<string | null>(null);
// Edit/publishing states:
const [isEditMode, setIsEditMode] = useState(false);
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [isSavingChanges, setIsSavingChanges] = useState(false);
const [originalContent, setOriginalContent] = useState('');
const [originalTitle, setOriginalTitle] = useState('');
const [originalStatus, setOriginalStatus] = useState<ExplanationStatus | null>(null);
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
// Current values for comparison:
const [content, setContent] = useState('');
const [explanationTitle, setExplanationTitle] = useState('');
```

**Why these MUST be combined:**
- ✅ **Mutually exclusive phases**: Loading → Streaming → Viewing → Editing → Saving
- ✅ When generation starts (line 311-316), it calls `clearExplanation()` which exits any edit state
- ✅ Edit button is `disabled={isStreaming}` (line 1061) - cannot edit during generation
- ✅ Regenerate clears explanation and starts loading - automatically exits editing
- ✅ Impossible states currently possible: `isPageLoading=true` AND `isEditMode=true` simultaneously
- ✅ Impossible states currently possible: `isStreaming=true` AND `isSavingChanges=true` simultaneously
- ✅ 12 interdependent variables reduced to a single linear state machine

**Actual code flow (proves mutual exclusivity):**
```typescript
// Line 311-316: Starting generation EXITS edit mode
setIsPageLoading(true);
clearExplanation(); // ← Clears content, making edit mode impossible

// Line 598, 1061: Can only edit when NOT streaming
disabled={isStreaming}  // ← Edit button

// Line 957-979: Regenerate EXITS edit mode and starts loading
await handleUserAction(...) → clearExplanation() → setIsPageLoading(true)
```

**Visual state flow (proves linear progression):**
```
          ┌─────────┐
          │  idle   │
          └────┬────┘
               │ START_GENERATION
               ▼
          ┌─────────┐
          │ loading │
          └────┬────┘
               │ START_STREAMING
               ▼
          ┌──────────┐
          │streaming │◄──── STREAM_CONTENT/TITLE
          └────┬─────┘
               │ LOAD_EXPLANATION
               ▼
          ┌─────────┐
          │ viewing │
          └────┬────┘
               │ ENTER_EDIT_MODE
               ▼
          ┌─────────┐
     ┌────┤ editing │
     │    └────┬────┘
     │         │ START_SAVE
     │         ▼
     │    ┌─────────┐
     │    │ saving  │
     │    └────┬────┘
     │         │ SAVE_SUCCESS
     │         ▼
     │    (page reload)
     │
     └─── EXIT_EDIT_MODE (reverts to viewing)

Note: Any phase can ERROR → error state
      From error state can START_GENERATION → loading (retry)
```

**Proposed combined reducer:**
```typescript
type PageLifecycleState =
  | { 
      phase: 'idle';
    }
  | { 
      phase: 'loading';
    }
  | { 
      phase: 'streaming';
      content: string;           // Accumulating during stream
      title: string;             // Set during progress events
    }
  | { 
      phase: 'viewing';
      content: string;
      title: string;
      status: ExplanationStatus;
      originalContent: string;   // Preserved for future edits
      originalTitle: string;
      originalStatus: ExplanationStatus;
    }
  | { 
      phase: 'editing';
      content: string;
      title: string;
      status: ExplanationStatus; // Computed: Draft if published+changed
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasUnsavedChanges: boolean; // Computed: content !== original || title !== original
    }
  | { 
      phase: 'saving';
      content: string;
      title: string;
      originalStatus: ExplanationStatus; // Needed for save logic
    }
  | { 
      phase: 'error'; 
      error: string;
      // Preserve state for recovery if error occurred during editing
      content?: string;
      title?: string;
      status?: ExplanationStatus;
      originalContent?: string;
      originalTitle?: string;
      originalStatus?: ExplanationStatus;
      hasUnsavedChanges?: boolean;
    };

type PageLifecycleAction =
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING' }
  | { type: 'STREAM_CONTENT'; content: string }
  | { type: 'STREAM_TITLE'; title: string }
  | { type: 'LOAD_EXPLANATION'; content: string; title: string; status: ExplanationStatus }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' } // Reverts to original values
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; newId?: number; isNewExplanation: boolean }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };
```

**State transition rules (full lifecycle):**
```typescript
// START_GENERATION: User initiates new explanation (line 311-316)
*                 → loading

// START_STREAMING: Server begins streaming response (line 401)
loading           → streaming { content: '', title: '' }

// STREAM_CONTENT/TITLE: Accumulate content during streaming (line 407, 416-420)
streaming         → streaming { ...state, content: newContent } or { ...state, title: newTitle }

// LOAD_EXPLANATION: Streaming complete or loaded from DB (line 206-222)
streaming | idle  → viewing { 
                      content, title, status, 
                      originalContent: content,    // Set BOTH current AND original
                      originalTitle: title, 
                      originalStatus: status 
                    }

// ENTER_EDIT_MODE: User clicks "Edit" button (line 598, 1019-1024)
viewing           → editing { ...state, phase: 'editing', hasUnsavedChanges: false }

// UPDATE_CONTENT/TITLE: User edits content (line 604-634)
editing           → editing {
                      ...state,
                      content: newContent,
                      hasUnsavedChanges: computed, // content !== original || title !== original
                      status: computed             // Draft if (originalStatus === Published && hasChanges)
                    }

// EXIT_EDIT_MODE: User clicks "Done Editing" without saving (line 598, 1064)
editing           → viewing {
                      ...state,
                      phase: 'viewing',
                      content: originalContent,    // REVERT to original
                      title: originalTitle,        // REVERT to original
                      status: originalStatus       // REVERT to original
                    }

// START_SAVE: User clicks "Publish Changes" (line 551-590)
editing           → saving { content, title, originalStatus }

// SAVE_SUCCESS: Save completed, page reloads (line 574-581)
saving            → (navigation/reload - component unmounts)

// SAVE_ERROR: Save failed, return to editing (line 583-587)
saving            → error { ...preserved state from before save, error }

// ERROR: Error during any phase (line 389-396, 445-450, 462-467)
loading|streaming|viewing|editing|saving → error { error, ...preserved state if available }

// RESET: Clear for new generation (line 315, 700)
*                 → idle
```

**Key implementation notes:**

1. **Single phase field replaces multiple booleans:**
   - `isPageLoading = phase === 'loading'` (derived from phase)
   - `isStreaming = phase === 'streaming'` (derived from phase)
   - `isEditMode = phase === 'editing'` (derived from phase)
   - `isSavingChanges = phase === 'saving'` (derived from phase)
   - **Impossible states become impossible**: Can't be loading AND editing simultaneously

2. **Computed properties (calculated in reducer, not stored):**
   - `hasUnsavedChanges = content !== originalContent || title !== originalTitle` (in editing phase)
   - `status = (originalStatus === Published && hasUnsavedChanges) ? Draft : originalStatus` (in editing phase)

3. **Original values always preserved (viewing/editing/error phases only):**
   - Set once on `LOAD_EXPLANATION` (transition to viewing)
   - Never modified until next `LOAD_EXPLANATION`
   - Used for change detection and revert functionality
   - Not present in loading/streaming phases (no content to preserve yet)

4. **Mutual exclusivity enforced by type system:**
   - Loading phase: No content, no edit state
   - Streaming phase: Accumulating content, cannot edit
   - Viewing phase: Complete content, can enter edit mode
   - Editing phase: Cannot start generation (Rewrite button clears explanation first)
   - Saving phase: Cannot edit or generate

5. **EXIT_EDIT_MODE behavior:**
   - **REVERTS** to original values (not just exits edit mode)
   - Matches "Cancel" semantics - user clicked "Done Editing" without saving
   - Consistent with tag reducer's `EXIT_TO_NORMAL` pattern
   - If user wants to keep changes, they must click "Publish Changes" first

6. **Save success handling:**
   - Draft → Published (update): Backend updates same record, frontend reloads page (`window.location.href`)
   - Published → Published (new version): Backend creates new record, frontend navigates to new URL (`router.push`)
   - Both cause component unmount, so reducer doesn't need to handle post-save state

7. **Streaming content handling:**
   - `STREAM_CONTENT` action accumulates content in real-time (line 407)
   - `STREAM_TITLE` action updates title from progress events (line 416-420)
   - `LOAD_EXPLANATION` transitions streaming → viewing with final values (line 206-222)
   - Original values set only when reaching viewing phase

8. **Error state recovery:**
   - Preserves whatever state was active when error occurred
   - Can recover from edit mode errors (user can retry save)
   - Can transition to loading from error (user clicks Rewrite to try again)

9. **Edge cases handled:**
   - Draft banner: Show different message for actual draft vs. published+edited (lines 817-836)
   - AI Suggestions Panel: Can trigger `ENTER_EDIT_MODE` directly (line 1188)
   - Regenerate from any state: Calls `clearExplanation()` → `START_GENERATION` → loading phase (line 315, 957-979)

**Lines affected (comprehensive - covers entire lifecycle):**
- **State declarations:** 48-63 (all loading/streaming/edit/saving states)
- **Generation start:** 311-316 (START_GENERATION → loading)
- **Streaming events:** 389-410 (START_STREAMING, STREAM_CONTENT, error handling)
- **Title/content updates:** 407, 416-420 (STREAM_CONTENT, STREAM_TITLE)
- **Complete/error:** 430-450, 462-467 (transition to viewing or error)
- **Load explanation:** 206-222 (LOAD_EXPLANATION → viewing, sets original values)
- **Auto-loading management:** 662-681 (derived loading state logic)
- **URL parameter processing:** 696-697 (START_GENERATION on new params)
- **Enter/exit edit mode:** 598, 1019-1024, 1064, 1188 (ENTER_EDIT_MODE, EXIT_EDIT_MODE)
- **Content change handler:** 604-634 (UPDATE_CONTENT, hasUnsavedChanges computation)
- **Status display logic:** 622-630 (computed status: Draft if published+changed)
- **Save changes handler:** 551-590 (START_SAVE, SAVE_SUCCESS, SAVE_ERROR)
- **Button disabled logic:** 795-796, 956, 987, 1008, 1017, 1032, 1041, 1054, 1061, 1079 (check phase states)
- **Progress bar:** 800-804 (show when phase === 'loading')
- **Draft banner:** 817-836 (check phase === 'editing' and hasUnsavedChanges)
- **Streaming indicator:** 1144-1151 (show when phase === 'streaming' and !content)

---

## 🟢 **Medium Priority: Explanation Data** (6 variables → custom hook, NOT reducer)

```typescript
// Currently scattered across component:
const [explanationId, setExplanationId] = useState<number | null>(null);
const [explanationTitle, setExplanationTitle] = useState('');
const [content, setContent] = useState('');
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);
const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
```

**Why custom hook is better than reducer:**
- ✅ This is a "load once, read many" pattern - not a state machine
- ✅ Encapsulates fetch logic cleanly separate from component
- ✅ Reusable across multiple pages/components
- ✅ Easier to test than component-embedded logic (per testing plan Phase 2)
- ✅ Less boilerplate than reducer for simple data loading
- ✅ Composable with the Edit/Publishing reducer

**Proposed custom hook:**
```typescript
// useExplanationLoader.ts
function useExplanationLoader() {
  const [state, setState] = useState<{
    explanationId: number | null;
    explanationTitle: string;
    content: string;
    explanationStatus: ExplanationStatus | null;
    explanationVector: { values: number[] } | null;
    systemSavedId: number | null;
    isLoading: boolean;
    error: string | null;
  }>({
    explanationId: null,
    explanationTitle: '',
    content: '',
    explanationStatus: null,
    explanationVector: null,
    systemSavedId: null,
    isLoading: false,
    error: null,
  });

  const loadExplanation = async (id: number) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await fetchExplanation(id);
      setState({
        explanationId: data.id,
        explanationTitle: data.title,
        content: data.content,
        explanationStatus: data.status,
        explanationVector: data.vector,
        systemSavedId: data.systemSavedId,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message
      }));
    }
  };

  return { ...state, loadExplanation };
}
```

**Usage with Edit reducer:**
```typescript
// In component:
const explanationData = useExplanationLoader();
const [editState, editDispatch] = useReducer(editReducer, initialEditState);

// When explanation loads, initialize edit state:
useEffect(() => {
  if (explanationData.explanationId) {
    editDispatch({
      type: 'LOAD_EXPLANATION',
      content: explanationData.content,
      title: explanationData.explanationTitle,
      status: explanationData.explanationStatus!,
    });
  }
}, [explanationData.explanationId]);
```

**Why this pairs well with Edit reducer:**
- Hook handles **loading** explanation data from API/DB
- Reducer handles **editing** and change tracking
- Clear separation: fetching vs. modifying
- `original*` values stay in Edit reducer where they're used

---

## ❌ **Don't Need Reducers:** Simple Toggles/Independent State

```typescript
// These are fine as useState:
const [isMarkdownMode, setIsMarkdownMode] = useState(true);  // Simple toggle
const [showMatches, setShowMatches] = useState(false);       // Simple toggle
const [userid, setUserid] = useState<string | null>(null);   // Set once
const [userSaved, setUserSaved] = useState(false);          // Independent flag
const [isSaving, setIsSaving] = useState(false);            // Simple loading flag
const [mode, setMode] = useState<MatchMode>(MatchMode.Normal); // Simple dropdown
const [prompt, setPrompt] = useState('');                    // Simple input
const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]); // List data
```

---

## Summary: Priority Order

### **Must Do (Prevents Bugs):**
1. ✅ **Tag Mode Reducer** - 6 variables, complex transitions, impossible states possible
2. ✅ **Page Lifecycle Reducer (COMBINED)** - 12 variables, enforces mutual exclusivity between loading/streaming/viewing/editing/saving

### **Should Do (Better Organization & Testing):**
3. ✅ **useExplanationLoader hook** - 6 variables, encapsulates loading logic from database/API, pairs with Page Lifecycle reducer, easier to test

### **Don't Do:**
4. ❌ Simple toggles and independent state - useState is perfect

**Key insight on combining reducers:**

The Loading/Generation and Edit/Publishing states were initially proposed as separate reducers, but **they are mutually exclusive** and should be combined:

- You **cannot** load AND edit simultaneously
- You **cannot** stream AND save simultaneously  
- Regenerate **exits** edit mode automatically by clearing explanation
- Edit button is **disabled** during loading/streaming

By combining into a single **Page Lifecycle Reducer**, we:
- Make impossible states truly impossible (enforced by TypeScript discriminated unions)
- Reduce from 12 boolean/state variables to 1 discriminated union
- Get a clear linear progression: `idle → loading → streaming → viewing → editing → saving`
- Simplify all UI logic: `if (lifecycle.phase === 'editing')` vs checking 4+ booleans

**Recommended implementation order:**
1. ✅ **Tag Mode Reducer** (highest bug risk, most complex interdependencies) - **DONE**
2. **Page Lifecycle Reducer** (12 variables → 1, prevents impossible states, enforces mutual exclusivity)
3. **useExplanationLoader hook** (clean separation, testable, provides data for lifecycle reducer)

The combination of Page Lifecycle reducer + Explanation Loader hook provides clear separation between **fetching data** (hook) and **managing the page state machine** (reducer), making both easier to test per the testing strategy.