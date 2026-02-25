# Agent Comparison Analysis Evolution Research

## Problem Statement
Investigate and document how agent efficiency comparisons work in the evolution dashboard, specifically the Explorer > Agents average rating view and the Optimization > Agent Analysis ROI leaderboard. Clarify the methodology behind each metric (avg Elo per agent, Elo gain, Elo per dollar), identify any gaps or inconsistencies in how ratings are computed and attributed, and propose improvements to make agent comparison more actionable for optimizing pipeline configurations.

## Requirements (from GH Issue #564)
- [ ] Explorer > Agents > average rating — understand what avg_elo means, how it's computed per agent
- [ ] Optimization > Agent Analysis — understand the ROI leaderboard methodology
- [ ] Document the data flow from pipeline execution → agent metrics → dashboard display
- [ ] Identify gaps or improvements in agent comparison methodology

## High Level Summary

Both dashboard views (Explorer Agents and Optimization Agent Analysis) share a single source of truth: the `evolution_run_agent_metrics` table. Metrics are computed at pipeline finalization by `persistAgentMetrics()` in `metricsWriter.ts`, which maps variants to agents via strategy names, then computes avg rating, rating gain, and rating-per-dollar for each agent.

**Critical findings from deep-dive research (8 parallel agents across 2 rounds):**

1. **`avg_elo` stores raw OpenSkill `mu`** — the ONLY place in the entire codebase that uses `mu` for rating. Everywhere else uses `ordinal` (mu - 3*sigma). Numeric impact: ~50% discrepancy in apparent skill gain.
2. **Explorer table vs matrix/trend use DIFFERENT rating sources** — The table view reads `avg_elo` from `evolution_run_agent_metrics` (mu-based), but matrix/trend views read winner `elo_score` from `evolution_variants` (ordinal-based, Elo-scale). Two incompatible rating scales for the same "Avg Rating" label.
3. **TreeSearch mapping bug** — `tree_search_*` strategy variants silently return `null` from `getAgentForStrategy()`, meaning all tree search metrics are dropped. Missing pattern match in metricsWriter.ts.
4. **Invisible agent costs** — Only `reflection` ($0.05-$0.50/run) and `calibration` ($0.10-$0.80/run) have real invisible cost. Tournament, proximity, and metaReview have zero LLM cost. Data exists in `evolution_agent_invocations` but not in `evolution_run_agent_metrics`.
5. **`persistAgentMetrics()` has zero test coverage** — the function containing the mu vs ordinal bug was never tested, explaining why both this bug and the tree_search mapping gap went undetected.
6. **`original` agent name mismatch** — baseline variant maps to agent `'original'` but no agent class uses that name in costTracker, creating another silent attribution gap.
7. **`evolution_agent_invocations` is a better source of truth** — already tracks all agents, per-iteration detail, costs, and execution metadata. Could supplement or replace `evolution_run_agent_metrics`.
8. **Exact fix identified** — use `ordinalToEloScale(getOrdinal(rating))` instead of `rating.mu`, matching `persistVariants()` and `computeFinalElo()`. Change baseline from 25 to 1200.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — documentation structure
- docs/docs_overall/architecture.md — system design, data flow, action wrapping patterns
- docs/docs_overall/project_workflow.md — research methodology

### Relevant Docs
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill Bayesian rating (mu/sigma), Swiss tournament, bias mitigation
- evolution/docs/evolution/architecture.md — Two-phase pipeline (EXPANSION→COMPETITION), agent selection, budget redistribution
- evolution/docs/evolution/data_model.md — Core primitives (Prompt, Strategy, Run, Article), strategy system
- evolution/docs/evolution/hall_of_fame.md — Cross-method comparison, prompt bank, elo_per_dollar
- evolution/docs/evolution/cost_optimization.md — CostTracker, agent cost attribution, ROI dashboard
- evolution/docs/evolution/strategy_experiments.md — L8 factorial design, factor analysis
- evolution/docs/evolution/visualization.md — Dashboard pages, timeline tab, budget tab
- evolution/docs/evolution/README.md — Entry point, two rating systems overview

## Code Files Read

### Metrics Persistence
- `evolution/src/lib/core/metricsWriter.ts` — `persistAgentMetrics()` (L189-230), `STRATEGY_TO_AGENT` mapping (L105-117), `getAgentForStrategy()` (L119-125). Computes avg_elo from OpenSkill `mu`, baseline 25.

### Database Schema
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — Table schema: avg_elo NUMERIC(8,2), elo_gain NUMERIC(8,2), elo_per_dollar NUMERIC(12,2). **Stale comment says baseline is 1200.**

### Explorer Data Flow
- `evolution/src/services/unifiedExplorerActions.ts` — Task (agent) unit of analysis query (L382-451), ExplorerTaskRow interface (L69-79), matrix/trend agent dimension aggregation (L513-529)
- `src/app/admin/quality/explorer/page.tsx` — TaskTable component (L1056-1108), formatElo() (L372-374), StatCard aggregation (L795)

### Agent ROI Leaderboard
- `evolution/src/services/eloBudgetActions.ts` — `getAgentROILeaderboardAction()` (L59-113), AgentROI interface (L11-17). 30-day lookback, arithmetic mean aggregation.
- `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx` — Ranked table with bar chart (normalized to max EPD), insights section
- `src/app/admin/quality/optimization/page.tsx` — Tab structure (strategy/agent/cost/accuracy/experiments), data fetching

### Cost Tracking
- `evolution/src/lib/core/costTracker.ts` — `spentByAgent: Map<string, number>` (L8-16), `recordSpend()` (L43-62), `getAllAgentCosts()` (L80-82)

### Rating System
- `evolution/src/lib/core/rating.ts` — `DEFAULT_MU = 25`, `DEFAULT_SIGMA = 8.333`, `getOrdinal()` = mu - 3*sigma, `ordinalToEloScale()` for 0-3000 display

### Deep-Dive: mu vs ordinal Usage Across Codebase
- `evolution/src/lib/core/rating.ts` — Defines both: `getOrdinal()` = mu - 3*sigma, `ordinalToEloScale()` maps ordinal to [0-3000]
- `evolution/src/lib/core/persistence.ts:74` — `persistVariants()` uses `ordinalToEloScale(getOrdinal(rating))` → correct
- `evolution/src/lib/core/metricsWriter.ts:13-14` — `computeFinalElo()` uses `ordinalToEloScale(getOrdinal())` → correct
- `evolution/src/lib/core/metricsWriter.ts:207` — `persistAgentMetrics()` uses raw `.mu` → **INCONSISTENT**
- `evolution/src/lib/state.ts:76-88` — `getTopByRating(n)` ranks by `getOrdinal()` → correct
- `evolution/src/lib/agents/tournament.ts` — Swiss pairing uses `getOrdinal()` → correct
- `evolution/src/lib/core/supervisor.ts:222` — Plateau detection tracks max ordinal → correct
- `evolution/src/services/hallOfFameActions.ts:180-192` — Stores ordinal, derives `elo_rating` via `ordinalToEloScale()` → correct
- `evolution/src/lib/agents/treeSearchAgent.ts:159-163` — Sorts by `mu` (intentional: "high potential" root selection)

### Deep-Dive: Explorer Matrix/Trend Agent Dimension
- `evolution/src/services/unifiedExplorerActions.ts:498-511` — Matrix/trend `avgElo` metric reads `evolution_variants.elo_score` (winner, Elo-scale), NOT `evolution_run_agent_metrics.avg_elo` (mu-scale)
- `evolution/src/services/unifiedExplorerActions.ts:513-529` — Agent dimension resolved from `evolution_run_agent_metrics` for run→agent mapping only
- `evolution/src/services/unifiedExplorerActions.ts:816-831` — `computeRunMetric()` returns `runEloMap.get(run.id)` for avgElo (winner variant's elo_score)
- `evolution/src/services/unifiedExplorerActions.ts:833-839` — `aggregateMetricValues()`: SUM for cost/count, AVERAGE for Elo-based metrics

### Deep-Dive: Strategy-to-Agent Mapping
- `evolution/src/lib/agents/treeSearchAgent.ts:77` — Creates variants with strategy `tree_search_${revisionAction.type}`
- `evolution/src/lib/agents/iterativeEditingAgent.ts:121` — Creates variants with `critique_edit_${dimension || 'open'}`
- `evolution/src/lib/agents/sectionDecompositionAgent.ts:178` — Creates variants with `section_decomposition_${weakness.dimension}`
- `evolution/src/lib/agents/generationAgent.ts` — Creates variants with hardcoded `GENERATION_STRATEGIES`
- `evolution/src/lib/agents/evolvePool.ts` — Creates variants with mutate_*/crossover/creative_exploration
- `evolution/src/lib/agents/debateAgent.ts` — Creates variants with `debate_synthesis`

### Deep-Dive: Agent Cost Visibility
- `evolution/src/services/evolutionVisualizationActions.ts:598-674` — Budget tab reads `evolution_agent_invocations` → shows ALL agents including non-generating
- `evolution/src/lib/core/metricsWriter.ts:128-186` — Cost prediction reads `evolution_agent_invocations` → includes all agents
- `evolution/src/lib/core/costTracker.ts:43-62` — `recordSpend()` called by llmClient for every agent
- `evolution/src/lib/core/budgetRedistribution.ts:10-19` — Required agents: generation, calibration, tournament, proximity

### Round 2: CostTracker Agent Names vs STRATEGY_TO_AGENT Names
- `evolution/src/lib/core/llmClient.ts:67,107` — `complete()`/`completeStructured()` call `costTracker.recordSpend(agentName, cost, invocationId)` where agentName is the agent's `this.name`
- Each agent class has a `name` property (e.g., GenerationAgent → `'generation'`, DebateAgent → `'debate'`)
- **All variant-generating agent names match** between costTracker keys and getAgentForStrategy returns ✓
- **`'original'` agent name mismatch**: Strategy `original_baseline` maps to `'original'` in STRATEGY_TO_AGENT, but NO agent class uses `name = 'original'`. The baseline is created in `pipeline.ts` without going through any agent. This means baseline variant metrics are silently skipped — the join in `persistAgentMetrics()` will never match `'original'` as a costTracker key.

### Round 2: Test Coverage
- `evolution/src/lib/core/metricsWriter.test.ts` — 13 tests total:
  - `computeFinalElo()` — 3 tests ✓
  - `getAgentForStrategy()` — 8 tests (covers all STRATEGY_TO_AGENT entries, NO test for `tree_search_*`)
  - `persistCostPrediction()` — 2 tests
  - **`persistAgentMetrics()` — ZERO TESTS** (the function with the mu vs ordinal bug)
- `evolution/src/services/eloBudgetActions.test.ts` — 30+ tests, `getAgentROILeaderboardAction()` has 4 tests (all mock aggregated data, never verify mu vs ordinal)
- `evolution/src/services/unifiedExplorerActions.test.ts` — 22 tests:
  - Task view test mocks `avg_elo: 1350` (never computed from ratings)
  - Matrix "avgElo" test is **misleading** — actually tests `totalCost` metric, not avgElo
  - No test comparing table vs matrix rating consistency

### Round 2: evolution_agent_invocations vs evolution_run_agent_metrics
- `supabase/migrations/20260212000001_evolution_agent_invocations.sql` — Per-agent-per-iteration table with cost_usd, execution_detail JSONB, success flag, error_message
- **Granularity**: invocations = per-iteration (100s of rows/run), metrics = per-run (10-12 rows/run)
- **Completeness**: invocations includes ALL agents (even skipped/failed), metrics only variant-generating
- **Rating data**: invocations has `_diffMetrics.eloChanges` in execution_detail; metrics has pre-computed avg_elo
- **Cost model**: invocations = incremental per-invocation; metrics = cumulative per-run
- Already used by: Timeline tab, Budget tab, cost prediction, agent detail drill-down

### Round 2: Correct Rating Persistence Path (persistVariants)
- `evolution/src/lib/core/persistence.ts:74` — The correct path: `ordinalToEloScale(getOrdinal(state.ratings.get(v.id) ?? createRating()))` → `elo_score` column
- `evolution/src/lib/core/state.ts:65` — `addToPool()` initializes rating: `createRating()` → `{mu: 25, sigma: 8.333}`
- `evolution/src/lib/agents/tournament.ts:326-330` — Tournament updates ratings via `updateRating(winner, loser)` or `updateDraw(a, b)`
- `evolution/src/lib/core/rating.ts` — Full API: `createRating()`, `getOrdinal(r)` = mu - 3*sigma, `ordinalToEloScale(ord)` = 1200 + ord * 16, `isConverged(r, threshold)`
- `evolution/src/lib/core/metricsWriter.ts:9-15` — `computeFinalElo()` uses same correct path as persistVariants ✓

## Key Findings

### Finding 1: avg_elo Uses Raw OpenSkill `mu`, Not Ordinal or Elo-Scale

In `metricsWriter.ts:207-208`:
```typescript
const eloSum = variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0);
const avgElo = eloSum / variants.length;
```

This means:
- `avg_elo` ≈ 25 for average agents (OpenSkill default mu)
- It does NOT use `ordinal` (mu - 3*sigma), which would penalize under-tested variants
- It does NOT use `ordinalToEloScale()`, which maps to the 0-3000 display range
- Contrast: The Hall of Fame and in-run rankings use `ordinal` for conservative estimates

### Finding 2: Baseline Mismatch Between Code and DB Comment

- **Code** (metricsWriter.ts:209): `eloGain = avgElo - 25` (OpenSkill default mu)
- **DB migration comment** (20260205000001:22): `'Elo points gained per dollar spent: (avg_elo - 1200) / cost_usd'`
- The comment is stale — 1200 was the legacy Elo baseline before OpenSkill migration

### Finding 3: Both Dashboard Views Share the Same Source Table

| Aspect | Explorer > Agents | Optimization > Agent Analysis |
|--------|-------------------|-------------------------------|
| **Source** | `evolution_run_agent_metrics` | `evolution_run_agent_metrics` |
| **Granularity** | Per-run per-agent rows | Aggregated across 30-day window |
| **Aggregation** | Individual rows (filtered by run IDs) | Arithmetic mean by agent name |
| **Sorting** | By `elo_per_dollar DESC` | By `avgEloPerDollar DESC` |
| **Display** | `formatElo(row.avg_elo)` → integer | `$X.XXXX` cost, `±X.X` gain, bar chart |

### Finding 4: Strategy-to-Agent Attribution Mapping

`STRATEGY_TO_AGENT` in metricsWriter.ts maps variant strategies to agent names:
- `generation`: structural_transform, lexical_simplify, grounding_enhance
- `evolution`: mutate_clarity, mutate_structure, crossover, creative_exploration
- `debate`: debate_synthesis
- `outlineGeneration`: outline_generation, mutate_outline
- `iterativeEditing`: critique_edit_* (prefix match)
- `sectionDecomposition`: section_decomposition_* (prefix match)
- `original`: original_baseline

**Important:** Only variant-generating agents get avg_elo metrics. Support agents (reflection, proximity, metaReview) and ranking agents (tournament, calibration) appear in cost tracking but NOT in the agent metrics table (they generate no variants).

### Finding 5: ROI Aggregation Uses Simple Arithmetic Mean

`getAgentROILeaderboardAction()` computes:
- `avgCostUsd = sum(cost_usd) / count` — no weighting
- `avgEloGain = sum(elo_gain) / count` — no weighting
- `avgEloPerDollar = sum(elo_per_dollar) / count` — averages the per-run ratios

This means a run with $0.01 cost and a run with $5.00 cost contribute equally to the agent's average.

### Finding 6: Agents Without Variants Are Excluded

In metricsWriter.ts:205: `if (!variants.length) continue;`

This means ranking agents (tournament, calibration) and support agents (reflection, proximity) that don't directly generate variants have NO rows in `evolution_run_agent_metrics`, even though they incur significant cost. Their costs appear in `costTracker.getAllAgentCosts()` but are silently dropped.

## Complete Data Flow

```
Pipeline Execution
  ├─ costTracker.recordSpend("agentX", $0.05) → spentByAgent map
  └─ variants generated with strategies (e.g., "structural_transform")

Pipeline Finalization (persistAgentMetrics)
  ├─ costTracker.getAllAgentCosts() → { generation: $0.30, evolution: $0.15, ... }
  ├─ For each agent with cost:
  │   ├─ Filter pool variants by getAgentForStrategy(v.strategy) === agentName
  │   ├─ Skip if no variants (excludes tournament, calibration, reflection, etc.)
  │   ├─ avg_elo = mean(variant.mu) from OpenSkill ratings
  │   ├─ elo_gain = avg_elo - 25
  │   └─ elo_per_dollar = elo_gain / cost_usd
  └─ Upsert to evolution_run_agent_metrics (one row per run×agent)

Explorer > Agents View
  └─ SELECT from evolution_run_agent_metrics WHERE run_id IN (filtered)
     → Individual rows displayed in TaskTable

Optimization > Agent Analysis
  └─ SELECT from evolution_run_agent_metrics WHERE created_at >= cutoff
     → Group by agent_name → arithmetic mean → AgentROILeaderboard
```

## Identified Gaps and Issues

### BUG: TreeSearch Strategy Mapping Missing (Critical)

`getAgentForStrategy()` has no pattern match for `tree_search_*`. TreeSearchAgent creates variants with strategy `tree_search_${revisionAction.type}` (treeSearchAgent.ts:77), but this returns `null` from the mapping function. All tree search variant metrics are **silently dropped** — no error logged.

**Fix:** Add `if (strategy.startsWith('tree_search_')) return 'treeSearch';` to `getAgentForStrategy()`.

### ISSUE: Explorer Table vs Matrix/Trend Use Different Rating Scales

| View | "Avg Rating" Source | Scale | Baseline |
|------|---------------------|-------|----------|
| Table (TaskTable) | `evolution_run_agent_metrics.avg_elo` | Raw mu (0-50) | 25 |
| Matrix/Trend | `evolution_variants.elo_score` (winner) | Elo scale (0-3000) | 1200 |

Same label, completely different numbers. The table shows "28" (mu) while the matrix shows "1400" (Elo scale) for similar data.

### ISSUE: `avg_elo` Uses mu Instead of Ordinal

`persistAgentMetrics()` is the ONLY place in the codebase that uses raw `mu` for ranking. Complete audit:
- `persistVariants()` → uses `ordinalToEloScale(getOrdinal())` ✓
- `computeFinalElo()` → uses `ordinalToEloScale(getOrdinal())` ✓
- `getTopByRating()` → uses `getOrdinal()` ✓
- Tournament pairing → uses `getOrdinal()` ✓
- Hall of Fame → uses ordinal ✓
- `persistAgentMetrics()` → uses raw `.mu` ✗

Numeric example: variant with mu=30, sigma=5 → mu says "30", ordinal says "15", Elo-scale says "~1440". Using mu inflates apparent skill by ~50%.

### ISSUE: Non-Generating Agent Costs Invisible in Metrics Table

| Agent | Generates Variants? | Has LLM Cost? | In agent_metrics? | Where Cost IS Visible |
|-------|---------------------|---------------|-------------------|-----------------------|
| generation | ✓ | ✓ | ✓ | Everywhere |
| evolution | ✓ | ✓ | ✓ | Everywhere |
| debate | ✓ | ✓ | ✓ | Everywhere |
| iterativeEditing | ✓ | ✓ | ✓ | Everywhere |
| sectionDecomposition | ✓ | ✓ | ✓ | Everywhere |
| outlineGeneration | ✓ | ✓ | ✓ | Everywhere |
| treeSearch | ✓ | ✓ | ✗ (bug above) | Budget tab, invocations |
| reflection | ✗ | ✓ ($0.05-0.50) | ✗ | Budget tab, invocations |
| calibration | ✗ | ✓ ($0.10-0.80) | ✗ | Budget tab, invocations |
| tournament | ✗ | ✗ ($0) | ✗ | N/A (zero cost) |
| proximity | ✗ | ✗ ($0) | ✗ | N/A (zero cost) |
| metaReview | ✗ | ✗ ($0) | ✗ | N/A (zero cost) |

`evolution_agent_invocations` tracks ALL agents with costs. `evolution_run_agent_metrics` only tracks variant-generating agents. The Budget tab (run detail) correctly shows all costs.

### ISSUE: Stale Migration Comment

DB migration comment says `(avg_elo - 1200) / cost_usd` but code computes `(avg_elo - 25) / cost_usd`.

### ISSUE: Unweighted ROI Aggregation

`getAgentROILeaderboardAction()` uses arithmetic mean of per-run `elo_per_dollar`. A $0.01 run and a $5.00 run contribute equally. No minimum sample size filtering applied by default (minSampleSize=1).

### ISSUE: Editing Agents Rating Attribution

All new variants (including edits) start with default rating `mu=25, sigma=8.333` — they do NOT inherit parent rating. This is actually fair (variants must prove quality through tournament), but means editing agents' `avg_elo` reflects tournament performance, not the quality delta from editing.

### BUG: `original` Agent Name Has No CostTracker Counterpart (Round 2)

Strategy `original_baseline` maps to agent `'original'` in STRATEGY_TO_AGENT, but no agent class uses `name = 'original'`. The baseline is created in `pipeline.ts` without going through any agent. In `persistAgentMetrics()`, the loop iterates over `costTracker.getAllAgentCosts()` keys — `'original'` will never be a key since no agent records cost under that name. The baseline variant's metrics are silently dropped.

### ISSUE: `persistAgentMetrics()` Has Zero Test Coverage (Round 2)

The function containing the mu vs ordinal bug (metricsWriter.ts:189-230) has **no unit tests at all**. Tests exist for `getAgentForStrategy()` (8 tests) and `computeFinalElo()` (3 tests), but the main metrics persistence function was never tested. This explains why both the mu/ordinal bug and the tree_search mapping bug went undetected.

### ISSUE: Explorer Matrix avgElo Test Is Misleading (Round 2)

`unifiedExplorerActions.test.ts` line 301-325 has a test named "computes avgElo metric correctly per cell" but it actually tests `totalCost` metric (line 316 sets `metric: 'totalCost'`). No test actually validates avgElo computation in the matrix view.

### FINDING: `evolution_agent_invocations` Is a Better Source of Truth (Round 2)

The `evolution_agent_invocations` table (per-agent-per-iteration granularity) already tracks ALL agents including non-generating ones, has per-invocation cost attribution, success/failure flags, and structured execution_detail with `_diffMetrics` (including `eloChanges` per variant). It's already used by the Budget tab, Timeline tab, and cost prediction. The `evolution_run_agent_metrics` table is a pre-computed aggregate that could be rebuilt from invocations data.

**Hybrid recommendation**: Keep `evolution_run_agent_metrics` for fast ROI queries but fix its computation to use ordinal-based Elo. Consider supplementing with invocations data for non-generating agent cost visibility.

## Complete Strategy-to-Agent Mapping

| Strategy Name | Agent Name | Status |
|---|---|---|
| `structural_transform` | `generation` | ✓ Direct entry |
| `lexical_simplify` | `generation` | ✓ Direct entry |
| `grounding_enhance` | `generation` | ✓ Direct entry |
| `mutate_clarity` | `evolution` | ✓ Direct entry |
| `mutate_structure` | `evolution` | ✓ Direct entry |
| `crossover` | `evolution` | ✓ Direct entry |
| `creative_exploration` | `evolution` | ✓ Direct entry |
| `debate_synthesis` | `debate` | ✓ Direct entry |
| `original_baseline` | `original` | ✓ Direct entry |
| `outline_generation` | `outlineGeneration` | ✓ Direct entry |
| `mutate_outline` | `outlineGeneration` | ✓ Direct entry |
| `critique_edit_*` | `iterativeEditing` | ✓ Pattern match |
| `section_decomposition_*` | `sectionDecomposition` | ✓ Pattern match |
| `tree_search_*` | — | ✗ **MISSING** → returns null |

## Proposed Fix for `persistAgentMetrics()` (Round 2)

**Before (Bug — metricsWriter.ts:207-209):**
```typescript
const eloSum = variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0);
const avgElo = eloSum / variants.length;
const eloGain = avgElo - 25;
```

**After (Consistent with `persistVariants()` and `computeFinalElo()`):**
```typescript
const eloSum = variants.reduce((s, v) => {
  const rating = ctx.state.ratings.get(v.id) ?? createRating();
  return s + ordinalToEloScale(getOrdinal(rating));
}, 0);
const avgElo = eloSum / variants.length;
const eloGain = avgElo - 1200;  // Correct baseline: Elo 1200, not mu 25
```

This makes agent metrics consistent with:
- `persistVariants()` → `ordinalToEloScale(getOrdinal(rating))` → `elo_score` column
- `computeFinalElo()` → `ordinalToEloScale(getOrdinal(rating))` → final Elo
- Explorer matrix/trend → reads `evolution_variants.elo_score` (already Elo-scale)
- Hall of Fame → stores and ranks by ordinal, displays as Elo-scale

## Issue Priority Summary

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | TreeSearch `tree_search_*` mapping missing | **Critical** (data loss) | Low (1 line) |
| 2 | `persistAgentMetrics` uses mu instead of ordinal | **High** (incorrect data) | Low (3 lines) |
| 3 | Explorer table vs matrix rating scale mismatch | **High** (confusing UI) | Low (fixed by #2) |
| 4 | `persistAgentMetrics()` has zero tests | **Medium** (quality) | Medium |
| 5 | Stale DB migration comment | **Low** (documentation) | Low |
| 6 | `original` agent name mismatch | **Low** (baseline only) | Low |
| 7 | Non-generating agent cost invisibility | **Low** (data exists elsewhere) | Medium |
| 8 | Unweighted ROI aggregation | **Low** (design choice) | Medium |
| 9 | Misleading explorer avgElo test | **Low** (test quality) | Low |

## Open Questions

1. Should non-generating agents (reflection, calibration) appear in agent_metrics with cost-only rows (`avg_elo=NULL`, `elo_per_dollar=NULL`)?
2. Should the ROI aggregation weight by cost or run size, or is simple mean acceptable?
3. Do existing `evolution_run_agent_metrics` rows need a data migration to recalculate values, or is fixing forward-only acceptable?
4. Should the Explorer task view's `formatElo()` be updated to expect Elo-scale values (1200+ range) after the fix?
