# Judge Escalation — Production Wiring (Phase 4) Plan

Continuation of `docs/planning/groups_of_judges_make_up_indecisiveness_evolution_20260611/` (Phase 4 of that plan). Phases 1-3 merged (#1213, #1215, #1216). This branch implements Phase 4 — wiring the existing judge-ensemble (escalation + criteria_split) into the **production** evolution ranking path, **gated, default OFF** (`EVOLUTION_JUDGE_ESCALATION_ENABLED='false'`), byte-identical to today when the kill switch is off.

## Background
The acceptance gate (decisiveness uplift / accuracy guardrail / lone-decisive safety / cost-per-decisive) was not re-measured on a widened corpus; per the user's "assume everything works, go to the end" directive this PR ships the plumbing **default OFF** so production Elo is unchanged. The live enable (flipping the env var in prod) remains a deliberate ops action.

## Phased Execution Plan

### Phase 4: Production wiring (gated, default OFF)
- [x] `ensembleRunner?` seam on `compareWithBiasMitigation` — byte-identical single-`callLLM` path when unset; dispatches the multi-model chain when set. `ComparisonResult.submatches`. Cache key + `chainConfigId/ruleVersion`; clone submatch members on a cache hit.
- [x] Migration (idempotent, additive): `evolution_arena_submatches` + `evolution_submatch_dimension_verdicts` (FK CASCADE, deny-all RLS + service_role_all) + parent summary cols (`chain_depth`, `agreement`, `aggregation_rule`, `aggregation_rule_version`) on `evolution_arena_comparisons`. Hand-add to `database.types.ts` (CI regenerates).
- [x] `v2MatchSchema.submatches` + strategy-config `ensembleConfigId`; carry submatches onto the match at both compute sites (`SwissRankingAgent`, `rankSingleVariant` `buildMatch`); client-generate comparison `id`.
- [x] Persist submatch + dimension rows at both persistence sites (`MergeRatingsAgent`, `slotTopicActions`); keep dual-writing `rubric_breakdown` JSONB as a read-cache.
- [x] `buildRunContext`: resolve `ensembleConfigId` + `EVOLUTION_JUDGE_ESCALATION_ENABLED` kill switch (default OFF) → `ensembleRunner` on `EvolutionConfig`. Rating path live default `first_decisive`.
- [x] Match-viewer UX: escalation badge (list) + per-submatch rubric tables (detail) + legacy chain-of-1 renders unchanged.

## Verification

### A) Playwright Verification
- [ ] Match Viewer renders an escalation match (submatch tables) + a legacy single-judge match unchanged (`@evolution`).

### B) Automated Tests
- [ ] `npm run test` (unit, incl. computeRatings ensembleRunner byte-identical-when-unset + persistence mapping) + evolution integration specs.
