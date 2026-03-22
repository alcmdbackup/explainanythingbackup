# Evolution Docs Rewrite Plan

## Goal

Rewrite all 14 evolution docs from scratch based on the current V2 codebase state. The old docs were written for V1 and are significantly outdated after the clean-slate V2 migration (20260315), table renames (20260320), and RLS policy additions (20260321).

## Scope

Rewrite the following files under `evolution/docs/evolution/`:
1. README.md
2. architecture.md
3. data_model.md
4. rating_and_comparison.md
5. agents/overview.md
6. arena.md
7. strategy_experiments.md
8. experimental_framework.md
9. cost_optimization.md
10. visualization.md
11. reference.md
12. minicomputer_deployment.md
13. curriculum.md

Keep as-is: entity_diagram.md, entity_diagram.png

## Approach

### Writing Strategy
- Write docs in priority order (data_model first, README last)
- Each doc written by a dedicated agent with full research context
- After each doc: verify file paths, function names, and table names against codebase
- Cross-references added as docs are completed
- Final pass: README.md with correct links to all docs

### Content Standards
- Concise over comprehensive; link to code for deep dives
- 2-3 code snippets per doc (actual function signatures, not pseudocode)
- ASCII flowcharts for execution flows, tables for schemas/configs
- Highlight sharp edges (e.g., "diversity score not implemented", "second parent lost at finalize")
- No V1 content unless explicitly contrasting V1 vs V2
- Include file paths relative to repo root (e.g., `evolution/src/lib/pipeline/runner.ts`)

### Key Gaps to Address
From research rounds 1-9 (36 agents), these CRITICAL gaps must be filled:
- evolution_explanations table and seed article generation
- Clean-slate V2 migration implications
- RLS policies (deny-all + service_role bypass)
- FORMAT_VALIDATION_MODE env var
- Arena entry pre-seeding with ratings
- Budget pressure tiers and reserve-before-spend pattern
- executePhase wrapper and BudgetExceededWithPartialResults
- Lineage data loss (parentIds[0] only persisted)
- Diversity score declared but NOT implemented
- V1 legacy types still in codebase (stubs, unused validation)

## Implementation Plan

### Phase 1: Foundation Docs (HIGH priority)

#### Step 1: data_model.md (~2800-3500 words)
- 10 V2 tables with columns, constraints, FK relationships
- Entity relationship diagram reference
- RLS policies: deny-all default + service_role_all bypass
- Key RPCs: claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment, get_run_total_cost
- Schema evolution timeline: V2 clean-slate (20260315) → entity renames (20260320) → RLS (20260321)
- Type hierarchy: TextVariation, Rating, V2Match, EvolutionRunSummary (V1/V2/V3 migration)
- Run status lifecycle diagram
- Cost tracking tables: invocations, budget_events, run_costs view
- Lineage: parentIds[] vs parent_variant_id (data loss at finalize)

#### Step 2: architecture.md (~2500-3500 words)
- Entry points: API route, CLI runners, local runner
- Execution flow: claim → content resolution → arena load → pipeline → finalization → arena sync
- Content resolution: explanation_id path vs prompt_id path (seed article generation)
- 3-op loop: generate → rank → evolve with kill detection at boundaries
- Stop reasons: iterations_complete, converged, budget_exceeded, killed
- Convergence: 2 consecutive rounds with all eligible sigmas < 3.0
- Budget tracking: reserve-before-spend with 1.3x margin, budget tiers
- Pool management: append-only, baseline + arena entries as initial pool
- Winner determination: max mu, sigma tie-break
- Runner lifecycle: heartbeat (30s), watchdog (10 min stale), concurrent limits

#### Step 3: agents/overview.md (~2500-3200 words)
- V2 monolithic orchestrator pattern (contrast with V1 supervisor-agent)
- generateVariants(): 3 parallel strategies (structural_transform, lexical_simplify, grounding_enhance)
- rankPool(): triage (stratified opponents, early exit) + Swiss fine-ranking (Bradley-Terry pairing)
- evolveVariants(): mutate_clarity, mutate_structure, crossover, creative_exploration
- Format validation: rules, regex patterns, FORMAT_VALIDATION_MODE env var
- executePhase helper: success/budget exceeded/partial results handling
- Invocation tracking: createInvocation → updateInvocation lifecycle
- RunLogger: fire-and-forget structured logging

#### Step 4: cost_optimization.md (~2200-2800 words)
- V2 Cost Tracker: reserve-before-spend with 1.3x safety margin
- Budget pressure tiers: low (40), medium (25), high (15) comparisons
- LLM pricing table (8 models with input/output rates)
- Token estimation: 1 token ≈ 4 chars
- Cost analytics server actions
- Budget event logging (reserve, spend, release_ok, release_failed)
- Global LLM spending gate: kill switch, daily/monthly caps, category routing
- Two-layer budget model: local per-run + global system-wide

### Phase 2: Algorithm & Analysis Docs (MEDIUM priority)

#### Step 5: rating_and_comparison.md (~2200-3000 words)
- OpenSkill (Weng-Lin Bayesian): mu, sigma, convergence
- Elo scale conversion: 1200 + (mu - 25) * 16
- Two-phase ranking: triage + Swiss fine-ranking
- Bias mitigation: 2-pass A/B reversal with confidence scoring
- parseWinner() priority
- Comparison cache: order-invariant SHA-256 keys, confidence > 0.3 threshold
- Draw detection: confidence < 0.3 or winnerId === loserId

#### Step 6: strategy_experiments.md (~1800-2300 words)
- Experiment lifecycle: draft → running → completed/cancelled
- Auto-transitions: draft→running on first run add
- Strategy system: V2StrategyConfig, hash (excludes budgetUsd), auto-label
- Strategy aggregates: Welford's algorithm, FOR UPDATE locking
- eloPerDollar = (avg_final_elo - 1200) / total_cost_usd
- UI workflow: 3-step wizard (setup → strategies → review)

#### Step 7: experimental_framework.md (~1500-2000 words)
- Per-run metrics: median/p90/max Elo, cost, totalVariants, agentCost:*
- Bootstrap CIs: bootstrapMeanCI (scalar), bootstrapPercentileCI (percentile with uncertainty propagation)
- Run summary V3: construction in finalize.ts, Zod schema validation
- muHistory tracking: top-K per iteration
- Diversity score: declared but NOT implemented

#### Step 8: arena.md (~1500-2000 words)
- Unified cross-method comparison via OpenSkill
- Loading: loadArenaEntries(promptId), fromArena flag, pre-seeded ratings
- Syncing: syncToArena via RPC (max 200 entries, 1000 matches)
- Arena entries participate in ranking but NOT persisted to evolution_variants
- Prompt bank: evolution_prompts table

### Phase 3: Reference & Deployment (MEDIUM-LOW priority)

#### Step 9: reference.md (~3500-4500 words)
- Key files organized by layer (pipeline, support, schema, services, admin UI)
- Configuration: EvolutionConfig validation ranges, env vars, FORMAT_RULES
- CLI scripts: evolution-runner-v2.ts, evolution-runner.ts, run-evolution-local.ts
- Claiming: claim_evolution_run RPC, FIFO ordering, concurrent limits
- Heartbeat & stale detection: 30s interval, 10 min watchdog
- Testing: unit (18 pipeline + 10 shared + 8 services), E2E (Playwright), integration
- Admin UI: 15 pages with routes and purposes
- Error classes: BudgetExceeded*, GlobalBudgetExceeded, LLMKillSwitch
- RLS policies summary

#### Step 10: visualization.md (~1500-2000 words)
- 15 admin pages with routes and data flow
- Shared components: EntityListPage, EntityDetailHeader, MetricGrid, RunsTable, LineageGraph
- Server action architecture: adminAction factory, ActionResult<T>
- Data fetching: server actions vs API routes
- Auto-refresh: AutoRefreshProvider with visibility awareness
- D3 LineageGraph: dynamic import, layering by iteration, STRATEGY_PALETTE

#### Step 11: minicomputer_deployment.md (~1200-1800 words)
- Prerequisites and environment setup
- CLI flags: --parallel, --max-runs, --max-concurrent-llm, --dry-run
- Multi-target runner: staging + prod round-robin
- Systemd service setup (30 min timeout, SIGTERM handling)
- LLM provider configuration (OpenAI, DeepSeek, Anthropic, Ollama)

#### Step 12: curriculum.md (~2000-2500 words)
- 4-week learning path (Fundamentals → Operations → Administration → Advanced)
- Key files to study in order
- Glossary of terms

### Phase 4: Entry Point (write last)

#### Step 13: README.md (~300-400 words)
- 1-sentence system definition
- Reading order (13 docs in recommended sequence)
- Document map (directory listing with descriptions)
- Quick orientation: unified arena rating, kill mechanism, code layout
- Cross-links to all other docs

## Execution Strategy

- Each step produces one complete doc file
- Verify against codebase: check 3-5 file paths and function names per doc
- Run lint/build after each batch of changes
- Commit after each phase completion
- Final commit: all 13 docs + updated README

## Risk Mitigation

- **Stale research:** Verify file paths exist before referencing them in docs
- **Over-documentation:** Target word counts prevent scope creep
- **Missing cross-refs:** README written last ensures all docs exist before linking
- **V1 confusion:** Explicitly label V1 legacy content; default to V2-only perspective
