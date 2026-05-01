# Bring Back Editing Agents Evolution Plan

## Background

The V2 evolution pipeline shipped with only two work-agent types (full-article regeneration and pairwise ranking), losing the targeted-editing capabilities of three V1 agents (`IterativeEditingAgent`, `OutlineGenerationAgent`, `SectionDecompositionAgent`) that were deleted in the V1→V2 clean-slate purge (commit `4f03d4f6`, 2026-03-14). Two prior branches (`feat/create_editing_agent_evolution_20260415`, `feat/introduce_editing_agent_evolution_20260421`) attempted the resurrection — the latter has a fully-fleshed 7-phase plan but the implementation never landed. This project finishes that work: port the three V1 agents to the V2 `Agent` base class, extend `OutlineGenerationAgent` with a new `edit` mode, and add a parent-vs-child diff UI to the invocation-detail page so reviewers can see exactly which edits were made and where.

## Requirements (from GH Issue #NNN)

I want to reintroduce some of the editing agents we've had historically. Please look through github history and find the various editing agents including iterativeediting agent and outline editing agent

## Problem

The V2 pipeline cannot make targeted edits to a variant. `GenerateFromPreviousArticleAgent` always rewrites the entire article from scratch given a tactic — there is no surgical "fix only this weakness" path, no per-section parallel edit, and no outline-level restructure. Reviewers also cannot easily see where edits were made because the invocation-detail page does not render a parent-vs-child diff. Three V1 agents covered these capabilities but were deleted; their orphaned Zod schemas and `DETAIL_VIEW_CONFIGS` entries are still in the V2 tree, making the resurrection lower-risk than a from-scratch design.

## Options Considered

- [ ] **Option A: Resurrect each V1 agent 1:1 on V2 base class**: Pull V1 source from `git show 4f03d4f6^:<path>`, port to `Agent<TInput, TOutput, TDetail>`, reuse orphaned Zod schemas + `DETAIL_VIEW_CONFIGS`. Add edit-mode to `OutlineGenerationAgent` as a new code path. Lowest-risk because schemas + UI plumbing already exist.
- [ ] **Option B: Design all three from scratch for V2**: More idiomatic V2 but throws away working prior art and the UI plumbing already in place.
- [ ] **Option C: Single umbrella `EditingAgent` with a `strategy` sub-field**: Cleaner agentType enum but harder to reason about per-agent `execution_detail` shapes and per-agent UI configs. Also blocks per-agent cost attribution.
- [ ] **Option D: Rebase the existing `feat/introduce_editing_agent_evolution_20260421` branch**: Reuse its planning/research artifacts via cherry-pick / port-forward but execute on this branch so the merge surface is clean. Most efficient route to the same outcome as Option A.

## Phased Execution Plan

> Phase boundaries are placeholders pulled from the prior branch's plan. They will be sharpened during `/research` and `/plan-review`. The 7-phase decomposition below is the inherited starting point.

### Phase 1: Scaffolding — enum + schema + registry
- [ ] Extend `iterationAgentTypeEnum` with `iterative_edit`, `section_decompose`, `outline` in `evolution/src/lib/schemas.ts`.
- [ ] Add optional `outlineMode: 'generate' | 'edit'` to `iterationConfigSchema` (only allowed when `agentType === 'outline'`).
- [ ] Update first-iteration refine: allow `outline + outlineMode='generate'` as first iteration.
- [ ] Update swiss-precedence refine to apply to editing iterations.
- [ ] Extend `AGENT_NAMES` + `COST_METRIC_BY_AGENT` in `evolution/src/lib/core/agentNames.ts`.
- [ ] Extend `STATIC_METRIC_NAMES` in `evolution/src/lib/metrics/types.ts` and add three new metric defs + propagation defs in `evolution/src/lib/metrics/registry.ts`.
- [ ] Verify orphaned schemas / detail configs / list filters still match the V2-port shape; tweak only as needed.

### Phase 2: IterativeEditingAgent
- [ ] Port V1 source `git show 8f254eec:evolution/src/lib/agents/iterativeEditingAgent.ts` to `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` on `Agent<...>`.
- [ ] Rebuild `diffComparison.ts` (word-diff + `run2PassReversal` + truth-table interpreter).
- [ ] Emit rich `execution_detail.cycles[]` (V1 only logged at `info` — fix the gap).
- [ ] Wire dispatch in `runIterationLoop.ts` (parallel batch on top-K parents → top-up loop → single merge).
- [ ] Add `iterative_edit` case to `projectDispatchPlan.ts` and `DispatchPlanView.tsx`.

### Phase 3: SectionDecompositionAgent
- [ ] Port V1 source + helpers (`sectionParser`, `sectionStitcher`, `sectionEditRunner`) to `evolution/src/lib/core/agents/editing/SectionDecomposition/`.
- [ ] Single-agent-per-iteration dispatch (parallelism is internal across sections).
- [ ] Use `AgentCostScope`; add `ctx.signal` abort checks before each section dispatch.
- [ ] Add `section_decompose` case to `projectDispatchPlan.ts` and `DispatchPlanView.tsx`.

### Phase 4: OutlineGenerationAgent (dual-mode)
- [ ] Port V1 source to `evolution/src/lib/core/agents/editing/OutlineAgent/`.
- [ ] Keep V1 4-step pipeline for `operation: 'generate'`.
- [ ] Add edit-mode helpers: `extractOutline.ts`, `outlineEditPrompt.ts`, `diffOutlines.ts`, `selectiveExpand.ts`.
- [ ] Extend `outlineGenerationExecutionDetailSchema` with optional `operation`, `sectionDiffs`, `sectionsRegenerated`, `sectionsPreserved`.
- [ ] Wire dispatch reading `iterCfg.outlineMode`.

### Phase 5: Invocation-detail UI — parent-vs-child diff
- [ ] Add new `'text-diff'` field type to `DetailFieldDef`.
- [ ] Render `<TextDiff>` in `ConfigDrivenDetailRenderer` and `InvocationParentBlock`.
- [ ] Extend three `DETAIL_VIEW_CONFIGS` entries (`iterativeEditing`, `sectionDecomposition`, `outlineGeneration`) with the new field.

### Phase 6: Strategy wizard UI
- [ ] Extend `IterationRow['agentType']` union in `src/app/admin/evolution/strategies/new/page.tsx` with the three new agent types.
- [ ] Conditional `outlineMode` dropdown (visible only for `agentType === 'outline'`).
- [ ] Update budget-allocation bar colors + legend; update `labelStrategyConfig()` iteration counts.

### Phase 7: Documentation
- [ ] Update `evolution/docs/agents/overview.md`, `evolution/docs/architecture.md`, `evolution/docs/reference.md`.
- [ ] Update `docs/feature_deep_dives/multi_iteration_strategies.md` and `docs/feature_deep_dives/evolution_metrics.md`.
- [ ] Add new `docs/feature_deep_dives/editing_agents.md` consolidating the three agents (and update `.claude/doc-mapping.json`).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — happy path, all-reject, format-fail, budget-exhausted, abort, diff correctness, direction-reversal, execution_detail shape, match dedupe, cycle cap.
- [ ] `evolution/src/lib/core/agents/editing/diffComparison.test.ts` — word-diff rendering + `run2PassReversal` 8-combo aggregation truth table.
- [ ] `evolution/src/lib/core/agents/editing/SectionDecomposition/SectionDecompositionAgent.test.ts` — parse/stitch/abort cases.
- [ ] `evolution/src/lib/core/agents/editing/SectionDecomposition/sectionParser.test.ts` — regex edge cases (code blocks, nested headings).
- [ ] `evolution/src/lib/core/agents/editing/OutlineAgent/OutlineAgent.test.ts` — generate + edit happy paths, all 5 diff actions, selectiveExpand preservation, format-fail.
- [ ] `evolution/src/lib/core/agents/editing/OutlineAgent/diffOutlines.test.ts` — all five diff actions + reorder detection.

### Integration Tests
- [ ] `evolution/src/__tests__/integration/editing-agents.integration.test.ts` — strategy with one iteration of each new agentType against real DB; assert invocation rows, schema-conforming `execution_detail`, arena comparisons, costs attributed to correct metric.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-editing-agents.spec.ts` — wizard with all three new agentTypes, run via API, navigate to run detail, assert each agent's invocation card + `TextDiff` visible.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-outline-edit-mode.spec.ts` — exercise edit-mode end-to-end.

### Manual Verification
- [ ] `npx tsx evolution/scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock` with a strategy including all three new types; spot-check each invocation detail UI.
- [ ] Spot-check outline edit mode on an article with a known structural weakness.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Playwright spec exercises invocation detail page for each new agent on a local server via `ensure-server.sh`.
- [ ] Playwright spec exercises strategy wizard flow with all three new types and the conditional `outlineMode` dropdown.

### B) Automated Tests
- [ ] `cd evolution && npx vitest run src/lib/core/agents/editing` — new unit tests.
- [ ] `cd evolution && npx vitest run src/__tests__/integration/editing-agents` — integration.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-editing-agents.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-outline-edit-mode.spec.ts` — E2E.

## Documentation Updates
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — new `iterationAgentTypeEnum` values + `outlineMode` sub-field + refine rule changes.
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — new run-level + propagated cost metrics.
- [ ] `docs/feature_deep_dives/variant_lineage.md` — confirm parent-pointer + attribution behaviour for editing iterations.
- [ ] `evolution/docs/agents/overview.md` — document all three new agents and their place in the iteration loop.
- [ ] `evolution/docs/architecture.md` — new dispatch branches in `evolveArticle()`.
- [ ] `evolution/docs/reference.md` — add new agent classes to the file index.
- [ ] NEW: `docs/feature_deep_dives/editing_agents.md` — consolidated guide. Code-to-doc mapping via `.claude/doc-mapping.json`.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
