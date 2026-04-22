# Research

## Problem Statement

Two bugs + two UX gaps reported in the evolution system on 2026-04-21:

1. **Bug 1 — Strategy creation with top-X pool source rejected.** Creating a strategy whose iteration uses `sourceMode='pool'` with "top X articles" fails schema validation: `{ "code": "custom", "message": "qualityCutoff required when sourceMode is pool", "path": [ "iterationConfigs", 1 ] }`.
2. **Bug 2 — Orphan parent lineage on stage run.** On staging run `6743c119-8a52-44e5-8102-0b1f4b212f40`, some variants have `parent_variant_id` pointing to a variant that is neither the seed nor another variant in the run's own pool.
3. **UX 3 — Arena topic page: surface and link the seed.** Every arena topic page should have a UI element at the top that clearly displays the seed variant and links to its detail page.
4. **UX 4 — Arena entries: show variant ID.** Arena leaderboard entries should display the underlying variant ID in the UI.

## Requirements
- Reproduce each bug with a concrete failing input / query
- Identify root cause (cite file:line) for Bugs 1 and 2
- Enumerate fix options with tradeoffs
- Specify regression test that would have caught each bug
- For UX 3: locate arena topic page, seed-variant resolution path, and existing seed-badge rendering
- For UX 4: locate arena leaderboard row component, current column set, and pattern for displaying variant IDs

## High Level Summary

- **Bug 1** is a wizard-side state bug. `qualityCutoffMode` starts `undefined` and only gets the `'topN'` default at render time (`?? 'topN'` fallback). If the user switches `sourceMode` to `'pool'` and types a cutoff value without ever clicking the mode dropdown, the emitted payload is `{ sourceMode: 'pool' }` with no `qualityCutoff`, and Zod rejects it. Fix: initialize `qualityCutoffMode: 'topN'` and `qualityCutoffValue: 5` in state when `sourceMode` transitions to `'pool'`. Same anti-pattern exists on lines 841 and 857 and should be cleaned up in-flight.
- **Bug 2 is by-design behaviour poorly surfaced in one UI surface.** `resolveParent()` for `sourceMode='pool'` intentionally draws from the full pool including arena entries (from prior runs of the same prompt). The arena variant's TEXT is genuinely used as the generation source, so lineage to that variant is correct. The multi-iteration plan (2026-04-15) Decision 11 explicitly says "arena entries still enter pool as competitors". Good news: `VariantParentBadge` already renders an `(other run)` suffix when `parent_run_id !== run_id`, and it's wired on both the arena leaderboard and run-detail Variants tab. Bad news: it's easy to miss — small italic text. The Timeline and Snapshots tabs do NOT expose `sourceMode`, so a user looking at a run's Timeline cannot tell that iteration 2 drew parents from arena. Fix = UX clarification, not behaviour change: strengthen the cross-run badge and surface `sourceMode` in Timeline + Snapshots.
- **UX 3** — seed panel. `ArenaEntry.is_seed` already computed by `getArenaEntriesAction`. Add an `ArenaSeedPanel` component above the leaderboard, hide the seed row from the leaderboard table when panel is shown, reuse `stripMarkdownTitle` + `MetricGrid` + a `useCopyableId` hook extracted from `EntityDetailHeader`.
- **UX 4** — add a compact "ID" column to the arena leaderboard using the same pattern as `/admin/evolution/variants` (8-char truncated, full UUID in `title` tooltip, click-to-copy).

## Documents Read
- `docs/docs_overall/debugging.md` — staging DB access via `npm run query:staging`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `evolution/docs/architecture.md` — iteration loop, config-driven dispatch, parent lineage
- `evolution/docs/strategies_and_experiments.md` — `sourceMode` / `qualityCutoff` Phase 2 spec, Decision 11
- `evolution/docs/arena.md` — seed handling 2026-04-15, `synced_to_arena` semantics
- `evolution/docs/data_model.md` — `evolution_variants.parent_variant_id`, stale trigger
- `evolution/docs/reference.md` — key file index
- `evolution/docs/agents/overview.md` — `GenerateFromPreviousArticleAgent` semantics
- `evolution/docs/visualization.md` — arena UI, leaderboard columns
- `docs/planning/multi_iteration_strategy_support_evolution_20260415/_planning.md` — Phase 2 design decisions

## Code Files Read
- `src/app/admin/evolution/strategies/new/page.tsx` — wizard, `toIterationConfigsPayload`, `updateIteration`
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema` + refinements
- `evolution/src/services/strategyRegistryActionsV2.ts` — `createStrategyAction`
- `evolution/src/lib/pipeline/loop/resolveParent.ts` — parent selection for pool mode
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — orchestrator, `initialPoolSnapshot`, `parentText`
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — `parentIds` set from `input.parentVariantId`
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — arena loading into initial pool
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `parent_variant_id: v.parentIds[0] ?? null`
- `evolution/src/lib/pipeline/arena.ts` — `loadArenaEntries`, `isArenaEntry`
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — leaderboard columns, seed badge, cutoff
- `evolution/src/services/arenaActions.ts` — `ArenaEntry` type (20 fields), `getArenaEntriesAction`, `parent_run_id` plumbing
- `evolution/src/components/evolution/variant/VariantParentBadge.tsx` — cross-run rendering (`"(other run)"`)
- `evolution/src/components/evolution/sections/EntityDetailHeader.tsx` — inline copy handler
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — run-detail Variants tab, Parent column
- `evolution/src/components/evolution/tabs/TimelineTab.tsx`, `SnapshotsTab.tsx` — no `sourceMode` exposure
- `evolution/src/components/evolution/visualizations/VariantCard.tsx`, `VariantDetailPanel.tsx`
- `evolution/src/components/evolution/primitives/MetricGrid.tsx` — card variants
- `evolution/src/lib/shared/computeRatings.ts` — `stripMarkdownTitle` (line ~140)
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts`, `admin-strategy-wizard.spec.ts`
- `evolution/src/services/arenaActions.test.ts`
- `evolution/src/lib/pipeline/loop/resolveParent.test.ts`

## Key Findings

### Bug 1 — wizard-side state bug, schema is correct

- **Wizard emit:** `src/app/admin/evolution/strategies/new/page.tsx:78-91` (`toIterationConfigsPayload`). Conditional emission of `qualityCutoff` requires `it.qualityCutoffMode` truthy. Iteration row interface (`lines 34-45`) starts with `qualityCutoffMode?: 'topN' | 'topPercent'` undefined. Dropdown renders with `?? 'topN'` fallback at `line 867` — display only, doesn't persist.
- **Schema refinement:** `evolution/src/lib/schemas.ts:407-408` — correct: `.refine((c) => c.sourceMode !== 'pool' || c.qualityCutoff !== undefined, ...)`. The refinement also nests a second Zod rule that `qualityCutoff.value` must be positive (`schemas.ts:383`), so both `mode` AND `value` need defaults to make the "user picks pool, doesn't type" path succeed — but realistically users WILL type a value; the only missing state is `mode`.
- **Adjacent latent bugs (same anti-pattern):** `sourceMode ?? 'seed'` at line 841, `qualityCutoffValue ?? ''` at line 857. Both are render-time fallbacks that don't persist. The `updateIteration` handler at `lines 384-402` only clears fields when `sourceMode !== 'pool'`; it doesn't initialize when transitioning TO pool.
- **Wizard is create-only** (no edit path), so we don't need to worry about loading a persisted config into the form state.

**Recommended fix:** In `updateIteration()`, when the patch flips `sourceMode` to `'pool'`, default `qualityCutoffMode: 'topN'` and `qualityCutoffValue: 5` if unset. Also clean up the `sourceMode ?? 'seed'` pattern to make the default explicit in state.

### Bug 2 — by-design cross-run lineage, UX-only fix

- **Staging evidence** (via `npm run query:staging`): run `6743c119...` is a prompt-based run with strategy `d9f68912...` "New strategy with agent cost fixes - flash lite". Iteration 1 (index 1) has `sourceMode='pool'`, `qualityCutoff={mode:'topPercent', value:30}`. 15 variants produced: 7 gen-1 with parent = seed (`26ab2327...`), 8 gen-2 with parents from 6 distinct prior runs of the same prompt. All "orphan" parents are `synced_to_arena=true`, `generation_method='pipeline'`, `archived_at=null`.
- **Code path confirmation:**
  - `loadArenaEntries()` (`buildRunContext.ts:316-328`) intentionally pulls arena variants into `initialPool` as "competitors".
  - `resolveParent()` has no arena filter; any variant in the pool (including `fromArena=true`) may be drawn.
  - `runIterationLoop.ts:374` — `parentText: resolved.text` — the arena variant's actual body text is passed as the parent article. `generateFromPreviousArticle.ts:174` uses it in `buildPromptForTactic(parentText, tactic)`. So the lineage pointer is semantically accurate: THAT variant's text was the generation source.
  - `generateFromPreviousArticle.ts:228` — `parentIds: input.parentVariantId ? [input.parentVariantId] : []`. `persistRunResults.ts:231` persists `parent_variant_id: v.parentIds[0] || null`.
- **Design intent:** multi_iteration_strategy_support_evolution_20260415 Decision 11: "Arena entries: Still load into pool as competitors (only seed is removed)." Phase 2 of that plan: "Keep `loadArenaEntries()` behavior (arena entries still enter pool as competitors)." No documented restriction on arena-as-parent.
- **UI state today:**
  - `VariantParentBadge` (`evolution/src/components/evolution/variant/VariantParentBadge.tsx`) **already renders `(other run)` suffix** when `crossRun={true}` is passed (`line 82`).
  - Arena leaderboard (`page.tsx:286`) passes `crossRun={!!entry.parent_run_id && entry.parent_run_id !== entry.run_id}`.
  - Run-detail Variants tab (`VariantsTab.tsx:235`) passes the same `crossRun` flag.
  - `parent_run_id` is plumbed end-to-end through both `ArenaEntry` and `EvolutionVariant` types.
  - **Gap:** Timeline tab and Snapshots tab do NOT expose per-iteration `sourceMode`, so a user looking at run detail cannot tell at a glance that iteration 1 was a pool iteration that drew parents from arena.

**Recommended "fix":** this is not a bug, it's a UX discoverability issue. Two surgical changes:

1. Strengthen `VariantParentBadge`'s cross-run suffix (e.g., change italic gray `(other run)` to a distinct color-coded pill, and optionally show `(run abc12345)` when the parent run ID is available).
2. Surface `iterationConfigs[i].sourceMode` on the Timeline tab iteration cards and the Snapshots tab header (e.g. a small "Pool (top 30%)" chip next to the agent-type badge).

### UX 3 — seed panel at top of arena topic page

- `ArenaEntry` type (`arenaActions.ts:48-75`) has 20 fields including `id`, `elo_score`, `uncertainty`, `arena_match_count`, `generation`, `model`, `cost_usd`, `parent_run_id`, `is_seed` (computed).
- `getArenaEntriesAction` already returns the seed entry (if one exists) because it's just another row with `synced_to_arena=true`.
- **No unique constraint** on `(prompt_id, generation_method='seed')`. `EVOLUTION_REUSE_SEED_RATING` defaulting `true` means seeds are reused by UUID now, but legacy data can have duplicates. `resolveContent()` in `buildRunContext.ts:175` picks highest-`elo_score` with `.limit(1)` — match that convention in the UI.
- **Content truncation:** `stripMarkdownTitle()` in `evolution/src/lib/shared/computeRatings.ts:140-144` + the 60-char slice used by `ContentLink` (`page.tsx:28-36`).
- **Copy-to-clipboard:** inline logic in `EntityDetailHeader.tsx:37-54`. Worth extracting to a `useCopyableId(id)` hook during this project.
- **Leaderboard seed row:** `page.tsx:252-256` renders gold "seed" badge in Method column; when the panel ships, hide the seed row from the table body (filter `is_seed` out of `sortedEntries`).
- **Empty state:** if no entries at all, current page shows "No entries yet." — extend to also hide the seed panel OR show "No seed yet." placeholder.

### UX 4 — variant ID column on arena leaderboard

- Table header is hardcoded `<thead><tr>` at `page.tsx:209-221`. Insert a new `<th>ID</th>` between `Content` (line 212) and `Elo` (line 213).
- Matching `<td>` in tbody loop, pattern from variants list page: `<span className="font-mono text-xs" title={entry.id}>{entry.id.substring(0, 8)}</span>` — click-to-copy optional (reuse the extracted `useCopyableId` hook).
- E2E survives: `lb-row-{index}` data-testids are column-independent.

## Fix Options & Tradeoffs

### Bug 1
| Option | Locus | Pro | Con |
|---|---|---|---|
| A. Default `qualityCutoffMode` in `DEFAULT_ITERATIONS` | page.tsx:~60 | Simplest, one-liner | Adds state even for seed-mode iterations (dead weight) |
| **B. Init on sourceMode→'pool' in `updateIteration`** | page.tsx:384-402 | **Targeted, intent-revealing, no dead state** | Slightly more code |
| C. Loosen schema to treat missing `qualityCutoff` as `{topN, 5}` default | schemas.ts:407 | Backward-compat | Hides user error; server guesses intent |
| D. Emit fallback at payload build time | page.tsx:78-91 | Fixes wire format only | Hides wizard-state inconsistency |

**Recommend B** + clean up sibling render-time fallbacks (lines 841, 857).

### Bug 2
| Option | Locus | Pro | Con |
|---|---|---|---|
| A. Filter arena variants from `resolveParent` | resolveParent.ts | Eliminates cross-run lineage surprise | Breaks explicit design decision; throws away the point of pool sourcing (prompt-level evolution) |
| **B. Accept as-designed; improve UX surfacing** | VariantParentBadge + TimelineTab + SnapshotsTab | **Matches design intent, minimal risk** | Doesn't "fix" the symptom, just makes it self-explanatory |
| C. Hybrid: arena parents OK only if `qualityCutoff` says so | resolveParent.ts + schema | Flexible per-strategy | Adds a config knob nobody asked for |

**Recommend B** pending user confirmation — the user's original report framed this as a bug, but the actual behavior is intentional. Worth showing the user Round 3 findings before locking in.

### UX 3 — seed panel
- Single option: add `ArenaSeedPanel` above the leaderboard, reuse existing helpers, hide the seed row from the table body. Empty state: hide panel. Multiple seeds: pick highest `elo_score`.

### UX 4 — variant ID column
- Single option: match the `/admin/evolution/variants` list pattern (truncated + tooltip). Optional copy handler via extracted `useCopyableId` hook.

## Regression Tests

### Bug 1
- `evolution/src/lib/schemas.test.ts` — already has the negative case (`iterationConfigSchema.test.ts:26-30`). Add positive case: emitted payload with auto-defaulted `qualityCutoff` passes.
- `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — add test: fill wizard, set iteration 2 to Pool mode, do NOT touch cutoff-mode dropdown, type value 5, submit → expect success.

### Bug 2
- If we go with Option B (UX only), add a Playwright assertion that the run-detail Timeline tab shows `"Pool"` tag on a pool-mode iteration card, and the Variants tab parent badge shows a visually distinct `(other run)` indicator.
- If we go with Option A (filter arena), add unit test: `resolveParent()` with a pool containing `fromArena=true` variants must not select them as `variantId`.

### UX 3
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — assert the seed panel renders, links to `/admin/evolution/variants/${seed.id}`, and the seed row is hidden from the table body.
- `evolution/src/services/arenaActions.test.ts` — existing test already has fixture data; add a seed-present case and a seed-absent case.

### UX 4
- `admin-arena.spec.ts` — assert the leaderboard table has an ID column and the cell `title` contains the full UUID.

## Open Questions

1. **Bug 2 reframe** — does the user want us to:
   - (a) Treat this as a UX clarification project (recommended: strengthen cross-run badge + surface sourceMode on Timeline/Snapshots tabs), OR
   - (b) Treat this as a real bug and filter arena variants from `resolveParent()` candidate pool?

   These give very different pipelines. **Before writing the plan, confirm with user.**

2. **Bug 1 default value** — `topN: 5` is intuitive for "top X articles" language, matches placeholder at line 862. Ok?

3. **UX 3** — when a topic has no seed (e.g. old prompts created before seed-as-entity), should the panel:
   - Hide entirely (cleanest), OR
   - Render a placeholder "No seed yet — create one with a new run"?
   Recommended: hide, since that matches current empty-state behavior.

4. **UX 4** — should the ID column be click-to-copy (adds a hook) or just tooltip + click-nav (simpler)?

5. **Adjacent Bug 1 cleanup** — clean up render-time fallbacks at lines 841 and 857 in the same commit? Small scope creep but they're latent versions of the exact same bug.
