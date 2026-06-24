# Paragraph Recombine with Coherence Pass

`paragraph_recombine_with_coherence_pass` is a sibling of [`paragraph_recombine`](./paragraph_recombine.md) that tests a different hypothesis: rewrite each paragraph in **true isolation** under a strict no-new-content constraint (so rewrites are quality-equivalent reorganizations the judge can rank), then resolve any residual cross-paragraph rough edges in a single small **coherence pass** on the assembled winners.

Implemented in [`paragraph_recombine_agent_with_coherence_pass_evolution_20260620`](../../docs/planning/paragraph_recombine_agent_with_coherence_pass_evolution_20260620/).

## When to use

Use this agent type when:
- You want to test whether isolated-rewrite + post-hoc coherence-smoothing beats the existing sequential-context-aware `paragraph_recombine`.
- You want to enforce a hard "no new content" constraint on rewrites — useful for editorial-controlled content where adding unsourced facts is unacceptable.
- You want a controlled A/B with `coherencePassEnabled: false` to isolate the coherence pass's contribution to Elo lift.

Source modes mirror `paragraph_recombine`:
- **First iteration (`sourceMode: 'seed'`)** — operates on the prompt's seed article.
- **Non-first iteration (`sourceMode: 'pool'`)** — picks a parent from the run pool's top-N variants.

## Algorithm

Three phases per invocation:

### Phase A: Per-slot isolated rewrites
1. Decompose the parent article into paragraph slots via `extractParagraphsWithRanges`.
2. For each slot in parallel (`Promise.allSettled`):
   - Allocate per-slot `AgentCostScope` nested under the invocation scope (D16).
   - Upsert the slot's arena topic via `upsertSlotTopic`; load top-20 prior arena entries via `loadArenaEntries`.
   - Generate M rewrites in parallel — each gets a **distinct directive** + a **distinct temperature** drawn from the per-directive moderate ladder.
   - Validate each rewrite via `validateParagraphRewrite` (length cap ±20%, no bullets/lists/tables/H1, ≥1 sentence-ending punctuation).
   - Compute per-rewrite `provenanceRatio` (CHILD → PARENT sentence overlap; **noisy for REORDER + RESTRUCTURE — see Noise Caveat below**).
   - Sequentially rank surviving rewrites within the slot via `rankNewVariant` (with `comparisonMode: 'paragraph'`, no `priorPicks`, no `nextContext`).
   - `syncToArena` + `persistSlotMatches` (same pattern as `paragraph_recombine`).
   - `selectWinner` over the slot's local pool.

### Phase B: Recombine
3. Splice slot winners back into the parent article via `assembleRecombinedArticle` (right-to-left, byte-offset preserving).
4. Validate the recombined article via `validateFormat`. On invalid, emit `surfaced=false` with `failure.code='format_invalid'`.

### Phase C (optional): Coherence pass

> **Major rework by `investigate_paragraph_recombine_coherence_pass_performance_20260623`** (2026-06-23). Original hypothesis ("isolated rewrites + minor seam smoothing beats sequential context-aware generation") was invalidated by 4 consecutive staging runs with negative `eloAttrDelta:paragraph_recombine_with_coherence_pass`. The agent is now repositioned as "isolated rewrites + a real editing pass": the proposer prompt authorizes voice repair, the Jaccard redundancy + flow guardrails are dropped from `validateOpts`, the length cap defaults open to 1.10 (vs 1.02), and the single cycle is replaced with a bounded loop (default 2 cycles).

5. Pre-coherence-pass budget gate at **0.85× perInvocationCap** — skipped with `coherencePass: { skipped: 'budget' }` if scope ≥ gate.
6. When `coherencePassEnabled !== false`: a bounded loop of `runEditingCycle()` calls (the same shared helper extracted from `IterativeEditingAgent`). Each cycle:
   - Rebuilds `proposerUserPrompt` from the running text. Cycle 2+ must see the post-cycle-1 article as `<source>` — otherwise `parseProposedEdits`' RULE-1 byte-equality drops every group.
   - Uses `validateOpts: { lengthCapRatio }` only. `redundancyJaccardThreshold` + `flowGuardrailEnabled` removed (Phase 2a): both blocked legitimate voice-repair edits without catching paraphrased duplication; the approver LLM is the actual quality gate.
   - Loop terminates when `cycleResult.stopReason` is set OR `cycleNumber > maxCycles`.
   - **Mode A only** — `runEditingCycle` is called WITHOUT a `rewriteMode` argument, so `coalesceAdjacentGroups` + `capGroupsByMagnitude` are skipped. Intentional: no edit-count cap, no per-group cap.
   - **`driftRecovery: 'skip'`** — the recombined article is the source of truth; nothing to drift from. With multi-cycle this means minor drift in cycle 2+ aborts via stopReason rather than attempting snap recovery against a moving source.
7. AgentName labels: `coherence_pass_propose` + `coherence_pass_review` → cost lands in the `paragraph_recombine_coherence_cost` umbrella metric (sums propose + review accumulators across all cycles; the underlying `getPhaseCosts` accumulators are run-cumulative so the sum-write is MAX-safe).
8. Silent-rejection observability: per-cycle counter accumulated across the loop. If any cycle had `approverGroups.length > 0 && appliedGroups.length === 0`, the agent writes the run-total to `coherence_pass_silent_rejection_count` once at end-of-loop and logs a warn.

### Phase D: Article-level ranking + emit
9. The recombined+smoothed article variant is ranked against the run pool via `rankNewVariant` (uses the invocation's `input.llm` → `ranking_cost`, distinct from per-slot `paragraph_rank` → `paragraph_recombine_cost`).
10. Variant emitted with `parent_variant_ids = [originalParent]` only (D4). Slot winners live in `execution_detail.slots[i].winnerSlotVariantId`.

## Directives (Q3 from research)

Three locked directives, each explicitly re-stating the no-new-content prohibitions (belt-and-suspenders with the system prompt):

| Index | Name | Temperature (default) | Directive |
|---|---|---|---|
| 0 | REORDER | 0.6 (floor) | Reorder sentences within the paragraph for better logical flow. Same content, different sequence. Do not add new sentences, definitions, metaphors, analogies, or examples; do not remove any non-redundant content. |
| 1 | TIGHTEN | 0.7 (midpoint) | Tighten wording and remove redundancy. Express the same ideas in fewer words. Cut filler, hedge phrases, and duplicate content. Do not add new definitions, metaphors, analogies, or examples; do not delete any non-redundant information. |
| 2 | RESTRUCTURE | 1.0 (ceiling) | Restructure sentences for clarity. Break long sentences, combine short choppy ones, vary cadence. Keep the same information and the same level of detail. Do not add new definitions, metaphors, analogies, or examples; do not remove any non-redundant content. |

For M > 3, the directive ladder cycles mod-3 (index 3 = REORDER, index 4 = TIGHTEN, etc.).

Floor and ceiling are tunable per-iteration via `coherencePassRewriteTempFloor` / `coherencePassRewriteTempCeiling` for staging re-tuning without redeploy.

## Configuration knobs

**Strategy-level** (on `StrategyConfig`):
- Reuses the strategy's `generationModel` for per-paragraph rewrites + coherence-pass proposer (unless overridden by `coherencePassProposerModel` on the iter-config).
- Reuses the strategy's `judgeModel` for per-slot ranking + coherence-pass approver (unless overridden by `coherencePassApproverModel`).

**Per-iteration** (on `IterationConfig`):
- `agentType: 'paragraph_recombine_with_coherence_pass'`
- `sourceMode`, `qualityCutoff` (when sourceMode='pool')
- `budgetPercent`
- `rewritesPerParagraph` / `maxComparisonsPerParagraph` / `maxParagraphsPerInvocation` / `paragraphRewriteModel` (shared with `paragraph_recombine`)
- `perInvocationCapUsd` (default **conditional**: $0.10 when `coherencePassEnabled !== false`, $0.05 when explicitly false)
- `maxDispatches` (default 1 — back-compat single-dispatch; opt into multi-dispatch by raising)

**Coherence-pass-only** (7 fields after `investigate_paragraph_recombine_coherence_pass_performance_20260623`):
- `coherencePassEnabled?: boolean` — default true. When false, the coherence pass is skipped and the recombined article is emitted as-is. **This was the original A/B isolation lever**; with the Phase-2a/3/4 changes, the agent's hypothesis has shifted (see Algorithm notes above).
- `coherencePassProposerModel?: string` — default `generationModel`
- `coherencePassApproverModel?: string` — default `judgeModel`
- `coherencePassRewriteTempFloor?: number` — default 0.6 (range 0-2)
- `coherencePassRewriteTempCeiling?: number` — default 1.0 (range 0-2; must be ≥ floor)
- `coherencePassLengthCapRatio?: number` (Phase 3) — default **1.10** (range 1.0-2.0). The per-cycle article-growth ceiling. NOTE: with `coherencePassMaxCycles > 1` the cap COMPOUNDS — at the defaults (1.10 × 2 cycles) worst-case length is 1.21× original.
- `coherencePassMaxCycles?: number` (Phase 4) — default **2** (range 1-5). Maximum number of propose-approve-apply cycles.

**Kill switch** (env-var): `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2`. Default `'true'` (or unset) uses the new aggressive defaults (1.10 / 2 cycles). Setting to `'false'` flips defaults to legacy (1.02 / 1 cycle) WITHOUT a deploy — the agent reads the env var per-invocation via `resolveCoherencePassDefaults()`. Explicit per-strategy values (set via the wizard or iter-config) ALWAYS override; the kill switch only changes what the DEFAULT is.

## Cost envelope

Per-invocation cost at defaults (12 slots × 3 rewrites × 8 comparisons + coherence pass at gpt-4.1-nano / qwen-2.5-7b):
- Per-slot rewrite + ranking: **~$0.0048 actual median** (same as `paragraph_recombine`)
- Coherence pass propose + review: post `investigate_paragraph_recombine_coherence_pass_performance_20260623` defaults (`maxCycles=2`): **~$0.007 typical** (~$0.014 worst case). Legacy single-cycle: ~$0.0035 typical.
- **Total at new defaults: ~$0.012-0.020/variant** with coherence pass enabled.

Per-invocation safety cap: **$0.10** (vs $0.05 for plain `paragraph_recombine`). Drops to $0.05 when `coherencePassEnabled=false`. Pre-coherence-pass budget gate at 0.85× cap. Per-cycle gate at 0.9× — `runEditingCycle` early-exits with `stopReason: 'invocation_budget_near_exhaustion'`.

**Compounding length cap**: `lengthCapRatio` is applied per cycle to the running text. At defaults (1.10 × 2 cycles) worst-case article length is 1.21× original. With `coherencePassLengthCapRatio: 1.20 × coherencePassMaxCycles: 3` worst-case is 1.728× original — the wizard help text warns about this.

## Cost metrics

| Metric | Entity | Description |
|---|---|---|
| `paragraph_recombine_cost` | run | Per-slot rewrite + ranking spend (REUSED — same metric as `paragraph_recombine`). The new agent's marker tactic distinguishes its contributions on the tactic leaderboard. |
| `paragraph_recombine_coherence_cost` | run | Coherence-pass umbrella: `coherence_pass_propose` + `coherence_pass_review` calls collapse here. NEW. |
| `coherence_pass_silent_rejection_count` | run | Counter: increments when approverGroups > 0 but appliedCount == 0 (quietly-rejecting approver). |
| `slot_provenance_ratio_p25` / `_p50` | run | **OBSERVATIONAL ONLY — see Noise Caveat below.** Per-rewrite CHILD → PARENT sentence overlap, aggregated. |
| `total_paragraph_recombine_coherence_cost` | strategy/experiment | Sum across runs. |
| `avg_paragraph_recombine_coherence_cost_per_run` | strategy/experiment | Mean per-run coherence-pass cost. |
| `avg_slot_provenance_ratio_p25/p50` | strategy/experiment | Bootstrap-mean of run-level provenance percentiles. |
| `subagent:coherence_pass.cost` | run/strategy/experiment | Dynamic-prefix metric: total spend under the coherence_pass subagent in the SubagentsTab tree. |
| `subagent:coherence_pass.propose.cost` / `.review.cost` / `.apply.cost` | run/strategy/experiment | Per-step subagent breakdown. Re-keyed from `cycle.*` (existing iterative_editing pattern) by `accumulateSubagentSums` when nested under a `coherence_pass` grandparent — keeps the new agent's coherence-pass costs CLEANLY ISOLATED from plain iterative_editing's `cycle.*` sums. |

## ⚠️ Noise Caveat for `slot_provenance_ratio_*`

The `slot_provenance_ratio_p25` / `_p50` metrics use sentence-level Levenshtein matching (`<= 2` tolerance) on the CHILD → PARENT direction. This is:

- **Reliable for TIGHTEN** — deleting whole sentences leaves the surviving child sentences intact, so they near-match parent.
- **NOISY for REORDER** — reordering WORDS within a sentence ("The dog ran quickly" → "Quickly, the dog ran") changes the sentence enough that Levenshtein > 2, so the child sentence doesn't near-match the original. No new content was added, but the metric flags low.
- **NOISY for RESTRUCTURE** — splitting one sentence into two, or combining two into one, changes sentence boundaries. The split child sentences are smaller fragments that don't near-match the original combined sentence.

**Low values do NOT necessarily indicate prompt violation.** Use the metric as a directional signal, not a hard compliance check. A true compliance check would need an LLM judge ("does the child contain any factual claim not in parent?"). That's out of scope for the in-pipeline metric; researchers wanting strict compliance verification should run a follow-up judge script post-hoc.

## Kill switch

`EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED='false'` short-circuits the dispatch branch in `runIterationLoop.ts` with an info log. Single-env-flip rollback.

## A/B experiment design

The whole point of the `coherencePassEnabled` flag is the 3-arm comparison:

- **Arm A**: `paragraph_recombine_with_coherence_pass` + `coherencePassEnabled: true` — the full new agent.
- **Arm B**: `paragraph_recombine_with_coherence_pass` + `coherencePassEnabled: false` — new agent WITHOUT the coherence pass. Isolates the coherence pass's contribution from other changes (new directives + low-temp ladder + no priorPicks).
- **Arm C**: existing `paragraph_recombine` — baseline. Confirms the new agent (even with coherence off) differs from the existing agent only via the rewrite directives + ladder + isolation choice.

Use the same prompt + same seed across all 3 arms. 5+ runs per arm for statistical signal. Acceptance criteria (per the planning doc Phase 7):
- Arm A median Elo ≥ Arm B median (coherence pass helps)
- Arm B median ≥ Arm C median − 10 (new directives don't catastrophically regress)
- `slot_provenance_ratio_p25` ≥ 0.5 for Arms A + B (rewrites are mostly preserving content)
- `coherence_pass_silent_rejection_count` < 50% of Arm A invocations

## Files

| File | Purpose |
|---|---|
| `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts` | Agent class + execute() body |
| `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildIsolatedParagraphRewritePrompt.ts` | 3-directive isolated rewrite prompt + temperature ladder |
| `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.ts` | Coherence-pass proposer prompt (inter-paragraph-seam focus) |
| `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/slotProvenance.ts` | Slot provenance ratio compute + percentile aggregation |
| `evolution/src/lib/core/agents/editing/runEditingCycle.ts` | Shared helper extracted from `IterativeEditingAgent`. Both agents call this. |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Dispatch branch (sibling to `paragraph_recombine` branch) |

## Cross-references

- [Paragraph Recombine](./paragraph_recombine.md) — the existing agent this clones from
- [Editing Agents](./editing_agents.md) — `IterativeEditingAgent` whose per-cycle helper was extracted
- [Agents Overview](./agents/overview.md) — Agent base class, AgentCostScope, I1-I4 invariants
- [Architecture](./architecture.md) — config-driven iteration loop, agent / subagent / level vocabulary
- [Multi-iteration Strategies](./multi_iteration_strategies.md) — `iterationConfigSchema` enum + per-iter knobs
- [Cost Optimization](./cost_optimization.md) — V2CostTracker + AgentCostScope + cost-metric routing
- [Metrics](./metrics.md) — registry + propagation + dynamic-prefix subagent metrics
- [Reference](./reference.md) — env vars + AgentName labels
- [Variant Lineage](./variant_lineage.md) — `parent_variant_ids` semantics (D4: single primary parent)
