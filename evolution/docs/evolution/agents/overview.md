# Agents and Pipeline Operations

This document covers the V2 pipeline's operational components: the phase functions that generate, rank, and evolve text variants, plus the supporting infrastructure for format validation, cost tracking, invocation logging, and LLM communication. For the overall system design, see [Architecture](../architecture.md). For rating math details, see [Rating and Comparison](../rating_and_comparison.md).

## V2 Monolithic Orchestrator

V1 used a supervisor-agent architecture: a supervisor dispatched work to an agent pool, collected results through a reducer, and persisted intermediate state via checkpoints. V2 eliminates all of that. The single `evolveArticle()` function in `evolution/src/lib/pipeline/evolve-article.ts` calls three pure phase functions directly in a flat loop:

1. `generateVariants()` — create new text variants from the original
2. `rankPool()` — compare and rate all variants in the pool
3. `evolveVariants()` — mutate and crossover the top-rated variants

There is no agent pool, no reducer, and no checkpoint persistence between iterations. Each phase function is a pure async operation that takes inputs and returns outputs. The orchestrator manages the pool, ratings map, and cost tracker as local state, passing them into each phase. This design is simpler to reason about and debug, at the cost of not being resumable mid-run.

```typescript
export async function evolveArticle(
  originalText: string,
  llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: { logger?: RunLogger; initialPool?: Array<TextVariation & { mu?: number; sigma?: number }> },
): Promise<EvolutionResult>
```

Each iteration calls the three phases through `executePhase()`, which wraps budget-error handling (discussed below). The loop runs for `config.iterations` rounds or until budget exhaustion or external kill signal. Config validation enforces hard bounds: iterations must be 1-100, budget must be positive and at most $50, and both `judgeModel` and `generationModel` must be non-empty strings.

Between iterations, the orchestrator checks for external kill signals by querying the run's status in the database. If the status has been set to `failed` or `cancelled` (by a user or admin action), the loop terminates gracefully with whatever results have been accumulated so far. Kill detection errors are swallowed — the pipeline continues if the database is temporarily unreachable.


## generateVariants()

`evolution/src/lib/pipeline/generate.ts`

Generates fresh text variants by running three parallel LLM strategies against the original (or current best) text. The strategies are:

**structural_transform** aggressively restructures the text: reorder sections, merge or split paragraphs, invert hierarchy (conclusion-first, problem-solution, narrative arc). The prompt instructs the LLM to reimagine organization from scratch rather than making timid incremental changes.

**lexical_simplify** simplifies language: replace complex words with simpler alternatives, shorten long sentences, remove jargon, improve accessibility while preserving meaning.

**grounding_enhance** makes abstract text concrete: add specific examples, include sensory details, strengthen real-world connections, ground concepts in experience.

All three strategies run in parallel via `Promise.allSettled()`. Each result is independently format-validated; invalid outputs are silently discarded rather than retried. This means a generation phase can produce anywhere from zero to three variants.

```typescript
export async function generateVariants(
  text: string,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  feedback?: { weakestDimension: string; suggestions: string[] },
): Promise<TextVariation[]>
```

Each successfully validated variant is created with `strategy` set to the strategy name, `version` set to 0, and `parentIds` as an empty array (since these are root-level generations, not mutations of existing variants).

If budget is exhausted partway through the three parallel calls, `Promise.allSettled()` captures the `BudgetExceededError` as a rejected promise. The function collects any variants that completed successfully and throws `BudgetExceededWithPartialResults` containing those partial results, allowing the orchestrator to incorporate whatever was produced before the budget ran out.

The number of active strategies is controlled by `config.strategiesPerRound` (default 3, capped at the total number of available strategies). Feedback from previous ranking rounds can optionally be passed in to guide generation: the weakest dimension identified by ranking plus specific improvement suggestions are appended to each strategy's prompt, giving the LLM targeted direction for improvement.


## rankPool()

`evolution/src/lib/pipeline/rank.ts`

Ranks all variants in the pool through a two-phase process: triage for new entrants, then Swiss-system fine-ranking for the competitive core.

### Triage phase

New entrants (variants with sigma >= 5.0, meaning uncalibrated) face a gauntlet of stratified opponents drawn from the existing pool. For a default of 5 opponents, the selection is: 2 from the top quartile, 2 from the middle, and 1 from the bottom (preferring fellow new entrants for the bottom slot).

Two exit conditions short-circuit triage per entrant:

**Early exit.** After at least 2 matches, if the entrant has 2 or more decisive matches (confidence >= 0.7) AND average confidence across all matches is >= 0.8, triage ends. The entrant's rating is calibrated enough for fine-ranking.

**Elimination.** After at least 2 matches, if `mu + 2*sigma < top20Cutoff` (where the cutoff is the mu of the variant at the 20th percentile), the entrant is eliminated from fine-ranking entirely. It will remain in the pool but will not consume further comparison budget.

### Swiss fine-ranking phase

After triage, fine-ranking runs on the competitive subset: variants that are not eliminated AND either have `mu >= 3 * sigma` (reasonably calibrated) or are in the top-K by mu.

Pairing uses Bradley-Terry win probability to maximize information gain. For each potential pair, a score combines outcome uncertainty (how close to a coin flip the predicted result is) with average sigma (how uncertain the ratings still are). Pairs are greedily selected by descending score, ensuring each variant appears in at most one match per round.

Fine-ranking runs for up to 20 Swiss rounds, subject to a comparison budget that depends on cost pressure:

| Budget pressure | Max comparisons |
|-----------------|-----------------|
| Low (< 50% spent) | 40 |
| Medium (50-80% spent) | 25 |
| High (> 80% spent) | 15 |

Convergence is declared when all eligible variants' sigmas drop below the convergence threshold for two consecutive rounds.

```typescript
export interface RankResult {
  matches: V2Match[];
  ratingUpdates: Record<string, Rating>;
  matchCountIncrements: Record<string, number>;
  converged: boolean;
}
```

**Draw logic.** A match is treated as a draw when confidence < 0.3 (in fine-ranking) or when `winnerId === loserId` (a legacy V1 pattern preserved for compatibility). In triage, draws occur when confidence is exactly 0 or `winnerId === loserId`. Draws update both variants' ratings symmetrically via `updateDraw()`.

The Swiss pairing algorithm works by scoring every possible pair of eligible variants. The score for a pair is `outcomeUncertainty * averageSigma`, where outcome uncertainty is `1 - |2 * P(win) - 1|` using Bradley-Terry probability and average sigma is the mean of both variants' sigma values. This prioritizes matches between closely rated but still uncertain variants, maximizing the information gained per comparison. Pairs are then greedily assigned in descending score order, with each variant used at most once per round. Already-completed pairs (tracked by a pair key set) are excluded from consideration.

The budget tier is determined by how much of the total run budget has been consumed. The function `getBudgetTier()` maps budget fraction to a tier: >= 80% spent is "high" pressure, >= 50% is "medium", and below 50% is "low". This ensures that late-stage iterations, when the budget is nearly exhausted, spend fewer comparisons on fine-ranking — preserving budget for the remaining generate and evolve phases.


## evolveVariants()

`evolution/src/lib/pipeline/evolve.ts`

Evolves existing high-quality variants through mutation and crossover. Selects the top 2 parents by mu from the current pool and applies up to four strategies:

**mutate_clarity** (always runs, on parent 0). Simplifies complex sentences, removes ambiguous phrasing, improves word choice for precision.

**mutate_structure** (always runs, on parent 0). Reorganizes for better flow, improves paragraph breaks, strengthens transitions, enhances logical progression.

**crossover** (runs if 2+ parents available). Combines the best structural elements from one parent with the best stylistic elements from the other. Both parent texts are passed in a single prompt.

**creative_exploration** (conditional). Produces a bold, significantly different version of parent 0. Only fires when `0 < diversityScore < 0.5`.

> **Warning:** The `diversityScore` option defaults to 1.0 when not provided. Since no caller currently computes or passes a diversity score, the condition `0 < diversityScore < 0.5` is never satisfied, meaning `creative_exploration` never fires in practice. This is a declared-but-unimplemented feature.

```typescript
export async function evolveVariants(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  options?: {
    feedback?: { weakestDimension: string; suggestions: string[] };
    diversityScore?: number;
  },
): Promise<TextVariation[]>
```

Unlike `generateVariants()` which runs strategies in parallel, `evolveVariants()` runs them sequentially. Each LLM output is format-validated; failures are silently discarded. New variants inherit `parentIds` from the selected parents and have `version` set to `maxVersion + 1` of the parents.

`BudgetExceededError` propagates directly to the caller (no partial-results wrapping). If budget runs out after the first mutation succeeds but before crossover, the successfully created variants are lost. This is acceptable because the orchestrator's `executePhase()` wrapper handles the budget error at the iteration level.

The sequential execution means evolve is more vulnerable to budget exhaustion than generate (which runs in parallel and can salvage partial results). However, the most valuable strategies — clarity and structure mutation — run first, so if budget does run out mid-phase, the highest-priority variants are the ones most likely to have completed.


## Format Validation

`evolution/src/lib/shared/formatValidator.ts` and `evolution/src/lib/shared/formatValidationRules.ts`

Every generated or evolved variant passes through format validation before entering the pool. The rules enforce a consistent article structure:

**H1 title.** Exactly one `# ` heading, on the first non-empty line. Multiple H1s or a missing H1 fails validation.

**Section headings.** At least one `## ` or `### ` heading must be present.

**No bullet points.** Regex: `/^\s*[-*+]\s/m`

**No numbered lists.** Regex: `/^\s*\d+[.)]\s/m`

**No tables.** Regex: `/^\|.+\|/m`

**Paragraph sentences.** Each paragraph must have at least 2 sentences, with a 25% tolerance (up to 25% of paragraphs may be short without failing).

Code blocks are stripped before checking bullets, lists, and tables, so code examples containing these patterns do not trigger false positives. Horizontal rules are also stripped before bullet detection to prevent `---` from matching the bullet pattern.

The `FORMAT_VALIDATION_MODE` environment variable controls behavior:
- `"reject"` (default) — invalid outputs are discarded
- `"warn"` — issues are logged but the variant is accepted
- `"off"` — no validation at all

The validation rules file (`formatValidationRules.ts`) also exports helper functions used by both the full-article validator and the section-level validator: `stripCodeBlocks()`, `stripHorizontalRules()`, `hasBulletPoints()`, `hasNumberedLists()`, `hasTables()`, `extractParagraphs()`, and `countShortParagraphs()`. The paragraph extractor filters out headings, horizontal rules, emphasis-only lines, and label lines (lines ending with a colon) before counting sentences. Sentence detection uses the regex `/[.!?][""\u201d\u2019]?(?:\s|$)/g` to handle standard and smart-quoted punctuation.

Format validation is the primary quality gate preventing malformed content from entering the variant pool. Because validation failures are silent (no retry, no error), the FORMAT_RULES prompt injection serves as the first line of defense — guiding the LLM to produce compliant output so that validation rarely needs to reject.


## executePhase Helper

`evolution/src/lib/pipeline/evolve-article.ts`

Wraps each pipeline phase call with budget-error handling and invocation cost tracking.

```typescript
export async function executePhase<T>(
  phaseName: string,
  phaseFn: () => Promise<T>,
  db: SupabaseClient,
  invocationId: string | null,
  costTracker: { getTotalSpent(): number },
  costBefore: number,
): Promise<PhaseResult<T>>
```

The return type `PhaseResult<T>` encodes four outcomes:

- **Success** — `{ success: true, result }`. The invocation row is updated with the cost delta and `success: true`.
- **BudgetExceededWithPartialResults** — `{ success: false, budgetExceeded: true, partialVariants }`. Some variants were produced before budget ran out. The invocation is marked failed.
- **BudgetExceededError** — `{ success: false, budgetExceeded: true }`. No usable results. The invocation is marked failed.
- **Other errors** — re-thrown. The caller (or process boundary) handles them.

> **Warning:** `BudgetExceededWithPartialResults` extends `BudgetExceededError`. The `instanceof` check for the subclass MUST come before the superclass check, otherwise all partial-results errors would be caught by the superclass branch and their `partialVariants` would be lost. The current code handles this correctly, but reordering the catch branches would silently drop partial results.


## Invocation Tracking

`evolution/src/lib/pipeline/invocations.ts`

Each pipeline phase execution is tracked as a row in the `evolution_agent_invocations` table. Two functions manage the lifecycle:

`createInvocation(db, runId, iteration, phaseName, executionOrder)` inserts a new row and returns the UUID, or `null` on any error. The table has a UNIQUE constraint on `(run_id, iteration, agent_name)`, so duplicate phase executions within the same iteration are rejected at the database level.

`updateInvocation(db, id, updates)` sets `cost_usd`, `success`, and optional `execution_detail` (JSONB) and `error_message` on an existing row. If `id` is `null` (because creation failed), the call is a no-op. This null-safety means the pipeline never crashes due to invocation tracking failures.

Both functions catch all exceptions and log them via `console.warn`. Invocation tracking is observability infrastructure; it must not interfere with the actual evolution pipeline.

The invocation rows enable post-run analysis: which phases ran, how much each cost, which succeeded or failed, and what execution details were recorded. The `execution_detail` JSONB column stores phase-specific metadata (such as variant counts produced by generation, or match counts from ranking) for debugging and performance analysis.


## RunLogger

`evolution/src/lib/pipeline/run-logger.ts`

Provides structured logging to the `evolution_run_logs` table with fire-and-forget semantics. The logger exposes four levels: `info`, `warn`, `error`, and `debug`.

```typescript
export function createRunLogger(runId: string, supabase: SupabaseClient): RunLogger
```

Each log call inserts a row with the run ID, level, message, and context fields. The `phaseName` context field maps to the `agent_name` column (a naming carryover from V1). Additional context fields (`iteration`, `variantId`, plus arbitrary key-value pairs) are stored in a JSONB `context` column.

All database writes are fire-and-forget: the insert is wrapped in `Promise.resolve().then()` with errors caught and swallowed (only a `console.warn` is emitted). This ensures logging can never block or crash the pipeline. The tradeoff is that log entries may be silently lost under database pressure, but this is acceptable for observability data.


## LLM Client

`evolution/src/lib/pipeline/llm-client.ts`

`createV2LLMClient()` wraps a raw LLM provider with retry logic and cost tracking.

```typescript
export function createV2LLMClient(
  rawProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  costTracker: V2CostTracker,
  defaultModel: string,
): EvolutionLLMClient
```

**Retry policy.** Transient errors (network failures, rate limits) are retried up to 3 times with exponential backoff: 1s, 2s, 4s. Each individual call has a 60-second timeout. `BudgetExceededError` is never retried since it represents a deliberate resource limit, not a transient failure.

**Cost tracking.** Before each call, the client estimates cost from the prompt length and expected output tokens (using chars/4 as a token approximation). After a successful call, actual cost is computed from input and output character counts and recorded via the cost tracker. The cost tracker checks the pre-call estimate against remaining budget and throws `BudgetExceededError` before the LLM call even happens if the estimate would exceed the budget — this prevents wasting money on calls that would push past the limit.

Model pricing is maintained in a lookup table covering common models (GPT-4.1 variants, GPT-4o variants, DeepSeek, Claude Sonnet 4, Claude Haiku 4.5). Unknown models use the most expensive pricing as a conservative fallback, with a `console.warn` alerting operators. Expected output tokens are estimated by label: generation and evolution calls assume 1000 tokens, ranking calls assume 100 tokens.

For cost optimization details including the budget tier system and model pricing, see [Cost Optimization](../cost_optimization.md).


## Prompt Construction

All generation and evolution prompts share a common structure built by `buildEvolutionPrompt()`. The function assembles:

1. A strategy-specific preamble (system role)
2. The source text under a labeled heading
3. Strategy-specific instructions
4. Format rules (the `FORMAT_RULES` constant) injected into every prompt to guide the LLM toward compliant output
5. An optional feedback section containing the weakest dimension and improvement suggestions from prior ranking

Comparison prompts (used during ranking) evaluate variants across four dimensions: clarity, structure, engagement, and grammar. The judge LLM returns a winner designation and confidence score. The feedback section is optional and only populated after the first iteration, when ranking data from previous rounds can identify the weakest dimension and generate targeted suggestions for improvement.
