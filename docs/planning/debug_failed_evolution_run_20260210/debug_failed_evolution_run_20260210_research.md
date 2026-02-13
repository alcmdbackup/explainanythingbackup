# Debug Failed Evolution Run Research

## Problem Statement
Evolution run 5db6fadd failed at COMPETITION iteration 10 due to an unhandled DeepSeek API socket timeout in IterativeEditingAgent. The agent's main edit loop has unprotected LLM calls that propagate transient network errors as fatal run failures. GenerationAgent survived the same timeout in the same iteration because it uses Promise.allSettled. This project will audit all agents for unprotected LLM calls, add pipeline-level retry for transient errors, and improve error categorization to prevent transient network issues from killing long-running evolution runs.

## Requirements (from GH Issue #402)
1. **Audit all agents for unprotected LLM calls** — Check every agent's execute() method for bare `await llmClient.complete()` or `callLLM()` calls not wrapped in try-catch. Agents to audit: IterativeEditingAgent, SectionDecompositionAgent, DebateAgent, EvolutionAgent, TreeSearchAgent, OutlineGenerationAgent, CalibrationRanker, Tournament.

2. **Fix IterativeEditingAgent** — Wrap the edit generation (line 88) and diff comparison (line 100) in try-catch. On transient error, increment `consecutiveRejections` and `continue` the loop rather than crashing.

3. **Fix other agents with unprotected calls** — Apply the same pattern: catch transient errors, log them, and gracefully degrade (skip that operation) rather than crash.

4. **Add pipeline-level retry in `runAgent()`** — For transient `FetchError`/socket timeout errors, retry the agent 1-2 times with exponential backoff before marking the run as failed.

5. **Improve error categorization** — Add a `isTransientError()` helper that identifies socket timeouts, connection resets, 429 rate limits, and 5xx server errors as retryable.

6. **Add unit tests** — Test transient error handling in IterativeEditingAgent and the pipeline retry logic.

7. **Update documentation** — Update evolution/reference.md error recovery table with new retry behavior.

## High Level Summary

Full audit of 12 agents + 5 helper modules + pipeline infrastructure reveals **3 tiers of error handling maturity**:

- **Tier 1 — Fully protected (5 agents):** GenerationAgent, EvolutionAgent, ReflectionAgent, DebateAgent, OutlineGenerationAgent. All LLM calls wrapped in Promise.allSettled or individual try-catch.
- **Tier 2 — Partially protected (5 agents):** IterativeEditingAgent, SectionDecompositionAgent, CalibrationRanker, Tournament, TreeSearchAgent. Parallel calls protected via allSettled, but individual sequential calls or delegate calls are unprotected.
- **Tier 3 — Unprotected helper modules (3 modules):** diffComparison.ts, comparison.ts, sectionEditRunner.ts. Bare awaits throughout, error handling delegated entirely to callers.

The pipeline's `runAgent()` has **no retry logic** — any non-budget error immediately marks the run as `failed`. No `isTransientError()` helper exists anywhere in the codebase. The only retry logic is in `persistCheckpoint()` (3 retries with exponential backoff) and the SDK-level `maxRetries: 3` on OpenAI/DeepSeek/Anthropic clients.

---

## Full Agent Audit

### Tier 1: Fully Protected Agents

#### GenerationAgent (`agents/generationAgent.ts`, 138 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 80 | `llmClient.complete()` (3 strategies) | PROTECTED — Promise.allSettled | Partial failure tolerated, BudgetExceededError re-thrown |

- All 3 strategy calls run in parallel via `Promise.allSettled` (line 76)
- BudgetExceededError explicitly re-thrown (lines 91-95)
- Agent succeeds if at least 1 variant created

#### EvolutionAgent / evolvePool (`agents/evolvePool.ts`, 380 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 223 | Main evolution strategies (3 parallel) | PROTECTED — Promise.allSettled | Partial failure tolerated |
| 277 | Creative exploration | PROTECTED — try-catch | Failure swallowed, non-fatal |
| 312-319 | Outline mutation (2 sequential) | PROTECTED — try-catch | Failure swallowed, non-fatal |

- Main strategies via `Promise.allSettled` (line 208)
- Optional operations (creative, outline) in dedicated try-catch blocks
- BudgetExceededError re-thrown from all blocks

#### ReflectionAgent (`agents/reflectionAgent.ts`, 209 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 117 | Critique generation (up to 3 parallel) | PROTECTED — Promise.allSettled | Partial failure tolerated |

- `Promise.allSettled` (line 113) with BudgetExceededError scan (lines 123-127)
- Agent succeeds if at least 1 critique generated

#### DebateAgent (`agents/debateAgent.ts`, 336 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 230 | Advocate A argument | PROTECTED — try-catch | Returns success:false, partial transcript saved |
| 243 | Advocate B argument | PROTECTED — try-catch | Returns success:false, partial transcript saved |
| 256 | Judge verdict | PROTECTED — try-catch | Returns success:false, partial transcript saved |
| 281 | Synthesis | PROTECTED — try-catch | Returns success:false, partial transcript saved |

- All 4 sequential calls individually wrapped in try-catch
- BudgetExceededError re-thrown from each
- Partial transcripts saved to state before returning failure

#### OutlineGenerationAgent (`agents/outlineGenerationAgent.ts`, 305 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 151 | Generate outline | PROTECTED — single try-catch | Partial recovery from any step |
| 159 | Score outline | PROTECTED — single try-catch | Partial recovery |
| 175 | Expand outline | PROTECTED — single try-catch | Partial recovery |
| 187 | Score expansion | PROTECTED — single try-catch | Partial recovery |
| 203 | Polish text | PROTECTED — single try-catch | Partial recovery |
| 209 | Score polish | PROTECTED — single try-catch | Partial recovery |

- Single try-catch (lines 147-266) wraps all 6 sequential calls
- BudgetExceededError re-thrown (line 249)
- Partial recovery: creates variant from whatever steps completed (lines 253-263)

---

### Tier 2: Partially Protected Agents

#### IterativeEditingAgent (`agents/iterativeEditingAgent.ts`, 354 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 69 | runOpenReview (initial) | **UNPROTECTED** at call site (internal try-catch returns null) | Internal catch → null, agent continues |
| **88** | **Edit generation** | **UNPROTECTED — bare await** | **Agent throws, run fails** |
| **100** | **compareWithDiff (2 LLM calls)** | **UNPROTECTED — bare await** | **Agent throws, run fails** |
| 122 | runInlineCritique (re-eval) | **UNPROTECTED** at call site (internal try-catch returns null) | Internal catch → null, agent continues |
| 123 | runOpenReview (re-eval) | **UNPROTECTED** at call site (internal try-catch returns null) | Internal catch → null, agent continues |

**Critical finding:** Lines 88 and 100 are the exact failure points from run 5db6fadd. The edit generation and diff comparison in the main cycle loop have no try-catch. A socket timeout at either line crashes the entire agent.

- `runOpenReview` (lines 148-164) and `runInlineCritique` (lines 167-207) have internal try-catch with BudgetExceededError re-throw
- But the core edit loop (lines 71-128) has no protection around the two most expensive calls

#### SectionDecompositionAgent (`agents/sectionDecompositionAgent.ts`, 172 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 102 | Section edits (parallel via helper) | PROTECTED — Promise.allSettled | BudgetExceededError captured and re-thrown |

- Delegates to `runSectionEdit()` which has **UNPROTECTED** calls (see Tier 3)
- BUT those calls run inside `Promise.allSettled` (line 102), so individual failures are captured
- BudgetExceededError explicitly handled (lines 108-114)
- **Effective protection**: Good — allSettled absorbs failures from unprotected helper

#### CalibrationRanker (`agents/calibrationRanker.ts`, 216 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 38-45 | callLLM wrapper | PROTECTED — try-catch returns '' | Graceful degradation (confidence 0.3) |
| 49 | compareStandalone() delegate | **UNPROTECTED** | Relies on internal handling |
| 139-143 | First batch comparisons | PROTECTED — Promise.allSettled | Rejected promises silently skipped |
| 166-170 | Remaining batch comparisons | PROTECTED — Promise.allSettled | Rejected promises silently skipped |

**Gap:** allSettled blocks don't re-throw BudgetExceededError from rejected promises (unlike Tournament which does)

#### Tournament (`agents/tournament.ts`, 390 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 167 | compareWithBiasMitigation delegate | **UNPROTECTED** at call site | Relies on PairwiseRanker internal protection |
| 173 | comparePair tiebreaker delegate | **UNPROTECTED** at call site | Relies on PairwiseRanker internal protection |
| 256-260 | Round matches batch | PROTECTED — allSettled + BudgetExceededError re-throw | Proper handling |
| 305-309 | Flow comparisons batch | PROTECTED — allSettled + try-catch | Non-fatal by design |

- Individual delegate calls are unprotected but run inside allSettled batches
- BudgetExceededError properly re-thrown from allSettled rejected results (lines 296-300)
- PairwiseRanker's `comparePair()` has internal try-catch (lines 162-174)

#### TreeSearchAgent (`agents/treeSearchAgent.ts`, 165 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 62-71 | beamSearch() delegate | PROTECTED — try-catch | BudgetExceededError re-thrown, others logged |

- All LLM calls inside beamSearch.ts helper
- beamSearch uses allSettled for parallel calls, try-catch for delegate calls
- `runInlineCritique()` (beamSearch.ts:320) is bare await but runs inside allSettled

---

### Tier 3: Unprotected Helper Modules

#### diffComparison.ts (122 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 58 | Forward judge `callLLM(forwardPrompt)` | **UNPROTECTED — bare await** | Throws to caller |
| 62 | Reverse judge `callLLM(reversePrompt)` | **UNPROTECTED — bare await** | Throws to caller |

- Called by: IterativeEditingAgent (line 100), sectionEditRunner (line 71), beamSearch (line 70)
- Error handling is entirely caller's responsibility

#### comparison.ts (120 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 81 | First comparison A vs B `callLLM()` | **UNPROTECTED — bare await** | Throws to caller |
| 85 | Second comparison B vs A `callLLM()` | **UNPROTECTED — bare await** | Throws to caller |

- Called by: CalibrationRanker (via callLLM wrapper), PairwiseRanker, beamSearch
- Partial null handling for parse failures (lines 96-101) but NOT for call failures
- Failed comparisons not cached, allowing implicit retry on next encounter

#### sectionEditRunner.ts (121 lines)
| Line | LLM Call | Protection | Impact if Fails |
|------|----------|------------|-----------------|
| 57 | Section edit `llmClient.complete()` | **UNPROTECTED — bare await** | Throws to caller |
| 71 | compareWithDiff (2 LLM calls) | **UNPROTECTED — delegate** | Throws to caller |

- Called by: SectionDecompositionAgent inside Promise.allSettled (effectively protected)

---

## Pipeline Infrastructure

### runAgent() (`pipeline.ts`, lines 1051-1103)
- Catches ALL errors from `agent.execute()`
- BudgetExceededError → `markRunPaused()` (status='paused')
- All other errors → `markRunFailed()` (status='failed')
- **No retry logic** — failure is immediate and final
- Persists checkpoint before marking status (best-effort)

### llmClient.ts (`core/llmClient.ts`)
- Thin wrapper around `callLLM()` with budget enforcement
- `reserveBudget()` called BEFORE LLM call (can throw BudgetExceededError)
- **No error catching** — all errors from callLLM propagate unchanged
- Error types: BudgetExceededError, LLMRefusalError, network errors, ZodError, SyntaxError

### SDK-Level Retry (llms.ts)
- OpenAI/DeepSeek/Anthropic clients configured with `maxRetries: 3`, `timeout: 60000`
- SDK retries on: network errors, 429, 5xx
- SDK does NOT retry: 4xx (except 429), validation errors, timeouts exceeding 60s
- **Opaque to pipeline** — pipeline cannot distinguish "SDK exhausted retries" from other failures

### persistCheckpoint() (`pipeline.ts`, lines 27-66)
- **Has retry logic**: 3 attempts with exponential backoff (1s, 2s, 3s)
- Retries ALL errors equally (no transient classification)
- Only retry logic in the entire evolution pipeline

### Error Classification — NONE
- No `isTransientError()` or `isRetryable()` helper exists anywhere
- `categorizeError()` in `errorHandling.ts` uses keyword matching but:
  - Socket timeout → "timeout" keyword → TIMEOUT_ERROR
  - ECONNRESET → may not match anything → UNKNOWN_ERROR
  - No concept of "retryable" vs "fatal"

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/reference.md
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/cost_optimization.md
- docs/evolution/agents/overview.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/debugging_skill.md
- docs/evolution/visualization.md

## Code Files Read (full audit)
- src/lib/evolution/agents/generationAgent.ts (138 lines) — Tier 1, fully protected
- src/lib/evolution/agents/evolvePool.ts (380 lines) — Tier 1, fully protected
- src/lib/evolution/agents/reflectionAgent.ts (209 lines) — Tier 1, fully protected
- src/lib/evolution/agents/debateAgent.ts (336 lines) — Tier 1, fully protected
- src/lib/evolution/agents/outlineGenerationAgent.ts (305 lines) — Tier 1, fully protected
- src/lib/evolution/agents/iterativeEditingAgent.ts (354 lines) — Tier 2, critical gaps at lines 88, 100
- src/lib/evolution/agents/sectionDecompositionAgent.ts (172 lines) — Tier 2, effectively protected via allSettled
- src/lib/evolution/agents/calibrationRanker.ts (216 lines) — Tier 2, missing BudgetExceeded re-throw from allSettled
- src/lib/evolution/agents/tournament.ts (390 lines) — Tier 2, proper BudgetExceeded handling
- src/lib/evolution/agents/pairwiseRanker.ts (385 lines) — Tier 2, protected comparePair but sequential execute loop vulnerable
- src/lib/evolution/agents/treeSearchAgent.ts (165 lines) — Tier 2, delegates to protected beamSearch
- src/lib/evolution/diffComparison.ts (122 lines) — Tier 3, bare awaits
- src/lib/evolution/comparison.ts (120 lines) — Tier 3, bare awaits
- src/lib/evolution/section/sectionEditRunner.ts (121 lines) — Tier 3, bare awaits
- src/lib/evolution/treeOfThought/beamSearch.ts (349 lines) — allSettled + try-catch hybrid
- src/lib/evolution/treeOfThought/evaluator.ts (186 lines) — allSettled, conservative rejection
- src/lib/evolution/core/pipeline.ts — runAgent(), executeFullPipeline(), markRunFailed/Paused, persistCheckpoint
- src/lib/evolution/core/llmClient.ts — budget enforcement wrapper, no error handling
- src/lib/evolution/core/costTracker.ts — BudgetExceededError class definition
- src/lib/services/llms.ts — SDK client config (maxRetries: 3, timeout: 60000)
- src/lib/errorHandling.ts — categorizeError() keyword matching, no transient detection

## Database Investigation
- Run 5db6fadd: COMPETITION iter 10, 33 variants, $15 budget, ~67 min runtime
- DeepSeek socket timeout hit GenerationAgent (handled via Promise.allSettled) AND IterativeEditingAgent (unhandled, crashed run)
- Last successful checkpoint: iter 10 / reflection agent
- Failure checkpoint: iter 10 / iterativeEditing (partial state saved)
