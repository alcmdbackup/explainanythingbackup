# Investigation Formal Verification Evolution Plan

## Background
Explore using formal verification to solidify the evolution pipeline code. The evolution system is a complex pipeline with multiple interacting components (generate, rank, evolve loop, budget tracking, arena sync, metrics propagation) that would benefit from formal guarantees about correctness invariants.

## Requirements (from GH Issue #872)
Research-derived requirements from 3 rounds of 12 parallel agents:

1. Add property-based testing (fast-check) for pure functions: rating math, budget tracker, format validator, comparison logic
2. Extract duplicated `selectWinner()` into shared utility with postcondition assertions
3. Add missing DB constraints: status enum CHECKs, config_hash UNIQUE, run_id FK
4. Introduce branded types for compile-time safety: ValidatedArticle, RatedVariant
5. Add runtime assertion framework for budget postconditions and pool invariants
6. (Optional) TLA+ model for concurrent run lifecycle

## Problem
The evolution pipeline has 90+ runtime invariants enforced across 6 subsystems, but relies heavily on convention rather than structural guarantees. Winner selection logic is duplicated with divergent semantics. Zero property-based testing exists despite 30%+ pure function density. Database constraints are incomplete — status enums and config_hash uniqueness are enforced only in TypeScript. These gaps create risk of silent data corruption, state machine violations, and rating math regressions.

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
- [ ] `evolution/docs/architecture.md` — may need formal verification section
- [ ] `evolution/docs/data_model.md` — invariants documentation
- [ ] `evolution/docs/agents/overview.md` — agent contract specifications
- [ ] `evolution/docs/arena.md` — arena invariant guarantees
- [ ] `evolution/docs/cost_optimization.md` — budget invariant proofs
- [ ] `evolution/docs/curriculum.md` — formal verification learning material
- [ ] `evolution/docs/entities.md` — entity relationship invariants
- [ ] `evolution/docs/logging.md` — verification logging
- [ ] `evolution/docs/metrics.md` — metrics correctness guarantees
- [ ] `evolution/docs/minicomputer_deployment.md` — deployment verification
- [ ] `evolution/docs/rating_and_comparison.md` — rating system invariants
- [ ] `evolution/docs/README.md` — formal verification overview
- [ ] `evolution/docs/reference.md` — verification tooling reference
- [ ] `evolution/docs/strategies_and_experiments.md` — experiment invariants
- [ ] `evolution/docs/visualization.md` — verification dashboards

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
