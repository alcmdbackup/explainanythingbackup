# Prompt Playground

<!-- Deep dive for the evolution admin rewrite-prompt playground (project tool_test_rewrite_prompts_evolution_20260605). -->

## Overview

An admin tool at `/admin/evolution/prompt-playground` that lets a researcher customize a rewrite
prompt + model + temperature and compare the **raw model outputs** of multiple configs **side by
side**, with per-config cost. It is a *prompt* testbed, not the agent: each config is a **single
LLM call** — no ranking, no recombine, no pool, no full generate→rank→evolve run.

**Two rewrite units (v1):**
- **Whole-article rewrite** — a generate-tactic prompt (preamble + instructions, FORMAT_RULES
  auto-appended) over an article → one generation call → the rewritten article.
- **Paragraph rewrite** — a rewrite directive (wrapped in the per-slot ±20%-length scaffolding)
  over a single paragraph → one rewrite call → the rewritten paragraph.

A **run** = one **shared source input** + **N config cards** (each varying `{prompt, model,
temperature}`, max 10). "Run all" dispatches every config in parallel (`Promise.allSettled`);
one config's failure never blocks the others.

**Out of scope (future):** relative judging / Elo of the output pool (the pool is already a
first-class object so a "Judge this pool" button drops in later), editing the judge prompt
(handled by a parallel project), matrix auto-expansion of configs, criteria/editing/debate/
full-recombine families, persisted sessions, fully-raw whole-prompt override.

## Not "zero DB" — but no pipeline rows

The harness writes **no** evolution-pipeline rows (`evolution_agent_invocations`,
`evolution_variants`, `evolution_metrics`, `evolution_arena_comparisons`). It does NOT call
`Agent.run()`/`Agent.execute()` at all. However, it calls the app's `callLLM`, which — like every
app LLM call — records one `llmCallTracking` row (`call_source='evolution_playground'`) and draws
on the shared daily `evolution` spend budget via `LLMSpendingGate`. This is desirable for cost
auditing. The integration test asserts the zero-pipeline-rows invariant.

## Architecture

```
UI (page.tsx) ──POST /api/evolution/playground──► route.ts (requireAdmin + Zod + enabled gate)
                                                       │
                                                       ▼
                                                  runPlayground()  [pre-flight cost cap, Promise.allSettled]
                                                       │  per config
                                                       ▼
                                                  runPlaygroundConfig()
                                                       ├─ buildPlaygroundPrompt(unit, source, spec)
                                                       ├─ callLLM(...) → string, cost via onUsage
                                                       └─ validateFormat / validateParagraphRewrite (display-only)
```

### `callLLM` contract (load-bearing)
`callLLM(prompt, call_source, userId, model, streaming, setText, responseObj, responseObjName,
debug, options)` returns `Promise<string>`. Key points the harness depends on:
- `model` is the **4th positional arg**, typed `AllowedLLMModelType` (validated via
  `allowedLLMModelSchema`).
- Pass **`null`** (not `undefined`) for `setText`/`responseObj`/`responseObjName` — when
  `streaming=false`, `validateStreamingArgs` throws if `setText !== null`.
- Token usage + cost arrive via `options.onUsage(usage: LLMUsageMetadata)`; `usage.estimatedCostUsd`
  is the per-call cost. The harness captures it in a closure (mirrors
  `claimAndExecuteRun.ts:218-233`).
- `userId = ANONYMOUS_USER_UUID`; `call_source='evolution_playground'`.

## API & data shapes

`evolution/src/lib/playground/types.ts`:

```ts
type RewriteUnit = 'article' | 'paragraph';
// PromptSpec (article)   = { preamble, instructions }
// PromptSpec (paragraph) = { directive }
interface PlaygroundRunInput { unit, sourceText, title?, configs: PlaygroundConfig[] }
interface PlaygroundConfigResult {
  label; output: string | null; costUsd; model; temperatureUsed: number | null; durationMs;
  status: 'success' | 'budget' | 'killed' | 'timeout' | 'error';  // refusals are 'success'
  formatValid; formatIssues?; looksLikeRefusal?; errorMsg?;
}
interface PlaygroundRunResult { configs: PlaygroundConfigResult[]; totalCostUsd }
```

**Route** `POST /api/evolution/playground` (`maxDuration=300`): env gate
`EVOLUTION_PLAYGROUND_ENABLED!=='0'` (else 403) → `requireAdmin()` (else 403) → Zod
(`unit`, non-empty `sourceText`, `configs` 1–10, each `model ∈ getEvolutionModelIds()`, prompt
shape matches unit) → `runPlayground` → JSON. Public host → 404 (middleware; no middleware change,
since `EVOLUTION_PREFIXES` already covers `/api/evolution` + `/admin/evolution`).

## Model & temperature

- The dropdown lists `getModelOptions()` (== `getEvolutionModelIds()`, the same allowlist `callLLM`
  validates against). An off-list model can't be selected and would ZodError at the route.
- `getModelMaxTemperature(model)` returns `number | null | undefined`. `null`/`undefined` ⇒ the
  temperature input is disabled and temperature is omitted from the call. Otherwise the value is
  clamped `Math.min(userTemp, maxTemp)`.

## Error handling & status

`callLLM` throws `GlobalBudgetExceededError` → `budget`, `LLMKillSwitchError` → `killed`,
abort/timeout → `timeout`, else `error`. `LLMRefusalError` is **not** thrown by `callLLM` — a model
refusal returns as ordinary text with `status:'success'` and a non-blocking `looksLikeRefusal`
display hint.

## Cost guardrails

- **Pre-flight per-run cap** (`PLAYGROUND_PER_RUN_CAP_USD = $0.50`, hardcoded v1): Σ over configs of
  `calculateLLMCost(model, prompt.length/4, cappedOutputTokens)`. Over the cap ⇒
  `PlaygroundCostCapError` → HTTP 402, before any LLM call.
- **Global backstop:** `LLMSpendingGate` enforces the daily/monthly `evolution` caps + kill switch
  at `callLLM`. Note playground spend shares the daily `evolution` budget with real pipeline runs.

## Kill-switch / rollback

`EVOLUTION_PLAYGROUND_ENABLED='0'` ⇒ the route returns 403 and the sidebar nav item hides. No
migration ⇒ rollback = flip the flag or revert the PR.

## Key Files
- `evolution/src/lib/playground/types.ts` — contracts.
- `evolution/src/lib/playground/buildPlaygroundPrompt.ts` — reuses `buildEvolutionPrompt` /
  `buildParagraphRewritePrompt`.
- `evolution/src/lib/playground/runPlaygroundConfig.ts` — one `callLLM`, cost via `onUsage`,
  temperature clamp, display-only validation, error→status.
- `evolution/src/lib/playground/runPlayground.ts` — pre-flight cost cap + `Promise.allSettled`.
- `src/app/api/evolution/playground/route.ts` — admin/host-gated route, `maxDuration=300`.
- `src/app/admin/evolution/prompt-playground/page.tsx` (+ `loading.tsx`) — the UI.
- Discovery: `src/components/admin/EvolutionSidebar.tsx` (Tools group) + a card on
  `src/app/admin/evolution-dashboard/page.tsx`.

## Tests
- Unit: `buildPlaygroundPrompt.test.ts`, `runPlaygroundConfig.test.ts`, `runPlayground.test.ts`
  (mock `@/lib/services/llms`, fire `onUsage`).
- Integration: `src/__tests__/integration/evolution-prompt-playground.integration.test.ts`
  (ephemerality: zero evolution_* rows, scoped by `created_at`).
- E2E: `src/__tests__/e2e/specs/09-admin/admin-evolution-prompt-playground.spec.ts` (`@evolution`,
  route-mocked) + host-404 assertions in `00-host-isolation/host-isolation.spec.ts`.

## Related
- [Architecture](./architecture.md) · [Agents Overview](./agents/overview.md) ·
  [Paragraph Recombine](./paragraph_recombine.md) · [Cost Optimization](./cost_optimization.md) ·
  [Visualization](./visualization.md) · [Reference](./reference.md)
