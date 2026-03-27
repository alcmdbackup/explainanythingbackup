# Systematic Fix Data Wrong Missing Issues Evolution Plan

## Background
Our existing approach to managing data & migrations works poorly. Frequent bugs due to data mismatches between staging vs. code, failed tests, etc. I want a systematic approach to solve this.

## Requirements (from GH Issue #844)
1. Prevent schema drift between SQL and TypeScript
2. Fix active CI blockers (missing views/RPCs, broken test fixtures)
3. Add missing database constraints lost during V2 migration
4. Make test data resilient to schema changes
5. Add CI guardrails to catch schema mismatches before merge
6. Eliminate the migration/test deadlock (tests can't pass because migration hasn't been applied yet)

## Problem
The evolution pipeline has no automated mechanism to keep SQL schema, TypeScript types, test data, and environment state in sync. Every schema change requires manual updates to 6+ locations (migration, Zod schemas, local TS interfaces, test fixtures, E2E seeds, docs). This has produced 40+ data-related bug-fix commits in 2 months, including 3 critical outages. Column renames cascade across 56+ files and generate 3+ follow-up fix commits each. The Supabase client is fully untyped, so `.from()` calls return `any` and field access errors are only caught at runtime.

Additionally, there's a **migration/test deadlock**: CI tests run against staging, but migrations only apply to staging after merge. So tests that reference new schema always fail on the PR, and either (a) you split into two PRs (migration first, code second), (b) tests skip gracefully when schema is missing, or (c) tests fail and block the release — which is what's happening now with `evolution_run_costs`.

## Options Considered
- [x] **Option A: Generated Types + CI-Managed Workflow (Recommended)**: Apply migrations on PR, generate types in CI, wire `Database` generic into Supabase clients. Eliminates both schema drift and the migration/test deadlock.
- [ ] **Option B: Manual Schema Audit Only**: Manually audit all schemas, fix mismatches, add documentation. Fixes current bugs but doesn't prevent future drift or the deadlock.
- [ ] **Option C: Full ORM Migration**: Replace raw Supabase queries with Drizzle/Prisma ORM. Maximum type safety but massive scope, high risk of regressions.

## CI Architecture (New)

### Current Flow (broken)
```
PR: migration + code → CI tests against staging (OLD schema) → tests FAIL
                        migration only applies AFTER merge → deadlock
```

### New Flow

**All jobs live in ONE workflow (`ci.yml`)** — GitHub Actions `needs:` only works within a single workflow. No cross-workflow dependencies.

```
PR opened/updated
    ↓
Job 0: detect-changes (existing, determines what to run)
    ↓
Job 1: deploy-migrations (NEW — in ci.yml, not separate workflow)
    - Only runs if migration files changed
    - Concurrency group: migration-staging (max 1, queue others)
    - Destructive DDL guard (allowlist for DROP FUNCTION/VIEW IF EXISTS + CREATE)
    - Skip for fork PRs / dependabot
    ↓
Job 2: generate-types (NEW — in ci.yml)
    - needs: deploy-migrations (or detect-changes if no migrations)
    - Generates types from staging DB
    - Validates file is non-empty BEFORE committing
    - Auto-commits to PR branch if changed
    - Does NOT re-trigger CI (uses default GITHUB_TOKEN — see below)
    ↓
Job 3: typecheck (existing, modified)
    - needs: generate-types (was: detect-changes)
    - Checks out latest commit (which includes auto-committed types)
    - tsc catches stale column references
    ↓
Jobs 4+: lint, unit-tests, integration, E2E (existing, unmodified)
    - lint: needs detect-changes (parallel, unchanged)
    - tests: need typecheck (unchanged dependency chain)
    ↓
All green → PR merges
```

**Key: No CI re-trigger needed.** The generate-types job commits with the default `GITHUB_TOKEN`, which does NOT re-trigger workflows (GitHub's infinite loop protection). Instead, the typecheck job in the SAME workflow run checks out the latest commit (which includes the auto-committed types) using `actions/checkout` with no ref override. This avoids double CI runs entirely.

### Key Design Decisions

**Q: Won't applying migrations on PRs be risky?**
Staging is already a shared dev/test DB — local dev, CI, and Vercel previews all use it. Migrations are additive and can't be easily rolled back anyway. Applying on PR just makes CI tests actually test the right schema.

**Q: What about destructive migrations (DROP, RENAME)?**
A **mandatory** CI guardrail scans migration files for destructive DDL keywords. The scan uses smart matching: `DROP TABLE`, `DROP COLUMN`, `RENAME TABLE`, `RENAME COLUMN`, `TRUNCATE`, `DELETE FROM` are blocked, but `DROP FUNCTION IF EXISTS` and `DROP VIEW IF EXISTS` followed by `CREATE` are **allowlisted** (standard Supabase boilerplate for replacing RPCs/views). Blocked patterns require explicit maintainer approval via GitHub environment protection rules. This prevents accidental staging damage without causing false-positive friction on routine migrations.

**Q: What if two PRs have conflicting migrations?**
The migration job uses a **concurrency group** (`migration-staging`, max 1) so only one PR's migrations apply at a time — others queue. The existing `migration-reorder.yml` workflow handles timestamp conflicts. GitHub's "require branches to be up to date" rule forces re-CI after competing merges. Types regenerate on each CI run, so the second PR always sees the combined schema.

**Q: What if a PR's migration is bad and breaks staging?**
Same risk as today (bad migration on merge breaks staging). But now it's caught BEFORE merge during PR review, not after. The developer sees the failure in their PR CI and can fix it. For additive migrations (ADD COLUMN), abandoned PRs leave harmless cruft. For destructive operations, the guardrail above prevents unreviewed application.

**Q: What about rollback?**
Supabase migrations can't be auto-reverted (true today too). For additive migrations (add column/table), they're harmless even if the PR is abandoned. For destructive migrations, the developer must push a fix migration to the same PR. Detection is faster in the new flow (minutes via PR CI vs hours after merge).

**Q: How do developers get the auto-generated type changes locally?**
CI auto-commits `database.types.ts` to the PR branch (same as migration-reorder already does). Developer runs `git pull`, IDE immediately shows type errors on stale code. If they push without pulling, git rejects with "non-fast-forward" and they pull first.

**Q: How does /finalize's rebase help?**
`/finalize` rebases off remote main before creating the PR. This pulls in OTHER developers' merged migrations and their `database.types.ts` updates. Combined with CI regenerating types for YOUR migration, this creates a 3-layer safety chain:

| Layer | Catches | When |
|-------|---------|------|
| `git pull` during dev | CI-generated type updates on your own PR | During development |
| `/finalize` rebase | Other PRs' migrations that landed on main | Before PR creation |
| CI type generation | Your new migration's schema changes | On every push |

**Q: What about fork PRs and Dependabot?**
Fork PRs don't have access to repo secrets, so the migration-apply and generate-types jobs are skipped (`if: github.event.pull_request.head.repo.full_name == github.repository`). Dependabot PRs skip migration-apply since they never contain migration files (conditional on migration file changes detected).

**Q: What about token security scopes?**
Two different token scopes for two different jobs:
- **Migration job** (`supabase db push`): needs `SUPABASE_DB_PASSWORD` (write access, already exists as repo secret) and `SUPABASE_ACCESS_TOKEN` with **write** scope for the staging project.
- **Generate-types job** (`supabase gen types`): needs `SUPABASE_ACCESS_TOKEN` with **read-only** scope for the staging project. If using the same write token as migration job, that's acceptable since the gen types command only reads.
- **Auto-commit**: uses default `GITHUB_TOKEN` with `contents: write` permission (set via `permissions:` block in workflow). No PAT or GitHub App token needed since we don't need to re-trigger CI.
- Store `SUPABASE_ACCESS_TOKEN` scoped to the `staging` GitHub environment to prevent accidental use against production.

**Q: What about merge conflicts on `database.types.ts`?**
When multiple PRs auto-commit this file, merge conflicts are expected on rebase. This is harmless: the CI `generate-types` job re-runs after rebase and regenerates the file from the current DB state, resolving any conflict. Add `database.types.ts merge=theirs` to `.gitattributes` to auto-resolve in favor of the incoming version during rebase.

### Type Coexistence Strategy: Generated Types vs Zod Schemas

Generated types and Zod schemas serve **different purposes** and coexist:

| Layer | File | Purpose | When used |
|-------|------|---------|-----------|
| **DB query typing** | `src/lib/database.types.ts` (auto-generated) | Types `.from()` return values, catches column renames at compile time | At query boundaries in service actions |
| **Runtime validation** | `evolution/src/lib/schemas.ts` (manual Zod) | Validates data at runtime, transforms versions (V1→V3), enforces business constraints | On DB reads/writes in pipeline code |
| **Domain types** | `evolution/src/lib/types.ts` (manual) | In-memory pipeline types (Variant, Rating, ExecutionContext) | Inside pipeline logic |

**Migration path for `as TypeName[]` casts**: Once generated types are wired in, the ~20 local interface definitions in service files (e.g., `ArenaTopic`, `ArenaEntry`) can be **deleted** — the Supabase client's `.from()` return type replaces them. The `as` casts become unnecessary. This is done incrementally during Phase 2: fix type errors surfaced by `tsc`, delete redundant local interfaces as each file is touched.

**Zod schemas remain unchanged** — they validate at runtime what generated types validate at compile time. Both layers are needed: generated types catch developer mistakes, Zod catches malformed data from the database.

## Phased Execution Plan

### Phase 1: Fix Active CI Blockers (Quick Wins)
- [ ] Fix or delete `evolution-run-costs.integration.test.ts` — tests reference intentionally dropped `get_run_total_cost` RPC and `evolution_run_costs` view
- [ ] Fix `evolution-experiment-completion.integration.test.ts` — update test fixtures to use valid UUIDs instead of plain strings
- [ ] Fix `evolution-test-helpers.ts` `createTestArenaComparison` — uses UUID for `winner` field instead of valid `'a'`/`'b'`/`'draw'`
- [ ] Fix `entity-actions.integration.test.ts` — fix stale metrics assertions (`stale` field returning undefined); verify rename action test is valid (ExperimentEntity does have rename — do NOT delete it)
- [ ] Fix stale `arena_topic` reference in `evolution/docs/metrics.md:101`
- [ ] Run full CI suite and confirm all evolution tests pass

### Phase 2: Add Supabase Generated Types
- [ ] Generate initial `database.types.ts` at `src/lib/database.types.ts` using `npx supabase gen types --lang typescript --project-id <staging-id>` (note: `--lang` flag required, not positional)
- [ ] Wire `Database` generic into ALL Supabase client creation points (full inventory):
  - [ ] `src/lib/utils/supabase/client.ts` — `createBrowserClient<Database>`
  - [ ] `src/lib/utils/supabase/server.ts` — `createServerClient<Database>` and `createClient<Database>`
  - [ ] `src/lib/supabase.ts` — legacy file: BOTH `createClient<Database>` (line 12) AND `createBrowserClient<Database>` (line 17) — two clients in one file
  - [ ] `src/lib/utils/supabase/middleware.ts` — `createServerClient<Database>`
  - [ ] `src/testing/utils/integration-helpers.ts` — `createClient<Database>` for test clients
  - [ ] `src/app/api/health/route.ts` — `createClient<Database>` (low priority but complete inventory)
- [ ] Update BOTH Supabase mock files:
  - [ ] `src/testing/mocks/@supabase/supabase-js.ts` — type mock's `.from()` to accept `Database` table names
  - [ ] `src/__mocks__/@supabase/ssr.ts` — same treatment for SSR mock path
  - [ ] Use `as unknown as SupabaseClient<Database>` on mock return to maintain chainability while satisfying types
- [ ] Add `"db:types": "npx supabase gen types --lang typescript --project-id <staging-id> > src/lib/database.types.ts"` to `package.json`
- [ ] Verify that `.from('evolution_variants')` now returns typed data instead of `any`
- [ ] Fix type errors surfaced by new strict typing — delete redundant local interfaces (ArenaTopic, ArenaEntry, etc.) as each service file is fixed
- [ ] Note: `AdminContext.supabase` in `evolution/src/services/adminAction.ts` will automatically become `SupabaseClient<Database>` since it calls `createSupabaseServiceClient()` which is now typed — no per-service changes needed (transitive benefit)
- [ ] Note: Scripts under `evolution/scripts/` and `scripts/` also create untyped clients — lower priority, track as follow-up

### Phase 3: CI Workflow Changes

**Key architectural decision**: All jobs (migrations, type generation, typecheck, tests) live in **ONE workflow (`ci.yml`)**. GitHub Actions `needs:` only works within a single workflow — cross-workflow dependencies are impossible.

- [ ] Add `deploy-migrations` job to `ci.yml` (move logic from `supabase-migrations.yml` for the PR path):
  ```yaml
  deploy-migrations:
    needs: [detect-changes]
    if: |
      needs.detect-changes.outputs.has_migrations == 'true'
      && github.event.pull_request.head.repo.full_name == github.repository
      && github.actor != 'dependabot[bot]'
    concurrency:
      group: migration-staging
      cancel-in-progress: false
    environment: staging  # uses environment-scoped secrets
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - name: Check for destructive DDL (PR-changed migrations only)
        run: |
          # Only scan migration files added/modified in this PR, not historical ones
          CHANGED=$(git diff --name-only --diff-filter=AM origin/${{ github.base_ref }}...HEAD -- supabase/migrations/)
          if [ -z "$CHANGED" ]; then exit 0; fi
          # Allowlist: DROP FUNCTION/VIEW/INDEX/TRIGGER IF EXISTS (standard RPC/view replacement)
          # Block: DROP TABLE, DROP COLUMN, RENAME TABLE/COLUMN, TRUNCATE, DELETE FROM
          BLOCKED=$(echo "$CHANGED" | xargs grep -niE '(DROP\s+(TABLE|COLUMN)|RENAME\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)' \
            2>/dev/null | grep -viE 'DROP\s+(FUNCTION|VIEW|INDEX|TRIGGER)\s+IF\s+EXISTS' || true)
          if [ -n "$BLOCKED" ]; then
            echo "::error::Destructive DDL detected — requires manual approval:"
            echo "$BLOCKED"
            exit 1
          fi
      - run: supabase db push --project-ref ${{ secrets.SUPABASE_STAGING_PROJECT_ID }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
  ```
- [ ] Add `generate-types` job to `ci.yml`:
  ```yaml
  generate-types:
    needs: [detect-changes, deploy-migrations]
    if: |
      !failure() && !cancelled()
      && github.event_name == 'pull_request'
      && github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: write
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: supabase/setup-cli@v1
      - name: Generate types
        run: npx supabase gen types --lang typescript --project-id ${{ secrets.SUPABASE_STAGING_PROJECT_ID }} > src/lib/database.types.ts
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - name: Validate types file
        run: |
          test -s src/lib/database.types.ts || (echo "::error::Type generation produced empty file" && exit 1)
      - name: Commit if changed
        run: |
          if ! git diff --quiet src/lib/database.types.ts; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add src/lib/database.types.ts
            git commit -m "chore: regenerate database types"
            git push
          fi
  ```
- [ ] Restructure `ci.yml` job dependencies:
  - Current: `detect-changes → [typecheck, lint]` (parallel)
  - New: `detect-changes → deploy-migrations → generate-types → typecheck → unit-tests → integration`
  - `detect-changes → lint` (parallel, unchanged)
  - **Critical**: `typecheck` job must use `ref: ${{ github.head_ref }}` in `actions/checkout` to pick up the auto-committed `database.types.ts`. Without this, it checks out the old SHA from the workflow trigger and won't see the new types.
  - For docs-only PRs: deploy-migrations skips (no migration files), generate-types runs but finds no diff (no commit), typecheck runs normally
  - Note: `generate-types` uses `if: !failure() && !cancelled()` so it runs when deploy-migrations succeeds OR is skipped, but NOT when it fails (prevents generating types from partially-migrated schema)
  - Note: Workflow-level `cancel-in-progress: true` could kill a migration mid-execution on rapid pushes. `supabase db push` is transactional per-file, so partial cancellation is safe — the next run re-applies from where it left off.
- [ ] Keep `supabase-migrations.yml` for push-to-main/production deploys (existing behavior unchanged)
- [ ] Add `.gitattributes` entry: `src/lib/database.types.ts merge=theirs` to auto-resolve merge conflicts
- [ ] Add `detect-changes` output `has_migrations` — set to `true` if any files changed in `supabase/migrations/`
- [ ] Add secrets to GitHub repo:
  - [ ] `SUPABASE_ACCESS_TOKEN` — scoped to staging project (from Supabase dashboard → access tokens), stored in `staging` GitHub environment
  - [ ] `SUPABASE_STAGING_PROJECT_ID` — staging project ref (can be a variable instead of secret since it's already public in workflow files: `ifubinffdbyewoezcidz`)
  - [ ] `SUPABASE_DB_PASSWORD` — already exists as repo secret
- [ ] Add a simple integration test that parses a real DB row through each `FullDbSchema` Zod schema — catches Zod/DB mismatches at test time
- [ ] Test the full flow: create a test PR with a trivial migration, verify CI applies migration → regenerates types → auto-commits → typecheck job checks out fresh commit → tsc catches stale code
- [ ] Document rollback procedure: if the CI workflow changes break existing PRs, revert the workflow file on main; existing PRs rebase onto the revert
- [ ] Add Phase 4 FK migrations with explicit `ON DELETE` behavior:
  - `evolution_runs.evolution_explanation_id` → `ON DELETE SET NULL` (runs can outlive explanations)
  - `evolution_experiments.evolution_explanation_id` → `ON DELETE SET NULL`
  - `evolution_explanations.prompt_id` → `ON DELETE CASCADE` (explanation meaningless without prompt)

### Phase 4: Fix Missing Database Constraints
- [ ] Add migration: FK `evolution_runs.evolution_explanation_id` → `evolution_explanations(id)` ON DELETE SET NULL
- [ ] Add migration: FK `evolution_experiments.evolution_explanation_id` → `evolution_explanations(id)` ON DELETE SET NULL
- [ ] Add migration: FK `evolution_explanations.prompt_id` → `evolution_prompts(id)` ON DELETE CASCADE
- [ ] Add migration: CHECK constraint on `evolution_agent_invocations.agent_name` for known agent names
- [ ] Verify no orphaned data exists before adding constraints (query for orphans first)

### Phase 5: Harden Test Data
- [ ] Replace hardcoded column inserts in fragile integration tests with schema-derived factory functions from `evolution-test-helpers.ts`
- [ ] Add `evolution_metrics` cleanup to the 16 E2E specs that currently skip it
- [ ] Fix fire-and-forget timing in `evolution-entity-logger.integration.test.ts` — replace `setTimeout(200)` with proper await/polling
- [ ] Standardize E2E cleanup: ensure all specs use `trackEvolutionId()` for defense-in-depth cleanup

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` — verify all FullDbSchemas can parse generated type shapes
- [ ] New test: `src/lib/database.types.test.ts` — verify generated types file exists and is non-empty

### Integration Tests
- [ ] `src/__tests__/integration/evolution-run-costs.integration.test.ts` — fix or remove (dropped RPC)
- [ ] `src/__tests__/integration/evolution-experiment-completion.integration.test.ts` — fix UUID fixtures
- [ ] `src/__tests__/integration/entity-actions.integration.test.ts` — fix stale metrics assertions (keep rename test)
- [ ] New test: `src/__tests__/integration/evolution-schema-validation.integration.test.ts` — parse real DB rows through Zod schemas

### E2E Tests
- [ ] Run full E2E suite after changes: `npm run test:e2e -- --grep "evolution"`

### Manual Verification
- [ ] Verify `supabase gen types` produces correct output for all evolution tables
- [ ] Verify TypeScript IDE autocomplete works on `.from('evolution_variants').select('*')` after typing
- [ ] Test the full CI flow end-to-end with a test PR containing a trivial migration

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI changes in this project — skip Playwright

### B) Automated Tests
- [ ] `npm run test:unit` — all unit tests pass
- [ ] `npm run test:integration` — all integration tests pass (especially evolution-*)
- [ ] `npm run test:e2e -- --grep "evolution"` — all E2E tests pass
- [ ] `npx tsc --noEmit` — no type errors with generated types wired in

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/data_model.md` — add section on generated types, type coexistence strategy, schema validation workflow
- [ ] `evolution/docs/reference.md` — add `npm run db:types` to key scripts, document CI type generation, document destructive DDL guardrail
- [ ] `evolution/docs/metrics.md` — fix stale `arena_topic` entity type reference (line 101)
- [ ] `docs/docs_overall/environments.md` — document new CI flow: migrations apply on PR, types auto-generated, fork/dependabot handling

## Review & Discussion

### Iteration 1 — Review Scores: Security 3/5, Architecture 3/5, Testing 2/5

**Critical gaps fixed:**

1. **[Security] CI auto-commit token scoping** — Specified GitHub App installation token (not PAT) scoped to `contents:write` on this repo only. Added fork PR guard (`github.event.pull_request.head.repo.full_name == github.repository`).

2. **[Security] Destructive DDL mandatory gate** — Changed from "optional" to **mandatory** CI guardrail. Migration job greps for `DROP|RENAME|TRUNCATE|DELETE FROM` and blocks with requirement for maintainer approval via GitHub environment protection rules.

3. **[Security] SUPABASE_ACCESS_TOKEN scope** — Specified read-only token scoped to staging project only (not org-wide). Stored as repo secret scoped to `staging` GitHub environment.

4. **[Architecture] Incomplete Supabase client inventory** — Expanded from 3 to 6 files: added `middleware.ts`, `integration-helpers.ts`, `health/route.ts`. Also noted scripts as lower-priority follow-up.

5. **[Architecture] Type coexistence strategy** — Added dedicated section explaining generated types vs Zod schemas vs domain types. Documented migration path for `as TypeName[]` casts and transitive benefit via `AdminContext`.

6. **[Architecture] Mock compatibility** — Added explicit task to update `src/testing/mocks/@supabase/supabase-js.ts` mock to accept `Database` table names.

7. **[Architecture] Zod/generated type relationship** — Documented that Zod validates at runtime, generated types validate at compile time. Both coexist. Local interfaces get deleted incrementally.

8. **[Testing] PAT vs GitHub App token for re-triggering CI** — Switched to GitHub App token which can re-trigger workflows (unlike default GITHUB_TOKEN).

9. **[Testing] Concurrent migration race condition** — Added `concurrency: { group: migration-staging, cancel-in-progress: false }` to queue migrations instead of racing.

10. **[Testing] Entity-actions rename test is valid** — Corrected: ExperimentEntity DOES have rename action. Changed to "fix stale metrics assertions" only, preserved rename test.

11. **[Testing] Job dependency chain restructuring** — Explicitly documented: `detect-changes → generate-types → typecheck`, `detect-changes → lint` (parallel). Docs-only PRs: generate-types is no-op.

12. **[Testing] Fork PRs and Dependabot handling** — Added skip conditions for both. Fork PRs: no secrets access, skip migration and types jobs. Dependabot: skip migration-apply (never has migration files).

13. **[Security] CLI syntax correction** — Fixed from `npx supabase gen types typescript --project-id` to `npx supabase gen types --lang typescript --project-id` (correct `--lang` flag).

14. **[Testing] Rollback procedure** — Added explicit rollback: revert workflow file on main, existing PRs rebase onto revert.

### Iteration 2 — Review Scores: Security 4/5, Architecture 4/5, Testing 3/5

**Critical gaps fixed:**

15. **[Testing] Cross-workflow dependency impossible** — Fundamental redesign: moved deploy-migrations INTO `ci.yml` alongside generate-types. All jobs now in one workflow with proper `needs:` chain. Kept `supabase-migrations.yml` for push-to-main/production only.

16. **[Testing] Auto-commit cancels own CI run** — Eliminated by using default `GITHUB_TOKEN` for auto-commit (doesn't re-trigger workflows). Typecheck job in same workflow run checks out the latest commit including auto-committed types. No double CI runs.

17. **[Testing] Validation before commit** — Moved `test -s database.types.ts` BEFORE the commit step so empty/truncated files are never committed.

18. **[Security] SUPABASE_ACCESS_TOKEN scope contradiction** — Clarified: migration job needs write access (for `db push`), generate-types only needs read. Using same token for both is acceptable. Stored in `staging` GitHub environment.

19. **[Security] DDL guard false positives** — Added smart allowlist: `DROP FUNCTION/VIEW IF EXISTS` is allowed (standard RPC replacement boilerplate). Only truly destructive operations (`DROP TABLE`, `DROP COLUMN`, `RENAME TABLE/COLUMN`, `TRUNCATE`, `DELETE FROM`) are blocked.

20. **[Security] Empty file committed before validation** — Fixed ordering: validate → commit (not commit → validate).

21. **[Architecture] Missing SSR mock** — Added `src/__mocks__/@supabase/ssr.ts` to mock update inventory.

22. **[Architecture] supabase.ts has two clients** — Expanded inventory to note both `createClient` and `createBrowserClient` in that file.

23. **[Architecture] ON DELETE behavior for FKs** — Specified: SET NULL for runs/experiments (can outlive explanations), CASCADE for explanations→prompts.

24. **[Architecture] supabase/setup-cli action** — Added to CI snippets for consistent CLI versioning (matching existing migration workflow).

25. **[Architecture] .gitattributes for merge conflicts** — Added `database.types.ts merge=theirs` to auto-resolve conflicts during rebase.

26. **[Testing] Concurrency group queuing limits** — Documented: GitHub queues max 1 pending. Third concurrent migration PR would be cancelled. Acceptable given low frequency of migration PRs.

### Iteration 3 — Review Scores: Security 4/5, Architecture 5/5 ✅, Testing 4/5

**Impactful minor issues fixed (promoted to fixes due to impact):**

27. **[Security+Testing] DDL guard scans all historical files** — Changed to only scan PR-changed migration files via `git diff --name-only --diff-filter=AM origin/$base_ref...HEAD`. Eliminates false positives from historical DROP TABLE migrations.

28. **[Security+Testing] `always()` masks migration failures** — Changed to `!failure() && !cancelled()` — generate-types runs when deploy-migrations succeeds or is skipped, but NOT when it fails. Prevents generating types from a partially-migrated schema.

29. **[Testing] Typecheck won't see auto-committed types** — Added explicit note: typecheck job MUST use `ref: ${{ github.head_ref }}` in `actions/checkout` to pick up the auto-committed database.types.ts. Without this, it checks out the old SHA.

30. **[Security] Workflow cancel-in-progress vs migration safety** — Documented: `supabase db push` is transactional per-file, so partial cancellation is safe. Next run re-applies from where it left off.
