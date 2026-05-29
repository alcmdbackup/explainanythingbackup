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
- [x] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:604` — pass `slotMatches` (already collected at `:514/:558`, a `V2Match[]`) instead of `[]` as the `matchHistory` arg to the per-slot `syncToArena`. This makes `syncToArena` tally `variantMatchCounts` → non-zero `arena_match_count`. (No double-write: `p_matches` is ignored by the RPC; comparison rows stay written solely by `persistSlotMatches`.)
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.ts:632-648` (`newEntries` payload) — add `parent_variant_ids: buildParentColumns(v).parent_variant_ids` and `match_count: variantMatchCounts.get(v.id) ?? 0` to each entry. Shared with the article path, but safe: article variants are upserted by `finalizeRun` FIRST, so they hit the RPC's `ON CONFLICT` branch (which will NOT update these two fields); only fresh paragraph rewrites take the INSERT branch.
- [x] NEW migration `supabase/migrations/20260529000001_sync_to_arena_persist_parent_and_match_count.sql` — `DROP FUNCTION IF EXISTS sync_to_arena(UUID,UUID,JSONB,JSONB,JSONB);` + `CREATE OR REPLACE FUNCTION sync_to_arena(...)` adding `parent_variant_ids` and `match_count` to the INSERT column list ONLY (NOT to `ON CONFLICT DO UPDATE SET` — mirror the existing insert-only `agent_name`/`variant_kind` pattern at lines 67-68/78-79). Pin the exact casts (no in-repo precedent for jsonb-array→uuid[]):
  - `parent_variant_ids`: `COALESCE((SELECT array_agg(e::uuid) FROM jsonb_array_elements_text(entry->'parent_variant_ids') e), '{}'::uuid[])` — `(entry->>'parent_variant_ids')::uuid[]` is WRONG (yields a JSON text literal, not a PG array).
  - `match_count`: `COALESCE((entry->>'match_count')::INT, 0)`.
  - Idempotency: `CREATE OR REPLACE FUNCTION` + `DROP FUNCTION IF EXISTS` are lint-allowlisted; preserve `REVOKE … FROM PUBLIC` + `GRANT … TO service_role`. Add a top-of-file rollback comment (forward-only repo; revert = re-apply prior function body).
  - **Verification caveat:** `npm run migration:verify` only checks that the migration APPLIES to an empty DB — plpgsql does NOT type-check the cast until runtime, so a bad cast PASSES migration:verify. The cast is therefore covered ONLY by the integration test below, which MUST round-trip a NON-EMPTY `parent_variant_ids` (an all-empty-array fixture would not exercise the cast).
- [x] **High-blast PR note:** touching `supabase/migrations/**` makes this a high-blast PR — `gh pr create` requires a valid `.claude/push-gate.json` for HEAD (written by `/finalize`). Plan for `/finalize` to run `migration:verify` (Step 5.5) and the post-merge migration verification banner.
- [x] **GUARD the ELO-attribution side-effect (blocker from review).** `computeEloAttributionMetrics` in `evolution/src/lib/metrics/experimentMetrics.ts:452-455` selects ALL variants by `run_id` with NO `variant_kind` filter and routes by parent presence (`parent_variant_ids[0]`). Today paragraph rewrites are skipped because their `parent_variant_ids` is empty; once Phase 1 persists `[originalSlotVariantId]`, they would start injecting paragraph-scale Elo deltas into a `paragraph_rewrite:legacy` per-tactic attribution bucket. Add `.neq('variant_kind', 'paragraph')` (and `select` `variant_kind` if needed) to that query so only article variants contribute to attribution. Add a regression unit test in `experimentMetrics.test.ts` asserting a paragraph-kind variant with a parent does NOT produce an `eloAttrDelta:*` row. Also AUDIT the sibling run-scoped variant query at `experimentMetrics.ts:343-346` (run-level elo percentiles, filters `persisted=true` only) — if paragraph variants can have `persisted=true`, apply the same `variant_kind='article'` exclusion (defensive; confirm at implementation).
- [x] Regenerate DB types — not needed (migration changes the RPC body only; no new columns / no signature change).

### Phase 2: Display relabel (UI)
- [x] `evolution/src/components/evolution/variant/VariantParentBadge.tsx:65-74` — add an optional `noParentLabel?: string` prop (default `'Seed · no parent'`) used in the null-parent branch.
- [x] `evolution/src/components/evolution/arena/ArenaLeaderboardTable.tsx` — add an optional prop (e.g. `parentlessLabel` / `hideIterationColumn`) threaded to `ParentBadgeCell` (→ `VariantParentBadge.noParentLabel`) and to the column set. Default behavior unchanged for article topics.
- [x] `evolution/src/components/evolution/tabs/SlotsTab.tsx` — pass `parentlessLabel="Original paragraph"` (or "—") and hide/relabel the Iteration column on the embedded per-slot `ArenaLeaderboardTable` instances (paragraph topics only).

### Phase 3: length_under rewrite-quality fix
- [x] `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts:19-26` — add an explicit lower-length floor to the index-0 "Tighten and simplify" directive (e.g. "…but keep total length within ±20% of the original — do NOT drop below ~0.8× its length."). Keep the distinct compression intent.
- [x] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:62-70` (`paragraphRewriteTemperature`) — raise the ladder floor off 1.0. Concrete: `base = total > 1 ? LADDER_FLOOR + index*(2.0 - LADDER_FLOOR)/(total-1) : 1.5` with `LADDER_FLOOR = 1.2`. New values: M=3 → `[1.2, 1.6, 2.0]`; M=2 → `[1.2, 2.0]`; M=1 → `1.5` (unchanged); clamp to model `maxTemperature` as today.
- [x] **UPDATE the pinned temperature tests (blocker from review)** in `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts`: line ~455 `[1.0,1.5,2.0]` → `[1.2,1.6,2.0]`; line ~266-267 the M=2 set `temps.has(1.0)` → `temps.has(1.2)`; verify line ~261-262 range assertion (`>=1.0`, `<=2.0`) still holds (1.2 is in range — OK); line ~451 (M=1 → 1.5) and line ~459 (cap=1.0 → `[1.0,1.0,1.0]`, since `min(1.2,1.0)=1.0`) remain VALID. Running `npm test` after the ladder change without these edits WILL fail.

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — extend (mirror the article `arena_match_count` test at `:909`) to assert `newEntries` carries `parent_variant_ids` + `match_count`, and that non-empty `matchHistory` yields non-zero `arena_match_count`.
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — **article-path no-clobber regression** (shared-payload safety): assert that when an article variant already has `parent_variant_ids`/`match_count` set (finalize path) and re-enters via `syncToArena`'s INSERT…ON CONFLICT, those two columns are NOT overwritten (verify they're absent from the `ON CONFLICT DO UPDATE SET` list — assert via the generated payload/SQL or a mock RPC capturing the entry shape).
- [x] `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — assert the per-slot `syncToArena` is called with non-empty `matchHistory` (slotMatches). (Rewrite-lineage persistence is covered by the persistRunResults payload test — the mocked rankNewVariant doesn't populate localPool, so an agent-level pool assertion is a mock artifact. Temperature-ladder assertion updates are in Phase 3.)
- [x] `evolution/src/lib/metrics/experimentMetrics.test.ts` — assert the attribution variant query restricts to `variant_kind='article'` (recording-mock captures the `.eq('variant_kind','article')` filter; the no-op chainable can't express row-level exclusion).
- [x] `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.test.ts` — assert the index-0 directive contains the lower-length-floor language.
- [x] `evolution/src/lib/shared/paragraphSlots.test.ts` — N/A: the ±20% cap interpretation in `validateParagraphRewrite` did NOT change (only the prompt directive + temperature ladder), so the existing 0.8/1.2 bounds tests remain valid as-is.
- [x] `evolution/src/components/evolution/variant/VariantParentBadge.test.tsx` — assert the new `noParentLabel` prop renders the override in the null-parent branch, and that the DEFAULT (no prop) still renders "Seed · no parent" (keeps the existing article behavior green).
- [x] `evolution/src/components/evolution/arena/ArenaLeaderboardTable.test.tsx` — assert a parentless paragraph row renders the override label ("Original paragraph"/"—"), not "Seed · no parent"; assert the Iteration column hide/relabel.

### Integration Tests
- [x] `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts` — add a NEW `it` block that invokes the per-slot `syncToArena` (this file currently exercises `upsertSlotTopic`/`persistSlotMatches`/`loadArenaEntries` only — this is net-new setup, not a one-line assertion add). Assert the persisted slot rewrite variants have non-zero `arena_match_count`, non-zero `match_count`, and **non-empty `parent_variant_ids` = `[originalSlotVariantId]`** (this is the ONLY automated guard that exercises the migration's jsonb→uuid[] cast at runtime). NOTE: this suite auto-skips when the evolution schema isn't migrated, so it only provides coverage on a locally-migrated DB (`supabase db reset`) / CI staging lane — call this out so the cast is actually exercised before merge.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-paragraph-recombine.spec.ts` — (optional) assert the SlotsTab leaderboard Parent column for a rewrite row is not "Seed · no parent".

### Manual Verification
- [ ] Trigger a new paragraph_recombine run on staging with strategy `863bc454...` (or a clone), then re-query: slot variants have non-zero counters + non-empty `parent_variant_ids`, and the `length_under` drop rate falls.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Load `/admin/evolution/invocations/<new-invocation>` → Paragraph Slots tab: Parent column shows "Parent #<original>" for rewrites and "Original paragraph"/"—" for originals (no "Seed · no parent"); Matches column non-zero; Iteration column suppressed/relabeled. Run on the local server via `ensure-server.sh` / Playwright MCP.

### B) Automated Tests
- [ ] `npm run migration:verify` (new sync_to_arena migration), `npm test` (affected evolution unit + component tests), `npm run test:integration` (paragraph-recombine accumulation), `npm run lint`, `npm run typecheck`, `npm run build`.

### C) Rollback & Kill Switch
- [x] **Operational rollback** for the whole feature: `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` (confirmed at `runIterationLoop.ts:1276`) short-circuits paragraph_recombine dispatch — no new paragraph runs. No code revert needed for an emergency stop.
- [x] **Migration is forward-only** (per repo workflow). Revert path = a follow-up migration that re-applies the prior `sync_to_arena` body (the prior body is preserved in `20260527000003_extend_sync_to_arena_for_paragraph_kind.sql`). The change is INSERT-only + additive, so re-applying the old function is a clean revert. Document this in the new migration's header comment.
- [x] **Risk assessment:** low — the persistence change is additive (new columns written on INSERT for fresh paragraph rewrites only; article rows hit ON CONFLICT and are untouched); the display change is a default-preserving prop; the prompt/temperature change is gated by the existing kill switch. No feature flag beyond the existing kill switch is needed.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/paragraph_recombine.md` — failure modes / parent resolution / per-slot ranking behavior. SPECIFICALLY correct line ~31 which documents the per-slot `syncToArena` as "pass empty `matchHistory`" (Phase 1 reverses this to pass `slotMatches`) and fix the misleading rationale (matchHistory drives the `arena_match_count` tally, NOT the deprecated `p_matches`). Document that per-slot rewrites now persist `parent_variant_ids=[originalSlotVariantId]` and `match_count`/`arena_match_count`.
- [x] `evolution/docs/variant_lineage.md` — note that paragraph-kind rewrites now carry `parent_variant_ids=[originalSlot]` (1-hop chain), and that ELO attribution explicitly excludes `variant_kind='paragraph'`.
- [x] `evolution/docs/multi_iteration_strategies.md` — reviewed, no change: `sourceMode`/`qualityCutoff` + seed-fallback logic was NOT touched (the article parent was already pool-sourced correctly).
- [x] `evolution/docs/architecture.md` — reviewed, no change: content/parent resolution was not modified.
- [x] `evolution/docs/agents/overview.md` — reviewed, no change: the agent algorithm is unchanged; only persistence + prompt/temperature details changed, which live in `paragraph_recombine.md`.
- [x] `evolution/docs/arena.md` — syncToArena `p_entries` now carries `parent_variant_ids` + `match_count` (INSERT-only). (`loadArenaEntries` / per-slot topic loading unchanged.)
- [x] `evolution/docs/rating_and_comparison.md` — reviewed, no change: per-slot ranking + paragraph comparison mode were not modified.
- [x] `evolution/docs/data_model.md` — `sync_to_arena` RPC entry now documents the INSERT-only `parent_variant_ids` + `match_count` writes (no new columns — both columns pre-existed).
- [x] `evolution/docs/metrics.md` — documented the `eloAttrDelta` attribution `variant_kind='article'` exclusion. (`paragraph_recombine_cost` / `paragraph_slot_match_persist_failures` unchanged.)
- [x] `evolution/docs/strategies_and_experiments.md` — reviewed, no change: the sourceMode + qualityCutoff section was not modified.
- [x] `docs/docs_overall/debugging.md` — added a "0 matches / 0 iterations / Seed · no parent" paragraph_recombine diagnosis recipe (symptom→column table + triage SQL).

## Implementation Notes (plan-review residuals, non-blocking)
- Attribution guard: a PostgREST `.neq('variant_kind','paragraph')` filters server-side and does NOT require adding `variant_kind` to the `select` list — but if the regression test inspects the field, add it to the select explicitly. Prefer `.eq('variant_kind','article')` for forward-safety if a 3rd kind is ever added.
- Temperature tests: also update the now-stale CODE COMMENTS adjacent to the assertions — `ParagraphRecombineAgent.test.ts:256` ("1.0–2.0 ladder" → "1.2–2.0") and `:264` ("schedule is exactly {1.0, 2.0}" → "{1.2, 2.0}"). Consider a named `LADDER_FLOOR = 1.2` constant rather than an inline literal.
- Pre-existing (out of strict scope): the run-level percentile query at `experimentMetrics.ts:343-346` aggregates Elo across ALL run variants regardless of kind; paragraph slot variants are `persisted=false` today so they're not picked up — leave a one-line ticket note rather than expanding scope.
- New migration filename timestamp must sort strictly after `20260527000003`.
- Before merge, actually run `supabase db reset` + `npm run test:integration` so the jsonb→uuid[] cast is exercised at runtime (migration:verify alone won't catch a bad cast).

## Review & Discussion

### Iteration 1 (scores 4 / 4 / 3 — consensus NOT reached)
- **Security & Technical 4/5** — no blockers; flagged the under-specified jsonb→uuid[] cast, migration:verify blind spot, temperature-test churn, high-blast PR note, match_count parity.
- **Architecture & Integration 4/5** — BLOCKER: persisting `parent_variant_ids` on paragraph rewrites would make them eligible for `computeEloAttributionMetrics` (`experimentMetrics.ts:452-455`, no variant_kind filter) → paragraph-scale Elo deltas injected into per-tactic attribution. Minors: doc inconsistency at `paragraph_recombine.md:31`, `variant_lineage.md` missing from doc updates.
- **Testing & CI/CD 3/5** — BLOCKER: Phase 3 temperature change breaks pinned assertions (`ParagraphRecombineAgent.test.ts:261-267/455/459`) not flagged. Minors: article-path no-clobber test prose-only, integration test needs net-new syncToArena block + auto-skip caveat, rollback/kill-switch under-specified.
- **Fixes applied:** added the attribution `variant_kind` guard + regression test (Phase 1); specified the exact new ladder `[1.2,1.6,2.0]` + precise test-line updates (Phase 3); pinned the cast SQL + migration:verify caveat; added high-blast/push-gate note, article-path no-clobber test, integration auto-skip caveat, VariantParentBadge override test, Rollback & Kill Switch section (§C), and doc corrections.

### Iteration 2 (scores 5 / 5 / 5 — CONSENSUS REACHED)
All three reviewers re-verified the fixes against source (the guard targets the exact unfiltered query with a valid mechanism; the temperature test edits match the file line-by-line; the cast/no-clobber/rollback items are present and correct). No remaining critical gaps; residual notes captured above are cosmetic.
