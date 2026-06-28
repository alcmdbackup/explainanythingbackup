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
- [ ] Trigger that job 10 times via `gh workflow run` against a stable SHA
- [ ] Measure: wall-clock p50 / p95, total billable min, success/fail rate (vendor flake), Playwright result diff vs GitHub-hosted baseline
- [ ] Verify Docker-in-Docker still works for the `migration-verify-test` job (try on a second branch)
- [ ] Verify all 23 secrets propagate identically (env-dump step in pilot)
- [ ] Exit criterion: GO if observed speedup ≥ 1.3× AND no new flakes AND all secrets/Docker work. Compute projected $/yr at observed speedup. NO-GO if speedup < 1.2× or any compatibility break.

#### Option C — Depot pilot
- [ ] Same shape as Blacksmith pilot but with `runs-on: depot-ubuntu-24.04`
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

- [ ] **I.1** Remove `deployment_status` trigger from `post-deploy-smoke.yml`. Per environments.md it's documented as an inert secondary that GitHub anti-recursion already drops; 95.5% of its runs are skipped. Measure: how many "skipped" runs disappear from the Actions tab after removal? Verify the `push: [production]` trigger still catches every real prod release.
- [ ] **I.2** Free up GitHub Actions cache headroom. Current state: 10.6 GB / 88 entries. Run `gh api repos/Minddojo/explainanything/actions/caches?per_page=100 --paginate` and identify (a) oldest entries (b) entries from deleted/stale branches. Delete via `gh api -X DELETE`. Target: <5 GB / <30 entries.
- [ ] **I.3** Audit the `detect-changes` classifier in `ci.yml:30-78`. Find any code-path that triggers `path=full` when only docs / docs+migrations changed. Each false-positive full path = ~37 billable min wasted.
- [ ] **I.4** Validate Playwright browser cache hit rate. Sample 20 recent CI runs; count how often the `Install Playwright browsers` step ran (cache miss) vs `Install Playwright deps` (cache hit). If miss rate > 30%, the cache key is too narrow.
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
- [ ] Compare wall-clock + failure-rate vs the prior 10 PRs (use `gh run list` + jq aggregation)
- [ ] Maintain a 2-week fallback: if anything regresses, revert is one `runs-on:` change away

### Phase 5: Full rollout
*Only after Phase 4 shows stable improvement.*

- [ ] Migrate remaining workflows in order of cost-per-month descending
- [ ] Update `docs/docs_overall/environments.md` GitHub Actions section
- [ ] Add a monthly cost-report script under `scripts/check-actions-cost.ts` so we catch any silent regression (the next time someone bumps a workflow's runner, we'll see it immediately)
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
