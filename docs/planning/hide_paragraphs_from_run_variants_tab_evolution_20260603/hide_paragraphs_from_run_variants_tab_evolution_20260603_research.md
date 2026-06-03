# Hide Paragraphs From Run Variants Tab Evolution Research

## Problem Statement
recent recents showing paragraphs in variants tab

Recent evolution runs that use `paragraph_recombine` persist per-slot rewrites as
`evolution_variants` rows with `variant_kind='paragraph'`. These paragraph snippets are leaking
into run-detail surfaces in the admin UI. They are internal machinery (slot-level building blocks),
not article variants a researcher inspects per run, so they should be filtered out by default.

## Requirements (from GH Issue #1161)
Recent runs have been showing paragraph rewrites in run variants tab. Please filter them out

## High Level Summary
The **standalone** variants list (`/admin/evolution/variants`) already defaults to article-only via
`listVariantsAction` (`variantKind` enum, default `'article'`) + a Kind dropdown. But the run/strategy
**run-detail surfaces** do NOT apply that default, so paragraph variants leak into THREE places:

1. **Variants tab** (`VariantsTab.tsx`) → `getEvolutionVariantsAction` — no `variantKind` param.
2. **Lineage graph** (`LineageGraph` via `evolutionVisualizationActions`) — no `variant_kind` filter.
3. **Snapshots tab** (`SnapshotsTab`) — batch-fetches variant info without a `variant_kind` filter.

**Decisions (user, 2026-06-03):**
- **Scope:** fix all three surfaces (Variants tab + Lineage + Snapshots).
- **UI:** Variants tab gets an **article-only default + a Kind dropdown** (Articles only / Paragraph
  snippets / Both), mirroring the standalone list, so paragraph variants stay reachable on demand.

**Proven fix pattern** (copy from `listVariantsAction`): apply `.eq('variant_kind', variantKind)`
when `variantKind !== 'any'`, ANDed with the existing `.or(NON_DISCARDED_OR_FILTER)`. With the
default `'article'`, the net query is "persisted article only" — paragraph rows drop out.

**Critical correctness note:** do NOT use a blanket `persisted=true` filter. Paragraph variants are
always `persisted=false` by design (`sync_to_arena` never sets `persisted`). The correct gate is
`variant_kind`-aware: `NON_DISCARDED_OR_FILTER` (`persisted.eq.true,variant_kind.neq.article`) for
the discard filter, plus the explicit `.eq('variant_kind', kind)` for the Kind filter. `.or()` then
`.eq()` AND together in PostgREST (no gotcha — confirmed against the proven `listVariantsAction`).

**No DB migration needed** — the `variant_kind` column already exists (migration `20260527000001`).
Pure application change: server action(s) + React components + tests.

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

### Relevant Docs (all evolution docs read per request)
- evolution/docs/visualization.md — VariantsTab + variants-list filter semantics; Lineage/Snapshots tabs
- evolution/docs/paragraph_recombine.md — `variant_kind='paragraph'` provenance; persisted=false by design
- evolution/docs/variant_lineage.md — `NON_DISCARDED_OR_FILTER` / `isDiscardedGenerateVariant`; lineage walk
- evolution/docs/data_model.md — `variant_kind` column (migration 20260527000001), `persisted` semantics
- evolution/docs/README.md, architecture.md, agents/overview.md, arena.md, cost_optimization.md,
  rating_and_comparison.md, strategies_and_experiments.md, metrics.md, evolution_metrics.md,
  entities.md, reference.md, multi_iteration_strategies.md, editing_agents.md, criteria_agents.md,
  logging.md, curriculum.md, minicomputer_deployment.md

## Code Files Read
- `evolution/src/services/evolutionActions.ts` —
  - `getEvolutionVariantsAction` (~517–598): backs run + strategy Variants tab. Arg is a union
    `string | { runId?; strategyId?; includeDiscarded? }`. Selects `variant_kind` (line ~536),
    applies `.or(NON_DISCARDED_OR_FILTER)` when `!includeDiscarded` — but has **no `variantKind`
    param and no `.eq('variant_kind', ...)`**, so paragraph rows leak. THE BUG.
  - `listVariantsAction` (~727–861): standalone list. Zod schema (~151–153) `variantKind` enum
    default `'article'`; filter (~759–762) `if (parsed.variantKind !== 'any') query.eq('variant_kind', parsed.variantKind)`. THE PATTERN TO COPY.
  - Snapshots variant batch-fetch (~477–515): selects `variant_kind`, no kind filter.
  - `EvolutionVariant` type (~48–80): already includes `variant_kind?: string`.
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — props `{ runId?, strategyId?, runStatus? }`;
  fetch useEffect deps `[runId, strategyId, includeDiscarded]`; raw `<select>` dropdowns for
  tactic/iteration (~128–144) + `includeDiscarded` checkbox (~146–154); `isDiscardedGenerateVariant`
  used in the Persisted column (~250); NO Kind dropdown; NO AutoRefresh.
- `src/app/admin/evolution/runs/[runId]/page.tsx` (~155) — `<VariantsTab runId={runId} runStatus={run.status} />`.
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` (~149) — `<VariantsTab strategyId={strategyId} />` (same component).
- `src/app/admin/evolution/variants/page.tsx` — FilterDef for `variantKind` (~30–39); default
  `filterValues` `{ filterTestContent:'true', variantKind:'article' }` (~167). Reference impl.
- `evolution/src/lib/utils/variantStatus.ts` — `NON_DISCARDED_OR_FILTER = 'persisted.eq.true,variant_kind.neq.article'` (line 24);
  `isDiscardedGenerateVariant(persisted, variantKind) => persisted===false && variantKind==='article'` (9–14).
- `evolution/src/services/evolutionVisualizationActions.ts` (~246–281) — lineage query selects
  `variant_kind`, no kind filter → paragraph nodes included; `LineageGraph` renders them.
- `evolution/src/components/evolution/visualizations/LineageGraph.tsx` (~145–154) — dims/dashes only
  `isDiscardedGenerateVariant` nodes (so paragraph nodes render normally).
- `evolution/src/components/evolution/tabs/SnapshotsTab.tsx` (~85) — `isDiscardedGenerateVariant` gate;
  paragraph rows currently shown in pool + discarded lists.
- Tests: `evolution/src/components/evolution/tabs/VariantsTab.test.tsx`,
  `evolution/src/services/evolutionActions.test.ts`, `evolution/src/lib/utils/variantStatus.test.ts`,
  `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx`,
  `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`, `admin-evolution-runs.spec.ts`.
- Test factories: `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` (`createTestVariant` — does
  NOT accept `variant_kind`; direct insert needed), `evolution/src/testing/evolution-test-helpers.ts`
  (`createTestVariant(supabase, runId, explId, overrides?)` — accepts `{ variant_kind: 'paragraph' }`).

## Key Findings
1. **Root cause (Variants tab):** `getEvolutionVariantsAction` lacks a `variantKind` filter; its
   `NON_DISCARDED_OR_FILTER` explicitly KEEPS `variant_kind != 'article'`, so paragraph rows surface.
2. **Proven fix:** mirror `listVariantsAction` — add `variantKind: 'article'|'paragraph'|'any'`
   (default `'article'`) and `.eq('variant_kind', variantKind)` when `!= 'any'`. `.or().eq()` AND-combine
   to "persisted article only" by default.
3. **Arg shape:** `getEvolutionVariantsAction` takes a `string | {…}` union. Add `variantKind?` to the
   object form and extract `typeof args === 'string' ? 'article' : (args.variantKind ?? 'article')`.
   String form (used by one test) stays back-compat.
4. **Single production caller:** only `VariantsTab.tsx` calls `getEvolutionVariantsAction`. An
   article-only default is safe; strategy-detail tab (same component) gets the fix for free.
5. **UI:** VariantsTab uses raw `<select>` dropdowns (not EntityListPage FilterDef). Adding a Kind
   `<select>` (~10 lines) + `kindFilter` state + adding it to the fetch deps array is the pattern.
   No AutoRefresh, so state survives normally.
6. **Lineage scope:** `evolutionVisualizationActions` lineage query must filter `variant_kind='article'`
   (or exclude paragraph). Article lineage stays intact — recombined article variants have article
   parents; paragraph slot variants form a separate sub-graph that can be dropped.
7. **Snapshots scope:** filter paragraph rows out of the snapshot pool/discarded lists (either at the
   batch fetch in `evolutionActions.ts:~477-515` or client-side in `SnapshotsTab`).
8. **No migration:** `variant_kind` column exists (20260527000001). Pure app change.
9. **Breaking tests (exact):** `VariantsTab.test.tsx` lines ~190 and ~196 use exact
   `toHaveBeenCalledWith({ runId:'run-1', includeDiscarded:false/true })` — must become
   `{ ..., variantKind:'article' }`. The `getEvolutionVariantsAction` persisted-filter test
   (`evolutionActions.test.ts` ~925–944) survives (it asserts no `.eq('persisted',true)`, unaffected by a
   `.eq('variant_kind',...)`). The "paragraph variants render ✓" test (VariantsTab.test.tsx ~200–222)
   mocks the action return directly, so it still passes (component renders what it's handed).
10. **Test seeding:** integration helper `createTestVariant(..., { variant_kind:'paragraph' })` works;
    E2E factory needs a direct Supabase insert (+ `trackEvolutionId('variant', id)` for cleanup, and
    `[TEST_EVO]` prefix / `require-test-cleanup` afterAll).
11. **CI classification:** all touched paths are evolution-only → `/finalize` runs `@evolution` E2E.
    Local check commands: `lint`, `typecheck`, `build`, `test`, `test:integration`,
    `test:e2e:critical`, `test:e2e:evolution`.
12. **Docs to update (doc-mapping):** `evolution/docs/visualization.md` (run Variants/Lineage/Snapshots
    now default article-only + Kind dropdown), `evolution/docs/paragraph_recombine.md`, possibly
    `data_model.md` (no semantic change). `docs/feature_deep_dives/admin_panel.md` may be flagged.

## Open Questions
- Lineage + Snapshots: article-only hard default, or also give them a small "show paragraph" toggle?
  (Variants tab gets the full Kind dropdown per the decision; Lineage/Snapshots default article-only —
  decide during planning whether a toggle is worth the extra UI. Leaning: hard article-only for those
  two to keep the change small; revisit in /plan-review.)
- Should `getEvolutionVariantsAction` accept `'any'`/`'paragraph'` (full enum) or just a boolean
  "article-only"? Leaning full enum for parity with `listVariantsAction` and to back the Kind dropdown.
