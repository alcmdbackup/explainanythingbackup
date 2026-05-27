# Debug Service Temporarily Unavailable Error Explainanything Plan

## Background
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## Requirements (from GH Issue #NNN)
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## Problem

The `/login` page on production renders `<ServiceUnavailableNotice />` instead of the form because `src/lib/utils/supabase/middleware.ts` set the `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie after `signInWithPassword({email: GUEST_EMAIL, password: GUEST_PASSWORD})` failed. Resetting Supabase's guest password and updating Vercel's `GUEST_PASSWORD` env var fixes it temporarily — but the failure recurs roughly daily. Three possible buckets for the recurrence: (a) something repeatedly mutates Supabase's stored guest password, (b) something repeatedly drifts the Vercel runtime env value away from Supabase, or (c) the call itself fails for non-credential reasons (rate-limit, network, Supabase outage, middleware regression). We need a structured diagnostic that distinguishes which bucket is true before fixing.

## Options Considered (Hypotheses to falsify in Phase 2)

- [ ] **H1 — Recovery flow rewriting the guest password**: The `triple-gate` against guest takeover (server `GUEST_USER_ID` check + `PASSWORD_RECOVERY` event + `useIsGuest()`) depends on `GUEST_USER_ID` being set as a *server* env var on production. If it's missing or wrong, a visitor who hits `/forgot-password` while signed in as guest could complete `updateUser({password})` against the guest row. Symptom would match exactly — overnight failures correlate with visitor activity.
- [ ] **H2 — Vercel env var drift across targets**: `GUEST_PASSWORD` set on one Vercel environment but not all three (Production / Preview / Staging), or rotated only in Supabase and forgotten in one Vercel target. Each promotion or redeploy from a stale target reseeds runtime with the wrong value.
- [ ] **H3 — Supabase auth rate-limit / lockout**: Continuous public traffic plus any spike triggers Supabase's auth throttling on the shared guest row. Repeated 429s present as "failed sign-in" to the middleware. Worth confirming Supabase's per-IP and per-user defaults.
- [ ] **H4 — GUEST_EMAIL vs NEXT_PUBLIC_GUEST_EMAIL mismatch**: Middleware uses `GUEST_EMAIL` (runtime); client `useIsGuest()` uses `NEXT_PUBLIC_GUEST_EMAIL` (build-time). If they drift (case, whitespace, separate vars), middleware might be signing into the wrong account or the guest account at all, and overnight rebuilds bake a stale `NEXT_PUBLIC_*` value.
- [ ] **H5 — Vercel platform change (Fluid Compute / middleware runtime)**: The platform has been moving middleware off pure-edge to Fluid Compute. A platform-side default flip overnight could change how `process.env` is resolved, how middleware handles cookies, or how `setAll()` writes them. "It broke overnight, Vercel changed something" maps directly to this.
- [ ] **H6 — Build-time inlining of GUEST_PASSWORD**: Something (a Next.js plugin, a `NEXT_PUBLIC_*` typo, a `define` config) inlines `GUEST_PASSWORD` into the bundle. The runtime env-var change only takes effect on the next build; the bundle keeps the old value until redeploy. Past "fix" worked because the user redeployed; bug returns because something else triggers a deploy that re-bakes a stale value.
- [ ] **H7 — Scheduled job mutates the guest password**: A cron, GitHub Action, Supabase trigger, or maintenance script rotates the guest row nightly. Greppable: `updateUser`, `updateUserById`, `admin.updateUser`, `auth.admin` against `GUEST_USER_ID` or `GUEST_EMAIL`. Cadence-wise, `e2e-nightly.yml` at 06:00 UTC is the prime suspect even if docs claim it only uses `TEST_USER_*`.
- [ ] **H8 — Middleware boot failure (env init throws)**: A side-effect during middleware init (Sentry, Honeycomb, OTLP exporter, etc.) throws when a secondary env var goes missing or invalid. If the catch path falls through to "auto-login failed", we'd see the same cookie set. Less likely but cheap to rule out by inspecting Sentry/Honeycomb middleware spans.
- [ ] **H9 — Cookie/edge-cache stickiness**: 60s TTL on the failure cookie + CDN edge caching could pin the failure response longer than 60s for some clients. Doesn't explain the underlying signInWithPassword failure but could amplify reports.
- [ ] **H10 — Supabase auto-disabled the guest row**: `auth.users.banned_until` set by a Supabase admin policy or by a developer reviewing flagged accounts. Each reset re-enables the row implicitly; the same policy re-bans it.

## Phased Execution Plan

### Phase 1: Confirm failure mode and capture the next recurrence

- [ ] Hit production `https://ea-evolution.vercel.app/` (and the public host if separate) in a private window with no cookies; record middleware response status, `Set-Cookie` headers, and final page rendered. Repeat against staging `https://explainanythingstage.vercel.app/` for baseline.
- [ ] Pull last 24h Vercel runtime logs: `vercel logs --token "$VERCEL_TOKEN" <production-deployment-url> --since 24h | grep -iE "guest|signInWithPassword|GUEST_AUTOLOGIN_FAILED"`. Save output to project folder as `phase1_vercel_logs.txt` (gitignored — may contain PII).
- [ ] Query Sentry for events in `src/lib/utils/supabase/middleware.ts` with tag `host=public` during the failure window via `/debug sentry`. Capture issue IDs.
- [ ] Query Honeycomb `explainanything` dataset filtered to `http.target=/` AND `http.route=middleware` for the same window. Look for `signInWithPassword` span error attributes.
- [ ] Query Supabase auth: `npm run query:prod -- "SELECT id, email, last_sign_in_at, updated_at, banned_until, raw_user_meta_data->>'provider' as provider FROM auth.users WHERE id = '<GUEST_USER_ID>'"`. Compare `updated_at` timestamps with failure timestamps from logs.
- [ ] Pull `auth.audit_log_entries` for the guest user id around recurrence times: `npm run query:prod -- "SELECT created_at, payload->>'action' as action, payload->>'actor_id' as actor FROM auth.audit_log_entries WHERE payload->>'actor_id' = '<GUEST_USER_ID>' OR payload->>'subject' = '<GUEST_USER_ID>' ORDER BY created_at DESC LIMIT 50"`.

### Phase 2: Falsify each hypothesis

- [ ] **H1**: Confirm `GUEST_USER_ID` is set on Vercel Production env (server-only, no `NEXT_PUBLIC_` prefix). Check `src/app/reset-password/page.tsx` reads it via `process.env.GUEST_USER_ID` (not a bundled var). Then check `auth.audit_log_entries` for `user.recovery_requested` / `user.password_updated` events on the guest row near recurrence times.
- [ ] **H2**: `vercel env pull .env.diag.production --environment=production --token "$VERCEL_TOKEN"` then `--environment=preview` and `--environment=staging`. Diff `GUEST_*` and `NEXT_PUBLIC_GUEST_*` values across all three. Confirm production `GUEST_PASSWORD` is what was last set in Supabase.
- [ ] **H3**: Check Supabase rate-limit settings in dashboard. Look for `auth.flow_state` or rate-limit table entries. If unclear, ask Supabase support; their per-user signin limit is typically 30/hour but project-configurable.
- [ ] **H4**: From the pulled `.env.diag.*` files, diff `GUEST_EMAIL` against `NEXT_PUBLIC_GUEST_EMAIL` (case + whitespace sensitive). Confirm they're identical.
- [ ] **H5**: Check Vercel deployment list for an automatic redeploy near each recurrence. Check Vercel changelog for middleware-runtime / Fluid Compute changes since the last working state. Confirm `vercel.json` / `vercel.ts` `runtime` setting for middleware. (Repo currently has `vercel.json = { "crons": [] }`.)
- [ ] **H6**: Grep production bundle for the literal guest password string after a build (use a non-secret password locally to test): `npm run build && grep -r '<test-guest-pw>' .next/`. Confirm `GUEST_PASSWORD` is referenced only via `process.env.GUEST_PASSWORD` at runtime, never inlined. Check `next.config.ts` for any `env` block that would inline server-only vars.
- [ ] **H7**: `rg -i 'updateUser|admin\.updateUserById|auth\.admin' --type ts --type tsx | rg -i 'guest|GUEST'`. Inspect `.github/workflows/*.yml` for any guest-touching steps. Re-read `e2e-nightly.yml` for any guest references (docs claim it uses `TEST_USER_*` only).
- [ ] **H8**: Inspect Sentry for *any* errors during middleware init in the failure window (not just signInWithPassword). Check `next.config.ts` Sentry/OTel config for required env vars that may have lapsed.
- [ ] **H9**: Curl production `/login` with `-I` and check for `Cache-Control` / `CDN-Cache-Control` headers; verify Vercel is not caching the failure response.
- [ ] **H10**: Check `auth.users.banned_until` for the guest UUID via the Supabase query in Phase 1.

### Phase 3: Apply targeted fix + prevent recurrence

- [ ] Based on the surviving hypothesis (typically only 1-2 will survive Phase 2 falsification), propose the minimal fix. Likely candidates:
  - If H1: tighten the recovery gate (e.g. fail-closed when `GUEST_USER_ID` missing instead of throwing) and add a server-side check that refuses `updateUser` against the guest user id even with a valid recovery session.
  - If H2/H4: align all Vercel env vars across all 3 targets; consider moving `GUEST_PASSWORD` to a Supabase Vault / Vercel-marketplace secret so it can't drift.
  - If H6: remove the inlining path; add a build-time assertion that the password is NOT in the bundle.
  - If H7: rewrite the offending job to not touch the guest row.
- [ ] Add structured logging at the failure point: when `signInWithPassword` fails, log the Supabase error code + message verbatim (not just "auth failed") so the next recurrence is self-diagnosing.
- [ ] Add a runtime invariant check: on middleware boot, if `GUEST_USER_ID || GUEST_EMAIL || GUEST_PASSWORD` is unset, log a single warning per cold start.

## Testing

### Unit Tests
- [ ] `src/lib/utils/supabase/middleware.test.ts` — assert that when `signInWithPassword` rejects with a recognizable Supabase auth error (`Invalid login credentials`, `User banned`, `429 rate-limited`), the failure cookie is set AND the error code is logged with that exact category.
- [ ] `src/app/reset-password/page.test.tsx` — assert that with `GUEST_USER_ID` unset OR the current user matching `GUEST_USER_ID`, `notFound()` fires before rendering the form (covers H1).

### Integration Tests
- [ ] `src/__tests__/integration/guest-autologin.integration.test.ts` (new) — using a dedicated test user (not `TEST_USER_*`, not the real guest), assert the middleware happy-path: no session → signInWithPassword succeeds → cookie set → no failure cookie. Tag `@critical`.
- [ ] Extend `src/__tests__/integration/password-reset.integration.test.ts` — add a case that attempts `updateUser({password})` against the dedicated test guest from a non-recovery session and asserts the server-side gate rejects it.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/01-auth/guest-autologin.spec.ts` (new) — visit `/` on the public host in an unauthenticated context; assert NO `Service Temporarily Unavailable` text appears and the page reaches the authenticated landing. Tag `@critical`. Skip on staging since staging has its own guest config.
- [ ] Add `@smoke`-tagged assertion in `src/__tests__/e2e/specs/smoke.spec.ts` that hits the public host and confirms the guest-autologin path works post-deploy.

### Manual Verification
- [ ] After fix, force a fresh deploy and observe `/login` and `/` over 24h without intervention; confirm no recurrence in Sentry + Vercel logs.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run new E2E spec locally via `npm run test:e2e -- --grep "guest-autologin"`.
- [ ] Run smoke against the deployed preview using `VERCEL_AUTOMATION_BYPASS_SECRET` to confirm the post-deploy smoke catches future regressions.

### B) Automated Tests
- [ ] `npm run test -- src/lib/utils/supabase/middleware.test.ts`
- [ ] `npm run test -- src/app/reset-password/page.test.tsx`
- [ ] `npm run test:integration -- --testPathPattern=guest-autologin`
- [ ] `npm run test:e2e -- --grep "guest-autologin"`

## Documentation Updates
- [ ] `docs/feature_deep_dives/authentication_rls.md` — document the diagnostic path (what to check first, where the logs live) for "Service Temporarily Unavailable" recurrences. Update if root cause exposes any new invariant.
- [ ] `docs/docs_overall/debugging.md` — add a top-level "Guest Auto-Login Failures" entry with the Phase 1 checklist condensed to commands.
- [ ] `docs/docs_overall/environments.md` — (a) fix stale prod URL `explainanything.vercel.app` → `ea-evolution.vercel.app`; (b) document the staging URL `explainanythingstage.vercel.app`; (c) list `GUEST_PASSWORD`, `GUEST_EMAIL`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID` as required env vars with their relationships if H2/H4 turn out to be the cause.
- [ ] `docs/docs_overall/testing_overview.md` — only if root cause is H7 (a test workflow touches the guest row); document the boundary.

## Review & Discussion
(Populated by /plan-review after Phase 1 diagnostics narrow the hypothesis set.)
