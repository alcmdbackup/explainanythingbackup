# Debug Service Temporarily Unavailable Error Explainanything Plan

## Background
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## Requirements (from GH Issue #1104)
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

**Phase 0 ships the UX symptom fix immediately and is independent of Phases 1-3.** Phases 1-3 continue the original root-cause investigation in parallel — they're no longer blocking on the bad UX.

### Phase 0: Ship symptom fix (delete cookie + ServiceUnavailableNotice + block autologin on `/login`)

Goal: when guest autologin fails, visitors see `<LoginForm />` instead of `<ServiceUnavailableNotice />`. No new state, no breaker, no cookie.

**Code changes:**

- [ ] `src/lib/utils/supabase/middleware.ts:70` — delete the `failedRecently` const + its inclusion in the guard at L89.
- [ ] `src/lib/utils/supabase/middleware.ts:84-92` — add `!request.nextUrl.pathname.startsWith('/login')` to the autologin guard conditions. Place alongside the existing `!onRecoveryPath` and `!optedOut` checks. Block style: keep one condition per line; comment that this prevents the redirect-loop second-hop without needing a cookie or breaker.
- [ ] `src/lib/utils/supabase/middleware.ts:119-150` — keep the failure block (log + redirect + supabase-cookie-copy) but delete only the `fallback.cookies.set('GUEST_AUTOLOGIN_FAILED_RECENTLY', ...)` call at L143-149 and the associated comment at L125-127. Preserves the "copy SDK-written cookies onto redirect" invariant.
- [ ] `src/lib/utils/supabase/middleware.ts:58-69` and `:125-132` — update the comment block to reflect that the cookie is gone and Supabase's ~30/min/IP rate limit is now the sole backstop (was: "cookie + rate-limit together"). One paragraph rewrite total. The `optedOut` check at L74 becomes structurally unreachable on `/login` after this change (only `?logout=1` arrival path is `/login`); leave it in as defensive documentation — note this in the comment.
- [ ] `src/app/login/page.tsx:18,21-27` — delete the import of `ServiceUnavailableNotice`, the cookie check, and the early return. Delete the `cookies` import at L15 if unused after removal. Update the file-header comment to drop the "(2) cookie check" bullet.
- [ ] `src/app/login/ServiceUnavailableNotice.tsx` — delete the file.

**Test changes:**

- [ ] `src/lib/utils/supabase/middleware.test.ts:513-530` — rewrite case (f). After change: failed `signInWithPassword` STILL redirects to `/login` (via the kept failure block), but does NOT set the cookie. Assert: response is 3xx with Location `/login`, cookies map does NOT contain `GUEST_AUTOLOGIN_FAILED_RECENTLY`, and any supabase-set cookies on `supabaseResponse` were copied onto the redirect.
- [ ] `src/lib/utils/supabase/middleware.test.ts:532-542` — delete case (i) entirely (cookie no longer exists).
- [ ] `src/lib/utils/supabase/middleware.test.ts` — keep cases (k) and (l) (`?logout=1` opt-out behavior unchanged).
- [ ] `src/lib/utils/supabase/middleware.test.ts` — add new case (m): "skips `signInWithPassword` when pathname starts with `/login`". Set GUEST_EMAIL/PASSWORD, no E2E_TEST_MODE, navigate to `/login`, assert `mockSignInWithPassword` was NOT called.
- [ ] `src/lib/utils/supabase/middleware.test.ts` — add new case (n): "still attempts `signInWithPassword` on `/` when guest unauthenticated". Sanity check that the guard didn't accidentally over-broaden.
- [ ] `src/__tests__/e2e/specs/auth.unauth.spec.ts:23-42` — replace the `addCookies` fixture with `await page.goto('/userlibrary?logout=1')`. The new `/login` skip condition means the redirect-to-/login won't re-trigger autologin, so no further fixture machinery is needed.
- [ ] `src/__tests__/e2e/specs/smoke.public.spec.ts:52-57` — update the comment block. New text: "Catches today's failure mode: prod GUEST_PASSWORD out of sync with prod Supabase user → middleware fails signIn → unauth-redirect to /login. URL assertion catches this within ~2 min via Slack." Drop the `service-unavailable-notice` reference; that testid is gone.
- [ ] `src/__tests__/e2e/specs/smoke.public.spec.ts:67` — delete the `service-unavailable-notice` count-0 assertion (testid no longer exists). Keep the URL + hydration assertions; they're what actually detects the bug.
- [ ] `src/__tests__/integration/auth-flow.integration.test.ts` — **no change needed.** Verified during planning that this file does not test cookie behavior despite a historical planning-doc reference to a 3-request cookie integration test (`docs/planning/fixes_explainanything_for_public_demo_20260523/...:484`). The cookie was only exercised in E2E specs.

**Doc changes:**

- [ ] `docs/feature_deep_dives/authentication_rls.md:27` — rewrite the failure-handling paragraph. New text: "On `signInWithPassword` failure, logs `[middleware] guest-auto-login failed` and redirects to `/login`. Autologin is suppressed on `/login` pathnames (`!startsWith('/login')` in the guard), so the redirect won't re-trigger sign-in. `/login` renders `<LoginForm />` so visitors can sign in manually with their own credentials. Rollback levers (unchanged): set `E2E_TEST_MODE=true` OR remove `GUEST_PASSWORD` from Vercel env vars and redeploy."

**Verification (Phase 0):**

- [ ] Unit: `npm run test -- src/lib/utils/supabase/middleware.test.ts` — all cases pass including new (m)(n).
- [ ] Unit: `npm run test -- src/app/login` — no test references the deleted notice/cookie.
- [ ] E2E (local): `npm run test:e2e -- --grep "auth.unauth|smoke"` — auth.unauth passes with `?logout=1`; smoke detects a synthetic failure (manually break `GUEST_PASSWORD` env on the local dev server, confirm URL assertion fires).
- [ ] Lint + tsc + build: `npm run lint && npm run typecheck && npm run build`.
- [ ] Manual UX check on local dev (with autologin WORKING): direct nav to `/` works as before; direct nav to `/login` now shows LoginForm instead of bouncing to `/` (expected behavior change).
- [ ] Manual UX check on local dev (with autologin BROKEN — set `GUEST_PASSWORD=wrong` in `.env.local`): nav to `/` → ends up on `/login` with LoginForm (no "Service Temporarily Unavailable" anywhere).

**Rollback for Phase 0**: revert the PR. No data migration, no env changes, no Supabase changes.

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

> **Phase 0 tests are listed inside the Phase 0 block above.** The sections below are for Phase 3 (regression tests added after the root cause is identified).

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

> **Phase 0 verification is listed inside the Phase 0 block above.** The sections below are for Phase 3.

### A) Playwright Verification (required for UI changes)
- [ ] Run new E2E spec locally via `npm run test:e2e -- --grep "guest-autologin"`.
- [ ] Run smoke against the deployed preview using `VERCEL_AUTOMATION_BYPASS_SECRET` to confirm the post-deploy smoke catches future regressions.

### B) Automated Tests
- [ ] `npm run test -- src/lib/utils/supabase/middleware.test.ts`
- [ ] `npm run test -- src/app/reset-password/page.test.tsx`
- [ ] `npm run test:integration -- --testPathPattern=guest-autologin`
- [ ] `npm run test:e2e -- --grep "guest-autologin"`

## Documentation Updates

> **Phase 0's doc change (`authentication_rls.md` rewrite of the failure paragraph) is listed inside the Phase 0 block above.** The items below are additive updates for Phase 3 (the root-cause fix).

- [ ] `docs/feature_deep_dives/authentication_rls.md` — document the diagnostic path (what to check first, where the logs live) for guest-autologin recurrences. Update if root cause exposes any new invariant.
- [ ] `docs/docs_overall/debugging.md` — add a top-level "Guest Auto-Login Failures" entry with the Phase 1 checklist condensed to commands.
- [ ] `docs/docs_overall/environments.md` — (a) fix stale prod URL `explainanything.vercel.app` → `ea-evolution.vercel.app`; (b) document the staging URL `explainanythingstage.vercel.app`; (c) list `GUEST_PASSWORD`, `GUEST_EMAIL`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID` as required env vars with their relationships if H2/H4 turn out to be the cause.
- [ ] `docs/docs_overall/testing_overview.md` — only if root cause is H7 (a test workflow touches the guest row); document the boundary.

## Review & Discussion
(Populated by /plan-review after Phase 1 diagnostics narrow the hypothesis set.)
