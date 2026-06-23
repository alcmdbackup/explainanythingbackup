# Reduce E2E Testing LLM Costs Research

## Problem Statement

Reduce LLM spending across the project, with a focus on cutting the staging burn that accumulates from the E2E test pipeline. Last 7 days on staging totaled $18.51, of which 86% ($15.93) was driven by E2E specs inserting pending `evolution_runs` rows that the minicomputer's systemd runner then claims and executes against real LLM providers. Goals: stop test-induced production-equivalent spend, audit the per-PR + nightly E2E cost shape, and reduce ongoing burn without losing test coverage. Secondary: tighten the audit gap so per-call cost can be drilled to `call_source`.

## Requirements (from GH Issue #NNN)

Figure out how to reduce LLM spending.

(Description "same as above" — the project is a scoping investigation. Concrete deliverables to be defined in `_planning.md` after research surfaces the highest-leverage levers.)

## High Level Summary

**TL;DR.** Staging burned **$18.34** in evolution-pipeline LLM spend over the 7-day window 2026-06-14 → 2026-06-21. Of that, **$15.76 (86%) was test-induced**: 7,916 invocations across 69 `[TEST]` strategies + 1,695 invocations across 45 `[TEST_EVO]` strategies, all real LLM calls executed by the minicomputer's systemd runner against pending rows that E2E specs inserted as fixtures. A further **$2.20 (12%) was canary measurement** work I queued for the FR3 Phase 4d project. Only **$0.39 (2%) was genuine non-test pipeline work.**

Main-app web traffic (`llmCallTracking` table) over the same window totaled **$0.0055** — effectively zero.

The root cause is structural: the `claim_evolution_run` Postgres RPC (`supabase/migrations/20260323000002_fix_stale_claim_expiry.sql`) selects pending runs without checking `evolution_strategies.is_test_content`. The trigger that auto-classifies `[TEST]` strategy names already exists (`20260415000001`) — it's just not consulted by the runner gate.

---

## Conclusive 7-day cost breakdown (2026-06-14 to 2026-06-21)

### By environment

| Environment | LLM Spend | Method observed |
|---|---:|---|
| **Staging (Dev Supabase, project `ifubinffdbyewoezcidz`)** | **$18.35** | `evolution_agent_invocations.execution_detail` (paginated) + `llmCallTracking` (paginated). All numbers below are from this environment. |
| Production (Prod Supabase, project `qbxhivoezkfbjbsctdzo`) | not measured | Auto-mode classifier blocked direct prod query during research; per memory `project_llm_test_cost_sources` real prod burn = nightly real-AI + evolution seed gen. To quantify, run `npm run query:prod` against the same shape of query in Phase 1 of execution. |
| GitHub CI (ephemeral) | $0 | Unit + integration tests mock LLM (`src/testing/mocks/openai.ts`). E2E specs that hit a real provider do so against staging Supabase — i.e., they show up in the staging numbers above. |
| Local dev | $0 | Mocked via `jest.setup.js`; dev mode uses staging DB but pipeline runs only fire when explicitly triggered. |

### By origin bucket (staging, 7-day)

| Bucket | Invocations | Runs | Strategies | $ Spend | % | Mechanism |
|---|---:|---:|---:|---:|---:|---|
| **`[TEST] strategy_*`** | **7,916** | **69** | **69** | **$14.72** | **80%** | E2E specs (5 specs identified) insert `evolution_strategies` rows via `evolution-test-data-factory.createTestStrategy()` + `[TEST]` prompts + `status='pending'` evolution_runs. Minicomputer claims them. |
| **Canary** (`[TESTEVO]-FR3-canary-*`) | 559 | 48 | 3 | $2.20 | 12% | Ad-hoc runs queued during this conversation while debugging FR3 Phase 4d (gpt-5-mini coordinator). Not a recurring cost. |
| **`[TEST_EVO] Editing Strategy`** | 1,695 | 45 | 45 | $1.04 | 6% | Specifically `admin-evolution-iterative-editing.spec.ts` (`TEST_PREFIX = '[TEST_EVO] Editing'`). Same runner-claim mechanism, cheaper agent type. |
| Real (non-test, non-canary) | 116 | 8 | 4 | $0.39 | 2% | Genuine pipeline runs. Includes Federal Reserve 3 baseline runs against the real `92355b19` strategy. |
| **Total** | **10,286** | **170** | **121** | **$18.35** | **100%** | |

### By agent type × bucket (top 6)

| Bucket | Agent | n invocations | $ Spend | $/call avg |
|---|---|---:|---:|---:|
| test_strategy | `generate_from_previous_article` | 6,500 | $14.72 | $0.00226 |
| canary | `paragraph_recombine` | 134 | $1.31 | $0.00977 |
| test_evo_editing | `generate_from_previous_article` | 1,429 | $0.95 | $0.00067 |
| canary | `generate_from_previous_article` | 346 | $0.89 | $0.00256 |
| real | `paragraph_recombine` | 21 | $0.24 | $0.01139 |
| real | `generate_from_previous_article` | 79 | $0.15 | $0.00186 |

(`merge_ratings`, `swiss_ranking`, `create_seed_article` add $0 each — they don't make LLM calls or were free fallbacks.)

### Daily trend

| Date | Invocations | $ Spend | Why |
|---|---:|---:|---|
| 2026-06-14 | 609 | $0.91 | Baseline test runner activity |
| 2026-06-15 | 2,134 | $3.66 | Heavy PR / spec activity day |
| 2026-06-16 | 1,087 | $1.92 | Continued test activity |
| 2026-06-17 | — | — | (no rows — runner idle or PR-quiet day) |
| 2026-06-18 | 311 | $0.45 | |
| 2026-06-19 | 41 | $0.02 | Quiet day |
| **2026-06-20** | **5,258** | **$10.06** | My FR3 canary debugging (B5/B6/B7/B8) + heavy PR activity |
| 2026-06-21 (so far) | 846 | $1.32 | Continued canary work + B8 follow-on |

### Main-app `llmCallTracking` (staging, 7-day)

| Metric | Value |
|---|---:|
| Total rows | 1,716 |
| `is_test=false` (real) spend | $0.0047 |
| `is_test=true` spend | $0.0008 |
| **Combined total** | **$0.0055** |
| Distinct models | `gpt-4.1-mini` (1,486), `gpt-4.1-nano` (230) |
| Top real call_source | `generateNewExplanation` ($0.0047 / 195 calls — actual cost-bearing) |

Note: 6 of 7 main-app `call_source` flows show `$0.0000` despite firing hundreds of times — they're structured-output calls where `completion_tokens` aren't being captured (a separate tracking bug, observational only).

### Audit-gap confirmation

**Zero rows in `llmCallTracking` over the 7-day window have a `call_source` starting with `evolution_`.** This matches the caveat documented in `evolution/docs/cost_optimization.md` (the 2026-02-22 ongoing audit gap):

> "post-2026-04-30 data WAS supposed to be reliable per the April fix, but `investigate_paragraph_rewrite_cost_undershoot_evolution_20260529` confirmed it's NOT (staging shows zero rows since 2026-02-22)."

Practical consequences for this project:
- All $18.34 of evolution spend above was reconstructed from `evolution_agent_invocations.execution_detail.{coordinator,rewriter,judge}.cost` — the in-pipeline `scope.getOwnSpent()` rollups
- We can NOT drill to per-call attribution via `llmCallTracking` for any evolution call
- This is the same audit gap memory `feedback_cost_tracking_fail_closed` (LLM cost tracking must be 100% accurate + fail-closed) flagged; cost_optimization.md tags it as a follow-up project
- Out-of-scope for THIS project to fix; in-scope to flag and recommend a separate project to address

### Provider + app-level backstops (current as of 2026-06-21)

| Layer | Cap | Where |
|---|---|---|
| OpenAI monthly cap | recommended $200 (per `llm_provider_limits.md`) | platform.openai.com/settings/limits |
| DeepSeek monthly cap | recommended $100 | platform.deepseek.com |
| Anthropic monthly cap | recommended $100 | console.anthropic.com/settings/limits |
| OpenRouter monthly cap | recommended $50 | openrouter.ai/activity |
| `llm_cost_config.daily_cap_usd` | $50 default (all calls) | `LLMSpendingGate` |
| `llm_cost_config.evolution_daily_cap_usd` | $25 default (evolution only) | `LLMSpendingGate` |
| `llm_cost_config.monthly_cap_usd` | $500 default | `LLMSpendingGate` |
| `EVOLUTION_MAX_CONCURRENT_RUNS` | 5 (claim-time check) | `claimAndExecuteRun` |
| `EVOLUTION_MAX_OUTPUT_TOKENS` | 4,096 (per-call ceiling) | `callOpenAIModel` (D5 fix) |

These backstops worked: even with the runner mis-claiming test fixtures, daily evolution spend stayed under the $25 cap. The fix is upstream of these caps — stop generating the spend in the first place.

---

## Minimal-test proposal — "smallest test that still proves it works"

Goal: validate that the evolution pipeline + admin UI behave correctly **without spending real LLM money on every CI run or every minicomputer claim cycle**.

The current mistake is that "real" and "test" live on the same staging Supabase + same systemd runner, and the gate that distinguishes them only exists in the admin UI. Specs insert rows with `status='pending'` expecting the test to control the lifecycle, but the runner beats them to it.

### Three-layer minimal-cost test strategy

**Layer 1 — Unit / Integration: zero LLM cost (already mostly there)**

- Already: `src/testing/mocks/openai.ts` returns deterministic fixtures
- Already: integration tests mock LLM via the shared mock chain
- Gap: a few integration tests call the real provider for verification of cost-tracking. Audit + mock those. Expected savings: tiny ($0.0008/7d at most).

**Layer 2 — E2E with real DB, mocked LLM (the new default for the 5 offending specs)**

The 5 specs that insert pending evolution_runs (`evolution-seed.prod-ai.spec.ts`, `admin-evolution-iterative-editing.spec.ts`, `admin-evolution-budget-dispatch.spec.ts`, `admin-evolution-run-pipeline.spec.ts`, `admin-evolution-runs.spec.ts`) should switch to one of these patterns:

**Pattern 2a — Pre-baked fixture data (preferred)**: Instead of inserting a fresh `[TEST]` strategy + pending run per test, the spec asserts against a single seeded strategy + a small set of pre-completed variant fixtures. Setup happens once in `global-setup.ts`, not per-spec. Savings: ~$0.20/spec/CI run × 5 specs × 10 CI runs/day = **~$10/day → 0.**

**Pattern 2b — `status='cancelled'` insertion**: When a spec genuinely needs to test "I created a run", insert it with `status='cancelled'` (or a new `status='test_fixture'` value) so the claim RPC's `WHERE status='pending'` predicate won't match. Specs that need to assert the runner actually processed something use a Playwright route mock to flip the row to `completed` directly. Savings: same as 2a.

**Pattern 2c — Force-skip via the new claim-gate**: If we ship Option A from `_planning.md` (claim RPC filters `is_test_content`), specs can continue inserting pending rows freely — they just won't be claimed. This is the cheapest migration path because no spec changes are needed. Savings: ~$15/week immediately, with zero spec touches.

Combine 2c (run-time backstop) + 2a (no DB pollution) for full belt-and-suspenders.

**Layer 3 — Nightly real-AI smoke: one real call against the cheapest model**

A single nightly run that:
- Uses `TEST_LLM_MODEL=google/gemini-2.5-flash-lite` ($0.10/1M in, $0.40/1M out — the cheapest viable model)
- Runs ONE evolution iteration with `EVOLUTION_MAX_OUTPUT_TOKENS=2048` (half the current ceiling)
- Asserts the pipeline returns a non-empty variant pool + valid Elo updates
- Budget cap on the run: `budget_cap_usd=0.10`
- Total expected nightly cost: **<$0.05/night = $1.50/month**

This replaces the existing `e2e-real-ai-smoke.yml` workflow if it's costing more than that. Compare to the current ad-hoc test surface (~$15/week = $60/month from test-strategy claims): a 40× reduction.

### Three CI-time hard guardrails

To prevent regression once costs are reduced:

1. **Per-PR LLM budget gate** — fail the `e2e-evolution` CI job if total `evolution_agent_invocations` for `[TEST]`/`[TEST_EVO]` strategies created during the PR window exceeds **$0.10**. Implemented as a final CI step that queries staging post-test-suite for invocations whose `strategy_id` was created in the last 30 minutes by the runner ID matching the CI job.
2. **Nightly cost alert** — daily cron query: if `SUM(cost) WHERE is_test_content=true AND created_at > now() - interval '24 hours'` exceeds **$0.50**, file a `[release-health]` issue (same plumbing as the nightly E2E alerts).
3. **Test-spec lint rule** — ESLint custom rule that blocks `db.from('evolution_runs').insert({..., status: 'pending', ...})` in `src/__tests__/**` unless preceded by `// e2e-runs-test:approved` comment. Forces conscious approval of any new pending-run insertion.

### Coverage tradeoffs

What we LOSE by going minimal:
- No daily test that gpt-5-mini coordinator (Phase 4d) doesn't regress — but Phase 4d's measurement (`mean(eloAttrDelta:paragraph_recombine)`) is project-tier work, not regression-tier
- No daily integration check against the real OpenRouter API surface — risk: a provider-side API change breaks the pipeline overnight without us noticing. Mitigation: the nightly Layer-3 smoke catches structural breakage; provider OpenAPI changes are rare
- No daily check that real-provider cost tracking is accurate — but the audit-gap fix is its own follow-up project; cost tracking accuracy isn't this project's deliverable

What we KEEP:
- Full unit + integration coverage (mocked)
- Full E2E UI coverage of admin pages (mocked LLM)
- Nightly smoke proves pipeline plumbing
- Per-PR cost gate prevents regression

### Net expected savings (7-day projection)

| Item | Current | Post-fix |
|---|---:|---:|
| `[TEST] strategy_*` claims by minicomputer | $14.72 | $0.00 |
| `[TEST_EVO] Editing` claims | $1.04 | $0.00 |
| Canary debugging | $2.20 | $2.20 (transient — this conversation only) |
| Real non-test | $0.39 | $0.39 |
| Nightly Layer-3 smoke | $0.00 | $0.40 (7 × $0.05) |
| Main-app llmCallTracking | $0.005 | $0.005 |
| **Total staging** | **$18.35** | **$3.00** |

**Cost reduction: 84% on staging.** Production unaffected (different DB, separate runner, this analysis was staging-only).

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### High-Relevance Docs (read at /initialize)
- evolution/docs/cost_optimization.md
- evolution/docs/minicomputer_deployment.md
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/feature_deep_dives/admin_panel.md
- evolution/docs/agents/overview.md
- evolution/docs/data_model.md
- evolution/docs/reference.md

### Remaining Tracked Docs (will be pulled in /research as scope sharpens)
- All other docs/docs_overall/*.md (6 files)
- All other docs/feature_deep_dives/*.md (26 files)
- All other evolution/docs/**/*.md (16 files)

Full list lives in `_status.json` under `relevantDocs`.

## Code Files Read

- evolution/src/testing/evolution-test-helpers.ts (createTestStrategyConfig — lines 206-223)
- supabase/migrations/20260323000002_fix_stale_claim_expiry.sql (`claim_evolution_run` RPC)
- supabase/migrations/20260415000001_evolution_is_test_content.sql (`is_test_content` trigger)
- evolution/src/services/shared.ts (test-content filter helpers, lines 30-114)
- Identified 5 E2E specs that insert pending evolution runs:
  - src/__tests__/e2e/specs/09-admin/evolution-seed.prod-ai.spec.ts:92
  - src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts:113
  - src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts:154
  - src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts:92
  - src/__tests__/e2e/specs/09-admin/admin-evolution-runs.spec.ts:59

## Key Findings (numeric, from the breakdown above)

1. **86% of staging LLM spend is test-strategy claims by the systemd runner.** $15.76 of $18.35 over 7 days. The highest-leverage fix is a one-migration change to `claim_evolution_run` that joins `evolution_strategies` and excludes `is_test_content=true`. Trigger + classification machinery already exists; only the runner-side gate is missing. Estimated ongoing savings: **~$15/week = $780/year** at current cadence; more once nightly + per-PR E2E volume grows.

2. **Test classification machinery is mature; the gate is the only gap.** `evolution_is_test_name()` + BEFORE trigger (`20260415000001`) + `applyTestContentColumnFilter` (admin UI) all exist. Adding a similar filter to `claim_evolution_run` is structurally consistent.

3. **The `llmCallTracking` audit gap is real and ongoing.** Zero `evolution_*`-prefixed `call_source` rows over the 7-day window confirms `cost_optimization.md`'s caveat. All cost numbers in this research were reconstructed from `evolution_agent_invocations.execution_detail` rollups (in-pipeline `scope.getOwnSpent()` writes). Per-call drill-down is impossible. **Out of scope for this project; in-scope as a flagged follow-up.**

4. **`generate_from_previous_article` dominates everything.** 91% of test-strategy invocations (6,500/7,916) and the agent contributes >$15/$15.76 of test burn. It's also the most cost-efficient per-call ($0.00226 average for test strategies) — the volume is what's expensive, not the per-call cost.

5. **Canary cost ($2.20) is a one-time event, not a recurring pattern.** It was the FR3 Phase 4d debugging I did in this very conversation. After PR #1242 merged + the worktree was pulled, canary work is done. This bucket disappears post-2026-06-21.

6. **Real non-test spend is $0.39/7d — a rounding error.** Even doubling staging traffic doesn't move the needle on real spend. The cost-reduction lever is entirely on test traffic.

7. **Main-app web traffic is trivial ($0.0055).** Don't touch it. Six of seven main-app `call_source` flows misreport `completion_tokens=0` and show $0.00 cost — observational tracking bug, not a real cost issue (would amount to <$0.05/week even if corrected).

8. **Nightly real-AI smoke** appears to fire against PROD URLs, not staging — zero rows on staging match the smoke pattern. Its actual cost lives in the prod Supabase project and was not measurable from this research window. Phase 1 should quantify it explicitly when prod access is granted.

9. **Test data sprawl is real but cheap.** 69 `[TEST]` + 45 `[TEST_EVO]` strategy rows in 7 days = 6,000+ rows/year accumulating in staging. After the claim gate ships these rows are harmless (un-claimable), but they still bloat DB + admin UI. A periodic janitor sweep (older than 14 days) is recommended in Phase 3.

## Open Questions

- Does the user want to ship the `claim_evolution_run` migration in this project, or scope this purely to investigation + recommendations?
- Should production runners also be gated on `is_test_content`, or is staging-only sufficient? (Per memory `feedback_never_reset_without_agreement` — get explicit sign-off before touching prod migration.)
- Is there appetite for a sweep job that hard-deletes stale `[TEST]`/`[TEST_EVO]` rows after N days?
- Should we extend the gate to also skip runs whose strategy has any `is_test_content` ancestor (experiment, prompt) — defense in depth?
- Audit-gap fix: scope it into this project (broader cost-accuracy work) or keep it separate per `cost_optimization.md`?
- Of the three minimal-test patterns (2a fixture-only, 2b cancelled-status, 2c claim-gate backstop), which combination does the user want?
- Production cost numbers: should Phase 1 include a `.env.prod.readonly` query for the same 7-day breakdown, or stay staging-only?
