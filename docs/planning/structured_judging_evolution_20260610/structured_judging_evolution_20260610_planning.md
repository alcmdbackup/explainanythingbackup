# Structured Judging Evolution Plan

## Background

Today the evolution arena judge returns a single holistic A/B/TIE verdict per pairwise match. This project introduces **rubric-based match judging**: the judge model instead returns which piece is better for each of X named dimensions (sourced from the existing `evolution_criteria` entity, each passed with its optional description). The code combines the per-dimension winners against per-dimension weights to compute the overall match winner (e.g. conciseness .30 / structure .40 / style .30 → a variant winning the first two takes .70 of the points and wins). The structured output must work on cheap judge models frequently used for judging (Gemini 2.5 Flash Lite, DeepSeek, etc.), and the per-dimension breakdown must be browsable in the match-history detail view.

## Requirements (from GH Issue #1191)

- Rather than have judge model return which piece is better as a simple decision, have it return which is better for each of X dimensions. Dimensions can be pulled from existing criteria entity
- Each dimension along with optional description will be passed as prompt
- Output must be passed in a structured way, that works for Gemini 2.5 flash lite, Deepseek models, and other models that have been frequently used for judging
- Code should take structured output, then combine the dimensions along with a weighting to see which piece wins
- For example, if (conciseness: .30, structure : .40, style: .30), and article A wins the first 2, then it wins .70 of the overall points and wins the match
- We also want to have this information available to browse in detail in match history detail. It should show which variant won, and allow you to view the breakdown of how rubric-based match judging went

## Problem

The arena's pairwise judge collapses all quality dimensions into one A/B/TIE token, which (a) hides *why* one variant beat another, (b) makes the verdict sensitive to whichever dimension the model happens to weight, and (c) gives operators no lever to express that, e.g., structure matters more than style for a given prompt. A rubric-based judge that scores each dimension independently and combines them under explicit weights produces more interpretable, tunable, and auditable verdicts — but it must round-trip structured output reliably through the cheap models actually used for judging, persist the breakdown, and surface it for inspection.

## Options Considered

> Decisions locked during the 2026-06-10 talk-through (A, C3, D1, E3). Detail to be expanded during `/research` + brainstorm.

- [x] **Option A (CHOSEN): New rubric comparison mode threaded through the existing primitive.** Add a `comparisonMode: 'rubric'` (alongside `'article'`/`'paragraph'`) and a `buildRubricComparisonPrompt`, reusing `run2PassReversal` for bias mitigation with a per-dimension structured parse + weighted aggregate. Minimal new surface; inherits caching/reversal/cost paths. The risk that `parseWinner`/`aggregateWinners` are token-shaped is handled by branching to rubric-shaped parse/aggregate functions by mode (per E3), NOT by forking the pipeline. *(B not chosen.)*
- [ ] **Option B: Separate rubric judge service.** A standalone rubric-judge module that the ranking pipeline opts into per strategy, leaving the holistic path untouched. Cleaner isolation; more duplication of reversal/caching/cost. *(not chosen)*
- [x] **Option C: Where dimension weights live — DECIDED: C3 (reusable rubric-set entity).** (sub-decision, not mutually exclusive with A/B)
  - C1: per-strategy `judgeRubric` config (`{criteriaId, weight}[]`) on `StrategyConfig` — included in `config_hash`. Mirrors `criteriaIds` precedent. *(not chosen)*
  - C2: a new weight column on `evolution_criteria` (global default weights). Simpler but not per-strategy tunable. *(not chosen)*
  - **C3 (CHOSEN): a dedicated rubric-set entity.** A named `{criteria + weights}` bundle, DB-first like `evolution_criteria`/`evolution_prompts` (id, name, label, description, status, `deleted_at`, timestamps), with admin CRUD at `/admin/evolution/judge-rubrics` and a weight-builder UI (mirrors `CriteriaEntity` + `RubricEditor`). Reusable across strategies, the Judge Lab, and the Match Viewer re-judge sandbox. A strategy references it via a thin `StrategyConfig.judgeRubricId` pointer (config-hashed; validated like `criteriaIds`). **Resolved in /research:** (a) dimension membership = **junction table `evolution_judge_rubric_dimensions`** (real FK to `evolution_criteria`; NOT a JSONB array — gives referential integrity + queryability); (b) weights **normalize-on-read** (no sum-to-1 constraint), `weight ≥ 0`; (c) **min 1 dimension** enforced in Zod; (d) reuse `validateCriteriaIds` for member criteria.
- [x] **Option D: Persistence shape — DECIDED: D1 (JSONB snapshot column).** New nullable JSONB `rubric_breakdown` column on `evolution_arena_comparisons` (vs. a sibling `evolution_comparison_dimensions` table). The column **snapshots what was used at judge time** — `{ rubricId, dimensions: [{criteriaId, name, weight, winner, confidence}], weightedScoreA, weightedScoreB }` — so a later rubric edit can't rewrite history (mirrors how Judge Lab freezes test sets). Rides along the existing one-row-per-match write through `MergeRatingsAgent` + `sync_to_arena` (no extra inserts). Cross-match per-dimension analytics, if ever wanted, become a separable Judge-Lab-style rollup layer. *(D2 sibling table not chosen.)*
- [x] **Option E: Structured-output robustness — DECIDED: E3 (tolerant per-dimension parser is the contract).** Request the cleanest structured format each model supports (so strong models emit clean JSON), but verdict extraction depends on a **tolerant parser that degrades per-dimension**, NOT on provider JSON-schema enforcement. Load-bearing principle: **one malformed/missing dimension becomes a TIE/null for that dimension only — it never fails the whole match.** Reuse the generic `run2PassReversal` framework per dimension and reuse the `parseVerdictFromReasoning`/`parseWinner` tolerant-parsing lineage. Matches the codebase's existing judge philosophy ("ask simply, parse tolerantly") and is the approach trusted against the hard requirement that judging work on gemini-2.5-flash-lite + DeepSeek. *(E1 provider json_schema and E2 json_object-only not chosen — both lean on cheap-model structured-output reliability the codebase has repeatedly found unreliable, cf. PR #1184 + `project_openrouter_structured_output_gap`.)* **To resolve in /research:** exact wire format requested (single JSON object of `{dimension: 'A'|'B'|'TIE'}` vs. per-line markers) + the per-dimension confidence/aggregation rule under reversal.

## Phased Execution Plan

> Phase 1 (research + design lock-in) is COMPLETE — see the research doc's "Resolved Design Decisions" + "Criteria Entity Interaction — Recommendation". Phases 2–6 carry file:line-anchored deliverables.

### Phase 1: Research & design lock-in ✅ (2026-06-10, 5-round research)
- [x] Confirmed the seams in `compareWithBiasMitigation`/`buildComparisonPrompt`/`aggregateWinners`/`ComparisonCache`/`MergeRatingsAgent`/`buildRunContext`.
- [x] Locked Options A (rubric branch in primitive), **C3** (thin rubric entity + junction → criteria), **D1** (JSONB snapshot), **E3** (tolerant per-dim parser); Mode = **Design Y** (orthogonal overlay, no new enum value).
- [x] Defined the aggregation rule (per-pass weighted score → pass winner → top-level `aggregateWinners` reversal; TIE/null contribute nothing; confidence = passes-agree) + verified the .70 worked example. *(Simplified 2026-06-10 from an earlier per-dimension-reversal variant — see research "Aggregation model".)*
- [x] **Criteria interaction recommendation:** reuse `evolution_criteria` rows as dimensions (FK from junction); reuse `name`+`description`, reframe anchors as quality tiers; **zero criteria-entity changes** (false-zero worry refuted).

### Phase 2: Rubric-set entity + criteria reuse (data + admin)
- [ ] Migration `evolution_judge_rubrics` (thin: id, name UNIQUE, label, description, status, is_test_content+trigger, archived_at, deleted_at, timestamps) + `evolution_judge_rubric_dimensions` (`rubric_id` FK **ON DELETE CASCADE**, **`criteria_id` FK→evolution_criteria ON DELETE RESTRICT** — block hard-deleting a criterion still used by a rubric; criteria use soft-delete (`deleted_at`) so a *soft*-deleted criterion is filtered + dropped by normalize-on-read, not by the FK), weight `NUMERIC NOT NULL CHECK (weight >= 0)`, position INT, PK(rubric_id,criteria_id)) + indexes. **RLS — enable on BOTH new tables with exactly three policies each, identical to `evolution_criteria`:** `deny_all` (`FOR ALL USING (false) WITH CHECK (false)`), `service_role_all` (`FOR ALL TO service_role USING (true) WITH CHECK (true)`), and a conditional `readonly_select` (`FOR SELECT TO readonly_local`, guarded on the role existing) — plus `REVOKE ALL … FROM PUBLIC, anon, authenticated`. (Match Viewer/admin reads go through `adminAction` → service_role, so service_role_all suffices; readonly_local is debug-only.) **Idempotency (per `lint-migrations-idempotent.ts`):** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, each `CREATE POLICY` wrapped in a `DO $$ … END $$` existence guard, `DROP TRIGGER IF EXISTS` before the `is_test_content` trigger — copy the exact block from `20260503033102_create_evolution_criteria.sql`. Also passes `check-migration-order` + `check-migration-append-only`.
- [ ] Extend `evolution_metrics` entity_type CHECK to add `'judge_rubric'` (sibling migration, mirror `20260503033103`).
- [ ] Zod schemas (`schemas.ts`): `evolutionJudgeRubricInsertSchema` + a `dimensions` member schema with **weight validation** — `weight: z.number().min(0).refine(Number.isFinite)`, **≥1 dimension** (`.min(1)`), unique `criteria_id` per rubric; **weights are NOT required to sum to 1** (normalized at read time). + `JudgeRubricEntity` (TacticEntity-style, minimal tabs) + register in `CORE_ENTITY_TYPES` (`core/types.ts:14`), `ENTITY_TYPES` (`metrics/types.ts:13`), `entityRegistry.ts`, `entityActions` validation, `EvolutionSidebar.tsx` (Tools group).
- [ ] Server actions `judgeRubricActions.ts`: CRUD + `validateJudgeRubricId(id, db)` + `getJudgeRubricForEvaluation(db, id)`.
  - `validateJudgeRubricId` (called at strategy create/update): rubric exists, is active/not-deleted, AND has **≥1 active (non-archived) dimension** — so a strategy can't reference an empty rubric. Throws with a clear message otherwise.
  - `getJudgeRubricForEvaluation` (runtime): one-query PostgREST embed rubric→dimensions→criteria; **filter out soft-deleted/archived criteria, then normalize-on-read** weights over the survivors; returns **null** if the rubric is missing/deleted OR zero dims survive → caller falls back to holistic + WARN-logs.
  - **`deleteJudgeRubricAction` restricts while referenced** (decision 4): run the guarded count `SELECT count(*) FROM evolution_strategies WHERE status='active' AND config->>'judgeRubricId' = $1` and, if `> 0`, throw a clear error listing the count **BEFORE issuing any DELETE** — so the `dimensions` `ON DELETE CASCADE` only fires after the reference gate passes. Archive (`status='archived'`) is NOT gated. **On the count↔delete race:** the strategy→rubric link is a JSON config field (no DB FK to enforce), so this gate is a UX safeguard, not a hard constraint. A strategy created in the narrow window would reference a now-deleted rubric — which is **benign and self-healing**: at runtime `getJudgeRubricForEvaluation` returns null → holistic fallback + WARN (no integrity violation, since there is no constraint to violate). Wrap the count+DELETE in one transaction to shrink the window; full prevention isn't warranted given the graceful fallback.
  - `position INT` on the junction is **display-order only** (auto-assigned on insert, reorderable in the builder); it does not affect weights or scoring (scoring keys on dimension name).
- [ ] Admin page `/admin/evolution/judge-rubrics` + `JudgeRubricBuilder` (compose `CriteriaMultiSelect` + a weights editor with live-sum indicator, à la `TacticGuidanceEditor`).
- [ ] `seedSampleJudgeRubrics.ts` (over the 7 seeded criteria, idempotent) — a "Balanced Quality" rubric + one weighted example (decision 5).
- [ ] **Criteria entity: no structural change.** Optional one-line note on the criteria detail page that metrics come from generation runs only.

### Phase 3: Strategy wiring + rubric resolution
- [ ] Add `judgeRubricId?: z.string().uuid()` to `strategyConfigBaseSchema` (next to `judgeModel`, `schemas.ts:810`) + `createStrategySchema`; auto-hashed by v2 `canonicalize` (no FIELD_GATES).
- [ ] `validateJudgeRubricId` in `createStrategyAction` AND `updateStrategyAction` (next to `validateCriteriaIds`).
- [ ] Strategy wizard Step 1: rubric picker (optional; null → holistic).
- [ ] `buildRunContext.ts:380` — async-resolve `judgeRubricId` → `judgeRubric` onto `EvolutionConfig` (skipped when the kill switch is off → stays undefined). Add `judgeRubricId?: string` + `judgeRubric?: ResolvedJudgeRubric` to the `EvolutionConfig` type, where **`ResolvedJudgeRubric` = `{ rubricId: string; dimensions: Array<{ criteriaId: string; name: string; description: string|null; minRating: number; maxRating: number; evaluationGuidance: EvaluationGuidance|null; weight: number /* normalized */ }> }`** (this is exactly `getJudgeRubricForEvaluation`'s return; it embeds the criteria fields at resolution time so the prompt builder reframes anchors from in-memory data with **no fresh query at judge time**).

### Phase 4: Rubric judging core (the substance)
- [ ] Extend `buildComparisonPrompt` with a **NEW optional `rubricContext` param** (distinct from the existing sandbox-only `customPromptOverride`): when present it emits the per-dimension rubric prompt using the existing article/paragraph framing (Design Y), per-dimension `name`+`description`+**tiered-reframed anchors**, + per-line verdict instruction. **The anchor→quality-tier reframing (excellent/adequate/weak from anchor score position within min..max) lives ENTIRELY in this new rubric prompt builder** — `evolution_criteria`, `CriteriaEntity`, and the generation-side `buildEvaluateAndSuggestPrompt` are untouched (that's what "zero criteria-entity changes" means).
- [ ] `parseRubricVerdict(response, dimensionNames) → Record<name, 'A'|'B'|'TIE'|null>` — tolerant per-line regex (E3; one bad dim → null).
- [ ] **Per-pass scoring + top-level reversal (simplified model, supersedes sub-decision 1).** Retain `run2PassReversal` (forward + flipped-reverse, **2 LLM calls/match**) but aggregate at the PASS level, not per dimension:
  - **Per pass** (in the real frame; reverse flipped via `flipWinner`): `scoreA = Σ weight of dims that pass marked A`, `scoreB = Σ weight of dims marked B`. **TIE and null dims contribute to neither side.** `passWinner = A if scoreA>scoreB, B if scoreB>scoreA, TIE if equal (≥1 dim parsed), null only if the pass parsed nothing`.
  - **Overall** = the **existing `aggregateWinners` table reused verbatim** on `(forwardWinner, reverseWinner)` → `{winner, confidence}`: agree→1.0, one-TIE→0.7, disagree→TIE 0.5, one-null→0.3, both-null→TIE 0.0. So **confidence = "did both passes pick the same overall winner"** (same 5-value scale as holistic; identical `<0.3→draw` gate). All-unparseable → both passes `null` → TIE conf 0 (decision 2 preserved via the "null only if nothing parsed" rule).
  - **`rubricBreakdown` locked JSON shape** (persisted in the `rubric_breakdown` column; also the in-memory `ComparisonResult.rubricBreakdown`): `{ rubricId: string, dimensions: Array<{ criteriaId, name, weight /* normalized */, forwardVerdict: 'A'|'B'|'TIE'|null, reverseVerdict: 'A'|'B'|'TIE'|null /* flipped to real frame */ }>, forwardPass: { scoreA, scoreB, winner }, reversePass: { scoreA, scoreB, winner }, overall: { winner: 'A'|'B'|'TIE', confidence } }`.
- [ ] **Thread the resolved rubric to BOTH judge call sites** (the config is already in scope at each):
  - `rankSingleVariant.ts:314` reads `config.*` already → pass `config.judgeRubric` as `rubricContext`.
  - `SwissRankingAgent.ts:141` — the agent already reads `ctx.config` (uses `ctx.config.judgeModel` at ~:128), so pass `ctx.config.judgeRubric` as the new `rubricContext` arg at the `:141` call (it passes no rubric/`comparisonMode` today — add the arg).
  - **All downstream branching keys on the presence of the resolved `judgeRubric` OBJECT, never on `judgeRubricId`** — so the kill switch (which leaves `judgeRubric` undefined) cleanly reverts everything with no stray `judgeRubricId` checks.
  - Sandbox (`rejudgeComparisonAction`) opt-in only; `runJudgeEval` left holistic (Judge Lab deferred).
- [ ] Branch in `compareWithBiasMitigation` (or a sibling) ONLY when a resolved rubric is passed — **no-rubric path byte-identical** (existing callers that pass no `rubricContext` hit the unchanged holistic path; existing tests must stay green).
- [ ] **Kill switch `EVOLUTION_RUBRIC_JUDGING_ENABLED`** (default `'true'`, contract `process.env.X !== 'false'`, mirrors `EVOLUTION_*_ENABLED`): short-circuit at the **rubric-resolution point in `buildRunContext`** — when `'false'`, skip resolution so `EvolutionConfig.judgeRubric` stays undefined and every judge call takes the holistic path (one flip → holistic, no per-call branching needed downstream).
- [ ] **Observability:** log at WARN when a rubric fails to resolve (missing/deleted/all-dims-archived → holistic fallback) and at DEBUG which `rubricId` judged a run; per-call parse failures (a pass returns `null`) increment a counter so a persistently-failing judge model is visible (complements `decisive_rate`). Use the existing `EntityLogger`.
- [ ] Extend `ComparisonCache.makeKey` to hash rubric identity (`rubricId` + ordered dims + weights) so rubric verdicts never collide with holistic or with a different rubric on the same text pair.
- [ ] **Article-only:** strip the rubric in `ParagraphRecombineAgent.ts:715` per-slot config via destructure-omit — `const { judgeRubric: _drop, ...perSlotConfig } = ctx.config;` then add the `comparisonMode:'paragraph'` override — so per-slot ranking keeps its specialized paragraph rubric and never sees the article rubric.

### Phase 5: Persistence + Match-history detail UI
- [ ] Migration (`ALTER … ADD COLUMN IF NOT EXISTS`): nullable JSONB `rubric_breakdown` + nullable indexed `judge_rubric_id UUID` (decision 3) on `evolution_arena_comparisons`, **FK → `evolution_judge_rubrics(id) ON DELETE SET NULL`** (history is immutable; rubric hard-delete is already strategy-gated). The **JSONB snapshot (including its `rubricId`) is authoritative for rendering**; `judge_rubric_id` exists only for indexed filtering, so it becoming NULL after a later rubric hard-delete is purely cosmetic and never affects the breakdown display. Same migration.
- [ ] **Schema/types:** add `rubric_breakdown` + `judge_rubric_id` to `evolutionArenaComparisonInsertSchema` + `…FullDbSchema` (`schemas.ts:312`) as `.nullable().optional()`; while there, the pre-existing 10-column gap (iteration/invocation_id/mu·sigma) is acknowledged but **out of scope** — do NOT silently widen it; only add the two rubric columns + a code comment noting MergeRatingsAgent still inserts the untyped columns via the raw client. Regen `src/lib/database.types.ts` (`npm run db:types`; CI `generate-types` auto-commits).
- [ ] Thread `ComparisonResult.rubricBreakdown → buildMatch → V2Match.rubricBreakdown → MergeRatingsAgent` arenaRows (+ null-safe in `persistSlotMatches`).
- [ ] `getComparisonDetailAction` returns `rubric_breakdown`; `getRecentMatchesAction` adds a rubric indicator + a **filter-by-rubric** control (uses the new `judge_rubric_id` column); null-safe for old matches.
- [ ] **Match detail breakdown — full two-pass always (UI decision 2026-06-10).** Reuse `MetricGrid`-style table: one row per dimension showing `weight`, `forwardVerdict`, `reverseVerdict (flipped)`; below it the per-pass `scoreA/scoreB` + each `passWinner`; and a header with the overall winner + confidence + rubric name (linked to the rubric entity). Always render both passes (no collapse). Null `rubric_breakdown` → section omitted (holistic match unchanged).
- [ ] Match list: rubric column. Variant detail "Matches" tab already deep-links to this detail page (`getVariantMatchHistoryAction`) — no change beyond the breakdown rendering. Optional: re-judge sandbox rubric mode (display-only).

### Phase 6: Rollout
- [ ] Kill switch wired + documented (mirrors `EVOLUTION_*_ENABLED` convention).
- [ ] Docs: `rating_and_comparison.md` "Rubric Judging" section (+ `criteria_agents.md`, `arena.md`, `data_model.md`, `visualization.md`, `strategies_and_experiments.md`).
- [ ] Judge Lab integration explicitly **deferred** — leave `settings_key`/`prompt_variant` seams open (note in `judge_evaluation.md`).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/<rubric judge>.test.ts` — per-pass weighted scoring + top-level reversal. Explicit cases: the .30/.40/.30 worked example (A wins first two → score .70/.30 → A, conf 1.0); **within-pass score tie** (.30/.40/.30 with A=A, B=B, C=TIE → scoreA .30 / scoreB .40 → that pass's winner = B; and a true even split → `passWinner=TIE`); TIE/null dims contribute nothing to a pass score; **divergent parse sets** (forward parses {A,B,C}, reverse parses only {A,B}) → each pass scores independently on what it parsed, then pass-winners reconcile; all-null both passes → TIE conf 0 → draw; the `<0.3` gate (one pass null → 0.3 → still decisive; both disagree → 0.5 but TIE → draw).
- [ ] `parseRubricVerdict` tolerant-parser tests (per-line `dimension: A|B|TIE` markers — NOT JSON). Concrete cases each asserting the per-dimension result: clean markers; reasoning-preamble then markers; a dimension line missing → that dim `null` (others survive); a misspelled/unknown dimension name → ignored; a line with both A and B mentioned → `null` for that dim; markdown-wrapped (`**clarity**: A`); a dimension name containing `_`/`-` (regex-safe per the criteria name regex); ALL lines missing → every dim `null`.
- [ ] `buildComparisonPrompt(rubricContext)` snapshot/contract tests — each dimension's name + description + tiered-reframed anchors injected; per-line verdict instruction present; article vs paragraph framing both covered; no-`rubricContext` output byte-identical to today.
- [ ] Cache-key test — explicit: holistic verdict and a rubric verdict on the SAME text pair produce DIFFERENT keys; two DIFFERENT rubrics on the same pair produce different keys; the same rubric on the same pair hits the cache.
- [ ] Kill-switch + fallback test — `EVOLUTION_RUBRIC_JUDGING_ENABLED='false'` → `buildRunContext` leaves `judgeRubric` undefined → judge calls take the holistic path → result byte-identical to no-rubric. Also: a rubric that resolves to null (all dims archived) → holistic fallback + WARN.
- [ ] **2-pass reversal test (pass-level)** — reverse pass flipped to the real frame; overall winner+confidence from `aggregateWinners(forwardWinner, reverseWinner)` (agree→1.0, one-TIE→0.7, disagree→TIE 0.5, one-null→0.3, both-null→0.0); a position-biased model that always favors the first-shown text nets out to TIE on a quality-equivalent pair; assert exactly 2 LLM calls regardless of dimension count.
- [ ] **Weight handling** — `getJudgeRubricForEvaluation` normalize-on-read (raw weights 30/40/30 → .30/.40/.30; un-normalized 2/3/2 → correct fractions); soft-deleted/archived criterion dropped then survivors renormalize; all-dims-archived → null. Zod: weight ≥ 0, ≥1 dimension, unique criteria_id.
- [ ] **Regression guard (load-bearing for backward compat):** adding optional `rubricBreakdown` to `ComparisonResult`/`V2Match` + the two nullable arena columns MUST NOT change the no-rubric path. Audit + (if needed) update existing exact-shape/`toEqual`/snapshot assertions in `computeRatings*.test.ts`, `MergeRatingsAgent.test.ts`, and arena tests; add an explicit "no-rubric result is byte-identical to pre-change" assertion. Parse-failure observability: a both-null pass increments the failure counter (assert it fires).

### Integration Tests
- [ ] `src/__tests__/integration/<rubric-judging>.integration.test.ts` — a rubric-judged match persists its per-dimension breakdown + `judge_rubric_id` to `evolution_arena_comparisons` and reads back via `getComparisonDetailAction`; `[TEST_EVO]`-prefixed rubric/criteria with `afterAll` cleanup (per `require-test-cleanup`).
- [ ] **Criteria soft-delete round-trip** — build a rubric over N criteria, archive/soft-delete one, then `getJudgeRubricForEvaluation` drops it and renormalizes the survivors' weights; archiving the last remaining → returns null (holistic fallback). Confirms the FK `ON DELETE RESTRICT` blocks a *hard* delete of a referenced criterion.
- [ ] **Migration verification:** `npm run migration:verify` (ephemeral Docker postgres) covers the 2 new tables + the `evolution_arena_comparisons` ALTER + the `evolution_metrics` CHECK extension; idempotency lint (`npm run lint:migrations`) passes. Seed-script idempotency: `seedSampleJudgeRubrics.ts` is safe to re-run (`ON CONFLICT DO NOTHING`).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/<match-rubric-breakdown>.spec.ts` (`@evolution`) — Match Viewer detail renders the full two-pass per-dimension breakdown + overall weighted winner for a seeded rubric-judged comparison; an old/holistic match (null breakdown) renders with no breakdown section. `[TEST_EVO]` data + `afterAll` cleanup.
- [ ] `src/__tests__/e2e/specs/09-admin/<judge-rubrics-admin>.spec.ts` (`@evolution`) — judge-rubrics list/create (builder picks criteria + sets weights), and the match-list **filter-by-rubric**. **Both new admin list pages need a `resetFilters()` POM** called immediately after navigation (Testing Rule 1 / ESLint `flakiness/require-reset-filters`), since "Hide test content" defaults on.

### Manual Verification
- [ ] Run a small staging evolution run with a rubric-judging strategy; confirm matches carry breakdowns and the detail page renders them.
- [ ] Spot-check structured output on gemini-2.5-flash-lite + a DeepSeek model.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Match Viewer detail breakdown spec on local server (via `ensure-server.sh`), `@evolution`.

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "rubric"` (aggregation + parser + prompt + cache + weights + regression guard).
- [ ] `npm run lint:migrations` + `npm run migration:verify` (new tables + ALTER + CHECK).
- [ ] `npm run test:integration` (rubric persistence round-trip).
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/<match-rubric-breakdown>.spec.ts`.

### C) Rollback plan
- [ ] **Primary lever — kill switch:** `EVOLUTION_RUBRIC_JUDGING_ENABLED='false'` on the runner instantly reverts ALL runs to holistic judging (resolution skipped in `buildRunContext`); no redeploy, no data change. Existing `judgeRubricId` on strategies is simply ignored while off.
- [ ] **Backward compatibility:** the migration is purely additive (2 new tables + 2 nullable columns); no existing row changes. Pre-rubric matches (`rubric_breakdown`/`judge_rubric_id` NULL) render exactly as today. The no-rubric judging path is byte-identical (regression-guarded). Forward-only migration; no down-migration needed.
- [ ] **Code revert:** because the holistic path is untouched and rubric code only activates when a resolved rubric is present, reverting the feature PR leaves the additive columns harmless (NULL) — no cleanup required.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/rating_and_comparison.md` — **home for rubric judging** (decided 2026-06-10): a major new "Rubric Judging" section covering the `comparisonMode: 'rubric'` branch, retained per-dimension 2-pass reversal, tolerant per-dimension parser (E3), weighted aggregation, cache-key change, and the rubric-set entity (C3) + persistence (D1) + Match Viewer UI cross-links. No new standalone deep-dive doc and no new `.claude/doc-mapping.json` entry.
- [ ] `evolution/docs/criteria_agents.md` — criteria entity now also sources judging dimensions (+ weights, if stored there).
- [ ] `evolution/docs/arena.md` — `evolution_arena_comparisons` breakdown persistence + `sync_to_arena` change.
- [ ] `evolution/docs/data_model.md` — schema change (breakdown column/table); regenerated types.
- [ ] `evolution/docs/visualization.md` — Match Viewer detail per-dimension breakdown UI.
- [ ] `evolution/docs/metrics.md` — any decisive-rate / confidence-semantics impact from the rubric path.
- [ ] `evolution/docs/strategies_and_experiments.md` — strategy-level rubric-judging config + weights.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — Judge Lab interaction with rubric judging (if surfaced there).

## Review & Discussion

### /plan-review loop — CONSENSUS REACHED (2026-06-10, 4 iterations)

Final: **Security 5/5 · Architecture 5/5 · Testing 5/5** (all reviewers, no remaining critical or minor gaps).

| Iter | Security | Architecture | Testing | Key gaps fixed this iteration |
|---|---|---|---|---|
| 1 | 2 | 2 | 2 | Triaged out "code-not-written-yet" false-negatives. Fixed genuine gaps: junction FK `ON DELETE` (criteria_id RESTRICT, rubric_id CASCADE, arena judge_rubric_id SET NULL); weight Zod (≥0, ≥1 dim, normalize-on-read); observability/logging; regression guard; Rollback subsection; kill-switch location; insertSchema scope; delete-gate hardening; migration idempotency guards. |
| 2 | 3 | 4 | 3 | Locked membership = **junction table** (not JSONB); hard-delete gate runs **before** CASCADE; locked `ResolvedJudgeRubric` + `rubricContext` + `rubric_breakdown` JSON shapes; SwissRankingAgent propagation; parser = per-line markers (not JSON); concrete tests (within-pass tie, divergent parse, cache collision, kill-switch, criteria-archival round-trip, reset-filters). |
| 3 | 3 | 4 | **5** | Explicit RLS (3 policies × 2 tables + REVOKE, DO-block guards); delete-gate race clarified as benign + self-healing (JSON link, runtime fallback, txn); `SwissRankingAgent` reads `ctx.config` → passes `ctx.config.judgeRubric`; branch on resolved OBJECT not `judgeRubricId`; ParagraphRecombine destructure-omit; FK-NULL cosmetic / JSONB authoritative. |
| 4 | **5** | **5** | 5* | Both re-reviewed perspectives returned empty critical_gaps + empty minor_issues. (*Testing 5/5 carried from iter 3 — unaffected by iter-3 security/integration edits.) |

**Process note:** ~70% of iteration-1 "critical gaps" were the reviewers conflating *pre-implementation* (code/migrations/fields not yet written — i.e. the planned deliverables) with *plan incompleteness*. Those were not fixed (they're the work the plan describes); only genuine specification gaps and unaddressed risks were addressed. Reviewers were re-framed from iteration 2 onward to judge plan adequacy, not implementation completeness.
