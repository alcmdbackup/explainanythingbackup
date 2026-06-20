# Generate Enforce Style Fingerprint Evolution Plan

## Background
Generate a style fingerprint in a piece and make it enforceable on article generation. The fingerprint is a short but accurate description of a writer's style (sentence length, American vs. British terms, idiosyncratic words/phrases, etc.). It will later be injected into a generation prompt to guide article generation and into a rubric to help judge stylistic accuracy vs. expectation.

## Requirements (from GH Issue #NNN)
Compute up with a short but accurate description of a writer's style

Note things like sentence length, American vs. British terms, etc. See what matters and then document it.

Note idiosycratic words/phrases that the author uses, but don't overuse them

This will later be injected into a prompt to guide generation, and into a rubric to help judge stylistic accuracy vs. expepctation

## Problem
_Refine after /research._ Article generation currently has no explicit, machine-readable description of a source writer's style, so generated content drifts from the original voice and there is no objective way to score how stylistically faithful a variant is. We need a compact, accurate style fingerprint that can be (1) extracted from a source piece, (2) injected into the generation prompt to steer output, and (3) injected into the judging rubric to measure stylistic accuracy vs. expectation — without overusing the author's signature phrases.

## Options Considered
- [ ] **Option A: [Name]**: [Description — populate during brainstorm]
- [ ] **Option B: [Name]**: [Description — populate during brainstorm]
- [ ] **Option C: [Name]**: [Description — populate during brainstorm]

Seed dimensions to explore (from /initialize doc review):
- Where to compute the fingerprint (one LLM call vs. deterministic text stats vs. hybrid) and what "matters" (sentence length distribution, spelling region, signature phrases with anti-overuse caps, tone/voice).
- Where to store it (JSONB cached per run / on the source vs. recomputed) and how to thread it to generation + judging.
- Generation injection: evolution prompt builder + main-app generation path.
- Judging injection: new rubric dimension vs. new `evolution_criteria` row (respecting the name CHECK constraint).

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item — populate during planning]

### Phase 2: [Phase Name]
- [ ] [Actionable item — populate during planning]

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
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path or command to run]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] evolution/docs/architecture.md — where fingerprint extraction sits in the run lifecycle
- [ ] evolution/docs/data_model.md — new fingerprint storage field/shape
- [ ] evolution/docs/strategies_and_experiments.md — any new strategy/iteration config surface
- [ ] evolution/docs/editing_agents.md — fingerprint-aware generation directives
- [ ] evolution/docs/paragraph_recombine.md — per-slot style directives if applicable
- [ ] evolution/docs/criteria_agents.md — stylistic-accuracy criterion
- [ ] evolution/docs/rating_and_comparison.md — stylistic-accuracy rubric dimension in judging
- [ ] evolution/docs/reference.md — new files/fields/criteria
- [ ] docs/feature_deep_dives/judge_evaluation.md — style dimension in judge rubric
- [ ] docs/feature_deep_dives/search_generation_pipeline.md — main-app generation prompt injection
- [ ] docs/feature_deep_dives/writing_pipeline.md — fingerprint in the writing prompt

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
