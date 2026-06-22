# Cost Optimization

The evolution system uses a two-layer budget model to prevent runaway LLM spending. Layer 1 (per-run) enforces synchronous reserve-before-spend tracking within a single pipeline execution. Layer 2 (global) enforces daily and monthly caps across all runs via database-backed reservations with in-memory caching. Both layers must approve a call before it proceeds.

For how costs fit into the pipeline lifecycle, see [Architecture](./architecture.md). For the database tables that store cost data, see [Data Model](./data_model.md).

> **⚠ Historical cost-data caveats** (debug_evolution_run_cost_20260426). Three windows of historical cost data have known reliability issues that cannot be retroactively repaired:
>
> 1. **Pre-2026-02-23**: cost numbers are reliable.
> 2. **2026-02-23 → 2026-06-21 (audit-gap window — historical, now FIXED forward)**: `llmCallTracking` rows are missing for most evolution runs in this window — per-call token-level audit is impossible for it (the rows don't exist; not backfillable, no join key). Run-level rollups in `evolution_metrics` remain trustworthy (`scope.getOwnSpent()`). **Root cause (debug_llm_spending_data_issues_stage_20260621):** the per-call tracking write was best-effort — `saveTrackingAndNotify` swallowed every failure unless a test-only env flag was set — so when the minicomputer ran pre-fix code (CLI fallback to the Next.js-coupled client failed), the INSERT silently dropped. **Fix:** evolution `callLLM` is now FAIL-CLOSED (`requireTracking` — a tracking-write failure throws and fails the run, with the full row dead-lettered to logs); `isTestLlmCall` no longer mislabels the evolution system userid `…001` as test; and `processRunQueue` preflights tracking-write reachability per target at boot. Forward runs reconcile per-call vs invocation cost. **Remaining ops dependency:** the minicomputer must `git pull` + restart to run the fixed code. **paragraph_recombine slice** was separately fixed earlier (Phase 1 G8 of the 20260529 project, `ParagraphRecombineAgent.ts:352-354`).
> 3. **Pre-2026-04-20 OpenRouter-routed runs (gemini-flash-lite, qwen, gpt-oss-20b)**: cost numbers may show ~3× inflation due to Bug A — the legacy `response.length / 4` heuristic over-counted tokens for these models. Not retroactively repairable because pre-fix `llmCallTracking` rows have NULL `evolution_invocation_id` and the backfill script's preflight rejects them.
>
> The follow-up project landed (debug_llm_spending_data_issues_stage_20260621): the per-call write path is now fail-closed (`requireTracking`) so future evolution LLM calls cannot silently drop their `llmCallTracking` row — a write failure throws and fails the run. Per-call audit is reliable for runs on the fixed code (once the minicomputer pulls + restarts). The historical 2026-02-23→2026-06-21 window is NOT backfillable (the rows were never written; no join key).

> **Per-purpose cost split.** Every LLM call passes a typed `AgentName` label as the
> second argument to `llm.complete()` (defined in `evolution/src/lib/core/agentNames.ts`,
> currently `'generation' | 'ranking' | 'reflection' | 'seed_title' | 'seed_article' | 'evolution'`).
> The V2 cost tracker buckets per-call costs under this label in `phaseCosts[label]`
> (race-free per-key accumulator under Node single-threaded execution). After every
> call, `createLLMClient.ts` writes `cost`, `generation_cost`, `ranking_cost`, and
> `reflection_cost` to `evolution_metrics` via `writeMetricMax` — a Postgres RPC using
> `ON CONFLICT DO UPDATE SET value = GREATEST(...)` so concurrent out-of-order writes
> can never overwrite a larger value with a smaller one. The `COST_METRIC_BY_AGENT`
> lookup determines which static metric name receives the per-purpose write
> (`'reflection' → 'reflection_cost'`).
>
> **Local integration test setup:** Run `supabase db reset` (or
> `supabase migration up --local`) before `npm run test:integration` to ensure the
> `upsert_metric_max` RPC is available in the local DB. CI applies migrations to staging
> automatically via `.github/workflows/ci.yml` `deploy-migrations` job.

> **Debate wrapper cost stack.** `DebateThenGenerateFromPreviousArticleAgent` (Shape A:
> `agentType: 'debate_and_generate'` is a top-level enum value) makes 2 LLM calls per
> invocation under Option C (Decision §17): ONE combined "analyze + judge" call, plus
> ONE synthesis call delegated to inner GFPA. Both calls map to the SINGLE `debate_cost`
> metric per Decision §6 — the combined call uses AgentName `'debate_judge'` and the
> synthesis call uses `'debate_synthesis'` (NOT `'generation'` — wired via the I4
> LLM-client proxy that rewrites `'generation' → 'debate_synthesis'` at the inner-GFPA
> boundary). Total per-invocation cost: `debate_judge + debate_synthesis + ranking`
> (ranking from inner GFPA's Swiss-style binary-search keeps its own `'ranking'` AgentName
> and flows to `ranking_cost`). Per-invocation budget cap $0.40 with 0.9× pre-synthesis
> abort threshold per Decision §8.
>
> **Reflection wrapper cost stack.** `ReflectAndGenerateFromPreviousArticleAgent`
> (Shape A: `agentType: 'reflect_and_generate'` is a top-level enum value alongside
> `'generate'` and `'swiss'`) makes ONE reflection LLM call up front to pick a tactic,
> then delegates to `GenerateFromPreviousArticleAgent` for the usual generation +
> ranking calls. Total per-invocation cost is therefore `reflection + generation +
> ranking`. The reflection call uses an `OUTPUT_TOKEN_ESTIMATES.reflection = 600`
> budget (vs. 1000 for generation, 100 for ranking) when reserving budget in
> `createEvolutionLLMClient.ts`. The reflection cost is recorded incrementally to
> `reflection_cost` (run-level) by the same `writeMetricMax` path, and propagates to
> `total_reflection_cost` (sum) and `avg_reflection_cost_per_run` (avg) at the
> strategy/experiment level via `SHARED_PROPAGATION_DEFS` in `registry.ts`.
>
> **Runs-list reconciliation (use_playwright_find_ux_issues_bugs_20260501 Fix #11)**:
> the runs-list `Spent` column and the dashboard `Total Cost` use a layered fallback
> in `evolution/src/lib/cost/getRunCostWithFallback.ts` when the rollup `cost` metric
> is missing. As of Fix #11, layer 2 sums all FOUR per-purpose costs
> (`generation_cost + ranking_cost + reflection_cost + seed_cost`) — pre-fix it
> omitted reflection_cost, which made reflect+generate runs under-report by the
> reflection portion. `reflection_cost.listView` is also `true` so the runs-list
> exposes a Reflection Cost column alongside the others.

---

## Test cost containment (reduce_e2e_testing_llm_costs_20260621)

The minicomputer's `processRunQueue.ts` systemd runner claims pending evolution_runs from staging every 60s. Before 2026-06-21, E2E and integration tests routinely inserted `[TEST]`-prefixed strategies + pending runs as fixtures; the runner couldn't tell them apart from real work and burned ~$15/week on staging executing them.

**The gate (migration `20260621000001_evolution_claim_gate.sql`)** adds three OR branches to `claim_evolution_run`'s inner SELECT:

1. `p_run_id IS NOT NULL` → targeted claim, bypass gate (caller is explicit — admin UI "Trigger Run", `/api/evolution/run` POST with `targetRunId`)
2. `NOT s.is_test_content` → queue claim on real strategies (normal production path)
3. `r.allow_test_execution = true` → queue claim on test strategies WHEN the run row opts in (for integration tests that need to exercise queue-claim semantics with mocked LLM)

The `evolution_runs.allow_test_execution` column defaults `false`, so safe-by-default: a future test that accidentally inserts a pending row gets the gate behavior automatically.

**`evolution_strategies.is_test_content`** is set by a BEFORE trigger calling `evolution_is_test_name(name)` (`20260415000001`); the trigger flags strategies whose name matches `test`, `[TEST]`, `[E2E]`, `[TEST_EVO]`, or `*-<10-13 digits>-*` timestamp pattern. No code change needed at the test-helper layer — existing `[TEST] strategy_*` and `[TEST_EVO]` naming patterns are caught automatically.

**Existing helpers** (`createTestEvolutionRun` in `evolution/src/testing/`, `createTestRun` in `src/__tests__/e2e/helpers/`) accept the override via Pattern A-2 typed sugar: `CreateTestRunOptions.executable?: boolean`.

### Patterns

| Pattern | Test intent | Gate behavior |
|---|---|---|
| **A-1** | E2E spec triggers `/api/evolution/run` POST with `targetRunId` to verify pipeline execution | Targeted claim bypasses gate; no change |
| **A-2** | Integration test inserts pending [TEST] run + calls `claimAndExecuteRun({ runnerId })` to verify queue-claim semantics with mocked LLM | Set `executable: true` on the helper or `allow_test_execution: true` on the insert |
| **B** | Test inserts pending row as fixture data only (admin UI render, watchdog, cancel_experiment, etc.) | Gate skips queue-claim automatically — no change |

### Janitor + alarms (Phase 3, separate PR)

- **Janitor**: weekly CI job `evolution-test-data-cleanup.yml` deletes `evolution_strategies WHERE is_test_content=true AND last_used_at < now() - interval '14 days'` in FK-safe order (runs first → cascades to children → then strategies). `evolution_runs.strategy_id` FK is `ON DELETE RESTRICT` (per `20260324000001_entity_evolution_phase0.sql`), so the order matters.
- **Alarm**: daily query — if `SUM(invocation cost) WHERE strategy.is_test_content=true AND created_at > now() - 24h` exceeds **$0.10**, file `[release-health]` issue (same plumbing as `evolution-run-health.yml`). Baseline expected: ~$0.04/day from Pattern A-1 spec executions.
- **Layer-3 nightly smoke**: new `evolution-nightly-smoke.yml` exercises the runner against the `Nightly smoke fixture` strategy (seeded by migration `20260621000002_evolution_nightly_smoke_fixture.sql`). Expected cost: ~$1.83/year.

---

## Three-Layer Budget Flow

```
LLM Call Request
       |
       v
+------------------------+     throws BudgetExceededError
| Layer 1a: Per-Run      |----> (run-level cap exceeded — stops entire run)
| V2CostTracker          |
| (synchronous)          |
+--------+---------------+
         | run reserve OK
         v
+------------------------+     throws IterationBudgetExceededError
| Layer 1b: Per-Iteration|----> (iteration cap exceeded — stops this iteration only)
| IterationBudgetTracker |
| (synchronous)          |
+--------+---------------+
         | iteration reserve OK
         v
+------------------+     throws GlobalBudgetExceededError
| Layer 2: Global  |----> (daily/monthly cap exceeded)
| LLMSpendingGate  |
| (DB + cache)     |     throws LLMKillSwitchError
+--------+---------+----> (emergency stop)
         | all pass
         v
   Execute LLM Call
         |
         v
  +------+-------+
  | Record spend  |  iterTracker.recordSpend() → costTracker.recordSpend()
  | Reconcile     |  gate.reconcileAfterCall()
  +--------------+
```

---

## Layer 1: Per-Run Cost Tracker

**File:** `evolution/src/lib/pipeline/infra/trackBudget.ts`

The V2 cost tracker uses a reserve-before-spend pattern with a 1.3x safety margin. Every LLM call must reserve budget before execution, then either record the actual spend on success or release the reservation on failure.

### Factory and Interface

```typescript
export function createCostTracker(budgetUsd: number): V2CostTracker;

export interface V2CostTracker {
  reserve(phase: string, estimatedCost: number): number;
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  release(phase: string, reservedAmount: number): void;
  getTotalSpent(): number;
  getPhaseCosts(): Record<string, number>;
  getAvailableBudget(): number;
}
```

### Reserve-Before-Spend Lifecycle

1. **`reserve(phase, estimatedCost)`** -- Multiplies the estimate by 1.3x (the `RESERVE_MARGIN`) and checks if `totalSpent + totalReserved + margined > budgetUsd`. If so, throws `BudgetExceededError`. Returns the margined amount. This method is **synchronous** -- critical for parallel safety under Node.js's single-threaded event loop.

2. **`recordSpend(phase, actualCost, reservedAmount)`** -- Deducts the reservation from `totalReserved`, adds `actualCost` to `totalSpent`, and accumulates into per-phase costs. Logs an error if spend exceeds the cap (overrun detection, not prevention).

3. **`release(phase, reservedAmount)`** -- Releases the reservation without spending. Used when an LLM call fails or is skipped.

Per-phase costs are tracked under keys like `generation`, `ranking`, and `evolution`, which map to the pipeline's agent names. Use `getPhaseCosts()` to inspect the breakdown after a run. The `getAvailableBudget()` method returns `max(0, budgetUsd - totalSpent - totalReserved)`, giving callers a real-time view of remaining headroom including outstanding reservations.

The tracker is designed as a plain closure (not a class) returned by the factory function. Internal state (`totalSpent`, `totalReserved`, `phaseCosts`) is captured via closure variables, making it impossible for external code to mutate the state directly. This is an intentional design choice for safety in a system where budget correctness is critical.

> **Warning:** The 1.3x margin is a heuristic. Actual costs can still exceed the budget if the LLM returns significantly more tokens than estimated. The tracker logs overruns but does not roll back completed calls. Monitor the `[V2CostTracker] Budget overrun` log message in production to detect models or prompts that consistently exceed estimates.

### Budget Postcondition Assertions

The cost tracker includes runtime postcondition assertions to detect invariant violations:

- **Precondition:** `createCostTracker(budgetUsd)` rejects NaN, Infinity, negative, and zero values.
- **Core invariant (unconditional):** After every `recordSpend()`, if `totalSpent + totalReserved > budgetUsd * 1.01`, an error is logged. This runs in all environments to detect overruns without crashing the pipeline.
- **Strict assertions (gated):** When `EVOLUTION_ASSERTIONS=true` (set in test/dev environments), the tracker throws on postcondition violations:
  - `totalReserved >= 0` after `reserve()`, `recordSpend()`, and `release()`
  - `Number.isFinite(totalSpent)` after `recordSpend()`

Set `EVOLUTION_ASSERTIONS=true` in CI via `jest.setup.js` to catch invariant violations in tests.

---

## Layer 1b: Per-Iteration Budget Enforcement

**File:** `evolution/src/lib/pipeline/infra/trackBudget.ts`

Each iteration in `config.iterationConfigs[]` specifies a `budgetPercent` (1-100).
At runtime, the dollar amount is computed as `(budgetPercent / 100) * totalBudgetUsd`.
The `createIterationBudgetTracker(iterationBudgetUsd, runTracker, iterationIndex)` factory
wraps the run-level `V2CostTracker` with an additional per-iteration budget check.

### Reserve Sequence

1. **Run-level check** — `runTracker.reserve()` is called first. If the run budget is
   exhausted, `BudgetExceededError` is thrown (stops the entire run).
2. **Iteration-level check** — if `iterSpent + iterReserved + margined > iterationBudgetUsd`,
   the run-level reservation is released and `IterationBudgetExceededError` is thrown
   (stops only the current iteration; the loop advances to the next `iterationConfig`).

### IterationBudgetExceededError

```typescript
class IterationBudgetExceededError extends BudgetExceededError {
  readonly iterationIndex: number;
}
```

This error extends `BudgetExceededError` so existing catch blocks that handle budget
errors will also catch iteration budget errors. The orchestrator catches
`IterationBudgetExceededError` specifically at the iteration boundary to record
`stopReason: 'iteration_budget_exceeded'` and continue to the next iteration.

---

## Budget Pressure Tiers

**File:** `evolution/src/lib/pipeline/rank.ts`

The ranking phase scales the number of pairwise comparisons based on how much of the run budget has been consumed. The `budgetFraction` (spent / cap) determines the tier:

| Tier   | Budget Consumed | Max Comparisons |
|--------|-----------------|-----------------|
| Low    | < 50%           | 40              |
| Medium | 50% -- 80%      | 25              |
| High   | 80%+            | 15              |

```typescript
function getBudgetTier(budgetFraction: number): 'low' | 'medium' | 'high' {
  if (budgetFraction >= 0.8) return 'high';
  if (budgetFraction >= 0.5) return 'medium';
  return 'low';
}
```

This ensures ranking degrades gracefully rather than failing outright when a run is near its budget limit. Early iterations get thorough rankings (40 comparisons); later iterations near the cap get abbreviated rankings (15 comparisons) that still produce a usable ordering.

The `budgetFraction` is computed by the pipeline supervisor before each ranking phase and passed into `rankPool()`. The tier is also recorded in the iteration result as `budgetTier` alongside the raw `budgetPressure` value, so the admin UI can display how aggressively ranking was throttled in each iteration. When a run exits with reason `budget`, inspecting the final tier helps determine whether the budget was genuinely insufficient or whether the estimation was too conservative.

---

## Cost Estimation

### 402 / no-max_tokens failure mode (fix_structured_judging_evolution_bugs_20260611)

Until 2026-06-12, `callOpenAIModel` (`src/lib/services/llms.ts`) never set `max_tokens` on the OpenAI/OpenRouter request, so OpenRouter reserved the model's **full max output (~65535 tokens)** for its credit-affordability pre-check. On a low OpenRouter balance this returned **HTTP 402** (`"requires more credits, or fewer max_tokens. You requested up to 65535…"`) *before any tokens were billed*, even though real evolution output is ~1–2.3K tokens. Every generation then failed, the run produced 0 variants at $0 cost, and finalize marked it silently `completed`/`arena_only` (the cascade through latent defects D1/D2/D3). This fired on **2026-05-02 and 2026-06-11**.

**Fix (D5):** the evolution pipeline now passes `maxOutputTokens` (`CallLLMOptions`) — set to `EVOLUTION_MAX_OUTPUT_TOKENS` (default **4096**, env kill-switch) at the single chokepoint `claimAndExecuteRun.ts` `complete()` — which `callOpenAIModel` forwards as `max_tokens` **only for non-reasoning models** (reasoning models are exempted because `max_tokens` caps reasoning+completion together). A `finish_reason === 'length'` guard throws so a future truncation fails loudly (→ D1 `success=false`) instead of returning silently-partial text. The cap shrinks the affordability requirement ~16× and clears the 402 at low balances. The offline `runJudgeEval.ts` / `runPromptEditorConfig.ts` paths bypass this chokepoint and remain uncapped (follow-up). Recurrence detector: `evolution/scripts/detectArenaOnlyWipeouts.ts` + `.github/workflows/evolution-run-health.yml`.

### Per-Call Estimation (Reserve-Before-Spend)

**File:** `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`

Before each LLM call, cost is estimated using **1 token ~ 4 characters** and fixed output token estimates (1000 for generation, 100 for ranking). This feeds `costTracker.reserve()` with a 1.3x margin. After the call, actual costs are computed from the provider's **real token counts** (`usage.prompt_tokens` + `usage.completion_tokens`) via `calculateLLMCost` — the same helper `llmCallTracking.estimated_cost_usd` uses — and passed to `recordSpend()`. This replaced a string-length heuristic (`response.length / 4`) that inflated actual costs 30–800% for models whose responses don't have a clean 4 chars/token ratio.

### Pre-Dispatch Estimation (Budget-Aware)

**File:** `evolution/src/lib/pipeline/infra/estimateCosts.ts`

Before dispatching generateFromPreviousArticle agents, the orchestrator uses empirical cost estimation to determine how many agents the budget can support. Per-tactic output size estimates drive the generation cost model. This uses:

- **Empirical output characters per tactic** (measured from staging DB; new tactics use `DEFAULT_OUTPUT_CHARS` until calibration data accumulates):

| Tactic | Avg Output Chars | ~Tokens | Category |
|--------|-----------------|---------|----------|
| grounding_enhance | 11,799 | 2,950 | Core (measured) |
| structural_transform | 9,956 | 2,489 | Core (measured) |
| lexical_simplify | 5,836 | 1,459 | Core (measured) |
| engagement_amplify | 9,197 | 2,299 | Extended (estimated) |
| style_polish | 9,197 | 2,299 | Extended (estimated) |
| argument_fortify | 9,197 | 2,299 | Extended (estimated) |
| narrative_weave | 9,197 | 2,299 | Extended (estimated) |
| tone_transform | 9,197 | 2,299 | Extended (estimated) |
| analogy_bridge | 11,000 | 2,750 | Depth & Knowledge (estimated) |
| expert_deepdive | 12,000 | 3,000 | Depth & Knowledge (estimated) |
| historical_context | 11,000 | 2,750 | Depth & Knowledge (estimated) |
| counterpoint_integrate | 10,500 | 2,625 | Depth & Knowledge (estimated) |
| pedagogy_scaffold | 10,000 | 2,500 | Audience-Shift (estimated) |
| curiosity_hook | 9,500 | 2,375 | Audience-Shift (estimated) |
| practitioner_orient | 10,000 | 2,500 | Audience-Shift (estimated) |
| zoom_lens | 10,000 | 2,500 | Structural Innovation (estimated) |
| progressive_disclosure | 10,500 | 2,625 | Structural Innovation (estimated) |
| contrast_frame | 9,500 | 2,375 | Structural Innovation (estimated) |
| precision_tighten | 8,000 | 2,000 | Quality & Precision (estimated) |
| coherence_thread | 9,500 | 2,375 | Quality & Precision (estimated) |
| sensory_concretize | 9,200 | 2,300 | Quality & Precision (estimated) |
| compression_distill | 5,500 | 1,375 | Meta/Experimental (estimated) |
| expansion_elaborate | 13,000 | 3,250 | Meta/Experimental (estimated) |
| first_principles | 11,000 | 2,750 | Meta/Experimental (estimated) |
| default (unknown tactics) | 9,197 | 2,299 | Fallback |

- **Deterministic ranking cost**: `min(poolSize - 1, maxComparisonsPerVariant)` comparisons × 2 LLM calls (bias mitigation) × comparison cost. Comparison prompt = 698 chars overhead + 2 × article length.

Key functions: `estimateGenerationCost()`, `estimateRankingCost()`, `estimateAgentCost()`, `estimateSwissPairCost()`, `estimateEvaluateAndSuggestCost()`.

### Evaluate-and-Suggest Cost (evaluateCriteriaThenGenerateFromPreviousArticle_20260501)

The `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` adds one combined LLM call upstream of the inner GFPA dispatch. `estimateEvaluateAndSuggestCost(parentChars, gen, judge, criteriaCount, weakestK, avgRubricChars)` accounts for:

- **Prompt overhead** — fixed `EVALUATE_AND_SUGGEST_PROMPT_OVERHEAD` chars for header/instructions
- **Per-criterion description** — `criteriaCount × CRITERIA_DESC_CHARS_PER_ITEM`
- **Per-criterion rubric injection** — `criteriaCount × avgRubricChars` (avg from the actual `evaluation_guidance.anchors[]` payload, not a fixed constant; rubrics with more/longer anchors cost proportionally more)
- **Output** — per-criterion score line (`SCORE_LINE_OUTPUT_CHARS`) for ALL criteria + `weakestK × SUGGESTION_BLOCK_OUTPUT_CHARS`. `OUTPUT_TOKEN_ESTIMATES.evaluate_and_suggest = 2300` covers this cap.

`estimateAgentCost(useCriteria, criteriaCount, weakestK)` extends the dispatch-plan projector — when `useCriteria` is true, it adds the evaluate-and-suggest cost to the GFPA cost rather than replacing it. `EstPerAgentValue` carries an `evaluation` field alongside `generation` and `ranking` so the projector and admin "Cost Estimates" tab can break out the new phase. The calibration ladder (`evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`) and `costCalibrationLoader.ts` phase enum both include `'evaluate_and_suggest'` so DB-backed calibration values can override the hardcoded constants once enough samples exist.

### Proposer-Approver Criteria Cost (updated_criteria_agent_20260505)

The `ProposerApproverCriteriaGenerateAgent` is the heaviest criteria-driven dispatch — **5 cost layers per parent variant**:

| Layer | AgentName label | Bucket metric |
|---|---|---|
| Eval + suggest | `evaluate_and_suggest` | `evaluation_cost` |
| Proposer | `criteria_proposer` | `proposer_approver_criteria_cost` |
| Forward approver | `criteria_forward_approver` | `proposer_approver_criteria_cost` |
| Mirror approver (optional, default on) | `criteria_mirror_approver` | `proposer_approver_criteria_cost` |
| Post-cycle ranking | `ranking` | `ranking_cost` |

The propose / forward / mirror calls all bucket to one **umbrella metric** (`proposer_approver_criteria_cost`) so the run-level cost surfaces as a single column on the leaderboard. Per-purpose split lives in `execution_detail.cycles[0].{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}` for drill-down.

**Cost projection** (`estimateProposerApproverCriteriaCost`): 5-layer projection with a 1.3× upper-bound margin. **Intentional projection drift on mirror cost**: the projector assumes worst-case (every forward-accepted group gets a mirror call). The runtime short-circuit (`mirrorDecisions[i] = null` for forward-rejected groups) skips those mirror calls, making actual mirror cost a function of the forward rejection rate. Estimator over-projection is the expected shape; the Cost Estimates tab surfaces this as a positive projected-vs-actual delta. We do NOT try to predict forward rejection at projection time — it varies per article + criteria set.

**Strategy/experiment-level rollups**: `total_proposer_approver_criteria_cost` (sum) and `avg_proposer_approver_criteria_cost_per_run` (avg). Same shape as the `iterative_edit_*` propagation pattern.

### `disableApproverFiltering` cost impact (meta_analysis Phase 6)

Setting `disableApproverFiltering: true` on a Mode B (`iterative_editing_rewrite`) iteration sends every diff atomic to the approver as its own singleton group instead of bundled groups capped at K=10. At `editingProposerSoftCap=8` the proposer typically emits 40-60 atomics per cycle; the per-cycle ceiling `AGENT_MAX_ATOMIC_EDITS_PER_CYCLE=30` clamps to at most 30 approver decisions. On `gemini-2.5-flash-lite` the per-cycle approver call moves from ~$0.0006 (10 groups) → ~$0.0011 (~30 groups). Per-run cost (2 editing iterations × up to 3 cycles each = ≤6 approver calls) shifts from ~$0.038 → ~$0.041, well below the typical $0.05 per-run cap. The field is FIELD_GATES-stripped pre-hash for non-rewrite agent types so it can't drift other strategies' `config_hash`.

**Single-pass criteria** (`SinglePassEvaluateCriteriaAndGenerateAgent`) cost stack is identical to the legacy criteria wrapper: one `evaluate_and_suggest` call + GFPA generation + ranking. The new 3 guardrail directives in the customPrompt add ~300 chars of overhead, captured by `estimateGenerationCost(seedArticleChars + 300, ...)` in the projector. Negligible cost difference (~$0.0001) but worth being right.

### Paragraph-Recombine Cost (rank_individual_paragraphs_evolution_20260525)

The `ParagraphRecombineAgent` cost stack scales as `N slots × M rewrites × (rewrite + ranking)` plus an optional coordinator call. The agent buckets cost into the single umbrella metric `paragraph_recombine_cost` via three dedicated AgentName labels: `'paragraph_rewrite'` (rewrite calls), `'paragraph_rank'` (per-slot ranking calls — the agent relabels `rankNewVariant`'s `'ranking'` calls so they don't pollute the article-level `ranking_cost`), and `'paragraph_recombine_coordinator'` (the sequential-mode pre-loop planner call, debug_performance_paragraph_recombine_20260612). The agent writes the run-level metric once per invocation as the SUM of the three phase-cost accumulators (MAX-safe because all three are run-cumulative as of Phase 12 of `analyze_effectiveness_paragraph_recombine_20260530`; pre-Phase-12 the iter tracker returned per-iter, silently shadowing smaller per-iter contributions under writeMetricMax GREATEST — kill switch `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED='false'` reverts to legacy behavior for rollback).

**Sequential Context-Aware Generation cost shape** (default-on via `EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED='true'`): adds one coordinator call up-front (~$0.0005 at gpt-4.1-nano output ≈ paragraphCount × 350 chars of plan JSON) AND grows the per-paragraph rewrite + rank prompt lengths triangularly because each round embeds PRIOR CONTEXT (paragraphs 0..i-1, capped at 6 paragraphs and `PRIOR_PICKS_MAX_CHARS=32000`). Cost envelope at defaults rises from ~$0.011 (legacy parallel) to ~$0.012–0.015 (sequential) depending on parent length. The per-invocation safety cap correspondingly bumps from `LEGACY_PER_INVOCATION_CAP_USD=0.05` to `SEQUENTIAL_PER_INVOCATION_CAP_USD=0.060`. Low-cap dispatchers can opt back into legacy via the `PARAGRAPH_RECOMBINE_SEQUENTIAL_OPT_OUT` allowlist (B.5 carve-out).

| Knob | Default | Range | Effect |
|---|---|---|---|
| `rewritesPerParagraph` | 3 | 1-6 | Number of parallel rewrites per slot. Cost ∝ N × M (rewrite) + N × M × maxComp (rank). |
| `maxComparisonsPerParagraph` | 8 | 1-20 | Per-slot ranking depth cap. Within-slot binary search early-exits before hitting this. |
| `maxParagraphsPerInvocation` | 12 | 1-50 | Hard cap on N. Articles with > N paragraphs only process the first N (per `extractParagraphsWithRanges`). |
| `paragraphRewriteModel` | inherits `generationModel` | any model id | Override for the per-paragraph rewrite calls (judge calls always use strategy `judgeModel`). |

**Cost envelope at defaults** (gpt-4.1-nano + qwen, 12 slots × 3 rewrites × 8 comparisons):
- Rewrite layer: ~$0.006
- Per-slot ranking layer: ~$0.005
- Total: **~$0.011/variant**

**Cost projection** (`estimateParagraphRecombineCost`): math-direct sum with a 1.3× upper-bound margin. Wizard preview surfaces a single `paragraph_recombine` line item via `EstPerAgentValue.paragraphRecombine`.

**Strategy/experiment-level rollups**: `total_paragraph_recombine_cost` (sum) and `avg_paragraph_recombine_cost_per_run` (avg).

#### Multi-dispatch (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529, Option J)

Pre-J the agent ran EXACTLY 1 invocation per iteration regardless of iteration budget. Strategies that set `iterationConfig.maxDispatches > 1` + `sourceMode: 'pool'` now opt into K-dispatch: the loop selects K distinct parents from the `qualityCutoff`-filtered eligible set and runs them in parallel + sequential top-up, mirroring the `generate` iteration's RUNTIME pattern (`resolveParallelFloor` is projector-only; only `resolveSequentialFloor` is consulted at runtime). Both budget-floor methods (fraction-of-budget + multiple-of-agent-cost) are honored via the existing strategy-level floor fields, with optional per-iteration overrides (`iterCfg.{parallelFloor,sequentialFloor}{Fraction,AgentMultiple}`) for distinct floor profiles within a single strategy. `maxDispatches` defaults to 1 → exact back-compat.

**Wizard projector qualityCutoff alignment** (`analyze_effectiveness_paragraph_recombine_20260530` Phase 7): pre-fix, the wizard's dispatch projector (`projectDispatchPlan.ts`) read `maxDispatches` but used the FULL `poolSize` as the eligibility ceiling — ignoring `qualityCutoff`. The runtime correctly applies `qualityCutoff` at `runIterationLoop.ts:1303-1318`. Result: the wizard preview could show `expectedTotalDispatch=1` while the runtime actually dispatched up to `qualityCutoff.value` invocations. Phase 7 adds `resolveParagraphRecombineEligibility({ sourceMode, qualityCutoff, poolSize })` mirroring the runtime filter so wizard preview matches runtime dispatch counts. Known limitation: projector `poolSize` includes arena-pre-loaded variants from `loadArenaEntries`; runtime filters those out — so the projector can over-estimate when `ctx.initialPoolSize > 0`.

#### Projector-vs-actual accuracy (Options G4–G7)

Per Round 1+2 of `investigate_paragraph_rewrite_cost_undershoot_evolution_20260529`, actual median spend on staging was `$0.0048` vs projector `expected = $0.0093` — about 50% of projection. When the projector is RECOMPUTED with each invocation's actual inputs (parent length, slot count, output chars), it predicts actual within 1–7% — the math is mechanically correct. The 50% gap is entirely from inputs:

| Contributor | Share of projector→actual gap | Mechanism |
|---|---|---|
| **Rewrite drops collapsing per-slot rank pool** | **53–98% (dominant)** | Projector assumes `min(M, cap) = 3` comparisons per surviving rewrite; reality is 0–1 when slots end with 1 surviving rewrite (16.7% of slots pre-I3). Fixed by Options I3a+I3b (hard char-count directive + per-index temperature override). |
| **Shorter actual rewrite outputs** | 11–32% | Projector assumes 1000 chars/rewrite; actuals are 620–790 chars. |
| **Fewer slots than the 12-cap** | 0–30% | Shorter articles produce fewer slots. |

The new run-level metrics that paragraph_recombine joins automatically (no finalization.ts changes needed — the existing `computeCostEstimationErrorPct` + `computeEstimatedCost` iterate ALL invocation details agnostic to agent_name):

- `cost_estimation_error_pct` — top-level error %.
- `estimated_cost` — top-level projector `expected`.
- New per-phase rollups: `paragraph_rewrite_estimation_error_pct`, `paragraph_rank_estimation_error_pct` + their `avg_*` propagation to strategy/experiment.

#### Option L — Coordinator mid-sequence replan (investigate_sequential_paragraph_recombine_performance_20260615 Phase 2)

After slot 0 finalizes, the coordinator is re-called with `priorPicks + firstSlot=1` so slots 1..N-1's directives match the chosen opener voice. **Unconditional** — the env flag introduced during planning was retired before merge. Cost impact: **~$0.0014 per invocation** — one additional `paragraph_recombine_coordinator_replan` LLM call (label split from the initial coordinator so cost-error tracking attributes them distinctly). Auto-disabled per-invocation when `perInvocationCapUsd < REPLAN_MIN_CAP_USD = 0.030` to avoid pushing the next slot into budget-exhausted fallback. **Projector NOT updated in this iteration** — `estimateParagraphRecombineCost` will systematically under-project by the replan cost; tracked as the next item on this project's backlog. Counters surface via `execution_detail.sequentialCounters.{replanCount, replanFailureCount, replanSkippedCount, replanSkippedReason}`. See `evolution/docs/paragraph_recombine.md` Sequential perf tuning section for the full design.

### Budget-Aware Dispatch

The orchestrator computes two budget floors from strategy config:
- `parallelFloor` — parallel generation dispatches only up to `budget - parallelFloor` worth of agents
- `sequentialFloor` — sequential generation stops when the next agent would breach this floor

Each floor may be specified in either of two mutually-exclusive units (StrategyConfig fields):
- **Fraction of budget**: `minBudgetAfterParallelFraction` / `minBudgetAfterSequentialFraction` (0-1). Resolves to `budget × fraction`.
- **Multiple of agent cost**: `minBudgetAfterParallelAgentMultiple` / `minBudgetAfterSequentialAgentMultiple` (≥ 0). Resolves to `estAgentCost × N`. Parallel uses the initial `estimateAgentCost()` output. Sequential uses `actualAvgCostPerAgent` once available (live feedback from the parallel batch), falling back to the initial estimate.

Legacy field names `budgetBufferAfterParallel` / `budgetBufferAfterSequential` are migrated to `minBudgetAfter*Fraction` automatically via Zod preprocess, and kept as output aliases for one release cycle to enable safe rollback.

```
|--- Parallel (budget > parallelFloor) ---|--- Sequential (budget > sequentialFloor) ---|--- Swiss ---|
```

After the parallel batch, runtime feedback (`actualAvgCostPerAgent` from completed agents) replaces the empirical estimate for sequential dispatch decisions.

### Estimation Feedback Loop

Each generateFromPreviousArticle invocation records `estimatedCost` and `estimationErrorPct` in its `execution_detail` JSONB for post-hoc analysis. The per-phase `generation.cost` and `ranking.cost` in execution_detail use scope-isolated `getOwnSpent()` deltas (not shared `getTotalSpent()` deltas) so they reflect only this agent's own LLM spend under parallel dispatch. Query via:
```sql
SELECT (execution_detail->'generation'->>'estimatedCost')::NUMERIC,
       (execution_detail->>'estimationErrorPct')::NUMERIC
FROM evolution_agent_invocations WHERE agent_name = 'generate_from_previous_article';
```

Finalization rolls these up into run-level metrics (`cost_estimation_error_pct`,
`estimated_cost`, `generation_estimation_error_pct`, `ranking_estimation_error_pct`,
`estimation_abs_error_usd`) and strategy/experiment propagation metrics. The
**Cost Estimates tab** on run and strategy detail pages (see
[Visualization](./visualization.md)) renders these plus a projected-vs-actual
**Budget Floor Sensitivity** module that answers: *how many extra/fewer sequential
invocations ran (and how much wall time was added/saved) because we over/under-
estimated agent invocation cost?*

### Cost Calibration Table (shadow-deploy, 2026-04-14)

Adds a DB-backed replacement for the hardcoded `EMPIRICAL_OUTPUT_CHARS` and
`OUTPUT_TOKEN_ESTIMATES` constants so calibration updates don't require code deploys.

- **Table:** `evolution_cost_calibration` keyed on
  `(strategy, generation_model, judge_model, phase)` (column named `strategy` for backward compat; values are tactic names).
- **Refresh:** `evolution/scripts/refreshCostCalibration.ts` (daily cron) aggregates
  the last `COST_CALIBRATION_SAMPLE_DAYS` days (default 14) of
  `evolution_agent_invocations.execution_detail` into per-slice upserts.
- **Loader:** `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` — in-memory
  singleton Map with `COST_CALIBRATION_TTL_MS` (default 5 min) TTL. Promise-coalesced
  refresh for thundering-herd protection. Distinct fallback paths for row-missing
  (silent) vs DB error (log + last-known-good). Aggregated 60s-window
  observability log (`cost_calibration_lookup`).
- **Kill switch:** `COST_CALIBRATION_ENABLED` env var (default `'false'`). When unset
  or `'false'`, the loader returns null and `estimateCosts.ts` + `createEvolutionLLMClient.ts`
  use the existing hardcoded constants — identical to pre-calibration behavior.
  Flip to `'true'` only after two weeks of populated data and verification via the
  Cost Estimates tab.

---

## LLM Pricing Table

**File:** `src/config/llmPricing.ts`

Prices per 1M tokens (USD). The table includes 30+ model entries; these are the ones most relevant to evolution runs:

| Model               | Input / 1M | Output / 1M |
|---------------------|-----------|-------------|
| qwen-2.5-7b-instruct (**default judge**) | $0.04 | $0.10 |
| qwen/qwen3-8b      | $0.05     | $0.40       |
| gpt-5-nano          | $0.05     | $0.40       |
| google/gemini-2.5-flash-lite | $0.10 | $0.40 |
| gpt-4.1-nano        | $0.10     | $0.40       |
| gpt-4.1-mini        | $0.40     | $1.60       |
| gpt-4.1             | $2.00     | $8.00       |
| gpt-4o              | $2.50     | $10.00      |
| gpt-4o-mini         | $0.15     | $0.60       |
| deepseek-chat       | $0.28     | $0.42       |
| claude-sonnet-4     | $3.00     | $15.00      |
| Unknown (fallback)  | $10.00    | $30.00      |

Model lookup uses exact match first, then longest-prefix match (e.g., `gpt-4o-2024-11-20` matches the `gpt-4o` entry). Unknown models fall back to conservative default pricing ($10/$30 per 1M tokens).

Key functions:
- `getModelPricing(model: string): ModelPricing` -- returns `{ inputPer1M, outputPer1M, reasoningPer1M?, cachedInputPer1M? }`
- `calculateLLMCost(model, promptTokens, completionTokens, reasoningTokens?, cachedPromptTokens?): number` -- returns USD rounded to 6 decimal places
- `formatCost(cost: number): string` -- `$0.0042` for sub-cent, `$1.23` otherwise

The pricing table also includes reasoning models (o1, o3-mini) with a separate `reasoningPer1M` field. When present, reasoning tokens are billed at this rate in addition to the standard input/output costs. The evolution pipeline does not currently use reasoning models, but the pricing infrastructure supports them for future use.

**Context caching (`cachedInputPer1M`).** Some providers (e.g. DeepSeek V4: `deepseek-v4-pro`, `deepseek-v4-flash`) bill cache-hit prompt tokens at a much lower rate than cache-miss tokens — for DeepSeek the cache-hit rate is 50-120x cheaper. When a model entry sets `cachedInputPer1M`, `calculateLLMCost` bills the cache-hit subset (`cachedPromptTokens`) at that rate and the remainder at `inputPer1M`; models without the field bill all prompt tokens at `inputPer1M` (unchanged). The cache-hit count flows from the provider's `usage.prompt_cache_hit_tokens` through `RawProviderUsage.cachedPromptTokens` so the evolution budget gate bills cache-aware, not just the `llmCallTracking` row. Pre-flight reservations still assume 0% cache hits (conservative); the reserve→spend→reconcile loop trues up to the cache-aware actual.

Note that the evolution pipeline's `llm-client.ts` imports `getModelPricing` from this shared config file rather than maintaining its own pricing. This ensures a single source of truth for all cost calculations across the application.

---

## Prompt Editor spend (tool_test_rewrite_prompts_evolution_20260605)

The Prompt Editor (`/admin/evolution/prompt-editor`) runs single `callLLM` rewrites with
`call_source='evolution_prompt_editor'`. The `evolution_` prefix routes its spend into the **shared
daily `evolution` budget category** (same cap as real pipeline runs) and engages the LLM semaphore.
It records `llmCallTracking` rows like any app LLM call but writes **no** evolution-pipeline cost
metrics (no run/invocation). A per-run **pre-flight cap** (`PROMPT_EDITOR_PER_RUN_CAP_USD = $0.50`,
`evolution/src/lib/promptEditor/runPromptEditor.ts`) estimates Σ `calculateLLMCost(model, prompt.length/4,
cappedOutputTokens)` and rejects (HTTP 402) before any call; the global `LLMSpendingGate` is the hard
backstop. Disable entirely via `EVOLUTION_PROMPT_EDITOR_ENABLED='0'`. See [prompt_editor.md](./prompt_editor.md).

## Layer 2: Global LLM Spending Gate

**File:** `src/lib/services/llmSpendingGate.ts`

The `LLMSpendingGate` is a singleton that enforces system-wide daily and monthly caps. It sits in the main application (not the `evolution/` subtree) because it guards all LLM calls across the system.

### Check Sequence

Each call to `checkBudget(callSource, estimatedCostUsd?)` executes:

1. **Kill switch check** (5s cache TTL) -- If `kill_switch_enabled` is true in `llm_cost_config`, throws `LLMKillSwitchError` immediately.

2. **Category routing** -- `callSource` starting with `evolution_` routes to the `evolution` category with its own daily cap; everything else goes to `non_evolution`.

3. **Fast path** (30s cache TTL) -- If cached spending is well below the daily cap (10% headroom), approves the daily check without a DB round-trip, then falls through to the monthly cap check.

4. **Near-cap path** -- When spending is close to the cap or cache is cold, calls `check_and_reserve_llm_budget` RPC for an atomic DB reservation. Throws `GlobalBudgetExceededError` if denied.

5. **Monthly cap check** (60s cache TTL) -- Always runs (including after the fast path). Verifies cumulative monthly spend against `monthly_cap_usd`. Throws `GlobalBudgetExceededError` if exceeded.

6. **Post-call reconciliation** -- `reconcileAfterCall()` runs in a `finally` block. It calls `reconcile_llm_reservation` RPC to release the reservation and update actual spend. Failures are logged but not re-thrown (non-fatal). The cache for the relevant category is also invalidated so the next call gets a fresh spending snapshot.

The gate uses a singleton pattern via `getSpendingGate()`. The in-memory caches (spending, kill switch, monthly) are instance-level, so they are shared across all concurrent requests within the same Node.js process. Call `invalidateCache()` if you need to force a fresh read from the database (e.g., after changing config values).

### Config Keys

Stored in the `llm_cost_config` table:

| Key                     | Default | Description                    |
|-------------------------|---------|--------------------------------|
| `daily_cap_usd`         | $50     | Non-evolution daily limit      |
| `evolution_daily_cap_usd` | $25   | Evolution daily limit          |
| `monthly_cap_usd`       | $500    | System-wide monthly limit      |
| `kill_switch_enabled`   | false   | Emergency stop for all LLM calls |

> **Warning:** The spending gate fails **closed** -- if the DB is unreachable, all LLM calls are blocked. This is intentional to prevent uncontrolled spending during outages.

---

## Error Hierarchy

Five error classes handle budget failures at different levels:

| Error                            | Scope          | Source File                                  |
|----------------------------------|----------------|----------------------------------------------|
| `BudgetExceededError`            | Per-run        | `evolution/src/lib/types.ts`                 |
| `IterationBudgetExceededError`   | Per-iteration  | `evolution/src/lib/pipeline/infra/trackBudget.ts` |
| `BudgetExceededWithPartialResults` | Per-run      | `evolution/src/lib/pipeline/errors.ts`       |
| `GlobalBudgetExceededError`      | System         | `src/lib/errors/serviceError.ts`             |
| `LLMKillSwitchError`            | System         | `src/lib/errors/serviceError.ts`             |

```typescript
// Per-run: thrown by V2CostTracker.reserve()
class BudgetExceededError extends Error {
  constructor(agentName: string, spent: number, reserved: number, cap: number);
}

// Per-run: thrown when budget runs out mid-phase but partial results exist
class BudgetExceededWithPartialResults extends BudgetExceededError {
  constructor(partialData: unknown, originalError: BudgetExceededError);
}
```

> **Warning:** `BudgetExceededWithPartialResults` extends `BudgetExceededError`. In `catch` blocks, check for `BudgetExceededWithPartialResults` **before** `BudgetExceededError`, or the subclass will be caught by the parent and the partial data will be lost. This is a common source of bugs. The `partialData` field is typed as `unknown` and may contain either `Variant[]` (from the generation phase) or `RankResult` (from the ranking phase). Callers must inspect the data to determine which type they received.

The global errors (`GlobalBudgetExceededError` and `LLMKillSwitchError`) both extend `ServiceError` from the main app's error infrastructure. They carry structured `details` (category, daily totals, caps) that can be logged or surfaced in admin UI. The kill switch error has no constructor parameters -- it always produces the same message ("LLM kill switch is enabled -- all LLM calls are blocked").

When handling errors in pipeline code, the typical pattern is:

1. Catch `BudgetExceededWithPartialResults` -- save the partial variants to the database, mark the run as `completed` with exit reason `budget`
2. Catch `BudgetExceededError` -- no partial results available, mark the run as `failed`
3. Catch `LLMKillSwitchError` -- abort immediately, do not retry
4. Catch `GlobalBudgetExceededError` -- log the cap details, mark the run as `failed`

---

## Agent Cost Scope Pattern

Under parallel agent dispatch, a shared `V2CostTracker` serves two purposes: **budget gating** (must be shared, synchronous `reserve()`) and **cost attribution** (should be per-agent). Without isolation, `getTotalSpent()` deltas absorbed sibling agents' costs — `cost_usd` on invocations was timing-dependent and could be nearly double the true value.

**Solution:** `createAgentCostScope(shared: V2CostTracker): AgentCostScope` (in `trackBudget.ts`) wraps the shared tracker in a per-invocation scope:

- `reserve()`, `release()`, `getTotalSpent()`, `getAvailableBudget()`, `getPhaseCosts()` — **delegated** to shared tracker; budget gating is unchanged
- `recordSpend()` — **intercepted**: calls shared tracker AND increments a private `ownSpent` counter
- `getOwnSpent()` — returns only this scope's LLM costs, independent of other agents

`Agent.run()` creates a scope per invocation, passes it as `costTracker` in `extendedCtx`, AND **builds the `EvolutionLLMClient` inside the scope** (from `ctx.rawProvider` + `ctx.defaultModel` via `createEvolutionLLMClient`). The per-invocation client's `recordSpend` calls go through the scope's intercept, so `scope.getOwnSpent()` is authoritative. `MergeRatingsAgent` opts out via `usesLLM = false` since it doesn't make LLM calls.

The `cost_usd` written to `evolution_agent_invocations` comes from `scope.getOwnSpent()` — the direct sum of this invocation's `recordSpend` calls, with no sibling cost bleed even under parallel dispatch. `detail.totalCost` is still populated (Agent.run falls back to it when `getOwnSpent()` returns 0, as with MergeRatingsAgent which makes no LLM calls).

### LLMSpendingGate singleton scope (B082, 2026-04-23)

The `LLMSpendingGate` is a module-level singleton — meaning each Vercel serverless container (or Node process) holds its own in-memory cache. On a cold start the cache is empty; warm containers accumulate cache entries over the TTL (5s kill switch / 30s daily / 60s monthly). Two concurrent requests landing on different containers can thus see divergent cache state, and under high burst load the cache may briefly under-read the shared DB state. **The RPC (`check_and_reserve_llm_budget`) remains the authoritative gate** — it enforces the cap atomically at reservation time. The in-memory cache is a performance optimization that fails safely toward the RPC.

Switch to a distributed cache (Redis/KV) only if over-spend is observed in practice. The concrete signal to watch: track the ratio of `reserved_before_rpc_spend / rpc_spend` in a Honeycomb dashboard (filter to `service:llm-spending-gate`) over a 7-day rolling window. If that ratio exceeds 1.05 for any day, the singleton-divergence hypothesis has evidence and a KV-backed cache is warranted.

### Invariant: every cost-tracker caller routes through AgentCostScope (B012, 2026-04-23)

After the Phase 6 bug-fix pass (scan_codebase_for_bugs_20260422), **every cost-tracker caller must route through `AgentCostScope`**. `getTotalSpent()` is no longer part of the `AgentCostScope` type — any caller that needs per-scope cost attribution uses `getOwnSpent()`. Removing `getTotalSpent()` from the scope type means the TypeScript compiler catches any missed caller at the type-boundary (TS2551 / TS2339 on `.getTotalSpent()`), providing automatic exhaustiveness. `rankNewVariant.ts` previously had a `getOwnSpent?.() ?? getTotalSpent()` fallback — that is the code path the B012 fix removed. If a caller genuinely needs the run-total (e.g. for budget-tier calculation), it reads it from the underlying `V2CostTracker` that the scope wraps, not from the scope itself.

---

## Budget Event Logging

> **Note:** The `evolution_budget_events` table was dropped during the V2 schema consolidation and no longer exists. The reserve/spend/release pattern is still used in-memory by the `V2CostTracker` (see Layer 1 above), but individual budget events are no longer persisted to a dedicated table. Cost auditing now relies on `evolution_agent_invocations` records and the cost aggregation mechanisms described below.

The conceptual model remains: every LLM call follows a reserve-before-spend lifecycle (`reserve` → `spend` or `release`). The `V2CostTracker` tracks these operations in-memory per run. For post-mortem analysis of budget usage, use the per-run cost summary stored on the `evolution_runs` row and the per-invocation costs in `evolution_agent_invocations`.

### EntityLogger Integration

When an `EntityLogger` instance is passed to `createCostTracker`, budget events are logged as structured log entries with `phaseName: 'budget'`. The following events are emitted:

- **`reserve`** — Logged on each budget reservation with estimated cost and margined amount.
- **`spend`** — Logged when actual cost is recorded after a successful LLM call.
- **`overrun`** — Logged at `warn` level when actual spend exceeds the reserved amount.
- **50% threshold** — Logged at `info` level when cumulative spend crosses 50% of the run budget.
- **80% threshold** — Logged at `warn` level when cumulative spend crosses 80% of the run budget.

Each log entry includes context fields such as `budgetFraction`, `spent`, `reserved`, and `budgetUsd` for post-mortem analysis.

### Controlling Log Volume

The `EVOLUTION_LOG_LEVEL` environment variable (default: `info`) acts as a kill switch for pipeline log volume. Set to `warn` or `error` to suppress `debug` and `info` budget event logs in high-throughput environments. See [Reference — Environment Variables](./reference.md#environment-variables) for details.

---

## Cost Aggregation

**Migration:** `supabase/migrations/20260319000001_evolution_run_cost_helpers.sql`

Three mechanisms aggregate costs from the `evolution_agent_invocations` table:

1. **`get_run_total_cost(p_run_id UUID)`** -- PostgreSQL function (SECURITY DEFINER) returning `COALESCE(SUM(cost_usd), 0)` for a single run. Restricted to `service_role`.

2. **`evolution_run_costs` view** -- Aggregates `SUM(cost_usd)` grouped by `run_id` for batch queries (e.g., admin list pages).

3. **`idx_invocations_run_cost`** -- Covering index on `(run_id, cost_usd)` so cost aggregation queries scan the index without touching the heap.

---

## Cost Analytics (Admin Dashboard)

**File:** `evolution/src/services/costAnalytics.ts`

Server actions for the admin dashboard, all requiring admin authentication:

- **`getCostSummaryAction(filters?)`** -- Returns `totalCost`, `totalCalls`, `totalTokens`, `avgCostPerCall` for a filtered time range (default: last 30 days). Also reports `nullCostCount` for records missing cost data.

- **`getDailyCostsAction(filters?)`** -- Daily breakdown from the `daily_llm_costs` database view. Returns `{ date, callCount, totalTokens, totalCost }[]`.

- **`getCostByModelAction(filters?)`** -- Per-model breakdown with `promptTokens`, `completionTokens`, `reasoningTokens`, and `totalCost`. Sorted by cost descending.

- **`getCostByUserAction(filters?)`** -- Top spenders with `userId`, `callCount`, `totalTokens`, `totalCost`. Accepts `limit` (default 20).

- **`backfillCostsAction(options?)`** -- One-time backfill for records with NULL `estimated_cost_usd`. Processes in batches (default 500), supports `dryRun` mode. Logs an audit action on completion.

- **`getSpendByGranularityAction` / `getCostByEntityAction` / `getEvolutionReconciliationAction`** (build_llm_spending_tab_in_admin_dash_20260620) -- power the tabbed `/admin/costs` dashboard. The first two read the `get_llm_spend_buckets(p_granularity, p_start, p_end, p_include_test)` RPC (`date_trunc` hour/day/week; SECURITY DEFINER, search_path-pinned, service_role-only) and fold `call_source → { entity, category }` via `attributeCallSource` (`src/lib/services/llmCostAttribution.ts`). The reconciliation action compares the `llmCallTracking`-based evolution total against `evolution_agent_invocations.cost_usd` to surface the per-call audit-gap (see the caveat at the top of this doc).

> **`is_test` discriminator + mandatory attribution.** `llmCallTracking` has an `is_test` boolean set at the single `saveLlmCallTracking` chokepoint via `isTestLlmCall`. As of debug_llm_spending_data_issues_stage_20260621 it is driven by test RUNTIME signals — `NODE_ENV=test`, `E2E_TEST_MODE`, `LLM_TRACKING_TEST_RUNTIME` (prod-ai harness), `integration_test`/`generation` sources, mock fingerprint — **NOT by userid** (system userids `…000`/`…001` are real offline-tool/evolution spend and must count). `call_source` is a branded `CallSource` (`src/lib/services/llmCallSource.ts`) producible only via the `CALL_SOURCES` registry / `evolutionSource()` / `testSource()` factories — enforced by tsc, a blocking ESLint rule, a runtime guard, AND a new `npm run check:llm-coverage` CI guard that catches direct-SDK / direct-`llmCallTracking.insert` bypasses. The offline `oneshotGenerator.ts` writes `llmCallTracking` directly (documented self-tracker, allowlisted in the coverage guard) with a bounded `call_source` and `is_test` derived (no longer hard-`true`).

---

## Orphaned Reservation Cleanup

**File:** `evolution/src/lib/ops/orphanedReservations.ts`

When a process crashes mid-run, budget reservations in the global spending gate can become orphaned -- permanently blocking that budget capacity. The cleanup function delegates to the gate's `cleanupOrphanedReservations()` method, which calls the `reset_orphaned_reservations` database RPC:

```typescript
export async function cleanupOrphanedReservations(): Promise<void> {
  const gate = getSpendingGate();
  await gate.cleanupOrphanedReservations();
}
```

This should be called periodically (e.g., on server startup or via a scheduled job) to reclaim leaked reservations.

Orphaned reservations are a natural consequence of the two-layer model: the global gate reserves capacity in the database, but if the process crashes between reservation and reconciliation, that capacity is permanently locked. The `reset_orphaned_reservations` RPC identifies reservations that have been held longer than a threshold (typically based on stale timestamps in the `daily_cost_rollups` table) and releases them back to the available pool. Without periodic cleanup, a series of crashes could gradually reduce the effective daily cap to zero.

See [Agents](./agents/overview.md) for how individual agents interact with the budget system.
