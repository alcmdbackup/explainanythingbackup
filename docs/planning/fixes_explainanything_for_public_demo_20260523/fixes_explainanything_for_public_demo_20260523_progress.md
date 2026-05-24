# fixes_explainanything_for_public_demo_20260523 Progress

## Status (as of 2026-05-24)

| Phase | Status | Notes |
|---|---|---|
| 1 — Demo-hygiene cleanup | ✅ committed (`3359d29b`) | FILE_DEBUG flipped, debug-route gate added, 12 new middleware tests |
| 2 — Link whitelist bypass | ✅ committed (`cf775d10` + `315c1c2e`) | LINKS_BYPASS_WHITELIST env flag, module-scope TTL cache, 7 new tests |
| 3 — GenerationStatusPill | ✅ committed (`eecaae61`) | New component + 11 unit tests, wired into results page |
| 4 — Guest user + LLM cap | ✅ committed (`ede789d7`) | per_user_daily_cost_rollups migration, checkPerUserCap + 7 tests, seed-guest-user script |
| 5 — Middleware auto-login + auth UI | ✅ committed (`201f852b`) | Auto-login, useIsGuest hook, /login server-component split, 8 new middleware tests |
| 6 — Seed guest library script | ✅ committed (`dae61d9c`) | HTTP-driven seed script with idempotency, dry-run, force flags |
| 7 — Admin password rotation | ⏳ **needs manual ops** (see below) | Requires Supabase dashboard access |
| 8 — Paid-services inventory | pending | Documentation deliverable |
| Docs updates | pending | 5 feature deep dives + environments.md |

## Phase 7 — Manual Ops Checklist (requires Supabase dashboard access)

This is the one phase the local execution cannot complete. Please execute:

### Decision: A or B
- **Option A (recommended, decouples concerns)**: Split test user from admin user. Create `e2e-admin@explainanything.app`, add to `admin_users`, update `TEST_USER_EMAIL` in GitHub Production secrets. Then rotating `abecha@gmail.com` only affects the human admin.
- **Option B (faster, accepts coupling)**: Keep them conflated. Coordinate password-manager update + GitHub-secret update in the same change window.

### If Option A
1. Supabase dashboard (prod project `qbxhivoezkfbjbsctdzo`) → Authentication → Users → Add user `e2e-admin@explainanything.app`. **Capture the auto-generated UUID.**
2. SQL editor: `INSERT INTO admin_users (user_id, role) VALUES ('<captured-uuid>', 'admin');`
3. Update `supabase/seed-admin.sql` to include both `abecha@gmail.com` AND `e2e-admin@explainanything.app`. Commit.
4. GitHub repo → Settings → Environments → Production → Secrets:
   - `TEST_USER_EMAIL` → `e2e-admin@explainanything.app`
   - `TEST_USER_PASSWORD` → new generated password (`openssl rand -base64 32`)
   - `TEST_USER_ID` → captured UUID
5. Trigger `e2e-nightly` workflow via `workflow_dispatch` to verify.
6. Grep `src/__tests__/` for `abecha@gmail.com` — if any test hardcodes it, update.

### For both Options (rotation of `abecha@gmail.com`)
1. Generate password: `openssl rand -base64 32`
2. Supabase dashboard → Authentication → Users → `abecha@gmail.com` → Reset password.
3. **Update human password manager (1Password / Bitwarden / etc.)** — easy to forget.
4. Run script to invalidate any leaked refresh tokens:
   ```typescript
   // scripts/revoke-admin-sessions.ts (one-off, you can write this inline)
   const ADMIN_USER_ID = '<lookup-from-dashboard>';
   await supabase.auth.admin.signOut(ADMIN_USER_ID, { scope: 'global' });
   ```
5. If Option B: also update `TEST_USER_PASSWORD` in GitHub Production secrets.
6. Verify Vercel Production env vars don't store `TEST_USER_PASSWORD` (use `vercel env ls --environment=production`).
7. Flag in team chat: anyone with `.env.local` staging admin credentials needs to update.
8. Note rotation date + actor + Option (A or B) below.

### Rotation log
| Date | Actor | Option | Notes |
|---|---|---|---|
| pending | | | |

## Phase 4–6 — Ops still needed before demo

These are documented in the planning doc, repeated here for hand-off:

### Phase 4 prod migration
- Apply `supabase/migrations/20260524000003_add_per_user_daily_cost_rollups.sql` to prod (will happen automatically via GitHub Actions `supabase-migrations.yml` on push to main).
- Run `npx tsx scripts/seed-guest-user.ts` against prod via `op run --env-file=./scripts/.env.prod.write` (or `.env.local` swap with revert checkpoint). **Capture GUEST_PASSWORD output**.
- Set in Vercel Production env vars: `GUEST_EMAIL`, `GUEST_PASSWORD`, `GUEST_USER_ID`, `NEXT_PUBLIC_GUEST_EMAIL`.
- Set same 4 in Vercel Preview env vars.
- Set same 4 in GitHub Actions `staging` AND `Production` environment secrets.
- Edit `.github/workflows/ci.yml` `e2e-critical` job env block to inject GUEST_* secrets (when the chromium-guest-auto Playwright project is added).
- Edit `.github/workflows/post-deploy-smoke.yml` to add `E2E_TEST_MODE: 'true'` to the env block of the "Run Smoke Tests" step.

### Phase 5 staging rollback dry-run
1. Deploy Phase 5 to staging.
2. Confirm auto-login fires (visit staging public hostname incognito).
3. Remove `GUEST_PASSWORD` from staging Vercel env vars, redeploy.
4. Confirm site reverts to `/login` redirect (soft env check kicks in).
5. Re-set `GUEST_PASSWORD`, redeploy, confirm auto-login resumed.
6. Document dry-run timestamps below.

### Phase 6 seed run
- After Phase 4 env vars are set and Phase 5 auto-login is live: run `SEED_BYPASS_USER_CAP=true npx tsx scripts/seed-guest-library.ts --base-url=https://<staging>` first.
- Verify content quality manually (browse `/userlibrary` as guest).
- Then run against prod with `--base-url=https://<prod>`.

### Phase 5 Playwright config + E2E test (deferred from initial commit)
- Add new `chromium-guest-auto` project + secondary `webServer` block on port 3009 with `env -u E2E_TEST_MODE` wrapper (per planning doc).
- Add `src/__tests__/e2e/specs/01-auth/guest-auto-login.spec.ts` (per planning doc).
- These require staging env vars first, so they belong in a follow-up PR after the prod GUEST_* values exist.

## Dry-run log
| Date | Phase | Notes |
|---|---|---|
| pending | | |

## CI iteration log (post-/finalize)

| Iteration | Failure | Root cause | Fix |
|---|---|---|---|
| #1 | admin-evolution-invocation-detail-previous: Raw-LLM section not visible. Fixture log full of `22P02 invalid input syntax for type uuid: ""`. | Initial hypothesis: deny_all RLS blocks trigger INSERT into per_user_daily_cost_rollups, rolling back outer llmCallTracking insert. | 20260524000004: `ALTER FUNCTION ... SET row_security = off`. **Did NOT fix.** |
| #2 | Same failure persists; same 22P02 errors. | Re-investigated: `llmCallTracking.userid` is `uuid NOT NULL` (per 20251109053825_fix_drift.sql line 66) — NOT TEXT as the 20260524000003 schema comment claimed. The trigger's `NEW.userid = ''` literal forces PG to cast `''` to uuid → 22P02 → outer INSERT rolls back. | 20260524000005: drop the `IS NULL`/`= ''` guards entirely (column is `NOT NULL`), keep `estimated_cost_usd IS NULL` guard. Also keep `row_security = off` for the deny_all bypass. Cast `NEW.userid::text` for the rollup insert (rollup table uses TEXT). |
