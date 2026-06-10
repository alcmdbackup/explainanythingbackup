# Investigate Banner On Paragraph Rewrite Paragraph Variant Plan

## Background
Variant id `af33e26d-fb87-479f-86b1-4593a9cd340a` and many other paragraph variants on invocation id `1bc65fd0-d6fa-4d13-8afb-93cc1510a82a` show this banner: "This variant was discarded by its owning generate agent (local Elo below the top-15% cutoff at budget exhaustion). It is not included in run-level metrics."

## Requirements (from GH Issue #1156)
same as summary

## Problem
The "discarded variant" banner is gated solely on `variant.persisted === false` with hardcoded generate-agent text. Paragraph-recombine variants (`variant_kind='paragraph'`) are persisted via the `sync_to_arena` RPC, which never sets `persisted`; the column defaults to `false`, so **100% of paragraph variants (758/758 on staging) are `persisted=false`** and wrongly show the banner. Confirmed on staging (variant `af33e26d…` = paragraph/false; invocation `1bc65fd0…` = `paragraph_recombine`). Five UI surfaces mistreat these variants as discarded generate variants (the variant-detail banner, VariantsTab, LineageGraph, SnapshotsTab, and the global Variants list page — the 5th added in plan-review).

## Decision (confirmed with user)
- **Cosmetic, `variant_kind`-aware UI-only fix.** No DB write, no `sync_to_arena` change, no backfill.
- **Suppress-only** on the variant detail page (hide the generate-agent banner for paragraph variants; show nothing special).
- **All five surfaces** made `variant_kind`-aware (banner, VariantsTab, LineageGraph, SnapshotsTab, global Variants list page).
- Leave `persisted` semantics for `variant_kind='paragraph'` as "n/a" (document it).

## Options Considered
- [x] **Option A (CHOSEN): `variant_kind`-aware UI suppression across all surfaces.** Treat the "discarded" semantics as applying only to `variant_kind==='article'`. Pure display/query logic; no migration; zero metrics risk.
- [ ] **Option B (rejected): set `persisted=true` for paragraph variants via `sync_to_arena` RPC + backfill 758 rows.** Bigger blast radius (RPC migration + backfill) and risks polluting article-scale run-Elo metrics that filter `persisted=true`.
- [ ] **Option C (rejected): banner-only fix.** Leaves VariantsTab ✗ column + default-hide, LineageGraph dimming, and SnapshotsTab still wrong.

## Guiding principle
A variant is a "discarded generate variant" only when `persisted === false && variantKind === 'article'`. Introduce one tiny shared predicate and apply it at every CLIENT surface (re-use over duplication). Forward-safe: any future non-article kind defaults to "not discarded."

Key facts that pin the design (verified against code, raised in plan-review iteration 1):
- **`variant_kind` is `TEXT NOT NULL DEFAULT 'article'`** with `CHECK IN ('article','paragraph')` (migration `20260527000001`). There are **no NULL `variant_kind` rows** — legacy/article rows are `'article'`. So `variant_kind.neq.article` reliably means paragraph, and the server filter needs no NULL handling. (The client predicate stays defensive anyway.)
- **Two encodings of "discarded" exist and must stay in sync:** (1) the TS predicate used by client surfaces, and (2) a PostgREST filter **string** used by the two server-side list actions (these cannot import the JS predicate). Co-locate both in one module with a test asserting they agree.
- The predicate must be applied **after** each call site's existing `persisted ?? true` legacy-default normalization (variantDetailActions:173, evolutionActions:498, evolutionVisualizationActions:271, LineageTab:60, SnapshotsTab:43), so a legacy `undefined` is treated identically everywhere.
- **No `src/lib/database.types.ts` update needed:** `AdminContext.supabase` is a bare `SupabaseClient` (no `<Database>` generic), so added `.select('variant_kind')` strings and `variant.variant_kind` access are not schema-type-checked and won't break tsc.

### Single source of truth (file to create)
`evolution/src/lib/utils/variantStatus.ts` (alongside `evolutionUrls.ts`/`formatters.ts`; no `'use server'`/`'use client'`, no server-only deps, so both server actions and client components can import it):
- `export const isDiscardedGenerateVariant = (persisted: boolean | undefined, variantKind: string | undefined) => persisted === false && variantKind === 'article';`
- `export const NON_DISCARDED_OR_FILTER = 'persisted.eq.true,variant_kind.neq.article';` — the canonical PostgREST `.or(...)` string for "not an article discard."
- Co-located `variantStatus.test.ts` asserts the predicate and the filter string encode the same rule.

## Phased Execution Plan

### Phase 1: Thread `variant_kind` through the four data layers (no behavior change)
- [x] `evolution/src/services/variantDetailActions.ts` — add `variantKind?: string` to `VariantFullDetail` (~18-56); the query already selects `*`, so add `variantKind: variant.variant_kind` to the return mapping (~150-176).
- [x] `evolution/src/services/evolutionActions.ts` (`getEvolutionVariantsAction`) — add `variant_kind` to `baseFields` SELECT (~525) and add `variant_kind?: string` to the `EvolutionVariant` type (~47-77).
- [x] `evolution/src/services/evolutionVisualizationActions.ts` (`getEvolutionRunLineageAction`) — add `variant_kind` to SELECT (~246-250), `variantKind?: string` to `LineageNode` (~43-58) + `LineageData['nodes']` (~62-75), and map it in the return (~254-272).
- [x] `evolution/src/services/evolutionActions.ts` (`getRunSnapshotsAction`) — add `variant_kind` to SELECT (~493-496), `variantKind?: string` to `SnapshotVariantInfo` (~451-455), and map it (~497-499).
- [x] `evolution/src/services/evolutionActions.ts` (`listVariantsAction`, ~713-844) — **5th surface (added in review)**: add `variant_kind` to its SELECT and `variant_kind?: string` to its returned row type, so the global Variants list page can render kind-aware.
- [x] Create `evolution/src/lib/utils/variantStatus.ts` with `isDiscardedGenerateVariant` + `NON_DISCARDED_OR_FILTER` (see Guiding principle) and `variantStatus.test.ts`.

### Phase 2: Apply `variant_kind`-aware gating at the four UI surfaces
- [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx:111` — change gate to `isDiscardedGenerateVariant(variant.persisted, variant.variantKind)` (paragraph → no banner).
- [x] `evolution/src/components/evolution/tabs/VariantsTab.tsx:248-254` — show ✗ only for `isDiscardedGenerateVariant(...)`; paragraph variants render ✓ (surfaced).
- [x] `evolution/src/services/evolutionActions.ts` (`getEvolutionVariantsAction` filter ~535-538) — when `!includeDiscarded`, hide only **article** discards, not paragraph variants. **Use `query.or(NON_DISCARDED_OR_FILTER)` (i.e. `'persisted.eq.true,variant_kind.neq.article'`).** Do NOT use `.not('and(...)')` — `@supabase/postgrest-js` types `.not(column, operator, value)` with 3 args, so a single-string `.not('and(...)')` is a tsc/build error; the `.or(...)` embedded-boolean form is valid and already used in the repo (watchdog.ts:31, critiqueContext.ts:36-44). Paragraph variants visible by default.
- [x] `evolution/src/services/evolutionActions.ts` (`listVariantsAction` default filter ~738-741) — **5th surface (added in review)**: same fix. Today it applies `.eq('persisted', true)` by default, so when a user picks the existing 'Paragraph snippets' / 'Both' Kind filter on the global Variants page (`src/app/admin/evolution/variants/page.tsx:30-39`), all 758 paragraph variants are filtered out and the list silently shows EMPTY. Replace with `query.or(NON_DISCARDED_OR_FILTER)`. **Note:** this `.or(...)` is **ANDed with** the pre-existing `.eq('variant_kind', parsed.variantKind)` filter (~743-744) — they compose correctly (Kind='paragraph' → all paragraph rows; default Kind='article' → still excludes the 89 article discards). The integration test must assert the `.or(...)` is **added alongside** the existing kind `.eq`, not that it replaces it.
- [x] `src/app/admin/evolution/variants/page.tsx` — **no per-row persisted/✗ column exists on this page** (verified), so there is no per-row styling to gate; the fix is purely that `listVariantsAction` now returns paragraph rows. Threading `variant_kind` into the `listVariantsAction` row type is what the page consumes (optional/forward-use); the SELECT add is harmless. No gating change needed in `page.tsx` itself.
- [x] `evolution/src/components/evolution/visualizations/LineageGraph.tsx:144-152` + `LineageTab.tsx` graphNodes mapping (~52-61, carry `variantKind`) — dim/dash only when `isDiscardedGenerateVariant(d.persisted, d.variantKind)`.
- [x] `evolution/src/components/evolution/tabs/SnapshotsTab.tsx:81-87` + `buildRows` (~38-44, carry `variantKind`) — ✗ only for article discards. (Discarded-section ~190-231 already shows only article generate discards — no change.)

### Phase 3: Tests
(see Testing section)

### Phase 4: Docs + verification
(see Documentation Updates + Verification)

## Testing

### Unit / Component Tests
- [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` — article+`persisted=false` → `variant-discarded-banner` present; paragraph+`persisted=false` → banner absent.
- [x] `evolution/src/components/evolution/tabs/VariantsTab.test.tsx` — paragraph+`persisted=false` → ✓ (not ✗); article+`persisted=false` → still ✗; paragraph variants present when `includeDiscarded=false`.
- [x] **LineageGraph styling is NOT assertable in RTL** — `LineageGraph.test.tsx` runs against a fully mocked d3 (`src/testing/mocks/d3.ts`, `.attr()` is a no-op `jest.fn().mockReturnThis()`); fill-opacity/stroke-dasharray never reach the DOM (the suite already punts visual checks to Playwright). Instead: (a) unit-test the `LineageTab` graphNodes mapping (`LineageTab.tsx:52-61`) asserting `variantKind` is carried onto each node; visual dim/dash difference is covered by manual/Playwright (Verification A).
- [x] `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx` — assert the data mapping (`buildRows` carries `variantKind`) drives ✓ for paragraph+`persisted=false`, and article discards still show ✗ / appear in the discarded section.
- [x] `evolution/src/lib/utils/variantStatus.test.ts` — unit-test `isDiscardedGenerateVariant` (article/persisted=false → true; paragraph/persisted=false → false; persisted=true → false; undefined cases) AND assert `NON_DISCARDED_OR_FILTER` encodes the same rule as the predicate. Make the sync assertion **meaningful, not brittle**: derive expected rows from the predicate over a small fixture set and assert the parsed `.or` filter would keep exactly the non-(article-discard) rows — don't just string-compare two constants that could drift together.

### Integration Tests
- [x] `getEvolutionVariantsAction` AND `listVariantsAction` default filter — `evolutionActions.test.ts` mocks the Supabase chain (no real PostgREST evaluation), so the achievable automated guarantee is: **assert `.or(...)` was called with exactly `NON_DISCARDED_OR_FILTER`** (`'persisted.eq.true,variant_kind.neq.article'`) when `!includeDiscarded`, and not `.eq('persisted', true)`. The real query *behavior* (paragraph rows returned, article discards excluded) is **not** provable in unit tests and is covered by manual staging verification below — that manual step is therefore load-bearing, not optional.

### E2E Tests
- [ ] Optional: extend an evolution admin spec to assert the banner is absent on a paragraph variant detail page (only if local fixtures can seed a paragraph variant; otherwise rely on component tests + manual).

### Manual Verification (LOAD-BEARING — the only proof of real query behavior; bug is staging-only)
- [ ] Staging variant `af33e26d-…` (`/admin/evolution/variants/af33e26d-fb87-479f-86b1-4593a9cd340a`): banner gone.
- [ ] Staging global Variants list (`/admin/evolution/variants`) with Kind filter = paragraph/Both: paragraph variants now appear (not an empty list), rendered without ✗/discarded styling.
- [ ] A run's VariantsTab + LineageGraph + SnapshotsTab on staging: paragraph variants show ✓ / normal node styling; article discards still show ✗ / dimmed-dashed.
- [ ] Deploy path: this is preview/staging-deployed UI; verify on the staging deployment (or a Vercel preview pointed at staging data) since local has no paragraph/persisted=false fixtures.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Component/RTL tests above cover the gating; run targeted Playwright/admin check on a paragraph variant page via `ensure-server.sh` if local data permits.

### B) Automated Tests
- [x] `npm run test -- VariantDetailContent VariantsTab LineageGraph SnapshotsTab` (+ predicate test), then full `lint`/`typecheck`/`build` per CLAUDE.md after each code block.

## Documentation Updates
- [x] `evolution/docs/visualization.md` — banner/`persisted` UI semantics are article-only; paragraph variants are not "discarded."
- [x] `evolution/docs/data_model.md` — note `persisted` is meaningful only for `variant_kind='article'`; paragraph variants are always `persisted=false` (and `agent_invocation_id=NULL`) by design of `sync_to_arena`.
- [x] `evolution/docs/paragraph_recombine.md` — UI treats paragraph variants as surfaced regardless of `persisted`.

## CI & Rollback
- **No CI workflow / migration changes.** No `supabase/migrations/**` touched, so `migration:verify` and the high-blast PR gate do not apply; this stays on the standard reactive lint + tsc + build + unit gate. Per CLAUDE.md, run `lint`/`typecheck`/`build`/unit after each code block.
- **Rollback:** UI/query-only and trivially revertible — revert the PR; no data migration to undo (we never wrote `persisted`).

## Out of scope (note for follow-up)
- Paragraph variants having `agent_invocation_id = NULL` (attribution gap) — separate from the banner; not fixed here.
- Any change to `sync_to_arena` / `persisted` storage semantics (explicitly rejected as Option B).
- **Metrics query filters are intentionally NOT touched:** `recomputeMetrics.ts:157` & `:278` and `experimentMetrics.ts:346` keep `.eq('persisted', true)`, so paragraph variants stay excluded from run-level metrics. This is deliberate (UI-only decision; paragraph-scale Elo must not pollute article-scale run metrics) — see research Open Questions #3. Flagged here so it isn't mistaken for a missed surface.

## Review & Discussion

### /plan-review — CONSENSUS reached after 2 iterations (all 5/5)

**Iteration 1** — Security 4/5, Architecture 3/5, Testing 3/5. Critical gaps fixed:
1. *(Security)* Plan offered an invalid `.not('and(...)')` PostgREST filter (3-arg `.not` → tsc/build error). → Pinned the valid `.or('persisted.eq.true,variant_kind.neq.article')` form (`NON_DISCARDED_OR_FILTER`), already used in-repo.
2. *(Architecture)* Missed 5th surface: `listVariantsAction` + global Variants page (`page.tsx`) default `.eq('persisted', true)` → empty list when the existing paragraph/Both Kind filter is selected. → Added to Phase 1/2 + manual verification.
3. *(Testing)* LineageGraph visual assertion impossible under mocked d3. → Redirected to a `LineageTab` graphNodes mapping unit test; visuals via Playwright/manual.
4. *(Testing)* Default-filter behavior unprovable against a mocked Supabase chain. → Assert the exact `.or(...)` filter-string arg; made manual staging verification explicitly load-bearing.

**Iteration 2** — Security 5/5, Architecture 5/5, Testing 5/5, no critical gaps. All fixes re-verified against code. Minor clarity nits folded in: the `listVariantsAction` `.or` ANDs with the pre-existing `variant_kind` `.eq`; `page.tsx` has no per-row persisted column (no gating no-op); metrics `.eq('persisted', true)` filters intentionally untouched (cross-referenced); the predicate↔filter sync test must be derive-based, not a brittle string compare.

**Status: ready for execution.**
