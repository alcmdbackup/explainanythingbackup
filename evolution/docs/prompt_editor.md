# Prompt Editor

<!-- Deep dive for the evolution admin rewrite-prompt editor (project tool_test_rewrite_prompts_evolution_20260605). -->

## Overview

An admin tool at `/admin/evolution/prompt-editor` that lets a researcher customize a rewrite
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
app LLM call — records one `llmCallTracking` row (`call_source='evolution_prompt_editor'`) and draws
on the shared daily `evolution` spend budget via `LLMSpendingGate`. This is desirable for cost
auditing. The integration test asserts the zero-pipeline-rows invariant.

## Architecture

```
UI (page.tsx) ──POST /api/evolution/prompt-editor──► route.ts (requireAdmin + Zod + enabled gate)
                                                       │
                                                       ▼
                                                  runPromptEditor()  [pre-flight cost cap, Promise.allSettled]
                                                       │  per config
                                                       ▼
                                                  runPromptEditorConfig()
                                                       ├─ buildPromptEditorPrompt(unit, source, spec)
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
- `userId = ANONYMOUS_USER_UUID`; `call_source='evolution_prompt_editor'`.

## API & data shapes

`evolution/src/lib/promptEditor/types.ts`:

```ts
type RewriteUnit = 'article' | 'paragraph';
// PromptSpec (article)   = { preamble, instructions }
// PromptSpec (paragraph) = { directive }
interface PromptEditorRunInput { unit, sourceText, title?, configs: PromptEditorConfig[] }
interface PromptEditorConfigResult {
  label; output: string | null; costUsd; model; temperatureUsed: number | null; durationMs;
  status: 'success' | 'budget' | 'killed' | 'timeout' | 'error';  // refusals are 'success'
  formatValid; formatIssues?; looksLikeRefusal?; errorMsg?;
}
interface PromptEditorRunResult { configs: PromptEditorConfigResult[]; totalCostUsd }
```

**Route** `POST /api/evolution/prompt-editor` (`maxDuration=300`): env gate
`EVOLUTION_PROMPT_EDITOR_ENABLED!=='0'` (else 403) → `requireAdmin()` (else 403) → Zod
(`unit`, non-empty `sourceText`, `configs` 1–10, each `model ∈ getEvolutionModelIds()`, prompt
shape matches unit) → `runPromptEditor` → JSON. Public host → 404 (middleware; no middleware change,
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

- **Pre-flight per-run cap** (`PROMPT_EDITOR_PER_RUN_CAP_USD = $0.50`, hardcoded v1): Σ over configs of
  `calculateLLMCost(model, prompt.length/4, cappedOutputTokens)`. Over the cap ⇒
  `PromptEditorCostCapError` → HTTP 402, before any LLM call.
- **Global backstop:** `LLMSpendingGate` enforces the daily/monthly `evolution` caps + kill switch
  at `callLLM`. Note prompt editor spend shares the daily `evolution` budget with real pipeline runs.

## Kill-switch / rollback

`EVOLUTION_PROMPT_EDITOR_ENABLED='0'` ⇒ the route returns 403 (the page surfaces the error on Run; the
static sidebar nav item is unaffected). No migration ⇒ rollback = flip the flag or revert the PR.

## "Load recent…" picker

Next to the source field, a **Load recent** control pre-populates the source from real content the
pipeline has handled. A toggle switches between **Rewritten** (the model's outputs) and **Originals**
(the source that was fed into a rewrite), for the current unit:

| Unit · Mode | Source rows |
|---|---|
| article · rewritten | `evolution_variants` `variant_kind='article'` (non-discarded) |
| article · original | `evolution_explanations` (the seed articles fed into runs) |
| paragraph · rewritten | `evolution_variants` `variant_kind='paragraph'`, `agent_name='paragraph_rewrite'` |
| paragraph · original | `evolution_variants` `variant_kind='paragraph'`, `agent_name='paragraph_original'` (the isolated source paragraph) |

Server actions (`evolution/src/services/promptEditorActions.ts`):
- `listRewriteSourcesAction({ unit, mode, limit })` → lightweight `{ id, source, preview, meta, createdAt }[]`
  (no full text; test-marker rows excluded via an `ilike` heuristic — the strict strategy-join filter
  can't be applied to `paragraph_original` rows, which have no `run_id`).
- `getRewriteSourceTextAction({ id, source })` → `{ text, title }`, called when an item is picked; fills
  the source textarea (and the title in paragraph mode).

## Key Files
- `evolution/src/lib/promptEditor/types.ts` — contracts.
- `evolution/src/services/promptEditorActions.ts` — "Load recent" picker actions (list + get-text).
- `evolution/src/lib/promptEditor/buildPromptEditorPrompt.ts` — reuses `buildEvolutionPrompt` /
  `buildParagraphRewritePrompt`.
- `evolution/src/lib/promptEditor/runPromptEditorConfig.ts` — one `callLLM`, cost via `onUsage`,
  temperature clamp, display-only validation, error→status.
- `evolution/src/lib/promptEditor/runPromptEditor.ts` — pre-flight cost cap + `Promise.allSettled`.
- `src/app/api/evolution/prompt-editor/route.ts` — admin/host-gated route, `maxDuration=300`.
- `src/app/admin/evolution/prompt-editor/page.tsx` (+ `loading.tsx`) — the UI.
- Discovery: `src/components/admin/EvolutionSidebar.tsx` (Tools group) + a card on
  `src/app/admin/evolution-dashboard/page.tsx`.

## Tests
- Unit: `buildPromptEditorPrompt.test.ts`, `runPromptEditorConfig.test.ts`, `runPromptEditor.test.ts`
  (mock `@/lib/services/llms`, fire `onUsage`).
- Integration: `src/__tests__/integration/evolution-prompt-editor.integration.test.ts`
  (ephemerality: zero evolution_* rows, scoped by `created_at`).
- E2E: `src/__tests__/e2e/specs/09-admin/admin-evolution-prompt-editor.spec.ts` (`@evolution`,
  route-mocked) + host-404 assertions in `00-host-isolation/host-isolation.spec.ts`.

## Related
- [Architecture](./architecture.md) · [Agents Overview](./agents/overview.md) ·
  [Paragraph Recombine](./paragraph_recombine.md) · [Cost Optimization](./cost_optimization.md) ·
  [Visualization](./visualization.md) · [Reference](./reference.md)
