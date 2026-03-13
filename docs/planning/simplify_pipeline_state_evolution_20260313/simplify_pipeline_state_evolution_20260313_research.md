# Simplify Pipeline State Evolution Research

## Problem Statement
The PipelineState interface in the evolution pipeline has grown to ~20+ mutable fields, many of which are only read/written by a single agent or serve as temporary communication slots. This project simplifies PipelineState by moving single-agent fields (e.g., debateTranscripts, outlineVariants, sectionEvolutionStates) to agent-local state, eliminating duplication (dimensionScores already derivable from critiques), and defaulting nullable fields. The goal is to reduce the shared mutable surface from ~20 fields to ~11 core fields, making the pipeline easier to understand, test, and maintain.

## Requirements (from GH Issue #NNN)
1. **Move single-agent fields out of PipelineState** — Fields only used by one agent should live on the agent instance, not shared state:
   - `similarityMatrix` → ProximityAgent instance (only writer and reader)
   - `treeSearchResults` → TreeSearchAgent instance (only writer; read by serialization only)
   - `treeSearchStates` → TreeSearchAgent instance (only writer; read by serialization only)
   - `sectionState` → SectionDecompositionAgent instance (only writer and reader)
   - `debateTranscripts` → DebateAgent instance (only writer; read by serialization only)
   - `outlineVariants` → OutlineGenerationAgent instance (if single-agent)
   - `flowCritiqueResults` → FlowCritique local state (if single-agent)
2. **Eliminate dimensionScores duplication** — `dimensionScores` is `Record<id, Record<dim, score>>` but is just a projection of `allCritiques[].dimensionScores`. IterativeEditing and SectionDecomposition agents can read from `allCritiques` directly.
3. **Default nullable fields** — Replace null defaults with empty values where meaningful:
   - `allCritiques: Critique[]` (default `[]` instead of `null`)
   - `diversityScore: number` (default `0` instead of `null`)
   - Keep `metaFeedback: MetaFeedback | null` — meaningful "not yet computed" semantics
4. **Fix misleading phase comments** — Replace numbered "Phase N" comments in PipelineState with grouping comments (`// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`)
5. **Audit checkpoint serialization** — Ensure `serializeState()` / `deserializeState()` are updated; add `agent.getCheckpointData()` / `agent.restoreFromCheckpoint()` hooks for agent-local state
6. **Update all agent consumers** — Every agent that reads from or writes to PipelineState must be updated to use the new structure
7. **Preserve backward compatibility for in-flight runs** — Checkpoint deserialization must handle both old and new formats during rollout
8. **Update tests** — All unit tests touching PipelineState, PipelineStateImpl, or agent execute() methods must be updated
9. **Update documentation** — Evolution architecture docs and curriculum should reflect the simplified state
10. **Consider Maps vs Records consistency** — `ratings` and `matchCounts` are Map at runtime but Record when serialized; `dimensionScores` and `similarityMatrix` are Record always. Evaluate standardizing.

## High Level Summary

### Observations from Codebase Tour

#### 1. Fields that only one agent writes AND reads

| Field | Writer | Reader | Could move to |
|---|---|---|---|
| `similarityMatrix` | proximity | proximity (only) | ProximityAgent instance |
| `treeSearchResults` | treeSearch | serialization only | TreeSearchAgent instance |
| `treeSearchStates` | treeSearch | serialization only | TreeSearchAgent instance |
| `sectionState` | sectionDecomposition | sectionDecomposition | SectionDecompositionAgent instance |
| `debateTranscripts` | debate | serialization only | DebateAgent instance |

`diversityScore` must stay — it's read by the supervisor. But the raw similarity matrix is only used to compute that score.

#### 2. Phase comments are misleading
Debate is labeled "Phase 6" but runs before ranking in the execution order. The phase numbers don't match reality anymore. Could be replaced with grouping comments like `// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`.

#### 3. dimensionScores duplicates data from allCritiques
`dimensionScores` is `Record<id, Record<dim, score>>` — but that's just a projection of `allCritiques[].dimensionScores`. IterativeEditing and SectionDecomposition agents could read from `allCritiques` directly.

#### 4. Nullable fields add complexity everywhere
`allCritiques`, `similarityMatrix`, `diversityScore`, `metaFeedback` are all `| null`. Every reader has to null-check. If they defaulted to empty values (`[]`, `{}`, `0`), the code would be simpler:
```typescript
// Current (throughout codebase):
if (state.allCritiques && state.allCritiques.length > 0) { ... }
(state.allCritiques ??= []).push(...critiques);

// Simplified:
if (state.allCritiques.length > 0) { ... }
state.allCritiques.push(...critiques);
```

#### 5. Maps vs Records inconsistency
`ratings` and `matchCounts` are Map at runtime but Record when serialized. `dimensionScores` and `similarityMatrix` are Record always. Picking one and sticking with it would remove the serialize/deserialize conversion boilerplate.

### Target Simplified PipelineState

```typescript
interface PipelineState {
  // Core (immutable after init)
  originalText: string;

  // Pool (mutable)
  iteration: number;
  pool: TextVariation[];
  newEntrantsThisIteration: string[];

  // Ranking (mutable)
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  matchHistory: Match[];

  // Analysis (mutable, shared across agents)
  allCritiques: Critique[];           // not nullable
  metaFeedback: MetaFeedback | null;  // keep nullable — meaningful "not yet computed"
  diversityScore: number;             // default 0, not nullable

  // Arena
  lastSyncedMatchIndex: number;
}
```

Everything else (`similarityMatrix`, `dimensionScores`, `debateTranscripts`, `treeSearchResults`, `treeSearchStates`, `sectionState`) moves into agent instances or gets derived on the fly. Agents that own private state serialize/deserialize it themselves via hooks (`agent.getCheckpointData()` / `agent.restoreFromCheckpoint()`).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/entity_diagram.md

## Code Files Read
- [list of code files reviewed]
