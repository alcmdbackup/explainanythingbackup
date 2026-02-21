# Judge Article Flow Research

## Problem Statement
Evaluate "flow" of writing — how little friction a reader feels: ideas progress in a sensible order, transitions connect paragraphs, sentences vary in rhythm, and the voice stays consistent. To grade it without humans, use blind A/B pairwise judging ("which version reads more smoothly and naturally?") with a separate judge model, and require the judge to point to exact friction spots (sentences) it would revise. The rubric can be a handful of 0–5 sub-scores: local cohesion (sentence-to-sentence glue), global coherence (paragraph arc), transition quality, rhythm/variety (no monotone sentence patterns), referent clarity (no vague "this/it"), and redundancy — and penalize abrupt topic jumps, repeated sentence openers, and pronouns without clear antecedents.

## Requirements (from GH Issue #384)
[To be provided]

## High Level Summary

The evolution pipeline has a rich existing comparison and judging infrastructure that this project can extend. The key integration points are:

1. **Existing comparison infrastructure** (`comparison.ts`, `diffComparison.ts`) provides two-pass bias-mitigated judging with A/B reversal. Currently evaluates on 5 generic criteria: clarity, readability, structure, flow, engagement.

2. **ReflectionAgent** already evaluates on 5 dimensions (clarity, structure, engagement, precision, coherence) with scores 1-10 and concrete good/bad examples. The "flow" rubric (local cohesion, global coherence, transition quality, rhythm/variety, referent clarity, redundancy) is a more granular replacement/extension of the existing dimensions.

3. **PairwiseRanker** (`pairwiseRanker.ts`) has a "structured" comparison mode that scores 5 dimensions: clarity, flow, engagement, voice_fidelity, conciseness. The "flow" dimension already exists but is coarse-grained (single score).

4. **IterativeEditingAgent** uses dimensional critique to target the weakest dimension for surgical edits. A flow rubric with sub-scores would give this agent more precise edit targets.

5. **TreeSearchAgent** uses critique-driven revision actions. Flow sub-scores would enable `edit_dimension` actions targeting specific flow defects.

6. **Hall of Fame comparisons** use `compareWithBiasMitigation()` with a generic prompt. A flow-specific comparison prompt would evaluate which article "reads more smoothly and naturally."

### Where "Flow" Currently Lives in the Codebase

| Component | Current Flow-Related Behavior | File |
|-----------|-------------------------------|------|
| `buildComparisonPrompt()` | "Structure and flow" as one of 5 generic criteria | `comparison.ts:14-37` |
| `CRITIQUE_DIMENSIONS` | "coherence" dimension (closest to flow) | `agents/reflectionAgent.ts` |
| PairwiseRanker structured mode | "flow" as one of 5 dimensions | `agents/pairwiseRanker.ts` |
| `buildDiffJudgePrompt()` | "Structure and flow" in evaluation criteria | `diffComparison.ts:68-92` |
| FormatRules | Enforces paragraph structure (≥2 sentences), no bullets/lists | `agents/formatRules.ts` |
| FormatValidator | Validates paragraph completeness | `agents/formatValidator.ts` |

### Architecture Patterns to Follow

- **Agent extension**: New dimensions can be added to `CRITIQUE_DIMENSIONS` in `reflectionAgent.ts` — downstream consumers (IterativeEditingAgent, TreeSearchAgent) will pick them up automatically.
- **Comparison prompt customization**: `buildComparisonPrompt()` is a standalone function — a flow-specific variant can be built alongside it.
- **Feature flags**: New behavior can be gated via `feature_flags` table (pattern in `core/featureFlags.ts`).
- **Budget caps**: New agents or extended judging needs a budget allocation in `config.ts:budgetCaps`.
- **Zod schemas**: All structured LLM outputs are validated via Zod (pattern in `core/llmClient.ts:completeStructured()`).

## Additional Findings (Round 2)

### Hierarchical Decomposition Agent
The `SectionDecompositionAgent` uses a **parse-parallel-stitch** pattern: H2 section splitting → parallel per-section critique→edit→judge (max 2 cycles) → stitch accepted edits. Judge mechanism is identical to IterativeEditingAgent: `compareWithDiff()` with direction-reversal bias mitigation. Budget reserved upfront before fanout (10% cap). Stitched variant competes directly with whole-article variants via tournament Elo. This is relevant because flow evaluation at the section level (paragraph arc, transition quality between sections) maps naturally to this decomposition.

### Outline-Based Generation & Step-Level Scoring
The `OutlineGenerationAgent` produces `OutlineVariant` with per-step scores (0-1) via a **Process Reward Model** pattern: outline→score→expand→score→polish→score→verify. The `weakestStep` field feeds into IterativeEditingAgent via `step:${stepName}` targeting. The "polish" step specifically targets "transitions, flow, coherence" — the most flow-relevant generation step. Step scores use `parseStepScore()` which clamps to [0,1] and defaults to 0.5 on parse failure. This step-level decomposition could inform a flow-specific scoring pipeline.

### Markdown AST Diffing
The `RenderCriticMarkupFromMDAstDiff()` function performs a **3-pass hierarchical diff**: paragraph-level (40% similarity threshold) → sentence-level (30% threshold) → word-level (70% threshold via `diff` library). This is the engine behind `compareWithDiff()` in `diffComparison.ts`. CriticMarkup output (`{++inserted++}`, `{--deleted--}`, `{~~old~>new~~}`) is used by the blind judge. Relevant for flow judging: the sentence-level diffing could identify specific flow disruptions (abrupt transitions, rhythm breaks) at the right granularity.

### AI Suggestions Pipeline
A 4-step pipeline: (1) LLM generates structured edits with `"... existing text ..."` markers, (2) lighter LLM merges edits into full document, (3) AST diff generates CriticMarkup, (4) preprocess for Lexical editor display with accept/reject controls. Key insight: this is a **user-facing** flow for AI editing, separate from the evolution pipeline. The two share the same AST diff infrastructure but serve different purposes (interactive editing vs autonomous improvement).

### Testing Patterns for Evolution
Evolution tests use `createMockEvolutionLLMClient(overrides)` for mocked LLM responses and `createTestEvolutionRun()` / `createTestVariant()` factories for DB records. Integration tests use real Supabase with service role key. `VALID_VARIANT_TEXT` constant provides format-valid markdown. Tests auto-skip when evolution DB tables aren't migrated. CI runs critical tests on PRs to main, full suite on PRs to production.

### Server Action Patterns
All actions follow: `withLogging()` → `serverReadRequestId()` → validate with Zod → call service → return `{success, data, error}`. Evolution actions (`evolutionActions.ts`, `evolutionVisualizationActions.ts`) follow this same pattern with `requireAdmin()` gating. The pattern is relevant because any new flow-judging server action would follow the same wrapping.

### Admin Panel & Evolution UI
Run detail page at `/admin/quality/evolution/run/[runId]` has 6 tabs: Timeline, Elo, Lineage, Tree, Budget, Variants. Dimension scores from ReflectionAgent are already displayed in the Timeline tab. Hall of Fame topic detail at `/admin/quality/hall-of-fame/[topicId]` has 4 tabs: Leaderboard, Cost vs Elo, Match History, Compare Text. Any new flow dimensions would automatically appear in these existing visualization components since they use the generic `dimensionScores` Record.

### Search & Generation Pipeline
The upstream `returnExplanationLogic()` pipeline generates initial articles that feed into evolution. It uses vector similarity, LLM ranking, and diversity scoring. Generated content quality varies significantly — this is exactly why the evolution pipeline exists to improve it. Flow evaluation would help identify which generated articles have the worst flow for prioritized evolution.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/tree_of_thought_revisions.md
- docs/feature_deep_dives/evolution_framework.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md

### Additional Docs (round 2)
- docs/feature_deep_dives/hierarchical_decomposition_agent.md
- docs/feature_deep_dives/outline_based_generation_editing.md
- docs/feature_deep_dives/markdown_ast_diffing.md
- docs/feature_deep_dives/ai_suggestions_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/search_generation_pipeline.md

## Code Files Read

### Top-level (`src/lib/evolution/`)
- `types.ts` — All shared interfaces (TextVariation, PipelineState, Critique, Match, EvolutionRunConfig, etc.)
- `config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig(), RATING_CONSTANTS
- `index.ts` — Public API barrel, createDefaultAgents(), preparePipelineRun()
- `comparison.ts` — buildComparisonPrompt(), parseWinner(), compareWithBiasMitigation()
- `diffComparison.ts` — compareWithDiff(), buildDiffJudgePrompt(), interpretDirectionReversal()
- `comparison.test.ts` — 23 tests for comparison logic
- `diffComparison.test.ts` — 15 tests for diff comparison
- `outlineTypes.test.ts` — Outline variant type guard and serialization tests

### Agents (`src/lib/evolution/agents/`)
- `base.ts` — Abstract AgentBase: execute(), estimateCost(), canExecute()
- `generationAgent.ts` — 3 parallel strategies (structural_transform, lexical_simplify, grounding_enhance)
- `calibrationRanker.ts` — Stratified opponent selection, bias-mitigated pairwise
- `tournament.ts` — Swiss-style tournament, info-theoretic pairing, sigma convergence
- `evolvePool.ts` — Mutation (clarity/structure), crossover, creative exploration
- `reflectionAgent.ts` — 5-dimension critique (clarity, structure, engagement, precision, coherence), scores 1-10
- `iterativeEditingAgent.ts` — Critique→edit→judge loop, max 3 cycles, diff-based blind judge
- `treeSearchAgent.ts` — Beam search root selection (high μ, high σ), budget reservation
- `sectionDecompositionAgent.ts` — H2 decomposition, parallel section edits, stitch
- `debateAgent.ts` — 3-turn debate (Advocate A → Advocate B → Judge → Synthesis)
- `proximityAgent.ts` — Diversity scoring via cosine similarity
- `metaReviewAgent.ts` — Pure-computation meta-feedback (no LLM calls)
- `outlineGenerationAgent.ts` — Outline→expand→polish pipeline with per-step scoring
- `formatRules.ts` — Shared prose-only format constraints
- `formatValidator.ts` — Validates against format rules (reject/warn/off modes)
- `pairwiseRanker.ts` — Simple and structured comparison modes (5 dimensions in structured)

### Core (`src/lib/evolution/core/`)
- `pipeline.ts` — executeMinimalPipeline(), executeFullPipeline(), buildRunSummary(), finalizePipelineRun()
- `supervisor.ts` — PoolSupervisor: EXPANSION→COMPETITION transitions, plateau detection, strategy rotation
- `state.ts` — PipelineStateImpl: append-only pool, serialize/deserialize with legacy compat
- `rating.ts` — OpenSkill Weng-Lin: createRating(), updateRating(), getOrdinal(), ordinalToEloScale()
- `costTracker.ts` — CostTrackerImpl: per-agent budget with FIFO reservation queue
- `llmClient.ts` — createEvolutionLLMClient(): wraps callLLM with budget enforcement
- `logger.ts` — createEvolutionLogger(): structured logging with subsystem/runId context
- `comparisonCache.ts` — ComparisonCache: order-invariant SHA-256 in-memory cache
- `pool.ts` — PoolManager: stratified opponent selection, evolution parent selection
- `diversityTracker.ts` — PoolDiversityTracker: lineage dominance, strategy diversity, trend
- `validation.ts` — State contract guards for agent-step phase prerequisites
- `featureFlags.ts` — 8 feature flags from DB with safe defaults, mutual exclusivity logic
- `jsonParser.ts` — extractJSON<T>() for LLM response parsing
- `costEstimator.ts` — Data-driven cost prediction with historical baselines
- `adaptiveAllocation.ts` — ROI-based budget shifting (exported but not yet wired)
- `strategyConfig.ts` — SHA-256 strategy hashing, labeling, diffing

### Tree of Thought (`src/lib/evolution/treeOfThought/`)
- `types.ts` — TreeNode, RevisionAction, TreeSearchResult, TreeState, BeamSearchConfig
- `treeNode.ts` — Tree construction, traversal, pruning (stack-based DFS)
- `beamSearch.ts` — Core beam search: generate→filter→rank per depth level
- `revisionActions.ts` — Action selection from critique (forced diversity), per-type prompts
- `evaluator.ts` — Stage 1 parent-relative filter + Stage 2 sibling mini-tournament
- `index.ts` — Barrel exports

### Section (`src/lib/evolution/section/`)
- `types.ts` — ArticleSection, ParsedArticle, SectionVariation, SectionEvolutionState
- `sectionParser.ts` — parseArticleIntoSections() (H2 splitting, code block handling)
- `sectionStitcher.ts` — stitchSections(), stitchWithReplacements()
- `sectionEditRunner.ts` — Per-section critique→edit→judge (max 2 cycles)
- `sectionFormatValidator.ts` — Section-level format validation

### Server Actions
- `src/lib/services/evolutionActions.ts` — 9 actions: queue, trigger, get runs/variants/summary, apply winner, rollback, cost breakdown, history
- `src/lib/services/evolutionVisualizationActions.ts` — 8 read-only actions: dashboard, timeline, Elo history, lineage, budget, comparison, step scores, tree search

## Deep Dive: Critique & Judge Prompts (Round 3)

### ReflectionAgent Critique System

**CRITIQUE_DIMENSIONS** (exact): `['clarity', 'structure', 'engagement', 'precision', 'coherence']`

**Critique prompt** (`buildCritiquePrompt`): Dimension-agnostic — accepts any string array. Asks for 1-10 score, one good example (quote), one bad example (quote or describe), and brief notes per dimension. Output is strictly JSON. No Zod schema — uses `extractJSON<CritiqueResponse>()` with runtime validation.

**Key constructor detail**: `this.dimensions = dimensions ?? CRITIQUE_DIMENSIONS` — ReflectionAgent accepts custom dimensions at construction time. The prompt dynamically lists whatever dimensions are passed.

**Persisted format**: `Critique.dimensionScores: Record<string, number>` — fully generic. Adding new dimension keys requires zero type changes.

**Helper functions**:
- `getCritiqueForVariant(variantId, state)` — linear search in `allCritiques[]`
- `getWeakestDimension(critique)` — returns key with lowest score
- `getImprovementSuggestions(critique)` — returns suggestions for dimensions scoring < 7

### Complete Judging Surface Area

| Component | Prompt Function | Evaluation Criteria | Output |
|-----------|----------------|-------------------|--------|
| `comparison.ts` | `buildComparisonPrompt()` | clarity/readability, structure/flow, engagement/impact, grammar/style, effectiveness | A/B/TIE |
| `diffComparison.ts` | `buildDiffJudgePrompt()` | Same 5 (improve or harm framing) | ACCEPT/REJECT/UNSURE |
| `pairwiseRanker.ts` (structured) | `buildStructuredPrompt()` | clarity, **flow**, engagement, voice_fidelity, conciseness | Per-dim A/B/TIE + overall |
| `reflectionAgent.ts` | `buildCritiquePrompt()` | clarity, structure, engagement, precision, coherence (customizable) | JSON: scores + examples |
| `iterativeEditingAgent.ts` | `buildEditPrompt()` | Targets weakest dimension | Revised text |
| `iterativeEditingAgent.ts` | `buildOpenReviewPrompt()` | Freeform (no rubric) | JSON: suggestions[] |
| `debateAgent.ts` | `buildAdvocateA/B/JudgePrompt()` | clarity, structure, engagement, precision, coherence (implicit) | Argument text / JSON verdict |
| `revisionActions.ts` | `buildRevisionPrompt()` | Per-action-type (structural, lexical, grounding, creative, dimension) | Revised text |
| `sectionEditRunner.ts` | `buildSectionEditPrompt()` | Targets specific weakness dimension | Revised section |

**Key finding**: The structured pairwise prompt already has an explicit "flow" dimension defined as "Does the text flow naturally between ideas?" — this is the most direct flow evaluation currently in the system, but it's a single coarse score per comparison.

### Hall of Fame Comparison Flow (End-to-End)

1. Admin clicks "Run Comparison" → selects judge model (10 options) + rounds (1-5)
2. `runHallOfFameComparisonAction()` → fetches entries + current Elo state
3. **Swiss pairing**: sort by Elo descending, pair adjacent, skip already-compared
4. Per pair: `compareWithBiasMitigation()` → 2 LLM calls (A/B + B/A reversal)
5. Insert `evolution_hall_of_fame_comparisons` record (has `dimension_scores JSONB` column — **currently null**)
6. Elo update: `scoreA = 0.5 ± 0.5 * confidence`, standard Elo formula (K=32, initial 1200)
7. Persist updated Elo + elo_per_dollar to `evolution_hall_of_fame_elo` table
8. UI reloads: Leaderboard (Elo-ranked), Cost vs Elo scatter, Match History, Text Diff

**Key finding**: `evolution_hall_of_fame_comparisons.dimension_scores` is a JSONB column that's always `null` today. This is the natural place to store flow sub-scores per comparison.

### LLM Pricing & Cost Implications

| Model | Input/1M | Output/1M | Typical comparison cost (2-pass) |
|-------|----------|-----------|----------------------------------|
| gpt-4.1-nano (default judge) | $0.10 | $0.40 | ~$0.0003 |
| gpt-4.1-mini (generation) | $0.40 | $1.60 | ~$0.0012 |
| deepseek-chat (evolution default) | $0.14 | $0.28 | ~$0.00025 |
| gpt-5-nano | $0.05 | $0.40 | ~$0.00025 |

**Model routing**: `callLLMModel()` dispatches by prefix: `claude-*` → Anthropic, `deepseek-*` → DeepSeek (OpenAI-compat), everything else → OpenAI.

**Budget**: Default $5.00/run. A flow-specific comparison at gpt-4.1-nano costs ~$0.0003/pair. With 100 comparisons = ~$0.03 — negligible budget impact.

## Key Integration Points for Flow Judging

### 1. Critique System (ReflectionAgent)
The `CRITIQUE_DIMENSIONS` array in `reflectionAgent.ts` defines what dimensions are evaluated. Currently: clarity, structure, engagement, precision, coherence. Adding flow sub-dimensions (local_cohesion, global_coherence, transition_quality, rhythm_variety, referent_clarity, redundancy) here would propagate to:
- `IterativeEditingAgent` — picks weakest dimension as edit target
- `TreeSearchAgent` → `revisionActions.ts` — `edit_dimension` action targets weakest dimension
- `SectionDecompositionAgent` — targets weakest dimension per section
- Visualization — `dimensionScores` displayed in timeline tab

### 2. Comparison Prompts
`comparison.ts:buildComparisonPrompt()` uses 5 generic criteria. A flow-focused variant could replace "Clarity and readability" + "Structure and flow" with the 6 flow sub-scores, and require the judge to cite specific friction sentences.

`diffComparison.ts:buildDiffJudgePrompt()` evaluates diffs against the same generic criteria. A flow-aware variant would check whether edits improve or harm flow specifically.

### 3. Structured Pairwise (PairwiseRanker)
The structured mode in `pairwiseRanker.ts` already has a "flow" dimension defined as "Does the text flow naturally between ideas?" Could be expanded to sub-dimensions or replaced with the detailed flow rubric.

### 4. Hall of Fame dimension_scores
The `evolution_hall_of_fame_comparisons.dimension_scores` JSONB column exists but is always null. This is the natural storage location for per-comparison flow sub-scores.

### 5. Agent Cost Budget
Any new judging adds LLM calls. At gpt-4.1-nano, flow comparison costs ~$0.0003/pair — negligible vs the $5.00 default budget. The `budgetCaps` in `config.ts` would only need adjustment if flow judging becomes a standalone agent.

### 6. Schema Validation
If flow scores are persisted in checkpoints or run summaries, the `SerializedPipelineState` and `EvolutionRunSummary` Zod schemas in `types.ts` would need extension with backward compatibility (following the V1→V2 pattern already established). However, `Critique.dimensionScores: Record<string, number>` is already generic and needs no changes.

## Deep Dive: Agent Registration, Schema, & Integration Points (Round 4)

### Agent Registration & Feature Flag Pattern

**Feature flags** are stored in the `feature_flags` table (name/enabled/description). Currently 8 evolution flags mapped via `FLAG_MAP` in `core/featureFlags.ts:39-48`:

| DB Name | TS Field | Default |
|---------|----------|---------|
| `evolution_tournament_enabled` | `tournamentEnabled` | `true` |
| `evolution_evolve_pool_enabled` | `evolvePoolEnabled` | `true` |
| `evolution_dry_run_only` | `dryRunOnly` | `false` |
| `evolution_debate_enabled` | `debateEnabled` | `true` |
| `evolution_iterative_editing_enabled` | `iterativeEditingEnabled` | `true` |
| `evolution_outline_generation_enabled` | `outlineGenerationEnabled` | `false` (opt-in) |
| `evolution_tree_search_enabled` | `treeSearchEnabled` | `false` (opt-in) |
| `evolution_section_decomposition_enabled` | `sectionDecompositionEnabled` | `true` |

**Mutual exclusivity**: When `treeSearchEnabled=true`, `iterativeEditingEnabled` is forced `false` (featureFlags.ts:78-81).

**Two-layer gating**: (1) Phase-based (`PhaseConfig` in supervisor) determines if agent runs in that phase, (2) Feature-flag-based (`options.featureFlags`) can disable even if phase enables it.

**Agent registration pattern** (to add a new agent):
1. Create class extending `AgentBase` with `name`, `execute()`, `estimateCost()`, `canExecute()` (agents/base.ts)
2. Add to `createDefaultAgents()` return object (index.ts:97-112) — agents are always instantiated, filtering happens at execution time
3. Add optional field to `PipelineAgents` interface (pipeline.ts:716-729)
4. Add `run<Name>: boolean` to `PhaseConfig` interface (supervisor.ts:16-32)
5. Set in EXPANSION config (supervisor.ts:150-177) and COMPETITION config (supervisor.ts:179-200)
6. Add to `flagGatedAgents` array in pipeline execution loop (pipeline.ts:837-858)
7. Optionally: add feature flag to DB, `EvolutionFeatureFlags` interface, `FLAG_MAP`, and `DEFAULT_EVOLUTION_FLAGS`

### Database Schema (Key Tables)

**`evolution_variants`** — Core columns:
- `id UUID`, `run_id UUID`, `variant_content TEXT`, `elo_score NUMERIC(8,2) DEFAULT 1200`
- `generation INT DEFAULT 0`, `parent_variant_id UUID` (self-ref), `agent_name TEXT`
- `quality_scores JSONB DEFAULT '{}'` — stores dimension-level quality scores from judge
- `cost_usd NUMERIC(10,6)`, `match_count INT DEFAULT 0`, `is_winner BOOLEAN DEFAULT FALSE`

**`evolution_checkpoints`** — `state_snapshot JSONB` contains full pipeline state for crash recovery. Indexed by `(run_id, created_at DESC)` and unique on `(run_id, iteration, last_agent)`.

**`evolution_runs`** — `run_summary JSONB` stores post-run analytics (eloHistory, diversityHistory, matchStats, metaFeedback, baselineRank). GIN-indexed.

**`evolution_hall_of_fame_comparisons`** — Key columns: `entry_a_id`, `entry_b_id`, `winner_id`, `confidence NUMERIC(3,2)`, `judge_model TEXT`, **`dimension_scores JSONB`** (currently always null). This is the natural storage for flow sub-scores per comparison.

**`content_quality_scores` (removed)** — Standalone per-article per-dimension quality scores: `dimension TEXT` (CHECK: clarity, structure, engagement, conciseness, coherence, specificity, point_of_view, overall), `score NUMERIC(3,2)` (0.00-1.00), `rationale TEXT`, `model TEXT`. This is used by a separate eval pipeline (Phase D), not the evolution pipeline. Could serve as a model for flow-specific scoring.

**`evolution_run_agent_metrics`** — Per-agent cost tracking: `cost_usd`, `variants_generated`, `avg_elo`, `elo_gain`, `elo_per_dollar`. Unique on `(run_id, agent_name)`.

### Comparison Pipeline End-to-End

**Data flow**: Prompt construction → LLM call → response parsing → bias mitigation merge → Match object → rating update → checkpoint

1. **`buildComparisonPrompt(textA, textB)`** (comparison.ts:13-37): Lists 5 criteria in text, asks for A/B/TIE. `parseWinner()` extracts result with flexible matching.

2. **`compareWithBiasMitigation()`** (comparison.ts:67-119): 2-pass A/B reversal. Confidence: 1.0 (agreement), 0.7 (partial with TIE), 0.5 (complete disagreement → forced TIE), 0.3 (partial failure). Order-invariant cache key.

3. **`buildStructuredPrompt(textA, textB)`** (pairwiseRanker.ts:20-56): Dynamic — iterates `EVALUATION_DIMENSIONS` to build dimension list. Asks for A/B/TIE per dimension plus OVERALL_WINNER and CONFIDENCE. `parseStructuredResponse()` (lines 63-111) extracts all dimension scores and derives winner from majority if OVERALL_WINNER missing.

4. **`mergeDimensionScores(scores1, scores2Normalized)`** (pairwiseRanker.ts:115-135): After 2-pass bias mitigation, normalizes reversed-round scores and merges. Disagreement: prefers non-TIE, falls back to TIE.

5. **`Match` type** (types.ts:94-101): `{ variationA, variationB, winner, confidence, turns, dimensionScores: Record<string, string> }`. Dimension scores are **captured and persisted** in `matchHistory` but **not used for rating updates** — ratings only use `winner`.

6. **Rating updates** (calibrationRanker.ts:75-98): OpenSkill Bayesian. Reads `Match.winner` only, ignores dimension scores. Updates `state.ratings` map.

### Tournament & MetaReview Agents

**Tournament** (tournament.ts): Swiss-style pairing with info-theoretic scoring: `outcomeUncertainty * sigmaWeight * topKBoost`. Budget-adaptive depth: low pressure → 40 comparisons, high → 15. Convergence: all σ < 3.0 for 5 consecutive checks. Multi-turn tiebreaker (3 turns) for top-quartile close matches.

**MetaReview** (metaReviewAgent.ts): Pure computation (zero LLM cost). Analyzes strategy success, bottom-25% weakness patterns, parent→child quality deltas, stagnation, and diversity loss. Outputs `metaFeedback: { recurringWeaknesses, priorityImprovements, successfulStrategies, patternsToAvoid }`. Could be extended to track flow-specific patterns.

**Proximity** (proximityAgent.ts): Embedding-based diversity scoring. Maintains `state.similarityMatrix` and `state.diversityScore` (0-1, where 1 = max diversity). Used by supervisor for EXPANSION→COMPETITION gate and MetaReview for stagnation detection.

### Two Quality Score Systems (Different Purposes)

| System | Interface | Score Type | Used By |
|--------|-----------|-----------|---------|
| **Critique** (per-variant) | `Critique.dimensionScores: Record<string, number>` | Numeric 1-10 | ReflectionAgent → IterativeEditing, TreeSearch, SectionDecomposition |
| **Match** (per-comparison) | `Match.dimensionScores: Record<string, string>` | A/B/TIE labels | PairwiseRanker → Tournament/Calibration (stored but unused for ratings) |

Both are fully generic (`Record<string, ...>`) — adding new dimension keys requires zero type changes. The critique system is used for **edit targeting** (weakest dimension drives next edit). The match system is used for **comparison** but dimension scores don't yet influence rating updates.

### Architecture Summary for Flow Implementation

**Lowest-friction integration**: Add flow sub-dimensions to `CRITIQUE_DIMENSIONS` in `reflectionAgent.ts` — they propagate automatically to IterativeEditing (weakest-dimension targeting), TreeSearch (edit_dimension actions), SectionDecomposition (per-section critique), and visualization (Timeline tab dimension display).

**For Hall of Fame**: Populate the existing `dimension_scores JSONB` column in `evolution_hall_of_fame_comparisons` with flow sub-scores from structured comparison.

**For new agent**: Follow the 7-step registration pattern above. A dedicated FlowJudgeAgent could run in COMPETITION phase with its own feature flag, budget cap, and specialized flow-evaluation prompt.
