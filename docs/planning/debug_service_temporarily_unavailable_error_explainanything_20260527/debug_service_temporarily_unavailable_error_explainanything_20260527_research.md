# Debug Service Temporarily Unavailable Error Explainanything Research

## Problem Statement
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## Requirements (from GH Issue #1104)
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## High Level Summary

The "Service Temporarily Unavailable" page is rendered by `src/app/login/ServiceUnavailableNotice.tsx` (a server component swapped in by `src/app/login/page.tsx`) when the `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie is present.

That cookie is set by `src/lib/utils/supabase/middleware.ts` in the public-host guest auto-login path, with a 60s TTL, **whenever** `supabase.auth.signInWithPassword({ email: GUEST_EMAIL, password: GUEST_PASSWORD })` rejects. So the user-visible symptom is precisely "the guest credentials Vercel runtime is sending to Supabase are not accepted." Every overnight recurrence means either the password Supabase has, the password Vercel runtime is sending, or the call itself, is breaking.

Documented rollback levers (no code revert): set `E2E_TEST_MODE=true` OR remove `GUEST_PASSWORD` from Vercel env vars and redeploy — both disable the auto-login path so the regular `/login` form renders. The user's reported "reset guest_password" fix works because it re-aligns Supabase's stored password with the Vercel env var; whatever drifts them apart again is the root cause we need to identify.

Key gates and surfaces that touch the guest account:
- **Hostname classification** (`src/config/hostnames.ts`): auto-login fires only on `public | local | preview`, never on `evolution` or `unknown`. Production host is `https://ea-evolution.vercel.app`; staging is `https://explainanythingstage.vercel.app`.
- **Concurrency dedupe**: module-scope `inFlightGuestLogin` map + `Promise.race` with 10s timeout — failure here would propagate to the cookie path.
- **Triple-gate against guest password takeover** (`src/app/reset-password/`): server-side `GUEST_USER_ID` check + client `PASSWORD_RECOVERY` event + `useIsGuest()` email check. If any gate fails (e.g. `GUEST_USER_ID` missing in production), an attacker / accidental visitor could overwrite the guest password.
- **`getUser()` cookie refresh path** uses the same `setAll()` mechanism, so middleware bugs that break cookie writes would also break auto-login.

Adjacent failure modes from `error_handling.md` worth ruling out: `LLM_KILL_SWITCH` and `GLOBAL_BUDGET_EXCEEDED` (per-user $10/day cap on `GUEST_USER_ID`) — both would surface as service errors but downstream of login, not at it.

Vercel surface area worth surveying:
- Production target: `https://ea-evolution.vercel.app`. Staging target: `https://explainanythingstage.vercel.app`. (Note: `docs/docs_overall/environments.md` still lists the old `explainanything.vercel.app` prod URL — outdated.)
- Env var sets per target: Production, Preview, Staging. `GUEST_PASSWORD`, `GUEST_EMAIL`, `NEXT_PUBLIC_GUEST_EMAIL`, `GUEST_USER_ID` must all match the Supabase row in the corresponding Supabase project (dev `ifubinffdbyewoezcidz` vs prod `qbxhivoezkfbjbsctdzo`).
- `e2e-nightly.yml` runs daily at 06:00 UTC against live production. It uses `TEST_USER_*`, not the guest user, but nightly cadence aligns with "broke overnight" timing — worth verifying the workflow does not touch the guest row.

## Decision: ship symptom fix first, keep root-cause investigation separate

After the initial research above, we discussed and decided to **decouple the UX symptom from the root cause**. Two independent threads:

**Thread A — Symptom fix (this project's Phase 0, ready to implement):**
Delete the `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie (set + read), delete `ServiceUnavailableNotice.tsx`, and block autologin on `/login` via `!request.nextUrl.pathname.startsWith('/login')`. When guest autologin fails, the visitor now lands on `/login` and sees the regular `<LoginForm />` instead of a static "Service Temporarily Unavailable" message — strictly better UX (a real user can still sign in manually with their own credentials).

**Thread B — Root cause (this project's Phase 1+, the original 10-hypothesis investigation):**
Still needed. The guest password keeps drifting overnight; we don't know why. The symptom fix does NOT address this. We continue the diagnostic plan (Vercel env audit, Supabase audit log review, Honeycomb middleware spans, etc.) to identify whether it's recovery-flow leakage, env drift, scheduled job, platform change, etc.

### Why not a server-side breaker?

We initially considered replacing the cookie with a module-scope `Map<string, number>` breaker. Rejected as unnecessary at current traffic:

- The cookie does TWO jobs: (1) rate-limit protection (avoid hammering Supabase's ~30/min/IP auth limit), (2) UX gate (show `<ServiceUnavailableNotice />`).
- At minimal traffic (tens of visits/day), Job 1 is theoretical — we're three orders of magnitude under the rate limit. The existing `inFlightGuestLogin` Map already dedupes concurrent calls; serial calls at low volume don't cascade.
- Job 2 is what we want to delete entirely (bad UX).
- Conclusion: no breaker needed. Just delete the cookie and let `<LoginForm />` render. Add a breaker later if traffic warrants it.

### Why block autologin on `/login` specifically?

Without it, the failure path becomes 2 signIn attempts per navigation (one on the protected route, another after the unauth-redirect to `/login`). With `!startsWith('/login')` in the autologin guard, it stays at 1 attempt per navigation — same cost as the cookie version. Trade-off: fresh visitors hitting `/login` directly now see `<LoginForm />` instead of being silently turned into guests and redirected to `/`. Acceptable; arguably better UX.

### Failure-block: trim, don't delete

The failure handler at `middleware.ts:119-150` does three things: log, redirect to `/login`, copy supabase cookies (PKCE state clears etc.) onto the redirect. Keep the log + redirect + cookie-copy; remove only the `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie set. Preserves the "supabase cookie invariant" the block was enforcing.

### What the change DOES NOT fix

- Why the guest password keeps drifting — still TBD.
- The detection signal in `smoke.public.spec.ts` continues to work (the URL assertion `not.toHaveURL(/\/login/)` still catches the failure mode), but its comment needs updating.
- Sentry/Honeycomb signal: we lose the "cookie set" event as a marker. Replaced by the existing `[middleware] guest-auto-login failed` warn log.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (curated)
- docs/docs_overall/debugging.md
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/authentication_rls.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/realtime_streaming.md
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/request_tracing_observability.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- `src/lib/utils/supabase/middleware.ts` — full file. Confirms cookie set at L143, cookie read at L70, `inFlightGuestLogin` Map at L12, existing `?logout=1` opt-out at L74, failure block at L119-150.
- `src/app/login/page.tsx` — server component; cookie check at L25 (delete), guest-redirect at L30-42 (keep), `<LoginForm />` default at L44.
- `src/app/login/ServiceUnavailableNotice.tsx` — static markup, delete entirely.
- `src/lib/utils/supabase/middleware.test.ts` (lines 490-570) — cases (f)(i)(k)(l) cookie/opt-out handling.
- `src/__tests__/e2e/specs/auth.unauth.spec.ts` (lines 1-80) — local-dev cookie fixture at L31-35.
- `src/__tests__/e2e/specs/smoke.public.spec.ts` (lines 40-77) — `service-unavailable-notice` count-0 assertion at L67, URL assertion at L68.
- File listing under `src/app/login/` — no subroutes; `startsWith('/login')` is safe.
