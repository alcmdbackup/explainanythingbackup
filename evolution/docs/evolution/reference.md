# Evolution Reference

Single source of truth for cross-cutting concerns: configuration, budget enforcement, database schema, key files, CLI commands, deployment, observability, and testing.

## Configuration

V2 uses a flat `EvolutionConfig` (defined in `pipeline/types.ts`):

```typescript
interface EvolutionConfig {
  iterations: number;            // Generate→rank→evolve iterations (1-100)
  budgetUsd: number;             // Total budget in USD (0-50)
  judgeModel: string;            // Model for comparison/judge calls
  generationModel: string;       // Model for text generation calls
  strategiesPerRound?: number;   // Generation strategies per round (default: 3)
  calibrationOpponents?: number; // Triage opponents (default: 5)
  tournamentTopK?: number;       // Top-K for fine-ranking eligibility (default: 5)
}
```

Config is resolved from V1 DB format by `resolveConfig()` in `pipeline/runner.ts`:
- `maxIterations` → `iterations` (default: 5)
- `budgetCapUsd` → `budgetUsd` (default: 1.0)
- `judgeModel` default: `gpt-4.1-nano`
- `generationModel` default: `gpt-4.1-mini`

Validation is done at `evolveArticle()` entry: iterations 1-100, budgetUsd 0-50, non-empty model strings.

### Tiered Model Routing

The pipeline routes LLM calls to different models based on task complexity. Comparison judgments (`judgeModel`, default: `gpt-4.1-nano`) use a cheaper model than text generation (`generationModel`, default: `gpt-4.1-mini`).

## Budget Enforcement

The `V2CostTracker` (`pipeline/cost-tracker.ts`) enforces budget via reserve-before-spend:

- **Reserve margin**: 1.3x (`RESERVE_MARGIN`) — reserves 30% more than estimated to handle concurrent calls
- **Pre-call reservation**: Budget checked before every LLM call
- **Available budget**: `budgetUsd - totalSpent - totalReserved`
- **`BudgetExceededError`**: Thrown when available budget < estimated cost, stops the pipeline with `stopReason: 'budget_exceeded'`

### LLM Client (`pipeline/llm-client.ts`)

- Retry: `MAX_RETRIES=3`, backoff `1s/2s/4s`
- Timeout: `PER_CALL_TIMEOUT=60s`
- Token estimation: `chars/4` for input, output estimates per task: generation=1000, ranking=100
- Model pricing: `gpt-4.1-nano` ($0.10/$0.40), `gpt-4.1-mini` ($0.40/$1.60), `deepseek-chat` ($0.27/$1.10), etc.

## Format Enforcement

All generated variants must pass `validateFormat()` (`shared/formatValidator.ts`):
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

Controlled by `FORMAT_VALIDATION_MODE` env var:
- `"reject"` (default): Variants failing validation are discarded
- `"warn"`: Validation issues logged but variant accepted
- `"off"`: No validation — testing only

## Edge Cases & Guards

### Minimum Pool Size
- **rankPool()**: Requires `pool.length >= 2` (returns empty result otherwise)
- **evolveVariants()**: Requires `pool.length >= 1`. Crossover requires 2 parents — falls back to mutation only if 1 parent
- **generateVariants()**: No minimum — always generates from original text

### Format Validation Failures
If ALL generated variants fail format validation in an iteration, the pool doesn't grow. The pipeline continues but may accumulate empty iterations until budget or max iterations is reached.

### Error Handling
V2 LLM client (`pipeline/llm-client.ts`) retries transient errors 3x with exponential backoff. Error classification uses `isTransientError()` in `shared/errorClassification.ts`. `BudgetExceededError` propagates directly without retry.

### Run Failure Marking
`markRunFailed()` in `pipeline/runner.ts` uses `.in('status', ['pending', 'claimed', 'running'])` guard — idempotent, preserves kill attribution if run was already killed.

## Database Schema

### V2 Tables (clean-slate migration `20260315000001`)

| Table | Purpose |
|-------|---------|
| `evolution_strategies` | Strategy definitions: name, label, config (JSONB), config_hash (unique), pipeline_type, status, run_count |
| `evolution_prompts` | Prompt bank topics with unique case-insensitive prompt matching |
| `evolution_experiments` | Experiments: name, prompt_id, status (draft/running/completed/cancelled), created_at |
| `evolution_runs` | Run lifecycle: status (pending/claimed/running/completed/failed/cancelled), config, budget, iterations, heartbeat, strategy_id, experiment_id, explanation_id, prompt_id, run_summary (JSONB), pipeline_version='v2', archived |
| `evolution_variants` | Persisted variants: text, strategy, elo_score, parent lineage, is_winner, run_id |
| `evolution_agent_invocations` | Per-operation execution records: run_id, iteration, agent_name, execution_order, success, cost_usd (incremental), execution_detail (JSONB) |
| `evolution_run_logs` | Structured log entries: run_id, level, message, context (JSONB), agent_name, iteration |
| `evolution_arena_entries` | Generated articles: content, generation_method, model, cost, prompt_id, optional run_id/variant_id |
| `evolution_arena_comparisons` | Pairwise comparison records: entry_a, entry_b, winner, confidence, judge_model |

### V2 RPCs

| RPC | Purpose |
|-----|---------|
| `claim_evolution_run` | Atomic run claiming with `FOR UPDATE SKIP LOCKED` |
| `update_strategy_aggregates` | Update strategy-level aggregate metrics after run completion |
| `sync_to_arena` | Sync pipeline results to arena entries/comparisons |
| `cancel_experiment` | Cancel experiment + bulk-fail pending/claimed/running runs |

### Key Differences from V1
- No `evolution_checkpoints` table — no checkpoint/resume
- No `continuation_pending` status — runs complete in single execution
- Simplified status CHECK: `pending/claimed/running/completed/failed/cancelled`
- `pipeline_version='v2'` column on runs
- `archived` boolean on runs

## Key Files

### V2 Core (`evolution/src/lib/pipeline/`)
| File | Purpose |
|------|---------|
| `evolve-article.ts` | Main orchestrator: generate→rank→evolve loop with kill detection and budget handling |
| `generate.ts` | 3-strategy parallel variant generation with format validation |
| `rank.ts` | Triage (stratified opponents, early exit) + Swiss fine-ranking |
| `evolve.ts` | Mutation (clarity/structure), crossover, creative exploration |
| `runner.ts` | Run lifecycle: claim → resolve → evolve → persist → arena sync |
| `types.ts` | V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig |
| `cost-tracker.ts` | Reserve-before-spend budget management with 1.3x margin |
| `llm-client.ts` | LLM wrapper with retry (3x), timeout (60s), cost tracking, model pricing |
| `finalize.ts` | Persist results in V1-compatible format: run_summary, variants table |
| `arena.ts` | Load arena entries into pool, sync results back via RPC |
| `invocations.ts` | Per-operation invocation tracking (create/update) |
| `run-logger.ts` | Fire-and-forget structured logging to evolution_run_logs |
| `strategy.ts` | Strategy config hashing (SHA-256) and auto-labeling |
| `seed-article.ts` | Seed article generation for prompt-based runs (2 LLM calls) |
| `experiments.ts` | Experiment creation, run management, metrics computation |
| `errors.ts` | BudgetExceededWithPartialResults (preserves partial variants) |
| `index.ts` | Barrel exports for V2 modules |

### V1 Core Modules Reused by V2 (`evolution/src/lib/shared/`)
| File | Purpose |
|------|---------|
| `rating.ts` | OpenSkill (Weng-Lin Bayesian) rating: `createRating`, `updateRating`, `updateDraw`, `isConverged`, `toEloScale` |
| `reversalComparison.ts` | Generic 2-pass reversal runner for bias mitigation |
| `textVariationFactory.ts` | `createTextVariation()` factory |
| `errorClassification.ts` | `isTransientError()` for retry decisions |

### V1 Agents Still Used (`evolution/src/lib/agents/`)
| File | Purpose |
|------|---------|
| `formatValidator.ts` | `validateFormat()` for generated text |
| `formatRules.ts` | `FORMAT_RULES` constant injected into generation prompts |

### Comparison (`evolution/src/lib/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | `compareWithBiasMitigation()` — 2-pass A/B reversal with caching |

### Services (`evolution/src/services/`)
| File | Purpose |
|------|---------|
| `experimentActionsV2.ts` | 7 V2 server actions: create/list/get experiments, add runs, list prompts/strategies, cancel |
| `evolutionRunClient.ts` | Client-side fetch wrapper for evolution run endpoint |
| `evolutionRunnerCore.ts` | Shared runner core for admin triggers |
| `adminAction.ts` | Admin action factory with auth + logging + error handling |
| `shared.ts` | ActionResult type, UUID validation |
| `costAnalytics.ts` | LLM cost tracking (not evolution-specific) |

### Scripts
| File | Purpose |
|------|---------|
| `evolution/scripts/evolution-runner.ts` | Production batch runner (systemd timer): claims and executes pending runs |
| `evolution/scripts/run-evolution-local.ts` | Local CLI for running evolution on markdown files |
| `evolution/scripts/deferred/` | Arena utility scripts |

### Ops Modules (`evolution/src/lib/ops/`)
| File | Purpose |
|------|---------|
| `watchdog.ts` | Stale run detection (heartbeat > 10 min) |
| `orphanedReservations.ts` | Orphaned LLM budget reservation cleanup |

**Note:** These ops modules exist but are **not wired** into the batch runner — `evolution-runner.ts` does not import or call them.

### UI Pages (`src/app/admin/evolution/`)
| File | Purpose |
|------|---------|
| `experiments/page.tsx` | Experiment list |
| `experiments/[experimentId]/page.tsx` | Experiment detail with overview, analysis, runs, report tabs |
| `start-experiment/page.tsx` | Experiment creation wizard |

### Testing Helpers
| File | Purpose |
|------|---------|
| `evolution/src/testing/evolution-test-helpers.ts` | Shared factories: `createMockEvolutionLLMClient`, `createTestEvolutionRun`, `createTestVariant`, `cleanupEvolutionData` |

## CLI Commands

### Batch Runner
```bash
# Local execution (sequential)
npx tsx evolution/scripts/evolution-runner.ts --max-runs 5
npx tsx evolution/scripts/evolution-runner.ts --dry-run  # Log-only mode

# Parallel execution
npx tsx evolution/scripts/evolution-runner.ts --parallel 5 --max-runs 10
npx tsx evolution/scripts/evolution-runner.ts --parallel 3 --max-concurrent-llm 15
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-runs N` | 10 | Maximum total runs to process |
| `--parallel N` | 1 | Number of runs to execute concurrently per batch |
| `--max-concurrent-llm N` | 20 | Maximum concurrent LLM API calls across all parallel runs |
| `--dry-run` | false | Log-only mode — no LLM calls or DB writes |

Requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` environment variables.

### Local CLI Runner
```bash
# Mock mode (no API keys needed)
npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md --mock

# Real LLM mode (needs OPENAI_API_KEY)
npx tsx evolution/scripts/run-evolution-local.ts --file article.md

# Prompt-based (generates seed article)
npx tsx evolution/scripts/run-evolution-local.ts --prompt "Explain quantum computing"

# Custom iterations and budget
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --iterations 5 --budget 3.00

# With specific model
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --model gpt-4.1-mini
```

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | — | Markdown file to evolve (required unless `--prompt`) |
| `--prompt <text>` | — | Topic prompt — generates seed article |
| `--mock` | false | Use mock LLM (no API keys needed) |
| `--iterations <n>` | 3 | Number of iterations |
| `--budget <n>` | 5.00 | Budget cap in USD |
| `--output <path>` | auto-generated | Output JSON path |
| `--model <name>` | deepseek-chat | LLM model for generation |

Auto-persists to Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLUTION_MAX_CONCURRENT_LLM` | 20 | Maximum concurrent LLM API calls across parallel runs |
| `FORMAT_VALIDATION_MODE` | `"reject"` | Format validation mode: reject, warn, off |
| `OPENAI_API_KEY` | — | Required for LLM calls |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Required for DB access |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Required for DB access |

## Production Deployment

### Minicomputer Deployment
The batch runner is deployed on a local minicomputer as a systemd timer. See [Minicomputer Deployment](./minicomputer_deployment.md) for full setup instructions.

### Monitoring
- **Watchdog module**: `evolution/src/lib/ops/watchdog.ts` detects stale runs (heartbeat > 10 min), but is **not currently wired** into the batch runner
- **Heartbeat**: Runner updates `last_heartbeat` every 30 seconds during execution
- **Run failure**: Marked via `markRunFailed()` with status guard for idempotency

## Observability

- **Structured logging**: `RunLogger` writes structured entries to `evolution_run_logs` table with run_id, level, message, and context metadata
- **DB heartbeat**: `last_heartbeat` column updated every 30s, available for external monitoring
- **Per-operation cost tracking**: Each operation (generation, ranking, evolution) has incremental cost_usd tracked in `evolution_agent_invocations`

## Testing

V2 core tests (17 test files, 197 test cases):
- `evolution/src/lib/pipeline/*.test.ts` — All V2 modules: evolve-article, generate, rank, evolve, runner, finalize, arena, cost-tracker, llm-client, etc.

UI component tests:
- `src/app/admin/evolution/**/*.test.tsx` — Experiment pages and shared components

Service tests:
- `evolution/src/services/*.test.ts` — Server actions

Shared test helpers:
- `evolution/src/testing/evolution-test-helpers.ts` — Factories and cleanup utilities

## Testing Conventions

### `[TEST]` Prefix

Test data factories in `evolution-test-helpers.ts` prefix names and titles with `[TEST]` (e.g., `[TEST] strategy_...`, `[TEST] Prompt ...`). This allows the admin UI to hide test rows by default using a server-side `NOT ILIKE '%[TEST]%'` filter. All evolution list pages (Prompts, Strategies, Experiments, Arena Topics) include a "Hide test content" checkbox, checked by default.

### CleanupOptions

`cleanupEvolutionData(supabase, options)` accepts a `CleanupOptions` object with optional arrays: `explanationIds`, `runIds`, `strategyIds`, `promptIds`. It deletes in FK-safe order (invocations, variants, runs, strategies, prompts) and silently ignores errors so test cleanup never throws.

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration, iteration loop, stop reasons
- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system, bias mitigation
- [Operations Overview](./agents/overview.md) — V2 operations: generate, rank, evolve
- [Arena](./arena.md) — Cross-method comparison, OpenSkill rating
- [Cost Optimization](./cost_optimization.md) — Cost tracking, Pareto analysis
- [Visualization](./visualization.md) — Admin experiment pages, shared components
- [Strategy Experiments](./strategy_experiments.md) — Manual experiment system for comparing pipeline configurations
