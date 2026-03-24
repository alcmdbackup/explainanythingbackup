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

## Phased Execution Plan

### Phase 1: Run-Level Detailed Logging (~80 LOC, 0 sig changes, 0 test updates)

**Files**: `runIterationLoop.ts`, `claimAndExecuteRun.ts`

**claimAndExecuteRun.ts** — Add run lifecycle logs using existing `logger` (server logger) and `runLogger` (EntityLogger from buildRunContext):
- After line 170: Log status transition to 'running' `{ runId, phaseName: 'lifecycle' }`
- Before line 175: Log "Building run context" `{ runId, phaseName: 'setup' }`
- After line 181: Log "Run context built" `{ runId, initialPoolSize, phaseName: 'setup' }`
- Before line 183: Log "Starting evolution loop" `{ runId, config summary, phaseName: 'loop' }`
- After line 188: Log "Evolution loop completed" `{ stopReason, iterations, cost, poolSize, phaseName: 'loop' }`
- Before line 191: Log "Starting finalization" `{ runId, phaseName: 'finalize' }`
- After line 196: Log "Finalization completed" `{ runId, phaseName: 'finalize' }`

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

**executePhase()** — Add phase result logging:
- After line 91 (success): Log phase cost `{ phaseName, costUsd, totalSpent }`
- After line 96 (partial budget): Log partial results `{ phaseName, partialVariantCount }`
- After line 100 (full budget): Log budget exceeded `{ phaseName, costUsd }`
- Before line 103 (rethrow): Log unexpected error `{ phaseName, errorType, errorMessage }`

**Tests**: No updates needed — all logger params already optional, existing mocks unchanged.

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 2: Ranking Internals Logging (~150 LOC, 4 internal sig changes)

**Files**: `rankVariants.ts`, `computeRatings.ts`

**Signature changes** (all internal/non-exported):
1. `executeTriage()` — add `logger?: EntityLogger`
2. `executeFineRanking()` — add `logger?: EntityLogger`
3. `makeCompareCallback()` — add `logger?: EntityLogger`
4. `runComparison()` — add `logger?: EntityLogger`

**rankPool()** — Thread logger to children:
- After line 565: Log budget tier selection `{ tier, budgetFraction, maxComparisons, phaseName: 'ranking' }`
- Line 567: Pass logger to `makeCompareCallback(llm, config, undefined, logger)`
- Line 584: Pass logger to `executeTriage(..., logger)`
- Line 601: Pass logger to `executeFineRanking(..., logger)`

**executeTriage()** — Per-entrant logging:
- After entrant loop start: Log triage start per entrant `{ entrantId, opponents, phaseName: 'ranking.triage' }`
- After each comparison: Log result `{ entrantId, oppId, confidence, result, phaseName: 'ranking.triage' }` at debug level
- At elimination: Log elimination reason `{ entrantId, muPlusSigma, cutoff, phaseName: 'ranking.triage' }`
- At early exit: Log decisive count and avg confidence `{ entrantId, decisiveCount, avgConfidence, phaseName: 'ranking.triage' }`
- Failed comparison (confidence=0): Log warning `{ entrantId, oppId, consecutiveErrors, phaseName: 'ranking.triage' }`

**executeFineRanking()** — Swiss round logging:
- At round start: Log round number, eligible count, pairs `{ round, eligible, pairs, totalComparisons, phaseName: 'ranking.fine' }`
- After each comparison: Log result at debug level `{ idA, idB, confidence, result, phaseName: 'ranking.fine' }`
- Failed comparison (confidence=0): Log warning `{ idA, idB, phaseName: 'ranking.fine' }`
- At convergence: Log convergence signal `{ round, convergedCount, eligibleCount, phaseName: 'ranking.fine' }`

**makeCompareCallback()** — Error logging:
- In catch block (line 166): Log LLM failure `{ attempt, phaseName: 'ranking.compare' }`

**computeRatings.ts** — Optional logger param to `compareWithBiasMitigation()`:
- Cache hit: Log at debug `{ phaseName: 'ranking.bias-mitigation' }`
- 2-pass result: Log forward/reverse agreement and confidence `{ winner, confidence, phaseName: 'ranking.bias-mitigation' }`
- Cache write: Log at debug `{ confidence, phaseName: 'ranking.bias-mitigation' }`

**Tests**: Update `rankVariants.test.ts` — add ~8 test cases verifying logger calls. Update `computeRatings.comparison.test.ts` — 17 call sites need optional logger param (all backward-compatible, no code changes needed since param is optional).

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
- `trackBudget.test.ts`: 26 call sites — no updates needed (logger is optional)
- `createLLMClient.test.ts`: 12 call sites — no updates needed (logger is optional)
- `trackInvocations.test.ts`: 6 call sites — no updates needed (logger is optional)
- Add ~8 new test cases verifying logger calls with mock logger

**Commit after**: lint, tsc, build, unit tests pass.

---

### Phase 5: Setup Phase Logging + UI Filters (~150 LOC)

**Files**: `buildRunContext.ts`, `generateSeedArticle.ts`, `logActions.ts`, `LogsTab.tsx`

**buildRunContext.ts** — Move logger creation earlier; add setup logging:
- Create EntityLogger before strategy config validation (before line 136)
- Replace console.warn (line 146) with `logger.warn('Invalid strategy config', { strategyId, error })`
- After config loaded: Log strategy config summary `{ iterations, budgetUsd, models, phaseName: 'setup' }`
- After content resolved: Log content metrics `{ contentLength, source: 'explanation'|'prompt', phaseName: 'setup' }`
- Pass logger to `resolveContent()` and `generateSeedArticle()`

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
- Replace serverLogger.warn (line 316) with `logger?.error(...)` (entity-aware)
- On success: Log sync complete `{ entrySynced, matchesSynced, phaseName: 'arena' }`

**Tests**: Update `persistRunResults.test.ts` syncToArena call sites (8, optional param). Add ~5 new tests.

**Commit after**: lint, tsc, build, unit tests pass.

---

## Testing

### New Test Helper
Add `createMockEntityLogger()` to `evolution/src/testing/evolution-test-helpers.ts`:
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

### Test Cases by Phase
| Phase | New Tests | Updated Tests | Files |
|-------|-----------|---------------|-------|
| 1 | +5 | 0 | runIterationLoop.test.ts |
| 2 | +8 | 0 (optional params) | rankVariants.test.ts, computeRatings.comparison.test.ts |
| 3 | +8 | 0 | experimentActionsV2.test.ts, strategyRegistryActionsV2.test.ts, evolutionActions.test.ts |
| 4 | +8 | 0 (optional params) | trackBudget.test.ts, createLLMClient.test.ts, trackInvocations.test.ts |
| 5 | +10 | 0 (optional params) | generateSeedArticle.test.ts, logActions.test.ts, LogsTab.test.tsx |
| 6 | +5 | 0 (optional params) | persistRunResults.test.ts |
| **Total** | **+44** | **0** | |

### Manual Verification
- Run a local evolution via `run-evolution-local.ts` with Supabase configured
- Query `evolution_logs` table to verify log entries at all entity levels
- Use admin UI LogsTab to verify new filters work
- Confirm log volume is ~370/run (not exponentially higher)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Update Logging Architecture section: fix phaseName→agent_name mapping explanation, add new phaseName values, document full logger threading chain
- `evolution/docs/evolution/visualization.md` - Update LogsTab section with new filters (iteration, phase, message search, variant ID)
- `evolution/docs/evolution/data_model.md` - Fix evolution_logs schema: add entity_type, entity_id, experiment_id, strategy_id columns; mark run_id as NULLABLE; add new indexes
- `evolution/docs/evolution/cost_optimization.md` - Document budget event logging via EntityLogger
- `evolution/docs/evolution/reference.md` - Update EntityLogger API with new phaseName values and context conventions
- `docs/feature_deep_dives/evolution_logging.md` - Add actual phaseName values, complete table schema, agent_name column semantics
