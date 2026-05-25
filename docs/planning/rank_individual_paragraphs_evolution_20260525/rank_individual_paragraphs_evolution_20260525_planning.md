# rank_individual_paragraphs_evolution_20260525 Plan

## Background
Improve evolved articles by decomposing into paragraphs, rewriting each paragraph independently, then picking the best versions of each paragraph to recombine into a single article. This adds a new dimension to the evolution pipeline: instead of evolving whole articles via tactics or holistic editing, evolve at paragraph granularity and reconstruct.

## Requirements (from GH Issue #NNN)
Use the above Background as the requirements anchor; specific implementation choices will be brainstormed below before being finalized.

## Problem
The existing pipeline operates at whole-article granularity: every variant-producing agent (`generate`, `reflect_and_generate`, `criteria_*`, `debate_and_generate`, `iterative_editing`) emits a full article variant that is ranked pairwise against other full articles via Elo. This conflates per-paragraph signal — a strong opening paragraph paired with a weak conclusion drags the whole article's Elo down, and there is no machinery to surface "this paragraph is better than that one" independently of the surrounding text. Decomposing → rewriting per-paragraph → re-ranking per-paragraph → recombining lets the pipeline pick the local optimum at each slot, which the existing whole-article ranking cannot express.

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item with specific deliverable]

### Phase 2: [Phase Name]
- [ ] [Actionable item with specific deliverable]

## Testing

### Unit Tests
- [ ] [Test file path and description]

### Integration Tests
- [ ] [Test file path and description]

### E2E Tests
- [ ] [Test file path and description]

### Manual Verification
- [ ] [Manual verification step]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check]

### B) Automated Tests
- [ ] [Specific test file path or command to run]

## Documentation Updates
- [ ] [Doc path — brief note on what may change]

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
