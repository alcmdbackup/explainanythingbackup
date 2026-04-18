# Learning Curriculum

A structured 4-week onboarding guide for new developers joining the Evolution system. Each week builds on the previous one, moving from data foundations through pipeline operations to administration and advanced topics.

For a high-level overview before starting, see the [README](./README.md).

---

## Week 1: Fundamentals

**Goal:** Understand what the Evolution system stores, how data flows, and the core execution loop.

### Reading

1. **[README](./README.md)** — Start here for orientation. Covers what the system does (evolutionary article improvement via LLM-driven generate/rank/evolve cycles), the doc map, and key terminology.

2. **[Data Model](./data_model.md)** — The persistence layer. Learn the 11 tables, their relationships, and row-level security (RLS) policies. Pay attention to:
   - `evolution_runs` and `evolution_variants` as the two central tables
   - How `evolution_comparisons` records pairwise judgments
   - The `evolution_agent_invocations` table for LLM call tracking
   - RLS enforcement patterns across all tables

3. **[Architecture](./architecture.md)** — The execution model. Understand:
   - The 3-operation loop: generate, rank, evolve (repeated per round)
   - How the pipeline runner orchestrates rounds until a stop reason triggers
   - Stop reasons: convergence, max rounds, budget exhaustion, manual stop
   - The relationship between runs, rounds, and variants

### Key files to read

| Priority | File | What it teaches |
|----------|------|-----------------|
| 1 | `evolution/src/lib/types.ts` | Every core type definition — `EvolutionRun`, `EvolutionVariant`, `ComparisonResult`, strategy configs. Read this first to build vocabulary. |
| 2 | `evolution/src/lib/pipeline/evolve-article.ts` | The main loop. Shows how generate/rank/evolve phases chain together within a single round, and how rounds repeat until termination. |

### Checkpoint

By end of week 1, you should be able to:
- Name the 11 database tables and explain their purpose
- Trace the lifecycle of a run from creation to completion
- Explain why a run stops (convergence, budget, max rounds, manual)
- Read `types.ts` and identify the key interfaces

---

## Week 2: Operations

**Goal:** Understand the three pipeline phases in detail and how the rating system works.

### Reading

1. **[Agents Overview](./agents/overview.md)** — The three agent phases:
   - **Generate:** creates new article variants from the prompt
   - **Rank:** compares variants pairwise using LLM judges
   - **Evolve:** improves top variants using feedback from rankings
   - How agent prompts are structured and what context they receive

2. **[Rating & Comparison](./rating_and_comparison.md)** — The statistical engine behind ranking:
   - Elo ratings with per-variant uncertainty — public `Rating = {elo, uncertainty}` (OpenSkill / Weng-Lin Bayesian internally)
   - Two-phase ranking: triage for new variants, then Swiss pairing for established ones
   - Bias mitigation via position randomization and multi-judge panels
   - Convergence detection: 2 consecutive rounds where all eligible variant `uncertainty` values fall below `DEFAULT_CONVERGENCE_UNCERTAINTY` (72, Elo-scale)
   - Elimination rules: variant removed when `r.elo + 2 * r.uncertainty < top20Cutoff`

3. **[Arena](./arena.md)** — Cross-run comparison:
   - How the arena maintains a persistent leaderboard across runs
   - Arena ratings vs. run-local ratings
   - When and how variants enter the arena

### Key files to read

| Priority | File | What it teaches |
|----------|------|-----------------|
| 3 | `evolution/src/lib/pipeline/runner.ts` | Run orchestration — how the runner manages round progression, checks stop conditions, and coordinates phases. |
| 4 | `evolution/src/lib/pipeline/generate.ts` | Generation phase implementation — prompt construction, LLM invocation, variant creation and persistence. |
| 5 | `evolution/src/lib/pipeline/rank.ts` | Ranking phase — pair selection (triage vs. Swiss), comparison execution, rating updates. |
| 6 | `evolution/src/lib/pipeline/evolve.ts` | Evolution phase — selecting top variants, constructing improvement prompts, creating next-generation variants. |
| 7 | `evolution/src/lib/shared/rating.ts` | Public `Rating {elo, uncertainty}` API — rating updates, convergence checks, elimination logic. OpenSkill is the internal implementation. |

### Checkpoint

By end of week 2, you should be able to:
- Explain the difference between triage and Swiss pairing
- Describe how `elo` and `uncertainty` change after a comparison
- Explain what convergence means and when it triggers run termination
- Trace a variant from generation through ranking to evolution

---

## Week 3: Administration

**Goal:** Learn how experiments, strategies, cost tracking, and metrics work.

### Reading

1. **[Strategies & Experiments](./strategies_and_experiments.md)** — The experimentation layer:
   - Experiments: collections of runs testing different strategies on the same prompt
   - Strategies: model + configuration combinations (e.g., different LLMs, temperature settings)
   - Aggregate statistics across runs within an experiment
   - How to design meaningful A/B tests between strategies
   - Run summary metrics, confidence intervals, statistical analysis

3. **[Cost Optimization](./cost_optimization.md)** — Budget management:
   - Per-run budget tracking via the cost tracker
   - The spending gate: how budget pressure scales comparison counts dynamically
   - Budget pressure tiers: low, medium, high — and how each affects behavior
   - Token counting and cost estimation

### Key files to read

| Priority | File | What it teaches |
|----------|------|-----------------|
| 8 | `evolution/src/services/experimentActionsV2.ts` | Experiment CRUD — creating experiments, adding strategies, launching runs. Shows the admin-facing service layer. |
| 9 | `evolution/src/lib/pipeline/cost-tracker.ts` | Budget management internals — how spending is tracked per-invocation, how budget pressure tiers are calculated, and how the spending gate decides whether to allow more comparisons. |

### Hands-on exercise

**Exercise 3: Create an experiment with 2 strategies**

1. Open the admin UI (see [Visualization](./visualization.md) for setup)
2. Navigate to the Experiments section
3. Create a new experiment, choosing a prompt
4. Add two strategies with different model configurations
5. Launch a run for each strategy
6. Observe how the runs progress in the dashboard — compare round counts, variant ratings, and cost

### Checkpoint

By end of week 3, you should be able to:
- Create and configure an experiment via the admin UI
- Explain how budget pressure affects comparison scaling
- Read a run summary and interpret the key metrics
- Compare two strategies and explain which performed better and why

---

## Week 4: Advanced

**Goal:** Understand the full file landscape, admin UI architecture, deployment, and local development.

### Reading

1. **[Reference](./reference.md)** — The complete file index and operational reference:
   - Full file-by-file index of the codebase
   - CLI commands and script usage
   - Testing infrastructure and patterns
   - Error classes and error handling conventions

2. **[Visualization](./visualization.md)** — The admin UI:
   - Next.js admin dashboard architecture
   - Shared components and their responsibilities
   - How the UI connects to Supabase for real-time updates
   - Chart and leaderboard components

3. **[Minicomputer Deployment](./minicomputer_deployment.md)** — Production deployment:
   - systemd service configuration
   - Environment setup and secrets management
   - Deployment procedures and health checks
   - Troubleshooting common deployment issues

### Key files to read

| Priority | File | What it teaches |
|----------|------|-----------------|
| 10 | `evolution/src/lib/pipeline/finalize.ts` | Result persistence — how final ratings, arena entries, and run summaries are written after a run completes. |
| 11 | `evolution/src/services/evolutionRunnerCore.ts` | The entry point — how a run is initiated from the service layer, how configuration is resolved, and how the pipeline runner is invoked. |

### Hands-on exercises

**Exercise 1: Read a run's logs in the admin dashboard**

1. Open the admin UI and navigate to a completed run
2. Inspect the run's timeline — rounds, phases, variant counts
3. Find the agent invocations log and review individual LLM calls
4. Check the cost breakdown for the run

**Exercise 2: Run locally with --mock flag**

1. Ensure your environment is configured (see [Minicomputer Deployment](./minicomputer_deployment.md) for env vars)
2. Run: `npx ts-node evolution/scripts/run-evolution-local.ts --mock`
3. The `--mock` flag uses stub LLM responses, so no API keys or costs are needed
4. Watch the console output to see the generate/rank/evolve loop in action
5. Verify the run completed by checking the database or admin UI

**Exercise 4: Trace a variant's lineage in the UI**

1. Open a completed run in the admin dashboard
2. Find a variant from a later round (round 3+)
3. Trace its `parent_variant_id` chain back to the original generated variant
4. Note how ratings (`elo` / `uncertainty`) changed across generations
5. Read the evolution prompts to understand what feedback drove each improvement

### Checkpoint

By end of week 4, you should be able to:
- Navigate the full codebase using the reference file index
- Run the pipeline locally with mock data
- Deploy or update the system on the minicomputer
- Debug a failed run by reading logs and tracing execution

---

## Prioritized Reading List

The 10 most important source files, in recommended reading order. Each builds on the previous.

| # | File | Purpose |
|---|------|---------|
| 1 | `evolution/src/lib/types.ts` | Core type definitions — the vocabulary for everything else |
| 2 | `evolution/src/lib/pipeline/evolve-article.ts` | Main loop — the generate/rank/evolve cycle |
| 3 | `evolution/src/lib/pipeline/runner.ts` | Run orchestration — round management and stop conditions |
| 4 | `evolution/src/lib/pipeline/generate.ts` | Generation phase — creating variants from prompts |
| 5 | `evolution/src/lib/pipeline/rank.ts` | Ranking phase — pairwise comparisons and pair selection |
| 6 | `evolution/src/lib/pipeline/evolve.ts` | Evolution phase — improving top variants |
| 7 | `evolution/src/lib/shared/rating.ts` | Elo rating with uncertainty — public `{elo, uncertainty}` math, convergence, DB boundary helpers (OpenSkill internally) |
| 8 | `evolution/src/lib/pipeline/cost-tracker.ts` | Budget management — spending gates and pressure tiers |
| 9 | `evolution/src/lib/pipeline/finalize.ts` | Result persistence — writing final state |
| 10 | `evolution/src/services/evolutionRunnerCore.ts` | Entry point — how runs are launched |

---

## Glossary

Key terms used throughout the Evolution documentation and codebase.

| Term | Definition |
|------|------------|
| **Arena** | Persistent cross-run leaderboard using Elo ratings with per-variant uncertainty (OpenSkill internally). Allows variants from different runs to be compared. See [Arena](./arena.md). |
| **Seed variant** | The initial article variant in a run (version 0, `strategy='seed_variant'`). Every prompt-based run starts with one seed variant before generating alternatives. **Renamed from "baseline" 2026-04-14**; admin UI dual-accepts both names for one release cycle. When a persisted seed exists for the prompt (`generation_method='seed'`), the run reuses its UUID + rating instead of creating a fresh one — see [arena.md](./arena.md). |
| **Budget pressure** | Dynamic scaling of comparison counts based on how much of the run budget has been consumed. Three tiers — low, medium, high — progressively reduce comparison work to stay within budget. See [Cost Optimization](./cost_optimization.md). |
| **Convergence** | The primary stop condition. Triggered when 2 consecutive rounds produce all eligible variant `uncertainty` values below `DEFAULT_CONVERGENCE_UNCERTAINTY` (72, Elo-scale), meaning ratings have stabilized. See [Rating & Comparison](./rating_and_comparison.md). |
| **Elimination** | Removing a variant from further comparisons because it is statistically unlikely to be competitive. Rule: variant is eliminated when `r.elo + 2 * r.uncertainty < top20Cutoff`. |
| **Elo** | The public skill-estimate scale used throughout the Evolution system. Higher `elo` means the variant is rated as producing better articles. Fresh variants start at 1200. A 400-point gap corresponds to ~10:1 win odds (chess convention). |
| **Experiment** | A collection of runs testing different strategies on the same prompt. Used for A/B testing model configurations. See [Strategies & Experiments](./strategies_and_experiments.md). |
| **Invocation** | A single tracked LLM call within a run. Stored in the `evolution_agent_invocations` table with token counts, cost, model, and timing. |
| **OpenSkill** | The Weng-Lin Bayesian rating system used internally by `computeRatings.ts`. Its `mu`/`sigma` pair is hidden behind the public `Rating = {elo, uncertainty}` API and the `dbToRating` / `ratingToDb` boundary helpers. See [Rating & Comparison](./rating_and_comparison.md). |
| **Pool** | The append-only collection of all variants in a run. New variants are added each round via generation and evolution; variants are never removed from the pool, only eliminated from active comparisons. |
| **Prompt** | The question or topic that articles explain. Stored in the `evolution_prompts` table. Each run targets one prompt. |
| **Rating** | Public type `{elo: number, uncertainty: number}` — both on the Elo scale. Defaults: `{elo: 1200, uncertainty: 400/3 ≈ 133.33}`. Replaces the former OpenSkill-native `{mu, sigma}` shape on the public API. |
| **Strategy** | A named config entity (`evolution_strategies` table) that defines how a run executes — which LLM to use, iteration count, budget cap, and other parameters. Not to be confused with *tactic* (see below). |
| **Tactic** | A text transformation applied during the generation phase (e.g., `lexical_simplify`, `grounding_enhance`, `compression_distill`). There are 24 tactics organized into 7 categories. A single strategy run uses multiple tactics per iteration. Defined in `evolution/src/lib/core/tactics/`. |
| **Swiss pairing** | Tournament-style matching where variants with similar ratings are paired for comparison. Produces more informative comparisons than random pairing. Used after triage. |
| **Triage** | Initial calibration phase for newly created variants. Pairs new variants against stratified opponents (spread across the rating range) to quickly establish a rough rating before entering Swiss pairing. |
| **Uncertainty** | The Elo-scale standard deviation around a variant's `elo`. Lower means more confident in the estimate. Provides a 95% CI of `elo ± 1.96 * uncertainty`. Replaces the former `sigma` field on the public API. |
| **Variant** | A text article generated or evolved during a run. Each variant has a `Rating {elo, uncertainty}`, a parent reference (if evolved), and belongs to a specific round and run. |

---

## Quick-start exercises summary

| Exercise | Week | What you learn |
|----------|------|---------------|
| 1. Read a run's logs in the admin dashboard | 4 | Navigating the UI, understanding run timelines and invocation logs |
| 2. Run locally with `--mock` flag | 4 | Local development setup, observing the pipeline loop without API costs |
| 3. Create an experiment with 2 strategies | 3 | Experiment creation, strategy configuration, comparing results |
| 4. Trace a variant's lineage in the UI | 4 | Understanding variant evolution chains, rating progression |

---

## Cross-reference index

Every doc in the Evolution system, listed with its role in this curriculum:

| Document | Week | Role |
|----------|------|------|
| [README](./README.md) | 1 | Orientation and doc map |
| [Data Model](./data_model.md) | 1 | Database schema and relationships |
| [Architecture](./architecture.md) | 1 | Execution flow and system design |
| [Agents Overview](./agents/overview.md) | 2 | Pipeline phase details |
| [Rating & Comparison](./rating_and_comparison.md) | 2 | Rating system and comparison mechanics |
| [Arena](./arena.md) | 2 | Cross-run leaderboard |
| [Strategies & Experiments](./strategies_and_experiments.md) | 3 | Strategy management, experiments, metrics |
| [Cost Optimization](./cost_optimization.md) | 3 | Budget tracking and spending gates |
| [Reference](./reference.md) | 4 | Complete file index and CLI reference |
| [Visualization](./visualization.md) | 4 | Admin UI architecture |
| [Minicomputer Deployment](./minicomputer_deployment.md) | 4 | Production deployment |
