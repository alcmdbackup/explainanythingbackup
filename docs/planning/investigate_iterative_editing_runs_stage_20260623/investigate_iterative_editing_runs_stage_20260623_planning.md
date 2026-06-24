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
- [x] **Option A (recommended): Strip soft caps + replace with one ambitious directive in one PR**: Remove `EDIT_BUDGET`, the SOFT_RULES array, the `editingProposerSoftCap` schema field + agent wiring, and `EDIT_NEWTEXT_LENGTH_CAP` (or raise to effectively unbounded). Replace the soft-rules section with one line: "Propose whatever edits you judge will most improve the article — large structural rewrites, sentence-order swaps, many minor polish edits, or any mix. Be ambitious." Keep hard guardrails: HARD_CONSTRAINT byte-fidelity rules in Mode A, FORMAT_SPEC / SCOPE_RULES (heading/citation/code-fence preservation) in Mode B, validator hard caps (`AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5`, `SIZE_RATIO_HARD_CAP=1.5`). Single PR, observable on the next staging trial run via the metrics added in Phase 2.
- [x] **Option B: Soft caps removed, but keep a kill-switch env var to re-enable**: Same removal as A but gate the bias-down language behind `EVOLUTION_EDITING_SOFT_CAPS_ENABLED='false'` (default off). Lets you roll back without a code change if Mode A goes wildly out of bounds and Mode B's `iterative_edit_drift_rate` spikes. Adds permanent dead-code complexity for a behavior we're trying to remove.
- [x] **Option C: Two-phase — gradual relaxation**: First raise the caps (e.g. `EDIT_BUDGET=10`, `editingProposerSoftCap` default 10), observe a stage run, then remove entirely. Lowest-risk but spreads the work across two PRs and delays the data we want to see.

**Recommendation: Option A.** Hard caps remain in place; nothing the proposer does can produce malformed output. Worst case is more proposed-but-rejected edits per cycle, which is exactly the data we want to measure to find out whether the bottleneck is approver strictness vs. proposer timidity.

## Phased Execution Plan

### Phase 1: Telemetry — make proposed/accepted/applied first-class metrics + hard-cap drop counter

> **DEFERRED to follow-up project.** Phase 7's staging A/B can read the proposed/accepted/applied counts directly from `execution_detail.cycles[*].{proposedGroupsRaw, acceptedCount, appliedCount}` via `npm run query:staging` — the per-invocation rows already contain everything needed for the analysis. First-class metrics + the `iterative_edit_accept_rate` rewire + admin-UI cycles-table columns + invocation-Overview surfacing make admin-UI exploration nicer but are not blocking. Deferred to keep this PR scoped to the load-bearing behavior change (prompt rewrites + parser default + soft-cap removal).

Per /research, today's `iterative_edit_accept_rate` metric is catalogued but `compute: () => 0` and has no writer. We need real numbers BEFORE we change the prompts, then again after, to attribute the change. Plus a hard-cap drop counter so we can distinguish "proposer is now ambitious AND approver is the bottleneck" from "proposer is ambitious AND hard caps are silently censoring it" (the latter would look like an approver problem when it's actually a hard-cap-clipping problem).

- [ ] Add to `evolution/src/lib/metrics/types.ts:22-134` `STATIC_METRIC_NAMES`: `iterative_edit_proposed_groups`, `iterative_edit_accepted_groups`, `iterative_edit_applied_groups`, `iterative_edit_proposed_atomic`, `iterative_edit_applied_atomic`, **`iterative_edit_hard_cap_drops`** (sum of groups dropped pre-approver by hard rules — cycle-cap, group-cap, size-ratio, heading-cross, code-fence, list-boundary; sourced from `cycles[*].droppedPreApprover[*].reason`).
- [ ] Add catalog entries in `evolution/src/lib/core/metricCatalog.ts` (mirror the `iterative_edit_cost` shape; `category: 'count'`, `formatter: 'integer'`, `timing: 'at_finalization'`). Note that `STATIC_METRIC_NAMES` is a sort-sensitive `as const` array — preserve alphabetical-by-prefix grouping; place the 6 new names next to existing `iterative_edit_*` entries.
- [ ] Add an `invocationMetrics: FinalizationMetricDef[]` array on `IterativeEditingAgent` (`evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`) with six compute functions that read `execution_detail.cycles[*]` and sum across cycles. `IterativeEditingRewriteAgent` inherits these automatically (it subclasses `IterativeEditingAgent`). Place metric definitions in `RunEntity.metrics.atFinalization` for run-level aggregation (NOT `duringExecution` — that's where the existing zero-compute live and propagation extractors won't find them there).
- [ ] Wire the existing `iterative_edit_accept_rate` `compute: () => 0` in `RunEntity.ts:59` to a real ratio (`accepted_atomic / proposed_atomic` from invocation-summed metrics) so the rubber-stamp 0.95 alert documented in `editing_agents.md` actually fires. **Note**: this will activate the documented 0.95 rubber-stamp alert for the first time. Add a note to `editing_agents.md` § Operational metrics that the threshold may need re-tuning after first observation — pre-fix the value was always 0; post-fix it will be ~0.16 (vanilla) to ~0.45 (rewrite). The 0.95 threshold remains valid for genuine rubber-stamping detection.
- [ ] Add `accepted_atomic_count` to each cycle row in `runEditingCycle.ts` (sum `atomicEdits.length` of groups whose `groupNumber` is in `reviewDecisions` with `decision==='accept'`). This is the data we need for the atomic-level numerator. Add a unit test in `runEditingCycle.test.ts` asserting the new field lands in the cycle row.
- [ ] Create a shared fixture factory `evolution/src/lib/core/agents/editing/__fixtures__/iterativeEditingExecutionDetail.ts` exposing `makeCycle({proposedGroupCount, atomicEditsPerGroup, accepted, applied, droppedPreApprover})` to keep the 6 metric compute tests + integration test + E2E test in sync on `execution_detail` shape.
- [ ] Roll up at strategy + experiment level via `atPropagation` entries on `StrategyEntity` and `ExperimentEntity` (sum aggregator). Mirror the existing `total_iterative_edit_cost` / `avg_iterative_edit_cost_per_run` shape. Source from `sourceEntity: 'run'`, `sourceMetric: <the new metric>`.
- [ ] Surface per-cycle proposed/accepted/applied counts in the invocation Overview panel by extending `DETAIL_VIEW_CONFIGS.iterative_editing` cycles-table columns in `evolution/src/lib/core/detailViewConfigs.ts:444-514`. Add a `data-testid` attribute (e.g. `cycle-proposed-count`, `cycle-accepted-count`, `cycle-applied-count`) on each new column cell for E2E selector stability per testing_overview.md Rule 3. Mode B (`iterative_editing_rewrite`) reuses Mode A's config via class inheritance (no separate `DETAIL_VIEW_CONFIGS.iterative_editing_rewrite` key — note this in a code comment so future readers don't accidentally diverge).

### Phase 2: Remove soft caps from both proposer prompts (preserve structural-protection rules)
- [x] **`proposerPrompt.ts` (Mode A)**: delete the `EDIT_BUDGET` constant (lines 67-70) and its splice at line 102. **Split** the `SOFT_RULES` array (lines 5-12): KEEP items 1, 2, 4 (preserve quotes/citations/URLs; do not modify headings; do not edit code fences) — these are structural-protection rules, not bias-down language. Items 2 and 4 are also independently enforced by `validateEditGroups.ts` hard rules (heading-cross, code-fence); item 1 has no validator backstop and must remain in the prompt. DROP items 3, 5, 6 (Prefer one-sentence edits; preserve voice/tone; edit only when demonstrably improving) — these are bias-down quality cautions. Replace the "Soft rules — follow these unless the edit demonstrably improves the article:" preamble with "Preservation rules — keep the article structurally intact:". Add the ambitious + granularity directive in its own paragraph as drafted in § Proposed prompts. Keep `HARD_CONSTRAINT`, `SYNTAX_DOCS`, `FAILURE_GALLERY`, `WORKED_EXAMPLE`, `SELF_CHECK` unchanged.
- [x] **`proposerPromptRewrite.ts` (Mode B)**: delete the `Edit budget: make AT MOST ${softCap}...` line (45) and the `softCap` parameter from `buildProposerSystemPromptRewrite` (line 37, becomes zero-arg). Delete `SOFT_RULES` items 3, 5, 6 same as Mode A; **keep** items 1, 2, 4 (preservation). Keep `FORMAT_SPEC` and `SCOPE_RULES` (already contain heading/citation/code-fence preservation as the structural backstop). Add ambitious + granularity directive as drafted in § Proposed prompts.
- [x] Update `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` and `proposerPromptRewrite.test.ts` to assert: (a) the new ambitious-directive line is present; (b) "Preserve quotes, citations" / "Do not introduce new headings" / "Do not edit text inside code fences" preservation strings are present; (c) "AT MOST" / "Prefer one-sentence" / "Surgical changes ship" / "sprawling rewrites" / "voice, tone, and reading level" strings are absent; (d) for Mode B, `buildProposerSystemPromptRewrite` is callable with zero arguments.

### Phase 3: Remove `editingProposerSoftCap` from schema + agent + downstream
- [x] **`evolution/src/lib/schemas.ts:801`**: delete the `editingProposerSoftCap` field from `iterationConfigSchema`.
- [x] **`evolution/src/lib/schemas.ts:930-932`**: delete the superRefine gate "editingProposerSoftCap only valid when agentType is iterative_editing_rewrite".
- [x] **`evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:73`**: delete the `editingProposerSoftCap` entry from `FIELD_GATES`.
- [x] **`evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts:145, 157, 205-206, 213`**: drop the field from the local iteration-config type, delete `const proposerSoftCap = iterCfg?.editingProposerSoftCap ?? 3;`, drop `proposerSoftCap` from the rewriteMode payload, and drop the corresponding `softCap` arg at the `buildProposerSystemPromptRewrite` call site.
- [x] **Tests**: delete or rewrite `evolution/src/lib/schemas.test.ts:781-883` (the editingProposerSoftCap range + co-presence tests), `findOrCreateStrategy.test.ts:258-356,461` (hash-stability cases), `IterativeEditingAgent.test.ts:354` (local-type signature), `IterativeEditingRewriteAgent.test.ts:41` (config fixture).
- [x] **Stage-config compatibility**: the two trial strategies (`4c984153-d72c-47d8-9242-2ed86b30f0e7` "rewrite on prompt 3 - trial" with `editingProposerSoftCap: 10` + `disableApproverFiltering: true`, and `0fb02b5f-0d58-4862-ad8e-7ff8d7863d0c` "other on prompt 3 - trial") will continue to load. Zod's default behavior on `iterationConfigSchema` is to **silently strip unknown keys** (no `.strict()` is in use today — verify by inspecting `evolution/src/lib/schemas.ts`'s schema declaration mode before deploy); existing JSONB rows with the dropped fields parse cleanly and the fields are dropped from the in-memory config. **Hash drift is acceptable for our use case**: Phase 7's planned re-run uses the existing `strategy_id` directly (runs are created against an existing strategy row, not re-found via hash dedup). `findOrCreateStrategy.hashStrategyConfig` is only consulted when a user submits a NEW strategy through the wizard; for already-persisted strategies the `id` is the lookup key. Verify the wizard's submission path also strips the dropped fields (so a user can't accidentally re-submit a "legacy" shape that fails parse) — if it does, no migration is needed. If `.strict()` IS in use, add `.passthrough()` to `iterationConfigSchema` for one release as the compat path.

### Phase 4: Remove `EDIT_NEWTEXT_LENGTH_CAP`
- [x] **`evolution/src/lib/core/agents/editing/constants.ts:30`**: delete (or raise to e.g. 20_000 — effectively unbounded for article-sized swaps) `EDIT_NEWTEXT_LENGTH_CAP = 500`. Today this silently drops any single atomic edit whose newText > 500 chars at `validateEditGroups.ts:59`, which blocks sentence-order swaps that substitute multi-sentence spans.
- [x] **`evolution/src/lib/core/agents/editing/validateEditGroups.ts:6, 22, 59`**: drop the import and the check, or update the check to use the new threshold.
- [x] **Tests**: update `validateEditGroups.test.ts` (if it asserts on `newText_too_long`) and any agent-level test asserting the drop reason.

### Phase 5: Maximize approver granularity — no edit bundling
The user's "as granular control for approver as possible (e.g. no aggregating edits together)" requires three default-behavior flips:

- [x] **Mode A parser default — per-span groups instead of adjacency auto-merge.** Today `parseProposedEdits.ts:185-199` walks unnumbered edits left-to-right and auto-merges runs of "consecutive markup spans separated only by whitespace + ≤1 newline" into one group. Change the default so each unnumbered atomic edit gets its own group number, period. Keep the explicit `[#N]` tag escape hatch so a LLM-supplied bundle is still honored.
- [x] **Preserve standard-CriticMarkup paired substitution.** The paired delete+insert form `{~~ X ~~}{++ Y ++}` is structurally ONE substitution edit, not two. Today the merge at `parseProposedEdits.ts:212-234` relies on the delete and insert sharing a group number (which the adjacency pass assigned). After per-span groups, those two spans get different numbers. Fix the paired-merge step to instead detect "delete immediately followed by insert with NO source characters between markup spans (or only horizontal whitespace, no newline)" and merge those into a `replace` regardless of group numbers.
- [x] **Mode B default — no `coalesceAdjacentGroups` + no `capGroupsByMagnitude`.** Today `runEditingCycle.ts:308-312` runs both whenever `coalesceAndCap = !iterCfg?.disableApproverFiltering`. Default it to OFF: every diff atomic the rewrite produces gets sent to the approver as its own singleton group. The existing `disableApproverFiltering: true` config field becomes the (now-vestigial) opt-back-IN. Plan: drop the field from the schema and hardwire the off behavior (matches the user's "as granular as possible" direction).
- [x] **Tests for parser-default flip** — add to `parseProposedEdits.test.ts` the following explicit cases: (a) two unnumbered adjacent inserts (whitespace + ≤1 newline between, no paragraph break) → now expect TWO separate groups (was 1); (b) three unnumbered edits in a single line → expect THREE separate groups; (c) standard CriticMarkup paired form `{~~ X ~~}{++ Y ++}` with NO chars between markup spans → ONE merged `replace` group; (d) paired form with a single space between spans → ONE merged `replace` group (tolerate horizontal whitespace); (e) paired form with a NEWLINE between spans → TWO separate groups (paragraph-break-like behavior); (f) explicit `[#N]`-tagged spans across non-adjacent positions → SAME group number honored. Update existing cases that assert adjacency-merged groups (e.g. two adjacent inserts → one group) to expect two separate groups.
- [x] **Tests for Mode B coalesce-off**: update `runEditingCycle.test.ts` to assert that when `iterCfg.disableApproverFiltering` is absent (the new default), the cycle-1 approver receives the parser-output groups uncoalesced and uncapped. Keep `coalesceAdjacentGroups.test.ts` + `capGroupsByMagnitude.test.ts` covering the underlying functions (still useful as escape-hatch tools).
- [x] **Strip `disableApproverFiltering` from `schemas.ts` + `findOrCreateStrategy.ts` + tests** — identical migration pattern to Phase 3's `editingProposerSoftCap` (Zod default strip-unknown on load; existing strategy rows continue to load + run; existing strategy_id remains usable for Phase 7 A/B). Specific files to update:
  - `evolution/src/lib/schemas.ts`: drop the `disableApproverFiltering` field declaration + its superRefine gate.
  - `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:74`: drop the FIELD_GATES entry.
  - `evolution/src/lib/schemas.test.ts`: remove range / co-presence tests for `disableApproverFiltering` (sibling block to lines 781-883 for `editingProposerSoftCap`).
  - `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`: remove `disableApproverFiltering` hash-stability cases (sibling block to lines 343-356, 461 for `editingProposerSoftCap`).
  - `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` + `IterativeEditingRewriteAgent.test.ts`: drop the field from fixtures.
  - Add an affirmative "unknown-field-tolerated-on-load" test in `schemas.test.ts` for both dropped fields: assert that an `iterationConfigs` payload containing `editingProposerSoftCap: 3` and `disableApproverFiltering: true` parses cleanly (no error) and that the resulting in-memory config does NOT contain either field.

### Phase 6: Update both proposer prompts to reflect granularity
- [x] The new ambitious-directive line (Phase 2) must explicitly say each CriticMarkup span is its own decision. Final Mode A text and Mode B text drafted below in § "Proposed prompts".

### Phase 7: Staging A/B + write-up
- [x] **Freeze pre-change baseline in `_progress.md` Phase 7** before deploy: copy the per-agent / per-cycle table from `_research.md` § High Level Summary (proposed_per_cycle 0.70/9.25, accept rate 0.27/0.47, zero-applied 85%/25%, median Elo). This is the comparison anchor.
- [x] Re-run the two existing trial strategies on stage **using their existing `strategy_id`s** (not new wizard submissions) and one new strategy that uses Mode A. Capture the 6 new per-invocation metrics across ≥20 invocations per agent type.
- [x] Compare against the pre-change baseline (frozen above) and record in `_progress.md` Phase 7: proposed_groups distribution, accept rate, applied count, average cycles, % zero-applied, **hard-cap drop rate**. Confirm Mode A's proposed-per-cycle moves out of the 0.7 floor.
- [x] **Confidence interval threshold**: report mean ± 95% normal-approx CI for the accept-rate delta. The change is "significant" only if the CI excludes zero AND the delta magnitude > 0.10.
- [x] **Decision point** (record in `_progress.md`): if Mode A's accept rate stays ≤ 20% even after the prompt change (per the CI test above), the next project should target approver strictness, not proposer count. /research § Q1 flagged this — Mode A is approver-bottlenecked, and stripping the proposer's soft caps measures whether more proposals translate into more accepts, or whether the approver is the binding constraint. If `iterative_edit_hard_cap_drops > 0.50 × iterative_edit_proposed_groups` on either mode, follow-up project must raise/remove the hard caps (`AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5`, `SIZE_RATIO_HARD_CAP=1.5`) before drawing conclusions about approver strictness.

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` — assert the ambitious-directive line is present and the banned strings ("AT MOST", "Prefer one-sentence", "Surgical changes ship", "sprawling rewrites get discarded") are absent.
- [x] `evolution/src/lib/core/agents/editing/proposerPromptRewrite.test.ts` — same assertions; also assert `buildProposerSystemPromptRewrite()` no longer accepts a `softCap` argument.
- [x] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — if currently asserts on `newText_too_long`, remove or update.
- [x] `evolution/src/lib/schemas.test.ts` — convert the `editingProposerSoftCap` range tests into a single "unknown-field-tolerated-on-load" test (Phase 3's compat path).
- [x] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — remove the soft-cap hash-stability tests.
- [x] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` + `IterativeEditingRewriteAgent.test.ts` — drop `editingProposerSoftCap` from fixtures; add a test asserting the five new invocationMetrics are populated from a synthetic `execution_detail.cycles` payload.

### Integration Tests
- [x] Create `src/__tests__/integration/evolution-iterative-editing-metrics.integration.test.ts` — drive a mocked-LLM `iterative_editing` iteration end-to-end and assert the 6 new metric rows land in `evolution_metrics` for the invocation entity, plus the wired `iterative_edit_accept_rate` produces a non-zero value. (Closest existing sibling: `evolution-cost-attribution.integration.test.ts` — pattern after its structure.)

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — extend to assert proposed/accepted/applied counts render in the cycles-table column on the invocation detail page. Use the new `data-testid="cycle-proposed-count"`, `cycle-accepted-count`, `cycle-applied-count` selectors per testing_overview.md Rule 3. Cover both Mode A (`iterative_editing`) and Mode B (`iterative_editing_rewrite`) — add a Mode B variant test in the same spec file using the existing test-data-factory pattern.

### Manual Verification
- [x] Trigger one Mode A + one Mode B run on stage post-deploy. Compare proposed-per-cycle distribution against the pre-change `_research.md` baseline.
- [x] Confirm the LogsTab and Subagents tab show the new metric values.
- [x] Confirm `iterative_edit_accept_rate` is no longer zero on the admin run-detail page (it's been zero for everyone since the rubber-stamp-alert feature shipped because the writer was never implemented).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — verify per-cycle counts render correctly.

### B) Automated Tests
- [x] `npm run test:unit -- proposerPrompt` + `npm run test:unit -- proposerPromptRewrite` + `npm run test:unit -- IterativeEditingAgent` + `npm run test:unit -- IterativeEditingRewriteAgent` + `npm run test:unit -- validateEditGroups` + `npm run test:unit -- parseProposedEdits` + `npm run test:unit -- runEditingCycle` + `npm run test:unit -- schemas` + `npm run test:unit -- findOrCreateStrategy`
- [x] `npm run test:integration -- evolution-pipeline`
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/editing_agents.md` — update Configuration (drop `editingProposerSoftCap` row), Cost knobs table (drop the soft-cap row), and Operational metrics (add the six new invocation metrics + note that `iterative_edit_accept_rate` is now actually computed).
- [x] `evolution/docs/multi_iteration_strategies.md` — drop `editingProposerSoftCap` from the iterationConfig schema documentation; update field-gate description.
- [x] `evolution/docs/agents/overview.md` — drop the Phase-6 `editingProposerSoftCap=8` mention in the IterativeEditingAgent block.
- [x] `evolution/docs/cost_optimization.md` — only if the cost-knob table calls out the soft cap (review).
- [x] `evolution/docs/logging.md` — note the new per-invocation metric rows visible in LogsTab.
- [x] No changes expected: `evolution/docs/architecture.md`, `criteria_agents.md`, `paragraph_recombine*.md`, `reference.md`, `data_model.md`, `prompt_editor.md`, `rating_and_comparison.md`, `variant_lineage.md`, `arena.md`, `curriculum.md`, `implicit_rubric_weights.md`, `evolution_metrics.md`, `metrics.md`, `visualization.md`, `minicomputer_deployment.md`, `strategies_and_experiments.md`, and the three main-app feature deep dives (`ai_suggestions_overview.md`, `writing_pipeline.md`, `markdown_ast_diffing.md`).

## CI exposure
This work touches `evolution/src/lib/**` heavily, so `ci.yml`'s evolution-changes classifier will trigger the broader evolution E2E suite (not just `admin-evolution-iterative-editing.spec.ts`). Expect ~3-4 additional minutes of CI vs. a non-evolution change. Specs that may interact with parser-default flips: `admin-evolution-run-pipeline.spec.ts`, the existing iterative-editing flow specs. None should regress (the new defaults are behavior-additive), but watch for surprises.

## Rollback plan
This work is staging-bound — no migrations, no production deploys. Option B (env-var kill-switch) was explicitly rejected in § Options Considered. Rollback path if Mode A's aggressive prompt regresses Elo or the granular-by-default parser produces excessive cycle-fail rates on stage:

1. **Code revert via `git revert` of the PR merge commit** (or a series of reverts if granularity was merged separately). All changes in this project are confined to `evolution/src/lib/core/agents/editing/*`, `evolution/src/lib/schemas.ts`, `evolution/src/lib/core/{metricCatalog.ts,entities/*}`, `evolution/src/lib/metrics/types.ts`, `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`, and `evolution/src/lib/core/detailViewConfigs.ts` plus their tests + docs. No infrastructure, no DB schema, no env vars.
2. **Decision thresholds (Phase 7 trigger)**: revert if any of the following fire on stage after ≥3 runs of ≥10 invocations each:
   - Mode A `iterative_edit_drift_rate > 0.40` (default alert is 0.30)
   - Mode A `iterative_edit_proposed_groups` average drops below the pre-change 0.70 (would indicate prompt-rewrite confused the model)
   - Mode A or Mode B per-cycle `iterative_edit_hard_cap_drops > 0.50 × iterative_edit_proposed_groups` (would indicate the new aggressive prompt is being silently censored by the 30-atomic cycle cap — would change the plan: also raise/remove hard caps)
   - Median variant Elo on the trial strategies drops > 50 Elo points vs pre-change baseline frozen in `_progress.md` Phase 7

## Out of scope (flag for the user before /plan-review)
The user said "remove ALL soft caps" — I read this literally as the soft-cap surface (prompt directives that bias proposed-count down + the `editingProposerSoftCap` config knob + `EDIT_NEWTEXT_LENGTH_CAP`). The following are **hard caps** in code that also bound proposed count and would interact with "propose aggressively" + "swap sentence order"; flagging in case the user wants these moved too:

- `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE = 30` (constants.ts:6) — drops the highest-numbered groups when total atomic edits across a cycle exceed 30. If aggressive Mode A proposers emit 50 atomics per cycle, this silently discards ~20 before the approver even sees them.
- `AGENT_MAX_ATOMIC_EDITS_PER_GROUP = 5` (constants.ts:7) — drops any single group with > 5 atomic edits. A big multi-sentence swap implemented as one paired delete+insert is 2 atomics; safe. A bigger sectional reorganization expressed as a single group might trip it.
- `SIZE_RATIO_HARD_CAP = 1.5` (constants.ts:12) — drops groups when `newText.length / current.text.length > 1.5`. Limits how much the article can grow per cycle. Large rewrites that lengthen content might hit this.

If the user wants these raised/removed too, add a Phase 6 to do that. If not, the recommendation is leave them — they're safety rails that stop the article from inflating into nonsense, not edit-count biases.

## Proposed prompts

### Mode A — `buildProposerSystemPrompt()` in `evolution/src/lib/core/agents/editing/proposerPrompt.ts`

```
You propose edits to an article. Your output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits.

HARD CONSTRAINT — read twice before writing.

Your response contains EXACTLY ONE thing: an <output>…</output> block. Inside
that block, reproduce the source article CHARACTER-FOR-CHARACTER, with your
edits expressed ONLY through inline CriticMarkup. Do NOT echo the <source>
block in your response — the source is given to you in the user message
solely for reference; your response only contains <output>…</output>.

Two byte-equality rules apply to the contents of <output>. Violating either
causes ALL your edits to be discarded:

  RULE 1 (outside-markup fidelity): every byte OUTSIDE a {++…++}, {--…--}, or
  {~~…~~} span must match the source verbatim — same words, same punctuation,
  same spacing.

  RULE 2 (old-side fidelity): the "old" side of every {~~old~>new~~} (or paired
  {~~old~~}{++new++}) must be COPIED from the source. Do not rephrase, normalize,
  or "clean up" the old side. If you wouldn't quote it that way under oath, don't
  put it in old.

CriticMarkup forms:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Each CriticMarkup span is ONE independent edit. The reviewer accepts or
rejects each span on its own merits. The only exception is the paired
substitution form `{~~ old ~~}{++ new ++}` — an immediately-adjacent
delete+insert pair with no source characters between them is treated as one
substitution edit. Do not bundle unrelated edits together: maximize the
number of independent decisions you give the reviewer.

Failure patterns observed on this exact task — avoid:

  PATTERN A — paraphrase outside markup (RULE 1 violation):
    Source:  "The cat sat on the mat. It purred softly."
    BAD:     "The {++ small ++}cat sat on a mat. It purred softly."
    GOOD:    "The {++ small ++}cat sat on the mat. It purred softly."
    (BAD changed "the mat" to "a mat" outside any markup span.)

  PATTERN B — old-side rephrased (RULE 2 violation):
    Source:  "The cat sat on the mat."
    BAD:     "{~~A cat sat on the mat~>The cat curled up on the mat~~}."
    GOOD:    "{~~The cat sat on the mat~>The cat curled up on the mat~~}."
    (BAD's old side starts with "A cat"; the source starts with "The cat".)

Worked example (study the structure, not the topic):

  GIVEN this source article (provided to you in the user message inside
  <source>…</source> — do NOT echo it in your response):

    The product launched in March. Users liked it. Revenue grew quickly.

  YOUR RESPONSE — ONE <output>…</output> block, nothing else:

    <output>
    The product launched in March. {~~Users liked it.~>Early users gave it
    strong reviews.~~} Revenue grew{++ 40% quarter-over-quarter++} quickly.
    </output>

  Note: the first sentence is byte-identical. The substitution's old side
  ("Users liked it.") is copied verbatim from the source. The insertion sits
  between two source bytes ("grew" and " quickly") with no surrounding
  rewording.

Propose whatever edits you judge will most improve the article — large
structural rewrites, sentence-order swaps, many minor polish edits, or any
mix. Be ambitious. There is no edit budget and no preference for small vs.
large edits. The reviewer independently vets each edit, so the cost of
proposing a marginal one is low and the cost of withholding a useful one is
high. If a paragraph could be substantially better, rewrite the whole
paragraph in one substitution; if a single word is wrong, fix it. Propose
both ends of that spectrum freely.

Preservation rules — keep the article structurally intact:
  1. Preserve quotes, citations, and URLs exactly as they appear in the original.
  2. Do not introduce new headings or modify existing heading lines.
  3. Do not edit text inside code fences (```).

Self-check before responding (do this literally, not metaphorically):
  1. Mentally delete every {++…++} and the new-side of every {~~old~>new~~}.
  2. Mentally keep every {--…--} content and the old-side of every {~~old~>new~~}.
  3. The result must equal the text inside <source>…</source>, byte-for-byte
     (whitespace differences ok, word/punctuation differences NOT ok).
  4. If it doesn't match, fix your output before responding.

Output the <output>…</output> block ONLY. No commentary, no summary, no
preamble, and no echo of the <source> block.
```

### Mode B — `buildProposerSystemPromptRewrite()` in `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts`

(No `softCap` parameter — function takes no args.)

```
You propose targeted edits to an article by rewriting it.

Output format — respond with EXACTLY two sections, in this order:

## Rationale
[2–3 sentences explaining the changes you propose to make and why. This is your
intent statement; the approver reads it as priming context (not as ground truth).]

## Rewrite
[The full article body, rewritten to incorporate your edits. Plain markdown — no
CriticMarkup, no commentary, no preamble. Output the article only.]

Scope rules:

- The "## Rewrite" section MUST contain the entire article. Do not truncate; do
  not summarize; do not commentate.
- Preserve the existing heading structure: do NOT add or remove headings, and do
  NOT change heading levels (h1 stays h1, h2 stays h2).
- Preserve quotes, citations (e.g. /standalone-title?t=Term URLs), and code
  fences exactly as they appear in the source.
- Do not output any text after the article body. The final character of your
  response should be the last character of the article (or a single trailing
  newline).

Propose whatever edits you judge will most improve the article — large
structural rewrites, sentence-order swaps, many minor polish edits, or any
mix. Be ambitious. There is no edit budget and no preference for small vs.
large edits. The reviewer will see your rewrite as a sequence of independent
edit diffs — each contiguous change is its own decision — and vet each one
separately, so the cost of proposing a marginal edit is low and the cost of
withholding a useful one is high. Aim to rewrite generously rather than
sparingly.

Preservation rules — keep the article structurally intact:
  1. Preserve quotes, citations, and URLs exactly as they appear in the original.
  2. Do not introduce new headings or modify existing heading lines.
  3. Do not edit text inside code fences (```).

Self-check before responding:
  1. Confirm your response begins with the literal heading "## Rationale" on
     its own line.
  2. Confirm "## Rewrite" appears below it on its own line.
  3. Confirm the Rewrite section is the full article body.
  4. Confirm there is NO additional commentary after the article body.
```

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
