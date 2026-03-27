# Scan Evolution Codebase For Bugs Plan

## Background
Systematically scan the evolution pipeline codebase for bugs, edge cases, and potential issues. 14 rounds of research (56 agents) identified 30+ bugs. This plan fixes all critical (3), high (8), and medium (12) severity bugs across pipeline code, metrics, server actions, UI pages, and database migrations.

## Requirements (from GH Issue #840)
- Fix all critical, high, and medium severity bugs found during research
- Write tests for each fix
- Verify database-level fixes with supabase dev
- Run lint, tsc, build, and all tests after each phase

## Problem
The evolution pipeline has 23 confirmed bugs across critical/high/medium severity. Critical bugs include a runtime crash in ranking (null dereference), a spending gate bypass (monthly cap skipped on fast-path), and silent generation failures. High bugs include silent UI error swallowing, permanently stale non-elo metrics, incomplete arena-only run summaries, and draw handling inconsistencies. Medium bugs include schema drift, unsafe type assertions, null map keys, and missing error checks.

## Execution Notes

**Line number drift:** Phases edit files sequentially. Before each phase, re-verify line numbers in target files since prior phases may have shifted them. Use grep/search to locate the exact code pattern (shown in "Current" field) rather than relying on line numbers alone. Files edited in multiple phases: `rankVariants.ts` (C1 line 740 + H7 lines 353-370), `persistRunResults.ts` (H5 lines 107-116 + M1 lines 145-148), `schemas.ts` (M3 + M4 + M5).

## Phased Execution Plan

### Phase 1: Critical Pipeline Fixes (C1, C2, C3)

#### C1: Fix fineResult non-null assertion crash
- [ ] **File:** `evolution/src/lib/pipeline/loop/rankVariants.ts` line 740
- [ ] **Current:** `return buildResult(fineResult!.converged);`
- [ ] **Fix:** Replace with safe access and add log warning:
  ```typescript
  if (!fineResult) {
    logger?.warn('Fine-ranking skipped (triage budget exceeded); convergence not evaluated', { phaseName: 'ranking' });
  }
  return buildResult(fineResult?.converged ?? false);
  ```
- [ ] **Test:** Add test in `rankVariants.test.ts`: "returns converged=false when triage budget exceeded and fineResult is null"
  - Mock: triage returns budgetError=true, fineResult stays null
  - Assert: no crash, result.converged === false, logger.warn called

#### C2: Fix LLM spending gate fast-path skipping monthly cap
- [ ] **File:** `src/lib/services/llmSpendingGate.ts` lines 72-77
- [ ] **Current:** Fast-path returns `estimatedCost` at line 77 without calling `checkMonthlyCap()`
- [ ] **Fix:** Add inline monthly cache check to fast-path. The `monthlyCache` is a single `CacheEntry<{ total: number; cap: number }> | null` (NOT a Map — it's shared across categories). Check it synchronously:
  ```typescript
  if (cached.dailyTotal + cached.reserved + estimatedCost < cached.dailyCap - headroom) {
    // Check monthly cap using cached value (no DB call on cache hit)
    if (this.monthlyCache && this.monthlyCache.expiresAt > Date.now()) {
      if (this.monthlyCache.value.total + estimatedCost >= this.monthlyCache.value.cap) {
        throw new GlobalBudgetExceededError(
          `Monthly budget exceeded: $${this.monthlyCache.value.total.toFixed(2)} of $${this.monthlyCache.value.cap.toFixed(2)} cap`,
          { category, monthlyTotal: this.monthlyCache.value.total, monthlyCap: this.monthlyCache.value.cap }
        );
      }
      // Both daily and monthly caches warm and under limit — fast return
      return estimatedCost;
    }
    // Monthly cache miss/expired — do NOT return; fall through to slow path
    // (slow path will call checkMonthlyCap with DB query and refresh cache)
  }
  ```
  **Key details:**
  - Uses `>=` operator (matching `checkMonthlyCap` semantics, not `>`)
  - Accesses `this.monthlyCache.value.total` / `.value.cap` (matching actual CacheEntry shape)
  - Does NOT use `break` (not in a loop) — simply omits `return` to fall through
  - Only returns on fast-path when BOTH daily AND monthly caches are warm and under limit
- [ ] **Test:** Add test in `src/lib/services/llmSpendingGate.test.ts` (NOT `__tests__/` subdirectory): "fast-path checks monthly cap before returning"
  - Mock: daily well under cap, monthly at limit
  - Assert: throws GlobalBudgetExceededError even on fast-path
- [ ] **Test:** Add test: "fast-path returns immediately when both daily and monthly caches are warm and under limit"
  - Assert: no DB query made, returns estimatedCost

#### C3: Fix generation failure silently ignored
- [ ] **File:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts` lines 159-168
- [ ] **Current:** `if (success) { ... } else if (budgetExceeded) { ... }` — no else clause
- [ ] **Fix:** Add else clause to log and continue (generation failure is non-fatal but should be logged):
  ```typescript
  } else {
    logger.warn('Generation failed (non-budget)', { iteration: iter, phaseName: 'generation' });
  }
  ```
- [ ] **Test:** Add test in `runIterationLoop.test.ts`: "logs warning when generation fails with non-budget error"
  - Mock: GenerationAgent.run returns { success: false, budgetExceeded: false }
  - Assert: logger.warn called, loop continues to ranking, no crash

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="rankVariants|llmSpendingGate|runIterationLoop"`

---

### Phase 2: High — Silent UI Error Swallowing (H1, H2)

#### H1: Add error handling to 5 admin list pages
- [ ] **File:** `src/app/admin/evolution/arena/page.tsx` lines 44-54
- [ ] **Fix:** Add error state and toast on fetch failure:
  ```typescript
  if (result.success && result.data) {
    setTopics(result.data);
  } else {
    toast.error(result.error?.message ?? 'Failed to load arena topics');
  }
  ```
- [ ] **Same fix for:** `runs/page.tsx` (63-83), `variants/page.tsx` (84-87), `invocations/page.tsx` (87-90), `experiments/page.tsx` (125-127)
- [ ] **Test framework:** Jest + React Testing Library (jsdom). Mock server actions with `jest.mock()`.
- [ ] **Test files (NEW):**
  - `src/app/admin/evolution/arena/__tests__/arena-page.test.tsx`
  - `src/app/admin/evolution/runs/__tests__/runs-page.test.tsx`
  - `src/app/admin/evolution/variants/__tests__/variants-page.test.tsx`
  - `src/app/admin/evolution/invocations/__tests__/invocations-page.test.tsx`
  - `src/app/admin/evolution/experiments/__tests__/experiments-page.test.tsx`
- [ ] **Test pattern for each:**
  ```typescript
  jest.mock('@evolution/services/arenaActions', () => ({
    getArenaTopicsAction: jest.fn().mockResolvedValue({ success: false, error: { message: 'DB error' } }),
  }));
  // render page, assert toast.error was called with 'DB error'
  ```

#### H2: Add error handling to ExperimentForm load
- [ ] **File:** `src/app/admin/evolution/_components/ExperimentForm.tsx` lines 76-90
- [ ] **Fix:** Add error toast when either promise fails:
  ```typescript
  if (!promptsRes.success) {
    toast.error(promptsRes.error?.message ?? 'Failed to load prompts');
  }
  if (!strategiesRes.success) {
    toast.error(strategiesRes.error?.message ?? 'Failed to load strategies');
  }
  ```
- [ ] **Test file (NEW):** `src/app/admin/evolution/_components/__tests__/ExperimentForm.test.tsx`
- [ ] **Test:** "shows error toast when getPromptsAction fails"

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="arena-page|runs-page|variants-page|invocations-page|experiments-page|ExperimentForm"`

---

### Phase 3: High — Metrics Stale Invalidation (H3, H4)

#### H3: Expand stale trigger to all metric types
- [ ] **File:** `supabase/migrations/` — create new migration e.g. `20260326000001_expand_stale_trigger.sql`
- [ ] **DDL strategy:** Use `CREATE OR REPLACE FUNCTION mark_elo_metrics_stale()` to update the trigger function in-place. The trigger binding (`CREATE TRIGGER ... AFTER UPDATE ... ON evolution_variants`) does NOT need to be recreated since only the function body changes.
- [ ] **Rollback plan:** If trigger causes issues, deploy a follow-up migration reverting to the original elo-only metric list. The trigger function is replaceable in-place.
- [ ] **Fix:** Full replacement function:
  ```sql
  CREATE OR REPLACE FUNCTION mark_elo_metrics_stale()
  RETURNS TRIGGER AS $$
  DECLARE
    v_strategy_id UUID;
    v_experiment_id UUID;
  BEGIN
    IF (NEW.mu IS DISTINCT FROM OLD.mu OR NEW.sigma IS DISTINCT FROM OLD.sigma)
       AND EXISTS (SELECT 1 FROM evolution_runs WHERE id = NEW.run_id AND status = 'completed')
    THEN
      -- Mark ALL run-level finalization metrics stale
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'run' AND entity_id = NEW.run_id
        AND metric_name IN ('winner_elo', 'median_elo', 'p90_elo', 'max_elo',
                            'total_matches', 'decisive_rate', 'variant_count');

      SELECT strategy_id, experiment_id INTO v_strategy_id, v_experiment_id
      FROM evolution_runs WHERE id = NEW.run_id;

      IF v_strategy_id IS NOT NULL THEN
        -- Mark ALL strategy-level propagated metrics stale
        UPDATE evolution_metrics SET stale = true, updated_at = now()
        WHERE entity_type = 'strategy' AND entity_id = v_strategy_id
          AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
            'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
            'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
            'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run');
      END IF;

      IF v_experiment_id IS NOT NULL THEN
        -- Mark ALL experiment-level propagated metrics stale
        UPDATE evolution_metrics SET stale = true, updated_at = now()
        WHERE entity_type = 'experiment' AND entity_id = v_experiment_id
          AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
            'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
            'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
            'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run');
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ```
- [ ] **Test (integration):** Use `supabase db reset` then run integration test via real Supabase:
  1. Create run + variant + metric rows (total_matches, variant_count)
  2. Update variant mu
  3. Assert: evolution_metrics rows for total_matches and variant_count have stale=true
  - **Test file:** `src/__tests__/integration/evolution-metrics-stale-trigger.integration.test.ts` (NEW)
  - **Pattern:** Follow existing integration test pattern from `evolution-metrics-recomputation.integration.test.ts`
  - **Isolation:** Use unique test data with `[TEST]` prefix, clean up in afterAll via `cleanupEvolutionData()`

#### H4: Remove elo-only whitelist in recomputation
- [ ] **File:** `evolution/src/lib/metrics/recomputeMetrics.ts` lines 74-75
- [ ] **Current:** `if (!['winner_elo', 'median_elo', 'p90_elo', 'max_elo'].includes(def.name)) continue;`
- [ ] **Fix:** Remove the whitelist filter — recompute ALL atFinalization metrics:
  ```typescript
  for (const def of getEntity('run').metrics.atFinalization) {
    const value = def.compute(ctx);
    if (value != null) {
      await writeMetric(db, 'run', runId, def.name as MetricName, value, 'at_finalization');
    }
  }
  ```
- [ ] **Performance note:** After deploying H3 (expanded trigger), more metrics will be marked stale per variant update. Recomputation is triggered lazily on next read, not eagerly. The `lock_stale_metrics` RPC uses `SKIP LOCKED` to prevent thundering herd. Acceptable for admin dashboard read frequency.
- [ ] **Test:** Add test: "recomputes total_matches and variant_count when stale"
  - Mock: stale metric rows including total_matches
  - Assert: writeMetric called for total_matches (not just elo)
- [ ] **Regression:** Update existing test in `recomputeMetrics.test.ts` that asserts only 4 elo metrics are written (this test currently validates the whitelist behavior and will FAIL after the fix — update assertion to expect all 7 finalization metrics)

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="recomputeMetrics|metrics"`

---

### Phase 4: High — Arena-Only Summary + Draw Handling (H5, H7)

#### H5: Write full run_summary for arena-only runs
- [ ] **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts` lines 107-116
- [ ] **Current:** `run_summary: { version: 3, stopReason: 'arena_only' }`
- [ ] **Fix:** Build a proper summary using arena pool data:
  ```typescript
  if (localPool.length === 0 && result.pool.length > 0) {
    const arenaOnlySummary = buildRunSummary(result, durationSeconds);
    arenaOnlySummary.stopReason = 'arena_only';
    await db.from('evolution_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      run_summary: arenaOnlySummary,
    }).eq('id', runId);
    return;
  }
  ```
- [ ] **Test:** Add test: "arena-only run produces full run_summary with matchStats and topVariants"
  - Assert: summary has version, stopReason, matchStats, topVariants, strategyEffectiveness

#### H7: Align draw handling between triage and fine-ranking
- [ ] **File:** `evolution/src/lib/pipeline/loop/rankVariants.ts` triage (lines 353-370) and fine-ranking (lines 522-526)
- [ ] **Current:** Triage code structure:
  1. Line 354: `if (match.confidence === 0)` → skips failed comparisons (continues loop)
  2. Line 362: `const isDraw = match.winnerId === match.loserId;` → handles draws
  3. But does NOT check `confidence < 0.3` for low-confidence partial results
  Fine-ranking (line 522): checks `match.confidence < 0.3 || match.result === 'draw'`
- [ ] **Fix:** ADD a `confidence < 0.3` check AFTER the `confidence === 0` skip block, keeping them separate:
  ```typescript
  // Line 354-359: KEEP existing confidence === 0 skip block (failed comparisons)
  if (match.confidence === 0) {
    consecutiveErrors++;
    // ... existing skip logic
    continue;
  }
  consecutiveErrors = 0;

  // NEW: Treat low-confidence (0 < confidence < 0.3) as draw (consistent with fine-ranking)
  const isDraw = match.confidence < 0.3 || match.result === 'draw' || match.winnerId === match.loserId;
  if (isDraw) {
    const [newA, newB] = updateDraw(entrantRating, oppRating);
    localRatings.set(entrantId, newA);
    localRatings.set(oppId, newB);
  } else {
    // existing decisive update logic
  }
  ```
  **Important:** Do NOT conflate failed-comparison skipping (confidence === 0) with low-confidence draw handling (0 < confidence < 0.3). They are separate concerns.
- [ ] **Test:** Add test: "triage treats confidence 0.15 as draw (consistent with fine-ranking)"
- [ ] **Test:** Add test: "triage still skips confidence 0 comparisons (failed LLM calls)"
- [ ] **Regression check:** Verify existing rankVariants tests still pass — this changes triage behavior for 0 < confidence < 0.3 matches

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="persistRunResults|rankVariants"`

---

### Phase 5: High — Entity Delete + Heartbeat (H6, H8, M11)

#### H6: Add TODO/comment for transactional delete (document, don't fix)
- [ ] **File:** `evolution/src/lib/core/Entity.ts` line 166
- [ ] **Fix:** Keep existing TODO but add a more detailed comment explaining the risk and mitigation. This is a known limitation — fixing requires Supabase RPC wrapping which is a larger refactor.
- [ ] **No test needed** — documenting existing limitation

#### H8: iterationsRun consequence of C3
- [ ] Already addressed by C3 fix (adding else clause). With the warning log, the incorrect iterationsRun becomes traceable.
- [ ] **No additional fix needed** — C3 resolves the root cause

#### M11: Add runner_id check to heartbeat update
- [ ] **File:** `evolution/src/lib/pipeline/claimAndExecuteRun.ts` lines 41-50
- [ ] **Current:** `.eq('id', runId)` — no runner ownership check
- [ ] **Note:** Research Round 14 marked this as false positive ("not needed — runs are uniquely claimed"). However, there IS a real edge case: after runner crash, a pending heartbeat callback can fire on a run that was re-claimed by another runner. Adding runner_id is a defense-in-depth measure.
- [ ] **Fix:** Pass runnerId to startHeartbeat, add ownership check, and check update result:
  ```typescript
  function startHeartbeat(db: SupabaseClient, runId: string, runnerId: string): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const { data } = await db.from('evolution_runs')
          .update({ last_heartbeat: new Date().toISOString() })
          .eq('id', runId)
          .eq('runner_id', runnerId)
          .select('id');
        if (!data || data.length === 0) {
          logger.warn('Heartbeat skipped: runner_id mismatch (run may have been re-claimed)', { runId, runnerId });
        }
      } catch (err) {
        logger.warn('Heartbeat update failed', { runId, error: String(err) });
      }
    }, 30_000);
  }
  ```
- [ ] Update caller to pass runnerId
- [ ] **Test:** Add test: "heartbeat update includes runner_id in query filter"
- [ ] **Test:** Add test: "heartbeat logs warning when runner_id mismatch (0 rows updated)"

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="claimAndExecuteRun|Entity"`

---

### Phase 6: Medium — Schema Drift (M3, M4, M5)

#### M3: Fix strategy_id nullability in Zod
- [ ] **File:** `evolution/src/lib/schemas.ts` line 110
- [ ] **Current:** `strategy_id: z.string().uuid().nullable().optional(),`
- [ ] **Pre-check (REQUIRED):** Verify actual DB state before making this change:
  ```sql
  SELECT COUNT(*) FROM evolution_runs WHERE strategy_id IS NULL;
  ```
  The migration `20260322000007` conditionally applies NOT NULL — it skips if NULL rows exist (lines 129-134). If production DB has NULL rows, this Zod change will break reads.
- [ ] **Fix (if DB has 0 NULL rows):** `strategy_id: z.string().uuid(),` (required, non-nullable)
- [ ] **Fix (if DB has NULL rows):** Keep `nullable()` but add a comment: `// DB may have legacy NULL rows; NOT NULL migration was conditional`
- [ ] **Verify:** `grep -r "strategy_id.*null" evolution/src/` — check all callers that pass strategy_id
- [ ] **Test:** Add schema-level test: `evolutionRunInsertSchema.parse({ ...validRun, strategy_id: null })` should throw (if NOT NULL enforced)

#### M4: Add missing variant columns to Zod schema
- [ ] **File:** `evolution/src/lib/schemas.ts` after line 147
- [ ] **Fix:** Add missing columns from convergence migration:
  ```typescript
  model: z.string().max(200).optional().nullable(),
  evolution_explanation_id: z.string().uuid().optional().nullable(),
  ```

#### M5: Add missing strategy columns to Zod fullDbSchema
- [ ] **File:** `evolution/src/lib/schemas.ts` — strategy fullDbSchema
- [ ] **Fix:** Add computed columns:
  ```typescript
  best_final_elo: z.number().nullable().default(null),
  worst_final_elo: z.number().nullable().default(null),
  ```

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="schemas"`

---

### Phase 7: Medium — Server Action Error Handling (M2, M7, M8)

#### M2: Check RPC error in cost lookup
- [ ] **File:** `evolution/src/services/evolutionActions.ts` lines 317-318
- [ ] **Current:** `const { data: costData } = await ctx.supabase.rpc(...);`
- [ ] **Fix:** Destructure and check error:
  ```typescript
  const { data: costData, error: costError } = await ctx.supabase.rpc('get_run_total_cost', { p_run_id: runId });
  if (costError) {
    logger.warn('Failed to fetch run cost', { runId, error: costError.message });
  }
  run.total_cost_usd = Number(costData) || 0;
  ```
- [ ] **Test:** Add test: "logs warning when get_run_total_cost RPC fails"

#### M7: Filter null keys in arena topic counting and cost analytics
- [ ] **File:** `evolution/src/services/arenaActions.ts` lines 88-92
- [ ] **Current:** `const tid = entry.prompt_id as string;`
- [ ] **Fix:** Skip null prompt_ids:
  ```typescript
  for (const entry of counts ?? []) {
    const tid = entry.prompt_id;
    if (!tid) continue;
    countMap.set(tid, (countMap.get(tid) ?? 0) + 1);
  }
  ```
- [ ] **File:** `evolution/src/services/costAnalytics.ts` lines 357-370
- [ ] **Fix:** Filter null userIds:
  ```typescript
  const userId = row.userid;
  if (!userId) continue;
  ```
- [ ] **Test:** Add tests: "skips entries with null prompt_id", "skips rows with null userId"

#### M8: Log batch update failures in cost backfill
- [ ] **File:** `evolution/src/services/costAnalytics.ts` lines 447-455
- [ ] **Current:** Silent failure — only increments counter on success
- [ ] **Fix:** Log individual failures:
  ```typescript
  if (updateError) {
    logger.warn('Cost backfill update failed', { recordId: record.id, error: updateError.message });
    totalFailed++;
  } else {
    totalUpdated++;
  }
  ```
- [ ] Return `totalFailed` count in result

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="evolutionActions|arenaActions|costAnalytics"`

---

### Phase 8: Medium — Type Safety + Race Condition (M1, M6, M12)

#### M1: Log variant loss on external status change (make visible, not silent)
- [ ] **File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts` lines 145-148
- [ ] **Current:** `logger?.warn('Finalization aborted...')` then `return;`
- [ ] **Fix:** Upgrade to `logger?.error(...)` and include pool size to indicate data loss:
  ```typescript
  if (!updatedRows || updatedRows.length === 0) {
    logger?.error('Finalization aborted: run status changed externally. Variants NOT persisted.', {
      phaseName: 'finalize',
      variantCount: localPool.length,
      runId,
    });
    return;
  }
  ```
- [ ] **Test:** Add test: "logs error with variant count when finalization aborted"

#### M6: Replace unsafe `as unknown as` with schema validation
- [ ] **File:** `evolution/src/services/evolutionActions.ts` line 235
- [ ] **Current:** `const typedRuns = (runs ?? []) as unknown as EvolutionRun[];`
- [ ] **Fix:** Use explicit field selection in the query instead of `SELECT *`, then remove cast:
  ```typescript
  const { data: runs, error, count } = await query.select('id, status, strategy_id, experiment_id, prompt_id, budget_cap_usd, error_message, created_at, completed_at, archived, pipeline_version, runner_id, run_summary, last_heartbeat', { count: 'exact' });
  ```
  Then: `const typedRuns = (runs ?? []) as EvolutionRun[];` (single cast, not double)
- [ ] **Same for:** `invocationActions.ts` line 91

#### M12: Add error_message to DashboardData.recentRuns
- [ ] **File:** `evolution/src/services/evolutionVisualizationActions.ts` lines 16-25
- [ ] **Fix:** Add `error_message` to recentRuns select query and type:
  ```typescript
  recentRuns: Array<{
    id: string;
    status: string;
    strategy_name: string | null;
    total_cost_usd: number;
    budget_cap_usd: number;
    explanation_id: number | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
  ```
- [ ] Update query to select `error_message` column
- [ ] Remove hardcoded `error_message: null` from dashboard page mapping

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="persistRunResults|evolutionActions|invocationActions|evolutionVisualization"`

---

### Phase 9: Medium — Cache + Timeout + Promise Cleanup (M9, M10)

#### M9: Document FIFO cache behavior (rename, don't reimplement)
- [ ] **File:** `evolution/src/lib/shared/computeRatings.ts` line ~79
- [ ] **Current:** Comment says "LRU cache"
- [ ] **Fix:** Update comment to "FIFO cache" to match actual implementation:
  ```typescript
  /** FIFO comparison cache. Evicts oldest entries when maxSize exceeded. */
  ```
- [ ] **No functional change** — FIFO is acceptable for this use case

#### M10: Clear setTimeout handles in Promise.race
- [ ] **File:** `evolution/src/lib/pipeline/infra/createLLMClient.ts` lines 65-70
- [ ] **Fix:** Capture and clear timeout handle (using `undefined` init, not `!` assertion):
  ```typescript
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const response = await Promise.race([
      rawProvider.complete(prompt, agentName, { model }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('LLM call timeout (60s)')), PER_CALL_TIMEOUT_MS);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    // ... record cost
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    // ... existing error handling
  }
  ```
- [ ] **Same for:** `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` lines 10-15
- [ ] **Test:** Use `jest.useFakeTimers()` and assert `jest.getTimerCount() === 0` after successful call

- [ ] Run: `npm run lint && npx tsc --noEmit && npm run build`
- [ ] Run: `npm run test -- --testPathPattern="computeRatings|createLLMClient|generateSeedArticle"`

---

### Phase 10: Final Verification

- [ ] Run full lint: `npm run lint`
- [ ] Run full tsc: `npx tsc --noEmit`
- [ ] Run full build: `npm run build`
- [ ] Run all unit tests: `npm run test`
- [ ] Run integration tests: `npm run test:integration`
- [ ] Verify no regressions in existing tests
- [ ] Commit all changes

## Rollback Plan

If any phase causes regressions:
- **Code fixes (Phases 1-2, 4-9):** Revert the specific commit. All fixes are isolated to individual files with no cross-phase dependencies.
- **H3 migration (Phase 3):** Deploy follow-up migration reverting `mark_elo_metrics_stale()` to original elo-only metric list. The `CREATE OR REPLACE FUNCTION` pattern allows in-place reversion.
- **M3 schema tightening (Phase 6):** If production DB has NULL strategy_id rows, revert Zod change. The pre-check step prevents this from being deployed incorrectly.
- **General:** Each phase runs lint/tsc/build/test before proceeding. If any phase fails verification, stop and fix before continuing.

## Testing

### Unit Tests (per phase)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — C1: fineResult null safety
- [ ] `src/lib/services/llmSpendingGate.test.ts` — C2: fast-path monthly check
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — C3: gen failure logging
- [ ] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — H4: non-elo recomputation
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — H5: arena-only summary, M1: variant loss logging
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — H7: draw consistency
- [ ] `evolution/src/services/evolutionActions.test.ts` — M2: RPC error check
- [ ] `evolution/src/services/arenaActions.test.ts` — M7: null prompt_id
- [ ] `evolution/src/services/costAnalytics.test.ts` — M7: null userId, M8: batch failures

### Component Tests (Jest + React Testing Library)
- [ ] `src/app/admin/evolution/arena/__tests__/arena-page.test.tsx` — H1: error toast on fetch fail
- [ ] `src/app/admin/evolution/runs/__tests__/runs-page.test.tsx` — H1: error toast on fetch fail
- [ ] `src/app/admin/evolution/variants/__tests__/variants-page.test.tsx` — H1: error toast on fetch fail
- [ ] `src/app/admin/evolution/invocations/__tests__/invocations-page.test.tsx` — H1: error toast on fetch fail
- [ ] `src/app/admin/evolution/experiments/__tests__/experiments-page.test.tsx` — H1: error toast on fetch fail
- [ ] `src/app/admin/evolution/_components/__tests__/ExperimentForm.test.tsx` — H2: load failure toast

### Integration Tests (Real Supabase)
- [ ] `src/__tests__/integration/evolution-metrics-stale-trigger.integration.test.ts` (NEW) — H3: all metric types marked stale
- [ ] Heartbeat runner_id check — M11 (unit test sufficient; no integration test needed)

### Database Verification
- [ ] Apply new migration for stale trigger fix
- [ ] Verify trigger fires correctly with `supabase db reset` or `supabase migration up`
- [ ] Verify RLS policies unchanged

### E2E Tests
- [ ] Run existing E2E suite: `npm run test:e2e` — verify no regressions in admin evolution pages

## Verification

### A) Automated Tests
- [ ] All existing tests pass (no regressions)
- [ ] New tests for each bug pass
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds

### B) Manual Verification
- [ ] Admin dashboard loads without errors
- [ ] Run detail page loads all tabs
- [ ] Arena page shows error toast on network failure (throttle in devtools)
- [ ] Experiment creation wizard handles load failure gracefully

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/metrics.md` - update stale invalidation docs to include all metric types
- `evolution/docs/rating_and_comparison.md` - update draw handling section for consistency
- `evolution/docs/cost_optimization.md` - document monthly cap check in fast-path
- `evolution/docs/architecture.md` - update arena-only run behavior
- `evolution/docs/reference.md` - update if file paths or function signatures change

## Review & Discussion

### Iteration 1 — Scores: Security 4/5, Architecture 3/5, Testing 3/5

**9 critical gaps identified and resolved:**

1. **C2 fast-path performance** (Security) — Fixed: use inline monthly cache check instead of full DB call. Preserves zero-async fast-path when caches are warm.
2. **M3 conditional NOT NULL** (Security + Architecture) — Fixed: added pre-check step to verify actual DB state before tightening schema.
3. **H7 draw fix misunderstands triage code** (Architecture) — Fixed: restructured fix to ADD confidence < 0.3 check AFTER the confidence === 0 skip block, not replace it.
4. **H3 migration DDL strategy** (Architecture) — Fixed: specified CREATE OR REPLACE FUNCTION (in-place), rollback plan, and full SQL.
5. **H4 existing test regression** (Architecture) — Fixed: added note to update existing recomputeMetrics.test.ts assertion.
6. **C2 test file path wrong** (Testing) — Fixed: corrected to `src/lib/services/llmSpendingGate.test.ts`.
7. **H3 trigger test has no concrete plan** (Testing) — Fixed: specified integration test file, pattern, and isolation strategy.
8. **No rollback plan** (Testing) — Fixed: added full Rollback Plan section.
9. **H1/H2 component test paths missing** (Testing) — Fixed: specified 6 test file paths and Jest+RTL framework.

### Iteration 2 — Scores: Security 4/5, Architecture 4/5, Testing 4/5

**3 critical gaps fixed:**
1. **C2 cache API mismatch** (Security) — Fixed: monthlyCache is `CacheEntry | null`, not a Map. Updated pseudocode to use `this.monthlyCache.value.total` / `.value.cap`.
2. **C2 operator inconsistency** (Security) — Fixed: changed `>` to `>=` to match `checkMonthlyCap` semantics.
3. **Line number drift** (Architecture) — Fixed: added Execution Notes section with guidance to search by code pattern, not line numbers.

### Iteration 3 — Scores: Security 4/5, Architecture 5/5, Testing 5/5

**1 critical gap fixed:**
1. **C2 error constructor signature** (Security) — Fixed: `GlobalBudgetExceededError` takes `(message: string, details?: Record<string, unknown>)`, not 3 positional args. Updated to use formatted message string + details object matching existing `checkMonthlyCap` pattern.

**Minor issues acknowledged (across all iterations):**
- C2 `break` in non-loop: removed, restructured to omit `return` on cache miss
- C2 estimatedCost in monthly check: fast-path is stricter than slow-path (fail-safe direction, acceptable)
- H4 test mock incomplete: noted need to update mock alongside assertion
- H5 schema validation: add `EvolutionRunSummaryV3Schema.parse()` for arena-only summary
- H7 variable rename: `isDraw` → `treatAsDraw` suggested for clarity
- H7 `winnerId === loserId` check: present in triage but not fine-ranking (minor asymmetry)
- H3 function name: `mark_elo_metrics_stale` now misleading, note for future rename
- M11 heartbeat self-stop: should clearInterval on mismatch (requires passing interval handle)
- H1/H2 test files: prefer adding to existing sibling test files over new `__tests__/` subdirectories

**Additional improvements from iteration 1:**
- C1: Added logger.warn when fineResult is null (not just silent default)
- M11: Resolved contradiction with research doc; added update result check
- M10: Changed from `clearTimeout(timeoutId!)` to safer `if (timeoutId) clearTimeout(timeoutId)` pattern
- H5: Added note to verify buildRunSummary handles arena-only case
- Added E2E test step to Phase 10 verification
