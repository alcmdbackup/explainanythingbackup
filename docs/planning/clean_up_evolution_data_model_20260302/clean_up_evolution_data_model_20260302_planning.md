# Clean Up Evolution Data Model Plan

## Background
The evolution experiment system has an overly complex data model: `Experiment → Round → Batch → Run` requires 3 intermediate tables and 3 FK hops. Rounds and batches add indirection without proportional value — you can just create a new experiment instead of auto-progressing rounds, and batches are a 1:1 wrapper around rounds. This project eliminates both layers, flattening to `Experiment → Run`.

## Requirements

1. Eliminate `evolution_experiment_rounds` table — absorb useful fields into experiments
2. Eliminate `evolution_batch_runs` table — runs link directly to experiments
3. Add `experiment_id` FK on `evolution_runs`
4. Simplify experiment status machine from 9 states to 6
5. Update experiment driver cron (delete `handlePendingNextRound`, simplify remaining handlers)
6. Update all experiment server actions
7. Update experiment UI components (delete RoundsTab, simplify others)
8. Delete batch infrastructure entirely: `run-batch.ts`, `batchRunSchema.ts`, `evolutionBatchActions.ts`, `evolution-batch.yml`, and "Batch Dispatch" UI button (all runs execute via Vercel serverless)
9. Update all tests
10. Update documentation

## Problem
The current experiment orchestration uses a 3-level hierarchy (`Experiment → Round → Batch → Run`) that adds complexity without proportional value. Rounds automate a screening→refinement loop that could be done manually by creating separate experiments. Batches are a 1:1 wrapper around rounds with redundant status/cost tracking. The experiment driver cron has a complex 3-state machine (`round_running → round_analyzing → pending_next_round`) with 200+ lines dedicated to creating the next round. This project flattens the model to `Experiment → Run`, dropping 2 tables, deleting ~300 lines of orchestration code, and simplifying the state machine.

## Options Considered

1. **Keep rounds, drop batches only** — Simpler migration but keeps the round complexity. Rejected: rounds add minimal value over creating separate experiments.
2. **Keep all 3 tables, add experiment_id as denormalization** — No schema cleanup, just adds a shortcut column. Rejected: doesn't reduce complexity.
3. **Drop both rounds and batches, flatten to Experiment → Run** — Selected. Maximum simplification. Safe because no production experiment data exists.

**Deploy strategy:** All phases (1-7) must be deployed atomically in a single PR. The migration drops columns/tables that code references — deploying Phase 1 alone would break the running application. Since no production experiment data exists, this is safe as a single deployment.

## Phased Execution Plan

### Phase 1: Database Migration
**Goal:** Add `experiment_id` to runs, drop round/batch tables

**Files modified:**
- New migration file in `supabase/migrations/`

**Migration SQL:**
```sql
-- 1. Add experiment_id FK to evolution_runs
ALTER TABLE evolution_runs
  ADD COLUMN experiment_id UUID REFERENCES evolution_experiments(id);
CREATE INDEX idx_evolution_runs_experiment ON evolution_runs(experiment_id);

-- 2. Backfill experiment_id from batch_run_id → round → experiment
UPDATE evolution_runs r SET experiment_id = er.experiment_id
FROM evolution_experiment_rounds er
WHERE er.batch_run_id = r.batch_run_id AND r.batch_run_id IS NOT NULL;

-- 3. Add design + analysis_results to experiments (absorbed from rounds)
ALTER TABLE evolution_experiments
  ADD COLUMN IF NOT EXISTS design TEXT DEFAULT 'L8'
    CHECK (design IN ('L8', 'full-factorial')),
  ADD COLUMN IF NOT EXISTS analysis_results JSONB;

-- 4. Backfill design from first round (if any data exists)
UPDATE evolution_experiments e
SET design = COALESCE(
  (SELECT r.design FROM evolution_experiment_rounds r WHERE r.experiment_id = e.id LIMIT 1),
  'L8'
);

-- 5. Backfill old statuses to new values (BEFORE constraint change)
UPDATE evolution_experiments SET status = 'running' WHERE status IN ('round_running', 'pending_next_round');
UPDATE evolution_experiments SET status = 'analyzing' WHERE status = 'round_analyzing';
UPDATE evolution_experiments SET status = 'completed' WHERE status IN ('converged', 'budget_exhausted', 'max_rounds');

-- 6. Replace status constraint (AFTER backfill)
ALTER TABLE evolution_experiments
  DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;
ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled'));

-- 7. Drop unused columns from experiments
ALTER TABLE evolution_experiments
  DROP COLUMN IF EXISTS current_round,
  DROP COLUMN IF EXISTS max_rounds;

-- 8. Drop batch_run_id from runs, drop stale views
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS batch_run_id;
DROP VIEW IF EXISTS batch_runs CASCADE;

-- 9. Drop intermediate tables
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;
```

**Rollback:** Not possible without backup once tables are dropped. Validated safe because no production experiment data exists (E2E tests are `.describe.skip`, experiment system is unused in prod). If rollback is needed, re-create tables from the original migration SQL in `20260222100003` and `20260205000004`.

**Verification:** Run `npm run tsc` — expect type errors in experiment code (expected, fixed in Phase 2).

---

### Phase 2: Experiment Server Actions
**Goal:** Update `experimentActions.ts` to use flat model

**File:** `evolution/src/services/experimentActions.ts`

| Function | Change |
|----------|--------|
| `startExperimentAction` | Remove batch + round creation. Set `experiment_id` on runs directly. Remove `current_round` and `max_rounds` from insert. Remove `maxRounds` from `StartExperimentInput` interface. |
| `getExperimentStatusAction` | Query runs by `experiment_id` instead of rounds→batch→runs. Return `runCounts` instead of `rounds[]`. |
| `cancelExperimentAction` | Update runs directly: `.eq('experiment_id', id).in('status', ['pending', 'claimed'])` |
| `getExperimentRunsAction` | Query runs by `experiment_id`. Remove `roundNumber` from result. |
| `regenerateExperimentReportAction` | Query runs by `experiment_id`. Remove rounds context from prompt. |
| `listExperimentsAction` | Remove `current_round` from select/mapping. |

**Constants to update:**
```typescript
// TERMINAL_EXPERIMENT_STATES: change from ['converged', 'budget_exhausted', 'max_rounds', 'failed', 'cancelled']
//                             to ['completed', 'failed', 'cancelled']
```

**Interfaces to update:**
```typescript
// ExperimentStatus: remove rounds[], currentRound, maxRounds; add runCounts
// ExperimentRun: remove roundNumber
// ExperimentSummary: remove currentRound, maxRounds
// StartExperimentInput: remove maxRounds. Keep convergenceThreshold (retained in schema for future use)
```

**File:** `evolution/src/services/experimentReportPrompt.ts`
- Update `ExperimentReportInput` interface: remove `rounds` field, accept flat runs array
- Remove "ROUND-BY-ROUND ANALYSIS" section from prompt template
- Pass runs directly instead of rounds array

**File:** `src/app/api/cron/experiment-driver/route.ts` (ExperimentRow type)
- Remove `max_rounds` and `current_round` from `ExperimentRow` interface (lines 32-45)

**Verification:** `npm run tsc` passes. Unit tests will fail (fixed in Phase 4).

---

### Phase 3: Experiment Driver Cron
**Goal:** Simplify state machine from 3 active states to 2

**File:** `src/app/api/cron/experiment-driver/route.ts`

| Handler | Change |
|---------|--------|
| `handleRoundRunning()` | Rename to `handleRunning()`. Query runs by `experiment_id` instead of `batch_run_id`. |
| `handleRoundAnalyzing()` | Rename to `handleAnalyzing()`. Read `design` from experiment. Save `analysis_results` to experiment. Decision logic: if any runs completed → `completed` + writeTerminalState; if all runs failed → `failed`. No convergence/budget/max_rounds branching (single-round = always terminal after analysis). Keep `convergence_threshold` in schema for potential future use but don't gate transitions on it. |
| `handlePendingNextRound()` | **DELETE ENTIRELY** (~200 lines). |
| `writeTerminalState()` | Simplify: query runs by `experiment_id` directly (no batch_run_id hop). Remove `finalRound` from `resultsSummary`. Remove `rounds` parameter from `buildExperimentReportPrompt` call. |
| `GET()` handler | `ACTIVE_STATES = ['running', 'analyzing']`. Remove `pending_next_round` case. |
| `ExperimentRow` type | Remove `max_rounds`, `current_round` fields. Add `design` field. |

**Verification:** `npm run tsc` passes. Cron test will fail (fixed in Phase 4).

---

### Phase 4: Tests
**Goal:** Update all test files for flat model, delete tests for deleted code

**Files to DELETE:** `batchRunSchema.test.ts`, `evolutionBatchActions.test.ts` (code deleted in Phase 6)

**Files to update (11):**

| File | Tests | Key Changes |
|------|-------|-------------|
| `experimentActions.test.ts` | ~39 tests across 7 describe blocks | Remove batch/round mocks. Mock runs with `experiment_id`. Update assertions for `runCounts` instead of `rounds[]`. Update `TERMINAL_EXPERIMENT_STATES` references. Remove `maxRounds`/`currentRound` from fixtures. |
| `experiment-driver/route.test.ts` | ~25 tests | Remove all round/batch mocking. Simplify state machine tests to 2-state. Delete `pending_next_round` tests (6 tests). Delete `round_analyzing` tests that test multi-round progression. Add flat `running → analyzing → completed` tests. Update `ExperimentRow` mock to exclude `max_rounds`/`current_round`. |
| `admin-experiment-detail.spec.ts` | 4 tests (skipped) | Rewrite seeding: remove round/batch table inserts. Set `experiment_id` on runs. Update cleanup to not reference dropped tables. |
| `experimentReportPrompt.test.ts` | 4 tests | Remove rounds from mock data. Update `ExperimentReportInput` mock to use flat runs. |
| `ExperimentDetailTabs.test.tsx` | 3 tests | Update tab expectations (Analysis + Runs + Report, no Rounds tab). |
| `RunsTab.test.tsx` | 3 tests | Remove round grouping assertions. Remove `roundNumber` from mock runs. |
| `RoundAnalysisCard.test.tsx` | 7 tests | Repurpose as `ExperimentAnalysisCard.test.tsx`. Update props from `round` to `experiment`. |
| `ExperimentHistory.test.tsx` | 2 tests | Remove `currentRound`/`maxRounds` from mock data. Update status color mapping for new states. |
| `ReportTab.test.tsx` | 4 tests | Update mock status values: replace `round_running` with `running` in mock data. Update `TERMINAL_STATES` set. |
| `ExperimentOverviewCard.test.tsx` | 6 tests | Remove `maxRounds`/`currentRound`/`rounds` from mock ExperimentStatus. Update status values: `round_running` → `running`, `converged` → `completed`. |
| `ExperimentForm.test.tsx` | 13 tests | Verify "Max Rounds" input no longer renders. Remove `maxRounds` from mock `StartExperimentInput` calls. |

**Verification:** `npm run test -- --testPathPattern experiment` passes.

---

### Phase 5: UI Components
**Goal:** Update experiment admin pages + remove batch dispatch UI

| Component | Action | Change |
|-----------|--------|--------|
| `RoundsTab.tsx` | **DELETE** | Entire file removed |
| `RoundAnalysisCard.tsx` | **REPURPOSE** | Rename to `ExperimentAnalysisCard`. Accept `experiment: ExperimentStatus` prop. Show single analysis. |
| `ExperimentDetailTabs.tsx` | SIMPLIFY | 2 tabs: Analysis + Runs (+ Report). Remove Rounds tab. |
| `RunsTab.tsx` | SIMPLIFY | Remove `byRound` grouping. Flat table of all runs. |
| `ExperimentOverviewCard.tsx` | SIMPLIFY | Remove "Round X/Y" display. Show run progress instead. Update `STATE_BADGES` and `ACTIVE_STATES` maps to use 6 new states (`pending`, `running`, `analyzing`, `completed`, `failed`, `cancelled`). |
| `ExperimentStatusCard.tsx` | SIMPLIFY | Remove rounds section + current round progress. Update `ACTIVE_STATES` and `STATE_LABELS` maps to 6-state model. |
| `ExperimentHistory.tsx` | SIMPLIFY | Remove per-round expansion (`detail.rounds.map(...)` loop). Remove "Round X/Y" text from ExperimentRow. Update `STATE_COLORS` map to 6-state model. Replace rounds expansion with flat `runCounts` display. |
| `ExperimentForm.tsx` | SIMPLIFY | Remove "Max Rounds" input field and `maxRounds` state variable. Update form grid from 3 columns to 2. Remove `maxRounds` from `startExperimentAction` call. |
| `ReportTab.tsx` | SIMPLIFY | Update `TERMINAL_STATES` set to `['completed', 'failed', 'cancelled']`. |
| `src/app/admin/quality/evolution/page.tsx` | SIMPLIFY | Delete entire `BatchDispatchButtons` component (lines 342-409) — it contains 3 buttons: "Run Next Pending" (keep as standalone), "Batch Dispatch" (delete), "Trigger All Pending" (delete). Extract the "Run Next Pending" button inline where `<BatchDispatchButtons>` was used (~line 730). Remove `import { dispatchEvolutionBatchAction }`. |

**Verification:** `npm run build` passes. Manual check of `/admin/quality/optimization` and `/admin/quality/evolution` pages.

---

### Phase 6: Delete Batch Infrastructure + Update CLI Scripts
**Goal:** Remove all batch-related code (runs execute only via Vercel serverless)

**Files to DELETE entirely:**

| File | Reason |
|------|--------|
| `evolution/scripts/run-batch.ts` | CLI batch runner — replaced by Vercel serverless execution |
| `src/config/batchRunSchema.ts` | Batch config schemas — only used by `run-batch.ts` |
| `src/config/batchRunSchema.test.ts` | Tests for deleted schema |
| `evolution/src/services/evolutionBatchActions.ts` | GitHub Actions dispatch action — no longer needed |
| `evolution/src/services/evolutionBatchActions.test.ts` | Tests for deleted action |
| `.github/workflows/evolution-batch.yml` | GitHub Actions batch workflow — no longer needed. Note: this workflow calls `evolution-runner.ts` (not `run-batch.ts`). `evolution-runner.ts` itself is retained (no batch dependencies) but will have no GitHub Actions trigger. It remains useful for local/manual execution if needed. |

**Files to UPDATE:**

| File | Change |
|------|--------|
| `evolution/scripts/backfill-prompt-ids.ts` | Remove `batch_run_id` from select. Simplify origin classification (always `'system'`). |
| `scripts/run-strategy-experiment.ts` | No change needed (file-based rounds are orthogonal). |

---

### Phase 7: Documentation
**Goal:** Update evolution docs to reflect new model

| Doc | Change |
|-----|--------|
| `evolution/docs/evolution/data_model.md` | Update conceptual model diagram. Remove Round/Batch from primitives. Add `experiment_id` to Run description. |
| `evolution/docs/evolution/reference.md` | Remove `evolution_experiment_rounds` and `evolution_batch_runs` from schema. Remove batch runner CLI docs and `evolution-batch.yml` workflow section. Update experiment status states. |
| `evolution/docs/evolution/strategy_experiments.md` | Rewrite experiment lifecycle section. Remove 9-state machine, document 6-state. Remove round-based workflow. |
| `evolution/docs/evolution/cost_optimization.md` | Remove all references to `run-batch.ts`, `batchRunSchema.ts`, `evolution_batch_runs` table, and batch experiment CLI commands (~lines 118-297). |
| `docs/docs_overall/environments.md` | Remove "Evolution Batch Runner (`evolution-batch.yml`)" section. |

---

### Phase 8: Final Verification
**Goal:** All checks green

```bash
npm run lint
npm run tsc
npm run build
npm run test              # unit tests
npm run test:integration  # integration tests
npm run test:e2e          # E2E tests
```

Fix any remaining issues.

## Testing

### Unit Tests to Delete
- `src/config/batchRunSchema.test.ts` — tests for deleted batch schema
- `evolution/src/services/evolutionBatchActions.test.ts` — tests for deleted batch dispatch action

### Unit Tests to Modify
- `experimentActions.test.ts` — ~39 tests across 7 blocks, remove round/batch mocks, update TERMINAL_EXPERIMENT_STATES
- `experiment-driver/route.test.ts` — ~25 tests, complete state machine rewrite (delete pending_next_round block)
- `experimentReportPrompt.test.ts` — 4 tests, remove rounds from mock data
- `RoundAnalysisCard.test.tsx` — 7 tests, repurpose as `ExperimentAnalysisCard.test.tsx`
- `ExperimentDetailTabs.test.tsx` — 3 tests, update tab expectations
- `RunsTab.test.tsx` — 3 tests, remove round grouping assertions
- `ExperimentHistory.test.tsx` — 2 tests, remove currentRound/maxRounds from mocks
- `ReportTab.test.tsx` — 4 tests, update `round_running` status in mock data to `running`

### New Test Cases to Add
- Flat experiment creation (runs get `experiment_id` directly)
- Direct `experiment_id` → runs querying
- Experiment cancellation via `experiment_id` filter
- Report generation without rounds context
- Cron: `running → analyzing → completed` happy path
- Cron: all runs failed → `failed` terminal state

### E2E Tests
- `admin-experiment-detail.spec.ts` — update seeding (currently skipped, update for when re-enabled)

### Manual Verification
- Create experiment via `/admin/quality/optimization` form
- Verify runs appear in flat list
- Verify analysis displays after completion
- Verify report generation works

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Remove Round/Batch from primitives, add experiment_id to Run
- `evolution/docs/evolution/reference.md` - Remove dropped tables, remove batch runner CLI docs, remove `evolution-batch.yml` workflow docs, update status states
- `evolution/docs/evolution/strategy_experiments.md` - Rewrite experiment lifecycle, 9→6 state machine
- `evolution/docs/evolution/architecture.md` - Update experiment references if any
- `evolution/docs/evolution/cost_optimization.md` - Update if batch cost tracking referenced
