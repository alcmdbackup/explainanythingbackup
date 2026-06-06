# Match Viewer With Experimentation Procedures Plan

## Background
Build a match viewer for the evolution pipeline — an admin UI to inspect the outcomes of recent judge matches (pairwise comparisons). It should let an operator view recent matches, filter them by run id, select a match from a list, and experiment with judging in realtime by re-running the comparison with different models and different judge prompts. The goal is to make the previously-invisible judging step inspectable and to provide a low-friction sandbox for tuning judge model and prompt choices.

## Requirements (from GH Issue #NNN)
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
- [ ] **Option A: Standalone `/admin/evolution/matches` page with a run-id filter** — one list of recent matches across runs, filterable by run id (and likely prompt). Best matches the requirements ("recent matches" + "filter by run id"). Recommended.
- [ ] **Option B: Nested tab on run detail (`/admin/evolution/runs/[runId]?tab=matches`)** — matches scoped to a single run. Good drill-down but no "recent across all" view.
- [ ] **Option C: Both** — standalone list links into per-run views. More surface area; defer the per-run tab to a follow-up.

### Realtime re-judge semantics
- [ ] **Option A: Display-only sandbox (ephemeral, no DB write, no Elo mutation)** — reuse `compareWithBiasMitigation`; show result inline. No schema change, no cascade risk. Recommended.
- [ ] **Option B: Persist re-judgements** — write new comparison rows / track judge model. Requires schema (`judge_model`, `judge_prompt` columns) + rating-cascade design. Out of scope for v1.

### "Different judge prompts" input
- [ ] **Option A: Preset rubric toggle (article vs paragraph, already supported by `mode`)** — lowest effort.
- [ ] **Option B: Free-text custom prompt / instruction override** — most flexible; matches "try different judge prompts" intent.
- [ ] **Option C: Both** — presets + editable text area seeded from the chosen preset. Recommended.

## Phased Execution Plan

### Phase 1: Read path — match list + detail (display existing data)
- [ ] Add server action `getRecentMatchesAction({ runId?, promptId?, limit })` (new file `evolution/src/services/matchViewerActions.ts`, or extend `arenaActions.ts`) querying `evolution_arena_comparisons` ordered by `created_at DESC`, filterable by `run_id`. Cap rows (≤200) per existing safety convention.
- [ ] Add server action `getMatchDetailAction({ comparisonId })` that returns the comparison row plus both variants' `variant_content`, ids, Elo, and run/prompt context (batch-fetch `evolution_variants`).
- [ ] Build `/admin/evolution/matches` page (client component) using `EntityListPage` shell: columns Created, Run, Prompt, Entry A (preview), Entry B (preview), Winner, Confidence; run-id filter input + "Hide test content" default filter consistent with other evolution list pages.
- [ ] Build match-detail view (route `/admin/evolution/matches/[comparisonId]` or expandable panel) showing both texts side-by-side, the stored winner + confidence, and run/prompt links.
- [ ] Add the new page to the evolution admin sidebar/nav (locate the nav definition first).

### Phase 2: Realtime re-judge sandbox (display-only)
- [ ] Add server action `rejudgeComparisonAction({ entryAId, entryBId, judgeModel?, judgePrompt?, mode? })` that fetches both texts, builds `callLLM` over the chosen model via `src/lib/services/llms.ts`, calls `compareWithBiasMitigation` (or a custom-prompt path), and returns `{ winner, confidence, turns, costUsd? }` WITHOUT writing to the DB or mutating ratings.
- [ ] Support a model picker on the match-detail view sourced from `getModelOptions()` (default `DEFAULT_JUDGE_MODEL`).
- [ ] Support a judge-prompt control: preset (article/paragraph via `mode`) + editable instruction text area; thread a custom prompt builder when overridden.
- [ ] Render the realtime result next to the stored result for comparison (decision, confidence, which model/prompt produced it). Mark clearly as "not persisted".
- [ ] Add a lightweight per-call cost guard / display using existing pricing helpers.

### Phase 3: Polish & docs
- [ ] Loading / error / empty states; disable re-judge button while in flight; show latency.
- [ ] Update `evolution/docs/visualization.md` (new page), `evolution/docs/reference.md` (new actions/files), and note in `evolution/docs/arena.md` / `rating_and_comparison.md` how the viewer reuses the comparison primitive.

## Testing

### Unit Tests
- [ ] `evolution/src/services/matchViewerActions.test.ts` — `getRecentMatchesAction` builds correct query (run_id filter, ordering, cap); `getMatchDetailAction` joins variant content; `rejudgeComparisonAction` calls `compareWithBiasMitigation` with the chosen model and does NOT write to DB.
- [ ] Match-list/detail component unit tests (render rows, winner/confidence formatting, model picker default, custom-prompt toggle) under the relevant `evolution/src/components/evolution/` path.

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
