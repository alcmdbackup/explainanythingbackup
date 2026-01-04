# RLS Evaluation Production - Progress

## Phase 1: Project Setup ✅
- Created project folder at `docs/planning/RLS_evaluation_prod_20260104/`
- Created research, planning, and progress documents
- Documented verification SQL queries
- Created GitHub issue: https://github.com/Minddojo/explainanything/issues/147
- Linked to staging work (issue #141)

## Phase 2: Verification ✅

### Status
- [x] Access production Supabase dashboard
- [x] Run verification queries
- [x] Document results in research file
- [x] Compare against expected state

### Results
See `RLS_evaluation_prod_research.md` for full query results.

## Phase 3: Analysis ✅

### Findings
**Phase 1A migration was NOT applied to production.**

Production has the OLD (insecure) policies:
- `userExplanationEvents` still has public read access
- All three tables have permissive INSERT policies with `with_check=true`

### Discrepancies (4 issues found)

| # | Table | Issue |
|---|-------|-------|
| 1 | userExplanationEvents | Public SELECT still exists (`qual=true` for `public`) |
| 2 | userExplanationEvents | Duplicate INSERT policies (permissive `true`) |
| 3 | userLibrary | Permissive INSERT (`with_check=true`) |
| 4 | userQueries | Duplicate INSERT policies (permissive `true`) |

### Action Required
**REMEDIATION NEEDED** - Apply the SQL in `RLS_evaluation_prod_planning.md`

## Phase 4: Remediation ✅

### Migrations Applied via CLI
- [x] Linked Supabase CLI to production (`supabase link --project-ref qbxhivoezkfbjbsctdzo`)
- [x] Checked migration status (`supabase migration list`) - 5 migrations pending
- [x] Applied all pending migrations (`supabase db push`)

### Migrations Applied
1. `20251222000000_create_source_tables.sql`
2. `20251222215629_add_source_column.sql`
3. `20251231000000_seed_tags_data.sql`
4. `20251231204904_add_summary_fields.sql`
5. `20260104062824_fix_user_table_rls.sql` ← **RLS fix**

### Post-Migration Verification
- [x] userExplanationEvents SELECT: ✅ Fixed (user-isolated, no public read)
- [x] userLibrary INSERT: ✅ Fixed (auth.uid() = userid)
- [x] userQueries INSERT: ✅ Fixed (single user-isolated policy)
- [x] userExplanationEvents INSERT: ✅ Fixed (removed residual permissive policy manually)

## Summary

| Table | Policy | Status |
|-------|--------|--------|
| userExplanationEvents | SELECT: auth.uid() = userid | ✅ Fixed |
| userExplanationEvents | INSERT: auth.uid() = userid | ✅ Fixed |
| userLibrary | SELECT: auth.uid() = userid | ✅ Already correct |
| userLibrary | INSERT: auth.uid() = userid | ✅ Fixed |
| userQueries | SELECT: auth.uid() = userid | ✅ Already correct |
| userQueries | INSERT: auth.uid() = userid | ✅ Fixed |

## Phase 5: GitHub Integration ✅

### Workflow Created
- Created `.github/workflows/supabase-migrations.yml`
- Auto-deploys migrations: Staging → Production
- Triggers on push to `main` with changes in `supabase/migrations/**`

### Secrets Added to GitHub
| Environment | Secret |
|-------------|--------|
| Development | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` |
| Production | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` |

### Claude Code Safety Guardrail
Added deny rules to `~/.claude/settings.json` to block production migrations without explicit approval:
- `supabase link --project-ref qbxhivoezkfbjbsctdzo`
- `supabase db push`
- `mcp__supabase__apply_migration`
- `mcp__supabase__execute_sql`

## Phase 6: Documentation ✅

Updated:
- `docs/docs_overall/environments.md` - Added database migrations section
- `docs/docs_overall/testing_overview.md` - Added Supabase migrations workflow

## Project Complete ✅

All objectives achieved:
1. ✅ Verified production RLS policies (found Phase 1A not applied)
2. ✅ Applied 5 pending migrations to production via CLI
3. ✅ Fixed residual permissive INSERT policy manually
4. ✅ Set up automated migration deployment via GitHub Actions
5. ✅ Added Claude Code safety guardrails for production
6. ✅ Updated documentation

## Related
- Staging evaluation: `docs/planning/RLS_evaluation_20260103/`
- GitHub Issues: #141 (staging), #147 (production)
- Migration workflow: `.github/workflows/supabase-migrations.yml`
- Migration: `supabase/migrations/20260104062824_fix_user_table_rls.sql`
