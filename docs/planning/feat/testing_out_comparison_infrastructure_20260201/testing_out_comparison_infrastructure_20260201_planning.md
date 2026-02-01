# Testing Out Comparison Infrastructure Plan

## Background
We're testing the article bank comparison infrastructure end-to-end. During manual testing we fixed two bugs (upsert expression-index mismatch, UUID userid for LLM tracking). Now we're improving the Generate New Article dialog UX by adding a topic picker dropdown so users can generate articles under existing topics or create new ones.

## Problem
The Generate New Article dialog currently only has a free-text prompt field. Every generation creates or matches a topic by prompt text. Users who want to add another article to an existing topic must re-type the exact prompt. We need a dropdown that lists existing topics and a "New topic" option that shows the textarea.

## Current Feature: Topic Picker Dropdown

### Files to Modify
- `src/app/admin/quality/article-bank/page.tsx` — all UI changes (dialog + page)

### Changes

#### 1. Props — add `topics` to GenerateArticleDialog (line 136)
```typescript
function GenerateArticleDialog({ onClose, onGenerated, topics }: {
  onClose: () => void;
  onGenerated: (topicId: string) => void;
  topics: BankTopicWithStats[];
}) {
```

#### 2. State — replace `prompt` with topic selection (line 140)
```typescript
const [selectedTopicId, setSelectedTopicId] = useState<string>('__new__');
const [newPrompt, setNewPrompt] = useState('');

const effectivePrompt = useMemo(() => {
  if (selectedTopicId === '__new__') return newPrompt.trim();
  return topics.find((t) => t.id === selectedTopicId)?.prompt.trim() ?? '';
}, [selectedTopicId, newPrompt, topics]);
```

#### 3. handleGenerate — use effectivePrompt (lines 145-146)
Change `if (!prompt.trim())` → `if (!effectivePrompt)` and `prompt: prompt.trim()` → `prompt: effectivePrompt`.

#### 4. UI — replace textarea block (lines 180-189)
- `<select>` dropdown: `"+ New topic"` default, existing topics as options
- Truncate long prompts to 80 chars, show entry count suffix
- Conditionally render `<textarea>` only when `selectedTopicId === '__new__'`

#### 5. Pass topics prop from ArticleBankPage (line 448)
```diff
  <GenerateArticleDialog
+   topics={topics}
    onClose={...}
    onGenerated={...}
  />
```

### What Stays the Same
- Server actions (`generateAndAddToBankAction`, `addToBankAction`) — no signature changes. Prompt-based `ilike` matching already handles deduplication.
- `articleBankActions.test.ts` — no changes needed.

### Edge Cases
| Case | Handling |
|---|---|
| Empty topics list | Only "New topic" shows; textarea visible by default — identical to current UX |
| Long prompts | Truncated to 80 chars in dropdown; full prompt sent via `topic.prompt` lookup |
| `__new__` sentinel | Cannot collide with UUID topic IDs |

## Testing
- `npx eslint src/app/admin/quality/article-bank/page.tsx`
- `npx tsc --noEmit`
- `npm run build`
- Manual via Playwright: open Generate dialog, verify dropdown lists existing topics, selecting one hides textarea, switching to "New topic" restores textarea, generation succeeds for both paths

## Documentation Updates
- No doc updates needed — this is a UI-only change within existing feature scope
