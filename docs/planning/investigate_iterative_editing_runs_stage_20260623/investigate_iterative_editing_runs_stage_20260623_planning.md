[//]: # (Planning doc for stripping all soft caps + bias-down guidance from the iterative-editing proposer prompts so Mode A and Mode B both propose aggressively.)

# Investigate Iterative Editing Runs (Stage) Plan

## Background
Both flavors of the iterative-editing agent (`iterative_editing` = Mode A, inline-CriticMarkup proposer; `iterative_editing_rewrite` = Mode B, full-rewrite proposer) currently throttle proposed-edit count through a layered set of soft caps and bias-down prompt language. On the 4 most-recent staging runs, Mode A averages **0.70 proposed groups per cycle** with **85% of cycle-1's applying zero edits**; Mode B (with `editingProposerSoftCap: 10` + `disableApproverFiltering: true`) averages **9.25 proposed groups in cycle 1, 47.3% accept rate, 4.6 applied per cycle**. The goal is to remove every soft cap from the proposer-prompt + config-schema surface and replace the bias-down rules ("Prefer one-sentence edits", "propose AT MOST N atomic edits per cycle", "Surgical changes ship; sprawling rewrites get discarded") with a single ambitious directive that invites the proposer to explore whatever edit-shape it judges most valuable — large sentence-order swaps, structural rewrites, or many minor edits.

## Requirements (from GH Issue #1280)
- Understand how many edits are proposed vs. accepted in logging
- Encourage both types of agents to propose more edits

## Problem
Mode A's proposer prompt actively biases DOWN at three layers: (1) `EDIT_BUDGET` constant ("propose AT MOST 3 atomic edits per cycle... Fewer surgical edits ship; sprawling rewrites get discarded") at `proposerPrompt.ts:67-70`; (2) soft rule #3 "Prefer one-sentence edits over multi-sentence rewrites" at `proposerPrompt.ts:8`; (3) soft rule #6 "Edit only when the change demonstrably improves..." at `proposerPrompt.ts:11`. Mode B has parameterized version of the same anti-pattern (`Edit budget: make AT MOST ${softCap} distinct improvements per response... Surgical changes ship; sprawling rewrites make the diff engine and approver drop everything.` at `proposerPromptRewrite.ts:45`) plus an identical SOFT_RULES array (`proposerPromptRewrite.ts:6-13`) and an `editingProposerSoftCap` config knob (default 3, range 1-10) that's the source-of-truth for that AT-MOST count. There is also a per-atomic-edit length soft cap `EDIT_NEWTEXT_LENGTH_CAP = 500` (constants.ts:30, commented "Soft per-edit length caps") that silently drops any atomic edit whose `newText.length > 500` chars (`validateEditGroups.ts:59`) — this would limit large sentence-order substitutions where both sides are multi-sentence. The user has asked for ALL soft caps removed and the proposer prompt stripped of bias-down guidance: "ask the proposers to propose whatever they think is best with no additional guidance, propose aggressively — larger rewrites swapping sentence order, more minor edits, etc."

## Options Considered
- [ ] **Option A (recommended): Strip soft caps + replace with one ambitious directive in one PR**: Remove `EDIT_BUDGET`, the SOFT_RULES array, the `editingProposerSoftCap` schema field + agent wiring, and `EDIT_NEWTEXT_LENGTH_CAP` (or raise to effectively unbounded). Replace the soft-rules section with one line: "Propose whatever edits you judge will most improve the article — large structural rewrites, sentence-order swaps, many minor polish edits, or any mix. Be ambitious." Keep hard guardrails: HARD_CONSTRAINT byte-fidelity rules in Mode A, FORMAT_SPEC / SCOPE_RULES (heading/citation/code-fence preservation) in Mode B, validator hard caps (`AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5`, `SIZE_RATIO_HARD_CAP=1.5`). Single PR, observable on the next staging trial run via the metrics added in Phase 2.
- [ ] **Option B: Soft caps removed, but keep a kill-switch env var to re-enable**: Same removal as A but gate the bias-down language behind `EVOLUTION_EDITING_SOFT_CAPS_ENABLED='false'` (default off). Lets you roll back without a code change if Mode A goes wildly out of bounds and Mode B's `iterative_edit_drift_rate` spikes. Adds permanent dead-code complexity for a behavior we're trying to remove.
- [ ] **Option C: Two-phase — gradual relaxation**: First raise the caps (e.g. `EDIT_BUDGET=10`, `editingProposerSoftCap` default 10), observe a stage run, then remove entirely. Lowest-risk but spreads the work across two PRs and delays the data we want to see.

**Recommendation: Option A.** Hard caps remain in place; nothing the proposer does can produce malformed output. Worst case is more proposed-but-rejected edits per cycle, which is exactly the data we want to measure to find out whether the bottleneck is approver strictness vs. proposer timidity.

## Phased Execution Plan

### Phase 1: Telemetry — make proposed/accepted/applied first-class metrics
Per /research, today's `iterative_edit_accept_rate` metric is catalogued but `compute: () => 0` and has no writer. We need real numbers BEFORE we change the prompts, then again after, to attribute the change.

- [ ] Add to `evolution/src/lib/metrics/types.ts:22-134` `STATIC_METRIC_NAMES`: `iterative_edit_proposed_groups`, `iterative_edit_accepted_groups`, `iterative_edit_applied_groups`, `iterative_edit_proposed_atomic`, `iterative_edit_applied_atomic`.
- [ ] Add catalog entries in `evolution/src/lib/core/metricCatalog.ts` (mirror the `iterative_edit_cost` shape; `category: 'count'`, `formatter: 'integer'`, `timing: 'at_finalization'`).
- [ ] Add an `invocationMetrics: FinalizationMetricDef[]` array on `IterativeEditingAgent` (`evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`) with five compute functions that read `execution_detail.cycles[*]` and sum across cycles. `IterativeEditingRewriteAgent` inherits these automatically (it subclasses `IterativeEditingAgent`).
- [ ] Wire the existing `iterative_edit_accept_rate` `compute: () => 0` in `RunEntity.ts:59` to a real ratio (`accepted_atomic / proposed_atomic` from invocation-summed metrics) so the rubber-stamp 0.95 alert documented in `editing_agents.md` actually fires.
- [ ] Add `accepted_atomic_count` to each cycle row in `runEditingCycle.ts` (sum `atomicEdits.length` of groups whose `groupNumber` is in `reviewDecisions` with `decision==='accept'`). This is the data we need for the atomic-level numerator.
- [ ] Roll up at strategy + experiment level via `atPropagation` entries on `StrategyEntity` and `ExperimentEntity` (sum aggregator). Mirror the existing `total_iterative_edit_cost` / `avg_iterative_edit_cost_per_run` shape.
- [ ] Surface per-cycle proposed/accepted/applied counts in the invocation Overview panel by extending `DETAIL_VIEW_CONFIGS.iterative_editing` cycles-table columns in `evolution/src/lib/core/detailViewConfigs.ts:444-514`.

### Phase 2: Remove soft caps from both proposer prompts
- [ ] **`proposerPrompt.ts` (Mode A)**: delete the `EDIT_BUDGET` constant (lines 67-70) and its splice at line 102. Delete the entire `SOFT_RULES` array (lines 5-12) and its rendering (lines 104-105) plus the "Soft rules — follow these unless the edit demonstrably improves the article:" preamble. Add one line in its place: `'Propose whatever edits you judge will most improve the article — large structural rewrites, sentence-order swaps, many minor polish edits, or any mix. Be ambitious.'`. Keep `HARD_CONSTRAINT`, `SYNTAX_DOCS`, `FAILURE_GALLERY`, `WORKED_EXAMPLE`, `SELF_CHECK` — these enforce mechanical correctness, not edit quantity.
- [ ] **`proposerPromptRewrite.ts` (Mode B)**: delete the `Edit budget: make AT MOST ${softCap}...` line (45) and the `softCap` parameter from `buildProposerSystemPromptRewrite` (line 37). Delete the `SOFT_RULES` array (lines 6-13) and its rendering (lines 47-48) plus preamble. Add the same one-line ambitious directive. Keep `FORMAT_SPEC` and `SCOPE_RULES` — Mode B has no inline markup constraint, so heading-structure / citation / code-fence preservation must come from the prompt or `computeMarkupFromRewrite` will produce broken diffs.
- [ ] Update `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` and `proposerPromptRewrite.test.ts` to assert: (a) the new ambitious-directive line is present; (b) `EDIT_BUDGET` / "AT MOST N" / "Prefer one-sentence" / "Surgical changes ship" / "sprawling rewrites" strings are absent.

### Phase 3: Remove `editingProposerSoftCap` from schema + agent + downstream
- [ ] **`evolution/src/lib/schemas.ts:801`**: delete the `editingProposerSoftCap` field from `iterationConfigSchema`.
- [ ] **`evolution/src/lib/schemas.ts:930-932`**: delete the superRefine gate "editingProposerSoftCap only valid when agentType is iterative_editing_rewrite".
- [ ] **`evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:73`**: delete the `editingProposerSoftCap` entry from `FIELD_GATES`.
- [ ] **`evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts:145, 157, 205-206, 213`**: drop the field from the local iteration-config type, delete `const proposerSoftCap = iterCfg?.editingProposerSoftCap ?? 3;`, drop `proposerSoftCap` from the rewriteMode payload, and drop the corresponding `softCap` arg at the `buildProposerSystemPromptRewrite` call site.
- [ ] **Tests**: delete or rewrite `evolution/src/lib/schemas.test.ts:781-883` (the editingProposerSoftCap range + co-presence tests), `findOrCreateStrategy.test.ts:258-356,461` (hash-stability cases), `IterativeEditingAgent.test.ts:354` (local-type signature), `IterativeEditingRewriteAgent.test.ts:41` (config fixture).
- [ ] **Stage-config compatibility**: the two trial strategies (`4c984153-d72c-47d8-9242-2ed86b30f0e7` "rewrite on prompt 3 - trial" with `editingProposerSoftCap: 10` + `disableApproverFiltering: true`, and `0fb02b5f-0d58-4862-ad8e-7ff8d7863d0c` "other on prompt 3 - trial") will fail Zod parse on the dropped field. Decide between (a) add a one-shot `.passthrough()` or strip-unknown-field tolerance for the deprecated key in `parseStrategyConfigForLoad` so existing rows still load (recommended — silent), or (b) require the user to re-create the trial strategies. Recommend (a) — the field becomes a no-op rather than a load failure.

### Phase 4: Remove `EDIT_NEWTEXT_LENGTH_CAP`
- [ ] **`evolution/src/lib/core/agents/editing/constants.ts:30`**: delete (or raise to e.g. 20_000 — effectively unbounded for article-sized swaps) `EDIT_NEWTEXT_LENGTH_CAP = 500`. Today this silently drops any single atomic edit whose newText > 500 chars at `validateEditGroups.ts:59`, which blocks sentence-order swaps that substitute multi-sentence spans.
- [ ] **`evolution/src/lib/core/agents/editing/validateEditGroups.ts:6, 22, 59`**: drop the import and the check, or update the check to use the new threshold.
- [ ] **Tests**: update `validateEditGroups.test.ts` (if it asserts on `newText_too_long`) and any agent-level test asserting the drop reason.

### Phase 5: Staging A/B + write-up
- [ ] Re-run the two existing trial strategies on stage and one new strategy that uses Mode A. Capture the new per-invocation metrics across ≥20 invocations per agent type.
- [ ] Compare against the pre-change baseline (see /research § High Level Summary table) and record in `_progress.md` Phase 5: proposed_groups distribution, accept rate, applied count, average cycles, % zero-applied. Confirm Mode A's proposed-per-cycle moves out of the 0.7 floor.
- [ ] **Decision point** (record in `_progress.md`): if Mode A's accept rate stays ≤ 20% even after the prompt change, the next project should target approver strictness, not proposer count. /research § Q1 flagged this — Mode A is approver-bottlenecked, and stripping the proposer's soft caps measures whether more proposals translate into more accepts, or whether the approver is the binding constraint.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` — assert the ambitious-directive line is present and the banned strings ("AT MOST", "Prefer one-sentence", "Surgical changes ship", "sprawling rewrites get discarded") are absent.
- [ ] `evolution/src/lib/core/agents/editing/proposerPromptRewrite.test.ts` — same assertions; also assert `buildProposerSystemPromptRewrite()` no longer accepts a `softCap` argument.
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — if currently asserts on `newText_too_long`, remove or update.
- [ ] `evolution/src/lib/schemas.test.ts` — convert the `editingProposerSoftCap` range tests into a single "unknown-field-tolerated-on-load" test (Phase 3's compat path).
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — remove the soft-cap hash-stability tests.
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` + `IterativeEditingRewriteAgent.test.ts` — drop `editingProposerSoftCap` from fixtures; add a test asserting the five new invocationMetrics are populated from a synthetic `execution_detail.cycles` payload.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-pipeline.integration.test.ts` (or sibling) — drive a mocked-LLM iterative_editing iteration end-to-end and assert the five new metric rows land in `evolution_metrics` for the invocation entity.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — extend to assert proposed/accepted/applied counts render in the cycles-table column on the invocation detail page.

### Manual Verification
- [ ] Trigger one Mode A + one Mode B run on stage post-deploy. Compare proposed-per-cycle distribution against the pre-change `_research.md` baseline.
- [ ] Confirm the LogsTab and Subagents tab show the new metric values.
- [ ] Confirm `iterative_edit_accept_rate` is no longer zero on the admin run-detail page (it's been zero for everyone since the rubber-stamp-alert feature shipped because the writer was never implemented).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — verify per-cycle counts render correctly.

### B) Automated Tests
- [ ] `npm run test:unit -- proposerPrompt` + `npm run test:unit -- proposerPromptRewrite` + `npm run test:unit -- IterativeEditingAgent` + `npm run test:unit -- validateEditGroups` + `npm run test:unit -- schemas` + `npm run test:unit -- findOrCreateStrategy`
- [ ] `npm run test:integration -- evolution-pipeline`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/editing_agents.md` — update Configuration (drop `editingProposerSoftCap` row), Cost knobs table (drop the soft-cap row), and Operational metrics (add the five new invocation metrics + note that `iterative_edit_accept_rate` is now actually computed).
- [ ] `evolution/docs/multi_iteration_strategies.md` — drop `editingProposerSoftCap` from the iterationConfig schema documentation; update field-gate description.
- [ ] `evolution/docs/agents/overview.md` — drop the Phase-6 `editingProposerSoftCap=8` mention in the IterativeEditingAgent block.
- [ ] `evolution/docs/cost_optimization.md` — only if the cost-knob table calls out the soft cap (review).
- [ ] `evolution/docs/logging.md` — note the new per-invocation metric rows visible in LogsTab.
- [ ] No changes expected: `evolution/docs/architecture.md`, `criteria_agents.md`, `paragraph_recombine*.md`, `reference.md`, `data_model.md`, `prompt_editor.md`, `rating_and_comparison.md`, `variant_lineage.md`, `arena.md`, `curriculum.md`, `implicit_rubric_weights.md`, `evolution_metrics.md`, `metrics.md`, `visualization.md`, `minicomputer_deployment.md`, `strategies_and_experiments.md`, and the three main-app feature deep dives (`ai_suggestions_overview.md`, `writing_pipeline.md`, `markdown_ast_diffing.md`).

## Out of scope (flag for the user before /plan-review)
The user said "remove ALL soft caps" — I read this literally as the soft-cap surface (prompt directives that bias proposed-count down + the `editingProposerSoftCap` config knob + `EDIT_NEWTEXT_LENGTH_CAP`). The following are **hard caps** in code that also bound proposed count and would interact with "propose aggressively" + "swap sentence order"; flagging in case the user wants these moved too:

- `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE = 30` (constants.ts:6) — drops the highest-numbered groups when total atomic edits across a cycle exceed 30. If aggressive Mode A proposers emit 50 atomics per cycle, this silently discards ~20 before the approver even sees them.
- `AGENT_MAX_ATOMIC_EDITS_PER_GROUP = 5` (constants.ts:7) — drops any single group with > 5 atomic edits. A big multi-sentence swap implemented as one paired delete+insert is 2 atomics; safe. A bigger sectional reorganization expressed as a single group might trip it.
- `SIZE_RATIO_HARD_CAP = 1.5` (constants.ts:12) — drops groups when `newText.length / current.text.length > 1.5`. Limits how much the article can grow per cycle. Large rewrites that lengthen content might hit this.

If the user wants these raised/removed too, add a Phase 6 to do that. If not, the recommendation is leave them — they're safety rails that stop the article from inflating into nonsense, not edit-count biases.

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
