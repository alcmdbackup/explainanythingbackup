# Reduce E2E Testing LLM Costs Research

## Problem Statement

Reduce LLM spending across the project, with a focus on cutting the staging burn that accumulates from the E2E test pipeline. Last 7 days on staging totaled $18.51, of which 86% ($15.93) was driven by E2E specs inserting pending `evolution_runs` rows that the minicomputer's systemd runner then claims and executes against real LLM providers. Goals: stop test-induced production-equivalent spend, audit the per-PR + nightly E2E cost shape, and reduce ongoing burn without losing test coverage. Secondary: tighten the audit gap so per-call cost can be drilled to `call_source`.

## Requirements (from GH Issue #NNN)

Figure out how to reduce LLM spending.

(Description "same as above" — the project is a scoping investigation. Concrete deliverables to be defined in `_planning.md` after research surfaces the highest-leverage levers.)

## High Level Summary

Initial discovery completed in conversation prior to `/initialize` revealed the dominant cost contributor on staging is **test-inserted pending evolution_runs being executed against real LLM providers**:

- **86%** of staging spend (last 7 days) came from `[TEST]` and `[TEST_EVO]` strategy rows whose pending runs were claimed by the minicomputer's `processRunQueue.ts` systemd timer (fires every 60s).
- **The `claim_evolution_run` Postgres RPC does NOT filter by `is_test_content`** — the runner is blind to the test/real distinction. Strategy rows are auto-classified as test by a BEFORE trigger (`evolution_is_test_name`), but that classification is used only for admin UI filters, not for the claim gate.
- Per-strategy spend confirmed: `[TEST] strategy_*` patterns (74 runs, $14.98) and `[TEST_EVO] Editing Strategy` patterns (44 runs, $0.95). Each `[TEST]` run averages ~$0.20.
- Main-app `llmCallTracking` spend is trivial ($0.005/7d). Real (non-test) evolution strategy spend was $0.39/7d.

The systematic+scalable fix is a one-migration change to `claim_evolution_run` that adds `JOIN evolution_strategies s ON s.id = run.strategy_id WHERE NOT s.is_test_content` to the inner SELECT, mirroring the existing admin-UI filter pattern (`applyTestContentColumnFilter`). Once that's in place, test-inserted pending runs sit harmlessly (or get swept by a janitor) instead of burning ~$15/week.

Secondary levers identified:
1. **Audit-gap repair** — per memory `feedback_cost_tracking_fail_closed`, cost tracking must be 100% accurate + fail-closed. Per `evolution/docs/cost_optimization.md` the audit-gap window (zero evolution `call_source` rows in `llmCallTracking` since 2026-02-22 on staging) remains active. Per-call drill-down is impossible; only rollups are trustworthy. A follow-up project is referenced in cost_optimization.md.
2. **Nightly real-AI smoke is non-trivial** — uses `TEST_LLM_MODEL=google/gemini-2.5-flash` against staging, fires nightly. Worth measuring as its own bucket.
3. **Per-PR E2E creating test strategies** — even with the claim-gate fix, the test rows accumulate in DB until cleanup. Volume is bounded by spec count + CI cadence; not a cost issue once they're un-claimable, but worth a sweep.
4. **Provider-side caps** — defense-in-depth at OpenAI/DeepSeek/Anthropic/OpenRouter dashboards. See `docs/docs_overall/llm_provider_limits.md` for current recommended monthly caps.
5. **Application-level caps** — `LLMSpendingGate` enforces system-wide daily ($50) and monthly ($500) limits, plus an evolution-only daily cap ($25). These are the backstop.

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

## Key Findings

1. **The single highest-leverage fix is a `claim_evolution_run` RPC migration** that skips strategies where `is_test_content=true`. ~10 lines of SQL. Estimated savings: $15+/week ongoing on staging.

2. **Trigger + UI filter machinery already exists** — `evolution_is_test_name()` and `applyTestContentColumnFilter` are mature; the missing piece is the runner-side gate.

3. **Audit-gap on `llmCallTracking`** prevents per-call cost attribution for evolution spend since 2026-02-22. Run-level rollups via `scope.getOwnSpent()` are still trustworthy. A separate follow-up project (referenced in `cost_optimization.md`) is the right home for that fix.

4. **Test data accumulates** — even when the runner stops claiming them, test strategies + prompts + runs persist in DB. A janitor (or extending existing cleanup helpers) may be needed to sweep stale `[TEST]`/`[TEST_EVO]` rows.

5. **Nightly real-AI smoke** uses `google/gemini-2.5-flash` (~$0.30/1M output tokens) and runs `evolution-seed.prod-ai.spec.ts` against staging. Its cost contribution should be quantified separately from the test-claim issue.

## Open Questions

- Does the user want to ship the `claim_evolution_run` migration in this project, or scope this purely to investigation + recommendations?
- Should production runners also be gated on `is_test_content`, or is staging-only sufficient?
- Is there appetite for a sweep job that hard-deletes stale `[TEST]`/`[TEST_EVO]` rows after N days?
- Should we extend the gate to also skip runs whose strategy has any `is_test_content` ancestor (experiment, prompt) — defense in depth?
- Audit-gap fix: scope it into this project (broader cost-accuracy work) or keep it separate per `cost_optimization.md`?
