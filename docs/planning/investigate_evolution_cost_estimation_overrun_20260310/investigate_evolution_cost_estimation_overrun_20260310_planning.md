# Investigate Evolution Cost Estimation Overrun Plan

## Background
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #NNN)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

## Problem

The evolution pipeline's cost estimation system has 14 identified issues spanning budget enforcement, token estimation, pricing accuracy, text length scaling, and feedback loop failures. The system has two parallel estimation paths: a central estimator (correct pricing from llmPricing.ts) and agent-level estimateCost() methods (hardcoded rates up to 350x wrong). The 150-token comparison output hardcode is wrong in both directions — 30x too high for simple A/B comparisons, correct only for flow comparisons. Models with high output/input price ratios (gpt-5-nano at 8x, Claude at 5x) amplify any output token errors catastrophically. The 30% safety margin absorbs moderate errors for cheap models (deepseek-chat at 2x ratio) but fails for expensive ones. Variant text grows 3-8% per iteration but estimation uses static textLength. The feedback loop is completely dead due to double error suppression in saveLlmCallTracking().

## Options Considered

### Option A: Targeted Hotfixes (Recommended)
Fix the most impactful issues first: comparison output token estimate, recordSpend overflow check, and llmCallTracking silent failure. Low risk, high impact, can be done incrementally.

### Option B: Replace Heuristic Estimation with Per-Model Empirical Baselines
Abandon the token-counting heuristic entirely. Use production budget_events data (which does work) to compute empirical cost-per-call baselines per agent+model. Requires the tracking pipeline to work first (Option A prerequisite).

### Option C: Full Estimation System Rewrite
Replace the entire estimation stack with a simpler model: use budget_events spend data to compute rolling averages per agent+model, skip the llmCallTracking/baselines pipeline entirely. Higher risk, but eliminates the broken feedback loop.

### Option D: Hard Budget Enforcement Only
Skip estimation improvements entirely. Focus on making `recordSpend()` enforce the cap strictly and adding mid-round budget checks to tournament. Simple but doesn't solve the estimation problem for queue-time validation.

**Recommendation:** Option A first (phases 1-3), then Option B (phase 4) once tracking data flows.

## Phased Execution Plan

### Phase 1: Fix Critical Budget Enforcement (P0)
**Goal:** Prevent budget overruns from going deeply negative.

1. Add overflow check in `recordSpend()` (`costTracker.ts`) — reject or warn when `totalSpent > budgetCapUsd`
2. Add mid-round budget check in tournament agent (`tournament.ts`) — check remaining budget between comparison rounds instead of firing all in parallel
3. Unit tests for both changes

**Files:** `evolution/src/lib/core/costTracker.ts`, `evolution/src/lib/agents/tournament.ts`

### Phase 2: Fix Comparison Token Estimation (P0)
**Goal:** Reduce 3.7x underestimate to <1.5x.

1. Update `estimateTokenCost()` in `llmClient.ts` — replace single 150-token hardcode with comparison-type-aware estimates:
   - Simple A/B/TIE: 10 tokens (actual 1-5)
   - Structured 5-dim: 50 tokens (actual 20-40)
   - Flow + friction: 150 tokens (actual 80-150)
2. Add `comparisonType` parameter to `estimateTokenCost()` so callers can specify which type
3. Fix text length scaling — use estimated variant length (e.g., 4000 chars) instead of original text length for comparison cost estimation
4. Account for variant text growth through iterations — apply ~4% per-iteration growth factor
5. Unit tests for updated estimates

**Files:** `evolution/src/lib/core/llmClient.ts`, `evolution/src/lib/core/costEstimator.ts`

### Phase 3: Fix Silent Tracking Failures (P1)
**Goal:** Restore the estimation feedback loop.

1. Investigate why `saveLlmCallTracking()` silently fails on minicomputer — check schema validation, Supabase connection, env vars
2. Fix the root cause so `llmCallTracking` rows are populated
3. Verify `refreshAgentCostBaselines()` can aggregate data once tracking works
4. Investigate tournament invocation cost tracking bug (`cost_usd = $0`)

**Files:** `src/lib/services/llms.ts`, `evolution/src/lib/core/metricsWriter.ts`

### Phase 4: Model-Specific Calibration (P2)
**Goal:** Systematic accuracy improvement.

1. Once tracking data flows, wait for 50+ samples per agent+model combination
2. Validate that empirical baselines produce better estimates than heuristics
3. Adjust treeSearch estimation (currently 10x overestimate) based on empirical data
4. Consider using budget_events as alternative data source for baselines (bypasses llmCallTracking)

**Files:** `evolution/src/lib/core/costEstimator.ts`, `evolution/src/lib/core/metricsWriter.ts`

### Phase 5: Clean Up Agent estimateCost() Methods (P1)
**Goal:** Eliminate the parallel estimation path with stale hardcoded rates.

1. Remove or refactor agent `estimateCost()` methods that use hardcoded pricing:
   - generationAgent ($0.0004 — 350x under), reflectionAgent ($0.80 — 5x over), iterativeEditingAgent ($0.80 — 5x over), outlineGenerationAgent ($0.0004 — 350x under), sectionDecompositionAgent ($0.80 — 5x over), debateAgent ($0.0008 — 70x under), tournament ($0.0008 — 70x under), calibrationRanker ($0.0004 — 350x under)
2. For treeSearch and sectionDecomposition (which actually call their own estimateCost during execution): refactor to use `calculateLLMCost()` from llmPricing.ts instead of hardcoded rates
3. Fix flowCritique model mismatch — estimator uses judgeModel but code uses generationModel
4. Unit tests verifying agent estimates use correct pricing

**Files:** All agents in `evolution/src/lib/agents/`, `evolution/src/lib/core/llmClient.ts`

### Phase 6: Documentation & Deep Dive Update (P2)
**Goal:** Document findings and fixes.

1. Update `evolution/docs/evolution/cost_optimization.md` with:
   - Production estimation health findings (dead feedback loop, empty tables)
   - Model-specific pricing asymmetry impact
   - Systematic reserve/spend ratios by agent+model
   - Text length scaling mismatch explanation
2. Document the budget enforcement improvements
3. Add troubleshooting section for minicomputer tracking failures

## Testing

### Unit Tests
- `costTracker.test.ts` — test recordSpend overflow rejection when budget exceeded
- `costTracker.test.ts` — test budget goes to exactly $0 (not negative) on overflow
- `llmClient.test.ts` — test estimateTokenCost returns correct estimate per comparison type (simple=10, structured=50, flow=150)
- `llmClient.test.ts` — test variant text growth factor applied across iterations
- `tournament.test.ts` — test mid-round budget check stops further comparisons
- `*Agent.test.ts` — test each agent's estimateCost uses calculateLLMCost (not hardcoded rates)

### Integration Tests
- Run a mock evolution pipeline with gpt-5-nano judge and verify budget is respected
- Verify llmCallTracking rows are inserted after fixing the silent failure

### Manual Verification (Production)
- After deploying Phase 1+2: run a $0.05 budget evolution with gpt-5-nano judge, verify it stays within budget
- After deploying Phase 3: verify `llmCallTracking` table has rows after a production run
- Query `evolution_budget_events` to confirm reserve/spend ratios improve toward 1.0x

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - may need updates on estimation accuracy findings
- `evolution/docs/evolution/experimental_framework.md` - per-agent cost breakdown context
- `evolution/docs/evolution/reference.md` - budget cap configuration
- `evolution/docs/evolution/architecture.md` - pipeline cost flow
- `evolution/docs/evolution/agents/generation.md` - generation agent cost drivers
- `evolution/docs/evolution/data_model.md` - cost tracking data model
- `evolution/docs/evolution/rating_and_comparison.md` - comparison cost context
- `evolution/docs/evolution/agents/support.md` - support agent costs
- `evolution/docs/evolution/visualization.md` - cost visualization features
