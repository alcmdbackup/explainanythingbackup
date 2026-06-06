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

The data needed for a match viewer **already exists** — no schema change is required for the read/view side. Realtime re-judging can reuse the existing comparison primitive as a **display-only sandbox** (it does NOT need to persist back to `evolution_arena_comparisons` or perturb Elo ratings).

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

### Open questions for /research → /plan
- Match list scope: per-run page (`/admin/evolution/runs/[runId]/matches` tab) vs a standalone `/admin/evolution/matches` page with a run-id filter vs both. (Requirements list both "recent matches" and "filter by run id" → standalone list with a run filter is the natural fit.)
- "Different judge prompts": free-text prompt override box vs a small set of preset rubrics (article/paragraph already exist) vs both.
- Whether realtime results are purely ephemeral (display-only, recommended) or optionally savable for later comparison.
- Confirm exact symbol names (`getArenaComparisonsAction` return type, `getVariantMatchHistoryAction`, `EntityListPage` props) against source before coding — some were surfaced via exploration and should be verified.

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

## Code Files Read (to verify during /research)
- evolution/src/services/arenaActions.ts — `getArenaComparisonsAction`, `getArenaTopicDetailAction`
- evolution/src/services/variantDetailActions.ts — `getVariantMatchHistoryAction`
- evolution/src/lib/shared/computeRatings.ts — `compareWithBiasMitigation`, `buildComparisonPrompt`, `parseWinner`, `run2PassReversal`
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts — LLM client wiring
- src/config/modelRegistry.ts — `MODEL_REGISTRY`, `DEFAULT_JUDGE_MODEL`, `getModelOptions`
- src/lib/services/llms.ts — `callLLM(model, prompt, opts?)` provider routing
- evolution/src/components/evolution/EntityListPage.tsx — list shell
- src/app/admin/evolution/arena/[topicId]/page.tsx — representative admin detail page
