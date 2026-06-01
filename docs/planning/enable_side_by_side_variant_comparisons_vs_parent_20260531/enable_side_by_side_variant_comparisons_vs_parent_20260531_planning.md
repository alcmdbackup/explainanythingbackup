# Enable Side-By-Side Variant Comparisons vs Parent Plan

## Background
The variant detail view should allow a simple way to view the diff between a variant and its parent variant, both for explanation-level (article) variants and paragraph-level variants (which are created specifically by paragraph recombine). User emphasis: a paragraph-vs-paragraph diff that isolates only the relevant paragraph in the parent.

## Requirements (from GH Issue #1157)
Variant detail view should allow simple way to view diff between a variant and its parent variant, both for explanation level and paragraph level variants (which are created specifically by paragraph recombine).

(Description: same as summary.)

## Problem
A parent↔child diff already exists but is buried in the **Lineage** tab (collapsed per-hop diffs + a "compare any two" pair-picker) and isn't a simple, discoverable affordance. `getVariantFullDetailAction` does not expose `variant_kind` and its parent sub-query doesn't fetch the parent's `variant_content`, so the page can't render a kind-aware "diff vs parent" out of the box. For paragraph-level variants the data model already isolates the relevant parent paragraph (a rewrite's primary parent is the original-slot variant whose `variant_content` IS the single parent paragraph), so the work is mostly **surfacing + robustness**, not new diff math.

## Design Decisions (resolved with user, 2026-05-31)
1. **Placement** — a dedicated, **always-present** top-level tab **"Diff vs parent"** on `VariantDetailContent` (alongside Content / Metrics / Matches / Lineage). The Lineage pair-picker stays as the power-user path.
2. **Engine/notation** — **word-level** diff via the existing `diff` lib (`diffWordsWithSpace`), rendered as **colored insertion/deletion spans over raw markdown**. NOT CriticMarkup (deferred; `markdownASTdiff` is a viable future upgrade).
3. **Layout** — **true side-by-side**, **Parent (left) / Variant (right)**, fixed (no swap toggle). Left column highlights removed (in A, not B); right column highlights added (in B, not A); unchanged shown in both. One symmetric diff covers both A→B and B→A directions.
4. **Scope** — **article variants → whole-article side-by-side diff** vs the parent article; **paragraph variants → isolated paragraph-vs-paragraph diff** vs the original-slot paragraph. NO per-paragraph breakdown for recombined article variants in this project (so the `\n\n`-alignment risk does not apply).
5. **Parentless variants** — tab is always present; render an explicit empty state: `variant_kind='article'` → "Seed · no parent"; `variant_kind='paragraph'` (original-slot) → "Original paragraph — source paragraph, no parent to diff."
6. **Slot context (paragraph variants)** — show a cheap **"Paragraph N"** header (parsed from the slot topic name `[para] V8abc.P<N>`); **no** parent-article link (slot variants lack `agent_invocation_id`; reliable resolution would need a JSONB scan — out of scope).
7. **Legacy robustness** — for paragraph rewrites with empty `parent_variant_ids` (pre-migration `20260529000001`), resolve the original paragraph via the fallback query `prompt_id + agent_name='paragraph_original' + variant_kind='paragraph'` (1:1 per slot topic), independent of lineage.

## Options Considered
- [x] **Dedicated "Diff vs parent" tab (CHOSEN)** — discoverable, deep-linkable (`?tab=diff`), uniform for both kinds, clean empty state for parentless. (Decision 1.)
- [ ] **Inline panel on Content tab** — always visible but clutters article content; mixes "this variant" with "vs parent".
- [ ] **CriticMarkup engine (`markdownASTdiff`)** — sentence/AST-aware, better paragraph diffs, but heavier (MDAST/remark, ESM) and the existing read-only renderer (`AnnotatedProposals`) carries accept/reject semantics. Deferred as a possible future upgrade.
- [ ] **Per-paragraph isolation for recombined article variants (Scenario B)** — deferred; duplicates `RecombinedOutputTab` and adds alignment risk.

## Phased Execution Plan

### Phase 1: Data layer — expose variant_kind + a parent-diff action
- [ ] Add `variantKind: 'article' | 'paragraph'` to `VariantFullDetail` and map it in `getVariantFullDetailAction` (already pulled via `select('*')`, just unmapped) — needed so the header `VariantParentBadge` can pick the right `noParentLabel` and the Diff tab can choose article-vs-paragraph framing. (`evolution/src/services/variantDetailActions.ts`)
- [ ] Add `getVariantParentDiffAction(variantId)` (mirrors `getInvocationVariantContextAction`; same `adminAction` + `ActionResult<T>` convention). Returns:
  ```ts
  interface VariantParentDiff {
    variantId: string;
    variantKind: 'article' | 'paragraph';
    variantContent: string;
    parent: { id: string; content: string; elo: number | null; uncertainty: number | null; runId: string | null } | null;
    crossRun: boolean;            // parent.runId !== variant.runId
    slotContext: { paragraphNumber: number } | null;  // paragraph variants only
  }
  ```
  Resolution rules:
  - Fetch variant (`id, run_id, variant_kind, prompt_id, parent_variant_ids, variant_content`).
  - Primary parent = `parent_variant_ids[0]`; fetch parent `variant_content` (+ rating, run_id) in one follow-up query.
  - **Paragraph fallback**: if `variant_kind='paragraph'` and `parent_variant_ids` is empty, resolve the original paragraph via `evolution_variants WHERE prompt_id=<prompt_id> AND agent_name='paragraph_original' AND variant_kind='paragraph'`.
  - **slotContext**: if `variant_kind='paragraph'`, read `evolution_prompts.prompt` for `prompt_id`, parse `…P<N>` → `paragraphNumber = N`.
  - Parentless → `parent: null`.
- [ ] Unit test the action: article (parent text), paragraph rewrite via `parent_variant_ids[0]`, paragraph rewrite via prompt_id fallback (empty lineage), parentless seed, parentless original-slot, cross-run parent. (`evolution/src/services/variantDetailActions.test.ts`)

### Phase 2: UI — side-by-side diff tab
- [ ] Add a side-by-side word-diff renderer (Parent left / Variant right) reusing `diffWordsWithSpace` and the existing status color tokens + `data-testid` conventions from `TextDiff`. Either a new `SideBySideWordDiff` component or a `mode="side-by-side"` on `TextDiff`; do not disturb existing `TextDiff` consumers. (`evolution/src/components/evolution/visualizations/`)
- [ ] Add a `VariantParentDiffTab` (tab body): calls `getVariantParentDiffAction` in a `useEffect` (same pattern as `VariantLineageSection`); renders the side-by-side diff when `parent` present; renders the explicit empty state when `parent` is null; shows the "Paragraph N" header for paragraph variants; shows the cross-run pill when `crossRun`.
- [ ] Wire `{ id: 'diff', label: 'Diff vs parent' }` into the `TABS` array in `VariantDetailContent.tsx`; render `VariantParentDiffTab` for it.
- [ ] Update the header `VariantParentBadge` usage to pass `noParentLabel` based on `variant.variantKind` ('Original paragraph' for paragraph, else default 'Seed · no parent').

### Phase 3: Tests + docs
- [ ] Update `VariantDetailContent.test.tsx` tab-role assertions to include the new "Diff vs parent" tab; mock `getVariantParentDiffAction`.
- [ ] E2E spec coverage (see Testing).
- [ ] Update relevant docs (see Documentation Updates).

## Testing

### Unit Tests
- [ ] `evolution/src/services/variantDetailActions.test.ts` — `getVariantParentDiffAction` across all 6 scenarios (article, paragraph-via-parent, paragraph-via-prompt-fallback, parentless seed, parentless original-slot, cross-run); `getVariantFullDetailAction` now returns `variantKind`.
- [ ] `evolution/src/components/evolution/visualizations/SideBySideWordDiff.test.tsx` (or `TextDiff.test.tsx`) — two-column render, left=removed/right=added, unchanged in both, empty-input handling.
- [ ] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` — new tab present; empty-state rendered when parent null.

### Integration Tests
- [ ] (Optional) real-DB test seeding an article variant + parent and a paragraph rewrite + original-slot, asserting `getVariantParentDiffAction` returns both texts and the prompt_id fallback works for empty lineage.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-variant-diff-tab.spec.ts` (new) — using `createMultiHopFixture` + `createParagraphRecombineFixture`:
  - Article variant → open `?tab=diff` → side-by-side diff vs parent visible (`data-testid` targets), Parent left / Variant right.
  - Paragraph rewrite (reach via Kind filter = paragraph, or deep-link) → isolated paragraph diff + "Paragraph N" header.
  - Seed article + original-slot → explicit empty-state message.
  - `afterAll` FK-safe cleanup (`flakiness/require-test-cleanup`).

### Manual Verification
- [ ] On local server, open an article variant, a paragraph rewrite, a seed, and an original-slot variant; confirm each renders correctly.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-variant-diff-tab.spec.ts` against the local server via `ensure-server.sh`.

### B) Automated Tests
- [ ] `npm run test:unit -- variantDetailActions`
- [ ] `npm run test:unit -- VariantDetailContent`
- [ ] `npm run test:unit -- SideBySideWordDiff` (or TextDiff)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/variant_lineage.md` — document the new "Diff vs parent" tab + paragraph-variant handling + the prompt_id fallback for empty lineage.
- [ ] `evolution/docs/visualization.md` — update the `/admin/evolution/variants/[variantId]` detail-page description (new tab; side-by-side word diff; `variant_kind` now exposed).
- [ ] `evolution/docs/paragraph_recombine.md` — note how a paragraph variant's "diff vs parent" surfaces the isolated original paragraph on the variant detail page.
- [ ] `evolution/docs/arena.md` — only if leaderboard/links change (not expected).
- [ ] `evolution/docs/data_model.md` — only if any schema change is needed (none expected — read-only feature).

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
</content>
