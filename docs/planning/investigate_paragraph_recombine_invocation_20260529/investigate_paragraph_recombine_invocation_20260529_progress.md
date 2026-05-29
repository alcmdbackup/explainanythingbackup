# Investigate Paragraph Recombine Invocation Progress

## Phase 1: Persistence fix — parent lineage + counters (DONE)
### Work Done
- `ParagraphRecombineAgent.ts:604` — per-slot `syncToArena` now receives `slotMatches` (was `[]`), so the RPC tallies `arena_match_count` per slot variant. No double-write (RPC `p_matches` ignored; rows still written by `persistSlotMatches`).
- `persistRunResults.ts` `newEntries` payload — now carries `parent_variant_ids: buildParentColumns(v).parent_variant_ids` and `match_count: variantMatchCounts.get(v.id) ?? 0`. Written on INSERT only; article variants hit ON CONFLICT (finalize wrote them first) and keep their values.
- New migration `supabase/migrations/20260529000001_sync_to_arena_persist_parent_and_match_count.sql` — `sync_to_arena` writes `parent_variant_ids` (jsonb_array_elements_text→uuid[]) + `match_count` on INSERT only (NOT in ON CONFLICT DO UPDATE). Rollback comment included; REVOKE/GRANT preserved.
- `experimentMetrics.ts` — attribution variant query now `.eq('variant_kind','article')` so persisted paragraph-slot lineage can't inject paragraph-scale Elo deltas into per-tactic attribution buckets. Sibling percentile query (`.eq('persisted', true)`) confirmed safe — slot variants are `persisted=false`.
- Tests: `persistRunResults.test.ts` (p_entries carries parent_variant_ids+match_count; default-rating → []/0), `ParagraphRecombineAgent.test.ts` (slot syncToArena gets non-empty matchHistory), `experimentMetrics.test.ts` (attribution query filters to variant_kind='article'). 118 + 31 unit tests pass.
- Checks: `npm run typecheck` clean; affected unit suites green; changed-file lint clean (pre-existing evolution lint findings are out of CI lint scope and not introduced by this change).

### Issues Encountered
- `ChainableQuery` type lacks `.neq` → used `.eq('variant_kind','article')` (also the forward-safe choice from plan review).
- An agent-level "rewrites carry parent lineage" test was brittle (mocked `rankNewVariant` doesn't push candidates into `localPool`, so the pool passed to `syncToArena` is empty in the mock). Removed it — lineage persistence is covered at the correct layer by the `persistRunResults` payload test.
- Deferred: full `npm run build` runs once in the final verification phase (Phase 7) rather than after each phase; tsc + unit + lint cover per-phase correctness.

### User Clarifications
- Scope = all three bugs; length_under fix = prompt-floor + temperature; counters = both columns; display = relabel both. (Captured in plan Decisions.)

## Phase 2: Display relabel (UI) (DONE)
### Work Done
- `VariantParentBadge.tsx` — added optional `noParentLabel?: string` prop; the null-parent branch renders `{noParentLabel ?? 'Seed · no parent'}` (default preserves article behavior).
- `ArenaLeaderboardTable.tsx` — added `parentlessLabel?` (threaded to `ParentBadgeCell` → `VariantParentBadge.noParentLabel`) and `hideIterationColumn?` (gates the Iteration header + cell AND removes 'iteration' from the ColumnPicker toggle list). Article topics unchanged (props default undefined/false).
- `SlotsTab.tsx` — both embedded per-slot leaderboards now pass `parentlessLabel="Original paragraph"` + `hideIterationColumn`. So slot originals read "Original paragraph" (not "Seed · no parent") and the always-0 Iteration column is gone for paragraph topics.
- Tests: `VariantParentBadge.test.tsx` (noParentLabel override + default 'Seed · no parent' preserved); `ArenaLeaderboardTable.test.tsx` (parentless override label, default label, Iteration hidden via prop, Iteration shown by default). 19 component tests pass.
- Checks: `npm run typecheck` clean; my changed lines introduce no new lint findings (pre-existing evolution `text-[10px]` + return-type warnings in these files predate this change and are outside CI's dir-walk lint scope — left as-is to avoid an unintended visual change).

### Issues Encountered
- None. (Note: a pre-existing `text-[10px]` design-system lint error at `SlotsTab.tsx:114` is not mine and not caught by CI lint; left untouched to avoid altering existing 10px sizing.)

## Phase 3: length_under rewrite-quality fix (DONE)
### Work Done
- `buildParagraphRewritePrompt.ts` — the index-0 "tighten" directive now carries an explicit lower-length floor: "Keep the result within the ±20% length window — never below ~0.85x the original length: trim wordiness, do not delete substance or drop whole sentences." Doc comment updated to explain the 89% length_under drop motivation.
- `ParagraphRecombineAgent.ts` (`paragraphRewriteTemperature`) — ladder floor raised 1.0 → 1.2 via a named `PARAGRAPH_REWRITE_TEMP_FLOOR` constant: `base = total>1 ? FLOOR + index*(2.0-FLOOR)/(total-1) : 1.5`. M=3 → [1.2, 1.6, 2.0]; M=2 → [1.2, 2.0]; M=1 → 1.5 (unchanged). Clamp to model maxTemperature unchanged.
- Tests updated: `ParagraphRecombineAgent.test.ts` (M=3 ladder `[1.2,1.6,2.0]`, M=2 set `has(1.2)`, range floor `>=1.2`, comments; clamp test `[1.0,1.0,1.0]` still valid since `min(1.2,1.0)=1.0`); `buildParagraphRewritePrompt.test.ts` (new: index-0 directive contains the lower-floor language). 36 unit tests pass.
- Checks: `npm run typecheck` clean; my changed lines introduce no new lint findings (the 5 pre-existing `ExecutionDetailBase`/`_detail`/`_ctx` no-unused-vars errors in `ParagraphRecombineAgent.ts` predate this work, are at lines I didn't edit, and are outside CI's dir-walk lint scope — left as-is).
- `paragraphSlots.test.ts` regression case: N/A — the ±20% cap interpretation did not change (only the prompt directive + temperature), so no new validateParagraphRewrite case needed.

### Issues Encountered
- None.

## Verification
### Ran locally (all green)
- `npm run typecheck` — clean.
- `npm run build` — success (full route table emitted, no errors; validates the 3 client-component UI changes).
- `npx jest` on all 6 modified test files together — **142 passed**.
- `npm run lint` (CI parity = `next lint` + `check:stale-specs`) — exit 0; "✓ No stale specs detected". (Pre-existing warnings in untouched `src/` files only.)

### Added but runtime-gated (run in CI / /finalize)
- **Integration round-trip** (`evolution-paragraph-recombine-accumulation.integration.test.ts`, new `it`): asserts `syncToArena` persists `parent_variant_ids=[originalSlotVariantId]` + `match_count=2` + `arena_match_count=2`. It's the ONLY runtime guard for the migration's jsonb→uuid[] cast. NOT run locally because the new migration `20260529000001` isn't deployed to the staging test DB yet (the existing `migrationApplied` guard checks `prompt_kind`, not the new RPC). CI's `deploy-migrations` job applies it before integration tests run → the test exercises the cast there.
- **`npm run migration:verify`** — BLOCKED locally: Docker daemon is down and starting it needs an interactive sudo password. Runs in CI (`supabase-migrations` workflow applies the migration to staging) and in `/finalize` Step 5.5 (start Docker first). Migration SQL uses standard PG casts (`array_agg(e::uuid)` over `jsonb_array_elements_text`).

### Not run by me (recommend before/at merge)
- **Playwright (UI)**: the relabel + hidden-Iteration-column rendering is covered by `ArenaLeaderboardTable.test.tsx` + `VariantParentBadge.test.tsx` (React Testing Library renders the real components with the exact props `SlotsTab` passes). A browser check of `/admin/evolution/invocations/<id>` → Paragraph Slots tab is still recommended as end-to-end confidence (e.g. during `/finalize` or manually).

## Documentation
Updated (behavioral changes): `paragraph_recombine.md` (syncToArena step + temperature ladder floor + length_under failure mode + migrations list), `variant_lineage.md` (paragraph-rewrite lineage + attribution `variant_kind='article'` exclusion), `arena.md` (syncToArena payload), `data_model.md` (sync_to_arena RPC), `metrics.md` (attribution exclusion), `docs/docs_overall/debugging.md` (new diagnosis recipe). Reviewed, no change: `multi_iteration_strategies.md`, `architecture.md`, `agents/overview.md`, `rating_and_comparison.md`, `strategies_and_experiments.md` (their subject matter was not modified).
