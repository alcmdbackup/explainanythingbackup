# Algo Improvements Existing Migrated Pipeline Plan

## Background
The evolution pipeline (`src/lib/evolution/`) iteratively improves article content through LLM-driven genetic evolution with Elo-based ranking. It operates in two phases (EXPANSION → COMPETITION) managed by a PoolSupervisor, with 8 agents, budget enforcement, and crash recovery. Research identified three high-impact gaps: (1) the original text is never ranked alongside variants so there's no baseline for measuring improvement, (2) diversity tracking uses a character-based fallback instead of real embeddings, and (3) run effectiveness data (Elo progression, diversity history, match history, meta-feedback) is lost after execution.

## Problem
After a pipeline run, admins cannot determine whether evolution actually improved the article because the original text is never entered into the Elo tournament. Diversity tracking uses first-16-characters as "embeddings" (`proximityAgent.ts:132-135`), making the diversity score meaningless — two texts with the same prefix score as identical regardless of semantic content. Finally, valuable run data (Elo history, diversity trends, match results, meta-feedback) exists only in memory during execution and is discarded at completion, preventing any post-hoc analysis of pipeline effectiveness.

## Options Considered

### Original-as-Baseline
- **Option A: Add to pool at state creation** — Insert original as `strategy: 'baseline'` variant in `PipelineStateImpl` constructor. Simple but couples baseline logic to state class.
- **Option B: Add in pipeline before first agent** — Insert in `executeFullPipeline` (before iteration loop) and `executeMinimalPipeline` (before agent loop). Keeps state class clean, explicit in orchestration. Note: `executeMinimalPipeline` has no `startNewIteration()` — the caller (`evolutionActions.ts:347`) handles that. **← Chosen**
- **Option C: Add in each caller** — Insert in `evolution-runner.ts` and `evolutionActions.ts`. Duplicates logic across callers.

### Real Embeddings
- **Option A: OpenAI text-embedding-3-small API** — Already have `openai` package. $0.02/1M tokens. Adds network dependency per run.
- **Option B: Transformers.js (`@huggingface/transformers`) local** — Runs `all-MiniLM-L6-v2` (384-dim) locally via ONNX/WASM. Zero per-embed API cost. First call downloads model (~22MB) and loads ONNX runtime (~2s), then cached as singleton for the process lifetime. **← Chosen**
- **Option C: LangChain HuggingFace embeddings** — Already have `@langchain/community`. Wraps same models but adds abstraction layer overhead.

### Run Summary Persistence
- **Option A: Add JSONB column to `evolution_runs`** — Single `run_summary` JSONB column. Simple migration, no new table. **← Chosen**
- **Option B: New `evolution_run_summaries` table** — Normalized schema. More complex, unnecessary for JSONB data.

### Deployment Coupling
Phase 1 (baseline) and Phase 3 (run summary) **must deploy together** — baseline data without persistence wastes the signal. Phase 2 (embeddings) can follow independently.

## Phased Execution Plan

### Phase 1: Original Text as Baseline Variant + Run Summary Persistence

**Goal**: Original text participates in Elo tournament so its final rank measures whether evolution helped. Run summary data is persisted to DB for post-hoc analysis.

#### Files Modified
- `src/lib/evolution/types.ts` — Add `BASELINE_STRATEGY` constant, `EvolutionRunSummary` interface, Zod schema
- `src/lib/evolution/index.ts` — Export `BASELINE_STRATEGY` and `EvolutionRunSummary`
- `src/lib/evolution/core/pipeline.ts` — Add `insertBaselineVariant()`, `buildRunSummary()`, persist summary at completion
- `src/lib/evolution/core/pool.ts` — Filter baseline from `getEvolutionParents()`
- `src/lib/evolution/agents/evolvePool.ts` — Exclude baseline from `getDominantStrategies()` analysis
- `src/lib/services/evolutionActions.ts` — Add `getEvolutionRunSummaryAction`, pass `startMs` to `executeMinimalPipeline`
- `src/lib/evolution/evolution-runner.ts` — Pass `startMs` to `executeFullPipeline`
- `supabase/migrations/XXXXXXXX_add_evolution_run_summary.sql` — New migration

#### Implementation: Baseline Variant

1. Add constant and type in `types.ts`:
```typescript
export const BASELINE_STRATEGY = 'original_baseline' as const;
```

2. In `pipeline.ts`, create helper:
```typescript
import { BASELINE_STRATEGY } from '../types';

function insertBaselineVariant(state: PipelineState, runId: string): void {
  const baselineId = `baseline-${runId}`;
  // Guard against duplicate insertion on resume (poolIds.has covers crash/resume)
  if (state.poolIds.has(baselineId)) return;
  state.addToPool({
    id: baselineId,
    text: state.originalText, // Use state's own originalText — no redundant parameter
    version: 0,
    parentIds: [],
    strategy: BASELINE_STRATEGY,
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  });
  // Note: Elo is implicitly initialized to 1200 by PipelineStateImpl.addToPool (state.ts:43)
}
```

3. Call placement — different for each pipeline path:

   **`executeMinimalPipeline`** (pipeline.ts:81-142): This function has NO `startNewIteration()` call —
   the caller (`evolutionActions.ts:347`) calls `state.startNewIteration()` before invoking the pipeline.
   Insert `insertBaselineVariant(ctx.state, runId)` at the top of `executeMinimalPipeline`, after the
   comparison cache injection and DB status update, **before** the agent loop (between lines 96 and 98):
   ```typescript
   // After line 96 (.eq('id', runId);) and before line 98 (for (const agent of agents))
   insertBaselineVariant(ctx.state, runId);
   ```

   **`executeFullPipeline`** (pipeline.ts:170-334): Insert `insertBaselineVariant(ctx.state, runId)`
   **before the iteration loop** (between lines 207 and 210), NOT inside the loop. This is simpler and
   more correct than guarding inside the loop — the `poolIds.has()` guard already prevents duplicates
   on resume:
   ```typescript
   // After line 207 (let stopReason = 'completed';) and before line 210 (for loop)
   insertBaselineVariant(ctx.state, runId);
   ```
   The idempotency guard handles crash/resume: if the baseline was already added before a crash,
   `poolIds.has(baselineId)` returns true and the function no-ops.

4. In `pool.ts`, filter baseline from evolution parents (**must** be here, not in EvolutionAgent).
   Import `BASELINE_STRATEGY` from `'../types'`. The old `n+1` approach fails if baseline ranks
   outside the top `n+1`. Instead, fetch the full pool sorted by Elo, filter out baseline, then slice:
```typescript
import { BASELINE_STRATEGY } from '../types';

/** Get top N parents by Elo for evolution, excluding baseline variant. */
getEvolutionParents(n: number = 2): TextVariation[] {
  // Fetch full pool sorted by Elo, filter baseline, take top n
  const allByElo = this.state.getTopByElo(this.state.getPoolSize());
  const eligible = allByElo.filter((v) => v.strategy !== BASELINE_STRATEGY);
  return eligible.slice(0, n);
}
```
Note: This handles edge cases like baseline ranking low or pool having fewer than `n` non-baseline variants.
If `eligible.length < n`, fewer parents are returned — callers already handle this gracefully
(see `evolvePool.ts:162` which checks `parents.length === 0`).

5. In `evolvePool.ts`, exclude baseline from `getDominantStrategies()`.
   `getDominantStrategies` is a standalone function (line 91) with signature `(pool: TextVariation[]): string[]`.
   Filter baseline at the top of the function body:
```typescript
import { BASELINE_STRATEGY } from '../types';

export function getDominantStrategies(pool: TextVariation[]): string[] {
  const eligible = pool.filter((v) => v.strategy !== BASELINE_STRATEGY);
  if (eligible.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const v of eligible) {
    counts[v.strategy] = (counts[v.strategy] ?? 0) + 1;
  }
  // ... rest unchanged (use eligible.length instead of pool.length for avg)
```
   Also update the caller in `EvolutionAgent.execute()` (line 234) which calls
   `getDominantStrategies(state.pool)` — this already passes the pool array, so no
   caller change is needed. The `MetaReviewAgent` also calls `getDominantStrategies`
   — verify it passes pool array similarly (it does, via `state.pool`).

6. In `generationAgent.ts` — no changes needed (uses `state.originalText` directly).

7. In `reflectionAgent.ts` — no changes needed. If baseline ranks in top 3, it gets critiqued. This is acceptable — the critique provides useful signal on original quality.

8. Export from `index.ts`:
```typescript
export { BASELINE_STRATEGY } from './types';
export type { EvolutionRunSummary } from './types';
```

#### Implementation: Run Summary Persistence

1. Create migration `supabase/migrations/XXXXXXXX_add_evolution_run_summary.sql`:
```sql
ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS run_summary JSONB DEFAULT NULL;

COMMENT ON COLUMN evolution_runs.run_summary IS
  'Post-run analytics: eloHistory, diversityHistory, matchStats, metaFeedback, baselineRank.
   Sensitive data - ensure RLS policies restrict access appropriately if RLS is enabled.';

-- GIN index for JSONB queries from admin UI
-- NOTE: Do NOT use CONCURRENTLY here — Supabase migrations run inside transactions,
-- and CREATE INDEX CONCURRENTLY cannot run in a transaction. The table is small enough
-- that a regular blocking index creation is acceptable.
CREATE INDEX IF NOT EXISTS idx_evolution_runs_summary_gin
  ON evolution_runs USING GIN (run_summary)
  WHERE run_summary IS NOT NULL;
```

2. Define summary type and Zod validation schema in `types.ts`:
```typescript
import { z } from 'zod';

export interface EvolutionRunSummary {
  version: 1;
  stopReason: string;
  finalPhase: PipelinePhase;
  totalIterations: number;
  durationSeconds: number;
  eloHistory: number[];
  diversityHistory: number[];
  matchStats: {
    totalMatches: number;
    avgConfidence: number;
    decisiveRate: number;
  };
  topVariants: Array<{
    id: string;
    strategy: string;
    elo: number;
    isBaseline: boolean;
  }>;
  baselineRank: number | null;
  baselineElo: number | null;
  strategyEffectiveness: Record<string, {
    count: number;
    avgElo: number;
  }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
}

export const EvolutionRunSummarySchema = z.object({
  version: z.literal(1),
  stopReason: z.string().max(200),
  finalPhase: z.enum(['EXPANSION', 'COMPETITION']),
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    elo: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineElo: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgElo: z.number(),
  })),
  // Tighter bounds: 200 chars × 10 entries × 4 fields = 8KB max (vs 40KB before).
  // LLM-generated feedback rarely exceeds these limits in practice.
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).strict();
```

3. In `pipeline.ts`, build summary at completion. Works for both minimal (no supervisor) and full pipelines:
```typescript
function buildRunSummary(
  ctx: ExecutionContext,
  stopReason: string,
  durationSeconds: number,
  supervisor?: PoolSupervisor,
): EvolutionRunSummary {
  const state = ctx.state;
  const topVariants = state.getTopByElo(5).map((v) => ({
    id: v.id,
    strategy: v.strategy,
    elo: state.eloRatings.get(v.id) ?? 1200,
    isBaseline: v.strategy === BASELINE_STRATEGY,
  }));

  // Find baseline rank (defensive: handles missing baseline)
  const allByElo = state.getTopByElo(state.getPoolSize());
  const baselineIdx = allByElo.findIndex((v) => v.strategy === BASELINE_STRATEGY);
  const baselineVariant = baselineIdx >= 0 ? allByElo[baselineIdx] : undefined;

  if (baselineIdx < 0) {
    ctx.logger.warn('Baseline variant not found in pool', { runId: ctx.runId });
  }

  // Match statistics
  const matches = state.matchHistory;
  const avgConfidence = matches.length > 0
    ? matches.reduce((s, m) => s + m.confidence, 0) / matches.length : 0;
  const decisiveRate = matches.length > 0
    ? matches.filter((m) => m.confidence >= 0.7).length / matches.length : 0;

  // Strategy effectiveness
  const strategyEffectiveness: Record<string, { count: number; avgElo: number }> = {};
  for (const v of state.pool) {
    const elo = state.eloRatings.get(v.id) ?? 1200;
    if (!strategyEffectiveness[v.strategy]) {
      strategyEffectiveness[v.strategy] = { count: 0, avgElo: 0 };
    }
    strategyEffectiveness[v.strategy].count++;
    strategyEffectiveness[v.strategy].avgElo += elo;
  }
  for (const s of Object.values(strategyEffectiveness)) {
    s.avgElo = s.avgElo / s.count;
  }

  return {
    version: 1,
    stopReason,
    finalPhase: supervisor?.currentPhase ?? 'EXPANSION',
    totalIterations: state.iteration,
    durationSeconds,
    eloHistory: supervisor?.getResumeState().eloHistory ?? [],
    diversityHistory: supervisor?.getResumeState().diversityHistory ?? [],
    matchStats: { totalMatches: matches.length, avgConfidence, decisiveRate },
    topVariants,
    baselineRank: baselineIdx >= 0 ? baselineIdx + 1 : null,
    baselineElo: baselineVariant
      ? (state.eloRatings.get(baselineVariant.id) ?? null)
      : null,
    strategyEffectiveness,
    metaFeedback: state.metaFeedback,
  };
}
```

4. Persist with Zod validation in both completion paths. **Use `.safeParse()` — NOT `.parse()`** to prevent
   validation failure from crashing the pipeline completion (which would leave the run in a broken state):
```typescript
// Helper to safely validate and persist summary
function validateRunSummary(
  raw: EvolutionRunSummary,
  logger: EvolutionLogger,
  runId: string,
): EvolutionRunSummary | null {
  const result = EvolutionRunSummarySchema.safeParse(raw);
  if (!result.success) {
    logger.error('Run summary Zod validation failed — saving null', {
      runId,
      errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return result.data;
}

// In executeFullPipeline, at completion (line ~303):
const durationSeconds = (Date.now() - startMs) / 1000;
const rawSummary = buildRunSummary(ctx, stopReason, durationSeconds, supervisor);
const summary = validateRunSummary(rawSummary, logger, runId);
await supabase.from('evolution_runs').update({
  status: 'completed',
  completed_at: new Date().toISOString(),
  total_variants: ctx.state.getPoolSize(),
  total_cost_usd: ctx.costTracker.getTotalSpent(),
  run_summary: summary, // null if validation failed — run still completes
}).eq('id', runId);

// In executeMinimalPipeline, at completion (line ~130):
// Same pattern, but supervisor is undefined → eloHistory/diversityHistory will be []
const durationSeconds = (Date.now() - startMs) / 1000;
const rawSummary = buildRunSummary(ctx, 'completed', durationSeconds, undefined);
const summary = validateRunSummary(rawSummary, logger, runId);
// Add run_summary to existing update at line 131-136
```

5. Pass `startMs` into both pipelines for duration tracking.

   **Signature changes:**

   `executeMinimalPipeline` (pipeline.ts:81) — add optional `options` parameter:
   ```typescript
   export async function executeMinimalPipeline(
     runId: string,
     agents: PipelineAgent[],
     ctx: ExecutionContext,
     logger: EvolutionLogger,
     options?: { startMs?: number }, // NEW
   ): Promise<void>
   ```
   Compute `durationSeconds` at completion: `const durationSeconds = (Date.now() - (options?.startMs ?? Date.now())) / 1000;`

   `executeFullPipeline` — extend existing `FullPipelineOptions` (pipeline.ts:158):
   ```typescript
   export interface FullPipelineOptions {
     supervisorResume?: SupervisorResumeState;
     featureFlags?: EvolutionFeatureFlags;
     startMs?: number; // NEW — for run duration tracking
   }
   ```
   Compute at completion: `const durationSeconds = (Date.now() - (options.startMs ?? Date.now())) / 1000;`

   **Caller updates:**

   `evolutionActions.ts:349` — pass startMs:
   ```typescript
   const startMs = Date.now();
   state.startNewIteration();
   await executeMinimalPipeline(runId, agents, ctx, evolutionLogger, { startMs });
   ```

   `evolution-runner.ts` (full pipeline caller) — pass startMs:
   ```typescript
   const startMs = Date.now();
   const result = await executeFullPipeline(runId, agents, ctx, logger, {
     featureFlags,
     startMs,
   });
   ```

   **Resume handling:** On checkpoint resume, the original `started_at` timestamp from the DB
   should be used instead of `Date.now()`. The runner already reads `run.started_at` — pass
   `new Date(run.started_at).getTime()` as `startMs` when resuming.

6. Add read action in `evolutionActions.ts` following existing action patterns (`requireAdmin`,
   `try/catch`, `handleError`, Zod validation on read for defense-in-depth against DB corruption):
```typescript
import { EvolutionRunSummarySchema } from '@/lib/evolution/types';
import type { EvolutionRunSummary } from '@/lib/evolution/types';

const _getEvolutionRunSummaryAction = withLogging(async (
  runId: string
): Promise<{ success: boolean; data: EvolutionRunSummary | null; error: ErrorResponse | null }> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('evolution_runs')
      .select('run_summary')
      .eq('id', runId)
      .single();

    if (error) {
      logger.error('Error fetching run summary', { error: error.message });
      throw error;
    }

    if (!data?.run_summary) return { success: true, data: null, error: null };

    // Validate JSONB on read to catch DB corruption or schema drift
    const parsed = EvolutionRunSummarySchema.safeParse(data.run_summary);
    if (!parsed.success) {
      logger.warn('Invalid run_summary in database', {
        runId,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return { success: true, data: null, error: null };
    }

    return { success: true, data: parsed.data, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getEvolutionRunSummaryAction', { runId }) };
  }
}, 'getEvolutionRunSummaryAction');

export const getEvolutionRunSummaryAction = serverReadRequestId(_getEvolutionRunSummaryAction);
```

#### Verification
- Baseline enters pool with Elo 1200, participates in calibration and tournament
- Baseline excluded from evolution parents (pool.ts filter — full pool scan, not n+1)
- Baseline excluded from dominant strategy analysis (evolvePool.ts filter)
- `run_summary.baselineRank` shows where original ranked (1 = original was best)
- `run_summary` is Zod-validated via `safeParse` before DB write — validation failure saves `null` (not crash)
- Minimal pipeline produces summary with empty eloHistory/diversityHistory arrays
- Duplicate baseline on resume is prevented by `poolIds.has()` guard
- Old runs have `run_summary = NULL` (acceptable, no backfill needed)
- `getEvolutionRunSummaryAction` validates JSONB on read with `safeParse` (defense-in-depth)
- Migration uses regular `CREATE INDEX` (not `CONCURRENTLY`) to avoid transaction conflict
- `durationSeconds` propagated correctly through `startMs` option in both pipeline paths
- Baseline insertion works in `executeMinimalPipeline` (top of function, before agent loop)
- Baseline insertion works in `executeFullPipeline` (before iteration loop, with idempotency guard)

---

### Phase 2: Local Embeddings via Transformers.js

**Goal**: Replace character-based fallback with real semantic embeddings using `all-MiniLM-L6-v2` (384-dim) running locally.

#### Files Modified
- `src/lib/evolution/agents/proximityAgent.ts` — Replace `_embed()` production path, make async, batch embeddings
- `src/lib/evolution/config.ts` — Set `useEmbeddings: true` as default
- `package.json` — Add `@huggingface/transformers` dependency

#### Implementation

1. Install dependency:
```bash
npm install @huggingface/transformers
```

2. Create embedding singleton with error handling and security config in `proximityAgent.ts`:
```typescript
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// SECURITY: Configure model loading.
// In production, pre-download model to local path:
//   npx transformers-cache download Xenova/all-MiniLM-L6-v2
// Then set env.localModelPath and disable remote.
// For development/CI, allow remote download (model cached after first run).
if (process.env.TRANSFORMERS_LOCAL_ONLY === 'true') {
  env.allowRemoteModels = false;
  env.localModelPath = process.env.TRANSFORMERS_MODEL_PATH ?? './models/';
}

let _extractor: FeatureExtractionPipeline | null = null;
let _extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let _extractorFailed = false;

// Promise-based deduplication prevents duplicate model loads when two concurrent
// async calls both see _extractor === null before the first resolves.
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (_extractorFailed) {
    throw new Error('Embedding model previously failed to load');
  }
  if (_extractor) return _extractor;

  if (!_extractorPromise) {
    _extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
    }).then((ext) => {
      _extractor = ext;
      return ext;
    }).catch((error) => {
      _extractorFailed = true;
      _extractorPromise = null;
      throw new Error(`Failed to load embedding model: ${error}`);
    });
  }
  return _extractorPromise;
}

// For testing: reset ALL singleton state (extractor, promise, failure latch)
export function resetExtractorForTest(): void {
  _extractor = null;
  _extractorPromise = null;
  _extractorFailed = false;
}
```

3. Change `_embed` to async with fallback on model failure:
```typescript
async _embed(text: string): Promise<number[]> {
  if (this.testMode) {
    // Keep existing MD5-based test embedding (deterministic)
    const hash = createHash('md5').update(text).digest('hex');
    const vec: number[] = [];
    for (let i = 0; i < 32; i += 2) {
      vec.push(parseInt(hash.slice(i, i + 2), 16) / 255);
    }
    return vec;
  }

  try {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  } catch (error) {
    // Upgrade to error level — this is a critical degradation that affects pipeline quality.
    // Include structured context for diagnosis (memory, permissions, model path issues).
    this.logger.error('Embedding model failed, falling back to character-based', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      testMode: this.testMode,
    });
    // Graceful degradation: character-based fallback (128-char, better than 16-char original)
    const chars = text.toLowerCase().slice(0, 128).padEnd(128, ' ');
    return Array.from(chars).map((c) => c.charCodeAt(0) / 255);
  }
}
```

4. Update all callers in `execute()` to await and batch with `Promise.all`:
```typescript
// In execute(), replace the synchronous embedding loops with batched async:

// Batch embed new entrants
const newEmbedPromises = newIds
  .filter((vid) => !this.embeddingCache.has(vid) && idToVar.has(vid))
  .map(async (vid) => {
    const emb = await this._embed(idToVar.get(vid)!.text);
    return { vid, emb };
  });
const newResults = await Promise.all(newEmbedPromises);
for (const { vid, emb } of newResults) {
  this.embeddingCache.set(vid, emb);
}

// Batch embed existing pool members that aren't cached
const existEmbedPromises = existingIds
  .filter((eid) => !this.embeddingCache.has(eid) && idToVar.has(eid))
  .map(async (eid) => {
    const emb = await this._embed(idToVar.get(eid)!.text);
    return { vid: eid, emb };
  });
const existResults = await Promise.all(existEmbedPromises);
for (const { vid, emb } of existResults) {
  this.embeddingCache.set(vid, emb);
}
```

5. Update `config.ts`: Set `useEmbeddings: true`.

6. Update `estimateCost()` — local embeddings cost $0:
```typescript
estimateCost(_payload: AgentPayload): number {
  return 0; // Local ONNX model, no API cost
}
```

#### Key Design Decisions
- **Singleton with promise deduplication**: Uses `_extractorPromise` to prevent duplicate model loads when two concurrent async calls race. If model load fails once, `_extractorFailed = true` latches — no retry (avoids repeated download attempts). Falls back to character-based.
- **Graceful degradation**: If ONNX fails, fall back to character-based (128-char, not 16-char). Log at **error** level with structured context (stack trace, testMode flag) for diagnosis.
- **Batched async**: `Promise.all` on embedding calls. Since ONNX runs locally, concurrency is CPU-bound, but the async pattern is correct for the API and future GPU acceleration.
- **Cache bounds**: `embeddingCache` has max size (2000 entries ≈ 3MB) with FIFO eviction to prevent unbounded memory growth in long or resumed runs.
- **Security**: `TRANSFORMERS_LOCAL_ONLY=true` env var for production disables remote model download. Development allows remote download with auto-caching. Consider adding SHA256 integrity verification for production model files.
- **Test mode preserved**: Unit tests use deterministic MD5 embeddings. `resetExtractorForTest()` exported for test cleanup — **must** be called in `afterEach` in every test file that touches ProximityAgent.
- **Model choice**: `all-MiniLM-L6-v2` is 22MB, 384-dim output, best accuracy/size ratio for sentence similarity.

#### Verification
- Diversity scores reflect semantic similarity, not character prefix matching
- Texts with same meaning but different wording → high similarity
- Texts with different meaning but same prefix → low similarity
- Model failure falls back to character-based with warning log
- Test suite passes unchanged (testMode path untouched)
- `TRANSFORMERS_LOCAL_ONLY=true` blocks remote model download

---

## Testing

### Phase 1 Tests (Baseline + Run Summary)

#### New Unit Tests

**`pipeline.test.ts`** (new file or extend existing):
- `insertBaselineVariant` adds exactly one variant with `BASELINE_STRATEGY`, version 0, empty parentIds
- `insertBaselineVariant` is idempotent — calling twice does not duplicate (poolIds guard)
- `buildRunSummary` produces valid `EvolutionRunSummarySchema` shape
- `buildRunSummary` with `supervisor = undefined` → eloHistory/diversityHistory are `[]`, finalPhase is `'EXPANSION'`
- `buildRunSummary` with baseline at rank 1 → `baselineRank === 1` (evolution didn't help)
- `buildRunSummary` with baseline at rank 5 → `baselineRank === 5`
- `buildRunSummary` with no baseline in pool → `baselineRank === null`, warns in logger
- `buildRunSummary` with empty matchHistory → `avgConfidence === 0`, `decisiveRate === 0`
- `strategyEffectiveness` correctly aggregates avg Elo per strategy (including baseline as its own strategy)
- `matchStats.decisiveRate` calculated correctly with mixed confidence values

**`pool.test.ts`** (new or extend):
- `getEvolutionParents` excludes baseline even when baseline has highest Elo
- `getEvolutionParents(2)` returns 2 non-baseline variants when baseline is top-ranked
- `getEvolutionParents` with only baseline + 1 variant → returns the 1 non-baseline variant

**`evolvePool.test.ts`** (update existing):
- `getDominantStrategies` excludes baseline from strategy count
- Baseline variant is not selected as evolution parent

**`calibrationRanker.test.ts`** (update existing):
- Baseline participates in calibration matches (is a valid opponent)

**`tournament.test.ts`** (update existing):
- Baseline participates in tournament rounds
- Baseline can win matches (its Elo updates normally)

#### Existing Tests That Need Updating

The baseline adds +1 to pool size in every pipeline run. These tests need assertions updated:

- **`supervisor.test.ts`**: Tests checking `poolSize >= expansionMinPool` thresholds — adjust expected pool sizes by +1 or set thresholds to account for baseline
- **`evolution-pipeline.integration.test.ts`**: `total_variants` count assertions → +1 for baseline
- **`diversityTracker.test.ts`**: If tests create mock pools, add awareness of baseline strategy in strategy diversity checks
- **`metaReviewAgent.test.ts`**: Strategy analysis tests — baseline is its own strategy category, shouldn't count toward "low strategy diversity" warnings

**Strategy**: Search all test files for assertions on `pool.length`, `getPoolSize()`, `total_variants`, and `strategies` to find all affected lines. Document exact changes in progress doc during execution.

#### Integration Tests

- **`evolution-pipeline.integration.test.ts`**: Verify baseline variant present in final pool with Elo rating after minimal pipeline run
- **`evolution-pipeline.integration.test.ts`**: Verify `run_summary` JSONB column is populated and passes Zod validation
- **`evolution-actions.integration.test.ts`**: Verify `getEvolutionRunSummaryAction` returns valid data for completed run
- **`evolution-actions.integration.test.ts`**: Verify `getEvolutionRunSummaryAction` returns null for run without summary (old runs)

#### Edge Case Tests

- Baseline is only variant in pool (all generation strategies failed) → calibration `canExecute` returns false (needs ≥2), tournament same → pipeline completes with baseline at rank 1, no matches. **Must write explicit test** — not just assert behavior conceptually:
  ```typescript
  it('pipeline completes with only baseline when all generation fails', async () => {
    // Mock generation to return empty/fail
    // Verify: baselineRank === 1, matchHistory.length === 0, no errors thrown
  });
  ```
- Pipeline crash and resume → baseline not re-added (poolIds guard)
- `baselineRank` with tied Elo scores → rank reflects position in getTopByElo sort order
- `getEvolutionParents(2)` with pool = [baseline, variant1] → returns [variant1] (only 1 non-baseline)
- Phase transition threshold edge cases: if `expansionMinPool = 5` and pool has 4 variants, baseline
  makes it 5 → may trigger early transition. Test with thresholds at boundary values.
- Tournament with baseline in pool: odd/even pairing math changes with +1 baseline

#### Pool Size Regression Checklist

Before implementing, run this search to find all assertions affected by +1 pool size:
```bash
grep -rn 'pool\.length\|getPoolSize\|total_variants\|poolSize\|pool\.size' \
  src/lib/evolution/**/*.test.ts
```

Known files that will need +1 adjustments:
- `supervisor.test.ts`: phase transition thresholds (pool size 3→4, 6→7, etc.)
- `evolution-pipeline.integration.test.ts`: `total_variants` count assertions
- `tournament.test.ts`: odd/even pairing (baseline adds 1 to pool)
- `diversityTracker.test.ts`: strategy diversity checks (baseline is its own strategy)
- `metaReviewAgent.test.ts`: strategy analysis (baseline shouldn't trigger "low diversity" warnings)

Document **exact line changes** in `_progress.md` during execution.

### Phase 2 Tests (Embeddings)

#### Jest Mocking Strategy for `@huggingface/transformers`

The mock **must** produce text-dependent embeddings. A constant-fill mock (e.g., `fill(0.5)`) makes
all texts identical in embedding space, so all diversity scores become 0 and the mock can't catch
real bugs like wrong dimensions, normalization failures, or cache key collisions.

```typescript
// In proximityAgent.test.ts or a shared setup file:
jest.mock('@huggingface/transformers', () => {
  // Hash text to get different but deterministic embeddings per input
  const mockExtract = jest.fn((text: string) => {
    const hash = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const vec = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      vec[i] = Math.sin(hash + i * 0.1); // Different per text, deterministic
    }
    // Normalize to unit vector (matches real model's normalize: true behavior)
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 384; i++) vec[i] /= mag;
    return { data: vec };
  });
  return {
    pipeline: jest.fn(() => Promise.resolve(mockExtract)),
    env: { allowRemoteModels: true, localModelPath: '' },
  };
});
```

**Why text-dependent:** This catches dimension mismatches (384 vs 512), normalization bugs, and
ensures diversity score tests produce meaningful non-zero values.

#### New Unit Tests

**`proximityAgent.test.ts`** (extend):
- Production path (testMode=false): `_embed` returns 384-dim vector
- Production path: semantically similar mock → high cosine similarity (control via mock return values)
- Production path: different mock embeddings → low cosine similarity
- Model load failure → falls back to character-based embedding with warning log
- `_extractorFailed` latch → second call after failure doesn't retry model load
- `resetExtractorForTest()` clears singleton and failure latch
- Batched embedding: `Promise.all` processes multiple texts concurrently
- Embedding cache: second call for same text returns cached result (no duplicate model calls)

**Existing test mode tests**: No changes needed (testMode=true path unchanged, MD5 logic untouched).

#### Singleton Cleanup (MANDATORY)

The `_extractor` / `_extractorPromise` / `_extractorFailed` module-level singletons persist across
test files in the same Jest process. **Every test file** that touches ProximityAgent must reset state:

```typescript
// In EVERY test file that imports or uses ProximityAgent:
import { resetExtractorForTest } from '@/lib/evolution/agents/proximityAgent';

afterEach(() => {
  resetExtractorForTest(); // Prevent cross-test pollution
});
```

Also add to the global Jest setup if one exists (`jest.setup.ts`):
```typescript
import { resetExtractorForTest } from '@/lib/evolution/agents/proximityAgent';
afterEach(() => resetExtractorForTest());
```

#### Embedding Cache Bounds

Add a max cache size to `ProximityAgent.embeddingCache` to prevent unbounded memory growth
in long runs (100 iterations × 10 variants = 1000 entries × 384 dims × 4 bytes ≈ 1.5MB is OK,
but crashed/resumed runs could accumulate more):

```typescript
private readonly MAX_CACHE_SIZE = 2000; // ~3MB for 384-dim embeddings

// In _embed or before cache.set:
if (this.embeddingCache.size >= this.MAX_CACHE_SIZE) {
  // Evict oldest entry (FIFO — Map preserves insertion order)
  const firstKey = this.embeddingCache.keys().next().value;
  if (firstKey) this.embeddingCache.delete(firstKey);
}
```

#### Integration Tests
- Run pipeline with `testMode: false` (mocked transformers) → verify diversity scores are non-trivial
- Verify embedding cache persists across iterations within a run

### Manual Verification (Stage)
- Run evolution on a known article, check that:
  - Baseline appears in variant list with Elo score
  - `run_summary.baselineRank` correctly reflects whether evolution improved the article
  - Diversity scores change meaningfully with real embeddings (compare to pre-change character-based scores)
  - Admin UI can display run summary data
  - `TRANSFORMERS_LOCAL_ONLY=true` env works in production

## Documentation Updates
- `docs/feature_deep_dives/evolution_pipeline.md` — Add sections on:
  - Baseline variant ranking: what `BASELINE_STRATEGY` is, why original is in the tournament, how to interpret `baselineRank` (1 = evolution didn't help, higher = evolution improved the article)
  - Run summary schema: field descriptions, `version` field for forward compatibility, JSONB shape
  - Real embedding integration: model choice, singleton lifecycle, security config (`TRANSFORMERS_LOCAL_ONLY`), fallback behavior
  - How to interpret `strategyEffectiveness` (note: baseline is its own "strategy" with count=1)

---

## Review Fixes Applied (2026-01-31)

Issues identified by 4-agent parallel review (Architecture, Security, Testing, Feasibility):

### Critical Fixes
1. **Fixed `executeMinimalPipeline` baseline insertion** — No `startNewIteration()` in minimal pipeline. Insert at top of function before agent loop, not after nonexistent call.
2. **Fixed `executeFullPipeline` baseline insertion** — Insert before iteration loop (not inside with broken guard). Idempotency guard handles resume.
3. **Fixed `getEvolutionParents` filtering** — Fetch full pool, filter baseline, slice to `n`. Old `n+1` approach failed when baseline ranked low.
4. **Fixed Zod `.parse()` → `.safeParse()`** — Validation failure no longer crashes pipeline completion. Saves `null` and logs error.
5. **Removed `CREATE INDEX CONCURRENTLY`** — Supabase migrations run in transactions; `CONCURRENTLY` fails inside transactions.
6. **Fixed Jest mock** — Now produces text-dependent normalized embeddings instead of constant `fill(0.5)`.

### Important Fixes
7. **Removed redundant `originalText` param** from `insertBaselineVariant` — uses `state.originalText`.
8. **Tightened Zod metaFeedback bounds** — 200 chars × 10 entries (was 500 × 20), reducing max JSONB from 40KB to 8KB.
9. **Added Zod validation on read** in `getEvolutionRunSummaryAction` — defense-in-depth against DB corruption.
10. **Specified `durationSeconds` data flow** — concrete signature changes for both pipelines, caller updates, resume handling.
11. **Fixed `getDominantStrategies` code** — matched actual standalone function signature `(pool: TextVariation[])`.
12. **Added `as const`** to `BASELINE_STRATEGY` for literal type safety.

### Moderate Fixes
13. **Fixed singleton race condition** — Promise-based deduplication prevents duplicate model loads.
14. **Upgraded embedding fallback logging** — error level with structured context (stack, testMode).
15. **Added singleton cleanup guidance** — `resetExtractorForTest()` in `afterEach` for all test files.
16. **Added embedding cache bounds** — max 2000 entries with FIFO eviction.
17. **Added missing edge case tests** — baseline-only pool, phase transition boundaries, tournament pairing.
18. **Added pool size regression checklist** — grep command + known affected files with specific adjustments.
19. **Updated `getEvolutionRunSummaryAction`** — follows existing action patterns (requireAdmin, try/catch, handleError).
