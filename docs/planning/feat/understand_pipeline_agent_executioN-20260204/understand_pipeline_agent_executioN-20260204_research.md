# Understand Pipeline Agent Execution Research

## Problem Statement
The Timeline tab at `/admin/quality/evolution/run/[runId]` currently shows a simplified view of each iteration: one agent name per iteration, a cost figure, variants added, and matches played. The goal is to understand what data exists about agent execution (inputs, outputs, costs, results) and what is currently surfaced versus what is missing, so we can design improvements that show comprehensive per-agent detail.

## High Level Summary

The Timeline tab reconstructs execution history from **checkpoint snapshots** rather than from direct agent-execution records. This creates a fundamental limitation: the timeline only sees the *last* agent per iteration (the end-of-iteration checkpoint) and derives metrics by diffing sequential snapshots. Meanwhile, the pipeline actually runs 3-9 agents per iteration, each producing an `AgentResult` with cost, variants added, matches played, and success status — but this data is **not persisted** to any queryable table.

The raw data to reconstruct full agent detail **does exist** in two places:
1. **`evolution_checkpoints`** — stores a checkpoint after *every* agent execution (not just end-of-iteration), keyed by `(run_id, iteration, last_agent)`. The timeline action currently de-duplicates to keep only the last checkpoint per iteration, discarding per-agent checkpoints.
2. **`llmCallTracking`** — stores every LLM call with full prompt, response, cost, tokens, and `call_source = 'evolution_{agentName}'`. Currently used only by the Budget tab for aggregate cost.

The gap is in the **visualization layer** — the data exists but the timeline action and component don't expose the per-agent granularity.

## Current Timeline Architecture

### Data Flow
```
evolution_checkpoints (DB)
    ↓ query: ORDER BY iteration ASC, created_at DESC
    ↓ de-duplicate: keep only LAST checkpoint per iteration
    ↓
getEvolutionRunTimelineAction (server action)
    ↓ diff sequential snapshots: pool size delta = variantsAdded, matchHistory delta = matchesPlayed
    ↓ query llmCallTracking for cost by agent (time-window correlation)
    ↓
TimelineData → TimelineTab (component)
    ↓ renders: one block per iteration, one agent entry per iteration
```

### TimelineData Type (current)
```typescript
interface TimelineData {
  iterations: {
    iteration: number;
    phase: PipelinePhase;
    agents: {                   // Currently always a single-element array
      name: string;             // last_agent from the last checkpoint
      costUsd: number;          // Total cost for that agent name across the whole run
      variantsAdded: number;    // Pool size delta between this and previous iteration
      matchesPlayed: number;    // Match history length delta
      strategy?: string;        // Currently unused
      error?: string;           // Currently unused
    }[];
  }[];
  phaseTransitions: { afterIteration: number; reason: string }[];
}
```

### Key Limitations of Current Implementation

1. **One agent per iteration shown**: De-duplication keeps only the last checkpoint per iteration. In reality, EXPANSION runs 3 agents (Generation, CalibrationRanker, Proximity) and COMPETITION runs up to 9 (Generation, Reflection, IterativeEditing, Debate, Evolution, Tournament, Proximity, MetaReview, plus iteration_complete).

2. **Cost attribution is run-level, not iteration-level**: Cost is queried from `llmCallTracking` using the run's time window, then grouped by agent name. This gives the *total* cost per agent for the entire run, not per-iteration.

3. **Phase detection is heuristic**: The timeline action determines phase as `poolSize > 10 ? 'COMPETITION' : 'EXPANSION'` rather than reading the actual phase stored in the checkpoint.

4. **Metrics are deltas, not direct**: Variants added and matches played are computed by diffing sequential snapshots rather than read from `AgentResult` (which is not persisted).

## What Data IS Available (Per-Agent)

### In `evolution_checkpoints` table
- **Schema**: `(id, run_id, iteration, phase, last_agent, state_snapshot JSONB, created_at)`
- **Unique constraint**: `(run_id, iteration, last_agent)` — so there IS one checkpoint per agent per iteration
- **last_agent values**: `generation`, `calibration`, `tournament`, `evolution`, `reflection`, `iterativeEditing`, `debate`, `proximity`, `metaReview`, `iteration_complete`
- **state_snapshot** contains full pool, eloRatings, matchHistory, allCritiques, debateTranscripts, diversityScore, metaFeedback, similarityMatrix

By diffing checkpoint N (agent A) against checkpoint N-1 (previous agent), you can reconstruct exactly what each agent added to the pool and match history.

### In `llmCallTracking` table
- **Schema**: `(id, prompt, call_source, content, raw_api_response, model, prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, finish_reason, created_at, userid, estimated_cost_usd)`
- **call_source**: `evolution_{agentName}` (e.g., `evolution_generation`, `evolution_pairwise`)
- Contains full prompt and full response for every LLM call
- Has timestamps that could be correlated to iterations (though no iteration column)

### In `content_evolution_runs.run_summary` (JSONB)
- `strategyEffectiveness`: per-strategy count and avgElo
- `matchStats`: totalMatches, avgConfidence, decisiveRate
- `topVariants`: top 5 by Elo with strategy
- `metaFeedback`: successful strategies, weaknesses, patterns to avoid
- `stopReason`, `finalPhase`, `totalIterations`, `durationSeconds`

### In `content_evolution_variants` table
- Per-variant: id, run_id, variant_content, elo_score, generation, parent_variant_id, agent_name (strategy), match_count, is_winner

## What Data IS NOT Available

1. **AgentResult per execution**: `success`, `costUsd`, `variantsAdded`, `matchesPlayed`, `convergence`, `skipped`, `reason` — all computed in memory, logged, but NOT persisted to any table
2. **Per-iteration cost breakdown**: llmCallTracking has no `iteration` column
3. **Run ID on LLM calls**: llmCallTracking has no `run_id` column — cost attribution uses time-window correlation (which can overlap with concurrent runs)
4. **Agent skip reasons**: When agents are skipped (preconditions not met, feature flags off), this is logged but not stored
5. **Debate transcripts**: Only in checkpoint state_snapshot (JSON), not as a dedicated queryable structure
6. **Critique detail per variant**: Stored in allCritiques in checkpoint, but only for top-3 variants per iteration

## What Each Phase Runs (Supervisor Config)

### EXPANSION Phase
| Agent | Runs | Purpose |
|-------|------|---------|
| GenerationAgent | Always | 3 new variants (3 strategies) |
| CalibrationRanker | Always | Pairwise ranking, 3 opponents per entrant |
| ProximityAgent | Always | Diversity score computation |

### COMPETITION Phase
| Agent | Runs | Purpose |
|-------|------|---------|
| GenerationAgent | Always | 3 new variants (rotating single strategy) |
| ReflectionAgent | Always | Critique top 3 variants, 5 dimensions |
| IterativeEditingAgent | Feature flag | Critique→edit→judge on top variant |
| DebateAgent | Feature flag | 3-turn debate on top 2 variants |
| EvolutionAgent | Feature flag | Mutation/crossover/creative exploration |
| Tournament or Calibration | Always | Ranking with 5 opponents per entrant |
| ProximityAgent | Always | Diversity monitoring |
| MetaReviewAgent | Always | Strategy analysis (no LLM calls) |

### Pipeline Execution Order (per iteration in `executeFullPipeline`)
1. Generation
2. Reflection (COMPETITION only)
3. IterativeEditing (COMPETITION only, feature-flagged)
4. Debate (COMPETITION only, feature-flagged)
5. Evolution (feature-flagged)
6. Calibration/Tournament
7. Proximity
8. MetaReview (COMPETITION only)
9. `persistCheckpointWithSupervisor` → last_agent = `iteration_complete`

Each agent gets its own checkpoint via `persistCheckpoint` in the `runAgent` helper (pipeline.ts:561).

## Checkpoint Granularity Analysis

For a run with 3 EXPANSION + 5 COMPETITION iterations, the checkpoint table would contain approximately:

**EXPANSION (iter 0-2)**: 3 agents × 3 iterations = 9 checkpoints + 3 iteration_complete = 12
**COMPETITION (iter 3-7)**: up to 8 agents × 5 iterations = 40 checkpoints + 5 iteration_complete = 45

Total: ~57 checkpoints, each with full pipeline state JSON. All of these are **queryable** — the timeline action just doesn't use them.

## Other Tabs That Show Agent Data

### BudgetTab
- Cumulative burn curve (cost over time, all agents)
- Agent cost breakdown bar chart (total cost per agent for entire run)
- Data source: `llmCallTracking` filtered by time window

### VariantsTab
- Sortable table: Rank, ID, Elo, Trend (sparkline), Matches, Strategy, Generation, Content
- Strategy filter dropdown
- Shows which agent created each variant (`agent_name` = strategy)
- Data source: `content_evolution_variants` + `evolution_checkpoints` for Elo history

### EloTab
- Elo trajectory line chart per variant over iterations
- Top-N filtering slider
- Strategy-colored lines

### LineageTab
- D3 DAG showing variant parentage
- Node click to inspect variant details

## Documents Read
- `docs/feature_deep_dives/evolution_pipeline.md`
- `docs/feature_deep_dives/evolution_pipeline_visualization.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read
- `src/components/evolution/tabs/TimelineTab.tsx` — Timeline UI component
- `src/components/evolution/tabs/BudgetTab.tsx` — Budget UI component
- `src/components/evolution/tabs/VariantsTab.tsx` — Variants UI component
- `src/lib/services/evolutionVisualizationActions.ts` — All 6 visualization server actions
- `src/lib/evolution/types.ts` — All shared types
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator (minimal + full)
- `src/lib/evolution/core/supervisor.ts` — Phase config, transitions, stopping conditions
- `src/lib/evolution/core/state.ts` — State serialization/deserialization
- `src/lib/evolution/core/costTracker.ts` — Budget enforcement and attribution
- `src/lib/evolution/core/llmClient.ts` — LLM client with cost tracking
- `src/lib/evolution/agents/generationAgent.ts` — Generation agent
- `src/lib/evolution/agents/reflectionAgent.ts` — Reflection agent
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Iterative editing agent
- `src/lib/evolution/agents/pairwiseRanker.ts` — Pairwise ranker
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail page
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — Checkpoint table DDL
- All 9 agent files in `src/lib/evolution/agents/` — Full execute() analysis

---

## Deep Dive: Agent Execute() Outputs & State Mutations

### Summary Table: What Each Agent Produces

| Agent | AgentResult Fields | Pool Add | Elo Updates | Match History | Other State Writes | LLM Calls |
|-------|-------------------|----------|-------------|---------------|-------------------|-----------|
| **Generation** | costUsd, variantsAdded, success | ✓ 3-4 vars | ✓ init@1200 | — | — | 3 parallel |
| **Calibration** | costUsd, matchesPlayed, convergence | — | ✓ update | ✓ append | — | 2-N (cached) |
| **Tournament** | costUsd, matchesPlayed, convergence | — | ✓ update | ✓ append | — | 4-80 |
| **Evolution** | costUsd, variantsAdded | ✓ 3-4 vars | ✓ init@1200 | — | — | 3-4 parallel |
| **Reflection** | costUsd, success | — | — | — | allCritiques, dimensionScores | 3 parallel |
| **IterativeEditing** | costUsd, variantsAdded | ✓ 1-3 vars | ✓ init@1200 | — | allCritiques (inline) | 3-12/cycle |
| **Debate** | variantsAdded (costUsd=0 bug) | ✓ 1 var | ✓ init@1200 | — | debateTranscripts | 4 sequential |
| **Proximity** | costUsd, success | — | — | — | similarityMatrix, diversityScore | 0 |
| **MetaReview** | costUsd=0, success | — | — | — | metaFeedback | 0 |

### Key Observations

1. **Pool-adding agents** (Generation, Evolution, IterativeEditing, Debate) automatically initialize new variants with Elo=1200 via `addToPool()`

2. **Ranking agents** (Calibration, Tournament) update Elo & matchCounts via `updateEloWithConfidence()` with adaptive K-factor

3. **State mutations are sequential** — LLM calls are parallel via `Promise.allSettled`, but state writes happen after all promises resolve

4. **Critiques are append-only** — Reflection creates critiques for top-3 variants; IterativeEditing appends inline critiques for accepted edits

5. **Debate transcripts store complete 4-turn conversations** including partial failures

6. **MetaReview and Proximity make zero LLM calls** — pure computation on existing state

---

## Deep Dive: Checkpoint Diffing Feasibility

### Reconstruction Algorithm

```typescript
// For each iteration, fetch ALL checkpoints (not just the last one)
const checkpoints = await supabase
  .from('evolution_checkpoints')
  .select('last_agent, state_snapshot, created_at')
  .eq('run_id', runId)
  .eq('iteration', iteration)
  .order('created_at', { ascending: true });

// Diff sequential checkpoints to get per-agent metrics
function computeAgentMetrics(before, after) {
  return {
    variantsAdded: after.pool.length - before.pool.length,
    matchesPlayed: after.matchHistory.length - before.matchHistory.length,
    eloChanges: diffEloRatings(before.eloRatings, after.eloRatings),
    critiquesAdded: (after.allCritiques?.length ?? 0) - (before.allCritiques?.length ?? 0),
    debatesAdded: after.debateTranscripts.length - before.debateTranscripts.length,
    diversityScoreAfter: after.diversityScore,
    metaFeedbackPopulated: before.metaFeedback === null && after.metaFeedback !== null,
  };
}
```

### Derivable Metrics by Diffing

| Metric | Source Diff | Derivable? |
|--------|-------------|------------|
| Variants added by agent | pool.length delta | ✅ YES |
| Matches played by agent | matchHistory.length delta | ✅ YES |
| Elo movements | eloRatings[id] delta | ✅ YES |
| Match confidence values | New Match[] entries | ✅ YES |
| Critiques populated | allCritiques length delta | ✅ YES |
| Diversity score | diversityScore field | ✅ YES |
| Debate transcripts | debateTranscripts length delta | ✅ YES |
| Meta-feedback | metaFeedback null→populated | ✅ YES |
| **Cost per agent** | ❌ NOT IN SNAPSHOT | Requires timestamp correlation |
| **Convergence metrics** | ❌ NOT IN SNAPSHOT | Lost after agent completes |

### Edge Cases

1. **Skipped agents**: If `canExecute()` returns false, no checkpoint row is created. Walk backward to find previous checkpoint.

2. **First iteration**: Use empty baseline state (pool=[], matchHistory=[], etc.)

3. **iteration_complete checkpoint**: Final checkpoint for iteration includes `supervisorState` for resume support.

---

## Deep Dive: LLM Cost Correlation

### Current Approach (Time-Window)

```typescript
// evolutionVisualizationActions.ts lines 230-242
const calls = await supabase
  .from('llmCallTracking')
  .select('call_source, estimated_cost_usd')
  .like('call_source', 'evolution_%')
  .gte('created_at', run.started_at)
  .lte('created_at', run.completed_at);
```

**Problems**:
- No `run_id` column — concurrent runs overlap
- No `iteration` column — can't attribute to specific iterations
- Relies on `userid` + time window + call_source prefix

### Per-Iteration Cost Attribution (Feasible)

Can correlate using checkpoint timestamps:
```typescript
// Get checkpoint boundaries for iteration
const checkpoints = await getCheckpointsForIteration(runId, iteration);

// For each LLM call, find which agent's time window it falls into
for (const call of llmCalls) {
  const checkpoint = checkpoints.find(cp =>
    cp.created_at > call.created_at &&
    call.call_source.includes(cp.last_agent)
  );
  // Attribute call.estimated_cost_usd to checkpoint.last_agent
}
```

**Limitation**: Breaks if same user runs concurrent evolution runs (overlapping time windows).

**Long-term fix**: Add `run_id` FK to `llmCallTracking` table.

---

## Deep Dive: UI Patterns for Enhanced Timeline

### Available Components (Already in Codebase)

| Pattern | Source | Reusable For |
|---------|--------|--------------|
| **Expandable rows** | VariantsTab (toggle View/Hide) | Showing agent details on click |
| **Strategy colors** | STRATEGY_PALETTE (6 colors) | Color-coding agent types |
| **Sparklines** | EloSparkline (60×20px Recharts) | Inline cost/variant trends |
| **Phase badges** | PhaseIndicator component | Per-agent phase context |
| **Status badges** | EvolutionStatusBadge | Agent error states |
| **Bar charts** | BudgetTab (Recharts BarChart) | Per-agent cost breakdown |
| **Area charts** | BudgetTab (Recharts AreaChart) | Cumulative metrics |

### Design System (Midnight Scholar Theme)

```
Colors:
- var(--accent-gold) — primary highlight
- var(--surface-elevated) — card backgrounds
- var(--surface-secondary) — nested/expanded content
- var(--text-primary/secondary/muted) — text hierarchy

Spacing:
- rounded-book (6px) — containers
- rounded-page (4px) — inline elements
- p-4, gap-4 — standard spacing

Typography:
- font-mono — IDs, costs, technical data
- text-xs — labels, metadata
- text-sm — body text
```

### Proposed Enhanced Timeline Structure

```
Iteration Block (elevated container)
├── Header Row: "Iteration N" + PhaseIndicator + totals summary
├── Agent List (collapsed by default)
│   ├── Agent Row (surface-secondary, strategy-colored left border)
│   │   ├── Name + status badge
│   │   ├── Inline metrics: +X variants, Y matches, $0.XXX
│   │   └── [Expand button]
│   └── [Expanded Detail Panel]
│       ├── Mini bar chart: cost breakdown by LLM call type
│       ├── Variants added table (ID, strategy, Elo init)
│       ├── Match results table (pairs, winner, confidence)
│       └── Error/skip message if applicable
```

### No New Dependencies Required
- Recharts already installed
- shadcn/ui primitives available (button, card, dialog)
- Strategy palette defined
- Expandable pattern proven in VariantsTab

---

## Key Finding: Why Only "generation" and "calibration" Appear

**Root Cause: The admin UI uses `executeMinimalPipeline`, not `executeFullPipeline`.**

### Evidence Chain

1. **Admin trigger action** (`src/lib/services/evolutionActions.ts:347`):
   ```typescript
   const agents = [new GenerationAgent(), new CalibrationRanker()];
   const startMs = Date.now();
   state.startNewIteration();
   await executeMinimalPipeline(runId, agents, ctx, evolutionLogger, { startMs });
   ```

   The `_triggerEvolutionRunAction` explicitly instantiates only **2 agents**:
   - `GenerationAgent`
   - `CalibrationRanker`

2. **Two pipeline modes exist** (`src/lib/evolution/core/pipeline.ts`):

   | Pipeline | Agents | Used By |
   |----------|--------|---------|
   | `executeMinimalPipeline` (lines 209-291) | 2: generation, calibration | **Production admin UI** |
   | `executeFullPipeline` (lines 323-525) | 8-9: generation, reflection, iterativeEditing, debate, evolution, calibration/tournament, proximity, metaReview | **Unit tests only** |

3. **Full pipeline is exported but never called**:
   - `src/lib/evolution/index.ts:32` exports `executeFullPipeline`
   - **No production code imports or calls it** — only `pipeline.test.ts` uses it
   - Searched for `executeFullPipeline` across all `src/` — found only in tests

4. **No worker or cron executes evolution runs**:
   - `evolution-watchdog` cron only marks stale runs as failed
   - No background worker exists to pick up pending runs
   - All execution happens inline via `triggerEvolutionRunAction`

### Supervisor Configuration (Unused)

The `PoolSupervisor` in `supervisor.ts` defines rich phase configs that would enable all agents:

**EXPANSION phase** (lines 146-170):
- runGeneration: ✓
- runReflection: ✗
- runIterativeEditing: ✗
- runDebate: ✗
- runEvolution: ✗
- runCalibration: ✓
- runProximity: ✓
- runMetaReview: ✗

**COMPETITION phase** (lines 172-187):
- All agents enabled: ✓ generation, ✓ reflection, ✓ iterativeEditing, ✓ debate, ✓ evolution, ✓ calibration, ✓ proximity, ✓ metaReview

But since `executeFullPipeline` is never called in production, these configs go unused.

### Checkpoint Persistence Analysis

Looking at `pipeline.ts`, each agent that runs calls `persistCheckpoint()` after completion (line 561):
```typescript
await persistCheckpoint(runId, ctx.state, agent.name, phase, logger);
```

So the checkpoints table **correctly reflects** which agents actually ran:
- If only `GenerationAgent` and `CalibrationRanker` run → checkpoints show `generation` and `calibration`
- The ProximityAgent, ReflectionAgent, etc. simply **never execute** in production

### Implications

1. **The Timeline UI is working correctly** — it shows exactly the agents that ran
2. **The pipeline infrastructure for more agents exists** but is unused
3. **To see more agents**, the admin would need to:
   - Either modify `triggerEvolutionRunAction` to use `executeFullPipeline` with full agent set
   - Or create a background runner that processes pending runs with the full pipeline

### Additional Files Examined
- `src/lib/services/evolutionActions.ts` — Admin trigger action (minimal pipeline)
- `src/lib/evolution/core/pipeline.ts` — Both pipeline modes
- `src/lib/evolution/core/supervisor.ts` — Phase configuration (unused in production)
- `src/app/api/cron/evolution-watchdog/route.ts` — Only marks stale runs, doesn't execute
