# Rebuild Coherence Pass Agent Mode A/B Configurable Plan

## Background
Direct follow-up to `investigate_paragraph_recombine_coherence_pass_performance_20260623` ([PR #1282](https://github.com/Minddojo/explainanything/pull/1282)) and the deep-dive analysis at `docs/analysis/coherence-pass-perf-ab-results-20260624/` (lives on PR #1286 — not yet merged into main; this project's branch will incorporate it after #1286 ships, or via rebase). The shipped multi-cycle + raised-length-cap + voice-restoration changes are functionally correct but never get exercised because the proposer LLM (`gemini-2.5-flash-lite`) emits clean rewritten articles (Mode B-shaped) instead of inline CriticMarkup (Mode A-shaped) in 8 of 15 invocations. The remaining 7 produce sparse markup the approver rejects. Only 1 of 15 invocations actually applied edits.

The pattern is fixable: the IterativeEditingRewriteAgent already uses Mode B successfully — `splitRationaleAndRewrite` + `computeMarkupFromRewrite` derive CriticMarkup from clean rewrites via diff. Port that capability to the coherence-pass agent and make the editing mode configurable via strategy.

## Requirements (from GH Issue #1288)
1. Add `coherencePassEditingMode: 'mode_a' | 'mode_b'` iter-config field, default `'mode_b'`.
2. Pass `rewriteMode: { coalesceAndCap: false }` to `runEditingCycle` when Mode B selected. **NOTE**: original spec said `coalesceAndCap: true, capLimit: 10`. Updated based on `/research` finding that PR #1283 (merged 2026-06-24) changed the IterativeEditingAgent convention to `coalesceAndCap: false` for max approver granularity — every diff atomic becomes its own approver decision. See research doc § Key Findings #1.
3. Author Mode B proposer prompt with voice-restoration scope (clone `proposerPromptRewrite.ts` template).
4. Wizard input dropdown for the mode.
5. Unit + boundary tests for all modes + default resolution.
6. Doc updates (paragraph_recombine_with_coherence_pass.md, multi_iteration_strategies.md, reference.md).
7. After ship, A/B via `manual_run_experiment` skill (Mode B vs Mode A, 8 runs/arm, federal_reserve_2). Validate Mode B applies edits in >50% of invocations. Trigger `/analysis`.

## Problem
`ParagraphRecombineWithCoherencePassAgent` uses Mode A (inline CriticMarkup) exclusively — `runEditingCycle` is called without `rewriteMode`, so `parseProposedEdits` expects CriticMarkup. The proposer LLM struggles to produce CriticMarkup for the multi-paragraph voice-restoration task: it instead writes clean rewritten articles in 53% of invocations. `parseProposedEdits` finds zero edit groups; `runEditingCycle` returns `stopReason: 'no_edits_proposed'`; the coherence pass becomes a no-op. The sibling A/B (above) confirmed only 6.7% (1/15) of invocations actually apply edits.

## Options Considered
- [x] **Option A: Strategy-configurable mode (CHOSEN)**. Add `coherencePassEditingMode` iter-config field, default Mode B. Re-runs the post-#1282 A/B with one arm pinned to Mode A and one to Mode B (or default = Mode B vs explicit Mode A). Validates the fix without committing to it irreversibly. Mode A remains available for strategies that want it.
- [x] **Option B: Hard-switch to Mode B**. Drop Mode A entirely from the coherence-pass agent. Simpler code but loses the configuration knob; can't run A/B comparisons of A vs B; harder to roll back if Mode B has edge-case issues we haven't seen yet.
- [x] **Option C: Switch proposer model instead of editing mode**. Use a stronger proposer model (e.g. `gpt-4.1-nano` or `gemini-2.5-flash` non-lite) that CAN produce CriticMarkup reliably. Doesn't solve the underlying mode mismatch and is more expensive; the small-model-friendly Mode B is the right architectural fix.

## Phased Execution Plan

### Phase 0: Remove the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` kill switch

Per user direction (2026-06-25), the kill switch added in PR #1282 is removed entirely. The rationale: the new defaults are the right defaults; an env-var-driven rollback is overhead we don't need. Per-strategy overrides (already supported) cover the "I need legacy behavior for an A/B" case. Global rollback, if ever required, is a code-revert of the original PR — same path as any other shipped behavior change.

- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts`
  - [x] Delete `resolveCoherencePassDefaults()` helper function entirely.
  - [x] Delete `LEGACY_COHERENCE_PASS_LENGTH_CAP_RATIO` (1.02) and `LEGACY_COHERENCE_PASS_MAX_CYCLES` (1) constants.
  - [x] Replace every call site of `resolveCoherencePassDefaults()` with direct references to `DEFAULT_COHERENCE_PASS_LENGTH_CAP_RATIO` (1.10) and `DEFAULT_COHERENCE_PASS_MAX_CYCLES` (2). The `?? DEFAULT_*` pattern in `execute()` becomes simpler.
- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [x] Delete the test that toggled `process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` and asserted the resolved defaults flipped.
  - [x] Delete the env-restore beforeEach/afterEach hygiene block if it was only used by that test.
- [x] `evolution/docs/reference.md`
  - [x] Delete the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` row from the env-var table.
- [x] `evolution/docs/paragraph_recombine_with_coherence_pass.md`
  - [x] Delete the "Kill switch" paragraph from the Configuration Knobs section (added in PR #1282).
- [x] **`evolution/docs/agents/overview.md:606`** (per Arch reviewer #1 in iter1) — delete the kill-switch line from the coherence-pass implementation block.
- [x] **`src/app/admin/evolution/strategies/new/page.tsx:138-139`** (per Arch reviewer #2 + Sec reviewer in iter1) — the `COHERENCE_PASS_DEFAULTS` comment block references `resolveCoherencePassDefaults()` + `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2`. Strip the kill-switch language from the comment.
- [x] **`evolution/src/lib/schemas.ts:2753`** (per Arch reviewer #3 + Sec reviewer in iter1) — the `coherencePass.skipped` enum still contains `'kill_switch'`. Drop that literal from the union. Verify no `execution_detail` row has historically emitted `skipped: 'kill_switch'` (no code path ever did — the enum was added speculatively in PR #1282).
- [x] Cross-check (extended scope): `grep -rn "EVOLUTION_COHERENCE_PASS_DEFAULTS_V2\|resolveCoherencePassDefaults\|LEGACY_COHERENCE_PASS\|kill_switch" --include='*.ts' --include='*.tsx' --include='*.md'` must return zero hits outside this project's planning/research docs.

### Phase 1: Schema + iter-config field
- [x] `evolution/src/lib/schemas.ts`
  - [x] Add `coherencePassEditingMode: z.enum(['mode_a', 'mode_b']).optional()` to the iter-config zod schema (next to existing `coherencePassLengthCapRatio` / `coherencePassMaxCycles`).
  - [x] Add `.refine()` rejecting on agent types other than `paragraph_recombine_with_coherence_pass`.
- [x] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`
  - [x] Add `coherencePassEditingMode` to FIELD_GATES (agentType-gated, emit-when-set).
  - [x] No `normalizeIteration` default — preserve existing strategies' `config_hash`. Agent resolves default.
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [x] Thread `iterCfg.coherencePassEditingMode` into the agent input (both parallel + sequential dispatch call sites).

### Phase 2: Agent — accept new input field + Mode B branch
- [x] `ParagraphRecombineWithCoherencePassAgent.ts`
  - [x] Add `coherencePassEditingMode?: 'mode_a' | 'mode_b'` to `ParagraphRecombineWithCoherencePassInput`.
  - [x] Add `DEFAULT_COHERENCE_PASS_EDITING_MODE = 'mode_b' as const` constant next to the other `DEFAULT_COHERENCE_PASS_*` constants.
  - [x] No `resolveCoherencePassDefaults()` helper — Phase 0 deleted it. The `editingMode` default is just a direct constant `DEFAULT_COHERENCE_PASS_EDITING_MODE = 'mode_b' as const`, resolved via `const effectiveEditingMode = input.coherencePassEditingMode ?? DEFAULT_COHERENCE_PASS_EDITING_MODE`. Strategies that need Mode A (e.g. for A/B experiments) must pin `coherencePassEditingMode: 'mode_a'` explicitly in iter-config — that path is unchanged.
  - [x] In `execute()`'s coherence-pass block, resolve `effectiveEditingMode = input.coherencePassEditingMode ?? DEFAULT_COHERENCE_PASS_EDITING_MODE`. (Mirror the `?? DEFAULT_*` pattern for `effectiveLengthCapRatio` and `maxCycles` after the Phase 0 simplification.)
  - [x] Branch on `effectiveEditingMode`:
    - **Mode A** (current behavior): call `runEditingCycle` WITHOUT `rewriteMode`. No coalesce/cap. Use `buildCoherencePassProposerSystemPrompt()` and `buildCoherencePassProposerUserPrompt()` as today.
    - **Mode B**: call `runEditingCycle` WITH `rewriteMode: { coalesceAndCap: false }`. Use NEW prompt builders (Phase 3 below). **No `capLimit` needed** (only consulted when `coalesceAndCap === true`). **No `proposerSoftCap` needed** — `RewriteModeOptions` (`runEditingCycle.ts:56-62`) doesn't have a `proposerSoftCap` field; that was on the legacy iter-config and got removed in PR #1283.
  - [x] **Mode B multi-cycle gotcha**: after each cycle, reassign `currentText = cycleResult.modeBContext?.normalizedSource ?? cycleResult.newText` so cycle N+1's diff is computed against the SAME canonicalized text the previous cycle used. Without this, the diff engine may produce spurious normalization-only "edits" on cycle 2+. (Research § Key Findings #4.) The existing IterativeEditingAgent loop does this — mirror that pattern.
  - [x] **Mode B persisted-context fields**: when in Mode B, persist `proposerMode: 'rewrite'` + optional `rationale`, `rewriteText`, `computedMarkup` from `cycleResult.modeBContext` into the cycle annotation. Mode A persists `proposerMode: 'markup'`. Mirror `IterativeEditingAgent.ts:223-231`.
  - [x] Persist `editingMode` in the `coherencePass.config` snapshot to `execution_detail`.
- [x] `evolution/src/lib/schemas.ts` (per Arch reviewer #4 in iter1)
  - [x] Update the `coherencePass.config` zod sub-schema at lines **2744-2748** (NOT 2747+ as previously specified — actual location is the `paragraphRecombineWithCoherencePassExecutionDetailSchema` object literal). Add `editingMode: z.enum(['mode_a','mode_b'])` as a required field. **Also (per Arch reviewer iter2 minor #1)**: add `maxCycles: z.number().int().min(1).max(5)` as a required field. Currently the snapshot has `lengthCapRatio` but not `maxCycles` — that gap predates this project (PR #1282 missed it) but the same forensics-readability rationale that motivated `editingMode` here applies to `maxCycles` too. Fix opportunistically.
  - [x] Update existing tests in `evolution/src/lib/schemas.test.ts` that snapshot the `coherencePass.config` shape — they'll fail without the new field. Add the field to fixtures + assertions.
  - [x] **Driftrecovery decision** (per Arch reviewer minor #5): keep `driftRecovery: 'skip'` for BOTH Mode A and Mode B. Rationale: the recombined article is the source of truth (no parent to drift from); IterativeEditingAgent uses `'snap'` because it edits a single parent. Phase 2 pseudocode + tests should reflect this.

### Phase 3: Mode B proposer prompt (voice-restoration variant)
- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPromptModeB.ts` (NEW)
  - [x] Clone `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts` as the structural template.
  - [x] Keep the voice-restoration SCOPE from Phase 1 of the sibling project — substantive edits authorized; whole-paragraph rewrites allowed via the natural Mode B format.
  - [x] Output contract: proposer emits `## Rationale` (1-paragraph explanation) + `## Rewrite` (the FULL rewritten article body, no CriticMarkup).
  - [x] No edit-count cap (consistent with the sibling project's "no caps" invariant for the coherence-pass agent).
  - [x] Include LENGTH_HINT — same +10% growth ceiling as Mode A's prompt.
  - [x] DO NOT include HARD_CONSTRAINT byte-equality rules (those apply only to CriticMarkup output).
- [x] `buildCoherencePassProposerPromptModeB.test.ts` (NEW)
  - [x] Assert presence of "## Rationale" and "## Rewrite" structural markers.
  - [x] Assert presence of voice-restoration language.
  - [x] Assert absence of CriticMarkup syntax docs (no `{++…++}` / `{--…--}` / `{~~old~>new~~}`).
  - [x] Assert absence of "AT MOST" / "atomic edits" / "edit budget" count language.
  - [x] Assert LENGTH_HINT line present.
  - [x] **Assert the AMBITIOUS_DIRECTIVE prepend** (per Q1 + Testing reviewer minor #2 in iter1): the 1-sentence voice-restoration framing ("The article you're reviewing was assembled from paragraphs rewritten independently in parallel...") appears immediately before the existing 4-sentence AMBITIOUS_DIRECTIVE.
  - [x] **Assert the "Look for in particular" voice-loss hint** (per Q2 + Testing reviewer minor #2): the 4 patterns (a) transitions, (b) rhetorical callbacks, (c) inconsistent voice register, (d) repeated explanations are present.

### Phase 4: Wizard UI
- [x] `src/app/admin/evolution/strategies/new/page.tsx`
  - [x] Add `coherencePassEditingMode?: 'mode_a' | 'mode_b'` to both interface definitions.
  - [x] Add to `COHERENCE_PASS_DEFAULTS` (default `'mode_b'`).
  - [x] Add to canonicalize emit conditions (emit when set AND not equal to default).
  - [x] Add dropdown UI element ("Editing mode: Mode A (CriticMarkup) | Mode B (rewrite-then-diff)") in the coherence-pass-only section. Default the dropdown to Mode B.
  - [x] **Gate the dropdown** (per Arch reviewer minor #1 in iter1): `disabled={it.coherencePassEnabled === false}` + opacity-50 styling, matching the sibling coherence-pass inputs at `page.tsx:1959-2046`.

### Phase 5: Tests
- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [x] New test: when `input.coherencePassEditingMode = 'mode_a'`, `runEditingCycle` is called WITHOUT a `rewriteMode` argument.
  - [x] New test: when `input.coherencePassEditingMode = 'mode_b'`, `runEditingCycle` is called WITH `rewriteMode: { coalesceAndCap: false }`.
  - [x] New test: when `input.coherencePassEditingMode` undefined, Mode B is used (default resolution via `?? DEFAULT_COHERENCE_PASS_EDITING_MODE`). **Reworded per Sec + Testing reviewers in iter1 — earlier wording referenced the kill switch which Phase 0 deleted.**
  - [x] New test: emitted `coherencePass.config.editingMode` matches the resolved mode.
  - [x] **New test (per Testing reviewer #3 in iter1)**: when Mode B applies an edit, the persisted cycle annotation includes `proposerMode: 'rewrite'` AND `modeBContext.rationale` AND `modeBContext.rewriteText` AND `modeBContext.computedMarkup` propagated from the `runEditingCycle` mock return into the agent's emitted `coherencePass.cycles[i]` object. Mirror IterativeEditingAgent.ts:223-231.
  - [x] **New test (per Testing reviewer #1 in iter1)**: Mode B failure-path stopReasons all handled cleanly. Four parameterized cases mocking `runEditingCycle` to return each of `'proposer_format_violation'`, `'rewrite_too_large'`, `'rewrite_parse_failed'`, `'diff_engine_failed'` — assert the agent's multi-cycle loop terminates on the FIRST cycle (no second runEditingCycle call) AND the cycle is pushed onto `cycles[]` with the stopReason intact.
  - [x] **New test (per Testing reviewer #2 + Sec reviewer in iter1)**: per-cycle `normalizedSource` reassignment between cycles. Mock cycle 1 to return `{appliedAny: true, newText: <canonicalized>, modeBContext: {normalizedSource: <canonicalized>, ...}}`. Assert cycle 2's `runEditingCycle` call receives `text: <canonicalized>` (i.e. the agent reassigned `currentText` correctly).
  - [x] **New test (per Testing reviewer minor #3 in iter1)**: emitted `coherencePass.config` SCHEMA (not just shape) — parse the emitted snapshot through the `paragraphRecombineWithCoherencePassExecutionDetailSchema.coherencePass.config` zod sub-schema. Assert no parse errors. Catches mismatches between the agent emit and the schema declaration earlier than the existing shape-spy test would.
- [x] `evolution/src/lib/schemas.test.ts`
  - [x] New test: `coherencePassEditingMode: 'mode_a'` and `'mode_b'` both parse for `agentType: 'paragraph_recombine_with_coherence_pass'`.
  - [x] New test: `coherencePassEditingMode: 'invalid'` rejects.
  - [x] New test: `coherencePassEditingMode` rejects on non-coherence-pass agent types.
  - [x] New test: `coherencePass.config.editingMode` enum boundary — both `'mode_a'` and `'mode_b'` parse; missing field rejects (it's required, not optional).
- [x] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`
  - [x] New test: `config_hash` distinct when `coherencePassEditingMode` differs.

> **Test scaffold prerequisite** (per Arch reviewer #5 in iter1): the existing `makeCycleResult` helper at `ParagraphRecombineWithCoherencePassAgent.test.ts:86-114` does NOT pass through `opts.modeBContext`. **Two-part fix**: (a) **widen** `makeCycleResult` to spread `modeBContext` from `opts` when provided; (b) **add a NEW parallel helper** `makeModeBCycleResult(opts)` (10–20 LoC) that builds a Mode-B-shaped `RunEditingCycleResult` with all `modeBContext` fields populated by default. The new tests above use the new helper. Mode A tests keep using `makeCycleResult` unchanged.

### Phase 6: Docs
- [x] `evolution/docs/paragraph_recombine_with_coherence_pass.md`
  - [x] Update Algorithm/Phase C: now Mode-configurable. Document Mode A (CriticMarkup-in) vs Mode B (rewrite-then-diff) at the algorithm level.
  - [x] Update Configuration Knobs: add `coherencePassEditingMode` (default `'mode_b'`).
  - [x] Update the Risk note about CriticMarkup compliance (now mitigated by Mode B default).
- [x] `evolution/docs/multi_iteration_strategies.md`
  - [x] Add `coherencePassEditingMode` to the iter-config knob table.
- [x] `evolution/docs/editing_agents.md`
  - [x] Note that the coherence-pass agent now also supports Mode B (it was Mode-A-only).
- [x] `evolution/docs/reference.md`
  - [x] (Phase 0 already removed the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` row from the env-var table. Nothing to update here.)

### Phase 7: Staging A/B + analysis
> **DEFERRED to post-merge.** Phase 7 is a staging run that requires the Mode A/B code in this PR to be deployed; it executes via the `manual_run_experiment` skill after merge.

- [ ] Use the `manual_run_experiment` skill to kick off the A/B (8 runs/arm, federal_reserve_2 prompt).
  - **Treatment**: default Mode B (or explicitly pinned `mode_b`).
  - **Control**: explicitly pinned `mode_a`.
- [ ] Acceptance criteria (per Testing reviewer #4 in iter1 — statistical rigor matching the prior A/B's pre-registration):

  **Headline structural metric** — per-CYCLE apply rate (per Testing reviewer iter2 #4: rename from "invocation" for precision since a single coherence-pass agent invocation can contribute multiple cycles, each its own binomial datapoint):
  - **Denominator = each call to `runEditingCycle()`** across all runs of the arm. Numerator = cycles where `appliedCount > 0`. 8 runs/arm × ~1-2 coherence-pass agent invocations per run × ~1-2 cycles per invocation ≈ 16-32 binomial datapoints per arm.
  - **Mode B success criterion**: Wilson-score lower 95% binomial confidence interval bound on Mode B's apply rate ≥ 35%. **Use Wilson's method** (per Testing reviewer iter2 #1) — Clopper-Pearson is too conservative for n=16-32 and the normal approximation breaks down near p=0.5. Why 35% (not 50%): with n=16-32, a point estimate of 50% has roughly ±18pp Wilson CI; the lower bound at p̂≈55-60% lands around 35%. Setting the threshold at 35% means we need an observed apply rate of 55-60% — a real, sustained improvement vs Mode A's 6.7%.
  - **Mode A unchanged**: Mode A's apply rate should remain in the same ballpark as the prior A/B (6.7%). If Mode A's rate moves substantially, something else changed and the comparison is contaminated — flag as INCONCLUSIVE.

  **Secondary metric** — tactic eloAttrDelta (8 runs/arm, same rule shape as prior A/B):
  - Mode B median tactic-delta ≥ 0 μ AND median shift vs Mode A ≥ +5 μ AND Mann-Whitney one-sided p < 0.10.

  **Cost ceiling** — Mode B's per-run cost ≤ Mode A × 1.75. **Rationale** (per Testing reviewer minor #6): Mode B's full-rewrite output has higher proposer token counts than CriticMarkup spans (the whole article vs a few edit markers). 75% above is a more honest ceiling than the original 50%; if exceeded, flag as a regression-needing-attention but not a structural fail.

  **Outlier rule** (per Testing reviewer #9 — same as prior A/B for consistency): drop any run where ALL non-coherence-pass tactic deltas are negative. Re-run that seed in the affected arm to restore n.

  **Decision tree** — same shape as prior A/B:
  - **PASS**: lower CI bound ≥ 35% on Mode B apply rate AND tactic-delta criteria met AND cost ≤ 1.75×.
  - **FAIL**: Mode B apply rate point estimate ≤ Mode A's, OR Mode B median tactic-delta < Mode A's. Escalate to investigating proposer model strength or Mode B prompt quality.
  - **INCONCLUSIVE**: anything between. Add 4 more runs/arm via `manual_run_experiment` skill's `--append` flag and retest.

  **A/B confound acknowledgment** (per Sec reviewer #4 in iter1): Mode A arm uses the existing CriticMarkup-targeting prompt; Mode B arm uses the NEW voice-restoration Mode B prompt shipped in Phase 3. This means the comparison measures editing path AND prompt change together — which is what we want operationally (we're shipping both), but call out in the analysis methodology that A vs B isolation of the editing path alone would require a separate A/B with prompt held constant.
- [ ] Trigger `/analysis` after completion. Per `manual_run_experiment` SKILL Step 7, the analysis report's Methodology must reference the exact seed-script path used + the experiment IDs.
- [ ] **Bidirectional provenance link-back** (per Arch reviewer #6 in iter1): after `/analysis` writes the new analysis doc, append a back-link to this planning doc's `## Artifacts` section (mirror the pattern used in `docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/_planning.md`'s `## Artifacts` section).
- [ ] If acceptance fails: investigate proposer-output quality, judge calibration, or further iteration.

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts` — Mode A vs Mode B branch behavior, default resolution, emitted config snapshot, per-cycle normalizedSource reassignment, modeBContext persistence, 4 Mode B failure-path stopReasons
- [x] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPromptModeB.test.ts` (NEW) — prompt content + format assertions
- [x] `evolution/src/lib/schemas.test.ts` — zod enum boundary + agentType refine
- [x] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — config_hash distinctness

### Integration Tests
- [x] None expected — Mode B's editing pipeline is already exercised by `IterativeEditingRewriteAgent`'s existing integration tests.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` — extend to verify the new dropdown renders for `paragraph_recombine_with_coherence_pass` agent type AND persists to strategy config.

### Manual Verification
- [x] Local: create a strategy via wizard with `coherencePassEditingMode: 'mode_b'`, save, verify config in DB via `npm run query:staging`.
- [x] Staging: kick off one Mode B coherence-pass run, confirm `coherencePass.cycles[0].appliedCount > 0` (the headline structural fix).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Wizard E2E: navigate to `/admin/evolution/strategies/new`, pick `paragraph_recombine_with_coherence_pass`, verify the Editing Mode dropdown renders + defaults to Mode B + persists.

### B) Automated Tests
- [x] `npm run lint && npm run typecheck && npm run build`
- [x] `npm run test -- evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/`
- [x] `npm run test -- evolution/src/lib/schemas`
- [x] `npm run test -- evolution/src/lib/pipeline/setup/findOrCreateStrategy`
- [x] `npm run test:integration:evolution`
- [x] `npx playwright test src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/paragraph_recombine_with_coherence_pass.md` — Algorithm/Phase C + Configuration Knobs + Risk note
- [x] `evolution/docs/multi_iteration_strategies.md` — new iter-config field row
- [x] `evolution/docs/editing_agents.md` — note Mode B usage in the coherence-pass agent
- [x] `evolution/docs/reference.md` — (Phase 0 already deleted the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` row from the env-var table; nothing additional needed here.)
- [x] No changes expected to: architecture, cost_optimization (cost profile similar), metrics (no new metrics)

## Artifacts

Phase 7 fanned out into three sequential staging A/Bs, all run from branch `chore/run_coherence_pass_mode_ab_staging_20260626` ([PR #1295](https://github.com/Minddojo/explainanything/pull/1295)):

### A/B 1 — CoherencePassMode (Mode A vs Mode B), v1 — **INVALID**
- **Seed script**: [`evolution/scripts/experiments/seedCoherencePassModeABExperiment_20260626.ts`](../../../evolution/scripts/experiments/seedCoherencePassModeABExperiment_20260626.ts)
- **Experiment row**: `3aad46c9-6680-4856-9cfc-69dde5e852a9`
- **Outcome**: invalidated — minicomputer ran pre-PR #1292 code (had not yet pulled main when runs executed). Both arms transparently fell back to Mode A code path. `coherencePass.config.editingMode` field missing from all 13 successful runs' execution_detail. Treated as historical and quarantined.
- **Lesson**: per [`feedback_minicomputer_no_auto_pull`](../../../../.claude/projects/-home-ac-Documents-ac-explainanything-worktree0/memory/project_minicomputer_no_auto_pull.md), minicomputer requires manual `git pull` after every main merge affecting evolution code, BEFORE queueing verification runs.

### A/B 2 — CoherencePassMode (Mode A vs Mode B), v2 — **valid, but bucket-confounded**
- **Seed script**: same as v1 (re-run after minicomputer pull at 2026-06-27 01:40 UTC)
- **Experiment row**: `efda7148-7b43-4eab-800a-855e4ebc5069`
- **Strategies**: Mode A control `5a9b7f72-38fe-4e3d-a2cc-696dba3dd506`, Mode B treatment `fe314a1e-4894-4765-9162-8bf51c827dbc`
- **Outcome**: 13 completed, 3 stale-claim-expired. Headline: Mode B applies edits in 14/14 cycles (vs Mode A's 1/6) — structural fix from PR #1292 works. Mean tactic eloAttrDelta: Mode B −53 Elo vs Mode A −115 Elo (16x scaled from raw mu to Elo).
- **Caveat surfaced during analysis**: parent Elo imbalance (Mode A mean parent 1296 vs Mode B mean parent 1248) plus child-Elo collapse to a flat band (~1175–1220) made the headline +91 Elo median shift mostly artifact of parent quality + TrueSkill under-measurement (`maxComparisonsPerVariant: 3`). Within-bucket comparisons showed Mode A and Mode B essentially tied per parent-Elo bucket.

### A/B 3 — CoherencePassEnabled (Phase C ON vs OFF) — **the clean controlled experiment**
- **Seed script**: [`evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts`](../../../evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts)
- **Experiment row**: `7ecb398a-7a43-4d1e-9015-22a01dbda05a`
- **Strategies**: CP-Off control `0cd27136-b14a-408a-b7f6-635983c66bb6` (new), CP-On treatment `fe314a1e-…` (re-used from A/B 2)
- **Analysis doc**: [`docs/analysis/coherence-pass-enabled-ab-results-20260627`](../../analysis/coherence-pass-enabled-ab-results-20260627/coherence-pass-enabled-ab-results-20260627.md)
- **Outcome**: 16/16 completed cleanly. After controlling for multi-dispatch asymmetry (CP-Off got 2 multi-dispatch runs due to Phase-C-eating-budget mechanism) and using first-dispatch-per-run only:
  - Mean Δ: CP-Off −53.1, CP-On −53.4 (essentially tied)
  - Mann-Whitney one-sided p ≈ 0.56 (clearly null)
  - Cost per variant: CP-Off $0.067, CP-On $0.070 (+5%)
- **Verdict**: Phase C is approximately neutral on Elo at n=8/arm. The "−67 Elo coherence pass cost" prior observational finding does NOT replicate when Phase A + B are held constant — most of that gap came from agent-implementation differences between `paragraph_recombine` and `paragraph_recombine_with_coherence_pass`'s Phase A + B, not Phase C itself.
- **Recommendation**: ship `coherencePassEnabled: false` as the default (statistically tied Elo, 5% cheaper per variant).

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
