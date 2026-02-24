# Questions On Stage Experiments Research

## Problem Statement
The experiment system under "Rating Optimization" > "Experiments" in the evolution dashboard currently accepts free-text prompts via a textarea. Prompts should instead be selected from the existing prompt library (evolution_hall_of_fame_topics), ensuring consistency and reuse of curated prompts.

## Requirements (from user)
- Under "rating optimization" in evolution dashboard, under "Experiments", make sure that the only prompts available are the ones from prompt library
- Prompts must be selectable from prompt library (not free-text input)

## High Level Summary
The ExperimentForm currently uses a textarea where users type prompts as free text (one per line). The prompt registry (`evolution_hall_of_fame_topics`) already exists with full CRUD via `promptRegistryActions.ts`. Two other pages already load prompts from this registry: the Evolution dashboard's StartRunCard (native `<select>`) and the Explorer page (`SearchableMultiSelect`). The fix is to wire ExperimentForm to load prompts from the registry and present them as a checkbox multi-select, then send prompt IDs to the backend which resolves them to text before storing.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- All 15 evolution pipeline docs

## Code Files Read
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`
- `evolution/src/services/experimentActions.ts`
- `evolution/src/experiments/evolution/experimentValidation.ts`
- `evolution/src/services/promptRegistryActions.ts`
- `src/app/api/cron/experiment-driver/route.ts`
- `src/app/admin/quality/evolution/page.tsx` (StartRunCard prompt usage)
- `src/app/admin/quality/explorer/page.tsx` (SearchableMultiSelect pattern)

## Detailed Findings

### 1. ExperimentForm — Current Prompt Handling

**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

The form manages prompts as a single string in state:
```ts
const [prompts, setPrompts] = useState('');
```

The textarea (lines 257-263) accepts free-text, one prompt per line. On submit, prompts are parsed:
```ts
const promptList = prompts.split('\n').map(p => p.trim()).filter(Boolean);
```

Client-side validation only checks emptiness (line 75):
```ts
if (promptList.length === 0) clientErrors.push('Enter at least 1 prompt');
```

Both `validateExperimentConfigAction` and `startExperimentAction` receive `prompts: promptList` — raw text strings with no connection to the prompt registry.

**No imports from `promptRegistryActions.ts` exist in this file.**

### 2. Backend — Experiment Actions & Prompt Flow

**File:** `evolution/src/services/experimentActions.ts`

Both input types accept raw text:
```ts
export interface ValidateExperimentInput {
  factors: Record<string, FactorInput>;
  prompts: string[];      // ← raw text
}
export interface StartExperimentInput {
  name: string;
  factors: Record<string, FactorInput>;
  prompts: string[];      // ← raw text
  budget: number;
  // ...
}
```

In `startExperimentAction` (line 143):
- `prompts: input.prompts` is stored directly to `evolution_experiments.prompts` (TEXT[] NOT NULL column)
- Each prompt string becomes an explanation's `content` field (line 200): `content: prompt`
- The title is derived from text: `[Exp: ${input.name}] ${prompt.slice(0, 50)}`
- Total runs = `design.runs.length × input.prompts.length` (line 158)

### 3. Experiment Validation

**File:** `evolution/src/experiments/evolution/experimentValidation.ts`

`validateExperimentConfig(factorDefs, prompts, configDefaults)` only checks prompt count:
```ts
if (prompts.length === 0) errors.push('At least 1 prompt is required');
if (prompts.length > 10) errors.push(`Maximum 10 prompts allowed, got ${prompts.length}`);
```

Cost estimation uses `prompts.length` as a multiplier (line 57):
```ts
total += estimate.totalUsd * safetyMultiplier * prompts.length;
```

**No prompt content validation exists.** The validation function treats prompts as opaque strings — it only cares about count.

### 4. Prompt Registry (Library)

**File:** `evolution/src/services/promptRegistryActions.ts`

The prompt registry stores prompts in `evolution_hall_of_fame_topics` with these fields:
- `id` (UUID), `prompt` (text), `title` (string), `difficulty_tier`, `domain_tags` (string[]), `status` ('active'|'archived'), `deleted_at` (soft delete), `created_at`

Key actions:
- **`getPromptsAction(filters?)`** — Fetches prompts with optional status filter and soft-delete exclusion. Returns `PromptMetadata[]`.
- **`createPromptAction(input)`** — Creates with case-insensitive uniqueness check
- **`updatePromptAction(input)`** — Partial update with uniqueness guard
- **`archivePromptAction(id)`** — Sets status to 'archived'
- **`deletePromptAction(id)`** — Soft delete (sets `deleted_at`), blocked if prompt has associated runs
- **`resolvePromptByText(supabase, promptText)`** — Case-insensitive text match, returns ID or null. Used by finalizePipelineRun() auto-link.

### 5. Existing Prompt Selector Patterns in UI

#### StartRunCard (evolution/page.tsx)
- Calls `getPromptsAction({ status: 'active' })` on mount (line 160)
- Uses a native `<select>` dropdown for single-prompt selection
- Simple pattern but only supports single selection

#### Explorer Page (explorer/page.tsx)
- Calls `getPromptsAction({ status: 'active' })` on mount (line 534)
- Uses `SearchableMultiSelect` (lines 227-326) — a locally-defined component with:
  - Text search/filter
  - Checkbox multi-selection
  - URL parameter sync
  - Dropdown open/close behavior
- This is the most feature-complete prompt selector pattern in the codebase

#### Prompts Management Page (prompts/page.tsx)
- Full CRUD table for managing prompts
- Not relevant for selection UI, but confirms the registry is well-maintained

### 6. Experiment Driver (Cron Route)

**File:** `src/app/api/cron/experiment-driver/route.ts`

The experiment driver reads `exp.prompts` (text array) from the DB for next-round creation in `handlePendingNextRound`. It:
- Uses `exp.prompts.length` for cost estimation and run count
- Creates explanations with `content: prompt` from the stored text array

**The driver never queries the prompt registry** — it works entirely from the stored text in `evolution_experiments.prompts`. This means the `prompts` column must continue to contain resolved text, not IDs.

### 7. Database Schema

**Migration:** `supabase/migrations/20260222100003_add_experiment_tables.sql`

```sql
prompts TEXT[] NOT NULL
```

The `evolution_experiments.prompts` column is a PostgreSQL TEXT array. The experiment driver and all downstream consumers expect text strings here.

### 8. Test Coverage

Existing test files:
- `evolution/src/experiments/evolution/experimentValidation.test.ts` — Tests prompt count validation
- `evolution/src/services/experimentActions.test.ts` — Tests start/validate actions
- `src/app/api/cron/experiment-driver/route.test.ts` — Tests cron driver flow
- `src/__tests__/integration/strategy-experiment.integration.test.ts` — Integration tests

All tests currently pass raw text strings as prompts.

## Architecture Documentation

### Data Flow: Current
```
User types in textarea → split('\n') → string[] → validateExperimentConfigAction(prompts: string[])
                                                 → startExperimentAction(prompts: string[])
                                                   → INSERT evolution_experiments.prompts = TEXT[]
                                                   → CREATE explanations with content = prompt text
                                                   → experiment-driver reads prompts TEXT[] for subsequent rounds
```

### Data Flow: Proposed
```
User selects from checkbox list → string[] (IDs) → validateExperimentConfigAction(promptIds: string[])
                                                    → resolve IDs to text for count validation
                                                  → startExperimentAction(promptIds: string[])
                                                    → resolve IDs to text from evolution_hall_of_fame_topics
                                                    → INSERT evolution_experiments.prompts = resolved TEXT[]
                                                    → CREATE explanations with content = resolved text
                                                    → experiment-driver unchanged (reads TEXT[] as before)
```

### Key Constraint
The `evolution_experiments.prompts` column must continue storing resolved text strings (not IDs) because the experiment driver and all downstream consumers expect TEXT[]. Resolution happens at experiment creation time only.

## Open Questions
- Should the `SearchableMultiSelect` from explorer/page.tsx be extracted to a shared component, or should ExperimentForm use a simpler checkbox list? (Planning decision)
- Should we add a `prompt_ids` column to `evolution_experiments` for traceability back to the registry? (Future enhancement, not required for this task)
