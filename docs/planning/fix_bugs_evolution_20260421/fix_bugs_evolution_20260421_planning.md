# fix_bugs_evolution_20260421 Plan

## Background
Two bugs + two UX gaps observed in the evolution system:

- **Bug 1.** When trying to create a strategy taking the top X articles, leads to an error: `{ "code": "custom", "message": "qualityCutoff required when sourceMode is pool", "path": [ "iterationConfigs", 1 ] }`
- **Bug 2.** When I look at run 6743c119-8a52-44e5-8102-0b1f4b212f40 on stage, I see that some of its variants seem to be originating from variants not in the run, but which aren't the seed.
- **UX 3.** Every arena topic should have a UI element clearly displaying and linking to the seed at the top of the page.
- **UX 4.** Arena entries should show the variant ID in the UI.

## Problem

- **Bug 1** is a wizard state bug. `qualityCutoffMode` starts `undefined`; the `?? 'topN'` fallback at render time is display-only and never persists to state. If a user switches `sourceMode` to `'pool'` without clicking the cutoff-mode dropdown, `toIterationConfigsPayload` (`page.tsx:78-91`) drops `qualityCutoff` entirely and the Zod refinement at `schemas.ts:407-408` rejects it.
- **Bug 2** is a real bug per product intent: `generateFromPreviousArticle` should pick parents from variants produced by THIS run only, never from arena entries loaded from prior runs of the same prompt. Staging query on run `6743c119...` confirmed 8/8 gen-2 variants have parents from 6 distinct prior runs. The pool passed into `resolveParent()` at `runIterationLoop.ts:352-360` is `initialPoolSnapshot` — which includes arena entries with `fromArena=true`. We must filter those out at the call site.
- **UX 3** — the arena topic page already has a gold "seed" badge inline in the Method column (`src/app/admin/evolution/arena/[topicId]/page.tsx:252-256`), but no top-of-page seed section. Per user: keep the seed row in the leaderboard table AND strengthen its inline indicator. Add a top-of-page panel that displays and links to the seed.
- **UX 4** — no dedicated variant-ID column on arena leaderboard. Add one matching the `/admin/evolution/variants` list pattern.

## Resolved Decisions

1. **Bug 2 direction:** filter arena variants (`v.fromArena === true`) out of the pool that `resolveParent()` receives for parent selection. Single-run lineage is the product intent; `generateFromPreviousArticle` must only pick parents produced by THIS run.
2. **Bug 2 fix locus — call-site filtering (not in-resolver):** filter at the call site in `evolution/src/lib/pipeline/loop/runIterationLoop.ts` around lines 352-360 (the `resolveParent({...})` invocation). Matches the existing codebase convention — `persistRunResults.ts` already uses `.filter((v) => !v.fromArena)` in 5 places. Keeps `resolveParent()` pool-agnostic. Critically: `initialPoolSnapshot` (captured at line 303) remains **unfiltered** so the agent's in-iteration ranking via `rankSingleVariant` still compares against arena competitors — that's the design intent of "arena entries as ranking competitors". Only the resolveParent call receives the filtered pool.
3. **Bug 2 fallback:** when the filtered pool is empty (e.g., iteration 2 uses `sourceMode='pool'` but iteration 1 discarded everything, or an empty pool before any iteration has produced variants), `resolveParent()`'s existing `empty_pool` guard (resolveParent.ts:47-55) returns seed. The call site then relabels this case in its warn log as `fallbackReason: 'no_same_run_variants'` when `initialPoolSnapshot.length > 0 && inRunPool.length === 0`. Do NOT add the new reason to `ResolvedParent.fallbackReason` union — the resolver itself cannot observe the distinction (it only sees the filtered pool) so exposing an unreachable union value is misleading. Keep `'no_same_run_variants'` as a log-context string literal only. Single downstream consumer is the `warn` log; verified by grep that no Zod schema, metric, or DB field consumes fallbackReason.
4. **Bug 2 guard at persistence:** `persistRunResults.ts:231,262` uses `v.parentIds[0] || null` to write `parent_variant_id`. Even after the filter, an empty-string `parentIds[0] = ''` (defensive edge) would evade the `|| null` short-circuit because `''` is falsy (actually `|| null` returns `null` for `''` since empty string is falsy — this IS safe). Confirm via test. The only remaining risk is a non-empty stale UUID leaking in — the integration test covers this at the DB boundary.
5. **Bug 1 defaults:** on `sourceMode` transition to `'pool'`, initialize `qualityCutoffMode: 'topN'` and `qualityCutoffValue: 5` in state if unset. `topN:5` matches the placeholder at `page.tsx:862` and the user's "top X articles" phrasing.
6. **Bug 1 adjacent cleanup:** also normalize the `sourceMode ?? 'seed'` (`page.tsx:841`), `qualityCutoffValue ?? ''` (line 857), AND `qualityCutoffMode ?? 'topN'` (line 867) render-time fallbacks — same anti-pattern, latent versions of the same bug. Tighten the `IterationRow` interface so `sourceMode` is required (`'seed' | 'pool'`, no optional) and `qualityCutoffValue: number | undefined` is explicit. This prevents the anti-pattern from creeping back.
7. **UX 3 — seed panel data source (NOT from paginated leaderboard):** extend `getArenaTopicDetailAction` in `evolution/src/services/arenaActions.ts` to also return the topic's seed variant (`seedVariant: ArenaEntry | null`) — a cheap extra query filtering `generation_method='seed' AND prompt_id=topicId AND archived_at IS NULL ORDER BY elo_score DESC LIMIT 1`. The arena topic page paginates entries with `PAGE_SIZE=20` (ordered `elo_score DESC`, `arenaActions.ts:189`); sourcing the seed from the paginated `entries` array would silently hide the panel when the seed is not on page 1. Using the topic-detail action guarantees availability regardless of leaderboard page. Multi-seed legacy data (`EVOLUTION_REUSE_SEED_RATING=false`) is handled correctly by the `ORDER BY elo_score DESC LIMIT 1`.
8. **UX 3 — seed row:** keep the seed row in the leaderboard body (user decision).
9. **UX 3 — seed indicator in row:** strengthen the existing inline gold badge (`src/app/admin/evolution/arena/[topicId]/page.tsx:252-256`). Make it a more prominent pill — taller, bolder, add a leading star or dot icon, and add a `data-testid="lb-seed-row-indicator"` for E2E.
10. **UX 3 — top panel:** add `ArenaSeedPanel` above the leaderboard. Outer container chrome matching `EntityDetailHeader.tsx:75` (`bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg`). Use `<MetricGrid variant='card' columns={3} metrics={[...]} />` (metrics ARRAY prop, NOT children — `evolution/src/components/evolution/primitives/MetricGrid.tsx` API) for the Elo/CI/matches row only; content preview and "View seed variant" link are standard flex layout (not metric cells). Hide the panel when `topicDetail.seedVariant === null`.
11. **UX 4:** add an "ID" column between Content and Elo on the leaderboard. Pattern: `<span className="font-mono text-xs" title={entry.id}>{entry.id.substring(0, 8)}</span>`. Click-to-copy is **inlined** (5 lines borrowed from `EntityDetailHeader.tsx:37-54`) both in the panel and in the leaderboard cell — no shared hook extraction in this project. Inline duplicates are cheap and avoid the cross-package placement debate; a shared `useCopyableId` hook can be extracted in a follow-up if a third call site appears.
12. **Bug 2 UX transparency (Phase 3, in-scope):** strengthen `VariantParentBadge`'s cross-run suffix into a prominent inline pill. Do NOT reuse `StatusBadge` — its API (`variant + status`, label derived via `capitalize(status)`, no `children` or `label` prop) doesn't fit an ad-hoc "(other run)" label and adding a new `variant='parent-provenance'` would require invasive API changes. Instead, copy StatusBadge's token-based styling pattern (`rounded-full px-2 py-0.5 text-xs font-ui font-medium`, `color-mix(in srgb, color 20%, transparent)` background, `color-mix(in srgb, color 30%, transparent)` border) inline in `VariantParentBadge.tsx` using `var(--accent-copper)` or a similar warm token. This is a safety net for historical runs with cross-run parents; after a 30-day deprecation window once no new pool-mode runs produce cross-run parents, the strengthened pill can be demoted back to muted text.

## Phased Execution Plan

### Phase 1: Bug 1 — wizard `sourceMode='pool'` defaults
- [ ] In `src/app/admin/evolution/strategies/new/page.tsx`, tighten the `IterationRow` interface (~lines 34-45): `sourceMode: 'seed' | 'pool'` (required, not optional), `qualityCutoffMode?: 'topN' | 'topPercent'`, `qualityCutoffValue?: number` (explicit `undefined`-able).
- [ ] Update `DEFAULT_ITERATIONS` (~line 60) so every row has an explicit `sourceMode: 'seed'` default.
- [ ] Extend `updateIteration()` (~lines 384-402) so that when the patch flips `sourceMode` to `'pool'` on a generate iteration, it also sets `qualityCutoffMode: 'topN'` and `qualityCutoffValue: 5` when those fields are currently `undefined`.
- [ ] Remove render-time fallbacks: `sourceMode ?? 'seed'` (line 841), `qualityCutoffValue ?? ''` (line 857 — replace with explicit `qualityCutoffValue === undefined ? '' : String(qualityCutoffValue)` or similar), and `qualityCutoffMode ?? 'topN'` (line 867). Render should read directly from state since state is now always defined when the controls are visible.
- [ ] Verify `toIterationConfigsPayload` (lines 78-91) now always emits `qualityCutoff` when `sourceMode === 'pool'`.
- [ ] Confirm the preview action (`getStrategyDispatchPreviewAction`) still works — its schema already accepts optional `qualityCutoff` so no change expected.

### Phase 2: Bug 2 — filter arena variants at `resolveParent()` call site
- [ ] In `evolution/src/lib/pipeline/loop/runIterationLoop.ts`, around lines 352-360 where `resolveParent({...})` is invoked, build a filtered pool for parent selection only. Compute it once per iteration (outside `dispatchOneAgent`) since `initialPoolSnapshot` is captured iteration-start:
  ```ts
  const inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena);
  // ...inside dispatchOneAgent...
  const resolved = resolveParent({
    sourceMode: iterSourceMode,
    qualityCutoff: iterQualityCutoff,
    seedVariant: seedVariantForResolve,
    pool: iterSourceMode === 'pool' ? inRunPool : initialPoolSnapshot,
    // ratings is still the unfiltered snapshot — same keys/rows; filtered pool handles membership check
    ratings: initialRatingsSnapshot,
    rng: pickRng,
    warn: (msg, c) => logger.warn(msg, { ...c, phaseName: 'generation', iteration, execOrder, dispatchPhase: phase }),
  });
  ```
  Note: `ratings` map can stay unfiltered because `resolveParent` already intersects ratings with `pool` members at `resolveParent.ts:58-62`.
- [ ] In `evolution/src/lib/pipeline/loop/resolveParent.ts`: NO behavioral or type changes. The `empty_pool` guard (resolveParent.ts:47-55) already returns a seed fallback when the filtered pool is empty, and that is the correct behavior.
- [ ] Call-site relabeling in `runIterationLoop.ts`: after receiving `resolved` from `resolveParent`, detect the "filtered-to-empty" case as `resolved.fallbackReason === 'empty_pool' && initialPoolSnapshot.length > 0 && inRunPool.length === 0`. When detected, emit a distinct warn log with `fallbackReason: 'no_same_run_variants'` in the context object so operators can grep for it. Do NOT expose this as a `ResolvedParent.fallbackReason` union value — the resolver cannot observe the distinction so adding it would create an unreachable type state.
- [ ] JSDoc update on `resolveParent()`: "Callers are responsible for filtering the pool to same-run variants when that's desired (see `runIterationLoop.ts` for the standard pattern)."
- [ ] Update `evolution/docs/agents/overview.md` §"Parent linkage" to state arena entries are excluded as candidate parents in pool mode.
- [ ] Warn log at the call site must include `{ inRunSize: inRunPool.length, arenaFilteredCount: initialPoolSnapshot.length - inRunPool.length, iteration, iterIdx }` so ops can spot silent fallbacks in production.

### Phase 3: Bug 2 UX transparency — strengthen `(other run)` badge (safety net for historical data)
- [ ] In `evolution/src/components/evolution/variant/VariantParentBadge.tsx`, replace the italic gray suffix at line 82 (currently `<span className="ml-1 text-[var(--text-secondary)]">(other run)</span>`) with an inline pill that reuses StatusBadge's styling pattern without calling StatusBadge itself (API mismatch — StatusBadge derives its label from `status` via `capitalize()` and has no `children` / `label` prop):
  ```tsx
  <span
    className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-medium border"
    style={{
      backgroundColor: 'color-mix(in srgb, var(--accent-copper) 20%, transparent)',
      color: 'var(--accent-copper)',
      borderColor: 'color-mix(in srgb, var(--accent-copper) 30%, transparent)',
    }}
    data-testid="parent-cross-run-pill"
    aria-label="Parent is from a different run"
  >
    other run{parentRunId ? ` ${parentRunId.substring(0, 6)}` : ''}
  </span>
  ```
- [ ] Add a `parentRunId?: string` prop to `VariantParentBadge` if not already present; wire it from both call sites (arena leaderboard `page.tsx:286`, run-detail Variants tab `VariantsTab.tsx:235` — both have `entry.parent_run_id` / `v.parent_run_id` available).
- [ ] Update `VariantParentBadge.test.tsx` — the existing `expect(badge).toHaveTextContent('(other run)')` assertion (~line 64) must change: new text is `"other run"` (no parens) + optional 6-char run id. Assert the pill is findable via `data-testid="parent-cross-run-pill"` AND retain a text check.
- [ ] Verify both consumer contexts render correctly: arena leaderboard (`page.tsx:286`) and run-detail Variants tab (`VariantsTab.tsx:235`).

### Phase 4: UX 3 — arena topic seed panel (not paginated) + strengthened inline row indicator
- [ ] Extend `getArenaTopicDetailAction` in `evolution/src/services/arenaActions.ts` to also return `seedVariant: ArenaEntry | null`. Query: `.from('evolution_variants').select('*').eq('prompt_id', topicId).eq('generation_method', 'seed').is('archived_at', null).order('elo_score', { ascending: false }).limit(1).maybeSingle()`. Transform via existing `toArenaEntry`. Return `{ ...topic, seedVariant }`.
- [ ] Create `evolution/src/components/evolution/sections/ArenaSeedPanel.tsx`. Props: `{ seed: ArenaEntry }`. Render:
  - Outer container: `<section className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg">` matching EntityDetailHeader chrome.
  - Heading row: `<h2>Seed Variant</h2>` + "Seed" StatusBadge pill.
  - Content preview: `stripMarkdownTitle(seed.variant_content)` truncated to 80 chars, in muted text.
  - Variant ID row: `<span className="font-mono text-xs" title={seed.id}>{seed.id.substring(0, 8)}</span>` + inline click-to-copy handler (5 lines borrowed from `EntityDetailHeader.tsx:37-54`, no shared hook).
  - Metrics row via `<MetricGrid variant='card' columns={3} metrics={[{ label: 'Elo', value: formatEloWithUncertainty(seed.elo_score, seed.uncertainty) }, { label: '95% CI', value: formatEloCIRange(seed.elo_score, seed.uncertainty) }, { label: 'Matches', value: String(seed.arena_match_count) }]} />` (metrics array, NOT children).
  - Link row: `<Link href={\`/admin/evolution/variants/\${seed.id}\`}>View seed variant →</Link>`.
  - Test id: `data-testid="arena-seed-panel"`.
- [ ] In `src/app/admin/evolution/arena/[topicId]/page.tsx`:
  - Read `seedVariant` from the extended topic detail action's result.
  - When `seedVariant !== null`, render `<ArenaSeedPanel seed={seedVariant} />` above the topic details card (or between details and leaderboard).
  - DO NOT filter the seed row out of `sortedEntries` — it remains in the leaderboard body.
  - Strengthen the existing gold "seed" badge at lines 252-256 (bolder font, slightly taller, add a leading star icon, and `data-testid="lb-seed-row-indicator"`).

### Phase 5: UX 4 — variant ID column on arena leaderboard
- [ ] In `src/app/admin/evolution/arena/[topicId]/page.tsx:209-221`, insert a new `<th>ID</th>` between `Content` (line 212) and `Elo` (line 213).
- [ ] In the tbody loop (after line 235), insert a matching `<td>`:
  ```tsx
  <td className="py-2 pr-3 font-mono text-xs text-[var(--text-muted)] cursor-pointer"
      title={`${entry.id} (click to copy)`}
      onClick={() => navigator.clipboard?.writeText(entry.id)}
      data-testid="lb-variant-id">
    {entry.id.substring(0, 8)}
  </td>
  ```
- [ ] No hook extraction; keep inline.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/loop/resolveParent.test.ts`:
  - Update the inline `v()` helper (currently lines 5-15) to accept `fromArena` parameter, OR use the pattern already in `poolSourcing.integration.test.ts:10-16`.
  - Add case: pool contains 2 in-run variants + 3 arena variants → `resolveParent` behavior unchanged (resolver picks any of the 5); regression assertion remains on the `qualityCutoff` logic, NOT on arena filtering (filtering happens at the call site in runIterationLoop).
  - Ensure existing passes.
- [ ] `evolution/src/lib/pipeline/loop/poolSourcing.integration.test.ts`:
  - Add case: `resolveParent` inside `runIterationLoop` dispatch path, pool has arena variants + in-run variants → picked parent is ALWAYS an in-run variant. This is the primary unit-ish test for the behavioral fix.
  - Add case: pool has ONLY arena variants → falls back to seed, warn log includes `fallbackReason: 'no_same_run_variants'` context.
  - Assert warn mock was called with `{ inRunSize: 0, arenaFilteredCount: >=1, ... }` — gives ops a diagnostic signal.
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`:
  - Add case: when `v.parentIds[0]` is undefined / empty string, persisted `parent_variant_id` is `null` (the `|| null` short-circuit works for falsy values including empty string). Regression guard for the Phase 2 fallback path.
  - Add case: when `v.parentIds[0]` is a seed UUID, `parent_variant_id` is that UUID.
- [ ] `src/app/admin/evolution/strategies/new/page.test.tsx` — this file **already exists** with 316 lines. Add a new test case:
  - Mount the component, simulate toggling iteration 2's `sourceMode` to `'pool'` WITHOUT touching the cutoff mode dropdown.
  - Simulate typing `5` in the cutoff value field.
  - Simulate Submit.
  - Assert `createStrategyAction` was called with `iterationConfigs[1] = { agentType: 'generate', sourceMode: 'pool', budgetPercent: ..., qualityCutoff: { mode: 'topN', value: 5 } }`.
- [ ] `evolution/src/services/arenaActions.test.ts`:
  - Add fixture with `generation_method: 'seed'`.
  - Assert `getArenaTopicDetailAction` returns `seedVariant !== null` when a seed exists.
  - Assert `seedVariant === null` when the topic has no seed entry.
  - Assert `is_seed === true` is set on the returned ArenaEntry seed.
  - Assert multi-seed case (two rows with `generation_method='seed'` and different elo_scores) returns the one with highest elo_score.
- [ ] `evolution/src/components/evolution/variant/VariantParentBadge.test.tsx` — update the `(other run)` assertion at line 64 to expect the new StatusBadge wrapper; assert the text content "other run" still appears; verify a test-id or accessible label for the pill.

### Integration Tests
- [ ] Create a NEW real-DB integration test: `src/__tests__/integration/evolution-pool-source-same-run.integration.test.ts`. Pattern after `src/__tests__/integration/evolution-sync-arena.integration.test.ts` (uses `createTestSupabaseClient`, `evolutionTablesExist`, `cleanupEvolutionData`). This is the authoritative regression guard for Bug 2:
  - Set up a prompt + 3 pre-existing arena variants (`synced_to_arena=true`, `prompt_id=target`, `generation_method='pipeline'`, from a different `run_id`). Record their IDs as `arenaIds`.
  - Run `claimAndExecuteRun` with a strategy whose `iterationConfigs = [{agentType:'generate', budgetPercent:50}, {agentType:'generate', sourceMode:'pool', qualityCutoff:{mode:'topN',value:5}, budgetPercent:50}]`.
  - Capture `seedId` by querying `evolution_variants WHERE run_id = <new run> AND generation_method = 'seed'` (or from `evolution_explanations` via the run row) post-completion.
  - Two-query assertion (Supabase JS client doesn't run inline SQL subqueries):
    1. Fetch all variants produced by the new run: `SELECT id, parent_variant_id FROM evolution_variants WHERE run_id = <new>`. Collect their IDs as `newRunIds` and extract the distinct non-null `parent_variant_id` set as `parentIds`.
    2. For every `pid` in `parentIds` assert `pid === seedId OR newRunIds.includes(pid)`. Equivalently, `!arenaIds.includes(pid)` for all `pid`.
  - Explicit negative assertion: `arenaIds.every(aid => !parentIds.includes(aid))` — no new variant's parent may equal any of the 3 pre-seeded arena variant IDs.
  - Note: the existing `evolution/src/__tests__/integration/evolution-iteration-config.integration.test.ts` is a MOCK-LLM vitest harness — it cannot assert persistence; use the real-DB harness instead.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — new test: "pool sourceMode auto-defaults cutoff". Fill wizard; set iteration 2 to Pool; do NOT touch the cutoff-mode dropdown; type `5` in the value field; submit; expect success (no Zod error).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — extend `seedArenaData()` helper (~lines 104-141) to also seed a variant with `generation_method: 'seed'`, `prompt_id=topicId`, `synced_to_arena=true`. Then add tests:
  - `ArenaSeedPanel` visible via `data-testid="arena-seed-panel"`, truncated content preview present.
  - Clicking the panel's "View seed variant" link navigates to `/admin/evolution/variants/{seedId}`.
  - The seed row is still present in the leaderboard table body.
  - Strengthened inline indicator visible via `data-testid="lb-seed-row-indicator"`.
  - New `ID` column visible on every row via `data-testid="lb-variant-id"`; cell `title` contains the full UUID.
  - **Symmetric empty-state test:** create a topic with NO seed (only `generation_method='pipeline'` entries). Assert `data-testid="arena-seed-panel"` is NOT present.

### Manual Verification
- [ ] Create a strategy whose iteration 2 is `sourceMode='pool'` with "top 5 articles" via the wizard — must succeed without Zod error.
- [ ] Execute a 2-iteration run (generate seed + generate pool topN:3) and query DB: all `parent_variant_id` values must be either the seed's UUID or a variant from the same run. No cross-run parents.
- [ ] Visit the arena topic page for a prompt that has a seed: the seed panel renders at top with a working link; the seed row in the leaderboard is visually highlighted.
- [ ] Visit the arena topic page for a topic with NO seed entry (legacy prompt): the seed panel is absent; the leaderboard renders normally.
- [ ] Arena leaderboard rows show an 8-char variant ID cell with a full-UUID tooltip and copy-on-click.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Strategy wizard — pool-mode auto-default flow
- [ ] Arena topic page — seed panel renders, seed row still in table, strengthened row indicator visible, ID column visible
- [ ] Arena topic page — seed panel HIDDEN when topic has no seed
- [ ] `VariantParentBadge` strengthened cross-run StatusBadge visible in Variants tab and arena leaderboard

### B) Automated Tests
- [ ] `npx vitest run evolution/src/lib/pipeline/loop/resolveParent.test.ts`
- [ ] `npx vitest run evolution/src/lib/pipeline/loop/poolSourcing.integration.test.ts`
- [ ] `npx vitest run evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`
- [ ] `npx vitest run evolution/src/services/arenaActions.test.ts`
- [ ] `npx vitest run evolution/src/components/evolution/variant/VariantParentBadge.test.tsx`
- [ ] `npx jest src/app/admin/evolution/strategies/new/page.test.tsx` (or the repo-appropriate test runner for this file)
- [ ] `npm run test:integration -- --testPathPattern="evolution-pool-source-same-run"`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts`

## Documentation Updates
- [ ] `evolution/docs/strategies_and_experiments.md` — update the `sourceMode + qualityCutoff` section: pool mode selects from same-run variants only (arena entries remain as ranking competitors but are excluded as candidate parents).
- [ ] `evolution/docs/arena.md` — note the new seed panel on the arena topic page.
- [ ] `evolution/docs/visualization.md` — arena topic page column list: add "ID" column; note the new seed panel above the leaderboard; note the strengthened seed row indicator.
- [ ] `evolution/docs/agents/overview.md` §"Parent linkage (Phase 2)" — clarify that arena entries are NOT eligible parents in pool mode; reference the call-site filter convention.
- [ ] `evolution/docs/reference.md` — add the new integration test file to the Testing Infrastructure section.

## Rollback / Feature Flag
No feature flag. The Bug 2 fix is a behaviour change but the direction was confirmed by product intent (user). If it regresses, revert the Phase 2 commit (the call-site filter is ~5 lines in `runIterationLoop.ts`). The strengthened `VariantParentBadge` (Phase 3) is a safety net; if it visually regresses, revert the Phase 3 commit independently.

## Open Questions
_(none — Bug 2 direction, UX 3 behaviour, and file placement all confirmed)_
