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
- [x] **Option C (CHOSEN): Both** — preset toggle (`article`/`paragraph`, already supported by `mode`) + collapsible free-text override. Requires a new optional `customPromptOverride?` param on `buildComparisonPrompt` + `compareWithBiasMitigation` (optional trailing param → all existing callers — 2 production: `rankSingleVariant`, `SwissRankingAgent`; plus scripts — unaffected). **The override is the rubric/instruction block ONLY, not the whole prompt:** `buildComparisonPrompt` still appends `## Text A`<textA> / `## Text B`<textB> in the per-pass positions (forward A,B; reverse B,A) and the trailing `Your answer:` contract, so the 2-pass reversal + `flipWinner`/`aggregateWinners` stay valid. Texts are never baked into the override.
- [ ] **Option A: Preset rubric toggle only** — lowest effort; no primitive change.
- [ ] **Option B: Free-text override only** — flexible but loses the curated presets.

## Phased Execution Plan

> File targets verified against source (20-agent research, 2026-06-06). New server actions live in `evolution/src/services/arenaActions.ts` (alongside `getArenaComparisonsAction`), wrapped with the `adminAction` factory (`evolution/src/services/adminAction.ts:26`).

### Phase 1: Read path — match list + detail (display existing data)
- [ ] Add `getRecentMatchesAction({ runId?, topicId?, winner?, minConfidence?, filterTestContent?, limit?, offset? }) => { items: ArenaComparison[]; total }` in `arenaActions.ts` (`getArenaComparisonsAction` filters by `prompt_id` only). Query `evolution_arena_comparisons` `.select('*', { count: 'exact' })`, `.order('created_at', desc)`, `.range()`; cap ≤200/page; uses index `idx_arena_comparisons_run_iteration`.
- [ ] Implement test-content exclusion via the **nested join** on `evolution_runs.evolution_strategies.is_test_content` (the comparisons table has no `is_test_content` column). The PostgREST predicate only filters if the select **embeds the join with `!inner`**, e.g. `.select('*, evolution_runs!inner(evolution_strategies!inner(is_test_content))')` then `.eq('evolution_runs.evolution_strategies.is_test_content', false)`. The single-level helper `applyNonTestStrategyFilter` (`evolution/src/services/shared.ts:94`) is NOT reusable here (it covers strategies one level up only). Note `run_id` is nullable on the comparisons row — rows with null `run_id` (pure-arena) have no run/strategy to join; decide whether the test-content filter excludes or retains them (default: retain, since they aren't test-strategy rows).
- [ ] Add `getComparisonDetailAction({ comparisonId })` returning the comparison row + both variants' `variant_content` (batch `.in('id', [entry_a, entry_b])`) + run/prompt context; render a "Deleted variant [uuid]" placeholder when a variant is missing (entry FKs were dropped).
- [ ] Build `/admin/evolution/matches/page.tsx` (`'use client'`) with `EntityListPage<ArenaComparison>`: columns Created, Run, Prompt, Entry A preview, Entry B preview, Winner (badge), Confidence (%); filters run-id (text), winner (select), min-confidence (text), "Hide test content" (checkbox, default on); `getRowHref → /admin/evolution/matches/[comparisonId]`.
- [ ] **Add a new `Tools` nav group** to `src/components/admin/EvolutionSidebar.tsx` `navGroups` (after the `Results` group). Match Viewer is a *tool*, not an entity, so it gets its own section rather than going under `Entities`/`Results`: `{ label: 'Tools', items: [{ href: '/admin/evolution/matches', label: 'Match Viewer', icon: '⚖️', testId: 'evolution-sidebar-nav-matches', description: 'Judge match history and re-run comparisons' }] }`. Active-state + `activeOverrides` are auto-derived from `navGroups` (`startsWith`), so no extra wiring.
- [ ] **Link the match viewer from the evolution admin dashboard** (explicit user requirement). Note the old generic quick-links row on `/admin/evolution-dashboard` (`page.tsx:129-132`) was intentionally removed in U20 ("sidebar already links to all of them"), so do NOT resurrect that row wholesale — add a single deliberate **Tools** entry/card for Match Viewer (the one tool not otherwise surfaced as an entity). Sidebar `Tools` group remains the canonical nav; this dashboard link is for discoverability per the requirement.
- [ ] **Deep-link every match-history surface to the viewer.** Extend `getVariantMatchHistoryAction` + the `VariantMatchEntry` interface (`evolution/src/services/variantDetailActions.ts:403,:76`) with `comparisonId` (from `c.id`), and add an "Open in Match Viewer" link (→ `/admin/evolution/matches/[comparisonId]`) per row in `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` (the variant detail "Matches" tab — the only rendered match-history list today). Any future arena-comparisons list already carries `ArenaComparison.id` and links natively.

### Phase 2: Realtime re-judge sandbox (display-only)

> **Decision: always 2-pass.** Re-judge uses the same 2-pass A/B reversal as production judging (forward + reverse, run in parallel; confidence derived from `aggregateWinners`). No single-pass toggle — each re-judge = 2 LLM calls, surfaced as the forward + reverse entries in `passes`.
- [ ] Add optional `customPromptOverride?: string` param to `buildComparisonPrompt` + `compareWithBiasMitigation` (`evolution/src/lib/shared/computeRatings.ts`). **Interpolation contract:** the override replaces only the rubric/instruction block; `buildComparisonPrompt` continues to render `## Text A`\n<textA>\n`## Text B`\n<textB> in the correct per-pass order and the closing `Your answer:` line. This keeps the forward/reverse framing (and thus `flipWinner`/`aggregateWinners`) intact for the mandated 2-pass reversal — an override that "bakes in" the texts is explicitly disallowed. Append `customPromptOverride` as the **trailing positional param**, after the existing `cache?` then `mode` on `compareWithBiasMitigation` (`computeRatings.ts:482-483`), so the 2 production callers + scripts stay byte-for-byte unchanged. Server-side, reject (before any LLM call) an override that would produce a prompt missing `## Text A` / `## Text B` / a verdict instruction; the verdict-marker check must use the **same regex as the reasoning-tolerant parser** so any override the validator accepts is guaranteed parseable at runtime. Add a unit test asserting (a) default output is byte-for-byte unchanged when the param is omitted, (b) the override still yields distinct forward vs reverse prompts with texts in swapped positions.
- [ ] Add `rejudgeComparisonAction({ comparisonId, judgeModel, mode?, customPrompt?, temperature?, explainReasoning? }) => { winner, confidence, turns, costUsd, passes }` in `arenaActions.ts`, where `passes: { direction: 'forward' | 'reverse'; prompt: string; rawResponse: string; parsedWinner: 'A'|'B'|'TIE'|null }[]`. Implementation notes:
  - **Validation:** `validateUuid(comparisonId)`; validate `judgeModel` against the **same allowed set the picker uses** (`getModelOptions()`/`getEvolutionModelIds()`, which align with `allowedLLMModelSchema` that `callLLM` re-checks at `llms.ts:90`), not a looser `MODEL_REGISTRY` key check; clamp/validate `temperature` against `getModelMaxTemperature(judgeModel)`.
  - **Input caps (abuse/cost):** hard char caps on the fetched `variant_content` per side and on `customPrompt` (truncate or reject) so a 2-pass call can't run unbounded input tokens; wrap the LLM calls and surface `GlobalBudgetExceededError` / `LLMKillSwitchError` (from `@/lib/errors/serviceError`, thrown by `callLLM`'s `spendingGate`) as a clean error result rather than a 500. NOTE: this is NOT the evolution-pipeline `BudgetExceededError` (`evolution/src/lib/types.ts`), which `callLLM` never throws.
  - **2-pass capture:** drive `run2PassReversal` (`computeRatings.ts:291`) **directly** — do NOT route through `compareWithBiasMitigation`, whose comparison-cache hit would skip the LLM calls and thus skip the per-pass capture. `run2PassReversal` returns only the aggregate, so capture `prompt`+`rawResponse` per pass via the caller-supplied `buildPrompts`/`callLLM`/`parseResponse` closures (side-effect into `passes`), mapping each prompt to its direction by the deterministic `Promise.all([callLLM(forward), callLLM(reverse)])` order.
  - **LLM path:** build the `callLLM` closure over `src/lib/services/llms.ts:callLLM` for the chosen model passing `temperature`. Use the **plain `callLLM`**, NOT `createEvolutionLLMClient` — the evolution client force-pins `ranking` temperature to 0 (`createEvolutionLLMClient.ts:146`) and is the only path that writes `evolution_metrics` cost rows. Plain `callLLM` takes no `db`/`runId`, so re-judge writes no `evolution_metrics` and never touches ratings/arena/comparison rows; the only write is the existing per-call `llmCallTracking` audit row (`llms.ts:121`, acceptable).
  - **E2E stub:** when `process.env.E2E_TEST_MODE === 'true'`, the `callLLM` closure returns a deterministic canned response (e.g. reasoning text ending `Your answer: A`) so the sandbox is exercisable in E2E with no provider call (see E2E test note). Replicate the repo's prod guard (`src/app/api/returnExplanation/route.ts:17` pattern): throw if `E2E_TEST_MODE === 'true' && NODE_ENV === 'production' && !process.env.CI`, so a misconfigured prod server can never serve canned judge verdicts. Compute cost via `calculateLLMCost`.
- [ ] **Raw prompt + reasoning support.** When `explainReasoning` is on, the judge prompt instructs the model to give a brief rationale and then end with a strict final verdict line (`Your answer: A|B|TIE`). Parse the verdict with a **reasoning-tolerant parser** that scans the LAST verdict marker — e.g. the last match of `/(?:your answer|verdict|winner)\s*:?\s*\**\s*(A|B|TIE)\b/gi` — **not** `parseWinner` (which is anchored to the start and does a bare `contains 'EQUAL'|'TIE'|'DRAW'` that a reasoning paragraph would false-trigger). Always return `rawResponse` in `passes` regardless of parse success so the reasoning is visible even when the verdict can't be extracted (surface "verdict unparsed" in that case). When `explainReasoning` is off, keep `parseWinner` (single-token path) unchanged.
- [ ] Build `/admin/evolution/matches/[comparisonId]/page.tsx` (mirror variant detail): tabs for Metadata, Stored comparison (side-by-side texts via `SideBySideWordDiff`/`VariantContentSection` + stored winner/confidence), and a Re-judge sandbox.
- [ ] Re-judge sandbox UI: model picker from `getModelOptions()` (default `DEFAULT_JUDGE_MODEL`; exclude/flag reasoning models via `MODEL_REGISTRY[id].supportsReasoning === true`, since they pass `supportsEvolution` and would otherwise appear); preset toggle (`article`/`paragraph`) + collapsible custom-prompt textarea; **temperature slider** (default `0`, range `0…getModelMaxTemperature(model)`; disabled/hidden when that returns `null` OR `undefined` — treat both identically; note `clampTemperature` is private to `llms.ts`, so the UI reads `getModelMaxTemperature` / `MODEL_REGISTRY[model].maxTemperature`, which is exported); **"Explain reasoning" toggle** (off by default). "Re-judge" button → `rejudgeComparisonAction`; render each result as a stacked card next to the stored result, labeled with model + temp + prompt, with cost + a clear "not persisted" marker. Note in the UI that `temp > 0` makes the 2-pass reversal non-deterministic (intended for experimentation).
- [ ] Each result card has **collapsible "Prompt" and "Model output" sections per pass** (forward + reverse) showing the exact `passes[].prompt` sent and the `passes[].rawResponse` returned — so the operator can read the raw judge prompt and, when "Explain reasoning" is on, the model's full rationale. Render prompt/response as **escaped plain text** (e.g. `<pre>{text}</pre>`, never `dangerouslySetInnerHTML`) since model output is untrusted. Reasoning mode increases output tokens → note higher cost/latency in the cost line.
- [ ] **Stable `data-testid`s** for E2E (Rule 3, no nth-child): list rows `match-row-<id>`, the run-id filter `filter-runId`, the test-content checkbox `filter-filterTestContent` (so the existing `EvolutionListPage.resetFilters()` POM works unchanged), `rejudge-model-select`, `rejudge-temperature`, `rejudge-explain-reasoning`, `rejudge-run-button`, `rejudge-result-card`, `rejudge-not-persisted`, and per-pass `rejudge-pass-prompt`/`rejudge-pass-output`.

### Phase 3: Polish, dashboard link & docs
- [ ] Loading / error / empty states; disable re-judge while in flight; show latency; breadcrumb on detail page.
- [ ] (Optional) transient per-session spend guard for ad-hoc re-judges.
- [ ] Update `evolution/docs/visualization.md` (new page + sandbox), `evolution/docs/reference.md` (new actions/files/routes), and note in `evolution/docs/arena.md` / `rating_and_comparison.md` how the viewer reuses the comparison primitive display-only.

## Testing

### Unit Tests
- [ ] `evolution/src/services/arenaActions.test.ts` (colocated, beside existing tests) — `getRecentMatchesAction` builds correct query (run_id `.eq`, `created_at` desc, `count:'exact'`, range cap, `!inner` nested test-content embed) using the existing `createSupabaseChainMock`; `getComparisonDetailAction` joins variant content + handles a missing variant. For `rejudgeComparisonAction`: `jest.mock('@/lib/services/llms')` and assert (a) `callLLM` is invoked twice (2-pass) with the chosen model + temperature, (b) the `evolution_arena_comparisons` chain's `insert`/`update`/`upsert` spies are never called (no-write guarantee), (c) `createEvolutionLLMClient` is never imported/called (the `evolution_metrics` guarantee is "didn't use the evolution client", an arg/path assertion — not a Supabase spy), (d) returns `passes` with non-empty `prompt`+`rawResponse` for both directions, (e) an invalid `customPrompt` (missing `## Text A`/`## Text B`/verdict marker) is rejected BEFORE any `callLLM` call (assert `callLLM` not invoked).
- [ ] `computeRatings` test — `buildComparisonPrompt`/`compareWithBiasMitigation` output is byte-for-byte unchanged when `customPromptOverride` is omitted (backward-compat guard for the 8 existing callers); and uses the override verbatim when provided.
- [ ] Reasoning-parser test — the last-verdict scanner extracts `A`/`B`/`TIE` from a multi-paragraph reasoning response ending in `Your answer: X`; returns null (→ "verdict unparsed") when no marker present; and is NOT fooled by a stray "equally"/"draw" in the prose (the failure mode `parseWinner` would hit). Also assert `rejudgeComparisonAction` returns `passes` with non-empty `prompt` + `rawResponse` for both directions.
- [ ] Match-list/detail component unit tests (render rows, winner/confidence formatting, model picker default `qwen-2.5-7b-instruct`, preset toggle + custom-prompt textarea, temperature slider, "Explain reasoning" toggle, collapsible prompt/output sections, "not persisted" marker).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-match-viewer.integration.test.ts` — **filename must start with `evolution-`** so it matches the `test:integration:evolution` `--testPathPatterns` (a `match-viewer*` name would be silently excluded from the evolution CI integration row). Against real Supabase: use `@evolution/testing/evolution-test-helpers` (`evolutionTablesExist` for auto-skip; `createTestStrategyConfig`, `createTestPrompt`, `createTestEvolutionRun`, `createTestVariant`) to seed a run + two variants, then insert a comparison row directly into `evolution_arena_comparisons` (no factory helper exists for it — mirror `evolution-arena-comparison.integration.test.ts`). Assert `getRecentMatchesAction`/`getComparisonDetailAction` return them and that filter-by-run-id isolates rows. Track all created ids and clean up in `afterAll` via `cleanupEvolutionData` + a direct delete of the comparison row.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-matches.spec.ts` (`{ tag: '@evolution' }`, uses `adminTest` from `fixtures/admin-auth.ts`). Seed via `evolution-test-data-factory` (`createTestRun`/`createTestVariant` + insert a comparison row); requires `afterAll` cleanup (ESLint `require-test-cleanup`). Flow: navigate to `/admin/evolution/matches`, instantiate `EvolutionListPage` and call `resetFilters()` (the page must render `[data-testid="filter-filterTestContent"]` so the POM works unchanged), assert the seeded `match-row-<id>` appears, filter by run id and assert isolation, open the detail page. **Re-judge is NOT browser-mockable** (it runs `callLLM` server-side in a Server Action — Playwright `page.route()` can't reach it), so rely on the `E2E_TEST_MODE` server-side stub in `rejudgeComparisonAction`: assert the `rejudge-result-card` and `rejudge-not-persisted` marker render and the canned `Your answer: A` produces a deterministic winner; do **not** assert a winner letter that depends on a real model. Before clicking `rejudge-run-button`, wait for a data-dependent element on the detail page (hydration proof, Rule 18); use `safeGoto` for any chained navigation (Firefox `NS_BINDING_ABORTED`, the `e2e-evolution` chromium+firefox matrix). No fixed sleeps / `networkidle`; assert via auto-retrying `expect(locator)`.

### Manual Verification
- [ ] On local server, open `/admin/evolution/matches`, filter by a real run id, open a match, re-judge with two different models and an edited prompt; confirm results render and nothing is persisted.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-matches.spec.ts` against the local tmux server (via `npm run test:e2e`).

### B) Automated Tests
- [ ] Unit: `npm test -- arenaActions` and `npm test -- computeRatings` (no `test:unit` script exists; the unit runner is `test`/`test:ci`; `matchViewer` matches no file). Integration: `npm run test:integration:evolution` (the `evolution-` filename matches its `--testPathPatterns`). Then `npm run lint && npm run typecheck && npm run build`, and the E2E spec below.

### C) Rollback / flags
- [ ] No rollback machinery needed: the change is purely additive — a new read-only page + new server actions + one optional trailing param + one nav group, reading existing `evolution_arena_comparisons` with **no migration** and **no CI workflow / required-check change**. Rollback = revert the PR. The `customPromptOverride` backward-compat unit test guards the only shared-code blast radius (`computeRatings.ts` callers). No feature flag required.

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

### Iteration 1 — Security 4/5 · Architecture 4/5 · Testing 3/5 (consensus not reached)
Critical gaps fixed:
1. **[Arch] `customPromptOverride` would break 2-pass reversal.** Redefined the override as a rubric/instruction template only; `buildComparisonPrompt` still interpolates the two texts in per-pass swapped positions, preserving `flipWinner`/`aggregateWinners`. Added server-side rejection of overrides missing required markers, and a unit test for swapped-position forward/reverse prompts.
2. **[Testing] E2E LLM mock unworkable** (re-judge calls `callLLM` server-side; Playwright can't intercept). Added an `E2E_TEST_MODE` server-side stub in `rejudgeComparisonAction` returning a deterministic canned response; E2E now asserts the result card + "not persisted" marker, not a real winner.
3. **[Testing] Wrong verification commands + integration filename.** Fixed to `npm test -- arenaActions`/`computeRatings`, `npm run test:integration:evolution`; renamed integration file to `evolution-match-viewer.integration.test.ts` so it matches the evolution `--testPathPatterns`.

Minor hardening folded in: server-side input-size caps + `BudgetExceededError` handling; validate model against the picker's allowed set; `!inner` select embed for the test-content filter (+ nullable `run_id` handling); UI reads `getModelMaxTemperature` (not private `clampTemperature`); escaped `<pre>` rendering of raw prompt/output; enumerated stable `data-testid`s; hydration-wait + `safeGoto` + `adminTest` in E2E; `run2PassReversal` closure-capture clarification; corrected caller count; rollback/no-migration note.

### Iteration 2 — Security 4/5 · Architecture 5/5 · Testing 5/5 (consensus not reached)
Both iteration-1 criticals verified resolved by Architecture (5/5) and Testing (5/5). Security held at 4/5 on two concrete factual fixes (no critical gaps):
1. **Wrong budget exception type.** `callLLM`'s spending gate throws `GlobalBudgetExceededError` / `LLMKillSwitchError` (`@/lib/errors/serviceError`), not the evolution-pipeline `BudgetExceededError`; the catch in the re-judge path is corrected.
2. **E2E stub prod guard.** Added the repo's `E2E_TEST_MODE && NODE_ENV==='production' && !CI` throw so canned verdicts can never be served in prod.

Precision nits also folded in: `customPromptOverride` appended after `cache`/`mode` (param position); drive `run2PassReversal` directly to bypass the comparison cache so both passes execute; treat `null`≡`undefined` max-temp (no slider); reasoning-model filter via `supportsReasoning`; validator regex aligned to the reasoning-tolerant parser; unit test asserts `callLLM` not called on an invalid override.

### Iteration 3 — Security 5/5 · Architecture 5/5 · Testing 5/5 ✅ CONSENSUS REACHED
All three reviewers verified the iteration-2 fixes against source (`llmSpendingGate.ts` throws `GlobalBudgetExceededError`/`LLMKillSwitchError` from `@/lib/errors/serviceError`; prod-guard matches `returnExplanation/route.ts:17`; param-position, cache-bypass, and `null`≡`undefined` max-temp all reflected in the live bullets). Zero critical gaps, zero remaining blocking minors. **Plan is execution-ready.**
