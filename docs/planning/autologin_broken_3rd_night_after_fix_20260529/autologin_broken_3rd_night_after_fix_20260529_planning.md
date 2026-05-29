# Autologin Broken 3rd Night After Fix Plan

## Background
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## Requirements (from GH Issue #1123)
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## Problem
Public-demo auto-login signs every session-less visitor into one shared Supabase guest account (`guest@explainanything.app`). It broke overnight ~3 nights running. **Root cause CONFIRMED** (via Supabase Management API logs): the nightly E2E `password-reset.spec.ts` runs against production, and its `updateUser({ password })` lands on the shared guest account instead of its dedicated per-run user — because on the prod public host the guest auto-login session displaces the recovery session. This rewrites the guest DB password so it no longer matches the (stable) Vercel `GUEST_PASSWORD` env, and real-visitor autologin fails until the DB password is manually reset.

Evidence: identical `user_modified` `PUT /user` on `guest@explainanything.app` at **2026-05-28 07:28:44** and **2026-05-29 07:28:20**, each immediately followed by `invalid_credentials` failures on the once-a-minute prober; Vercel `GUEST_PASSWORD` unchanged for 5 days; `pg_stat_statements` shows only GoTrue ever writes the password (no raw-SQL writer); pg_cron (`cron.job` absent), `vercel.json` crons `[]`, and edge functions all ruled out.

## Options Considered (discussion)
- **Option A — harden reset gate + alert on missing `GUEST_USER_ID`**: deferred (the server gate already exists; alerting is a follow-up).
- **Option B — quarantine guest creds from automated runs (CHOSEN)**: dedicated per-run user + a form-level guard that refuses `updateUser` on a guest session + `@skip-prod` on the destructive recovery E2E. Directly stops the confirmed cause and also protects real users.
- **Option C — atomic rotation / single source of truth**: deferred follow-up.
- **Option D — synthetic autologin monitor**: deferred follow-up.

## Phased Execution Plan

### Phase 1: Confirm the automated root cause
- [x] Confirmed current breakage via prod queries (guest password drift; Vercel `GUEST_PASSWORD` stable 5 days).
- [x] Correlated with the nightly `e2e-nightly.yml` run (guest `user_modified` at ~07:28 UTC on 2026-05-28 and -29).
- [x] Verified `GUEST_USER_ID` is set on prod Vercel.
- [x] Audited nightly auth specs — `password-reset.spec.ts` `updateUser` hits the guest via the displaced recovery session.
- [x] Ruled out direct reset jobs — no pg_cron, `vercel.json` crons `[]`, no edge functions, no repo writer (`pg_stat_statements` shows only GoTrue writes the password).

### Phase 2: Fix the root cause (Option B)
- [x] Form guard in `ResetPasswordForm.tsx` — never `updateUser` while the active session is the guest.
- [x] `@skip-prod` on `password-reset.spec.ts` so the destructive recovery flow never runs against the live guest.
- [x] Valid TEST_USER-domain email for the dedicated user in both password-reset tests (prod GoTrue rejects `@example.com`).
- [x] Restored prod immediately by realigning the DB guest password to the Vercel env value.

## Testing

### Unit Tests
- [x] `src/app/reset-password/ResetPasswordForm.test.tsx` — guard refuses `updateUser` when the submit-time session is the guest, and when there is no session.

### Integration Tests
- [x] `src/__tests__/integration/password-reset.integration.test.ts` — dedicated user with a valid email domain (mirrors prod); full recovery → updateUser → signIn chain.

### E2E Tests
- [x] `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts` — dedicated per-run user; `@skip-prod` (runs on dev/PR-CI only); stays `@critical`.

### Manual Verification
- [x] Confirmed guest autologin works on prod after realigning the DB password (session-less fetch of `/` returns 200, not `/login`).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Manual: session-less GET of the prod public URL returns the demo (HTTP 200), not `/login` (verified post-fix).

### B) Automated Tests
- [x] `npm test -- src/app/reset-password/ResetPasswordForm.test.tsx` (guard unit tests — 13/13 pass)
- [x] Full lint / tsc / build / unit / ESM / integration + `test:e2e:critical` run by /finalize Step 4–5.

## Documentation Updates
- [x] docs/feature_deep_dives/authentication_rls.md — documented the reset-flow guest guard and why the password-reset E2E is `@skip-prod`.
- [x] docs/docs_overall/environments.md — reviewed; guest env-var topology already documented, no change needed.
- [x] docs/docs_overall/debugging.md — reviewed; no change needed for this PR.
- [x] docs/docs_overall/testing_overview.md — reviewed; `@skip-prod` semantics already documented.
- [x] docs/feature_deep_dives/testing_setup.md — reviewed; no change needed.

## Follow-ups (out of scope for this PR)
- Synthetic guest-autologin canary that pages the moment `signInWithPassword(guest)` fails on prod (Option D).
- Investigate *why* the recovery session is displaced by guest auto-login on prod despite the middleware `/reset-password` skip (deeper app-flow race).
- Atomic guest-password rotation across all stores / single source of truth (Option C); alert on missing `GUEST_USER_ID` per tier (Option A).
- Rotate the prod `service_role` key and revoke the temporary Supabase PAT + Vercel token used during diagnosis.

## Review & Discussion
Root cause confirmed empirically from Supabase Management API logs (see research doc). Chosen fix = Option B (form guard + test isolation), which stops the confirmed cause and also protects real users; Options A/C/D recorded as follow-ups.
