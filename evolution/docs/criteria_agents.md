# Criteria-Driven Evolution Agents

This deep dive covers the **three** criteria-driven evolution agents that share a common evaluation phase but diverge in how they apply suggestions:

1. **`evaluate_criteria_then_generate_from_previous_article`** — the legacy single-pass agent (PR #1023). Score parent + draft suggestions → GFPA delegation with `customPrompt`.
2. **`single_pass_evaluate_criteria_and_generate`** — successor to (1) with three new guardrail directives in the customPrompt (length / redundancy / flow). Uses marker tactic `criteria_driven_single_pass`. Tests the **guardrails-only hypothesis** from prior project.
3. **`proposer_approver_criteria_generate`** — new agent based on `IterativeEditingAgent`'s propose/review/apply primitive but **single-cycle** with a **mirror-approver bias-mitigation pass**. Uses marker tactic `criteria_driven_propose_approve`. Tests the **architectural-selectivity hypothesis**.

All three run side-by-side; comparison happens on the tactic leaderboard at `/admin/evolution/tactics`.

## Why three agents

The prior project's research identified two distinct failure modes for the legacy criteria agent:

- **Rewrite disasters** (n=22, 0-20% verbatim sentence overlap → mean -69 Elo): the LLM ignored the original article structure and wrote something different.
- **Light-edit left-tail** (~25% of variants, p25 ≈ -50 Elo despite 14-19% sentence-level changes): the LLM made small surgical edits but they were poor quality.

The two hypotheses the new agents test:

- **(H1) Prompt-only guardrails close the gap** — single-pass agent. Three new directives (Length / Redundancy / Flow) in the customPrompt should reduce the rewrite-disaster cohort.
- **(H2) Architectural selectivity closes the gap** — propose/approve agent. Per-edit accept/reject + mirror filter should be more reliable than holistic rewrite.

Phase 7 staging runs will A/B all three to find which hypothesis (if any) holds.

## Shared evaluation phase

All three agents start with the same combined LLM call labeled `'evaluate_and_suggest'`:

- Score every criterion against its rubric (anchor scores from `evolution_criteria.evaluation_guidance`)
- Identify the K weakest by normalized score
- Draft suggestions for those K weakest criteria — Example passage / What's wrong / Fix

Output is parsed in two passes via `parseEvaluateAndSuggest`. First pass extracts scores; second pass filters suggestions to the wrapper-determined weakest set. This phase is **identical** across all three agents.

## Agent (1): legacy `evaluate_criteria_then_generate_from_previous_article`

Unchanged. After the eval phase, builds a `customPrompt` from suggestions and dispatches `GenerateFromPreviousArticleAgent.execute()` with `tactic: 'criteria_driven'`. Inner GFPA produces the variant. Single LLM "rewrite" call after eval.

CustomPrompt template ends with a single soft directive:
> "Rewrite the article addressing each issue. Preserve the original word count within ±10% — refactor or deepen existing passages rather than adding new sections or examples. Do not introduce meta-commentary about the article itself."

## Agent (2): `single_pass_evaluate_criteria_and_generate`

Same shape as (1) but with **three** soft directives in the customPrompt:

> **Length** — Preserve the original word count within ±10%. Refactor or deepen existing passages rather than adding new sections or examples.
>
> **Redundancy** — Avoid introducing ideas, phrasing, or examples that already appear elsewhere in the article. Each fix should add or strengthen distinct content, not duplicate what's already there.
>
> **Flow** — Preserve transitions between paragraphs. Do not delete or replace transition phrases at paragraph starts (e.g., 'However,' 'Therefore,' 'In contrast,'). Maintain local sentence rhythm and section-to-section connective tissue.

Plus a marker tactic (`criteria_driven_single_pass`) so the tactic leaderboard distinguishes the new agent's variants from the legacy. Plus observational `lengthCapHit` telemetry post-rewrite (true if `output.length / parent.length > 1.10`). Telemetry only — variant emits regardless.

**Kill switch**: `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED='false'` falls back to legacy (1).

## Agent (3): `proposer_approver_criteria_generate`

Forks `IterativeEditingAgent`'s propose/review/apply pattern, single-cycle. Per parent variant:

1. **Eval phase** (same as 1, 2).
2. **Proposer call** — full article verbatim + inline CriticMarkup edits. System prompt extends `IterativeEditingAgent`'s 6 soft rules with the 3 new criteria-specific ones. User prompt includes criteria block + evaluation results + weakest-K suggestions + article body.
3. **Implementer pre-check** — `parseProposedEdits` + `validateEditGroups({ lengthCapRatio: 1.10, redundancyJaccardThreshold: 0.35, flowGuardrailEnabled: true })`. The `validateEditGroups` extension (Phase 3.3) takes opts that:
   - Tighten the size-ratio cap from 1.5× to 1.10× (default).
   - Add a transition-word regex hard rule that rejects edits at paragraph starts that delete/replace transition phrases.
   - Add a trigram Jaccard semantic-overlap check that rejects edits whose newText shares > 35% of trigrams with the rest of the article.
4. **Forward approver call** (`'criteria_forward_approver'` label) — JSONL output with optional `redundancy_violation` / `flow_violation` / `length_violation` flags per group.
5. **Mirror approver call** (`'criteria_mirror_approver'` label, only if `iterCfg.includesMirrorApprover ?? true`):
   - **Mirror short-circuit**: only run on forward-accepted groups. Forward-rejected groups get null mirror decision with reason `short_circuited_forward_rejected`.
   - Apply forward-accepted groups to original → A'. Validate A' format. If A' fails format → `mirrorAbortReason = 'a_prime_format_invalid'`, drop ALL forward-accepted groups.
   - Render mirror CriticMarkup against A' via `renderMirrorMarkup`: insert→delete, delete→insert, replace→reverse-replace. Position arithmetic recomputes ranges in A' coordinates.
   - LLM call. Parse mirror decisions. If parse fails → `mirrorAbortReason = 'mirror_parse_null'`, drop all.
6. **Aggregator (strict binary)**: APPLY iff `(forwardDecision, mirrorDecision) === ('accept', 'reject')`. All other combinations DROP with explicit reason: `aggregate_drop_forward_reject`, `aggregate_drop_both_accept`, `aggregate_drop_both_reject`, `aggregate_drop_mirror_null_short_circuit`, `aggregate_drop_mirror_null_parse_fail`, `aggregate_drop_mirror_aborted`.
7. **Implementer apply** — `applyAcceptedGroups` (right-to-left splice, context-failsafe verification, overlap drop).
8. **Post-cycle ranking** — `rankNewVariant` against deep-cloned local snapshot. Surface/discard policy mirrors GFPA.

The mirror-approver protocol is structurally analogous to `run2PassReversal` (used for pairwise judges) but with a different aggregator: instead of "both passes pick the same winner," we require "approver consistently prefers the proposed end-state in both framings."

**Cost stack**: 4 LLM calls per parent (eval + propose + forward + mirror) plus ranking. ~3-4× per-variant cost vs vanilla `generate_from_previous_article`. Mirror short-circuit reclaims 20-30% of mirror cost proportional to forward rejection rate.

**Kill switches**:
- `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED='false'` — rejects iteration entirely.
- `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED='false'` — skips post-cycle ranking; variant lands at default Elo.

## Universal sentence-overlap metric

All three agents (plus vanilla `generate`, `reflect_and_generate`, and `iterative_editing` via wrapper inheritance) compute `sentenceVerbatimRatio` at variant creation: fraction of parent sentences appearing (verbatim or near-verbatim via Levenshtein ≤ 2) in child. Stored on the new `evolution_variants.sentence_verbatim_ratio NUMERIC` column.

Surfaces as:
- **Variant column** — directly queryable.
- **Run-level metrics** — `median_sentence_verbatim_ratio` (listView), `p25_sentence_verbatim_ratio` (rewrite-disaster signal), `min_sentence_verbatim_ratio` (worst-case).
- **Strategy/experiment-level** — `avg_median_sentence_verbatim_ratio` via bootstrap_mean propagation.

This enables the prior project's percentile-bucket analysis directly on the metric — Phase 7 staging runs will bucket Elo Δ by verbatim percentile per agent type to find which hypothesis closed which failure mode.

## Cost metrics

| Agent | Eval bucket | Generation bucket | Ranking bucket |
|---|---|---|---|
| (1) legacy | `evaluation_cost` | `generation_cost` | `ranking_cost` |
| (2) single-pass | `evaluation_cost` | `generation_cost` | `ranking_cost` |
| (3) propose/approve | `evaluation_cost` | `proposer_approver_criteria_cost` (umbrella for propose + forward + mirror) | `ranking_cost` |

Per-purpose cost split for (3) lives in `execution_detail.cycles[0].{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}`.

Strategy/experiment-level propagation: `total_proposer_approver_criteria_cost` (sum) + `avg_proposer_approver_criteria_cost_per_run` (avg).

## Operational metrics

For (3) propose/approve only:
- `proposer_approver_drift_rate` — fraction of proposer outputs with drift (extension of IterativeEditingAgent pattern).
- `proposer_approver_accept_rate` — forward approver acceptance rate.
- `proposer_approver_mirror_agreement_rate` — `appliedGroups / approverGroups` per run; alert thresholds `< 0.20` and `> 0.95` via env vars.

Plus invocation-level metrics:
- `invocation_mirror_agreement_rate`
- `invocation_forward_accept_rate`
- `invocation_mirror_filter_rate` — fraction of forward-accepted edits the mirror dropped (the mirror's "work").

## Kill switches

| Env var | Default | Effect when `'false'` |
|---|---|---|
| `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED` | `'true'` | Single-pass dispatch falls back to legacy (1). |
| `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED` | `'true'` | Propose/approve dispatch rejected; iteration produces zero variants. |
| `EVOLUTION_PROPOSER_APPROVER_CRITERIA_RANK_ENABLED` | `'true'` | Skip post-cycle ranking — variant lands at default Elo. |

Mirror approver toggle is per-iteration (`includesMirrorApprover` field on `IterationConfig`, default `true`), not a global env var.

## Files

- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — legacy (1).
- `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.ts` — single-pass (2).
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` — propose/approve (3).
- `evolution/src/lib/core/agents/editing/mirrorEdits.ts` — mirror-edit primitives (4 helpers).
- `evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts` — trigram Jaccard.
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — extended with parameterized opts.
- `evolution/src/lib/shared/sentenceOverlap.ts` — sentence-overlap helper.
- `evolution/src/lib/metrics/computations/sentenceOverlapMetrics.ts` — run-level percentile compute.

## Cross-references

- `evolution/docs/architecture.md` § Criteria-driven generation (legacy single-pass + new agents).
- `evolution/docs/agents/overview.md` § Agent types.
- `evolution/docs/editing_agents.md` — `IterativeEditingAgent` pattern that propose/approve forks.
- `evolution/docs/metrics.md` — cost metric routing + sentence-overlap metric registry.
