<!-- Planning doc for the improvements_to_edit_page_evolution_20260630 project: decisions, phased plan, tests, and verification. -->

# Improvements to Edit Page Evolution Plan

## Background
Improve the external-facing `/edit` article editor (public surface introduced by `build_website_for_evolutiOn_20260626`). Currently: only one mock strategy is public-visible, so the picker is effectively empty for real users; results render via `SideBySideWordDiff` where the new variant gets equal visual weight with the original; there is no way to inspect a strategy's config from the picker. This project makes the new variant the visual focus, moves the diff into its own tab, opens the picker to all real strategies, and surfaces each strategy's config from the picker for debugging.

## Requirements (from GH Issue #1325)
- Focus on new variant in final result
- Show diff in a separate tab, not side by side
- Critique the UX and how to make it better
- Enable all non-test strategies available otherwise. For debugging purposes, let me quickly click to view the strategy detail view including the config, from the dropdown.

## Problem
The `/edit` viewing phase (`EditRunViewer.tsx:173-198`) renders `SideBySideWordDiff` as the only content — the winner variant is embedded in the right diff column, never rendered standalone. The picker (`EditForm.tsx:57-96`) is a radio-card stack filtered to `public_visible=true` strategies; today only `Public Edit Smoke` (mock model) qualifies, so the surface is dark in production. There is no debug affordance to see which model/iterations/budget a strategy actually uses — critical for a researcher checking which strategy the picker exposed.

## Decisions (from /research Open Questions 1-7)

| # | Decision |
|---|---|
| 1 | Refactor picker to searchable **combobox** (shadcn primitive) |
| 2 | Include all non-test active strategies (drop `public_visible` gate). Remove per-run $0.10 cap; per-strategy `budgetUsd` becomes the effective cap. Show a **⚠ warning badge** in the picker when a strategy's `budgetUsd > $0.10`. Per-IP and per-region caps likely need to be raised in tandem so one $5 run doesn't day-lock a user. |
| 3 | Config detail view = **full `StrategyConfigDisplay`** (structured cards: Models / Execution / Iterations / Agents) |
| 4 | Variant tab renders **prose via `react-markdown`** with a component-map (H1→font-display, prose→atlas-body, bold→--accent-gold) |
| 5 | Add **both `EditPage.ts` + `EditRunPage.ts`** POMs |
| 6 | Filter out mock strategies via **`config.generationModel !== 'mock'`** in both `listPublicStrategiesAction` filter AND `submitPublicEditAction` whitelist re-check |
| 7 | Viewing phase shows **"Rewrote with '{strategyLabel}' · ${cost} · {duration}"** — plumb `strategy_label` through `getEditRunStatusAction` (join `evolution_runs.strategy_id → evolution_strategies.label ?? name`) |

## Options Considered
Full options-and-tradeoffs analysis lived in the /research phase (see research doc "Open Questions" section for the 7 decision points with alternatives and rationale). This section is retained for template compliance:
- [x] **Option A: Picker refactor to searchable combobox** — chosen (Q1)
- [ ] **Option B: Keep radio cards, add per-card affordance** — rejected (Q1) — long scroll with widened filter
- [ ] **Option C: Refactor to plain dropdown** — rejected (Q1) — no search, hides descriptions

## Phased Execution Plan

### Phase 1: Backend — widen filter, plumb config + strategy_label
- [ ] Modify `listPublicStrategiesAction` filter (`evolution/src/services/strategyRegistryActions.ts:510-513`): drop `.eq('public_visible', true)`; keep `status='active'` + `is_test_content=false`; add JS-side filter `config.generationModel !== 'mock'` after fetch (JSONB path in PostgREST is awkward)
- [ ] Add `config: StrategyConfig` (typed via `import type`) OR `config: unknown` (safer for tree-shake) to `PublicStrategySummary` (`strategyRegistryActions.ts:475-483`) and its row map (525-536)
- [ ] Modify `submitPublicEditAction:132-145` whitelist re-check to match new filter (drop `public_visible`, add `generationModel !== 'mock'`)
- [ ] Remove or repurpose the `updateStrategyAction:341-343` cache invalidation hook (no longer keyed on `publicVisible`)
- [ ] Remove `PER_RUN_BUDGET_CAP_USD = 0.10` per-run insert cap (`publicEditActions.ts:30,260`); insert with the strategy's `budgetUsd` instead
- [ ] Update `estimateRunCostUsd()` (`publicEditActions.ts:89-94`) to use the strategy's `budgetUsd` as the upper bound (was hardcoded to `PER_RUN_BUDGET_CAP_USD`)
- [ ] Raise `PUBLIC_EDIT_PER_IP_DAILY_USD_CAP` (env var) and `PUBLIC_EDIT_PER_REGION_DAILY_USD_CAP` — target values TBD in plan-review (proposal: bump per-IP $0.50 → $5.00, per-region $5 → $50 to allow ~10 runs/user/day at max strategy cost; alternative: leave as-is and accept that first $5 run day-locks an IP)
- [ ] Extend `getEditRunStatusAction` (`publicEditActions.ts:288-352`) return shape to include `strategyLabel: string | null` — join `evolution_runs.strategy_id → evolution_strategies` and return `label ?? name`
- [ ] Update the `EditRunStatus` interface (`publicEditActions.ts:55-62`)

### Phase 2: Frontend — combobox picker + config modal
- [ ] Verify shadcn Command primitive is installed (`src/components/ui/combobox.tsx` per Explore report — already used by `SourceCombobox`); reuse or install shadcn combobox if missing
- [ ] Refactor `EditForm.tsx:57-96` radio-card stack into a shadcn combobox
  - [ ] Each option row: strategy name/label + `generationModel` + `$budgetUsd` + `(i)` info icon + `⚠` warning icon when `budgetUsd > 0.10`
  - [ ] Search filters by name/label/description (all client-side; N is small enough)
  - [ ] Default selection: first strategy (preserve existing behavior)
- [ ] Move `StrategyConfigDisplay.tsx` from `src/app/admin/evolution/_components/` to `src/components/strategy/StrategyConfigDisplay.tsx` (shared, no route-folder implication)
  - [ ] Update the 2 existing importers (`strategies/[strategyId]/page.tsx:24`, `ExperimentForm.tsx:15`)
- [ ] Add a modal Dialog (`src/components/ui/dialog.tsx`) triggered by the `(i)` icon in each combobox row
  - [ ] `onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfigModalStrategyId(id); }}` — prevents selection when opening config
  - [ ] Modal renders `<StrategyConfigDisplay config={strategy.config} />`, close button, no `showRaw` (Q3)
- [ ] Add `⚠ Budget above $0.10 — this rewrite may cost more than usual` warning row inside the config modal too (belt-and-suspenders after picker badge)
- [ ] Verify keyboard nav: Tab from combobox option to (i) icon is unusual inside a listbox — may need arrow-right or a dedicated "Show config" button per option instead of an icon

### Phase 3: Frontend — result page tabs + variant tab render
- [ ] Refactor `EditRunViewer.tsx:173-198` viewing phase JSX
  - [ ] Preserve outer `<div data-testid="edit-run-viewing">` wrapper (existing spec dep — `edit-completed-run-handoff.spec.ts:135`)
  - [ ] Wrap the meta strip in the existing scholar-card, updated copy: `Rewrote with '{strategyLabel}' · ${cost.toFixed(2)} · {duration}` (Q7)
  - [ ] Import `EntityDetailTabs` + `useTabState` from `@evolution/components/evolution`
  - [ ] Two tabs: `{id: 'variant', label: 'Improved article'}` (default) and `{id: 'diff', label: 'Diff'}`
  - [ ] Variant tab body: `<ReactMarkdown components={editRunMarkdownComponents}>{winnerVariantContent}</ReactMarkdown>`
    - [ ] Create `src/app/edit/runs/[runId]/editRunMarkdownComponents.tsx` — component map for H1/H2/H3 → `font-display`, paragraphs → `atlas-body`, `strong` → `--accent-gold`, `code`/`pre` → mono, lists → styled
  - [ ] Diff tab body: existing `<SideBySideWordDiff parent={originalContent} variant={winnerVariantContent} leftLabel="Your text" rightLabel="Rewrite" />` (relabel "Evolved" → "Rewrite" per UX critique)
- [ ] Wake up `strategyLabel` field in the reducer (`editPageLifecycleReducer.ts:73-81` POLL_COMPLETED handler) — read from the extended status response
- [ ] Sanity check the "Edit something else" CTA position; no other CTAs added per user (did not opt into "Try another strategy")

### Phase 4: Tests — POMs + spec updates
- [ ] Add `src/__tests__/e2e/helpers/pages/EditPage.ts` extending `BasePage`
  - [ ] Selectors: `strategyComboboxTrigger`, `strategyComboboxSearchInput`, `strategyOption(id)`, `strategyOptionInfoButton(id)`, `strategyOptionBudgetWarning(id)`, `strategyConfigModal`, `editTextarea`, `editSubmit`
  - [ ] Actions: `openCombobox()`, `searchStrategies(q)`, `selectStrategy(id)`, `openStrategyConfig(id)`, `closeStrategyConfig()`, `typeArticle(text)`, `submit()`
  - [ ] Each action awaits its post-condition (Rule 12)
- [ ] Add `src/__tests__/e2e/helpers/pages/EditRunPage.ts` extending `BasePage`
  - [ ] Selectors: `runViewing`, `metaStrip`, `variantTab`, `diffTab`, `variantTabContent`, `diffTabContent`, `sxsDiff`
  - [ ] Actions: `switchToDiffTab()`, `switchToVariantTab()`, `getStrategyLabel()` (returns Locator — not string, per Rule 4), `getCostText()` (Locator), `getDurationText()` (Locator)
- [ ] Update `src/app/edit/runs/[runId]/EditRunViewer.test.tsx` jest spec:
  - [ ] Replace `diff-viewer-mock` assertions (lines 16-18, 118-124, 130-153) with tab-aware assertions
  - [ ] Mock `EntityDetailTabs` as a passthrough that renders all tab bodies (easier than driving tab state); assert both tab bodies mount
  - [ ] Assert `strategyLabel` copy renders when populated
- [ ] Update `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` to use `EditPage` POM (no behavioral change; assertions same)
- [ ] Update `edit-submit-flow.spec.ts` to use `EditPage` POM
- [ ] Update `edit-completed-run-handoff.spec.ts:128-141` to use `EditRunPage` POM; add assertion that the variant tab is default-active and diff tab is switchable
- [ ] Add unit test `evolution/src/services/strategyRegistryActions.test.ts`: `listPublicStrategiesAction` excludes mock-model strategies (fixture: 3 strategies — real active, mock active, real archived; assert only real active returned)
- [ ] Add integration test `src/__tests__/integration/public-edit-widen-filter.integration.test.ts`: `submitPublicEditAction` accepts a non-`public_visible` real strategy; rejects a mock-model strategy
- [ ] Update `evolution/scripts/seedPublicEditE2EStrategy.ts` — verify the seeded mock strategy is still findable via `executable: true` (Pattern A-2) for the smoke test but excluded from the user picker via the mock-model filter

### Phase 5: Documentation updates
- [ ] `evolution/docs/architecture.md` § Entry Point #5 — result is now rendered as tabs (variant + diff), not a bare `SideBySideWordDiff`
- [ ] `evolution/docs/strategies_and_experiments.md` — `listPublicStrategiesAction` filter widened; mock-model exclusion; per-strategy `budgetUsd` cap; `PUBLIC_VISIBLE_BUDGET_CAP_USD` guard becomes irrelevant (or deleted)
- [ ] `evolution/docs/visualization.md` — note that `StrategyConfigDisplay` moved to `src/components/strategy/` and is now used by the public `/edit` picker
- [ ] `docs/feature_deep_dives/state_management.md` — `strategyLabel` field is now live (was dead)
- [ ] `docs/feature_deep_dives/llm_spending_gate.md` — per-run $0.10 cap removed; per-IP + per-region cap values updated if we raise them
- [ ] `evolution/docs/variant_lineage.md` — no change (variant detail page still uses the same `SideBySideWordDiff`)
- [ ] `evolution/docs/editing_agents.md` + `evolution/docs/paragraph_recombine.md` — no change (both strategies now surfaceable in the public picker but their docs don't need to mention that)
- [ ] `docs/feature_deep_dives/lexical_editor_plugins.md` — no change (react-markdown ≠ Lexical; different render path)
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — no change

## Testing

### Unit Tests
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — `listPublicStrategiesAction` excludes mock-model strategies; includes non-public_visible active real strategies
- [ ] `src/app/edit/publicEditActions.test.ts` — `submitPublicEditAction` accepts non-public_visible real strategy; rejects mock-model strategy; per-run insert uses strategy's `budgetUsd` (not hardcoded $0.10)
- [ ] `src/reducers/editPageLifecycleReducer.test.ts` — POLL_COMPLETED sets `strategyLabel` from response payload
- [ ] `src/app/edit/runs/[runId]/EditRunViewer.test.tsx` — tabs mount; meta strip renders label + cost + duration; both tab bodies present
- [ ] `src/app/edit/EditForm.test.tsx` (new file) — combobox renders; search filters; (i) opens modal without selecting; ⚠ warning shows when budgetUsd > $0.10
- [ ] `src/components/strategy/StrategyConfigDisplay.test.tsx` — move existing test alongside the moved component (if one exists) or add smoke test

### Integration Tests
- [ ] `src/__tests__/integration/public-edit-widen-filter.integration.test.ts` — end-to-end: strategy seeded → `listPublicStrategiesAction` returns it → `submitPublicEditAction` accepts it → run inserted with strategy's `budgetUsd`
- [ ] `src/__tests__/integration/public-edit-mock-filter.integration.test.ts` — mock-model strategy is excluded from both list and submit

### E2E Tests
- [ ] `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` — refactored to use `EditPage` POM; assertions unchanged
- [ ] `src/__tests__/e2e/specs/12-edit/edit-form-smoke.spec.ts` — combobox open/close, search, select, (i) opens modal without selecting, modal renders config cards, ⚠ badge appears for high-budget strategies
- [ ] `src/__tests__/e2e/specs/12-edit/edit-submit-flow.spec.ts` — refactored to POM; still uses `executable: true` for mock strategy bypass
- [ ] `src/__tests__/e2e/specs/12-edit/edit-completed-run-handoff.spec.ts` — variant tab is default-active on load; diff tab switchable; meta strip shows label/cost/duration
- [ ] `src/__tests__/e2e/specs/12-edit/edit-host-isolation.spec.ts` — no changes (host gating unaffected)

### Manual Verification
- [ ] Open `/edit` on staging with real user; verify combobox lists ~N strategies (N = count of active non-test non-mock)
- [ ] Click (i) on a strategy row; verify config modal renders Models/Iterations cards; close without selecting
- [ ] Pick a strategy with `budgetUsd > $0.10`; verify ⚠ badge in picker and inside config modal
- [ ] Submit a rewrite; verify variant tab is default-active with prose rendering (headings, bold, lists render correctly)
- [ ] Switch to Diff tab; verify SideBySide renders unchanged with "Your text" / "Rewrite" labels
- [ ] Verify meta strip: `Rewrote with '{strategyLabel}' · $X.XX · {N}s`
- [ ] Test per-IP cap: submit ~5 runs from same IP; verify cap behavior matches raised (or unchanged) values

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/` — full 12-edit spec directory passes locally
- [ ] Run on local server via `npm run test:e2e` (which triggers `ensure-server.sh` per project convention)
- [ ] Screenshot both tabs of viewing phase for visual regression baseline

### B) Automated Tests
- [ ] `npm run lint` + `npm run typecheck` + `npm run build`
- [ ] `npm test -- src/reducers/editPageLifecycleReducer src/app/edit src/components/strategy evolution/src/services/strategyRegistryActions` — unit tests for touched code
- [ ] `npm run test:integration -- public-edit-widen-filter public-edit-mock-filter` — new integration tests
- [ ] `npm run test:e2e:critical` — 12-edit specs are `@critical`? verify or run `npm run test:e2e -- src/__tests__/e2e/specs/12-edit/`
- [ ] `npm run test:hooks` — no hook changes expected but sanity-check

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/architecture.md` — Entry Point #5 result rendering (SideBySideWordDiff → tabs)
- [ ] `evolution/docs/strategies_and_experiments.md` — `listPublicStrategiesAction` filter change; mock-model exclusion; $0.10 budget-cap guard obsolete
- [ ] `evolution/docs/visualization.md` — `StrategyConfigDisplay` component moved to shared location
- [ ] `docs/feature_deep_dives/state_management.md` — `strategyLabel` field now live in `viewing` state
- [ ] `docs/feature_deep_dives/llm_spending_gate.md` — per-run $0.10 cap removed; per-IP + per-region caps if raised
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — no change (variant tab uses react-markdown, not AST diff)
- [ ] `evolution/docs/variant_lineage.md` — no change
- [ ] `evolution/docs/editing_agents.md` — no change
- [ ] `evolution/docs/paragraph_recombine.md` — no change
- [ ] `docs/feature_deep_dives/lexical_editor_plugins.md` — no change

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
