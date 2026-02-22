# Run Adhoc Evolution Optimization Experiment Plan

## Background
Run a manual batch experiment using the existing strategy experiment infrastructure (Path A: L8 Taguchi factorial design) to identify which pipeline configuration factors have the largest impact on Elo quality at a fixed budget. The infrastructure exists but has one script path bug blocking execution.

## Requirements (from GH Issue #533)
I want to run a manual batch experiment to optimize elo over fixed budget. Guide me on how to use existing infra and make minor tweaks to code if needed.

## Problem
The strategy experiment CLI (`scripts/run-strategy-experiment.ts`) provides a systematic L8 fractional factorial design that tests 5 pipeline factors in 8 runs — generation model, judge model, iterations, editing approach, and support agents. However, the CLI has a script path bug: it references `scripts/run-evolution-local.ts` but the file lives at `evolution/scripts/run-evolution-local.ts`. The `validatePrerequisites()` check and child process spawn will both fail. A two-line path fix unblocks execution. All env vars (OPENAI_API_KEY, DEEPSEEK_API_KEY, Supabase) are already configured.

## Options Considered

1. **Path A: Strategy Experiments CLI (L8 factorial)** — Fix the path bug, run `plan` then `run --round 1`. Tests 5 factors in 8 runs with statistical analysis. Cost ~$10-12. **Chosen.**
2. **Path B: Batch Runner (JSON config)** — Write a custom batch JSON config. More flexible but no statistical analysis engine. Would need manual interpretation.
3. **Path C: Manual run-evolution-local.ts calls** — Run individual experiments by hand. Most flexible but tedious and no automated analysis.

Path A chosen because it provides automated statistical analysis (main effects, factor ranking, recommendations) and the fix is minimal (2 lines).

## Constraints

- **Dev DB only** — All experiment runs target the Dev/Staging Supabase project (`ifubinffdbyewoezcidz`) via `.env.local`. Production is explicitly excluded: no prod env var overrides, no deploying experiment code to prod. Results are viewable on the local dev dashboard at `/admin/quality/optimization`.
- **No prod data contamination** — Test prompts and experimental articles should not enter the production database. There is no bulk cleanup mechanism for experiment artifacts.

## Phased Execution Plan

### Phase 1: Fix script path bug (code change)
**Files modified:**
- `scripts/run-strategy-experiment.ts` — lines 181, 183, 394

**Changes:**
1. Line 181: `path.resolve(PROJECT_ROOT, 'scripts', 'run-evolution-local.ts')` → `path.resolve(PROJECT_ROOT, 'evolution', 'scripts', 'run-evolution-local.ts')`
2. Line 183: `'Error: scripts/run-evolution-local.ts not found'` → `'Error: evolution/scripts/run-evolution-local.ts not found'`
3. Line 394: `'tsx', 'scripts/run-evolution-local.ts'` → `'tsx', 'evolution/scripts/run-evolution-local.ts'`

**New test:**
- Add `validatePrerequisites` test to `scripts/run-strategy-experiment.test.ts` that verifies the `run` command finds the child script at the correct path (covers the code path no existing test exercises).

**Note:** `evolution/scripts/run-prompt-bank.ts` line 377 also references `'scripts/run-evolution-local.ts'` but is NOT a bug — its `cwd` resolves to `evolution/` via `path.resolve(__dirname, '..')`, so the relative path is correct.

**Verification:**
- Run existing + new tests: `npm test -- scripts/run-strategy-experiment.test.ts`
- Run lint + tsc
- Verify preflight passes: `npx tsx scripts/run-strategy-experiment.ts run --round 1 --prompt "test"` (ctrl-C after preflight validation succeeds, before LLM calls begin)

### Phase 2: Run the experiment
**Target DB:** Dev/Staging (`ifubinffdbyewoezcidz`) — uses `.env.local` as-is, no overrides needed.

**Command:**
```bash
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain how blockchain technology works"
```

**What happens:**
- 8 sequential runs, each spawning `run-evolution-local.ts` as a child process
- Each run: seed article generation → full pipeline (EXPANSION→COMPETITION) → Hall of Fame insertion
- State saved to `experiments/strategy-experiment.json` after each run (resume on failure)
- Auto-analysis after all 8 complete

**Expected output:**
- Main effects ranking (which factors matter most for Elo and Elo/$)
- Interaction effects (A×C model×iterations, A×E model×agents)
- Recommendations (lock negligible factors, expand important ones)

**Cost:** ~$10-12 total, ~45-90 minutes

### Phase 3: Analyze results
If not auto-analyzed (e.g., some runs failed and were retried):
```bash
npx tsx scripts/run-strategy-experiment.ts analyze --round 1
```

View results on dashboard: `/admin/quality/optimization`

## Testing

### Existing tests (must pass after Phase 1):
- `npm test -- scripts/run-strategy-experiment.test.ts` (9 tests)
- `npm test -- evolution/src/experiments/evolution/factorial.test.ts` (23 tests)
- `npm test -- evolution/src/experiments/evolution/analysis.test.ts` (18 tests)

### Manual verification:
- `npx tsx scripts/run-strategy-experiment.ts plan --round 1` prints L8 matrix without errors
- Preflight validation passes (finds run-evolution-local.ts at correct path)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Update script path references if they mention `scripts/run-evolution-local.ts`
- `evolution/docs/evolution/cost_optimization.md` - No changes needed
- `evolution/docs/evolution/README.md` - No changes needed
- `evolution/docs/evolution/reference.md` - Update CLI path references if affected
- Other evolution docs - No changes needed for this experiment
