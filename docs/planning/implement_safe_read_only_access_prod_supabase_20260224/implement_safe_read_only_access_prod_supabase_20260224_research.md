# Implement Safe Read-Only Access to Prod Supabase Research

## Problem Statement
We need a safe way to query the production Supabase database for debugging, analytics, and data inspection. The solution must not grant write access and must not expose the production Supabase service role key or anon key in local environments or code.

## Requirements (from GH Issue #552)
- A) No write access — queries must be strictly read-only
- B) No exposure of prod Supabase keys — the prod service role key and anon key must not appear in .env files, code, or logs

## High Level Summary

The codebase currently has no read-only access pattern for prod. All prod access uses the service role key (full read/write, bypasses RLS). Scripts load credentials from `.env.local` via dotenv. The best approach is to create a dedicated read-only PostgreSQL role in the prod Supabase database and build a CLI script that connects via direct PostgreSQL connection with that role. This gives database-level enforcement (not just app-level), uses a completely separate credential from the service role key, and is simple to implement.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/environments.md — Environment matrix, database project IDs (Dev: `ifubinffdbyewoezcidz`, Prod: `qbxhivoezkfbjbsctdzo`), secrets management
- docs/docs_overall/testing_overview.md — Test data patterns, cleanup scripts, CI/CD workflows

### External Docs
- https://supabase.com/docs/guides/database/postgres/roles — Supabase role management, built-in `supabase_read_only_user` role
- https://supabase.com/docs/guides/database/connecting-to-postgres — Connection string formats (direct, pooler session, pooler transaction)

## Code Files Read

### Supabase Client Setup
- `src/lib/utils/supabase/server.ts` — Two client factories: `createSupabaseServerClient()` (anon key + cookies) and `createSupabaseServiceClient()` (service role key, bypasses RLS)
- `src/lib/utils/supabase/client.ts` — Browser client using anon key
- `src/lib/supabase.ts` — Legacy client (anon key + auth listener)

### Scripts That Access Database
- `scripts/cleanup-test-content.ts` — Service role, `--prod` flag with 10s safety delay, reads `.env.local`
- `scripts/cleanup-specific-junk.ts` — Same pattern as above, 15s delay
- `scripts/query-elo-baselines.ts` — Service role, reads `.env.local`, SELECT-only queries but no enforcement
- `scripts/add-admin.ts` — Service role, upsert to `admin_users`
- `scripts/seed-admin-test-user.ts` — Service role, creates auth user + admin entry

### Environment Config
- `.env.example` — Template with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `.gitignore` — All `.env*` files ignored except `.env.example`

### CI/CD
- `.github/workflows/post-deploy-smoke.yml` — Uses prod secrets from GitHub "Production" environment for smoke tests

## Key Findings

1. **No existing read-only pattern**: All database access uses either anon key (with RLS) or service role key (bypasses RLS, full read/write). There's no intermediate "read-only" access level.

2. **Scripts all use service role key**: Every script in `scripts/` loads `.env.local` and uses `SUPABASE_SERVICE_ROLE_KEY`. Even query-only scripts like `query-elo-baselines.ts` have full write access.

3. **Prod key exposure risk**: If you put prod credentials in `.env.local` to run a query script, those credentials are sitting in a file alongside dev credentials. Easy to accidentally use the wrong ones.

4. **Supabase supports custom PostgreSQL roles**: You can create a role with only `SELECT` privileges via SQL Editor. Supabase also has a built-in `supabase_read_only_user` role.

5. **Connection options**: Direct PostgreSQL connection (`postgresql://...@db.<ref>.supabase.co:5432/postgres`) or pooler connection. Custom roles can be specified in the connection string username.

6. **Database-level enforcement is the gold standard**: A PostgreSQL role with only `GRANT SELECT` cannot perform INSERT/UPDATE/DELETE regardless of what the application code tries. This is safer than app-level restrictions.

## Options Considered

### Option A: PostgreSQL read-only role + CLI script
- Create `readonly_local` role in prod Supabase with SELECT-only on public schema
- Build `scripts/query-prod.ts` that connects via `pg` library (direct PostgreSQL)
- Store connection string in `.env.prod.readonly` (gitignored, separate from `.env.local`)
- **Pro**: DB-level enforcement, separate credential, familiar SQL interface
- **Con**: Requires `pg` dependency, direct PostgreSQL connection (needs pooler for IPv4)

### Option B: Supabase JS client with runtime key + app-level restriction
- Script accepts service role key via env var at runtime (never stored in file)
- Wrapper only exposes `.select()` operations
- **Pro**: Uses existing Supabase JS patterns, no new dependencies
- **Con**: App-level restriction only (code could be changed), key still "exposed" in memory, violates requirement B (still uses service role key)

### Option C: Just use Supabase Dashboard SQL Editor
- No code needed, dashboard already supports arbitrary SQL
- **Pro**: Zero implementation effort, already available
- **Con**: No scriptability, no integration with codebase, can't save/share queries

### Option D: Supabase anon key + RLS
- Use prod anon key to query (subject to RLS policies)
- **Pro**: Already restricted by design
- **Con**: Can't see data behind RLS policies (most tables), useless for debugging, still exposes prod anon key

## Recommendation

**Option A** is the strongest choice. It satisfies both requirements at the database level:
- A) Read-only enforced by PostgreSQL — cannot write even if you try
- B) Uses a completely different credential (a custom role password) — the prod service role key and anon key are never needed

The implementation is straightforward:
1. One-time SQL setup in prod Supabase Dashboard (create role, grant SELECT)
2. One script file (`scripts/query-prod.ts`)
3. One env file template (`.env.prod.readonly.example`)

## Open Questions

1. Should we use direct PostgreSQL connection or the Supabase pooler? (Pooler is needed if IPv4 only)
2. Should the script support arbitrary SQL or only predefined table queries via Supabase JS?
3. Should we add this as an npm script (e.g., `npm run query:prod`)?
4. Do we need to grant SELECT on specific tables only, or all tables in public schema?
