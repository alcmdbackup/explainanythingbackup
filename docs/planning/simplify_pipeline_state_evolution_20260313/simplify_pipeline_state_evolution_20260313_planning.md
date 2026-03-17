# Simplify Pipeline State Evolution Plan

## Background
The PipelineState is a shared mutable object that every agent reads and writes in-place during pipeline execution. This makes it hard to understand which agents communicate through which fields, impossible to track what changed and when without external instrumentation (diffMetrics was bolted on for this), and blocks future parallel agent execution. This project replaces the mutable shared state with an immutable state + reducer (action dispatch) pattern, moves agent-local fields out of shared state, and defaults unnecessarily nullable fields.

## Requirements (from GH Issue #698)
1. **Immutable state + reducer** — Agents receive read-only state and return actions; pipeline applies actions via a reducer to produce new state
2. **Move 5 single-agent fields to agent-local state** — `similarityMatrix`, `treeSearchResults`, `treeSearchStates`, `sectionState`, `debateTranscripts`
3. **Default nullable fields** — `allCritiques: []`, `diversityScore: 0` (keep `metaFeedback | null`)
4. **Fix phase comments** — Replace misleading "Phase N" with grouping comments
5. **Derive diffMetrics from actions** — Replace before/after snapshots with action-based computation
6. **Action logging** — Log actions to evolution_run_logs, store in execution_detail, aggregate in run_summary, display on all entity dashboards
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
Agents return `PipelineAction[]` from execute(). Pipeline applies actions via a pure reducer. State is a new immutable snapshot after each agent. Agent-local fields move to agent instances as private class fields — no checkpoint hooks needed, agents start fresh on resume.

**Pros:** Explicit contracts, free audit trail, parallelism-ready, diffMetrics computed from actions, simple agent-local state (just class fields)
**Cons:** Every agent rewritten, new action type system, ~50+ files changed

### Option B: Agent checkpoint hooks only (original plan)
Move agent-local fields to agent instances with checkpoint hooks, keep mutable shared state.

**Pros:** Smaller scope (~30 files)
**Cons:** Doesn't fix the core problem — shared mutable state persists, no path to parallelism, extra serialization complexity

### Option C: Event sourcing
Store all actions in a log, reconstruct state by replaying.

**Pros:** Full audit trail, time travel
**Cons:** Over-engineered for this use case, complex replay logic, significant perf overhead

**Decision: Option A** — addresses the root architectural issue while naturally solving the original goals (field movement, audit trail, simplification). No checkpoint hooks needed — agent-local state (similarityMatrix, treeSearchResults, etc.) is ephemeral and can be recomputed from scratch on resume at zero LLM cost.

## Action Type Design

All mutations from the research phase, categorized into action types:

```typescript
// --- Pool Actions ---
type AddToPool = {
  type: 'ADD_TO_POOL';
  variants: TextVariation[];
  /** Optional pre-set ratings for variants (e.g. arena entries with existing ratings).
   *  If omitted, reducer auto-initializes default rating (mu=25, sigma=25/3) and matchCount=0
   *  for each new variant — replicating the side-effects of the old addToPool() method. */
  presetRatings?: Record<string, { mu: number; sigma: number }>;
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
| **pairwiseRanker** | `RECORD_MATCHES` (used standalone in executeMinimalPipeline) |
| reflectionAgent | `APPEND_CRITIQUES` |
| iterativeEditingAgent | `ADD_TO_POOL` (0-1 variant) |
| treeSearchAgent | `ADD_TO_POOL` (0-1 variant) |
| sectionDecompositionAgent | `ADD_TO_POOL` (0-1 variant) |
| debateAgent | `ADD_TO_POOL` (0-1 variant) |
| evolvePool | `ADD_TO_POOL` (1-4 variants) |
| proximityAgent | `SET_DIVERSITY_SCORE` |
| metaReviewAgent | `SET_META_FEEDBACK` |
| pipeline (flow critique) | `APPEND_CRITIQUES` + `MERGE_FLOW_SCORES` (atomic pair — both must be applied together) |
| pipeline (iteration) | `START_NEW_ITERATION` |
| pipeline (pre-loop) | `ADD_TO_POOL` for insertBaselineVariant() + loadArenaEntries() — applied before iteration loop starts |

### Pre-Loop Mutations

Two state mutations happen **before** the iteration loop begins and are NOT dispatched by agents:

1. **`insertBaselineVariant()`** (pipeline.ts) — adds the original text as a baseline variant via `state.addToPool()`. Converted to dispatch `ADD_TO_POOL` action before entering the loop.
2. **`loadArenaEntries()`** (arenaIntegration.ts) — loads arena entries into pool via direct mutation (`pool.push`, `poolIds.add`, `ratings.set`, `matchCounts.set`, `rebuildIdMap`). Converted to dispatch `ADD_TO_POOL` action with pre-rated variants. The `withAddedVariants()` reducer method must accept optional pre-set ratings (not just create defaults).

Both are converted to action dispatches applied to the initial mutable state before it's frozen as ReadonlyPipelineState for the agent loop.

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
}
```

**Storage lifecycle:**
- **During execution**: In-memory on agent instance (regular class field)
- **Between iterations**: Same instance, still in memory
- **On resume**: Agent recreated fresh, private state starts empty — recomputed as needed

**No checkpoint hooks needed.** The 5 agent-local fields are all either recomputable at zero LLM cost or only used for debugging (which `execution_detail` already captures per-invocation):

| Agent | Private State | What happens on resume |
|---|---|---|
| ProximityAgent | `similarityMatrix` | Recomputes from pool — CPU-only trigram math |
| TreeSearchAgent | `treeSearchResults`, `treeSearchStates` | Starts fresh trees — old results already in pool as variants |
| SectionDecompositionAgent | `sectionState` | Starts fresh — may redo some section edits |
| DebateAgent | `debateTranscripts` | Starts fresh — old transcripts in execution_detail for debugging |

**Timeline debate count**: Read from `evolution_agent_invocations` WHERE `agent_name = 'debate'` and count rows, instead of transcript array length.

### ReadonlyPipelineState

Agents receive an immutable view. The interface exposes only read methods:

```typescript
interface ReadonlyPipelineState {
  readonly originalText: string;
  readonly iteration: number;
  readonly pool: readonly TextVariation[];
  readonly poolIds: ReadonlySet<string>;        // Needed by TreeSearchAgent, CalibrationRanker, PoolManager
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
  hasVariant(id: string): boolean;              // Convenience wrapper over poolIds.has()
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
      return state.withAddedVariants(action.variants, action.presetRatings);
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

  // debatesAdded: count from evolution_agent_invocations instead of state field
  return {
    variantsAdded,
    newVariantIds,
    matchesPlayed,
    eloChanges,
    critiquesAdded,
    debatesAdded: 0,  // Deprecated — timeline reads from invocation count
    diversityScoreAfter,
    metaFeedbackPopulated,
  };
}
```

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

**Core pipeline (Phase 2):**
- `evolution/src/lib/core/pipeline.ts` — Log actions after applying via reducer; add actionCounts to buildRunSummary
- `evolution/src/lib/core/pipelineUtilities.ts` — `summarizeActions()`, `actionContext()` helpers
- `evolution/src/lib/types.ts` — `ActionSummary` type, `ActionCounts` type, update `EvolutionRunSummary`

**Dashboard UI (Phase 4):**
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Display `_actions` as chips in AgentDetailPanel
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Action type badges in overview
- `src/app/admin/evolution/experiments/[experimentId]/` — Action distribution section on Metrics tab
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — Action summary section on Overview tab
- `src/app/admin/evolution/strategies/[strategyId]/` — Action profile section on Metrics tab

**Server actions (Phase 4):**
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

### Phase 2: Migrate all agents to return actions
The core change. Each agent's execute() switches from mutating state to returning actions. The pipeline dispatch loop applies actions via the reducer.

**Approach:** Change `AgentBase.execute()` to receive `ReadonlyPipelineState` (via `ExecutionContext`) and return `AgentResult` with `actions[]`. Update pipeline dispatch to call `applyActions()` after each agent. Remove old mutating methods from `PipelineStateImpl` once all agents are migrated.

**Files modified (agents — 13 files):**
- `evolution/src/lib/agents/generationAgent.ts` — Return `ADD_TO_POOL` instead of `state.addToPool()`
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — Same
- `evolution/src/lib/agents/calibrationRanker.ts` — Return `RECORD_MATCHES` instead of mutating ratings/matchHistory/matchCounts
- `evolution/src/lib/agents/tournament.ts` — Same
- `evolution/src/lib/agents/pairwiseRanker.ts` — Return `RECORD_MATCHES`; used standalone in executeMinimalPipeline
- `evolution/src/lib/agents/reflectionAgent.ts` — Return `APPEND_CRITIQUES` instead of pushing to allCritiques/dimensionScores
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — Return `ADD_TO_POOL`
- `evolution/src/lib/agents/treeSearchAgent.ts` — Return `ADD_TO_POOL`; keep treeSearchResults/States as private fields
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — Return `ADD_TO_POOL`; keep sectionState as private field
- `evolution/src/lib/agents/debateAgent.ts` — Return `ADD_TO_POOL`; keep debateTranscripts as private field
- `evolution/src/lib/agents/evolvePool.ts` — Return `ADD_TO_POOL`
- `evolution/src/lib/agents/proximityAgent.ts` — Return `SET_DIVERSITY_SCORE`; keep similarityMatrix as private field
- `evolution/src/lib/agents/metaReviewAgent.ts` — Return `SET_META_FEEDBACK`

**Files modified (base class — 1 file):**
- `evolution/src/lib/agents/base.ts` — Change `execute()` return type to include `actions: PipelineAction[]`; change `canExecute(state: PipelineState)` to `canExecute(state: ReadonlyPipelineState)`

**Files modified (pipeline — 5 files):**
- `evolution/src/lib/core/pipeline.ts` — Convert insertBaselineVariant() and flow critique (runFlowCritiques, lines 797-809) to dispatch actions instead of inline mutation; replace `state.startNewIteration()` with `START_NEW_ITERATION` action; apply agent actions via reducer; replace `captureBeforeState()`/`computeDiffMetrics()` with `computeDiffMetricsFromActions()`; log actions via EvolutionLogger; store `_actions` in execution_detail; aggregate `actionCounts` in buildRunSummary
- `evolution/src/lib/core/pipelineUtilities.ts` — Add `computeDiffMetricsFromActions()`, `summarizeActions()`, `actionContext()`; deprecate `computeDiffMetrics()` and `captureBeforeState()`
- `evolution/src/lib/core/state.ts` — Remove mutating `addToPool()`, `startNewIteration()`; add `hasVariant(id)` convenience method; keep `getTopByRating()`, `getVariationById()` as read-only helpers; remove `invalidateCache()` (immutable state → rebuild sorted cache in `with*()` methods). **Important:** `withAddedVariants()` must auto-initialize default ratings (mu=25, sigma=25/3) and matchCounts (0) for new variants — replicating the side-effects of the old `addToPool()` method.
- `evolution/src/lib/core/arenaIntegration.ts` — Convert `loadArenaEntries()` to return `ADD_TO_POOL` action with `presetRatings` instead of directly mutating pool/poolIds/ratings/matchCounts
- `evolution/src/lib/types.ts` — Update `ExecutionContext` to use `ReadonlyPipelineState`; add `ActionSummary`, `ActionCounts` types; update `EvolutionRunSummary`

**Files modified (supporting — 8 files):**
- `evolution/src/lib/index.ts` — Update `preparePipelineRun()` / `prepareResumedPipelineRun()`
- `evolution/src/testing/evolution-test-helpers.ts` — Update test factory: `makeState()` must produce `ReadonlyPipelineState`-compatible objects; `makeCtx()` must provide read-only state; add `applyActionsToState()` test helper for verifying agent actions
- `evolution/src/lib/core/pool.ts` — Change `PoolManager` to accept `ReadonlyPipelineState`; remove `addVariants()` mutating method (callers should return `ADD_TO_POOL` actions instead); `getCalibrationOpponents()` and `getEvolutionParents()` are read-only and just need the type change
- `evolution/src/lib/core/validation.ts` — Change `validateStateIntegrity()` and `validateStateContracts()` to accept `ReadonlyPipelineState`
- `evolution/src/lib/core/supervisor.ts` — Change `beginIteration()`, `shouldStop()`, `getPhaseConfig()` to accept `ReadonlyPipelineState`
- `evolution/src/lib/core/persistence.ts` — Change `serializeState()` to accept `ReadonlyPipelineState` (serialization is read-only)
- `evolution/src/lib/core/diversityTracker.ts` — Change `getRecommendations()` and internal helpers to accept `ReadonlyPipelineState`
- `evolution/src/lib/agents/reflectionAgent.ts` — Also update exported helpers (`getCritiqueForVariant`, `getWeakestDimension`, `getImprovementSuggestions`) to accept `ReadonlyPipelineState`; these are imported by 4 other agents

**Note:** `executeMinimalPipeline()` in pipeline.ts also needs the action-dispatch loop — same pattern as `executeFullPipeline()` but simpler (no phases, no supervisor). Must be updated in Phase 2.

**Tests (13 migrated agent test files + 14 core test files):**
- Each agent test: verify returned actions instead of asserting on mutated state
- Note: 14 agent test files exist total (includes formatValidator.test.ts) but formatValidator doesn't mutate state — only needs ReadonlyPipelineState type update in canExecute, no action migration
- `executeMinimalPipeline` tests are covered by `pipeline.test.ts` (both entry points tested there)
- `evolution/src/lib/core/pipeline.test.ts` — Verify action application flow + action logging
- `evolution/src/lib/core/pipelineFlow.test.ts` — Verify full pipeline with action dispatch
- `evolution/src/lib/core/pipelineUtilities.test.ts` — Verify `computeDiffMetricsFromActions()` + `summarizeActions()`
- `evolution/src/lib/core/state.test.ts` — Verify `with*()` immutable methods, `hasVariant()`, auto-init ratings
- `evolution/src/lib/core/supervisor.test.ts` — Update to use ReadonlyPipelineState
- `evolution/src/lib/core/persistence.test.ts` — Verify checkpoint roundtrip with new state shape
- `evolution/src/lib/core/persistence.continuation.test.ts` — Same
- `evolution/src/lib/core/validation.test.ts` — Update to ReadonlyPipelineState
- `evolution/src/lib/core/arenaIntegration.test.ts` — Update loadArenaEntries to return actions
- `evolution/src/lib/core/metricsWriter.test.ts` — Update state references
- `evolution/src/lib/core/pool.test.ts` — Remove addVariants mutation tests, update to ReadonlyPipelineState
- `evolution/src/lib/core/diversityTracker.test.ts` — Update state references
- Other core test files referencing PipelineState: `agentSelection.test.ts`, `arena.test.ts`

**Exit criteria:** All agents return actions. Pipeline applies via reducer. Actions logged to evolution_run_logs and stored in execution_detail._actions. diffMetrics computed from actions. All tests pass.

### Phase 3: Move agent-local fields + default nullables
Now that agents return actions instead of mutating state, remove agent-local fields from PipelineState and default nullable fields.

**Fields removed from PipelineState:**
- `similarityMatrix` → ProximityAgent private field (recomputed from pool on resume)
- `treeSearchResults`, `treeSearchStates` → TreeSearchAgent private fields (starts fresh on resume)
- `sectionState` → SectionDecompositionAgent private field (starts fresh on resume)
- `debateTranscripts` → DebateAgent private field (starts fresh on resume; old transcripts in execution_detail)

**Fields defaulted:**
- `allCritiques: Critique[]` — default `[]` instead of `null` (~48 null-check removals)
- `diversityScore: number` — default `0` instead of `null` (~17 null-check removals)

**Files modified:**
- `evolution/src/lib/types.ts` — Remove 5 fields from `PipelineState`; change `allCritiques` and `diversityScore` to non-nullable; keep fields on `SerializedPipelineState` for backward compat of old checkpoints
- `evolution/src/lib/core/state.ts` — Remove from constructor/with methods; update deserialize with `?? []` / `?? 0` coalescing; ignore old agent-local fields from snapshots
- ~14 agent/core files — Remove `allCritiques` null checks
- ~8 agent/core files — Remove `diversityScore` null checks
- `evolution/src/lib/core/validation.ts` — Remove null-presence checks for removed/defaulted fields
- `evolution/src/services/evolutionVisualizationActions.ts` — Timeline: read debate count from invocation row count instead of state field; lineage: read tree annotations from execution_detail instead of state snapshot

**Tests:**
- ~14 test files for allCritiques null removal
- ~5 test files for diversityScore null removal
- `evolution/src/lib/core/state.test.ts` — Backward compat: old snapshots with null/missing fields deserialize correctly

**Exit criteria:** PipelineState has 13 runtime fields (down from 18). ~65 null-check lines removed. Old checkpoints deserialize. UI renders correctly.

### Phase 4: Action dashboard visibility across all entities
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

### Phase 5: Cleanup + documentation ✅
Fix comments, remove dead code, update docs.

**Files modified:**
- `evolution/src/lib/types.ts` — Added `// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`, `// --- Arena ---` grouping comments on ReadonlyPipelineState
- `evolution/src/lib/core/state.ts` — Added matching grouping comments on PipelineStateImpl fields
- `evolution/src/lib/core/pipelineUtilities.ts` — Removed old `computeDiffMetrics()` (replaced by `computeDiffMetricsFromActions()`). Kept `captureBeforeState()` — still used by pipeline.ts for before/after Elo snapshots passed to `computeDiffMetricsFromActions()`.
- `evolution/src/lib/core/pipelineUtilities.test.ts` — Removed `computeDiffMetrics` tests and import
- `evolution/docs/evolution/architecture.md` — Added "Immutable State + Reducer Pattern" section with action types and diff metrics from actions
- `evolution/docs/evolution/curriculum.md` — Updated Module 1 (PipelineState → ReadonlyPipelineState) and Module 4 (immutable state + reducer pattern, added actions.ts and reducer.ts)
- `evolution/docs/evolution/data_model.md` — Noted `_actions` in execution_detail and actionCounts in run_summary

**Tests:** Removed `computeDiffMetrics` test block (function removed). All 67 suites / 1367 tests pass.

**Exit criteria:** All tests pass. Docs updated. Clean build (`tsc --noEmit` 0 errors). No dead code.

## Rollback Plan

This is a 50+ file architectural change. If issues are discovered after merge:

1. **Git revert**: The entire change is on a single branch. `git revert` of the merge commit restores the old mutable pattern instantly. No database migrations to roll back — all changes are in application code and JSONB schema (additive, not destructive).

2. **Checkpoint backward compat is bidirectional**: Old checkpoints work with new code (Phase 3 adds `?? []` / `?? 0` coalescing). New checkpoints work with old code because `SerializedPipelineState` keeps all fields — the old code ignores `_actions` and `actionCounts` in JSONB (passthrough schema).

3. **No in-flight run risk**: Deploy during a window with no running evolution pipelines. The minicomputer batch runner can be stopped via systemd (`systemctl stop evolution-runner.timer`). Verify no `running` or `continuation_pending` runs exist before deploying.

4. **Feature flag alternative**: If needed, add `EVOLUTION_USE_REDUCER=true` env var that toggles between old dispatch (mutable) and new dispatch (action-based) in `pipeline.ts`. Both code paths can coexist temporarily since `with*()` methods are added alongside existing mutating methods in Phase 1.

## Testing

### Unit Tests Modified
| Phase | Files | Nature of Change |
|---|---|---|
| 1 | actions.test.ts (NEW), reducer.test.ts (NEW) | New action + reducer tests |
| 2 | 14 agent tests + pairwiseRanker.test.ts, 14 core test files (pipeline, pipelineFlow, pipelineUtilities, state, supervisor, persistence, persistence.continuation, validation, arenaIntegration, metricsWriter, pool, diversityTracker, agentSelection, arena), evolution-test-helpers.ts | Assert on returned actions; update all PipelineState references to ReadonlyPipelineState; action logging |
| 3 | ~20 files for null-check removal + state.test.ts backward compat | Remove null guards, update state creation |
| 4 | experimentActions.test.ts, strategyRegistryActions.test.ts, component tests | Action aggregation queries, UI sections |
| 5 | None | Cosmetic |

### Additional test files outside core/agents
- `evolution/src/lib/treeOfThought/beamSearch.test.ts` — References PipelineState
- `evolution/src/services/evolutionVisualizationActions.test.ts` — References state snapshot
- `evolution/src/lib/agents/formatValidator.test.ts` — References PipelineState

### Reducer integration test
Add a property-based test in `reducer.test.ts`: apply actions → serialize → deserialize → verify state equality. This catches serialization roundtrip bugs.

### Integration/E2E Tests
No changes expected — evolution pipeline tested via unit tests. The evolution pipeline has no E2E tests.

### Manual Verification
- After Phase 2: Run a short evolution pipeline locally (`--single` mode, 3 iterations) to verify full action dispatch flow. Verify checkpoint resume by killing mid-run and resuming.
- After Phase 3: Inspect an existing completed run's Timeline and Lineage views to confirm backward compat. Verify old checkpoints deserialize correctly by resuming a pre-migration paused run.

## Documentation Updates
- `evolution/docs/evolution/architecture.md` — Immutable state + reducer pattern, action types, agent contracts
- `evolution/docs/evolution/curriculum.md` — Module 4 rewrite for new architecture
- `evolution/docs/evolution/data_model.md` — Action logging in run_summary and execution_detail
- `docs/docs_overall/testing_overview.md` — No changes needed
- `evolution/docs/evolution/entity_diagram.md` — No changes needed
