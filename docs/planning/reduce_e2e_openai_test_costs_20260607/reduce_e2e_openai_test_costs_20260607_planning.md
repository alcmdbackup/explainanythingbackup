# Reduce E2E OpenAI Test Costs Plan

## Background
Cut real OpenAI spend from automated tests while keeping a deliberate minimal real-LLM smoke. An investigation found that the `model=''` cost bucket on the staging/dev DB is integration-test **mock pollution** (2,102 ephemeral userids, fixtures echoed verbatim, `model=''` from `llms.ts` empty-model fallback, estimated cost only), while the **actual quota burn** (source of the `429 insufficient_quota` CI failures) comes from two real-AI paths: the nightly E2E workflow (`e2e-nightly.yml` — no `E2E_TEST_MODE`, full `@critical` pipeline × 2 browsers against prod) and PR-CI evolution seed generation (`CreateSeedArticleAgent`, not mocked outside prod). Goal: mock the wasteful paths, keep a tiny nightly real-AI smoke on a cheap model, and fix cost observability.

## Requirements (from GH Issue #1173)
Decision: keep MINIMAL nightly real-AI smoke (1–3 tests, single browser); cheap model = **Gemini Flash 2.5**; everything else mocked.

- **Phase 1 — Stop PR-CI 429s:** add an `E2E_TEST_MODE` seed-mock branch to the evolution seed path (deterministic seed article, mirroring `src/app/api/returnExplanation/test-mode.ts`). Gate so PR-CI evolution specs (`admin-evolution-run-pipeline` / `iterative-editing`) use the mock; real seed-gen stays only in nightly/explicit runs. Removes per-PR real OpenAI spend and the quota-driven firefox flakiness.
- **Phase 2 — Deliberate cheap real-AI tier:** tag a tiny set (~1–3 tests: one real generation, one real evolution seed) for nightly real-AI. Run once nightly, single browser (chromium), with Gemini Flash 2.5 via env-driven model override in the test path, instead of full `@critical` × 2-browser sweep. Keep the rest of nightly on the mocked (`E2E_TEST_MODE`) path.
- **Phase 3 — Observability + spend guard:** fix `llms.ts` empty-model fallback (`modelUsed = lastChunk.model || ''`) to fall back to `requestOptions.model` so the `model=''` bucket disappears and cost attribution is correct; ensure mocked test calls record `estimated_cost_usd = 0`; add a CI/nightly spend pre-check (reuse `LlmSpendingGate` / `daily_cost_rollups`) that fails fast with a clear message instead of an opaque 429.
- **Phase 4 (optional) — Reduce integration-test `llmCallTracking` pollution** in the shared dev DB: skip the insert under the integration mock, or keep with correct model + $0 (verify no integration test asserts on these rows first).

Key files: `.github/workflows/e2e-nightly.yml`, `.github/workflows/ci.yml`, `src/app/api/returnExplanation/route.ts` + `test-mode.ts`, `evolution/src/services/arenaActions.ts` (CreateSeedArticleAgent seed path), `src/lib/services/llms.ts` (model='' bug + cost estimation), `src/lib/services/llmSpendingGate.ts`, `jest.integration-setup.js`, `src/testing/fixtures/llm-responses.ts`.

## Problem
Automated tests burn real OpenAI quota where they don't need to: PR-CI evolution specs run real seed generation on every evolution-touching PR, and the nightly runs the full real pipeline on two browsers against production. When the OpenAI account hits its quota, these surface as opaque `429 insufficient_quota` failures (notably firefox-only flakiness), blocking unrelated PRs. Separately, integration tests pollute the shared dev `llmCallTracking` table with `model=''` mock rows that carry an estimated (fake) cost, corrupting the cost dashboard and masking real spend. We want near-zero routine test spend, a small intentional real-AI signal on a cheap model, and correct cost observability.

## Options Considered
- [ ] **Option A: Mock the evolution seed path via `E2E_TEST_MODE` (mirror `returnExplanation/test-mode.ts`) + add a `@prod-ai` cheap-model tier (RECOMMENDED).** Reuses the existing short-circuit pattern and the existing `@prod-ai`/`@skip-prod` tag convention. Lowest-risk, smallest blast radius, keeps a real signal.
- [ ] **Option B: Mock everything, zero real-AI in any automated test.** Cheapest, but real provider/SDK regressions (streaming format, tool-call schema, provider outages) go uncaught until a user hits them in prod. Rejected per user decision (keep a minimal smoke).
- [ ] **Option C: Keep full `@critical` real but force a cheap model + single browser.** Broader real coverage but materially higher cost and slower nightly than a 1–3 test smoke; over-tests the same pipeline repeatedly. Rejected in favor of a tiny dedicated tier.

## Phased Execution Plan

### Phase 0: Add Gemini Flash 2.5 to the model registry (prerequisite)
- [ ] Add `google/gemini-2.5-flash` to `src/config/modelRegistry.ts` (model id, provider routing, temperature/reasoning capabilities) — route via the already-wired **OpenRouter** provider path to avoid adding a new SDK.
- [ ] Add pricing for the model in `src/config/llmPricing.ts` so `calculateLLMCost` prices it (no `model=''`/$0 surprises).
- [ ] Ensure the model is accepted by `allowedLLMModelSchema` (`src/lib/schemas/schemas.ts`) so `callLLM` validation passes.
- [ ] Unit test: `src/config/modelRegistry.test.ts` (or pricing test) asserts the new model resolves to OpenRouter + has finite pricing.

### Phase 1: Stop PR-CI 429s — mock evolution seed generation under E2E_TEST_MODE
- [ ] Add a deterministic seed-article mock branch to the evolution seed path (`CreateSeedArticleAgent` / its call site in `evolution/src/lib/pipeline/`), gated on `process.env.E2E_TEST_MODE === 'true'`, mirroring `src/app/api/returnExplanation/test-mode.ts` (return a fixed `[TEST_EVO]`-prefixed seed article, no LLM call).
- [ ] Confirm `evolution/src/services/arenaActions.ts:624-626` production guard still forbids `E2E_TEST_MODE` in production (mock must never run in prod).
- [ ] Verify PR-CI `e2e-evolution` job environment provides `E2E_TEST_MODE=true` to the app-under-test so the mock path is taken; if the deployment env doesn't set it, set it for the job.
- [ ] Result: `admin-evolution-run-pipeline.spec.ts` + `admin-evolution-iterative-editing.spec.ts` complete with no real OpenAI calls on PRs.

### Phase 2: Deliberate cheap real-AI tier (`@prod-ai` + Gemini Flash 2.5)
Model decision: **Gemini Flash 2.5** (`google/gemini-2.5-flash` via OpenRouter) — confirmed cheaper than `gpt-4.1-mini` for this workload (the registry/estimate pricing used during research was stale; trust the live provider pricing). Cost is the goal here, not prod-model fidelity, so the cheap model is intentional.
- [ ] Add an env-driven model override (e.g. `TEST_LLM_MODEL`) honored only in the real-AI test tier; when set, the generation + seed call sites use it instead of `DEFAULT_MODEL`. Default unset (prod behavior unchanged).
- [ ] Tag ~1–3 tests `@prod-ai` (reuse existing tag): one real search→generate, one real evolution seed run. Ensure mock-dependent specs keep `@skip-prod`.
- [ ] **The single real generation test must exercise the FULL pipeline** — title gen → content gen → tag eval → heading-standalone-title gen → link extraction → summary — so every real LLM call site gets at least one real exercise per night (a prompt/contract regression in any ancillary call is otherwise invisible until prod). Assert that each stage produced non-empty, schema-valid output (title present, content present, ≥1 tag, headings/links resolved without error).
- [ ] Update `.github/workflows/e2e-nightly.yml`: run the `@prod-ai` tier **chromium-only** with `TEST_LLM_MODEL=google/gemini-2.5-flash`; run the remaining `@critical`/`@evolution` coverage under `E2E_TEST_MODE=true` (mocked, both browsers OK since cost ≈ 0).
- [ ] Confirm `[TEST]`/`[TEST_EVO]` prefixes + teardown still apply so real-AI-generated content is cleaned up.

> **Known accepted trade-off:** the `@prod-ai` tier runs on Gemini Flash 2.5, not the prod model (`gpt-4.1-mini`). This smoke verifies "the pipeline works end-to-end with a real LLM," NOT prod-provider/model fidelity. An OpenAI-specific contract change to `gpt-4.1-mini` would not be caught by this tier — accepted because routine real spend stays minimal and the mocked tier + post-deploy smoke cover the prod path. Detection latency for real-integration regressions is up to ~24h (next nightly), surfaced via the existing `[release-health]` auto-issue + Slack alert.

### Phase 3: Observability + spend guard
- [ ] Fix `src/lib/services/llms.ts`: when the response/stream omits `model`, fall back to `requestOptions.model` (the requested model) instead of `''`. Kills the `model=''` bucket and fixes cost attribution.
- [ ] Ensure mocked LLM calls record `estimated_cost_usd = 0` (don't estimate a cost from token counts when the SDK is mocked) so the dashboard reflects only real spend.
- [ ] Add a nightly/CI spend pre-check step (reuse `LlmSpendingGate` / `daily_cost_rollups`) that fails fast with a clear `[release-health]`-style message when the daily cap is already exhausted, instead of letting an opaque provider 429 surface mid-run.

### Phase 4 (optional): Reduce integration-test llmCallTracking pollution
- [ ] Audit integration tests for any assertions on `llmCallTracking` rows (gates the approach).
- [ ] If none assert: skip the `llmCallTracking` insert when the OpenAI SDK is mocked (detect via a test-mode flag in `jest.integration-setup.js` / a `callLLM` option). Otherwise keep the insert but with correct `model` + `estimated_cost_usd = 0` (covered by Phase 3).

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — Gemini Flash 2.5 resolves to OpenRouter provider + has finite pricing in `llmPricing`.
- [ ] `src/lib/services/llms.test.ts` — model-fallback fix: when a (mock) response omits `model`, the tracking row records `requestOptions.model`, not `''`; mocked calls record `estimated_cost_usd = 0`.
- [ ] Evolution seed mock unit test (under `evolution/src/lib/pipeline/`) — when `E2E_TEST_MODE=true`, the seed agent returns the deterministic article and makes no LLM call.

### Integration Tests
- [ ] `src/__tests__/integration/explanation-generation.integration.test.ts` (or a focused new test) — verify the empty-model fallback + `$0` mocked cost behavior end-to-end against the real dev DB tracking insert.
- [ ] Evolution pipeline integration test — `E2E_TEST_MODE` seed mock produces a valid run without external LLM spend.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — passes under PR-CI with the seed mock (no real OpenAI), both chromium + firefox.
- [ ] A `@prod-ai`-tagged real-AI spec (one search→generate, one evolution seed) — runs nightly chromium-only on Gemini Flash 2.5 and produces cleaned-up `[TEST]` content. The generation spec asserts FULL-pipeline output: non-empty title, non-empty content, ≥1 assigned tag, and headings/links resolved without error (proves every real call site executed).

### Manual Verification
- [ ] After a nightly dry-run (manual `workflow_dispatch`), query `llmCallTracking` and confirm: only `@prod-ai` rows carry real cost, all on `google/gemini-2.5-flash`; no new `model=''` rows.
- [ ] Trigger a PR-CI evolution run and confirm zero real OpenAI calls attributable to the run.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI changes expected. If the seed-mock alters any admin run-pipeline UI state, run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` on the local server via `ensure-server.sh`.

### B) Automated Tests
- [ ] `npm run test -- --runTestsByPath src/lib/services/llms.test.ts src/config/modelRegistry.test.ts`
- [ ] `npm run test:integration` (explanation-generation + evolution pipeline)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — **correct the stale claim** (line ~276) that nightly sets `E2E_TEST_MODE=true`; document the new `@prod-ai` cheap-model tier + `TEST_LLM_MODEL` override.
- [ ] `docs/docs_overall/testing_overview.md` — document the evolution seed mock under `E2E_TEST_MODE`, the `@prod-ai` Gemini tier, and the mocked-call `$0` cost behavior.
- [ ] `docs/docs_overall/llm_provider_limits.md` — add Gemini Flash 2.5 (OpenRouter) to the providers/models table.
- [ ] `docs/feature_deep_dives/search_generation_pipeline.md` — note the ancillary call sites (title/tag/heading/link) and the test-tier model override.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` / `docs/feature_deep_dives/metrics_analytics.md` — note the empty-model tracking fix + `$0` mocked-cost convention if they reference cost attribution.
- [ ] `docs/feature_deep_dives/realtime_streaming.md` / `request_tracing_observability.md` — only if the model-fallback fix changes documented tracking fields.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
