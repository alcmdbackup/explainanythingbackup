# Hide Paragraphs From Run Variants Tab Evolution Plan

## Background
recent recents showing paragraphs in variants tab

## Requirements (from GH Issue #1161)
Recent runs have been showing paragraph rewrites in run variants tab. Please filter them out

## Problem
`paragraph_recombine` persists per-slot **rewrite** variants (`variant_kind='paragraph'`) through
`syncToArena(ctx.runId, …)` → the `sync_to_arena` RPC, which sets `run_id = p_run_id` on the inserted
rows (migration `20260527000003`, INSERT column list includes `run_id` ← `p_run_id`). So those rewrite
variants DO carry the run's `run_id`. Any run-detail surface that queries `evolution_variants` by
`run_id` without a `variant_kind` filter therefore surfaces them. The standalone
`/admin/evolution/variants` list already defaults to article-only (`listVariantsAction.variantKind`
default `'article'` + Kind dropdown); the run-detail surfaces never adopted that default.

### Per-surface leak status (verified in code during plan-review iteration 1)
| Surface | Data source | Filters by run_id? | Leaks paragraph variants? |
|---|---|---|---|
| **Variants tab** | `getEvolutionVariantsAction` (`evolutionActions.ts:517–598`) | yes (`.eq('run_id', runId)`) | **YES** — rewrite variants carry run_id; no variant_kind filter. (User-reported.) |
| **Lineage graph** | `getEvolutionRunLineageAction` (`evolutionVisualizationActions.ts:246–282`) | yes (`.eq('run_id', runId)`) | **YES** — rewrite variants appear as nodes; their `parent_variant_ids=[originalSlotVariantId]`, and the slot original has **no run_id** (`upsertSlotTopic` in `slotTopicActions.ts:106–117` omits it), so the parent is off-graph → **dangling edge**. |
| **Snapshots tab** | `getRunSnapshotsAction` (`evolutionActions.ts:~477–515`) → rows from `snap.poolVariantIds` (run's article-pool iteration snapshots) | rows come from run's article pool | **NO** — per-slot paragraph variants live in per-slot local pools, never the run article pool, so their IDs are never in `poolVariantIds`. The existing `SnapshotsTab.test.tsx` "paragraph ✓" test is a *defensive* unit test of the `isDiscardedGenerateVariant` gate, not proof of a production leak. |

## Decisions
- **User (2026-06-03):** scope = Variants tab + Lineage + Snapshots; UI = article-only default + Kind dropdown.
- **Refined after iteration-1 verification:** the leak is real on the **Variants tab** and **Lineage**;
  **Snapshots does not leak** in production. We honor the "cover all three" intent by: fixing Variants +
  Lineage, and **verifying** Snapshots is clean (no code change, keep the defensive gate + existing test).
  Rationale recorded in Review & Discussion. If a future change adds paragraph variants to the run
  article pool, the Snapshots gate would need revisiting — captured as a guard test.

## Options Considered
- [x] **Option A (chosen): Server-default article-only + Kind dropdown (Variants tab); article-only
  query filter (Lineage).** Mirror the proven `listVariantsAction` pattern. Lowest-risk, consistent.
- **Option B (rejected): Hard article-only, no UI control.** Removes paragraph inspection, diverges
  from the standalone list.
- **Option C (rejected): Client-side filter only.** Server still returns paragraph rows (wasted
  payload) and doesn't cleanly cover Lineage.

## Phased Execution Plan

### Phase 0: Reproduce on each surface (grounding)
- [x] Seed (or find) a `paragraph_recombine` run on staging; confirm in the admin UI that paragraph
  rewrite variants appear in the **Variants tab** and as nodes in the **Lineage graph**, and confirm
  they do **not** appear in the **Snapshots tab** (pool tables). Capture run id in `_progress.md`.
  (Alternatively reproduce via `createParagraphRecombineFixture` in the E2E helpers — see Testing.)

### Phase 1: Variants tab — server default + Kind dropdown
- [x] `evolution/src/services/evolutionActions.ts` — `getEvolutionVariantsAction` (~517):
  - Extend the object arg form with `variantKind?: 'article' | 'paragraph' | 'any'`.
  - Extract defensively: `const variantKind = typeof args === 'string' ? 'article' : (args.variantKind ?? 'article');`
    Narrow unexpected values to `'article'` (closed enum compared by value — no injection surface, but
    default-narrow for safety): `const vk = (['article','paragraph','any'] as const).includes(variantKind) ? variantKind : 'article';`
  - After the existing `.or(NON_DISCARDED_OR_FILTER)` block, add (mirrors `listVariantsAction:759–762`):
    `if (vk !== 'any') query = query.eq('variant_kind', vk);`
    This applies to BOTH the `runId` and the `strategyId !inner` select branches (the `.eq` is on the
    same `query`), so both paths are covered.
- [x] `evolution/src/components/evolution/tabs/VariantsTab.tsx`:
  - Add `const [kindFilter, setKindFilter] = useState<'article'|'paragraph'|'any'>('article');`
  - Pass `variantKind: kindFilter` in BOTH branches of the `getEvolutionVariantsAction` call
    (`runId ? { runId, includeDiscarded, variantKind: kindFilter } : { strategyId, includeDiscarded, variantKind: kindFilter }`).
  - Add `kindFilter` to the fetch `useEffect` deps array.
  - Add a Kind `<select>` next to the tactic/iteration dropdowns, `data-testid="variant-kind-filter"`,
    options: Articles only (default) / Paragraph snippets / Both — matching the standalone list's labels.

### Phase 2: Lineage graph — article-only (+ defensive edge guard)
- [x] `evolution/src/services/evolutionVisualizationActions.ts` — `getEvolutionRunLineageAction` (~251):
  add `.eq('variant_kind', 'article')` to the query. Because lineage **edges are derived from the node
  list** in `LineageTab.tsx:69–75` (`nodes.flatMap(n => n.parentIds.map(...))`), removing paragraph
  nodes automatically removes their edges — no dangling-edge risk from the paragraph→original direction.
  Article variants only have article parents (recombined article variant lineage is
  `parent_variant_ids=[poolParent]`, all article — D4), so no article node is orphaned.
- [x] `evolution/src/components/evolution/tabs/LineageTab.tsx`: add a defensive edge filter as
  belt-and-suspenders so a future schema change can't reintroduce dangling edges. Build the Set from
  the source `nodes` list (not the post-`.map` `graphNodes`), keep the existing `.flatMap` shape so the
  `parentIndex` field survives (LineageGraph uses it for solid vs dashed multi-parent edges), then filter:
  `const nodeIds = new Set(nodes.map(n => n.id)); const graphEdges = nodes.flatMap(n => (n.parentIds ?? []).map((parentId, parentIndex) => ({ source: parentId, target: n.id, parentIndex }))).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));`
  Pass `graphEdges` to `<LineageGraph edges={graphEdges} />` unchanged.

### Phase 3: Snapshots tab — verify-only (no production leak)
- [x] **No code change.** Confirm (Phase 0) that `getRunSnapshotsAction` never returns paragraph IDs in
  `poolVariantIds`/`discardedVariantIds` (they come from the run's article-pool iteration snapshots).
- [x] Keep the existing `isDiscardedGenerateVariant` gate and the existing
  `SnapshotsTab.test.tsx` "paragraph ✓" defensive test UNCHANGED.
- [x] Add a guard unit test (see Testing) asserting `getRunSnapshotsAction` pool rows are article-only
  for a run, so a future regression that injects paragraph IDs into the article pool is caught.

## Testing

### Unit Tests
- [x] `evolution/src/services/evolutionActions.test.ts` — `getEvolutionVariantsAction`:
  - default (`variantKind` omitted / string-arg form) applies `.eq('variant_kind','article')`;
  - `variantKind:'paragraph'` applies `.eq('variant_kind','paragraph')`; `'any'` applies NO `.eq` on kind;
  - the existing persisted-filter test (`~925–944`) still passes (asserts `.or(NON_DISCARDED_OR_FILTER)`
    present and no `.eq('persisted',true)` — unaffected by adding a `variant_kind` `.eq`);
  - assert the kind `.eq` is present on the `strategyId` (`!inner`) path too.
- [x] `evolution/src/components/evolution/tabs/VariantsTab.test.tsx`:
  - **Update the exact-match assertions at lines ~190 and ~196** from
    `{ runId:'run-1', includeDiscarded:false/true }` to include `variantKind:'article'`.
  - The strategy-detail assertion (uses `expect.objectContaining`, ~line 298–299) survives — note it,
    don't "fix" it.
  - The "marks paragraph ✓" test (~200–222) mocks the action return directly, so it still passes.
  - Add a test: changing the Kind `<select>` to `paragraph`/`any` calls the action with the new `variantKind`.
- [x] `evolution/src/services/evolutionVisualizationActions.test.ts` — `describe('getEvolutionRunLineageAction')`
  (existing block ~line 411): the action uses a `.eq('run_id').order()` chain (NOT `.or()`); update the
  mock chain to capture/assert a new `.eq('variant_kind','article')` call, and ensure the chain still
  terminates correctly after the added `.eq`.
- [x] `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx` — leave the existing paragraph-✓
  test unchanged (defensive gate). No new filtering behavior here.

### Integration Tests
- [x] Use the INTEGRATION helper `createTestVariant` from `evolution/src/testing/evolution-test-helpers.ts`
  (signature `(supabase, runId, explanationId, overrides?)` — passes `overrides` through), NOT the E2E
  factory's options-object `createTestVariant` (which does not accept `variant_kind`). Seed an article +
  `createTestVariant(supabase, runId, null, { variant_kind:'paragraph' })`. Assert:
  - `getEvolutionVariantsAction({ runId })` returns only the article by default; returns the paragraph for
    `variantKind:'paragraph'`/`'any'`;
  - `getEvolutionRunLineageAction(runId)` returns only article nodes;
  - **Snapshots guard:** `getRunSnapshotsAction(runId)` pool/discarded **id arrays** never contain the
    paragraph variant id (assert on the id arrays, not the `variantInfo` map — closes the no-leak property
    at the boundary).
  - Cleanup via `cleanupEvolutionData(supabase, { runIds:[runId] })` (these rows aren't `trackEvolutionId`-tracked).

### E2E Tests
- [x] Prefer reusing the existing `createParagraphRecombineFixture` (`src/__tests__/e2e/helpers/evolution-test-data-factory.ts`)
  — it seeds an article parent + paragraph variants with `run_id` + `variant_kind='paragraph'`, exposes
  `runId` + `cleanup()`, covering Variants + Lineage on one run. Navigate the spec by **`fixture.runId`**
  (`/admin/evolution/runs/${runId}`), NOT by `invocationId` (don't copy the existing recombine spec's
  invocation goto). The e2e factory's `createTestVariant` does NOT accept variant_kind.
- [x] New/extended spec under `src/__tests__/e2e/specs/09-admin/` (repo-root tree, NOT under `evolution/`;
  Phase 1/2 code edits ARE under `evolution/src/...` — the repo is split-tree). Tag `@evolution`: open the run-detail
  **Variants tab**, assert paragraph rows hidden by default, and shown when the Kind `<select>` →
  "Paragraph snippets"/"Both". Open the **Lineage** tab and assert only article nodes render.
  - Flakiness compliance (testing_overview.md): wait for a data-dependent element (variants table rows
    visible) before interacting (rule 18); use `data-testid="variant-kind-filter"` + `selectOption`;
    assert via auto-retrying `expect(locator).toBeVisible()/.not.toBeVisible()` and/or `expect.poll`,
    never point-in-time reads or fixed sleeps (rules 2, 4); `afterAll` cleanup via the fixture's
    `cleanup()` (satisfies `flakiness/require-test-cleanup`, rule 16); `[TEST_EVO]` prefix.
  - Run the run-detail Variants tab as a tab (not an EntityListPage), so `require-reset-filters` (rule 1)
    does not apply; the Kind default is already 'article' in component state.
  - If the spec seeds the fixture in `beforeAll` and the `describe` has multiple tests sharing it, add
    `test.describe.configure({ mode: 'serial' })` (rule 13).

### Manual Verification
- [x] Open a recent `paragraph_recombine` run in the admin UI; confirm Variants tab + Lineage show only
  article variants by default and the Kind dropdown reveals paragraph snippets on demand; confirm
  Snapshots shows article rows only (was already the case).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/ -g @evolution` on the local server (via ensure-server.sh).

### B) Automated Tests
- [x] `npm run test -- VariantsTab evolutionActions evolutionVisualizationActions`
- [x] `npm run test:integration`
- [x] `npm run lint && npm run typecheck && npm run build`

## Rollback Plan
Pure application change (server actions + React components + tests). **No DB migration** — the
`variant_kind` column already exists (migration `20260527000001`, `NOT NULL DEFAULT 'article' CHECK IN
('article','paragraph')`, so no NULL rows can exist and `.eq('variant_kind','article')` deterministically
captures every legacy row). Rollback = `git revert` of the PR; no feature flag required. The Kind dropdown
also functions as a soft mitigation: if the default is ever wrong, users can switch to "Both" without a
code change. No data is mutated.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/visualization.md` — run Variants tab now defaults article-only + Kind dropdown;
  Lineage graph defaults article-only; Snapshots unchanged (article-pool only, verified).
- [x] `evolution/docs/paragraph_recombine.md` — note run Variants tab + Lineage hide paragraph snippets
  by default (Snapshots already article-only).
- [x] `evolution/docs/variant_lineage.md` — `getEvolutionRunLineageAction` now filters `variant_kind='article'`.
- [x] `evolution/docs/data_model.md` — no semantic change expected (reference only).

## Review & Discussion

### Iteration 1 (Security 4/5, Architecture 2/5, Testing 3/5) — gaps resolved
- **[Architecture, critical] Lineage leak unverified / wrong integration point / dangling edges.**
  Verified in code: paragraph **rewrite** variants carry `run_id` (via `syncToArena(ctx.runId,…)` →
  `sync_to_arena` RPC sets `run_id=p_run_id`, migration `20260527000003`), so they DO leak into the
  `run_id`-scoped Lineage query. Edges are derived from the node list in `LineageTab.tsx:69–75`, so
  filtering nodes to `variant_kind='article'` in the action removes their edges too; added a defensive
  edge guard in `LineageTab.tsx` as belt-and-suspenders. Phase 2 rewritten accordingly and now names
  `LineageTab.tsx` explicitly.
- **[Architecture/Testing, critical] Lineage & Snapshots leak unproven.** Verified per-surface (table
  above): Variants + Lineage leak; **Snapshots does not** (pool rows are article-pool only). Phase 3
  changed to verify-only + a guard test; the conflicting `SnapshotsTab.test.tsx` paragraph-✓ test stays
  unchanged. Added Phase 0 reproduction.
- **[Architecture/Testing, critical] Snapshots filter location undecided.** Moot — no Snapshots filter.
- **[Testing, critical] Lineage test mis-anchored.** Named `getEvolutionRunLineageAction` + its existing
  `evolutionVisualizationActions.test.ts` block and specified the `.eq('variant_kind','article')`
  mock-chain assertion.
- **[Security, minor] Legacy-NULL variant_kind.** Documented as impossible (NOT NULL DEFAULT 'article'
  CHECK) in the Rollback Plan; added a unit assertion that the default path filters article-only.
- **[Security, minor] strategyId path coverage + server-side narrowing.** The `.eq('variant_kind', vk)`
  applies to both query branches; added a defensive enum-narrowing of `variantKind` server-side and a
  unit assertion on the strategyId path.
- **[Testing, minor] Rollback + E2E flakiness + reuse fixture.** Added a Rollback Plan, concrete E2E
  flakiness approach, `-g @evolution` CI grep, and adopted `createParagraphRecombineFixture` reuse.

### Iteration 2 (Security 5/5, Architecture 5/5, Testing 5/5) — CONSENSUS REACHED
All three reviewers verified the iteration-1 resolutions against source and scored 5/5 with zero critical
gaps. Minor polish folded in: (a) Phase-2 edge guard preserves the `parentIndex` field (multi-parent
dashed-edge styling); (b) integration vs E2E `createTestVariant` helpers disambiguated by absolute path;
(c) E2E spec navigates by `runId` (not `invocationId`) and lives in the repo-root e2e tree; (d) added
`test.describe.configure({ mode:'serial' })` reminder (rule 13); (e) Snapshots integration guard asserts
on the pool/discarded id arrays. Optional non-blocking nit left for the executor: reuse
`listVariantsAction`'s existing `z.enum([...]).default('article')` instead of hand-rolling the narrowing.

**Plan is ready for execution.**
