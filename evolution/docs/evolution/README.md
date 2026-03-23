# Evolution System Documentation

The Evolution system is an automated text quality improvement pipeline that uses evolutionary algorithms (generate → rank → evolve) with OpenSkill Bayesian ratings to iteratively improve explanatory articles.

## Reading Order

Start with the data model, then follow execution flow through agents, cost, and rating before moving to experiments and tooling.

| # | Document | Covers |
|---|----------|--------|
| 1 | [Data Model](./data_model.md) | 11 tables, RLS, RPCs, type hierarchy |
| 2 | [Architecture](./architecture.md) | Execution flow, 3-op loop, budget, runner lifecycle |
| 3 | [Agents](./agents/overview.md) | Operations, format validation, invocations |
| 4 | [Cost Optimization](./cost_optimization.md) | Cost tracker, pricing, spending gate |
| 5 | [Rating & Comparison](./rating_and_comparison.md) | OpenSkill, ranking, bias mitigation |
| 6 | [Strategy Experiments](./strategy_experiments.md) | Experiments, strategies, aggregates |
| 7 | [Experimental Framework](./experimental_framework.md) | Metrics, bootstrap CIs, run summary |
| 8 | [Arena](./arena.md) | Cross-run comparison, loading, syncing |
| 9 | [Reference](./reference.md) | Key files, CLI, config, testing, admin UI, errors |
| 10 | [Visualization](./visualization.md) | Admin pages, shared components, server actions |
| 11 | [Minicomputer Deployment](./minicomputer_deployment.md) | Setup, CLI flags, systemd |
| 12 | [Curriculum](./curriculum.md) | 4-week learning path, glossary |
| 13 | [Entity Diagram](./entity_diagram.md) | Visual entity relationships |

## Document Map

```
evolution/docs/evolution/
├── README.md                  ← You are here
├── data_model.md              — Tables, RLS policies, RPCs, type hierarchy
├── architecture.md            — Pipeline execution flow and runner lifecycle
├── agents/
│   └── overview.md            — Agent operations and format validation
├── cost_optimization.md       — Spending tracking and budget gates
├── rating_and_comparison.md   — OpenSkill ratings and bias mitigation
├── strategy_experiments.md    — Strategy definitions and experiment config
├── experimental_framework.md  — Statistical metrics and bootstrap CIs
├── arena.md                   — Cross-run arena comparison system
├── reference.md               — File index, CLI commands, config, errors
├── visualization.md           — Admin UI pages and shared components
├── minicomputer_deployment.md — Local deployment with systemd
├── curriculum.md              — Guided learning path and glossary
└── entity_diagram.md          — Visual entity relationship diagram
```

## Quick Orientation

- **Unified arena rating**: OpenSkill Bayesian ratings enable cross-strategy comparison across independent runs via the [Arena](./arena.md) system.
- **Kill mechanism**: Mark a run as failed/cancelled; the runner detects this at iteration boundaries and halts gracefully (see [Architecture](./architecture.md)).
- **Code layout**:
  - `evolution/src/lib/pipeline/` — core pipeline loop and operations
  - `evolution/src/lib/shared/` — utilities, types, cost tracking
  - `evolution/src/lib/schemas.ts` — Zod schemas for all DB entities and internal pipeline types
  - `evolution/src/services/` — server actions for admin UI
  - `evolution/src/components/` — React admin UI components
