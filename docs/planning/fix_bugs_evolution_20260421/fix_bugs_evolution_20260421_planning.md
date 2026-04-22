# fix_bugs_evolution_20260421 Plan

## Background
Two bugs observed in the evolution system:

- When trying to create a strategy taking the top X articles, leads to an error: `{ "code": "custom", "message": "qualityCutoff required when sourceMode is pool", "path": [ "iterationConfigs", 1 ] }`
- When I look at run 6743c119-8a52-44e5-8102-0b1f4b212f40 on stage, I see that some of its variants seem to be originating from variants not in the run, but which aren't the seed.

## Problem
Bug 1: strategy wizard rejects valid-looking "top X" pool-source configs due to a Zod validation mismatch between the UI's emitted shape and the schema's `qualityCutoff` requirement on `sourceMode='pool'` iterations.

Bug 2: variants in a completed run show `parent_variant_id` pointing to variants that are neither in the run's own pool nor the seed variant, suggesting a lineage/parent-resolution bug — likely in `resolveParent` (Phase 2 pool source mode) or in how pool-drawn parents are linked back to `parent_variant_id` at persistence.

## Phased Execution Plan

### Phase 1: Reproduce & Diagnose Bug 1 (qualityCutoff)
- [ ] Reproduce the wizard error end-to-end to capture the exact emitted `iterationConfigs[1]` payload
- [ ] Compare emitted shape against `iterationConfigSchema` refinement requiring `qualityCutoff` when `sourceMode === 'pool'`
- [ ] Identify root cause (wizard not emitting `qualityCutoff`, or schema refinement firing on valid input)
- [ ] Ship fix (wizard emits required cutoff, OR schema accepts the intended shape)

### Phase 2: Reproduce & Diagnose Bug 2 (orphan parent lineage)
- [ ] Query run 6743c119-8a52-44e5-8102-0b1f4b212f40 variants and parent chain on staging
- [ ] Identify which variants have `parent_variant_id` pointing outside {seed, run's own pool}
- [ ] Trace source: `resolveParent()` pick, `generateFromPreviousArticle` agent input, or persistence path in `persistRunResults`
- [ ] Ship fix (ensure `parent_variant_id` always resolves to seed OR a variant from the same run)

### Phase 3: Verification
- [ ] Unit test covering the exact wizard payload shape for `sourceMode='pool'` + top-N
- [ ] Regression test asserting `parent_variant_id` for every persisted variant references either the seed or another variant in the same run
