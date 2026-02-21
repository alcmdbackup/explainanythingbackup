# Update Evolution Docs Research

## Problem Statement
Update evolution pipeline docs to reflect the current codebase state after recent reorganization and feature additions. Specifically ensure pipeline continuation and Vercel timeout handling are well-documented.

## Requirements (from GH Issue #472)
- Update all evolution docs to make sure they are up to date
- Specifically make sure we have documented how pipeline continuation works and Vercel's timeouts

---

## Round 1 Summary (Completed)

The first audit found **39 discrepancies** (8 high, 15 medium, 16 low) and all were addressed across 5 phased commits:
1. `aa19a0da` — Pipeline continuation & Vercel timeout documentation
2. `d09c9782` — 8 high-severity factual fixes
3. `6f490589` — 15 medium-severity fixes
4. `250e76ca` — 16 low-severity omissions
5. `04d058ca` — Final consistency pass

---

## Round 2: Validation Audit (2026-02-19)

Fresh audit of all 15 evolution docs against live codebase using 5 parallel research agents. Found **19 remaining discrepancies** — 2 high-severity, 9 medium-severity, 8 low-severity.

### Why These Were Missed
- **Incomplete fixes**: Some Round 1 fixes applied to one doc but not another (e.g., `section_edited` fixed in editing.md but still wrong in overview.md)
- **Deeper analysis needed**: Round 1 fixed surface-level claims but missed nuanced mechanics (e.g., two separate cache systems with different gating logic)
- **README.md not audited**: Round 1 focused on the 14 content docs; README.md summary line was never checked
- **New doc not audited**: `flow_critique.md` was not in the original 14-doc list

---

## Round 2 Discrepancies

### HIGH Severity (factually wrong, misleading)

| # | Document | Line | Claim | Reality | Code Reference |
|---|----------|------|-------|---------|----------------|
| R2-1 | reference.md | 168 | `diversityHistory`: Array of `{iteration, score}` | Flat `number[]` — supervisor pushes raw scores | `types.ts:574`, `supervisor.ts:32,270` |
| R2-2 | rating_and_comparison.md | 17 | `updateDraw` applied when `confidence < 0.7` | `isDraw` only when `confidence === 0 \|\| winnerId === loserId`; the 0.7 threshold is for early-exit decisions only | `calibrationRanker.ts:78-89` |

### MEDIUM Severity (wrong counts, stale names, partial inaccuracies)

| # | Document | Line | Claim | Reality | Code Reference |
|---|----------|------|-------|---------|----------------|
| R2-3 | reference.md | 293 | `evolutionActions.ts` has "9 server actions" | 13 exported actions (missing `estimateRunCostAction`, `getEvolutionRunByIdAction`, `getEvolutionRunLogsAction`, `killEvolutionRunAction`) | `evolutionActions.ts` exports |
| R2-4 | overview.md | 52 | SectionDecompositionAgent output prefix: `section_edited` | Actual: `section_decomposition_*` (was fixed in editing.md but not overview.md) | `sectionDecompositionAgent.ts:178` |
| R2-5 | overview.md | 52 | SectionDecompositionAgent writes `sectionState` | Agent never writes `state.sectionState` in `execute()` | `sectionDecompositionAgent.ts` (full file) |
| R2-6 | rating_and_comparison.md | 34 | Cache uses `confidence > 0.3` threshold | Two separate caches: `comparison.ts` Map uses `> 0.3`; `ComparisonCache` class uses `winnerId !== null \|\| isDraw` (no confidence check) — doc conflates them | `comparisonCache.ts:28-33`, `comparison.ts:141` |
| R2-7 | hall_of_fame.md | 35 | "10 models" in UI selector | 12 models: missing `gpt-4o-mini`, `gpt-4.1-nano`, `gpt-5.2`, `gpt-5.2-pro`; Anthropic is `claude-sonnet-4-20250514` not `claude-sonnet-4` | `schemas.ts:118-124` |
| R2-8 | hall_of_fame.md | 151 | Method 4 is "outline-based oneshot (deepseek-chat)" | Method 4 (`evolution_deepseek`) has `type: 'evolution', mode: 'minimal'` — it's a minimal evolution run, not a oneshot | `promptBankConfig.ts:56-63` |
| R2-9 | visualization.md | 144-145 | "Other tabs load data once on selection" | Timeline, Elo, and Logs tabs all poll via `useAutoRefresh`; only Variants and Lineage load once | `TimelineTab.tsx`, `EloTab.tsx`, `LogsTab.tsx` |
| R2-10 | README.md | 24 | "8 server actions" for visualization | `evolutionVisualizationActions.ts` exports 12 server actions | `evolutionVisualizationActions.ts` |
| R2-11 | README.md | 24 | "6 tabs" in run detail | Run detail page has 5 tabs: Timeline, Elo, Lineage, Variants, Logs | `run/[runId]/page.tsx:25-31` |

### LOW Severity (minor omissions, imprecise wording)

| # | Document | Line | Claim | Reality | Code Reference |
|---|----------|------|-------|---------|----------------|
| R2-12 | architecture.md | 125 | `markRunFailed()` guard: "only transitions from pending/claimed/running" | Guard also includes `continuation_pending` | `persistence.ts:104` |
| R2-13 | overview.md | 35-36 | "Each comparison's forward+reverse rounds run sequentially via `run2PassReversal()`" | True for CalibrationRanker, but Tournament uses `PairwiseRanker.compareWithBiasMitigation()` which runs both passes **concurrently** via `Promise.all` | `pairwiseRanker.ts:185` |
| R2-14 | flow_critique.md | 29,57 | References `comparePairFlow()` as public API | `comparePairFlow` is private; public method is `compareFlowWithBiasMitigation()` | `pairwiseRanker.ts:226,245` |
| R2-15 | flow_critique.md | (implicit) | FlowCritique parallelism not documented | FlowCritique runs sequentially (`parallel: false`), unlike ReflectionAgent which is parallel | `pipeline.ts:631` |
| R2-16 | support.md | 59 | "Requires 2+ rated non-baseline variants" | `canExecute()` checks `countNonBaseline() >= 2` — pool count only, doesn't check ratings | `debateAgent.ts:402-404,16-19` |
| R2-17 | rating_and_comparison.md | 60 | "5-outcome truth table" for diff comparison | Only 3 verdict values (`ACCEPT \| REJECT \| UNSURE`); counter-intuitively, disagreement → high confidence, agreement → UNSURE | `diffComparison.ts:118-129` |
| R2-18 | hall_of_fame.md | 30 | Elo score formula shows only winner-A case | Omits loser formula (`0.5 - 0.5 * confidence`) and TIE (`0.5`) | `hallOfFameActions.ts:457-460` |
| R2-19 | cost_optimization.md | 249-252 | Key Files table omits `costAnalyticsActions.ts` | File exports `getCostAccuracyOverviewAction` and `getStrategyAccuracyAction` used by Cost Accuracy tab | `costAnalyticsActions.ts` |

---

## Pipeline Continuation: Full Documentation (from Code)

### End-to-End Flow

1. **Cron fires** → `route.ts` (maxDuration=800s) calls `claim_evolution_run` RPC
2. **RPC priority**: `continuation_pending` (priority 0) before `pending` (priority 1), using `FOR UPDATE SKIP LOCKED`
3. **Resume detection**: `isResume = (claimedRun.continuation_count ?? 0) > 0`
4. **If resume**: `loadCheckpointForResume()` → `prepareResumedPipelineRun()` → restores state/cost/cache
5. **Execute**: `executeFullPipeline(runId, agents, ctx, logger, { maxDurationMs: 740000, continuationCount, supervisorResume, ... })`
6. **Timeout check** (each iteration start): `elapsedMs > maxDurationMs - safetyMargin` where margin = `min(120s, max(60s, 10% elapsed))`
7. **On timeout**: `checkpointAndMarkContinuationPending()` calls `checkpoint_and_continue` RPC — atomic checkpoint + status transition `running → continuation_pending` + clear `runner_id` + increment `continuation_count`
8. **Next cron cycle** (5 min later): same flow, RPC picks up continuation_pending run
9. **Guard rails**: MAX_CONTINUATIONS=10; watchdog abandons continuation_pending after 30 min; watchdog recovers stale `running` runs with checkpoints into continuation_pending

### Vercel Timeout Configuration
- `export const maxDuration = 800` (Vercel Pro Fluid Compute max, ~13 minutes)
- Pipeline budget: `(800 - 60) * 1000 = 740,000 ms` (12 min 20 sec)
- Safety margin: dynamic 60-120 seconds based on 10% of elapsed time

### Key Differences by Runner
| Feature | Cron Runner | Batch Runner | Inline Trigger |
|---------|-------------|--------------|----------------|
| maxDurationMs | 740,000 ms | Not set (no timeout) | Not set |
| continuationCount | From DB | From DB | Not passed |
| Resume support | Full | Full | None |
| Timeout yielding | Yes | No (runs to completion) | No |

### Atomic checkpoint_and_continue RPC (migration 20260216000001)
- Upserts checkpoint to `evolution_checkpoints`
- Transitions status `running → continuation_pending` (guarded by `WHERE status = 'running'`)
- Clears `runner_id`, increments `continuation_count`
- Updates `current_iteration`, `phase`, `last_heartbeat`, `total_cost_usd`

### Watchdog Behavior (evolution-watchdog route.ts)
1. **Stale running/claimed** (>10 min heartbeat, configurable via `EVOLUTION_STALENESS_THRESHOLD_MINUTES`):
   - If recent checkpoint exists → transition to `continuation_pending` (recovery path)
   - If no checkpoint → mark `failed`
2. **Stale continuation_pending** (>30 min): mark `failed` with "abandoned" message

---

## Documents Audited

### All 15 Evolution Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/flow_critique.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/strategy_experiments.md

## Key Code Files Cross-Referenced
- evolution/src/lib/core/pipeline.ts (653 LOC)
- evolution/src/lib/core/supervisor.ts
- evolution/src/lib/core/persistence.ts
- evolution/src/lib/core/comparisonCache.ts
- evolution/src/lib/core/critiqueBatch.ts
- evolution/src/lib/comparison.ts
- evolution/src/lib/diffComparison.ts
- evolution/src/lib/types.ts
- evolution/src/lib/config.ts
- evolution/src/lib/index.ts
- evolution/src/lib/agents/pairwiseRanker.ts
- evolution/src/lib/agents/sectionDecompositionAgent.ts
- evolution/src/lib/agents/calibrationRanker.ts
- evolution/src/lib/agents/debateAgent.ts
- evolution/src/services/evolutionActions.ts
- evolution/src/services/evolutionVisualizationActions.ts
- evolution/src/services/hallOfFameActions.ts
- evolution/src/services/costAnalyticsActions.ts
- evolution/src/config/promptBankConfig.ts
- evolution/src/components/evolution/AutoRefreshProvider.tsx
- evolution/src/components/evolution/tabs/TimelineTab.tsx
- evolution/src/components/evolution/tabs/EloTab.tsx
- evolution/src/components/evolution/tabs/LogsTab.tsx
- src/lib/schemas/schemas.ts
- src/app/api/cron/evolution-runner/route.ts
- src/app/api/cron/evolution-watchdog/route.ts
- src/app/admin/quality/evolution/run/[runId]/page.tsx
