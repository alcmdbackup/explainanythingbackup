# Update Evolution Docs Plan

## Background
Update evolution pipeline docs to reflect the current codebase state after recent reorganization and feature additions. Specifically ensure pipeline continuation and Vercel timeout handling are well-documented.

## Requirements (from GH Issue #472)
- Update all evolution docs to make sure they are up to date
- Specifically make sure we have documented how pipeline continuation works and Vercel's timeouts

## Overall Progress

| Round | Phases | Discrepancies | Status |
|-------|--------|---------------|--------|
| Round 1 | 1-5 | 39 (8H/15M/16L) | COMPLETED — 5 commits |
| Round 2 | 6-9 | 19 (2H/9M/8L) | COMPLETED — 4 commits |

---

## Round 1 (COMPLETED)

Phases 1-5 addressed all 39 original discrepancies across 5 commits:
1. `aa19a0da` — Pipeline continuation & Vercel timeout documentation (Phase 1)
2. `d09c9782` — 8 high-severity factual fixes (Phase 2)
3. `6f490589` — 15 medium-severity fixes (Phase 3)
4. `250e76ca` — 16 low-severity omissions (Phase 4)
5. `04d058ca` — Final consistency pass (Phase 5)

Full details in `_progress.md`.

---

## Round 2: Validation Audit Fixes (19 remaining discrepancies)

A fresh validation audit on 2026-02-19 found 19 discrepancies that survived Round 1. Root causes:
1. **Incomplete cross-doc fixes** — e.g., `section_edited` fixed in editing.md but not overview.md
2. **Surface-level fixes** — e.g., cache threshold updated but two separate cache systems still conflated
3. **Docs never audited in Round 1** — README.md summary line and flow_critique.md were not in scope

### Docs Touched in Round 2
- `evolution/docs/evolution/README.md` — R2-10, R2-11
- `evolution/docs/evolution/architecture.md` — R2-12
- `evolution/docs/evolution/agents/overview.md` — R2-4, R2-5, R2-13
- `evolution/docs/evolution/agents/flow_critique.md` — R2-14, R2-15
- `evolution/docs/evolution/agents/support.md` — R2-16
- `evolution/docs/evolution/rating_and_comparison.md` — R2-2, R2-6, R2-17
- `evolution/docs/evolution/reference.md` — R2-1, R2-3, R2-3b
- `evolution/docs/evolution/cost_optimization.md` — R2-19
- `evolution/docs/evolution/visualization.md` — R2-9
- `evolution/docs/evolution/hall_of_fame.md` — R2-7, R2-8, R2-18

---

### Phase 6: High-Severity Factual Fixes (2 items)
**Status**: COMPLETED
**Goal**: Fix 2 high-severity errors with wrong type shapes and wrong threshold logic.

**reference.md**:
- [ ] R2-1: `diversityHistory` documented as `Array<{iteration, score}>` → actual type is flat `number[]` (`types.ts:574`, `supervisor.ts:32`)

**rating_and_comparison.md**:
- [ ] R2-2: Rewrite the confidence-to-rating-type paragraph (line 17 area). The doc claims "`updateDraw` applied when `confidence < 0.7`" and presents a 0.7-based threshold for choosing between `updateRating`/`updateDraw`. In reality, `isDraw` is binary: `confidence === 0 || winnerId === loserId` (`calibrationRanker.ts:78`). Any positive confidence → `updateRating`. The 0.7 threshold exists only for early-exit decisions (`calibrationRanker.ts:177`), a completely separate feature. Rewrite the entire paragraph to describe the actual binary isDraw logic, and note that the 0.7 early-exit threshold is unrelated. **Important**: line 30's usage of "confidence >= 0.7" for early-exit batching IS correct and must be preserved as-is.

**Commit**: `docs: fix 2 high-severity type/threshold errors in evolution docs`

---

### Phase 7: Medium-Severity Fixes (9 items)
**Status**: COMPLETED
**Goal**: Fix 9 medium-severity issues (wrong counts, stale names, mischaracterized methods).

**reference.md**:
- [ ] R2-3: `evolutionActions.ts` "9 server actions" → 13. Update both the count AND the descriptive list to include: `estimateRunCostAction`, `queueEvolutionRunAction`, `getEvolutionRunsAction`, `getEvolutionRunByIdAction`, `getEvolutionVariantsAction`, `applyWinnerAction`, `triggerEvolutionRunAction`, `getEvolutionRunSummaryAction`, `getEvolutionCostBreakdownAction`, `getEvolutionHistoryAction`, `rollbackEvolutionAction`, `getEvolutionRunLogsAction`, `killEvolutionRunAction`
- [ ] R2-3b: `evolutionVisualizationActions.ts` description only names 4 actions → update to list all 12 exported server actions (or replace enumeration with count "12 server actions for timeline, invocation, run detail, and summary data")

**agents/overview.md**:
- [ ] R2-4: SectionDecompositionAgent output prefix `section_edited` → `section_decomposition_*` (`sectionDecompositionAgent.ts:178`)
- [ ] R2-5: SectionDecompositionAgent "Writes" column lists `sectionState` — agent never writes it; remove from Writes column

**rating_and_comparison.md**:
- [ ] R2-6: Two caches conflated — clarify that `comparison.ts` Map uses `confidence > 0.3` threshold while `ComparisonCache` class uses `winnerId !== null || isDraw` gate (no confidence check) (`comparisonCache.ts:28-33`, `comparison.ts:141`)

**hall_of_fame.md**:
- [ ] R2-7: "10 models" → 12 models. Full list from `schemas.ts:118-124`: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-nano`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-5.2`, `gpt-5.2-pro`, `gpt-5-mini`, `gpt-5-nano`, `o3-mini`, `deepseek-chat`, `claude-sonnet-4-20250514`. Fix Anthropic model name from `claude-sonnet-4` to `claude-sonnet-4-20250514`.
- [ ] R2-8: Method 4 described as "outline-based oneshot" → actual is `evolution_deepseek` with `type: 'evolution', mode: 'minimal'` (minimal evolution, not oneshot). Rewrite 6-method breakdown to: 3 oneshot (gpt-4.1-mini, gpt-4.1, deepseek-chat) + 1 minimal evolution + 1 full evolution with outline + 1 full evolution with tree search (`promptBankConfig.ts:56-63`)

**visualization.md**:
- [ ] R2-9: "Other tabs load data once on selection" → clarify: Timeline, Elo, and Logs poll via `useAutoRefresh`; only Variants and Lineage load once

**README.md**:
- [ ] R2-10: "8 server actions" → "12 server actions" (line 24)
- [ ] R2-11: "6 tabs" → "5 tabs" (line 24)

**Commit**: `docs: fix 9 medium-severity issues across evolution docs`

---

### Phase 8: Low-Severity Fixes (8 items)
**Status**: COMPLETED
**Goal**: Fix 8 low-severity omissions and imprecise wording.

**architecture.md**:
- [ ] R2-12: `markRunFailed()` status guard "only transitions from pending/claimed/running" → add `continuation_pending` (`persistence.ts:104`)

**agents/overview.md**:
- [ ] R2-13: "Each comparison's forward+reverse rounds run sequentially via `run2PassReversal()`" → clarify the two paths: CalibrationRanker delegates to standalone `comparison.ts:compareWithBiasMitigation()` which uses sequential `run2PassReversal`; Tournament delegates to `PairwiseRanker.compareWithBiasMitigation()` which runs both passes concurrently via `Promise.all` (`pairwiseRanker.ts:185`). Neither agent calls `run2PassReversal` directly.

**agents/flow_critique.md**:
- [ ] R2-14: References `comparePairFlow()` as public API → actual public method is `compareFlowWithBiasMitigation()`; `comparePairFlow` is private (`pairwiseRanker.ts:226,245`)
- [ ] R2-15: Document that FlowCritique runs sequentially (`parallel: false` in `runCritiqueBatch`), unlike ReflectionAgent which is parallel (`pipeline.ts:631`)

**agents/support.md**:
- [ ] R2-16: DebateAgent header "Requires 2+ rated non-baseline variants" → `canExecute()` only checks pool count via `countNonBaseline()`, doesn't check ratings (`debateAgent.ts:402-404`)

**rating_and_comparison.md**:
- [ ] R2-17: "5-outcome truth table" → 3 verdict values (`ACCEPT | REJECT | UNSURE`); note counter-intuitive behavior: disagreement between passes → high confidence, agreement → UNSURE (`diffComparison.ts:118-129`)

**hall_of_fame.md**:
- [ ] R2-18: Elo score formula shows only winner-A case → add loser formula (`0.5 - 0.5 * confidence`) and TIE (`0.5`) (`hallOfFameActions.ts:457-460`)

**cost_optimization.md**:
- [ ] R2-19: Key Files table omits `costAnalyticsActions.ts` → add it (exports `getCostAccuracyOverviewAction`, `getStrategyAccuracyAction`)

**Commit**: `docs: fix 8 low-severity omissions across evolution docs`

---

### Phase 9: Final Consistency Pass
**Status**: COMPLETED
**Goal**: Grep for remaining stale references, verify cross-doc consistency, confirm all Round 2 discrepancies addressed.

**Checks**:
- [ ] Grep stale terms: `section_edited`, `comparePairFlow`, `confidence < 0.7`, `confidence >= 0.5`, `sectionState` (in overview.md Writes), `10 models`, `outline-based oneshot`, `9 server actions`, `8 server actions`, `6 tabs`
- [ ] Verify README.md summary counts match their respective detail docs
- [ ] Add `flow_critique.md` to README.md document map and reading order
- [ ] Verify all file paths mentioned in docs exist in codebase (scripted check)
- [ ] Run `npx tsc --noEmit --project tsconfig.ci.json` to confirm no code was modified

**Rollback**: Each phase is a separate commit. Individual phases can be reverted via `git revert <hash>` without unwinding other phases.

**Commit** (if changes needed): `docs: final Round 2 consistency pass on evolution docs`

---

## Testing
This is a docs-only project — no code changes, no tests to write or modify.

**Verification approach**:
- After each phase, re-read the edited docs to confirm factual accuracy
- Grep for any remaining stale references
- Verify all file paths mentioned in docs still exist in the codebase
- Run `npx tsc --noEmit` to ensure no code was accidentally modified
