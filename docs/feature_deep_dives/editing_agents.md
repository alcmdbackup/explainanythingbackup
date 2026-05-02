# Editing Agents Deep Dive

## Overview

`IterativeEditingAgent` is a propose-then-review editing pipeline that operates on existing pool variants. Per parent variant, it runs up to N propose-review-apply cycles using two LLM calls per cycle (Proposer + Approver) plus deterministic position-based application. Only the final cycle's text materializes as a new `Variant` in the pool; intermediate cycles live in `execution_detail.cycles[i].childText` only.

Reintroduced in `feat/bring_back_editing_agents_evolution_20260430` after the V1 rubric-driven version was removed in 4f03d4f6.

## Algorithm (per cycle)

1. **Proposer** (`iterative_edit_propose`) — LLM call. System prompt embeds soft rules (preserve quotes/citations/URLs, no new headings, prefer one-sentence edits, no edits in code blocks, preserve voice/tone). User prompt is the article body. Output is the FULL ARTICLE BODY VERBATIM with inline numbered CriticMarkup edits:
   - `{++ [#N] inserted text ++}`
   - `{-- [#N] deleted text --}`
   - `{~~ [#N] old text ~> new text ~~}`
2. **Implementer pre-check** (deterministic):
   - Parse markup → atomic edits grouped by `[#N]`. Adjacent paired add+delete with same number normalized to a `replace`.
   - Strip markup → `recoveredSource`. Compare against `current.text` → drift check.
   - On drift: classify magnitude. Major → abort. Minor → recovery LLM call (`iterative_edit_drift_recovery`).
   - Apply hard rules per group (length cap, heading-cross, code-fence, list-boundary, horizontal rule, paragraph break). Group-level coherence: any atomic edit in a group fails any rule → drop the WHOLE group.
   - Apply size-ratio guardrail: drop highest-numbered groups until `newText.length / current.text.length ≤ 1.5`.
3. **Approver** (`iterative_edit_review`) — LLM call. Receives the marked-up article + per-group summary. Outputs JSONL: one `{groupNumber, decision, reason}` per group.
4. **Implementer apply** (deterministic): collect accepted groups, detect range overlaps between groups (drop the later group on conflict), verify each atomic edit's context-string failsafe + `oldText` match against `current.text` (drop group on mismatch), sort survivors by `range.start` descending, apply right-to-left.
5. If `appliedCount > 0` and format-valid: update `current = newText` for next cycle. Else: exit cycle loop.

After cycle loop terminates: emit final `Variant` if any cycle produced edits. `parent_variant_id` is the original input parent (NOT cycle-N-1's intermediate).

## Configuration

**Strategy-level** (in `evolution_strategies.config`):
- `editingModel?: string` — used for the Proposer LLM call. Falls back to `generationModel`.
- `approverModel?: string` — used for the Approver LLM call. Falls back to `editingModel`. **For maximum auditability, choose a model different from `editingModel`** — same model means the Approver may rubber-stamp its own edits.
- `driftRecoveryModel?: string` — used for the drift recovery LLM call. Defaults to `gpt-4.1-nano`.

**Per-iteration** (in `iterationConfigs[].`):
- `agentType: 'iterative_editing'`
- `editingMaxCycles?: number` — 1-5, default 3.
- `editingEligibilityCutoff?: { mode: 'topN' | 'topPercent'; value: number }` — caps how many of the top-Elo variants are eligible for editing this iteration. Defaults to `{ mode: 'topN', value: 10 }` at consumption time.

## Files

- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — main wrapper class with LOAD-BEARING INVARIANTS comment block (no nested `Agent.run()`, costBefore* snapshots, partial-detail-on-throw).
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` / `approverPrompt.ts` — system + user prompt builders.
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` — CriticMarkup parser.
- `evolution/src/lib/core/agents/editing/checkProposerDrift.ts` — strip-markup drift detector.
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — hard-rule + size-ratio filter.
- `evolution/src/lib/core/agents/editing/recoverDrift.ts` — minor-drift recovery LLM helper.
- `evolution/src/lib/core/agents/editing/parseReviewDecisions.ts` — Approver JSONL parser.
- `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` — position-based right-to-left applier.
- `evolution/src/lib/pipeline/loop/editingDispatch.ts` — runtime + planner dispatch helpers (`resolveEditingDispatchRuntime`, `resolveEditingDispatchPlanner`, `applyCutoffToCount`).
- `evolution/src/lib/core/startupAssertions.ts` — deploy-ordering gate (`assertCostCalibrationPhaseEnumsMatch`).

## Cost tracking

The agent emits ONE invocation row per parent (per-purpose split tracked in `execution_detail.cycles[i].{proposeCostUsd, approveCostUsd, driftRecoveryCostUsd}`). All three internal LLM call labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`) collapse into the single `iterative_edit_cost` metric.

Cost estimator: `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, judgeModel, maxCycles)` returns `{ expected, upperBound }`. `expected` = `maxCycles × (propose + review)`. `upperBound` accounts for 1.5× article growth per cycle plus one drift recovery plus 30% safety margin.

`EstPerAgentValue.editing` field surfaces the per-agent cost in dispatch plan previews.

## Operational metrics

Three operational health metrics (live during execution, alert thresholds env-tunable):
- `iterative_edit_drift_rate` — fraction of cycles whose Proposer output drifted. Alert if > `EVOLUTION_EDITING_DRIFT_RATE_ALERT_THRESHOLD` (default 0.30).
- `iterative_edit_recovery_success_rate` — fraction of drift events resolved by recovery. Alert if < `EVOLUTION_EDITING_RECOVERY_SUCCESS_RATE_ALERT_THRESHOLD` (default 0.70).
- `iterative_edit_accept_rate` — fraction of atomic edits accepted by Approver. Alert if > `EVOLUTION_EDITING_ACCEPT_RATE_ALERT_THRESHOLD` (default 0.95) — rubber-stamping signal.

## Kill switches

- `EDITING_AGENTS_ENABLED='false'` — disables editing iterations entirely. The runIterationLoop branch short-circuits at entry. Mid-run flips do NOT abort in-flight iterations (intentional — partial-iteration aborts produce broken audit trails).
- `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` — disables drift recovery. Minor drift is treated as major (cycle aborts).

## Roadmap (out of scope for v1)

- v1.1: per-cycle invocation timeline UI; OutlineGenerationAgent (generate-mode); MDAST-aware judge format.
- v1.2: OutlineGenerationAgent edit-mode (selective re-expand); SectionDecompositionAgent + section helpers.
