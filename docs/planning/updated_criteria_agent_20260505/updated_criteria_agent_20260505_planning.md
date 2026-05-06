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
- **Length** — keep within ±10% of the original word count (already partially in PR #1032's customPrompt; the proposer/approver variant should enforce more strictly via size-ratio guardrail similar to `IterativeEditingAgent`).

### Proposer/Approver mechanics (single cycle)
- **Cycle count**: ONE propose-review-apply cycle per parent (no iteration loop). Default `maxCycles = 1`.
- **Approver context**: Approver receives the FULL criteria + evaluation results (not just the proposed edits + article).
- **Rubber-stamping**: Not a concern — `editingModel` and `approverModel` may be identical without warning. (Distinct from `IterativeEditingAgent` Decisions §16.)

### Mirror-approver protocol (NEW — bias mitigation)
The approver runs **two passes** on each proposed edit group:
- **Initial pass** — original CriticMarkup proposal (e.g., `{++ inserted text ++}`).
- **Mirror pass** — sign-flipped version of the proposal applied to the article in the OPPOSITE state. Insertion → deletion of the same text from a version that already contains it; deletion → insertion of the same text into a version missing it; substitution `{~~ A ~> B ~~}` → reverse substitution `{~~ B ~> A ~~}`.

**Implementer rule**: apply an edit only if both passes' decisions are CONSISTENT — i.e., the approver favors the proposed direction in both framings. If initial=ACCEPT and mirror=REJECT (approver consistently prefers the proposed end-state), the edit is applied. Any other combination (both ACCEPT, both REJECT, initial=REJECT + mirror=ACCEPT) → drop the edit. This filters out approvers that would approve / reject regardless of direction, mirroring the existing `run2PassReversal` bias-mitigation pattern for pairwise judges.

### A/B / shipping
- Both agent types ship as distinct values in the `agentType` enum on `IterationConfig`.
- The legacy `evaluate_criteria_then_generate_from_previous_article` agent type either (a) routes to the single-pass variant under the hood, or (b) stays in place and the two new types are the upgrade path. Decision deferred to plan.

### Success metric
- Mean Elo Δ vs `generate_from_previous_article` baseline on the Federal Reserve prompt (same as prior project) is the primary metric.
- Broaden the prompt set — exact additional prompts TBD (e.g., add an opinion-driven content prompt to test extrapolation per prior project's caveat).

## Problem
The current single-pass criteria agent (a) cannot discriminate "drop this suggestion" from "apply this suggestion" — every parsed suggestion gets executed by GFPA — and (b) lacks structural guardrails against the three observed failure patterns: redundancy bloat, broken paragraph flow, and length expansion. Both new variants need to address the structural problems; the propose/approve variant additionally introduces the discriminator the single-pass variant lacks.

## Options Considered
- [ ] **Option A: Single-pass with new guardrails only** — keep existing wrapper architecture, only update customPrompt + evaluator rubric instructions. Minimal change; proves the guardrails add value before committing to the heavier propose/approve build. Risk: the executive selection problem (every parsed suggestion is applied) is unchanged.
- [ ] **Option B: Propose/approve only** — replace the single-pass agent entirely. Cleaner architectural endpoint. Risk: large code change without an isolated comparison of guardrails-alone vs guardrails+approver, so we can't attribute lift to the right component.
- [ ] **Option C: Both, ship in parallel as distinct `agentType`s** — single-pass becomes the upgrade path for the existing wrapper; propose/approve is a new agent type alongside it. Lets us A/B them on the same prompt set. Likely the right answer per user's framing ("we want to build two different versions").

## Phased Execution Plan

### Phase 1: TBD
- [ ] TBD

## Testing

### Unit Tests
- [ ] TBD

### Integration Tests
- [ ] TBD

### E2E Tests
- [ ] TBD

### Manual Verification
- [ ] TBD

## Verification

### A) Playwright Verification
- [ ] TBD

### B) Automated Tests
- [ ] TBD

## Documentation Updates
- [ ] TBD

## Review & Discussion
TBD — populated by /plan-review.
