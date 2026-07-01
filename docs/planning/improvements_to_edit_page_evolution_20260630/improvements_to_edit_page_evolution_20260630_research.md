<!-- Research findings for the improvements_to_edit_page_evolution_20260630 project: UX + functional improvements to the public-facing /edit article editor (the build_website_for_evolutiOn surface). -->

# Improvements to Edit Page Evolution Research

## Problem Statement
improvements to edit article external facing page

## Requirements (from GH Issue #1325)
- Focus on new variant in final result
- Show diff in a separate tab, not side by side
- Critique the UX and how to make it better
- Enable all non-test strategies available otherwise. For debugging purposes, let me quickly click to view the strategy detail view including the config, from the dropdown.

## High Level Summary

The public `/edit` surface ships its result-viewing phase via `SideBySideWordDiff` (two-column mono `<pre>`) inside `EditRunViewer.tsx`. The new variant gets **equal visual weight** with the original — it's never rendered standalone. The strategy picker is a **radio-card list** (not a dropdown — brief clarification needed), powered by `listPublicStrategiesAction`, which filters on `public_visible=true AND status='active' AND is_test_content=false`. Currently only one mock seed strategy (`Public Edit Smoke`) is `public_visible=true` on staging/prod, so the picker is effectively empty for real users. The admin strategy detail page is hostname-404'd on the public host, so any debug "view config" affordance must surface IN PLACE on `/edit`. A reusable `<StrategyConfigDisplay />` primitive already exists and is client-safe.

**Key constraint:** Three independent enforcement points lock the $0.10/run cap (per-strategy `budgetUsd` gate, per-run `budget_cap_usd` insert, `submitPublicEditAction` whitelist re-check). Broadening the public-strategies filter requires lockstep updates to BOTH `listPublicStrategiesAction` AND the re-verify in `submitPublicEditAction:132-145`.

**Notable gaps to flag:**
- shadcn `tabs.tsx` is NOT installed (would need `npx shadcn add tabs` or reuse `EntityDetailTabs` from `evolution/`)
- No markdown renderer on `/edit` — diff renders mono `<pre>`. A "focus on new variant" tab that wants prose-formatted output is a new render path
- No `EditPage.ts` POM helper — specs use raw `getByTestId` calls
- The current picker is a **radio-card list, not a dropdown** — the brief's "click strategy in dropdown" needs reconciliation

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
- docs/docs_overall/design_style_guide.md — Midnight Scholar token system (`atlas-*` / `scholar-card` / `paper-texture` / `rounded-book`, gold/copper accents, Playfair/Source Serif/DM Sans). Same tokens used on public and admin pages → `EntityDetailTabs` drops in cleanly to `/edit`.

### Relevant Docs (tracked in _status.json)
- evolution/docs/architecture.md — Entry Point #5 (`submitPublicEditAction` + 3s polling + result via `SideBySideWordDiff`)
- evolution/docs/strategies_and_experiments.md — `listPublicStrategiesAction`, `public_visible` gate, $0.10 budget cap rule
- evolution/docs/visualization.md — admin strategy detail page, `EntityDetailTabs`, `DispatchPlanView` (overkill for /edit), `StrategyConfigDisplay` referenced
- docs/feature_deep_dives/state_management.md — `editPageLifecycleReducer` phases (`idle | submitting | queued | running | viewing | error`), `viewing` carries text by value
- docs/feature_deep_dives/llm_spending_gate.md — layered cap stack (per-run $0.10 / per-IP $0.50 / per-region $5 / guest-user $10 / global $25 evo / kill switch); fail-CLOSED
- docs/feature_deep_dives/markdown_ast_diffing.md — `RenderCriticMarkupFromMDAstDiff` (heavyweight AST diff, only used in debug pages)
- evolution/docs/variant_lineage.md — `SideBySideWordDiff` shared by variant detail "Diff vs parent" tab; same component
- evolution/docs/editing_agents.md — `iterative_editing` strategy (one of many we'd surface if filter widens)
- evolution/docs/paragraph_recombine.md — another strategy we'd surface
- docs/feature_deep_dives/lexical_editor_plugins.md — Lexical editor + DiffTagNode (in-editor accept/reject diff UI)

### Additional evolution docs read for context (not tracked for update)
- evolution/docs/README.md, arena.md, cost_optimization.md, criteria_agents.md, curriculum.md, data_model.md, entities.md, evolution_metrics.md, implicit_rubric_weights.md, logging.md, metrics.md, minicomputer_deployment.md, multi_iteration_strategies.md, paragraph_recombine_with_coherence_pass.md, prompt_editor.md, rating_and_comparison.md, reference.md, agents/overview.md

## Code Files Read (via 4 parallel Explore agents)

### /edit page result rendering
- `src/app/edit/page.tsx` (71 lines) — server entry; fetches public strategies; PUBLIC_EDIT_DISABLED env gate; force-dynamic
- `src/app/edit/EditForm.tsx` (148 lines) — picker is **radio-card list** at lines 57–96 (`data-testid="strategy-picker"`); inline state, no separate picker component. Plumbs `generationModel`/`judgeModel`/`iterationCount` via prop but **doesn't render them** (dead data on the wire today)
- `src/app/edit/runs/[runId]/page.tsx` (61 lines) — noindex/nofollow + Referrer-Policy meta; delegates to client `<EditRunViewer />`
- `src/app/edit/runs/[runId]/EditRunViewer.tsx` (201 lines) — phase-switch owner. Imports `SideBySideWordDiff` at line 16. Viewing JSX at **lines 173–198**: small "Finished in {Xs}" card → `<SideBySideWordDiff parent={originalContent} variant={winnerVariantContent} leftLabel="Your text" rightLabel="Evolved" />` → "Edit something else" CTA. Pending UI at 152–171, error UI at 135–150.
- `src/reducers/editPageLifecycleReducer.ts` (124 lines) — viewing state shape at lines 21–28: `{ runId, originalContent, winnerVariantContent, strategyLabel, durationMs }`. `strategyLabel` exists in contract but is unused (passed `''` today). Tab refactor needs no reducer change.
- `src/app/edit/publicEditActions.ts` (353 lines) — `submitPublicEditAction` (103–281), `getEditRunStatusAction` (288–352). Returns shape includes `originalContent` + `winnerVariantContent` by value (no variant id). `PER_RUN_BUDGET_CAP_USD = 0.10` (line 30) set on every insert (line 260). Whitelist re-check at 132–145.
- `evolution/src/components/evolution/visualizations/SideBySideWordDiff.tsx` (88 lines) — single symmetric `diffWordsWithSpace`; left = unchanged + removed (red strikethrough), right = unchanged + added (green); both columns `font-mono whitespace-pre-wrap max-h-[500px]`; truncates at 600 chars/column with "Show full" toggle. Test IDs: `sxs-diff`/`sxs-parent`/`sxs-variant`/`sxs-expand-toggle`. **No variant-only render mode** — the right column always carries diff highlighting.

### Strategy picker + listPublicStrategiesAction
- `evolution/src/services/strategyRegistryActions.ts` (note: docs call this `…V2.ts`, but the file is **without** the V2 suffix — doc drift)
  - `listPublicStrategiesAction` 499–545: filter at 510–513, returns `PublicStrategySummary` (475–483: id/name/label/description/generationModel/judgeModel/iterationCount — no `config`, even though the SELECT pulls it)
  - 60s in-memory cache: `PUBLIC_STRATEGIES_CACHE_TTL_MS = 60_000` (485–504), invalidated by `updateStrategyAction` only when `publicVisible` changes (341–343)
  - `PUBLIC_VISIBLE_BUDGET_CAP_USD = 0.10` constant at 122; guard at 304–322 throws `PUBLIC_VISIBLE_BUDGET_TOO_HIGH` if `budgetUsd > 0.10`
- `src/app/admin/evolution/strategies/PublicVisibleToggle.tsx` — admin toggle UI; client-side guard mirrors server; optimistic with sonner toast revert
- `evolution/src/services/shared.ts` — `isTestContentName` (36–47) + `TIMESTAMP_NAME_PATTERN` (31); anti-drift fixtures at 52–75
- `supabase/migrations/20260415000001_evolution_is_test_content.sql` — `evolution_is_test_name()` Postgres function + BEFORE trigger
- `supabase/migrations/20260623000002_evolution_is_test_name_revert_timestamp_broadening.sql` — canonical predicate; matches `test`/`[TEST]`/`[E2E]`/`[TEST_EVO]`/`[TESTEVO]` + `^.*-\d{10,13}-.*$`
- `supabase/migrations/20260627000003_evolution_strategies_public_visible.sql` — `public_visible BOOLEAN NOT NULL DEFAULT false` + partial index
- `evolution/scripts/seedPublicEditE2EStrategy.ts` — only script that flips `public_visible=true` (the mock `Public Edit Smoke` row)

### Existing strategy detail surfaces
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` (179 lines) — tab list at 61–72; Configuration tab body at 161–173 renders `<StrategyConfigDisplay config={...} />`. Whole page `'use client'`. Data via admin-gated `getStrategyDetailAction` (`strategyRegistryActions.ts:162-177`)
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` (223 lines) — **the reuse target**. Pure client-safe component; type-only schema imports; renders Models/Execution/Generation Guidance/Iterations table/Agents cards; `showRaw` prop dumps `JSON.stringify(config, null, 2)`. Already imported by ExperimentForm too.
- `evolution/src/components/evolution/DispatchPlanView.tsx` (297 lines) — needs `IterationPlanEntryClient[]` (output of `projectDispatchPlan()`), NOT raw config. Wrapper action `getStrategyDispatchPreviewAction` (`strategyPreviewActions.ts:274-309`) is admin-gated. **Wrong fit for /edit.**
- `src/middleware.ts` — host gate at 54–77; unauthed `/edit` users on the public host get **404** when navigating to `/admin/evolution/strategies/[id]` (lines 66–69). Defense in depth: admin layout `requireAdmin()` + admin/evolution layout re-check + per-action `adminAction()` wrapper.
- `evolution/src/lib/pipeline/infra/types.ts:100` — `StrategyConfig` is a `z.infer` type alias; safe to import as `import type` from client code. Runtime imports of `schemas.ts` would pull `crypto`/openskill into the bundle.

### UX primitives + design tokens
- `evolution/src/components/evolution/sections/EntityDetailTabs.tsx` — `useTabState` + `EntityDetailTabs`. Generic, design-tokenized (`var(--accent-gold)`/`var(--text-muted)`), keyboard nav, URL-sync via `history.replaceState` (not router.replace — load-bearing for Next 15 fetch survival)
- `src/components/ui/dialog.tsx`, `sheet.tsx` — installed (shadcn over Radix)
- `src/components/ui/popover.tsx` — **NOT installed**, though `@radix-ui/react-popover` IS in package.json (used raw in `SourceCombobox`/`CitationPlugin`/admin strategy form)
- `src/components/ui/tabs.tsx` — **NOT installed**; `@radix-ui/react-tabs` not in deps
- `evolution/src/components/evolution/visualizations/TextDiff.tsx` — single-column unified diff with its OWN inline tab bar (Before/After/Diff). Could be reused or its tab-bar discarded for `EntityDetailTabs`
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — `RenderCriticMarkupFromMDAstDiff`; only used in `/(debug)/` pages
- `src/editorFiles/lexicalEditor/DiffTagNode.ts` + `DiffTagHoverPlugin.tsx` — in-editor accept/reject diff UI on `/results`
- `react-markdown ^10.1.0` installed but **only one consumer** (`/(debug)/latex-test/page.tsx`). Adding it to `/edit` would be a new render path.

### Tests
- `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` (86 lines) — form, submit-enable, privacy footer, noindex meta, pending/error UI on fake runId. **Does NOT assert on viewing-phase shape** → tabs refactor is safe re: this spec.
- `src/__tests__/e2e/specs/12-edit/edit-completed-run-handoff.spec.ts:128–141` — only depends on `data-testid="edit-run-viewing"` wrapper testid. Keep it and stay green.
- `src/app/edit/runs/[runId]/EditRunViewer.test.tsx` (jest) — mocks `SideBySideWordDiff` at lines 16–18, asserts on `diff-viewer-mock` at 118–124, 130–153. **Will need updating** when diff moves into a tab.
- Other 12-edit specs (host-isolation, submit-flow, form-smoke) — no viewing-phase references.

## Key Findings

1. **Variant is never visually focused today.** The viewing phase renders ONLY `SideBySideWordDiff` — a two-column mono grid where the new variant is the right column with green-highlighted insertions. There is no "new variant standalone" rendering anywhere in the codebase. A "focus on new variant" tab is a brand-new render path (mono `<pre>` reuse vs. introducing `react-markdown` is a design decision).

2. **The picker is radio cards, not a dropdown.** The brief says "click strategy in dropdown to see config" but `EditForm.tsx:57–96` renders a vertical radio-card stack. Either (a) keep the radio cards and add an info-icon/expand affordance per card, OR (b) refactor to a real dropdown (`combobox`/`select`). Cards are already touch-friendly and show name + description; dropdowns hide the description until clicked. **Needs user clarification.**

3. **Only one mock strategy is currently `public_visible`.** `Public Edit Smoke` uses `model: 'mock'` so it can't serve real traffic. Real `/edit` is effectively dark in production until either (a) an admin manually toggles strategies via `PublicVisibleToggle`, or (b) we widen the filter as the brief requests.

4. **Widening the filter is straightforward but has THREE lockstep points.** To "enable all non-test strategies":
   - `listPublicStrategiesAction` filter (510–513): drop `.eq('public_visible', true)` (keep status + is_test_content)
   - `submitPublicEditAction:132–145` whitelist re-check: must match
   - `PUBLIC_VISIBLE_BUDGET_CAP_USD` guard (304–322): becomes a SUBMIT-time constraint instead of a toggle-time one (or accept that strategies with `budgetUsd > $0.10` can be picked but the per-run `budget_cap_usd=0.10` will still cap the run — meaning expensive strategies just underperform on /edit; safe but worth flagging)
   - The 60s cache invalidation hook in `updateStrategyAction:341–343` becomes irrelevant for this filter and should be removed or repurposed.

5. **`StrategyConfigDisplay` is the right reuse target for "view config".** It's already pure, client-safe (type-only schema imports), and supports `showRaw` JSON fallback. Currently lives at `src/app/admin/evolution/_components/`. Two options: (a) leave path (Next.js doesn't enforce `_components` visibility), or (b) move to a shared location like `evolution/src/components/evolution/` for clarity. Path (b) is the cleaner long-term move.

6. **Config data is already 50% wired to the client.** `listPublicStrategiesAction` SELECTs full `config` JSON (line 510) but `PublicStrategySummary` (475–483) strips it. Adding `config: StrategyConfig` (or `config: unknown` to avoid the schema/runtime import chain) to the type + the row-map (525–536) gets full config to the picker with zero extra fetches. Alternatively, a sibling `getPublicStrategyConfigAction(strategyId)` (publicAction-wrapped, re-validates the whitelist) keeps the picker payload lean. **Lean option (lazy fetch) is more aligned with how a "click to expand" detail view actually behaves.**

7. **`SideBySideWordDiff` is the wrong reuse target for both new tabs.** Two new tabs need two different things:
   - **Variant tab**: should render the winner variant as prose (markdown or mono pre) WITHOUT diff highlighting. SideBySide always diff-highlights. Either build a `<VariantPreview>` (trivial — just a styled `<pre>` or `<ReactMarkdown>`), or use a new prop on SideBySide to suppress highlighting (cohabits with existing call sites, but adds branching to a shared component).
   - **Diff tab**: keep `SideBySideWordDiff` as-is, OR use `TextDiff` (unified single-column). Side-by-side is more spatially demanding on mobile; unified is what most code-review tools use.

8. **`EntityDetailTabs` is the cleanest tab primitive to reuse.** Already design-tokenized (gold underline matches public page accents), has keyboard nav, URL-syncs via `history.replaceState` (won't abort Next 15 fetches). Alternative: install shadcn `tabs.tsx` (`npx shadcn add tabs` + `@radix-ui/react-tabs` ~5 KB). EntityDetailTabs is the lower-risk, faster choice.

9. **Linking to admin pages from /edit is a dead-end.** Middleware 404s `/admin/evolution/*` on the public host (`src/middleware.ts:66–69`). The "view config detail" feature MUST surface in place on `/edit` — there's no escape hatch to the admin page.

10. **`strategyLabel` field in the reducer is currently unused.** `EditPageState.viewing.strategyLabel` is set to `''` from `EditRunViewer.tsx:87`. If we want to display which strategy produced the result (good UX for the variant-focused tab), we should plumb the strategy label from `getEditRunStatusAction` (currently doesn't return it).

11. **No `EditPage.ts` POM helper.** All 5 specs in `src/__tests__/e2e/specs/12-edit/` use raw `getByTestId`. Adding tabs would multiply selectors; this is a good moment to introduce `EditPage.ts` / `EditRunPage.ts`.

12. **UX critique points (from observed structure, not user testing — feed into /plan-review):**
    - **Loading the form behind login-less submission is rare in this codebase** — the spending-gate stack handles it, but users get zero feedback on cost or eligibility ahead of submit. Could surface "this will use ~$0.04" pre-submit.
    - **Pending UI is 3 sparkles + status copy** with no progress indication. A 60s+ wait with a static spinner is fragile (users tab away, return to error).
    - **The "Finished in {Xs}" card uses ink-on-paper, but the diff below is mono `<pre>` — strong stylistic discontinuity.** Either pull diff into tokens (font-display title above pre, mono pre with paper texture) or stylize the wrapper.
    - **No way to retry with a different strategy** — only "Edit something else" (back to fresh form). A "Try another strategy" CTA would let users compare strategies on the same input cheaply.
    - **No share/permalink hint** — the run URL is permanent, but there's no "Copy link" affordance.
    - **Diff direction**: "Your text" → "Evolved" reads well, but "Evolved" is vague. "Improved" / "Rewrite" / the strategy name would be more informative.

## Open Questions

1. **"Dropdown" in the brief — is the user accepting the current radio-card UI, or do they want a true `<select>`/combobox refactor?** This decides whether the config-detail affordance is per-card (info icon / expand row) or per-option (menu item with submenu).

2. **Should "enable all non-test strategies" include strategies whose `budgetUsd > $0.10`?** The per-run cap protects spend, but those strategies would run noticeably slower/worse on /edit than they would in admin runs.

3. **For the "view config" detail view — full StrategyConfigDisplay (Models/Iterations/Agents cards), or just the `showRaw` JSON dump?** Detail view consumes screen space; cards are friendlier but heavier.

4. **For the variant-focused tab — render as prose (markdown) or keep mono `<pre>` like the diff?** Mono is faster to ship and matches the diff tab's font, but the variant is meant to be the focal point of "the result" — prose rendering would emphasize it.

5. **Should we add a `EditPage.ts` POM helper as part of this project, or keep raw `getByTestId` in specs?** POM is cleaner and we'll have more selectors after tabs; raw is faster.

6. **Is the existing `Public Edit Smoke` mock strategy supposed to remain visible to real users, or should it be filtered out (e.g. by `is_predefined=false` or by config-hash)?** With the filter widened, this mock strategy is in the picker by default.

7. **Should the result page display the strategy name + run cost?** Currently it just says "Finished in 47s". Showing "Rewrote with 'Iterative Editing' · $0.04" makes the result more legible and ties back to the picker selection.
