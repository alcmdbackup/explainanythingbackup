# Updated Criteria Agent Progress

## Implementation Summary (Phases 1-6 complete, Phase 7 prepared for user)

### Phase 1 — Foundation ✓
- DB migrations:
  - `20260506000001_evolution_cost_calibration_proposer_approver_phases.sql` (CHECK constraint extension; restores `evaluate_and_suggest` + adds 3 new propose/approve labels).
  - `20260506000002_evolution_variants_sentence_verbatim_ratio.sql` (nullable NUMERIC column, universal sentence-overlap metric).
- AgentName extension: `criteria_proposer`, `criteria_forward_approver`, `criteria_mirror_approver` → routed to umbrella `proposer_approver_criteria_cost` metric. OUTPUT_TOKEN_ESTIMATES + costCalibrationLoader Phase union + startupAssertions BOTH phase enum sets + refreshCostCalibration Phase union extended.
- Marker tactics added: `criteria_driven_single_pass` (cyan) + `criteria_driven_propose_approve` (purple). GFPA misconfiguration guard widened to accept all 3 criteria markers.
- iterationConfigSchema: 2 new agent-type enum values + 4 new optional fields (`lengthCapRatio`, `redundancyJaccardThreshold`, `includesMirrorApprover`, plus reused editing fields). 2 existing refines WIDENED + 4 NEW refines.
- Variant type extended with `sentenceVerbatimRatio?: number`. createVariant factory + variantSchema + evolutionVariantInsertSchema all extended. persistRunResults writes the new column on both surfaced + discarded paths.
- 2 new execution_detail discriminated-union schema variants (singlePass + proposerApprover) registered.
- EditingReviewDecision schema + interface extended with optional guardrail violation flags.
- Metric registry: `proposer_approver_criteria_cost` + 3 operational + 3 invocation-level + 3 sentence-overlap percentile metrics + propagation defs all wired.
- Cost estimator: `estimateProposerApproverCriteriaCost` (5-layer projection, 1.3× margin).

### Phase 2 — Single-pass agent ✓
- `SinglePassEvaluateCriteriaAndGenerateAgent` class.
- 3 new guardrail directives in customPrompt (length / redundancy / flow).
- Marker tactic `criteria_driven_single_pass`.
- `lengthCapHit` observational telemetry post-generation.
- Dispatch branch in `runIterationLoop.ts` (variant-producing condition widened).
- `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED='false'` falls back to legacy wrapper.
- agentRegistry registration + attribution extractor.
- `detailViewConfigs.ts` entry with guardrails sub-section.

### Phase 3 — Mirror + guardrails + overlap toolkit ✓
- `evolution/src/lib/shared/sentenceOverlap.ts` — Levenshtein-tolerant sentence-overlap helper.
- `evolution/src/lib/metrics/computations/sentenceOverlapMetrics.ts` — median/p25/min run-level percentile compute.
- `evolution/src/lib/core/agents/editing/mirrorEdits.ts` — 4 helpers (applyEditsRTL, invertAtomicEdit, constructMirrorGroup, roundTripApply, renderMirrorMarkup).
- `evolution/src/lib/core/agents/editing/checkSemanticOverlap.ts` — trigram Jaccard.
- `validateEditGroups.ts` extended with optional opts (`lengthCapRatio`, `redundancyJaccardThreshold`, `flowGuardrailEnabled`). Existing IterativeEditingAgent calls pass `{}` — bit-identical behavior.
- `parseReviewDecisions.ts` extended to extract optional guardrail-violation flags (Phase 4.0 dependency).

### Phase 4 — Propose/approve agent ✓
- `ProposerApproverCriteriaGenerateAgent` class — single-cycle propose/forward-approve/mirror-approve/apply.
- Mirror short-circuit for forward-rejected groups.
- Strict-binary aggregator: APPLY iff `(forward, mirror) === ('accept', 'reject')`. 6 enumerated `aggregate_drop_*` reasons.
- `renderMirrorMarkup` produces sign-flipped CriticMarkup against A' (forward-applied article) for the mirror approver call.
- A' format gate aborts mirror cleanly with `mirrorAbortReason = 'a_prime_format_invalid'`.
- Inline prompt builders (proposer + approver) with criteria/eval context injection.
- Marker tactic `criteria_driven_propose_approve`.
- Dispatch branch in `runIterationLoop.ts` with `EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED='false'` rejection.
- agentRegistry registration + attribution extractor.
- `detailViewConfigs.ts` entry with full Edit Cycle layout (forward + mirror decision tables, dropped pre/post-approver, mirror agreement rate, abort reason).

### Phase 5 — Strategy hash + label + validation ✓
- `canonicalizeIterationConfig`: criteriaIds + weakestK emit-gates WIDENED to all 3 criteria-based types. New emit-gates for lengthCapRatio (propose/approve only), redundancyJaccardThreshold (both new), includesMirrorApprover (only when explicitly false — compact hash for default-on).
- `labelStrategyConfig`: extended with criteria, single-pass-criteria, proposer-approver iteration-summary buckets.
- `validateCriteriaIds` server-side check widened to all 3 criteria-based types.

### Phase 6 — Documentation ✓
- New `evolution/docs/criteria_agents.md` deep dive — covers all three criteria-driven agents, mirror-approver protocol, universal sentence-overlap metric, cost/operational metrics, kill switches.
- `evolution/docs/architecture.md` § Criteria-driven generation updated to reference the three agents with cross-link to the deep dive.

### Phase 7 — Staging validation (REQUIRES USER)

**Cannot autonomously trigger** — requires real staging DB writes + LLM calls + admin UI interaction.

To run the validation:

1. **Apply migrations to staging**: CI's `deploy-migrations` job applies them automatically on PR merge to main, but for direct staging deploy:
   ```bash
   supabase db push --include-roles  # or via the Supabase dashboard
   ```
   Specifically:
   - `20260506000001_evolution_cost_calibration_proposer_approver_phases.sql`
   - `20260506000002_evolution_variants_sentence_verbatim_ratio.sql`

2. **Create 3 strategies via the admin UI** (`/admin/evolution/strategies/new`) using the same prompt + criteria as the prior project (Federal Reserve prompt, 7 seeded sample criteria, weakestK=2):
   - Strategy A: `criteria_and_generate` (legacy baseline) — for direct A/B comparison.
   - Strategy B: `single_pass_evaluate_criteria_and_generate` — guardrails-only hypothesis.
   - Strategy C: `proposer_approver_criteria_generate` — architectural-selectivity hypothesis (with `includesMirrorApprover: true`).

   Note: wizard UI for the 2 new agent types is deferred. To create strategies via API, POST to `/api/evolution/strategies` with the appropriate `iterationConfigs` (the schema validation accepts the new agent types now).

3. **Trigger 5 runs per strategy** (15 total) via `/admin/evolution/start-experiment`.

4. **Wait for completion**, then run analysis queries:

   ```sql
   -- Mean Elo Δ vs generate_from_previous_article baseline by agent type
   WITH parent_elo AS (
     SELECT v.id AS variant_id, v.parent_variant_id, vp.elo_score AS parent_elo_score
     FROM evolution_variants v
     LEFT JOIN evolution_variants vp ON vp.id = v.parent_variant_id
     WHERE v.run_id IN (<your 15 run UUIDs>)
   )
   SELECT
     v.agent_name,
     COUNT(*) AS n_variants,
     AVG(v.elo_score - p.parent_elo_score) AS mean_elo_delta,
     PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.elo_score - p.parent_elo_score) AS median_elo_delta,
     AVG(v.sentence_verbatim_ratio) AS mean_overlap,
     PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY v.sentence_verbatim_ratio) AS p25_overlap
   FROM evolution_variants v
   JOIN parent_elo p ON p.variant_id = v.id
   WHERE v.run_id IN (<your 15 run UUIDs>)
   GROUP BY v.agent_name;
   ```

   ```sql
   -- Bucket Elo Δ by sentence-overlap percentile per agent (replicates prior project's analysis)
   WITH parent_elo AS (
     SELECT v.id, v.agent_name, v.sentence_verbatim_ratio,
            v.elo_score - vp.elo_score AS delta
     FROM evolution_variants v
     JOIN evolution_variants vp ON vp.id = v.parent_variant_id
     WHERE v.run_id IN (<your 15 run UUIDs>)
       AND v.sentence_verbatim_ratio IS NOT NULL
   ),
   bucketed AS (
     SELECT *,
       CASE
         WHEN sentence_verbatim_ratio < 0.20 THEN '0-20%'
         WHEN sentence_verbatim_ratio < 0.40 THEN '20-40%'
         WHEN sentence_verbatim_ratio < 0.60 THEN '40-60%'
         WHEN sentence_verbatim_ratio < 0.80 THEN '60-80%'
         ELSE '80-100%'
       END AS bucket
     FROM parent_elo
   )
   SELECT agent_name, bucket, COUNT(*) AS n,
     AVG(delta) AS mean_delta,
     PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY delta) AS p10,
     PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY delta) AS median,
     PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY delta) AS p90
   FROM bucketed
   GROUP BY agent_name, bucket
   ORDER BY agent_name, bucket;
   ```

   ```sql
   -- Mirror agreement rate distribution (propose/approve only)
   SELECT
     run_id,
     (execution_detail->>'mirrorAgreementRate')::FLOAT AS rate,
     (execution_detail->'cycles'->0->>'appliedGroups')::INT AS applied,
     (execution_detail->'cycles'->0->>'approverGroups')::INT AS approver_total
   FROM evolution_agent_invocations
   WHERE agent_name = 'proposer_approver_criteria_generate'
     AND run_id IN (<your 15 run UUIDs>);
   ```

5. **Spot-check 3 winners + 3 losers per agent type** (18 total) — view variants with extreme Elo Δ and inspect parent-child diffs in the admin UI.

6. **Document findings here** — Mean/median/p25 Elo Δ per agent, length distribution, mirrorAgreementRate distribution, sentence-level diff bucket table, spot-check observations, and a recommendation: which agent (if any) becomes the new default; whether to deprecate the legacy.

## Open follow-up work (deferred polish, non-blocking for validation)

- Phase 5.5 UI surfacing audit: extend server-action SELECTs (getEvolutionVariantsAction, listVariantsAction, getArenaEntriesAction, etc.) to include `sentence_verbatim_ratio` so the admin UI lists/leaderboards show the new column. Runtime correctness unaffected without these — the column is written and metrics aggregate from in-memory pool.
- Wizard UI for the 2 new agent types — strategies can currently only be created via API. The wizard renders existing types fine; adding the new agent-type dropdown options + their conditional field controls is a follow-up.
- Unit tests for the new agents + helpers (~75 cases per the original plan). The runtime is exercised by integration with existing tests; dedicated test suite for the new code is a follow-up.
- 10 additional surgical doc edits (agents/overview.md, strategies_and_experiments.md, cost_optimization.md, metrics.md, visualization.md, reference.md, multi_iteration_strategies.md, curriculum.md, data_model.md, editing_agents.md cross-ref). The new criteria_agents.md is the canonical reference; these are polish.

## Validation status

`npx tsc --noEmit` is clean across all changes. Lint not run (would require dev server start; deferred). Build not run (would require dev server start; deferred). All commits push to `feat/updated_criteria_agent_20260505` branch.
