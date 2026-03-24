# Ensure Detailed Logging Evolution Plan

## Background
Ensure that all evolution entities — experiments, strategies, runs, and invocations — have as detailed logs as possible. PR #792 (evolution_logs_refactor_20260322) established the entity logger infrastructure, LogsTab UI, and denormalized evolution_logs table. This project builds on that foundation to maximize logging coverage and detail across the entire pipeline.

## Requirements (from GH Issue #798)
- Ensure all entities (experiments, strategies, runs, invocations) have maximally detailed logs
- Build on PR #792's EntityLogger infrastructure and evolution_logs table
- Cover all lifecycle events, state transitions, errors, and performance metrics at every entity level

## Problem
The evolution pipeline currently has only 52 structured EntityLogger calls across ~17 files, leaving ~100+ critical events unlogged. The evolve phase has zero logging. Individual comparisons during ranking (10-50+ per iteration), per-strategy generation details, cost/budget events, and many error paths are invisible. Status transitions (e.g., run→running, experiment draft→running) happen silently. Console.warn calls in infrastructure code bypass the structured logging system entirely. Operators cannot trace detailed pipeline behavior through the LogsTab UI because most events never reach the evolution_logs table.

## Options Considered

### Option A: Add logging at call sites only (no signature changes)
- **Pro**: Zero test impact; fastest to ship
- **Con**: Cannot log inside ranking internals (executeTriage, executeFineRanking) or infrastructure (costTracker, LLM client) because loggers aren't available in those scopes
- **Verdict**: Insufficient for "maximally detailed" requirement

### Option B: Thread logger through all functions via optional params
- **Pro**: Full coverage at every level; all params optional so backward-compatible
- **Con**: ~6 exported + ~7 internal function signature changes; ~39 test call sites affected (but all optional params)
- **Verdict**: **Selected** — achieves max detail with acceptable effort

### Option C: Wrap functions in logging decorators / middleware
- **Pro**: No manual log calls; automatic entry/exit logging
- **Con**: Loses context-specific messages; TypeScript decorators experimental; doesn't capture decision logic (e.g., elimination reasons)
- **Verdict**: Rejected — too generic for the detailed, context-rich logging needed

### Option D: Add batching to EntityLogger for high-volume phases
- **Pro**: Reduces DB roundtrips from ~370 to ~7 per run
- **Con**: Adds complexity; 2-5s log visibility delay; current volume (~370/run, 407KB) is well within limits
- **Verdict**: Deferred — implement only if >10 parallel runs cause connection pool issues

## Sensitive Data Logging Policy

**NEVER log** the following in EntityLogger context or messages:
- Full prompt text or LLM response text (log char counts only: `promptChars`, `responseChars`)
- API keys, tokens, or credentials
- Raw error messages longer than 500 characters (truncate with `error.message.slice(0, 500)`)
- Full variant text content (log content length only)
- User-identifiable information
- Stack traces (may leak file paths, internal function names, and variable values)

**Safe to log**: IDs (run, variant, strategy, experiment), numeric metrics (mu, sigma, cost, confidence), counts, phase names, strategy names, iteration numbers.

## Rollback & Safety

**Runtime kill switch**: If logging causes performance issues:
1. **EVOLUTION_LOG_LEVEL env var** (must be implemented as Phase 0 prerequisite, ~10 LOC): Add level filtering to `createEntityLogger.ts` — check `process.env.EVOLUTION_LOG_LEVEL` at logger creation time. If set to `'warn'`, skip `info()` and `debug()` calls (return early without DB write). If set to `'error'`, skip `info()`, `debug()`, and `warn()`. Default behavior (unset): log all levels as today. Implementation: add a `minLevel` check at the top of the internal `log()` function (line 38 of createEntityLogger.ts).
2. All log calls already use `logger?.info(...)` (optional chaining) — passing `undefined` as logger disables all logging with zero code changes
3. If sustained log failures are detected (e.g., DB connectivity loss), EntityLogger already swallows errors via fire-and-forget — pipeline execution is never blocked

**Revert strategy**: Each phase is an independent commit. Reverting any single phase's commit restores the previous logging level without affecting other phases.

**Monitoring**: After deployment, verify log volume per run via:
```sql
SELECT run_id, count(*) FROM evolution_logs WHERE run_id = '<id>' GROUP BY run_id;
```

## Phased Execution Plan

### Phase 0: Kill Switch Implementation (~15 LOC, 1 file, 1 sig change)

**Files**: `createEntityLogger.ts`

**Prerequisite for all subsequent phases.** Add `EVOLUTION_LOG_LEVEL` env var support to `createEntityLogger.ts`:
- At the top of the internal `log()` function (line 38), check `process.env.EVOLUTION_LOG_LEVEL`
- Level hierarchy: `debug < info < warn < error`
- If env var is set (e.g., `'warn'`), skip DB writes for levels below the threshold
- Default (unset): log all levels (preserves current behavior)

```typescript
const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LOG_LEVELS[process.env.EVOLUTION_LOG_LEVEL ?? ''] ?? 0;
// Inside log(): if (LOG_LEVELS[level]! < minLevel) return;
```

**Tests**: Add 3 tests to `createEntityLogger.test.ts`:
1. Verify info is skipped when `EVOLUTION_LOG_LEVEL=warn`
2. Verify warn still logs when `EVOLUTION_LOG_LEVEL=warn`
3. Verify all levels log when env var is unset (default)

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 1: Run-Level Detailed Logging (~80 LOC, 1 sig change (executePhase), 0 test updates)

**Files**: `runIterationLoop.ts`, `claimAndExecuteRun.ts`

**claimAndExecuteRun.ts (executePipeline function, starts line 162)** — Add run lifecycle logs. Note: `runLogger` (EntityLogger) is only available AFTER `buildRunContext()` returns at line 181. Pre-context logs use the server-side `logger` (from `@/lib/server_utilities`); post-context logs use `runLogger`:
- After line 172 (status→running): `logger.info('Run status set to running', { runId })` — **server logger** (runLogger not yet available)
- Before line 175: `logger.info('Building run context', { runId })` — **server logger**
- After line 181 (context built): `runLogger.info('Run context built', { initialPoolSize, phaseName: 'setup' })` — **EntityLogger** (now available)
- Before line 183: `runLogger.info('Starting evolution loop', { config summary, phaseName: 'loop' })` — **EntityLogger**
- After line 188: `runLogger.info('Evolution loop completed', { stopReason, iterations, cost, poolSize, phaseName: 'loop' })` — **EntityLogger**
- Before line 191: `runLogger.info('Starting finalization', { phaseName: 'finalize' })` — **EntityLogger**
- After line 196: `runLogger.info('Finalization completed', { phaseName: 'finalize' })` — **EntityLogger**

**runIterationLoop.ts** — Add iteration-level logs using existing `logger` param:
- After line 43 (validateConfig): Log config validation success with all config values `{ phaseName: 'config_validation' }`
- Before each validation throw (lines 23-41): Log validation error with field/value `{ phaseName: 'config_validation' }`
- After line 152 (baseline added): Log baseline variant `{ variantId, poolSize, phaseName: 'initialization' }`
- After line 161 (initial pool loaded): Log initial pool entries `{ entriesLoaded, poolSize, phaseName: 'initialization' }`
- After line 170 (kill detected): Log kill detection `{ iteration, phaseName: 'loop' }`
- After generation result: Log variant count, pool size `{ iteration, phaseName: 'generation' }`
- After ranking result: Log match count, top-5 mu values `{ iteration, phaseName: 'ranking' }`
- At convergence (line 222): Log convergence with mu values `{ iteration, phaseName: 'convergence' }`
- At budget exceeded: Log with total spent `{ iteration, totalSpent, phaseName: 'budget' }`
- After winner determination (line 246): Log winner ID, mu, sigma `{ phaseName: 'winner_determination' }`
- Before return: Log evolution summary `{ stopReason, iterations, poolSize, totalCost, winnerId, phaseName: 'evolution_complete' }`

**executePhase()** — Add optional `logger?: EntityLogger` param and phase result logging. Note: `executePhase` is exported and used in tests, but the param is optional so no existing tests break:
- Add `logger?: EntityLogger` as final optional parameter
- After line 91 (success): `logger?.info('Phase completed', { phaseName, costUsd: cost, totalSpent: costTracker.getTotalSpent() })`
- After line 96 (partial budget): `logger?.warn('Phase budget exceeded (partial)', { phaseName, partialVariantCount: error.partialVariants?.length ?? 0 })`
- After line 100 (full budget): `logger?.warn('Phase budget exceeded', { phaseName, costUsd: cost })`
- Before line 103 (rethrow): `logger?.error('Phase failed', { phaseName, errorType: error?.constructor?.name, errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500) })`
- Call site updates in evolveArticle: pass invocation logger to `executePhase(..., genLogger)` and `executePhase(..., rankLogger)`

**Tests**: No updates needed — all logger params already optional, existing mocks unchanged.

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 2: Ranking Internals Logging (~150 LOC, 4 internal sig changes)

**Files**: `rankVariants.ts` only (NO changes to `computeRatings.ts` — shared module boundary preserved)

**Design decision**: `computeRatings.ts` lives in `evolution/src/lib/shared/` and is a domain-agnostic module (pure rating math, comparison logic, cache). Adding an EntityLogger dependency would violate its module boundary. Instead, all comparison-level logging is done in `runComparison()` within `rankVariants.ts`, which has access to the `ComparisonResult` return value from `compareWithBiasMitigation()` and can log winner, confidence, and cache status without modifying the shared module.

**Signature changes** (all internal/non-exported, within rankVariants.ts only):
1. `executeTriage()` — add `logger?: EntityLogger` as final optional param
2. `executeFineRanking()` — add `logger?: EntityLogger` as final optional param
3. `makeCompareCallback()` — add `logger?: EntityLogger` as final optional param
4. `runComparison()` — add `logger?: EntityLogger` as final optional param

**rankPool()** — Thread logger to children:
- After line 565: Log budget tier selection `{ tier, budgetFraction, maxComparisons, phaseName: 'ranking' }`
- Line 567: Pass logger to `makeCompareCallback(llm, config, undefined, logger)`
- Line 584: Pass logger to `executeTriage(..., logger)`
- Line 601: Pass logger to `executeFineRanking(..., logger)`

**executeTriage()** — Per-entrant logging:
- After entrant loop start: Log triage start per entrant `{ entrantId, opponents, phaseName: 'ranking' }` at debug level
- After each comparison (via runComparison return): Log result `{ entrantId, oppId, confidence, result, phaseName: 'ranking' }` at debug level
- At elimination: Log elimination reason `{ entrantId, muPlusSigma, cutoff, phaseName: 'ranking' }` at info level
- At early exit: Log decisive count and avg confidence `{ entrantId, decisiveCount, avgConfidence, phaseName: 'ranking' }` at info level
- Failed comparison (confidence=0): Log warning `{ entrantId, oppId, consecutiveErrors, phaseName: 'ranking' }`

**executeFineRanking()** — Swiss round logging:
- At round start: Log round number, eligible count, pairs `{ round, eligible, pairs, totalComparisons, phaseName: 'ranking' }` at debug level
- After each comparison (via runComparison return): Log result at debug level `{ idA, idB, confidence, result, phaseName: 'ranking' }`
- Failed comparison (confidence=0): Log warning `{ idA, idB, phaseName: 'ranking' }`
- At convergence: Log convergence signal `{ round, convergedCount, eligibleCount, phaseName: 'ranking' }` at info level

**runComparison()** — Comparison-level logging (replaces proposed computeRatings.ts changes):
- After `compareWithBiasMitigation()` returns: `logger?.debug('Comparison result', { idA, idB, winner: result.winner, confidence: result.confidence, phaseName: 'ranking' })`
- This captures bias-mitigation results (forward/reverse agreement, cache status) from the return value without modifying the shared module

**makeCompareCallback()** — Error logging:
- In catch block (line 166): `logger?.warn('LLM comparison failed', { attempt: errorCounter?.count, phaseName: 'ranking' })`

**Tests**: Add ~8 new test cases to `rankVariants.test.ts` verifying logger calls. No changes to `computeRatings.comparison.test.ts` (module boundary preserved).

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 3: Experiment + Strategy Service Logging (~100 LOC, 0 sig changes)

**Files**: `experimentActionsV2.ts`, `strategyRegistryActionsV2.ts`, `evolutionActions.ts`, `manageExperiments.ts`

**experimentActionsV2.ts** — Follow existing createEntityLogger pattern:
- `addRunToExperimentAction`: Create expLogger, log "Run added to experiment" `{ runId }`
- `createExperimentWithRunsAction` catch block: Log batch failure `{ error, createdRunCount, experimentId }`
- `createExperimentAction`: Enrich existing log with `{ name, promptId }`
- `cancelExperimentAction`: Enrich existing log with `{ experimentId }`

**strategyRegistryActionsV2.ts** — Add logging to unlogged write actions:
- `updateStrategyAction`: Create stratLogger, log "Strategy updated" `{ updatedFields }`
- `deleteStrategyAction`: Create stratLogger, log "Strategy deleted" or "Strategy deletion blocked" `{ runCount }`

**evolutionActions.ts** — Add logging to run creation:
- `queueEvolutionRunAction`: Create runLogger after insert, log "Evolution run queued" `{ budgetCapUsd, promptId, explanationId }`

**manageExperiments.ts** — Add logging for status transitions:
- `addRunToExperiment`: Log draft→running transition `{ experimentId, firstRunId }`
- `createExperiment`: Log experiment creation `{ experimentId, name, promptId }`

**Tests**: Add ~8 new test cases. No existing test updates needed.

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 4: Infrastructure Logging (~120 LOC, 3 exported sig changes)

**Files**: `trackBudget.ts`, `createLLMClient.ts`, `trackInvocations.ts`

**trackBudget.ts** — Add optional `logger?: EntityLogger` to `createCostTracker()`:
- On reserve: Log `{ phaseName: phase, estimatedCost, margined, availableBudget }`
- On recordSpend: Log `{ phaseName: phase, actualCost, totalSpent }`
- On release: Log `{ phaseName: phase, releasedAmount, availableBudget }`
- Replace console.error (line 49) with `logger?.error('Budget overrun detected', { totalSpent, budgetUsd, overage })`
- Before BudgetExceededError throw: `logger?.warn('Budget exceeded on reserve', { ... })`
- Add threshold warnings at 50% and 80% consumption

**createLLMClient.ts** — Add optional `logger?: EntityLogger` to `createV2LLMClient()`:
- On call start: `logger?.debug('LLM call attempt', { phaseName: agentName, attempt, model })`
- On success: `logger?.info('LLM call succeeded', { phaseName: agentName, promptChars, responseChars, actual, attempt })`
- On transient error: `logger?.warn('LLM transient error', { phaseName: agentName, attempt, error })`
- On permanent failure: `logger?.error('LLM call failed', { phaseName: agentName, totalAttempts, error })`
- On budget exceeded: `logger?.error('Budget exceeded in LLM call', { phaseName: agentName })`

**trackInvocations.ts** — Add optional `logger?: EntityLogger` to both functions:
- Replace 4 console.warn calls with `logger?.warn(...)` / `logger?.error(...)`
- Add success logs for createInvocation and updateInvocation

**Call site updates**:
- `runIterationLoop.ts:132`: Pass logger to `createCostTracker(budgetUsd, logger)`
- `runIterationLoop.ts:133`: Pass logger to `createV2LLMClient(provider, costTracker, model, logger)`
- `runIterationLoop.ts:180,199`: Pass logger to `createInvocation(..., logger)`
- `runIterationLoop.ts:91,96,100`: Pass logger to `updateInvocation(..., logger)`

**Tests**:
- `trackBudget.test.ts`: 14 call sites — no signature updates needed (logger is optional). BUT: tests that spy on `console.error` for budget overrun (line ~30) will break since console.error is replaced with `logger?.error()`. Update those tests to pass a mock logger and assert `logger.error` is called instead.
- `createLLMClient.test.ts`: 12 call sites — no signature updates needed (logger is optional)
- `trackInvocations.test.ts`: 4 call sites — no signature updates needed (logger is optional). BUT: tests that spy on `console.warn` for error paths (lines ~57, ~84) will break since console.warn is replaced with `logger?.warn()`. Update those tests to pass a mock logger and assert `logger.warn` is called instead. Keep console.warn as fallback when logger is not provided.
- **Strategy for console→logger migration**: Keep `console.warn/error` as fallback when `logger` is undefined using ternary: `logger ? logger.error(...) : console.error(...)`. Do NOT use `??` (void return from logger methods would always trigger fallback). This preserves existing test behavior while enabling structured logging when a logger is available.
- Add ~8 new test cases verifying logger calls with mock logger

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 5: Setup Phase Logging + UI Filters (~150 LOC)

**Files**: `buildRunContext.ts`, `generateSeedArticle.ts`, `logActions.ts`, `LogsTab.tsx`

**buildRunContext.ts** — Keep logger creation at its current location (line 160, after config validation); add setup logging after logger exists:
- **Do NOT move logger creation earlier** — if strategy config validation fails (lines 141-148), the function returns `{ error }` immediately. Creating a logger before this point would write logs for runs that immediately fail, which is architecturally wrong. The current placement (after config is valid) is correct.
- Replace console.warn (line 146) with server-side `logger.warn(...)` from `@/lib/server_utilities` (same pattern as claimAndExecuteRun pre-context logs). This is a simple console→server-logger swap, not an EntityLogger call.
- After logger created (line 166): Log strategy config summary `{ iterations, budgetUsd, models, phaseName: 'setup' }`
- After content resolved: Log content metrics `{ contentLength, source: 'explanation'|'prompt', phaseName: 'setup' }`
- Pass logger to `resolveContent()` and `generateSeedArticle()` (only called after logger exists)

**generateSeedArticle.ts** — Add optional `logger?: EntityLogger`:
- Before title generation: `logger?.debug('Starting seed title generation', { phaseName: 'seed_setup' })`
- After title: `logger?.debug('Seed title generated', { titleLength, phaseName: 'seed_setup' })`
- Before article generation: `logger?.debug('Starting seed article generation', { phaseName: 'seed_setup' })`
- After article: `logger?.info('Seed article complete', { title, contentLength, phaseName: 'seed_setup' })`

**logActions.ts** — Add new filters:
- Add `variantId?: string` and `messageSearch?: string` to LogFilters interface
- Add filter application: `if (filters?.variantId) query = query.eq('variant_id', filters.variantId)`
- Add: `if (filters?.messageSearch) query = query.ilike('message', '%' + filters.messageSearch + '%')`

**LogsTab.tsx** — Add UI filter controls:
- Add iteration dropdown (1-20)
- Add phase name dropdown (generation, ranking, finalize, arena, setup, compare)
- Add message text search input (debounced 300ms)
- Add variant ID text input
- Layout: 2-row filter bar

**Migration** (optional): Add 3 indexes for new query patterns:
```sql
CREATE INDEX IF NOT EXISTS idx_logs_experiment_iteration ON evolution_logs (experiment_id, iteration) WHERE experiment_id IS NOT NULL AND iteration IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_strategy_iteration ON evolution_logs (strategy_id, iteration) WHERE strategy_id IS NOT NULL AND iteration IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_entity_level ON evolution_logs (entity_type, level, created_at DESC);
```

**Tests**: Update `generateSeedArticle.test.ts` (6 call sites, optional param). Add ~5 new tests. Update `logActions.test.ts` (+2 tests). Update `LogsTab.test.tsx` (+3 tests).

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 6: Finalization Logging Enrichment (~80 LOC, 0 sig changes)

**Files**: `persistRunResults.ts`

**finalizeRun()** — Enrich existing logs and add missing ones:
- After line 75: Log strategyEffectiveness (computed but never logged) `{ strategyEffectiveness, phaseName: 'finalize' }`
- After line 109: Log arena entry filtering `{ arenaCount, localCount, phaseName: 'finalize' }`
- After line 173: Log winner determination `{ winnerId, winnerMu, winnerSigma, phaseName: 'finalize' }`
- After line 203: Log variant persistence batch `{ count, winnerId, phaseName: 'finalize' }`
- Before line 310 retry: Log arena sync retry `{ attempt, delay: 2000, phaseName: 'arena' }`

**syncToArena()** — Add optional `logger?: EntityLogger`:
- After entries built: Log sync preparation `{ newEntriesCount, matchCount, phaseName: 'arena' }`
- Replace serverLogger.warn (line 316) with fallback pattern: `logger ? logger.error('Arena sync failed', { ... }) : serverLogger.warn('sync_to_arena failed', { ... })` — preserves serverLogger when no EntityLogger is available
- On success: Log sync complete `{ entrySynced, matchesSynced, phaseName: 'arena' }`

**Tests**: Update `persistRunResults.test.ts` syncToArena call sites (8, optional param). Add ~5 new tests.

**Commit after**: lint, tsc, build, unit tests pass.

---

## Testing

### New Test Helper
Extend existing `createMockEvolutionLogger()` in `evolution/src/testing/evolution-test-helpers.ts` with a call-capturing variant. The existing `EvolutionLogger` and `EntityLogger` interfaces are structurally identical (info/warn/error/debug with same signatures), so one helper serves both:

```typescript
export function createMockEntityLogger() {
  const calls: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  const logger: EntityLogger = {
    info: jest.fn((msg, ctx) => calls.push({ level: 'info', message: msg, context: ctx })),
    warn: jest.fn((msg, ctx) => calls.push({ level: 'warn', message: msg, context: ctx })),
    error: jest.fn((msg, ctx) => calls.push({ level: 'error', message: msg, context: ctx })),
    debug: jest.fn((msg, ctx) => calls.push({ level: 'debug', message: msg, context: ctx })),
  };
  return { logger, calls };
}
```

### Console→Logger Migration Test Strategy
When replacing `console.warn/error` with `logger?.warn/error` in infrastructure code:
- Use fallback pattern: `logger ? logger.error(...) : console.error(...)`
- This preserves existing console spy tests when logger is not provided
- New tests pass a mock logger and assert `logger.error/warn` is called
- Affected test files: `trackBudget.test.ts`, `trackInvocations.test.ts`, `persistRunResults.test.ts`

### Test Cases by Phase
| Phase | New Tests | Updated Tests | Files |
|-------|-----------|---------------|-------|
| 0 | +3 | 0 | createEntityLogger.test.ts |
| 1 | +5 | 0 | runIterationLoop.test.ts |
| 2 | +8 | 0 | rankVariants.test.ts |
| 3 | +8 | 0 | experimentActionsV2.test.ts, strategyRegistryActionsV2.test.ts, evolutionActions.test.ts |
| 4 | +8 | ~3 (console spy → logger spy) | trackBudget.test.ts, createLLMClient.test.ts, trackInvocations.test.ts |
| 5 | +11 | 0 (optional params) | generateSeedArticle.test.ts, logActions.test.ts, LogsTab.test.tsx, +1 integration test |
| 6 | +5 | ~1 (syncToArena fallback) | persistRunResults.test.ts |
| **Total** | **+48** | **~4** | |

### Integration Test (1 test, Phase 5)
Add one integration test (behind `evolutionTablesExist` guard) that:
1. Creates a real EntityLogger with a test Supabase client
2. Writes a log entry with all context fields (iteration, phaseName, variantId, custom context)
3. Queries it back via `getEntityLogsAction`
4. Verifies round-trip: message, level, entity_type, entity_id, extracted fields match
5. Cleans up the test log entry

This catches schema mismatches that unit tests with mock Supabase cannot detect.

### Manual Verification
- Run a local evolution via `run-evolution-local.ts` with Supabase configured
- Query `evolution_logs` table to verify log entries at all entity levels
- Use admin UI LogsTab to verify new filters work
- Confirm log volume is ~370/run (not exponentially higher)
- Verify no sensitive data (prompt text, API keys) appears in logs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Update Logging Architecture section: fix phaseName→agent_name mapping explanation, add new phaseName values, document full logger threading chain
- `evolution/docs/evolution/visualization.md` - Update LogsTab section with new filters (iteration, phase, message search, variant ID)
- `evolution/docs/evolution/data_model.md` - Fix evolution_logs schema: add entity_type, entity_id, experiment_id, strategy_id columns; mark run_id as NULLABLE; add new indexes
- `evolution/docs/evolution/cost_optimization.md` - Document budget event logging via EntityLogger
- `evolution/docs/evolution/reference.md` - Update EntityLogger API with new phaseName values and context conventions
- `docs/feature_deep_dives/evolution_logging.md` - Add actual phaseName values, complete table schema, agent_name column semantics
