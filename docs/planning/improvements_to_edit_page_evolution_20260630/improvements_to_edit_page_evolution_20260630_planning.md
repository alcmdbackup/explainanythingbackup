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

### Phase 1: Backend — widen filter, plumb config + strategy_label + preserve cost invariants

**Cost cap sizing (proposed defaults — REQUIRES USER SIGN-OFF before merge per `feedback_cost_tracking_fail_closed.md` + `feedback_never_reset_without_agreement.md`):**

| Env / DB key | Today | Proposed | Reasoning |
|---|---|---|---|
| `PUBLIC_EDIT_PER_IP_DAILY_USD_CAP` | `$0.50` | **`$5.00`** | Allows one max-strategy ($5) run per IP/day, OR ~50 cheap ($0.10) runs. Without raise: a single expensive-strategy pick day-locks the IP. |
| `PUBLIC_EDIT_PER_REGION_DAILY_USD_CAP` | `$5.00` | **`$50.00`** | Same 10× proportion. Absorbs ~10 max-cost runs across the country. |
| `guest_user_daily_cap_usd` (DB) | `$10` | **`$10`** (unchanged) | This IS the outer bound for the anon `/edit` flow; keeping it tight is the load-bearing safety knob. |
| `evolution_daily_cap_usd` (DB) | `$25` | **`$25`** (unchanged) | Global outer bound. |
| `monthly_cap_usd` (DB) | `$500` | **`$500`** (unchanged) | Monthly outer bound. |

**Rationale for keeping guest_user + global caps unchanged:** the raise happens ONLY at per-IP/per-region layers where day-locking a single user is user-hostile UX. The guest-user pool + global caps stay tight so total system spend is still bounded. Under proposed values, worst case = $10/day per unique guest (already true today) × N unique IPs, further bounded by $25/day evolution + $500/month.

**Feature flag (Task #2 — rollback path):**
- Add `PUBLIC_EDIT_WIDEN_FILTER` env var. Default `'false'` (current behavior: only `public_visible=true` strategies visible).
- When `'true'`: `listPublicStrategiesAction` drops the `.eq('public_visible', true)` clause; `submitPublicEditAction` whitelist re-check matches. Same gate on both sides for lockstep.
- Rollback: flip env `PUBLIC_EDIT_WIDEN_FILTER=false` on Vercel (no redeploy). Emergency: existing `PUBLIC_EDIT_DISABLED=true` still kills the whole surface.

**Implementation checklist:**

- [ ] Add `PUBLIC_EDIT_WIDEN_FILTER` env-var read in a shared helper `evolution/src/services/publicStrategyFilter.ts` (single source of truth for the filter shape used by both list + submit). Server-only module (imported only from `evolution/src/services/`). Env read is per-invocation (function-level `process.env.X`), NOT module-scope — otherwise SSR-cached values persist across deploys and integration tests can't toggle.
- [ ] Extract shared helper `assertStrategyPubliclySubmittable(strategy: StrategyRow): void` (throws `NotPubliclySubmittableError` on reject) — both `listPublicStrategiesAction` (JS filter after fetch) and `submitPublicEditAction` (Zod-parse then assert) call it. Export signature:
  ```ts
  export const MOCK_MODEL_NAMES: ReadonlySet<string>;
  export function assertStrategyPubliclySubmittable(strategy: StrategyRow): void;
  export function filterPubliclySubmittable(strategies: StrategyRow[]): StrategyRow[];
  export class NotPubliclySubmittableError extends Error { code: 'STATUS' | 'TEST_CONTENT' | 'MOCK_MODEL' | 'PUBLIC_VISIBLE'; }
  ```
- [ ] Modify `listPublicStrategiesAction` filter (`evolution/src/services/strategyRegistryActions.ts:510-513`): when `PUBLIC_EDIT_WIDEN_FILTER === 'true'`, drop `.eq('public_visible', true)`; always keep `status='active'` + `is_test_content=false`; JS-side positive-allowlist `config.generationModel && !MOCK_MODEL_NAMES.has(config.generationModel)` where `MOCK_MODEL_NAMES = new Set(['mock', 'test-mock'])`
- [ ] Widen `PublicStrategySummary` (`strategyRegistryActions.ts:475-483`) to include `budgetUsd: number`; keep the existing `generationModel`, `judgeModel`, `iterationCount`; do NOT ship full `config` on the picker payload (keeps it lean — full config comes via lazy fetch on modal open)
- [ ] Add new `getPublicStrategyConfigAction(strategyId: string)` (`publicAction`-wrapped in same file) that re-runs `assertStrategyPubliclySubmittable` and returns the full `StrategyConfig` for a single strategy. Called on config-modal open only.
- [ ] Modify `submitPublicEditAction:132-145` SELECT to include `config` + call `assertStrategyPubliclySubmittable`; feature-flag-gated same as list
- [ ] Add Zod validation of `strategy.config.budgetUsd` in the submit path: `z.number().positive().max(10)`. `.max(10)` matches the outer `guest_user_daily_cap_usd` — a strategy with `budgetUsd > $10` cannot possibly complete a single /edit run against the guest pool anyway; reject early. Structured error `INVALID_STRATEGY_BUDGET` if malformed.
- [ ] **Remove** `PER_RUN_BUDGET_CAP_USD` constant (`publicEditActions.ts:30`); per-run insert reads `budget_cap_usd: strategy.config.budgetUsd` (`publicEditActions.ts:260`)
- [ ] Refactor `estimateRunCostUsd()` signature (`publicEditActions.ts:89-94`) to `estimateRunCostUsd(budgetUsd: number): number` — returns `budgetUsd`; update the 3 call sites (`publicEditActions.ts:151`, `170`, `194`) to pass `strategy.config.budgetUsd`
- [ ] **Reserve-amount contract (Task #1 — load-bearing):** `perIpGate.reserveForIp(ip, country, strategy.config.budgetUsd)` and `spendingGate.reserveForUser(GUEST_USER_ID, strategy.config.budgetUsd, GUEST_CAP)` — reserve the FULL strategy budgetUsd, NOT $0.10. This ensures per-IP/per-region caps are not silently defeated by an underspec'd reservation.
- [ ] Bump env `PUBLIC_EDIT_PER_IP_DAILY_USD_CAP=5.00` + `PUBLIC_EDIT_PER_REGION_DAILY_USD_CAP=50.00` on Vercel Preview + Production (via `vercel env add`). Document in Phase 5 doc updates. Rollback: revert env values.
- [ ] Extend `getEditRunStatusAction` (`publicEditActions.ts:288-352`) return shape to include `strategyLabel: string | null` — join `evolution_runs.strategy_id → evolution_strategies` and return `label ?? name`
- [ ] Update the `EditRunStatus` interface (`publicEditActions.ts:55-62`)
- [ ] **Broaden cache invalidation triggers (Task #7):** `invalidatePublicStrategiesCache()` currently only fires on `publicVisible` flip (`strategyRegistryActions.ts:341-343`). Post-widening, must also fire on: `status` change, `is_test_content` change, `config.generationModel` change, and **`config.budgetUsd` change** (the picker displays budgetUsd + drives the ⚠ badge; stale values would mislead the user). Update `updateStrategyAction`, `archiveStrategyAction` (`~line 409`), and `deleteStrategyAction` (if present) call sites.
- [ ] **publicVisible cleanup decision (Task #5): KEEP AS VESTIGIAL for this project.** Rationale: full deletion (column drop migration + `PublicVisibleToggle.tsx` removal + `updateStrategyAction` guard removal + admin spec updates) is a separate PR (out of scope). Add DEPRECATION comment above (a) `PublicVisibleToggle.tsx:14`, (b) `updateStrategyAction:304-322`, (c) `PUBLIC_VISIBLE_BUDGET_CAP_USD` constant: `// DEPRECATED post-improvements_to_edit_page_evolution_20260630 — public_visible no longer gates the /edit picker (see PUBLIC_EDIT_WIDEN_FILTER). Slated for cleanup in a follow-up PR.` Track follow-up in `_progress.md`.
- [ ] **Type-source resolution (Task #8):** delete the local `interface StrategyConfig` in `StrategyConfigDisplay.tsx:30-51`; import schema-derived `StrategyConfig` via `import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types'`. Verify tree-shake safety (no runtime imports from `schemas.ts`).

### Phase 2: Frontend — combobox picker + config modal

**Picker primitive decision (Task #4): EXTEND existing `src/components/ui/combobox.tsx`.** The existing primitive is bespoke (no shadcn Command / cmdk dependency; `ComboboxOption = {value, label}` strings only). Options rejected: (a) install `cmdk` (~15 KB new dep for a use case a 30-line extension covers); (b) build custom listbox from scratch (duplicates existing keyboard nav / search). Chosen: add optional `renderOption?: (option: ComboboxOption) => ReactNode` prop; when provided, use in list-item render instead of default label. `SourceCombobox` and existing consumers keep default behavior.

- [ ] Extend `src/components/ui/combobox.tsx`: add `renderOption?: (option: ComboboxOption) => ReactNode` prop; when provided, replace the default label render with `renderOption(option)`. Preserve keyboard nav (arrow up/down, Enter), search, selection semantics. Update the unit test to cover the new prop.
- [ ] Refactor `EditForm.tsx:57-96` radio-card stack into the extended Combobox
  - [ ] Each option row (via `renderOption`): strategy name/label · `generationModel` · `$budgetUsd` · `[Show config]` text button · `⚠` warning badge when `budgetUsd > 0.10`
  - [ ] Search filters by name/label/description (extend `ComboboxOption` with optional `keywords: string[]` or filter client-side against the widened summary)
  - [ ] Default selection: first strategy (preserve existing behavior)
  - [ ] **Hydration proof (Task #10, Rule 18):** add `data-testid="strategy-combobox-hydrated"` set via `useEffect(() => { setHydrated(true) }, [])`. POM `openCombobox()` awaits this before clicking.
  - [ ] **Empty-state branch:** when zero non-mock strategies returned, render the existing `edit-form-no-strategies` slot (already present at `EditForm.tsx:47` — no new testid needed). Preserve current empty-state UX. Combobox spec must cover this branch.
- [ ] Move `StrategyConfigDisplay.tsx` from `src/app/admin/evolution/_components/` to `src/components/strategy/StrategyConfigDisplay.tsx`
  - [ ] Update the 2 existing importers: `strategies/[strategyId]/page.tsx:24`, `ExperimentForm.tsx:15`
  - [ ] **Update `jest.mock` path (Task #9): `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx:63-64`** — change `jest.mock('@/app/admin/evolution/_components/StrategyConfigDisplay', ...)` to the new path `'@/components/strategy/StrategyConfigDisplay'` in the same commit as the file move
  - [ ] Delete the local `interface StrategyConfig` inside the moved file (per Phase 1 type-source resolution); import schema-derived `StrategyConfig`
- [ ] Add a modal Dialog (`src/components/ui/dialog.tsx`) triggered by the `[Show config]` button in each combobox row
  - [ ] `onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfigModalStrategyId(id); }}` — prevents combobox selection when opening config
  - [ ] Config fetched lazily via `getPublicStrategyConfigAction(id)` on modal open (not shipped with picker payload — keeps list lean)
  - [ ] Modal renders `<StrategyConfigDisplay config={config} />`, close button, no `showRaw` (Q3)
  - [ ] Add `⚠ Budget above $0.10 — this rewrite may cost more than usual` warning row inside the config modal when `budgetUsd > 0.10` (belt-and-suspenders after picker badge)
- [ ] **Keyboard-nav decision (Task #4 sub):** use a dedicated text-button `[Show config]` (not icon-only). Rationale: (a) buttons inside listbox rows are unusual but Tab-accessible in this bespoke primitive (verify test coverage), (b) text label is a11y-friendly (no need for aria-label), (c) icon-only inside a listbox would trap keyboard users. Explicit test: keyboard user can Tab into button and activate with Space/Enter without triggering row selection.

### Phase 3: Frontend — result page tabs + variant tab render

- [ ] Refactor `EditRunViewer.tsx:173-198` viewing phase JSX
  - [ ] Preserve outer `<div data-testid="edit-run-viewing">` wrapper (existing spec dep — `edit-completed-run-handoff.spec.ts:135`)
  - [ ] Wrap the meta strip in the existing scholar-card, updated copy: `Rewrote with '{strategyLabel}' · ${cost.toFixed(2)} · {duration}` (Q7)
  - [ ] Import `EntityDetailTabs` + `useTabState` from `@evolution/components/evolution`
  - [ ] **Suspense contract (Task #8):** `useTabState` uses `useSearchParams`. **Chosen: pass `syncToUrl: false` to `useTabState`** — the /edit/runs page has only 2 tabs, no deep-link requirement, and avoids adding a Suspense boundary that would obscure the existing loading skeleton. Alternative rejected: wrapping in `<Suspense>` at page.tsx level (unnecessary complexity for 2 tabs).
  - [ ] Two tabs: `{id: 'variant', label: 'Improved article'}` (default) and `{id: 'diff', label: 'Diff'}`
  - [ ] Add `data-testid="edit-run-tabs-hydrated"` set via `useEffect` on the tab container — hardens `EditRunPage` POM against timing flake on cold navigations. `switchToDiffTab()` / `switchToVariantTab()` await this before clicking. (Rule 18 belt-and-suspenders even though `useTabState({syncToUrl: false})` avoids the useSearchParams Suspense issue.)
  - [ ] Variant tab body: `<ReactMarkdown components={editRunMarkdownComponents} urlTransform={sanitizeMarkdownUrl}>{winnerVariantContent}</ReactMarkdown>`
    - [ ] Create `src/app/edit/runs/[runId]/editRunMarkdownComponents.tsx` — component map for H1/H2/H3 → `font-display`, paragraphs → `atlas-body`, `strong` → `--accent-gold`, `code`/`pre` → mono, lists → styled
    - [ ] **XSS defense (Task #6) — safe-defaults contract in file header comment:**
      - NO `rehype-raw` plugin (would enable inline HTML injection)
      - NO `allowDangerousHtml` prop
      - NO `remark-html` plugin
      - Only trusted plugins: `remark-gfm` allowed (tables/strikethrough); `remark-math` / `rehype-katex` NOT included (out of scope)
    - [ ] Create `sanitizeMarkdownUrl(url: string, key: string, node): string | null` helper (colocated or in `src/lib/utils/sanitizeMarkdownUrl.ts`):
      - Allow schemes: `http:`, `https:`, `mailto:`
      - Reject: `javascript:`, `data:`, `vbscript:`, `file:`, and all other schemes
      - Reject relative URLs (variant is LLM output; no legitimate relative URL expected)
      - Return `null` for rejected URLs (react-markdown strips the href when null)
  - [ ] Diff tab body: existing `<SideBySideWordDiff parent={originalContent} variant={winnerVariantContent} leftLabel="Your text" rightLabel="Rewrite" />` (relabel "Evolved" → "Rewrite" per UX critique). **Grep for existing spec assertions on the string `Evolved`** and update them to `Rewrite` in the same commit (candidates: `edit-completed-run-handoff.spec.ts`, `EditRunViewer.test.tsx`).
- [ ] **Update reducer dispatch site (Task #8) — currently hardcoded to `''`:** `EditRunViewer.tsx:82-89` dispatch currently sets `strategyLabel: ''`. Change to `strategyLabel: result.data.strategyLabel ?? ''`. This is the load-bearing fix — plumbing the field through the action AND through the reducer without this dispatch update means the meta strip renders an empty label.
- [ ] Update `POLL_COMPLETED` reducer handler (`editPageLifecycleReducer.ts:73-81`) to read `strategyLabel` from the action payload (already in the interface at line 21-28, just needs to be threaded from the extended action shape)
- [ ] Update `makeStatusResponse` test helper in `EditRunViewer.test.tsx:41-53` to include the new `strategyLabel` field (backward-compat default `null`)
- [ ] Sanity check the "Edit something else" CTA position; no other CTAs added per user (did not opt into "Try another strategy")

### Phase 4: Tests — POMs + spec updates + seed-fixture reconciliation

**Seed strategy fix (Task #3, revised in iter 2): use Playwright route-mock for `edit-submit-flow.spec.ts`.** Options considered:
- (a) `is_seed_smoke=true` bypass column — schema change; over-engineered
- (b) service-role inline seed with `is_test_content=true` — **REJECTED (iter 2)**: seeded strategy fails BOTH `listPublicStrategiesAction` AND `submitPublicEditAction` whitelist (both filter `is_test_content=false`), making the submit fail
- (c) service-role inline seed with `is_test_content=false` + real-model name — REJECTED: strategy would leak into real users' pickers between test runs
- (d) add test-only allowlist env var — REJECTED: bespoke code path, drift risk
- **(e) Playwright `page.route()` mock of both `submitPublicEditAction` and `getEditRunStatusAction` (chosen)** — spec exercises client-side flow only (form submit → redirect → polling handler → viewing render); no strategy row seeded, no server-action reached, no cleanup needed. Loses server-action coverage in this spec BUT the new integration test `public-edit-widen-filter.integration.test.ts` covers `submitPublicEditAction` end-to-end with real strategies + real DB.

With the mock-model filter (Q6) and widened filter (Q2), the currently-seeded `Public Edit Smoke` will be excluded from the picker and fail the whitelist re-check at submit. `edit-submit-flow.spec.ts` currently does `page.locator('[data-testid^="strategy-option-"]').first().click()` — after the widened filter this would click a REAL strategy and trigger real minicomputer LLM spend on CI. Fix: route-mock the submit action so the spec never reaches the server action.

**Test hygiene fixes (Task #10):** Rule 18 hydration gate on combobox POM, Rule 16 afterAll cleanup on new integration tests, `@critical` budget re-tag for expanded picker spec, Rule 4 Locator naming for POM getters, empty-state coverage.

**Fixture + spec updates:**

- [ ] Modify `edit-submit-flow.spec.ts`:
  - [ ] Add `beforeEach`: `await page.route('**/edit/publicEditActions*', route => route.fulfill({ ... }))` — mock both `submitPublicEditAction` (returns fake `runId`) and `getEditRunStatusAction` (returns a completed status with fixture `originalContent`/`winnerVariantContent`/`strategyLabel`/`costSpent`/`etaSeconds`). Server actions in Next.js are invoked via POST to their route; use a URL matcher for the specific action.
  - [ ] Test types article, clicks first picker option (any real strategy — doesn't matter which since submit is mocked), submits; assert redirect to `/edit/runs/<fake-runId>` and viewing-phase render
  - [ ] Remove the existing `test.skip(!hasPublicStrategy, ...)` fallback (lines 58-62) — mock guarantees the flow proceeds regardless of DB state
  - [ ] No `afterAll` cleanup needed (nothing written to DB)
  - [ ] Rule 10: call `await page.unrouteAll({ behavior: 'wait' })` in `afterEach` to prevent handler stacking across tests
- [ ] **Deprecate `evolution/scripts/seedPublicEditE2EStrategy.ts`**: add DEPRECATED header comment. Grep-verified: no active call sites in `.ts`/`.tsx`/`.yml`/`.json` outside the file itself, so no other cleanup needed. The pre-existing mock strategy row it may have seeded on staging is orphaned — one-time cleanup query in a follow-up (out of scope here). The mock-model filter (Q6) prevents it from ever surfacing in the widened picker.

**POMs (Task #10 — Rule 4, Rule 12, Rule 18):**

- [ ] Add `src/__tests__/e2e/helpers/pages/EditPage.ts` extending `BasePage`
  - [ ] Selectors: `strategyComboboxTrigger`, `strategyComboboxHydrated` (from Phase 2 useEffect), `strategyComboboxSearchInput`, `strategyOption(id)`, `strategyOptionShowConfigButton(id)`, `strategyOptionBudgetWarning(id)`, `strategyConfigModal`, `strategyConfigModalCloseButton`, `editTextarea`, `editSubmit`, `editFormNoStrategies` (empty-state)
  - [ ] Actions: `openCombobox()` — **awaits `strategyComboboxHydrated` before clicking trigger** (Rule 18), `searchStrategies(q)`, `selectStrategy(id)`, `openStrategyConfig(id)`, `closeStrategyConfig()`, `typeArticle(text)`, `submit()`
  - [ ] Each action awaits its post-condition (Rule 12)
- [ ] Add `src/__tests__/e2e/helpers/pages/EditRunPage.ts` extending `BasePage`
  - [ ] Selectors: `runViewing`, `metaStrip`, `variantTab`, `diffTab`, `variantTabContent`, `diffTabContent`, `sxsDiff`
  - [ ] Actions returning `Locator` (NOT `Promise<string>`) per Rule 4 + ESLint `flakiness/no-point-in-time-pom-helpers` (**confirmed present at `eslint.config.mjs:56` as error-level**):
    - `strategyLabelLocator(): Locator` (not `getStrategyLabel(): Promise<string>`)
    - `costTextLocator(): Locator`
    - `durationTextLocator(): Locator`
  - [ ] Action methods with waits: `switchToDiffTab()` awaits `diffTabContent` visible; `switchToVariantTab()` awaits `variantTabContent` visible

**Spec updates:**

- [ ] Update `src/app/edit/runs/[runId]/EditRunViewer.test.tsx` jest spec:
  - [ ] Replace `diff-viewer-mock` assertions (lines 16-18, 118-124, 130-153) with tab-aware assertions
  - [ ] Mock `EntityDetailTabs` as a passthrough that renders all tab bodies (easier than driving tab state); assert both tab bodies mount
  - [ ] Update `makeStatusResponse` helper (lines 41-53) to include the new `strategyLabel` field (default `null` for backwards-compat)
  - [ ] Assert `strategyLabel` copy renders when populated
  - [ ] Assert meta strip renders `cost.toFixed(2)` when `costSpent != null`, hidden otherwise
- [ ] Update `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` to use `EditPage` POM (no behavioral change; assertions same)
- [ ] Update `edit-submit-flow.spec.ts` to use `EditPage` POM (in addition to seed-fixture refactor above)
- [ ] Update `edit-completed-run-handoff.spec.ts:128-141` to use `EditRunPage` POM; add assertions: variant tab default-active, diff tab switchable, meta strip visible with strategy label

**`@critical` budget re-tag (Task #10):**

- [ ] Split `edit-form-smoke.spec.ts`. Keep bare-form-render + submit-enable + noindex assertions under `{tag: '@critical'}` (target <30s). Extract combobox open/close + search + select + `[Show config]` opens modal + config-card render + budget-warning-badge assertions to a new file `src/__tests__/e2e/specs/12-edit/edit-picker-interactions.spec.ts` under `{tag: '@evolution'}` (runs in PR CI evolution slot; not on every main PR). **Target: <60s wall-clock for the new spec** (measured locally + in CI on first run; extract slow assertions to a separate spec if exceeded).

**New unit + integration tests:**

- [ ] Unit test `evolution/src/services/strategyRegistryActions.test.ts` (or add to existing test file):
  - [ ] With `PUBLIC_EDIT_WIDEN_FILTER=false`: fixture 3 strategies (public-visible active, non-public-visible active, mock active) → only public-visible active returned (control)
  - [ ] With `PUBLIC_EDIT_WIDEN_FILTER=true`: same fixture → both non-mock active returned; mock excluded
  - [ ] Cache invalidation: status flip on a strategy invalidates cache (assert next call re-queries)
  - [ ] Env-toggle mechanics: use `jest.replaceProperty(process.env, 'PUBLIC_EDIT_WIDEN_FILTER', 'true')` per-test (relies on per-invocation env read in `publicStrategyFilter.ts` — see Phase 1 helper spec)
- [ ] Unit test `evolution/src/services/getPublicStrategyConfigAction.test.ts`:
  - [ ] Returns full StrategyConfig for a passing strategy
  - [ ] Throws `NotPubliclySubmittableError` with code `MOCK_MODEL` for mock-model strategy
  - [ ] Throws with code `STATUS` for archived strategy
  - [ ] Throws with code `TEST_CONTENT` for test-content strategy
  - [ ] Feature-flag gated: with `PUBLIC_EDIT_WIDEN_FILTER=false`, throws `PUBLIC_VISIBLE` for non-public strategy; with `true`, passes
- [ ] Unit test `src/lib/utils/sanitizeMarkdownUrl.test.ts` (Task #6). Colocate the helper here (canonical location — not with the component-map file):
  - [ ] `javascript:alert(1)` → returns `null`
  - [ ] `data:text/html,<script>...</script>` → `null`
  - [ ] `vbscript:...` → `null`
  - [ ] `file:///etc/passwd` → `null`
  - [ ] `/relative/path` → `null` (LLM output should not produce relative URLs)
  - [ ] `//evil.com/path` → `null` (protocol-relative URL — inherits current page scheme)
  - [ ] `#fragment` → `null` (no legitimate fragment-only URL in LLM output)
  - [ ] `''` (empty string) → `null`
  - [ ] `mailto:foo@bar%0aBcc:evil@x.com` → `null` (CRLF injection in mailto header)
  - [ ] `https://example.com` → returns the URL unchanged
  - [ ] `http://example.com` → returned
  - [ ] `mailto:foo@bar.com` → returned
- [ ] Unit test for react-markdown XSS (colocate with `editRunMarkdownComponents.test.tsx`):
  - [ ] Fixture: `winnerVariantContent = 'Hello <script>alert(1)</script> world'` → rendered DOM contains the text `<script>alert(1)</script>` as escaped text, NOT a script element
  - [ ] Fixture: markdown link with `javascript:` href → rendered anchor has no href (or href stripped)
- [ ] Integration test `src/__tests__/integration/public-edit-widen-filter.integration.test.ts`:
  - [ ] `beforeAll`: service-role seed 3 hermetic strategies (real+active+public-visible, real+active+non-public-visible, mock+active); track ids
  - [ ] `afterAll`: cascade delete all seeded strategies + child runs (Rule 16)
  - [ ] Test: with `PUBLIC_EDIT_WIDEN_FILTER=false` → only the public-visible strategy is returned by `listPublicStrategiesAction`; `submitPublicEditAction` accepts it and rejects the other two
  - [ ] Test: with `PUBLIC_EDIT_WIDEN_FILTER=true` → both non-mock active strategies returned; `submitPublicEditAction` accepts them; mock-model strategy rejected with `INVALID_STRATEGY_MODEL` structured error
- [ ] Integration test `src/__tests__/integration/public-edit-budget-reservation.integration.test.ts`:
  - [ ] `beforeAll`: seed a hermetic strategy with `budgetUsd=1.00`; test that `submitPublicEditAction` inserts an `evolution_runs` row with `budget_cap_usd=1.00` (not `0.10`)
  - [ ] `afterAll`: cleanup
- [ ] Integration test `src/__tests__/integration/public-edit-per-ip-reserve.integration.test.ts`:
  - [ ] Seed hermetic strategy with `budgetUsd=1.00`; run submitPublicEditAction once; assert per-IP reservation is `$1.00` (not `$0.10`)
  - [ ] Second submission from same IP with `budgetUsd=$5.00` strategy: assert rejected if per-IP cap is $5 and $1 already reserved

### Phase 5: Documentation updates
- [ ] `evolution/docs/architecture.md` § Entry Point #5 — result now rendered as tabs (variant + diff), not bare `SideBySideWordDiff`. Note `PUBLIC_EDIT_WIDEN_FILTER` env var + new per-strategy `budgetUsd` cap semantics.
- [ ] `evolution/docs/strategies_and_experiments.md` — `listPublicStrategiesAction` filter widened behind env flag; mock-model exclusion (`config.generationModel !== 'mock'`); per-strategy `budgetUsd` is the effective per-run cap; `PUBLIC_VISIBLE_BUDGET_CAP_USD` marked DEPRECATED (vestigial pending follow-up cleanup PR).
- [ ] `evolution/docs/visualization.md` — `StrategyConfigDisplay` moved to `src/components/strategy/`; now used by public `/edit` picker via `getPublicStrategyConfigAction`.
- [ ] `docs/feature_deep_dives/state_management.md` — `strategyLabel` field is now live (was dead); populated from `getEditRunStatusAction` join.
- [ ] `docs/feature_deep_dives/llm_spending_gate.md` — per-run `PER_RUN_BUDGET_CAP_USD` removed; per-run cap now = strategy's `config.budgetUsd`. Per-IP cap raised $0.50 → $5.00; per-region cap raised $5 → $50. Reserve amount = full strategy budgetUsd (not $0.10). Feature-flagged behind `PUBLIC_EDIT_WIDEN_FILTER`.
- [ ] `evolution/docs/variant_lineage.md` — no change (variant detail page still uses the same `SideBySideWordDiff`)
- [ ] `evolution/docs/editing_agents.md` + `evolution/docs/paragraph_recombine.md` — no change (both strategies now surfaceable in the public picker but their docs don't need to mention that)
- [ ] `docs/feature_deep_dives/lexical_editor_plugins.md` — no change (react-markdown ≠ Lexical; different render path)
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — no change
- [ ] `_progress.md` follow-up section — record 3 out-of-scope items for future PRs: (1) `PublicVisibleToggle` UI + `PUBLIC_VISIBLE_BUDGET_CAP_USD` constant + `public_visible` column cleanup; (2) one-time cleanup of orphaned `Public Edit Smoke` seed row; (3) `evolution/scripts/seedPublicEditE2EStrategy.ts` file deletion after all CI setup scripts stop calling it.

## Testing

Full test list is in **Phase 4** above (POMs, spec updates, seed-fixture reconciliation, new unit + integration tests). This section is a categorical index for quick scanning:

### Unit Tests (see Phase 4 for details)
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — feature-flag-gated filter; cache invalidation on status flip
- [ ] `src/lib/utils/sanitizeMarkdownUrl.test.ts` — URL scheme allowlist; relative-URL rejection
- [ ] `src/app/edit/runs/[runId]/editRunMarkdownComponents.test.tsx` — react-markdown XSS; javascript: link stripping
- [ ] `src/reducers/editPageLifecycleReducer.test.ts` — POLL_COMPLETED plumbs `strategyLabel`; backwards-compat when null
- [ ] `src/app/edit/runs/[runId]/EditRunViewer.test.tsx` — tabs mount; meta strip renders; both tab bodies present; `makeStatusResponse` updated
- [ ] `src/app/edit/EditForm.test.tsx` (new) — combobox extend; `renderOption` prop; `[Show config]` doesn't select
- [ ] `src/components/strategy/StrategyConfigDisplay.test.tsx` — move existing test alongside the moved component
- [ ] `src/components/ui/combobox.test.tsx` — new `renderOption` prop covered

### Integration Tests (see Phase 4)
- [ ] `public-edit-widen-filter.integration.test.ts` — feature-flag gating end-to-end; mock exclusion; per-cache invalidation
- [ ] `public-edit-budget-reservation.integration.test.ts` — `evolution_runs.budget_cap_usd` = strategy budgetUsd
- [ ] `public-edit-per-ip-reserve.integration.test.ts` — per-IP reservation uses full strategy budgetUsd; second submission rejected when cap exceeded

### E2E Tests (see Phase 4)
- [ ] `edit-flow.spec.ts` (@critical) — refactored to `EditPage` POM
- [ ] `edit-form-smoke.spec.ts` (@critical, trimmed) — bare-form-render smoke only
- [ ] `edit-picker-interactions.spec.ts` (@evolution, new) — combobox + `[Show config]` + budget-warning + modal interactions
- [ ] `edit-submit-flow.spec.ts` — beforeAll seeds hermetic `[E2E_INLINE]` strategy; afterAll cleanup (Rule 16); submit via strategy id, not picker `.first()`
- [ ] `edit-completed-run-handoff.spec.ts` — refactored to `EditRunPage` POM; variant tab default-active; diff switchable
- [ ] `edit-host-isolation.spec.ts` — no changes

### Manual Verification (on staging with `PUBLIC_EDIT_WIDEN_FILTER=true`)
- [ ] `/edit` combobox lists N > 1 strategies (real active non-mock); empty-state branch when N=0
- [ ] Click `[Show config]` on a strategy row: modal opens with `StrategyConfigDisplay` (Models/Iterations cards); combobox does NOT change selection; close returns to combobox
- [ ] Pick a strategy with `budgetUsd > $0.10`: verify ⚠ badge in picker AND inside config modal
- [ ] Submit a rewrite: variant tab is default-active with prose rendering (headings, bold, lists render correctly)
- [ ] Switch to Diff tab: `SideBySideWordDiff` renders unchanged with "Your text" / "Rewrite" labels
- [ ] Meta strip renders: `Rewrote with '{strategyLabel}' · $X.XX · {N}s`
- [ ] **Cost cap sanity:** submit one $5-budgetUsd strategy from a fresh IP; verify per-IP cap ($5) is fully reserved; second submission from same IP with any strategy is rejected (cap exhausted)
- [ ] **Rollback drill:** flip `PUBLIC_EDIT_WIDEN_FILTER=false` on staging; verify picker reverts to only `public_visible=true` strategies within 60s (cache TTL). **In-flight submits during flip:** `submitPublicEditAction` re-reads env per invocation (per Phase 1 spec), so requests already IN-flight when the flag flips still complete against whatever env value was live at submit time. Runs already-inserted into `evolution_runs` continue to run regardless of picker filter changes. Document this in the runbook so ops knows to expect a brief overlap window.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/` — full 12-edit spec directory passes locally
- [ ] Run on local server via `npm run test:e2e` (which triggers `ensure-server.sh` per project convention)
- [ ] Screenshot both tabs of viewing phase for visual regression baseline

### B) Automated Tests
- [ ] `npm run lint` + `npm run typecheck` + `npm run build`
- [ ] `npm test -- src/reducers/editPageLifecycleReducer src/app/edit src/components/strategy src/components/ui/combobox src/lib/utils/sanitizeMarkdownUrl evolution/src/services/strategyRegistryActions` — unit tests for touched code
- [ ] `npm run test:integration -- public-edit-widen-filter public-edit-budget-reservation public-edit-per-ip-reserve` — new integration tests
- [ ] `npm run test:e2e -- src/__tests__/e2e/specs/12-edit/` — all 12-edit specs (mix of @critical and @evolution post-split)
- [ ] `npm run test:hooks` — no hook changes expected but sanity-check
- [ ] **No migration** — this project touches no `supabase/migrations/**` files, so `/finalize` Step 5.5 `npm run migration:verify` is skipped automatically. Confirmed via git status inspection prerequisite in `/finalize`.

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
