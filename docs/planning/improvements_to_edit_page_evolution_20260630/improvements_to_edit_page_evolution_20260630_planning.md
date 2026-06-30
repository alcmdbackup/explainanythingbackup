<!-- Planning doc for the improvements_to_edit_page_evolution_20260630 project: scope, options, phased plan, tests, and verification. -->

# Improvements to Edit Page Evolution Plan

## Background
improvements to edit article external facing page

## Requirements (from GH Issue #1325)
- Focus on new variant in final result
- Show diff in a separate tab, not side by side
- Critique the UX and how to make it better
- Enable all non-test strategies available otherwise. For debugging purposes, let me quickly click to view the strategy detail view including the config, from the dropdown.

## Problem
The public-facing `/edit` surface (introduced by `build_website_for_evolutiOn_20260626`) currently
renders results via `SideBySideWordDiff` with the final variant shown alongside the parent,
the strategy picker exposes only a curated subset, and there is no path from the dropdown to
inspect a strategy's underlying config. Result: the new content is not the visual focus, the diff
crowds the result, and operators cannot debug which strategy/config produced a run from the
page itself. Refine after /research.

## Options Considered
- [ ] **Option A: [Name]**: [Description — refine during /research + /plan-review]
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
- [ ] [Test file path and description, e.g. `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` — verify Z end-to-end]

### Manual Verification
- [ ] [Manual verification step description]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path to run, e.g. `npx playwright test src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts`]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/architecture.md` — Entry Point #5 (public `/edit`) currently states the result is rendered via `SideBySideWordDiff`; update if diff moves to a tab
- [ ] `evolution/docs/strategies_and_experiments.md` — `listPublicStrategiesAction` + `publicVisible` filter; update if curation rule changes (e.g., enable all non-test)
- [ ] `evolution/docs/visualization.md` — admin strategy detail page (re-used or linked from `/edit` dropdown debug)
- [ ] `docs/feature_deep_dives/state_management.md` — `editPageLifecycleReducer` viewing phase; may need new action for tab switch / strategy-detail modal
- [ ] `docs/feature_deep_dives/llm_spending_gate.md` — only update if the strategy-enabling change interacts with budget caps
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — diff renderer; update only if diff component changes
- [ ] `evolution/docs/variant_lineage.md` — "Diff vs parent" rendering reused here; update if shared component contract changes
- [ ] `evolution/docs/editing_agents.md` — strategy detail surface listing; update if new strategies are exposed
- [ ] `evolution/docs/paragraph_recombine.md` — strategy detail surface listing; update if new strategies are exposed
- [ ] `docs/feature_deep_dives/lexical_editor_plugins.md` — only if Lexical renderer used by the result tab

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
