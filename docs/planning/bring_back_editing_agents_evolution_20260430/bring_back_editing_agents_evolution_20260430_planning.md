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
5. **Naming:** One canonical name everywhere — `'iterative_editing'`. Used as the `iterationConfig.agentType` value, the `agent_name` written to `evolution_agent_invocations`, the schema `detailType` discriminator, and the `DETAIL_VIEW_CONFIGS` key. Class name is `IterativeEditingAgent` (PascalCase). UI label is "Iterative Editing" (drops the redundant "Agent" suffix for display). The orphaned V1 schema's `'iterativeEditing'` discriminator is replaced (Phase 1.8 already authors a fresh schema), and `InvocationEntity.listFilters` is updated from `'iterativeEditing'` to `'iterative_editing'`. Per-LLM-call AgentName labels stay snake_case (`iterative_edit_propose` / `iterative_edit_review` / `iterative_edit_drift_recovery`) and the cost metric stays `iterative_edit_cost`.
6. **Parent selection:** **One parent per `IterativeEditingAgent` invocation** (always K=1 internally). Multiple invocations dispatch in parallel via the existing generate-iteration dispatch framework (`projectDispatchPlan` budget-governed parallel batch + top-up loop). Each invocation in the iteration is assigned a distinct top-N variant by Elo rank from the iteration-start pool. Two ceilings cap how many parents get edited: (a) the parallel-dispatch count (budget-derived, same as generate); (b) the eligibility cutoff (per-iteration field `editingEligibilityCutoff` — defaults to `{ mode: 'topN', value: 10 }`). The effective cap is `min(eligibilityCount, dispatchCount, poolSize)`. Unspent iteration budget when the cutoff binds rolls back to the run-level budget for later iterations. Same-parent re-editing within an iteration is forbidden — depth comes from `editingMaxCycles`, breadth from the cutoff + dispatch count.
7. **`MergeRatingsAgent` compat:** Pass editing match buffers with `iterationType: 'iterative_editing'` (the same string that lands in `IterationSnapshot.iterationType` from Phase 3.2). Widen `MergeRatingsInput.iterationType` enum from `'generate' | 'swiss'` to `'generate' | 'iterative_editing' | 'swiss'`. No behavioral changes inside MergeRatingsAgent — its merge math is identical for editing matches and generate matches — but the audit trail's iteration-type label stays consistent across `evolution_iteration_snapshots` rows AND `MergeRatingsAgent.execution_detail.iterationType`. Earlier draft passed `'generate'` to avoid the enum change; we reject that to prevent the silent observability disagreement (see Round 3 review).
8. **Schema:** The orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) was V1-rubric-shaped and **does not fit the new design**. We author a fresh schema (see research doc); the orphaned one is deleted in Phase 1.
9. **`Match.frictionSpots`:** Out of scope (dead code on both ends).
10. **Per-cycle invocation timeline UI:** Out of scope for v1. Cycles in `execution_detail`; visual timeline → v1.1.
11. **Drift recovery:** when the strip-markup drift check finds drift, the Implementer attempts an LLM-driven recovery for *minor* drift (≤ 3 regions, ≤ 200 chars, no markup overlap). A nano-class model classifies each region as `benign` (cosmetic substitutions like smart quotes / dashes / whitespace, auto-patched) or `intentional` (meaningful unwrapped change, abort cycle). New strategy field `driftRecoveryModel?: string` (default gpt-4.1-nano), new AgentName label `iterative_edit_drift_recovery`, new feature flag `EVOLUTION_DRIFT_RECOVERY_ENABLED` (default `'true'`). Per-cycle `execution_detail.driftRecovery` records regions, classifications, outcome, cost. Stop-reason union expands: `proposer_drift_major` / `proposer_drift_intentional` / `proposer_drift_unrecoverable`.
12. **Editing-specific config knobs (strategy-level + per-iteration):**
    - **Strategy-level `editingModel?: string`** — surfaced on Step 1 of the wizard as an "Editing model" dropdown directly below "Judge model". Used for both Proposer and Approver LLM calls. Falls back to `generationModel` when unset (placeholder: "Inherit from Generation model"). Drift recovery has its own `driftRecoveryModel?` and is unaffected.
    - **Per-iteration `editingMaxCycles?: number`** (1–5, default 3) — surfaced on Step 2 on iterative_editing rows. Lets a strategy mix deep-edit iterations (4 cycles) with polish iterations (1 cycle) within the same run.
    - **Per-iteration `editingEligibilityCutoff`** (`{ mode: 'topN' | 'topPercent'; value: number }`, **default `{ mode: 'topN', value: 10 }`**) — surfaced on Step 2 on iterative_editing rows. Caps how many of the top-Elo variants in the pool are eligible for editing per iteration. The effective dispatch is `min(eligibility, budget-affordable-dispatch, poolSize)`. Default 10 is intentionally generous — most strategies will be budget-bound long before the cutoff bites; authors who want to be aggressive can lower it (e.g., `topN: 3` to force budget concentration on the very best variants).
    - **Parallel dispatch count is NOT configurable per editing iteration.** It's derived by `projectDispatchPlan` from the iteration's budget — same path generate iterations use. Each parallel invocation edits one distinct top-Elo parent that survived the eligibility cutoff.
    - All four are optional; strategies that don't set them get sensible defaults.
13. **Single-invocation-row wrapper pattern (mirror of PR #1017's `ReflectAndGenerateFromPreviousArticleAgent`).** `IterativeEditingAgent` is the **only** registered agent class in `agentRegistry.ts` for editing. The three internal LLM purposes (Proposer, Approver, drift-recovery) are **inline helpers** invoked through the wrapper's own `EvolutionLLMClient` — never via `Agent.run()` and never as separate registered agents. One invocation row per parent, regardless of cycle count. **LOAD-BEARING INVARIANTS** (must appear as a header comment in `IterativeEditingAgent.ts`, mirroring the comment block in `reflectAndGenerateFromPreviousArticle.ts:1-17`):
    - **(I1)** Internal LLM helpers MUST use the wrapper's `EvolutionLLMClient` instance directly. Never instantiate a separate Agent and call `.run()` — that creates a NESTED `Agent.run()` scope (separate `AgentCostScope`) and splits cost attribution.
    - **(I2)** Capture `costBeforeProposeCall` / `costBeforeApproveCall` / `costBeforeRecoveryCall` snapshots BEFORE each helper call so per-purpose cost can be split into `execution_detail.cycles[i].{proposeCostUsd, approveCostUsd, driftRecoveryCostUsd}`. The split is the audit surface; the consolidated `iterative_edit_cost` metric is the rollup surface.
    - **(I3)** Write partial `execution_detail` to the invocation row BEFORE re-throwing on any helper failure (proposer LLM throws, parser throws, approver LLM throws, drift-recovery throws). The Phase 2 `trackInvocations` partial-update fix ensures `Agent.run()`'s catch handler doesn't overwrite our partial detail with null.
14. **Single final variant per invocation (one-variant-per-invocation contract preserved).** Cycles chain forward in-memory only — `current` is updated as a plain `Variant`-shaped object inside `execute()`, but **only the final cycle's text materializes as a real `Variant` in the pool / `evolution_variants` row**. Intermediate cycles' `childText` is captured in `execution_detail.cycles[i].childText` for audit but writes no `evolution_variants` row, no `evolution_arena_comparisons` row, and gets no Elo. This: (a) preserves the AgentOutput shape inherited from `Agent` base class (one variant out, optional matches buffer), (b) avoids the cycle-2's-parent-has-no-rating-yet bypass-ELO problem, (c) keeps `MergeRatingsAgent.newVariants` semantics unchanged. The `parent_variant_id` of the final variant is the **original input parent** (the `IterativeEditingInput.parent.variantId`), NOT cycle-N-1's intermediate variant — the lineage chain reflects "who was edited," not "intermediate state." Surfaced flag: defaults `true` when at least one cycle accepted edits AND format-valid; `false` if all cycles ended in `all_edits_rejected` / `no_edits_proposed` / drift-abort.
15. **Per-invocation budget cap under parallel dispatch.** Each `IterativeEditingAgent` invocation receives `perInvocationBudgetUsd = iterBudget / parallelDispatchCount` (computed in Phase 3.3 before dispatch). The agent reads `scope.getOwnSpent()` at the start of each cycle; if `getOwnSpent() >= perInvocationBudgetUsd * 0.9` it exits with `stopReason: 'invocation_budget_near_exhaustion'` (no further cycles). This bounds each invocation's spend so one runaway invocation cannot starve siblings under shared `IterationBudgetTracker`. Generate/swiss don't need this because their per-invocation cost is O(1) LLM call; editing's O(maxCycles) cost requires explicit per-invocation accounting.
16. **Approver model separability (config knob, not v1.1 deferral).** Strategy-level `approverModel?: string` field — defaults to `editingModel` if unset (which itself defaults to `generationModel`). When `approverModel === editingModel` (resolved values), Phase 5 wizard surfaces a soft warning ("Proposer and Approver use the same model — auditability is reduced") but doesn't block. Phase 1.7's cost estimator uses `approverModel` for the Approver's expected cost when it differs from `editingModel`. This addresses the "auditor and auditee are the same agent" structural concern without forcing two-model strategies; it's a knob with a guardrail, not a default.
17. **Article-size-ratio guardrail across cycles.** Per-cycle hard rule (enforced in `validateEditGroups.ts`): if applying all atomic edits in `approverGroups` would produce `newText` with `newText.length > current.text.length * 1.5`, drop the lowest-priority groups (highest group number first) until the size-ratio is ≤ 1.5×. If after group-dropping the size-ratio still exceeds 1.5× (e.g., a single mega-insertion), abort the cycle with `stopReason: 'article_size_explosion'`. This protects downstream Swiss/MergeRatings comparison costs (which scale linearly with article size) from runaway upstream growth. Documented in research doc § Risk Register; Phase 1.7 cost estimator's `upperBound` adds a `* 1.5^maxCycles` multiplier on the input-size component so worst-case forecasts include the maximum legal growth.
18. **DB migration split (independent rollback paths).** Phase 1.5 ships TWO migrations, not one:
    - **1.5a** `<timestamp>_evolution_cost_calibration_reflection_phase.sql` — adds `'reflection'` to `evolution_cost_calibration.phase` CHECK. Forward-only. Fixes the silent-reject bug PR #1017 left behind. **Independent of editing**: can ship + revert without touching editing.
    - **1.5b** `<timestamp+1s>_evolution_cost_calibration_editing_phases.sql` — adds `'iterative_edit_propose'`, `'iterative_edit_review'`, `'iterative_edit_drift_recovery'`. Forward-only. Bundles only editing's three phases.
    - Both are forward-only (CHECK extension is monotonic — adding accepted values is non-destructive). The combined startup assertion in Phase 1.6 verifies BOTH migrations ran before the agent registry initializes.

## Phased Execution Plan

### Phase 1: Scaffolding — enum + schema + registry + cost-calibration migration (Week 1)
- [ ] **1.1** `evolution/src/lib/schemas.ts:394` — extend `iterationAgentTypeEnum` (currently 3 values post-PR-1017: `['generate', 'reflect_and_generate', 'swiss']`) with `'iterative_editing'` → 4 values. **Split the overloaded `isVariantProducingAgentType()` predicate** (per Round 3 review pass-2 follow-up — current predicate gates two unrelated invariants and editing exposes the conflict). Replace the single function with two:
   - `canBeFirstIteration(t)`: returns `true` for `'generate'` and `'reflect_and_generate'`. Used by the first-iteration refine (editing is excluded — must follow a variant-producing iteration to have parents to edit).
   - `producesNewVariants(t)`: returns `true` for `'generate'`, `'reflect_and_generate'`, and `'iterative_editing'` (per Decisions §14 — editing produces a final variant per invocation). Used by the "no swiss precedes ALL variant-producing iterations" refine at `schemas.ts:489–500` and any other refines that gate on whether an iteration adds new variants to the pool.
   - Audit existing call sites of `isVariantProducingAgentType` and route each to the correct successor based on which invariant it gates. Add a unit test that asserts the two predicates' truth tables for all 4 iterationType values.
   - Update existing refines on `iterationConfigSchema` (lines 413–447) to allow iterative_editing iterations: editing is forbidden as first iteration (via `canBeFirstIteration`); editing IS counted as variant-producing for the swiss-precedence refine (via `producesNewVariants`). Add three new fields:
   - On `iterationConfigSchema`: `editingMaxCycles: z.number().int().min(1).max(5).optional()` — per-iteration override for how many cycles each editing-agent invocation runs (default falls through to `AGENT_DEFAULT_MAX_CYCLES = 3`). Refine: only allowed when `agentType === 'iterative_editing'`. **No `editingTopK` field** — parallel dispatch count comes from `projectDispatchPlan` via the same budget-governed mechanism generate iterations use.
   - On `iterationConfigSchema`: `editingEligibilityCutoff: qualityCutoffSchema.default({ mode: 'topN', value: 10 })` — caps how many of the top-Elo variants are eligible for editing per iteration. Reuses the existing `qualityCutoffSchema` shape (`{ mode: 'topN' | 'topPercent', value: number }`) so the validators and wizard pattern can share code with generate-pool-mode's `qualityCutoff`. **Default `topN: 10`** — generous enough that most strategies will be budget-bound long before the cutoff bites; authors who want to concentrate budget on the very top variants can lower it. **Value validation refines** (per Phase B detailed-review fix — the existing `qualityCutoffSchema` only validates shape, not value bounds; without these refines a strategy with `topN: 0` would slice an empty pool but still burn the budget reservation): add `.refine((c) => c.mode !== 'topN' || (Number.isInteger(c.value) && c.value >= 1), { message: 'topN cutoff must be an integer ≥ 1' })` and `.refine((c) => c.mode !== 'topPercent' || (c.value > 0 && c.value <= 100), { message: 'topPercent cutoff must be in (0, 100]' })` on the schema. Audit existing call sites of `qualityCutoffSchema` (generate-pool-mode's `qualityCutoff`) — these refines should ideally apply there too; if they were absent before, this is a defensive widening that closes a parallel hole. Refine: only allowed when `agentType === 'iterative_editing'`.
   - On `strategyConfigBaseSchema`: `editingModel: z.string().optional()` — strategy-level override for the LLM used by the Proposer LLM call in editing iterations. Falls back to `generationModel` when unset.
   - On `strategyConfigBaseSchema`: `approverModel: z.string().optional()` — strategy-level override for the LLM used by the Approver LLM call (per Decisions §16). Falls back to `editingModel` when unset (which itself falls back to `generationModel`). When `approverModel === editingModel` (resolved values), the wizard surfaces a soft warning but does not block. Drift recovery has its own `driftRecoveryModel` field; no change there.
- [ ] **1.2** `evolution/src/lib/core/agentNames.ts` — add `'iterative_editing'` to `AGENT_NAMES` (currently 6 values post-PR-1017: `['generation', 'ranking', 'reflection', 'seed_title', 'seed_article', 'evolution']`) → 7 values. Add `iterative_editing: 'iterative_edit_cost'` to `COST_METRIC_BY_AGENT`. Plus per-LLM-call labels: `'iterative_edit_propose'`, `'iterative_edit_review'`, `'iterative_edit_drift_recovery'` — all map to the single `iterative_edit_cost` metric (per-purpose cost split tracked via execution_detail, not per-metric, for v1 simplicity).
- [ ] **1.3** `evolution/src/lib/metrics/types.ts` — add to `STATIC_METRIC_NAMES`:
   - **Cost** (3): `'iterative_edit_cost'`, `'total_iterative_edit_cost'`, `'avg_iterative_edit_cost_per_run'`.
   - **Operational health** (3 new — unblocks risk-register monitoring per Round 3 review T3): `'iterative_edit_drift_rate'` (fraction of cycles that triggered the drift check), `'iterative_edit_recovery_success_rate'` (fraction of drift events resolved by the recovery LLM), `'iterative_edit_accept_rate'` (fraction of atomic edits accepted by the Approver). All 3 are run-level rollups computed in propagation; per-cycle raw counts live in `execution_detail.cycles[i]`.
- [ ] **1.4** `evolution/src/lib/core/metricCatalog.ts` + `evolution/src/lib/metrics/registry.ts` — 1 during-execution cost def + 2 cost propagation defs (mirror `generation_cost` pattern) + 3 propagation defs for the operational-health metrics. Each operational-health metric includes a **runtime-tunable threshold** (`alertWhen`) read from env vars at registry init with hardcoded fallbacks (per Rollout/Rollback section — staging measurements re-tune without code deploy):
   - `iterative_edit_accept_rate alertWhen > Number(process.env.EVOLUTION_EDITING_ACCEPT_RATE_ALERT_THRESHOLD ?? 0.95)` (rubber-stamping signal).
   - `iterative_edit_drift_rate alertWhen > Number(process.env.EVOLUTION_EDITING_DRIFT_RATE_ALERT_THRESHOLD ?? 0.30)`.
   - `iterative_edit_recovery_success_rate alertWhen < Number(process.env.EVOLUTION_EDITING_RECOVERY_SUCCESS_RATE_ALERT_THRESHOLD ?? 0.70)`.
   - Threshold rendering is best-effort; firing alerts is out of scope (the dashboard simply colors out-of-band values red). Document the env vars in `evolution/docs/reference.md` Kill Switches table alongside the feature flags.
- [ ] **1.5a** New migration `supabase/migrations/<timestamp>_evolution_cost_calibration_reflection_phase.sql` — DROP the existing inline-anonymous CHECK and RECREATE as a named constraint with `'reflection'` added (per Phase B detailed-review pass: the existing migration at `supabase/migrations/20260414000001_evolution_cost_calibration.sql:15` defines an inline column constraint without an explicit name, so Postgres auto-generates `evolution_cost_calibration_phase_check` — fragile if a future ALTER changes the rules). The new shape: `ALTER TABLE evolution_cost_calibration DROP CONSTRAINT IF EXISTS evolution_cost_calibration_phase_check; ALTER TABLE evolution_cost_calibration ADD CONSTRAINT evolution_cost_calibration_phase_allowed CHECK (phase IN ('generation','ranking','seed_title','seed_article','reflection'));`. The named constraint is the stable handle the Phase 1.6 startup assertion queries by `conname = 'evolution_cost_calibration_phase_allowed'`. Forward-only. Fixes PR #1017's silent-reject bug. **Independent of editing** — can ship and revert (re-pinned to old name) without touching editing-phase additions. See Decisions §18.
- [ ] **1.5b** New migration `supabase/migrations/<timestamp+1s>_evolution_cost_calibration_editing_phases.sql` — DROP+RECREATE the now-named constraint with editing phases added: `ALTER TABLE evolution_cost_calibration DROP CONSTRAINT evolution_cost_calibration_phase_allowed; ALTER TABLE evolution_cost_calibration ADD CONSTRAINT evolution_cost_calibration_phase_allowed CHECK (phase IN ('generation','ranking','seed_title','seed_article','reflection','iterative_edit_propose','iterative_edit_review','iterative_edit_drift_recovery'));`. Same constraint name preserved across the rename for assertion stability. Forward-only. Independent rollback path from 1.5a. See Decisions §18.
- [ ] **1.6** Phase enum sync across **both** TS sites + standalone startup assertion (per Round 3 review pass-2 follow-up — assertion must run unconditionally, not gated behind `COST_CALIBRATION_ENABLED`):
   - `evolution/scripts/refreshCostCalibration.ts` — add the three editing phases (`'iterative_edit_propose'`, `'iterative_edit_review'`, `'iterative_edit_drift_recovery'`) **plus `'reflection'`** (PR #1017 left this gap) to the `Phase` literal type and `asPhase()` mapping.
   - `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts:24` — extend `CalibrationRow['phase']` literal-type union with the same 4 additions. Without this extension, Phase 1.7's cost estimator calls into the loader fail to typecheck. (Pass-1 cited the wrong directory — corrected per Phase B detailed-review.)
   - **NEW module** `evolution/src/lib/core/startupAssertions.ts` (~80 LOC) — standalone deploy-ordering gate, invoked once from `agentRegistry.ts` lazy-init path BEFORE returning agent classes:
     - Function `assertCostCalibrationPhaseEnumsMatch(client: SupabaseClient): Promise<void>`. The caller (`agentRegistry.ts`) provides a Supabase client built with the **service-role key** (the same client `costCalibrationLoader.ts` uses; service-role has explicit GRANT ALL access per `supabase/migrations/20260414000001_evolution_cost_calibration.sql:34-35`, including `pg_catalog` reads). Service-role bypasses RLS; `pg_catalog` access is granted to all roles by default but the assertion is defensive — see error-handling below.
     - Runs `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'evolution_cost_calibration_phase_allowed'` — keyed off the **explicit named constraint** introduced by Phase 1.5a's DROP+RECREATE migration (per Phase B detailed-review fix — the original auto-named `_phase_check` was brittle). If the migration hasn't run yet, the query returns zero rows; assertion treats that as "migration missing" and throws with the file path of 1.5a.
     - Parses the IN-list; asserts every value in the LOCAL `Phase` literal union (from `refreshCostCalibration.ts`) AND `CalibrationRow['phase']` literal union (from `pipeline/infra/costCalibrationLoader.ts`) is present in the DB CHECK.
     - **Error handling**:
       - DB query throws `permission denied` for `pg_catalog` → catch it, log a loud warning naming the role + table, and **fail open** (return without throwing). Rationale: permission denial only happens in mis-configured local/test environments; in prod the service-role client has access. Failing open avoids the assertion bricking environments where the underlying problem is config drift, not actual phase mismatch. Unit test covers this path.
       - DB query throws connection error → re-throw (a connection problem during agent registry init is already going to break the service; failing fast is correct).
       - Constraint not found (zero rows) → throw `MissingMigrationError` referencing 1.5a's file path.
       - IN-list parse error (malformed) → throw `MissingMigrationError` with the raw constraint def.
       - Phase mismatch (TS values missing from DB) → throw `MissingMigrationError` naming the missing values and the migration file(s) expected to add them.
     - **`MissingMigrationError`** class declared inside `startupAssertions.ts` (extends `Error`, sets `name = 'MissingMigrationError'`); not exported from a shared module since it's only thrown here.
     - Idempotent: caches positive result for the process lifetime; re-runs on first registry init only.
     - Runs unconditionally — does NOT inherit `COST_CALIBRATION_ENABLED` (deliberate: that flag controls calibration writes, not assertion correctness).
     - Unit test `startupAssertions.test.ts` (~150 LOC, ~10 cases): mock the Supabase client returning various `pg_get_constraintdef` results: (a) CHECK with one phase missing → throws naming missing phase; (b) CHECK matching exactly → returns silently; (c) CHECK has extra phases → doesn't throw (DB-superset-of-TS allowed during rollout); (d) zero rows from constraint query → throws `MissingMigrationError` referencing 1.5a; (e) `permission denied` thrown → catches, logs warning, returns (fail-open); (f) connection error → re-throws; (g) malformed IN-list → throws; (h) idempotency: second call same process returns from cache; (i) both TS sources contribute (`Phase` and `CalibrationRow['phase']` independently asserted); (j) extra entries in `CalibrationRow['phase']` not in `Phase` → still asserted independently.
   - **Why this placement** (per Round 3 review pass-2 finding): if the assertion lived inside the cost-calibration loader, it would inherit the loader's `COST_CALIBRATION_ENABLED` gate (default `false`) and only run when calibration writes are enabled — exactly the conditional-execution failure mode PR #1017 hit. Hoisting to `startupAssertions.ts` invoked from `agentRegistry.ts` makes it run on every server boot.
- [ ] **1.7** `evolution/src/lib/pipeline/infra/estimateCosts.ts` — cost-model corrections per Round 3 review S1 + S4:
   - **Proposer output is article-size-dependent, NOT a fixed 7500-char budget.** Earlier draft used `__builtin_iterative_edit_propose__: 7500` claiming "1.4× input"; this systematically under-reserves by 2–3× for typical 9–13 KB articles. Fix:
     - Drop the `__builtin_iterative_edit_propose__` constant from `EMPIRICAL_OUTPUT_CHARS`.
     - In `estimateIterativeEditingCost`, compute proposer expected output as `seedChars * 1.15` (article verbatim + ~15% markup overhead) and proposer upper-bound output as `seedChars * 1.5 * 1.4` (size-ratio guardrail × markup overhead — see Decisions §17).
   - Keep `__builtin_iterative_edit_review__: 500` (one JSON line per edit, output truly bounded) and `__builtin_iterative_edit_drift_recovery__: 200` (per drift region, typically 1–3) since these are not article-size-dependent.
   - Add `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, maxCycles)` returning `{ expected, upperBound }`:
     - `expected` = `maxCycles × (proposeCallCost(seedChars, editingModel) + reviewCallCost(approverModel))`.
     - `upperBound` adds `maxCycles × proposeCallCost(seedChars * 1.5^cycleIdx, editingModel)` (input grows up to 1.5× per cycle under the size-ratio guardrail) + one drift recovery worst-case + 30% safety margin.
     - `approverModel` is a NEW parameter (was missing from the earlier signature); falls back to `editingModel` at the call site, then `generationModel`.
   - **Integration with `V2CostTracker`**: the per-iteration reserve uses `upperBound × parallelDispatchCount`; if reservation fails the iteration aborts cleanly with `BudgetExceededError` BEFORE any dispatch (no partial-cycle artifacts). Add unit test asserting the upper-bound covers a 5-cycle run on a 13 KB article without iteration-mid `BudgetExceededError`.
   - Extend `EstPerAgentValue` (`projectDispatchPlan.ts:69`) with `editing: number` field (mirrors PR #1017's `reflection: number` pattern; only > 0 when `iterCfg.agentType === 'iterative_editing'`, 0 for generate / reflect / swiss). Update `total` derivation, the wizard cost preview readouts, and the test fixtures that construct `EstPerAgentValue` literals (grep for `gen:` `rank:` `reflection:` triples). Wizard cost-bar gets a third color slice for editing, parallel to PR #1017's reflection slice.
- [ ] **1.8** **Replace** orphaned `iterativeEditingExecutionDetailSchema` (lines 660–686) — V1-rubric-shaped, doesn't fit the new design. Author a fresh schema (reuse the variable name `iterativeEditingExecutionDetailSchema` per V2 schema-naming convention — no `Agent` suffix; matches `swissExecutionDetailSchema`, `reflectAndGenerateExecutionDetailSchema`, etc.) with `detailType: 'iterative_editing'` and `cycles[]` containing `{cycleNumber, proposedMarkup, proposedGroupsRaw[], droppedPreApprover[], approverGroups[], reviewDecisions[], droppedPostApprover[], appliedGroups[], acceptedCount, rejectedCount, appliedCount, formatValid, newVariantId?, parentText, childText?, driftRecovery?}` (full shape in research doc). Rewrite `executionDetailFixtures.iterativeEditingDetailFixture` (variable name unchanged) to match the new shape. Update `agentExecutionDetailSchema` discriminated union slot. Also update `InvocationEntity.listFilters` (lines 49–54): replace `'iterativeEditing'` with `'iterative_editing'`.
- [ ] **1.9** Cleanup: delete ghost `mutate_clarity` / `crossover` / `mutate_engagement` from `TACTIC_PALETTE` (`tactics/index.ts:94–96`); delete unused `evolution/src/lib/legacy-schemas.ts`; fix `low_sigma_opponents_count` → `low_uncertainty_opponents_count` mismatch at `schemas.ts:819` vs `detailViewConfigs.ts:166`.
- [ ] **1.10** Build `evolution/src/lib/pipeline/loop/editingDispatch.ts` (~80 LOC) — **two thin entry points sharing a common cutoff-arithmetic core**, since the planner and runtime have different data shapes (per Round 3 review pass-2 finding: `projectDispatchPlan.DispatchPlanContext` has `{seedChars, initialPoolSize: number}` only — no Variant[], no Elo. Trying to share a single signature with the runtime forces planner-side data the planner doesn't have. Splitting is the principled fix; the shared inner function keeps the math identical):
   - **Shared inner function** `applyCutoffToCount(poolSize: number, cutoff: { mode: 'topN' | 'topPercent'; value: number }): { eligibleCount: number; effectiveCap: 'eligibility' | 'pool_size' | 'unbounded' }` — pure arithmetic, no Variant/Rating dependency. This is the single source of truth for cutoff semantics. Unit test covers all topN/topPercent edge cases.
   - **Runtime entry**: `resolveEditingDispatchRuntime(args: { iterCfg: IterationConfig; pool: Variant[]; arenaVariantIds: Set<string>; iterationStartRatings: Map<variantId, Rating> }): { eligibleParents: Variant[]; effectiveCap }`. Filters arena, sorts by Elo descending using `iterationStartRatings`, calls `applyCutoffToCount(filteredPool.length, iterCfg.editingEligibilityCutoff)`, slices to `eligibleCount`. Used by Phase 3.3 in `runIterationLoop`.
   - **Planner entry**: `resolveEditingDispatchPlanner(args: { iterCfg: IterationConfig; projectedPoolSize: number }): { eligibleCount: number; effectiveCap }`. Calls the same `applyCutoffToCount` directly with `projectedPoolSize` (the projected pool count at iteration start, conservatively excluding arena entries). Used by Phase 3.4 in `projectDispatchPlan`.
   - **Why split (vs single shared function):** PR #1017's `resolveReflectionEnabled` takes only `iterCfg` (static config), so it's trivially shareable. Editing eligibility is genuinely pool-dependent, which the planner doesn't carry. Splitting at the type-shape boundary while sharing the cutoff arithmetic gives us SSOT for the math (the actual drift risk) without forcing the planner to materialize Variant[]. Documented intentional split, not silent drift.
   - **Test that the math agrees**: in `editingDispatch.test.ts`, write parallel cases asserting `resolveEditingDispatchRuntime({ pool: [10 variants] }).eligibleParents.length === resolveEditingDispatchPlanner({ projectedPoolSize: 10 }).eligibleCount` for each cutoff mode. This catches drift if someone ever modifies one entry without the other.
   - Unit test `editingDispatch.test.ts` (~150 LOC, ~14 cases): all of the above, plus topN with pool larger than cutoff, topN with pool smaller than cutoff, topPercent rounding, all-arena pool (eligibleParents empty), Elo tie-breaking deterministic, missing rating treated as -inf, cutoff ≤ 0 rejected (validator-side concern but defensive guard test).

### Phase 2: Proposer + Implementer + Approver components + unit tests (Week 2)

> **Three-role architecture** (research doc § "How IterativeEditingAgent Works"). Two LLM calls per cycle (Proposer, Approver) and one deterministic safety layer (Implementer) that runs twice per cycle: a pre-Approver pre-check that parses positions, runs a strip-markup drift check against `current.text`, filters hard-rule violators, and a post-Approver application step that resolves range overlaps and format-validates. **No fuzzy anchor matching** — every edit has an exact byte position from the Proposer's marked-up output.

#### 2.A — IterativeEditingAgent class (orchestration)

- [ ] **2.A.0** Create `evolution/src/lib/core/agents/editing/constants.ts` (~30 LOC) — module-level constants used by `IterativeEditingAgent` and its helpers. Per Phase B detailed-review fix: pass-1 referenced `AGENT_DEFAULT_MAX_CYCLES`, `DRIFT_MAX_REGIONS`, `DRIFT_MAX_CHARS`, `CONTEXT_LEN`, etc. without specifying their module location, leaving execution ambiguous:
   ```ts
   export const AGENT_DEFAULT_MAX_CYCLES = 3;
   export const AGENT_MAX_ATOMIC_EDITS_PER_CYCLE = 30;
   export const AGENT_MAX_ATOMIC_EDITS_PER_GROUP = 5;
   export const SIZE_RATIO_HARD_CAP = 1.5;
   export const DRIFT_MAX_REGIONS = 3;
   export const DRIFT_MAX_CHARS = 200;
   export const CONTEXT_LEN = 30;
   export const PER_INVOCATION_BUDGET_ABORT_FRACTION = 0.9;
   ```
   Also create `evolution/src/lib/core/agents/editing/types.ts` declaring `IterativeEditInput`, `IterativeEditOutput`, `IterativeEditingExecutionDetail`, `EditGroup`, `AtomicEdit`, `ReviewDecision`, `DriftRegion` types. **Type shape decision** (per Phase B detailed-review fix — pass-1 left the input shape ambiguous; existing variant-producing agents use `parentText: string + parentVariantId: string` separate primitives, but editing needs the full Variant for chained-cycle invariants and AnnotatedProposals UI):
   ```ts
   export type IterativeEditInput = {
     parent: Variant;  // Full Variant object, not separate primitives — agent reads variantId/text/strategy/etc throughout the loop
     perInvocationBudgetUsd: number;  // Set by Phase 3.3 dispatch
     // No tactic field — editing picks no tactic (per Phase 2.A.1 contract table, B051-equivalent inversion)
   };
   ```
   The deviation from the `parentText + parentVariantId` convention is documented intentional: the editing agent needs `parent.text` AND `parent.variantId` AND can plausibly extend to use other Variant fields in v1.1+ without an interface widening. Phase 3.3's dispatch path constructs this input by selecting one Variant from the `eligibleParents` slice.
- [ ] **2.A.1** Create `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` (~280 LOC). Extend `Agent<IterativeEditInput, IterativeEditOutput, IterativeEditingExecutionDetail>` (types from Phase 2.A.0). Set `usesLLM = true`, `name = 'iterative_editing'`.
   - **Header comment block** — must mirror `reflectAndGenerateFromPreviousArticle.ts:1-17` and document Decisions §13 invariants verbatim (I1: no nested `Agent.run()` for inline helpers; I2: `costBefore*` snapshots before each LLM call; I3: partial `execution_detail` written before re-throw on helper failure). The comment block is load-bearing — invariant-test in Phase 2.A.5 greps for it.
   - **Base-class contract conformance** (per Round 3 review A5 — every variant-producing agent inherits a set of contracts; this agent must enumerate which apply, are inverted, or are no-ops). **B0xx markers below are taken from the actual `Agent.ts` source** (per Round 3 review pass-2 follow-up — pass-1 mis-attributed several markers; the table is now grounded in real comments in `Agent.ts:46/146/151/153/172` and `agentRegistry.ts:4`):

     | Contract | Source location | Behavior in `IterativeEditingAgent` |
     |---|---|---|
     | **B047** — `startMs` captured as the very first statement of `run()`, before invocation row creation | `Agent.ts:46-49` | **Inherited unchanged.** The wrapper's `run()` template handles this. The agent class does not override `run()`. |
     | **B048** — extract `surfaced` flag from agent output for `evolution_variants.variant_surfaced` | `Agent.ts:151` | **Required.** Set `surfaced: true` in the returned `AgentOutput` when at least one cycle accepted edits AND format-valid AND `appliedCount > 0`. Set `false` for all-rejected / no-edits-proposed / parse-failed / drift-abort / size-explosion. Flag flows through `updateInvocation` to `evolution_variants.variant_surfaced` identically to generate. |
     | **B051** — detail-schema validation result must match what was written to the invocation row (success/failure parity) | `Agent.ts:146, 172` | **Required.** Wrap the cycle loop in try/catch; on any helper throw, write partial `execution_detail.cycles[]` + `stopReason: 'helper_threw'` + `errorMessage` BEFORE re-throwing (Decisions §13 invariant I3). Ensures the row's `success` field stays consistent with the return value's success even on partial-cycle failures. |
     | **B053** — variant-rollups filter via `variant_surfaced IS NOT FALSE` | `Agent.ts:153` | **Inherited.** No agent-side action — but the contract is the reason B048 is non-optional. Editing rows that emit no surfaced variant (all-rejected etc.) get `variant_surfaced = false` and are correctly excluded from rollups. |
     | **B054** — agent registry uses static (not dynamic) imports to keep `AgentCostScope` correct at first call | `agentRegistry.ts:4` | **Inherited.** `IterativeEditingAgent` is statically imported in `agentRegistry.ts`; no dynamic `await import(…)`. |
     | **`tactic` auto-extraction** (no B-marker; lives at `Agent.ts:52`) | `Agent.ts:52` | **Inverted (no-op).** `IterativeEditInput` does not carry `tactic`; the editing agent picks no tactic. `evolution_agent_invocations.tactic` is `null` for editing rows. Tactic-cost rollups (Phase 4.7 `CostEstimatesTab`) filter or bucket editing rows separately via the `name.includes('edit')` branch. |
     | **FK threading** via `createEvolutionLLMClient` (no B-marker; lives at `Agent.ts:107`) | `Agent.ts:107` | **Same as generate.** The wrapper-instantiated `EvolutionLLMClient` carries `invocationId`; all 2–3 LLM helper calls per cycle reuse this client (per Decisions §13 invariant I1) and write `evolution_llm_call_tracking` rows linked to the wrapper's single invocation row. |
     | **Single `Variant` per `AgentOutput`** (no B-marker; implicit in `AgentOutput<TOutput>` shape used by `MergeRatingsAgent.newVariants`) | `types.ts` `AgentOutput` | **Preserved** per Decisions §14. Only the final cycle's text materializes as a `Variant`. Intermediate cycles live in `execution_detail.cycles[i].childText` (no `evolution_variants` rows, no arena rows, no Elo). The final variant's `parent_variant_id` is `input.parent.variantId`, NOT cycle-N-1's intermediate. |

     If a future contract (B055+) is added to `Agent.ts` or `agentRegistry.ts`, this table must be extended in the same edit. Phase 2.A.5 invariant test parses Agent.ts/agentRegistry.ts for `// B0\d{2}:` markers and asserts each appears as a row in this table.
- [ ] **2.A.2** Per-invocation `EvolutionLLMClient` via `Agent.run()` template. `AgentCostScope.getOwnSpent()` for cost attribution. Per Decisions §13 invariant I1, the agent's `execute()` receives a single `EvolutionLLMClient` instance and **all internal helpers** (Proposer, Approver, drift-recovery) are called with this same client — never via a nested `Agent.run()`. Per Decisions §15, the agent also receives `perInvocationBudgetUsd` from the orchestrator dispatch (see Phase 3.3); the agent reads `scope.getOwnSpent()` at the start of each cycle and exits with `stopReason: 'invocation_budget_near_exhaustion'` if `spent >= perInvocationBudgetUsd * 0.9`.
- [ ] **2.A.3** Implement main `execute()` loop (~140 LOC). The agent receives ONE parent variant via `input.parent` (assigned by the orchestrator dispatch — see Phase 3.3). Resolve config: `maxCycles = iterCfg.editingMaxCycles ?? AGENT_DEFAULT_MAX_CYCLES (3)`, `editingModel = config.editingModel ?? config.generationModel`, `approverModel = config.approverModel ?? editingModel`, `perInvocationBudgetUsd = input.perInvocationBudgetUsd` (set by Phase 3.3 dispatch). The agent's `current` starts as a Variant-shaped in-memory object cloned from `input.parent` and chains forward through cycles **without persisting intermediates** (per Decisions §14). For each cycle 1..maxCycles:
   0. **Per-invocation budget check** (per Decisions §15): if `scope.getOwnSpent() >= perInvocationBudgetUsd * 0.9`, exit with `stopReason: 'invocation_budget_near_exhaustion'`. Capture `costBeforeProposeCall = scope.getOwnSpent()` for per-purpose split (per Decisions §13 invariant I2).
   1. **Proposer call**: send `current.text` + soft-rules system prompt with `model: editingModel` → `proposedMarkup`. Capture `proposeCostUsd = scope.getOwnSpent() - costBeforeProposeCall`.
   2. **Implementer pre-check (parse + position math)**:
      a. Parse markup, extract atomic edits with `markupRange`, group by `[#N]`
      b. Strip markup → `recoveredSource`. Compute drift regions vs `current.text` with normalized whitespace.
      c. Compute each atomic edit's `range` (positions in `current.text`) by mapping markup positions through the strip operation; capture `contextBefore` / `contextAfter`
   3. **Drift handling** (if any drift detected):
      a. Classify magnitude: major (> 3 regions OR > 200 chars OR markup overlap) → exit with `stopReason: 'proposer_drift_major'`
      b. Else minor → if `EVOLUTION_DRIFT_RECOVERY_ENABLED !== 'false'`, capture `costBeforeRecoveryCall = scope.getOwnSpent()` and call `recoverDrift(...)` — returns `{ outcome, patchedMarkup?, classifications[] }`. Capture `driftRecoveryCostUsd`.
      c. On `outcome === 'recovered'`: re-parse the patched markup; continue with the patched groups
      d. On `outcome === 'unrecoverable_intentional'`: exit `stopReason: 'proposer_drift_intentional'`
      e. On `outcome === 'unrecoverable_residual'`: exit `stopReason: 'proposer_drift_unrecoverable'`
      f. If recovery disabled by flag: exit `stopReason: 'proposer_drift_major'` regardless of magnitude
   4. **Validate hard rules + size-ratio guardrail** per atomic edit; drop violator groups silently. Cap groups to ≤ 30 atomic edits / cycle and ≤ 5 atomic edits / group. **Size-ratio guardrail (per Decisions §17):** simulate applying all `approverGroups` and compute `projectedNewText.length / current.text.length`. If ratio > 1.5×, drop the highest-numbered groups one at a time until ratio ≤ 1.5×; if no group-dropping reduces ratio below 1.5× (e.g., a single mega-insertion exceeds the cap on its own), exit with `stopReason: 'article_size_explosion'`. → `{ approverGroups, droppedPreApprover[] }`. If `approverGroups.length === 0` → exit with `stopReason: 'no_edits_proposed'` or `'parse_failed'`
   5. **Approver call**: send `proposedMarkup` (or `proposedMarkupPatched` if recovery fired) + group summary with `model: approverModel` → JSONL. Capture `costBeforeApproveCall` before, `approveCostUsd` after (per Decisions §13 invariant I2).
   6. **Parse Approver output** → `reviewDecisions[]` (missing decisions default to `reject`)
   7. **Implementer application**: collect atomic edits from accepted groups, detect range overlaps between groups (drop later group on conflict), verify each edit's context-string failsafe + `oldText` match against `current.text` (drop group on mismatch), sort survivors by `range.start` descending, apply right-to-left to `current.text` → `newText`. Format-validate per B047 (Phase 2.A.1 contract table). → `{ newText, droppedPostApprover[], appliedGroups[] }`
   8. **Cycle materialization (per Decisions §14): in-memory only.** If `newText !== current.text` and format-valid: build a Variant-shaped object `nextCurrent = { ...current, text: newText, variantId: undefined }` (no DB write, no pool insert, no Elo). Set `current = nextCurrent` so the next cycle's Proposer sees the updated text. Record `childText: newText` and `proposeCostUsd / approveCostUsd / driftRecoveryCostUsd` in `execution_detail.cycles[i]`. **No `evolution_variants` row, no `evolution_arena_comparisons` row, no Elo at this point.**
   9. If `appliedCount === 0`: exit with `stopReason: 'all_edits_rejected'`
   10. **After the cycle loop terminates** (any reason): if any cycle accepted edits AND `current.text !== input.parent.text`, emit ONE final `Variant` from `execute()`'s return value (`AgentOutput.newVariants = [finalVariant]`). The final variant's `parent_variant_id` is `input.parent.variantId` (the original input parent — NOT cycle-N-1's intermediate, per Decisions §14). MergeRatingsAgent assigns a default rating in Phase 3.3. If no cycle accepted edits, return `AgentOutput.newVariants = []` and `surfaced: false`.
- [ ] **2.A.4** Emit rich `execution_detail.cycles[]` per cycle (full shape per research doc § "execution_detail shape"). Each cycle entry has `proposedMarkup` + `proposedGroupsRaw` + `droppedPreApprover[]` + `approverGroups[]` + `reviewDecisions[]` + `droppedPostApprover[]` + `appliedGroups[]` + `parentText` + `childText` + `proposeCostUsd` + `approveCostUsd` + `driftRecoveryCostUsd?` + `sizeRatio` (final-newText / cycle-input-text length ratio for monitoring). Plus partial-detail-on-throw (Decisions §13 invariant I3): wrap the cycle loop in try/catch; on any helper throw, write `execution_detail.cycles[]` accumulated so far + `stopReason: 'helper_threw'` + `errorMessage` + `errorPhase: 'propose' | 'parse' | 'approve' | 'recovery' | 'apply'` BEFORE re-throwing.
- [ ] **2.A.5** Invariant test `IterativeEditingAgent.invariants.test.ts` (~150 LOC, mirrors `reflectAndGenerateFromPreviousArticle.invariants.test.ts`). Per Round 3 review pass-2 follow-up — the regex contract was over-broad (`new XAgent(` is the legal wrapper-delegate pattern, not the forbidden one). The forbidden pattern is `.run(` inside `execute()` (creates a nested `AgentCostScope`):
   - Read the agent source file as text; assert the LOAD-BEARING INVARIANTS comment block exists at the top (regex match for "I1", "I2", "I3" headers).
   - **Extract the body of `IterativeEditingAgent.execute()`** (between the `async execute(` line and the matching closing `}` at the same indent). Assert this slice contains **no `\\.run\\(`** call (guards Decisions §13 invariant I1: nested `Agent.run()` would fork the cost scope). Note: `new SomeAgent().execute(...)` IS legal per the wrapper-delegate pattern at `reflectAndGenerateFromPreviousArticle.ts:414` and is NOT prohibited by this test — only `.run(` is.
   - Assert all 3 helper call sites (propose / approve / recoverDrift) are immediately preceded by a `costBefore*` capture (regex pattern check on the same execute() slice — guards I2).
   - Assert the cycle loop body is wrapped in try/catch with a partial-detail write before re-throw (guards I3).
   - **Contract-table coverage**: parse `Agent.ts` and `agentRegistry.ts` for `// B\\d{3}:` comment markers. Build a set of marker IDs found. Read this planning doc's Phase 2.A.1 conformance table; build a set of marker IDs documented. Assert documented ⊇ found (every B-marker in source has a row in the table; the table may add unprefixed contracts like tactic auto-extraction). When B055+ are added to source without updating the table, this test fails — forcing the table to stay current.

#### 2.B — Proposer (LLM call #1)

- [ ] **2.B.1** Build `evolution/src/lib/core/agents/editing/proposerPrompt.ts` (~80 LOC):
   - System prompt embeds **all soft rules** (preserve quotes, citations, URLs; no new headings; one-sentence edits preferred; no edits in code blocks; preserve voice and tone).
   - Inline syntax docs (3 markup forms with examples).
   - Output-format instruction: full article with inline numbered edits, no commentary.
   - Use AgentName label `iterative_edit_propose`.
- [ ] **2.B.2** Unit tests `proposerPrompt.test.ts` (~80 LOC, ~6 cases) — assert all soft rules present in rendered prompt; assert syntax examples include all 3 forms; assert AgentName label routes to correct cost metric.

#### 2.C — Implementer pre-check (deterministic, parser + validator)

- [ ] **2.C.1** Build `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` (~280 LOC):
   - Regex extraction for `{++ [#N] ... ++}`, `{-- [#N] ... --}`, `{~~ [#N] ... ~> ... ~~}`.
   - For each atomic edit, record `markupRange: {start, end}` (byte positions in `proposedMarkup`).
   - Group atomic edits by `[#N]` into `EditGroup[]`.
   - Adjacent same-`[#N]` add+delete merged into one `replace` edit.
   - **Strip-markup pass**: produce `recoveredSource` (the marked-up text with all CriticMarkup removed and only the "before" content kept — i.e., for a substitution, keep the deleted text; for an insertion, keep nothing; for a deletion, keep the deleted text). Track a `markupPos → sourcePos` offset map so we can translate each atomic edit's `markupRange` into `range: {start, end}` in `current.text`.
   - **Context capture (failsafe)**: for each atomic edit, after `range` is computed, capture `contextBefore = current.text.slice(max(0, range.start - CONTEXT_LEN), range.start)` and `contextAfter = current.text.slice(range.end, min(current.text.length, range.end + CONTEXT_LEN))` where `CONTEXT_LEN = 30`. Used by the applier to verify positions still match before splicing.
   - Adversarial handling: unbalanced tags → drop the unbalanced atomic edit silently; nested tags → drop silently; missing `[#N]` → auto-assign sequential; combined-form `~~` substitution where content contains `~>` → drop silently (use paired form instead); duplicate non-paired numbers → keep first, drop rest.
   - Return `{ groups: EditGroup[], recoveredSource: string, dropped: Array<{ reason, detail }> }`.
- [ ] **2.C.2** Build `evolution/src/lib/core/agents/editing/checkProposerDrift.ts` (~50 LOC):
   - Compare `recoveredSource` to `current.text` with normalized whitespace (collapse runs, trim line ends; preserve paragraph breaks).
   - Return `{ drift: false }` on match, or `{ drift: true, firstDiffOffset: number, sample: string }` on mismatch.
   - This is a **cycle-level kill switch**: any drift means the Proposer modified text outside its markup, and we cannot trust positions.
- [ ] **2.C.3** Build `evolution/src/lib/core/agents/editing/validateEditGroups.ts` (~150 LOC):
   - Hard-rule checks (per atomic edit, using `range.start`/`range.end` against `current.text`): length cap 500, no `\n\n` in `oldText`, no heading-line overlap (range crosses any `^#+ ` line), no heading line in `newText`, no code fence in `oldText`/`newText`, no list-item-boundary span, no horizontal-rule line.
   - **Group-level enforcement: any atomic edit in a group fails any hard rule → drop the whole group**.
   - Cap enforcement: total atomic edits ≤ 30 (drop excess groups in number order); each group ≤ 5 atomic edits (drop wholesale).
   - Return `{ approverGroups: EditGroup[], droppedPreApprover: Array<{ groupNumber, reason, detail }> }`.
- [ ] **2.C.4** Unit tests `parseProposedEdits.test.ts` (~400 LOC, ~32 cases): well-formed input (all 3 forms), grouped edits sharing `[#N]` (cross-document), unbalanced tags (silently dropped), nested tags (silently dropped), missing numbers (auto-assigned), duplicate non-paired numbers (first kept), combined `~~` form with `~>` in content (silently dropped), paired add/delete merged correctly, position extraction at document start/end, Unicode in edit content, multiple groups in one paragraph, position math correctness (range maps to correct bytes in `current.text`), `markupRange` matches `proposedMarkup` slice exactly, recoveredSource correctness for each edit type, **context capture** at document start (contextBefore truncated/empty), at document end (contextAfter truncated/empty), with adjacent edits (their contexts overlap, both captured correctly), exact CONTEXT_LEN boundary correctness (length 30 enforced).
- [ ] **2.C.5** Unit tests `checkProposerDrift.test.ts` (~100 LOC, ~10 cases): exact match (no drift), trivial whitespace differences (no drift), one-character text difference (drift detected, offset reported), proposer added text outside markup (drift), proposer removed text outside markup (drift), normalized newlines (no drift).
- [ ] **2.C.6** Unit tests `validateEditGroups.test.ts` (~250 LOC, ~20 cases): each hard rule (10), group-level coherence (single bad atomic → whole group dropped), cycle cap (30+ edits), group cap (6+ edits), edge cases (heading at very start of document, code fence at very end, etc.).
- [ ] **2.C.7** Property-based test `parseProposedEdits.property.test.ts` — fast-check generators: parse → reconstruct → parse-again idempotency on well-formed inputs; arbitrary text never crashes parser; arbitrary `[#N]` numbers don't break grouping; range-correctness invariant (for any well-formed markup, every edit's `range` slices the correct content from `current.text`).
- [ ] **2.C.8** Build `evolution/src/lib/core/agents/editing/recoverDrift.ts` (~150 LOC):
   - **Magnitude classifier (deterministic)**: `classifyDriftMagnitude(driftRegions, proposedMarkup, edits): 'minor' | 'major'`. Major if `regions.length > 3` OR `totalDriftedChars > 200` OR any region overlaps any `markupRange` from the parser. Constants: `DRIFT_MAX_REGIONS = 3`, `DRIFT_MAX_CHARS = 200`.
   - **Recovery LLM call (when minor)**: `recoverDriftWithLLM(driftRegions, current.text, proposedMarkup, llm)` builds a focused prompt with each region's surrounding context (30 chars on each side, NEVER the full article), AgentName label `iterative_edit_drift_recovery`. System prompt: "classify each drift region as benign (cosmetic — smart quotes, dashes, whitespace, Unicode) or intentional (meaningful change). Output one JSON line per region: `{offset, classification, patch}`."
   - **JSONL parser**: line-by-line `JSON.parse`, skip unparseable lines, default missing classifications to `'intentional'` (conservative — abort cycle if we can't tell).
   - **Patcher (deterministic)**: for each `'benign'` region, splice `proposedMarkup` at `markupOffset` to replace the drifted text with the source patch. Ordering: apply patches in reverse-offset order (right-to-left) so offsets don't shift.
   - **Re-verify**: run `parseProposedEdits` + drift check on the patched markup. Return `{ outcome: 'recovered' | 'unrecoverable_residual' | 'unrecoverable_intentional', patchedMarkup?, regions, classifications, costUsd }`.
   - **Feature flag**: read `EVOLUTION_DRIFT_RECOVERY_ENABLED` once at function entry; if `'false'`, return early with `outcome: 'skipped_major_drift'` regardless of magnitude (caller treats this same as major drift).
- [ ] **2.C.9** Unit tests `recoverDrift.test.ts` (~250 LOC, ~18 cases):
   - Magnitude classifier: minor (small drift, no overlap) → `'minor'`; > 3 regions → `'major'`; > 200 chars → `'major'`; overlap with `markupRange` → `'major'`; exactly 3 regions, exactly 200 chars (boundary).
   - Recovery LLM call (mocked): all benign → patches applied, re-check passes, outcome `'recovered'`; one intentional → outcome `'unrecoverable_intentional'`; mixed → still `'unrecoverable_intentional'` (any intentional aborts).
   - Patcher correctness: smart-quote substitution patched, em-dash patched, multiple patches applied in reverse-offset order (positions don't shift mid-application), patched markup re-parses without drift.
   - Edge cases: zero regions (function shouldn't be called, but if it is → outcome `'recovered'` no-op); LLM returns malformed JSON line (skipped, missing classifications default to intentional); LLM returns extra fields (passthrough).
   - Feature flag: `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` → outcome `'skipped_major_drift'`, no LLM call, costUsd 0.
   - Re-check after patch: if patches don't fully resolve (residual drift) → outcome `'unrecoverable_residual'`.

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
- [ ] **2.D.4** Unit tests `approverPrompt.test.ts` (~80 LOC, ~6 cases) — assert all soft rules from Phase 2.B.1 are present in rendered prompt; assert edit summary table format renders one row per group; assert AgentName label `iterative_edit_review` routes to `iterative_edit_cost` metric. (Pass-1 listed this test in the Testing summary but no creating phase task existed; corrected per Phase B detailed-review.)

#### 2.E — Implementer application (deterministic, position-based applier)

- [ ] **2.E.1** Build `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` (~180 LOC):
   - Filter `approverGroups` to those with `decision === 'accept'`.
   - Build `acceptedAtomicEdits[]` — flatten all atomic edits from accepted groups, each tagged with its parent `groupNumber`.
   - **Detect range overlaps between groups**: for any two atomic edits from different groups whose `range`s overlap, drop the higher-numbered group entirely. Log to `droppedPostApprover[]` with `reason: 'application_conflict'` and detail showing both groups' numbers + ranges.
   - **Verify context-string failsafe** for each surviving accepted atomic edit, against `current.text` (positions are stable for the whole cycle since we apply right-to-left to a single source):
     - `actualBefore = current.text.slice(max(0, range.start - edit.contextBefore.length), range.start)` must equal `edit.contextBefore`
     - `actualAfter = current.text.slice(range.end, range.end + edit.contextAfter.length)` must equal `edit.contextAfter`
     - On either mismatch → drop the whole group, log to `droppedPostApprover[]` with `reason: 'context_mismatch'` and detail showing expected vs actual + offset
     - For `delete` and `replace`: also verify `current.text.slice(range.start, range.end) === oldText`. Same-group on mismatch.
   - Sort surviving accepted atomic edits by `range.start` **descending** (apply right-to-left so earlier positions don't shift).
   - Apply each edit by splicing `current.text` at `range`:
     - `insert`: `text.slice(0, range.start) + newText + text.slice(range.start)` (range.start === range.end for insertions)
     - `delete`: `text.slice(0, range.start) + text.slice(range.end)`
     - `replace`: `text.slice(0, range.start) + newText + text.slice(range.end)`
   - **Runtime invariant assertion (defense in depth)**: at end of function, if `appliedGroups.length === 0`, assert `newText === current.text`. If violated → throw `Error('applier invariant: zero groups applied but text changed')`. Indicates a splice-loop bug.
   - Format-validate final `newText`. If invalid: cycle is no-op, log `format_invalid_after_apply`.
   - Return `{ newText, droppedPostApprover, appliedGroups }`.
- [ ] **2.E.2** Unit tests `applyAcceptedGroups.test.ts` (~250 LOC, ~20 cases): single accepted group with one atomic edit, all rejected (newText === original), all accepted, group-internal coordination (1 group with 3 atomic edits across paragraphs all apply), overlapping accepted groups (later group dropped, earlier applies cleanly), reverse-position-order correctness (multiple edits at known offsets — verify each lands correctly), format-invalid post-apply (no-op cycle), insertion at document start, insertion at document end, delete-then-insert at same position from same group, all-or-nothing within a group preserved by overlap detection, **context-mismatch on contextBefore drop group**, **context-mismatch on contextAfter drop group**, **oldText-mismatch (delete/replace) drop group**, **edit at document start with truncated contextBefore (verify not a false-positive mismatch)**, **edit at document end with truncated contextAfter**.
- [ ] **2.E.3** Build reference reconstruction helper `evolution/src/lib/core/agents/editing/__test_helpers__/referenceReconstruction.ts` (~80 LOC) — for any `(proposedMarkup, decisions)` pair, walks the markup left-to-right and emits text by selecting "before" content for rejected/dropped groups (and unchanged for non-edit text) or "after" content for accepted groups. Implementation is markup-walking, not position-based — independent from the applier's algorithm. Used by property tests + sample-article tests as the source of truth for "what should the output be?". Not exported from the package's public API; lives only under `__test_helpers__/`.
- [ ] **2.E.4** Property test `applyAcceptedGroups.property.test.ts` (~250 LOC, 4 properties via fast-check):
   - **All-rejected idempotency**: for arbitrary `EditGroup[]`, when every decision is `reject`, `newText === current.text`.
   - **All-accepted equivalence**: for arbitrary well-formed `(proposedMarkup, EditGroup[])` with all accepts, applier output equals `referenceReconstruction(proposedMarkup, allAccepts)`.
   - **Mixed decisions equivalence (the strong tripwire)**: for arbitrary inputs and arbitrary mixed accept/reject decisions (no overlapping ranges, no context-failsafe failures), `applyAcceptedGroups(...).newText === referenceReconstruction(proposedMarkup, decisions)`. This catches position-math bugs, splice-direction bugs, group-flatten bugs, and any drift between the markup-based and position-based views.
   - **Length monotonicity**: `newText.length` is between `current.text.length` (all rejected) and a deterministic upper bound derived from accept decisions. Catches over-application + dropped-content bugs.
   Each property runs ≥ 100 fast-check iterations with seeded PRNGs; failing seeds should be persistable in the test file's `fc.assert(..., { seed })` for reproducibility.
- [ ] **2.E.5** Sample-article golden-master tests `applyAcceptedGroups.sampleArticles.test.ts` (~350 LOC, 5 articles × 3 scenarios = 15 cases):
   - Fixtures live in `evolution/src/lib/core/agents/editing/__fixtures__/sample-articles/`, one TypeScript module per article exporting `{ original, proposedMarkup, scenarios: { allAccept, allReject, mixed } }` where each scenario has `{ decisions: ReviewDecision[], expectedNewText: string, expectedDroppedPostApprover?: ... }`.
   - **Article 1 — `galapagos-finches.fixture.ts`** (3 paragraphs, ~200 words, no code blocks; the running example from research § "Sample article (working example)").
   - **Article 2 — `quantum-entanglement.fixture.ts`** (5 H2 sections, ~600 words; tests heading-touch hard rule by including a proposed edit that violates it — proposer markup includes a heading-edit, the validator must drop it before Approver sees it).
   - **Article 3 — `python-decorators.fixture.ts`** (technical, with 2 fenced code blocks; proposer instruction in fixture includes a no-op claim "do not edit code blocks"; verifies the parser doesn't try to edit inside them and the strip-markup pass handles them correctly).
   - **Article 4 — `morning-routine.fixture.ts`** (FAQ-style with bullet lists; tests list-item-boundary hard rule when a proposed edit would span two bullets).
   - **Article 5 — `civil-war-causes.fixture.ts`** (long-form, ~1500 words, 8 H2 sections, citations as `[1]`, `[2]`; soft-rule test: proposer suggests editing a citation; Approver should reject; this exercises the wider position math at scale).
   - Each scenario asserts `applyAcceptedGroups(...).newText === expectedNewText` AND that `appliedGroups`, `droppedPostApprover`, format validation all match the fixture's expectations.
   - Fixtures are hand-authored once (in this PR) so the golden master is intentional. CI never auto-updates them — failures mean either the fixture or the applier needs an explicit human review.

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
   - **Post-Approver drops (overlap)** — two accepted groups have overlapping ranges → later group dropped with `application_conflict`.
   - **Post-Approver drops (context mismatch)** — accepted group's `contextBefore` or `contextAfter` doesn't match `current.text` at the recorded offset → group dropped with `context_mismatch`. Surfaces as a paranoid failsafe; expected near-zero rate in production.
   - **Proposer-drift major drop** — Proposer modifies > 200 chars outside markup → cycle exits with `proposer_drift_major`, no recovery LLM call, no Approver call.
   - **Proposer-drift recovered** — Proposer drifts on smart quotes (≤ 3 regions, < 50 chars total) → recovery LLM classifies all as benign → patches applied → cycle continues normally; `execution_detail.cycles[0].driftRecovery.outcome === 'recovered'`.
   - **Proposer-drift intentional** — Proposer modifies a sentence outside markup → recovery LLM flags `intentional` → cycle exits with `proposer_drift_intentional`.
   - **Proposer-drift unrecoverable residual** — recovery LLM patches some regions but post-patch drift check still fails → cycle exits with `proposer_drift_unrecoverable`.
   - **Drift recovery feature-flag off** — `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` → minor drift treated as major; cycle exits `proposer_drift_major` without LLM call.
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
- [ ] **2.F.2** Sample-article end-to-end tests `IterativeEditingAgent.sampleArticles.test.ts` (~400 LOC, 5 articles × 2 scenarios = 10 cases):
   - Reuses the fixtures from `__fixtures__/sample-articles/` (authored in 2.E.5).
   - For each article, uses `v2MockLlm` with `labelResponses` queued so:
     - `iterative_edit_propose` returns the fixture's `proposedMarkup`
     - `iterative_edit_review` returns JSONL of the fixture's scenario decisions (mixed accept/reject + occasional malformed)
   - Drives `IterativeEditingAgent.execute()` end-to-end against an in-memory pool seeded with the fixture's `original` as the top variant.
   - Asserts: agent returns the expected `stopReason`; the new Variant's `text === scenario.expectedNewText`; `execution_detail.cycles[0]` contains the expected `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `reviewDecisions`, `droppedPostApprover`, `appliedGroups`; cost attribution is non-zero.
   - **Two scenarios per article: "single-cycle accept" (Approver accepts everything that survived pre-check, max=1 cycle) and "multi-cycle chain" (3 cycles where each cycle proposes against the previous cycle's accepted text — fixture provides 3 sets of `proposedMarkup` + decisions, expected output after each cycle).**
   - Same golden-master discipline as 2.E.5: fixtures hand-authored, not auto-generated.

### Phase 3: Pipeline integration + dispatch + agent registry (Week 3)
- [ ] **3.1** `evolution/src/lib/core/agentRegistry.ts` — register `new IterativeEditingAgent()` in lazy-init array.
- [ ] **3.2** Widen the iterationType union at **both** the producer and consumer sides (per Round 3 review pass-2 follow-up — Phase A pass 1 only covered the producer side):
   - **Producer**: `recordSnapshot()` at `runIterationLoop.ts:91` from the current 3 values (`'generate' | 'reflect_and_generate' | 'swiss'`, post-PR-1017) to 4 by adding `'iterative_editing'`. Update existing call sites (lines 313, 686, 699, 786, 809 — confirm exact line numbers at edit time) and add new call sites at iteration `start`/`end` of the new editing branch from Phase 3.3.
   - **Consumer**: `IterationSnapshotRow.iterationType` at `evolutionActions.ts:404` from `'generate' | 'swiss'` to the full 4-value union (`'generate' | 'reflect_and_generate' | 'iterative_editing' | 'swiss'`). PR #1017 widened the producer for reflection but left this consumer-side type behind; we close both gaps in this phase. Audit consumers (`SnapshotsTab.tsx:155`, run-detail dashboards) for narrowing assumptions that may break under strict mode.
- [ ] **3.3** Add new `else if (iterType === 'iterative_editing')` branch in `runIterationLoop.ts` (~160 LOC). Mirrors the existing generate branch's parallel + top-up pattern; the only difference is what each invocation receives as input.
   - **Compute parent assignment via runtime helper** (per Decisions §13 / Round 3 review A4): call `resolveEditingDispatchRuntime({ iterCfg, pool: iterationStartPool, arenaVariantIds, iterationStartRatings })` from Phase 1.10. Returns `{ eligibleParents, effectiveCap }`. Take `parents = eligibleParents.slice(0, min(eligibleParents.length, parallelBatchSize))` where `parallelBatchSize` comes from `projectDispatchPlan` (budget-governed). Same-parent re-editing within the iteration is forbidden — the top-up loop also walks the eligibility list and stops when exhausted, so unspent budget when the cutoff binds rolls back to the run-level tracker naturally.
   - **Per-invocation budget split** (per Decisions §15): `perInvocationBudgetUsd = remainingIterBudget / parallelBatchSize`. Pass this in each `IterativeEditingAgent` input so the agent can cap its own spend and exit early if approaching the limit, preventing one runaway invocation from starving siblings.
   - **Parallel batch dispatch** via `Promise.allSettled`: dispatch one `IterativeEditingAgent` per parent. Each invocation gets `input.parent: <distinct top-N variant>`, `input.perInvocationBudgetUsd`, its own deep-cloned `AgentCostScope`, its own invocation row.
   - **Top-up loop** (gated by `EVOLUTION_TOPUP_ENABLED`): after parallel batch resolves, measure `actualAvgCostPerAgent` from the parallel agents' `scope.getOwnSpent()`. **Per-top-up budget split** (per Round 3 review pass-2 follow-up — Decisions §15's starvation protection only held during the parallel batch; multiple serial top-ups gave the first one "the full remainder," leaving zero for siblings). Each top-up's `perInvocationBudgetUsd` is computed as `remainingBudget / projectedRemainingTopUps` where `projectedRemainingTopUps = max(1, floor(remainingBudget / actualAvgCostPerAgent))` — the conservative estimate of how many more top-ups will fire. After each top-up resolves, recompute `projectedRemainingTopUps` from the latest avg cost and the new remaining budget. While remaining iter budget covers another invocation AND there are still un-edited parents in the pool (next-best Elo not yet assigned), dispatch one more top-up using the recomputed `perInvocationBudgetUsd`. Top-up parents pull from the next Elo rank not yet edited this iteration via the same `resolveEditingDispatchRuntime` ordering. Cap at `DISPATCH_SAFETY_CAP = 100` like generate.
   - **Why this matters**: with a static "full remainder" allocation, two top-ups firing serially could see the first consume budget that the second was projected to use. The per-top-up split gives each subsequent top-up a fair share of the remaining budget, so Decisions §15's starvation invariant holds across BOTH the parallel batch AND the top-up phase.
   - **Single `MergeRatingsAgent.run({ iterationType: 'iterative_editing', ... })`** over combined parallel + top-up new-variants list (per Decisions §7 + §14): per Decisions §14, each invocation produces ZERO or ONE final `Variant` in `AgentOutput.newVariants` (intermediates live only in `execution_detail.cycles[i].childText`). Per Decisions §7, pass `iterationType: 'iterative_editing'` to keep observability consistent across `IterationSnapshot.iterationType` and `MergeRatingsAgent.execution_detail.iterationType`. The merge math is identical to the generate path. The agent does NOT emit per-cycle matches against the global pool in v1 — new variants enter the pool with default ratings and are ranked by subsequent swiss iterations.
   - `recordSnapshot(iterIdx, 'iterative_editing', 'start'/'end', ...)`.
- [ ] **3.3.1** Widen `MergeRatingsInput.iterationType` enum (per Decisions §7) at `evolution/src/lib/core/agents/mergeRatings.ts` from `'generate' | 'swiss'` to **`'generate' | 'reflect_and_generate' | 'iterative_editing' | 'swiss'`** (per Round 3 review pass-2 follow-up — closes the parallel observability gap PR #1017 left for reflect_and_generate). The merge math inside `MergeRatingsAgent` is unchanged. Also fix the runIterationLoop call site at `runIterationLoop.ts:686` (or current line — confirm at edit time; it's the `reflect_and_generate` branch's `mergeRatingsAgent.run({ iterationType: 'generate', ... })` call) to pass `'reflect_and_generate'` instead of `'generate'`. Update `MergeRatingsAgent.execution_detail.iterationType` field schema to match the 4-value union. Update unit tests + fixtures that construct `MergeRatingsInput` literals. Add a regression test asserting that for any iterType passed to `mergeRatingsAgent.run`, the persisted `execution_detail.iterationType` matches the corresponding `IterationSnapshot.iterationType` for that iteration (closes Decision §7's invariant universally).
- [ ] **3.4** `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — add `iterative_editing` case using `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, maxCycles)`. **Eligibility-cutoff arithmetic uses the planner helper** (per Round 3 review pass-2 A4 follow-up): call `resolveEditingDispatchPlanner({ iterCfg, projectedPoolSize: initialPoolSize - estimatedArenaCount })` from Phase 1.10 — the planner-shaped entry that takes a count, NOT a Variant[]/ratings. The shared `applyCutoffToCount` core ensures the planner result agrees with the runtime result for the same pool size + cutoff (cross-tested in `editingDispatch.test.ts`). Cost-per-invocation is the editing-agent cost (proposer + approver + maybe drift recovery, × maxCycles); dispatch count = floor(iterBudget / costPerInvocation), capped at `DISPATCH_SAFETY_CAP`, **at the planner helper's `eligibleCount`** (NOT inline arithmetic), and at the projected pool size. Returns the same `IterationPlanEntry` shape as generate so the wizard preview renders consistently. Set `effectiveCap: 'eligibility'` on the entry when the cutoff is the binding ceiling, so the wizard preview can flag it ("cutoff binding — N invocations of budget unused").
- [ ] **3.5** `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:35–53` — extend `labelStrategyConfig()` to count editing iterations: `"N×gen + M×edit + K×swiss"`.
- [ ] **3.6** Feature flag `EDITING_AGENTS_ENABLED` (default `'true'`); orchestrator skips dispatch when set to `'false'` for emergency rollback. Document in `evolution/docs/reference.md` Kill Switches table.
- [ ] **3.7** Integration test `evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts` (real DB) — assertions corrected per Round 3 review pass-2 follow-up to match Decisions §14 (editing emits no per-cycle pool comparisons in v1):
   - Seed strategy with one `iterative_editing` iteration after 1 generate iteration.
   - Run `evolveArticle()` end-to-end with mocked LLM responses.
   - Assert: ONE `evolution_agent_invocations` row written with `agent_name='iterative_editing'` per parent (per Decisions §13 wrapper pattern); `execution_detail` validates against the new schema (Phase 1.8) including all `cycles[]` sub-fields with `proposeCostUsd`/`approveCostUsd`/`driftRecoveryCostUsd?`/`sizeRatio`; ONE `evolution_variants` row per surfaced editing invocation (per Decisions §14 — final cycle only) with `parent_variant_id` pointing at the original generated parent (NOT cycle-N-1's intermediate); **ZERO `evolution_arena_comparisons` rows attributable to the editing iteration** (per Decisions §14 — editing does not emit pool-level matches in v1; ranking happens via subsequent swiss iterations); `iterative_edit_cost` metric > 0; `iterative_edit_drift_rate` / `recovery_success_rate` / `accept_rate` populated when applicable.
- [ ] **3.8** Sample-article integration test `evolution/src/__tests__/integration/evolution-iterative-editing-sample-articles.integration.test.ts` (real DB, ~250 LOC) — assertions corrected per Round 3 review pass-2 follow-up:
   - Reuses 2 of the 5 fixture articles from `__fixtures__/sample-articles/` (Galápagos finches + quantum entanglement — short + medium structurally varied).
   - Seeds the seed variant with the fixture's `original` text.
   - Mocks `rawProvider.complete` to return fixture markup + JSONL decisions.
   - Runs the full `evolveArticle()` pipeline through one `iterative_editing` iteration.
   - Asserts: persisted `evolution_variants.variant_content` equals `scenario.expectedNewText`; persisted `execution_detail` JSONB matches the expected shape per fixture (cycles[], proposeCostUsd, approveCostUsd, driftRecoveryCostUsd?, sizeRatio); **no `evolution_arena_comparisons` rows attributable to the editing iteration** (per Decisions §14); cost attribution split correctly across `iterative_edit_propose` / `iterative_edit_review` / `iterative_edit_drift_recovery` agent labels in `evolution_llm_call_tracking` (the per-LLM-call labels) while the per-invocation cost rolls up to `iterative_edit_cost`; `MergeRatingsAgent.execution_detail.iterationType === 'iterative_editing'` (per Decision §7 — matches the snapshot enum); single final variant per invocation with `parent_variant_id === input.parent.variantId`.
   - This is the only integration test that runs the real DB writes against realistic-content fixtures (the full E2E spec in Phase 6 covers UI rendering separately).

### Phase 4: Invocation-detail UI — `'text-diff'` + `'annotated-edits'` field types (Week 4 part 1)
- [ ] **4.1** `evolution/src/lib/core/types.ts:187–194` — extend `DetailFieldDef` `type` union with two new values: `'text-diff'` (uses `sourceKey?`, `targetKey?`, `previewLength?`) and `'annotated-edits'` (uses `markupKey?`, `groupsKey?`, `decisionsKey?`, `dropsPreKey?`, `dropsPostKey?` to point at the `execution_detail.cycles[i]` sub-fields).
- [ ] **4.2** `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` — add `case 'text-diff'` (~10 LOC) rendering `<TextDiff original={data[field.sourceKey]} modified={data[field.targetKey]} previewLength={field.previewLength ?? 300} />`.
- [ ] **4.3** Replace orphaned `'iterativeEditing'` entry in `evolution/src/lib/core/detailViewConfigs.ts` with a fresh `'iterative_editing'` entry. Includes new `'text-diff'` field reading `parentText` / `childText` from execution_detail, plus all the new audit fields (`proposedMarkup`, `proposedGroupsRaw`, `droppedPreApprover`, `approverGroups`, `reviewDecisions`, `droppedPostApprover`, `appliedGroups`, `driftRecovery`).
- [ ] **4.4** `evolution/src/services/invocationActions.ts:156–221` — extend `getInvocationVariantContextAction` to include `variant_content` for both variant and parent (~8 LOC). Add `variant_content` and `parent_content` to `InvocationVariantContext` interface.
- [ ] **4.5** `evolution/src/components/evolution/tabs/InvocationParentBlock.tsx` — render `<TextDiff>` in collapsible `<details>` section below the delta CI row (~15 LOC).
- [ ] **4.6** `evolution/src/components/evolution/tabs/TimelineTab.tsx:29–35` — extend `agentKind()` and `KIND_CONFIG` with `'edit'` case (cosmetic badge color).
- [ ] **4.7** `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:418–421` — add `else if (name.includes('edit'))` case to per-iteration agent-type inference.
- [ ] **4.8** Build `evolution/src/components/evolution/editing/AnnotatedProposals.tsx` (~200 LOC) — the unified annotated-edits view that renders `proposedMarkup` with each `[#N]` block visually styled by its decision (accepted = solid green, rejected = red strikethrough, malformed pre-approver = striped yellow, blocked post-approver = striped orange).
   - Inputs: `proposedMarkup`, `proposedGroupsRaw`, `reviewDecisions`, `droppedPreApprover`, `droppedPostApprover` (all from `execution_detail.cycles[i]`).
   - Algorithm: walk `proposedMarkup` left-to-right; for each atomic edit's `markupRange`, look up its group's outcome and render the corresponding decorated span. Plain text outside edit ranges renders unchanged.
   - **Toolbar**: three view modes — `Annotated` (default), `Final variant` (only accepted edits applied; equivalent to TextDiff "After" tab), `Original` (no markup; equivalent to `current.text`).
   - **Hover tooltip** per `[#N]`: shows decision, reason, group members (if multi-edit group: *"#5: accepted (1 of 2 atomic edits in this group; the other is in §3)"*), and a click action that scrolls + highlights the corresponding row in the Decisions table.
   - **Legend** at the top, collapsible.
   - **Grouped-edit visual link**: edits sharing `[#N]` get a matching number badge. Clicking any one highlights all members of the group.
   - Read-only, stateless given props. Pure UI — no server-side data changes needed.
- [ ] **4.9** Wire `AnnotatedProposals` into `evolution/src/lib/core/detailViewConfigs.ts` `iterative_editing` entry: add an `'annotated-edits'` field as the FIRST sub-field of each cycle (default-expanded), pointing at the relevant `execution_detail.cycles[i]` sub-keys. Demote the raw "Proposed markup" code-block field to collapsed-by-default — still available for character-level inspection but no longer the primary surface.
- [ ] **4.10** Extend `ConfigDrivenDetailRenderer.tsx` with `case 'annotated-edits'` (~15 LOC) that resolves the field's key references and passes them to `<AnnotatedProposals>`.
- [ ] **4.11** Unit tests `AnnotatedProposals.test.ts` (~250 LOC, ~15 cases): all 4 decision states render with correct styles; grouped-edit linking across paragraphs; hover tooltip content; click-to-table-row scroll behavior; toolbar mode switching (Annotated/Final/Original); empty/zero-edit input renders as plain text; legend toggling; multi-cycle isolation (one cycle's annotations don't affect another).

### Phase 5: Strategy wizard UI (Week 4 part 2)
- [ ] **5.1** `src/app/admin/evolution/strategies/new/page.tsx`:
   - Lines 34–46, 73–79: extend `IterationRow['agentType']` and `IterationConfigPayload['agentType']` unions with `'iterative_editing'`.
   - Lines 814–823: add `<option value="iterative_editing">Iterative Editing</option>`.
   - Lines 947–962: add third color branch for editing in budget-allocation bar + legend.
   - Lines 360–390: validation rules — first iteration must still pass `canBeFirstIteration` (generate or reflect_and_generate); allow `editing` after a variant-producing iteration. Validate `editingMaxCycles` 1–5 when present. Add helper text explaining editing iteration drafts top-N parents and runs M cycles per parent.
   - **Editing-terminal warning** (per Round 3 review pass-2 follow-up — variants emitted by editing iterations enter the pool with default Elo and need ranking via a subsequent iteration; an editing-terminal strategy leaves them permanently unranked, defeating the iteration's purpose). Render a yellow `<Warning>` block beneath the iteration list when:
     - The last iteration's `agentType === 'iterative_editing'`, AND
     - There is no later iteration whose `agentType` is in `{'swiss'}` (or any future ranking-emitting agent type — extend this set as new ranking agents land).
     - Warning text: *"This strategy ends with an Iterative Editing iteration. Variants edited in the final iteration will enter the pool at default Elo and won't be ranked. Add a Swiss iteration after the last editing iteration to give the new variants a chance to compete."*
     - Soft warning, not blocking — some authors might intentionally edit-and-stop for offline analysis. Submission proceeds regardless.
   - Add a parallel **runtime warning log** (`evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` or strategy validator): when persisting a strategy config that ends with editing and has no later swiss, log a `warn` level message with `strategyId` so observability dashboards can flag it post-hoc.
- [ ] **5.2** `evolution/src/components/evolution/DispatchPlanView.tsx:117–119` — add badge color for `'iterative_editing'`. Tooltip shows `cycles × eligibilityCount` (or `cycles × dispatchCount` when binding ceiling is dispatch-budget rather than eligibility), aligning with Phase 3.4's `effectiveCap` field. (Earlier draft said `cycles × top-K` — the `top-K` field was removed by Decisions §12; corrected per Phase B detailed-review.)
- [ ] **5.3** `evolution/src/services/strategyPreviewActions.ts:159–185` — extend `dispatchPreviewInputSchema` to accept `'iterative_editing'`, optional per-iteration `editingMaxCycles`, and `editingEligibilityCutoff` (defaults to `{ mode: 'topN', value: 10 }` if absent). Strategy-level `editingModel` and `approverModel` fields also added to the preview input.
- [ ] **5.4** `evolution/src/services/strategyRegistryActions.ts` — `iterationConfigSchema` shared with main schemas.ts (line 32–51 reads from there); auto-updates from Phase 1.1's schema additions.
- [ ] **5.5** Surface `editingMaxCycles` and `editingEligibilityCutoff` in the Step 2 iteration row when `agentType === 'iterative_editing'`. Two inline inputs:
   - **Cycles per parent** — number input 1–5, default 3. Help text: "How many propose-review-apply rounds run per parent. More cycles = more refinement but higher cost."
   - **Eligibility cutoff** — mode dropdown (`Top N` / `Top %`) + number input. Default mode `Top N`, default value `10`. When mode is `Top N`, value is integer ≥ 1; when `Top %`, value is integer 1–100. Help text: "Caps how many top-Elo variants from the pool can be edited this iteration. Default of top 10 lets most strategies be budget-bound; lower it (e.g., top 3) to force budget concentration on the very best variants."
   - Parallel dispatch count is intentionally NOT surfaced as a strategy author input — it's derived from the iteration's budget by `projectDispatchPlan` and capped at the eligibility cutoff. The dispatch preview underneath shows the resulting count, the binding ceiling (budget vs cutoff vs pool size), and per-iteration cost.
- [ ] **5.6** Add **Editing model** + **Approver model** dropdowns to **Step 1** of the wizard (the "Strategy Config" step at lines 519–701) — per Decisions §16, the approver-model knob is required at v1, not deferred:
   - New form field `editingModel?: string`. Position it directly below the existing `judgeModel` field so the model section reads: Generation model → Judge model → Editing model → Approver model.
   - New form field `approverModel?: string` directly below `editingModel`.
   - Dropdown options populated from `src/config/modelRegistry.ts` (same source as `generationModel` / `judgeModel`).
   - **Editing model** placeholder: `"Inherit from Generation model"` (empty → undefined → resolves to `generationModel` at runtime). Help text: *"Used by Iterative Editing's Proposer LLM call. Leave on 'Inherit' to share the Generation model."*
   - **Approver model** placeholder: `"Inherit from Editing model"` (empty → undefined → resolves to `editingModel` at runtime, which itself can resolve to `generationModel`). Help text: *"Used by Iterative Editing's Approver LLM call. For maximum auditability, choose a model different from the Editing model — same model means the Approver may rubber-stamp its own edits."*
   - **Soft warning rendered live in Step 1** (not blocking) when the resolved values would be equal: if `(approverModel || editingModel || generationModel) === (editingModel || generationModel)`, show a yellow `<Warning>`-style block under the Approver dropdown reading: *"Proposer and Approver are using the same model. Auditability is reduced — accepts may rubber-stamp edits."* Re-renders on dropdown change. Implementation: pure derived UI from form state, no validation rule.
   - Both fields are always visible (Step 1 doesn't yet know whether the user will add editing iterations on Step 2; safer to surface unconditionally).
   - Submit handler serializes both into the `createStrategyAction` payload (`editingModel`, `approverModel`, both `string | undefined`).
   - Phase 6 E2E asserts the warning surfaces in the rubber-stamping scenario and disappears when the user picks differing models.

### Phase 6: E2E + documentation + finalization (Week 4 part 3)
- [ ] **6.1** E2E coverage strategy — split across two surfaces because the Next.js server process cannot share a Jest mock with the Playwright spec (per Round 3 review pass-2 finding: `v2MockLlm.ts` uses `jest.fn()` callable only from a Jest worker; `claimAndExecuteRun.ts:168` builds the LLM provider inline with no provider-switch hook; `start-dev-tmux.sh` has no env-var passthrough; therefore `EVOLUTION_USE_V2_MOCK_LLM` cannot work cross-process without a substantial server refactor that's out of scope):
   - **6.1a — Real-LLM E2E under `@evolution` tag** at `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`. Tagged `{ tag: '@evolution' }` like `admin-evolution-run-pipeline.spec.ts` and `admin-evolution-arena-tactic.spec.ts` — runs against real LLMs in CI via the production-only path, not in pre-merge gates. Cost-bounded to $0.05 per run via strategy budget. Asserts:
     - Seed strategy via service-role: 1×generate + 1×iterative_editing iteration, `editingModel` and `approverModel` set to **different** models so the rubber-stamping warning is absent; second strategy where they match to assert the warning surfaces.
     - Trigger via `/api/evolution/run`. Poll DB until run status = `completed` (timeout 5 min).
     - Run detail → Variants tab → assert exactly **one** new variant appears per editing invocation (per Decisions §14), with `parent_variant_id` pointing at the original generated parent (NOT cycle-N-1's intermediate).
     - Invocation detail → assert `cycles[]` renders with `proposeCostUsd` / `approveCostUsd` populated, `<AnnotatedProposals>` color-codes decisions, `<TextDiff>` shows `parentText` / `childText`.
     - Strategy wizard rubber-stamping warning surfaces / disappears with model selection (per Decisions §16).
   - **6.1b — Mock-driven UI integration tests (Jest + RTL)** at `evolution/src/__tests__/integration/evolution-iterative-editing-ui.integration.test.tsx`. In-process Jest (so `v2MockLlm` works fine) renders the invocation-detail page against fixture `execution_detail` rows and asserts the same UI invariants the E2E asserts in 6.1a — but deterministically, no real-LLM cost, no flakiness. Same fixture file feeds Phase 3.7 / 3.8 integration tests, so 6.1b reuses the canonical test data. This is the assertion mechanism for pre-merge gates; 6.1a is the post-merge production-confidence smoke test.
   - **Why this split:** matches the existing repo pattern (the only existing full-pipeline E2E, `admin-evolution-run-pipeline.spec.ts`, is real-LLM under `@evolution`; UI assertions live in tagged-by-component RTL tests). Avoids the cross-process-mocking redesign. Pass-1's nock fix was wrong (nock can't reach the server process); pass-2's `v2MockLlm` env-var fix was also wrong (no hook exists, no env passthrough). Splitting the surface is the minimum-viable fix.
- [ ] **6.1.1** Backward-compatibility coverage targeting the **actual** user-facing regression (per Round 3 review pass-2 follow-up — the V1-shape `execution_detail` row is orphaned scaffolding that was never written to in production, so a synthetic row only proves a non-deployment-risk case. The real BC risk is the `InvocationEntity.listFilters` rename: any user-saved URL with `?agentName=iterativeEditing` silently matches zero rows after deploy):
   - **6.1.1a — `listFilters` URL alias**: `evolution/src/lib/core/entities/InvocationEntity.ts` — when accepting the `agent_name` filter param, normalize incoming legacy values: `iterativeEditing → iterative_editing` (and document the mapping for any future renames). Implementation: a small `LEGACY_AGENT_NAME_ALIASES` map applied in the Entity's filter-coercion path. Unit test asserts both old and new values resolve to the same SQL filter.
   - **6.1.1b — Strategy-config schema BC**: integration test `evolution/src/__tests__/integration/evolution-editing-strategy-config-bc.integration.test.ts` (~80 LOC) inserts a synthetic legacy strategy config (no `editingMaxCycles` / `editingEligibilityCutoff` / `editingModel` / `approverModel` fields), parses through the widened `iterationConfigSchema`, asserts no validation error and defaults are correctly applied (defaults from Phase 1.1 schema additions: `editingMaxCycles → 3`, `editingEligibilityCutoff → {mode: 'topN', value: 10}`, both models → undefined).
   - **6.1.1c — `MergeRatingsAgent.execution_detail.iterationType` BC**: parallel test confirms historical rows persisted with `'generate'` or `'swiss'` still parse against the widened 4-value enum (per Decisions §7 widening preserves the existing values).
   - The synthetic V1-shape `execution_detail.detailType === 'iterativeEditing'` test is dropped — orphaned scaffolding never wrote to production, so testing it is theater. (If we ever discover such rows in prod via a data audit, we add a forward-only data-fix migration, not a parser branch.)
- [ ] **6.2** Create `docs/feature_deep_dives/editing_agents.md` covering IterativeEditingAgent (overview, evaluate→edit→judge loop, key files, config reference, interaction with cost tracking, future v1.1/v1.2 roadmap).
- [ ] **6.3** Update `evolution/docs/agents/overview.md` — document IterativeEditingAgent.
- [ ] **6.4** Update `evolution/docs/architecture.md` — new dispatch branch in `evolveArticle()`, new `iterationType` value in snapshots.
- [ ] **6.5** Update `evolution/docs/reference.md` — add file index entries; add `EDITING_AGENTS_ENABLED` to Kill Switches table.
- [ ] **6.6** Update `docs/feature_deep_dives/multi_iteration_strategies.md` — new agentType value + `editingMaxCycles`, `editingEligibilityCutoff` per-iteration fields + `editingModel`, `approverModel` strategy-level fields. Document the rubber-stamping warning behavior.
- [ ] **6.7** Update `docs/feature_deep_dives/evolution_metrics.md` — new run-level + propagated cost metrics.
- [ ] **6.8** Update `.claude/doc-mapping.json` to include new editing_agents.md.
- [ ] **6.9** **CI workflow + deploy-config env var enumeration** (per Phase B detailed-review fix — pass-1's plan didn't say which workflow files need editing for the 5 new env vars):
   - `.github/workflows/ci.yml` — add to the test-job env block: `EDITING_AGENTS_ENABLED: 'true'`, `EVOLUTION_DRIFT_RECOVERY_ENABLED: 'true'`. Threshold env vars are NOT set in CI (use hardcoded fallbacks); add a comment noting they're intentionally omitted so CI tests run against the default thresholds.
   - `.github/workflows/e2e-nightly.yml` — confirm the `@evolution`-tagged spec runs in this nightly job (existing workflow for production-only path); no env-var changes needed beyond what `admin-evolution-run-pipeline.spec.ts` already requires (real LLM API keys).
   - `.github/workflows/post-deploy-smoke.yml` — add a smoke check that calls `assertCostCalibrationPhaseEnumsMatch` against the deployed environment to verify migrations 1.5a + 1.5b ran. Fails the deploy if the assertion throws. Stand-alone script `evolution/scripts/postDeploySmokeCheck.ts` (~40 LOC) hosts the call.
   - **Deploy-config files for production env vars**: enumerate where `EDITING_AGENTS_ENABLED='false'` (initial deploy) and the threshold env vars are set in Vercel/whatever-deploy-target's environment config. Reference: `docs/docs_overall/deployment.md` for the canonical env-var-management procedure (or create that doc reference if it doesn't exist).
   - **Migration-reorder workflow** (`migration-reorder.yml`): note that 1.5a/1.5b filenames use `<timestamp>` and `<timestamp+1s>` placeholders; regenerate timestamps at merge-prep time to avoid reorder conflicts with main-merges that landed between authoring and merge.
- [ ] **6.10** **CI assertion test for startup CHECK assertion** (per Phase B detailed-review fix): integration test `evolution/src/__tests__/integration/evolution-startup-assertion-check.integration.test.ts` (~60 LOC) — applies a fixture migration that REMOVES one phase from the CHECK constraint, calls `assertCostCalibrationPhaseEnumsMatch`, asserts it throws `MissingMigrationError` naming the missing phase. The test cleans up by re-applying the full migration before exit. This is the test that proves Phase 1.6's deploy-ordering gate actually works; without it, the assertion is unverified.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.test.ts` — ≥30 cases (orchestration loop, all stop reasons, audit trail)
- [ ] `evolution/src/lib/core/agents/editing/IterativeEditingAgent.sampleArticles.test.ts` — 5 articles × 2 scenarios (single-cycle, multi-cycle chain)
- [ ] `evolution/src/lib/core/agents/editing/proposerPrompt.test.ts` — soft-rules verification, syntax-form coverage
- [ ] `evolution/src/lib/core/agents/editing/parseProposedEdits.test.ts` — ≥32 cases (all markup forms, adversarial inputs, position math, context capture)
- [ ] `evolution/src/lib/core/agents/editing/parseProposedEdits.property.test.ts` — fast-check round-trip + range-correctness invariants
- [ ] `evolution/src/lib/core/agents/editing/checkProposerDrift.test.ts` — ~10 cases (whitespace tolerance, drift detection, offset reporting)
- [ ] `evolution/src/lib/core/agents/editing/validateEditGroups.test.ts` — ~20 cases (10 hard rules + cycle/group caps)
- [ ] `evolution/src/lib/core/agents/editing/approverPrompt.test.ts` — system-prompt content, edit summary table format
- [ ] `evolution/src/lib/core/agents/editing/parseReviewDecisions.test.ts` — ~12 cases (JSONL parse, missing-default-reject, unknown-group-ignored)
- [ ] `evolution/src/lib/core/agents/editing/recoverDrift.test.ts` — ~18 cases (magnitude classifier boundaries, recovery LLM mocked outcomes, patcher correctness, feature-flag, residual-drift detection)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.test.ts` — ~20 cases (overlap detection, context failsafe, splice direction, format validation)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.property.test.ts` — 4 properties (all-rejected idempotency, all-accepted equivalence, mixed-decision equivalence vs reference reconstruction, length monotonicity)
- [ ] `evolution/src/lib/core/agents/editing/applyAcceptedGroups.sampleArticles.test.ts` — 5 articles × 3 scenarios (allAccept, allReject, mixed)
- [ ] `evolution/src/components/evolution/editing/AnnotatedProposals.test.ts` — ~15 cases (4 decision-state renderings, grouped-edit linking, toolbar modes, tooltip behavior, edge cases)

### Integration Tests

> **CI routing convention** (per Phase B detailed-review fix): all new integration test files start with `evolution-` so they match `package.json:31` `test:integration:evolution` glob pattern (`evolution-|arena-actions|manual-experiment|strategy-resolution`). Files NOT prefixed with `evolution-` would silently route to the `non-evolution` job and never run in evolution-CI gates. The `iterative-editing-` prefix from earlier drafts has been corrected to `evolution-iterative-editing-` throughout.

- [ ] `evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts` — full pipeline run with editing iteration (real DB)
- [ ] `evolution/src/__tests__/integration/evolution-iterative-editing-sample-articles.integration.test.ts` — 2 of 5 fixture articles, full pipeline end-to-end with mocked LLMs against real DB
- [ ] `evolution/src/__tests__/integration/evolution-iterative-editing-ui.integration.test.tsx` — Phase 6.1b mock-driven UI integration tests (Jest+RTL renders invocation-detail page against fixture `execution_detail` rows; deterministic pre-merge gate)
- [ ] `evolution/src/__tests__/integration/evolution-editing-strategy-config-bc.integration.test.ts` — Phase 6.1.1b backward-compat: parse synthetic legacy strategy configs through widened `iterationConfigSchema`

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — wizard → run → invocation detail → TextDiff visible

### Manual Verification
- [ ] `npx tsx evolution/scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock` with strategy including 1 editing iteration; spot-check invocation detail UI.
- [ ] Cost calibration verified — run produces realistic `iterative_edit_cost` metric.

## Verification

### A) Playwright Verification (required for UI changes)

**Pre-merge (deterministic, in-process Jest+RTL — fast):**
- [ ] `cd evolution && npm test -- src/__tests__/integration/evolution-iterative-editing-ui` — Phase 6.1b UI integration tests render invocation-detail page against fixture `execution_detail` rows; assert `<AnnotatedProposals>` renders accepted edits in green / rejected in red, `<TextDiff>` shows parentText/childText, cycles[] columns populated. Deterministic, no real LLM, runs on every PR.
- [ ] Manual smoke test: strategy wizard Step 2 renders `iterative_editing` option in the agent dropdown; `editingMaxCycles` (1–5) and `editingEligibilityCutoff` (mode + value) inline inputs appear when iterative_editing is selected; default values populate (`editingMaxCycles=3`, `editingEligibilityCutoff={mode:'topN', value:10}`).
- [ ] Manual smoke test: strategy wizard Step 1 renders `editingModel` and `approverModel` dropdowns under "Judge model"; rubber-stamping warning appears when both resolve to the same model and disappears on mismatch.
- [ ] Manual smoke test: editing-terminal warning appears when last iteration is `iterative_editing` with no later swiss; disappears when a swiss iteration is added after.

**Post-merge (real-LLM, `@evolution`-tagged — production-confidence smoke):**
- [ ] `npx playwright test --grep '@evolution' src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — Phase 6.1a runs against the production-only path (cost-bounded ~$0.05/run via strategy budget); asserts run completes, single final variant per editing invocation with correct `parent_variant_id` chain, AnnotatedProposals/TextDiff render, rubber-stamping warning surfaces correctly. Runs in nightly evolution job, NOT default pre-merge gate.

### B) Automated Tests

**Unit (in-process, fast):**
- [ ] `cd evolution && npm test -- src/lib/core/agents/editing` — all unit + property tests pass (orchestration loop, parser, drift detector, drift recovery, validators, applier, AnnotatedProposals component).
- [ ] `cd evolution && npm test -- src/lib/core/startupAssertions` — Phase 1.6 deploy-gate assertion tests pass (mismatch detection, fail-open on permission denied, idempotency).
- [ ] `cd evolution && npm test -- src/lib/pipeline/loop/editingDispatch` — Phase 1.10 helper tests pass, including the cross-mode equivalence test asserting runtime and planner agree for shared inputs.
- [ ] `cd evolution && npm test -- src/lib/core/agents/editing/IterativeEditingAgent.invariants` — Phase 2.A.5 invariant tests pass (header comment, no `.run(` in execute(), costBefore* captures, contract-table coverage).

**Integration (real DB, mocked LLMs):**
- [ ] `npm run test:integration:evolution -- --testPathPatterns="evolution-iterative-editing"` — Phase 3.7/3.8 + 6.1b + 6.1.1b + 6.1.1c integration tests pass against real DB. Test path glob matches the package.json `test:integration:evolution` script per the CI routing convention.

**Schema / build:**
- [ ] `cd evolution && npx tsc --noEmit` — no TypeScript errors after schema widening (iterationAgentTypeEnum 4 values; MergeRatingsInput 4 values; IterationSnapshotRow 4 values; CalibrationRow['phase'] extended).
- [ ] `cd evolution && npm run lint` — no lint failures from new files.

**Migration verification:**
- [ ] `npx supabase db push` then `psql -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'evolution_cost_calibration_phase_allowed';"` — confirms named constraint exists with all 8 phase values (`generation`, `ranking`, `seed_title`, `seed_article`, `reflection`, `iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`).
- [ ] First service boot post-migration logs no `MissingMigrationError`; agent registry initializes successfully.

**Rollout-gate verification:**
- [ ] `EDITING_AGENTS_ENABLED='false'` → integration test asserts editing iterations short-circuit (zero `iterative_editing` rows in `evolution_agent_invocations` for the run); flip to `'true'` → next run produces editing rows.
- [ ] `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'` → drift cycles abort with `stopReason: 'proposer_drift_major'` regardless of magnitude (covered by `recoverDrift.test.ts` feature-flag case).
- [ ] Full test suite (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`) — no regressions.

## Documentation Updates
- [ ] NEW: `docs/feature_deep_dives/editing_agents.md` — consolidated guide.
- [ ] `evolution/docs/agents/overview.md` — IterativeEditingAgent section.
- [ ] `evolution/docs/architecture.md` — dispatch branch + recordSnapshot changes.
- [ ] `evolution/docs/reference.md` — file index + kill switch.
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — `iterative_editing` agentType + `editingMaxCycles` + `editingEligibilityCutoff` per-iteration fields + `editingModel` strategy-level field.
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — `iterative_edit_cost` family.
- [ ] `.claude/doc-mapping.json` — register new deep dive.

## Risk Register (top items, full register in research doc)

| Risk | Mitigation |
|------|------------|
| `recordSnapshot()` enum break (P1) | Phase 3.2 widens union and updates all 4 call sites with type-checking. |
| Cost calibration phase enum migration (C2) | Phases 1.5a + 1.5b split for independent rollback (Decisions §18); Phase 1.6 startup CHECK assertion enforces deploy order. Same-class bug recurrence (PR #1017's silent reflection reject) is impossible — assertion blocks code init if migration missing. |
| **Cost under-estimation (C1) — corrected per Round 3 review S1** | Phase 1.7 cost estimator now uses `seedChars * 1.15` for proposer expected output (was hardcoded 7500 chars under-reserve), and `seedChars * 1.5^cycleIdx` for upper-bound (size-ratio guardrail factored in). Operational metric `iterative_edit_drift_rate` exposes calibration error directly. Default `maxCycles=3` is safe given the corrected upper-bound; rollback via `EDITING_AGENTS_ENABLED='false'` flag. |
| Per-invocation budget starvation under parallel dispatch (S3) | Decisions §15: `perInvocationBudgetUsd = iterBudget / parallelDispatchCount` passed to each invocation; agent self-aborts at 90% spent. Bounds runaway invocations from starving siblings. |
| Article-size growth across cycles (S4) | Decisions §17: per-cycle hard rule drops highest-numbered groups until `newText.length / current.text.length ≤ 1.5×`; aborts cycle on single-mega-insertion. Phase 1.7 upper-bound factors 1.5^cycleIdx growth into reservation. |
| Proposer = Approver (auditability collapse, S2) | Decisions §16: separate `approverModel` config knob (defaults to `editingModel`); rubber-stamping warning surfaces in Step 1 wizard when resolved values match. Operational metric `iterative_edit_accept_rate` alerts when > 0.95. |
| Orphaned schema drift (S1, T1) | Phase 1.8 schema rewrite + `executionDetailFixtures.iterativeEditingDetailFixture` rewrite are paired with the existing schema-fixture conformance harness in `evolution/src/testing/executionDetailFixtures.ts` — fixture validates against the new schema at module load. Phase 6.1.1b BC test covers legacy strategy-config rows. |
| Backward compat with active strategies (PR1) | All existing strategies use `'generate' \| 'reflect_and_generate' \| 'swiss'` agentTypes; widening enum is non-breaking. Phase 6.1.1 integration test deserializes a synthetic legacy config + V1-shape execution_detail. |
| Critique amplification (B1) | Approver prompt (Phase 2.D.1) embeds soft-rules verification; rejected cycles' reasons are persisted in `execution_detail.cycles[i].reviewDecisions[].reason` for staging analysis. Operational metric `iterative_edit_accept_rate` alerts when persistently > 0.95. |
| Feature-flag rollback path (PR3) | Phase 3.6 adds `EDITING_AGENTS_ENABLED`; Rollout/Rollback section documents three independent rollback paths (soft / drift-only / hard). E2E test (Phase 6.1) verifies flag-off path. |
| Observability for operational risks (T3) | Phase 1.3 adds 3 operational metrics (`iterative_edit_drift_rate`, `iterative_edit_recovery_success_rate`, `iterative_edit_accept_rate`) with threshold annotations. Run-detail dashboard renders out-of-band values red. |
| Multi-cycle variant chaining vs one-variant-per-invocation contract (A1) | Decisions §14: only the FINAL cycle's text materializes as a `Variant`. Intermediate cycles' text lives in `execution_detail.cycles[i].childText` (audit only, no DB row). Lineage `parent_variant_id` points to original input parent, not cycle-N-1's intermediate. |
| Wrapper / sub-agent invariant violation (A2) | Decisions §13 + Phase 2.A.5 invariant test grep the agent source for prohibited `.run(`/`new Agent`/`new XAgent` patterns. Mirrors `reflectAndGenerateFromPreviousArticle.invariants.test.ts`. |
| Eligibility-cutoff drift between planner and runtime (A4) | Phase 1.10 extracts `resolveEditingDispatch` as a shared helper; Phase 3.3 + 3.4 both call it. Mirrors PR #1017's `resolveReflectionEnabled` pattern. |
| `MergeRatingsAgent` iterationType inconsistency (A3) | Decisions §7: widen `MergeRatingsInput.iterationType` to include `'iterative_editing'` (Phase 3.3.1). Snapshot enum and merge-input enum stay aligned. |

## Rollout / Rollback

(Per Round 3 review T2 — feature-flag + DB-migration coupling needs an articulated deploy order and rollback story.)

### Deploy order (forward direction)

**Required ordering** — earlier steps must complete before later steps run in any environment (dev / staging / prod). The Phase 1.6 startup CHECK-constraint assertion enforces (1) before code can write new phase strings; if step 2 ships before step 1, the agent registry refuses to initialize and the deploy fails fast (loud error, not silent).

1. **DB migrations land first** — both `1.5a` (reflection-phase CHECK) and `1.5b` (editing-phases CHECK) apply via the standard supabase migration pipeline. They are independent and forward-only (CHECK extension is monotonic; adding accepted values cannot break existing rows).
2. **Code rollout** — agent registry, schema, dispatch helper, wizard. The Phase 1.6 startup assertion verifies BOTH migrations ran before `IterativeEditingAgent` is registered.
3. **Feature flag** — `EDITING_AGENTS_ENABLED` defaults to `'true'` in code but is **set to `'false'` in production environment config at deploy time**. Editing iterations short-circuit in `runIterationLoop.ts` Phase 3.3 branch when the flag is `'false'`. This means: the migrations + code can land in prod with editing dormant; we flip the flag explicitly when ready.
4. **Calibrate** — run 50 shadow-deploy strategies with `EDITING_AGENTS_ENABLED='true'` in staging only; collect real per-cycle costs via the new operational metrics (Phase 1.3); confirm `iterative_edit_drift_rate` < 30%, `iterative_edit_recovery_success_rate` > 70%, `iterative_edit_accept_rate` < 95%.
5. **Flip prod flag** — set `EDITING_AGENTS_ENABLED='true'` in prod env config. No code change.

### Rollback model

**The migration→code dependency is one-way and absolute, not symmetric.** Once Phase 2 code referencing the editing phase strings ships to an environment, reverting `1.5b` will brick that environment on next service restart (Phase 1.6 startup assertion refuses to initialize the agent registry when any TS Phase literal is missing from the DB CHECK). Rollback after code-deploy is **flag-only**, never migration revert.

Three rollback paths, all flag-based, none requiring DB downgrade:

- **Soft rollback (operational, primary)**: set `EDITING_AGENTS_ENABLED='false'`. No code or migration change. Editing iterations short-circuit at the runIterationLoop branch entry; runs that already started keep going to completion (mid-run flag flips do not abort). Use for cost spikes, drift-rate spikes, accept-rate runaway.
- **Drift recovery rollback (granular)**: set `EVOLUTION_DRIFT_RECOVERY_ENABLED='false'`. Drift recovery LLM call is skipped; minor drift is treated as major (cycle aborts). Use when recovery LLM goes haywire while editing-overall is still working.
- **Threshold tuning (no rollback, just calibration)**: set `EVOLUTION_EDITING_DRIFT_RATE_ALERT_THRESHOLD` / `EVOLUTION_EDITING_RECOVERY_SUCCESS_RATE_ALERT_THRESHOLD` / `EVOLUTION_EDITING_ACCEPT_RATE_ALERT_THRESHOLD` env vars. Phase 1.4's `alertWhen` annotations read these env vars at metric-registry init with hardcoded fallbacks (drift > 0.30, recovery_success < 0.70, accept > 0.95). Lets staging measurements re-tune thresholds without a code deploy.

### Migration-vs-code dependency (clarified)

| Step | Direction | What rollback looks like |
|---|---|---|
| `1.5a` reflection CHECK | Forward-only | Cannot be reverted post-deploy. Was already needed independently of editing (closes PR #1017's silent-reject). Even before our editing code lands, reverting it re-opens that bug for reflection users. |
| `1.5b` editing CHECK | Forward-only | Cannot be reverted once Phase 2 code ships. The "independence" of `1.5a` and `1.5b` refers to **deploy ordering** (they can apply in either order, neither blocks the other) — NOT rollback. Both are one-way against their respective code dependents. |
| Phase 2 editing code | Code-revert allowed only if migrations stay | The CHECK extensions are non-destructive; existing reflection/generate/ranking rows continue to work after code revert. Code revert + leave migrations in place is the only "hard rollback" path. |
| `EDITING_AGENTS_ENABLED='false'` | Reversible | Flips behavior without touching code or DB. Primary operational lever. |

### What we explicitly do NOT support

- **Migration revert post-code-deploy**: would brick service via Phase 1.6 startup assertion. The migrations are forward-only by design; there is no down-migration. If a future need genuinely requires removing phases from CHECK, that's a separate destructive migration and would need its own RFC + a code-side flag-off period first.
- **Mid-run flag flip aborting in-flight runs**: `EDITING_AGENTS_ENABLED` is read at iteration-loop entry, not per-cycle. A run that has started its editing iteration when the flag flips OFF will complete that iteration. Intentional — partial-iteration aborts produce broken audit trails and cost-attribution gaps.

### Where the startup assertion lives (deploy gate)

Phase 1.6's startup CHECK-constraint assertion **must NOT live inside `costCalibrationLoader`** — that loader is gated by `COST_CALIBRATION_ENABLED` (default `false` per the existing migration's comment header), so the assertion would never run in environments with calibration disabled, recreating the same silent-failure mode. Instead:

- Place the assertion in a new module `evolution/src/lib/core/startupAssertions.ts` (~40 LOC).
- Invoke it once from `agentRegistry.ts` lazy-init path (the same path that registers `IterativeEditingAgent`) BEFORE the registry returns the agent class.
- Assertion runs unconditionally on agent-registry init, regardless of any feature flag. If the DB CHECK is missing any expected phase string from the local TS Phase literal, throw a loud error and refuse to register the agent.
- Assert against TWO TS sources, not one: `refreshCostCalibration.ts`'s `Phase` type AND `costCalibrationLoader.ts`'s `CalibrationRow['phase']` type. Both must be synced with the DB CHECK; missing either is treated identically. (This closes the parallel silent-reject failure mode on the loader side.)
- Idempotent: subsequent registry inits in the same process re-run the same query but skip if a positive result is cached for the process lifetime.

### CI/CD verification

Phase 6 E2E (`6.1`) asserts:
- The startup CHECK assertion fires correctly when run against a fixture migration with one phase missing.
- `EDITING_AGENTS_ENABLED='false'` causes editing iterations to short-circuit (no `iterative_editing` agent invocation rows written).
- The rubber-stamping warning surfaces in the strategy wizard (Decisions §16).

## V1.1 / V1.2 Roadmap (Explicitly Out of Scope)

- **v1.1:** `OutlineGenerationAgent` (generate-mode only); MDAST CriticMarkup judge format; per-cycle invocation timeline UI; `Match.frictionSpots` production + consumption.
- **v1.2:** `OutlineGenerationAgent` edit-mode (selective re-expand); step-targeted mutation (re-edit only the weakest step); `SectionDecompositionAgent` + section-helper suite.

## Review & Discussion

### Phase A — Structural Review (2026-05-01, Round 3)

**Surfaced gaps:** 15 across 3 perspectives (5 each).

- [security_technical] S1: Proposer cost estimation under-reserves by 2-3× (article-size-dependent, not 7500-char fixed) → would cause mid-cycle BudgetExceededError under parallel dispatch.
- [security_technical] S2: Proposer = Approver by default — auditor and auditee are the same agent; no config knob enforces separation.
- [security_technical] S3: No per-invocation budget ceiling — one runaway invocation can starve siblings under shared IterationBudgetTracker.
- [security_technical] S4: No article-size-ratio guardrail — uncapped growth across cycles compounds into downstream Swiss/MergeRatings cost spikes.
- [security_technical] S5: DB CHECK migration ordering left to operator discipline; PR #1017's silent-reject bug recurrence risk.
- [architecture_integration] A1: Multi-cycle variant chaining conflicts with one-variant-per-invocation contract; cycle parents have no rating during cycle-N proposer call.
- [architecture_integration] A2: Three LLM-call shapes bolted onto one agent class — but reviewer misread PR #1017's pattern; PR #1017 uses ONE invocation row via `.execute()` delegation, which is what we do. Resolution: document the alignment + add invariant tests.
- [architecture_integration] A3: Decision #7 (`iterationType: 'generate'` for editing matches) creates observability inconsistency between IterationSnapshot enum and MergeRatingsAgent input enum.
- [architecture_integration] A4: Eligibility-cutoff arithmetic duplicated in planner (Phase 3.4) and runtime (Phase 3.3); PR #1017 set the precedent for shared helpers (`resolveReflectionEnabled`).
- [architecture_integration] A5: Base-class contract conformance not enumerated (B047 enforceVariantFormat, B048 surfaced flag, B051 tactic auto-extract, B054 FK threading).
- [testing_cicd] T1: E2E spec uses `nock`, which can't intercept the Next.js server process started by `ensure-server.sh`. No precedent in existing E2E specs.
- [testing_cicd] T2: `EDITING_AGENTS_ENABLED` flag + CHECK migration rollback model not articulated.
- [testing_cicd] T3: No observability / alerting metrics for operational risks (drift rate, recovery success rate, accept rate).
- [testing_cicd] T4: No backward-compat regression test for schema discriminator rename (`'iterativeEditing'` → `'iterative_editing'`).
- [testing_cicd] T5: Phase 1.5 bundles two unrelated migrations (PR #1017 reflection fix + editing phases); rollback blast-radius coupling.

**User decision:** fix_now (apply fixes for all 15 surfaced gaps before Phase B detailed review).

**Fixes applied:**
- [security_technical] S1 → Phase 1.7 rewrite: drop fixed `__builtin_iterative_edit_propose__`, use `seedChars * 1.15` for expected and `seedChars * 1.5^cycleIdx` for upper-bound; new `approverModel` parameter on `estimateIterativeEditingCost`.
- [security_technical] S2 → Decisions §16: add `approverModel` strategy-level knob defaulting to `editingModel`; Phase 5.6 wizard surfaces soft warning when resolved values match.
- [security_technical] S3 → Decisions §15 + Phase 2.A.2 + Phase 3.3: per-invocation `perInvocationBudgetUsd = iterBudget / parallelDispatchCount`; agent self-aborts at 90% spent.
- [security_technical] S4 → Decisions §17 + Phase 2.A.3 step 4: per-cycle hard rule drops highest-numbered groups until `newText / current ≤ 1.5×`; aborts on single-mega-insertion.
- [security_technical] S5 → Phase 1.6 startup CHECK-constraint assertion blocks agent registry init if any TS phase string is missing from the DB CHECK.
- [architecture_integration] A1 → Decisions §14 + Phase 2.A.3 step 8/10: only the FINAL cycle materializes as a `Variant`; intermediates live only in `execution_detail.cycles[i].childText`; final variant's `parent_variant_id` is the original input parent.
- [architecture_integration] A2 → Decisions §13 + Phase 2.A.1 header comment block + Phase 2.A.5 invariant test asserting no nested `Agent.run()` / no `new XAgent()`.
- [architecture_integration] A3 → Decision #7 rewrite + Phase 3.3.1: widen `MergeRatingsInput.iterationType` to include `'iterative_editing'`.
- [architecture_integration] A4 → Phase 1.10 NEW: `resolveEditingDispatch(...)` helper; Phase 3.3 + 3.4 both call it (mirrors PR #1017's `resolveReflectionEnabled`).
- [architecture_integration] A5 → Phase 2.A.1 base-class contract conformance table covering B047/B048/B051/B054 + single-variant-per-output + partial-detail-on-throw.
- [testing_cicd] T1 → Phase 6.1 rewrite: replace `nock` with `EVOLUTION_USE_V2_MOCK_LLM=true` env var + fixture file `editing-e2e-responses.ts`.
- [testing_cicd] T2 → New "Rollout / Rollback" section: deploy order, three rollback paths, what's NOT supported (migration revert).
- [testing_cicd] T3 → Phase 1.3 adds 3 operational metrics (`iterative_edit_drift_rate`, `iterative_edit_recovery_success_rate`, `iterative_edit_accept_rate`) with threshold annotations; Phase 1.4 propagation defs.
- [testing_cicd] T4 → Phase 6.1.1 NEW: BC integration test for V1-shape execution_detail rows + MergeRatings legacy iterationType rows.
- [testing_cicd] T5 → Decisions §18 + Phase 1.5a / 1.5b: split into independent migrations.

**Resolution:** Re-running Phase A once to confirm fixes resolve the surfaced gaps before transitioning to Phase B detailed review.

### Phase A — Structural Review Pass 2 (2026-05-01, post-fix verification)

**Surfaced gaps:** 15 NEW across 3 perspectives. The original 15 (S1–S5, A1–A5, T1–T5) were resolved; the new findings either revealed previously-missed surfaces or noted that the pass-1 fixes themselves were imperfect.

- [security_technical] **S6** Phase 1.10 helper signature unimplementable from planner — `resolveEditingDispatch` requires `Variant[]` + `Map<variantId, Rating>` but planner has only `poolSize: number`. Pass-1 A4 fix was incomplete.
- [security_technical] **S7** Phase 3.7/3.8 integration tests assert `evolution_arena_comparisons` rows are written for editing iterations, contradicting Decisions §14 which says editing emits zero per-cycle pool comparisons.
- [security_technical] **S8** `isVariantProducingAgentType()` predicate is overloaded — does two unrelated jobs (first-iteration gate AND swiss-precedence gate). Editing exposes the conflict: it's not allowed first but IS variant-producing.
- [security_technical] **S9** Editing-terminal strategy leaves new variants permanently at default Elo (no schema/wizard enforcement of a following ranking iteration).
- [security_technical] **S10** `CalibrationRow['phase']` literal-type at `costCalibrationLoader.ts:24` is a parallel TS-vs-DB enum site that pass-1's S5 fix didn't cover. Phase 1.6 startup assertion sees only one of the two TS sites.
- [architecture_integration] **A6** Phase 2.A.1 base-class contract conformance table misattributed B0xx markers — pass-1 mapped B047/B051/B054 to wrong contracts. Phase 2.A.5's "parse Agent.ts for B-markers" check would fail on day one.
- [architecture_integration] **A7** Phase 1.10 helper "shared between planner and runtime" claim doesn't survive contact with the actual data shapes.
- [architecture_integration] **A8** Phase 2.A.5 invariant regex over-restricts — prohibits `new XAgent(` which is the legal wrapper-delegate pattern (PR #1017's reflectAndGenerateFromPreviousArticle.ts:414 literally calls `new GenerateFromPreviousArticleAgent().execute(...)`). Forbidden pattern is `.run(` only.
- [architecture_integration] **A9** Phase 3.3.1 `MergeRatingsInput` widening selectively fixes editing while leaving the parallel `reflect_and_generate` observability gap PR #1017 left in place. Decision §7's principle is half-applied.
- [architecture_integration] **A10** `IterationSnapshotRow.iterationType` at `evolutionActions.ts:404` consumer-side type still says `'generate' | 'swiss'` (not even widened to include reflect_and_generate). Pass-1 only widened the producer side.
- [testing_cicd] **T6** Phase 6.1 `EVOLUTION_USE_V2_MOCK_LLM` env-var fix is also infeasible — `v2MockLlm.ts` uses `jest.fn()` (Jest-only); `claimAndExecuteRun.ts:168` has no provider-switch hook; `start-dev-tmux.sh` has no env-var passthrough. Pass-1 replaced infeasible nock with infeasible v2MockLlm.
- [testing_cicd] **T7** Phase 1.5a/1.5b "independent rollback" claim is wrong post-code-deploy — Phase 1.6 startup assertion blocks init if any TS phase string is missing from DB CHECK; reverting either migration after editing code ships would brick the service.
- [testing_cicd] **T8** Phase 1.6 startup assertion timing is conditional — placing it inside `costCalibrationLoader` (gated by `COST_CALIBRATION_ENABLED`, default false) means it doesn't run when calibration is disabled, recreating the silent-reject failure mode it was designed to prevent.
- [testing_cicd] **T9** Phase 6.1.1 BC test exercises a non-deployment-risk case (synthetic V1-shape rows that orphaned scaffolding never wrote in production). The actual BC risk is the `InvocationEntity.listFilters` rename: user-saved URLs with `?agentName=iterativeEditing` silently match zero rows after deploy.
- [testing_cicd] **T10** Phase 1.4 operational-metric thresholds are baked into code (`alertWhen` annotations); rollout step 4 treats them as empirically tunable. Re-tuning requires a code deploy, defeating short-feedback-loop monitoring.

**User decision:** fix_now (apply fixes for all 15 new gaps; transition to Phase B without further structural passes per skill 2-pass cap).

**Fixes applied:**
- [security_technical] **S6 + A7** → Phase 1.10 split into `resolveEditingDispatchRuntime` (Variant[] + ratings) and `resolveEditingDispatchPlanner` (poolSize: number) sharing inner `applyCutoffToCount`. Cross-test asserts the math agrees.
- [security_technical] **S7** → Phase 3.7/3.8 assertions inverted: now assert ZERO `evolution_arena_comparisons` rows for editing iterations.
- [security_technical] **S8** → Phase 1.1 splits `isVariantProducingAgentType` into `canBeFirstIteration` + `producesNewVariants`; routes existing call sites to the correct successor.
- [security_technical] **S9** → Phase 5.1 wizard renders a yellow editing-terminal warning when no later swiss iteration is queued; runtime warn-log mirrors it post-persistence.
- [security_technical] **S10** → Phase 1.6 extends `CalibrationRow['phase']` union too; new `startupAssertions.ts` module asserts BOTH TS sites match the DB CHECK.
- [architecture_integration] **A6** → Phase 2.A.1 contract table rewritten with actual B-markers from `Agent.ts` source (B047/B048/B051/B053/B054) plus unprefixed contracts (tactic auto-extraction at line 52, FK threading at line 107, single-variant per AgentOutput).
- [architecture_integration] **A8** → Phase 2.A.5 regex narrowed to `\.run\(` only inside `execute()` body; `new XAgent(` is explicitly allowed.
- [architecture_integration] **A9** → Phase 3.3.1 widens `MergeRatingsInput.iterationType` to 4 values incl reflect_and_generate; fixes the runIterationLoop:686 call site to pass reflect_and_generate; adds regression test asserting per-iteration consistency between snapshot enum and merge enum universally.
- [architecture_integration] **A10** → Phase 3.2 widens BOTH producer (`recordSnapshot`) AND consumer (`IterationSnapshotRow.iterationType` at `evolutionActions.ts:404`) to the full 4-value union.
- [testing_cicd] **T6** → Phase 6.1 split: 6.1a real-LLM E2E under `@evolution` tag (matches existing precedent); 6.1b in-process Jest+RTL UI integration tests for deterministic pre-merge gates.
- [testing_cicd] **T7** → Rollout/Rollback section reframed: migration→code dependency is one-way; rollback post-code-deploy is flag-only; explicit "do not support" callout for migration revert.
- [testing_cicd] **T8** → Phase 1.6 hoists assertion out of cost-calibration loader into new `startupAssertions.ts` invoked from `agentRegistry.ts`; runs unconditionally regardless of `COST_CALIBRATION_ENABLED`.
- [testing_cicd] **T9** → Phase 6.1.1 pivoted: 6.1.1a adds `LEGACY_AGENT_NAME_ALIASES` map for the `?agentName=iterativeEditing` URL; 6.1.1b strategy-config BC test for missing new fields; synthetic V1-shape test dropped as theater.
- [testing_cicd] **T10** → Phase 1.4 thresholds read from env vars at registry init with hardcoded fallbacks; documented in Rollout section.
- [extra] Top-up loop budget invariant fixed (Phase 3.3): per-top-up `perInvocationBudgetUsd = remainingBudget / projectedRemainingTopUps` so Decisions §15's starvation protection extends to serial top-ups, not just the parallel batch.

**Resolution:** Skill 2-pass cap reached. Transitioning to Phase B detailed review without a Phase A pass 3.

### Phase B — Detailed Review · Iteration 1 (2026-05-01)

**Scores**: Security & Technical: 4/5, Architecture & Integration: 4/5, Testing & CI/CD: 4/5

**Critical Gaps**:
- [security_technical] Phase 1.6 startup assertion DB role / `pg_catalog` access undefined — could itself become the bricking failure mode
- [security_technical] `evolution_cost_calibration_phase_check` constraint name brittle (existing migration uses unnamed inline CHECK)
- [security_technical] `editingEligibilityCutoff` lacks schema-level value validation (`topN: 0` would burn budget reservation)
- [testing_cicd] New integration test filenames don't match `test:integration:evolution` glob → silently route to non-evolution job
- [testing_cicd] Verification section stale — references removed `editingTopK`, doesn't reflect 6.1a/6.1b split
- [testing_cicd] CI workflow file edits for 5 new env vars not enumerated; CI/CD verification claims don't match assertions

**Score Reasoning**:
- Security & Technical: present Verification section, two structural review passes closed 30 gaps, three critical gaps remain that are real blockers but each is a focused 5–20 LOC fix. Architecture sound, just needs the polish.
- Architecture & Integration: Verification section present, file paths verified against repo, naming follows project conventions, wrapper-delegate pattern explicit. Remaining issues are all minor copy fixes.
- Testing & CI/CD: test strategy thorough across unit/property/integration/golden-master/BC/E2E. Three critical CI-routing/staleness issues that prevent 5/5 — each a focused fix.

**Fixes Applied**:
- [security_technical] Phase 1.5a/1.5b rewritten as DROP+RECREATE with explicit named constraint `evolution_cost_calibration_phase_allowed`; Phase 1.6 startup assertion module specifies service-role Supabase client, fail-open behavior on `permission denied`, distinct error paths for connection-error / zero-rows / parse-error / phase-mismatch; `MissingMigrationError` declared inside the same module.
- [security_technical] Phase 1.1 adds value-validation refines on `editingEligibilityCutoff`: topN must be int ≥1, topPercent must be in (0, 100]. Audit recommendation for parallel `qualityCutoffSchema` consumers.
- [testing_cicd] All new integration test filenames renamed with `evolution-` prefix (`evolution-iterative-editing-agent.integration.test.ts` etc.) so they match the `test:integration:evolution` package.json glob. Added CI-routing convention paragraph to Testing > Integration Tests subsection.
- [testing_cicd] Verification section regenerated against post-Phase-A plan body — removes `editingTopK` reference, adds 6.1a (real-LLM `@evolution`-tagged) + 6.1b (Jest+RTL UI) + 6.1.1a/b/c BC test commands; adds startup-assertion + dispatch-helper + invariant-test verification paths; adds migration verification step; adds rollout-gate flag verification.
- [testing_cicd] Phase 5.2 `cycles × top-K` corrected to `cycles × eligibilityCount` / `dispatchCount`.
- [testing_cicd] Phase 6.9 NEW: enumerates which workflow files need editing for the 5 new env vars (ci.yml, e2e-nightly.yml, post-deploy-smoke.yml, migration-reorder.yml). Phase 6.10 NEW: integration test that proves the startup assertion works by removing one phase from the CHECK and asserting MissingMigrationError throws.
- [polish] Phase 2.A.0 NEW: declares `evolution/src/lib/core/agents/editing/constants.ts` (AGENT_DEFAULT_MAX_CYCLES, DRIFT_MAX_REGIONS, CONTEXT_LEN, etc.) and `types.ts` (IterativeEditInput shape with rationale for `parent: Variant` divergence from existing `parentText` convention). Phase 2.D.4 NEW: approverPrompt.test.ts task that the Testing summary referenced but had no creating phase. Risk Register cross-references corrected (Phase 2.6 → Phase 2.D.1, Phase 1.8 fixture-validation → existing executionDetailFixtures harness). costCalibrationLoader.ts path corrected to `pipeline/infra/`.
