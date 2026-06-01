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
- [x] **D4 — Normalization to avoid FALSE splits (DECIDED: normalize + round numbers).** Canonical handling so semantically-identical configs still dedupe: `undefined` vs omitted = same (drop undefined); **numbers are coerced via `Number(x)` AND rounded to a precision floor of `0.001`** (i.e. `Math.round(x / 0.001) * 0.001`, then re-`Number()` to drop `-0`/trailing-zero artifacts) so that differences smaller than 0.001 do NOT create a new strategy — `40` == `40.0` == `4e1`, and `0.05` == `0.050001`. Differences ≥ 0.001 DO split (e.g. `0.05` vs `0.051`). Apply the rounding recursively to every numeric leaf in the config before hashing. Drop the deprecated mirror fields (`budgetBufferAfterParallel/Sequential`) before hashing. Unit tests must cover: `40` vs `40.0` → same; `0.05` vs `0.0500005` → same; `0.05` vs `0.051` → different.
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
- [x] **R4 — Scope of "every field" (CONFIRMED YES).** Hash covers the FULL config: all top-level fields (`budgetUsd`, `generationTemperature`, `maxComparisonsPerVariant`, `editingModel`, `approverModel`, budget floors, …) AND all per-iteration knobs. No field exempt except the deprecated mirror fields dropped per D4.

## Separate Item (out of scope — logged for a future project)

**Arena anomaly: `winner='b'` never recorded + 41–44% draw rate.** Across all 8 paragraph_recombine runs analyzed (both the 3-rewrite cohort, 786 comparisons, and the 6-rewrite cohort, 356 comparisons), `evolution_arena_comparisons.winner` is **never** literally `'b'`, and ~41–44% of all comparisons are draws (confidence 0.5). Part of this is a benign storage convention (decisive winners normalized to `entry_a`), but the combination — challenger-position apparently never winning + a very high draw rate under a small judge model (`gemini-2.5-flash-lite` / `qwen-2.5-7b-instruct`) — points to a possible positional bias in the ranking code OR a judge-capability/rubric limit. This is the single biggest threat to arena signal quality (it underlies the "ELO drops are mostly noise" finding) but is **out of scope** for Task A (hashing) and the original 5-run performance question. **Action:** spin up a dedicated investigation project (suggested name `investigate_arena_draw_rate_and_positional_bias`) — verify whether the ranking code can ever emit a `b`/challenger win, and whether the draw rate falls with a stronger judge model or sharpened rubric.

## Review & Discussion

### /plan-review — CONSENSUS REACHED (5/5/5) after 2 iterations

**Iteration 1 — scores 2/2/2 (Security / Architecture / Testing).** Critical gaps found (all code-verified):
- D5 index claim wrong verb/target — only one index is migration-defined; the second (`uq_strategy_config_hash`) is **DB drift** confirmed on live staging. Risk of dropping the `onConflict` target constraint.
- D1 naive "strip undefined" would REGRESS existing default-value folding (`includesMirrorApprover`→true, `maxDispatches`→1, `perInvocationCapUsd`→0.05) → false splits.
- R2 premise wrong: `config_hash` IS bounded — `z.string().min(1).max(100)` at `schemas.ts:50` (not "unconstrained text"). v2 prefix + clone suffix ≈ 58 chars < 100, safe.
- `v2:` prefix breaks: name derivation `hash.slice(0,6)` (L161), format asserts (`/^[0-9a-f]{12}$/`, len===12), and two purpose-built snapshot-regression GUARD tests.
- D4 `Math.round(x/0.001)*0.001` reintroduces a binary-float tail → switch to `Number(x).toFixed(3)` string token.

**Fixes applied (commit `4985bc99`):** D1a runtime-default folding + null/empty-array guards; D4 → `toFixed(3)`; D2 patches name-slice + clone consumers; D5 → drop the drift index only, keep the onConflict target, marked optional; A2 expanded with format-assert rewrites, snapshot-guard re-baseline, inverted exclusion test; R2/R3/R5/R6 resolved with code evidence.

**Iteration 2 — scores 5/5/5.** All iter-1 critical gaps verified resolved against code. Zero remaining critical gaps; only minor hardening nits (import default constants in tests, document Phase A3 has no rollback, add a dropped-mirror-field equivalence test, cite exact it-blocks). Plan is ready for execution.

**Carry-in minor nits for the build phase (non-blocking):**
- Add `Number.isFinite` defensive guard + comment that canonicalize runs AFTER zod parse.
- Pin D1a default-folding tests to the actual runtime default constants (not literals) so a future default change can't silently desync.
- Note intentional removal of agent-type emit-gates (a stray field on the wrong agent type now legitimately splits the hash) + one test for it.
- Post-deploy: verify the drift-index drop landed on BOTH staging and prod (prod may differ).
- Add equivalence test: two configs differing only in a deprecated mirror field (`budgetBufferAfterParallel`) hash the SAME.
