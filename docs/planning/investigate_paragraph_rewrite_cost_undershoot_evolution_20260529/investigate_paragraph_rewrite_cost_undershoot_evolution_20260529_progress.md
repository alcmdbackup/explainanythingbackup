# Investigate Paragraph Rewrite Cost Undershoot Evolution Progress

## Phase 0: Investigation (DONE — 2026-05-30)

### Work Done
Ran `/research` with 4 rounds × 5 parallel agents (20 agents total) against staging Supabase + code maps.

**Round 1 (baseline reconnaissance)**
- A1: Staging cost data baseline — found n=4 paragraph_recombine invocations from strategy `863bc454…`; median cost $0.0048; 98.8% of $0.40 cap left on the table; effective derived cap $0.030.
- A2: Mapped every cost-gating decision in `ParagraphRecombineAgent.execute()` — perSlotBudgetUsd allocation, per-slot self-abort (0.9× per-slot), pre-final-ranking gate (0.9× perInvocationCap), validate-drop path (LLM cost already recorded), article-level rank cost flows to `ranking_cost` not `paragraph_recombine_cost`.
- A3: Mapped `estimateParagraphRecombineCost` math — `expected ≈ $0.0093`, `upperBound ≈ $0.0120` at default knobs. `OUTPUT_TOKEN_ESTIMATES.paragraph_rewrite = 250`, `.paragraph_rank = 100`. Calibration loader includes `paragraph_rewrite` but NOT `paragraph_rank`.
- A4: Traced LLM client cost path — token-based via `calculateLLMCost` (real `usage` tokens), NOT chars/4 heuristic. Per-slot LLM client constructed WITHOUT `db`/`runId`/`invocationId` — so NO `llmCallTracking` rows for `paragraph_rewrite` / `paragraph_rank` calls.
- A5: Traced `paragraph_recombine_cost` metric write path — single SUM-write per invocation via `writeMetricMax` (GREATEST upsert). `getPhaseCosts()` is run-cumulative so MAX-write is mathematically equivalent to SUM-of-invocations under sequential dispatch. **`getRunCostsWithFallback` Layer 2 OMITS `paragraph_recombine_cost`** — latent display bug.

**Round 2 (quantification + projector reality check)**
- A1: Per-slot execution_detail mining — 38% aggregate rewrite drop rate, ALL `length_under`. Per-slot spend $0.0003–$0.0006 (0.5–1.5% of per-slot budget). 16.7% of slots end with ≤1 surviving rewrite. **`execution_detail` MISSING per-rewrite costUsd, temperature, status, per-slot ranking cost.**
- A2: Metric vs invocation parity — invocation `cost_usd` ($0.0043–0.0054) > `paragraph_recombine_cost` rollup ($0.0036–0.0046) by $0.0006–0.0007 = the article-level rank cost (correctly bucketed to `ranking_cost`). Accounting is internally consistent. Each run has exactly 1 paragraph_recombine invocation (MAX-write artifact is benign today).
- A3: Projector vs actual — when recalculated with ACTUAL inputs, projector predicts within 1–7% of actual. Attribution: **rewrite drops 53–98%**, shorter outputs 11–32%, fewer slots 0–30%, article-length variance small.
- A4: Calibration + LLM audit — `evolution_cost_calibration` is EMPTY on staging (0 rows). Hardcoded fallback in play. **ZERO `llmCallTracking` rows for any of the 4 invocations.** Across all staging, only 1 row ever has `evolution_invocation_id IS NOT NULL`, from 2026-04-19 (pre-Apr-28 fix). Broader observability gap.
- A5: Display surface audit — `cost` rollup row exists for all 4 runs (Layer 1 catches). Layer 2 omission is dormant. **`evolution_run_costs` view (Layer 3) was dropped in `20260323000004_drop_legacy_metrics.sql`** — Layer 3 errors and falls through to Layer 4 = 0. `RunsTable.tsx:143-158` inlines its OWN sum omitting paragraph_recombine_cost (active code, latent for current data).

**Round 3 (hypothesis testing)**
- A1: Length_under fix audit — commit `72ebfa80` landed 2026-05-29 19:29 UTC; source confirms `PARAGRAPH_REWRITE_TEMP_FLOOR = 1.2` + "never below ~0.85x" directive. Post-fix index-0 drop rates: 100% / 92% / 100% (vs pre-fix 89%). **Fix is deployed but does not work.**
- A2: Cap sizing — `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` is unreferenced from IterationConfig (no override path). SlotsTab is the surface that renders `budget: $0.0333 spent: $0.0004` — the user's perception source. Recommended: lower to $0.05 + wire schema field.
- A3: llmCallTracking regression — zero `evolution_*` `call_source` rows since **2026-02-22**. ZERO "save failed" warn logs — INSERT isn't even attempted. Evolution-wide, not paragraph_recombine-specific.
- A4: Display surface audit — confirmed P0/P1/P2 fix list (RunsTable inline sum, getRunCostWithFallback Layer 2, COST_DESCRIPTIONS).
- A5: Decision scoring — Options A/B/D rejected. Recommended combo: G + F + H. Conditional I → C.

**Round 4 (synthesis + decision support)**
- A1: Final synthesis text drafted (now the research doc's High Level Summary).
- A2: Full planning doc revision drafted (now in `_planning.md`).
- A3: llmCallTracking regression — hypotheses 1-5 FALSIFIED. Wiring is structurally correct in main. Most likely cause: stale staging deploy (commit `3e6a7290` may not be deployed). **NOT fixable in this project; recommend separate follow-up project.**
- A4: Length_under root cause — index-0 ratios are 0.50–0.74 (mean 0.67) at temp 1.2. LLM is over-compressing, not just barely missing. Recommended fix combo: **hard char-count directive** (replace "~0.85x" with computed `at least N chars`) + **per-index temperature override** (drop index-0 to ~0.7).
- A5: Cap-sizing implementation sketch — concrete file-by-file deltas for Option F (constant change, schema field, dispatch threading, test updates, doc updates).

### Issues Encountered
- `execution_detail` lacks per-rewrite cost / temperature / status — Round 2 had to infer phase split from invocation `cost_usd` minus Σ slot.spentUsd. Phase 1 of the plan addresses this.
- `llmCallTracking` empty for all 4 invocations — Round 2 couldn't compute LLM-call audit drill-down. Round 3+4 traced the regression but it's broader than this project.

### User Clarifications
- User requested 4 rounds × 5 agents each. Followed the structure faithfully; each round built on prior synthesis.

### Outcomes
- Research doc: comprehensive High Level Summary + Findings + Recommendation + Out-of-scope flag.
- Planning doc: 6-phase revised plan (G → F → H → I → C, plus follow-up flag for the broader llmCallTracking regression).
- Branch + GH issue + skeleton committed (`b06133dd`).

## Phase 1: Observability (G)
### Work Done
(Pending — next phase after `/plan-review`.)

### Issues Encountered
(TBD)

### User Clarifications
(TBD)

## Phase 2: Cap right-sizing (F)
### Work Done
(Pending.)

## Phase 3: Display fixes (H)
### Work Done
(Pending.)

## Phase 4: Re-diagnose length_under (I)
### Work Done
(Pending.)

## Phase 5: Drop-rate fix (C, CONDITIONAL on Phase 4)
### Work Done
(Pending.)
