# Enable Side-By-Side Variant Comparisons vs Parent Progress

## Phase 1: Confirm current behavior (article + paragraph)
### Work Done
Ran `/research` as 5 rounds × 4 Explore agents (20 agents) per user request, focused on paragraph-vs-paragraph diff isolating the relevant parent paragraph. Findings written to the research doc. Verified end-to-end (code, not docs):
- Variant detail page (`VariantDetailContent.tsx`): 4 tabs, data from `getVariantFullDetailAction`; does NOT expose `variant_kind`/`prompt_id`; parent sub-query omits `variant_content`.
- Paragraph slot-rewrite lineage = `[originalSlot, rewrite]`; original-slot `variant_content` IS the isolated parent paragraph → Lineage tab already shows the paragraph diff.
- Precedent: `getInvocationVariantContextAction` returns `{variantContent, parentContent}` + `InvocationParentBlock` renders `TextDiff` (the pattern to mirror, variantId-keyed).
- Robust legacy fallback: original paragraph via `prompt_id + agent_name='paragraph_original'`.
- `agent_invocation_id` NULL on slot variants, populated on recombined article variants (limits slot→parent-article context).
- Article-level recombined paragraphs align 1:1 with parent via `extractParagraphsWithRanges` (caveat: `\n\n` injection can break alignment).

### Issues Encountered
- Minor cross-agent discrepancy on whether the variants list has a Kind filter — resolved by reading `variants/page.tsx` directly (Kind dropdown exists, default `'article'`).
- Confirmed slot variants lack `agent_invocation_id`, so parent-article id/title for a slot variant is not cheaply queryable (only via execution_detail on the article variant, or a JSONB scan).

### User Clarifications
Open questions captured in the research doc (placement/tab, inline vs side-by-side, markdown raw vs rendered, Scenario B scope, original-slot handling, slot-context breadcrumb cost, `\n\n` alignment guard) — to resolve during planning/`/plan-review`.

## Phase 1: Data layer
### Work Done
- `parseSlotParagraphNumber` helper added to `evolution/src/lib/shared/paragraphLabels.ts` (inverse of `formatSlotTopicName`, returns null on malformed) + 3 colocated tests.
- `variantKind` exposed on `VariantFullDetail` and mapped in `getVariantFullDetailAction` (null/legacy → 'article').
- `getVariantParentDiffAction(variantId)` + `VariantParentDiff` interface added: resolves primary parent (`parent_variant_ids[0]`), paragraph `prompt_id → paragraph_original` fallback for legacy empty lineage, `slotContext.paragraphNumber`, `crossRun`, graceful degradation (null parent never throws). 8 unit tests covering all 6 scenarios + invalid-id + not-found.

## Phase 2: UI (side-by-side diff tab)
### Work Done
- `SideBySideWordDiff` component (standalone; reuses `diffWordsWithSpace`; Parent left / Variant right; `sxs-*` testids) + 4 tests.
- `VariantParentDiffTab` (fetches the action; diff / empty-state / Paragraph-N header / cross-run pill) + 5 tests.
- Wired `{ id: 'diff', label: 'Diff vs parent' }` into `VariantDetailContent` TABS; branched header `VariantParentBadge` `noParentLabel` on `variantKind`. Updated `VariantDetailContent.test.tsx` (new tab assertion + mock + `variantKind`).

## Phase 3: Fixture + E2E + docs
### Work Done
- Patched `createParagraphRecombineFixture`: sets `parent_variant_ids:[originalSlotVariantId]` on rewrites, added `legacyEmptyLineage?` option, exposed `originalSlotVariantIds`.
- New E2E spec `admin-evolution-variant-diff-tab.spec.ts` (`@evolution`, serial, fixture cleanup): article diff, paragraph rewrite diff + Paragraph-N, legacy empty-lineage fallback, original-slot empty state, seed empty state.
- Updated `evolution/docs/{variant_lineage,visualization,paragraph_recombine}.md`.

### Verification
- Full suite green: `npm run lint` (no new errors), `tsc -p tsconfig.ci.json` (0), `npm run build` (success), unit tests (59 pass across 5 suites), `check:stale-specs` (clean). E2E spec authored; to be run on the live server during local review / `/finalize`.
