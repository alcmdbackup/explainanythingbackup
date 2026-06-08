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

> **CRITICAL topology fact (drives the whole design).** `playwright.config.ts:167-184` disables the local `webServer` whenever `BASE_URL` is set. The deployed-prod nightly (`e2e-nightly.yml`) sets `BASE_URL=<prod>`, so it tests a **deployed Vercel app** — you CANNOT set `E2E_TEST_MODE` or `TEST_LLM_MODEL` on it (those are server-startup env vars). Therefore: **server-side mocking and model-override only work against a LOCAL build** (the PR-CI pattern: `npm run build && E2E_TEST_MODE=true ... npm start`, `playwright.config.ts:180-181`; and the existing port-3009 secondary server that runs *without* `E2E_TEST_MODE` for real-behavior tests, `playwright.config.ts:141-146`). The cheap-Gemini real-AI smoke (Phase 2) therefore runs against a **local build**, NOT against deployed prod.

### Phase 0: Add Gemini Flash 2.5 to the model registry (prerequisite)
- [ ] Add `google/gemini-2.5-flash` to `MODEL_REGISTRY` in `src/config/modelRegistry.ts`, mirroring the EXISTING `google/gemini-2.5-flash-lite` entry (`modelRegistry.ts:159-163`): fields `id`, `displayName`, `provider: 'openrouter'`, `inputPer1M`, `outputPer1M`, `maxTemperature`, `supportsEvolution: true`, `openRouterModelId: 'google/gemini-2.5-flash'`, `supportsReasoning: false`. (Note: only `-lite` exists today; the full `-flash` must be added. `-lite` is a ready, even-cheaper fallback if desired.)
- [ ] Satisfy the registry invariant: if `supportsReasoning: false`, do NOT set `defaultReasoningEffort` (and vice-versa) — the Phase 1.19/1.20 invariant check throws otherwise.
- [ ] Pricing auto-derives from the registry entry (`llmPricing.ts` builds `registryPricing` from `MODEL_REGISTRY`) — no separate `llmPricing.ts` edit needed; verify `calculateLLMCost('google/gemini-2.5-flash', …)` returns finite cost.
- [ ] Confirm membership in `allowedLLMModelSchema` (`src/lib/schemas/schemas.ts`) via `getEvolutionModelIds()` (driven by `supportsEvolution: true`) so `callLLM` validation passes.
- [ ] Unit test: `src/config/modelRegistry.test.ts` asserts the model resolves to OpenRouter, `getOpenRouterApiModelId('google/gemini-2.5-flash')` returns the API id, and pricing is finite.

### Phase 1: Stop PR-CI 429s — mock evolution seed generation under E2E_TEST_MODE
- [ ] Add the mock at the seed-generation boundary `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` (the function that calls `llm.complete()` ×2; NOT `arenaActions.ts`, whose `E2E_TEST_MODE` guard at `:624-626` is for the **judge** path, not seed gen). When `process.env.E2E_TEST_MODE === 'true'`, **early-return before any `llm.complete()` call and before the timeout guard fires**, returning an object of the SAME shape `generateSeedArticle` normally returns, with the article title/body `[TEST_EVO]`-prefixed (so existing evolution cleanup by prefix collects it) and deterministic content. The injected `llm` param is left untouched (no provider call). ("Mirror `returnExplanation/test-mode.ts`" = same early-return-on-`E2E_TEST_MODE` idea, applied to a library function — there is no API route to short-circuit here.)
- [ ] Add a hard production block at that boundary mirroring `returnExplanation/route.ts:17-19` (`if E2E_TEST_MODE && NODE_ENV==='production' && !CI → throw`) so the mock can NEVER activate in a real prod deployment.
- [ ] Activation in PR-CI is automatic: the e2e jobs run a **local build started with `E2E_TEST_MODE=true`** via the `playwright.config.ts:180-181` webServer command — no `ci.yml` env change needed. Verify by asserting the seed mock fires in the `e2e-evolution` job (which runs locally, not against a deployed URL).
- [ ] Result: `admin-evolution-run-pipeline.spec.ts` + `admin-evolution-iterative-editing.spec.ts` complete with no real OpenAI calls on PRs (both chromium + firefox).

### Phase 2: Deliberate cheap real-AI tier (`@prod-ai` + Gemini Flash 2.5) — runs on a LOCAL build
Model decision: **Gemini Flash 2.5** (`google/gemini-2.5-flash` via OpenRouter). Per user: it is cheaper than `gpt-4.1-mini` (trust live provider pricing over the research estimate). Cost is the goal, not prod-model fidelity.

**Topology:** this tier runs as a **new local-build job** (NOT against deployed prod), so `TEST_LLM_MODEL` and "real AI" (no `E2E_TEST_MODE`) are both controllable — exactly the port-3009 secondary-server pattern (`playwright.config.ts:141-146`).
- [ ] Add the `TEST_LLM_MODEL` override at the **single chokepoint `callLLM`** in `src/lib/services/llms.ts` (where `DEFAULT_MODEL`/`LIGHTER_MODEL` are otherwise selected). When `process.env.TEST_LLM_MODEL` is set, substitute it for the requested model, after: (a) a hard production block (mirror `route.ts:17-19` — never honor it when `NODE_ENV==='production' && !CI`), and (b) validation against `allowedLLMModelSchema` (reject unknown ids). This single point covers ALL search-pipeline call sites (title, content, tags, headings, links, summary). For the evolution seed real run, set the model via the run config (`ctx.config.generationModel` → `createEvolutionLLMClient`) in the test, since evolution doesn't route through `callLLM`.
- [ ] Author NET-NEW `@prod-ai` tests (the existing 2 `@prod-ai` tests are in `suggestions.spec.ts` and are unrelated): `src/__tests__/e2e/specs/02-search-generate/real-generation.prod-ai.spec.ts` (one real search→generate) and an evolution real-seed spec. Keep all mock-dependent specs `@skip-prod`.
- [ ] **The single real generation test must exercise the FULL pipeline** — title → content → tag eval → heading-standalone-title → link extraction → summary — and assert each stage produced non-empty, schema-valid output (title present, content present, ≥1 tag, headings/links resolved without error), so a prompt/contract regression in any ancillary call surfaces. (Run WITHOUT `E2E_TEST_MODE` so the real `returnExplanationLogic` executes.)
- [ ] **`@prod-ai` is a new Playwright PROJECT, not just a grep tag** (decided — resolves the project-vs-tag ambiguity). Add a `prod-ai` project to `playwright.config.ts` `projects[]` with `grep: /@prod-ai/`, `retries: 2` (explicit, so it does not depend on the global `isProduction?3:CI?2:0` evaluating to 2), `project: chromium` device. Its `dependencies` reuse the `setup` (auth) project.
- [ ] **Dedicated webServer on its own port (3010), gated by `RUN_PROD_AI=1`.** Add a third `webServer` array entry started with `npm run build && TEST_LLM_MODEL=google/gemini-2.5-flash npm start -- -p 3010` and **`E2E_TEST_MODE` unset** — do NOT reuse the port-3009 server (gated on `RUN_GUEST_AUTO_TESTS=1`, carries guest-autologin middleware). Gate the new entry on `RUN_PROD_AI=1` so normal PR-CI/local runs don't pay its build cost or bind 3010.
- [ ] **Use a dedicated sibling workflow `.github/workflows/e2e-real-ai-smoke.yml`** (clearer than overloading `e2e-nightly.yml`): scheduled nightly, `environment: staging`, sets `RUN_PROD_AI=1` + `TEST_LLM_MODEL=google/gemini-2.5-flash` + needs `OPENROUTER_API_KEY`, runs `playwright test --project=prod-ai`. The job is `continue-on-error: true` (job-level) so an OpenRouter outage does not red the pipeline (see Rollback).
- [ ] Assertions must be structural (non-empty / schema-valid), NOT exact-text, so the 2 retries absorb real-LLM non-determinism without masking a genuine pipeline break.
- [ ] **Reduce the existing deployed-prod nightly real-AI sweep** (`e2e-nightly.yml` `@critical` matrix): drop firefox and trim to a minimal real `@critical` set against prod (it tests the real prod model — un-overridable — so the lever here is scope only). Live-prod validation is already covered per-deploy by `post-deploy-smoke.yml`; this just stops the 2-browser full real sweep every night.
- [ ] Confirm `[TEST]`/`[TEST_EVO]` prefixes + teardown (`global-teardown.ts`, evolution cleanup) remove all real-AI-generated content.

> **Known accepted trade-off:** the cheap real-AI tier runs on Gemini Flash 2.5 against a local build, not the deployed prod model (`gpt-4.1-mini`). It verifies "the pipeline works end-to-end with a real LLM," NOT prod-provider/model fidelity. Prod fidelity is covered by `post-deploy-smoke.yml` (per-deploy, real prod) + the trimmed deployed-prod nightly. Detection latency for cheap-tier regressions is up to ~24h (next nightly), surfaced via the existing `[release-health]` auto-issue + Slack alert.

### Phase 3: Observability + spend guard
- [ ] Fix `src/lib/services/llms.ts` (the `modelUsed = lastChunk.model || ''` line, ~:529): when the stream/response omits `model`, fall back to the **model actually sent to the provider** — for OpenRouter that is `getOpenRouterApiModelId(requestOptions.model)`, for direct providers `requestOptions.model` — NOT the raw pre-mapped request id. This kills the `model=''` bucket without misattributing OpenRouter calls.
- [ ] Make mocked LLM calls record `estimated_cost_usd = 0` at the mock source: update BOTH `jest.integration-setup.js` `__mockChatCreate` AND `src/testing/utils/test-helpers.ts` `createMockOpenAIResponse` to return `usage: {prompt_tokens:0, completion_tokens:0, total_tokens:0}` and a `model` field set to the requested model (currently `createMockOpenAIResponse` returns non-zero usage and no `model`). With zero tokens, `calculateLLMCost` yields `$0` and the model is correct — no `callLLM` change needed.
- [ ] Add a **pre-flight step** at the start of the `e2e-real-ai-smoke.yml` job (BEFORE the playwright run) that reuses `LlmSpendingGate` / `daily_cost_rollups` to check the daily cap and writes a step output, e.g. `echo "skipped=true" >> "$GITHUB_OUTPUT"` when exhausted. Gate the playwright step on `if: steps.preflight.outputs.skipped != 'true'`, and add a follow-on `[release-health]` step gated on `if: steps.preflight.outputs.skipped == 'true'` (NOT `if: failure()` — a skipped step is not a failure, so `failure()` would never fire). This turns an exhausted account into an actionable note instead of an opaque mid-run 429.

### Phase 4 (optional): Reduce integration-test llmCallTracking pollution
- [ ] Run the audit FIRST and record the result here: grep integration tests for assertions on `llmCallTracking` rows (e.g. `from('llmCallTracking')`, `estimated_cost_usd`, `call_source` assertions). Note: `per-user-cost-rollups.integration.test.ts` inserts rows MANUALLY (not via mocked `callLLM`) and asserts on them — that test is NOT a Phase-4 target and must keep working.
- [ ] If no real-`callLLM`-path test asserts on tracking rows: with Phase 3's `$0`+correct-model mock already in place, the pollution is reduced to correct, $0, attributable rows. Only if rows must be eliminated entirely, add an opt-in `skipTracking` flag to `callLLM` options used by the integration mock setup. (Default: rely on Phase 3; this phase may close as "covered by Phase 3".)

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — `google/gemini-2.5-flash` resolves to OpenRouter, `getOpenRouterApiModelId` returns its API id, pricing is finite, and the `supportsReasoning`/`defaultReasoningEffort` invariant holds.
- [ ] `src/lib/services/llms.test.ts` — (a) model-fallback fix: when a (mock) response omits `model`, the tracking row records the provider-mapped model (`getOpenRouterApiModelId(requestOptions.model)` for OpenRouter), not `''`; (b) `TEST_LLM_MODEL` override substitutes the model when set, is IGNORED when `NODE_ENV==='production' && !CI`, and rejects an id not in `allowedLLMModelSchema`.
- [ ] `evolution/src/lib/pipeline/setup/generateSeedArticle.test.ts` — when `E2E_TEST_MODE=true`, `generateSeedArticle` returns the deterministic `[TEST_EVO]` article and makes zero `llm.complete()` calls; when `NODE_ENV==='production' && !CI` it THROWS (mock-in-prod guard).

### Integration Tests
- [ ] `src/__tests__/integration/explanation-generation.integration.test.ts` (or focused new test) — with the updated `__mockChatCreate` (zero usage + model set), the written `llmCallTracking` row has the correct `model` and `estimated_cost_usd = 0`.
- [ ] Evolution pipeline integration test — `E2E_TEST_MODE` seed mock produces a valid run with no external LLM spend.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` + `admin-evolution-iterative-editing.spec.ts` — pass under PR-CI (local build, `E2E_TEST_MODE=true` via webServer) with the seed mock, no real OpenAI, both chromium + firefox.
- [ ] NEW `src/__tests__/e2e/specs/02-search-generate/real-generation.prod-ai.spec.ts` (`@prod-ai`) — runs against a local build WITHOUT `E2E_TEST_MODE`, `TEST_LLM_MODEL=google/gemini-2.5-flash`, chromium-only; asserts FULL-pipeline output (non-empty title, non-empty content, ≥1 tag, headings/links resolved without error) and tracks/cleans up the `[TEST]` explanation.
- [ ] NEW evolution real-seed `@prod-ai` spec — one real seed run on Gemini, asserts a completed run + `[TEST_EVO]` cleanup.

### Manual Verification
- [ ] After a manual `workflow_dispatch` of the cheap real-AI job, query staging `llmCallTracking` (`npm run query:staging`) and confirm: `@prod-ai` rows carry real cost, all on `google/gemini-2.5-flash`; no new `model=''` rows.
- [ ] Trigger a PR-CI evolution run and confirm zero real OpenAI calls attributable to the run (seed mock active).

## Rollback Plan
- [ ] **Each phase is independently revertable** (separate commits). Phase 0 (registry add) is additive — reverting just removes the model. Phase 3 fixes are behaviorally narrow (tracking attribution + mock usage) and unit-gated.
- [ ] **Seed mock (Phase 1) safety:** the hard production block means a bad mock can never run in prod; if the mock breaks PR-CI evolution specs, revert the `generateSeedArticle` change and PR-CI returns to real seed gen (its prior, costlier-but-working state).
- [ ] **Cheap real-AI job (Phase 2) is fail-soft:** the new nightly job uses `continue-on-error: true` (or a non-required check) so an OpenRouter/Gemini outage does NOT block the pipeline; failures still alert via `[release-health]`. To disable entirely, remove the job or unset `TEST_LLM_MODEL` (the app then falls back to `DEFAULT_MODEL` — no breakage).
- [ ] **`TEST_LLM_MODEL` is inert in production** (hard-guarded), so even if accidentally set in a prod env it is ignored — no prod-behavior risk.
- [ ] **Deployed-prod nightly trim is reversible** by restoring the firefox row / full `@critical` grep in `e2e-nightly.yml`.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI changes expected. If the seed-mock alters any admin run-pipeline UI state, run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` on the local server via `ensure-server.sh`.

### B) Automated Tests
- [ ] `npm run test -- --runTestsByPath src/lib/services/llms.test.ts src/config/modelRegistry.test.ts evolution/src/lib/pipeline/setup/generateSeedArticle.test.ts`
- [ ] `npm run test:integration` (explanation-generation + evolution pipeline)
- [ ] PR-CI seed mock (local build, mocked): `npm run test:e2e:evolution` (webServer sets `E2E_TEST_MODE=true`; confirm no real OpenAI).
- [ ] Cheap real-AI tier (local build, real Gemini): `RUN_PROD_AI=1 TEST_LLM_MODEL=google/gemini-2.5-flash npx playwright test --project=prod-ai` (dedicated webServer on port 3010 started WITHOUT `E2E_TEST_MODE`; requires `OPENROUTER_API_KEY`).

## Documentation Updates
- [ ] `docs/docs_overall/environments.md` — **MUST fix in this PR** (factual error): line **276** under "Nightly Workflow" reads `- `E2E_TEST_MODE=true` for SSE streaming compatibility`, which is false — nightly runs real AI with NO `E2E_TEST_MODE` (`testing_overview.md:437` + `e2e-nightly.yml:59` confirm). Replace line 276 with `- **No** `E2E_TEST_MODE` — nightly uses real AI against the deployed prod app (hence the `[TEST]` prefix on generated content)`. Then document the new `e2e-real-ai-smoke.yml` local-build cheap-model `@prod-ai` tier + `TEST_LLM_MODEL` override + deployed-prod nightly trim.
- [ ] `docs/docs_overall/testing_overview.md` — document the evolution seed mock under `E2E_TEST_MODE`, the `@prod-ai` Gemini tier, and the mocked-call `$0` cost behavior.
- [ ] `docs/docs_overall/llm_provider_limits.md` — add Gemini Flash 2.5 (OpenRouter) to the providers/models table.
- [ ] `docs/feature_deep_dives/search_generation_pipeline.md` — note the ancillary call sites (title/tag/heading/link) and the test-tier model override.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` / `docs/feature_deep_dives/metrics_analytics.md` — note the empty-model tracking fix + `$0` mocked-cost convention if they reference cost attribution.
- [ ] `docs/feature_deep_dives/realtime_streaming.md` / `request_tracing_observability.md` — only if the model-fallback fix changes documented tracking fields.

## Review & Discussion

### Iteration 1 — Security 2/5, Architecture 2/5, Testing 2/5 (consensus NOT reached)
Critical gaps raised and how they were resolved:
1. **(Testing, blocker) Can't set `E2E_TEST_MODE`/`TEST_LLM_MODEL` on the deployed-prod nightly.** Nightly tests a live Vercel app (`BASE_URL` set → webServer disabled). → **Resolved:** added the "CRITICAL topology fact" callout; moved the cheap-Gemini real-AI smoke to a **local-build job** (port-3009 secondary-server pattern), and **trimmed** the deployed-prod nightly to a minimal real set (scope-only lever) leaning on `post-deploy-smoke.yml` for prod fidelity.
2. **(All) Model id `google/gemini-2.5-flash` not in registry — only `-lite`.** → **Resolved:** Phase 0 now explicitly ADDS the full entry mirroring `modelRegistry.ts:159-163`, notes `-lite` as fallback, and calls out the `supportsReasoning` invariant; pricing auto-derives from the registry (no `llmPricing.ts` edit).
3. **(Security+Arch, blocker) `TEST_LLM_MODEL` had no injection point for the hardcoded `DEFAULT_/LIGHTER_MODEL` search-pipeline call sites.** → **Resolved:** override is added at the single `callLLM` chokepoint with a prod guard + `allowedLLMModelSchema` validation; evolution seed uses run-config model (`ctx.config.generationModel`).
4. **(Arch, blocker) Seed-mock boundary wrong** — `arenaActions.ts:624-626` is the judge guard, not seed. → **Resolved:** mock now placed at `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` with its own hard prod block; "mirror test-mode.ts" clarified as a library early-return.
5. **(Security, blocker) Empty-model fix would misattribute OpenRouter calls** (raw vs mapped id). → **Resolved:** fall back to `getOpenRouterApiModelId(requestOptions.model)` (provider-mapped), not the raw request id.
6. **(All) Mocked `$0` cost mechanism unspecified.** → **Resolved:** fix at the mock source — `__mockChatCreate` returns zero usage + model, so `calculateLLMCost` yields `$0`; no `callLLM` change.
7. **(Security) Prod guard `CI=true` window.** → **Addressed:** seed mock + `TEST_LLM_MODEL` both carry the `&& !CI`-style hard prod block mirroring `route.ts:17-19`; documented.
8. **(Testing) No rollback / spend-check wiring / soft-fail.** → **Resolved:** added a **Rollback Plan** section; spend pre-check is a GH Actions pre-flight step that skips (not reds) the job; cheap-AI job is `continue-on-error`.
9. **(Testing/Arch) `@prod-ai` tests are net-new, file names unspecified; `environments.md` fix was "may".** → **Resolved:** named the new spec files, marked `environments.md` a MUST-fix, tightened verification commands with the correct `E2E_TEST_MODE` context.

### Iteration 4 — Security 5/5, Architecture 5/5, Testing 5/5 ✅ CONSENSUS REACHED
All three reviewers verified the iteration-3 clarity fixes against the real code and found **no critical gaps**. Confirmed sound: the port-3010 `prod-ai` webServer/project (precedented by the port-3009 pattern), the `generateSeedArticle` early-return matching the `SeedResult` shape, the `callLLM` + `ctx.config.generationModel` injection seams, the `getOpenRouterApiModelId` empty-model fix (no blast radius), zero-usage mock → `$0`, and the step-output spend-skip wiring (correctly avoiding the `if: failure()`-on-skip trap). The prod guards (`NODE_ENV==='production' && !CI`) and `[TEST]`/`[TEST_EVO]` cleanup keep it prod-safe and data-safe. Plan is execution-ready.
One non-blocking note (Testing): land the `environments.md:276` factual fix early (Phase 0) so the doc is correct before the behavioral changes merge.

### Iteration 3 — Security 5/5, Architecture 4/5, Testing 4/5 (re-scoped to plan-quality only)
Reviewers re-instructed to grade DESIGN soundness, not implementation completeness. Design validated; remaining items were plan-clarity, now resolved:
1. **`@prod-ai` project-vs-tag ambiguity** → decided: a new Playwright **project** `prod-ai` (`grep:/@prod-ai/`, explicit `retries:2`, chromium device). (Phase 2)
2. **Dedicated webServer** → port 3010, gated `RUN_PROD_AI=1`, `TEST_LLM_MODEL` set + `E2E_TEST_MODE` unset; not the 3009 guest server. (Phase 2)
3. **Workflow file** → dedicated `e2e-real-ai-smoke.yml`, `continue-on-error` job. (Phase 2)
4. **Spend pre-check skip wiring** → `if: failure()` doesn't fire on skips; use a step-output (`steps.preflight.outputs.skipped`) to gate both the playwright run and the `[release-health]` follow-on. (Phase 3)
5. **Seed-mock shape** → early-return matching `generateSeedArticle`'s return shape, `[TEST_EVO]`-prefixed, before `llm.complete()` and the timeout guard. (Phase 1)
6. **`environments.md` fix** → exact line 276 + corrected text cited. (Docs)

### Iteration 2 — Security 1/5, Architecture 2/5, Testing 2/5 (consensus NOT reached)
**Key observation:** all three reviewers shifted from design objections to *implementation-completeness* objections — every "critical gap" is "X not yet coded" (model not added to registry, `TEST_LLM_MODEL` override not written, seed mock not placed, mock usage not zeroed, firefox not yet dropped). The Architecture reviewer explicitly stated the iteration-1 blockers were *"genuinely RESOLVED conceptually"* and the doc *"reads as a mature design document that correctly delegates execution risk to the implementation phase."* That is a category error for **plan** review: a planning doc is reviewed before the Execute phase, so "the code isn't written yet" is expected, not a plan defect. The design is now validated.

Genuine **plan-level** refinements from iteration 2 (folded in, not implementation tasks):
1. The port-3009 secondary server is gated on `RUN_GUEST_AUTO_TESTS=1` and is for guest-autologin — the cheap-AI tier needs its OWN webServer/job, not a reuse. (Phase 2)
2. The local cheap-AI tier would get 0 Playwright retries by default (`playwright.config.ts:98` `isProduction?3:CI?2:0`) — set `retries: 2` for the `@prod-ai` project so real-LLM non-determinism doesn't false-red; assert on structure, not exact text. (Phase 2)
3. `createMockOpenAIResponse` (`test-helpers.ts`) also needs the zero-usage + `model` field, not just `jest.integration-setup.js`. (Phase 3)
4. A skipped spend-pre-check job emits no `[release-health]` note by itself — wire it as an explicit follow-on step. (Phase 3)

**Disposition:** the plan is design-complete; residual reviewer objections are the implementation work itself (Phases 0–4). Recommendation: proceed to `/research` validation of the two open code-facts (exact `getOpenRouterApiModelId` mapping shape; whether any real-`callLLM`-path integration test asserts on `llmCallTracking`) and then Execute, rather than looping the automated review (which will keep grading implementation completeness).
