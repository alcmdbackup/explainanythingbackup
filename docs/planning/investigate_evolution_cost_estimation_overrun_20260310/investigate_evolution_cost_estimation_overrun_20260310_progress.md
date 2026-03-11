# Investigate Evolution Cost Estimation Overrun Progress

## Phase 1: Investigation (Complete)
### Work Done
- Queried production database for run 223bc062 configuration, budget events, and per-agent costs
- Discovered tournament agent underestimates 3.7x for gpt-5-nano (150 hardcoded vs ~2000 actual output tokens)
- Expanded investigation to all 67 completed production runs
- Found estimation system completely dead: 66/67 runs have null estimates, llmCallTracking and baselines tables empty
- Identified 7 systemic issues across estimation, tracking, and budget enforcement
- Computed systematic reserve/spend ratios for all agent+model combinations
- Found 3 runs that exceeded budget caps, all involving gpt-5-nano or gpt-5.2
- Identified text length scaling mismatch and tournament invocation cost tracking bug

### Round 2-3 Deep Investigation (12 agents)
- Audited all agent estimateCost() methods — found hardcoded rates up to 350x wrong
- Discovered two parallel estimation paths (central estimator uses correct pricing; agent methods don't)
- Analyzed comparison output tokens per type: simple=1-5, structured=20-40, flow=80-150
- Found 8 models with 8x output/input price ratios that amplify errors catastrophically
- Confirmed feedback loop root cause: double error suppression + likely missing SUPABASE_SERVICE_ROLE_KEY
- Confirmed tournament invocation tracking code paths look correct — likely timing issue with Promise.allSettled
- Verified all cost-bearing agents are in central estimator (missing ones have zero LLM cost)
- Found flowCritique model mismatch (estimator uses judgeModel, code uses generationModel)

### Issues Encountered
- llmCallTracking table empty in production — saveLlmCallTracking() silently fails on minicomputer (root cause: likely missing env var)
- Tournament invocation cost_usd = $0 despite $0.053 in budget events (likely timing issue)

### User Clarifications
- User confirmed extending existing `evolution/docs/evolution/cost_optimization.md` rather than creating a new deep dive doc
- User requested broad investigation beyond original run 223bc062 — led to discovering production-wide estimation health issues
- User decided: keep upfront estimateCost() for heavy agents (treeSearch, sectionDecomposition) but use canonical pricing from llmPricing.ts; remove dead code from light agents
- `src/config/llmPricing.ts` confirmed as single source of truth for model pricing

## Phase 2: Pre-Implementation Audit (In Progress)
### Codebase audit for hardcoded values
Scanning entire codebase for:
- Hardcoded input/output token lengths
- Hardcoded model lists and costs
- Any pricing data not sourced from llmPricing.ts

## Phase 3: Implementation
(Not yet started — see planning doc for 6-phase execution plan)
