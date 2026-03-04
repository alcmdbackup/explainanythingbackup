# Evolution Data Model Diagram

```
┌─────────────────────────┐
│      EXPERIMENT         │
│─────────────────────────│
│ id              UUID PK │
│ name            TEXT     │
│ status          TEXT     │
│ optimization_target TEXT │
│ total_budget_usd  NUM   │
│ spent_usd         NUM   │
│ design            TEXT   │
│ factor_definitions JSONB │
│ prompt_id        UUID FK │
│ analysis_results  JSONB  │
└────────────┬────────────┘
             │ 1
             │
             │ N
             ▼
┌─────────────────────────────────────────────────────────┐
│                          RUN                            │
│─────────────────────────────────────────────────────────│
│ id                  UUID PK                             │
│ experiment_id       UUID FK ───────────► EXPERIMENT     │
│ strategy_config_id  UUID FK ───────────► STRATEGY       │
│ prompt_id           UUID FK ───────────► PROMPT         │
│ explanation_id      INT  FK  (nullable)                 │
│ status              TEXT    (7 states)                   │
│ phase               TEXT    EXPANSION│COMPETITION        │
│ pipeline_type       TEXT    full│minimal│batch│single    │
│ config              JSONB   (snapshot from strategy)     │
│ total_cost_usd      NUM                                 │
│ budget_cap_usd      NUM                                 │
│ current_iteration   INT                                 │
│ continuation_count  INT                                 │
│ run_summary         JSONB                               │
└──────┬──────────────────────────────────────┬───────────┘
       │ 1                                    │ 1
       │                                      │
       │ N                                    │ N
       ▼                                      ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│    AGENT_INVOCATION      │   │          VARIANT             │
│──────────────────────────│   │──────────────────────────────│
│ id            UUID PK    │   │ id                UUID PK    │
│ run_id        UUID FK ──►│   │ run_id            UUID FK ──►│
│ iteration     INT        │   │ parent_variant_id UUID FK ─┐ │
│ agent_name    TEXT       │   │ explanation_id    INT  FK   │ │
│ execution_order INT      │   │ variant_content   TEXT      │ │
│ success       BOOL       │   │ elo_score         NUM      │ │
│ cost_usd      NUM        │   │ generation        INT      │ │
│ skipped       BOOL       │   │ agent_name        TEXT     │ │
│ execution_detail JSONB   │   │ match_count       INT      │ │
│ agent_attribution JSONB  │   │ is_winner         BOOL     │ │
│──────────────────────────│   │ elo_attribution   JSONB    │ │
│ UNIQUE(run_id,           │   │ quality_scores    JSONB    │ │
│   iteration, agent_name) │   │────────────────────────────│ │
└──────────────────────────┘   │         ▲                  │ │
                               │         └──────────────────┘ │
                               │         self-ref lineage     │
                               └──────────────────────────────┘

┌─────────────────────────┐   ┌─────────────────────────────┐
│       STRATEGY          │   │          PROMPT              │
│─────────────────────────│   │  (= evolution_arena_topics)  │
│ id            UUID PK   │   │─────────────────────────────│
│ config_hash   TEXT UK   │   │ id              UUID PK     │
│ name          TEXT      │   │ prompt          TEXT UK      │
│ label         TEXT      │   │ title           TEXT NOT NULL│
│ config        JSONB     │   │ difficulty_tier TEXT         │
│ is_predefined BOOL     │   │ domain_tags     TEXT[]       │
│ pipeline_type TEXT      │   │ status          TEXT         │
│ run_count     INT       │   └─────────────────────────────┘
│ avg_final_elo NUM       │
│ avg_elo_per_dollar NUM  │
│ status        TEXT      │
│ created_by    TEXT      │
└─────────────────────────┘


═══════════════════════════════════════════════════════
                  RELATIONSHIP SUMMARY
═══════════════════════════════════════════════════════

  EXPERIMENT ──1:N──► RUN          (experiment_id FK)
  STRATEGY   ──1:N──► RUN          (strategy_config_id FK)
  PROMPT     ──1:N──► RUN          (prompt_id FK)
  RUN        ──1:N──► VARIANT      (run_id FK)
  RUN        ──1:N──► INVOCATION   (run_id FK)
  VARIANT    ──0:1──► VARIANT      (parent_variant_id, self-ref)

═══════════════════════════════════════════════════════
                  CARDINALITY NOTES
═══════════════════════════════════════════════════════

  • Experiment → Run: L8 design = 8 runs, full-factorial = varies
  • Strategy → Run: reused across runs, aggregates updated post-run
  • Prompt → Run: same table as Arena Topic
  • Run → Variant: append-only pool, typically 15-60 per run
  • Run → Invocation: ~12 agents × N iterations, UNIQUE per agent/iter
  • Variant → Variant: lineage tree (crossover has multiple parents
    tracked in pipeline state, single parent_variant_id in DB)
```
