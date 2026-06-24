# Investigate Paragraph Recombine Coherence Pass Performance Plan

## Background
The 4 most-recent staging runs of the `paragraph_recombine_with_coherence_pass` agent all reported negative `eloAttrDelta` (−2.94 to −11.60 mu) for the coherence-pass tactic while sibling tactics on the same runs carried positive deltas. Root cause: the slot judge (no priorPicks / nextContext / coordinator — by design) aggressively prefers paragraph-locally "tighter" rewrites (95% rewrite-pick rate); voice loss compounds across 9–11 slots; the post-hoc coherence pass cannot repair it (currently capped at +2% length, 1 cycle, prompt explicitly forbidding voice repair). In 3 of 4 runs the pass applied 0 edits. See `_research.md` for full evidence.

## Requirements (from GH Issue #1269)
Use debugging skill to query supabase dev and diagnose why most recent 4 paragraph recombine runs on stage have all underperformed.

## Problem
The `coherence pass` step inside `ParagraphRecombineWithCoherencePassAgent` is calibrated for minor seam repair (transition words, pronouns) but the actual failure mode is **compound article-level voice loss** from paragraph-locally optimal slot picks. Four hard-coded constraints prevent the pass from doing the work it would need to: (1) the proposer prompt explicitly forbids whole-paragraph or structural edits; (2) `lengthCapRatio: 1.02` allows at most 2% article growth; (3) only 1 propose-review-apply cycle runs; (4) `redundancyJaccardThreshold: 0.30` + `flowGuardrailEnabled: true` reject the kinds of edits voice repair requires. The agent's original A/B hypothesis (isolated rewrites + minor smoothing beats sequential context) is failing — this project pivots the pass to "isolated rewrites + a real editing pass" and exposes the relevant knobs.

Additionally: the Jaccard redundancy check is bad in general — lexical (catches verbatim restatement, misses paraphrased duplication), pre-approver (kills edits before the LLM reviewer evaluates them), and structurally blocks legitimate intentional repetition. `IterativeEditingAgent` already opts out; this project removes it everywhere else it's currently active (two criteria agents + the coherence-pass agent) and deletes the underlying mechanism (`checkSemanticOverlap.ts`).

## Options Considered
- [x] **Option A: Pivot coherence pass to a real editing pass (CHOSEN)**. Rewrite the proposer prompt to authorize voice repair; drop the redundancy + flow guardrails; expose `coherencePassLengthCapRatio` and `coherencePassMaxCycles` as iter-config fields and wizard inputs; ship aggressive defaults (1.10 / 2 cycles) so existing strategies pick up the fix without config edits. Accepts that the original A/B hypothesis is invalidated.
- [ ] **Option B: Restore some slot-level context (`nextContext` only)**. Mirrors Phase 1c-i of the sequential agent — would let the slot judge see upcoming paragraphs and avoid voice loss earlier. Smaller blast radius but blurs the coherence-pass agent into a sibling of the sequential one without the coordinator. Defer to a follow-up if Option A is insufficient.
- [ ] **Option C: Tighten slot judge via a custom `paragraphJudgeRubric`**. Add a voice-preservation criterion (re-introduce a Fidelity-like signal) to counter the 95% rewrite-pick rate. Already supported by `paragraphJudgeRubricId` — no code change needed, just config. Worth doing in parallel as a separate experiment; not in scope here.

## Phased Execution Plan

### Phase 1: Rewrite the coherence-pass proposer prompt + scaffold the agent test file

**Design intent**: NO caps and NO coalescing for the coherence-pass agent. The only brakes on edit volume are (a) the length cap (`lengthCapRatio`, Phase 3, default 1.10), (b) format validity, (c) byte-equality rules, and (d) the approver LLM's per-group judgment. We accept the resulting approver token cost as the price of letting the pass do real work.

**Test scaffolding (per Testing reviewer #2)**: `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts` does NOT exist today. Phase 1 creates it with shared scaffolding (mock context, mock LLM client, fixture article, `runEditingCycle` jest mock) so Phases 2a/3/4 can layer assertions onto it instead of each inventing setup. Mirror the patterns in `IterativeEditingAgent.test.ts` for the mock-LLM + spy approach; mock `runEditingCycle` at the module boundary (`jest.mock('../editing/runEditingCycle')`) for cycle-level determinism.

- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.ts`
  - [ ] Replace `SCOPE_GUIDANCE` with a voice-restoration scope: explicitly authorize whole-paragraph rewrites, structural smoothing, and voice/cadence repair when the recombined article has lost the parent's rhetorical hooks during paragraph-level optimization.
  - [ ] **Delete `EDIT_BUDGET` constant entirely** from the prompt assembly. No "AT MOST N edits" cap, no "1-3 edits per adjacent group" cap, no "edits should be MINOR" framing. Replace with a single LENGTH_HINT line ("You may grow the article up to ~10% in length; edits beyond that get trimmed downstream") so the LLM knows the only hard ceiling.
  - [ ] Update `COHERENCE_SOFT_RULES`: remove the *"Edit ONLY for inter-paragraph smoothing — do NOT improve individual paragraphs in isolation"* line. Keep the byte-equality and don't-edit-headings/codefences/URLs rules.
  - [ ] Update `HARD_CONSTRAINT` block: keep verbatim (byte-equality + CriticMarkup syntax is non-negotiable for any proposer).
- [ ] **No coalescing** (`ParagraphRecombineWithCoherencePassAgent.ts`): the agent continues to call `runEditingCycle` WITHOUT a `rewriteMode` argument (Mode A path), which means `coalesceAdjacentGroups` and `capGroupsByMagnitude` are both skipped. Add a comment at the call site stating this is intentional ("coherence-pass agent runs Mode A only; no Mode B coalesce/cap"). Verify in test (below).
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.test.ts` (NEW)
  - [ ] Assert presence of voice-restoration language.
  - [ ] Assert absence of the "do NOT improve individual paragraphs" sentence.
  - [ ] Assert `HARD_CONSTRAINT` byte-equality rules still present.
  - [ ] **Assert NO "AT MOST" / "atomic edits" / "edit budget" count language remains** in the assembled prompt.
  - [ ] Assert the LENGTH_HINT line is present.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [ ] **Assert the `runEditingCycle` call does NOT pass `rewriteMode`** (regression guard against accidentally enabling Mode B coalesceAndCap on this agent).

### Phase 2: Remove Jaccard redundancy check globally + drop flow guardrail at coherence-pass site

The Jaccard trigram redundancy check (`checkSemanticOverlap.ts` + the `redundancyJaccardThreshold` option) is removed everywhere it's currently active: the hard-coded coherence-pass call site (2a), the configurable iter-config field on the two criteria agents + the wizard UI (2b), and finally the underlying mechanism itself (2c — runs after 2a+2b so the deletion is conflict-free). The flow guardrail (transition-word preservation) is dropped only at the coherence-pass call site — it's still relevant elsewhere.

Rationale: the Jaccard check is lexical (catches verbatim restatement, misses paraphrased duplication), runs pre-approver (kills edits before the LLM reviewer sees them), and blocks legitimate intentional repetition (rhetorical callbacks, key-term reiteration). `IterativeEditingAgent` already opts out via `validateOpts: undefined`; this phase unifies that decision across the codebase.

**2a. Coherence-pass agent: drop both guardrails at the call site**

- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts:332-336`
  - [ ] In the `runEditingCycle` call, drop `redundancyJaccardThreshold` and `flowGuardrailEnabled`. (Validator treats `undefined` / `false` as disabled per `validateEditGroups.ts:81` and `:70`.)
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts:357-364` (`coherencePass.config` snapshot persisted to `execution_detail`)
  - [ ] Stop persisting `redundancyJaccardThreshold` and `flowGuardrailEnabled`. Keep `lengthCapRatio` (Phase 3 wires it dynamic).
- [ ] `evolution/src/lib/schemas.ts:2747-2766` — **`paragraphRecombineWithCoherencePassExecutionDetailSchema.coherencePass.config`** sub-schema
  - [ ] Drop the required `redundancyJaccardThreshold: z.number()` field at line ~2754 (per Security reviewer: currently required → every successful invocation would fail validation otherwise).
  - [ ] Drop the required `flowGuardrailEnabled: z.boolean()` field at line ~2755.
  - [ ] Keep `lengthCapRatio: z.number()` required (Phase 3 wires it dynamic; the agent always emits it).
  - [ ] For backwards compatibility on READS of legacy detail rows that may still carry the old fields, ensure the parent schema uses default zod object behavior (passes through unknown keys); do NOT add `.strict()`.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts` (NEW FILE — see Phase 1 scaffolding subtask)
  - [ ] Update existing assertions on `coherencePass.config` to reflect the new shape (only `lengthCapRatio` present; verify mechanically — spy on the `runEditingCycle` invocation and assert `validateOpts` keys are exactly `{lengthCapRatio}`, no `redundancyJaccardThreshold` or `flowGuardrailEnabled`).
  - [ ] Add a test: an edit that would have been dropped by the redundancy check (≥30% Jaccard with surrounding text) is now accepted. **Verify via the spy above that the option simply isn't passed**, AND that an end-to-end mock run produces the edit; the mechanism check is the load-bearing assertion (the e2e behavior follows from absence of the option).
  - [ ] Add a test: an edit that would have been dropped by the flow guardrail (transition-word substitution) is now accepted — same dual-assertion pattern.

**2b. Criteria agents: strip the `redundancyJaccardThreshold` iter-config field + wizard input**

Two agents (`single_pass_evaluate_criteria_and_generate`, `proposer_approver_criteria_generate`) expose `redundancyJaccardThreshold` as an iter-config field with default `0.35`. Remove the field everywhere it's threaded.

- [ ] `evolution/src/lib/schemas.ts`
  - [ ] Drop `redundancyJaccardThreshold: z.number().min(0).max(1).optional()` from the iter-config zod schema (line ~828).
  - [ ] Drop the `(c) => c.agentType === '...' || c.redundancyJaccardThreshold === undefined` refine (lines ~974-979).
  - [ ] Drop the field from the preview response schema (line ~2755).
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`
  - [ ] Drop any canonicalization fold for the field (grep `redundancyJaccardThreshold`).
- [ ] `evolution/src/services/strategyPreviewActions.ts:182`
  - [ ] Drop `redundancyJaccardThreshold` from the preview cost-calc input schema.
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [ ] Drop the field from the agent-input plumbing for both criteria agents.
- [ ] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts`
  - [ ] Drop `redundancyJaccardThreshold?: number` from `ProposerApproverCriteriaGenerateInput` (line ~217).
  - [ ] Drop the `?? 0.35` default-resolution (line ~269).
  - [ ] Drop the `redundancyJaccardThreshold` arg from `validateOpts` passed to `runEditingCycle` (line ~346).
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`
  - [ ] Drop `redundancyJaccardThreshold?: number` from both interface definitions (lines 72, 202).
  - [ ] Drop the canonicalization conditional (lines 315-316).
  - [ ] Drop the agent-type-switch defaulters (lines 783, 797).
  - [ ] Drop the agent-type-switch deleters (lines 730, 750, 763, 807, 817, 837, 856).
  - [ ] Drop the wizard input UI block at line 1788 + its `updateIteration` callback at 1791.
- [ ] Tests
  - [ ] `evolution/src/lib/schemas.test.ts` — drop tests asserting the field's refine behavior; **add a regression test** loading a fixture with the legacy field set and confirming clean parse with the field absent (zod default strips unknown fields).
  - [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — drop tests asserting config_hash includes this field.
- [ ] **DB compatibility check**: verify the iter-config schema is NOT declared `.strict()` (default zod behavior strips unknown fields, so existing strategies with `redundancyJaccardThreshold` in DB load cleanly post-removal). If `.strict()`, switch to default; the regression test above will catch this.

**2c. Delete the underlying mechanism (commits after 2a + 2b)**

Pre-flight grep (BOTH file types, code AND docs):
- [ ] `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap" --include='*.ts' --include='*.tsx'` — only this PR's pending diff should hit.
- [ ] `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap\|Jaccard.*redundancy\|redundancy.*Jaccard" --include='*.md'` — only this PR's pending diff in `docs/planning/<this-project>` should hit. Phase 5 must have already updated all other doc references.

If any other code or doc hits, abort and update Phase 2b / Phase 5 to cover before proceeding.

- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.ts`
  - [ ] Drop `redundancyJaccardThreshold?: number` from `ValidateEditGroupsOptions` (line ~45).
  - [ ] Drop `import { checkSemanticOverlap } from './checkSemanticOverlap'` (line ~26).
  - [ ] Drop the redundancy branch in the main validate loop (lines ~81-99).
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts`
  - [ ] Drop the `describe('validateEditGroups — opts.redundancyJaccardThreshold')` block (lines ~196-237).
- [ ] Delete `evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts`.
- [ ] Delete its test file if it exists (run `ls evolution/src/lib/core/agents/editing/checkSemanticOverlap*` first).

Post-flight (both greps):
- [ ] `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap" --include='*.ts' --include='*.tsx'` must return 0 hits.
- [ ] `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap" --include='*.md'` must return 0 hits outside `docs/planning/<this-project>` (closeout notes in this project's own progress doc are fine).

### Phase 3: Expose `coherencePassLengthCapRatio` (new iter-config field)

> **Convention note** (Architecture reviewer): the existing `coherencePass*` knobs do NOT live in a `COHERENCE_PASS_DEFAULTS` object — they're individual `DEFAULT_COHERENCE_*` constants in `ParagraphRecombineWithCoherencePassAgent.ts:79-83` (consumption site) and gated through the generic `FIELD_GATES` table in `findOrCreateStrategy.ts:88-93`. Follow that pattern, not a fold-entry pattern.

- [ ] `evolution/src/lib/schemas.ts`
  - [ ] Add `coherencePassLengthCapRatio: z.number().min(1.0).max(2.0).optional()` to the iter-config zod schema (next to the existing `coherencePassRewriteTempFloor`/`Ceiling`).
  - [ ] Add validation refine: only valid when `agentType === 'paragraph_recombine_with_coherence_pass'`. (No separate `IterationConfig` interface update needed — it's `z.infer<typeof iterationConfigSchema>`.)
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`
  - [ ] Add `coherencePassLengthCapRatio` to `FIELD_GATES` (lines 88-93) mirroring `coherencePassRewriteTempFloor` — emits the field through `canonicalizeIterationConfig` only when set, agentType-gated.
  - [ ] **No** runtime default added in `normalizeIteration`. The FIELD_GATE emits the field ONLY when explicitly set, so existing strategies (config omits the field) keep their existing `config_hash`. Default resolution happens at the agent (`DEFAULT_COHERENCE_PASS_LENGTH_CAP_RATIO ?? input.coherencePassLengthCapRatio`) — same pattern as the existing `coherencePassRewriteTempFloor/Ceiling` handling. This means an existing strategy that ran with the agent's old hard-coded `1.02` now silently runs with `1.10` (intentional, same as the original Phase 3 default-change risk noted in Risks). Strategies that want to pin the old behavior must add `coherencePassLengthCapRatio: 1.02` explicitly.
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts`
  - [ ] Add `DEFAULT_COHERENCE_PASS_LENGTH_CAP_RATIO = 1.10` constant next to existing `DEFAULT_COHERENCE_*` constants (line ~79-83).
  - [ ] Add `coherencePassLengthCapRatio?: number` to `ParagraphRecombineWithCoherencePassInput` (lines 89-106).
  - [ ] In `execute()`: resolve via the `resolveCoherencePassDefaults()` helper introduced in Phase 5 (the kill-switch path), as `const {lengthCapRatio: killSwitchLengthCap} = resolveCoherencePassDefaults(); const effectiveLengthCapRatio = input.coherencePassLengthCapRatio ?? killSwitchLengthCap;`. Pass to `validateOpts.lengthCapRatio` in the `runEditingCycle` call. Explicit input still overrides; only the DEFAULT flips when the kill switch is off.
  - [ ] Persist `effectiveLengthCapRatio` in `coherencePass.config.lengthCapRatio` so execution_detail reflects the actual applied cap (not the default).
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [ ] Thread `iterCfg.coherencePassLengthCapRatio` into the agent input (next to existing `coherencePassEnabled`, `coherencePassProposerModel`, etc).
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`
  - [ ] Add a numeric input "Coherence pass length cap" (range 1.0–2.0, step 0.01, default 1.10), only visible when `agentType === 'paragraph_recombine_with_coherence_pass'`. Mirror the existing `coherencePassRewriteTempFloor` input UI pattern.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [ ] New test: when `input.coherencePassLengthCapRatio = 1.20`, the cycle accepts edits totaling 18% article growth (spy on `runEditingCycle`'s `validateOpts.lengthCapRatio` to assert it's 1.20).
  - [ ] New test: when `input.coherencePassLengthCapRatio` undefined, default 1.10 is used (spy assertion).

### Phase 4: Multi-cycle coherence pass (`coherencePassMaxCycles`)
- [ ] `evolution/src/lib/schemas.ts`
  - [ ] Add `coherencePassMaxCycles: z.number().int().min(1).max(5).optional()` to iter-config schema with the same agentType refine.
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`
  - [ ] Add `coherencePassMaxCycles` to `FIELD_GATES` (same pattern as Phase 3 — agentType-gated, emit-when-set).
  - [ ] **No** runtime default in `normalizeIteration` (same rationale as Phase 3 above — preserves existing strategies' `config_hash`).
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts`
  - [ ] Add `DEFAULT_COHERENCE_PASS_MAX_CYCLES = 2` constant next to existing `DEFAULT_COHERENCE_*` constants.
  - [ ] Add `coherencePassMaxCycles?: number` to `ParagraphRecombineWithCoherencePassInput`.
  - [ ] In `execute()`: resolve via the `resolveCoherencePassDefaults()` helper (same kill-switch path as Phase 3), `const {maxCycles: killSwitchMaxCycles} = resolveCoherencePassDefaults(); const maxCycles = input.coherencePassMaxCycles ?? killSwitchMaxCycles;`.
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts:301-377` (the coherence-pass block) — multi-cycle refactor

```
// Pseudocode for the new loop (mirror IterativeEditingAgent.ts:192-244).
// Assumes pre-loop block (lines 250-300 of current agent) has already initialized:
//   invocationScope, effectiveCapUsd, effectiveLengthCapRatio, proposerModel, approverModel
// Per agent invariant I3 (lines 17-21): on runEditingCycle throw, push partialCycleOnThrow
// before re-throwing so cycle 1's completed cycle survives in execution_detail.cycles[].
const {maxCycles: killSwitchMaxCycles} = resolveCoherencePassDefaults();
const maxCycles = input.coherencePassMaxCycles ?? killSwitchMaxCycles;
const cycles: EditingCycle[] = [];
let currentText = recombinedText;
let silentRejectionCount = 0;

for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber++) {
  // driftRecovery: 'skip' (NOT 'snap'): the recombined article is the source of truth —
  // there is no parent to drift from. With multi-cycle, this means any minor drift in
  // cycle 2+ aborts via stopReason cleanly (rather than attempting snap recovery against
  // a moving source). This is intentional; documented in Phase 5 cost-envelope notes.
  // NOTE on error handling: runEditingCycle catches its own LLM errors and returns
  // `stopReason='helper_threw'` with a fully-populated EditingCycle (see runEditingCycle.ts
  // lines 217-231). The outer catch is only for truly UNEXPECTED throws (e.g. parser
  // crashes outside the helper's try block). Per IterativeEditingAgent.ts:267-271
  // precedent, we do NOT push a partial cycle in the outer catch — already-completed
  // cycles[i < cycleNumber] survive in `cycles[]` because we pushed them in earlier
  // iterations. Re-throwing propagates to the agent's outer try/catch where execution_detail
  // gets persisted with the cycles we already pushed. No partial-cycle marker needed.
  const cycleResult = await runEditingCycle({
    text: currentText,
    llm,
    costScope: invocationScope,
    perInvocationBudgetUsd: effectiveCapUsd,
    cycleNumber,
    proposerLabel: 'coherence_pass_propose',
    approverLabel: 'coherence_pass_review',
    models: { editing: proposerModel, approver: approverModel },
    validateOpts: { lengthCapRatio: effectiveLengthCapRatio },
    driftRecovery: 'skip',
    proposerSystemPrompt: buildCoherencePassProposerSystemPrompt(),
    // CRITICAL (per Security reviewer #2): rebuild the user prompt from currentText
    // every iteration — otherwise cycle 2+ would propose CriticMarkup against the
    // STALE source text, and parseProposedEdits(proposedMarkup, currentText) would
    // drop almost all groups via RULE-1 outside-markup-fidelity check.
    proposerUserPrompt: buildCoherencePassProposerUserPrompt(currentText),
  });

  cycles.push(cycleResult.cycle);

  // Per-cycle silent-rejection metric: additive count, single MAX-write at loop end.
  const silentThisCycle =
    cycleResult.cycle.approverGroups.length > 0
    && cycleResult.cycle.appliedGroups.length === 0;
  if (silentThisCycle) silentRejectionCount += 1;

  currentText = cycleResult.newText;

  // Tighter termination per Security reviewer: per runEditingCycle.ts:549, every
  // appliedAny:false path sets a stopReason. So stopReason subsumes appliedAny.
  if (cycleResult.stopReason) break;
}

const finalText = currentText;

// End-of-loop run-level metric writes (mirror existing single-cycle writes at
// ParagraphRecombineWithCoherencePassAgent.ts:352, 370-374):
if (ctx.db && ctx.runId) {
  if (silentRejectionCount > 0) {
    try {
      await writeMetricMax(ctx.db, 'run', ctx.runId,
        'coherence_pass_silent_rejection_count' as MetricName,
        silentRejectionCount, 'during_execution');
    } catch { /* non-fatal */ }
  }
  // paragraph_recombine_coherence_cost write is unchanged from existing code —
  // sums propose + review accumulators which are run-cumulative across cycles.
}
```

  - [ ] **Per-cycle silent-rejection**: tracker uses an additive counter accumulated across cycles, then one `writeMetricMax` of the run-total at the end. (NOT writeMetricMax per-cycle — that would silently cap at 1 even when multiple cycles silent-reject.) Naming: `coherence_pass_silent_rejection_count` stays (run-total) ; consider also adding `coherence_pass_silent_rejection_cycles` as a separate metric if cycle-grain debugging is wanted (defer to follow-up).
  - [ ] `paragraph_recombine_coherence_cost` metric write happens AFTER the loop. The existing pattern (sum of `coherence_pass_propose` + `coherence_pass_review` accumulators on the slot scope) is automatic since the scope accumulators are run-cumulative — no per-cycle bookkeeping needed. Confirmed against existing code at `ParagraphRecombineWithCoherencePassAgent.ts:368-376`.
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [ ] Thread `iterCfg.coherencePassMaxCycles` into the agent input.
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`
  - [ ] Add numeric input "Coherence pass max cycles" (range 1–5, default 2), visibility gated on `agentType === 'paragraph_recombine_with_coherence_pass'`.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`

  **Mocking strategy (per Testing reviewer #1)**: stub `runEditingCycle` directly with `jest.fn().mockResolvedValueOnce(...)` calls — one resolved value per cycle. This is required because each cycle uses the SAME proposer/approver labels, so a label-keyed `completeFn` mock cannot differentiate cycles. Mocking `runEditingCycle` at the module boundary keeps tests deterministic without re-implementing the editing pipeline.

  - [ ] New test: when `coherencePassMaxCycles=3` and each cycle applies edits, all 3 cycles run and `coherencePass.cycles.length === 3`. Mock: `mockResolvedValueOnce({appliedAny:true, ...}).mockResolvedValueOnce({appliedAny:true, ...}).mockResolvedValueOnce({appliedAny:true, ...})`.
  - [ ] New test: when cycle 1 returns `stopReason: 'no_edits_proposed'`, loop terminates with `cycles.length === 1`. Mock: `mockResolvedValueOnce({stopReason:'no_edits_proposed', appliedAny:false, ...})`.
  - [ ] New test: when cycle 2 hits the per-cycle budget gate, `cycles.length === 2` with the last cycle's `stopReason: 'invocation_budget_near_exhaustion'`.
  - [ ] **New test (per Security reviewer #2)**: assert `runEditingCycle` is called with `proposerUserPrompt` rebuilt from each cycle's running text. Mock 2 cycles where cycle 1 modifies text. Assert call 1's `proposerUserPrompt` arg contains the original text and call 2's arg contains the modified text.
  - [ ] **New test (per Testing reviewer)**: zod-range boundary — `coherencePassMaxCycles: 5` parses, `6` rejects. Mirror for `coherencePassLengthCapRatio` (2.0 parses, 2.01 rejects; 1.0 parses, 0.99 rejects).
  - [ ] **New test (per Testing reviewer iter3 #1)**: cycle-2 LLM-throw — `runEditingCycle.mockResolvedValueOnce({appliedAny:true, cycle:{...}}).mockRejectedValueOnce(new Error('parser crash'))` → assert `cycles.length === 1` (cycle 1 survived), the agent's outer try/catch persists `execution_detail` with that single cycle, and the error propagates as a failed-execute (matching IterativeEditingAgent.ts:267-271 precedent).
- [ ] **Cost envelope update**: doc + integration sanity check.
  - Per the doc: 1 cycle ≈ $0.0035 typical. 2 cycles ≈ $0.007. Per-invocation cap stays $0.10 (75% headroom over 2 cycles). 3 cycles still fit under $0.105 ≈ $0.10 — but at 3 cycles the pre-coherence gate (0.85× cap) is more likely to fire, which is fine (graceful degradation).

### Phase 5: Docs + staging validation
- [ ] `evolution/docs/paragraph_recombine_with_coherence_pass.md`
  - [ ] Update **Algorithm → Phase C**: pass is now multi-cycle (max 2 by default, configurable up to 5) and authorized for voice repair, not just seam smoothing.
  - [ ] Update **Configuration knobs → Coherence-pass-only**: add `coherencePassLengthCapRatio` (default 1.10) + `coherencePassMaxCycles` (default 2). Remove `redundancyJaccardThreshold` mentions.
  - [ ] Update **Cost envelope**: 2 cycles ≈ $0.007 typical, $0.014 worst-case; $0.10 cap stays. Note compounding length cap: 1.10 per cycle × 2 cycles = worst-case 1.21× original length.
  - [ ] Update **Cost metrics**: silent-rejection metric semantics change (additive across cycles per run, single end-of-loop writeMetricMax of the run-total).
  - [ ] Update **A/B experiment design**: explicit note that the original "isolated rewrites + minor smoothing" hypothesis is invalidated; the agent now tests "isolated rewrites + real editing pass". Acceptance signals updated accordingly.
- [ ] `evolution/docs/multi_iteration_strategies.md` — add the two new iter-config fields to the agent-specific knob table.
- [ ] **Additional doc updates (per Architecture reviewer #1)**:
  - [ ] `evolution/docs/curriculum.md` — remove "Redundancy Guardrail" row from the curriculum table.
  - [ ] `evolution/docs/strategies_and_experiments.md` — remove `redundancyJaccardThreshold` from the iter-config TS comment and field listings.
  - [ ] `evolution/docs/agents/overview.md` — remove the two references (the propose/approve algorithm line + the coherence-pass-specific validateOpts snippet on line ~601).

**Staging A/B (per Testing reviewer #4)**:

Pre-registration (before kickoff):
  - [ ] Sample size: **≥ 8 runs/arm** (not 5 — research σ ≈ 3.6 mu makes 5v5 underpowered for the target MDE).
  - [ ] Minimum detectable effect: **median shift ≥ 5 mu** on the NEW arm vs OLD arm.
  - [ ] Outlier exclusion rule: drop any run where ALL non-coherence-pass tactic deltas are negative (matches the `04704b6a` outlier pattern documented in `_research.md`). Re-run that seed in the affected arm to maintain n.
  - [ ] Pin the OLD arm to legacy defaults: `coherencePassLengthCapRatio: 1.02`, `coherencePassMaxCycles: 1`. (Note: the new prompt applies to both arms — this isolates the knob change but NOT the prompt change. The prompt change is forced and intentional; if a third arm is wanted to isolate prompt vs knobs, document but defer.)

Run:
  - [ ] Same prompt + same seed across all runs of each arm; counterbalance seeds across arms.
  - [ ] Collect: `eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass`, `winner_elo`, `median_elo`, `paragraph_recombine_coherence_cost`, `coherence_pass_silent_rejection_count`, `coherencePass.cycles.length`.

Analysis (report all):
  - [ ] Median + IQR per arm.
  - [ ] Mann–Whitney U test of arm medians (non-parametric; tolerant of non-normality and outliers).
  - [ ] Bootstrap 95% CI on median delta.

Decision rules:
  - [ ] **PASS** if median tactic-delta on NEW arm ≥ 0 AND median shift ≥ +5 mu AND Mann–Whitney p < 0.10 (one-sided).
  - [ ] **FAIL** if NEW arm median tactic-delta < OLD arm median. Escalate to Option B (`nextContext` in slot judge) or Option C (custom paragraphJudgeRubric).
  - [ ] **INCONCLUSIVE** (anything between): add 4 more runs per arm and re-test. If still inconclusive after 12/arm, default to PASS-with-caveats and escalate to staging cohort for longer observation.

**Rollback / kill switch (per Testing reviewer #5 + Architecture reviewer #1 clarification)**:
  - [ ] Implementation site: add a small helper `resolveCoherencePassDefaults()` in `ParagraphRecombineWithCoherencePassAgent.ts` next to the `DEFAULT_COHERENCE_*` constants. Reads `process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` PER INVOCATION (not at process boot — instant rollback without restart). Returns `{lengthCapRatio: 1.10, maxCycles: 2}` when `'true'` (or unset — default), `{lengthCapRatio: 1.02, maxCycles: 1}` when `'false'`. Agent calls this in execute() to resolve defaults; explicit input fields still override.
  - [ ] **Naming clarification**: the existing `coherencePass.skipped` enum at `schemas.ts:2762` includes `'kill_switch'` as a value — that's an OLDER feature unrelated to this env var. This env var swaps DEFAULTS, it does not skip the pass. The pre-existing `'kill_switch'` enum value remains valid for whatever existing code path uses it.
  - [ ] Unit test (in the new `ParagraphRecombineWithCoherencePassAgent.test.ts`): toggle `process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` across two test runs, assert resolved `validateOpts.lengthCapRatio` + loop's `maxCycles` flip accordingly. **Use save-restore hygiene** (per Testing reviewer iter3 #2): pattern from `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts:143-163` — save `const original = process.env.X`, set in `beforeEach`, restore in `afterEach` / `finally`. Prevents test pollution of subsequent tests.
  - [ ] Document the kill switch in `evolution/docs/reference.md` env-var table.

**PR-revert checklist** (the kill switch handles default-only rollback; this is needed if the prompt or guardrail removal itself misbehaves):
  - [ ] Identify the 4-5 commits comprising Phases 1/2a/2b/2c/3/4 (record PR# + commit SHAs at merge time).
  - [ ] Revert order: Phase 4 → Phase 3 → Phase 2c → Phase 2b → Phase 2a → Phase 1.
  - [ ] Plain `git revert <commit>` correctly restores deleted files in modern git — no special handling needed for `checkSemanticOverlap.ts`. If a manual restore is preferred over a revert commit, use `git show <commit>^:evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts > evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts` — note `^:` (parent tree of the delete commit, where the file still exists), NOT `:` (the delete commit's own tree, where the file is gone).
  - [ ] Wizard UI deletions in Phase 2b are likewise restored by plain `git revert`; only manual when cherry-picking from a different branch.
  - [ ] Post-revert sanity: `npm run tsc && npm run test:unit -- evolution && npm run test:unit -- src/app/admin/evolution`.
  - [ ] Post-revert staging smoke: run one coherence-pass strategy run, confirm `coherencePass.cycles.length === 1` and `coherencePass.config` shape matches pre-Phase-1.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.test.ts` (NEW) — new prompt content assertions (Phase 1); also assert no stale "redundancy"/"Jaccard"/"transition word guardrail" language leaks into the rewritten prompt.
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts` (**NEW** — does not exist today; Phase 1 scaffolds) — drop-guardrails (mechanism spy + e2e), lengthCapRatio plumbing, multi-cycle loop with per-cycle proposerUserPrompt rebuild verification (Phases 2a/3/4)
- [ ] `evolution/src/lib/schemas.test.ts` — new `coherencePassLengthCapRatio` + `coherencePassMaxCycles` validation + agentType refine + boundary tests (Phases 3/4); drop redundancyJaccardThreshold refine; **add legacy-field strip regression test** using `iterationConfigSchema.parse({agentType:'paragraph_recombine_with_coherence_pass', redundancyJaccardThreshold: 0.3, ...other valid fields})` → expect parsed result to lack `redundancyJaccardThreshold` (Phase 2b)
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — config_hash includes new fields when set (Phases 3/4); drop redundancyJaccardThreshold FIELD_GATES test (Phase 2b)
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — confirm `lengthCapRatio` + `flowGuardrailEnabled` + no-opts default coverage still complete after redundancy describe block is removed (Phase 2c)
- [ ] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.invariants.test.ts` (the existing file — NOT a `.test.ts` sibling; Testing reviewer #3 caught the misnaming) — confirm input shape no longer expects the field; existing tests pass unchanged (Phase 2b)

### Integration Tests
- [ ] **REQUIRED** (was optional; promoted per Testing reviewer #4): `evolution/src/__tests__/integration/paragraphRecombineWithCoherencePass.integration.test.ts` (CREATE — does not exist) — end-to-end with deterministic mock LLM returning multi-cycle accepts/rejects. Verify final variant content reflects multi-cycle edits AND verify the proposer is called with a fresh `<source>` payload on cycle 2 (regression guard against the per-cycle prompt-rebuild bug surfaced by Security reviewer).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` (the existing closest sibling per Testing reviewer #6) — extend to verify the new wizard inputs (`coherencePassLengthCapRatio`, `coherencePassMaxCycles`) render only for the coherence-pass agent type, persist correctly into strategy config, and that the `redundancyJaccardThreshold` input is GONE for both criteria agents.

### Manual Verification
- [ ] Local: create a new strategy via wizard with `coherencePassLengthCapRatio: 1.15`, `coherencePassMaxCycles: 3` — verify config_hash differs from the previous strategy and execution_detail reflects the new settings.
- [ ] Staging: kick off a single-run smoke test with the new defaults, confirm `coherencePass.cycles.length ≥ 2` and `coherencePass.config.lengthCapRatio === 1.10` in `execution_detail`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Local wizard: navigate to `/admin/evolution/strategies/new`, pick `paragraph_recombine_with_coherence_pass`, set length cap 1.15 + max cycles 3, save — verify saved config in DB via `npm run query:staging` matches input.

### B) Automated Tests
- [ ] `npm run lint && npm run tsc && npm run build`
- [ ] `npm run test:unit -- evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass`
- [ ] `npm run test:unit -- evolution/src/lib/schemas`
- [ ] `npm run test:unit -- evolution/src/lib/pipeline/setup/findOrCreateStrategy`
- [ ] `npm run test:integration -- evolution` (integration test is required per Testing section)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` (real path, per Testing reviewer #1 in iter2)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine_with_coherence_pass.md` — algorithm, knobs, cost envelope, A/B design, acceptance signals; remove Jaccard mentions (Phase 5)
- [ ] `evolution/docs/multi_iteration_strategies.md` — add `coherencePassLengthCapRatio` + `coherencePassMaxCycles` to the knob table; drop `redundancyJaccardThreshold` from the criteria-agent rows
- [ ] `evolution/docs/cost_optimization.md` — adjust per-invocation cost envelope numbers for the new default
- [ ] `evolution/docs/metrics.md` — note the per-cycle silent-rejection counter semantics change
- [ ] `evolution/docs/reference.md` — config field updates (`coherencePassLengthCapRatio`, `coherencePassMaxCycles` added; `redundancyJaccardThreshold` removed)
- [ ] `evolution/docs/criteria_agents.md` — remove `redundancyJaccardThreshold` from knob tables; add a one-line changelog note ("redundancy guardrail removed 2026-06-24 — LLM approver is sole quality gate")
- [ ] `evolution/docs/editing_agents.md` — verify no orphan mentions of `redundancyJaccardThreshold` / `checkSemanticOverlap`
- [ ] No changes expected to: architecture, data_model, rating_and_comparison, arena, logging, evolution_metrics, variant_lineage, debugging, debugging_skill, strategies_and_experiments

## Risks & Open Questions

- **Risk**: aggressive coherence-pass rewrites may introduce within-paragraph errors that the slot judge already ranked away (defeating the per-slot Elo work). Mitigation: the new prompt still preserves the byte-equality + soft rules (no headings, no codefences, preserve quotes/citations/URLs). The article-level judge sees the result regardless — if voice repair hurts, the article variant will rank low and the run terminates.
- **Risk**: with NO edit-count cap in the prompt and NO post-parse coalesceAndCap (Mode B not used), the LLM could propose 30+ small edits in one cycle, inflating approver-side token cost and slowing the cycle. Accepted as intentional per the design intent above. The pre-coherence budget gate (0.85× perInvocationCap) and per-cycle budget gate (0.9× perInvocationBudget) provide a backstop if a runaway cycle would actually blow the cap.
- **Risk**: changing defaults (1.02 → 1.10, 1 → 2 cycles) silently changes behavior for already-saved strategies that don't set these fields. **Intentional** — those strategies are the ones underperforming. Existing test_evo/canary strategies pinned to specific configs are unaffected only if they explicitly set the fields.
- **Open**: should `coherencePassMaxCycles` default to 2 or 3? IterativeEditingAgent's default is 3. Starting at 2 minimizes cost blowout risk; can raise to 3 in a follow-up if staging shows headroom.
- **Open**: should we add a "voice-restoration" criterion to the slot rubric (Option C above) in PARALLEL with this change? It would attack the same root cause from the other end (slot picks fewer voice-degrading rewrites in the first place). Defer to follow-up unless staging A/B shows Option A alone is insufficient.
- **Risk** (Phase 2b/2c): existing strategies in DB with `redundancyJaccardThreshold` set will need to load cleanly through the new schema. Default zod object behavior strips unknown fields, so this is safe — but the regression test in Phase 2b explicitly verifies it.
- **Open** (Phase 2c): does `checkSemanticOverlap.ts` have a separate `.test.ts` or property-test file? Pre-flight grep before Phase 2c will identify it. If yes, delete it; if no, no action needed.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
