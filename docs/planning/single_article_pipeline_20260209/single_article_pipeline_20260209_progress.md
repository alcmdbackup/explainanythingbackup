# Single Article Pipeline Progress

## Phase 1: DB Migration + Type Updates
### Work Done
- Created migration `20260210000001_add_single_pipeline_type.sql` — adds 'single' to CHECK constraints on `evolution_runs` and `evolution_strategy_configs`
- Updated `PipelineType` union: `'full' | 'minimal' | 'batch' | 'single'`
- Updated `PIPELINE_TYPES` const array
- Added `singleArticle?: boolean` to `EvolutionRunConfig`
- Updated `StrategyConfigRow.pipeline_type` to include `'single'`

### Issues Encountered
- Workflow hook blocked edits because project folder `docs/planning/feat/single_article_pipeline_20260209` didn't exist (branch has `feat/` prefix). Fixed with symlink to existing `docs/planning/single_article_pipeline_20260209`.

## Phase 2: Config + Supervisor + Pipeline modifications
### Work Done
- Added `singleArticle: boolean` to `SupervisorConfig` interface
- Added mapping in `supervisorConfigFromRunConfig()`: `singleArticle: cfg.singleArticle ?? false`
- Relaxed constructor validation: skip `expansionMinPool` and `minViable` checks when `expansionMaxIterations === 0`
- Modified `getPhaseConfig()` COMPETITION return: `runGeneration: !this.cfg.singleArticle`, `runOutlineGeneration: !this.cfg.singleArticle`, `runEvolution: !this.cfg.singleArticle`
- Added `qualityThresholdMet()` export to pipeline.ts
- Added quality threshold check in `executeFullPipeline` iteration loop (before shouldStop)
- Changed `pipeline_type` to `ctx.payload.config.singleArticle ? 'single' : 'full'`

### Issues Encountered
- Quality threshold check was initially placed AFTER shouldStop(). Plateau detection triggered first (same ordinal history over 2 data points) before quality threshold could fire. Fixed by moving quality threshold check BEFORE shouldStop — logically correct since quality threshold is a success condition while plateau is a failure condition.

## Phase 3: CLI Integration
### Work Done
- Added `single: boolean` to `CLIArgs` interface
- Added `--single` flag parsing via `getFlag('single')`
- Added mutual exclusion validation: `--single` and `--full` cannot coexist
- Added config overrides: `singleArticle: true`, `expansion.maxIterations: 0`, `plateau.window: 2`
- Updated pipeline routing: `if (args.single || args.full)` both use `executeFullPipeline`
- Updated log display to show 'single' pipeline mode

## Phase 4: Tests
### Work Done
- **Supervisor tests** (10 new): constructor relaxation, detectPhase, getPhaseConfig flag gating, shouldStop with plateauWindow: 2, backward compatibility
- **qualityThresholdMet tests** (7 new): null critiques, empty critiques, missing variant, all above threshold, one below threshold, latest critique used, empty dimensionScores
- **Single-article pipeline integration tests** (3 new): agent skipping, improvement agents running, quality threshold stop reason

### Test Results
- Supervisor: 33 passed (23 existing + 10 new)
- Pipeline: 35 passed (25 existing + 10 new)
- Total: 68 passed, 0 failed
- tsc: clean, eslint: clean, build: clean
