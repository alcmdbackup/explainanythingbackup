# Autologin Broken 3rd Night After Fix Progress

## Phase 1: Confirm the automated root cause
### Work Done
- Queried prod `auth.users` for the guest: password had drifted; `updated_at`/`last_sign_in_at` patterns indicated the row changed overnight.
- Inspected Vercel: `vercel env ls production` showed `GUEST_PASSWORD` unchanged for 5 days → the env side is stable, so the DB side was drifting.
- Ruled out automated writers: pg_cron not installed (`cron.job` absent), `vercel.json` crons `[]`, `CRON_SECRET` unused, no `supabase/functions`, no repo code writing `encrypted_password`; `pg_stat_statements` showed only GoTrue's update writes the password (no raw-SQL writer).
- Pinpointed via Supabase Management API auth logs: `user_modified` `PUT /user` on `guest@explainanything.app` at **2026-05-29 07:28:20** (and **2026-05-28 07:28:44**), sandwiched in the `password-reset.spec.ts` sequence (create `pwreset-e2e-*` → generate_link → PUT /user on guest → delete), immediately followed by `invalid_credentials` failures.

### Root cause
The nightly `password-reset.spec.ts` runs against prod; on the public host the guest auto-login session displaces the recovery session, so `updateUser({ password })` overwrites the shared guest account instead of the dedicated `pwreset-e2e-*` user. The `@example.com` test email (rejected by prod GoTrue) contributed to the displaced-session path.

### Issues Encountered
- Postgres statement logs don't capture the write (DML not logged; `log_statement=ddl`); the connection summary showed no anomalous direct connection. Resolved by reading the GoTrue auth logs (`auth_logs`) which carry the `user_modified` actor.

## Phase 2: Fix the root cause (Option B)
### Work Done
- Immediate: realigned the prod DB guest password to the Vercel env value to restore service.
- `ResetPasswordForm.tsx`: hard guard — `onSubmit` refuses to call `updateUser` when the active session is the guest (or there is no session). Protects real users too.
- `password-reset.spec.ts`: `@skip-prod` (don't run the destructive recovery flow against the live guest) + dedicated user now uses a valid TEST_USER-domain email.
- `password-reset.integration.test.ts`: same valid-domain email for consistency.
- `ResetPasswordForm.test.tsx`: 2 new tests covering the guard (guest session at submit; no session). 13/13 pass.

### Verification
- eslint 0, tsc 0, ResetPasswordForm unit tests 13/13.

## Phase 3: Permanent prevention
### Work Done
- Option B (guard + test isolation) shipped as the defense-in-depth fix.
- Options A/C/D (alerting, atomic rotation, synthetic canary) recorded as follow-ups in the plan.
