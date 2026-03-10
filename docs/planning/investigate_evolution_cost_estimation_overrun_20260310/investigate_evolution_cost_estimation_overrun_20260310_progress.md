# Investigate Evolution Cost Estimation Overrun Progress

## Phase 1: Investigation
### Work Done
- Queried production database for run 223bc062 configuration, budget events, and per-agent costs
- Discovered tournament agent underestimates 3.7x for gpt-5-nano (150 hardcoded vs ~2000 actual output tokens)
- Expanded investigation to all 67 completed production runs
- Found estimation system completely dead: 66/67 runs have null estimates, llmCallTracking and baselines tables empty
- Identified 7 systemic issues across estimation, tracking, and budget enforcement
- Computed systematic reserve/spend ratios for all agent+model combinations
- Found 3 runs that exceeded budget caps, all involving gpt-5-nano or gpt-5.2
- Identified text length scaling mismatch and tournament invocation cost tracking bug

### Issues Encountered
- llmCallTracking table empty in production — saveLlmCallTracking() silently fails on minicomputer (root cause TBD in Phase 3)
- Tournament invocation cost_usd = $0 despite $0.053 in budget events (tracking bug, not yet investigated)

### User Clarifications
- User confirmed extending existing `evolution/docs/evolution/cost_optimization.md` rather than creating a new deep dive doc
- User requested broad investigation beyond original run 223bc062 — led to discovering production-wide estimation health issues

## Phase 2: Implementation
(Not yet started — see planning doc for phased execution plan)
