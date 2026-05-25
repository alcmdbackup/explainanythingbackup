# Forgot Password Email Doesn't Work — Plan

## Background
Clicking "reset password" on the Supabase reset password email sends the user to the normal login screen, nothing different happens. It should allow user to reset password.

## Problem
Two layered failures (see `_research.md` for evidence):
1. No `/reset-password` page exists, so the recovery flow dead-ends at 404 → middleware bounces to `/login`.
2. No `resetPasswordForEmail` trigger anywhere in `src/` and the "Forgot password?" copy on `LoginForm` is a hardcoded `<span>` reading "Contact your admin". So there is no way to start the flow in the first place.
3. The recovery email template in the Supabase dashboard likely points at the default `{{ .SiteURL }}/...` rather than at our `/auth/confirm` route, so even users who get an email land at `/` with stray query params nothing parses.

The `/auth/confirm` route already correctly handles `verifyOtp` for `type=recovery` (`src/app/auth/confirm/route.ts:11-34`) and a unit test at `src/app/auth/confirm/route.test.ts:131-146` already pins `next=/reset-password` — strong evidence the work was started and stopped before the page was added. This plan finishes it.

## Design Decisions
| # | Decision | Rationale |
|---|---|---|
| 1 | Dedicated `/forgot-password` page (not inline on `/login`) | Conventional, deep-linkable, easier to test in isolation |
| 2 | Triple gate on `/reset-password`: (a) server-side `getUser()` refuses render if `user.id === GUEST_USER_ID`, (b) client `onAuthStateChange === 'PASSWORD_RECOVERY'` enables form, (c) client `user.email !== NEXT_PUBLIC_GUEST_EMAIL` second check | Defense in depth. Server check uses a non-public env var so it survives bundle issues; client checks are the primary UX. Even if any one gate fails, the other two hold. |
| 3 | Add `/reset-password` to the middleware redirect-to-login allowlist from the start | Eliminates the cookie-propagation race after `verifyOtp` redirect. Client + server gates on the page are the real auth check anyway. |
| 4 | `redirectTo` is derived from `request.headers.get('origin')` | Auto-adapts to public vs evolution vs preview hosts; one fewer env var to keep in sync |
| 5 | `/reset-password` path is fixed (matches existing test `route.test.ts:136`) | No reason to make it configurable |
| 6 | Pre-authenticated user clicks recovery link → let `verifyOtp` swap session silently | Default Supabase behaviour. Recovery emails are sent to a specific account; swapping is the user's intent. Document in auth doc. |
| 7 | Test coverage: unit + integration + E2E `@critical` | User-requested; uses `supabase.auth.admin.generateLink({ type: 'recovery', email })` to synthesize URLs without needing an inbox |

## Phased Execution Plan

### Phase 1: Forgot-password trigger (server action + page)
- [ ] Add `forgotPasswordSchema` (just `email: z.string().email()`) to `src/app/login/validation.ts`
- [ ] Add `requestPasswordReset(formData)` server action to `src/app/login/actions.ts`. Pattern matches `login` / `signup`: Sentry-wrapped, Zod-validated, calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${origin}/auth/confirm?next=/reset-password\` })`. Reads `origin` via `headers()` from `next/headers`. Returns `{ error?, success? }`. **Mask errors**: never reveal whether the email is registered — always return success on non-validation errors (Supabase already does this, but be explicit).
- [ ] Create `src/app/forgot-password/page.tsx` (server shell, mirrors `src/app/login/page.tsx`)
- [ ] Create `src/app/forgot-password/ForgotPasswordForm.tsx` (client) — single email input, submit button, on success render "If an account exists for that email, a reset link has been sent. Check your inbox." Mirrors `LoginForm.tsx` styling.
- [ ] Update `src/app/login/LoginForm.tsx:236-238` — replace the `<span>Forgot password? Contact your admin</span>` with `<Link href="/forgot-password" className="text-sm atlas-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors">Forgot password?</Link>`

### Phase 2: Reset-password page + middleware edits
- [ ] Edit `src/lib/utils/supabase/middleware.ts` in **three** places (critical — all three are required; missing any one re-opens the bypass it closes):
  - **(a) Guest auto-login condition (lines 70-77)** — add `!request.nextUrl.pathname.startsWith('/reset-password')` AND `!request.nextUrl.pathname.startsWith('/forgot-password')` AND `!request.nextUrl.pathname.startsWith('/auth/confirm')` so unauthenticated visitors on the public host don't get auto-signed-in as the guest *while in the recovery flow*. Without this, the user clicks the email link → `/auth/confirm` runs `verifyOtp` and sets recovery cookies → redirect to `/reset-password` → if cookie propagation races, middleware sees `!currentUser`, fires guest auto-login, **swaps the session to guest**, server-side gate then 404s. Closes the load-bearing race for this flow.
  - **(b) Redirect-to-login allowlist (lines 147-158)** — add `!request.nextUrl.pathname.startsWith('/reset-password')` AND `!request.nextUrl.pathname.startsWith('/forgot-password')` so the recovery flow isn't bounced before render. (`/forgot-password` must be reachable when unauthenticated.)
  - **(c) Disabled-user check allowlist (lines 161-167)** — add `!request.nextUrl.pathname.startsWith('/reset-password')`. Disabled users can complete `updateUser({ password })` (Supabase auth doesn't know about the app-level `user_profiles.is_disabled` flag), but they'll be bounced on the next non-auth route they hit. See Risk #6 for explicit acceptance.
- [ ] Create `src/app/reset-password/page.tsx` — **server component**. Calls `createSupabaseServerClient().auth.getUser()`. If `user?.id === process.env.GUEST_USER_ID`, return a 404 (`notFound()` from `next/navigation`). Otherwise render `<ResetPasswordForm />`. This is the server-side leg of the triple gate.
- [ ] Create `src/app/reset-password/ResetPasswordForm.tsx` (client component). Behaviour:
  - Subscribe via `supabase.auth.onAuthStateChange((event, session) => …)` in a `useEffect`. Track `isRecoverySession` state — set true when `event === 'PASSWORD_RECOVERY'` fires.
  - Form is enabled only when `isRecoverySession === true` AND `session.user.email !== process.env.NEXT_PUBLIC_GUEST_EMAIL`. Otherwise render an "invalid or expired" message that includes a `<Link href="/forgot-password">Request a new reset link</Link>` CTA so users get unstuck without leaving the page.
  - Form fields: new password + confirm password. Use the new `resetPasswordSchema` (see Files Touched → `validation.ts`) which mirrors `signupSchema`-grade complexity (upper/lower/digit + min length) PLUS cross-field `password === confirmPassword`. **Do NOT downgrade to `loginSchema`** — reset users should have the same password strength as new signups, not the weaker login-time check.
  - Use the existing `useIsGuest()` hook from `src/hooks/useUserAuth.ts` for the client-side guest check rather than re-implementing `session.user.email !== process.env.NEXT_PUBLIC_GUEST_EMAIL` inline. Centralizes the guest-detection logic and handles the `NEXT_PUBLIC_GUEST_EMAIL` unset case correctly.
  - On submit: `supabase.auth.updateUser({ password })` (browser client — no server action needed; recovery session is in browser cookies).
  - On success: `router.push('/')` + revalidate. User is now signed in with the new password.

### Phase 3: Supabase email template + dashboard config
- [ ] Add `[auth.email.template.recovery]` block to `supabase/config.toml` (around line 187):
  ```toml
  [auth.email.template.recovery]
  subject = "Reset your password"
  content_path = "./supabase/templates/recovery.html"
  ```
- [ ] Create `supabase/templates/recovery.html` with:
  ```html
  <h2>Reset your password</h2>
  <p>Click the link below to reset your password:</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset password</a></p>
  ```
- [ ] **Runbook (manual, ops-only — track in checklist below, do NOT commit anywhere)**:
  - [ ] Dev Supabase dashboard (`ifubinffdbyewoezcidz`) → Authentication → Email Templates → Reset Password → paste the same HTML body (using `{{ .SiteURL }}` so the dev project's site URL fills in)
  - [ ] Dev dashboard → Authentication → URL Configuration → add `https://<dev-site>/auth/confirm` to the redirect allowlist. **This is the actual `redirectTo` value sent to Supabase** (`${origin}/auth/confirm?next=/reset-password`); the `next=` query string is NOT part of Supabase's URL-allowlist matching. Listing `/reset-password` instead would silently reject the email link.
  - [ ] Prod Supabase dashboard (`qbxhivoezkfbjbsctdzo`): same two steps — paste recovery.html template body; add `https://<prod-site>/auth/confirm` to the URL allowlist

### Phase 4: Tests

#### Unit Tests
- [ ] `src/app/login/actions.test.ts` (extend existing or add new) — `requestPasswordReset`:
  - Returns `{ error: 'Invalid email…' }` for malformed email
  - Calls `supabase.auth.resetPasswordForEmail` with the validated email and `redirectTo` ending in `/auth/confirm?next=/reset-password`
  - Returns `{ success: true }` even when Supabase returns an error (mask to prevent email enumeration)
- [ ] `src/app/forgot-password/ForgotPasswordForm.test.tsx` — renders email input, submit, success/error states
- [ ] `src/app/reset-password/ResetPasswordForm.test.tsx`:
  - Form disabled until `PASSWORD_RECOVERY` event fires
  - Form disabled when `user.email === NEXT_PUBLIC_GUEST_EMAIL` (mock the auth state)
  - On submit calls `updateUser({ password })` and navigates to `/`
  - Mismatched passwords show error
- [ ] `src/app/login/LoginForm.test.tsx:303-307` — update the existing "Contact your admin" assertion to verify the `/forgot-password` link is present

#### Integration Tests
- [ ] `src/__tests__/integration/password-reset.integration.test.ts` (new file). Uses a **dedicated per-test user** (NOT the shared `TEST_USER_*` — see Risk #5 for why) + `supabase.auth.admin.generateLink` to synthesize the recovery URL without an inbox:
  1. **`beforeEach`**: `supabase.auth.admin.createUser({ email: \`pwreset-${Date.now()}-${randomUUID()}@example.com\`, password: INITIAL_PWD, email_confirm: true })` — capture the user id in describe scope. Avoids contaminating the shared `TEST_USER_*` credentials that other integration/E2E tests depend on.
  2. `admin.generateLink({ type: 'recovery', email: <created-user-email> })` → extract `data.properties.hashed_token` directly from the response object. **Do NOT parse from `data.properties.action_link` URL** — that URL is the raw GoTrue verify endpoint (`/auth/v1/verify?token=…`) and uses a `token` param, not `token_hash`. The structured response field is the canonical source.
  3. Call `requestPasswordReset` action with that email; assert returns success (separate assertion path; does not depend on step 2's link)
  4. Use `hashed_token` from step 2 as the input to step 5 (no URL parsing needed)
  5. On a fresh anon-key Supabase JS client, call `supabase.auth.verifyOtp({ type: 'recovery', token_hash: hashed_token })` **directly**. This is the same call `/auth/confirm` makes internally (`src/app/auth/confirm/route.ts:20`); integration tier has no running Next.js server (`jest.integration.config.js`), so we skip the HTTP route hop and validate the SDK contract end-to-end. The route's behavior is covered separately by `src/app/auth/confirm/route.test.ts`.
  6. On the now-recovered session, call `supabase.auth.updateUser({ password: NEW_PWD })`
  7. On a brand-new anon-key client, call `supabase.auth.signInWithPassword({ email, password: NEW_PWD })` to prove the password actually changed
  8. Also assert the old password no longer works: same client, `signInWithPassword({ email, password: INITIAL_PWD })` returns an error
- [ ] **Cleanup in `afterEach`** (`try/finally`): `supabase.auth.admin.deleteUser(userId)` for the created user. **Also `afterAll`** belt-and-suspenders that walks any user ids that escaped afterEach. Integration tests run sequentially (`maxWorkers: 1`).

#### E2E Tests
- [ ] `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts` (new file, tag `@critical`):
  1. `test.describe.configure({ mode: 'serial' })` — needed because tests share the dedicated per-spec test user
  2. **`test.beforeAll`**: `admin.createUser({ email: \`pwreset-e2e-${Date.now()}@example.com\`, password: INITIAL_PWD, email_confirm: true })` — dedicated user for this spec only. Avoids touching `TEST_USER_*` (shared across the suite). Stash id/email in describe scope.
  3. **UI trigger test**: `page.goto('/login')` → **wait for hydration proof** (Rule 18: `await page.getByTestId('login-email').waitFor({ state: 'visible' })`) → click "Forgot password?" link → assert on `/forgot-password` → fill the spec's dedicated email → submit → assert "check your inbox" success state
  4. **Reset flow test** (the one that matters): per-test `beforeEach` calls `admin.generateLink({ type: 'recovery', email: <spec email> })` and stashes `action_link`; `page.goto(action_link)` → assert lands on `/reset-password` → wait for form hydration (Rule 18) → assert form is enabled → fill new password + confirm → submit → assert redirect to `/` → assert authenticated (user menu visible). If user state changes, `admin.updateUserById` in cleanup to restore INITIAL_PWD so subsequent tests in the same describe see a known state.
  5. **Expired-link UX test**: `page.goto('/reset-password')` directly without a recovery token → assert "invalid or expired" message renders → assert "Request a new reset link" CTA `<a>` has `href="/forgot-password"`
  6. **Guest-protection test**: `E2E_TEST_MODE=true` disables middleware guest auto-login in the chromium-critical project (`playwright.config.ts:184`), so guest auth must be simulated. **Reuse the existing SSR-cookie helper pattern** from `src/__tests__/e2e/specs/01-auth/guest-auto-login.spec.ts` or `src/__tests__/e2e/fixtures/auth.ts` (Supabase SSR uses a chunked `sb-<project-ref>-auth-token.0/.1` shape — don't hand-roll). If no clean helper exists, extract one to `src/__tests__/e2e/helpers/seedGuestSession.ts` rather than inlining per test. Then: `const response = await page.goto('/reset-password'); expect(response?.status()).toBe(404);` — assert the HTTP status code directly rather than a generic "404", since `notFound()` from `next/navigation` renders `not-found.tsx` and the way to verify the gate fired is the response status. **Depends on `GUEST_USER_ID` being passed to the Next.js webServer env — see CI changes below.**
  7. **`test.afterAll`** (`try/finally`): `admin.deleteUser(userId)` for the dedicated user. Belt-and-suspenders.
- [ ] **Add Page Object Models**:
  - `src/__tests__/e2e/helpers/pages/ForgotPasswordPage.ts` (mirror `LoginPage.ts`): `gotoForgotPassword()`, `submitEmail(email)`, locators for email input + submit + success message
  - `src/__tests__/e2e/helpers/pages/ResetPasswordPage.ts`: `gotoResetPassword(actionLink?)`, `submitNewPassword(pwd)`, locators for both password fields + submit + invalid-link message + CTA link
  - Spec uses these POMs throughout (consistent with `LoginPage` usage in `auth.spec.ts`). POM methods must wait after actions per testing rule 12.

#### CI/CD wiring required for the above tests to actually run

- [ ] **Update `package.json` `test:integration:critical` regex** to include the new spec. Current regex matches only `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching`; extend to `…|vector-matching|password-reset`. Without this, the new integration test silently never runs in the PR-to-main critical path.
- [ ] **Edit `.github/workflows/ci.yml`** — `e2e-critical` job: add `GUEST_EMAIL`, `GUEST_PASSWORD`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID` to the env block. The guest-protection test won't work in CI without them.
- [ ] **Edit `playwright.config.ts`** webServer env block: add `GUEST_USER_ID: process.env.GUEST_USER_ID` so the dev server in the chromium-critical project has access to it for the server-side guest gate. Without this, test #6 will not 404 — the server gate condition `user?.id === process.env.GUEST_USER_ID` evaluates `user.id === undefined`, which is false, so the page renders.
- [ ] **Confirm `SUPABASE_SERVICE_ROLE_KEY` is already in both `integration-critical` and `e2e-critical` env blocks** (it is, per existing infrastructure). The new tests use it for `admin.createUser` / `admin.generateLink` / `admin.deleteUser`.

#### Manual Verification (two distinct checkpoints — BOTH must pass before PR)
- [ ] **Checkpoint A — Local Inbucket** (proves `supabase/config.toml` template renders): configure template, `supabase db reset`, manually trigger `resetPasswordForEmail` from the Forgot Password page, open Inbucket at `localhost:54324`, confirm email body contains the `/auth/confirm?token_hash=…&type=recovery&next=/reset-password` URL, click it, confirm full flow works end-to-end
- [ ] **Checkpoint B — Dev deployment with a real inbox** (proves the dashboard template was actually updated): after dev-dashboard config is applied, trigger reset from the deployed preview with a real test account, check real email inbox, confirm same flow works. **This is the ONLY check that catches dashboard misconfiguration** — Checkpoint A passing doesn't imply Checkpoint B passes.
- [ ] **Prod smoke** (after dashboard config update): one round-trip from a real account post-deploy

### Phase 5: Documentation Updates
- [ ] Update `docs/feature_deep_dives/authentication_rls.md` — add a new "Password reset flow" section covering: entry point, server action, callback (`/auth/confirm` is already documented), `/reset-password` page, **triple gating logic** (server `getUser()` guest check + client `PASSWORD_RECOVERY` event + client guest-email check + middleware allowlist), **pre-authenticated-user behavior** (verifyOtp swaps the session — by design), and the test pattern using `admin.generateLink`
- [ ] No changes needed to `docs/docs_overall/architecture.md` (auth subsection is high-level enough)
- [ ] Update `.claude/doc-mapping.json` to map `src/app/forgot-password/**` and `src/app/reset-password/**` to `docs/feature_deep_dives/authentication_rls.md` so future edits trigger doc updates via `/finalize`

## Files Touched

**New files:**
- `src/app/forgot-password/page.tsx`
- `src/app/forgot-password/ForgotPasswordForm.tsx`
- `src/app/forgot-password/ForgotPasswordForm.test.tsx`
- `src/app/reset-password/page.tsx`
- `src/app/reset-password/ResetPasswordForm.tsx`
- `src/app/reset-password/ResetPasswordForm.test.tsx`
- `src/__tests__/integration/password-reset.integration.test.ts`
- `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts`
- `src/__tests__/e2e/helpers/pages/ForgotPasswordPage.ts` (POM)
- `src/__tests__/e2e/helpers/pages/ResetPasswordPage.ts` (POM)
- `supabase/templates/recovery.html`

**Edited files:**
- `src/app/login/actions.ts` — add `requestPasswordReset` (Sentry-wrapped, `await headers()` in Next 15 to read `origin`, `revalidatePath('/', 'layout')` on success matching existing actions). **Origin fallback**: if `origin` header is missing (rare; some non-browser POSTs), fall back to `process.env.NEXT_PUBLIC_SITE_URL` if set, else return `{ error: 'Unable to determine site URL' }` to fail loudly rather than send an email pointing at a wrong host.
- `src/app/login/validation.ts` — add `forgotPasswordSchema` (email-only) and `resetPasswordSchema` (mirrors `signupSchema`-grade complexity rules: upper/lower/digit + min length, plus cross-field `password === confirmPassword`). **Do NOT downgrade to `loginSchema`'s 8-char-min-only.**
- `src/app/login/LoginForm.tsx:236-238` — replace span with `<Link href="/forgot-password" data-testid="forgot-password-link">Forgot password?</Link>` (testid for POM/E2E targeting)
- `src/app/login/LoginForm.test.tsx:303-307` — update assertion
- `src/app/login/actions.test.ts` — add unit tests for new action (or create if missing); mocks `next/headers` `headers()` and the Supabase server client
- `src/lib/utils/supabase/middleware.ts` — Phase 2 three-place edit (guest auto-login, redirect-to-login, disabled-user)
- `supabase/config.toml` — add `[auth.email.template.recovery]` block (after `[auth.email]` section ~line 187). Note: existing local DBs need `supabase db reset` to pick up the new template.
- `playwright.config.ts` — add `GUEST_USER_ID: process.env.GUEST_USER_ID` to the chromium-critical webServer env block
- `package.json` — extend `test:integration:critical` regex to include `password-reset`
- `.github/workflows/ci.yml` — add `GUEST_EMAIL`, `GUEST_PASSWORD`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID` to `e2e-critical` env block (already-set: `SUPABASE_SERVICE_ROLE_KEY` for admin API)
- `docs/feature_deep_dives/authentication_rls.md` — add reset-flow section
- `.claude/doc-mapping.json` — map new dirs (`src/app/forgot-password/**`, `src/app/reset-password/**`) AND `src/app/login/actions.ts` to `docs/feature_deep_dives/authentication_rls.md` (the latter is the new home of `requestPasswordReset`)

**Implementation notes (for the implementer, avoid common pitfalls):**
- Browser client import: `createClient` from `@/lib/utils/supabase/client` (existing pattern; do NOT introduce `createSupabaseBrowserClient`)
- Server client: existing `createSupabaseServerClient` from `@/lib/utils/supabase/server`
- `headers()` in Next 15 is async: `const h = await headers(); const origin = h.get('origin') ?? '<fallback>'`

## Verification

### Playwright Verification (required since this is UI)
- [ ] `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts` (Phase 4) covers all four UI states: trigger, callback redirect, reset form, guest protection
- [ ] Manual once-over locally with Inbucket to confirm the email body renders correctly with the template

### Automated Tests
- [ ] `npm test -- src/app/forgot-password` (unit)
- [ ] `npm test -- src/app/reset-password` (unit)
- [ ] `npm test -- src/app/login` (regression on edited LoginForm + actions)
- [ ] `npm run test:integration -- password-reset` (integration)
- [ ] `npm run test:e2e:critical -- password-reset` (E2E in critical suite)
- [ ] Full `/finalize` local check before PR (lint + tsc + build + unit + ESM + integration + E2E critical) per saved feedback

## Ops Runbook (do NOT auto-commit — these are dashboard actions)

- [ ] Dev Supabase dashboard (`ifubinffdbyewoezcidz`): Authentication → Email Templates → Reset Password → paste recovery.html body
- [ ] Dev dashboard: Authentication → URL Configuration → add `https://<dev-site>/auth/confirm` to redirect allowlist. **Use `/auth/confirm`, NOT `/reset-password`** — Supabase matches the `redirectTo` URL by path before honoring it; the `next=` query is not part of the match.
- [ ] Prod Supabase dashboard (`qbxhivoezkfbjbsctdzo`): same two steps with prod URLs (`https://<prod-site>/auth/confirm`)
- [ ] After dashboard updates: test from preview deployment with a real email (Checkpoint B), then from production

## Risk Register (with mitigations applied in this plan)

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Guest auto-login swap during recovery flow on public host. Middleware's auto-guest-login block (lines 70-77) runs BEFORE the redirect-to-login block and unconditionally fires whenever `!currentUser` on public/local/preview tiers. If cookie propagation from `/auth/confirm`'s `verifyOtp` races the redirect to `/reset-password`, middleware sees `!currentUser`, signs the user in as guest, **swaps the recovery session away**. | Phase 2 edit (a): also gate the guest-auto-login condition on `!path.startsWith('/reset-password')` AND `!path.startsWith('/forgot-password')` AND `!path.startsWith('/auth/confirm')`. Closes the race. | **Mitigated** |
| 2 | Inbucket vs dashboard SMTP divergence — local template config doesn't validate dashboard config | Manual verification split into two distinct checkpoints: Checkpoint A (local Inbucket), Checkpoint B (real-email on dev deployment). Both required before PR. | **Mitigated** |
| 3 | `NEXT_PUBLIC_GUEST_EMAIL` check fails open if env var drops from bundle | Triple gate: server-side `getUser()` check using `GUEST_USER_ID` (server-only env var, no bundle dependency) + client `PASSWORD_RECOVERY` event + client email check. | **Mitigated** |
| 4 | 1-hour recovery-link TTL → confused users | "Invalid or expired" message includes a `<Link href="/forgot-password">Request a new reset link</Link>` CTA. | **Mitigated** |
| 5 | Test-user password mutation leaks to parallel-worker tests sharing `TEST_USER_*`. If the password-reset test crashes mid-flow before cleanup, every other chromium-critical worker using `authenticateWithRetry` starts failing with stale credentials, including session-management critical tests. | **Switched to dedicated per-spec test user** via `admin.createUser` in beforeAll + `admin.deleteUser` in afterAll. `TEST_USER_*` is never touched by this spec. Worker isolation guaranteed. | **Mitigated (architectural change)** |
| 6 | Disabled user can complete `updateUser({ password })` via `/reset-password`. Supabase auth has no knowledge of `user_profiles.is_disabled`; once they hold a recovery session and the disabled-user check is allowlisted, the password change succeeds. They'll be bounced on the next non-auth route, but the mutation went through. **Asymmetry note**: `/forgot-password` is NOT allowlisted in the disabled-user check, so a disabled user gets bounced to `/account-disabled` before they can even request a reset. So in practice, the only way a disabled user reaches `/reset-password` is if they had an outstanding recovery link from before being disabled. | **Accepted by design.** Reset is required for legitimate recovery scenarios; gating disabled users out entirely makes admin-disable a permanent lockout from password change too. The disabled state still blocks app access on the next request. The asymmetry is intentional — disabled users can't request new recovery links but can complete pre-disable ones. | **Accepted (documented)** |
| 7 | Pre-authenticated user clicks recovery link → session swap to recovered account | Accept Supabase default behaviour. Recovery emails are account-specific; swapping is the user's intent. Documented in the auth doc update (Phase 5). | **Accepted by design** |
| 8 | Email-enumeration via response-time side channel. `resetPasswordForEmail` does a network round-trip only for valid emails (rate-limit short-circuits invalid ones); an attacker can measure latency to enumerate registered accounts. Plan's error-message masking doesn't address this. | **Accepted (low priority).** Mitigation requires either constant-delay padding (~300ms) or rate-limiting at the action layer — both add complexity for marginal benefit given (a) Supabase already rate-limits at 30/min per IP, (b) signup endpoint already exists and trivially enumerates the same data via "already registered" error, (c) the project has a guest-demo public-mode so account existence is not a strong secret. Document for future hardening but not in scope here. | **Accepted (deferred)** |
| 9 | Guest-protection scenario hard to test under `E2E_TEST_MODE=true` (auto-login disabled in chromium-critical project) | Single E2E test signs in as guest via `signInWithPassword(GUEST_EMAIL, GUEST_PASSWORD)` against the anon-key client and injects cookies into the Playwright context. Server-side gate requires `GUEST_USER_ID` in the webServer env (added in Phase 4 → CI wiring). | **Mitigated** |

## Rollback Plan

If the change ships broken (Checkpoint B email round-trip fails post-deploy, or a regression in `/login` / guest auto-login is detected):

1. **Code rollback** — `git revert <merge-commit>` on `main`, push, let CI deploy. The middleware edit is the only auth-perimeter change; reverting it restores the exact prior allowlist. The new routes (`/forgot-password`, `/reset-password`) become 404s, which is benign — users would see the same broken state as before the PR (back to "Contact your admin"). Risk: zero net regression because the prior state IS the regression we're fixing.
2. **Dashboard rollback** — the recovery email template in the dev/prod dashboards reverts to Supabase defaults by clearing the custom template field in each project. Recovery URL allowlist entries can be removed (or left — they're harmless without the page).
3. **Test-user cleanup** — if rollback happens mid-CI-run and dedicated test users were leaked, `scripts/cleanup-test-content.ts`-style sweep on `pwreset-%@example.com` removes them. Add to the cleanup script's pattern list as part of Phase 5 docs update if desired (defer if not).
4. **No DB migration to roll back** — the plan adds no schema changes. `supabase/config.toml` template changes only affect newly-spun local DBs.

Total rollback time: <10 min for code, <5 min per dashboard.
