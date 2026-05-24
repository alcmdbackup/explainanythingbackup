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
- [ ] Create `src/__tests__/e2e/specs/smoke.evolution.spec.ts` asserting `/admin/evolution-dashboard` 200s + renders + `/api/health` healthy, tagged `@smoke @smoke-evolution`.
- [ ] Delete or replace original `src/__tests__/e2e/specs/smoke.spec.ts`.
- [ ] Update matrix rows in `post-deploy-smoke.yml`: `public` row greps `@smoke-public`, `evolution` row greps `@smoke-evolution`.
- [ ] Open PR; verify next deployment produces 2 green smoke matrix rows.

### Phase 3: Land secondary nightly spec fixes
- [ ] `src/__tests__/e2e/specs/01-auth/auth-redirect-security.spec.ts` — add `@skip-prod` tag to the localhost-assertion test; update `e2e-nightly.yml` grep to exclude `@skip-prod` (or rely on existing exclusion if present).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-autorefresh-back-nav.spec.ts:33` — replace `await page.goForward()` with `await page.goto(<captured url>)` to side-step the `pageshow` race.
- [ ] `src/__tests__/e2e/specs/09-evolution-admin/evolution-strategy-wizard-tactics.spec.ts` — **fix, do not skip**. Two-line change applied to all 4 tests in the file:
  - Replace `genSelect.selectOption({ index: 1 })` (lines 12, 30, 56, 78) with `genSelect.selectOption({ label: /gpt-/i })` — removes the dropdown-hydration-order dependency that races under nightly load.
  - Bump the 10s/15s `waitForSelector('[data-testid="dispatch-plan-row-0"]', ...)` timeouts (lines 16, 32, 62) up to 30s, matching the already-hardened precedent on line 84. The dispatch-preview server-action slows under accumulated DB state; the existing comment on line 81-83 already documents this.
  - Rationale for fixing rather than skipping: the 62-day silent outage was caused by the "tolerate-the-flake" pattern compounding into red-test-blindness. The fix is mechanical and small (~8 lines total across 4 tests), well within scope of this PR.

### Phase 4: Migration idempotency lint (operational hardening)
- [ ] Add a script `scripts/lint-migrations-idempotent.ts` that scans `supabase/migrations/*.sql` and fails if it finds bare `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT`, `CREATE INDEX`, or `CREATE TYPE` without `IF NOT EXISTS` / `DROP … IF EXISTS` guards (or without `DO $$ … EXCEPTION WHEN duplicate_object`).
- [ ] Wire into CI as a required check on PRs touching `supabase/migrations/**`.
- [ ] Add a short note to `docs/feature_deep_dives/testing_setup.md` (or appropriate migrations doc) explaining the requirement and why.

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

Insert a new step **between the existing PR-mergeable verification (Step 7) and the existing exit/summary**, and append a Troubleshooting-section paragraph.

**New Step 7.5 — Migration detection + conditional warning** (insert into `.claude/commands/mainToProd.md` after the current Step 7):

````markdown
## Step 7.5: Migration-Present Warning (Conditional)

After confirming PR is mergeable, detect whether this PR touches any migration files:

```bash
MIGRATION_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep '^supabase/migrations/' || true)
MIGRATION_COUNT=$(echo "$MIGRATION_FILES" | grep -c '^supabase/migrations/' || true)
```

**If `MIGRATION_FILES` is empty** → skip this step. No warning needed. Proceed to exit.

**If `MIGRATION_FILES` is non-empty** → emit the following banner as the FINAL message to the user, after all other output. Substitute the placeholders inline:

```
================================================================================
!! POST-MERGE MIGRATION VERIFICATION REQUIRED !!
================================================================================

This PR ships <MIGRATION_COUNT> migration file(s):

<each MIGRATION_FILES path, one per line, indented 2 spaces>

After you merge this PR, you MUST run these commands to confirm migrations
applied successfully to production:

  MERGE_SHA=$(gh pr view <PR#> --json mergeCommit -q '.mergeCommit.oid')
  gh run list --workflow=supabase-migrations.yml --branch=production \
    --commit="$MERGE_SHA" --limit=1

EXPECTED: conclusion=success.

IF FAILURE: do NOT release further code until the migration is fixed. A non-
idempotent migration aborts the entire deploy queue and leaves prod app code
running against stale schema. Inspect logs with:
  gh run view <id> --log-failed

This exact scenario caused a 2-month silent prod-schema drift in May 2026.
See: docs/planning/smoke_test_and_nightly_e2e_failing_20260523/
================================================================================
```

Render the banner using a fenced code block in the chat output so the ASCII rules render verbatim and aren't reflowed.
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

Insert the parallel step into `.claude/commands/finalize.md`. The structure is identical to `mainToProd` but the verification command targets `--branch=main` (staging deploy) and the banner language adjusts to "staging" instead of "production" with a lower-urgency framing.

**New Step (insert after the existing PR-creation step, before the final Output section):**

````markdown
## Step N: Migration-Present Warning (Conditional)

After confirming the PR is open and CI green, detect whether this PR touches any migration files:

```bash
MIGRATION_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep '^supabase/migrations/' || true)
MIGRATION_COUNT=$(echo "$MIGRATION_FILES" | grep -c '^supabase/migrations/' || true)
```

**If `MIGRATION_FILES` is empty** → skip this step.

**If `MIGRATION_FILES` is non-empty** → emit the following banner as the FINAL message to the user:

```
================================================================================
!! POST-MERGE STAGING MIGRATION VERIFICATION REQUIRED !!
================================================================================

This PR ships <MIGRATION_COUNT> migration file(s):

<each MIGRATION_FILES path, one per line, indented 2 spaces>

After you merge to main, you MUST verify the staging migration workflow:

  MERGE_SHA=$(gh pr view <PR#> --json mergeCommit -q '.mergeCommit.oid')
  gh run list --workflow=supabase-migrations.yml --branch=main \
    --commit="$MERGE_SHA" --limit=1

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

Render the banner using a fenced code block so the ASCII rules render verbatim.
````

### Phase 6: Alerting hardening (small config tightening only)

**Background**: agent 4 of round 4 confirmed Slack alerts were firing for both workflows nightly for 62 days and Slack accepted them (`ok` response in logs). The channel went unread / muted. This is an organizational problem more than a config one — keep this phase narrow to two small config tightenings, no new workflows.

- [ ] Tighten failure gate in both workflows from `if: failure()` to `if: failure() || cancelled()` — currently a timeout or manual cancel produces no Slack alert.
  - File: `.github/workflows/e2e-nightly.yml` (notify step ~L190-219)
  - File: `.github/workflows/post-deploy-smoke.yml` (notify step ~L147-191)
- [ ] Have a human confirm the Slack webhook channel is actually monitored (unmute, set up keyword highlights, or pick a dedicated #release-alerts channel). Document the chosen channel name in `docs/docs_overall/environments.md`.

> **Deferred**: a daily-heartbeat workflow and auto-issue creation were considered and rejected for this PR — adds new infrastructure for marginal gain over the layered approach already in Phases 4 + 5. Revisit only if monitor-gap incidents recur after Phases 4 + 5 ship.

### Phase 7: Release cadence (organizational follow-up)

**Background**: production was frozen at 2026-03-05 schema AND app code for 2.5 months until today's PR #1073 release. The migration drift accumulated because there was no regular release cadence forcing the issue to surface. This phase is policy, not code — capture the lesson and leave the cadence-setting to the team.

- [ ] Add a short section to `docs/docs_overall/project_workflow.md` (or a new `release_cadence.md`) noting: "Production releases should happen at least every <agreed interval>. The longer prod sits frozen, the larger the migration backlog grows, and the higher the chance any one non-idempotent migration aborts the whole queue."
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
- [ ] `scripts/__tests__/lint-migrations-idempotent.test.ts` — sample SQL strings, both passing and failing cases.

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

## Documentation Updates
- [ ] `docs/feature_deep_dives/testing_setup.md` — note the smoke matrix split (public vs evolution greps) and the migration idempotency requirement.
- [ ] `docs/docs_overall/environments.md` — capture the lesson: production migrations gate on push-to-production, and any non-idempotent migration silently blocks the entire backlog. Also reference the new post-merge verification reminders in `mainToProd`/`finalize`. Document which Slack channel receives release alerts (Phase 6).
- [ ] `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/` — cross-link the smoke fallout findings as a postmortem appendix.
- [ ] `.claude/commands/mainToProd.md` — append post-release verification reminder (Phase 5; diff in this plan).
- [ ] `.claude/commands/finalize.md` — append post-merge verification reminder (Phase 5; diff in this plan).
- [ ] `docs/docs_overall/project_workflow.md` or new `docs/docs_overall/release_cadence.md` — capture the release-cadence recommendation (Phase 7).

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
