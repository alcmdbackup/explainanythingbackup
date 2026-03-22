# Simplify Refactor Evolutionv2 Pipeline Plan

## Background
The evolution V2 pipeline is the sole production pipeline (~2,507 LOC). V1's pipeline.ts, PoolSupervisor, and AgentBase were fully deleted, but significant V1 remnants linger: 12 dead files (1,600 LOC), a runner that double-wraps V1/V2 cost tracking, duplicated services, and a confusing `core/` vs `v2/` directory split that no longer reflects reality. This project cleans it all up.

## Requirements (from GH Issue #740)
Look for ways to streamline and simplify our evolution V2 pipeline.

## Problem
The evolution module has accumulated technical debt from the V1→V2 transition. Dead V1 files (1,600 LOC) remain alongside live code, the runner creates V1 costTracker/llmClient/logger objects that V2 silently discards and re-creates internally, two service files CRUD the same database table, and the directory structure (`core/` for V1 remnants, `v2/` for production code) implies a separation that no longer exists. This makes the codebase harder to navigate, increases maintenance burden, and creates confusion about which code is authoritative.

## Options Considered

### Option A: Delete dead code only (minimal)
- Delete 12 dead files + 11 dead barrel exports
- Pros: Lowest risk, immediate clarity
- Cons: Doesn't fix runner double-wrapping or directory confusion

### Option B: Delete dead code + fix runner + merge directories (recommended)
- Delete dead code, migrate runner to raw provider, flatten `core/` + `v2/` into unified structure
- Pros: Fully eliminates V1/V2 confusion, makes V2 self-contained
- Cons: More import path changes (mechanical but noisy diffs)

### Option C: Option B + V2 code simplification + service consolidation (full cleanup)
- Everything in B plus extracting phase executor, merging prompt templates, consolidating duplicated services
- Pros: Maximum improvement in one pass
- Cons: Larger scope, more testing

**Decision: Option C** — Do the full cleanup. Each phase is independently testable, and the risk is low throughout.

## Phased Execution Plan

### Phase 1: Delete Dead V1 Files (1,600 LOC across 19 files)
Delete these 8 dead source files + 7 associated test files + 11 dead barrel exports.

**Source files to delete (8 files, 715 LOC):**
1. `evolution/src/lib/core/configValidation.ts` (65 LOC)
2. `evolution/src/lib/core/costEstimator.ts` (301 LOC)
3. `evolution/src/lib/core/agentToggle.ts` (37 LOC)
4. `evolution/src/lib/core/budgetRedistribution.ts` (75 LOC)
5. `evolution/src/lib/core/jsonParser.ts` (54 LOC)
6. `evolution/src/lib/config.ts` (91 LOC)
7. `evolution/src/services/evolutionRunClient.ts` (57 LOC)
8. `src/app/admin/evolution/strategies/strategyFormUtils.ts` (33 LOC)

**Test files to delete (7 files, 885 LOC):**
1. `evolution/src/lib/core/configValidation.test.ts` (70 LOC)
2. `evolution/src/lib/core/costEstimator.test.ts` (601 LOC)
3. `evolution/src/lib/core/budgetRedistribution.test.ts` (95 LOC)
4. `evolution/src/lib/core/jsonParser.test.ts` (77 LOC)
5. `evolution/src/services/evolutionRunClient.test.ts` (135 LOC)
6. *(agentToggle has no test file)*
7. *(config.ts has no test file)*

**Note:** Phase 2 deletes 3 additional V1 files (costTracker, llmClient, logger + tests) that are still live until the runner is migrated. These are NOT included in Phase 1.

**Barrel cleanup (`evolution/src/lib/index.ts`) — remove 11 dead exports:**
- `toggleAgent`, `computeCostPrediction`, `refreshAgentCostBaselines`
- `RunCostEstimateSchema`, `CostPredictionSchema`
- `MAX_EXPERIMENT_BUDGET_USD`
- `PipelinePhase`, `GenerationStep`, `GenerationStepName`, `DiffMetrics`, `EloAttribution`, `AgentAttribution`

**Pre-deletion verification:** Run `npm run build && npm test` BEFORE deleting to establish baseline. Then delete files, remove barrel exports, and run again to confirm no breakage.

### Phase 2: Migrate Runner to Raw Provider (eliminate double-wrapping)
Replace V1 imports in `evolutionRunnerCore.ts` with a simple raw LLM provider, making V2 fully self-contained.

**Current flow (lines 75-98):**
```
V1 costTracker → V1 logger → V1 llmClient → thin provider wrapper → executeV2Run()
  Inside V2: creates V2 costTracker + V2 llmClient (V1 tracker is dead weight)
```

**New flow:**
```
raw provider (calls callLLM directly) → executeV2Run()
  Inside V2: creates V2 costTracker + V2 llmClient (unchanged)
```

**Raw provider interface spec (matches V2's `createV2LLMClient` parameter at `v2/llm-client.ts:74`):**
```typescript
// V2 expects this exact signature:
// rawProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> }

// New implementation in evolutionRunnerCore.ts:
// EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001' (existing constant, line 33)
const llmProvider = {
  async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
    // callLLM has 10 parameters — must pass all of them:
    return callLLM(
      prompt,                          // prompt text
      `evolution_${label}`,            // call_source (for tracking)
      EVOLUTION_SYSTEM_USERID,         // userid
      opts?.model ?? 'deepseek-chat',  // model
      false,                           // streaming
      null,                            // setText
      null,                            // responseObj (no structured output)
      null,                            // responseObjName
      false,                           // debug
      {},                              // options (no onUsage — V2 tracks costs internally)
    );
  }
};
```

**Note on cost tracking:** The raw provider does NOT pass `onUsage` callback — this is intentional. V2's `createV2LLMClient` handles all cost tracking internally via the V2 `CostTracker`. The V1 `onUsage` callback was how V1 tracked per-call costs, but V2 estimates cost from token counts in `llm-client.ts`.

**Changes:**
1. Remove V1 imports from `evolutionRunnerCore.ts` (lines 75-77): `createEvolutionLLMClient`, `createCostTracker`, `createEvolutionLogger`
2. Replace cost tracker + logger + LLM client creation (lines 79-87) with raw provider above
3. Keep the `@evolution/lib/v2` import for `executeV2Run` (unchanged)
4. Delete now-unused V1 files:
   - `evolution/src/lib/core/costTracker.ts` (154 LOC) + test
   - `evolution/src/lib/core/llmClient.ts` (163 LOC) + test
   - `evolution/src/lib/core/logger.ts` (127 LOC) + test
5. Remove their exports from `evolution/src/lib/index.ts`
6. Remove `createEvolutionLLMClient` export from barrel (it was the only production consumer)

**Rollback plan:** If issues arise after deployment, revert the single Phase 2 commit. V1 files restored by git revert. No database migrations or state changes — purely code initialization. Note: Phase 1 (dead file deletion) must be committed separately before Phase 2 so rollback of Phase 2 doesn't require restoring dead files.

**New tests:**
- Unit test for raw provider: mock `callLLM` via `jest.mock('@/lib/services/llms')`, verify `complete('prompt', 'generation', { model: 'gpt-4.1' })` calls `callLLM` with 10 correct arguments including `evolution_generation` label, the specified model, and `EVOLUTION_SYSTEM_USERID`. Also test default model (`deepseek-chat`) when opts.model is undefined.
- Integration test: new file `evolution-raw-provider.integration.test.ts` — create test Supabase client (follow pattern from existing integration tests), mock `callLLM` via `jest.mock('@/lib/services/llms')` to return dummy text, call `executeV2Run` with raw provider, verify: (1) run completes with status='completed', (2) `total_cost_usd > 0`, (3) V2 cost tracker was used (not V1).

**Environment variables for manual verification:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` must be set. For dry-run, use `--dry-run` flag which skips actual LLM calls. Success criteria: (1) no errors logged, (2) `evolution_runs.total_cost_usd > 0` for non-dry-run, (3) all invocations marked `success=true`.

**Verify:** `npm run build && npm test`, then trigger a test evolution run via CLI (`npx tsx evolution/scripts/evolution-runner.ts --dry-run`) to confirm end-to-end execution.

### Phase 3: Types Cleanup (~50 LOC)
Remove dead types from `evolution/src/lib/types.ts`:

1. Remove `CalibrationExecutionDetail` (lines 170-187)
2. Remove `TournamentExecutionDetail` (lines 189-204)
3. Remove `'calibration'` and `'tournament'` from `AgentName` union
4. Remove these from the `AgentExecutionDetail` discriminated union
5. Update `evolution/src/testing/executionDetailFixtures.ts` to remove corresponding fixtures
6. Verify no admin UI `AgentExecutionDetailView` components reference these detail types

**Note:** `RankingExecutionDetail` is ALIVE (used by V2 ranking agent) — do NOT remove.

**Verify:** `npm run build && npm test`

### Phase 4: Merge Directory Structure
Eliminate the `core/` vs `v2/` split. After phases 1-2, `core/` contains only shared utilities — no "V1 pipeline" remains.

**IMPORTANT: `evolution/src/lib/utils/` already exists** with unrelated files (evolutionUrls.ts, formatters.ts, frictionSpots.ts, metaFeedback.ts). Use `shared/` instead to avoid naming collision.

**Reverse dependency resolution (MUST happen first):**
`core/strategyConfig.ts` imports `V2StrategyConfig` from `v2/types.ts`. Before moving directories:
1. Move the `V2StrategyConfig` type definition to the shared `types.ts` at lib root
2. Update `core/strategyConfig.ts` to import from `../types` instead of `../v2/types`
3. Update `v2/types.ts` to **re-export** from `../types` (not define): `export type { V2StrategyConfig } from '../types';`
4. This creates a single source of truth in `lib/types.ts` with a re-export in `v2/types.ts` for backward compat during migration. After Phase 4 completes, the re-export in `pipeline/types.ts` can be kept for convenience or removed.

**New structure:**
```
evolution/src/lib/
├── pipeline/              # ← v2/ contents (the production pipeline)
│   ├── evolve-article.ts
│   ├── rank.ts
│   ├── generate.ts
│   ├── evolve.ts
│   ├── runner.ts
│   ├── finalize.ts
│   ├── arena.ts
│   ├── experiments.ts
│   ├── cost-tracker.ts
│   ├── llm-client.ts
│   ├── run-logger.ts
│   ├── seed-article.ts
│   ├── strategy.ts
│   ├── invocations.ts
│   ├── types.ts
│   ├── errors.ts
│   └── index.ts
│   └── *.test.ts          # All v2 test files move with their source
├── shared/                # ← shared core/ + agents/ utilities
│   ├── rating.ts          # + rating.test.ts
│   ├── comparison.ts      # + comparison.test.ts
│   ├── reversalComparison.ts  # + test
│   ├── comparisonCache.ts     # + test
│   ├── formatValidator.ts     # + test
│   ├── formatRules.ts
│   ├── formatValidationRules.ts  # + test
│   ├── textVariationFactory.ts   # + test
│   ├── errorClassification.ts    # + test
│   ├── strategyConfig.ts  # Pruned: keep labelStrategyConfig, delete dead types
│   └── seedArticle.ts     # + test (used by CLI scripts)
├── utils/                 # UNCHANGED — existing files stay here
│   ├── evolutionUrls.ts
│   ├── formatters.ts
│   ├── frictionSpots.ts
│   └── metaFeedback.ts
├── types.ts               # Shared types (stays at lib root)
├── index.ts               # Barrel (simplified)
└── (core/ and agents/ directories deleted)
```

**Import path updates (complete inventory, ~35-40 files):**

*Pipeline files (14 source + 17 test files):*
- `../core/rating` → `../shared/rating`
- `../core/textVariationFactory` → `../shared/textVariationFactory`
- `../core/errorClassification` → `../shared/errorClassification`
- `../core/comparisonCache` → `../shared/comparisonCache`
- `../core/reversalComparison` → `../shared/reversalComparison`
- `../comparison` → `../shared/comparison`
- `../agents/formatValidator` → `../shared/formatValidator`
- `../agents/formatRules` → `../shared/formatRules`

*External files (services, scripts, admin UI — 7 files):*
- `@evolution/lib/v2/*` → `@evolution/lib/pipeline/*` in:
  - `evolution/src/services/strategyRegistryActionsV2.ts`
  - `evolution/src/services/experimentActionsV2.ts`
  - `evolution/src/experiments/evolution/experimentMetrics.ts`
- `@evolution/lib/core/strategyConfig` → `@evolution/lib/shared/strategyConfig` in admin UI
- `@evolution/lib/core/seedArticle` → `@evolution/lib/shared/seedArticle` in CLI scripts

*Barrel file updates:*
- `evolution/src/lib/index.ts`: update re-export paths from `./core/*` → `./shared/*`, `./v2/*` → `./pipeline/*`
- `evolution/src/lib/pipeline/index.ts`: update internal imports from `../core/*` → `../shared/*`

**Jest config check:** Verify `jest.config.js` and `jest.integration.config.js` `moduleNameMapper` for `^@evolution/(.*)$` — this maps to `evolution/src/$1` which will work with both old and new paths since the alias is at the `evolution/src/` level. No jest config changes needed.

**Test file strategy:** All test files stay colocated with their source files (e.g., `rank.ts` + `rank.test.ts` move together to `pipeline/`). This preserves the existing colocated pattern and requires no jest config changes since jest discovers tests via glob patterns (`**/*.test.ts`).

**Pre-migration audit (run before moving any files):**
1. `npm run build` — establish baseline
2. Generate complete import inventory: `grep -r '@evolution/lib/core\|@evolution/lib/v2\|from.*\.\./core/\|from.*\.\./agents/' evolution/src src/app --include='*.ts' --include='*.tsx' | cut -d: -f1 | sort -u` — capture exact file list
3. After all moves + import updates, verify every file in the audit list was updated
4. `npm run build && npm test` — confirm zero breakage

**Barrel export audit:** After updating `evolution/src/lib/index.ts` re-export paths, verify all remaining exports resolve by checking `npm run build` passes. The barrel currently has ~87 exports; after Phase 1-2 cleanup, this shrinks to ~60. Each re-export path must be updated from `./core/*` → `./shared/*` and `./v2/*` → `./pipeline/*`.

**Directory naming conventions:**
- `pipeline/` — V2 production pipeline code (evolve-article, rank, generate, etc.)
- `shared/` — Cross-module utilities reused by pipeline (rating, comparison, format validation)
- `utils/` — Standalone helpers (evolutionUrls, formatters, frictionSpots) — UNCHANGED

**Verify:** `npm run build && npm test` — purely mechanical refactor, no logic changes.

### Phase 5: V2 Code Simplification (~120-140 LOC savings)

**5a. Extract phase executor in evolve-article.ts (320 → ~280 LOC)**

Extract the repeated try-catch pattern into an `executePhase()` helper. The helper MUST handle both error types present in the current code:
- `BudgetExceededError` — stops the pipeline, records partial cost
- `BudgetExceededWithPartialResults` — stops the pipeline but first pushes partial results to the pool

```typescript
interface PhaseResult<T> {
  success: boolean;
  result?: T;
  budgetExceeded?: boolean;
  partialVariants?: TextVariation[];  // From BudgetExceededWithPartialResults
}

async function executePhase<T>(
  phaseName: string,
  phaseFn: () => Promise<T>,
  db: SupabaseClient,
  invocationId: string | null,
  costTracker: V2CostTracker,
  costBefore: number,
): Promise<PhaseResult<T>> {
  try {
    const result = await phaseFn();
    const cost = costTracker.getTotalSpent() - costBefore;
    await updateInvocation(db, invocationId, { cost_usd: cost, success: true });
    return { success: true, result };
  } catch (error) {
    const cost = costTracker.getTotalSpent() - costBefore;
    if (error instanceof BudgetExceededWithPartialResults) {
      await updateInvocation(db, invocationId, { cost_usd: cost, success: false, error_message: error.message });
      return { success: false, budgetExceeded: true, partialVariants: error.partialVariants };
    }
    if (error instanceof BudgetExceededError) {
      await updateInvocation(db, invocationId, { cost_usd: cost, success: false, error_message: error.message });
      return { success: false, budgetExceeded: true };
    }
    throw error;  // Re-throw unexpected errors
  }
}
```

**IMPORTANT: Error type ordering.** `BudgetExceededWithPartialResults extends BudgetExceededError`, so the `instanceof` check for the subclass MUST come BEFORE the parent class check. The helper above does this correctly (lines check `WithPartialResults` first, then plain `BudgetExceeded`).

**New test:** Unit test for `executePhase()` with 5 cases:
1. Success — returns `{ success: true, result }`
2. BudgetExceededError — returns `{ success: false, budgetExceeded: true }`
3. BudgetExceededWithPartialResults — returns `{ success: false, budgetExceeded: true, partialVariants: [...] }`
4. Unexpected error — re-thrown (not caught)
5. **Hierarchy test** — throw `BudgetExceededWithPartialResults`, verify it does NOT fall through to the plain `BudgetExceededError` branch (confirms ordering correctness)

**5b. Share prompt templates across generate.ts + evolve.ts (~30 LOC savings)**
Extract shared prompt boilerplate to `pipeline/prompts.ts`.

Current inline prompt builders (7 total):
- `generate.ts` lines 26-62: 3 builders (structural_transform, lexical_simplify, grounding_enhance)
- `evolve.ts` lines 12-42: `buildMutationPrompt()` (clarity + structure variants)
- `evolve.ts` lines 44-65: `buildCrossoverPrompt()`
- `evolve.ts` lines 67-79: `buildCreativePrompt()`

All share: intro preamble, `## Original Text` section, optional feedback section, `## Task` with strategy-specific instructions, `FORMAT_RULES` suffix.

Extracted template:
```typescript
function buildEvolutionPrompt(text: string, instructions: string, feedback?: string): string {
  return `You are an expert writing editor.\n\n## Original Text\n${text}\n\n${
    feedback ? `## Previous Feedback\n${feedback}\n\n` : ''
  }## Task\n${instructions}\n\n${FORMAT_RULES}\nOutput ONLY the improved text, no explanations.`;
}
```

**New test:** Snapshot test for each of 7 strategies verifying prompt includes correct instructions and format rules.

**5c. Merge cost functions in llm-client.ts (~10 LOC savings)**
`estimateCost()` (line 43) and `computeActualCost()` (line 48) in `v2/llm-client.ts` both compute `tokens * price_per_token`. They differ only in how output tokens are determined (estimated constant vs actual response length).

Merged:
```typescript
function calculateCost(inputChars: number, outputChars: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}
```

Callers pass either estimated output length or actual response length.

**5d. Single-pass strategy aggregation in finalize.ts (~10 LOC savings)**
- Replace double-loop grouping (lines 63-71) with single reduce pass

**Verify:** `npm run build && npm test` — run full V2 test suite. All existing tests must pass unchanged.

### Implementation Notes (apply during execution, not blockers for plan approval)
- **EVOLUTION_SYSTEM_USERID:** Verify constant exists in `evolutionRunnerCore.ts` (line 33) before Phase 2. If renamed/moved, update raw provider accordingly.
- **callLLM signature stability:** If `callLLM` signature has changed since plan was written, update raw provider params to match. The interface contract is what V2's `createV2LLMClient` expects: `{ complete(prompt, label, opts?) → Promise<string> }`.
- **Model validation:** Raw provider passes model string directly to `callLLM`. Model validation happens downstream in `callLLM` itself — no need to re-validate in the provider.
- **V2StrategyConfig re-export:** After Phase 4, `pipeline/types.ts` re-exports from `../types`. This re-export can be removed once all consumers import from `@evolution/lib/types` directly. Track as follow-up.
- **Jest test discovery:** Jest uses `testMatch: ['**/*.test.ts']` glob which works regardless of directory name. Verify after Phase 4 with `npm test -- --listTests | grep pipeline`.
- **Snapshot tests (Phase 5b):** Use `toMatchInlineSnapshot()` for small prompts so diffs are visible in PRs. Update snapshots explicitly with `npm test -- -u` and review in PR.
- **Mock strategy (Phase 2 integration test):** Mock at module level with `jest.mock('@/lib/services/llms', () => ({ callLLM: jest.fn().mockResolvedValue('Generated text.') }))`. Reset mocks in `beforeEach`. The mock must return valid article text that passes format validation.
- **CI/CD:** No workflow changes needed. Existing CI runs `npm run build && npm test` on every PR. Integration tests run on PRs touching `evolution/` paths. E2E tests are skip-gated and not affected.
- **Manual verification environment:** Run against local dev environment with test Supabase instance. Don't test against production.

### Phase 6: Service Consolidation (~250 LOC savings)

**6a. Merge arenaActions.ts + promptRegistryActionsV2.ts**
Both CRUD `evolution_arena_topics`. Merge into single `arenaActions.ts` with unified topic CRUD + arena sub-resources.

**Admin UI routing impact:**
- `/admin/evolution/arena/page.tsx` → imports from `arenaActions` (getArenaTopicsAction, createArenaTopicAction)
- `/admin/evolution/arena/[topicId]/page.tsx` → imports from `arenaActions` (getArenaTopicDetailAction, getArenaEntriesAction, archiveArenaTopicAction)
- `/admin/evolution/arena/entries/[entryId]/page.tsx` → imports from `arenaActions` (getArenaEntryDetailAction)
- `/admin/evolution/prompts/page.tsx` → imports from `promptRegistryActionsV2` (listPromptsAction, createPromptAction, updatePromptAction, archivePromptAction, deletePromptAction)
- `/admin/evolution/prompts/[promptId]/page.tsx` → imports from `promptRegistryActionsV2` (getPromptDetailAction, updatePromptAction)

**Merged service structure:**
```typescript
// arenaActions.ts (merged) — all named exports preserved
// Topic CRUD (deduplicated):
export const listTopicsAction = ...;       // replaces getArenaTopicsAction + listPromptsAction
export const getTopicDetailAction = ...;   // replaces getArenaTopicDetailAction + getPromptDetailAction
export const createTopicAction = ...;      // replaces createArenaTopicAction + createPromptAction
export const updateTopicAction = ...;      // from promptRegistryActionsV2 only
export const archiveTopicAction = ...;     // replaces archiveArenaTopicAction + archivePromptAction
export const deleteTopicAction = ...;      // from promptRegistryActionsV2 only
// Arena sub-resources (unchanged):
export const getArenaEntriesAction = ...;
export const getArenaEntryDetailAction = ...;
export const getArenaComparisonsAction = ...;
// Backward-compat re-exports for gradual migration:
export { listTopicsAction as getArenaTopicsAction, listTopicsAction as listPromptsAction };
```

After merge, update all 5 admin UI pages to import from unified `arenaActions.ts`. Delete `promptRegistryActionsV2.ts`.

**New test:** Unit test for merged service covering both code paths: create topic → list (verify appears) → update → archive → delete. Verify getArenaEntriesAction still works for arena sub-resources.

**6b. Extract shared service helpers**
- `evolution/src/services/queryHelpers.ts`: batch enrichment helper (used 8+ times), pagination builder (used 6+ times)
- Reduces boilerplate in `evolutionActions.ts`, `evolutionVisualizationActions.ts`, `variantDetailActions.ts`

**6c. Fix variant lineage N+1 query**
- Replace `getVariantLineageChainAction`'s while-loop with recursive SQL CTE
- Test with existing variant lineage data; no schema changes needed

**Verify:** `npm run build && npm test`, then manual admin UI testing — all evolution pages load and function correctly.

### Phase 7: Admin UI Component Dedup (~100 LOC savings)

**7a. Adopt existing shared StatusBadge**
- `StatusBadge.tsx` already exists in `evolution/src/components/evolution/`
- Replace 3 inline `STATE_BADGES` definitions in:
  - `_components/ExperimentStatusCard.tsx`
  - `experiments/[experimentId]/ExperimentDetailContent.tsx`
  - `experiments/[experimentId]/ExperimentOverviewCard.tsx`

**7b. Adopt existing shared MetricGrid**
- `MetricGrid.tsx` already exists
- Replace 3 inline MetricCard/InfoCard/SummaryCard implementations in:
  - `variants/[variantId]/VariantDetailContent.tsx`
  - `invocations/[invocationId]/page.tsx`
  - `experiments/[experimentId]/ExperimentAnalysisCard.tsx`

**7c. Consolidate error boundaries**
- Extract shared `EvolutionErrorBoundary` component to `evolution/src/components/evolution/EvolutionErrorBoundary.tsx`
- Replace 13 identical `error.tsx` files under `src/app/admin/evolution/` with single-line re-exports

**Verify:** Visual check of experiment, variant, invocation detail pages. Run existing component unit tests.

## Testing

### Automated (every phase)
- `npm run build` — TypeScript compilation (catches broken imports)
- `npm run lint` — Lint checks
- `npm test` — All unit tests (2,665 V2 test LOC + shared utility tests)
- `npm run test:integration` — Integration tests

### New tests by phase
- **Phase 2:** Unit test for raw provider creation (correct callLLM arguments, model defaults, label prefixing). Integration test mocking callLLM → executeV2Run → verify V2 cost tracker creation.
- **Phase 5a:** Unit test for `executePhase()` helper covering 4 cases: success, BudgetExceededError, BudgetExceededWithPartialResults, unexpected error re-throw.
- **Phase 5b:** Unit test for prompt template function output per strategy.
- **Phase 6a:** Integration test for merged arena/prompt service covering both code paths.

### Manual verification
- **After Phase 2:** Trigger a test evolution run via CLI to confirm pipeline executes end-to-end. Verify cost tracking works (check `evolution_runs.total_cost_usd` is populated).
- **After Phase 4:** Verify all admin evolution pages load without errors.
- **After Phase 6:** Navigate all admin evolution pages, verify data loads correctly.
- **After Phase 7:** Visual check experiment/variant/invocation detail pages render correctly.

### Rollback strategy
Each phase is a single atomic commit containing ALL file moves + import updates for that phase. Rollback = `git revert <commit>`. No database migrations or state changes in any phase — all changes are purely code-level.

**Phase-specific rollback notes:**
- **Phase 1:** Safe, no rollback needed (only deletes dead code)
- **Phase 2:** Highest risk. Revert restores V1 costTracker/llmClient/logger imports. Must be a separate commit from Phase 1.
- **Phase 4:** Single commit with ALL directory renames + ALL import path updates. Never partially commit Phase 4 — either all files move or none do.
- **Phases 5-7:** Low risk, standard revert.

## Documentation Updates
Research verified which docs are already V2-accurate vs outdated:

- `evolution/docs/evolution/architecture.md` — **Already V2-accurate** ✓ No changes needed
- `evolution/docs/evolution/visualization.md` — **Already V2-accurate** ✓ No changes needed
- `evolution/docs/evolution/data_model.md` — **Partially outdated**: references removed 'minimal'/'batch' pipeline types; update after Phase 3
- `evolution/docs/evolution/cost_optimization.md` — **Partially outdated**: references ExecutionContext, claims 11 agents; update after Phase 2
- `evolution/docs/evolution/reference.md` — Update key file paths after Phase 4 (directory restructure)
- `evolution/docs/evolution/README.md` — Update directory map after Phase 4
- `evolution/docs/evolution/rating_and_comparison.md` — No changes needed (rating system unchanged)
- `evolution/docs/evolution/experimental_framework.md` — No changes needed
