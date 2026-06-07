# Improve Judge Lab Evolution Research

## Problem Statement
Make improvements to the Judge Lab — the systematic, persisted judge-evaluation tool in the
evolution admin UI (`/admin/evolution/judge-lab`) that runs batch A/B/TIE judge sweeps over frozen
test sets and ranks judge settings by decisive rate. Two concrete improvements are requested: (1) fix
a model-communication error that occurs when selecting `deepseek-v4-flash` or
`google/gemini-2.5-flash-lite` as the judge model, and (2) add the ability to edit a test set and view
its contents from the test-sets menu.

## Requirements (from GH Issue #NNN)
- Trying to use deepseek-v4-flash or google/gemini-2.5-flash-lite results in an error 'error communication with AI model'.
- Want to add the ability to edit test sets and view their contents, from the test sets menu

## High Level Summary
_To be populated during /research._

Initial orientation from doc + prior-session reading:

- **Judge Lab feature** lives at `src/app/admin/evolution/judge-lab/**` (pages) backed by
  `evolution/src/services/judgeEvalActions.ts` (cap-gated server actions), engine in
  `evolution/src/lib/judgeEval/` (`schemas.ts`, `metrics.ts`, `testSet.ts`, `settings.ts`, `cost.ts`,
  `runJudgeEval.ts`, `persist.ts`, `seed.ts`, `executeSweep.ts`), CLI at
  `evolution/scripts/judge-eval.ts`, schema in
  `supabase/migrations/20260606000001_judge_eval_tables.sql`.

- **Item 1 (model error)** — the judge LLM call routes through plain `callLLM`
  (`src/lib/services/llms.ts`) with `call_source='evolution_judge_eval'`. The model dropdown is
  populated by `getModelOptions` (same helper used by the Match Viewer re-judge sandbox). Likely root
  causes to verify during research:
  - The two failing models may not be registered in the model registry / `getModelOptions`
    allow-list, or map to a provider/route (`isOpenRouterModel`) that isn't wired for the judge path.
  - `deepseek-v4-flash` may be an invalid/unknown model id (DeepSeek pricing in `llmPricing.ts` lists
    `deepseek-chat`); `google/gemini-2.5-flash-lite` is an OpenRouter-style slug → check OpenRouter
    routing + `OPENROUTER_API_KEY`.
  - Reasoning-effort handling in `llms.ts`: for OpenRouter it sets `reasoning.effort` +
    `include_reasoning`; for OpenAI o-series it sets `reasoning_effort` (omitting `'none'`). A model
    that rejects these params could surface as "error communicating with AI model".
  - "error communicating with AI model" is the user-facing string — find where it is thrown/mapped to
    get the real underlying error (provider 4xx, unknown-model, missing API key, temperature clamp).

- **Item 2 (edit/view test sets)** — Test Sets are **frozen** by design: membership materializes once
  into `judge_eval_test_set_members` (PK `(test_set_id, pair_label)`) and "never changes" so
  consecutive runs compare on identical pairs. UI today: `/admin/evolution/judge-lab/test-sets` =
  list + create (size/strategy/seed → frozen). Research must determine what "edit" should mean given
  the frozen-comparability contract (rename/metadata edit vs. re-sampling membership vs. a
  view-only contents drawer), and what "view contents" should show (the member pairs + their snapshot
  texts/Elo-gap/recorded confidence). This interacts with the eval-run idempotency key
  (`settings_key` includes `test_set_id`) — editing membership in place would silently break
  cross-run comparability, so the design likely needs view + safe-edit (metadata) + optional
  "clone into new test set" rather than mutating a frozen set.

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

### Relevant Docs
- docs/feature_deep_dives/judge_evaluation.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/data_model.md
- evolution/docs/README.md (orientation)
- evolution/docs/architecture.md (orientation)

## Code Files Read
_To be populated during /research. Expected starting set:_
- `src/app/admin/evolution/judge-lab/**` (pages incl. `test-sets`)
- `evolution/src/services/judgeEvalActions.ts`
- `evolution/src/lib/judgeEval/{testSet.ts,runJudgeEval.ts,settings.ts,schemas.ts}`
- `src/lib/services/llms.ts` (model routing, reasoning effort, error mapping)
- `src/config/llmPricing.ts` + model-options / model-registry source for `getModelOptions`
- `supabase/migrations/20260606000001_judge_eval_tables.sql`
