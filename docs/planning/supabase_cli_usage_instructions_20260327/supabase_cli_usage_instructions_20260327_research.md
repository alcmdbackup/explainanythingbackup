# Supabase CLI Usage Instructions Research

## Problem Statement
We need clear instructions on how to use the Supabase CLI to debug production and staging environment issues. Currently, Supabase CLI commands are scattered across workflow files, planning docs, and environments.md without a centralized debugging reference.

## Requirements (from GH Issue #866)
Locate existing instructions if any, add clear instructions in all relevant places and verify that methods work for both staging and production.

Additional plan requirements from user:
- Always suggest the right systematic fix instead of fixing the issue one-off
- Ask user if we should refactor and simplify code if too complex

## High Level Summary

The Supabase CLI (v2.84.4) is available via `npx supabase` and provides powerful debugging tools for both staging and production. However, instructions are fragmented:

1. **environments.md** has 3 manual deployment commands but no debugging/inspection commands
2. **debugging.md** has MCP-based Supabase log access but no CLI commands
3. **supabase-migrations.yml** workflow has comprehensive CLI usage but it's CI-only
4. **query-prod.ts** provides read-only SQL access but only via custom script, not CLI

Key gaps:
- No instructions for `supabase inspect db` commands (bloat, blocking, long-running queries, table-stats, etc.)
- No instructions for `supabase db query` against linked projects
- No instructions for `supabase db dump` for schema/data inspection
- No instructions for `supabase login` and project linking for local debugging
- The debug skill references Supabase MCP but not CLI commands

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/environments.md — Has project IDs (Dev: ifubinffdbyewoezcidz, Prod: qbxhivoezkfbjbsctdzo), manual migration commands, read-only prod access
- docs/feature_deep_dives/authentication_rls.md — Auth flow, RLS policies, Supabase client usage
- docs/docs_overall/testing_overview.md — CI workflows using Supabase CLI, migration deployment
- docs/docs_overall/debugging.md — MCP-based Supabase logs, query:prod script, no CLI inspect commands

## Code Files Read
- `.env.prod.readonly.example` — Template for read-only production DB connection string format: `postgresql://readonly_local:<password>@db.<project-ref>.supabase.co:5432/postgres`
- `scripts/query-prod.ts` — Custom read-only SQL REPL using pg client, supports interactive mode and single queries
- `.github/workflows/supabase-migrations.yml` — CI workflow with `supabase link`, `migration list`, `migration repair`, `db push --include-all`
- `supabase/config.toml` — Local dev config (project: explainanything-feature0, ports 54321-54323)
- `.claude/skills/debug/SKILL.md` — Debug skill with Phase 1-4 methodology, references Supabase MCP but not CLI

## Key Findings

### 1. Supabase CLI Debugging Commands Available (Not Documented)

The `supabase inspect db` suite is particularly valuable for debugging:

| Command | Purpose |
|---------|---------|
| `supabase inspect db long-running-queries` | Show queries running > 5 minutes |
| `supabase inspect db blocking` | Show queries holding locks + waiting queries |
| `supabase inspect db locks` | Show exclusive locks on relations |
| `supabase inspect db outliers` | Queries ordered by total execution time |
| `supabase inspect db calls` | Queries ordered by total times called |
| `supabase inspect db bloat` | Dead tuple space estimation |
| `supabase inspect db table-stats` | Combined table size, index size, row count |
| `supabase inspect db index-stats` | Index usage and unused indices |
| `supabase inspect db db-stats` | Cache hit rates, total sizes, WAL size |
| `supabase inspect db vacuum-stats` | Vacuum operations per table |
| `supabase inspect db role-stats` | Role information |
| `supabase inspect db replication-slots` | Replication slot info |
| `supabase inspect db traffic-profile` | Read/write activity ratio |

All accept `--linked` (default) or `--db-url` flags to target specific databases.

### 2. Direct SQL Querying via CLI

`supabase db query` can execute SQL against linked projects:
```bash
supabase db query "SELECT count(*) FROM explanations" --linked
```
Output formats: `--output json|table|csv`

### 3. Schema Inspection

`supabase db dump` can dump schemas for inspection:
```bash
supabase db dump --linked -f schema.sql       # Full schema
supabase db dump --linked --data-only          # Data only
supabase db dump --linked -s public            # Specific schema
```

### 4. Safety Analysis: Prod Access Methods

| Method | Tool | Safety | Scope | Prod-Safe? |
|--------|------|--------|-------|------------|
| `npm run query:prod` | Custom script (pg) | **DB-enforced** read-only role | SELECT only | **YES** |
| `supabase inspect db *` | CLI | Read-only (pg_stat views) | Introspection only | **YES** |
| `supabase db advisors` | CLI | Read-only (security/perf checks) | Analysis only | **YES** |
| `supabase db query --linked` | CLI | **NO read-only guard** — executes arbitrary SQL via Management API | All operations incl. writes | **DANGEROUS** |
| `supabase db dump --linked` | CLI | Read-only (pg_dump) | Schema/data export | **YES** |
| Supabase Dashboard | Web UI | Depends on user role | Full | Varies |

**Critical finding:** `supabase db query --linked` has no `--readonly` flag. When linked to production, it can execute INSERT/UPDATE/DELETE/DROP. Documentation must clearly warn about this and recommend `npm run query:prod` for ad-hoc production queries instead.

### 5. Project IDs for Linking

| Environment | Project ID | Dashboard |
|-------------|------------|-----------|
| Staging (Dev) | `ifubinffdbyewoezcidz` | https://supabase.com/dashboard/project/ifubinffdbyewoezcidz |
| Production | `qbxhivoezkfbjbsctdzo` | https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo |

### 6. Authentication Requirements

CLI requires `SUPABASE_ACCESS_TOKEN` (personal access token from Supabase dashboard) for `--linked` operations. Alternative: `supabase login` for interactive auth or `--db-url` with direct connection string.

### 7. Debug Skill Enhancement Opportunities

The debug skill (`SKILL.md`) should be enhanced with:
- Supabase CLI commands for database debugging (inspect db commands)
- Systematic fix philosophy: always suggest the right systematic fix, not one-off patches
- Refactoring prompt: ask user if code is too complex and should be refactored/simplified

### 8. Existing Safety Hooks (Gaps Found)

**Already protected (`.claude/hooks/block-supabase-writes.sh`):**
- Blocks: `supabase db push`, `db reset`, `migration up`, `migration repair`, `psql -c/-f`
- Allows: `supabase migration list`, `db pull`, `db diff`, `db lint`, `psql SELECT`

**Already protected (`settings.json` deny rules):**
- `supabase link --project-ref qbxhivoezkfbjbsctdzo` (prod project ID) — blocked
- `mcp__supabase__execute_sql` — blocked
- `mcp__supabase__apply_migration` — blocked

**GAPS — not protected:**
- `supabase db query` — NOT in blocked patterns, can execute arbitrary SQL
- `supabase db query --db-url <prod-url>` — bypasses link check entirely
- No detection of `supabase db query` with write SQL (INSERT/UPDATE/DELETE/DROP)

### 9. Protection Options

**Option A: Extend hook to block `supabase db query` with prod detection**
- Allow `supabase db query --local` and `supabase db query` (defaults to local)
- Block `supabase db query --linked` and `supabase db query --db-url`
- Pro: Granular. Con: Still allows writes to staging via `--linked` after linking to staging.

**Option B: Block `supabase db query` entirely, redirect to `npm run query:prod`**
- Add `supabase db query` to BLOCKED_PATTERNS
- Pro: Simple, foolproof. Con: Blocks legitimate local/staging queries too.

**Option C: Belt-and-suspenders (RECOMMENDED)**
- Block `supabase db query --linked` in the hook (not `--local`)
- Block `supabase db query --db-url` in the hook
- Keep existing `supabase link --project-ref qbxhivoezkfbjbsctdzo` deny in settings.json
- Add `supabase db query` with write SQL patterns (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE) to blocked patterns regardless of target
- Allow `supabase db query` (defaults to `--local`) for local dev
- Redirect message: "For production queries, use `npm run query:prod` (read-only enforced)"

## Open Questions

1. Should we verify CLI commands work against both staging and production? (Yes — per requirements)
2. Should `supabase inspect db` commands be added to the `/debug` skill's sub-commands?
3. How to handle `SUPABASE_ACCESS_TOKEN` — document where to get it or rely on `supabase login`?
4. Which protection option for `supabase db query`? (Recommending Option C)
