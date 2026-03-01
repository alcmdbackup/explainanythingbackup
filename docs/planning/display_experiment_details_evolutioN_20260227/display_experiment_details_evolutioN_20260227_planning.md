# Display Experiment Details Evolution Plan

## Background
Add a new page/feature to display detailed experiment information in the evolution admin UI. Currently, the experiment system has ExperimentStatusCard and ExperimentHistory components on the optimization dashboard, but there is no dedicated detail page for drilling into individual experiments. This project will create a dedicated experiment detail page showing comprehensive experiment data including rounds, runs, factor analysis results, and status progression, plus an LLM-generated narrative analysis report.

## Requirements (from GH Issue #586)
- [ ] Show experiment ID under experiment history module on ratings optimization > experiments > experiment history
- [ ] This should link to a new experiment details view
- [ ] Experiment detail view should show all available details - e.g. runs called, experiment conclusion (newly generated, see below)
- [ ] Experiment should have built in analysis at the end - summarize data findings. Figure out a way to analyze and write this into a report that can be viewed

## Problem
The experiment system has substantial backend infrastructure (DB tables, server actions, analysis engine, cron state machine) but the UI only provides an inline dashboard view. ExperimentHistory shows experiment names and status but not IDs, and has no links to dedicated detail pages. Analysis results and terminal summaries are stored as JSONB but rendered as raw `JSON.stringify` output. There is no structured report view that summarizes experiment findings in a human-readable format, and no LLM-generated narrative that explains what the experiment discovered.

## Options Considered

### Report Generation
| Option | Pros | Cons |
|--------|------|------|
| A. Template-based only | Deterministic, $0 cost, instant | No narrative richness, just tables |
| B. LLM-generated only | Rich prose narrative | Cost per report, latency |
| **C. Hybrid (chosen)** | Template for structure + LLM for narrative | Slightly more complexity |

**Decision**: Hybrid approach. The Rounds tab uses template-based rendering for structured analysis data (tables, rankings). The Report tab adds an LLM-generated narrative summary that explains findings in prose with actionable insights. Cost: ~$0.001/report with `gpt-4.1-nano`.

### Report Generation Timing
| Option | Pros | Cons |
|--------|------|------|
| **A. Auto-generate in `writeTerminalState()` cron (chosen)** | Report ready before user visits; no button click needed; single execution point | Only for terminal experiments; cron has 30s timeout |
| B. On-demand via server action | Works for any experiment state; user-triggered | Requires explicit click; first load has latency |

**Decision**: Auto-generate in `writeTerminalState()` with fire-and-forget pattern. `gpt-4.1-nano` responds in 1-3s, and `writeTerminalState()` only fires when an experiment terminates (rare — ~once per hour at most). The function already gathers run data and Elo scores, so the incremental work is: fetch agent metrics (~1s) + call LLM (~2-3s) + cache result. If the LLM call fails, log the error and continue — experiment completion is never blocked. A `regenerateExperimentReportAction` server action is also provided for manual refresh from the UI.

### Data Access for Report
| Option | Pros | Cons |
|--------|------|------|
| A. Readonly pg connection (`query:prod` pattern) | True SELECT-only safety | CLI-only today; no server-side utility; `pg` connection lifecycle tricky in serverless |
| **B. Supabase service client (chosen)** | Already used everywhere; proven patterns for multi-table aggregation; works in server actions | Uses service role (full access), not readonly |
| C. New experiment analyzer agent | Could run complex queries autonomously | Over-engineered; no agent infrastructure for this use case |

**Decision**: Use existing `createSupabaseServiceClient()` which is already used by all experiment server actions. The service role key has full read access to all tables. Safety comes from the server action pattern (`requireAdmin()` + `withLogging()` + no mutations in the report action). No need for a separate readonly connection or agent — the data gathering is straightforward multi-table queries following established patterns in `articleDetailActions.ts` and `costAnalyticsActions.ts`.

### Runs Data Fetching
| Option | Pros | Cons |
|--------|------|------|
| **A. New `getExperimentRunsAction` (chosen)** | Clean separation, follows existing patterns | One new server action |
| B. Extend `getExperimentStatusAction` | Single call | Bloats existing action, mixes concerns |

**Decision**: New dedicated server action to fetch individual runs for an experiment through the FK chain (experiment → rounds → batch_run_id → runs).

## Phased Execution Plan

### Phase 1: Show Experiment ID + Link in ExperimentHistory

**Goal**: Requirement 1 & 2 — show ID and link to detail page.

**Files modified:**
- `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx`
- `evolution/src/lib/utils/evolutionUrls.ts` — add `buildExperimentUrl()`

**Changes:**
1. Add `buildExperimentUrl` to `evolutionUrls.ts`:
```tsx
/** Link to a specific experiment's detail page. */
export function buildExperimentUrl(experimentId: string): string {
  return `/admin/quality/optimization/experiment/${experimentId}`;
}
```
2. Add `import Link from 'next/link'` and `import { buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls'`
3. In `ExperimentRow`, wrap the experiment name in a `<Link>` using `buildExperimentUrl`
4. Below the name, show truncated experiment ID in muted monospace text

```tsx
// In ExperimentRow, replace the name span:
<div className="flex flex-col">
  <Link
    href={buildExperimentUrl(experiment.id)}
    className="font-ui font-medium text-sm text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
    onClick={(e) => e.stopPropagation()}
  >
    {experiment.name}
  </Link>
  <span className="text-[10px] font-mono text-[var(--text-muted)]">
    {experiment.id.slice(0, 8)}…
  </span>
</div>
```

**Tests:**
- Unit test: `src/app/admin/quality/optimization/_components/ExperimentHistory.test.tsx` — verify Link renders with correct href, verify ID is displayed

**Commit checkpoint**: lint + tsc + build + unit tests pass

---

### Phase 2: Experiment Detail Page (Overview)

**Goal**: Requirement 3 — create the detail page route with overview card.

**Files created:**
- `src/app/admin/quality/optimization/experiment/[experimentId]/page.tsx` — Server component
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.tsx` — Client tab component
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` — Overview card

**page.tsx** (server component, follows article detail pattern):
```tsx
// Experiment detail page: shows comprehensive data for a single experiment.
// Server component fetches status, then client tabs render detail views.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getExperimentStatusAction } from '@evolution/services/experimentActions';
import { ExperimentOverviewCard } from './ExperimentOverviewCard';
import { ExperimentDetailTabs } from './ExperimentDetailTabs';

interface Props {
  params: Promise<{ experimentId: string }>;
}

export default async function ExperimentDetailPage({ params }: Props) {
  const { experimentId } = await params;
  const result = await getExperimentStatusAction({ experimentId });
  if (!result.success || !result.data) notFound();

  const status = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Rating Optimization', href: '/admin/quality/optimization' },
          { label: 'Experiment' },
          { label: status.name },
        ]}
      />
      <ExperimentOverviewCard status={status} />
      <ExperimentDetailTabs status={status} />
    </div>
  );
}
```

**ExperimentOverviewCard.tsx** — Reuse patterns from ExperimentStatusCard:
- Name, ID (copyable), status badge, dates (created, completed if terminal)
- Budget progress bar (reuse ProgressBar pattern)
- Optimization target, convergence threshold
- Factor definitions as a table (factor key → low / high values)
- Cancel button if active (reuse cancel logic from ExperimentStatusCard)

**ExperimentDetailTabs.tsx** — Client component following ArticleDetailTabs pattern:
- Tabs: Rounds | Runs | Report
- `useState<'rounds' | 'runs' | 'report'>('rounds')`
- Gold underline active state
- Lazy-renders tab content

**Tests:**
- Unit test: `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.test.tsx` — renders status badge, budget bar, factor table, cancel button visible for active / hidden for terminal
- Unit test: `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.test.tsx` — tab switching renders correct content

**Commit checkpoint**: lint + tsc + build + unit tests pass

---

### Phase 3: Rounds Tab — Structured Analysis Display

**Goal**: Requirement 3 — replace raw JSON with structured round analysis.

**Files created:**
- `src/app/admin/quality/optimization/experiment/[experimentId]/RoundsTab.tsx`
- `src/app/admin/quality/optimization/experiment/[experimentId]/RoundAnalysisCard.tsx`

**RoundsTab.tsx**: Receives `status.rounds` and renders a card per round.

**RoundAnalysisCard.tsx**: For each round with `analysisResults`:
- Round header: number, type (screening/refinement), design (L8/full-factorial), status badge, date
- Run progress bar: completed/total with failed count
- **Main Effects table**: Factor name | Effect size | Direction (↑/↓) — sorted by absolute effect
- **Factor Rankings list**: Ordered by importance with visual rank indicators
- **Recommendations list**: Bullet points from `analysisResults.recommendations`
- **Warnings**: Displayed if present

```tsx
// Structured display for a single round's analysis results.
// Renders main effects table, factor rankings, and recommendations.

interface RoundAnalysisCardProps {
  round: ExperimentStatus['rounds'][number];
}
```

Key data paths from `analysisResults` JSONB:
- `analysisResults.mainEffects` → `Record<string, { effect: number; low: number; high: number }>`
- `analysisResults.factorRanking` → `Array<{ factor: string; importance: number }>`
- `analysisResults.recommendations` → `string[]`
- `analysisResults.warnings` → `string[]`
- `analysisResults.completedRuns` / `analysisResults.totalRuns`

**Tests:**
- Unit test: `src/app/admin/quality/optimization/experiment/[experimentId]/RoundAnalysisCard.test.tsx` — renders main effects table, rankings, recommendations from mock data; handles empty/null analysisResults

**Commit checkpoint**: lint + tsc + build + unit tests pass

---

### Phase 4: Runs Tab — Experiment Runs List + New Server Action

**Goal**: Requirement 3 — show "runs called" with links to run detail.

**Files created:**
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx`

**Files modified:**
- `evolution/src/services/experimentActions.ts` — add `getExperimentRunsAction`

**New import needed:** `import { ordinalToEloScale } from '@evolution/lib/core/rating';` (for `extractTopElo`)

**New server action** `getExperimentRunsAction`:

**Important**: `evolution_runs` does NOT have an `elo_score` column. Elo scores live on `evolution_variants.elo_score` (formerly `content_evolution_variants`). Per-run Elo is derived from the `run_summary` JSONB field via `extractTopElo()` (which reads `run_summary.topVariants[0].ordinal` or `.elo`). The action must select `run_summary` and extract Elo using the same pattern as the cron route.

```tsx
export interface ExperimentRun {
  id: string;
  status: string;
  eloScore: number | null;  // Extracted from run_summary JSONB, NOT a column
  costUsd: number | null;
  roundNumber: number;
  experimentRow: number | null;
  createdAt: string;
  completedAt: string | null;
}

/** Extract topElo from run_summary JSONB. Same pattern as experiment-driver cron. */
function extractTopElo(runSummary: Record<string, unknown> | null): number | null {
  if (!runSummary) return null;
  const topVariants = runSummary.topVariants as Array<{ ordinal?: number; elo?: number }> | undefined;
  if (!topVariants?.[0]) return null;
  if (topVariants[0].ordinal != null) return ordinalToEloScale(topVariants[0].ordinal);
  return topVariants[0].elo ?? null;
}

const _getExperimentRunsAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentRun[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Get all rounds for this experiment
    const { data: rounds } = await supabase
      .from('evolution_experiment_rounds')
      .select('round_number, batch_run_id')
      .eq('experiment_id', input.experimentId)
      .order('round_number', { ascending: true });

    const batchRunIds = (rounds ?? [])
      .map(r => r.batch_run_id)
      .filter((id): id is string => id !== null);

    if (batchRunIds.length === 0) return { success: true, data: [], error: null };

    // Get all runs — select run_summary (not elo_score, which doesn't exist on this table)
    const { data: runs } = await supabase
      .from('evolution_runs')
      .select('id, status, run_summary, total_cost_usd, config, batch_run_id, created_at, completed_at')
      .in('batch_run_id', batchRunIds)
      .order('created_at', { ascending: true });

    // Map batch_run_id → round_number for assignment
    const batchToRound = new Map(
      (rounds ?? []).map(r => [r.batch_run_id, r.round_number])
    );

    const result: ExperimentRun[] = (runs ?? []).map(r => ({
      id: r.id,
      status: r.status,
      eloScore: extractTopElo(r.run_summary),  // Extract from JSONB
      costUsd: r.total_cost_usd ? Number(r.total_cost_usd) : null,
      roundNumber: batchToRound.get(r.batch_run_id) ?? 0,
      experimentRow: r.config?._experimentRow ?? null,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));

    return { success: true, data: result, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getExperimentRunsAction') };
  }
}, 'getExperimentRunsAction');

export const getExperimentRunsAction = serverReadRequestId(_getExperimentRunsAction);
```

**RunsTab.tsx**:
- Fetches runs via `getExperimentRunsAction` on mount
- Groups by round number
- Table columns: Run ID (truncated, linked via `buildRunUrl(runId)` from `evolutionUrls.ts`), Status badge, Elo Score, Cost, L8 Row, Created

**Tests:**
- Unit test: `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.test.tsx` — renders run table, links to run detail pages, handles empty runs
- Unit test: `evolution/src/services/experimentActions.test.ts` (extend existing) — `getExperimentRunsAction` returns correctly shaped data, Elo extraction from run_summary works

**Commit checkpoint**: lint + tsc + build + unit tests pass

---

### Phase 5: Auto-Generated LLM Report + Report Tab

**Goal**: Requirement 4 — built-in analysis with LLM-generated narrative, auto-generated at experiment completion.

**Files created:**
- `src/app/admin/quality/optimization/experiment/[experimentId]/ReportTab.tsx`
- `evolution/src/services/experimentReportPrompt.ts` — prompt builder (separated for testability)

**Files modified:**
- `src/app/api/cron/experiment-driver/route.ts` — add report generation to `writeTerminalState()`
- `evolution/src/services/experimentActions.ts` — add `regenerateExperimentReportAction`

#### Architecture: Two Entry Points

```
                        ┌─────────────────────────────┐
                        │  Experiment reaches terminal  │
                        │  state (converged/exhausted)  │
                        └──────────────┬──────────────┘
                                       │
                                       ▼
              writeTerminalState() in experiment-driver cron
                        │
                        ├── 1. Write results_summary (existing)
                        ├── 2. Fetch agent metrics (new, ~1s)
                        ├── 3. Build prompt (new)
                        ├── 4. callLLM() gpt-4.1-nano (new, ~2-3s)
                        ├── 5. Cache in results_summary.report (new)
                        └── If 2-5 fails → log error, experiment completes fine
                                       │
                                       ▼
                        Report ready when user visits page

                        ┌─────────────────────────────┐
                        │  User clicks "Regenerate"    │
                        │  on Report tab (optional)    │
                        └──────────────┬──────────────┘
                                       │
                                       ▼
              regenerateExperimentReportAction (server action)
                        │
                        ├── Same data gathering + prompt + LLM call
                        └── Overwrites cached report
```

#### Changes to `writeTerminalState()` in experiment-driver cron

**New imports needed in `experiment-driver/route.ts`:**
```tsx
import { callLLM } from '@/lib/services/llms';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';
```

**`callLLM` signature** (from `src/lib/services/llms.ts`):
```tsx
callLLM(prompt, call_source, userid, model, streaming, setText, response_obj?, response_obj_name?, debug?, options?)
```
- `setText` (6th arg) is **required** — must pass `null` when `streaming=false`
- `userid` must be a valid UUID — use `EVOLUTION_SYSTEM_USERID` (`'00000000-0000-4000-8000-000000000001'`)

**Important: Variable mapping to actual `writeTerminalState()` code** (route.ts lines 549-606):
- The function has `allRounds` (line 556) which selects ONLY `batch_run_id` — NOT full round data
- The function has `runs` (line 571) which is block-scoped inside `if (batchIds.length > 0)` and selects `run_summary, config, total_cost_usd, strategy_config_id` — does NOT include `id`
- We need to: (a) hoist `runs` to function scope, (b) add `id` to the runs SELECT, (c) do a separate full-round query for the prompt

**Required modifications to existing `writeTerminalState()` code:**
1. Expand the runs SELECT to include `id`: `.select('id, run_summary, config, total_cost_usd, strategy_config_id')`
2. Hoist `runs` array to function scope (declare before `if` block, assign inside)
3. After the main status UPDATE, fetch full round data for the prompt

```tsx
// MODIFICATION 1: Hoist runs to function scope and add 'id' to SELECT (line 565+)
let completedRuns: Array<Record<string, unknown>> = [];

if (batchIds.length > 0) {
  const { data: runs } = await supabase
    .from('evolution_runs')
    .select('id, run_summary, config, total_cost_usd, strategy_config_id')  // Added 'id'
    .in('batch_run_id', batchIds)
    .eq('status', 'completed');

  completedRuns = runs ?? [];  // Hoist to outer scope

  for (const run of completedRuns) {
    // ... existing bestElo logic unchanged ...
  }
}

// ... existing resultsSummary computation and status UPDATE unchanged ...

// MODIFICATION 2: Fire-and-forget report generation (AFTER the main UPDATE)
try {
  // Fetch full round data for prompt (allRounds above only has batch_run_id)
  const { data: fullRounds } = await supabase
    .from('evolution_experiment_rounds')
    .select('round_number, type, design, status, analysis_results, completed_at')
    .eq('experiment_id', exp.id)
    .order('round_number', { ascending: true });

  // Fetch agent metrics for all completed runs
  const runIds = completedRuns.map(r => r.id as string);
  const { data: agentMetrics } = runIds.length > 0
    ? await supabase
        .from('evolution_run_agent_metrics')
        .select('agent_name, cost_usd, elo_gain, elo_per_dollar, variants_generated')
        .in('run_id', runIds)
    : { data: [] };

  // Build prompt and call LLM
  // NOTE: call_source intentionally omits 'evolution_' prefix to skip LLM semaphore
  const prompt = buildExperimentReportPrompt({
    experiment: exp,
    rounds: fullRounds ?? [],       // Full round data with analysis_results
    runs: completedRuns,            // Hoisted from bestElo loop above
    agentMetrics: agentMetrics ?? [],
    resultsSummary,                 // Computed above (still in scope)
  });

  const reportText = await callLLM(
    prompt,
    'experiment_report_generation',  // no 'evolution_' prefix → skips semaphore
    EVOLUTION_SYSTEM_USERID,         // valid UUID for system-level calls
    REPORT_MODEL,                    // 'gpt-4.1-nano'
    false,                           // streaming
    null,                            // setText (REQUIRED: must be null when streaming=false)
  );

  // Cache report in results_summary (second UPDATE, after main status UPDATE)
  const reportMeta = {
    text: reportText,
    generatedAt: new Date().toISOString(),
    model: REPORT_MODEL,
  };
  await supabase
    .from('evolution_experiments')
    .update({
      results_summary: { ...resultsSummary, report: reportMeta },
    })
    .eq('id', exp.id);

  console.log(`[experiment-driver] Generated report for experiment ${exp.id}`);
} catch (reportError) {
  // Fire-and-forget: log but don't fail experiment completion
  console.error(`[experiment-driver] Failed to generate report for ${exp.id}:`,
    reportError instanceof Error ? reportError.stack : reportError);
}
```

Key points:
- `completedRuns` is hoisted to function scope and `id` is added to the SELECT — both required for agent metrics query
- `fullRounds` is a separate query fetching full round data (the existing `allRounds` only selects `batch_run_id`)
- Runs **after** the main status UPDATE — experiment is already terminal
- `callLLM` uses correct 6-arg signature with `null` for setText and `EVOLUTION_SYSTEM_USERID`
- `call_source` intentionally omits `'evolution_'` prefix to skip LLM semaphore (nano model, infrequent)
- Error logging includes stack trace for debuggability
- Entire block is try/catch — experiment completion never blocked

**Cron timeout mitigation**: The cron processes up to 5 experiments per invocation (30s `maxDuration`). In the unlikely event multiple experiments terminate simultaneously, report generation adds ~3-5s per experiment. Mitigation: report generation runs inside `writeTerminalState()` which only fires for terminal experiments — typically 0-1 per cron tick. If timeout becomes an issue, the report block can be skipped after the first report generation per cron invocation (add a counter).

#### `regenerateExperimentReportAction` (server action for manual refresh)

```tsx
export interface ExperimentReportData {
  report: string;           // LLM-generated narrative text
  generatedAt: string;      // ISO timestamp
  model: string;            // model used for generation
}

const _regenerateExperimentReportAction = withLogging(async (
  input: { experimentId: string },
): Promise<ActionResult<ExperimentReportData>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // 1. Fetch experiment
    const { data: exp } = await supabase
      .from('evolution_experiments')
      .select('*')
      .eq('id', input.experimentId)
      .single();
    if (!exp) throw new Error('Experiment not found');

    // 2. Gather comprehensive data
    const { data: rounds } = await supabase
      .from('evolution_experiment_rounds')
      .select('*')
      .eq('experiment_id', input.experimentId)
      .order('round_number', { ascending: true });

    const batchRunIds = (rounds ?? [])
      .map(r => r.batch_run_id)
      .filter((id): id is string => id !== null);

    // NOTE: evolution_runs does NOT have elo_score column — extract from run_summary JSONB
    const { data: runs } = batchRunIds.length > 0
      ? await supabase
          .from('evolution_runs')
          .select('id, status, run_summary, total_cost_usd, config, batch_run_id')
          .in('batch_run_id', batchRunIds)
      : { data: [] };

    const runIds = (runs ?? []).map(r => r.id);
    const { data: agentMetrics } = runIds.length > 0
      ? await supabase
          .from('evolution_run_agent_metrics')
          .select('agent_name, cost_usd, elo_gain, elo_per_dollar, variants_generated')
          .in('run_id', runIds)
      : { data: [] };

    // 3. Build prompt + call LLM
    const prompt = buildExperimentReportPrompt({
      experiment: exp,
      rounds: rounds ?? [],
      runs: runs ?? [],
      agentMetrics: agentMetrics ?? [],
      resultsSummary: exp.results_summary,
    });

    const reportText = await callLLM(
      prompt,
      'experiment_report_generation',
      EVOLUTION_SYSTEM_USERID,  // valid UUID for system-level calls
      REPORT_MODEL,             // 'gpt-4.1-nano' from experimentReportPrompt.ts
      false,                    // streaming
      null,                     // setText (REQUIRED: must be null when streaming=false)
    );

    // 4. Cache in results_summary.report
    const reportMeta = {
      text: reportText,
      generatedAt: new Date().toISOString(),
      model: REPORT_MODEL,
    };
    const updatedSummary = { ...(exp.results_summary ?? {}), report: reportMeta };
    await supabase
      .from('evolution_experiments')
      .update({ results_summary: updatedSummary })
      .eq('id', input.experimentId);

    return {
      success: true,
      data: {
        report: reportText,
        generatedAt: reportMeta.generatedAt,
        model: REPORT_MODEL,
      },
      error: null,
    };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'regenerateExperimentReportAction') };
  }
}, 'regenerateExperimentReportAction');

export const regenerateExperimentReportAction = serverReadRequestId(_regenerateExperimentReportAction);
```

**Required imports for `experimentActions.ts`:**
```tsx
import { callLLM } from '@/lib/services/llms';
import { EVOLUTION_SYSTEM_USERID } from '@evolution/lib/core/llmClient';
import { buildExperimentReportPrompt, REPORT_MODEL } from '@evolution/services/experimentReportPrompt';
```

#### Prompt builder: `buildExperimentReportPrompt()`

Located in `evolution/src/services/experimentReportPrompt.ts` (separate file for testability).

```tsx
// Builds a structured prompt for LLM-generated experiment analysis reports.
// Extracted to a separate file for unit testing of prompt construction.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

/** Shared model constant — used by both cron and server action. */
export const REPORT_MODEL: AllowedLLMModelType = 'gpt-4.1-nano';

export interface ExperimentReportInput {
  experiment: Record<string, unknown>;
  rounds: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  agentMetrics: Record<string, unknown>[];
  resultsSummary: Record<string, unknown> | null;
}

export function buildExperimentReportPrompt(input: ExperimentReportInput): string {
  // Builds prompt string with defensive null handling for all fields
  // Uses ?? '' / ?? 0 defaults to prevent 'undefined' in prompt text
}
```

The prompt provides the LLM with:
```
You are an experiment analysis expert. Analyze this factorial experiment and write a concise report.

EXPERIMENT: {name}, target: {optimization_target}, budget: ${total}/{spent}
STATUS: {status} after {current_round}/{max_rounds} rounds
TERMINATION: {terminationReason}

FACTOR DEFINITIONS:
{for each factor: name, low value, high value}

ROUND-BY-ROUND ANALYSIS:
{for each round:
  Round N ({type}, {design}): {completed}/{total} runs
  Main Effects: {factor → effect size, direction}
  Factor Rankings: {ranked list}
  Recommendations: {list}
}

RUN RESULTS:
{top 10 runs by Elo: run_id, elo_score, cost, config values}
{bottom 5 runs by Elo for contrast}

AGENT PERFORMANCE:
{for each agent: name, total cost, avg elo gain, avg elo/dollar}

BEST RESULT:
Elo: {bestElo}, Config: {bestConfig}

Write a report with these sections:
1. Executive Summary (2-3 sentences)
2. Key Findings (what factors matter most and why)
3. Optimal Configuration (the winning setup and why it works)
4. Cost Efficiency Analysis (budget usage, agent ROI)
5. Recommendations (actionable next steps)

Be specific with numbers. Reference actual Elo scores, effect sizes, and costs.
```

#### ReportTab.tsx (client component)

```tsx
// Report tab: displays auto-generated LLM analysis with optional regeneration.

interface ReportTabProps {
  experimentId: string;
  status: string;
  resultsSummary: Record<string, unknown> | null;
}
```

- On mount, reads `resultsSummary.report` → displays cached report immediately (no loading)
- If no cached report (pre-existing experiments or generation failed):
  - Terminal experiments: "Report generation failed. Click to retry." + "Generate Report" button
  - In-progress experiments: "Report will be generated when the experiment completes."
- Report text rendered as formatted sections (split on `##` headers → styled divs)
- "Regenerate Report" button at bottom for manual refresh (calls `regenerateExperimentReportAction`)
- Shows generation metadata: model used, timestamp

**Tests:**
- Unit test: `src/app/admin/quality/optimization/experiment/[experimentId]/ReportTab.test.tsx`:
  - Renders report text when `resultsSummary.report` exists (cached)
  - Shows "will be generated" message for in-progress experiments with no report
  - Shows "Generate Report" fallback button for terminal experiments with no report
  - Shows loading spinner during regeneration
  - Displays generation metadata (model, timestamp)
- Unit test: `evolution/src/services/experimentReportPrompt.test.ts`:
  - Prompt construction with complete data
  - Handles zero rounds, no completed runs, empty agentMetrics, null resultsSummary
- Unit test: `evolution/src/services/experimentActions.test.ts` (extend existing):
  - `regenerateExperimentReportAction`: mock `callLLM`, verify data assembly, verify Supabase cache update
- Unit test: `src/app/api/cron/experiment-driver/route.test.ts` (extend existing):
  - Report is generated and cached when `writeTerminalState()` completes successfully
  - Experiment completion is NOT blocked when `callLLM` throws (fire-and-forget verified)
  - `callLLM` is called with correct args: `EVOLUTION_SYSTEM_USERID`, `REPORT_MODEL`, `null` for setText

**Mock strategy for `callLLM` in cron tests:**
```tsx
jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('## Executive Summary\nMock report text'),
}));
```

**Commit checkpoint**: lint + tsc + build + unit tests pass

---

### Phase 6: Polish & Integration Testing

**Goal**: End-to-end verification, cleanup, docs.

**Tasks:**
1. Run full build/lint/tsc check
2. Verify navigation flow: ExperimentHistory → click ID → detail page → tabs work
3. Verify breadcrumb back-navigation works
4. Test with no experiments, active experiment, terminal experiment states
5. Verify report auto-generates on experiment completion (test with cron trigger)
6. Test report regeneration from the UI
7. Update documentation (see Documentation Updates below)
8. Final commit

## Testing

### Unit Tests (per phase, full paths)
| Test File | What It Tests |
|-----------|---------------|
| `src/app/admin/quality/optimization/_components/ExperimentHistory.test.tsx` | ID display, Link href via `buildExperimentUrl` |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.test.tsx` | Status badge, budget bar, factor table, cancel visible/hidden |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.test.tsx` | Tab switching renders correct content |
| `src/app/admin/quality/optimization/experiment/[experimentId]/RoundAnalysisCard.test.tsx` | Main effects table, factor rankings, recommendations, empty data |
| `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.test.tsx` | Run table rendering, links via `buildRunUrl`, empty runs |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ReportTab.test.tsx` | Cached report, no-report states, regenerate loading/metadata |
| `evolution/src/services/experimentActions.test.ts` (extend) | `getExperimentRunsAction` + `regenerateExperimentReportAction` + `extractTopElo` standalone unit tests |
| `evolution/src/services/experimentReportPrompt.test.ts` | Prompt construction, edge cases (empty data, null fields) |
| `src/app/api/cron/experiment-driver/route.test.ts` (extend) | Report generation in `writeTerminalState`, fire-and-forget resilience. Add `jest.mock('@/lib/services/llms')` to top-level mock section (lines 15-100). Verify existing 13+ tests still pass. |

### Mock Strategies
- **Supabase in cron tests**: Use `createChain()` pattern from `route.test.ts` (line 138) — returns `{ data, error }` with chained `.from().select().eq().in()` methods
- **Supabase in server action tests**: Use `chainMock()` pattern from `experimentActions.test.ts`
- **`callLLM` in cron tests**: Add `jest.mock('@/lib/services/llms', ...)` to the top-level mock section of `route.test.ts` (lines 15-100), alongside existing mocks. Must NOT interfere with existing 13+ test cases:
```tsx
jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn().mockResolvedValue('## Executive Summary\nMock report'),
}));
```
- **`callLLM` in server action tests**: Same jest.mock pattern in `experimentActions.test.ts`
- **`buildExperimentReportPrompt`**: Tested directly as pure function (no mocks needed)
- **`extractTopElo`**: Tested directly as pure function with edge cases (null, empty topVariants, ordinal path, elo path)

### Manual Verification
- Navigate to Rating Optimization > Experiments > Experiment History
- Verify experiment IDs are shown and clickable
- Click through to detail page
- Verify all 3 tabs render correctly with real data
- For terminal experiments: verify report is already generated (auto from cron)
- For in-progress experiments: verify "will be generated" message
- Click "Regenerate Report" — verify new report generated
- Test with active, converged, failed, and cancelled experiments
- Verify back-navigation via breadcrumb

### Rollback Plan
If the cron route changes break experiment state transitions:
1. The report generation block is fully isolated in a try/catch — it cannot affect experiment completion
2. To disable report generation without reverting: delete the try/catch block from `writeTerminalState()` (single code block, no other changes depend on it)
3. The `regenerateExperimentReportAction` and `ReportTab` work independently — removing cron generation only means reports won't be auto-generated (users can still click "Generate Report")
4. No migration involved — `results_summary.report` is just a new JSONB key, existing experiments unaffected

## Security Considerations
- Report auto-generation in cron: runs in trusted server context with `requireCronAuth()`
- `regenerateExperimentReportAction` uses `requireAdmin()` — only admin users can regenerate
- No mutations beyond caching the report in `results_summary.report`
- LLM call tracked in `llmCallTracking` table with `experiment_report_generation` source
- No user-controlled input reaches the LLM prompt (all data is from DB) — no prompt injection risk
- Cost per report: ~$0.001 with `gpt-4.1-nano` — negligible even if abused
- Fire-and-forget pattern ensures experiment completion is never blocked by LLM failures

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/article_detail_view.md` — Add cross-reference to experiment detail page as another example of the detail page pattern
- `evolution/docs/evolution/strategy_experiments.md` — Add section about the admin UI experiment detail page, LLM report auto-generation in cron, and navigation flow
- `evolution/docs/evolution/visualization.md` — Add new route `/admin/quality/optimization/experiment/[experimentId]` and document new components
