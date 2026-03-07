# Evolution Pipeline Architecture

Pipeline orchestration, phase transitions, stopping conditions, checkpoint/resume, and data flow for the evolution content improvement system.

## Overview

The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations of existing articles using LLM-driven agents. It operates as a self-contained subsystem under `evolution/src/lib/` with its own agent framework, OpenSkill Bayesian rating system, budget enforcement, and checkpoint/resume capability.

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
- GenerationAgent creates 3 variants per iteration using three strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance` (hardcoded in `GENERATION_STRATEGIES` constant).
- CalibrationRanker runs pairwise comparisons for new entrants against stratified opponents (3 opponents per entrant in this phase).
- ProximityAgent computes diversity score (1 - mean pairwise cosine similarity of top 10 variants). Supports optional **semantic+lexical blending** when `ctx.embedText` is provided: 70% semantic (external embeddings) + 30% lexical (trigram histogram), falling back to lexical-only when embeddings are unavailable or fail.

**Transition** to COMPETITION occurs when **(pool size >= 15 AND diversity >= 0.25) OR iteration >= 8**. The iteration-8 safety cap ensures COMPETITION always starts even if diversity remains low. Transition is **one-way** and locked once triggered — the pipeline never returns to EXPANSION.

**Short runs**: When `maxIterations` is too small for the default expansion window, `resolveConfig()` auto-clamps `expansion.maxIterations` (e.g., `maxIterations: 3` → expansion clamped to 0, EXPANSION skipped entirely). See [Reference — Auto-Clamping](./reference.md#auto-clamping-for-short-runs).

**COMPETITION** (iterations N+1 to max): Refine the best variants
- GenerationAgent creates 3 variants per iteration (same as EXPANSION).
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
- **`executeFullPipeline` (single-article mode)**: Same entry point as full pipeline but with `config.singleArticle: true`. Skips EXPANSION entirely (`expansion.maxIterations: 0`) and enters COMPETITION immediately. The supervisor gates out GenerationAgent, OutlineGenerationAgent, and EvolutionAgent — only improvement agents (ReflectionAgent, IterativeEditingAgent, SectionDecompositionAgent, DebateAgent) and ranking/monitoring agents run. Starts with a single baseline variant and iteratively refines it. Stops on quality threshold (all critique dimensions >= 8) or budget/iteration cap. Used by local CLI `--single` mode.
- **`executeMinimalPipeline`**: Simplified single-pass mode with no phase transitions. Runs a caller-provided list of agents once. Used for testing, custom agent sequences, and the local CLI runner (`run-evolution-local.ts`) default mode (generation + calibration only).

## Agent Selection

Strategies can specify which optional agents run via `enabledAgents`. This allows per-strategy control over which improvement agents participate in the pipeline.

### Agent Classification

- **Required agents** (always run, cannot be disabled): `generation`, `calibration`, `tournament`, `proximity`
- **Optional agents** (toggled per strategy): `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`, `flowCritique`

### Constraints

- **Dependencies**: `iterativeEditing`, `treeSearch`, `sectionDecomposition`, and `flowCritique` each require `reflection`. `evolution` and `metaReview` require `tournament` (always satisfied since tournament is required).
- **Single-article mode**: Automatically disables `generation`, `outlineGeneration`, and `evolution` regardless of `enabledAgents`.

### Two-Tier Agent Gating

Agent gating is now 2 layers:

1. **`getActiveAgents()` (supervisor)** — computes the ordered list of agents to run per iteration. Filters by phase (EXPANSION allows only generation + ranking + proximity), `enabledAgents` (per-strategy config), and `singleArticle` mode. Returns `ExecutableAgent[]` which the pipeline dispatch loop iterates directly.
2. **`canExecute()` (runtime)** — each agent's runtime guard checks pipeline state preconditions (e.g., minimum pool size).

The `enabledAgents` array on `EvolutionRunConfig` controls which optional agents the strategy permits. When undefined (backward compat), all agents are enabled. Required agents (generation, calibration, tournament) always run regardless of `enabledAgents`.

### Budget Redistribution

When agents are disabled, their budget share is redistributed proportionally to remaining active agents via `computeEffectiveBudgetCaps()`. This preserves the original total managed budget sum so that enabled agents can use the full allocation.

### UI Toggle

The strategy creation form (`strategies/page.tsx`) renders agent checkboxes. Required agents show as locked. The `toggleAgent()` utility enforces dependency auto-enable and dependent auto-disable on each toggle. Validation via `validateAgentSelection()` runs before save.

### Key Files

- `evolution/src/lib/core/budgetRedistribution.ts` — Agent classification, budget redistribution, validation
- `evolution/src/lib/core/agentToggle.ts` — Pure toggle utility for UI state
- `evolution/src/lib/core/supervisor.ts` — `getActiveAgents()` computes ordered agent list per iteration based on phase, `enabledAgents`, and `singleArticle` mode
- `evolution/src/lib/core/configValidation.ts` — Config validation (`validateStrategyConfig`, `validateRunConfig`, `isTestEntry`)

## Pipeline Module Decomposition

`pipeline.ts` (~809 LOC, reduced from ~1,363) delegates to four extracted modules:

| Module | Responsibility |
|--------|---------------|
| `core/persistence.ts` | Checkpoint upsert with retry, variant persistence, run failure/pause marking |
| `core/metricsWriter.ts` | Strategy config linking (delegates to `strategyResolution.ts` for atomic upsert), cost prediction persistence, per-agent cost metrics |
| `core/arenaIntegration.ts` | Arena topic/entry linking and variant feeding |
| `core/pipelineUtilities.ts` | Two-phase agent invocation persistence (`createAgentInvocation`/`updateAgentInvocation`), execution detail truncation, diff metrics computation |

The pipeline orchestrator retains iteration control, agent dispatch, stopping condition evaluation, and phase transitions. All DB persistence and post-run finalization logic now lives in the extracted modules.

**FlowCritique dispatch**: FlowCritique is dispatched as a standalone function (`runFlowCritiques()`) rather than an `AgentBase` subclass. It runs out-of-band with a custom try-catch wrapper in `pipeline.ts` that persists a `flowCritique` checkpoint and logs errors without halting the pipeline. See [Flow Critique](./agents/flow_critique.md).

## Append-Only Pool

Variants are never removed from the pool during a run. Low-performing variants naturally sink in Elo and become less likely to be selected as parents for evolution. However, they remain available because they may contain novel structural or stylistic elements useful for future crossover operations.

## Checkpoint, Resume, and Error Recovery

State is checkpointed to `evolution_checkpoints` table after every agent execution:
- Full pipeline state serialized to JSON (pool, ratings, match history, critiques, diversity, meta-feedback)
- Per-agent diff metrics (`_diffMetrics`) computed and stored in `evolution_agent_invocations.execution_detail` for each agent step
- Supervisor resume state preserved (phase, strategy rotation index, ordinal/diversity history). **Note:** `ordinalHistory` and `diversityHistory` are cleared when EXPANSION→COMPETITION transition occurs, so these arrays only track COMPETITION phase metrics.
- Heartbeat updates to `evolution_runs` after every agent step
- **Checkpoint pruning**: After run completion/failure, `pruneCheckpoints()` keeps only the latest checkpoint per iteration (reducing ~195 checkpoints to ~15 per run). Running/pending runs are never pruned.

### Error Recovery Paths

| Failure Mode | Pipeline Behavior | Recovery |
|---|---|---|
| Transient LLM error (socket timeout, 429, 5xx) | Agent degrades gracefully + pipeline retries agent once with exponential backoff | Run continues; no manual intervention needed |
| Agent throws non-transient error | Partial state checkpointed, run marked `failed` via `markRunFailed` (status guard: only transitions from pending/claimed/running/continuation_pending) | Variants generated before failure are preserved. Queue a new run to retry. |
| triggerEvolutionRunAction catch | Defense-in-depth: inline DB update marks run `failed` with same status guard, wrapped in try-catch to prevent masking the original error | Both layers are idempotent — safe if both fire for the same failure. |
| Budget exceeded | Run marked `paused`, not `failed` | Admin can increase budget. Batch runner or trigger action loads latest checkpoint and resumes. |
| Runner crashes (no heartbeat) | Watchdog cron marks run `failed` after 10 minutes (with defense-in-depth: checks for recent checkpoint before marking stale `running` run) | Queue a new run. Checkpoint data may allow manual investigation. |
| Timeout approaching (serverless) | Pipeline checkpoints and yields via `continuation_pending`. Cron resumes on next cycle. Max 10 continuations. | Automatic — no manual intervention needed. |
| All variants rejected by format validator | Pool doesn't grow for that iteration | Pipeline continues until budget or max iterations is reached. |
| Admin kill (`killEvolutionRunAction`) | Run set to `failed` with `error_message: 'Manually killed by admin'`. Pipeline detects at next iteration boundary, breaks with `stopReason: 'killed'`, skips completion update. | No recovery needed — intentional stop. In-flight LLM calls complete but results discarded. |
| Invalid config (model name, budget caps, agent constraints) | `validateStrategyConfig()` or `validateRunConfig()` rejects with error list. Run is not queued/started. | Admin fixes strategy config in UI. Inline warnings show validation errors on strategy selection. |

**Resume mechanism**: The shared runner core (`evolutionRunnerCore.ts`) and batch runner both support loading the latest checkpoint from `evolution_checkpoints.state_snapshot`, deserializing `PipelineState`, and restoring `supervisorState` (phase, ordinal/diversity history) to continue from the next scheduled agent.

### Pipeline Continuation & Vercel Timeouts

The evolution pipeline supports **continuation-passing** — when a run approaches the serverless timeout limit, it checkpoints state and yields. The cron runner automatically resumes it on the next cycle. This allows long-running evolution pipelines (often 30+ minutes total) to execute within Vercel's per-invocation time limits.

#### Vercel Timeout Configuration

The unified runner route (`src/app/api/evolution/run/route.ts`) exports `maxDuration = 800` — the maximum for Vercel Pro Fluid Compute (~13 minutes). The shared runner core defaults `maxDurationMs` to `740,000 ms` (12 min 20 sec), leaving 60 seconds for route setup, DB operations, and response finalization. The legacy cron path (`src/app/api/cron/evolution-runner/route.ts`) re-exports from the unified endpoint.

At the start of each iteration, the pipeline checks elapsed time against a **dynamic safety margin**: `min(120s, max(60s, 10% × elapsed))`. This scales the margin with run duration — short runs use 60s, longer runs grow up to 120s. If `elapsedMs > maxDurationMs - safetyMargin`, the pipeline yields.

#### End-to-End Continuation Flow

1. **Cron fires** → `route.ts` calls `claim_evolution_run` RPC
2. **RPC priority**: `continuation_pending` (priority 0) runs before `pending` (priority 1), using `FOR UPDATE SKIP LOCKED` for safe concurrent claiming
3. **Resume detection**: `isResume = (claimedRun.continuation_count ?? 0) > 0`
4. **If resuming**: `loadCheckpointForResume()` → `prepareResumedPipelineRun()` → restores full pipeline state (pool, ratings, match history, critiques, diversity, cost tracker, comparison cache) and supervisor state (phase, ordinal/diversity history)
5. **Execute**: `executeFullPipeline(runId, agents, ctx, logger, { maxDurationMs: 740000, continuationCount, supervisorResume, ... })`
6. **Per-iteration timeout check**: If elapsed time exceeds the dynamic safety margin
7. **On timeout**: `checkpointAndMarkContinuationPending()` calls the `checkpoint_and_continue` RPC — an atomic operation that:
   - Upserts full state snapshot to `evolution_checkpoints`
   - Transitions status `running → continuation_pending` (guarded by `WHERE status = 'running'`)
   - Clears `runner_id` so the next cron cycle can claim it
   - Increments `continuation_count`
   - Updates `current_iteration`, `phase`, `last_heartbeat`, `total_cost_usd`
8. **Next cron cycle** (5 minutes later): same flow, RPC picks up the `continuation_pending` run first

#### Runner Comparison

| Feature | Unified Endpoint | Minicomputer Batch Runner |
|---------|-----------------|--------------------------|
| Claim mechanism | `claim_evolution_run` RPC (with optional `p_run_id` for targeting) | `claim_evolution_run` RPC |
| runner_id | `cron-runner-<uuid>` (cron) or `admin-trigger` (admin) | `runner-<uuid>` |
| Heartbeat | 30s interval | 60s interval |
| maxDurationMs | 740,000 ms (default in shared core) | Not set (no timeout) |
| continuationCount | From DB | From DB |
| Resume support | Full | Full |
| Timeout yielding | Yes (checkpoints and yields) | No (runs to completion) |
| Auth | Dual: cron secret OR admin session | Direct Supabase service role |
| Target specific run | Yes (POST with `runId`) | No (FIFO) |
| Prompt-based runs | Yes | Yes |

The **Unified Endpoint** (`src/app/api/evolution/run/route.ts`) serves admin UI triggers. GET (cron) is disabled by default (`EVOLUTION_CRON_ENABLED` env var) but can be re-enabled as a backup. POST (admin) accepts an optional `runId` to target a specific run. Both use the shared runner core (`evolutionRunnerCore.ts`). The **Minicomputer Batch Runner** (`evolution/scripts/evolution-runner.ts`) runs on a local minicomputer via systemd timer (every minute) and executes to completion without timeout.

#### Guard Rails

- **MAX_CONTINUATIONS=10**: Prevents infinite loops — a run that continues 10 times is marked `failed`
- **Watchdog recovery** (every 15 minutes via `evolution-watchdog/route.ts`):
  - **Stale running/claimed** (heartbeat > 10 min, configurable via `EVOLUTION_STALENESS_THRESHOLD_MINUTES`): If a recent checkpoint exists → transition to `continuation_pending` (recovery path). If no checkpoint → mark `failed`
  - **Stale continuation_pending** (> 30 min): Mark `failed` with "abandoned" message
- **Atomic RPC guards**: `checkpoint_and_continue` uses `WHERE status = 'running'` so concurrent calls are idempotent

## Kill Mechanism

A running or claimed evolution run can be killed externally by an admin via `killEvolutionRunAction`. The kill uses a three-checkpoint defense-in-depth design:

1. **Claimed→running guard** (`pipeline.ts`): The status transition uses `.in('status', ['claimed'])` so a concurrent kill (which sets status to `'failed'`) prevents the pipeline from overwriting it with `'running'`.
2. **Iteration-level status check** (`pipeline.ts`): At the top of each iteration loop, the pipeline reads the run's current status from the database. If status is `'failed'`, the loop breaks with `stopReason = 'killed'`.
3. **Completion guard** (`pipeline.ts`): After the loop, the completion update is wrapped in `if (stopReason !== 'killed')` with an additional `.in('status', ['running'])` guard. Killed runs skip `finalizePipelineRun()` (no summary/metrics for partial runs).

The kill action sets `error_message: 'Manually killed by admin'` and `completed_at` to preserve attribution. In-flight LLM calls will still complete but their results are discarded at the next iteration boundary.

**Catch-block interaction**: If an agent throws after the kill check passes but before the next iteration, `markRunFailed()` fires with `.in('status', ['pending', 'claimed', 'running'])`. Since the run is already `'failed'`, this is a no-op — the kill attribution is preserved.

**Admin UI**: A "Kill" button is available on the Pipeline Runs page (`src/app/admin/quality/evolution/page.tsx`) for runs with active statuses (`pending`, `claimed`, `running`, `continuation_pending`). It calls `killEvolutionRunAction` and refreshes the runs table on success.

## Config Validation

Strategy configs and resolved run configs are validated at two points:

1. **Strategy-level** (`buildRunConfig()` in `evolutionActions.ts`): Calls `validateStrategyConfig()` on the processed config before inserting a run into the database. Lenient — skips checks on absent fields since partial configs get defaults from `resolveConfig()`.
2. **Run-level** (`preparePipelineRun()` in `index.ts`): Calls `validateRunConfig()` on the complete config after `resolveConfig()` merges defaults. Strict — all fields must be present and valid.

Validation checks include: model names against the `allowedLLMModelSchema` enum, budget cap keys/values, agent dependency and mutex constraints via `validateAgentSelection()`, iteration bounds, supervisor constraints (expansion minPool, maxIterations relationships), and nested object bounds.

Both functions return all errors (no short-circuit) so admins see everything at once. The validation module (`configValidation.ts`) is a pure module with no Node.js-only imports — safe for both server code and `'use client'` components.

## Stopping Conditions

The PoolSupervisor evaluates stopping conditions at the start of each iteration:

1. **Quality threshold** (single-article mode only, checked first): If all critique dimension scores for the top variant's latest critique are >= 8, the article has reached sufficient quality.
2. **Budget exhausted**: If available budget drops below $0.01, stop immediately.
3. **Max iterations**: Hard cap at `maxIterations` (default: 50). `maxIterations=N` runs exactly N agent iterations — the `shouldStop()` check fires when `state.iteration > N`, acting as a safety net for checkpoint resume scenarios. The for-loop's own `i < maxIterations` condition exits naturally after N iterations.

## Data Flow

### Full Pipeline Execution

```
1. Run Queued (admin UI or auto-queue cron for articles scoring < 0.4)
   └─ Insert into evolution_runs (status='pending')

2. Runner Claims Run (batch script or admin trigger)
   └─ Atomic claim via claim_evolution_run() RPC (fallback: UPDATE WHERE status='pending')
   └─ Initialize: PipelineStateImpl, CostTracker, LLMClient, Logger, Agents
   └─ Insert baseline variant (original text at Elo 1200)

3. Pipeline Loop (up to maxIterations=50)
   ├─ state.startNewIteration() → clears newEntrantsThisIteration
   ├─ Supervisor.beginIteration() → detect/lock phase
   ├─ Supervisor.getPhaseConfig() → which agents run this iteration
   ├─ Supervisor.shouldStop() → check quality/budget/iterations
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
   │   ├─ FlowCritique* → flow-level evaluation (0-5 scale)
   │   ├─ IterativeEditingAgent → critique→edit→judge on top variant → accepted edits
   │   ├─ SectionDecompositionAgent → parse H2 sections, parallel edit, stitch → stitched variant
   │   ├─ DebateAgent → 3-turn debate on top 2 → synthesis variant
   │   ├─ EvolutionAgent → mutate_clarity, mutate_structure, crossover, creative_exploration
   │   ├─ Tournament or CalibrationRanker → ranking with 5 opponents per entrant
   │   ├─ ProximityAgent → diversity score update
   │   └─ MetaReviewAgent → meta-feedback for next iteration
   │
   ├─ Two-phase invocation lifecycle:
   │   ├─ createAgentInvocation → row with UUID before agent executes (used as FK for LLM call tracking)
   │   ├─ createScopedLLMClient → wraps llmClient with invocationId for per-call cost attribution
   │   └─ updateAgentInvocation → final cost (incremental), status, execution detail after completion
   └─ Checkpoint after each agent + supervisor state at end-of-iteration

4. Stopping Conditions (checked at iteration start)
   ├─ External kill (status check reads 'failed' → stopReason='killed', skip completion)
   ├─ Quality threshold (single-article only: all critique dimensions >= 8)
   ├─ Budget exhausted (available < $0.01)
   └─ Max iterations reached (default: 50)

5. Pipeline Completion
   ├─ Build EvolutionRunSummary via buildRunSummary()
   ├─ Validate with Zod schema (non-fatal — null on failure)
   ├─ Persist run_summary to evolution_runs (JSONB)
   ├─ Persist all variants to evolution_variants for admin UI
   ├─ linkStrategyConfig: if strategy_config_id not pre-set, atomically resolve via
   │   resolveOrCreateStrategyFromRunConfig (INSERT-first, fallback SELECT), then update aggregates
   ├─ persistCostPrediction: queries evolution_agent_invocations for actual per-agent costs,
   │   calls computeCostPrediction(estimated, actualTotalUsd, perAgentCosts) if cost_estimate_detail exists
   ├─ Fire-and-forget refreshAgentCostBaselines(30) to update estimation baselines (nested inside persistCostPrediction in metricsWriter.ts)
   └─ computeAndPersistAttribution: per-variant elo_attribution JSONB + per-agent agent_attribution JSONB (creator-based)

6. Winner Application (admin action via applyWinnerAction)
   ├─ Replaces entire explanations.content column (including H1 title)
   ├─ Variant marked is_winner=true in evolution_variants
   └─ Triggers post-evolution quality eval (fire-and-forget, gated by
      content_quality_eval_enabled feature flag — silently skips if disabled)

   Note: explanation_title column is NOT updated — only content changes.
   This can cause title mismatches if the winning variant's H1 differs.
```

## Known Implementation Gaps

1. **Title mismatch**: `applyWinnerAction` replaces `explanations.content` but does not update `explanation_title`. If the winning variant's H1 differs from the original, the database title and content title will diverge.

## Parallel Execution

The batch runner supports parallel execution of multiple evolution runs within a single process via `--parallel N`. Pipeline state is fully per-run isolated (separate `PipelineStateImpl`, `CostTracker`, `ComparisonCache`, `LogBuffer`, and agent instances), so concurrent runs do not interfere with each other.

Rate limiting is enforced by an in-process `LLMSemaphore` (`src/lib/services/llmSemaphore.ts`) that caps the total number of concurrent LLM API calls across all parallel runs. The semaphore is integrated into `callLLMModelRaw()` for `evolution_*` call sources — non-evolution calls bypass the semaphore entirely. The default limit is 20 concurrent calls, configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var or `--max-concurrent-llm` CLI flag.

Run claiming uses an atomic `claim_evolution_run` RPC (`FOR UPDATE SKIP LOCKED`) to prevent double-claiming when multiple runners or parallel batches compete for pending runs.

Evolution runs are executed by a local minicomputer running the batch runner script on a systemd timer (every minute). The Vercel cron is disabled by default but can be re-enabled as a backup by setting `EVOLUTION_CRON_ENABLED=true` in Vercel env vars. The POST endpoint at `/api/evolution/run` remains functional for the admin UI "Trigger" button regardless of the cron setting.

## Related Documentation

- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating, Swiss tournament, bias mitigation
- [Agent Overview](./agents/overview.md) — Agent framework, ExecutionContext, interaction patterns
- [Reference](./reference.md) — Configuration, feature flags, budget caps, database schema, key files
- [Cost Optimization](./cost_optimization.md) — Cost tracking, Pareto analysis
- [Visualization](./visualization.md) — Admin dashboard and components (run-scoped views)
