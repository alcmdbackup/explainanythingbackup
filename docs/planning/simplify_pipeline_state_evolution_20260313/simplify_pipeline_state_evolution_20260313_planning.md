# Simplify Pipeline State Evolution Plan

## Background
The PipelineState is a shared mutable object that every agent reads and writes in-place during pipeline execution. This makes it hard to understand which agents communicate through which fields, impossible to track what changed and when without external instrumentation (diffMetrics was bolted on for this), and blocks future parallel agent execution. This project replaces the mutable shared state with an immutable state + reducer (action dispatch) pattern, moves agent-local fields out of shared state, and defaults unnecessarily nullable fields.

## Requirements (from GH Issue #698)
1. **Immutable state + reducer** — Agents receive read-only state and return actions; pipeline applies actions via a reducer to produce new state
2. **Move 5 single-agent fields to agent-local state** — `similarityMatrix`, `treeSearchResults`, `treeSearchStates`, `sectionState`, `debateTranscripts`
3. **Default nullable fields** — `allCritiques: []`, `diversityScore: 0` (keep `metaFeedback | null`)
4. **Fix phase comments** — Replace misleading "Phase N" with grouping comments
5. **Derive diffMetrics from actions** — Replace before/after snapshots with action-based computation
6. **Agent checkpoint hooks** — For agent-local state persistence across resume
7. **Backward compatibility** — Old checkpoints must still deserialize
8. **Update tests and docs**

Out of scope (deferred):
- dimensionScores removal (109 test refs, flow: prefix merging, UI reads)

## Problem
PipelineState is mutated in-place by agents — `state.addToPool(v)`, `state.ratings.set(id, r)`, `state.allCritiques.push(...c)`. This means:
1. **Invisible dependencies** — Can't tell which agents communicate through which fields without reading every agent
2. **No audit trail** — The diffMetrics system was bolted on to answer "what did this agent change?" by snapshotting state before/after each agent
3. **Ordering sensitivity** — Changing agent order silently changes behavior because agents see different state
4. **No path to parallelism** — Concurrent agents would race on shared mutable fields

An immutable state + reducer fixes all four: actions are explicit contracts, actions ARE the audit trail, actions can be merged from parallel agents, and agents can't accidentally depend on mutation order.

## Options Considered

### Option A: Immutable state + reducer (CHOSEN)
Agents return `PipelineAction[]` from execute(). Pipeline applies actions via a pure reducer. State is a new immutable snapshot after each agent. Agent-local fields move to agent instances with checkpoint hooks.

**Pros:** Explicit contracts, free audit trail, parallelism-ready, diffMetrics computed from actions
**Cons:** Every agent rewritten, new action type system, ~50+ files changed

### Option B: Agent checkpoint hooks only (original plan)
Move agent-local fields to agent instances, keep mutable shared state.

**Pros:** Smaller scope (~30 files)
**Cons:** Doesn't fix the core problem — shared mutable state persists, no path to parallelism

### Option C: Event sourcing
Store all actions in a log, reconstruct state by replaying.

**Pros:** Full audit trail, time travel
**Cons:** Over-engineered for this use case, complex replay logic, significant perf overhead

**Decision: Option A** — addresses the root architectural issue while naturally solving the original goals (field movement, audit trail, simplification).

## Action Type Design

All mutations from the research phase, categorized into action types:

```typescript
// --- Pool Actions ---
type AddToPool = {
  type: 'ADD_TO_POOL';
  variants: TextVariation[];
};

type StartNewIteration = {
  type: 'START_NEW_ITERATION';
};

// --- Ranking Actions ---
type RecordMatches = {
  type: 'RECORD_MATCHES';
  matches: Match[];
  ratingUpdates: Record<string, { mu: number; sigma: number }>;
  matchCountIncrements: Record<string, number>;
};

// --- Analysis Actions ---
type AppendCritiques = {
  type: 'APPEND_CRITIQUES';
  critiques: Critique[];
  dimensionScoreUpdates: Record<string, Record<string, number>>;
};

type MergeFlowScores = {
  type: 'MERGE_FLOW_SCORES';
  variantScores: Record<string, Record<string, number>>;  // already flow:-prefixed
};

type SetDiversityScore = {
  type: 'SET_DIVERSITY_SCORE';
  diversityScore: number;
};

type SetMetaFeedback = {
  type: 'SET_META_FEEDBACK';
  feedback: MetaFeedback;
};

// --- Arena ---
type UpdateArenaSyncIndex = {
  type: 'UPDATE_ARENA_SYNC_INDEX';
  lastSyncedMatchIndex: number;
};

type PipelineAction =
  | AddToPool
  | StartNewIteration
  | RecordMatches
  | AppendCritiques
  | MergeFlowScores
  | SetDiversityScore
  | SetMetaFeedback
  | UpdateArenaSyncIndex;
```

### Agent → Action Mapping

| Agent | Actions Returned |
|---|---|
| generationAgent | `ADD_TO_POOL` (3 variants) |
| outlineGenerationAgent | `ADD_TO_POOL` (1 variant) |
| calibrationRanker | `RECORD_MATCHES` |
| tournament | `RECORD_MATCHES` |
| reflectionAgent | `APPEND_CRITIQUES` |
| iterativeEditingAgent | `ADD_TO_POOL` (0-1 variant) |
| treeSearchAgent | `ADD_TO_POOL` (0-1 variant) |
| sectionDecompositionAgent | `ADD_TO_POOL` (0-1 variant) |
| debateAgent | `ADD_TO_POOL` (0-1 variant) |
| evolvePool | `ADD_TO_POOL` (1-4 variants) |
| proximityAgent | `SET_DIVERSITY_SCORE` |
| metaReviewAgent | `SET_META_FEEDBACK` |
| pipeline (flow critique) | `APPEND_CRITIQUES` + `MERGE_FLOW_SCORES` |
| pipeline (iteration) | `START_NEW_ITERATION` |

### Agent-Local State (not actions, not on PipelineState)

Agents are singletons per run — `createDefaultAgents()` creates one instance, reused across all iterations. Private state accumulates in-memory on the agent instance via regular class fields:

```typescript
class DebateAgent extends AgentBase {
  private transcripts: DebateTranscript[] = [];

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    // ... run debate ...
    this.transcripts.push(transcript);
    return { actions: [{ type: 'ADD_TO_POOL', variants: [synthesis] }], ... };
  }

  getCheckpointData() { return { transcripts: this.transcripts }; }
  restoreFromCheckpoint(data: unknown) { this.transcripts = (data as any).transcripts ?? []; }
}
```

**Storage lifecycle:**
- **During execution**: In-memory on agent instance (regular class field)
- **Between iterations**: Same instance, still in memory
- **Across resume**: Serialized to `SerializedCheckpoint.agentCheckpoints` in DB, restored via hook on resume

| Agent | Private State | Serialized via checkpoint hook |
|---|---|---|
| ProximityAgent | `similarityMatrix` | Yes — needed to compute incremental updates |
| TreeSearchAgent | `treeSearchResults`, `treeSearchStates` | Yes — UI reads from checkpoint snapshot |
| SectionDecompositionAgent | `sectionState` | No — UI reads from execution_detail |
| DebateAgent | `debateTranscripts` | Yes — timeline counts length |

### ReadonlyPipelineState

Agents receive an immutable view. The interface exposes only read methods:

```typescript
interface ReadonlyPipelineState {
  readonly originalText: string;
  readonly iteration: number;
  readonly pool: readonly TextVariation[];
  readonly newEntrantsThisIteration: readonly string[];
  readonly ratings: ReadonlyMap<string, Rating>;
  readonly matchCounts: ReadonlyMap<string, number>;
  readonly matchHistory: readonly Match[];
  readonly dimensionScores: Readonly<Record<string, Record<string, number>>> | null;
  readonly allCritiques: readonly Critique[];
  readonly diversityScore: number;
  readonly metaFeedback: Readonly<MetaFeedback> | null;
  readonly lastSyncedMatchIndex: number;

  getTopByRating(n: number): readonly TextVariation[];
  getVariationById(id: string): TextVariation | undefined;
  getPoolSize(): number;
  hasVariant(id: string): boolean;
}
```

### AgentResult Changes

```typescript
// Current:
interface AgentResult {
  agentType: string;
  success: boolean;
  costUsd: number;
  executionDetail: unknown;
}

// New:
interface AgentResult {
  agentType: string;
  success: boolean;
  costUsd: number;
  executionDetail: unknown;
  actions: PipelineAction[];  // NEW — state mutations as data
}
```

### Reducer

```typescript
function applyAction(state: PipelineStateImpl, action: PipelineAction): PipelineStateImpl {
  switch (action.type) {
    case 'ADD_TO_POOL':
      return state.withAddedVariants(action.variants);
    case 'START_NEW_ITERATION':
      return state.withNewIteration();
    case 'RECORD_MATCHES':
      return state.withMatches(action.matches, action.ratingUpdates, action.matchCountIncrements);
    case 'APPEND_CRITIQUES':
      return state.withCritiques(action.critiques, action.dimensionScoreUpdates);
    case 'MERGE_FLOW_SCORES':
      return state.withFlowScores(action.variantScores);
    case 'SET_DIVERSITY_SCORE':
      return state.withDiversityScore(action.diversityScore);
    case 'SET_META_FEEDBACK':
      return state.withMetaFeedback(action.feedback);
    case 'UPDATE_ARENA_SYNC_INDEX':
      return state.withArenaSyncIndex(action.lastSyncedMatchIndex);
  }
}

function applyActions(state: PipelineStateImpl, actions: PipelineAction[]): PipelineStateImpl {
  return actions.reduce(applyAction, state);
}
```

### DiffMetrics from Actions

```typescript
function computeDiffMetricsFromActions(actions: PipelineAction[], stateBefore: ReadonlyPipelineState, stateAfter: ReadonlyPipelineState): DiffMetrics {
  const variantsAdded = actions
    .filter((a): a is AddToPool => a.type === 'ADD_TO_POOL')
    .reduce((sum, a) => sum + a.variants.length, 0);

  const newVariantIds = actions
    .filter((a): a is AddToPool => a.type === 'ADD_TO_POOL')
    .flatMap(a => a.variants.map(v => v.id));

  const matchesPlayed = actions
    .filter((a): a is RecordMatches => a.type === 'RECORD_MATCHES')
    .reduce((sum, a) => sum + a.matches.length, 0);

  const critiquesAdded = actions
    .filter((a): a is AppendCritiques => a.type === 'APPEND_CRITIQUES')
    .reduce((sum, a) => sum + a.critiques.length, 0);

  // Elo changes still computed from state before/after (need both snapshots for rating delta)
  const eloChanges = computeEloChanges(stateBefore, stateAfter);

  // These can be read from specific actions:
  const diversityScoreAfter = actions.find((a): a is SetDiversityScore => a.type === 'SET_DIVERSITY_SCORE')?.diversityScore ?? stateBefore.diversityScore;
  const metaFeedbackPopulated = actions.some(a => a.type === 'SET_META_FEEDBACK');

  return {
    variantsAdded,
    newVariantIds,
    matchesPlayed,
    eloChanges,
    critiquesAdded,
    debatesAdded: 0,  // Now tracked by DebateAgent checkpoint, not state
    diversityScoreAfter,
    metaFeedbackPopulated,
  };
}
```

Note: `debatesAdded` moves to DebateAgent checkpoint data. The timeline can read it from `agentCheckpoints.debate.transcripts.length` delta.

## Action Logging & Dashboard Visibility

### Current logging infrastructure

Three places agent execution data appears today:

1. **Structured logs** → `evolution_run_logs` table (via `EvolutionLogger` + `LogBuffer`). Columns: `run_id`, `iteration`, `agent_name`, `level`, `message`, `context` (JSONB). Visible in **Logs tab**.
2. **Execution detail** → `evolution_agent_invocations.execution_detail` (JSONB). Contains agent-specific detail + `_diffMetrics` merged in. Visible in **Timeline tab** agent detail panels.
3. **Run summary** → `evolution_runs.run_summary` (JSONB). Aggregated at pipeline finalization. Visible in **run detail page**.

### What changes with actions

Actions replace the opaque "mutate state → diff before/after" pattern with explicit, typed mutations. We make actions visible at every level:

#### Per-agent invocation: `_actions` in execution_detail
After each agent, the pipeline stores a summary of the actions in `execution_detail` alongside `_diffMetrics`:

```typescript
const executionDetail = {
  ...agentDetail,
  _diffMetrics: computeDiffMetricsFromActions(result.actions, stateBefore, stateAfter),
  _actions: summarizeActions(result.actions),  // NEW
};
```

`summarizeActions()` produces a compact log-friendly representation:

```typescript
function summarizeActions(actions: PipelineAction[]): ActionSummary[] {
  return actions.map(a => {
    switch (a.type) {
      case 'ADD_TO_POOL':
        return { type: a.type, count: a.variants.length, variantIds: a.variants.map(v => v.id) };
      case 'RECORD_MATCHES':
        return { type: a.type, matchCount: a.matches.length, ratingUpdates: Object.keys(a.ratingUpdates).length };
      case 'APPEND_CRITIQUES':
        return { type: a.type, count: a.critiques.length, variantIds: a.critiques.map(c => c.variationId) };
      case 'SET_DIVERSITY_SCORE':
        return { type: a.type, score: a.diversityScore };
      case 'SET_META_FEEDBACK':
        return { type: a.type };
      default:
        return { type: a.type };
    }
  });
}
```

This keeps `execution_detail` under the 100KB JSONB cap (summaries, not full payloads) and is already visible in existing Timeline agent detail panels.

#### Per-agent: structured log entries
Each action also gets logged via `EvolutionLogger` → `evolution_run_logs`:

```typescript
for (const action of result.actions) {
  logger.debug(`Action: ${action.type}`, {
    agent_name: agent.name,
    iteration: state.iteration,
    action_type: action.type,
    ...actionContext(action),  // e.g. { variantCount: 3 } for ADD_TO_POOL
  });
}
```

This appears in the **Logs tab** with the existing filtering (by agent, iteration, level).

#### Run-level: action counts in run_summary
`buildRunSummary()` gets a new `actionCounts` section aggregating all actions across the run:

```typescript
actionCounts: {
  ADD_TO_POOL: 47,
  RECORD_MATCHES: 15,
  APPEND_CRITIQUES: 12,
  SET_DIVERSITY_SCORE: 15,
  SET_META_FEEDBACK: 8,
  MERGE_FLOW_SCORES: 12,
}
```

#### Timeline tab: action chips
The Timeline's `AgentDetailPanel` can display action types as chips/badges alongside existing metrics. No new DB queries needed — reads from `_actions` in `execution_detail`.

### Dashboard integration — all entity levels

Currently only Runs have a Logs tab (`evolution_run_logs`). Experiments, prompts, and strategies show related runs but have no direct log/action views. Invocations show `execution_detail` JSONB. We add action visibility at every level:

#### Run level (existing Logs tab + Timeline tab)
- **Logs tab**: Action entries logged to `evolution_run_logs` with `action_type` in context JSONB. Filterable by agent, iteration, level.
- **Timeline tab**: `_actions` summaries in `execution_detail` displayed as chips in AgentDetailPanel.
- **Run detail overview**: `run_summary.actionCounts` — aggregate counts per action type.

#### Invocation level (existing Execution Detail tab)
- **Execution Detail tab**: `_actions` array in `execution_detail` JSONB. Shows which actions this specific agent invocation produced, with variant IDs and counts.
- **Overview tab**: Action type badges alongside existing metrics (variants added, matches played, cost).
- Data source: `evolution_agent_invocations.execution_detail._actions`

#### Experiment level (new section on existing Metrics tab)
- **Metrics tab**: Add "Action Distribution" section aggregating `actionCounts` across all runs in the experiment.
- Data: Query `evolution_runs.run_summary->>'actionCounts'` WHERE `experiment_id = ?`, aggregate in server action.
- Shows: total action counts by type, per-run breakdown, action count over time (if multiple runs).
- Server action: extend `getRunMetricsAction()` to include action aggregation.

#### Prompt level (new section on existing Overview tab)
- **Overview tab**: Add "Action Summary" section aggregating across all runs for this prompt.
- Data: Query `evolution_runs.run_summary->>'actionCounts'` WHERE `prompt_id = ?`, aggregate.
- Shows: total actions by type across all runs, avg actions per run.
- Server action: new `getPromptActionSummaryAction()` or extend existing prompt detail action.

#### Strategy level (new section on existing Metrics tab)
- **Metrics tab**: Add "Action Profile" section showing typical action distribution for runs using this strategy.
- Data: Query `evolution_runs.run_summary->>'actionCounts'` WHERE `strategy_config_id = ?`, aggregate.
- Shows: avg action counts per run by type, comparison to other strategies.
- Server action: extend `getStrategyDetailAction()` to include action aggregation.

### Summary table

| Entity | Where stored | Where displayed | What's new |
|---|---|---|---|
| Per-action | `evolution_run_logs.context` | Run Logs tab | `action_type` in context JSONB |
| Per-invocation | `execution_detail._actions` | Invocation detail + Timeline | Action summaries + type badges |
| Per-invocation | `execution_detail._diffMetrics` | Timeline metrics | Same as today, computed from actions |
| Per-run | `run_summary.actionCounts` | Run overview | Aggregate action type counts |
| Per-experiment | Derived from `run_summary` | Experiment Metrics tab | Action distribution across runs |
| Per-prompt | Derived from `run_summary` | Prompt Overview tab | Action summary across runs |
| Per-strategy | Derived from `run_summary` | Strategy Metrics tab | Action profile per strategy |

### Files affected for action logging

**Core pipeline (Phase 3):**
- `evolution/src/lib/core/pipeline.ts` — Log actions after applying via reducer; add actionCounts to buildRunSummary
- `evolution/src/lib/core/pipelineUtilities.ts` — `summarizeActions()`, `actionContext()` helpers
- `evolution/src/lib/types.ts` — `ActionSummary` type, `ActionCounts` type, update `EvolutionRunSummary`

**Dashboard UI (Phase 5):**
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Display `_actions` as chips in AgentDetailPanel
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Action type badges in overview
- `src/app/admin/evolution/experiments/[experimentId]/` — Action distribution section on Metrics tab
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — Action summary section on Overview tab
- `src/app/admin/evolution/strategies/[strategyId]/` — Action profile section on Metrics tab

**Server actions (Phase 5):**
- `evolution/src/services/experimentActions.ts` — Extend `getRunMetricsAction()` for action aggregation
- `evolution/src/services/promptRegistryActions.ts` — Add prompt-level action summary
- `evolution/src/services/strategyRegistryActions.ts` — Extend strategy detail for action profile
- `evolution/src/services/evolutionVisualizationActions.ts` — Extend invocation detail with `_actions`

## Phased Execution Plan

### Phase 1: Action types, reducer, ReadonlyPipelineState (no behavior change)
Build the new infrastructure alongside existing code. Nothing uses it yet.

**Files created:**
- `evolution/src/lib/core/actions.ts` (NEW) — `PipelineAction` union type, all action types
- `evolution/src/lib/core/reducer.ts` (NEW) — `applyAction()`, `applyActions()`, immutable `with*()` methods

**Files modified:**
- `evolution/src/lib/types.ts` — Add `ReadonlyPipelineState` interface, add `actions: PipelineAction[]` to `AgentResult`
- `evolution/src/lib/core/state.ts` — Add `with*()` methods to `PipelineStateImpl` that return new instances (alongside existing mutating methods for now)

**Tests:**
- `evolution/src/lib/core/actions.test.ts` (NEW) — Action type construction
- `evolution/src/lib/core/reducer.test.ts` (NEW) — Reducer produces correct state for each action type, roundtrip properties

**Exit criteria:** All existing tests pass unchanged. New reducer tests pass. No behavior change.

### Phase 2: Agent checkpoint hooks
Add optional `getCheckpointData()` / `restoreFromCheckpoint()` to AgentBase. This enables Phase 4.

**Files modified:**
- `evolution/src/lib/agents/base.ts` — Add optional hook methods
- `evolution/src/lib/types.ts` — Add `agentCheckpoints?: Record<string, unknown>` to `SerializedCheckpoint`
- `evolution/src/lib/core/state.ts` — Update `serializeState()` to accept agent checkpoint data
- `evolution/src/lib/core/pipeline.ts` — Collect checkpoint data from agents after execute
- `evolution/src/lib/index.ts` — In `prepareResumedPipelineRun()`, call restore hooks

**Tests:**
- `evolution/src/lib/core/state.test.ts` — Serialize/deserialize roundtrip with agentCheckpoints
- `evolution/src/lib/core/pipeline.test.ts` — Agent hooks called during execution

**Exit criteria:** All tests pass. Hooks are wired but no agent implements them yet.

### Phase 3: Migrate all agents to return actions
The core change. Each agent's execute() switches from mutating state to returning actions. The pipeline dispatch loop applies actions via the reducer.

**Approach:** Change `AgentBase.execute()` to receive `ReadonlyPipelineState` (via `ExecutionContext`) and return `AgentResult` with `actions[]`. Update pipeline dispatch to call `applyActions()` after each agent. Remove old mutating methods from `PipelineStateImpl` once all agents are migrated.

**Files modified (agents — 12 files):**
- `evolution/src/lib/agents/generationAgent.ts` — Return `ADD_TO_POOL` instead of `state.addToPool()`
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — Same
- `evolution/src/lib/agents/calibrationRanker.ts` — Return `RECORD_MATCHES` instead of mutating ratings/matchHistory/matchCounts
- `evolution/src/lib/agents/tournament.ts` — Same
- `evolution/src/lib/agents/reflectionAgent.ts` — Return `APPEND_CRITIQUES` instead of pushing to allCritiques/dimensionScores
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — Return `ADD_TO_POOL`
- `evolution/src/lib/agents/treeSearchAgent.ts` — Return `ADD_TO_POOL`; keep treeSearchResults/States as private fields
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — Return `ADD_TO_POOL`; keep sectionState as private field
- `evolution/src/lib/agents/debateAgent.ts` — Return `ADD_TO_POOL`; keep debateTranscripts as private field
- `evolution/src/lib/agents/evolvePool.ts` — Return `ADD_TO_POOL`
- `evolution/src/lib/agents/proximityAgent.ts` — Return `SET_DIVERSITY_SCORE`; keep similarityMatrix as private field
- `evolution/src/lib/agents/metaReviewAgent.ts` — Return `SET_META_FEEDBACK`

**Files modified (pipeline — 4 files):**
- `evolution/src/lib/core/pipeline.ts` — Replace direct `state.startNewIteration()` with `START_NEW_ITERATION` action; apply agent actions via reducer; update flow critique to return actions; replace `captureBeforeState()`/`computeDiffMetrics()` with `computeDiffMetricsFromActions()`
- `evolution/src/lib/core/pipelineUtilities.ts` — Add `computeDiffMetricsFromActions()`, deprecate `computeDiffMetrics()` and `captureBeforeState()`
- `evolution/src/lib/core/state.ts` — Remove mutating `addToPool()`, `startNewIteration()`; keep `getTopByRating()`, `getVariationById()` as read-only helpers; remove `invalidateCache()` (immutable state → no cache invalidation needed, rebuild sorted cache in `with*()` methods)
- `evolution/src/lib/types.ts` — Update `ExecutionContext` to use `ReadonlyPipelineState`

**Files modified (supporting — 3 files):**
- `evolution/src/lib/index.ts` — Update `preparePipelineRun()` / `prepareResumedPipelineRun()`
- `evolution/src/testing/evolution-test-helpers.ts` — Update test factories for new action-returning pattern
- `evolution/src/lib/core/pool.ts` — If `getCalibrationOpponents()`/`getEvolutionParents()` read state, ensure they accept ReadonlyPipelineState

**Files modified (action logging — 5 files):**
- `evolution/src/lib/core/pipeline.ts` — After applying actions, log each action via EvolutionLogger and store `_actions` summary in execution_detail
- `evolution/src/lib/core/pipelineUtilities.ts` — Add `summarizeActions()` and `actionContext()` helpers
- `evolution/src/lib/types.ts` — Add `ActionSummary` type, update `EvolutionRunSummary` with `actionCounts`
- `evolution/src/lib/core/pipeline.ts` (`buildRunSummary`) — Aggregate `actionCounts` across all iterations
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Display `_actions` as chips in AgentDetailPanel

**Tests (all 14 agent test files + 4 core test files):**
- Each agent test: verify returned actions instead of asserting on mutated state
- `evolution/src/lib/core/pipeline.test.ts` — Verify action application flow + action logging
- `evolution/src/lib/core/pipelineFlow.test.ts` — Verify full pipeline with action dispatch
- `evolution/src/lib/core/pipelineUtilities.test.ts` — Verify `computeDiffMetricsFromActions()` + `summarizeActions()`
- `evolution/src/lib/core/state.test.ts` — Verify `with*()` immutable methods

**Exit criteria:** All agents return actions. Pipeline applies via reducer. Actions logged to evolution_run_logs and stored in execution_detail._actions. diffMetrics computed from actions. Timeline shows action chips. All tests pass.

### Phase 4: Move agent-local fields + default nullables
Now that agents own private state (via checkpoint hooks from Phase 2) and return actions (Phase 3), remove agent-local fields from PipelineState and default nullable fields.

**Fields removed from PipelineState:**
- `similarityMatrix` → ProximityAgent private field (checkpoint hook)
- `treeSearchResults`, `treeSearchStates` → TreeSearchAgent private fields (checkpoint hook)
- `sectionState` → SectionDecompositionAgent private field (no checkpoint needed — UI reads execution_detail)
- `debateTranscripts` → DebateAgent private field (checkpoint hook)

**Fields defaulted:**
- `allCritiques: Critique[]` — default `[]` instead of `null` (~48 null-check removals)
- `diversityScore: number` — default `0` instead of `null` (~17 null-check removals)

**Files modified:**
- `evolution/src/lib/types.ts` — Remove 5 fields from `PipelineState`; change `allCritiques` and `diversityScore` to non-nullable; keep fields on `SerializedPipelineState` for backward compat
- `evolution/src/lib/core/state.ts` — Remove from constructor/with methods; update deserialize with `?? []` / `?? 0` coalescing; backward compat: read old fields and pass to agent restore hooks
- `evolution/src/lib/agents/proximityAgent.ts` — Implement `getCheckpointData()` / `restoreFromCheckpoint()` for similarityMatrix
- `evolution/src/lib/agents/treeSearchAgent.ts` — Same for treeSearchResults/States
- `evolution/src/lib/agents/debateAgent.ts` — Same for debateTranscripts
- ~14 agent/core files — Remove `allCritiques` null checks
- ~8 agent/core files — Remove `diversityScore` null checks
- `evolution/src/lib/core/validation.ts` — Remove null-presence checks for removed/defaulted fields
- `evolution/src/services/evolutionVisualizationActions.ts` — Read treeSearchResults from `agentCheckpoints?.treeSearch` with fallback to `snapshot.treeSearchResults`

**Tests:**
- 5 agent test files for moved fields
- ~14 test files for allCritiques null removal
- ~5 test files for diversityScore null removal
- `evolution/src/lib/core/state.test.ts` — Backward compat: old snapshots with null/missing fields deserialize

**Exit criteria:** PipelineState has 13 runtime fields (down from 18). ~65 null-check lines removed. Old checkpoints deserialize. UI renders correctly.

### Phase 5: Action dashboard visibility across all entities
Add action data to experiment, prompt, strategy, and invocation detail pages.

**Files modified (server actions — 4 files):**
- `evolution/src/services/experimentActions.ts` — Extend `getRunMetricsAction()` to aggregate `actionCounts` from `run_summary` JSONB across experiment runs
- `evolution/src/services/promptRegistryActions.ts` — Add `getPromptActionSummaryAction()` aggregating actionCounts across runs for a prompt
- `evolution/src/services/strategyRegistryActions.ts` — Extend `getStrategyDetailAction()` to include action profile from related runs
- `evolution/src/services/evolutionVisualizationActions.ts` — Extend invocation detail to surface `_actions` from execution_detail

**Files modified (dashboard UI — 5 files):**
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Display `_actions` as chips in AgentDetailPanel
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Action type badges in overview section
- `src/app/admin/evolution/experiments/[experimentId]/` — "Action Distribution" section on Metrics tab
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — "Action Summary" section on Overview tab
- `src/app/admin/evolution/strategies/[strategyId]/` — "Action Profile" section on Metrics tab

**Tests:**
- `evolution/src/services/experimentActions.test.ts` — Test action aggregation query
- `evolution/src/services/strategyRegistryActions.test.ts` — Test action profile query
- Component tests for new UI sections (action chips, distribution charts)

**Exit criteria:** Action data visible on all entity detail pages. Experiment shows action distribution. Strategy shows action profile. Invocation shows action badges.

### Phase 6: Cleanup + documentation
Fix comments, remove dead code, update docs.

**Files modified:**
- `evolution/src/lib/types.ts` — Replace "Phase N" comments with `// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`, `// --- Arena ---`
- `evolution/src/lib/core/state.ts` — Remove deprecated mutating methods if any remain; add `?? null` fallbacks for dimensionScores, metaFeedback
- `evolution/src/lib/core/pipelineUtilities.ts` — Remove old `computeDiffMetrics()` and `captureBeforeState()` if fully replaced
- `evolution/docs/evolution/architecture.md` — Update: immutable state + reducer, action types, agent checkpoint hooks, diffMetrics from actions
- `evolution/docs/evolution/curriculum.md` — Update Module 4 (pipeline state)
- `evolution/docs/evolution/data_model.md` — Note agentCheckpoints in SerializedCheckpoint

**Tests:** No test changes expected.

**Exit criteria:** All tests pass. Docs updated. Clean build. No dead code.

## Testing

### Unit Tests Modified
| Phase | Files | Nature of Change |
|---|---|---|
| 1 | actions.test.ts (NEW), reducer.test.ts (NEW) | New action + reducer tests |
| 2 | state.test.ts, pipeline.test.ts | Checkpoint hook roundtrip |
| 3 | All 14 agent tests, pipeline.test.ts, pipelineFlow.test.ts, pipelineUtilities.test.ts, state.test.ts | Assert on returned actions instead of mutated state; action logging |
| 4 | ~20 files for null-check removal + 5 for field movement | Remove null guards, update state creation |
| 5 | experimentActions.test.ts, strategyRegistryActions.test.ts, component tests | Action aggregation queries, UI sections |
| 6 | None | Cosmetic |

### Integration/E2E Tests
No changes expected — evolution pipeline tested via unit tests.

### Manual Verification
- After Phase 3: Run a short evolution pipeline locally (`--single` mode, 3 iterations) to verify full action dispatch flow
- After Phase 4: Inspect an existing completed run's Timeline and Lineage views to confirm backward compat

## Documentation Updates
- `evolution/docs/evolution/architecture.md` — Immutable state + reducer pattern, action types, agent contracts, checkpoint hooks
- `evolution/docs/evolution/curriculum.md` — Module 4 rewrite for new architecture
- `evolution/docs/evolution/data_model.md` — agentCheckpoints in SerializedCheckpoint
- `docs/docs_overall/testing_overview.md` — No changes needed
- `evolution/docs/evolution/entity_diagram.md` — No changes needed
