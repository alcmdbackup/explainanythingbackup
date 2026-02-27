# Analyze Initial Evolution Experiment Batch Plan

## Background
Analyze our existing evolution experiments to get initial learnings and develop follow-up experiments.

## Requirements (from GH Issue #568)
1. Query completed evolution runs and extract key metrics (Elo, cost, iterations, stop reason)
2. Analyze which strategy factors (model, judge, iterations, agents) had the largest impact on quality
3. Compare cost-efficiency (elo_per_dollar) across strategies
4. Identify convergence patterns and failure modes
5. Document initial findings in research doc
6. Design follow-up experiments based on learnings
7. Create actionable recommendations for experiment round 2

## Problem

We have a growing set of evolution runs in the database but no systematic analysis of what's working. Strategy configs vary across generation model, judge model, iteration count, editor type, and agent suite — but we don't know which factors drive quality vs cost. The Hall of Fame has entries from both oneshot and evolution methods but we haven't compared them quantitatively. Without this analysis, follow-up experiments will be uninformed guesses rather than data-driven refinements.

## Options Considered

### Option A: Pure SQL analysis (rejected)
- Write raw SQL queries against Supabase directly
- **Pros**: No code to maintain, immediate results
- **Cons**: Hard to version/share, no unit testing, no reusable structure, no programmatic output formatting

### Option B: Analysis script with console output (chosen)
- TypeScript script querying Supabase, with exported pure functions for each analysis dimension
- **Pros**: Testable, reusable, version-controlled, structured output, pure helpers can be unit-tested without DB
- **Cons**: Requires DB access to run (mitigated by making helpers testable independently)

### Option C: Dashboard-only analysis (rejected)
- Build new admin dashboard views for each analysis dimension
- **Pros**: Interactive, shareable with non-technical team
- **Cons**: Much larger scope, premature before we know what metrics matter, better as follow-up after initial findings

## Phased Execution Plan

### Phase 1: Analysis Script & Tests (DONE)
- [x] Create `evolution/scripts/analyze-experiments.ts` with 8 analysis sections
- [x] Export pure helper functions: `analyzeRuns`, `analyzeStrategies`, `analyzeAgents`, `analyzeHofEntries`, `extractTopElo`, `extractStopReason`, `extractBaselineRank`, `countBy`, `avg`, `stddev`
- [x] Create `evolution/scripts/analyze-experiments.test.ts` — 31 unit tests covering all helpers
- [x] Pass lint, tsc, and all tests

### Phase 2: Run Analysis Against Database (DONE)
- [x] Run analysis against dev DB via `analyze-experiments.ts`
- [x] Run production analysis via `query-prod.ts` (readonly_local role, session pooler)
- [x] Capture outputs to `analysis_output_raw.txt` (dev) and `analysis_output_prod.txt` (prod)
- [x] Review results for data quality issues

### Phase 3: Document Findings (DONE)
- [x] Populate research doc with actual metrics from Phase 2 output
- [x] Write findings summary covering all 6 analysis dimensions
- [x] Identify which factors have largest impact on quality

### Phase 4: Design Follow-Up Experiments
- [ ] Based on findings, design round 2 experiment configs:
  - Fix high-impact factors at their best level
  - Test remaining uncertain factors more granularly
  - Set appropriate budget caps based on observed cost ranges
- [ ] Create experiment JSON configs in `experiments/`
- [ ] Update `evolution/docs/evolution/strategy_experiments.md` with learnings

### Phase 5: Documentation & PR
- [ ] Update `evolution/docs/evolution/cost_optimization.md` with cost efficiency findings
- [ ] Update `evolution/docs/evolution/strategy_experiments.md` with round 1 results and round 2 design
- [ ] Commit all changes
- [ ] Create PR referencing GH issue #568

## Testing

### Unit Tests (DONE)
- `evolution/scripts/analyze-experiments.test.ts` — 31 tests covering:
  - Utility functions: `countBy`, `avg`, `stddev`
  - Extraction helpers: `extractTopElo`, `extractStopReason`, `extractBaselineRank`
  - Analysis functions: `analyzeRuns`, `analyzeStrategies`, `analyzeAgents`, `analyzeHofEntries`

### Manual Verification
- Run analysis script against staging DB and verify output makes sense
- Cross-check a few run metrics against the admin dashboard
- Verify HoF comparison aligns with what we see in the HoF explorer

### Rollback Plan
No rollback needed — the analysis script is read-only (no DB writes, no mutations). Follow-up experiment configs in Phase 4 are additive JSON files that can be deleted without impact.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` - May need updates if new experiment patterns are established
- `evolution/docs/evolution/architecture.md` - May need updates if pipeline changes are recommended
- `evolution/docs/evolution/data_model.md` - May need updates if new data fields are needed for analysis
- `evolution/docs/evolution/strategy_experiments.md` - Likely needs updates with experiment findings and round 2 design
- `evolution/docs/evolution/rating_and_comparison.md` - May need updates if rating analysis reveals issues
- `evolution/docs/evolution/hall_of_fame.md` - May need updates if cross-method comparison patterns change
- `evolution/docs/evolution/cost_optimization.md` - Likely needs updates with cost efficiency findings
- `evolution/docs/evolution/visualization.md` - May need updates if new dashboard views are needed
