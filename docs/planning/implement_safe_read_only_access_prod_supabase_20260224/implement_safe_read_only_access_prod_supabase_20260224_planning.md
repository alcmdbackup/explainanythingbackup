# Implement Safe Read-Only Access to Prod Supabase Plan

## Background
We need a safe way to query the production Supabase database for debugging, analytics, and data inspection. The solution must not grant write access and must not expose the production Supabase service role key or anon key in local environments or code.

## Requirements (from GH Issue #552)
- A) No write access — queries must be strictly read-only
- B) No exposure of prod Supabase keys — the prod service role key and anon key must not appear in .env files, code, or logs

## Problem
Today, querying prod data requires putting the prod service role key in `.env.local` and running a script that has full write access. This is dangerous — a typo or wrong script could mutate prod data, and the prod key sits in a file alongside dev credentials where it could be accidentally used by the app. There is no intermediate read-only access level in the codebase. We need database-level enforcement of read-only access with a separate credential that is not the service role or anon key.

## Options Considered

1. **PostgreSQL read-only role + CLI script (chosen)** — Create a `readonly_local` role in prod with SELECT-only, connect via `pg` library, store connection string in `.env.prod.readonly`. DB-level enforcement, separate credential.
2. **Supabase JS client with app-level restriction** — Still uses service role key (violates req B), only app-level enforcement.
3. **Supabase Dashboard SQL Editor** — Zero code but no scriptability, can't save/share queries in repo.
4. **Supabase anon key + RLS** — Can't see data behind RLS policies, useless for debugging.

## Phased Execution Plan

### Phase 1: Database Setup (manual, one-time)
Create the read-only role in prod Supabase via Dashboard SQL Editor:

```sql
-- Create role with login, no superuser, no createdb, no createrole
CREATE ROLE readonly_local WITH LOGIN PASSWORD '<generated-password>';

-- Grant connect and usage, revoke create to prevent DDL
GRANT CONNECT ON DATABASE postgres TO readonly_local;
GRANT USAGE ON SCHEMA public TO readonly_local;
REVOKE CREATE ON SCHEMA public FROM readonly_local;

-- Grant SELECT on all existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_local;

-- Grant SELECT on future tables created by postgres role (used by Supabase migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO readonly_local;

-- Defense-in-depth: enforce read-only at the session level
ALTER ROLE readonly_local SET default_transaction_read_only = on;

-- Safety: set a 30-second query timeout to prevent runaway queries on prod
ALTER ROLE readonly_local SET statement_timeout = '30s';

-- Revoke EXECUTE on all functions to prevent calling SECURITY DEFINER write functions
-- (e.g., increment_explanation_views, apply_evolution_winner, etc. run as the function
-- owner and can bypass read-only restrictions)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM readonly_local;

-- Re-grant EXECUTE on read-only functions only (full signatures to handle overloads)
GRANT EXECUTE ON FUNCTION get_source_citation_counts(TEXT, INT) TO readonly_local;
GRANT EXECUTE ON FUNCTION get_co_cited_sources(INT, INT) TO readonly_local;
GRANT EXECUTE ON FUNCTION get_explanation_view_counts(TEXT, INT) TO readonly_local;
```

Rollback (if needed):
```sql
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM readonly_local;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM readonly_local;
REVOKE USAGE ON SCHEMA public FROM readonly_local;
REVOKE CONNECT ON DATABASE postgres FROM readonly_local;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM readonly_local;
DROP ROLE readonly_local;
```

Deliverable: Role exists in prod, connection string works with `psql`.

### Phase 2: Dependencies
Add `pg` and `@types/pg` as devDependencies:

```bash
npm install --save-dev pg @types/pg
```

These are only needed for this script — no other code in the project uses `pg`.

Note: `tsx` is used via `npx tsx` (not as a declared dependency), matching the existing project convention used by all other scripts (`cleanup-test-content.ts`, `query-elo-baselines.ts`, etc.) and the `test:esm` npm script.

### Phase 3: CLI Script
Create `scripts/query-prod.ts`:

```typescript
#!/usr/bin/env npx tsx
// Safe read-only query tool for production Supabase database.
// Uses a dedicated read-only PostgreSQL role — cannot write even if you try.

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

dotenv.config({ path: path.resolve(process.cwd(), '.env.prod.readonly') });

const connectionString = process.env.PROD_READONLY_DATABASE_URL;
if (!connectionString) {
  console.error('Missing PROD_READONLY_DATABASE_URL in .env.prod.readonly');
  console.error('See .env.prod.readonly.example for setup instructions.');
  process.exit(1);
}

// SSL is required for Supabase direct connections.
// Supabase uses valid Let's Encrypt certs, so full verification works.
const client = new Client({
  connectionString,
  ssl: true,
});

// Graceful cleanup on exit
process.on('SIGINT', async () => {
  await client.end();
  process.exit(0);
});
```

Features:
- Interactive REPL mode (default): type SQL, get formatted table output
- Single-query mode: `npx tsx scripts/query-prod.ts "SELECT count(*) FROM explanations"`
- JSON output mode: `--json` flag for piping
- Connection validation on startup (runs `SELECT 1` and prints connected message)
- Graceful exit on Ctrl+C with `client.end()` cleanup
- Connection errors are caught and printed without leaking the connection string/password

### Phase 4: Environment Template
Create `.env.prod.readonly.example`:

```bash
# Read-only connection to production Supabase PostgreSQL
# This uses a dedicated readonly_local role with SELECT-only privileges.
# The role CANNOT perform INSERT, UPDATE, DELETE, or DDL operations.
#
# Get the connection string from the Supabase Dashboard:
#   Project Settings > Database > Connection string > URI
#   Replace the username with 'readonly_local' and use the role's password.
#
# Format: postgresql://readonly_local:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
PROD_READONLY_DATABASE_URL=
```

Update `.gitignore`: The existing `.env*` glob already ignores `.env.prod.readonly`. Add `!.env.prod.readonly.example` exception (same pattern as existing `!.env.example`) so the template is committed.

### Phase 5: npm script + docs
- Add `"query:prod": "npx tsx scripts/query-prod.ts"` to package.json scripts (using `npx tsx` to match existing convention, e.g. `test:esm`)
- Update `docs/docs_overall/environments.md` with a "Read-Only Prod Access" section

## Files Modified

| File | Change |
|------|--------|
| `scripts/query-prod.ts` | **New** — CLI script |
| `scripts/query-prod.test.ts` | **New** — Unit test |
| `.env.prod.readonly.example` | **New** — Template |
| `.gitignore` | Add `!.env.prod.readonly.example` exception |
| `package.json` | Add `pg`, `@types/pg` devDeps + `query:prod` script |
| `docs/docs_overall/environments.md` | Add read-only prod access section |

## Testing

- **Manual verification**: Run `npm run query:prod`, execute `SELECT count(*) FROM explanations`, verify results
- **Manual verification**: Attempt `INSERT INTO explanations ...` — verify it fails with permission denied
- **Manual verification**: Attempt `DELETE FROM explanations ...` — verify it fails with permission denied
- **Unit test**: `scripts/query-prod.test.ts` — test argument parsing, output formatting, error handling. Must mock `pg.Client` via `jest.mock('pg')` and mock `dotenv` so the test runs in CI without `PROD_READONLY_DATABASE_URL` or any network connection.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/environments.md` - Add "Read-Only Prod Access" section with setup instructions and connection details
