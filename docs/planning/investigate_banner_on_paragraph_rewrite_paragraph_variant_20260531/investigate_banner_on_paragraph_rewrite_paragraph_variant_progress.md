# Investigate Banner On Paragraph Rewrite Paragraph Variant Progress

## Phase 0: Research (3 rounds × 4 Explore agents) — DONE
Root cause confirmed on staging: paragraph-recombine variants are inserted via the `sync_to_arena` RPC, which never sets `persisted`; the column DEFAULTs to `false`, so all 758 paragraph variants on staging are `persisted=false` and wrongly fire the hardcoded generate-agent "discarded" banner (gated solely on `persisted===false`). See `_research.md`.

## Phase 0.5: Plan + Review — DONE
Plan: cosmetic, `variant_kind`-aware UI-only fix across 5 surfaces (no DB write/migration/backfill). `/plan-review` reached 5/5 consensus after 2 iterations (caught a missed 5th surface `listVariantsAction` and a build-breaking `.not()` filter form). See `_planning.md` Review & Discussion.

## Phase 1: Thread variant_kind through services + variantStatus util — DONE
### Work Done
- New `evolution/src/lib/utils/variantStatus.ts`: `isDiscardedGenerateVariant(persisted, variantKind)` + `NON_DISCARDED_OR_FILTER` constant (single source of truth; importable by both server actions and client components).
- `variantDetailActions.ts`: added required `variantKind` to `VariantFullDetail` + mapping (select already used `*`).
- `evolutionActions.ts`: added `variant_kind` to `EvolutionVariant`, `VariantListEntry`, `SnapshotVariantInfo`; added `variant_kind` to the `getEvolutionVariantsAction`, `listVariantsAction`, and `getRunSnapshotsAction` SELECTs + mappings.
- `evolutionVisualizationActions.ts`: added `variantKind` to `LineageNode` + `LineageData.nodes` + SELECT + mapping.
- No `database.types.ts` change needed (bare `SupabaseClient`).

## Phase 2: Gate the 5 UI surfaces + list filters — DONE
### Work Done
- VariantDetailContent banner, VariantsTab ✗ column, LineageGraph node opacity/dash, SnapshotsTab ✗ — all gated on `isDiscardedGenerateVariant(...)`.
- LineageTab graphNodes + SnapshotsTab buildRows now carry `variantKind`.
- Default list filters in `getEvolutionVariantsAction` and `listVariantsAction` changed from `.eq('persisted', true)` to `.or(NON_DISCARDED_OR_FILTER)` so paragraph variants (always persisted=false) aren't hidden (5th surface — the global Variants page paragraph/Both Kind filter no longer returns empty). `page.tsx` has no per-row persisted column, so no gating change there.

## Phase 3: Tests — DONE
### Work Done
- `variantStatus.test.ts`: predicate truth table + derive-based sync check that `NON_DISCARDED_OR_FILTER` encodes the same rule.
- `VariantDetailContent.test.tsx`: article+persisted=false → banner shown; paragraph+persisted=false → banner hidden; surfaced → hidden. (Mock updated with `variantKind`.)
- `VariantsTab.test.tsx`: discarded article ✗, surfaced article ✓, paragraph ✓.
- `SnapshotsTab.test.tsx`: pool table marks discarded article ✗ but paragraph ✓.
- `LineageTab.test.tsx`: graphNodes carry `variantKind` (proxy for d3-mocked styling).
- `evolutionActions.test.ts`: assert `.or(NON_DISCARDED_OR_FILTER)` is called (not `.eq('persisted', true)`) for both `getEvolutionVariantsAction` and `listVariantsAction`; fixed two pre-existing hand-rolled chain mocks to include `.or`.

### Results
- typecheck: PASS. lint + check:stale-specs: PASS. Full unit suite: **404 suites, 6966 tests passing, 0 failures.**

## Phase 4: Docs + local checks — DONE
### Work Done
- Updated `evolution/docs/data_model.md` (variant_kind row UI semantics), `evolution/docs/visualization.md` (variant-detail banner is article-only), `evolution/docs/paragraph_recombine.md` (persisted always false for paragraph variants by design; UI is kind-aware; metrics intentionally untouched).

### Issues Encountered
- Two pre-existing `getEvolutionVariantsAction` unit tests used hand-rolled chain mocks lacking `.or` → fixed by adding `or: jest.fn().mockReturnThis()`.
- Session-wide tool-output buffering (delayed bursts); all commands executed correctly.

### Manual / Deploy Verification (LOAD-BEARING — pending, staging-only bug)
- [ ] On the staging deployment: variant `af33e26d-…` shows no banner; global Variants list paragraph/Both Kind filter returns paragraph rows rendered normally; a run's VariantsTab/LineageGraph/SnapshotsTab show paragraph variants as ✓/normal while article discards stay ✗/dimmed. (No local fixtures for paragraph/persisted=false; covered by component tests + manual staging.)
