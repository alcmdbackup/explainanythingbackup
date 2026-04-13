# Eliminate Mu Replace Elo Evolution Plan

## Background
Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere. Universally speak in terms of Elo and confidence intervals instead. Understand the scope of change and how to convert from sigma to confidence intervals.

## Requirements (from GH Issue #TBD)
- Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere
- Universally speak in terms of Elo and confidence intervals
- Understand scope of change
- Understand how to convert from sigma to confidence intervals

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
- [ ] `evolution/docs/README.md` — may need terminology updates
- [ ] `evolution/docs/arena.md` — mu/sigma references throughout
- [ ] `evolution/docs/architecture.md` — mu-based winner determination, arena loading
- [ ] `evolution/docs/data_model.md` — mu/sigma column docs, Rating type
- [ ] `evolution/docs/rating_and_comparison.md` — core rating system docs
- [ ] `evolution/docs/entities.md` — entity relationship references
- [ ] `evolution/docs/metrics.md` — elo metrics, sigma references
- [ ] `evolution/docs/strategies_and_experiments.md` — muHistory, strategy effectiveness
- [ ] `evolution/docs/visualization.md` — admin UI column descriptions
- [ ] `evolution/docs/cost_optimization.md` — minor references
- [ ] `evolution/docs/logging.md` — sigma references in triage logging
- [ ] `evolution/docs/reference.md` — key file references
- [ ] `evolution/docs/agents/overview.md` — ranking agent docs

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
