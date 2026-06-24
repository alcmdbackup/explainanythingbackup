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

### Phase 1: Rewrite the coherence-pass proposer prompt
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.ts`
  - [ ] Replace `SCOPE_GUIDANCE` with a voice-restoration scope: explicitly authorize whole-paragraph rewrites, structural smoothing, and voice/cadence repair when the recombined article has lost the parent's rhetorical hooks during paragraph-level optimization.
  - [ ] Replace `EDIT_BUDGET`: lift the "AT MOST 5 atomic edits" cap to "as many edits as the length cap allows", remove "edits should be MINOR".
  - [ ] Update `COHERENCE_SOFT_RULES`: remove the *"Edit ONLY for inter-paragraph smoothing — do NOT improve individual paragraphs in isolation"* line. Keep the byte-equality and don't-edit-headings/codefences/URLs rules.
  - [ ] Update `HARD_CONSTRAINT` block: keep verbatim (byte-equality + CriticMarkup syntax is non-negotiable for any proposer).
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.test.ts` (NEW)
  - [ ] Assert presence of voice-restoration language.
  - [ ] Assert absence of the "do NOT improve individual paragraphs" sentence.
  - [ ] Assert `HARD_CONSTRAINT` byte-equality rules still present.

### Phase 2: Remove Jaccard redundancy check globally + drop flow guardrail at coherence-pass site

The Jaccard trigram redundancy check (`checkSemanticOverlap.ts` + the `redundancyJaccardThreshold` option) is removed everywhere it's currently active: the hard-coded coherence-pass call site (2a), the configurable iter-config field on the two criteria agents + the wizard UI (2b), and finally the underlying mechanism itself (2c — runs after 2a+2b so the deletion is conflict-free). The flow guardrail (transition-word preservation) is dropped only at the coherence-pass call site — it's still relevant elsewhere.

Rationale: the Jaccard check is lexical (catches verbatim restatement, misses paraphrased duplication), runs pre-approver (kills edits before the LLM reviewer sees them), and blocks legitimate intentional repetition (rhetorical callbacks, key-term reiteration). `IterativeEditingAgent` already opts out via `validateOpts: undefined`; this phase unifies that decision across the codebase.

**2a. Coherence-pass agent: drop both guardrails at the call site**

- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts:332-336`
  - [ ] In the `runEditingCycle` call, drop `redundancyJaccardThreshold` and `flowGuardrailEnabled`. (Validator treats `undefined` / `false` as disabled per `validateEditGroups.ts:81` and `:70`.)
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts:357-364` (`coherencePass.config` snapshot persisted to `execution_detail`)
  - [ ] Stop persisting `redundancyJaccardThreshold` and `flowGuardrailEnabled`. Keep `lengthCapRatio` (Phase 3 wires it dynamic).
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [ ] Update existing assertions on `coherencePass.config` to reflect the new shape.
  - [ ] Add a test: an edit that would have been dropped by the redundancy check (≥30% Jaccard with surrounding text) is now accepted.
  - [ ] Add a test: an edit that would have been dropped by the flow guardrail (transition-word substitution) is now accepted.

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

Pre-flight: `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap" --include='*.ts' --include='*.tsx'` — only this PR's pending diff should hit. If any other code references either symbol, abort and update 2a/2b to cover.

- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.ts`
  - [ ] Drop `redundancyJaccardThreshold?: number` from `ValidateEditGroupsOptions` (line ~45).
  - [ ] Drop `import { checkSemanticOverlap } from './checkSemanticOverlap'` (line ~26).
  - [ ] Drop the redundancy branch in the main validate loop (lines ~81-99).
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts`
  - [ ] Drop the `describe('validateEditGroups — opts.redundancyJaccardThreshold')` block (lines ~196-237).
- [ ] Delete `evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts`.
- [ ] Delete its test file if it exists (`checkSemanticOverlap.test.ts` or `*.property.test.ts` — search to confirm).

Post-flight: `grep -rn "redundancyJaccardThreshold\|checkSemanticOverlap" --include='*.ts' --include='*.tsx'` must return 0 hits.

### Phase 3: Expose `coherencePassLengthCapRatio` (new iter-config field)
- [ ] `evolution/src/lib/schemas.ts`
  - [ ] Add `coherencePassLengthCapRatio: z.number().min(1.0).max(2.0).optional()` to the iter-config zod schema (next to the existing `coherencePassRewriteTempFloor`/`Ceiling`).
  - [ ] Add validation refine: only valid when `agentType === 'paragraph_recombine_with_coherence_pass'`.
  - [ ] Update the `IterationConfig` TypeScript interface to add the field.
- [ ] `evolution/src/lib/schemas.ts` `COHERENCE_PASS_DEFAULTS`
  - [ ] Add `coherencePassLengthCapRatio: 1.10` (was hard-coded 1.02; new default is **5× more headroom**).
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:355-368` `canonicalizeIterationConfig`
  - [ ] Add a fold entry: include `coherencePassLengthCapRatio` in the canonical hash when set AND not equal to default. Mirrors the existing pattern for `coherencePassRewriteTempFloor/Ceiling`.
- [ ] `ParagraphRecombineWithCoherencePassInput` (`ParagraphRecombineWithCoherencePassAgent.ts:89-106`)
  - [ ] Add `coherencePassLengthCapRatio?: number` field.
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts` execute()
  - [ ] Resolve `coherencePassLengthCapRatio ?? DEFAULT_COHERENCE_LENGTH_CAP_RATIO (1.10)` and pass to `validateOpts.lengthCapRatio` in the `runEditingCycle` call.
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [ ] Thread `iterCfg.coherencePassLengthCapRatio` into the agent input (next to existing `coherencePassEnabled`, `coherencePassProposerModel`, etc).
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`
  - [ ] Add a numeric input "Coherence pass length cap" (range 1.0–2.0, step 0.01, default 1.10), only visible when `agentType === 'paragraph_recombine_with_coherence_pass'`. Mirror the existing `coherencePassRewriteTempFloor` input UI pattern.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [ ] New test: when `input.coherencePassLengthCapRatio = 1.20`, the cycle accepts edits totaling 18% article growth (would have been dropped at 1.02).
  - [ ] New test: when `input.coherencePassLengthCapRatio` undefined, default 1.10 is used.

### Phase 4: Multi-cycle coherence pass (`coherencePassMaxCycles`)
- [ ] `evolution/src/lib/schemas.ts`
  - [ ] Add `coherencePassMaxCycles: z.number().int().min(1).max(5).optional()` to iter-config schema with the same agentType refine.
  - [ ] Add to `COHERENCE_PASS_DEFAULTS`: `coherencePassMaxCycles: 2`.
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:355-368`
  - [ ] Add canonicalization fold (same pattern as Phase 3).
- [ ] `ParagraphRecombineWithCoherencePassInput`
  - [ ] Add `coherencePassMaxCycles?: number` field.
- [ ] `ParagraphRecombineWithCoherencePassAgent.ts:301-377` (the coherence-pass block)
  - [ ] Replace the single `runEditingCycle()` call with a bounded for-loop (mirror `IterativeEditingAgent.ts:192-...` pattern). Loop body:
    - Check pre-cycle budget gate (already done by `runEditingCycle`).
    - Call `runEditingCycle` with the running `finalText`.
    - Push the cycle into `coherencePass.cycles[]`.
    - Update `finalText = cycleResult.newText`.
    - Break on `stopReason` (any value), `appliedAny === false` (no edits applied this cycle — converged), or budget exhaustion.
  - [ ] The `silentRejection` metric becomes per-cycle: increment `coherence_pass_silent_rejection_count` once per cycle that has approverGroups > 0 && appliedCount == 0. Optional: also expose a `coherence_pass_silent_rejection_rate` rollup as `silent_count / cycles_with_approver_groups`.
  - [ ] `paragraph_recombine_coherence_cost` metric write happens AFTER the loop, summing `propose + review` accumulators across all cycles (current pattern already sums per-phase accumulators, so this is automatic).
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
  - [ ] Thread `iterCfg.coherencePassMaxCycles` into the agent input.
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`
  - [ ] Add numeric input "Coherence pass max cycles" (range 1–5, default 2), visibility gated on `agentType === 'paragraph_recombine_with_coherence_pass'`.
- [ ] `ParagraphRecombineWithCoherencePassAgent.test.ts`
  - [ ] New test: when `coherencePassMaxCycles=3` and each cycle applies edits, all 3 cycles run and `coherencePass.cycles.length === 3`.
  - [ ] New test: when cycle 1 returns `stopReason: 'no_edits_proposed'`, loop terminates with `cycles.length === 1`.
  - [ ] New test: when cycle 2 hits the per-cycle budget gate, `cycles.length === 2` with the last cycle's `stopReason: 'invocation_budget_near_exhaustion'`.
- [ ] **Cost envelope update**: doc + integration sanity check.
  - Per the doc: 1 cycle ≈ $0.0035 typical. 2 cycles ≈ $0.007. Per-invocation cap stays $0.10 (75% headroom over 2 cycles). 3 cycles still fit under $0.105 ≈ $0.10 — but at 3 cycles the pre-coherence gate (0.85× cap) is more likely to fire, which is fine (graceful degradation).

### Phase 5: Docs + staging validation
- [ ] `evolution/docs/paragraph_recombine_with_coherence_pass.md`
  - [ ] Update **Algorithm → Phase C**: pass is now multi-cycle (max 2 by default, configurable up to 5) and authorized for voice repair, not just seam smoothing.
  - [ ] Update **Configuration knobs → Coherence-pass-only**: add `coherencePassLengthCapRatio` (default 1.10) + `coherencePassMaxCycles` (default 2).
  - [ ] Update **Cost envelope**: 2 cycles ≈ $0.007 typical, $0.014 worst-case; $0.10 cap stays.
  - [ ] Update **Cost metrics**: silent-rejection metric semantics change (per-cycle counter).
  - [ ] Update **A/B experiment design**: explicit note that the original "isolated rewrites + minor smoothing" hypothesis is invalidated; the agent now tests "isolated rewrites + real editing pass". Acceptance signals updated accordingly.
- [ ] `evolution/docs/multi_iteration_strategies.md` — add the two new iter-config fields to the agent-specific knob table.
- [ ] Staging A/B (manual, post-deploy)
  - [ ] Re-run the same prompt + seed across 5 runs of the NEW config vs 5 runs of the prior config (`coherencePassLengthCapRatio: 1.02`, `coherencePassMaxCycles: 1`).
  - [ ] Confirm: median `eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass` ≥ 0 on the NEW arm; median variant Elo ≥ parent-pool top-3 median.
  - [ ] If still negative, escalate to Option B (`nextContext` in slot judge) or Option C (custom paragraphJudgeRubric).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/buildCoherencePassProposerPrompt.test.ts` — new prompt content assertions (Phase 1)
- [ ] `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.test.ts` — drop-guardrails, lengthCapRatio plumbing, multi-cycle loop (Phases 2a/3/4)
- [ ] `evolution/src/lib/schemas.test.ts` (or wherever iter-config schema tests live) — new `coherencePassLengthCapRatio` + `coherencePassMaxCycles` validation + agentType refine (Phases 3/4); drop redundancyJaccardThreshold refine; **add legacy-field strip regression test** (Phase 2b)
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — config_hash includes new fields when set (Phases 3/4); drop redundancyJaccardThreshold fold test (Phase 2b)
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — confirm `lengthCapRatio` + `flowGuardrailEnabled` + no-opts default coverage still complete after redundancy describe block is removed (Phase 2c)
- [ ] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.test.ts` — confirm input shape no longer expects the field; existing tests pass unchanged (Phase 2b)

### Integration Tests
- [ ] `evolution/src/__tests__/integration/paragraphRecombineWithCoherencePass.integration.test.ts` (if exists; create if not) — end-to-end with mock LLM returning multi-cycle accepts/rejects. Verify final variant content reflects multi-cycle edits.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/evolution_strategy_wizard.spec.ts` (if exists; otherwise update closest sibling) — verify the new wizard inputs render only for the coherence-pass agent type and persist correctly into strategy config.

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
- [ ] `npm run test:integration -- evolution` (if integration test added)
- [ ] `npx playwright test src/__tests__/e2e/specs/evolution_strategy_wizard.spec.ts` (if exists)

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
- **Risk**: changing defaults (1.02 → 1.10, 1 → 2 cycles) silently changes behavior for already-saved strategies that don't set these fields. **Intentional** — those strategies are the ones underperforming. Existing test_evo/canary strategies pinned to specific configs are unaffected only if they explicitly set the fields.
- **Open**: should `coherencePassMaxCycles` default to 2 or 3? IterativeEditingAgent's default is 3. Starting at 2 minimizes cost blowout risk; can raise to 3 in a follow-up if staging shows headroom.
- **Open**: should we add a "voice-restoration" criterion to the slot rubric (Option C above) in PARALLEL with this change? It would attack the same root cause from the other end (slot picks fewer voice-degrading rewrites in the first place). Defer to follow-up unless staging A/B shows Option A alone is insufficient.
- **Risk** (Phase 2b/2c): existing strategies in DB with `redundancyJaccardThreshold` set will need to load cleanly through the new schema. Default zod object behavior strips unknown fields, so this is safe — but the regression test in Phase 2b explicitly verifies it.
- **Open** (Phase 2c): does `checkSemanticOverlap.ts` have a separate `.test.ts` or property-test file? Pre-flight grep before Phase 2c will identify it. If yes, delete it; if no, no action needed.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
