# Agents and Pipeline Operations

This document covers the V2 pipeline's operational components: the three concrete agent classes that drive the orchestrator-driven iteration loop, plus the supporting infrastructure for format validation, cost tracking, invocation logging, and LLM communication. For the overall system design, see [Architecture](../architecture.md). For rating math details, see [Rating and Comparison](../rating_and_comparison.md).

## V2 Config-Driven Iteration Loop

`evolveArticle()` in `evolution/src/lib/pipeline/loop/runIterationLoop.ts` iterates over
`config.iterationConfigs[]`, an ordered array of `IterationConfig` objects. Each entry
specifies `agentType` (`generate` or `swiss`), `budgetPercent`, and optional `maxAgents`.
Per-iteration dollar budgets are computed at runtime: `(budgetPercent / 100) * totalBudget`.
Each iteration is one of two types — both have the uniform shape **work agent(s) + merge agent**:

0. **`CreateSeedArticleAgent`** — runs **once**, at the start of iteration 1, for prompt-based runs where no arena seed exists. Makes two LLM calls (`seed_title` then `seed_article`) to generate the initial article from the prompt text, then ranks the result via `rankNewVariant()` against the loaded arena snapshot. If the seed agent fails (`budget` or `generation_failed`), the run stops immediately with `stopReason = 'seed_failed'`. On success, sets `originalText` for the iteration and marks `isSeeded = true` in the result. LLM spend is tracked via `seed_cost` in `evolution_metrics`.
1. **`GenerateFromPreviousArticleAgent`** — one parallel agent per generated variant. Generates ONE variant via a single strategy, then ranks it via binary search against a deep-cloned local snapshot of the iteration-start pool/ratings/matchCounts. Owns its own surface/discard decision (budget + local `elo` < top-15% cutoff = discard).
2. **`SwissRankingAgent`** — one swiss iteration's worth of parallel pair comparisons over the eligible set. Returns the raw match buffer; never applies rating updates.
3. **`MergeRatingsAgent`** — reusable. Concatenates match buffers from one or more work agents, shuffles in seeded Fisher-Yates order, applies rating updates to the global ratings sequentially (OpenSkill internally; public `{elo, uncertainty}` at the boundary), and writes one row per match to `evolution_arena_comparisons` (sole writer of in-run match rows).

The first `iterationConfig` must have `agentType: 'generate'` (swiss on an empty pool is invalid — enforced by Zod validation). The iteration sequence is fully determined by the strategy config; the orchestrator no longer uses a `nextIteration()` decision function. There is no agent pool, no reducer, and no checkpoint persistence between iterations. The orchestrator manages the pool, ratings map, and cost tracker as local state. Each iteration gets its own `IterationBudgetTracker` that throws `IterationBudgetExceededError` when the per-iteration budget is exhausted (stops only that iteration; the loop advances to the next config entry). This design is simpler to reason about and debug, at the cost of not being resumable mid-run.

```typescript
export async function evolveArticle(
  originalText: string,
  llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: { logger?: RunLogger; initialPool?: Array<Variant & { elo?: number; uncertainty?: number }> },
): Promise<EvolutionResult>
```

Each iteration dispatches its work agent(s) and merge agent through the `Agent.run()` template method, which wraps budget-error handling (discussed below) and invocation lifecycle. The loop iterates over `config.iterationConfigs[]` in order. Per-iteration stop reasons (`iteration_budget_exceeded`, `iteration_converged`, `iteration_no_pairs`, `iteration_complete`) are recorded in `EvolutionResult.iterationResults[]`. The run terminates when all iterations complete, or on run-level budget exhaustion, kill signal, or wall-clock deadline. Config validation enforces: budget must be positive and at most $50, both `judgeModel` and `generationModel` must be non-empty, `iterationConfigs` must have at least 1 entry (max 20), budget percentages must sum to 100, and the first iteration must be `generate`.

Between iterations, the orchestrator checks for external kill signals by querying the run's status in the database. If the status has been set to `failed` or `cancelled` (by a user or admin action), the loop terminates gracefully with whatever results have been accumulated so far. Kill detection errors are swallowed — the pipeline continues if the database is temporarily unreachable.


## generateVariants()

`evolution/src/lib/pipeline/generate.ts`

Generates fresh text variants by running parallel LLM tactics against the original (or current best) text. There are 24 available tactics — 3 core, 5 extended, and 16 specialized across five categories. Tactic definitions live in code at `evolution/src/lib/core/tactics/generateTactics.ts`; tactic entity identity (UUIDs for metrics/admin) is stored in the `evolution_tactics` table and managed by `tacticRegistry.ts`.

**Core (3)**

**structural_transform** aggressively restructures the text: reorder sections, merge or split paragraphs, invert hierarchy (conclusion-first, problem-solution, narrative arc). The prompt instructs the LLM to reimagine organization from scratch rather than making timid incremental changes.

**lexical_simplify** simplifies language: replace complex words with simpler alternatives, shorten long sentences, remove jargon, improve accessibility while preserving meaning.

**grounding_enhance** makes abstract text concrete: add specific examples, include sensory details, strengthen real-world connections, ground concepts in experience.

**Extended (5)**

**engagement_amplify** boosts reader engagement through hooks, pacing, and rhetorical devices.

**style_polish** refines prose style, improves flow, and strengthens voice.

**argument_fortify** strengthens logical structure, evidence, and persuasiveness.

**narrative_weave** weaves narrative threads, improves coherence, and adds storytelling elements.

**tone_transform** shifts or unifies tone to match target audience and purpose.

**Depth & Knowledge (4)**

**analogy_bridge** enriches text with vivid analogies and metaphors that connect abstract concepts to everyday experience.

**expert_deepdive** adds technical depth: mechanisms, edge cases, caveats, and nuances that expert readers expect.

**historical_context** weaves in origin stories, key figures, and timeline of discovery to explain why things are the way they are.

**counterpoint_integrate** integrates counterpoints and addresses objections, making the text more intellectually honest.

**Audience-Shift (3)**

**pedagogy_scaffold** restructures text using teaching techniques: prerequisite sequencing, simple-to-complex progression, and bridge sentences.

**curiosity_hook** maximizes curiosity via information gaps, open loops, surprising facts, and delayed key revelations.

**practitioner_orient** shifts from theory to practice: decision frameworks, common pitfalls, and actionable guidance.

**Structural Innovation (3)**

**zoom_lens** alternates between macro (big picture, context) and micro (specific details, mechanisms) perspectives in a breathing rhythm.

**progressive_disclosure** layers content so readers get a complete simple version first, with each subsequent section deepening one aspect.

**contrast_frame** explains concepts through systematic comparison: what it is vs. what it is not, this approach vs. alternatives.

**Quality & Precision (3)**

**precision_tighten** eliminates hedge words, vague quantifiers, and weasel phrases; replaces each with specific, concrete claims.

**coherence_thread** strengthens the logical thread from start to finish: topic sentences, transitional phrases, and paragraph-to-paragraph flow.

**sensory_concretize** replaces abstract verbs and nouns with vivid, sensory-specific, action-oriented alternatives.

**Meta/Experimental (3)**

**compression_distill** distills text to 60-70% of original length, removing redundancy and filler while preserving all key content and section structure.

**expansion_elaborate** identifies the thinnest section relative to its importance and triples its depth with explanation, context, and nuance.

**first_principles** rebuilds every concept from foundations, assuming zero domain knowledge, deriving each idea step by step from everyday experience.

By default, only the 3 core tactics run (deterministic selection). When `generationGuidance` is set on the strategy config, tactics are chosen via weighted random selection based on the configured percentages. All selected tactics run in parallel via `Promise.allSettled()`. Each result is independently format-validated; invalid outputs are silently discarded rather than retried. This means a generation phase can produce anywhere from zero to N variants (where N is `strategiesPerRound`).

```typescript
export async function generateVariants(
  text: string,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  feedback?: { weakestDimension: string; suggestions: string[] },
): Promise<Variant[]>
```

Each successfully validated variant is created with `strategy` set to the tactic name, `version` set to 0, and `parentIds` as an empty array (since these are root-level generations, not mutations of existing variants).

If budget is exhausted partway through the three parallel calls, `Promise.allSettled()` captures the `BudgetExceededError` as a rejected promise. The function collects any variants that completed successfully and throws `BudgetExceededWithPartialResults` containing those partial results, allowing the orchestrator to incorporate whatever was produced before the budget ran out.

The number of active tactics is controlled by `config.strategiesPerRound` (default 3, capped at the total number of available tactics). Feedback from previous ranking rounds can optionally be passed in to guide generation: the weakest dimension identified by ranking plus specific improvement suggestions are appended to each tactic's prompt, giving the LLM targeted direction for improvement.


## rankPool()

`evolution/src/lib/pipeline/rank.ts`

Ranks all variants in the pool through a two-phase process: triage for new entrants, then Swiss-system fine-ranking for the competitive core.

### Triage phase

New entrants (uncalibrated variants — uncertainty above the calibration threshold, all Elo-scale) face a gauntlet of stratified opponents drawn from the existing pool. For a default of 5 opponents, the selection is: 2 from the top quartile, 2 from the middle, and 1 from the bottom (preferring fellow new entrants for the bottom slot).

Two exit conditions short-circuit triage per entrant:

**Early exit.** After at least 2 matches, if the entrant has 2 or more decisive matches (confidence >= 0.7) AND average confidence across all matches is >= 0.8, triage ends. The entrant's rating is calibrated enough for fine-ranking.

**Elimination.** After at least 2 matches, if `r.elo + 2 * r.uncertainty < top20Cutoff` (where the cutoff is the `elo` of the variant at the 20th percentile, all Elo-scale), the entrant is eliminated from fine-ranking entirely. It will remain in the pool but will not consume further comparison budget.

### Swiss fine-ranking phase

After triage, fine-ranking runs on the competitive subset: variants that are not eliminated AND are either reasonably calibrated (low `uncertainty`) or are in the top-K by `elo`.

Pairing uses Bradley-Terry win probability (in Elo space, with `BETA_ELO`) to maximize information gain. For each potential pair, a score combines outcome uncertainty (how close to a coin flip the predicted result is) with average rating uncertainty (how uncertain the ratings still are). Pairs are greedily selected by descending score, ensuring each variant appears in at most one match per round.

Fine-ranking runs for up to 20 Swiss rounds, subject to a comparison budget that depends on cost pressure:

| Budget pressure | Max comparisons |
|-----------------|-----------------|
| Low (< 50% spent) | 40 |
| Medium (50-80% spent) | 25 |
| High (> 80% spent) | 15 |

Convergence is declared when all eligible variants' `uncertainty` values drop below `DEFAULT_CONVERGENCE_UNCERTAINTY` (72, Elo-scale) for two consecutive rounds.

```typescript
export interface RankResult {
  matches: V2Match[];
  ratingUpdates: Record<string, Rating>;
  matchCountIncrements: Record<string, number>;
  converged: boolean;
}
```

**Draw logic.** A match is treated as a draw when confidence < 0.3 (in fine-ranking) or when `winnerId === loserId` (a legacy V1 pattern preserved for compatibility). In triage, draws occur when confidence is exactly 0 or `winnerId === loserId`. Draws update both variants' ratings symmetrically via `updateDraw()`.

The Swiss pairing algorithm works by scoring every possible pair of eligible variants. The score for a pair is `outcomeUncertainty * averageUncertainty`, where outcome uncertainty is `1 - |2 * P(win) - 1|` using Bradley-Terry probability in Elo space (`pWin = 1 / (1 + exp(-(eloA - eloB) / BETA_ELO))`) and average uncertainty is the mean of both variants' Elo-scale `uncertainty` values. This prioritizes matches between closely rated but still uncertain variants, maximizing the information gained per comparison. Pairs are then greedily assigned in descending score order, with each variant used at most once per round. Already-completed pairs (tracked by a pair key set) are excluded from consideration.

The budget tier is determined by how much of the total run budget has been consumed. The function `getBudgetTier()` maps budget fraction to a tier: >= 80% spent is "high" pressure, >= 50% is "medium", and below 50% is "low". This ensures that late-stage iterations, when the budget is nearly exhausted, spend fewer comparisons on fine-ranking — preserving budget for the remaining generate and evolve phases.


## evolveVariants()

`evolution/src/lib/pipeline/evolve.ts`

Evolves existing high-quality variants through mutation and crossover. Selects the top 2 parents by `elo` from the current pool and applies up to four tactics:

**mutate_clarity** (always runs, on parent 0). Simplifies complex sentences, removes ambiguous phrasing, improves word choice for precision.

**mutate_structure** (always runs, on parent 0). Reorganizes for better flow, improves paragraph breaks, strengthens transitions, enhances logical progression.

**crossover** (runs if 2+ parents available). Combines the best structural elements from one parent with the best stylistic elements from the other. Both parent texts are passed in a single prompt.

**creative_exploration** (conditional). Produces a bold, significantly different version of parent 0. Only fires when `0 < diversityScore < 0.5`.

> **Warning:** The `diversityScore` option defaults to 1.0 when not provided. Since no caller currently computes or passes a diversity score, the condition `0 < diversityScore < 0.5` is never satisfied, meaning `creative_exploration` never fires in practice. This is a declared-but-unimplemented feature.

```typescript
export async function evolveVariants(
  pool: Variant[],
  ratings: Map<string, Rating>,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  options?: {
    feedback?: { weakestDimension: string; suggestions: string[] };
    diversityScore?: number;
  },
): Promise<Variant[]>
```

Unlike `generateVariants()` which runs tactics in parallel, `evolveVariants()` runs them sequentially. Each LLM output is format-validated; failures are silently discarded. New variants inherit `parentIds` from the selected parents and have `version` set to `maxVersion + 1` of the parents. (The "top 2 by `elo`" selection uses the public `Rating.elo` — formerly `mu` in the OpenSkill scale.)

`BudgetExceededError` propagates directly to the caller (no partial-results wrapping). If budget runs out after the first mutation succeeds but before crossover, the successfully created variants are lost. This is acceptable because the orchestrator's `executePhase()` wrapper handles the budget error at the iteration level.

The sequential execution means evolve is more vulnerable to budget exhaustion than generate (which runs in parallel and can salvage partial results). However, the most valuable tactics — clarity and structure mutation — run first, so if budget does run out mid-phase, the highest-priority variants are the ones most likely to have completed.


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


## Agent.run() Template Method

`evolution/src/lib/core/Agent.ts`

The `Agent` base class is generic over three type parameters:

```typescript
abstract class Agent<TInput, TOutput, TDetail extends ExecutionDetailBase>
```

Concrete agent classes implement `execute()` which returns `AgentOutput<TOutput, TDetail>`:

```typescript
interface AgentOutput<TOutput, TDetail extends ExecutionDetailBase> {
  result: TOutput;
  detail: TDetail;
  childVariantIds?: string[];
  parentVariantIds?: string[];
}
```

Two abstract members configure agent-specific observability:

- **`detailViewConfig: DetailFieldDef[]`** — config-driven field definitions used by the admin UI to render the invocation detail panel without custom per-agent components. Consumed by `ConfigDrivenDetailRenderer` in `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`.
- **`invocationMetrics?: FinalizationMetricDef[]`** — optional list of agent-specific metric definitions (e.g. `format_rejection_rate` for GenerationAgent, `total_comparisons` for RankingAgent). These are merged into `InvocationEntity` at startup via `agentRegistry.ts`.

**Per-invocation cost scope.** `Agent.run()` creates a per-invocation `AgentCostScope` (via `createAgentCostScope(ctx.costTracker)`) AND builds a per-invocation `EvolutionLLMClient` bound to the scope (from `ctx.rawProvider` + `ctx.defaultModel` via `createEvolutionLLMClient`). The client is injected into `input.llm` before `execute()` runs, so every `recordSpend()` the agent triggers goes through the scope's intercept. `MergeRatingsAgent` opts out via `usesLLM = false` (no LLM calls). `cost_usd` on the invocation row comes from `scope.getOwnSpent()` — only this agent's own LLM spend — instead of a before/after delta of the shared tracker. Under parallel dispatch, sibling agents' spend no longer bleeds into each invocation's `cost_usd`. The scope delegates `reserve()`, `release()`, and `getTotalSpent()` to the shared tracker so the per-run budget gate remains global. 
The `run()` method wraps each phase with budget-error handling, invocation cost tracking, and metric recording. It now additionally:

- Tracks wall-clock duration and writes `duration_ms` to the invocation row.
- Validates the returned `detail` object via Zod `safeParse` before writing it to the `execution_detail` JSONB column (malformed details are logged but do not fail the invocation).
- Patches `totalCost` into the detail before persisting.
- Passes `execution_detail` + `duration_ms` together in the `updateInvocation()` call.

Metrics are resolved via `getEntity(type).metrics` from the entity registry rather than a standalone `METRIC_REGISTRY`. Agent-specific metrics are merged in at registry init time (see Entities doc).

The `run()` method returns a `PhaseResult<T>` encoding four outcomes:

- **Success** — `{ success: true, result }`. The invocation row is updated with the cost delta, `duration_ms`, `execution_detail`, and `success: true`.
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

`createEvolutionLLMClient()` wraps a raw LLM provider with retry logic and cost tracking.

```typescript
export function createEvolutionLLMClient(
  rawProvider: { complete(prompt: string, label: AgentName, opts?: { model?: string }): Promise<string> },
  costTracker: V2CostTracker,
  defaultModel: string,
): EvolutionLLMClient
```

**Typed agent labels.** The second argument to `complete()` is `AgentName`, a typed union (`'generation' | 'ranking' | 'seed_title' | 'seed_article'`) defined in `evolution/src/lib/core/agentNames.ts`. Typos at the call site are caught at compile time. The `COST_METRIC_BY_AGENT` lookup maps each label to a static cost metric name: `'generation'` → `'generation_cost'`, `'ranking'` → `'ranking_cost'`, `'seed_title'`/`'seed_article'` → `'seed_cost'`. As a result, `generateFromPreviousArticle` reports per-purpose costs accurately (no more 50/50 approximation): every `'generation'` call increments `generation_cost`, every `'ranking'` call increments `ranking_cost`, and seed LLM calls (via `CreateSeedArticleAgent`) increment `seed_cost`.

**Retry policy.** Transient errors (network failures, rate limits) are retried up to 3 times with exponential backoff: 1s, 2s, 4s. Each individual call has a 20-second timeout. SDK-level retries are set to 0 (`maxRetries: 0`) so the evolution client's retry loop is the sole retry layer — worst-case per-call latency is 87 seconds (4 attempts × 20s + 7s backoff). `BudgetExceededError` is never retried since it represents a deliberate resource limit, not a transient failure.

**Cost tracking.** Before each call, the client estimates cost from the prompt length and expected output tokens (using chars/4 as a token approximation). After a successful call, actual cost is computed from input and output character counts and recorded via the cost tracker. The tracker buckets per-call cost under the typed agent label in `phaseCosts[label]` (race-free per-key accumulator under Node's single-threaded event loop). The client then writes `cost`, `generation_cost`, and `ranking_cost` to `evolution_metrics` via `writeMetricMax` — a Postgres RPC using `ON CONFLICT DO UPDATE SET value = GREATEST(...)` so concurrent out-of-order writes can never overwrite a larger value with a smaller one.

Model pricing is maintained in a lookup table covering common models (GPT-4.1 variants, GPT-4o variants, DeepSeek, Claude Sonnet 4, Claude Haiku 4.5). Unknown models use the most expensive pricing as a conservative fallback, with a `console.warn` alerting operators. Expected output tokens are estimated by label: generation calls assume 1000 tokens, ranking calls assume 100 tokens.

For cost optimization details including the budget tier system and model pricing, see [Cost Optimization](../cost_optimization.md).


## Prompt Construction

All generation and evolution prompts share a common structure built by `buildEvolutionPrompt()`. The function assembles:

1. A tactic-specific preamble (system role)
2. The source text under a labeled heading
3. Tactic-specific instructions
4. Format rules (the `FORMAT_RULES` constant) injected into every prompt to guide the LLM toward compliant output
5. An optional feedback section containing the weakest dimension and improvement suggestions from prior ranking

Comparison prompts (used during ranking) evaluate variants across four dimensions: clarity, structure, engagement, and grammar. The judge LLM returns a winner designation and confidence score. The feedback section is optional and only populated after the first iteration, when ranking data from previous rounds can identify the weakest dimension and generate targeted suggestions for improvement.

## Attribution Dimension (Phase 5)

Variant-producing agents can declare an attribution dimension by overriding `Agent.getAttributionDimension(detail)` to return a grouping string pulled from the agent's `execution_detail`. The `experimentMetrics.computeRunMetrics` aggregator groups produced variants by `(agent_name, dimension_value)`, computes mean ELO delta (child minus parent) across each group, and emits two dynamic metric families:

- `eloAttrDelta:<agentName>:<dimensionValue>` — mean delta + normal-approx 95% CI.
- `eloAttrDeltaHist:<agentName>:<dimensionValue>:<lo>:<hi>` — fraction of produced variants whose delta fell into each fixed 10-ELO bucket.

For `GenerateFromPreviousArticleAgent` the dimension is `execution_detail.strategy` (e.g., `lexical_simplify`). Swiss/merge agents return null and are excluded.

Consumed by `StrategyEffectivenessChart` (bar chart with CI whiskers) and `EloDeltaHistogram` (10-ELO buckets) on the run/strategy/experiment detail pages.

**Persistence wiring (track_tactic_effectiveness_evolution_20260422 Blocker 2, 2026-04-22)**: `computeEloAttributionMetrics` previously populated the in-memory bag but never persisted to `evolution_metrics` — callers were test-only. The Blocker 2 fix wires `computeRunMetrics(runId, db, { strategyId, experimentId })` into `persistRunResults.ts` at run finalization and extends `computeEloAttributionMetrics` to `writeMetric` each emitted row at all three entity levels. Gated by `EVOLUTION_EMIT_ATTRIBUTION_METRICS` (default `'true'`). Without this fix, `AttributionCharts` and the strategy Tactics tab would render empty — which is exactly what staging showed before the fix (32 orphaned test-only rows, zero live-run rows).

`StrategyEffectivenessChart` also renders bar labels as `<agent> / <dim>` (not `<dim>` alone) since Phase 5 of the same project, so agents sharing a dimension value (e.g. `lexical_simplify` used by multiple variant-producing agents) disambiguate correctly.

## Parent linkage (Phase 2)

Generate iterations accept `sourceMode` (`'seed'` default or `'pool'`) and `qualityCutoff` (`{ mode: 'topN' | 'topPercent', value }`) on each `IterationConfig`. When `sourceMode='pool'`, `resolveParent` picks a parent uniformly at random from the top-N or top-X% of the run's pool ranked by current ELO. The first iteration is locked to seed (pool is empty).

Seeded RNG derived from `(runId, iteration, executionOrder)` via FNV-1a ensures deterministic parent picks — identical retries pick identical parents.

**Arena entries are NOT eligible parents (2026-04-21).** `initialPoolSnapshot` — which resolveParent's caller computes — intentionally includes arena entries (loaded via `loadArenaEntries` from prior runs of the same prompt) so they participate in ranking as competitors. However, for **parent selection only**, `runIterationLoop.ts` filters `initialPoolSnapshot` to `inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena)` at the resolveParent call site. This matches the existing `persistRunResults.ts` convention (`.filter((v) => !v.fromArena)` at 5 places) and guarantees that a new variant's `parent_variant_id` always references the seed or another variant born in the same run. Before this fix, pool-mode iterations could produce variants whose `parent_variant_id` pointed to arena variants from other runs — staging run `6743c119-8a52-44e5-8102-0b1f4b212f40` was the canonical signature. When the filter drops all candidates (pool had arena entries but no in-run variants), the existing `empty_pool` fallback returns the seed and the call site emits a distinct `fallbackReason: 'no_same_run_variants'` warn-log context for diagnosability.

Discarded variants persist their local-rank ELO from the agent's binary-search ranking (not `createRating()` defaults), so Phase 3/5 metrics aren't survivorship-biased.
