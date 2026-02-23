# Questions On Stage Experiments Plan

## Background
The experiment form allows free-text prompt entry. We need to restrict it to only allow prompts from the prompt library.

## Requirements (from user)
- Under "rating optimization" in evolution dashboard, under "Experiments", make sure that the only prompts available are the ones from prompt library
- Prompts must be selectable from prompt library (not free-text input)

## Problem
Free-text prompts bypass the prompt registry, leading to inconsistency and no metadata (difficulty tier, domain tags). The ExperimentForm textarea allows arbitrary text that has no link to curated prompts in `evolution_hall_of_fame_topics`. Meanwhile, the prompt registry already has full CRUD and is used by StartRunCard and Explorer — only ExperimentForm is disconnected.

## Key Constraint
The `evolution_experiments.prompts` column is `TEXT[] NOT NULL`. The experiment driver cron and all downstream consumers read raw text from this column. We must **resolve prompt IDs → text at creation time** and continue storing text. The driver needs zero changes.

## Approach
Use a simple checkbox list (not the `SearchableMultiSelect` dropdown from Explorer). Rationale:
- Experiments need 1-10 prompts — small enough to show inline without a dropdown
- Checkbox list is consistent with the factor selection UI directly above it in the same form
- Simpler to implement; no outside-click handling, z-index, or dropdown state
- Explorer's `SearchableMultiSelect` is designed for filtering hundreds of results — overkill here

## Phased Execution Plan

### Phase 1: Frontend — ExperimentForm.tsx
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

1. **Add import** for `getPromptsAction` from `@evolution/services/promptRegistryActions` and `PromptMetadata` from `@evolution/lib/types`

2. **Add state** for loaded prompts and selected IDs:
   ```ts
   const [availablePrompts, setAvailablePrompts] = useState<PromptMetadata[]>([]);
   const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
   ```

3. **Load prompts on mount** — add `getPromptsAction({ status: 'active' })` call inside the existing `useEffect` that loads factor metadata. Parallel fetch with `Promise.all`.

4. **Remove old state and derived values:**
   - Delete `const [prompts, setPrompts] = useState('');`
   - Delete `const promptList = prompts.split('\n').map(p => p.trim()).filter(Boolean);`

5. **Replace textarea (lines 252-267)** with a checkbox list:
   - Show each prompt as: `[checkbox] Title — truncated prompt text`
   - Style consistent with the factor checkbox list above (same border/padding pattern)
   - Show prompt count: `{selectedPromptIds.length} of {availablePrompts.length} selected`
   - If no prompts loaded, show "No active prompts in library" message

6. **Update client-side validation** (line 75):
   - Change `promptList.length === 0` → `selectedPromptIds.length === 0`
   - Change error message to `'Select at least 1 prompt'`

7. **Update calls to server actions:**
   - `validateExperimentConfigAction`: send `promptIds: selectedPromptIds` instead of `prompts: promptList`
   - `startExperimentAction`: send `promptIds: selectedPromptIds` instead of `prompts: promptList`

8. **Update debounce dependency:**
   - Change `JSON.stringify(promptList)` → `JSON.stringify(selectedPromptIds)`

### Phase 2: Backend — experimentActions.ts
**File:** `evolution/src/services/experimentActions.ts`

1. **Change input types:**
   ```ts
   // ValidateExperimentInput
   promptIds: string[];  // was: prompts: string[]

   // StartExperimentInput
   promptIds: string[];  // was: prompts: string[]
   ```

2. **Add prompt resolution helper** (top of file, after imports):
   ```ts
   async function resolvePromptIds(supabase, promptIds: string[]): Promise<string[]> {
     const { data, error } = await supabase
       .from('evolution_hall_of_fame_topics')
       .select('id, prompt')
       .in('id', promptIds)
       .is('deleted_at', null);
     if (error || !data) throw new Error(`Failed to resolve prompts: ${error?.message}`);
     if (data.length !== promptIds.length) {
       const found = new Set(data.map(d => d.id));
       const missing = promptIds.filter(id => !found.has(id));
       throw new Error(`Prompt(s) not found: ${missing.join(', ')}`);
     }
     // Preserve selection order
     const byId = new Map(data.map(d => [d.id, d.prompt]));
     return promptIds.map(id => byId.get(id)!);
   }
   ```

3. **Update `_validateExperimentConfigAction`:**
   - Accept `input.promptIds` instead of `input.prompts`
   - Create a supabase client, resolve IDs to get prompt count
   - Pass resolved text array to `validateExperimentConfig()` (its signature stays the same — it only checks count)

4. **Update `_startExperimentAction`:**
   - Accept `input.promptIds` instead of `input.prompts`
   - Resolve IDs to text via `resolvePromptIds()`
   - Use resolved text everywhere that previously used `input.prompts`:
     - `prompts: resolvedPrompts` in the experiment INSERT (line 143)
     - `input.prompts.length` → `resolvedPrompts.length` (line 158)
     - `for (const prompt of input.prompts)` → `for (const prompt of resolvedPrompts)` (line 193)

### Phase 3: experimentValidation.ts — No changes
The validation function signature `validateExperimentConfig(factorDefs, prompts, configDefaults)` stays the same. It receives resolved text from the action layer. It only checks `prompts.length` — no content validation.

### Phase 4: experiment-driver/route.ts — No changes
The driver reads `exp.prompts` (TEXT[]) from DB. Since we still store resolved text, the driver works unchanged.

### Phase 5: Tests

1. **`evolution/src/services/experimentActions.test.ts`:**
   - Change mock inputs from `prompts: ['text1', 'text2']` → `promptIds: ['uuid1', 'uuid2']`
   - Mock the `evolution_hall_of_fame_topics` query to return prompt text for those IDs
   - Verify resolved text ends up in the experiment INSERT

2. **`evolution/src/experiments/evolution/experimentValidation.test.ts`:**
   - No changes expected — this tests the pure validation function which still takes `string[]`

3. **`src/app/api/cron/experiment-driver/route.test.ts`:**
   - No changes expected — driver reads stored TEXT[]

4. **`src/__tests__/integration/strategy-experiment.integration.test.ts`:**
   - May need `promptIds` update if it calls the action layer directly

5. **Run full check suite:** `lint`, `tsc`, `build`, all unit tests, integration tests

### Phase 6: Documentation
- Update `evolution/docs/evolution/strategy_experiments.md` — experiment UI section: mention prompt library picker instead of free-text

## Files Changed (summary)
| File | Change |
|------|--------|
| `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` | Replace textarea with checkbox list, send IDs |
| `evolution/src/services/experimentActions.ts` | Accept `promptIds`, resolve to text |
| `evolution/src/services/experimentActions.test.ts` | Update mock inputs |
| `evolution/docs/evolution/strategy_experiments.md` | Update UI description |

## Files NOT Changed
| File | Reason |
|------|--------|
| `evolution/src/experiments/evolution/experimentValidation.ts` | Only checks count; receives resolved text from action layer |
| `src/app/api/cron/experiment-driver/route.ts` | Reads stored TEXT[] from DB; unaffected |
| `supabase/migrations/*` | No schema changes; prompts column stays TEXT[] |
