# Enable Full Multi-Agent Evolution Pipeline

> **Status**: READY FOR IMPLEMENTATION
> **Purpose**: Enable all evolution agents to run in production, not just generation + calibration

## Root Cause Discovery

**Research finding**: The Timeline only shows "generation" and "calibration" because **those are the only agents that actually execute in production**.

The `_triggerEvolutionRunAction` server action uses `executeMinimalPipeline` with only 2 agents:
```typescript
const agents = [new GenerationAgent(), new CalibrationRanker()];
await executeMinimalPipeline(runId, agents, ctx, evolutionLogger, { startMs });
```

The full pipeline infrastructure exists (`executeFullPipeline` with 8-9 agents) but is only used in tests. This is likely a Slice A/B development pattern where Slice A (minimal) shipped but Slice B (full) was never activated.

## Problem

1. **Admin trigger only runs 2 agents**: Users triggering runs via the admin UI get only generation + calibration
2. **No background processing**: No worker picks up pending runs — all execution is inline via admin trigger
3. **8 agents are scaffolded but unused**: Reflection, IterativeEditing, Debate, Evolution, Tournament, Proximity, MetaReview all exist but never run

## Implementation Plan

### Option A: Upgrade Admin Trigger to Full Pipeline ✅ IN SCOPE

Modify `_triggerEvolutionRunAction` to use `executeFullPipeline` with all agents.

### Option B: Background Worker for Pending Runs (DEFERRED)

Create a cron endpoint that polls for pending runs and executes them with the full pipeline. See **Appendix A** for implementation details if needed later.

**Decision**: Implement Option A only. Option B deferred to future work.

---

## Phase 1: Upgrade Admin Trigger (Option A)

### Files to Modify
- `src/lib/services/evolutionActions.ts`

### Changes

Replace minimal pipeline invocation (around line 310-351) with full pipeline:

```typescript
// BEFORE (minimal - only 2 agents)
const agents = [new GenerationAgent(), new CalibrationRanker()];
await executeMinimalPipeline(runId, agents, ctx, evolutionLogger, { startMs });

// AFTER (full - all 9 agents)
const {
  // ... existing imports ...
  executeFullPipeline,
  GenerationAgent,
  CalibrationRanker,
  Tournament,
  EvolutionAgent,
  ReflectionAgent,
  IterativeEditingAgent,
  DebateAgent,
  ProximityAgent,
  MetaReviewAgent,
} = await import('@/lib/evolution');

const agents: PipelineAgents = {
  generation: new GenerationAgent(),
  calibration: new CalibrationRanker(),
  tournament: new Tournament(),
  evolution: new EvolutionAgent(),
  reflection: new ReflectionAgent(),
  iterativeEditing: new IterativeEditingAgent(),
  debate: new DebateAgent(),
  proximity: new ProximityAgent(),
  metaReview: new MetaReviewAgent(),
};

await executeFullPipeline(runId, agents, ctx, evolutionLogger, {
  startMs,
  featureFlags,
});
```

### Acceptance Criteria
- Admin-triggered runs execute all phase-appropriate agents
- EXPANSION iterations run: generation, calibration, proximity (3 agents)
- COMPETITION iterations run: generation, reflection, iterativeEditing, debate, evolution, tournament, proximity, metaReview (8 agents)
- Checkpoints appear in DB for all agents that execute
- Timeline UI shows all agents (already implemented in visualization code)

---

## Phase 2: Feature Flags Integration

### Files to Modify
- `src/lib/evolution/core/featureFlags.ts` (if not already exporting flag checks)
- `src/lib/services/evolutionActions.ts`

### Changes

The admin trigger should respect feature flags:
- `iterativeEditingEnabled`
- `debateEnabled`
- `evolvePoolEnabled`
- `tournamentEnabled`

Already implemented in `executeFullPipeline` via `options.featureFlags` — just need to fetch and pass.

---

## Original Timeline UI Plan (Phases 4-6)

The original plan for Timeline UI enhancements remains valid. The visualization code (`getEvolutionRunTimelineAction`) was already updated to show all agents — it just had no agents to show because only 2 were running.

With full pipeline enabled, the existing Timeline tab will automatically display all agents.

## Options Considered

### Option A: Enhance Existing Timeline Tab (Recommended)
- Modify `getEvolutionRunTimelineAction` to fetch ALL checkpoints per iteration (not just the last)
- Add checkpoint-diff logic to compute per-agent metrics (variants added, matches played, Elo changes)
- Add timestamp correlation for per-agent-per-iteration cost attribution
- Enhance `TimelineTab` UI with expandable agent rows showing detailed metrics
- **Pros**: No schema changes, incremental improvement, reuses existing UI patterns
- **Cons**: Cost attribution relies on timestamp correlation (may be lossy for concurrent runs)

### Option B: Add Dedicated Agent Execution Table
- Create new `evolution_agent_executions` table to store `AgentResult` after each agent
- Modify pipeline to persist results directly
- Build visualization from structured data
- **Pros**: Clean data model, exact cost/metrics per execution
- **Cons**: Requires migration, pipeline changes, more storage, doesn't help existing runs

### Option C: Persist AgentResult in Checkpoint Snapshot
- Extend `state_snapshot` JSONB to include `lastAgentResult: AgentResult`
- Modify `persistCheckpoint` to include the result
- Extract from checkpoints for visualization
- **Pros**: No new table, available for future runs
- **Cons**: Doesn't help existing runs, increases checkpoint size, mixes concerns

**Decision**: Option A — maximize value from existing data, zero schema changes, works for all historical runs.

## Phased Execution Plan

### Phase 1: Server Action — Fetch All Checkpoints Per Iteration

**Goal**: Modify `getEvolutionRunTimelineAction` to return all agents per iteration instead of just the last one.

**Files to modify**:
- `src/lib/services/evolutionVisualizationActions.ts`

**Changes**:

1. Remove de-duplication logic (lines 214-219) that keeps only last checkpoint per iteration:
```typescript
// REMOVE this de-duplication
const iterationMap = new Map<number, {...}>();
for (const cp of checkpoints ?? []) {
  if (!iterationMap.has(cp.iteration)) {
    iterationMap.set(cp.iteration, cp);
  }
}
```

2. Group checkpoints by iteration, preserving all agents:
```typescript
// NEW: Group all checkpoints per iteration
const iterationGroups = new Map<number, Array<{
  last_agent: string;
  state_snapshot: SerializedPipelineState;
  created_at: string;
}>>();

for (const cp of checkpoints ?? []) {
  const group = iterationGroups.get(cp.iteration) ?? [];
  group.push(cp);
  iterationGroups.set(cp.iteration, group);
}
```

3. Update `TimelineData` type to support multiple agents per iteration (already supports array, just always had 1 element).

**Query changes** (important ordering fix):
```typescript
// Fetch checkpoints with created_at for cost attribution
const { data: checkpoints, error: cpError } = await supabase
  .from('evolution_checkpoints')
  .select('iteration, phase, last_agent, state_snapshot, created_at')  // Include created_at
  .eq('run_id', runId)
  .order('iteration', { ascending: true })
  .order('created_at', { ascending: true });  // ASC for correct execution order within iteration
```

**Acceptance criteria**:
- `iterations[].agents` array contains one entry per agent that ran (3-9 depending on phase)
- Agents are ordered by execution time (`created_at ASC` — earliest first)
- Phase is read from checkpoint `phase` column, not heuristically derived

---

### Phase 2: Server Action — Checkpoint Diffing for Per-Agent Metrics

**Goal**: Compute accurate per-agent metrics by diffing sequential checkpoints within each iteration.

**Files to modify**:
- `src/lib/services/evolutionVisualizationActions.ts`

**New helper function**:
```typescript
interface AgentDiffMetrics {
  variantsAdded: number;
  newVariantIds: string[];
  matchesPlayed: number;
  eloChanges: Map<string, number>; // variantId → delta
  critiquesAdded: number;
  debatesAdded: number;
  diversityScoreAfter: number | null;
  metaFeedbackPopulated: boolean;
}

function diffCheckpoints(
  before: SerializedPipelineState | null,
  after: SerializedPipelineState
): AgentDiffMetrics {
  const beforePool = new Set(before?.pool?.map(v => v.id) ?? []);
  const newVariantIds = after.pool
    .filter(v => !beforePool.has(v.id))
    .map(v => v.id);

  return {
    variantsAdded: newVariantIds.length,
    newVariantIds,
    matchesPlayed: (after.matchHistory?.length ?? 0) - (before?.matchHistory?.length ?? 0),
    eloChanges: computeEloDelta(before?.eloRatings ?? {}, after.eloRatings ?? {}),
    critiquesAdded: (after.allCritiques?.length ?? 0) - (before?.allCritiques?.length ?? 0),
    debatesAdded: (after.debateTranscripts?.length ?? 0) - (before?.debateTranscripts?.length ?? 0),
    diversityScoreAfter: after.diversityScore,
    metaFeedbackPopulated: before?.metaFeedback === null && after.metaFeedback !== null,
  };
}
```

**Integration**:
- For each iteration, sort checkpoints by `created_at`
- First agent diffs against previous iteration's `iteration_complete` checkpoint (or empty baseline for iter 0)
- Each subsequent agent diffs against the previous agent's checkpoint
- Populate `agents[]` array with diff results

**Acceptance criteria**:
- `variantsAdded` reflects actual pool growth by that specific agent
- `matchesPlayed` reflects matches added by that specific agent (only ranking agents)
- Agents that don't modify pool/matches show 0 for those fields
- Skipped agents (no checkpoint row) are detected and marked

---

### Phase 3: Server Action — Per-Iteration Cost Attribution

**Goal**: Attribute LLM costs to specific agents within specific iterations using timestamp correlation.

**Files to modify**:
- `src/lib/services/evolutionVisualizationActions.ts`

**Algorithm**:
```typescript
// 1. Fetch all LLM calls for this run's time window
const { data: llmCalls } = await supabase
  .from('llmCallTracking')
  .select('call_source, estimated_cost_usd, created_at')
  .like('call_source', 'evolution_%')
  .gte('created_at', run.started_at)
  .lte('created_at', run.completed_at)
  .order('created_at', { ascending: true });

// 2. Build checkpoint time boundaries
const boundaries: Array<{ iteration: number; agent: string; startTime: string; endTime: string }> = [];
// ... populate from checkpoint created_at values

// 3. Attribute each call to the appropriate iteration+agent
for (const call of llmCalls) {
  const boundary = boundaries.find(b =>
    call.created_at >= b.startTime &&
    call.created_at < b.endTime &&
    call.call_source.includes(b.agent)
  );
  if (boundary) {
    costMap.get(`${boundary.iteration}-${boundary.agent}`)?.add(call.estimated_cost_usd);
  }
}
```

**Edge cases**:
- Calls before first checkpoint: attribute to iteration 0, first agent
- Calls matching agent name but outside time window: skip (likely from concurrent run)
- Concurrent runs warning: log if detected, proceed with best-effort attribution

**Acceptance criteria**:
- `agents[].costUsd` reflects per-iteration cost for that agent
- Sum of all agent costs ≈ total run cost (within rounding)
- Concurrent run overlap is detected and logged

---

### Phase 4: UI — Expandable Agent Rows in Timeline

> **Dependency**: Phase 5 (type updates) should be implemented first since UI depends on extended `TimelineData` type.

**Goal**: Show all agents per iteration with expandable detail rows.

**Files to modify**:
- `src/components/evolution/tabs/TimelineTab.tsx`

**UI Changes**:

1. **Iteration header with summary**:
```tsx
<div className="flex items-center justify-between mb-3">
  <div className="flex items-center gap-2">
    <span className="text-sm font-semibold">Iteration {iter.iteration}</span>
    <PhaseIndicator phase={iter.phase} ... />
  </div>
  <div className="text-xs text-[var(--text-muted)]">
    {iter.agents.length} agents • +{totalVariants} variants • ${totalCost.toFixed(3)}
  </div>
</div>
```

2. **Agent row with expand toggle** (reuse VariantsTab pattern):
```tsx
{iter.agents.map((agent, j) => (
  <div key={`${iter.iteration}-${agent.name}`} data-testid={`iteration-${iter.iteration}`}>
    <div
      className="flex items-center justify-between text-xs bg-[var(--surface-secondary)] rounded-page px-3 py-2 cursor-pointer"
      onClick={() => toggleExpand(iter.iteration, agent.name)}
      data-testid={`agent-row-${agent.name}`}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-1 h-4 rounded-full"
          style={{ backgroundColor: STRATEGY_PALETTE[agent.name] ?? 'var(--text-muted)' }}
        />
        <span className="font-mono">{agent.name}</span>
        {agent.skipped && <span className="text-[var(--status-warning)]">(skipped)</span>}
      </div>
      <div className="flex items-center gap-4">
        <span>+{agent.variantsAdded} variants</span>
        <span>{agent.matchesPlayed} matches</span>
        <span className="font-mono">${agent.costUsd.toFixed(3)}</span>
        <button className="text-[var(--accent-gold)]">
          {isExpanded ? 'Hide' : 'Details'}
        </button>
      </div>
    </div>

    {/* Expanded detail panel */}
    {isExpanded && (
      <AgentDetailPanel agent={agent} />
    )}
  </div>
))}
```

3. **AgentDetailPanel component** (new):
```tsx
function AgentDetailPanel({ agent }: { agent: TimelineAgent }) {
  return (
    <div className="mt-1 p-3 bg-[var(--surface-elevated)] rounded-page border border-[var(--border-default)]">
      {/* Metrics grid */}
      <div className="grid grid-cols-4 gap-4 text-xs mb-3">
        <div>
          <div className="text-[var(--text-muted)]">Variants Added</div>
          <div className="font-mono">{agent.variantsAdded}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Matches Played</div>
          <div className="font-mono">{agent.matchesPlayed}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Cost</div>
          <div className="font-mono">${agent.costUsd.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Diversity After</div>
          <div className="font-mono">{agent.diversityScoreAfter?.toFixed(2) ?? '—'}</div>
        </div>
      </div>

      {/* New variants list (if any) */}
      {agent.newVariantIds.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-[var(--text-muted)] mb-1">New Variants</div>
          <div className="flex flex-wrap gap-1">
            {agent.newVariantIds.map(id => (
              <span key={id} className="px-2 py-0.5 bg-[var(--surface-secondary)] rounded text-xs font-mono">
                {id.substring(0, 8)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error message (if any) */}
      {agent.error && (
        <div className="mt-2 text-xs text-[var(--status-error)]">
          Error: {agent.error}
        </div>
      )}
    </div>
  );
}
```

**Acceptance criteria**:
- All agents that ran in an iteration are visible (not just the last one)
- Each agent row shows inline summary metrics
- Clicking expands to show detailed metrics and new variant IDs
- Skipped agents are marked but still shown in expected position
- Strategy colors provide visual differentiation

---

### Phase 5: Update TimelineData Type

**Goal**: Extend the type to support new per-agent fields.

**Files to modify**:
- `src/lib/services/evolutionVisualizationActions.ts` (type definition)

**Updated type** (all new fields are optional for backward compatibility):
```typescript
export interface TimelineData {
  iterations: {
    iteration: number;
    phase: PipelinePhase;
    agents: {
      name: string;
      costUsd: number;
      variantsAdded: number;
      newVariantIds?: string[];              // NEW (optional)
      matchesPlayed: number;
      eloChanges?: Record<string, number>;   // NEW: variantId → delta (optional)
      critiquesAdded?: number;               // NEW (optional)
      debatesAdded?: number;                 // NEW (optional)
      diversityScoreAfter?: number | null;   // NEW (optional)
      metaFeedbackPopulated?: boolean;       // NEW (optional)
      strategy?: string;
      error?: string;
      skipped?: boolean;                     // NEW (optional)
      executionOrder?: number;               // NEW: 0-based position (optional)
    }[];
    totalCostUsd?: number;                   // NEW: sum of agent costs (optional)
    totalVariantsAdded?: number;             // NEW: sum of variants (optional)
    totalMatchesPlayed?: number;             // NEW: sum of matches (optional)
  }[];
  phaseTransitions: { afterIteration: number; reason: string }[];
}
```

**Backward compatibility**: All new fields are optional with `?`. Existing consumers that only read `name`, `costUsd`, `variantsAdded`, `matchesPlayed` will continue to work.

---

## Testing

### Unit Tests — Server Action

**File**: `src/lib/services/evolutionVisualizationActions.test.ts` (colocated, no `__tests__` subfolder per project convention)

1. **Checkpoint diffing logic**:
   - Test `diffCheckpoints()` with mock before/after snapshots
   - Verify pool delta calculation (use `createTestCheckpoint()` from evolution-test-helpers)
   - Verify match history delta calculation
   - Test edge case: first iteration (null before)
   - Test edge case: agent has checkpoint but no state changes (0 deltas)

2. **Cost attribution logic**:
   - Test timestamp boundary detection
   - Test call attribution to correct agent
   - Test concurrent run detection (overlapping time windows)
   - Test calls outside checkpoint windows (unattributed)

3. **Timeline data assembly**:
   - Test multiple agents per iteration
   - Test phase transition detection (from checkpoint `phase` column)
   - Test EXPANSION vs COMPETITION agent counts

### Unit Tests — UI Component

**File**: `src/components/evolution/tabs/TimelineTab.test.tsx` (new)

1. **Expandable row behavior**:
```typescript
describe('TimelineTab expandable rows', () => {
  it('expands agent detail when row is clicked', async () => {
    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => screen.getByTestId('timeline-tab'));

    const agentRow = screen.getByText('generation').closest('div');
    fireEvent.click(agentRow!);

    expect(screen.getByText('Variants Added')).toBeInTheDocument();
  });

  it('collapses agent detail when clicked again', async () => {
    // ... expand then collapse, verify panel hidden
  });

  it('allows multiple agents expanded simultaneously', async () => {
    // ... expand two agents, verify both panels visible
  });
});
```

2. **AgentDetailPanel rendering**:
```typescript
describe('AgentDetailPanel', () => {
  const mockAgent = {
    name: 'generation',
    costUsd: 0.0234,
    variantsAdded: 3,
    newVariantIds: ['abc-123', 'def-456', 'ghi-789'],
    matchesPlayed: 0,
    diversityScoreAfter: 0.73,
  };

  it('renders metrics grid with all fields', () => {
    render(<AgentDetailPanel agent={mockAgent} />);
    expect(screen.getByText('$0.0234')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('0.73')).toBeInTheDocument();
  });

  it('renders newVariantIds as short IDs', () => {
    render(<AgentDetailPanel agent={mockAgent} />);
    expect(screen.getByText('abc-123')).toBeInTheDocument();
  });

  it('displays error message when agent.error is present', () => {
    const errorAgent = { ...mockAgent, error: 'Budget exceeded' };
    render(<AgentDetailPanel agent={errorAgent} />);
    expect(screen.getByText(/Budget exceeded/)).toBeInTheDocument();
  });

  it('handles null diversityScoreAfter gracefully', () => {
    const nullDiversityAgent = { ...mockAgent, diversityScoreAfter: null };
    render(<AgentDetailPanel agent={nullDiversityAgent} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

3. **Iteration summary**:
```typescript
describe('TimelineTab iteration summary', () => {
  it('displays agent count, total variants, total cost in header', async () => {
    render(<TimelineTab runId="test-run-id" />);
    await waitFor(() => screen.getByText(/3 agents/)); // EXPANSION iteration
    expect(screen.getByText(/\+6 variants/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.05/)).toBeInTheDocument();
  });
});
```

### Integration Tests

**File**: `src/__tests__/integration/evolution-visualization.integration.test.ts`

1. Add test for `getEvolutionRunTimelineAction` with real checkpoint data
2. Verify all agents appear for COMPETITION iterations (use existing `createTestCheckpoint()` factory)
3. Verify cost attribution matches Budget tab totals (may be slightly lossy for concurrent runs — document tolerance)

### E2E Tests

**File**: `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` (update existing)

```typescript
test.describe('Timeline Tab - Per-Agent Detail', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin (use existing auth helper)
    await loginAsAdmin(page);

    // Navigate to a completed evolution run
    // Use [TEST] prefixed run seeded by test fixtures
    await page.goto('/admin/quality/evolution');
    await page.click('text=[TEST] Evolution Run');
  });

  test('displays all agents per iteration', async ({ page }) => {
    await page.click('[data-testid="tab-timeline"]');

    // EXPANSION iteration should show 3 agents
    const expansionIteration = page.locator('[data-testid="iteration-0"]');
    await expect(expansionIteration.locator('[data-testid="agent-row"]')).toHaveCount(3);

    // COMPETITION iteration should show 8-9 agents
    const competitionIteration = page.locator('[data-testid="iteration-5"]');
    await expect(competitionIteration.locator('[data-testid="agent-row"]')).toHaveCount({ min: 8, max: 9 });
  });

  test('expands agent detail panel on click', async ({ page }) => {
    await page.click('[data-testid="tab-timeline"]');
    await page.click('[data-testid="agent-row-generation"]');

    await expect(page.locator('[data-testid="agent-detail-panel"]')).toBeVisible();
    await expect(page.locator('text=Variants Added')).toBeVisible();
    await expect(page.locator('text=Cost')).toBeVisible();
  });

  test('shows correct per-agent metrics', async ({ page }) => {
    await page.click('[data-testid="tab-timeline"]');
    await page.click('[data-testid="agent-row-generation"]');

    // Generation should show variants added > 0
    const variantsAdded = await page.locator('[data-testid="metric-variants-added"]').textContent();
    expect(parseInt(variantsAdded ?? '0')).toBeGreaterThan(0);

    // Generation should show matches played = 0
    const matchesPlayed = await page.locator('[data-testid="metric-matches-played"]').textContent();
    expect(matchesPlayed).toBe('0');
  });

  test('per-agent costs sum to total run cost (within tolerance)', async ({ page }) => {
    await page.click('[data-testid="tab-timeline"]');

    // Sum all agent costs from timeline
    const agentCosts = await page.locator('[data-testid^="agent-cost-"]').allTextContents();
    const totalFromAgents = agentCosts.reduce((sum, c) => sum + parseFloat(c.replace('$', '')), 0);

    // Compare to Budget tab total
    await page.click('[data-testid="tab-budget"]');
    const totalCost = await page.locator('[data-testid="total-cost"]').textContent();
    const expectedTotal = parseFloat(totalCost?.replace('$', '') ?? '0');

    // Allow 5% tolerance for rounding
    expect(totalFromAgents).toBeCloseTo(expectedTotal, 1);
  });
});
```

**Test data seeding**: Uses existing `createTestEvolutionRun()` and `createTestCheckpoint()` factories from `src/testing/utils/evolution-test-helpers.ts`. Seed data prefixed with `[TEST]` per `testing_overview.md` convention for E2E discovery filtering.

### Manual Verification (Staging)

1. Deploy to staging via standard PR preview
2. Run a full evolution pipeline on staging (or use existing completed run)
3. Navigate to `/admin/quality/evolution/run/[runId]`
4. Verify Timeline tab shows:
   - All 9 agents for COMPETITION iterations
   - 3 agents for EXPANSION iterations
   - Per-agent costs that sum to total (within rounding)
   - Expandable detail panels work
5. Cross-check with Budget tab totals
6. Test with run that has skipped agents (feature flags off)

### Rollback Plan

The changes are additive and isolated:
- **Server action**: Revert `getEvolutionRunTimelineAction` to previous version (single commit)
- **UI component**: Revert `TimelineTab.tsx` (same commit or separate)
- **Types**: Optional fields are backward compatible — no action needed

No database migrations, no pipeline changes — rollback is a simple git revert.

---

## Documentation Updates

### Files to Update

1. **`docs/feature_deep_dives/evolution_pipeline_visualization.md`**
   - Update TimelineTab description
   - Document new per-agent metrics
   - Add example screenshots
   - Document expandable UI pattern

2. **`docs/docs_overall/architecture.md`**
   - No changes needed (architecture unchanged)

### New Sections to Add

In `evolution_pipeline_visualization.md`:

```markdown
### Timeline Tab - Per-Agent Detail

The Timeline tab shows all agents that executed in each iteration, not just the last one.
For EXPANSION iterations, this includes Generation, Calibration, and Proximity.
For COMPETITION iterations, this includes up to 9 agents.

**Metrics shown per agent**:
- Variants added (pool growth)
- Matches played (for ranking agents)
- Cost in USD
- Diversity score after execution
- New variant IDs (expandable)

**Cost attribution**: Uses timestamp correlation between LLM calls and checkpoint boundaries.
May be imprecise for concurrent runs (logged warning).

**Expandable detail**: Click any agent row to see full metrics including new variant IDs
and error messages.
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Checkpoint query returns too much data | Low | Medium | Limit to specific run, add pagination if needed |
| Cost attribution imprecise for concurrent runs | Medium | Low | Log warning, document limitation, consider run_id FK later |
| UI becomes cluttered with 9 agents per iteration | Low | Low | Collapse by default, show summary in header |
| Diff logic incorrect for edge cases | Low | Medium | Comprehensive unit tests for all edge cases |

---

## Success Metrics

1. **Visibility**: All agents visible per iteration (not just last one)
2. **Accuracy**: Per-agent metrics match actual agent output (validate via logging)
3. **Usability**: Users can identify problematic agents/iterations in < 30 seconds
4. **Performance**: Timeline loads in < 2 seconds for runs with 15 iterations

---

# Appendix A: Background Worker Cron (DEFERRED)

> **Status**: Out of scope for current implementation. Code exists but is not configured to run.

This appendix documents the background cron runner that was prototyped but deferred. The code exists at `src/app/api/cron/evolution-runner/route.ts` with tests, but no trigger is configured.

## Design

```typescript
// Evolution runner cron — picks up pending runs and executes full pipeline.
// Designed to be called by Vercel cron or GitHub Actions every N minutes.

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Verify cron secret
  // 2. Query for oldest pending run (FIFO)
  // 3. Claim run (update status to 'claimed', set runner_id)
  // 4. Execute full pipeline
  // 5. Mark completed/failed
  // 6. Return status
}
```

## Key Features
- **Single run per invocation**: Process one run to avoid timeout issues
- **Claim before execute**: Prevents concurrent runners from picking same run
- **Heartbeat**: Update `last_heartbeat` during execution for watchdog compatibility
- **Resume support**: Use checkpoint to resume interrupted runs

## To Enable (Future Work)

1. Add `CRON_SECRET` to production environment
2. Configure trigger via one of:
   - **Vercel Cron**: Add to `vercel.json`:
     ```json
     { "crons": [{ "path": "/api/cron/evolution-runner", "schedule": "*/5 * * * *" }] }
     ```
   - **GitHub Actions**: Create scheduled workflow calling the endpoint
   - **External service**: cron-job.org, Upstash, AWS EventBridge

## Existing Files
- `src/app/api/cron/evolution-runner/route.ts` — Implementation
- `src/app/api/cron/evolution-runner/route.test.ts` — 11 unit tests
- `.env.example` — `CRON_SECRET` documented
