[//]: # (Research doc for understanding iterative-editing agent edit-proposal/acceptance telemetry and tuning prompts to elicit more proposed edits.)

# Investigate Iterative Editing Runs (Stage) Research

## Problem Statement
Understand and improve the behavior of the iterative-editing-class agents on staging — specifically how many edits each propose vs. how many the approver accepts — and then change the system so both flavors of these agents (the multi-cycle `IterativeEditingAgent` and `IterativeEditingRewriteAgent` Mode B) propose more edits per cycle.

## Requirements (from GH Issue #1280)
- Understand how many edits are proposed vs. accepted in logging
- Encourage both types of agents to propose more edits

## High Level Summary

The user's framing "encourage both agents to propose more edits" is **partially miscalibrated against the actual stage data**. On the last 30 days of staging:

| Agent | Invocations | Avg cycles | Avg proposed / cycle | Avg accepted / invocation | Accept rate | % cycles with 0 applied |
|---|---:|---:|---:|---:|---:|---:|
| `iterative_editing` (vanilla) | 573 | **1.01** | **8.31 groups** | **0.26 groups** | **16.1%** | **87%** |
| `iterative_editing_rewrite` (Mode B) | 20 | 2.05 | 9.25 groups (cyc 1) | 4.70 groups (cyc 1) | 47.3% (cyc 1) | 25% (cyc 1) |
| `proposer_approver_criteria_generate` | **0** | — | — | — | — | — |

(`proposer_approver_criteria_generate` had ZERO invocations in the last 30 days, so the "two flavors" the user is asking about are almost certainly `iterative_editing` + `iterative_editing_rewrite`, not the criteria-driven sibling.)

**The vanilla `IterativeEditingAgent` is not proposer-bottlenecked — it's approver-bottlenecked.** The proposer averages 8.3 groups per cycle (~2.8× its own "AT MOST 3 atomic edits per cycle" soft-cap), but the approver applies an average of 0.25 of them, and **500 of 573 cycle-1 invocations apply zero edits**. Because `IterativeEditingAgent`'s cycle loop exits when `appliedCount === 0`, vanilla-mode invocations almost never reach cycle 2 (only 3 of 573 — 0.5% — did). So in steady state, vanilla iterative_editing is a 1-cycle agent that produces no variant 87% of the time.

The rewrite Mode B (`IterativeEditingRewriteAgent`) is the inverse story — its forward+mirror configuration plus the per-rewrite proposer system prompt yields ~47% accept rate and routinely runs multiple cycles, producing several applied edits per invocation.

**So two levers move the needle, and the user's "encourage more proposals" lever only moves one of them:**
1. **Proposer side (the user's stated lever)**: vanilla proposer's system prompt actively biases DOWN — `proposerPrompt.ts:8` ("Prefer one-sentence edits over multi-sentence rewrites") plus `proposerPrompt.ts:67-70`'s `EDIT_BUDGET` block ("propose AT MOST 3 atomic edits per cycle") plus default `editingProposerSoftCap = 3` (`IterativeEditingAgent.ts:157`). The single-cycle criteria-proposer's prompt says the literal opposite: "BIAS TOWARD PROPOSING MORE EDITS, NOT FEWER" (`proposerApproverCriteriaGenerate.ts:82`). Lifting this on the vanilla proposer is well-targeted and low-risk.
2. **Approver side (NOT in scope per the requirements, but is the actual bottleneck)**: 16.1% accept rate + 87% zero-applied cycle-1 outcomes implies the vanilla approver prompt or its decision criteria are far too strict. This is where the variant production is being lost. The user should be told this before we ship a "propose more" change that just lifts proposed-count from 8 → 14 while accepted stays at 0.26.

**A second critical finding from the code:** the `iterative_edit_accept_rate` metric — documented in `evolution/docs/editing_agents.md` § "Operational metrics" with a 0.95 rubber-stamp alert threshold — **is defined in the catalog but never written**. `RunEntity.ts:59` registers it with `compute: () => 0` and there is no `writeMetric()` call in the codebase that populates it. So the existing alerting on accept-rate is non-functional today; the LogsTab / admin UI show 0 for everyone. The companion metrics `iterative_edit_drift_rate` and `iterative_edit_recovery_success_rate` are catalogued identically (also `compute: () => 0`). All three metric descriptions say "during_execution" timing, but no execution-time writer exists.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (tagged in _status.json)
- evolution/docs/architecture.md — V2 config-driven iteration loop, agent/subagent/level vocabulary, propagation invariants
- evolution/docs/agents/overview.md — `IterativeEditingAgent` per-cycle protocol, load-bearing invariants (I1-I3), `ProposerApproverCriteriaGenerateAgent` single-cycle algorithm
- evolution/docs/editing_agents.md — Algorithm, configuration, cost anatomy, **operational metrics that are documented but not implemented**
- evolution/docs/multi_iteration_strategies.md — `iterationConfigSchema` field gating (`editingProposerSoftCap` is `iterative_editing_rewrite`-only — vanilla has no per-iteration knob for proposer count)
- evolution/docs/logging.md — `EntityLogger` / multi-entity log query for the LogsTab
- evolution/docs/cost_optimization.md — `iterative_edit_cost` umbrella metric and `iterative_edit_rank_cost`
- evolution/docs/criteria_agents.md, paragraph_recombine.md (skimmed — not load-bearing for this investigation)

## Code Files Read
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — main agent. `editingProposerSoftCap` default = 3 at line 157, passed only into `rewriteMode` at lines 205-206 / 213; vanilla path never reads it.
- `evolution/src/lib/core/agents/editing/IterativeEditingRewriteAgent.ts` — subclass that only overrides `name` and `isRewriteMode`; everything else is inherited.
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` — vanilla proposer system prompt. Line 8 = "Prefer one-sentence edits over multi-sentence rewrites." Lines 67-70 = `EDIT_BUDGET` constant ("propose AT MOST 3 atomic edits per cycle"). Line 102 = where `EDIT_BUDGET` is injected into the system prompt.
- `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts` — Mode B proposer prompt (per-rewrite scope; soft cap = `editingProposerSoftCap`).
- `evolution/src/lib/core/agents/editing/approverPrompt.ts` — approver system prompt. Need to read for Phase 2 root-cause on the 87% zero-applied rate; not deeply analyzed yet.
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts:283-285` — `parseResult.groups` (proposed group count).
- `evolution/src/lib/core/agents/editing/parseReviewDecisions.ts` — Approver JSONL parser.
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — Hard rules (`AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5` at constants.ts:7, `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` at constants.ts:6, `SIZE_RATIO_HARD_CAP=1.5` at constants.ts:12). Cycle cap drops high-numbered groups when totalAtomic > 30.
- `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` — `appliedGroups.length` is the post-overlap-+-context-mismatch survivor count.
- `evolution/src/lib/core/agents/editing/runEditingCycle.ts:514` — `const acceptedCount = reviewDecisions.filter(d => d.decision === 'accept').length;` (group-level, not atomic).
- `evolution/src/lib/core/agents/editing/runEditingCycle.ts:162-168` — cycle output: `proposedGroupsRaw`, `acceptedCount` stored on `execution_detail.cycles[i]`.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:82` — VERBATIM: "BIAS TOWARD PROPOSING MORE EDITS, NOT FEWER... Two cautious edits is rarely the right answer." (separate prompt, NOT shared with `proposerPrompt.ts`)
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:411` — `const proposedGroupsRaw = parseResult.groups.length;` (count).
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:498-500` — `forwardAcceptedGroups`.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:581-598` — strict-binary aggregator.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:603` — `const appliedCount = applyResult.appliedGroups.length;`
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts:222-228` — class definition. **No `invocationMetrics` declared.**
- `evolution/src/lib/core/Agent.ts:26` — `readonly invocationMetrics: FinalizationMetricDef[]` (base default = `[]`).
- `evolution/src/lib/core/agentRegistry.ts:36-54` — `getAgentClasses()` registration.
- `evolution/src/lib/core/entityRegistry.ts:25-35` — startup merge of `agent.invocationMetrics` into `InvocationEntity.metrics.atFinalization` (dedup by metric name).
- `evolution/src/lib/core/metricCatalog.ts:38-52` — catalog entries for `iterative_edit_drift_rate`, `iterative_edit_recovery_success_rate`, `iterative_edit_accept_rate`. All `timing: 'during_execution'`, `formatter: 'integer'`.
- `evolution/src/lib/core/entities/RunEntity.ts:59` — `compute: () => 0` for `iterative_edit_accept_rate` (the broken-metric site).
- `evolution/src/lib/metrics/types.ts:22-134` — `STATIC_METRIC_NAMES` (where new metric names must be registered).
- `evolution/src/lib/metrics/types.ts:211-213, 264-273` — `FinalizationMetricDef.compute(ctx)` signature; `FinalizationContext` carries `invocationDetails: Map<string, AgentExecutionDetail>` and `currentInvocationId` for per-invocation metric computation.
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:440-475` — run-level + per-invocation finalization metric write loop. The infrastructure to add a real metric is fully there.
- `evolution/src/lib/core/entities/StrategyEntity.ts:50-103` — propagation pattern. `atPropagation: PropagationMetricDef[]` with `sourceEntity: 'run' | 'invocation'`, `sourceMetric`, `aggregate` (sum/avg/bootstrap_mean).
- `evolution/src/lib/core/detailViewConfigs.ts:444-514` — `iterative_editing` `DETAIL_VIEW_CONFIGS` schema. Adding a per-cycle `proposedCount` / `acceptedCount` column to the cycles table here is a 4-line change; the data is already on each cycle row.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationExecutionDetail.tsx`, `ConfigDrivenDetailRenderer.tsx` — admin UI render path (no change needed if the new fields are added to `detailViewConfigs.ts`).

## Key Findings

1. **Vanilla `iterative_editing` is approver-bottlenecked, not proposer-bottlenecked.** 87% of cycle-1 invocations apply zero edits. The proposer averages 8.31 groups per cycle — well above its own "AT MOST 3" soft-cap, and well below the 30/cycle hard cap.

2. **The user's `iterative_editing` proposer prompt actively biases DOWN, opposite to the criteria-driven sibling.** `proposerPrompt.ts:8` says "Prefer one-sentence edits over multi-sentence rewrites"; `proposerPrompt.ts:67-70` says "propose AT MOST 3 atomic edits per cycle." Compare `proposerApproverCriteriaGenerate.ts:82`: "BIAS TOWARD PROPOSING MORE EDITS, NOT FEWER... Two cautious edits is rarely the right answer." Aligning the vanilla prompt to the criteria-sibling's stance is a single-file edit.

3. **`editingProposerSoftCap` is `iterative_editing_rewrite`-only.** Reading the schema gate in `evolution/docs/multi_iteration_strategies.md` and confirming at `iterationConfigSchema` lines 108-109: the field is gated to rewrite Mode B by Zod refinement. Vanilla `iterative_editing` has no per-iteration knob for proposer count — it goes through `proposerPrompt.ts`'s hardcoded `EDIT_BUDGET = 3` constant.

4. **The documented `iterative_edit_accept_rate` metric is non-functional.** Catalogued (`metricCatalog.ts:48-52`), registered (`RunEntity.ts:59`), but `compute: () => 0`. No `writeMetric()` writer exists. Same for `iterative_edit_drift_rate` and `iterative_edit_recovery_success_rate`. The rubber-stamp alert documented in `editing_agents.md` § Operational metrics has never fired because the value is always 0.

5. **Per-cycle proposed-and-accepted data is already present** in `execution_detail.cycles[*].proposedGroupsRaw` (array — count = proposed groups) + `execution_detail.cycles[*].acceptedCount` (number, group-level). The applier output `applied_count` is also stored. Adding three first-class invocation metrics (proposed-per-cycle, accepted-per-cycle, applied-per-cycle) is a `metricCatalog.ts` + `STATIC_METRIC_NAMES` + `IterativeEditingAgent.invocationMetrics: FinalizationMetricDef[]` addition — the persistence path (`persistRunResults.ts:461-466`) and roll-up infrastructure (`StrategyEntity.atPropagation`) work automatically.

6. **Group-level vs. atomic-level accounting mismatch.** Today's `acceptedCount` is groups-accepted, not atomic-edits-accepted. The catalog description for `iterative_edit_accept_rate` says "Fraction of atomic edits accepted." A correct atomic-level numerator requires summing `atomicEdits.length` for groups in `cycles[i].reviewDecisions` where `decision === 'accept'`. Today's data does NOT store accepted-group atomic counts directly — they're recoverable by joining `reviewDecisions[].groupNumber` back to `approverGroups[]` / `proposedGroupsRaw[]`. Should plumb a per-cycle `acceptedAtomicCount` field on the cycle row.

7. **The cycle loop's `appliedCount === 0 → exit` rule explains the 1.01 avg-cycles number.** Per `editing_agents.md`: "If `appliedCount > 0` and format-valid: update `current = newText` for next cycle. Else: exit cycle loop." With 87% of cycle-1 producing zero applied, basically nobody reaches cycle 2.

8. **Mode B (`iterative_editing_rewrite`) does what the user wants already.** 47% accept rate (cyc 1), runs 2-3 cycles, ~4.7 groups applied per invocation. Whatever its proposer prompt (`proposerPromptRewrite.ts`) + per-rewrite scoping is doing, it's working. May provide a template for fixing vanilla.

9. **`iterationConfigs.editingMaxCycles` is set somewhere already with default 3.** With observed avg 1.01 cycles, max-cycle limits don't bind — exit-on-zero-applied does. So any "encourage more proposals" change must either (a) lift accept rate, OR (b) decouple cycle continuation from `appliedCount > 0`.

## Open Questions

- **Q1**: Does the user want us to lift the vanilla-mode approver's strictness (the actual bottleneck) too, or strictly stay on the "encourage more proposals" side per the issue text? This is a meaningful scope question — fixing only the proposer side with the current data won't materially change accepted-edit counts.
- **Q2**: Should the new per-cycle proposed/accepted/applied metrics be **counts** (sum across cycles for the invocation, easy to roll up), **rates** (accepted/proposed, harder to average correctly), or **both** (counts at invocation level + ratio at run level via division-of-sums)? Recommend: counts at invocation level + a separate run-level ratio metric computed from sums.
- **Q3**: Is `proposer_approver_criteria_generate` actually deployed on any active strategy on stage right now (the 30-day-zero-invocation finding above)? If not, the project's "both types of agents" framing should be re-cast as `iterative_editing` (vanilla) + `iterative_editing_rewrite` (Mode B), which is what the data shows is in use.
- **Q4**: For `iterative_editing_rewrite`, the cycle-2 + cycle-3 accept rates drop (47% → 42% → 37%) and `accepted_but_not_applied` appears (3 of 15 cycle-2 cycles had accepted-but-not-applied). What's the apply-time drop reason — range overlap, context-string failsafe, format-validation? Worth a one-query follow-up before changing anything.
- **Q5**: Are there strategy configs on stage that currently set `editingMaxCycles` ≠ 3 or `editingEligibilityCutoff` ≠ `{topN: 10}` defaults? If so, run-level results may not be directly comparable across strategies; the metrics should be reported per `(strategy_id, agent_name)` not just `(agent_name)`.
