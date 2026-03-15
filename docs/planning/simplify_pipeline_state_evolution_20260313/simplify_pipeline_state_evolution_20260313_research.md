# Simplify Pipeline State Evolution Research

## Problem Statement
The PipelineState interface in the evolution pipeline has grown to 18 mutable fields, many of which are only read/written by a single agent or serve as temporary communication slots. This project simplifies PipelineState by moving single-agent fields to agent-local state, eliminating duplication, and defaulting nullable fields. The goal is to reduce the shared mutable surface from 18 fields to ~12 core fields, making the pipeline easier to understand, test, and maintain.

## Requirements (from GH Issue #698)
1. **Move single-agent fields out of PipelineState** — Fields only used by one agent should live on the agent instance, not shared state:
   - `similarityMatrix` → ProximityAgent instance (only writer and reader)
   - `treeSearchResults` → TreeSearchAgent instance (only writer; serialization + UI reads from checkpoint)
   - `treeSearchStates` → TreeSearchAgent instance (only writer; serialization + UI reads from checkpoint)
   - `sectionState` → SectionDecompositionAgent instance (only writer and reader)
   - `debateTranscripts` → DebateAgent instance (only writer; timeline counts length only)
   - ~~`outlineVariants`~~ — NOT a PipelineState field (just a type `OutlineVariant`)
   - ~~`flowCritiqueResults`~~ — Does NOT exist in codebase
2. **Evaluate dimensionScores removal** — `dimensionScores` is a cache of `allCritiques[].dimensionScores` but has 109 test references across 21 files and is read directly by VariantDetailPanel and flow critique merging. Consider keeping it for now.
3. **Default nullable fields** — Replace null defaults with empty values where meaningful:
   - `allCritiques: Critique[]` (default `[]` instead of `null`) — 48 null-check occurrences
   - `diversityScore: number` (default `0` instead of `null`) — 17 null-check occurrences
   - Keep `metaFeedback: MetaFeedback | null` — meaningful "not yet computed" semantics
4. **Fix misleading phase comments** — Replace numbered "Phase N" comments with grouping comments (`// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`)
5. **Add agent checkpoint hooks** — `agent.getCheckpointData()` / `agent.restoreFromCheckpoint()` on AgentBase for agent-local state persistence across resume boundaries
6. **Update all agent consumers** — Every agent that reads from or writes to PipelineState must be updated
7. **Preserve backward compatibility** — Checkpoint deserialization must handle both old and new formats; keep moved fields in SerializedPipelineState
8. **Update tests** — All unit tests touching PipelineState, PipelineStateImpl, or agent execute() methods
9. **Update documentation** — Evolution architecture docs and curriculum

## High Level Summary

### Complete PipelineState Field Inventory (18 fields)

| Field | Type | Default | Nullable | Phase Group |
|---|---|---|---|---|
| `iteration` | number | 0 | No | Pool |
| `originalText` | string | '' | No | Pool |
| `pool` | TextVariation[] | [] | No | Pool |
| `poolIds` | Set\<string\> | new Set() | No | Pool (derived, not serialized) |
| `newEntrantsThisIteration` | string[] | [] | No | Pool |
| `ratings` | Map\<string, Rating\> | new Map() | No | Ranking |
| `matchCounts` | Map\<string, number\> | new Map() | No | Ranking |
| `matchHistory` | Match[] | [] | No | Ranking |
| `dimensionScores` | Record\<string, Record\<string, number\>\> \| null | null | **Yes** | Review |
| `allCritiques` | Critique[] \| null | null | **Yes** | Review |
| `similarityMatrix` | Record\<string, Record\<string, number\>\> \| null | null | **Yes** | Proximity |
| `diversityScore` | number \| null | null | **Yes** | Proximity |
| `metaFeedback` | MetaFeedback \| null | null | **Yes** | Meta-review |
| `debateTranscripts` | DebateTranscript[] | [] | No | Debate |
| `treeSearchResults` | TreeSearchResult[] \| null | null | **Yes** | TreeSearch |
| `treeSearchStates` | TreeState[] \| null | null | **Yes** | TreeSearch |
| `sectionState` | SectionEvolutionState \| null | null | **Yes** | SectionDecomposition |
| `lastSyncedMatchIndex` | number | 0 | No | Arena |

### Agent Read/Write Matrix

| Agent | Fields READ | Fields WRITTEN | Single-Consumer Fields |
|---|---|---|---|
| generationAgent | iteration, originalText, metaFeedback | pool (addToPool) | — |
| calibrationRanker | newEntrantsThisIteration, pool, poolIds, ratings, matchCounts | matchHistory, ratings, matchCounts | — |
| tournament | pool, ratings, matchCounts, matchHistory | matchHistory, ratings, matchCounts | — |
| evolvePool | iteration, originalText, pool, ratings, diversityScore, metaFeedback | pool (addToPool) | — |
| reflectionAgent | pool, ratings | allCritiques, dimensionScores | — |
| iterativeEditingAgent | allCritiques, matchHistory, ratings, iteration | pool (addToPool) | — |
| treeSearchAgent | allCritiques, ratings, iteration, pool, poolIds | pool (addToPool), **treeSearchResults**, **treeSearchStates** | treeSearchResults, treeSearchStates |
| sectionDecompositionAgent | allCritiques, ratings, iteration, pool | pool (addToPool) | — |
| debateAgent | pool, ratings, iteration, metaFeedback, allCritiques | pool (addToPool), **debateTranscripts** | debateTranscripts |
| proximityAgent | newEntrantsThisIteration, pool, diversityScore | **similarityMatrix**, diversityScore | similarityMatrix |
| metaReviewAgent | pool, ratings, diversityScore, iteration | **metaFeedback** | metaFeedback (write-only) |
| outlineGenerationAgent | iteration, originalText | pool (addToPool) | — |

### Fields Safe to Move to Agent-Local State

| Field | Agent | UI Impact | Migration Path |
|---|---|---|---|
| **similarityMatrix** | ProximityAgent | No UI references | Remove from PipelineState + SerializedPipelineState |
| **treeSearchResults** | TreeSearchAgent | Tree visualization reads from checkpoint snapshot | Keep in SerializedPipelineState, serialize via agent hook |
| **treeSearchStates** | TreeSearchAgent | Lineage tree annotations read from checkpoint snapshot | Keep in SerializedPipelineState, serialize via agent hook |
| **sectionState** | SectionDecompositionAgent | No direct UI reads (execution_detail used) | Remove from PipelineState + SerializedPipelineState |
| **debateTranscripts** | DebateAgent | Timeline counts length only | Keep in SerializedPipelineState, serialize via agent hook |

### Fields That MUST Stay on Shared State

| Field | Reason |
|---|---|
| pool, poolIds, newEntrantsThisIteration | Written/read by 8+ agents |
| ratings, matchCounts, matchHistory | Written by calibration/tournament, read by many |
| allCritiques | Written by reflection, read by iterativeEditing, sectionDecomposition, debate, treeSearch |
| diversityScore | Written by proximity, read by evolvePool, metaReview, supervisor |
| metaFeedback | Written by metaReview, read by generation, evolve, debate |
| dimensionScores | Written by reflection + flow critique, read by UI (VariantDetailPanel) |
| lastSyncedMatchIndex | Arena sync watermark |
| iteration, originalText | Core state |

### Key Finding: dimensionScores is More Complex Than Expected

**dimensionScores serves as a merged cache** with dual write paths:
1. **ReflectionAgent** writes quality scores: `state.dimensionScores[variantId] = critique.dimensionScores`
2. **FlowCritique** writes flow scores with prefix: `state.dimensionScores[variantId]['flow:dim'] = score`

Most "reads" of dimensionScores are actually reads from `Critique.dimensionScores` objects (not from state). Only 2 real consumers read `state.dimensionScores`:
- VariantDetailPanel via `snapshot.dimensionScores[variantId]`
- `validation.ts` contract check

**Recommendation: Keep dimensionScores for now** — 109 test references across 21 files, flow: prefix merging logic, and UI dependency make it high-risk to remove in this project. Can be a follow-up.

### Null-Check Burden by Field

| Field | Total Null-Checks | Guard | Coalesce Read | Coalesce Write | Non-null Assert |
|---|---|---|---|---|---|
| allCritiques | 48 | 13 | 8 | 3 | 5 |
| metaFeedback | 18 | 0 | 0 | 1 | 10+ |
| diversityScore | 17 | 2 | 5 | 2 | 0 |
| similarityMatrix | 14 | 1 | 0 | 3 | 5 |
| treeSearchResults | 7 | 0 | 2 | 1 | 0 |
| treeSearchStates | 7 | 0 | 1 | 1 | 0 |
| sectionState | 4 | 0 | 0 | 0 | 0 |

### Agent Lifecycle: Critical for Checkpoint Hooks

1. **Agents are singletons per run** — `createDefaultAgents()` creates one instance per agent, reused across all iterations
2. **On resume, agents are recreated fresh** — `createDefaultAgents()` is called again; agent-local state is LOST unless serialized
3. **Agent checkpoint hook integration points:**
   - **Collect**: In `runAgent()` (pipeline.ts:623), after `agent.execute()`, before `persistCheckpoint()`
   - **Restore**: In `prepareResumedPipelineRun()` (index.ts:275), after `createDefaultAgents()`
4. **PipelineAgents type** supports iteration via `Object.entries(agents)`

### Serialization Contract

**UI reads checkpoint state_snapshot in two ways:**
- **Detailed execution views** (DebateDetail, TreeSearchDetail, etc.) → read from `execution_detail` JSONB in `evolution_agent_invocations` → **NOT affected** by PipelineState changes
- **Timeline metrics and lineage** → read from `state_snapshot` in `evolution_checkpoints` → **WOULD break** if fields removed from serialization

**"Serialize-only" approach is viable**: Fields can be removed from runtime PipelineState but kept in SerializedPipelineState for UI/timeline compatibility. Agent hooks write their checkpoint data into the serialized output.

### Backward Compatibility

- **Existing backward compat**: Legacy `eloRatings` → `ratings` conversion exists
- **No field presence checks**: Code uses optional chaining (`?.`) and null-coalesce (`??`), not `'field' in snapshot`
- **deserializeState() gap**: `dimensionScores`, `allCritiques`, `similarityMatrix`, `diversityScore`, `metaFeedback` lack `?? null` fallbacks (unlike treeSearch/debate fields)
- **Safest migration**: Keep fields in SerializedPipelineState, remove from runtime PipelineState interface

### Test Update Scope

| Field | Test Occurrences | Files Affected | Impact |
|---|---|---|---|
| dimensionScores | 109 | 21 files | HIGH — defer removal |
| allCritiques | 80 | 14 files | HIGH — but changing null→[] is straightforward |
| debateTranscripts | 34 | 5 files | MEDIUM |
| treeSearchResults | 30 | 4 files | MEDIUM |
| similarityMatrix | 20 | 5 files | LOW |

### Revised Target PipelineState

Based on research findings, the realistic simplified interface:

```typescript
interface PipelineState {
  // --- Core (immutable after init) ---
  originalText: string;

  // --- Pool (mutable) ---
  iteration: number;
  pool: TextVariation[];
  poolIds: Set<string>;                    // derived, not serialized — keep for O(1) lookup
  newEntrantsThisIteration: string[];

  // --- Ranking (mutable) ---
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  matchHistory: Match[];

  // --- Analysis (mutable, shared across agents) ---
  dimensionScores: Record<string, Record<string, number>> | null;  // keep for now
  allCritiques: Critique[];                // changed: not nullable, default []
  diversityScore: number;                  // changed: not nullable, default 0
  metaFeedback: MetaFeedback | null;       // keep nullable — meaningful semantics

  // --- Arena ---
  lastSyncedMatchIndex: number;
}
// Removed from runtime (moved to agent-local + serialize-only):
// similarityMatrix, treeSearchResults, treeSearchStates, sectionState, debateTranscripts
```

**Net reduction: 18 → 14 runtime fields** (5 moved to agent-local, 1 kept that was initially proposed for removal)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/entity_diagram.md

## Code Files Read
- `evolution/src/lib/types.ts` — PipelineState, SerializedPipelineState, SerializedCheckpoint, Critique, Match, MetaFeedback, all agent execution detail types
- `evolution/src/lib/core/state.ts` — PipelineStateImpl, serializeState(), deserializeState(), MAX_MATCH_HISTORY, MAX_CRITIQUE_ITERATIONS
- `evolution/src/lib/core/pipeline.ts` — executeFullPipeline(), runAgent(), createAgentCtx(), runFlowCritiques(), checkpoint logic
- `evolution/src/lib/core/persistence.ts` — persistCheckpoint(), loadCheckpointForResume(), checkpointAndMarkContinuationPending()
- `evolution/src/lib/core/validation.ts` — validateStateIntegrity(), validateStateContracts()
- `evolution/src/lib/core/supervisor.ts` — PoolSupervisor, getActiveAgents(), SupervisorResumeState
- `evolution/src/lib/core/pipelineUtilities.ts` — computeDiffMetrics(), DiffMetrics
- `evolution/src/lib/agents/base.ts` — AgentBase abstract class
- `evolution/src/lib/agents/generationAgent.ts` — state field access
- `evolution/src/lib/agents/calibrationRanker.ts` — state field access
- `evolution/src/lib/agents/tournament.ts` — state field access
- `evolution/src/lib/agents/evolvePool.ts` — state field access
- `evolution/src/lib/agents/reflectionAgent.ts` — writes dimensionScores + allCritiques
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — reads allCritiques
- `evolution/src/lib/agents/treeSearchAgent.ts` — writes treeSearchResults/States
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — writes sectionState
- `evolution/src/lib/agents/debateAgent.ts` — writes debateTranscripts
- `evolution/src/lib/agents/proximityAgent.ts` — writes similarityMatrix, diversityScore
- `evolution/src/lib/agents/metaReviewAgent.ts` — writes metaFeedback
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — state field access
- `evolution/src/lib/flowRubric.ts` — flow critique types, flow: prefix system
- `evolution/src/lib/index.ts` — createDefaultAgents(), preparePipelineRun(), prepareResumedPipelineRun()
- `evolution/src/services/evolutionRunnerCore.ts` — agent creation lifecycle
- `evolution/src/services/evolutionVisualizationActions.ts` — state_snapshot reads for UI
- `evolution/src/services/variantDetailActions.ts` — variant match history from snapshot
- `evolution/src/components/evolution/VariantDetailPanel.tsx` — dimensionScores UI display
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — diff metrics display
- `evolution/src/testing/evolution-test-helpers.ts` — test factories

## Open Questions
1. Should we add a `schemaVersion` field to SerializedCheckpoint for future migrations?
2. Should agent checkpoint data be a new field on SerializedCheckpoint (parallel to supervisorState) or a new DB table?
3. For Maps vs Records consistency — should we standardize on Map everywhere or accept the serialize/deserialize boilerplate?
