# Further Speedup Research

## Problem Statement
This project encompasses several improvements to the evolution pipeline: recovering and documenting research from a crashed branch about judging accuracy, adding timeline visualization for generate_from_seed_article invocations, debugging slow Qwen judge model performance, clarifying the budget buffer parameter naming, and configuring thinking mode for the OSS 20B model to improve speed.

## Requirements (from GH Issue #965)
- Pull in the research and planning documents from branch feat/estimate_match_noise_evolution_20260411 - some progress on this branch was lost when my minicomputer crashed. Compare that implementation to the implementation of feat/improve_setup_judging_20260412, which was recreated from memory and then merged, so see if there are any notable differences.
- Also, please copy in the research doc from feat/estimate_match_noise_evolution_20260411, take the key findings and populate them in a docs/research/judging_accuracy_20260412.md for future reference on judges
- Help me add a "timeline" view, similar to what we have for a run, for the invocations of generate_from_seed_article, so I can see why it is taking a certain amount of time to finish
- Debug why judge model for QWEN is so slow. Verify that it was the model called on Run 4133123e-c9fa-4c52-9289-26dcfb95ce61 in staging. See why it isn't faster than OSS 20B. Test both those models side-by-side locally using a script, and see how their response times compare.
- Check for me how our Budget Buffer After Parallel (0-1) value is used. Rename if needed to make it more clear.
- Use web docs to disable thinking mode or put it into "low" thinking mode for OSS 20B model, wherever it is used. Run tests to verify this makes a difference.

## High Level Summary

Six workstreams investigated across 4 rounds of 4 parallel research agents each. Key findings:

1. **Lost branch unrecoverable** — `feat/estimate_match_noise_evolution_20260411` does not exist on any remote or reflog. The merged `feat/improve_setup_judging_20260412` contains the recreated implementation (model registry, beta=0, temperature, 3 new models). Research doc exists but has no explicit accuracy measurements — findings are about cost/convergence, not judge quality metrics.

2. **Invocation timeline is feasible** but requires timing instrumentation — per-comparison `durationMs` is not currently captured. The execution_detail has rich comparison data (round, outcome, mu/sigma changes) but no timestamps per comparison. 6 specific instrumentation points identified.

3. **Qwen thinking mode is the likely cause of slowness** — both `qwen/qwen3-8b` and `gpt-oss-20b` route through OpenRouter. Qwen3 has thinking mode ON by default. OSS 20B has mandatory reasoning. Neither has reasoning config in the codebase. OpenRouter's `reasoning` API parameter can control this.

4. **Budget buffer naming IS misleading** — they're floor thresholds, not post-execution deductions. "budgetBufferAfterParallel" should be renamed to something like "budgetReservedForRanking" or "parallelBudgetCeiling".

5. **Reasoning config can follow the temperature threading pattern** — 5 files need changes, OpenAI SDK already has `reasoning_effort` type support.

6. **Benchmark script** can reuse existing provider creation from run-evolution-local.ts and comparison prompts from computeRatings.ts.

---

## Requirement 1: Lost Branch Recovery & Comparison

### Branch Status
- `feat/estimate_match_noise_evolution_20260411` — **LOST, UNRECOVERABLE**. Not on origin, backup, or any local reflog. Was never pushed before minicomputer crash.
- `feat/improve_setup_judging_20260412` — **MERGED** to main as commit 07fe2590 (Apr 13, 2026), PR #964.

### Merged Implementation (25 files, 993 insertions)
The merged branch implemented 4 phases:
1. **Central Model Registry** (`src/config/modelRegistry.ts`) — 16 models with pricing, provider routing, maxTemperature, supportsEvolution. 165 lines + 198 lines of tests.
2. **3 New Models** — `gpt-5-nano` ($0.05/$0.40), `google/gemini-2.5-flash-lite` ($0.10/$0.40), `qwen/qwen3-8b` ($0.05/$0.40). All via OpenRouter.
3. **OpenSkill Beta=0** — Two one-line changes in `computeRatings.ts` (lines 38, 50). Assumes zero performance variability → faster convergence.
4. **Temperature Support** — Threading through callLLM chain. Judge temperature=0. Generation temperature configurable per strategy. `clampTemperature()` helper. o3-mini excluded (no temp support).

### Research Doc Findings (for judging_accuracy reference)
The research doc covers cost-optimized judging setup but has **no explicit accuracy measurements**:
- Judge temperature set to 0 for deterministic judgments
- 2-pass reversal mitigates judge noise (making beta=0 safe)
- Qwen3 8B selected as default judge ($0.05/M input) — cheapest option
- No comparative accuracy metrics between judge models at different price points
- No position bias measurements or confidence distribution analysis

---

## Requirement 2: Invocation Timeline View

### Existing Timeline Architecture
- **Component**: `evolution/src/components/evolution/tabs/TimelineTab.tsx`
- **Data**: Fetches `InvocationListEntry[]` via `listInvocationsAction`, groups by iteration
- **Rendering**: Gantt-style horizontal bars, positioned by `created_at` offset from run start, width from `duration_ms`
- **Colors**: generate=blue, swiss=purple, merge=green, other=gray
- **Links**: Each bar links to invocation detail page

### Data Available for Invocation Sub-Timeline
`GenerateFromSeedExecutionDetail` contains:
- **generation**: cost, promptLength, textLength, formatValid, formatIssues, error
- **ranking**: cost, localPoolSize, comparisons[], stopReason, totalComparisons, finalLocalMu/Sigma
- **Per-comparison**: round, opponentId, selectionScore, pWin, mu/sigma before/after, outcome, confidence, convergence flags
- **MISSING**: durationMs per phase, durationMs per comparison, per-LLM-call latency

### Timing Instrumentation Needed (6 locations)
1. `generateFromSeedArticle.ts:161` — Generation phase start (`Date.now()` after costBeforeGen)
2. `generateFromSeedArticle.ts:205` — Generation phase end (after generation cost computed)
3. `generateFromSeedArticle.ts:231` — Ranking phase start (before rankNewVariant call)
4. `generateFromSeedArticle.ts:243` — Ranking phase end (after rankNewVariant completes)
5. `rankSingleVariant.ts:303` — Per-comparison start (before compareWithBiasMitigation)
6. `rankSingleVariant.ts:321` — Per-comparison end (after comparison completes)

### Schema Changes Needed
- `generateFromSeedComparisonSchema` — Add `durationMs`, `forwardCallDurationMs`, `reverseCallDurationMs` (all optional int ≥ 0)
- `generateFromSeedExecutionDetailSchema.generation` — Add `durationMs` (optional int ≥ 0)
- `generateFromSeedRankingDetailSchema` — Add `durationMs` (optional int ≥ 0)

### UI Implementation
- Add `{ id: 'timeline', label: 'Timeline' }` to `InvocationDetailContent.tsx` TABS array
- Create `InvocationTimelineTab.tsx` — two-segment phase bar (generation blue, ranking purple) + comparison sub-bars
- Reuse TimelineTab's `fmtMs()` helper and InvocationBar positioning math

### Log-Based Timing (Stopgap)
Debug logs in `rankSingleVariant.ts` emit "selecting opponent" and "comparison complete" with `created_at` timestamps. Can approximate per-comparison duration from log deltas. Query available via `evolution_logs` table WHERE `context->>'phaseName' = 'ranking'`.

---

## Requirement 3: Qwen Judge Model Speed

### Model Configuration
- **Qwen**: `qwen/qwen3-8b`, provider=openrouter, $0.05/$0.40, maxTemp=2.0
- **OSS 20B**: `gpt-oss-20b`, provider=openrouter (API: `openai/gpt-oss-20b`), $0.03/$0.14, maxTemp=2.0
- **Default judge**: `qwen/qwen3-8b` (set in `modelRegistry.ts:130`)

### Root Cause: Thinking Mode
- **Qwen3 8B** has thinking mode ON by default (`default_reasoning_enabled: true`). Uses `<think>` tokens internally.
- **OSS 20B** has MANDATORY reasoning (`is_mandatory_reasoning: true`). Cannot be fully disabled.
- Neither model has any reasoning configuration in the codebase — all calls use default thinking.

### Verifying Run 4133123e Judge Model
Query: `SELECT s.config->>'judgeModel' FROM evolution_runs r JOIN evolution_strategies s ON r.strategy_id = s.id WHERE r.id = '4133123e-c9fa-4c52-9289-26dcfb95ce61'`
- Access via `npm run query:staging`
- Admin UI: Run detail → Strategy link → Configuration tab → Judge field

### Benchmark Script Design
- Location: `evolution/scripts/benchmark-llm-latency.ts`
- Reuse provider creation from `run-evolution-local.ts` (direct OpenRouter client)
- Reuse comparison prompt from `computeRatings.ts:buildComparisonPrompt()`
- CLI: `--model1 qwen/qwen3-8b --model2 gpt-oss-20b --iterations 5`
- Output: avg/p50/p99 latencies per model, with and without reasoning config

---

## Requirement 4: Budget Buffer Naming

### Current Implementation
- `budgetBufferAfterParallel` and `budgetBufferAfterSequential` — fractions (0-1) stored in StrategyConfig
- **Validation**: parallel ≥ sequential enforced via Zod refine
- **Runtime**: `parallelFloor = totalBudget * fraction`, `sequentialFloor = totalBudget * fraction`

### How They Work
```
Phase 1 (Parallel): effectiveBudget = min(availBudget, totalBudget - parallelFloor)
  → Dispatch up to maxAffordable agents within constrained budget
Phase 2 (Sequential): if (availBudget - estCost >= sequentialFloor) → launch agent
  → Stop when next agent would breach sequentialFloor
Phase 3 (Swiss): Gets whatever remains
```

### Why Naming Is Misleading
- "buffer after parallel" suggests a post-execution deduction, but it's actually a PRE-execution entry gate / floor threshold
- Users see "40%" but don't know it means "ensure 40% of budget remains for ranking phases"

### Files Referencing (12 total)
- **Schemas**: `evolution/src/lib/schemas.ts` (lines 334-336, 384-386)
- **Pipeline Logic**: `runIterationLoop.ts` (lines 242-244, 278, 390, 400)
- **UI**: `StrategyConfigDisplay.tsx` (lines 95-100), `strategies/page.tsx` (lines 199-200, 249-250)
- **Docs**: `cost_optimization.md` (lines 161-166), `strategies_and_experiments.md` (lines 33-34, 48-49)
- **Tests**: `evolution-cost-estimation.integration.test.ts`, `admin-evolution-budget-dispatch.spec.ts`

### Suggested Rename Options
- `budgetReservedForRanking` / `budgetReservedForSwiss` — describes purpose
- `parallelBudgetCeiling` / `sequentialBudgetCeiling` — describes mechanism
- `minBudgetAfterParallel` / `minBudgetAfterSequential` — describes threshold

---

## Requirement 5: OSS 20B Thinking Mode

### OpenRouter Reasoning API Parameter
```json
{
  "reasoning": {
    "effort": "low",       // 'xhigh'|'high'|'medium'|'low'|'minimal'|'none'
    "max_tokens": 2000,    // hard cap on reasoning tokens
    "exclude": false,       // hide from response but still billed
    "enabled": true         // enable/disable
  }
}
```

### Per-Model Configuration
| Model | Goal | Parameter |
|-------|------|-----------|
| gpt-oss-20b | Minimize thinking (can't disable) | `reasoning: { effort: 'low' }` |
| qwen/qwen3-8b | Disable thinking entirely | `reasoning: { enabled: false }` |
| qwen/qwen3-8b | Minimize thinking | `reasoning: { effort: 'low' }` |

### Implementation Path (follows temperature pattern)
1. **ModelInfo** (`modelRegistry.ts`) — Add `reasoningConfig?: { enabled: boolean; effort?: string }`
2. **CallLLMOptions** (`llms.ts:39`) — Add `reasoningEffort?: 'low' | 'medium' | 'high'`
3. **LLMCompletionOptions** (`types.ts:413`) — Add `reasoningEffort?: string`
4. **LLMProvider.opts** (`claimAndExecuteRun.ts:198`) — Add `reasoningEffort`
5. **callOpenAIModel** (`llms.ts:315`) — Add `requestOptions.reasoning_effort = options.reasoningEffort`
6. **OpenAI SDK** already has `reasoning_effort` in `ChatCompletionCreateParamsBase` — no type extension needed

### Caveats
- gpt-oss-20b CANNOT have reasoning fully disabled — `low` is minimum
- `effort` and `max_tokens` are mutually exclusive in the reasoning object
- Reasoning tokens are billed separately even at `effort: 'low'`
- Legacy `include_reasoning: false` only hides output, doesn't prevent billing

---

## Requirement 6: Additional Research Findings

### OpenRouter Provider Routing
Both Qwen and OSS 20B use `isOpenRouterModel()` → `getOpenRouterClient()` with baseURL `https://openrouter.ai/api/v1`. Model IDs are transformed via `getOpenRouterApiModelId()`:
- `qwen/qwen3-8b` → `qwen/qwen3-8b` (unchanged)
- `gpt-oss-20b` → `openai/gpt-oss-20b` (prefixed)

### Cost Accounting
Reasoning token cost infrastructure already exists:
- `reasoningPer1M` field in ModelInfo and pricing table
- `calculateLLMCost()` handles reasoning tokens
- `usage.completion_tokens_details?.reasoning_tokens` extracted from responses

### Test Files Needing Updates (for budget buffer rename)
- `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` (lines 43-44, 68-69, 73-79)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts` (lines 105-106, 275-276)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/cost_optimization.md
- evolution/docs/data_model.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md
- evolution/docs/logging.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md

### Planning Docs
- docs/planning/improve_setup_judging_20260412/improve_setup_judging_20260412_research.md
- docs/planning/improve_setup_judging_20260412/improve_setup_judging_20260412_planning.md

## Code Files Read
- src/config/modelRegistry.ts — Model registry with 16 models, DEFAULT_JUDGE_MODEL, provider routing
- src/config/llmPricing.ts — Pricing derived from registry
- src/lib/services/llms.ts — callLLM chain, OpenRouter client, temperature/reasoning threading
- evolution/src/lib/types.ts — LLMCompletionOptions, LLMProvider interfaces
- evolution/src/lib/schemas.ts — StrategyConfig, execution detail schemas, comparison record schemas
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — LLMProvider creation, llmProvider.complete
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts — EvolutionLLMClient wrapper, cost tracking
- evolution/src/lib/pipeline/infra/estimateCosts.ts — Budget-aware dispatch estimation
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — Orchestrator loop, budget floor logic
- evolution/src/lib/pipeline/loop/rankSingleVariant.ts — Binary-search ranking, comparison records
- evolution/src/lib/pipeline/loop/swissPairing.ts — Swiss pair selection
- evolution/src/lib/shared/computeRatings.ts — run2PassReversal, compareWithBiasMitigation
- evolution/src/lib/core/agents/generateFromSeedArticle.ts — Generation + ranking agent
- evolution/src/lib/core/agents/SwissRankingAgent.ts — Swiss ranking with judge model
- evolution/src/lib/core/detailViewConfigs.ts — Config-driven detail rendering
- evolution/src/components/evolution/tabs/TimelineTab.tsx — Run timeline Gantt chart
- src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx — Invocation detail tabs
- src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx — Detail rendering
- src/app/admin/evolution/_components/StrategyConfigDisplay.tsx — Budget buffer UI display
- src/app/admin/evolution/strategies/page.tsx — Strategy creation form
- evolution/scripts/run-evolution-local.ts — Local runner with direct LLM provider creation
