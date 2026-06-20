<!-- Research findings for inferring implicit rubric criteria weights from human pairwise preferences + per-criterion gradings in the evolution pipeline. -->

# Calculate Implied Rubric Weights (Evolution) Research

## Problem Statement
Allow user preferences to support implicitly calculating implicit rubric criteria and weights. Rather than an admin hand-setting each judging dimension's weight, infer the rough weights from two kinds of human input — (1) which of a pair of articles is better, and (2) per-criterion grades on individual articles — and find the weighting that best reconciles the two. Serve a preview upfront estimating how many ratings of each type are needed.

## Requirements (from GH Issue #1229)
- Let user choose which variant is better, for a given pair.
- Let user grade articles on rubric components, separately.
- Figure out implied rough weightings that allow the two to match.
- This is a high-level idea, figure out how to do this and serve up a preview upfront of how many ratings of each type are necessary.

## High Level Summary

The codebase **already has the explicit version of this feature** and most of the substrate this project needs. The gap is purely the *inference* layer (human-data collection + a statistical fit) on top:

- **Rubric components already exist** as `evolution_criteria` rows: `{ name, label, description, min_rating, max_rating, evaluation_guidance: [{score, description}] }` (anchors). 7 starter criteria are seeded (`clarity`, `engagement`, `structure`, `depth`, `tone`, `point_of_view`, `sentence_variety`). Admin CRUD at `/admin/evolution/criteria`.
- **Weighted rubrics already exist** as `evolution_judge_rubrics` + `evolution_judge_rubric_dimensions` (`criteria_id` FK, `weight NUMERIC ≥ 0`, `position`). Weights are **normalized at read time** (`getJudgeRubricForEvaluation`). Today an admin types these weights in by hand at `/admin/evolution/judge-rubrics`; rubric-based pairwise judging (`rubricJudge.ts`) sums per-dimension winners by weight. **This project's output is exactly these weights — inferred instead of typed.**
- **Pairwise comparison infra exists**: `compareWithBiasMitigation` / `buildComparisonPrompt` / `parseWinner` / `aggregateWinners`, plus the `evolution_arena_comparisons` table (`entry_a`, `entry_b`, `winner ∈ {a,b,draw}`, `confidence`). Today the judge is an **LLM**; here the judge for the *training data* is a **human** (LLM judging is the eventual *consumer* of the inferred weights).
- **Judge Lab (`judge_eval_*` tables)** is the closest analog: it persists pairs (pair-banks), frozen test sets, and per-call verdicts, and computes accuracy vs. an Elo-gap ground truth. This is the right architectural pattern to imitate for the human-labelling + sample-set machinery.

### The core mechanic ("make the two match") — PAIR-BASED, per user revision
The rubric works **on pairs**, exactly like the production match rubric (`rubricJudge.scorePass`): for each human-judged pair `(A, B)` the human gives a per-criterion verdict `vᵢ ∈ {A-better:+1, B-better:−1, tie:0}` for each of the K criteria, **plus** an independent **overall** verdict (A/B/tie). We want weights `w = [w₁ … w_K] (wᵢ ≥ 0, Σwᵢ = 1)` such that the **weighted vote of the per-criterion verdicts predicts the overall winner**:

```
predicted_overall(A,B) = sign( Σ wᵢ · vᵢ )
```

This IS the production `scorePass` rule (`scoreA += wᵢ` where A won criterion i, `scoreB += wᵢ` where B won, TIE contributes nothing; higher score wins). So we fit a **non-negative logistic / Bradley–Terry model on the per-criterion verdict vector**:
- Feature vector per labelled pair = `v ∈ {−1,0,+1}ᴷ` (the per-criterion winners, oriented to the stored A/B frame).
- Label = the human's independent overall verdict.
- Fit non-negative `w` (softmax-param or clamp-and-refit, L2-regularized) maximizing agreement; renormalize to sum-1.
- The fitted coefficients **ARE** the implied rubric weights — and they plug straight into the existing rubric vote with **no semantic mismatch** (the prior continuous-score-difference approach was only an approximation of this discretized vote; the pair-based design removes that gap).

Key consequence: per-criterion verdicts and the overall verdict must be observed **on the same pairs** (to learn how the per-criterion winners combine into the overall), but elicited **separately/independently** to avoid anchoring. Small-K (3–8) ⇒ cheap to fit; the open questions are data-collection ergonomics + identifiability, not compute.

### The "preview of how many ratings necessary"
Emphasized in the brief. There are **two rating types** to size independently:
1. **Per-criterion gradings** — needed so each article in the labelled pairs has a score vector. Grader noise ⇒ may want ≥1 grading per article (or repeat-and-average). Drives how many *articles* must be graded across K criteria.
2. **Pairwise comparisons** — the regression labels. Identifiability of K weights needs the score-difference vectors to **span** the K-dimensional space (criteria that never vary, or always move together, can't be separated → flag collinearity). Rule-of-thumb floor ~10–20× K labelled pairs for stable coefficients; tighter weight CIs need more.

The preview is a **power/sample-size estimate** computed before the user starts: given K criteria (and optionally a target weight-CI width or held-out prediction accuracy), output e.g. *"≈ M articles graded (K scores each) + ≈ N pairwise comparisons"*. Candidate approaches to compute it (to decide in /planning): closed-form logistic-regression rule-of-thumb, a small Monte-Carlo simulation over plausible score distributions, or a D-optimal design heuristic. The preview should also update **live** as data comes in (current weight CIs / collinearity warnings / "≈ X more comparisons to converge").

### Integration target
Inferred weights → write/seed an `evolution_judge_rubrics` + `evolution_judge_rubric_dimensions` set (or recommend weights for an existing rubric). That closes the loop: human preference → inferred weights → rubric-based LLM judging (`EVOLUTION_RUBRIC_JUDGING_ENABLED`) drives the live arena. Aligns with white_paper.md's "aggregated scoring of similar articles … DAG-like voting" and "maximize feedback collection."

### Code-level findings (parallel research agents, confirmed)
- **Save-as-rubric seam:** `createJudgeRubricAction({ name, label?, description?, dimensions:[{criteria_id, weight≥0, position?}] })` in `evolution/src/services/judgeRubricActions.ts`. Zod requires ≥1 dimension + unique `criteria_id` + each `criteria_id` an active criterion (`validateCriteriaIds`). Weights stored RAW; **normalized at read** by `normalizeDimensions` in `evolution/src/lib/shared/rubricJudge.ts` (negatives→0, renormalize sum-1). `seedSampleJudgeRubrics.ts` is the programmatic example. So inferred weights can be saved directly (any non-neg scale).
- **Criteria read seam:** `listCriteriaAction({status:'active', filterTestContent:false, limit})` and `getCriteriaForEvaluation(db, ids)` expose `{id, name, label, description, min_rating, max_rating, evaluation_guidance:[{score,description}]}` — the grading scale + anchors for the Grade UI.
- **Weight consumption semantics (load-bearing):** `rubricJudge.scorePass` sums each dimension's winner side by weight (TIE/null contribute nothing); weights clamped non-neg + renormalized sum-1 at read. ⇒ the fit MUST emit non-negative weights or they're silently zeroed. Output relative magnitudes only (absolute logistic scale is discarded).
- **Stats inventory:** NO logistic/IRLS/Newton/matrix/optimization code and NO linear-algebra dep in `package.json` (only `openskill` rating, `fast-check` dev). Reuse `createSeededRng` + bootstrap-percentile idiom (`evolution/src/lib/metrics/experimentMetrics.ts` `bootstrapMeanCI`/`bootstrapPercentileCI`, with the B045 two-draws-per-iter discipline); copy sigmoid `pWin=1/(1+exp(-(eloA-eloB)/BETA_ELO))` from `evolution/src/lib/pipeline/loop/swissPairing.ts:67` and the logit-clamp from `evolution/src/lib/judgeEval/metrics.ts`. Hand-roll the K-dim fit (Newton/IRLS with inline K×K solve, or regularized GD) — no new dep.
- **Data-collection template:** Judge Lab spine (`judge_eval_pair_banks`→`test_sets`→`members`→`runs`→`calls`) is the pattern; `evolution/src/lib/judgeEval/{seed,testSet,persist,executeSweep,settings}.ts` + `judgeEvalActions.ts`. Seed-from-topic path in `seed.ts` (paginate `evolution_arena_comparisons` by `prompt_id`, dedupe order-invariant, snapshot variant content + `mu`/`sigma`). `judge_eval_dimension_verdicts` (criteria_id no-FK + `criteria_name` snapshot + numeric) is the closest template for per-criterion grade rows. **Decision: new `evolution_weight_inference_*` tables** (human-input shape ≠ LLM-verdict call shape).
- **Migration/RLS template:** follow `supabase/migrations/20260610000002_evolution_judge_rubrics.sql` (transactional `BEGIN; SET LOCAL statement_timeout`; `deny_all`+`service_role_all`+DO-guarded `readonly_select`; `is_test_content` trigger reusing IMMUTABLE `evolution_is_test_name(NEW.name)` from `20260415000001`; weighted-junction = composite PK + `ON DELETE CASCADE` parent + `ON DELETE RESTRICT`→`evolution_criteria`). Idempotency lint rules (CREATE TABLE/INDEX `IF NOT EXISTS`, `OR REPLACE FUNCTION`, DROP-before-CREATE POLICY/TRIGGER, ADD COLUMN/CONSTRAINT idempotency) per `scripts/lint-migrations-idempotent.ts`. Next migration timestamp: `20260619000001`. Zod schemas hand-maintained in `evolution/src/lib/schemas.ts`; `npm run db:types` after apply (generated types regen from remote, not local).
- **Admin UI + nav:** append one `NavItem` to the **Tools** group `items` array in `src/components/admin/EvolutionSidebar.tsx` (`testId:'evolution-sidebar-nav-weight-inference'`) — `activeOverrides` auto-derives. Page at `src/app/admin/evolution/weight-inference/page.tsx` (`'use client'`, `EvolutionBreadcrumb`, Midnight Scholar tokens, design-system ESLint enforced). Server actions via `adminAction(name, handler)` in `evolution/src/services/` (`'use server'`, `ActionResult<T>`, `requireAdmin`). Route auto host-gated (`EVOLUTION_PREFIXES`) + admin-gated (`layout.tsx`). No API route needed (no long-running LLM); fit is local compute.

### Resolved decisions (user + research)
- **Pair-based per-criterion verdicts (user revision):** the rubric works on pairs — "is A or B better on this criterion" — exactly like the production match rubric. Feature = per-criterion verdict vector `v∈{−1,0,+1}ᴷ`; label = independent overall verdict; fit learns the `scorePass` vote weights. Replaces the earlier absolute-score-grading approach (no continuous approximation).
- **Article pool source = arena-topic variants** (sample N, snapshot). **Infer scope = weights for an admin-chosen criteria set**; near-zero weights flagged "barely matters" (no auto criterion discovery in v1).
- **Data shape:** a **comparison** row per pair (overall winner) + child **dimension-verdict** rows (per-criterion winner) — mirrors `evolution_arena_comparisons` + `evolution_submatch_dimension_verdicts`. Per-criterion and overall verdicts observed on the same pair but elicited in **separate steps with the overall judged FIRST** (the per-criterion step for a pair is gated on its overall verdict existing) so the holistic call isn't a rationalized sum of the per-criterion verdicts. A/B presentation order randomized per pair (position-bias balance; humans can't cheaply do production's 2-pass reversal).
- **Constraints on `w`:** non-negative + sum-to-1 (softmax-param or clamp-and-refit); a would-be-negative coefficient (criterion whose verdicts oppose the overall) is surfaced as a "disagrees with overall" warning rather than silently dropped; near-zero ⇒ "barely matters."
- **Sampled reversal audit (user):** a configurable `replication_rate` (default ~15%, 0–100%) re-shows a sample of pairs reversed (sides swapped). Verdicts stored canonical-oriented (flip-on-save) so passes are comparable. Produces a **position-bias rate** + **self-consistency rate** (overall + per-criterion; human analogs of Judge Lab's LLM metrics); replicated-pair agreement feeds a per-pair confidence weighting in the fit. New comparison columns `pass` + `shown_swapped`; UNIQUE adds `pass`. Preview's "ratings needed" carries a `(1 + replication_rate)` overhead. Chose sampled over full 2-pass-every-pair to cap human labor.
- **Tie handling:** overall-ties dropped from the fit in v1 (noted as a simplification); verdict enum `('a','b','tie')`.
- **Rater:** capture `rater_id` (admin id) for future multi-rater; v1 UI is single-user.
- **Auto mode (LLM-as-judge), reuse seam confirmed:** `compareWithBiasMitigation` (`evolution/src/lib/shared/computeRatings.ts:789`) is pure (cache+return, no ratings/arena/metrics writes); with a `rubricContext` it returns a `RubricBreakdown` whose per-dimension `forwardVerdict`/`reverseVerdict` are **weight-independent** (extractable for the fit). For temperature/model control, use the inline 2-pass pattern (`run2PassReversal` + `buildComparisonPrompt`/`parseWinner`/`aggregateWinners` for overall; + `buildRubricComparisonPrompt`/`parseRubricVerdict`/`reconcilePasses` for per-criterion), exactly as `rejudgeComparisonAction` (`evolution/src/services/arenaActions.ts:651`) and `runJudgeEval.ts` do. Route via `callLLM(prompt,'evolution_weight_inference',adminUserId,model,…,{temperature,reasoningEffort,onUsage})` (`src/lib/services/llms.ts`) → `evolution_` prefix bills the evolution daily category + global `LLMSpendingGate`. Pre-flight cap mirrors `assertWithinJudgeEvalCap` (`evolution/src/lib/judgeEval/settings.ts`). 4 calls/pair (2 holistic + 2 rubric). Position-bias = forward/reverse disagreement (built-in); self-consistency = optional `auto_repeats`.

### Remaining items — RESOLVED in /plan-review iteration 1
- **Fit method:** clamp-and-refit ridge-regularized logistic/BT (committed; softmax rejected — can't yield exact 0). Mandatory non-zero L2 λ + iteration cap + sigmoid/logit clamp + non-identifiable columns pinned to 0.
- **Next-pair selection:** seeded-random uniform draw of P distinct pairs materialized eagerly at session create (active-learning "informative pair" selection deferred to a future iteration).
- **Fit caching:** **fit-on-read** (no persisted fit snapshot; the `status` pill is derived from coverage). Recomputed when the Results tab loads.
- **rater_id:** server-derived from `ctx.adminUserId`, never a client input.
- **Replica rows:** feed the audit + per-pair confidence only; NOT independent training rows (no double-count).

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (read for this project)
- evolution/docs/rating_and_comparison.md — Elo/uncertainty, 2-pass reversal, **Rubric-Based Judging** (existing explicit-weight system), comparison cache
- evolution/docs/criteria_agents.md — `evolution_criteria` rubric components, evaluate-and-suggest scoring
- evolution/docs/arena.md — pairwise comparisons, `evolution_arena_comparisons`, leaderboard
- evolution/docs/data_model.md — `evolution_criteria`, `evolution_judge_rubrics`(+dimensions), `evolution_arena_comparisons`, metrics EAV, RLS pattern, `judge_eval_*`
- evolution/docs/metrics.md + evolution/docs/evolution_metrics.md — EAV metrics registry, bootstrap CIs, propagation
- evolution/docs/strategies_and_experiments.md — `StrategyConfig`, `judgeRubricId`, config hashing
- evolution/docs/visualization.md — admin UI patterns (EntityListPage, MetricGrid, server actions, Tools nav group, Judge Lab pages)
- evolution/docs/reference.md — file inventory, env-var/kill-switch conventions, CLI, error classes
- evolution/docs/entities.md — entity registry + relationships
- evolution/docs/architecture.md — pipeline, `buildRunContext` rubric resolution
- evolution/docs/agents/overview.md — criteria-driven agents, comparison primitive
- docs/feature_deep_dives/judge_evaluation.md — **Judge Lab**: pair-banks, frozen test sets, per-call verdicts, criteria-split/aggregation — the closest data-collection/measurement analog
- evolution/docs/cost_optimization.md, editing_agents.md, variant_lineage.md, paragraph_recombine.md, prompt_editor.md, logging.md, multi_iteration_strategies.md, curriculum.md, minicomputer_deployment.md — read for full evolution context
- docs/docs_overall/white_paper.md — product philosophy: maximize feedback, aggregated/DAG-like article scoring
- docs/docs_overall/design_style_guide.md — Midnight Scholar tokens/components + ESLint design enforcement (for the new admin UI)

## Code Files Read (via parallel research agents)
- `evolution/src/services/judgeRubricActions.ts` — create/list/get/update/archive/delete rubric actions; `getJudgeRubricForEvaluation`, `validateJudgeRubricId`
- `evolution/src/services/criteriaActions.ts` — `listCriteriaAction`, `getCriteriaForEvaluation`, `validateCriteriaIds`
- `evolution/src/lib/shared/rubricJudge.ts` — `normalizeDimensions`, `scorePass`, `ResolvedRubricDimension` (weight semantics)
- `evolution/src/lib/schemas.ts` — `evolutionJudgeRubricInsertSchema`, criteria/anchor schemas (Insert/Row pattern)
- `evolution/scripts/seedSampleJudgeRubrics.ts` — programmatic rubric creation example
- `evolution/src/lib/judgeEval/{schemas,testSet,persist,seed,executeSweep,settings}.ts` + `evolution/src/services/judgeEvalActions.ts` — data-collection spine + seed-from-topic
- `evolution/src/lib/metrics/experimentMetrics.ts` (`createSeededRng`, `bootstrapMeanCI`, `bootstrapPercentileCI`), `evolution/src/lib/shared/ratingDelta.ts` (Box-Muller), `evolution/src/lib/pipeline/loop/swissPairing.ts` (BT sigmoid), `evolution/src/lib/judgeEval/metrics.ts` (logit/clamp)
- `evolution/src/services/adminAction.ts`, `evolution/src/services/shared.ts` (`ActionResult`) — server-action factory
- `src/components/admin/EvolutionSidebar.tsx` + `BaseSidebar.tsx` (Tools nav), `src/app/admin/evolution/{prompt-editor,judge-lab,judge-rubrics}/page.tsx` (page templates), `evolution/src/components/evolution/index.ts` (shared UI barrel), `src/app/admin/evolution/layout.tsx`, `src/middleware.ts`, `src/config/hostnames.ts` (gating)
- `supabase/migrations/20260610000002_evolution_judge_rubrics.sql`, `20260606000001_judge_eval_tables.sql`, `20260415000001_evolution_is_test_content.sql`; `scripts/lint-migrations-idempotent.ts`
- `package.json` (confirmed: no LA/optimization dependency)

> `/research` (next) can drill deeper into the exact fit implementation + `evolution/src/lib/shared/computeRatings.ts` rating scale if needed, but the integration seams above are confirmed sufficient to plan.
