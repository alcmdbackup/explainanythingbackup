# Investigate Paragraph Recombine Invocation Research

## Problem Statement
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Requirements (from GH Issue #1125)
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## High Level Summary

Investigation ran 4 rounds × 4 agents against the **staging** DB (the invocation lives on staging; prod was not involved) and the code. The reported invocation is the **only** `paragraph_recombine` run on staging — the feature is brand new — so "systemic" is asserted within this one run.

**The headline: the article-level selection logic was correct (parent drawn from the top-N pool), but per-slot variant PERSISTENCE drops two fields, producing the two reported symptoms — both REAL bugs, both in the same `sync_to_arena` slot path:**
- **(1) match-count gap** → leaderboard shows "0 matches / 0 iterations".
- **(2) parent-lineage gap** → leaderboard Parent column shows "Seed · no parent" for **basically all** slot rows (CORRECTED from the initial "2/9 perception" read after user feedback — see Finding 2).
- **(3) a real rewrite-quality bug** (`length_under` on the index-0 tighten directive) degrades rewrites and makes originals win more often.

There is **no** literal "article parent came from seed" bug — the recombine article parent was correctly the run's top-Elo pool variant. The "coming from seed" the user sees is the per-slot Parent column rendering empty `parent_variant_ids` as "Seed · no parent".

Facts for the invocation (`83c9a188-cb83-4cd0-bdbc-3356cbc537fc`, run `b3406b91-a8dd-4b20-be49-ff43c73d5596`, success=true, 2026-05-29T13:33Z, 9 slots):
- **`iteration: 2` is 1-based display → config index 1.** The strategy has only 2 `iterationConfigs`: index 0 = `generate`/`seed`/40%, index 1 = `paragraph_recombine`/**`sourceMode:'pool'`**/`qualityCutoff:{topN:3}`/60%. So this WAS a non-first, pool-mode iteration — pool-mode applies and was honored.
- **Article parent = pool, not seed.** Parent `b2a79411` (gen-1 `pipeline`, elo **1270.33**, the top-Elo article = correct topN pick). The recombined output `68fbf088` has `parent_variant_ids=[b2a79411]`. The seed `26ab2327` (gen-0, `generation_method='seed'`) is the **grandparent**, two hops up.

## Key Findings

### Finding 1 — "0 matches and 0 iterations" = a REAL counter-persistence bug (universal, cosmetic)
- **70/70** paragraph-kind variants on staging persist `match_count=0` AND `arena_match_count=0`, even though **26** real `evolution_arena_comparisons` rows exist for this run (matching `execution_detail` matchCounts exactly: one 6, six 3s, two 1s) and **12/17** of this run's paragraph variants have moved Elo (1112–1280). Rating math and comparison persistence work; only the two **counter columns** are never written.
- **Root cause (write-path divergence):** `ParagraphRecombineAgent.ts:604` passes `[]` as `matchHistory` to the per-slot `syncToArena(...)`. `syncToArena` derives `arena_match_count` solely from `matchHistory` (`persistRunResults.ts:618-624,640`) → 0. Slot variants are persisted ONLY via the `sync_to_arena` RPC and never go through `finalizeRun`, which is where ARTICLE variants get `match_count` (`persistRunResults.ts:281` from `result.matchCounts`). The per-slot `localMatchCounts` IS tallied (`ParagraphRecombineAgent.ts:330`) but never threaded into any DB write.
- **UI surface:** `/admin/evolution/invocations/[id]` → `SlotsTab` embeds `ArenaLeaderboardTable`, which re-fetches `evolution_variants` via `getArenaEntriesAction` and renders **Matches = `arena_match_count`** (`ArenaLeaderboardTable.tsx:347`) and **Iteration = `generation`** (`:350`, all paragraph variants are `generation=0`). Hence "0 matches and 0 iterations" despite real comparisons.
- **Status:** an UNSPECIFIED gap in the D10 design of `rank_individual_paragraphs_evolution_20260525` — not a tracked deferral, not a regression.
- **Fix (verified safe + sufficient):** pass `slotMatches` (already collected at `ParagraphRecombineAgent.ts:~558`) instead of `[]` at line 604. The `sync_to_arena` RPC's `p_matches` param is **DEPRECATED/ignored** (migration `20260527000003...sql:27`; comparison rows are written exclusively by `persistSlotMatches`), so there is **no double-write risk**. `arena_match_count` is the only counter the leaderboard reads (shared by article + paragraph topics), so populating it alone fixes the UI. `match_count` has no live paragraph/leaderboard consumer (only article `VariantsTab`/`variantDetailActions`) — optional, for parity.

### Finding 2 — "coming from seed" = a REAL parent-lineage persistence bug on the per-slot leaderboard (CORRECTED — affects ~all slot rows, not 2/9)
> **Correction (user feedback 2026-05-29):** The user reports the SlotsTab per-slot leaderboard shows **basically ALL** paragraph rows as **"parent = seed, no parent"** — not just the 2 `winnerSource='original'` slots. This is the dominant "coming from seed" symptom and it is a REAL persistence bug, not perception. The earlier "2/9 perception" framing was wrong.

- **No literal article-PARENT bug:** the recombine article parent was correctly the pool variant `b2a79411` (elo 1270, topN pick); the gen-2 output `68fbf088` has `parent_variant_ids=[b2a79411]`. Seed (`26ab2327`) is only the grandparent. sourceMode='pool'/topN=3 worked. So the *article-level* parent selection is fine.
- **The bug is in PER-SLOT VARIANT lineage persistence.** DB query: every per-slot paragraph variant for this parent — both `paragraph_original` AND `paragraph_rewrite` — persists `parent_variant_ids: []` (empty). But the agent CREATES them with non-empty parents in memory: rewrite variants get `parentIds:[originalSlotVariantId]` (`ParagraphRecombineAgent.ts:467`), originals get `parentIds:[]` (`:381`, correct — slot root). **The in-memory rewrite parent is dropped on persist.**
- **Root cause (same divergence as Finding 1):** per-slot variants are persisted ONLY via the per-slot `syncToArena(...)` → `sync_to_arena` RPC. The `newEntries` payload built in `persistRunResults.ts:628-649` includes id/content/elo/mu/sigma/arena_match_count/generation_method/agent_name/variant_kind but **omits `parent_variant_ids`** → the RPC writes the column default `'{}'`. Article variants escape this because they ALSO go through `finalizeRun`'s variant upsert (`persistRunResults.ts:~277` via `buildParentColumns`, `:40-50`), which the per-slot path never hits.
- **UI:** `ArenaLeaderboardTable`'s Parent column (`ArenaLeaderboardTable.tsx:33,51-75,376`) reads `entry.parent_variant_id` (= `parent_variant_ids[0]`). When null, `VariantParentBadge` (`VariantParentBadge.tsx:65-74`) renders the literal **"Seed · no parent"**. Since all slot variants have empty `parent_variant_ids`, every leaderboard row shows "Seed · no parent". (The "Seed" wording is article-seed-specific and misleading for paragraph snippets.)
- **Minor, separate signal:** 2/9 slots additionally had `winnerSource='original'` → "(original)" tag (SlotsTab.tsx:34) / "original kept" (RecombinedOutputTab.tsx:112). This is unrelated to the Parent column and is a much smaller effect.
- **Fix (two parts):** (a) DATA — carry `parent_variant_ids` through the per-slot persist path (add it to the `newEntries` payload at `persistRunResults.ts:632-648` AND extend the `sync_to_arena` RPC to write it, OR a targeted post-sync `UPDATE`), so rewrites persist `[originalSlotVariantId]` → Parent column shows "Parent #<original>". (b) DISPLAY — for paragraph-kind variants with no parent (the slot originals, legitimately parentless), the badge/Parent column should NOT say "Seed" (e.g. "Original paragraph" / "—"). Note (a) is a SHARED-path change (`syncToArena` serves article topics too) → verify it doesn't clobber article variants' already-correct `parent_variant_ids` via the RPC's `ON CONFLICT DO UPDATE`.

### Finding 3 — `length_under` epidemic = a REAL rewrite-quality bug (the actionable defect)
- The per-rewrite diversity fix (PR #1122) assigns index-0 the directive **"Tighten and simplify. Cut padding… prefer plain words and shorter sentences. Do NOT add new information."** with the **lowest temperature (1.0)** (ladder = 1.0/1.5/2.0 for M=3; `ParagraphRecombineAgent.ts:62-70`). `validateParagraphRewrite` drops any rewrite with char-ratio `<0.8` as `length_under` (`paragraphSlots.ts:126-128`). The tighten directive has **no lower floor** (only the index-1 additive directive was capped to protect the UPPER bound).
- **Measured impact (this run):** rewrite **index 0 dropped 8/9 slots (89%)**; **37% overall drop rate**; **100% of drops are `length_under`** (zero length_over/format). No backfill/retry — a drop just shrinks the surviving pool → **2/9 slots (22%) degenerated to matchCount<=1**.
- **Link to Finding 2:** fewer surviving rewrites raises the original's win/tie odds — directional but **not deterministic** (slot 0 kept original at matchCount=3; slot 5 had matchCount=1 but a rewrite won). So Finding 3 *contributes to* but does not *fully cause* Finding 2.
- **Fix:** add an explicit lower-length floor to the index-0 directive prompt ("keep within ±20% — do NOT drop below 0.8× the original length") and/or raise index-0 temperature off the 1.0 floor (e.g. start ladder ~1.2), preserving the distinct compression axis. Backfill (regenerate dropped rewrites up to a cap) is the robust but larger alternative.

### Finding 4 — Fix design + safety
- Counter fix is **write-path** (populate `arena_match_count`), not UI-read: article arena topics also read the persisted column, so a UI-read fix would make paragraph topics inconsistent and add query cost. Recommended minimal change: one line at `ParagraphRecombineAgent.ts:604`.
- Counter gap is **slot-specific**: article variants in the same run have `arena_match_count>0` and `match_count>0` (15/15); only paragraph variants are at 0.
- Cross-check: Round-1 "no slot had 0 matches" is NOT a contradiction — `execution_detail.ranking.matchCount` is nonzero while the PERSISTED columns are 0 (different surfaces). Reconciled.

### Finding 5 — Test coverage (runner = jest; the evolution-vitest note in reference.md is stale)
Existing: `evolution/src/lib/shared/paragraphSlots.test.ts` (length bounds), `.../paragraphRecombine/ParagraphRecombineAgent.test.ts` (temp ladder, orchestration), `.../buildParagraphRewritePrompt.test.ts` (directives ≥3/distinct, index-1 cap), `evolution/src/services/slotTopicActions.test.ts`, `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts:909` (article `arena_match_count` tally — **mirror template for the counter fix**), `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts`, `evolution/src/components/evolution/arena/ArenaLeaderboardTable.test.tsx`, `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts`.
Gaps: NO test asserts a slot variant persists non-zero `arena_match_count`; NO test on the index-0 directive text / temp interplay vs the 0.8 floor; NO unit tests for `SlotsTab.tsx` / `RecombinedOutputTab.tsx`.

## Open Questions (for planning)
1. **Scope:** Fix all three (counter persistence + length_under + optionally `match_count` parity), or just the counter + length bugs? The "coming from seed" perception largely resolves once length_under is fixed (more rewrites survive → originals win less) and the counters display correctly.
2. **length_under fix choice:** prompt-floor + temperature bump (cheap, soft) vs reworded directive (risks losing the compression-diversity axis) vs backfill/retry (robust, larger, has budget interaction via per-slot self-abort). Recommendation leans prompt-floor + temp bump.
3. **`match_count` column:** populate for paragraph variants too (parity with article path), or leave (no live consumer)? Affects whether a post-persist `UPDATE` is needed beyond the one-line `syncToArena` change.
4. **UI "Iteration" column:** paragraph variants always show `generation=0` → "0 iterations" even after the counter fix. Decide whether to suppress/relabel the Iteration column for paragraph topics, or accept it.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Named Docs (requested by user)
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Evolution Docs (full set, requested by user)
- evolution/docs/README.md, architecture.md, paragraph_recombine.md, multi_iteration_strategies.md, data_model.md, agents/overview.md, arena.md, reference.md, variant_lineage.md, strategies_and_experiments.md, rating_and_comparison.md, metrics.md, logging.md, cost_optimization.md, entities.md, editing_agents.md, criteria_agents.md, evolution_metrics.md, visualization.md, curriculum.md, minicomputer_deployment.md

## Code Files Read (via agents)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — paragraph_recombine dispatch branch (~1270-1296); `resolveParent` call honoring sourceMode/qualityCutoff (correct).
- `evolution/src/lib/pipeline/loop/resolveParent.ts` + `cutoffHelpers.ts` — seed-fallback conditions (`empty_pool`, `no_eligible_variants`, `missing_cutoff_config`).
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` — per-slot pipeline, rewrite loop (no backfill, :411-430), temperature ladder (:62-70), slot `syncToArena` passing `[]` (:599-608, the bug), `localMatchCounts` (:330).
- `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts` — `PARAGRAPH_REWRITE_DIRECTIVES` (:19-26), ±20% RULE 3 (:75), index-0 "tighten" with no lower floor.
- `evolution/src/lib/shared/paragraphSlots.ts` — `validateParagraphRewrite` 0.8/1.2 char-ratio bounds (:126-128).
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — article `match_count` write (:281), `syncToArena` arena_match_count tally (:618-640).
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — `matchCounts` increment for article variants (:264-265).
- `evolution/src/services/slotTopicActions.ts` — `upsertSlotTopic` (generation_method='paragraph_original', :114), `persistSlotMatches` (returns {inserted,error}, ignored by agent; confidence<=0 filtered).
- `evolution/src/services/arenaActions.ts` — `toArenaEntry` (arena_match_count :26, is_seed :21), `getArenaEntriesAction`.
- `evolution/src/components/evolution/arena/ArenaLeaderboardTable.tsx` — Matches=arena_match_count (:347), Iteration=generation (:350), ★ seed badge (:361).
- `evolution/src/components/evolution/tabs/SlotsTab.tsx` — winnerSourceTag "(original)" (:29-36), embedded leaderboard (:190-199).
- `evolution/src/components/evolution/tabs/RecombinedOutputTab.tsx` — per-paragraph "original kept"/"rewrite chosen" coloring (:96-112).
- `supabase/migrations/20260527000003_extend_sync_to_arena_for_paragraph_kind.sql` — p_matches deprecated/ignored (:27); arena_match_count COALESCE (:65).
- `src/config/modelRegistry.ts` — model `maxTemperature` (most cap at 2.0).
- Test files per Finding 5.

## DB Queries (read-only, staging)
- Invocation row, run row, strategy `iterationConfigs`, full `execution_detail` slots, per-slot winnerSource/matchCount, paragraph + article variant counters/elo/generation_method, `evolution_arena_comparisons` counts per slot topic (26 rows), `evolution_metrics` paragraph rows, run logs (no parent-fallback warn).
