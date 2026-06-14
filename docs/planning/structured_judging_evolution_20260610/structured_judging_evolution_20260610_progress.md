# Structured Judging Evolution Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/structured_judging_evolution_20260610` off `origin/main`.
- Read all 7 core workflow/ops docs + all 20 evolution docs + the `judge_evaluation.md` feature deep dive (per request: "all standard + all evolution docs").
- Authored research + planning skeletons; identified the judging integration surface (`compareWithBiasMitigation` / `buildComparisonPrompt` / `aggregateWinners` / `run2PassReversal` / `ComparisonCache`), the dimensions source (`evolution_criteria`), persistence (`evolution_arena_comparisons` + `sync_to_arena`), and the match-history detail UI (Match Viewer).

### Issues Encountered
- None yet.

### User Clarifications
- Project type: feature (`feat/` branch).
- Docs to read: all standard + all evolution docs (honored).
- Open questions deferred to `/research` + `/plan-review`: where per-dimension weights live (the `evolution_criteria` entity does NOT currently store weights), persistence shape (JSONB column vs. sibling table), and whether a new `rubric_judging.md` deep dive is warranted.

## Phase 1: Research & design lock-in ✅ (2026-06-10)
### Work Done
- Ran 5 rounds × 4 parallel Explore agents (20 units) grounding the whole design at file:line. Findings + locked decisions in the research doc ("Code-Level Findings", "Resolved Design Decisions", "Criteria Entity Interaction — Recommendation").
- Locked: A (rubric branch in primitive), C3 (thin `evolution_judge_rubrics` entity + junction → `evolution_criteria`), D1 (JSONB snapshot), E3 (tolerant per-dim parser), Mode = Design Y (orthogonal overlay), 2-pass reversal per dimension (2 calls/match), weighted-mean confidence, strategy-level `judgeRubricId`, kill switch, article-only (no per-slot rubric), Judge Lab deferred.
- Planning doc Phases 2–6 now carry file-anchored deliverables.

### Issues Encountered
- Cross-agent inconsistencies reconciled: (1) breakdown JSONB is COMPARATIVE (winner-per-dim), not absolute scores; (2) `evolution_judge_rubric_dimensions` REFERENCES `evolution_criteria` by FK (not a self-contained dimension table) — honoring "dimensions pulled from existing criteria"; (3) confidence = weight-weighted mean (not min).
- One early agent (R2U3) recommended a separate `judge_dimensions` entity over criteria reuse; refuted by R3U3 evidence (criteria metrics already early-return; no false-zero pollution) → criteria reuse confirmed clean.

### User Clarifications
- User asked specifically to verify the criteria-entity interaction → delivered a concrete recommendation: reuse criteria rows as dimensions, reframe anchors as quality tiers, zero criteria-entity changes; weighting lives in the new rubric entity layered on top.
- 5 sub-decisions resolved in talk-through: (1) per-dim TIE → SUPERSEDED by the simplified model below; (2) all-unparseable → TIE conf 0; (3) add queryable `judge_rubric_id` column; (4) restrict rubric delete while referenced; (5) seed 1–2 sample rubrics.
- **Aggregation simplified (user request):** moved from per-dimension reversal to a **per-pass weighted score → pass winner → top-level `aggregateWinners` reversal** model. Each pass: TIE/null dims contribute nothing; pass winner = higher weighted score. Confidence = whether both passes agree on the overall winner (reuses the holistic 5-value table verbatim — less new code, same Elo-gate calibration). Supersedes sub-decision 1; preserves all-unparseable→draw via the "pass null only if nothing parsed" rule.

## Execution (2026-06-10) — status by plan phase

**DONE + verified (committed; typecheck + eslint + unit tests + migration-idempotency-lint all green locally):**
- **Phase 2 data layer** — 3 migrations: `20260610000002_evolution_judge_rubrics.sql` (rubrics + dimensions junction, FKs: criteria_id RESTRICT / rubric_id CASCADE, RLS 3-policies×2 tables, is_test_content trigger), `…0003_extend_metrics_entity_type_for_judge_rubric.sql`, `…0004_arena_comparisons_rubric_breakdown.sql` (rubric_breakdown JSONB + judge_rubric_id FK SET NULL + index). Idempotency lint ✓. (migration:verify deferred — Docker daemon not running locally; CI will run it.)
- **Phase 4 judging core** — `evolution/src/lib/shared/rubricJudge.ts`: `parseRubricVerdict` (tolerant per-line markers), `scorePass`, `reconcilePasses`, `aggregateRubric`, `normalizeDimensions`, `buildRubricComparisonPrompt` (anchor→tier reframing). **35 unit tests pass** (the .70 example, position-bias→TIE, all-null→draw, divergent parse, within-pass tie, parser edge cases, the 5-value table).
- **Schemas** — `schemas.ts`: judge-rubric entity Zod (insert + row + dimension input, ≥1 dim + unique-criteria refine), arena `rubric_breakdown`/`judge_rubric_id` columns, `StrategyConfig.judgeRubricId` (auto-hashed).
- **Server actions** — `evolution/src/services/judgeRubricActions.ts`: `getJudgeRubricForEvaluation` (one-query embed, filter archived criteria, normalize-on-read, null-on-empty), `validateJudgeRubricId` (≥1 active dim), CRUD incl. `deleteJudgeRubricAction` (referenced-strategy gate) + `archiveJudgeRubricAction`.

**ALSO DONE + verified (typecheck + 3189 evolution unit tests + `next lint` all green):**
- **Phase 2 finish** — `JudgeRubricEntity` (thin) + full entity-type ripple (`CORE_ENTITY_TYPES`, `ENTITY_TYPES`, `METRIC_REGISTRY`, `entityRegistry`; `entityActions` validates via `CORE_ENTITY_TYPES`); admin `/admin/evolution/judge-rubrics` page + criteria/weights builder; `EvolutionSidebar` nav entry; `seedSampleJudgeRubrics.ts` (Balanced + Structure-Weighted).
- **Phase 3** — `buildRunContext` async-resolves `judgeRubricId`→`judgeRubric` onto `EvolutionConfig` (+ kill switch); `EvolutionConfig`/`StrategyConfig`/`V2Match`/`ComparisonResult` carry the new fields (`z.custom` for nested types); `validateJudgeRubricId` in `createStrategyAction`; strategy wizard rubric picker (Step 1).
- **Phase 4 finish** — `compareWithBiasMitigation` rubric branch (reuses `run2PassReversal` + `aggregateRubric`); threaded through `rankSingleVariant` + `SwissRankingAgent` (article-level); cache key suffixed with rubric id; kill switch; `ParagraphRecombineAgent` strips the rubric (article-only). **No-rubric path byte-identical** (996 shared+pipeline tests still pass).
- **Phase 5** — `ComparisonResult.rubricBreakdown`→`buildMatch`/`V2Match`→`MergeRatingsAgent` (oriented to entry_a/entry_b via `orientBreakdownToEntries`) + `persistSlotMatches` null-safe; `getComparisonDetailAction`/`getRecentMatchesAction` return breakdown + add filter-by-rubric; Match Viewer detail two-pass breakdown table + list indicator.
- **Phase 6** — docs in `rating_and_comparison.md` (+ `data_model.md` pointer); integration test `evolution-judge-rubric.integration.test.ts` (resolver normalize / archive-drop / null fallback / validate). 73 rubric-core + orientation unit tests.

**Genuinely remaining (minor / CI-validated):**
- E2E specs (judge-rubrics admin CRUD + match breakdown render) — backend + unit + integration cover the logic; E2E is browser-only.
- `migration:verify` (Docker not running locally) + `db:types` regen — both run in CI.
- Light doc pointers (`arena.md`, `visualization.md`, `strategies_and_experiments.md`) — the authoritative section is in `rating_and_comparison.md`.

### Issues Encountered
- Migration timestamp collision: origin/main advanced to `20260610000001` (unrelated judge_eval migration) after branch; renamed mine to 0002–0004.
- Idempotency lint requires `DROP POLICY IF EXISTS` before `CREATE POLICY` (the criteria template's DO-block guards are grandfathered) → switched to DROP-then-CREATE.
- New tables aren't in generated `database.types.ts` yet (regenerated by CI `db:types`), so the typed Supabase client returns error types for them → result casts route through `unknown`; harmless once types regenerate.
