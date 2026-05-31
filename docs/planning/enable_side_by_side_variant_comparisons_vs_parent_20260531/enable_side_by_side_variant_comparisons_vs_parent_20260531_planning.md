# Enable Side-By-Side Variant Comparisons vs Parent Plan

## Background
The variant detail view should allow a simple way to view the diff between a variant and its parent variant, both for explanation-level (article) variants and paragraph-level variants (which are created specifically by paragraph recombine).

## Requirements (from GH Issue #1153)
Variant detail view should allow simple way to view diff between a variant and its parent variant, both for explanation level and paragraph level variants (which are created specifically by paragraph recombine).

(Description: same as summary.)

## Problem
A parent↔child text diff already exists, but only inside the Lineage tab's "Compare any two in this chain" pair-picker for article variants — it is not a simple, discoverable affordance on the variant detail page. Paragraph-level variants (`variant_kind='paragraph'`, produced by paragraph recombine) have a different lineage shape (`parent_variant_ids = [originalSlotVariantId]`) and are default-hidden in the variants list, so it is unclear whether their detail page exposes a usable "vs parent" diff at all. The goal is one consistent, low-friction "diff vs parent" view that works for both variant kinds.

## Options Considered
- [ ] **Option A: Top-level "Diff vs parent" panel on variant detail**: Add a dedicated panel/tab on `VariantDetailContent.tsx` that renders `TextDiff(parent.text → this.text)` using the primary parent, reusing the existing `TextDiff` component and `getVariantFullChainAction` (or a smaller targeted action). Works uniformly once paragraph parents resolve.
- [ ] **Option B: Promote the existing lineage pair-picker**: Default the lineage pair-picker's From/To to (primary parent, this variant) and surface it more prominently — minimal new code but keeps it on the Lineage tab.
- [ ] **Option C: Reuse paragraph SlotsTab/RecombinedOutputTab diff path for paragraph variants** and Option A for article variants — two code paths, more surface area.

## Phased Execution Plan

### Phase 1: Confirm current behavior (article + paragraph)
- [ ] Read `VariantDetailContent.tsx`, `VariantLineageSection.tsx`, `TextDiff.tsx`, `variantDetailActions.ts` end-to-end.
- [ ] Verify what the variant detail page currently renders for a `variant_kind='paragraph'` variant (does it resolve parent, does TextDiff work).
- [ ] Confirm primary-parent resolution: `parent_variant_ids[0]` (app) / `[1]` (PG 1-indexed) and the parentless-original case for paragraph slots.

### Phase 2: Parent-diff data path
- [ ] Add/confirm a server action that returns `{ thisText, parentText, parentMeta }` for a variant (reuse `getVariantFullChainAction` or add a focused `getVariantParentDiffAction`), handling `variant_kind='paragraph'` lineage and the "no parent" (seed/original) case.

### Phase 3: UI affordance
- [ ] Add a simple, discoverable "Diff vs parent" panel/tab to `VariantDetailContent.tsx` reusing `TextDiff` + `VariantParentBadge`, rendering an explicit empty-state when the variant has no parent (seed / original paragraph).
- [ ] Ensure paragraph-kind variant detail pages reach this affordance (verify the variants list deep-links to paragraph variant detail).

## Testing

### Unit Tests
- [ ] `evolution/src/services/variantDetailActions.test.ts` — parent-diff action resolves primary parent for article + paragraph variants and returns a no-parent signal for seed/original.

### Integration Tests
- [ ] (TBD) Real-DB test seeding an article variant + parent and a paragraph rewrite + original-slot parent, asserting the action returns both texts.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` (or existing variants spec) — open an article variant detail, see diff vs parent; open a paragraph variant detail, see diff vs original-slot parent; open a seed/original, see no-parent empty state.

### Manual Verification
- [ ] Manually open article + paragraph variant detail pages on local server and confirm the diff renders.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run the variants E2E spec on the local server via `ensure-server.sh` / `npm run test:e2e`.

### B) Automated Tests
- [ ] `npm run test:unit -- variantDetailActions`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/variant_lineage.md` — document the new "diff vs parent" affordance + paragraph-variant handling.
- [ ] `evolution/docs/visualization.md` — update the `/admin/evolution/variants/[variantId]` detail-page description (new panel/tab).
- [ ] `evolution/docs/paragraph_recombine.md` — note how paragraph variant diffs surface on the variant detail page.
- [ ] `evolution/docs/arena.md` — only if leaderboard/links change.
- [ ] `evolution/docs/data_model.md` — only if any schema/RPC change is needed.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
