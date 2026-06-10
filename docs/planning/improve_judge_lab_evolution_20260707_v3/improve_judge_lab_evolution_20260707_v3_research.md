# Improve Judge Lab Evolution v3 Research

## Problem Statement
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## Requirements (from GH Issue #NNN)
Make it possible to see the match history for runs in the judge lab, including both input pieces of content (either paragraph or article), the winner, and the full model input and output for the judge model (including the custom prompt if included and the full model reasoning including output if that is included). Also, make sure we have this information saved to the database so that later we can query it to understand it if needed.

## High Level Summary
The Judge Lab persists per-(run × pair × repeat) results in `judge_eval_calls`, but the goal here is to **surface a match-history view** per eval run and to **close persistence gaps** so the full judge input/output/reasoning is queryable.

Preliminary findings (to be deepened during /research):

- **Already persisted** in `judge_eval_calls` (migration `20260606000001_judge_eval_tables.sql:63-87`):
  `pair_label`, `pair_kind`, `comparison_mode`, `repeat_index`, `forward_winner`, `reverse_winner`,
  `winner`, `confidence`, `decisive` (GENERATED `confidence > 0.6`), `wall_ms`/`fwd_ms`/`rev_ms`,
  `prompt_tokens`/`output_tokens`/`reasoning_tokens`, `cost_usd`, `forward_raw`, `reverse_raw`, `error`.
  → `forward_raw`/`reverse_raw` are the **raw judge OUTPUT** of each pass.

- **The two content pieces** (Text A / Text B) are NOT in `judge_eval_calls`. They live in
  `judge_eval_pair_banks.pairs` JSONB (`{label, pair_kind, text_a, text_b, ...}`), joined to a run via
  the test set's frozen membership (`judge_eval_test_set_members.pair_label`). A match-history view must
  hydrate A/B text by `pair_label`.

- **Likely persistence GAPS** (the core of "save this to DB"):
  1. **Full model INPUT prompt** is not stored per call. Only the custom rubric override is kept, at the
     run level (`judge_eval_runs.prompt_variant` + `prompt_variant_hash`). The actual rendered prompt
     (rubric + injected Text A/Text B + "Your answer:" line, per `buildComparisonPrompt`) is currently
     reconstructable but not directly stored/queryable.
  2. **Full reasoning trace text** is not stored separately — only `reasoning_tokens` (a count). The raw
     output (`forward_raw`/`reverse_raw`) may contain inline reasoning depending on the model/parser
     (`parseVerdictFromReasoning` vs `parseWinner`), but a dedicated verbatim/summary reasoning field is
     absent.
  → Decide in planning whether to add columns (e.g. `forward_prompt`/`reverse_prompt`,
     `forward_reasoning`/`reverse_reasoning`, `reasoning_trace_format`) vs. reconstruct in the UI.

- **Engine** (`evolution/src/lib/judgeEval/runJudgeEval.ts`): inlined `Promise.all` 2-pass; builds
  `forwardPrompt`/`reversePrompt` via `buildComparisonPrompt`, calls the injected `JudgeFn`, and currently
  pushes `forward_raw`/`reverse_raw` (the response text) into each call row — so the input prompts and any
  separate reasoning text are available at write time but dropped.

- **Existing UI surfaces** to model after:
  - `/admin/evolution/judge-lab/runs/[evalRunId]` — per-kind aggregates + per-pair breakdown (the natural
    home for a Matches/History tab).
  - `/admin/evolution/matches` + `/admin/evolution/matches/[comparisonId]` — the arena Match Viewer:
    list + detail with Text A/B side-by-side/word-diff and a display-only re-judge that shows each pass's
    model output + reasoning. Good UI precedent for showing input content + judge I/O.
  - Server actions live in `evolution/src/services/judgeEvalActions.ts` (cap-gated).

- **Leaderboard "N" caveat** (relevant context from the prior investigation): the leaderboard column "N"
  is `count(*)` of calls (`pairs × repeats`, minus errored rows), NOT the entered "Repeats" — a labeling
  nuance to keep in mind when the new history view shows per-match rows.

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

### Relevant Docs (evolution + feature deep dives)
- docs/feature_deep_dives/judge_evaluation.md
- evolution/docs/data_model.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/arena.md
- evolution/docs/visualization.md
- evolution/docs/logging.md

## Code Files Read
- src/app/admin/evolution/judge-lab/page.tsx (sweep launcher + leaderboard)
- supabase/migrations/20260606000001_judge_eval_tables.sql (judge_eval_* schema + leaderboard VIEW)
- evolution/src/lib/judgeEval/runJudgeEval.ts (2-pass engine — partial read)
- evolution/src/services/judgeEvalActions.ts (server actions — partial read)
- evolution/src/lib/judgeEval/executeSweep.ts (sweep orchestration — partial read)
