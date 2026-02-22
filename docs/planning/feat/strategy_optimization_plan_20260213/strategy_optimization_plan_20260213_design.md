# Strategy Experiment System Design

## Overview

A systematic experimentation layer that uses fractional factorial design (Taguchi L8 orthogonal arrays) to explore the evolution pipeline's strategy search space and find Elo-optimal configurations under cost constraints. Results flow to existing dashboards automatically.

## Problem

The evolution pipeline has a large configuration space — generation models, judge models, iteration counts, agent selection — but no structured way to determine which configurations maximize Elo per dollar. With limited experimentation budget ($10-25), every run must maximize learning.

## Approach: Response Surface Methodology

Iterative rounds of designed experiments, each informed by the previous round's analysis.

- **Round 1 — Screening**: L8 orthogonal array (8 runs) tests 5 factors at 2 levels. Identifies which factors have the largest main effects on Elo and Elo/$.
- **Round 2 — Refinement**: Fix unimportant factors at cheap levels. Expand important factors to 3+ levels. Test key 2-factor interactions.
- **Round N — Confirmation**: Replicate best config on different prompts (generalization check) or explore new dimensions (e.g., gpt-5.2, singleArticle mode).

## Round 1 Factors and Levels

| # | Factor | Low (-1) | High (+1) | Rationale |
|---|--------|----------|-----------|-----------|
| A | Generation model | `deepseek-chat` | `gpt-5-mini` | Biggest cost driver |
| B | Judge model | `gpt-4.1-nano` | `gpt-5-nano` | Does better judgment improve selection pressure? |
| C | Iterations | 3 | 8 | More refinement cycles vs diminishing returns |
| D | Editing approach | `iterativeEditing` | `treeSearch` | Mutex pair — which produces better refinements? |
| E | Support agents | Off (D + reflection only) | On (+debate, evolution, sectionDecomp, metaReview) | Is the full agent suite worth the cost? |

**Fixed for all runs:**
- Prompt: Single medium-difficulty prompt (e.g., "Explain how blockchain technology works")
- Budget cap: $5.00 per run (generous ceiling — let cost vary naturally)
- Required agents always on: generation, calibration, tournament, proximity

**Left out of Round 1** (available for Round 2+):
- Outline generation, singleArticle mode, gpt-5.2, budget cap variations

## L8 Run Matrix

Each row is one pipeline run, all on the same prompt:

| Run | Gen Model (A) | Judge (B) | Iters (C) | Editor (D) | Support (E) |
|-----|--------------|-----------|-----------|------------|-------------|
| 1 | deepseek | nano | 3 | iterEdit | off |
| 2 | deepseek | nano | 8 | treeSearch | on |
| 3 | deepseek | 5-nano | 3 | treeSearch | on |
| 4 | deepseek | 5-nano | 8 | iterEdit | off |
| 5 | 5-mini | nano | 3 | iterEdit | on |
| 6 | 5-mini | nano | 8 | treeSearch | off |
| 7 | 5-mini | 5-nano | 3 | treeSearch | off |
| 8 | 5-mini | 5-nano | 8 | iterEdit | on |

Columns 6-7 of the L8 (not assigned to factors) estimate A×C and A×E interactions.

Estimated total cost: ~$16 (cheap configs ~$0.50-1.50, expensive ~$3-5).

## enabledAgents Mapping

| D | E | enabledAgents array |
|---|---|---------------------|
| iterEdit | off | `['iterativeEditing', 'reflection']` |
| iterEdit | on | `['iterativeEditing', 'reflection', 'debate', 'evolution', 'sectionDecomposition', 'metaReview']` |
| treeSearch | off | `['treeSearch', 'reflection']` |
| treeSearch | on | `['treeSearch', 'reflection', 'debate', 'evolution', 'sectionDecomposition', 'metaReview']` |

Required agents (generation, calibration, tournament, proximity) always run implicitly.

**Note:** `reflection` is always included because both `iterativeEditing` and `treeSearch` depend on it per `AGENT_DEPENDENCIES` in `budgetRedistribution.ts`. The "off" vs "on" distinction for Factor E controls whether the *remaining* support agents (debate, evolution, sectionDecomposition, metaReview) are enabled.

## Analysis Method

After all 8 runs complete:

**1. Main Effects** — For each factor, compare average response when High vs Low:
```
Effect_A = avg(response | A=high) - avg(response | A=low)
```
Computed for both Elo (quality) and Elo/$ (efficiency).

**2. Factor Ranking** — Sort factors by |effect| to identify what matters most.

**3. Interaction Check** — If A×C or A×E interaction effects are large, flag non-additive behavior (e.g., "more iterations helps more with the better model").

**4. Round 2 Recommendation** — Lock unimportant factors at cheap level. Expand important factors to more levels. Test flagged interactions.

## CLI Interface

Single script `scripts/run-strategy-experiment.ts` with four commands:

```bash
# Preview experiment plan + cost estimates
npx tsx scripts/run-strategy-experiment.ts plan --round 1

# Execute round (runs sequentially, auto-analyzes at end)
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain how blockchain technology works"

# Re-analyze a completed round
npx tsx scripts/run-strategy-experiment.ts analyze --round 1

# Show experiment status across all rounds
npx tsx scripts/run-strategy-experiment.ts status
```

**Round 2+ follow-up:**
```bash
npx tsx scripts/run-strategy-experiment.ts plan --round 2 \
  --vary "iterations=3,5,8,12" \
  --vary "supportAgents=off,on" \
  --lock "genModel=deepseek-chat" \
  --lock "judgeModel=gpt-4.1-nano" \
  --lock "editor=treeSearch"
```

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  run-strategy-experiment.ts (orchestrator)               │
│                                                          │
│  plan → L8 matrix from factorial.ts                      │
│  run  → execFileSync(run-evolution-local.ts) × 8         │
│  analyze → query DB + analysis.ts main effects           │
│  status → read experiments/strategy-experiment.json       │
└──────────────┬──────────────────────────────────────────┘
               │ execFileSync
               ▼
┌──────────────────────────────────┐
│  run-evolution-local.ts          │
│  --prompt --model --judge-model  │
│  --iterations --enabled-agents   │
│  --bank --full                   │
└──────────────┬───────────────────┘
               │ executeFullPipeline()
               ▼
┌──────────────────────────────────┐
│  Evolution Pipeline              │
│  finalizePipelineRun() writes:   │
│  • evolution_strategy_configs              │
│  • evolution_run_agent_metrics   │
│  • evolution_agent_invocations   │
│  • evolution_hall_of_fame_entries          │
│  • evolution_runs        │
└──────────────┬───────────────────┘
               │ same DB tables
               ▼
┌──────────────────────────────────┐
│  Existing Dashboards             │
│  • /admin/quality/optimization   │
│  • /admin/quality/hall-of-fame   │
│  • /admin/quality/explorer       │
│  • /admin/quality/evolution      │
└──────────────────────────────────┘
```

## Safety and Resilience

**Pre-flight validation:** Before launching any runs, the `run` command verifies that Phase 1 plumbing is in place by running `run-evolution-local.ts --help` and checking for `--judge-model` and `--enabled-agents` in the output. This prevents wasting ~$16 on 8 broken runs if Phase 1 is incomplete.

**Shell injection prevention:** The `run` command uses `execFileSync` (not `exec` or `execSync`), which passes arguments as an array rather than a shell string. This prevents injection via prompt text or factor values. All user-supplied strings (prompt, factor values) are passed as discrete argv entries.

**Execution timeout:** Each `execFileSync` call uses a 20-minute timeout (matching the generous ceiling in `run-prompt-bank.ts`). Full pipeline runs with gpt-5-mini at 8 iterations may take 10+ minutes. Add a `--timeout` flag for operator override.

**Environment passthrough:** Child processes inherit `process.env` (matching existing `run-prompt-bank.ts` pattern). Operators should ensure `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` are both set since different runs use different providers.

**Failure and resume:** If a run fails mid-experiment:
- Each completed run is persisted to the state file immediately after finishing (not batched at end)
- The `run` command checks the state file on startup and skips already-completed rows
- Failed rows are marked `status: 'failed'` with an `error` field and can be retried with `run --round N --retry-failed`
- The `analyze` command works with partial data (warns about missing runs but computes effects from available rows)

**Budget hash consistency:** All runs within a round use the same default `budgetCaps` (not specified in enabledAgents, so they inherit the pipeline default). This ensures the strategy config hash varies only by the 5 experimental factors.

## Experiment State File

Persisted to `experiments/strategy-experiment.json` (add `experiments/strategy-experiment*.json` to `.gitignore` — state files contain run IDs and cost data that are environment-specific; the existing `experiments/` prompt configs are intentionally tracked):

```json
{
  "experimentId": "strategy-screening-20260213",
  "prompt": "Explain how blockchain technology works",
  "rounds": [
    {
      "round": 1,
      "type": "screening",
      "design": "L8",
      "factors": {
        "A": { "name": "genModel", "low": "deepseek-chat", "high": "gpt-5-mini" },
        "B": { "name": "judgeModel", "low": "gpt-4.1-nano", "high": "gpt-5-nano" },
        "C": { "name": "iterations", "low": 3, "high": 8 },
        "D": { "name": "editor", "low": "iterativeEditing", "high": "treeSearch" },
        "E": { "name": "supportAgents", "low": "off", "high": "on" }
      },
      "runs": [
        { "row": 1, "runId": "abc-123", "status": "completed", "topElo": 1847, "costUsd": 2.14 }
      ],
      "analysis": {
        "mainEffects": {
          "elo": { "A": 32, "B": 3, "C": 45, "D": 8, "E": 18 },
          "eloPerDollar": { "A": -8, "B": 1, "C": 15, "D": 2, "E": -12 }
        },
        "interactions": { "AxC": 12, "AxE": -5 },
        "recommendations": [
          "Lock judge model at gpt-4.1-nano (negligible effect, saves cost)",
          "Iterations has largest effect — expand to 3,5,8,12 in Round 2",
          "Support agents improve Elo but hurt Elo/$ — investigate which specific agents add value"
        ]
      }
    }
  ]
}
```

## Response Variables

| Metric | Source | Purpose |
|--------|--------|---------|
| Top Elo (ordinal) | `run_summary.topVariants[0].ordinal` | Quality signal |
| Actual cost USD | `evolution_runs.total_cost_usd` | Cost measurement |
| Elo/$ | `(topElo - 1200) / costUsd` | Primary optimization target |
| Baseline rank | `run_summary.baselineRank` | Did pipeline beat original? |
| Stop reason | `run_summary.stopReason` | Detect budget/plateau issues |

## Implementation Scope

### Prerequisite plumbing (small changes to existing code)

| # | Item | File | Change |
|---|------|------|--------|
| 1 | Verify `gpt-5.2` routing works end-to-end | `src/lib/services/llms.ts` | Already in `allowedLLMModelSchema` and `llmPricing.ts`; verify `callLLMModel` routes correctly and add a smoke test |
| 2 | Add `--judge-model` flag | `scripts/run-evolution-local.ts` | Pass through to `config.judgeModel` |
| 3 | Add `--enabled-agents` flag | `scripts/run-evolution-local.ts` | Accept comma-separated agent names, pass to `config.enabledAgents` |

### New code

| # | Item | File | Purpose |
|---|------|------|---------|
| 4 | Experiment orchestrator | `scripts/run-strategy-experiment.ts` | plan/run/analyze/status CLI |
| 5 | Factorial design engine | `src/lib/evolution/experiment/factorial.ts` | L8 orthogonal array generation, factor mapping |
| 6 | Analysis engine | `src/lib/evolution/experiment/analysis.ts` | Main effects, interaction effects, factor ranking, recommendations |

### Not building (reusing existing)

- Pipeline execution — `run-evolution-local.ts`
- Data persistence — `finalizePipelineRun()` writes to all standard tables
- Dashboard visualization — optimization, Hall of Fame, explorer pages
- Strategy hashing/dedup — each factor combo auto-creates a unique strategy config
- Cost tracking — existing `CostTracker`

## Documentation Plan

### New documentation
- `docs/evolution/strategy_experiments.md` — Feature deep dive: factorial design methodology, L8 arrays, analysis techniques, CLI usage, round workflow

### Existing docs to update
| Doc | Change |
|-----|--------|
| `docs/evolution/cost_optimization.md` | Add cross-reference to strategy_experiments.md in Related Documentation |
| `docs/evolution/reference.md` | Add CLI commands, key files, `--judge-model` and `--enabled-agents` flags |
| `docs/evolution/data_model.md` | Note experiment state in `experiments/` JSON files |

### Doc-mapping additions
```json
{
  "pattern": "scripts/run-strategy-experiment.ts",
  "docs": ["docs/evolution/strategy_experiments.md", "docs/evolution/cost_optimization.md"]
},
{
  "pattern": "src/lib/evolution/experiment/**",
  "docs": ["docs/evolution/strategy_experiments.md"]
}
```

## Testing

### Unit tests
- `src/lib/evolution/experiment/factorial.test.ts` — L8 array generation, factor mapping, orthogonality verification
- `src/lib/evolution/experiment/analysis.test.ts` — Main effects computation, interaction effects, ranking, recommendation generation (uses mock runs with known Elo/cost values for predictable main effects)
- `scripts/run-strategy-experiment.test.ts` — CLI arg parsing, plan generation, state file persistence, analyze from mock data
- `scripts/run-evolution-local.test.ts` — `--judge-model` and `--enabled-agents` flag parsing and validation

### Integration test
- `src/__tests__/integration/strategy-experiment.integration.test.ts` — End-to-end `plan → run → analyze` flow with mock pipeline stub
