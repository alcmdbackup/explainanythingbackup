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
7. **Legacy robustness** — for paragraph rewrites with empty `parent_variant_ids` (pre-migration `20260529000001`), resolve the original paragraph via the fallback query `prompt_id + agent_name='paragraph_original' + variant_kind='paragraph'`, independent of lineage. There is no DB unique constraint on `(prompt_id, agent_name, variant_kind)`, so the action uses `.order('created_at').limit(1)` (take the earliest) and treats a missing row as parentless.
8. **Component approach** — add a **new standalone `SideBySideWordDiff`** component (reuses `diffWordsWithSpace` + the existing `TextDiff` status-color tokens / `data-testid` conventions). Do **NOT** add a `mode` prop to `TextDiff` — that keeps existing consumers (`InvocationParentBlock`, `VariantLineageSection` pair-picker) byte-for-byte unchanged.
9. **Exposing `variant_kind`** on `VariantFullDetail` is **additive** (existing consumers destructure named fields; no exhaustiveness checks), so it is low-risk; null/legacy `variant_kind` is treated as `'article'`.
10. **Rollback** — read-only feature: no migrations, no schema/data changes, no CI workflow changes. Rollback = revert the single PR.

## Options Considered
_Decision record (not a task list) — the chosen option is marked; alternatives are documented rationale._
- ✅ **Dedicated "Diff vs parent" tab (CHOSEN)** — discoverable, deep-linkable (`?tab=diff`), uniform for both kinds, clean empty state for parentless. (Decision 1.)
- ❌ **Inline panel on Content tab** — always visible but clutters article content; mixes "this variant" with "vs parent".
- ⏸️ **CriticMarkup engine (`markdownASTdiff`)** — sentence/AST-aware, better paragraph diffs, but heavier (MDAST/remark, ESM) and the existing read-only renderer (`AnnotatedProposals`) carries accept/reject semantics. Deferred as a possible future upgrade.
- ⏸️ **Per-paragraph isolation for recombined article variants (Scenario B)** — deferred; duplicates `RecombinedOutputTab` and adds alignment risk.

## Phased Execution Plan

### Phase 1: Data layer — expose variant_kind + a parent-diff action
- [x] Add `variantKind: 'article' | 'paragraph'` to `VariantFullDetail` and map it in `getVariantFullDetailAction` (already pulled via `select('*')`, just unmapped) — needed so the header `VariantParentBadge` can pick the right `noParentLabel` and the Diff tab can choose article-vs-paragraph framing. (`evolution/src/services/variantDetailActions.ts`)
- [x] Add `getVariantParentDiffAction(variantId)` (mirrors `getInvocationVariantContextAction`; same `adminAction` + `ActionResult<T>` convention). Returns:
  ```ts
  interface VariantParentDiff {
    variantId: string;
    variantKind: 'article' | 'paragraph';
    variantContent: string;
    parent: { id: string; content: string; elo: number | null; uncertainty: number | null; runId: string | null } | null;
    crossRun: boolean;            // parent.runId !== variant.runId (drives the "other run" pill; parentRunId = parent.runId)
    slotContext: { paragraphNumber: number } | null;  // paragraph variants only
  }
  ```
  Resolution rules:
  - Fetch variant (`id, run_id, variant_kind, prompt_id, parent_variant_ids, variant_content`); treat null `variant_kind` as `'article'`.
  - Primary parent = `parent_variant_ids[0]`; fetch parent in one follow-up query selecting exactly `id, variant_content, elo_score, mu, sigma, run_id` (the existing `getVariantFullDetailAction` parent sub-query omits `variant_content` — the new action MUST include it).
  - **Paragraph fallback**: if `variant_kind='paragraph'` and `parent_variant_ids` is empty, resolve the original paragraph via `evolution_variants WHERE prompt_id=<prompt_id> AND agent_name='paragraph_original' AND variant_kind='paragraph'` with `.order('created_at').limit(1)` (no DB uniqueness guarantee — take earliest). A paragraph rewrite whose own `id` equals the resolved original (i.e. the variant IS the original-slot) → parentless.
  - **slotContext**: if `variant_kind='paragraph'`, read `evolution_prompts.prompt` for `prompt_id` and parse via a new helper `parseSlotParagraphNumber(promptName): number | null` (regex `^\[para\] .*\.P(\d+)$`; validate `N >= 1`). If unparseable/missing → `slotContext: null` (omit the header, don't error).
  - Parentless (empty lineage + no original found, or the variant is itself a seed/original) → `parent: null`.
  - Errors: variant-not-found, parent-deleted, prompt-row-missing all degrade to `parent: null` / `slotContext: null` (never throw); cross-run parent read is fine under the service-role `adminAction` client (RLS bypassed).
- [x] Add `parseSlotParagraphNumber(prompt: string | null): number | null` helper to `evolution/src/lib/shared/paragraphLabels.ts` (inverse of `formatSlotTopicName`): `const m = prompt?.match(/^\[para\] .+\.P(\d+)$/); return m ? Math.max(1, parseInt(m[1],10)) : null;` — returns `null` (never throws) on missing/malformed input. Colocated unit test.
- [x] Unit test the action — all 6 scenarios: (1) article with parent text, (2) paragraph rewrite via `parent_variant_ids[0]`, (3) paragraph rewrite via prompt_id fallback (empty lineage), (4) parentless seed article, (5) parentless original-slot paragraph, (6) cross-run parent (assert `crossRun=true`). (`evolution/src/services/variantDetailActions.test.ts`)

### Phase 2: UI — side-by-side diff tab
- [x] Add a **new** `SideBySideWordDiff` component (Parent left / Variant right) at `evolution/src/components/evolution/visualizations/SideBySideWordDiff.tsx`, reusing `diffWordsWithSpace` and the existing `TextDiff` status-color tokens + `data-testid` conventions. **Do not** add a mode to `TextDiff` (keeps `InvocationParentBlock` + `VariantLineageSection` consumers unchanged, per Decision 8). Reuse the `previewLength`/expand UX so long article columns stay scrollable. New `data-testid`s (e.g. `sxs-diff`, `sxs-parent`, `sxs-variant`) + colocated unit test.
- [x] Add a `VariantParentDiffTab` (tab body): calls `getVariantParentDiffAction` in a `useEffect` (same pattern as `VariantLineageSection`); renders `SideBySideWordDiff` when `parent` present; renders the explicit empty state (`variant_kind='paragraph'` → "Original paragraph — source paragraph, no parent to diff."; else "Seed · no parent") when `parent` is null; shows the "Paragraph N" header when `slotContext` present; shows the cross-run pill when `crossRun` (parentRunId = `parent.runId`).
- [x] Wire `{ id: 'diff', label: 'Diff vs parent' }` into the `TABS` array in `VariantDetailContent.tsx`; render `VariantParentDiffTab` for it. (`TABS` is defined before `useTabState`, so `?tab=diff` deep-linking works automatically; no `legacyTabMap` entry needed for a brand-new id.)
- [x] In `VariantDetailContent.tsx`, branch the header `VariantParentBadge` `noParentLabel` on `variant.variantKind` ('Original paragraph' for paragraph, else default 'Seed · no parent') — requires `variantKind` from Phase 1.

### Phase 3: Tests + docs
- [x] **Patch `createParagraphRecombineFixture`** (`src/__tests__/e2e/helpers/evolution-test-data-factory.ts`): the rewrite insert (~lines 917-930) currently omits `parent_variant_ids` (defaults to `[]`), so it only exercises the legacy fallback. Set `parent_variant_ids: [originalVariantId]` on rewrites to match post-`20260529000001` production AND add an option `legacyEmptyLineage?: boolean` (default false) to also seed the empty-lineage case. The original-slot variant is already parentless by construction, covering the parentless-original-slot scenario (point the detail page at `originalVariantId`).
- [x] Update `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx`: add a `getByRole('tab', { name: 'Diff vs parent' })` assertion (currently asserts only Content/Metrics/Lineage at lines 70-72), and add `getVariantParentDiffAction: jest.fn().mockResolvedValue({ success: true, data: null })` to the `@evolution/services/variantDetailActions` mock block (lines 13-17). Add `variantKind` to the `mockVariant` fixture. (Note: `VariantDetailContent` receives `variant` as a prop from the server component `page.tsx` — it does NOT call `getVariantFullDetailAction` itself, so no mock for that is needed; only the new `VariantParentDiffTab` fetches via `getVariantParentDiffAction`.)
- [x] E2E spec coverage (see Testing).
- [x] Update relevant docs (see Documentation Updates).

## Testing

### Unit Tests
- [x] `evolution/src/services/variantDetailActions.test.ts` — `getVariantParentDiffAction` across all 6 scenarios (article, paragraph-via-parent, paragraph-via-prompt-fallback, parentless seed, parentless original-slot, cross-run); `getVariantFullDetailAction` now returns `variantKind`.
- [x] `evolution/src/components/evolution/visualizations/SideBySideWordDiff.test.tsx` (or `TextDiff.test.tsx`) — two-column render, left=removed/right=added, unchanged in both, empty-input handling.
- [x] `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` — new tab present; empty-state rendered when parent null.

### Integration Tests
- [x] `src/__tests__/integration/variant-parent-diff.integration.test.ts` — real-DB test seeding an article variant + parent and a paragraph rewrite + original-slot, asserting `getVariantParentDiffAction` returns the parent text (article) and the prompt_id fallback recovers the original paragraph for empty-lineage rewrites. (2/2 pass.)

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-variant-diff-tab.spec.ts` (new) — tagged **`@evolution`** (admin/evolution page, not user-facing → not in the `@critical` PR gate per testing_overview.md). `test.describe.configure({ mode: 'serial' })` (shared `beforeAll` fixtures). Using `createMultiHopFixture` + `createParagraphRecombineFixture`:
  - Article variant → deep-link `?tab=diff` → side-by-side diff vs parent visible (target `sxs-diff`/`sxs-parent`/`sxs-variant`), Parent left / Variant right.
  - Paragraph rewrite via `parent_variant_ids[0]` (reach via the variants list **Kind filter = paragraph**; call the page's `resetFilters()` POM helper after `goto` then set Kind=paragraph, with a hydration wait on a data-dependent row before asserting — testing_overview.md Rules 1 + 18) → isolated paragraph diff + "Paragraph N" header. The new `SideBySideWordDiff` uses its OWN `data-testid`s (`sxs-diff`/`sxs-parent`/`sxs-variant`); `TextDiff`'s testids are untouched.
  - Paragraph rewrite seeded with `legacyEmptyLineage: true` → diff still renders (fallback path).
  - Seed article + original-slot paragraph → explicit empty-state message (no diff).
  - `beforeAll` seed + `afterAll` FK-safe cleanup via the fixtures' `cleanup()` (`flakiness/require-test-cleanup`); follow `admin-evolution-paragraph-recombine.spec.ts` precedent. Wait on data-dependent elements before interacting (`flakiness/require-hydration-wait`).

### Manual Verification
- [x] On local server, open an article variant, a paragraph rewrite, a seed, and an original-slot variant; confirm each renders correctly. (Covered by the E2E spec run against the live dev server — 5/5 passed.)

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-variant-diff-tab.spec.ts` against the local server via `ensure-server.sh`. (5/5 passed during /finalize.)

### B) Automated Tests
- [x] `npm run test:unit -- variantDetailActions`
- [x] `npm run test:unit -- VariantDetailContent`
- [x] `npm run test:unit -- SideBySideWordDiff` (or TextDiff)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/variant_lineage.md` — document the new "Diff vs parent" tab + paragraph-variant handling + the prompt_id fallback for empty lineage.
- [x] `evolution/docs/visualization.md` — update the `/admin/evolution/variants/[variantId]` detail-page description (new tab; side-by-side word diff; `variant_kind` now exposed).
- [x] `evolution/docs/paragraph_recombine.md` — note how a paragraph variant's "diff vs parent" surfaces the isolated original paragraph on the variant detail page.
- [x] `evolution/docs/arena.md` — reviewed; no change needed (no leaderboard/link change).
- [x] `evolution/docs/data_model.md` — reviewed; no change needed (read-only feature, no schema change).

## Review & Discussion

`/plan-review` reached **5/5 consensus** across all three perspectives (Security & Technical, Architecture & Integration, Testing & CI/CD) after 3 iterations.

| Perspective | Iter 1 | Iter 2 | Iter 3 |
|---|---|---|---|
| Security & Technical | 2 | 5 | 5 |
| Architecture & Integration | 3 | 5 | 5 |
| Testing & CI/CD | 2 | 1* | 5 |

\* The iteration-2 Testing 1/5 was a category error — the reviewer scored implementation status ("the action/component/tests don't exist yet") rather than plan quality; its own reasoning stated the test plan was "complete and correct." Re-run with sharper framing confirmed 5/5.

**Gaps fixed across iterations:**
- Committed to a **new standalone `SideBySideWordDiff`** component (no `mode` prop on `TextDiff`) so existing consumers (`InvocationParentBlock`, `VariantLineageSection`) stay untouched.
- Specified the new action MUST fetch parent `variant_content` (the existing `getVariantFullDetailAction` parent sub-query omits it); concrete select column list added.
- Added explicit error-degradation rules (variant-not-found / parent-deleted / prompt-missing → `parent: null`/`slotContext: null`, never throw).
- `paragraph_original` fallback uses `.order('created_at').limit(1)` (no DB uniqueness); null `variant_kind` → `'article'`.
- New `parseSlotParagraphNumber` helper (regex + range validation, returns null on malformed) colocated in `paragraphLabels.ts`.
- Fixture patch: `createParagraphRecombineFixture` to set `parent_variant_ids:[originalVariantId]` on rewrites + a `legacyEmptyLineage?` option; original-slot variant already parentless (covers that scenario).
- Existing-test update made explicit (`VariantDetailContent.test.tsx` tab assertion + `getVariantParentDiffAction` mock + `variantKind` in `mockVariant`).
- E2E: `@evolution` tag, serial mode, `resetFilters()` POM + hydration wait, FK-safe cleanup; distinct `sxs-*` testids.
- Rollback statement added (read-only feature → revert PR).

Confirmed safe by reviewers: XSS not a risk (`TextDiff` renders text as React string children in `<pre>`, no `dangerouslySetInnerHTML`); cross-run parent reads fine under the service-role `adminAction` client; no schema/migration/CI changes.
</content>
