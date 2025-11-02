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

## 🟠 **Critical Reducer 2: Loading/Generation State Machine** (3-5 variables → 1 reducer)

```typescript
// Currently scattered:
const [isPageLoading, setIsPageLoading] = useState(false);
const [isStreaming, setIsStreaming] = useState(false);
const [error, setError] = useState<string | null>(null);
// These are tightly coupled with loading:
const [content, setContent] = useState('');
const [explanationTitle, setExplanationTitle] = useState('');
```

**Why it's a perfect reducer candidate:**
- ✅ Clear phases: `idle` → `loading` → `streaming` → `complete` / `error`
- ✅ Impossible states currently possible: `isPageLoading=true` AND `error='some error'` simultaneously
- ✅ Content should only update during streaming, not in other states
- ✅ Multiple setters called together throughout code (lines 395-403, 477-483, 532-537)

**Proposed reducer:**
```typescript
type GenerationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'streaming'; content: string; title: string }
  | { status: 'complete'; content: string; title: string }
  | { status: 'error'; error: string };

type GenerationAction =
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING'; title?: string }
  | { type: 'STREAM_CONTENT'; content: string }
  | { type: 'COMPLETE'; content: string; title: string }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };
```

**Lines affected:** 30-32, 395-403, 486-522, 749-769

---

## 🟡 **High Priority Reducer 3: Edit/Publishing State** (5+ variables → 1 reducer)

```typescript
// Currently scattered:
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

**Why it's a good reducer candidate:**
- ✅ Clear flow: `viewing` → `editing` → `saving` → `published` / back to `viewing`
- ✅ Complex change detection logic (lines 692-722)
- ✅ Status transitions based on edit state and original status (lines 710-718)
- ✅ Many interdependent variables (8-10 depending on how you count)

**Proposed reducer:**
```typescript
type EditState =
  | { 
      mode: 'viewing'; 
      content: string; 
      title: string; 
      status: ExplanationStatus;
    }
  | { 
      mode: 'editing'; 
      content: string; 
      title: string; 
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasChanges: boolean;
      displayStatus: ExplanationStatus; // Draft if published+changed
    }
  | { 
      mode: 'saving'; 
      content: string; 
      title: string;
    };

type EditAction =
  | { type: 'LOAD_EXPLANATION'; content: string; title: string; status: ExplanationStatus }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' }
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_COMPLETE' }
  | { type: 'SAVE_ERROR' };
```

**Lines affected:** 47-53, 238-242, 639-678, 684-722, 926-945, 1150-1163

---

## 🟢 **Medium Priority: Explanation Data** (could group, but less urgent)

```typescript
// Related but not state machine:
const [explanationId, setExplanationId] = useState<number | null>(null);
const [explanationTitle, setExplanationTitle] = useState('');
const [content, setContent] = useState('');
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);
const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
```

**Why it's borderline:**
- ⚠️ These are all related to the loaded explanation
- ⚠️ But they're not a state machine - just related data
- ⚠️ Could be grouped for organization, but doesn't prevent impossible states
- ✅ Better handled by custom hook (`useExplanationLoader`) than reducer

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

### **Could Do (Organization):**
4. ⚠️ Explanation data grouping - better as custom hook than reducer

### **Don't Do:**
5. ❌ Simple toggles and independent state - useState is perfect

Would you like me to implement any of these reducers? I'd recommend starting with the **Tag Mode Reducer** since it has the most complex interdependencies and the highest bug risk.