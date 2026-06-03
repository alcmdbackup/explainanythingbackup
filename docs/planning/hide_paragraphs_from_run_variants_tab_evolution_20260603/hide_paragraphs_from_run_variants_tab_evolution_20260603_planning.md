# Hide Paragraphs From Run Variants Tab Evolution Plan

## Background
recent recents showing paragraphs in variants tab

## Requirements (from GH Issue #NNN)
Recent runs have been showing paragraph rewrites in run variants tab. Please filter them out

## Problem
`ParagraphRecombineAgent` persists per-slot rewrites as `evolution_variants` rows with
`variant_kind='paragraph'`. The standalone `/admin/evolution/variants` list already hides these by
default (article-only via `NON_DISCARDED_OR_FILTER` + Kind dropdown), but the run-detail (and
strategy-detail) **Variants tab** (`VariantsTab.tsx`) does not, so paragraph snippets leak into the
run's Variants tab. We want the run Variants tab to default to article-only, with paragraph variants
filtered out (optionally still reachable via a Kind toggle for parity with the standalone list).

## Options Considered
- [ ] **Option A: Default the VariantsTab query to article-only**: have the run/strategy
  Variants tab apply the same article-only default the standalone list uses
  (`variant_kind != 'paragraph'` / `NON_DISCARDED_OR_FILTER`), reusing the existing filter helper so
  behavior is consistent. (Likely recommended — smallest, matches existing convention.)
- [ ] **Option B: Add a Kind dropdown to the VariantsTab**: port the full Kind dropdown
  (Articles only / Paragraph snippets / Both) from the standalone list so users can opt back in.
- [ ] **Option C: Filter at the server action layer**: exclude `variant_kind='paragraph'` in the
  action that backs the run Variants tab (e.g. `listVariantsAction` / run-scoped variant fetch),
  defaulting article-only. (Verify whether tab and list share an action.)

## Phased Execution Plan

### Phase 1: Locate the exact source of the leak
- [ ] Confirm which component/action backs the run-detail Variants tab (`VariantsTab.tsx`) and the
  strategy-detail Variants tab, and how it differs from `/admin/evolution/variants/page.tsx`.
- [ ] Confirm the standalone list's article-only mechanism (`NON_DISCARDED_OR_FILTER`,
  `isDiscardedGenerateVariant`, Kind dropdown) and identify the reusable filter helper.

### Phase 2: Apply the article-only default to the run/strategy Variants tab
- [ ] Make `VariantsTab.tsx` (and its backing action) default to article-only, reusing the existing
  `variant_kind`-aware filter rather than a blanket `persisted=true` (which would wrongly hide
  paragraph variants as "discarded" — they are always `persisted=false` by design).
- [ ] Decide per Options A/B whether to also expose a Kind toggle; keep parity with the standalone list.

## Testing

### Unit Tests
- [ ] Unit test for the filter helper / VariantsTab query builder — asserts paragraph-kind variants
  are excluded by default and (if added) included when the Kind toggle selects them.

### Integration Tests
- [ ] Integration test (if the run-scoped variant action is server-side) seeding an article variant
  + a `variant_kind='paragraph'` variant on a run and asserting only the article is returned by default.

### E2E Tests
- [ ] E2E spec under `src/__tests__/e2e/specs/09-admin/` (likely extend
  `admin-evolution-variants.spec.ts`): seed a run with a paragraph variant, open the run Variants tab,
  assert paragraph snippets are not shown by default.

### Manual Verification
- [ ] Open a recent run that used `paragraph_recombine` in the admin UI; confirm the Variants tab
  shows only article variants.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run the run-detail Variants tab E2E spec on the local server (via ensure-server.sh).

### B) Automated Tests
- [ ] `npm run test:unit -- <variants-tab/filter test>`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/visualization.md` — VariantsTab now defaults to article-only (document the
  run/strategy Variants tab filter behavior alongside the standalone list).
- [ ] `evolution/docs/paragraph_recombine.md` — note run Variants tab hides paragraph snippets by default.
- [ ] `evolution/docs/variant_lineage.md` — if the `NON_DISCARDED_OR_FILTER` usage extends to the tab.
- [ ] `evolution/docs/data_model.md` — only if `variant_kind` filtering semantics change.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
