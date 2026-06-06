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
- [ ] **Add a new `Tools` nav group** to `src/components/admin/EvolutionSidebar.tsx` `navGroups` (after the `Results` group). Match Viewer is a *tool*, not an entity, so it gets its own section rather than going under `Entities`/`Results`: `{ label: 'Tools', items: [{ href: '/admin/evolution/matches', label: 'Match Viewer', icon: '⚖️', testId: 'evolution-sidebar-nav-matches', description: 'Judge match history and re-run comparisons' }] }`. Active-state + `activeOverrides` are auto-derived from `navGroups` (`startsWith`), so no extra wiring.
- [ ] **Link the match viewer from the evolution admin dashboard** — add a quick-link card on `/admin/evolution-dashboard` (the `Overview › Dashboard` nav target). Verify a quick-links/card section exists; if not, add a small one. Sidebar `Tools` link is the canonical nav surface.
- [ ] **Deep-link every match-history surface to the viewer.** Extend `getVariantMatchHistoryAction` + the `VariantMatchEntry` interface (`evolution/src/services/variantDetailActions.ts:403,:76`) with `comparisonId` (from `c.id`), and add an "Open in Match Viewer" link (→ `/admin/evolution/matches/[comparisonId]`) per row in `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` (the variant detail "Matches" tab — the only rendered match-history list today). Any future arena-comparisons list already carries `ArenaComparison.id` and links natively.

### Phase 2: Realtime re-judge sandbox (display-only)

> **Decision: always 2-pass.** Re-judge uses the same 2-pass A/B reversal as production judging (forward + reverse, run in parallel; confidence derived from `aggregateWinners`). No single-pass toggle — each re-judge = 2 LLM calls, surfaced as the forward + reverse entries in `passes`.
- [ ] Add optional `customPromptOverride?: string` param to `buildComparisonPrompt` + `compareWithBiasMitigation` (`evolution/src/lib/shared/computeRatings.ts`); when set, use it directly instead of the built-in rubric. Preserve `## Text A` / `## Text B` / `Your answer:`. Add a unit test asserting all existing callers are byte-for-byte unchanged when the param is omitted.
- [ ] Add `rejudgeComparisonAction({ comparisonId, judgeModel, mode?, customPrompt?, temperature?, explainReasoning? }) => { winner, confidence, turns, costUsd, passes }` in `arenaActions.ts`, where `passes: { direction: 'forward' | 'reverse'; prompt: string; rawResponse: string; parsedWinner: 'A'|'B'|'TIE'|null }[]`. Validate (UUID + model in `MODEL_REGISTRY`), fetch both texts, then run the 2-pass reversal via `run2PassReversal` (`computeRatings.ts:291`) so the `buildPrompts`/`callLLM`/`parseResponse` closures can **capture the exact prompt sent and the raw model response per pass** into `passes`. Build the `callLLM` closure over `src/lib/services/llms.ts:callLLM` for the chosen model **passing `temperature`**. **Do NOT write to `evolution_arena_comparisons`, do NOT call rank/merge agents, and do NOT pass `db`/`runId` to any evolution LLM client** (avoids `evolution_metrics` cost writes). Compute cost via `calculateLLMCost`.
- [ ] **Raw prompt + reasoning support.** When `explainReasoning` is on, the judge prompt instructs the model to give a brief rationale and then end with a strict final verdict line (`Your answer: A|B|TIE`). Parse the verdict with a **reasoning-tolerant parser** that scans the LAST verdict marker — e.g. the last match of `/(?:your answer|verdict|winner)\s*:?\s*\**\s*(A|B|TIE)\b/gi` — **not** `parseWinner` (which is anchored to the start and does a bare `contains 'EQUAL'|'TIE'|'DRAW'` that a reasoning paragraph would false-trigger). Always return `rawResponse` in `passes` regardless of parse success so the reasoning is visible even when the verdict can't be extracted (surface "verdict unparsed" in that case). When `explainReasoning` is off, keep `parseWinner` (single-token path) unchanged.
- [ ] Build `/admin/evolution/matches/[comparisonId]/page.tsx` (mirror variant detail): tabs for Metadata, Stored comparison (side-by-side texts via `SideBySideWordDiff`/`VariantContentSection` + stored winner/confidence), and a Re-judge sandbox.
- [ ] Re-judge sandbox UI: model picker from `getModelOptions()` (default `DEFAULT_JUDGE_MODEL`, exclude/flag reasoning models); preset toggle (`article`/`paragraph`) + collapsible custom-prompt textarea; **temperature slider** (default `0`, range `0…model maxTemperature`; disabled/hidden when the model has no `maxTemperature` since `clampTemperature` returns undefined); **"Explain reasoning" toggle** (off by default). "Re-judge" button → `rejudgeComparisonAction`; render each result as a stacked card next to the stored result, labeled with model + temp + prompt, with cost + a clear "not persisted" marker. Note in the UI that `temp > 0` makes the 2-pass reversal non-deterministic (intended for experimentation).
- [ ] Each result card has **collapsible "Prompt" and "Model output" sections per pass** (forward + reverse) showing the exact `passes[].prompt` sent and the `passes[].rawResponse` returned — so the operator can read the raw judge prompt and, when "Explain reasoning" is on, the model's full rationale. Reasoning mode increases output tokens → note higher cost/latency in the cost line.

### Phase 3: Polish, dashboard link & docs
- [ ] Loading / error / empty states; disable re-judge while in flight; show latency; breadcrumb on detail page.
- [ ] (Optional) transient per-session spend guard for ad-hoc re-judges.
- [ ] Update `evolution/docs/visualization.md` (new page + sandbox), `evolution/docs/reference.md` (new actions/files/routes), and note in `evolution/docs/arena.md` / `rating_and_comparison.md` how the viewer reuses the comparison primitive display-only.

## Testing

### Unit Tests
- [ ] `arenaActions` tests — `getRecentMatchesAction` builds correct query (run_id `.eq`, `created_at` desc, `count:'exact'`, range cap, nested test-content filter); `getComparisonDetailAction` joins variant content + handles a missing variant; `rejudgeComparisonAction` calls `compareWithBiasMitigation` with the chosen model, returns `{winner,confidence,turns,costUsd}`, and makes **no** Supabase write call (assert insert/update/upsert never invoked) and never passes `db`/`runId` to the evolution client.
- [ ] `computeRatings` test — `buildComparisonPrompt`/`compareWithBiasMitigation` output is byte-for-byte unchanged when `customPromptOverride` is omitted (backward-compat guard for the 8 existing callers); and uses the override verbatim when provided.
- [ ] Reasoning-parser test — the last-verdict scanner extracts `A`/`B`/`TIE` from a multi-paragraph reasoning response ending in `Your answer: X`; returns null (→ "verdict unparsed") when no marker present; and is NOT fooled by a stray "equally"/"draw" in the prose (the failure mode `parseWinner` would hit). Also assert `rejudgeComparisonAction` returns `passes` with non-empty `prompt` + `rawResponse` for both directions.
- [ ] Match-list/detail component unit tests (render rows, winner/confidence formatting, model picker default `qwen-2.5-7b-instruct`, preset toggle + custom-prompt textarea, temperature slider, "Explain reasoning" toggle, collapsible prompt/output sections, "not persisted" marker).

### Integration Tests
- [ ] `src/__tests__/integration/match-viewer.integration.test.ts` — against real Supabase: seed a run + two variants + a comparison row, assert `getRecentMatchesAction`/`getComparisonDetailAction` return them; assert filter-by-run-id isolates rows. Auto-skip when evolution tables not migrated (existing pattern). Include `afterAll` cleanup via evolution test helpers.

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
- [ ] `evolution/docs/reference.md` — add new server actions (`getRecentMatchesAction`, `getComparisonDetailAction`, `rejudgeComparisonAction`) and component/route files.
- [ ] `evolution/docs/arena.md` — note the viewer as a reader of `evolution_arena_comparisons`.
- [ ] `evolution/docs/rating_and_comparison.md` — note that realtime re-judge reuses `compareWithBiasMitigation` / `buildComparisonPrompt` display-only.

## Wireframes (ASCII)

> Two screens. Detail page uses a single-scroll layout (stored verdict + sandbox visible together) with stacked re-judge result cards. Match Viewer sits in a new **Tools** nav group (it is a tool, not an entity).

### Screen 1 — Match list (`/admin/evolution/matches`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Evolution                                                           abel ▾     │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ OVERVIEW      │  Match Viewer                                                  │
│  Dashboard    │  Inspect recent judge matches · re-run judging in realtime     │
│  Start Exp.   │ ┌────────────────────────────────────────────────────────────┐│
│ ENTITIES      │ │ Run ID [______________]   Winner [Any ▾]   Min conf [____]  ││
│  Experiments  │ │ ☑ Hide test content                              [ Apply ]  ││
│  Prompts      │ └────────────────────────────────────────────────────────────┘│
│  Strategies   │  ┌──────────┬───────┬──────────┬──────────┬────────┬────────┐ │
│  Tactics      │  │ Created  │ Run   │ Text A    │ Text B   │ Winner │ Conf.  │ │
│  Criteria     │  ├──────────┼───────┼──────────┼──────────┼────────┼────────┤ │
│  Runs         │  │ 14:32:01 │ a1f3… │ Photosyn…│ A plant… │  ▣ A   │ 1.00   │ │
│  Invocations  │  │ 14:31:58 │ a1f3… │ The mito…│ Mitochon…│  ▣ B   │ 0.70   │ │
│  Variants     │  │ 14:31:55 │ a1f3… │ Gravity …│ Gravity …│  DRAW  │ 0.50   │ │
│ RESULTS       │  │ 14:30:40 │ 9d22… │ Tectonic…│ Plates … │  ▣ A   │ 0.70   │ │
│  Arena        │  │ …        │       │          │          │        │        │ │
│ TOOLS         │  └──────────┴───────┴──────────┴──────────┴────────┴────────┘ │
│ ▶ Match Viewer│  ‹ Prev    Page 1 / 7    Next ›                 200 of 1,394   │
└───────────────┴──────────────────────────────────────────────────────────────┘
   • Row click → detail.  • Run/Text cells truncate; full UUID on hover.
   • Winner = A / B / DRAW badge; confidence right-aligned.
```

### Screen 2 — Match detail + re-judge sandbox (`/admin/evolution/matches/[id]`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Matches  ›  c7f9cd7f                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Match c7f9cd7f…    Run a1f3…   Prompt "Explain photosynthesis"   14:32:01      │
│ Stored result:   ▣ WINNER A     confidence 0.50     status complete            │
├───────────────────────────────────┬──────────────────────────────────────────┤
│ ▣ TEXT A   elo 1243 ±40   3b9e…   │   TEXT B   elo 1190 ±55   7c21…           │
│ ──────────────────────────────────│ ─────────────────────────────────────────│
│ Photosynthesis is the process by  │ A plant makes food from sunlight. The     │
│ which green plants convert light  │ leaves capture light and combine water    │
│ energy into chemical energy …  ▾  │ and carbon dioxide to build sugars …  ▾   │
├───────────────────────────────────┴──────────────────────────────────────────┤
│ ⚖  RE-JUDGE SANDBOX                                          ⓘ not persisted   │
│  Model [ qwen-2.5-7b-instruct ▾]   Rubric ( •Article ○Paragraph )             │
│  Temperature  0.0  ▮▯▯▯▯▯▯▯▯▯  (max 2.0)        Explain reasoning [ ON ●]      │
│  ▸ Custom judge prompt (optional)                                              │
│    ┌────────────────────────────────────────────────────────────────────────┐ │
│    │ default Article rubric — expand to override (keep ## Text A / ## Text B │ │
│    │ and a final "Your answer: A|B|TIE" line so the parser still works)      │ │
│    └────────────────────────────────────────────────────────────────────────┘ │
│  Est. ~$0.0024 (reasoning ↑ tokens)                           [ ▶ Re-judge ]   │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │ gpt-4.1-mini · temp 0.0 · Article · reasoning  ▣ WINNER B  conf 0.70  2t│   │
│  │ Stored A (0.50)  →  Re-judge B (0.70)      ⚠ disagrees with stored      │   │
│  │ ▾ Prompt (forward)                                                      │   │
│  │   You are an expert judge. Compare ## Text A and ## Text B on clarity,  │   │
│  │   structure, engagement … Explain briefly, then end with               │   │
│  │   "Your answer: A|B|TIE".  ## Text A … ## Text B …                      │   │
│  │ ▾ Model output (forward)                                                │   │
│  │   Text B is clearer and better structured; Text A buries the key idea.  │   │
│  │   B's opening sentence states the mechanism directly. Your answer: B    │   │
│  │ ▸ Prompt (reverse)    ▸ Model output (reverse)                          │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
   • Each re-judge appends a result card (model + temp + rubric + reasoning flag).
     Expand Prompt / Model output per pass (forward + reverse) to read the exact
     judge prompt sent and the model's raw reasoning + verdict.
   • Verdict parsed from the LAST "Your answer:" marker; if unparsed, the card
     shows "verdict unparsed" but still renders the raw reasoning.
   • "not persisted" = nothing written to comparisons or ratings.
   • Reached directly, or via the "Open in Match Viewer" link on every match-
     history row (variant detail → Matches tab).
```

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
