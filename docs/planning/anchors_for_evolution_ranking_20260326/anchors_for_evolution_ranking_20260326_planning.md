# Anchors For Evolution Ranking Plan

## Background
Explore whether using "anchor variants" for arena ranking would speed up ranking convergence of newer variants. Anchors are designated well-established variants that serve as the exclusive comparison opponents for new entrants. Because anchors accumulate many matches, they develop much lower sigma (uncertainty) values. The hypothesis is that comparing high-sigma new variants against low-sigma anchors will cause the new variants' ratings to converge faster in the Weng-Lin Bayesian model.

## Requirements (from GH Issue #TBD)
Requirements are open-ended — the research phase will determine specifics based on:
- Whether the Weng-Lin math supports faster convergence when pairing high-sigma vs low-sigma players
- Trade-offs around anchor staleness and rating distortions
- Prior art in gaming/tournament rating systems
- Practical implementation constraints in the current evolution pipeline

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
- [ ] `evolution/docs/arena.md` — anchor variant concept, loading/syncing anchors
- [ ] `evolution/docs/rating_and_comparison.md` — anchor-based comparison strategy, convergence implications
- [ ] `evolution/docs/architecture.md` — pipeline changes for anchor selection
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — anchor-related metrics
- [ ] `docs/feature_deep_dives/evolution_logging.md` — anchor operation logging
- [ ] `evolution/docs/metrics.md` — new anchor metrics if needed
- [ ] `evolution/docs/visualization.md` — UI changes for anchor display

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
