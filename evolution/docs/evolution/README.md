# Evolution Pipeline Documentation

Entry point for all evolution pipeline documentation. The V2 evolution pipeline is an autonomous content improvement system that iteratively generates, ranks, and evolves text variations using a 3-operation flat loop (generate → rank → evolve).

## Reading Order

### Start Here
1. **[Architecture](./architecture.md)** — V2 pipeline: 3-op flat loop, kill mechanism, stop reasons, runner lifecycle
2. **[Data Model](./data_model.md)** — Core primitives: Prompt, Strategy, Run, Article, dimensional queries

### Rating & Quality
3. **[Rating & Comparison](./rating_and_comparison.md)** — OpenSkill Bayesian rating, Swiss tournament, bias mitigation, comparison methods
4. **[Arena](./arena.md)** — Cross-method comparison via OpenSkill (Weng-Lin Bayesian), prompt bank

### Operations
5. **[Operations Overview](./agents/overview.md)** — V2 operations: generateVariants(), rankPool(), evolveVariants(), format validation

### Experiments & Metrics
6. **[Strategy Experiments](./strategy_experiments.md)** — Manual experiment system for comparing pipeline configurations
7. **[Experimental Framework](./experimental_framework.md)** — Per-run metrics (median/p90/max Elo), bootstrap CIs, cost breakdowns

### Infrastructure
8. **[Cost Optimization](./cost_optimization.md)** — Cost tracking, Pareto frontier, batch experiments
9. **[Visualization](./visualization.md)** — Admin experiment pages, shared components, V2 server actions
10. **[Reference](./reference.md)** — Configuration, database schema, key files, CLI, deployment, testing
11. **[Minicomputer Deployment](./minicomputer_deployment.md)** — Step-by-step guide for deploying the batch runner on a local minicomputer
12. **[Curriculum](./curriculum.md)** — Learning path for understanding the evolution codebase

## Document Map

```
evolution/docs/evolution/
├── README.md                    ← You are here
├── architecture.md              # V2 pipeline: flat loop, kill mechanism, data flow
├── data_model.md                # Core primitives and dimensional queries
├── rating_and_comparison.md     # OpenSkill rating, ranking, bias mitigation
├── agents/
│   └── overview.md              # V2 operations: generate, rank, evolve
├── arena.md                     # Cross-method OpenSkill comparison, prompt bank
├── cost_optimization.md         # Cost tracking, Pareto analysis
├── entity_diagram.md            # Entity relationship diagram
├── curriculum.md                # Learning path for the codebase
├── strategy_experiments.md      # Manual experiment system
├── experimental_framework.md    # Per-run metrics, bootstrap CIs
├── visualization.md             # Admin experiment pages and shared components
├── reference.md                 # Config, schema, files, CLI, deploy, testing
└── minicomputer_deployment.md   # Local minicomputer setup guide
```

## Unified Arena Rating

The evolution system uses a **single OpenSkill (Bayesian, mu/sigma) rating system**. Arena entries are loaded into the pool at pipeline start, rated naturally alongside new variants during the run, and synced back atomically at completion. See [Arena](./arena.md) for the unified pool model and [Rating & Comparison](./rating_and_comparison.md) for algorithm details.

## Kill Mechanism

Running runs can be killed by an admin. The pipeline detects kills at each iteration boundary via a DB status check. See [Architecture — Kill Mechanism](./architecture.md#kill-mechanism).

## Code Layout

The V2 evolution system lives under `evolution/src/lib/v2/` with integration points in `evolution/src/services/`, `src/app/admin/evolution/`, and `evolution/scripts/`. See [Reference — Key Files](./reference.md#key-files) for the complete file index.
