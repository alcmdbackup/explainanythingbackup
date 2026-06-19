# Meta Analysis: How to Get Top Arena (Federal Reserve 2) Plan

## Background
Analyze what approaches are effective at generating variants that reach the very top of the Arena leaderboard for federal reserve 2. Generate new ideas for how to improve our existing system.

## Requirements (from GH Issue #NNN)
Same as summary - analyze and then generate new suggestions.

Specifically:
- Identify and quantify which strategies/agents/tactics/models/iteration shapes/criteria/rubrics/sourceMode+cutoff/floor configs/temperatures are producing top-of-arena variants for `federal_reserve_2`.
- Produce a ranked list of concrete, implementable improvement ideas (with predicted impact + cost + risk).

## Problem
*(refine after /research)*

The arena leaderboard for the `federal_reserve_2` prompt aggregates variants across runs, models, and strategies. While the leaderboard surfaces *which* variants are best, we lack a systematic, queryable analysis of **what made them best** — the combination of agent, tactic, parent lineage, iteration shape, and judge configuration that produced the top cohort. Without that breakdown we cannot make principled choices about which strategies to invest more compute in, which to retire, or which new agent/tactic ideas to prototype next.

## Options Considered

- [ ] **Option A: Pure SQL + admin-UI analysis (no code change)** — Query staging+prod via `npm run query:staging`/`query:prod` and screenshot the admin arena leaderboard, attribution charts, tactic leaderboard, and per-variant lineage. Deliverable: a written `docs/analysis/` report cataloging top-of-arena winners + their producing configurations + a ranked idea list. Pros: zero risk, fast turnaround, fits the existing `/analysis` skill shape. Cons: no executable artifact; relies on a human re-running the queries to verify findings later. Suitable when the output is a research report.
- [ ] **Option B: Analysis + a reusable analysis script** — Same as A, but also ship a TypeScript script under `evolution/scripts/` (e.g. `analyzeTopArena.ts`) that takes a `--prompt-id` arg, queries arena variants + invocations + attribution metrics, and emits a structured JSON/markdown report. Reusable for any future prompt. Pros: durable artifact, repeatable, parameterizable per prompt. Cons: small code-quality + test burden, modest scope creep beyond "analyze federal reserve 2".
- [ ] **Option C: Analysis + a new admin UI view** — Add an `/admin/evolution/arena/[topicId]/analysis` tab that auto-renders the meta analysis (top-N table, agent/tactic breakdown, attribution chart, lineage tree, cost-efficiency scatter). Pros: every researcher gets this view going forward; surfaces stale data on every visit. Cons: significant UI + server-action + tests scope; overkill if this is a one-off question.

> **Default recommendation:** Option A for the analysis report, with Option B as a fast follow-up if the same query shape proves useful across multiple prompts. Defer Option C unless researchers ask for it after seeing A/B.

## Phased Execution Plan

### Phase 1: Establish the data baseline
- [ ] Resolve the `federal_reserve_2` prompt UUID on staging and prod (`SELECT id, name FROM evolution_prompts WHERE name ILIKE '%federal%reserve%2%';`)
- [ ] Snapshot the top-50 arena variants (with full attribution: agent_name, tactic, model, parent chain, elo, uncertainty, arena_match_count, eloPer$) into a markdown table
- [ ] Snapshot the per-(agent, tactic) `eloAttrDelta:*` rows at strategy + experiment level for strategies that contributed to the top-50
- [ ] Snapshot the global tactic leaderboard (`/admin/evolution/tactics`, sorted by avg_elo_delta desc) for context
- [ ] Snapshot the head-to-head `evolution_arena_comparisons` history for the top-10 — who beat whom, how decisively, by which judge model

### Phase 2: Characterize the top cohort
- [ ] Group top-50 by agent type. Compute share, mean elo, median lineage depth, mean cost
- [ ] Within `generate` / `reflect_and_generate`, group by tactic. Identify the dominant tactics for this prompt
- [ ] Cross-tabulate (generation_model × judge_model) within the top cohort
- [ ] Compute the `sentence_verbatim_ratio` distribution — surgical edits (≥0.6) vs wholesale rewrites (≤0.3) cohorts
- [ ] Walk lineage on top-10 via `get_variant_full_chain` — characterize ancestor chains (depth, agents touched, tactic transitions)
- [ ] Identify which strategies (`evolution_strategies.config_hash`) produced multiple top variants — signal of a reproducible recipe

### Phase 3: Contrast against the rest of the leaderboard
- [ ] Compare top-N (top 10%) vs middle-50% vs bottom-25% on the same dimensions
- [ ] Identify dimensions that discriminate (agent, tactic, model, lineage depth, ratio) — these are the high-leverage knobs
- [ ] Identify dimensions that DON'T discriminate — these are noise / sample-too-small / saturated

### Phase 4: Synthesize new improvement ideas
- [ ] For each high-leverage knob, propose 1–3 concrete changes (e.g. shift tactic-guidance percentages, add an iteration of agent X after agent Y, swap judge model to Y, add a new criterion to a rubric, tune temperature ladder, try paragraph_recombine on top variants from generate)
- [ ] Rank proposals by expected impact / cost / risk
- [ ] For each top-3 proposal, sketch a controlled experiment that would test it (strategy config + experiment shape + N runs + success criterion)

### Phase 5: Write the analysis report
- [ ] Author `docs/analysis/top_of_arena_federal_reserve_2_YYYYMMDD.md` with: dataset summary, top-N table, breakdown charts (markdown tables), key findings, ranked idea list, recommended experiment configs
- [ ] Link the analysis report from `meta_analysis_how_to_get_top_arena_federal_reserve_2_progress.md`
- [ ] (If Option B chosen) Author `evolution/scripts/analyzeTopArena.ts` accepting `--prompt-id` / `--top-n` / `--out` + unit tests for the SQL helpers

## Testing

### Unit Tests
- [ ] (Only if Option B) `evolution/scripts/analyzeTopArena.test.ts` — exercise the SQL-builder + report-renderer helpers with mocked Supabase responses

### Integration Tests
- [ ] (Only if Option B) `src/__tests__/integration/analyze-top-arena.integration.test.ts` — seed a small synthetic arena (3 strategies × 5 runs × 5 variants) and assert the report's top-N table + tactic breakdown match expected

### E2E Tests
- [ ] None — analysis project, no UI changes

### Manual Verification
- [ ] Sanity-check the top-N table by manually opening `/admin/evolution/arena/[topicId]` in staging and spot-comparing 3 entries' Elo and parent chains
- [ ] Sanity-check 1–2 ranked ideas by walking the cited variants' lineage in the admin UI

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A (analysis only — no UI changes unless Option C)

### B) Automated Tests
- [ ] (Only if Option B) `npm run test:unit -- --grep "analyzeTopArena"`
- [ ] (Only if Option B) `npm run test:integration -- --grep "analyze-top-arena"`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/arena.md` — note any new analytical methodology if Option B ships a reusable script
- [ ] `evolution/docs/architecture.md` — likely no change (read-only analysis)
- [ ] `evolution/docs/agents/overview.md` — note any new improvement ideas that justify a new agent / tactic prototype
- [ ] `evolution/docs/criteria_agents.md` — if findings recommend new criteria rubrics, add a section
- [ ] `evolution/docs/editing_agents.md` — if findings suggest editing-agent tweaks, document
- [ ] `evolution/docs/paragraph_recombine.md` — if findings suggest paragraph_recombine knob changes, document
- [ ] `evolution/docs/rating_and_comparison.md` — likely no change
- [ ] `evolution/docs/strategies_and_experiments.md` — note any new recommended strategy templates if findings produce them
- [ ] `evolution/docs/multi_iteration_strategies.md` — note any new recommended `iterationConfigs[]` shapes
- [ ] `evolution/docs/variant_lineage.md` — likely no change
- [ ] `evolution/docs/metrics.md` — likely no change (would only update if a new metric is proposed)
- [ ] `evolution/docs/cost_optimization.md` — note any cost-efficiency findings (eloPer$ recipes)
- [ ] `evolution/docs/data_model.md` — likely no change
- [ ] `evolution/docs/visualization.md` — only if Option C ships a new admin tab

## Review & Discussion
*(populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration)*
