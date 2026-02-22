# Comparison Infrastructure Research

## Problem Statement
The evolution pipeline currently operates as isolated per-run bubbles: variants are generated, ranked, and compared only within a single run. There is no mechanism to compare variants across different runs, and no way to seed the pipeline from a prompt rather than an existing article. The project aims to enable cross-run comparison and prompt-based variant generation.

**Ultimate goal**: Understand how article quality (Elo) depends on the generation approach and cost — specifically, compare using expensive models for 1-shot generation vs. using the evolution pipeline with cheaper models to iterate.

## High Level Summary

The evolution pipeline is a well-structured two-phase system (EXPANSION → COMPETITION) that generates text variants from existing article content, ranks them via Elo-based pairwise LLM comparisons, and selects winners through iterative selection pressure. Ten key findings emerged:

1. **All comparisons are strictly single-run scoped.** The `PipelineState`, `ComparisonCache`, Elo ratings, match history, and pool are all per-run in-memory structures. No cross-run queries or variant sharing exists anywhere in the codebase.

2. **Variant generation always requires `originalText` from an existing article.** The `AgentPayload.originalText` field is populated from `explanations.content` in the DB. The local CLI runner (`run-evolution-local.ts`) loads from a markdown file but still treats it as "original text" — there is no prompt-to-article generation pathway.

3. **The DB schema isolates variants per run.** `evolution_variants` has `run_id` (NOT NULL FK) but no cross-run reference columns. `parent_variant_id` is self-referencing within the same table but only used for within-run lineage. No content hash or global variant identity exists.

4. **The visualization layer supports only single-run analysis.** The compare page (`/admin/quality/evolution/run/[runId]/compare`) shows original vs winner for one run. No multi-run comparison UI exists.

5. **The `run_summary` JSONB column (migration 000009) stores post-run analytics** including `topVariants`, `baselineRank`, `strategyEffectiveness`, and `matchStats` — providing a potential foundation for cross-run comparison without re-reading full checkpoints.

6. **A 1-shot article generation pathway already exists** in `returnExplanation.ts` via `generateNewExplanation()`. It uses `createExplanationPrompt()` to generate a full article from a title in a single LLM call (model: `gpt-4.1-mini`). This is the production path for user-facing article generation.

7. **The LLM infrastructure supports multiple providers** but only cheaper models. `AllowedLLMModelType` includes: `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, `deepseek-chat`. No expensive models like `gpt-4o`, `gpt-4.1`, `o1`, or `claude-3.5-sonnet` are in the allowed list. Adding them requires updating the Zod enum in `schemas.ts`.

8. **The comparison agents (CalibrationRanker, PairwiseRanker, Tournament) can be reused** for cross-article comparison because they operate on text pairs, not on run-specific state. The core `compareWithBiasMitigation()` function takes `(idA, textA, idB, textB)` — any two texts can be compared regardless of origin.

## Documents Read
- `docs/docs_overall/getting_started.md` — documentation structure and reading order
- `docs/docs_overall/architecture.md` — system design, data flow, tech stack
- `docs/docs_overall/project_workflow.md` — project workflow steps
- `docs/feature_deep_dives/evolution_pipeline.md` — full evolution pipeline documentation
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — visualization layer docs

## Code Files Read

### Core Types & Config
- `src/lib/evolution/index.ts` — public API re-exports (47 lines)
- `src/lib/evolution/types.ts` — all cross-module interfaces: `TextVariation`, `PipelineState`, `AgentPayload`, `ExecutionContext`, `Match`, `Critique`, `MetaFeedback`, `EvolutionRunConfig`, `SerializedPipelineState`, `EvolutionRunSummary` + Zod schema (303 lines)
- `src/lib/evolution/config.ts` — `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()`, `ELO_CONSTANTS`, `K_SCHEDULE` (63 lines)

### Core Infrastructure (`src/lib/evolution/core/`)
- `pipeline.ts` — `executeMinimalPipeline()` and `executeFullPipeline()` orchestrators, `persistCheckpoint()`, `persistCheckpointWithSupervisor()`, `buildRunSummary()`, `insertBaselineVariant()` (~550 lines)
- `supervisor.ts` — `PoolSupervisor` with `detectPhase()`, `beginIteration()`, `getPhaseConfig()`, `shouldStop()`, `getResumeState()` (~243 lines)
- `state.ts` — `PipelineStateImpl` with append-only `addToPool()`, `serializeState()`, `deserializeState()` (~104 lines)
- `elo.ts` — `updateEloRatings()`, `updateEloDraw()`, `updateEloWithConfidence()`, `getAdaptiveK()` (~90 lines)
- `comparisonCache.ts` — `ComparisonCache` with order-invariant SHA-256 keys, `get()`, `set()` (~33 lines)
- `costTracker.ts` — `CostTrackerImpl` with per-agent budget caps, reservation, optimistic locking (~67 lines)
- `pool.ts` — `PoolManager` with `getCalibrationOpponents()` (stratified selection), `getEvolutionParents()` (~98 lines)
- `diversityTracker.ts` — `PoolDiversityTracker` lineage dominance detection (~80 lines)
- `llmClient.ts` — `createEvolutionLLMClient()` wrapping `callOpenAIModel` (~102 lines)
- `logger.ts` — `createEvolutionLogger()` factory (~33 lines)
- `featureFlags.ts` — `fetchEvolutionFeatureFlags()` for 3 evolution flags (~78 lines)
- `validation.ts` — `validateStateContracts()` for phase prerequisite guards (~63 lines)

### Agents (`src/lib/evolution/agents/`)
- `generationAgent.ts` — 3 strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`; parallel LLM calls; format validation; meta-feedback injection (~138 lines)
- `calibrationRanker.ts` — `buildComparisonPrompt()`, `comparePair()`, `compareWithBiasMitigation()` (2-call position bias protocol), stratified opponent selection, batched parallelism with early exit (~248 lines)
- `pairwiseRanker.ts` — simple + structured (5-dimension) comparison modes, dimension score merging across bias rounds (~312 lines)
- `tournament.ts` — Swiss-style pairing, budget-pressure tiers, multi-turn tiebreakers for close top-quartile matches, convergence detection (~293 lines)
- `evolvePool.ts` — `mutate_clarity`, `mutate_structure`, `crossover` (2 parents), `creative_exploration` (30% random or low diversity), dominant strategy avoidance (~298 lines)
- `reflectionAgent.ts` — 5-dimension critique (clarity, flow, engagement, voice_fidelity, conciseness), per-dimension scores 1-10 (~170 lines)
- `metaReviewAgent.ts` — pure computation (no LLM), strategy effectiveness analysis, weakness detection, parent→child Elo delta analysis (~180 lines)
- `proximityAgent.ts` — cosine similarity, sparse similarity matrix, diversity score (~135 lines)
- `formatRules.ts` — shared prose-only format rules string (~8 lines)
- `formatValidator.ts` — H1, sections, no-lists, paragraph sentence count checks (~93 lines)

### LLM Infrastructure
- `src/lib/services/llms.ts` — `callOpenAIModel()` with OpenAI + DeepSeek routing, streaming support, structured output, call tracking (~322 lines)
- `src/lib/schemas/schemas.ts` — `AllowedLLMModelType` Zod enum: `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, `deepseek-chat` (line ~119)
- `src/config/llmPricing.ts` — per-model pricing: deepseek $0.14/$0.28, gpt-4.1-nano $0.10/$0.40, gpt-4.1-mini $0.40/$1.60 per 1M tokens (~116 lines)

### Article Generation
- `src/lib/services/returnExplanation.ts` — main pipeline: `returnExplanationLogic()` orchestrates title generation → vector search → article generation → postprocessing (~750 lines)
- `src/lib/prompts.ts` — `createExplanationPrompt()`, `createExplanationWithSourcesPrompt()`, `editExplanationPrompt()`, `createTitlePrompt()` (~323 lines)
- `src/lib/services/explanationSummarizer.ts` — `generateAndSaveExplanationSummary()` fire-and-forget SEO metadata generation (~105 lines)

### Scripts
- `scripts/run-evolution-local.ts` — standalone CLI: `--file`, `--mock`, `--full`, `--iterations`, `--budget`, `--model`, `--explanation-id`; mock LLM with deterministic templates; direct OpenAI/DeepSeek client; optional Supabase persistence; variant insert with preserved UUIDs (~804 lines)
- `scripts/evolution-runner.ts` — batch runner: claim via RPC or fallback UPDATE, 60s heartbeat, graceful SIGTERM/SIGINT, dynamic imports (~278 lines)

### Server Actions
- `src/lib/services/evolutionActions.ts` — 8 actions: queue, trigger, get runs/variants, apply winner, rollback, cost breakdown, history (~596 lines)
- `src/lib/services/evolutionVisualizationActions.ts` — 6 read-only actions: dashboard, timeline, Elo history, lineage, budget, comparison (~565 lines)

### Admin Pages
- `src/app/admin/quality/evolution/page.tsx` — main management: runs table, variant panel, queue dialog, apply/rollback (~665 lines)
- `src/app/admin/quality/evolution/dashboard/page.tsx` — ops dashboard: stat cards, runs/spend trend charts, recent runs table (~187 lines)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — run detail: 5-tab shell (~131 lines)
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — before/after diff, quality radar (~165 lines)

### Database Migrations
- `20260131000001` through `20260131000009` — evolution pipeline tables
- `llmCallTracking` table (pre-existing) — estimated_cost_usd column, call_source for evolution agent attribution

## Detailed Findings

### Finding 1: Comparison System Architecture

All pairwise comparisons use a **position-bias mitigation protocol**: every comparison runs the LLM twice with reversed text order (A vs B, then B vs A). Agreement → confidence 1.0; disagreement → confidence 0.5 (treated as near-draw). This doubles LLM costs but produces fair rankings.

Three ranking agents exist:
- **CalibrationRanker**: For new entrants against stratified opponents (top/middle/bottom Elo quartiles). Uses batched parallelism with early exit after `minOpponents` decisive matches.
- **PairwiseRanker**: Full O(n²) comparison with optional 5-dimension structured mode (`clarity`, `flow`, `engagement`, `voice_fidelity`, `conciseness`).
- **Tournament**: Swiss-style iterative pairing. Budget-pressure adaptive depth (3 tiers). Multi-turn tiebreakers for close top-quartile matches. Convergence detection via Elo std-dev.

The `ComparisonCache` uses order-invariant SHA-256 keys (sorted text pair + lengths + structured flag). It lives in-memory per-run and does not persist across runs.

**Key constraint for cross-run comparison**: Agents have no DB access — they operate entirely on `PipelineState` which is populated per-run. Cross-run comparison would require either injecting external variants into the state or creating a new comparison pathway outside the agent framework.

### Finding 2: Variant Generation Pipeline

Generation always starts from `originalText` (existing article content). Three strategies produce initial variants:
- `structural_transform`: Aggressive restructuring (reorder, merge/split, invert structure)
- `lexical_simplify`: Clarity improvements (simpler words, shorter sentences)
- `grounding_enhance`: Concreteness (specific examples, sensory details)

Evolution strategies build on top-ranked parents:
- `mutate_clarity` / `mutate_structure`: Single-parent refinements
- `crossover`: Two-parent combination (falls back to mutation if <2 parents)
- `creative_exploration`: 30% random or triggered by low diversity; avoids overrepresented strategies

A baseline variant (`original_baseline`) is inserted at pipeline start for Elo comparison reference.

**Key constraint for prompt-based generation**: The `AgentPayload` interface requires `originalText: string` (the full article text). `GenerationAgent.canExecute()` checks `state.originalText.length > 0`. There is no prompt expansion or article generation step — the pipeline assumes it receives complete content to iterate on.

### Finding 3: Database Schema

**`evolution_runs`**: Core run table. `explanation_id` is nullable (CLI runs can have null). `source` column distinguishes `'explanation'` vs `'local:<filename>'`. `config` JSONB stores per-run overrides. `run_summary` JSONB stores post-run analytics.

**`evolution_variants`**: Variants scoped to a run via `run_id` (NOT NULL FK). `parent_variant_id` is a self-referencing FK for within-run lineage. `explanation_id` is nullable (for CLI runs). No content hash or cross-run variant identity.

**`evolution_checkpoints`**: Full serialized `PipelineState` (pool, Elo ratings, match history, critiques, diversity, meta-feedback) stored as JSONB. Unique on `(run_id, iteration, last_agent)`. Used for crash recovery and visualization (Elo history, lineage DAG).

**`llmCallTracking`**: Pre-existing table used by evolution for cost attribution. `call_source` column stores `'evolution_{agentName}'`. Budget tab visualization queries this by time window.

### Finding 4: Visualization & Comparison UI

The visualization layer has 6 server actions and 5 tab components, all operating on single-run data. No mechanism exists to compare winners from different runs or show variants from multiple runs side-by-side.

### Finding 5: Local CLI Runner

`scripts/run-evolution-local.ts` provides a standalone entry point that loads content from a markdown file. This is the closest existing pathway to "prompt-based" generation — but still requires a complete article as input, not a prompt.

### Finding 6: Run Summary Structure

The `EvolutionRunSummary` persisted in `run_summary` JSONB contains `topVariants`, `baselineRank`, `strategyEffectiveness`, `matchStats`, `eloHistory`, `diversityHistory`. This enables cross-run metric comparison without loading full checkpoints.

### Finding 7: Existing Article Generation Infrastructure

`returnExplanation.ts` contains `generateNewExplanation()` which generates a full article from a title in a single `callOpenAIModel()` call. The prompt template (`createExplanationPrompt()` in `prompts.ts`) produces markdown with `##` sections, bold key terms, and modular paragraphs. This is the production path for user-facing articles.

**Current flow**: user query → `generateTitleFromUserQuery()` → `generateNewExplanation(title)` → postprocessing (heading titles, tags, link candidates) → save to DB.

The article generation LLM call is a single non-structured completion using the default model (`gpt-4.1-mini`). Switching to an expensive model requires only passing a different `model` parameter.

### Finding 8: LLM Model & Pricing Infrastructure

**Allowed models** (Zod enum in `schemas.ts`): `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`, `deepseek-chat`.

**Pricing per 1M tokens** (from `llmPricing.ts`):
| Model | Input | Output |
|-------|-------|--------|
| `deepseek-chat` | $0.14 | $0.28 |
| `gpt-4.1-nano` | $0.10 | $0.40 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `gpt-5-mini` | — | — |
| `gpt-5-nano` | — | — |

### Finding 9: Cost Tracking Infrastructure

Cost is tracked at two levels, both of which are needed for the article bank:

**Per-LLM-call**: Every call to `callOpenAIModel()` inserts into `llmCallTracking` with `prompt_tokens`, `completion_tokens`, `estimated_cost_usd`, `model`, `call_source`, and `created_at`. Cost is computed via `calculateLLMCost()` in `llmPricing.ts` using per-model token pricing. The `call_source` field identifies the origin (e.g., `'generateNewExplanation'`, `'evolution_calibration'`, `'evolution_generation'`).

**Per-evolution-run**: `evolution_runs.total_cost_usd` aggregates all LLM spend for the run. This is updated during pipeline execution via `CostTracker.getTotalSpent()`. The evolution visualization's budget tab also queries `llmCallTracking` by time window to attribute costs per agent.

**Key gap for article bank**: For 1-shot generation, cost is currently only in `llmCallTracking` rows — there's no single field that stores "total cost of generating this article." The `generate-article.ts` script (Phase 1) must sum all `llmCallTracking` entries for its session and store the total on `article_bank_entries.total_cost_usd`. For evolution winners, the cost is readily available from `evolution_runs.total_cost_usd`.

**Missing for 1-shot expensive generation**: No expensive models (e.g., `gpt-4o`, `gpt-4.1`, `o1`, `o3-mini`, `claude-3.5-sonnet`, `claude-3-opus`) in the allowed list. Adding them requires:
1. Update `allowedLLMModelSchema` in `schemas.ts`
2. Add pricing entries in `llmPricing.ts`
3. Add routing logic if non-OpenAI/DeepSeek provider (e.g., Anthropic)

**Provider routing**: `callOpenAIModel()` routes by model name prefix — `deepseek-*` → DeepSeek client, everything else → OpenAI client. Anthropic models would need a new client path.

### Finding 10: Existing Admin UI Patterns (from Visualization Project)

The evolution visualization project (see `docs/planning/visualization_tool_for_evolution_pipeline_20260131`) established UI patterns that the article bank should follow:

- **Page architecture**: Dedicated sub-pages under `/admin/quality/`, not embedded in existing pages
- **Data layer**: Read-only server actions with `withLogging` + `requireAdmin` + `serverReadRequestId` pattern
- **Charts**: Recharts loaded via `next/dynamic` with `{ ssr: false }` to avoid SSR crashes
- **Text diff**: Uses `diff@8.0.2` package (`diffWordsWithSpace()`) — already installed, renders inline `<span>` elements (green insert, red delete)
- **Theme**: Midnight Scholar CSS variables (`var(--surface-elevated)`, `var(--text-primary)`, etc.), no raw Tailwind color classes
- **Tabs**: Simple state-driven, each tab loads data lazily on selection
- **Run detail page**: Already has header with status badge, phase indicator, "Compare" link — adding "Add to Bank" button follows existing button placement pattern
- **Existing components**: `EvolutionStatusBadge`, `VariantCard`, `EloSparkline` in `src/components/evolution/` can be reused for bank entries that come from evolution runs
