# Further Investigate Paragraph Recombine Performance Plan

## Background
Further investigate performance of the 5 most recent paragraph recombine runs.

## Requirements (from GH Issue #1154)
Further investigate performance of 5 most recent paragraph recombine runs.

## Problem
The `paragraph_recombine` agent has had several recent investigations into cost accuracy, persistence/display, and effectiveness (20260529–20260530). This project continues that line by examining the 5 most recent paragraph_recombine runs to characterize their actual performance — cost, latency, drop rates, slot/rewrite yield, arena outcomes, and estimation error — and identify any remaining regressions or tuning opportunities. Scope and concrete findings to be refined after /research.

## Options Considered
- [ ] **Option A: Query-only forensic analysis**: Use read-only DB queries against the 5 most recent runs (`evolution_agent_invocations`, `evolution_variants`, `evolution_arena_comparisons`, `evolution_metrics`) to characterize performance; produce a written findings report. No code changes.
- [ ] **Option B: Forensics + targeted fixes**: Same analysis, then fix any concrete regressions found (cost attribution, drop-rate, persistence) with tests.
- [ ] **Option C: Forensics + instrumentation/tooling**: Same analysis, plus add a reusable analysis script/query helper for future paragraph_recombine run audits.

## Phased Execution Plan

### Phase 1: Identify the 5 most recent runs
- [ ] Query `evolution_runs` for the 5 most recent `paragraph_recombine` runs (by `created_at`), capturing run IDs, status, and run-level cost metrics
- [ ] Confirm which environment (staging vs prod) holds the runs of interest

### Phase 2: Per-run performance characterization
- [ ] For each run, pull per-invocation cost/duration and `execution_detail` (per-slot, per-rewrite cost/status/dropReason/temperature/estimationErrorPct)
- [ ] Compute drop-rate by rewrite index (watch index-0 tighten-directive drop rate vs <30% target)
- [ ] Compute cost-estimation error per run (`cost_estimation_error_pct`) and cap-vs-actual ratio
- [ ] Cross-check persisted `evolution_variants` arena columns vs in-memory `execution_detail` truth (matchCount, parent_variant_ids)

### Phase 3: Synthesis & recommendations
- [ ] Summarize findings across the 5 runs (cost, latency, yield, arena outcomes, regressions)
- [ ] Recommend tuning/fixes if warranted (feeds Option B/C decision)

## Testing

### Unit Tests
- [ ] [Only if code changes result — e.g. cost/drop-rate logic test path TBD after /research]

### Integration Tests
- [ ] [Only if code changes result — TBD after /research]

### E2E Tests
- [ ] [Only if code changes result — TBD after /research]

### Manual Verification
- [ ] Re-run the analysis queries and confirm reported numbers reproduce

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless a UI/dashboard change results (re-evaluate after /research)

### B) Automated Tests
- [ ] [Specific test command TBD — only if code changes result]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/evolution/paragraph_recombine.md` — add a row to "Recent Investigations" for this analysis
- [ ] `evolution/docs/evolution/cost_optimization.md` — update Paragraph-Recombine Cost section if new tuning lands
- [ ] `evolution/docs/evolution/operations.md` — note any new analysis query/workflow
- [ ] `evolution/docs/evolution/data_model.md` — only if schema understanding changes
- [ ] `evolution/docs/evolution/rating.md` — only if rating/arena findings warrant
- [ ] `evolution/docs/evolution/arena.md` — only if arena findings warrant
- [ ] `docs/feature_deep_dives/evolution_pipeline.md` — only if the pointer set changes

## Task A — Hash every strategy field (no silent dedup/overwrite of distinct configs)

### Goal
Any difference between two strategy configs must produce a different `config_hash`, so distinct configs become distinct `evolution_strategies` rows instead of colliding on the `ON CONFLICT (config_hash)` upsert and silently overwriting one another. Today the hash uses a whitelist (`canonicalizeIterationConfig` in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`), so configs differing only in an unhashed field (e.g. `rewritesPerParagraph` 3 vs 6, `budgetUsd`, `maxComparisonsPerParagraph`, `generationTemperature`, …) hash identically and one overwrites the other.

### Root cause (verified)
`hashStrategyConfig` (`findOrCreateStrategy.ts:110`) hashes `{generationModel, judgeModel, iterationConfigs.map(canonicalizeIterationConfig)}`. `canonicalizeIterationConfig` (L35–103) emits only a fixed whitelist; every other field in `iterationConfigSchema`/`strategyConfigBaseSchema` (`evolution/src/lib/schemas.ts:612–935`) is dropped. See `_research.md` → "Strategy Hashing — Verified Mechanism" for the full include/exclude lists.

### Design decisions (resolve before coding)
- [ ] **D1 — Canonicalization approach.** Replace the whitelist with a generic deep-canonicalizer that hashes the ENTIRE validated `StrategyConfig`: recursively drop `undefined`, sort object keys, preserve `iterationConfigs` array ORDER (execution order is semantic), sort only known order-insensitive arrays (`criteriaIds`). One function, schema-driven — new fields auto-participate.
- [ ] **D2 — Hash versioning.** Prefix new hashes with a version tag (e.g. `v2:<sha12>`). Prevents a v1 hash ever colliding with a v2 hash, and makes the cutover auditable. Existing rows keep their bare (v1) hashes untouched.
- [ ] **D3 — Backfill: none.** Do NOT recompute hashes for existing rows. Old rows stay as historical records under v1; new upserts compute v2. (Consequence: a re-run of a pre-existing config creates a new v2 row instead of matching the old v1 row — acceptable and expected. Document it.)
- [ ] **D4 — Normalization to avoid FALSE splits.** Decide canonical handling so semantically-identical configs still dedupe: `undefined` vs omitted = same; numeric `40` vs `40.0` = same; drop deprecated mirror fields (`budgetBufferAfterParallel/Sequential`) or treat consistently. Goal: split on real differences, not serialization noise.
- [ ] **D5 — Redundant index cleanup.** Drop one of the two identical unique indexes on `config_hash` (`uq_strategies_config_hash`, `uq_strategy_config_hash`) — migration, low risk.

### Phased Execution Plan

#### Phase A1: Implement full-config hashing
- [ ] Rewrite `hashStrategyConfig` + replace `canonicalizeIterationConfig` with a generic `canonicalizeConfig(config)` deep-sort/strip in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`, emitting `v2:` prefix (D1, D2, D4).
- [ ] Keep the function signature/exports stable (callers: `lib/pipeline/index.ts:51`, `services/strategyRegistryActions.ts:186,267`).
- [ ] After this code block: run `npm run lint`, `npm run typecheck`, `npm run build` (per CLAUDE.md).

#### Phase A2: Tests
- [ ] Unit (`evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`): assert configs differing in EACH previously-unhashed field now produce different hashes — `rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`, `budgetUsd`, `generationTemperature`, `maxComparisonsPerVariant`, `editingModel`, `approverModel`.
- [ ] Unit: assert semantically-identical configs STILL hash equal (D4 — key order, undefined vs omitted, iterationConfigs order preserved → different hash; criteriaIds reorder → same hash).
- [ ] Update fixtures/tests asserting specific hash values (found via grep): `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`, `evolution/src/lib/schemas.test.ts`, `evolution/src/services/strategyRegistryActions.test.ts`, `evolution/src/__tests__/integration/evolution-criteria-strategy-hash.integration.test.ts`, `src/__tests__/integration/__fixtures__/staging-strategies-2026-04-13.json`. NOTE: `evolution/src/lib/shared/hashStrategyConfig.test.ts` tests the *labeling* helper (not the hasher) — likely no change, verify.
- [ ] Existing `config_hash` values are bare 12-hex (no prefix); the `v2:` prefix is net-new — confirm `evolution_strategies.config_hash` is unconstrained `text` (DB shows mixed lengths 12/24 already, so length is fine).
- [ ] Run the affected unit suites.

#### Phase A3: Migration — drop redundant index (D5)
- [ ] Add idempotent migration `supabase/migrations/<ts>_drop_redundant_strategy_config_hash_index.sql`: `DROP INDEX IF EXISTS uq_strategy_config_hash;` (keep `uq_strategies_config_hash`). Verify which name is referenced by code/constraints first.
- [ ] `npm run lint:migrations` + `npm run migration:verify` (ephemeral Docker postgres).

#### Phase A4: Docs
- [ ] Update `evolution/docs/evolution/data_model.md` (or strategost.md) to state: hash covers the full config; `v2:` versioning; old v1 rows retained; re-running an old config creates a new row.

### Testing
#### Unit Tests
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — per-field hash-distinctness + equivalence cases (Phase A2).

#### Integration Tests
- [ ] Re-run `evolution`-touching integration suites that build strategies (`strategyRegistryActions`, `strategyPreviewActions`) after fixture regen.

#### Manual Verification
- [ ] Construct two configs differing only in `rewritesPerParagraph` (3 vs 6); confirm `hashStrategyConfig` returns different `v2:` hashes and `upsertStrategy` creates two rows (not an overwrite).

### Verification
#### B) Automated Tests
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test -- findOrCreateStrategy` (or the evolution unit subset)
- [ ] `npm run lint:migrations && npm run migration:verify`

### Risks / Open Questions
- [ ] **R1 — Caller relies on merge?** Confirm no flow depends on two distinct configs deduping (e.g. wizard "find identical existing strategy"). Initial scan found none; verify.
- [ ] **R2 — Hash length/storage.** `config_hash` currently 12 hex chars; the `v2:` prefix lengthens it — confirm the column has no length constraint that breaks (it's `text`/no limit in practice; verify).
- [ ] **R3 — Performance metrics keyed on hash.** Strategy leaderboard / arena aggregates group by strategy; new-row-per-config means an old config's history won't carry to its v2 twin. Acceptable for going-forward specificity; note it.
- [ ] **R4 — Scope of "every field".** Confirm intent includes top-level (`budgetUsd`, `generationTemperature`, `maxComparisonsPerVariant`) AND all per-iteration knobs. Plan assumes YES (full config).

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
