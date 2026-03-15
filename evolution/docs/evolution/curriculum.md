# Evolution System — Learning Curriculum

Organized sequence for understanding the evolution codebase. Each module builds on the previous ones.

---

## Module 1: Foundation — Types & Data Model

**Goal:** Understand what things are before learning what they do.

| File | What to learn |
|---|---|
| `lib/types.ts` | `TextVariation`, `Rating`, `Match`, `Critique`, `MetaFeedback`, `AgentResult`, `ExecutionContext`, `ReadonlyPipelineState`, `EvolutionRunConfig` |
| `lib/agents/base.ts` | `AgentBase` — the 3-method contract every agent implements |

**Key concept:** Everything revolves around a pool of `TextVariation`s that get rated, compared, and evolved.

---

## Module 2: Rating System — How Variants Are Scored

**Goal:** Understand the scoring math before seeing who calls it.

| File | What to learn |
|---|---|
| `lib/core/rating.ts` | OpenSkill Bayesian model (mu/sigma), `updateRating`, `updateDraw`, convergence detection |
| `lib/core/eloAttribution.ts` | How Elo gains are attributed to creating agents and parent lineage |

**Key concept:** `mu` = skill estimate, `sigma` = uncertainty. Matches reduce sigma. Variants with low sigma are "calibrated."

---

## Module 3: Comparison Engine — How Variants Are Judged

**Goal:** Understand the LLM-powered judging before seeing which agents use it.

| File | What to learn |
|---|---|
| `lib/comparison.ts` | 2-pass bias-mitigated pairwise comparison (A vs B, then B vs A), confidence aggregation |
| `lib/diffComparison.ts` | CriticMarkup diff comparison for surgical edits (ACCEPT/REJECT/UNSURE) |
| `lib/core/reversalComparison.ts` | Generic 2-pass reversal framework |
| `lib/core/comparisonCache.ts` | SHA-256 order-invariant LRU cache for comparison results |

**Key concept:** Every comparison runs twice with reversed order to mitigate position bias. Results are cached.

---

## Module 4: State & Pool Management

**Goal:** Understand the immutable state + reducer pattern.

| File | What to learn |
|---|---|
| `lib/core/state.ts` | `PipelineStateImpl` — pool, ratings, matches, critiques, immutable `with*()` methods, serialization/deserialization |
| `lib/core/actions.ts` | `PipelineAction` discriminated union — the data types agents return to describe state changes |
| `lib/core/reducer.ts` | `applyAction()` — pure function that applies a single action to produce a new state snapshot |
| `lib/core/pool.ts` | `PoolManager` — stratified opponent selection for calibration, parent selection for evolution |

**Key concept:** Agents receive `ReadonlyPipelineState` and return `PipelineAction[]`. The pipeline applies actions via a reducer to produce new immutable state snapshots. `getTopByRating()` sorts by mu.

---

## Module 5: Cost & Budget System

**Goal:** Understand the financial guardrails.

| File | What to learn |
|---|---|
| `lib/core/costTracker.ts` | Reserve-before-spend pattern, per-agent attribution, budget enforcement |
| `lib/core/costEstimator.ts` | Per-agent cost baselines for pre-call reservation |

**Key concept:** `reserveBudget()` blocks with 30% safety margin. `BudgetExceededError` propagates up to stop the pipeline gracefully.

---

## Module 6: Config System

**Goal:** Understand what's tunable.

| File | What to learn |
|---|---|
| `lib/config.ts` | `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` deep-merge, MAX_RUN_BUDGET_USD hard cap |
| `lib/core/configValidation.ts` | Validation rules for models, iterations, budgets, agent selection |
| `lib/core/strategyConfig.ts` | Strategy identity hashing for experiment deduplication |

**Key concept:** Config controls iteration count, budget cap, expansion thresholds, generation strategies, calibration opponents, and which agents are enabled.

---

## Module 7: Supervisor & Phase Transitions

**Goal:** Understand the two-phase state machine.

| File | What to learn |
|---|---|
| `lib/core/supervisor.ts` | `PoolSupervisor`, EXPANSION→COMPETITION one-way lock, `AGENT_EXECUTION_ORDER`, phase filtering |

**Key concept:** EXPANSION builds pool diversity (only generation + calibration + proximity). COMPETITION runs all agents. Transition triggers when pool is large enough and diverse enough. The `ranking` slot dispatches calibration in EXPANSION, tournament in COMPETITION.

---

## Module 8: The Agents — Expansion Phase

**Goal:** Learn the agents that build the initial pool.

| File | What to learn |
|---|---|
| `lib/agents/generationAgent.ts` | 3 strategies (structural_transform, lexical_simplify, grounding_enhance), format validation |
| `lib/agents/outlineGenerationAgent.ts` | Step-by-step: outline→expand→polish→verify, produces `OutlineVariant` |
| `lib/agents/calibrationRanker.ts` | Stratified opponents, adaptive early exit, rates new entrants |
| `lib/agents/proximityAgent.ts` | Cosine similarity matrix, diversity score tracking |

---

## Module 9: The Agents — Competition Phase (Ranking)

**Goal:** Learn how variants compete.

| File | What to learn |
|---|---|
| `lib/agents/tournament.ts` | Swiss pairing, budget pressure tiers, convergence detection |
| `lib/agents/debateAgent.ts` | 2-advocate + judge format, synthesis variant creation |

---

## Module 10: The Agents — Competition Phase (Improvement)

**Goal:** Learn how variants get refined.

| File | What to learn |
|---|---|
| `lib/agents/reflectionAgent.ts` | Dimension-based critique of all pool variants |
| `lib/agents/metaReviewAgent.ts` | Synthesizes patterns from critiques into `MetaFeedback` |
| `lib/agents/iterativeEditingAgent.ts` | Targets weakest dimension, propose→diff-compare→accept/reject cycles |
| `lib/agents/evolvePool.ts` | Genetic operations: mutate_clarity, mutate_structure, crossover |
| `lib/agents/sectionDecompositionAgent.ts` | Parse→edit-per-section→stitch |

**Supporting files:**

| File | What to learn |
|---|---|
| `lib/section/` | `sectionParser`, `sectionEditRunner`, `sectionStitcher` |
| `lib/treeOfThought/` | Beam search, 2-stage hybrid evaluation (diff→pairwise→mini-tournament) |
| `lib/agents/treeSearchAgent.ts` | Explores revision trees on top variant |

---

## Module 11: Pipeline Orchestration

**Goal:** See how everything fits together.

| File | What to learn |
|---|---|
| `lib/core/pipeline.ts` | `executeFullPipeline` (iterative, phase-aware) and `executeMinimalPipeline` (internal linear utility) |
| `lib/core/persistence.ts` | Checkpoint save/load, variant persistence, attribution persistence |
| `lib/core/pipelineUtilities.ts` | Agent invocation tracking, diff metrics |

**The full loop:**

```
insertBaseline → LOOP { beginIteration → detectPhase →
  FOR agent in activeAgents: canExecute? → reserve → execute → record → checkpoint
  → shouldStop? } → finalize (summary, variants, attribution, arena sync)
```

---

## Module 12: Arena & Cross-Run Integration

**Goal:** Understand how runs interact with the shared arena.

| File | What to learn |
|---|---|
| `lib/core/arenaIntegration.ts` | `loadArenaEntries` (pre-seed pool from arena), `syncToArena` (push results back) |
| `services/arenaActions.ts` | Server actions for arena operations |

**Key concept:** Arena entries carry their ratings across runs. Variants with low sigma skip calibration.

---

## Module 13: Services Layer — How Runs Are Triggered

**Goal:** Understand the server-side orchestration.

| File | What to learn |
|---|---|
| `services/evolutionRunnerCore.ts` | End-to-end run execution, continuation handling |
| `services/evolutionRunClient.ts` | Client-side run management |
| `services/evolutionActions.ts` | CRUD, queueing, status management |
| `services/experimentActions.ts` | Batch experiments, A/B comparisons |
| `services/strategyRegistryActions.ts` | Strategy config CRUD |
| `services/costAnalyticsActions.ts` | Cost reporting |

---

## Module 14: Admin Dashboard UI

**Goal:** See how all this data is visualized.

| File | What to learn |
|---|---|
| `components/evolution/EntityListPage.tsx` | Browse runs table |
| `components/evolution/EntityDetailTabs.tsx` | Tabbed detail view (Variants, Elo, Lineage, Timeline, Logs) |
| `components/evolution/agentDetails/` | 14 agent-specific detail panels |
| `components/evolution/LineageGraph.tsx` | Parent-child variant graph |
| `components/evolution/EloSparkline.tsx` | Inline mu history chart |
| `components/evolution/TextDiff.tsx` | Side-by-side variant comparison |

---

## Suggested Reading Order (cover-to-cover)

1. `types.ts` → `base.ts` → `rating.ts` (what things are)
2. `comparison.ts` → `comparisonCache.ts` (how judging works)
3. `state.ts` → `pool.ts` → `costTracker.ts` (runtime infrastructure)
4. `config.ts` → `supervisor.ts` (configuration & phase machine)
5. `generationAgent.ts` → `calibrationRanker.ts` → `proximityAgent.ts` (expansion loop)
6. `tournament.ts` → `reflectionAgent.ts` → `iterativeEditingAgent.ts` → `evolvePool.ts` (competition loop)
7. `pipeline.ts` → `persistence.ts` (orchestration & checkpointing)
8. `arenaIntegration.ts` → `evolutionRunnerCore.ts` (cross-run & services)
