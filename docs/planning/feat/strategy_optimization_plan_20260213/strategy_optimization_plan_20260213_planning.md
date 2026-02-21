# Strategy Optimization Plan

## Background
Build a systematic way to learn insights about which strategies are most effective for generating high Elo articles via the evolution pipeline. This involves analyzing strategy performance data, identifying patterns in configuration choices that lead to higher quality outputs, and surfacing actionable recommendations for optimizing pipeline runs.

## Requirements (from GH Issue #419)
- Systematic exploration of the pipeline's configuration search space (generation model, judge model, iterations, agent selection)
- Find Elo-optimal configurations under cost constraints ($10-25 budget)
- Use rigorous statistical experiment design (fractional factorial / Taguchi L8)
- Iterative refinement: each round's results inform the next round's design
- CLI-driven execution with results viewable in existing dashboards
- Add gpt-5.2 model support for future experimentation

## Problem
The evolution pipeline has thousands of possible configurations but no structured way to learn which ones maximize Elo per dollar. With <10 existing runs and a $10-25 experimentation budget, a brute-force grid search is infeasible. We need a statistically principled approach that maximizes information per run, with the ability to iterate and refine.

## Options Considered
1. **Preset Anchoring + One-at-a-Time** — Run 3 presets, then vary one dimension from the best. Simple but misses interaction effects.
2. **Fractional Factorial Design (CHOSEN)** — L8 orthogonal array testing 5 factors in 8 runs. Statistically principled, separates main effects, detects interactions. Supports iterative rounds.
3. **Sequential Halving (Tournament)** — Start with 6-8 configs, eliminate bottom half. Adaptive but high variance from single runs with this budget.

Full design details in: `strategy_optimization_plan_20260213_design.md`

## Phased Execution Plan

**Phase dependencies:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Each phase depends on the previous completing. Phase 3 (`run` command) requires Phase 1 flags to exist on `run-evolution-local.ts`. Phase 3 (`analyze` command) requires Phase 2 analysis engine. Phase 4 extends Phase 3's CLI. Phase 5 documents everything built in Phases 1-4.

### Phase 1: Prerequisite Plumbing
1. Verify `gpt-5.2` routing works end-to-end in `src/lib/services/llms.ts` (already in schema/pricing; verify `callLLMModel` routes correctly)
2. Add `--judge-model` flag to `scripts/run-evolution-local.ts`
3. Add `--enabled-agents` flag to `scripts/run-evolution-local.ts`
4. Unit tests for new flags

### Phase 2: Experiment Engine
1. Create `src/lib/evolution/experiment/factorial.ts` — L8 orthogonal array generation, factor-to-config mapping
2. Create `src/lib/evolution/experiment/analysis.ts` — Main effects, interaction effects, factor ranking, recommendations
3. Unit tests for both modules

### Phase 3: Experiment CLI
1. Create `scripts/run-strategy-experiment.ts` — plan/run/analyze/status commands
2. Implement `plan` command: generate L8 matrix, estimate costs, display table
3. Implement `run` command: pre-flight validation (verify `--judge-model` and `--enabled-agents` flags exist on `run-evolution-local.ts` by running with `--help`), sequential execution via execFileSync with 20-minute timeout, progress logging, per-run state persistence (resume on failure), `--retry-failed` flag, auto-analyze at end
4. Implement `analyze` command: query DB for results, compute main effects, print recommendations
5. Implement `status` command: read experiment state file
6. Experiment state persistence to `experiments/strategy-experiment.json`
7. CLI tests

### Phase 4: Round 2+ Support
1. Add `--vary` and `--lock` flags for follow-up experiments
2. Generate arbitrary factorial designs from user-specified factors/levels
3. Round chaining in the state file

### Phase 5: Documentation
1. Create `docs/evolution/strategy_experiments.md` feature deep dive
2. Update `docs/evolution/cost_optimization.md` with cross-reference
3. Update `docs/evolution/reference.md` with new CLI commands and key files
4. Update `docs/evolution/data_model.md` with experiment state notes
5. Add doc-mapping entries for new files
6. Update `_status.json` relevantDocs

## Testing

### Unit tests
- `src/lib/evolution/experiment/factorial.test.ts` — L8 array generation, factor mapping, orthogonality verification
- `src/lib/evolution/experiment/analysis.test.ts` — Main effects computation, interaction effects, ranking, recommendation generation
- `scripts/run-strategy-experiment.test.ts` — CLI arg parsing, plan generation, state file persistence, analyze from mock data
- `scripts/run-evolution-local.test.ts` — Tests for `--judge-model` and `--enabled-agents` flag parsing, validation of comma-separated agent names against known agents, passthrough to config object

### Integration test
- `src/__tests__/integration/strategy-experiment.integration.test.ts` — End-to-end `plan → run → analyze` flow using a mock `run-evolution-local.ts` stub that writes synthetic DB records. Verifies state file progression and analysis output format.

### Mock data structure for analysis tests
Analysis tests use synthetic run results matching the state file schema:
```typescript
const mockRuns: ExperimentRun[] = [
  { row: 1, runId: 'mock-1', status: 'completed', topElo: 1650, costUsd: 0.82 },
  { row: 2, runId: 'mock-2', status: 'completed', topElo: 1720, costUsd: 1.45 },
  // ... all 8 rows with known Elo/cost values chosen to produce predictable main effects
];
```

### Manual verification
- Run `plan --round 1` and verify the 8-run matrix matches the design doc
- Run a single experiment run (cheapest config) to verify end-to-end flow
- Verify results appear in optimization dashboard, Hall of Fame, and explorer
- Run `analyze` on mock data to verify main effects output

## Documentation Updates
The following docs were identified as relevant and may need updates:
- **NEW**: `docs/evolution/strategy_experiments.md` - Feature deep dive for the experiment system
- `docs/evolution/cost_optimization.md` - Add cross-reference to strategy_experiments.md
- `docs/evolution/reference.md` - Add new CLI commands, key files, new flags on run-evolution-local.ts
- `docs/evolution/data_model.md` - Note experiment state in experiments/ JSON files
- `docs/evolution/architecture.md` - No changes expected
- `docs/evolution/rating_and_comparison.md` - No changes expected
- `docs/evolution/agents/tree_search.md` - No changes expected
- `docs/evolution/agents/generation.md` - No changes expected
- `docs/evolution/visualization.md` - No changes expected (reusing existing dashboards)
- `docs/evolution/hall_of_fame.md` - No changes expected
