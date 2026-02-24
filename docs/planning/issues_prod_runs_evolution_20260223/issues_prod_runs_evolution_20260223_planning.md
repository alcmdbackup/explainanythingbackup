# Issues Prod Runs Evolution Plan

## Background
Production evolution run `9dc2ecbf` (and 3 others) are paused with budget exceeded errors for the pairwise agent. All 4 affected runs use `claude-sonnet-4-20250514` as their judge model. Actual spend is under $0.006 but reservation-based "spent" reaches ~$1.00, triggering the pairwise cap.

## Requirements (from GH Issue #540)
- Investigate why run `9dc2ecbf` is paused in production with budget exceeded for pairwise agent
- Identify the root cause in the evolution price refactor
- Fix the bug causing premature budget exhaustion for pairwise comparisons
- Ensure budget enforcement works correctly after the fix

## Problem

Four production evolution runs are paused with `Budget exceeded for pairwise: spent ~$0.98, cap $1.00` despite actual total spend of ~$0.005. The root cause is a cascade of interacting bugs: (1) `estimateTokenCost` in llmClient.ts:20 estimates output tokens at 50% of input tokens, which over-estimates by 250x for comparison calls that output ~10 tokens; (2) with `claude-sonnet-4` pricing ($3/$15 per 1M tokens), each reservation is inflated to ~$0.068 vs actual ~$0.015; (3) Tournament's LLM calls route through PairwiseRanker which charges to agent name `'pairwise'` (pairwiseRanker.ts:174) instead of `'tournament'`, and budget redistribution (budgetRedistribution.ts:22-25) doesn't include `'pairwise'` in MANAGED_AGENTS, so the pairwise cap never gets scaled up when optional agents are disabled.

**Note:** CalibrationRanker is NOT affected by Issue 3. It has its own `compareWithBiasMitigation` that calls `ctx.llmClient.complete(prompt, this.name, ...)` where `this.name='calibration'`, routing costs correctly. It delegates to standalone `comparison.ts`, NOT to PairwiseRanker.

## Options Considered

### Option A: Task-specific output token estimates (Recommended)
Replace the blanket 50%-of-input heuristic in `estimateTokenCost` with task-aware estimates. Comparison calls get a low estimate (~50 tokens), generation calls keep the current heuristic.

- **Pros:** Directly addresses the primary trigger (250x over-estimation), minimal blast radius, backward compatible
- **Cons:** Requires threading a task hint through the estimation path

### Option B: Fix agent name routing so Tournament charges to 'tournament'
Make Tournament pass its own name (`'tournament'`) when calling PairwiseRanker methods, so costs accumulate under the correct (and redistributed) cap.

- **Pros:** Architecturally correct, fixes the mismatch at the source
- **Cons:** Doesn't fix the over-estimation (would still fail with very expensive models), requires changes to PairwiseRanker API

### Option C: Add 'pairwise' to MANAGED_AGENTS
Include `pairwise` in the managed agents set so its cap gets redistributed proportionally.

- **Pros:** Simple one-line fix
- **Cons:** Band-aid — pairwise isn't a real agent in the pipeline, it's an internal implementation detail of Tournament

### Option D: Reduce reservation safety margin
Lower the 30% margin in costTracker.ts:24 to 10% or 0%.

- **Pros:** Quick relief
- **Cons:** Doesn't fix root cause, margin exists for a reason (concurrent calls), risky

### Chosen Approach: A + B (both)

Fix the output estimation (Option A) as the primary fix since it's the direct trigger. Then fix the agent name routing (Option B) as the architectural cleanup to prevent future issues. Option C is unnecessary once B is done. Option D is rejected.

## Phased Execution Plan

### Phase 1: Fix output token over-estimation (PRIMARY)
**Files:** `evolution/src/lib/core/llmClient.ts`, `evolution/src/lib/agents/pairwiseRanker.ts`, `evolution/src/lib/agents/calibrationRanker.ts`, `evolution/src/lib/treeOfThought/beamSearch.ts`

1. Add an optional `taskType` field to `LLMCompletionOptions` interface (types.ts:412-417)
   - Type: `'comparison' | 'generation'`
   - `undefined` (omitted) triggers existing 50%-of-input heuristic — no need for a redundant `'default'` value
   - This ensures taskType flows through `createScopedLLMClient` automatically via the spread operator in llmClient.ts:124-136 (verified: both `complete` and `completeStructured` in the scoped client spread `{ ...options, invocationId }`)

2. Update `estimateTokenCost()` (llmClient.ts:18) to accept `taskType` as an optional third parameter:
   - `'comparison'` → estimate 150 output tokens (structured comparisons output dimension scores + winner + confidence = ~100-150 tokens; simple comparisons output ~10 tokens; 150 is a safe upper bound for both. Note: flow comparisons with friction spot citations may occasionally reach 200-300 tokens for long articles, but 150 is still a 17x improvement over the current ~2,500 estimate and under-reservation is not a hard failure — recordSpend catches it)
   - `'generation'` / `undefined` → keep existing 50%-of-input heuristic (backward compatible — all existing callers that don't pass taskType get unchanged behavior)

3. Update `complete()` (llmClient.ts:48) and `completeStructured()` (llmClient.ts:80) to:
   - Extract `taskType` from the options parameter
   - Pass it through to `estimateTokenCost(prompt, model, taskType)`

4. Update PairwiseRanker call sites to pass `taskType: 'comparison'`:
   - `pairwiseRanker.ts:187` — `comparePair()` LLM call
   - `pairwiseRanker.ts:253` — `comparePairFlow()` LLM call (uses hardcoded `'tournamentFlowComparison'` agent name — taskType fix reduces its reservation inflation too)

5. Update CalibrationRanker's comparison calls:
   - CalibrationRanker delegates to standalone `comparison.ts` which receives a `callLLM: (prompt: string) => Promise<string>` closure.
   - The closure is created in calibrationRanker.ts and wraps `ctx.llmClient.complete(prompt, this.name, options)`.
   - Add `taskType: 'comparison'` to the `options` object in the closure definition. No change needed to the `callLLM` callback signature.

6. Update BeamSearch (treeOfThought/beamSearch.ts) comparison calls:
   - beamSearch.ts has 5 `llmClient.complete` call sites. Only the comparison closures get `taskType: 'comparison'`:
     - **Line 70** — `callDiff` closure (wraps `compareWithDiff`, output ~1 token) → add `taskType: 'comparison'`
     - **Line 74** — `callPairwise` closure (wraps `compareWithBiasMitigation`, output ~10 tokens) → add `taskType: 'comparison'`
     - **Line 312** — inline comparison call → add `taskType: 'comparison'`
     - **Line 203** — revision generation call → do NOT add taskType (this is generation, not comparison)
     - **Line 346** — `runInlineCritique` call (outputs JSON ~100-200 tokens) → do NOT add taskType (this is critique, not comparison; the 50%-of-input heuristic is acceptable here)
   - The closure pattern is the same as CalibrationRanker: add `taskType: 'comparison'` to the options object inside the closure definition

7. Update IterativeEditingAgent and SectionEditRunner comparison calls (lower priority, same pattern):
   - `iterativeEditingAgent.ts:118` — `callLLM` closure for `compareWithDiff()` (output ~1 token ACCEPT/REJECT/UNSURE) → add `taskType: 'comparison'`
   - `sectionEditRunner.ts:69-70` — `callLLM` closure for `compareWithDiff()` (same ~1 token output) → add `taskType: 'comparison'`
   - These agents have their own budget caps (0.05 and 0.10 respectively) and are not the production failure trigger, but with claude-sonnet-4 as judgeModel the same 250x over-estimation applies

8. **Out of scope:** `run-evolution-local.ts` has an inlined `estimateTokenCost` copy with hardcoded deepseek-chat pricing. This is a local dev script only. Document as tech debt, do not fix in this PR.

### Phase 2: Fix agent name routing (ARCHITECTURAL)
**Files:** `evolution/src/lib/agents/pairwiseRanker.ts`, `evolution/src/lib/agents/tournament.ts`

1. Add an optional `agentNameOverride` parameter to PairwiseRanker's `comparePair()`, `compareWithBiasMitigation()`, `comparePairFlow()`, and `compareFlowWithBiasMitigation()` methods
   - When provided, use it instead of `this.name` for LLM calls
   - Default behavior unchanged (standalone pairwise usage still works)

2. In Tournament, pass `this.name` ('tournament') as the override for ALL PairwiseRanker calls:
   - `this.pairwise.compareWithBiasMitigation()` (main ranking path)
   - `this.pairwise.compareFlowWithBiasMitigation()` (flow comparison path, tournament.ts:352)
   - `this.pairwise.comparePair()` (multi-turn tiebreaker path, tournament.ts:192) — this direct call was previously missed and would still route costs to 'pairwise' without the override

3. Fix the hardcoded `'tournamentFlowComparison'` name at pairwiseRanker.ts:253:
   - When `agentNameOverride` is provided, use it (e.g., `'tournament'`) — this routes flow comparison costs to the correct tournament budget
   - When no override (standalone PairwiseRanker.execute()), use `this.name` ('pairwise') for consistency — the standalone pairwise agent should charge to its own cap
   - Remove the orphaned `'tournamentFlowComparison'` agent name entirely; it has no budget cap in config.ts and silently falls through to the 0.20 default in costTracker.ts:25

4. **Note:** CalibrationRanker does NOT need agent name routing changes — it already routes costs correctly to `'calibration'` via its own `this.name`.

### Phase 3: Retry affected production runs
1. After deploying fixes, manually resume the 4 paused runs via the admin API or direct DB update
2. Monitor that they complete within budget
3. Verify in the budget tab that tournament costs now show non-zero (previously always $0 due to name mismatch)

## Testing

### Unit Tests

1. **`llmClient.test.ts`** — Test `estimateTokenCost` with different task types:
   - `'comparison'` returns ~150 output tokens regardless of input size
   - `'generation'` / `undefined` returns 50%-of-input (existing behavior preserved)
   - Verify total cost calculation with `claude-sonnet-4` pricing ($3/$15 per 1M tokens)
   - Verify total cost calculation with `gpt-4.1-nano` pricing ($0.10/$0.40 per 1M tokens)
   - Verify with unknown model → DEFAULT_PRICING ($10/$30 per 1M tokens) — comparison calls with unknown models must still produce sane reservations

2. **`llmClient.test.ts`** — Backward compatibility regression tests:
   - Call `estimateTokenCost(prompt, model)` WITHOUT `taskType` parameter — must match current behavior exactly (50%-of-input heuristic)
   - Existing test at llmClient.test.ts:54-67 must continue to pass unchanged
   - Pin the exact dollar amounts for `undefined` (default) behavior to detect accidental changes

3. **`costTracker.test.ts`** — Test that reservation amounts with comparison task type don't exceed agent cap:
   - Simulate 14 concurrent comparison reservations with `claude-sonnet-4` pricing and `taskType: 'comparison'` output estimate
   - Verify they stay within $1.00 pairwise cap (was ~$0.95, should now be ~$0.30)
   - Also simulate with `gpt-4.1-nano` pricing — verify no change in behavior for default model runs

4. **`costTracker.test.ts`** — End-to-end reservation flow:
   - Feed `estimateTokenCost(prompt, model, 'comparison')` output directly into `reserveBudget(agentName, estimatedCost)`
   - Verify the full chain produces correct reservation amounts (not just unit-tested in isolation)

5. **`pairwiseRanker.test.ts`** — Test agent name override AND taskType propagation:
   - Mock `ctx.llmClient.complete` and verify both the second argument (agent name) AND third argument options contain `taskType: 'comparison'`:
     - Without override: agent name is `'pairwise'`, options include `taskType: 'comparison'`
     - With override `'tournament'`: agent name is `'tournament'`, options include `taskType: 'comparison'`
   - Test `comparePairFlow` similarly — verify `'tournamentFlowComparison'` is replaced by override
   - Test `compareFlowWithBiasMitigation` propagates override correctly

6. **`llmClient.test.ts`** — Test taskType propagation through `createScopedLLMClient`:
   - Existing tests at llmClient.test.ts:148-199 verify `invocationId` passthrough
   - Add test: `{ taskType: 'comparison', invocationId: 'inv-1' }` should merge correctly in the spread

7. **`calibrationRanker.test.ts`** — Test taskType in comparison closure:
   - Verify the `callLLM` closure passes `taskType: 'comparison'` to `ctx.llmClient.complete`

8. **`beamSearch.test.ts`** — Test taskType for comparison vs non-comparison calls:
   - Verify comparison closures (lines 70, 74, 312) pass `taskType: 'comparison'`
   - Verify generation call (line 203) and critique call (line 346) do NOT pass `taskType: 'comparison'`

9. **`budgetRedistribution.test.ts`** — Regression check:
   - Verify existing tests pass unchanged (no modifications to this file)
   - Add assertion documenting that `'pairwise'` is NOT in MANAGED_AGENTS (it was never included; Phase 2's name routing fix makes this fact harmless since Tournament costs now charge to `'tournament'` which IS in MANAGED_AGENTS)

### Integration Tests

10. **`pipeline.test.ts`** — End-to-end test with `claude-sonnet-4` as judgeModel:
    - Update mock pricing in the test to include `claude-sonnet-4-20250514` at $3.00/$15.00 per 1M tokens (current mocks only have deepseek/gpt-4.1-mini pricing)
    - Use a real `CostTrackerImpl` instance (not a mock) for at least one test to exercise the full `estimateTokenCost → reserveBudget` chain
    - Run a minimal evolution (2 variations, 1 iteration) with `claude-sonnet-4` mock pricing
    - Verify Tournament phase completes without budget exceeded error
    - Verify costs attribute to correct agent name (`'tournament'` after Phase 2)

11. **`pipeline.test.ts`** — Regression test with default model:
    - Run same minimal evolution with `gpt-4.1-nano` mock pricing
    - Verify behavior is unchanged from before the fix (no regression for the 95%+ of runs using cheap models)

### Manual Verification

12. Deploy to staging, trigger an evolution run with `claude-sonnet-4` as judge model
13. Verify run completes, check cost tracking in the budget tab
14. Verify tournament agent shows non-zero cost (was always $0 before Phase 2)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` — Update cost estimation section to document task-specific output estimates and the `taskType` parameter
- `evolution/docs/evolution/reference.md` — Update budget caps section to clarify that Tournament costs route through its own agent name after this fix
- `evolution/docs/evolution/rating_and_comparison.md` — Update pairwise comparison section to reflect agent name routing fix

## Risk Assessment

- **Phase 1 risk: LOW** — Output estimation is conservative by design; reducing it for comparison calls only affects reservation size, not actual spend tracking. Worst case: a reservation is too small, and actual spend slightly exceeds it (caught by recordSpend, not a hard failure). The `taskType` parameter is optional with `undefined` defaulting to existing behavior, so all existing callers are backward compatible.
- **Phase 2 risk: LOW** — Agent name override is backward compatible (default = existing behavior). Tournament already has its own budget cap which gets redistributed. Note: existing production tournament cost data shows $0 due to the name mismatch — this is a pre-existing data integrity issue that Phase 2 corrects going forward but does not backfill.
- **Rollback:** Both phases are independently deployable. If Phase 2 causes issues, Phase 1 alone is sufficient to unblock production runs. To rollback Phase 1 itself: revert the commit. Paused runs would need to be manually re-queued, or their budget caps increased via admin API to work around the estimation issue temporarily.

## Known Limitations / Tech Debt
- `run-evolution-local.ts` has an inlined copy of `estimateTokenCost` with hardcoded pricing — will not benefit from the `taskType` fix. Low priority since it's local-dev only.
- `'proximity'` agent is in REQUIRED_AGENTS (budgetRedistribution.ts:11) but has no budget cap in config.ts:21-34. Pre-existing issue, not related to this fix.
- Historical tournament cost data shows $0 in production. Phase 2 corrects this going forward but does not backfill.
