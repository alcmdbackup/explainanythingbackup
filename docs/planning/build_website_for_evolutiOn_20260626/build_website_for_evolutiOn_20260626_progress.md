# Build Website for Evolution Progress

## Phase 0: LLM Spending Gate Hardening (PR-blocking prerequisite)
### Work Done
- Added `LLM_GATE_FAIL_CLOSED_DISABLED` + `LLM_GATE_PANIC_BYPASS` env kill switches to `src/lib/services/llmSpendingGate.ts`.
- Added `reserveForUser` / `recordActualForUser` / `releaseForUser` per-user reserve-before-spend APIs backed by new `per_user_daily_reservations` table (PK `(date, user_id)`, decoupled from `call_source`).
- `src/lib/services/llms.ts:988` swapped from `checkPerUserCap` to `reserveForUser(...await getGuestUserCap())` with finally-block reconcile.
- `evolution/scripts/processRunQueue.ts` calls `cleanupOrphanedPerUserReservations()` once before the while loop.
- `eslint.config.mjs` `no-restricted-imports` rule blocks any new `checkPerUserCap` callers.
- New deep-dive `docs/feature_deep_dives/llm_spending_gate.md`.
- Migration `20260627000001_llm_cost_config_public_edit_keys.sql` (4 new caps).
- Migration `20260627000002_per_user_daily_reservations.sql` (table + 3 RPCs).

### Issues Encountered
- Iter-3 of /plan-review caught that the original UPSERT pattern could not atomically reject; rewrote to mirror `check_and_reserve_llm_budget`'s `SELECT … FOR UPDATE` pattern.
- Iter-3 also caught a `call_source` scoping mismatch — moved to a dedicated table.

## Phase 1: Backend Plumbing
### Work Done
- `src/lib/services/perIpSpendingGate.ts` (Upstash adapter + injectable KvAdapter for tests + `getClientGeo` reading `x-forwarded-for` + `x-vercel-ip-country`).
- Migration `20260627000003_evolution_strategies_public_visible.sql` adds `public_visible BOOLEAN NOT NULL DEFAULT false` + composite partial index.
- Migration `20260627000004_evolution_runs_run_source.sql` adds `run_source TEXT NOT NULL DEFAULT 'admin'` with CHECK enum + backfill via runner_id prefix.
- `evolution/src/services/publicAction.ts` factory mirroring `adminAction` minus `requireAdmin()`.
- `src/app/edit/publicEditActions.ts`: `submitPublicEditAction` (BotID → validate → strategy lookup → geo + affordability → per-IP/region reserve → createTopic → explanations insert → evolution_runs insert with run_source='public_edit'), `getEditRunStatusAction`, `listPublicStrategiesAction`.
- Updated `src/config/hostnames.ts` `PUBLIC_PREFIXES` to include `/edit`.

### Issues Encountered
- NextRequest.ip/.geo don't exist in Next.js 15 → rewrote getClientGeo using headers + `x-vercel-id` trust assertion.
- `explanations` schema required `primary_topic_id BIGINT NOT NULL` (no default) → mirror `processImport` and createTopic per submission.

## Phase 2: Frontend
### Work Done
- `src/app/edit/page.tsx` (server component fetching strategies + EditDisabledNotice).
- `src/app/edit/EditForm.tsx` (client form with `atlas-*` legacy CSS classes).
- `src/app/edit/runs/[runId]/page.tsx` + `EditRunViewer.tsx` (polling client with `SideBySideWordDiff`, noindex/no-referrer).
- `src/reducers/editPageLifecycleReducer.ts` state machine: idle → submitting → queued → running → viewing → error.
- `next.config.ts` wrapped in `withBotId()`; `/instrumentation-client.ts` at repo root with `initBotId({protect:[{path:'/edit',method:'POST'}]})`.

## Phase 3: Admin UI (Strategy Public-Visible Toggle)
### Work Done
- `src/app/admin/evolution/strategies/PublicVisibleToggle.tsx` inline toggle, optimistic UI, server cost-cap guard (`PUBLIC_VISIBLE_BUDGET_TOO_HIGH`).
- `updateStrategyAction` extended to handle `publicVisible` with structured rejection codes.
- E2E spec `09-admin/admin-evolution-strategy-public-toggle.spec.ts`.

## Phase 4: Cost, Safety, Polish
### Work Done
- `sentry.server.config.ts` adds `surface=edit` tag + PII strip (articleText scrubbed in `beforeSend`).
- `playwright.config.ts` injects `BOT_PROTECTION_DISABLED=true` + `PUBLIC_EDIT_RATE_LIMIT_DISABLED=true` for E2E.
- E2E specs `12-edit/edit-host-isolation.spec.ts`, `edit-form-smoke.spec.ts`, `edit-flow.spec.ts`.
- Seed script `evolution/scripts/seedPublicEditE2EStrategy.ts` (idempotent, name avoids `[TEST]`/`[E2E]` triggers).

### Tests Passing (Phase 4 close)
- Unit: 86 tests pass across perIpSpendingGate (13), editPageLifecycleReducer (9), publicAction (3), publicEditActions (5), explanations [EDIT] filter (27), llmSpendingGate (29 incl. new reserveForUser).
- Lint + tsc: clean.

## Phase 5: Docs
### Work Done
- New: `docs/feature_deep_dives/llm_spending_gate.md`.
- Updated: `docs/docs_overall/environments.md`, `docs/feature_deep_dives/state_management.md`, `docs/feature_deep_dives/server_action_patterns.md` (publicAction factory), `docs/feature_deep_dives/authentication_rls.md`.
- Updated (evolution): `architecture.md` (5th entry point), `data_model.md` (run_source, public_visible, per_user_daily_reservations), `minicomputer_deployment.md`, `cost_optimization.md`, `strategies_and_experiments.md` (public_visible + Public Edit Smoke), `reference.md` (new env vars).

## Pending
- Task #8: Integration tests against staging DB (deferred to follow-up PR — requires staging access).
- Task #11: `npm run migration:verify` (Docker), full `/finalize` local check trio before push.
