# Reset Readonly Local Prod Files Research

## Problem Statement
The user reports that `.env.prod.readonly` and `.env.staging.readonly` (files enabling `npm run query:prod` / `npm run query:staging` via `readonly_local` Postgres role) were accidentally deleted. User wants (a) SQL queries to retrieve/reset passwords, (b) files recreated in every worktree (`explainanything-worktree0`, `worktree_37_1` … `worktree_37_15`), and (c) confirmation that `reset_worktrees` will propagate these files on future resets.

## Requirements (from GH Issue #972)
I want to restore the accidentally deleted prod readonly and local readonly files that let Claude Code query Supabase dev and prod respectively. Give me queries to retrieve passwords and then recreate the files for me in exploreanything-worktree0, worktree_37_1, ... worktree_37_x. Also, make sure that @reset_worktrees copies over this file when it is run.

## High Level Summary

Investigation over two rounds of 4 parallel agents revealed the situation is **less dire than assumed**:

1. `.env.prod.readonly` **still exists** in the main worktree (`/home/ac/Documents/ac/explainanything-worktree0/.env.prod.readonly`, 505 bytes, Feb 26) with a **valid working password**. It is only missing from the 15 sibling worktrees.
2. `.env.staging.readonly` **is missing everywhere** (and may never have existed — the `readonly_local` role itself is likely not provisioned on staging).
3. The `reset_worktrees` script at repo root **already** copies both files to every new worktree (lines 155–161). **No code change is needed.**
4. Postgres never stores plaintext passwords — `SELECT * FROM pg_authid` returns only hashes — so **retrieval is impossible**. For staging, a new password must be generated and `readonly_local` either created or `ALTER`ed on the dev DB.

### Recommended path forward
- **Prod**: leave `.env.prod.readonly` untouched (still works). Running `./reset_worktrees` will propagate it to all siblings via the existing file-copy loop.
- **Staging**: verify whether `readonly_local` role exists on dev DB → create/reset → write `.env.staging.readonly` in main worktree → run `./reset_worktrees` to fan out to siblings.

---

## Key Findings

### 1. File locations, env var names, and formats

| File | Env var | Format (live, from existing prod file) |
|---|---|---|
| `.env.prod.readonly` | `PROD_READONLY_DATABASE_URL` | `postgresql://readonly_local.<PROJECT_REF>:<PASSWORD>@aws-1-us-east-2.pooler.supabase.com:5432/postgres` |
| `.env.staging.readonly` | `STAGING_READONLY_DATABASE_URL` | Same pooler format, with staging `<PROJECT_REF>` |

- **Project refs**: prod = `qbxhivoezkfbjbsctdzo`; staging/dev = `ifubinffdbyewoezcidz`.
- Consumer: `scripts/query-db.ts` — uses `dotenv.config({ path: <envFile> })`; only validates that the URL env var is non-empty (no regex).
- The staging env var name is hard-coded at `scripts/query-db.ts:32` (`STAGING_READONLY_DATABASE_URL`).
- **Note**: `.env.prod.readonly.example` uses the **stale** direct-connection format (`db.<ref>.supabase.co:5432`), while the live file uses the **pooler** format. When recreating files, match the pooler format used by the existing live prod file. Example template should also be updated.

### 2. `.gitignore` + git history
- `.gitignore:43` — `.env*` blanket ignore.
- Lines 44–45 — `!.env.prod.readonly.example`, `!.env.staging.readonly.example` allowlisted.
- `git log --all --full-history` shows no commit for either `.env.*.readonly` (as expected — never committed).
- `git stash list` and `git reflog` — no recovery traces.

### 3. Worktree layout and current state
`git worktree list` + `ls /home/ac/Documents/ac/` confirms 16 worktrees:

| Worktree | `.env.local` | `.env.prod.readonly` | `.env.staging.readonly` |
|---|:---:|:---:|:---:|
| `explainanything-worktree0` (main) | ✓ | ✓ | ✗ |
| `worktree_37_1` … `worktree_37_15` | ✓ | ✗ | ✗ |

### 4. `reset_worktrees` script behavior (at repo root `./reset_worktrees`, 283 lines)
- **Line 20**: `GIT_ROOT=$(git rev-parse --show-toplevel)` → always resolves to `/home/ac/Documents/ac/explainanything-worktree0` regardless of where script is invoked from.
- **Step 0.5 (35–51)**: deletes all old sibling `worktree_*` dirs.
- **Step 1 (54–74)**: `git worktree remove` + prune.
- **Step 3b Pass 1 (137–186)**: creates 15 fresh worktrees; per worktree, the loop at **lines 155–161** copies every env file that exists in `$GIT_ROOT`:
  ```bash
  for env_file in .env.local .env.test .env.stage .env.prod .env.staging.readonly .env.prod.readonly; do
      if [ -f "$GIT_ROOT/$env_file" ]; then
          echo "  Copying $env_file..."
          cp "$GIT_ROOT/$env_file" "$WORKTREE_PATH/"
      fi
  done
  ```
  - Missing files are silently skipped (the `[ -f ]` guard).
  - `.env.staging.readonly` is already in the list — **no modification required**.
- **Conclusion**: once `.env.staging.readonly` exists in the main worktree, the next `./reset_worktrees` run propagates it to all 15 sibling worktrees.

### 5. SQL for password reset / role provisioning

Passwords **cannot be retrieved** — Postgres stores them hashed. Workflow:

**Verification SQL** (run in Supabase SQL editor for each project):
```sql
SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'readonly_local';
SELECT name, setting FROM pg_db_role_setting
  WHERE setrole = (SELECT oid FROM pg_roles WHERE rolname = 'readonly_local');
SELECT grantee, privilege_type FROM information_schema.table_privileges
  WHERE table_schema = 'public' AND grantee = 'readonly_local' LIMIT 5;
```

**If role EXISTS** (just rotate password):
```sql
ALTER ROLE readonly_local WITH PASSWORD '<NEW_PWD>';
```

**If role DOES NOT EXIST** (full creation, matches `implement_safe_read_only_access_prod_supabase_20260224` plan):
```sql
CREATE ROLE readonly_local WITH LOGIN PASSWORD '<NEW_PWD>';
GRANT CONNECT ON DATABASE postgres TO readonly_local;
GRANT USAGE ON SCHEMA public TO readonly_local;
REVOKE CREATE ON SCHEMA public FROM readonly_local;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_local;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO readonly_local;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO readonly_local;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO readonly_local;
ALTER ROLE readonly_local SET default_transaction_read_only = on;
ALTER ROLE readonly_local SET statement_timeout = '30s';
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM readonly_local;
-- Optionally re-grant EXECUTE on read-only helper functions (match prod config)
```

**Password generation** (URL-safe, avoids `/=+` that would otherwise need percent-encoding):
```bash
openssl rand -base64 32 | tr -d '/=+' | cut -c1-32
```

**Dashboard SQL editor links**:
- Prod: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/sql/new
- Staging: https://supabase.com/dashboard/project/ifubinffdbyewoezcidz/sql/new

## Round 3 Findings (live password-recovery attempt)

After rounds 1 & 2, user requested password retrieval rather than rotation. Retrieval sweep across every candidate store:

| Source | Result |
|---|---|
| `/home/ac/Documents/ac/` worktrees (`.env*`) | Only prod file exists; staging not present in any worktree |
| `~/.bash_history`, `~/.zsh_history`, `~/.psql_history` | No matches |
| Full recursive grep of `/home/ac` (excluding `node_modules`, `.next`, `.cache`) | No matches outside Claude transcripts |
| Claude Code session transcripts (`~/.claude/projects/*/*.jsonl`) | 3 historical candidates found from 2026-03-29: `staging_readonly_2026`, `StagingReadOnly2026xKm9Qp4wRtYz`, `7e08a498af283e28101d9f00216ab288c10f82bd730e933a` |
| Postgres `pg_authid` | Hashes only (SCRAM-SHA-256) — plaintext not recoverable |

All 3 transcript candidates tested against `aws-0-us-east-1.pooler.supabase.com:5432` → all failed with `SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing` (auth rejection). Staging role password had been rotated at least once after the transcripts. **Conclusion: retrieval impossible; rotation was the only path.**

### Pooler host confirmed
- Prod project (`qbxhivoezkfbjbsctdzo`) → `aws-1-us-east-2.pooler.supabase.com:5432`
- Staging project (`ifubinffdbyewoezcidz`) → `aws-0-us-east-1.pooler.supabase.com:5432` (a different region)
- Trying prod's host with staging credentials returns `"Tenant or user not found"` — distinguishes host mismatch from auth failure.

### Supavisor password propagation is intermittent
Resetting the staging password via `ALTER ROLE readonly_local WITH PASSWORD '…';` in the SQL editor **persistently failed during this session**, even after:
- Generating a URL-safe hex password (no `+`, `=`, `/` to encode)
- Explicitly setting `password_encryption = 'scram-sha-256'` before the ALTER
- Verifying `pg_authid.rolpassword` started with `SCRAM-SHA-256$4`
- Confirming role has `rolcanlogin = true` and is visible in Dashboard → Roles (with `bypass RLS = true`)

After resetting the same hex password via Dashboard → Settings → Database → Roles UI, connection succeeded immediately. However, the user later observed a different worktree recover without any further password reset, so **this appears to be an intermittent propagation delay between Postgres and Supavisor rather than a reproducible "SQL-editor doesn't update pooler" bug**. Initial guess: Supavisor propagates `ALTER ROLE` on its own schedule; the Roles UI likely just triggers propagation synchronously.

Successful staging connection (after eventual propagation):
```
✅ Connected to staging (read-only)
count: 35237
```
Followed by confirmed readonly enforcement (`DELETE` → `permission denied for table explanations`).

## Resolved Questions

1. **Prod rotation** → Not needed. `.env.prod.readonly` intact and functional.
2. **Staging `readonly_local` existence** → Role existed, but password was not retrievable. Rotated via Dashboard Roles UI (the only working path).
3. **`.env.prod.readonly.example` format** → Still stale (uses direct `db.*.supabase.co` format). Should be updated to pooler format to match current production use. **Pending.**
4. **`.env.staging.readonly.example` format** → Already in pooler format — but points at `aws-1-us-east-2` while staging actually lives on `aws-0-us-east-1`. **Pending** a region-agnostic rewrite or explicit note that the host comes from the project's dashboard.
5. **`reset_worktrees` coverage** → Already copies both readonly files (lines 155–161, `[ -f ]`-guarded, silent skip if missing). **No code change required.**

## Open Questions

1. Intermittent Supavisor/Postgres propagation for password changes — is the delay bounded? Worth a lightweight note in `docs/docs_overall/debugging.md` that a repeated `SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing` right after a password change may self-resolve within a few minutes, and if it doesn't, resetting via Dashboard → Roles UI usually nudges it.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/environments.md — Read-Only Database Access section (lines 103–146) — pooler format, role privileges, script commands
- docs/docs_overall/debugging.md — CLI debugging & query:prod usage
- docs/docs_overall/cloud_env.md, testing_overview.md, feature_deep_dives/testing_setup.md — env-var ecosystem context
- docs/planning/implement_safe_read_only_access_prod_supabase_20260224/ — original role creation SQL (prod)
- docs/planning/supabase_cli_usage_instructions_20260327/ — staging CLI link instructions; notes staging role setup is still a manual step
- docs/planning/modify_reset_worktrees_20260327/ — confirmed the 15-worktree + parallel-install design already landed

## Code Files Read

- `/home/ac/Documents/ac/explainanything-worktree0/reset_worktrees` (283 lines) — env-file copy loop at 155–161, GIT_ROOT resolution at line 20, step 0.5 deletion at 35–51
- `/home/ac/Documents/ac/explainanything-worktree0/scripts/query-db.ts` — target config table (lines 23–36), dotenv load (line 125), non-empty check (lines 127–132), staging env var name (line 32)
- `/home/ac/Documents/ac/explainanything-worktree0/.env.prod.readonly` — confirmed format (pooler URL, `PROD_READONLY_DATABASE_URL`, 6 lines, 505 bytes)
- `/home/ac/Documents/ac/explainanything-worktree0/.env.prod.readonly.example` — stale direct-connection format
- `/home/ac/Documents/ac/explainanything-worktree0/.env.staging.readonly.example` — pooler format
- `/home/ac/Documents/ac/explainanything-worktree0/package.json` — `query:prod` / `query:staging` script definitions
- `/home/ac/Documents/ac/explainanything-worktree0/.gitignore` lines 43–45
