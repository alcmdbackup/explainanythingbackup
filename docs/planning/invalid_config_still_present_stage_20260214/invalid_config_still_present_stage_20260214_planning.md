# Invalid Config Still Present Stage Plan

## Background
Fix invalid evolution pipeline configuration that persists in the staging environment. The project will audit all evolution config values in staging, identify invalid or stale configuration, and fix or remove problematic values to ensure the evolution pipeline operates correctly.

## Requirements (from GH Issue #439)
- Audit all evolution config values in staging, identify invalid ones, fix or remove them
- Specifically: "Start Pipeline" with a basic "light" strategy in staging is broken — the configuration is invalid somehow
- Add ability to mark zombie runs (stuck in "running" but actually dead) as dead/failed and kill them
- Filter out any prompts and strategies with "test" in their names from the "Start Pipeline" dropdown menus

## Problem

The evolution admin dashboard has three gaps that prevent reliable pipeline operation:

1. **No config validation** — `buildRunConfig()` silently drops invalid fields and `resolveConfig()` merges with defaults without checking. Invalid model names, zero budgets, and agent dependency violations pass through to execution time, where they cause cryptic failures. The "light" strategy in staging is a user-created entry with likely-invalid model names or budgetCaps that only fail at API call time.

2. **No kill mechanism** — When a pipeline run gets stuck (zombie), the only recovery is the watchdog cron which checks every 15 min with a 10-min heartbeat threshold. There is no manual kill action, no UI button, and the pipeline's `executeFullPipeline()` loop never checks external status between iterations. Admins must wait up to 25 minutes for zombie cleanup.

3. **Test data pollution** — Test prompts/strategies created during development appear in the "Start Pipeline" dropdowns alongside production data. No filtering mechanism exists — both `getPromptsAction` and `getStrategiesAction` return all active, non-deleted entries.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Kill mechanism | Iteration-level status check | Add `fetchRunStatus()` at top of each iteration in `executeFullPipeline()`. Responsive (seconds-minutes vs 10-min watchdog). Reuse `'failed'` status with `error_message: "Manually killed by admin"` — no schema changes. |
| Test filtering | `includes('test')` | Simplest approach. May false-positive on "Contest"/"Protest" but these are unlikely prompt/strategy names. Applied client-side in StartRunCard only — admin management pages still show everything. |
| Config validation | Server-side `validateRunConfig()` + client-side inline warnings | Server-side catches invalid configs at queue time. Client-side keeps full `StrategyConfigRow` in state and shows inline warnings on strategy selection. Best UX — admins see problems before submitting. |
| Kill status | Reuse `'failed'` | No new status type, no migration, no EvolutionStatusBadge changes. Descriptive `error_message` distinguishes manual kill from pipeline failure. |
| Confirmation UX | `window.confirm()` | Consistent with existing Rollback handler. `ConfirmDialog` component exists but is local to prompts page — not worth extracting for one button. |

## Phased Execution Plan

### Phase 1: Kill Run — Server Action + Pipeline Check

**Goal**: Admins can kill zombie runs from the UI, and the pipeline stops within one iteration.

#### Step 1.1: `killEvolutionRunAction` server action
**File**: `src/lib/services/evolutionActions.ts`

Add a new server action following the existing pattern:
- `requireAdmin()` guard
- Validate run exists and `status IN ('pending', 'claimed', 'running')`
- Perform direct Supabase update (do NOT call `markRunFailed()` — that's an internal pipeline helper tightly coupled to pipeline context). Instead:
  ```typescript
  const { data, error } = await supabase.from('content_evolution_runs').update({
    status: 'failed',
    error_message: 'Manually killed by admin',
    completed_at: new Date().toISOString(),
  }).eq('id', runId).in('status', ['pending', 'claimed', 'running']).select().single();
  ```
- Return `{ success, data, error }` envelope
- Log via `logAdminAction()` for audit trail

**File**: `src/lib/services/auditLog.ts`

Add `'kill_evolution_run'` to the `AuditAction` type union (line 16-28). No other type changes needed — `EntityType` already has `'evolution_run'`.

#### Step 1.2: Pipeline kill detection — 3 checkpoints
**File**: `src/lib/evolution/core/pipeline.ts`

Three changes ensure a kill is detected at every stage:

**1.2a: Guard the `claimed → running` transition** (~line 877)

The current code unconditionally sets `status: 'running'`. If a kill fires between claim and pipeline start, this overwrites the `'failed'` status. Add a status guard:
```typescript
// Before:
await supabase.from('content_evolution_runs').update({
  status: 'running', ...
}).eq('id', runId);

// After:
const { count } = await supabase.from('content_evolution_runs').update({
  status: 'running',
  started_at: new Date().toISOString(),
  pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
}).eq('id', runId).in('status', ['claimed']).select('id', { count: 'exact', head: true });
if (count === 0) {
  logger.info('Run was killed before pipeline started — aborting');
  return { stopReason: 'killed' };
  // Note: callers must handle missing `supervisorState` — update return type to
  // `Promise<{ stopReason: string; supervisorState?: SupervisorResumeState }>`
  // (make supervisorState optional). Callers already null-check it.
}
```

**1.2b: Status check at top of each iteration** (~line 910, AFTER `startNewIteration()` at 911, BEFORE `supervisor.beginIteration()` at 915):
```typescript
// Check if run was externally killed
const { data: statusCheck } = await supabase
  .from('content_evolution_runs')
  .select('status')
  .eq('id', runId)
  .single();
if (statusCheck?.status === 'failed') {
  stopReason = 'killed';
  logger.info('Run was externally killed — stopping pipeline');
  break;
}
```
This costs 1 DB read per iteration (~15 per run) — negligible overhead. If the DB read fails (network error), the error propagates to the catch block which calls `markRunFailed()` — fail-safe behavior.

**1.2c: Guard the completion update** (~line 1033)

After the loop, the current code unconditionally sets `status: 'completed'`. If the loop exited due to kill, this overwrites `'failed'`. Add a status guard:
```typescript
// Before:
await supabase.from('content_evolution_runs').update({
  status: 'completed', ...
}).eq('id', runId);

// After:
if (stopReason !== 'killed') {
  await supabase.from('content_evolution_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_variants: ctx.state.getPoolSize(),
    variants_generated: ctx.state.getPoolSize(),
    total_cost_usd: totalCost,
    error_message: stopReason === 'completed' ? null : stopReason,
  }).eq('id', runId).in('status', ['running']);
}
```

The `.in('status', ['running'])` guard provides defense-in-depth — even without the `if` check, a run already in `'failed'` status won't be overwritten. Skip `finalizePipelineRun()` for killed runs (no summary/metrics for partial runs).

**Note on catch-block interaction**: If an agent throws AFTER the kill check passes but before the next iteration, the catch block calls `markRunFailed()`. Since `markRunFailed()` already has `.in('status', ['pending', 'claimed', 'running'])`, and the run is already `'failed'` (from the kill), this is a no-op at the DB level. The original kill attribution (`error_message: 'Manually killed by admin'`) is preserved. This is acceptable behavior — the catch-block error is logged at ERROR level but does not corrupt the kill record.

#### Step 1.3: Kill button in runs table
**File**: `src/app/admin/quality/evolution/page.tsx`

Add between Trigger and Rollback buttons:
- Visible when `run.status === 'running' || run.status === 'claimed'`
- `window.confirm('Kill this evolution run? In-flight LLM calls will still complete.')`
- `data-testid={`kill-run-${run.id}`}`
- Styling: `text-[var(--status-error)] hover:underline text-xs disabled:opacity-50`
- Handler follows `handleTrigger`/`handleRollback` pattern with `actionLoading` guard

#### Step 1.4: Kill action tests
**File**: `src/lib/services/evolutionActions.test.ts` (extend existing)

Use Pattern B (complete chain mock via `createChainMock()`) for consistency with the existing file.

Test cases:
- Kill a running run → success, status becomes 'failed', **assert `error_message === 'Manually killed by admin'`**
- Kill a completed run → error (status guard rejects, 0 rows updated)
- Kill a failed run → error (already failed)
- Kill a pending run → success (pre-execution kill)
- Kill a claimed run → success
- **Assert `logAdminAction` was called** with `{ action: 'kill_evolution_run', entityType: 'evolution_run', entityId: runId }`

#### Step 1.5: Pipeline kill detection tests
**File**: `src/lib/evolution/core/pipeline.test.ts` (new or extend existing)

These test the 3 checkpoints added in Step 1.2. Mock Supabase to control status reads.

Test cases:
- **1.2a guard**: When status is 'failed' before pipeline starts → returns `{ stopReason: 'killed' }`, does NOT set status='running'
- **1.2b iteration check**: When status read returns 'failed' mid-loop → loop breaks, stopReason='killed'
- **1.2b error path**: When status read throws (DB error) → error propagates to catch block → run marked failed (fail-safe)
- **1.2b happy path**: When status read returns 'running' → loop continues normally
- **1.2c completion guard**: When stopReason='killed' → completion update is skipped, finalizePipelineRun is NOT called

---

### Phase 2: Test Name Filtering

**Goal**: Prompts/strategies with "test" in their name don't appear in StartRunCard dropdowns.

#### Step 2.1: Filter dropdowns in StartRunCard
**File**: `src/app/admin/quality/evolution/page.tsx`

In the loading `useEffect` (~line 172-175), add filter before mapping:
```typescript
setPrompts(
  pRes.data
    .filter(p => !p.title.toLowerCase().includes('test'))
    .map(p => ({ id: p.id, label: p.title }))
);
setStrategies(
  sRes.data
    .filter(s => !s.name.toLowerCase().includes('test'))
    .map(s => ({ id: s.id, label: s.name }))
);
```

Client-side only. Admin management pages (`/admin/quality/prompts`, `/admin/quality/strategies`) are NOT affected — they still show all entries for management purposes.

#### Step 2.2: Tests
**File**: `src/lib/evolution/core/configValidation.test.ts` (co-located with the validation module)

Extract filter predicate to a named helper in `configValidation.ts` (not in the `'use client'` page — Jest can't easily import from those):
```typescript
export function isTestEntry(name: string): boolean {
  return name.toLowerCase().includes('test');
}
```

Test cases:
- "test_strategy" → filtered
- "Test Prompt" → filtered
- "Economy" → kept
- "Contest" → filtered (accepted false positive)
- "" (empty string) → kept
- "TESTING" → filtered

---

### Phase 3: Config Validation — Server-Side

**Goal**: Invalid configs are rejected at queue time with clear error messages.

#### Step 3.1: Two validation functions
**File**: `src/lib/evolution/core/configValidation.ts` (new file)

**Important constraint**: This file must be a pure module (no Node.js-only imports like `createSupabaseServiceClient`) because it will be imported by both server code and `'use client'` components.

Two functions are needed because `StrategyConfig` and `EvolutionRunConfig` are different types — `StrategyConfig` has `iterations` (not `maxIterations`), lacks nested `plateau`/`expansion`/`generation`/`calibration`/`tournament` objects, and lacks `budgetCapUsd`/`useEmbeddings`:

```typescript
/** Validates a StrategyConfig (from strategy_configs table, used client-side). */
export function validateStrategyConfig(
  config: StrategyConfig
): { valid: boolean; errors: string[] }

/** Validates a complete EvolutionRunConfig (after resolveConfig merges defaults, used server-side). */
export function validateRunConfig(
  config: EvolutionRunConfig
): { valid: boolean; errors: string[] }
```

**`validateStrategyConfig()`** checks (fields available in StrategyConfig):
1. **Model names**: `generationModel` and `judgeModel` must be in `AllowedLLMModelType` enum
2. **Budget caps**: All `budgetCaps` values in `[0, 1]`, all keys must be in the valid set (REQUIRED_AGENTS + OPTIONAL_AGENTS + unmanaged keys like `'pairwise'` and `'flowCritique'` which appear in `DEFAULT_EVOLUTION_CONFIG.budgetCaps` but are NOT in `AgentName`). Build the valid key set from DEFAULT_EVOLUTION_CONFIG.budgetCaps keys, not from AgentName.
3. **Agent selection**: If `enabledAgents` provided, call `validateAgentSelection()` (from `budgetRedistribution.ts`)
4. **Iterations**: `iterations > 0`

**`validateRunConfig()`** checks everything in `validateStrategyConfig()` PLUS (fields only available after `resolveConfig()`):
1. **Budget total**: `budgetCapUsd > 0` and is finite
2. **Supervisor constraints**: If `expansion.maxIterations > 0`:
   - `expansion.minPool >= 5`
   - `maxIterations > expansion.maxIterations`
   - `maxIterations >= expansion.maxIterations + plateau.window + 1`
   - `expansion.diversityThreshold` in `[0, 1]`
3. **Nested object bounds**: `plateau.window >= 1`, `plateau.threshold >= 0`, `generation.strategies > 0`, `calibration.opponents > 0`, `tournament.topK > 0`

Both return all errors (don't short-circuit) so admins see everything at once.

#### Step 3.2: Integrate into queue pipeline — two validation points

**Point A — Strategy-level validation (admin queue path only)**
**File**: `src/lib/services/evolutionActions.ts`

In `buildRunConfig()` (~line 314, after building partial config), call `validateStrategyConfig()` on the strategy's config. This catches obviously invalid strategies before inserting a run into DB. Throw with joined error messages — `queueEvolutionRunAction`'s catch block returns `{ success: false, error }` to the client.

**Point B — Complete config validation (ALL entry points)**
**File**: `src/lib/evolution/index.ts` (inside `preparePipelineRun()`)

After `resolveConfig()` merges overrides with defaults, call `validateRunConfig()` on the complete config. This catches combinations that are individually valid but fail together (e.g., maxIterations too low relative to expansion.maxIterations).

**Why `index.ts` specifically**: Two production paths call `preparePipelineRun()`:
1. `triggerEvolutionRunAction` in `evolutionActions.ts` → inline trigger (admin)
2. Cron runner (`evolution-runner/route.ts`) → picks up pending runs

Only path 1 goes through `buildRunConfig()`. Path 2 reads config from DB and passes it directly to `preparePipelineRun()`. Placing validation in `index.ts` ensures BOTH paths are covered. (The batch runner script `scripts/evolution-runner.ts` also exists for local dev but is not a production entry point.)

#### Step 3.3: Tests
**File**: `src/lib/evolution/core/configValidation.test.ts` (new file)

**`validateStrategyConfig()` tests**:
- Valid Economy/Balanced/Quality preset config → passes
- Invalid `generationModel` → error with model name in message
- Invalid `judgeModel` → error
- Empty string model → error
- `budgetCaps` value > 1 → error
- `budgetCaps` value < 0 → error
- `budgetCaps` key is not a valid agent name → error
- Agent dependency violation (iterativeEditing without reflection) → error
- Agent mutex violation (treeSearch + iterativeEditing) → error
- `iterations <= 0` → error
- Multiple simultaneous errors → all returned in single result

**`validateRunConfig()` tests** (complete config, after resolveConfig):
- Valid DEFAULT_EVOLUTION_CONFIG → passes
- `budgetCapUsd === 0` → error (division-by-zero prevention)
- `budgetCapUsd < 0` → error
- `budgetCapUsd === Infinity` → error
- `maxIterations <= expansion.maxIterations` → error
- `maxIterations < expansion.maxIterations + plateau.window + 1` → error
- `expansion.minPool < 5` (when expansion enabled) → error
- `expansion.diversityThreshold > 1` → error
- `plateau.window < 1` → error
- `plateau.threshold < 0` → error
- `generation.strategies <= 0` → error
- `calibration.opponents <= 0` → error
- `tournament.topK <= 0` → error
- Expansion disabled (`expansion.maxIterations === 0`) → skip expansion constraints

---

### Phase 4: Config Validation — Client-Side Warnings

**Goal**: StartRunCard shows inline validation warnings when a problematic strategy is selected.

#### Step 4.1: Keep full strategy data in state
**File**: `src/app/admin/quality/evolution/page.tsx`

Change StartRunCard state:
```typescript
// Before:
const [strategies, setStrategies] = useState<{ id: string; label: string }[]>([]);

// After:
const [strategies, setStrategies] = useState<StrategyConfigRow[]>([]);
```

Update loading `useEffect` to keep full rows (still apply test-name filter):
```typescript
setStrategies(sRes.data.filter(s => !s.name.toLowerCase().includes('test')));
```

Update dropdown rendering to use `s.id` and `s.name` from the full row.

#### Step 4.2: Client-side validation on strategy selection
**File**: `src/app/admin/quality/evolution/page.tsx`

Add `configWarnings` computed state. When `strategyId` changes:
1. Find selected strategy's config from full `StrategyConfigRow`
2. Run `validateStrategyConfig()` on the strategy's `.config` field (import from `configValidation.ts` — this is the StrategyConfig-shaped function, NOT `validateRunConfig()` which expects the full resolved config)
3. Set `configWarnings: string[]` from validation errors

#### Step 4.3: Inline warning UI
**File**: `src/app/admin/quality/evolution/page.tsx`

Render between strategy dropdown and budget input, following budget-exceeded pattern:
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

Disable "Start Pipeline" button when critical warnings exist:
```typescript
disabled={submitting || !promptId || !strategyId || configWarnings.length > 0}
```

#### Step 4.4: Tests
- `validateRunConfig()` is already tested in Phase 3
- Client-side rendering can be verified via E2E tests if un-skipped
- Manual verification: select a strategy with known-invalid config in staging, confirm warnings appear

---

### Phase 5: Staging Audit & Cleanup

**Goal**: Identify and fix/remove the invalid "light" strategy and any other problematic configs.

#### Step 5.1: Audit staging strategy_configs
Query staging DB for all active strategies. For each, run `validateRunConfig()` against its config and report errors. Identify the "light" strategy specifically.

#### Step 5.2: Fix or archive invalid strategies
- If "light" strategy has fixable issues (e.g., wrong model name), update config
- If fundamentally broken, set `status: 'archived'` so it stops appearing in dropdowns
- Clean up any zombie runs (status='running' with stale heartbeats)

#### Step 5.3: Verify
- Confirm "Start Pipeline" works with Economy/Balanced/Quality presets
- Confirm "light" strategy either works or is archived
- Confirm no test-named entries appear in dropdowns

## Testing

### Unit Tests (Jest)
| Test File | What It Tests |
|-----------|--------------|
| `evolutionActions.test.ts` (extend) | `killEvolutionRunAction`: 6 cases including error_message assertion + audit log assertion |
| `pipeline.test.ts` (new/extend) | Kill detection: claimed→running guard, iteration check, completion guard, DB error fail-safe |
| `configValidation.test.ts` (new) | `validateStrategyConfig()`: 11 cases covering models, budgetCaps, agents, iterations |
| `configValidation.test.ts` (new) | `validateRunConfig()`: 14 cases covering all 18 config fields + supervisor constraints |
| `configValidation.test.ts` (new) | `isTestEntry()`: filter predicate edge cases |

### Integration Tests
| Test File | What It Tests |
|-----------|--------------|
| `evolution-actions.integration.test.ts` (extend) | Kill action with real DB: status transition, error_message, completed_at |
| `evolution-actions.integration.test.ts` (extend) | Queue with invalid config → rejected with validation error |

### Manual Verification (Staging)
- [ ] Kill a running/claimed run → status becomes 'failed', pipeline stops
- [ ] Start Pipeline dropdowns don't show test-named entries
- [ ] Select strategy with invalid config → inline warnings appear, button disabled
- [ ] Queue with valid config → run starts successfully
- [ ] "light" strategy is fixed or archived

## Rollback Plan

Each phase is independently revertable:

| Phase | Rollback Strategy |
|-------|-------------------|
| **1 (Kill)** | Revert `pipeline.ts` status checks (pipeline resumes ignoring external kills). Revert `evolutionActions.ts` kill action. Remove UI button. No DB changes to revert. |
| **2 (Filtering)** | Revert the `filter()` calls in `page.tsx` useEffect. Test entries reappear in dropdowns. |
| **3 (Server validation)** | Remove `validateRunConfig()` and `validateStrategyConfig()` calls from `buildRunConfig()` and `index.ts`. Invalid configs pass through again (status quo). |
| **4 (Client warnings)** | Revert `page.tsx` state from `StrategyConfigRow[]` back to `{ id, label }[]`. Remove warning UI. |
| **5 (Staging audit)** | If a strategy was archived incorrectly, set `status: 'active'` in DB. If zombie runs were killed incorrectly, they're already in terminal state (no undo, but no data lost). |

All code changes are on a feature branch. If the entire feature needs reverting after merge, revert the merge commit. No migrations or schema changes are involved — rollback is purely code.

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `src/lib/services/evolutionActions.ts` | Add `killEvolutionRunAction`, integrate `validateStrategyConfig()` in `buildRunConfig()` | 1, 3 |
| `src/lib/services/auditLog.ts` | Add `'kill_evolution_run'` to `AuditAction` type | 1 |
| `src/lib/evolution/core/pipeline.ts` | 3 kill checkpoints: claimed→running guard, iteration status check, completion guard | 1 |
| `src/lib/evolution/index.ts` | Add `validateRunConfig()` call in `preparePipelineRun()` after `resolveConfig()` | 3 |
| `src/app/admin/quality/evolution/page.tsx` | Kill button, test filtering, strategy state change, validation warnings | 1, 2, 4 |
| `src/lib/evolution/core/configValidation.ts` | New file: `validateStrategyConfig()`, `validateRunConfig()`, `isTestEntry()` | 2, 3 |
| `src/lib/evolution/core/configValidation.test.ts` | New file: validation tests, filter predicate tests | 2, 3 |
| `src/lib/evolution/core/pipeline.test.ts` | New/extend: kill detection tests (3 checkpoints) | 1 |
| `src/lib/services/evolutionActions.test.ts` | Extend: kill action tests with error_message + audit assertions | 1 |

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/README.md` — Add note about config validation and kill mechanism
- `docs/evolution/architecture.md` — Document iteration-level status check in pipeline loop
