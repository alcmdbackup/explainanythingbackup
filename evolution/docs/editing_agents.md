# Editing Agents Deep Dive

## Overview

`IterativeEditingAgent` is a propose-then-review editing pipeline that operates on existing pool variants. Per parent variant, it runs up to N propose-review-apply cycles using two LLM calls per cycle (Proposer + Approver) plus deterministic position-based application. Only the final cycle's text materializes as a new `Variant` in the pool; intermediate cycles live in `execution_detail.cycles[i].childText` only.

Reintroduced in `feat/bring_back_editing_agents_evolution_20260430` after the V1 rubric-driven version was removed in 4f03d4f6.

## Algorithm (per cycle)

1. **Proposer** (`iterative_edit_propose`) — LLM call. System prompt embeds soft rules (preserve quotes/citations/URLs, no new headings, prefer one-sentence edits, no edits in code blocks, preserve voice/tone). User prompt is the article body. Output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits in any of these forms:
   - `{++ inserted text ++}` (insert)
   - `{-- deleted text --}` (delete)
   - `{~~ old text ~> new text ~~}` (substitution, inline form)
   - `{~~ old text ~~}{++ new text ++}` (substitution, standard CriticMarkup paired form)
   The optional `[#N]` group tag (e.g. `{++ [#1] inserted ++}`) forces grouping across non-adjacent spans; if omitted, the parser auto-assigns group numbers via the adjacency rule below. Both substitution forms are accepted.
2. **Implementer pre-check** (deterministic):
   - Parse markup → atomic edits grouped by `[#N]` if explicit, otherwise by **adjacency** (consecutive markup spans separated only by horizontal whitespace + at most one newline form one auto-group; paragraph break `\n\n` splits groups). Adjacent paired delete+insert with the same group number is normalized to a `replace`. Standard CriticMarkup paired form `{~~ X ~~}{++ Y ++}` is treated as a substitution via this merge.
   - Strip markup → `recoveredSource`. Compare against `current.text` → drift check.
   - On drift: classify magnitude. Major → abort. Minor → recovery LLM call (`iterative_edit_drift_recovery`).
   - Apply hard rules per group (length cap, heading-cross, code-fence, list-boundary, horizontal rule, paragraph break). Group-level coherence: any atomic edit in a group fails any rule → drop the WHOLE group.
   - Apply size-ratio guardrail: drop highest-numbered groups until `newText.length / current.text.length ≤ 1.5`.
3. **Approver** (`iterative_edit_review`) — LLM call. Receives the marked-up article + per-group summary. Outputs JSONL: one `{groupNumber, decision, reason}` per group.
4. **Implementer apply** (deterministic): collect accepted groups, detect range overlaps between groups (drop the later group on conflict), verify each atomic edit's context-string failsafe + `oldText` match against `current.text` (drop group on mismatch), sort survivors by `range.start` descending, apply right-to-left.
5. If `appliedCount > 0` and format-valid: update `current = newText` for next cycle. Else: exit cycle loop.

After cycle loop terminates: emit final `Variant` if any cycle produced edits. `parent_variant_id` is the original input parent (NOT cycle-N-1's intermediate).

**Step 6 — Rank final variant** (gated by `EDITING_RANK_ENABLED`, default `'true'`). The single emitted final variant runs through the same `rankNewVariant()` helper that `GenerateFromPreviousArticleAgent` uses: binary-search Elo against a deep-cloned local snapshot of the iteration-start pool, up to `maxComparisonsPerVariant` opponents, with bias-mitigation 2-pass comparisons. Surface/discard policy mirrors GFPA: discard if `rankResult.status === 'budget'` AND `localElo < computeTop15Cutoff(localRatings)`. Ranking cost lands on `execution_detail.ranking.cost`; match buffer feeds `MergeRatingsAgent` which writes one `evolution_arena_comparisons` row per match.

Intermediate cycle outputs are NEVER ranked (they aren't `Variant` objects — they live as plain text in `execution_detail.cycles[i].childText`). Exactly one ranking pass per agent invocation, on exactly one variant.

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

The agent emits ONE invocation row per parent (per-purpose split tracked in `execution_detail.cycles[i].{proposeCostUsd, approveCostUsd, driftRecoveryCostUsd}` plus a top-level `execution_detail.ranking.cost` after the final-variant ranking step). The internal LLM call labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`) collapse into a single `iterative_edit_cost` metric. The ranking step's cost surfaces separately as `iterative_edit_rank_cost` (uses the shared `'ranking'` cost-calibration phase, same as `GenerateFromPreviousArticleAgent`).

Cost estimator: `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, judgeModel, maxCycles, poolSize, maxComparisonsPerVariant)` returns `{ expected, upperBound }`. `expected` covers `maxCycles × (propose + review) + ranking`. `upperBound` accounts for 1.5× article growth per cycle plus one drift recovery plus the full ranking budget plus 30% safety margin.

`EstPerAgentValue.editing` and `EstPerAgentValue.editingRank` peer fields surface the two cost components separately in dispatch plan previews so the user can see where their dollars go at strategy-design time.

### Cost anatomy

Per-invocation cost decomposes into four layers:

**Layer 1 — Per LLM call.** Each call costs `(input_chars × input_$/char) + (output_chars × output_$/char)`. Output is roughly 4× more expensive per token than input on most models, so calls where output ≈ input (Proposer; drift recovery) cost more than calls where output is tiny (Approver decisions; judge verdicts).

**Layer 2 — Per cycle.** Each cycle runs:
- **Proposer** — input = system prompt + full article (`A` chars); output = full article + ~40% markup overhead (`1.4 × A`). Output-heavy → expensive.
- **Approver** — input = marked-up article (`1.4 × A`) + per-group summary; output = JSONL decisions (~10 groups × small). Input-heavy → cheaper.
- **Drift recovery** *(optional, ≤1 per cycle)* — small reconciliation patch; fires rarely.

A single cycle on an 8K article ≈ 3× a single generate call (because Proposer's output is the whole article, not just a delta).

**Layer 3 — Across cycles.** The size-ratio guardrail caps article growth at **1.5× per cycle**. Default 3 cycles → cycle 3 processes ~2.25× the original article. Total ≈ **5× a single Proposer+Approver pair**, plus 1.3× safety margin on upper-bound estimates.

**Layer 4 — Ranking.** `min(poolSize - 1, maxComparisonsPerVariant) × 2` judge calls (×2 for bias mitigation). Default `maxComparisonsPerVariant = 15` → up to **30 judge calls per ranked variant**. Each judge call sees both articles fully (~16–24K chars input each), but output is tiny (~50 chars). Heavily input-dominated.

Ranking moves roughly **8× the input volume** that editing's 6 cycle calls move. This is why a 100–400% per-invocation cost bump from ranking is structurally normal at default settings.

### Cost knobs

| Knob | Layer | Cost lever |
|---|---|---|
| `editingMaxCycles` | 3 | 3 → 1 cuts editing ~67% |
| `editingModel` | 1, 2 | linear discount on Proposer + drift cost |
| `approverModel` | 1, 2 | linear discount on Approver cost |
| `judgeModel` | 1, 4 | **biggest single lever** for ranking; nano vs flagship ≈ 10× ratio |
| `maxComparisonsPerVariant` | 4 | 15 → 8 cuts ranking cost ~47% |
| `EDITING_RANK_ENABLED` | 4 | kill-switch: `false` reverts to pre-ranking behavior (variants land unranked) |
| `EVOLUTION_DRIFT_RECOVERY_ENABLED` | 2 | small reduction; drift recovery is rare anyway |

`maxComparisonsPerVariant` is shared with `generate` and `reflect_and_generate` ranking — it caps binary-search depth for all three agent types uniformly.

## Operational metrics

Three operational health metrics (live during execution, alert thresholds env-tunable):
- `iterative_edit_drift_rate` — fraction of cycles whose Proposer output drifted. Alert if > `EVOLUTION_EDITING_DRIFT_RATE_ALERT_THRESHOLD` (default 0.30).
- `iterative_edit_recovery_success_rate` — fraction of drift events resolved by recovery. Alert if < `EVOLUTION_EDITING_RECOVERY_SUCCESS_RATE_ALERT_THRESHOLD` (default 0.70).
- `iterative_edit_accept_rate` — fraction of atomic edits accepted by Approver. Alert if > `EVOLUTION_EDITING_ACCEPT_RATE_ALERT_THRESHOLD` (default 0.95) — rubber-stamping signal.

## Kill switches

- `EDITING_AGENTS_ENABLED='false'` — disables editing iterations entirely. The runIterationLoop branch short-circuits at entry. Mid-run flips do NOT abort in-flight iterations (intentional — partial-iteration aborts produce broken audit trails). Default: `'true'` (post-`add_ranking_iterative_editing_agent_evolution_20260502`).
- `EDITING_RANK_ENABLED='false'` — disables the post-cycle ranking step only. Editing still runs and emits final variants, but they land in the pool with default Elo (pre-ranking-project behavior). Default: `'true'`. Use this kill-switch if ranking misbehaves operationally; editing remains functional.
- `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` — disables drift recovery. Minor drift is treated as major (cycle aborts).

## Disabling approver filtering (experimental)

Added by `meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616` Phase 6. Mode B (`iterative_editing_rewrite`) only.

Setting `disableApproverFiltering: true` on an `iterative_editing_rewrite` iteration's config skips the post-parse `coalesceAdjacentGroups` + `capGroupsByMagnitude(K=10)` steps. The approver then sees every diff atomic as its own singleton group instead of bundled groups capped at K=10.

**What stays the same in both modes**:
- `validateEditGroups` still runs: heading-cross, quote-modification, code-fence, list-boundary, paragraph-break, `EDIT_NEWTEXT_LENGTH_CAP=500`, `AGENT_MAX_ATOMIC_EDITS_PER_GROUP=5`, `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`, size-ratio guardrail (≤1.5× article growth).
- The approver's system prompt, output contract, and per-group accept/reject semantics.
- All Mode A behavior. The field is exclusive to `iterative_editing_rewrite` per a Zod refine; FIELD_GATES strips it pre-hash on any non-rewrite agent type.

**Cost impact**: at `editingProposerSoftCap=8` (range widened from 5 to 10 in this PR) the proposer typically emits 40-60 atomics. Under bypass the per-cycle approver call sees ~30 groups (capped by `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`) instead of 10. Approver token cost rises ~10-15% per cycle; per-run cost moves from ~$0.038 → ~$0.041 on `gemini-2.5-flash-lite`.

**When to use**: in controlled A/B experiments comparing per-atomic vs per-bundle approver veto granularity (the Phase 6 use case). Production strategies should leave it `false` (default) until the experiment confirms a positive lift.

**Verifying the shape change via SQL**. The two arms' `execution_detail.cycles[*].proposedGroupsRaw` arrays differ structurally:

```sql
-- Control arm: ≤10 groups per cycle, some multi-atomic (bundled)
SELECT i.id,
       jsonb_array_length(c.cycle->'proposedGroupsRaw')               AS group_count,
       jsonb_path_query_array(c.cycle->'proposedGroupsRaw',
                              '$[*].atomicEdits[*]') -> 'atomicEdits' AS atomic_edits
FROM evolution_agent_invocations i
JOIN evolution_runs r ON i.run_id = r.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.execution_detail->'cycles', '[]'::jsonb)) AS c(cycle)
WHERE r.strategy_id = '<control_strategy_id>'
ORDER BY i.id;

-- Treatment arm: >10 groups per cycle, each containing 1 atomic edit (singleton)
-- Same query, swap the strategy_id for the treatment arm.
```

Control rows will show `group_count` ≤ 10 with some groups containing 2-5 atomic edits (bundled by `coalesceAdjacentGroups`). Treatment rows show `group_count` up to 30 (capped by `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE`) with each group containing exactly 1 atomic edit (`parseProposedEdits`'s adjacency auto-grouping may produce occasional 2-atomic groups from paired delete+insert pairs, which is expected — see `verifyBundleSplitStage1.ts` for the relaxed `mean atomics/group < 1.5` acceptance criterion).

## Roadmap (out of scope for v1)

- v1.1: per-cycle invocation timeline UI; OutlineGenerationAgent (generate-mode); MDAST-aware judge format.
- v1.2: OutlineGenerationAgent edit-mode (selective re-expand); SectionDecompositionAgent + section helpers.

## Related: ProposerApproverCriteriaGenerateAgent

The propose/approve criteria agent (`updated_criteria_agent_20260505`) forks `IterativeEditingAgent`'s propose-review-apply primitive but runs **single-cycle** with a **mirror-approver bias-mitigation pass**. It reuses ~80% of this module's editing toolkit (`parseProposedEdits`, `validateEditGroups`, `applyAcceptedGroups`, `checkProposerDrift`, `proposerPrompt`, `approverPrompt`) — the new code is the orchestration (single-cycle + mirror pass + strict-binary aggregator) plus the criteria-context construction for prompt injection. The `validateEditGroups` extension (Phase 3.3) added an `opts` parameter — existing `IterativeEditingAgent` callers pass `{}` and get bit-identical pre-extension behavior; the new agent passes `{ lengthCapRatio: 1.10, redundancyJaccardThreshold: 0.35, flowGuardrailEnabled: true }`.

See full deep dive: [criteria_agents.md](./criteria_agents.md).
