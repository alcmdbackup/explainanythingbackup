# Find Improvements Evolution Implementation Plan

## Background
Comprehensive audit of the evolution pipeline identified 132 findings across 5 rounds of research. After source code verification (Round 5), **62 findings confirmed** as still present (3 critical, 14 high, 32 medium, 13 low), 10 already fixed, 5 invalid, 2 partially valid. 54 findings remain unverified. This plan addresses all confirmed and partially valid findings in priority order.

*Note: R5 research doc lists "61 confirmed" and "12 low" but the Low table has 13 entries (EXP-4 miscounted). Actual total is 62.*

*Note: CORE-1 (Strategy Rotation Index OOB) was classified as HIGH in R5 but verified during plan review as a **false positive**. The `-1` initialization in `transitionToCompetition()` is intentional — `beginIteration()` increments it to `0` before `getPhaseConfig()` is called, and `getResumeState()` guards with `Math.max(0, ...)`. Removed from plan. Adjusted confirmed count: 61 confirmed + 2 partial = 63 findings addressed.*

## Requirements (from GH Issue #436)
- Fix all confirmed bugs and improvement opportunities in the evolution pipeline
- Prioritize security, data integrity, and correctness over polish
- Each phase should be independently deployable and testable

## Problem
The evolution pipeline has 3 critical bugs (cron auth bypass, migration constraint conflict, missing budget validation), 13 high-priority correctness issues (crashes, data corruption, resource leaks), and 47 medium/low issues affecting agent accuracy, UI safety, and performance. The most impactful are: fail-open cron auth allowing unauthenticated access, missing pre-queue budget validation causing wasted LLM spend, and missing transaction in applyWinner causing data corruption.

## Prerequisites

1. **Merge `fix/97fca15e` branch first** — BUG-1 (strategy config not propagated) and BUG-2 (off-by-one iteration) are already fixed on that branch. Several Phase 2 fixes depend on this merged state. Verify branch status: `git branch -a | grep 97fca15e`.
2. **Phase ordering is sequential** — Each phase should be merged before the next starts. `evolutionActions.ts` is touched in Phases 1, 2, 5, and 7. `supervisor.ts` is touched in Phase 5 only (CORE-4). `pipeline.ts` is touched in Phases 2 and 7.
3. **Migration immutability** — Never edit existing migration files. All schema changes require NEW migration files.

## Options Considered

**Option A: Fix everything in one large PR** — Rejected. Too many changes across too many files; impossible to review and risky to deploy.

**Option B: One PR per finding** — Rejected. 63 PRs is excessive overhead. Many findings share files and can be grouped.

**Option C: Phased PRs grouped by subsystem and priority** — Selected. Groups related fixes into 7 phases, each independently deployable. Critical/high fixes first, medium/low later. Each phase touches a coherent set of files.

## Phased Execution Plan

---

### Phase 1: Security & Safety (Critical)
**Goal:** Eliminate security vulnerabilities and data integrity risks.
**Files touched:** 4 route files, 1 new migration, 1 service file
**Shared files:** `evolutionActions.ts` also touched in Phases 2, 5, 7. `evolution-runner/route.ts` — check unverified HIGH-3 (heartbeat error swallowing) and `evolution-watchdog/route.ts` — check unverified MED-7 (batch update race) while in these files.

| ID | Finding | File | Fix |
|----|---------|------|-----|
| BUG-4 | Cron Auth Bypass (Fail-Open) | `src/app/api/cron/evolution-runner/route.ts:19`, `evolution-watchdog/route.ts:15`, `content-quality-eval/route.ts:17` | Change `if (cronSecret && ...)` to fail-closed: return 500 if `CRON_SECRET` not configured. Extract shared `requireCronAuth()` helper to avoid triplicating logic. |
| SCRIPT-1 | Migration NOT NULL Conflict | `supabase/migrations/20260207000008_enforce_not_null.sql:26-30` | Create a **new** migration (do NOT edit existing file) that reverts: `ALTER TABLE content_evolution_runs ALTER COLUMN prompt_id DROP NOT NULL; ALTER COLUMN strategy_config_id DROP NOT NULL;` |
| COST-1 | No Pre-Queue Budget Validation | `src/lib/services/evolutionActions.ts:185-216` | After `estimateRunCostWithAgentModels()`, compare estimated cost to `budgetCap`; reject if `estimatedCostUsd > budgetCapUsd`. Handle the no-strategy-config case (when `estimatedCostUsd` is null, skip validation). |

**Tests:**
- Unit: cron auth returns 500 when `CRON_SECRET` undefined — **update existing test** at `route.test.ts:184-197` which currently asserts 200 (fail-open) to assert 500
- Unit: cron auth returns 401 when `CRON_SECRET` is set but header doesn't match
- Unit: `queueEvolutionRunAction` rejects when estimate > budget cap
- Unit: `queueEvolutionRunAction` accepts when no strategy config (estimate is null)
- Manual (staging): apply new migration against existing data with NULL prompt_id/strategy_config_id values

**Rollback SQL** (if SCRIPT-1 migration needs reverting):
```sql
ALTER TABLE content_evolution_runs ALTER COLUMN prompt_id SET NOT NULL;
ALTER TABLE content_evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;
```

---

### Phase 2: Core Pipeline Correctness (High + Medium)
**Goal:** Fix data corruption and checkpoint integrity in the pipeline core.
**Files touched:** evolutionActions.ts, state.ts, types.ts, pipeline.ts (+ new migration for applyWinner RPC)
**Shared files:** `pipeline.ts` also touched in Phase 7 (DB-4, DB-5). `evolutionActions.ts` also touched in Phases 5, 7. While editing `pipeline.ts`, check unverified ERR-4 (variant persistence silent fail).

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| HIGH-2 | HIGH | Missing Transaction in applyWinner | `evolutionActions.ts:423-512` | Create a new Postgres RPC function (`apply_evolution_winner`) in a new migration that performs the 4 DB writes atomically (content_history insert, explanations update, variants winner flag, run status). Call via `supabase.rpc('apply_evolution_winner', {...})`. The `triggerPostEvolutionEval` is an async JS call (fire-and-forget), NOT a DB write — it stays outside the RPC, called after RPC success. Include SCRIPT-7 conditional: skip content_history when `explanation_id IS NULL`. Supabase JS does not support client-side transactions. |
| SCRIPT-2 | HIGH | NULL Variant Content Before Apply | `evolutionActions.ts:442-473` | Add `if (!variant.variant_content?.trim()) throw new Error('Empty variant content')` before update. Include in the RPC function if HIGH-2 uses RPC approach. |
| COST-6 | HIGH | Checkpoint Missing CostTracker State | `state.ts:79-103`, `pipeline.ts` | Serialize only `totalSpent` into checkpoint (NOT reservations — ephemeral runtime state). Injection path: spread `costTrackerTotalSpent` INSIDE the `state_snapshot` JSONB object (same pattern as `supervisorState` which is spread into `state_snapshot` at pipeline.ts:1233, NOT as a separate column). On resume, read from `state_snapshot.costTrackerTotalSpent` and pass to CostTracker constructor. Extend `SerializedPipelineState` in `types.ts` with optional `costTrackerTotalSpent?: number` (default 0 for backward compat). |
| ERR-3 | MED | ComparisonCache Not Serialized | `state.ts:79-103`, `comparisonCache.ts` | Add optional `comparisonCacheEntries?: Array<[string, CachedMatch]>` to `SerializedPipelineState` in `types.ts`. **Requires adding public API** to ComparisonCache: `entries(): [string, CachedMatch][]` and static `fromEntries(entries): ComparisonCache` (the internal `cache` field is private). Serialize as `cache.entries()`, deserialize via `ComparisonCache.fromEntries(data)`. Default to empty cache if field missing (backward compat). Keys are SHA-256 hashes of text pairs — valid only for same run's texts on resume. |
| COST-5 | MED | Missing Deserialization Validation | `pipeline.ts:849-855` | Add debug assertion after CostTracker creation on resume: `if (costTracker.totalReserved !== 0) logger.warn('Unexpected non-zero reservation on resume')`. This documents the existing correct behavior (fresh CostTracker has zero reservations). |
| SCRIPT-7 | MED | Prompt-Based Runs Can't Apply Winners | `evolutionActions.ts:452-462` | Skip `content_history` insert when `explanation_id` is null (prompt-based runs). Note: this means prompt-based runs lose rollback capability — document this tradeoff in code comment. |
| ERR-6 | MED | LLMRefusalError Not Caught | `pipeline.ts:1183` | Add `instanceof LLMRefusalError` check alongside existing `BudgetExceededError` check in `runAgent()` catch block. Refusals should NOT be retried (content policy violations are permanent). Import from `'../types'` (where `LLMRefusalError` is defined at types.ts:459, consistent with existing `BudgetExceededError` import at pipeline.ts:10). |

**Tests:**
- Integration: `apply_evolution_winner` RPC correctness — call with valid inputs, verify all 4 writes succeeded. Test rollback by passing a non-existent `variant_id` (FK violation at step 3 should roll back steps 1-2). Add to `evolution-actions.integration.test.ts`.
- Unit: SCRIPT-2 null content check rejects empty/whitespace variant content
- Unit: checkpoint serialization round-trips with `costTrackerTotalSpent` and `comparisonCacheEntries`
- Unit: checkpoint deserialization handles missing optional fields (backward compat with old checkpoints)
- Unit: ComparisonCache `entries()` and `fromEntries()` round-trip correctly
- Unit: `runAgent()` does not retry `LLMRefusalError` — throws immediately
- Unit: SCRIPT-7 skips content_history for prompt-based runs (via RPC conditional path)

**Rollback SQL** (if HIGH-2 RPC migration needs reverting):
```sql
DROP FUNCTION IF EXISTS apply_evolution_winner;
```

---

### Phase 3: Agent Correctness (High + Medium)
**Goal:** Fix parsing, math, and logic errors in individual agents.
**Files touched:** ~12 agent files, jsonParser.ts, comparison.ts, formatValidator.ts, flowRubric.ts
**Note:** While editing agent files, check unverified PARSE-3 (no context window size check).

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| PARSE-1 | HIGH | Greedy JSON Extraction | `jsonParser.ts:10` | Replace `\{[\s\S]*\}` with balanced-brace parser: scan for first `{`, count brace depth respecting string literals (handle `\"` escapes), extract when depth returns to 0 |
| PARSE-2 | HIGH | Template Injection Triple-Quote | `debateAgent.ts`, `iterativeEditingAgent.ts`, `reflectionAgent.ts`, `flowRubric.ts` | Replace `"""${text}"""` with unique sentinel delimiters `<<<CONTENT>>>...<<</CONTENT>>>`. **Note:** `sectionEditRunner.ts` does NOT use triple-quotes (verified — grep returns no matches). `flowRubric.ts` DOES (lines 160, 235). |
| HIGH-4 | HIGH | ProximityAgent Pseudo-Embeddings | `proximityAgent.ts:137-140` | Add `console.warn` and document limitation; optionally disable agent when no embedding API configured |
| HIGH-5 | HIGH | ProximityAgent Memory Leak | `proximityAgent.ts:11` | Clear cache at iteration boundaries in pipeline; add max size (LRU or size cap) to cache |
| HIGH-6 | HIGH | OutlineGeneration Raw Fallback | `outlineGenerationAgent.ts:195-200` | Return `{ success: false }` instead of adding raw outline as variant |
| AGENT-1 | MED | MetaReview avg() NaN | `metaReviewAgent.ts:255-257` | Guard: `arr.length === 0 ? 0 : sum / length` |
| AGENT-2 | MED | EvolvePool maxParentVersion NaN | `evolvePool.ts:218-236` | Default to `0` when filter yields empty array |
| AGENT-3 | MED | Tournament Set Reference Equality | `tournament.ts:374-385` | Use `new Set(topK.map(r => r.id))` and check `.has(r.id)` |
| AGENT-4 | MED | DiffComparison UNSURE Bias | `diffComparison.ts:12-20` | Distinguish parse failures from import failures; re-throw fatal errors |
| AGENT-5 | MED | SectionDecomp No Bounds Check | `sectionDecompositionAgent.ts:120-122` | Add `if (idx >= 0 && idx < sectionDetails.length)` guard |
| AGENT-6 | MED | DebateAgent Excludes Unrated | `debateAgent.ts:198-204` | Include unrated non-baseline variants in eligibility |
| PARSE-4 | MED | parseWinner Ambiguous Heuristics | `comparison.ts:40-49` | Restructure match priority: exact match → startsWith → contains |
| PARSE-5 | MED | Format Validator H1 False Positive | `formatValidator.ts:33-38` | Fix: allow leading blank lines before H1 |
| PARSE-6 | MED | Code Block Stripping | `formatValidator.ts:47-48` | Fix regex to only strip truly unclosed blocks, not last closed block to EOF |

**Tests:**
- Unit: JSON parser handles `"Result: {"a":1} and {"b":2}"` — extracts first valid object
- Unit: JSON parser handles nested braces `{"a":{"b":1}}` correctly
- Unit: Sentinel delimiters in PARSE-2 resist injection with content containing `"""`
- Unit: ProximityAgent cache cleared between iterations; cache respects max size
- Unit: `OutlineGenerationAgent` returns `success: false` on empty expand output (not raw outline)
- Unit: `avg([])` returns 0; `Math.max(...[])` guarded in EvolvePool
- Unit: Tournament convergence detects top-K by variant ID, not reference equality
- Unit: DiffComparison re-throws import failures; returns UNSURE only for parse failures
- Unit: SectionDecomp ignores out-of-bounds section indices with warning
- Unit: DebateAgent includes unrated non-baseline variants
- Unit: parseWinner returns correct result for `"A is the winner. TEXT B is also good"`
- Unit: Format validator accepts leading blank lines before H1
- Unit: Code block stripping preserves content after last closed block

---

### Phase 4: Tree Search & Section Editing (High + Medium)
**Goal:** Fix beam search tree consistency and section editing pipeline.
**Files touched:** beamSearch.ts, flowRubric.ts, sectionStitcher.ts, sectionDecompositionAgent.ts
**Note:** `beamSearch.ts` uses `Promise.allSettled` for concurrent generation — BEAM-1 fix must account for shared mutable `treeState.nodes`. Node creation/removal must be serialized or use a post-generation cleanup pass.

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| BEAM-1 | HIGH | Orphaned Tree Nodes | `beamSearch.ts:177-232` | Move `createChildNode()` to after successful generation, or add cleanup pass after `Promise.allSettled` that removes nodes without corresponding variant text |
| BEAM-3 | HIGH | Stale Parent Critique Fallback | `beamSearch.ts:122-129` | Use `critiqueByNodeId.get(s.node.parentNodeId) ?? rootCritique` — explicitly handle null parentNodeId at depth 1 (use rootCritique directly) |
| BEAM-2 | MED | Cross-Scale Weakness Targeting | `flowRubric.ts:308-335` | Track source field per dimension; prefer same-system comparison |
| SEC-1 | MED | Stitcher Ignores OOB Silently | `sectionStitcher.ts:25-28` | Return diagnostics from stitch function (unused replacement indices) since stitcher is a pure function with no logger |
| SEC-2 | MED | No Diagnostic After Stitch Fail | `sectionDecompositionAgent.ts:141-154` | Validate each section individually; log which section failed format check |

**Tests:**
- Unit: Beam search tree has no orphaned nodes after generation failure (mock one generation to reject)
- Unit: Beam search tree consistent after concurrent generation with `Promise.allSettled`
- Unit: Critique fallback at depth 1 uses rootCritique; at depth 2+ uses parent critique
- Unit: Cross-scale weakness targeting prefers same-system dimensions
- Unit: Section stitcher returns unused replacement indices in diagnostics
- Unit: SectionDecomp logs which section failed format check

---

### Phase 5: Configuration & Cost System (Medium)
**Goal:** Fix config merge, budget redistribution, and database race conditions.
**Files touched:** config.ts, budgetRedistribution.ts, strategyConfig.ts, strategy SQL, featureFlags.ts, pool.ts, supervisor.ts, costTracker.ts, evolutionActions.ts
**Shared files:** `costTracker.ts` also in Phase 2 (COST-6). `evolutionActions.ts` also in Phases 1, 2, 7. While editing, check unverified DB-3 (no RLS policies).

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| DB-1 | MED | Strategy Aggregates RPC Race | `20260205000005_add_strategy_configs.sql:45-80` | Create **new** migration adding `FOR UPDATE` to the SELECT in `update_strategy_aggregates`. Consider adding `SET statement_timeout = '5s'` to prevent deadlock hangs. |
| CFG-6 | MED | Shallow Config Merge | `config.ts:42-52` | Implement deep merge for nested objects (plateau, etc.). Use a focused custom utility (not lodash — avoid new dependency) that handles: `undefined` = use default, `{}` = intentional empty, explicit values = override. |
| CFG-8 | MED | StrategyConfig Not Validated | `strategyConfig.ts:127-148` | Add Zod schema for `extractStrategyConfig` input; validate model names against `AllowedLLMModelType`. Project already uses Zod extensively (types.ts, budgetRedistribution.ts, costEstimator.ts, llmClient.ts). |
| COST-3 | MED | Budget Redistribution No Sum Check | `budgetRedistribution.ts:113-124` | Assert `sum(caps) ≈ 1.0` (within epsilon) after scaling; handle empty `enabledAgents` (return empty caps, don't divide by zero) |
| CORE-2 | MED | Feature Flag Mutex One-Directional | `featureFlags.ts:86-89` | Add reciprocal: if `iterativeEditing=true`, force `treeSearch=false` |
| CORE-3 | MED | getCalibrationOpponents Fewer Than N | `pool.ts:27-93` | Add fallback loop to pad opponents from available pool until `n` reached |
| CORE-4 | MED | Phase Transition Boundary | `supervisor.ts:112,233` | Use consistent `>=` across both phase transition and stopping checks |
| MED-9 | MED | Adaptive Allocation Not Wired | `adaptiveAllocation.ts` | Document as intentionally unused with code comment explaining when to wire in |
| CFG-3 | PARTIAL | featureFlags Gap in supervisorConfig | `evolutionActions.ts:606-620` | Defensive: pass featureFlags to `supervisorConfigFromRunConfig` even though currently unused |
| COST-2 | PARTIAL | Negative Cost Theoretically Possible | `costTracker.ts:54-56` | Add `if (actualCost < 0) throw` guard — cheap defensive fix |

*Note: DB-1 was originally classified as CRITICAL (RPC race causing lost updates on strategy aggregates). R5 reclassified to Medium. The race is real but low-frequency since concurrent same-strategy completions are rare.*

**Tests:**
- Unit: Deep merge preserves nested overrides including empty objects; `undefined` falls back to default
- Unit: Zod validation rejects invalid model names in strategyConfig
- Unit: Budget redistribution sum ≈ 1.0 after scaling; empty enabledAgents returns empty caps
- Unit: Feature flags enforce bidirectional mutex (both directions)
- Unit: `getCalibrationOpponents(n=5)` returns 5 opponents from pool of 4 (with duplicates)
- Unit: Phase transition and stopping use consistent boundary check
- Unit: `recordSpend()` rejects negative values
- Integration: `update_strategy_aggregates` correctness — call twice in `Promise.all` with different run data for the same strategy, verify final `run_count` equals the sum of both increments (not just the last). The `FOR UPDATE` lock serializes access so both updates apply; without it, a lost update would show `run_count = 1` instead of `2`.

**Rollback SQL** (if DB-1 migration needs reverting):
```sql
-- Revert to original function without FOR UPDATE
CREATE OR REPLACE FUNCTION update_strategy_aggregates(...) ...;
```

---

### Phase 6: Frontend & Admin UI (High + Medium)
**Goal:** Prevent UI crashes, add safety confirmations, improve reliability.
**Files touched:** ~10 component/page files
**Note:** Use Next.js `error.tsx` convention for error boundaries (project uses Next.js App Router). While editing, check unverified UI-7 (BudgetTab stale closure).

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| UI-1 | HIGH | No React Error Boundaries | All `/admin/quality/evolution/**` pages | Add `error.tsx` files in each route segment (Next.js App Router pattern) |
| UI-2 | HIGH | No Confirmation for applyWinner | `page.tsx:710-730` | Add `window.confirm()` or modal before `handleApplyWinner` |
| FE-1 | HIGH | Unsafe Type Assertions | `evolutionVisualizationActions.ts:474,527,713,843,922` | Add Zod validation before `as SerializedPipelineState` casts (project already uses Zod) |
| UI-3 | MED | No Optimistic Updates | All mutation handlers | Add loading states + disable buttons during pending mutations |
| UI-4 | MED | Sparkline Key Collision | `VariantsTab.tsx:56-71` | Use full variant ID as React key |
| UI-5 | MED | LogsTab Auto-Scroll | `LogsTab.tsx:88-94` | Add "is user at bottom" check; only auto-scroll if at bottom |
| FE-7 | MED | LogsTab Missing Pagination | `LogsTab.tsx:58` | Add cursor-based pagination or virtual scroll |
| SCRIPT-4 | MED | Hard-Coded Stale Threshold | `evolution-watchdog/route.ts:8` | Make configurable via env `STALE_THRESHOLD_MINUTES`; default 15 |

**Tests:**
- Unit: `error.tsx` boundary renders fallback UI on child error
- Unit: applyWinner handler calls confirmation before server action
- Unit: Zod validation rejects malformed snapshot data (missing pool, invalid types)
- Unit: Mutation buttons disabled during loading state
- Unit: VariantsTab uses full variant ID as key (no shortId)
- Unit: LogsTab does not auto-scroll when user scrolled up
- Unit: LogsTab paginates (loads max N entries, supports "load more")
- Unit: Watchdog uses `STALE_THRESHOLD_MINUTES` env var when present

---

### Phase 7: Performance & Polish (Medium + Low)
**Goal:** Fix N+1 queries, add missing indexes, handle edge cases.
**Files touched:** pipeline.ts, costEstimator.ts, new migration, various agent files, scripts, evolutionActions.ts
**Shared files:** `pipeline.ts` also touched in Phase 2. `evolutionActions.ts` also in Phases 1, 2, 5. While editing scripts, check unverified HIGH-8 (integer parsing validation).

| ID | Severity | Finding | File | Fix |
|----|:--------:|---------|------|-----|
| DB-4 | MED | N+1 in persistAgentMetrics | `pipeline.ts:253-274` | Batch upsert all agent metrics in single query |
| DB-5 | MED | N+1 in feedHallOfFame | `pipeline.ts:620-666` | Batch both operations (3 entries × 2 ops → 2 batch ops) |
| EXP-5 | MED | --vary/--lock Conflict | `run-strategy-experiment.ts:99-117` | Validate no key overlap between vary and lock at parse time |
| DB-2 | LOW | Missing Index on status | New migration | `CREATE INDEX idx_evolution_runs_status ON content_evolution_runs(status, created_at DESC)` |
| DB-7 | LOW | costEstimator Silent Errors | `costEstimator.ts:88-95` | Distinguish "no baseline" (return null) from "DB error" (throw) |
| MED-8 | LOW | Cost Estimator Div by Zero | `costEstimator.ts:139` | Guard `avgTextLength > 0 ? ... : 1` |
| CFG-1 | LOW | budgetCaps Not Passed to Estimator | `evolutionActions.ts:187-198` | Pass `budgetCaps` from strategy config (low impact — estimation only) |
| AGENT-7 | LOW | CalibrationRanker Early Exit | `calibrationRanker.ts:172-175` | Also check average confidence threshold |
| AGENT-8 | LOW | Tournament Pool < 2 | `tournament.ts:82-85` | Return empty pairs early if `variants.length < 2` |
| AGENT-9 | LOW | BeamSearch Stale Critique | `beamSearch.ts:235-266` | Flag critique as stale; log warning |
| AGENT-10 | LOW | PairwiseRanker null dimensionScores | `pairwiseRanker.ts:134-145` | Guard: `dimensionScores ?? {}` |
| FE-3 | LOW | D3 Import Race in TreeTab | `TreeTab.tsx:112-115` | Guard with ref flag or move to module level |
| FE-5 | LOW | Missing URL Param Validation | `run/[runId]/page.tsx:168` | Validate UUID format before passing to server actions |
| EXP-1 | LOW | run-batch.ts No Signal Handling | `scripts/run-batch.ts:423-544` | Add SIGINT/SIGTERM handlers; mark batch "interrupted" |
| EXP-2 | LOW | run-batch.ts Missing Cleanup | `scripts/run-batch.ts:97-110` | Track created IDs; delete on failure in try-finally |
| EXP-4 | LOW | run-batch.ts Resume | `scripts/run-batch.ts:431-435` | Implement `--resume`: query batch_runs, filter to pending/failed, execute remaining |

**Tests:**
- Unit: Batch agent metrics upsert in single query (mock Supabase, verify 1 call instead of N)
- Unit: Batch hall-of-fame upsert in 2 calls (mock Supabase, verify call count)
- Unit: `--vary "iterations=3,5" --lock "iterations=8"` throws validation error
- Unit: costEstimator throws on DB errors, returns null on missing baseline
- Unit: costEstimator handles `avgTextLength === 0` without Infinity
- Unit: CalibrationRanker doesn't early-exit with low average confidence
- Unit: Tournament returns empty pairs for pool size < 2
- Unit: PairwiseRanker handles null dimensionScores without crash
- Unit: run-batch SIGTERM marks batch as interrupted
- Unit: run-batch cleanup deletes orphaned explanation records on failure

**Rollback SQL** (if DB-2 index needs reverting):
```sql
DROP INDEX IF EXISTS idx_evolution_runs_status;
```

---

## Summary Table

| Phase | Findings | Severity | Est. Files | Key Risk |
|-------|:--------:|----------|:----------:|----------|
| 1. Security & Safety | 3 | 3 Critical | 5 | Auth bypass in prod |
| 2. Core Pipeline | 7 | 3 High, 4 Medium | 7 | Data corruption, checkpoint gaps |
| 3. Agent Correctness | 14 | 5 High, 9 Medium | 13 | Wrong results, NaN propagation |
| 4. Tree Search & Sections | 5 | 2 High, 3 Medium | 4 | Tree inconsistency |
| 5. Config & Cost | 10 | 8 Medium, 2 Partial | 9 | Budget errors, race conditions |
| 6. Frontend & Admin UI | 8 | 3 High, 5 Medium | 10 | UI crashes, accidental actions |
| 7. Performance & Polish | 16 | 3 Medium, 13 Low | 12 | N+1 queries, edge cases |
| **Total** | **63** | | | |

*Unique finding count: 61 confirmed + 2 partially valid = 63 (CORE-1 removed as false positive).*

## Unverified Findings (54 remaining)

54 of 132 original findings were not verified in Round 5. Strategy:

- **During each phase**, spot-check unverified findings in the same files being modified. Specific assignments:
  - **Phase 1:** HIGH-3 (heartbeat error swallowing in `evolution-runner/route.ts`), MED-7 (watchdog batch update race in `evolution-watchdog/route.ts`)
  - **Phase 2:** ERR-4 (variant persistence silent fail in `pipeline.ts`), MED-6 (double validation in `evolutionActions.ts`)
  - **Phase 3:** PARSE-3 (no context window size check in agents), PARSE-7 (sentence detection false positives in `formatValidator.ts`)
  - **Phase 5:** DB-3 (no RLS policies on evolution tables), MED-10 (missing budget sum rate limiting)
  - **Phase 6:** UI-7 (BudgetTab stale closure), FE-4 (date format assumption), FE-8 (QueueDialog validation)
  - **Phase 7:** HIGH-8 (integer parsing validation in `scripts/evolution-runner.ts`)
- **After Phase 4**, conduct a dedicated verification pass on remaining unverified findings
- **Spot-check acceptance criteria:**
  - **Confirmed**: The code matches the finding's description — add fix to current phase if small (< 30 min), otherwise create follow-up ticket
  - **Fixed**: The code no longer has the issue — note as "already fixed" in progress doc
  - **Invalid**: The finding was incorrect — note as "invalid" in progress doc with 1-line reason
  - Record all spot-check results in `_progress.md` under the current phase

## Testing

### Test Command Reference
- Unit tests: `npm test` (jest, `--changedSince` in CI)
- Integration tests: `npm test -- --config jest.integration.config.js` (requires real Supabase)
- E2E tests: `npm run test:e2e` (Playwright, auto-starts servers)

### Unit Tests (per phase)
- Each phase includes specific unit test requirements listed above
- All existing tests must continue to pass
- Test files collocated with source (e.g., `jsonParser.test.ts` next to `jsonParser.ts`) for CI `--changedSince` detection

### Integration Tests
- Phase 1: Manual migration verification on staging (no local Supabase test infra exists)
- Phase 2: `apply_evolution_winner` RPC rollback test against real Supabase (add to `evolution-actions.integration.test.ts`)
- Phase 2: Checkpoint round-trip with ComparisonCache + CostTracker (can be unit test with mocked state)
- Phase 5: `update_strategy_aggregates` concurrent update test (use `Promise.all` in integration test)

### E2E Tests
- Phase 6: Admin UI error boundary smoke test (requires un-skipping `admin-evolution.spec.ts` or adding new spec)
- Phase 6: applyWinner confirmation dialog test
- Consider un-skipping `admin-evolution.spec.ts` (MED-12) as stretch goal

### Manual Verification (on staging)
- Phase 1: Verify cron endpoints return 500 without `CRON_SECRET`; verify migration applies cleanly with existing nullable data
- Phase 2: Run evolution, verify checkpoint includes comparisonCache and costTracker totalSpent; resume from checkpoint
- Phase 3: Run evolution with long article to verify JSON parser and format validator
- Phase 6: Click through admin UI, verify error boundary catches errors, applyWinner shows confirmation

### Rollback Strategy
- Each phase with migrations includes rollback SQL (see individual phases)
- Code changes: revert via `git revert <merge-commit>` on main
- If Phase N breaks staging, do NOT proceed to Phase N+1 until resolved

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Config schema changes (Phase 5: CFG-6 deep merge, CFG-8 validation)
- `docs/evolution/cost_optimization.md` - Budget validation at queue time (Phase 1: COST-1), cost tracker serialization (Phase 2: COST-6)
- `docs/evolution/architecture.md` - Checkpoint serialization changes (Phase 2: ERR-3, COST-6)
- `docs/evolution/strategy_experiments.md` - --vary/--lock conflict validation (Phase 7: EXP-5), batch resume (Phase 7: EXP-4)
- `docs/evolution/agents/overview.md` - LLMRefusalError handling (Phase 2: ERR-6)
- `docs/evolution/agents/tree_search.md` - Beam search node lifecycle (Phase 4: BEAM-1), critique fallback (Phase 4: BEAM-3)
- `docs/evolution/rating_and_comparison.md` - parseWinner priority restructuring (Phase 3: PARSE-4)
- `docs/evolution/agents/generation.md` - Outline fallback behavior change (Phase 3: HIGH-6)
- `docs/evolution/agents/editing.md` - Template delimiter change (Phase 3: PARSE-2), section validation diagnostics (Phase 4: SEC-2)
- `docs/evolution/agents/support.md` - ProximityAgent pseudo-embedding documentation (Phase 3: HIGH-4), format validator fixes (Phase 3: PARSE-5, PARSE-6)
