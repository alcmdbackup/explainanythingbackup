# Find Improvements Evolution Implementation Progress

## Phase 1: Security & Safety (Critical)

### Work Done

**BUG-4: Cron Auth Bypass (Fail-Open) — FIXED**
- Created shared `requireCronAuth()` helper at `src/lib/utils/cronAuth.ts`
- Updated 3 route files to use the shared helper:
  - `src/app/api/cron/evolution-runner/route.ts`
  - `src/app/api/cron/evolution-watchdog/route.ts`
  - `src/app/api/cron/content-quality-eval/route.ts`
- Changed from fail-open (`if (cronSecret && ...)`) to fail-closed (500 if CRON_SECRET not set)
- Updated existing test at `route.test.ts:184` from asserting 200 to asserting 500
- Added 5 new unit tests in `cronAuth.test.ts`
- All 16 evolution-runner tests pass, all 5 cronAuth tests pass

**SCRIPT-1: Migration NOT NULL Conflict — FIXED**
- Created new migration `20260215000001_revert_not_null_prompt_strategy.sql`
- Drops NOT NULL constraints on `prompt_id` and `strategy_config_id`
- Did NOT edit existing migration file (immutability preserved)

**COST-1: No Pre-Queue Budget Validation — FIXED**
- Added validation in `evolutionActions.ts` after cost estimation: rejects if `estimatedCostUsd > budgetCap`
- Skips validation when `estimatedCostUsd` is null (no strategy config or estimation failure)
- Added 3 new unit tests (reject over-budget, accept null estimate, accept within-budget)
- All 38 evolutionActions tests pass (35 existing + 3 new)

### Spot-Check Results (Unverified Findings)

**HIGH-3: Heartbeat Error Swallowing — CONFIRMED**
- `evolution-runner/route.ts:213-221`: catch block logs warning but never counts failures
- No circuit breaker — repeated heartbeat failures go unnoticed while watchdog marks run as stale
- Recommendation: Add failure counter + abort after N consecutive failures (follow-up ticket)

**MED-7: Watchdog Batch Update Race — CONFIRMED**
- `evolution-watchdog/route.ts:44-53`: UPDATE uses `.in('id', staleIds)` without status filter
- TOCTOU: run completing between SELECT and UPDATE gets wrongly marked as failed
- Recommendation: Add `.in('status', ['claimed', 'running'])` to the UPDATE (follow-up ticket)

### Issues Encountered
- Workflow enforcement hook required symlink from `docs/planning/feat/...` to `docs/planning/find_improvements_...` due to branch name mismatch
- Test file editing required reading `testing_overview.md` (auto-tracked by hook)

### Tests Summary
- `cronAuth.test.ts`: 5 tests (all new)
- `route.test.ts`: 16 tests (1 updated, 15 unchanged)
- `evolutionActions.test.ts`: 38 tests (3 new, 35 unchanged)
- **Total: 59 tests, all passing**

---

## Phase 2: Core Pipeline Correctness (High + Medium)

### Work Done

**HIGH-2 + SCRIPT-2 + SCRIPT-7: applyWinner RPC Transaction — FIXED**
- Created `20260215000002_apply_evolution_winner_rpc.sql` PL/pgSQL function
- Wraps content_history insert + explanations update + variant winner flag in single atomic transaction
- SCRIPT-2: Validates variant content is non-empty before applying
- SCRIPT-7: Skips content_history insert for prompt-based runs (`NULL explanation_id`)
- Updated `evolutionActions.ts` to call `supabase.rpc('apply_evolution_winner', {...})` instead of sequential writes
- Changed `explanationId` type from `number` to `number | null` for prompt-based run support
- Post-evolution eval only fires for explanation-based runs

**COST-6 + ERR-3: Checkpoint Serialization — FIXED**
- Added `entries()` and `static fromEntries()` methods to `ComparisonCache`
- Extended `SerializedPipelineState` with `costTrackerTotalSpent` and `comparisonCacheEntries`
- Updated `persistCheckpoint()` and `persistCheckpointWithSupervisor()` to inject these fields into `state_snapshot`
- Updated all 7+ call sites to pass `ctx.comparisonCache`
- Added `resumeComparisonCacheEntries` to `FullPipelineOptions` with restoration logic in `executeFullPipeline`

**ERR-6: LLMRefusalError Not Caught — FIXED**
- Added `LLMRefusalError` import and non-retriable check in `runAgent()` catch block
- Content policy refusals now fail immediately (no retries), with checkpoint save before throwing

**COST-5: Missing Deserialization Validation — FIXED**
- Added `getTotalReserved()` to `CostTracker` interface and `CostTrackerImpl`
- Added debug assertion in `executeFullPipeline`: warns if `totalReserved !== 0` on startup/resume
- Documents invariant that fresh/resumed CostTracker should have zero outstanding reservations
- Updated all 25 mock CostTracker factories across 18 test files

### Spot-Check Results (Unverified Findings)

**ERR-4: Variant Persistence Silent Fail — CONFIRMED**
- `pipeline.ts:106-107`: When `evolution_variants` upsert fails, error is logged as warning but NOT thrown
- Function is marked "Best-effort" (line 78), but consequence is: run completes with "completed" status while admin UI shows empty pool
- Recommendation: At minimum, log at error level; consider marking run as `completed_with_warnings` (follow-up ticket)

**MED-6: Double Validation Logic — CONFIRMED**
- `evolutionActions.ts:151` and `180`: Identical check `!input.explanationId && !input.promptId` appears twice
- Second instance at line 180 is dead code (first would have already thrown at line 152)
- Recommendation: Remove the second check (follow-up ticket)

### Tests Added
- `pipeline.test.ts`: LLMRefusalError non-retry test (1 new)
- `comparisonCache.test.ts`: entries()/fromEntries() round-trip tests (3 new)
- `costTracker.test.ts`: getTotalReserved() tests (2 new)
- 18 test files: updated mock CostTracker factories with `getTotalReserved`

### Tests Summary
- Evolution suite: 937 tests (51 suites), all passing
- Combined (evolution + services + cron): **980 tests (53 suites), all passing**

---

## Phase 3: Agent Correctness (High + Medium)

### Work Done

**PARSE-1: Greedy JSON Extraction — FIXED**
- Replaced greedy regex `\{[\s\S]*\}` in `jsonParser.ts` with balanced-brace parser
- Handles nested braces, string literals with escaped quotes, and multiple JSON objects
- Skips invalid first objects and tries subsequent ones via recursion
- 14 unit tests (7 new, 7 updated)

**PARSE-2: Template Injection Triple-Quote — FIXED**
- Replaced `"""${text}"""` with `<<<CONTENT>>>\n${text}\n<<</CONTENT>>>` sentinel delimiters
- Updated 4 files: `debateAgent.ts`, `iterativeEditingAgent.ts`, `reflectionAgent.ts`, `flowRubric.ts`
- Zero triple-quotes remain in evolution codebase

**HIGH-4: ProximityAgent Pseudo-Embeddings — FIXED**
- Added `console.warn` on first production embedding call (one-time warning)
- Documented limitation in file header and `_embed()` method comments

**HIGH-5: ProximityAgent Memory Leak — FIXED**
- Added `MAX_CACHE_SIZE = 200` constant with FIFO eviction when exceeded
- Evicts oldest entry before inserting new one when cache is full

**HIGH-6: OutlineGeneration Raw Fallback — FIXED**
- Changed empty expand output handling from adding raw outline as variant to returning `{ success: false }`
- Updated 2 test assertions to match new behavior

**AGENT-1: MetaReview avg() NaN — FIXED**
- Added `arr.length === 0 ? 0 :` guard in `avg()` function

**AGENT-2: EvolvePool maxParentVersion NaN — FIXED**
- Split into `parentVersions` array + `length > 0` check before `Math.max()`
- Defaults to version 0 when no matching parents found

**AGENT-3: Tournament Set Reference Equality — FIXED**
- Changed convergence check from Rating object Set to variant ID Set
- `sortedByOrdinal` now carries `{ id, r }` tuples; `topKIds` uses `.map(e => e.id)`

**AGENT-4: DiffComparison UNSURE Bias — FIXED**
- Moved `import('unified')` and `import('remark-parse')` outside try-catch
- Import failures now propagate as errors (not silently return UNSURE)
- Only parse failures return null for UNSURE verdict

**AGENT-5: SectionDecomp No Bounds Check — FIXED**
- Added `if (idx < 0 || idx >= sectionDetails.length)` guard with logger warning
- Skips out-of-bounds section indices instead of corrupting replacements map

**AGENT-6: DebateAgent Excludes Unrated — FIXED**
- Renamed `countRatedNonBaseline` → `countNonBaseline`
- Removed `state.ratings.has(v.id)` filter from canExecute eligibility check

**PARSE-4: parseWinner Ambiguous Heuristics — FIXED**
- Restructured match priority: exact → phrase (TEXT A/TEXT B) → keyword (TIE/DRAW/EQUAL) → first-word
- First-word check requires exact match on `A`/`B`/`A.`/`B.` (prevents "ACTUALLY" matching as A)

**PARSE-5: Format Validator H1 False Positive — NON-ISSUE**
- `text.trim()` already strips leading blank lines before H1 position check
- Added test to confirm leading blank lines are accepted

**PARSE-6: Code Block Stripping — FIXED**
- Added fence count check before unclosed block stripping
- Only applies trailing `[\s\S]*$` regex if unmatched fences remain after pair removal

### Spot-Check Results (Unverified Findings)

**PARSE-3: No Context Window Size Check — CONFIRMED**
- All agents use token count only for cost estimation, never for context window validation
- No pre-call check whether assembled prompt fits within model's context window (64K for DeepSeek)
- Recommendation: Add token estimation utility + truncation strategy (follow-up ticket)

### Tests Added
- `jsonParser.test.ts`: 7 new tests (balanced braces, escaped quotes, multi-object, recursion)
- `comparison.test.ts`: 3 new parseWinner tests (ambiguity, DRAW/EQUAL)
- `formatValidator.test.ts`: 3 new tests (leading blanks, code block preservation, unclosed fence)
- `outlineGenerationAgent.test.ts`: 2 tests updated for HIGH-6 behavior change

### Tests Summary
- Evolution suite: **949 tests (51 suites), all passing**
- TypeScript: clean, ESLint: clean

---

## Phase 4: Tree Search & Section Editing (Medium)

### Work Done

**BEAM-1: Orphaned Tree Nodes — FIXED**
- Added defensive cleanup pass in `generateCandidates()` after `Promise.allSettled`
- Removes any tree nodes created during generation that don't have a corresponding candidate
- Protects against future refactors that might move `createChildNode` before LLM call

**BEAM-3: Stale Parent Critique Fallback — FIXED**
- Rewrote critique lookup in beam update to be explicit about depth 1 vs depth 2+
- Uses `critiqueByNodeId.get(parentNodeId)` with rootCritique fallback
- Added clarifying comments for the depth-dependent behavior

**BEAM-2: Cross-Scale Weakness Targeting — FIXED**
- Added `CROSS_SCALE_MARGIN = 0.05` in `flowRubric.ts`
- Flow dimensions must beat quality by the margin to override (quality preferred system)
- Prevents revision actions from targeting flow dimension names ("local_cohesion") that revision prompts don't understand

**SEC-1: Stitcher Ignores OOB Silently — FIXED**
- Changed `stitchWithReplacements` return type to `StitchResult { text, unusedIndices }`
- Reports out-of-bounds replacement indices that didn't match any section
- Updated caller in `sectionDecompositionAgent.ts` to log unused indices as warning
- Exported `StitchResult` type from `index.ts`

**SEC-2: No Diagnostic After Stitch Fail — FIXED**
- Added per-section format validation when stitched article fails `validateFormat()`
- Logs which replaced sections individually failed format check
- If all sections pass individually, logs "full-article issue (sections pass individually)"

### Tests Added
- `flowRubric.test.ts`: 1 new test (BEAM-2 quality preference margin)
- `sectionStitcher.test.ts`: 1 new test (SEC-1 OOB replacement indices), existing tests updated for new return type
- `beamSearch.test.ts`: 27 existing tests pass (BEAM-1/BEAM-3 covered by existing tree-consistency tests)

### Tests Summary
- Evolution suite: **951 tests (51 suites), all passing**
- TypeScript: clean

---

## Phase 5: Configuration & Cost System (Medium)

### Work Done

**DB-1: Strategy Aggregates RPC Race — FIXED**
- Created migration `20260215000003_strategy_aggregates_for_update.sql`
- Added `FOR UPDATE` to the SELECT in `update_strategy_aggregates` to serialize concurrent reads
- Added `SET LOCAL statement_timeout = '5s'` to prevent deadlock hangs

**CFG-6: Shallow Config Merge — FIXED**
- Replaced explicit per-key spread in `resolveConfig` with recursive `deepMerge` utility
- Handles: `undefined` → use default, explicit values → override, nested objects → recursive merge
- Arrays and primitives are replaced outright (not merged element-wise)

**CFG-8: StrategyConfig Not Validated — FIXED**
- Added Zod schema `extractStrategyConfigInputSchema` validating:
  - Model names against `allowedLLMModelSchema`
  - `maxIterations` as positive integer 1-100
  - `budgetCaps` values as non-negative numbers up to 10
- `extractStrategyConfig` throws `ZodError` on invalid input

**COST-2: Negative Cost Theoretically Possible — FIXED**
- Added `if (actualCost < 0) throw` guard in `CostTrackerImpl.recordSpend()`

**COST-3: Budget Redistribution No Sum Check — FIXED**
- Added post-scaling sum assertion: warns if `scaledSum` drifts from `originalManagedSum` beyond epsilon
- Existing `remainingSum === 0` guard handles empty enabledAgents case

**CORE-2: Feature Flag Mutex One-Directional — FIXED**
- Changed from one-directional (`treeSearch → disable iterativeEditing`) to bidirectional
- When both enabled: treeSearch takes priority
- When only iterativeEditing enabled: treeSearch explicitly set to false

**CORE-3: getCalibrationOpponents Fewer Than N — FIXED**
- Added fallback padding after deduplication
- Fills from remaining sorted existing + other new entrants until n opponents reached

**CORE-4: Phase Transition Boundary — NON-ISSUE**
- Research claimed `>` should be `>=` in `shouldStop`, but semantics differ:
  - `detectPhase` uses `>=` (switch at that iteration, exclusive)
  - `shouldStop` uses `>` (maxIterations is inclusive, run through that iteration)
- Added clarifying comment documenting the intentional difference

**MED-9: Adaptive Allocation Not Wired — DOCUMENTED**
- Expanded file header comment explaining intentional non-integration
- Requires 10+ runs per agent of historical data before meaningful allocation

**CFG-3: featureFlags Gap in supervisorConfig — FIXED**
- Added optional `featureFlags` field to `SupervisorConfig` interface
- Updated `supervisorConfigFromRunConfig` to accept and pass through `featureFlags`
- Updated caller in `pipeline.ts` to pass `options.featureFlags`

### Spot-Check Results (Unverified Findings)

**DB-3: No RLS Policies on Evolution Tables — CONFIRMED**
- No `ENABLE ROW LEVEL SECURITY` in any evolution migration
- Currently mitigated by server-side auth (service client + `requireAdmin()`)
- Recommendation: Add RLS policies in dedicated migration (follow-up ticket)

**MED-10: Missing Budget Sum Rate Limiting — CONFIRMED**
- `evolutionActions.ts:86-90`: Budget cap validates per-run ($0.01-$100) but no cross-run sum limiting
- Could queue $100 × many runs without rate limiting
- Recommendation: Add daily/weekly aggregate budget cap check (follow-up ticket)

### Tests Added
- `costTracker.test.ts`: 1 new test (COST-2 negative cost rejection)
- `config.test.ts`: 3 new tests (CFG-6 deep merge: partial nested, array replacement, undefined fallback)
- `strategyConfig.test.ts`: 3 new tests (CFG-8 Zod validation: invalid model, negative iterations, valid input)
- `featureFlags.test.ts`: 2 new tests (CORE-2 bidirectional mutex: both enabled, only iterativeEditing)

### Tests Summary
- Evolution suite: **960 tests (51 suites), all passing**
- TypeScript: clean

---

## Phase 6: Frontend & Admin UI

### Work Done

**UI-1: No React Error Boundaries — FIXED**
- Created `error.tsx` files in both route segments using Midnight Scholar design tokens:
  - `src/app/admin/quality/evolution/error.tsx` (dashboard)
  - `src/app/admin/quality/evolution/run/[runId]/error.tsx` (run detail)
- Sentry error capture with page tags, retry + back-to-dashboard buttons

**UI-2: No Confirmation for applyWinner — FIXED**
- Added `window.confirm()` in `handleApplyWinner` before irreversible winner application
- Displays explanation ID and warning about updating published article content

**SCRIPT-4: Hard-Coded Stale Threshold — FIXED**
- Changed `STALE_THRESHOLD_MINUTES = 10` to `parseInt(process.env.STALE_THRESHOLD_MINUTES ?? '10', 10) || 10`
- Configurable via env var, falls back to 10 minutes

**UI-4: Sparkline Key Collision — FIXED**
- Changed sparkline map key from `v.shortId` to `v.id` (full UUID) in `VariantsTab.tsx`
- Prevents collisions when truncated 8-char IDs overlap across variants

**UI-5: LogsTab Auto-Scroll — FIXED**
- Added `isAtBottomRef` with scroll event listener (50px tolerance)
- Auto-scroll only triggers when user is already at the bottom of the log pane

**FE-7: LogsTab Missing Pagination — FIXED**
- Added `PAGE_SIZE = 100` with `displayLimit` state (growing-limit pattern)
- "Load more" button shows `(N of M)` and increases limit by PAGE_SIZE
- Filter changes reset displayLimit to PAGE_SIZE
- Auto-refresh re-fetches within the current display limit window

**FE-1: Unsafe Type Assertions — FIXED**
- Added lightweight Zod schema `serializedPipelineStateSchema` validating minimum required fields
- Created `parseSnapshot()` helper used at all 6 `as SerializedPipelineState` cast sites
- Uses `.passthrough()` for forward-compatibility with evolving checkpoint schema

**UI-3: No Optimistic Updates — FIXED**
- Added `mutating` prop to `VariantPanel` to disable "Apply" buttons during `actionLoading`
- Shows "Applying..." text while mutation is in flight
- Existing buttons (Trigger, Rollback) already correctly disable via `actionLoading`

**UI-7: BudgetTab Stale Closure — FIXED (spot-check confirmed)**
- Wrapped `load` in `useCallback` with `runId` dependency
- Added `load` to dependency arrays for initial load and auto-refresh useEffects
- Removed `eslint-disable-line` comments that were suppressing valid hook warnings

### Spot-Check Results (Unverified Findings)

**UI-7: BudgetTab Stale Closure — CONFIRMED + FIXED** (see above)

**FE-4: Date Format Locale Assumption — CONFIRMED**
- `page.tsx:902,904` and `LogsTab.tsx:219` use `.toLocaleDateString()`/`.toLocaleTimeString()` without locale
- Display-only issue: different locales see different date formats
- Recommendation: Use explicit locale or `date-fns` for consistent formatting (follow-up ticket)

**FE-8: QueueDialog Validation — FALSE POSITIVE**
- `page.tsx:487-498`: JavaScript validation exists for explanation ID and budget
- Checks for NaN, null, zero, and negative values with toast error messages
- Missing HTML `min` attrs are cosmetic, not functional

### Other Fixes

**Lint Fix: beamSearch.ts unused variable**
- Removed unused `node` variable at line 243 (leftover from BEAM-1 orphan cleanup)

### Tests Added
- `evolution-watchdog/route.test.ts`: 4 new tests (auth, stale detection, marking failed, env threshold)

### Tests Summary
- Full suite: **4488 tests (229 suites), all passing**
- TypeScript: clean, build: clean

---

## Phase 7: Performance & Polish (Final)

### Work Done

**DB-4: N+1 in persistAgentMetrics — FIXED**
- Replaced per-agent loop with single batch `upsert(rows)` call
- Updated test to handle batch array format (flatMap extraction)

**DB-5: N+1 in feedHallOfFame — FIXED**
- Replaced 3×2 sequential upsert loop with 2 batch operations:
  - 1 batch `evolution_hall_of_fame_entries` upsert → returns all entry IDs
  - 1 batch `evolution_hall_of_fame_elo` upsert using returned IDs
- Updated 5 test cases in `hallOfFame.test.ts` for new batch pattern

**DB-2: Missing Index on Status — FIXED**
- Created migration `20260215000004_evolution_runs_status_index.sql`
- Composite index on `(status, created_at DESC)` for dashboard/runner queries
- Uses `CONCURRENTLY` for zero-downtime creation

**DB-7: costEstimator Silent Errors — FIXED**
- `PGRST116` (no rows) returns `null` as before
- All other DB errors now throw instead of silently returning null
- Callers catch in their existing try/catch blocks

**MED-8: Cost Estimator Div by Zero — FIXED**
- Added guard `baseline.avgTextLength > 0 ? baseline.avgTextLength : 1`

**CFG-1: budgetCaps Not Passed to Estimator — FIXED**
- Added `budgetCaps?: Record<string, number>` to `RunCostConfig` interface
- Estimator clamps per-agent costs when budgetCaps are provided
- Caller in `evolutionActions.ts` passes `strategyConfig.budgetCaps` through

**AGENT-7: CalibrationRanker Early Exit — FIXED**
- Added average confidence threshold (>= 0.8) to early exit condition
- Prevents false early exits when all individual matches are barely decisive

**AGENT-8: Tournament Pool < 2 — NON-ISSUE**
- `swissPairing` already has `if (variants.length < 2) return []` at line 64
- Guard was present before this audit

**AGENT-9: BeamSearch Stale Critique — FIXED**
- Changed `logger.debug` to `logger.warn` for stale critique fallbacks
- Logs both null-return and error cases with node ID context

**AGENT-10: PairwiseRanker null dimensionScores — FIXED**
- Added `dimensionScores ?? {}` guard in `normalizeReversedResult`

**FE-3: D3 Import Race in TreeTab — FIXED**
- Moved dynamic `import('d3')` to module-level promise
- Guarded with `typeof window !== 'undefined'` for SSR safety

**FE-5: Missing URL Param Validation — FIXED**
- Added UUID regex validation for `runId` before passing to server actions
- Shows error message for invalid UUIDs instead of making failed API calls

**EXP-5: --vary/--lock Conflict — FIXED**
- Added key overlap validation at parse time
- Throws descriptive error listing conflicting keys

**EXP-1: run-batch.ts No Signal Handling — FIXED**
- Added SIGINT/SIGTERM handlers that mark batch as 'interrupted'
- Updates batch status before `process.exit(0)`

**EXP-2: run-batch.ts Missing Cleanup — FIXED**
- Wrapped execution loop in try/catch for fatal errors
- Tracks created run IDs for cleanup reporting
- Updates batch to 'failed' on fatal error

**EXP-4: run-batch.ts Resume — FIXED**
- Implemented `--resume` flag: queries evolution_batch_runs, filters pending/failed runs, re-executes
- Skips already-completed batches
- Inherits existing completion/failure counts

### Spot-Check Results (Unverified Findings)

**HIGH-8: Integer Parsing Validation — FALSE POSITIVE**
- `parseIntArg` uses `parseInt(val, 10) || defaultVal`
- The `||` treats 0 as falsy, but 0 is never valid for any of the three flags (max-runs, parallel, max-concurrent-llm)
- Behavior is correct for these specific use cases

### Tests Updated
- `pipeline.test.ts`: Updated batch agent metrics extraction (flatMap for array format)
- `hallOfFame.test.ts`: Updated 5 test cases for batch entries/elo pattern

### Tests Summary
- Full suite: **4488 tests (229 suites), all passing**
- TypeScript: clean, build: clean

---

## Final Summary

| Phase | Findings Planned | Findings Fixed | Non-Issues | Spot-Checks |
|-------|:----------------:|:--------------:|:----------:|:-----------:|
| 1. Security & Safety | 3 | 3 | 0 | HIGH-3 ✓, MED-7 ✓ |
| 2. Core Pipeline | 4 | 4 | 0 | ERR-4 ✓, MED-6 ✓ |
| 3. Agent Correctness | 14 | 13 | 1 (PARSE-5) | PARSE-3 ✓ |
| 4. Tree Search & Section | 5 | 5 | 0 | — |
| 5. Config & Cost System | 10 | 9 | 1 (CORE-4) | DB-3 ✓, MED-10 ✓ |
| 6. Frontend & Admin UI | 8+1 | 9 | 0 | FE-4 ✓, FE-8 ✗ |
| 7. Performance & Polish | 16 | 14 | 2 (AGENT-8, HIGH-8) | HIGH-8 ✗ |
| **Total** | **61** | **57** | **4** | **10 checked** |
