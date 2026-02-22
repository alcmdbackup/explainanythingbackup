# Understand Current Evolution Pipeline Research

## Problem Statement
The evolution pipeline documentation (`evolution_pipeline.md` and `evolution_pipeline_visualization.md`) may have drifted from the current codebase state after multiple feature branches. This research audits the codebase against both docs to identify discrepancies.

## High Level Summary
The two documentation files are **largely accurate** — the core architecture, agent descriptions, config values, and data flow match the codebase. However, there are several areas where the docs are incomplete or slightly outdated.

---

## CRITICAL FINDING: Only 2 Agents Execute in Production

**Root cause discovered 2026-02-05**: The admin UI trigger (`_triggerEvolutionRunAction`) uses `executeMinimalPipeline` with only 2 agents (GenerationAgent + CalibrationRanker), NOT `executeFullPipeline` with all 9 agents.

```typescript
// evolutionActions.ts line 347 (BEFORE fix)
const agents = [new GenerationAgent(), new CalibrationRanker()];
await executeMinimalPipeline(runId, agents, ctx, evolutionLogger, { startMs });
```

**Implications**:
- Timeline UI shows only "generation" and "calibration" because those are the only agents that run
- 7 agents (Reflection, IterativeEditing, Debate, Evolution, Tournament, Proximity, MetaReview) are fully implemented but never execute
- Supervisor phase configs (EXPANSION vs COMPETITION) are unused
- The full pipeline infrastructure exists and is tested but not wired up to production

**Resolution**: Implementation plan in `understand_pipeline_agent_executioN-20260204/` directory. Both options implemented:
- Option A: Upgraded admin trigger to use `executeFullPipeline` with all 9 agents
- Option B: Created cron endpoint `/api/cron/evolution-runner` for background processing

---

### Discrepancies Found in `evolution_pipeline.md`

1. **Missing `run_summary` migration** — Doc lists migrations `20260131000001` through `20260131000008` but misses `20260131000010_add_evolution_run_summary.sql` which adds the `run_summary` JSONB column + GIN index to `evolution_runs`.

2. **Missing `EvolutionRunSummary` documentation** — The pipeline now builds and validates a `EvolutionRunSummary` (with Zod schema) at the end of each full pipeline run. This includes `eloHistory`, `diversityHistory`, `matchStats`, `topVariants`, `baselineRank`, `baselineElo`, `strategyEffectiveness`, and `metaFeedback`. The doc doesn't mention this summary mechanism, `buildRunSummary()`, or `validateRunSummary()`.

3. **Missing `getEvolutionRunSummaryAction`** — The doc lists 8 server actions in `evolutionActions.ts` but the actual file has 9, including `getEvolutionRunSummaryAction(runId)`.

4. **Missing article bank migrations** — Doc doesn't mention the `20260201000001_article_bank.sql` migration that creates `article_bank_topics`, `article_bank_entries`, `article_bank_comparisons`, and `article_bank_elo` tables. These are referenced in the "Prompt-Based Seeding" section but the DB schema isn't documented.

5. **Missing `20260131000009_variants_optional_explanation.sql`** — Makes `explanation_id` nullable on `evolution_variants` table. Only `20260131000008` is listed.

6. **`comparison.ts` not documented in Key Files** — The standalone `compareWithBiasMitigation()` function in `src/lib/evolution/comparison.ts` is mentioned throughout but not listed in the Key Files tables.

7. **Missing prompt bank scripts** — Doc mentions `generate-article.ts` and `run-evolution-local.ts` but omits:
   - `scripts/run-prompt-bank.ts` (batch generation across prompts × methods)
   - `scripts/run-prompt-bank-comparisons.ts` (batch all-topic comparisons)
   - `scripts/run-bank-comparison.ts` (single-topic comparison)
   - `scripts/add-to-bank.ts` (add evolution run to bank)
   - `scripts/lib/bankUtils.ts` (shared bank insertion)
   - `scripts/lib/oneshotGenerator.ts` (shared oneshot generation)

8. **`promptBankConfig.ts` reference incomplete** — Doc mentions `src/config/promptBankConfig.ts` in doc-mapping but doesn't describe the 5 prompts (easy/medium/hard) or 4 methods (3 oneshot + 1 evolution) or comparison config.

9. **Missing `--bank-checkpoints` flag** — The local CLI now supports `--bank-checkpoints <list>` for snapshotting at specific iterations.

10. **Agent index.ts barrel export** — Doc doesn't mention that agents have NO barrel export file (agents must be imported individually), while `src/lib/evolution/index.ts` re-exports everything.

### Discrepancies Found in `evolution_pipeline_visualization.md`

1. **Missing run detail page features** — The run detail page (`run/[runId]/page.tsx`) has an "Add to Bank" dialog for exporting winners to the article bank. Not documented.

2. **Missing `getEvolutionRunSummaryAction`** — The visualization actions file has access to run summaries but this isn't mentioned.

3. **`rollbackEvolutionAction` signature** — Doc references `rollbackEvolutionAction(explanationId, runId)` but the actual signature is `rollbackEvolutionAction({explanationId, historyId})` — uses `historyId` not `runId`.

4. **Missing test files** — Doc doesn't list the additional integration test files:
   - `evolution-infrastructure.integration.test.ts`
   - `evolution-pipeline.integration.test.ts`
   - `scripts/run-evolution-local.test.ts`

5. **Architecture Decisions section** — States "DB `parent_variant_id` is never populated" but `run-evolution-local.ts` now preserves pipeline-generated variant UUIDs and `parent_variant_id` on insert. The pipeline doc already notes this ("Preserves pipeline-generated variant UUIDs and `parent_variant_id` on insert") so the visualization doc is behind.

6. **Missing `ComparisonData` type** — The `getEvolutionRunComparisonAction` returns `ComparisonData` which includes `generationDepth` (how many generations from baseline to winner). Not documented.

### Items Verified as Accurate

- All 12 core files exist and match documented descriptions
- All 10 agent files exist with matching class names, strategies, and behaviors
- `DEFAULT_EVOLUTION_CONFIG` values match exactly (including judgeModel='gpt-4.1-nano', generationModel='gpt-4.1-mini')
- `ELO_CONSTANTS` values match (INITIAL_RATING=1200, FLOOR=800)
- K_SCHEDULE matches (48/<5, 32/<15, 16/∞)
- All 4 feature flags match (tournament, evolvePool, dryRun, debate)
- Phase transition logic matches (pool≥15 AND diversity≥0.25 OR iteration≥8)
- Budget enforcement with 30% margin matches
- All 11 visualization components exist and match described functionality
- All 6 visualization server actions exist and match signatures
- D3 + Recharts dependency split matches
- Dashboard auto-polling at 15s matches
- All 6 evolution run statuses match
- GitHub Actions workflow matches (Monday 4am UTC, 7hr timeout)
- Watchdog cron at 10-minute stale threshold matches

## Documents Read
- `docs/feature_deep_dives/evolution_pipeline.md`
- `docs/feature_deep_dives/evolution_pipeline_visualization.md`
- `docs/planning/feat/visualization_tool_for_evolution_pipeline_20260131/_planning.md`
- `docs/planning/feat/visualization_tool_for_evolution_pipeline_20260131/_progress.md`
- `docs/planning/feat/visualization_tool_for_evolution_pipeline_20260131/_research.md`
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read (via explore agents)
### Core (`src/lib/evolution/core/`)
- `pipeline.ts` (605 lines) — Pipeline orchestrator
- `supervisor.ts` (260 lines) — Phase transitions
- `state.ts` (109 lines) — Mutable pipeline state
- `elo.ts` (90 lines) — Elo rating functions
- `costTracker.ts` (67 lines) — Budget enforcement
- `comparisonCache.ts` (42 lines) — Order-invariant cache
- `pool.ts` (132 lines) — Stratified sampling
- `diversityTracker.ts` (110 lines) — Diversity analysis
- `validation.ts` (90 lines) — State guards
- `llmClient.ts` (107 lines) — Budget-enforced LLM wrapper
- `logger.ts` (15 lines) — Structured logger factory
- `featureFlags.ts` (63 lines) — Feature flag reader

### Agents (`src/lib/evolution/agents/`)
- `base.ts`, `generationAgent.ts`, `calibrationRanker.ts`, `pairwiseRanker.ts`
- `tournament.ts`, `evolvePool.ts`, `reflectionAgent.ts`, `debateAgent.ts`
- `metaReviewAgent.ts`, `proximityAgent.ts`, `formatRules.ts`, `formatValidator.ts`

### Parent-level
- `src/lib/evolution/config.ts`, `types.ts`, `index.ts`, `comparison.ts`, `comparison.test.ts`

### Visualization Layer
- `src/components/evolution/` — 11 files (6 core + 5 tabs + index)
- `src/lib/services/evolutionVisualizationActions.ts` — 6 actions
- `src/lib/services/evolutionActions.ts` — 9 actions
- `src/app/admin/quality/evolution/` — 4 page routes

### Scripts
- `scripts/evolution-runner.ts`, `scripts/run-evolution-local.ts`, `scripts/generate-article.ts`
- `scripts/run-prompt-bank.ts`, `scripts/run-prompt-bank-comparisons.ts`
- `scripts/run-bank-comparison.ts`, `scripts/add-to-bank.ts`
- `scripts/lib/bankUtils.ts`, `scripts/lib/oneshotGenerator.ts`

### Migrations
- `20260131000001` through `20260131000010` (evolution schema)
- `20260201000001` (article bank schema)

### Config
- `src/config/promptBankConfig.ts`
- `.github/workflows/evolution-batch.yml`
- `.github/workflows/supabase-migrations.yml`
