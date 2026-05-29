# Investigate Paragraph Recombine Invocation Plan

## Background
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Requirements (from GH Issue #1125)
I see that some paragraphs in invocation 83c9a188-cb83-4cd0-bdbc-3356cbc537fc have 0 matches and 0 iterations, and are also coming from seed despite strategy specifying was supposed to take from top variants of run.

## Problem
(Refined after /research — see `_research.md` for full evidence. The original speculation was partly wrong: the article parent was NOT from seed.)

Three issues underlie the report on invocation `83c9a188-cb83-4cd0-bdbc-3356cbc537fc` (run `b3406b91`, staging — the only paragraph_recombine run yet):

1. **"0 matches and 0 iterations" — REAL but cosmetic counter-persistence bug (universal).** All 70 paragraph variants persist `arena_match_count=0`/`match_count=0` despite 26 real `evolution_arena_comparisons` rows and moved Elos. The per-slot `syncToArena` is called with `[]` matchHistory (`ParagraphRecombineAgent.ts:604`), so `arena_match_count` is never tallied; slot variants also never go through `finalizeRun` where article variants get `match_count`. The SlotsTab leaderboard reads `arena_match_count` (Matches) and `generation` (Iteration, always 0) → shows 0/0.
2. **"coming from seed" — REAL parent-lineage persistence bug (CORRECTED — affects ~all slot rows).** The SlotsTab per-slot leaderboard shows "Seed · no parent" (`VariantParentBadge.tsx:65-74`) for basically every paragraph row because all per-slot variants persist `parent_variant_ids=[]`. The agent creates rewrites with `parentIds:[originalSlotVariantId]` (`ParagraphRecombineAgent.ts:467`) but the per-slot `syncToArena` `newEntries` payload (`persistRunResults.ts:628-649`) OMITS `parent_variant_ids`, so the RPC writes the empty default. (The article-level recombine parent was correctly pool-sourced — `b2a79411`, elo 1270 — so this is purely a per-slot persistence/display bug, not an article-parent-selection bug. The 2/9 `winnerSource='original'` "(original)" tag is a separate, minor signal.)
3. **`length_under` epidemic — REAL quality bug (drives #2).** The index-0 rewrite directive "Tighten and simplify… shorter sentences" at temperature 1.0 underflows the 0.8 char-ratio floor in `validateParagraphRewrite` → 89% drop on index 0, 37% overall, 100% of drops are `length_under`, 22% of slots degenerate to matchCount≤1 (no backfill). Fewer surviving rewrites makes originals win more (directional, not deterministic).

## Options Considered
- [ ] **Option A: Counter-persistence fix (write-path)** — pass `slotMatches` instead of `[]` to the per-slot `syncToArena` (`ParagraphRecombineAgent.ts:604`) so `arena_match_count` is tallied. Verified safe (RPC `p_matches` is deprecated/ignored → no double-write) and sufficient for the leaderboard. Optionally also write `match_count` via a targeted UPDATE for article parity. Mirror the article-path test at `persistRunResults.test.ts:909`.
- [ ] **Option A2: Parent-lineage persistence fix** — carry `parent_variant_ids` through the per-slot persist path so rewrites persist `[originalSlotVariantId]` and the leaderboard Parent column shows "Parent #<original>" instead of "Seed · no parent". Requires adding `parent_variant_ids` to the `newEntries` payload (`persistRunResults.ts:632-648`) AND teaching the `sync_to_arena` RPC to write it (new migration) OR a targeted post-sync `UPDATE evolution_variants`. CAUTION: `syncToArena` is shared with article topics — verify the RPC's `ON CONFLICT DO UPDATE` doesn't clobber article variants' already-correct `parent_variant_ids` (which `finalizeRun` writes). PLUS a display fix: paragraph-kind variants with no parent (slot originals) should not render "Seed · no parent" — use "Original paragraph" / "—".
- [ ] **Option B: `length_under` fix (prompt floor + temperature)** — add an explicit lower-length floor to the index-0 "tighten" directive in `buildParagraphRewritePrompt.ts` and raise index-0 temperature off the 1.0 floor (ladder start ~1.2). Preserves the distinct compression-diversity axis while stopping systematic underflow.
- [ ] **Option C: `length_under` fix (backfill)** — regenerate dropped rewrites up to a retry cap so each slot reaches M survivors. More robust but larger; interacts with per-slot budget self-abort. Likely defer in favor of B.
- [ ] **Option D: UI-read counter fix (rejected)** — derive Matches from `evolution_arena_comparisons` at render. Rejected: diverges from how article topics render (they read the persisted column) and adds query cost.
- [ ] **Option E: UI "Iteration" column** — suppress/relabel the always-0 `generation` column for paragraph topics (optional polish).

## Phased Execution Plan

### Phase 1: Reproduce & Root-Cause
- [ ] Query the invocation row (`evolution_agent_invocations` id `83c9a188-cb83-4cd0-bdbc-3356cbc537fc`): read `execution_detail`, `iteration`, `run_id`, `success`, `error_message`, `created_at`.
- [ ] Identify the run + strategy: read the strategy's `iterationConfigs[]` to confirm the intended `sourceMode`/`qualityCutoff` for this iteration index.
- [ ] Inspect `resolveParent` behavior + logs for a `fallbackReason: 'no_same_run_variants'` (or `empty_pool`) warn around this invocation.
- [ ] Inspect per-slot `execution_detail.slots[*]`: match counts, drop reasons, `winnerSource`, self-abort, `paragraph_slot_match_persist_failures` metric.
- [ ] Determine whether the invocation pre-dates `investigate_matchmaking_paragraph_recombine_20260528` / `make_fixes_paragraph_recombine_20260528`.

### Phase 2: Fix
- [ ] [Actionable fix item — fill after root cause confirmed]

## Testing

### Unit Tests
- [ ] [Test file path and description — e.g. `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — assert pool-mode parent selection + per-slot match recording]

### Integration Tests
- [ ] [Test file path and description — e.g. `src/__tests__/integration/evolution-*.integration.test.ts`]

### E2E Tests
- [ ] [Test file path and description, if any UI assertion is needed]

### Manual Verification
- [ ] Re-query staging/prod for the affected invocation and confirm corrected behavior on a new run with the same strategy.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — only if invocation/run detail UI changes]

### B) Automated Tests
- [ ] [Specific test file path/command — fill after Phase 2]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/paragraph_recombine.md` — failure modes / parent resolution / per-slot ranking behavior if changed
- [ ] `evolution/docs/multi_iteration_strategies.md` — `sourceMode`/`qualityCutoff` semantics if seed-fallback logic changes
- [ ] `evolution/docs/architecture.md` — content/parent resolution notes if changed
- [ ] `evolution/docs/agents/overview.md` — `ParagraphRecombineAgent` algorithm if changed
- [ ] `evolution/docs/arena.md` — `loadArenaEntries` / per-slot topic loading if changed
- [ ] `evolution/docs/rating_and_comparison.md` — per-slot ranking / paragraph comparison mode if changed
- [ ] `evolution/docs/data_model.md` — schema notes if any column/metric changes
- [ ] `evolution/docs/metrics.md` — `paragraph_recombine_cost` / `paragraph_slot_match_persist_failures` if changed
- [ ] `evolution/docs/strategies_and_experiments.md` — sourceMode + qualityCutoff section if changed
- [ ] `docs/docs_overall/debugging.md` — add a paragraph_recombine diagnosis recipe if useful

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
