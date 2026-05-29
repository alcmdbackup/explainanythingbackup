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
> CHOSEN: A + A2 + B + display relabel + write both counters. C deferred; D rejected; E folded into the display relabel.
- [x] **Option A: Counter-persistence fix (write-path)** — pass `slotMatches` instead of `[]` to the per-slot `syncToArena` (`ParagraphRecombineAgent.ts:604`) so `arena_match_count` is tallied. Verified safe (RPC `p_matches` is deprecated/ignored → no double-write) and sufficient for the leaderboard. Optionally also write `match_count` via a targeted UPDATE for article parity. Mirror the article-path test at `persistRunResults.test.ts:909`.
- [x] **Option A2: Parent-lineage persistence fix** — carry `parent_variant_ids` through the per-slot persist path so rewrites persist `[originalSlotVariantId]` and the leaderboard Parent column shows "Parent #<original>" instead of "Seed · no parent". Requires adding `parent_variant_ids` to the `newEntries` payload (`persistRunResults.ts:632-648`) AND teaching the `sync_to_arena` RPC to write it (new migration) OR a targeted post-sync `UPDATE evolution_variants`. CAUTION: `syncToArena` is shared with article topics — verify the RPC's `ON CONFLICT DO UPDATE` doesn't clobber article variants' already-correct `parent_variant_ids` (which `finalizeRun` writes). PLUS a display fix: paragraph-kind variants with no parent (slot originals) should not render "Seed · no parent" — use "Original paragraph" / "—".
- [x] **Option B: `length_under` fix (prompt floor + temperature)** — add an explicit lower-length floor to the index-0 "tighten" directive in `buildParagraphRewritePrompt.ts` and raise index-0 temperature off the 1.0 floor (ladder start ~1.2). Preserves the distinct compression-diversity axis while stopping systematic underflow.
- [ ] **Option C: `length_under` fix (backfill)** — regenerate dropped rewrites up to a retry cap so each slot reaches M survivors. More robust but larger; interacts with per-slot budget self-abort. Likely defer in favor of B.
- [ ] **Option D: UI-read counter fix (rejected)** — derive Matches from `evolution_arena_comparisons` at render. Rejected: diverges from how article topics render (they read the persisted column) and adds query cost.
- [ ] **Option E: UI "Iteration" column** — suppress/relabel the always-0 `generation` column for paragraph topics (optional polish).

## Decisions (2026-05-29, user)
- **Scope = all three bugs** (parent-lineage persistence + counter persistence + length_under rewrite quality).
- **length_under fix = prompt floor + temperature bump** (Option B; preserve the compression-diversity axis).
- **Counters = write BOTH** `arena_match_count` and `match_count` for slot variants (parity with article variants).
- **Display = relabel BOTH** — parentless slot originals show "Original paragraph"/"—" (not "Seed · no parent"), and the always-0 "Iteration" (generation) column is suppressed/relabeled for paragraph topics.

## Phased Execution Plan

### Phase 0: Root-Cause (DONE — see `_research.md`)
- [x] Located invocation on staging; confirmed article parent was pool-sourced (no article-parent bug).
- [x] Confirmed counter gap (arena_match_count/match_count=0 on all 70 paragraph variants despite 26 real comparisons).
- [x] Confirmed parent-lineage gap (all per-slot `parent_variant_ids=[]` → leaderboard "Seed · no parent").
- [x] Confirmed length_under epidemic (index-0 tighten directive @ temp 1.0 → 89% drop rate).

### Phase 1: Persistence fix — parent lineage + counters (data)
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:604` — pass `slotMatches` (already collected at `:514/:558`, a `V2Match[]`) instead of `[]` as the `matchHistory` arg to the per-slot `syncToArena`. This makes `syncToArena` tally `variantMatchCounts` → non-zero `arena_match_count`. (No double-write: `p_matches` is ignored by the RPC; comparison rows stay written solely by `persistSlotMatches`.)
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.ts:632-648` (`newEntries` payload) — add `parent_variant_ids: buildParentColumns(v).parent_variant_ids` and `match_count: variantMatchCounts.get(v.id) ?? 0` to each entry. Shared with the article path, but safe: article variants are upserted by `finalizeRun` FIRST, so they hit the RPC's `ON CONFLICT` branch (which will NOT update these two fields); only fresh paragraph rewrites take the INSERT branch.
- [ ] NEW migration `supabase/migrations/<ts>_sync_to_arena_persist_parent_and_match_count.sql` — `CREATE OR REPLACE FUNCTION sync_to_arena(...)` adding `parent_variant_ids` (jsonb→uuid[]) and `match_count` to the INSERT column list, reading from the entry JSONB with COALESCE defaults (`'{}'::uuid[]`, `0`). Do NOT add them to the `ON CONFLICT DO UPDATE SET` (mirror the existing `agent_name`/`variant_kind` insert-only pattern at lines 67-68/78-79). Must be idempotent (CREATE OR REPLACE is allowlisted) and pass `npm run migration:verify`.
- [ ] Regenerate DB types if needed (`npm run db:types` / CI auto-commits).

### Phase 2: Display relabel (UI)
- [ ] `evolution/src/components/evolution/variant/VariantParentBadge.tsx:65-74` — add an optional `noParentLabel?: string` prop (default `'Seed · no parent'`) used in the null-parent branch.
- [ ] `evolution/src/components/evolution/arena/ArenaLeaderboardTable.tsx` — add an optional prop (e.g. `parentlessLabel` / `hideIterationColumn`) threaded to `ParentBadgeCell` (→ `VariantParentBadge.noParentLabel`) and to the column set. Default behavior unchanged for article topics.
- [ ] `evolution/src/components/evolution/tabs/SlotsTab.tsx` — pass `parentlessLabel="Original paragraph"` (or "—") and hide/relabel the Iteration column on the embedded per-slot `ArenaLeaderboardTable` instances (paragraph topics only).

### Phase 3: length_under rewrite-quality fix
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts:19-26` — add an explicit lower-length floor to the index-0 "Tighten and simplify" directive (e.g. "…but keep total length within ±20% of the original — do NOT drop below ~0.8× its length."). Keep the distinct compression intent.
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:62-70` — raise the index-0 temperature off the 1.0 ladder floor (e.g. start the ladder at ~1.2, or special-case index 0) so the tighten rewrite gets enough variance to land in-window. Clamp to model `maxTemperature` as today.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — extend (mirror the article `arena_match_count` test at `:909`) to assert `newEntries` carries `parent_variant_ids` + `match_count`, and that non-empty `matchHistory` yields non-zero `arena_match_count`.
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — assert the per-slot `syncToArena` is called with non-empty `matchHistory` (slotMatches); assert rewrite variants carry `parentIds=[originalSlotVariantId]`; pin the revised index-0 temperature (no longer 1.0).
- [ ] `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.test.ts` — assert the index-0 directive contains the lower-length-floor language.
- [ ] `evolution/src/lib/shared/paragraphSlots.test.ts` — (existing 0.8/1.2 bounds) add a regression case if the cap interpretation changes.
- [ ] `evolution/src/components/evolution/arena/ArenaLeaderboardTable.test.tsx` — assert a parentless paragraph row renders the override label ("Original paragraph"/"—"), not "Seed · no parent"; assert the Iteration column hide/relabel.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts` — after a slot `syncToArena`, assert the persisted slot variants have non-zero `arena_match_count`, non-zero `match_count`, and non-empty `parent_variant_ids` (rewrites → `[originalSlotVariantId]`).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts` — (optional) assert the SlotsTab leaderboard Parent column for a rewrite row is not "Seed · no parent".

### Manual Verification
- [ ] Trigger a new paragraph_recombine run on staging with strategy `863bc454...` (or a clone), then re-query: slot variants have non-zero counters + non-empty `parent_variant_ids`, and the `length_under` drop rate falls.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Load `/admin/evolution/invocations/<new-invocation>` → Paragraph Slots tab: Parent column shows "Parent #<original>" for rewrites and "Original paragraph"/"—" for originals (no "Seed · no parent"); Matches column non-zero; Iteration column suppressed/relabeled. Run on the local server via `ensure-server.sh` / Playwright MCP.

### B) Automated Tests
- [ ] `npm run migration:verify` (new sync_to_arena migration), `npm test` (affected evolution unit + component tests), `npm run test:integration` (paragraph-recombine accumulation), `npm run lint`, `npm run typecheck`, `npm run build`.

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
