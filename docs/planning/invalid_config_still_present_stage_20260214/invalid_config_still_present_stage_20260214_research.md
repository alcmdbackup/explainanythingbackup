# Invalid Config Still Present Stage Research

## Problem Statement
Fix invalid evolution pipeline configuration that persists in the staging environment. The project will audit all evolution config values in staging, identify invalid or stale configuration, and fix or remove problematic values to ensure the evolution pipeline operates correctly.

## Requirements (from GH Issue #439)
- Audit all evolution config values in staging, identify invalid ones, fix or remove them
- Specifically: "Start Pipeline" with a basic "light" strategy in staging is broken — the configuration is invalid somehow
- Add ability to mark zombie runs (stuck in "running" but actually dead) as dead/failed and kill them
- Filter out any prompts and strategies with "test" in their names from the "Start Pipeline" dropdown menus

## High Level Summary

Three distinct issues need fixing in the evolution admin dashboard:

1. **Invalid "light" strategy config** — No "light" strategy exists in codebase presets (only Economy/Balanced/Quality). The "light" strategy is a user-created entry in the staging `evolution_strategy_configs` table. Config validation at queue time is extremely permissive — `buildRunConfig()` silently drops invalid fields and `resolveConfig()` just merges with defaults. The failure likely occurs during pipeline execution when invalid model names or missing budgetCaps cause agent errors.

2. **No zombie run kill mechanism** — Run statuses follow: pending → claimed → running → {completed, failed, paused}. The only automated recovery is the watchdog cron (10-min heartbeat timeout, runs every 15 min). There is NO manual kill/cancel action or UI button. Need to add `killEvolutionRunAction` and a "Kill" button following the existing Trigger/Rollback pattern.

3. **No test data filtering** — Both `getPromptsAction` and `getStrategiesAction` filter only by `status` and `deleted_at`. No mechanism filters by name content. Simplest fix: filter at UI level in StartRunCard when mapping dropdown options, or add server-side `.not('name/title', 'ilike', '%test%')`.

## Research Findings

### 1. Start Pipeline UI & Strategy Validation Flow

**StartRunCard component**: `src/app/admin/quality/evolution/page.tsx` (lines 154-343)
- Loads prompts via `getPromptsAction({ status: 'active' })` from `evolution_hall_of_fame_topics` table
- Loads strategies via `getStrategiesAction({ status: 'active' })` from `evolution_strategy_configs` table
- Client-side validation: prompt selected, strategy selected, budget > 0
- Calls `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })`

**queueEvolutionRunAction**: `src/lib/services/evolutionActions.ts` (lines 139-257)
- Validates prompt exists and not deleted (lines 155-163)
- Validates strategy exists — NO status or config validity check (lines 165-175)
- Calls `buildRunConfig(strategyConfig, strategyId)` (line 214)
- Inserts run into `evolution_runs` with status='pending' (lines 227-231)
- Then calls `triggerEvolutionRunAction` inline

**buildRunConfig()**: `src/lib/services/evolutionActions.ts` (lines 272-314)
- Transforms QueueStrategyConfig → partial EvolutionRunConfig
- `enabledAgents` Zod validation is non-blocking (warns, doesn't throw)
- Copies: `singleArticle`, `iterations→maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`
- Does NOT copy `agentModels` or `budgetCapUsd`

**triggerEvolutionRunAction**: `src/lib/services/evolutionActions.ts` (lines 508-630)
- Loads run from DB, verifies status='pending'
- Calls `preparePipelineRun({ configOverrides: run.config ?? {} })`
- Inside preparePipelineRun: `resolveConfig()` merges overrides with DEFAULT_EVOLUTION_CONFIG

**resolveConfig()**: `src/lib/evolution/config.ts` (lines 43-67)
- Shallow-merges overrides with defaults (nested objects individually merged)
- Auto-clamps expansion.maxIterations for short runs
- NO validation — just merge and return

**Config flow**: evolution_strategy_configs.config → QueueStrategyConfig → buildRunConfig() → evolution_runs.config → triggerEvolutionRunAction → resolveConfig() → full EvolutionRunConfig

**Key gap**: No Zod schema validation of the full EvolutionRunConfig anywhere in the pipeline. Invalid model names, missing budgetCaps, etc. pass through silently until agent execution fails.

### 2. Strategy Presets & "Light" Strategy

**Built-in presets** (strategyRegistryActions.ts lines 373-414):
- **Economy**: deepseek-chat/gpt-4.1-nano, 2 iterations, minimal pipeline, no optional agents
- **Balanced**: gpt-4.1-mini/gpt-4.1-nano, 3 iterations, full pipeline, 6 optional agents
- **Quality**: gpt-4.1/gpt-4.1-mini, 5 iterations, full pipeline, all agents + outlineGeneration

**No "light" preset exists in code.** The "light" strategy in staging is user-created. Need to check staging DB to see its config and identify what's invalid.

**StrategyConfig required fields**: `generationModel` (string), `judgeModel` (string), `iterations` (number), `budgetCaps` (Record<string, number>)

### 3. Run Status Lifecycle & Zombie Detection

**Status enum**: `'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'paused'`
- Defined in `src/lib/evolution/types.ts` (line 528)
- DB constraint in `supabase/migrations/20260131000001_evolution_runs.sql`

**Status transitions**:
- `pending → claimed`: Atomic claim via `claim_evolution_run()` RPC (FOR UPDATE SKIP LOCKED)
- `claimed → running`: Pipeline sets on first agent execution (pipeline.ts lines 878-881)
- `running → completed`: Normal finish (pipeline.ts lines 1033-1040)
- `running → failed`: Error or watchdog (pipeline.ts lines 107-117)
- `running → paused`: Budget exceeded (pipeline.ts lines 120-126)

**Heartbeat mechanism**:
- Updated every 30s (cron runner) or 60s (batch runner) or after each checkpoint (pipeline core)
- Watchdog cron: `src/app/api/cron/evolution-watchdog/route.ts` — runs every 15 min, marks runs with stale heartbeats (>10 min) as failed

**markRunFailed()**: `src/lib/evolution/core/pipeline.ts` (lines 107-117)
- Status guard: only transitions from `['pending', 'claimed', 'running']`
- Sets `status='failed'`, `error_message`, `completed_at`

**NO existing kill/cancel action or UI**

### 4. Runs Table UI & Action Button Patterns

**Runs table**: `page.tsx` (lines 822-934)
- Action buttons in `<div className="flex gap-2">` within Actions column (lines 899-934)
- "View Variants" button: always visible (lines 901-907)
- "Trigger" button: visible when `status === 'pending'` (lines 908-917)
- "Rollback" button: visible when `status === 'completed'` (lines 918-927)

**Action handler pattern** (consistent across all):
1. Set `actionLoading` state
2. Call server action
3. Toast success/error via `sonner`
4. Refresh table via `loadRuns()`
5. Clear `actionLoading`

**Confirmation**: Uses native `window.confirm()` (e.g., Rollback at line 747)

**Kill button placement**: Between Trigger and Rollback, visible when `status === 'running' || status === 'claimed'`

### 5. Prompt & Strategy Dropdown Filtering

**Prompts**: `src/lib/services/promptRegistryActions.ts` (lines 26-59)
- Fetches from `evolution_hall_of_fame_topics`
- Filters: `deleted_at IS NULL`, optional `status` filter
- Display field: `title` (normalized to first 60 chars of prompt if null)
- Used by: Evolution StartRunCard, Prompt admin page, HoF page

**Strategies**: `src/lib/services/strategyRegistryActions.ts` (lines 32-60)
- Fetches from `evolution_strategy_configs`
- Filters: optional `status`, `isPredefined`, `pipelineType`
- Display field: `name`
- Used by: Evolution StartRunCard, Strategy admin page

**No test-name filtering exists** — both actions return all non-deleted/active entries regardless of name content.

**UI rendering**: `page.tsx` lines 248-261 — `<select>` elements mapping `p.label` and `s.label`

**Recommended approach**: Filter at UI level in StartRunCard when mapping options (simplest, no backend change needed, doesn't affect admin management pages):
```typescript
pRes.data
  .filter(p => !p.title.toLowerCase().includes('test'))
  .map(p => ({ id: p.id, label: p.title }))
```

### 6. Config Validation Gap Analysis (Round 2 Research)

The pipeline has **NO upfront config validation**. Invalid configs pass through silently and fail at execution time. Here's the complete failure catalog:

#### Model Name Validation
- `AllowedLLMModelType` Zod enum exists in `src/lib/schemas/schemas.ts` (lines 119-127) but is NOT enforced at runtime
- `getModelPricing()` in `src/config/llmPricing.ts` silently returns default pricing for unknown models — NO error
- Invalid model names only fail at API call time (OpenAI returns 400 "model not found")
- Error classified as non-transient → agent fails → run marked failed
- **Fix location**: Add `allowedLLMModelSchema.safeParse()` check in `buildRunConfig()` or `preparePipelineRun()`

#### Budget Validation
- No validation that `budgetCapUsd > 0` — zero/negative causes immediate `BudgetExceededError` on first LLM call
- No validation that `budgetCaps` values are in `[0, 1]` — negative caps never allocate budget
- Empty `budgetCaps {}` → all agents use default 0.20 cap (may be incorrect)
- Division by zero in `tournament.ts:215` if `budgetCapUsd === 0`
- **Fix location**: Validate in `buildRunConfig()` before DB insert

#### enabledAgents Validation
- Zod schema validation in `buildRunConfig()` is **non-blocking** — warns but silently drops invalid agents
- `validateAgentSelection()` exists but is NOT called at queue time — only in UI form
- Dependency violations (e.g., iterativeEditing without reflection) pass through
- Mutex violations (treeSearch + iterativeEditing) pass through
- Invalid agent names silently treated as disabled by `isEnabled()` in supervisor
- **Fix location**: Call `validateAgentSelection()` in `buildRunConfig()` and throw on errors

#### Supervisor Config Validation
- `PoolSupervisor` constructor DOES validate and throws on:
  - `expansionDiversityThreshold` not in `[0, 1]`
  - `expansionMinPool < 5`
  - `maxIterations <= expansionMaxIterations`
  - `maxIterations < expansionMaxIterations + plateauWindow + 1`
- But these throw inside `executeFullPipeline` — AFTER the run is already queued and claimed
- **Fix location**: Run supervisor config validation upfront in `queueEvolutionRunAction`

#### Pipeline Pre-conditions (minimum viable config)
For a run to even start:
1. `originalText.length > 0` (or prompt must generate seed article)
2. `llmClient` or `llmClientId` provided (always true for admin-triggered runs)
3. `maxIterations > expansion.maxIterations + plateau.window + 1`
4. `budgetCapUsd > 0`
5. At least 1 of 3 generation strategies must produce valid output
6. Model names must be valid API model identifiers

#### Recommended: `validateRunConfig()` Function
Create a single validation function that checks all of the above before inserting into DB. Call from `queueEvolutionRunAction` to fail fast with clear error messages. This prevents runs from being queued with known-invalid configs.

### 7. Pre-Submission UI Validation (Round 3 Research)

#### Strategy Data Already Available Client-Side (Just Discarded)
- `getStrategiesAction` uses `SELECT *` — returns **full `StrategyConfigRow[]`** including config JSONB
- StartRunCard at line 175 discards everything: `sRes.data.map(s => ({ id: s.id, label: s.name }))`
- Full config is ~600-800 bytes/row, ~6-8 KB for 10 strategies — already transmitted, just thrown away
- **Fix**: Keep full `StrategyConfigRow` in state instead of `{id, label}`

#### Cost Estimation Already Fires Pre-Submission
- `estimateRunCostAction` fires on strategy selection with 500ms debounce (lines 180-194)
- Returns `{ totalUsd, perAgent, perIteration, confidence }` — already shown in UI
- Budget exceeded warning already exists (lines 303-310): `bg-[var(--status-error)]/10` styled div
- **Opportunity**: Extend this to also return validation warnings, or validate client-side using kept config

#### Existing Validation UI Patterns to Follow
- **Inline errors**: Strategy form uses `text-[var(--status-error)] text-xs font-ui` (lines 338-345)
- **Warning alerts**: `bg-[var(--status-error)]/10 text-[var(--status-error)] px-2 py-1 rounded`
- **Confidence badges**: 3-tier coloring — green `--status-success`, amber `--accent-gold`, gray `--text-muted`
- **Disabled buttons**: `disabled:opacity-50` + disabled condition in JSX
- **No inline field validation exists** — all current errors are toast-only
- **ConfirmDialog component** exists in prompts page (lines 57-102) with `danger` prop for red styling

#### Proposed Client-Side Validation
With full `StrategyConfigRow` in state, validate on selection:
1. **Model names**: Check against `AllowedLLMModelType` enum values (hardcode list client-side or import)
2. **enabledAgents**: Run `validateAgentSelection()` — already a pure function, no server dependency
3. **Iterations**: Check `> 0` and reasonable upper bound
4. **budgetCaps**: Check all values in `[0, 1]`, check required agents have caps
5. Show inline validation warnings between strategy dropdown and budget input
6. Disable "Start Pipeline" button if critical validation errors exist

#### StartRunCard State to Change
Current (9 useState):
- `strategies: { id: string; label: string }[]` — only ID and name

Proposed:
- `strategies: StrategyConfigRow[]` — keep full config
- Add `configWarnings: string[]` — computed from selected strategy
- Modify button disabled: `disabled={submitting || !promptId || !strategyId || configWarnings.some(w => w.critical)}`

### 8. Kill Run Mechanics — Pipeline Execution & Cancellation (Round 4 Research)

The pipeline has **zero in-band cancellation support**. A running pipeline cannot be stopped from the outside without adding new infrastructure.

#### Pipeline Execution Model
- `executeFullPipeline()` (`pipeline.ts` lines 862-1072) is a single monolithic async function
- Sequential loop: `for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++)`
- **No AbortController**, no cancellation signal, no `signal` parameter in `ExecutionContext`
- Stopping conditions are **internal only**: `supervisor.shouldStop()` checks pool state and budget, NOT external status

#### Runner Process Boundaries

| Runner | Blocks? | Heartbeat | Can Detect External Kill? |
|--------|---------|-----------|--------------------------|
| **Cron** (`evolution-runner/route.ts` line 224) | `await executeFullPipeline(...)` — fully blocking | 30s interval | NO |
| **Batch** (`evolution-runner.ts` line 303) | `await Promise.allSettled(batch.map(...))` — blocking | 60s interval | Only between batches (SIGTERM flag) |
| **Inline** (`evolutionActions.ts` line 607) | `await executeFullPipeline(...)` — blocking | Via checkpoint | NO |

#### Checkpoint Writes Are Blind
- `persistCheckpoint()` (`pipeline.ts` lines 28-69) writes to `evolution_checkpoints` and updates `evolution_runs` (iteration, phase, heartbeat, cost)
- Called after **every agent execution** (lines 759, 1025, 1196)
- **Critical gap**: NEVER reads back run status from DB — pipeline continues blindly regardless of external status changes
- 3 retries with exponential backoff on write failure

#### No External Kill Mechanism Exists
- `markRunFailed()` (`pipeline.ts` lines 107-117) is only called **from within** the pipeline on agent errors or from the cron runner on pipeline errors
- Uses `.in('status', ['pending', 'claimed', 'running'])` guard — safe against double-marking
- `markRunPaused()` only called on `BudgetExceededError`
- **No server action, API endpoint, or UI button** triggers these externally

#### LLM Call Interruption
- `llmClient.ts` (lines 49-75): **No AbortSignal** passed to `callLLM()`
- In-flight LLM calls complete and cost tokens even after kill
- Cost is tracked immediately via callback in `callLLM()`

#### Race Conditions Catalog

| Race Condition | Scenario | Impact | Mitigation |
|---------------|----------|--------|------------|
| **Kill during checkpoint** | Kill fires while `persistCheckpoint()` writes | Pool mutation already happened; partial state persisted | Status guard in `markRunFailed` prevents re-update |
| **Kill + watchdog overlap** | Both mark run as 'failed' simultaneously | Second update affects 0 rows (safe) | `.in('status', [...])` guard handles this |
| **Kill on 'claimed' run** | Kill fires before `executeFullPipeline()` starts | Run marked failed; runner starts pipeline on already-failed run | Pipeline should check status at start |
| **Double-kill** | Admin clicks kill twice | First succeeds, second updates 0 rows (safe) | No error thrown on 0-row update |
| **Kill during claim** | Kill fires while `claim_evolution_run()` RPC executes | Depends on timing of atomic claim | `FOR UPDATE SKIP LOCKED` protects claim |

#### Implementation Strategy for Kill
1. **Add status check at iteration loop start** in `executeFullPipeline()` (~line 910): `if (await fetchRunStatus(runId) === 'failed') break;`
2. **Add `killEvolutionRunAction`** server action using `markRunFailed()` pattern
3. **Add "Kill" button** in runs table for `status === 'running' || status === 'claimed'`
4. Pipeline-in-flight LLM calls will still complete (acceptable cost; no AbortSignal plumbing needed)
5. Latency: kill takes effect within 1 iteration cycle (seconds to minutes depending on agent)

### 9. Config Validation — Complete Specification (Round 4 Research)

#### 9.1 Model Name Catalog

**AllowedLLMModelType** (`schemas.ts` lines 119-127):
```
gpt-4o-mini | gpt-4o | gpt-4.1-nano | gpt-4.1-mini | gpt-4.1
gpt-5.2 | gpt-5.2-pro | gpt-5-mini | gpt-5-nano
o3-mini | deepseek-chat | claude-sonnet-4-20250514
```

**LLM Pricing** (`llmPricing.ts` lines 14-75) — all 12 models have pricing entries. No mismatches between schema and pricing table.

**Provider routing** (`llms.ts` lines 133-164):
- `deepseek-*` → DeepSeek API (`api.deepseek.com`)
- `claude-*` → Anthropic API
- Everything else → OpenAI API

**Validation rule**: Both `generationModel` and `judgeModel` must be non-empty strings present in `AllowedLLMModelType` enum.

#### 9.2 Budget Validation Specifics

**CostTracker** (`costTracker.ts` lines 21-43):
- `reserveBudget()` applies 1.3x safety margin on estimated costs
- Default agent cap: `budgetCaps[agent] ?? 0.20` (20% of total)
- Throws `BudgetExceededError` if agent spend + reserved > agent cap × budgetCapUsd

**Tournament division-by-zero** (`tournament.ts` line 215):
```typescript
const budgetPressure = 1 - (ctx.costTracker.getAvailableBudget() / ctx.payload.config.budgetCapUsd);
```
Confirmed: `budgetCapUsd === 0` causes `Infinity` → NaN propagation.

**Adaptive allocation** (`adaptiveAllocation.ts` lines 108-191):
- Budget cap floor: 5% (0.05), ceiling: 40% (0.40)
- After allocation, caps are normalized to sum to 1.0

**Validation rules**:
- `budgetCapUsd > 0` and is finite
- All `budgetCaps` values in `[0, 1]`
- All `budgetCaps` keys must be valid agent names

#### 9.3 Agent Validation Specifics

**Agent classifications** (`budgetRedistribution.ts` lines 7-31):
- REQUIRED (always enabled): `generation`, `calibration`, `tournament`, `proximity`
- OPTIONAL (user toggle): `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`
- SINGLE_ARTICLE_DISABLED: `generation`, `outlineGeneration`, `evolution`

**Dependency map** (`budgetRedistribution.ts` lines 36-42):
```
iterativeEditing → [reflection]
treeSearch → [reflection]
sectionDecomposition → [reflection]
evolution → [tournament]  (always satisfied — required)
metaReview → [tournament]  (always satisfied — required)
```

**Mutex pairs** (`budgetRedistribution.ts` lines 45-47): `treeSearch ↔ iterativeEditing`

**`validateAgentSelection()`** (`budgetRedistribution.ts` lines 132-156): Returns `string[]` of errors. Pure function — can run client-side or server-side.

**Zod schema** (`budgetRedistribution.ts` lines 59-61): `z.array(z.enum([...REQUIRED, ...OPTIONAL])).max(20).optional()`

#### 9.4 Supervisor Config Constraints

**`PoolSupervisor.validateConfig()`** (`supervisor.ts` lines 84-105):
- `expansionDiversityThreshold` must be in `[0, 1]`
- If `expansion.maxIterations > 0`:
  - `expansion.minPool >= 5`
  - `maxIterations > expansion.maxIterations`
  - `maxIterations >= expansion.maxIterations + plateau.window + 1`

**Config extraction** (`supervisor.ts` lines 57-69): `supervisorConfigFromRunConfig()` maps `EvolutionRunConfig` → `SupervisorConfig` for validation.

#### 9.5 Complete Config Field Catalog

| Field | Type | Default | Valid Range | Currently Validated? |
|-------|------|---------|-------------|---------------------|
| `maxIterations` | number | 15 | > expansion.maxIterations + plateau.window | Only in supervisor constructor |
| `budgetCapUsd` | number | 5.00 | > 0, finite | NO |
| `budgetCaps` | Record<string, number> | per-agent 0.05-0.20 | values in [0, 1] | NO |
| `generationModel` | string | 'gpt-4.1-mini' | AllowedLLMModelType enum | NO |
| `judgeModel` | string | 'gpt-4.1-nano' | AllowedLLMModelType enum | NO |
| `enabledAgents` | string[] | undefined | valid agent names | Non-blocking Zod only |
| `singleArticle` | boolean | false | true/false | NO |
| `plateau.window` | number | 3 | >= 1 | Only in supervisor constructor |
| `plateau.threshold` | number | 0.02 | >= 0 | NO |
| `expansion.minPool` | number | 15 | >= 5 | Only in supervisor constructor |
| `expansion.diversityThreshold` | number | 0.25 | [0, 1] | Only in supervisor constructor |
| `expansion.maxIterations` | number | 8 | < maxIterations | Only in supervisor constructor |
| `expansion.minIterations` | number | 3 | > 0 | NO |
| `generation.strategies` | number | 3 | > 0 | NO |
| `calibration.opponents` | number | 5 | > 0 | NO |
| `calibration.minOpponents` | number | 2 | > 0 | NO |
| `tournament.topK` | number | 5 | > 0 | NO |
| `useEmbeddings` | boolean | false | true/false | NO |

#### 9.6 Proposed `validateRunConfig()` Signature
```typescript
function validateRunConfig(config: Partial<EvolutionRunConfig>): { valid: boolean; errors: string[] }
```
- Call from `buildRunConfig()` after building the partial config
- Also call from `preparePipelineRun()` after `resolveConfig()` merges with defaults (validates complete config)
- Return type allows collecting all errors before throwing

### 10. Test Infrastructure — Patterns & Gaps (Round 4 Research)

#### 10.1 Existing Test Files

| File | Lines | Coverage |
|------|-------|----------|
| `src/lib/services/runTriggerContract.test.ts` | 229 | Queue contract: backward compat, prompt/strategy validation, budget defaults |
| `src/lib/services/evolutionActions.test.ts` | 736 | All evolution actions: cost breakdown, history, rollback, runs, cost estimation, trigger errors |
| `src/__tests__/integration/evolution-actions.integration.test.ts` | 548 | Real DB: queue, get runs, apply winner, rollback, cost breakdown, config propagation |

#### 10.2 Supabase Mock Patterns

**Pattern A — Proxy chain** (`runTriggerContract.test.ts` lines 9-31):
- `createQueryChain(result)` returns Proxy that auto-creates methods
- Queue-based: `fromResults` Map shifts results per `.from()` call
- Special `.then()` handling for promise resolution
- Best for: testing multi-step query sequences

**Pattern B — Complete chain mock** (`evolutionActions.test.ts` lines 76-86):
- Pre-creates all common methods (`from`, `select`, `insert`, `update`, `eq`, `single`, etc.)
- All methods return same mock for chaining
- Per-method `mockResolvedValueOnce()` for differentiated responses
- Best for: complex actions with branching query paths

#### 10.3 Server Action Test Setup

Standard mock pattern across all evolution action tests:
```typescript
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: (fn) => fn }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: (fn) => fn }));
```

#### 10.4 Test Helper Infrastructure (`src/testing/utils/evolution-test-helpers.ts`)

| Helper | Purpose |
|--------|---------|
| `NOOP_SPAN` | Mock OTel span |
| `VALID_VARIANT_TEXT` | 300-char valid markdown |
| `evolutionTablesExist()` | Pre-test DB table check |
| `cleanupEvolutionData()` | FK-safe cleanup (children first) |
| `createTestStrategyConfig()` | Insert evolution_strategy_configs row |
| `createTestPrompt()` | Insert evolution_hall_of_fame_topics row |
| `createTestEvolutionRun()` | Insert evolution_runs row |
| `createTestVariant()` | Insert evolution_variants row |
| `createTestCheckpoint()` | Insert evolution_checkpoints row |
| `createTestAgentInvocation()` | Insert evolution_agent_invocations row |
| `createMockEvolutionLLMClient()` | Mock LLM client |
| `createMockEvolutionLogger()` | Mock logger |

#### 10.5 Coverage Gaps (No Tests Exist)

- `buildRunConfig()` — internal helper, no dedicated tests
- Config validation (model names, budgets, agents, supervisor constraints)
- `killEvolutionRunAction` — action doesn't exist yet
- Test-name filtering — feature doesn't exist yet
- Concurrent trigger handling (multiple `triggerEvolutionRunAction` on same run)
- Run lifecycle transitions (pending→claimed→running→completed)

#### 10.6 E2E Test Status
- `admin-evolution.spec.ts` exists but is `describe.skip()` awaiting migrations
- Uses `[data-testid="..."]` convention
- Seeds data with service role key via `getServiceClient()`

### 11. UI Implementation — Exact Patterns & Edge Cases (Round 4 Research)

#### 11.1 StartRunCard State (9 useState hooks)

```typescript
const [promptId, setPromptId] = useState('');
const [strategyId, setStrategyId] = useState('');
const [budget, setBudget] = useState('5.00');
const [submitting, setSubmitting] = useState(false);
const [prompts, setPrompts] = useState<{ id: string; label: string }[]>([]);
const [strategies, setStrategies] = useState<{ id: string; label: string }[]>([]);
const [estimate, setEstimate] = useState<CostEstimateResult | null>(null);
const [estimateLoading, setEstimateLoading] = useState(false);
const [showBreakdown, setShowBreakdown] = useState(false);
```

Data flow: `getStrategiesAction()` → full `StrategyConfigRow[]` → discarded to `{ id, label }[]` at line 175

#### 11.2 Test Name Filtering — False Positive Analysis

**Test fixtures use `test_` prefix pattern** consistently (`evolution-test-helpers.ts` lines 123, 145):
- Strategy names: `test_strategy_${uniqueSuffix}`
- Prompt titles: `Test Prompt ${uniqueSuffix}`

**False positive risk with `includes('test')`**:
- "Attestation" → NO match (contains "tat" not "test")
- "Contest" → NO match (contains "test" but only as substring of "contest") — **WAIT, this IS a match!**
- "Latest" → NO match
- "Protest" → YES match — false positive

**Safer approaches**:
1. `name.toLowerCase().startsWith('test')` — catches "Test Prompt" and "test_strategy" but not "Contest" or "Protest"
2. Word boundary: `/\btest\b/i.test(name)` — only matches "test" as a whole word
3. Prefix convention: `/^(test[_ ]|\[test\])/i.test(name)` — only matches test_ or [test] prefix

**Recommendation**: Use word-boundary regex `/\btest\b/i` for safety, or prefix-based `/^test[_ ]/i` for strictest filtering.

#### 11.3 Kill Button — Exact Implementation Template

Following existing Trigger/Rollback pattern, the kill button should:

**Button JSX** (insert between Trigger and Rollback blocks):
```tsx
{(run.status === 'running' || run.status === 'claimed') && (
  <button
    onClick={() => handleKill(run.id)}
    disabled={actionLoading}
    data-testid={`kill-run-${run.id}`}
    className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
  >
    Kill
  </button>
)}
```

**Handler** (following `handleRollback` pattern):
```tsx
const handleKill = async (runId: string): Promise<void> => {
  if (!confirm('Kill this evolution run? In-flight LLM calls will still complete.')) return;
  setActionLoading(true);
  const result = await killEvolutionRunAction(runId);
  if (result.success) {
    toast.success('Run marked as failed');
    loadRuns();
  } else {
    toast.error(result.error?.message || 'Failed to kill run');
  }
  setActionLoading(false);
};
```

#### 11.4 Validation Warning Pattern

Follows budget exceeded warning (`page.tsx` lines 303-310):
```tsx
{configWarnings.length > 0 && (
  <div className="space-y-1">
    {configWarnings.map((w, i) => (
      <div key={i} className="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-2 py-1 rounded">
        {w}
      </div>
    ))}
  </div>
)}
```

#### 11.5 EvolutionStatusBadge — No "killed" Status

`EvolutionStatusBadge.tsx` only handles existing statuses. Reusing `'failed'` status with a descriptive `error_message` like "Manually killed by admin" avoids any type/schema changes. No new status needed.

#### 11.6 Action Loading Concurrency

Single `actionLoading` boolean prevents ALL concurrent actions. All buttons (Trigger, Rollback, Kill) share `disabled={actionLoading}`. This is by design.

#### 11.7 ConfirmDialog Reuse

`ConfirmDialog` in `prompts/page.tsx` (lines 57-103) is a local component, not shared. For kill confirmation, either:
1. Use `window.confirm()` (consistent with existing Rollback pattern)
2. Extract `ConfirmDialog` to shared component if upgrading UX later

**Recommendation**: Use `window.confirm()` for consistency with existing code.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/README.md
- docs/evolution/architecture.md
- docs/evolution/visualization.md

## Code Files Read
- src/app/admin/quality/evolution/page.tsx (StartRunCard, runs table, action buttons, dropdowns)
- src/lib/services/evolutionActions.ts (queueEvolutionRunAction, triggerEvolutionRunAction, buildRunConfig)
- src/lib/services/promptRegistryActions.ts (getPromptsAction, filter interface)
- src/lib/services/strategyRegistryActions.ts (getStrategiesAction, presets, filter interface)
- src/lib/evolution/core/strategyConfig.ts (StrategyConfig, StrategyConfigRow, hashStrategyConfig)
- src/lib/evolution/core/pipeline.ts (markRunFailed, markRunPaused, status transitions, heartbeat)
- src/lib/evolution/config.ts (resolveConfig, DEFAULT_EVOLUTION_CONFIG, budgetCaps)
- src/lib/evolution/types.ts (EvolutionRunStatus, EvolutionRunConfig)
- src/lib/evolution/core/budgetRedistribution.ts (agent classification, dependencies)
- src/app/api/cron/evolution-watchdog/route.ts (heartbeat detection, stale threshold)
- src/app/api/cron/evolution-runner/route.ts (cron runner, heartbeat updates)
- scripts/evolution-runner.ts (batch runner, claim mechanism)
- src/app/admin/quality/strategies/page.tsx (strategy CRUD form, presets)
- src/app/admin/quality/strategies/strategyFormUtils.ts (formToConfig, rowToForm)
- src/components/evolution/EvolutionStatusBadge.tsx (status colors/styling)
- supabase/migrations/20260131000001_evolution_runs.sql (runs DB schema)
- supabase/migrations/20260205000005_add_evolution_strategy_configs.sql (evolution_strategy_configs schema)
- supabase/migrations/20260207000003_strategy_formalization.sql (is_predefined, pipeline_type)
- src/lib/schemas/schemas.ts (AllowedLLMModelType Zod enum)
- src/config/llmPricing.ts (getModelPricing, model validation gap)
- src/lib/evolution/core/llmClient.ts (LLM client, model routing)
- src/lib/services/llms.ts (provider routing by model prefix)
- src/lib/evolution/core/costTracker.ts (budget reservation, BudgetExceededError)
- src/lib/evolution/core/costEstimator.ts (estimateRunCostWithAgentModels)
- src/lib/evolution/core/adaptiveAllocation.ts (adaptive budget caps)
- src/lib/evolution/core/supervisor.ts (isEnabled, shouldStop, phase config, constructor validation)
- src/lib/evolution/core/validation.ts (state contract validation)
- src/lib/evolution/core/seedArticle.ts (seed article generation for prompt-based runs)
- src/lib/evolution/core/errorClassification.ts (transient vs fatal error classification)
- src/lib/evolution/agents/generationAgent.ts (generation strategies, canExecute)
- src/lib/evolution/agents/calibrationRanker.ts (model from config.judgeModel)
- src/lib/evolution/agents/tournament.ts (budgetPressure division by zero risk)
- src/lib/evolution/core/agentToggle.ts (toggleAgent for UI constraint enforcement)
- src/lib/evolution/index.ts (preparePipelineRun entry point)
- src/lib/evolution/core/costEstimator.ts (RunCostEstimateSchema, estimateRunCostWithAgentModels)
- src/config/llmPricing.ts (getModelPricing, model pricing lookup)
- src/app/admin/quality/prompts/page.tsx (ConfirmDialog pattern, prompt management)
- src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx (accuracy tier coloring)
- src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx (agent enabled/disabled dots)
- src/lib/evolution/core/seedArticle.ts (seed article generation for prompt-based runs)

### Additional Files Read (Round 4)
- src/lib/evolution/core/pipeline.ts (full executeFullPipeline loop, persistCheckpoint, status transitions)
- src/lib/evolution/core/supervisor.ts (validateConfig, shouldStop, supervisorConfigFromRunConfig, guardIterationIdempotency)
- src/lib/evolution/core/budgetRedistribution.ts (REQUIRED/OPTIONAL agents, dependencies, mutex, validateAgentSelection, enabledAgentsSchema)
- src/lib/evolution/core/costTracker.ts (reserveBudget, BudgetExceededError, agent cap logic)
- src/lib/evolution/core/adaptiveAllocation.ts (budget cap bounds, normalization)
- src/lib/evolution/agents/tournament.ts (budgetPressure division-by-zero, pressure tiers)
- src/lib/evolution/core/llmClient.ts (callLLM wrapper, no AbortSignal support)
- src/lib/services/llms.ts (provider routing: deepseek-*, claude-*, default OpenAI)
- scripts/evolution-runner.ts (batch runner, Promise.allSettled, SIGTERM handling)
- src/lib/services/evolutionActions.test.ts (unit test patterns, chain mock, mock setup)
- src/lib/services/runTriggerContract.test.ts (proxy chain mock, queue-based mocking)
- src/__tests__/integration/evolution-actions.integration.test.ts (real DB tests, cleanup patterns)
- src/testing/utils/evolution-test-helpers.ts (factories, mocks, cleanup utilities)
- src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts (E2E patterns, data-testid convention)
- src/app/admin/quality/prompts/page.tsx (ConfirmDialog component pattern)
- src/lib/evolution/core/featureFlags.ts (FLAG_MAP, agent feature flags)
