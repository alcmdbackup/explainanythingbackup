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

## Phase 1: Core Type Changes
### Work Done
[Not started]

## Phase 2: Infrastructure
### Work Done
[Not started]

## Phase 3: Agent-Level Metrics Registration
### Work Done
[Not started]

## Phase 4: Concrete Agent Adaptation
### Work Done
[Not started]

## Phase 5: Caller Updates
### Work Done
[Not started]

## Phase 6: Tests
### Work Done
[Not started]

## Phase 7: UI Dispatcher
### Work Done
[Not started]
