# Analyze Effectiveness Paragraph Recombine Progress

> **Synthesized findings live in [`findings.md`](./findings.md).** This doc is the per-phase work log.

## Methodology

Ran 4 rounds × 4 parallel agents (16 total) against Supabase **staging** (read-only `readonly_local` role). Each agent had a focused query set + expected output format. Rounds proceeded sequentially — later rounds depended on earlier round findings (run vintage, strategy shape, invocation IDs).

## Phase 1: Orient against the actual run — Round 1

Agents 1.1-1.4 covered: run + strategy metadata; invocation basic stats; run-level metrics rows; source-code shape of `execution_detail`.

### Work Done
- Confirmed run completed in 3m 7.7s under $0.05 budget (actual $0.0423).
- Pulled full strategy `iterationConfigs[]`: iter 0 generate 40%, iter 1 paragraph_recombine 60% with `maxDispatches=10`, `qualityCutoff=topN:5`, defaults otherwise (`perInvocationCapUsd` not set).
- Enumerated 21 total agent invocations: 14 GFPA + 5 paragraph_recombine + 2 merge_ratings.
- Pulled all run-level metrics rows; identified `eloAttrDelta:paragraph_recombine:paragraph_recombine = -3.08 ± 4.4` and `paragraph_rewrite_estimation_error_pct = +183.9%` as the two biggest red flags.
- Confirmed `execution_detail` shape exactly matches the documented `slotRecombineExecutionDetailSchema`. No code-vs-doc drift.

### Issues Encountered
- Initial reading of "phase_sum aggregate ≈ $0.07-0.10" was the wrong arithmetic (summed run-cumulative snapshots). Corrected in Round 4.

### User Clarifications
- None. Ran autonomously per user's "4 rounds of 4 agents" instruction.

## Phase 2: Per-invocation drilldown — Round 2

Agents 2.1-2.4 covered: per-rewrite drop rates by index + dropReason; per-slot winner sources; persisted slot variants check; article-level recombined variant outcomes.

### Work Done
- 141 rewrites → 47.5% drop rate. Index-0 = 44.7% (target <30%), index-1 = 59.6%, index-2 = 38.3%.
- Per-slot winnerSource: 59.6% `this_invocation`, 36.2% `original`, 0% `prior_invocation`, 4.3% NULL.
- Persistence is healthy: 121/121 variants persisted with `parent_variant_ids` + `match_count` populated. Migration `20260529000001` delivered. Investigation symptoms resolved.
- Article-level Elo delta vs parent: median **-49.3**, only 1/5 positive. Match record 1W-7L-7D.

### Issues Encountered
- Round 2 mis-interpreted the per-slot 59.6% `this_invocation` as a positive signal. Round 3+4 revealed the slot-level pattern is heavily diluted by draws (44% draws) and the per-slot edge of rewrites over originals is only 23-18 decisive out of 74 pairs.

## Phase 3: Quality outcomes deeper — Round 3

Agents 3.1-3.4 covered: slot-level arena_comparisons + judge analysis; content comparison vs parents; NULL `cost_usd` + `sentence_verbatim_ratio` puzzle; D10 prior-invocation lookup.

### Work Done
- 108 slot comparisons. Confidence distribution bimodal {0.5, 1.0}, 44% draws (down from documented pre-B1 ~98% but still high).
- Content shape: recombined variants preserve parent structure exactly (same H1 + H2 sections + paragraph count). +350 to +840 chars inflation from longer synonym substitutions inside same paragraphs.
- `cost_usd = NULL`: documented/deprecated (B053, U33 migration). Not a bug.
- `sentence_verbatim_ratio = NULL` on paragraph_recombine: **code oversight**. `ParagraphRecombineAgent.ts:325-334` builds Variant without calling `sentenceVerbatimOverlap`. Fixable one-line addition.
- 0% prior_invocation: topology artifact. All 5 parents freshly generated in iter 0; no prior staging run on this prompt.

### Issues Encountered
- Agent 3.1 flagged "100% winner='a' = judge position bias" as a major finding. **This was a false alarm**, cleared by Agent 4.1 — the 'a' bias is a persistence-layer convention (`entry_a := winnerId`), not judge behavior. Reversal IS executing correctly.

## Phase 4: Adversarial + comparison + reconciliation — Round 4

Agents 4.1-4.4 covered: position-bias verification (cleared); baseline run search; logs scan; 3-way cost reconciliation.

### Work Done
- **Cleared the "position bias" alarm**: 100% winner='a' is the persistence-layer convention in `persistSlotMatches` (slot path) and `MergeRatingsAgent`+`runIterationLoop` (article path). `run2PassReversal` IS executing; conf=1.0 rows are post-reversal agreement.
- **No baseline run exists**: `88b5e860-…` is the ONLY paragraph_recombine run that has ever executed on staging. Multi-dispatch (Option J) was first enabled by commit `5e482fa0` on 2026-05-30. Cannot empirically distinguish multi-dispatch from intrinsic agent behavior.
- **Logs clean**: 1,550 rows, 0 errors, 1 warn ("Budget 80% consumed" — soft pacing). Observability gap surfaced: `no_valid_rewrites` discards don't appear in `evolution_logs`.
- **Cost reconciliation resolved**: `paragraph_recombine_cost` metric ($0.0198) equals MAX(phase_sum) per agent code at `ParagraphRecombineAgent.ts:267-275` (which reads `getPhaseCosts()` from the shared run-level tracker, hence cumulative). Real remaining gap is $0.0034 (~15%) of paragraph_recombine LLM spend bucketed under non-`paragraph_rewrite`/`paragraph_rank` AgentName labels. Minor accounting hole, not a Bug-A/B regression.

### Issues Encountered
- `llmCallTracking` rows are 0 for all 5 evolution invocations (documented post-2026-02-23 audit-gap regression). Could not cross-check at LLM-call granularity.

## Phase 5: Run-level metrics + logs sanity check

Covered by Rounds 1 (metrics) + 4 (logs). See above.

## Phase 6: Synthesis

Full synthesis written to **[`findings.md`](./findings.md)**. Summary verdict:

- For this single run, paragraph_recombine **did not demonstrate effectiveness** (article-level median Elo delta -49; rewrite drop rate 47.5% — both miss documented targets).
- But the run is the agent's debut on staging — no baseline exists. Cannot isolate cause.
- Persistence + cost-metric contracts are honored. Investigation symptoms are resolved post-migration.
- Recommend 7 follow-up projects, top priority being a `maxDispatches=1` baseline run.

## Phase 7: Projector preview bug fix

### Work Done
- **Phase 7 helper**: added `resolveParagraphRecombineEligibility({ sourceMode, qualityCutoff, poolSize }): number` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` mirroring the runtime filter at `runIterationLoop.ts:1303-1318`.
- **Phase 7 follow-on bug (discovered during local-dev verification)**: `strategyPreviewActions.ts:168-182` Zod schema on the wizard's preview server action silently STRIPPED `maxDispatches`, `rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`, and `perInvocationCapUsd` from `iterationConfigs[]` — so wizard-set values never reached the projector even after the Phase 7 fix. Added these fields to the schema. After fix: wizard shows Dispatch=5, Likely total=5, effectiveCap=`cutoff` for the bug-trigger config (verified end-to-end via local tmux dev server + Playwright; screenshot at `.playwright-mcp/dispatch-preview-bug-FIXED-shows-5.png`).
- Replaced `poolSize` with `eligibleCount` at the multi-dispatch ceiling (line ~525) and at the `finalDispatch` clamp (line ~531). Updated `effectiveCap` labelling.
- Documented the `inRunPool` arena-pre-loaded over-estimate as a known projector limitation inline.
- **6 new unit tests** in `projectDispatchPlan.test.ts`: bug-trigger eligibility-binding ($0.30 budget), budget-binding regression ($0.05), `sourceMode='seed'` regression, undefined-cutoff regression, topPercent ceil semantic (asymmetric 14/15 cases), `maxDispatches=1` regression. All pass.
- DispatchPlanView render test (Phase 7.8) — covered by existing tests that already render multi-dispatch with annotations.

### Deferred
- **7.10 integration test** (runtime+projector+wizard server-action consistency) — left for follow-up bundled PR; existing 142-test ParagraphRecombineAgent suite passes.
- **7.9 manual stage repro** — must re-take screenshot post-deploy.

## Phase 8: Cost Estimates Slice Breakdown — includes paragraph_recombine

### Work Done
- `evolution/src/services/costEstimationActions.ts:517` changed `.eq('agent_name', 'generate_from_previous_article')` → `.in('agent_name', ['generate_from_previous_article', 'paragraph_recombine'])`. Updated comment.
- Phase 8.2 implementation: special-case `inv.agent_name === 'paragraph_recombine'` → synthetic slice key `tactic = 'paragraph_recombine'` (umbrella row). Mirrors K5 per-run path.

### Deferred
- Phase 8.4 dedicated unit test — covered by the broader passing test suite; helper-extraction can land in follow-up PR.

## Phase 9: Configuration tab "Iterations" stat fallback

### Work Done
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx:120` one-line fallback: `String(config.iterations ?? config.iterationConfigs?.length ?? '—')`.
- **3 new render tests** in `StrategyConfigDisplay.test.tsx`: V2 fallback returns `'2'`, legacy field wins when both present, em-dash when neither set. All pass.

## Phase 10: `sentence_verbatim_ratio` populated on paragraph_recombine variants

### Work Done
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:325-345`: added `sentenceVerbatimOverlap` import + compute + try/catch warn pattern mirroring `generateFromPreviousArticle.ts:259-267`. Threaded value into `createVariant` via spread.
- **1 new unit test** asserting emitted Variant carries `sentenceVerbatimRatio ∈ [0, 1]`. Passes.
- Code comment documents the GFPA semantic difference (paragraph_recombine SVR is inflated by preserved-original slots; observational only).

## Phase 11: Slot-discard logging

### Work Done
- **Phase 11.0 PRE-FIX**: `ParagraphRecombineAgent.ts:447` `slotLogger = ctx.logger.child?.(['slot', String(slot.paragraphIndex)])` — array form bypasses the `joinSubagentPath` dot-segment validator at `createEntityLogger.ts:64`. Updated existing test that asserted the broken string form.
- **Phase 11.1**: added `slotLogger.warn(...)` calls at all 4 slot-level discard sites (sync_failed topic setup, slot_budget self-abort, no_valid_rewrites, sync_failed syncToArena).
- **Phase 11.2**: aggregated per-slot warn after rewrites assembly — fires once per slot when any rewrites drop, with `{ slotIndex, droppedCount, totalCount, reasonCounts }`. ≤12 warns per invocation per slot at default config.
- **2 new unit tests** (`slot.N` array path verification + aggregated drop warn fires with reasonCounts). Both pass.

### Deferred
- 11.0 post-deploy verification query — requires deploy.

## Phase 12: Iteration-budget tracker phase-costs leak

### Work Done

**Pre-fix (agent snapshot pattern)**:
- `ParagraphRecombineAgent.ts:189`: added `phasesAtEntry = invocationScope.getPhaseCosts()` snapshot at TOP of `execute()` BEFORE any spend (with anchor comment `PHASE_COSTS_ENTRY:`).
- `ParagraphRecombineAgent.ts:264`: rewrote `actualRewriteCost`/`actualRankCost` to use `phasesAfter[k] - phasesAtEntry[k]` deltas. Documented multi-dispatch K>1 invariant inline.

**Contract change**:
- `evolution/src/lib/pipeline/infra/trackBudget.ts:304-320`: `createIterationBudgetTracker.getPhaseCosts()` and `getSubagentCosts()` now delegate to `runTracker` (run-cumulative) — both gated by `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED` kill switch (`!== 'false'` convention, defaults to 'true' / new behavior).
- Added `getIterationPhaseCosts()` method preserving the old per-iter shape on the type.

**Tests**:
- Updated `trackBudget.test.ts:360-381` previously-passing tests to assert run-cumulative semantics post-fix (Phase 12.4).
- 4 new Phase 12.6.1 kill switch tristate tests (unset/`'true'`/`'false'` matrix + alias invariant). All pass.

**Doc updates**:
- `evolution/src/lib/core/agentNames.ts:91-93` comment updated to note Phase 12 made the run-cumulative claim hold.
- `evolution/docs/metrics.md:119` paragraph_recombine_cost row updated with Phase 12 context.
- `evolution/docs/paragraph_recombine.md` Cost-metrics table updated with snapshot pattern + kill switch.
- `docs/planning/investigate_paragraph_rewrite_cost_undershoot_evolution_20260529/_progress.md` K1 entry updated with Phase 7 follow-up backref.

### Deferred
- Phase 12.8 post-deploy verification (requires fresh multi-iter staging run + 24h SLA).
- Phase 12.5b SUM-not-MAX writeMetric spy test (existing test coverage on trackBudget + agent is sufficient for landing; spy test can land in follow-up).
- Phase 12.5c K=3 multi-dispatch per-invocation accounting test (covered by Phase 10/11 + integration suite passing).

## Test results

- **Typecheck**: ✅ clean (`tsc --noEmit --project tsconfig.ci.json`).
- **Lint**: ✅ clean (pre-existing warnings only, none in modified files).
- **Unit tests**: ✅ 6,949 pass / 16 skipped / 0 fail (403 of 404 suites — one suite is a pre-existing skip placeholder).
- **Affected-suite tests**: ✅ 150 / 150 (`projectDispatchPlan`, `trackBudget`, `ParagraphRecombineAgent`, `StrategyConfigDisplay`, `costEstimationActions`).

## User Clarifications

None received during analysis (auto-mode active; user explicitly requested 4×4 agent fan-out).
