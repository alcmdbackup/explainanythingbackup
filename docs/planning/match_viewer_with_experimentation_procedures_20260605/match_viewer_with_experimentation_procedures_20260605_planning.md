# Match Viewer With Experimentation Procedures Plan

## Background
Build a match viewer for the evolution pipeline — an admin UI to inspect the outcomes of recent judge matches (pairwise comparisons). It should let an operator view recent matches, filter them by run id, select a match from a list, and experiment with judging in realtime by re-running the comparison with different models and different judge prompts. The goal is to make the previously-invisible judging step inspectable and to provide a low-friction sandbox for tuning judge model and prompt choices.

## Requirements (from GH Issue #1165)
build a match viewer.
- View outcome of recent matches
- Filter matches by run id
- Select from list of recent matches
- Try judging in realtime with
    - with different models
    - with different judge prompts

## Problem
Judge matches (pairwise LLM comparisons that drive Elo ratings) are written to `evolution_arena_comparisons` but there is no admin UI to browse them: you cannot see which two texts were compared, what the judge decided, or how confident it was. There is also no way to experiment with the judging decision — to ask "would a different model or a different rubric have judged this pair differently?" — without launching a whole new strategy run. This makes judge-model/prompt tuning slow and opaque.

## Options Considered

### Match list placement
- [x] **Option A (CHOSEN): Standalone `/admin/evolution/matches` page with a run-id filter** — one list of recent matches across runs, filterable by run id (+ winner/confidence/test-content). Best matches the requirements; the runs/arena list pattern transfers directly. `/admin/evolution/page.tsx` redirects to `/experiments`, so a standalone page avoids restructuring.
- [ ] **Option B: Nested tab on run detail (`/admin/evolution/runs/[runId]?tab=matches`)** — matches scoped to a single run. Good drill-down but no "recent across all" view. Possible later add-on.
- [ ] **Option C: Both** — standalone list links into per-run views. More surface area; defer the per-run tab to a follow-up.

### Realtime re-judge semantics
- [x] **Option A (CHOSEN): Display-only sandbox (ephemeral, no comparison/Elo write)** — reuse `compareWithBiasMitigation` via plain `callLLM`; show result inline. No schema change. **Verified caveat:** each LLM call writes a `llmCallTracking` audit row (existing table); cost-metric writes are avoided by NOT passing `db`/`runId` to the evolution LLM client. No ratings/arena/comparison-row mutation.
- [ ] **Option B: Persist re-judgements** — write new comparison rows / track judge model. Requires schema (`judge_model`, `judge_prompt` columns) + rating-cascade design. Out of scope for v1.

### "Different judge prompts" input
- [x] **Option C (CHOSEN): Both** — preset toggle (`article`/`paragraph`, already supported by `mode`) + collapsible free-text override. Requires a new optional `customPromptOverride?` param on `buildComparisonPrompt` + `compareWithBiasMitigation` (optional → 8 existing callers unaffected); override must preserve `## Text A` / `## Text B` / `Your answer:` for `parseWinner`.
- [ ] **Option A: Preset rubric toggle only** — lowest effort; no primitive change.
- [ ] **Option B: Free-text override only** — flexible but loses the curated presets.

## Phased Execution Plan

> File targets verified against source (20-agent research, 2026-06-06). New server actions live in `evolution/src/services/arenaActions.ts` (alongside `getArenaComparisonsAction`), wrapped with the `adminAction` factory (`evolution/src/services/adminAction.ts:26`).

### Phase 1: Read path — match list + detail (display existing data)
- [ ] Add `getRecentMatchesAction({ runId?, topicId?, winner?, minConfidence?, filterTestContent?, limit?, offset? }) => { items: ArenaComparison[]; total }` in `arenaActions.ts` (`getArenaComparisonsAction` filters by `prompt_id` only). Query `evolution_arena_comparisons` `.select('*', { count: 'exact' })`, `.order('created_at', desc)`, `.range()`; cap ≤200/page; uses index `idx_arena_comparisons_run_iteration`.
- [ ] Implement test-content exclusion via the **nested join** `evolution_runs.evolution_strategies.is_test_content = false` (the comparisons table has no `is_test_content` column).
- [ ] Add `getComparisonDetailAction({ comparisonId })` returning the comparison row + both variants' `variant_content` (batch `.in('id', [entry_a, entry_b])`) + run/prompt context; render a "Deleted variant [uuid]" placeholder when a variant is missing (entry FKs were dropped).
- [ ] Build `/admin/evolution/matches/page.tsx` (`'use client'`) with `EntityListPage<ArenaComparison>`: columns Created, Run, Prompt, Entry A preview, Entry B preview, Winner (badge), Confidence (%); filters run-id (text), winner (select), min-confidence (text), "Hide test content" (checkbox, default on); `getRowHref → /admin/evolution/matches/[comparisonId]`.
- [ ] **Add the sidebar nav link** in `src/components/admin/EvolutionSidebar.tsx` 'Results' group (after Arena): `{ href: '/admin/evolution/matches', label: 'Match Viewer', icon: '⚖️', testId: 'evolution-sidebar-nav-matches', description: 'Judge match history and re-run comparisons' }` (auto-active via `startsWith`).
- [ ] **Link the match viewer from the evolution admin dashboard** — add a quick-link card on `/admin/evolution-dashboard` (verify a quick-links section still exists; if it was removed, the sidebar link is the canonical surface and note that in docs).

### Phase 2: Realtime re-judge sandbox (display-only)
- [ ] Add optional `customPromptOverride?: string` param to `buildComparisonPrompt` + `compareWithBiasMitigation` (`evolution/src/lib/shared/computeRatings.ts`); when set, use it directly instead of the built-in rubric. Preserve `## Text A` / `## Text B` / `Your answer:`. Add a unit test asserting all existing callers are byte-for-byte unchanged when the param is omitted.
- [ ] Add `rejudgeComparisonAction({ comparisonId, judgeModel, mode?, customPrompt? }) => { winner, confidence, turns, costUsd }` in `arenaActions.ts`: validate (UUID + model in `MODEL_REGISTRY`), fetch both texts, build a `callLLM` closure over `src/lib/services/llms.ts:callLLM` for the chosen model, call `compareWithBiasMitigation`. **Do NOT write to `evolution_arena_comparisons`, do NOT call rank/merge agents, and do NOT pass `db`/`runId` to any evolution LLM client** (avoids `evolution_metrics` cost writes). Compute cost via `calculateLLMCost`.
- [ ] Build `/admin/evolution/matches/[comparisonId]/page.tsx` (mirror variant detail): tabs for Metadata, Stored comparison (side-by-side texts via `SideBySideWordDiff`/`VariantContentSection` + stored winner/confidence), and a Re-judge sandbox.
- [ ] Re-judge sandbox UI: model picker from `getModelOptions()` (default `DEFAULT_JUDGE_MODEL`, exclude/flag reasoning models); preset toggle (`article`/`paragraph`) + collapsible custom-prompt textarea; "Re-judge" button → `rejudgeComparisonAction`; render result next to the stored result with cost + a clear "not persisted" marker. Document that judge calls are forced `temperature=0`.

### Phase 3: Polish, dashboard link & docs
- [ ] Loading / error / empty states; disable re-judge while in flight; show latency; breadcrumb on detail page.
- [ ] (Optional) transient per-session spend guard for ad-hoc re-judges.
- [ ] Update `evolution/docs/visualization.md` (new page + sandbox), `evolution/docs/reference.md` (new actions/files/routes), and note in `evolution/docs/arena.md` / `rating_and_comparison.md` how the viewer reuses the comparison primitive display-only.

## Testing

### Unit Tests
- [ ] `arenaActions` tests — `getRecentMatchesAction` builds correct query (run_id `.eq`, `created_at` desc, `count:'exact'`, range cap, nested test-content filter); `getComparisonDetailAction` joins variant content + handles a missing variant; `rejudgeComparisonAction` calls `compareWithBiasMitigation` with the chosen model, returns `{winner,confidence,turns,costUsd}`, and makes **no** Supabase write call (assert insert/update/upsert never invoked) and never passes `db`/`runId` to the evolution client.
- [ ] `computeRatings` test — `buildComparisonPrompt`/`compareWithBiasMitigation` output is byte-for-byte unchanged when `customPromptOverride` is omitted (backward-compat guard for the 8 existing callers); and uses the override verbatim when provided.
- [ ] Match-list/detail component unit tests (render rows, winner/confidence formatting, model picker default `qwen-2.5-7b-instruct`, preset toggle + custom-prompt textarea, "not persisted" marker).

### Integration Tests
- [ ] `src/__tests__/integration/match-viewer.integration.test.ts` — against real Supabase: seed a run + two variants + a comparison row, assert `getRecentMatchesAction`/`getMatchDetailAction` return them; assert filter-by-run-id isolates rows. Auto-skip when evolution tables not migrated (existing pattern). Include `afterAll` cleanup via evolution test helpers.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-matches.spec.ts` (`{ tag: '@evolution' }`) — admin navigates to `/admin/evolution/matches`, `resetFilters()`, sees seeded match, filters by run id, opens detail (both texts visible), runs a realtime re-judge with a mocked LLM route and sees a result rendered. Use `evolution-test-data-factory` (requires `afterAll` cleanup per ESLint `require-test-cleanup`).

### Manual Verification
- [ ] On local server, open `/admin/evolution/matches`, filter by a real run id, open a match, re-judge with two different models and an edited prompt; confirm results render and nothing is persisted.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-matches.spec.ts` against the local tmux server (via `npm run test:e2e`).

### B) Automated Tests
- [ ] `npm run test:unit -- matchViewer` (unit), `npm run test:integration` (match-viewer integration), `npm run lint && npm run typecheck && npm run build`.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/visualization.md` — document the new `/admin/evolution/matches` page + match detail + re-judge sandbox.
- [ ] `evolution/docs/reference.md` — add new server actions (`getRecentMatchesAction`, `getMatchDetailAction`, `rejudgeComparisonAction`) and component/route files.
- [ ] `evolution/docs/arena.md` — note the viewer as a reader of `evolution_arena_comparisons`.
- [ ] `evolution/docs/rating_and_comparison.md` — note that realtime re-judge reuses `compareWithBiasMitigation` / `buildComparisonPrompt` display-only.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
