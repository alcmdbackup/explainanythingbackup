# Integration Plan: Writing Pipeline → ExplainAnything (Full TypeScript Port) — v2

**Revised after 4-agent critical review (Architecture, Security, Testing, Feasibility).**

## Recommendation: Full TypeScript Port

**Port both evals and evolution to TypeScript. Retire the Python repo after 3-month validation period.**

### Why Full Port

| Module | Port LOC | Portability | Rationale |
|--------|----------|-------------|-----------|
| **Evals** | ~800 | Moderate | compare.py has dual verdict types (IndependentVerdict, ComparisonVerdict) and 3-outcome disagreement resolution (confident win, consistent tie, inconclusive). criteria.py is straightforward string templates. |
| **Evolution core** | 785 | Moderate | Pure math, but elo.py has 3 update variants with adaptive K-factor, state.py has multi-phase mutation contracts validated by validation.py, pool.py has stratified sampling edge cases. |
| **Evolution orchestration** | 1,071 | Moderate | supervisor.py has one-way phase lock, rotation index, history clearing. pipeline.py has checkpoint/resume that must be designed for TypeScript. |
| **Evolution agents** | 3,775 | Complex | tournament.py: Swiss pairing + single-call tiebreaker + convergence detection + adaptive K per-variant (budget thresholds 0.5/0.8). pairwise_ranker.py: multi-branch disagreement resolution (~8 cases) + dimension score merging + confidence calculation. evolve_pool.py: creative exploration + stagnation detection + retry logic. Not "mechanical." |

### Why Not Keep Python

- **Two toolchains, one developer.** Maintaining Python CI, pytest, pyproject.toml, and TypeScript CI, Jest, package.json doubles operational burden for no user-facing benefit.
- **Shared infrastructure for free.** Ported agents get cost tracking, tracing, and logging via existing `callOpenAIModel` in `llms.ts` — no extra work.
- **Single Claude Code setup.** Worktrees, `/initialize`, hooks, `/finalize` all just work. No need to replicate infrastructure for a second repo.
- **Runtime constraint is language-independent.** Evolution batch jobs can't run on Vercel regardless of language. GitHub Actions runs Node.js just as easily as Python.

### Dependency Replacement (verified)

| Python dependency | Actual usage | TypeScript replacement | Verified? |
|-------------------|-------------|----------------------|-----------|
| **sentence-transformers** | ~120 LOC in `proximity_agent.py` (caching, sparse matrix, diversity computation, test fallback). Not "2 lines." | **MVP**: Disable diversity tracking (set `useEmbeddings: false`). **Production**: OpenAI embeddings API (already used for Pinecone). | Yes |
| **numpy** | `pipeline.py` — JSON encoding of `np.float32`/`np.ndarray` from embedding model output. | Not needed when using OpenAI embeddings (returns native JS arrays) or when embeddings are disabled. | Yes |
| **deepeval** | Evals metrics framework. Replaced entirely. | Direct `callOpenAIModel` + Zod structured output + criteria from `criteria.py`. | Yes |
| **pydantic** | Data validation throughout. | Zod (already used project-wide). | Yes |
| **tenacity** | Retry with exponential backoff (2-30s) on rate limits. | OpenAI SDK has `maxRetries: 3` built in (verified in `llms.ts:100`). Sufficient for non-streaming agent calls. | Yes |
| **structlog** | Structured logging with kwargs throughout agents. | New `EvolutionLogger` interface wrapping existing `logger` from `src/lib/server_utilities`. See Decision 8. | Yes |
| **krippendorff** | Inter-rater reliability for ground truth collection. | **Out of scope** — ground truth tooling (`collect_ground_truth.py`) is not being ported. | N/A |

### `callOpenAIModel` Capabilities (verified against `llms.ts`)

| Capability | Status | Notes |
|------------|--------|-------|
| Zod structured output | ✅ | Uses `zodResponseFormat()` at line 164. Requires both schema AND schema name. |
| Per-call cost tracking | ✅ | `call_source` parameter (line 125) written to `llmCallTracking` table. Use `evolution_{agentName}` for attribution. |
| Tracing spans | ✅ | OpenTelemetry span created at line 167 with model, prompt length, call_source, streaming mode. |
| Automatic logging | ✅ | Wrapped with `withLogging` at line 287. |
| Retry on failure | ✅ | OpenAI SDK `maxRetries: 3` at line 100. Uses SDK default backoff. Covers network errors only — NOT Zod parse failures. |
| Non-streaming mode | ✅ | Must pass `streaming=false, setText=null` (strict enforcement at lines 139-144). |
| Return type | ⚠️ | Returns `Promise<string>` — raw message content (line 223: `completion.choices[0]?.message?.content \|\| ''`). With structured output, this is a JSON string. Refusals return `''` → `JSON.parse('')` throws. Wrapper must handle. |
| Per-agent budget enforcement | ❌ | Not built in. Must implement in `costTracker.ts` wrapper. See Decision 6. |

---

## Foundational Decisions (resolve before Slice A)

### Decision 1: PipelineState Mutability + Checkpoint/Restore

**Choice: Mutable in-memory during a run. Checkpoint to DB after every agent execution. Restore from checkpoint on resume.**

Rationale: Evolution runs are single-instance batch jobs (one runner per run, enforced by concurrency control). The Python code mutates state in-place. Porting this pattern directly is simpler than introducing immutable-delta architecture.

**Checkpoint pattern** (addresses data integrity concern):
```typescript
for (const agent of phaseAgents) {
  await agent.execute(ctx);
  // state was mutated by agent — checkpoint immediately
  await persistCheckpoint(runId, {
    iteration: state.currentIteration,
    phase: state.phase,
    stateSnapshot: serializeState(state),
    lastAgent: agent.name,
  });
}
```

**Restore pattern** (addresses crash recovery):
```typescript
async function resumeRun(runId: string): Promise<PipelineState> {
  const checkpoint = await getLatestCheckpoint(runId);
  if (!checkpoint) throw new Error(`No checkpoint for run ${runId}`);
  const state = deserializeState(checkpoint.stateSnapshot);
  logger.info('Resumed from checkpoint', {
    runId, iteration: checkpoint.iteration, phase: checkpoint.phase
  });
  return state;
}
```

**Persistence with retry** (addresses partial write risk):
```typescript
async function persistCheckpoint(
  runId: string, checkpoint: Checkpoint, maxRetries = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await supabase.from('evolution_checkpoints').insert(checkpoint);
      await supabase.from('content_evolution_runs').update({
        current_iteration: checkpoint.iteration,
        phase: checkpoint.phase,
        latest_checkpoint_ts: new Date().toISOString(),
      }).eq('id', runId);
      return;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
}
```

### Decision 2: Directory Structure

**Choice: `src/lib/evolution/` — standalone subsystem, not under `services/`.**

Rationale: Evolution is 5500+ LOC with its own internal dependency graph (agents → core → state). The existing `services/` folder contains stateless utilities (50-200 LOC each).

The eval service (`contentQualityEval.ts`) stays in `services/` — it's a simple service that calls `callOpenAIModel`, like the existing summarizer.

### Decision 3: Embedding Strategy / ProximityAgent

**Choice: Port ProximityAgent as a no-op stub for MVP. Full implementation post-MVP.**

- **MVP**: `ProximityAgent.execute()` returns `{ skipped: true, reason: 'embeddings_disabled' }`. Supervisor config sets `useEmbeddings: false`. Phase transitions based on pool size and iteration count only.
- **EXPANSION → COMPETITION transition (without embeddings)**: Trigger when `poolSize >= config.expansion.minPool` AND `iteration >= config.expansion.minIterations` (new field, default 3). This prevents premature transition with too few iterations.
- **Production** (post-MVP): OpenAI `text-embedding-3-small` embeddings.
- **Not using hash fallback.** Hash-based embeddings produce semantically meaningless vectors.

### Decision 4: Agent Execution Interface

**Choice: Agents receive `ExecutionContext`, not bare `(payload, state)`.**

```typescript
interface ExecutionContext {
  payload: AgentPayload;
  state: PipelineState;        // mutable
  llmClient: EvolutionLLMClient;
  logger: EvolutionLogger;
  costTracker: CostTracker;
  runId: string;               // for checkpoint attribution
}

abstract class AgentBase {
  abstract readonly name: string;
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;
  abstract estimateCost(payload: AgentPayload): number;
  abstract canExecute(state: PipelineState): boolean;
}
```

Justification: Dependency injection enables testing with mock LLMClient, mock CostTracker, etc. Python uses module-level singletons accessed via import — TypeScript testing is cleaner with explicit injection.

### Decision 5: Shared Type Ownership (prevent circular imports)

**Choice: `src/lib/evolution/types.ts` owns all shared interfaces. Nothing else in `evolution/` defines types imported by siblings.**

Import DAG (enforced by linting):
```
types.ts          ← no imports from evolution/
  ↓
core/state.ts     ← imports types.ts only
core/elo.ts       ← imports types.ts only
core/pool.ts      ← imports types.ts, state.ts
core/costTracker.ts ← imports types.ts
core/validation.ts  ← imports types.ts, state.ts
core/llmClient.ts   ← imports types.ts (NOT state.ts)
  ↓
core/supervisor.ts  ← imports types.ts, state.ts, validation.ts
core/pipeline.ts    ← imports everything in core/
  ↓
agents/base.ts      ← imports types.ts only
agents/*.ts         ← imports types.ts, base.ts, core/* as needed
```

`types.ts` defines: `TextVariation`, `AgentPayload`, `AgentResult`, `ExecutionContext`, `PipelinePhase`, `EvolutionConfig`, `EvolutionLLMClient`, `EvolutionLogger`, `CostTracker` (interfaces only — no implementations).

### Decision 6: Budget Enforcement Pattern

**Choice: Atomic budget reservation with 30% safety margin, checked BEFORE every LLM call.**

The problem: `callOpenAIModel` has no budget parameter. Cost tracking is post-hoc (written to `llmCallTracking` after completion). Budget enforcement must be external.

```typescript
// In costTracker.ts
class CostTrackerImpl implements CostTracker {
  private spentByAgent: Map<string, number> = new Map();
  private totalSpent = 0;

  async reserveBudget(agentName: string, estimatedCost: number): Promise<void> {
    const withMargin = estimatedCost * 1.3; // 30% safety margin
    const agentCap = this.config.budgetCaps[agentName] * this.budgetCapUsd;
    const agentSpent = this.spentByAgent.get(agentName) ?? 0;

    if (agentSpent + withMargin > agentCap) {
      throw new BudgetExceededError(agentName, agentSpent, agentCap);
    }
    if (this.totalSpent + withMargin > this.budgetCapUsd) {
      throw new BudgetExceededError('total', this.totalSpent, this.budgetCapUsd);
    }
  }

  recordSpend(agentName: string, actualCost: number): void {
    this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
    this.totalSpent += actualCost;
  }
}
```

**Integration with LLMClient** — budget check wraps every call:
```typescript
async complete(prompt, agentName, options) {
  const estimate = estimateTokenCost(prompt, options?.model);
  await this.costTracker.reserveBudget(agentName, estimate);
  const result = await callOpenAIModel(/* ... */);
  // Actual cost comes from llmCallTracking (written by callOpenAIModel)
  this.costTracker.recordSpend(agentName, getActualCost(result));
  return result;
}
```

`BudgetExceededError` is caught by the pipeline, which pauses the run gracefully (status → `paused`, checkpoint saved).

### Decision 7: Error Handling Strategy

**Choice: Errors propagate from agents → pipeline → runner. No fire-and-forget in evolution code.**

The eval service (Phase D) can use fire-and-forget because eval failure only affects a preview score. Evolution failure wastes $5-10 in LLM costs and corrupts state. Different error handling required.

**Agent level** — errors bubble up (no try/catch):
```typescript
class GenerationAgent extends AgentBase {
  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    // No try/catch — errors propagate to pipeline
    const result = await ctx.llmClient.completeStructured(prompt, schema, ...);
    ctx.state.addToPool(variant);
    return { status: 'success', variantsAdded: 1 };
  }
}
```

**Pipeline level** — catches, checkpoints, and re-throws:
```typescript
for (const agent of phaseAgents) {
  try {
    await agent.execute(ctx);
    await persistCheckpoint(runId, state);
  } catch (error) {
    await persistCheckpoint(runId, state); // Save partial progress
    await markRunFailed(runId, agent.name, error);
    throw error; // Runner handles top-level
  }
}
```

**Runner level** — logs, notifies admin, exits:
```typescript
try {
  await executePipeline(run);
} catch (error) {
  logger.error('Evolution run failed', { runId: run.id, error });
  // Run already marked failed by pipeline
  process.exit(1);
}
```

**Zod parse failure handling** — separate from network retries:
```typescript
async function parseStructuredOutput<T>(
  raw: string, schema: z.ZodType<T>, maxRetries = 2
): Promise<T> {
  // Handle empty response (model refusal)
  if (!raw || raw.trim() === '') {
    throw new LLMRefusalError('Model returned empty response');
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch (parseError) {
    // Try cleaning common JSON issues (trailing commas, etc.)
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1');
    return schema.parse(JSON.parse(cleaned)); // throws if still invalid
  }
}
```

### Decision 8: Logger Abstraction

**Choice: `EvolutionLogger` interface wrapping existing `logger` with structured context.**

Every Python agent file uses `structlog` with a conditional import fallback. Rather than replicating structlog's API, we create a thin wrapper that adds evolution-specific context.

```typescript
// In types.ts
interface EvolutionLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

// In core/logger.ts — implementation
export function createEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const baseContext = { subsystem: 'evolution', runId, agentName };
  return {
    info: (msg, ctx) => logger.info(msg, { ...baseContext, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...baseContext, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...baseContext, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...baseContext, ...ctx }),
  };
}
```

### Decision 9: Feature Flag Granularity

**Choice: Multiple boolean flags (matching existing system) rather than extending the flag system.**

The existing `feature_flags` table is boolean-only. Rather than adding JSONB config support (scope creep), use multiple boolean flags for granular control.

**Required flags:**

| Flag name | Purpose | Default |
|-----------|---------|---------|
| `evolution_pipeline_enabled` | Master kill switch | `false` |
| `evolution_agent_tournament_enabled` | Disable buggy tournament agent without stopping pipeline | `true` |
| `evolution_agent_evolve_pool_enabled` | Disable buggy evolve_pool agent | `true` |
| `evolution_dry_run_only` | Force all runs into dry-run mode (no DB writes) | `false` |
| `content_quality_eval_enabled` | Gate for evals (Phase D) | `false` |

**Budget cap and other numeric config** live in `content_evolution_runs.config` JSONB column (per-run override), NOT in feature flags. This separates operational gates (flags) from tuning parameters (config).

### Decision 10: LLMClient Return Type Handling

**Choice: Wrapper handles the `callOpenAIModel` → JSON parse → Zod validate pipeline, including refusal edge case.**

Verified behavior: `callOpenAIModel` returns `Promise<string>`. With `zodResponseFormat`, this is a JSON string. Model refusals return `''` (due to `|| ''` fallback at llms.ts:223).

```typescript
// In llmClient.ts
export function createEvolutionLLMClient(
  userid: string,
  costTracker: CostTracker,
  evolutionLogger: EvolutionLogger
): EvolutionLLMClient {
  return {
    async complete(prompt, agentName, options) {
      const estimate = estimateTokenCost(prompt, options?.model);
      await costTracker.reserveBudget(agentName, estimate);

      const result = await callOpenAIModel(
        prompt,
        `evolution_${agentName}`,
        userid,
        options?.model ?? default_model,
        false,   // never stream
        null,    // no setText
        null,    // no structured output
        null,
        options?.debug ?? false
      );

      if (!result || result.trim() === '') {
        throw new LLMRefusalError(`Empty response from ${agentName}`);
      }
      return result;
    },

    async completeStructured(prompt, schema, schemaName, agentName, options) {
      const estimate = estimateTokenCost(prompt, options?.model);
      await costTracker.reserveBudget(agentName, estimate);

      const raw = await callOpenAIModel(
        prompt,
        `evolution_${agentName}`,
        userid,
        options?.model ?? default_model,
        false,
        null,
        schema,
        schemaName,
        options?.debug ?? false
      );

      return parseStructuredOutput(raw, schema); // See Decision 7
    }
  };
}
```

Note: `costTracker.recordSpend()` is called by post-hoc reconciliation, not inline here, because `callOpenAIModel` writes actual cost to `llmCallTracking` internally. The `CostTracker` queries that table to reconcile `estimated vs actual` after each agent.

---

## Delivery Structure: Vertical Slices

**Replaces the original 5 sequential phases.** Each slice delivers user-visible value. Evals moved to post-MVP because evolution provides its own quality signal (Elo ranking).

### Slice A: Minimal Evolution (MVP)

**Deliverable**: Admin can trigger evolution on one article, see generated variants with Elo scores, apply the winner.

#### A1. Database tables

All tables created upfront (see Database Schema section below):
- `content_evolution_runs`
- `content_evolution_variants`
- `evolution_checkpoints`
- `content_history` (for rollback)

All with constraints, indexes, and foreign keys.

#### A2. Shared types + config

**New file**: `src/lib/evolution/types.ts` — all shared interfaces (Decision 5)
**New file**: `src/lib/evolution/config.ts` — supervisor and agent parameters:

```typescript
export const EVOLUTION_CONFIG = {
  maxIterations: 15,
  plateau: { window: 3, threshold: 0.02 },
  expansion: {
    minPool: 15,
    minIterations: 3,        // NEW: minimum iterations before phase transition
    diversityThreshold: 0.25,
    maxIterations: 8,
  },
  generation: { strategies: 3 },
  calibration: { opponents: 5 },
  budgetCaps: {
    generation: 0.25,
    calibration: 0.20,
    tournament: 0.30,
    evolution: 0.20,
    reflection: 0.05,
  },
} as const;
```

Overridable per-run via `content_evolution_runs.config` JSONB column.

#### A3. Core modules

| Python source | TypeScript target | LOC | Complexity notes |
|---------------|-------------------|-----|------------------|
| `state.py` | `core/state.ts` | 191 | Mutable class with `addToPool()`, `getTopByElo()`. 3 field mutations in `addToPool`. Multi-phase contracts (6 agent-step phases) validated by validation.ts. Legacy `.variations` property for backward compat. |
| `elo.py` | `core/elo.ts` | 158 | 3 update functions: `updateEloRatings`, `updateEloDraw`, `updateEloWithConfidence`. Adaptive K-factor schedule with thresholds at 5, 15, ∞ matches. Hard floor at 800. Confidence-weighted blending toward 0.5. |
| `pool.py` | `core/pool.ts` | 176 | Stratified sampling, quartile selection. Edge case: pool smaller than requested sample size. |
| `cost_tracker.py` | `core/costTracker.ts` | 139 | Budget caps + per-agent attribution + **atomic pre-call reservation** (Decision 6). |
| `validation.py` | `core/validation.ts` | 121 | State transition guards. Pure predicates. |
| N/A | `core/logger.ts` | ~30 | **NEW**: EvolutionLogger factory (Decision 8). Not in Python. |

**Not in Slice A**: `diversity_tracker.py` → deferred to Slice C (coupled to ProximityAgent).

#### A4. LLMClient + pipeline (minimal)

| File | LOC | Notes |
|------|-----|-------|
| `core/llmClient.ts` | ~80 | Interface + factory with budget enforcement (Decision 10). |
| `core/pipeline.ts` | ~200 | **Simplified**: Sequential agent execution + checkpoint. No phase transitions yet (EXPANSION only). Full pipeline.py is 679 LOC — porting supervisor logic deferred to Slice B. |

#### A5. Foundation agents + generation + calibration

| # | Python source | TypeScript target | LOC | Notes |
|---|---------------|-------------------|-----|-------|
| 1 | `base.py` | `agents/base.ts` | 123 | Abstract class + result types. |
| 2 | `format_rules.py` | `agents/formatRules.ts` | 7 | Constants. |
| 3 | `format_validator.py` | `agents/formatValidator.ts` | 110 | Regex + rules. No LLM. |
| 4 | `generation_agent.py` | `agents/generationAgent.ts` | 336 | Port all 3 strategies (`structural_transform`, `lexical_simplify`, `grounding_enhance`). First LLMClient consumer. |
| 5 | `calibration_ranker.py` | `agents/calibrationRanker.ts` | 431 | Pairwise comparison + basic Elo updates. Adaptive K-factor. Budget pressure. Match history tracking. |

#### A6. Admin UI (manual trigger)

**New page**: `src/app/admin/quality/evolution/page.tsx`

Pattern: mirror `src/app/admin/costs/page.tsx`:
- "Queue for Evolution" button: inserts pending run
- List evolution runs with status, cost, variant count
- Per-run detail: variants ranked by Elo
- "Apply Winner" button: applies winning variant to live article (writes to `content_history` first)

#### A7. Server actions

**New file**: `src/lib/services/evolutionActions.ts`

- `queueEvolutionRunAction` — insert pending run
- `getEvolutionRunsAction` — list runs with status
- `getEvolutionVariantsAction` — variants for a run, sorted by Elo
- `applyWinnerAction` — copy winning variant to `explanations.content`, create `content_history` entry
- `triggerEvolutionRunAction` — claim and execute a pending run inline (for manual admin trigger, NOT batch)

**Milestone**: Admin clicks "Queue" → run executes → 5+ variants generated → Elo-ranked → admin applies winner → article updated.

---

### Slice B: Full Pipeline

**Deliverable**: Weekly batch evolution on multiple articles with phase transitions, tournament ranking, and convergence detection.

#### B1. Supervisor + full pipeline

| Python source | TypeScript target | LOC | Complexity notes |
|---------------|-------------------|-----|------------------|
| `supervisor.py` | `core/supervisor.ts` | 392 | Phase state machine: EXPANSION → COMPETITION. One-way lock (cannot go back). Rotation index for agent ordering. History clearing on phase transition. Convergence detection with configurable window. **Without embeddings**: transition triggers on `poolSize >= minPool AND iteration >= minIterations`. |
| `pipeline.py` | `core/pipeline.ts` | 679 | Full orchestrator replacing Slice A's simplified version. Phase-aware agent execution. Checkpoint after every agent. Resume from checkpoint with phase detection. |

#### B2. Complex ranking agents

| # | Python source | TypeScript target | LOC | Complexity notes |
|---|---------------|-------------------|-----|------------------|
| 6 | `tournament.py` | `agents/tournament.ts` | 630 | **Most complex agent.** Swiss pairing with `_completedPairs` dedup. 3-tier budget pressure config (thresholds at 0.5 and 0.8 of budget). Single-call LLM tiebreaker for top-quartile close matches (not multi-turn debate). Convergence detection via streak tracking (max Elo change < 10 for 5 consecutive checks). Adaptive K-factor per-variant using match count history. |
| 7 | `pairwise_ranker.py` | `agents/pairwiseRanker.ts` | 660 | **Two modes**: non-structured (returns "A"/"B"/"TIE") and structured (5-dimension scoring). Position bias mitigation runs F(A,B) + F(B,A) with multi-branch disagreement resolution (~8 cases including consistent win, consistent tie, split decisions, partial ties). Dimension score merging with majority vote. Confidence calculation based on agreement type. |
| 8 | `evolve_pool.py` | `agents/evolvePool.ts` | 592 | Genetic-style variant evolution. Creative exploration mode. Elo stagnation detection. Retry logic for failed generations. |

Each agent gets its own sub-milestone with unit tests passing before the next starts. Order: pairwiseRanker → tournament → evolvePool (tournament depends on pairwiseRanker).

#### B3. Batch runner + GitHub Actions

**New file**: `scripts/evolution-runner.ts`
- Claims pending runs via atomic `FOR UPDATE SKIP LOCKED` query
- Updates `last_heartbeat` every 60 seconds (revised from 5 minutes)
- Pre-call budget enforcement via CostTracker (Decision 6)
- `--dry-run` flag: processes one article, logs output, writes nothing to DB
- Sequential processing: one article at a time
- Graceful shutdown on SIGTERM (see Concurrency Control section)

**New file**: `.github/workflows/evolution-batch.yml`
- Schedule: weekly (Monday 4am UTC) + manual `workflow_dispatch`
- `actions/setup-node@v4` with Node.js 20
- **Timeout: 7 hours**
- **Concurrency group**: `evolution-batch`, `cancel-in-progress: false`
- Dry-run on PR (validates script compiles and starts)
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` (existing GitHub secrets)

**Milestone**: Weekly cron triggers → runner claims N pending articles → full pipeline with tournament → variants ranked → admin reviews and applies winners.

---

### Slice C: Production Hardening

**Deliverable**: Production-ready pipeline with reflection, diversity tracking, observability, and robust rollback.

#### C1. Remaining agents

| # | Python source | TypeScript target | LOC | Notes |
|---|---------------|-------------------|-----|-------|
| 9 | `reflection_agent.py` | `agents/reflectionAgent.ts` | 377 | Dimensional critique generation. |
| 10 | `meta_review_agent.py` | `agents/metaReviewAgent.ts` | 289 | Feedback pattern synthesis. **No LLM calls** — pure analysis (cost_usd=0.0). |
| 11 | `proximity_agent.py` | `agents/proximityAgent.ts` | 227 | Full implementation with OpenAI embeddings (replacing MVP stub). |
| 12 | `diversity_tracker.py` | `core/diversityTracker.ts` | 165 | Lineage counting, diversity metrics. |

#### C2. Enhanced admin UI

- Evolution run history with filtering (status, date range, cost)
- Progress indicator: real-time current_iteration, phase, latest_checkpoint_ts
- Cost burn rate chart per run
- "Rollback" button on articles that had winners applied (reads from `content_history`)
- Agent-level cost breakdown per run

#### C3. Observability

- OpenTelemetry metrics: `evolution_run_duration_seconds`, `evolution_cost_usd`, `evolution_variants_generated`, `evolution_agent_failures_total{agent, error_type}`
- Trace context propagation through agent execution chain (run_id as trace attribute)
- Dashboard: current runs in progress, cost burn rate, error rate trends

#### C4. Watchdog hardening

See expanded Concurrency Control section below.

**Milestone**: Full production pipeline with all agents, diversity tracking, monitoring, and safe rollback.

---

### Post-MVP: Phase D — Quality Evals

Evals are NOT required for evolution (Elo ranking provides quality signal). Evals add independent quality measurement for articles.

#### D1. Database — eval tables

**`content_quality_scores`** — per-article per-dimension scores
- `explanation_id`, `dimension`, `score` (0-1), `rationale`, `model`, `eval_run_id`, `estimated_cost_usd`, `created_at`

**`content_eval_runs`** — batch run tracking
- `id` (UUID), `status`, `total_articles`, `completed_articles`, `total_cost_usd`, `dimensions[]`, `started_at`, `completed_at`, `triggered_by`

#### D2. Zod schemas + evaluation criteria

Add to `src/lib/schemas/schemas.ts`:
- `contentQualityDimensions` enum: clarity, structure, engagement, accuracy, completeness, readability, depth, examples
- `contentQualityScoreSchema`: { dimension, score (0-1), rationale }
- `contentQualityEvalResponseSchema`: { scores: array }

**New file**: `src/lib/services/contentQualityCriteria.ts`
- Port rubrics from `criteria.py` (379 LOC)
- Export as `DIMENSION_CRITERIA: Record<ContentQualityDimension, string>`

#### D3. Eval service

**New file**: `src/lib/services/contentQualityEval.ts`

Pattern: mirror `explanationSummarizer.ts` (fire-and-forget is OK here — eval failure only loses a score):
- `evaluateContentQuality(explanationId, title, content, userid, dimensions)`
- `runContentQualityBatch(filters, dimensions)`

#### D4. Position-bias-free comparison

**New file**: `src/lib/services/contentQualityCompare.ts`

Port from `compare.py` (381 LOC). **Two separate verdict types** (missed in v1):
- `IndependentVerdict`: scores article in isolation (no comparison)
- `ComparisonVerdict`: runs F(A,B) + F(B,A), resolves 3 distinct outcomes + catch-all:
  - Same winner both orderings → **confident win** (A or B)
  - Both tie → **consistent tie**
  - All other disagreements → **inconclusive** (position bias detected)

#### D5. Admin quality page + scheduling

**New page**: `src/app/admin/quality/page.tsx`
- Table of articles with quality scores per dimension
- Aggregate charts (average scores, distribution)
- "Run Eval" button for manual trigger
- Eval run history with status/cost/count

**API route**: `src/app/api/cron/content-quality-eval/route.ts`
- Runs nightly, evaluates articles without recent scores
- Feature flag: `content_quality_eval_enabled`

---

### Post-MVP: Phase E — Feedback Loop

- After evolution completes, auto-trigger eval on winning variant
- Admin dashboard shows side-by-side: original vs improved quality scores
- Articles scoring below threshold auto-queued for evolution (feature-flagged)
- **Future**: Port iterative improvement loop from `evals/archive/iterative_improve.py` (400+ LOC)

---

## Database Schema (comprehensive)

### `content_evolution_runs`

```sql
CREATE TABLE content_evolution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'paused')),
  phase TEXT NOT NULL DEFAULT 'EXPANSION'
    CHECK (phase IN ('EXPANSION', 'COMPETITION')),
  total_variants INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  budget_cap_usd NUMERIC(10, 4) NOT NULL DEFAULT 5.00,
  config JSONB NOT NULL DEFAULT '{}',
  current_iteration INT NOT NULL DEFAULT 0,
  variants_generated INT NOT NULL DEFAULT 0,
  error_message TEXT,
  runner_id TEXT,
  runner_agents_completed INT NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for batch runner claim query
CREATE INDEX idx_evolution_runs_pending
  ON content_evolution_runs (created_at ASC)
  WHERE status = 'pending';

-- Index for watchdog stale heartbeat check
CREATE INDEX idx_evolution_runs_heartbeat
  ON content_evolution_runs (last_heartbeat)
  WHERE status IN ('claimed', 'running');

-- Index for admin UI queries
CREATE INDEX idx_evolution_runs_explanation
  ON content_evolution_runs (explanation_id, created_at DESC);
```

### `content_evolution_variants`

```sql
CREATE TABLE content_evolution_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  variant_content TEXT NOT NULL,
  elo_score NUMERIC(8, 2) NOT NULL DEFAULT 1200
    CHECK (elo_score >= 0 AND elo_score <= 3000),
  generation INT NOT NULL DEFAULT 0
    CHECK (generation >= 0),
  parent_variant_id UUID REFERENCES content_evolution_variants(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  quality_scores JSONB NOT NULL DEFAULT '{}',
  match_count INT NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Critical for getTopByElo() queries
CREATE INDEX idx_variants_run_elo
  ON content_evolution_variants (run_id, elo_score DESC);

-- For lineage tracking queries
CREATE INDEX idx_variants_parent
  ON content_evolution_variants (parent_variant_id)
  WHERE parent_variant_id IS NOT NULL;
```

### `evolution_checkpoints`

```sql
CREATE TABLE evolution_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  phase TEXT NOT NULL,
  last_agent TEXT NOT NULL,
  state_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- For resume: get latest checkpoint per run
CREATE INDEX idx_checkpoints_run_latest
  ON evolution_checkpoints (run_id, created_at DESC);

-- Prevent duplicate checkpoints per iteration+agent
CREATE UNIQUE INDEX idx_checkpoints_unique_agent
  ON evolution_checkpoints (run_id, iteration, last_agent);
```

### `content_history` (for rollback)

```sql
CREATE TABLE content_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('evolution_pipeline', 'manual_edit', 'import')),
  evolution_run_id UUID REFERENCES content_evolution_runs(id) ON DELETE SET NULL,
  applied_by UUID NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_history_explanation
  ON content_history (explanation_id, applied_at DESC);
```

---

## Concurrency Control (expanded)

### Atomic run claiming

```sql
-- Atomic claim: only one runner gets the run
UPDATE content_evolution_runs
SET status = 'claimed', runner_id = $1, last_heartbeat = NOW(), started_at = NOW()
WHERE id = (
  SELECT id FROM content_evolution_runs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### Heartbeat + health tracking

Runner updates every **60 seconds** (revised from 5 min) with progress info:
```typescript
const heartbeatInterval = setInterval(async () => {
  await supabase.from('content_evolution_runs').update({
    last_heartbeat: new Date().toISOString(),
    runner_agents_completed: state.completedAgents,
    current_iteration: state.currentIteration,
    phase: state.phase,
  }).eq('id', runId).eq('runner_id', runnerId);
}, 60_000);
```

### Graceful shutdown

```typescript
process.on('SIGTERM', async () => {
  clearInterval(heartbeatInterval);
  await persistCheckpoint(runId, state);
  await supabase.from('content_evolution_runs').update({
    status: 'paused',
  }).eq('id', runId);
  logger.info('Runner received SIGTERM, paused gracefully', { runId });
  process.exit(0);
});
```

### Watchdog (stale heartbeat detection)

**Runs as**: GitHub Actions scheduled workflow (every 15 minutes) OR Vercel cron.

```sql
-- Mark stale runs as failed (heartbeat > 10 minutes old)
UPDATE content_evolution_runs
SET status = 'failed',
    error_message = 'Stale heartbeat — runner presumed crashed',
    runner_id = NULL
WHERE status IN ('claimed', 'running')
  AND last_heartbeat < NOW() - INTERVAL '10 minutes';
```

**API route**: `src/app/api/cron/evolution-watchdog/route.ts`

### Split-brain prevention

Before every state write, the runner verifies it still owns the run:
```typescript
async function verifyOwnership(runId: string, runnerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('content_evolution_runs')
    .select('runner_id, status')
    .eq('id', runId)
    .single();
  return data?.runner_id === runnerId && data?.status !== 'failed';
}
```

If ownership lost (watchdog marked it failed), runner stops immediately.

---

## Rollback Strategy (expanded)

**Do not retire the Python repo until the TypeScript port is production-proven.**

### Operational rollback

1. **Feature flags**: `evolution_pipeline_enabled` — master kill switch. `evolution_dry_run_only` — force dry-run mode.
2. **Per-agent flags**: `evolution_agent_tournament_enabled`, `evolution_agent_evolve_pool_enabled` — disable specific agents without killing pipeline.
3. **Budget cap**: Set `budget_cap_usd = 0.01` for a run to effectively disable it.

### Content rollback

**"Apply Winner" creates a history entry before modifying the article:**
```typescript
async function applyWinner(explanationId: number, winnerContent: string, runId: string, adminUserId: string) {
  const { data: current } = await supabase
    .from('explanations').select('content').eq('id', explanationId).single();

  // Save history FIRST
  await supabase.from('content_history').insert({
    explanation_id: explanationId,
    previous_content: current.content,
    new_content: winnerContent,
    source: 'evolution_pipeline',
    evolution_run_id: runId,
    applied_by: adminUserId,
  });

  // Then update article
  await supabase.from('explanations').update({ content: winnerContent }).eq('id', explanationId);
}
```

**Admin UI "Rollback" button**: Reads latest `content_history` entry, restores `previous_content`.

### Validation period

1. Run TypeScript batch on 10 articles, compare output quality to Python output using golden dataset (see Verification).
2. Keep Python repo available for 3 months.
3. Retire only after 3 successful weekly batch runs with no quality regressions.

---

## Verification Strategy (comprehensive rewrite)

### Pre-implementation: Golden Dataset

**Before porting any agent**, run the Python pipeline on 10 diverse test articles and capture outputs at every agent boundary:

```
golden_data/
  article_001/
    input.json                    # Original article content
    generation_agent_output.json  # Variants produced
    calibration_ranker_output.json # Elo deltas after ranking
    tournament_brackets.json      # Swiss pairings and results
    final_variants.json           # Ranked variants with Elo
  article_002/
    ...
```

**Cost**: ~$20 one-time (10 articles × ~200 LLM calls × $0.01/call).

**Purpose**: TypeScript regression tests compare output structure and Elo deltas against golden data. We do NOT expect exact string matches (LLM outputs are non-deterministic), but we verify:
- Same number of variants generated per strategy
- Elo deltas within ±5 points for fixed matchups (using deterministic mock LLM for Elo tests)
- Swiss pairing produces valid brackets matching golden bracket structure
- Phase transitions occur at same thresholds

### Test environment strategy

| Tier | LLM | Database | Runs in CI? | Cost |
|------|-----|----------|-------------|------|
| **Unit** | Mocked `EvolutionLLMClient` | None (pure logic) | Yes, every PR | $0 |
| **Integration** | Mocked `callOpenAIModel` | Real Supabase Dev DB (test namespace: `run_id` prefix `test-*`) | Yes, every PR | $0 |
| **Staging** | Real OpenAI | Real Supabase Dev DB | Weekly, manual | ~$10/week |
| **Golden regression** | Mocked (deterministic fixtures) | None | Yes, every PR | $0 |

**Test isolation**: Integration tests use `test-${testId}` prefix for `run_id`. Cleanup in `afterAll`:
```typescript
afterAll(async () => {
  await supabase.from('evolution_checkpoints').delete().like('run_id', 'test-%');
  await supabase.from('content_evolution_variants').delete().like('run_id', 'test-%');
  await supabase.from('content_evolution_runs').delete().like('id', 'test-%');
});
```

### Stub agents for supervisor testing

**Before Slice B agents are ported**, test supervisor phase transitions with deterministic stubs:
```typescript
class StubGenerationAgent extends AgentBase {
  readonly name = 'stub_generation';
  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    ctx.state.addToPool({ id: `stub-${Date.now()}`, content: 'test', generation: 1 });
    return { status: 'success', variantsAdded: 1 };
  }
  estimateCost() { return 0; }
  canExecute() { return true; }
}
```

### Per-slice verification

#### Slice A Testing

1. **Unit — elo.ts**: All 3 update functions with fixed inputs. Verify adaptive K-factor at thresholds (5, 15 matches). Verify floor enforcement at 800. Verify confidence-weighted blending.
2. **Unit — state.ts**: `addToPool` mutates correct fields. `getTopByElo` returns correct order. Edge: empty pool, single variant.
3. **Unit — costTracker.ts**: Pre-call reservation blocks when remaining < estimate. Per-agent cap enforcement. 30% margin applied.
4. **Unit — generationAgent.ts**: Mock LLMClient, verify prompt includes all 3 strategies. Verify Zod parsing of response. Verify state mutation (new variants added).
5. **Unit — calibrationRanker.ts**: Mock LLMClient, verify pairwise comparison prompt. Verify Elo delta calculation with golden data fixtures.
6. **Integration — pipeline (minimal)**: Mock LLMClient, real Supabase. Create run → execute generation + calibration → verify checkpoints written → verify variants in DB.
7. **Integration — admin actions**: `queueEvolutionRunAction` creates pending run. `applyWinnerAction` writes to `content_history` then updates `explanations`.
8. **Admin UI E2E**: Seed fake run data → Playwright navigates to `/admin/quality/evolution` → verifies display.

#### Slice B Testing

1. **Unit — supervisor.ts**: Phase transition from EXPANSION → COMPETITION at threshold. One-way lock (cannot go back). Convergence detection window. **Test with stub agents.**
2. **Unit — tournament.ts**: Swiss pairing with no duplicate pairs. Budget pressure tier switching (thresholds at 0.5/0.8). Single-call tiebreaker for top quartile. Convergence streak detection. **Golden regression against Python output.**
3. **Unit — pairwiseRanker.ts**: Both modes (structured + non-structured). Position bias F(A,B)/F(B,A) with all ~8 disagreement branches. Dimension score merging. Confidence calculation. **Golden regression.**
4. **Unit — evolvePool.ts**: Genetic variant evolution. Stagnation detection. Retry on failed generation.
5. **Integration — full pipeline**: Mock LLMClient, real Supabase. Full EXPANSION → COMPETITION cycle with stub + real agents. Verify phase transition occurs. Verify winner selected.
6. **Batch runner dry-run**: `npx tsx scripts/evolution-runner.ts --dry-run` — verifies compilation + startup.
7. **Concurrency test**: Two concurrent runners claim different runs via `FOR UPDATE SKIP LOCKED`. Verify each gets exactly one run.

#### Slice C Testing

1. **Unit — reflectionAgent, metaReviewAgent**: Mock LLMClient, verify prompt/response patterns.
2. **Unit — proximityAgent**: With real OpenAI embeddings (tagged `@expensive`). Verify diversity scores for known-different and known-similar texts.
3. **Integration — full pipeline with all agents**: Real pipeline, mock LLMClient. Verify cost attribution: `sum(per_agent_costs) ≈ total_run_cost`.
4. **Admin UI E2E**: Seed evolution data → test "Rollback" button → verify content restored from `content_history`.
5. **Budget overflow test**: `budget_cap_usd = 0.01`, run pipeline → verify `BudgetExceededError` → run status `paused` with partial checkpoint.
6. **Heartbeat timeout test**: Start run, kill runner, wait 10+ minutes, verify watchdog marks as `failed`.
7. **Split-brain test**: Start run, externally mark as `failed`, verify runner detects and stops.

### Error path testing

| Scenario | Expected behavior | Test tier |
|----------|-------------------|-----------|
| OpenAI 429 rate limit | SDK retries 3x, then throws. Agent propagates error. Pipeline checkpoints + marks failed. | Integration |
| Malformed LLM JSON | `parseStructuredOutput` attempts cleanup. If still invalid, throws. Pipeline checkpoints partial state. | Unit |
| DB write failure during checkpoint | Retries 3x with backoff. If still fails, throws. Run stays `running` with last good checkpoint. | Integration |
| Budget exceeded mid-agent | `BudgetExceededError` thrown by costTracker. Pipeline catches, sets status `paused`, checkpoints. | Unit + Integration |
| Runner SIGTERM mid-execution | Graceful shutdown: checkpoint + set status `paused`. | Integration |
| Empty pool after filtering | Supervisor detects, extends EXPANSION phase (doesn't crash). | Unit |

---

## File Inventory

### New files

| Slice | Path | Type |
|-------|------|------|
| A1 | `supabase/migrations/..._content_evolution_runs.sql` | Migration |
| A1 | `supabase/migrations/..._content_evolution_variants.sql` | Migration |
| A1 | `supabase/migrations/..._evolution_checkpoints.sql` | Migration |
| A1 | `supabase/migrations/..._content_history.sql` | Migration |
| A2 | `src/lib/evolution/types.ts` | Shared types |
| A2 | `src/lib/evolution/config.ts` | Configuration |
| A3 | `src/lib/evolution/core/state.ts` | Types + mutable class |
| A3 | `src/lib/evolution/core/elo.ts` | Algorithm |
| A3 | `src/lib/evolution/core/pool.ts` | Algorithm |
| A3 | `src/lib/evolution/core/costTracker.ts` | Budget enforcement |
| A3 | `src/lib/evolution/core/validation.ts` | Guards |
| A3 | `src/lib/evolution/core/logger.ts` | Logger factory |
| A4 | `src/lib/evolution/core/llmClient.ts` | Interface + factory |
| A4 | `src/lib/evolution/core/pipeline.ts` | Orchestrator (minimal) |
| A5 | `src/lib/evolution/agents/base.ts` | Abstract class |
| A5 | `src/lib/evolution/agents/formatRules.ts` | Constants |
| A5 | `src/lib/evolution/agents/formatValidator.ts` | Validator |
| A5 | `src/lib/evolution/agents/generationAgent.ts` | Agent |
| A5 | `src/lib/evolution/agents/calibrationRanker.ts` | Agent |
| A6 | `src/app/admin/quality/evolution/page.tsx` | Admin page |
| A7 | `src/lib/services/evolutionActions.ts` | Server actions |
| A7 | `src/lib/services/evolutionActions.test.ts` | Test |
| B1 | `src/lib/evolution/core/supervisor.ts` | State machine |
| B2 | `src/lib/evolution/agents/pairwiseRanker.ts` | Agent |
| B2 | `src/lib/evolution/agents/tournament.ts` | Agent |
| B2 | `src/lib/evolution/agents/evolvePool.ts` | Agent |
| B3 | `scripts/evolution-runner.ts` | Batch script |
| B3 | `.github/workflows/evolution-batch.yml` | CI workflow |
| C1 | `src/lib/evolution/agents/reflectionAgent.ts` | Agent |
| C1 | `src/lib/evolution/agents/metaReviewAgent.ts` | Agent |
| C1 | `src/lib/evolution/agents/proximityAgent.ts` | Agent |
| C1 | `src/lib/evolution/core/diversityTracker.ts` | Algorithm |
| C4 | `src/app/api/cron/evolution-watchdog/route.ts` | Cron route |
| D1 | `supabase/migrations/..._content_quality_scores.sql` | Migration |
| D1 | `supabase/migrations/..._content_eval_runs.sql` | Migration |
| D2 | *(edit)* `src/lib/schemas/schemas.ts` | Edit existing |
| D2 | `src/lib/services/contentQualityCriteria.ts` | Evaluation rubrics |
| D3 | `src/lib/services/contentQualityEval.ts` | Service |
| D4 | `src/lib/services/contentQualityCompare.ts` | Comparison service |
| D5 | `src/app/admin/quality/page.tsx` | Admin page |
| D5 | `src/app/api/cron/content-quality-eval/route.ts` | Cron route |

### Directory structure after implementation

```
src/lib/
├── services/
│   ├── ...existing services...
│   ├── evolutionActions.ts            # Slice A — server actions
│   ├── contentQualityEval.ts          # Phase D — eval service
│   ├── contentQualityCriteria.ts      # Phase D — dimension rubrics
│   ├── contentQualityCompare.ts       # Phase D — comparison
│   └── contentQualityActions.ts       # Phase D — eval server actions
└── evolution/                         # Slices A-C — standalone subsystem
    ├── types.ts                       # Shared interfaces (Decision 5)
    ├── config.ts                      # Configuration
    ├── core/
    │   ├── state.ts
    │   ├── elo.ts
    │   ├── pool.ts
    │   ├── diversityTracker.ts        # Slice C
    │   ├── costTracker.ts
    │   ├── validation.ts
    │   ├── logger.ts                  # EvolutionLogger factory (Decision 8)
    │   ├── supervisor.ts              # Slice B
    │   ├── pipeline.ts
    │   └── llmClient.ts
    ├── agents/
    │   ├── base.ts
    │   ├── formatRules.ts
    │   ├── formatValidator.ts
    │   ├── generationAgent.ts         # Slice A
    │   ├── calibrationRanker.ts       # Slice A
    │   ├── pairwiseRanker.ts          # Slice B
    │   ├── tournament.ts              # Slice B
    │   ├── evolvePool.ts              # Slice B
    │   ├── reflectionAgent.ts         # Slice C
    │   ├── metaReviewAgent.ts         # Slice C
    │   └── proximityAgent.ts          # Slice C
    └── index.ts                       # Public API
```

---

## Critical Files (existing, used as templates)

| File | Role |
|------|------|
| `src/lib/services/explanationSummarizer.ts` | **Template** for eval service (fire-and-forget LLM call + Zod parsing + DB write). Non-streaming: `callOpenAIModel(prompt, source, userid, model, false, null, schema, schemaName)`. |
| `src/lib/services/llms.ts` | `callOpenAIModel` — 9 params, mandatory `streaming`/`setText` enforcement. Returns raw string (line 223). Evolution wrapper must always pass `false`/`null`. |
| `src/lib/services/costAnalytics.ts` | **Template** for admin server actions pattern |
| `src/lib/schemas/schemas.ts` | Where new Zod schemas go |
| `src/app/admin/costs/page.tsx` | **Template** for admin UI page |
| `src/lib/services/featureFlags.ts` | Feature flag system — boolean only. See Decision 9. |

## Python Source Files (ported from, for reference)

### Evals module

| Python source | Used in phase | Notes |
|---------------|---------------|-------|
| `/Users/abel/Documents/writing_pipeline/src/evals/lib/compare.py` | D4 | Position-bias-free comparison (381 LOC). Dual verdict types: IndependentVerdict, ComparisonVerdict. 3-outcome disagreement resolution (confident win, consistent tie, inconclusive). |
| `/Users/abel/Documents/writing_pipeline/src/evals/metrics/criteria.py` | D2 | Dimension rubrics with anchor examples (379 LOC) |
| `/Users/abel/Documents/writing_pipeline/src/evals/schemas/writing_quality.py` | D2 | Pydantic → Zod (47 LOC) |
| `/Users/abel/Documents/writing_pipeline/src/evals/lib/config.py` | — | Not ported. Replaced by existing `callOpenAIModel` + env vars. |
| `/Users/abel/Documents/writing_pipeline/src/evals/lib/llm_client.py` | — | Not ported (246 LOC). Contains `CostTracker` class (imported by `cost_tracker.py`), `LLMClient` with Vercel AI Gateway + DeepSeek routing, model costs, retry via tenacity. Replaced by `callOpenAIModel` wrapper. |
| `/Users/abel/Documents/writing_pipeline/src/evals/metrics/factory.py` | — | Not ported. Metric creation handled directly in eval service. |
| `/Users/abel/Documents/writing_pipeline/src/evals/archive/iterative_improve.py` | E | Deferred to Phase E (400+ LOC). |

### Evolution module

| Python source | Used in slice | Complexity notes |
|---------------|---------------|------------------|
| `state.py` | A3 | 191 LOC. Multi-phase mutation contracts, legacy `.variations` compat. |
| `elo.py` | A3 | 158 LOC. 3 update variants, adaptive K schedule (5/15/∞), floor 800, confidence blending. |
| `pool.py` | A3 | 176 LOC. Stratified sampling. Edge case: pool < sample size. |
| `cost_tracker.py` | A3 | 139 LOC. Budget caps + AGENT_CAPS. Extended with atomic reservation (Decision 6). |
| `validation.py` | A3 | 121 LOC. Pure predicates. |
| `pipeline.py` | A4/B1 | 679 LOC. Minimal in Slice A (sequential execution + checkpoint). Full in Slice B (phase-aware). |
| `supervisor.py` | B1 | 392 LOC. One-way phase lock, rotation index, history clearing, convergence detection. Note: Python has no `minIterations` — that is NEW for TypeScript (Decision 3). |
| `base.py` | A5 | 123 LOC. Abstract class. |
| `format_rules.py` | A5 | 7 LOC. Constants. |
| `format_validator.py` | A5 | 110 LOC. Regex + rules. |
| `generation_agent.py` | A5 | 336 LOC. 3 strategies. |
| `calibration_ranker.py` | A5 | 431 LOC. Adaptive K, match history, budget pressure. |
| `pairwise_ranker.py` | B2 | 660 LOC. **Complex**: 2 modes, F(A,B)+F(B,A), ~8-branch resolution, dimension merging, confidence calc. |
| `tournament.py` | B2 | 630 LOC. **Most complex**: Swiss pairing, debates, convergence, adaptive K per-variant. |
| `evolve_pool.py` | B2 | 592 LOC. Genetic evolution, stagnation detection, retry logic. |
| `reflection_agent.py` | C1 | 377 LOC. Dimensional critique. |
| `meta_review_agent.py` | C1 | 289 LOC. Feedback synthesis. **No LLM calls** (pure analysis, cost_usd=0.0). |
| `proximity_agent.py` | C1 | 227 LOC. Diversity via embeddings. Stub in A/B. |
| `diversity_tracker.py` | C1 | 165 LOC. Lineage counting. |

### Python → TypeScript gotchas (not in v1)

| Python idiom | Files affected | TypeScript approach |
|-------------|----------------|---------------------|
| `structlog` conditional import with fallback | All agent files | `EvolutionLogger` interface (Decision 8) |
| `@property` lazy instantiation for LLM client | pairwise_ranker.py:300 | Constructor injection via `ExecutionContext` |
| Protocol typing with `TYPE_CHECKING` guards | pairwise_ranker.py:38, others | TypeScript `interface` — simpler, no guards needed |
| Tuple unpacking in multi-returns | pairwise_ranker.py `_compare_pair` | Return named object `{ winner, scores, confidence }` |
| `field(default_factory=list)` | state.py:129 | Class constructor: `this.variations = []` |
| `Optional[T]` vs `| None` mixing | Throughout | Consistent `T | null` in strict mode |
| `dataclass` with mutable defaults | state.py, various | TypeScript class with explicit constructor |

### Not ported (explicitly out of scope)

| Python source | Reason |
|---------------|--------|
| `evals/scripts/collect_ground_truth.py` | Developer tooling, not user-facing |
| `evals/scripts/validate_setup.py` | Python environment validation |
| `evals/lib/config.py` | Replaced by existing TypeScript config infrastructure |
| `evals/lib/llm_client.py` | Replaced by `callOpenAIModel` wrapper |
| `evals/lib/iteration.py` | Data structures for iterative improvement — deferred to Phase E |
| `evolution/scripts/benchmark.py` | Developer benchmarking script (566 LOC) — not user-facing |
| `evolution/scripts/evolve_simple.py` | Standalone evolution script (411 LOC) — not user-facing |
| `evolution/scripts/regression_check.py` | Regression testing script (499 LOC) — not user-facing |

### Data migration

**No data migration needed.** The Python pipeline stores results as local JSON files (`runs/` directory). These are development artifacts, not production data. The TypeScript system starts fresh with Supabase tables.

---

## Review Changelog (v1 → v2)

Issues identified by 4-agent critical review (Architecture, Security, Testing, Feasibility):

| Issue | Severity | Resolution |
|-------|----------|------------|
| No checkpoint/restore for crash recovery | Critical | Added `evolution_checkpoints` table + persist pattern (Decision 1) |
| No atomic budget enforcement | Critical | Added pre-call reservation with 30% margin (Decision 6) |
| Missing DB indexes and foreign keys | Critical | Full SQL with `REFERENCES`, `CHECK`, `CREATE INDEX` in schema section |
| Phase 3c complexity underestimated | Critical | Revised portability from "Mechanical" → "Complex". Added per-agent sub-milestones. |
| No behavioral equivalence testing | Critical | Added golden dataset strategy + regression tests |
| No vertical slice delivery | High | Restructured into Slices A/B/C with incremental user value. Evals → post-MVP. |
| Fire-and-forget inappropriate for evolution | High | Added error propagation strategy (Decision 7) |
| Feature flags too coarse | High | Added per-agent flags (Decision 9) |
| LLMClient missing budget integration | High | LLMClient factory receives CostTracker (Decision 10) |
| Missing shared types file | High | Added `types.ts` with import DAG (Decision 5) |
| Zombie process / stale heartbeat gaps | High | Expanded concurrency: 60s heartbeat, watchdog cron, SIGTERM handler, split-brain check |
| Rollback plan inadequate | High | Added `content_history` table + "Rollback" admin button |
| ProximityAgent decision unclear | Medium | Explicit stub for MVP, full impl in Slice C (Decision 3) |
| Logger abstraction missing | Medium | Added `EvolutionLogger` interface + factory (Decision 8) |
| Integration test DB strategy undefined | Medium | Defined 4-tier test strategy with test namespacing |
| Python→TS idiom gotchas undocumented | Medium | Added gotchas table (structlog, properties, tuples, etc.) |
| compare.py dual verdict types missed | Medium | Documented IndependentVerdict vs ComparisonVerdict in Phase D4 |
| `callOpenAIModel` return type unclear | Low | Documented: returns raw string, `''` on refusal. Wrapper handles. (Decision 10) |
