# Outline Based Generation Editing Research

## Process Reward Models (Step-Level Feedback)

**Current approach**: Score the final text variant as a whole.

**New approach**: Decompose generation into steps (outline → expand → polish → verify) and score *each step* independently. A variant might have excellent structure (step 1 score: 0.95) but weak examples (step 3 score: 0.4).

**Why it matters**: Instead of randomly mutating the whole text, you can surgically target weak steps. "Step 3 is weak, only mutate that." This produces 40-60% faster convergence because mutations are focused, not random.

---

**Date**: 2026-02-06T15:26:13Z
**Git Commit**: 77968fd
**Branch**: feat/outline_based_generation_editing_20260206

## Problem Statement
Understanding the full evolution pipeline codebase — its architecture, agent framework, state management, rating system, and integration points — to inform the design of outline-based generation and editing capabilities.

## High Level Summary

The evolution pipeline is a self-contained subsystem under `src/lib/evolution/` (~5,500 LOC across 30 source files) that autonomously improves article text through iterative LLM-driven generation, competition, and refinement. It uses an evolutionary algorithm: a pool of text variants competes via LLM-judged pairwise comparisons with OpenSkill Bayesian ratings, top performers reproduce via mutation/crossover, and the population converges toward higher quality.

The system has two phases (EXPANSION → COMPETITION), 11 agents orchestrated by a PoolSupervisor, checkpoint/resume capability, budget enforcement with per-agent caps, and multiple entry points (admin UI, batch runner, CLI).

Key architectural patterns relevant to outline-based generation:
- **Agent framework** (`AgentBase`): any new agent plugs into the pipeline by implementing `execute()`, `estimateCost()`, `canExecute()`
- **GenerationAgent** creates variants using 3 hardcoded strategies — this is the natural extension point for outline-based generation
- **IterativeEditingAgent** performs surgical edits gated by blind diff judge — this pattern could support outline-guided editing
- **Format enforcement** (`formatValidator.ts`) validates all generated text against prose rules
- **PipelineState** is the shared mutable state; all agents read/write via well-defined interfaces

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/comparison_infrastructure.md

## Code Files Read

### Top-Level Evolution Module (`src/lib/evolution/`)
- `types.ts` (381 lines) — All shared interfaces: TextVariation, PipelineState, ExecutionContext, EvolutionRunConfig, EvolutionRunSummary with V1→V2 Zod migration
- `config.ts` (55 lines) — DEFAULT_EVOLUTION_CONFIG, resolveConfig() for per-run overrides, RATING_CONSTANTS
- `comparison.ts` (120 lines) — Standalone bias-mitigated pairwise comparison with 2-pass A/B reversal, order-invariant SHA-256 caching
- `diffComparison.ts` (123 lines) — CriticMarkup diff-based comparison with direction reversal for IterativeEditingAgent; uses dynamic ESM imports for unified/remark-parse
- `index.ts` (57 lines) — Barrel export re-exporting all public API from core/, agents/, and shared modules

### Core Infrastructure (`src/lib/evolution/core/`) — 15 files
- `pipeline.ts` (681 lines) — Pipeline orchestrator with two modes: executeMinimalPipeline (testing) and executeFullPipeline (production with supervisor, checkpoints, OTel)
- `supervisor.ts` (265 lines) — PoolSupervisor managing EXPANSION→COMPETITION one-way transition, plateau detection, strategy rotation
- `state.ts` (127 lines) — PipelineStateImpl with append-only pool, serialization/deserialization, Elo→Rating backward compat
- `rating.ts` (86 lines) — OpenSkill (Weng-Lin Bayesian) rating: createRating(), updateRating(), updateDraw(), getOrdinal() = mu - 3σ, ordinalToEloScale()
- `costTracker.ts` (75 lines) — Budget enforcement with 30% safety margin pre-call reservation, per-agent caps
- `comparisonCache.ts` (42 lines) — Order-invariant SHA-256 cache for bias-mitigated comparison results
- `pool.ts` (134 lines) — PoolManager with stratified opponent selection (ordinal quartile-based) and pool health stats
- `diversityTracker.ts` (110 lines) — Lineage dominance detection, strategy diversity analysis, trend computation (no LLM calls)
- `validation.ts` (90 lines) — State transition guard predicates for agent-step phase contracts
- `llmClient.ts` (107 lines) — Evolution LLM client wrapping callLLM with budget enforcement, structured JSON parsing, default model deepseek-chat
- `logger.ts` (15 lines) — Factory adding {subsystem: 'evolution', runId} context to all log entries
- `featureFlags.ts` (67 lines) — 5 feature flags from DB: tournament, evolvePool, dryRun, debate, iterativeEditing
- `adaptiveAllocation.ts` (248 lines) — Adaptive budget allocation based on historical agent ROI (Elo per dollar)
- `costEstimator.ts` (356 lines) — Data-driven run cost estimation with historical baselines, text-length scaling, heuristic fallback
- `strategyConfig.ts` (156 lines) — Strategy config fingerprinting, hashing, labeling for multi-config comparison

### Agents (`src/lib/evolution/agents/`) — 13 files (11 agents + 2 utils)
- `base.ts` (18 lines) — Abstract AgentBase: execute(), estimateCost(), canExecute()
- `formatRules.ts` (9 lines) — Shared FORMAT_RULES constant (prose-only: no bullets/lists/tables)
- `formatValidator.ts` (94 lines) — Validates text against format rules; modes: reject/warn/off
- `generationAgent.ts` (138 lines) — Creates 3 variants per iteration using structural_transform, lexical_simplify, grounding_enhance strategies
- `calibrationRanker.ts` (216 lines) — Rates new entrants vs stratified opponents with adaptive early exit
- `pairwiseRanker.ts` (298 lines) — Full pairwise comparison with simple and structured (5-dimension) modes
- `tournament.ts` (345 lines) — Swiss-style tournament with info-theoretic pairing, budget-adaptive depth, sigma-based convergence
- `evolvePool.ts` (299 lines) — Mutation (clarity/structure), crossover, creative exploration (30% random or low diversity)
- `reflectionAgent.ts` (215 lines) — Dimensional critique of top 3 variants across 5 dimensions (clarity, structure, engagement, precision, coherence)
- `iterativeEditingAgent.ts` (337 lines) — Critique-driven surgical edits with blind diff-based LLM judge and direction-reversal bias mitigation
- `debateAgent.ts` (336 lines) — Structured 3-turn debate (Advocate A / Advocate B / Judge) producing synthesis variant
- `metaReviewAgent.ts` (227 lines) — Pool analysis: successful strategies, weaknesses, failure patterns, priority improvements (no LLM calls)
- `proximityAgent.ts` (159 lines) — Cosine similarity embeddings (hash-based test mode), sparse similarity matrix, diversity score = 1 - mean(top-10 similarities)

### Integration Points (outside `src/lib/evolution/`)
- `src/lib/services/evolutionActions.ts` (~648 lines) — 9 server actions: queue, trigger, get runs/variants/summary, apply winner, rollback, cost breakdown, history
- `src/lib/services/evolutionVisualizationActions.ts` (~710 lines) — 6 read-only visualization actions: dashboard, timeline, Elo history, lineage, budget, comparison
- `src/lib/services/articleBankActions.ts` (~1173 lines) — 14 bank actions: topic CRUD, entry CRUD, Elo ranking, Swiss comparison, cross-topic summary, prompt bank coverage
- `scripts/run-evolution-local.ts` (~1113 lines) — Standalone CLI: --file/--prompt, --mock, --full, --bank, --bank-checkpoints
- `scripts/evolution-runner.ts` (~298 lines) — Batch runner: atomic claiming, heartbeat, graceful shutdown

## Architecture Documentation

### Two-Phase Pipeline with Supervisor

The PoolSupervisor (`core/supervisor.ts`) drives a one-way EXPANSION → COMPETITION transition:

**EXPANSION** (iterations 0-N): Build diverse pool
- GenerationAgent creates 3 variants/iteration (all 3 strategies)
- CalibrationRanker: new entrants vs 3 stratified opponents
- ProximityAgent: diversity score

**Transition**: pool ≥ 15 AND diversity ≥ 0.25, OR iteration ≥ 8 (safety cap)

**COMPETITION** (iterations N+1 to max): Refine best
- All 8 agents (Generation, Reflection, IterativeEditing, Debate, Evolution, Tournament/Calibration, Proximity, MetaReview)
- Feature flags can disable IterativeEditing, Debate, EvolutionAgent, Tournament

**Stopping Conditions**: Quality plateau, budget exhausted, max iterations (15), degenerate state (diversity < 0.01)

### Agent Framework

All agents extend `AgentBase`:
```typescript
abstract class AgentBase {
  abstract readonly name: string;
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;
  abstract estimateCost(payload: AgentPayload): number;
  abstract canExecute(state: PipelineState): boolean;
}
```

ExecutionContext provides: payload, state, llmClient, logger, costTracker, runId, comparisonCache.

### State Model

`PipelineStateImpl` is the mutable shared state:
- **Pool fields**: iteration, originalText, pool (append-only), poolIds (dedup Set), newEntrantsThisIteration
- **Ranking fields**: ratings (Map<string, Rating>), matchCounts, matchHistory
- **Review fields**: dimensionScores, allCritiques
- **Proximity fields**: similarityMatrix, diversityScore
- **Meta fields**: metaFeedback, debateTranscripts

Key methods: `addToPool()` (auto-initializes rating), `startNewIteration()`, `getTopByRating(n)`

### Rating System (OpenSkill)

Replaced Elo with Weng-Lin Bayesian ratings (`core/rating.ts`):
- Each variant: `{mu: 25, sigma: 8.333}` (defaults)
- Ordinal = mu - 3σ (conservative, penalizes uncertainty)
- Convergence: sigma < 3.0
- Backward compat: ordinalToEloScale() maps to 0-3000 range for DB/UI

### Generation Strategies

GenerationAgent uses 3 hardcoded strategies:
1. `structural_transform` — Aggressively restructure while preserving meaning
2. `lexical_simplify` — Simplify vocabulary and sentence length
3. `grounding_enhance` — Add specific examples, details, sensory elements

EvolutionAgent uses:
1. `mutate_clarity` — Simplify complex sentences, improve word choice
2. `mutate_structure` — Reorganize flow, strengthen transitions
3. `crossover` — Combine best elements of two parents
4. `creative_exploration` — Bold, significantly different approach (30% trigger)

### Format Enforcement

All generated text must pass `validateFormat()`:
- Exactly one H1 title on first line
- At least one ## or ### heading
- No bullets, numbered lists, or tables (outside code fences)
- ≥75% of paragraphs must have 2+ sentences

### Budget Enforcement

CostTracker (`core/costTracker.ts`):
- Per-agent caps: generation 25%, calibration 15%, tournament 25%, evolution 15%, reflection 5%, debate 5%, iterativeEditing 10%
- Pre-call reservation with 30% safety margin
- BudgetExceededError pauses run (not fails)

### Cross-Agent Data Dependencies

| Agent | Reads From | Writes To |
|-------|-----------|----------|
| GenerationAgent | originalText, metaFeedback | pool |
| CalibrationRanker | newEntrants, pool, ratings | ratings, matchCounts, matchHistory |
| Tournament | pool, ratings, matchCounts | ratings, matchCounts, matchHistory |
| ReflectionAgent | pool (top 3), ratings | allCritiques, dimensionScores |
| IterativeEditingAgent | pool (top 1), allCritiques, ratings | pool |
| DebateAgent | pool (top 2 non-baseline), allCritiques, metaFeedback | pool, debateTranscripts |
| EvolutionAgent | pool, ratings, metaFeedback, diversityScore | pool |
| ProximityAgent | newEntrants, pool, similarityMatrix | similarityMatrix, diversityScore |
| MetaReviewAgent | pool, ratings, diversityScore | metaFeedback |

### Persistence & Checkpointing

- **Checkpoints**: Serialized PipelineState + supervisor state after every agent → `evolution_checkpoints` table
- **Variants**: Pool variants persisted to `content_evolution_variants` with Elo scores
- **Run summary**: EvolutionRunSummary (Zod-validated JSONB) with stop reason, ordinal/diversity history, match stats, strategy effectiveness
- **LLM calls**: Tracked in `llmCallTracking` for cost attribution by agent

### Entry Points

1. **Admin UI** → `triggerEvolutionRunAction()` → `executeFullPipeline()` with all 9 agents
2. **Batch runner** (`evolution-runner.ts`) → Claims pending runs atomically, 60s heartbeat, graceful shutdown
3. **Local CLI** (`run-evolution-local.ts`) → Standalone with --file/--prompt, --mock, --full, --bank
4. **Article Bank** → Stores winners/baselines, Swiss-style Elo comparisons across generation methods

---

## Round 2 Research: Prompt Templates, Critique System, Initial Generation, Editor

### Generation Prompt Templates (All Strategies)

#### GenerationAgent — 3 Strategies

**structural_transform**: "You are a bold writing architect who completely reimagines how text is organized." Allows complete reordering, section merging/splitting, structural inversion (conclusion-first, bottom-up). Must preserve original intention/meaning. "Do NOT make timid, incremental changes — reimagine the organization from scratch."

**lexical_simplify**: "You are a writing expert specializing in clarity and simplification." Replace complex words with simpler alternatives, shorten long sentences, remove jargon. Accessibility-focused.

**grounding_enhance**: "You are a writing expert specializing in concrete and vivid writing." Add specific examples/details, make abstract concepts concrete, include sensory details, strengthen real-world connections.

All strategies receive `metaFeedback.priorityImprovements` as "Previous Feedback" section when available.

#### EvolutionAgent — 4 Strategies

**mutate_clarity**: Expert editor improving clarity — simplify complex sentences, remove ambiguous phrasing, improve word choices for precision.

**mutate_structure**: Expert editor improving structure — reorganize for better flow, improve paragraph breaks, strengthen transitions, enhance logical progression.

**crossover**: Combine best structural elements from one parent + best stylistic elements from other. "Creates something better than either parent alone."

**creative_exploration** (30% trigger or low diversity): "Create a SIGNIFICANTLY DIFFERENT version." Bold, unconventional phrasing/tone/organization. Avoids overrepresented strategies.

#### DebateAgent — 4 Sequential Prompts

1. **Advocate A**: Argue why Variant A is superior. Cite exact passages. Cover strengths of A, weaknesses of B, dimension analysis.
2. **Advocate B**: Rebut A's claims with counter-evidence. Argue for Variant B. Identify overlooked strengths.
3. **Judge**: Produce JSON verdict: `{winner, reasoning, strengths_from_a, strengths_from_b, improvements}`.
4. **Synthesis**: Combine best of both variants, apply judge's improvements, include FORMAT_RULES.

### Critique & Targeting System (Process Reward Model Analog)

#### ReflectionAgent — 5-Dimensional Critique

Dimensions: `clarity`, `structure`, `engagement`, `precision`, `coherence`

For each dimension provides: score (1-10), good example (quoted), bad example (quoted), notes.

Critiques top 3 variants in parallel. Stores in `state.allCritiques[]` and `state.dimensionScores[variantId]`.

Helper functions:
- `getCritiqueForVariant(id, state)` → lookup critique
- `getWeakestDimension(critique)` → lowest-scoring dimension
- `getImprovementSuggestions(critique)` → all dimensions < 7

#### IterativeEditingAgent — Critique-Driven Surgical Loop

**Config**: maxCycles=3, maxConsecutiveRejections=3, qualityThreshold=8

**Loop per cycle**:
1. **Pick target**: Weakest dimension (< qualityThreshold), sorted ascending. Or open-ended suggestion.
2. **Generate edit**: Surgical prompt — "Fix ONLY the identified weakness while preserving all other qualities." Shows dimension name, score, bad examples, notes. Length within 10%.
3. **Blind judge**: `compareWithDiff()` — CriticMarkup diff with 2-pass direction reversal. Judge sees ONLY the diff, not what was being fixed.
4. **If ACCEPT**: Create variant (`critique_edit_{dimension}` or `critique_edit_open`), re-evaluate with fresh critique + open review.
5. **If REJECT**: Increment rejection counter, try next target.

**Open review**: Separate freeform prompt — "Identify the 2-3 most impactful improvements. Do NOT use a rubric or fixed dimensions." Returns JSON suggestions array.

**Re-evaluation after acceptance**: Runs fresh inline critique + open review to detect if edit fixed one dimension but broke another.

#### DiffComparison — Direction Reversal Truth Table

| Forward | Reverse | Result | Confidence | Reasoning |
|---------|---------|--------|------------|-----------|
| ACCEPT | REJECT | ACCEPT | 1.0 | Consistent: edit improves |
| REJECT | ACCEPT | REJECT | 1.0 | Consistent: edit harms |
| ACCEPT | ACCEPT | UNSURE | 0.5 | Framing bias detected |
| REJECT | REJECT | UNSURE | 0.5 | Framing bias detected |
| UNSURE | any | UNSURE | 0.3 | Insufficient signal |

#### MetaReviewAgent — Zero-Cost Pattern Synthesis

4 analysis functions (no LLM calls):
1. `_analyzeStrategies()` → strategies with above-average ordinal (successful)
2. `_findWeaknesses()` → patterns in bottom-quartile variants
3. `_findFailures()` → strategies with consistent parent→child regression (avg delta < -3)
4. `_prioritize()` → diversity collapse, variant similarity, stagnation, strategy coverage

### Initial Article Generation Pipeline (Pre-Evolution)

**Two-stage prompt chain**: Query → Title → Content

**Stage 1: Title Generation** (`createTitlePrompt`)
- Wikipedia-style article title from user query
- Returns JSON with `{title1, title2, title3}`
- Model: gpt-4.1-mini

**Stage 2: Content Generation** (`createExplanationPrompt`)
- "Write a clear, concise explanation using modular paragraphs of 5-10 sentences each"
- Rules: Markdown only, ## section headers, bold key terms, math support, sparse lists
- Variants: standard, sources-grounded (with [n] citations), edit/rewrite

**Post-processing** (parallel): heading standalone titles, tag evaluation, link candidate extraction, content cleanup

**Key finding: NO outline-based generation exists.** Current system generates full text in one LLM call. No section-by-section generation. No intermediate outlines or planning steps.

### Lexical Editor & AI Suggestions System

#### AI Suggestion Pipeline (4 Steps)
1. **Generate suggestions**: LLM produces `{edits: [text, "... existing text ...", text, ...]}` — alternating pattern of edits and markers
2. **Apply suggestions**: Lighter LLM applies edits to original text
3. **Generate diff**: `RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST)` — multi-pass: paragraph → sentence → word
4. **Preprocess**: Convert CriticMarkup to DiffTagNodes for editor rendering

#### Multi-Pass Diffing Algorithm
- **Paragraph-level**: If >40% different → atomic replacement
- **Sentence-level**: Align by similarity, threshold 30%
- **Word-level**: `diffWordsWithSpace()` for granular changes
- **Atomic policy**: Headings, code, tables, lists → always atomic

#### CriticMarkup Notation
- `{++inserted text++}` — green highlight
- `{--deleted text--}` — red strikethrough
- `{~~before~>after~~}` — yellow replacement

#### DiffTag Accept/Reject UI
- Custom Lexical nodes (`DiffTagNodeInline`, `DiffTagNodeBlock`)
- Event delegation via `DiffTagHoverPlugin`
- Accept: keep new content / Reject: keep old content
- Block-level diff nodes exist for section-level operations

#### Page Lifecycle State Machine
`idle → loading → streaming → viewing → editing → saving`

#### Existing Abstractions Relevant to Outline Editing
Already exists:
- Heading hierarchy detection (`nodeContainsHeading()`, `promoteNodesAfterImport()`)
- Block-level diff nodes (`DiffTagNodeBlock`) for wrapping entire sections
- Markdown round-trip (export/import per-section)
- Multi-granularity diffing (paragraph, sentence, word levels)

Missing for outline support:
- Outline sidebar component (visual heading hierarchy)
- Section-level AI suggestion pipeline
- Collapse/expand UI for sections
- Section reordering UI
- Per-section save

### No Existing Outline/Skeleton Code

Searched for "outline", "skeleton", "TOC", "table of contents" across all evolution agents, editor files, and generation prompts. **No dedicated outline generation or manipulation exists.** However, structural awareness is pervasive:
- `structural_transform` strategy explicitly mentions "reorganize around a different structural principle"
- `mutate_structure` targets "flow, paragraph breaks, transitions"
- FORMAT_RULES mandate heading hierarchy (H1 + ##/### sections)
- Editor detects and promotes headings as top-level structural elements
