# Understand Current Evolution Pipeline Plan

## Background

The evolution pipeline has two execution modes: `executeMinimalPipeline` (Slice A — 2 agents) and `executeFullPipeline` (Slice B — 9 agents with phase-aware transitions). Documentation described the full pipeline, but the admin UI trigger was only using the minimal pipeline. This resulted in users seeing only "generation" and "calibration" agents in the Timeline UI because those were the only agents that actually executed.

## Problem

1. **Admin trigger only runs 2 agents**: `_triggerEvolutionRunAction` in `evolutionActions.ts` used `executeMinimalPipeline` with `[GenerationAgent, CalibrationRanker]`
2. **No background runner**: No cron or worker existed to process pending runs automatically
3. **8 agents scaffolded but unused**: Reflection, IterativeEditing, Debate, Evolution, Tournament, Proximity, MetaReview never executed in production

## Options Considered

### Option A: Upgrade Admin Trigger to Full Pipeline ✅ IMPLEMENTED
- Modify `_triggerEvolutionRunAction` to use `executeFullPipeline` with all 9 agents
- **Pros**: Immediate fix, leverages existing code
- **Cons**: Still requires manual trigger

### Option B: Create Background Runner Cron ✅ IMPLEMENTED
- New `/api/cron/evolution-runner` endpoint polls for pending runs
- Claims run atomically, executes full pipeline, handles errors
- **Pros**: Enables automated processing, decouples trigger from execution
- **Cons**: Requires Vercel cron config

**Decision**: Implement BOTH options.

## Phased Execution Plan

### Phase 1: Upgrade Admin Trigger ✅ COMPLETE
**File**: `src/lib/services/evolutionActions.ts`

Changed imports to include all agents and `executeFullPipeline`:
```typescript
const agents: PipelineAgents = {
  generation: new GenerationAgent(),
  calibration: new CalibrationRanker(),
  tournament: new Tournament(),
  evolution: new EvolutionAgent(),
  reflection: new ReflectionAgent(),
  iterativeEditing: new IterativeEditingAgent(),
  debate: new DebateAgent(),
  proximity: new ProximityAgent(),
  metaReview: new MetaReviewAgent(),
};

await executeFullPipeline(runId, agents, ctx, evolutionLogger, { startMs, featureFlags });
```

### Phase 2: Create Background Runner ✅ COMPLETE
**File**: `src/app/api/cron/evolution-runner/route.ts`

New cron endpoint with:
- FIFO pending run selection
- Atomic claim (prevents race conditions)
- 30-second heartbeat interval (watchdog compatible)
- Full error handling with status updates

## Testing

### Verification Completed
- ✅ ESLint: Passed (warnings are pre-existing design system issues)
- ✅ TypeScript: No errors
- ✅ Build: Successful (new route visible in build output)
- ✅ Unit tests: All 63 pipeline tests pass

### Manual Verification (Staging)
- [ ] Trigger admin evolution run
- [ ] Verify Timeline shows all phase-appropriate agents (3 EXPANSION, 8 COMPETITION)
- [ ] Verify cron picks up pending runs when called

## Documentation Updates

Files to update:
- [x] `docs/planning/understand_current_ev_pipeline_20260203/` — This project
- [x] `docs/planning/feat/understand_pipeline_agent_executioN-20260204/` — Implementation details
- [x] `docs/feature_deep_dives/evolution_pipeline.md` — Updated cron endpoint description (removed "NOT YET ENABLED"), verified Two Pipeline Modes section is accurate
- [x] `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Agent counts already correct (3 EXPANSION, 8 COMPETITION)
