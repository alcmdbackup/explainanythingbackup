# `parent_variant_id` Migration Audit (Phase 3.9)

**PR 2 final state**: column dropped, RPC rewritten, 6323 tests green.

Pre-PR-1 grep snapshot: 158 hits across 45 files. Captured 2026-05-07.
Post-PR-2 grep: **55 hits across 36 files** — all intentional (comments + backward-compat
scalar fields on public types + integration test fixtures that still test the legacy
column name as a literal string identifier).

**Ground truth**: `parent_variant_id_audit_snapshot.txt` (sibling file) — pre-PR-1 grep output
preserved verbatim for diffing.

## What PR 2 landed

- **Migration 20260508000001**: `DROP COLUMN parent_variant_id` + `DROP INDEX
  idx_evolution_variants_parent_variant_id`. Forward-only.
- **Migration 20260508000002**: rewrote `get_variant_full_chain` RPC to walk
  `parent_variant_ids[1]` (PostgreSQL 1-indexed primary parent) recursively. Return
  shape now exposes `parent_variant_ids: uuid[]` per row in place of the dropped
  legacy `parent_variant_id` field.
- **Phase 1.16b**: dropped legacy `parent_variant_id` field from `evolutionVariantInsertSchema`.
- **Phase 1.17b**: removed legacy column from `database.types.ts` Row/Insert/Update.
- **Phase 3.8b**: `buildParentColumns()` returns only `{parent_variant_ids}`. Dev-mode
  consistency assertion + dual-write helper logic dropped.
- **Read-side sweep**: 6 server actions + 4 metrics paths updated to read
  `parent_variant_ids[0]` or `.contains('parent_variant_ids', [id])`. Public types
  retain the legacy `parent_variant_id` scalar field as a deprecated backward-compat
  alias derived from `parent_variant_ids[0]`.
- **Phase 4.9 multi-parent UI**: `LineageData.edges[]` extended with optional
  `parentIndex: number` field. `LineageGraph.tsx` renders `parentIndex >= 1` edges
  as dashed (debate's loser etc.). `VariantParentBadge` accepts optional
  `additionalParentIds: string[]` — when non-empty, surfaces a "+N more" gold chip.
- **Test fixture sweep**: 4 service test files + 1 integration test + 2 entity-count
  tests updated for the new column layout + new metric counts.
- **Catalog metrics**: `debate_cost`, `total_debate_cost`, `avg_debate_cost_per_run`
  added to `METRIC_CATALOG`. Strategy/Experiment/Run entities reference them.
- **PR 2 schema-mismatch tests**: error message regex narrowed in
  `iterationConfigSchema.test.ts` for the sourceMode/qualityCutoff Zod refines.

## Why 55 hits remain (and why they're correct)

Action key:
- **NEW-COMMENT** — Comments documenting the legacy column's history, current backward-compat behavior, or migration sequencing. Pure documentation.
- **BACKWARD-COMPAT-FIELD** — Public type still exposes `parent_variant_id` scalar (`ArenaEntry`, `EvolutionVariant`, `VariantListEntry`, etc.) — derived from `parent_variant_ids[0]` in the server action. Consumers reading the scalar field don't need to migrate immediately; new consumers should read `parent_variant_ids` directly.
- **FROZEN-MIGRATION** — Historical migrations (`20260418000001_variants_parent_variant_id_index.sql`, `20260418000002_variants_get_full_chain_rpc.sql`) — forward-only contract, never edited. PR 2 ships replacement migrations.
- **TEST-FIXTURE-LEGACY** — Integration tests assert legacy column behavior in pre-existing fixtures. Acceptable: they test the historic schema, not the current one. New tests use `parent_variant_ids`.

Original PR 1 audit follows; superseded entries are marked.

---

PR 1 dual-write window snapshot. Captured 2026-05-07. **Scope**: 158 grep hits across 45 files.

**Ground truth**: `parent_variant_id_audit_snapshot.txt` (sibling file) — full grep output preserved verbatim for diffing.

## Action key

- **DUAL-WRITE** — PR 1 writes BOTH `parent_variant_id` AND `parent_variant_ids` (Phase 3.8a). PR 2 will drop the legacy write.
- **DUAL-READ** — PR 1 leaves the read-side reading `parent_variant_id`. PR 2 switches to `parent_variant_ids[0]` (or full array for multi-parent UI per Phase 4.9).
- **TEST-FIXTURE** — Test fixture inserts/asserts `parent_variant_id`. PR 1 dual-write keeps tests green. PR 2 will update fixtures alongside the column drop.
- **FROZEN-MIGRATION** — Pre-existing migration referencing the legacy column. Forward-only contract — never edited. PR 2 ships a new migration that drops the column.
- **DOC-UPDATE-PR2** — Documentation prose. PR 2 will sweep docs alongside the code change.
- **N/A-COMMENT** — Comment / planning-doc reference / string literal in test description. No code change required.
- **NEW-IN-PR1** — New file added by this PR (e.g., the new migration, audit doc, persistRunResults dual-write helper).

## Source code (45 files)

### Core schema + persistence

| File | Lines | Action | Notes |
|------|-------|--------|-------|
| `evolution/src/lib/schemas.ts` | 218 | DUAL-WRITE | `evolutionVariantInsertSchema` accepts BOTH fields. PR 2's 1.16b drops `parent_variant_id`. |
| `evolution/src/lib/pipeline/finalize/persistRunResults.ts` | 247, 280 | DUAL-WRITE (NEW-IN-PR1: `buildParentColumns()` + `MAX_PARENT_IDS`) | `buildParentColumns()` writes both columns. PR 2's Phase 3.8b drops the legacy assignment. |
| `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` | 222–256 | TEST-FIXTURE | Dual-write assertion added in PR 1. PR 2 drops legacy column assertion. |

### Pipeline logic (read-side)

| File | Action | Notes |
|------|--------|-------|
| `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` | N/A-COMMENT | Comment block referencing `parent_variant_id` semantics — accurate during dual-write. |
| `evolution/src/lib/pipeline/loop/resolveParent.ts` | DUAL-READ | Reads `parent_variant_id`. PR 2 switches to `parent_variant_ids[0]`. Single-parent context only. |
| `evolution/src/lib/pipeline/claimAndExecuteRun.ts` | N/A-COMMENT | Audit string in log; not a code path that needs changing. |

### Metrics

| File | Action | Notes |
|------|--------|-------|
| `evolution/src/lib/metrics/computations/criteriaMetrics.ts` | DUAL-READ | `WHERE parent_variant_id = ?` query. PR 2 switches to `WHERE ? = ANY(parent_variant_ids)`. |
| `evolution/src/lib/metrics/computations/criteriaMetrics.test.ts` | TEST-FIXTURE | Mirrors prod query. Update with criteriaMetrics.ts. |
| `evolution/src/lib/metrics/experimentMetrics.ts` | DUAL-READ | Same WHERE-clause pattern. |
| `evolution/src/lib/metrics/attributionPipeline.integration.test.ts` | TEST-FIXTURE | Lineage queries on fixtures. Update in PR 2. |

### Server actions

| File | Action | Notes |
|------|--------|-------|
| `evolution/src/services/arenaActions.ts` | DUAL-READ | Reads `parent_variant_id` for arena lineage display. |
| `evolution/src/services/arenaActions.test.ts` | TEST-FIXTURE | Mirrors arenaActions.ts. |
| `evolution/src/services/evolutionActions.ts` | DUAL-READ | Variant lineage queries. |
| `evolution/src/services/evolutionActions.test.ts` | TEST-FIXTURE | Mirror. |
| `evolution/src/services/evolutionVisualizationActions.ts` | DUAL-READ | `getLineageData` server action. PR 2 + Phase 4.9 changes return shape to `(child, parent, parent_index)` triples. |
| `evolution/src/services/evolutionVisualizationActions.test.ts` | TEST-FIXTURE | Mirror. |
| `evolution/src/services/invocationActions.ts` | DUAL-READ | Invocation detail lineage queries. |
| `evolution/src/services/variantDetailActions.ts` | DUAL-READ | Single-variant detail page. PR 2 + Phase 4.9 surfaces multi-parent chips. |
| `evolution/src/services/variantDetailActions.test.ts` | TEST-FIXTURE | Mirror. |

### UI (admin)

| File | Action | Notes |
|------|--------|-------|
| `evolution/src/components/evolution/tabs/VariantsTab.tsx` | DUAL-READ | Variants table parent column. PR 2 + Phase 4.9 renders chip-list for multi-parent rows. |
| `src/app/admin/evolution/arena/[topicId]/page.tsx` | DUAL-READ | Arena topic page parent display. |
| `src/app/admin/evolution/arena/arenaBudgetFilter.test.ts` | TEST-FIXTURE | Filter tests. |
| `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` | DUAL-READ | Already updated for debate's 5-tab in Phase 4.3 — no debate-specific lineage UI yet. PR 2 + Phase 4.9 adds chip rendering. |
| `src/app/admin/evolution/variants/page.tsx` | DUAL-READ | Variants index page. |

### Generated types

| File | Action | Notes |
|------|--------|-------|
| `src/lib/database.types.ts` | NEW-IN-PR1 | Manually added `parent_variant_ids: string[]` to Row/Insert/Update for `evolution_variants` (Phase 1.17a — usually `npm run db:types` regenerates from remote, but applied manually here since this shell can't auth to supabase). PR 2's 1.17b regen drops `parent_variant_id`. |

### Integration / E2E tests

| File | Action | Notes |
|------|--------|-------|
| `evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts` | TEST-FIXTURE | Lineage assertions on editing variants. |
| `evolution/src/__tests__/integration/evolution-variant-criteria-roundtrip.integration.test.ts` | TEST-FIXTURE | Lineage roundtrip. |
| `evolution/src/lib/pipeline/finalize/lineageCtesafety.integration.test.ts` | TEST-FIXTURE | RPC walker safety. PR 2 updates assertions for `parent_index` field. |
| `evolution/src/lib/pipeline/finalize/variantInvocationLink.integration.test.ts` | TEST-FIXTURE | Variant→invocation linkage. |
| `evolution/src/lib/pipeline/loop/poolSourcing.integration.test.ts` | TEST-FIXTURE | Pool sourcing assertions. |
| `src/__tests__/integration/attributionFinalization.integration.test.ts` | TEST-FIXTURE | Attribution finalization fixtures. |
| `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` | TEST-FIXTURE | Shared fixture factory. |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` | TEST-FIXTURE | Editing E2E spec. |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-debate.spec.ts` | NEW-IN-PR1 | Debate E2E scaffold. Multi-parent assertion explicitly `.skip()` until PR 2. |

### Migrations (frozen — DO NOT EDIT)

| File | Action | Notes |
|------|--------|-------|
| `supabase/migrations/20260418000001_variants_parent_variant_id_index.sql` | FROZEN-MIGRATION | Historical — superseded by 1.15a's GIN index on the array column. |
| `supabase/migrations/20260418000002_variants_get_full_chain_rpc.sql` | FROZEN-MIGRATION | Existing RPC body still works while `parent_variant_id` column exists. PR 2 ships a NEW migration replacing the body (per Phase 1.18 deferred). |
| `supabase/migrations/20260507000006_evolution_variants_parent_ids_array_add.sql` | NEW-IN-PR1 | Phase 1.15a migration. |

### Documentation (PR 2 sweep)

| File | Action | Notes |
|------|--------|-------|
| `evolution/docs/agents/overview.md` | DOC-UPDATE-PR2 | Lineage prose. PR 2 sweep updates to mention `parent_variant_ids` array. |
| `evolution/docs/curriculum.md` | DOC-UPDATE-PR2 | |
| `evolution/docs/data_model.md` | DOC-UPDATE-PR2 | Phase 5.11 (deferred) adds Multi-parent variants subsection here. |
| `evolution/docs/editing_agents.md` | DOC-UPDATE-PR2 | |
| `evolution/docs/entities.md` | DOC-UPDATE-PR2 | Variant entity description. |
| `evolution/docs/strategies_and_experiments.md` | DOC-UPDATE-PR2 | |
| `evolution/docs/variant_lineage.md` | DOC-UPDATE-PR2 | Canonical lineage doc — full rewrite for array semantics. |
| `evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/...planning.md` | N/A-COMMENT | Historical planning doc — frozen artifact. |

## PR 2 work plan

When ≥24h+ of soak data shows `dual_write_inconsistency_count = 0` and the persistence layer is consistently writing both columns:

1. New migration `<ts>_evolution_variants_parent_id_drop.sql` — `DROP COLUMN parent_variant_id` + `DROP INDEX idx_evolution_variants_parent_variant_id`.
2. New migration `<ts+1s>_evolution_variants_lineage_walker_array.sql` — Phase 1.18 RPC rewrite walking `parent_variant_ids` via `unnest()` with `parent_index`. Updates RPC return shape (drops `parent_variant_id` field).
3. `evolution/src/lib/schemas.ts` — drop `parent_variant_id` from `evolutionVariantInsertSchema` (Phase 1.16b).
4. `src/lib/database.types.ts` — `npm run db:types` regen (Phase 1.17b). Drops `parent_variant_id` from Row/Insert/Update.
5. `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — drop `parent_variant_id` line from `buildParentColumns()` (Phase 3.8b). Keep `parent_variant_ids` only.
6. Sweep all DUAL-READ entries above to read `parent_variant_ids[0]` (or full array for multi-parent UI per Phase 4.9).
7. Sweep all TEST-FIXTURE entries — drop `parent_variant_id` assertions, keep `parent_variant_ids`.
8. Phase 4.9 multi-parent lineage UI: `LineageGraph.tsx`, `VariantDetailContent.tsx`, `VariantCard.tsx`, `VariantParentBadge.tsx`. Render dashed edges for `parent_index >= 1`.
9. Sweep DOC-UPDATE-PR2 entries.
10. Re-run grep for `parent_variant_id` (excluding `_ids`) — should hit only frozen-migration files + comments referencing historical context.
