# Research

## Problem Statement
Clicking "Reset password" in the Supabase password-reset email lands the user on the normal `/login` page with no way to set a new password. The expected behaviour is: email link → recovery token verified → user lands on a "set new password" form → submits → password is updated and they are signed in.

## Requirements
- A `/forgot-password` entry point (or in-form prompt) on `/login` that calls `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
- A working recovery callback so the email link establishes a recovery session.
- A `/reset-password` page that captures a new password and calls `supabase.auth.updateUser({ password })`.
- The recovery email template (Supabase project settings) must point at our app's callback with the right `next=` target.
- Middleware must let the recovery flow through without bouncing to `/login`.
- Tests covering the full flow.

## High Level Summary

Two layered failures produce the symptom:

1. **No `/reset-password` page exists.** Even when the OTP callback works, the user gets redirected to a 404, which then falls through middleware to `/login`. The route handler already verifies `type=recovery` tokens (`src/app/auth/confirm/route.ts:11-34`) and the unit test at `src/app/auth/confirm/route.test.ts:131-146` already asserts `next=/reset-password` — strong evidence that someone started this work and stopped before adding the page.
2. **Recovery email template likely uses Supabase defaults**, which point at `{{ .SiteURL }}/...` (the homepage), not at `/auth/confirm`. The local `supabase/config.toml` has no `[auth.email.template.recovery]` block (only a commented-out invite stub at lines 183-186), and the prod template lives in the Supabase dashboard — both probably untouched. So in practice the email link drops users at `/` with `?token_hash=…&type=recovery` query params that nothing in the app parses; middleware sees no session and redirects to `/login`. This matches the reported symptom exactly ("nothing different happens, sent to login").

There is also no entry point: `src/app/login/LoginForm.tsx:236-238` renders a hardcoded `<span>` reading "Forgot password? Contact your admin" — no link, no action, no call to `resetPasswordForEmail` anywhere in `src/`.

The fix per Supabase's @supabase/ssr docs is the canonical four-piece flow: trigger (`resetPasswordForEmail` with `redirectTo` pointing at `/auth/confirm?next=/reset-password`), callback (already exists, do nothing), update-password page (new), and email-template override pointing at the callback.

## Documents Read
- `docs/feature_deep_dives/authentication_rls.md` — full Supabase Auth wiring: middleware, login/signup actions, guest auto-login. **Has no mention of password reset** — confirms the gap.
- `docs/docs_overall/environments.md` — env vars and Supabase project IDs (dev `ifubinffdbyewoezcidz`, prod `qbxhivoezkfbjbsctdzo`). Relevant because the recovery email template lives in the Supabase dashboard per-project.
- `docs/feature_deep_dives/error_handling.md` — `LLM_KILL_SWITCH` etc., no password-reset error codes.
- `docs/docs_overall/debugging.md` — Sentry/Honeycomb/tmux logs available for verifying the flow end-to-end.
- **Supabase Auth — Passwords guide** (https://supabase.com/docs/guides/auth/passwords) — canonical four-piece flow: `resetPasswordForEmail({ redirectTo })`, email template with `token_hash`+`type=recovery`+`next`, `/auth/confirm` route handler calling `verifyOtp`, update-password page calling `updateUser({ password })`.

## Code Files Read
- `src/app/auth/confirm/route.ts:1-34` — **EXISTS and works**. Handles `verifyOtp({ type, token_hash })`, redirects to sanitized `next` on success, `/error` on failure. No changes needed; `type='recovery'` already flows through.
- `src/app/auth/callback/route.ts:1-26` — PKCE OAuth callback via `exchangeCodeForSession`. Not on the recovery path (OTP, not OAuth) — leave alone.
- `src/app/login/page.tsx` — server shell that does guest-redirect, then renders `LoginForm`. No reset hook.
- `src/app/login/LoginForm.tsx:236-238` — hardcoded `<span>` "Forgot password? Contact your admin". This is where the entry-point link/button must go.
- `src/app/login/actions.ts:1-179` — `login`, `signup`, `signOut` Sentry-wrapped server actions. **No `resetPassword` or `requestPasswordReset` action**. New action to add here.
- `src/middleware.ts:44-89` — hostname-tier gating, then `updateSession`. `/auth/*` paths are not in the public-tier 404 list, so the callback will be reached on every tier.
- `src/lib/utils/supabase/middleware.ts:147-158` — the redirect-to-login block: `!currentUser && !path.startsWith('/login') && !path.startsWith('/auth')`. `/reset-password` is NOT in the allowlist. After `verifyOtp` runs, the cookie is set inline on the response, so the redirect to `/reset-password` carries the new session and middleware should see `currentUser` on the next request — but this needs verification in testing. If the cookie write is async-delayed, we may need to add `/reset-password` to the allowlist.
- `src/lib/utils/supabase/server.ts` — server client setup (referenced; defaults to PKCE flow per @supabase/ssr).
- `src/app/auth/confirm/route.test.ts:131-146` — **already-written test for recovery flow** expecting `next=/reset-password`. Strong indicator the implementation was started but not finished.
- `supabase/config.toml:156-186` — `[auth.email]` section, only commented-out invite template at lines 183-186. **No `[auth.email.template.recovery]` block** — local dev uses Supabase default recovery template.

## Key Findings

1. **`/auth/confirm` already supports recovery tokens** — `verifyOtp` is called with whatever `type` the URL provides, including `recovery`. No changes needed to this route.
2. **`/reset-password` page does not exist** — `ls src/app/reset-password` returns "No such file or directory". The recovery flow currently dead-ends here.
3. **No `resetPasswordForEmail` call exists anywhere in `src/`** (grep returned zero hits). No way for a user to trigger a reset.
4. **Hardcoded "Contact your admin" placeholder** at `src/app/login/LoginForm.tsx:236-238` is the only UI surface that even acknowledges forgotten passwords.
5. **Pre-existing test for the flow** at `src/app/auth/confirm/route.test.ts:131-146` already pins `next=/reset-password`. We should match that contract.
6. **Recovery email template is the silent failure point** — `supabase/config.toml` has no override. Prod uses whatever's configured in the dashboard. Per the Supabase docs, the template body must be customized to:
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset password</a>
   ```
7. **`redirectTo` must be an allowed redirect URL** in each Supabase project (dev + prod dashboards) — separate config from the email template.
8. **Middleware allowlist for `/reset-password`** — the path starts with neither `/login` nor `/auth`. After `verifyOtp` sets cookies on the `/auth/confirm` response, the redirect to `/reset-password` should arrive with a session. If cookie propagation races the redirect (Supabase docs warn about this in some hosting setups), we'd need to add `/reset-password` to the allowlist. Verify via tmux + Playwright before adding the bypass — simpler if not needed.
9. **Guest auto-login interaction** — `src/lib/utils/supabase/middleware.ts:67-145` calls `signInWithPassword` for unauthenticated public-tier requests. If a real (non-guest) user hits `/reset-password` with a recovery session, the auto-login block is skipped because `currentUser` is now set. Should not interfere.
10. **Two-project consideration** — dev and prod Supabase projects each have their own email-template and redirect-URL config. Whatever we ship needs ops steps for both dashboards in addition to the code changes.

## Open Questions

1. **Where should the "Forgot password?" trigger live?** Replace the static `<span>` with a `<Link href="/forgot-password">` to a dedicated page, OR turn it into an inline form that submits to a server action and shows "check your email"? Inline is fewer routes; dedicated page is more conventional and easier to deep-link.
2. **Site URL for `redirectTo`** — must use `request.headers.get('origin')` or `NEXT_PUBLIC_SITE_URL`? The latter is more deterministic across host-split (`explainanything.vercel.app` vs `ea-evolution.vercel.app`) but the recovery flow is public-only, so deriving from `origin` is fine. Pick one and document.
3. **Should `/reset-password` enforce that a recovery session exists?** Defense in depth: even if a user lands here without a recovery token, the `updateUser` call would change the password of the currently-logged-in account. If guest auto-login fires and a visitor browses to `/reset-password` directly, they could change the *guest* user's password. Need to gate on `request.user.app_metadata` or check `event === 'PASSWORD_RECOVERY'` (Supabase emits this in the auth state change subscription).
4. **Email template — local vs prod parity** — local `supabase/config.toml` can be updated and applied via `supabase db reset`. Prod template is dashboard-only and needs a one-time manual update. Document the runbook in the planning doc.
5. **E2E coverage** — recovery is hard to E2E without intercepting the email. Two options: (a) call `resetPasswordForEmail` and inspect the test DB's `auth.users` recovery_token directly to construct the URL ourselves, (b) integration test only and rely on manual smoke for the full email round-trip. Decide in planning.
6. **Existing `/auth/confirm` test contract** — `route.test.ts:131-146` already pins `next=/reset-password`. The new page must satisfy that contract. Should the path be configurable or fixed?

## Suggested Next Steps for Planning

- Decide entry-point shape (Q1) and recovery-session gating (Q3) — those are the only real design choices.
- Document the dashboard runbook for both Supabase projects (email template body + allowed redirect URL).
- Pick the testing strategy (Q5).
- Then enumerate the file changes: new `/forgot-password` page (or inline form), new `/reset-password` page, new server action in `src/app/login/actions.ts`, edit to `LoginForm.tsx:236-238`, optional `supabase/config.toml` recovery template block.
