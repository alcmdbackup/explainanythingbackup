# Build Website for Evolution Plan

## Background
Help me build a user facing website for evolution.

## Requirements (from GH Issue #1293)
Build a front-end and stop experimenting.

- Choose a good URL.
- User can paste in any article.
- It can run a pipeline using a set strategy that is selectable via the UI.
- Can see final output, and a diff against the initial input side-by-side. Following the existing pattern on variant details tab for diff against parent.

## Problem
The evolution pipeline has no user-facing surface — every entry point (admin UI, `/api/evolution/run`, batch runner, local script) is admin-gated. There is no way for an unprivileged visitor to paste in an article, pick a strategy, run it, and see the improved output side-by-side with the original. The hypothesis: a public-facing website fronting the pipeline turns evolution from an experiment into a product, exposing whether the quality gains are useful to real readers/writers rather than just measurable on the leaderboard.

While building this surface, the existing `LLMSpendingGate.checkPerUserCap` mechanism has known gaps that became material once user-controlled spend is in scope: fail-open behavior on DB errors, no reserve-before-spend semantics, a magic-number `10` at the call site. Those gaps are addressed in Phase 0 of this same PR so the public surface ships on top of a hardened gate.

## Decisions Locked (see _research.md for trade-off analysis)

| # | Decision | Detail |
|---|---|---|
| 1 | Hosting | Option A — path `/edit` on `explainanything.vercel.app` (existing public host). Add `/edit` to `PUBLIC_PREFIXES` in `src/config/hostnames.ts`. |
| 2 | URL path | `/edit` |
| 3 | Execution | Async via existing minicomputer queue (`processRunQueue.ts`, 60s poll). POST inserts a `pending` `evolution_runs` row, returns `runId`; client polls until `status='completed'`. |
| 4 | Strategy whitelist | New `public_visible BOOLEAN` column on `evolution_strategies` (default `false`). Editable from admin UI inline on strategy list page + on strategy detail page. New `listPublicStrategiesAction` for `/edit` picker. |
| 5 | Rate-limit infra | Upstash Redis KV. Per-IP daily $ spending cap ($0.50/day default) + per-region daily $ spending cap ($5/day default per country), both via `INCRBYFLOAT` with 24h TTL. Layers on top of hardened per-user + global gates. |
| 6 | Per-run cap | `evolution_runs.budget_cap_usd = $0.10` for /edit submissions. Strategy whitelist eligibility predicate: `strategy.config.budgetUsd <= $0.10`. |
| 7 | Auth | Fully unauthed. `callLLM` receives `userid='public_edit_anonymous'` sentinel. No middleware change to guest auto-login — `/edit` simply doesn't depend on it. Run-result viewing via `/edit/runs/{runId}` URL (UUID is unguessable; results contain visitor's own text). |
| 8 | Admin gap | Fix `queueEvolutionRunAction` to validate `explanationId` against `explanations` table (currently only validates `promptId`). Share the validator with the new public-side insert helper. |
| 9 | Picker UX | Name + short description only on the strategy picker. No cost/runtime preview. Curate display names to hint at trade-offs. |
| 10 | Retention | Keep forever. No UI for deletion. Privacy note in page footer ("Your text + the result are saved so we can improve the system. Don't paste anything sensitive."). |
| Scope | Single PR | Includes Phase 0 gate hardening (gaps 1, 2, 3, 5 from research). |

## Phased Execution Plan

### Phase 0: Harden the LLMSpendingGate (precondition)
The new public surface depends on a fail-CLOSED, reserve-before-spend gate. Land these fixes first within the PR so subsequent phases build on a correct foundation.

- [ ] **Gap 1 — fail-CLOSED**: replace the 3 silent-return sites in `src/lib/services/llmSpendingGate.ts:117-124, 143-147` with explicit `throw new GlobalBudgetExceededError(...)`. Tag thrown errors with `cause: 'gate_check_failed'` so Honeycomb can distinguish from real over-cap rejections.
- [ ] Add `LLM_GATE_PANIC_BYPASS` env var (mirror of `SEED_BYPASS_USER_CAP`). When `'true'`, all gate checks short-circuit; logs an audit line to stderr per call. NEVER set in any deployed env by default.
- [ ] **Gap 5 — configurable cap**: add `guest_user_daily_cap_usd`, `public_edit_per_ip_daily_usd`, `public_edit_per_region_daily_usd`, `public_edit_daily_cap_usd` keys to `llm_cost_config` table. Default values: $10, $0.50, $5, $15. Add `getPublicEditConfig()` helper using the existing config-read pattern (see `checkMonthlyCap` at `llmSpendingGate.ts:364`).
- [ ] Replace the hard-coded `10` at `src/lib/services/llms.ts:988` with the config-driven value.
- [ ] **Gap 2+3 — reserve-before-spend** for the per-user gate:
  - [ ] New migration: `reserve_per_user_daily_cost(p_user_id, p_date, p_estimated_cents) RETURNS jsonb` RPC. Atomic INSERT-ON-CONFLICT-UPDATE returning `{ok, dailyTotal, dailyCap}`. Mirrors `check_and_reserve_llm_budget` shape.
  - [ ] Add `reserveForUser(userid, estCost, capUsd)`, `recordActualForUser(userid, actualCents, reservedCents)`, `releaseForUser(userid, reservedCents)` to `LLMSpendingGate`. Mirror existing `reserveViaRpc` / `reconcileAfterCall` pattern.
  - [ ] Replace `checkPerUserCap` call site in `src/lib/services/llms.ts:988` with `reserveForUser`; wire reconcile into the existing `finally` block at `llms.ts:1008`.
  - [ ] Keep `checkPerUserCap` as deprecated read-only wrapper for one release cycle to ease rollback.
- [ ] Honeycomb alert: log structured `gate.fail_closed_rejected` events; wire to existing release-health alerting pattern (see `evolution-run-health.yml`).
- [ ] Add `LLM_GATE_FAIL_CLOSED_DISABLED` env var as kill-switch reverting to fail-open behavior; default `'false'` so the new behavior is on. Provides single-flip rollback without a code revert.

### Phase 1: Backend plumbing
- [ ] **Admin gap** (Q8): in `evolution/src/services/evolutionActions.ts:178-189`, add symmetric `explanationId` validation against `explanations` table. Extract to shared validator `validateRunContentRefs({explanationId?, promptId?})` and reuse from both admin path and new public action.
- [ ] **Strategy whitelist column** (Q4): migration adds `evolution_strategies.public_visible BOOLEAN NOT NULL DEFAULT false`. Add `idx_strategies_public_visible` partial index `WHERE public_visible = true`.
- [ ] Extend `updateStrategyAction` in `evolution/src/services/strategyRegistryActionsV2.ts` to accept `publicVisible` field. Server-side guard: refuse to set `public_visible=true` if `config.budgetUsd > 0.10` (matches per-run cap). Return a structured error so the admin UI can render a hint.
- [ ] New server action `listPublicStrategiesAction` in `evolution/src/services/strategyRegistryActionsV2.ts`. NOT admin-gated. Returns only `{id, label, description, generationModel, judgeModel, iterationCount}` for rows with `public_visible=true AND status='active' AND is_test_content=false`. Cache 60s in-memory.
- [ ] **Upstash gate** (Q5): new module `src/lib/services/perIpSpendingGate.ts`. Exports `reserveForIp(ip, estCost)`, `recordActualForIp(ip, actualCents, reservedCents)`, `releaseForIp(ip, reservedCents)`, plus equivalent `*ForRegion(country, ...)` family. Mirrors `LLMSpendingGate` shape; uses `@upstash/redis` `incrbyfloat` + `expire 86400`. Same fail-closed semantics as Phase 0.
- [ ] Helper to extract IP + region from request: `getClientGeo(request: NextRequest): {ip: string, country: string}`. Uses `request.ip` + `request.geo` (Vercel-populated); falls back to `'unknown'` outside Vercel.
- [ ] **New action `submitPublicEditAction`**: POST handler. Steps:
  1. Validate input: `{articleText: 1-50000 chars, strategyId: uuid}`
  2. Look up strategy via `listPublicStrategiesAction`; refuse if not public-visible
  3. `getClientGeo(request)` → `{ip, country}`
  4. `estRunCost = projectDispatchPlan(strategy.config, ...).expectedTotalCost` (already exists)
  5. Pre-submission affordability check (Gap 4): refuse with 429 if `estRunCost > min(remainingUserBudget, remainingIpBudget, remainingRegionBudget)`. Returns `Retry-After` derived from earliest cap reset.
  6. Reserve $est against per-IP + per-region gates (eager, not reconciled — over-projection is a feature for defense)
  7. Insert `evolution_explanations` row (`source='explanation'`, `title='[edit] <truncated>'`, `content=articleText`)
  8. Insert `evolution_runs` row: `{evolution_explanation_id, strategy_id, budget_cap_usd: 0.10, status: 'pending'}` plus a new column to mark its provenance (see next bullet)
  9. Return `{runId}`
- [ ] New `evolution_runs.run_source TEXT` column with allowed values `'admin' | 'minicomputer' | 'public_edit'`. Set explicitly at every existing insert site. Useful for: distinguishing public-edit traffic in cost-dashboards, filtering admin UI lists, future per-source policy (e.g. cleanup TTL if Q10 changes).
- [ ] **New action `getEditRunStatusAction({runId})`**: NOT admin-gated. Returns `{status, winnerVariantContent?, originalContent, errorMessage?, costSpent, etaSeconds?}`. Used by /edit results page polling. Looks up the run row + winning variant if `status='completed'`. No ownership check — anyone with a run-id UUID can read.
- [ ] **Wire `userid='public_edit_anonymous'` sentinel** through the public-edit code path. Since this is a constant string (not a UUID), confirm `LLMSpendingGate.checkPerUserCap` (now `reserveForUser`) and the `llmCallTracking` trigger handle non-UUID `userid` correctly. The trigger already does — `per_user_daily_cost_rollups.user_id` is `TEXT NOT NULL`, see migration 20260524000003 — so the sentinel collapses into a single shared rollup row, which is exactly what we want.
- [ ] Add `'public_edit_anonymous'` to the `is_test_content` filter exclusion list so the rollup doesn't get auto-cleaned by future test-data scripts.

### Phase 2: Frontend
- [ ] Page route: `src/app/edit/page.tsx`. Server component. Three subcomponents:
  - `EditForm` (client): textarea + strategy select + Submit button. Fetches strategies via `listPublicStrategiesAction` on mount.
  - `EditFormStrategyPicker`: renders `{label, description}` per strategy. No cost/runtime preview (Q9).
  - Privacy footer (Q10): "Your text + the result are saved. Don't paste anything sensitive."
- [ ] Page route: `src/app/edit/runs/[runId]/page.tsx`. Server component. Polls `getEditRunStatusAction(runId)` every 3s while `status ∈ {pending, claimed, running}`; renders `<SideBySideWordDiff parent={originalContent} variant={winnerVariantContent} leftLabel="Your text" rightLabel="Evolved" />` once `status='completed'`. Errors render with a friendly message + Retry link.
- [ ] Page state machine: new `editPageLifecycleReducer` mirroring the `pageLifecycleReducer` pattern (`src/reducers/pageLifecycleReducer.ts`). States: `idle → submitting → queued → running → viewing → error`. Selectors mirror existing convention (`isQueued`, `isRunning`, `getError`, etc.).
- [ ] **Middleware allowlist** (Q1): add `/edit` to `PUBLIC_PREFIXES` in `src/config/hostnames.ts:49-58`. Add a unit test in `src/middleware.test.ts` that hits the public host with path `/edit` and expects pass-through, hits the evolution host with `/edit` and expects 404.

### Phase 3: Admin UI for `public_visible`
- [ ] Strategy list page `src/app/admin/evolution/strategies/page.tsx`: add `Public visible` column with an inline toggle (`Checkbox` component). Toggle calls `updateStrategyAction({id, publicVisible})`. Disable toggle when `config.budgetUsd > 0.10` and show a tooltip ("Per-run budget exceeds $0.10 public cap"). Optimistic UI; revert on server error.
- [ ] Strategy detail page `src/app/admin/evolution/strategies/[id]/page.tsx`: add the same toggle in the strategy header card.
- [ ] List page filter chip "Public only" alongside the existing status/hide-test-content filters.
- [ ] Column is sortable; data-testid `strategy-public-visible-toggle` for E2E.

### Phase 4: Cost / safety polish
- [ ] Surface `run_source='public_edit'` filter in `/admin/costs` dashboard so ops can monitor public-edit spend separately. Reuse existing `getCostByEntityAction` pattern.
- [ ] Sentry `beforeSend` already tags every event with `site=public|evolution|preview|local|unknown`; add finer-grained `surface=edit` tag when path matches `/edit`. Helps triage public-edit issues vs the existing public flows.
- [ ] Honeycomb spans: confirm `'evolution_public_edit'` cost-source flows through the existing `evolution_*` tracing path (it does by prefix match).
- [ ] Privacy note + opt-out (Q10): add a Markdown line at the bottom of `/edit` and `/edit/runs/[runId]`. Link to a privacy section in the main site footer.
- [ ] Cleanup: ensure the existing `claim_evolution_run` test-content gate (`allow_test_execution=false` by default) lets `run_source='public_edit'` rows through — public-edit is real work, not test fixtures. The gate keys on strategy `is_test_content` so this should be automatic if we never set `public_visible=true` on a test strategy (enforced by the Phase 3 server-side guard).

## Testing

### Unit Tests
- [ ] `src/lib/services/llmSpendingGate.test.ts` — extend existing tests: fail-closed behavior (all 3 error sites throw), `LLM_GATE_PANIC_BYPASS` honors, reserve-before-spend (`reserveForUser`/`recordActualForUser`/`releaseForUser`) cycle with simulated concurrent calls, configurable cap reads from `llm_cost_config`.
- [ ] `src/lib/services/perIpSpendingGate.test.ts` (NEW) — Upstash mock (use `@upstash/ratelimit`'s in-memory primitive). Tests: `reserveForIp` returns reservation, exceeds cap throws, TTL expiry, `recordActualForIp` reconciles, `releaseForIp` frees, `getClientGeo` falls back to `'unknown'` outside Vercel.
- [ ] `evolution/src/services/strategyRegistryActionsV2.test.ts` — `listPublicStrategiesAction` filters correctly (returns only `public_visible=true AND status='active' AND is_test_content=false`); `updateStrategyAction` refuses `publicVisible=true` when `budgetUsd > 0.10`.
- [ ] `evolution/src/services/evolutionActions.test.ts` — admin-path `validateRunContentRefs` rejects unknown explanation_id (Q8 gap).
- [ ] `src/app/edit/publicEditAction.test.ts` (NEW) — `submitPublicEditAction` validates input, reserves IP+region gates, refuses if strategy not public, inserts both rows, returns runId. `getEditRunStatusAction` returns correct shape across pending/running/completed/failed states.
- [ ] `src/reducers/editPageLifecycleReducer.test.ts` (NEW) — state-machine transitions for idle → submitting → queued → running → viewing → error.

### Integration Tests
- [ ] `src/__tests__/integration/public-edit.integration.test.ts` (NEW) — end-to-end against staging DB with mocked LLM:
  - Submit a [TEST] strategy run via `submitPublicEditAction` with `allow_test_execution=true` flag
  - Verify `evolution_explanations` + `evolution_runs` rows created
  - Trigger `claimAndExecuteRun` directly (bypassing minicomputer)
  - Verify run completes, winner variant exists
  - `getEditRunStatusAction` returns the winner's content
- [ ] `src/__tests__/integration/llm-spending-gate-hardened.integration.test.ts` (NEW) — fail-closed: simulate missing rollup table → expect throw, NOT silent allow. Reserve-before-spend: 50 parallel calls at $9.50/cap, only the first one to bring total ≥ $10 should succeed and the rest reject.
- [ ] `src/__tests__/integration/strategy-public-visible.integration.test.ts` (NEW) — admin toggles `public_visible`; verify `listPublicStrategiesAction` reflects the change; verify cost-cap guard rejects toggling on a $0.20-budget strategy.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` (NEW, `@critical` tagged) — Playwright:
  - Visit `/edit` on public host
  - See strategy picker populated
  - Paste sample text + pick strategy + Submit
  - Mock the run to complete in 1s (E2E mode bypass)
  - Land on `/edit/runs/[runId]`
  - Assert `SideBySideWordDiff` renders with original on left, evolved on right
  - Assert testIDs `sxs-diff`, `sxs-parent`, `sxs-variant` are present
  - Assert privacy footer present
- [ ] `src/__tests__/e2e/specs/12-edit/edit-host-isolation.spec.ts` (NEW) — `/edit` returns 200 on `explainanything.vercel.app`, 404 on `ea-evolution.vercel.app`. Extends the existing `00-host-isolation/host-isolation.spec.ts` pattern.
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-public-toggle.spec.ts` (NEW, `@evolution`) — admin can flip the `public_visible` toggle inline on the strategy list page; toggle disabled for strategies with `budgetUsd > 0.10`.

### Manual Verification
- [ ] Local server + Playwright MCP: paste a 500-word article, pick a strategy, observe the diff renders matching the variant-details tab visual exactly (same fonts, same gutter, same color encoding).
- [ ] Local: trip the per-IP cap by submitting 6 runs from the same dev session → expect 429 on the 6th.
- [ ] Staging: enable `public_visible` on 2-3 curated strategies via the admin UI; manually verify they appear in the `/edit` picker.
- [ ] Staging: paste a real article + run a real strategy; confirm the minicomputer picks it up within ~60s and the result polls in.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/edit-flow.spec.ts` — full happy path on local dev server (managed via `ensure-server.sh`)
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/edit-host-isolation.spec.ts` — host gating works
- [ ] Visual check against `/admin/evolution/variants/[variantId]?tab=parent-diff` — same component, same look

### B) Automated Tests
- [ ] `npm test -- src/lib/services/llmSpendingGate.test.ts` — fail-closed + reserve-before-spend
- [ ] `npm test -- src/lib/services/perIpSpendingGate.test.ts` — Upstash gate
- [ ] `npm test -- src/app/edit/` — server actions + reducer
- [ ] `npm run test:integration -- --testPathPattern="public-edit"` — full integration
- [ ] `npm run test:integration -- --testPathPattern="llm-spending-gate-hardened"` — gate hardening
- [ ] `npx playwright test src/__tests__/e2e/specs/12-edit/` — E2E suite
- [ ] `npm run migration:verify` — confirms new migrations apply cleanly (Phase 0 + Phase 1)

## Documentation Updates
- [ ] `docs/feature_deep_dives/authentication_rls.md` — add `/edit` to the public-host route table; note the unauthed pattern + the `'public_edit_anonymous'` sentinel; document the `LLM_GATE_PANIC_BYPASS` + `LLM_GATE_FAIL_CLOSED_DISABLED` kill switches.
- [ ] `docs/feature_deep_dives/server_action_patterns.md` — add `submitPublicEditAction`, `getEditRunStatusAction`, `listPublicStrategiesAction` to the action catalog.
- [ ] `docs/feature_deep_dives/state_management.md` — add `editPageLifecycleReducer` next to the existing reducer documentation.
- [ ] `docs/docs_overall/design_style_guide.md` — likely unchanged (reusing existing components); confirm no new variant introduced.
- [ ] `docs/feature_deep_dives/markdown_ast_diffing.md` — note that `/edit` reuses `SideBySideWordDiff` without modification.
- [ ] `evolution/docs/architecture.md` — add `submitPublicEditAction → claimAndExecuteRun` as a fifth entry point alongside the existing four. Document the `run_source` column + values.
- [ ] `evolution/docs/data_model.md` — document `evolution_runs.run_source` + `evolution_strategies.public_visible` columns. Note the new `per_user_daily_cost_rollups` reservation semantics.
- [ ] `evolution/docs/strategies_and_experiments.md` — document the public-strategy whitelist mechanism + the admin UI toggle.
- [ ] `evolution/docs/visualization.md` — cross-link the new `/edit` public surface from the admin strategy list section; note the `Public visible` column.
- [ ] `evolution/docs/cost_optimization.md` — document the layered cap stack for public-edit (per-run / per-IP / per-region / per-user / global); document the new `llm_cost_config` keys.
- [ ] `evolution/docs/reference.md` — add new files (`perIpSpendingGate.ts`, `submitPublicEditAction`, etc.) + new env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LLM_GATE_PANIC_BYPASS`, `LLM_GATE_FAIL_CLOSED_DISABLED`).
- [ ] `docs/docs_overall/environments.md` — add `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` to the env-var reference table; note Upstash add-on provisioning in the Vercel section.
- [ ] (Other relevantDocs from `_status.json` are read for context but unlikely to require updates; verify during /finalize.)

## UI Mockups

Four key states for the `/edit` flow. All styling uses existing primitives — see "Design system alignment" below for exact class mappings.

### 1. `/edit` — idle (paste form)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │   ← <Navigation showSearchBar={false}/>
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         ┊  Edit anything.  ┊                                 │   ← atlas-display-section
│                                                                              │
│           Paste an article. Pick how it should be improved.                  │   ← atlas-ui muted
│           We'll rewrite it and show you exactly what changed.                │
│                                                                              │
│   ┌── How should we improve it? ─────────────────────────────────────────┐   │
│   │  ◉  Quick polish                                                     │   │   ← scholar-card,
│   │     Tighten wording. Improve sentence flow. No new content.          │   │     gold border on selected
│   │                                                                      │   │
│   │  ○  Deep refine                                                      │   │
│   │     Strengthen structure, add clarifying examples, polish tone.      │   │
│   │                                                                      │   │
│   │  ○  Make it punchier                                                 │   │
│   │     Cut redundancy. Sharper sentences. Same ideas, less prose.       │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌── Your text ─────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   Paste anything here. An article, an essay, a draft email…         │   │   ← atlas-body, rounded-none,
│   │                                                                      │   │     search-focus-glow
│   │                                                                      │   │     (mirrors HomeSearchPanel)
│   │                                                       1,247 / 50,000 │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│                              ┌───────────────────┐                           │
│                              │     Improve →     │                           │   ← atlas-button
│                              └───────────────────┘                           │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────      │
│   Your text and the result are saved so we can improve the system.           │   ← atlas-body text-muted
│   Don't paste anything sensitive.                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2. `/edit/runs/[runId]` — queued / running

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│                              ✦  ✦  ✦                                         │   ← quill-write animation
│                                                                              │
│                       Rewriting your text…                                   │   ← atlas-display-section
│                                                                              │
│                    Quick polish · 0:42 elapsed                               │   ← atlas-ui muted
│                                                                              │
│       This usually takes one to three minutes. We'll show the result          │
│       here when it's ready — you can keep this tab open or come back          │
│       to this URL later.                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Status text cycles by poll response:
- `status=pending` → "Queued… (~30s until pickup)"
- `status=claimed` → "Starting up…"
- `status=running` → "Rewriting your text…"

### 3. `/edit/runs/[runId]` — viewing the diff

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│   ╭──── Quick polish · finished in 1m 24s ────────────────────────────╮     │   ← scholar-card,
│   ╰────────────────────────────────────────────────────────────────────╯     │     paper-texture
│                                                                              │
│   ┌── Your text ──────────────────┐  ┌── Evolved ───────────────────────┐    │   ← SideBySideWordDiff
│   │                               │  │                                  │    │     (reused verbatim;
│   │  Quantum entanglement is one  │  │  Quantum entanglement, one of    │    │      leftLabel / rightLabel
│   │  of the strangest phenomena   │  │  the strangest phenomena in      │    │      overridden to
│   │  in physics. When two particles│  │  physics, occurs when two       │    │      "Your text" /
│   │  become entangled, measuring  │  │  particles become entangled —    │    │      "Evolved")
│   │  one of them instantly affects│  │  measuring one instantly         │    │
│   │  the other, no matter ̶h̶o̶w̶ ̶f̶a̶r̶ │  │  affects the other, regardless  │    │   ← removed words struck red
│   │  ̶a̶p̶a̶r̶t̶ ̶t̶h̶e̶y̶ ̶a̶r̶e̶.             │  │  of distance.                    │    │     on left, added green on
│   │                               │  │                                  │    │     right (identical to the
│   │  Einstein famously called this│  │  Einstein famously called this   │    │     variant-details "Diff vs
│   │  "spooky action at a distance,│  │  "spooky action at a distance,"  │    │     parent" tab)
│   │  ̶a̶ ̶t̶e̶r̶m̶ ̶t̶h̶a̶t̶ ̶s̶t̶u̶c̶k̶."        │  │  and the name stuck.             │    │
│   │  …                            │  │  …                               │    │
│   └───────────────────────────────┘  └──────────────────────────────────┘    │
│                                                                              │
│                                ▼ Show full                                   │   ← sxs-expand-toggle
│                                                                              │
│        ┌─────────────────┐    ┌─────────────────┐                            │
│        │  Try a different│    │  Edit something │                            │
│        │     style       │    │      else       │                            │
│        └─────────────────┘    └─────────────────┘                            │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────      │
│   Your text and the result are saved so we can improve the system.           │
│   Don't paste anything sensitive.                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

"Try a different style" → `/edit` with original text pre-filled + strategy reset, so users can swap strategies cheaply without re-pasting.

### 4. `/edit/runs/[runId]` — error

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ExplainAnything                                          Search   Library   │
├──────────────────────────────────────────────────────────────────────────────┤
│   ← Edit another                                                             │
│                                                                              │
│                              ⚠                                                │   ← text-copper
│                                                                              │
│                    Something went wrong.                                     │   ← atlas-display-section
│                                                                              │
│       The rewrite hit a snag part-way through. Your text wasn't              │   ← atlas-body
│       saved past this attempt — try again with the same or a different       │
│       style.                                                                 │
│                                                                              │
│                              ┌───────────────────┐                           │
│                              │     Try again →   │                           │   ← atlas-button
│                              └───────────────────┘                           │
│                                                                              │
│        Reference: run_a8c2f4e1                                               │   ← atlas-ui text-xs
│                                                                              │     (click-to-copy)
└──────────────────────────────────────────────────────────────────────────────┘
```

Internal failure codes (`BudgetExceededError`, `LLMKillSwitchError`, etc.) all map to the same non-technical copy. The `run_id` reference is the support hook back to logs.

## Design System Alignment

Verified against `src/app/page.tsx` + `src/components/home/HomeSearchPanel.tsx` to confirm `/edit` uses the **same primitives the public site uses today**, not the newer shadcn / `font-display` patterns from the design-style-guide quick reference. The guide explicitly endorses this: *"Use `atlas-display` for hero/landing pages and `atlas-display-section` for section pages (Settings, Explore, My Library) to maintain visual hierarchy."* `/edit` is a section page.

| `/edit` element | Class / Component (matches public-site convention) |
|---|---|
| Page shell | `min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture` |
| Top nav | `<Navigation showSearchBar={false} />` (existing, no changes) |
| Container | `container mx-auto px-8 max-w-2xl` (matches home) |
| H1 ("Edit anything") | `atlas-display-section text-[var(--text-primary)]` + `atlas-animate-fade-up stagger-1` |
| Subtitle | `atlas-ui text-[var(--text-muted)] tracking-wide` + `stagger-2` |
| Strategy radio cards | `.scholar-card` + `.scholar-card-hover`; selected = `border-gold`; titles in `atlas-ui`, descriptions in `atlas-body text-[var(--text-muted)]` |
| Textarea | `bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] atlas-body rounded-none search-focus-glow px-6 py-4` (mirrors `HomeSearchPanel:116`) |
| Char count | `atlas-ui text-xs text-[var(--text-muted)]` |
| Submit button | `atlas-button` (matches `HomeSearchPanel:126`) — NOT the new shadcn `<Button variant="scholar">`, because the public site hasn't migrated and consistency matters more |
| Submit loading | `atlas-loading-dots` + 3× `atlas-loading-dot` (matches `HomeSearchPanel:128-133`) |
| Privacy footer | `atlas-body text-sm text-[var(--text-muted)]` with `border-t border-[var(--border-default)]` divider |
| Results header card | `.scholar-card paper-texture rounded-book shadow-warm-md` |
| `SideBySideWordDiff` | unchanged; component-internal styling already correct |
| Loading animation | `quill-write` keyframe (existing) |
| Error glyph | `text-copper` |
| Card entrance | `atlas-animate-fade-up stagger-1/2/3` for sequential reveal |

**ESLint compatibility:** every class above is on the project's atlas / scholar / design-token allowlist. The custom rules in `eslint-rules/design-system.js` (`no-hardcoded-colors`, `prefer-warm-shadows`, `enforce-prose-font`, etc.) all pass on this mapping. No design-system-rule exceptions needed for `/edit`.

**Visual consistency check:** the `/edit` page, when loaded next to `/` (Home), `/results`, `/userlibrary`, should feel like the same product surface — same fonts, same warm cream, same paper texture, same nav. The atlas-class binding is what guarantees that.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
