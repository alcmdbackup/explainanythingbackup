# Budget Exhausted Prod Evolution Run Progress

## Phase 1: Fix leaked reservations (root cause)
### Work Done
- Added `releaseReservation(agentName)` to `CostTracker` interface in `types.ts`
- Added `BudgetEventLogger` type and `setEventLogger` to `CostTracker` interface
- Implemented both methods in `CostTrackerImpl` with event emission
- Wrapped `complete()` and `completeStructured()` in `llmClient.ts` with try/catch to call `releaseReservation` on failure
- Updated all 16 mock CostTracker factories with `releaseReservation: jest.fn()` and `setEventLogger: jest.fn()`
- Added tests: releaseReservation FIFO, empty queue no-op, multi reserve+release, setEventLogger events

## Phase 2: Add budget event log table
### Work Done
- Created migration `20260306000001_evolution_budget_events.sql`
- Wired up `wireBudgetEventLogger()` in `preparePipelineRun` and `prepareResumedPipelineRun` in `index.ts`
- Fire-and-forget Supabase insert using service role client

## Phase 3: Fix BudgetExceededError message
### Work Done
- Updated constructor to 4-arg (agentName, spent, reserved, cap)
- Updated throw site in `costTracker.ts` to pass `this.totalSpent, this.totalReserved`
- Updated all 23 BudgetExceededError constructor calls across 13 test files (3-arg → 4-arg with 0 reserved)
- Added test verifying error message includes "reserved" and "committed"

## Phase 4: Fix GenerationAgent model passthrough
### Work Done
- Passed `ctx.payload.config.generationModel` to `llmClient.complete()` in `generationAgent.ts`
- Added test verifying complete() is called with `{ model: 'gpt-5.2' }`

## Phase 5: Fix llmCallTracking silent failures
### Work Done
- Enhanced error logging in `saveTrackingAndNotify` to include `evolution_invocation_id`
- Investigated FK constraint — invocation row is committed before LLM calls via `createAgentInvocation`, so FK should pass
- Root cause of empty table in prod needs further investigation with production DB access

## Post-implementation
### Work Done
- tsc passes (no errors excluding .next/ artifacts)
- eslint passes (0 errors, 0 warnings)
- All 5184 unit tests pass (273 suites)
- Build succeeds
- Updated `cost_optimization.md` with reservation cleanup and budget event log docs
- Updated `reference.md` with new CostTracker methods
