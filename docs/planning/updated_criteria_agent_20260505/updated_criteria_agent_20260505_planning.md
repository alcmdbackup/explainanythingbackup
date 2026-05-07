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
  - `ADD CONSTRAINT evolution_cost_calibration_phase_allowed CHECK (phase IN (...all existing 8 from 20260501204142...,  'evaluate_and_suggest', 'criteria_proposer', 'criteria_forward_approver', 'criteria_mirror_approver'))`
  - **Note**: must explicitly include `'evaluate_and_suggest'` even though the prior migration's CHECK didn't — the existing TS code references it (`costCalibrationLoader.ts:30`, `estimateCosts.ts:186`). Today the constraint is broken for that phase; this migration fixes both that pre-existing gap AND adds the 3 new propose/approve labels.
  - Header comment block: "Forward-only. Rollback post-code-deploy is flag-only via `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED='false'`. To rollback the schema, restore the prior 8-phase CHECK constraint AFTER reverting code references."
- [ ] **Extend ALL THREE TS phase-enum sources** (NOT just the loader):
  - `evolution/src/lib/core/startupAssertions.ts` — both `TS_PHASES_REFRESH_CALIBRATION` AND `TS_PHASES_CALIBRATION_LOADER` sets (lines 19-42) extended with `criteria_proposer`, `criteria_forward_approver`, `criteria_mirror_approver`. Without this, `assertCostCalibrationPhaseEnumsMatch` will fail on first run after deploy.
  - `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts:24-33` — `CalibrationRow.phase` union extended with the same 3 labels.
  - `evolution/scripts/refreshCostCalibration.ts:35` — `Phase` union also extended (the daily refresh script must accept the new labels when aggregating from `evolution_agent_invocations.execution_detail`).
- [ ] Apply locally (`supabase db reset` or `supabase migration up --local`).
- [ ] **Migration ordering for production deploy**: DB migration MUST be applied BEFORE code deploy. The CI `deploy-migrations` job applies migrations to staging automatically; for production, follow the standard mainToProd flow. If code ships first, `assertCostCalibrationPhaseEnumsMatch` throws `MissingMigrationError` at agent-registry init and blocks startup.
- [ ] Verify `assertCostCalibrationPhaseEnumsMatch` passes after BOTH the migration applies AND the 3 TS enum extensions land.

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
  - `includesMirrorApprover: z.boolean().optional()` — **runtime defaults to `true` when absent**; only emitted to `config_hash` when explicitly `false` (compact hash for default-on strategies).
  - (Reuse existing `editingModel` / `approverModel` / `editingMaxCycles` / `editingEligibilityCutoff` for `proposer_approver_criteria_generate`.)
- [ ] Add / widen Zod `.refine()` blocks (existing refinements at `schemas.ts:567-591` need explicit widening — the current code strictly gates on single agent types):
  - **WIDEN** existing `criteriaIds` valid-on refine (line 574): from `agentType === 'criteria_and_generate'` to `agentType ∈ {'criteria_and_generate', 'single_pass_evaluate_criteria_and_generate', 'proposer_approver_criteria_generate'}`.
  - **WIDEN** existing `criteriaIds` REQUIRED-on refine (line 591): same 3-type set.
  - **WIDEN** existing `weakestK` valid-on refine (line 580): same 3-type set.
  - **WIDEN** existing `editingMaxCycles` valid-on refine (line 567): from `agentType === 'iterative_editing'` to `agentType ∈ {'iterative_editing', 'proposer_approver_criteria_generate'}`. Without this widening, Zod will reject `editingMaxCycles` on the new agent BEFORE the new "must be 1" refine runs.
  - **WIDEN** existing `editingEligibilityCutoff` valid-on refine (line 571): same `'iterative_editing' || 'proposer_approver_criteria_generate'` set.
  - **NEW** `lengthCapRatio` rejected on agent types other than `proposer_approver_criteria_generate`.
  - **NEW** `redundancyJaccardThreshold` rejected on agent types other than the 2 new criteria-based ones.
  - **NEW** `includesMirrorApprover` rejected on agent types other than `proposer_approver_criteria_generate`.
  - **NEW** `editingMaxCycles === 1` enforced when `agentType === 'proposer_approver_criteria_generate'` (single-cycle invariant). This refine RUNS AFTER the widened valid-on check.
- [ ] Helper updates (lines 484, 492, 500): `canBeFirstIteration`, `isVariantProducingAgentType`, `producesNewVariants` — add the 2 new agent types to all three.
- [ ] `evolution/src/lib/pipeline/infra/types.ts:31` — extend `IterationResult.agentType` union.
- [ ] `evolution/src/services/strategyPreviewActions.ts:168` + 208 — extend `previewDispatchPlanSchema` enum + `IterationPlanEntryClient` union + add 3 new optional fields.
- [ ] `evolution/src/services/strategyRegistryActions.ts:158` — extend `validateCriteriaIds` filter to include all 3 criteria-based types.
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` (lines 50-56, 76-85):
  - **WIDEN** existing `criteriaIds` emit-gate (currently gated `agentType === 'criteria_and_generate'`) to all 3 criteria-based types. Without widening, strategies with the new types canonicalize WITHOUT criteriaIds — different criteria sets would collide on `config_hash`.
  - **WIDEN** existing `weakestK` emit-gate similarly.
  - **NEW** emit-gates for `lengthCapRatio`, `redundancyJaccardThreshold`, `includesMirrorApprover` per Phase 5.3 detail.
  - Extend `labelStrategyConfig` (`Nx single-pass-criteria + Mx proposer-approver`).

#### 1.4b — Sentence-overlap metric (universal, all variant-producing agents)

Adds a per-variant quality signal so researchers can see rewrite-volume distributions per agent and bucket Elo Δ by verbatim-overlap percentile. **Computed for ALL variant-producing agents** (vanilla `generate`, `reflect_and_generate`, legacy `criteria_and_generate`, both new criteria agents, AND `iterative_editing`) so the entire system can be compared on rewrite volume. Pure measurement — no discard, no rejection.

**Architecture: variant-level column, not execution_detail nesting.** Single source of truth, simpler queries, simpler aggregation.

- [ ] **DB migration**: new file `supabase/migrations/{date}_evolution_variants_sentence_verbatim_ratio.sql`:
  ```sql
  ALTER TABLE evolution_variants
    ADD COLUMN sentence_verbatim_ratio NUMERIC;
  -- nullable; legacy variants stay null and are excluded from percentile computations
  ```
- [ ] Extend `Variant` type in `evolution/src/lib/types.ts` with `sentenceVerbatimRatio?: number` (optional for backward compat).
- [ ] Extend `createVariant` factory in `evolution/src/lib/shared/textVariationFactory.ts` to accept the field.
- [ ] Extend `persistRunResults.ts` to write the new column when persisting variants.
- [ ] Extend `getEvolutionVariantsAction` and `listVariantsAction` to SELECT the new column so it's available to the admin UI.

**Agent integration — 3 touchpoints, covers 6 agents via wrapper inheritance:**

- [ ] **`GenerateFromPreviousArticleAgent`** (`evolution/src/lib/core/agents/generateFromPreviousArticle.ts`): after generating child text, compute `sentenceVerbatimRatio` via `sentenceOverlap.sentenceVerbatimOverlap(parentText, generatedText).ratio` and set on the returned `Variant`. Covers vanilla `generate`, `reflect_and_generate` (wrapper inherits), legacy `criteria_and_generate` (wrapper inherits), and new `single_pass_evaluate_criteria_and_generate` (wrapper inherits).
- [ ] **`IterativeEditingAgent`** (`evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`): after `applyAcceptedGroups` produces the final variant text, compute the ratio against the original parent (NOT the cycle-N-1 intermediate) and set on the returned `Variant`.
- [ ] **`ProposerApproverCriteriaGenerateAgent`** (NEW, Phase 4.1 step 9): after applying aggregated edits, compute the ratio against the original parent and set on the returned `Variant`.

**Backward compat**: pre-existing variants have `sentence_verbatim_ratio = NULL`. Metric compute functions filter NULLs from percentile aggregation. UI renders `—` for null. No backfill needed.

**`CreateSeedArticleAgent` and ranking agents**: do not set the field. Seed has no parent; swiss/merge produce no variants.

#### 1.5 — `execution_detail` discriminated-union schemas
- [ ] `evolution/src/lib/schemas.ts` (after line 1414) — add `singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema`:
  - `detailType: z.literal('single_pass_evaluate_criteria_and_generate')`
  - `tactic: z.literal('criteria_driven_single_pass')`
  - `weakestCriteriaIds`, `weakestCriteriaNames`
  - `evaluateAndSuggest` sub-object (same shape as existing wrapper)
  - `generation`, `ranking` sub-objects (reused from GFPA)
  - `surfaced`, `discardReason`, `totalCost`, `estimatedTotalCost`, `estimationErrorPct`
  - `guardrails: { redundancyDropCount: 0, flowDropCount: 0, lengthCapHit: boolean }` — `sentenceVerbatimRatio` lives on `evolution_variants.sentence_verbatim_ratio` column (Phase 1.4b), NOT in execution_detail.
- [ ] Add `proposerApproverCriteriaGenerateExecutionDetailSchema`:
  - `detailType: z.literal('proposer_approver_criteria_generate')`
  - `tactic: z.literal('criteria_driven_propose_approve')`
  - `weakestCriteriaIds`, `weakestCriteriaNames`, `evaluateAndSuggest` sub-object
  - **`cycles: z.array(...).length(1)`** with single entry containing `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `forwardDecisions[]`, `mirrorDecisions[]`, `appliedGroups`, `droppedPostApprover`, `proposeCostUsd`, `approveForwardCostUsd`, `approveMirrorCostUsd`, `childText?` — `sentenceVerbatimRatio` lives on `evolution_variants.sentence_verbatim_ratio` column (Phase 1.4b), NOT in execution_detail.
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
- [ ] **Sentence-overlap metrics** — first-class entries in `evolution/src/lib/metrics/registry.ts`. All `category: 'rating'` (quality signal), `formatter: 'percent'` (renders as e.g. "62%"), `listView: true` for the ones that should surface on entity list pages. **All compute functions read from the new `evolution_variants.sentence_verbatim_ratio` column** (Phase 1.4b), filtering NULLs.

  **Variant-level**: queryable directly via the column. No metric-registry entry needed (consistent with how `evolution_variants.cost_usd` works — column-direct).

  **Run-level** (added to `METRIC_REGISTRY['run'].atFinalization`):
  - `median_sentence_verbatim_ratio` — `{ label: 'Median Sentence Overlap', listView: true, compute: (ctx) => median of evolution_variants.sentence_verbatim_ratio WHERE run_id = ctx.runId AND ratio IS NOT NULL }`.
  - `p25_sentence_verbatim_ratio` — `{ label: 'P25 Sentence Overlap (rewrite-disaster signal)', listView: false, compute: ... }` returns 25th percentile.
  - `min_sentence_verbatim_ratio` — `{ label: 'Min Sentence Overlap', listView: false, compute: ... }`.

  **Compute functions** land in a new file `evolution/src/lib/metrics/computations/sentenceOverlapMetrics.ts` (parallel to existing `criteriaMetrics.ts` shape). Reads `evolution_variants.sentence_verbatim_ratio` filtered by `run_id`, drops NULLs, returns median/p25/min. Called from `persistRunResults.ts` at run finalization, after tactic + criteria metric computation.

  **Strategy/experiment-level** (added to `SHARED_PROPAGATION_DEFS`):
  - `avg_median_sentence_verbatim_ratio` — `{ sourceMetric: 'median_sentence_verbatim_ratio', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean', listView: true }`. Bootstrap-mean for proper CIs (consistent with how `avg_final_elo` is propagated).

  **Tactic-level** (added to `METRIC_REGISTRY['tactic'].atFinalization` AND `TacticEntity.metrics.atFinalization` for the dual-registry parity per `entities.md`):
  - `median_sentence_verbatim_ratio` — `{ label: 'Median Verbatim Overlap', listView: true, compute: ... }` per tactic across all completed runs. Implemented in `tacticMetrics.ts:computeTacticMetricsForRun` (extend the existing function — read `evolution_variants` filtered by `agent_name` matching the tactic's marker, aggregate `sentence_verbatim_ratio` directly from the column).
  - Surfaces on `/admin/evolution/tactics` as a sortable column via `createMetricColumns('tactic')` for ALL 24 tactics + the 3 criteria markers — universal A/B comparison.

  **Stale cascade**: NOT needed. Sentence-overlap is computed once at variant creation from immutable parent + child text and never changes. The existing `mark_elo_metrics_stale()` trigger doesn't need extension for this metric. (Distinguishes it from `eloAttrDelta`-style metrics that DO need stale cascade because they depend on rating.)

  **Dynamic-prefix registration**: not needed (these are static names).
- [ ] `evolution/src/lib/metrics/computations/criteriaMetrics.ts:118` — change hardcoded `agent_name` filter from a single value to `.in([3 criteria-based agent types])` so `avg_score` aggregates across all three.
- [ ] (Optional, deferred) Add criteria-entity-level `total_proposer_approver_criteria_cost` propagation. Skip for V1 — surface on the run/strategy/experiment level only.

#### 1.8 — Cost estimator
- [ ] `evolution/src/lib/pipeline/infra/estimateCosts.ts` (after line 416) — add `estimateProposerApproverCriteriaCost(...)` returning `{ expected, upperBound, expectedRanking, upperBoundRanking }`. 5 layers: eval (reuse `estimateEvaluateAndSuggestCost`) + propose (extract internal `estimateEditingProposeCost` if not already exported) + forward approve + [mirror approve if `includesMirrorApprover`] + ranking. 1.3× upper-bound margin.
- [ ] **Estimator/runtime drift on mirror cost (intentional)**: the estimator projects worst-case mirror cost (every forward-accepted group gets a mirror call). The runtime short-circuit (Phase 4.6) skips mirror for forward-rejected groups, making actual mirror cost a function of the forward rejection rate. This produces consistent positive cost-estimation error (we over-estimate). DO NOT try to predict forward rejection rate at projection time — it varies per article + per criteria set. The Cost Estimates tab surfaces this as projected-vs-actual delta and that's the right shape.
- [ ] **Single-pass customPrompt overhead**: `estimateGenerationCost(seedArticleChars + 300, ...)` — the +300 char delta (was +200 in earlier draft) accounts for the 3 new guardrail directives (length / redundancy / flow) added to the customPrompt vs the legacy wrapper. Each directive is ~80-150 chars; net delta is approximate. Negligible cost difference (~$0.0001) but worth being right.
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
- [ ] Sentence-overlap is set on the variant by `GenerateFromPreviousArticleAgent` (Phase 1.4b — wrapper inheritance). Single-pass requires NO additional code here. Variant carries `sentenceVerbatimRatio` directly via the new column.

#### 2.4 — Dispatch branch
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.ts:341` — extend the variant-producing condition to include `'single_pass_evaluate_criteria_and_generate'`. The dispatch path mirrors `'criteria_and_generate'` (pre-fetch criteria once, instantiate the new wrapper, parallel batch + top-up + merge).
- [ ] Honor `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED` env var: when `'false'`, fall back to dispatching `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (the legacy wrapper) — log warn at iteration start.

#### 2.4b — Legacy `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (NO additional work)
- [ ] Sentence-overlap is set by inner `GenerateFromPreviousArticleAgent` per Phase 1.4b. The legacy criteria wrapper inherits via the inner GFPA `.execute()` call returning the variant with the field already populated. NO code change needed in the wrapper itself.

#### 2.5 — `agentRegistry.ts` registration
- [ ] `evolution/src/lib/core/agentRegistry.ts` — register `SinglePassEvaluateCriteriaAndGenerateAgent` in `getAgentClasses()` so its `invocationMetrics` (none today, but reserved) merge into `InvocationEntity`.
- [ ] Side-effect register attribution extractor in the new wrapper file: `registerAttributionExtractor('single_pass_evaluate_criteria_and_generate', (detail) => detail.weakestCriteriaNames?.[0] ?? null)`.
- [ ] Add to barrel `evolution/src/lib/core/agents/index.ts` for eager-import side-effect.

#### 2.6 — `detailViewConfigs.ts` + invocation page
- [ ] `evolution/src/lib/core/detailViewConfigs.ts` — add `single_pass_evaluate_criteria_and_generate` entry as near-clone of existing wrapper's, with addition of `guardrails: { redundancyDropCount, flowDropCount, lengthCapHit }` object. The Generation tab shows "Sentence verbatim overlap: 62%" via a custom field that reads the value from the variant row (NOT execution_detail) — variant ID is in the detail; the renderer joins to fetch the column. Metrics tab shows it as a MetricGrid cell sourced from the same path. Same pattern applies to all variant detail pages (Phase 5 / Variants list).
- [ ] `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — extend `buildTabs` with the 5-tab layout (`Eval & Suggest`, `Generation`, `Metrics`, `Timeline`, `Logs`) — clone the `evaluate_criteria_then_generate_from_previous_article` branch.
- [ ] Timeline color reuse: emerald (`EVALUATE_AND_SUGGEST_COLOR`) + blue (`GENERATION_COLOR`) + purple (`RANKING_COLOR`) — no new constants.

#### 2.7 — Wizard UI (single-pass conditional render)
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`:
  - Per-iteration agent-type select (lines 975-986): add option `<option value="single_pass_evaluate_criteria_and_generate">Single-pass criteria w/ guardrails</option>`.
  - `IterationRow` type (line 37): extend with new fields.
  - Insert conditional render block after line 1205: CriteriaMultiSelect (reuse), weakestK numeric input (reuse), **"Redundancy threshold"** numeric input — UI label is human-friendly; underlying field name stays `redundancyJaccardThreshold` for codebase honesty (default 0.35; 0 = strictest, 1 = loosest; tooltip: "Reject edits whose new text shares more than this fraction of trigrams with the rest of the article — protects against verbatim duplication").
  - `updateIteration` callback (lines 473-522): add field-clearing branch for the new type.
  - `canBeFirstIteration` + `isVariantProducing` + `toIterationConfigsPayload`: include the new type.
  - Budget bar color (line 1230): cyan (`bg-cyan-500`) for single-pass; legend entry.
  - `iterationErrors` validation: extend criteria-required check to all 3 criteria-based types.

#### 2.8 — Phase 2 unit tests
- [ ] Create `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.test.ts` (~16 tests): combined LLM call invocation; weakest-K determination; effectiveWeakestK clamping; parser drops + droppedSuggestions populated; customPrompt construction; **3 new directive verbatim-presence tests** (length / redundancy / flow); GFPA delegation via `.execute()`; cost-tracking via `getOwnSpent()`; error path preserves partial detail; lengthCapHit telemetry computed correctly post-generation; `tactic` set to `'criteria_driven_single_pass'`; misconfig guard accepts new tactic; **kill-switch fallback test**: with `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED='false'` env stub, dispatching the new agent type results in legacy `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` instantiation (assert via constructor spy or branched dispatch return).

---

### Phase 3: Mirror + Guardrails + Overlap Toolkit

Reusable primitives for the propose/approve agent (Phase 4). Ships independently — no agent uses them yet, but they're tested.

#### 3.0 — `sentenceOverlap.ts` helper (analytical metric)

Cheap, deterministic, no LLM. Used by all 3 criteria-based agents at finalization to compute `sentenceVerbatimRatio`.

- [ ] Create `evolution/src/lib/shared/sentenceOverlap.ts`:
  - `extractSentences(text: string): string[]` — tokenize on `[.!?]\s+`, trim, lowercase, collapse whitespace, drop empty entries.
  - `sentenceVerbatimOverlap(parent: string, child: string): { ratio, parentSentenceCount, childSentenceCount, intersectionCount }` — set intersection between parent + child sentence sets, using exact match and Levenshtein distance ≤ 2 for near-match (catches trivial punctuation/single-word edits). Returns `{ ratio: intersectionCount / parentSentenceCount }` (0-1; defaults to 1 if `parentSentenceCount === 0`).
  - Microsecond-scale CPU cost; called once per variant at finalization.

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
- [ ] Update existing call site in `IterativeEditingAgent.ts:~293` to pass `opts: {}` (preserves existing 1.5× behavior, no guardrails). Verify `IterativeEditingAgent.test.ts` passes with zero modification.
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
- [ ] Create `evolution/src/lib/shared/sentenceOverlap.test.ts` (~5 tests): identical text → ratio 1.0; fully disjoint sentences → 0.0; punctuation-only differences → still 1.0 (Levenshtein near-match within tolerance); single-sentence article edge case; empty parent → ratio defaults to 1.0. Property tests (~2 invariants): `sentenceVerbatimOverlap(text, text).ratio === 1.0` for any non-empty text; `ratio` always in `[0, 1]`.
- [ ] Create `evolution/src/lib/metrics/computations/sentenceOverlapMetrics.test.ts` (~4 tests): run-level median across N=5 variants computes correctly; p25 catches the bottom-quartile rewrite-disaster signal; min returns the worst case; NULL ratios (pre-existing legacy variants without the field) are excluded from the percentile computation rather than counted as 0 or 1.
- [ ] Extend `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` (~2 new cases): GFPA sets `Variant.sentenceVerbatimRatio` after generation; ratio is computed from `parentText` (input) → `generatedText` (output); covers wrapper inheritance — when called via `.execute()` from a wrapper agent, the returned variant carries the field.
- [ ] Extend `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` (~2 new cases): apply step sets `Variant.sentenceVerbatimRatio`; the ratio is computed against the ORIGINAL parent (not the cycle-N-1 intermediate) per Decisions §14 lineage rule.
- [ ] Extend `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` (~4 tests): transition-word rule (paragraph-start delete vs preserved); `lengthCapRatio` parameterization (1.0, 1.05, 1.10); semantic overlap rejection at 0.5 (above 0.35 default); existing 1.5× behavior preserved when no opts passed.

---

### Phase 4: Propose/Approve Agent (`proposer_approver_criteria_generate`)

The headline agent — single-cycle propose / forward-approve / mirror-approve / apply.

#### 4.0 — Refactor for reuse (preparatory)

Before writing the new agent class, do small refactors to shared helpers in `evolution/src/lib/core/agents/editing/` so the new agent reuses them via parameters instead of forking.

- [ ] Extract `SOFT_RULES` constant from `proposerPrompt.ts` into a shared module (e.g. `proposerSoftRules.ts` exporting `PROPOSER_SOFT_RULES: readonly string[]` and `buildSoftRulesText(rules)`). Existing `buildProposerSystemPrompt` consumes the shared constant. New agent can import + extend with redundancy / flow / length rules without duplicating the core list.
- [ ] Same pattern for `approverPrompt.ts`: extract reject criteria + accept criteria into shared `APPROVER_REJECT_CRITERIA` / `APPROVER_ACCEPT_CRITERIA` constants. Existing `buildApproverSystemPrompt` consumes them.
- [ ] Extend `buildProposerUserPrompt(currentText, opts?: { criteriaContext?: { criteria, evaluation, suggestions } })`. When `opts.criteriaContext` is undefined → existing behavior preserved (just article). When provided → criteria block + evaluation results + article. Existing `IterativeEditingAgent` call site passes `{}` — zero behavior change for the editing agent.
- [ ] Same pattern for `buildApproverUserPrompt(markedUpArticle, approverGroups, opts?: { criteriaContext?, guardrailRubricEnabled? })`. New agent passes both; existing agent passes neither. **Note**: the mirror approver MUST pass `guardrailRubricEnabled: false` since the mirror direction inverts edit semantics; applying forward-direction guardrail logic to inverted edits is incorrect.
- [ ] **Extend `parseReviewDecisions.ts`** (in Phase 4.0 because the new agent depends on it): add optional extraction of `redundancy_violation` / `flow_violation` / `length_violation` boolean fields from the JSONL output. Returned `EditingReviewDecision` objects carry these optional fields when present. Existing call sites in `IterativeEditingAgent` are unaffected (LLM doesn't produce those fields for that agent's prompts; missing fields stay undefined).
- [ ] **Existing `editingReviewDecisionSchema` in `schemas.ts`**: extend Zod schema with optional `redundancy_violation`, `flow_violation`, `length_violation` boolean fields so parser-extracted values aren't stripped on `safeParse`. Backward-compatible (optional fields default to undefined).
- [ ] Add an explicit byte-equality test: `buildProposerSystemPrompt({})` output equals the pre-refactor output, and same for `buildApproverSystemPrompt({})`. Both compared via string equality, not just behavioral assertion.
- [ ] Update `IterativeEditingAgent.ts` call sites to pass `{}` (no behavior change).
- [ ] Run existing `IterativeEditingAgent.test.ts` after refactor — must pass with zero modification.

#### 4.1 — Wrapper class

**Code reuse strategy** — the new agent imports and reuses the editing toolkit aggressively:

| File | Reuse mode |
|------|------------|
| `parseProposedEdits.ts` | As-is — same parser |
| `parseReviewDecisions.ts` | **Extended in Phase 4.0** — add optional extraction of `redundancy_violation` / `flow_violation` / `length_violation` boolean fields. Existing 3-field signature preserved; the parser passes through the optional flags when present in the LLM JSONL. Existing `IterativeEditingAgent` callers see no behavior change (LLM never produces those fields for that agent). |
| `applyAcceptedGroups.ts` | As-is — same right-to-left applier |
| `checkProposerDrift.ts` | As-is — drift detector (drift *recovery* skipped) |
| `validateEditGroups.ts` | Extended in Phase 3.3 with `opts` (preserves existing call-site behavior) |
| `proposerPrompt.ts` | Extended in Phase 4.0 with `criteriaContext` parameter |
| `approverPrompt.ts` | Extended in Phase 4.0 with `criteriaContext` + `guardrailRubric` parameters |
| `proposerSoftRules.ts` (NEW from Phase 4.0) | Imports `PROPOSER_SOFT_RULES`, extends with 3 new rules |
| `constants.ts` | As-is — shares `SIZE_RATIO_HARD_CAP` etc.; new agent's `lengthCapRatio` overrides via `validateEditGroups` opts |
| `types.ts` (`EditingAtomicEdit`, `EditingGroup`, `EditingReviewDecision`) | As-is |

The new agent's net-new code is the **orchestration** (single-cycle + mirror pass + aggregator) and the **criteria-context construction** for prompt injection. ~80% of the editing toolkit is reused unchanged.

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
    7. **If `iterCfg.includesMirrorApprover ?? true`** (mirror runs by default; explicit `false` skips):
       - Compute `articleA' = applyAcceptedGroups(forward-accepted groups, currentText)` for the mirror's article basis.
       - Run `validateFormat(A')` — if A' fails format: set `mirrorAbortReason = 'a_prime_format_invalid'`, skip mirror, **drop ALL forward-accepted groups** (strict binary rule — without mirror confirmation, no group survives the aggregator).
       - `renderMirrorMarkup(currentText, forwardAcceptedGroups) → { mirrorArticleA', mirrorMarkupString, mirrorGroups }`.
       - Build mirror approver prompt (mirror article + mirror edit groups + same criteria + evaluation). LLM call labeled `'criteria_mirror_approver'`.
       - `parseReviewDecisions(mirrorOutput) → mirrorDecisions[]`. If parse fails: set `mirrorAbortReason = 'mirror_parse_null'`, **drop ALL forward-accepted groups** (strict binary — null mirror is NOT REJECT).
       - **Aggregate (strict binary)**: per group, apply iff `(forwardDecision, mirrorDecision) === ('accept', 'reject')`. All other combinations DROP, including: both ACCEPT, both REJECT, REJECT+ACCEPT, any null mirror decision (whether from short-circuit or parse failure), and the entire-mirror-aborted case (`mirrorAbortReason` set). NO confidence-graded fallback — the rule is binary, period. Telemetry distinguishes drop reasons via `cycles[0].droppedPostApprover[].reason`: `aggregate_drop_both_accept`, `aggregate_drop_both_reject`, `aggregate_drop_forward_reject`, `aggregate_drop_mirror_null_short_circuit`, `aggregate_drop_mirror_null_parse_fail`, `aggregate_drop_mirror_aborted`.
    8. **If mirror disabled**: apply forward-accepted groups directly (no mirror gate).
    9. `applyAcceptedGroups(finalAcceptedGroups, currentText)` — right-to-left splice; emit final `Variant`. **Compute `sentenceVerbatimRatio` via `sentenceOverlap.sentenceVerbatimOverlap(originalParentText, finalAppliedText).ratio` and set on the returned `Variant.sentenceVerbatimRatio`** (persists to `evolution_variants.sentence_verbatim_ratio` column via `persistRunResults`). Observational only.
    10. **Step 5 — Post-cycle ranking** (reuse `IterativeEditingAgent`'s pattern, gated by `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED`): run `rankNewVariant(finalVariant, ...)` against the deep-cloned local snapshot. Surface/discard mirrors GFPA: discard if `rankResult.status === 'budget' AND localElo < computeTop15Cutoff(localRatings)`.
- [ ] Honor invariants I1, I2, I3:
  - I1: all LLM calls use `input.llm` directly.
  - I2: `costBefore*` snapshots captured before each helper call (`costBeforeProposeCall`, `costBeforeForwardApprove`, `costBeforeMirrorApprove`).
  - I3: write partial `execution_detail` (with whatever's been computed) BEFORE re-throwing on any helper failure.

#### 4.2 — Proposer + approver prompt builders (thin wrappers around shared builders)

The shared `proposerPrompt.ts` and `approverPrompt.ts` (extended in Phase 4.0 to accept `opts.criteriaContext` and `opts.guardrailRubricEnabled`) do most of the work. The new agent's prompt builders are thin wrappers:

- [ ] Create `evolution/src/lib/core/agents/proposerApproverCriteriaPrompts.ts`:
  - `buildCriteriaProposerSoftRules()` — concatenates `PROPOSER_SOFT_RULES` (imported from shared module) with 3 new criteria-specific rules:
    - "Avoid edits whose newText reiterates ideas, phrases, or arguments already present elsewhere in the article. Each edit should introduce or strengthen a distinct idea, not duplicate existing content."
    - "Preserve transition phrases and connective words at paragraph boundaries; do not delete or replace opening transitions like 'However,' 'Therefore,' or 'In contrast.'"
    - "Keep edits concise; aim to preserve article length within ±10% of the original."
  - `buildCriteriaProposerSystemPrompt()` — wraps shared `buildProposerSystemPrompt` with the extended soft rules.
  - `buildCriteriaProposerUserPrompt(article, criteria, evaluation, suggestions)` — wraps shared `buildProposerUserPrompt(article, { criteriaContext: { criteria, evaluation, suggestions } })`. The shared builder injects the criteria block before the article body when `criteriaContext` is present.
  - `buildCriteriaForwardApproverSystemPrompt()` — wraps shared `buildApproverSystemPrompt` with `{ guardrailRubricEnabled: true }`. The shared builder appends the per-edit guardrail-violation reject rubric.
  - `buildCriteriaForwardApproverUserPrompt(markedUpArticle, edges, criteria, evaluation)` — wraps shared `buildApproverUserPrompt(markedUpArticle, edges, { criteriaContext: { criteria, evaluation } })`.
  - `buildCriteriaMirrorApproverUserPrompt(mirrorArticle, mirrorEdges, criteria, evaluation)` — same as forward, but prepends a **mirror-direction framing** to the user prompt: "These edits would revert the proposed end-state back to the original. Reject edits whose proposed end-state should be preserved (i.e., where the original direction is the better article)." Calls the same shared builder.
- Output format from approvers: JSONL with `{groupNumber, decision, reason, redundancy_violation?, flow_violation?, length_violation?}` — schema extension from Phase 1.6.

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
- [ ] Same file — add 3 new **invocation-level** metrics so per-invocation values surface on the invocation Metrics tab + queryable in `evolution_metrics`:
  - `invocation_mirror_agreement_rate` — `appliedGroups / approverGroups` for this invocation.
  - `invocation_forward_accept_rate` — `forwardAccepts / approverGroups` for this invocation.
  - `invocation_mirror_filter_rate` — `1 - (appliedGroups / forwardAccepts)` — fraction of forward-accepted edits the mirror dropped (mirror's "work").
- [ ] Compute these from `execution_detail.cycles[0]` at finalization (`computeInvocationProposerApproverMetrics()` in `evolution/src/lib/metrics/computations/finalizationInvocation.ts`). Run-level metrics aggregate via mean across invocations.
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
- [ ] `InvocationDetailContent.tsx` — extend `buildTabs` with **6-tab** layout:
  1. Eval & Suggest
  2. **Edit Cycle** — unified view combining proposer markup + per-group decision table (forward + mirror + aggregate result columns) + funnel summary + pre-approver drops list + collapsible annotated markup. Mirror column renders `—` for already-rejected forward edits (and the runtime short-circuits those mirror calls to save cost). Per-row click-to-expand for full edit text + reasons + guardrail flag details.
  3. Apply — applied groups with diffs + dropped-post-approver (applier-stage drops only: `oldText_mismatch`, `range_overlap_with_earlier_group`) + net length change + **sentence verbatim overlap (parent → final)** sourced from `evolution_variants.sentence_verbatim_ratio` + final variant link.
  4. Metrics
  5. Timeline (5-segment phase bar)
  6. Logs
- [ ] Tabs use `keyFilter` mechanic to slice fields. Edit Cycle tab keeps `cycles.0.proposedGroupsRaw`, `cycles.0.droppedPreApprover`, `cycles.0.forwardDecisions`, `cycles.0.mirrorDecisions`, `cycles.0.proposeCostUsd`, `cycles.0.approveForwardCostUsd`, `cycles.0.approveMirrorCostUsd`, `mirrorAgreementRate`, `mirrorAbortReason`. Apply tab keeps `cycles.0.appliedGroups`, `cycles.0.droppedPostApprover`, plus the final variant fields.
- [ ] Per-group decision table is a custom `DetailFieldDef` of type `'edit-cycle-decisions'` (new type) that joins `forwardDecisions` and `mirrorDecisions` by `groupNumber`, computes the aggregator result inline, and renders the funnel summary header. Implementation in `evolution/src/components/evolution/visualizations/EditCycleDecisionsTable.tsx`.
- [ ] Mirror runtime short-circuit: in `proposerApproverCriteriaGenerate.ts`, before the mirror LLM call, filter out groups where `forwardDecisions[i].decision === 'reject'` — those don't need mirror evaluation. Saves a fraction of the mirror call's input tokens proportional to forward rejection rate. Persist the filtered-out groups with mirror decision `null` (rendered as `—` in the table).
- [ ] `InvocationTimelineTab.tsx` — extend with new 5-segment phase bar:
  - Emerald (eval & suggest, reused `EVALUATE_AND_SUGGEST_COLOR`).
  - Blue (proposer, reused `GENERATION_COLOR`).
  - Orange `#f97316` (forward approver) — NEW constant `CRITERIA_APPROVER_FORWARD_COLOR`.
  - Deep orange `#ea580c` (mirror approver) — NEW constant `CRITERIA_APPROVER_MIRROR_COLOR`.
  - Purple (ranking, reused `RANKING_COLOR`).

#### 4.7 — Wizard UI (propose/approve conditional render)
- [ ] `src/app/admin/evolution/strategies/new/page.tsx`:
  - Per-iteration agent-type select: add `<option value="proposer_approver_criteria_generate">Proposer-approver criteria w/ mirror</option>`.
  - Conditional render block (per-iteration ONLY): CriteriaMultiSelect + weakestK + **"Length cap ratio"** numeric input (default 1.10) + **"Redundancy threshold"** numeric input (default 0.35; underlying field name `redundancyJaccardThreshold`) + **"Include mirror approver"** checkbox **(default checked = true)**. `toIterationConfigsPayload` emits `includesMirrorApprover` to the strategy config ONLY when the user explicitly unchecks it; default-on strategies omit the field for compact hashing.
  - **Models are STRATEGY-LEVEL only** — `editingModel` + `approverModel` configured in Step 1 of the wizard (existing IterativeEditingAgent fields, reused as-is). NOT exposed per-iteration. All `proposer_approver_criteria_generate` iterations within one strategy share the same proposer + approver models.
  - `editingMaxCycles` rendered as read-only "1 cycle (single-pass fixed)".
  - `updateIteration` callback: add field-clearing branch.
  - Budget bar color: purple (`bg-purple-500`); legend entry.
  - `iterationErrors`: validate criteria-required.

#### 4.8 — Phase 4 unit tests
- [ ] Create `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.test.ts` (~35 tests):
  - **Core cycle (12 tests)**: happy path; proposer drift major → abort; approver JSONL parse error → default reject; pre-approver hard-rule drops; size-cap enforcement at 1.10×; right-to-left applier; context-failsafe drops; format-validation failures; cost tracking per phase; criteria propagation through cycle.
  - **Mirror protocol (15 tests)** — each aggregator combination an EXPLICIT separate test:
    - **Construction (5 tests)**: insert→delete inversion; delete→insert inversion; replace→reverse-replace inversion; position drift recomputation across 3-edit groups; A' construction matches forward applier output.
    - **Aggregator truth table (8 tests)** — one test per (forward, mirror) combination:
      1. (ACCEPT, REJECT) → APPLY (the only winning combination).
      2. (ACCEPT, ACCEPT) → DROP with reason `aggregate_drop_both_accept`.
      3. (REJECT, REJECT) → DROP with reason `aggregate_drop_both_reject`.
      4. (REJECT, ACCEPT) → DROP with reason `aggregate_drop_forward_reject`.
      5. (REJECT, null short-circuit) → DROP with reason `aggregate_drop_mirror_null_short_circuit` AND mirror LLM call NOT made (assert via mock call count).
      6. (ACCEPT, null parse-fail) → DROP with reason `aggregate_drop_mirror_null_parse_fail` AND `mirrorAbortReason = 'mirror_parse_null'`.
      7. mirror entire-pass aborted (A' fails format) → ALL forward-accepted groups dropped with reason `aggregate_drop_mirror_aborted` AND `mirrorAbortReason = 'a_prime_format_invalid'`.
      8. Strict-binary regression check: confidence-graded fallback NEVER appears in execution_detail (no `confidence: 0.6` artifacts from earlier draft spec).
    - **Mirror short-circuit (2 tests)**: groups with `forwardDecision === 'reject'` are filtered before mirror LLM call (assert mirror prompt does not contain those group numbers); `mirrorDecisions[i] = null` for short-circuited groups (vs `mirrorAbortReason` for whole-pass failures — distinct telemetry).
  - **Parser edge cases (8 tests)**: covered by reused `parseProposedEdits.test.ts`; this file tests integration only.
  - **Applier specifics (5 tests)**: covered by reused `applyAcceptedGroups.test.ts`; this file tests cycle-level aggregation.
- [ ] Mock LLM strategy: **`createV2MockLlm` ALREADY supports `labelResponses`** (verified at `evolution/src/testing/v2MockLlm.ts:24,34,41`). No mock infrastructure extension needed. Tests use the existing capability:
  ```typescript
  const mockLlm = createV2MockLlm({
    labelResponses: {
      'evaluate_and_suggest': '...scoring + suggestions JSONL...',
      'criteria_proposer': '...full article + CriticMarkup...',
      'criteria_forward_approver': '[{"groupNumber": 1, "decision": "accept", ...}]',
      'criteria_mirror_approver': '[{"groupNumber": 1, "decision": "reject", ...}]',
    },
  });
  ```
  The 4 LLM calls per propose/approve invocation run sequentially under one `Agent.run()` scope (NOT in `Promise.all`) — short-circuit logic in Phase 4.6 means mirror calls happen AFTER forward decisions are parsed, so label-based routing is sufficient.

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

#### 5.5 — Sentence-overlap UI surfacing audit (cross-cutting, all variant surfaces)

Since `evolution_variants.sentence_verbatim_ratio` (Phase 1.4b) is universal across all variant-producing agents, the metric should surface anywhere a variant or invocation is displayed. This sub-phase enumerates every UI touchpoint.

**Server actions — extend SELECT statements**:
- [ ] `getEvolutionVariantsAction` (run detail Variants tab) — SELECT `sentence_verbatim_ratio`.
- [ ] `listVariantsAction` (`/admin/evolution/variants`) — SELECT + add to `VariantSummary` projection. Make the column sortable + filterable (e.g., "show variants with ratio < 0.3 AND elo_score < 1100" — surfaces rewrite-disaster cohort).
- [ ] `getArenaEntriesAction` (arena leaderboard) — SELECT + add to `ArenaEntry`.
- [ ] `getVariantFullDetailAction` (variant detail page) — SELECT.
- [ ] `getStrategyVariantsAction` (strategy detail Variants tab) — SELECT.
- [ ] `getInvocationDetailAction` — extend the embedded variant fetch to include the ratio (the invocation page joins variant data via the existing `agent_invocation_id` FK).

**Variant list pages — new column**:
- [ ] `/admin/evolution/variants` (global list): new "Verbatim Overlap" column rendered as percent. `listView: true`. Sortable. Filterable via numeric range input.
- [ ] Run detail Variants tab (`evolution/src/components/evolution/tabs/VariantsTab.tsx`): same column added. Filterable.
- [ ] Strategy detail Variants tab: same column.
- [ ] Arena leaderboard (`/admin/evolution/arena/[topicId]`): "Verbatim Overlap" column added. Useful for spotting which arena entries are heavy-rewrite vs light-edit at a glance.

**Variant detail page** (`src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`):
- [ ] Add to `MetricGrid` in the detail header: "Verbatim Overlap: 62%". Prominent placement next to Elo + parent link. Renders `—` when null (legacy variants).

**Invocation detail pages — extend ALL agent variants** (not just the 2 new ones — the metric is universal):
- [ ] **`generate_from_previous_article`** (vanilla): extend its `DETAIL_VIEW_CONFIGS` entry with a "Sentence Verbatim Overlap" field. Source: fetched server-side via the variant join in `getInvocationDetailAction`, passed as a top-level prop to the renderer (NOT through execution_detail — keeps the storage architecture clean per Phase 1.4b).
- [ ] **`reflect_and_generate_from_previous_article`**: same addition.
- [ ] **`evaluate_criteria_then_generate_from_previous_article`** (legacy criteria): same addition.
- [ ] **`single_pass_evaluate_criteria_and_generate`** (NEW): already covered in Phase 2.6 — but verify the field source is the variant join, not execution_detail.
- [ ] **`proposer_approver_criteria_generate`** (NEW): already covered in Phase 4.6 (Apply tab) — verify field source.
- [ ] **`iterative_editing`**: extend its `DETAIL_VIEW_CONFIGS` entry with the same field on the existing Apply / Metrics tab.

**Implementation pattern for invocation pages** — single shared snippet in `InvocationDetailContent.tsx` that pulls the ratio from the joined variant data and renders it as a `MetricGrid` cell at the top of the **Metrics** tab for ALL variant-producing agent types. This avoids per-agent renderer duplication. Place once, applies everywhere.

**Run / Strategy / Experiment Metrics tabs**:
- [ ] Run detail Metrics tab (`EntityMetricsTab`): the run-level `median_sentence_verbatim_ratio` (with bootstrap CI), `p25_sentence_verbatim_ratio`, `min_sentence_verbatim_ratio` are auto-rendered via the standard `MetricGrid` reading from `evolution_metrics` (Phase 1.7 registered them with `listView: true` for median, false for p25/min). No additional code needed beyond the registry entries.
- [ ] Strategy detail Metrics tab: `avg_median_sentence_verbatim_ratio` propagation auto-renders (Phase 1.7).
- [ ] Experiment detail Metrics tab: same.

**Tactic leaderboard** (`/admin/evolution/tactics`):
- [ ] Median Verbatim Overlap column already covered in Phase 1.7 / `tacticMetrics.ts` extension. Verify it surfaces as a sortable column on the leaderboard table for ALL 24 tactics + the 3 criteria markers.

**Filtering UX for analysis**:
- [ ] On the global Variants list page, add a "Verbatim Overlap" range filter (min slider, max slider) — researcher can dial in "show me variants with overlap < 0.3" to find rewrite disasters; "overlap > 0.95" to find light-edit variants.
- [ ] Combined with the existing Elo Δ filter, this gives the 2D view that the prior project's bucket-table analysis represents — but live, queryable, in the admin UI.

**Tests for UI surfacing**:
- [ ] Extend `admin-evolution-run-pipeline.spec.ts` E2E to assert the column appears in the run detail Variants tab.
- [ ] Extend the variant detail spec to assert the MetricGrid shows the ratio.
- [ ] Extend the tactic detail spec to assert the column on `/admin/evolution/tactics`.

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
- [ ] `evolution/docs/visualization.md` — § Timeline tab + § Invocation detail page: new badges, 5-tab single-pass + 6-tab propose/approve layouts, color constants.
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
  - **Sentence verbatim overlap distribution per agent** — bucket Elo Δ by overlap percentile (0-20%, 20-40%, 40-60%, 60-80%, 80-100%). Replicates the prior project's analysis methodology directly from the new `invocation_sentence_verbatim_ratio` metric. Compares 3 agent types side-by-side: does single-pass produce more high-overlap variants than legacy? Does propose/approve avoid the 0-20% rewrite-disaster bucket entirely?
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
- [ ] `evolution/src/lib/shared/sentenceOverlap.test.ts` — NEW (~5 cases + 2 property invariants).
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — extension (~4 cases for new transition rule + parameterized lengthCapRatio + semantic overlap).
- [ ] `src/app/admin/evolution/_components/StrategyForm.test.tsx` (or equivalent) — extension (~4 cases for conditional renders + validation).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-single-pass-criteria.integration.test.ts` — NEW (~5 cases) with explicit DB-level assertions:
  1. Full-pipeline run produces variant with `agent_name = 'single_pass_evaluate_criteria_and_generate'` and `execution_detail.tactic === 'criteria_driven_single_pass'`.
  2. **`evolution_metrics` row assertion**: `SELECT value FROM evolution_metrics WHERE entity_type='run' AND entity_id=$runId AND metric_name='evaluation_cost'` returns the eval-phase cost; `metric_name='generation_cost'` returns the GFPA cost; sum equals run-level `cost`.
  3. `execution_detail.guardrails.lengthCapHit` correctly populated (true when output > 1.10× parent; false otherwise).
  4. **Kill-switch fallback**: with `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED='false'`, dispatching the single-pass agent type produces variants with `agent_name = 'evaluate_criteria_then_generate_from_previous_article'` (legacy fallback) AND a warn log at iteration start.
  5. Tactic leaderboard query: `criteria_driven_single_pass` row appears in `evolution_metrics WHERE entity_type='tactic'` after run.
- [ ] `src/__tests__/integration/evolution-proposer-approver-criteria.integration.test.ts` — NEW (~6 cases) with explicit DB-level assertions:
  1. Full-pipeline run produces variant with `agent_name = 'proposer_approver_criteria_generate'` and `execution_detail.tactic === 'criteria_driven_propose_approve'`.
  2. `execution_detail.cycles[0]` populated with `forwardDecisions[]`, `mirrorDecisions[]`, `appliedGroups[]`, `proposeCostUsd`, `approveForwardCostUsd`, `approveMirrorCostUsd`.
  3. **`evolution_metrics` row assertion**: `SELECT value FROM evolution_metrics WHERE entity_type='run' AND entity_id=$runId AND metric_name='proposer_approver_criteria_cost'` equals `proposeCostUsd + approveForwardCostUsd + approveMirrorCostUsd` (verifies `writeMetricMax` cost-attribution path).
  4. **Invocation-level metric assertion**: `SELECT value FROM evolution_metrics WHERE entity_type='invocation' AND entity_id=$invocationId AND metric_name='invocation_mirror_agreement_rate'` returns the computed value AND equals `appliedGroups.length / forwardDecisions.filter(d => d.decision === 'accept').length` (verifies end-to-end persistence of agreement rate).
  5. `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED='false'` skips ranking — no `arena_comparisons` rows for the variant; `execution_detail.ranking` undefined.
  6. **Kill-switch rejection**: with `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED='false'`, dispatching the propose/approve agent type produces zero variants AND a warn log at iteration start; no run failure.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — extend (~2 new cases): create strategy with single-pass criteria; create strategy with propose/approve criteria. Verify field visibility (`lengthCapRatio` only for propose/approve, etc.).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-single-pass.spec.ts` — NEW (~3 cases): run a seeded strategy with single-pass agent; navigate run detail; verify variant detail shows `tactic: criteria_driven_single_pass`.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-proposer-approver.spec.ts` — NEW (~3 cases): run a seeded strategy with propose/approve agent; navigate the 6-tab invocation page (Eval & Suggest / Edit Cycle / Apply / Metrics / Timeline / Logs); verify the Edit Cycle tab's per-group decision table renders with forward + mirror + aggregate columns; verify the Apply tab shows applied groups + dropped-post-approver list; verify cost breakdown shows the 5-layer split.

### Manual Verification
- [ ] Wizard flow end-to-end: create strategy with each new agent type, save, run.
- [ ] Run detail Timeline tab shows correct iteration cards with new agent badges.
- [ ] Invocation detail Eval & Suggest tab renders criteria scored + suggestions.
- [ ] Propose/approve invocation detail: all 6 tabs render without errors; Edit Cycle tab shows per-group decision table with forward + mirror + aggregate columns; Apply tab shows final variant; Timeline shows 5-segment bar.
- [ ] Tactic leaderboard at `/admin/evolution/tactics` shows `criteria_driven_single_pass` and `criteria_driven_propose_approve` rows with metrics.
- [ ] Cost dashboard shows new `proposer_approver_criteria_cost` column.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `admin-strategy-wizard.spec.ts` — extended; verifies wizard new fields + dispatch preview + create.
- [ ] `admin-evolution-run-single-pass.spec.ts` — verifies single-pass run produces variants and detail UI renders.
- [ ] `admin-evolution-run-proposer-approver.spec.ts` — verifies propose/approve run produces variants, 6-tab invocation page renders (Eval & Suggest / Edit Cycle / Apply / Metrics / Timeline / Logs), mirror-approver decisions visible in Edit Cycle table, cost breakdown correct.
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

### Iteration 1 (3/3 reviewers below 5)

11 critical gaps found across three perspectives:
- **Security & Technical (3/5)**: mirror aggregator confidence-graded fallback contradicted strict binary rule; cost-calibration migration missed `evaluate_and_suggest` and 3 TS phase-enum sources.
- **Architecture & Integration (4/5)**: `parseReviewDecisions.ts` reuse claim incorrect (parser strips guardrail-violation fields); existing Zod refines at `schemas.ts:567-572` strictly gate editing fields on `iterative_editing` only; `canonicalizeIterationConfig` strictly gates `criteriaIds`/`weakestK` on `criteria_and_generate` only.
- **Testing & CI/CD (3/5)**: mock LLM proposal misframed (capability already exists); 6-tab vs 8-tab plan inconsistency; aggregator combinations not enumerated as separate tests; integration tests didn't bind to specific `evolution_metrics` row assertions; single-pass fallback path untested; mirror-agreement-rate end-to-end persistence unverified.

All 11 critical gaps fixed in commit `2114e2d4`. Strict-binary mirror rule with 6 enumerated `aggregate_drop_*` telemetry reasons. Migration covers all 3 TS phase-enum sources + restores `evaluate_and_suggest` to the CHECK constraint. `parseReviewDecisions.ts` extension added to Phase 4.0. Explicit `WIDEN` markers on the existing Zod refines + canonicalize gates. Mock LLM uses existing `labelResponses` capability. 6-tab consistency throughout. 8-row aggregator truth table with explicit drop-reason coverage. Integration tests bind to `evolution_metrics` rows via SQL assertions. Single-pass fallback test added to Phase 2.8. Mirror-agreement-rate persistence verified via invocation-level metric assertion.

### Iteration 2 — ✅ CONSENSUS (3/3 reviewers scored 5/5)

All prior critical gaps verified as resolved. Remaining items are minor polish (e.g., echoing `guardrailRubricEnabled: false` at the Phase 4.2 call site, tightening `applyAcceptedGroups` 2-arg shorthand to 3-arg, adding an explicit `WIDEN` marker to Phase 5.3 for consistency, picking a concrete kill-switch test assertion mechanism between constructor-spy vs branched-dispatch-return). None block execution.

Plan is ready to execute.
