# error_communicating_gemini_service_evolution_20260607 Plan

## Background
When invoking `google/gemini-2.5-flash-lite` from the evolution admin Match Viewer (left-nav "Tools → Matches" → `/admin/evolution/matches/[comparisonId]`), the re-judge sandbox returns "Error communicating with AI service". This error string is produced by `categorizeError` in `src/lib/errorHandling.ts` when an LLM-call error message contains the substring `api` or `openai` — the message gets bucketed into `ERROR_CODES.LLM_API_ERROR`. The Match Viewer's `rejudgeComparisonAction` drives `run2PassReversal` against the plain `callLLM` path (not the evolution client), so the failure is in the app-level LLM invocation, not in the pipeline cost-tracker / budget-gate path.

## Problem
The user expects the Match Viewer re-judge sandbox to successfully invoke `google/gemini-2.5-flash-lite` (a registered OpenRouter model, `supportsEvolution: true`, `inputPer1M: $0.10`, `outputPer1M: $0.40`, `maxTemperature: 2.0`). Instead the call fails with the generic "Error communicating with AI service" string, hiding the underlying provider / SDK / config error. We need to identify the root cause and either fix the failing call or surface the underlying error.

## Investigation Plan
- [ ] Locate the Match Viewer detail page (`src/app/admin/evolution/matches/[comparisonId]/page.tsx`) and the action it invokes.
- [ ] Read `rejudgeComparisonAction` in `evolution/src/services/arenaActions.ts` and confirm how the `judgeModel` param flows into `callLLM`.
- [ ] Read `src/lib/services/llms.ts` `callLLM` to confirm how `google/gemini-2.5-flash-lite` is routed (OpenRouter base URL, API key, headers).
- [ ] Reproduce the call locally or via tmux dev logs (per CLAUDE.md tmux instructions): trigger one rejudge with gemini-flash-lite + check `tmux capture-pane -t claude-<id>-backend` for the underlying error stack before `categorizeError` swallows it.
- [ ] Check `OPENROUTER_API_KEY` env var presence in `.env.local` / Vercel envs (per modelRegistry.ts the model is `provider: 'openrouter'`, `openRouterModelId: 'google/gemini-2.5-flash-lite'`).
- [ ] Check whether `allowedLLMModelSchema` (referenced by Prompt Editor docs) admits this model id; the Match Viewer route's Zod validation may reject the model id before the call even runs.
- [ ] Check whether `parseVerdictFromReasoning` (Match Viewer's tolerant parser) handles flash-lite output shapes — but this is downstream of the actual LLM call.

## Fix
- [ ] Once root cause is identified, implement the narrowest fix (env var, model allowlist entry, header config, error surfacing).
- [ ] Add a regression test if practical (unit test on the action with a mocked `callLLM` throwing the same provider error).

## Verification
- [ ] Manual: open `/admin/evolution/matches/<comparisonId>`, pick `google/gemini-2.5-flash-lite`, click Re-judge, confirm two prompts + responses + verdict render.
- [ ] Sanity: confirm `llmCallTracking` row appears with `call_source` matching the Match Viewer action path and no `evolution_metrics` / `evolution_arena_comparisons` writes occurred (display-only invariant per rating_and_comparison.md § Match Viewer Re-judge Sandbox).
