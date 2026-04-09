# Fix Cost Reporting Evolution Generation Plan

## Background
We want accurate generation vs. ranking costs for the `generateFromSeedArticle` agent, which currently approximates these as a 50/50 split in `persistRunResults.finalizeRun()`. We also want to see costs broken down by generation vs. ranking at the top level (entity list overview pages and metrics tab) for both strategy and run entities.

## Requirements (from GH Issue #931)
- Accurate generation vs. ranking costs for the `generateFromSeedArticle` agent (currently approximated 50/50).
- Cost breakdown by generation vs. ranking visible at top-level entity list overview pages.
- Cost breakdown by generation vs. ranking visible on the metrics tab.
- Apply at both strategy and run entity levels.

## Problem
`evolution/src/lib/pipeline/finalize/persistRunResults.ts:295-321` buckets `evolution_agent_invocations.cost_usd` by `agent_name` and applies a hardcoded `cost / 2` split for `generate_from_seed_article` rows. The agent already labels its LLM calls correctly (`'generation'` vs `'ranking'` passed as the second arg to `llm.complete`), and the in-memory `V2CostTracker.phaseCosts` already accumulates these accurately and race-free per phase key. The persisted `agentCost:*`/`cost` rows in `evolution_metrics` are written via last-write-wins upserts and can suffer lost-update races under concurrent LLM calls. Dynamic `agentName` strings are stringly-typed at every call site, so a typo silently routes cost to a phantom bucket. Finally, the codebase has TWO parallel metric registries (`evolution/src/lib/metrics/registry.ts` `METRIC_REGISTRY` and `evolution/src/lib/core/entityRegistry.ts` Entity-class-based) that must be kept in sync until consolidated.

## Approach (final)

Eliminate the **per-LLM-call** dynamic prefix usage in `createLLMClient.ts` (where the gen/rank race lives) and replace with statically-declared, typed cost metrics — one per LLM call purpose. Leave `DynamicMetricName` alive in `metrics/types.ts` for the **separate** per-agent-class aggregation pathway in `experimentMetrics.ts`, which buckets by invocation `agent_name` (e.g. `agentCost:generate_from_seed_article`) at a different granularity from the per-purpose (`'generation'`, `'ranking'`) we care about. Document the two namespaces explicitly.

Concretely:
- Define typed `AgentName = 'generation' | 'ranking' | 'seed_title' | 'seed_article'` union and `COST_METRIC_BY_AGENT: Record<AgentName, MetricName>` lookup.
- Add 4 static catalog entries for run-level per-purpose costs (`generation_cost`, `ranking_cost`, `seed_title_cost`, `seed_article_cost`) plus 2 propagated avg entries (`avg_generation_cost_per_run`, `avg_ranking_cost_per_run`). Repurpose existing catalog `total_generation_cost`/`total_ranking_cost` from `at_finalization` to `at_propagation` timing once they're removed from RunEntity.
- Tighten `LLMProvider.complete`, `costTracker.recordSpend`, `costTracker.getPhaseCosts`, AND `ExecutionContext.phaseName` to take/return `AgentName` instead of `string`.
- Update **both** registries: the entity classes (`RunEntity.ts`, `StrategyEntity.ts`, `ExperimentEntity.ts`) AND `evolution/src/lib/metrics/registry.ts` `METRIC_REGISTRY`. Add a follow-up note to consolidate them.
- `createLLMClient.ts` writes via the typed `COST_METRIC_BY_AGENT` lookup using a new `writeMetricMax` wrapper backed by an `upsert_metric_max` Postgres RPC (`ON CONFLICT DO UPDATE SET value = GREATEST(...)`) to fix the lost-update race. Preserve the existing try/catch non-fatal semantics.
- Run-level metrics: `cost`, `generation_cost`, `ranking_cost` declared on `duringExecution` with `listView: true`. (`seed_*_cost` declared but `listView: false`.)
- Strategy/experiment-level metrics: 4 new propagated metrics (`total_generation_cost`, `avg_generation_cost_per_run`, `total_ranking_cost`, `avg_ranking_cost_per_run`) on both `StrategyEntity.atPropagation` and `ExperimentEntity.atPropagation`. Mirror in `metrics/registry.ts` `SHARED_PROPAGATION_DEFS`.
- Delete the 50/50 block from `persistRunResults.ts` entirely. No replacement — the run-level `generation_cost`/`ranking_cost` rows are already correct at finalization time because they were written live during execution by `createLLMClient` via `writeMetricMax`. Propagation reads them and aggregates up.
- Initialize cost metric rows to 0 at run start so propagation correctly handles runs that fail before any LLM call. Use `writeMetricMax` so the zero never overwrites a real value (`GREATEST` keeps the larger).
- Document run retry/replay semantics: a re-claimed run starts with a fresh in-memory tracker; any earlier attempt's `agentCost:*` rows would have been written in a prior process. Under `GREATEST`, those stale larger values would NOT be overwritten by the new attempt's smaller values until the new attempt surpasses them. **Decision: this project assumes runs are not resumed mid-execution.** If retry/resume becomes needed, add an explicit reset RPC that DELETEs the cost metric rows for a run before restart.

## Options Considered

- [x] **Option A: Eliminate dynamic prefix at the per-LLM-call site; static typed metrics; race-fixed live writes (CHOSEN).** Single source of truth at run level (live writes via `writeMetricMax`). No `EvolutionResult` plumbing. No 50/50 finalization fallback. Typed `AgentName` provides compile-time safety. Generalizes cleanly to any future per-purpose cost. Leaves the unrelated per-agent-class dynamic-prefix usage in `experimentMetrics.ts` alone.

- [ ] **Option B: Plumb `phaseCosts` through `EvolutionResult` to `finalizeRun`; keep dynamic `agentCost:*` prefix for live UI.** Keeps two parallel mechanisms. More plumbing. Leaves the dynamic prefix's underlying problems (no type safety, no list columns, no propagation source) unresolved. Rejected.

- [ ] **Option C: Extend `metricColumns.tsx` to surface dynamic-prefix entries as list columns.** Bigger than the cleanup it avoids; collapses into option (A) anyway. Rejected.

- [ ] **Option D: Promote two specific keys to static while leaving other `agentCost:*` dynamic.** Asymmetric category split. Rejected.

- [ ] **Option E: Fully eliminate `DynamicMetricName` everywhere including `experimentMetrics.ts`.** Requires refactoring an unrelated aggregation pathway that buckets by agent class (e.g. `agentCost:generate_from_seed_article`), not by per-call purpose. Out of scope; would expand the project significantly without addressing the original ask. Rejected.

- [ ] **Option F: Add `task_type` column to `evolution_agent_invocations` and create one row per LLM call.** Most general but biggest blast radius. Rejected.

## Phased Execution Plan

### Phase 1: Eliminate per-LLM-call dynamic prefix; introduce typed `AgentName`

#### 1a. Define the typed types
- [ ] Create `evolution/src/lib/core/agentNames.ts`:
  ```typescript
  import type { MetricName } from '../metrics/types';

  // All four labels are valid AgentName values so the typed parameter accepts every
  // current call site (incl. seed-phase calls in generateSeedArticle.ts which still
  // need 'seed_title'/'seed_article'). Only generation and ranking get persisted as
  // dedicated cost metrics — seed-phase costs roll up into the run's overall `cost`.
  export const AGENT_NAMES = ['generation', 'ranking', 'seed_title', 'seed_article'] as const;
  export type AgentName = typeof AGENT_NAMES[number];

  /** Maps each agent label to its run-level per-purpose cost metric.
   * Partial: 'seed_title'/'seed_article' are intentionally omitted — their costs are
   * tracked only via the run's aggregate `cost` metric, not per-purpose. */
  export const COST_METRIC_BY_AGENT: Partial<Record<AgentName, MetricName>> = {
    generation: 'generation_cost',
    ranking: 'ranking_cost',
  };
  ```
- [ ] In `evolution/src/lib/metrics/types.ts`, ADD only the 4 names actually used to `STATIC_METRIC_NAMES` (existing `total_generation_cost`/`total_ranking_cost` already present):
  ```
  'generation_cost', 'ranking_cost',
  'avg_generation_cost_per_run', 'avg_ranking_cost_per_run',
  ```
  No `seed_title_cost`/`seed_article_cost` entries — those metrics are not written by this project.
- [ ] **Do NOT delete `DynamicMetricName`** — it's still used by `experimentMetrics.ts` line 16 for per-agent-class aggregation (`agentCost:generate_from_seed_article`, etc.) which is a separate namespace from per-purpose. Add a docstring above `DynamicMetricName` clarifying its scope: "Used for per-agent-class cost aggregation in `experimentMetrics.ts` only. Per-LLM-call cost attribution uses static `*_cost` names via `COST_METRIC_BY_AGENT`."

#### 1b. Tighten the type signatures (cascade)
- [ ] `evolution/src/lib/pipeline/infra/createLLMClient.ts` — change `complete(prompt: string, agentName: string, ...)` to `complete(prompt: string, agentName: AgentName, ...)` on the returned client and any internal helpers.
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.ts` — change `recordSpend(phase: string, ...)` to `recordSpend(phase: AgentName, ...)`. Change `getPhaseCosts(): Record<string, number>` to `getPhaseCosts(): Partial<Record<AgentName, number>>`. Internal `phaseCosts` becomes `Partial<Record<AgentName, number>>`. The `reserve()` and `release()` `phase` params should also tighten to `AgentName`.
- [ ] `evolution/src/lib/metrics/types.ts` `ExecutionContext.phaseName` — change from `string` to `AgentName`.
- [ ] `evolution/src/lib/metrics/types.ts:86` `ExecutionContext.costTracker` — the inline structural type currently declares `getPhaseCosts(): Record<string, number>`. Tighten to `getPhaseCosts(): Partial<Record<AgentName, number>>` so it matches `V2CostTracker`'s narrowed return type. Without this, structural assignment fails when V2CostTracker is passed where ExecutionContext.costTracker is expected.
- [ ] `evolution/src/lib/metrics/computations/finalization.ts:96` — `getPhaseCosts()[ctx.phaseName]` will still typecheck after both narrowings; verify.
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.ts:198-199` (the SINGLE `LLMProvider` interface declaration) — change `complete(prompt: string, label: string, ...)` to `complete(prompt: string, label: AgentName, ...)`. NOTE: Earlier plan revisions said "two LLMProvider interfaces" — this was wrong. There is exactly one interface (line 198-199) and one inline implementation (line 158-173 — an object literal that satisfies it). Both have `label: string` today; tighten the interface and the impl will narrow with it.
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.ts:159` (the inline impl) — change `label: string` to `label: AgentName`. Inside the wrapper, the `callLLM` call constructs `evolution_${label}` as the call_source string, which still works because template literal concatenation accepts the narrower type.
- [ ] `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:79-81` — `generateSeedArticle` declares `llm: { complete(prompt: string, label: string, opts?: ...) }` as a structural parameter. The seed phase passes `'seed_title'` and `'seed_article'` literals to `llm.complete`. Because `AgentName` includes those four labels (we kept them in the union per Phase 1a), the typed interface is compatible. **However**, the structural type at line 81 will fail to accept the tightened LLMProvider unless the structural type is also tightened — change the inline parameter type to `llm: { complete(prompt: string, label: AgentName, opts?: ...) }`. Both seed-phase calls (`'seed_title'` and `'seed_article'`) remain valid AgentName values.
- [ ] `evolution/src/testing/evolution-test-helpers.ts:515-528` (mock cost tracker) — verify the mock signature matches the new typed interface; update `getAllAgentCosts: Record<string, number>` (or similar) to `Partial<Record<AgentName, number>>` if it asserts the same shape, or widen to `Record<string, number>` and document why.
- [ ] Run `npx tsc --noEmit` and fix any remaining call-site narrowing errors.

#### 1c. Update agent call sites (literals, no behavior change)
- [ ] `evolution/src/lib/core/agents/generateFromSeedArticle.ts:207` — keeps `'generation'` literal; type narrows automatically.
- [ ] `evolution/src/lib/core/agents/SwissRankingAgent.ts:126` — keeps `'ranking'` literal; type narrows.
- [ ] `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:169` — keeps `'ranking'` literal; type narrows.
- [ ] `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:88` — keeps `'seed_title'` literal; type narrows.
- [ ] `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:97` — keeps `'seed_article'` literal; type narrows.
- [ ] `evolution/src/lib/pipeline/infra/createLLMClient.ts:32-36` (`OUTPUT_TOKEN_ESTIMATES`) — currently has an `'evolution'` key (legacy). Audit and remove any keys not in `AGENT_NAMES`. Keep the typed lookup safe.

#### 1d. Seed-phase cost handling (no new metrics)
**Background:** The setup-phase LLM calls in `generateSeedArticle.ts` go through `claimAndExecuteRun.ts:158-173`'s `LLMProvider` impl (which calls V1 `callLLM`), NOT `createV2LLMClient`. So `seed_title`/`seed_article` calls do NOT flow through `costTracker.recordSpend()` or `writeMetricMax`. They contribute to the run's total cost only via `evolution_agent_invocations.cost_usd` when the invocation row is written.

- [ ] **Decision: Keep `'seed_title'` and `'seed_article'` in `AGENT_NAMES` for type-safety at the call site, but add NO catalog entries / metric writes for them.** Their `COST_METRIC_BY_AGENT` lookup returns `undefined`, and `createLLMClient` skips the per-purpose write when `undefined`. Setup-phase costs stay accounted for via the run's aggregate `cost` metric (still written by V2 client for non-seed calls in the same run) plus the existing `evolution_agent_invocations.cost_usd` rollup. Wrapping setup-phase calls in V2LLMClient is a clean follow-up but out of scope.
- [ ] No changes needed to `generateSeedArticle.ts:88,97` literals other than the structural-type tightening in Phase 1b — `'seed_title'` and `'seed_article'` remain valid `AgentName` values.

#### 1e. EntityMetricsTab unknown-metric handling
- [ ] In `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`, KEEP `DYNAMIC_METRIC_PREFIXES` (still used by `experimentMetrics.ts`-emitted rows on strategy/experiment metrics tabs). Do NOT delete the `agentCost:` prefix branches in `resolveCategory`/`resolveLabel`/`resolveFormatter`. They're still needed for the per-agent-class aggregation pathway.
- [ ] Add a unit-test assertion that `EntityMetricsTab` correctly renders both `generation_cost` (new static) and `agentCost:generate_from_seed_article` (legacy dynamic) under the Cost group.

### Phase 2: Add static cost catalog entries + race-fixed write path

#### 2a. Catalog updates
- [ ] In `evolution/src/lib/core/metricCatalog.ts`, add 4 new catalog entries:
  ```typescript
  generation_cost: {
    name: 'generation_cost', label: 'Generation Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: true,
    description: 'LLM spend on generation calls in this run',
  },
  ranking_cost: {
    name: 'ranking_cost', label: 'Ranking Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: true,
    description: 'LLM spend on ranking calls in this run (incl. SwissRankingAgent + binary-search comparisons)',
  },
  avg_generation_cost_per_run: {
    name: 'avg_generation_cost_per_run', label: 'Avg Generation Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average generation_cost across child runs',
  },
  avg_ranking_cost_per_run: {
    name: 'avg_ranking_cost_per_run', label: 'Avg Ranking Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average ranking_cost across child runs',
  },
  ```
- [ ] **Update existing `total_generation_cost`/`total_ranking_cost` catalog entries** in `metricCatalog.ts:73-82`: change `timing: 'at_finalization'` to `timing: 'at_propagation'`. They'll be used as propagation target names on Strategy/Experiment, not as run-level finalization metrics. Update `description` to reflect aggregate semantics. Add `listView: true`. Rename `label: 'Generation Cost'` → `label: 'Total Generation Cost'` and `label: 'Ranking Cost'` → `label: 'Total Ranking Cost'` to disambiguate from the run-level `generation_cost`/`ranking_cost` labels and match the existing `total_cost` label "Total Cost" pattern.
- [ ] Update `metricCatalog.test.ts` if it asserts on the timing of these entries.

#### 2b. New Postgres RPC migration
- [ ] Create `supabase/migrations/20260408000001_upsert_metric_max.sql` (timestamp pinned to be after `20260328000001_create_lock_stale_metrics.sql` and the most recent existing migration):
  ```sql
  -- Atomic max-value upsert for monotonically-increasing metrics (cost, agentCost:*, etc.).
  -- Replaces last-write-wins upsert which loses concurrent updates.
  CREATE OR REPLACE FUNCTION upsert_metric_max(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_metric_name TEXT,
    p_value DOUBLE PRECISION,
    p_source TEXT
  ) RETURNS VOID
  LANGUAGE sql
  SECURITY INVOKER  -- service_role bypasses RLS already; no need for DEFINER
  SET search_path = public
  AS $$
    INSERT INTO evolution_metrics (entity_type, entity_id, metric_name, value, source, stale, updated_at)
    VALUES (p_entity_type, p_entity_id, p_metric_name, p_value, p_source, false, now())
    ON CONFLICT (entity_type, entity_id, metric_name) DO UPDATE
    SET value = GREATEST(evolution_metrics.value, EXCLUDED.value),
        source = EXCLUDED.source,
        stale = false,
        updated_at = now();
  $$;
  GRANT EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) TO service_role;
  ```
  - Confirms unique constraint exists at `supabase/migrations/20260323000003_evolution_metrics_table.sql:21` (`UNIQUE(entity_type, entity_id, metric_name)`). The RPC depends on it.
  - Uses `SECURITY INVOKER` (not `DEFINER`) since `service_role` already bypasses RLS in Supabase; minimizes privilege surface.

#### 2c. `writeMetricMax` wrapper
- [ ] Add `writeMetricMax(db, entityType, entityId, metricName, value, source)` to `evolution/src/lib/metrics/writeMetrics.ts`:
  - Validates timing via `getMetricDef(entityType, metricName)` from `metrics/registry.ts` the same way `writeMetric` does.
  - Calls `db.rpc('upsert_metric_max', { p_entity_type, p_entity_id, p_metric_name, p_value, p_source })`.
  - Returns nothing on success. Throws `ServiceError` on RPC error (matching `writeMetric` semantics).

#### 2d. Route `cost`/`generation_cost`/`ranking_cost` writes through `writeMetricMax`
- [ ] In `evolution/src/lib/pipeline/infra/createLLMClient.ts:85-100`, replace the existing `writeMetric` calls with `writeMetricMax`. **Preserve the existing try/catch non-fatal semantics**, and skip the per-purpose write when the agent isn't in `COST_METRIC_BY_AGENT`:
  ```typescript
  costTracker.recordSpend(agentName, actual, margined);
  if (db && runId) {
    try {
      await writeMetricMax(db, 'run', runId, 'cost', costTracker.getTotalSpent(), 'during_execution');
      const costMetricName = COST_METRIC_BY_AGENT[agentName];
      if (costMetricName) {
        await writeMetricMax(
          db, 'run', runId,
          costMetricName,
          costTracker.getPhaseCosts()[agentName] ?? 0,
          'during_execution',
        );
      }
    } catch (e) {
      logger.warn('Cost metric write failed (non-fatal)', { err: e instanceof Error ? e.message : String(e) });
    }
  }
  ```

### Phase 3: Update BOTH metric registries

The codebase currently has two parallel registries. This project updates both; consolidating them is a separate follow-up.

#### 3a. `metrics/registry.ts` METRIC_REGISTRY
- [ ] In `evolution/src/lib/metrics/registry.ts`, modify `METRIC_REGISTRY.run`:
  - `duringExecution`: change existing `cost` entry from `listView: false` to `listView: true`. Add new `generation_cost` and `ranking_cost` entries:
    ```typescript
    duringExecution: [
      { name: 'cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: computeRunCost },
      { name: 'generation_cost', label: 'Generation Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: () => null },
      { name: 'ranking_cost', label: 'Ranking Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: () => null },
    ],
    ```
  - `atFinalization`: **DELETE** `total_generation_cost` (lines 89-90) and `total_ranking_cost` (lines 91-92) entries from the run registry. They move to strategy/experiment as propagated metrics.
- [ ] Modify `SHARED_PROPAGATION_DEFS` (used by both `strategy.atPropagation` and `experiment.atPropagation`):
  ```typescript
  // Add after the existing Cost block (lines 28-32):
  { name: 'total_generation_cost', label: 'Total Generation Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'generation_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_generation_cost_per_run', label: 'Avg Generation Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'generation_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'total_ranking_cost', label: 'Total Ranking Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'ranking_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_ranking_cost_per_run', label: 'Avg Ranking Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'ranking_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  ```
- [ ] `validateRegistry()` runs at import time (line 169). Verify the new propagation defs reference `sourceMetric: 'generation_cost'` and `'ranking_cost'`, both of which now exist in `run.duringExecution`. Validation should pass.
- [ ] **Cleanup**: existing `total_generation_cost`/`total_ranking_cost` registry entries on `run.atFinalization` are deleted; verify nothing else references them as a sourceMetric or in compute functions.

#### 3b. Entity-class registry (`core/entities/*.ts`)
- [ ] `evolution/src/lib/core/entities/RunEntity.ts`:
  - `duringExecution`: change existing `cost` entry from `listView: false` to `listView: true` (override the catalog default; or remove the override since catalog already has `listView: true`). Add `generation_cost` and `ranking_cost` entries:
    ```typescript
    duringExecution: [
      { ...METRIC_CATALOG.cost, compute: computeRunCost },  // listView inherits true from catalog
      { ...METRIC_CATALOG.generation_cost },  // no compute fn — written live by createLLMClient
      { ...METRIC_CATALOG.ranking_cost },     // no compute fn — written live by createLLMClient
    ],
    ```
  - `atFinalization`: **DELETE** the two lines `{ ...METRIC_CATALOG.total_generation_cost, compute: () => null },` and `{ ...METRIC_CATALOG.total_ranking_cost, compute: () => null },` (currently lines 50-51).
- [ ] `evolution/src/lib/core/entities/StrategyEntity.ts` `metrics.atPropagation`:
  ```typescript
  // Add after existing total_cost / avg_cost_per_run defs:
  { ...METRIC_CATALOG.total_generation_cost,
    sourceEntity: 'run', sourceMetric: 'generation_cost',
    aggregate: aggregateSum, aggregationMethod: 'sum' },
  { ...METRIC_CATALOG.avg_generation_cost_per_run,
    sourceEntity: 'run', sourceMetric: 'generation_cost',
    aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { ...METRIC_CATALOG.total_ranking_cost,
    sourceEntity: 'run', sourceMetric: 'ranking_cost',
    aggregate: aggregateSum, aggregationMethod: 'sum' },
  { ...METRIC_CATALOG.avg_ranking_cost_per_run,
    sourceEntity: 'run', sourceMetric: 'ranking_cost',
    aggregate: aggregateAvg, aggregationMethod: 'avg' },
  ```
- [ ] `evolution/src/lib/core/entities/ExperimentEntity.ts` `metrics.atPropagation`: add the same 4 entries as Strategy.
- [ ] `validateEntityRegistry()` at `evolution/src/lib/core/entityRegistry.ts:56` runs at first registry access. Verify the new propagation defs pass validation: `sourceMetric: 'generation_cost'`/`'ranking_cost'` must exist in `RunEntity.metrics.duringExecution`.

#### 3c. Document the dual-registry follow-up
- [ ] Add a code comment at the top of both `metrics/registry.ts` and `core/entityRegistry.ts` noting that these are parallel registries kept in sync manually, and that consolidation is a follow-up project.

### Phase 4: Delete the 50/50 block + initialize empty runs

#### 4a. Delete the 50/50 logic
- [ ] In `evolution/src/lib/pipeline/finalize/persistRunResults.ts:295-321`, **delete** the entire bucketing loop (the `for (const inv of invocations) { ... }` block) AND the two `await writeMetric(... 'total_generation_cost' ...)` / `'total_ranking_cost'` calls. Delete the explanatory comment about racing deltas. No replacement.
- [ ] Verify nothing else in `finalizeRun` reads `totalGenerationCost`/`totalRankingCost` local variables.

#### 4b. Empty-run zero-init
**Background (corrected):** Earlier plan revisions speculated that stale runs could be re-claimed and might leave stale cost rows that GREATEST would refuse to overwrite. Verified against `supabase/migrations/20260323000002_fix_stale_claim_expiry.sql:26-35`: stale runs are set to `status='failed'` (not back to `pending`), and `claim_evolution_run` selects only `status='pending'` rows (line 47). **A failed run is never re-claimed.** Therefore the no-resume assumption holds and no DELETE-before-init is needed. Each `runId` corresponds to exactly one execution attempt; cost rows for that runId are written exactly once across the run's lifetime.

- [ ] Place the zero-init in `evolution/src/lib/pipeline/claimAndExecuteRun.ts` inside `executePipeline()`, AFTER the status='running' update (around lines 213-216) and BEFORE the `buildRunContext()` call (around line 218). This guarantees `db` and `runId` are in scope, the run row exists, and no LLM calls have happened yet.
  ```typescript
  // Ensure cost metric rows exist even for runs that fail before any LLM call.
  // GREATEST upsert means these zeros never overwrite real values written later.
  // Per supabase/migrations/20260323000002_fix_stale_claim_expiry.sql, runs with
  // stale heartbeats become status='failed' and are never re-claimed, so each runId
  // corresponds to exactly one execution attempt — no reset/DELETE needed.
  for (const metricName of ['cost', 'generation_cost', 'ranking_cost'] as const) {
    try {
      await writeMetricMax(db, 'run', runId, metricName, 0, 'during_execution');
    } catch (e) {
      logger.warn('Cost metric zero-init failed (non-fatal)', {
        metricName, err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  ```
- [ ] Verify the placement: the inserted block goes between the existing status update (`db.from('evolution_runs').update({ status: 'running' })...`) and the call to `buildRunContext(...)`. Read those lines in `claimAndExecuteRun.ts` and confirm the exact insertion point.

#### 4c. Document the no-resume guarantee
- [ ] Add a code comment in `claimAndExecuteRun.ts` near the zero-init block referencing `supabase/migrations/20260323000002_fix_stale_claim_expiry.sql` so future readers understand why no reset is needed.
- [ ] Document in `evolution/docs/metrics.md` under the cost section: "Run cost metrics (`cost`, `generation_cost`, `ranking_cost`) are written exactly once per run via the live `writeMetricMax` path during execution. Stale runs become `status='failed'` and are never re-claimed by `claim_evolution_run` (which selects only `status='pending'`), so no row reset is needed at run start."

### Phase 5: Strategy/experiment propagation verification
- [ ] Verify `propagateMetrics()` (called from `persistRunResults.ts:377-411`) automatically picks up the new propagation defs from BOTH registries. The function should iterate `getEntityMetrics(entityType).atPropagation` (or equivalent for the older registry).
- [ ] If propagation is driven by only ONE of the two registries, document which one in this plan and ensure the new defs land in the right place.

### Phase 6: UI surfacing

#### 6a. Run list
- [ ] **Run list (`src/app/admin/evolution/runs/page.tsx`)**: Should auto-render once `metrics/registry.ts` `run.duringExecution` has `listView: true` for `generation_cost`/`ranking_cost` (because the page uses `getListViewMetrics('run')` from `metrics/registry.ts`). Verify the page passes the new metric names through to `getBatchMetricsAction('run', ids, metricNames)`.
- [ ] **Migrate run list total cost off invocations path:**
  - Delete `evolution/src/services/evolutionActions.ts:234-251` invocation cost batch fetch.
  - Remove `total_cost_usd` from the `EvolutionRun` interface (`evolution/src/services/evolutionActions.ts:17-39`).
  - **In scope** — these read `total_cost_usd` from the `EvolutionRun` enriched field defined in `evolutionActions.ts`:
    - `evolution/src/services/evolutionActions.ts:17-39` — remove the `total_cost_usd?: number` field from the `EvolutionRun` interface and delete the cost batch fetch at lines 234-251
    - `evolution/src/components/evolution/tables/RunsTable.tsx` — cost column (read from `metrics` array via custom render)
    - `src/app/admin/evolution/runs/page.test.tsx` — test fixtures and assertions
    - `src/app/admin/evolution/runs/[runId]/page.test.tsx` — test fixtures and assertions
    - `src/__tests__/integration/evolution-cost-cascade.integration.test.ts` — heavy use at lines 139-172
    - `src/__tests__/integration/evolution-cost-fallback.integration.test.ts`
  - **NOT in scope** (verified by reading the files):
    - `evolution/src/services/costAnalytics.ts` reads `total_cost_usd` from the `daily_llm_costs` view (line 173: `select('date, call_count, total_tokens, total_cost_usd')`). Different column on a different table — unrelated.
    - `evolution/src/services/evolutionVisualizationActions.ts` reads `total_cost_usd` from the `evolution_run_costs` VIEW (lines 124-127, 161-165) and assembles a local `total_cost_usd` field in its returned `getDashboardData` shape (line 186) populated from a costMap built from the view. It does NOT depend on `evolutionActions.ts`'s `EvolutionRun.total_cost_usd`. The dashboard page (`src/app/admin/evolution-dashboard/page.tsx:76`) reads `r.total_cost_usd` from the visualization action's result, which still works after the change. Both files are out of scope for this project.
  - Each in-scope reader is updated to read from the run's `metrics: MetricRow[]` array (looking up the `cost` metric) instead of `run.total_cost_usd`.
- [ ] Update `RunsTable.tsx` file header comment (line 3) which currently says "cost comes from enriched total_cost_usd field" — change to reflect the new metric-array source.
- [ ] Update `RunsTable.tsx:108-132` cost column to read from the run's `metrics` array via a custom render (preserves budget warning + progress bar UI). Add `metrics?: MetricRow[]` to the `BaseRun` interface in `RunsTable.tsx`.

#### 6b. Strategy list
- [ ] **Strategy list (`src/app/admin/evolution/strategies/page.tsx`):** Auto-renders via `createMetricColumns<StrategyListItem>('strategy')` which reads from `getListViewMetrics('strategy')`. Verify columns appear after Phases 2-3.

#### 6c. Experiments page refactor
- [ ] **Refactor experiments page (`src/app/admin/evolution/experiments/page.tsx`):**

  **Verified state of existing files:**
  - `evolution/src/services/experimentActions.ts:92` exports `listExperimentsAction = adminAction('listExperiments', ...)`. The action returns objects matching the page-local `ExperimentSummary` shape (id, name, status, created_at, updated_at, runCount) but does NOT export the type — the type is defined inline in `page.tsx:22-29`.
  - `page.tsx:212-240` builds `columnsWithActions: ColumnDef<ExperimentSummary>[] = [...COLUMNS, { key: 'actions', ... }]` as a manual literal (NOT a wrapper helper). The action cell renders Cancel/Delete buttons conditionally based on status.
  - `page.tsx` does NOT currently import `createMetricColumns`, `getListViewMetrics`, `getBatchMetricsAction`, or `MetricRow`.

  **Refactor steps:**

  - Step 1: in `evolution/src/services/experimentActions.ts`, **export** the `ExperimentSummary` type (move it from page.tsx if cleaner, or duplicate-define-export and have the page import it). Then extend `listExperimentsAction`'s returned shape to include `metrics: MetricRow[]`. After the primary list query inside `listExperimentsAction`, batch-fetch metrics via:
    ```typescript
    import { getMetricsForEntities } from '@evolution/lib/metrics/readMetrics';
    import { getListViewMetrics } from '@evolution/lib/metrics/registry';
    // ...
    const metricNames = getListViewMetrics('experiment').map(d => d.name);
    const metricsByExp = await getMetricsForEntities(supabase, 'experiment', items.map(e => e.id), metricNames);
    return items.map(e => ({ ...e, metrics: metricsByExp.get(e.id) ?? [] }));
    ```
    (Mirror the strategies page service pattern; note that `getListViewMetrics` lives in `metrics/registry.ts` per Phase 3a — the same import the strategies page uses, confirmed.)
  - Step 2: in `page.tsx`, **delete** the local `interface ExperimentSummary` declaration (lines 22-29) and `import { ExperimentSummary, type ExperimentListItem } from '@evolution/services/experimentActions'`. Define `type ExperimentListItem = ExperimentSummary & { metrics: MetricRow[] }` either in the service file (preferred for re-use) or the page file.
  - Step 3: in `page.tsx`, add new imports: `import { createMetricColumns } from '@evolution/lib/metrics/metricColumns'` and `import type { MetricRow } from '@evolution/lib/metrics/types'`.
  - Step 4: in `page.tsx`, change `COLUMNS: ColumnDef<ExperimentSummary>[]` (line ~30, the existing hardcoded base array) to `baseColumns: ColumnDef<ExperimentListItem>[]`. Then **rewrite** `columnsWithActions: ColumnDef<ExperimentListItem>[] = [...baseColumns, ...createMetricColumns<ExperimentListItem>('experiment'), { key: 'actions', ... /* existing inline action def */ }]`. Cast site or update the column generic parameter accordingly.
  - Step 5: verify `getMetricsForEntities(db, 'experiment', ids, names)` returns rows for the experiment entity type. Infrastructure supports it; confirm propagation is actually writing rows with `entity_type='experiment'` via `propagateMetrics(db, 'experiment', experimentId)` at `persistRunResults.ts:377-411`.

#### 6d. Detail page metrics tabs
- [ ] **Run/strategy/experiment detail metrics tabs:** `EntityMetricsTab` auto-groups metrics by category — already works once metric rows exist. Verify visually after Phases 2-4. The new `generation_cost`/`ranking_cost` rows on runs and propagated `total_*_cost`/`avg_*_per_run` rows on strategies/experiments will appear under the "Cost" group automatically.

### Phase 7: Documentation updates
- [ ] `evolution/docs/metrics.md`: rewrite the "Parallel pipeline additions" callout. Document the typed `AgentName` mechanism, the `COST_METRIC_BY_AGENT` mapping, the new static `generation_cost`/`ranking_cost` run metrics, the 4 new propagated metrics, the `upsert_metric_max` RPC, and the no-resume assumption. Note the dual-registry coordination requirement.
- [ ] `evolution/docs/cost_optimization.md`: note accurate per-purpose split methodology and typed `AgentName`.
- [ ] `evolution/docs/visualization.md`: add new run/strategy/experiment list columns; note the experiments page refactor.
- [ ] `evolution/docs/strategies_and_experiments.md`: add new propagated metrics to the propagation table.
- [ ] `evolution/docs/agents/overview.md`: brief note that `generateFromSeedArticle` now reports per-purpose costs accurately via typed labels.
- [ ] (Skip — unlikely changes) `evolution/docs/{README, architecture, data_model, entities, rating_and_comparison, arena, logging, curriculum, reference, minicomputer_deployment}.md`.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — replace the `'writes total_generation_cost and total_ranking_cost from invocation rows'` test. New test asserts that finalization does NOT write `total_*_cost` rows on runs. Add a test that propagation runs after finalization and that the propagated rows pick up the live-written `generation_cost`/`ranking_cost`.
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — **rename all `'gen'` literals to `'generation'` and `'rank'` to `'ranking'`** (lines 23, 32, 49, 51, 58, 60, 70, 83-85, 103, 150, 156, 177, 188, 197, 208 plus any others). The typed `AgentName` parameter rejects `'gen'`/`'rank'`. Verify behavior is preserved.
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — update fast-check arbitraries AND local types:
  - Line 14: `phase: fc.constantFrom('generation', 'ranking', 'evolution')` — `'evolution'` is not a valid `AgentName`. Replace with `fc.constantFrom('generation', 'ranking')` (don't include `'seed_title'`/`'seed_article'` because trackBudget is not called from seed-phase paths — seed calls bypass the V2 cost tracker entirely).
  - Line 22: `reservations: { phase: string; reserved: number }[]` — change `phase: string` to `phase: AgentName` so the closure variable types align with the tightened `recordSpend(phase: AgentName)`.
  - Line 50 (around `tracker.reserve(...)`) and line 68 (`tracker.recordSpend('test', actual, reserved)`) — `'test'` is not a valid `AgentName`. Replace with `'generation'`.
  - Line 84: same as line 14.
  - Audit any other `phase: string` declaration in the file and tighten.
- [ ] `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` — update mocks to expect `writeMetricMax` (not `writeMetric`) and the new typed metric names (`generation_cost`/`ranking_cost`) instead of `agentCost:${name}`. Add an explicit test that two concurrent calls with different `agentName` values produce two distinct DB rows. Add a test that the try/catch around `writeMetricMax` correctly logs and continues on RPC failure (non-fatal semantics).
- [ ] `evolution/src/lib/metrics/writeMetrics.test.ts` — unit-test `writeMetricMax` with mocked RPC; assert it routes through `db.rpc('upsert_metric_max', ...)`. Update the existing `'accepts dynamic agentCost:* in during_execution'` test (lines 103-106): the new test verifies that the static `generation_cost`/`ranking_cost` names are accepted in `during_execution` timing AND that `writeMetricMax` rejects `at_propagation`-only metric names if called with the wrong timing.
- [ ] `evolution/src/lib/metrics/registry.test.ts` — update the `isValidEntityMetricName('run', 'agentCost:generation') === true` assertion (lines 67-68). With the static metric names added, the `'agentCost:generation'` literal is no longer a valid metric name on `run` (it never was via this path; `experimentMetrics.ts` writes it on strategy/experiment, not run). Replace with assertions that `isValidMetricName('run', 'generation_cost')` and `isValidMetricName('run', 'ranking_cost')` return `true`. Also assert `isValidMetricName('strategy', 'agentCost:generate_from_seed_article')` still returns `true` (preserves the dynamic-prefix path for `experimentMetrics.ts`).
- [ ] `evolution/src/lib/core/entities/entities.test.ts` — update line 33-34 length assertion from `expect(entity.metrics.atFinalization).toHaveLength(9)` to `7` (removed 2 cost-split metrics). Update the comment on line 33 to reflect the new metric count. Also update `duringExecution` length assertion (currently implied to be 1 — `cost`) to 3 (`cost`, `generation_cost`, `ranking_cost`).
- [ ] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — extend propagation tests to cover the 4 new propagated metrics on strategy and experiment entities.
- [ ] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — add an assertion that the agent passes `'generation'` (not `'generate_from_seed_article'` or anything else) to its first `llm.complete` call. Catches future label drift.
- [ ] `evolution/src/lib/core/agents/SwissRankingAgent.test.ts` — add assertion for `'ranking'` label.
- [ ] `evolution/src/lib/metrics/experimentMetrics.test.ts` — verify NO changes needed (this file uses the per-agent-class dynamic prefix which we explicitly leave alone). If test asserts on `agentCost:generation` (per-purpose) vs `agentCost:generate_from_seed_article` (per-class), confirm the per-class assertions are unchanged. The per-purpose `'generation'`/`'ranking'` labels are no longer written by createLLMClient under the `agentCost:` prefix at all — assertions on `agentCost:generation` will fail if any test expects that name to appear in production code paths. Run this test explicitly during Phase 1 before declaring done.
- [ ] `evolution/src/lib/core/metricCatalog.test.ts` — verify timing change for `total_generation_cost`/`total_ranking_cost` (now `at_propagation`, not `at_finalization`) doesn't break any existing assertion.
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — Phase 4b adds new `writeMetricMax` zero-init calls inside `executePipeline()`. The existing test mocks `recordSpend`/`getPhaseCosts` (around lines 45-48) and will need a new `jest.mock('../../metrics/writeMetrics', ...)` directive for `writeMetricMax`. Add explicit assertions that: (a) the three zero-init `writeMetricMax` calls (`cost`, `generation_cost`, `ranking_cost`) happen after the status='running' update and before `buildRunContext`, (b) a failed `writeMetricMax` is logged at warn level and does NOT abort the pipeline (non-fatal semantics), (c) on a fresh run with no prior rows, all three zero-inits are issued.
- [ ] `src/app/admin/evolution/experiments/page.test.tsx` — Phase 6c refactors the page from hardcoded columns to `createMetricColumns`. The existing test will break on column-count or column-header assertions. Update fixtures to include `metrics` arrays on `ExperimentListItem` rows; update expected column headers.
- [ ] `evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx` — add the unit test from Phase 1e (asserting both `generation_cost` static and legacy `agentCost:generate_from_seed_article` dynamic rows render correctly under the Cost group).
- [ ] `evolution/src/lib/core/agentNames.test.ts` (NEW, optional) — single-line catalog-coverage assertion: `for (const agentName of AGENT_NAMES) { /* COST_METRIC_BY_AGENT[agentName] is either undefined or a valid MetricName */ }`. Catches typo drift.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` (NEW) — **cost injection mechanism**: mock `calculateLLMCost` from `src/config/llmPricing.ts` using `jest.mock('@/config/llmPricing', () => ({ calculateLLMCost: jest.fn().mockReturnValue(0.08) }))` (project uses Jest, NOT Vitest — do not use `vi.mock`). Use `mockReturnValueOnce` chains to inject different values per call so generation calls return $0.08 and ranking calls return $0.005. Run a minimal evolution loop (1 generation + 4 ranking calls in one `generateFromSeedArticle` execution). Assert that the `generation_cost` row equals the sum of generation costs and the `ranking_cost` row equals the sum of ranking costs, NOT a 50/50 split. Document the mock approach in the test file header. Reset the mock in `afterEach` to avoid leaking into other tests.
- [ ] `src/__tests__/integration/evolution-metric-max-upsert.integration.test.ts` (NEW) — **two test cases**:
  - **Test 1 (deterministic correctness gate, primary):** Sequential descending writes: call `db.rpc('upsert_metric_max', { p_value: 0.10 })`, then `0.05`, then `0.03`. Assert the row value stays at `0.10` after all three writes. This is the actual GREATEST semantics check and is fully deterministic. A naive last-write-wins upsert WOULD fail this test (final value would be 0.03), so it's a real correctness gate.
  - **Test 2 (best-effort concurrency):** Open two `SupabaseClient` instances. Use `Promise.all([clientA.rpc(...0.10...), clientB.rpc(...0.05...)])` and assert final value is `0.10`. Then `Promise.all([clientA.rpc(...0.15...), clientB.rpc(...0.08...)])` — assert final is `0.15`. Note in the test file header: "PostgREST RPC calls go through HTTP and may not achieve true OS-level concurrent transactions; this test is best-effort. The deterministic descending-value test above is the real correctness gate. If true concurrent testing is needed, use raw `pg` connections with explicit `BEGIN`/`COMMIT` and `pg_advisory_lock`."
- [ ] `src/__tests__/integration/evolution-empty-run-cost-init.integration.test.ts` (NEW) — start a run and force it to fail before any LLM call (e.g., trigger an error in `buildRunContext`). Assert `cost`, `generation_cost`, and `ranking_cost` rows exist with value 0 in `evolution_metrics` for that run. Then propagate to a strategy with that run as the only child and assert `total_generation_cost = 0`, `avg_generation_cost_per_run = 0` (not undefined / not skipped). (No stale-claim reset test — per the no-resume guarantee in Phase 4b, that scenario cannot occur.)

### Migration apply path for integration tests
- [ ] **CI**: `.github/workflows/ci.yml` already has a `deploy-migrations` job that applies migrations to staging before integration-critical tests run. The new RPC migration `20260408000001_upsert_metric_max.sql` will flow through this path automatically. No CI changes needed.
- [ ] **Local**: There is NO `pretest:integration` hook in `package.json` that auto-applies migrations to the local Supabase instance. Document in the new integration test file headers and in `evolution/docs/cost_optimization.md` test setup section: "Run `supabase db reset` (or `supabase migration up --local`) before `npm run test:integration` to ensure the `upsert_metric_max` RPC is available in the local DB. Without this, tests fail with `function upsert_metric_max does not exist`."

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-cost-split.spec.ts` (NEW) — visit run list, strategy list, and experiment list pages; assert presence of "Generation Cost" / "Total Generation Cost" and "Ranking Cost" / "Total Ranking Cost" column headers and that values are formatted as `$X.XX`. Visit a run detail page, navigate to metrics tab, assert "Generation Cost" and "Ranking Cost" rows appear under the Cost group.
- [ ] Audit existing E2E specs for `.nth(N)` selectors or column-count assertions that may shift when columns are added. Verified file inventory in `src/__tests__/e2e/specs/09-admin/`:
  - `admin-evolution-runs.spec.ts` — EXISTS, audit for column index drift
  - `admin-evolution-experiments-list.spec.ts` — EXISTS, audit for column index drift after experiments page refactor
  - `admin-evolution-experiment-lifecycle.spec.ts` — EXISTS, may touch experiment list view
  - `admin-evolution-strategy-detail.spec.ts` — detail page only, unlikely affected by list-column changes
  - `admin-strategy-registry.spec.ts`, `admin-strategy-budget.spec.ts`, `admin-strategy-crud.spec.ts` — strategy-related specs that may touch the list, audit for `.nth(N)` selectors
  - `admin-evolution-dashboard.spec.ts` — touches dashboard cost displays after `total_cost_usd` removal in Phase 6a
  - `admin-evolution-invocations.spec.ts`, `admin-evolution-invocation-detail.spec.ts` — invocation specs, unaffected
  - **NOTE**: There is no `admin-evolution-strategies.spec.ts` or `admin-evolution-experiments.spec.ts` (the strategies-list-page-specific spec doesn't exist; closest are the per-detail and registry specs above).
- [ ] `admin-evolution-invocations.spec.ts` targets the invocations page (not runs/strategies/experiments) so its column indices are unaffected — no change needed.

### Manual Verification
- [ ] Run a real evolution end-to-end via `./docs/planning/tmux_usage/ensure-server.sh` + admin UI start-experiment wizard with a low budget cap. Visit run/strategy/experiment list and detail pages and visually confirm:
  - Run list shows "Cost", "Generation Cost", "Ranking Cost" columns with non-zero values that sum correctly
  - Strategy list shows "Total Cost", "Total Generation Cost", "Total Ranking Cost" columns
  - Experiment list (after refactor) shows the same propagated columns as strategies
  - Run metrics tab shows "Cost", "Generation Cost", "Ranking Cost" rows under Cost group
  - Strategy metrics tab shows the propagated cost split rows + averages
  - Experiment metrics tab shows the same as strategy
- [ ] Inspect `evolution_metrics` rows directly via SQL: confirm `generation_cost + ranking_cost ≈ cost` for at least 3 completed runs (small rounding ok).
- [ ] Verify no `agentCost:generation` or `agentCost:ranking` rows are written for NEW runs (they should not exist; the dynamic prefix at the per-LLM-call site is gone). Old runs may still have them — that's expected.
- [ ] Verify `agentCost:generate_from_seed_article` and `agentCost:swiss_ranking` rows STILL exist on strategy/experiment entities (these come from `experimentMetrics.ts` and are unaffected).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-cost-split.spec.ts` against local dev server (started via `./docs/planning/tmux_usage/ensure-server.sh`).
- [ ] Manual visual check via Playwright MCP headless of `/admin/evolution/runs`, `/admin/evolution/strategies`, `/admin/evolution/experiments`, plus one run/strategy/experiment detail page.

### B) Automated Tests (project conventions per testing_overview.md)
- [ ] `npm run lint`
- [ ] `npm run typecheck` (cached, project's canonical TS gate)
- [ ] `npm run build`
- [ ] `npm run test:unit -- evolution` (focused) then full `npm run test:unit`
- [ ] `npm run test:esm` (project's ESM-mode test suite)
- [ ] `npm run test:integration -- evolution-cost-attribution evolution-metric-max-upsert evolution-empty-run-cost-init`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-cost-split.spec.ts`

## Documentation Updates
- [ ] evolution/docs/metrics.md — typed AgentName, new metrics, upsert_metric_max RPC, no-resume assumption, dual-registry note
- [ ] evolution/docs/cost_optimization.md — accurate per-purpose split + integration test setup notes
- [ ] evolution/docs/visualization.md — new run/strategy/experiment list columns; experiments page refactor
- [ ] evolution/docs/strategies_and_experiments.md — new propagated metrics in propagation table
- [ ] evolution/docs/agents/overview.md — typed labels enable accurate per-purpose attribution
- [ ] (Likely skip) evolution/docs/{README, architecture, data_model, entities, rating_and_comparison, arena, logging, curriculum, reference, minicomputer_deployment}.md

## Rollback Plan
- **Code rollback:** `git revert` the commits. The new RPC `upsert_metric_max` is additive (safe to leave in the DB after revert; no code references it post-revert). The `total_cost_usd` field removal is the largest blast radius — revert restores it cleanly.
- **Migration rollback:** The `upsert_metric_max` function can be left in place after revert (no harm). If explicit removal is needed, add `DROP FUNCTION IF EXISTS upsert_metric_max(...)` to a follow-up migration.
- **Data rollback:** Historical `evolution_metrics` rows from old runs (`agentCost:*`, old-format `total_generation_cost`/`total_ranking_cost` with 50/50 values) remain in the DB and are not modified by this project. Reverting code does not require any data fix-up.
- **Recovery if monitoring catches a regression:** Fastest rollback path is git-revert of `createLLMClient.ts` and the entity registry changes. The new metric rows on `evolution_metrics` are additive — the old DB rows are still there for historical runs. New runs after revert would resume the 50/50 approximation.

## Open Sub-Decisions for Plan Review

- **Strategy/experiment list column width:** With `total_cost`, `total_generation_cost`, `total_ranking_cost` all `listView: true`, the table gets 3 cost columns side-by-side. Default plan: show all three totals; keep `avg_*_per_run` off `listView` (matching the existing `avg_cost_per_run` precedent). Confirm during plan-review.
- **Strategy avg propagation skew with mixed-vintage runs:** A strategy whose runs are a mix of pre-change (no `generation_cost`/`ranking_cost` rows) and post-change (with rows) will compute `avg_generation_cost_per_run` over only the post-change runs. The `n` displayed will differ from `run_count`. This is a documented surprise rather than a bug. Optional cleanup: a one-time backfill to write `generation_cost = total_generation_cost`, `ranking_cost = total_ranking_cost` for old runs (using their existing 50/50 values) — but this would persist the inaccurate 50/50 split into the new metric names. Default plan: leave the skew, document it, accept that strategy/experiment averages over old + new mixed periods are computed only over runs where the data exists.
- **Historical orphan rows:** Existing production `evolution_metrics` rows with names `total_generation_cost`/`total_ranking_cost` on RUN entities (50/50 values) become orphans after this change — written by no code. Per the user's "leave historical 50/50 values" decision: leave them. They will still appear on old-run metrics tabs because `EntityMetricsTab` queries all rows, finds them in the catalog (via `total_generation_cost` still being a valid catalog name, just with `at_propagation` timing now), and renders them with the catalog label "Total Generation Cost". This is acceptable — the value is wrong but at least it's labeled. Optional follow-up: a one-time cleanup migration to DELETE these row-level orphans.

## Dual-Registry Consolidation Follow-Up
This project updates BOTH `evolution/src/lib/metrics/registry.ts` `METRIC_REGISTRY` and `evolution/src/lib/core/entityRegistry.ts` (which builds from Entity classes) in lockstep. They are functionally redundant. A separate follow-up project should consolidate them. Tracked here as a known cost of this project, not as a blocker.

## Review & Discussion
[Populated by /plan-review]
