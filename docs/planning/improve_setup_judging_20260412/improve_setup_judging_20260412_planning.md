# Improve Setup Judging Plan

## Background
Improve the evolution pipeline's setup and judging by adding cheap judge models (Qwen 8B, Google), centralizing model configuration into a registry with max temperature validation, setting judge temperature to 0, adding configurable generation temperature to strategy config, and changing OpenSkill beta to 0.

## Requirements (from GH Issue #TBD)
- Change beta to 0 in my Openskill implementation
- I want to speed up judging for evolution. Add want to add two models - Qwen 8b, a Google one. Both cost around $.10 per M input or less. Help me find these actual models and add support for these in my evolution system, including in model dropdown list on strategy creation.
- Refactor to consolidate my model information into a central model registry.
    - Add my 2 new models to this registry
    - Add maximum temperature into this model registry
- Set temperature to 0 for all models when they are used as judges
- Add the ability to configure (optionally) a generation temperature for generation models, from the strategy config. Make sure to find the max temperature for all of our available models and add them to our model registry, to validate the user's input from the strategy creation screen to make sure temp is a valid value.

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
- [ ] `evolution/docs/README.md` — may need updates for new models
- [ ] `evolution/docs/architecture.md` — temperature passing in LLM calls
- [ ] `evolution/docs/data_model.md` — strategy config schema changes
- [ ] `evolution/docs/arena.md` — OpenSkill beta change
- [ ] `evolution/docs/rating_and_comparison.md` — OpenSkill beta change
- [ ] `evolution/docs/strategies_and_experiments.md` — new StrategyConfig fields
- [ ] `evolution/docs/cost_optimization.md` — new model pricing
- [ ] `evolution/docs/reference.md` — new model support, env vars
- [ ] `evolution/docs/agents/overview.md` — temperature behavior
- [ ] `docs/docs_overall/testing_overview.md` — if test changes needed
- [ ] `docs/docs_overall/environments.md` — new API keys if needed
- [ ] `docs/feature_deep_dives/testing_setup.md` — if test changes needed

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
