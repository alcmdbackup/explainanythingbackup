# smoke_test_and_nightly_e2e_failing_20260523 Plan

## Background
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## Requirements (from GH Issue #NNN)
I want to investigate why post-deploy smoke test and nightly E2E keep failing. Look at GH to figure out why.

## Problem

Two independent failure clusters (full detail in `_research.md`):

1. **Nightly E2E — 100% red for ~62 days.** Production Supabase was frozen at the 2026-03-05 schema because the May 23 release migration queue aborted on a non-idempotent `chk_budget_cap` ADD CONSTRAINT in `20260322000003`. All 73 backlog migrations — including `evolution_metrics`, `evolution_prompts.name` rename, and `evolution_criteria` — never landed. 37 admin specs failed in `beforeEach`/`seed()`. PR #1074 hotfix made `20260322000003` idempotent and the queue replayed clean at 2026-05-24 00:10 UTC. Tonight's 06:00 UTC nightly is the post-fix verification.
2. **Post-deploy smoke — 2 failures today.** Fallout from the PR #1072 evolution/public website split. The `public` matrix row uses `deployment_status.target_url` (a preview hostname) which `classifyHost()` returns `unknown` for, so middleware fail-closes 404 on `/` and `/userlibrary`. The `evolution` row hits `ea-evolution.vercel.app` where `/` redirects to `/admin/evolution-dashboard` (no home-search-input) and `/userlibrary` is gated by `PUBLIC_PREFIXES`.

## Options Considered

- [ ] **Fix A — Pin smoke `public` matrix row to canonical hostname (CHOSEN, paired with E2).** 1-line YAML edit in `.github/workflows/post-deploy-smoke.yml`: replace `${{ github.event.deployment_status.target_url }}` with `https://explainanything.vercel.app`. Same-deployment-still-tested guarantee because both hostnames point at the same Vercel project.
- [ ] **Fix B — Loosen `classifyHost()` with regex preview-hostname matching (REJECTED).** Would let `explainanything-<hash>.vercel.app` and `ea-evolution-<hash>.vercel.app` pass classification. Rejected: weakens the production fail-closed guarantee in middleware; preview URLs from forks/PRs could match.
- [ ] **Fix C — Use `VERCEL_ENV` env var to determine classification (REJECTED).** `VERCEL_ENV` is baked at build time, not overridable from the CI smoke runner, and would not help the matrix at all.
- [ ] **E1 — Helper monkey-patch / per-spec host override (REJECTED).** Hides the underlying confusion of running a single spec against two hostnames with different routing contracts.
- [ ] **E2 — Split `smoke.spec.ts` into `smoke.public.spec.ts` + `smoke.evolution.spec.ts` (CHOSEN, paired with A).** Each spec tagged + grepped so each matrix row runs only the assertions valid for its hostname. Evolution row checks dashboard load + health; public row keeps the existing 3 home/library tests.
- [ ] **D1 — Redirect nightly to staging Supabase (REJECTED).** Hides the real issue (production was stale) and breaks the production-parity guarantee the nightly is designed to provide.

## Phased Execution Plan

### Phase 1: Verify the migration fix actually unblocked nightly
- [ ] Confirm PR #1074 is merged + `supabase-migrations.yml` last `deploy-production` run is green (`gh run list --workflow=supabase-migrations.yml --branch=production --limit=3`).
- [ ] Spot-check production schema: `evolution_metrics` table exists, `evolution_prompts.name` column exists (not `title`), `evolution_criteria` table exists.
- [ ] **Morning check** (no live watch): after tonight's 06:00 UTC nightly completes, run `gh run list --workflow=e2e-nightly.yml --limit=1 --json conclusion,databaseId,url` to see the result. If `conclusion=success` or only the 3 known-secondary specs failed → Cluster 1 fix confirmed. Rationale: prod schema is already verified correct via direct query; tonight's run only verifies test-selection matches schema. Worst-case failure mode is "secondary specs surface, fix in business hours" — no urgent action required mid-night.

### Phase 2: Land smoke fix (Fix A + E2)
- [ ] Edit `.github/workflows/post-deploy-smoke.yml` line 29: replace `base_url: ${{ github.event.deployment_status.target_url }}` with `base_url: https://explainanything.vercel.app`.
- [ ] Create `src/__tests__/e2e/specs/smoke.public.spec.ts` containing the 3 existing assertions (home title, search input visible, `/userlibrary` reachable) tagged `@smoke @smoke-public`.
- [ ] Create `src/__tests__/e2e/specs/smoke.evolution.spec.ts` asserting `/admin/evolution/experiments` (or similar admin landing) 200s + renders + `/api/health` healthy, tagged `@smoke @smoke-evolution`.
  - **MUST use admin-auth fixture**: `import { test as adminTest, expect } from '../fixtures/admin-auth';` and the `adminPage` parameter — NOT the public `authenticatedPage` from `fixtures/auth.ts` that current `smoke.spec.ts` uses. Without admin-auth the evolution host will redirect-loop / 403 in production (the entire `/admin/evolution/*` tree is admin-gated by `requireAdmin()` + the hostname middleware).
  - Verify VERCEL_AUTOMATION_BYPASS_SECRET is wired through (the existing `post-deploy-smoke.yml` already passes it to Playwright env).
- [ ] Delete or replace original `src/__tests__/e2e/specs/smoke.spec.ts`.
- [ ] Update matrix rows in `post-deploy-smoke.yml`: `public` row greps `@smoke-public`, `evolution` row greps `@smoke-evolution`.
- [ ] **Pre-merge grep-validation**: run `npx playwright test --grep='@smoke-public' --list` and `--grep='@smoke-evolution' --list` locally. Each MUST return ≥1 test. A typo in the tag (e.g. `@smoke_public` vs `@smoke-public`) would silently make the matrix row run zero tests and pass — a known Playwright failure mode. Add a `if [ "$count" -eq 0 ]; then echo "ERROR: no tests matched"; exit 1; fi` guard inside the matrix step to prevent silent zero-test passes in CI.
- [ ] Open PR; verify next deployment produces 2 green smoke matrix rows, each with non-zero test count in the logs.

### Phase 3: Land secondary nightly spec fixes
- [ ] `src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts` — add `@skip-prod` tag to the localhost-assertion test; update `e2e-nightly.yml` grep to exclude `@skip-prod` (or rely on existing exclusion if present).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-autorefresh-back-nav.spec.ts:33` — replace `await page.goForward()` with `await page.goto(<captured url>)` to side-step the `pageshow` race.
- [ ] `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` — **fix, do not skip**. Two-line change applied to all 4 tests in the file:
  - Replace `genSelect.selectOption({ index: 1 })` (lines 12, 30, 56, 78) with a stable model selection. Playwright's `selectOption({ label: ... })` does NOT accept a regex (only string or array of strings) — using a regex would throw at runtime. Two options, prefer the first:
    - **(a) Stable label string**: pick the first model that's always present in the wizard (e.g., `'gpt-4o-mini'`), e.g., `await genSelect.selectOption({ label: 'gpt-4o-mini' })`. Add an `// IMPLEMENTATION NOTE: update if the wizard's model lineup ever drops gpt-4o-mini` comment so the future investigator sees the coupling.
    - **(b) Locator-then-select**: `const firstNonPlaceholderValue = await genSelect.locator('option:not([value=""])').first().getAttribute('value'); await genSelect.selectOption(firstNonPlaceholderValue);` — order-agnostic but more code.
  - Bump the 10s/15s `waitForSelector('[data-testid="dispatch-plan-row-0"]', ...)` timeouts (lines 16, 32, 62) up to 30s, matching the already-hardened precedent on line 84. The dispatch-preview server-action slows under accumulated DB state; the existing comment on line 81-83 already documents this.
  - Rationale for fixing rather than skipping: the 62-day silent outage was caused by the "tolerate-the-flake" pattern compounding into red-test-blindness. The fix is mechanical and small (~8 lines total across 4 tests), well within scope of this PR.

### Phase 4: Migration idempotency lint (operational hardening)

**Scope decisions made up-front so this phase is execution-ready:**

- **File locations** (follow existing `scripts/` convention — sibling test, no `__tests__/` subdir):
  - `scripts/lint-migrations-idempotent.ts` — the linter
  - `scripts/lint-migrations-idempotent.test.ts` — colocated unit tests (matches pattern of `check-stale-specs.test.ts`, `generate-article.test.ts`, `query-db.test.ts`, `reset-explainanything-pinecone.test.ts`)
- **CI integration**: extend `.github/workflows/supabase-migrations.yml`. Add a new job `lint-migrations-idempotent` with no `needs:` dependency (runs in parallel from the workflow start). Both existing deploy jobs add `needs: [lint-migrations-idempotent]` so they wait for the lint to pass. Path-filtering is inherited from the workflow trigger (`paths: supabase/migrations/**` already declared at workflow level — no per-job filter needed). Fail-loud, no path-only-CI bypass.
- **Invocation**: `npx tsx scripts/lint-migrations-idempotent.ts` (matches existing `query:prod` / `check:stale-specs` pattern in `package.json`). No new dependencies introduced. Note: `tsx` is currently invoked via `npx` (not pinned in devDependencies) — same supply-chain footprint as existing scripts; acceptable for now.
- **Emergency bypass** (production-down hotfix path): apply the `migration-lint-bypass` PR label. The job checks `${{ contains(github.event.pull_request.labels.*.name, 'migration-lint-bypass') }}` and exits 0 with a warning annotation. Bypass requires admin reviewer (enforced via branch protection require-CODEOWNERS-review on the label addition). Post-incident follow-up: the bypass annotation must be linked from the hotfix PR description with a TODO to retrofit guards.

**Patterns the lint enforces (full list, derived from agent-2-round-4 inventory):**

| Pattern | Required guard |
|---|---|
| `CREATE TABLE foo` | `CREATE TABLE IF NOT EXISTS foo` |
| `CREATE INDEX idx` | `CREATE INDEX IF NOT EXISTS idx` |
| `CREATE UNIQUE INDEX idx` | `CREATE UNIQUE INDEX IF NOT EXISTS idx` |
| `CREATE TYPE t AS ENUM(...)` | wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='t') THEN CREATE TYPE t ...; END IF; END $$;` |
| `CREATE FUNCTION f()` | `CREATE OR REPLACE FUNCTION f()` |
| `CREATE TRIGGER t ON foo` | preceded by `DROP TRIGGER IF EXISTS t ON foo;` in same file |
| `CREATE POLICY "p" ON foo` | preceded by `DROP POLICY IF EXISTS "p" ON foo;` in same file |
| `ALTER TABLE foo ADD COLUMN c` | `ALTER TABLE foo ADD COLUMN IF NOT EXISTS c` (Supabase runs PG 14+; supported everywhere) |
| `ALTER TABLE foo ADD CONSTRAINT c` | preceded by `ALTER TABLE foo DROP CONSTRAINT IF EXISTS c;` in same file (PG has no native `IF NOT EXISTS` for constraints) |

The lint operates on `git diff --name-only --diff-filter=A origin/main...HEAD -- 'supabase/migrations/*.sql'` (newly-added files only) so the ~35 legacy non-idempotent migrations don't break CI. Phase 8 cleans the legacy backlog separately.

**Rollout safety** (avoid breaking in-flight PRs that already have migrations queued):

- [ ] Ship the lint as `warn-only` for 7 calendar days (CI step prints findings but does not fail the job)
- [ ] Flip to `error` (required check) after the in-flight migration backlog drains AND the team has had a week to see the warnings
- [ ] Update `docs/docs_overall/environments.md §Database Migrations` (NOT `testing_setup.md` — the migrations workflow lives in environments) with the new lint requirement, the bypass label, and the pattern checklist

**Tasks:**

- [ ] Write `scripts/lint-migrations-idempotent.ts` per the pattern table above
- [ ] Write `scripts/lint-migrations-idempotent.test.ts` with passing + failing fixture SQL strings for every pattern
- [ ] Extend `.github/workflows/supabase-migrations.yml` with `lint-migrations-idempotent` job + bypass label logic + `needs:` chain
- [ ] Update `docs/docs_overall/environments.md §Database Migrations` with the lint requirement, bypass label, and 7-day warn-only window
- [ ] Add a `package.json` script entry `"lint:migrations": "npx tsx scripts/lint-migrations-idempotent.ts"` so local devs can run it pre-PR

### Phase 5: Close the post-merge verification gap in release skills

**Background**: `/mainToProd` and `/finalize` both end at "PR is mergeable, PR CI is green". Neither waits for or verifies the post-merge deploy workflows (`supabase-migrations.yml` `deploy-production` for mainToProd, `deploy-staging` for finalize) or the Vercel deploy. PR CI runs against staging Supabase, so it cannot detect a non-idempotent migration that would fail against prod state. This gap is what allowed the 2-month silent schema drift across 7+ releases.

#### Why also patch `/finalize`?

`/finalize` merges to `main`, which triggers `deploy-staging` on push. A failed staging migration leaves staging schema stale, manifesting as PR CI failures on the **next** unrelated PR — confusing the next author and adding investigation overhead. Lower blast radius than prod (no end-user impact), but same shape of gap and same easy fix.

#### Three structural options (analysis)

| Option | Where it sits | What it catches | What it misses | Effort |
|---|---|---|---|---|
| **1. Extend `/mainToProd` (and `/finalize`) to wait post-merge** | At skill exit | Failures when the skill is the merge driver | Merges made via GitHub UI / `gh pr merge` / auto-merge bot. Also today's skill stops before merging — would need to take on merge authority | Medium |
| **2. New `/verifyProdRelease` skill (+ daily cron)** | On-demand, any merge path | Any failure once invoked. Cron heartbeat covers "nobody remembered" | Window between merge and next cron tick (still bounded to ≤24h) | Low-medium |
| **3. Pre-merge migration dry-run as required PR check** | Branch protection | Non-idempotent migration bugs before merge is even possible | Runtime/data-shape issues that only surface against real prod data; requires ephemeral Supabase or prod-snapshot infra | High |

These aren't mutually exclusive. The cheap layered approach is: **idempotency lint (Phase 4) for prevention** + **a reminder note in the skill (this phase, immediate) for skill-driven releases** + **(future) cron-driven verification for the catch-all**. Full Option 3 is overkill until the cheaper layers prove insufficient.

#### Phase 5 scope (this PR)

This phase ships only the minimum that closes the immediate gap: a **reminder note** in both skills pointing the user at the verification commands to run after merging. It does NOT take on merge authority, does NOT add new skills, does NOT add new CI infrastructure.

- [ ] Apply diff to `.claude/commands/mainToProd.md` (see [proposed-diff-mainToProd](#proposed-diff-maintoprod) below).
- [ ] Apply diff to `.claude/commands/finalize.md` (see [proposed-diff-finalize](#proposed-diff-finalize) below).
- [ ] Defer `/verifyProdRelease` skill + cron (Option 2) — capture as a follow-up TODO; revisit if the manual reminder proves insufficient over the next 30 days.
- [ ] Defer pre-merge migration dry-run (Option 3) — capture as a follow-up; the idempotency lint from Phase 4 is the cheap first step.

#### Design: conditional loud warning, not a static section

The reminder is **conditional on the PR actually touching `supabase/migrations/**`**. Most PRs don't include migrations, so the warning would become wallpaper if it fired every time. By gating on the migration-present condition, when the warning does fire it carries real weight — "this specific PR has migrations, you specifically need to do something extra after merging."

The skill emits the warning as the **final step of its output**, after the PR-ready confirmation, in a visually distinct banner that lists the specific migration files in this PR and the exact verification commands. The banner uses ASCII rules + ALL-CAPS + action verbs to be hard to skim past.

#### proposed-diff-mainToProd

**Insertion anchor (precise)**: insert as a new subsection `#### 7.5 Migration-Present Warning (Conditional)` INSIDE the existing `### 7. Verify and Cleanup` section, immediately after the `gh pr view --json mergeable,mergeStateStatus` line (currently around line 333). Do NOT insert between Steps 6 and 7. The new subsection ends before the "Return to original branch" cleanup.

````markdown
#### 7.5 Migration-Present Warning (Conditional)

After confirming PR is mergeable, detect whether this PR touches any migration files. **Fail-loud semantics throughout: capture exit codes explicitly, surface failures with WARNING text — silently swallowing errors here would reproduce the exact failure mode this entire phase prevents.** (Do NOT use `set -e` — it would abort the snippet before the `DIFF_EXIT=$?` capture on the next line, defeating the explicit-check pattern.)

```bash
# Get the PR number (must be defined; this skill does not maintain it as a global)
PR_NUMBER=$(gh pr view --json number -q .number)
if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
  echo "WARNING: unable to determine PR number — migration-presence check skipped. Inspect manually before merging."
  exit 0  # don't block the skill on metadata fetch issues; surface explicitly
fi

# Fetch the file list. Capture stdout AND exit code separately so we can fail loud on API failure.
DIFF_OUTPUT=$(gh pr diff "$PR_NUMBER" --name-only)
DIFF_EXIT=$?
if [ "$DIFF_EXIT" -ne 0 ]; then
  echo "WARNING: 'gh pr diff $PR_NUMBER --name-only' exited $DIFF_EXIT — migration-presence check could not run. Run manually: 'git diff origin/production..HEAD -- supabase/migrations/' before merging."
  exit 0
fi

# Filter to migration files
MIGRATION_FILES=$(echo "$DIFF_OUTPUT" | grep '^supabase/migrations/' || true)

if [ -z "$MIGRATION_FILES" ]; then
  # No migrations in this PR — skip the banner. Proceed to normal skill exit.
  :
else
  MIGRATION_COUNT=$(echo "$MIGRATION_FILES" | wc -l | tr -d ' ')
  # ↓ Emit the banner. See below for the rendered template.
fi
```

**If `MIGRATION_FILES` is non-empty** → emit the following banner as the FINAL message to the user, after all other skill output. The banner must be rendered as a fenced code block in chat so ASCII rules display verbatim. Claude (the skill runner) MUST include this banner literally in its final response message — do not summarize or paraphrase. Substitute the placeholders inline:

```
================================================================================
!! POST-MERGE MIGRATION VERIFICATION REQUIRED !!
================================================================================

This PR ships <MIGRATION_COUNT> migration file(s):

<each MIGRATION_FILES path, one per line, indented 2 spaces>

After you merge this PR, you MUST run these commands to confirm migrations
applied successfully to production:

  # Wait ~5 seconds after merge for GitHub to populate the merge commit SHA
  MERGE_SHA=$(gh pr view <PR#> --json mergeCommit -q '.mergeCommit.oid')
  if [ -z "$MERGE_SHA" ] || [ "$MERGE_SHA" = "null" ]; then
    echo "Merge SHA not yet populated — wait 10s and re-run."
  else
    gh run list --workflow=supabase-migrations.yml --branch=production \
      --commit="$MERGE_SHA" --limit=1
  fi

EXPECTED: conclusion=success.

IF FAILURE: do NOT release further code until the migration is fixed. A non-
idempotent migration aborts the entire deploy queue and leaves prod app code
running against stale schema. Inspect logs with:
  gh run view <id> --log-failed

This exact scenario caused a 2-month silent prod-schema drift in May 2026.
See: docs/planning/smoke_test_and_nightly_e2e_failing_20260523/
================================================================================
```
````

**Also append to the existing Troubleshooting section** (this catches the rare case where the conditional check itself fails):

````markdown
If `gh pr diff` fails or returns no output but you suspect this PR contains migrations, fall back to a manual check:
```bash
git diff origin/production..HEAD -- supabase/migrations/ | head -1
```
A non-empty result means migrations are present and the post-merge verification is required regardless.
````

#### proposed-diff-finalize

**Insertion anchor (precise)**: insert as a new subsection `### Step 8.5 Migration-Present Warning (Conditional)` in `.claude/commands/finalize.md`, immediately AFTER the existing `### 8. Monitor PR Checks` section (which ends after its 8a-8e sub-steps complete-with-all-green), and immediately BEFORE the `## Success Criteria` h2. Use `### Step 8.5` (h3) so it nests as a peer of `### 8.` rather than visually outranking it. Rationale: must fire after CI-green confirmation so we don't warn about a PR that's about to be rejected anyway.

The structure is identical to mainToProd's 7.5 but the verification command targets `--branch=main` (staging deploy) and the banner language adjusts to "staging" with lower-urgency framing.

````markdown
### Step 8.5 Migration-Present Warning (Conditional)

After confirming PR CI is green, detect whether this PR touches any migration files. **Same fail-loud semantics as mainToProd Step 7.5 — silent skip recreates the failure mode this phase prevents.**

```bash
# Get the PR number (must be defined; this skill does not maintain it as a global)
PR_NUMBER=$(gh pr view --json number -q .number)
if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
  echo "WARNING: unable to determine PR number — migration-presence check skipped. Inspect manually before merging."
  exit 0
fi

DIFF_OUTPUT=$(gh pr diff "$PR_NUMBER" --name-only)
DIFF_EXIT=$?
if [ "$DIFF_EXIT" -ne 0 ]; then
  echo "WARNING: 'gh pr diff $PR_NUMBER --name-only' exited $DIFF_EXIT — migration-presence check could not run. Run manually: 'git diff origin/main..HEAD -- supabase/migrations/' before merging."
  exit 0
fi

MIGRATION_FILES=$(echo "$DIFF_OUTPUT" | grep '^supabase/migrations/' || true)
if [ -z "$MIGRATION_FILES" ]; then
  :  # No migrations; skip the banner.
else
  MIGRATION_COUNT=$(echo "$MIGRATION_FILES" | wc -l | tr -d ' ')
  # ↓ Emit the banner. See below for the rendered template.
fi
```

**If `MIGRATION_FILES` is non-empty** → emit the following banner as the FINAL message to the user. The banner must be rendered as a fenced code block in chat so ASCII rules display verbatim. Claude (the skill runner) MUST include this banner literally in its final response — do not summarize or paraphrase:

```
================================================================================
!! POST-MERGE STAGING MIGRATION VERIFICATION REQUIRED !!
================================================================================

This PR ships <MIGRATION_COUNT> migration file(s):

<each MIGRATION_FILES path, one per line, indented 2 spaces>

After you merge to main, you MUST verify the staging migration workflow:

  # Wait ~5 seconds after merge for GitHub to populate the merge commit SHA
  MERGE_SHA=$(gh pr view <PR#> --json mergeCommit -q '.mergeCommit.oid')
  if [ -z "$MERGE_SHA" ] || [ "$MERGE_SHA" = "null" ]; then
    echo "Merge SHA not yet populated — wait 10s and re-run."
  else
    gh run list --workflow=supabase-migrations.yml --branch=main \
      --commit="$MERGE_SHA" --limit=1
  fi

EXPECTED: conclusion=success.

IF FAILURE: do NOT merge further migration-touching PRs until this is fixed.
A failed staging migration leaves staging schema stale and will manifest as
PR CI failures for the next unrelated author — confusing them and adding
investigation overhead. Blast radius is lower than prod but the fix pattern
is the same:
  gh run view <id> --log-failed

See parallel pattern in /mainToProd for the full background.
================================================================================
```
````

### Phase 6: Alerting hardening (small config tightening only)

**Background**: agent 4 of round 4 confirmed Slack alerts were firing for both workflows nightly for 62 days and Slack accepted them (`ok` response in logs). The channel went unread / muted. This is an organizational problem more than a config one — keep this phase narrow to two small config tightenings, no new workflows.

- [ ] Tighten failure gate in both workflows so unattended cancels alert, but manual workflow_dispatch cancels do NOT (avoids re-creating the channel-noise problem from agent-4-round-4 — every dev cancel would now Slack-spam the already-muted channel):
  - **New conditional**: `if: failure() || (cancelled() && github.event_name == 'schedule')`
  - For `post-deploy-smoke.yml` (event is `deployment_status`, not `schedule`): use `if: failure() || (cancelled() && github.event_name == 'deployment_status')`
  - Files: `.github/workflows/e2e-nightly.yml` (notify step ~L190-219), `.github/workflows/post-deploy-smoke.yml` (notify step ~L147-191)
  - **Rationale**: only unattended cancels (timeout on a scheduled or deployment-event run) signal a real problem worth waking someone for. A dev hitting "Cancel workflow run" on a manual `workflow_dispatch` test is intentional, not an incident.
- [ ] Have a human confirm the Slack webhook channel is actually monitored (unmute, set up keyword highlights, or pick a dedicated #release-alerts channel). Document the chosen channel name in `docs/docs_overall/environments.md`.

> **Deferred**: a daily-heartbeat workflow and auto-issue creation were considered and rejected for this PR — adds new infrastructure for marginal gain over the layered approach already in Phases 4 + 5. Revisit only if monitor-gap incidents recur after Phases 4 + 5 ship.

### Phase 7: Release cadence (organizational follow-up)

**Background**: production was frozen at 2026-03-05 schema AND app code for 2.5 months until today's PR #1073 release. The migration drift accumulated because there was no regular release cadence forcing the issue to surface. This phase is policy, not code — capture the lesson and leave the cadence-setting to the team.

- [ ] Add a short subsection to `docs/docs_overall/environments.md` (recommended home — it already owns the deploy + migration narrative; co-locating release-cadence policy keeps related operational content together) noting: "Production releases should happen at least every <agreed interval>. The longer prod sits frozen, the larger the migration backlog grows, and the higher the chance any one non-idempotent migration aborts the whole queue."
- [ ] Recommend a default cadence (e.g., weekly or bi-weekly). Frame as a default that can be relaxed if there's no merged-to-main work that needs to ship.
- [ ] Note: this is the deepest root cause but the least scope-bounded one. Out of scope to *enforce* via this PR; in scope to *document* so the next investigator finds it.

### Phase 8: Backfill idempotency guards into existing migrations (low-priority DR hardening)

**Background**: agent 2 of round 4 inventoried ~35 of 87 migrations with at least one non-idempotent DDL pattern (no `IF NOT EXISTS`, no `OR REPLACE`, no `DROP CONSTRAINT IF EXISTS` predecessor). All have already applied successfully to production once. The risk is disaster-recovery / fresh-DB replay: replaying these migrations from scratch onto a partially-initialized DB could trip at any one of them and abort the queue.

- [ ] Top-10 trip-wires identified by agent 2 (priority order):
  - `supabase/migrations/20260324000001_entity_evolution_phase0.sql:17` — `ADD CONSTRAINT fk_runs_strategy` w/o `DROP IF EXISTS`
  - `supabase/migrations/20260131000006_content_eval_runs.sql:25` — `ADD CONSTRAINT fk_quality_scores_eval_run` w/o guard
  - `supabase/migrations/20260415000001_evolution_is_test_content.sql:35,51` — `ADD COLUMN` w/o `IF NOT EXISTS` + `CREATE TRIGGER` w/o `DROP IF EXISTS`
  - `supabase/migrations/20260323000003_evolution_metrics_table.sql:42,79` — `CREATE FUNCTION` w/o `OR REPLACE` + `CREATE TRIGGER` w/o guard
  - `supabase/migrations/20260508000006_evolution_variants_lineage_walker_array.sql:17` — `CREATE FUNCTION` w/o `OR REPLACE`
  - `supabase/migrations/20251221210716_link_candidates.sql:5` — `CREATE TYPE` (no native `IF NOT EXISTS`; needs `DO $$ … pg_type` guard)
  - (5 more — see round-4 agent-2 report for full list)
- [ ] Decide scope: retro-fit guards into all ~35 in a single sweep PR, OR file as a follow-up project and only retro-fit the top-10 now.
- [ ] Gold-standard template reference: `supabase/migrations/20260117173000_add_delete_status.sql` (textbook ADD COLUMN/ADD CONSTRAINT with guards) and `supabase/migrations/20260524000002_enforce_evolution_runs_explanation_fk_set_null.sql` (DO-block guards).
- [ ] Lower priority than Phase 4 (the lint) — Phase 4 stops new bad migrations; Phase 8 cleans the existing ones for DR safety. Acceptable to defer Phase 8 entirely if Phase 4 lands.

## Testing

### Unit Tests
- [ ] `src/config/__tests__/hostnames.test.ts` — confirm `classifyHost('explainanything-<hash>.vercel.app')` returns `unknown` (locks in the intentional strict-match behavior so future devs don't accidentally relax it).
- [ ] `scripts/lint-migrations-idempotent.test.ts` — sample SQL strings, both passing and failing cases (sibling test, matches existing `scripts/*.test.ts` convention).

### Integration Tests
- [ ] N/A — smoke + nightly are themselves the integration surface.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/smoke.public.spec.ts` — runs locally against `BASE_URL=https://explainanything.vercel.app` with bypass token; all 3 assertions pass.
- [ ] `src/__tests__/e2e/specs/smoke.evolution.spec.ts` — runs locally against `BASE_URL=https://ea-evolution.vercel.app`; dashboard + health pass.
- [ ] Tonight's nightly (2026-05-24 06:00 UTC) — verified in the morning via `gh run list --workflow=e2e-nightly.yml --limit=1`.

### Manual Verification
- [ ] `curl -I https://explainanything.vercel.app/` returns 200 (not 404).
- [ ] `curl -I https://ea-evolution.vercel.app/admin/evolution-dashboard` returns 200 (or 307 to auth).
- [ ] Open production Supabase SQL editor, run `\d evolution_prompts` — confirm `name` column, no `title`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A for migration / workflow changes. The two new smoke specs ARE the Playwright verification for the smoke split.

### B) Automated Tests
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm test -- src/config/__tests__/hostnames.test.ts`
- [ ] `npx playwright test --project=chromium --grep="@smoke-public"` against staging
- [ ] `npx playwright test --project=chromium --grep="@smoke-evolution"` against staging
- [ ] `gh run list --workflow=e2e-nightly.yml --limit=2 --json conclusion,createdAt` to confirm Cluster 1 stays green for 2 consecutive nights post-fix (checked next-morning, not live-watched)
- [ ] `gh run list --workflow=post-deploy-smoke.yml --limit=5` to confirm both matrix rows green on next deploy

## Local-vs-CI Parity Update (for Phase 2 smoke split)

- [ ] Add a new npm script `"test:e2e:smoke": "npx playwright test --grep='@smoke'"` to `package.json` so devs can run both smoke matrices locally pre-PR.
- [ ] Update the "Check Parity: Local vs CI" table in `docs/docs_overall/testing_overview.md` to add a `Smoke` row showing local `npm run test:e2e:smoke` mapping to the two CI matrix rows (`@smoke-public` + `@smoke-evolution`).
- [ ] Consider whether `/finalize`'s pre-PR check list should include `npm run test:e2e:smoke` for PRs that touch `src/__tests__/e2e/specs/smoke.*` — recommend yes, document in `/finalize` skill or in testing_overview.

## Documentation Updates
- [ ] `docs/feature_deep_dives/testing_setup.md` — note the smoke matrix split (public vs evolution greps) and the migration idempotency requirement.
- [ ] `docs/docs_overall/environments.md` — capture the lesson: production migrations gate on push-to-production, and any non-idempotent migration silently blocks the entire backlog. Also reference the new post-merge verification reminders in `mainToProd`/`finalize`. Document which Slack channel receives release alerts (Phase 6).
- [ ] `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/` — cross-link the smoke fallout findings as a postmortem appendix.
- [ ] `.claude/commands/mainToProd.md` — append post-release verification reminder (Phase 5; diff in this plan).
- [ ] `.claude/commands/finalize.md` — append post-merge verification reminder (Phase 5; diff in this plan).
- [ ] `docs/docs_overall/environments.md` — capture the release-cadence recommendation as a new subsection (Phase 7; co-located with deploy/migration narrative).

## Review & Discussion

### Plan-review loop result (3 iterations, consensus reached 2026-05-23)

| Iteration | Security & Technical | Architecture & Integration | Testing & CI/CD | Notes |
|---|---|---|---|---|
| 1 | 4/5 (2 critical) | 3/5 (3 critical) | 3/5 (7 critical) | 10 unique gaps consolidated and fixed |
| 2 | 4/5 (0 critical, 4 substantive minors) | 4/5 (2 critical) | **5/5** ✓ | 6 fixes applied (2 critical + 4 minor-but-real bugs) |
| 3 | **5/5** ✓ | **5/5** ✓ | **5/5** ✓ | All 3 reviewers consensus, 0 critical gaps, 0 minor issues |

### Iteration 1 critical gaps (resolved in iter-1 → iter-2)

1. Phase 5 `$PR_NUMBER` undefined → silent always-skip — added explicit `PR_NUMBER=$(gh pr view --json number -q .number)` capture with null-guard
2. Phase 5 insertion anchor wrong (referenced "Step 7" but actual mainToProd uses `### 7. Verify and Cleanup`) — re-anchored to `#### 7.5` inside the existing Verify and Cleanup section
3. Phase 2 `smoke.evolution.spec.ts` did not specify admin-auth fixture — would 403/redirect-loop in prod — now requires `adminTest` from `fixtures/admin-auth.ts` with `adminPage`
4. Phase 4 test file location `scripts/__tests__/` violated colocated-test convention — moved to `scripts/lint-migrations-idempotent.test.ts` (sibling)
5. Phase 4 didn't specify CI workflow integration — pinned to new `lint-migrations-idempotent` job in `.github/workflows/supabase-migrations.yml`
6. Phase 4 lint pattern coverage incomplete (missing `CREATE FUNCTION OR REPLACE`, `CREATE TRIGGER`, `ADD COLUMN`) — expanded to full 9-pattern table
7. Phase 4 emergency-bypass mechanism missing — added `migration-lint-bypass` PR label gated on CODEOWNERS review
8. Phase 6 alert-gate change would false-positive on workflow_dispatch cancels — gated on `github.event_name == 'schedule'` / `'deployment_status'` so only unattended cancels alert
9. Phase 2 verification didn't validate matrix grep matches non-zero tests (Playwright silent zero-test pass) — added `--list` pre-merge check + in-CI `count -eq 0` guard
10. Local-vs-CI parity gap for smoke specs — added `test:e2e:smoke` npm script + parity-table update

### Iteration 2 fixes (resolved in iter-2 → iter-3)

1. Phase 4 `needs: [validate-migrations, lint-migrations-idempotent]` referenced non-existent job — corrected: lint has no `needs:`, deploys add `needs: [lint-migrations-idempotent]`
2. Phase 5 finalize.md used `## Step 8.5` (h2) inside `### 8.` (h3) — corrected to `### Step 8.5` (h3 peer)
3. Phase 3 Playwright `selectOption({ label: /regex/ })` doesn't accept regex (runtime throw) — replaced with two options: stable string label `'gpt-4o-mini'` (preferred) or locator-then-select pattern
4. Phase 5 prose said "use `set -e` semantics" — internally contradictory with explicit `$?` capture — reworded to "fail-loud semantics: capture exit codes explicitly… (Do NOT use `set -e` — it would abort before the capture)"
5. Testing section line 320 still referenced `scripts/__tests__/...` — corrected to `scripts/lint-migrations-idempotent.test.ts`
6. Phase 7 doc home unresolved either/or — picked `docs/docs_overall/environments.md` with rationale (co-located with deploy/migration narrative)
7. `(PG 9.6+)` cosmetic qualifier — replaced with "Supabase runs PG 14+; supported everywhere"
8. Documentation Updates list updated to consistently point at `environments.md` for Phase 6/7 content

### Notes on minor issues NOT addressed (acceptable per all 3 reviewers)

- Phase 4: no unit test for bypass-label code path (lives in YAML, not script) — to be manually verified by applying the label to a throwaway PR with intentionally non-idempotent migration before flipping to error mode.
- Phase 4: warn-only-for-7-days rollout has no calendar reminder mechanism — implementer should set their own reminder when checking the box.
- Phase 5: banner shell snippet has no unit test — duplicated across two skills; if `gh pr diff` output format ever changes, both break silently. Acceptable risk for now; could be extracted to a tested helper script as a follow-up.
- Phase 3: `'gpt-4o-mini'` literal label couples test to a specific model — if model lineup ever drops gpt-4o-mini, test fails opaquely. Tracking comment added in the spec.
- Phase 4: bypass label gating relies on CODEOWNERS review for the label file — GitHub branch protection does NOT cover PR-label add/remove events, so anyone with write access can add the label. Documented limitation.
