# Investigate Under-Budget Run Evolution Plan

## Background
Help me investigate why so few agents were launched (6 total) for run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f` on stage. With gemini 2.5 flash lite model, strategy creation prediction says 20+ agents should be created, but the run features <7.

## Requirements (from GH Issue #NNN)
Use @docs/docs_overall/debugging.md to see how to query supabase dev to investigate.

- Query staging Supabase (`npm run query:staging`) following debugging.md patterns.
- Start from run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f`: fetch status, `budget_cap_usd`, `strategy_id`, `run_summary`, `error_message`.
- Pull the strategy config (`evolution_strategies.config`) to see `iterationConfigs[]`, `generationModel` (gemini-2.5-flash-lite), `budgetUsd`, `generationGuidance`, and the budget-floor fields (`minBudgetAfterParallel*`, `minBudgetAfterSequential*`).
- Read `evolution_metrics` for the run: `cost`, `generation_cost`, `ranking_cost`, `seed_cost`, `agent_cost_projected`, `agent_cost_actual`, `parallel_dispatched`, `sequential_dispatched`, `estimated_cost`, `cost_estimation_error_pct`.
- List `evolution_agent_invocations` rows by iteration + agent_name + success to confirm the agent count (~6) and which iterations they landed in.
- Correlate against `evolution_logs` for `kill_check`, `budget`, `iteration_budget_exceeded`, and `seed_failed` events.
- Reconcile the strategy creation wizard's predicted 20+ agents with actual dispatch — likely branches: (a) budget-floor gating (parallel/sequential floor too conservative for flash-lite pricing), (b) wizard's `estimateAgentCost()` underestimating flash-lite cost vs runtime actual, (c) per-iteration budget exhaustion, (d) seed_failed short-circuit, (e) run killed/cancelled early.
- Identify the root cause and propose a fix (wizard prediction, runtime dispatch math, or budget-floor defaults).

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]
- [ ] **Option C: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item with specific deliverable]
- [ ] [Actionable item with specific deliverable]

### Phase 2: [Phase Name]
- [ ] [Actionable item with specific deliverable]
- [ ] [Actionable item with specific deliverable]

## Testing

### Unit Tests
- [ ] [Test file path and description, e.g. `src/lib/services/foo.test.ts` — test X behavior]

### Integration Tests
- [ ] [Test file path and description, e.g. `src/__tests__/integration/foo.integration.test.ts` — test Y flow]

### E2E Tests
- [ ] [Test file path and description, e.g. `src/__tests__/e2e/specs/foo.spec.ts` — verify Z end-to-end]

### Manual Verification
- [ ] [Manual verification step description]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path to run, e.g. `npm run test:unit -- --grep "foo"` or `npx playwright test src/__tests__/e2e/specs/foo.spec.ts`]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — may need a note if budget-floor defaults or agent-dispatch math changes.
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — may need updates if cost-estimation metrics interpretation changes.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
