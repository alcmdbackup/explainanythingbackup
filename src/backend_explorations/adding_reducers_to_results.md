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

## 🟠 **Critical Reducer 2: Loading/Generation State Machine** (3 variables → 1 reducer)

```typescript
// Currently scattered:
const [isPageLoading, setIsPageLoading] = useState(false);
const [isStreaming, setIsStreaming] = useState(false);
const [error, setError] = useState<string | null>(null);
```

**Why it's a perfect reducer candidate:**
- ✅ Clear phases: `idle` → `loading` → `streaming` → `complete` / `error`
- ✅ Impossible states currently possible: `isPageLoading=true` AND `error='some error'` simultaneously
- ✅ Multiple setters called together throughout code (lines 395-403, 477-483, 532-537)
- ✅ Manages only the generation lifecycle, not the actual content/title data (those remain as separate useState)

**Proposed reducer:**
```typescript
type GenerationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'streaming' }
  | { status: 'complete' }
  | { status: 'error'; error: string };

type GenerationAction =
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING' }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };
```

**Lines affected:** 30-32, 395-403, 486-522, 749-769

---

## 🟡 **High Priority Reducer 3: Edit/Publishing State** (9 variables → 1 reducer)

```typescript
// Currently scattered across 9 state variables:
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

**Why it's a perfect reducer candidate:**
- ✅ Clear state machine: `viewing` → `editing` → `saving` → `viewing` (success) or `error` (failure)
- ✅ Impossible states currently possible: `isSavingChanges=true` AND `isEditMode=true` simultaneously
- ✅ Complex change detection logic: `hasUnsavedChanges` computed from content/title comparisons (line 669)
- ✅ Complex status transitions: Published+changed → Draft display (lines 677-683)
- ✅ 9 interdependent variables that must stay in sync
- ✅ Multiple setters called together throughout code (lines 606-644, 669-688)

**Proposed reducer:**
```typescript
type EditState =
  | {
      mode: 'viewing';
      content: string;
      title: string;
      status: ExplanationStatus;
      // Original values preserved for future edits
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
    }
  | {
      mode: 'editing';
      content: string;
      title: string;
      status: ExplanationStatus; // Computed: Draft if published+changed
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasUnsavedChanges: boolean; // Computed: content !== original || title !== original
    }
  | {
      mode: 'saving';
      content: string;
      title: string;
      originalStatus: ExplanationStatus; // Needed for save logic
    }
  | {
      mode: 'error';
      content: string;
      title: string;
      status: ExplanationStatus;
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasUnsavedChanges: boolean;
      errorMessage: string;
    };

type EditAction =
  | { type: 'LOAD_EXPLANATION'; content: string; title: string; status: ExplanationStatus }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' } // Reverts to original values
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; newId?: number; isNewExplanation: boolean }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'RESET' }; // For new generation
```

**State transition rules:**
```typescript
// LOAD_EXPLANATION: Initialize with loaded data (sets BOTH current AND original)
*                 → viewing { content, title, status, originalContent, originalTitle, originalStatus }

// ENTER_EDIT_MODE: Start editing (preserves original values)
viewing | error   → editing { ...state, mode: 'editing', hasUnsavedChanges: false }

// UPDATE_CONTENT/TITLE: Update content during editing
editing           → editing {
                      ...state,
                      content: newContent,
                      hasUnsavedChanges: computed, // content !== original || title !== original
                      status: computed             // Draft if (originalStatus === Published && hasChanges)
                    }

// EXIT_EDIT_MODE: Cancel editing and revert changes
editing | error   → viewing {
                      ...state,
                      mode: 'viewing',
                      content: originalContent,    // REVERT to original
                      title: originalTitle,        // REVERT to original
                      status: originalStatus       // REVERT to original
                    }

// START_SAVE: Begin save operation
editing           → saving { content, title, originalStatus }

// SAVE_SUCCESS: Save completed (page reload/navigate happens in useEffect)
saving            → viewing (component will unmount due to navigation)

// SAVE_ERROR: Save failed
saving            → error { ...preserved state from before save, errorMessage }

// RESET: Clear for new generation
*                 → viewing { content: '', title: '', status: null, original values: '' }
```

**Key implementation notes:**

1. **Computed properties (calculated in reducer, not stored):**
   - `hasUnsavedChanges = content !== originalContent || title !== originalTitle`
   - `status = (originalStatus === Published && hasUnsavedChanges) ? Draft : originalStatus`
   - `isSavingChanges = mode === 'saving'` (derived from mode)
   - `isEditMode = mode === 'editing'` (derived from mode)

2. **Original values always preserved:**
   - Set once on `LOAD_EXPLANATION`
   - Never modified until next `LOAD_EXPLANATION`
   - Used for change detection and revert functionality

3. **EXIT_EDIT_MODE behavior:**
   - **REVERTS** to original values (not just exits edit mode)
   - Matches "Cancel" semantics - user clicked "Done Editing" without saving
   - Consistent with tag reducer's `EXIT_TO_NORMAL` pattern
   - If user wants to keep changes, they must click "Publish Changes" first

4. **Save success handling:**
   - Draft → Published (update): Backend updates same record, frontend reloads page (`window.location.href`)
   - Published → Published (new version): Backend creates new record, frontend navigates to new URL (`router.push`)
   - Both cause component unmount, so reducer doesn't need to handle post-save state

5. **Edge cases handled:**
   - Streaming content: Initial load sets original values after streaming completes (line 205-215)
   - Draft banner: Show different message for actual draft vs. published+edited (lines 876-895)
   - AI Suggestions Panel: Can trigger `ENTER_EDIT_MODE` directly (line 1247)
   - Error state: Preserves all edit state so user can retry save

**Lines affected:**
- State declarations: 43-49, 47-53
- Load explanation: 205-215
- Enter/exit edit mode: 652
- Content change handler: 659-688
- Status display logic: 677-683
- Save changes handler: 606-644
- Button visibility/disabled: 1097-1110
- Edit mode toggle button: 1119
- Draft banner: 876-895
- AI Suggestions Panel: 1242-1247

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
2. ✅ **Loading/Generation Reducer** - 3-5 variables, clear phases, prevents loading+error simultaneously

### **Should Do (Major Simplification):**
3. ✅ **Edit/Publishing Reducer** - 5-10 variables, complex change detection, status transitions

### **Should Do (Better Organization & Testing):**
4. ✅ **useExplanationLoader hook** - 6 variables, encapsulates loading logic, pairs with Edit reducer, easier to test

### **Don't Do:**
5. ❌ Simple toggles and independent state - useState is perfect

**Recommended implementation order:**
1. **Tag Mode Reducer** (highest bug risk, most complex interdependencies)
2. **Loading/Generation Reducer** (prevents impossible loading+error states)
3. **Edit/Publishing Reducer** (complex change detection, status transitions)
4. **useExplanationLoader hook** (clean separation, testable, pairs with #3)

The combination of Edit reducer + Explanation Loader hook provides clear separation between **fetching data** (hook) and **modifying data** (reducer), making both easier to test per the testing strategy.