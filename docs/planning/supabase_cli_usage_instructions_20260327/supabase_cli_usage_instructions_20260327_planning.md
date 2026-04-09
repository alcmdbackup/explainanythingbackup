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
| `supabase db query --linked "INSERT/DELETE/DROP ..."` | Hook blocks write SQL on remote targets (local writes unrestricted) |
| `supabase link --project-ref <prod-id>` | Already denied in settings.json |
| `supabase db push` | Already blocked by existing hook |

## Phased Execution Plan

### Phase 1: Safety Hook + Read-Only Staging Access
- [x] Update `.claude/hooks/block-supabase-writes.sh` — add `supabase db query --linked` and `supabase db query --db-url` to BLOCKED_PATTERNS
- [x] Add write-SQL detection patterns (case-insensitive: INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE) ONLY when `--linked` or `--db-url` is also present — local queries are unrestricted
  - Note: hook regex is defense-in-depth only; the DB `readonly_local` role is the authoritative enforcement layer
  - Known limitation: regex cannot catch all SQL injection vectors (CTEs, functions with side effects) — this is acceptable because the DB role blocks writes regardless
- [x] Add `supabase db query --local` and `supabase db query` (no flags) to ALLOWED_PATTERNS
  - Verified: `supabase db query` defaults to `--local` per CLI help output ("Queries the local database. (default true)")
- [ ] Create `readonly_local` role on staging Supabase DB with SELECT-only privileges (MANUAL OPS — post-merge):
  ```sql
  CREATE ROLE readonly_local WITH LOGIN PASSWORD '<password>';  -- generate via: openssl rand -base64 32
  GRANT USAGE ON SCHEMA public TO readonly_local;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_local;
  GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO readonly_local;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_local;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO readonly_local;
  ```
  - Execute manually via Supabase Dashboard SQL editor (one-time ops step, not a migration)
  - Store password securely (not in any committed file)
- [x] Create `.env.staging.readonly.example` template (same format as `.env.prod.readonly.example`)
- [ ] Create `.env.staging.readonly` with actual staging connection string (MANUAL OPS — post-merge)
- [x] Add `.env.staging.readonly` to `.gitignore` if not already covered by `.env*` glob
- [x] Add `!.env.staging.readonly.example` to `.gitignore` (alongside existing `!.env.prod.readonly.example`) so the template is committed
- [x] Rename `scripts/query-prod.ts` → `scripts/query-db.ts`, add `--prod`/`--staging` flag to select env file:
  - `--prod` → loads `.env.prod.readonly`, env var `PROD_READONLY_DATABASE_URL`, prompt `prod> `, connect msg "Connected to production (read-only)"
  - `--staging` → loads `.env.staging.readonly`, env var `STAGING_READONLY_DATABASE_URL`, prompt `staging> `, connect msg "Connected to staging (read-only)"
  - No flag → error with usage: "Usage: query-db.ts --prod|--staging [--json] [query]"
  - Note: backward compat is maintained because `npm run query:prod` always passes `--prod` via package.json
- [x] Update `package.json` scripts:
  - `"query:prod": "npx tsx scripts/query-db.ts --prod"`
  - `"query:staging": "npx tsx scripts/query-db.ts --staging"`
- [x] Add comment in `query-db.ts` documenting why `ssl: { rejectUnauthorized: false }` is required (Supabase pooler uses internal CA not in Node's trust store; direct connections via `db.*.supabase.co` work with `ssl: true`)
- [x] Grep for all references to `query-prod` across the codebase and update them:
  - `docs/docs_overall/debugging.md` (references `npm run query:prod`)
  - `docs/docs_overall/environments.md` (references `npm run query:prod`)
  - `evolution/docs/data_model.md` and `evolution/docs/reference.md` (if they contain user-facing instructions)
  - Any other docs found via `grep -r "query.prod" --include="*.md" --include="*.ts" --include="*.json"`
  - Note: historical planning docs under `docs/planning/` are left as-is (they are point-in-time records)
- [x] Rename `scripts/query-prod.test.ts` → `scripts/query-db.test.ts`, update imports, add tests for:
  - Preserve all existing tests (parseArgs, formatAsTable, formatAsJson, error safety — 10 tests)
  - `--staging`/`--prod` flag parsing and env file selection
  - No flag → error with usage message
  - Env var name selection (`PROD_READONLY_DATABASE_URL` vs `STAGING_READONLY_DATABASE_URL`)
  - REPL prompt text parameterization
  - Note: `dotenv.config()` call must be moved inside `main()` after flag parsing, not at module top-level
- [x] Add automated hook tests in `scripts/test-supabase-hook.sh`:
  - Test: `supabase db query --linked "SELECT 1"` → blocked
  - Test: `supabase db query --db-url "pg://..." "SELECT 1"` → blocked
  - Test: `supabase db query "SELECT 1"` → allowed (defaults to local)
  - Test: `supabase db query --local "DROP TABLE foo"` → allowed (local)
  - Test: `supabase db query --linked "INSERT INTO foo"` → blocked (write SQL + linked)
  - Test: `supabase inspect db table-stats --linked` → allowed
  - Test: `supabase migration list` → allowed
  - Test: `supabase db push` → blocked (existing)
  - Approach: set TOOL_INPUT env var, run hook as subprocess (`TOOL_INPUT="..." bash .claude/hooks/block-supabase-writes.sh`), check exit code and stdout for permissionDecision
  - Note: do NOT source the hook — it uses `exit 0` which would terminate the test shell
- [ ] Test `npm run query:staging "SELECT count(*) FROM explanations"` works (MANUAL OPS — post-merge)
- [ ] Test `npm run query:staging "DELETE FROM explanations"` is rejected by DB role (MANUAL OPS — post-merge)

**CI & Rollback:**
- [x] No CI workflow changes needed — `query:staging` is a local dev tool, not used in CI pipelines. If staging credentials are needed in CI later, add `STAGING_READONLY_DATABASE_URL` to GitHub Staging environment secrets.
- [x] Rollback plan: if hook causes false positives, revert `block-supabase-writes.sh` to previous version via `git checkout origin/main -- .claude/hooks/block-supabase-writes.sh`

### Phase 2: Documentation Updates
- [x] Update `docs/docs_overall/debugging.md` — add "Supabase CLI Debugging" section with:
  - CLI setup (`npx supabase`, `supabase login`, `supabase link`)
  - Safety matrix (what's safe vs. dangerous for prod)
  - **Ad-hoc SQL queries** — full usage reference for `npm run query:staging` and `npm run query:prod`:
    - Single query: `npm run query:staging -- "SELECT count(*) FROM explanations"`
    - Interactive REPL: `npm run query:staging` (shows `staging> ` prompt)
    - JSON output: `npm run query:staging -- --json "SELECT id, title FROM explanations LIMIT 5"`
    - Common debugging queries (recent explanations, evolution runs, user activity, test content)
    - Safety: both use DB-enforced read-only role — writes are impossible even if you try
  - `supabase inspect db` command reference with examples
  - `supabase db advisors` for security/performance checks
  - `supabase db dump` for schema inspection
- [x] Update `docs/docs_overall/environments.md` — add Supabase CLI setup section:
  - How to install/access (`npx supabase`)
  - How to link to staging (`supabase link --project-ref ifubinffdbyewoezcidz`)
  - Safety warning about prod linking being blocked
  - Add `npm run query:staging` alongside existing `npm run query:prod` in the "Read-Only Production Access" section (or rename section to "Read-Only Database Access")
  - Reference to debugging.md for full CLI debugging commands
- [x] Update `docs/docs_overall/testing_overview.md` — add "Database Debugging During Tests" section:
  - `npm run query:staging` for inspecting staging DB state during/after test runs
  - `supabase migration list` to check migration status before running integration tests
  - `supabase db diff` to compare local vs remote schema
  - `supabase inspect db table-stats --linked` to check table sizes after test pollution
  - Cross-reference to debugging.md for full CLI reference
- [x] Update `docs/feature_deep_dives/testing_setup.md` — add "Supabase CLI for Test Infrastructure" section:
  - `npm run query:staging` / `npm run query:prod` for inspecting test data in staging/prod
  - `supabase inspect db long-running-queries --linked` for debugging slow integration tests
  - `supabase inspect db locks --linked` for debugging test deadlocks
  - `supabase db advisors --linked` for checking RLS/index issues that affect test behavior
  - Safety note: all queries are read-only (DB-enforced role)
  - Cross-reference to debugging.md for full CLI reference

### Phase 3: Debug Skill Enhancement
- [x] Update `.claude/skills/debug/SKILL.md` — add Supabase CLI section under "Project-Specific Debugging Tools":
  - **Ad-hoc SQL queries** for staging/prod debugging:
    - `npm run query:staging -- "SELECT ..."` for staging
    - `npm run query:prod -- "SELECT ..."` for production
    - Interactive REPL mode, JSON output mode
    - Common debugging queries (recent errors, stuck runs, data state)
    - Safety note: both are DB-enforced read-only
  - `supabase inspect db long-running-queries --linked` for slow query debugging
  - `supabase inspect db blocking --linked` for lock debugging
  - `supabase inspect db outliers --linked` for query performance
  - `supabase inspect db table-stats --linked` for storage analysis
  - `supabase db advisors --linked` for security/performance audit
- [x] Add systematic fix principle to debug skill: "Always suggest the right systematic fix instead of one-off patches"
- [x] Add refactoring prompt to debug skill: "When code is too complex, ask user if we should refactor and simplify"

## Testing

### Unit Tests
- [x] `scripts/query-db.test.ts` — test `--prod`/`--staging` flag parsing, env file selection, error on missing flag, prompt/message parameterization
- [x] `scripts/test-supabase-hook.sh` — automated tests for hook blocking/allowing patterns (8+ test cases)

### Integration Tests
- [x] N/A

### E2E Tests
- [x] N/A

### Manual Verification
- [x] Verify `npm run query:prod` still works for production SELECT queries
- [ ] Verify `npm run query:staging "SELECT count(*) FROM explanations"` returns results (MANUAL OPS — post-merge)
- [ ] Verify `npm run query:staging "DELETE FROM explanations LIMIT 1"` is rejected by DB role (MANUAL OPS — post-merge)
- [x] Verify staging REPL shows `staging> ` prompt and prod shows `prod> `

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [x] `npm test -- scripts/query-db.test.ts` — unit tests for query-db flag parsing
- [x] `bash scripts/test-supabase-hook.sh` — automated hook blocking/allowing tests
- [x] `bash scripts/test-migration-tools.sh` — existing migration hook tests still pass

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/environments.md` — add Supabase CLI setup, linking, and safety warnings
- [x] `docs/docs_overall/debugging.md` — add Supabase CLI debugging section (inspect db commands, safety matrix)
- [x] `docs/docs_overall/testing_overview.md` — add "Database Debugging During Tests" section with query:staging, inspect db, migration list
- [x] `docs/feature_deep_dives/testing_setup.md` — add "Supabase CLI for Test Infrastructure" section with query scripts, inspect commands, safety note
- [x] `.claude/skills/debug/SKILL.md` — add Supabase CLI commands, systematic fix philosophy, refactoring prompts

## Review & Discussion

### Iteration 1 — Score: 3/3/3
**Critical gaps (7):** Contradictory flag behavior, write-SQL blocking local dev, .gitignore missing staging example, SSL undocumented, no automated hook tests, no CI rename impact analysis, no staging CI credentials plan.
**Action:** Fixed all 7 gaps in plan.

### Iteration 2 — Score: 4/4/4
**Critical gaps: 0.** Minor issues: hook test sourcing vs subprocess, dotenv.config() placement, evolution docs in grep pass, existing tests preservation, GRANT SELECT ON SEQUENCES.
**Action:** Fixed all notable minor issues.

### Iteration 3 — Score: 5/5/5
✅ **Consensus reached.** All reviewers confirmed plan is ready for execution.
