# Investigate Evolution Cost Estimation Overrun Plan

## Background
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #686)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

## Problem

14 issues identified across 5 categories:

**Budget enforcement:** No overflow check in `recordSpend()` allows budget to go arbitrarily negative. Tournament fires all comparisons in parallel with no mid-round budget check.

**Token estimation:** 150-token comparison output hardcode is 30x too high for simple A/B (actual 1-5 tokens) and correct only for flow comparisons. Generation output heuristic (50% of input) is wrong for high-output models (actual 80-150% of input).

**Pricing:** Agent-level `estimateCost()` methods use hardcoded rates up to 350x wrong. These are mostly dead code but treeSearch and sectionDecomposition call theirs during execution. Central estimator uses correct pricing from llmPricing.ts.

**Text length:** `queueEvolutionRunAction` hardcodes 5000 chars. Variant text grows 3-8% per iteration (compounding to 50-100% by iteration 15) but estimation uses static textLength. Short seed articles (62-72 chars) vs generated variants (2000-8000 chars) is a fundamental mismatch.

**Feedback loop:** Completely dead. `saveLlmCallTracking()` silently fails on minicomputer (double error suppression). `llmCallTracking` table empty → no baselines → estimator stuck on heuristics forever. Most likely cause: missing `SUPABASE_SERVICE_ROLE_KEY` env var on minicomputer.

## Options Considered

### Option A: Targeted Hotfixes (Recommended)
Fix the most impactful issues first: overflow check, comparison token estimates, tracking failures. Low risk, high impact, incremental.

### Option B: Replace Heuristics with Empirical Baselines
Use budget_events spend data to compute cost-per-call baselines per agent+model. Requires tracking to work first (Option A prerequisite).

### Option C: Full Estimation Rewrite
Replace entire estimation stack with budget_events-based rolling averages. Higher risk, but eliminates the broken feedback loop entirely.

### Option D: Hard Budget Enforcement Only
Just make recordSpend enforce the cap and add mid-round budget checks. Doesn't fix estimation for queue-time validation.

**Recommendation:** Option A (phases 1-3), then Option B (phase 4) once data flows.

---

## Phased Execution Plan

### Phase 1: Budget Overflow Protection (P0)
**Goal:** Prevent budget from going deeply negative. Stop the bleeding.

#### 1a. Add overflow flag to CostTracker

**File:** `evolution/src/lib/core/costTracker.ts`

Add private field:
```typescript
private budgetOverflowed = false;
```

In `recordSpend()` (after line 62 where `totalSpent += actualCost`), add:
```typescript
if (this.totalSpent > this.budgetCapUsd && !this.budgetOverflowed) {
  this.budgetOverflowed = true;
  // Log but don't throw — we already paid for this call
}
```

In `reserveBudget()` (before the existing budget check at line 43), add:
```typescript
if (this.budgetOverflowed) {
  throw new BudgetExceededError('total', this.totalSpent, this.totalReserved, this.budgetCapUsd);
}
```

Add getter:
```typescript
get isOverflowed(): boolean { return this.budgetOverflowed; }
```

**Why not throw in recordSpend:** We already paid for the LLM call. Throwing would discard the response. Instead, we flag the overflow and block all future reservations.

#### 1b. Add mid-round budget check to tournament

**File:** `evolution/src/lib/agents/tournament.ts`

Insert at line 268 (between the `totalComparisons` check and `swissPairing()` call):
```typescript
// Recalculate budget pressure between rounds
const availableBudget = ctx.costTracker.getAvailableBudget();
if (availableBudget < ctx.payload.config.budgetCapUsd * 0.05) {
  exitReason = 'budget';
  break;
}
```

This stops the tournament if less than 5% budget remains, preventing the 24-calls-after-negative scenario from run 223bc062.

#### 1c. Tests

**File:** `evolution/src/lib/core/costTracker.test.ts`

New tests:
- `recordSpend sets overflow flag when totalSpent exceeds budget cap`
- `reserveBudget throws BudgetExceededError when overflow flag is set`
- `overflow flag does not prevent recording the spend that caused overflow`
- `isOverflowed getter returns correct state`

**File:** `evolution/src/lib/agents/tournament.test.ts`

New test:
- `stops between rounds when available budget < 5% of cap`

---

### Phase 2: Fix Comparison Token Estimation (P0)
**Goal:** Reduce reservation errors from 3.7x to <1.5x for all model/comparison combinations.

#### 2a. Add comparisonSubtype to LLMCompletionOptions

**File:** `evolution/src/lib/types.ts` (LLMCompletionOptions interface, ~line 429)

Add field:
```typescript
comparisonSubtype?: 'simple' | 'structured' | 'flow';
```

#### 2b. Update estimateTokenCost to use subtypes

**File:** `evolution/src/lib/core/llmClient.ts`

Add parameter to `estimateTokenCost()` (line 54):
```typescript
export function estimateTokenCost(
  prompt: string,
  model?: string,
  taskType?: 'comparison' | 'generation',
  agentName?: string,
  comparisonSubtype?: 'simple' | 'structured' | 'flow'
): number
```

Replace the `taskType === 'comparison'` branch (line 59-60):
```typescript
if (taskType === 'comparison') {
  switch (comparisonSubtype) {
    case 'simple':     estimatedOutputTokens = 10;  break;  // A/B/TIE: 1-5 actual
    case 'structured': estimatedOutputTokens = 50;  break;  // 5 dims: 20-40 actual
    case 'flow':       estimatedOutputTokens = 150; break;  // dims + friction: 80-150
    default:           estimatedOutputTokens = 50;  break;  // safe default for unmigrated
  }
}
```

Update `budgetedCallLLM()` (line 100) to pass through:
```typescript
const estimate = estimateTokenCost(prompt, model, options?.taskType, agentName, options?.comparisonSubtype);
```

#### 2c. Update all 7 callers to pass comparisonSubtype

| File | Line | Change |
|------|------|--------|
| `pairwiseRanker.ts` | 189 | Add `comparisonSubtype: structured ? 'structured' : 'simple'` |
| `pairwiseRanker.ts` | 258 | Add `comparisonSubtype: 'flow'` |
| `calibrationRanker.ts` | 43 | Add `comparisonSubtype: 'simple'` |
| `iterativeEditingAgent.ts` | 116 | Add `comparisonSubtype: 'simple'` |
| `sectionEditRunner.ts` | 64 | Add `comparisonSubtype: 'simple'` |
| `beamSearch.ts` | 70 | Add `comparisonSubtype: 'simple'` |
| `beamSearch.ts` | 294 | Add `comparisonSubtype: 'simple'` |

#### 2d. Tests

**File:** `evolution/src/lib/core/llmClient.test.ts`

New tests:
- `estimateTokenCost returns 10 output tokens for simple comparison`
- `estimateTokenCost returns 50 output tokens for structured comparison`
- `estimateTokenCost returns 150 output tokens for flow comparison`
- `estimateTokenCost returns 50 output tokens for comparison with no subtype (default)`
- `estimateTokenCost for gpt-5-nano simple comparison is within 2x of actual cost`

---

### Phase 3: Fix Text Length Scaling (P1)
**Goal:** Account for variant growth and short seed articles.

#### 3a. Pass actual text length at queue time

**File:** `evolution/src/services/evolutionActions.ts`

At line 201 in `queueEvolutionRunAction()`, replace hardcoded 5000:
```typescript
const textLength = originalText?.length ?? 5000;
const clampedTextLength = Math.max(100, Math.min(textLength, 100000));
```

#### 3b. Add iteration growth factor to central estimator

**File:** `evolution/src/lib/core/costEstimator.ts`

In `estimateRunCostWithAgentModels()`, for agents that scale with variant text, apply growth:
```typescript
function estimateTextLengthAtIteration(baseLength: number, iteration: number): number {
  return Math.round(baseLength * Math.pow(1.04, iteration));  // 4% per iteration
}
```

Use this in per-agent cost calculations instead of flat `textLength` across all iterations.

#### 3c. Tests

- `estimateTextLengthAtIteration grows 4% per iteration`
- `estimateRunCostWithAgentModels accounts for text growth across 15 iterations`

---

### Phase 4: Fix Tracking Failures (P1)
**Goal:** Restore the feedback loop so baselines can be populated.

#### 4a. Add env var validation to minicomputer startup

**File:** `evolution/scripts/start-runner.sh` (or equivalent)

```bash
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "FATAL: SUPABASE_SERVICE_ROLE_KEY not set" >&2
  exit 1
fi
```

#### 4b. Add tracking health check

**File:** `src/lib/services/llms.ts`

In `saveLlmCallTracking()`, add at function entry:
```typescript
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.warn('saveLlmCallTracking: SUPABASE_SERVICE_ROLE_KEY not set, skipping');
  return;
}
```

#### 4c. Make tracking failures visible

**File:** `src/lib/services/llms.ts`

In `saveTrackingAndNotify()` catch block (lines 116-123), add a counter:
```typescript
let trackingFailureCount = 0;
// In catch block:
trackingFailureCount++;
if (trackingFailureCount <= 3) {
  logger.error('LLM call tracking save failed (non-fatal)', { error: trackingError, count: trackingFailureCount });
}
if (trackingFailureCount === 3) {
  logger.error('LLM call tracking has failed 3 times — feedback loop is broken. Check SUPABASE_SERVICE_ROLE_KEY.');
}
```

#### 4d. Verify baseline pipeline works once data flows

After deploying 4a-4c, run a production evolution run and verify:
1. `llmCallTracking` table has new rows
2. `refreshAgentCostBaselines()` produces baselines from the new data
3. Subsequent runs use baselines instead of heuristic fallback

---

### Phase 5: Clean Up Agent estimateCost() (P2)
**Goal:** Single source of truth for model pricing. Heavy agents use it; light agents drop dead code.

#### Canonical pricing source

`src/config/llmPricing.ts` is the single source of truth. It exports:
- `LLM_PRICING` — the pricing table (43+ models)
- `getModelPricing(model)` — lookup with prefix fallback
- `calculateLLMCost(model, promptTokens, completionTokens)` — compute cost from model name + token counts

Currently **no agent imports from this file**. All agents hardcode their own rates.

#### 5a. Refactor treeSearch and sectionDecomposition to use canonical pricing

These two agents call their own `estimateCost()` during execution for upfront budget checks before their complex multi-call sequences (beam search, multi-section edit cycles). Keep this upfront check — it's valuable for heavy agents — but replace hardcoded rates with `calculateLLMCost()`.

**File:** `evolution/src/lib/agents/treeSearchAgent.ts` (lines 129-148)

Replace hardcoded `$0.40/$1.60` (gen) and `$0.10/$0.40` (eval) with:
```typescript
import { calculateLLMCost } from '@/config/llmPricing';

estimateCost(payload: AgentPayload): number {
  const textTokens = Math.ceil(payload.originalText.length / 4);
  const genModel = payload.config.generationModel ?? EVOLUTION_DEFAULT_MODEL;
  const judgeModel = payload.config.judgeModel ?? 'gpt-4.1-nano';

  const genCostPerCall = calculateLLMCost(genModel, textTokens + 500, textTokens);
  const evalCostPerCall = calculateLLMCost(judgeModel, Math.ceil(textTokens * 0.3) + 300, 50);

  const genTotal = K * B * D * genCostPerCall;
  const reCritiqueTotal = K * Math.max(0, D - 1) * genCostPerCall;
  const evalTotal = 30 * D * evalCostPerCall;

  return (genTotal + reCritiqueTotal + evalTotal) * 1.3;  // keep 1.3x safety margin
}
```

**File:** `evolution/src/lib/agents/sectionDecompositionAgent.ts` (lines 209-218)

Same pattern — replace hardcoded `$0.80/$4.0` (gen) and `$0.10` (judge) with `calculateLLMCost()` calls using the actual configured models.

#### 5b. Remove dead estimateCost() bodies from light agents

For agents whose `estimateCost()` is never called in production (generation, reflection, iterativeEditing, outlineGeneration, debate, tournament, calibration, pairwiseRanker, evolution, proximity, metaReview):

Replace the method body with:
```typescript
estimateCost(_payload: AgentPayload): number {
  // Upfront estimation not needed — each call uses budgetedCallLLM() individually.
  // Central estimator (costEstimator.ts) handles pre-run estimation with correct pricing.
  return 0;
}
```

This satisfies the abstract interface without maintaining wrong pricing data. If any of these agents ever need upfront estimation in the future, they should import from `@/config/llmPricing`.

#### 5c. Fix flowCritique model mismatch

**File:** `evolution/src/lib/core/costEstimator.ts` (line 274)

Change `getModel('flowCritique', true)` → `getModel('flowCritique', false)` (use generationModel, not judgeModel).

#### 5d. Tests

- `treeSearchAgent.estimateCost uses calculateLLMCost (changes when model pricing changes)`
- `sectionDecompositionAgent.estimateCost uses calculateLLMCost`
- `light agents estimateCost returns 0`
- `flowCritique estimation uses generationModel`

---

### Phase 6: Documentation (P2)
**Goal:** Document the cost estimation system and all fixes.

Update `evolution/docs/evolution/cost_optimization.md` with:
1. End-to-end cost estimation flow (the 3 moments: before/during/after)
2. Per-agent call profiles and token estimates
3. Model pricing risk tiers (8x/5x/4x/2x output/input ratios)
4. Budget enforcement mechanism (reserve → call → spend → overflow flag)
5. Known issues and their fixes
6. Troubleshooting: minicomputer tracking failures

---

## Testing

### Unit Tests (per phase)
| Phase | File | Test |
|-------|------|------|
| 1 | `costTracker.test.ts` | overflow flag set when spend exceeds cap |
| 1 | `costTracker.test.ts` | reserveBudget throws after overflow |
| 1 | `costTracker.test.ts` | spend that causes overflow is still recorded |
| 1 | `tournament.test.ts` | stops between rounds when budget < 5% |
| 2 | `llmClient.test.ts` | estimateTokenCost correct per comparison subtype |
| 2 | `llmClient.test.ts` | gpt-5-nano simple comparison estimate within 2x of actual |
| 3 | `costEstimator.test.ts` | text growth factor applied across iterations |
| 5 | `treeSearchAgent.test.ts` | estimateCost uses calculateLLMCost (changes when pricing changes) |
| 5 | `sectionDecompositionAgent.test.ts` | estimateCost uses calculateLLMCost |
| 5 | `*Agent.test.ts` | light agents estimateCost returns 0 |
| 5 | `costEstimator.test.ts` | flowCritique uses generationModel |

### Integration Tests
- Mock evolution pipeline with gpt-5-nano judge: budget stays within cap
- Pipeline with overflow flag: subsequent agents get BudgetExceededError
- llmCallTracking inserts succeed when env vars are present

### Manual Verification (Production)
- After Phase 1+2: run $0.05 budget with gpt-5-nano judge, verify stays within budget
- After Phase 4: verify `llmCallTracking` has rows after a production run
- Query `evolution_budget_events`: reserve/spend ratios should improve toward 1.0x

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - primary target: add estimation system deep dive
- `evolution/docs/evolution/reference.md` - budget cap configuration, new overflow behavior
- `evolution/docs/evolution/architecture.md` - pipeline cost flow with overflow flag
- `evolution/docs/evolution/data_model.md` - cost tracking tables and their status
- `evolution/docs/evolution/rating_and_comparison.md` - comparison types and token profiles
