[//]: # (Planning doc for understanding iterative-editing agent edit-proposal/acceptance telemetry and tuning prompts to elicit more proposed edits.)

# Investigate Iterative Editing Runs (Stage) Plan

## Background
Understand and improve the behavior of the iterative-editing-class agents on staging — specifically how many edits each propose vs. how many the approver accepts — and then change the system so both flavors of these agents (the multi-cycle `IterativeEditingAgent` and the single-cycle `ProposerApproverCriteriaGenerateAgent`) propose more edits per cycle.

## Requirements (from GH Issue #NNN)
- Understand how many edits are proposed vs. accepted in logging
- Encourage both types of agents to propose more edits

## Problem
Two iterative-editing-class agents (`IterativeEditingAgent` running 1-N propose-review-apply cycles per parent, and `ProposerApproverCriteriaGenerateAgent` running a single forward-+-mirror approve cycle) propose CriticMarkup edit groups against a parent article and then accept a subset. Today's logging surfaces `iterative_edit_accept_rate` (and a high-side rubber-stamp alert at 0.95), but the *absolute* proposed and accepted edit counts per cycle/invocation are scattered across `execution_detail.cycles[*].proposedGroupsRaw` / per-rewrite arrays and are not easily queryable as a metric. The product hypothesis is that both proposer LLMs are being too conservative — the proposer prompt's "prefer one-sentence edits" language plus default soft-caps plausibly pin propose-counts well below the per-cycle guardrails (`AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`). Goal: (a) make proposed-vs-accepted counts first-class per-invocation metrics so we can see the current state on stage, and (b) lift the per-cycle proposed-count distribution for both agents without breaking guardrails (size-ratio ≤ 1.5×, length cap, drift, code-fence/heading-cross rules).

## Options Considered
- [ ] **Option A: Telemetry-only first, prompts second**: Land per-cycle proposed/accepted counts as durable metrics + admin UI surfacing, observe the current distribution on stage for a few real runs, *then* propose proposer-prompt changes. Slower but de-risks "encourage more edits" by letting us calibrate the soft-cap / wording change against real numbers.
- [ ] **Option B: Combined telemetry + prompt tweak in one PR**: Add the metric AND ship a proposer-prompt change (e.g. raise `editingProposerSoftCap` default in the rewrite agent's iter config + relax "prefer one-sentence edits" wording) behind a strategy-config flag. Faster signal, but conflates measurement with intervention — harder to attribute lift to the prompt change vs. background noise.
- [ ] **Option C: Strategy-config knob only**: Expose a `proposerEditCountTarget` per-iteration field and prompt-template it in; do not change defaults. Lets staging experiments A/B at-will without changing any production behavior. Pure config surface change, no metric change.

## Phased Execution Plan

### Phase 1: Inventory + DB diagnosis (no code change)
- [ ] Read `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`, `parseProposedEdits.ts`, `validateEditGroups.ts`, `approverPrompt.ts`, `proposerPrompt.ts` end-to-end and document where proposed-count and accepted-count are observable in `execution_detail` today.
- [ ] Read `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` end-to-end and identify the analogous surfaces for the single-cycle agent.
- [ ] Query staging for the last 20 invocations per agent type and extract per-cycle `groupCount` (proposed) and accepted-group-count from `execution_detail`. Capture distributions in `_research.md` § "High Level Summary".
- [ ] Verify whether `iterative_edit_accept_rate` is currently being written for both agents or only `IterativeEditingAgent` (check `evolution_metrics` rows + `agentRegistry.ts`).

### Phase 2: Make proposed-vs-accepted counts first-class
- [ ] Decide between (i) two new agent-specific `invocationMetrics` (`iterative_edit_proposed_count`, `iterative_edit_accepted_count`) emitted by `Agent.run()`, vs. (ii) two new `execution_detail` summary fields surfaced via `DetailFieldDef` in the admin UI, vs. (iii) both.
- [ ] Implement the chosen approach in the smallest possible change. Mirror in `ProposerApproverCriteriaGenerateAgent` so the same metric names work cross-agent.
- [ ] Add a Honeycomb / admin LogsTab filter on the new metric so staging runs are queryable.

### Phase 3: Encourage more proposals
- [ ] Choose the lever(s): proposer-prompt rewording ("prefer one-sentence" → "aim for ~10-20 distinct edits across the article, prefer atomic single-sentence changes when possible but do not under-propose"), `editingProposerSoftCap` default bump (currently widened to 1-10 by `meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616` Phase 6), or expose a new per-iteration `proposerEditCountTarget` knob.
- [ ] Verify the change does not interact badly with `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` cap, the size-ratio ≤ 1.5× guardrail, or the rubber-stamp accept-rate alert.
- [ ] Run a staging A/B with the change behind a strategy-config flag, comparing proposed-count distribution + accept-rate + variant Elo delta against control.

### Phase 4: Roll out + document
- [ ] If the A/B shows positive lift (or at least no regression in accept-rate / drift-rate / cost), promote to default behavior on the affected agents.
- [ ] Update `evolution/docs/editing_agents.md` and `evolution/docs/criteria_agents.md` to document the new metric and the proposer-tuning knob.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — assert the new proposed/accepted counters in `execution_detail` (or the `invocationMetrics` emission) match the parsed-groups vs. applied-groups counts on a few canonical fixture inputs.
- [ ] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.test.ts` — same assertions on the single-cycle path.
- [ ] If a new proposer-prompt knob is exposed, add a parsing test in `evolution/src/lib/schemas.test.ts` to guarantee schema/refinement coverage.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-pipeline.integration.test.ts` (or a sibling) — drive a mocked-LLM `iterative_editing` iteration end-to-end and assert the new metric rows land in `evolution_metrics`.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` (existing) — extend or add a sibling spec asserting the new proposed/accepted count fields render on the invocation detail page (`/admin/evolution/invocations/[invocationId]`).

### Manual Verification
- [ ] Trigger a real `iterative_editing` run on staging from `/admin/evolution/strategies/new` and confirm the proposed/accepted counts appear in the LogsTab + Subagents tab and roll up to the strategy-level dashboard.
- [ ] Repeat for a `proposer_approver_criteria_generate` strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — verify proposed/accepted counts render on the invocation detail page.

### B) Automated Tests
- [ ] `npm run test:unit -- IterativeEditingAgent` + `npm run test:unit -- proposerApproverCriteriaGenerate`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/editing_agents.md` — add the new metric(s) under "Operational metrics" and any new proposer-tuning knob under "Configuration".
- [ ] `evolution/docs/criteria_agents.md` — same, for `proposer_approver_criteria_generate`.
- [ ] `evolution/docs/logging.md` — note the new fields if surfaced in `execution_detail`.
- [ ] `evolution/docs/agents/overview.md` — quick cross-reference.
- [ ] `evolution/docs/architecture.md` — only if a new agent type or top-level invariant changes (likely not).
- [ ] `evolution/docs/multi_iteration_strategies.md` — only if a new per-iteration knob is added to the `iterationConfigSchema`.
- [ ] `evolution/docs/cost_optimization.md` — only if the cost knobs table needs updating.
- [ ] `evolution/docs/strategies_and_experiments.md` — only if the wizard surface changes.
- [ ] `evolution/docs/reference.md` — env-var changes if any.
- [ ] `evolution/docs/data_model.md` — only if `evolution_metrics` schema changes.
- [ ] `evolution/docs/prompt_editor.md`, `evolution/docs/rating_and_comparison.md`, `evolution/docs/variant_lineage.md`, `evolution/docs/arena.md`, `evolution/docs/curriculum.md`, `evolution/docs/implicit_rubric_weights.md`, `evolution/docs/evolution_metrics.md`, `evolution/docs/metrics.md`, `evolution/docs/visualization.md`, `evolution/docs/minicomputer_deployment.md`, `evolution/docs/paragraph_recombine.md`, `evolution/docs/paragraph_recombine_with_coherence_pass.md` — review at end; expect no changes.
- [ ] `docs/feature_deep_dives/ai_suggestions_overview.md`, `docs/feature_deep_dives/writing_pipeline.md`, `docs/feature_deep_dives/markdown_ast_diffing.md` — review at end; expect no changes (these cover the main-app AI suggestions stack, not the evolution editing agents).

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
