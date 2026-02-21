# Technical Improvements Evolution Research

## Problem Statement
Identify and implement technical improvements to the evolution pipeline, focusing on code simplification, robustness, efficiency, and reduced redundancy. The pipeline has 12 agents, checkpoint/resume, phase transitions, and multiple integration points.

## Requirements (from GH Issue #475)
Look for opportunities to improve evolution pipeline technically - e.g. simplifying code, robustness, efficiency, etc

## High Level Summary

Research conducted 2026-02-19 at commit `5ab03366` on branch `feat/technical_improvements_evolution_20260218`.

**Round 1:** Six parallel research agents analyzed the entire evolution pipeline across dimensions: core orchestration, agent framework, error handling, config/validation, shared utilities, and test coverage. The pipeline totals ~11,500 LOC across 50+ source files with 75 test files.

**Round 2 (2026-02-19):** Six additional parallel agents conducted deeper analysis across: type safety gaps, async/concurrency patterns, error handling & observability, configuration & magic numbers, test quality, and service layer efficiency. This uncovered ~90 additional findings organized into Categories 7-12 below.

**Round 3 (2026-02-19):** Six more parallel agents explored orthogonal dimensions: security & resource management, module architecture & dependencies, LLM prompt & interaction patterns, state management & serialization, performance optimization, and testability & developer experience. This uncovered ~80 additional findings organized into Categories 13-18 below.

Findings are organized into 18 categories.

---

## Category 1: Dead Code and Stale References

### Dead code files
- **`evolution/src/lib/core/adaptiveAllocation.ts` (234 LOC)** — Entirely unwired. Three exported functions are never called from production code. File header explicitly says `"MED-9: INTENTIONALLY UNUSED"`. TODOs reference planned but never-completed wiring.
- **`evolution/src/lib/agents/pairwiseRanker.ts:12`** — Deprecated export: `EVALUATION_DIMENSIONS = QUALITY_DIMENSIONS`. Still exported but no consumers.
- **`evolution/src/lib/agents/reflectionAgent.ts:10`** — Deprecated export: `CRITIQUE_DIMENSIONS = Object.keys(QUALITY_DIMENSIONS)`.

### Dead code within files
- **`pipeline.ts:556`** — `throw new Error('Unreachable: runAgent loop exhausted')` — literally unreachable. The for-loop always returns or throws.
- **`pipeline.ts:31`** — `insertBaselineVariant` accepts `runId` parameter that is never used in the function body. Has `eslint-disable` suppressing the warning.
- **`PoolDiversityTracker` (diversityTracker.ts, 111 LOC)** — Not imported by any agent or pipeline module. Only re-exported from index.ts for external consumers that may not exist.

### Stale documentation references
- `ELO_CONSTANTS` and `K_SCHEDULE` referenced in `docs/evolution/reference.md:215` — do not exist in codebase (artifacts of prior Elo system).
- `featureFlags.ts` referenced in docs — does not exist inside the evolution module.
- `docs/evolution/reference.md` says "12 agents" but the pipeline has grown since.

---

## Category 2: Code Duplication

### Cross-agent duplicated patterns

| Pattern | Occurrences | Files |
|---------|-------------|-------|
| `Promise.allSettled` + `BudgetExceededError` re-throw loop | 5 agents + critiqueBatch | generationAgent, calibrationRanker (2x), evolvePool, tournament, critiqueBatch |
| `metaFeedback.priorityImprovements.join('\n')` extraction | 3 agents | generationAgent:71, evolvePool:197, debateAgent:326 |
| Redundant `canExecute()` call inside `execute()` | 4 agents | calibrationRanker:99, pairwiseRanker:312, tournament:211, debateAgent:194 |
| FORMAT_RULES injection + validateFormat guard | 6 agents | generationAgent, evolvePool, debateAgent, outlineGenerationAgent, iterativeEditingAgent, sectionDecompositionAgent |
| Confidence ladder (winner aggregation) | 2x in same file | pairwiseRanker:200-213 and 286-299 (verbatim duplicate) |

### `GENERATION_STRATEGIES` duplication
- `supervisor.ts:10-14`: `['structural_transform', 'lexical_simplify', 'grounding_enhance']`
- `generationAgent.ts:11`: same 3 strategies hardcoded independently

### `markRunFailed` duplication
Two separate implementations:
1. `persistence.ts` — accepts `(runId, agentName | null, error: unknown)`
2. `evolution-runner.ts:265-276` — local version, accepts `(runId, errorMessage: string)`, also clears `runner_id: null` and handles `continuation_pending` status

### `generationModel` default mismatch
- `config.ts`: `generationModel: 'gpt-4.1-mini'`
- `strategyConfig.ts:144`: fallback `'deepseek-chat'`
- `costEstimator.ts:148`: fallback `'deepseek-chat'`
- `hallOfFameIntegration.ts:163`: fallback `'deepseek-chat'`
- `llmClient.ts:12`: `EVOLUTION_DEFAULT_MODEL = 'deepseek-chat'`

### Inline LLM client in local CLI
`run-evolution-local.ts` (817 LOC) re-implements LLM client behavior (`estimateTokenCost`, `parseStructuredOutput`, Supabase tracking) because it bypasses `preparePipelineRun`. The file header acknowledges `"inlined from llmClient.ts"`.

---

## Category 3: Inconsistencies

### Error handling inconsistencies

| Behavior | Agents that DO it | Agents that DON'T |
|----------|-------------------|-------------------|
| Log non-budget comparison failures | generationAgent, evolvePool | calibrationRanker, tournament (silently skip) |
| Throw on pre-execution budget failure | All other agents | sectionDecompositionAgent (soft-skips, returns `success: false, skipped: true`) |
| Partial recovery on mid-execution error | outlineGenerationAgent (adds partial variant) | All others (discard partial work) |

### `markRunPaused` lacks status guard
`markRunFailed` (persistence.ts) uses `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])` guard. `markRunPaused` (persistence.ts:107) does NOT — could overwrite a `completed` or `failed` status to `paused`.

### Tournament applies rating mutations before BudgetExceededError check
In `tournament.ts`, Elo updates are applied in the loop (lines 300-315) BEFORE the BudgetExceededError check (lines 330-333). This means partial rating updates are committed even if the round ultimately fails on budget.

### Budget reservation leak on transient retry
When an agent fails with a transient error and retries, the reservation from the failed attempt has no explicit rollback path. The reservation remains outstanding unless `recordSpend()` fires.

### `hashStrategyConfig` excludes `budgetCaps`
Two configs with different budget caps but same models/iterations hash identically. This is documented as intentional but may be surprising.

### `requiredCount` hardcoded in `labelStrategyConfig`
`strategyConfig.ts:93-95` hardcodes `3` for singleArticle mode, `4` otherwise. Should derive from `REQUIRED_AGENTS.length` in `budgetRedistribution.ts`.

---

## Category 4: Simplification Opportunities

### `run-evolution-local.ts` bypasses pipeline factories
The 817-LOC local CLI manually constructs `ExecutionContext` (lines 677-692) instead of using `preparePipelineRun`. This means:
- `validateRunConfig()` is skipped
- `computeEffectiveBudgetCaps()` is skipped
- `explanationId` type mismatch: passes `args.explanationId ?? 0` (converts null to 0)
- Inline LLM client duplicates core logic to avoid Next.js imports

### `treeSearchAgent.ts` creates TextVariation manually
The only agent that doesn't use `createTextVariation` factory. Creates a plain object at lines 72-83 with `id: searchResult.bestVariantId` (not a new uuid) and `createdAt: Date.now() / 1000` computed inline.

### `state.getTopByRating(n)` rebuilds map every call
Builds a full `idToVar` map from `pool` array on every call — O(pool size). Called from multiple agents per iteration.

### `state.getPoolSize()` is trivial
Returns `this.pool.length`. Could be a direct property access.

### `serializeState` shares references
No deep copy. The serialized object shares array/object references with the live state.

### `ProximityAgent` uses pseudo-embeddings and bypasses logger
- Production: first 16 chars of lowercased text (acknowledged limitation, `HIGH-4`)
- Uses `console.warn` directly instead of injected `logger`

### `pairwise` budget cap key anomaly
Exists in `DEFAULT_EVOLUTION_CONFIG.budgetCaps` and `VALID_BUDGET_CAP_KEYS`, but absent from `REQUIRED_AGENTS`, `OPTIONAL_AGENTS`, and `MANAGED_AGENTS`. Flows through budget redistribution as unmanaged.

### `run2PassReversal` runs sequentially
Both `comparison.ts` and `diffComparison.ts` use `run2PassReversal` which calls forward then reverse sequentially. The original `compareWithBiasMitigation` ran both via `Promise.all`.

---

## Category 5: Legacy Naming

- **`StrategyConfigRow`** uses `_elo` column names: `avg_final_elo`, `best_final_elo`, `worst_final_elo`, `avg_elo_per_dollar`, `stddev_final_elo` — even though the system uses OpenSkill ordinals. These are DB column names requiring migration to rename.
- **`ordinalToEloScale`** function name still references "Elo" — actually maps OpenSkill ordinal to a 0-3000 display scale.
- **V1/V2 run summary schema** coexistence in `types.ts:601-690` — V1 fields (`eloHistory`, `baselineElo`) transformed to V2 (`ordinalHistory`, `baselineOrdinal`) on parse.
- **`elo_score` column** in `evolution_variants` — stores mapped ordinals, not actual Elo ratings.

---

## Category 6: Code Metrics

### Largest source files

| File | LOC | Notes |
|------|-----|-------|
| `services/evolutionVisualizationActions.ts` | 1,194 | 9 read-only server actions |
| `services/hallOfFameActions.ts` | 1,182 | 14 server actions |
| `services/evolutionActions.ts` | 974 | 9 mutation server actions |
| `services/unifiedExplorerActions.ts` | 898 | Explorer views |
| `scripts/run-evolution-local.ts` | 817 | Standalone CLI |
| `types.ts` | 691 | All shared types + Zod schemas |
| `core/pipeline.ts` | 653 | Pipeline orchestrator |
| `services/costAnalytics.ts` | 501 | Cost analytics |
| `agents/tournament.ts` | 444 | Swiss tournament |
| `agents/evolvePool.ts` | 413 | Evolution agent |
| `agents/iterativeEditingAgent.ts` | 409 | Most complex agent |
| `agents/debateAgent.ts` | 405 | 3-turn debate |

### Test coverage
- **75 test files** under `evolution/src/`
- **11 integration tests** covering evolution
- **100% service file coverage**
- Pipeline.ts has **3.75x test-to-source ratio**
- **0 `@ts-ignore` or `@ts-expect-error`** directives in entire evolution codebase
- Only **4 `as any` casts** in production source (config.ts deepMerge, diffComparison.ts AST types)

### Files without dedicated tests
- `core/validation.ts` (91 LOC) — state contract validator
- `index.ts` (271 LOC) — barrel + factories
- `types.ts` (691 LOC) — type-only + Zod schemas (tested indirectly)
- `agents/base.ts` (17 LOC) — abstract class
- `agents/formatRules.ts` (9 LOC) — constant string

---

## Category 7: Type Safety Gaps

### Loose types in `types.ts`

| Field | File:Line | Issue |
|-------|-----------|-------|
| `Match.dimensionScores: Record<string, string>` | `types.ts:103` | Value should be `'A' \| 'B' \| 'TIE'`, not `string` |
| `AgentResult.agentType: string` | `types.ts:119` | Should be `AgentName` — every agent already sets one of the known values |
| `Match.winner: string` | `types.ts:100` | Conflates variant UUIDs and `'A'/'B'` labels from `comparePair()` |
| `TextVariation.strategy: string` | `types.ts:28` | Static strategies could use a union; dynamic suffixes make full union impractical |
| `Critique.dimensionScores: Record<string, number>` | `types.ts:73` | Key should be dimension union, not bare `string` |
| `CritiqueDimension = string` | `reflectionAgent.ts:12` | Type alias provides zero narrowing — should be `keyof typeof QUALITY_DIMENSIONS \| keyof typeof FLOW_DIMENSIONS` |

### Persistence layer type looseness

- **`checkpointAndMarkContinuationPending` accepts `phase: string`** (`persistence.ts:119`) — should be `PipelinePhase`
- **`CheckpointResumeData.phase: string`** (`persistence.ts:154`) — should be `PipelinePhase`
- **`state_snapshot as SerializedPipelineState`** (`persistence.ts:175`) — unvalidated JSONB cast on checkpoint resume, no Zod validation before the cast
- **`run.config as Record<string, unknown>`** (`hallOfFameIntegration.ts:55`) — JSONB cast without Zod

### `extractJSON<T>` is a type lie

`jsonParser.ts:44` — `return JSON.parse(candidate) as T`. The generic `T` is asserted, never validated at runtime. Every caller passing a specific `T` (e.g., `extractJSON<{ suggestions?: string[] }>` in `iterativeEditingAgent.ts:230`, `extractJSON<{ winner?: string; reasoning?: string }>` in `debateAgent.ts:110`) is making an unchecked assertion on LLM output. Adding an optional Zod schema parameter would fix this.

### `deepMerge(any, any): any` at config entry point

`config.ts:46` — the only non-test function with `any` params in the codebase. Loses all type safety at config resolution. Could be typed as `<T extends object>(defaults: T, overrides: Partial<T>): T`.

### `agentName as keyof PipelineAgents` cast

`pipeline.ts:410` — uses `as` cast instead of explicit type narrowing with a type predicate.

### `truncateDetail()` constructs incomplete objects

`pipelineUtilities.ts:37,45` — two `as AgentExecutionDetail` casts that construct objects missing required union fields.

### No branded types for IDs

`runId: string`, `variantId: string`, `explanationId: number | null` are all plain primitives across `persistence.ts`, `pipeline.ts`, `pipelineUtilities.ts`, `metricsWriter.ts`, `types.ts`. Nothing prevents passing an `explanationId` where a `runId` is expected.

### `select('*')` without narrowing

`costEstimator.ts:89` — fetches all columns from `evolution_agent_cost_baselines` when only 5 fields are needed.

---

## Category 8: Async / Concurrency Issues

### `finalizePipelineRun` runs 6 independent operations sequentially

`pipeline.ts:144-164` — `persistVariants`, `persistAgentMetrics`, `linkStrategyConfig`, `autoLinkPrompt`, and `feedHallOfFame` are awaited one-by-one. 3-4 of these are independent Supabase writes with no data dependency. Exception: `feedHallOfFame` depends on `autoLinkPrompt` (reads `prompt_id` it writes) — this ordering invariant is load-bearing but **undocumented**. If parallelized carelessly, `feedHallOfFame` reads null `prompt_id`.

### `PairwiseRanker.execute()` compares all pairs fully sequentially

`pairwiseRanker.ts:319-328` — N*(N-1)/2 comparisons are `await`-ed one by one. Unlike `Tournament` which uses `Promise.allSettled` per round, PairwiseRanker has zero parallelism. Additionally `state.matchHistory.push(match)` is interleaved inside the loop — a latent race if ever parallelized.

### `LogBuffer` auto-flush is a floating promise with race condition

`logger.ts:44-46` — when `append()` triggers auto-flush, `this.flushPromise` is overwritten without awaiting the prior one. If two auto-flushes race, P1 is orphaned: its DB write failure is invisible, and log entries in that batch are permanently lost.

### `Promise.allSettled` in `critiqueBatch.ts` drops non-budget errors

`critiqueBatch.ts:59-65` — the loop `throw`s on the first `BudgetExceededError`, meaning any non-budget rejected promise that came earlier in the array is silently dropped (error never logged or recorded).

### Tournament flow comparison mutates already-stored state

`tournament.ts:330-370` — `Object.assign(qualityMatch.dimensionScores, flowMatch.dimensionScores)` mutates objects already in `state.matchHistory`. If a flow `BudgetExceededError` is thrown mid-round, earlier indices have already been mutated — non-reversible partial writes.

### `persistCheckpoint` retry uses linear backoff, not exponential

`persistence.ts:35-58` — backoff is `1000 * (attempt + 1)` (linear: 1s, 2s, 3s). Compare with `runAgent` in `pipeline.ts` which correctly uses `1000 * Math.pow(2, attempt)`. Also, `maxRetries=1` means 0 actual retries due to the off-by-one in the throw condition.

### `persistCheckpointWithSupervisor` — two Supabase writes are not atomic

`pipeline.ts:580-596` — `evolution_checkpoints` upsert and `evolution_runs` heartbeat update are sequential, not transactional. If server crashes between them, checkpoint reflects new iteration but run row's `current_iteration` is stale.

### `beamSearch.generateCandidates` — last-write-wins budget error capture

`beamSearch.ts:198-251` — multiple parallel generation promises can each catch a `BudgetExceededError` and overwrite the shared `budgetError` variable. Only the last one to complete (microtask order) stores its error.

### Agent instance-level mutable state

- `iterativeEditingAgent.ts:45` — `attemptedTargets` is an instance-level `Set`, cleared on each `execute()`. If the same agent instance were ever called concurrently, `clear()` would wipe the set mid-flight.
- `proximityAgent.ts:15` — `embeddingCache` is instance-level `Map` with no mutex. LRU eviction at lines 44-50 is not safe under concurrent microtask interleaving.

### Non-budget tournament rejections silently dropped

`tournament.ts:339-370` — flow comparison rejections that are not `BudgetExceededError` are silently skipped (`continue`) with no log. Intermittent LLM failures in flow comparison are entirely invisible.

---

## Category 9: Error Handling & Observability Gaps

### Swallowed errors

| Location | Issue |
|----------|-------|
| `iterativeEditingAgent.ts:233-236` | `runOpenReview` failure silently returns `null` — no log, no error context |
| `pipeline.ts:203-204` | `executeMinimalPipeline` catch arm swallows checkpoint-save failure with `.catch(() => {})` |
| `evaluator.ts:66-69` | `filterByParentComparison` silently `continue`s on `Promise.allSettled` rejections — no log, no logger parameter at all |
| `beamSearch.ts:226` | Individual revision failures logged at `debug` only — invisible in production |

### Missing context in error messages

| Location | Issue |
|----------|-------|
| `pipeline.ts:216,548` | `String(error)` loses stack trace — should use `error.stack` |
| `calibrationRanker.ts:42-43` | Comparison error logged without `idA`, `idB`, or `iteration` context |
| `debateAgent.ts:250,270,291,334` | Debate-turn errors lack `variantAId`, `variantBId`, `iteration` |
| `critiqueBatch.ts:52,72,81` | Critique failures log `agentName` but never `variationId` |
| `pipeline.ts:594` | `persistCheckpointWithSupervisor` failure warning has no `runId`, `iteration`, or `phase` |

### `outlineGenerationAgent` failure path returns `success: true`

`outlineGenerationAgent.ts:271-279` — on mid-pipeline failure, adds partial step output (possibly raw outline, not prose) to pool and returns `success: true, variantsAdded: 1`. The `logger.error('Outline generation failed')` fires but the return claims success.

### Supabase error fields silently discarded

| Location | Issue |
|----------|-------|
| `persistence.ts:38-51` | `evolution_checkpoints` upsert error NOT checked — only `evolution_runs` error triggers retry. Silent stale checkpoint on constraint violation. |
| `hallOfFameIntegration.ts:196-198` | `evolution_hall_of_fame_elo` upsert has no error check |
| `metricsWriter.ts:49,63` | Supabase `error` field discarded from selects — silent failure on DB outage |
| `pipeline.ts:182-187,291-295` | `status: 'running'` update has no error check — DB down leaves run in `claimed` forever |
| `pipeline.ts:340-349` | Kill-signal status check discards error — external kills silently dropped if Supabase is down |

### `console.warn` bypassing injected logger

- `adaptiveAllocation.ts:50,83` — no logger parameter available, no `runId` context
- `config.ts:84` — config clamping event (changes run behavior) invisible in structured logs

### `LogBuffer.flushInternal` permanently drops log entries on flush failure

`logger.ts:57-74` — entries are spliced from `this.buffer` before the try/catch. If DB flush fails, the batch is lost with no counter or metric tracking dropped entries.

### Missing telemetry spans

- `finalizePipelineRun` (`pipeline.ts:121-169`) — 5 sequential async operations with no span. Finalization latency is blind.
- `runFlowCritiques` (`pipeline.ts:598-652`) — called per-iteration but creates no span.

### `persistCheckpointWithSupervisor` vs `persistCheckpoint` — divergent error handling

`persistCheckpointWithSupervisor` (`pipeline.ts:559-595`) warns and swallows with no retry. `persistCheckpoint` (`persistence.ts`) has 3-attempt retry. Both write checkpoint data but have inconsistent resilience.

### Missing custom error classes

- **Continuation RPC failure** — `checkpointAndMarkContinuationPending` raises raw `Error`. A `ContinuationRPCError` would let the outer catch distinguish this from fatal errors and attempt retry instead of immediately marking the run `failed`.
- **Supabase connection failures** — a `PersistenceError` wrapping Supabase responses would distinguish "DB down" (retry) from "bad data" (abort).
- **LLM parse failures** — `iterativeEditingAgent.runOpenReview` and `beamSearch.runInlineCritique` return `null` on parse failure. An `LLMParseError` would distinguish "empty response" (retryable) from "parse failure" (structural prompt issue).

---

## Category 10: Configuration & Magic Numbers

### Hardcoded thresholds that should be configurable

| Location | Value | Purpose |
|----------|-------|---------|
| `supervisor.ts:53` | `minBudget: 0.01` | Floor below which pipeline halts — not in `EvolutionRunConfig` |
| `supervisor.ts:228` | `8` | Quality stop threshold for single-article — duplicates `IterativeEditingConfig.qualityThreshold` |
| `iterativeEditingAgent.ts:293` | `< 3` | Flow critique threshold (0-5 scale) — unnamed inline constant |
| `reflectionAgent.ts:161` | `< 7` | Improvement suggestion threshold — differs from editing's `>= 8` |
| `pipeline.ts:283` | `MAX_CONTINUATIONS = 10` | Not in `EvolutionRunConfig`, cannot be overridden per-run |
| `pipeline.ts:333` | `120_000 / 60_000 / 0.10` | Safety margin min/max/percentage — not in `FullPipelineOptions` |
| `supervisor.ts:313` | `plateau.threshold * 6` | Unexplained multiplier — effective threshold is 6x what user configures (0.02 → 0.12) |

### Dead config / semantic leaks

- **`supervisor.ts:212,222`** — `calibrationPayload.opponentsPerEntrant` (3/5) is set but **never used** by CalibrationRanker, which reads `ctx.payload.config.calibration.opponents` directly
- **`pairwiseRanker.ts:316`, `tournament.ts:222`** — `structured` boolean inferred from `calibration.opponents > 3` instead of a dedicated flag. Setting `opponents = 2` silently disables structured comparison.

### Divergent constants

| Values | Locations | Risk |
|--------|-----------|------|
| Sample thresholds: read=50, write=10, adaptive=10 | `costEstimator.ts:99,310`, `adaptiveAllocation.ts:107` | Three independent thresholds with no shared source |
| Diversity: `HEALTHY=0.4, LOW=0.2, CRITICAL=0.1` vs `diversityThreshold=0.25` | `diversityTracker.ts:6-10` vs `config.ts:14` | `DIVERSITY_THRESHOLDS` unused by supervisor expansion logic |
| Two `budgetPressureConfig` functions | `tournament.ts:20` vs `adaptiveAllocation.ts:182` | Different signatures, return types, thresholds (0.5/0.8 vs 0.7/0.2) |
| `judgeModel`, `maxIterations` defaults | `strategyConfig.ts:144-146` vs `DEFAULT_EVOLUTION_CONFIG` | `extractStrategyConfig` duplicates defaults that could diverge |
| `expansionIters = Math.min(8, ...)` | `costEstimator.ts:154` | Hardcoded `8` mirrors `DEFAULT_EVOLUTION_CONFIG.expansion.maxIterations` but isn't linked |
| Calibration call counts `3×3×2`, `3×5×2` | `costEstimator.ts:165-202` | Duplicate configurable `calibration.opponents` and `generation.strategies` |
| `25 / 3` sigma denominator | `tournament.ts:401` | Reimplements `DEFAULT_SIGMA` from `rating.ts` instead of importing |

### `metaReviewAgent` has 7+ inline threshold constants

`metaReviewAgent.ts:218,225-228,234,247` — `0.3` (diversity), `6` and `30` (ordinal range), `3` (stagnation start iteration), `2` (staleness window), `0.5` (50% bottom-quartile strategy), `-3` (negative delta) — all hardcoded inline.

### `treeSearch` generation ignores `generationModel`

`beamSearch.ts:203` — calls `llmClient.complete(prompt, 'treeSearch')` with no model option, falling back to `EVOLUTION_DEFAULT_MODEL` ('deepseek-chat'). Cost estimator in `treeSearchAgent.ts:135-136` comments "at generationModel pricing" but the actual model differs.

### Weak Zod key validation

`strategyConfig.ts:119` — `agentModels` keys are `z.string()`, not `z.enum(AgentName)`. A typo like `"generatio"` passes validation silently.

### `adaptiveAllocation.ts` hardcodes incomplete agent list

Lines 135-143 — fallback floor list missing `treeSearch`, `sectionDecomposition`, `outlineGeneration`, `flowCritique`, `metaReview`, `proximity`. When wired in, 6 agents would get zero floor allocation.

---

## Category 11: Test Quality Issues

### Pervasive `as EvolutionRunConfig` casts on partial configs

~20 test files cast `DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig`, suppressing compile-time detection of missing required fields. Affected: `generationAgent.test.ts`, `pairwiseRanker.test.ts`, `calibrationRanker.test.ts`, `iterativeEditingAgent.test.ts`, `debateAgent.test.ts`, `tournament.test.ts`, `pipeline.test.ts`, `metricsWriter.test.ts`, `hallOfFame.test.ts`, `hallOfFameIntegration.test.ts`, `pipelineFlow.test.ts`. Fix: use `resolveConfig({})` which returns a full `EvolutionRunConfig`.

### Repeated mock factory code not centralized

`makeMockLogger()`, `makeMockCostTracker()`, `makeMockLLMClient()` are independently defined in ~7 test files despite a shared helper existing at `@evolution/testing/evolution-test-helpers`. When `CostTracker` gains a new method, only the centralized helper gets updated — duplicate factories silently return `undefined`.

### Supabase chain mocks are fragile

| Problem | Impact |
|---------|--------|
| Multiple `.from()` calls return same chain object | Tests cannot verify which table was targeted by which operations |
| Terminal methods (`.eq('id', runId)`) often not verified | Actual row being updated is untested |
| Queue-based results in `hallOfFame.test.ts` (8+ queued results) | Adding any new DB call breaks all tests in the file |

### LLM prompts never verified

Tests like `debateAgent.test.ts:115`, `reflectionAgent.test.ts:71` verify LLM call count but never inspect prompt content. A refactor dropping critique data from prompts would not be caught.

### Missing edge case coverage

- Budget = 0: no test for `budgetCapUsd: 0` behavior
- Single-variant pool: `canExecute` tested but `execute()` on single-variant state untested
- Null/undefined in match history: `buildRunSummary` doesn't test `confidence: undefined` or `dimensionScores: null`

### Tests with non-deterministic data

`metaReviewAgent.test.ts:10`, `diversityTracker.test.ts:8`, `evaluator.test.ts:11-12` — use `Math.random()` for variant IDs. Assertions cannot be reproduced from log output; theoretical collision risk.

### Weak assertions

193 uses of `toBeGreaterThan(0)`, `toBeTruthy()`, or `toBeDefined()` across 40 files substitute for real value assertions. E.g., `metaReviewAgent.test.ts:60-76` checks `metaFeedback.successfulStrategies` is "defined" but never checks its value.

### Missing integration test: agent registration → invocation path

`createDefaultAgents` is count-tested (12 agents) but no test verifies a newly registered agent actually gets invoked during a full pipeline run. Integration tests use manually constructed spy agents, not `createDefaultAgents` → `supervisor.getActiveAgents()`.

---

## Category 12: Service Layer & Query Efficiency

### N+1 queries

- **`getPromptBankCoverageAction`** (`hallOfFameActions.ts:908-976`) — issues up to 3N sequential queries for N prompts (topic lookup + entries + Elo per prompt)
- **Sequential Elo upserts** in `runHallOfFameComparisonInternal` (`hallOfFameActions.ts:478-490`) — per-entry `await` in a loop instead of batch upsert
- **`autoLinkPrompt`** (`hallOfFameIntegration.ts:38-103`) — waterfall of 4 sequential fallback queries

### JS-side aggregation instead of DB-side

- **`_getCostByModelAction` and `_getCostByUserAction`** (`costAnalytics.ts:251-295,339-377`) — fetch all individual LLM tracking rows and aggregate in JS. Should use Postgres `GROUP BY` or `daily_llm_costs` view.
- **`_getCostSummaryAction`** (`costAnalytics.ts:82-117`) — two separate queries on same table with same filters. Should be one query.
- **Dashboard distinct explanation count** (`evolutionVisualizationActions.ts:229-249`) — fetches all `explanation_id` values to do `new Set(...).size` in JS. Should be `count(distinct)`.

### `select('*')` overfetch

| Location | Issue |
|----------|-------|
| `evolutionActions.ts:336,373` | `evolution_runs` list fetches JSONB columns (`state_snapshot`, `config`, `run_summary`, `cost_estimate_detail`) never used by list view |
| `evolutionActions.ts:392-396` | `evolution_variants` fetches full `variant_content` text for all variants |
| `evolutionVisualizationActions.ts:1060-1065,1087-1092` | `evolution_agent_invocations` fetches `execution_detail` JSONB for all rows in list |
| `evolutionVisualizationActions.ts:364-370` | All checkpoints loaded with `state_snapshot` JSONB — megabytes of data for long runs |

### Missing pagination

- `hallOfFameActions.ts:238-244` — `getHallOfFameEntriesAction` no `.limit()`
- `hallOfFameActions.ts:864-868` — `getHallOfFameMatchHistoryAction` no `.limit()`, grows unboundedly
- `evolutionActions.ts:718-721` — `getEvolutionHistoryAction` returns all historical versions with full text
- `evolutionVisualizationActions.ts:521-527` — `getCrossTopicSummaryAction` no limit on entries

### Manual joins instead of Supabase foreign-key selects

`hallOfFameActions.ts:288-329` — `getHallOfFameLeaderboardAction` queries `evolution_hall_of_fame_elo` then separately queries `evolution_hall_of_fame_entries`. Could use `.from('evolution_hall_of_fame_elo').select('*, evolution_hall_of_fame_entries!inner(...)').`

### God functions

- **`_queueEvolutionRunAction`** (`evolutionActions.ts:135-268`) — 7+ responsibilities: validate, lookup prompt, fetch strategy config, estimate cost, validate budget, build run config, insert row, write audit log
- **`_triggerEvolutionRunAction`** (`evolutionActions.ts:511-623`) — validates run, fetches explanation, generates seed article, calls `executeFullPipeline` synchronously, handles error with direct DB update
- **`feedHallOfFame`** (`hallOfFameIntegration.ts:106-221`) — topic resolution, creation, entry upsert, Elo upsert, auto-reranking — all in one function. Uses dynamic import for `runHallOfFameComparisonInternal` to avoid circular deps (code smell).

### Missing caching

- `createSupabaseServiceClient()` called on every function invocation — 20+ times per pipeline run (`persistence.ts` alone: 6 times across functions)
- Feature flag read on every `applyWinnerAction` call (`evolutionActions.ts:838-844`) — DB round trip each time; should cache with TTL
- `evolution-runner.ts:24-31` — `getSupabase()` creates a new client on every call instead of module-level singleton
- `createSupabaseServiceClient()` called inside retry loop (`persistence.ts:35-58`) — new client per retry attempt

### Missing input validation at service boundaries

- `getEvolutionRunsAction` — `filters.startDate` passed directly to `.gte()` with no date format validation
- `getEvolutionRunLogsAction` — `filters.level` and `filters.agentName` have no allowlist
- `applyWinnerAction` — `variantId` not validated as UUID (unlike `runId` which has `validateRunId`)
- `_queueEvolutionRunAction` — `input.budgetCapUsd` has no upper-bound check (unlike `_estimateRunCostAction` which validates 0.01-100)

### Service layer coupled to agent internals

- **`STRATEGY_TO_AGENT` map** (`metricsWriter.ts:105-125`) — metrics layer hardcodes all strategy → agent mappings. New agent = must update `metricsWriter.ts`.
- **`evolutionVisualizationActions.ts:544-599`** — directly traverses `state.treeSearchStates`, `state.treeSearchResults`, internal node structures. Any agent serialization change breaks visualization.
- **`diffCheckpoints`** (`evolutionVisualizationActions.ts:326-345`) — accesses `allCritiques`, `debateTranscripts`, `metaFeedback`, `diversityScore` by name from raw checkpoint snapshot.
- **`findTopicByPrompt`** helper exists in `hallOfFameIntegration.ts` but `hallOfFameActions.ts` duplicates the `.ilike()` query inline in 3 places instead of reusing it.

### Duplicated data transformation

- Elo scale conversion `getOrdinal → ordinalToEloScale` chain duplicated across 6 files
- Agent cost breakdown Map construction duplicated in `evolutionActions.ts:685-697` and `evolutionVisualizationActions.ts:644-674`

---

---

## Category 13: Security & Resource Management

### Prompt content persisted to DB

- **`src/lib/services/llms.ts:283-296`** — Every LLM call writes the full prompt text (including all article content) to the `llmCallTracking` table. Evolution prompts embed full variant texts (thousands of characters each), so this creates significant data volume and potential exposure.

### No prompt sanitization

- **`generationAgent.ts:14-57`** — Article text injected into LLM prompts via `## Original Text\n${text}` with no boundary markers or escaping. Only `reflectionAgent.ts:20-23` uses `<<<CONTENT>>>` delimiters.
- **`evolvePool.ts:27-87`** — Feedback from `state.metaFeedback.priorityImprovements` and strategy names from `getDominantStrategies` embedded verbatim. Low risk today (backend-only, trusted DB source) but no defense-in-depth.

### Unbounded state arrays — quadratic checkpoint growth

- **`state.matchHistory` (`state.ts:26`)** — Append-only, never pruned. With pool of N variants and bias-mitigation (2 calls per pair), tournament adds O(N²) entries per iteration. At iteration 20 with 20 variants: ~16,000 entries (3-8 MB). Serialized to checkpoint JSONB every iteration.
- **`state.allCritiques` (`state.ts:29`)** — Appended every reflection iteration, never pruned. 60+ critique objects over a 20-iteration run.
- **`state.dimensionScores` (`state.ts:28`)** — Grows with each variant that receives a critique. No pruning.

### Unbounded ComparisonCache

- **`comparisonCache.ts:14`** — `Map` with no eviction policy. Historical entries for defunct variant pairs accumulate. Serialized to every checkpoint. After many iterations, cache could contain thousands of stale entries.

### CLI scripts bypass LLM concurrency semaphore

- **`src/lib/services/llms.ts:508-510`** — Semaphore only applies when `call_source.startsWith('evolution_')`. CLI scripts using `createDirectLLMClient` (`run-evolution-local.ts`) create direct API clients, bypassing concurrency control entirely.

### Rate limit 429s in parallel agents converted to strategy failures

- **`generationAgent.ts:77` + `pipeline.ts:534`** — When generation runs 3 strategies concurrently via `Promise.allSettled`, a 429 error during one strategy is caught and converted to a strategy-level failure rather than propagated for agent-level retry. Result: a missing variant rather than a retry.

### Supabase client churn in batch runner heartbeat

- **`evolution-runner.ts:128-138`** — `getSupabase()` called inside `startHeartbeat`'s callback creates a new Supabase client every 60 seconds per active run. With `PARALLEL=10`: up to 10 fresh clients/minute.

---

## Category 14: Module Architecture & Dependencies

### Circular dependency chains (3 confirmed)

1. **`types.ts:8` ↔ `core/pipeline.ts:9`** — `AgentName` defined in pipeline, referenced in types. Root cause: `AgentName` belongs in `types.ts` but is defined in the orchestrator.
2. **`core/supervisor.ts:5` ↔ `core/pipeline.ts:7`** — Same `AgentName` root cause. Supervisor imports `AgentName` from pipeline; pipeline imports `PoolSupervisor` from supervisor.
3. **`core/hallOfFameIntegration.ts:204` → `services/hallOfFameActions.ts` → `@evolution/lib` → `pipeline.ts`** — Broken at runtime by dynamic `await import(...)`. The `import()` at line 204 is intentional with comment "Dynamic import avoids circular deps."

### Barrel file bloat in `index.ts`

- **`evolution/src/lib/index.ts` (271 LOC)** — 50+ exports including internal implementation details (`CostTrackerImpl`, `LogBuffer`, `ComparisonCache`, `CachedMatch`, `PoolDiversityTracker`). Also hosts ~115 lines of factory logic (`preparePipelineRun`, `prepareResumedPipelineRun`) — substantial business logic that belongs in a dedicated factory module.

### Supabase hardcoded in 7 core files (not injected)

All call `createSupabaseServiceClient()` directly: `pipeline.ts`, `persistence.ts`, `logger.ts`, `metricsWriter.ts`, `adaptiveAllocation.ts`, `costEstimator.ts`, `hallOfFameIntegration.ts`. Makes the pipeline permanently coupled to Supabase and the Next.js server environment. Every test mocks `@/lib/utils/supabase/server`.

### Dead parameter: `llmClientId`

- **`llmClient.ts:43`** — `createEvolutionLLMClient` parameter named `_clientId` internally and never used. The `index.ts:178` factory still requires callers provide either `llmClient` or `llmClientId`.

### Fragile relative path for instrumentation

- **`pipeline.ts:13`** — `import { createAppSpan } from '../../../../instrumentation'` — crosses 4 directory levels. Should be an `@/instrumentation` alias.

### No separate package.json/tsconfig for evolution module

Evolution module resolves paths through the root `tsconfig.json`'s `@evolution/*` alias. Not isolatable as a standalone library — permanently embedded in Next.js app.

### PipelineState is a fat interface

- **`types.ts:359-398`** — 24-member interface mixing data fields (`pool`, `ratings`, `critiques`) with methods (`addToPool`, `getTopByRating`). Read-only agents (e.g., `MetaReviewAgent`) receive the full mutable interface. No read-only view exists.

---

## Category 15: LLM Prompt & Interaction Patterns

### No prompt versioning mechanism

No version tags, no metadata recording which prompt template produced a result, no A/B tracking of prompt variants. Strategy names on `TextVariation` are the closest proxy — they indicate which agent/prompt path generated the variant but not the prompt text itself.

### No retry logic in llmClient

- **`llmClient.ts`** — `createEvolutionLLMClient` wrapper has no retry logic. SDK-level retries exist (OpenAI SDK `maxRetries: 3`) but the evolution LLM client layer adds none. `errorClassification.ts:20` classifies `RateLimitError` as transient but the classification is only used for logging (`iterativeEditingAgent.ts:172`), not for actual retry.

### No dynamic model selection

Model choice is static per task type (`judgeModel` for comparisons, `generationModel` for generation, `EVOLUTION_DEFAULT_MODEL` for default). No fallback to alternative models on quality issues or provider failures.

### No text chunking for long inputs

Long articles passed whole to LLM. If an article exceeds the model's context window, the call fails rather than being split. Only guard is the pre-call budget estimation (`estimateTokenCost` at `llmClient.ts:18-26` — `prompt.length / 4` heuristic).

### Three distinct response parsing strategies

1. **Structured text parsing** (line-by-line keyword scan) — `pairwiseRanker.ts:52-93`, `flowRubric.ts:76-128`
2. **JSON extraction** (depth-counting brace matcher) — `jsonParser.ts:10-54`
3. **Zod schema validation** — `llmClient.ts:29-40` (`parseStructuredOutput`)

Plus two simpler patterns: keyword-priority `parseWinner` (`comparison.ts:43-64`) and numeric `parseStepScore`. No unified parsing abstraction.

### Static prompt strings rebuilt on every call

- **`pairwiseRanker.ts:16-44`** — `buildStructuredPrompt` reconstructs `QUALITY_DIMENSIONS` dimension lists (`.map().join()`) on every call. Called 80+ times per tournament. The prefix/suffix of the prompt (everything except the actual texts) is invariant and could be precomputed once at module load.

---

## Category 16: State Management & Serialization

### No post-resume state validation

- **`persistence.ts:181`** — `validateStateContracts()` exists in `validation.ts:7-77` (checks pool/poolIds consistency, parent ID integrity, phase contracts) but is **never called** after `deserializeState()` in the production resume path. A structurally malformed checkpoint propagates corrupt state into a live pipeline.

### SerializedPipelineState understates real checkpoint shape

The actual JSONB has 3 sidecar fields not in the typed interface:
1. `supervisorState` — added by `persistCheckpointWithSupervisor` (`pipeline.ts:575`)
2. `costTrackerTotalSpent` — added by `persistCheckpoint` (`persistence.ts:30`)
3. `comparisonCacheEntries` — added by `persistCheckpoint` (`persistence.ts:31`)

The type cast at `persistence.ts:175` (`as SerializedPipelineState & {...}`) papers over this.

### Partial-iteration mutations committed but not rolled back

When an agent throws mid-execution, `saveCheckpoint().catch(() => {})` persists the partial state. Mutations to `matchHistory`, `ratings`, etc. from the partial iteration are committed. On resume from `iteration_complete` checkpoint, the partial work is discarded — but the partial checkpoint rows remain in the DB. No explicit rollback mechanism.

### `evolution_variants` table empty during entire run

- **`persistence.ts:61-93`** — `persistVariants()` is only called at `finalizePipelineRun()`. During the run, no rows exist in `evolution_variants` for the current run. Any query against that table for an in-progress or failed run returns nothing. Full variant set exists only in checkpoint JSONB.

### `eloToRating` sigma approximation is lossy

- **`rating.ts:67-71`** — Old Elo checkpoints converted to OpenSkill use bucketed sigma values (3.0, 5.0, or DEFAULT_SIGMA) derived from match count. The converted rating does not accurately reflect the actual uncertainty that would have accumulated through real OpenSkill updates.

### V1/V2 run summary migration at read time

- **`types.ts:634-690`** — `EvolutionRunSummary` V1 schema auto-upgrades to V2 on `safeParse()` via Zod `.transform()`. Fields renamed (`eloHistory` → `ordinalHistory`, etc.) but stored DB values are never rewritten.

---

## Category 17: Performance Optimization

### `run2PassReversal` sequential LLM calls — HIGH impact

- **`reversalComparison.ts:26-38`** — Forward and reverse LLM calls are strictly sequential. They are independent and could be `Promise.all`'d. Used by `calibrationRanker.ts:compareWithBiasMitigation`. In contrast, `pairwiseRanker.ts:185` (used by tournament) already parallelizes correctly. This doubles latency per comparison in calibration mode.

### `getTopByRating` — O(n log n) sort + Map rebuild on every call, 14+ sites

- **`state.ts:62-72`** — Rebuilds `new Map(pool.map(...))` and sorts all ratings on every call. Called 14+ times per iteration (pipeline, supervisor, pool utilities, 8+ agents). No caching or invalidation. Fix: cache sorted list and invalidate only when `ratings` is mutated.

### `comparisonCache.makeKey` SHA-256 over full variant texts

- **`comparisonCache.ts:17-21`** — Concatenates full variant texts (5000+ chars each) into a payload string, then SHA-256 hashes it. Called on every `cache.get` and `cache.set` (80+ times per tournament). Fix: hash texts once at `addToPool` time and cache `textHash` on `TextVariation`.

### `swissPairing` — O(n²) candidate pairs with per-pair `getOrdinal` recomputation

- **`tournament.ts:88-108`** — All n*(n-1)/2 candidate pairs scored every round (up to 50 rounds). `getOrdinal` called inside inner loop for same IDs repeatedly. Fix: precompute `ordinalMap: Map<string, number>` once per round.

### `getTopQuartileOrdinal` — full sort called per pair in `needsMultiTurn`

- **`tournament.ts:140-146`** — Called once per pair, which is once per round per pair in `pairConfigs.map(...)`. Value does not change within a round. Should be computed once before the round loop.

### `serializeState` includes full pool text every checkpoint

- **`state.ts:80-103`** — Pool texts are append-only (existing variants never change), but the entire pool including all text content is serialized on every agent checkpoint (8+ times per iteration). Differential checkpoint (deltas only) could reduce payload by ~90%.

### Per-iteration DB status poll adds latency

- **`pipeline.ts:340-344`** — One Supabase round-trip per iteration for "am I killed?" check. 15-iteration run = 15 round-trips adding ~50-200ms each. Could check every N iterations since this is for external intervention.

### `finalizePipelineRun` — 6+ sequential independent Supabase queries

- **`pipeline.ts:121-168`** — `persistVariants`, write `run_summary`, read `cost_estimate_detail`, `persistCostPrediction`, `linkStrategyConfig`, `autoLinkPrompt`, `feedHallOfFame` — all sequential. Several are independent and could be parallelized (run_summary + persistVariants + cost_estimate_detail).

### MetaReviewAgent multiple independent passes over pool

- **`metaReviewAgent.ts`** — Five separate methods (`_getStrategyScores`, `_analyzeStrategies`, `_findWeaknesses`, `_findFailures`, `_prioritize`) each independently iterate `state.pool` and `state.ratings`. Multiple independent `new Map(state.pool.map(...))` constructions and `getOrdinal` recomputations. Could be a single pool traversal.

### `Math.max(...spread)` on ratings arrays

- **`supervisor.ts:265`, `pool.ts:139-141`, `metaReviewAgent.ts:55,225`** — `Math.max(...arr.map(getOrdinal))` spreads entire array onto call stack. Potential stack overflow for large arrays. Use `reduce` instead.

### `estimateRunCostWithAgentModels` — 7 sequential independent DB fetches

- **`costEstimator.ts:166-202`** — Seven `estimateAgentCost` calls awaited sequentially. Each eventually hits Supabase. All independent — should be `Promise.all`.

### `refreshAgentCostBaselines` — row-by-row upsert loop

- **`costEstimator.ts:306-330`** — One upsert per agent/model combo in a loop. Could be a single batch `.upsert(rows[])` call.

---

## Category 18: Testability & Developer Experience

### `meta_review` snake_case breaks camelCase naming convention

- **`metaReviewAgent.ts:17`** — `name = 'meta_review'` while all other 12 agents use camelCase (`'iterativeEditing'`, `'treeSearch'`, `'outlineGeneration'`) or single-word. Interface key is `metaReview` (camelCase) in `PipelineAgents`. DB invocation records store `meta_review`; supervisor config uses `metaReview`. Any code correlating on agent name silently fails to match.

### No per-agent `durationMs` in logs

- **`logger.ts:38`** — `LogBuffer` schema has `duration_ms` column and the extractor supports it, but no agent or pipeline step passes `durationMs` in log context. Column is always `NULL` in `evolution_run_logs`.

### Inconsistent early-exit semantics (skipped vs success:false)

- **`treeSearchAgent.ts:38`, `sectionDecompositionAgent.ts:46`** — Return `{ skipped: true, reason: '...' }` for "nothing to do" conditions
- **`reflectionAgent.ts:69`, `generationAgent.ts:68`** — Return `{ success: false, error: '...' }` for equivalent conditions
- The `AgentResult` type has both `skipped?` and `error?` fields. DB stores them differently (`skipped` boolean vs `error_message` text).

### ProximityAgent production embeddings are meaningless

- **`proximityAgent.ts:146`** — Production path uses first 16 chars of lowercased text as pseudo-embeddings. Diversity scores in production are meaningless. The `HIGH-4` comment acknowledges this. CLI always uses `testMode: true` which replaces with MD5 hashing — also not real embeddings.

### No scripted replay from checkpoint for debugging

Checkpoint system captures full state at every step, but there is no CLI command to load a checkpoint and replay the pipeline from that point. Production continuation works via runner claiming continuation-pending runs, but developers cannot replay locally for debugging/reproduction without manual reconstruction.

### Inaccurate "clean imports" comment

- **`run-evolution-local.ts:21`** — Claims "these modules have no Next.js/Sentry/Supabase transitive deps" but the same file imports `executeFullPipeline` from `pipeline.ts` which imports `@/lib/utils/supabase/server`.

### CLI silently adjusts `--iterations`

- **`run-evolution-local.ts:597-630`** — When `--full` is set, computes minimum iterations to satisfy supervisor constraints. A developer requesting `--iterations 3` might get 7. Warning logged but easily missed.

### Two separate logging formats

- Production: delegates to `@/lib/server_utilities` logger
- CLI: `createConsoleLogger` with ANSI colors and time stamps
- No single format contract between the two.

---

## Documents Read

(Round 2 — additional files read by 6 parallel research agents)

### Additional Code Files Read
- evolution/src/lib/flowRubric.ts
- evolution/src/lib/treeOfThought/beamSearch.ts
- evolution/src/lib/treeOfThought/evaluator.ts
- evolution/src/lib/agents/metaReviewAgent.ts
- evolution/src/lib/agents/outlineGenerationAgent.ts
- evolution/src/lib/agents/proximityAgent.ts
- evolution/src/lib/agents/treeSearchAgent.ts
- evolution/src/lib/agents/sectionDecompositionAgent.ts
- evolution/src/lib/core/costEstimator.ts (full read)
- evolution/src/services/evolutionActions.ts
- evolution/src/services/evolutionVisualizationActions.ts
- evolution/src/services/hallOfFameActions.ts
- evolution/src/services/costAnalytics.ts
- All ~70 test files under evolution/src/

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- docs/docs_overall/testing_overview.md
- evolution/docs/evolution/hall_of_fame.md
- docs/docs_overall/environments.md

## Code Files Read
- evolution/src/lib/core/pipeline.ts (653 LOC)
- evolution/src/lib/core/supervisor.ts (314 LOC)
- evolution/src/lib/core/state.ts (140 LOC)
- evolution/src/lib/index.ts (271 LOC)
- evolution/src/lib/types.ts (691 LOC)
- evolution/src/lib/config.ts (99 LOC)
- evolution/src/lib/comparison.ts (146 LOC)
- evolution/src/lib/diffComparison.ts (131 LOC)
- evolution/src/lib/core/persistence.ts (197 LOC)
- evolution/src/lib/core/metricsWriter.ts (213 LOC)
- evolution/src/lib/core/hallOfFameIntegration.ts (222 LOC)
- evolution/src/lib/core/pipelineUtilities.ts (76 LOC)
- evolution/src/lib/core/costTracker.ts (98 LOC)
- evolution/src/lib/core/errorClassification.ts (43 LOC)
- evolution/src/lib/core/configValidation.ts (147 LOC)
- evolution/src/lib/core/budgetRedistribution.ts (143 LOC)
- evolution/src/lib/core/agentToggle.ts (37 LOC)
- evolution/src/lib/core/strategyConfig.ts (199 LOC)
- evolution/src/lib/core/adaptiveAllocation.ts (234 LOC)
- evolution/src/lib/core/textVariationFactory.ts (27 LOC)
- evolution/src/lib/core/critiqueBatch.ts (93 LOC)
- evolution/src/lib/core/jsonParser.ts (55 LOC)
- evolution/src/lib/core/reversalComparison.ts (39 LOC)
- evolution/src/lib/core/formatValidationRules.ts (105 LOC)
- evolution/src/lib/core/rating.ts (81 LOC)
- evolution/src/lib/core/pool.ts (147 LOC)
- evolution/src/lib/core/diversityTracker.ts (111 LOC)
- evolution/src/lib/core/llmClient.ts (111 LOC)
- evolution/src/lib/core/logger.ts (128 LOC)
- evolution/src/lib/agents/base.ts (17 LOC)
- All 14 agent files under evolution/src/lib/agents/
- evolution/scripts/run-evolution-local.ts (817 LOC)
- evolution/scripts/evolution-runner.ts (378 LOC)
- All 75 test files under evolution/src/

(Round 3 — additional files read by 6 parallel research agents)

### Additional Code Files Read (Round 3)
- src/lib/services/llms.ts (LLM dispatch, prompt persistence, semaphore gate)
- src/lib/services/llmSemaphore.ts (FIFO counting semaphore)
- evolution/src/lib/core/validation.ts (state contract validators)
- evolution/src/lib/core/textVariationFactory.ts (variant ID generation)
- evolution/src/lib/core/comparisonCache.ts (cache key construction, eviction)
- evolution/src/lib/core/errorClassification.ts (transient error detection)
- evolution/src/lib/core/reversalComparison.ts (2-pass reversal runner)
- evolution/src/lib/agents/formatRules.ts (FORMAT_RULES constant)
- evolution/src/lib/treeOfThought/revisionActions.ts (beam search prompts)
- evolution/src/lib/treeOfThought/evaluator.ts (diff comparison UNSURE fallback)
- evolution/src/testing/evolution-test-helpers.ts (canonical mock factories)
- evolution/src/testing/executionDetailFixtures.ts (agent detail type fixtures)
- tsconfig.json (path aliases for @/* and @evolution/*)
