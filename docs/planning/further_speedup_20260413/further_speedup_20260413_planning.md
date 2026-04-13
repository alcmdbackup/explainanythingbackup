# Further Speedup Plan

## Background
This project encompasses several improvements to the evolution pipeline: recovering and documenting research from a crashed branch about judging accuracy, adding timeline visualization for generate_from_seed_article invocations, debugging slow Qwen judge model performance, clarifying the budget buffer parameter naming, and configuring thinking mode for the OSS 20B model to improve speed.

## Requirements (from GH Issue #NNN)
- Pull in the research and planning documents from branch feat/estimate_match_noise_evolution_20260411 - some progress on this branch was lost when my minicomputer crashed. Compare that implementation to the implementation of feat/improve_setup_judging_20260412, which was recreated from memory and then merged, so see if there are any notable differences.
- Also, please copy in the research doc from feat/estimate_match_noise_evolution_20260411, take the key findings and populate them in a docs/research/judging_accuracy_20260412.md for future reference on judges
- Help me add a "timeline" view, similar to what we have for a run, for the invocations of generate_from_seed_article, so I can see why it is taking a certain amount of time to finish
- Debug why judge model for QWEN is so slow. Verify that it was the model called on Run 4133123e-c9fa-4c52-9289-26dcfb95ce61 in staging. See why it isn't faster than OSS 20B. Test both those models side-by-side locally using a script, and see how their response times compare.
- Check for me how our Budget Buffer After Parallel (0-1) value is used. Rename if needed to make it more clear.
- Use web docs to disable thinking mode or put it into "low" thinking mode for OSS 20B model, wherever it is used. Run tests to verify this makes a difference.

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
- [ ] `evolution/docs/README.md` — may need updates
- [ ] `evolution/docs/architecture.md` — may need updates
- [ ] `evolution/docs/cost_optimization.md` — budget buffer naming changes
- [ ] `evolution/docs/data_model.md` — may need updates
- [ ] `evolution/docs/agents/overview.md` — may need updates
- [ ] `evolution/docs/visualization.md` — timeline view additions
- [ ] `evolution/docs/rating_and_comparison.md` — judging accuracy findings
- [ ] `evolution/docs/strategies_and_experiments.md` — thinking mode config
- [ ] `evolution/docs/reference.md` — may need updates

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
