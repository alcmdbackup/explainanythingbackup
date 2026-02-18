# Questions About Long Running Evolution Runs Research

## Problem Statement
A few adhoc questions regarding evolution pipelines current state.

## Requirements (from GH Issue #458)
A few adhoc questions regarding evolution pipelines current state.

## High Level Summary

Investigation started with a production error `Could not find the table 'public.evolution_agent_invocations' in the schema cache` during an evolution run. Root cause traced to **Supabase migration deployment failures** caused by out-of-order migration timestamps from parallel branches.

### Key Findings

1. **The `evolution_agent_invocations` table doesn't exist in production** because migration `20260212000001` was never applied.

2. **The pipeline handles this gracefully** — `persistAgentInvocation()` catches the error and logs a warning. Runs continue but lack per-agent execution detail data for the dashboard Timeline.

3. **Migration deployments have been failing repeatedly** on both staging and production since Feb 8. The root cause is `supabase db push` refusing to apply migrations with timestamps earlier than the last applied migration — a safety check that fires when parallel branches create migrations with interleaved timestamps.

4. **The fix pattern has been manual renaming** (e.g., `20260210000001` → `20260213000001`), which fixes one conflict but doesn't prevent the next one. Git log shows at least 7 fix commits: #414, #445, #447, #397.

5. **Production is stuck** — the last successful production migration push was Feb 13 (a hotfix for a duplicate migration rename). Every production deploy since has failed.

---

## Finding 1: Missing Table Error in Production

### Error
```
Could not find the table 'public.evolution_agent_invocations' in the schema cache.
```

### Affected Code Paths

**Write path (pipeline runtime)** — non-fatal:
- `src/lib/evolution/core/pipelineUtilities.ts:59` — `persistAgentInvocation()` catches error, logs warning

**Read paths (dashboard)** — broken views:
- `src/lib/services/evolutionVisualizationActions.ts:383` — Timeline cost attribution
- `src/lib/services/evolutionVisualizationActions.ts:637` — Budget tab agent breakdown
- `src/lib/services/evolutionVisualizationActions.ts:1022` — Agent execution detail (lazy-load)
- `src/lib/services/evolutionVisualizationActions.ts:1061` — Iteration invocations
- `src/lib/services/evolutionVisualizationActions.ts:1088` — Agent invocations for run
- `src/lib/services/evolutionActions.ts:675` — Cost breakdown action

### Migration
The table is created by `supabase/migrations/20260212000001_evolution_agent_invocations.sql` — this migration has never been applied to production.

---

## Finding 2: Migration Deployment Failure Pattern

### Deployment Workflow
`.github/workflows/supabase-migrations.yml` triggers on pushes to `main` or `production` branches when `supabase/migrations/**` changes.

Flow: `npm ci` → `backfill-prompt-ids.ts` → `supabase link` → `supabase db push`

### Failure History (Deploy Supabase Migrations workflow)

| Date | Branch | Result | Error |
|------|--------|--------|-------|
| Feb 16 04:42 | main | SUCCESS | — |
| **Feb 16 03:52** | **production** | **FAILURE** | logs expired |
| Feb 15 22:27 | main | SUCCESS | — |
| Feb 15 22:18 | main | FAILURE | out-of-order: `20260215000001_revert_not_null_prompt_strategy.sql` |
| Feb 15 19:38 | main | SUCCESS | — |
| Feb 15 17:48 | main | FAILURE | out-of-order: `20260215000001_revert_not_null_prompt_strategy.sql` |
| Feb 15 16:01 | main | SUCCESS | — |
| **Feb 14 05:41** | **production** | **FAILURE** | logs expired |
| Feb 14 05:03 | main | SUCCESS | — |
| Feb 13 21:15 | production | SUCCESS | hotfix: rename duplicate migration |
| Feb 13 20:45 | production | FAILURE | logs expired |
| Feb 13 19:58 | production | FAILURE | logs expired |
| Feb 13 17:27 | main | SUCCESS | — |
| Feb 13 16:26 | main | FAILURE | out-of-order: `20260210000001_add_single_pipeline_type.sql` |
| Feb 11 03:09 | main | FAILURE | unknown (logs expired) |
| Feb 10 21:34 | main | FAILURE | out-of-order: `20260208000003_evolution_run_logs.sql` |

### Root Cause: Out-of-Order Timestamps

**Every failure** shows the same Supabase CLI error:
```
Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag to apply these migrations:
supabase/migrations/20260215000001_revert_not_null_prompt_strategy.sql
```

**Why it happens**: Branch A creates migration `20260215000005`, merges to main, gets applied to staging. Branch B then merges with `20260215000001` (created earlier on its branch). Supabase CLI sees this as an out-of-order insertion and refuses to apply ANY pending migrations.

**Impact**: All migrations after the conflicting one are also blocked. This is why `evolution_agent_invocations` (migration `20260212000001`) was never applied to production.

---

## Finding 3: Deep Research on Each Solution Layer

### Layer 1: `supabase db push --include-all`

#### What it does (from CLI source code)
When `FindPendingMigrations()` encounters an `ErrMissingRemote` (out-of-order file), the `--include-all` flag suppresses the error and collects both the interleaved and remaining migrations into a single pending list. Migrations are applied in **filename timestamp order** (lexicographic sort of the local directory).

#### Risk assessment

| Scenario | Risk | Outcome |
|----------|------|---------|
| Interleaved migration adds new independent table | Low | Works fine |
| Interleaved migration depends on already-applied migration | Low | Works fine (dependency exists) |
| Interleaved migration creates something conflicting with existing state | High | SQL error — migration fails loudly |
| Two branches CREATE the same table/column | High | Duplicate object error |

**The flag does NOT cause silent data corruption.** If a conflict exists, the migration SQL fails with a Postgres error and the push stops. Migrations run inside transactions.

**Our migrations are independent DDL** — each creates its own tables/columns. No cross-branch dependencies. **This is safe for our use case.**

#### Official recommendation
Supabase maintainer `@sweatybridge` introduced this flag specifically for teams with parallel branches (GitHub Issue #611): _"We added `db push --include-all` flag to push migrations regardless of their timestamp."_

#### Useful companion: `--dry-run`
`supabase db push --include-all --dry-run` previews what would be applied without executing. Recommended as a CI step before the actual push. Note: `--dry-run` does NOT validate SQL — it only lists files.

#### No config.toml default
There's no way to make `--include-all` the default in `supabase/config.toml`. Must be passed explicitly on every invocation.

---

### Layer 2: GitHub Action Auto-Rename

#### No existing tool exists
Searched extensively — no existing GitHub Action or Supabase community tool handles this. The Supabase docs acknowledge the problem and suggest manual renaming.

#### Trigger strategy
```yaml
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize]
    paths:
      - 'supabase/migrations/**'
```

- Use `pull_request`, NOT `pull_request_target` (avoids the "pwn request" security vulnerability)
- `synchronize` fires when commits are pushed to the PR branch (covers rebases)
- **Critical gap**: `synchronize` does NOT fire when the base branch (main) updates. Need "Require branches to be up to date before merging" in branch protection to force a rebase + re-run.

#### Detecting new migrations
```bash
git diff --diff-filter=A --name-only origin/main...HEAD -- supabase/migrations/
```
- `--diff-filter=A` = only Added files (excludes modified/deleted)
- No external action dependencies needed

#### Pushing commits back to PR
- Use `stefanzweifel/git-auto-commit-action@v7` or manual `git push`
- Grant `permissions: contents: write` on the workflow
- **Commits with `GITHUB_TOKEN` do NOT trigger new workflow runs** — built-in infinite loop prevention
- Must checkout with `ref: ${{ github.head_ref }}` (actual PR branch, not merge commit)
- Only works for same-repo PRs (not forks — but we don't have forks)

#### Timestamp generation: `max(latest_on_main) + N`
```bash
LATEST_ON_MAIN=$(git ls-tree origin/main --name-only supabase/migrations/ \
  | grep -oE '[0-9]{14}' | sort -n | tail -1)
NEXT_TS=$((LATEST_ON_MAIN + 1))
```
- Deterministic, always ordered correctly
- Supabase only cares about lexicographic ordering — even invalid "time" values like `20260215236000` sort correctly
- Multiple new migrations: increment counter for each

#### Complete workflow draft

```yaml
name: Reorder Migration Timestamps
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize]
    paths:
      - 'supabase/migrations/**'
permissions:
  contents: write
jobs:
  reorder:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          fetch-depth: 0
      - name: Find and rename out-of-order migrations
        id: rename
        run: |
          NEW_FILES=$(git diff --diff-filter=A --name-only origin/${{ github.base_ref }}...HEAD -- supabase/migrations/ | sort)
          [ -z "$NEW_FILES" ] && echo "renamed=false" >> $GITHUB_OUTPUT && exit 0

          LATEST=$(git ls-tree origin/${{ github.base_ref }} --name-only supabase/migrations/ \
            | grep -oE '[0-9]{14}' | sort -n | tail -1)
          LATEST=${LATEST:-"20200101000000"}

          RENAMED=false
          NEXT=$((LATEST + 1))
          while IFS= read -r file; do
            [ -z "$file" ] && continue
            TS=$(basename "$file" | grep -oE '^[0-9]{14}')
            if [ "$TS" -le "$LATEST" ]; then
              DESC=$(basename "$file" | sed 's/^[0-9]*_//')
              git mv "$file" "supabase/migrations/${NEXT}_${DESC}"
              RENAMED=true
            fi
            NEXT=$((NEXT + 1))
          done <<< "$NEW_FILES"
          echo "renamed=$RENAMED" >> $GITHUB_OUTPUT

      - if: steps.rename.outputs.renamed == 'true'
        uses: stefanzweifel/git-auto-commit-action@v7
        with:
          commit_message: "chore: reorder migration timestamps to follow main"
          file_pattern: "supabase/migrations/*"
```

---

### Layer 3: Git Pre-Commit Hook

#### Project hook infrastructure: NONE
- No `.husky/`, `.githooks/`, or custom `.git/hooks/`
- No husky, lint-staged, lefthook, or commitlint in package.json
- No `prepare` or `postinstall` scripts that install hooks
- **Does have** Claude Code hooks in `.claude/hooks/` (bash scripts for tool-level gating)

#### Recommended: pre-commit hook (not pre-push)
- Catches the problem at creation time — easiest to fix (just rename the file)
- Only runs when migration files are staged (zero overhead for normal commits)
- **Block the commit** (exit 1) with clear error and `--no-verify` escape hatch

#### Implementation
```bash
#!/bin/bash
# .githooks/pre-commit — detect migration timestamp conflicts with origin/main
STAGED=$(git diff --cached --name-only --diff-filter=A -- 'supabase/migrations/*.sql')
[ -z "$STAGED" ] && exit 0

MAIN_LATEST=$(git ls-tree origin/main -- supabase/migrations/ 2>/dev/null \
  | awk '{print $NF}' | sed 's|supabase/migrations/||' \
  | grep -oE '^[0-9]{14}' | sort -n | tail -1)
[ -z "$MAIN_LATEST" ] && exit 0  # can't check, skip

for file in $STAGED; do
  TS=$(basename "$file" | grep -oE '^[0-9]{14}')
  if [ -n "$TS" ] && [ "$TS" -le "$MAIN_LATEST" ]; then
    echo "ERROR: $file has timestamp $TS <= main's latest $MAIN_LATEST"
    echo "Fix: rename to $(date -u +%Y%m%d%H%M%S)_description.sql"
    echo "Bypass: git commit --no-verify"
    exit 1
  fi
done
```

#### Installation via package.json
```json
{ "scripts": { "prepare": "git config core.hooksPath .githooks || true" } }
```
Auto-installs on `npm install`. The `|| true` handles CI (no `.git` directory).

#### Should NOT auto-fetch
- Network I/O in a pre-commit hook breaks offline workflows
- Stale data is still better than no check
- Can optionally warn if `origin/main` data is old

---

### Layer 4: GitHub Merge Queue

#### CRITICAL BLOCKER: Requires GitHub Enterprise Cloud

| Repo Type | Free | Team ($4/user) | Enterprise Cloud ($21/user) |
|-----------|------|----------------|---------------------------|
| Public org repo | Available | Available | Available |
| **Private org repo** | Not available | **Not available** | Available |

If `Minddojo/explainanything` is private, merge queue requires Enterprise Cloud.

#### How it works
- PR author clicks "Merge when ready" → PR enters FIFO queue
- GitHub creates temporary `gh-readonly-queue/main/` branch containing `main + all PRs ahead + this PR`
- CI re-runs on the combined branch (requires `merge_group` event in workflow triggers)
- If CI passes, PR merges. If fails, PR removed from queue and downstream entries rebuild.

#### Critical interaction with Layer 2
The temporary queue branches are **read-only** — the auto-rename Action **cannot push commits** to them. This means:
- Layer 2 must be a **failing check** (detect and fail CI) rather than **auto-fix** (push rename commit)
- Or: run the rename on the PR branch *before* entering the queue (via `pull_request` event)

#### Better alternative: "Require branches to be up to date before merging"
- Available on **all GitHub plans** (Free, Team, Enterprise)
- Forces each PR to be rebased on latest main before merging
- This triggers `synchronize` on the PR, which re-runs the Layer 2 rename Action
- Main downside: "rebase hell" if many concurrent PRs, but manageable for small teams

---

## Revised Recommendation

Based on deep research, the merge queue (Layer 4) is **not recommended** due to:
1. Enterprise Cloud pricing requirement for private repos
2. Read-only queue branches breaking the auto-rename action
3. Overkill for current team size

### Final Layered Strategy

| Layer | What | Cost | Priority |
|-------|------|------|----------|
| **1. `--include-all`** | Add flag to `supabase db push` in workflow | 5 seconds | **Do immediately** |
| **2. Auto-rename Action** | GitHub Action on PRs that renames conflicting timestamps | ~1 hour | **Primary prevention** |
| **3. Branch protection** | "Require branches to be up to date before merging" on main | 2 minutes | **Ensures Layer 2 re-runs after competing merges** |
| **4. Pre-commit hook** | Local hook that blocks commits with stale timestamps | 15 minutes | **Nice-to-have early warning** |

Layer 1 is the safety net. Layer 2 is the primary fix. Layer 3 ensures Layer 2 catches all cases. Layer 4 is local developer convenience.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/architecture.md
- docs/evolution/reference.md
- docs/evolution/data_model.md
- docs/evolution/visualization.md
- docs/evolution/cost_optimization.md
- docs/evolution/strategy_experiments.md
- docs/evolution/agents/overview.md
- docs/evolution/agents/tree_search.md

## Code Files Read
- `src/lib/evolution/core/pipelineUtilities.ts` — persistAgentInvocation (writes to missing table)
- `supabase/migrations/20260212000001_evolution_agent_invocations.sql` — the blocked migration
- `supabase/migrations/20260207000008_enforce_not_null.sql` — safety-gated migration with RAISE EXCEPTION
- `supabase/migrations/20260215000001_revert_not_null_prompt_strategy.sql` — revert of the above
- `.github/workflows/supabase-migrations.yml` — deployment workflow (both staging + production jobs)
- `scripts/backfill-prompt-ids.ts` — pre-migration backfill script with table-existence guards
- `src/lib/services/evolutionVisualizationActions.ts` — dashboard read paths for the table
- `src/lib/services/evolutionActions.ts` — cost breakdown read path
- `package.json` — confirmed no husky/lint-staged/lefthook dependencies

## GitHub Actions Runs Examined
- Run #22049491171 — failed production deploy (Feb 16, logs expired)
- Run #22050385088 — successful staging deploy (Feb 16)
- Run #22040245514 — failed staging deploy: out-of-order `20260215000001`
- Run #21994356028 — failed staging deploy: out-of-order `20260210000001`
- Run #21883259714 — failed staging deploy: out-of-order `20260208000003`
- PR #451 — Release: main → production (Feb 15), migration deploy failed
- PR #417 — Hotfix: rename duplicate migration (last successful production deploy)

## External Sources
- [Supabase CLI: db push reference](https://supabase.com/docs/reference/cli/supabase-db-push)
- [Supabase CLI: migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair)
- [Supabase CLI: migration squash](https://supabase.com/docs/reference/cli/supabase-migration-squash)
- [Supabase: Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [GitHub Issue #611: Roll back out-of-sync migrations](https://github.com/supabase/cli/issues/611) — `@sweatybridge` introduced `--include-all`
- [GitHub Issue #776: db push --dry-run doesn't validate SQL](https://github.com/supabase/cli/issues/776)
- [GitHub Docs: Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitHub Community #51483: Merge queue availability](https://github.com/orgs/community/discussions/51483) — Enterprise Cloud only for private repos
- [GitHub Security Lab: Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) — why `pull_request` > `pull_request_target`
- [stefanzweifel/git-auto-commit-action](https://github.com/stefanzweifel/git-auto-commit-action) — commits with GITHUB_TOKEN don't trigger CI loops
- [Supabase CLI source: internal/db/push/push.go](https://github.com/supabase/cli/blob/develop/internal/db/push/push.go) — `--include-all` implementation
