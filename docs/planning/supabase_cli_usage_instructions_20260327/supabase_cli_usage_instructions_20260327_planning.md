# Supabase CLI Usage Instructions Plan

## Background
Supabase CLI (v2.84.4, available via `npx supabase`) provides powerful debugging and inspection tools, but instructions are scattered across workflow files, planning docs, and environments.md. There's no centralized reference for using the CLI to debug staging/production issues. Additionally, `supabase db query` has no read-only guard and can execute arbitrary writes — a safety gap since the existing hook doesn't block it.

## Requirements (from GH Issue #866)
Locate existing instructions if any, add clear instructions in all relevant places and verify that methods work for both staging and production.

Additional requirements:
- Always suggest the right systematic fix instead of fixing the issue one-off
- Ask user if we should refactor and simplify code if too complex

## Problem
The Supabase CLI has 13+ `inspect db` commands for database debugging (long-running queries, locks, bloat, table stats, etc.) that are undocumented in our project. The existing `block-supabase-writes.sh` hook blocks `db push`, `db reset`, and `migration` writes but misses `supabase db query`, which can execute arbitrary SQL (including writes) against any linked project. The debug skill references Supabase MCP but not CLI commands. Production debugging instructions are incomplete.

## Options Considered
- [ ] **Option A: Extend hook with prod detection only**: Block `supabase db query` only when targeting prod. Pro: Granular. Con: Still allows staging writes, hard to detect prod targeting reliably.
- [ ] **Option B: Block all `supabase db query`**: Simple total block. Pro: Foolproof. Con: Blocks legitimate local dev queries.
- [x] **Option C: Belt-and-suspenders (SELECTED)**: Block `--linked` and `--db-url` queries, allow `--local`/default. Block write SQL patterns regardless of target. Redirect to `npm run query:prod` for production. Keep existing `settings.json` deny rules.

### Option C Safety Matrix

**What you CAN do:**

| Command | Target | Why safe |
|---------|--------|----------|
| `npm run query:prod "SELECT ..."` | Production | DB-enforced read-only role |
| `npm run query:staging "SELECT ..."` | Staging | DB-enforced read-only role (new) |
| `supabase inspect db * --linked` | Staging/Prod | Read-only pg_stat views |
| `supabase db advisors --linked` | Staging/Prod | Read-only analysis |
| `supabase db dump --linked` | Staging/Prod | Read-only pg_dump |
| `supabase db diff --linked` | Staging/Prod | Read-only schema comparison |
| `supabase migration list` | Staging/Prod | Read-only status |
| `supabase db query "..."` | Local | Defaults to `--local`, no risk |
| `supabase db query --local "..."` | Local | Explicit local |

**What you CANNOT do:**

| Command | Why blocked |
|---------|------------|
| `supabase db query --linked "..."` | Hook blocks — use `npm run query:staging` / `query:prod` instead |
| `supabase db query --db-url <url> "..."` | Hook blocks — direct connection bypass |
| `supabase db query "INSERT/DELETE/DROP ..."` | Hook blocks write SQL regardless of target |
| `supabase link --project-ref <prod-id>` | Already denied in settings.json |
| `supabase db push` | Already blocked by existing hook |

## Phased Execution Plan

### Phase 1: Safety Hook + Read-Only Staging Access
- [ ] Update `.claude/hooks/block-supabase-writes.sh` — add `supabase db query --linked` and `supabase db query --db-url` to BLOCKED_PATTERNS
- [ ] Add write-SQL detection patterns (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE) for `supabase db query` commands regardless of target
- [ ] Add `supabase db query --local` and `supabase db query` (no flags) to ALLOWED_PATTERNS
- [ ] Create `readonly_local` role on staging Supabase DB with SELECT-only privileges:
  ```sql
  CREATE ROLE readonly_local WITH LOGIN PASSWORD '<password>';
  GRANT USAGE ON SCHEMA public TO readonly_local;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_local;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_local;
  ```
- [ ] Create `.env.staging.readonly.example` template (same format as `.env.prod.readonly.example`)
- [ ] Create `.env.staging.readonly` with actual staging connection string
- [ ] Add `.env.staging.readonly` to `.gitignore` if not already covered
- [ ] Rename `scripts/query-prod.ts` → `scripts/query-db.ts`, add `--prod`/`--staging` flag to select env file:
  - `--prod` → loads `.env.prod.readonly` (default if no flag, for backward compat)
  - `--staging` → loads `.env.staging.readonly`
  - No flag → error with usage message
- [ ] Update `package.json` scripts:
  - `"query:prod": "npx tsx scripts/query-db.ts --prod"`
  - `"query:staging": "npx tsx scripts/query-db.ts --staging"`
  - Keep old `"query:prod"` working (backward compat via default)
- [ ] Rename `scripts/query-prod.test.ts` → `scripts/query-db.test.ts`, update imports, add tests for `--staging`/`--prod` flag parsing and env file selection
- [ ] Test hook manually: verify blocked commands are denied, allowed commands pass
- [ ] Test `npm run query:staging "SELECT count(*) FROM explanations"` works
- [ ] Test `npm run query:staging "DELETE FROM explanations"` is rejected by DB role

### Phase 2: Documentation Updates
- [ ] Update `docs/docs_overall/debugging.md` — add "Supabase CLI Debugging" section with:
  - CLI setup (`npx supabase`, `supabase login`, `supabase link`)
  - Safety matrix (what's safe vs. dangerous for prod)
  - `supabase inspect db` command reference with examples
  - `supabase db advisors` for security/performance checks
  - `supabase db dump` for schema inspection
  - Clear redirect: "For ad-hoc queries, use `npm run query:staging` or `npm run query:prod` (both read-only enforced)"
- [ ] Update `docs/docs_overall/environments.md` — add Supabase CLI setup section:
  - How to install/access (`npx supabase`)
  - How to link to staging (`supabase link --project-ref ifubinffdbyewoezcidz`)
  - Safety warning about prod linking being blocked
  - Reference to debugging.md for CLI debugging commands
- [ ] Update `docs/docs_overall/testing_overview.md` — add "Database Debugging During Tests" section:
  - `npm run query:staging` for inspecting staging DB state during/after test runs
  - `supabase migration list` to check migration status before running integration tests
  - `supabase db diff` to compare local vs remote schema
  - `supabase inspect db table-stats --linked` to check table sizes after test pollution
  - Cross-reference to debugging.md for full CLI reference
- [ ] Update `docs/feature_deep_dives/testing_setup.md` — add "Supabase CLI for Test Infrastructure" section:
  - `npm run query:staging` / `npm run query:prod` for inspecting test data in staging/prod
  - `supabase inspect db long-running-queries --linked` for debugging slow integration tests
  - `supabase inspect db locks --linked` for debugging test deadlocks
  - `supabase db advisors --linked` for checking RLS/index issues that affect test behavior
  - Safety note: all queries are read-only (DB-enforced role)
  - Cross-reference to debugging.md for full CLI reference

### Phase 3: Debug Skill Enhancement
- [ ] Update `.claude/skills/debug/SKILL.md` — add Supabase CLI section under "Project-Specific Debugging Tools":
  - `supabase inspect db long-running-queries --linked` for slow query debugging
  - `supabase inspect db blocking --linked` for lock debugging
  - `supabase inspect db outliers --linked` for query performance
  - `supabase inspect db table-stats --linked` for storage analysis
  - `supabase db advisors --linked` for security/performance audit
- [ ] Add systematic fix principle to debug skill: "Always suggest the right systematic fix instead of one-off patches"
- [ ] Add refactoring prompt to debug skill: "When code is too complex, ask user if we should refactor and simplify"

## Testing

### Unit Tests
- [ ] `scripts/query-db.test.ts` — test `--prod`/`--staging` flag parsing, env file selection, error on missing flag

### Integration Tests
- [ ] N/A

### E2E Tests
- [ ] N/A

### Manual Verification
- [ ] Verify hook blocks `supabase db query --linked "SELECT 1"` with clear error message
- [ ] Verify hook blocks `supabase db query --db-url "postgresql://..." "SELECT 1"`
- [ ] Verify hook blocks `supabase db query "INSERT INTO test VALUES (1)"`
- [ ] Verify hook allows `supabase db query "SELECT 1"` (defaults to local)
- [ ] Verify hook allows `supabase db query --local "SELECT 1"`
- [ ] Verify hook still allows `supabase inspect db table-stats --linked`
- [ ] Verify hook still allows `supabase migration list`
- [ ] Verify `npm run query:prod` still works for production SELECT queries
- [ ] Verify `npm run query:staging "SELECT count(*) FROM explanations"` returns results
- [ ] Verify `npm run query:staging "DELETE FROM explanations LIMIT 1"` is rejected by DB role

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes

### B) Automated Tests
- [ ] Run existing hook test suite if available: `bash scripts/test-migration-tools.sh`
- [ ] Manual test of hook with blocked/allowed commands (see Manual Verification above)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — add Supabase CLI setup, linking, and safety warnings
- [ ] `docs/docs_overall/debugging.md` — add Supabase CLI debugging section (inspect db commands, safety matrix)
- [ ] `docs/docs_overall/testing_overview.md` — add "Database Debugging During Tests" section with query:staging, inspect db, migration list
- [ ] `docs/feature_deep_dives/testing_setup.md` — add "Supabase CLI for Test Infrastructure" section with query scripts, inspect commands, safety note
- [ ] `.claude/skills/debug/SKILL.md` — add Supabase CLI commands, systematic fix philosophy, refactoring prompts

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
