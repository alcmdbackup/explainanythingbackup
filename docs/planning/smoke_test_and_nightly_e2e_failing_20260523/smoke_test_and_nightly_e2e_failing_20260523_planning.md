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
- [ ] Watch tonight's 2026-05-24 06:00 UTC nightly (`gh run watch` on `e2e-nightly.yml`). If green or only failing on the 3 known-secondary issues → Cluster 1 fix confirmed.

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
- [ ] Leave `evolution-strategy-wizard-tactics.spec.ts` untouched; flag for follow-up DB-state stabilization ticket.

### Phase 4: Migration idempotency lint (operational hardening)
- [ ] Add a script `scripts/lint-migrations-idempotent.ts` that scans `supabase/migrations/*.sql` and fails if it finds bare `CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT`, `CREATE INDEX`, or `CREATE TYPE` without `IF NOT EXISTS` / `DROP … IF EXISTS` guards (or without `DO $$ … EXCEPTION WHEN duplicate_object`).
- [ ] Wire into CI as a required check on PRs touching `supabase/migrations/**`.
- [ ] Add a short note to `docs/feature_deep_dives/testing_setup.md` (or appropriate migrations doc) explaining the requirement and why.

## Testing

### Unit Tests
- [ ] `src/config/__tests__/hostnames.test.ts` — confirm `classifyHost('explainanything-<hash>.vercel.app')` returns `unknown` (locks in the intentional strict-match behavior so future devs don't accidentally relax it).
- [ ] `scripts/__tests__/lint-migrations-idempotent.test.ts` — sample SQL strings, both passing and failing cases.

### Integration Tests
- [ ] N/A — smoke + nightly are themselves the integration surface.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/smoke.public.spec.ts` — runs locally against `BASE_URL=https://explainanything.vercel.app` with bypass token; all 3 assertions pass.
- [ ] `src/__tests__/e2e/specs/smoke.evolution.spec.ts` — runs locally against `BASE_URL=https://ea-evolution.vercel.app`; dashboard + health pass.
- [ ] Tonight's nightly (2026-05-24 06:00 UTC) — observed via `gh run watch`.

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
- [ ] `gh run watch <nightly-run-id>` to confirm Cluster 1 stays green for at least 2 consecutive nights post-fix
- [ ] `gh run list --workflow=post-deploy-smoke.yml --limit=5` to confirm both matrix rows green on next deploy

## Documentation Updates
- [ ] `docs/feature_deep_dives/testing_setup.md` — note the smoke matrix split (public vs evolution greps) and the migration idempotency requirement.
- [ ] `docs/docs_overall/environments.md` — capture the lesson: production migrations gate on push-to-production, and any non-idempotent migration silently blocks the entire backlog.
- [ ] `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/` — cross-link the smoke fallout findings as a postmortem appendix.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
