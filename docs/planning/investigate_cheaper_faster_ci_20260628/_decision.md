# Phase 3 Decision

<!-- Records what we chose and why, so future-you doesn't re-investigate. -->

**Date**: 2026-06-28
**Decision**: Upgrade GitHub plan Team → Enterprise (Option A) + apply 3 workflow-cleanup items (I.1, I.2, I.4).

## Outcome

| Path | Status | Annual savings vs status quo |
|---|---|---:|
| **Option A — Upgrade Team → Enterprise** | ✅ Applied 2026-06-28 (user upgraded) | **~$252/year** |
| **Option I.1 — Remove deployment_status trigger** | ✅ Applied this PR | ~$6/year direct + huge Actions-tab noise reduction |
| **Option I.2 — Free cache headroom** | ✅ Applied via `scripts/cleanup-actions-cache.sh --apply` | $0 direct (Enterprise covers) but speed/reliability win |
| **Option I.4 — Align Playwright cache keys** | ✅ Applied this PR | ~$0 direct, frees ~360 MB cache footprint |

**Combined annual savings: ~$258/year + operational quality improvements**

## Rejected options (with reasoning)

| Path | Reason rejected |
|---|---|
| **Option B/C/D — Vendor swap** (Blacksmith/Depot/BuildJet) | Redundant once on Enterprise. Vendor lock-in adds risk; secret-exposure concern; observed speedup is unlikely to be 2× on our IO-bound workload. |
| **Option E — GitHub ARM runners** | Redundant once on Enterprise (we're inside the 50k-min free pool either way). Worth revisiting if usage 5×s. |
| **Option F — GitHub larger runners** | Same: redundant + larger runners do NOT consume free-min allocation so they're a cost regression at our volume. |
| ~~**Option G — Self-hosted on minicomputer**~~ | DROPPED in Round 0.1 — ops risk + supply-chain surface > achievable savings. |
| **Option H — Self-hosted on cheap cloud VM** | Same family as G. Ops burden (security patches, runner registration) not worth $15/mo savings. |
| **Option I.3 — Narrow detect-changes classifier** | Was $10-30/yr lever; not worth 1-2 hrs of per-file safety analysis once Enterprise covers overage. Revisit if needed. |
| **Option I.5 — Reduce reconciliation cadence** | <$1/yr savings, loses signal. |
| **Phase 5 monthly cost-report script** | Was a regression-detector when we cared about overage. With 50k free min, even a wild spike wouldn't hit budget. Don't build. |

## Phase 2 savings-threshold rule history

Per the planning doc's anti-yak-shaving rule, we stopped Phase 2 as soon as projected savings crossed $200/year:

| Checkpoint | Combined projected $/yr | Decision |
|---|---:|---|
| After Option I (workflow cleanup) | $48-68 | Continue (in $50-200 band) |
| After Option E (ARM) | $125-145 | Continue (still in band) |
| After Option A (Enterprise confirmed) | $299-319 | **STOP** → Phase 3 decision |

Vendor pilots (B/C/D/F) were never run — would have cost time + CI minutes for redundant data.

## Operational notes for future

- **Cache cap is per-repo on ALL plans**: the 10 GB ceiling doesn't go away on Enterprise. Run `scripts/cleanup-actions-cache.sh --dry-run` periodically (or set a quarterly cron) if cap pressure returns.
- **Enterprise upgrade billing**: $21/user/month vs Team's $4/user/month. Net delta is $17/user/month. If user count grows past ~4-5, re-evaluate (5 × $17 = $85/mo > current $38/mo overage).
- **If Enterprise gets cancelled / downgraded**: revisit Option B (Blacksmith) and Option E (ARM) — they were the second-best paths.
- **Watch for**: Enterprise plan changes (governance feature defaults), seat-minimum requirement reinstating, free-min allocation changes.

## What changed in the codebase

- `.github/workflows/post-deploy-smoke.yml` — removed `deployment_status:` trigger, simplified `if:` condition + Slack-notify condition, updated header comment
- `.github/workflows/ci.yml` — aligned `e2e-evolution` Playwright cache key with `e2e-critical` / `e2e-non-evolution`
- `scripts/cleanup-actions-cache.sh` — new reusable cache-cleanup script (dry-run by default)
- `docs/docs_overall/environments.md` — reflect Enterprise plan tier

## What did NOT change

- No vendor swap
- No runner-OS change
- No workflow restructure
- No new monthly cron workflow
- No new required PAT / repo secret
- No branch-protection re-mapping (no job-name changes)
