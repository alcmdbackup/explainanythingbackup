# Minor Fixes Evolution Research

**Date**: 2026-02-14T15:08:29Z
**Git Commit**: a1685772
**Branch**: fix/minor_fixes_evolution_20260214

## Problem Statement
This project addresses several minor fixes and enhancements to the evolution pipeline dashboard UI. Issues include dropdown menus appearing behind cards on the Explorer tab, missing strategy information in run detail views, stale cost displays that don't update on refresh, and lack of real-time budget tracking. It also adds run duration tracking, budget allocation editing when creating strategies, and improved strategy detail views.

## Requirements (from GH Issue #428)
- Dropdowns menus on explorer tab in evolution dash appear behind cards
- Evolution run details view should clearly display strategy being used and link to strategy details
- All costs should update in real time on page refresh. Specifically cost at top of evolution run tab (0/$5.00) does not update in real time.
- In run detail screen, should be able to see cost applied against each budget constraint, in real time
- Track how long a run has been running, on evolution tab overview. Should update in realtime.
- Allow editing budget allocation for each agent when creating a strategy
- Strategies detail screen should show detailed budget allocation

## High Level Summary

Research covers 7 requirements across the evolution dashboard. The core UI files are:
- Explorer page: `src/app/admin/quality/explorer/page.tsx`
- Evolution runs page: `src/app/admin/quality/evolution/page.tsx`
- Run detail page: `src/app/admin/quality/evolution/run/[runId]/page.tsx`
- Dashboard overview: `src/app/admin/evolution-dashboard/page.tsx`
- Strategy management: `src/app/admin/quality/strategies/page.tsx`
- Budget tab: `src/components/evolution/tabs/BudgetTab.tsx`
- Strategy config display: `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx`
- Auto-refresh: `src/components/evolution/AutoRefreshProvider.tsx`

---

## Detailed Findings

### 1. Explorer Tab Dropdown Z-Index Issue

**Component**: `SearchableMultiSelect` (defined inline in `explorer/page.tsx`, lines 234-333)

**3 instances**: Prompts (line 585), Strategies (line 592), Pipeline Types (line 599)

**Dropdown rendering** (line 279):
```tsx
<div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg max-h-56 overflow-hidden flex flex-col">
```
- Renders in-place (NOT via Portal)
- Container div: `className="flex flex-col gap-1 relative"` (line 268)

**Stacking context trap**:
- Filter Card (line 582): `<Card className="bg-[var(--surface-secondary)] paper-texture">`
- Card base classes (card.tsx:8-16): `"rounded-book border ... paper-texture card-enhanced"`
- `.paper-texture` (globals.css:1028-1040): `position: relative` + `::before` with `z-index: 1`
- `.card-enhanced` (globals.css:2530-2593): `position: relative` + `overflow: visible` + `transform` on hover
- Both create stacking contexts, trapping the dropdown's `z-50` within the parent
- StatCards below (line 639) and table cards (line 671) have their own stacking contexts via same classes, appearing above via DOM order

**Admin layout** (layout.tsx:26): `<main className="flex-1 p-6 overflow-auto">` — outer overflow context

**Working reference patterns in codebase**:
- `components/ui/select.tsx:74`: `<SelectPrimitive.Portal>` escapes stacking context
- `components/sources/SourceCombobox.tsx:249`: `<Popover.Portal>` escapes stacking context

**Key files**:
- `src/app/admin/quality/explorer/page.tsx:234-333` — SearchableMultiSelect component
- `src/app/admin/quality/explorer/page.tsx:279` — dropdown div
- `src/app/admin/quality/explorer/page.tsx:582-636` — filter card and grid
- `src/components/ui/card.tsx:8-16` — Card base classes
- `src/app/globals.css:1028-1040` — `.paper-texture`
- `src/app/globals.css:2530-2593` — `.card-enhanced`
- `src/app/admin/layout.tsx:26` — `overflow-auto` on main

### 2. Strategy Display in Run Detail View

**Current state**: Run detail page (`run/[runId]/page.tsx`) shows NO strategy information. Header displays (lines 217-244):
1. Explanation ID or "Evolution Run" title
2. Run ID (truncated 8 chars) with copy button
3. `EvolutionStatusBadge` (status)
4. `PhaseIndicator` (phase + current_iteration)
5. Cost display: `${run.total_cost_usd.toFixed(2)} / ${run.budget_cap_usd.toFixed(2)}`
6. Error message (conditional)

**Data already available**: `EvolutionRun` type (evolutionActions.ts:16-34):
```typescript
export interface EvolutionRun {
  id: string;
  explanation_id: number | null;
  status: EvolutionRunStatus;
  phase: PipelinePhase;
  total_variants: number;
  total_cost_usd: number;
  estimated_cost_usd: number | null;
  budget_cap_usd: number;
  current_iteration: number;
  variants_generated: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  prompt_id: string | null;
  pipeline_type: PipelineType | null;
  strategy_config_id: string | null;  // ← AVAILABLE BUT UNUSED
}
```

**Data fetching pattern** (run/[runId]/page.tsx:179-190): Fetches ALL runs via `getEvolutionRunsAction()`, filters client-side by `runId`. No secondary fetch for strategy.

**Existing server action for single strategy**: `getStrategyDetailAction(id)` (strategyRegistryActions.ts:64-85) — fetches full `StrategyConfigRow` including name, label, config, and performance stats.

**Existing enrichment pattern** (unifiedExplorerActions.ts:257-274):
```typescript
const strategyIds = [...new Set(runRows.map(r => r.strategy_config_id).filter(Boolean))] as string[];
const strategyMap = await supabase.from('strategy_configs').select('id, label').in('id', strategyIds)
  .then(r => new Map((r.data ?? []).map((s) => [s.id, s.label])));
```

**Strategy detail pages**:
- `/admin/quality/strategies` — full CRUD, expandable StrategyDetailRow (page.tsx:538-599)
- `/admin/quality/optimization` — StrategyDetail modal + `StrategyConfigDisplay` component

**Run list tables** (both evolution page and dashboard overview) also lack strategy columns.

**Key files**:
- `src/app/admin/quality/evolution/run/[runId]/page.tsx:179-190` — data fetching
- `src/app/admin/quality/evolution/run/[runId]/page.tsx:217-244` — header rendering
- `src/lib/services/evolutionActions.ts:16-34` — EvolutionRun type
- `src/lib/services/evolutionActions.ts:294-310` — getEvolutionRunsAction query (select('*'))
- `src/lib/services/strategyRegistryActions.ts:64-85` — getStrategyDetailAction
- `src/lib/services/unifiedExplorerActions.ts:257-274` — enrichment pattern

### 3. Real-Time Cost Updates

**CRITICAL FINDING**: `total_cost_usd` is written to DB ONLY at pipeline completion, NEVER during execution.

**Checkpoint function** (pipeline.ts:40-56) updates `current_iteration`, `phase`, `last_heartbeat`, `runner_agents_completed` — but NOT `total_cost_usd`.

**Completion writes** (pipeline.ts:763-769 minimal, 1014-1021 full):
```typescript
await supabase.from('content_evolution_runs').update({
  status: 'completed',
  completed_at: new Date().toISOString(),
  total_cost_usd: ctx.costTracker.getTotalSpent(),  // ONLY HERE
}).eq('id', runId);
```

**CostTracker** (costTracker.ts, 93 lines): In-memory only. Key methods:
- `reserveBudget(agentName, estimate)` — pre-call check with 30% margin, per-agent AND total cap
- `recordSpend(agentName, actualCost)` — FIFO reservation release
- `getTotalSpent()` / `getAllAgentCosts()` / `getAvailableBudget()`

**Real-time data EXISTS** in `llmCallTracking` table:
- Written by `callLLM()` (llms.ts:278-298) on every LLM call
- Fields: `call_source: 'evolution_{agentName}'`, `estimated_cost_usd`, `created_at`
- Indexed on `estimated_cost_usd` and `created_at`

**Budget data retrieval** — `getEvolutionRunBudgetAction()` (evolutionVisualizationActions.ts:687-735):
- Time-window correlation: queries `llmCallTracking` between `started_at` and `completed_at`
- For active runs: `completed_at` is null → no upper bound → returns all calls from `started_at` to present
- Returns: `{ agentBreakdown, cumulativeBurn, estimate, prediction }`
- **Limitation**: No `run_id` FK in `llmCallTracking` — concurrent runs can overlap

**UI refresh patterns**:
- Run list (evolution/page.tsx): NO auto-refresh, reloads on filter change via `loadRuns()` (lines 653-672)
- Run detail header (run/[runId]/page.tsx:239): Shows `total_cost_usd` from single `useEffect` on mount
- BudgetTab: `useEffect([runId])` — loads once, NO polling (lines 50-67)
- LogsTab: `setInterval(fetchLogs, 5000)` when `runStatus === 'running' || 'claimed'` (lines 78-86) — ONLY tab with auto-refresh
- Dashboard overview: `AutoRefreshProvider` wraps entire page, polls every 15s

**Key files**:
- `src/lib/evolution/core/pipeline.ts:40-56` — checkpoint (no cost)
- `src/lib/evolution/core/pipeline.ts:763-769` — minimal completion (writes cost)
- `src/lib/evolution/core/pipeline.ts:1014-1021` — full completion (writes cost)
- `src/lib/evolution/core/costTracker.ts` — entire file (93 lines)
- `src/lib/evolution/core/llmClient.ts:49-75` — budget-enforced LLM wrapper
- `src/lib/services/llms.ts:278-298` — llmCallTracking insert
- `src/lib/services/evolutionVisualizationActions.ts:687-735` — getEvolutionRunBudgetAction
- `src/components/evolution/tabs/BudgetTab.tsx:50-67` — one-time load
- `src/components/evolution/tabs/LogsTab.tsx:77-86` — auto-refresh pattern

### 4. Per-Agent Budget Constraint Display

**Current state**: No UI displays per-agent budget limits. BudgetTab shows actual spend only.

**Budget caps** defined in `DEFAULT_EVOLUTION_CONFIG.budgetCaps` (config.ts:22-34):
```typescript
budgetCaps: {
  generation: 0.20,        // 20%
  calibration: 0.15,       // 15%
  tournament: 0.20,        // 20%
  evolution: 0.10,         // 10%
  reflection: 0.05,        // 5%
  debate: 0.05,            // 5%
  iterativeEditing: 0.05,  // 5%
  treeSearch: 0.10,        // 10%
  outlineGeneration: 0.10, // 10%
  sectionDecomposition: 0.10, // 10%
  flowCritique: 0.05,      // 5%  (unmanaged, separate gating)
}
```
Type is `Record<string, number>` (types.ts:~480). Sum >1.0 intentionally.

**CostTracker enforcement** (costTracker.ts):
- `agentCapPct = this.budgetCaps[agentName] ?? 0.20` (default 20% fallback)
- `agentCap = agentCapPct * this.budgetCapUsd`
- Checks: `agentSpent + withMargin > agentCap` → throws `BudgetExceededError`

**Agent classification** (budgetRedistribution.ts:9-26):
- REQUIRED: `generation`, `calibration`, `tournament`, `proximity`
- OPTIONAL: `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`
- SINGLE_ARTICLE_DISABLED: `generation`, `outlineGeneration`, `evolution`
- MANAGED_AGENTS = REQUIRED + OPTIONAL (flowCritique excluded)

**Budget redistribution** (`computeEffectiveBudgetCaps`, budgetRedistribution.ts:74-124):
1. Separate managed vs unmanaged agents
2. Filter to active agents (required + enabled optional - single-article disabled)
3. Proportionally scale: `scaleFactor = originalManagedSum / remainingSum`
4. Merge back unmanaged agents unchanged

**BudgetTab** (BudgetTab.tsx) renders:
- `BurnChart` — cumulative cost over time from `cumulativeBurn` data
- `AgentBarChart` — per-agent cost breakdown from `agentBreakdown` data
- Estimated vs Actual comparison (if `prediction` exists)
- **Does NOT show budget caps or remaining allocation**

**Key files**:
- `src/lib/evolution/config.ts:22-34` — DEFAULT_EVOLUTION_CONFIG.budgetCaps
- `src/lib/evolution/core/costTracker.ts` — enforcement logic
- `src/lib/evolution/core/budgetRedistribution.ts:9-26` — agent classification
- `src/lib/evolution/core/budgetRedistribution.ts:74-124` — redistribution algorithm
- `src/components/evolution/tabs/BudgetTab.tsx` — UI (actual spend only)

### 5. Run Duration Tracking

**Database timing columns** on `content_evolution_runs`:
- `created_at TIMESTAMP NOT NULL DEFAULT NOW()` — auto-set on queue
- `started_at TIMESTAMP` — set when claimed (runner.ts:94-98) and again when running (pipeline.ts:718, 832)
- `completed_at TIMESTAMP` — set at completion (pipeline.ts:763, 1014)
- `last_heartbeat TIMESTAMP` — every 60s (HEARTBEAT_INTERVAL_MS = 60_000, runner.ts:9,125-138) and at checkpoints

**DashboardRun type** (evolutionVisualizationActions.ts:37-48) includes `started_at` and `completed_at`. The query (line 202) explicitly selects them:
```typescript
.select('id, explanation_id, status, phase, current_iteration, total_cost_usd, budget_cap_usd, started_at, completed_at, created_at')
```

**Dashboard overview** (evolution-dashboard/page.tsx:165-207): Table columns = Explanation, Status, Phase, Iteration, Cost, Created. Only `created_at` displayed as `toLocaleDateString()`. `started_at`/`completed_at` available in data but ignored.

**Evolution runs page** (evolution/page.tsx:830-905): Table columns = Run ID, Explanation, Status, Phase, Variants, Cost, Est., Budget, Created, Actions. Only `created_at` with date + HH:MM time. No duration.

**EvolutionRunSummary** (types.ts:550-555) includes `durationSeconds` computed at completion (pipeline.ts:772, 1024).

**AutoRefreshProvider** (AutoRefreshProvider.tsx):
- Default interval: 15s (`intervalMs = 15_000`)
- Tab visibility aware: pauses when hidden, resumes + immediate refresh on visible
- `RefreshIndicator` shows "Updated Xs ago"
- Wraps dashboard overview page (evolution-dashboard/page.tsx:107-119)
- Does NOT wrap evolution/page.tsx or run detail page

**Key files**:
- `supabase/migrations/20260131000001_content_evolution_runs.sql` — timing columns
- `src/lib/services/evolutionVisualizationActions.ts:37-48` — DashboardRun type
- `src/lib/services/evolutionVisualizationActions.ts:196-206` — query with timing fields
- `src/app/admin/evolution-dashboard/page.tsx:165-207` — dashboard table (ignores timing)
- `src/app/admin/quality/evolution/page.tsx:830-905` — runs table (only created_at)
- `src/components/evolution/AutoRefreshProvider.tsx` — 15s polling
- `scripts/evolution-runner.ts:9,90-108,125-138` — heartbeat mechanism

### 6. Budget Allocation Editing in Strategy Creation

**FormState** (strategies/page.tsx:35-45):
```typescript
interface FormState {
  name: string;
  description: string;
  pipelineType: PipelineType;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  budgetCap: number;           // ONLY generation cap — single field
  enabledAgents: string[];
  singleArticle: boolean;
}
```
Default: `budgetCap: 0.20` (EMPTY_FORM, line 50-60)

**Budget input** (line 417-430): `<input type="number" min={0.01} max={1} step={0.01}>` labeled "Budget Cap (generation %)". Only this one field exposed.

**formToConfig()** (line 705-716):
```typescript
const formToConfig = (form: FormState): StrategyConfig => ({
  generationModel: form.generationModel,
  judgeModel: form.judgeModel,
  iterations: form.iterations,
  budgetCaps: {
    generation: form.budgetCap,  // user input
    calibration: 0.15,           // hardcoded
    tournament: 0.20,            // hardcoded
  },
  enabledAgents: form.enabledAgents as AgentName[],
  singleArticle: form.singleArticle || undefined,
});
```
Only 3 agent caps stored. Other agents resolved at runtime from `DEFAULT_EVOLUTION_CONFIG.budgetCaps` via `resolveConfig()` deep merge.

**rowToForm()** (line 801-813): When editing existing strategy, extracts only `generation` cap:
```typescript
budgetCap: row.config.budgetCaps.generation ?? 0.20
```

**Budget preview** (lines 176-183, 359-372):
```typescript
const budgetPreview = useMemo(
  () => computeEffectiveBudgetCaps(DEFAULT_EVOLUTION_CONFIG.budgetCaps, form.enabledAgents, form.singleArticle),
  [form.enabledAgents, form.singleArticle],
);
```
Displays all agents sorted by percentage in a 3-column grid. Read-only — not editable.

**Agent checkboxes** (lines 301-348): Required agents shown as locked (disabled checkbox). Optional agents toggleable via `toggleAgent()` from agentToggle.ts. Single-article mode auto-disables generation/outlineGeneration/evolution.

**StrategyConfig type** (strategyConfig.ts:12-22):
```typescript
export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;  // flexible — accepts any agent names
  enabledAgents?: AgentName[];
  singleArticle?: boolean;
}
```

**Strategy presets** (strategyRegistryActions.ts:374-414):
- Economy: `{ generation: 0.30, calibration: 0.30, tournament: 0.40 }` (3 agents only)
- Balanced: `DEFAULT_EVOLUTION_CONFIG.budgetCaps` (all 11 agents)
- Quality: `DEFAULT_EVOLUTION_CONFIG.budgetCaps` (all 11 agents)

**Key files**:
- `src/app/admin/quality/strategies/page.tsx:35-60` — FormState + EMPTY_FORM
- `src/app/admin/quality/strategies/page.tsx:176-183` — budget preview
- `src/app/admin/quality/strategies/page.tsx:301-348` — agent checkboxes
- `src/app/admin/quality/strategies/page.tsx:417-430` — budget cap input
- `src/app/admin/quality/strategies/page.tsx:705-716` — formToConfig
- `src/app/admin/quality/strategies/page.tsx:801-813` — rowToForm
- `src/lib/evolution/core/strategyConfig.ts:12-22` — StrategyConfig type
- `src/lib/evolution/core/budgetRedistribution.ts:74-124` — redistribution
- `src/lib/services/strategyRegistryActions.ts:374-414` — presets

### 7. Strategy Detail Budget Display

**StrategyConfigDisplay** (optimization/_components/StrategyConfigDisplay.tsx, ~104 lines):
- Props: `{ config: StrategyConfig; showRaw?: boolean }`
- If `showRaw`: renders `<pre>{JSON.stringify(config, null, 2)}</pre>`
- Otherwise: 3-column layout:
  1. **Models**: generation model, judge model
  2. **Execution**: iterations, agent model overrides (if `config.agentModels`)
  3. **Budget Allocation**: all `budgetCaps` entries sorted by percentage, rendered as badge chips:
     ```tsx
     <span className="px-2 py-1 bg-[var(--surface-elevated)] rounded-page font-mono text-xs">
       {agent.slice(0, 4)}: {(pct * 100).toFixed(0)}%
     </span>
     ```
     Labels truncated to 4 chars (e.g., `gene: 20%`, `cali: 15%`, `tour: 20%`)

**NOT shown in StrategyConfigDisplay**: `enabledAgents`, `singleArticle`, which agents are active vs disabled.

**StrategyDetailRow** (strategies/page.tsx:538-599): Expandable row showing:
- Left column: raw config JSON (`JSON.stringify(config, null, 2)`) + config hash
- Right column: performance stats grid (run_count, avg_final_elo, avg_elo_per_dollar, total_cost_usd, best/worst Elo, stddev), cost estimation accuracy, created/last_used timestamps

**Key files**:
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` — full component
- `src/app/admin/quality/strategies/page.tsx:538-599` — StrategyDetailRow

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/architecture.md
- docs/evolution/reference.md
- docs/evolution/data_model.md
- docs/evolution/agents/overview.md
- docs/evolution/rating_and_comparison.md

## Code Files Read

### UI Components
- `src/app/admin/quality/explorer/page.tsx` — Explorer tab with SearchableMultiSelect (234-333, 582-636)
- `src/app/admin/quality/evolution/page.tsx` — Evolution runs list (653-672, 830-905)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail (1-17, 179-190, 217-244)
- `src/app/admin/evolution-dashboard/page.tsx` — Dashboard overview (107-119, 165-207)
- `src/app/admin/quality/strategies/page.tsx` — Strategy CRUD (35-60, 176-183, 301-348, 417-430, 538-599, 705-716, 801-813)
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` — Strategy display (full file)
- `src/app/admin/quality/optimization/_components/StrategyDetail.tsx` — Strategy modal
- `src/components/evolution/tabs/BudgetTab.tsx` — Cost visualization (50-67, 174-183)
- `src/components/evolution/tabs/LogsTab.tsx` — Logs with auto-refresh (77-86)
- `src/components/evolution/AutoRefreshProvider.tsx` — 15s polling (full file)
- `src/components/ui/card.tsx` — Card base classes (8-16)
- `src/components/ui/select.tsx` — Portal-based select (reference)
- `src/components/sources/SourceCombobox.tsx` — Portal-based combobox (reference)
- `src/app/globals.css` — `.paper-texture` (1028-1040), `.card-enhanced` (2530-2593)
- `src/app/admin/layout.tsx` — Admin layout (22-30)

### Server Actions
- `src/lib/services/evolutionActions.ts` — EvolutionRun type (16-34), getEvolutionRunsAction (294-310)
- `src/lib/services/evolutionVisualizationActions.ts` — DashboardRun (37-48), query (196-206), getEvolutionRunBudgetAction (687-735)
- `src/lib/services/unifiedExplorerActions.ts` — Strategy enrichment (257-274)
- `src/lib/services/strategyRegistryActions.ts` — getStrategyDetailAction (64-85), presets (374-414)
- `src/lib/services/llms.ts` — llmCallTracking insert (278-298)

### Pipeline Core
- `src/lib/evolution/core/pipeline.ts` — checkpoint (40-56), minimal completion (763-769), full completion (1014-1021)
- `src/lib/evolution/core/costTracker.ts` — full file (93 lines)
- `src/lib/evolution/core/llmClient.ts` — budget-enforced wrapper (49-75)
- `src/lib/evolution/core/budgetRedistribution.ts` — agent classification (9-26), redistribution (74-124)
- `src/lib/evolution/core/supervisor.ts` — isEnabled (157-161), getPhaseConfig (164-218)
- `src/lib/evolution/core/agentToggle.ts` — toggleAgent utility
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG (7-38)
- `src/lib/evolution/types.ts` — EvolutionRunConfig (~468-483), EvolutionRunSummary (550-555)
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig (12-22), StrategyConfigRow (28-49)
- `src/lib/evolution/index.ts` — preparePipelineRun (150-157)

### Database
- `supabase/migrations/20260131000001_content_evolution_runs.sql` — Runs schema with timing columns
- `supabase/migrations/20260205000005_add_strategy_configs.sql` — Strategy schema
- `supabase/migrations/20260207000007_strategy_lifecycle.sql` — Strategy lifecycle
- `supabase/migrations/20260214000001_claim_evolution_run.sql` — Claim RPC
- `scripts/evolution-runner.ts` — Batch runner: claiming (90-108), heartbeat (125-138)
