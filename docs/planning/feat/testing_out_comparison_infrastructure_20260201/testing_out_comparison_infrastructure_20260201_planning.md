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

---

## Gap Analysis (4-Agent Exploration, 2026-02-02)

Four parallel agents explored the article bank implementation across CRUD, add-from-run, run-comparison, and UI/test coverage. Findings are ranked by severity.

### HIGH — Will cause runtime errors or data corruption

#### 1. Duplicate variant persistence in `evolutionActions.ts`
- **File**: `src/lib/services/evolutionActions.ts` lines 353-368
- **Issue**: `triggerEvolutionRunAction` calls `.insert()` on `evolution_variants` after `executeMinimalPipeline` completes. But `pipeline.ts` now also calls `persistVariants()` which uses `.upsert()`. The second `.insert()` will hit a primary key conflict and fail.
- **Fix**: Remove the manual `.insert()` block in `evolutionActions.ts` — `persistVariants()` in `pipeline.ts` already handles this with idempotent upsert.

#### 2. `total_cost_usd: null` for 1-shot entries
- **File**: `src/lib/services/articleBankActions.ts` line ~687
- **Issue**: `generateAndAddToBankAction` passes `total_cost_usd: null` when inserting bank entries for 1-shot articles. This breaks `elo_per_dollar` calculations since `(elo - 1200) / null = null`.
- **Fix**: Track prompt + completion token costs from `callLLMModel` responses (title + content calls) and sum them into `total_cost_usd`.

#### 3. Race condition in `addToBankAction` select-or-insert
- **File**: `src/lib/services/articleBankActions.ts` lines ~127-147
- **Issue**: The select-or-insert pattern for topics (replaced from PostgREST upsert due to expression-index incompatibility) has a TOCTOU race. Two concurrent inserts with the same prompt could both find no existing topic and both insert, violating the unique constraint.
- **Fix**: Wrap in a retry loop that catches the unique constraint violation and re-selects, or use a Postgres function/RPC for atomic upsert.

### MEDIUM — Functional gaps or incomplete data

#### 4. Incomplete metadata when adding from evolution run
- **Files**: `src/app/admin/quality/article-bank/[topicId]/page.tsx` lines 352-357, `src/app/admin/quality/evolution/run/[runId]/page.tsx` lines 50-55
- **Issue**: `AddFromRunDialog` only passes basic fields (title, content, model, cost). Missing: strategy effectiveness breakdown, match statistics, generation count, duration, agent cost breakdown.
- **Impact**: Leaderboard's expandable metadata rows show sparse info for evolution entries vs what's available in the run detail page.

#### 5. All-pairs comparison instead of Swiss-style pairing
- **File**: `src/lib/services/articleBankActions.ts` lines ~367-369
- **Issue**: `runBankComparisonAction` uses all-pairs (every entry vs every other entry per round), which is O(N²) per round. With many entries, cost and time grow quickly.
- **Impact**: For a topic with 10 entries, each round runs 45 comparisons. Swiss-style pairing (O(N/2) per round) would be more cost-efficient, as already implemented in the evolution pipeline's `CalibrationRanker`.

#### 6. `quality_scores` JSONB never populated
- **File**: `src/lib/evolution/core/pipeline.ts` in `persistVariants()`
- **Issue**: The `evolution_variants` table has a `quality_scores` JSONB column, but `persistVariants()` never writes to it. Agent quality evaluations exist in the pipeline state but aren't persisted.
- **Impact**: Bank entries derived from evolution runs lack quality dimension data that could inform comparisons.

### LOW — Polish, test coverage, UX

#### 7. No live progress during comparisons
- **File**: `src/app/admin/quality/article-bank/[topicId]/page.tsx`
- **Issue**: "Run Comparison" dialog shows a generic "Running..." spinner with no per-match progress. For large topics with many pairs, this gives no feedback on how far along the comparison is.
- **Suggestion**: Return a stream or poll for progress, showing "Comparing pair 3/45..."

#### 8. Two E2E tests skipped
- **File**: `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts`
- **Issue**: Two Playwright tests are skipped: comparison flow and add-to-bank from run detail. These cover critical paths.
- **Suggestion**: Unskip and implement with proper test data setup.

#### 9. Integration tests blocked on migration
- **File**: `src/__tests__/integration/article-bank-actions.integration.test.ts`
- **Issue**: Integration tests require the `article_bank_*` tables to exist. They were blocked until migration `20260201000001` was deployed. Now that the migration has run in production, these should be verified.

### Summary Table

| # | Severity | Area | Status |
|---|----------|------|--------|
| 1 | HIGH | Duplicate variant insert | Fixed — removed `.insert()` in `evolutionActions.ts`, `persistVariants()` upsert handles it |
| 2 | HIGH | Null cost for 1-shot | Fixed — wired `onUsage` callback in `generateAndAddToBankAction`, costs accumulate from both LLM calls |
| 3 | HIGH | Race in topic upsert | Fixed — `upsertTopicByPrompt()` retry loop catches Postgres 23505 unique violation |
| 4 | MEDIUM | Incomplete run metadata | Fixed — fetches `run_summary` for strategy effectiveness, match stats, duration, baseline rank |
| 5 | MEDIUM | All-pairs vs Swiss | Fixed — Swiss-style pairing sorts by Elo, matches adjacent, tracks compared pairs |
| 6 | MEDIUM | quality_scores empty | Skipped — no quality evaluation data exists in pipeline state to persist. Requires new feature. |
| 7 | LOW | No comparison progress | Fixed — dialog shows pair estimate, button shows entry count during run |
| 8 | LOW | Skipped E2E tests | Not fixed — requires real LLM/DB setup |
| 9 | LOW | Integration tests blocked | Verify — migration deployed, tests should work |

### Additional Fix
- **All models in comparison judge selector**: Added all `allowedLLMModelSchema` models (gpt-4o-mini, gpt-4o, gpt-5-nano, gpt-5-mini, o3-mini, deepseek-chat, claude-sonnet-4) to the "Run Comparison" dialog's judge model dropdown.
