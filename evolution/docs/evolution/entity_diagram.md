# Evolution Entity Relationship Diagram

Core entities and their relationships in the evolution pipeline data model.

![Entity Diagram](./entity_diagram.png)

```mermaid
flowchart TD
    EXP["`**EXPERIMENT**
    _evolution_experiments_`"]
    PROMPT["`**PROMPT**
    _evolution_prompts_`"]
    STRATEGY["`**STRATEGY**
    _evolution_strategies_`"]
    RUN["`**RUN**
    _evolution_runs_`"]
    INV["`**AGENT INVOCATION**
    _evolution_agent_invocations_`"]
    VAR["`**VARIANT**
    _evolution_variants_`"]

    EXP -- "prompt_id FK" --> PROMPT
    EXP -- "experiment_id FK" --> RUN
    STRATEGY -- "strategy_id FK" --> RUN
    RUN -- "prompt_id FK" --> PROMPT
    RUN -- "run_id FK" --> INV
    INV -- "produces" --> VAR
    VAR -- "parent_variant_id FK" --> VAR

    style EXP fill:#2d1b4e,stroke:#8b5cf6,color:#e9d5ff
    style PROMPT fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe
    style STRATEGY fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe
    style RUN fill:#3b1d0b,stroke:#f59e0b,color:#fef3c7
    style INV fill:#1a2e1a,stroke:#22c55e,color:#bbf7d0
    style VAR fill:#1a2e1a,stroke:#22c55e,color:#bbf7d0
```

## Relationships

| From | To | FK | Cardinality | Notes |
|------|----|----|-------------|-------|
| Experiment | Prompt | `experiment.prompt_id` | 1:1 | Each experiment targets exactly one prompt |
| Experiment | Run | `run.experiment_id` | 1:N | Experiment creates N runs (manually configured) |
| Strategy | Run | `run.strategy_id` | 1:N | NOT NULL — every run must have a strategy. Reused via SHA-256 config hash dedup. Runner reads config from this FK at runtime (no inline `config` JSONB on run). `budget_cap_usd` is a direct column on the run row. |
| Run | Prompt | `run.prompt_id` | N:1 | Inherited from parent experiment |
| Run | Agent Invocation | `invocation.run_id` | 1:N | One per agent per iteration, UNIQUE(run_id, iteration, agent_name) |
| Agent Invocation | Variant | logical (agent_name + generation) | 1:N | Agents produce variants during execution |
| Variant | Variant | `variant.parent_variant_id` | 0:1 | Self-referential lineage (crossover has multiple parents in pipeline state) |

## Entity Summary

| Entity | Table | UI Access |
|--------|-------|-----------|
| Experiment | `evolution_experiments` | `/admin/evolution/experiments/[id]` |
| Prompt | `evolution_prompts` | Listed in experiment creation |
| Strategy | `evolution_strategies` | Listed in experiment creation |
| Run | `evolution_runs` | Runs tab within experiment detail |
| Agent Invocation | `evolution_agent_invocations` | DB only (no UI page) |
| Variant | `evolution_variants` | DB only (no UI page) |
