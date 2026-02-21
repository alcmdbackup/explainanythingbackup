# Consolidate LLM Infrastructure Plan

## Background
The codebase routes all LLM API calls through a single function `callOpenAIModel` in `src/lib/services/llms.ts`. The evolution pipeline wraps this function with its own `EvolutionLLMClient` in `src/lib/evolution/core/llmClient.ts` to add budget enforcement. A standalone CLI script (`scripts/run-evolution-local.ts`) has a third, fully independent LLM client implementation because it can't import the Next.js-dependent central service. All three maintain separate copies of model pricing data.

## Problem
1. **`callOpenAIModel` returns only `string`**, hiding token counts and cost metadata from callers. The evolution wrapper can't call `costTracker.recordSpend()` with actual API costs, so `recordSpend()` is dead code in production. Budget tracking runs on heuristic estimates (chars/4 = tokens, 50% output ratio, +30% margin), and `evolution_runs.total_cost_usd` reflects these estimates rather than real costs.
2. **Three duplicate pricing tables** exist (`llmPricing.ts` with 26 models, `llmClient.ts` with 6, `run-evolution-local.ts` with 2 inline), all using slightly different formats. Any pricing change must update all three.
3. **The function name `callOpenAIModel` is misleading** — it routes to both OpenAI and DeepSeek, and the codebase will likely add more providers. 25 files import this name.

## Options Considered

### Option A: Expand return type to object
Change `callOpenAIModel` to return `{ text: string; usage: UsageMetadata }` instead of `string`. Most complete solution, but requires updating all 13 production callers and 12 test mocks to destructure the result.

### Option B: Add `onUsage` callback (Recommended)
Add an optional callback parameter. Existing callers don't pass it (backward-compatible). Evolution wrapper passes a callback that calls `recordSpend()`. Zero changes to main-site callers.

### Option C: Create a new function `callLLMWithMetadata`
Keep `callOpenAIModel` unchanged, add a sibling function that returns metadata. Two functions doing the same thing — maintenance burden.

### Option D: Post-call DB query
Have the evolution wrapper query `llmCallTracking` after each call to get actual costs. Adds latency and a DB round-trip per LLM call — unacceptable for the evolution pipeline which makes 20-40+ calls per run.

**Decision: Option B** — `onUsage` callback. It follows the existing pattern (`setText` callback for streaming) and is fully backward-compatible. The rename is bundled as a separate mechanical phase since it's pure find-and-replace.

## Phased Execution Plan

### Phase 1: Add `onUsage` callback to central service
**Goal**: Enable callers to receive actual cost metadata without changing the return type.

**Files modified**:
- `src/lib/services/llms.ts`

**Changes**:
1. Define the callback type:
```typescript
export interface LLMUsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  model: string;
}
```
2. Add optional `onUsage?: (usage: LLMUsageMetadata) => void` as the 10th parameter of `callOpenAIModel` (the function currently has 9 params: prompt through debug). This is backward-compatible because all existing callers pass 6-9 positional args and TypeScript treats trailing optional params as safe to omit.
3. After the `await saveLlmCallTracking(trackingData)` call completes (currently at line 299), invoke the callback **wrapped in try-catch** so a callback error never breaks the core LLM response:
```typescript
if (onUsage) {
  try {
    onUsage({
      promptTokens,
      completionTokens,
      totalTokens: usage.total_tokens ?? 0,
      reasoningTokens,
      estimatedCostUsd: trackingData.estimated_cost_usd ?? 0,
      model: modelUsed,
    });
  } catch (callbackError) {
    logger.error('onUsage callback failed', {
      error: callbackError instanceof Error ? callbackError.message : String(callbackError),
      call_source,
    });
  }
}
```
4. The `withLogging` wrapper (`withServerLogging` in `automaticServerLoggingBase.ts:123`) uses `(...args: Parameters<T>)` spread — it already forwards all params. No changes needed to the wrapper itself.

**Tests**: Add tests in `llms.test.ts` inside the existing `callOpenAIModel` describe block:
- `'invokes onUsage callback with correct token metadata after non-streaming call'`
- `'invokes onUsage callback after streaming call'`
- `'does not invoke onUsage callback when API call throws'`
- `'does not throw when onUsage callback is omitted (backward compat)'`
- `'swallows onUsage callback errors without breaking the response'`

**Verification**: `npm run lint && npx tsc --noEmit && npm run build && npm test`

### Phase 2: Wire evolution wrapper to use actual costs (BUG FIX)
**Goal**: Make `recordSpend()` work in production. Delete duplicate pricing. **Fix 1000x cost underestimation bug.**

**Bug**: `llmClient.ts` `MODEL_PRICING` stores values like `0.00014` (deepseek-chat input) which are per-token costs, but `estimateTokenCost()` divides by `1_000_000` as if they were per-1M-token costs. The correct per-1M value is `0.14` (from `llmPricing.ts`). Result: budget estimates are ~1000x too low, so the `$5` budget cap is effectively never enforced. This phase fixes cost estimation by switching to `getModelPricing()` from `llmPricing.ts` (correct per-1M values) AND wires actual API costs via the `onUsage` → `recordSpend()` callback.

**Files modified**:
- `src/lib/evolution/core/llmClient.ts`
- `src/lib/evolution/types.ts` (no change needed — `EvolutionLLMClient` interface stays the same)

**Changes to `llmClient.ts`**:
1. Delete the `MODEL_PRICING` constant (lines 14-21)
2. Rewrite `estimateTokenCost()` to use `getModelPricing()` from `src/config/llmPricing.ts`:
```typescript
import { getModelPricing } from '@/config/llmPricing';

export function estimateTokenCost(prompt: string, model?: string): number {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5);
  const pricing = getModelPricing(model ?? EVOLUTION_DEFAULT_MODEL);
  return (
    (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M
  );
}
```
3. In both `complete()` and `completeStructured()`, pass an `onUsage` callback to `callOpenAIModel` that calls `costTracker.recordSpend()`:
```typescript
const result = await callOpenAIModel(
  prompt,
  `evolution_${agentName}`,
  userid,
  model,
  false,
  null,
  null,
  null,
  options?.debug ?? false,
  (usage) => {
    costTracker.recordSpend(agentName, usage.estimatedCostUsd);
  },
);
```

**Agent impact**: Zero. Agents call `ctx.llmClient.complete()` — the interface is unchanged.

**Tests**: Create new test file `src/lib/evolution/core/llmClient.test.ts` (does not exist yet):
- `'calls recordSpend with actual cost from onUsage callback'` — mock `callOpenAIModel` to trigger the onUsage callback with known token counts, verify `costTracker.recordSpend(agentName, expectedCost)` is called
- `'estimateTokenCost uses getModelPricing from llmPricing.ts'` — verify estimate matches manual calculation using `getModelPricing('deepseek-chat')`
- `'complete() still works when recordSpend throws'` — verify LLM response is returned even if budget tracking fails (try-catch in Phase 1 protects this)
- `'completeStructured() passes onUsage callback through to callOpenAIModel'`

Also verify with `grep -r "MODEL_PRICING" src/lib/evolution/` that no references remain after deletion.

**Verification**: `npm run lint && npx tsc --noEmit && npm run build && npm test`

### Phase 3: Rename `callOpenAIModel` → `callLLM`
**Goal**: Accurate naming since the function routes to multiple providers.

This is a mechanical find-and-replace across 25 files. No logic changes.

**Files modified** (25 total):

*Definition*:
- `src/lib/services/llms.ts` — rename internal function, update `withLogging` call name string, update export alias

*Production callers (13)*:
- `src/lib/services/returnExplanation.ts`
- `src/lib/services/tagEvaluation.ts`
- `src/lib/services/importArticle.ts`
- `src/lib/services/findMatches.ts`
- `src/lib/services/links.ts`
- `src/lib/services/linkWhitelist.ts`
- `src/lib/services/sourceSummarizer.ts`
- `src/lib/services/contentQualityCompare.ts`
- `src/lib/services/contentQualityEval.ts`
- `src/lib/services/explanationSummarizer.ts`
- `src/editorFiles/actions/actions.ts`
- `src/app/api/stream-chat/route.ts`
- `src/actions/actions.ts`

*Evolution wrapper (1)*:
- `src/lib/evolution/core/llmClient.ts`

*Test files (12)*:
- `src/lib/services/llms.test.ts`
- `src/lib/services/tagEvaluation.test.ts`
- `src/lib/services/importArticle.test.ts`
- `src/lib/services/findMatches.test.ts`
- `src/lib/services/links.test.ts`
- `src/lib/services/linkWhitelist.test.ts`
- `src/lib/services/contentQualityCompare.test.ts`
- `src/lib/services/contentQualityEval.test.ts`
- `src/lib/services/explanationSummarizer.test.ts`
- `src/lib/services/returnExplanation.test.ts`
- `src/editorFiles/actions/actions.test.ts`
- `src/app/api/stream-chat/route.test.ts`

*Integration test (1)*:
- `src/__tests__/integration/streaming-api.integration.test.ts`

**Approach**:
1. In `llms.ts`:
   - Rename the internal function: `async function callOpenAIModel(` → `async function callLLM(`
   - Rename the wrapper variable: `const callOpenAIModelWithLogging = withLogging(callOpenAIModel, 'callOpenAIModel', {` → `const callLLMWithLogging = withLogging(callLLM, 'callLLM', {`
   - Update the export: `export { callLLMWithLogging as callLLM };`
   - Also rename constants: `default_model` → `DEFAULT_MODEL`, `lighter_model` → `LIGHTER_MODEL`
2. Update all 13 production callers: change `import { callOpenAIModel` → `import { callLLM` and all call sites
3. Update all 12 test file imports: change `import { callOpenAIModel` → `import { callLLM`
4. **Update jest.mock bodies in all 12 test files**: where mocks reference `callOpenAIModel` in their factory function or `mockReturnValue` calls, rename to `callLLM`. For example:
   ```typescript
   // Before:
   jest.mock('./llms', () => ({ callOpenAIModel: jest.fn() }));
   (callOpenAIModel as jest.Mock).mockResolvedValue('...');

   // After:
   jest.mock('./llms', () => ({ callLLM: jest.fn() }));
   (callLLM as jest.Mock).mockResolvedValue('...');
   ```
   Note: The `jest.mock()` path strings (e.g., `'@/lib/services/llms'`, `'./llms'`) do NOT change — only the exported symbol name inside the mock.
5. Update the integration test: `src/__tests__/integration/streaming-api.integration.test.ts`
6. Update `default_model` → `DEFAULT_MODEL` and `lighter_model` → `LIGHTER_MODEL` across all importing files

**Tests**: All existing tests pass with renamed imports. No new test logic needed — this is purely mechanical.

**Verification**: `npm run lint && npx tsc --noEmit && npm run build && npm test`

### Phase 4: Fix agent `costUsd` reporting
**Goal**: Agents report actual costs in `AgentResult` instead of hardcoded `0`.

**Files modified**:
- `src/lib/evolution/agents/generationAgent.ts`
- `src/lib/evolution/agents/evolvePool.ts`
- `src/lib/evolution/agents/calibrationRanker.ts`
- `src/lib/evolution/agents/pairwiseRanker.ts`
- `src/lib/evolution/agents/tournament.ts`
- `src/lib/evolution/agents/reflectionAgent.ts`

**Changes**: In each agent's `execute()` method, replace `costUsd: 0` with:
```typescript
costUsd: ctx.costTracker.getAgentCost(this.name),
```

This works because Phase 2 wired `recordSpend()` to the callback, so `getAgentCost()` now returns real values.

**Tests**: Update agent tests. Each agent test uses a `makeMockCostTracker()` helper that returns `getAgentCost: () => 0`. To test actual cost reporting:
- Update `makeMockCostTracker()` to accept an optional `agentCosts` map, defaulting to `new Map()`
- Wire `recordSpend` mock to update the map: `recordSpend: jest.fn((name, cost) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); })`
- Wire `getAgentCost` mock to read: `getAgentCost: jest.fn((name) => agentCosts.get(name) ?? 0)`
- In tests that assert `costUsd`, call the agent's execute() with the wired mock and verify `result.costUsd > 0`

Agent test files to update:
- `src/lib/evolution/agents/generationAgent.test.ts`
- `src/lib/evolution/agents/evolvePool.test.ts`
- `src/lib/evolution/agents/calibrationRanker.test.ts`
- `src/lib/evolution/agents/pairwiseRanker.test.ts`
- `src/lib/evolution/agents/tournament.test.ts`
- `src/lib/evolution/agents/reflectionAgent.test.ts`

**Verification**: `npm run lint && npx tsc --noEmit && npm run build && npm test`

## Rollback Plan

Each phase is independently committable and revertable:
- **Phase 1**: Revert the callback addition — all existing callers are unaffected since they don't pass the parameter
- **Phase 2**: Revert llmClient.ts to use inline pricing and estimate-only budget tracking (restore `MODEL_PRICING`, remove `onUsage` callback from calls). Evolution pipeline reverts to pre-change behavior.
- **Phase 3**: `git revert` the rename commit. Purely mechanical — no logic to unwind.
- **Phase 4**: Revert `costUsd` lines back to `0`. No downstream impact.

If a phase breaks on staging, revert that commit only. Later phases depend on earlier ones, so reverting Phase 1 requires also reverting Phases 2-4.

## Out of Scope

- **CLI script** (`scripts/run-evolution-local.ts`): It bypasses `callOpenAIModel` due to Next.js import chain issues. Fixing that requires extracting the OpenAI client initialization into a framework-agnostic module — a separate project.
- **Refactoring positional params to options object**: The function has 10 positional params now. Worth doing eventually, but it touches all 25 files with logic changes (not just rename). Separate project.
- **Adding new LLM providers**: The `isDeepSeekModel()` routing is simple enough for 2 providers. A provider abstraction layer isn't needed until a 3rd provider is added.

## Testing

### Unit tests to write or modify
| File | Changes |
|------|---------|
| `src/lib/services/llms.test.ts` | Add 5 tests: callback with correct metadata (non-streaming), callback after streaming, no callback on API error, backward compat when omitted, callback error swallowed |
| `src/lib/evolution/core/llmClient.test.ts` | **Create new file.** Add 4 tests: recordSpend via callback, estimateTokenCost with getModelPricing, complete works when recordSpend throws, completeStructured passes callback |
| Agent test files (6) | Update `makeMockCostTracker()` to wire recordSpend→getAgentCost, assert `costUsd > 0` |

### Manual verification on stage
1. Trigger an explanation generation → verify `llmCallTracking` row has correct `estimated_cost_usd`
2. Trigger an evolution run → verify `evolution_runs.total_cost_usd` matches sum of `llmCallTracking` rows for that run
3. Check `/admin/costs` dashboard still renders correctly
4. Check `/admin/quality/evolution/dashboard` shows per-agent cost breakdowns

## Documentation Updates
- `docs/docs_overall/architecture.md` — Update "Development Essentials > Action Wrapping Pattern" section to reference `callLLM` instead of `callOpenAIModel`
- No new feature deep dive needed — this is infrastructure cleanup, not a new feature
