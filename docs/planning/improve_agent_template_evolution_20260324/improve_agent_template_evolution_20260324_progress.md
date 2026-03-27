# Improve Agent Template Evolution Progress

## Phase 0: Research & Planning
### Work Done
- Conducted 4 rounds of 4 research agents (16 total) exploring Agent base class, Entity system, invocation tracking, pipeline orchestration, execution detail schemas, variant I/O patterns, metric compute functions, UI rendering, TypeScript enforcement patterns, and testing patterns
- Identified 6 critical gaps in current Agent class: execution_detail never populated, duration_ms never tracked, variant I/O implicit, executionDetailSchema unused, UI shows raw JSON, no agent-level metrics
- Discovered 9 of 11 planned agent types are pre-defined with schemas/types/fixtures but unimplemented
- Found evolveVariants() function is orphaned (never called in pipeline loop)
- Confirmed InvocationEntity metrics (best_variant_elo, avg_variant_elo, variant_count) are broken because they depend on execution_detail which is never populated
- Designed plan with user: compile-time generic enforcement for variant I/O, dispatcher component for detail view
- Discussed metrics integration in depth: rejected Agent-independent metrics (shadow system) and InvocationEntity god object approaches. Chose agent-declared `invocationMetrics` merged into InvocationEntity at registry init — keeps registry as single source of truth while agents own their metrics
- Discussed logging: no structural changes needed, just add durationMs to completion log and warn on schema validation failure
- Populated research doc with all findings, planning doc with 7-phase execution plan

### User Clarifications
- **Variant I/O enforcement**: Compile-time via generics (Agent<TInput, TOutput, TDetail>)
- **Detail view pattern**: Dispatcher component (switch on detailType, matches existing codebase pattern)
- **Agent-level metrics**: Agents declare `invocationMetrics` merged into InvocationEntity at registry init. Key insight: agents ARE invocations (1:1 mapping), so their metrics are naturally invocation-level metrics scoped by agent_name

## Phase 1: Core Types + Infrastructure ✅
### Work Done
- Exported `ExecutionDetailBase` from `evolution/src/lib/types.ts`
- Added `AgentOutput<TOutput, TDetail>`, `DetailFieldDef`, `durationMs` to `evolution/src/lib/core/types.ts`
- Updated `trackInvocations.ts` to accept `duration_ms`
- Rewrote `Agent.ts`: 3rd generic `TDetail extends ExecutionDetailBase`, `execute()` returns `AgentOutput`, timing via `Date.now()`, `safeParse` validation, abstract `detailViewConfig`, `invocationMetrics` array

## Phase 2: Agent-Level Metrics Registration ✅
### Work Done
- Created `evolution/src/lib/core/agentRegistry.ts` — lazy `AGENT_CLASSES` array
- Updated `entityRegistry.ts` to merge agent `invocationMetrics` into InvocationEntity at init
- Added `format_rejection_rate` and `total_comparisons` to `metricCatalog.ts`
- Created `evolution/src/lib/core/agentMetrics.ts` with compute functions

## Phase 3: Concrete Agent Adaptation ✅
### Work Done
- `generateVariants()` now returns `GenerationResult { variants, strategyResults }`
- `rankPool()` now returns `RankingMeta` alongside RankResult
- `GenerationAgent`: 3-generic, AgentOutput, childVariantIds, invocationMetrics, detailViewConfig
- `RankingAgent`: 3-generic, AgentOutput, parentVariantIds, invocationMetrics, detailViewConfig
- `persistRunResults.ts`: removed agent_name filter on invocation query
- `InvocationEntity`: null-safe metric compute calls, expanded agent_name filter options
- `finalizationInvocation.ts`: updated compute function signatures to accept `string | undefined | null`

## Phase 4: Caller Updates ✅
### Work Done
- `runIterationLoop.ts` requires no changes — Agent.run() extracts `output.result` internally

## Phase 5: Tests ✅
### Work Done
- `Agent.test.ts`: 3-generic TestAgent, AgentOutput return, detailViewConfig, durationMs checks
- `generateVariants.test.ts`: destructured `result.variants`, added strategyResults test
- `compose.test.ts`: updated for GenerationResult return
- `trackInvocations.test.ts`: added duration_ms pass-through tests
- `entities.test.ts`: added agent metrics via registry test
- `ConfigDrivenDetailRenderer.test.tsx`: 11 tests for all 7 field types + edge cases

## Phase 6: Config-Driven Detail View ✅
### Work Done
- Created `evolution/src/lib/core/detailViewConfigs.ts` — pure data DETAIL_VIEW_CONFIGS map (all 11 detail types)
- Created `ConfigDrivenDetailRenderer.tsx` — generic renderer for 7 field types
- Updated `InvocationExecutionDetail.tsx` — config-driven rendering with raw JSON fallback

## Phase 7: Verification ✅
### Results
- `npx tsc --noEmit` — zero new errors in production code
- `npm run lint` — clean
- `npm run build` — succeeds
- `npx jest evolution/` — 1431 tests pass (123 suites), up from 1420
- `npx jest ConfigDrivenDetailRenderer.test` — 11 tests pass
