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
5. **Naming:** Discriminator `'iterativeEditing'` internally (matches the schema namespace and InvocationEntity dropdown — both already in tree); expose `agentType: 'editing'` in `iterationConfigs` and the wizard UI; map `'editing' → 'iterativeEditing'` in orchestrator (~16 LOC).
6. **Parent selection:** Top-K via optional `editingTopK` field on `IterationConfig` (default = iteration's parallel dispatch count from `projectDispatchPlan`).
7. **`MergeRatingsAgent` compat:** Pass editing match buffers with `iterationType: 'generate'` (semantically identical to generate's local-rank output). No `MergeRatingsAgent` changes.
8. **Schema:** The orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) was V1-rubric-shaped and **does not fit the new design**. We author a fresh schema (see research doc); the orphaned one is deleted in Phase 1.
9. **`Match.frictionSpots`:** Out of scope (dead code on both ends).
10. **Per-cycle invocation timeline UI:** Out of scope for v1. Cycles in `execution_detail`; visual timeline → v1.1.

## Phased Execution Plan

### Phase 1: Scaffolding — enum + schema + registry + cost-calibration migration (Week 1)
- [ ] **1.1** `evolution/src/lib/schemas.ts:388` — extend `iterationAgentTypeEnum` with `'editing'`. Update 4 refines on `iterationConfigSchema` (lines 413–425) to allow editing iterations (forbid as first iteration).
- [ ] **1.2** `evolution/src/lib/core/agentNames.ts` — add `'iterativeEditing'` to `AGENT_NAMES`; add `iterativeEditing → 'iterative_edit_cost'` to `COST_METRIC_BY_AGENT`.
- [ ] **1.3** `evolution/src/lib/metrics/types.ts` — add `'iterative_edit_cost'`, `'total_iterative_edit_cost'`, `'avg_iterative_edit_cost_per_run'` to `STATIC_METRIC_NAMES`.
- [ ] **1.4** `evolution/src/lib/core/metricCatalog.ts` + `evolution/src/lib/metrics/registry.ts` — add 1 during-execution def + 2 propagation defs (mirror `generation_cost` pattern).
- [ ] **1.5** New migration `supabase/migrations/<timestamp>_evolution_cost_calibration_editing_phase.sql` — extend `evolution_cost_calibration.phase` CHECK to accept `'iterative_edit_propose'` and `'iterative_edit_review'` (two phases: propose and review have different cost shapes).
- [ ] **1.6** `evolution/scripts/refreshCostCalibration.ts` — add the two new phases to the `Phase` literal type and `asPhase()` mapping.
- [ ] **1.7** `evolution/src/lib/pipeline/infra/estimateCosts.ts` — add `__builtin_iterative_edit_propose__: 7500` (article-with-markup is ~1.4× input) and `__builtin_iterative_edit_review__: 500` (one JSON line per edit) to `EMPIRICAL_OUTPUT_CHARS`. Add `estimateIterativeEditingCost(seedChars, generationModel, maxCycles)` returning `{ expected, upperBound }` — accounts for 2 calls/cycle.
- [ ] **1.8** **Replace** orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) — V1-rubric-shaped, doesn't fit the new design. Author a fresh schema with `cycles[]` containing `{cycleNumber, proposedMarkup, proposedEdits[], reviewedEdits[], acceptedCount, rejectedCount, formatValid, newVariantId?, parentText, childText?}` (full shape in research doc). Replace `executionDetailFixtures.iterativeEditingDetailFixture` to match. Update `agentExecutionDetailSchema` discriminated union slot.
- [ ] **1.9** Cleanup: delete ghost `mutate_clarity` / `crossover` / `mutate_engagement` from `TACTIC_PALETTE` (`tactics/index.ts:94–96`); delete unused `evolution/src/lib/legacy-schemas.ts`; fix `low_sigma_opponents_count` → `low_uncertainty_opponents_count` mismatch at `schemas.ts:819` vs `detailViewConfigs.ts:166`.

### Phase 2: Proposer + Implementer + Approver components + unit tests (Week 2)

> **Three-role architecture** (research doc § "How IterativeEditingAgent Works"). Two LLM calls per cycle (Proposer, Approver) and one deterministic safety layer (Implementer) that runs twice per cycle: a pre-Approver pre-check that filters hard-rule violators, and a post-Approver application step that handles anchor failures and format validation.

#### 2.A — IterativeEditingAgent class (orchestration)

- [ ] **2.A.1** Create `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` (~250 LOC). Extend `Agent<IterativeEditInput, IterativeEditOutput, IterativeEditingExecutionDetail>`. Set `usesLLM = true`, `name = 'iterativeEditing'`.
- [ ] **2.A.2** Per-invocation `EvolutionLLMClient` via `Agent.run()` template. `AgentCostScope.getOwnSpent()` for cost attribution.
- [ ] **2.A.3** Implement main `execute()` loop (~100 LOC) — for each cycle 1..maxCycles:
   1. **Proposer call**: send `current.text` + soft-rules system prompt → `proposedMarkup`
   2. **Implementer pre-check**: parse, group, validate hard rules, cap → `{ approverGroups, droppedPreApprover[] }`. If `approverGroups.length === 0` → exit with `stopReason: 'no_edits_proposed'` or `'parse_failed'`
   3. **Approver call**: send `proposedMarkup` + group summary → JSONL
   4. **Parse Approver output** → `reviewDecisions[]` (missing decisions default to `reject`)
   5. **Implementer application**: apply accepted groups in number order with anchor matching → `{ newText, droppedPostApprover[], appliedGroups[] }`. Format-validate `newText`
   6. If `newText !== current.text` and format-valid: create new `Variant`, add to pool, `current = newVariant`
   7. If `appliedCount === 0`: exit with `stopReason: 'all_edits_rejected'`
- [ ] **2.A.4** Emit rich `execution_detail.cycles[]` per cycle (full shape per research doc § "execution_detail shape"). Each cycle entry has `proposedMarkup` + `proposedGroupsRaw` + `droppedPreApprover[]` + `approverGroups[]` + `reviewDecisions[]` + `droppedPostApprover[]` + `appliedGroups[]` + `parentText` + `childText`.

#### 2.B — Proposer (LLM call #1)

- [ ] **2.B.1** Build `evolution/src/lib/core/agents/editing/proposerPrompt.ts` (~80 LOC):
   - System prompt embeds **all soft rules** (preserve quotes, citations, URLs; no new headings; one-sentence edits preferred; no edits in code blocks; preserve voice and tone).
   - Inline syntax docs (3 markup forms with examples).
   - Output-format instruction: full article with inline numbered edits, no commentary.
   - Use AgentName label `iterative_edit_propose`.
- [ ] **2.B.2** Unit tests `proposerPrompt.test.ts` (~80 LOC, ~6 cases) — assert all soft rules present in rendered prompt; assert syntax examples include all 3 forms; assert AgentName label routes to correct cost metric.

#### 2.C — Implementer pre-check (deterministic, parser + validator)

- [ ] **2.C.1** Build `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` (~200 LOC):
   - Regex extraction for `{++ [#N] ... ++}`, `{-- [#N] ... --}`, `{~~ [#N] ... ~> ... ~~}`.
   - Group atomic edits by `[#N]` into `EditGroup[]`.
   - Adjacent same-`[#N]` add+delete merged into one `replace` edit.
   - Compute `anchor` (30 chars surrounding context) and `location: {line, column}` for each atomic edit.
   - Adversarial handling: unbalanced tags → drop the unbalanced atomic edit silently; nested tags → drop silently; missing `[#N]` → auto-assign sequential; combined-form `~~` substitution where content contains `~>` → drop silently (use paired form instead); duplicate non-paired numbers → keep first, drop rest.
   - Return `{ groups: EditGroup[], dropped: Array<{ reason, detail }> }`.
- [ ] **2.C.2** Build `evolution/src/lib/core/agents/editing/validateEditGroups.ts` (~150 LOC):
   - Hard-rule checks (per atomic edit): length cap 500, no `\n\n` in `oldText`, no heading line touch, no heading line in `newText`, no code fence in `oldText`/`newText`, no list-item-boundary span, no horizontal-rule line.
   - **Group-level enforcement: any atomic edit in a group fails any hard rule → drop the whole group**.
   - Cap enforcement: total atomic edits ≤ 30 (drop excess groups in number order); each group ≤ 5 atomic edits (drop wholesale).
   - Return `{ approverGroups: EditGroup[], droppedPreApprover: Array<{ groupNumber, reason, detail }> }`.
- [ ] **2.C.3** Unit tests `parseProposedEdits.test.ts` (~300 LOC, ~25 cases): well-formed input (all 3 forms), grouped edits sharing `[#N]` (cross-document), unbalanced tags (silently dropped), nested tags (silently dropped), missing numbers (auto-assigned), duplicate non-paired numbers (first kept), combined `~~` form with `~>` in content (silently dropped), paired add/delete merged correctly, anchor extraction at document start/end, Unicode in edit content, multiple groups in one paragraph.
- [ ] **2.C.4** Unit tests `validateEditGroups.test.ts` (~250 LOC, ~20 cases): each hard rule (10), group-level coherence (single bad atomic → whole group dropped), cycle cap (30+ edits), group cap (6+ edits), edge cases (heading at very start of document, code fence at very end, etc.).
- [ ] **2.C.5** Property-based test `parseProposedEdits.property.test.ts` — fast-check generators: parse → reconstruct → parse-again idempotency on well-formed inputs; arbitrary text never crashes parser; arbitrary `[#N]` numbers don't break grouping.

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

#### 2.E — Implementer application (deterministic, anchor matcher + applier)

- [ ] **2.E.1** Build `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` (~200 LOC):
   - Filter `approverGroups` to those with `decision === 'accept'`.
   - Sort by `groupNumber`.
   - For each accepted group: locate each atomic edit's `anchor` in current working text:
     - **Unique match** → apply
     - **Multiple matches (anchor ambiguous)** → drop whole group, log to `droppedPostApprover[]` with `reason: 'anchor_ambiguous'`
     - **No match (anchor not found, e.g., earlier edit changed it)** → drop whole group, log with `reason: 'anchor_not_found'`
   - Apply atomic edits in document order within each group; all-or-nothing per group.
   - On group-internal application failure (e.g., deletion-target text changed by an earlier edit): drop whole group, log `application_conflict`.
   - Format-validate final `newText`. If invalid: cycle is no-op, log `format_invalid_after_apply`.
   - Return `{ newText, droppedPostApprover, appliedGroups }`.
- [ ] **2.E.2** Unit tests `applyAcceptedGroups.test.ts` (~250 LOC, ~18 cases): single accepted group with one atomic edit, all rejected (newText === original), all accepted, group-internal coordination (1 group with 3 atomic edits across paragraphs), anchor unique match, anchor not found (drop group), anchor ambiguous (drop group), overlapping accepted groups (later one's anchor displaced → drop), format-invalid post-apply (no-op cycle), all-or-nothing semantics (1 atomic edit fails in 3-edit group → whole group dropped).

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
   - **Post-Approver drops** — Approver accepts a group whose anchor moved during earlier-applied edit → Implementer drops it.
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
   - Assert: `evolution_agent_invocations` row written with `agent_name='iterativeEditing'`; `execution_detail` validates against schema; `evolution_arena_comparisons` row written for each accepted edit; `evolution_variants` row created for accepted variant; `iterative_edit_cost` metric > 0.

### Phase 4: Invocation-detail UI — `'text-diff'` field type + `<TextDiff>` rendering (Week 4 part 1)
- [ ] **4.1** `evolution/src/lib/core/types.ts:187–194` — extend `DetailFieldDef` with `type: ... | 'text-diff'`, optional `sourceKey?`, `targetKey?`, `previewLength?`.
- [ ] **4.2** `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` — add `case 'text-diff'` (~10 LOC) rendering `<TextDiff original={data[field.sourceKey]} modified={data[field.targetKey]} previewLength={field.previewLength ?? 300} />`.
- [ ] **4.3** Extend `evolution/src/lib/core/detailViewConfigs.ts` `iterativeEditing` entry with new `'text-diff'` field reading `parentText` / `childText` from execution_detail. Also extend with config display + target dimension/description + initialCritique vs finalCritique comparison fields.
- [ ] **4.4** `evolution/src/services/invocationActions.ts:156–221` — extend `getInvocationVariantContextAction` to include `variant_content` for both variant and parent (~8 LOC). Add `variant_content` and `parent_content` to `InvocationVariantContext` interface.
- [ ] **4.5** `evolution/src/components/evolution/tabs/InvocationParentBlock.tsx` — render `<TextDiff>` in collapsible `<details>` section below the delta CI row (~15 LOC).
- [ ] **4.6** `evolution/src/components/evolution/tabs/TimelineTab.tsx:29–35` — extend `agentKind()` and `KIND_CONFIG` with `'edit'` case (cosmetic badge color).
- [ ] **4.7** `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:418–421` — add `else if (name.includes('edit'))` case to per-iteration agent-type inference.

### Phase 5: Strategy wizard UI (Week 4 part 2)
- [ ] **5.1** `src/app/admin/evolution/strategies/new/page.tsx`:
   - Lines 34–46, 73–79: extend `IterationRow['agentType']` and `IterationConfigPayload['agentType']` unions with `'editing'`.
   - Lines 814–823: add `<option value="editing">Editing</option>`.
   - Lines 947–962: add third color branch for editing in budget-allocation bar + legend.
   - Lines 360–390: validation rules — first iteration must still be `generate`; allow `editing` after generate. Add helper text explaining editing iteration drafts top-K parents.
- [ ] **5.2** `evolution/src/components/evolution/DispatchPlanView.tsx:117–119` — add badge color for `'iterative_edit'`.
- [ ] **5.3** `evolution/src/services/strategyPreviewActions.ts:159–185` — extend `dispatchPreviewInputSchema` to accept `'editing'`.
- [ ] **5.4** `evolution/src/services/strategyRegistryActions.ts` — `iterationConfigSchema` shared with main schemas.ts (line 32–51 reads from there); should auto-update from Phase 1.1.
- [ ] **5.5** Add optional `editingTopK?: number` field to `iterationConfigSchema` in `evolution/src/lib/schemas.ts`. Surface in wizard as a number input visible only when `agentType === 'editing'`.

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
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — ≥21 cases (port all V1 cases + new V2 ones)
- [ ] `evolution/src/lib/core/agents/editing/diffComparison.test.ts` — 8-combo direction-reversal truth table + edge cases
- [ ] `evolution/src/lib/core/agents/editing/diffComparison.property.test.ts` — word-diff idempotency + reversal symmetry

### Integration Tests
- [ ] `evolution/src/__tests__/integration/iterative-editing-agent.integration.test.ts` — full pipeline run with editing iteration

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
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — `editing` agentType + `editingTopK` field.
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
