# Updated Criteria Agent Plan

## Background
Follow-up to `understand_critera_agent_performance_evolution_20260503`. After PR #1032 + #1036, the criteria-driven evolution agent (`agentType: criteria_and_generate`) closed 42% of the original Elo gap (-47 → -27.8) but still trails baseline. Post-merge analysis identified two distinct failure modes (rewrite disasters at 0-20% verbatim → mean -69 Elo; light-edit left-tail despite 14-19% sentence-level changes → p25 ≈ -50 Elo).

## Requirements (from user, 2026-05-06)

### Two new agent types, shipped in parallel
1. **`single_pass_evaluate_criteria_and_generate`** — successor to the existing `evaluate_criteria_then_generate_from_previous_article` wrapper. One combined LLM call (score + suggestions) → GFPA delegation with `customPrompt`. Adds redundancy / flow / length guardrails into the customPrompt + evaluator instructions.
2. **`proposer_approver_criteria_generate`** — new agent modeled on `IterativeEditingAgent` but **single-cycle** (not up to N cycles).

### Guardrails (apply to BOTH agent types)
- **Redundancy** — don't introduce overlapping ideas / phrasing that already appear elsewhere in the article.
- **Flow** — don't break paragraph-to-paragraph transitions or local sentence rhythm.
- **Length** — keep within ±10% of the original word count (already partially in PR #1032's customPrompt; the proposer/approver variant enforces more strictly via a tightened size-ratio guardrail).

### Proposer/Approver mechanics (single cycle)
- **Cycle count**: ONE propose-review-apply cycle per parent. Zod refines `cycles.length === 1`.
- **Approver context**: Approver receives the FULL criteria + evaluation context.
- **Rubber-stamping**: Not a concern — `editingModel` and `approverModel` may be identical without warning.

### Mirror-approver protocol (bias mitigation)
The approver runs two passes on each proposed edit group:
- **Initial pass** — original CriticMarkup proposal.
- **Mirror pass** — sign-flipped version applied to the article in the opposite state.

**Implementer rule**: apply iff `(forward, mirror) == (ACCEPT, REJECT)` — approver consistently prefers the proposed end-state. All other combinations drop the edit. Mirrors the existing `run2PassReversal` bias-mitigation pattern.

### Resolved decisions (from research phase)
1. **Two new marker tactics**: `'criteria_driven_single_pass'`, `'criteria_driven_propose_approve'` — distinct from legacy `'criteria_driven'` for clean leaderboard A/B.
2. **`mirrorEdits.ts` location**: `evolution/src/lib/core/agents/editing/`.
3. **`mirrorAgreementRate` thresholds**: two-sided (low 0.20 / high 0.95) via env vars.
4. **`includesMirrorApprover`**: per-iteration config field only (no global env-var kill switch).
5. **`cycles[]` shape**: array (length 1, Zod-enforced) to match `IterativeEditingAgent`.
6. **Legacy migration**: Option B (coexist). Keep `'criteria_and_generate'` alongside the two new types; sunset is a follow-on project gated by validation results.

### Success metric
Mean Elo Δ vs `generate_from_previous_article` baseline on the Federal Reserve prompt is primary. Optionally broaden prompt set.

## Problem
The current single-pass criteria agent (a) cannot discriminate "drop this suggestion" from "apply this suggestion" — every parsed suggestion gets executed by GFPA — and (b) lacks structural guardrails against the three observed failure patterns: redundancy bloat, broken paragraph flow, and length expansion. Both new variants address the structural problems; the propose/approve variant additionally introduces the discriminator the single-pass variant lacks.

## Options Considered
- [ ] **Option A: Single-pass with new guardrails only** — keep existing wrapper architecture, only update customPrompt + evaluator rubric instructions. Minimal change; proves the guardrails add value before committing to the heavier propose/approve build. Risk: the executive selection problem (every parsed suggestion is applied) is unchanged.
- [ ] **Option B: Propose/approve only** — replace the single-pass agent entirely. Cleaner architectural endpoint. Risk: large code change without an isolated comparison of guardrails-alone vs guardrails+approver, so we can't attribute lift to the right component.
- [x] **Option C: Both, ship in parallel as distinct `agentType`s** — CHOSEN. Single-pass becomes a sibling of (not replacement for) the existing wrapper; propose/approve is a new agent type alongside both. A/B comparison runs on the same prompt set across all three.

## Phased Execution Plan

### Phase 1: Schema, types, registration (foundation, no runtime behavior change)

Lays the type-system and registry groundwork so the two new agents can dispatch. Phase 1 ships independently — no agent classes exist yet, but the enum + cost-tracking + execution_detail schemas are in place.

#### 1.1 — DB migration: cost-calibration phase enum
- [ ] Create `supabase/migrations/{date}_evolution_cost_calibration_proposer_approver_phases.sql`:
  - `DROP CONSTRAINT IF EXISTS evolution_cost_calibration_phase_allowed`
  - `ADD CONSTRAINT evolution_cost_calibration_phase_allowed CHECK (phase IN (...all existing... 'criteria_proposer', 'criteria_forward_approver', 'criteria_mirror_approver'))`
- [ ] Apply locally (`supabase db reset` or `supabase migration up --local`).
- [ ] Verify `assertCostCalibrationPhaseEnumsMatch` (`evolution/src/lib/core/startupAssertions.ts:19-42`) passes after the new TS enum entries are added.

#### 1.2 — AgentName + cost-metric routing
- [ ] `evolution/src/lib/core/agentNames.ts`: add 3 new AgentName labels — `'criteria_proposer'`, `'criteria_forward_approver'`, `'criteria_mirror_approver'`.
- [ ] Same file: extend `COST_METRIC_BY_AGENT` mapping — all 3 new labels → `'proposer_approver_criteria_cost'`. Single-pass continues to reuse `'evaluate_and_suggest'` (no new label).
- [ ] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`: extend `OUTPUT_TOKEN_ESTIMATES`:
  - `criteria_proposer: 4800` (full article + markup overhead)
  - `criteria_forward_approver: 600`
  - `criteria_mirror_approver: 600`
- [ ] `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`: extend `CalibrationRow.phase` union with the 3 new values.

#### 1.3 — Marker tactics + GFPA guard widening
- [ ] `evolution/src/lib/core/tactics/index.ts`: add to `MARKER_TACTICS`: `'criteria_driven_single_pass'` (cyan `#06b6d4`) and `'criteria_driven_propose_approve'` (purple `#8b5cf6`).
- [ ] `evolution/src/lib/core/agents/generateFromPreviousArticle.ts:190` — widen the misconfiguration guard:
  ```typescript
  const CRITERIA_TACTICS = new Set(['criteria_driven', 'criteria_driven_single_pass', 'criteria_driven_propose_approve']);
  if (CRITERIA_TACTICS.has(tactic) && input.customPrompt === undefined) throw ...
  ```
- [ ] `evolution/scripts/syncSystemTactics.ts`: confirms it unions `MARKER_TACTICS` so both new sentinels appear as DB rows.

#### 1.4 — `iterationConfigSchema` + helper updates
- [ ] `evolution/src/lib/schemas.ts:478` — extend `iterationAgentTypeEnum`:
  ```typescript
  z.enum(['generate', 'reflect_and_generate', 'criteria_and_generate', 
          'single_pass_evaluate_criteria_and_generate', 
          'proposer_approver_criteria_generate', 
          'iterative_editing', 'swiss'])
  ```
- [ ] Same file, `iterationConfigSchema` (lines 522-597) — add 4 new optional fields:
  - `lengthCapRatio: z.number().min(1.01).max(1.50).optional()`
  - `redundancyJaccardThreshold: z.number().min(0).max(1).optional()`
  - `includesMirrorApprover: z.boolean().optional()`
  - (Reuse existing `editingModel` / `approverModel` / `editingMaxCycles` / `editingEligibilityCutoff` for `proposer_approver_criteria_generate`.)
- [ ] Add Zod `.refine()` blocks:
  - `criteriaIds` valid for the 3 criteria-based agent types (extend existing).
  - `criteriaIds` REQUIRED + non-empty for those 3 types.
  - `weakestK` valid for those 3 types (extend existing).
  - `lengthCapRatio` rejected on agent types other than `proposer_approver_criteria_generate`.
  - `redundancyJaccardThreshold` rejected on agent types other than the 2 new criteria-based ones.
  - `includesMirrorApprover` rejected on agent types other than `proposer_approver_criteria_generate`.
  - `editingMaxCycles === 1` enforced when `agentType === 'proposer_approver_criteria_generate'` (single-cycle invariant).
- [ ] Helper updates (lines 484, 492, 500): `canBeFirstIteration`, `isVariantProducingAgentType`, `producesNewVariants` — add the 2 new agent types to all three.
- [ ] `evolution/src/lib/pipeline/infra/types.ts:31` — extend `IterationResult.agentType` union.
- [ ] `evolution/src/services/strategyPreviewActions.ts:168` + 208 — extend `previewDispatchPlanSchema` enum + `IterationPlanEntryClient` union + add 3 new optional fields.
- [ ] `evolution/src/services/strategyRegistryActions.ts:158` — extend `validateCriteriaIds` filter to include all 3 criteria-based types.
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` (lines 50-56, 76-85) — extend `canonicalizeIterationConfig` for new fields in hash; extend `labelStrategyConfig` (`Nx single-pass-criteria + Mx proposer-approver`).

#### 1.5 — `execution_detail` discriminated-union schemas
- [ ] `evolution/src/lib/schemas.ts` (after line 1414) — add `singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema`:
  - `detailType: z.literal('single_pass_evaluate_criteria_and_generate')`
  - `tactic: z.literal('criteria_driven_single_pass')`
  - `weakestCriteriaIds`, `weakestCriteriaNames`
  - `evaluateAndSuggest` sub-object (same shape as existing wrapper)
  - `generation`, `ranking` sub-objects (reused from GFPA)
  - `surfaced`, `discardReason`, `totalCost`, `estimatedTotalCost`, `estimationErrorPct`
  - `guardrails: { redundancyDropCount: 0, flowDropCount: 0, lengthCapHit: boolean }` (most fields placeholder for single-pass — only `lengthCapHit` is meaningful since there are no edit groups)
- [ ] Add `proposerApproverCriteriaGenerateExecutionDetailSchema`:
  - `detailType: z.literal('proposer_approver_criteria_generate')`
  - `tactic: z.literal('criteria_driven_propose_approve')`
  - `weakestCriteriaIds`, `weakestCriteriaNames`, `evaluateAndSuggest` sub-object
  - **`cycles: z.array(...).length(1)`** with single entry containing `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `forwardDecisions[]`, `mirrorDecisions[]`, `appliedGroups`, `droppedPostApprover`, `proposeCostUsd`, `approveForwardCostUsd`, `approveMirrorCostUsd`, `childText?`
  - `forwardDecisions[]` / `mirrorDecisions[]` shape: `{ groupNumber, decision, reason, redundancy_violation?, flow_violation?, length_violation? }`
  - `ranking` sub-object (reused), `surfaced`, `discardReason`, `totalCost`, etc.
  - `mirrorAgreementRate: z.number().min(0).max(1).optional()`
  - `mirrorAbortReason: z.enum(['a_prime_format_invalid', 'mirror_parse_null']).optional()`
- [ ] Add both to `agentExecutionDetailSchema` discriminated union (line 1565-1583).

#### 1.6 — `EditingReviewDecision` schema extension
- [ ] `evolution/src/lib/types.ts:219` — extend with optional fields (backward-compatible):
  ```typescript
  EditingReviewDecision {
    groupNumber, decision, reason,
    redundancy_violation?: boolean,
    flow_violation?: boolean,
    length_violation?: boolean,
  }
  ```

#### 1.7 — Metric registry + propagation
- [ ] `evolution/src/lib/metrics/registry.ts` — add to `run.duringExecution`:
  - `proposer_approver_criteria_cost` (live write, `compute: () => 0`).
- [ ] Same file, `SHARED_PROPAGATION_DEFS` — add:
  - `total_proposer_approver_criteria_cost` (sum, `listView: true`)
  - `avg_proposer_approver_criteria_cost_per_run` (avg)
- [ ] `evolution/src/lib/metrics/computations/criteriaMetrics.ts:118` — change hardcoded `agent_name` filter from a single value to `.in([3 criteria-based agent types])` so `avg_score` aggregates across all three.
- [ ] (Optional, deferred) Add criteria-entity-level `total_proposer_approver_criteria_cost` propagation. Skip for V1 — surface on the run/strategy/experiment level only.

#### 1.8 — Cost estimator
- [ ] `evolution/src/lib/pipeline/infra/estimateCosts.ts` (after line 416) — add `estimateProposerApproverCriteriaCost(...)` returning `{ expected, upperBound, expectedRanking, upperBoundRanking }`. 5 layers: eval (reuse `estimateEvaluateAndSuggestCost`) + propose (extract internal `estimateEditingProposeCost` if not already exported) + forward approve + [mirror approve if `includesMirrorApprover`] + ranking. 1.3× upper-bound margin.
- [ ] `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts:97-112` — extend `EstPerAgentValue` with optional `proposerApproverCriteria: { evaluation, propose, approveForward, approveMirror, ranking, total }` peer field.
- [ ] Same file, `IterationPlanEntry.agentType` union (line 134) — add 2 new types.
- [ ] Same file (around line 431+) — add 2 new `if (iterCfg.agentType === ...)` branches:
  - Single-pass: same path as `criteria_and_generate` but with seedChars+200 to capture guardrail prompt overhead.
  - Propose/approve: new branch calling `estimateProposerApproverCriteriaCost`.
- [ ] `DispatchPlanOptions` extension — add `singlePassCriteriaEnabled`, `proposerApproverCriteriaEnabled`, `proposerApproverCriteriaRankEnabled`. Threaded from `getStrategyDispatchPreviewAction` after env-var resolution (mirrors `editingRankEnabled` pattern).

#### 1.9 — Phase 1 unit tests
- [ ] Extend `evolution/src/lib/schemas.test.ts`:
  - Enum extension: 2 new agentType values accepted.
  - Refines: lengthCapRatio rejected on non-propose/approve types; criteriaIds required on all 3 criteria-based types; editingMaxCycles===1 enforced for proposer_approver.
  - Helpers: `canBeFirstIteration` returns true for the 2 new types.
- [ ] Extend `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`: hash includes new fields; label generation includes new agent type counts.
- [ ] Extend `evolution/src/services/strategyRegistryActions.test.ts`: `validateCriteriaIds` runs across all 3 criteria-based types.
- [ ] Run `npm run lint` + `npm run tsc` + relevant unit tests after Phase 1 to confirm no regressions.

---

### Phase 2: Single-Pass Agent (`single_pass_evaluate_criteria_and_generate`)

Ships the simpler of the two new agents. Delivers the "guardrails-only" hypothesis the user can A/B against the existing wrapper.

#### 2.1 — Wrapper class
- [ ] Create `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.ts`:
  - Mirrors structure of `evaluateCriteriaThenGenerateFromPreviousArticle.ts`.
  - Class: `SinglePassEvaluateCriteriaAndGenerateAgent` with `name = 'single_pass_evaluate_criteria_and_generate'`, `usesLLM = true`.
  - `getAttributionDimension(detail) → detail.weakestCriteriaNames[0]` (same as existing wrapper).
  - **Reuse imports** from existing wrapper: `buildEvaluateAndSuggestPrompt`, `parseEvaluateAndSuggest`, `getCriteriaForEvaluation`. Both files import from a shared module if needed.
  - **Inner GFPA dispatch** uses `tactic: 'criteria_driven_single_pass'` (NEW marker) instead of legacy `'criteria_driven'`.
  - Honor invariants I1/I2/I3 from `IterativeEditingAgent` pattern (use `input.llm` directly; cost snapshot before each call; partial detail before re-throw).

#### 2.2 — Updated `customPrompt` template (3 new directives)
- [ ] Create or extend `buildSinglePassCustomPromptFromSuggestions(suggestions, criteria, opts?)` in the new wrapper file. Output template:
  ```
  Preamble: "You are an expert article reviser focusing on these specific issues identified during evaluation."
  
  Instructions:
    "Apply these specific fixes to the article:
     [per-suggestion blocks]
     
     **Length** — Preserve the original word count within ±10%. Refactor or deepen existing passages rather than adding new sections or examples.
     
     **Redundancy** — Avoid introducing ideas, phrasing, or examples that already appear elsewhere in the article. Each fix should add or strengthen distinct content, not duplicate what's already there.
     
     **Flow** — Preserve transitions between paragraphs. Do not delete or replace transition phrases at paragraph starts (e.g., 'However,' 'Therefore,' 'In contrast,'). Maintain local sentence rhythm and section-to-section connective tissue.
     
     Do not introduce meta-commentary about the article itself."
  ```
  Verbatim text matters — tests will assert presence.
- [ ] **Note**: existing wrapper's customPrompt template stays unchanged (Option B coexist — no behavior change to legacy agent).

#### 2.3 — Guardrail telemetry (single-pass observational only)
- [ ] After GFPA returns generated text, compute `lengthCapHit = (newText.length / parentText.length) > 1.10` and persist to `execution_detail.guardrails.lengthCapHit`.
- [ ] `redundancyDropCount` and `flowDropCount` always 0 for single-pass (no edit groups). Schema validates as 0; UI renders as `—` for clarity.

#### 2.4 — Dispatch branch
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts:341` — extend the variant-producing condition to include `'single_pass_evaluate_criteria_and_generate'`. The dispatch path mirrors `'criteria_and_generate'` (pre-fetch criteria once, instantiate the new wrapper, parallel batch + top-up + merge).
- [ ] Honor `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED` env var: when `'false'`, fall back to dispatching `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (the legacy wrapper) — log warn at iteration start.

#### 2.5 — `agentRegistry.ts` registration
- [ ] `evolution/src/lib/core/agentRegistry.ts` — register `SinglePassEvaluateCriteriaAndGenerateAgent` in `getAgentClasses()` so its `invocationMetrics` (none today, but reserved) merge into `InvocationEntity`.
- [ ] Side-effect register attribution extractor in the new wrapper file: `registerAttributionExtractor('single_pass_evaluate_criteria_and_generate', (detail) => detail.weakestCriteriaNames?.[0] ?? null)`.
- [ ] Add to barrel `evolution/src/lib/core/agents/index.ts` for eager-import side-effect.

#### 2.6 — `detailViewConfigs.ts` + invocation page
- [ ] `evolution/src/lib/core/detailViewConfigs.ts` — add `single_pass_evaluate_criteria_and_generate` entry as near-clone of existing wrapper's, with addition of `guardrails: { redundancyDropCount, flowDropCount, lengthCapHit }` object.
- [ ] `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — extend `buildTabs` with the 5-tab layout (`Eval & Suggest`, `Generation`, `Metrics`, `Timeline`, `Logs`) — clone the `evaluate_criteria_then_generate_from_previous_article` branch.
- [ ] Timeline color reuse: emerald (`EVALUATE_AND_SUGGEST_COLOR`) + blue (`GENERATION_COLOR`) + purple (`RANKING_COLOR`) — no new constants.

#### 2.7 — Wizard UI (single-pass conditional render)
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`:
  - Per-iteration agent-type select (lines 975-986): add option `<option value="single_pass_evaluate_criteria_and_generate">Single-pass criteria w/ guardrails</option>`.
  - `IterationRow` type (line 37): extend with new fields.
  - Insert conditional render block after line 1205: CriteriaMultiSelect (reuse), weakestK numeric input (reuse), `redundancyJaccardThreshold` numeric input (default 0.35).
  - `updateIteration` callback (lines 473-522): add field-clearing branch for the new type.
  - `canBeFirstIteration` + `isVariantProducing` + `toIterationConfigsPayload`: include the new type.
  - Budget bar color (line 1230): cyan (`bg-cyan-500`) for single-pass; legend entry.
  - `iterationErrors` validation: extend criteria-required check to all 3 criteria-based types.

#### 2.8 — Phase 2 unit tests
- [ ] Create `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.test.ts` (~15 tests): combined LLM call invocation; weakest-K determination; effectiveWeakestK clamping; parser drops + droppedSuggestions populated; customPrompt construction; **3 new directive verbatim-presence tests** (length / redundancy / flow); GFPA delegation via `.execute()`; cost-tracking via `getOwnSpent()`; error path preserves partial detail; lengthCapHit telemetry computed correctly post-generation; `tactic` set to `'criteria_driven_single_pass'`; misconfig guard accepts new tactic.

---

### Phase 3: Mirror + Guardrails Toolkit

Reusable primitives for the propose/approve agent (Phase 4). Ships independently — no agent uses them yet, but they're tested.

#### 3.1 — `mirrorEdits.ts` helpers
- [ ] Create `evolution/src/lib/core/agents/editing/mirrorEdits.ts` with:
  - `invertAtomicEdit(edit: EditingAtomicEdit, articleAfterApply: string): EditingAtomicEdit` — flips `kind`, swaps `oldText` ↔ `newText`, recomputes `range` in post-apply coordinates, recaptures `contextBefore`/`contextAfter` from `articleAfterApply`.
  - `constructMirrorGroup(group: EditingGroup, originalArticle: string, resultingArticle: string): EditingGroup` — applies group to `originalArticle` to get `resultingArticle`, then maps each atomic edit through `invertAtomicEdit` with offset arithmetic to track position drift.
  - `roundTripApply(group: EditingGroup, article: string): { success: boolean; finalText: string; failureReason?: string }` — verification helper for tests + runtime A' format gate.
  - `renderMirrorMarkup(originalArticle: string, forwardGroups: EditingGroup[]): { mirrorArticleA: string; mirrorMarkupString: string; mirrorGroups: EditingGroup[] }` — top-level helper used by the agent.
- [ ] Internal `spliceString(text, start, deleteCount, insertText)` utility.

#### 3.2 — `checkSemanticOverlap.ts` (redundancy guardrail)
- [ ] Create `evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts`:
  - `extractTrigrams(text: string): Set<string>` — tokenize on whitespace, lowercase, build word-level trigram set.
  - `jaccardSimilarity(setA: Set<string>, setB: Set<string>): number` — `|A ∩ B| / |A ∪ B|`.
  - `checkSemanticOverlap(newText: string, articleText: string, oldRange: {start, end}, threshold: number = 0.35): { overlap: number; exceeds: boolean }`.
  - Edge cases: empty newText (return `{overlap: 0, exceeds: false}`), very short text (< 3 words, no trigrams → return 0).

#### 3.3 — Extend `validateEditGroups.ts`
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — extend signature with optional parameters:
  ```typescript
  validateEditGroups(
    groups: EditingGroup[],
    currentText: string,
    opts?: {
      lengthCapRatio?: number;            // default SIZE_RATIO_HARD_CAP (1.5)
      redundancyJaccardThreshold?: number; // default 0.35; null/undefined disables check
      flowGuardrailEnabled?: boolean;      // default true
    },
  ): ValidateResult
  ```
- [ ] Add new transition-word regex hard rule:
  ```typescript
  RE_TRANSITION_START = /^(However|Therefore|Thus|Moreover|Furthermore|In contrast|Similarly|Conversely|Nevertheless|Specifically|For example|In other words|As a result|Ultimately),?\s/i
  ```
  Reject groups whose `oldText` (when range immediately follows `\n`) matches AND newText doesn't preserve the transition. Drop reason: `flow_transition_violation`.
- [ ] Add semantic-overlap check call site (per-group). Drop reason: `semantic_overlap_with_existing_content`.
- [ ] Make size-ratio check parameterized by `opts.lengthCapRatio` (default unchanged at 1.5 for `IterativeEditingAgent` callers; new agent passes 1.10).
- [ ] Update existing call site in `IterativeEditingAgent.ts:~293` to pass `opts: {}` (preserves existing 1.5× behavior).
- [ ] New `evolution/src/lib/core/agents/editing/constants.ts` constant: `DEFAULT_LENGTH_CAP_RATIO = 1.10`.

#### 3.4 — Phase 3 unit tests
- [ ] Create `evolution/src/lib/core/agents/editing/mirrorEdits.test.ts` (~8 tests):
  - `invertAtomicEdit`: insert→delete, delete→insert, replace→reverse-replace.
  - `constructMirrorGroup`: range arithmetic with single edit, 2-edit group, 3-edit group; positions correctly recomputed.
  - `roundTripApply`: forward → mirror → forward yields original (idempotency).
  - `renderMirrorMarkup`: produces valid CriticMarkup that re-parses to equivalent groups.
- [ ] Create `evolution/src/lib/core/agents/editing/mirrorEdits.property.test.ts` with `fast-check`:
  - Round-trip idempotency: ∀(text, edits). `applyEdits(invertEdits(applyEdits(edits, text))) === text`.
  - Double-inversion identity: ∀(edit). `invertAtomicEdit(invertAtomicEdit(e)) === e`.
  - Range boundaries: ∀(edits, text). inverted ranges all ∈ `[0, articleAfterApply.length]`.
  - Context capture: `contextBefore.length <= 30 && contextAfter.length <= 30`.
- [ ] Create `evolution/src/lib/core/agents/editing/checkSemanticOverlap.test.ts` (~3 tests): identical text → 1.0; disjoint text → 0.0; edge cases (empty newText, very short oldText, threshold straddling).
- [ ] Extend `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` (~4 tests): transition-word rule (paragraph-start delete vs preserved); `lengthCapRatio` parameterization (1.0, 1.05, 1.10); semantic overlap rejection at 0.5 (above 0.35 default); existing 1.5× behavior preserved when no opts passed.

---

### Phase 4: Propose/Approve Agent (`proposer_approver_criteria_generate`)

The headline agent — single-cycle propose / forward-approve / mirror-approve / apply.

#### 4.1 — Wrapper class
- [ ] Create `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts`:
  - Class: `ProposerApproverCriteriaGenerateAgent` with `name = 'proposer_approver_criteria_generate'`, `usesLLM = true`.
  - `getAttributionDimension(detail) → detail.weakestCriteriaNames[0]`.
  - **Algorithm** (single-cycle):
    1. Run combined `evaluate_and_suggest` LLM call (reuse existing wrapper's prompt builder + parser).
    2. Build proposer prompt with criteria + evaluation context + current article. LLM call labeled `'criteria_proposer'`.
    3. `parseProposedEdits(proposerOutput)` → `EditingGroup[]`.
    4. `checkProposerDrift` — if major drift: abort with `proposer_drift_unrecoverable`. (No drift recovery layer for V1 — the user's spec is single-cycle and we can revisit if drift rates are high.)
    5. `validateEditGroups(groups, currentText, { lengthCapRatio: iterCfg.lengthCapRatio ?? 1.10, redundancyJaccardThreshold: iterCfg.redundancyJaccardThreshold ?? 0.35, flowGuardrailEnabled: true })`.
    6. **Forward approver**: build approver prompt (article + edit-group summary + criteria + evaluation context). LLM call labeled `'criteria_forward_approver'`.
    7. **If `iterCfg.includesMirrorApprover` (default true)**:
       - Compute `articleA' = applyAcceptedGroups(forward-accepted groups, currentText)` for the mirror's article basis.
       - Run `validateFormat(A')` — if A' fails format: set `mirrorAbortReason = 'a_prime_format_invalid'`, skip mirror, fall through to forward-only decision (confidence 0.6 — drop unless critical).
       - `renderMirrorMarkup(currentText, forwardAcceptedGroups) → { mirrorArticleA', mirrorMarkupString, mirrorGroups }`.
       - Build mirror approver prompt (mirror article + mirror edit groups + same criteria + evaluation). LLM call labeled `'criteria_mirror_approver'`.
       - `parseReviewDecisions(mirrorOutput) → mirrorDecisions[]`. If parse fails: set `mirrorAbortReason = 'mirror_parse_null'`, fall through.
       - **Aggregate**: per group, apply iff `(forwardDecision, mirrorDecision) === ('accept', 'reject')`. All other combinations drop (including any null mirror decision when mirror succeeded).
    8. **If mirror disabled**: apply forward-accepted groups directly (no mirror gate).
    9. `applyAcceptedGroups(finalAcceptedGroups, currentText)` — right-to-left splice; emit final `Variant`.
    10. **Step 5 — Post-cycle ranking** (reuse `IterativeEditingAgent`'s pattern, gated by `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED`): run `rankNewVariant(finalVariant, ...)` against the deep-cloned local snapshot. Surface/discard mirrors GFPA: discard if `rankResult.status === 'budget' AND localElo < computeTop15Cutoff(localRatings)`.
- [ ] Honor invariants I1, I2, I3:
  - I1: all LLM calls use `input.llm` directly.
  - I2: `costBefore*` snapshots captured before each helper call (`costBeforeProposeCall`, `costBeforeForwardApprove`, `costBeforeMirrorApprove`).
  - I3: write partial `execution_detail` (with whatever's been computed) BEFORE re-throwing on any helper failure.

#### 4.2 — Proposer + approver prompt builders
- [ ] Create `evolution/src/lib/core/agents/proposerApproverCriteriaPrompts.ts`:
  - `buildProposerPrompt(article, criteria, evaluation, suggestions, opts)`:
    - System prompt: existing CriticMarkup conventions + soft rules (preserve quotes/citations/URLs, no new headings, prefer one-sentence edits, no edits in code blocks, preserve voice/tone) **+ 3 new soft rules**:
      - "Avoid edits whose newText reiterates ideas, phrases, or arguments already present elsewhere in the article. Each edit should introduce or strengthen a distinct idea, not duplicate existing content."
      - "Preserve transition phrases and connective words at paragraph boundaries; do not delete or replace opening transitions like 'However,' 'Therefore,' or 'In contrast.'"
      - "Keep edits concise; aim to preserve article length within ±10% of the original."
    - User prompt: criteria block + evaluation results (criteria scored + suggestions for weakest-K) + article body. Tells the LLM: "Address the WEAKEST CRITERIA listed above by editing the article inline using CriticMarkup syntax."
  - `buildForwardApproverPrompt(markedUpArticle, edges, criteria, evaluation)`:
    - System prompt: conservative-review preamble + **NEW guardrail rubric** (per-edit reject criteria for redundancy / flow / length).
    - User prompt: marked-up article + per-group summary + criteria block + evaluation results.
    - Output format: JSONL with `{groupNumber, decision, reason, redundancy_violation?, flow_violation?, length_violation?}`.
  - `buildMirrorApproverPrompt(mirrorArticle, mirrorEdges, criteria, evaluation)`:
    - **Same** as forward but with explicit framing: "These edits revert from the proposed end-state back to the original. Reject edits that should be applied (i.e., the proposed end-state should be preserved)."
    - Aim: the LLM understands mirror direction so its judgment is calibrated.

#### 4.3 — Dispatch branch
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — add new `else if (iterType === 'proposer_approver_criteria_generate')` branch (after the `iterative_editing` branch, around line 786+). Mirrors editing dispatch shape: per-parent dispatch via `Promise.allSettled`, no parallel batch / top-up loop, post-dispatch merge.
- [ ] Per-iteration `getCriteriaForEvaluation(db, criteriaIds, logger)` once before per-parent dispatch (same pattern as criteria_and_generate).
- [ ] `effectiveWeakestK = min(weakestK, criteria.length)` clamping with warn-log.
- [ ] Honor `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED` env var: when `'false'`, log warn + treat iteration as zero-variants (no fallback).
- [ ] Honor `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED` env var: when `'false'`, omit rank-context fields from agent input (variant lands at default Elo).

#### 4.4 — Operational metrics
- [ ] `evolution/src/lib/metrics/registry.ts` — add 3 new run-level operational metrics:
  - `proposer_approver_drift_rate` (fraction of cycles with proposer drift).
  - `proposer_approver_accept_rate` (fraction of edits forward-approver accepted).
  - `proposer_approver_mirror_agreement_rate` (= `appliedGroups / approverGroups`).
- [ ] Env-tunable alert thresholds (mirror `iterative_edit_*_ALERT_THRESHOLD` pattern):
  - `EVOLUTION_PROPOSER_APPROVER_DRIFT_RATE_ALERT_THRESHOLD` (default `'0.30'`)
  - `EVOLUTION_PROPOSER_APPROVER_ACCEPT_RATE_ALERT_THRESHOLD` (default `'0.95'`)
  - `EVOLUTION_PROPOSER_APPROVER_CRITERIA_MIRROR_AGREEMENT_LOW_THRESHOLD` (default `'0.20'`)
  - `EVOLUTION_PROPOSER_APPROVER_CRITERIA_MIRROR_AGREEMENT_HIGH_THRESHOLD` (default `'0.95'`)

#### 4.5 — `agentRegistry.ts` registration
- [ ] Register `ProposerApproverCriteriaGenerateAgent` in `getAgentClasses()`.
- [ ] Side-effect register attribution extractor.
- [ ] Add to barrel `evolution/src/lib/core/agents/index.ts`.

#### 4.6 — `detailViewConfigs.ts` + invocation page
- [ ] Add `proposer_approver_criteria_generate` entry to `detailViewConfigs.ts`. Field paths use `cycles.0.<field>` to match `IterativeEditingAgent`'s array shape.
- [ ] `InvocationDetailContent.tsx` — extend `buildTabs` with **8-tab** layout:
  1. Eval & Suggest
  2. Proposer
  3. Approver (Forward)
  4. Approver (Mirror)
  5. Apply
  6. Metrics
  7. Timeline
  8. Logs
- [ ] Tabs use `keyFilter` mechanic to slice fields (e.g., Approver Forward keeps `cycles.0.forwardDecisions`, Mirror keeps `cycles.0.mirrorDecisions`).
- [ ] `InvocationTimelineTab.tsx` — extend with new 5-segment phase bar:
  - Emerald (eval & suggest, reused `EVALUATE_AND_SUGGEST_COLOR`).
  - Blue (proposer, reused `GENERATION_COLOR`).
  - Orange `#f97316` (forward approver) — NEW constant `CRITERIA_APPROVER_FORWARD_COLOR`.
  - Deep orange `#ea580c` (mirror approver) — NEW constant `CRITERIA_APPROVER_MIRROR_COLOR`.
  - Purple (ranking, reused `RANKING_COLOR`).

#### 4.7 — Wizard UI (propose/approve conditional render)
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`:
  - Per-iteration agent-type select: add `<option value="proposer_approver_criteria_generate">Proposer-approver criteria w/ mirror</option>`.
  - Conditional render block: CriteriaMultiSelect + weakestK + editingModel + approverModel + `lengthCapRatio` numeric input (default 1.10) + `redundancyJaccardThreshold` numeric input (default 0.35) + `includesMirrorApprover` checkbox (default true).
  - `editingMaxCycles` rendered as read-only "1 cycle (single-pass fixed)".
  - `updateIteration` callback: add field-clearing branch.
  - Budget bar color: purple (`bg-purple-500`); legend entry.
  - `iterationErrors`: validate criteria-required.

#### 4.8 — Phase 4 unit tests
- [ ] Create `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.test.ts` (~35 tests):
  - **Core cycle (12 tests)**: happy path; proposer drift major → abort; approver JSONL parse error → default reject; pre-approver hard-rule drops; size-cap enforcement at 1.10×; right-to-left applier; context-failsafe drops; format-validation failures; cost tracking per phase; criteria propagation through cycle.
  - **Mirror protocol (10 tests)**: insert→delete inversion; delete→insert; replace→reverse-replace; position drift recomputation; A' construction matches forward applier output; aggregator rule (apply iff (ACCEPT, REJECT)) — all 4 combinations tested; mirror parse null fallback; A' format-validation gate.
  - **Parser edge cases (8 tests)**: covered by reused `parseProposedEdits.test.ts`; this file tests integration only.
  - **Applier specifics (5 tests)**: covered by reused `applyAcceptedGroups.test.ts`; this file tests cycle-level aggregation.
- [ ] Mock LLM strategy: extend `evolution/src/testing/v2MockLlm.ts` to support label-based response routing (`labelResponses: { criteria_proposer: '...', criteria_forward_approver: '...', criteria_mirror_approver: '...' }`). Update existing mock helpers + their consumers if needed.

---

### Phase 5: Wizard, Dispatch Preview, Strategy Registry Polish

Cross-cutting UI/preview/registry adjustments to round out both new agents.

#### 5.1 — `DispatchPlanView` extensions
- [ ] `evolution/src/components/evolution/DispatchPlanView.tsx` — extend agent-type badge logic (lines 129-137) with cyan single-pass + purple propose/approve.
- [ ] Cost-by-Agent breakdown rendering: when entry has `proposerApproverCriteria` field, show `eval $X + propose $Y + approve(F/M) $Z + rank $W = $total`.
- [ ] Confirm rendering test: `entry.estPerAgent.expected.total` already used directly — no hardcoded field list needed.

#### 5.2 — Wizard validation polish
- [ ] `src/app/admin/evolution/strategies/new/page.tsx` — ensure `iterationErrors` memo's criteria-required check spans all 3 criteria-based agent types.
- [ ] Confirm `validateCriteriaIds` server-side check (in `createStrategyAction`) also includes the 3 types.
- [ ] Add wizard validation: if `agentType === 'proposer_approver_criteria_generate'` AND `editingMaxCycles` is anything other than 1 OR undefined → reject with helpful message.

#### 5.3 — Strategy hash + label generation
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:canonicalizeIterationConfig` — emit new fields (`lengthCapRatio`, `redundancyJaccardThreshold`, `includesMirrorApprover`) when present, gated by agent type to avoid hash drift on inapplicable iterations.
- [ ] `labelStrategyConfig` — add `Nx single-pass-criteria` and `Mx proposer-approver` to the iteration summary. Examples:
  - `Gen: 4.1-mini | Judge: 4.1-mini | 1×single-pass-criteria + 1×swiss`
  - `Gen: 4.1-mini | Judge: 4.1-mini | 1×proposer-approver + 1×swiss | Budget: $0.05`

#### 5.4 — Phase 5 unit tests
- [ ] Wizard tests in `src/app/admin/evolution/_components/StrategyForm.test.tsx` (or equivalent): conditional render of new fields per agent type; field-clearing on agent-type switch; validation errors for missing criteria.
- [ ] `findOrCreateStrategy.test.ts` extension: hash includes new fields; label generation handles new agent types.

---

### Phase 6: Documentation

Surgical edits to 11 existing docs + 1 new deep dive.

#### 6.1 — Existing docs (surgical edits)
- [ ] `evolution/docs/architecture.md`:
  - § Agent Types — add paragraph for both new wrappers.
  - § Criteria-driven generation — extend with single-pass + propose/approve overview; link to new deep dive.
- [ ] `evolution/docs/agents/overview.md`:
  - § V2 Config-Driven Iteration Loop — extend agent-type enum.
  - Add new section after `EvaluateCriteriaThenGenerate...` for each new agent (class name, contract, invariants, attribution dimension, kill switches).
- [ ] `evolution/docs/strategies_and_experiments.md` — § IterationConfig: extend agentType enum + new field docs (`lengthCapRatio`, `redundancyJaccardThreshold`, `includesMirrorApprover`).
- [ ] `evolution/docs/cost_optimization.md` — § Per-purpose cost split + new "Proposer-Approver Criteria Cost" subsection (5-layer breakdown: eval + propose + approve forward + approve mirror + ranking).
- [ ] `evolution/docs/data_model.md` — confirm `criteria_set_used` / `weakest_criteria_ids` apply to new agents (mostly unchanged); glossary additions if introducing terminology.
- [ ] `evolution/docs/metrics.md` — § Run Metrics + § Strategy/Experiment Metrics: add `proposer_approver_criteria_cost` + propagation rows; add the 3 operational metrics.
- [ ] `evolution/docs/visualization.md` — § Timeline tab + § Invocation detail page: new badges, 5-tab and 8-tab layouts, color constants.
- [ ] `evolution/docs/reference.md` — § Configuration EvolutionConfig Validation (enum extension); § Environment Variables; § Kill Switches table (6 new env vars + 3 alert-threshold env vars).
- [ ] `evolution/docs/multi_iteration_strategies.md` — § IterationConfig Schema (enum + new fields).
- [ ] `evolution/docs/curriculum.md` — § Glossary: add "Mirror Approver", "Redundancy Guardrail", "Flow Guardrail", "Length Cap Ratio".
- [ ] `evolution/docs/editing_agents.md` — add cross-reference link to new deep dive (no content changes).

#### 6.2 — New deep dive
- [ ] Create `evolution/docs/criteria_agents.md` (~300-500 lines):
  - Overview: single-pass vs propose/approve; when to use each.
  - Algorithm (per cycle): propose → pre-check → forward approver → mirror approver → applier.
  - Mirror-approver protocol detail with diagrams and worked examples (insert / delete / replace mirroring).
  - Configuration: per-iteration fields, strategy-level model fields.
  - Guardrails: redundancy (trigram Jaccard), flow (transition regex + approver rubric), length (1.10× cap).
  - Cost tracking: per-cycle split.
  - Operational metrics: `mirrorAgreementRate`, drift telemetry, alert thresholds.
  - Kill switches: 6 env vars + 4 alert-threshold env vars.
  - Files: code reference index.

#### 6.3 — Doc-mapping updates
- [ ] `.claude/doc-mapping.json` — add entries for the new deep dive.

---

### Phase 7: Staging Validation

Real runs to confirm guardrails reduce variance + propose/approve agent's mirror filter actually filters bad edits.

- [ ] Trigger 5 staging runs with `single_pass_evaluate_criteria_and_generate` on the Federal Reserve prompt (same prompt used by prior project).
- [ ] Trigger 5 staging runs with `proposer_approver_criteria_generate` on the same prompt.
- [ ] Trigger 5 baseline staging runs with the legacy `criteria_and_generate` for direct A/B comparison.
- [ ] Analyze:
  - Mean Elo Δ vs `generate_from_previous_article` baseline for each agent type.
  - Length distribution: does single-pass tighten? Does propose/approve tighten further?
  - `mirrorAgreementRate` distribution — is it within `[0.20, 0.95]` thresholds?
  - Sentence-level diff per agent.
  - Spot-check 3 winners + 3 losers per agent type.
- [ ] Update `_progress.md` with findings.

---

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` — extension (~5 new cases for enum + refines + helpers).
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — extension (~3 new cases for hash + label).
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — extension (~2 new cases for `validateCriteriaIds` across 3 types).
- [ ] `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.test.ts` — NEW (~15 cases).
- [ ] `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.test.ts` — NEW (~35 cases).
- [ ] `evolution/src/lib/core/agents/editing/mirrorEdits.test.ts` — NEW (~8 cases).
- [ ] `evolution/src/lib/core/agents/editing/mirrorEdits.property.test.ts` — NEW (4 property invariants × ~200 fast-check iterations each).
- [ ] `evolution/src/lib/core/agents/editing/checkSemanticOverlap.test.ts` — NEW (~3 cases).
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — extension (~4 cases for new transition rule + parameterized lengthCapRatio + semantic overlap).
- [ ] `src/app/admin/evolution/_components/StrategyForm.test.tsx` (or equivalent) — extension (~4 cases for conditional renders + validation).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-single-pass-criteria.integration.test.ts` — NEW (~4 cases): full-pipeline run; metrics rows present; lengthCapHit telemetry; `tactic = 'criteria_driven_single_pass'`; cost breakdown.
- [ ] `src/__tests__/integration/evolution-proposer-approver-criteria.integration.test.ts` — NEW (~4 cases): full-pipeline run; mirror-approver decisions land in execution_detail; mirrorAgreementRate computed; per-purpose cost split (propose / forward / mirror) attributed correctly; ranking step gated by `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED`.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — extend (~2 new cases): create strategy with single-pass criteria; create strategy with propose/approve criteria. Verify field visibility (`lengthCapRatio` only for propose/approve, etc.).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-single-pass.spec.ts` — NEW (~3 cases): run a seeded strategy with single-pass agent; navigate run detail; verify variant detail shows `tactic: criteria_driven_single_pass`.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-proposer-approver.spec.ts` — NEW (~3 cases): run a seeded strategy with propose/approve agent; navigate the 8-tab invocation page; verify mirror-approver decisions render; verify cost breakdown.

### Manual Verification
- [ ] Wizard flow end-to-end: create strategy with each new agent type, save, run.
- [ ] Run detail Timeline tab shows correct iteration cards with new agent badges.
- [ ] Invocation detail Eval & Suggest tab renders criteria scored + suggestions.
- [ ] Propose/approve invocation detail: all 8 tabs render without errors; Approver Forward + Mirror tabs show paired decisions; Timeline shows 5-segment bar.
- [ ] Tactic leaderboard at `/admin/evolution/tactics` shows `criteria_driven_single_pass` and `criteria_driven_propose_approve` rows with metrics.
- [ ] Cost dashboard shows new `proposer_approver_criteria_cost` column.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `admin-strategy-wizard.spec.ts` — extended; verifies wizard new fields + dispatch preview + create.
- [ ] `admin-evolution-run-single-pass.spec.ts` — verifies single-pass run produces variants and detail UI renders.
- [ ] `admin-evolution-run-proposer-approver.spec.ts` — verifies propose/approve run produces variants, 8-tab invocation page renders, mirror-approver decisions visible, cost breakdown correct.
- [ ] Manual headless playwright session: navigate wizard → create both new strategies → run on a seeded prompt → check tactic leaderboard, cost estimates, lineage graph.

### B) Automated Tests
- [ ] `cd evolution && npx vitest run` — all evolution unit tests pass.
- [ ] `npm run test:integration -- --testPathPattern="evolution"` — integration tests pass (requires local DB with cost-calibration migration applied).
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — wizard E2E pass.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-single-pass.spec.ts` — single-pass E2E pass.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-proposer-approver.spec.ts` — propose/approve E2E pass.
- [ ] `npm run lint` — no new warnings.
- [ ] `npm run tsc` — clean.
- [ ] `npm run build` — clean.

## Documentation Updates
- [ ] `evolution/docs/architecture.md` — Agent Types + Criteria-driven generation sections.
- [ ] `evolution/docs/agents/overview.md` — new sections per agent.
- [ ] `evolution/docs/strategies_and_experiments.md` — IterationConfig schema + new fields.
- [ ] `evolution/docs/cost_optimization.md` — new cost subsection.
- [ ] `evolution/docs/data_model.md` — glossary + column applicability.
- [ ] `evolution/docs/metrics.md` — new metric rows + operational metrics.
- [ ] `evolution/docs/visualization.md` — Timeline + invocation page.
- [ ] `evolution/docs/reference.md` — config validation + env vars + kill switches.
- [ ] `evolution/docs/multi_iteration_strategies.md` — schema extension.
- [ ] `evolution/docs/curriculum.md` — glossary additions.
- [ ] `evolution/docs/editing_agents.md` — cross-reference link.
- [ ] `evolution/docs/criteria_agents.md` — NEW deep dive.
- [ ] `.claude/doc-mapping.json` — new entries.

## Review & Discussion
TBD — populated by `/plan-review`.
