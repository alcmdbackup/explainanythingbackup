# Simplify Pipeline State Evolution Plan

## Background
The PipelineState interface in the evolution pipeline has grown to ~20+ mutable fields, many of which are only read/written by a single agent or serve as temporary communication slots. This project simplifies PipelineState by moving single-agent fields (e.g., similarityMatrix, treeSearchResults, sectionState, debateTranscripts) to agent-local state, eliminating duplication (dimensionScores derivable from critiques), and defaulting nullable fields. The goal is to reduce the shared mutable surface from ~20 fields to ~11 core fields, making the pipeline easier to understand, test, and maintain.

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
4. **Fix misleading phase comments** — Replace numbered "Phase N" comments with grouping comments (`// --- Pool ---`, `// --- Ranking ---`, `// --- Analysis ---`)
5. **Audit checkpoint serialization** — Ensure `serializeState()` / `deserializeState()` are updated; add `agent.getCheckpointData()` / `agent.restoreFromCheckpoint()` hooks for agent-local state
6. **Update all agent consumers** — Every agent that reads from or writes to PipelineState must be updated
7. **Preserve backward compatibility for in-flight runs** — Checkpoint deserialization must handle both old and new formats during rollout
8. **Update tests** — All unit tests touching PipelineState, PipelineStateImpl, or agent execute() methods must be updated
9. **Update documentation** — Evolution architecture docs and curriculum should reflect the simplified state
10. **Consider Maps vs Records consistency** — Evaluate standardizing runtime representation

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - May need updates if test patterns change
- `evolution/docs/evolution/architecture.md` - Pipeline state description, checkpoint format
- `evolution/docs/evolution/data_model.md` - Entity relationships if state structure changes
- `evolution/docs/evolution/entity_diagram.md` - If relationships change
- `evolution/docs/evolution/curriculum.md` - Module on pipeline state needs updating
