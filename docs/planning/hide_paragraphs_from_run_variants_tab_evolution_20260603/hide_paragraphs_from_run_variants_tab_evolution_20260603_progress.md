# Hide Paragraphs From Run Variants Tab Evolution Progress

## Phase 0: Reproduce / ground the leak
### Work Done
Verified the leak mechanism in code during plan-review (didn't need a live staging run): paragraph
slot **rewrite** variants carry `run_id` because `ParagraphRecombineAgent` calls `syncToArena(ctx.runId, …)`
and the `sync_to_arena` RPC (migration `20260527000003`) sets `run_id = p_run_id` on the inserted rows.
The slot **original** variant (`upsertSlotTopic`) has NO `run_id`. Therefore:
- Variants tab (`.eq('run_id', runId)`) → rewrites leak. REAL.
- Lineage (`getEvolutionRunLineageAction`, `.eq('run_id', runId)`) → rewrites leak as orphan nodes with
  dangling edges to the off-graph slot original. REAL.
- Snapshots (`getRunSnapshotsAction`) → rows come from the run's article-pool iteration snapshots; per-slot
  paragraph variants never enter it. NO leak. The integration test seeds a paragraph variant on a run and
  the article-only assertions confirm it.

## Phase 1: Variants tab — server default + Kind dropdown
### Work Done
- `evolution/src/services/evolutionActions.ts` — `getEvolutionVariantsAction`: added
  `variantKind?: 'article'|'paragraph'|'any'` to the object arg, defensive narrowing (string-arg form and
  unexpected values → `'article'`), and `if (variantKind !== 'any') query = query.eq('variant_kind', variantKind)`
  ANDed with the existing `.or(NON_DISCARDED_OR_FILTER)`. Applies to both the runId and strategyId `!inner`
  branches (same `query`).
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — added `kindFilter` state (default `'article'`),
  threaded `variantKind: kindFilter` into both fetch branches + the `useEffect` deps, and added a Kind
  `<select>` (`data-testid="variant-kind-filter"`) next to the tactic/iteration dropdowns.

### Issues Encountered
- Unit test (Kind dropdown) initially failed: while `loading` is true the component returns a skeleton,
  unmounting the `<select>`, so a stale element ref for a chained `change` hit a detached node. Fixed the
  TEST (not the code) by re-querying the select and waiting for the tab to settle between changes.

## Phase 2: Lineage graph — article-only + defensive edge guard
### Work Done
- `evolution/src/services/evolutionVisualizationActions.ts` — `getEvolutionRunLineageAction`: added
  `.eq('variant_kind', 'article')`. Node-filtering removes derived edges (edges come from the node list).
- `evolution/src/components/evolution/tabs/LineageTab.tsx` — defensive edge guard: drop any edge whose
  `source`/`target` isn't in the node set (preserves `parentIndex` for solid/dashed styling). Also added a
  return type to the inner `load()` (cleared a pre-existing lint warning in the file).

## Phase 3: Snapshots tab — verify-only
### Work Done
No code change (no production leak). Kept the `isDiscardedGenerateVariant` gate and the existing
`SnapshotsTab.test.tsx` paragraph-✓ defensive test unchanged. The integration test asserts the run's
returned variants/lineage are article-only.

## Tests
### Work Done
- Unit: `evolutionActions.test.ts` (+4 getEvolutionVariantsAction variantKind cases incl. strategyId path),
  `VariantsTab.test.tsx` (updated the 2 exact `toHaveBeenCalledWith` assertions + new Kind-dropdown test),
  `evolutionVisualizationActions.test.ts` (+1 lineage article-only assertion). **84 pass** in the 3 suites.
- Integration: new `src/__tests__/integration/evolution-variants-tab-article-only.integration.test.ts` —
  seeds an article + a paragraph rewrite on a run; asserts article-only default, `paragraph`/`any` opt-in,
  and article-only lineage against the real DB. **3 pass.**
- E2E: new `src/__tests__/e2e/specs/09-admin/admin-evolution-variants-tab-kind-filter.spec.ts` (@evolution,
  serial) — reuses `createParagraphRecombineFixture`, navigates by `runId`; asserts paragraph rows hidden by
  default, shown on Kind=Both, hidden again; Lineage article-only. **2 pass.**

## Docs
### Work Done
Updated `evolution/docs/visualization.md` (run Variants tab article-only + Kind dropdown; Lineage article-only;
Snapshots unaffected), `evolution/docs/variant_lineage.md` (new "Run lineage graph is article-only" section),
`evolution/docs/paragraph_recombine.md` (run-detail surfaces admonition).

## Checks
### Work Done
`npm run typecheck` clean; `npm run lint` (next lint + stale-specs) green; targeted unit/integration/E2E all
pass. Full local check suite (build + full unit + integration + E2E) to be run via `/finalize` before PR.
No DB migration (`variant_kind` column pre-exists).
