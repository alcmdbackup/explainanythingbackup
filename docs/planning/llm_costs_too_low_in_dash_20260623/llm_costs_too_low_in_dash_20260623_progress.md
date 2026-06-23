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

## Phase 2: Implement the correct fix
### Work Done
[Pending]

## Phase 3: Verify + guard against regression
### Work Done
[Pending]
