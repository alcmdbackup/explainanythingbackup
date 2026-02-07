# New Edit Operator Plan

## Background
The evolution pipeline (`src/lib/evolution/`) implements a genetic algorithm for iteratively improving text variants through generation, competition, and refinement. Its architecture closely mirrors Google DeepMind's "AI Co-Scientist" (arxiv 2502.18864), with matching agents for generation, evolution, reflection, ranking (Elo tournaments), proximity, and meta-review. The one missing component is "simulated debate" — a structured multi-agent argumentation mechanism that produces improvement suggestions through adversarial analysis.

## Problem
Currently, variant improvement relies on two mechanisms: (1) genetic operators in EvolutionAgent (mutate, crossover, creative exploration), and (2) statistical feedback from MetaReviewAgent. Neither involves structured multi-perspective analysis of variant quality. The ReflectionAgent critiques variants independently (one LLM call per variant, no cross-comparison). There is no mechanism for agents to argue different perspectives about what makes one variant better than another and synthesize those insights into an improved variant.

## Options Considered
1. **Extend ReflectionAgent** — Add debate logic to existing critique agent. Rejected: breaks existing contract (single-variant → multi-variant), wrong output format, no shared logic to reuse.
2. **Extend MetaReviewAgent** — Add LLM debate calls to statistical analyzer. Rejected: wrong abstraction entirely (zero LLM calls currently, pool-level analysis vs variant-specific argumentation).
3. **New DebateAgent** ✅ — Clean extension via `AgentBase`. The agent interface is well-defined, supervisor already supports optional agent toggles, and debate has distinct input/output requirements.

## Phased Execution Plan

### Phase 1: Infrastructure (types, state, config, flags)
- Add `DebateTranscript` interface to `types.ts`
- Add `debateTranscripts` field to `PipelineState`, `SerializedPipelineState`, and `PipelineStateImpl`
- Add serialize/deserialize support in `state.ts` with `?? []` backward compat
- Add `debate: 0.05` budget cap in `config.ts` (reduce tournament from 0.30 → 0.25)
- Add `debateEnabled` feature flag in `featureFlags.ts`
- **Verify:** existing tests pass, tsc clean

### Phase 2: DebateAgent implementation
- Create `agents/debateAgent.ts` (~250 lines)
- 3-turn debate: Advocate A → Advocate B (with rebuttal) → Judge (JSON synthesis)
- Generate improved variant from judge's recommendations
- Consume ReflectionAgent critiques and MetaFeedback as optional context
- Format validation via `validateFormat()`
- Strategy: `debate_synthesis`, parentIds from both debate variants
- **Verify:** debateAgent.test.ts passes, tsc clean

### Phase 3: Pipeline integration
- Add `runDebate: boolean` to `PhaseConfig` in supervisor.ts
- Enable in COMPETITION phase only
- Add `debate?: PipelineAgent` to `PipelineAgents` in pipeline.ts
- Insert execution block between Reflection and Evolution
- Export from `index.ts`
- **Verify:** all evolution tests pass, build succeeds

### Phase 4: Tests
- Create `agents/debateAgent.test.ts` (~200 lines, 12 test cases)
- Follows `reflectionAgent.test.ts` mock pattern
- Coverage: success path, failure modes, budget errors, partial transcripts, critique consumption

## Testing
- **Unit:** `debateAgent.test.ts` — 12 test cases covering success, failures, budget, partial transcripts
- **Existing:** Run full `npx jest src/lib/evolution/` to verify no regressions
- **Type check:** `npx tsc --noEmit`
- **Lint:** `npx eslint src/lib/evolution/`
- **Build:** `npm run build`
- **Integration:** Evolution CLI dry run with debate enabled

## Documentation Updates
- Update `docs/planning/new_edit_operator_20260201/new_edit_operator_20260201_research.md` ✅ (already done)
- No feature deep dive or architecture.md changes needed per user direction
