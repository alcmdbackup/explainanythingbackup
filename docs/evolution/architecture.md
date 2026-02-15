# Evolution Pipeline Architecture

Pipeline orchestration, phase transitions, stopping conditions, checkpoint/resume, and data flow for the evolution content improvement system.

## Overview

The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations of existing articles using LLM-driven agents. It operates as a self-contained subsystem under `src/lib/evolution/` with its own agent framework, OpenSkill Bayesian rating system, budget enforcement, and checkpoint/resume capability.

The pipeline uses an evolutionary algorithm metaphor: a pool of text variants competes via LLM-judged pairwise comparisons, top performers reproduce via mutation and crossover, and the population converges toward higher quality through iterative selection pressure.

```
Article Text → EXPANSION phase (grow pool) → COMPETITION phase (refine pool) → Winner Applied
                 │                              │
                 ├─ GenerationAgent              ├─ GenerationAgent (focused strategy)
                 ├─ CalibrationRanker            ├─ OutlineGenerationAgent* (outline→expand→polish)
                 ├─ ProximityAgent               ├─ ReflectionAgent (critique top 3)
                 │                              ├─ IterativeEditingAgent (critique→edit→judge)
                 │                              ├─ SectionDecompositionAgent (H2 section-level edits)
                 │                              ├─ DebateAgent (structured 3-turn debate)
                 │                              ├─ EvolutionAgent (mutate/crossover)
                 │                              ├─ CalibrationRanker or Tournament
                 │                              ├─ ProximityAgent (diversity tracking)
                 │                              └─ MetaReviewAgent (meta-feedback)
```
\* OutlineGenerationAgent gated by `evolution_outline_generation_enabled` feature flag (default: `false`). See [Generation Agents](./agents/generation.md).

## Two-Phase Pipeline

The pipeline uses a **PoolSupervisor** (`core/supervisor.ts`) that manages a one-way phase transition:

**EXPANSION** (iterations 0-N): Build a diverse pool of variants
- GenerationAgent creates 3 variants per iteration using three strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`. **Note:** The supervisor prepares a strategy payload that collapses to a single strategy when diversity is low, but the current `GenerationAgent` implementation always uses its own hardcoded `STRATEGIES` constant — the supervisor's strategy routing is not yet consumed.
- CalibrationRanker runs pairwise comparisons for new entrants against stratified opponents (3 opponents per entrant in this phase).
- ProximityAgent computes diversity score (1 - mean pairwise cosine similarity of top 10 variants).

**Transition** to COMPETITION occurs when **(pool size >= 15 AND diversity >= 0.25) OR iteration >= 8**. The iteration-8 safety cap ensures COMPETITION always starts even if diversity remains low. Transition is **one-way** and locked once triggered — the pipeline never returns to EXPANSION.

**Short runs**: When `maxIterations` is too small for the default expansion window, `resolveConfig()` auto-clamps `expansion.maxIterations` (e.g., `maxIterations: 3` → expansion clamped to 0, EXPANSION skipped entirely). See [Reference — Auto-Clamping](./reference.md#auto-clamping-for-short-runs).

**COMPETITION** (iterations N+1 to max): Refine the best variants
- GenerationAgent creates 3 variants per iteration (same as EXPANSION). **Note:** The supervisor prepares a rotating single-strategy payload for COMPETITION, but the current `GenerationAgent` does not consume it — it always generates all 3 strategies. This is a known gap between the supervisor's design intent and the agent's implementation.
- OutlineGenerationAgent (if enabled) creates 1 outline-based variant via a 6-call pipeline. See [Generation Agents](./agents/generation.md).
- ReflectionAgent critiques top 3 variants across 5 dimensions. See [Support Agents](./agents/support.md#reflectionagent).
- IterativeEditingAgent takes the top variant and applies critique-driven surgical edits. See [Editing Agents](./agents/editing.md#iterative-editing-agent-whole-article).
- SectionDecompositionAgent decomposes top variant into H2 sections for parallel editing. See [Editing Agents](./agents/editing.md#section-decomposition-agent-hierarchical).
- DebateAgent runs a structured 3-turn debate on top 2 non-baseline variants. See [Support Agents](./agents/support.md#debateagent).
- EvolutionAgent creates children via mutation, crossover, and creative exploration. See [Support Agents](./agents/support.md#evolutionagent-evolvepool).
- Ranking agent: **Tournament** (Swiss-style, default) or **CalibrationRanker** (if `evolution_tournament_enabled` flag is false). Uses 5 opponents per entrant in this phase.
- ProximityAgent continues diversity monitoring. See [Support Agents](./agents/support.md#proximityagent).
- MetaReviewAgent analyzes strategy performance and provides meta-feedback. See [Support Agents](./agents/support.md#metareviewagent).

## Three Pipeline Modes

- **`executeFullPipeline`**: Production path. Uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint after each agent, convergence detection, and supervisor state persistence. Used by admin trigger, cron runner, batch runner, standalone runner, and local CLI `--full` mode. All callsites use `createDefaultAgents()` for consistent 12-agent construction and `finalizePipelineRun()` for shared post-completion persistence.
- **`executeFullPipeline` (single-article mode)**: Same entry point as full pipeline but with `config.singleArticle: true`. Skips EXPANSION entirely (`expansion.maxIterations: 0`) and enters COMPETITION immediately. The supervisor gates out GenerationAgent, OutlineGenerationAgent, and EvolutionAgent — only improvement agents (ReflectionAgent, IterativeEditingAgent, SectionDecompositionAgent, DebateAgent) and ranking/monitoring agents run. Starts with a single baseline variant and iteratively refines it. Stops on quality threshold (all critique dimensions >= 8), plateau (window: 2), or budget/iteration cap. Used by local CLI `--single` mode.
- **`executeMinimalPipeline`**: Simplified single-pass mode with no phase transitions. Runs a caller-provided list of agents once. Used for testing, custom agent sequences, and the local CLI runner (`run-evolution-local.ts`) default mode (generation + calibration only).

## Agent Selection

Strategies can specify which optional agents run via `enabledAgents`. This allows per-strategy control over which improvement agents participate in the pipeline.

### Agent Classification

- **Required agents** (always run, cannot be disabled): `generation`, `calibration`, `tournament`, `proximity`
- **Optional agents** (toggled per strategy): `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`

### Constraints

- **Dependencies**: `iterativeEditing`, `treeSearch`, and `sectionDecomposition` each require `reflection`. `evolution` and `metaReview` require `tournament` (always satisfied since tournament is required).
- **Mutual exclusion**: `treeSearch` and `iterativeEditing` cannot both be enabled.
- **Single-article mode**: Automatically disables `generation`, `outlineGeneration`, and `evolution` regardless of `enabledAgents`.

### Three-Tier Agent Gating

An agent must pass all three tiers to execute:

1. **PhaseConfig (supervisor)** — `getPhaseConfig()` returns per-phase `run*` booleans. EXPANSION disables all improvement agents; COMPETITION enables them. The supervisor calls `isEnabled()` internally, which checks `enabledAgents` and always returns true for required agents.
2. **Feature flags (global DB)** — `EvolutionFeatureFlags` from the `feature_flags` table can globally disable specific agents (e.g., `evolution_outline_generation_enabled`). Checked by individual agents at execution time.
3. **enabledAgents (per-strategy)** — The `enabledAgents` array on `EvolutionRunConfig` controls which optional agents the strategy permits. When undefined (backward compat), all agents are enabled.

### Budget Redistribution

When agents are disabled, their budget share is redistributed proportionally to remaining active agents via `computeEffectiveBudgetCaps()`. This preserves the original total managed budget sum so that enabled agents can use the full allocation. Agents outside the managed set (e.g., `flowCritique`) are passed through unchanged.

### UI Toggle

The strategy creation form (`strategies/page.tsx`) renders agent checkboxes. Required agents show as locked. The `toggleAgent()` utility enforces dependency auto-enable, dependent auto-disable, and mutex constraints on each toggle. Validation via `validateAgentSelection()` runs before save.

### Key Files

- `src/lib/evolution/core/budgetRedistribution.ts` — Agent classification, budget redistribution, validation
- `src/lib/evolution/core/agentToggle.ts` — Pure toggle utility for UI state
- `src/lib/evolution/core/supervisor.ts` — `isEnabled()` gating in `getPhaseConfig()`
- `src/lib/evolution/core/configValidation.ts` — Config validation (`validateStrategyConfig`, `validateRunConfig`, `isTestEntry`)

## Append-Only Pool

Variants are never removed from the pool during a run. Low-performing variants naturally sink in Elo and become less likely to be selected as parents for evolution. However, they remain available because they may contain novel structural or stylistic elements useful for future crossover operations.

## Checkpoint, Resume, and Error Recovery

State is checkpointed to `evolution_checkpoints` table after every agent execution:
- Full pipeline state serialized to JSON (pool, ratings, match history, critiques, diversity, meta-feedback)
- Supervisor resume state preserved (phase, strategy rotation index, ordinal/diversity history). **Note:** `ordinalHistory` and `diversityHistory` are cleared when EXPANSION→COMPETITION transition occurs, so these arrays only track COMPETITION phase metrics.
- Heartbeat updates to `content_evolution_runs` after every agent step

### Error Recovery Paths

| Failure Mode | Pipeline Behavior | Recovery |
|---|---|---|
| Transient LLM error (socket timeout, 429, 5xx) | Agent degrades gracefully + pipeline retries agent once with exponential backoff | Run continues; no manual intervention needed |
| Agent throws non-transient error | Partial state checkpointed, run marked `failed` via `markRunFailed` (status guard: only transitions from pending/claimed/running) | Variants generated before failure are preserved. Queue a new run to retry. |
| triggerEvolutionRunAction catch | Defense-in-depth: inline DB update marks run `failed` with same status guard, wrapped in try-catch to prevent masking the original error | Both layers are idempotent — safe if both fire for the same failure. |
| Budget exceeded | Run marked `paused`, not `failed` | Admin can increase budget. Batch runner or trigger action loads latest checkpoint and resumes. |
| Runner crashes (no heartbeat) | Watchdog cron marks run `failed` after 10 minutes | Queue a new run. Checkpoint data may allow manual investigation. |
| All variants rejected by format validator | Pool doesn't grow for that iteration | Pipeline continues but may hit degenerate state stop (diversity < 0.01). |
| Admin kill (`killEvolutionRunAction`) | Run set to `failed` with `error_message: 'Manually killed by admin'`. Pipeline detects at next iteration boundary, breaks with `stopReason: 'killed'`, skips completion update. | No recovery needed — intentional stop. In-flight LLM calls complete but results discarded. |
| Invalid config (model name, budget caps, agent constraints) | `validateStrategyConfig()` or `validateRunConfig()` rejects with error list. Run is not queued/started. | Admin fixes strategy config in UI. Inline warnings show validation errors on strategy selection. |

**Resume mechanism**: The batch runner and `triggerEvolutionRunAction` both support loading the latest checkpoint from `evolution_checkpoints.state_snapshot`, deserializing `PipelineState`, and restoring `supervisorState` (phase, rotation index, history) to continue from the next scheduled agent.

## Kill Mechanism

A running or claimed evolution run can be killed externally by an admin via `killEvolutionRunAction`. The kill uses a three-checkpoint defense-in-depth design:

1. **Claimed→running guard** (`pipeline.ts`): The status transition uses `.in('status', ['claimed'])` so a concurrent kill (which sets status to `'failed'`) prevents the pipeline from overwriting it with `'running'`.
2. **Iteration-level status check** (`pipeline.ts`): At the top of each iteration loop, the pipeline reads the run's current status from the database. If status is `'failed'`, the loop breaks with `stopReason = 'killed'`.
3. **Completion guard** (`pipeline.ts`): After the loop, the completion update is wrapped in `if (stopReason !== 'killed')` with an additional `.in('status', ['running'])` guard. Killed runs skip `finalizePipelineRun()` (no summary/metrics for partial runs).

The kill action sets `error_message: 'Manually killed by admin'` and `completed_at` to preserve attribution. In-flight LLM calls will still complete but their results are discarded at the next iteration boundary.

**Catch-block interaction**: If an agent throws after the kill check passes but before the next iteration, `markRunFailed()` fires with `.in('status', ['pending', 'claimed', 'running'])`. Since the run is already `'failed'`, this is a no-op — the kill attribution is preserved.

## Config Validation

Strategy configs and resolved run configs are validated at two points:

1. **Strategy-level** (`buildRunConfig()` in `evolutionActions.ts`): Calls `validateStrategyConfig()` on the processed config before inserting a run into the database. Lenient — skips checks on absent fields since partial configs get defaults from `resolveConfig()`.
2. **Run-level** (`preparePipelineRun()` in `index.ts`): Calls `validateRunConfig()` on the complete config after `resolveConfig()` merges defaults. Strict — all fields must be present and valid.

Validation checks include: model names against the `allowedLLMModelSchema` enum, budget cap keys/values, agent dependency and mutex constraints via `validateAgentSelection()`, iteration bounds, supervisor constraints (expansion minPool, maxIterations relationships), and nested object bounds.

Both functions return all errors (no short-circuit) so admins see everything at once. The validation module (`configValidation.ts`) is a pure module with no Node.js-only imports — safe for both server code and `'use client'` components.

## Stopping Conditions

The PoolSupervisor evaluates stopping conditions at the start of each iteration:

1. **Quality threshold** (single-article mode only, checked first): If all critique dimension scores for the top variant's latest critique are >= 8, the article has reached sufficient quality. This is a success condition and is checked before plateau detection so it takes priority.
2. **Quality plateau** (COMPETITION only): If the top variant's ordinal improves by less than `threshold x 6` ordinal points (default: 0.12) over the last `window` iterations (default: 3), the pool has converged and further iterations are unlikely to find improvements.
3. **Budget exhausted**: If available budget drops below $0.01, stop immediately.
4. **Max iterations**: Hard cap at `maxIterations` (default: 15). `maxIterations=N` runs exactly N agent iterations — the `shouldStop()` check fires when `state.iteration > N`, acting as a safety net for checkpoint resume scenarios. The for-loop's own `i < maxIterations` condition exits naturally after N iterations.
5. **Degenerate state**: If diversity score drops below 0.01 during a plateau check, the pool has collapsed to near-identical variants — continuing would waste budget.

## Data Flow

### Full Pipeline Execution

```
1. Run Queued (admin UI or auto-queue cron for articles scoring < 0.4)
   └─ Insert into content_evolution_runs (status='pending')

2. Runner Claims Run (batch script or admin trigger)
   └─ Atomic claim via claim_evolution_run() RPC (fallback: UPDATE WHERE status='pending')
   └─ Initialize: PipelineStateImpl, CostTracker, LLMClient, Logger, Agents
   └─ Insert baseline variant (original text at Elo 1200)

3. Pipeline Loop (up to maxIterations=15)
   ├─ state.startNewIteration() → clears newEntrantsThisIteration
   ├─ Supervisor.beginIteration() → detect/lock phase
   ├─ Supervisor.getPhaseConfig() → which agents run this iteration
   ├─ Supervisor.shouldStop() → check plateau/budget/iterations/degenerate
   │
   ├─ [EXPANSION]
   │   ├─ GenerationAgent → 3 new variants (all 3 strategies)
   │   ├─ CalibrationRanker → new entrants vs 3 stratified opponents
   │   └─ ProximityAgent → diversity score update
   │
   ├─ [COMPETITION]
   │   ├─ GenerationAgent → 3 new variants (all 3 strategies)
   │   ├─ OutlineGenerationAgent* → 1 outline variant (6-call pipeline, step scores)
   │   ├─ ReflectionAgent → critique top 3 variants (5 dimensions)
   │   ├─ IterativeEditingAgent → critique→edit→judge on top variant → accepted edits
   │   ├─ SectionDecompositionAgent → parse H2 sections, parallel edit, stitch → stitched variant
   │   ├─ DebateAgent → 3-turn debate on top 2 → synthesis variant
   │   ├─ EvolutionAgent → mutate_clarity, mutate_structure, crossover, creative_exploration
   │   ├─ Tournament or CalibrationRanker → ranking with 5 opponents per entrant
   │   ├─ ProximityAgent → diversity score update
   │   └─ MetaReviewAgent → meta-feedback for next iteration
   │
   ├─ persistAgentInvocation → execution detail to evolution_agent_invocations
   └─ Checkpoint after each agent + supervisor state at end-of-iteration

4. Stopping Conditions (checked at iteration start)
   ├─ External kill (status check reads 'failed' → stopReason='killed', skip completion)
   ├─ Quality threshold (single-article only: all critique dimensions >= 8)
   ├─ Quality plateau (top ordinal change < 0.12 over 3 iterations)
   ├─ Budget exhausted (available < $0.01)
   ├─ Max iterations reached (default: 15)
   └─ Degenerate state (diversity < 0.01 during plateau)

5. Pipeline Completion
   ├─ Build EvolutionRunSummary via buildRunSummary()
   ├─ Validate with Zod schema (non-fatal — null on failure)
   ├─ Persist run_summary to content_evolution_runs (JSONB)
   ├─ Persist all variants to content_evolution_variants for admin UI
   ├─ Compute cost_prediction (estimated vs actual delta, per-agent) if cost_estimate_detail exists
   └─ Fire-and-forget refreshAgentCostBaselines(30) to update estimation baselines

6. Winner Application (admin action via applyWinnerAction)
   ├─ Replaces entire explanations.content column (including H1 title)
   ├─ Previous content saved to content_history (source='evolution_pipeline')
   ├─ Variant marked is_winner=true in content_evolution_variants
   └─ Triggers post-evolution quality eval (fire-and-forget, gated by
      content_quality_eval_enabled feature flag — silently skips if disabled)

   Note: explanation_title column is NOT updated — only content changes.
   This can cause title mismatches if the winning variant's H1 differs.
```

## Known Implementation Gaps

1. **Supervisor strategy routing**: The supervisor prepares strategy payloads (single-strategy in COMPETITION, collapsed when diversity is low), but `GenerationAgent` always uses its own hardcoded `STRATEGIES` constant. The supervisor's intent is not consumed.
2. **Title mismatch**: `applyWinnerAction` replaces `explanations.content` but does not update `explanation_title`. If the winning variant's H1 differs from the original, the database title and content title will diverge.

## Parallel Execution

The batch runner supports parallel execution of multiple evolution runs within a single process via `--parallel N`. Pipeline state is fully per-run isolated (separate `PipelineStateImpl`, `CostTracker`, `ComparisonCache`, `LogBuffer`, and agent instances), so concurrent runs do not interfere with each other.

Rate limiting is enforced by an in-process `LLMSemaphore` (`src/lib/services/llmSemaphore.ts`) that caps the total number of concurrent LLM API calls across all parallel runs. The semaphore is integrated into `callLLMModelRaw()` for `evolution_*` call sources — non-evolution calls bypass the semaphore entirely. The default limit is 20 concurrent calls, configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var or `--max-concurrent-llm` CLI flag.

Run claiming uses an atomic `claim_evolution_run` RPC (`FOR UPDATE SKIP LOCKED`) to prevent double-claiming when multiple runners or parallel batches compete for pending runs.

The dashboard provides a "Batch Dispatch" card that triggers the GitHub Actions workflow with configurable parallelism via the GitHub REST API.

## Related Documentation

- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating, Swiss tournament, bias mitigation
- [Agent Overview](./agents/overview.md) — Agent framework, ExecutionContext, interaction patterns
- [Reference](./reference.md) — Configuration, feature flags, budget caps, database schema, key files
- [Cost Optimization](./cost_optimization.md) — Cost tracking, adaptive allocation
- [Visualization](./visualization.md) — Admin dashboard and components
