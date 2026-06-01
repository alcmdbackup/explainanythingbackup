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

## Phase 2: Parent-diff data path
### Work Done

## Phase 3: UI affordance
### Work Done
