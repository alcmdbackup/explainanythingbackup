# Display Experiment Details Evolution Progress

## Phase 1: Show Experiment ID + Link in ExperimentHistory
### Work Done
- Added `buildExperimentUrl()` to `evolution/src/lib/utils/evolutionUrls.ts`
- Modified `ExperimentHistory.tsx`: wrapped experiment name in Link, added truncated ID below
- Added `ExperimentHistory.test.tsx` with 2 tests (link href, ID display)
- All checks pass: lint, tsc, build, 2/2 tests

## Phase 2: Experiment Detail Page (Overview)
### Work Done
- Created `page.tsx` server component at `/admin/quality/optimization/experiment/[experimentId]/`
- Created `ExperimentOverviewCard.tsx` with status badge, budget bar, metadata grid, factor table, cancel button
- Created `ExperimentDetailTabs.tsx` with Rounds / Runs / Report tabs
- Added `ExperimentOverviewCard.test.tsx` (6 tests) and `ExperimentDetailTabs.test.tsx` (3 tests)
- All checks pass: lint, tsc, 9/9 tests

## Phase 3: Rounds Tab
### Work Done
- Created `RoundsTab.tsx` rendering per-round cards
- Created `RoundAnalysisCard.tsx` with main effects table, factor rankings, recommendations, warnings
- Added `RoundAnalysisCard.test.tsx` (7 tests)

## Phase 4: Runs Tab + Server Action
### Work Done
- Created `RunsTab.tsx` with run table grouped by round, links via buildRunUrl()
- Added `getExperimentRunsAction` to experimentActions.ts
- Extracted `extractTopElo()` to separate experimentHelpers.ts (use server async constraint)
- Added 6 extractTopElo standalone tests

## Phase 5: Auto-Generated LLM Report + Report Tab
### Work Done
- Created `experimentReportPrompt.ts` with buildExperimentReportPrompt() and REPORT_MODEL
- Added `regenerateExperimentReportAction` to experimentActions.ts
- Modified writeTerminalState() in experiment-driver cron with fire-and-forget report generation
- Created `ReportTab.tsx` with cached report display, no-report states, regenerate button
- Added experimentReportPrompt.test.ts (4 tests), ReportTab.test.tsx (4 tests)
- All existing cron tests (20/20) still pass

## Phase 6: Polish
### Work Done
- Final tsc: clean
- Final lint: clean (all modified/new files)
- Build: fails on pre-existing lint warnings (baseline also fails)
- All tests: 86/86 pass across 10 suites
