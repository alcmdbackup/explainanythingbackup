# Investigate Cheaper Faster CI Plan

<!-- Implementation plan for evaluating and (optionally) adopting a cheaper/faster CI setup. -->

## Background
Investigate ways to save on GitHub Actions cost. Per-month spend on Actions for the `Minddojo` org is **~$56/month gross, ~$38/month net** after the GitHub Team plan's 3,000 free-min discount — i.e. **~$455/year billable**. The repo is private (`Minddojo/explainanything`) and we're on GitHub Team ($4/user/month). The single largest cost driver is the `e2e-evolution` job in `ci.yml` (~16.5 min billable per PR-to-main CI run). At this volume both vendor-swap and plan-upgrade paths show **~$250/year savings**, with combined moves potentially reaching $370+/year — material enough to warrant a real investigation, modest enough that we should not over-engineer.

## Requirements (from GH Issue #1309)
Look into Blacksmith pricing (https://www.blacksmith.sh/pricing) and other options:
- Blacksmith / Depot / BuildJet / RunsOn / Ubicloud / WarpBuild (managed drop-in GHA runners)
- Self-hosted on existing minicomputer or cheap cloud VMs (Hetzner)
- GitHub larger runners (4-core / 8-core) and ARM runners
- GitHub plan tier change (Team → Enterprise)
- Workflow-level optimizations (change detection, sharding, cache reuse, dropping redundant runs)

For each option, capture:
- $/min vs GitHub-hosted x64 2-core ($0.006/min)
- Speedup vs GitHub-hosted (claimed and observed)
- Setup effort + lock-in / blast radius
- Compatibility caveats (secrets, Docker, Playwright, supabase migrations)
- Annual savings estimate at our measured 9,400 billable min/month

## Problem
Today the project runs all CI on GitHub-hosted `ubuntu-latest`. Real billing (June 2026) is **$56.46 gross / $37.96 net per month** = **~$455/year**. The first investigation pass (research doc) under-estimated this by 3.4× because (a) the 14-day workflow-run sample hit GitHub API's 1000-row pagination cap and (b) the job-fanout multiplier was conservative. We now have ground truth from the billing page. Several paths could meaningfully reduce that spend, but each comes with different trade-offs (vendor lock-in, plan-tier change, ops burden, real-vs-claimed speedup), so we want to **measure before committing**.

## Options Considered
All options remain on the table for Phase 2 evaluation — none are pre-eliminated.

- [ ] **Option A: Upgrade GitHub plan Team → Enterprise** — Single-line change ($4 → $21/user/month) raises free-min ceiling from 3,000 to 50,000/month. At current usage, this swallows ALL overage. Net: **+$17/user/mo plan cost, –$37.96/mo overage = $251/yr saved**. Zero implementation risk. Caveat: confirm no minimum-seat requirement.
- [ ] **Option B: Blacksmith drop-in (`runs-on: blacksmith-*`)** — $0.004/min (33% per-min cheaper) + claimed 2× speedup. If real, ~$370/yr saved on Team plan. If only 1.3× speedup lands (realistic for IO-bound work), savings drop to ~$250/yr. Vendor lock-in is light (single `runs-on:` line).
- [ ] **Option C: Depot managed runners + remote build cache** — Same $0.004/min, no explicit speedup claim for GHA runners, but build-cache add-on ($0.20/GB/mo) could help Next.js / Playwright cold starts. Higher integration cost than Blacksmith.
- [ ] **Option D: BuildJet** — Same $0.004/min, claims "half the price of GitHub" (true vs the old $0.008 rate — only 33% true vs current $0.006). No bundled speedup story.
- [ ] **Option E: GitHub ARM runners (`runs-on: ubuntu-24.04-arm`)** — Same vendor, $0.005/min (17% cheaper). Zero new dependency, no PAT/secret/IP change. Package-lock already includes ARM SWC binaries; no `sharp`/`canvas`/`bcrypt` to worry about. **Lowest-risk experiment in the lineup.**
- [ ] **Option F: GitHub larger runners (4-core / 8-core x64)** — $0.012/min and $0.022/min respectively. Only net-positive when wall-clock drop > per-min cost increase. Likely a loss on our IO-bound E2E jobs, possibly a win on CPU-bound `npm run build` / tsc.
- [x] ~~**Option G: Self-hosted runner on existing minicomputer**~~ — **DROPPED 2026-06-28.** Reasoning: (a) evolution workloads grow; CI on the same host = one busy experiment-run away from intermittent failures, (b) self-hosted GHA runners + any future fork PR = supply-chain attack surface, (c) shared disk/memory with evolution worktrees and maintenance-scheduler tmux jobs, (d) no auto-pull mechanism per memory `project_minicomputer_no_auto_pull`. Annual savings (~$455 best case) doesn't justify the ongoing ops risk vs Options A / B / E which capture the same or more savings with vastly lower blast radius.
- [ ] **Option H: Self-hosted on cheap cloud VM (Hetzner CCX13 / similar)** — ~$15/month fixed for 4 vCPU / 16 GB RAM. Predictable cost, full control. Ops burden: security patches, runner registration, autoscaling for matrix jobs.
- [ ] **Option I: Workflow-level cleanup (no vendor or plan change)** — Several concrete wins identified in research:
  - Remove `deployment_status` trigger from `post-deploy-smoke.yml` (831/870 skipped runs in 14d)
  - Free up cache headroom (10.6 GB / 88 entries, at/over the 10 GB cap)
  - Audit fast-path classifier for unnecessary full-path triggers
  - Validate Playwright browser cache hit rate
  Likely 10–25% gross-cost reduction with zero vendor risk.
- [ ] **Option J: Hybrid combinations** — e.g. Enterprise plan + workflow cleanup; OR Team + ARM + workflow cleanup; OR Team + Blacksmith for the highest-cost job only + GitHub-hosted everything else. Phase 3 will combine the best Phase 2 wins.

## Phased Execution Plan

### Phase 1: Baseline measurement
*(Largely complete — captured in research doc. Remaining items are precision improvements.)*

- [x] Pull 14-day workflow-run baseline via `gh api` (hit 1000-row cap; need broader window)
- [x] Confirm repo is private (`Minddojo/explainanything` → `visibility: private`)
- [x] Confirm GitHub plan tier (**GitHub Team, 3,000 free min/mo**)
- [x] Capture real billing from org billing page (**$56.46 gross / $37.96 net for June 2026**)
- [x] Identify top cost driver (**`e2e-evolution` job, ~16.5 min billable per PR-to-main CI run**)
- [ ] Pull EXACT 30-day billable minutes per workflow via per-run timing endpoint — needs PAT with `Administration: Read` on the repo to get non-zero billing data. Output CSV to `_baseline.csv`.
- [ ] (Optional) Identify the 5 longest CI jobs by p95 duration over the 30-day window — informs which jobs benefit most from a faster runner vs which are IO-bound and won't.

### Phase 2: Per-option deep investigation (do NOT commit yet)
*This is the heart of the project. Each option gets a small scoped investigation; results feed Phase 3 decision.*

#### Shared protocols (used by all Option B/C/D/E/F pilots)

**Pilot measurement protocol** — every vendor/runner-swap pilot must:
- Pin to a **single stable SHA** — use the last-green `main` commit at Phase 2 start; record the SHA in `_phase2_results.md`
- Run **10 trials on the alt runner** + **10 control trials on `ubuntu-latest`** (same SHA, same workflow file modulo the `runs-on:` line). Without a control arm we cannot distinguish "vendor speedup" from "GitHub-hosted load dipped that hour."
- Schedule trials so alt + control alternate (interleave, not back-to-back) — defeats time-of-day variance in GitHub-hosted load
- Record per-trial: wall-clock duration, billable minutes (per-job timing endpoint), conclusion (success/failure/cancelled), Playwright `flaky` count from the JSON reporter
- Report p50, p95, and standard deviation — single-sample comparisons are noise
- **Inter-job needs caveat**: pilots that flip ONE job's `runs-on:` are testing that job in isolation. The wall-clock measurement captures only that job; if it's deep in a `needs:` chain (e.g. e2e-* depend on unit-tests → typecheck/lint), the end-to-end CI wall-clock improvement is bounded by the slowest job in its critical path, not by this one job's improvement.

**Secret-propagation verification protocol** — every pilot must:
- Use a **non-leaking presence check**, NEVER `env | grep` or `echo "$SECRET"`. Acceptable form:
  ```bash
  for V in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENAI_API_KEY ANTHROPIC_API_KEY \
           DEEPSEEK_API_KEY OPENROUTER_API_KEY PINECONE_API_KEY PINECONE_INDEX_NAME_ALL \
           PINECONE_NAMESPACE TEST_USER_EMAIL TEST_USER_PASSWORD TEST_USER_ID; do
    if [[ -n "${!V}" ]]; then echo "$V: present"; else echo "$V: MISSING"; fi
  done
  ```
- Verify GitHub Environment-scoped secrets resolve correctly: a pilot job using `environment: staging` must see staging secrets even when the runner is third-party (Environments scope secrets by environment, not by runner)
- Reference list of expected secrets: environments.md "GitHub Secrets" section (12+ secrets per environment; ~23 unique names across repository + staging + Production)

**Secret-rotation policy** — after a pilot completes:
- If the pilot **succeeded and we adopt the vendor**, rotate any high-blast secret that cannot be revoked from the vendor's audit log. High-blast = `SUPABASE_SERVICE_ROLE_KEY` (full DB write), `*_API_KEY` for paid providers. Low-blast = `TEST_USER_PASSWORD` (test user only).
- If the pilot **failed**, still rotate if there's any evidence the vendor's logs are persistent or world-readable, OR if vendor support staff have audit-log read access
- Document rotation in `_phase2_results.md`; this is operational work that needs visibility

#### Recommended Phase 2 order
Do the free / instant-revert wins first so we know the post-cleanup baseline before paying for any vendor relationship. Each step's findings may reorder the rest — treat as a default, not a contract.

| # | Step | Why this slot | Time est |
|---:|---|---|---:|
| 1 | **Option I — workflow cleanup** | Pure code review; zero account/vendor risk; stacks with every other path. Drops the baseline that Options A/B/E are evaluated against. | 1–2 hrs |
| 2 | **Option E — GitHub ARM** | One-line `runs-on:` change, same vendor, instant revert; 17% per-min savings even with zero speedup. | 30 min + watch 5 PRs |
| 3 | **Option A — Enterprise plan check** | Verify single-seat availability + month-to-month billing. Don't commit yet — just confirm the option is real. | 15 min |
| 4 | **Option B — Blacksmith pilot** | Account creation + 10 trial runs on `e2e-evolution`. Gives us the speedup-vs-claim ground truth. | 1–2 hrs setup + 1 day of trial runs |
| 5 | **Option C — Depot pilot** | Only if Blacksmith underperforms OR we want a second data point. | 1 hr |
| 6 | **Option F — GitHub larger runners** | Only if Blacksmith/Depot don't pan out and we want an all-GitHub solution. | 30 min |
| 7 | **Options D (BuildJet) / H (Hetzner)** | Skip unless 1–6 all flake. Diminishing returns. | — |
| — | **Option J — hybrids** | Compute after 1–6 yield data; not a standalone investigation. | — |

After steps 1–3 we likely have enough data for a defensible Phase 3 decision without proceeding to vendor pilots (steps 4+). Stop early per the savings-threshold rule below.

#### Phase 2 savings-threshold early-exit (anti-yak-shaving)
After each Phase 2 step completes, compute the **best projected annual savings from any single path or stacked combination identified so far**. Then apply:

| Projected savings | Action |
|---|---|
| ≥ **$200/yr** | **STOP Phase 2.** Skip remaining steps. Go to Phase 3 decision. |
| **$50–200/yr** | Run ONE more step from the recommended order, then re-evaluate against this same table. |
| < **$50/yr** | **STOP Phase 2.** Document "do nothing" in `_decision.md`. Don't grind for marginal wins. |

The $200 floor is ~40% of the best-case savings (~$500/yr); declaring victory at that level beats spending another week chasing an extra $100. The $50 floor catches the case where the investigation is itself net-negative — a single hour of engineering time costs more than that, so further work is value-destroying.

Reminder: yak-shaving and completionism are the failure modes this rule exists to prevent. If you find yourself running step 5+ "because it's in the plan," stop and re-read this table.

#### Option A — Enterprise upgrade evaluation
- [ ] Open https://github.com/organizations/Minddojo/settings/billing/plans and screenshot/transcribe what's shown for Enterprise Cloud upgrade
- [ ] Confirm Enterprise Cloud has **no minimum seat count** for new customers (was 50-seat; relaxed around 2023–2024 per public docs)
- [ ] Confirm billing model: month-to-month vs annual-only (some plans force annual invoice — could complicate cancellation if it doesn't work out)
- [ ] Note any feature surprises (SAML SSO requirement? Audit log export forced on? Migration UX from Team?)
- [ ] Exit criterion: GO if month-to-month available + no seat minimum + no forced governance reconfig. NO-GO if any of those bite.

#### Option B — Blacksmith pilot
- [ ] Create a throwaway Blacksmith account; sign up at https://www.blacksmith.sh
- [ ] On a feature branch, change `runs-on: ubuntu-latest` → `runs-on: blacksmith-2vcpu-ubuntu-2204` on **just the `e2e-evolution` job** (the highest cost driver)
- [ ] Apply pilot measurement protocol (see "Pilot measurement protocol" subsection below) — 10 runs on alt runner + 10 control runs on `ubuntu-latest`, same SHA
- [ ] Measure: wall-clock p50 / p95, total billable min, success/fail rate (vendor flake), Playwright result diff vs GitHub-hosted control
- [ ] Verify Docker-in-Docker still works for the `migration-verify-test` job (try on a second branch). Note: `migration-verify-test` pre-pulls `postgres:15-alpine` with a retry loop (ci.yml:301-308); alt runner Docker daemon warmup may interact with that retry budget.
- [ ] Verify Rule 21 contract still holds on alt runner: dedicated `npm run build` step completes within its existing timeout AND start-only `npm start` webServer comes up within 120s (see testing_overview.md Rule 21)
- [ ] Verify secret propagation using the non-leaking presence check (see "Secret-propagation verification protocol" subsection below) — do NOT `env | grep` or `echo "$SECRET"`
- [ ] Verify GitHub Environment scoping still works: the job has `environment: staging`, so staging-scoped secrets must resolve when the runner is third-party
- [ ] Exit criterion: GO if observed speedup ≥ 1.3× (vs control arm, not vs marketing claim) AND new-flake rate ≤ control flake rate + 5pp AND all secrets/Docker/Rule-21 verifications pass. Compute projected $/yr at observed speedup. NO-GO if speedup < 1.2× or any compatibility break.
- [ ] Post-pilot: rotate any secret that was deemed "high-blast" if it cannot be revoked from Blacksmith's audit log (see "Secret-rotation policy" subsection below)

#### Option C — Depot pilot
- [ ] Same shape as Blacksmith pilot (including pilot-measurement protocol, secret-propagation protocol, Rule 21 verification, secret-rotation post-pilot) but with `runs-on: depot-ubuntu-24.04`
- [ ] Additionally evaluate Depot's build-cache offering — does it speed up `npm ci` + Playwright browser install enough to justify the $0.20/GB/mo?
- [ ] Exit criterion: same as Blacksmith. Compare head-to-head with Blacksmith pilot results.

#### Option D — BuildJet pilot
- [ ] Decide whether to pilot — if Blacksmith and Depot both show good numbers, skip BuildJet (diminishing return). If one or both flake, pilot BuildJet as a third option.

#### Option E — ARM runner test (lowest risk, do first)
- [ ] On a feature branch, change `runs-on: ubuntu-latest` → `runs-on: ubuntu-24.04-arm` on **just the `lint` and `typecheck` jobs** first (simplest, no Docker, no Playwright)
- [ ] If those pass cleanly, extend to `unit-tests` and `integration-critical`
- [ ] Then try `e2e-critical` (Playwright). Note: Playwright supports ARM Chromium; confirm browser binaries install cleanly
- [ ] Verify `migration-verify-test` Docker-in-Docker works on ARM (Postgres image multi-arch — should)
- [ ] Exit criterion: GO if all jobs pass + observed runtime within 20% of x64. Even no-speedup is a 17% per-min win.

#### Option F — GitHub larger runners (4-core, 8-core)
- [ ] On a feature branch, change `runs-on: ubuntu-latest` → `runs-on: linux_4_core` on `e2e-evolution` (the biggest job)
- [ ] Trigger 5 times; compare wall-clock to baseline
- [ ] Compute: did wall-clock drop by ≥ 2× (the per-minute cost ratio)? If yes, 4-core is net cheaper for that job.
- [ ] Repeat for 8-core if 4-core shows speedup
- [ ] Exit criterion: GO for any job where wall-clock ratio > cost ratio (e.g. 4-core needs ≥ 2× speedup; 8-core needs ≥ 3.7× speedup)

#### ~~Option G — Self-hosted on minicomputer~~
**DROPPED 2026-06-28.** See Options Considered for reasoning.

#### Option H — Cheap cloud VM (Hetzner)
- [ ] Estimate provisioning cost: Hetzner CCX13 (4 vCPU / 16 GB) is ~$15/month; CAX11 ARM (4 vCPU / 8 GB) is ~$5/month
- [ ] Estimate ops cost: how many hours/year to maintain (security patches, runner registration rotation, autoscaling for matrix jobs)?
- [ ] Compare: $15/mo VM + ops time vs current $38/mo overage. Only worth it if (a) VM can host 4+ parallel runners (matrix jobs!) AND (b) ops time is < 1 hr/month.
- [ ] Same fork-PR security mitigation requirement as Option G

#### Option I — Workflow-level cleanup
This is independent of any runner/plan change; the wins apply to all paths. Sub-investigations:

- [ ] **I.1** Remove `deployment_status` trigger from `post-deploy-smoke.yml`. Per environments.md it's documented as an inert secondary that GitHub anti-recursion already drops; 95.5% of its runs are skipped. Cite `post-deploy-smoke.yml:9-12` (the `push: [production]` trigger that replaces it) in the commit message so a future contributor doesn't remove both. Measure: how many "skipped" runs disappear from the Actions tab after removal? Verify the `concurrency:` group on that workflow (post-deploy-smoke.yml:14) still serves a purpose under the surviving trigger.
- [ ] **I.2** Free up GitHub Actions cache headroom. Current state: 10.6 GB / 88 entries.
  - Run `gh api repos/Minddojo/explainanything/actions/caches?per_page=100 --paginate` and identify (a) oldest entries (b) entries from deleted/stale branches
  - Generate a **dry-run preview** first: pipe candidate keys through `xargs -I{} echo "WOULD DELETE: {}"` before any actual `gh api -X DELETE`
  - **Caution**: do NOT delete entries matching `nextjs-cache-Linux-` prefix (the `restore-keys` fallback for `.next/cache`) without confirming they're stale — aggressive deletion forces cold Next.js builds across all subsequent runs, briefly inflating cost before it deflates
  - Target: <5 GB / <30 entries
- [ ] **I.3** Audit the `detect-changes` classifier in `ci.yml:30-78`.
  - **Concrete output**: produce a decision table — for each of the 5 routes (`fast`, `full`, `evolution-only`, `non-evolution-only`, `has_migrations`) list which jobs gate on it and what files trigger it. Save as `_phase2_classifier_audit.md`.
  - **Sample**: take the last 50 merged PRs; reclassify each based on its actual changed-files list and the current classifier rules. Count false-positive `full` paths.
  - **Exit criterion**: identify ≥1 reclassifiable route OR document "current classifier is optimal" with the sample's evidence
- [ ] **I.4** Validate Playwright browser cache hit rate. Sample 20 recent CI runs; count how often the `Install Playwright browsers` step ran (cache miss) vs `Install Playwright deps` (cache hit). If miss rate > 30%, the cache key (`playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}-${{ matrix.browser }}`) is too narrow — likely fix: drop the matrix.browser segment since we only use chromium.
- [ ] **I.5** Audit `evolution-tracking-reconciliation` schedule. It's intentionally RED until the write path is deployed everywhere, but it's failing 100% currently. Check if any of those failures could be downgraded to a single nightly run instead of being on the daily critical-path.
- [ ] **I.6** Look for jobs that don't need to run on `pull_request` triggers (e.g. some lint gates could be `push` only or vice-versa).

#### Option J — Hybrid combinations (compute after A–I are evaluated)
- [ ] Build a combination matrix in `_phase2_results.md`: rows = options, columns = (cost/yr, speedup observed, implementation effort, risk score). Then identify the best 2-option and 3-option combinations.
- [ ] Most promising a priori: **Enterprise + workflow cleanup**; **Team + ARM + workflow cleanup**; **Team + Blacksmith for e2e-evolution only + workflow cleanup**.

### Phase 3: Decision
*Compare Phase 2 evidence; select winning path (or combination).*

- [ ] Write `_decision.md` in this project folder: chosen path(s), measured savings, reasons rejected options were rejected
- [ ] Get explicit user sign-off before any production-affecting change (vendor account creation, plan upgrade, etc.)
- [ ] If the decision is "do nothing" (e.g. observed speedup didn't materialize, Enterprise has unacceptable lock-in), DOCUMENT WHY — this becomes a forever-reference for the next time this question comes up

### Phase 4: Pilot rollout
*Only after Phase 3 has selected a specific change.*

- [ ] Apply chosen change to ONE highest-impact job first (likely `e2e-evolution`)
- [ ] Monitor the next 10 real PRs that exercise that job
- [ ] Compare wall-clock + failure-rate vs the prior 10 PRs on `ubuntu-latest` (use `gh run list` + jq aggregation)
- [ ] **Required-checks re-mapping**: a `runs-on:` swap can rename matrix-expanded job IDs in the check-runs API and silently break branch protection. Before merging the Phase 4 change:
  - Enumerate required checks: `gh api repos/Minddojo/explainanything/branches/main/protection --jq '.required_status_checks.contexts'`
  - Compare against post-swap job names; if any drifted, update branch protection via `gh api -X PATCH` (admin scope required — likely needs user action)
  - Repeat for `production` branch protection
- [ ] **Concrete rollback criteria** — if any of these triggers fire within the 2-week window, revert via PR within 24h:
  - Failure rate on the migrated job over rolling 10 PRs exceeds GitHub-hosted baseline + 5pp
  - p95 wall-clock regresses > 10% vs GitHub-hosted baseline
  - Vendor incident reported (status page) causes ≥ 2 consecutive blocked merges
  - Cost reading from next billing cycle is ≥ baseline (i.e. didn't actually save)
- [ ] **Rollback mechanism**: prepare a one-line revert PR template in `docs/planning/investigate_cheaper_faster_ci_20260628/_rollback_pr_template.md` with the `runs-on:` reversal and a placeholder for "Trigger: <criterion>". Owner: project author (single-user repo per Q1 resolution). Decision deadline: 14 days after Phase 4 start.

### Phase 5: Full rollout
*Only after Phase 4 shows stable improvement.*

- [ ] Migrate remaining workflows in order of cost-per-month descending
- [ ] **Re-verify required-checks** after each workflow migration (same `gh api` enumeration from Phase 4)
- [ ] Update `docs/docs_overall/environments.md` GitHub Actions section
- [ ] **Manually update `docs/docs_overall/testing_overview.md`** — workflow YAML edits do NOT auto-surface this doc via `.claude/doc-mapping.json` (mapping only triggers on `tests/e2e/**` edits, not on workflow changes). Rule 21 references and CI workflow comparison tables (lines 305-320) need manual review.
- [ ] Add a monthly cost-report script under `scripts/check-actions-cost.ts`:
  - **Where it runs**: new lightweight workflow `.github/workflows/actions-cost-report.yml` on a monthly cron (1st of month, 00:00 UTC); single-runner ~30 sec; negligible billing impact
  - **What it does**: pulls per-workflow billable min via `gh api repos/.../actions/workflows/{id}/timing`, sums to total, compares against a baseline stored in repo (`scripts/data/actions-cost-baseline.json`); files a `[release-health]` issue if month-over-month spend rises > 20%
  - **What it depends on**: `gh` CLI in the runner image (already present in `ubuntu-latest`); PAT scope for the billing endpoint stored in a new `ACTIONS_COST_REPORT_PAT` repo secret
  - **Failure detection**: if the workflow itself fails 2 consecutive months, e2e-nightly's notify-release-health already files `[release-health]` issues — extend or piggyback
- [ ] Update `_status.json` `analyses` array if a formal `/analysis` report was produced

## Testing

### Unit Tests
- [ ] None — this project changes CI infra, not application code. If `scripts/check-actions-cost.ts` is added in Phase 5, give it a smoke test.

### Integration Tests
- [ ] None — out of scope.

### E2E Tests
- [ ] No new specs. **Re-run the existing `@critical` suite on every workflow change** to confirm the new runner / plan doesn't regress flakiness — Playwright tests are sensitive to runner CPU count and ulimits.

### Manual Verification
- [ ] Phase 2 pilots: each pilot job triggered 10× via `gh workflow run`, results aggregated into `_phase2_results.md`
- [ ] Phase 4: watch the next 10 PRs that exercise the migrated job; compare wall-clock + failure rate
- [ ] Confirm Docker-in-Docker (the `migration-verify-test` job's ephemeral Postgres) still works on any alternative runner
- [ ] Confirm all 23 secrets (staging + Production environment + repository-level API keys) propagate identically

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes. The Playwright E2E suite IS the change-target; it's exercised by running CI itself.

### B) Automated Tests
- [ ] Phase 1: `gh api repos/Minddojo/explainanything/actions/runs --paginate` over 30 days
- [ ] Phase 2: per-option pilot triggers via `gh workflow run`; metrics via `gh run view <id> --json jobs`
- [ ] Phase 5: monthly cost-report script `npx tsx scripts/check-actions-cost.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — Note any interaction with CI runner change (probably none)
- [ ] ~~`evolution/docs/minicomputer_deployment.md`~~ — N/A (Option G dropped)
- [ ] `docs/docs_overall/environments.md` — GitHub Actions section must reflect any `runs-on:` change OR plan tier change (not in `relevantDocs`, but covered by `.claude/doc-mapping.json` since workflow YAML changes will surface it)
- [ ] `docs/docs_overall/testing_overview.md` — CI workflow comparison tables (also doc-mapped)
- [ ] `CLAUDE.md` — Only if self-hosted runner is chosen (security/operational note)

## Review & Discussion
*(Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration.)*

**Round 0 — initial findings rewrite (2026-06-28):**
- Replaced original 4-shard E2E assumption with actual 3-shard config
- Replaced $0.008/min GitHub rate with actual $0.006/min
- Replaced "is repo private?" question with confirmed answer (yes)
- Replaced cost estimate ($11/mo) with actual billed amount ($37.96/mo)
- Promoted Enterprise upgrade from "not considered" to Option A
- Promoted ARM runners from afterthought to Option E (lowest-risk experiment)
- Promoted workflow cleanup (Option I) from secondary to first-class option — it stacks with everything else
- Demoted Self-hosted from "we should do this" to "evaluate carefully" — minicomputer has known operational hazards
- Added explicit exit criteria to every Phase 2 sub-investigation so we don't endlessly evaluate

**Round 0.1 — Option G drop (2026-06-28):**
- Dropped Option G (self-hosted on minicomputer) without entering Phase 2. Reason: ongoing ops risk + supply-chain surface area exceeds the achievable savings, and Options A/B/E capture the same or more savings with vastly lower blast radius. Option G's tombstone left in Options Considered + Phase 2 for traceability.

**Round 0.2 — Phase 2 discipline (2026-06-28):**
- Added "Recommended Phase 2 order" subsection — encodes free/instant-revert wins first (Option I → E → A) before vendor pilots (B → C → F).
- Added "savings-threshold early-exit" rule — Phase 2 STOPS when best projected savings ≥ $200/yr (declare victory) or < $50/yr (do nothing). Prevents yak-shaving and completionism on a project whose realistic max prize is ~$500/yr.

**Round 1 — multi-agent /plan-review pass 1 fixes (2026-06-28):**
Reviewers scored Security 3/5, Architecture 4/5, Testing 3/5. Addressed:
- **Secret leakage**: replaced "env-dump step" (which would print secrets to world-readable Actions logs) with a non-leaking presence check that only echoes variable names. Added as shared "Secret-propagation verification protocol" referenced by all pilots.
- **Pilot measurement noise**: added shared "Pilot measurement protocol" — 10 alt + 10 control trials on same SHA, interleaved, with p50/p95/stddev reported. Single-arm comparisons are too noisy for the 1.3× exit threshold.
- **Production-secret exposure to third-party vendors**: added shared "Secret-rotation policy" — rotate high-blast secrets after vendor pilot regardless of GO/NO-GO outcome.
- **Phase 4 rollback was named but undefined**: added 4 concrete revert triggers (failure-rate, p95 wall-clock, vendor incident, cost-reading), 24h deadline, single-user-repo owner, rollback PR template path.
- **Required-checks re-mapping**: `runs-on:` swap can rename matrix job IDs and silently bypass branch protection. Added explicit enumeration + PATCH steps to Phase 4 and Phase 5.
- **Rule 21 verification**: added explicit dedicated-build + start-only-webServer checks to Option B (and by reference C/D/E/F) pilots.
- **Option I.3 audit scope**: replaced "audit the classifier" with a concrete decision-table output + 50-PR reclassification sample + exit criterion.
- **I.2 cache deletion safety**: required dry-run preview and explicit warning about `nextjs-cache-Linux-` prefix.
- **Inter-job needs chain**: documented that single-job pilots measure that job's improvement, not end-to-end CI wall-clock, in the Pilot measurement protocol.
- **testing_overview.md doc-mapping gap**: flagged in Phase 5 as requiring manual update (workflow YAML edits don't auto-surface it).
- **Phase 5 cost-report script**: specified runner venue (new monthly cron workflow), data location (baseline JSON in repo), failure-detection mechanism (piggyback on notify-release-health), and PAT secret requirement.
