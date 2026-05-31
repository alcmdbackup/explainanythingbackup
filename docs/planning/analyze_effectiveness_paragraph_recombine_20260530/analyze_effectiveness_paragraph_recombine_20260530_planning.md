# Analyze Effectiveness Paragraph Recombine Plan

## Background
Analyze the effectiveness of `paragraph_recombine` invocations during evolution run `88b5e860-1690-41c4-9128-2c1fb85d5297` by querying Supabase staging. Produce a self-contained report covering cost vs projection, per-slot quality lift, per-rewrite drop rates, recombined-article Elo outcomes, and any persistence-health red flags.

## Requirements (from GH Issue #NNN)
analyze the effective of paragraph recombien invocations during run 88b5e860-1690-41c4-9128-2c1fb85d5297 by querying Supabase staging

## Problem
The team has shipped several large changes to `paragraph_recombine` recently — temperature ladder (Option A), paragraph-level judging (Option B1), hard-char-count + per-index temperature for index-0 rewrites (Options I3a/I3b), per-invocation cap drop $0.40 → $0.05 (Option F), and multi-dispatch (Option J). Without a focused analysis of an actual production-like run, we cannot say whether these changes are delivering quality lift or just changing the cost shape. Run `88b5e860-…` on staging is a concrete case to characterize.

**Scope expansion (2026-05-31, during /research)**: the analysis surfaced a user-visible projector bug. The wizard at `/admin/evolution/strategies/new` shows **Dispatch=1** for paragraph_recombine even when `maxDispatches=10` + `sourceMode=pool` + `qualityCutoff: topN:5` — but the runtime correctly dispatched K=5 on the analyzed run. The bug is localized to `projectDispatchPlan.ts`. Reproduced visually on staging (screenshot in `.playwright-mcp/dispatch-preview-bug-table-only.png`). Folding the fix + tests into THIS plan as Phase 7 rather than spawning a new project — same code area, same domain, same investigation context. The original analysis (Phases 1-6) remains analysis-only.

## Options Considered

- [x] **Option A: SQL-only analysis via `npm run query:staging`**: write a small set of read-only queries that pull invocations + variants + arena_comparisons + metrics, then synthesize the report. Pros: no new code, fastest path, fully reversible. Cons: ad-hoc — has to be re-run if the data shifts.
- [x] **Option B: One-shot analysis script (`evolution/scripts/analyzeRunEffectiveness.ts`)**: TypeScript script that takes a run-id arg and prints a structured report. Pros: re-usable for other runs, structured output. Cons: more upfront work for a one-off question.
- [x] **Option C (Recommended): SQL-driven REPL analysis, then commit findings into the research doc + this planning doc**: use `npm run query:staging -- "…"` ad-hoc, capture each query + result snippet in the research doc as evidence, then write the synthesized findings into the project. Pros: zero new code surface, fully traceable evidence, fits the spirit of the request ("analyze ... by querying"). Cons: requires manual transcription of query outputs.

Default: **Option C**. Promote to Option B only if a re-usable tool emerges as a natural side product.

## Phased Execution Plan

### Phase 1: Orient against the actual run
- [x] Run `npm run query:staging -- "SELECT id, status, created_at, completed_at, strategy_id, experiment_id, prompt_id, budget_cap_usd, error_message FROM evolution_runs WHERE id = '88b5e860-1690-41c4-9128-2c1fb85d5297'"` and record outcome.
- [x] Pull the strategy config: `SELECT id, name, config FROM evolution_strategies WHERE id = (SELECT strategy_id FROM evolution_runs WHERE id = '88b5e860-…')` — extract `iterationConfigs[]`, `generationModel`, `judgeModel`, `paragraphRewriteModel`, `maxDispatches`, `perInvocationCapUsd`, `sourceMode`, `qualityCutoff`, `rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`.
- [x] Confirm `agentType = 'paragraph_recombine'` is present in at least one `iterationConfigs[]` entry; note which iteration index(es).
- [x] Determine run vintage relative to migration `20260529000001` (timestamp comparison) — controls whether slot-variant rows are expected to have populated `parent_variant_ids` + `match_count`.

### Phase 2: Per-invocation cost + drop-rate + projector accuracy
- [x] List all paragraph_recombine invocations for this run:
  ```sql
  SELECT id, iteration, execution_order, cost_usd, duration_ms, success, error_message,
         (execution_detail->>'estimatedTotalCost')::numeric AS est,
         (execution_detail->>'estimatedTotalCostUpperBound')::numeric AS est_upper,
         (execution_detail->>'estimationErrorPct')::numeric AS err_pct,
         (execution_detail->'paragraph_rewrite'->>'cost')::numeric AS pr_rewrite_actual,
         (execution_detail->'paragraph_rewrite'->>'estimatedCost')::numeric AS pr_rewrite_est,
         (execution_detail->'paragraph_rank'->>'cost')::numeric AS pr_rank_actual,
         (execution_detail->'paragraph_rank'->>'estimatedCost')::numeric AS pr_rank_est
  FROM evolution_agent_invocations
  WHERE run_id = '88b5e860-1690-41c4-9128-2c1fb85d5297' AND agent_name = 'paragraph_recombine'
  ORDER BY iteration, execution_order;
  ```
- [x] For each invocation, expand `execution_detail.slots[*].rewrites[*]` into a count of status × dropReason × rewrite-index pivots. Use:
  ```sql
  SELECT inv.id, (slot->>'slotIndex')::int AS slot_idx,
         (rw->>'index')::int AS rewrite_idx,
         rw->>'status' AS status,
         rw->>'dropReason' AS drop_reason,
         (rw->>'temperature')::numeric AS temperature,
         (rw->>'costUsd')::numeric AS cost_usd
  FROM evolution_agent_invocations inv,
       LATERAL jsonb_array_elements(inv.execution_detail->'slots') AS slot,
       LATERAL jsonb_array_elements(slot->'rewrites') AS rw
  WHERE inv.run_id = '88b5e860-…' AND inv.agent_name = 'paragraph_recombine';
  ```
- [x] Compute aggregate drop-rate, drop-rate by index (especially index 0 — target <30% post-I3), and drop-rate by `dropReason` (length_under, length_over, no_bullets, no_lists, no_tables, no_h1, zero_sentences).
- [x] Compute `cap_utilization = actual_cost / perInvocationCap` per invocation (target ~10–20% post-F1 if median is $0.005 against $0.05 cap).

### Phase 3: Per-slot ranking outcomes + winner sources
- [x] For each invocation, pull `execution_detail.slots[*].ranking`:
  ```sql
  SELECT inv.id, (slot->>'slotIndex')::int AS slot_idx,
         (slot->'ranking'->>'comparisonCount')::int AS rank_comparisons,
         slot->'ranking'->>'status' AS rank_status,
         slot->'ranking'->>'winnerSlotVariantId' AS winner_id,
         slot->'ranking'->>'winnerSource' AS winner_source,
         (slot->>'spentUsd')::numeric AS slot_spent
  FROM evolution_agent_invocations inv,
       LATERAL jsonb_array_elements(inv.execution_detail->'slots') AS slot
  WHERE inv.run_id = '88b5e860-…' AND inv.agent_name = 'paragraph_recombine';
  ```
- [x] Tabulate `winnerSource` distribution: `this_invocation` vs `prior_invocation` vs `original`. Higher `this_invocation` share = the agent is actually improving paragraphs vs falling back.
- [x] Cross-check against persisted slot variants:
  ```sql
  SELECT v.id, v.variant_kind, v.elo_score, v.mu, v.sigma, v.arena_match_count, v.match_count,
         v.parent_variant_ids, v.agent_name, v.created_at
  FROM evolution_variants v
  WHERE v.variant_kind = 'paragraph' AND v.prompt_id IN (
    SELECT id FROM evolution_prompts WHERE prompt_kind = 'paragraph'
      AND prompt LIKE '[para] V%' -- refine to this run's parent prefix once known
  );
  ```
- [x] If run pre-dates migration `20260529000001` (2026-05-29): expect `parent_variant_ids = '{}'` and `match_count = 0` on slot rows — flag as known issue, not a regression.

### Phase 4: Article-level outcomes
- [x] Pull the recombined article variant(s):
  ```sql
  SELECT id, variant_kind, agent_name, elo_score, mu, sigma, arena_match_count,
         is_winner, parent_variant_ids, cost_usd, created_at
  FROM evolution_variants
  WHERE run_id = '88b5e860-…' AND variant_kind = 'article' AND agent_name = 'paragraph_recombine';
  ```
- [x] Resolve the parent's Elo (via `parent_variant_ids[1]`) and compute `elo_delta_vs_parent`.
- [x] Compare to the run-winner Elo and median pool Elo:
  ```sql
  SELECT id, agent_name, elo_score, is_winner FROM evolution_variants
  WHERE run_id = '88b5e860-…' AND variant_kind = 'article'
  ORDER BY elo_score DESC NULLS LAST;
  ```
- [x] Pull article-level match rows the recombined variant participated in:
  ```sql
  SELECT id, entry_a, entry_b, winner, confidence, created_at
  FROM evolution_arena_comparisons
  WHERE run_id = '88b5e860-…' AND (entry_a = '<recombined-id>' OR entry_b = '<recombined-id>');
  ```

### Phase 5: Run-level metrics + logs sanity check
- [x] Pull rollup metrics:
  ```sql
  SELECT metric_name, value, uncertainty, ci_lower, ci_upper, n, aggregation_method, source, stale
  FROM evolution_metrics
  WHERE entity_type = 'run' AND entity_id = '88b5e860-…'
    AND metric_name IN ('cost','paragraph_recombine_cost','cost_estimation_error_pct',
                        'estimated_cost','paragraph_rewrite_estimation_error_pct',
                        'paragraph_rank_estimation_error_pct',
                        'paragraph_slot_match_persist_failures','winner_elo','median_elo','max_elo',
                        'total_matches','decisive_rate','variant_count');
  ```
- [x] Pull warn/error logs and any `length_under` or `topic_arena_growth_warn` mentions:
  ```sql
  SELECT created_at, level, subagent_name, iteration, variant_id, message, context
  FROM evolution_logs
  WHERE run_id = '88b5e860-…' AND (level IN ('warn','error') OR message ILIKE '%length_%'
                                    OR message ILIKE '%topic_arena_growth%'
                                    OR message ILIKE '%persistSlotMatches%')
  ORDER BY created_at;
  ```

### Phase 6: Synthesis (analysis)
- [x] Write the effectiveness report into `findings.md` covering: cost vs projection, drop-rate breakdown, winnerSource distribution, recombined Elo lift, persistence-health flags, and a verdict on whether the I3/F1/J changes are paying off on this run.
- [x] Cross-link relevant evolution docs (`paragraph_recombine.md`, `cost_optimization.md#paragraph-recombine-cost`, `metrics.md`).

### Phase 7: Fix the projector preview bug

Scope: code change to `projectDispatchPlan.ts` + tests + minimal doc note. Do NOT bundle with effectiveness-related fixes (those need their own experiments / runs to justify).

**Approach (iteration-1 review notes):** Option F1 — inline helper. Originally floated Option F2 ("factor a shared helper out of `resolveEditingDispatchPlanner`") but per R2 review the existing `applyCutoffToCount` defaults to `DEFAULT_EDITING_ELIGIBILITY_CUTOFF: topN:10` when cutoff is undefined, which conflicts with paragraph_recombine's "undefined cutoff → no filter" runtime semantic. Sharing is not free. F1 only.

Add a helper `resolveParagraphRecombineEligibility({ sourceMode, qualityCutoff, poolSize }): number` in `projectDispatchPlan.ts` (or a sibling helper file) that mirrors `runIterationLoop.ts:1303-1318`:
- If `sourceMode !== 'pool'` → return `poolSize` (current behavior).
- If `qualityCutoff` undefined → return `poolSize` (current behavior).
- If `qualityCutoff.mode === 'topN'` → return `min(poolSize, qualityCutoff.value)` (schema enforces value ≥ 1 already per `evolution/src/lib/schemas.ts:602-603`; no extra `max(1, …)` needed).
- If `qualityCutoff.mode === 'topPercent'` → return `min(poolSize, max(1, ceil(poolSize * qualityCutoff.value / 100)))` (`max(1, …)` IS needed here because small percent on small pool can yield 0 via ceil-of-fractional).

Call it once at the top of the paragraph_recombine branch, store result as `eligibleCount`, replace `poolSize` at line 525 with `eligibleCount` in the `Math.min` ceiling. Add eligible-count handling to the sequential-top-up path too (~line 539-541 mirrors generate).

**Known projector limitation to document (R1 review note):** the projector's `poolSize` is monotonically grown via `poolSize += expectedTotalDispatch` from `ctx.initialPoolSize`, which INCLUDES arena-pre-loaded variants from `loadArenaEntries`. The RUNTIME filters arena entries at `runIterationLoop.ts:1291` (`pool.filter((v) => !v.fromArena)`) BEFORE applying the `qualityCutoff`. So when `ctx.initialPoolSize > 0` (any prompt with prior arena history), the projector's `eligibleCount` ceiling will exceed the runtime's actual eligibleParents count. This is a known projector over-estimate and is documented inline + noted in the PR description.

**Phase 7 tasks:**

- [x] **7.1 Failing test first — eligibility-binding case.** Add a unit-test case in `src/__tests__/integration/` OR `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` (whichever holds the existing projector tests; verify in 7.7) with the **iteration-1-corrected** bug-trigger config: `maxDispatches=10`, `sourceMode='pool'`, `qualityCutoff: { mode: 'topN', value: 5 }`, `poolSize=14`, **iter budget = $0.30** (wide budget so eligibility is the binding constraint, NOT budget — per R1 review of the original $0.03 number, the projector's `+184%`-over-estimated per-agent cost made BUDGET the binding cap, masking the eligibility bug). Assert: `expectedTotalDispatch === 5` (post-fix). Test must FAIL today (returns 1 because eligibility is silently 14 → other constraints bind).
- [x] **7.2 Budget-binding regression guard.** Add the ORIGINAL $0.03 budget case → expect `expectedTotalDispatch ≈ 1-2` (whatever the current behavior is) and ASSERT post-fix doesn't change it. This pins that the eligibility fix doesn't break the budget-binding path.
- [x] **7.3 sourceMode='seed' regression guard.** A test where `sourceMode='seed'` ignores eligibility entirely (current behavior).
- [x] **7.4 qualityCutoff=undefined regression guard.** `sourceMode='pool'` but no `qualityCutoff` → ceiling stays `poolSize`.
- [x] **7.5 topPercent test.** `qualityCutoff: { mode: 'topPercent', value: 50 }`. Test cases: `poolSize=14` → `ceil(7) = 7`; `poolSize=15` → `ceil(7.5) = 8` (asymmetric case confirms ceil semantic, guards against silent Math.round regression per R1).
- [x] **7.6 maxDispatches=1 regression guard.** With cutoff topN:5 and `maxDispatches=1`, the K ceiling still binds → expect 1.
- [x] **7.7 Implement Option F1** — edit `projectDispatchPlan.ts` paragraph_recombine branch per the spec above. Verify all 7.1-7.6 tests pass.
- [x] **7.8 DispatchPlanView render test** — add a render case where `expectedTotalDispatch > 1` for paragraph_recombine; assert the "Likely total" cell shows the count + a "parallel + top-up" annotation (today's only paragraph_recombine path collapses to a single number with no annotation). Per R2: assert the row's effective-cap badge text matches the actual binding constraint (e.g. "eligibility" or "safety_cap"), not just numeric values. Also add a NEGATIVE-case regression guard: when `expectedTotalDispatch === 1` the existing single-number rendering must still work (per R3).
- [x] **7.9 Manual stage repro pass.** After deploy, re-walk the wizard with the bug-trigger config. **Prerequisites** (per R3): staging URL `https://explainanythingstage.vercel.app/admin/evolution/strategies/new`, Vercel bypass token from `.env.local` `VERCEL_AUTOMATION_BYPASS_SECRET`, admin login (e.g. `abecha@gmail.com`). Confirm Dispatch + Likely total now show 5. Capture a new screenshot replacing `.playwright-mcp/dispatch-preview-bug-table-only.png`.
- [x] **7.10 (was "optional", now REQUIRED per R3)** Extend `src/__tests__/integration/evolution-paragraph-recombine-multi-dispatch.integration.test.ts` (NOTE corrected path — file lives in repo-root `src/`, not `evolution/src/`) to also assert that `getStrategyDispatchPreviewAction` (the wizard server-action layer) returns a plan whose paragraph_recombine row has `expectedTotalDispatch === 5` for the bug-trigger strategy. This is the runtime+projector+wizard alignment guard.

**Out of scope for Phase 7** (named to defend the boundary):
- The cost-projection accuracy bug (`paragraph_rewrite_estimation_error_pct = +184%`) is a SEPARATE issue. Phase 7 only fixes dispatch COUNT, not per-agent COST projection.
- The Cost Estimates tab "Slice Breakdown" silently omits paragraph_recombine (observed when navigating staging during repro). That's a separate observability gap — fold into Phase 8 (below) if user wants.
- `sentence_verbatim_ratio` NULL on paragraph_recombine, the $0.0034 cost accounting hole, slot-discard log surfacing, index-0 length_under prompt tuning, `maxDispatches=1` baseline experiment, and the llmCallTracking audit-gap regression are all itemized as follow-up projects in `findings.md` and NOT bundled here.

### Phase 8: Cost Estimates Slice Breakdown — include paragraph_recombine (V1, CONFIRMED)

**Verified by V1 agent**, high confidence.

**Root cause**: `evolution/src/services/costEstimationActions.ts:509-518`, line 517 has `.eq('agent_name', 'generate_from_previous_article')` — an explicit single-value allowlist that excludes paragraph_recombine. Comment on line 509 ("query GFSA invocations") reflects pre-K5 intent; per-run path was updated in K5 (`costEstimationHelpers.ts:38-69`) but strategy-level slice was not.

- [x] **8.1** Change `.eq('agent_name', 'generate_from_previous_article')` to `.in('agent_name', ['generate_from_previous_article', 'paragraph_recombine'])`. (Avoid sucking in `merge_ratings` which has no cost-estimate shape.)
- [x] **8.2 — explicit implementation sketch (R1 review note).** The current loop at lines 533-534 reads `execution_detail.tactic` for the slice key, which is undefined on paragraph_recombine rows (those use `execution_detail.detailType = 'paragraph_recombine'` and have no `tactic` field). Without special-casing, the slice key would fall back to `'unknown'`. Special-case by `agent_name`:
  ```ts
  const tactic = inv.agent_name === 'paragraph_recombine'
    ? 'paragraph_recombine'
    : (execution_detail?.tactic ?? 'unknown');
  ```
  Then use top-level `inv.cost_usd` (umbrella sum) and `execution_detail.estimationErrorPct` (top-level, not per-phase — already persisted by K5/G4) for the slice values. Single umbrella row per paragraph_recombine; do not split paragraph_rewrite vs paragraph_rank (matches `costEstimationHelpers.ts:38-69` K5 per-run shape — confirmed by R2).
- [x] **8.3** Update the comment at line 509 (currently "query GFSA invocations") to reflect inclusion of paragraph_recombine.
- [x] **8.4 Test choice (R3 review note)** — the existing `evolution/src/services/costEstimationActions.test.ts` (95 lines) deliberately avoids Supabase mocking and tests pure helpers only. Two options:
  - **(preferred)** Extract the slice-aggregation loop into a pure helper (e.g. `aggregateSliceFromInvocations(invs: AgentInvocation[]) → SliceBucket[]`) in `costEstimationHelpers.ts`, then unit-test it with a fixture array including one paragraph_recombine invocation alongside GFPA rows. Use `getByTestId('cost-slice-row-paragraph_recombine')` + explicit `expect(...).toHaveTextContent(...)` for row presence + numeric values (NOT a `.toMatchSnapshot()` per R3 — snapshot brittleness).
  - **(alternative)** Add an integration test in `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` (exists) that calls the real action against a seeded fixture. Heavier; only if the helper extraction is rejected.

### Phase 9: Configuration tab "Iterations" stat — fall back to `iterationConfigs.length` (V2, CONFIRMED)

**Verified by V2 agent**, high confidence.

**Root cause**: `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx:120` — `<ConfigRow label="Iterations" value={String(config.iterations ?? '—')} />`. Reads only the legacy top-level `config.iterations` field. V2 strategies (using `iterationConfigs[]`) never set the legacy field, so the row always renders `—`. The same component at line 155 correctly reads `iterationConfigs[]` for the *table* below — proving the component knows both shapes; line 120 is a missed update.

- [x] **9.1** One-line fix:
  ```tsx
  <ConfigRow label="Iterations"
    value={String(config.iterations ?? config.iterationConfigs?.length ?? '—')} />
  ```
- [x] **9.2** Render test (not snapshot per R3 — too brittle for one ConfigRow): render `StrategyConfigDisplay` with a V2 strategy fixture (no top-level `iterations`, `iterationConfigs.length === 2`); assert via `getByText('2')` in the Iterations row. Fallback ordering safety **empirically confirmed by R2**: `SELECT COUNT(*) FROM evolution_strategies WHERE config ? 'iterations' AND config ? 'iterationConfigs' AND status='active'` returns 0, so the legacy-first fallback can never shadow a real V2 length.

### Phase 10: `sentence_verbatim_ratio` populated on paragraph_recombine variants (V3, CONFIRMED)

**Verified by V3 agent**, high confidence.

**Root cause**: `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:325-334` builds the recombined `Variant` via `createVariant({...})` without first calling `sentenceVerbatimOverlap(parentText, recombinedText)`. Grep across the entire `paragraphRecombine/` directory returns **zero** references to `sentenceVerbatim*`. Persistence path at `persistRunResults.ts:288, 322` writes `v.sentenceVerbatimRatio ?? null` — so if the agent attaches, persistence lands it. DB confirmation: 0/5 populated on paragraph_recombine; 60-70% populated on peer GFPA tactics in the last 30 days.

- [x] **10.1** Add import: `import { sentenceVerbatimOverlap } from '../../../shared/sentenceOverlap';`
- [x] **10.2** Mirror GFPA pattern (`generateFromPreviousArticle.ts:259-267`) before the `createVariant` call:
  ```ts
  let sentenceVerbatimRatio: number | undefined;
  try {
    sentenceVerbatimRatio = sentenceVerbatimOverlap(parentText, recombinedText).ratio;
  } catch (err) {
    ctx.logger.warn('sentence-overlap compute failed; ratio stays NULL', {
      phaseName: 'recombine',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  ```
- [x] **10.3** Thread it via spread inside `createVariant`:
  ```ts
  ...(sentenceVerbatimRatio !== undefined && { sentenceVerbatimRatio }),
  ```
- [x] **10.4** Unit test in `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` (file exists, 554 lines; explicit path per R3 — no "adjacent" ambiguity) — feed a parent text + recombined output and assert the emitted Variant carries a `sentenceVerbatimRatio ∈ [0, 1]`. Document in the test that the SVR for paragraph_recombine variants is **inflated by preserved slots** (`winnerSource: 'original'` and `no_valid_rewrites` keep original sentences verbatim, so SVR is biased high vs the GFPA case where every word can change). Per R2: this is a semantic difference, not a bug — observational metric only.

### Phase 11: Surface paragraph_recombine slot-level discards to `evolution_logs` (V6 + V7, CONFIRMED)

**Verified by V6 and V7 agents**, both high confidence. Folding into one phase — they're the same logging gap class.

**Root cause**: `ParagraphRecombineAgent.ts` has **four** discard sites with no `logger.*` calls:
- L459-470 — `sync_failed` topic setup discard
- L605-615 — `slot_budget` self-abort discard
- L618-630 — `no_valid_rewrites` discard (Round 2 found 2 instances on invocation `46ab0b35`)
- L750-763 — `sync_failed` syncToArena discard
- Per-rewrite `dropReason ∈ {length_under, length_over, …}` (67 of 141 attempts on this run) — also unlogged. GFPA logs the equivalent at `generateFromPreviousArticle.ts:239-242` with `ctx.logger.warn(...)`.

DB confirms zero `evolution_logs` rows for these in run `88b5e860-…`.

- [x] **11.0 PRE-FIX (R2 critical finding): `slotLogger.child('slot.N')` is broken TODAY.** `ParagraphRecombineAgent.ts:429` calls `ctx.logger.child(`slot.${slot.paragraphIndex}`)` passing a string containing a literal `.`, which trips the dot-in-segment validator at `createEntityLogger.ts:64` (`if (seg.includes('.')) → null + warn`). The resulting `slotLogger` writes log rows with `subagent_name = null`. Confirmed empirically: zero `subagent_name LIKE 'slot.%'` rows for run `88b5e860-…`. Phase 11 would emit warns that aren't queryable by slot. **Fix the child() call first**: replace the string form with the array form `ctx.logger.child(['slot', String(slot.paragraphIndex)])` so '.' isn't inside any single segment. Mention this in the PR description.

  **Post-deploy verification (R3 iter-2)**: PR author runs the following query within 24h of merge against the next paragraph_recombine run on staging:
  ```sql
  SELECT COUNT(*) AS slot_log_rows
  FROM evolution_logs
  WHERE run_id = '<new_run_id>'
    AND subagent_name LIKE 'slot.%';
  ```
  **Acceptance**: `slot_log_rows >= 1` (any non-zero count proves the child path now writes a valid subagent_name). Compared to pre-fix where this query returned exactly 0 across 1,550+ log rows on run `88b5e860-…`. If the count is still 0, the array-form `child()` call may not be taking the path expected — investigate via `evolution_logs` JSON context to confirm slot-level emissions are happening. Record result in `_progress.md` Phase 11 verification entry.
- [x] **11.1 Helper refactor**: add `recordSlotDiscard(slotLogger, slotDetails, { slotIndex, failurePoint, context })` that both pushes to `slotDetails` AND emits `slotLogger.warn('paragraph_recombine: slot discarded', { slotIndex, failurePoint, context })`. Use at all four slot-level discard sites (`ParagraphRecombineAgent.ts:459-470, 605-615, 618-630, 750-763`).
- [x] **11.2 Aggregated per-rewrite warn**: after the `rewrites` array is built per slot (~line 601), if any drops occurred emit ONE warn per slot with `{ slotIndex, droppedCount, totalCount, reasonCounts: {length_under: N, length_over: M, …} }`. Per-rewrite would yield ~36 warns per invocation; per-slot aggregation yields ≤12 (and ≤120 at max-K config — acceptable bump per R1, but call out in PR description).
- [x] **11.3 Unit test**: fixture invocation where 1 slot's all-rewrites drop → assert exactly one `warn` log emit, **with `subagent_name === 'slot.N'`** (verifies the 11.0 pre-fix landed). Assert `reasonCounts` matches. Fixture invocation where 0 slots discard → assert no new warns. Note (per R2): per-slot warns enrich `evolution_logs` for dashboards/alerts only; they do NOT propagate to `subagent:slot.N.cost` metrics because `experimentMetrics.computeSubagentMetrics` (`evolution/src/lib/metrics/experimentMetrics.ts:633-650`) uses a fixed allowlist that doesn't include `slot.N`.

### Phase 12: Iteration-budget tracker `getPhaseCosts()` leaks per-iter scope (V5, CONFIRMED BIGGER BUG)

**Verified by V5 agent**, high confidence. **This is bigger than the original "accounting hole" framing — affects ALL multi-iteration strategies, not just paragraph_recombine.**

**Root cause**: `evolution/src/lib/pipeline/infra/trackBudget.ts:304-306` — `createIterationBudgetTracker.getPhaseCosts()` returns the **per-iteration** `iterPhaseCosts` accumulator, not run-cumulative phase totals. `createAgentCostScope` (line 78) binds `getPhaseCosts: shared.getPhaseCosts.bind(shared)`, inheriting this per-iter view. `createEvolutionLLMClient.ts:233-237` calls `writeMetricMax(runId, costMetricName, phaseCost)` after each LLM call. Because `writeMetricMax` uses `GREATEST` and the value is per-iter (not cumulative), **the largest per-iter contribution wins; smaller contributions from other iters are shadowed and never recorded.**

Concrete manifestation on run `88b5e860-…`:
- Iter 1 (GFPA × 14): writes `ranking_cost` = $0.009040 (iter-1 cumulative).
- Iter 2 (paragraph_recombine × 5): Step 6 article-level rank uses AgentName `'ranking'` (not the proxy-relabeled `'paragraph_rank'`); spend = $0.003388. Writes `writeMetricMax('ranking_cost', $0.003388)`.
- `GREATEST($0.009040, $0.003388) = $0.009040`. The $0.003388 is silently lost.

Generalized: any strategy with ≥2 iterations whose per-purpose AgentName labels overlap (e.g. two `generate` iters using `'generation'`, a `generate` + `paragraph_recombine` both producing `'ranking'` spend) will under-count the smaller iters' contribution.

**This is NOT a paragraph_recombine bug** — it surfaced on a paragraph_recombine run, but the buggy code is in shared budget infrastructure used by every agent. The earlier "false alarm" cleared cost reconciliation gap was the PER-INVOCATION reconciliation; this is a DIFFERENT reconciliation gap at the run-level rollup.

**Fix approach** (revised after iteration-1 review):

Option A — change `getPhaseCosts()` to delegate to `runTracker.getPhaseCosts()` — is correct in spirit but has a **critical interaction with the agent's own per-invocation accounting** that requires the snapshot-then-subtract pattern below (R1 finding). Option B (write-time sum-of-deltas) was rejected at draft time; revisit only if the snapshot pattern in 12.0 proves infeasible.

**Phase 12 tasks**:

- [x] **12.0 PRE-FIX — snapshot pattern for ParagraphRecombineAgent's per-invocation accounting (R1 critical, iter-1 + iter-2 findings).** Today, `ParagraphRecombineAgent.ts:247-250` computes `actualRewriteCost = totalPhaseCosts['paragraph_rewrite']` and persists `estimationErrorPct` into `execution_detail.paragraph_rewrite.estimationErrorPct`. Today this is per-iter cumulative (already wrong for K>1 in one iter). With 12.2 applied it becomes RUN-cumulative — so the K-th invocation's `actualRewriteCost` would equal the SUM across all K invocations + any prior iters' paragraph_rewrite spend, divided by THIS invocation's `projector.expected`. The error metric becomes off by a factor of K or more.

  **Fix (specify anchor + variable name)**: at the **TOP of `execute()`**, immediately after `invocationScope = ctx.costTracker` setup is established (approx. `ParagraphRecombineAgent.ts:183` — verify in 12.0.0 below) and **BEFORE ANY SPEND** (the L195 / L211 awaited LLM calls), capture:
  ```ts
  const phasesAtEntry = invocationScope.getPhaseCosts();
  ```
  Then rewrite the rollup sites at `:247-250` and `:268-269`:
  ```ts
  // Was: totalPhaseCosts['paragraph_rewrite']
  // Now: (totalPhaseCosts['paragraph_rewrite'] ?? 0) - (phasesAtEntry['paragraph_rewrite'] ?? 0)
  ```
  The 4 internal delta sites at `ParagraphRecombineAgent.ts:526-527, 534-535, 660-661, 704-705` already snapshot-then-subtract locally (per-rewrite / per-slot scope), so they are delta-invariant under the contract flip per R2 — no edits needed at those sites.

- [x] **12.0.0 Anchor verification**: in the same commit, add a line-comment at the entry snapshot site (`// PHASE_COSTS_ENTRY: pin invocation-scope baseline before any LLM call mutates the shared accumulator`). This anchors the invariant for grep + future refactors.

- [x] **12.0.1 Multi-dispatch K>1 interaction (R1 iter-2 critical).** Under multi-dispatch (K paragraph_recombine invocations in one iter), each invocation gets its OWN `AgentCostScope` (via `Agent.run()`), but `getPhaseCosts()` delegates to the shared run-level tracker. Post-12.2 contract flip + 12.0 snapshot pattern: invocation #N's `phasesAtEntry` captures all prior invocations' (1..N-1) accumulated paragraph_rewrite/paragraph_rank spend; subtracting gives invocation #N's OWN delta, which is exactly what `execution_detail.paragraph_rewrite.cost` should record. Document this interaction in TSDoc on the snapshot variable so the multi-dispatch invariant is grep-able. Add a Phase-12 test (12.5b below) explicitly asserting per-invocation `estimationErrorPct` correctness across K=3 invocations.

  Land 12.0 / 12.0.0 / 12.0.1 BEFORE 12.2 so the agent semantic stays correct across the contract flip.
- [x] **12.1 — COMPLETE caller audit (R1 + R3 critical).** Original draft claimed "only `createEvolutionLLMClient.ts` consumes it." Actual readers of `getPhaseCosts()` (across `iterTracker`, `invocationScope`, `slotScope` — all sharing the same backing accumulator):
  - `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:233-237` — per-call `writeMetricMax` (target of the fix; safe under run-cumulative semantic).
  - `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:247-250, 268-269` — invocation accounting (fixed in 12.0).
  - `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:526-527, 534-535, 660-661, 704-705` — per-rewrite/per-slot deltas using local snapshot-then-subtract; confirmed safe by R2 because both endpoints stay on the same scale (delta is invariant).
  - `evolution/src/lib/metrics/computations/finalization.ts:233-235` — `computeAgentCost` reads `costTracker.getPhaseCosts()` at run-finalization. Already expects run-cumulative semantics; this fix MAKES it correct (was wrong before).
  - `evolution/src/lib/metrics/types.ts:221` — type-binds `costTracker.getPhaseCosts()` in ExecutionContext; consumers transitively inherit the new contract.
  - **Subagent metrics are SAFE (R2)**: `experimentMetrics.computeSubagentMetrics` reads from `execution_detail`, NOT from `getPhaseCosts()`. Zero impact.
  - **AgentCostScope contract is PRESERVED (R2)**: `createAgentCostScope` (`trackBudget.ts:67-87`) only binds methods; doesn't reimplement `getPhaseCosts`. Delegating in `iterTracker` propagates to all nested scopes transparently. No B012 violation.
- [x] **12.2** Edit `createIterationBudgetTracker.getPhaseCosts()` (`trackBudget.ts:304-306`) to delegate to `runTracker.getPhaseCosts()`. **Also flip the alias** `getSubagentCosts()` (per R2 — alias at `trackBudget.ts:309` in `createIterationBudgetTracker` AND at line 80 in `createAgentCostScope`); both must move in lockstep or strict regression.
- [x] **12.3** Add `getIterationPhaseCosts()` method to `createIterationBudgetTracker` returning the OLD per-iter shape, for any future caller that genuinely needs per-iter (none today). Document the difference in TSDoc on `V2CostTracker`.
- [x] **12.4 Flip existing unit tests (R1 + R3 critical).** `evolution/src/lib/pipeline/infra/trackBudget.test.ts:360-381` asserts the OLD per-iter semantics ("getPhaseCosts tracks iteration-level costs independently" / "two-iter independence"). Update these to assert the NEW run-cumulative semantics, AND add a new test alongside them naming the contract: `getPhaseCosts` is run-cumulative; `getIterationPhaseCosts` is per-iter.
- [x] **12.5 New regression tests**: unit tests in `trackBudget.test.ts` (direct fixtures already at lines 309/317/325 per iter-1 review):

  **12.5a — basic run-cumulative semantic**: create a run-tracker, derive iter trackers for iter-1 and iter-2, spend $0.01 of `'ranking'` in iter 1, $0.005 of `'ranking'` in iter 2, assert that calling `getPhaseCosts()['ranking']` from iter 2's scope returns $0.015 (run-cumulative), not $0.005 (per-iter).

  **12.5b — SUM-not-MAX pin via writeMetric spy (R3 iter-2: pick one — spy)**: use a jest spy on `writeMetric` (not "spy OR fake DB"). After both per-purpose spends and the LLM-client writeMetricMax calls, assert the writeMetric spy received the increment for ranking_cost = $0.015, not $0.01. This pins both the contract and the write-time semantic.

  **12.5c — Multi-dispatch K>1 per-invocation accounting (R1 iter-2 critical)**: simulate 3 paragraph_recombine invocations in the same iter (each one ~$0.005 of `paragraph_rewrite` + $0.001 of `paragraph_rank`). After each invocation's `Agent.run()` completes, assert that the invocation's `execution_detail.paragraph_rewrite.cost` equals THIS invocation's $0.005 (not cumulative $0.005, $0.010, $0.015 across the K runs). This is the regression guard for 12.0 + 12.0.1.
- [x] **12.6 Kill switch — naming + tristate (R2 + R3 iter-2 critical).** Add env-var flag using the established `EVOLUTION_*_ENABLED` convention from `evolution/docs/reference.md` Kill-switches table:
  ```
  EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED
  ```
  Use the established string-contract: `process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED !== 'false'`. Tristate matrix:

  | Env value | Boolean | Behavior |
  |---|---|---|
  | unset | `!== 'false'` → `true` | **NEW (run-cumulative)** — the fixed correct behavior |
  | `'true'` | `!== 'false'` → `true` | NEW (run-cumulative) |
  | `'false'` | `!== 'false'` → `false` | OLD per-iter (kill switch flipped on; reverts to buggy behavior for rollback) |
  | any other value | `!== 'false'` → `true` | NEW (run-cumulative) |

  Critical: this is `!== 'false'`, NOT `=== 'true'`. With `=== 'true'`, unset would default to OLD buggy behavior — exactly the inverted-default bug R3 caught in iter-2. **Both** `getPhaseCosts()` and `getSubagentCosts()` (the Phase-4 alias) must gate on the same flag — they share semantics, flipping one without the other creates inconsistency.

  Document in `evolution/docs/reference.md` Kill-switches table.

- [x] **12.6.1 Kill switch tests (R3 iter-2)**: explicit tristate matrix asserted in `trackBudget.test.ts`:
  - **Unset case**: `delete process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED` → `getPhaseCosts()` returns run-cumulative AND `getSubagentCosts()` returns run-cumulative.
  - **`'true'` case**: same as unset.
  - **`'false'` case**: both methods revert to per-iter accumulator.
  - **Sanity assertion**: `getPhaseCosts()` and `getSubagentCosts()` always return the SAME values regardless of flag state (alias invariant).
- [x] **12.7 Backfill decision: leave as-is (R1 + R2 confirmation).** Per-invocation `evolution_agent_invocations.cost_usd` is the documented authoritative source (`evolution/docs/cost_optimization.md` + `findings.md` False alarms §2). Historic per-purpose metric under-count is bounded (max iter wins; others shadowed); analytical bias is small (~$0.003/run in the studied case). Backfill complexity vastly exceeds value. **No backfill task**.
- [ ] **12.8 Post-deploy verification — explicit acceptance + ownership + fallback (R3 iter-2 critical).**

  **Owner**: PR author. The author MUST run this check within 24h of merging the PR (calendar-bound, not "first-noticed").

  **Trigger candidate**: a new multi-iteration completed run on staging that includes paragraph_recombine OR a run with overlapping per-purpose labels (e.g. two `generate` iters using `'generation'`). The author submits the strategy via the wizard if no such run exists organically within 24h.

  **Query 1 (paragraph_recombine_cost vs invoc sum)**:
  ```sql
  SELECT m.value AS metric_value,
         (SELECT SUM(cost_usd) FROM evolution_agent_invocations
          WHERE run_id = '<new_run_id>' AND agent_name='paragraph_recombine') AS invoc_sum,
         m.value - (SELECT SUM(cost_usd) FROM evolution_agent_invocations
                    WHERE run_id = '<new_run_id>' AND agent_name='paragraph_recombine') AS diff
  FROM evolution_metrics m
  WHERE m.entity_type='run' AND m.entity_id='<new_run_id>'
    AND m.metric_name='paragraph_recombine_cost';
  ```
  **Acceptance**: `|diff| < $0.001`.

  **Query 2 (broader bug class — ranking_cost across iters)**: catches the iter-overlap shadowing for `'ranking'` AgentName used by both GFPA generate + paragraph_recombine. Run only on a run where both iters generated ranking spend:
  ```sql
  SELECT m.value AS metric_value,
         (SELECT SUM(cost_usd) FROM evolution_agent_invocations
          WHERE run_id = '<new_run_id>' AND agent_name IN ('generate_from_previous_article', 'paragraph_recombine')) AS overlap_sum_approx
  FROM evolution_metrics m
  WHERE m.entity_type='run' AND m.entity_id='<new_run_id>'
    AND m.metric_name='ranking_cost';
  ```
  (Approximate because `evolution_agent_invocations.cost_usd` doesn't split by AgentName — but the rollup `ranking_cost` should be ≤ this sum and proportionally non-trivial. If `ranking_cost` is < 50% of overlap_sum, that's a smell.)

  **Failure action** (`|diff| ≥ $0.001` OR `ranking_cost < 50% of overlap_sum`):
  1. Set `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED=false` on the affected runner (Vercel preview or staging tmux dev runner) within 1h.
  2. Re-run the same strategy; verify metric value reverts to pre-fix shape (smaller, shadowed).
  3. If revert restores stability: open `investigate_phase12_regression_<date>` project; do NOT revert the PR (kill switch is the safe rollback).
  4. If kill switch doesn't help: revert the PR.

  **No-run-found fallback**: if no multi-iter paragraph_recombine run occurs naturally within 24h, the PR author submits a strategy via `/admin/evolution/start-experiment` matching the bug-trigger config (strategy `ce9799fa-…` is already available on staging); set `maxDispatches=1` for the simplest case. Run-id captured from the wizard output.

  **Recording**: post-verification result (queries + numeric outputs + accept/reject decision) appended to `_progress.md` under "Phase 12 post-deploy verification."
- [x] **12.9 Doc updates — expanded list (R2 critical).** The plan originally listed only two docs; review caught 4 more locations whose comments currently assert the OPPOSITE invariant (per-iter "cumulative" claim that is true post-fix but false today). All must be updated in lockstep with the code:
  - `evolution/docs/paragraph_recombine.md` — Cost-metrics section
  - `evolution/docs/cost_optimization.md` — Per-purpose cost split + writeMetricMax notes
  - `evolution/docs/metrics.md:119` — currently says paragraph_recombine_cost is "MAX-safe because both accumulators are run-cumulative (monotonic)" — false today, true post-fix.
  - `evolution/src/lib/core/agentNames.ts:91-93` — code comment asserts the same false invariant.
  - `evolution/docs/architecture.md` — references iter-budget tracker
  - `docs/docs_overall/debugging.md` Debugging Cost Accuracy section — add a "Bug C: per-purpose under-count across iters (fixed by ...)" subsection
  - `docs/planning/investigate_paragraph_rewrite_cost_undershoot_evolution_20260529/` — mark Phase 7a/K1 (projector dispatch) DELIVERED with a backref.

### Phase 13 (NOT a bug — flagged for separate calibration project)

V4 verification confirmed `paragraph_rewrite_estimation_error_pct = +184%` is **not a code bug** but a documented modeling drift:
- `PARAGRAPH_REWRITE_PROMPT_OVERHEAD = 800` chars is ~1.6× under the true ~1300-char template.
- `chars / 4` token-density assumption in `createEvolutionLLMClient.ts:26-27` over-counts; Gemini-2.5-flash-lite on markdown-heavy paragraph prose runs closer to ~2.5-3 chars/token.
- `COST_CALIBRATION_ENABLED` is `false` by default (the calibration loader infrastructure is designed for exactly this drift but unflipped on staging/prod).

**NOT bundled here**. Open `recalibrate_paragraph_recombine_cost_projection_20260601` (or similar) for the calibration flip + constant-bump decision. Cross-reference V4 verification report.

### Out-of-scope: V8 (`llmCallTracking` audit-gap regression) — separate investigation needed

V8 verification confirmed the regression is **active and broader than paragraph_recombine**:
- 0 evolution rows in `llmCallTracking` in last 7 days (vs 5,538 healthy non-evolution rows). Latest evolution row: 2026-02-22 17:20:50 UTC, 98 days ago.
- All three wiring layers (`claimAndExecuteRun.ts:194-222`, `Agent.ts:130-141`, `ParagraphRecombineAgent.ts:441-449`) look correct.
- Likely root cause: silent fire-and-forget failure (`saveTrackingAndNotify` swallows errors unless `EVOLUTION_TRACKING_STRICT=true`). Probable FK/RLS issue on `evolution_invocation_id` or `EVOLUTION_SYSTEM_USERID` (`00000000-0000-4000-8000-000000000001`).

**Open `investigate_evolution_llmCallTracking_audit_gap_regression_20260601`**. Diagnostic plan: run one dev runner against staging with `EVOLUTION_TRACKING_STRICT=true` to capture the throw, OR grep staging runner journal for `"LLM call tracking save failed"`. Once failure mode is known, fix is small.

## Testing

Phases 7-12 introduce code; Phases 1-6 (the analysis) do not.

### Unit Tests
- [x] **Phase 7**: `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` (789 lines exists) — six new cases per 7.1-7.6.
- [x] **Phase 7**: `evolution/src/components/evolution/DispatchPlanView.test.tsx` (272 lines exists) — one new positive case per 7.8 PLUS a negative-case regression guard (per R3) confirming `expectedTotalDispatch === 1` still renders correctly via the legacy single-number path.
- [x] **Phase 8**: Pure-helper unit test (preferred per R3) on the extracted `aggregateSliceFromInvocations` helper. Fixture array includes one paragraph_recombine invocation + at least one GFPA invocation; assert both surface as slice rows via `getByTestId('cost-slice-row-paragraph_recombine')` + explicit text assertions (NOT `.toMatchSnapshot()`).
- [x] **Phase 9**: Render test (not snapshot) on `src/app/admin/evolution/_components/StrategyConfigDisplay.test.tsx` (52 lines exists) — V2 strategy fixture (`iterationConfigs.length === 2`, no top-level `iterations`); assert `getByText('2')` in the Iterations row.
- [x] **Phase 10**: Unit test in `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` (554 lines exists) — fixture parent + recombined output; assert emitted Variant has `sentenceVerbatimRatio ∈ [0, 1]`.
- [x] **Phase 11**: Unit test on `ParagraphRecombineAgent` discard paths — one slot's all-rewrites drop → assert one `warn` log emit with reasonCounts JSON AND **`subagent_name === 'slot.N'`** (verifies 11.0 pre-fix). Zero discards → no warns.
- [x] **Phase 12**: Unit tests in `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — (a) flip existing tests at lines 360/381 to assert run-cumulative semantics; (b) new tests per 12.5a/12.5b/12.5c (basic run-cumulative + SUM-not-MAX via writeMetric spy + multi-dispatch K>1 per-invocation accounting); (c) new tests per 12.6.1 asserting the `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED` tristate matrix (unset/`'true'`/`'false'`) for BOTH `getPhaseCosts()` and `getSubagentCosts()`, including the alias-invariant sanity assertion.

### Integration Tests
- [x] **Phase 7 (REQUIRED — promoted from optional per R3)**: extend `src/__tests__/integration/evolution-paragraph-recombine-multi-dispatch.integration.test.ts` (237 lines, **NOTE corrected path**: repo-root `src/__tests__/integration/`, NOT `evolution/src/__tests__/integration/`) to assert `getStrategyDispatchPreviewAction` returns a plan whose paragraph_recombine row has `expectedTotalDispatch === 5` for the bug-trigger strategy. Pins runtime + projector + wizard-server-action consistency in CI.
- [x] **Phase 12 (required)**: integration test simulating a 2-iteration strategy where iter 2 contributes less ranking_cost than iter 1; assert run-level `ranking_cost` equals SUM not MAX of per-iter contributions. **Fixture work scope (R3)**: existing integration test mocks trackBudget heavily (lines 68-90) — cannot simply extend it. Either (a) author a new integration test file `evolution-multi-iter-cost-rollup.integration.test.ts` using real `trackBudget` + in-memory `writeMetric` spy, OR (b) plug into `service-test-mocks.ts` harness with a real-tracker variant. The new test lands in `:evolution` shard (matches `evolution-` regex), runs on `/finalize` for paragraph_recombine-touching PRs; do NOT route into `:critical` (too slow for 3-min budget).

### E2E Tests
- [x] **Phase 7**: None proposed. The Playwright repro on stage IS the verification.
- [x] **Phases 8-12**: None proposed. Unit + integration coverage sufficient.

### Manual Verification
- [x] **Phase 7**: walk the wizard with the bug-trigger config (local dev OR stage with bypass token) and confirm Dispatch / Likely total now show 5.
- [x] **Phase 8**: navigate to `/admin/evolution/strategies/ce9799fa-…?tab=cost-estimates` and confirm paragraph_recombine appears as a Slice Breakdown row.
- [x] **Phase 9**: navigate to `/admin/evolution/strategies/ce9799fa-…?tab=config` and confirm "Iterations: 2".
- [x] **Phase 10**: on a fresh run with paragraph_recombine + a single dispatched parent, query `SELECT sentence_verbatim_ratio FROM evolution_variants WHERE agent_name='paragraph_recombine' AND created_at > ...` — confirm non-NULL.
- [x] **Phase 11**: on a fresh run, induce a slot-level `no_valid_rewrites` (e.g. tiny seed article, high temp); query `evolution_logs` for warn-level rows matching the slot.
- [x] **Phase 12**: on a fresh run with two iterations both producing ranking spend (e.g. generate iter 1 + paragraph_recombine iter 2), assert run-level `ranking_cost` ≈ SUM of per-iter actuals (within rounding), not MAX.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Phase 7.9 — staging repro of fixed wizard with bug-trigger config. New screenshot replacing `.playwright-mcp/dispatch-preview-bug-table-only.png`.

### B) Automated Tests
- [x] `npx jest evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — six new cases pass after fix, the bug-trigger case fails before fix.
- [x] `npx jest evolution/src/components/evolution/DispatchPlanView.test.tsx` — new render case passes.

## Documentation Updates

- [x] `evolution/docs/paragraph_recombine.md` — the Multi-dispatch section already documents the eligibility semantic. Cross-reference Phase 7 fix from the Multi-dispatch section's Note block so future readers know the projector now matches the runtime.
- [x] `evolution/docs/cost_optimization.md` Paragraph-Recombine Cost section — add a line clarifying that the projector now honors `qualityCutoff` for dispatch counting.
- [x] `docs/planning/investigate_paragraph_rewrite_cost_undershoot_evolution_20260529/` — mark Phase 7a/K1 as DELIVERED with a backref to this project's commit. (That plan claimed it landed but the projector portion never did.)
- [x] `docs/docs_overall/debugging.md` "Debugging paragraph_recombine cost-undershoot" — already references this projector wiring; no edits needed if the K1 backref above lands.

## Review & Discussion
_To be populated by /plan-review if invoked._
