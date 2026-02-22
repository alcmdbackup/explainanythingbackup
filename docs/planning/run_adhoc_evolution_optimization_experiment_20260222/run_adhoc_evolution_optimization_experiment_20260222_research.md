# Run Adhoc Evolution Optimization Experiment Research

## Problem Statement
I want to run a manual batch experiment to optimize elo over fixed budget. Guide me on how to use existing infra and make minor tweaks to code if needed.

## Requirements (from GH Issue #533)
I want to run a manual batch experiment to optimize elo over fixed budget. Guide me on how to use existing infra and make minor tweaks to code if needed.

## High Level Summary

The codebase has **three existing experiment execution paths** that can be used to run batch experiments optimizing Elo over a fixed budget:

1. **Strategy Experiments CLI** (`scripts/run-strategy-experiment.ts`) — Taguchi L8 fractional factorial design testing 5 factors in 8 runs. Best for systematic screening.
2. **Batch Runner** (`evolution/scripts/run-batch.ts`) — JSON-driven Cartesian product expansion with budget constraints. Best for ad-hoc combinatorial exploration.
3. **Prompt Bank** (`evolution/scripts/run-prompt-bank.ts`) — Curated 5-prompt x 6-method matrix with comparison pipeline. Best for cross-method benchmarking.

All three paths flow results through `finalizePipelineRun()` → `linkStrategyConfig()` → `update_strategy_aggregates()` RPC, landing on the optimization dashboard at `/admin/quality/optimization`.

---

## Detailed Findings

### 1. Strategy Experiment System (L8 Factorial Design)

**CLI**: `scripts/run-strategy-experiment.ts`
**Core modules**: `evolution/src/experiments/evolution/factorial.ts`, `analysis.ts`

#### How It Works

The strategy experiment CLI uses a **Taguchi L8 orthogonal array** — a fractional factorial design that tests 5 binary factors in only 8 runs (instead of 32 for full factorial). The 5 default Round 1 factors are:

| Factor | Low | High |
|--------|-----|------|
| A: Generation Model | deepseek-chat | gpt-5-mini |
| B: Judge Model | gpt-4.1-nano | gpt-5-nano |
| C: Iterations | 3 | 8 |
| D: Editing Approach | iterativeEditing | treeSearch |
| E: Support Agents | off (reflection only) | on (full suite) |

Each run spawns `run-evolution-local.ts` as a child process with the appropriate `--model`, `--judge-model`, `--iterations`, `--enabled-agents`, `--bank`, and `--full` flags.

#### Commands

```bash
# Preview experiment plan
npx tsx scripts/run-strategy-experiment.ts plan --round 1

# Execute all 8 runs (requires a prompt)
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain how blockchain technology works"

# Re-analyze completed results
npx tsx scripts/run-strategy-experiment.ts analyze --round 1

# Check status
npx tsx scripts/run-strategy-experiment.ts status

# Round 2 refinement (lock unimportant factors, expand important ones)
npx tsx scripts/run-strategy-experiment.ts plan --round 2 \
  --vary "iterations=3,5,8,12" --lock "genModel=deepseek-chat"
```

#### Analysis Engine

After runs complete, `analyzeExperiment()` computes:
- **Main Effects**: `avg(Elo | factor=high) - avg(Elo | factor=low)` for both Elo and Elo/$
- **Factor Ranking**: Sorted by absolute effect magnitude
- **Interaction Effects**: Columns 6-7 of L8 estimate A×C and A×E interactions
- **Recommendations**: Lock negligible factors at cheap level, expand important ones, flag tradeoffs

#### State Persistence

State is persisted to `experiments/strategy-experiment.json` (gitignored) after each run. This enables resume on failure — the `run` command skips already-completed rows. Failed runs can be retried with `--retry-failed`.

#### Estimated Cost

Round 1 screening: ~$16 total (cheap runs ~$0.50-1.50, expensive ~$3-5, ceiling $5/run)

---

### 2. Batch Experiment System (JSON Config)

**CLI**: `evolution/scripts/run-batch.ts`
**Schema**: `src/config/batchRunSchema.ts`

#### How It Works

The batch runner reads a JSON config that defines a **Cartesian product matrix** of configurations:

```json
{
  "name": "model_comparison_experiment",
  "totalBudgetUsd": 50.00,
  "matrix": {
    "prompts": ["Explain photosynthesis", "Explain blockchain"],
    "generationModels": ["deepseek-chat", "gpt-4.1-mini"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10, 15],
    "agentModelVariants": [{}, { "tournament": "gpt-4.1-mini" }]
  }
}
```

Expands to: 2 prompts × 2 models × 1 judge × 3 iterations × 2 variants = **24 runs**

#### Execution Flow

1. Config validation (Zod schema)
2. Matrix expansion → `ExpandedRun[]`
3. Cost estimation per run (from historical baselines or heuristic)
4. Budget filtering (greedy, sorted by priority: `cost_asc`, `elo_per_dollar_desc`, or `random`)
5. Sequential execution (creates temp explanation, queues run, executes inline)
6. State tracked in `evolution_batch_runs` table (resume support)

#### Commands

```bash
# Dry run (plan + cost estimate)
npx tsx evolution/scripts/run-batch.ts --config experiments/my-batch.json --dry-run

# Execute
npx tsx evolution/scripts/run-batch.ts --config experiments/my-batch.json --confirm

# Resume interrupted batch
npx tsx evolution/scripts/run-batch.ts --resume <batch-id>
```

#### Existing Example Configs

Found in `experiments/`:
- `example-batch.json` — 4 runs, $10 budget (basic matrix)
- `strategy-comparison.json` — Model × iteration Elo/$ optimization, $15 budget
- `fixed-cost-comparison.json` — 6 explicit runs (GPT-5.2, GPT-4.1-mini, Deepseek), $1.20/run
- `quick-test.json` — 1 run, $1 budget (test config)

---

### 3. run-evolution-local.ts (Individual Run Interface)

**File**: `evolution/scripts/run-evolution-local.ts`

This is the CLI that both strategy experiments and batch runner use to execute individual runs.

#### Key Flags for Experiments

| Flag | Default | Description |
|------|---------|-------------|
| `--prompt <text>` | — | Generate seed article from prompt |
| `--model <name>` | deepseek-chat | Primary LLM model |
| `--judge-model <name>` | from config | Override judge model |
| `--iterations <n>` | 3 | Number of iterations |
| `--budget <n>` | 5.00 | Budget cap in USD |
| `--enabled-agents <list>` | all | Comma-separated optional agents |
| `--full` | false | Full agent suite with supervisor |
| `--single` | false | Single-article improvement mode |
| `--bank` | false | Add winner to Hall of Fame |
| `--bank-checkpoints <list>` | — | Snapshot intermediate iterations |
| `--outline` | false | Enable outline generation agent |

#### Output Format

The script outputs a JSON file with:
- `runId`, `stopReason`, `durationMs`, `iterations`, `totalVariants`
- `costSummary.totalUsd` — Total LLM cost
- `rankings[]` — Sorted by Elo (highest first), with `{rank, id, elo, strategy, textPreview}`
- `fullState` — Complete serialized pipeline state

#### Console Output Patterns (parsed by strategy experiment CLI)

The strategy experiment CLI parses these patterns from stdout:
- `Run ID: <uuid>` → captured for tracking
- `Total cost: $<amount>` → captured for analysis
- `#1 [<elo>]` → top variant Elo score

---

### 4. Results Pipeline → Dashboard

#### Data Flow

```
Run completes
  → finalizePipelineRun()
    → linkStrategyConfig()
      → hashStrategyConfig() → check/create in evolution_strategy_configs
      → update_strategy_aggregates() RPC (run_count, cost, Elo)
    → persistAgentMetrics()
      → batch upsert to evolution_run_agent_metrics (per-agent cost, Elo gain)
    → persistCostPrediction() (estimated vs actual delta)
  → Dashboard reads fresh aggregates
```

#### Optimization Dashboard (`/admin/quality/optimization`)

4 tabs:
1. **Strategy Analysis** — Sortable leaderboard (avg Elo, Elo/$, runs, stddev) + Pareto frontier scatter (cost vs Elo)
2. **Agent Analysis** — Agent ROI leaderboard (Elo/$ per agent) + cost distribution pie chart
3. **Cost Analysis** — Summary cards (total runs, total spent, best Elo/$, best strategy)
4. **Cost Accuracy** — Estimated vs actual cost calibration per strategy

#### Key DB Tables

- `evolution_strategy_configs` — Unique configs with running aggregates (avg Elo, Elo/$, run count, best/worst/stddev)
- `evolution_run_agent_metrics` — Per-agent per-run cost and Elo contribution
- `evolution_batch_runs` — Batch lifecycle and execution plan

---

### 5. Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| `factorial.ts` | 23 | Comprehensive (L8 properties, factor mapping, agent validation) |
| `analysis.ts` | 18 | Comprehensive (main effects, interactions, recommendations, partial data) |
| `strategyConfig.ts` | 50+ | Extensive (hashing, labeling, diffing, DB types) |
| `batchRunSchema.ts` | 16 | Good (matrix expansion, budget filtering, validation) |
| `run-strategy-experiment.ts` CLI | 9 | Basic (plan/analyze/status, state persistence) |
| Strategy integration | 8 | Good (plan→run→analyze round-trip) |
| `run-batch.ts` runner | 0 | Gap — no tests for batch execution |

---

## Path A Deep Dive: Strategy Experiments Practical Execution Guide

### Critical Blocker: Script Path Mismatch

The strategy experiment CLI (`scripts/run-strategy-experiment.ts`) has a **wrong path** for spawning child runs:

- **Expected**: `scripts/run-evolution-local.ts` (line 181, 394)
- **Actual location**: `evolution/scripts/run-evolution-local.ts`
- **Impact**: `validatePrerequisites()` will exit with "scripts/run-evolution-local.ts not found"
- **Fix needed**: Change path references from `scripts/run-evolution-local.ts` to `evolution/scripts/run-evolution-local.ts`

### Hardcoded Behaviors in Strategy Experiment CLI

The `commandRun()` function (line 393-402) always passes these flags to child runs:
- `--bank` — always inserts into Hall of Fame (requires Supabase)
- `--full` — always runs full agent suite
- No `--mock` flag support — always uses real LLM calls
- No `--budget` override — uses default $5.00 ceiling

### Environment Prerequisites

| Requirement | Status | Notes |
|-------------|--------|-------|
| `OPENAI_API_KEY` | Present in .env.local | Needed for gpt-5-mini, gpt-5-nano, gpt-4.1-nano |
| `DEEPSEEK_API_KEY` | Present in .env.local | Needed for deepseek-chat |
| `SUPABASE_SERVICE_ROLE_KEY` | Present in .env.local | Optional — graceful degradation if missing |
| `NEXT_PUBLIC_SUPABASE_URL` | Present in .env.local | Optional — file-only output if missing |
| `ANTHROPIC_API_KEY` | NOT configured | Not needed (no Claude models in default factors) |

### Allowed LLM Models (from `allowedLLMModelSchema`)

All models referenced in DEFAULT_ROUND1_FACTORS are valid:
- deepseek-chat, gpt-5-mini (Factor A)
- gpt-4.1-nano, gpt-5-nano (Factor B)

Full allowed list: gpt-4o-mini, gpt-4o, gpt-4.1-nano, gpt-4.1-mini, gpt-4.1, gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano, o3-mini, deepseek-chat, claude-sonnet-4-20250514

### L8 Run Matrix & Cost Profile

| Run | Gen Model | Judge Model | Iters | Editor | Agents | Est. Cost |
|-----|-----------|-------------|-------|--------|--------|-----------|
| 1 | deepseek-chat | gpt-4.1-nano | 3 | iterativeEditing | off | $0.30-$0.50 |
| 2 | deepseek-chat | gpt-4.1-nano | 8 | treeSearch | on | $0.70-$1.10 |
| 3 | deepseek-chat | gpt-5-nano | 3 | iterativeEditing | on | $0.40-$0.70 |
| 4 | deepseek-chat | gpt-5-nano | 8 | treeSearch | off | $0.80-$1.30 |
| 5 | gpt-5-mini | gpt-4.1-nano | 3 | iterativeEditing | on | $0.50-$1.00 |
| 6 | gpt-5-mini | gpt-4.1-nano | 8 | treeSearch | off | $1.20-$2.00 |
| 7 | gpt-5-mini | gpt-5-nano | 3 | iterativeEditing | off | $0.60-$1.00 |
| 8 | gpt-5-mini | gpt-5-nano | 8 | treeSearch | on | $1.80-$3.00 |

**Total estimated cost: ~$10-$12** for all 8 runs.

Cheapest (Run 1): deepseek + nano judge + 3 iters + minimal agents
Most expensive (Run 8): gpt-5-mini + 8 iters + full agents

### Output Parsing

The strategy experiment parses stdout from run-evolution-local.ts using these regex patterns:

| Pattern | What it matches | Status |
|---------|----------------|--------|
| `/Run ID:\s+([a-f0-9-]+)/` | Run UUID | Works but captures only 8-char truncated ID |
| `/Total cost:\s+\$([0-9.]+)/` | Total cost USD | Works correctly |
| `/#1\s+\[(\d+)\]/` | Top variant Elo | Works correctly |

The Run ID is truncated to 8 chars (line 781 of run-evolution-local.ts uses `runId.slice(0, 8)`) — sufficient for tracking in the experiment state file but not for DB lookups.

### Execution Timeline (per run)

- **Seed generation**: ~5-10 seconds (single LLM call for title + article)
- **3-iteration run** (deepseek, minimal agents): ~2-5 minutes
- **8-iteration run** (gpt-5-mini, full agents): ~10-20 minutes
- **Total for 8 L8 runs**: ~45-90 minutes sequential
- **Timeout per run**: 20 minutes default (configurable via `--timeout`)

---

### 6. Database Targeting (Dev vs Prod)

#### Current Configuration

`.env.local` points to the **Dev/Staging** Supabase project:
- `NEXT_PUBLIC_SUPABASE_URL=https://ifubinffdbyewoezcidz.supabase.co` (Dev)
- `SUPABASE_SERVICE_ROLE_KEY` is the Dev service role key

The **Production** Supabase project (`qbxhivoezkfbjbsctdzo`) is only configured in Vercel environment variables and GitHub Secrets — not in `.env.local`.

#### How DB Targeting Works

`run-evolution-local.ts` loads `.env.local` via `dotenv` (line 19). The `getSupabase()` helper (line 477) uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to create the client. If either is missing, it returns `null` and the run proceeds in file-only mode (graceful degradation).

All experiment results — strategy config aggregates, agent metrics, Hall of Fame entries, cost tracking — flow through this single Supabase client. Whatever DB `.env.local` points to is where results land.

#### Theoretical Prod Override

To target production, you would override both env vars at runtime:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://qbxhivoezkfbjbsctdzo.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
npx tsx scripts/run-strategy-experiment.ts run --round 1 --prompt "..."
```

However, this is **not recommended** for experiment runs because:
- Test prompts and experimental articles would pollute production data
- No bulk cleanup mechanism exists for removing experiment artifacts
- LLM call tracking entries would be mixed with real user data
- Hall of Fame entries from experiments are indistinguishable from production ones
- The prod service role key is not available locally (only in Vercel/GitHub Secrets)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/overview.md

## Code Files Read
- `scripts/run-strategy-experiment.ts` — CLI orchestrator (plan/run/analyze/status)
- `evolution/src/experiments/evolution/factorial.ts` — L8 orthogonal array, factor mapping
- `evolution/src/experiments/evolution/analysis.ts` — Main effects, interactions, recommendations
- `evolution/scripts/run-batch.ts` (via agent) — Batch config expansion and execution
- `evolution/scripts/run-evolution-local.ts` (via agent) — Individual run CLI interface
- `evolution/scripts/evolution-runner.ts` (via agent) — Batch worker daemon
- `src/config/batchRunSchema.ts` (via agent) — Zod schemas for batch config
- `evolution/src/lib/core/strategyConfig.ts` (via agent) — Strategy hashing and labeling
- `evolution/src/lib/core/metricsWriter.ts` (via agent) — Strategy linking and aggregate updates
- `evolution/src/services/eloBudgetActions.ts` (via agent) — Dashboard query actions
- `evolution/src/services/costAnalyticsActions.ts` (via agent) — Cost accuracy analytics
- `src/app/admin/quality/optimization/page.tsx` (via agent) — Dashboard page
- `supabase/migrations/20260205000005_add_strategy_configs.sql` (via agent) — Strategy DB schema
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` (via agent) — Agent metrics schema
- `evolution/src/experiments/evolution/factorial.test.ts` (via agent) — 23 tests
- `evolution/src/experiments/evolution/analysis.test.ts` (via agent) — 18 tests
- `scripts/run-strategy-experiment.test.ts` (via agent) — 9 tests
- `src/__tests__/integration/strategy-experiment.integration.test.ts` (via agent) — 8 tests
- `experiments/*.json` (via agent) — 4 example batch configs
