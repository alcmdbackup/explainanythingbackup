# Evolution Pipeline Documentation

Entry point for all evolution pipeline documentation. The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations using LLM-driven agents.

## Reading Order

### Start Here
1. **[Architecture](./architecture.md)** — Pipeline orchestration, two-phase design (EXPANSION→COMPETITION), checkpoint/resume, stopping conditions
2. **[Data Model](./data_model.md)** — Core primitives: Prompt, Strategy, Run, Article, dimensional queries

### Rating & Quality
3. **[Rating & Comparison](./rating_and_comparison.md)** — OpenSkill Bayesian rating, Swiss tournament, bias mitigation, comparison methods
4. **[Arena](./arena.md)** — Cross-method comparison via OpenSkill (Weng-Lin Bayesian), prompt bank, 3 generation workflows

### Agents
5. **[Agent Overview](./agents/overview.md)** — AgentBase framework, ExecutionContext, agent interaction table, format validation
6. **[Generation Agents](./agents/generation.md)** — GenerationAgent (3-strategy) + OutlineGenerationAgent (6-call pipeline)
7. **[Editing Agents](./agents/editing.md)** — IterativeEditingAgent (whole-article) + SectionDecompositionAgent (per-section)
8. **[Tree Search Agent](./agents/tree_search.md)** — Beam search with revision action diversity and collapse mitigation
9. **[Support Agents](./agents/support.md)** — ReflectionAgent, DebateAgent, EvolutionAgent, ProximityAgent, MetaReviewAgent
10. **[Flow Critique](./agents/flow_critique.md)** — Flow-dimension critique via PairwiseRanker, cross-scale weakness targeting

### Experiments & Metrics
11. **[Experimental Framework](./experimental_framework.md)** — Per-run metrics (median/p90/max Elo), bootstrap CIs, agent cost breakdowns, backfill script

### Infrastructure
12. **[Cost Optimization](./cost_optimization.md)** — Cost tracking, Pareto frontier, batch experiments
13. **[Visualization](./visualization.md)** — Admin dashboard, 5 tabs, 14 server actions, D3+React components
14. **[Reference](./reference.md)** — Configuration, feature flags, budget caps, database schema, key files, CLI, deployment, testing

## Document Map

```
evolution/docs/evolution/
├── README.md                    ← You are here
├── architecture.md              # Pipeline orchestration and phases
├── data_model.md                # Core primitives and dimensional queries
├── rating_and_comparison.md     # OpenSkill rating, tournaments, bias mitigation
├── agents/
│   ├── overview.md              # Agent framework and interaction patterns
│   ├── generation.md            # GenerationAgent + OutlineGenerationAgent
│   ├── editing.md               # IterativeEditingAgent + SectionDecompositionAgent
│   ├── tree_search.md           # TreeSearchAgent beam search
│   ├── support.md               # Reflection, Debate, Evolution, Proximity, MetaReview
│   └── flow_critique.md         # Flow-dimension critique and cross-scale targeting
├── arena.md                     # Cross-method OpenSkill comparison, prompt bank
├── cost_optimization.md         # Cost tracking, Pareto analysis
├── entity_diagram.md            # Entity relationship diagram
├── strategy_experiments.md      # Manual experiment system
├── visualization.md             # Dashboard components and server actions
└── reference.md                 # Config, flags, schema, files, CLI, deploy, testing
```

## Unified Arena Rating

The evolution system uses a **single OpenSkill (Bayesian, mu/sigma) rating system**. Arena entries are loaded into `state.pool` at pipeline start, rated naturally alongside new variants during the run, and synced back atomically at completion. See [Arena](./arena.md) for the unified pool model and [Rating & Comparison](./rating_and_comparison.md) for algorithm details.

## Config Validation & Kill Mechanism

The pipeline includes two operational safety features:

- **Config validation** — Strategy configs are validated at queue time (`validateStrategyConfig`) and run time (`validateRunConfig`). The admin UI shows inline warnings when a problematic strategy is selected and disables the "Start Pipeline" button. See [Architecture — Config Validation](./architecture.md#config-validation).
- **Kill mechanism** — Running/claimed runs can be killed by an admin via the dashboard Kill button. The pipeline detects the kill at the next iteration boundary using a three-checkpoint defense-in-depth design. See [Architecture — Kill Mechanism](./architecture.md#kill-mechanism).
- **Test name filtering** — Prompts and strategies with "test" in their name are hidden from the Start Pipeline dropdowns via the `isTestEntry()` predicate. Admin management pages still show all entries.

## Code Layout

The evolution system lives under `evolution/src/lib/` with integration points in `evolution/src/services/`, `evolution/src/components/evolution/`, and `evolution/scripts/`. See [Reference — Key Files](./reference.md#key-files) for the complete file index.
