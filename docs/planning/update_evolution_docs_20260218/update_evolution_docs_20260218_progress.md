# Update Evolution Docs Progress

## Phase 1: Pipeline Continuation & Vercel Timeouts
### Work Done
- **architecture.md**: Expanded "Continuation-Passing (Timeout Recovery)" section into comprehensive "Pipeline Continuation & Vercel Timeouts" section covering Vercel timeout config, end-to-end flow, atomic RPC details, runner comparison table, and guard rails (watchdog behavior)
- **reference.md**: Fixed continuation config to note these are `FullPipelineOptions` fields (not `EvolutionRunConfig`), added `supervisorResume` option, added `prepareResumedPipelineRun()` to index.ts barrel description, updated watchdog description in Key Files and Monitoring sections to reflect checkpoint recovery behavior
- Fixes: #5 (implicit), #14, #15, #43

### Issues Encountered
- #43 (watchdog description) was attributed to visualization.md in research but the actual stale claims were in reference.md Key Files table and Monitoring section — fixed there instead

### User Clarifications
None needed

## Phase 2: High-Severity Factual Fixes
### Work Done
- **reference.md**: EvolutionRunSummary V1→V2 (ordinalHistory, ordinal, baselineOrdinal, avgOrdinal, decisiveRate), strategy experiment script path (evolution/scripts/ → scripts/ top-level)
- **agents/generation.md**: Expand-empty returns failure, not outline fallback
- **agents/support.md**: ReflectionAgent dimensions Structure/Coherence → voice_fidelity/conciseness
- **rating_and_comparison.md**: Comparison runs sequentially, not concurrently
- **cost_optimization.md**: Adaptive allocation marked as intentionally unused
- **strategy_experiments.md**: All script path references updated
- Fixes: #8, #9, #10, #17, #21, #24, #28, #36

## Phase 3: Medium-Severity Fixes
### Work Done
- **architecture.md**: LOC 751→652, isEnabled→getActiveAgents
- **data_model.md**: Added 'single' to PipelineType
- **reference.md**: ELO_CONSTANTS→RATING_CONSTANTS, finalizePipelineRun location fix, 16-flag CLI table
- **agents/overview.md**: FlowCritique standalone function clarification
- **agents/editing.md**: section_edited→section_decomposition prefix
- **agents/support.md**: countRatedNonBaseline→countNonBaseline, isRatingStagnant unused note
- **rating_and_comparison.md**: Cache threshold 0.5→0.3
- **hall_of_fame.md**: 5→6 methods, coverage matrix 45→60
- **cost_optimization.md**: 2 missing server actions, hash example fix
- **visualization.md**: 9→12 server actions, run detail polling added
- Fixes: #1, #2, #7, #11, #12, #16, #20, #22, #25, #26, #29, #31, #32, #37, #38, #39, #42

## Phase 4: Low-Severity Fixes
### Work Done
- **architecture.md**: Degenerate as plateau sub-check (#3), flowCritique in data flow (#4), refreshAgentCostBaselines nested note (#6)
- **reference.md**: tournament.topK in config (#13)
- **agents/overview.md**: ExecutionContext runId + optional comparisonCache (#19)
- **agents/editing.md**: FlowCritique integration note (#23)
- **agents/support.md**: CRITIQUE_DIMENSIONS→QUALITY_DIMENSIONS (#27)
- **hall_of_fame.md**: getCrossTopicSummaryAction name fix (#30)
- **visualization.md**: Polling default 5s (#40), remove AbortController claim (#41)
- Fixes: #3, #4, #6, #13, #19, #23, #27, #30, #33, #40, #41

## Phase 5: Final Review & Consistency Pass
### Work Done
- Grepped for stale references: eloHistory, topElo, baselineElo, ELO_CONSTANTS, K_SCHEDULE, evolution/scripts/run-strategy-experiment — all clean
- Fixed remaining "concurrently via Promise.all" claims in overview.md for CalibrationRanker and Tournament comparison rounds → sequential via run2PassReversal
- Verified file paths exist (scripts/run-strategy-experiment.ts, adaptiveAllocation.ts)
- All 39 discrepancies addressed across 13 docs

---

## Round 2: Validation Audit Fixes (19 discrepancies)

## Phase 6: High-Severity Factual Fixes
### Work Done
- **reference.md**: diversityHistory `Array<{iteration, score}>` → flat `number[]` (R2-1)
- **rating_and_comparison.md**: Rewrote isDraw logic — binary check (`confidence === 0 || winnerId === loserId`), not 0.7 threshold (R2-2)
- Fixes: R2-1, R2-2
- Commit: `15457370`

## Phase 7: Medium-Severity Fixes
### Work Done
- **reference.md**: evolutionActions 9→13 actions with full list, visualizationActions 4→12 actions (R2-3, R2-3b)
- **agents/overview.md**: SectionDecomp prefix section_edited→section_decomposition, removed sectionState from Writes (R2-4, R2-5)
- **rating_and_comparison.md**: Clarified two separate cache systems — Map (confidence > 0.3) vs ComparisonCache class (winnerId/isDraw gate) (R2-6)
- **hall_of_fame.md**: 10→12 models with full list, fixed Anthropic model name, method 4 is minimal evolution not oneshot (R2-7, R2-8)
- **visualization.md**: Clarified Timeline/Elo/Logs poll, Variants/Lineage load once (R2-9)
- **README.md**: 6→5 tabs, 8→12 server actions (R2-10, R2-11)
- Fixes: R2-3, R2-3b, R2-4, R2-5, R2-6, R2-7, R2-8, R2-9, R2-10, R2-11
- Commit: `db0eb8d1`

## Phase 8: Low-Severity Fixes
### Work Done
- **architecture.md**: markRunFailed guard includes continuation_pending (R2-12)
- **agents/overview.md**: CalibrationRanker (sequential) vs Tournament (concurrent) bias passes (R2-13)
- **agents/flow_critique.md**: Public method is compareFlowWithBiasMitigation, runs sequentially (R2-14, R2-15)
- **agents/support.md**: DebateAgent checks pool count not ratings (R2-16)
- **rating_and_comparison.md**: 3 verdicts not 5, disagreement→confidence logic (R2-17)
- **hall_of_fame.md**: Complete Elo formula with winner/loser/tie (R2-18)
- **cost_optimization.md**: Added costAnalyticsActions.ts to Key Files (R2-19)
- Fixes: R2-12, R2-13, R2-14, R2-15, R2-16, R2-17, R2-18, R2-19
- Commit: `3b8136f9`

## Phase 9: Final Consistency Pass
### Work Done
- Grepped for 9 stale terms across all 15 docs — all clean
- Added flow_critique.md to README.md reading order and document map
- Renumbered Infrastructure section (11-13)
- Verified no code files modified
- All 19 Round 2 discrepancies addressed across 10 docs
- Commit: `c01ba581`
