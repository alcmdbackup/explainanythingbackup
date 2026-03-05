# Evolution Fixes Research

## Problem Statement
The evolution experiment system has several UX and architectural issues that reduce pipeline quality and usability. Budget should be set once at the experiment level rather than per-run, the "optimizing for" dropdown is unnecessary, experiment names shouldn't influence prompt names, strategy reuse needs confirmation, the model list is missing GPT-5 models, per-agent budgets should be eliminated, and runs should always exhaust their full budget rather than stopping early.

## Requirements (from GH Issue #627)
- [ ] Set budget for each per run once at experiment level - rather than for each run
- [ ] Get rid of "optimizing for" dropdown within experiment creation and eliminate anything associated to it
- [ ] Why does experiment name influence prompt name
- [ ] Confirm runs re-use strategies if they already exist
- [ ] List of available models available within experiment UI does NOT include GPT-5 models. Make sure we have canonical model set.
- [ ] Eliminate per agent budgets
- [ ] Make sure run always goes until full budget is exhausted

## High Level Summary

Research conducted over 4 rounds with 4 agents each (16 total agents). All 7 requirements have been fully investigated with code-level findings.

### Key Findings by Requirement

**1. Budget at experiment level**: Manual experiments currently set budget per-run ($0.50 default, $1.00 max). L8 experiments already divide total budget equally. The fix is to move the budget input to the experiment setup step in ExperimentForm and divide equally across runs.

**2. "Optimizing for" dropdown**: The `optimization_target` field (`'elo' | 'elo_per_dollar'`) is **purely informational** — the analysis code always ranks by `|eloEffect|` regardless. The experiment-driver cron never uses it for decisions. Safe to remove entirely.

**3. Experiment name → prompt name**: L8 experiments format explanation_title as `[Exp: ${input.name}] ${prompt.slice(0,50)}`. Manual experiments hardcode `[Exp: manual]` instead of using actual experiment name (**bug**). The experiment name leaks into explanation titles, creating non-matching titles for arena integration.

**4. Strategy reuse**: CONFIRMED — `resolveOrCreateStrategyFromRunConfig()` uses atomic INSERT-first with fallback SELECT, keyed by SHA-256 hash of (generationModel, judgeModel, iterations, enabledAgents, singleArticle). `budgetCaps` are excluded from hash. Strategies ARE reused across experiments.

**5. GPT-5 models**: Schema (`allowedLLMModelSchema`) includes gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano with pricing. BUT `MODEL_OPTIONS` in `runFormUtils.ts` only has 7 models (no GPT-5). Arena pages also missing some GPT-5 models.

**6. Per-agent budgets**: Two-level enforcement in `costTracker.ts`: per-agent cap (e.g., generation=20% of budget) checked first, then global cap. `budgetRedistribution.ts` scales caps when agents are disabled. Removing per-agent caps simplifies to global-only enforcement.

**7. Run until budget exhausted**: Runs typically stop on **plateau detection** (ordinal improvement < 0.12 over 3 COMPETITION iterations) or **maxIterations=15** BEFORE budget runs out. Removing plateau detection and raising maxIterations to a large value (e.g., 1000) would make budget the primary terminator.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md — Two-phase pipeline, agent selection, stopping conditions
- evolution/docs/evolution/data_model.md — Experiment model, strategy system, prompt→run relationship
- evolution/docs/evolution/reference.md — Config defaults, budget caps table, model list, CLI
- evolution/docs/evolution/cost_optimization.md — CostTracker, per-agent attribution, adaptive allocation
- evolution/docs/evolution/arena.md — Unified pool loading, arena sync
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill, tournament, bias mitigation
- evolution/docs/evolution/agents/overview.md — Agent framework, budget enforcement flow
- evolution/docs/evolution/agents/generation.md — GenerationAgent, OutlineGenerationAgent
- evolution/docs/evolution/agents/editing.md — IterativeEditingAgent, SectionDecompositionAgent

## Code Files Read

### Experiment System
- `evolution/src/services/experimentActions.ts` — All experiment CRUD actions, budget flow, run creation
- `evolution/src/experiments/evolution/factorial.ts` — L8 design, factor-to-config mapping
- `evolution/src/experiments/evolution/analysis.ts` — Main effects, factor ranking (always uses |eloEffect|, ignores optimization_target)
- `src/app/api/cron/experiment-driver/route.ts` — Experiment state machine, analysis trigger, spent_usd computation

### UI Components
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — 3-step form: setup, runs, review
- `src/app/admin/quality/optimization/_components/runFormUtils.ts` — MODEL_OPTIONS (7 models, no GPT-5), RunFormState, DEFAULT_RUN_STATE
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` — Shows optimization_target as "Target"
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` — Per-run budget display
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.tsx` — Analysis display
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.tsx` — Tab routing
- `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` — Budget progress bar
- `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx` — Experiment list

### Budget & Config
- `evolution/src/lib/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig(), MAX_RUN_BUDGET_USD=$1.00, MAX_EXPERIMENT_BUDGET_USD=$10.00
- `evolution/src/lib/core/costTracker.ts` — Two-level enforcement: per-agent cap then global cap, 30% safety margin, FIFO reservation queue
- `evolution/src/lib/core/budgetRedistribution.ts` — Agent classification (REQUIRED/OPTIONAL), computeEffectiveBudgetCaps()
- `evolution/src/lib/core/supervisor.ts` — shouldStop(): quality threshold, plateau, budget exhaustion, max iterations
- `evolution/src/lib/core/pipeline.ts` — Main loop, BudgetExceededError catch sites, agent dispatch
- `evolution/src/lib/core/configValidation.ts` — Model validation against allowedLLMModelSchema, iteration bounds

### Strategy & Model
- `evolution/src/services/strategyResolution.ts` — resolveOrCreateStrategyFromRunConfig(), atomic INSERT-first
- `evolution/src/lib/core/strategyConfig.ts` — hashStrategyConfig() excludes budgetCaps
- `src/lib/schemas/schemas.ts` — allowedLLMModelSchema (13 models including 4 GPT-5)
- `src/config/llmPricing.ts` — GPT-5 pricing present
- `src/app/admin/quality/arena/page.tsx` — Arena model selector (missing GPT-5)
- `src/app/admin/quality/arena/[topicId]/page.tsx` — Arena judge selector (partial GPT-5)

### Migrations
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — evolution_experiments table
- `supabase/migrations/20260303000001_flatten_experiment_model.sql` — experiment_id FK on runs, design/analysis_results
- `supabase/migrations/20260304000001_experiment_prompt_fk.sql` — prompt_id FK on experiments
- `supabase/migrations/20260304000003_manual_experiment_design.sql` — 'manual' design type
- `evolution/src/services/experimentReportPrompt.ts` — Report includes optimization_target as context

## Detailed Findings

### Req 1: Budget at Experiment Level

**Current behavior**:
- Manual experiments: Each run has its own `budgetCapUsd` (default $0.50, max $1.00). Experiment `total_budget_usd` is sum of all run budgets.
- L8 experiments: User provides total budget, divided equally: `perRunBudget = budget / 8`

**Code path**: ExperimentForm.tsx line 61 computes `totalBudget = runs.reduce((sum, r) => sum + r.budgetCapUsd, 0)`. Each run submitted via `addRunToExperimentAction` with individual `budgetCapUsd`.

**Fix**: Move budget input to setup step (alongside name/prompt). Remove per-run budget fields. Compute `budgetPerRun = experimentBudget / runs.length`. Cap at MAX_RUN_BUDGET_USD per run.

### Req 2: Remove "Optimizing For"

**Full reference list**:
- DB: `evolution_experiments.optimization_target` TEXT NOT NULL DEFAULT 'elo' CHECK IN ('elo', 'elo_per_dollar')
- Server: experimentActions.ts lines 77, 198, 283, 332, 600, 620
- UI: ExperimentForm.tsx lines 38, 185-198, 397
- Display: ExperimentOverviewCard.tsx line 137
- Report: experimentReportPrompt.ts line 22
- Cron: experiment-driver/route.ts line 28, 314 (fetched but NEVER used for logic)
- Tests: 6 test files with fixtures

**Fix**: Remove dropdown from ExperimentForm, hardcode 'elo' in DB inserts, remove from display, remove from types. DB column can stay with default value (no migration needed).

### Req 3: Experiment Name → Prompt Name

**L8 path** (experimentActions.ts:237): `promptTitle = [Exp: ${input.name}] ${resolvedPrompt.slice(0, 50)}`
**Manual path** (experimentActions.ts:698): `promptTitle = [Exp: manual] ${promptText.slice(0, 50)}` — **BUG**: hardcodes "manual" instead of `exp.name`

**Impact**: explanation_title contains experiment prefix which breaks arena topic matching in `arenaIntegration.ts:176-181` (Strategy 3 tries `.ilike('prompt', explanation_title.trim())` which never matches because arena topics have clean prompt text).

**Fix**: Stop embedding experiment name in explanation_title. Use the prompt text directly (or a clean truncated version). The experiment→run relationship is already tracked via `experiment_id` FK.

### Req 4: Strategy Reuse — CONFIRMED

`resolveOrCreateStrategyFromRunConfig()` in `strategyResolution.ts:97-109` calls `resolveOrCreateStrategy()` which:
1. Computes SHA-256 hash of (generationModel, judgeModel, iterations, enabledAgents, singleArticle)
2. Attempts INSERT with unique constraint on `config_hash`
3. Falls back to SELECT if INSERT fails (strategy already exists)

Both L8 experiments (line 231) and manual experiments (line 690) call this function. **Strategies ARE reused when configs match.**

### Req 5: GPT-5 Models

| Location | Models | GPT-5? |
|----------|--------|--------|
| `allowedLLMModelSchema` (schemas.ts) | 13 | All 4 ✓ |
| `llmPricing.ts` | 13+ | All 4 ✓ |
| `MODEL_OPTIONS` (runFormUtils.ts) | 7 | None ❌ |
| Arena generation (arena/page.tsx) | 6 | None ❌ |
| Arena judge (arena/[topicId]/page.tsx) | 10 | 2 of 4 (mini, nano only) |

**Fix**: Add all 4 GPT-5 models to `MODEL_OPTIONS` and arena UI selectors. Consider deriving UI model lists from the canonical schema to prevent future drift.

### Req 6: Eliminate Per-Agent Budgets

**Current enforcement** in costTracker.ts:23-41:
```
reserveBudget(agentName, estimatedCost):
  agentCap = (budgetCaps[agentName] ?? 0.20) * budgetCapUsd  ← PER-AGENT CHECK
  if agentSpent + margin > agentCap → throw BudgetExceededError
  if totalSpent + margin > budgetCapUsd → throw BudgetExceededError  ← GLOBAL CHECK
```

**Removal scope**:
- Remove `budgetCaps` from `EvolutionRunConfig` and `StrategyConfig` types
- Remove `budgetCaps` object from `DEFAULT_EVOLUTION_CONFIG`
- Simplify `CostTrackerImpl.reserveBudget()` to only check global budget
- Remove/simplify `computeEffectiveBudgetCaps()` in budgetRedistribution.ts
- Keep per-agent cost TRACKING (for metrics/attribution) — just remove enforcement
- Strategy hash already excludes budgetCaps — no impact on strategy identity
- ~275 lines of code affected (mostly tests and redistribution module)

### Req 7: Run Until Budget Exhausted

**Current stopping conditions** in supervisor.ts `shouldStop()`:
1. Quality threshold (single-article only) — all dimensions ≥ 8
2. **Plateau detection** (COMPETITION) — improvement < 0.12 over 3 iterations ← PRIMARY EARLY STOP
3. Budget exhaustion — available < $0.01
4. **Max iterations** — default 15 ← SECONDARY EARLY STOP

**Typical run**: Stops at plateau (~iteration 10-12) or max iterations (15), having spent ~40-60% of budget.

**Fix**: Disable plateau detection and raise maxIterations to a high value (e.g., 1000). Budget exhaustion becomes the primary terminator. Keep maxIterations as safety cap. Consider adding per-strategy/per-experiment config flag rather than changing global defaults, to avoid affecting non-experiment runs.

## Open Questions

1. **Req 1 budget division**: When user adds runs incrementally in manual experiment, should budget be re-divided equally each time? Or locked after first run?
2. **Req 3 explanation_title**: Should we stop creating explanations entirely for experiment runs and just use the prompt_id→arena_topic relationship? Or keep explanations but with clean titles?
3. **Req 7 scope**: Should "run until budget exhausted" apply to ALL runs or only experiment runs? Non-experiment runs (admin UI, cron) might still want plateau detection.
4. **Req 6 metrics**: After removing per-agent budget enforcement, should we still show per-agent cost breakdowns in the dashboard? (Likely yes — tracking stays, enforcement goes.)
