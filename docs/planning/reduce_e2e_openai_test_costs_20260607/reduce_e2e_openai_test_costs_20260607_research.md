# Reduce E2E OpenAI Test Costs Research

## Problem Statement
Cut real OpenAI spend from automated tests while keeping a deliberate minimal real-LLM smoke. An investigation found that the `model=''` cost bucket on the staging/dev DB is integration-test **mock pollution** (2,102 ephemeral userids, fixtures echoed verbatim, `model=''` from `llms.ts` empty-model fallback, estimated cost only), while the **actual quota burn** (source of the `429 insufficient_quota` CI failures) comes from two real-AI paths: the nightly E2E workflow (`e2e-nightly.yml` — no `E2E_TEST_MODE`, full `@critical` pipeline × 2 browsers against prod) and PR-CI evolution seed generation (`CreateSeedArticleAgent`, not mocked outside prod). Goal: mock the wasteful paths, keep a tiny nightly real-AI smoke on a cheap model, and fix cost observability.

## Requirements (from GH Issue #1173)
Decision: keep MINIMAL nightly real-AI smoke (1–3 tests, single browser); cheap model = **Gemini Flash 2.5**; everything else mocked.

- **Phase 1 — Stop PR-CI 429s:** add an `E2E_TEST_MODE` seed-mock branch to the evolution seed path (deterministic seed article, mirroring `src/app/api/returnExplanation/test-mode.ts`). Gate so PR-CI evolution specs (`admin-evolution-run-pipeline` / `iterative-editing`) use the mock; real seed-gen stays only in nightly/explicit runs. Removes per-PR real OpenAI spend and the quota-driven firefox flakiness.
- **Phase 2 — Deliberate cheap real-AI tier:** tag a tiny set (~1–3 tests: one real generation, one real evolution seed) for nightly real-AI. Run once nightly, single browser (chromium), with Gemini Flash 2.5 via env-driven model override in the test path, instead of full `@critical` × 2-browser sweep. Keep the rest of nightly on the mocked (`E2E_TEST_MODE`) path.
- **Phase 3 — Observability + spend guard:** fix `llms.ts` empty-model fallback (`modelUsed = lastChunk.model || ''`) to fall back to `requestOptions.model` so the `model=''` bucket disappears and cost attribution is correct; ensure mocked test calls record `estimated_cost_usd = 0`; add a CI/nightly spend pre-check (reuse `LlmSpendingGate` / `daily_cost_rollups`) that fails fast with a clear message instead of an opaque 429.
- **Phase 4 (optional) — Reduce integration-test `llmCallTracking` pollution** in the shared dev DB: skip the insert under the integration mock, or keep with correct model + $0 (verify no integration test asserts on these rows first).

## High Level Summary

The investigation (run against the dev/staging Supabase via `npm run query:staging`) established **two distinct phenomena** that had been conflated:

### A) The `model=''` "$13.69" staging bucket is integration-test mock pollution — NOT real spend
- Integration tests (`*.integration.test.ts`) connect to the **dev/staging Supabase** (`src/testing/utils/integration-helpers.ts:33` → `NEXT_PUBLIC_SUPABASE_URL` + service role) and mock the OpenAI SDK via `jest.integration-setup.js:95` (`__mockChatCreate`).
- Each test mints a fresh user (`createTestContext`) → the observed **2,102 distinct ephemeral userids, ~3 calls each** (none is the fixed `TEST_USER_ID` or `GUEST_USER_ID`).
- The `cost>0` rows return the **exact mock fixtures**: `{"title1":"[TEST] Understanding Quantum Entanglement",...}` is `titleGenerationResponse.title1` verbatim (`src/testing/fixtures/llm-responses.ts:16`); `{"difficultyLevel":2,...}` is `tagEvaluationResponse`. A real LLM would not echo a fixture byte-for-byte.
- `callLLM` (`src/lib/services/llms.ts`) still writes an `llmCallTracking` row for every mocked call. The mock stream chunk has no `model` field, so `modelUsed = lastChunk.model || ''` leaves `model=''`, and a small cost (~$0.007) is **estimated from token counts**. → No real OpenAI quota consumed; the bucket is a dashboard artifact.

### B) The real quota burn (429 source) is the real-AI paths
- **`e2e-nightly.yml`** explicitly runs with **no `E2E_TEST_MODE`** (`# NO E2E_TEST_MODE - uses real AI`), executing the full real `returnExplanationLogic` pipeline (title gen + content gen + `evaluateTags` + `generateHeadingStandaloneTitles`) for `@critical` **on both chromium AND firefox** against **production** (`environment: Production`, `ref: production`, prod Supabase secrets). This is the largest real-AI consumer and writes to the PROD DB.
- **PR-CI evolution specs** (`e2e-evolution` job → `admin-evolution-run-pipeline` / `iterative-editing`) call **real seed generation** (`CreateSeedArticleAgent`), which is not mocked: `evolution/src/services/arenaActions.ts:624-626` only forbids `E2E_TEST_MODE` in production; outside prod it runs real OpenAI. This tipped the account into `429 insufficient_quota` during the #1170/#1171 rollout (see [[project_evolution_e2e_openai_quota]]).

### Why the search-generate E2E specs are already safe
- `src/app/api/returnExplanation/route.ts:23-27` short-circuits to `./test-mode.ts` **before** `returnExplanationLogic` when `E2E_TEST_MODE === 'true'`, and the specs also install browser-level `page.route('**/api/returnExplanation')` mocks (`api-mocks.ts`). So in PR CI (`E2E_TEST_MODE` set on the staging deployment) these specs make zero real LLM calls. The leak is the evolution seed path + the nightly (no E2E_TEST_MODE).

### Key facts that shape the fix
- **Production models:** `DEFAULT_MODEL = 'gpt-4.1-mini'`, `LIGHTER_MODEL = 'gpt-4.1-nano'` (`src/lib/services/llms.ts`). These are the cost-bearing ancillary calls.
- **Gemini Flash 2.5 is NOT yet in the model registry** (`src/config/modelRegistry.ts` / `src/config/llmPricing.ts`). A prerequisite phase must add it. Cleanest path: route via the already-wired **OpenRouter** provider (`google/gemini-2.5-flash`) rather than adding a brand-new Google provider/SDK.
- **`@prod-ai` tag already exists** (`testing_overview.md:231`) for "tests requiring real AI (no E2E_TEST_MODE mock), nightly only", with a `@skip-prod` companion. Reuse `@prod-ai` rather than inventing a new tag.
- **`LlmSpendingGate`** (`src/lib/services/llmSpendingGate.ts`) already enforces `checkBudget()` / `reconcileAfterCall()` with a configurable daily cap (provider-limits doc: $50/day non-evolution, $25/day evolution) and raises `GlobalBudgetExceededError`. A fail-fast nightly/CI pre-check can reuse this instead of letting an opaque provider 429 surface.
- **No env-var model override currently exists** for tests — Phase 2 must add one (e.g. `TEST_LLM_MODEL` / `JUDGE_*`-style) that the relevant call sites honor only in the real-AI test tier.

### Doc inconsistency found (to correct in this PR)
`docs/docs_overall/environments.md:276` states the nightly sets `E2E_TEST_MODE=true`, contradicting the authoritative `e2e-nightly.yml` and `testing_overview.md:409,437` ("No E2E_TEST_MODE — uses real AI"). Fix `environments.md` as part of the documentation updates.

### Open questions for /research + /plan
1. Exact provider routing for Gemini Flash 2.5 — OpenRouter `google/gemini-2.5-flash` (preferred, already wired) vs a direct Google provider. Confirm pricing entry + `allowedLLMModelSchema` membership.
2. Whether any integration test **asserts on** the `llmCallTracking` rows it writes (gates Phase 4's "skip insert in test mode" approach).
3. Whether the evolution seed mock should live in the seed agent itself or at the `arenaActions` boundary (mirror of `returnExplanation/test-mode.ts`).
4. Whether nightly should keep firefox at all for the mocked tier (cost is ~0 once mocked, so firefox coverage can stay) vs only chromium for the `@prod-ai` real tier.

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

### Relevant Docs (read directly)
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/feature_deep_dives/realtime_streaming.md
- docs/feature_deep_dives/pr_verification_gate.md

### Relevant Docs (skimmed via Explore agent)
- docs/feature_deep_dives/search_generation_pipeline.md, writing_pipeline.md, judge_evaluation.md, request_tracing_observability.md, metrics_analytics.md, server_action_patterns.md, error_handling.md, tag_system.md, explanation_summaries.md, vector_search_embedding.md, ai_suggestions_overview.md, admin_panel.md, user_testing.md, maintenance_skills.md
- docs/docs_overall/cloud_env.md, managing_claude_settings.md, instructions_for_updating.md

## Code Files Read
- src/app/api/returnExplanation/route.ts (E2E_TEST_MODE short-circuit at :23-27)
- src/app/api/returnExplanation/test-mode.ts (deterministic SSE mock — pattern to mirror for seed mock)
- src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts
- src/__tests__/e2e/helpers/api-mocks.ts
- src/__tests__/e2e/setup/global-setup.ts
- src/__tests__/integration/explanation-generation.integration.test.ts (OpenAI SDK mock via __mockChatCreate)
- src/testing/utils/integration-helpers.ts (targets dev Supabase via service role)
- src/testing/fixtures/llm-responses.ts (titleGenerationResponse, tagEvaluationResponse fixtures)
- src/lib/services/llms.ts (modelUsed empty-string fallback; estimatedCostUsd; tracking insert)
- jest.integration-setup.js (__mockChatCreate global mock)
- evolution/src/services/arenaActions.ts (E2E_TEST_MODE production guard at :624-626)
- .github/workflows/e2e-nightly.yml (no E2E_TEST_MODE, prod env, chromium+firefox matrix)
- .github/workflows/ci.yml (no E2E_TEST_MODE; e2e-critical + e2e-evolution jobs, staging env)
