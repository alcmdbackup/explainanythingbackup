# Add Deepseek New Model Support Plan

## Background
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek. The models must be selectable in the evolution strategy-creation UI, priced correctly for budget tracking, and configured as non-thinking models.

## Requirements (from GH Issue #1155)
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek.

Resolved decisions (see research doc):
- Both models register as **non-reasoning** (`supportsReasoning:false`), **thinking OFF** by default.
- Do **not** capture the reasoning trace.
- Explicitly **disable thinking** (`thinking:{type:'disabled'}`) for non-reasoning DeepSeek models so they behave as plain chat models.
- No changes to default-model constants.

## Problem
DeepSeek is already wired as a provider (`getDeepSeekClient` → `https://api.deepseek.com`), but only `deepseek-chat` is registered. The two new models must be added to the single source of truth (`MODEL_REGISTRY`), which auto-propagates to the allow-list schema, pricing, and the strategy-wizard dropdowns. One behavioral gap: DeepSeek defaults thinking ON, so a "non-reasoning" registry entry alone would still incur chain-of-thought latency/cost — `llms.ts` must send `thinking:{type:'disabled'}` for these models.

## Options Considered
- [x] **Option A: Registry entries + targeted `thinking:disabled` in `llms.ts` (CHOSEN)**: Add two `MODEL_REGISTRY` entries (non-reasoning); add one guarded snippet in `callOpenAIModel` to disable thinking for non-reasoning DeepSeek models. Minimal blast radius, satisfies "thinking off", auto-propagates everywhere.
- [ ] **Option B: Registry entries only (no `llms.ts` change)**: Simpler, but models would think internally by default → contradicts the "thinking off" decision (extra cost/latency). Rejected.
- [ ] **Option C: Full dual-mode reasoning support**: Add `reasoning_content` extraction + per-call thinking toggle UI. Out of scope per decisions 2–4. Rejected.

## Phased Execution Plan

### Phase 1: Register the two models
- [ ] In `src/config/modelRegistry.ts`, add two entries to `MODEL_REGISTRY` after the existing `deepseek-chat` entry (~line 120):
  ```typescript
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'deepseek',
    inputPer1M: 0.435, outputPer1M: 0.87, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', provider: 'deepseek',
    inputPer1M: 0.14, outputPer1M: 0.28, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  ```
- [ ] **Confirm pricing before merge** — sanity-check `inputPer1M`/`outputPer1M` against DeepSeek's live pricing page (pro promo may have lapsed; standard pro may be ~4× the promo numbers). Use cache-miss input price as `inputPer1M`. No `reasoningPer1M` (would double-count — see research finding 7).
- [ ] Verify auto-propagation (no edits needed): `allowedLLMModelSchema` (schemas.ts), `LLM_PRICING` (llmPricing.ts), `MODEL_OPTIONS` (modelOptions.ts) → all four wizard dropdowns. Module-init invariant passes (no `defaultReasoningEffort` on a `supportsReasoning:false` entry).

### Phase 2: Disable thinking for non-reasoning DeepSeek models (`llms.ts`)
- [ ] Export `isDeepSeekModel` (currently private at ~line 298): `export function isDeepSeekModel(...)`.
- [ ] Import `modelSupportsReasoning` from `@/config/modelRegistry` (already exported).
- [ ] In `callOpenAIModel`, after the reasoning-effort block (~line 459), add:
  ```typescript
  // DeepSeek defaults thinking ON. For non-reasoning DeepSeek models, explicitly disable
  // thinking so they behave as plain chat models (temperature honored, no CoT tokens billed).
  if (isDeepSeekModel(validatedModel) && !modelSupportsReasoning(validatedModel)) {
    (requestOptions as unknown as Record<string, unknown>).thinking = { type: 'disabled' };
  }
  ```
  (The OpenAI SDK forwards unknown fields to `api.deepseek.com`, same pattern already used for `reasoning`/`reasoning_effort`.) Existing `deepseek-chat` (also non-reasoning) gets the same treatment — consistent and harmless.

### Phase 3: Tests
- [ ] Add/extend unit tests (see Testing section).
- [ ] Add E2E dropdown assertion.

### Phase 4: Verify & document
- [ ] Run full local checks (lint, tsc, build, unit, ESM, integration, E2E critical).
- [ ] Update docs if needed (see Documentation Updates).

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — in the `getModelOptions()` "includes new models" test (~line 141), add `expect(values).toContain('deepseek-v4-pro')` and `'deepseek-v4-flash'`.
- [ ] `src/lib/schemas/schemas.test.ts` (~line 74) — add `expect(allowedLLMModelSchema.parse('deepseek-v4-pro')).toBe('deepseek-v4-pro')` and same for flash.
- [ ] `src/config/llmPricing.test.ts` — add a block asserting `LLM_PRICING['deepseek-v4-pro']`/`['deepseek-v4-flash']` are defined with expected input/output and **no** `reasoningPer1M`.
- [ ] `src/lib/services/llms.test.ts` —
  - add `expect(isOpenRouterModel('deepseek-v4-pro')).toBe(false)` / flash (mirror the existing `deepseek-chat` assertion ~line 914);
  - add a test mocking a `deepseek-v4-flash` call asserting the create request includes `thinking: { type: 'disabled' }` (mirror existing OpenAI/deepseek mock pattern).

### Integration Tests
- [ ] None required — no DB schema change, no new server action. (Existing integration suites must stay green.)

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — add an `adminTest` mirroring the "model dropdown includes gpt-oss-20b" test (~line 92): assert the generation-model `<select>` option values contain `deepseek-v4-pro` and `deepseek-v4-flash`.

### Manual Verification
- [ ] Open `/admin/evolution/strategies/new`, confirm both models appear in all four dropdowns (generation, judge, editing, approver).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` against the local server (via ensure-server.sh) — the new dropdown-contains-deepseek-v4 assertion passes.

### B) Automated Tests
- [ ] `npm run test -- src/config/modelRegistry.test.ts src/lib/schemas/schemas.test.ts src/config/llmPricing.test.ts src/lib/services/llms.test.ts`
- [ ] Full local check trio during `/finalize` (lint + tsc + build + unit + ESM + integration + E2E critical).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — `DEEPSEEK_API_KEY` already documented; verify the env/secret notes still read correctly (likely no change). No new env var introduced.
- [ ] (No new feature deep dive; the model registry is config, not a documented feature surface.)

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
