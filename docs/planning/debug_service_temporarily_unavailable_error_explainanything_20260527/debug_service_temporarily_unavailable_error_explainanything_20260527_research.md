# Debug Service Temporarily Unavailable Error Explainanything Research

## Problem Statement
keep getting service temporarily unavailable error, despite it working twice before after resetting guest_password. Something is systematically wrong, it broke overnight again it seems like Vercel changed something. Help me explore and comeup with hypotheses on why it keeps brekaing

## Requirements (from GH Issue #NNN)
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
- (none yet — research phase; see planning doc Phase 1 for the diagnostic file reads to do next)
