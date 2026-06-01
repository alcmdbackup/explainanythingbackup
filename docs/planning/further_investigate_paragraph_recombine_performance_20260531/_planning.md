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
- [x] Query `evolution_runs` for the 5 most recent `paragraph_recombine` runs (by `created_at`), capturing run IDs, status, and run-level cost metrics
- [x] Confirm which environment (staging vs prod) holds the runs of interest — staging/dev

### Phase 2: Per-run performance characterization
- [x] For each run, pull per-invocation cost/duration and `execution_detail` (per-slot, per-rewrite cost/status/dropReason/temperature/estimationErrorPct)
- [x] Compute drop-rate by rewrite index
- [x] Cross-check persisted `evolution_variants` arena columns vs `execution_detail`

### Phase 3: Synthesis & recommendations
- [x] Summarize findings across the runs (see `_research.md`)
- [x] Recommend tuning/fixes (Task A drafted below)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/evolution/paragraph_recombine.md` — add a row to "Recent Investigations" for this analysis
- [ ] `evolution/docs/evolution/data_model.md` — strategy-hash mechanism change (Task A)
- [ ] `evolution/docs/evolution/strategost.md` — strategy identity / hashing semantics

## Task A — Hash every strategy field (no silent dedup/overwrite of distinct configs)

### Goal
Any difference between two strategy configs must produce a different `config_hash`, so distinct configs become distinct `evolution_strategies` rows instead of colliding on the `ON CONFLICT (config_hash)` upsert and silently overwriting one another. Today the hash uses a whitelist (`canonicalizeIterationConfig` in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts`), so configs differing only in an unhashed field (e.g. `rewritesPerParagraph` 3 vs 6, `budgetUsd`, `maxComparisonsPerParagraph`, `generationTemperature`, …) hash identically and one overwrites the other.

### Root cause (verified)
`hashStrategyConfig` (`findOrCreateStrategy.ts:110`) hashes `{generationModel, judgeModel, iterationConfigs.map(canonicalizeIterationConfig)}`. `canonicalizeIterationConfig` (L35–103) emits only a fixed whitelist; every other field in `iterationConfigSchema`/`strategyConfigBaseSchema` (`evolution/src/lib/schemas.ts:612–935`) is dropped. See `_research.md` → "Strategy Hashing — Verified Mechanism" for the full include/exclude lists.

### The hard part (flagged by plan-review): full-config hashing must PRESERVE today's deliberate equivalences
The current whitelist isn't just lossy — it encodes intentional "these two configs are the same strategy" rules that a naive `JSON.stringify(whole config)` would break, causing FALSE SPLITS. A correct fix must keep ALL of these while adding the missing fields:
1. **Runtime-default folding** — omitted ≡ explicit-default. Verified defaults (all `.optional()` with NO zod `.default()`; defaults live in agent code): `includesMirrorApprover` → `true` (`proposerApproverCriteriaGenerate.ts:270` `?? true`); `maxDispatches` → `1` (`runIterationLoop.ts` `?? 1`); `perInvocationCapUsd` → `0.05` (`ParagraphRecombineAgent.ts` `DEFAULT_PER_INVOCATION_CAP_USD`). Current code special-cases only `includesMirrorApprover === false`. Tests at `findOrCreateStrategy.test.ts:416` assert `undefined === true`.
2. **Agent-type-gated stripping** — a field set on the WRONG agent type is currently stripped so it doesn't affect the hash (tests assert stale `reflectionTopN`/`criteriaIds`/cap-on-wrong-type collide). **Decision needed (D6):** keep stripping these (preserve current behavior) OR let them split. Recommendation: KEEP stripping for fields the runtime ignores anyway (a value the pipeline never reads must not change identity).
3. **`criteriaIds` sorted before hashing** (order-insensitive set) and empty `[]` ≡ omitted.

⚠️ This means D1 is NOT "replace the whitelist with one generic deep-strip." It is "deep-canonicalize the full config AFTER a normalization pass that (a) resolves runtime defaults, (b) strips runtime-ignored fields per agent type, (c) sorts set-like arrays, (d) drops deprecated mirror fields, (e) rounds numbers." The whitelist's *conditional logic* must be reframed as a normalization step, then everything that survives is hashed.

### Design decisions
- [x] **D1 — Canonicalization = normalize THEN deep-hash-everything.** Build `normalizeConfig(config)` that applies the equivalence rules above, then `canonicalize()` deep-sorts keys / preserves `iterationConfigs` order / sorts `criteriaIds` / drops `undefined` & `null` leaves, then hash the result. New schema fields auto-participate UNLESS explicitly normalized away. (Supersedes the earlier "just strip undefined" idea, which plan-review showed regresses folds.)
- [x] **D2 — Hash versioning + string consumers.** Prefix new hashes `v2:<sha12>` (prevents v1/v2 collision; auditable). MUST also patch the two consumers of the hash STRING shape, or they break: (1) `upsertStrategy:161` derives the name from `hash.slice(0,6)` → strip `v2:` first, slice the hex; (2) `cloneStrategyAction` (`strategyRegistryActions.ts:281`) builds `${configHash}_clone_${uuid}` → becomes `v2:<hex>_clone_<uuid>` (~58 chars), still < the `max(100)` cap (see R2).
- [x] **D3 — Backfill: none.** Old v1 rows keep their hashes as history; new upserts compute v2. A re-run of a pre-existing config creates a new v2 row (expected). **Rollback:** revert the hasher commit — new upserts resume v1; v2 rows become orphaned history; no data migration to undo.
- [x] **D4 — Number normalization via fixed-decimal STRING.** Canonicalize each numeric leaf to `Number(x).toFixed(3)` (NOT `Math.round(x/0.001)*0.001`, which reintroduces a binary-float tail e.g. `0.029→0.028999…`). Effect: differences `< 0.001` do NOT split (`40`≡`40.0`≡`4e1`; `0.05`≡`0.0500005`); differences `≥ 0.001` DO split (`0.05` vs `0.051`). Guard `Number.isFinite` (zod bounds already reject NaN/Infinity; canonicalize runs AFTER parse). Accept that sub-0.001 resolution on `redundancyJaccardThreshold` (0–1) merges (`0.350`≡`0.3504`) — judged fine.
- [x] **D5 — Drop the DRIFT index (CORRECTED via live DB).** Live staging `pg_indexes`+`pg_constraint` show **TWO** unique objects on `config_hash`: `uq_strategies_config_hash` (defined in `supabase/migrations/20260329000001_add_evolution_constraints.sql:39` as `ADD CONSTRAINT … UNIQUE`; this is the `onConflict:'config_hash'` target — KEEP) and `uq_strategy_config_hash` (**DB drift — in NO migration** — DROP). ⚠️ Both are constraint-backed on live DB, so the drop likely needs `ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS uq_strategy_config_hash` (NOT `DROP INDEX`). Confirm object type against live DB before writing the migration. Because the drift object is absent from migrations, `migration:verify` (fresh DB) is a no-op — the real effect must be confirmed on staging post-merge. **This sub-task is OPTIONAL and independent of the hashing change; ship it separately if it complicates the PR.**
- [x] **D6 — Keep agent-type stripping of runtime-ignored fields** (see "hard part" #2). A field the pipeline never reads for that agent type must not change strategy identity.

### Phased Execution Plan

#### Phase A1: Implement full-config hashing
- [ ] Add `normalizeConfig(config)` in `findOrCreateStrategy.ts`: resolve runtime defaults (D1.1), strip runtime-ignored fields per agent type (D1.2/D6), sort `criteriaIds` + drop empty (D1.3), drop deprecated mirror fields, round numbers to `toFixed(3)` (D4), guard null/undefined/non-finite.
- [ ] Replace `hashStrategyConfig` body with `'v2:' + sha256(stableStringify(normalizeConfig(config))).slice(0,12)` where `stableStringify` deep-sorts object keys and preserves array order.
- [ ] Patch hash-string consumers (D2): name-derivation strip at `:161`; verify clone length at `strategyRegistryActions.ts:281`.
- [ ] Keep exports stable (callers: `lib/pipeline/index.ts:51`; `strategyRegistryActions.ts:186` create, `:267` clone). Confirm no separate recompute in `strategyPreviewActions.ts` / `projectDispatchPlan.ts` (plan-review: none — verify).
- [ ] After this block: `npm run lint`, `npm run typecheck`, `npm run build`.

#### Phase A2: Tests (after the block: lint + tsc + run suite)
- [ ] **New-field distinctness** (`findOrCreateStrategy.test.ts`): each previously-unhashed field now changes the hash — `rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`, `editingMaxCycles`, `editingEligibilityCutoff`, `editingProposerSoftCap`, `debateJudgeReasoningEffort`, top-level `budgetUsd`, `generationTemperature`, `maxComparisonsPerVariant`, `editingModel`, `approverModel`.
- [ ] **Preserved equivalences** (D1/D6): `{includesMirrorApprover:true}`≡omitted; `{maxDispatches:1}`≡omitted; `{perInvocationCapUsd:0.05}`≡omitted (pin to the runtime default CONSTANTS, not literals); stale field on wrong agent type ≡ omitted; `{criteriaIds:[]}`≡omitted; `criteriaIds` reorder → same; deprecated mirror field set ≡ unset.
- [ ] **Number rounding** (D4): `40`≡`40.0`; `0.05`≡`0.0500005`; `0.05`≠`0.051`; integers unaffected.
- [ ] **Order**: `iterationConfigs` reorder → different; object-key order → same; null leaf doesn't crash.
- [ ] **Format-assertion rewrites (BREAK on `v2:` — must update, code-verified):** `findOrCreateStrategy.test.ts:15,238-239` (`/^[0-9a-f]{12}$/`, `length===12` → `/^v2:[0-9a-f]{12}$/`); `evolution-criteria-strategy-hash.integration.test.ts:25` (same regex). `shared/hashStrategyConfig.test.ts:96-104` `defaultStrategyName` asserts name contains the hash prefix — confirm the v2-strip keeps it valid.
- [ ] **Snapshot-regression GUARDs — intentionally re-baseline** (they exist to fail on canonicalization change; this IS that): `findOrCreateStrategy.test.ts:225` and `evolution-criteria-strategy-hash.integration.test.ts:23`. Note in PR that the guard is deliberately reset.
- [ ] **Invert the now-wrong exclusion test:** `findOrCreateStrategy.test.ts:22-28` ("excludes V2-only fields … budgetUsd") encodes OLD behavior and now CONTRADICTS the goal — invert (budgetUsd MUST change hash) or delete.
- [ ] **Unaffected (verify, don't churn):** `strategyRegistryActions.test.ts` MOCKS `hashStrategyConfig`; `schemas.test.ts` uses literal `config_hash`. (Drop the bogus `staging-strategies-2026-04-13.json` item — it has zero `config_hash` keys; consumed only by budget-floor-migration test.)

#### Phase A3 (OPTIONAL, may ship separately): drop the drift index (D5)
- [ ] Confirm via live staging whether `uq_strategy_config_hash` is a CONSTRAINT or bare INDEX; write the matching `ALTER TABLE … DROP CONSTRAINT IF EXISTS` or `DROP INDEX IF EXISTS` migration. KEEP `uq_strategies_config_hash`.
- [ ] `npm run lint:migrations` (DROP has no idempotency rule — passes), `check:migrations`, `check:migrations-append-only`, `npm run migration:verify` (no-op on fresh DB; real effect confirmed on staging post-merge).

#### Phase A4: Docs
- [ ] Update `evolution/docs/evolution/data_model.md` / `strategost.md`: hash now covers the FULL config; normalization rules (defaults folded, runtime-ignored fields stripped, numbers rounded to 0.001); `v2:` versioning; no backfill; re-running an old config makes a new v2 row; rollback non-destructive.

### Verification
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test -- findOrCreateStrategy` + the evolution unit subset
- [ ] (If Phase A3) `npm run lint:migrations && npm run migration:verify`
- [ ] Manual: two configs differing ONLY in `rewritesPerParagraph` (3 vs 6) → different `v2:` hashes → `upsertStrategy` creates two rows (not an overwrite).

### Risks / Open Questions
- [ ] **R1 — Caller relies on merge?** Confirm no flow depends on two distinct configs deduping. Only dedup consumer found = `upsertStrategy` onConflict; verify at build.
- [x] **R2 — Hash length (RESOLVED).** `config_hash` bounded by `evolutionStrategyInsertSchema.config_hash = z.string().min(1).max(100)` (`schemas.ts:50`), enforced on every upsert via `.parse()`. Worst case clone `v2:<12>_clone_<uuid>` ≈ 58 < 100 — safe. (Earlier "unconstrained text" premise was wrong.)
- [x] **R3 — Metrics keyed on hash (LOW RISK).** Live aggregates key on `strategy_id`, not `config_hash`; `avg_elo_per_dollar`/`stddev_final_elo` are reserved/uncomputed; no `GROUP BY config_hash` in services. New v2 row starts fresh aggregates — no cross-strategy corruption. Document.
- [x] **R4 — Scope = FULL config (CONFIRMED by user).** All top-level + all per-iteration fields, minus deprecated mirror fields (D4) and runtime-ignored fields per agent type (D6).
- [ ] **R5 — `tacticsUsed` is not a config field** (gen-1 tactics come from code default `SYSTEM_GENERATE_TACTICS` selected at `runIterationLoop.ts:210-212` only via `config.strategies` when present). Full-config hashing covers `config.strategies` if set, but cannot distinguish runs that fall back to the code default — a known limitation, not a Task-A gap. (One reviewer reported `tacticsUsed` doesn't exist in source at all — consistent with "not a config field.") Document; out of scope.
- [ ] **R6 — Do NOT drop `uq_strategies_config_hash`** — it is the onConflict target; dropping it breaks every strategy upsert. No FK references `config_hash` (FKs target `id`).

## Separate Item (out of scope — logged for a future project)

**Arena anomaly: `winner='b'` never recorded + 41–44% draw rate.** Across all 8 paragraph_recombine runs analyzed (3-rewrite cohort, 786 comparisons + 6-rewrite cohort, 356 comparisons), `evolution_arena_comparisons.winner` is **never** literally `'b'`, and ~41–44% of all comparisons are draws (confidence 0.5). Part is a benign storage convention (decisive winners normalized to `entry_a`), but the combination — challenger position apparently never winning + a high draw rate under a small judge model (`gemini-2.5-flash-lite`) — points to possible positional bias in the ranking code OR a judge-capability/rubric limit. This is the biggest threat to arena signal quality (it underlies the "ELO drops are mostly noise" finding) but is **out of scope** for Task A and the original question. **Action:** dedicated project (suggested `investigate_arena_draw_rate_and_positional_bias`) — verify whether the ranking code can emit a `b`/challenger win, and whether the draw rate falls with a stronger judge or sharpened rubric.

## Review & Discussion

### /plan-review status — NOT YET AT CONSENSUS (honest record)

> Process note: an earlier version of this section claimed "CONSENSUS 5/5/5" — that was WRONG and has been removed. What happened: my iteration-1 fix edits silently failed (whitespace mismatch), so the iteration-2 reviewers re-scored the *unchanged* plan at **2/2/2**, correctly. The real fixes are applied in THIS revision; a clean re-review (iteration 3) has not yet been run.

**Iteration 1 — 2/2/2 (Security / Architecture / Testing).** Critical gaps (all independently code/DB-verified by me afterward):
- D5: only `uq_strategies_config_hash` is migration-defined; the second unique object is **DB drift**. My live `pg_constraint`/`pg_indexes` query confirmed BOTH exist on staging (reviewers who read only migrations saw one — the live DB is authoritative). Dropping the wrong one would remove the onConflict target.
- D1 naive strip-undefined would REGRESS default-value folding (`includesMirrorApprover`/`maxDispatches`/`perInvocationCapUsd`) and agent-type stripping → false splits.
- R2 premise wrong: `config_hash` IS bounded by `z.string().max(100)` (`schemas.ts:50`).
- `v2:` prefix breaks name-derivation `slice(0,6)`, format asserts, and two snapshot-guard tests.
- D4 `Math.round(x/0.001)*0.001` reintroduces a float tail → use `Number(x).toFixed(3)`.

**Iteration 2 — 2/2/2.** Re-scored the *unchanged* doc (my iter-1 edits had failed to apply); reviewers correctly flagged the same gaps as unresolved. No new gaps beyond iter-1.

**This revision applies the real fixes:** D1 reframed as normalize-then-hash-everything (preserves default folding [D1.1], agent-type stripping [D6], `criteriaIds` sort/empty); D4 → `toFixed(3)`; D2 patches name-slice + clone consumers; D5 corrected to drop the verified drift object with the right verb + marked optional; A2 expanded with format-assert rewrites, snapshot re-baseline, inverted exclusion test, preserved-equivalence cases; R2/R3 resolved with code evidence; R5/R6 added.

**Next step:** run a clean iteration-3 `/plan-review` (fresh agents) to confirm the applied fixes actually resolve the gaps before this plan is treated as execution-ready. Do NOT mark consensus without it.
