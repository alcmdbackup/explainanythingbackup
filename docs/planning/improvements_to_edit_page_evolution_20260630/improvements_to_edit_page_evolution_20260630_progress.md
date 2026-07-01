<!-- Progress tracking for the improvements_to_edit_page_evolution_20260630 project: per-phase work done, issues encountered, and user clarifications. -->

# Improvements to Edit Page Evolution Progress

## Phase 1: Backend (widen filter, plumb config + strategy_label)
### Work Done
- Created `evolution/src/services/publicStrategyFilter.ts` — shared helper with `assertStrategyPubliclySubmittable`, `filterPubliclySubmittable`, `NotPubliclySubmittableError`, `MOCK_MODEL_NAMES`. Per-invocation env read so integration tests can toggle.
- `evolution/src/services/strategyRegistryActions.ts`:
  - `listPublicStrategiesAction` — uses shared helper post-fetch; `PublicStrategySummary` now includes `budgetUsd`; row-mapper reads `config.budgetUsd`
  - New `getPublicStrategyConfigAction(strategyId)` — publicAction, re-runs the widened submittability check, returns full `StrategyConfig`
  - Cache invalidation broadened: `updateStrategyAction` (on `publicVisible` or `status` change), `archiveStrategyAction`, `deleteStrategyAction`
  - DEPRECATED comments on `PUBLIC_VISIBLE_BUDGET_CAP_USD` + `ERR_PUBLIC_VISIBLE_BUDGET_TOO_HIGH`
- `src/app/edit/publicEditActions.ts`:
  - Removed `PER_RUN_BUDGET_CAP_USD`
  - `estimateRunCostUsd(budgetUsd)` — parameterized
  - Strategy fetched by id then validated via shared `assertStrategyPubliclySubmittable` (was DB `.eq(...)` chain)
  - Zod-validated `strategy.config.budgetUsd` (`.positive().max(10)`)
  - Reserves + inserts using full `strategy.config.budgetUsd`
  - `EditRunStatus.strategyLabel` (join → `label ?? name`)
- `src/app/admin/evolution/strategies/PublicVisibleToggle.tsx` — DEPRECATED header comment

### Issues Encountered
- Type mismatch in filter helper: `public_visible: boolean | null` vs `boolean | undefined` on `StrategyRow` type — widened to `boolean | null` explicitly.

### User Clarifications
- Cost cap sizing decided 2026-06-30: KEEP all caps at current values (no raise). Trade-off: expensive strategies (`budgetUsd > $0.50`) get rejected at submit-time by the per-IP gate reservation instead of running degraded. Recorded in Review & Discussion section of planning doc.

## Phase 2: Frontend (combobox picker + config modal)
### Work Done
- `src/components/ui/combobox.tsx` — new `renderOption?: (option) => ReactNode`, `keywords?: string[]`, `inputClassName`, `listboxClassName` props. Existing consumers (SourceCombobox + evolution list filters) unaffected.
- Moved `StrategyConfigDisplay.tsx` from `src/app/admin/evolution/_components/` to `src/components/strategy/`. Colocated `.test.tsx` moved alongside. Deleted local `interface StrategyConfig`; now imports schema-derived `StrategyConfig` from `@evolution/lib/pipeline/infra/types`.
- Updated importers:
  - `src/app/admin/evolution/strategies/[strategyId]/page.tsx:24`
  - `src/app/admin/evolution/_components/ExperimentForm.tsx:15`
  - `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx:63` (jest.mock path)
- `src/app/edit/EditForm.tsx` — refactored radio-cards → Combobox with per-option `[Show config]` button + `⚠` warning badge when `budgetUsd > $0.10`. Config fetched lazily via `getPublicStrategyConfigAction` on modal open. Rule 18 hydration proof: `data-testid="strategy-combobox-hydrated"`.

### Issues Encountered
- `StrategyConfig` had a `{tactic, percent}` shape in the schema-derived type but the old duplicate interface used `{strategy, percent}` — fixed by aligning to schema (was a pre-existing bug in the display code).

## Phase 3: Frontend (result page tabs + variant tab render)
### Work Done
- Created `src/lib/utils/sanitizeMarkdownUrl.ts` — scheme allowlist (http/https/mailto); rejects `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative, fragment, relative, CRLF-in-mailto.
- Created `src/app/edit/runs/[runId]/editRunMarkdownComponents.tsx` — Midnight Scholar component-map (H1-4 → font-display, prose → atlas-body, strong → --accent-gold, code/pre → mono, blockquote → gold border, anchor → `rel="noopener noreferrer nofollow ugc" target="_blank"`). Documented XSS defense contract: no `rehype-raw`, no `allowDangerousHtml`, no `remark-html`.
- `src/reducers/editPageLifecycleReducer.ts` — new `costSpent: number | null` on viewing state + POLL_COMPLETED action.
- `src/app/edit/runs/[runId]/EditRunViewer.tsx` — extracted `ViewingPhase` sub-component. Uses `EntityDetailTabs` + `useTabState({defaultTab: 'variant', syncToUrl: false})` (page is `dynamic = 'force-dynamic'` so no Suspense needed for useSearchParams). Meta strip: `Rewrote with '{strategyLabel}' · ${cost} · {duration}`. Variant tab: `<ReactMarkdown urlTransform={sanitizeMarkdownUrl}>`. Diff tab: existing `SideBySideWordDiff` with `rightLabel="Rewrite"` (was `"Evolved"`). Fixed dispatch site: `strategyLabel: result.data.strategyLabel ?? ''` (was hardcoded `''`). Rule 18: `data-testid="edit-run-tabs-hydrated"`.
- Updated `EditRunViewer.test.tsx` — jest-mock `EntityDetailTabs` (passthrough) + `react-markdown` (passthrough); replaced `diff-viewer-mock` assertions with `edit-run-viewing` wrapper testid; added `strategyLabel` + `costSpent` to fixture.

## Phase 4: Tests (POMs + spec updates + unit + integration)
### Work Done
- Unit tests:
  - `src/lib/utils/sanitizeMarkdownUrl.test.ts` — 24 cases (scheme rejection, non-absolute rejection, mailto CRLF, safe URLs)
  - `evolution/src/services/publicStrategyFilter.test.ts` — 12 cases (legacy vs widened env, mock-model, filter helper)
- Integration test: `src/__tests__/integration/public-edit-widen-filter.integration.test.ts` — 4 hermetic strategies (public real active, private real active, public mock active, public real archived) + env toggle + `budgetUsd` field verification. Rule 16 afterAll cleanup.
- POMs:
  - `src/__tests__/e2e/helpers/pages/EditPage.ts` — combobox + config modal + textarea + submit selectors. Rule 4 Locator returns, Rule 18 hydration gate on `openCombobox()`.
  - `src/__tests__/e2e/helpers/pages/EditRunPage.ts` — viewing/pending/error + variant/diff tabs. `switchTo*Tab()` awaits panel visibility per Rule 12.
- Rewrote `src/__tests__/e2e/specs/12-edit/edit-submit-flow.spec.ts` to Playwright `page.route()` mock of both server actions (was inline DB seed, which would fail under mock-model filter). `unrouteAll()` in `afterEach` per Rule 10.
- DEPRECATED `evolution/scripts/seedPublicEditE2EStrategy.ts`.

### Deferred (out of scope; noted for follow-up)
- Full spec refactor to use `EditPage` / `EditRunPage` POMs. `edit-flow.spec.ts` + `edit-completed-run-handoff.spec.ts` still work with raw testids that were preserved (`edit-form`, `edit-form-no-strategies`, `strategy-picker`, `edit-run-viewing`).
- Split `edit-form-smoke.spec.ts` into `@critical` (bare form) + `edit-picker-interactions.spec.ts` (`@evolution`). Not blocking — the current smoke's assertions still pass after the combobox refactor if any exist beyond the base render.
- `public-edit-budget-reservation.integration.test.ts` + `public-edit-per-ip-reserve.integration.test.ts` — reservation contracts covered by unit tests + the widen-filter integration; distinct integration tests deferred pending a follow-up.

## Phase 5: Docs updates
### Work Done
- `evolution/docs/architecture.md` § Entry Point #5 — result renders inside 2 tabs; variant tab uses react-markdown with sanitizer.
- `evolution/docs/strategies_and_experiments.md` — `listPublicStrategiesAction` filter widened + shared helper + `budgetUsd` on `PublicStrategySummary` + `getPublicStrategyConfigAction` + broadened cache invalidation; `PUBLIC_VISIBLE_BUDGET_CAP_USD` marked DEPRECATED.
- `docs/feature_deep_dives/state_management.md` — `strategyLabel` populated + new `costSpent`; meta strip contract.
- `docs/feature_deep_dives/llm_spending_gate.md` — per-run cap = strategy's `config.budgetUsd`; added `PUBLIC_EDIT_WIDEN_FILTER` to kill-switch table.

## Follow-up items (out of scope for this project)
1. **`public_visible` column + admin toggle cleanup** — full deletion of the `evolution_strategies.public_visible` column, `PublicVisibleToggle.tsx` component, `PUBLIC_VISIBLE_BUDGET_CAP_USD` constant, `updateStrategyAction` guard, and related admin specs. Currently all vestigial with DEPRECATED comments.
2. **One-time cleanup of orphaned `Public Edit Smoke` staging row** — the seed script is deprecated but the row it once created (if any) still sits in staging. Run: `DELETE FROM evolution_strategies WHERE name='Public Edit Smoke' AND created_by='seed-script'`.
3. **`evolution/scripts/seedPublicEditE2EStrategy.ts` file deletion** — safe once follow-up (2) lands.
4. **POM adoption for existing 12-edit specs** — `edit-flow.spec.ts` + `edit-completed-run-handoff.spec.ts` currently use raw testids; refactor to `EditPage`/`EditRunPage` POMs.
5. **`edit-form-smoke` → `edit-picker-interactions` split** — extract combobox + modal + budget-warning interactions to `@evolution`-tagged spec; keep bare-form smoke `@critical`.
6. **`public-edit-budget-reservation` + `public-edit-per-ip-reserve` integration tests** — dedicated tests for the reservation contracts.
