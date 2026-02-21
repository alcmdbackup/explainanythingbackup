# Minor Fixes Evolution Plan

## Background
This project addresses several minor fixes and enhancements to the evolution pipeline dashboard UI. Issues include dropdown menus appearing behind cards on the Explorer tab, missing strategy information in run detail views, stale cost displays that don't update on refresh, and lack of real-time budget tracking. It also adds run duration tracking, budget allocation editing when creating strategies, and improved strategy detail views.

## Requirements (from GH Issue #428)
- Dropdowns menus on explorer tab in evolution dash appear behind cards
- Evolution run details view should clearly display strategy being used and link to strategy details
- All costs should update in real time on page refresh. Specifically cost at top of evolution run tab (0/$5.00) does not update in real time.
- In run detail screen, should be able to see cost applied against each budget constraint, in real time
- Track how long a run has been running, on evolution tab overview. Should update in realtime.
- Allow editing budget allocation for each agent when creating a strategy
- Strategies detail screen should show detailed budget allocation

## Problem
The evolution dashboard UI has several gaps. Dropdown menus on the Explorer tab render behind cards due to CSS stacking context issues. The run detail view fetches `strategy_config_id` but never displays it. Cost data (`total_cost_usd`) is only written to DB at pipeline completion, so the "$0.00/$5.00" header stays stale during execution — even though real-time cost data exists in `llmCallTracking`. Run duration timestamps (`started_at`, `completed_at`) are fetched but never rendered. The strategy creation form only exposes one budget cap (generation %) out of 11 possible agents. Strategy detail views show truncated 4-character badge labels without showing which agents are enabled.

## Options Considered

### Req 1 — Explorer dropdown z-index
- **Option A (chosen): Add higher z-index to filter Card.** Set `z-[100]` or `style={{ zIndex: 100 }}` on the filter Card containing the dropdowns. This is the simplest fix — the filter card renders above subsequent cards, and the dropdown's `z-50` works within that elevated context.
- **Option B: Portal-based rendering.** Extract SearchableMultiSelect dropdown into a Portal (like Radix Select does). More robust but heavier — requires computing trigger position, handling scroll, and managing focus. Overkill for an admin-only page with known card layout.
- **Option C: Replace with Radix Popover.** Rewrite SearchableMultiSelect using Radix primitives. Best long-term but scope creep for a bug fix.

### Req 2 — Strategy display in run detail
- **Option A (chosen): Fetch strategy inline and display with link.** After loading the run, call `getStrategyDetailAction(run.strategy_config_id)` to get the strategy name/label. Display it in the header with a link to `/admin/quality/strategies`. Simple, uses existing server action.
- **Option B: Batch enrichment pattern.** Use the `unifiedExplorerActions.ts` pattern (batch fetch strategy labels via `.in()` query). Better for lists but unnecessary for a single run detail page.

### Req 3 — Real-time cost updates
- **Option A (chosen): Write `total_cost_usd` at checkpoints + add polling to run detail.** Two changes: (1) Add optional `totalCostUsd` param to `persistCheckpoint`/`persistCheckpointWithSupervisor` and pass `ctx.costTracker.getTotalSpent()` at all callsites (7 total), so the DB has up-to-date cost during execution. (2) Create a lightweight `getEvolutionRunByIdAction(runId)` (single-row fetch) and use it for 5s polling on the run detail page when the run is active. This gives real-time cost in the header without touching `llmCallTracking`.
- **Option B: Query `llmCallTracking` for header cost.** Create a new action that sums costs from `llmCallTracking` by time window for the header display. More accurate but adds a new query path when the checkpoint approach gives us "good enough" real-time data (updates after each agent, ~30-60s intervals).

### Req 4 — Per-agent budget constraint display
- **Option A (chosen): Add budget cap bars to BudgetTab's AgentBarChart.** Extend the existing `agentBreakdown` data to include the configured cap for each agent. The `getEvolutionRunBudgetAction` already returns agent costs — add a `budgetCap` field from the run's resolved config. Render as a horizontal bar chart where each agent shows actual spend vs cap. Add auto-refresh (same 5s polling as LogsTab) when the run is active.
- **Option B: Separate budget constraint table.** Add a standalone table showing all agent caps, spend, and remaining. More verbose but useful for detailed tracking. Could do this in addition to the bar chart.

### Req 5 — Run duration tracking
- **Option A (chosen): Add elapsed time column to run tables + client-side timer.** Display a computed "elapsed" column in both the dashboard overview and evolution runs table. For active runs, use `started_at` with a client-side `setInterval` (1s) to tick the display. For completed runs, show `completed_at - started_at`. The dashboard already has `AutoRefreshProvider` (15s) to keep the data fresh; the client-side timer handles second-level UI updates between refreshes.
- **Option B: Server-computed duration.** Add a `duration_seconds` computed column or RPC. Unnecessary — client can compute from existing timestamps.

### Req 6 — Budget allocation editing in strategy creation
- **Option A (chosen): Expand FormState to include per-agent budget caps.** Replace the single `budgetCap: number` with `budgetCaps: Record<string, number>` in FormState. Render an input for each agent in the enabled agents list. Initialize from `DEFAULT_EVOLUTION_CONFIG.budgetCaps`. Update `formToConfig()` to pass the full object. Update `rowToForm()` to load all caps when editing. Show the redistribution preview alongside.
- **Option B: Slider-based proportional allocation.** Range sliders with a "total" indicator. More visual but complex to implement correctly (normalization, min values, etc.).

### Req 7 — Strategy detail budget display
- **Option A (chosen): Improve StrategyConfigDisplay with full agent names + enabled indicators.** Replace 4-char truncated labels with full agent names. Add visual indicators for enabled/disabled agents (based on `enabledAgents`). Show the effective (redistributed) budget alongside the base budget. Keep the badge chip layout but with better labels.
- **Option B: Table layout.** Full table with columns: Agent, Base %, Effective %, Enabled. More detailed but may not fit the 3-column layout.

## Phased Execution Plan

### Phase 1: CSS Fix + Strategy Display (Reqs 1, 2)
Quick wins — no backend changes.

**Req 1 — Explorer dropdown z-index fix:**
- File: `src/app/admin/quality/explorer/page.tsx`
- Add `style={{ zIndex: 100, position: 'relative' }}` to the filter Card (line 582)
- This elevates the entire filter card above subsequent StatCards and table cards
- The dropdown's existing `z-50` then works correctly within this elevated context

**Req 2 — Strategy display in run detail:**
- File: `src/app/admin/quality/evolution/run/[runId]/page.tsx`
- Add state: `const [strategy, setStrategy] = useState<StrategyConfigRow | null>(null)`
- Add useEffect: when `run?.strategy_config_id` is set, call `getStrategyDetailAction(id)` and set state
- Add to header (after PhaseIndicator, ~line 244): strategy name badge with Link to `/admin/quality/strategies`
- Import `getStrategyDetailAction` from `strategyRegistryActions` and `StrategyConfigRow` from `strategyConfig`

**Tests:**
- Unit: None needed (UI-only changes, existing component tests cover rendering)
- Manual: Open Explorer, verify dropdowns appear above cards. Open run detail, verify strategy name + link.

### Phase 2: Real-Time Costs (Reqs 3, 4)
Backend + frontend changes for live cost tracking.

**Req 3 — Write cost at checkpoints + polling:**

Backend — `src/lib/evolution/core/pipeline.ts`:

The `persistCheckpoint` function (line 28) has signature `(runId, state, agentName, phase, logger, maxRetries=3)`. It creates its own Supabase client internally via `createSupabaseServiceClient()`. The `persistCheckpointWithSupervisor` function (line 1216) has a similar pattern with signature `(runId, state, supervisor, phase, logger)`.

**Approach: Add optional `totalCostUsd` param to both checkpoint functions.** All callsites already have access to `ctx: ExecutionContext` which includes `ctx.costTracker: CostTracker` (types.ts:351), so no deep parameter threading is needed.

Changes:
- Add `totalCostUsd?: number` as optional last param to `persistCheckpoint` (after `maxRetries`):
  ```typescript
  async function persistCheckpoint(
    runId: string, state: PipelineState, agentName: string,
    phase: PipelinePhase, logger: EvolutionLogger,
    maxRetries = 3, totalCostUsd?: number,
  ): Promise<void> {
  ```
- In the DB update (line 51-56), spread the cost conditionally:
  ```typescript
  supabase.from('evolution_runs').update({
    current_iteration: state.iteration,
    phase,
    last_heartbeat: new Date().toISOString(),
    runner_agents_completed: state.pool.length,
    ...(totalCostUsd != null && { total_cost_usd: totalCostUsd }),
  }).eq('id', runId),
  ```
- Add same `totalCostUsd?: number` param to `persistCheckpointWithSupervisor` (line 1216) and update its DB write similarly
- Update all 7 callsites to pass `ctx.costTracker.getTotalSpent()`:
  - `runAgent` (lines 1175, 1182, 1203): has `ctx` param → pass `3, ctx.costTracker.getTotalSpent()`
  - `executeMinimalPipeline` (lines 743, 746): has `ctx` → pass `3, ctx.costTracker.getTotalSpent()`
  - `executeFullPipeline` flowCritique (line 948): has `ctx` → pass `3, ctx.costTracker.getTotalSpent()`
  - `executeFullPipeline` supervisor (line 1006): update `persistCheckpointWithSupervisor` call to include cost

**Existing callsites that don't pass `maxRetries` continue to work unchanged** — only add the 7th arg where we want cost written.

Frontend — `src/app/admin/quality/evolution/run/[runId]/page.tsx`:

**New action needed:** The existing `getEvolutionRunsAction()` fetches all 50 runs (`select('*').limit(50)`) — too heavy for 5s polling. Create a lightweight `getEvolutionRunByIdAction(runId: string)` in `evolutionActions.ts` that fetches a single run:
```typescript
export async function getEvolutionRunByIdAction(runId: string): Promise<ActionResult<EvolutionRun>> {
  await requireAdmin();
  const supabase = await createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('evolution_runs')
    .select('*')
    .eq('id', runId)
    .single();
  if (error) return { success: false, data: null, error };
  return { success: true, data, error: null };
}
```

- Add auto-refresh when run is active using the lightweight action:
  ```typescript
  useEffect(() => {
    const isActive = run?.status === 'running' || run?.status === 'claimed';
    if (!isActive) return;
    const interval = setInterval(async () => {
      const result = await getEvolutionRunByIdAction(runId);
      if (result.success && result.data) setRun(result.data);
    }, 5000);
    return () => clearInterval(interval);
  }, [run?.status, runId]);
  ```

**Req 4 — Per-agent budget display in BudgetTab:**

Server action — `src/lib/services/evolutionVisualizationActions.ts`:
- In `getEvolutionRunBudgetAction()` (~line 687), expand the select to include `config` and `status`:
  ```typescript
  .select('started_at, completed_at, budget_cap_usd, cost_estimate_detail, cost_prediction, config, status')
  ```
- From `config`, extract `budgetCaps` and `budgetCapUsd` to compute per-agent dollar caps
- Add to the `BudgetData` return type:
  - `agentBudgetCaps: Record<string, number>` — dollar amounts per agent
  - `runStatus: string` — the run's current status (used by BudgetTab for auto-refresh, avoids adding a new prop)
- Apply `computeEffectiveBudgetCaps()` using the config's `enabledAgents` and `singleArticle` to get effective percentages, then multiply by `budgetCapUsd`
- **Existing test impact:** The 3 existing test files mock `getEvolutionRunBudgetAction`. Add `agentBudgetCaps: {}` and `runStatus: 'completed'` to `baseBudgetData` in test mock — additive change, existing assertions still pass

Frontend — `src/components/evolution/tabs/BudgetTab.tsx`:
- **No new props needed.** BudgetTab gets `runStatus` from the budget action's return data
- Extend the `AgentBarChart` to show budget cap as a reference line or background bar per agent
- Add a simple table below: Agent | Spent | Cap | Remaining | % Used
- Add auto-refresh for active runs using `runStatus` from the budget data:
  ```typescript
  useEffect(() => {
    if (!data) return;
    const isActive = data.runStatus === 'running' || data.runStatus === 'claimed';
    if (!isActive) return;
    const interval = setInterval(() => load(), 5000);
    return () => clearInterval(interval);
  }, [data?.runStatus]);
  ```
- **Existing test impact:** All 4 BudgetTab tests continue to work — no prop change, just new optional fields in mock data

**Tests:**

`persistCheckpoint` is module-private (not exported) — can't unit test directly. Testing strategy:
- **Pipeline integration test** (`pipeline.test.ts`): Test via `executeMinimalPipeline` with a mocked Supabase. Verify the `evolution_runs.update()` call includes `total_cost_usd` field by inspecting the mock's `.update()` arguments after a checkpoint write. The existing test infrastructure already mocks `createSupabaseServiceClient`.
- **`getEvolutionRunByIdAction` unit test** (`evolutionActions.test.ts`): New action, straightforward mock — verify single-row `.eq('id', runId).single()` query pattern.
- **`getEvolutionRunBudgetAction` test updates** (`evolutionVisualizationActions.test.ts`): Update existing mock chain to include `config` and `status` in the select result. Add test case verifying `agentBudgetCaps` computation from config data. Existing 3 tests need `agentBudgetCaps: {}` and `runStatus: 'completed'` added to mock data — additive, non-breaking.
- **BudgetTab test updates** (`BudgetTab.test.tsx`): Add `agentBudgetCaps: {}` and `runStatus: 'completed'` to `baseBudgetData` mock. Add new test for auto-refresh interval (verify `setInterval`/`clearInterval` via jest.useFakeTimers). Existing 4 tests unchanged in structure — just enriched mock data.
- Manual: Start a run, open run detail, verify cost updates in header every ~5s. Open BudgetTab, verify per-agent bars update and show caps.

### Phase 3: Run Duration + Strategy Budget Editing (Reqs 5, 6)
Frontend-heavy, no schema changes.

**Req 5 — Run duration tracking:**

Shared utility — create `src/components/evolution/ElapsedTime.tsx`:
```typescript
// Client component that shows elapsed time with live ticking for active runs
export function ElapsedTime({ startedAt, completedAt, status }: {
  startedAt: string | null;
  completedAt: string | null;
  status: string;
}) {
  // For active runs: tick every second using startedAt
  // For completed runs: show completedAt - startedAt
  // For pending: show "--"
}
```

Dashboard overview — `src/app/admin/evolution-dashboard/page.tsx`:
- Add "Duration" column to the Recent Runs table (after Cost, before Created)
- Use `ElapsedTime` component with `run.started_at`, `run.completed_at`, `run.status`
- Data already available in `DashboardRun` type

Evolution runs page — `src/app/admin/quality/evolution/page.tsx`:
- Add "Duration" column to the runs table (after Budget, before Created)
- Use same `ElapsedTime` component
- `EvolutionRun` type already has `started_at` and `completed_at`

**Req 6 — Budget allocation editing in strategy form:**

Form state — `src/app/admin/quality/strategies/page.tsx`:
- Replace `budgetCap: number` with `budgetCaps: Record<string, number>` in `FormState`
- Update `EMPTY_FORM` to initialize from `DEFAULT_EVOLUTION_CONFIG.budgetCaps` (all 11 agents)
- Remove the single "Budget Cap (generation %)" input (lines 417-430)
- Add a budget editing section (after agent checkboxes):
  ```
  Budget Allocation
  [For each agent in REQUIRED_AGENTS + form.enabledAgents]:
    agent_name: [input type=number min=0.01 max=1 step=0.01] %
  ```
- Only show inputs for agents that are currently enabled (required + selected optional)
- Show the redistributed preview alongside (already computed via `computeEffectiveBudgetCaps`)

Config conversion — same file:
- Update `formToConfig()` (~line 705):
  ```typescript
  const formToConfig = (form: FormState): StrategyConfig => ({
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    budgetCaps: form.budgetCaps,  // pass full object
    enabledAgents: form.enabledAgents as AgentName[],
    singleArticle: form.singleArticle || undefined,
  });
  ```
- Update `rowToForm()` (~line 801): Load all budget caps from `row.config.budgetCaps`, merge with defaults for any missing agents (handles old strategies that only have generation/calibration/tournament caps):
  ```typescript
  budgetCaps: { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps, ...row.config.budgetCaps }
  ```
- Add validation in `formToConfig()`: Ensure each budget cap is between 0.01 and 1.0, and warn if total exceeds 1.0 (not a hard block — redistribution handles normalization)

**Tests:**
- Unit: `ElapsedTime.test.tsx` — verify ticking for active (jest.useFakeTimers + advanceTimersByTime), static for completed, "--" for pending. This is a small focused client component, testable with React Testing Library.
- Strategy form testing: The strategies page is a `'use client'` component — admin UI component tests are blocked (per project memory). **Testing approach:**
  - Extract `formToConfig` and `rowToForm` as standalone exported pure functions (or co-locate in a `strategyFormUtils.ts` file) so they can be unit tested independently
  - Unit test: `formToConfig` passes full `budgetCaps` record (not hardcoded subset), `rowToForm` loads all caps with default merging
  - Contract test (optional): Verify `createStrategyAction` receives correct config shape via mock
- Manual: Check duration column ticks in real-time on dashboard. Create strategy with custom budget allocation, verify it saves correctly.

### Phase 4: Strategy Detail Display (Req 7)
UI improvement only.

**Req 7 — Improve StrategyConfigDisplay:**

File: `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx`
- Replace truncated 4-char labels with full agent names using `AGENT_LABELS` map (already used in strategies page)
- Import `AGENT_LABELS` or define locally
- Add `enabledAgents` display: show which agents are enabled/disabled with visual indicators
- Show effective budget (post-redistribution) alongside base budget:
  - Import `computeEffectiveBudgetCaps` from `budgetRedistribution`
  - Compute effective caps from `config.budgetCaps`, `config.enabledAgents`, `config.singleArticle`
  - Display: `agent_name: base% → effective%` or just effective if same
- Add `singleArticle` indicator if set
- Defensive rendering: merge `config.budgetCaps` with `DEFAULT_EVOLUTION_CONFIG.budgetCaps` to handle configs missing some agents

Also update StrategyDetailRow in `strategies/page.tsx`:
- Replace raw JSON display with `StrategyConfigDisplay` component (reuse instead of `JSON.stringify`)
- Or add a "Budget" section above the JSON showing the formatted allocation

**Tests:**
- Unit: StrategyConfigDisplay — verify full agent names, enabled/disabled indicators, effective budget calculation
- Manual: Open strategy detail, verify readable budget allocation with full names and redistribution preview.

## Testing

### Unit Tests
| Phase | Test | File | Notes |
|-------|------|------|-------|
| 2 | Pipeline checkpoint includes total_cost_usd | `src/lib/evolution/core/pipeline.test.ts` | Integration-level: test via executeMinimalPipeline, verify Supabase mock `.update()` args |
| 2 | getEvolutionRunByIdAction fetches single run | `src/lib/services/evolutionActions.test.ts` | New action, straightforward mock |
| 2 | getEvolutionRunBudgetAction returns agentBudgetCaps + runStatus | `src/lib/services/evolutionVisualizationActions.test.ts` | Update existing mocks to include `config`, `status` fields |
| 2 | BudgetTab auto-refresh for active runs | `src/components/evolution/tabs/BudgetTab.test.tsx` | Update `baseBudgetData` mock, add timer test |
| 3 | ElapsedTime ticks for active, static for completed | `src/components/evolution/ElapsedTime.test.tsx` | New component, use jest.useFakeTimers |
| 3 | formToConfig passes full budgetCaps | `src/app/admin/quality/strategies/strategyFormUtils.test.ts` | Extract pure functions from 'use client' page to testable utils |
| 4 | StrategyConfigDisplay renders full names + effective budget | `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.test.tsx` | Existing test file or new |

### Manual Verification (on stage)
1. Explorer tab: Open dropdowns, verify they appear above stat cards and table
2. Run detail: Verify strategy name/label shown with clickable link to strategies page
3. Run detail (active run): Watch cost header update every ~5s during execution
4. BudgetTab (active run): Verify per-agent spend vs cap bars update in real-time
5. Dashboard overview: Verify "Duration" column ticks for running runs
6. Strategy creation: Set custom per-agent budget caps, save, verify stored correctly
7. Strategy detail: Verify full agent names, enabled indicators, effective budget shown

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Update Budget Caps section to mention per-agent UI editing and checkpoint cost writes
- `docs/evolution/architecture.md` - Note that checkpoints now include `total_cost_usd`
- `docs/evolution/visualization.md` - Document new BudgetTab features (per-agent caps, auto-refresh) and ElapsedTime component

## Files Modified

### Phase 1
- `src/app/admin/quality/explorer/page.tsx` — z-index on filter Card
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — strategy display + link

### Phase 2
- `src/lib/evolution/core/pipeline.ts` — add optional `totalCostUsd` param to persistCheckpoint + persistCheckpointWithSupervisor, pass from ctx.costTracker at all 7 callsites
- `src/lib/services/evolutionActions.ts` — NEW: `getEvolutionRunByIdAction(runId)` lightweight single-run fetch
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — auto-refresh using `getEvolutionRunByIdAction`
- `src/lib/services/evolutionVisualizationActions.ts` — add `config`, `status` to select; add `agentBudgetCaps`, `runStatus` to BudgetData return type
- `src/components/evolution/tabs/BudgetTab.tsx` — per-agent cap display + auto-refresh (using runStatus from budget data, no new prop)

### Phase 3
- `src/components/evolution/ElapsedTime.tsx` — NEW: shared elapsed time component
- `src/app/admin/evolution-dashboard/page.tsx` — Duration column
- `src/app/admin/quality/evolution/page.tsx` — Duration column
- `src/app/admin/quality/strategies/page.tsx` — per-agent budget editing in FormState + form UI
- `src/app/admin/quality/strategies/strategyFormUtils.ts` — NEW: extract `formToConfig` + `rowToForm` as testable pure functions

### Phase 4
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` — full names, enabled indicators, effective budget
- `src/app/admin/quality/strategies/page.tsx` — use StrategyConfigDisplay in detail row
