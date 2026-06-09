# error_communicating_gemini_service_evolution_20260607 Research

## Problem Statement
Invoking `google/gemini-2.5-flash-lite` from the evolution admin Match Viewer (`/admin/evolution/matches/[comparisonId]` → Re-judge button) returns the toast "Error communicating with AI service" instead of a verdict.

## High Level Summary
"Error communicating with AI service" is the user-facing message of `ERROR_CODES.LLM_API_ERROR`, produced by `categorizeError` in `src/lib/errorHandling.ts:69-75` whenever the underlying error message (lowercased) contains the substring `api` OR `openai`. The categorizer's match is extremely loose — almost any LLM-related error (missing key, SDK auth failures, rate limits, even some pipeline errors mentioning ".env") gets bucketed here, and the actual underlying error is hidden behind the generic string. The match-viewer client (`src/app/admin/evolution/matches/[comparisonId]/page.tsx:132`) just toasts `res.error?.message`, which is exactly that generic string.

A bare reproduction with the same OpenRouter routing the code uses (`OpenAI` SDK, `baseURL='https://openrouter.ai/api/v1'`, key from `.env.local`, model `google/gemini-2.5-flash-lite`) **succeeds in 1.4s** with a clean `B` verdict (see `scripts/repro_gemini_match_viewer.mjs`). So the OpenRouter integration itself is healthy. The error is happening somewhere upstream of the SDK call.

Most likely candidate (matches the substring-`api` rule exactly): **`OPENROUTER_API_KEY` missing from the server process the user is hitting.** `getOpenRouterClient()` (`src/lib/services/llms.ts:341-343`) throws `"OPENROUTER_API_KEY not found in environment variables. Please check your .env file."` — which contains "api" three times and is therefore re-cast to "Error communicating with AI service". The bare repro using the local `.env.local` key works, so the issue is environment-specific (a Next.js dev server that wasn't restarted after the key was added, or a staging/prod environment without the secret).

## Reproduction
- `scripts/repro_gemini_match_viewer.mjs` — mirrors `callOpenAIModel`'s OpenRouter path. Result: **SUCCESS** (`finish_reason: stop`, `content: B`, $0.0000065 cost). Proves the OpenRouter route + key + model is functional from the repo root.
- `scripts/repro_gemini_match_viewer_nokey.mjs` — exercises the "no env var" + "bad key" branches:
  - **Case 1 — no env var:** message = `"OPENROUTER_API_KEY not found in environment variables. Please check your .env file."` → matches `lowercased.includes('api')` → categorizer maps to `LLM_API_ERROR` → user sees **"Error communicating with AI service"** (exact match to the bug).
  - **Case 2 — bad key (401 from OpenRouter):** message = `"401 User not found."` → no `api`/`openai` substring → categorizer falls through to `UNKNOWN_ERROR` → user sees the raw `"401 User not found."` (visible diagnostic).
- The Case-1 message is the canonical match for the user's symptom. Case-2 is what they would see if the key were *present but invalid*.

## Call Path
1. UI: `MatchDetailPage` → `handleRejudge` (`src/app/admin/evolution/matches/[comparisonId]/page.tsx:119-135`) sends `{comparisonId, judgeModel, mode, temperature, explainReasoning, customPrompt}` to `rejudgeComparisonAction`.
2. Server action: `rejudgeComparisonAction` in `evolution/src/services/arenaActions.ts:555-676` validates model via `getEvolutionModelIds().includes(judgeModel)` (`google/gemini-2.5-flash-lite` is in the allowlist), builds the 2-pass prompts via `buildComparisonPrompt`, calls `callLLM(prompt, 'match_viewer_rejudge', ctx.adminUserId, judgeModel, false, null, null, null, false, opts)` twice in `Promise.all`.
3. `callLLM` = `callLLMWithLogging` (`withLogging` wrapper, `src/lib/services/llms.ts:910-916`) → `callLLMModelRaw` (line 830).
4. `callLLMModelRaw` (lines 842-869): checks `LLMSpendingGate.checkBudget(call_source, estimatedCost)` (DB-backed; fails closed on DB outage), then skips the LLM semaphore because `'match_viewer_rejudge'` does **not** start with `evolution_`, then calls `routeLLMCall`.
5. `routeLLMCall` (line 892): not Anthropic → `callOpenAIModel`.
6. `callOpenAIModel` (lines 397-703): runs `allowedLLMModelSchema.parse(model)`, computes `apiModel` via `getOpenRouterApiModelId('google/gemini-2.5-flash-lite')` = `'google/gemini-2.5-flash-lite'`, picks the OpenRouter client via `isOpenRouterModel(validatedModel) → getOpenRouterClient()`. **This is where the missing key throws.**
7. The `adminAction` wrapper around `rejudgeComparisonAction` catches any thrown error, runs it through `handleError → categorizeError`, returns `ActionResult<T>` with `error.message = "Error communicating with AI service"`.

## Documents Read
- `/home/ac/Documents/ac/worktree_37_6/docs/docs_overall/architecture.md` — server-action pattern, error-handling overview.
- `/home/ac/Documents/ac/worktree_37_6/docs/docs_overall/project_workflow.md` — research step expectations.
- `/home/ac/Documents/ac/worktree_37_6/evolution/docs/arena.md` § Match Viewer entry — confirmed `/admin/evolution/matches/[comparisonId]` is the re-judge sandbox.
- `/home/ac/Documents/ac/worktree_37_6/evolution/docs/rating_and_comparison.md` § Match Viewer Re-judge Sandbox — confirmed it drives `run2PassReversal` against the plain `callLLM` path (not the evolution client), so the failure can't be a cost-tracker / budget-gate issue specific to the evolution pipeline.
- `/home/ac/Documents/ac/worktree_37_6/evolution/docs/reference.md` — `adminAction` factory wraps every server action with `handleError`; arenaActions.ts § Match Viewer actions inventory.

## Code Files Read
- `src/lib/errorHandling.ts:69-75` — the load-bearing too-eager `message.includes('api') || message.includes('openai')` rule.
- `src/lib/services/llms.ts:333-360` — `getOpenRouterClient` + the "no env var" `Error` whose message contains "api".
- `src/lib/services/llms.ts:397-703` — `callOpenAIModel` end-to-end (model validation, request build, client selection, error rethrow via `handleLLMCallError`).
- `src/lib/services/llms.ts:830-918` — `callLLMModelRaw` + `withLogging`-wrapped export.
- `src/config/modelRegistry.ts:142-147, 240-242, 252-259` — `google/gemini-2.5-flash-lite` entry (`supportsEvolution: true`, `provider: 'openrouter'`, `openRouterModelId: 'google/gemini-2.5-flash-lite'`), `getEvolutionModelIds`, `isOpenRouterModel`.
- `evolution/src/services/arenaActions.ts:555-676` — `rejudgeComparisonAction`.
- `src/app/admin/evolution/matches/[comparisonId]/page.tsx:1-141` — the Match Viewer detail UI.

## Key Findings
1. **The categorizer's `api`/`openai` substring rule swallows almost every LLM-related error into one generic surface string.** This is the proximate cause of "no visibility into what's actually wrong". `details: error.message` exists on the `ErrorResponse` but isn't surfaced anywhere in the match-viewer toast (`res.error?.message`).
2. **OpenRouter integration is mechanically healthy.** Bare repro with the project's `.env.local` `OPENROUTER_API_KEY` + the same `OpenAI` SDK config returns a clean verdict for `google/gemini-2.5-flash-lite` in ~1.4s. Validation against `allowedLLMModelSchema` also passes (the model is registered with `supportsEvolution: true`).
3. **Highest-probability root cause: `OPENROUTER_API_KEY` is not set in the server process the user is invoking from.** That throws the exact message `"OPENROUTER_API_KEY not found in environment variables. Please check your .env file."` whose lowercased form matches both `api` and `openai`-adjacent patterns → categorizes to LLM_API_ERROR → user sees the symptom string. Same mechanism applies to staging/Vercel if `OPENROUTER_API_KEY` isn't in the Vercel project's env vars for the environment being hit.
4. **Secondary candidates** (less likely but indistinguishable from the user's symptom because of finding 1):
   - `LLMSpendingGate.checkBudget` failing with a message containing "api" (e.g., the DB-unreachable fail-closed path may produce a Supabase error message containing 'api' literally).
   - OpenAI SDK errors that include "API" in their message (e.g., `"Incorrect API key provided"`, certain `502`/`503` upstream errors that mention "api.openrouter.ai").
   - A stale Next.js dev server that doesn't have the key in its `process.env` (Next.js `.env.local` is read at startup only — adding the key without restarting the server reproduces this exactly).

## Confirmed Root Cause (2026-06-07 follow-up)

**Yes, `google/gemini-2.5-flash-lite` was used in evolution runs and was working.** Staging shows **97 completed runs** with `generationModel = google/gemini-2.5-flash-lite` (judge `qwen-2.5-7b-instruct`), most recent **2026-05-31T20:45:36Z**. Prod: 0 runs (gemini was staging-only).

**Why the Match Viewer suddenly breaks while evolution runs worked:** they run in two different processes with two different env stores.

| Path | Runs as | Env source | Has `OPENROUTER_API_KEY`? |
|---|---|---|---|
| Evolution batch runs | `processRunQueue.ts` on the **minicomputer** (systemd timer per `evolution/docs/minicomputer_deployment.md`) | local `.env.local` on the minicomputer (which DOES contain `OPENROUTER_API_KEY` — confirmed 1 match in this worktree's `.env.local`) | Yes — 97 runs succeeded |
| Match Viewer Re-judge | Vercel server action in the Next.js-hosted process | Vercel project environment variables | **No — until 14 minutes before this writeup** |

`vercel env ls` (linked to `acs-projects-dcdb9943/explainanything`) shows `OPENROUTER_API_KEY` was added to `Preview, Production, staging` **only 14 minutes ago**. It is **still absent from the `Development` environment** (where `vercel dev` / local Next.js would pull from). Until that very recent add, the Next.js process serving `/admin/evolution/matches/[comparisonId]` literally had no `OPENROUTER_API_KEY` in `process.env`, so `getOpenRouterClient()` in `src/lib/services/llms.ts:341-343` threw `"OPENROUTER_API_KEY not found in environment variables. Please check your .env file."` — whose lowercased text contains `api` (in "api_key" and ".env") — and `categorizeError` mapped it to `LLM_API_ERROR` → toast says "Error communicating with AI service".

The Match Viewer feature itself only landed yesterday (`23230ece [Project] match_viewer_with_experimentation_procedures_20260605 (#1168)`, 2026-06-06). It is the *first* code path on Vercel that needs OpenRouter at runtime — every prior OpenRouter call ran on the minicomputer, which is why nothing else surfaced this missing-secret gap.

### Fix

**Code (shipped in this PR):**
- `src/lib/errorHandling.ts` — tighten the LLM_API_ERROR bucket from naked `.includes('api')` to a word-boundary `/\bapi\b/` (and same for `openai`). Env-var-style errors like `"OPENROUTER_API_KEY not found..."` where `api` is glued to `_` now correctly fall through to `UNKNOWN_ERROR` with the raw message intact instead of collapsing into the opaque "Error communicating with AI service" string.
- `src/lib/errorHandling.test.ts` — regression cases for `OPENROUTER_API_KEY` + `ANTHROPIC_API_KEY` "not found" messages.
- `src/app/admin/evolution/matches/[comparisonId]/page.tsx` — match-viewer toast now surfaces `error.details` alongside the bucket message so any future LLM-flavored error that *legitimately* hits the LLM_API_ERROR path still shows its root cause directly to the operator.

**Ops (user side, NOT in this PR):**
1. **Trigger a staging redeploy** so the now-set `OPENROUTER_API_KEY` Vercel env var actually lands in the running deployment. The 14m-ago add is in the env store, but the deployment currently serving `explainanythingstage.vercel.app` was built before the add and so still has no key at runtime.
2. **Add `OPENROUTER_API_KEY` to the Vercel `Development` environment too** — `vercel env ls` shows it currently in `Preview, Production, staging` only, so `vercel dev` (or any Next.js path that pulls from Development) repros the same symptom.
3. **Same root cause hits DeepSeek + Anthropic models in staging.** `vercel env ls` shows:
   - `DEEPSEEK_API_KEY` — `Development, Preview, Production` (**NOT staging**)
   - `ANTHROPIC_API_KEY` — `Development, Preview, Production` (**NOT staging**)
   - `OPENROUTER_API_KEY` — `Preview, Production, staging` (11h ago; **NOT Development**)
   - `OPENAI_API_KEY` — `Development, Preview, Production, staging` (the only one fully populated)

   So Re-judge with any of `deepseek-chat` / `deepseek-v4-pro` / `deepseek-v4-flash` / `claude-sonnet-4-20250514` against staging will hit the identical "X_API_KEY not found in environment variables" → categorize-to-LLM_API_ERROR → opaque toast path. Confirmed locally: `deepseek-chat` via `api.deepseek.com` succeeds in ~1.3s with the project's `DEEPSEEK_API_KEY`; only staging is broken because the secret isn't present there.

   **Action:** add `DEEPSEEK_API_KEY` + `ANTHROPIC_API_KEY` + `OPENROUTER_API_KEY` to the `staging` Vercel env (and `OPENROUTER_API_KEY` to `Development`), then redeploy staging. After the categorizer fix lands the toast will show the actual "DEEPSEEK_API_KEY not found..." text directly so you can diagnose any future env-var gap without DB log digging.

## Adjacent fix in this PR (test resilience)

`src/__tests__/integration/evolution-prompt-editor.integration.test.ts` was racing the live minicomputer batch runner against the shared staging DB: the test asserted "no rows in `evolution_agent_invocations` / `_variants` / `_metrics` / `_arena_comparisons` since `sinceIso`" but the minicomputer was actively writing 40+ invocation rows / 20m. The "no DB writes" invariant is structural (`runPromptEditor` doesn't import any supabase module), so the test now spies `createSupabaseServiceClient` via `jest.mock('@/lib/utils/supabase/server')` and asserts it was never called. Deterministic, doesn't race production traffic, catches the most likely regression (someone wiring supabase into the prompt-editor code path).

### Open follow-up (low priority)
- Should the minicomputer .env.local schema be documented to require `OPENROUTER_API_KEY`? Currently `evolution/docs/minicomputer_deployment.md` lists OPENAI/DEEPSEEK/ANTHROPIC only.
