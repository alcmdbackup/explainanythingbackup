# Fix UX Bugs Judge Lab Agreement Plan

## Background
Fix UX issues and bugs surfaced while using the Judge Lab Agreement sweep tool (rubric ↔ holistic agreement mode at `/admin/evolution/judge-lab/agreement`). Improve in-context explanations of sweep knobs (`repeats`, judging temperature default) and metric labels (`per-rep`, `both-dec`, `abstain`), make pre-flight cost preview use the existing cost-estimation infrastructure, and build a detail/drill-down view that surfaces individual matches with per-criterion agreement vs. the holistic verdict. Add a summary view that aggregates forward vs. reverse pass agreement and per-criterion disagreement rates against the holistic assessment.

## Requirements (from GH Issue #NNN)
- Explain more clearly in UI/UX what "repeats" does
- Preview cost accurately using pre-existing infrastructure
- What is the best judging temperature? Do we have a default to advise?
- Build a detail view that allows you to view the results in much more detail - e.g. individual matches, which criteria agreed vs. didn't with overall
- Compute useful summary view that shows how often we had forward vs. reverse pass for holistic vs. criteria runs agreeing, how often individual criteria disagreed with wholistic assessment, etc
- Clearly explain what "per-rep", "both-dec" and "abstain" mean

## Problem
The Agreement sweep (created in `Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619`) ships with terse labels (`per-rep` / `both-dec` / `abstain`) and undocumented knobs (`repeats`, temperature) that operators can't reason about without reading the source. Pre-flight cost preview is missing or imprecise, so users can't tell whether a sweep will fit under the `JUDGE_EVAL_MAX_USD` cap before clicking Launch. The run-detail page surfaces aggregates but doesn't let researchers drill down to specific disagreements — neither at the per-match level nor at the "which criterion broke vs the holistic verdict" level — making the tool weak at its main job of explaining *why* a rubric agrees or disagrees with holistic judgment.

## Options Considered
- [ ] **Option A: [Name]**: [Description — populate during research/plan-review]
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
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — agreement-mode UX changes (label wording, cost preview, detail view) likely need re-documenting
- [ ] `evolution/docs/implicit_rubric_weights.md` — closest cousin tool; check whether label wording / cost-preview pattern should be aligned across both
- [ ] `evolution/docs/rating_and_comparison.md` — if we surface the "per-rep / both-dec" definitions in UI tooltips, mirror the wording here
- [ ] `evolution/docs/visualization.md` — admin page changes (new detail view, summary additions) need an entry
- [ ] `evolution/docs/cost_optimization.md` — if we surface the pre-flight estimator more prominently or extend it, document the new surface
- [ ] `evolution/docs/criteria_agents.md` — only if per-criterion agreement labels touch criteria-display strings
- [ ] `evolution/docs/data_model.md` — only if we add columns/tables; pure-UI changes won't touch it
- [ ] `evolution/docs/metrics.md` — only if we add a new agreement metric to the registry
- [ ] `evolution/docs/strategies_and_experiments.md` — likely no change (UX-scoped project)
- [ ] `evolution/docs/architecture.md` — likely no change
- [ ] `evolution/docs/arena.md` — likely no change
- [ ] `evolution/docs/entities.md` — likely no change
- [ ] `evolution/docs/reference.md` — only if env vars or scripts change
- [ ] `evolution/docs/README.md` — likely no change

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
