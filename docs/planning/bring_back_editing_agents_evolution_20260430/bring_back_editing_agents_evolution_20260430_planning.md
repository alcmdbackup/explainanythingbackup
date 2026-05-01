# Bring Back Editing Agents Evolution Plan

## Background

The V2 evolution pipeline shipped with only two work-agent types (full-article regeneration and pairwise ranking), losing the targeted-editing capabilities of three V1 agents (`IterativeEditingAgent`, `OutlineGenerationAgent`, `SectionDecompositionAgent`) deleted in commit `4f03d4f6` (2026-03-14). The orphaned Zod schemas, `DETAIL_VIEW_CONFIGS` entries, the `agentExecutionDetailSchema` discriminated union slot, the `InvocationEntity.listFilters` dropdown options, and `executionDetailFixtures` for all three agents are still in the V2 tree. Five rounds of research (20 agent investigations) confirmed the integration cost: **~250 LOC for v1, no DB migrations beyond the cost-calibration phase enum, no entity-registry overhaul**. This project ships **Variant A — `IterativeEditingAgent` only, fully fleshed** in v1; the other two agents land in v1.1 / v1.2.

## Requirements (from GH Issue #NNN)

I want to reintroduce some of the editing agents we've had historically. Please look through github history and find the various editing agents including iterativeediting agent and outline editing agent

## Problem

The V2 pipeline cannot make targeted edits to a variant. `GenerateFromPreviousArticleAgent` always rewrites the entire article from scratch given a tactic — there is no surgical "fix only this weakness" path, no per-section parallel edit, and no outline-level restructure. Reviewers also cannot easily see where edits were made because the invocation-detail page has no parent-vs-child diff. The orphaned V1 scaffolding makes resurrection lower-risk than a from-scratch design, but the work has been deferred multiple times — `feat/create_editing_agent_evolution_20260415` and `feat/introduce_editing_agent_evolution_20260421` both abandoned with planning artifacts but no implementation.

## Options Considered

- [x] **Option A (CHOSEN): Resurrect IterativeEditingAgent on V2 base class, fully fleshed (Variant A).** Pull V1 source from `git show 8f254eec:evolution/src/lib/agents/iterativeEditingAgent.ts`, port to `Agent<TInput, TOutput, TDetail>`, reuse orphaned schema + `DETAIL_VIEW_CONFIGS`. Add `'text-diff'` field type + `<TextDiff>` rendering on invocation detail. Defer Outline + SectionDecomp to v1.1 / v1.2. Lowest-risk path; 4 weeks to ship.
- [ ] **Option B: All three agents in skeletal form (Variant B).** Aggressive single-PR scope (~3600 LOC). 6–9 weeks realistic; high risk if any one agent has a bug. Same day-84 all-three milestone as Option A but with worse intermediate risk profile.
- [ ] **Option C: Single umbrella `EditingAgent` with `strategy` sub-field.** Cleaner agentType enum but blocks per-agent `execution_detail` shapes and per-agent cost attribution.

## Decisions Locked (post-redesign 2026-04-30)

> **Algorithm pivot.** The rubric-driven V1 algorithm is replaced with a **propose-then-review** protocol. Per cycle: (1) proposer LLM marks up the article with numbered CriticMarkup edits; (2) reviewer LLM accepts/rejects each numbered edit individually with a written reason. Apply accepted edits, repeat for several cycles. See research doc § "How IterativeEditingAgent Works (v2 redesign)" for the full walkthrough.

1. **Algorithm:** No rubric, no ReflectionAgent dependency, no open-ended initial review. Per-cycle 2-pass protocol (propose numbered edits → per-edit review). Multiple cycles until all-rejected, no-edits-proposed, parse-failed, max-cycles, or budget-exceeded.
2. **Markup syntax:** `{++ [#N] inserted ++}` / `{-- [#N] deleted --}` / `{~~ [#N] old ~> new ~~}`. Number lives inside the tag. Adjacent paired add/delete with the same `[#N]` are merged by parser into one `replace` edit.
3. **Reviewer output:** JSONL — one `{editNumber, decision, reason}` per line. Missing/malformed decisions default to `reject` (conservative).
4. **No 2-pass direction reversal in v1.** Per-edit reasoning is the auditability mechanism. Add devil's-advocate reverse pass in v1.1 if reviewer rubber-stamps in staging.
5. **Naming:** One canonical name everywhere — `'iterativeEditingAgent'`. Used as the `iterationConfig.agentType` value, the `agent_name` written to `evolution_agent_invocations`, the schema `detailType` discriminator, and the `DETAIL_VIEW_CONFIGS` key. Class name is `IterativeEditingAgent` (PascalCase). UI label is "Iterative Editing" (drops the redundant "Agent" suffix for display). The orphaned V1 schema's `'iterativeEditing'` discriminator is replaced (Phase 1.8 already authors a fresh schema), and `InvocationEntity.listFilters` is updated from `'iterativeEditing'` to `'iterativeEditingAgent'`. Per-LLM-call AgentName labels stay snake_case (`iterative_edit_propose` / `iterative_edit_review` / `iterative_edit_drift_recovery`) and the cost metric stays `iterative_edit_cost`.
6. **Parent selection:** Top-K via optional `editingTopK` field on `IterationConfig` (default = iteration's parallel dispatch count from `projectDispatchPlan`).
7. **`MergeRatingsAgent` compat:** Pass editing match buffers with `iterationType: 'generate'` (semantically identical to generate's local-rank output). No `MergeRatingsAgent` changes.
8. **Schema:** The orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) was V1-rubric-shaped and **does not fit the new design**. We author a fresh schema (see research doc); the orphaned one is deleted in Phase 1.
9. **`Match.frictionSpots`:** Out of scope (dead code on both ends).
10. **Per-cycle invocation timeline UI:** Out of scope for v1. Cycles in `execution_detail`; visual timeline → v1.1.
11. **Drift recovery:** when the strip-markup drift check finds drift, the Implementer attempts an LLM-driven recovery for *minor* drift (≤ 3 regions, ≤ 200 chars, no markup overlap). A nano-class model classifies each region as `benign` (cosmetic substitutions like smart quotes / dashes / whitespace, auto-patched) or `intentional` (meaningful unwrapped change, abort cycle). New strategy field `driftRecoveryModel?: string` (default gpt-4.1-nano), new AgentName label `iterative_edit_drift_recovery`, new feature flag `EVOLUTION_DRIFT_RECOVERY_ENABLED` (default `'true'`). Per-cycle `execution_detail.driftRecovery` records regions, classifications, outcome, cost. Stop-reason union expands: `proposer_drift_major` / `proposer_drift_intentional` / `proposer_drift_unrecoverable`.

## Phased Execution Plan

### Phase 1: Scaffolding — enum + schema + registry + cost-calibration migration (Week 1)
- [ ] **1.1** `evolution/src/lib/schemas.ts:388` — extend `iterationAgentTypeEnum` with `'iterativeEditingAgent'`. Update 4 refines on `iterationConfigSchema` (lines 413–425) to allow iterativeEditingAgent iterations (forbid as first iteration).
- [ ] **1.2** `evolution/src/lib/core/agentNames.ts` — add `'iterativeEditingAgent'` to `AGENT_NAMES`; add `iterativeEditingAgent → 'iterative_edit_cost'` to `COST_METRIC_BY_AGENT`. Plus per-LLM-call labels: `'iterative_edit_propose'`, `'iterative_edit_review'`, `'iterative_edit_drift_recovery'` — all map to the single `iterative_edit_cost` metric (per-purpose cost split tracked via execution_detail, not per-metric, for v1 simplicity).
- [ ] **1.3** `evolution/src/lib/metrics/types.ts` — add `'iterative_edit_cost'`, `'total_iterative_edit_cost'`, `'avg_iterative_edit_cost_per_run'` to `STATIC_METRIC_NAMES`.
- [ ] **1.4** `evolution/src/lib/core/metricCatalog.ts` + `evolution/src/lib/metrics/registry.ts` — add 1 during-execution def + 2 propagation defs (mirror `generation_cost` pattern).
- [ ] **1.5** New migration `supabase/migrations/<timestamp>_evolution_cost_calibration_editing_phase.sql` — extend `evolution_cost_calibration.phase` CHECK to accept `'iterative_edit_propose'`, `'iterative_edit_review'`, and `'iterative_edit_drift_recovery'` (three phases: propose, review, drift-recovery have different cost shapes).
- [ ] **1.6** `evolution/scripts/refreshCostCalibration.ts` — add the three new phases to the `Phase` literal type and `asPhase()` mapping.
- [ ] **1.7** `evolution/src/lib/pipeline/infra/estimateCosts.ts` — add `__builtin_iterative_edit_propose__: 7500` (article-with-markup is ~1.4× input), `__builtin_iterative_edit_review__: 500` (one JSON line per edit), and `__builtin_iterative_edit_drift_recovery__: 200` (one JSON line per drift region, typically 1–3) to `EMPIRICAL_OUTPUT_CHARS`. Add `estimateIterativeEditingCost(seedChars, generationModel, driftRecoveryModel, maxCycles)` returning `{ expected, upperBound }` — expected accounts for 2 calls/cycle (propose + review); upperBound assumes drift recovery fires once across all cycles (cheap pessimistic upper-bound).
- [ ] **1.8** **Replace** orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) — V1-rubric-shaped, doesn't fit the new design. Author a fresh schema named `iterativeEditingAgentExecutionDetailSchema` with `detailType: 'iterativeEditingAgent'` (note the `Agent` suffix — matches the unified canonical name from Decisions §5) and `cycles[]` containing `{cycleNumber, proposedMarkup, proposedGroupsRaw[], droppedPreApprover[], approverGroups[], reviewDecisions[], droppedPostApprover[], appliedGroups[], acceptedCount, rejectedCount, appliedCount, formatValid, newVariantId?, parentText, childText?, driftRecovery?}` (full shape in research doc). Rename `executionDetailFixtures.iterativeEditingDetailFixture` → `iterativeEditingAgentDetailFixture` and rewrite to match. Update `agentExecutionDetailSchema` discriminated union slot. Also update `InvocationEntity.listFilters` (lines 49–54): replace `'iterativeEditing'` with `'iterativeEditingAgent'`.
- [ ] **1.9** Cleanup: delete ghost `mutate_clarity` / `crossover` / `mutate_engagement` from `TACTIC_PALETTE` (`tactics/index.ts:94–96`); delete unused `evolution/src/lib/legacy-schemas.ts`; fix `low_sigma_opponents_count` → `low_uncertainty_opponents_count` mismatch at `schemas.ts:819` vs `detailViewConfigs.ts:166`.

### Phase 2: Proposer + Implementer + Approver components + unit tests (Week 2)

> **Three-role architecture** (research doc § "How IterativeEditingAgent Works"). Two LLM calls per cycle (Proposer, Approver) and one deterministic safety layer (Implementer) that runs twice per cycle: a pre-Approver pre-check that parses positions, runs a strip-markup drift check against `current.text`, filters hard-rule violators, and a post-Approver application step that resolves range overlaps and format-validates. **No fuzzy anchor matching** — every edit has an exact byte position from the Proposer's marked-up output.

#### 2.A — IterativeEditingAgent class (orchestration)

- [ ] **2.A.1** Create `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` (~250 LOC). Extend `Agent<IterativeEditInput, IterativeEditOutput, IterativeEditingExecutionDetail>`. Set `usesLLM = true`, `name = 'iterativeEditingAgent'`.
- [ ] **2.A.2** Per-invocation `EvolutionLLMClient` via `Agent.run()` template. `AgentCostScope.getOwnSpent()` for cost attribution.
- [ ] **2.A.3** Implement main `execute()` loop (~120 LOC) — for each cycle 1..maxCycles:
   1. **Proposer call**: send `current.text` + soft-rules system prompt → `proposedMarkup`
   2. **Implementer pre-check (parse + position math)**:
      a. Parse markup, extract atomic edits with `markupRange`, group by `[#N]`
      b. Strip markup → `recoveredSource`. Compute drift regions vs `current.text` with normalized whitespace.
      c. Compute each atomic edit's `range` (positions in `current.text`) by mapping markup positions through the strip operation; capture `contextBefore` / `contextAfter`
   3. **Drift handling** (if any drift detected):
      a. Classify magnitude: major (> 3 regions OR > 200 chars OR markup overlap) → exit with `stopReason: 'proposer_drift_major'`
      b. Else minor → if `EVOLUTION_DRIFT_RECOVERY_ENABLED !== 'false'`, call `recoverDrift(...)` — returns `{ outcome, patchedMarkup?, classifications[] }`
      c. On `outcome === 'recovered'`: re-parse the patched markup; continue with the patched groups
      d. On `outcome === 'unrecoverable_intentional'`: exit `stopReason: 'proposer_drift_intentional'`
      e. On `outcome === 'unrecoverable_residual'`: exit `stopReason: 'proposer_drift_unrecoverable'`
      f. If recovery disabled by flag: exit `stopReason: 'proposer_drift_major'` regardless of magnitude
   4. **Validate hard rules** per atomic edit; drop violator groups silently. Cap groups to ≤ 30 atomic edits / cycle and ≤ 5 atomic edits / group → `{ approverGroups, droppedPreApprover[] }`. If `approverGroups.length === 0` → exit with `stopReason: 'no_edits_proposed'` or `'parse_failed'`
   5. **Approver call**: send `proposedMarkup` (or `proposedMarkupPatched` if recovery fired) + group summary → JSONL
   6. **Parse Approver output** → `reviewDecisions[]` (missing decisions default to `reject`)
   7. **Implementer application**: collect atomic edits from accepted groups, detect range overlaps between groups (drop later group on conflict), verify each edit's context-string failsafe + `oldText` match against `current.text` (drop group on mismatch), sort survivors by `range.start` descending, apply right-to-left to `current.text` → `newText`. Format-validate. → `{ newText, droppedPostApprover[], appliedGroups[] }`
   8. If `newText !== current.text` and format-valid: create new `Variant`, add to pool, `current = newVariant`
   9. If `appliedCount === 0`: exit with `stopReason: 'all_edits_rejected'`
- [ ] **2.A.4** Emit rich `execution_detail.cycles[]` per cycle (full shape per research doc § "execution_detail shape"). Each cycle entry has `proposedMarkup` + `proposedGroupsRaw` + `droppedPreApprover[]` + `approverGroups[]` + `reviewDecisions[]` + `droppedPostApprover[]` + `appliedGroups[]` + `parentText` + `childText`.

#### 2.B — Proposer (LLM call #1)

- [ ] **2.B.1** Build `evolution/src/lib/core/agents/editing/proposerPrompt.ts` (~80 LOC):
   - System prompt embeds **all soft rules** (preserve quotes, citations, URLs; no new headings; one-sentence edits preferred; no edits in code blocks; preserve voice and tone).
   - Inline syntax docs (3 markup forms with examples).
   - Output-format instruction: full article with inline numbered edits, no commentary.
   - Use AgentName label `iterative_edit_propose`.
- [ ] **2.B.2** Unit tests `proposerPrompt.test.ts` (~80 LOC, ~6 cases) — assert all soft rules present in rendered prompt; assert syntax examples include all 3 forms; assert AgentName label routes to correct cost metric.

#### 2.C — Implementer pre-check (deterministic, parser + validator)

- [ ] **2.C.1** Build `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` (~280 LOC):
   - Regex extraction for `{++ [#N] ... ++}`, `{-- [#N] ... --}`, `{~~ [#N] ... ~> ... ~~}`.
   - For each atomic edit, record `markupRange: {start, end}` (byte positions in `proposedMarkup`).
   - Group atomic edits by `[#N]` into `EditGroup[]`.
   - Adjacent same-`[#N]` add+delete merged into one `replace` edit.
   - **Strip-markup pass**: produce `recoveredSource` (the marked-up text with all CriticMarkup removed and only the "before" content kept — i.e., for a substitution, keep the deleted text; for an insertion, keep nothing; for a deletion, keep the deleted text). Track a `markupPos → sourcePos` offset map so we can translate each atomic edit's `markupRange` into `range: {start, end}` in `current.text`.
   - **Context capture (failsafe)**: for each atomic edit, after `range` is computed, capture `contextBefore = current.text.slice(max(0, range.start - CONTEXT_LEN), range.start)` and `contextAfter = current.text.slice(range.end, min(current.text.length, range.end + CONTEXT_LEN))` where `CONTEXT_LEN = 30`. Used by the applier to verify positions still match before splicing.
   - Adversarial handling: unbalanced tags → drop the unbalanced atomic edit silently; nested tags → drop silently; missing `[#N]` → auto-assign sequential; combined-form `~~` substitution where content contains `~>` → drop silently (use paired form instead); duplicate non-paired numbers → keep first, drop rest.
   - Return `{ groups: EditGroup[], recoveredSource: string, dropped: Array<{ reason, detail }> }`.
- [ ] **2.C.2** Build `evolution/src/lib/core/agents/editing/checkProposerDrift.ts` (~50 LOC):
   - Compare `recoveredSource` to `current.text` with normalized whitespace (collapse runs, trim line ends; preserve paragraph breaks).
   - Return `{ drift: false }` on match, or `{ drift: true, firstDiffOffset: number, sample: string }` on mismatch.
   - This is a **cycle-level kill switch**: any drift means the Proposer modified text outside its markup, and we cannot trust positions.
- [ ] **2.C.3** Build `evolution/src/lib/core/agents/editing/validateEditGroups.ts` (~150 LOC):
   - Hard-rule checks (per atomic edit, using `range.start`/`range.end` against `current.text`): length cap 500, no `\n\n` in `oldText`, no heading-line overlap (range crosses any `^#+ ` line), no heading line in `newText`, no code fence in `oldText`/`newText`, no list-item-boundary span, no horizontal-rule line.
   - **Group-level enforcement: any atomic edit in a group fails any hard rule → drop the whole group**.
   - Cap enforcement: total atomic edits ≤ 30 (drop excess groups in number order); each group ≤ 5 atomic edits (drop wholesale).
   - Return `{ approverGroups: EditGroup[], droppedPreApprover: Array<{ groupNumber, reason, detail }> }`.
- [ ] **2.C.4** Unit tests `parseProposedEdits.test.ts` (~400 LOC, ~32 cases): well-formed input (all 3 forms), grouped edits sharing `[#N]` (cross-document), unbalanced tags (silently dropped), nested tags (silently dropped), missing numbers (auto-assigned), duplicate non-paired numbers (first kept), combined `~~` form with `~>` in content (silently dropped), paired add/delete merged correctly, position extraction at document start/end, Unicode in edit content, multiple groups in one paragraph, position math correctness (range maps to correct bytes in `current.text`), `markupRange` matches `proposedMarkup` slice exactly, recoveredSource correctness for each edit type, **context capture** at document start (contextBefore truncated/empty), at document end (contextAfter truncated/empty), with adjacent edits (their contexts overlap, both captured correctly), exact CONTEXT_LEN boundary correctness (length 30 enforced).
- [ ] **2.C.5** Unit tests `checkProposerDrift.test.ts` (~100 LOC, ~10 cases): exact match (no drift), trivial whitespace differences (no drift), one-character text difference (drift detected, offset reported), proposer added text outside markup (drift), proposer removed text outside markup (drift), normalized newlines (no drift).
- [ ] **2.C.6** Unit tests `validateEditGroups.test.ts` (~250 LOC, ~20 cases): each hard rule (10), group-level coherence (single bad atomic → whole group dropped), cycle cap (30+ edits), group cap (6+ edits), edge cases (heading at very start of document, code fence at very end, etc.).
- [ ] **2.C.7** Property-based test `parseProposedEdits.property.test.ts` — fast-check generators: parse → reconstruct → parse-again idempotency on well-formed inputs; arbitrary text never crashes parser; arbitrary `[#N]` numbers don't break grouping; range-correctness invariant (for any well-formed markup, every edit's `range` slices the correct content from `current.text`).
- [ ] **2.C.8** Build `evolution/src/lib/core/agents/editing/recoverDrift.ts` (~150 LOC):
   - **Magnitude classifier (deterministic)**: `classifyDriftMagnitude(driftRegions, proposedMarkup, edits): 'minor' | 'major'`. Major if `regions.length > 3` OR `totalDriftedChars > 200` OR any region overlaps any `markupRange` from the parser. Constants: `DRIFT_MAX_REGIONS = 3`, `DRIFT_MAX_CHARS = 200`.
   - **Recovery LLM call (when minor)**: `recoverDriftWithLLM(driftRegions, current.text, proposedMarkup, llm)` builds a focused prompt with each region's surrounding context (30 chars on each side, NEVER the full article), AgentName label `iterative_edit_drift_recovery`. System prompt: "classify each drift region as benign (cosmetic — smart quotes, dashes, whitespace, Unicode) or intentional (meaningful change). Output one JSON line per region: `{offset, classification, patch}`."
   - **JSONL parser**: line-by-line `JSON.parse`, skip unparseable lines, default missing classifications to `'intentional'` (conservative — abort cycle if we can't tell).
   - **Patcher (deterministic)**: for each `'benign'` region, splice `proposedMarkup` at `markupOffset` to replace the drifted text with the source patch. Ordering: apply patches in reverse-offset order (right-to-left) so offsets don't shift.
   - **Re-verify**: run `parseProposedEdits` + drift check on the patched markup. Return `{ outcome: 'recovered' | 'unrecoverable_residual' | 'unrecoverable_intentional', patchedMarkup?, regions, classifications, costUsd }`.
   - **Feature flag**: read `EVOLUTION_DRIFT_RECOVERY_ENABLED` once at function entry; if `'false'`, return early with `outcome: 'skipped_major_drift'` regardless of magnitude (caller treats this same as major drift).
- [ ] **2.C.9** Unit tests `recoverDrift.test.ts` (~250 LOC, ~18 cases):
   - Magnitude classifier: minor (small drift, no overlap) → `'minor'`; > 3 regions → `'major'`; > 200 chars → `'major'`; overlap with `markupRange` → `'major'`; exactly 3 regions, exactly 200 chars (boundary).
   - Recovery LLM call (mocked): all benign → patches applied, re-check passes, outcome `'recovered'`; one intentional → outcome `'unrecoverable_intentional'`; mixed → still `'unrecoverable_intentional'` (any intentional aborts).
   - Patcher correctness: smart-quote substitution patched, em-dash patched, multiple patches applied in reverse-offset order (positions don't shift mid-application), patched markup re-parses without drift.
   - Edge cases: zero regions (function shouldn't be called, but if it is → outcome `'recovered'` no-op); LLM returns malformed JSON line (skipped, missing classifications default to intentional); LLM returns extra fields (passthrough).
   - Feature flag: `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` → outcome `'skipped_major_drift'`, no LLM call, costUsd 0.
   - Re-check after patch: if patches don't fully resolve (residual drift) → outcome `'unrecoverable_residual'`.

#### 2.D — Approver (LLM call #2)

- [ ] **2.D.1** Build `evolution/src/lib/core/agents/editing/approverPrompt.ts` (~80 LOC):
   - System prompt: "you are reviewing edits to an article; be conservative; only accept edits that demonstrably improve clarity, structure, engagement, grammar, or overall effectiveness; reject edits that violate any of these soft rules: [embedded soft rules]".
   - Body: marked-up article + machine-generated edit summary table — one row per group with all atomic edits in the group.
   - Output instruction: one JSON line per **group**, `{groupNumber, decision, reason}`.
   - Use AgentName label `iterative_edit_review`.
- [ ] **2.D.2** Build `evolution/src/lib/core/agents/editing/parseReviewDecisions.ts` (~80 LOC):
   - Line-by-line `JSON.parse`; skip unparseable lines (log).
   - Ignore decisions for unknown group numbers.
   - Decisions for groups not in input → ignored.
   - **Missing decisions for any expected group → default to `{decision: 'reject', reason: 'no decision returned'}`** (conservative).
   - Return `ReviewDecision[]`.
- [ ] **2.D.3** Unit tests `parseReviewDecisions.test.ts` (~150 LOC, ~12 cases): well-formed JSONL, partial parse (one bad line), missing decisions → reject default, unknown group numbers ignored, malformed JSON, extra fields (passthrough).

#### 2.E — Implementer application (deterministic, position-based applier)

- [ ] **2.E.1** Build `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` (~180 LOC):
   - Filter `approverGroups` to those with `decision === 'accept'`.
   - Build `acceptedAtomicEdits[]` — flatten all atomic edits from accepted groups, each tagged with its parent `groupNumber`.
   - **Detect range overlaps between groups**: for any two atomic edits from different groups whose `range`s overlap, drop the higher-numbered group entirely. Log to `droppedPostApprover[]` with `reason: 'application_conflict'` and detail showing both groups' numbers + ranges.
   - **Verify context-string failsafe** for each surviving accepted atomic edit, against `current.text` (positions are stable for the whole cycle since we apply right-to-left to a single source):
     - `actualBefore = current.text.slice(max(0, range.start - edit.contextBefore.length), range.start)` must equal `edit.contextBefore`
     - `actualAfter = current.text.slice(range.end, range.end + edit.contextAfter.length)` must equal `edit.contextAfter`
     - On either mismatch → drop the whole group, log to `droppedPostApprover[]` with `reason: 'context_mismatch'` and detail showing expected vs actual + offset
     - For `delete` and `replace`: also verify `current.text.slice(range.start, range.end) === oldText`. Same-group on mismatch.
   - Sort surviving accepted atomic edits by `range.start` **descending** (apply right-to-left so earlier positions don't shift).
   - Apply each edit by splicing `current.text` at `range`:
     - `insert`: `text.slice(0, range.start) + newText + text.slice(range.start)` (range.start === range.end for insertions)
     - `delete`: `text.slice(0, range.start) + text.slice(range.end)`
     - `replace`: `text.slice(0, range.start) + newText + text.slice(range.end)`
   - **Runtime invariant assertion (defense in depth)**: at end of function, if `appliedGroups.length === 0`, assert `newText === current.text`. If violated → throw `Error('applier invariant: zero groups applied but text changed')`. Indicates a splice-loop bug.
   - Format-validate final `newText`. If invalid: cycle is no-op, log `format_invalid_after_apply`.
   - Return `{ newText, droppedPostApprover, appliedGroups }`.
- [ ] **2.E.2** Unit tests `applyAcceptedGroups.test.ts` (~250 LOC, ~20 cases): single accepted group with one atomic edit, all rejected (newText === original), all accepted, group-internal coordination (1 group with 3 atomic edits across paragraphs all apply), overlapping accepted groups (later group dropped, earlier applies cleanly), reverse-position-order correctness (multiple edits at known offsets — verify each lands correctly), format-invalid post-apply (no-op cycle), insertion at document start, insertion at document end, delete-then-insert at same position from same group, all-or-nothing within a group preserved by overlap detection, **context-mismatch on contextBefore drop group**, **context-mismatch on contextAfter drop group**, **oldText-mismatch (delete/replace) drop group**, **edit at document start with truncated contextBefore (verify not a false-positive mismatch)**, **edit at document end with truncated contextAfter**.
- [ ] **2.E.3** Build reference reconstruction helper `evolution/src/lib/core/agents/editing/__test_helpers__/referenceReconstruction.ts` (~80 LOC) — for any `(proposedMarkup, decisions)` pair, walks the markup left-to-right and emits text by selecting "before" content for rejected/dropped groups (and unchanged for non-edit text) or "after" content for accepted groups. Implementation is markup-walking, not position-based — independent from the applier's algorithm. Used by property tests + sample-article tests as the source of truth for "what should the output be?". Not exported from the package's public API; lives only under `__test_helpers__/`.
- [ ] **2.E.4** Property test `applyAcceptedGroups.property.test.ts` (~250 LOC, 4 properties via fast-check):
   - **All-rejected idempotency**: for arbitrary `EditGroup[]`, when every decision is `reject`, `newText === current.text`.
   - **All-accepted equivalence**: for arbitrary well-formed `(proposedMarkup, EditGroup[])` with all accepts, applier output equals `referenceReconstruction(proposedMarkup, allAccepts)`.
   - **Mixed decisions equivalence (the strong tripwire)**: for arbitrary inputs and arbitrary mixed accept/reject decisions (no overlapping ranges, no context-failsafe failures), `applyAcceptedGroups(...).newText === referenceReconstruction(proposedMarkup, decisions)`. This catches position-math bugs, splice-direction bugs, group-flatten bugs, and any drift between the markup-based and position-based views.
   - **Length monotonicity**: `newText.length` is between `current.text.length` (all rejected) and a deterministic upper bound derived from accept decisions. Catches over-application + dropped-content bugs.
   Each property runs ≥ 100 fast-check iterations with seeded PRNGs; failing seeds should be persistable in the test file's `fc.assert(..., { seed })` for reproducibility.
- [ ] **2.E.5** Sample-article golden-master tests `applyAcceptedGroups.sampleArticles.test.ts` (~350 LOC, 5 articles × 3 scenarios = 15 cases):
   - Fixtures live in `evolution/src/lib/core/agents/editing/__fixtures__/sample-articles/`, one TypeScript module per article exporting `{ original, proposedMarkup, scenarios: { allAccept, allReject, mixed } }` where each scenario has `{ decisions: ReviewDecision[], expectedNewText: string, expectedDroppedPostApprover?: ... }`.
   - **Article 1 — `galapagos-finches.fixture.ts`** (3 paragraphs, ~200 words, no code blocks; the running example from research § "Sample article (working example)").
   - **Article 2 — `quantum-entanglement.fixture.ts`** (5 H2 sections, ~600 words; tests heading-touch hard rule by including a proposed edit that violates it — proposer markup includes a heading-edit, the validator must drop it before Approver sees it).
   - **Article 3 — `python-decorators.fixture.ts`** (technical, with 2 fenced code blocks; proposer instruction in fixture includes a no-op claim "do not edit code blocks"; verifies the parser doesn't try to edit inside them and the strip-markup pass handles them correctly).
   - **Article 4 — `morning-routine.fixture.ts`** (FAQ-style with bullet lists; tests list-item-boundary hard rule when a proposed edit would span two bullets).
   - **Article 5 — `civil-war-causes.fixture.ts`** (long-form, ~1500 words, 8 H2 sections, citations as `[1]`, `[2]`; soft-rule test: proposer suggests editing a citation; Approver should reject; this exercises the wider position math at scale).
   - Each scenario asserts `applyAcceptedGroups(...).newText === expectedNewText` AND that `appliedGroups`, `droppedPostApprover`, format validation all match the fixture's expectations.
   - Fixtures are hand-authored once (in this PR) so the golden master is intentional. CI never auto-updates them — failures mean either the fixture or the applier needs an explicit human review.

#### 2.F — Integration tests for the full Phase 2 pipeline

- [ ] **2.F.1** Unit tests `IterativeEditingAgent.test.ts` (~500 LOC, ≥30 cases). Use `v2MockLlm` with per-label response queues:
   - **Happy path** — 3 cycles, edits propagate through chain (each cycle's accepted groups apply, next cycle proposes against the new text).
   - **All-rejected stop** — Approver rejects all in cycle 1 → exit with `'all_edits_rejected'`.
   - **No-edits-proposed stop** — Proposer returns clean text → exit.
   - **Parse-failed stop** — markup unparseable → exit (after pre-check drops everything).
   - **Max-cycles stop** — 3 successful cycles, exit normally.
   - **Format-invalid no-op** — Implementer application produces malformed text → no Variant added, cycle continues.
   - **Mixed accept/reject** — Approver accepts 2 groups, rejects 3 → only accepted groups apply.
   - **Pre-Approver drops** — Proposer suggests heading edit → pre-check drops the group, Approver doesn't see it.
   - **Post-Approver drops (overlap)** — two accepted groups have overlapping ranges → later group dropped with `application_conflict`.
   - **Post-Approver drops (context mismatch)** — accepted group's `contextBefore` or `contextAfter` doesn't match `current.text` at the recorded offset → group dropped with `context_mismatch`. Surfaces as a paranoid failsafe; expected near-zero rate in production.
   - **Proposer-drift major drop** — Proposer modifies > 200 chars outside markup → cycle exits with `proposer_drift_major`, no recovery LLM call, no Approver call.
   - **Proposer-drift recovered** — Proposer drifts on smart quotes (≤ 3 regions, < 50 chars total) → recovery LLM classifies all as benign → patches applied → cycle continues normally; `execution_detail.cycles[0].driftRecovery.outcome === 'recovered'`.
   - **Proposer-drift intentional** — Proposer modifies a sentence outside markup → recovery LLM flags `intentional` → cycle exits with `proposer_drift_intentional`.
   - **Proposer-drift unrecoverable residual** — recovery LLM patches some regions but post-patch drift check still fails → cycle exits with `proposer_drift_unrecoverable`.
   - **Drift recovery feature-flag off** — `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` → minor drift treated as major; cycle exits `proposer_drift_major` without LLM call.
   - **Cross-document group** — single `[#N]` spans multiple paragraphs (2 atomic edits with shared number); Approver accepts → both apply.
   - **Group coherence** — Approver rejects a multi-edit group → none of its atomic edits apply.
   - **Cycle cap** — Proposer returns 35 edits → pre-check drops 5+ groups beyond cap.
   - **Group cap** — single group with 7 atomic edits → pre-check drops the whole group.
   - **Hard rule audit** — for each of the 10 hard rules, Proposer suggests a violator → pre-check drops it silently and Approver never sees it.
   - **Soft rule audit** — Proposer ignores a soft rule (e.g., edits a citation), Approver rejects with appropriate reason.
   - **JSONL with extra non-JSON lines** — parser skips, accepts valid lines.
   - **JSONL with missing group decisions** — parser defaults missing groups to reject.
   - **Unknown group numbers in JSONL** — parser ignores.
   - **`BudgetExceededError` during Proposer call** — catches, exits with `'budget_exceeded'`.
   - **`BudgetExceededError` during Approver call** — same.
   - **Cost attribution via `AgentCostScope.getOwnSpent()`** — each cycle's cost shows up correctly.
   - **`execution_detail` shape** — conforms to schema, all sub-arrays populated.
   - **`parentText` / `childText`** — correctly captured per cycle.
   - **`strategy = 'iterative_edit'`** on new variants.
   - **`parentIds` chain** — correctly tracks across cycles.
   - **Pre-Approver dropped log** — every dropped group has a recorded reason.
   - **Post-Approver dropped log** — every dropped accepted group has a recorded reason.
   - **`appliedGroups` count** — matches `acceptedCount - droppedPostApprover.length`.
   - **Parser parses substitution combined form** correctly.
   - **Parser parses paired add/delete with same `[#N]`** correctly.
   - Plus a few more covering markup edge cases.
- [ ] **2.F.2** Sample-article end-to-end tests `IterativeEditingAgent.sampleArticles.test.ts` (~400 LOC, 5 articles × 2 scenarios = 10 cases):
   - Reuses the fixtures from `__fixtures__/sample-articles/` (authored in 2.E.5).
   - For each article, uses `v2MockLlm` with `labelResponses` queued so:
     - `iterative_edit_propose` returns the fixture's `proposedMarkup`
     - `iterative_edit_review` returns JSONL of the fixture's scenario decisions (mixed accept/reject + occasional malformed)
   - Drives `IterativeEditingAgent.execute()` end-to-end against an in-memory pool seeded with the fixture's `original` as the top variant.
   - Asserts: agent returns the expected `stopReason`; the new Variant's `text === scenario.expectedNewText`; `execution_detail.cycles[0]` contains the expected `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `reviewDecisions`, `droppedPostApprover`, `appliedGroups`; cost attribution is non-zero.
   - **Two scenarios per article: "single-cycle accept" (Approver accepts everything that survived pre-check, max=1 cycle) and "multi-cycle chain" (3 cycles where each cycle proposes against the previous cycle's accepted text — fixture provides 3 sets of `proposedMarkup` + decisions, expected output after each cycle).**
   - Same golden-master discipline as 2.E.5: fixtures hand-authored, not auto-generated.

### Phase 3: Pipeline integration + dispatch + agent registry (Week 3)
- [ ] **3.1** `evolution/src/lib/core/agentRegistry.ts` — register `new IterativeEditingAgent()` in lazy-init array.
- [ ] **3.2** Widen `recordSnapshot()` `iterationType` union at `runIterationLoop.ts:83` to include `'iterative_edit'`. Update 4 call sites (lines 307, 622, 705, 728).
- [ ] **3.3** Add new `else if (iterType === 'iterative_edit')` branch in `runIterationLoop.ts` (~150 LOC):
   - Read `editingTopK ?? parallelBatchSize`; slice top-K parents.
   - Parallel batch dispatch via `Promise.allSettled`.
   - Top-up loop (gated by `EVOLUTION_TOPUP_ENABLED`).
   - Single `MergeRatingsAgent.run({ iterationType: 'generate', ... })` over combined buffers.
   - `recordSnapshot(iterIdx, 'iterative_edit', 'start'/'end', ...)`.
- [ ] **3.4** `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — add `iterative_edit` case using `estimateIterativeEditingCost()`.
- [ ] **3.5** `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:35–53` — extend `labelStrategyConfig()` to count editing iterations: `"N×gen + M×edit + K×swiss"`.
- [ ] **3.6** Feature flag `EDITING_AGENTS_ENABLED` (default `'true'`); orchestrator skips dispatch when set to `'false'` for emergency rollback. Document in `evolution/docs/reference.md` Kill Switches table.
- [ ] **3.7** Integration test `evolution/src/__tests__/integration/iterative-editing-agent.integration.test.ts` (real DB):
   - Seed strategy with one `iterative_edit` iteration after 1 generate iteration.
   - Run `evolveArticle()` end-to-end.
   - Assert: `evolution_agent_invocations` row written with `agent_name='iterativeEditingAgent'`; `execution_detail` validates against schema; `evolution_arena_comparisons` row written for each accepted edit; `evolution_variants` row created for accepted variant; `iterative_edit_cost` metric > 0.
- [ ] **3.8** Sample-article integration test `evolution/src/__tests__/integration/iterative-editing-sample-articles.integration.test.ts` (real DB, ~250 LOC):
   - Reuses 2 of the 5 fixture articles from `__fixtures__/sample-articles/` (Galápagos finches + quantum entanglement — short + medium structurally varied).
   - Seeds the seed variant with the fixture's `original` text.
   - Mocks `rawProvider.complete` to return fixture markup + JSONL decisions.
   - Runs the full `evolveArticle()` pipeline through one `iterative_edit` iteration.
   - Asserts: persisted `evolution_variants.variant_content` equals `scenario.expectedNewText`; persisted `execution_detail` JSONB matches the expected shape per fixture; `evolution_arena_comparisons` count and structure match expectations; cost attribution split correctly between `iterative_edit_propose` and `iterative_edit_review` agent labels.
   - This is the only integration test that runs the real DB writes against realistic-content fixtures (the full E2E spec in Phase 6 covers UI rendering separately).

### Phase 4: Invocation-detail UI — `'text-diff'` + `'annotated-edits'` field types (Week 4 part 1)
- [ ] **4.1** `evolution/src/lib/core/types.ts:187–194` — extend `DetailFieldDef` `type` union with two new values: `'text-diff'` (uses `sourceKey?`, `targetKey?`, `previewLength?`) and `'annotated-edits'` (uses `markupKey?`, `groupsKey?`, `decisionsKey?`, `dropsPreKey?`, `dropsPostKey?` to point at the `execution_detail.cycles[i]` sub-fields).
- [ ] **4.2** `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` — add `case 'text-diff'` (~10 LOC) rendering `<TextDiff original={data[field.sourceKey]} modified={data[field.targetKey]} previewLength={field.previewLength ?? 300} />`.
- [ ] **4.3** Replace orphaned `'iterativeEditing'` entry in `evolution/src/lib/core/detailViewConfigs.ts` with a fresh `'iterativeEditingAgent'` entry. Includes new `'text-diff'` field reading `parentText` / `childText` from execution_detail, plus all the new audit fields (`proposedMarkup`, `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `reviewDecisions`, `droppedPostApprover`, `appliedGroups`, `driftRecovery`).
- [ ] **4.4** `evolution/src/services/invocationActions.ts:156–221` — extend `getInvocationVariantContextAction` to include `variant_content` for both variant and parent (~8 LOC). Add `variant_content` and `parent_content` to `InvocationVariantContext` interface.
- [ ] **4.5** `evolution/src/components/evolution/tabs/InvocationParentBlock.tsx` — render `<TextDiff>` in collapsible `<details>` section below the delta CI row (~15 LOC).
- [ ] **4.6** `evolution/src/components/evolution/tabs/TimelineTab.tsx:29–35` — extend `agentKind()` and `KIND_CONFIG` with `'edit'` case (cosmetic badge color).
- [ ] **4.7** `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:418–421` — add `else if (name.includes('edit'))` case to per-iteration agent-type inference.
- [ ] **4.8** Build `evolution/src/components/evolution/editing/AnnotatedProposals.tsx` (~200 LOC) — the unified annotated-edits view that renders `proposedMarkup` with each `[#N]` block visually styled by its decision (accepted = solid green, rejected = red strikethrough, malformed pre-approver = striped yellow, blocked post-approver = striped orange).
   - Inputs: `proposedMarkup`, `proposedGroupsRaw`, `reviewDecisions`, `droppedPreApprover`, `droppedPostApprover` (all from `execution_detail.cycles[i]`).
   - Algorithm: walk `proposedMarkup` left-to-right; for each atomic edit's `markupRange`, look up its group's outcome and render the corresponding decorated span. Plain text outside edit ranges renders unchanged.
   - **Toolbar**: three view modes — `Annotated` (default), `Final variant` (only accepted edits applied; equivalent to TextDiff "After" tab), `Original` (no markup; equivalent to `current.text`).
   - **Hover tooltip** per `[#N]`: shows decision, reason, group members (if multi-edit group: *"#5: accepted (1 of 2 atomic edits in this group; the other is in §3)"*), and a click action that scrolls + highlights the corresponding row in the Decisions table.
   - **Legend** at the top, collapsible.
   - **Grouped-edit visual link**: edits sharing `[#N]` get a matching number badge. Clicking any one highlights all members of the group.
   - Read-only, stateless given props. Pure UI — no server-side data changes needed.
- [ ] **4.9** Wire `AnnotatedProposals` into `evolution/src/lib/core/detailViewConfigs.ts` `iterativeEditingAgent` entry: add an `'annotated-edits'` field as the FIRST sub-field of each cycle (default-expanded), pointing at the relevant `execution_detail.cycles[i]` sub-keys. Demote the raw "Proposed markup" code-block field to collapsed-by-default — still available for character-level inspection but no longer the primary surface.
- [ ] **4.10** Extend `ConfigDrivenDetailRenderer.tsx` with `case 'annotated-edits'` (~15 LOC) that resolves the field's key references and passes them to `<AnnotatedProposals>`.
- [ ] **4.11** Unit tests `AnnotatedProposals.test.ts` (~250 LOC, ~15 cases): all 4 decision states render with correct styles; grouped-edit linking across paragraphs; hover tooltip content; click-to-table-row scroll behavior; toolbar mode switching (Annotated/Final/Original); empty/zero-edit input renders as plain text; legend toggling; multi-cycle isolation (one cycle's annotations don't affect another).

### Phase 5: Strategy wizard UI (Week 4 part 2)
- [ ] **5.1** `src/app/admin/evolution/strategies/new/page.tsx`:
   - Lines 34–46, 73–79: extend `IterationRow['agentType']` and `IterationConfigPayload['agentType']` unions with `'iterativeEditingAgent'`.
   - Lines 814–823: add `<option value="iterativeEditingAgent">Iterative Editing</option>`.
   - Lines 947–962: add third color branch for editing in budget-allocation bar + legend.
   - Lines 360–390: validation rules — first iteration must still be `generate`; allow `editing` after generate. Add helper text explaining editing iteration drafts top-K parents.
- [ ] **5.2** `evolution/src/components/evolution/DispatchPlanView.tsx:117–119` — add badge color for `'iterative_edit'`.
- [ ] **5.3** `evolution/src/services/strategyPreviewActions.ts:159–185` — extend `dispatchPreviewInputSchema` to accept `'iterativeEditingAgent'`.
- [ ] **5.4** `evolution/src/services/strategyRegistryActions.ts` — `iterationConfigSchema` shared with main schemas.ts (line 32–51 reads from there); should auto-update from Phase 1.1.
- [ ] **5.5** Add optional `editingTopK?: number` field to `iterationConfigSchema` in `evolution/src/lib/schemas.ts`. Surface in wizard as a number input visible only when `agentType === 'iterativeEditingAgent'`.

### Phase 6: E2E + documentation + finalization (Week 4 part 3)
- [ ] **6.1** E2E spec `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`:
   - Seed strategy via service-role with 1×generate + 1×editing iteration; budget $0.05.
   - Trigger via `/api/evolution/run` (mock LLM via `nock` to avoid flakiness).
   - Poll DB until run status = 'completed'.
   - Navigate to run detail → Variants tab → assert editing variants appear with `parent_variant_id` chain.
   - Navigate to invocation detail for the editing invocation → assert `cycles[]` table renders + `<TextDiff>` visible with both `parent_content` and `variant_content`.
- [ ] **6.2** Create `docs/feature_deep_dives/editing_agents.md` covering IterativeEditingAgent (overview, evaluate→edit→judge loop, key files, config reference, interaction with cost tracking, future v1.1/v1.2 roadmap).
- [ ] **6.3** Update `evolution/docs/agents/overview.md` — document IterativeEditingAgent.
- [ ] **6.4** Update `evolution/docs/architecture.md` — new dispatch branch in `evolveArticle()`, new `iterationType` value in snapshots.
- [ ] **6.5** Update `evolution/docs/reference.md` — add file index entries; add `EDITING_AGENTS_ENABLED` to Kill Switches table.
- [ ] **6.6** Update `docs/feature_deep_dives/multi_iteration_strategies.md` — new agentType value + `editingTopK` field.
- [ ] **6.7** Update `docs/feature_deep_dives/evolution_metrics.md` — new run-level + propagated cost metrics.
- [ ] **6.8** Update `.claude/doc-mapping.json` to include new editing_agents.md.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — ≥30 cases (orchestration loop, all stop reasons, audit trail)
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.sampleArticles.test.ts` — 5 articles × 2 scenarios (single-cycle, multi-cycle chain)
- [ ] `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` — soft-rules verification, syntax-form coverage
- [ ] `evolution/src/lib/core/agents/editing/parseProposedEdits.test.ts` — ≥32 cases (all markup forms, adversarial inputs, position math, context capture)
- [ ] `evolution/src/lib/core/agents/editing/parseProposedEdits.property.test.ts` — fast-check round-trip + range-correctness invariants
- [ ] `evolution/src/lib/core/agents/editing/checkProposerDrift.test.ts` — ~10 cases (whitespace tolerance, drift detection, offset reporting)
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — ~20 cases (10 hard rules + cycle/group caps)
- [ ] `evolution/src/lib/core/agents/editing/approverPrompt.test.ts` — system-prompt content, edit summary table format
- [ ] `evolution/src/lib/core/agents/editing/parseReviewDecisions.test.ts` — ~12 cases (JSONL parse, missing-default-reject, unknown-group-ignored)
- [ ] `evolution/src/lib/core/agents/editing/recoverDrift.test.ts` — ~18 cases (magnitude classifier boundaries, recovery LLM mocked outcomes, patcher correctness, feature-flag, residual-drift detection)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.test.ts` — ~20 cases (overlap detection, context failsafe, splice direction, format validation)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.property.test.ts` — 4 properties (all-rejected idempotency, all-accepted equivalence, mixed-decision equivalence vs reference reconstruction, length monotonicity)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.sampleArticles.test.ts` — 5 articles × 3 scenarios (allAccept, allReject, mixed)
- [ ] `evolution/src/components/evolution/editing/AnnotatedProposals.test.ts` — ~15 cases (4 decision-state renderings, grouped-edit linking, toolbar modes, tooltip behavior, edge cases)

### Integration Tests
- [ ] `evolution/src/__tests__/integration/iterative-editing-agent.integration.test.ts` — full pipeline run with editing iteration (real DB)
- [ ] `evolution/src/__tests__/integration/iterative-editing-sample-articles.integration.test.ts` — 2 of 5 fixture articles, full pipeline end-to-end with mocked LLMs against real DB

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — wizard → run → invocation detail → TextDiff visible

### Manual Verification
- [ ] `npx tsx evolution/scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock` with strategy including 1 editing iteration; spot-check invocation detail UI.
- [ ] Cost calibration verified — run produces realistic `iterative_edit_cost` metric.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] E2E spec runs against local server via `ensure-server.sh`; passes consistently.
- [ ] Manual smoke test: strategy wizard renders `editing` option; conditional `editingTopK` input appears.

### B) Automated Tests
- [ ] `cd evolution && npx vitest run src/lib/core/agents/editing` — all unit + property tests pass.
- [ ] `cd evolution && npx vitest run src/__tests__/integration/iterative-editing-agent` — integration passes.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — passes.
- [ ] Full test suite (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`) — no regressions.

## Documentation Updates
- [ ] NEW: `docs/feature_deep_dives/editing_agents.md` — consolidated guide.
- [ ] `evolution/docs/agents/overview.md` — IterativeEditingAgent section.
- [ ] `evolution/docs/architecture.md` — dispatch branch + recordSnapshot changes.
- [ ] `evolution/docs/reference.md` — file index + kill switch.
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — `iterativeEditingAgent` agentType + `editingTopK` field.
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — `iterative_edit_cost` family.
- [ ] `.claude/doc-mapping.json` — register new deep dive.

## Risk Register (top items, full register in research doc)

| Risk | Mitigation |
|------|------------|
| `recordSnapshot()` enum break (P1) | Phase 3.2 widens union and updates all 4 call sites with type-checking. |
| Cost calibration phase enum migration (C2) | Phase 1.5 + 1.6 ship together; pre-deploy validation. |
| Cost under-estimation for new agent (C1) | Default `maxCycles=2` in v1; require `≥40%` iteration budget for `maxCycles=3`; calibrate on 50 shadow-deploy runs before opening flag in prod. |
| Orphaned schema drift (S1, T1) | Phase 1.8 fixture-validation test runs at bootstrap. |
| Backward compat with active strategies (PR1) | All existing strategies use `'generate' \| 'swiss'` agentTypes; widening enum is non-breaking. Migration test deserializes legacy configs. |
| Critique amplification (B1) | Add critique-quality validation in Phase 2.6; log rejected cycles for staging analysis. |
| Feature-flag rollback path (PR3) | Phase 3.6 adds `EDITING_AGENTS_ENABLED`; E2E test verifies flag-off path. |

## V1.1 / V1.2 Roadmap (Explicitly Out of Scope)

- **v1.1:** `OutlineGenerationAgent` (generate-mode only); MDAST CriticMarkup judge format; per-cycle invocation timeline UI; `Match.frictionSpots` production + consumption.
- **v1.2:** `OutlineGenerationAgent` edit-mode (selective re-expand); step-targeted mutation (re-edit only the weakest step); `SectionDecompositionAgent` + section-helper suite.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
