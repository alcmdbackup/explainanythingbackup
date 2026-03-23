# Find Bugs Evolution Research

## Problem Statement
Look for evolution bugs on main branch in stage. Do a deep scan and identify any bugs you can find.

## Requirements (from GH Issue #769)
- Full system scan of all evolution subsystems: pipeline execution, arena sync, admin UI, cost tracking, experiments, and strategies

## Scan Summary

**32 agents** across **8 rounds** scanned the entire evolution system. After deduplication and verification:
- **15 confirmed high-priority bugs** (ranked by impact)
- **~20 medium/low issues** (config, UX, accessibility, tests)
- **~12 false positives** identified and rejected
- **7 pipeline edge cases** verified as properly handled
- **5 stale documentation files** needing updates post-consolidation

---

## TOP 15 BUGS — Prioritized by Impact

### 1. CRITICAL: Concurrent run limit race condition
- **File:** `evolution/src/lib/pipeline/claimAndExecuteRun.ts:85-100`
- **Likelihood:** High — occurs under load with multiple runners
- **Impact:** Can exceed EVOLUTION_MAX_CONCURRENT_RUNS (e.g., 9 runs instead of max 5)
- **Root cause:** Count check and claim RPC are separate DB calls (TOCTOU vulnerability)
- **Fix:** Move concurrency check into claim_evolution_run RPC for atomicity

### 2. CRITICAL: Silent Elo corruption from LLM errors in ranking
- **File:** `evolution/src/lib/pipeline/loop/rankVariants.ts:159-173`
- **Verified path:** LLM error → catch returns `''` → parseWinner returns `null` → aggregateWinners returns TIE confidence 0.0 → updateDraw() reduces sigma AND adjusts mu
- **Likelihood:** Medium — any network error, timeout, or LLM refusal during ranking
- **Impact:** Ratings silently corrupted. Failed comparisons indistinguishable from genuine draws. Zero logging.
- **Fix:** Log errors, return a sentinel value distinguishable from draw, skip rating update on failed comparisons

### 3. CRITICAL: muHistory type mismatch — number[][] vs number[]
- **File:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts:140,215` produces `number[][]`
- **File:** `evolution/src/lib/types.ts:646,684` schema expects `number[]` / `z.array(z.number())`
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:84` passes directly
- **Likelihood:** High — every run
- **Impact:** Zod validation rejects the run summary, breaking admin UI visualization
- **Fix:** Either flatten muHistory when persisting or update schema to accept `number[][]`

### 4. HIGH: Experiment auto-completion without sibling run check
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:200-212`
- **Likelihood:** High — every experiment with multiple runs
- **Impact:** Experiment marked completed while sibling runs still pending/running
- **Fix:** Replace blind update with RPC using `NOT EXISTS (SELECT 1 FROM evolution_runs WHERE experiment_id = ? AND status IN ('pending','claimed','running'))`

### 5. HIGH: DeepSeek pricing 2x mismatch
- **File:** `evolution/src/lib/pipeline/infra/createLLMClient.ts:21` → `{0.27, 1.10}`
- **File:** `src/config/llmPricing.ts:61` → `{0.14, 0.28}`
- **Likelihood:** High — every DeepSeek evolution run
- **Impact:** Budget reserved at ~2x actual cost, causing premature budget exhaustion
- **Fix:** Remove duplicate pricing from createLLMClient.ts, import from shared llmPricing.ts

### 6. HIGH: No server-side budget validation for experiments
- **File:** `evolution/src/lib/pipeline/manageExperiments.ts:42-80`
- **Likelihood:** Medium — requires intentional bypass or admin error
- **Impact:** $10 total experiment budget cap is client-only. Server accepts any budget_cap_usd value.
- **Fix:** Add Zod validation with max budget check in addRunToExperimentAction

### 7. HIGH: Partial experiment creation with no rollback
- **File:** `src/app/admin/evolution/_components/ExperimentForm.tsx:110-128`
- **Likelihood:** Medium — any addRunToExperiment failure mid-loop
- **Impact:** Experiment exists with only some runs created, no cleanup
- **Fix:** Wrap in transaction or add cleanup on failure (delete experiment if no runs succeeded)

### 8. HIGH: Silent error swallowing in finalization (arena sync + variant upsert)
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:176-185,253-263`
- **Likelihood:** Medium — any DB error during finalization
- **Impact:** Variants not persisted or arena not synced, but run marked completed
- **Fix:** Re-throw on non-transient errors, add retry for transient errors

### 9. HIGH: buildRunSummary includes arena entries in metrics
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:121`
- **Likelihood:** High — every prompt-based run with arena entries
- **Impact:** Run summary stats (topVariants, strategyEffectiveness) inflated by arena entries
- **Fix:** Pass filtered localPool to buildRunSummary instead of unfiltered result.pool

### 10. HIGH: Missing pagination in getEvolutionRunsAction
- **File:** `evolution/src/services/evolutionActions.ts:177-239`
- **Likelihood:** High — grows with data
- **Impact:** Only 50 runs visible, no way to paginate. Other list actions return {items, total}.
- **Fix:** Add offset/limit params, return `{ items, total }` with `{ count: 'exact' }`

### 11. HIGH: Empty local pool incorrectly fails run
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:109-118`
- **Likelihood:** Medium — budget exhausted before generating local variants
- **Impact:** Legitimate runs marked failed with misleading "empty pool" error
- **Fix:** Distinguish "no variants generated" from "only arena variants in pool"

### 12. HIGH: syncToArena winner hardcoded to 'a'
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:249`
- **Likelihood:** Low (works by coincidence since entry_a=winnerId), but fragile
- **Impact:** If entry ordering changes, arena match results will be incorrect
- **Fix:** Map winner based on ID comparison: `m.winnerId === entry_a ? 'a' : 'b'`

### 13. HIGH: Missing indexes for arena queries on consolidated table
- **File:** `supabase/migrations/20260321000002:91-94`
- **Likelihood:** Grows with data — O(n) table scans
- **Impact:** Arena leaderboard pages slow as variants table grows
- **Fix:** Add partial index: `(prompt_id, mu DESC) WHERE synced_to_arena = true AND archived_at IS NULL`

### 14. HIGH: Cancel-finalize race can overwrite killed status
- **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:132` vs kill action
- **Likelihood:** Low — requires timing coincidence
- **Impact:** Cancelled run's "failed" status overwritten to "completed" by finalizer
- **Fix:** Add runner_id check to finalization update: `.eq('runner_id', currentRunnerId)`

### 15. MEDIUM: Missing ON DELETE clause on evolution_explanation_id FK
- **File:** `supabase/migrations/20260321000002:30`
- **Likelihood:** Medium — cleanup operations on evolution_explanations
- **Impact:** FK constraint violations prevent data cleanup
- **Fix:** Add `ON DELETE SET NULL` to the FK constraint

---

## CONFIRMED FALSE POSITIVES (Rejected Bugs)

| Reported Bug | Why It's Not a Bug |
|---|---|
| computeExperimentMetrics totalCost field | Code safely falls back to 0 with `typeof summary?.totalCost === 'number'` |
| Winner selection unrated variant | Loop skips unrated variants with `if (!r) continue`, baseline fallback is safe |
| Budget double-spend parallel LLM calls | `reserve()` is synchronous, protected by JS single-threaded event loop |
| Arena sync concurrent upserts | Protected by PostgreSQL INSERT...ON CONFLICT with PK |
| Strategy aggregate corruption | Protected by FOR UPDATE row lock in RPC (fixed in migration 20260215) |
| Variant ID collisions | Uses uuid v4 with cryptographic randomness |
| FormDialog initial state not reset | Component unmounts on close (`return null` when `!open`), remount re-initializes |
| LineageGraph crash on empty arrays | Guard clause `if (nodes.length === 0) return` prevents crash |
| EloTab crash on empty muValues | Guard clause `if (history.length === 0)` returns early |
| All 7 pipeline iteration edge cases | Properly handled: empty generation, single variant pool, all draws, budget mid-gen, empty LLM, crossover with 1 parent, iteration 0 |

---

## ADDITIONAL FINDINGS BY CATEGORY

### Configuration Issues
- Budget default cascade: DB has 5.00 (V1) → 1.00 (V2 migration) → 1.0 (code fallback)
- Model name format divergence between pipeline and global pricing
- Optional config defaults (strategiesPerRound, calibrationOpponents) scattered across 4+ files
- Ineligible strategies can be submitted after budget change in experiment wizard

### Documentation — Stale Post-Consolidation
- data_model.md: Still documents dropped `evolution_arena_entries` table; missing 11 new columns on variants
- architecture.md: References non-existent `evolution/src/lib/pipeline/arena.ts`
- arena.md: Entire document references dropped table and wrong file paths
- reference.md: File inventory lists wrong locations for arena functions
- sync_to_arena RPC signature is correctly documented

### Performance Issues
- N+1 query in variant lineage chain (up to 10 sequential round-trips)
- Dashboard full table scan for status counts (no LIMIT, no aggregate)
- 200-500KB unnecessary variant_content in list queries
- Client-side count aggregation instead of SQL COUNT

### Accessibility Issues (22 total)
- Dialogs (FormDialog, ConfirmDialog): No ARIA roles, no focus trap, no Escape key
- EntityDetailTabs: Missing role="tablist", aria-selected, keyboard navigation
- Tables: Clickable rows not keyboard accessible, missing aria-sort
- Missing error boundaries in RegistryPage

### Security (Low Risk)
- Auth properly enforced across all actions (adminAction wrapper)
- No XSS or SQL injection found
- Error messages could leak DB schema details (table/column names)
- Prompt injection in LLM prompts (user content unsanitized)

### Test Issues
- Missing test files for invocationActions and evolutionVisualizationActions
- Tautological assertions in arena E2E tests
- Index-based row selection assuming stable sort order
- Test data factory missing required schema fields

### Error Handling Pattern
- rankVariants: LLM errors silently return empty string (→ Elo corruption, Bug #2)
- persistRunResults: Variant upsert + arena sync errors swallowed (Bug #8)
- trackInvocations: Create/update errors logged to console only
- Run logger: Fire-and-forget with silent catch
- markRunFailed: console.error only, no structured logging

### Run Lifecycle Gaps
- No retryRunAction or cancelRunAction implemented (must create new runs)
- Deleted prompt not checked during execution (arena sync happens for soft-deleted prompts)
- Watchdog doesn't detect claimed-but-never-started runs (null last_heartbeat)

---

## SCAN METHODOLOGY

| Round | Agents | Focus |
|-------|--------|-------|
| 1 | 4 | Pipeline, Arena+Rating, Cost Tracking, Admin UI+Experiments |
| 2 | 4 | Verify Critical Bugs, SQL Migrations, Shared Utils, E2E Tests |
| 3 | 4 | Cross-System Integration, Ops+Watchdog, Admin Components, Data Integrity |
| 4 | 4 | Verify UI Bugs, Zod Schemas, Dead Code, Error Propagation |
| 5 | 4 | Performance, Security, Consolidation Migration, Type Safety |
| 6 | 4 | Verify muHistory, Config Consistency, Experiment Wizard, Doc Accuracy |
| 7 | 4 | Verify Budget Bypass, Run Lifecycle, Accessibility, Pipeline Edge Cases |
| 8 | 4 | Verify Elo Corruption, Final Sweep, Deduplication, Priority Ranking |
