# Evolution System — Learning Curriculum

Organized sequence for understanding the V2 evolution codebase. Each module builds on the previous ones.

---

## Module 1: Foundation — Types & Data Model

**Goal:** Understand what things are before learning what they do.

| File | What to learn |
|---|---|
| `lib/v2/types.ts` | `EvolutionConfig`, `EvolutionResult`, `V2Match`, `V2StrategyConfig` |
| `lib/types.ts` | `TextVariation`, `Rating`, `BudgetExceededError` — V1 types reused by V2 |

**Key concept:** Everything revolves around a pool of `TextVariation`s that get rated, compared, and evolved through a flat generate→rank→evolve loop.

---

## Module 2: Rating System — How Variants Are Scored

**Goal:** Understand the scoring math before seeing who calls it.

| File | What to learn |
|---|---|
| `lib/core/rating.ts` | OpenSkill Bayesian model (mu/sigma), `updateRating`, `updateDraw`, convergence detection, `toEloScale` |

**Key concept:** `mu` = skill estimate, `sigma` = uncertainty. Matches reduce sigma. Variants with low sigma are "calibrated." Winner: highest mu, tie-break lowest sigma.

---

## Module 3: Comparison Engine — How Variants Are Judged

**Goal:** Understand the LLM-powered judging before seeing which operations use it.

| File | What to learn |
|---|---|
| `lib/comparison.ts` | 2-pass bias-mitigated pairwise comparison (A vs B, then B vs A), confidence aggregation |
| `lib/core/reversalComparison.ts` | Generic 2-pass reversal framework |

**Key concept:** Every comparison runs twice with reversed order to mitigate position bias. Results are cached.

---

## Module 4: Cost & Budget System

**Goal:** Understand the financial guardrails.

| File | What to learn |
|---|---|
| `lib/v2/cost-tracker.ts` | Reserve-before-spend pattern, 1.3x margin, available budget calculation |
| `lib/v2/llm-client.ts` | LLM wrapper with retry (3x), timeout (60s), cost tracking, model pricing |

**Key concept:** `reserveBudget()` blocks with 30% safety margin. `BudgetExceededError` propagates up to stop the pipeline. V2 budget enforcement is global-only (no per-agent caps).

---

## Module 5: The Three V2 Operations

**Goal:** Learn the core operations that make up the flat loop.

### 5a: Generation

| File | What to learn |
|---|---|
| `lib/v2/generate.ts` | 3 parallel strategies (structural_transform, lexical_simplify, grounding_enhance), format validation |

### 5b: Ranking

| File | What to learn |
|---|---|
| `lib/v2/rank.ts` | Triage (stratified opponents, adaptive early exit, top-20% cutoff) + Swiss fine-ranking (info-theoretic pairing, budget pressure tiers, convergence detection) |

### 5c: Evolution

| File | What to learn |
|---|---|
| `lib/v2/evolve.ts` | Mutation (clarity/structure), crossover (two parents), creative exploration (low diversity trigger) |

**Supporting files:**

| File | What to learn |
|---|---|
| `lib/agents/formatValidator.ts` | `validateFormat()` — prose format enforcement |
| `lib/agents/formatRules.ts` | `FORMAT_RULES` — rules injected into generation prompts |
| `lib/core/textVariationFactory.ts` | `createTextVariation()` — shared factory for all operations |

---

## Module 6: Pipeline Orchestration

**Goal:** See how everything fits together.

| File | What to learn |
|---|---|
| `lib/v2/evolve-article.ts` | Main orchestrator: kill detection → generate → rank → evolve loop, winner determination |
| `lib/v2/invocations.ts` | Per-operation invocation tracking (create/update lifecycle) |
| `lib/v2/run-logger.ts` | Structured logging to DB |

**The V2 loop:**

```
validateConfig → insertBaseline → LOOP {
  killCheck → generateVariants → rankPool → evolveVariants → budgetCheck
} → selectWinner (highest mu, tie-break lowest sigma)
```

---

## Module 7: Runner Lifecycle

**Goal:** Understand how runs are claimed, executed, and finalized.

| File | What to learn |
|---|---|
| `lib/v2/runner.ts` | `executeV2Run`: heartbeat → resolveConfig → resolveContent → upsertStrategy → loadArena → evolveArticle → finalizeRun → syncArena |
| `lib/v2/finalize.ts` | Persist results in V1-compatible format: run_summary, variants table, strategy aggregates |
| `lib/v2/seed-article.ts` | Seed article generation for prompt-based runs (2 LLM calls) |
| `lib/v2/strategy.ts` | Config hashing (SHA-256) and auto-labeling |

---

## Module 8: Arena & Cross-Run Integration

**Goal:** Understand how runs interact with the shared arena.

| File | What to learn |
|---|---|
| `lib/v2/arena.ts` | `loadArenaEntries` (pre-seed pool from arena), `syncToArena` (push results back via RPC) |

**Key concept:** Arena entries carry their ratings across runs. Variants are loaded with preset mu/sigma into the initial pool.

---

## Module 9: Experiments

**Goal:** Understand experiment management.

| File | What to learn |
|---|---|
| `lib/v2/experiments.ts` | `createExperiment`, `addRunToExperiment`, `computeExperimentMetrics` |
| `services/experimentActionsV2.ts` | 7 V2 server actions for experiment lifecycle |

---

## Module 10: Services Layer — How Runs Are Triggered

**Goal:** Understand the server-side orchestration.

| File | What to learn |
|---|---|
| `services/evolutionRunnerCore.ts` | Shared runner core for admin triggers |
| `services/evolutionRunClient.ts` | Client-side run management |
| `services/adminAction.ts` | Admin action factory with auth + logging |

---

## Module 11: Admin UI

**Goal:** See how experiments are managed in the UI.

| File | What to learn |
|---|---|
| `src/app/admin/evolution/experiments/page.tsx` | Experiment list |
| `src/app/admin/evolution/experiments/[experimentId]/page.tsx` | Experiment detail |
| `src/app/admin/evolution/start-experiment/page.tsx` | Experiment creation |
| `evolution/src/components/evolution/EntityListPage.tsx` | Shared list page pattern |
| `evolution/src/components/evolution/EntityDetailTabs.tsx` | Shared tab pattern |

---

## Suggested Reading Order (cover-to-cover)

1. `v2/types.ts` → `types.ts` → `core/rating.ts` (what things are)
2. `comparison.ts` (how judging works)
3. `v2/cost-tracker.ts` → `v2/llm-client.ts` (runtime infrastructure)
4. `v2/generate.ts` → `v2/rank.ts` → `v2/evolve.ts` (the three operations)
5. `v2/evolve-article.ts` (the orchestration loop)
6. `v2/runner.ts` → `v2/finalize.ts` (lifecycle & persistence)
7. `v2/arena.ts` → `v2/experiments.ts` (cross-run & experiments)
8. `services/experimentActionsV2.ts` → `services/evolutionRunnerCore.ts` (services layer)
