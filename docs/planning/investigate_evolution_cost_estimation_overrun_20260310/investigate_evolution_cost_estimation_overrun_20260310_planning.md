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

**File:** `evolution/src/lib/types.ts` (CostTracker interface, line 474)

Add `isOverflowed` to the interface so consumers (typed as `CostTracker`, not `CostTrackerImpl`) can access the flag:
```typescript
export interface CostTracker {
  // ... existing methods ...
  /** True after recordSpend detects totalSpent > budgetCapUsd. */
  isOverflowed: boolean;
}
```

**Note:** All test mocks that implement `CostTracker` (in llmClient.test.ts, tournament.test.ts, etc.) will need to add `isOverflowed: false` to their mock factory. Update `makeMockCostTracker()` in each test file.

**Why not throw in recordSpend:** We already paid for the LLM call. Throwing would discard the response. Instead, we flag the overflow and block all future reservations.

**Note on single-threading:** The `budgetOverflowed` flag has no race conditions because Node.js is single-threaded. The flag is set synchronously in `recordSpend()` and checked synchronously in `reserveBudget()`.

#### 1b. Add mid-round budget check to tournament

**File:** `evolution/src/lib/agents/tournament.ts`

Insert between the `totalComparisons >= maxComparisons` check (line 263) and the `swissPairing()` call (line 269):
```typescript
// Check remaining budget between rounds — complements the existing budgetPressure
// calculation (line 222-224) which adjusts maxComparisons adaptively. This is a hard
// cutoff to prevent firing another batch of parallel comparisons when budget is nearly gone.
const remainingBudgetUsd = ctx.costTracker.getAvailableBudget();
if (remainingBudgetUsd < ctx.payload.config.budgetCapUsd * 0.05) {
  exitReason = 'budget';
  break;
}
```

**Relationship with existing budgetPressure:** The tournament already calculates `budgetPressure` at entry (line 222) and uses it to pick `maxComparisons` (40/25/15). But this is computed once at tournament start. The new check re-evaluates between rounds after actual spend is recorded, providing a hard cutoff at 5% remaining. This is complementary, not duplicative.

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
- `stops between rounds when available budget < 5% of cap` — requires mock `getAvailableBudget()` to return decreasing values across rounds (use jest.fn().mockReturnValueOnce() chain)

**Existing test updates:**
- Update `makeMockCostTracker()` in all test files to include `isOverflowed: false`

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

**Update existing test:**
- `comparison taskType uses fixed 150 output tokens` → replace with subtype-aware tests below

New tests:
- `estimateTokenCost returns 10 output tokens for simple comparison`
- `estimateTokenCost returns 50 output tokens for structured comparison`
- `estimateTokenCost returns 150 output tokens for flow comparison`
- `estimateTokenCost returns 50 output tokens for comparison with no subtype (default)`
- `estimateTokenCost for gpt-5-nano simple comparison is within 2x of actual cost` (use known production budget_events data: ~$0.000015 per simple comparison for gpt-5-nano)

---

### Phase 3: Fix Text Length Scaling (P1)
**Goal:** Account for variant growth and short seed articles.

#### 3a. Pass actual text length at queue time

**File:** `evolution/src/services/evolutionActions.ts`

There are TWO text length paths in this file:

1. **`estimateRunCostAction` (lines 81-132)** — standalone action for UI cost preview. Already correctly uses `input.textLength` with fallback to 5000 and clamp to 100-100000. **No change needed.**

2. **`queueEvolutionRunAction` (lines 136-260)** — queues a run and estimates cost at line 201. Passes hardcoded `5000`. This function only has `explanationId` or `promptId` — no text content is available in scope.

**Fix:** Fetch the text length from the explanation row (already have `supabase` and `explanationId`). Add before the cost estimation block (line 189):
```typescript
// Fetch actual text length for cost estimation (default 5000 for prompt-based runs)
let textLengthForEstimate = 5000;
if (input.explanationId) {
  const { data: explanation } = await supabase
    .from('explanations')
    .select('content')
    .eq('id', input.explanationId)
    .single();
  if (explanation?.content) {
    textLengthForEstimate = Math.max(100, Math.min(explanation.content.length, 100000));
  }
}
```

Then replace line 201's hardcoded `5000` with `textLengthForEstimate`.

For prompt-based runs (no explanation), 5000 remains a reasonable default since prompt runs generate text from scratch.

#### 3b. Add iteration growth factor to central estimator

**File:** `evolution/src/lib/core/costEstimator.ts`

In `estimateRunCostWithAgentModels()`, for agents that scale with variant text, apply growth:
```typescript
function estimateTextLengthAtIteration(baseLength: number, iteration: number): number {
  return Math.round(baseLength * Math.pow(1.04, iteration));  // 4% per iteration
}
```

**Implementation note:** The current estimator multiplies per-agent cost by iteration count in a single expression (e.g., `* expansionIters`). To apply per-iteration growth, restructure text-scaling agents to sum across iterations:
```typescript
// Instead of: agentCost * iterations
// Use: sum(i=0..iterations-1) { estimateAgentCost(agent, model, estimateTextLengthAtIteration(baseLength, i), callsPerIter) }
```
This affects agents whose cost scales with text length (generation, reflection, iterativeEditing, treeSearch, sectionDecomposition). Non-text-scaling agents (tournament, calibration, pairwiseRanker) can keep the flat multiply.

#### 3c. Fix call count mismatches in central estimator

**File:** `evolution/src/lib/core/costEstimator.ts`

The central estimator hardcodes call counts that don't match config or reality:

| Agent | Currently | Should Be |
|-------|-----------|-----------|
| calibration (expansion) | `3 * 3 * 2 = 18` | `config.calibration.opponents * newEntrants * 2` |
| calibration (competition) | `3 * 5 * 2 = 30` | `config.calibration.opponents * newEntrants * 2` |
| treeSearch | `33 gen + 33 judge` | `K*B*D gen + K*(D-1) re-crit + 30*D eval` (from BeamSearchConfig defaults) |
| tournament | `25 * 2 = 50` | Budget-pressure-dependent (use medium tier: `25 * 2` as default) |

Read call counts from config where available instead of hardcoding.

#### 3d. Tests

**File:** `evolution/src/lib/core/costEstimator.test.ts`

- `estimateTextLengthAtIteration grows 4% per iteration`
- `estimateRunCostWithAgentModels accounts for text growth across 15 iterations`
- `calibration call count uses config.calibration.opponents` — test setup must supply config with `calibration.opponents` value
- `treeSearch call count uses BeamSearchConfig defaults` — verify against default K/B/D values

**Note:** Existing costEstimator tests mock Supabase for baseline lookups. When call counts start reading from config, test setup must supply config values (currently tests use default config which should match the existing hardcoded values).

---

### Phase 4: Fix Tracking Failures (P1)
**Goal:** Restore the feedback loop so baselines can be populated.

#### 4a. Add env var validation to evolution runner

The minicomputer uses a systemd service (`evolution/deploy/evolution-runner.service`) that runs `npx tsx evolution/scripts/evolution-runner.ts`. There is no shell wrapper script — env vars are loaded via `EnvironmentFile=/opt/explainanything/.env.local` and `.env.evolution-prod`.

**File:** `evolution/scripts/evolution-runner.ts`

Add env var check at the top of the runner script (before any DB operations):
```typescript
const REQUIRED_ENV_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'];
for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    console.error(`FATAL: ${envVar} not set. LLM call tracking will silently fail.`);
    process.exit(1);
  }
}
```

This catches missing env vars at runner startup instead of silently failing per-call inside `saveLlmCallTracking()`.

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

Add a **module-level** counter (must persist across calls, not local to the catch block):
```typescript
// Module-level — persists across all calls within the process
let trackingFailureCount = 0;

// In saveTrackingAndNotify() catch block:
trackingFailureCount++;
if (trackingFailureCount <= 3) {
  logger.error('LLM call tracking save failed (non-fatal)', { error: trackingError, count: trackingFailureCount });
}
if (trackingFailureCount === 3) {
  logger.error('LLM call tracking has failed 3 times — feedback loop is broken. Check SUPABASE_SERVICE_ROLE_KEY.');
}
```
This counter is intentionally global (not per-request) — if tracking fails for any call, the system should alert after 3 failures regardless of which requests triggered them.

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

Same pattern — replace hardcoded `$0.80/$4.0` (gen) and `$0.10` (judge — **note: output cost $0.40 is missing, 80% underestimate**) with `calculateLLMCost()` calls using the actual configured models.

#### 5b. Fix incomplete judge cost in iterativeEditing and sectionDecomposition

Both agents have the same bug at their judge cost line:
```typescript
// BEFORE (missing output cost):
const judgeCost = ((diffLen + 300) / 4 / 1_000_000) * 0.10;

// AFTER (using canonical pricing):
const judgeCostPerCall = calculateLLMCost(judgeModel, (diffLen + 300) / 4, 50);
```

This is fixed automatically when 5a is implemented (replacing hardcoded rates with `calculateLLMCost()`), but must be verified in testing.

#### 5c. Remove dead estimateCost() bodies from light agents

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

#### 5d. Investigate flowCritique model usage

**File:** `evolution/src/lib/core/costEstimator.ts` (line 276)

The estimator uses `getModel('flowCritique', true)` (judgeModel). The source comment at line 272-273 says: *"Uses judge model since flowCritique runs compareFlowWithBiasMitigation (2-pass judge LLM calls)"*.

**Action:** Verify which model flowCritique actually uses at runtime before changing. If `compareFlowWithBiasMitigation` genuinely uses the judge model for its LLM calls, then `getModel('flowCritique', true)` is correct and no change is needed. Read `compareFlowWithBiasMitigation()` to confirm which model it passes. Only change to `getModel('flowCritique', false)` if the comparison function uses `generationModel`.

#### 5e. Fix UI model selector desync

Create shared utility that reads from schema source of truth:
```typescript
// src/lib/utils/modelOptions.ts
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
export const MODEL_OPTIONS = allowedLLMModelSchema.options;
```

Update 4 UI files to import from this shared utility:
- `src/app/admin/evolution/analysis/_components/runFormUtils.ts`
- `src/app/admin/evolution/strategies/page.tsx`
- `src/app/admin/evolution/arena/page.tsx` (replace hardcoded `<option>` tags)
- `src/app/admin/evolution/arena/[topicId]/page.tsx` (replace hardcoded `<option>` tags)

#### 5f. Fix run-evolution-local.ts dual-path bug

Delete the local `estimateTokenCost()` function (lines 196-205) and use `calculateLLMCost()` from the canonical import that already exists (line 22).

#### 5g. Tests

- `treeSearchAgent.estimateCost uses calculateLLMCost (changes when model pricing changes)`
- `sectionDecompositionAgent.estimateCost uses calculateLLMCost`
- `sectionDecompositionAgent.estimateCost includes output cost for judge calls`
- `light agents estimateCost returns 0`
- `flowCritique estimation uses correct model` (pending 5d investigation)
- `MODEL_OPTIONS matches allowedLLMModelSchema.options`

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
| 3 | `costEstimator.test.ts` | calibration call count reads from config.calibration.opponents |
| 3 | `costEstimator.test.ts` | treeSearch call count uses BeamSearchConfig defaults |
| 4 | `evolution-runner.test.ts` | exits with error when SUPABASE_SERVICE_ROLE_KEY missing |
| 4 | `llms.test.ts` | saveLlmCallTracking skips when env var missing |
| 4 | `llms.test.ts` | tracking failure counter logs escalation at count 3 |
| 5 | `treeSearchAgent.test.ts` | estimateCost uses calculateLLMCost (changes when pricing changes) |
| 5 | `sectionDecompositionAgent.test.ts` | estimateCost uses calculateLLMCost, includes judge output cost |
| 5 | `*Agent.test.ts` | light agents estimateCost returns 0 |
| 5 | `costEstimator.test.ts` | flowCritique uses correct model (pending 5d investigation) |
| 5 | `modelOptions.test.ts` | MODEL_OPTIONS matches allowedLLMModelSchema.options |

### Integration Tests
- Mock evolution pipeline with gpt-5-nano judge: budget stays within cap
- Pipeline with overflow flag: subsequent agents get BudgetExceededError
- llmCallTracking inserts succeed when env vars are present

### Manual Verification (Production)
- After Phase 1+2: run $0.05 budget with gpt-5-nano judge, verify stays within budget
- After Phase 4: verify `llmCallTracking` has rows after a production run
- Query `evolution_budget_events`: reserve/spend ratios should improve toward 1.0x

### Rollback Plan

Each phase is independently deployable and revertable:
- **Phase 1:** `git revert` the overflow flag commit. Budget enforcement reverts to pre-fix behavior (reserveBudget still catches most overruns, just not mid-spend ones).
- **Phase 2:** `git revert` the comparisonSubtype commit. Falls back to 150-token default for all comparisons (over-reserves but doesn't break).
- **Phase 3:** `git revert` text length and call count changes. Estimation accuracy degrades but pipeline still runs.
- **Phase 4:** `git revert` env var check. Tracking silently fails again but pipeline runs unaffected.
- **Phase 5:** Each sub-step (5a-5f) can be independently reverted. Agent `estimateCost()` returning 0 has no production impact since the central estimator handles pre-run estimation.

No database migrations are involved in any phase.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - primary target: add estimation system deep dive
- `evolution/docs/evolution/reference.md` - budget cap configuration, new overflow behavior
- `evolution/docs/evolution/architecture.md` - pipeline cost flow with overflow flag
- `evolution/docs/evolution/data_model.md` - cost tracking tables and their status
- `evolution/docs/evolution/rating_and_comparison.md` - comparison types and token profiles
