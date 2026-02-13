# Fix Task Agent Breakdowns Plan

## Background
The evolution pipeline's explorer task view and run timeline lack agent-level execution detail. Users cannot see what individual agents did per iteration, their inputs/outputs, or agent-specific metrics (e.g., iterative editing rounds, calibration match results). This project adds structured per-agent-invocation tracking and type-specific detail views so users can drill into exactly what each agent did during each call.

## Requirements (from GH Issue #405)
1. Per-agent-invocation records within each run iteration (separate entries if called multiple times)
2. Each record captures inputs, outputs, and agent-specific metadata
3. Detailed drill-down views per agent type:
   - IterativeEditing: rounds, per-round output, Elo changes
   - Calibration/Tournament: matches run, Elo impact
   - Generation: variants produced, strategies used
   - Reflection: critique dimensions, scores
   - Debate: transcript, synthesis result
   - etc.
4. Accessible from both explorer task view and run timeline view

## Design Requirement: Full Depth Visibility

**All four data tiers must be surfaced in agent drill-down views**, including Tier 4 (ephemeral in-memory data). The goal is a detailed view of what every agent type is doing — not just summaries or counts, but the full execution trace: opponent selection logic, per-cycle edit targets and judge verdicts, creative exploration triggers, format validation issues, raw strategy outcomes, early exit decisions, etc. Every piece of structured data an agent produces during execution should be capturable and displayable in its type-specific detail panel.

This means agent code changes are required to emit structured execution detail records alongside the existing `AgentResult` return values.

## Problem

Agents produce rich structured data during execution — edit cycles with judge verdicts, match results with opponent selection logic, debate transcripts with judge reasoning, creative exploration triggers — but this data is either (a) buried in opaque JSONB checkpoint blobs (not queryable), (b) logged as freeform text (not structured), or (c) discarded entirely after the agent returns. The only standardized return is `AgentResult` with 9 flat fields (success, costUsd, variantsAdded, etc.), losing all execution detail. The existing Timeline tab computes per-agent metrics by diffing sequential checkpoint snapshots, yielding only counts ("+3 variants", "5 matches"), not the underlying process. Users cannot answer questions like "which edit targets were attempted?", "why did the tournament exit early?", or "what was the debate judge's reasoning?" without parsing raw log text.

## Options Considered

### Option A: Extend checkpoint state with execution detail arrays
Add `agentExecutionDetails: AgentExecutionDetail[]` to `PipelineState`. Each agent pushes its detail during `execute()`, similar to how DebateAgent pushes to `state.debateTranscripts`.

- **Pro**: No new table, data co-located with state, available via existing checkpoint diffing
- **Con**: Bloats checkpoint JSONB (already large), couples execution telemetry to domain state, not independently queryable, changes state serialization format

### Option B: Structured log entries in `evolution_run_logs`
Write one structured log entry per invocation with full detail in the `context` JSONB column.

- **Pro**: No schema change, uses existing table and indexes
- **Con**: Mixed with freeform logs, harder to query as first-class records, no unique constraint for idempotent upserts, log table optimized for append-heavy writes not point reads

### Option C: New `evolution_agent_invocations` table ← **Selected**
Dedicated table with `(run_id, iteration, agent_name)` uniqueness, `execution_detail JSONB` column typed per agent.

- **Pro**: Clean separation, independently queryable, proper indexes, idempotent upserts via UNIQUE constraint, follows existing pattern (agent_metrics table for aggregates, this for per-invocation)
- **Con**: New migration, new persistence code, marginal storage increase

### Option D: Extend `AgentResult` only (no DB persistence)
Add `executionDetail` to AgentResult, expose via enhanced checkpoint diffing at read time.

- **Pro**: Minimal code change, no migration
- **Con**: Detail only available while in-memory, lost after process exits, no historical queries, no cross-run analysis

**Decision**: Option C. New table provides clean separation, queryability, and follows the project's existing pattern of purpose-specific tables (runs, variants, checkpoints, agent_metrics, logs → now invocations).

## Architecture

### Data Flow

```
Agent.execute()
  │ builds executionDetail object during execution
  │ returns AgentResult with executionDetail field
  ▼
pipeline.ts → runAgent()
  │ receives AgentResult
  │ calls persistAgentInvocation(runId, iteration, agent.name, result)
  │ calls persistCheckpoint() (existing)
  ▼
evolution_agent_invocations table
  │ JSONB execution_detail column, discriminated by agent_name
  ▼
getAgentInvocationDetailAction(runId, iteration, agentName)
  │ server action, returns typed detail
  ▼
TimelineTab → AgentDetailPanel
  │ lazy-loads detail on expand click
  │ renders type-specific sub-panel based on agentName
  ▼
User sees full execution trace
```

### Type System

```typescript
// In types.ts — extend existing AgentResult
interface AgentResult {
  agentType: string;
  success: boolean;
  costUsd: number;
  error?: string;
  variantsAdded?: number;
  matchesPlayed?: number;
  convergence?: number;
  skipped?: boolean;
  reason?: string;
  executionDetail?: AgentExecutionDetail;  // NEW
}

// Discriminated union — each agent has its own shape
// Uses `detailType` as discriminator (NOT `agentType` — that field already exists
// on AgentResult as a plain string and would conflict with literal types).
type AgentExecutionDetail =
  | GenerationExecutionDetail
  | CalibrationExecutionDetail
  | TournamentExecutionDetail
  | IterativeEditingExecutionDetail
  | ReflectionExecutionDetail
  | DebateExecutionDetail
  | SectionDecompositionExecutionDetail
  | EvolutionExecutionDetail
  | TreeSearchExecutionDetail
  | OutlineGenerationExecutionDetail
  | ProximityExecutionDetail
  | MetaReviewExecutionDetail;

// Example detail type:
interface GenerationExecutionDetail {
  detailType: 'generation';  // discriminator
  strategies: Array<{
    name: string;
    status: 'success' | 'format_rejected' | 'error';
    formatIssues?: string[];
    variantId?: string;
    textLength?: number;
    error?: string;
  }>;
  feedbackUsed: boolean;
  totalCost: number;
}
```

Each detail type is defined in the research document's "Detail view data model" sections (§1–§12). All include `detailType` string literal discriminator and `totalCost: number`.

### JSONB Size Limits

Execution detail JSONB is capped to prevent unbounded growth:

| Constraint | Limit | Rationale |
|------------|-------|-----------|
| **Hard byte cap** | 100 KB per invocation | Truncate with `_truncated: true` flag |
| Tournament rounds | Max 30 rounds persisted | Typical runs are 5–15 rounds |
| Tournament matches per round | Max 20 matches | Swiss pairing produces ≤ poolSize/2 pairs |
| Calibration entrants | Max 50 entrants | Bounded by pool size |
| IterativeEditing cycles | Max 10 cycles | Config default is 3 |
| Debate transcript turns | Max 4 turns | Fixed by debate structure |
| TreeSearch revision path | Max 30 nodes | Bounded by depth 3 × branching 3 |

Truncation helper in `pipeline.ts`:
```typescript
function truncateDetail(detail: AgentExecutionDetail): AgentExecutionDetail {
  const json = JSON.stringify(detail);
  if (json.length <= 100_000) return detail;
  return { ...detail, _truncated: true } as AgentExecutionDetail;
}
```

### XSS Mitigation

All execution detail fields are rendered as **escaped text** via React's default JSX escaping (`{value}` — never `dangerouslySetInnerHTML`). Fields containing LLM-generated content (error messages, judge reasoning, debate transcripts, strategy names) are:
1. Rendered in `<code>` or `<pre>` blocks for readability
2. Truncated to max 500 chars with "Show more" expand
3. Never injected as HTML — React's JSX auto-escaping handles this

No DOMPurify or additional sanitization needed because React escapes by default and we never use `dangerouslySetInnerHTML`.

---

## Phased Execution Plan

### Phase 1: Data Infrastructure
**Goal**: Types, DB table, pipeline persistence — no agent code changes yet.

#### Step 1.1: Define execution detail types
**File**: `src/lib/evolution/types.ts`

Add `AgentExecutionDetail` discriminated union type and all 12 agent-specific detail interfaces. Each interface uses the data model from the research document's per-agent sections. Add `detailType` string literal discriminator to each (NOT `agentType` — that field already exists on `AgentResult` as a plain string).

Add `executionDetail?: AgentExecutionDetail` field to existing `AgentResult` interface. The existing `agentType: string` field on `AgentResult` remains unchanged.

Also create `src/testing/fixtures/executionDetailFixtures.ts` with sample data for all 12 agent types (used by Phase 2–4 tests).

#### Step 1.2: Create DB migration
**File**: `supabase/migrations/20260212000001_evolution_agent_invocations.sql`

```sql
-- Per-agent-per-iteration execution records with structured JSONB detail.
-- Supports drill-down from Timeline and Explorer views.
-- Rollback: DROP TABLE evolution_agent_invocations CASCADE;

CREATE TABLE evolution_agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  agent_name TEXT NOT NULL,
  execution_order INT NOT NULL,
  success BOOLEAN NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  skipped BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  execution_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, iteration, agent_name)
);

CREATE INDEX idx_agent_invocations_run ON evolution_agent_invocations(run_id, iteration);
CREATE INDEX idx_agent_invocations_agent ON evolution_agent_invocations(run_id, agent_name);
```

**Rollback SQL** (in migration header comment): `DROP TABLE evolution_agent_invocations CASCADE;`

No RLS — matches existing evolution tables pattern (admin-only via server actions).

**UNIQUE constraint note**: Current pipeline calls each agent exactly once per iteration (sequential execution in `executeFullPipeline` loop). The UNIQUE on `(run_id, iteration, agent_name)` matches this 1:1 mapping. If future multi-call support is needed, change to `UNIQUE (run_id, iteration, agent_name, execution_order)`.

#### Step 1.3: Add pipeline persistence
**File**: `src/lib/evolution/core/pipeline.ts`

Add `persistAgentInvocation()` function. **Exact insertion point**: `runAgent()` function (line 1051), immediately after the logger.info call at line 1083 and before `persistCheckpoint()` at line 1084.

```typescript
// pipeline.ts line 1083 (existing): logger.info('Agent completed', { ... });
// INSERT HERE ↓
await persistAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder, result);
// pipeline.ts line 1084 (existing): await persistCheckpoint(runId, ctx.state, agent.name, phase, logger);
```

**Error handling**: `persistAgentInvocation()` is wrapped in try-catch and is **non-blocking** — a failed DB write logs via the pipeline `logger` (not `console.warn`) but does NOT prevent checkpoint persistence or pipeline continuation. This ensures execution detail is best-effort telemetry, not a critical path dependency.

**Schema validation**: No Zod validation on write — the TypeScript type system enforces correctness at compile time (each agent returns a typed detail interface). For read-time safety, the frontend components use optional chaining and fallback rendering for missing fields (Phase 4 components handle `undefined` gracefully). If malformed data is encountered, the component shows a "Data unavailable" placeholder rather than crashing.

```typescript
async function persistAgentInvocation(
  runId: string,
  iteration: number,
  agentName: string,
  executionOrder: number,
  result: AgentResult,
  logger: EvolutionLogger,  // Use pipeline logger, not console
): Promise<void> {
  try {
    const detail = result.executionDetail
      ? truncateDetail(result.executionDetail)
      : {};
    const supabase = await createSupabaseServiceClient();
    await supabase.from('evolution_agent_invocations').upsert({
      run_id: runId,
      iteration,
      agent_name: agentName,
      execution_order: executionOrder,
      success: result.success,
      cost_usd: result.costUsd,
      skipped: result.skipped ?? false,
      error_message: result.error ?? null,
      execution_detail: detail,
    }, { onConflict: 'run_id,iteration,agent_name' });
  } catch (err) {
    // Non-blocking: log warning via pipeline logger but don't fail the pipeline
    logger.warn('Failed to persist agent invocation', {
      agent: agentName, iteration, error: String(err),
    });
  }
}
```

**Truncation implementation**: `truncateDetail()` measures byte size via `new TextEncoder().encode()` (accurate for multi-byte characters) and slices large arrays per agent type to fit within the 100KB cap:

```typescript
const MAX_DETAIL_BYTES = 100_000;

function truncateDetail(detail: AgentExecutionDetail): AgentExecutionDetail {
  const encoded = new TextEncoder().encode(JSON.stringify(detail));
  if (encoded.length <= MAX_DETAIL_BYTES) return detail;

  // Phase 1: Slice known large arrays based on detailType
  const sliced = sliceLargeArrays(detail);
  const recheck = new TextEncoder().encode(JSON.stringify(sliced));
  if (recheck.length <= MAX_DETAIL_BYTES) {
    return { ...sliced, _truncated: true } as AgentExecutionDetail;
  }

  // Phase 2: Still over — strip to base fields only (detailType + totalCost + _truncated)
  return {
    detailType: detail.detailType,
    totalCost: detail.totalCost,
    _truncated: true,
  } as AgentExecutionDetail;
}

function sliceLargeArrays(detail: AgentExecutionDetail): AgentExecutionDetail {
  switch (detail.detailType) {
    case 'tournament':
      return { ...detail, rounds: detail.rounds.slice(0, 30) };
    case 'calibration':
      return {
        ...detail,
        entrants: detail.entrants.slice(0, 50).map(e => ({
          ...e, matches: e.matches.slice(0, 20),
        })),
      };
    case 'iterativeEditing':
      return { ...detail, cycles: detail.cycles.slice(0, 10) };
    default:
      return detail; // Other agents are naturally bounded
  }
}
```

**runAgent() signature change** — exact BEFORE/AFTER at line 1051 of `pipeline.ts`:

```typescript
// BEFORE (lines 1051-1057):
async function runAgent(
  runId: string,
  agent: PipelineAgent,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
): Promise<AgentResult | null>

// AFTER (lines 1051-1058):
async function runAgent(
  runId: string,
  agent: PipelineAgent,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  executionOrder: number,  // NEW
): Promise<AgentResult | null>
```

Note: `logger` is already a parameter of `runAgent()` — so it can be passed directly to `persistAgentInvocation(... , logger)` with no additional threading.

**Inside runAgent()**, insert the persist call at line 1083–1084 (between logger.info and persistCheckpoint):

```typescript
// Line 1083 (existing):  });  // end of logger.info
// INSERT:
await persistAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder, result, logger);
// Line 1084 (existing): await persistCheckpoint(runId, ctx.state, agent.name, phase, logger);
```

**All 6 call sites** of `runAgent()` in `executeFullPipeline()` — add `executionOrder++`:

```typescript
// BEFORE → AFTER for each call site:

// Line 914:
await runAgent(runId, agents.generation, ctx, phase, logger);
// →
await runAgent(runId, agents.generation, ctx, phase, logger, executionOrder++);

// Line 933:
await runAgent(runId, agent, ctx, phase, logger);
// →
await runAgent(runId, agent, ctx, phase, logger, executionOrder++);

// Line 975:
await runAgent(runId, agent, ctx, phase, logger);
// →
await runAgent(runId, agent, ctx, phase, logger, executionOrder++);

// Line 982:
await runAgent(runId, rankingAgent, ctx, phase, logger);
// →
await runAgent(runId, rankingAgent, ctx, phase, logger, executionOrder++);

// Line 987:
await runAgent(runId, agents.proximity, ctx, phase, logger);
// →
await runAgent(runId, agents.proximity, ctx, phase, logger, executionOrder++);

// Line 992:
await runAgent(runId, agents.metaReview, ctx, phase, logger);
// →
await runAgent(runId, agents.metaReview, ctx, phase, logger, executionOrder++);
```

**executionOrder counter**: Add at line 865, immediately after `ctx.state.startNewIteration()` at line 864:

```typescript
// Line 864 (existing): ctx.state.startNewIteration();
// Line 865 (INSERT):
let executionOrder = 0;
// Line 866 (existing): // Phase detection and config
```

**Note on `executeMinimalPipeline()`** (lines 729–760): This function has its own inline agent execution logic (line 737: `await agent.execute(ctx)`) that does NOT call `runAgent()`. It should be updated separately to call `persistAgentInvocation()` directly after its `agent.execute()` call, with `executionOrder: 0` (only one agent runs).

#### Step 1.4: Lint, typecheck, test
- Run `npm run lint && npx tsc --noEmit`
- Write unit test for `persistAgentInvocation` with mock Supabase client
- Verify existing pipeline tests still pass (agent execute → checkpoint flow unchanged)

---

### Phase 2: Agent Instrumentation (Tier 4 Capture)
**Goal**: Each agent populates `executionDetail` in its `AgentResult` return.

All changes are backward-compatible — `executionDetail` is optional, so agents that haven't been instrumented yet continue to work.

#### Instrumentation pattern (same for all agents):
1. Create a local detail accumulator at start of `execute()`
2. Capture ephemeral data at identified code points (from research §"Tier 4 Ephemeral Data: Exact Capture Points")
3. Assign to `executionDetail` field in the returned `AgentResult`

#### Step 2.1: Simple agents (zero LLM, minimal data)
**Files**:
- `src/lib/evolution/agents/proximityAgent.ts` — capture newEntrants, existingVariants, diversityScore, totalPairsComputed
- `src/lib/evolution/agents/metaReviewAgent.ts` — capture all 4 analysis arrays + intermediate analysis (strategyOrdinals, bottomQuartileCount, poolDiversity, ordinalRange, activeStrategies, topVariantAge)

**Test**: Unit tests asserting executionDetail shape for each agent.

#### Step 2.2: Generation agents (parallel LLM, format validation)
**Files**:
- `src/lib/evolution/agents/generationAgent.ts` — per-strategy status/formatIssues/variantId, feedbackUsed flag
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — per-step name/score/cost/inputLength/outputLength, weakestStep, fallback used

**Test**: Unit tests per agent. Verify format rejection paths populate detail correctly.

#### Step 2.3: Comparison agents (matches, ratings, budget)
**Files**:
- `src/lib/evolution/agents/calibrationRanker.ts` — per-entrant opponents/matches/earlyExit/ratingBefore/ratingAfter, avgConfidence
- `src/lib/evolution/agents/tournament.ts` — budgetPressure/tier, per-round pairs/matches/multiTurnUsed, exitReason, convergenceStreak/staleRounds, flowEnabled

**Test**: Unit tests. Verify early exit and budget paths populate detail. Verify rating snapshots captured before/after.

#### Step 2.4: Editing agents (cycles, targets, verdicts)
**Files**:
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — per-cycle target/verdict/confidence/formatValid/newVariantId, initialCritique/finalCritique, stopReason, consecutiveRejections
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — targetVariantId, weakness, per-section heading/eligible/improved/charCount, sectionsImproved, formatValid

**Test**: Unit tests. Verify cycle-level detail (accept path, reject path, format rejection path). Verify section edit results.

#### Step 2.5: Analysis & synthesis agents
**Files**:
- `src/lib/evolution/agents/reflectionAgent.ts` — per-variant status/avgScore/dimensionScores/goodExamples/badExamples/error
- `src/lib/evolution/agents/debateAgent.ts` — variantA/B with ordinals, transcript, judgeVerdict, synthesisVariantId, failurePoint
- `src/lib/evolution/agents/evolvePool.ts` — parents with ordinals, per-mutation strategy/status/variantId, creativeExploration/reason, feedbackUsed
- `src/lib/evolution/agents/treeSearchAgent.ts` — rootVariantId, config, result (treeSize/maxDepth/prunedBranches/revisionPath), bestLeafVariantId, addedToPool

**Test**: Unit tests per agent. Verify partial transcript capture for Debate. Verify creative exploration trigger logic for Evolution.

---

### Phase 3: Backend Query Layer
**Goal**: Server actions to fetch and return typed execution detail.

#### Step 3.1: Add server action
**File**: `src/lib/services/evolutionVisualizationActions.ts`

```typescript
export async function getAgentInvocationDetailAction(
  runId: string,
  iteration: number,
  agentName: string,
): Promise<ActionResult<AgentExecutionDetail | null>>
```

And a batch variant for loading all invocations in an iteration:

```typescript
export async function getIterationInvocationsAction(
  runId: string,
  iteration: number,
): Promise<ActionResult<AgentInvocationRow[]>>
```

Where `AgentInvocationRow` includes the base fields (success, cost, skipped, error) plus `executionDetail`.

#### Step 3.2: Integrate with timeline data
**File**: `src/lib/services/evolutionVisualizationActions.ts`

Enhance `getEvolutionRunTimelineAction()` to include a `hasExecutionDetail: boolean` flag per agent row. This avoids loading full JSONB for all agents upfront — detail is lazy-loaded on expand.

**Exact data structure change**: Add `hasExecutionDetail?: boolean` to the `TimelineAgent` type (the object in `TimelineData.iterations[].agents[]`).

**Implementation**: Just before the return at line 487 (`return { success: true, data: { iterations, phaseTransitions } ...}`), run a single lightweight query:

```typescript
// After building timeline from checkpoints, enrich with invocation presence:
const { data: invocationKeys } = await supabase
  .from('evolution_agent_invocations')
  .select('iteration, agent_name')
  .eq('run_id', runId);

const invocationSet = new Set(
  (invocationKeys ?? []).map(r => `${r.iteration}-${r.agent_name}`)
);

// Set flag on each agent in the already-built timeline:
for (const iter of timeline.iterations) {
  for (const agent of iter.agents) {
    agent.hasExecutionDetail = invocationSet.has(`${iter.iteration}-${agent.name}`);
  }
}
```

This adds one SELECT query (no JSONB loaded) to the existing timeline action. The index `idx_agent_invocations_run(run_id, iteration)` covers this query.

#### Step 3.3: Add explorer drill-down query
**File**: `src/lib/services/unifiedExplorerActions.ts`

Add ability to fetch per-iteration invocations for a specific agent across a run, for the Explorer task view drill-down:

```typescript
export async function getAgentInvocationsForRunAction(
  runId: string,
  agentName: string,
): Promise<ActionResult<AgentInvocationRow[]>>
```

#### Step 3.4: Tests
- Unit test each server action with mock DB responses
- Verify `hasExecutionDetail` flag flows through timeline data correctly

---

### Phase 4: Frontend Detail Views
**Goal**: Type-specific React components rendered in TimelineTab's AgentDetailPanel and accessible from Explorer.

#### Step 4.1: Agent detail component architecture
**File**: `src/components/evolution/agentDetails/AgentExecutionDetailView.tsx`

Router component that delegates to type-specific sub-components based on `detailType` discriminator:

```typescript
export function AgentExecutionDetailView({ detail }: { detail: AgentExecutionDetail }) {
  switch (detail.detailType) {
    case 'generation': return <GenerationDetail detail={detail} />;
    case 'calibration': return <CalibrationDetail detail={detail} />;
    // ... 10 more cases
    default: {
      // Fallback for unknown/future agent types — render raw JSON
      const _exhaustive: never = detail;
      return <pre>{JSON.stringify(detail, null, 2)}</pre>;
    }
  }
}
```

The `never` exhaustiveness check ensures TypeScript errors if a new detail type is added without a corresponding case. The `<pre>` fallback renders raw JSON safely (React auto-escaping) for forward compatibility.

#### Step 4.2: Type-specific detail components
**Directory**: `src/components/evolution/agentDetails/`

12 components, one per agent type. Key rendering patterns:

| Agent | Primary UI Element |
|-------|--------------------|
| Generation | Strategy cards (success/format_rejected/error) with variant links |
| Calibration | Entrant table with opponent list, match results, rating before→after, early exit badge |
| Tournament | Round-by-round accordion with pairing table, exit reason badge, convergence chart |
| IterativeEditing | Cycle timeline (target → verdict → outcome) with stop reason |
| Reflection | Variant critique cards with dimension score bars |
| Debate | Transcript accordion (Advocate A → B → Judge → Synthesis) with verdict callout |
| SectionDecomposition | Section grid (eligible/improved) with weakness callout |
| Evolution | Mutation table + creative exploration trigger callout + parent lineage |
| TreeSearch | Tree visualization (nodes + pruned branches) with revision path |
| OutlineGeneration | Step pipeline (outline → expand → polish → verify) with per-step scores |
| Proximity | Diversity score gauge + new/existing counts |
| MetaReview | Four analysis lists (successful, weaknesses, failures, priorities) + threshold triggers |

Group by implementation complexity:
- **Simple** (Step 4.2a): Proximity, MetaReview, Generation, Reflection — flat data, tables/lists
- **Medium** (Step 4.2b): Calibration, Evolution, SectionDecomposition, OutlineGeneration — nested tables
- **Complex** (Step 4.2c): Tournament, IterativeEditing, Debate, TreeSearch — accordions, timelines, tree vis

#### Step 4.3: Integrate into TimelineTab
**File**: `src/components/evolution/tabs/TimelineTab.tsx`

**Lazy-loading implementation**: Add local state `loadedDetails: Map<string, AgentExecutionDetail>` (key: `${iteration}-${agentName}`). When user clicks "View Execution Detail" button:

```typescript
// In AgentDetailPanel:
const [loadedDetails, setLoadedDetails] = useState<Map<string, AgentExecutionDetail>>(new Map());
const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

async function loadDetail(iteration: number, agentName: string) {
  const key = `${iteration}-${agentName}`;
  if (loadedDetails.has(key)) return; // Already cached
  setLoadingDetail(key);
  const result = await getAgentInvocationDetailAction(runId, iteration, agentName);
  if (result.data) {
    setLoadedDetails(prev => new Map(prev).set(key, result.data!));
  }
  setLoadingDetail(null);
}
```

Render "View Execution Detail" button when `agent.hasExecutionDetail` is true. Show loading spinner during fetch. Render `AgentExecutionDetailView` below existing metrics once loaded. Existing metrics display is unchanged — execution detail is additive.

**TimelineTab props change**: Add optional `initialAgent?: string` prop. This is a **non-breaking** change — existing callers omit the new optional prop and behavior is unchanged.

```typescript
// TimelineTab.tsx — update component signature (currently at line 136):
// BEFORE: export function TimelineTab({ runId }: { runId: string })
// AFTER:
interface TimelineTabProps { runId: string; initialAgent?: string; }
export function TimelineTab({ runId, initialAgent }: TimelineTabProps)
```

In `useEffect`, if `initialAgent` is set, auto-expand all iterations containing that agent and trigger `loadDetail()` for the first match:

```typescript
useEffect(() => {
  if (initialAgent && data) {
    const matchingKeys = data.iterations
      .flatMap(iter => iter.agents.filter(a => a.name === initialAgent)
        .map(a => `${iter.iteration}-${a.name}`));
    setExpandedAgents(new Set(matchingKeys));
    if (matchingKeys.length > 0) {
      const [iterStr, name] = matchingKeys[0].split('-');
      loadDetail(Number(iterStr), name);
    }
  }
}, [initialAgent, data]);
```

**Run detail page wiring** (`run/[runId]/page.tsx`): The page already reads `searchParams.get('agent')` (existing pattern for LogsTab cross-linking, visible at line ~180). Pass it to TimelineTab when `activeTab === 'timeline'`:
```typescript
{activeTab === 'timeline' && <TimelineTab runId={runId} initialAgent={agentParam ?? undefined} />}
```

#### Step 4.4: Add Explorer drill-down
**File**: `src/app/admin/quality/explorer/page.tsx`

In TaskTable (around line 930), make the agent name column a clickable link:

```typescript
<Link href={`/admin/quality/evolution/run/${row.run_id}?tab=timeline&agent=${row.agent_name}`}>
  {row.agent_name}
</Link>
```

This navigates to the run detail page with `tab=timeline&agent=X`, which triggers the auto-expand behavior above.

#### Step 4.5: Tests
- Unit tests for `AgentExecutionDetailView` router (renders correct sub-component)
- Snapshot tests for each detail component with sample data
- Integration test: Timeline expand → fetch → render cycle

---

### Phase 5: Polish & Documentation
**Goal**: Edge cases, docs, verification.

#### Step 5.1: Handle missing/partial data gracefully
- Agents that haven't been instrumented yet → show existing AgentDetailPanel only
- Runs from before this feature → `hasExecutionDetail: false`, no "View Detail" button
- Partial execution detail (agent crashed mid-capture) → render available fields with "incomplete" badge

#### Step 5.2: Update documentation
Update these docs to reflect new execution tracking:
- `docs/evolution/agents/overview.md` — executionDetail pattern in AgentBase
- `docs/evolution/architecture.md` — new data flow diagram
- `docs/evolution/data_model.md` — new table schema
- `docs/evolution/reference.md` — new config/table reference

#### Step 5.3: Manual verification on stage
- Run a full evolution pipeline locally
- Verify invocation records appear in DB for all 12 agents
- Verify TimelineTab drill-down renders correct detail for each agent type
- Verify Explorer drill-down navigates correctly
- Check JSONB sizes are reasonable (< 50KB per invocation typical)

---

## Testing

### Mock Strategy

All evolution tests use the **Supabase chain mock** pattern from `pipeline.test.ts` (lines 17–29):
```typescript
jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  // ... etc
  chain.from = jest.fn().mockReturnValue(chain);
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});
```

New tests for `persistAgentInvocation` and server actions follow this same pattern. Agent-level tests (Phase 2) do NOT mock Supabase — they test the `execute()` method directly and assert the shape of the returned `executionDetail` field.

### Test Fixture Data

Create `src/testing/fixtures/executionDetailFixtures.ts` with sample `AgentExecutionDetail` objects for all 12 agent types. These are used across Phase 2 agent tests, Phase 3 server action tests, and Phase 4 component tests.

```typescript
// Example fixture:
export const generationDetailFixture: GenerationExecutionDetail = {
  detailType: 'generation',
  strategies: [
    { name: 'structural_transform', status: 'success', variantId: 'abc-123', textLength: 1500 },
    { name: 'lexical_simplify', status: 'format_rejected', formatIssues: ['Missing H1 title'] },
    { name: 'grounding_enhance', status: 'error', error: 'LLM timeout' },
  ],
  feedbackUsed: true,
  totalCost: 0.0042,
};
// ... 11 more fixtures, one per agent type
```

### Unit Tests (per phase)

| Phase | Test File | Coverage |
|-------|-----------|----------|
| 1 | `src/lib/evolution/core/pipeline.test.ts` (extend existing) | Add `describe('persistAgentInvocation')` block: upsert logic, non-blocking error handling, truncation, `{}` for missing detail |
| 2.1 | `src/lib/evolution/agents/proximityAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: verify detail shape, newEntrants/diversityScore captured |
| 2.1 | `src/lib/evolution/agents/metaReviewAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: verify all 4 analysis arrays + thresholds |
| 2.2 | `src/lib/evolution/agents/generationAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: per-strategy status, format rejection path, all-fail path |
| 2.2 | `src/lib/evolution/agents/outlineGenerationAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: per-step scores, fallback path, weakestStep |
| 2.3 | `src/lib/evolution/agents/calibrationRanker.test.ts` (extend existing) | Add `describe('executionDetail')`: entrant list, early exit, rating snapshots |
| 2.3 | `src/lib/evolution/agents/tournament.test.ts` (extend existing) | Add `describe('executionDetail')`: budget tier, exit reason, round count |
| 2.4 | `src/lib/evolution/agents/iterativeEditingAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: cycle-level accept/reject/format paths, stop reason |
| 2.4 | `src/lib/evolution/agents/sectionDecompositionAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: section grid, weakness, format valid |
| 2.5 | `src/lib/evolution/agents/reflectionAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: per-variant status, dimension scores |
| 2.5 | `src/lib/evolution/agents/debateAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: full transcript, partial transcript on failure, failurePoint |
| 2.5 | `src/lib/evolution/agents/evolvePool.test.ts` (extend existing) | Add `describe('executionDetail')`: mutation statuses, creative trigger |
| 2.5 | `src/lib/evolution/agents/treeSearchAgent.test.ts` (extend existing) | Add `describe('executionDetail')`: tree result, root selection, addedToPool |
| 3 | `src/lib/services/agentInvocationActions.test.ts` (new, co-located per convention) | Server action queries, type narrowing by `detailType`, null handling |
| 4 | `src/components/evolution/agentDetails/__tests__/AgentExecutionDetailView.test.tsx` (new) | Router renders correct sub-component per `detailType` |

### Integration Tests

**File**: `src/__tests__/integration/evolution-pipeline.integration.test.ts` (extend existing)

Add test using `evolutionTablesExist()` guard pattern (from `src/testing/utils/evolution-test-helpers.ts` line 46):

```typescript
describe('agent invocation persistence', () => {
  beforeAll(async () => {
    const supabase = await createSupabaseServiceClient();
    const tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Skipping: evolution tables not found');
      return;
    }
  });

  it('persists invocation records for each agent in a pipeline run', async () => {
    // Run 1 iteration → verify evolution_agent_invocations rows exist
    // Verify execution_detail JSONB is non-empty for instrumented agents
    // Verify execution_order is sequential (0, 1, 2, ...)
  });
});
```

### Existing Test Impact

**Tests that need mock updates** (specific files):
| Test File | Change Needed | Reason |
|-----------|---------------|--------|
| `src/lib/evolution/core/pipeline.test.ts` | Chain mock already handles `.from().upsert()` at line 23 — **no mock change needed**. Add new `describe('persistAgentInvocation')` test block. | Existing mock resolves upsert to `{ data: null, error: null }`, so `persistAgentInvocation()` calls pass through silently in existing tests. |
| `src/lib/evolution/core/pipelineFlow.test.ts` | **No change needed** — does not call `runAgent()` directly (only tests `runFlowCritiques()`) | Verified: no `runAgent` calls in this file |

**Tests that need NO changes**:
- All 12 agent `.test.ts` files — `executionDetail` is optional on `AgentResult`, existing assertions on `result.success`, `result.costUsd` etc. are unaffected
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — timeline tests use `evolutionTablesExist()` guard and won't break on new table

### Backward Compatibility Test

Add explicit test in `pipeline.test.ts` verifying that an agent returning `AgentResult` WITHOUT `executionDetail` persists `{}` as the JSONB value:

```typescript
it('persists empty detail for agents without executionDetail', async () => {
  const result: AgentResult = { agentType: 'test', success: true, costUsd: 0 };
  await persistAgentInvocation('run-1', 1, 'test', 0, result);
  // Verify upsert called with execution_detail: {}
});
```

---

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/agents/overview.md` - Agent framework docs for executionDetail pattern
- `docs/evolution/architecture.md` - Architecture docs for new data flow
- `docs/evolution/agents/support.md` - Support agent docs for detail tracking
- `docs/evolution/reference.md` - Reference docs for new DB table
- `docs/evolution/agents/generation.md` - Generation agent docs for strategy tracking
- `docs/evolution/agents/editing.md` - Editing agent docs for cycle-level tracking
- `docs/evolution/rating_and_comparison.md` - Rating docs for match-level visibility
- `docs/evolution/agents/tree_search.md` - Tree search docs for beam-level tracking
- `docs/evolution/data_model.md` - Data model docs for evolution_agent_invocations table

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Execution detail JSONB too large | Hard 100KB byte cap with `truncateDetail()`. Per-agent array limits (see JSONB Size Limits above). `_truncated` flag shown in UI. |
| `persistAgentInvocation()` DB write fails | Non-blocking try-catch wrapper. Logs warning, does not prevent checkpoint or pipeline continuation. Execution detail is best-effort telemetry. |
| Performance: extra DB write per agent per iteration | Single INSERT with ON CONFLICT upsert. ~12 inserts per iteration. Negligible vs LLM call latency (~2-30s per agent). |
| Breaking existing agents | `executionDetail` is optional on AgentResult. Agents can be instrumented incrementally. Pipeline persists `{}` for agents without detail. Explicit backward-compat test added. |
| XSS from LLM-generated content in detail views | React JSX auto-escaping. Never use `dangerouslySetInnerHTML`. All LLM content rendered as text in `<code>`/`<pre>` blocks. |
| Checkpoint size unchanged | Execution detail goes to new table, NOT into PipelineState/checkpoints. No checkpoint bloat. |
| Migration on prod | Additive table creation + indexes only. No ALTER on existing tables. Rollback SQL in migration header. Safe to run without downtime. |
| `detailType` vs `agentType` discriminator confusion | `detailType` is a separate field on `AgentExecutionDetail` (string literal). `agentType` on `AgentResult` remains a plain string. No type conflict. |
| UNIQUE constraint with multi-call agents | Current pipeline calls each agent once per iteration. Constraint is `(run_id, iteration, agent_name)`. Future multi-call support would change to `(run_id, iteration, agent_name, execution_order)`. |

## Estimated Scope

| Phase | Files Modified | Files Created | Approximate Complexity |
|-------|---------------|--------------|----------------------|
| Phase 1 | 2 (types.ts, pipeline.ts) | 2 (migration, test) | Low |
| Phase 2 | 12 agent files | 6 test files | Medium-High (bulk of work) |
| Phase 3 | 2 (visualization actions, explorer actions) | 1 test file | Low-Medium |
| Phase 4 | 2 (TimelineTab, Explorer page) | 13 (router + 12 detail components) | Medium |
| Phase 5 | 6 doc files | 0 | Low |

Total: ~20 files modified, ~22 files created.
