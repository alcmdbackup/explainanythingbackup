# Develop Tree of Thought Revisions Strategy Research

## Problem Statement

The evolution pipeline currently uses a flat pool model: agents generate variants, add them to a shared pool, and ranking agents determine quality through pairwise comparison. While this works well for diversity exploration, it lacks the ability to explore multiple targeted revision paths simultaneously and systematically track which sequence of edits leads to the best outcome. A tree-of-thought approach would enable branching exploration of revision strategies, backtracking when paths are unproductive, and explicit path tracking from original to best variant.

## High Level Summary

Research covered four areas: (1) evolution pipeline core infrastructure, (2) existing agent implementations, (3) comparison/rating systems, and (4) tree-of-thought literature. Key findings:

- The codebase already supports tree-like structures via `TextVariation.parentIds: string[]` but uses them as a flat pool
- The `AgentBase` contract is clean — adding a new agent requires implementing `execute()`, `canExecute()`, and `estimateCost()`
- The `IterativeEditingAgent` is the closest existing agent to tree search (sequential critique→edit→judge), but lacks branching
- Academic literature identifies 4 search strategies: BFS, DFS, MCTS, and Beam Search — with MCTS (Monte Carlo Tree Search) offering the best exploration/exploitation balance
- The key missing pieces are: a TreeNode data structure, search algorithms (UCB selection, backpropagation), and adaptive branching logic
- The existing rating system (OpenSkill Bayesian) could serve as the value function for tree node evaluation

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/iterative_planning_agent.md

## Code Files Read

### Core Infrastructure
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator: `executeFullPipeline` (phase-aware loop), `executeMinimalPipeline` (single-pass), `runAgent()` wrapper with checkpoint/error handling
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor: EXPANSION→COMPETITION phase transition, `getPhaseConfig()` agent gating, stopping conditions (plateau, budget, max iterations, degenerate)
- `src/lib/evolution/core/state.ts` — PipelineStateImpl: append-only pool, `addToPool()` with dedup/rating init, serialization for checkpoints, `getTopByRating()` ordering
- `src/lib/evolution/types.ts` — All shared types: `TextVariation` (with parentIds), `PipelineState`, `ExecutionContext`, `AgentResult`, `Critique`, `MetaFeedback`, `DebateTranscript`
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class: `execute()`, `canExecute()`, `estimateCost()` contract

### Agent Implementations
- `src/lib/evolution/agents/generationAgent.ts` — 3 parallel variants (structural_transform, lexical_simplify, grounding_enhance), consumes metaFeedback
- `src/lib/evolution/agents/evolvePool.ts` — Mutation (clarity/structure), crossover (2 parents), creative exploration (30% wild card when diversity < 0.5)
- `src/lib/evolution/agents/debateAgent.ts` — 3-turn structured debate (Advocate A → Advocate B → Judge) over top 2 non-baseline variants, 4 sequential LLM calls
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Critique→edit→judge cycle with information barrier, blind diff-based judging, up to 3 cycles × 5 LLM calls
- `src/lib/evolution/agents/reflectionAgent.ts` — 5-dimension rubric (clarity, structure, engagement, precision, coherence), top 3 variants, 3 parallel LLM calls
- `src/lib/evolution/agents/metaReviewAgent.ts` — Strategy effectiveness analysis, weakness detection, priority improvements (0 LLM calls, pure computation)

### Comparison & Rating
- `src/lib/evolution/comparison.ts` — `compareWithBiasMitigation()`: 2-pass A/B reversal, confidence scoring, order-invariant SHA-256 caching
- `src/lib/evolution/diffComparison.ts` — CriticMarkup diff-based blind judging, direction reversal truth table (ACCEPT/REJECT/UNSURE)
- `src/lib/evolution/core/rating.ts` — OpenSkill Bayesian: `createRating()`, `updateRating()`, `getOrdinal()` (mu - 3σ), `isConverged()` (sigma < 3.0)
- `src/lib/evolution/agents/tournament.ts` — Swiss-style pairing with info-theoretic scoring (outcome uncertainty + sigma weight + top-K boost), sigma-based convergence
- `src/lib/evolution/agents/calibrationRanker.ts` — Stratified opponent selection (quartile-based), adaptive early exit after decisive first batch
- `src/lib/evolution/core/pool.ts` — PoolManager: stratified opponent selection, pool health statistics
- `src/lib/evolution/core/diversityTracker.ts` — Lineage dominance detection, strategy diversity analysis, trend computation

### Round 2: Prompt Construction & Operational Infrastructure
- `src/lib/evolution/agents/formatRules.ts` — Shared FORMAT_RULES constant injected into all generation prompts
- `src/lib/evolution/core/llmClient.ts` — `createEvolutionLLMClient()` factory, budget enforcement wrapping, model routing, JSON parsing
- `src/lib/evolution/core/costTracker.ts` — `CostTrackerImpl`: pre-call reservation with 30% margin, per-agent caps, spend recording
- `src/lib/evolution/core/featureFlags.ts` — DB-backed feature flags with safe defaults (5 flags: tournament, evolvePool, dryRun, debate, iterativeEditing)
- `src/lib/evolution/config.ts` — `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` deep merge, model defaults (judgeModel=gpt-4.1-nano, generationModel=gpt-4.1-mini)
- `src/lib/evolution/core/comparisonCache.ts` — Order-invariant SHA-256 cache, only caches valid results
- `src/lib/evolution/core/validation.ts` — `validateStateContracts()`: phase-based state checks, append-only pool invariant

### Round 2: Visualization & Checkpoint Infrastructure
- `src/components/evolution/LineageGraph.tsx` — D3 DAG rendering, iteration-layer layout, zoom/pan, click-to-inspect
- `src/components/evolution/tabs/LineageTab.tsx` — Dynamic import (SSR disabled), data fetching
- `src/lib/services/evolutionVisualizationActions.ts` — `getEvolutionRunLineageAction()`, `getEvolutionRunEloHistoryAction()`
- `src/components/evolution/tabs/EloTab.tsx` — Recharts rating trajectory, top-N filtering
- `src/components/evolution/VariantCard.tsx` — Strategy color palette, variant info display
- `src/components/evolution/EloSparkline.tsx` — Inline 60x20px sparkline
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — Checkpoint table schema

---

## Detailed Findings

### 1. Pipeline Architecture & Extension Points

The pipeline operates as a sequential agent loop within a two-phase structure:

```
executeFullPipeline():
  supervisor = new PoolSupervisor(config)
  insertBaseline(originalText)

  for each iteration:
    state.startNewIteration()  // resets newEntrantsThisIteration
    supervisor.beginIteration(state)  // detects/locks phase
    config = supervisor.getPhaseConfig(state)  // which agents run

    if shouldStop() → break  // plateau/budget/max/degenerate

    // Conditional agent execution based on phase config
    if config.runGeneration → runAgent(GenerationAgent)
    if config.runReflection → runAgent(ReflectionAgent)
    if config.runIterativeEditing → runAgent(IterativeEditingAgent)
    if config.runDebate → runAgent(DebateAgent)
    if config.runEvolution → runAgent(EvolutionAgent)
    if config.runCalibration → runAgent(Tournament or CalibrationRanker)
    if config.runProximity → runAgent(ProximityAgent)
    if config.runMetaReview → runAgent(MetaReviewAgent)

    checkpoint(state + supervisorState)
```

**Key extension points for a new TreeOfThoughtAgent:**
1. Implement `AgentBase` interface (name, execute, canExecute, estimateCost)
2. Add to `PhaseConfig` with a new boolean flag (e.g., `runTreeSearch: boolean`)
3. Add conditional execution block in `executeFullPipeline()`
4. Add feature flag in `core/featureFlags.ts`
5. Add budget cap in `config.ts` budgetCaps

### 2. Current Agent Patterns

| Agent | LLM Calls | Reads From State | Writes To State | Key Pattern |
|-------|-----------|-----------------|-----------------|-------------|
| GenerationAgent | 3 parallel | originalText, metaFeedback | pool (3 variants) | Parallel generation, format validation |
| EvolutionAgent | 3-4 (+ 30% creative) | pool, ratings, metaFeedback, diversityScore | pool (3-4 variants) | Parent selection by ordinal, genetic ops |
| DebateAgent | 4 sequential | pool, ratings, allCritiques, metaFeedback | pool (1 variant), debateTranscripts | Multi-turn dialogue, synthesis |
| IterativeEditingAgent | Up to 15 | allCritiques, ratings | pool (up to 3 variants) | Sequential critique→edit→judge loop |
| ReflectionAgent | 3 parallel | pool | allCritiques, dimensionScores | 5-dimension rubric scoring |
| MetaReviewAgent | 0 | pool, ratings, diversityScore | metaFeedback | Pure statistical analysis |

**The IterativeEditingAgent is most relevant** — it already implements a sequential search through revision strategies (picking the weakest dimension, editing, judging). The difference from tree search: it's depth-first with no branching and no backtracking.

### 3. TextVariation Already Supports Tree Structure

```typescript
interface TextVariation {
  id: string;
  text: string;
  version: number;
  parentIds: string[];     // ← Supports tree/DAG via multiple parents
  strategy: string;        // ← Tracks which agent/strategy created it
  createdAt: number;
  iterationBorn: number;
}
```

- `parentIds: []` → root variant (GenerationAgent creates these)
- `parentIds: [id]` → single-parent mutation (EvolutionAgent)
- `parentIds: [idA, idB]` → crossover (EvolutionAgent, DebateAgent)

This already supports a tree, but the pool is used as a flat collection — no tree traversal, no depth tracking, no path reconstruction.

### 4. Rating System as Value Function

The OpenSkill Bayesian system provides a natural value function for tree nodes:

- **mu (skill estimate)**: Average quality of the variant
- **sigma (uncertainty)**: How well-tested the variant is
- **ordinal = mu - 3σ**: Conservative quality estimate

For MCTS, the ordinal could serve as the "value" at each node, while sigma maps to the "exploration term" (high sigma → worth exploring further). The existing `getOrdinal()` function already implements this.

### 5. Tree-of-Thought Literature Summary

#### Key Academic Concepts

**Tree of Thoughts (Yao et al. 2023, NeurIPS)**: The foundational paper. Decomposes problem-solving into "thoughts" (intermediate steps), generates multiple candidates at each step, evaluates them, and uses BFS or DFS to navigate the tree. GPT-4 achieved 74% on Game of 24 (vs. 4% with Chain-of-Thought).

**Four search strategies with trade-offs:**

| Strategy | Strengths | Weaknesses | Best For |
|----------|-----------|------------|----------|
| **BFS** (Breadth-First) | Comprehensive exploration, finds diverse solutions | High memory, wastes compute on mediocre branches | Diverse pool generation (EXPANSION-like) |
| **DFS** (Depth-First) | Memory efficient, reaches solutions faster | Can get stuck in local optima, no backtracking diversity | Sequential refinement (current IterativeEditingAgent) |
| **MCTS** (Monte Carlo Tree Search) | Provably optimal, balances explore/exploit, handles stochasticity | Many iterations needed, complex implementation, high cost | Quality refinement (COMPETITION replacement) |
| **Beam Search** | Simple, parallelizable, predictable budget | No backtracking, beam collapse risk | Fixed-width exploration (controlled budget) |

**Adaptive Branching (NeurIPS 2025)**: At each node, dynamically decide whether to go wider (more alternatives) or deeper (continue best path) based on uncertainty and budget.

#### Applied to Text Revision

**SPaR (2024)**: Tree-search refinement where LLM uses tree search to refine previous responses. LLaMA3-8B trained with SPaR surpassed GPT-4-Turbo on instruction following.

**ReTreVal (2025)**: Combines Tree-of-Thoughts with Self-Refine — adds LLM critique scoring and reflexion memory. Synergistic hybrid of structured exploration + iterative refinement.

**MCT Self-Refine (2024)**: Achieved GPT-4 level math reasoning with Llama-3 8B using MCTS for self-refinement.

### 6. What Already Exists vs. What's Needed

#### Already Exists
- Pool management with parentIds → supports tree structure
- OpenSkill rating → value function for MCTS nodes
- Comparison infrastructure → can evaluate parent→child quality changes
- Critique system → identifies which dimensions to target for branching
- Multiple edit strategies → "actions" at tree nodes
- Budget management → controls tree depth/breadth
- Checkpoint system → can serialize tree state
- Format validation → prunes malformed nodes immediately
- Lineage visualization (D3 DAG) → could display tree structure

#### Needed for Tree-of-Thought
- **TreeNode data structure**: Wraps TextVariation with depth, visits, value, unexploredActions, children, parent pointer
- **Search algorithm**: UCB selection for MCTS, or beam-width control for beam search
- **Backpropagation**: Update ancestor node values when leaf is evaluated
- **Pruning logic**: Remove low-value subtrees, respect budget constraints
- **Adaptive branching**: Decide width/depth based on uncertainty and budget
- **Path extraction**: Trace from root to best leaf, reconstruct revision "recipe"
- **Tree serialization**: Extend checkpoint format to persist tree structure

### 7. Clarifications on Key Claims

#### "SPaR outperforms GPT-4" — What this actually means

SPaR (Dec 2024) trains LLaMA3-8B (~50x smaller than GPT-4) to iteratively refine outputs using tree search. The specific result: LLaMA3-8B with SPaR surpassed GPT-4-Turbo on the **IFEval benchmark** (instruction following — e.g., "write exactly 3 paragraphs"). This is a narrow structured-task benchmark, not general writing quality. The mechanism: instead of one response, the model explores a tree of revision paths and picks the best one that satisfies constraints.

#### "ReTreVal outperforms GPT-4" — Same nuance

ReTreVal (Jan 2025) combines ToT with Self-Refine and adds reflexion memory (remembering what failed in previous branches). The "outperform" claims are on **reasoning tasks** (math, logic puzzles) where smaller models using tree search beat GPT-4's single-pass generation.

#### The real insight for this project

The takeaway isn't "small models beat GPT-4 at everything." It's that **search time can compensate for model capability on refinement tasks**. A cheaper model exploring 10 revision paths and selecting the best often outperforms an expensive model generating a single revision. This maps to our cost model: the pipeline uses `gpt-4.1-nano` (cheap) for judging and `gpt-4.1-mini` for generation. Tree search means more calls to the cheap model, potentially better quality at similar cost.

**Important caveat**: These results are on structured/reasoning tasks where "correct" is objective. Text quality is subjective and multi-dimensional — our 5-dimension rubric and bias-mitigated comparison infrastructure will be critical to make tree search work for prose revision.

---

## Round 2: Deep Codebase Exploration

### 8. Prompt Construction Patterns

All agents follow a consistent template structure:
```
[Role statement]
## [Section Title] — content
[Additional context sections]
## Task — instructions
[FORMAT_RULES if text generation]
## Output Format — constraints
```

**Key patterns for tree-of-thought prompt design:**

- **Strategy-specific roles**: GenerationAgent assigns different personas per strategy ("bold writing architect" for structural_transform, "clarity specialist" for lexical_simplify). A ToT agent would define roles per branching action.
- **MetaFeedback injection**: All generation-type agents inject `metaFeedback.priorityImprovements.join('\n')` as a `## Previous Feedback` section. A ToT agent could inject per-branch evaluation results instead.
- **Information barriers**: IterativeEditingAgent's `buildEditPrompt()` knows the exact weakness (dimension, score, bad examples). The judge in `diffComparison.ts` sees ONLY CriticMarkup diff with zero context. This barrier pattern should be preserved in tree node evaluation.
- **JSON output parsing**: Universal regex pattern `response.match(/\{[\s\S]*\}/)` handles LLMs wrapping JSON in markdown fences. All structured outputs use this.
- **FORMAT_RULES constant** (`formatRules.ts`): Injected into every text-generation prompt — enforces H1 title, section headings, paragraph-only format. Must be included in tree node generation prompts too.

**Prompt sizes (approximate):**
- GenerationAgent: ~500-800 chars per strategy prompt + full original text
- EvolutionAgent: ~600-1000 chars per mutation/crossover prompt + parent text(s)
- ReflectionAgent: ~400 chars critique prompt + full variant text
- DebateAgent: ~800 chars per turn, growing as turns chain (4 sequential LLM calls)

### 9. Checkpoint Serialization Format

**DB Schema** (`evolution_checkpoints` table):
- `run_id UUID`, `iteration INT`, `phase TEXT`, `last_agent TEXT`, `state_snapshot JSONB`
- Unique constraint on `(run_id, iteration, last_agent)` prevents duplicates
- Index `(run_id, created_at DESC)` for fetching latest

**`state_snapshot` JSON structure:**
```json
{
  "iteration": 3,
  "originalText": "...",
  "pool": [{ "id": "uuid", "text": "...", "version": 1, "parentIds": ["..."], "strategy": "...", "createdAt": 1738748901.234, "iterationBorn": 1 }],
  "newEntrantsThisIteration": ["uuid-456"],
  "ratings": { "uuid": { "mu": 25.3, "sigma": 8.2 } },
  "matchCounts": { "uuid": 12 },
  "matchHistory": [{ "variationA": "...", "variationB": "...", "winner": "...", "confidence": 0.85, "turns": 1, "dimensionScores": {} }],
  "dimensionScores": { "uuid": { "clarity": 8, "structure": 7 } },
  "allCritiques": [{ "variationId": "...", "dimensionScores": {}, "goodExamples": {}, "badExamples": {}, "notes": {}, "reviewer": "reflectionAgent" }],
  "similarityMatrix": { "uuid-a": { "uuid-b": 0.87 } },
  "diversityScore": 0.42,
  "metaFeedback": { "recurringWeaknesses": [], "priorityImprovements": [], "successfulStrategies": [], "patternsToAvoid": [] },
  "debateTranscripts": [{ "variantAId": "...", "variantBId": "...", "turns": [], "synthesisVariantId": "...", "iteration": 3 }]
}
```

**Supervisor state** (added by `persistCheckpointWithSupervisor()` at end of each iteration):
```json
{ "supervisorState": { "phase": "COMPETITION", "strategyRotationIndex": 2, "ordinalHistory": [24.1, 25.3], "diversityHistory": [0.31, 0.42] } }
```

**Key serialization facts for tree structure:**
- Maps → Records (JSON-compatible), Sets are NOT serialized (rebuilt from pool)
- `newEntrantsThisIteration` IS serialized (important for phase transition logic)
- Backward compat: `eloRatings` (legacy Elo numbers) → `ratings` (OpenSkill `{mu, sigma}`)
- Full pool serialized every checkpoint (no delta/patch). Pool of 30 variants with ~2000 char texts = ~60KB per checkpoint
- **No active resume-from-checkpoint** in current pipeline — checkpoints are read-only for visualization. The CLI runner always starts fresh.

**Tree structure implication**: A `treeState` field could be added alongside existing fields. The tree should be reconstructable from `pool` + `parentIds` as a fallback.

### 10. Lineage Visualization Infrastructure

**Data flow**: `evolution_checkpoints` → `getEvolutionRunLineageAction()` → `LineageData { nodes, edges }` → `LineageGraph` (D3)

**LineageData structure:**
```typescript
{ nodes: { id, shortId, strategy, elo, iterationBorn, isWinner }[], edges: { source, target }[] }
```

**Current layout**: Simple iteration-layer positioning (nodes grouped by `iterationBorn`), NOT Sugiyama DAG despite `d3-dag` being installed. Edges are direct lines from parent to child.

**Node rendering**: Circle sized by Elo rating (6-18px radius), colored by `STRATEGY_PALETTE` (blue=structural, green=lexical, orange=grounding, purple=evolution), winner gets gold ring. Click opens `VariantCard` side panel.

**Rating trajectory**: `getEvolutionRunEloHistoryAction()` de-duplicates checkpoints per iteration, converts OpenSkill ordinals to Elo scale, renders Recharts `LineChart` with top-N filtering slider.

**Tree-of-thought visualization potential**:
- `d3-dag` (already installed) supports Sugiyama layout — proper hierarchical tree rendering
- Current flat layer approach would need to switch to depth-based hierarchy for branching paths
- Pruned branches could be shown as gray/dimmed nodes
- Winner's ancestry path could be highlighted

### 11. Budget Constraints for a ToT Agent

**Current budget model** (`$5.00` total default):
- Generation: 25% ($1.25), Tournament: 25% ($1.25), Calibration: 15% ($0.75), Evolution: 15% ($0.75), IterativeEditing: 10% ($0.50), Reflection: 5% ($0.25), Debate: 5% ($0.25)

**Cost per LLM call** (DeepSeek default `deepseek-chat`):
- ~$0.00007 per call (1000 chars prompt + 500 chars response)
- With 30% safety margin: ~$0.00009 reserved per call

**What $0.50 (10% cap) buys for tree-of-thought:**
- ~5,400 simple DeepSeek calls
- ~170 deep tree expansions (depth 5, breadth 2 = 31 nodes × 1 LLM call each)
- ~415 shallow tree expansions (depth 3, breadth 3 = 13 nodes × 1 LLM call each)

**Model routing**: Agents can use different models for different tasks. Tree search could use:
- `gpt-4.1-nano` ($0.10/$0.40 per 1M tokens) for tree node evaluation (cheap)
- `gpt-4.1-mini` ($0.40/$1.60 per 1M tokens) for generating revision text
- `deepseek-chat` ($0.14/$0.28 per 1M tokens) as default

**Feature flag system**: Adding `evolution_tree_search_enabled` would follow the existing pattern in `featureFlags.ts` — DB-backed boolean with safe default, read at pipeline startup.

### 12. Key Papers & Links

- [Tree of Thoughts (Yao et al.)](https://arxiv.org/abs/2305.10601) — Foundational paper
- [Graph of Thoughts (Besta et al.)](https://arxiv.org/abs/2308.09687) — Extension to DAG structure
- [SPaR: Self-Play with Tree-Search Refinement](https://arxiv.org/abs/2412.11605) — Applied to text
- [ReTreVal: Reasoning Tree with Validation](https://arxiv.org/html/2601.02880v1) — ToT + Self-Refine hybrid
- [Wider or Deeper? Adaptive Branching](https://arxiv.org/abs/2503.04412) — Dynamic width/depth
- [SWE-Search: MCTS for Software Agents](https://openreview.net/forum?id=G7sIFXugTX)
- [MCT Self-Refine](https://medium.com/@techsachin/mct-self-refine-algorithm-integrating-llms-with-monte-carlo-tree-search-for-complex-mathematical-c91697b134bc) — MCTS for refinement
- [AI Co-Scientist (DeepMind)](https://arxiv.org/abs/2502.18864) — Inspired existing DebateAgent
- [GitHub: princeton-nlp/tree-of-thought-llm](https://github.com/princeton-nlp/tree-of-thought-llm) — Reference implementation
- [Prompt Engineering Guide: ToT](https://www.promptingguide.ai/techniques/tot)
