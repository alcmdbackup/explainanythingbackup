# Phase 2 Results

<!-- Per-option investigation findings + projected annual savings. Drives Phase 3 decision per savings-threshold rule. -->

## Baseline (anchors all comparisons)

- **Repo**: `Minddojo/explainanything` (private)
- **GitHub plan**: Team ($4/user/month, 3,000 free Actions min/month)
- **June 2026 actual billing**: $56.46 gross − $18.50 free-tier discount = **$37.96 net/month** = **~$455/yr**
- **Estimated monthly billable minutes**: ~9,400 min
- **Largest cost driver**: `e2e-evolution` job in `ci.yml` (~16.5 billable min per PR-to-main full-path CI run)

## Savings-threshold rule (from planning doc Phase 2)

| Projected savings | Action |
|---|---|
| ≥ $200/yr | STOP Phase 2 → Phase 3 |
| $50–200/yr | Run ONE more step, then re-evaluate |
| < $50/yr | STOP Phase 2 → document "do nothing" |

---

## Option I — Workflow cleanup ✅ COMPLETE

### I.1 — Remove `deployment_status` trigger from `post-deploy-smoke.yml`

**Status**: ✅ complete — safe to remove

**Findings**:
- Workflow header comment already documents trigger as "currently inert" — GitHub anti-recursion drops `GITHUB_TOKEN`-created Vercel deployment statuses
- `push: [production]` trigger covers every real prod release via `/mainToProd` → reliable single source of truth
- 14d sample: 870 runs, 831 (95.5%) skipped via the `if:` filter
- Concurrency group keyed on `github.ref` still works post-removal (push:[production] gives a single ref)
- Slack notification logic (line 201) references `github.event_name == 'deployment_status'` for the cancelled-unattended path — simplifies to just `push` after removal

**Projected savings**: ~**$6/year** direct ($0.50/month of dispatch waste eliminated). Bigger value: 95.5% noise removal from Actions tab.

**Action proposed**: edit `post-deploy-smoke.yml` to remove `deployment_status:` from `on:`, simplify the `if:` condition, simplify Slack notify condition, update header comment.

### I.2 — Free up GitHub Actions cache headroom

**Status**: ✅ complete — major win identified

**Findings**:
- Current cache: 9.91 GB / 87 entries (essentially at the 10 GB cap → constant eviction)
- 20 unique PRs have caches; **19 are MERGED or CLOSED**, only PR #1310 is OPEN
- **Reclaimable: 8.64 GB across 79 entries** (PR-scoped from closed/merged PRs)
- **Stale main-branch entries**: 2 entries totaling 360 MB (`playwright-Linux-1.56.1-chromium` from 2025-12-20, `playwright-Linux-1.56.1-firefox` from 2026-01-08 — firefox was retired 2026-06-12)
- **Keep**: 2 active main caches (485 MB), 4 caches on open PR #1310 (~470 MB)
- After cleanup: ~960 MB used, ~9 GB headroom

**Projected savings**: ~**$31/year**. Cache cap pressure causes E2E Critical to miss cache ~55% of the time (see I.4). Eliminating eviction returns ~25-30 sec per affected job invocation. Rough computation: 50 PRs/month × 3-5 pushes × 8 e2e-flavor jobs × 20% baseline miss → 300 invocations affected × ~85 sec saved → 425 min/month → ~$2.55/month → **~$31/year**.

**Action proposed**: bulk-delete the 79 closed-PR cache entries + 2 stale main-branch entries via `gh api -X DELETE` with dry-run preview first.

### I.3 — Audit `detect-changes` classifier

**Status**: ✅ complete — small refactor opportunity

**Findings**:
- Sample of last 50 merged PRs to `main`, reclassified per current ci.yml rules:
  - **41 full** (82%)
  - 8 evolution-only (16%)
  - 1 fast (2%)
  - 0 non-evolution-only
- Of the 41 full paths: **36 triggered by `shared_file_match`** (the broad `src/lib/` regex), 4 by `mixed_evo_nonevo`, 1 by `migration_only`
- Author has intentionally accepted SHARED-before-EVOLUTION_ONLY ordering (per ci.yml:74 comment about llmSpendingGate being "dead-code addition")
- Many `shared_file_match` PRs touched a single file under `src/lib/services/` that COULD be evolution-only (e.g. `src/lib/services/llms.ts` is used by evolution-only paths in most PRs)
- Refactor lever: (a) check EVOLUTION_ONLY before SHARED, OR (b) narrow SHARED's `src/lib/` segment to only truly cross-cutting subpaths

**Projected savings**: **$10-30/year**. Per-PR savings from reclassifying full→evolution-only is ~7 billable min (skip e2e-critical + integration-critical non-evolution jobs). At 50 PRs/month × ~40% reclassifiable rate × 7 min = 140 min/month savings, but this is the optimistic case; conservative estimate is half.

**Action proposed**: a separate PR to add an audit script + narrow SHARED in stages with per-file safety checks. NOT trivial — defer to Phase 3 decision.

### I.4 — Playwright browser cache hit rate

**Status**: ✅ complete — confirms I.2 finding

**Findings**:
- Sample of 20 recent CI runs (40 Playwright-using jobs):
  - **E2E Critical: 55% miss rate** (11 miss / 9 hit) — exceeds 30% threshold
  - E2E Evolution: 0% miss rate (20/20 hit)
- Root cause: cache cap pressure (I.2) AND key-fragmentation between jobs
- E2E Critical key: `playwright-${runner.os}-${version}`
- E2E Evolution key: `playwright-${runner.os}-${version}-${matrix.browser}` (always `-chromium` since matrix is single-row)
- Two different cache entries → ~360 MB extra footprint, no sharing between jobs

**Projected savings**: ~**$1/year** direct from key alignment. The real benefit: enables I.2's full ~$31/year savings to materialize.

**Action proposed**: drop `-${{ matrix.browser }}` segment from `e2e-evolution` and `e2e-non-evolution` Playwright cache keys. Single-line YAML edit.

### I.5 — `evolution-tracking-reconciliation` schedule

**Status**: ✅ complete — leave as-is

**Findings**:
- 4 runs in 14d × 60 sec each = ~9 min/month = **$0.62/year current cost**
- Reducing daily → weekly saves <$1/year and risks delayed detection of write-path regression (the workflow is intentionally RED until layer 1/2 deployed everywhere)

**Projected savings**: $0. No action.

### I.6 — `pull_request` trigger audit

**Status**: ✅ complete — no redundancy found

**Findings**:
- 11 workflows surveyed; trigger distribution: 1 PR-only (ci.yml), 1 push+PR (supabase-migrations.yml), 1 push+manual+deployment_status (post-deploy-smoke.yml — I.1 will trim it), 6 schedule+manual (nightly + evolution monitors), 1 manual-only (verify-seed-reuse)
- supabase-migrations.yml's PR trigger gates lint-only; deploy jobs gate on push event. Correct.
- No over-firing or misconfigured triggers detected

**Projected savings**: $0. No action.

### Option I total projected savings: **~$48-68/year**

| Sub-item | Savings | Effort | Risk |
|---|---:|---|---|
| I.1 remove deployment_status | $6 | 5 min | None — documented dead trigger |
| I.2 free cache (delete 79+2 entries) | $31 | 15 min | None — only removes closed-PR / stale entries |
| I.3 narrow classifier SHARED | $10-30 | 1-2 hrs (per-file analysis) | Medium — could under-classify shared files |
| I.4 align Playwright cache keys | $1 (enables I.2) | 5 min | None — keys converge on existing scheme |
| I.5 reconciliation cadence | $0 | — | — |
| I.6 trigger audit | $0 | — | — |
| **Subtotal** | **$48-68** | | |

---

## Savings-threshold checkpoint after Option I

Projected so far: **~$48-68/year**.

- < $50/yr → STOP, do nothing? **NO** — we're at or slightly above the floor
- $50-200/yr → run ONE more step → **YES, this applies**
- ≥ $200/yr → STOP, go to Phase 3 → not yet

**Decision**: proceed to next step in recommended order = **Option E (GitHub ARM runners)**. Re-evaluate threshold after.

---

## Option E — GitHub ARM runners

**Status**: pending

---

## Option A — Enterprise plan check

**Status**: pending

---

## Options B / C / D / F — vendor pilots

**Status**: not yet started; gated by savings-threshold rule
