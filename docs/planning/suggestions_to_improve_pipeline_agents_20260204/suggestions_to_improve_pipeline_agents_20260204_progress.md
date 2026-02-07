# Suggestions to Improve Pipeline Agents Progress

## Planning Phase
### Work Done
- [x] Research completed: Documented all 8+ agents, architectural patterns, integration points
- [x] Identified 5 key gaps: strategy routing, cost attribution, metafeedback, title sync, history clearing
- [x] Evaluated 3 options: Full overhaul, Phased incremental (selected), Minimal fixes
- [x] Created 4-phase execution plan with tests and verification steps

### Issues Encountered
None - research was comprehensive and gaps were well-documented in existing docs.

### User Clarifications
None required - gaps were explicitly noted in evolution_pipeline.md documentation.

---

## Phase 1: Cost Attribution Fix
**Status**: Not Started
**Estimated**: 1-2 hours

### Work Done
- [ ] Update `debateAgent.ts` to track actual cost
- [ ] Update `debateAgent.test.ts` with cost assertions
- [ ] Verify in admin UI

### Issues Encountered
[To be filled during execution]

---

## Phase 2: Strategy Routing Connection
**Status**: Not Started
**Estimated**: 2-3 hours

### Work Done
- [ ] Update `generationAgent.ts` to accept strategy payload
- [ ] Update `supervisor.ts` to pass strategy through
- [ ] Update `pipeline.ts` to wire strategy to agent
- [ ] Add unit tests for single/multi strategy modes
- [ ] Add integration test for rotation

### Issues Encountered
[To be filled during execution]

---

## Phase 3: MetaFeedback Enhancement
**Status**: Not Started
**Estimated**: 2-3 hours

### Work Done
- [ ] Update `evolvePool.ts` to use successfulStrategies for parent boost
- [ ] Update `debateAgent.ts` to inject weaknesses into judge prompt
- [ ] Add unit tests for feedback consumption
- [ ] Verify in pipeline logs

### Issues Encountered
[To be filled during execution]

---

## Phase 4: History Preservation & Title Sync
**Status**: Not Started
**Estimated**: 1-2 hours

### Work Done
- [ ] Update `supervisor.ts` to preserve expansion history
- [ ] Update `applyWinnerAction` to sync title from H1
- [ ] Add unit tests for both changes
- [ ] Verify run summary and title sync

### Issues Encountered
[To be filled during execution]

---

## Documentation Phase
**Status**: Not Started

### Work Done
- [ ] Update `evolution_pipeline.md` - remove "known gap" notes
- [ ] Update `evolution_pipeline_visualization.md` - note accurate costs
- [ ] Final review and cleanup

### Issues Encountered
[To be filled during execution]
