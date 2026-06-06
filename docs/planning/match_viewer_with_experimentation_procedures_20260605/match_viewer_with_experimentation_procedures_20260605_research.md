# Match Viewer With Experimentation Procedures Research

## Problem Statement
Build a match viewer for the evolution pipeline — an admin UI to inspect the outcomes of recent judge matches (pairwise comparisons). It should let an operator view recent matches, filter them by run id, select a match from a list, and experiment with judging in realtime by re-running the comparison with different models and different judge prompts. The goal is to make the previously-invisible judging step inspectable and to provide a low-friction sandbox for tuning judge model and prompt choices.

## Requirements (from GH Issue #1165)
build a match viewer.
- View outcome of recent matches
- Filter matches by run id
- Select from list of recent matches
- Try judging in realtime with
    - with different models
    - with different judge prompts

## High Level Summary

The data needed for a match viewer **already exists** — no schema change is required for the read/view side. Realtime re-judging reuses the existing comparison primitive as a **display-only sandbox**: it does NOT persist to `evolution_arena_comparisons` and does NOT perturb Elo ratings. **Important caveat (verified adversarially):** each judge LLM call still writes a `llmCallTracking` audit row (existing table — no schema change), and would write `evolution_metrics` cost rows *only if* a Supabase `db` + `runId` are passed to the evolution LLM client. The re-judge action therefore calls the plain `callLLM` path and does **not** pass `db`/`runId`, so it never pollutes run cost aggregates and never touches ratings/arena/comparison history. "Display-only" = no ratings/arena/comparison-row mutation; the per-call `llmCallTracking` row is acceptable audit noise.

### Verified findings (20-agent research workflow, 2026-06-06)

All symbols below were cross-checked against source. Verified symbol/path table:

| Symbol / Path | Type | Location | Notes |
|---|---|---|---|
| `getArenaComparisonsAction` | server action | `evolution/src/services/arenaActions.ts:328` | Input `{topicId, limit?}` → `ArenaComparison[]`; filters by **prompt_id only** (no run_id) → need a new action |
| `ArenaComparison` | interface | `evolution/src/services/arenaActions.ts:~100` | `id, prompt_id, entry_a, entry_b, winner('a'|'b'|'draw'), confidence, run_id, status, created_at` |
| `getVariantMatchHistoryAction` | server action | `evolution/src/services/variantDetailActions.ts:403` | `.or('entry_a.eq.<id>,entry_b.eq.<id>')` pattern to reuse |
| `compareWithBiasMitigation` | fn | `evolution/src/lib/shared/computeRatings.ts:478` | `(textA, textB, callLLM, cache?, mode='article')` → `{winner:'A'|'B'|'TIE', confidence, turns}` |
| `buildComparisonPrompt` | fn | `evolution/src/lib/shared/computeRatings.ts:321` | modes `'article'` (5-criterion) / `'paragraph'` (4-criterion); **no custom-prompt support today** |
| `parseWinner` | fn | `evolution/src/lib/shared/computeRatings.ts:380` | needs `## Text A` / `## Text B` / `Your answer:` structure preserved |
| `run2PassReversal` / `aggregateWinners` | fn | `computeRatings.ts:291 / :450` | generic 2-pass runner + position-bias aggregation |
| `adminAction` | wrapper | `evolution/src/services/adminAction.ts:26` | enforces `requireAdmin()`, service client, logging — use for new actions |
| `callLLM` | fn | `src/lib/services/llms.ts:916` | routes by provider; writes `llmCallTracking` per call |
| `calculateLLMCost` | fn | `src/config/llmPricing.ts:101` | `(model, promptTokens, completionTokens, …)` → USD |
| `MODEL_REGISTRY` / `DEFAULT_JUDGE_MODEL` | const | `src/config/modelRegistry.ts:59 / :211` | 25 models; default judge `qwen-2.5-7b-instruct` |
| `getModelOptions` / `modelSupportsReasoning` | fn | `src/config/modelRegistry.ts:245 / :235` | feed the model picker |
| `EntityListPage<T>` | component | `evolution/src/components/evolution/EntityListPage.tsx:126` | filters, columns, pagination, sorting, `loadData`, `getRowHref` |
| `EvolutionSidebar` | component | `src/components/admin/EvolutionSidebar.tsx:50` | navGroups ~lines 6–33; add to **'Results'** group; auto-active via `startsWith` |
| `/admin/evolution` (page.tsx) | route | `src/app/admin/evolution/page.tsx` | redirects → `/admin/evolution/experiments` (no card landing) |
| `evolution_arena_comparisons` | table | migrations 20260331000001/2, 20260409000001 | `entry_a/entry_b` FKs **dropped** → variants may be deleted; handle orphans |
| `idx_arena_comparisons_run_iteration` | index | migration 20260331000001:76 | `(run_id, iteration)` — backs run-id filtering |
| `SideBySideWordDiff` / `VariantContentSection` | component | `evolution/src/components/evolution/visualizations/…` / `…/variant/…` | reusable for side-by-side text display |

### Constraints & edge cases surfaced
- **Run-id filter needs a new action.** `getArenaComparisonsAction` only filters by `prompt_id`; add `getRecentMatchesAction({ runId?, topicId?, winner?, minConfidence?, filterTestContent?, limit?, offset? })` with `count:'exact'` pagination.
- **Test-content filter requires a join.** `evolution_arena_comparisons` has no `is_test_content` column — exclude via nested `evolution_runs.evolution_strategies.is_test_content = false` (PostgREST embedded filter).
- **Custom judge prompt requires a small primitive change.** Add an optional `customPromptOverride?` param to `buildComparisonPrompt` + `compareWithBiasMitigation` (optional → all 8 existing callers unaffected); the override must keep `## Text A` / `## Text B` / `Your answer:` so `parseWinner` still works.
- **Temperature IS controllable for re-judge (verified).** The `temperature=0` forcing lives only in `createEvolutionLLMClient.ts:146`, and only for `agentName === 'ranking' | 'paragraph_rank'`. Re-judge builds its own `callLLM` closure on the plain `src/lib/services/llms.ts` path, which honors `options.temperature` — clamped to the model's `maxTemperature` via `clampTemperature` (`llms.ts:23`), returning `undefined` for models that don't support a temperature. So the sandbox can expose a temperature slider (default `0` to match production judging; disabled for non-temperature models). Caveat: `temp > 0` makes the 2-pass reversal non-deterministic — desirable for experimentation, not for stable ratings.
- **Deep-linking match history needs a comparison id.** The only rendered match-history list is `evolution/src/components/evolution/variant/VariantMatchHistory.tsx` (variant detail "Matches" tab). `VariantMatchEntry` (`variantDetailActions.ts:76`) currently omits the comparison `id`; add `comparisonId` (from `c.id` in `getVariantMatchHistoryAction`) so rows can link to `/admin/evolution/matches/[comparisonId]`. Other "Matches" references in the codebase are counts/totals, not match lists.
- **Comparison mode is not stored on the row** — it's on the producing run's config; default re-judge to `'article'`, offer `'paragraph'` when `variant_kind='paragraph'`.
- **Orphaned variants:** entry_a/entry_b may point at deleted variants (FKs dropped). Detail view must render a "Deleted variant [uuid]" placeholder when content is missing.
- **`prompt_id` and `run_id` are both nullable** (in-run vs arena comparisons) — list/detail must tolerate nulls.
- **Optional budget guard:** ad-hoc re-judge spend is not tied to a run budget; consider a transient per-session cap (deferred).

### Where matches live
- `evolution_arena_comparisons` stores every pairwise judge result: `id`, `prompt_id`, `entry_a` (variant UUID), `entry_b` (variant UUID), `winner` (`'a'`/`'b'`/`'draw'`), `confidence` (0–1), `run_id` (nullable), `status`, `created_at`. DB FKs from `entry_a`/`entry_b` to `evolution_variants` were dropped (migration `20260409000001`); integrity is app-enforced.
- The two compared texts are NOT stored on the comparison row — they are fetched from `evolution_variants.variant_content` by `entry_a` / `entry_b` id.
- `run_id` on the comparison row makes "filter matches by run id" a direct `.eq('run_id', runId)` query.

### Existing read path (reusable / extendable)
- `evolution/src/services/arenaActions.ts` → `getArenaComparisonsAction({ topicId, limit })` reads `evolution_arena_comparisons` (capped ~200, `created_at DESC`). It is **topic/prompt-scoped**, not run-scoped, and there is **no UI** that renders a comparisons list today.
- `evolution/src/services/variantDetailActions.ts` → `getVariantMatchHistoryAction(variantId)` queries comparisons via `.or('entry_a.eq.<id>,entry_b.eq.<id>')` and batch-fetches opponents — closest existing pattern; powers the variant detail "Matches" tab.
- Gap to fill: a **run-scoped** (and/or recent-across-all) match list + a match-detail view showing both texts side-by-side.

### Judging primitive (reused for realtime re-judge)
- `evolution/src/lib/shared/computeRatings.ts`:
  - `compareWithBiasMitigation(textA, textB, callLLM, cache?, mode?='article') => Promise<{ winner: 'A'|'B'|'TIE'; confidence; turns }>` — runs the 2-pass A/B reversal in parallel and aggregates confidence.
  - `buildComparisonPrompt(textA, textB, mode?='article') => string` — constructs the judge prompt (article rubric vs paragraph rubric). For "different judge prompts" we either pass a custom prompt builder or thread a custom instruction block.
  - `parseWinner(response)`, `run2PassReversal(config)`.
- The judge model is injected through the `callLLM: (prompt) => Promise<string>` closure, so picking a model = building that closure over the chosen model id.

### Model selection
- `src/config/modelRegistry.ts`: `MODEL_REGISTRY`, `DEFAULT_JUDGE_MODEL = 'qwen-2.5-7b-instruct'`, `getModelOptions()` / `getEvolutionModelIds()` give the dropdown options. Providers (OpenAI, DeepSeek, Anthropic, OpenRouter, local) are routed in `src/lib/services/llms.ts` (`callLLM(model, prompt, opts?)`).

### Realtime re-judge — current state & approach
- There is **no existing "re-judge" server action**; `evolution_arena_comparisons` is effectively write-once (sole writer `MergeRatingsAgent` during runs).
- Recommended v1: a new server action (e.g. `rejudgeComparisonAction({ entryAId, entryBId, judgeModel?, judgePrompt?, mode? })`) that fetches both variant texts, builds `callLLM` for the chosen model via `llms.callLLM`, calls `compareWithBiasMitigation`, and returns the result for **display only** (no DB write, no rating mutation). This avoids the architectural barriers of mutating history (Elo is keyed on variant, not on judge; re-judging one match would otherwise need to cascade).
- Cost: estimate/track via existing pricing helpers; guard with a per-call budget if needed.

### Admin UI conventions to follow
- Pages under `src/app/admin/evolution/*` are admin-gated (layout re-verifies admin on every render) client components that fetch via server actions.
- Reusable shells/components: `evolution/src/components/evolution/EntityListPage.tsx` (filter/sort/paginate/column-picker list shell), arena leaderboard table as a table reference.
- Test content is hidden by a default-on "Hide test content" filter on evolution list pages — match-list tests must `resetFilters()` after navigation (testing_overview.md Rule 1; `EvolutionListPage` POM).
- New nav entry needs to be added wherever the evolution admin sidebar/nav is defined (confirm exact file during planning).

### Resolved design decisions (post-research)
- **Match list scope:** standalone `/admin/evolution/matches` page with a run-id filter (+ winner/confidence/test-content filters). Matches both "recent matches" and "filter by run id"; the runs/arena list pattern transfers directly. A per-run tab can be a later add-on.
- **"Different judge prompts":** preset mode toggle (`article` / `paragraph`, already exist) **plus** an optional free-text override (collapsible) — implemented via the new `customPromptOverride?` param.
- **Re-judge persistence:** display-only (ephemeral) — no DB write to comparison/ratings, per the verified caveat above. Not savable in v1.
- **Symbols:** verified (see table). Remaining unknowns are minor (exact `EntityListPage` filter prop spec, whether `/admin/evolution-dashboard` still renders a quick-link row) — resolve while implementing.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (evolution)
- evolution/docs/README.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/data_model.md (digested)
- evolution/docs/architecture.md (digested)
- evolution/docs/visualization.md (digested)
- evolution/docs/reference.md (digested)
- evolution/docs/metrics.md (digested)
- evolution/docs/entities.md (digested)
- evolution/docs/strategies_and_experiments.md (digested)
- evolution/docs/evolution_metrics.md (digested)
- evolution/docs/variant_lineage.md (digested)
- evolution/docs/logging.md (digested)
- evolution/docs/agents/overview.md (digested)
- evolution/docs/criteria_agents.md (digested)

## Code Files Read (verified via 20-agent research, 2026-06-06)
- evolution/src/services/arenaActions.ts — `getArenaComparisonsAction` (:328, prompt_id-only), `ArenaComparison`
- evolution/src/services/variantDetailActions.ts — `getVariantMatchHistoryAction` (:403)
- evolution/src/services/adminAction.ts — `adminAction` factory (:26)
- evolution/src/services/shared.ts — `validateUuid` (:6)
- evolution/src/lib/shared/computeRatings.ts — `compareWithBiasMitigation` (:478), `buildComparisonPrompt` (:321), `parseWinner` (:380), `run2PassReversal` (:291), `aggregateWinners` (:450)
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts — LLM client wiring; `temperature=0` for judge (:146); `writeMetricMax` cost write only when db/runId passed (:233)
- src/lib/services/llms.ts — `callLLM` (:916); `saveLlmCallTracking` writes `llmCallTracking` (:121)
- src/config/modelRegistry.ts — `MODEL_REGISTRY` (:59), `DEFAULT_JUDGE_MODEL='qwen-2.5-7b-instruct'` (:211), `getModelOptions` (:245), `modelSupportsReasoning` (:235)
- src/config/llmPricing.ts — `calculateLLMCost` (:101)
- evolution/src/components/evolution/EntityListPage.tsx — list shell (:126)
- src/components/admin/EvolutionSidebar.tsx — nav, 'Results' group (:50, groups ~6–33)
- src/app/admin/evolution/page.tsx — redirects to /experiments; src/app/admin/evolution/arena/page.tsx — list pattern
- evolution/src/components/evolution/visualizations/SideBySideWordDiff.tsx + variant/VariantContentSection.tsx — reusable side-by-side text display
- supabase/migrations/20260331000001 (idx_arena_comparisons_run_iteration), 20260409000001 (entry FK drop)
