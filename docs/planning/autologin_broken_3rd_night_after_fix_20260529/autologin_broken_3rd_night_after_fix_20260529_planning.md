# Autologin Broken 3rd Night After Fix Plan

## Background
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## Requirements (from GH Issue #1123)
autologin is broken on prod overnight. User absolutely did not change anything, something automated reset password on either supabase or Vercel prod. Look into what might have done this and prevent this from happening ever again.

## Problem
Public-demo auto-login depends on a single shared guest password staying in sync across Supabase (prod), Vercel env, GitHub secrets, and `.env.local`. Autologin has broken overnight three nights running, each time after a fix — implying a recurring automated trigger rather than human change. The task is to identify the automated cause (most likely candidates: a password-reset takeover via the guest session, or the nightly prod E2E run mutating guest credentials) and put in place a permanent prevention so this cannot recur silently.

## Options Considered
- [ ] **Option A: Harden the password-reset guest gate + monitor `GUEST_USER_ID`**: Make the `/reset-password` guest gate fail-closed and add a check/alert when `GUEST_USER_ID` is missing on any tier. Addresses takeover-via-recovery-flow.
- [ ] **Option B: Quarantine guest credentials from automated test runs**: Guarantee nightly/prod E2E never targets the guest account for password mutations (dedicated users only + an assertion/guard), and/or skip guest auto-login paths in prod auth specs.
- [ ] **Option C: Atomic rotation + single source of truth**: One script that updates Supabase and pushes to all Vercel targets and redeploys (or move the secret to Supabase Vault), so a rotation can never half-apply and desync.
- [ ] **Option D: Synthetic autologin monitor**: Scheduled probe that performs guest autologin against prod and alerts immediately on failure — converts silent overnight breaks into an immediate page (detective control; pairs with A/B/C).

## Phased Execution Plan

### Phase 1: Confirm the automated root cause
- [ ] Reproduce/confirm current breakage: query prod for guest `last_sign_in`/`updated_at`, check Vercel `GUEST_PASSWORD` deploy snapshot vs Supabase prod auth row.
- [ ] Correlate breakage timestamps with the 06:00 UTC `e2e-nightly.yml` runs (and any Supabase/Vercel cron) to confirm the nightly correlation.
- [ ] Verify `GUEST_USER_ID` is set on prod Vercel; test whether the `/reset-password` guest gate currently fails open or closed on prod.
- [ ] Audit nightly-included auth specs for any `updateUser({password})` / `admin.generateLink` / `admin.updateUserById` that could hit the guest account.
- [ ] Enumerate Supabase scheduled jobs / Postgres `cron.job` / Vercel crons to rule out a direct reset job.

### Phase 2: Fix the root cause
- [ ] Implement the targeted fix for whichever cause Phase 1 confirms (see Options A/B).

### Phase 3: Permanent prevention (defense-in-depth)
- [ ] Make the reset gate fail-closed and alert on missing `GUEST_USER_ID` per tier (Option A).
- [ ] Guard automated runs from ever mutating guest credentials (Option B).
- [ ] Consider atomic rotation / single source of truth for the guest secret (Option C).
- [ ] Add a synthetic autologin monitor with alerting (Option D).

## Testing

### Unit Tests
- [ ] [TBD — e.g. test the reset-password guest gate returns 404/fail-closed when `GUEST_USER_ID` is unset]

### Integration Tests
- [ ] [TBD — e.g. password-reset integration test asserting guest account cannot be targeted]

### E2E Tests
- [ ] [TBD — e.g. assert guest autologin succeeds against a prod-like config; assert nightly specs use dedicated users only]

### Manual Verification
- [ ] [TBD — confirm guest autologin works on prod after fix + redeploy]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [TBD — load prod public URL session-less and confirm auto-login lands on demo, not /login]

### B) Automated Tests
- [ ] [TBD — specific test files/commands to run]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] docs/feature_deep_dives/authentication_rls.md — update guest auto-login / password-reset gate behavior and any new invariants
- [ ] docs/docs_overall/environments.md — document `GUEST_USER_ID` per-tier requirement, rotation procedure, monitoring
- [ ] docs/docs_overall/debugging.md — add runbook for diagnosing guest autologin failure
- [ ] docs/docs_overall/testing_overview.md — note guest-credential safety in nightly/prod runs (if changed)
- [ ] docs/feature_deep_dives/testing_setup.md — note nightly workflow guest-safety guard (if changed)

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
