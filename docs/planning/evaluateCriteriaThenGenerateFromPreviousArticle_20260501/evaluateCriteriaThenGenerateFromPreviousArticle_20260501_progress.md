# evaluateCriteriaThenGenerateFromPreviousArticle Progress

## Phase 1: Criteria Entity Scaffolding

### Phase 1A — Migrations ✅
- 20260502120000_create_evolution_criteria.sql — table + RLS + name regex CHECK + max>min CHECK + rubric-anchors-in-range CHECK + per-table is_test_content trigger.
- 20260502120001_extend_metrics_entity_type_for_criteria.sql — adds 'criteria' to evolution_metrics CHECK constraint.
- 20260502120002_evolution_variants_criteria_columns.sql — adds criteria_set_used + weakest_criteria_ids UUID[] columns + GIN indexes.
- 20260502120003_extend_mark_elo_metrics_stale_for_criteria.sql — extends stale-trigger to cascade entity_type='criteria' on weakest_criteria_ids match.

### Phase 1C — Zod schemas ✅
- Added `criteriaStatusEnum`, `evaluationGuidanceAnchorSchema`, `evaluationGuidanceSchema`.
- Added `evolutionCriteriaInsertSchema` with cross-field refinements (max>min, anchor in range).
- Added `evolutionCriteriaFullDbSchema` + `EvolutionCriteriaInsert`/`EvolutionCriteriaFullDb` types.
- Extended `variantSchema` with `criteriaSetUsed` + `weakestCriteriaIds` (in-memory) and `evolutionVariantInsertSchema` with `criteria_set_used` + `weakest_criteria_ids` (DB shape).

### Phase 1D — Variant type + factory + CORE_ENTITY_TYPES ✅
- `Variant` type alias (Zod-derived) auto-picks up new fields from `variantSchema`.
- `createVariant()` factory extended with optional `criteriaSetUsed` + `weakestCriteriaIds` params.
- `CORE_ENTITY_TYPES` (in `core/types.ts`) + `ENTITY_TYPES` (in `metrics/types.ts`) both extended with `'criteria'`.

### Phase 1E — Entity class ✅
- `evolution/src/lib/core/entities/CriteriaEntity.ts` created mirroring `PromptEntity` (createConfig + editConfig + listColumns + listFilters + actions=rename/edit/delete + 5 detailTabs + insertSchema).
- Registered in `entityRegistry.ts` `initRegistry()` as `criteria: new CriteriaEntity()`.
- Added `'rubric'` field type to `FieldDef.type` union for the upcoming RubricEditor (Phase 1H).

### Phase 1G — Metric registration (partial) ✅ partial
- `METRIC_REGISTRY['criteria']` added with 5 metrics (avg_score, frequency_as_weakest, total_variants_focused, avg_elo_delta_when_focused, run_count); all `listView: true`.
- `CriteriaEntity.metrics` mirrors flat registry per dual-registry parity convention.
- `STATIC_METRIC_NAMES` extended with the 4 new criteria-specific names (run_count already present).
- ⚠ Remaining for Phase 1G: `computeCriteriaMetricsForRun` SQL aggregator function (`evolution/src/lib/metrics/computations/criteriaMetrics.ts`) + wiring into `persistRunResults.ts` finalize path.

### Verification
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (warnings pre-existing in unrelated files; no new lint errors).

### Issues Encountered
- TypeScript discovered TWO `EntityType` definitions (`core/types.ts` and `metrics/types.ts`) — both needed extension to `'criteria'`.
- `FinalizationMetricDef` shape differs between `core/types.ts` (requires `timing` + `description`) and `metrics/types.ts` (no `timing`, optional `description`). `CriteriaEntity` uses the core shape (with timing); `METRIC_REGISTRY` uses the metrics shape (without timing) — different shapes, intentional, per existing convention.

### Phase 1 Pending Sub-Phases
- **Phase 1B columns migration**: ✅ landed as part of Phase 1A migration #3.
- **Phase 1F**: `evolution/src/services/criteriaActions.ts` — list / detail / create / update / archive / delete / `getCriteriaForEvaluation` / `getCriteriaVariantsAction` / `getCriteriaRunsAction` / `validateCriteriaIds`.
- **Phase 1G remainder**: `computeCriteriaMetricsForRun` + wire into `persistRunResults.ts`.
- **Phase 1H**: admin pages (list + detail with 5 tabs + `CriteriaPromptPerformanceTable` + `RubricEditor.tsx`) + sidebar nav entry.
- **Phase 1I**: `evolution/scripts/seedSampleCriteria.ts` with the 7 sample criteria + rubrics.

## Phase 2-10: not yet started.

## User Clarifications
None this phase.
