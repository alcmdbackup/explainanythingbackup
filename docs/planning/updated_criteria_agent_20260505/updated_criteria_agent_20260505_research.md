# updated_criteria_agent_20260505 Research

## This Project (2026-05-06)

Build **two** updated versions of the criteria-driven evolution agent and add **redundancy / flow / length guardrails** to both. The carried-over research below is the baseline from `understand_critera_agent_performance_evolution_20260503`; PR #1032 + #1036 closed 42% of the original Elo gap (-47 → -27.8) and the remaining gap maps to two failure modes (rewrite disasters + light-edit left-tail).

### Two new agent types
1. **`single_pass_evaluate_criteria_and_generate`** — successor to the current single-pass criteria wrapper. Same one-combined-LLM-call shape (score + suggestions → GFPA delegation with `customPrompt`); adds the new guardrails to customPrompt + evaluator instructions.
2. **`proposer_approver_criteria_generate`** — new agent, modeled on `IterativeEditingAgent` but **single-cycle** (default `maxCycles = 1`). Proposer drafts CriticMarkup edits targeted at the K weakest criteria; Approver reviews; Implementer applies position-based.

### Guardrail definitions
- **Redundancy** — don't introduce overlapping ideas / phrasing already present in the article.
- **Flow** — don't break paragraph-to-paragraph transitions or local rhythm.
- **Length** — keep within ±10% of original word count.

### Proposer/Approver mechanics (single cycle)
- Approver receives the FULL criteria + evaluation context (not just article + proposed edits).
- Rubber-stamping concern is intentionally relaxed — `editingModel` and `approverModel` may be the same.
- Both edits and approver decisions feed the deterministic Implementer.

### Mirror-approver bias-mitigation protocol
The approver runs **two passes** on each proposed edit group:
- **Initial pass** — the original CriticMarkup proposal.
- **Mirror pass** — sign-flipped version applied to the article in the opposite state (insertion ↔ deletion of the same text; substitution `{~~ A ~> B ~~}` ↔ reverse substitution `{~~ B ~> A ~~}`).

The Implementer applies an edit only if BOTH passes' decisions consistently favor the proposed end-state (initial=ACCEPT + mirror=REJECT). All other combinations → drop the edit. This filters approver position bias / sycophancy, mirroring the existing `run2PassReversal` pattern used for pairwise judges.

### Shipping
- Both new types ship in parallel as distinct `agentType` enum values.
- Both inherit from the existing criteria wrapper's evaluation phase (criteria scoring + suggestion drafting); they diverge in how suggestions become edits.

(The carried-over research below documents the prior project's full investigation, post-merge analysis, and the percentile-bucketed Elo distribution that grounds the two-failure-mode framing.)

---

## Round 1 Findings (2026-05-06): Foundational Code Paths

### Existing criteria wrapper (`evaluateCriteriaThenGenerateFromPreviousArticle.ts`)
Six load-bearing contracts the successor must honor:
1. **Inner GFPA must call `.execute()` not `.run()`** (line 554) — preserves `AgentCostScope` so cost attribution stays in the wrapper's invocation row.
2. **`effectiveWeakestK = min(input.weakestK, criteria.length)`** must be passed to the prompt builder; mismatch silently downgrades.
3. **Sentinel tactic `'criteria_driven'`** is required to satisfy GFPA's misconfiguration guard (`generateFromPreviousArticle.ts:190`); bare GFPA dispatch with that tactic is rejected.
4. **`customPrompt: { preamble, instructions }`** is the only injection point — `buildEvolutionPrompt` substitutes both into a fixed template (preamble + parent + instructions + FORMAT_RULES).
5. **`weakestCriteriaIds` + `criteriaSetUsed`** must propagate through GFPA → variant for lineage tagging (DB columns are GIN-indexed for downstream metric aggregation).
6. **execution_detail merge** must populate `weakestCriteriaIds`, `weakestCriteriaNames`, `evaluateAndSuggest` sub-object, AND `tactic: 'criteria_driven'` BEFORE delegating; partial-failure path relies on this for the partial-update preservation (`trackInvocations.ts:81`).

**Length-preservation directive (verbatim, PR #1032)**, in `buildCustomPromptFromSuggestions` lines 288-289:
> "Rewrite the article addressing each issue. Preserve the original word count within ±10% — refactor or deepen existing passages rather than adding new sections or examples. Do not introduce meta-commentary about the article itself."

### `IterativeEditingAgent` algorithm
Single-cycle protocol per parent:
1. **Proposer** (`iterative_edit_propose`) → full article verbatim with inline CriticMarkup.
2. **Implementer pre-check** (deterministic) → `parseProposedEdits` + `checkProposerDrift` + `validateEditGroups` (hard rules + 1.5× size cap).
3. **Approver** (`iterative_edit_review`) → JSONL one-per-group `{groupNumber, decision, reason}`.
4. **Implementer apply** (deterministic) → context-failsafe + overlap-drop + right-to-left splice.

**Today's approver context is article + edit groups only — NO criteria, NO evaluation rubric.** That's the gap our project closes by passing the eval-and-suggest payload through.

**Load-bearing invariants** (`IterativeEditingAgent.ts:7–18`):
- I1: internal LLM helpers MUST use `input.llm` directly, never instantiate a separate Agent.
- I2: capture `costBefore*Call` snapshots BEFORE each helper call.
- I3: write partial `execution_detail` BEFORE re-throwing.

### CriticMarkup parser/applier
- **Atomic edit** = `{ groupNumber, kind: 'insert'|'delete'|'replace', range: {start, end}, markupRange, oldText, newText, contextBefore (30 chars), contextAfter (30 chars) }` (`types.ts:203–212`).
- **Group formation** = explicit `[#N]` OR adjacency rule (consecutive markup separated only by `[ \t\r]*\n?[ \t\r]*` = same group; `\n\n` splits).
- **Paired form** `{~~ X ~~}{++ Y ++}` and inline form `{~~ X ~> Y ~~}` both normalize to a single `replace`.
- **Hard rules** in `validateEditGroups`: 500-char newText cap, no `\n\n` in old/new, no `` ``` `` fences, no headings (`/^#+\s/m`), no list-item lines (`/^[\*+\-]\s/m`), no horizontal rules (`/^---\s*$/m`), max 5 atomic edits per group.
- **Size-ratio guardrail** = 1.5× cap; drops highest-numbered groups until under threshold; flags `sizeExplosion` if a single dropped group's net inflation alone exceeds 0.5× baseLen.
- **Applier** = right-to-left splice; verifies `oldText` byte match + `contextBefore`/`contextAfter` failsafe; drops overlapping groups (later wins).

**Mirror transformation rules**, atomic edit `e` against article A → mirror against A' (post-apply):
- `insert`: `{++ X ++}` at P → mirror `delete X` from `[P, P+len(X))` in A'.
- `delete`: `{-- Y --}` from `[s, e)` → mirror `insert Y` at position `s` in A' (range `[s, s)`).
- `replace`: `{~~ X ~> Y ~~}` at `[s, e)` → mirror `replace Y back to X` at `[s, s+len(Y))` in A'.

A new helper `evolution/src/lib/core/agents/editing/mirrorEdits.ts` is the natural home for `invertAtomicEdit`, `constructMirrorGroup`, `roundTripApply` (and a `spliceString` utility).

### `run2PassReversal` is reusable for the mirror-approver
The existing primitive (`evolution/src/lib/shared/reversalComparison.ts`) is generic over `<TParsed, TResult>` and runs both LLM calls in parallel via `Promise.all`. For the mirror-approver:
- `TParsed` = `'ACCEPT' | 'REJECT' | null` per group.
- `TResult` = `{ decision: 'apply' | 'drop'; confidence }` per group.
- `buildPrompts.forward` = original CriticMarkup + original article + criteria + evaluation context.
- `buildPrompts.reverse` = mirrored CriticMarkup + post-apply article + same criteria + same evaluation.
- `aggregate(forward, reverse)` decision rule (CORRECTED from agent's draft):

| forward | reverse | semantics | result |
|---|---|---|---|
| ACCEPT | REJECT | "want X" + "don't remove X" → both want X in final article | **APPLY** |
| ACCEPT | ACCEPT | "want X" + "remove X" → contradicts | drop |
| REJECT | ACCEPT | "don't want X" + "remove X" → consistent on absence, but our proposal was to add it | drop |
| REJECT | REJECT | "don't want X" + "don't remove X" → contradicts (preserves status quo, but proposal was adding) | drop |
| any null | any | partial failure | drop |

Net rule: **APPLY iff (forward, reverse) == (ACCEPT, REJECT)**, else DROP. No flipWinner intermediate step needed — asymmetry is built into the aggregator. Confidence is binary (1.0 apply / 0.0 drop) with this strict rule, but we may relax later for partial-failure tolerance.

### Files to add / modify (preview)
- **New**: `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.ts` (single-pass with new guardrails).
- **New**: `evolution/src/lib/core/agents/editing/mirrorEdits.ts` (mirror-transformation helpers).
- **New**: `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` (single-cycle propose/approve with mirror-approver).
- **New**: `evolution/src/lib/core/agents/proposerApproverCriteriaPrompts.ts` (proposer prompt with criteria + eval context; approver prompt with same context + edit groups).
- **Modify**: `evolution/src/lib/core/agentNames.ts` (add 4 new AgentName labels: propose / review / mirror_review / drift_recovery, plus single_pass_evaluate_and_suggest if separate from existing).
- **Modify**: `evolution/src/lib/schemas.ts` (Zod refinements for the two new agent types).
- **Modify**: `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (dispatch branches).
- **Modify**: GFPA misconfiguration guard if reusing `'criteria_driven'` tactic, OR add a new sentinel.

## Round 2 Findings (2026-05-06): Guardrails + Mirror-Approver Edge Cases

### Redundancy guardrail — two-level defense

**Level 1 — proposer prompt soft rule.** Add to `proposerPrompt.ts` SOFT_RULES (currently 6 rules):
> "Avoid edits whose newText reiterates ideas, phrases, or arguments already present elsewhere in the article. Each edit should introduce or strengthen a distinct idea, not duplicate existing content."

**Level 2 — deterministic check in `validateEditGroups.ts`.** Trigram Jaccard overlap detector:
- Extract trigram set of `newText`; build trigram set of `articleText \ oldText` (article minus the edit's old range).
- Reject group if `|intersection| / |union| > 0.35`.
- New drop reason: `semantic_overlap_with_existing_content`.
- **Caveat**: trigrams catch lexical overlap, not semantic. "Monetary authority sets borrowing costs" vs "interest rates are set by the Fed" → low Jaccard, escapes the check. The proposer-prompt rule is the qualitative line of defense; the trigram check catches gross duplication.

Search confirmed: **no existing similarity helper in `evolution/src/lib/`** today. Building the trigram detector is greenfield.

### Flow guardrail — three-level defense

**Level 1 — proposer soft rule** (add to `proposerPrompt.ts`):
> "Preserve transition phrases and connective words at paragraph boundaries; do not delete or replace opening transitions like 'However,' 'Therefore,' or 'In contrast.'"

**Level 2 — hard rule in `validateEditGroups.ts`.** Regex against transition words at paragraph start:
```
RE_TRANSITION_START = /^(However|Therefore|Thus|Moreover|Furthermore|In contrast|Similarly|Conversely|Nevertheless|Specifically|For example|In other words|As a result|Ultimately),?\s/i
```
Reject groups whose `oldText` (when range immediately follows `\n`) matches this pattern AND newText doesn't preserve it.

**Level 3 — approver rubric.** Add reject criterion:
> "The edit removes or replaces a transition phrase at a paragraph boundary (breaks connective tissue between paragraphs)."

### Length guardrail — strict enforcement (vs current 1.5×)

Current `SIZE_RATIO_HARD_CAP = 1.5` is too permissive for our ±10% target. Implementation:
- **New constant** `DEFAULT_LENGTH_CAP_RATIO = 1.10` in `evolution/src/lib/core/agents/editing/constants.ts`.
- **New optional field** `lengthCapRatio?: number` on the new agent type's IterationConfig (range 1.01-1.50). Plumbs through to `validateEditGroups(groups, currentText, lengthCapRatio = 1.10)`.
- The existing 1.5× cap stays for `iterative_editing` agent type; the new agent type defaults to 1.10.
- Soft proposer rule + approver rubric question complete the three-level pattern.
- **Char-count vs word-count**: stick with char-count (existing system uses it). The "±10% word count" phrasing in prompts is human-readable; internally the ratio is char-based and "close enough" for prose.

### Approver context expansion

The new agent's `IterativeEditInput` extends with:
```typescript
approvalContext?: {
  criteria: ReadonlyArray<CriterionRow>;
  evaluation: {
    criteriaScored: ParsedScore[];
    suggestions: ParsedSuggestion[];  // the original eval-phase suggestions
  };
};
```
Wrapper-level only (not per-cycle), since the eval phase runs once.

**Approver prompt additions**: criteria block (system prompt, ~575 tokens), evaluation results (user prompt: scores + weakest-K suggestions, ~295 tokens), guardrail rubric (~100 tokens). Total ~970 input tokens added per approver call; ~+$0.0008/call at typical pricing.

**Decision schema extension** (backward-compatible — optional fields):
```typescript
EditingReviewDecision {
  groupNumber, decision, reason,
  redundancy_violation?: boolean,  // NEW
  flow_violation?: boolean,         // NEW
  length_violation?: boolean,       // NEW
}
```

**New `OUTPUT_TOKEN_ESTIMATES.iterative_edit_review = 150`** (today defaults to 1000 — overestimate).

### Mirror-approver edge cases — 7 CRITICAL gotchas

1. **Position drift**: forward edits' byte ranges are INVALID in A' (post-apply). Mirror group construction must recompute every `range`, `contextBefore`, `contextAfter` in A' coordinates via simulated forward-application offset tracking. **NOT optional — silent context-mismatch drops all mirror edits otherwise.**

2. **Atomic-vs-group mirroring**: A 3-edit group needs all 3 atomic edits inverted; ranges must be recomputed PER atomic edit (each forward edit shifts subsequent positions in A'). Math: position offset up to `pᵢ` increases by `Σ(newText[j].length - oldText[j].length)` for all `j > i` (right-to-left applied means downstream-first).

3. **No drift check on mirror output**: We're constructing the mirror deterministically (no LLM in the loop), so `checkProposerDrift` always passes by construction. **Skip it.** Saves a code branch.

4. **Skip mirror for pre-dropped groups**: Only run mirror approver on groups that pass `validateEditGroups` AND forward-approver returns ACCEPT. Mirroring rejected/dropped groups wastes LLM tokens.

5. **A' format validation gate**: Before constructing mirror markup, validate `A'` against `formatValidator`. If A' fails (e.g., introduced bullet, missing H1), abort the mirror pass and fall back to forward-only decision.

6. **Mirror parse null fallback**: When forward=ACCEPT and mirror returns null (parse fail / API error), don't blindly drop. Recommended fallback: apply with confidence 0.6 (between full-double-pass 1.0 and single-pass 0.3 — partial-failure tolerance from existing `aggregateWinners` pattern).

7. **`mirrorEdits.ts` API surface**: 4 helpers — `invertAtomicEdit(edit, appliedState)`, `constructMirrorGroup(group, originalArticle, resultingArticle)`, `roundTripApply(group, article)` (verification), `renderMirrorMarkup(originalArticle, forwardGroups) → { mirrorArticleA', mirrorMarkupString, mirrorGroups }`.

### Open question — config field colocation

The new `proposer_approver_criteria_generate` agent type has many fields (`criteriaIds`, `weakestK`, `editingModel`, `approverModel`, `lengthCapRatio`, `redundancyJaccardThreshold`?). Two options:
- **A**: Create a new agent type with its own field cluster; fork from `iterative_editing` config schema.
- **B**: Reuse `iterative_editing` infrastructure where possible (the existing `editingMaxCycles`, `editingEligibilityCutoff` fields apply); only add criteria-specific fields (`criteriaIds`, `weakestK`).

Recommendation: **B** — saves code, but requires Zod refinements that distinguish "valid for `iterative_editing`" vs "valid for `proposer_approver_criteria_generate`" (some fields apply to both, some to only one). Will be settled in Phase 1 of the plan.

## Round 3 Findings (2026-05-06): Agent Registration, Dispatch, Schema, Cost

### AgentName + cost-metric routing

**Single-pass agent**: REUSE existing `'evaluate_and_suggest'` AgentName label. Zero schema churn. Both V1 and V2 wrappers route to `evaluation_cost`. Distinguish at the agent-class / `detailType` level, not the LLM call label level.

**Propose/approve agent**: 3 NEW AgentName labels — `'criteria_proposer'`, `'criteria_forward_approver'`, `'criteria_mirror_approver'`. All three bucket to a single new metric `'proposer_approver_criteria_cost'` via `COST_METRIC_BY_AGENT`. Per-purpose split lives in `execution_detail.cycle.{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}`.

**Propagation metrics** (strategy / experiment level):
- `total_proposer_approver_criteria_cost` (sum, `listView: true`)
- `avg_proposer_approver_criteria_cost_per_run` (avg)

**OUTPUT_TOKEN_ESTIMATES additions** (in `createEvolutionLLMClient.ts`):
- `criteria_proposer: 4800` (full article + markup)
- `criteria_forward_approver: 600` (JSONL with guardrail flags)
- `criteria_mirror_approver: 600`

**Cost calibration phase enum**: `costCalibrationLoader.ts:CalibrationRow.phase` is the TS source of truth; no DB CHECK constraint enforced today (per agent investigation). Adding the 3 new labels to the TS union is sufficient. **Optional** DB migration to add a CHECK constraint `evolution_cost_calibration_phase_allowed`. **Watch for** `assertCostCalibrationPhaseEnumsMatch` startup gate documented in `evolution/docs/agents/overview.md` — if it queries the DB CHECK, DB migration must precede code deploy.

### Cost estimator integration

**Single-pass**: NO new estimator. Reuse `estimateGenerationCost(seedArticleChars + 200, ...) + estimateRankingCost(...)` — the +200 char delta captures the new guardrail directives in customPrompt. The eval phase (`estimateEvaluateAndSuggestCost`) is unchanged.

**Propose/approve**: NEW function in `evolution/src/lib/pipeline/infra/estimateCosts.ts` after line 416:
```typescript
estimateProposerApproverCriteriaCost(
  seedArticleChars, editingModel, approverModel, judgeModel,
  criteriaCount, weakestK, avgRubricChars,
  includesMirrorApprover, poolSize, maxComparisonsPerVariant,
): { expected, upperBound, expectedRanking, upperBoundRanking }
```
5 layers: eval (reuse `estimateEvaluateAndSuggestCost`) + propose (reuse internal `estimateEditingProposeCost`) + forward approve + [mirror approve if `includesMirrorApprover`] + ranking. 1.3× safety margin on upper bound.

**`EstPerAgentValue` extension** (in `projectDispatchPlan.ts`):
```typescript
proposerApproverCriteria?: {
  evaluation: number; propose: number;
  approveForward: number; approveMirror: number;
  ranking: number; total: number;
};
```

**Kill switch**: `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED` (default `'true'`) mirrors `EDITING_RANK_ENABLED`. Also: `EVOLUTION_PROPOSER_APPROVER_CRITERIA_MIRROR_ENABLED` (default `'true'`) for the mirror-approver pass — lets us A/B mirror vs no-mirror without code change.

### Zod schema extension — 6 files, ~45 lines

**Locations** (all in `evolution/src/lib/schemas.ts` unless noted):
1. `iterationAgentTypeEnum` (line 478) — add 2 enum values.
2. `iterationConfigSchema` (lines 522-597) — add 4 new optional fields: `lengthCapRatio?: z.number().min(1.01).max(1.50)`, `redundancyJaccardThreshold?: z.number().min(0).max(1)`, `includesMirrorApprover?: z.boolean()`. Reuse existing `editingModel` / `approverModel` / `editingMaxCycles` / `editingEligibilityCutoff` for `proposer_approver_criteria_generate`.
3. **6 new `.refine()` blocks**:
   - `criteriaIds` valid for the 3 criteria-based agent types (extend existing).
   - `criteriaIds` REQUIRED + non-empty for those 3 types.
   - `weakestK` valid for those 3 types (extend existing).
   - `lengthCapRatio` rejected on types other than `proposer_approver_criteria_generate`.
   - `redundancyJaccardThreshold` rejected on types other than the 2 new criteria-based ones.
   - `includesMirrorApprover` rejected on types other than `proposer_approver_criteria_generate`.
   - `editingMaxCycles === 1` enforced for `proposer_approver_criteria_generate` (single-cycle by definition).
4. **Helper updates** (lines 484, 492, 500): `canBeFirstIteration`, `isVariantProducingAgentType`, `producesNewVariants` — add the 2 new agent types to all three.
5. **`evolution/src/lib/pipeline/infra/types.ts`** (line 31): extend `IterationResult.agentType` union.
6. **`evolution/src/services/strategyPreviewActions.ts`** (lines 168, 208): extend `previewDispatchPlanSchema` enum + `IterationPlanEntryClient` union.
7. **`evolution/src/services/strategyRegistryActions.ts`** (line 158): extend `validateCriteriaIds` filter — `flatMap` across 3 criteria-based types.
8. **`evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`** (lines 50-56, 76-85): extend `canonicalizeIterationConfig` to include new fields in hash; extend `labelStrategyConfig` (`Nx single-pass-criteria + Mx proposer-approver`).

### `runIterationLoop.ts` dispatch (line 341+)

Current shape: `if (iterType === 'generate' || iterType === 'reflect_and_generate' || iterType === 'criteria_and_generate')` unifies the 3 variant-producing types (line 341, ~lines 342-785). Inside, line 508-520 instantiates `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` when `agentType === 'criteria_and_generate'`.

**Plan**: Extend the line-341 condition to include the 2 new types:
```typescript
if (iterType === 'generate' || iterType === 'reflect_and_generate' 
    || iterType === 'criteria_and_generate'
    || iterType === 'single_pass_evaluate_criteria_and_generate') { ... }
```

The single-pass type is a near-clone of `criteria_and_generate` and shares the same dispatch path (just instantiates a different wrapper class with the new guardrails).

The `proposer_approver_criteria_generate` type needs a separate `else if` branch since it follows the IterativeEditingAgent shape (per-parent dispatch, no parallel batch / top-up loop). Mirrors lines 786-944 (`'iterative_editing'` branch).

### `execution_detail` discriminated union extension (`schemas.ts:1565-1583`)

**`singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema`** (insert after line 1414):
- `detailType: 'single_pass_evaluate_criteria_and_generate'`, `tactic: 'criteria_driven'`
- `weakestCriteriaIds`, `weakestCriteriaNames`
- `evaluateAndSuggest` sub-object (same shape as existing wrapper)
- `generation` + `ranking` sub-objects (reused from GFPA)
- `surfaced`, `discardReason`, `totalCost`, `estimatedTotalCost`, `estimationErrorPct`
- **NEW** `guardrails: { redundancyDropCount, flowDropCount, lengthCapHit: boolean }` — mostly observational for single-pass (no edit groups means redundancy/flow dropCount always 0; only `lengthCapHit` is a meaningful post-hoc check on output text).

**`proposerApproverCriteriaGenerateExecutionDetailSchema`** (insert after the above):
- `detailType: 'proposer_approver_criteria_generate'`, `tactic: 'criteria_driven'`
- `weakestCriteriaIds`, `weakestCriteriaNames`, `evaluateAndSuggest` sub-object
- **NEW `cycle` sub-object** (single cycle):
  ```typescript
  cycle: {
    proposedGroupsRaw: number,
    droppedPreApprover: [{ groupNumber, reason }],
    approverGroups: number,
    forwardDecisions: [{ groupNumber, decision, reason, redundancy_violation?, flow_violation?, length_violation? }],
    mirrorDecisions: [{ groupNumber, decision, reason, redundancy_violation?, flow_violation?, length_violation? }],
    appliedGroups: number,
    droppedPostApprover: [{ groupNumber, reason }],
    proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd,
    childText?: string,  // round-trip verification — feature-flag in prod
  }
  ```
- `ranking` sub-object (reused)
- `surfaced`, `discardReason`, `totalCost`, etc.
- **NEW** `mirrorAgreementRate: number` (= `appliedGroups / approverGroups`) and `mirrorAbortReason?: 'a_prime_format_invalid' | 'mirror_parse_null'` for telemetry.

Both schemas added to `agentExecutionDetailSchema` discriminated union (line 1565-1583).

### Wrapper-error invariant I3 (Agent.ts:175-189)

Confirmed: `Agent.run()`'s catch handler at line 179 calls `updateInvocation` with only `cost_usd`, `success: false`, `error_message`, `duration_ms` — does NOT touch `execution_detail`. The `trackInvocations.updateInvocation` conditional-spread preserves any partial detail the wrapper wrote BEFORE re-throwing. Both new agents must follow this pattern (write partial `execution_detail` via direct `updateInvocation` call before re-throwing on any helper failure). Critical for debuggability of the multi-LLM-call propose/approve cycle.

## Round 4 Findings (2026-05-06): Metrics, UI, DB, Migrations

### Criteria-level metrics — agent-agnostic (almost)

`computeCriteriaMetricsForRun` in `evolution/src/lib/metrics/computations/criteriaMetrics.ts:170-194` already aggregates across any variant with non-null `criteria_set_used` — no `agent_name` filter. Both new agent types automatically contribute to:
- `avg_score` (per-criterion mean LLM score across runs)
- `frequency_as_weakest`
- `total_variants_focused`
- `avg_elo_delta_when_focused`
- `total_evaluation_cost`

**ONE call site needs extension** (`criteriaMetrics.ts:118`): the `avg_score` computation currently filters `agent_name = 'evaluate_criteria_then_generate_from_previous_article'` (hardcoded). Change to `.in([3 criteria-based agent types])`.

**Stale cascade trigger** (migration `20260503033105_extend_mark_elo_metrics_stale_for_criteria.sql`): fires on any variant `mu`/`sigma` change regardless of `agent_name`, cascades to criteria entity metrics where `weakest_criteria_ids` array contains the criterion. Already covers new agent types.

**New criteria-level metric (proposed)**: `total_proposer_approver_criteria_cost` — sums the `proposer_approver_criteria_cost` rows from invocations whose variant had this criterion in `weakest_criteria_ids`. Surfaces "$X spent in propose/approve runs targeting clarity" on the criteria detail page. Add to METRIC_REGISTRY at criteria entity level + register propagation to strategy/experiment.

### Strategy wizard UI — minimal extensions

**File**: `src/app/admin/evolution/strategies/new/page.tsx` (~50 lines of net changes)

**Changes needed**:
1. Per-iteration `agentType` `<select>` (lines 975-986): add 2 new `<option>` entries.
2. `IterationRow` type (line 37) + `IterationConfigPayload` (line 95): extend agentType union + add 3 new optional fields.
3. New conditional render blocks (after line 1205): one for each new agent type. Reuse `CriteriaMultiSelect`, weakestK input, model selectors. New numeric inputs for `redundancyJaccardThreshold` (default 0.35), `lengthCapRatio` (default 1.10, propose/approve only), checkbox for `includesMirrorApprover` (default true).
4. `editingMaxCycles` rendered as read-only "1 cycle (single-pass fixed)" for `proposer_approver_criteria_generate` (Zod-locked).
5. `updateIteration` callback (lines 473-522): add field-clearing branches for each new type.
6. `canBeFirstIteration` + `isVariantProducing` helpers: include new types.
7. `toIterationConfigsPayload`: emit the new fields conditionally.
8. Budget allocation bar colors (line 1230): cyan for single-pass, purple for propose/approve. Add legend entries.
9. `iterationErrors` validation: extend the criteria-required check to all 3 criteria-based types.

**`DispatchPlanView` is future-proof**: reads `entry.estPerAgent.expected.total` directly — no hardcoded cost-field list. The new `proposerApproverCriteria` peer field on `EstPerAgentValue` (per Round 3) flows through automatically. Only the agent-type badge color logic (line 129-137) needs a 2-line extension.

**`strategyPreviewActions.ts:dispatchPreviewInputSchema` (line 168)**: extend the agentType enum + add the 3 new optional fields.

### Invocation detail page — tab layouts

**File**: `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx`

**`single_pass_evaluate_criteria_and_generate`** — 5-tab layout (clone of existing wrapper):
1. **Eval & Suggest** — `keyFilter` matches `tactic + weakestCriteria* + evaluateAndSuggest*`.
2. **Generation** — keyFilter matches everything else (variantId, generation, ranking, guardrails).
3. **Metrics** — generic.
4. **Timeline** — 3-segment bar (emerald eval / blue gen / purple rank). Same colors as existing wrapper.
5. **Logs** — generic.

`detailViewConfigs.ts` entry: near-clone of `evaluate_criteria_then_generate_from_previous_article` with addition of a `guardrails` object (children: `redundancyDropCount`, `flowDropCount`, `lengthCapHit`).

**`proposer_approver_criteria_generate`** — 8-tab layout (multi-cycle):
1. **Eval & Suggest** — `keyFilter` to `tactic + weakestCriteria* + evaluateAndSuggest*`.
2. **Proposer** — `cycle.proposedGroupsRaw` count + `cycle.droppedPreApprover` list.
3. **Approver (Forward)** — `cycle.forwardDecisions` table with guardrail-violation columns.
4. **Approver (Mirror)** — `cycle.mirrorDecisions` table; `mirrorAgreementRate` badge; `mirrorAbortReason` if present.
5. **Apply** — `cycle.appliedGroups` count + `cycle.droppedPostApprover` list.
6. **Metrics** — generic.
7. **Timeline** — 5-segment bar.
8. **Logs** — generic.

**Timeline colors for propose/approve**:
- `EVALUATE_AND_SUGGEST_COLOR = '#10b981'` (emerald, reused)
- `CRITERIA_PROPOSER_COLOR = '#3b82f6'` (blue — reuse generation blue)
- `CRITERIA_APPROVER_FORWARD_COLOR = '#f97316'` (orange)
- `CRITERIA_APPROVER_MIRROR_COLOR = '#ea580c'` (deep orange — visually paired with forward)
- `RANKING_COLOR = '#8b5cf6'` (purple, reused)

`InvocationTimelineTab.tsx`: extend with proposer/approver duration fields (read from `cycle.proposeCostUsd`/`approveForwardCostUsd`/`approveMirrorCostUsd` plus new `*DurationMs` fields) and 3 new bar segments rendered in sequence.

**Suggestion tables** keep `cellClassName: 'max-w-md break-words whitespace-pre-wrap align-top'` for long-passage wrapping.

### DB migrations — REQUIRED (correction to Round 3 finding)

**Round 3 was wrong**: a CHECK constraint DOES exist on `evolution_cost_calibration.phase` — added in migration `20260501204142_evolution_cost_calibration_editing_phases.sql`. The startup assertion `assertCostCalibrationPhaseEnumsMatch` (in `evolution/src/lib/core/startupAssertions.ts:19-42`) queries this constraint by name and throws `MissingMigrationError` if TS phase strings exceed the DB list.

**REQUIRED migration**: extend the `evolution_cost_calibration_phase_allowed` CHECK constraint to add the 3 new propose/approve labels (`criteria_proposer`, `criteria_forward_approver`, `criteria_mirror_approver`). Migration must precede code deploy. Migration file content draft:
```sql
ALTER TABLE evolution_cost_calibration
  DROP CONSTRAINT IF EXISTS evolution_cost_calibration_phase_allowed;

ALTER TABLE evolution_cost_calibration
  ADD CONSTRAINT evolution_cost_calibration_phase_allowed
  CHECK (phase IN (
    'generation', 'ranking', 'seed_title', 'seed_article', 'reflection',
    'evaluate_and_suggest',
    'iterative_edit_propose', 'iterative_edit_review', 'iterative_edit_drift_recovery',
    'criteria_proposer', 'criteria_forward_approver', 'criteria_mirror_approver'
  ));
```

**No other DB migrations needed.** The variants/metrics/criteria schema is already forward-compatible:
- `evolution_variants.criteria_set_used` and `weakest_criteria_ids` columns already exist (migration `20260503033104`).
- `evolution_metrics.entity_type` CHECK already includes `'criteria'` (migration `20260503033103`).
- `evolution_metrics.metric_name` has no CHECK constraint, so new metric names like `proposer_approver_criteria_cost` insert freely.
- `mark_elo_metrics_stale` trigger cascades to criteria metrics for any variant regardless of producing agent (migration `20260503033105`).

**No data backfill needed** — both new agents' variants and metrics start accumulating from first run.

**Sample criteria** (`evolution/scripts/seedSampleCriteria.ts`): the 7 seeded criteria already include the PR #1032-refined POV + engagement rubrics. Both new agents inherit these. **No new seed needed** for the agents themselves; the user can independently decide to seed a "factual content" criterion pack (out of scope unless requested).

### Caveat — agent name typo in one investigation output

One Round 4 agent referred to the propose/approve agent as `propose_and_approve_criteria_based` instead of `proposer_approver_criteria_generate`. The user's spec says `proposer_approver_criteria_generate` — that's the canonical name throughout the plan. Detail-view-config entries and tab dispatch must use the canonical name.

## Round 5 Findings (2026-05-06): Migration, Kill Switches, Tests, Docs

### Legacy `criteria_and_generate` migration — RECOMMEND COEXIST

**Recommendation: Option B (coexist with sunset plan)**, settling the deferred decision.

Reasons:
- The new single-pass agent has user-visible behavior changes (new guardrails, possibly tighter length cap). Silent routing (Option C) hides the difference from metrics + audit trail.
- Audit-trail clarity is critical for the success metric: comparing "old criteria runs" vs "new single-pass runs" Elo deltas requires distinct enum values.
- Marginal code cost is small — both wrappers share `buildEvaluateAndSuggestPrompt` and `parseEvaluateAndSuggest` (already module-scoped in `evaluateCriteriaThenGenerateFromPreviousArticle.ts:92-130`). The new wrapper class is ~50 LOC of boilerplate around shared helpers.

**Sunset plan (proposed):**
1. **Phase A (parallel period — ~2-4 weeks of staging runs)**: Both agents in the enum; new strategies default to single-pass; old strategies untouched; researcher manually triggers comparison runs.
2. **Phase B (UI deprecation)**: Hide `'criteria_and_generate'` from the wizard's agent-type dropdown (still in enum, still works for existing strategies).
3. **Phase C (hard deprecation)**: After validation that the new agent matches/exceeds, remove from enum + emit `MissingMigrationError` if any strategy still references it.

The plan codes Phase A only; Phase B/C are follow-on projects gated by the validation results.

### Kill switches — 7 new env vars

All follow the existing convention `process.env.FLAG !== 'false'` (default-on; only the literal string `'false'` disables).

| Flag | Default | Effect when `'false'` | Resolution site |
|------|---------|----------------------|-----------------|
| `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED` | `'true'` | Single-pass agent dispatch falls back to vanilla `criteria_and_generate` (no new guardrails). Lets us A/B old vs new wrapper without code revert. | `runIterationLoop.ts` ~341 + `strategyPreviewActions.ts` ~285 |
| `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED` | `'true'` | Propose/approve dispatch rejected: log warn, treat iteration as zero-variants. No fallback. | `runIterationLoop.ts` ~341 + `strategyPreviewActions.ts` ~285 |
| `EVOLUTION_PROPOSER_APPROVER_CRITERIA_MIRROR_ENABLED` | `'true'` | Skip mirror pass; apply edits based on forward approver only. | Inside agent's `execute()` method |
| `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED` | `'true'` | Skip post-cycle ranking — variant lands at default Elo, no `arena_comparisons` rows. | `runIterationLoop.ts` editing branch |
| `EVOLUTION_CRITERIA_REDUNDANCY_GUARDRAIL_ENABLED` | `'true'` | Skip trigram Jaccard check in `validateEditGroups`. | Validator entry point |
| `EVOLUTION_CRITERIA_FLOW_GUARDRAIL_ENABLED` | `'true'` | Skip transition-word regex hard rule. | Validator entry point |
| `EVOLUTION_CRITERIA_LENGTH_GUARDRAIL_ENABLED` | `'true'` | Ignore `lengthCapRatio` field; fall back to existing 1.5× cap. | Validator entry point |

**Wizard preview integration** — extend `DispatchPlanOptions`:
```typescript
interface DispatchPlanOptions {
  // existing
  singlePassCriteriaEnabled?: boolean;
  proposerApproverCriteriaEnabled?: boolean;
  proposerApproverCriteriaMirrorEnabled?: boolean;
  proposerApproverCriteriaRankEnabled?: boolean;
}
```
Resolved at server-action boundary in `getStrategyDispatchPreviewAction` and threaded into `projectDispatchPlan` so the wizard cost projection matches runtime under the same env config.

**Pre-existing flags that newly apply**: `COST_CALIBRATION_ENABLED`, `EVOLUTION_PERMISSIVE_EVAL_PARSER` (both inherited via shared helpers).

### Test budget — ~75 tests + property suite (~10 days engineering)

| Component | File(s) | Test count |
|-----------|---------|------------|
| Single-pass unit | `singlePassEvaluateCriteriaAndGenerate.test.ts` | 15 |
| Propose/approve unit | `proposerApproverCriteriaGenerate.test.ts` | 35 (12 cycle + 10 mirror + 8 parser + 5 applier) |
| `mirrorEdits.ts` helpers | `mirrorEdits.test.ts` + `mirrorEdits.property.test.ts` | 8 + 4 property invariants |
| Guardrails | `checkSemanticOverlap.test.ts` (new) + extend `validateEditGroups.test.ts` | 7 |
| Integration | `evolution-single-pass-criteria.integration.test.ts`, `evolution-proposer-approver-criteria.integration.test.ts` | 8 |
| E2E | extend `admin-strategy-wizard.spec.ts`, new `admin-evolution-run-single-pass.spec.ts`, new `admin-evolution-run-proposer-approver.spec.ts` | 8 |

**Mirror-approver mock LLM strategy**: extend `createV2MockLlm` (`evolution/src/testing/v2MockLlm.ts`) to support **label-based response routing** so `Promise.all([llm.complete(forward, 'criteria_proposer'), llm.complete(mirror, 'criteria_mirror_approver')])` returns distinct mocks per call. Existing mock supports a queue mechanism but label-based routing is cleaner and doesn't depend on call order.

**`mirrorEdits.ts` property-test invariants** (via `fast-check`, ~200 iterations each):
1. **Round-trip idempotency**: `applyEdits(edits, text) |> applyEdits(invertEdits(edits), _) === text`.
2. **Double-inversion identity**: `invertAtomicEdit(invertAtomicEdit(e)) === e`.
3. **Range boundaries**: inverted edits never produce ranges outside `[0, text.length]`.
4. **Context capture preserved**: `contextBefore.length <= 30 && contextAfter.length <= 30`.

### Documentation updates — 11 existing docs + 1 new deep dive

**11 existing docs needing surgical edits:**
1. `evolution/docs/architecture.md` — § Agent Types + § Criteria-driven generation: mention new agents, link to deep dive.
2. `evolution/docs/agents/overview.md` — § V2 Config-Driven Iteration Loop (extend agent-type enum); add new section after `EvaluateCriteriaThen...` for each new agent.
3. `evolution/docs/strategies_and_experiments.md` — § IterationConfig: extend enum + new field docs.
4. `evolution/docs/cost_optimization.md` — § Per-purpose cost split + new "Proposer-Approver Criteria Cost" subsection mirroring "Evaluate-and-Suggest Cost".
5. `evolution/docs/data_model.md` — § evolution_variants columns: confirm `criteria_set_used` / `weakest_criteria_ids` apply to new agents (mostly unchanged); glossary update if introducing terminology.
6. `evolution/docs/metrics.md` — § Run Metrics + § Strategy/Experiment Metrics: add `proposer_approver_criteria_cost` + propagation rows.
7. `evolution/docs/visualization.md` — § Timeline tab + § Invocation detail page: new badges, new tab layouts (5-tab single-pass + 8-tab propose/approve), color constants.
8. `evolution/docs/reference.md` — § Configuration EvolutionConfig Validation (enum extension), § Environment Variables, § Kill Switches table (7 new rows).
9. `evolution/docs/multi_iteration_strategies.md` — § IterationConfig Schema (enum + new fields).
10. `evolution/docs/curriculum.md` — § Glossary: add "Mirror Approver", "Redundancy Guardrail", etc.
11. `evolution/docs/editing_agents.md` — only add a cross-reference link; do NOT extend (the new agent is structurally distinct).

**NEW deep-dive doc**: `evolution/docs/criteria_agents.md` (~300-500 lines). Sections:
- Overview: single-pass vs propose/approve, when to use each.
- Algorithm (per cycle): proposer → pre-check → forward approver → mirror approver → applier.
- Mirror-approver protocol detail (with diagrams + worked example showing insert vs delete vs replace mirroring).
- Configuration: per-iteration fields, strategy-level model fields.
- Guardrail mechanisms: redundancy (trigram Jaccard) + flow (transition regex + approver rubric) + length (1.10× cap).
- Cost tracking: per-cycle split (`proposeCostUsd`, `approveForwardCostUsd`, `approveMirrorCostUsd`, ranking).
- Operational metrics: `mirrorAgreementRate`, drift telemetry.
- Kill switches: 7 env vars.
- Files: code reference index.

Cross-references from `architecture.md`, `agents/overview.md`, `editing_agents.md`.

## Open Questions for Plan Phase

Capturing items the plan needs to settle that the research left ambiguous:

1. **Single-pass tactic name**: reuse `'criteria_driven'` (per Round 1 finding — required by GFPA's misconfiguration guard) for both new agents OR introduce two new sentinels (`'criteria_driven_single_pass'`, `'criteria_driven_propose_approve'`)? Current lean: reuse `'criteria_driven'` for both; distinguish at `detailType` discriminator level. Plan can decide.

2. **`mirrorEdits.ts` location**: under `evolution/src/lib/core/agents/editing/` (alongside existing helpers) OR new directory `evolution/src/lib/core/agents/proposerApproverCriteria/`? Lean: under `editing/` since the CriticMarkup primitives live there; group via filename prefix (`mirrorEdits.ts`).

3. **`mirrorAgreementRate` thresholds for alerting**: similar pattern to `iterative_edit_drift_rate` (env-tunable threshold). What's a reasonable default? E.g., alert if `< 0.20` (very low agreement → strong bias signal) or `> 0.95` (rubber-stamp signal). Plan can choose; default `< 0.20` AND `> 0.95` both flagged.

4. **Per-iteration `mirrorEnabled` field**: should the iteration config carry an `includesMirrorApprover?: boolean` (per Round 3 — wizard checkbox) AND the env var `EVOLUTION_PROPOSER_APPROVER_CRITERIA_MIRROR_ENABLED` AS A KILL SWITCH? Current lean: BOTH — config field is the per-strategy decision, env var is the global kill switch. Mirror runs only if config field AND env var both enabled.

5. **Approver cycle vs cycles[]**: Round 3 schema sketch had `cycle:` (singular) since mirroring `IterativeEditingAgent`'s `cycles:` (array, length up to 5) is overkill for single-cycle. Confirm singular naming in execution_detail to avoid confusion with the editing agent's array shape.

## Documents Read

### Core (3)
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution (22)
All docs in `evolution/docs/` plus the planning doc from `multi_iteration_strategy_support_evolution_20260415`.

### Code files (representative, read by Round 1-5 agents)
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts`
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts`
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts`, `approverPrompt.ts`, `parseProposedEdits.ts`, `applyAcceptedGroups.ts`, `validateEditGroups.ts`, `checkProposerDrift.ts`, `recoverDrift.ts`, `parseReviewDecisions.ts`
- `evolution/src/lib/shared/reversalComparison.ts`
- `evolution/src/lib/comparison.ts`
- `evolution/src/lib/core/agentNames.ts`
- `evolution/src/lib/core/Agent.ts`
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts`
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`
- `evolution/src/lib/pipeline/loop/editingDispatch.ts`
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`
- `evolution/src/lib/pipeline/infra/estimateCosts.ts`
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`
- `evolution/src/lib/metrics/registry.ts`
- `evolution/src/lib/metrics/computations/criteriaMetrics.ts`
- `evolution/src/lib/schemas.ts`
- `evolution/src/services/strategyPreviewActions.ts`
- `evolution/src/services/strategyRegistryActions.ts`
- `evolution/src/services/criteriaActions.ts`
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`
- `evolution/src/lib/core/startupAssertions.ts`
- `evolution/src/components/evolution/DispatchPlanView.tsx`
- `src/app/admin/evolution/strategies/new/page.tsx`
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx`
- `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`
- `evolution/src/lib/core/detailViewConfigs.ts`
- `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx`
- `evolution/scripts/seedSampleCriteria.ts`
- `supabase/migrations/20260501204142_evolution_cost_calibration_editing_phases.sql`
- `supabase/migrations/20260503033103_extend_metrics_entity_type_for_criteria.sql`
- `supabase/migrations/20260503033104_evolution_variants_criteria_columns.sql`
- `supabase/migrations/20260503033105_extend_mark_elo_metrics_stale_for_criteria.sql`
- Test files: `evaluateCriteriaThenGenerateFromPreviousArticle.test.ts`, `IterativeEditingAgent.test.ts`, `parseProposedEdits.test.ts`, `applyAcceptedGroups.test.ts`, `admin-strategy-wizard.spec.ts`

## Carry-Over from `understand_critera_agent_performance_evolution_20260503`

(Content below is verbatim from the prior project's research doc as the baseline for this project's investigation. Cited here so the original problem statement, methodology, and post-merge analysis stay one click away.)

---

## Problem Statement (prior project)

I want to investigate recent criteria agent-focused runs and understand why performance is worse than I expected. Use @docs/docs_overall/debugging.md to query stage db and look at the last few

## Requirements (from GH Issue #NNN)

(Expanded during research — see High Level Summary and Key Findings below.)

## High Level Summary

The criteria agent (`evaluate_criteria_then_generate_from_previous_article`, shipped 2026-05-01 in PR #1023) is producing **-47 Elo mean delta** vs parents (vs +16-23 Elo for vanilla generate / structural_transform). 95 child variants from 5 runs on staging, all from a single strategy ("Criteria based generation") testing 7 seeded sample criteria with `weakestK=2` against the Federal Reserve article prompt.

**Three root causes**, ranked by share-of-blame:

1. **Misconfigured rubrics for educational content (DOMINANT).** The seeded `point_of_view` rubric explicitly equates neutral writing with score 1 ("reads like a Wikipedia summary" — pejorative); the LLM reliably scores it 4.15/10 (lowest of any criterion) and focuses on it 96.8% of the time. The seeded `engagement` rubric demands "reader can't put it down" pacing unsuitable for technical content; pushed toward sensationalist "evocative" / "intriguing" language. Together POV + engagement drive ~75% of weakestK=2 focus pairs and produce -47.55 / -41.87 Elo when focused.

2. **`customPrompt` template invites bloat (CONTRIBUTING).** The wrapper builds GFPA's prompt with "Apply these specific fixes" + suggestion verbs ("introduce", "frame", "add") and never instructs the LLM to preserve length. Worst-case variants bloat 29-45% with clunky meta-commentary or tone inflation. (Caveat: reflection wrapper bloats 16.7% and works fine — bloat alone isn't the killer; bloat *of bad suggestions* is.)

3. **Mechanical GFPA execution of bad suggestions.** The 5 best criteria-driven variants ALSO focus on POV+engagement but apply suggestions surgically (1-17% length change, even -1.4% in one case) and produce genuinely better articles. The agent CAN execute well; the failure mode is qualitative, not categorical.

**Refuted hypotheses:**
- Regression-to-mean: Reflection uses the same `sourceMode='pool'` and faces an identical parent-Elo climb (19→26→29→30 across iterations) yet achieves positive deltas — refuting R2C's claim that RTM explains 95% of the criteria delta.
- Parser bugs: 3% parse-error rate, all due to "zero valid suggestions remained after weakest-K filter"; not a dominant failure.
- LLM judge noise: Mean confidence 0.766; judge is decisive, not shaky.
- Cost / latency / operational issues: 96.9% success rate, $0.0018/invocation median, 13.3s median latency. Operationally healthy.

**Caveats:** Sample is thin — 5 runs, 1 strategy, 1 prompt (Federal Reserve, highly factual content). Findings may not extrapolate to opinion-driven content prompts.

## Documents Read

### Core
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

### Evolution (full directory, including the 4 newly-moved deep dives)
- `evolution/docs/README.md`
- `evolution/docs/architecture.md`
- `evolution/docs/agents/overview.md`
- `evolution/docs/arena.md`
- `evolution/docs/cost_optimization.md`
- `evolution/docs/curriculum.md`
- `evolution/docs/data_model.md`
- `evolution/docs/entities.md`
- `evolution/docs/logging.md`
- `evolution/docs/metrics.md`
- `evolution/docs/minicomputer_deployment.md`
- `evolution/docs/rating_and_comparison.md`
- `evolution/docs/reference.md`
- `evolution/docs/strategies_and_experiments.md`
- `evolution/docs/visualization.md`
- `evolution/docs/sample_content/api_design_sections.md`
- `evolution/docs/sample_content/filler_words.md`
- `evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md`
- `evolution/docs/evolution_metrics.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/variant_lineage.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/multi_iteration_strategies.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/editing_agents.md` (moved from `docs/feature_deep_dives/`)

### Tracked for this project
- `docs/docs_overall/debugging.md` — `npm run query:staging` workflow, evolution-specific debugging recipes.
- `docs/planning/evaluateCriteriaThenGenerateFromPreviousArticle_20260501/evaluateCriteriaThenGenerateFromPreviousArticle_20260501_planning.md` — full implementation plan; key for understanding the customPrompt design + the seeded sample criteria definitions.
- `docs/planning/evaluateCriteriaThenGenerateFromPreviousArticle_20260501/evaluateCriteriaThenGenerateFromPreviousArticle_20260501_research.md` — architectural decisions (combined LLM call, attribution dimension, marker tactic).
- `docs/research/judge_agreement_summary_tables.md` — qwen-2.5-7b judge accuracy data (decisive on close pairs at all temps; explains why the -47 Elo signal isn't judge noise).

## Code Files Read (during agent investigation, primarily by Round 1D and Round 3C)

- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — wrapper agent class (especially `buildCustomPromptFromSuggestions` at lines 253-268 and the weakest-K selection logic at lines 486-490).
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — inner GFPA `customPrompt` branch and `criteria_driven` tactic guard.
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — `buildEvolutionPrompt` assembly (preamble + parent + instructions + FORMAT_RULES).
- `evolution/src/lib/shared/formatRules.ts` (or `enforceVariantFormat.ts`) — FORMAT_RULES text; does not cap length.
- `evolution/src/lib/core/tactics/generateTactics.ts` — vanilla tactic prompts for comparison.
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema` refinements for `criteria_and_generate`.
- `evolution/src/services/criteriaActions.ts` — `getCriteriaForEvaluation`, `validateCriteriaIds`.
- `evolution/scripts/seedSampleCriteria.ts` — the 7 seeded sample criteria with their rubrics (THE root cause for the misconfigured ones).

## Key Findings (numbered)

1. **point_of_view rubric is misconfigured for educational content.** Anchor 1 = "reads like a Wikipedia summary" (pejorative); anchor 10 = "argues for something specific". For factual articles like the Federal Reserve, the LLM correctly scores it low (avg 4.15) and the suggestions push toward opinionated framing — which the standard quality judge then marks as worse.

2. **engagement rubric demands page-turner pacing unsuitable for technical content.** Anchor 1 = "reader bounces", anchor 10 = "reader can't stop until the end". Suggestions push toward "evocative phrases", "intrigue", and titles like "The Fed's Secret Hand". 96/98 invocations generate suggestions for it; produces -41.87 Elo when focused.

3. **clarity / structure / tone / sentence_variety rubrics are well-configured.** Average scores 6.37-8.67; never picked as weakest by the LLM (correct behavior). These don't need changes.

4. **depth rubric is well-configured but mechanically over-applied.** Suggestions are sensible (concrete examples, mechanism explanation) but produces -56.82 Elo when focused — likely because GFPA elaborates depth into bloat rather than depth into substance.

5. **The customPrompt template invites bloat through asymmetric framing.** "Apply these specific fixes" + suggestion verbs ("introduce", "frame", "add", "integrate") with no length-preservation instruction. Vanilla `structural_transform` says "preserve all key points exactly" which creates implicit pressure against bloat; criteria's customPrompt has no equivalent.

6. **Bloat by itself doesn't cause negative deltas.** Reflection wrapper bloats MORE than criteria (16.7% vs 11.8% length ratio) but achieves positive deltas. What matters is whether the additions add value. Reflection picks expansion-suitable tactics (engagement_amplify, analogy_bridge); criteria's LLM-generated suggestions push toward opinion / sensationalism that the judge correctly downscores.

7. **The agent CAN work well — best 5 variants tell us what success looks like.** They focus on the same POV+engagement criteria but apply suggestions surgically: 1-17% length change (one variant -1.4%), reframing neutrality into "perspective-driven narrative" connecting Fed policy to reader's stakes ("Imagine a world where your paycheck's value fluctuates wildly"). Quality is genuinely better, not just "less bloated".

8. **Regression-to-mean is real but minor.** Pool-mode parents are ~+4 mu above population mean (29.28 vs 25). Reflection faces the same headwind (uses pool mode for iters 2+, same parent-Elo climb 19→26→29→30) and still achieves positive deltas — refuting R2C's "RTM explains 95%" claim. Switching to seed mode would only reclaim ~+4-6 Elo.

9. **Operational health is fine.** 96.9% success rate (3/98 fail at parser when ALL suggestions get filtered out); $0.0018 median cost per invocation; 13.3s median latency; 97.9% of successful invocations surface a variant. Judge confidence on criteria comparisons is 0.766 mean — decisive.

10. **Sample is tiny.** 5 runs, 1 strategy, 1 prompt (Federal Reserve), 1 set of 7 criteria. All from a 3.75-hour window on 2026-05-03. Findings about specific rubrics (POV, engagement) are well-supported by the code-level evidence; quantitative deltas should be re-measured after any fixes against more diverse prompts.

## Open Questions

1. **Will the rubric fixes generalize to opinion content?** The current evidence is from a factual-Fed article. POV / engagement rubrics may be valuable for opinion / persuasive content; a fix should preserve that use case (e.g., add an article-type field, or split into two rubric sets).

2. **Is the sample biased?** All 95 variants come from one strategy. Could the strategy author have tuned criteria for a different content type and tested on Fed by accident? Worth confirming with the user before declaring the seeded defaults unsuitable.

3. **What's the ratio of educational vs opinion content in the broader explanation pipeline?** If most ExplainAnything content is factual / educational, the seeded defaults need to bias that way.

4. **Should `depth` apply only when the parent has clear gaps?** Currently it's available as a focus target on every variant; if the parent is already detailed, "fill gaps" suggestions become "add filler".

## Recommended Next Steps (rough — formalize in plan-review)

**Phase 1 (lowest effort, highest impact, ~1 hour, all admin-UI edits):**
- Edit `point_of_view` rubric anchors via `/admin/evolution/criteria` UI to reframe around narrative voice + pedagogical fit (not "takes a stance").
- Edit `engagement` rubric anchors to anchor on logical example progression (not "reader can't put down").
- Re-run 2-3 small experiments on the same Federal Reserve prompt to confirm deltas improve.

**Phase 2 (if Phase 1 confirms improvement, ~2 hours code + test):**
- Code change: add length-preservation instruction to `buildCustomPromptFromSuggestions` in `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts:253-268`. Suggested addition: "Aim to preserve current word count (±10%) while improving the targeted criteria. Do not add new sections or examples; deepen or refactor existing ones."
- Update `evolution/scripts/seedSampleCriteria.ts` so the `npm run seed:criteria` script's POV + engagement rubrics use the new wording.

**Phase 3 (optional, if researchers want diverse content support):**
- Add an article-type field or split criteria into "educational" vs "opinion" rubric sets.
- Diversify the test set beyond the Federal Reserve article before drawing broader conclusions.

## Phase 1 Pre-Edit Snapshot (rollback insurance — 2026-05-03)

Captured from staging before admin-UI rubric edits. If Phase 1 needs to revert, paste these values back into the admin UI for each criterion.

### `point_of_view` (id: `226aa0f0-7280-4733-947a-b8227f1e59f8`)

- **min_rating**: 1
- **max_rating**: 10
- **description**: `Whether the article takes a clear stance or perspective rather than enumerating facts neutrally.`
- **evaluation_guidance**:
  - Score 1: `Pure enumeration; no perspective; reads like a Wikipedia summary.`
  - Score 5: `Implicit perspective; takes occasional positions but mostly neutral.`
  - Score 10: `Clear thesis or perspective; the article argues for something specific.`

### `engagement` (id: `d18c3316-9a36-424e-b0d3-e17655b06c9a`)

- **min_rating**: 1
- **max_rating**: 10
- **description**: `How well the article holds reader attention from start to finish.`
- **evaluation_guidance**:
  - Score 1: `No hook; reader bounces in the first paragraph.`
  - Score 5: `Mild interest; pacing flat or uneven.`
  - Score 10: `Compelling throughout; reader can't stop until the end.`

### Drain check (2026-05-03)

`SELECT id FROM evolution_runs WHERE status IN ('claimed','running') AND id IN (SELECT DISTINCT run_id FROM evolution_agent_invocations WHERE agent_name='evaluate_criteria_then_generate_from_previous_article')` returned **0 rows** — safe to edit without contaminating in-flight runs.

## Investigation Audit Trail

4 rounds × 4 Explore agents (16 total agent invocations on staging via `npm run query:staging`):

- **Round 1**: Inventory criteria runs + per-invocation breakdown + Elo delta vs siblings + agent code reading. Surfaced the -47 Elo headline and the POV-focus pattern.
- **Round 2**: Suggestion-vs-result diff (worst 5 variants), POV rubric deep-dive (smoking gun), pool-mode parent Elo distribution, logs + judge confidence. Confirmed POV rubric misconfiguration; produced (later refuted) RTM claim.
- **Round 3**: Best-performing variants (inverse view), depth + engagement rubric deep-dive, customPrompt rendered + bloat pattern, reflection-vs-criteria comparison. Showed agent can work surgically; engagement also misconfigured; bloat invited by customPrompt asymmetry; reflection bloats more but works.
- **Round 4**: Never-focused rubric check (clarity/structure/tone/sentence_variety all OK), reflection sourceMode comparison (refuted RTM claim — both use pool), counterfactual scenario modeling, code-level recommendations.

## Post-Merge Analysis (2026-05-05)

After PR #1032 merged and Phase 1 + Phase 2 changes shipped, ran 3 additional staging batches and quantitative analyses to validate the fix's behavior in the wild. **The headline finding shifted: the original "-47 Elo structural underperformance" framing was misleading. The typical (median) variant is roughly Elo-neutral; the negative mean is driven by a long-tail of catastrophic failures, not pervasive weakness.**

### Phase 2 staging validation (5 runs, n=90, original 7-criteria strategy)

After the customPrompt code change deployed via the merge, re-ran the same strategy. All 4 multi-signal indicators stayed favorable vs Phase 1:

| Signal | Pre-edit | Phase 1 (rubrics only) | Phase 2 (+ customPrompt) |
|--------|---------:|-----------------------:|--------------------------:|
| n | 95 | 92 | 90 |
| Mean Elo Δ | -47 | -36 | **-27.8** |
| Mean length ratio | 1.118 | 1.079 | 1.096 |
| Min length ratio | — | 0.924 | 0.948 |
| Max length ratio | — | 1.432 | 1.419 |
| POV focus rate | 96.8% | 77.2% | **71.1%** |
| Operational success | 96.9% | 100% | 100% |

The customPrompt change reclaimed an additional ~+8 Elo on top of the rubric reframing's ~+11 Elo. Cumulative trajectory: **-47 → -36 → -27.8 Elo (42% of original gap closed).**

### Limited-criteria experiment (5 runs, n=99, 4 criteria + weakestK=1)

Strategy: only 4 well-configured criteria (depth, sentence_variety, structure, tone) — POV and engagement deliberately omitted; weakestK reduced from 2 to 1.

| Signal | Phase 2 (7-crit, k=2) | **Limited (4-crit, k=1)** |
|--------|-----------------------:|---------------------------:|
| n | 90 | 99 |
| Mean Elo Δ | -27.8 | **-28.7** (≈ same) |
| Mean length ratio | 1.096 | **1.053** (best yet) |
| Max length ratio | 1.419 | **1.217** (much tighter) |
| Most-focused criterion | POV 71.1% | depth 57.4% |
| Parse failures | 0% | 2/101 (~2%) |

Removing POV/engagement + tightening k=1 produced the most surgical, conservative rewrites of any config tested. **Mean Elo plateaued ~-28 Elo regardless.** The 2 parse failures came from the LLM-vs-wrapper "weakest pick" disagreement (with k=1, the wrapper has a tighter target and mismatches happen more often).

### Suggestion-text profile (n=1473 LLM-generated suggestions across all 3 batches)

| Field | Mean chars | Notes |
|-------|-----------:|-------|
| `examplePassage` (quoted from parent) | 256 | ~50 words / 2-3 sentences |
| `whatNeedsAddressing` (issue) | 156 | ~30 words / 1-2 sentences |
| `suggestedFix` (instruction) | 208 | ~40 words / 1-2 sentences |
| **Total per suggestion** | **620** | ~120 words |

Across all batches: LLM produces ~5 suggestions per invocation, wrapper keeps ~3 and feeds them to the inner generator (drops ~2 because the LLM picked criteria the wrapper hadn't designated as weakest). **Each variant is rewritten from ~3 × 620 = ~1860 chars (~370 words) of structured guidance** — substantially more prescriptive than reflection's tactic prompts (~150-200 char preambles).

### Sentence-level parent-vs-child diff (n=281 across all 3 batches)

Initial paragraph-level diff overstated change rate (paragraph granularity is binary — a single edited sentence flips the whole paragraph as "changed"). Sentence-level analysis is far more accurate.

| Bucket | Mean % CHILD verbatim | Median % CHILD verbatim | Median % PARENT preserved |
|--------|---------------------:|------------------------:|--------------------------:|
| Phase 1 (7-crit, k=2) | 70.9% | 83.0% | 89.3% |
| Phase 2 (+customPrompt) | 74.2% | 81.0% | 87.8% |
| Limited (4-crit, k=1) | 71.9% | **86.1%** | **91.2%** |

**The typical (median) variant changes only ~14-19% of sentences.** Mean is higher (~25-29% changed) due to a long tail of near-total rewrites. The Limited config produced the most conservative changes (median 86.1% verbatim).

### Elo Δ percentile distribution by rewrite bucket (n=281, sentence-level)

The crucial diagnostic. Bucketing variants by sentence-level verbatim share:

**Overall (n=281):** mean **-30.8**, p10 -108.6, p25 -58.8, **p50 -6.5**, p75 -0.5, p90 +4.9

| Bucket | n | Mean | p10 | p25 | Median | p75 | p90 |
|--------|---|-----:|----:|----:|-------:|----:|----:|
| 0-20% verbatim (full rewrite) | 22 | **-68.9** | -165.4 | -112.8 | -60.2 | -12.3 | +4.5 |
| 20-40% verbatim | 16 | -30.0 | -59.1 | -55.2 | -51.1 | -1.4 | +40.7 |
| 40-60% verbatim | 23 | -17.3 | -57.1 | -47.7 | -4.4 | +1.5 | +20.5 |
| 60-80% verbatim (moderate edit) | 54 | -28.0 | -91.5 | -57.5 | -5.0 | -1.0 | +4.6 |
| 80-90% verbatim (light edit) | 102 | -29.0 | -91.8 | -58.7 | -3.8 | -0.4 | +3.2 |
| 90-95% verbatim (very light edit) | 60 | -28.6 | -96.9 | -57.4 | -6.6 | -0.7 | +2.5 |
| 95-100% verbatim (nearly unchanged) | 4 | -22.5 | -77.0 | -62.2 | -27.2 | +12.4 | +35.7 |

**Two distinct failure modes are now visible:**

1. **Failure mode A — rewrite disasters** (0-20% verbatim, n=22, ~8% of samples). p25 -113, mean -69. These are the long-tail outliers. Killable with a sentence-overlap guardrail (e.g., reject any rewrite where < 50% of sentences are byte-identical from parent).

2. **Failure mode B — structural left-tail** (~25% of all samples in light-edit buckets). p25 ≈ -50 to -60 Elo across the 60-95% verbatim range. **These variants made small, targeted edits but the judge still scored them ~50+ Elo worse than parent.** This is a quality-of-suggestion problem, not a rewrite-scope problem — and it's the bigger contributor (~70 variants vs ~22).

**Counterfactual: dropping the most-rewritten N% of variants:**

| Drop bottom | Threshold verbatim ≥ | n kept | Mean Δ Elo | Median Δ Elo |
|-------------|---------------------:|-------:|------------:|-------------:|
| 0% | 0.0% | 281 | -30.8 | -6.5 |
| 5% | 5.1% | 267 | -28.3 | -4.4 |
| 10% | 33.6% | 253 | -27.4 | -4.4 |
| **15%** | **43.7%** | 239 | **-26.9** | -4.0 |
| 20% | 55.1% | 225 | -28.3 | -4.0 |
| 30% | 73.1% | 197 | -28.1 | -3.9 |
| 50% | 83.4% | 141 | -29.1 | -4.4 |

Killing the 15% most-rewritten variants buys **+4 Elo on the mean** (from -30.8 to -26.9). The median improves from -6.5 → -4.0 just by dropping the bottom 15%. Beyond that, dropping more variants doesn't help — the typical-case Elo Δ is structurally stuck at -4 to -5 Elo.

### Updated improvement recommendations (post-data)

The original "structural Elo ceiling" framing turned out to be misleading. The data now points to two separable problems:

**HIGH-IMPACT, LOW-EFFORT** (target failure mode A):

1. **Sentence-overlap guardrail.** Post-generation check: split parent and child into sentences (regex `[.!?][""”’]?\s|$`), compute byte-identical overlap, reject any rewrite < 50% verbatim. Either retry with the same suggestions or fall back to the parent. **Expected impact: +4-6 Elo on the mean, kills the 22-variant disaster bucket entirely.**

2. **Pre-tell the LLM the wrapper's pick.** Eliminates the ~45% suggestion-drop rate by inverting evaluation order (wrapper picks weakest first via fast scoring call, then prompts a focused suggestion call). Side benefit: kills the parse-failure mode entirely.

3. **Stronger "preserve most paragraphs" directive in customPrompt.** Add explicit budget: "modify only 2-3 specific sentences per fix; do not rewrite surrounding paragraphs." Encourages the median behavior (already pretty good), discourages the tail.

**MEDIUM-IMPACT, MEDIUM-EFFORT** (target failure mode B):

4. **Investigate the structural left-tail.** What's special about variants that made light edits but lost -50+ Elo? Possibilities: misaligned suggestions (LLM picked wrong fix even with right rubric), specific criteria that produce bad suggestions even on well-aligned rubrics, judge biases against specific edit patterns. Drill-down required.

5. **Try a stronger evaluator model.** Currently same gpt-4.1-nano runs evaluation and generation. Adding `evaluationModel?: string` to StrategyConfig (defaulting to `generationModel`) would let researchers A/B with `gpt-4.1-mini` or `claude-sonnet-4` for the evaluate-and-suggest call.

6. **Diversify the test set.** All current data is on one prompt (Federal Reserve, factual). The agent might shine on opinion or narrative content where "fix point of view" suggestions are more natural. Pick 3 prompts spanning factual / explainer / opinion.

**LARGER STRUCTURAL CHANGES** (only if 1-3 don't close the gap):

7. **Criteria → tactic mapping.** Replace customPrompt path with reflection-style tactic selection. Weakest criterion → tactic mapping → vanilla GFPA dispatch. Reuses well-tested tactic infrastructure; loses some user-defined criteria flexibility.

8. **Single-call evaluate-and-rewrite.** Halve LLM calls. Have the LLM do score + rewrite in one go with suggestions baked in as scratch-pad reasoning. More coherent, less wrapper-vs-LLM friction.

### What changed in the framing post-data

| Before | After |
|--------|-------|
| "-47 Elo mean delta = pervasive structural underperformance" | "-31 Elo mean = -7 Elo median + long tail of -100+ Elo failures" |
| "Methodology fundamentally produces 'patched' variants" | "Most variants make ~14-19% sentence changes — quite surgical. Methodology isn't broken; failure modes are." |
| "Need to switch to tactic-driven approach to fix structural ceiling" | "Two distinct failures: (A) rewrite disasters (kill with overlap guardrail), (B) light-edit left-tail (separate root cause TBD). Quick wins available." |
| "Each criteria-driven variant rewrites ~50% of the article" | "PARAGRAPH-level diff overstated change. SENTENCE-level: median ~14-19% changed, mean ~25-29% (long tail)." |
