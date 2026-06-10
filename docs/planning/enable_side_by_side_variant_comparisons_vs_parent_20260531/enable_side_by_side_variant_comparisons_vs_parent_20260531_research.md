# Enable Side-By-Side Variant Comparisons vs Parent Research

## Problem Statement
The variant detail view should allow a simple way to view the diff between a variant and its parent variant, both for explanation-level (article) variants and paragraph-level variants (which are created specifically by paragraph recombine). Specific focus from the user: enable a **paragraph-vs-paragraph diff that isolates only the relevant paragraph in the parent** (not the whole parent article).

## Requirements (from GH Issue #1157)
Variant detail view should allow simple way to view diff between a variant and its parent variant, both for explanation level and paragraph level variants (which are created specifically by paragraph recombine).

(Description: same as summary.)

## High Level Summary
Research ran as **5 rounds × 4 Explore agents (20 total)**, each round building on and adversarially verifying the previous.

**The headline finding: the data model already isolates the relevant parent paragraph for free.** A paragraph slot-**rewrite** variant (`variant_kind='paragraph'`) has `parent_variant_ids[0] = originalSlotVariantId`, and that original-slot variant's `variant_content` **is exactly the isolated single paragraph** extracted (trimmed) from the parent article at recombine time (`upsertSlotTopic(...slot.originalText)` → `variant_content`). So:
- `get_variant_full_chain(rewriteId)` returns a 2-node chain `[originalSlotVariant, rewriteVariant]`.
- The existing **Lineage tab** (`VariantLineageSection`) already renders a `TextDiff(original.content → rewrite.content)` between those two nodes — i.e. a **paragraph-vs-paragraph diff already exists today**, just buried in the Lineage tab's chain/pair-picker and not surfaced as a simple "diff vs parent" affordance.

So the feature is mostly a **surfacing + robustness** job, not new diff math. The gaps:
1. **Discoverability** — no simple top-level "diff vs parent" on the variant detail page; it's only inside the Lineage tab.
2. **`variant_kind` is not exposed** to the client by `getVariantFullDetailAction` (selected via `*` but never mapped), so the UI can't branch article-vs-paragraph or label the parent correctly.
3. **No parent text in the variant action** — `getVariantFullDetailAction`'s parent sub-query fetches only `mu,sigma,elo_score,run_id`, NOT `variant_content`. A simple diff needs the parent's full text in one call (the precedent `getInvocationVariantContextAction` already does this for the invocation page).
4. **Legacy paragraph rewrites** (persisted before migration `20260529000001`) have empty `parent_variant_ids`, so the lineage chain returns only the rewrite node (no parent). A robust fallback exists: query `evolution_variants WHERE prompt_id=<rewrite.prompt_id> AND agent_name='paragraph_original' AND variant_kind='paragraph'` (1:1 per slot topic) — independent of `parent_variant_ids`.
5. **Article-level recombined variants** can additionally support a *per-paragraph isolated* diff (align parent↔child paragraphs 1:1 via `extractParagraphsWithRanges`), but with alignment caveats.

### The two diff scenarios
- **Scenario A — paragraph-level variant detail (the user's core ask):** "diff vs parent" = rewrite paragraph vs its original paragraph. The parent IS the isolated paragraph. Already works via lineage; needs simple surfacing + the prompt_id fallback for legacy rows + correct "Original paragraph" labeling for the parentless original-slot variant.
- **Scenario B — article variant detail (incl. recombined article):** "diff vs parent" = whole-article diff (already feasible). For a recombined article, an *optional* richer view isolates each changed paragraph and diffs it against the corresponding parent paragraph (1:1 index alignment).

## Documents Read
### Core Workflow Docs
- docs/docs_overall/getting_started.md, architecture.md, project_workflow.md
### Core Operations Docs
- docs/docs_overall/environments.md, testing_overview.md; docs/feature_deep_dives/testing_setup.md; docs/docs_overall/debugging.md
### Relevant Docs (all 21 evolution docs)
- evolution/docs/{README, variant_lineage, paragraph_recombine, arena, data_model, architecture, visualization, reference, rating_and_comparison, agents/overview, entities, multi_iteration_strategies, strategies_and_experiments, metrics, editing_agents, criteria_agents, cost_optimization, evolution_metrics, logging, curriculum, minicomputer_deployment}.md
  - Most load-bearing: **variant_lineage.md** (parent_variant_ids, get_variant_full_chain, TextDiff/VariantLineageSection), **paragraph_recombine.md** (slot topics, original-slot variant, sync_to_arena persistence), **visualization.md** (variant detail page + SlotsTab/RecombinedOutputTab), **data_model.md** (variant_kind, parent_variant_ids).

## Code Files Read
**UI**
- `src/app/admin/evolution/variants/[variantId]/page.tsx` — calls `getVariantFullDetailAction(variantId)`, passes `variant` to client component.
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — TABS = Content / Metrics / Matches / Lineage (lines 15-20). Header has MetricGrid + `VariantParentBadge`. No `variant_kind` branching. Parent text not available here.
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.test.tsx` — mocks `variantDetailActions` + `metricsActions`; asserts tabs via `getByRole('tab', …)`; `mockVariant: VariantFullDetail`.
- `evolution/src/components/evolution/visualizations/TextDiff.tsx` — props `{original, modified, previewLength=300}`; word-level `diffWordsWithSpace` (`diff@^8.0.2`); renders **raw markdown** in `<pre>`; Before/After/Diff tabs; data-testids `text-diff`, `tab-before|after|diff`, `diff-content`, `expand-toggle`. Reusable standalone.
- `evolution/src/components/evolution/variant/VariantLineageSection.tsx` — full chain cards w/ inline `TextDiff(parent→node)`; "Compare any two in this chain" From/To pair picker (default From=root, To=leaf); children list. Data via `getVariantFullChainAction` + `getVariantChildrenAction`.
- `evolution/src/components/evolution/variant/VariantParentBadge.tsx` — props incl. `noParentLabel` (comment: paragraph leaderboards pass `'Original paragraph'`), `crossRun`/`parentRunId` ("other run" pill), `additionalParentIds` ("+N more" for debate). Parentless → `noParentLabel ?? 'Seed · no parent'`.
- `evolution/src/components/evolution/tabs/InvocationParentBlock.tsx` — **the precedent**: renders collapsed `TextDiff(parentContent → variantContent, previewLength=500)` (data-testid `invocation-parent-text-diff`); only when both texts present; no paragraph special-casing.
- `evolution/src/components/evolution/tabs/SlotsTab.tsx` — master-detail per slot; shows `slot.originalText` preview + winner Elo/Δ; embeds `ArenaLeaderboardTable`. **No TextDiff.**
- `evolution/src/components/evolution/tabs/RecombinedOutputTab.tsx` — per-paragraph color coding (cyan = rewrite chosen, reading `slot.ranking.winnerIsOriginal`); parent toggle currently `parentText={null}` (disabled); maps rendered block→slot via "nth non-heading block" heuristic (`isHeadingBlock = /^#{1,6}\s/`). **No TextDiff.**

**Services / data**
- `evolution/src/services/variantDetailActions.ts` — `getVariantFullDetailAction`: main `.select('*, evolution_agent_invocations(id, agent_name)')`; **parent sub-query selects only `mu, sigma, elo_score, run_id`** (NO variant_content). `VariantFullDetail` (lines 18-56) has NO `variantKind`/`promptId`/`parentVariantContent`. `getVariantFullChainAction` → RPC `get_variant_full_chain`, returns `variant_content` per node but NO `variant_kind`.
- `evolution/src/services/invocationActions.ts` — `getInvocationVariantContextAction(invocationId)` keys off `agent_invocation_id`; two-query: variant (`id,run_id,elo_score,mu,sigma,parent_variant_ids,variant_content`) then parent by `parent_variant_ids[0]` (`elo_score,mu,sigma,run_id,variant_content`). `InvocationVariantContext` includes `variantContent` + `parentContent`. **Template for the new action.**
- `evolution/src/services/adminAction.ts` — `adminAction<I,T>(name, handler)`; `ActionResult<T> = {success, data: T|null, error}` (from `shared.ts`); service-role client (RLS bypassed).
- `evolution/src/services/slotTopicActions.ts` — `upsertSlotTopic` creates the original-slot variant: `{prompt_id: topicId, variant_content: originalSlotText, agent_name:'paragraph_original', variant_kind:'paragraph', synced_to_arena:true}` — **no agent_invocation_id**, parentless. 1:1 lookup pattern `prompt_id + agent_name='paragraph_original' + variant_kind='paragraph'`.
- `evolution/src/lib/shared/paragraphSlots.ts` — `extractParagraphsWithRanges` (pure; skips empty, code-block, heading-`#`, horizontal-rule, emphasis-only, label `:` blocks; `paragraphIndex` = content-paragraph index) + `assembleRecombinedArticle` (right-to-left byte-range splice; preserves paragraph count/order).
- `evolution/src/lib/shared/paragraphLabels.ts` — `formatSlotTopicName(parentId, slotIndex)` → `[para] V<8charPrefix>.P<slotIndex+1>`. **No reverse parser.**
- `evolution/src/lib/schemas.ts` — `slotRecombineExecutionDetailSchema`: `parentVariantId`, `slots[]{slotIndex, originalText, originalSlotVariantId, slotTopicId, rewrites[], ranking{winnerSlotVariantId, winnerIsOriginal, winnerSource}}`. (Winner TEXT is NOT stored — only ids; text lives in `recombined.text`.)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `finalizeRun` sets `agent_invocation_id: v.agentInvocationId ?? null` for article variants; `syncToArena` `newEntries` payload for slot rewrites omits `agent_invocation_id`.
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` — recombined article variant created with `agentInvocationId: ctx.invocationId` (line ~368); slot rewrites created without it.

**Migrations**
- `supabase/migrations/20260508000006_evolution_variants_lineage_walker_array.sql` — `get_variant_full_chain` walks `parent_variant_ids[1]` (PG 1-indexed = `[0]`), cycle-guarded, 20-hop cap, root-first. Empty array → only the target node returned.
- `supabase/migrations/20260529000001_sync_to_arena_persist_parent_and_match_count.sql` — writes `parent_variant_ids`/`match_count` for slot rewrites on INSERT only (ON CONFLICT untouched). Pre-this-migration slot rewrites have empty lineage.
- `supabase/migrations/20260527000001/000002/000003` — `variant_kind`/`prompt_kind` columns, paragraph topic unique index, sync_to_arena paragraph extension.

**Tests**
- `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` — `createMultiHopFixture` (4-node article chain with `parent_variant_ids` set) + `createParagraphRecombineFixture` (slot topics `prompt_kind='paragraph'`, original `agent_name='paragraph_original'`, rewrites `agent_name='paragraph_rewrite'`, all `variant_kind='paragraph'`, linked by `prompt_id`).
- E2E: `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` (list→detail nav, deep-link), `admin-evolution-variant-lineage-tab.spec.ts` (`?tab=lineage`), `admin-evolution-paragraph-recombine.spec.ts` (fixture + cleanup). `flakiness/require-test-cleanup` ESLint + `afterAll` FK-safe deletion.

## Key Findings
1. **Paragraph-vs-paragraph diff already exists in the data model.** Rewrite's `parent_variant_ids[0]` = original-slot variant; its `variant_content` IS the isolated parent paragraph (trimmed). `get_variant_full_chain(rewriteId)` = `[original, rewrite]`; the Lineage tab already `TextDiff`s them. The feature is primarily about **surfacing this simply** + edge-case robustness.
2. **`getInvocationVariantContextAction` is the exact precedent** — returns `{variantContent, parentContent}` (parent's full text) in one call and renders a collapsed `TextDiff`. We need the **variantId-keyed analogue** (new `getVariantParentDiffAction(variantId)` OR extend `getVariantFullDetailAction`).
3. **`getVariantFullDetailAction` gaps:** doesn't return `variant_kind`, `prompt_id`, or parent `variant_content` (parent sub-query omits it). All are needed for a kind-aware "diff vs parent."
4. **Legacy fallback is robust & simple:** original paragraph is recoverable via `prompt_id + agent_name='paragraph_original'` (1:1), independent of `parent_variant_ids` — handles pre-`20260529000001` empty-lineage rows where the chain has no parent node.
5. **agent_invocation_id is NULL on ALL slot variants** (original + rewrite), but **populated on recombined ARTICLE variants.** Consequence: `execution_detail` (with `parentVariantId` + `slots[].slotIndex`) is reachable from a recombined-article variant detail page, but **NOT** from a slot-variant detail page via FK. Slot→parent-article context is therefore expensive (JSONB scan) — see Open Questions.
6. **Slot/paragraph number** is reliably derivable from the slot topic prompt name `[para] V8abc.P3` (P-number = slotIndex+1) via `prompt_id → evolution_prompts.prompt`. The **8-char parent prefix is NOT unique** (collision risk) — do not resolve the parent article id from it; use `execution_detail.parentVariantId` (only available on the article variant).
7. **Article-level per-paragraph isolation (Scenario B):** parent↔recombined paragraphs align 1:1 (byte-splice preserves count/order). `extractParagraphsWithRanges` is pure/importable and can run on both at view time. **Caveat (verified):** it skips heading/code/HR/emphasis/label blocks, and a rewrite that injects a new `\n\n` would split a block and break index alignment — `validateParagraphRewrite` does NOT currently reject injected `\n\n`. The recombined article variant has `agent_invocation_id`, so `execution_detail.slots[].originalText` + `winnerIsOriginal` are also available (winner *text* is not stored — extract from `recombined.text`).
8. **Edge cases (all code-verified):** parentless seed → `'Seed · no parent'`; parentless original-slot → `'Original paragraph'` (no diff); multi-parent debate → diff vs `parent_variant_ids[0]` + "+N more" chip; cross-run parent → "other run" pill (service-role client reads it fine); legacy empty-lineage paragraph rewrite → prompt_id fallback.
9. **Reachability:** the variants list (`/admin/evolution/variants`) has a **Kind dropdown defaulting to `'article'`** (paragraph snippets hidden by default); rows deep-link to `/admin/evolution/variants/[id]`. (One older E2E spec lacks a Kind filter assertion — the page component is authoritative: the filter exists.)
10. **TextDiff renders raw markdown** word-level in a monospace `<pre>` with char-based `previewLength` truncation (300 default; 500 in the invocation precedent). data-testids are ready for E2E.
11. **Tests are ready:** fixtures for both article chains and paragraph slot sets exist; `VariantDetailContent.test.tsx` mock pattern supports asserting a new panel/tab; adding a tab requires updating tab-role assertions.

## Open Questions (for planning / to confirm with user)
1. **Placement of the affordance:** new top-level **"Diff vs parent" tab** on the variant detail (recommended, discoverable) vs inline on the Content tab vs default view. (Lineage tab pair-picker can stay as the power-user path.)
2. **Diff presentation:** TextDiff already offers Before/After/Diff tabs (inline word-level). Is inline acceptable, or is true **side-by-side** (the issue title says "side-by-side") wanted? May need a side-by-side mode/variant of TextDiff.
3. **Markdown:** raw-markdown diff (current TextDiff) acceptable, or render markdown first? (Paragraph snippets make raw markup more visible.)
4. **Scope of Scenario B (article per-paragraph isolation):** Do article variants (esp. recombined) get the richer per-paragraph isolated diff, or is whole-article diff enough and paragraph isolation is reserved for paragraph-kind variants only? (The user's emphasis — "isolate the relevant paragraph only in the parent" — is fully satisfied for paragraph-kind variants by Finding #1; Scenario B is an optional extension.)
5. **Original-slot variant detail:** confirm it should **hide** the diff (it's the parent; no rewrite to compare) — likely show "Original paragraph" context only.
6. **Slot context breadcrumb** ("Paragraph 3 of article <title>"): the paragraph **number** is cheap (parse prompt name); the **parent-article link/title** is expensive for slot variants (agent_invocation_id NULL → JSONB scan). Decide whether to (a) show just "Paragraph N" cheaply, (b) backfill `agent_invocation_id` on slot variants to make it cheap, or (c) skip the article link.
7. **`\n\n`-injection alignment risk** for Scenario B: do we add a `validateParagraphRewrite` guard, or always re-extract on the recombined text and tolerate occasional drift?
</content>
