# Structured Judging Evolution Research

## Problem Statement

Today the evolution arena judge returns a single holistic A/B/TIE verdict per pairwise match. This project introduces **rubric-based match judging**: instead of one overall decision, the judge model returns which piece is better for each of X named dimensions (pulled from the existing `evolution_criteria` entity). Each dimension carries a weight; the code combines per-dimension winners against those weights to compute which variant wins the overall match (e.g. conciseness .30 / structure .40 / style .30 → a variant winning the first two takes .70 of points and wins). The structured output must work across the cheap judge models frequently used (Gemini 2.5 Flash Lite, DeepSeek, etc.), and the per-dimension breakdown must be browsable in the match-history detail view.

## Requirements (from GH Issue #1191)

- Rather than have judge model return which piece is better as a simple decision, have it return which is better for each of X dimensions. Dimensions can be pulled from existing criteria entity
- Each dimension along with optional description will be passed as prompt
- Output must be passed in a structured way, that works for Gemini 2.5 flash lite, Deepseek models, and other models that have been frequently used for judging
- Code should take structured output, then combine the dimensions along with a weighting to see which piece wins
- For example, if (conciseness: .30, structure : .40, style: .30), and article A wins the first 2, then it wins .70 of the overall points and wins the match
- We also want to have this information available to browse in detail in match history detail. It should show which variant won, and allow you to view the breakdown of how rubric-based match judging went

## High Level Summary

Initial doc-level research findings (code-level research to be completed in `/research`):

### Where judging happens today (the integration surface)
- **Single comparison primitive:** `compareWithBiasMitigation()` (`evolution/src/lib/comparison.ts`) is the sole pairwise comparison entry point used by both triage and Swiss ranking. It builds the prompt via `buildComparisonPrompt(textA, textB, mode)` (`evolution/src/lib/shared/computeRatings.ts`), runs a **2-pass A/B reversal** (`run2PassReversal` in `reversalComparison.ts`) to mitigate position bias, parses each pass with `parseWinner()`, and aggregates via `aggregateWinners()` into a `ComparisonResult { winner: 'A'|'B'|'TIE', confidence: [0,1], turns: 2 }`.
- **Current prompt contract:** `buildComparisonPrompt` (article mode) lists 5 fixed criteria (clarity, structure, engagement, grammar, overall) and instructs the model to reply with a single token `A` / `B` / `TIE`. `parseWinner()` is a strict priority chain expecting that single token. A `paragraph` mode swaps in a paragraph rubric. Rubric-based judging will need either a new structured-output path or a parallel comparison mode.
- **Bias mitigation is generic:** `run2PassReversal<TParsed, TResult>` is generic over the parsed/result types — a per-dimension structured result can reuse this framework (forward + reverse passes, then a per-dimension aggregate) rather than reinventing reversal.
- **Caching:** `ComparisonCache` keys are `${hashA}|${hashB}|${structured}|${mode}` — it already encodes a `structured` boolean and a `mode`, so a rubric mode + the criteria set must factor into the cache key to avoid collisions with holistic verdicts.

### Dimensions source — the criteria entity
- `evolution_criteria` (DB-first, migration `20260502120000`) already models exactly what "dimensions" need: `name` (regex-validated stable id), `label`, `description` (plain-language, injected into prompts today by the criteria-driven *generation* agents), `min_rating`/`max_rating`, and an optional `evaluation_guidance` JSONB rubric of `{score, description}` anchors (range-validated by `evolution_criteria_rubric_anchors_in_range`). Criteria are managed at `/admin/evolution/criteria` with a `RubricEditor`. `getCriteriaForEvaluation(db, criteriaIds, logger)` is the existing mid-run fetch helper. `validateCriteriaIds()` rejects unknown/archived/soft-deleted ids — strategies referencing criteria already validate at create time.
- The requirement "each dimension along with optional description will be passed as prompt" maps directly to `evolution_criteria.description` (+ optionally `evaluation_guidance` anchors). **Open question:** the requirement adds per-dimension *weights* (e.g. .30/.40/.30) which `evolution_criteria` does NOT currently store — weighting will need a home (per-strategy config? a new column? a judging-config entity?).

### Structured output across cheap models (Gemini Flash Lite, DeepSeek, …)
- The OpenRouter/DeepSeek path uses `json_object` (not schema-enforced structured output) — cheap models like `gemini-2.5-flash` already fail schema-enforced structured calls in some places (see project memory `project_openrouter_structured_output_gap`). A recent project (`fix_openrouter_json_schema_structured_output`, PR #1184) touched this. The rubric judge's structured output design must be robust on these models — likely a tolerant JSON parse with a reasoning-tolerant fallback (cf. `parseVerdictFromReasoning` used by the Match Viewer / Judge Lab) rather than relying on strict provider-side JSON-schema enforcement.
- `resolveReasoningRequestFields()` (`src/lib/services/llms.ts`) centralizes reasoning-effort hygiene per model; the default judge is `qwen-2.5-7b-instruct` (`DEFAULT_JUDGE_MODEL`).

### Persistence + match-history detail UI
- Matches are stored in `evolution_arena_comparisons` (`entry_a`, `entry_b`, `winner ∈ {a,b,draw}`, `confidence`, `run_id`, `status`). It currently drops judge settings and per-dimension data. Storing the rubric breakdown needs a new column (JSONB) or sibling table.
- **Match Viewer** (`/admin/evolution/matches`, list + `/[comparisonId]` detail) is the existing read surface and the natural home for the "view the breakdown" requirement. The detail page already shows the stored verdict + a display-only re-judge sandbox (`rejudgeComparisonAction`). `getRecentMatchesAction` / `getComparisonDetailAction` are the server actions. `MergeRatingsAgent` is the sole writer of in-run `evolution_arena_comparisons` rows; `sync_to_arena` later backfills `prompt_id`.
- **Judge Lab** (`/admin/evolution/judge-lab`, `judge_eval_*` tables) is the systematic judge-evaluation/measurement layer and shares the same comparison primitives + `judgeRubrics.ts` (`PARAGRAPH_SANDBOX_RUBRIC`); rubric judging may want to surface here too (decisive-rate per rubric settings).

### Likely change set (to refine in /research + /plan)
- New rubric comparison path threaded through `compareWithBiasMitigation` → `buildComparisonPrompt` (new `buildRubricComparisonPrompt`) → structured parse → per-dimension aggregate → weighted winner → `ComparisonResult`.
- Weighted aggregation: per-dimension forward/reverse reversal aggregate, then sum of weights of dimensions each side wins; ties handled where weighted score is even.
- A home for dimension weights (per-strategy judging config most likely).
- New JSONB persistence on `evolution_arena_comparisons` (or sibling) for the per-dimension breakdown; extend the writer (`MergeRatingsAgent`) + `sync_to_arena` RPC.
- Match Viewer detail: render the dimension-by-dimension breakdown (winner per dimension, weight, contribution) + the overall weighted winner.
- Cache-key + Zod-schema + cost-estimation updates.

## Code-Level Findings (5-round / 20-agent research, 2026-06-10)

All anchors verified by Explore agents against the working tree.

### A. The judging integration surface
- **Single primitive:** `compareWithBiasMitigation(textA, textB, callLLM, cache?, mode='article')` (`evolution/src/lib/shared/computeRatings.ts:562`) → returns `ComparisonResult { winner:'A'|'B'|'TIE', confidence, turns }` (`:309`). Builds prompts via `buildComparisonPrompt(textA, textB, mode)` (`:331`), runs `run2PassReversal` (`reversalComparison.ts`), parses with `parseWinner` (`:464`), aggregates with `aggregateWinners` (`:534`, the confidence table) + `flipWinner` (`:527`).
- **`ComparisonMode = 'article'|'paragraph'`** (`:318`). The `ComparisonCache` lives in the SAME file — key = `${hA}|${hB}|${structured}|${mode}` (`:211`).
- **Callers:** `rankSingleVariant.ts:314` (passes `config.comparisonMode`; builds match via `buildMatch` `:194`), `SwissRankingAgent.ts:141` (defaults 'article'), `rejudgeComparisonAction` (`arenaActions.ts`, sandbox), `runJudgeEval.ts:70` (Judge Lab). `ParagraphRecombineAgent.ts:715` sets `comparisonMode:'paragraph'` per-slot (a shallow spread of `ctx.config`).
- **Writer chain:** `ComparisonResult → buildMatch → V2Match` (`schemas.ts:986`, `types.ts:18`) → match buffer → **`MergeRatingsAgent`** (sole writer, INSERT `evolution_arena_comparisons` at `:289-318`). `persistSlotMatches` (`slotTopicActions.ts:164`) is a SECOND writer (per-slot paragraph). `sync_to_arena` RPC's `p_matches` is **deprecated/ignored** — it only backfills `prompt_id`.

### B. `evolution_criteria` — the dimension source (full map)
- Table: migration `20260503033102_create_evolution_criteria.sql` — `name` (regex `^[A-Za-z][a-zA-Z0-9_-]{0,128}$`, UNIQUE), `description`, `min_rating`/`max_rating` (CHECK max>min), `evaluation_guidance` JSONB `{score,description}[]` (CHECK `evolution_criteria_rubric_anchors_in_range`), `status`, `deleted_at`, `is_test_content` (trigger). Zod at `schemas.ts:107`.
- Helpers: `getCriteriaForEvaluation(db, ids, logger?) → Map` and `validateCriteriaIds(ids, db)` (`criteriaActions.ts:227,263`). Entity: `CriteriaEntity.ts`; admin `RubricEditor.tsx`.
- **How criteria become prompt text today** (`evaluateCriteriaThenGenerateFromPreviousArticle.ts:92` `buildEvaluateAndSuggestPrompt`): `${i+1}. ${name} (${min}-${max}): ${description}` + anchors `${score} = ${description}`. min/max + anchors ARE used here.

### C. Strategy plumbing (judgeRubricId mirrors criteriaIds/judgeModel)
- `judgeModel` is **strategy-level** (`strategyConfigBaseSchema`, `schemas.ts:810`); `comparisonMode` is **run-internal, never strategy-persisted, not in config_hash** (`:974`). `criteriaIds` is **per-iteration** (`iterationConfigSchema`).
- `hashStrategyConfig` v2 hashes the WHOLE `StrategyConfig` after `canonicalize` (drops undefined/null, sorts keys) (`findOrCreateStrategy.ts:119-174`). FIELD_GATES are iteration-scoped only → a strategy-level optional field is auto-included when set, omitted when unset (back-compat preserved). **Confirmed: `judgeRubricId` slots in with no special gating.**
- `buildRunContext.ts:331` is **async** and already calls `getCriteriaForEvaluation`; maps `StrategyConfig → EvolutionConfig` at `:380-396`. `validateCriteriaIds` is called in `createStrategyAction` (`strategyRegistryActions.ts:154`).

## Resolved Design Decisions (locked 2026-06-10)

| Area | Decision | Key evidence |
|---|---|---|
| **Comparison path** | Rubric branch in the existing primitive; **no-rubric path stays byte-identical** (branch only when a rubric is resolved). | R3U1, R5U3 |
| **Mode** | **Design Y — orthogonal overlay.** Keep `comparisonMode='article'\|'paragraph'` (text framing); pass an optional `rubricContext` to `buildComparisonPrompt`. **Do NOT add a 'rubric' enum value.** A rubric judge exists in both article- and paragraph-framed forms. | R4U1 |
| **Wire format / parser** | Per-line `dimension: A\|B\|TIE` markers parsed by a tolerant per-dimension regex (`parseRubricVerdict`), à la `parseVerdictFromReasoning`. One unparseable dimension → `null` for that dim only (E3). NOT provider JSON-schema. | R4U1 |
| **Position bias** | **2-pass A/B reversal retained** (reuse `run2PassReversal` + `flipWinner`); reconciled at the PASS level. **Stays 2 LLM calls/match**, not 2×N. | R4U2 |
| **Aggregation model** (simplified 2026-06-10) | **Per-pass weighted score → pass winner → top-level reversal.** Each pass (forward, flipped-reverse): `scoreA/B = Σ weight of dims that pass marked A/B`; **TIE & null dims contribute nothing**; `passWinner = higher score (TIE if equal & ≥1 parsed; null if nothing parsed)`. Overall = **existing `aggregateWinners` table reused verbatim** on `(forwardWinner, reverseWinner)` → `{winner, confidence}`. So **confidence = "did both passes pick the same overall winner"** (same 5-value scale + `<0.3→draw` gate as holistic). All-null → both passes null → TIE conf 0. Verified: A wins first two of (.30/.40/.30) → .70 → A, conf 1.0. | R4U2, R5U3 + 2026-06-10 simplification |
| **Weights home** | **C3 — reusable thin `evolution_judge_rubrics` entity** (TacticEntity-style) + junction `evolution_judge_rubric_dimensions(rubric_id, criteria_id FK→evolution_criteria, weight, position)`. Strategy references via `StrategyConfig.judgeRubricId`. | R2U4, R3U4 |
| **Weights validation** | **Normalize-on-read** in `getJudgeRubricForEvaluation` (robust to archived criteria); UI shows a live sum indicator as guidance. | R2U4, R3U4 |
| **Persistence** | **D1 — nullable JSONB `rubric_breakdown`** snapshot on `evolution_arena_comparisons` (comparative shape: `{rubricId, dimensions:[{criteriaId,name,weight,winner,confidence}], weightedScoreA/B, overallWinner, overallConfidence}`). Threaded `ComparisonResult.rubricBreakdown → V2Match → MergeRatingsAgent`. | R3U1, R4U4 |
| **Cache key** | Extend `makeKey` to hash rubric identity (`rubricId`+dims+weights) so rubric verdicts never collide with holistic or another rubric. | R5U3 |
| **Cost** | Unchanged estimator — 2 calls/match, `'ranking'` phase; larger prompt is absorbed by `COMPARISON_PROMPT_OVERHEAD` (negligible). | R4U4 |
| **Paragraph_recombine** | **Article-only** — strip the rubric in the per-slot config (`ParagraphRecombineAgent.ts:715`); per-slot keeps its specialized paragraph rubric. | R5U2 |
| **Kill switch** | `EVOLUTION_RUBRIC_JUDGING_ENABLED` (default `'true'`), short-circuit to holistic. | R5U2 |
| **Judge Lab** | **Deferred** to a follow-up; keep `settings_key`/`prompt_variant` seams open. | R5U1 |
| **Docs** | Extend `evolution/docs/rating_and_comparison.md` (no new deep dive). | (prior) |

## Criteria Entity Interaction — Recommendation (the core ask)

**Reusing `evolution_criteria` as judging dimensions is a CLEAN fit; do NOT build a parallel `judge_dimensions` entity.** The earlier worry (generation-scoped criteria metrics → "false zeros" for judging-only criteria) was **refuted by evidence (R3U3):**
- `computeCriteriaMetrics` already early-returns when a criterion has zero `criteria_set_used` generation references (`criteriaMetrics.ts:40-42`); judging never calls `computeCriteriaMetricsForRun`. So a judging-only criterion gets **no metric rows** — not false zeros.
- `EntityMetricsTab` renders a clean "No metrics recorded" empty state (`:174-179`); Variants/Runs tabs query `weakest_criteria_ids` and are naturally (correctly) empty.

**The clean reuse recipe:**
1. **Dimension source = `evolution_criteria` rows**, referenced by the rubric junction (FK `criteria_id` + `weight`). Honors the requirement ("pulled from existing criteria entity") and gives real referential integrity (archived/deleted criterion → normalize-on-read drops it).
2. **Judge prompt reuses `name` + `description`; reframes `evaluation_guidance` anchors as quality tiers** (excellent/adequate/weak, derived from each anchor's score position within `min..max`) and **drops the numeric scale** from the comparative prompt. So `min/max`/anchors are *reused* (not dead weight) — just reframed from absolute-scoring to comparative landmarks (R2U1).
3. **No criteria-entity changes required.** Optional nicety: a one-line note on the criteria detail page that metrics populate from generation only.
4. The **weighting + bundling lives in the new rubric entity**, layered *on top of* criteria — criteria stay the single source of dimension identity/semantics, shared by both generation and judging.

## Sub-Decisions — RESOLVED (2026-06-10 talk-through)
1. **Per-dimension TIE handling → SUPERSEDED (2026-06-10) by the simplified per-pass aggregation model.** Originally "split half-half"; the model was then simplified so aggregation happens at the PASS level (per-pass weighted score; TIE & null dims contribute nothing in a pass) and confidence = whether both passes agree on the overall winner. There is no longer a per-dimension reversal step, so the half-split question is moot. See the "Aggregation model" row above.
2. **All-unparseable fallback → TIE, CONFIDENCE 0.** Falls out naturally as the limit of the per-dim rule (all dims null → tie, conf 0 → `<0.3` draw gate); matches existing holistic `aggregateWinners(null,null)`. No extra LLM cost. A persistent total-failure rate is a "wrong judge model" signal, not something to paper over. *(holistic retry not chosen.)*
3. **Queryable `judge_rubric_id` column → ADD IT.** Nullable indexed `judge_rubric_id UUID` (FK → `evolution_judge_rubrics`) on `evolution_arena_comparisons`, populated in the SAME migration as `rubric_breakdown`. Enables a Match Viewer "filter by rubric" + deferred per-rubric analytics; avoids a second hot-table migration. *(JSONB-only not chosen.)*
4. **Rubric deletion vs. referencing strategies → RESTRICT WHILE REFERENCED.** Hard-delete is BLOCKED while any active strategy references the rubric (a `config->>'judgeRubricId'` count that throws with a clear message); user must detach first. (Diverges from the criteria soft-delete-and-degrade pattern by explicit choice — no silent behavior change.) **Archiving stays unrestricted** — it hides the rubric from new selection while existing strategies keep working; only hard-delete is gated. Runtime fallback-to-holistic remains as defense-in-depth. *(runtime-safe + soft-warning not chosen.)*
5. **Seed sample rubric(s) → YES, seed 1–2.** `seedSampleJudgeRubrics.ts` over the 7 seeded criteria (idempotent, editable): a "Balanced Quality" rubric + one weighted example (doubles as living documentation of weighting). *(no-seed not chosen.)*

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

### Relevant Docs (all standard + all evolution docs, per request)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/rating_and_comparison.md  ← core integration surface
- evolution/docs/criteria_agents.md  ← dimensions source (`evolution_criteria`)
- evolution/docs/arena.md  ← `evolution_arena_comparisons` persistence
- evolution/docs/metrics.md
- evolution/docs/evolution_metrics.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/entities.md
- evolution/docs/visualization.md  ← Match Viewer / match-history detail UI
- evolution/docs/reference.md
- evolution/docs/cost_optimization.md
- evolution/docs/editing_agents.md
- evolution/docs/prompt_editor.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/variant_lineage.md
- evolution/docs/logging.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- docs/feature_deep_dives/judge_evaluation.md  ← Judge Lab, `judgeRubrics.ts`

## Code Files Read (code-level research, verified file:line)

**Judging core:** `evolution/src/lib/shared/computeRatings.ts` (`compareWithBiasMitigation:562`, `buildComparisonPrompt:331`, `buildSandboxComparisonPrompt:407`, `parseWinner:464`, `parseVerdictFromReasoning:453`, `aggregateWinners:534`, `flipWinner:527`, `ComparisonResult:309`, `ComparisonMode:318`, `ComparisonCache.makeKey:211`) · `evolution/src/lib/shared/reversalComparison.ts` (`run2PassReversal`, `ReversalConfig`) · `evolution/src/lib/comparison.ts` · `evolution/src/lib/shared/judgeRubrics.ts` (`ARTICLE_SANDBOX_RUBRIC`, `PARAGRAPH_SANDBOX_RUBRIC`).

**Ranking + writers:** `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` (`:314` call, `buildMatch:194`, `:349` draw gate) · `evolution/src/lib/core/agents/SwissRankingAgent.ts:141` · `evolution/src/lib/core/agents/MergeRatingsAgent.ts` (`ArenaRowPayload:207`, INSERT `:289-318`) · `evolution/src/services/slotTopicActions.ts` (`persistSlotMatches:164`) · `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:715` (per-slot config).

**Types/schemas:** `evolution/src/lib/schemas.ts` (`strategyConfigBaseSchema:808`, `iterationConfigSchema`, `evolutionArenaComparisonInsertSchema:312` — **gap: missing 10 DB columns**, `v2MatchSchema:986`, `evolutionCriteriaInsertSchema:107`, `comparisonMode:974`) · `evolution/src/lib/pipeline/infra/types.ts` (`EvolutionConfig`, `V2Match`) · `src/lib/database.types.ts` (`evolution_arena_comparisons`).

**Criteria + strategy:** `evolution/src/services/criteriaActions.ts` (`getCriteriaForEvaluation:227`, `validateCriteriaIds:263`) · `evolution/src/lib/core/entities/CriteriaEntity.ts` · `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` (`buildEvaluateAndSuggestPrompt:92`) · `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` (`hashStrategyConfig:172`, `canonicalize:138`) · `evolution/src/lib/pipeline/setup/buildRunContext.ts:331-396` · `evolution/src/services/strategyRegistryActions.ts:154` (`createStrategyAction`) · `evolution/src/lib/metrics/computations/criteriaMetrics.ts:40` (early-return) · `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:174`.

**Entity registry ripple:** `evolution/src/lib/core/types.ts:14` (`CORE_ENTITY_TYPES`) · `evolution/src/lib/metrics/types.ts:13` (`ENTITY_TYPES`) · `evolution/src/lib/core/entityRegistry.ts` · `evolution/src/services/entityActions.ts:31` · `src/components/admin/EvolutionSidebar.tsx` · `evolution/scripts/seedSampleCriteria.ts` (seed precedent).

**Cost / Judge Lab / UI:** `evolution/src/lib/pipeline/infra/estimateCosts.ts:110-123` (`estimateRankingCost`, ×2 reversal) · `evolution/src/lib/judgeEval/{runJudgeEval.ts,settings.ts,executeSweep.ts,schemas.ts}` · `evolution/src/services/arenaActions.ts` (`getRecentMatchesAction`, `getComparisonDetailAction`, `rejudgeComparisonAction`) · `src/app/admin/evolution/matches/{page.tsx,[comparisonId]/page.tsx}` · `evolution/src/components/evolution/primitives/MetricGrid.tsx` (reuse) · `src/app/admin/evolution/strategies/new/{page.tsx,CriteriaMultiSelect.tsx}` (TacticGuidanceEditor weight pattern).

**Migrations:** `supabase/migrations/20260503033102_create_evolution_criteria.sql` (RLS/trigger template) · `20260331000001_evolution_parallel_pipeline_schema.sql` (arena_comparisons columns) · `scripts/lint-migrations-idempotent.ts` (guards).
