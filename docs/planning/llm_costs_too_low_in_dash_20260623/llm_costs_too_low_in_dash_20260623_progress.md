# LLM Costs Too Low In Dashboard Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/llm_costs_too_low_in_dash_20260623` off `origin/main`.
- Read 7 core docs + cost-relevant docs (cost_optimization.md, admin_panel.md, metrics.md, evolution_metrics.md, data_model.md, reference.md, metrics_analytics.md).
- Seeded research doc with reconciliation strategy and three hypotheses (H1 audit-gap, H2 is_test over-tag, H3 read-path).

### Issues Encountered
[None yet]

### User Clarifications
- Branch type: feat.
- Carried-over files (debug_failing_nightly_e2e folder + probe-openai scripts): committed onto the branch per user choice.
- Docs to track: all four suggested groups selected.

## Phase 1: Diagnose on Supabase dev
### Work Done
- Traced dashboard read paths (Explore agent): `/admin/costs` headline → `llmCallTracking` (gapped); `/admin/evolution-dashboard` → `evolution_metrics`/`evolution_agent_invocations` (truth).
- Queried Dev DB (read-only). Confirmed numbers:
  - 7d invocations $22.52 (real $2.89, test $19.67); 30d $37.97 (real $4.16, test $33.82); 90d $69.07.
  - `llmCallTracking` evolution_% sees only $0.006/30d, $0.24/7d.
  - Audit-gap: 10/21,841 invocations (30d) have a tracking row; 479/517 recent real invocations lack one.
  - Test spend collapsed after the 06-21 claim-gate (~$11/day → ~$0.3/day).
- Root cause = (1) `/admin/costs` reads the audit-gapped `llmCallTracking`; (2) 89% of cost is genuine test-strategy spend that's filtered/invisible. NOT a backfill problem.
- Updated research doc with the numbers table, Key Findings, and Open Questions.

### Issues Encountered
- REPL tripped on `FILTER (WHERE ...)` aggregate syntax; rewrote with `SUM(CASE WHEN ...)`.

### User Clarifications
- Pending (see Open Questions in research doc): which surface showed "$3"; scope of fix (correct `/admin/costs` read path vs surface test spend); prod check.

## Phase 1: Canonical merge (DONE)
### Work Done
- Migration `20260624000001`: `idx_invocations_created_at` + `get_evolution_spend_buckets` RPC (invocation-grain, test/real via run→strategy join). `database.types.ts` updated.
- `evolution/src/services/costAnalytics.ts`: evolution spend from invocations (source of truth), non-evo from `llmCallTracking` (call_source dedup filter); shared `evolutionSpendTotal` reused by summary + reconciliation oracle. Gated by `COST_DASHBOARD_UNIFIED_EVOLUTION` (default off). 6 new unit tests (32 total green).
- tsc + lint + check:llm-coverage + check:stale-specs all green.

## Phase 2: /admin/costs UI (DONE)
### Work Done
- Headline total already reflects merged spend (backend). Added `evolutionMerged` flag to `CostSummary`; reconciliation banner is now merge-aware (informational "included" when merged, "under-counted" warning when not).
- E2E spec for merged totals deferred (needs flag-on webServer env + seeded evolution data) — covered by unit tests + existing `admin-costs-dashboard.spec.ts` page-load guard.

## Phase 3: 3-layer write-tracking enforcement (DONE)
### Work Done
- **Layer 1:** `LLM_REQUIRE_TRACKING_DISABLED` kill-switch in `llms.ts` (env wins over `requireTracking`) + precedence unit test.
- **Layer 2:** extracted `createTrackedEvolutionProvider` factory from `claimAndExecuteRun` (runner reuses, behavior-preserving, 24 tests green); rewrote `run-evolution-local.ts` to route real-LLM through the factory, DELETED `createDirectLLMProvider` + OpenAI/Anthropic/calculateLLMCost imports, require DB env for real runs, `--ungated` flag; removed allowlist entry; coverage guard green + negative-assertion test.
- **Layer 3:** `checkTrackingReconciliation.ts` (source-of-truth vs tracking; pure `evaluateDivergence` + 5 unit tests) + `evolution-tracking-reconciliation.yml` (schedule-only, staging, files [release-health] issue).

### Issues Encountered
- New RPC not in generated types → hand-added to `database.types.ts` (CI regenerates on the migration PR).
- Typed Supabase client choked on dynamic `select(column)` over a table union → `as unknown as` cast.

## Phase 4: Verify + finalize
### Work Done
- **Dev reconciliation spot-check (7d):** merge will show $23.20 (real $2.91 + test $20.28) vs the $0.0165 `/admin/costs` shows today — confirms the under-count fix + test/real split against real data.
- **migration:verify:** fails on a PRE-EXISTING 2025 migration (`20251109053825_fix_drift.sql`, `role "anon" does not exist`) — the local harness's bare postgres doesn't seed Supabase roles, so it never reaches my `20260624` migration. Not my change. Made my migration's grants role-existence-guarded for robustness. CI's deploy applies to real staging (roles exist).
- Full local check suite + plan completeness via /finalize.

### Notes
- The merge ships behind `COST_DASHBOARD_UNIFIED_EVOLUTION` (default OFF). Activation (after the migration deploys to staging): set the env flag to `true`. Full `/admin/costs` render verification is a post-deploy ops step (needs the RPC live + flag on).
