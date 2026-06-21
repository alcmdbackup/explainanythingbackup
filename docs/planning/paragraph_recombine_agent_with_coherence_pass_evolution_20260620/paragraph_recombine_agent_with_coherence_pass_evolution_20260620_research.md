# Paragraph Recombine Agent With Coherence Pass Research

## Problem Statement
Create a new evolution agent type called "paragraph rewrite with cohesion pass" — a variant of the existing `paragraph_recombine` that (a) rewrites paragraphs in isolation with no surrounding context, (b) constrains rewrites to reorganization/wording adjustments without introducing new content, (c) judges each paragraph independently, and (d) applies a coherence pass over Elo winners to smooth any cross-paragraph incoherences with minor edits.

## Requirements (from GH Issue #1239)
- Create a new type of agent with a different prompt compare to sequential paragraph rewrite recombine - call it "paragraph rewrite with cohesion pass"
- Prompt should force agent to rewrite the paragraph inline with no other context
- Rewrite prompt should suggest move content around and adjust sentences & wording, but do not introduce any new content whatsoever
- Do not add definitions where none were there previously, add new metaphors/analogies, etc
- Delete words and phrases and sentences if redundant, but do not delete non-redundant content
- Judging should be for individual paragraph only, with no other context
- To get the final output, pick the highest elo paragraphs from all rewrites, and do an incoherence pass afterwards on elo winners. Edit them to make sure that any incoherences are resolved with minor edits

## High Level Summary

The new agent is a near-clone of `ParagraphRecombineAgent` that:
1. Reuses the per-slot decomposition (`extractParagraphsWithRanges`), per-slot arena (`upsertSlotTopic`, `loadArenaEntries`, `persistSlotMatches`), per-slot Elo ranking (`rankNewVariant` in `comparisonMode='paragraph'`), and assembly (`assembleRecombinedArticle`) infrastructure.
2. Forces the **legacy parallel path** (no coordinator, no priorPicks, no nextContext, no sequential loop). This satisfies "rewrite the paragraph inline with no other context."
3. Swaps the rewrite prompt for one that constrains the LLM to reorganization-only edits (move content around, adjust wording, delete redundancy) with explicit prohibitions on adding new content (no new definitions, metaphors, analogies, examples).
4. Adds a **Phase D coherence pass** on the assembled recombined article: a single-cycle propose→approve→apply mini-pipeline (forked from `IterativeEditingAgent` primitives) scoped to inter-paragraph smoothing only. Edits are applied right-to-left via `applyAcceptedGroups`.
5. Emits **one article variant per invocation** with lineage `parent_variant_ids = [originalParent]`. Slot winners live in `execution_detail.slots[i].winnerSlotVariantId` (same as today). The coherence-pass diff lives in `execution_detail.coherencePass`.
6. Article-level ranking via `rankNewVariant` against the run pool → match buffer → `MergeRatingsAgent` (same as today).

This is **Option A** from the planning doc (new top-level agent type). Option B (mode flag on existing agent) and Option C (separate iteration type) were rejected:
- **Option B** balloons the existing agent's surface area and pollutes its leaderboard buckets.
- **Option C** decouples the coherence pass from the slot rewrites it just finished judging; harder to maintain the coupling without persisting intermediate state.

### Why the legacy parallel path (not sequential context-aware)

The existing `ParagraphRecombineAgent` defaults to **sequential context-aware generation** (`EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED='true'`) where each round embeds prior-pick context and next-context into both rewrite and judge prompts. The whole point of that mode is to maximize per-slot continuity at generation time.

The new agent's requirements are the **opposite**: rewrite each paragraph in **isolation** with no other context. The legacy parallel path (`isSequentialEnabled()===false` branch at `ParagraphRecombineAgent.ts:396-417`) already does exactly this — `Promise.allSettled` across N slots, each slot's rewrite prompt receives only the original paragraph + the article H1 title (no priorPicks, no nextContext).

The judging mode `'paragraph'` (already implemented at `computeRatings.ts` via `buildComparisonPrompt`) judges single paragraphs against single paragraphs with a paragraph-shaped rubric (clarity, fluency, fidelity, usefulness). The current code path (`runSequentialLoop.ts:611-617`) sometimes threads `priorPicks`/`nextContext` into the judge prompt — we just need to NOT thread them (which the legacy parallel path already doesn't do).

### Coherence pass design — fork IterativeEditingAgent primitives

`IterativeEditingAgent`'s propose-review-apply loop already provides exactly the primitive we need: propose CriticMarkup edits → validate + cap → review per-group → apply right-to-left. The full agent runs up to N cycles with size guardrails, drift detection, drift recovery, format validation, and post-cycle ranking. For the coherence pass we want a **subset**:

- **Single cycle** — one proposer call + one approver call + apply. No drift recovery needed (the assembled article is the source of truth; nothing to drift from). No post-cycle ranking inside the coherence pass — the recombined+smoothed article gets article-level ranking once via the agent's outer `rankNewVariant` call.
- **Tightened guardrails** — `lengthCapRatio: 1.02` (coherence pass should NOT inflate the article — these are minor smoothing edits), `flowGuardrailEnabled: true` (preserve transition phrases), `redundancyJaccardThreshold: 0.30` (don't introduce duplicate phrasing).
- **Scoped proposer prompt** — fork `proposerPrompt.ts` to instruct the proposer to focus on **inter-paragraph seams**: transitions between paragraphs, pronoun resolution across paragraph boundaries, dedupe of repeated phrasing introduced by combining isolated rewrites, smoothing of voice/tone discontinuities. Keep the same byte-equality contracts (RULE 1 outside-markup fidelity, RULE 2 old-side fidelity) and the same `<source>…</source>` / `<output>…</output>` wrapper.
- **Standard approver prompt** — `approverPrompt.ts` works as-is (the approver's reject-on-meaning-change / reject-modify-quote / etc. rules apply equally to inter-paragraph smoothing edits).

The existing primitives we reuse without modification:
- `parseProposedEdits` (`evolution/src/lib/core/agents/editing/parseProposedEdits.ts`) — extracts CriticMarkup spans → EditGroup[].
- `validateEditGroups` (`evolution/src/lib/core/agents/editing/validateEditGroups.ts`) — already accepts an opts object with `lengthCapRatio` / `redundancyJaccardThreshold` / `flowGuardrailEnabled`.
- `parseReviewDecisions` (`evolution/src/lib/core/agents/editing/parseReviewDecisions.ts`) — parses approver JSONL.
- `applyAcceptedGroups` (`evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts`) — right-to-left splice with overlap detection.
- `buildApproverSystemPrompt` / `buildApproverUserPrompt` — unchanged.

Net new files for the coherence pass:
- `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.ts` (fork of `proposerPrompt.ts` with inter-paragraph-seam focus).
- `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/runCoherencePass.ts` (orchestrates one cycle: propose → parse → validate → review → apply).

### Lineage semantics (same as paragraph_recombine D4)

The emitted article variant has `parent_variant_ids = [originalParentVariantId]` only. Slot winners live in `execution_detail.slots[i].winnerSlotVariantId`. The coherence-pass edits land in `execution_detail.coherencePass.{proposedMarkup, approverGroups, reviewDecisions, appliedGroups, sizeRatio, proposeCostUsd, approveCostUsd}`. The recombined article BEFORE the coherence pass lives in `execution_detail.recombinedBeforeCoherencePass` for forensics; the FINAL text (after coherence pass) lives in `execution_detail.recombined.text` (same key as today).

### Cost stack

| Phase | AgentName label | Cost bucket |
|---|---|---|
| Per-slot rewrite | `paragraph_rewrite` (reuse existing label) | `paragraph_recombine_coherence_cost` (NEW umbrella) |
| Per-slot ranking | `paragraph_rank` (reuse existing label, relabeled from `'ranking'` via proxy) | `paragraph_recombine_coherence_cost` |
| Coherence-pass propose | `coherence_pass_propose` (NEW) | `paragraph_recombine_coherence_cost` |
| Coherence-pass review | `coherence_pass_review` (NEW) | `paragraph_recombine_coherence_cost` |
| Article-level ranking | `ranking` (reuse) | `ranking_cost` (existing) |

The new umbrella metric `paragraph_recombine_coherence_cost` keeps the new agent's cost separable from the existing `paragraph_recombine_cost` for cleanly compared A/B on the leaderboard. We write the metric once per invocation as the SUM of the four phase-cost accumulators (run-cumulative; MAX-safe via `writeMetricMax`). Per-purpose split lives in `execution_detail`.

Strategy/experiment-level propagation: `total_paragraph_recombine_coherence_cost` (sum) + `avg_paragraph_recombine_coherence_cost_per_run` (avg) — mirrors the `paragraph_recombine_cost` pattern.

### Cost envelope (rough estimate)

Per `evolution/docs/paragraph_recombine.md`'s empirical envelope, paragraph_recombine at defaults (12 slots × 3 rewrites + per-slot rank) lands at **~$0.0048 actual median**. The coherence pass adds:
- One proposer call: input = full recombined article (~12 KB) + prompt overhead (~3 KB); output = ~1.4× article (~16 KB). At `gpt-4.1-nano` ($0.10/$0.40 per 1M tokens), ~$0.0040 worst case, ~$0.0020 typical.
- One approver call: input = marked-up article (~16 KB) + per-group summary (~2 KB); output = JSONL decisions (~500 chars). At `gpt-4.1-nano`, ~$0.0018 typical.

Per-invocation cap: **$0.10** (vs $0.05 for plain `paragraph_recombine`). Pre-coherence-pass budget gate at 0.85× ($0.085 — coherence pass needs ~$0.006 headroom). Per-slot budget unchanged ($0.05 / 12 ≈ $0.0042). Phase D self-abort if `invocationScope.getOwnSpent() >= 0.85 × perInvocationCap`.

### Multi-dispatch reuse

The existing paragraph_recombine multi-dispatch logic in `runIterationLoop.ts:1339-1644` is parameterized on `iterCfg.maxDispatches > 1 && iterCfg.sourceMode === 'pool'`. The new agent type's dispatch branch can be a near-byte-for-byte clone with three swaps: (a) `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` → `EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED`, (b) `ParagraphRecombineAgent` → `ParagraphRecombineWithCoherencePassAgent`, (c) `iterationType: 'paragraph_recombine'` → `iterationType: 'paragraph_recombine_with_coherence_pass'` (the `MergeRatingsAgent.iterationType` enum needs the new value too).

Alternative considered + rejected: extract a shared `dispatchParagraphIterations` helper that both branches call. Rejected because the two branches will likely diverge over time (different env flags, different per-invocation caps, possibly different cost-projection inputs) and the duplication is bounded (~300 LOC).

## Decision Lock

After research, the locked decisions are:

| Field | Value |
|---|---|
| New `agentType` enum value | `paragraph_recombine_with_coherence_pass` |
| Marker tactic name | `paragraph_recombine_with_coherence_pass` (matching agent name) |
| Marker tactic color | `#0891b2` (dark cyan — distinct from `paragraph_recombine`'s `#06b6d4` light cyan; same family for kinship) |
| Kill-switch env var | `EVOLUTION_PARAGRAPH_RECOMBINE_COHERENCE_ENABLED` (default `'true'`) |
| Per-invocation cap | `$0.10` (vs $0.05 for plain `paragraph_recombine`) |
| Coherence-pass propose label | `coherence_pass_propose` |
| Coherence-pass review label | `coherence_pass_review` |
| Cost-metric bucket | `paragraph_recombine_coherence_cost` |
| Strategy rollups | `total_paragraph_recombine_coherence_cost`, `avg_paragraph_recombine_coherence_cost_per_run` |
| Agent class name | `ParagraphRecombineWithCoherencePassAgent` |
| Agent `name` field | `paragraph_recombine_with_coherence_pass` |
| Code location | `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/` (new directory) |
| Helper subagent label | `coherence_pass` (used in `evolution_logs.subagent_name` via `ctx.logger.child('coherence_pass')`) |
| Execution-detail schema | Extend `slotRecombineExecutionDetailSchema` with optional `coherencePass` block (NOT a separate schema — strategies that don't run the new agent leave the field undefined; new agent always populates it) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/architecture.md
- evolution/docs/paragraph_recombine.md — the closest analog; D4 (lineage), D9 (defaults), D10 (per-slot match persistence), D16 (per-slot AgentCostScope), D18 (parallel-slot + sequential-rank invariant), D20 (winner source enum). Sequential context-aware addendum (debug_performance_paragraph_recombine_20260612) explains the legacy-vs-sequential mode switch we will hard-pin to legacy.
- evolution/docs/editing_agents.md — propose/review/apply primitives, `validateEditGroups` opts (lengthCapRatio / redundancyJaccardThreshold / flowGuardrailEnabled), cycle hard-rule + size-ratio guardrails.
- evolution/docs/criteria_agents.md — already forks `IterativeEditingAgent` primitives (`ProposerApproverCriteriaGenerateAgent`); confirms the fork pattern is supported.
- evolution/docs/agents/overview.md — Agent.run() template, AgentCostScope, COST_METRIC_BY_AGENT mapping.
- evolution/docs/rating_and_comparison.md — `comparisonMode: 'paragraph'` rubric, 2-pass reversal, parseWinner.
- evolution/docs/arena.md — `loadArenaEntries`, `syncToArena`, slot topic conventions.
- evolution/docs/data_model.md — `evolution_variants.variant_kind` / `evolution_prompts.prompt_kind` + `sync_to_arena` RPC behavior (paragraph slot rewrites persist exclusively through this RPC with `parent_variant_ids` written on INSERT).
- evolution/docs/architecture.md — config-driven iteration loop, two-layer budget, agent / subagent / level vocabulary.
- evolution/docs/multi_iteration_strategies.md — `iterationConfigSchema` enum + Zod refinements; multi-dispatch.
- evolution/docs/strategies_and_experiments.md — `StrategyConfig` shape; strategy aggregates; bootstrap CIs.
- evolution/docs/metrics.md — metric registry, propagation aggregators, dynamic prefixes, stale recompute.
- evolution/docs/cost_optimization.md — V2CostTracker reserve-before-spend, per-purpose cost split via AgentName labels, writeMetricMax MAX-safety, layered cost-fallback.
- evolution/docs/reference.md — env-var ladder, kill-switch conventions, AgentName enum, `agentRegistry.ts` registration, dispatch helpers.
- evolution/docs/variant_lineage.md — `parent_variant_ids` semantics (D4: single primary parent only; slot winners live in execution_detail).
- evolution/docs/entities.md — Entity / Agent base classes, metric merging, parity test.
- evolution/docs/prompt_editor.md — confirms LLM-call cost-attribution conventions used by all agents.

## Code Files Read

### Existing paragraph_recombine implementation
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` (1110 LOC) — the agent we're forking. Key seams identified:
  - `execute()` body — the `if (sequentialEnabled && paragraphCount > 0)` branch is what we DON'T want; the `else { … legacy parallel path … }` branch (lines 396-417) is what we DO want, modulo prompt swap.
  - `processSlot()` (lines 628-1087) — the per-slot pipeline (topic upsert, arena load, M parallel rewrites, sequential ranking, syncToArena, persistSlotMatches). Reusable as-is with the rewrite-prompt swap.
  - `paragraphRewriteTemperature()` (lines 125-143) — the 1.2–2.0 ladder with index-0 dropped to 0.7 for length compliance. Reusable; the new agent may want a different temperature schedule (e.g., flatter — closer to 0.8 across the board — since rewrites should be conservative reorganizations, not creative-axis explorations). **Decision deferred to /plan-review.**
  - Article-level ranking (lines 562-592) — reusable as-is.
- `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts` — current rewrite prompt + `PARAGRAPH_REWRITE_DIRECTIVES` (3 directives: tighten, add-one-example, improve-flow). The new prompt will REMOVE the "add one example" directive and add a new "reorganize without adding content" directive set.
- `evolution/src/lib/core/agents/paragraphRecombine/buildSequentialRewritePrompt.ts` — NOT used by the new agent (we force legacy parallel path).
- `evolution/src/lib/core/agents/paragraphRecombine/sequentialExecute.ts` — NOT used by the new agent.

### Existing editing primitives (to fork for coherence pass)
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` (766 LOC) — propose-review-apply pattern. We fork the inner cycle logic (lines 200-547) into a single-cycle helper.
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` — system + user prompt builders for the proposer. Fork into `buildCoherencePassProposerPrompt.ts` with inter-paragraph-seam focus.
- `evolution/src/lib/core/agents/editing/approverPrompt.ts` — reuse `buildApproverSystemPrompt` + `buildApproverUserPrompt` as-is.
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` — reuse `parseProposedEdits` + `sourceContainsMarkup` as-is.
- `evolution/src/lib/core/agents/editing/parseReviewDecisions.ts` — reuse `parseReviewDecisions` as-is.
- `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` — reuse `applyAcceptedGroups` as-is.
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — reuse with tighter opts `{ lengthCapRatio: 1.02, redundancyJaccardThreshold: 0.30, flowGuardrailEnabled: true }`.
- `evolution/src/lib/core/agents/editing/constants.ts` — already exports `EDIT_NEWTEXT_LENGTH_CAP=500`, `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30`, `SIZE_RATIO_HARD_CAP=1.5`, `PER_INVOCATION_BUDGET_ABORT_FRACTION=0.9`.

### Schemas + dispatch wiring
- `evolution/src/lib/schemas.ts` — `iterationAgentTypeEnum` (line 579, 10 enum values; we add the 11th). `canBeFirstIteration` (line 610), `producesNewVariants` (line 636) — both need to include the new agent type. `isVariantProducingAgentType` (line 623) — paragraph_recombine is NOT in that set, neither will the new agent be (it's not "parallel-batch sourceMode" family). Zod refinements at lines 778-839 — extend the paragraph_recombine-only knobs gate to allow them for the new agent type too.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — the `paragraph_recombine` dispatch branch lives at lines 1339-1644. We add a sibling `else if (iterType === 'paragraph_recombine_with_coherence_pass')` branch just after it, near-byte-for-byte clone with the 3 swaps documented above.
- `evolution/src/lib/core/agentNames.ts` — `AGENT_NAMES` (line 13, currently 18 entries). We add 2 new entries: `coherence_pass_propose`, `coherence_pass_review`. `COST_METRIC_BY_AGENT` (line 74) — map both new labels to `paragraph_recombine_coherence_cost`. Reuse `paragraph_rewrite` + `paragraph_rank` for the per-slot pipeline.
- `evolution/src/lib/core/agentRegistry.ts` — register the new agent class in `getAgentClasses()` (line 30).
- `evolution/src/lib/core/agents/index.ts` — add the new agent to the eager-import barrel (load-bearing for attribution-extractor registration per Phase 8).
- `evolution/src/lib/core/tactics/index.ts` — add `paragraph_recombine_with_coherence_pass` to `MARKER_TACTICS` (line 161) + `TACTIC_PALETTE` (line 83).

### MergeRatingsAgent iterationType enum
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` (not read in detail this round) — the `iterationType` field on its input narrows the union including `'paragraph_recombine'`. New value `'paragraph_recombine_with_coherence_pass'` needs to be added so the merge agent's `iterationType` enum stays exhaustive.

### Metrics registry
- `evolution/src/lib/metrics/registry.ts` (not re-read this round) — add `paragraph_recombine_coherence_cost` as a run-level cost metric (`during_execution` timing, `cost` category, `listView: true`). Add propagation `total_paragraph_recombine_coherence_cost` (sum) + `avg_paragraph_recombine_coherence_cost_per_run` (avg) at strategy + experiment levels.

## Key Findings

1. **Option A confirmed**: a new top-level agent type cloned from `ParagraphRecombineAgent` is the cleanest path. The existing agent already supports the "legacy parallel path" (no context-aware sequential mode) via the `else` branch in `execute()`; we just need to force-pin that branch by NOT reading the `EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED` env at all in the new agent. This avoids cross-coupling — the new agent's behavior is independent of operational tweaks to the existing one.

2. **No DB migration needed**: `evolution_variants.variant_kind` + `evolution_prompts.prompt_kind` already exist (migration `20260527000001`). The `sync_to_arena` RPC already supports `agent_name` + `variant_kind` on INSERT (migration `20260527000003`) and `parent_variant_ids` (migration `20260529000001`). No new tables, no new columns, no new RPCs.

3. **Coherence pass is a pure code change**: the IterativeEditingAgent primitives (parse / validate / review-parse / apply) work on any text + marked-up text pair. They have no coupling to the multi-cycle IterativeEditingAgent's outer loop. Forking them into a single-cycle `runCoherencePass.ts` helper is mechanical.

4. **The `lengthCapRatio: 1.02` constraint** is critical. The default `SIZE_RATIO_HARD_CAP=1.5` would let the coherence pass inflate the article by up to 50% — completely contrary to "minor edits to resolve incoherences." The `validateEditGroups` opts parameter already accepts a tighter override (used by `ProposerApproverCriteriaGenerateAgent` at 1.10×), so we just pass `1.02` (≤2% growth).

5. **`flowGuardrailEnabled: true`** is the right setting because the coherence pass's MAIN job is improving transitions; we want the LLM to ADD transitions, not delete them. The current guardrail rejects edits that delete/replace paragraph-starting transitions UNLESS the new text preserves a transition phrase — which is exactly the asymmetric protection we want.

6. **Per-rewrite temperature** — open question, deferred to /plan-review. The current `ParagraphRecombineAgent` uses 1.2–2.0 ladder for index ≥ 1 (high diversity) + 0.7 for index-0 (tightening with length compliance). The new agent's rewrites should NOT be creative — they're reorganizations of existing content. A flatter ladder (e.g., 0.7 / 1.0 / 1.3) may be more appropriate. Phase 1 of the plan locks this.

7. **Per-rewrite directives** — open question, deferred to /plan-review. The current directives are: (0) tighten, (1) add ONE example, (2) improve flow. The new agent must REMOVE the "add example" directive (violates "no new content"). Three candidate directives for the new agent:
   - (0) "Reorder sentences for better logical flow. Same content, different order. Do not add or remove information."
   - (1) "Tighten wording and delete redundancy. Same meaning in fewer words. Do not delete non-redundant content."
   - (2) "Improve sentence structure and cadence. Vary sentence length and rhythm. Same content, smoother prose."

8. **No coordinator, no priorPicks** — the new agent's per-slot rewrites run in true parallel with zero cross-slot signal. The only inputs to each rewrite are: the article H1 title + the original paragraph text + the directive + the temperature. Judging is also context-free (paragraph-level rubric, no priorPicks, no nextContext).

## Open Questions

1. **Coherence pass model selection**: should the proposer/approver use `judgeModel` (cheap, ~$0.04/$0.10) or `generationModel` (mid-tier, ~$0.10/$0.40)? Inter-paragraph smoothing needs writing skill, not just judgment. Lean toward `generationModel` for the proposer, `judgeModel` for the approver. **Decision deferred to /plan-review.**

2. **Per-rewrite temperature ladder** for isolated-rewrite mode — see Key Finding #6.

3. **Per-rewrite directives** — see Key Finding #7.

4. **Should the coherence pass have its own per-iteration enable flag?** E.g., `iterCfg.coherencePassEnabled: boolean` (default `true`) so a researcher can A/B "with vs without coherence pass" cheaply via one strategy field. Lean **yes**, since this directly tests the project's hypothesis. **Decision deferred to /plan-review.**

5. **Does the coherence pass write its own per-cycle invocation row?** Currently `IterativeEditingAgent` writes ONE invocation row per parent (cycles live in `execution_detail.cycles[]`). The new agent's coherence pass is single-cycle inside a paragraph_recombine_with_coherence_pass invocation — it should live in `execution_detail.coherencePass` (not a separate invocation row). This keeps cost attribution per `Agent.run()` (one row, one AgentCostScope) clean. **Decided: single invocation row.**

6. **Should the coherence-pass-only output be persisted as a separate variant?** Currently the recombined-before-coherence-pass text is intermediate-only. If the coherence pass surfaces interesting findings (e.g., the assembled article is already coherent and the pass changes nothing), we may want to track that. Resolution: persist both `execution_detail.recombinedBeforeCoherencePass` (intermediate text, for forensics) AND `execution_detail.recombined.text` (final = after coherence pass). No separate variant row.

7. **Multi-dispatch support from day 1?** The existing paragraph_recombine multi-dispatch (J4) added significant complexity in `runIterationLoop.ts:1339-1644`. We could ship the new agent with single-dispatch only (back-compat shape) and add multi-dispatch in a follow-up. Lean **yes — ship multi-dispatch from day 1** since the dispatch code is a near-clone of the existing branch (~300 LOC) and adding it later would mean two dispatch shapes drift apart. **Decided: include multi-dispatch in Phase 5.**

8. **Should we add a slot-level metric for "rewrite added new content" (a proxy for prompt-violation)?** The `sentence_verbatim_ratio` helper (`evolution/src/lib/shared/sentenceOverlap.ts`) computes per-variant verbatim overlap with parent — for the new agent we'd want this to be HIGH (close to 1.0 means no new content). We could add per-slot `sentenceVerbatimRatioVsOriginal` as a slot-detail field and bubble up a run-level `min_slot_verbatim_ratio` metric to flag invocations where prompt constraints failed. **Decision deferred to /plan-review.**
