# Blocking Save with Open AI Edits

## Problem
Users should not be able to save content while there are unresolved AI suggestions in the Lexical editor. This prevents incomplete or unclear content from being published.

## Solution
Disable save buttons when unresolved AI suggestions exist, with a tooltip explaining why.

## Architecture

### Detection Mechanism
AI suggestions are represented as `DiffTagNode` (inline/block) in Lexical. The `DiffTagHoverPlugin` already tracks these via `activeDiffKeys` state, which is updated by mutation listeners on `DiffTagNodeInline` and `DiffTagNodeBlock`.

**Key insight**: `activeDiffKeys.size > 0` indicates pending suggestions exist.

### Data Flow
```
DiffTagHoverPlugin (tracks activeDiffKeys)
    ↓ onPendingSuggestionsChange callback
LexicalEditor (threads prop)
    ↓ onPendingSuggestionsChange prop
results/page.tsx (hasPendingSuggestions state)
    ↓ disabled + title props
Save/Publish buttons (disabled with tooltip)
```

## Implementation

### 1. DiffTagHoverPlugin (`src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx`)
Add optional callback prop to notify parent of suggestion state changes:
```tsx
interface DiffTagHoverPluginProps {
  onPendingSuggestionsChange?: (hasPendingSuggestions: boolean) => void;
}

// In component:
useEffect(() => {
  onPendingSuggestionsChange?.(activeDiffKeys.size > 0);
}, [activeDiffKeys.size, onPendingSuggestionsChange]);
```

### 2. LexicalEditor (`src/editorFiles/lexicalEditor/LexicalEditor.tsx`)
Add prop to interface and thread through:
```tsx
interface LexicalEditorProps {
  // ...existing
  onPendingSuggestionsChange?: (hasPendingSuggestions: boolean) => void;
}

// Pass to DiffTagHoverPlugin in JSX
<DiffTagHoverPlugin onPendingSuggestionsChange={onPendingSuggestionsChange} />
```

### 3. Results Page (`src/app/results/page.tsx`)
Add state and update button disabled conditions:
```tsx
const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);

// Save button
disabled={... || hasPendingSuggestions}
title={hasPendingSuggestions ? "Accept or reject AI suggestions before saving" : undefined}

// Publish button
disabled={... || hasPendingSuggestions}
title={hasPendingSuggestions ? "Accept or reject AI suggestions before publishing" : undefined}
```

## Testing Strategy

### Unit Tests
- DiffTagHoverPlugin: Verify callback fires with correct boolean when activeDiffKeys changes

### E2E Tests
1. Generate AI suggestions → verify save button disabled
2. Hover disabled button → verify tooltip appears
3. Accept all suggestions → verify save button enabled
4. Reject all suggestions → verify save button enabled

## Alternatives Considered

1. **Confirmation dialog**: Would allow save but require explicit user confirmation. Rejected - user preferred prevention over prompting.

2. **Auto-accept all on save**: Would accept all pending suggestions automatically. Rejected - may publish unwanted changes.

3. **Ref method instead of callback**: Could add `hasPendingSuggestions()` method to `LexicalEditorRef`. Rejected - callback pattern is more reactive and follows existing `onContentChange` pattern.
