# debug_evolution_run_cost_20260426 Plan

## Background
This started as a debug investigation: explain the cost split for invocation `a824f9e0-0f23-47ef-93cb-8fb24ed50a83` on staging. The investigation identified the cost drivers (ranking dominates because it processes both texts × 2 bias-mitigation calls × N comparisons per variant) and surfaced a separate bug: `llmCallTracking` rows have not been written for any evolution run since 2026-02-22. The project pivoted into fixing that audit gap.

## Requirements (from GH Issue #NNN)
For invocation a824f9e0-0f23-47ef-93cb-8fb24ed50a83 on stage, help me understand the generation and ranking cost, and what is driving those.

Expanded scope (during investigation):
- Compare costs across runs and identify per-model cost effectiveness
- Investigate why some models appear thinking vs non-thinking
- Investigate the `llmCallTracking` audit gap and check if RLS is the cause
- Fix the audit gap with noisy-failure mode and a verification test

## Problem
The `llmCallTracking` table is empty for all evolution runs since 2026-02-22 — 387 completed runs across 5 weeks with zero tracking rows. Root cause: `saveLlmCallTracking` calls `createSupabaseServiceClient` from a `'use server'`-decorated file (Next.js-coupled), which misbehaves when invoked from the CLI batch runner (`processRunQueue.ts`). The failure is silent because the original code was fire-and-forget with `logger.warn`. Additionally, even when historic rows exist (pre-Feb-22), the `evolution_invocation_id` column is 100% NULL because the bridge never threaded it through.

## Options Considered
- [x] **Option A: Inject pre-built Supabase client into `saveLlmCallTracking` via `CallLLMOptions.trackingDb`**: backward-compatible (falls back to existing helper), small surface area, addresses the root cause directly. **Selected.**
- [x] **Option B: Move `createSupabaseServiceClient` to a Next.js-free file**: cleaner separation, but a bigger refactor with risk of breaking Next.js callers. Deferred as a follow-up.

## Phased Execution Plan

### Phase 1: Investigate — confirm root cause, rule out RLS
- [x] Query staging for invocation `a824f9e0` cost breakdown (44% gen / 56% rank)
- [x] Compute aggregate run-level metrics across latest 20 runs
- [x] Run cross-model quality comparison on the most-tested prompt
- [x] Verify thinking-vs-non-thinking via `llmCallTracking.reasoning_tokens` where available
- [x] Investigate audit gap; rule out RLS (service_role has bypassrls + INSERT privilege)
- [x] Identify root cause: Next.js-coupled `createSupabaseServiceClient` in CLI context

### Phase 2: Fix — inject db + noisy failure
- [x] Add `trackingDb?: SupabaseClient<Database>` to `CallLLMOptions` in `src/lib/services/llms.ts`
- [x] Thread `trackingDb` through `saveTrackingAndNotify` to `saveLlmCallTracking`
- [x] Use injected client when provided; fall back to `createSupabaseServiceClient` otherwise
- [x] Make first-failure log at `error` level (not warn) with structured fields
- [x] Add `EVOLUTION_TRACKING_STRICT=true` env var that throws on tracking failures
- [x] Reset `trackingFailureCount` to 0 on successful write + emit recovery log
- [x] Export `saveLlmCallTracking` and test helpers (`__resetTrackingFailureCount`, `__getTrackingFailureCount`)

### Phase 3: Wire through evolution bridge
- [x] In `claimAndExecuteRun.ts`, pass `trackingDb: supabase` and `evolutionInvocationId: opts?.invocationId` to `callLLM`
- [x] Update `LLMProvider` and `RawLLMProvider` interfaces to include `invocationId?: string` in opts
- [x] In `createEvolutionLLMClient.ts`, propagate `invocationId: options?.invocationId` to `rawProvider.complete`

## Testing

### Unit Tests
- [x] `src/lib/services/llms.test.ts` — 8 new tests in `saveLlmCallTracking` describe block:
  - injected `trackingDb` is used when provided
  - falls back to `createSupabaseServiceClient` when not provided
  - first failure logs at `error` level (not warn)
  - `EVOLUTION_TRACKING_STRICT=true` throws
  - default mode does NOT throw
  - failure counter resets on success
  - `evolution_invocation_id` is persisted on the row
  - DB error from insert throws

### Integration Tests
- [x] `evolution/scripts/verifyLlmCallTrackingFix.ts` — end-to-end live verification against staging (gated by `--apply` flag). Reproduces the CLI code path, exercises the strict-mode pre-fix failure, exercises the post-fix path with injected client, queries staging to confirm the row landed, asserts on field values (incl. `evolution_invocation_id`), then deletes the test row.

### E2E Tests
- [x] No new E2E tests required — this fix is at the LLM-client/bridge layer with no UI changes.

### Manual Verification
- [x] Ran `npx tsx evolution/scripts/verifyLlmCallTrackingFix.ts --apply` against staging — all 4 steps passed (pre-fix throws → post-fix succeeds → row landed → cleanup OK). Zero residual test rows confirmed via follow-up query.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes in this fix.

### B) Automated Tests
- [x] `npx jest src/lib/services/llms.test.ts` — 62/62 pass (8 new + 54 existing)
- [x] `npx jest evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — 20/20 pass
- [x] `npx tsc --noEmit` — clean
- [x] Live staging verification script — all 4 checks passed end-to-end

## Documentation Updates
- [x] `docs/planning/debug_evolution_run_cost_20260426/debug_evolution_run_cost_20260426_research.md` — populated with full investigation findings, cost breakdown analysis, thinking-vs-non-thinking evidence, cost-effectiveness ranking, and root-cause analysis of the audit gap.

## Follow-up plan (post-deploy verification revealed partial fix)

Post-deploy verification (`evolution/scripts/verifyAuditGapClosed.ts`, 2026-04-30) showed that the **trackingDb injection works** (196 new `llmCallTracking` rows landed for OpenRouter-routed models that previously had zero rows ever) but the **FK linkage to `evolution_agent_invocations` is 100% NULL** because agent code doesn't pass `invocationId` in `LLMCompletionOptions`. The chain breaks at the source. See research doc § 9 for full diagnosis.

### Phase 4: FK linkage fix (follow-up PR)

**4a. Bind invocationId in `createEvolutionLLMClient`**
- [ ] Add `invocationId?: string` parameter to `createEvolutionLLMClient` (`evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:65-74`). Add JSDoc: `// LAST positional param — any future optional params must use an options object to avoid silent argument-position drift. See plan-review note in debug_evolution_run_cost_20260426_planning.md § Phase 4a.`
- [ ] In `complete()`, fall back to the bound `invocationId` when `options?.invocationId` is not provided: `invocationId: options?.invocationId ?? invocationId`. Note: this treats `options.invocationId === undefined` identically to omitted, which is the desired behavior (callers that want NULL FK pass nothing or `null`-equivalent semantically — there's no use case for explicit `undefined` override).
- [ ] In `Agent.run()` (`evolution/src/lib/core/Agent.ts:69-77`), pass `invocationId` (the freshly-created UUID at line 52) as the 8th arg when constructing the scoped client. **Important**: must come AFTER the `await createInvocation(...)` so the value is real, not the empty-string sentinel.
- [ ] No-op for existing callers — the 9 test call sites in `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts` and the 1 in `evolution/src/lib/pipeline/claimAndExecuteRun.ts:290` all pass 3-7 args today and will continue to work; the new param defaults to `undefined` → row gets NULL FK, identical to today's behavior.

**4b. Seed-generation path — verified to already work, no migration needed** ✓ CLOSED (post-Round-2 verification)

Round 2 review surfaced a concern that the seed path (`claimAndExecuteRun.ts:286-313`) bypasses `Agent.run()`'s scoped-client substitution. Verified in source: `CreateSeedArticleAgent.execute()` (`evolution/src/lib/core/agents/createSeedArticle.ts:116, 132, 173`) already passes `{ model, invocationId: ctx.invocationId }` as the third arg to `llm.complete()`. Combined with the Phase 1-3 bridge fix that forwards `evolutionInvocationId: opts?.invocationId`, the seed path's FK linkage works via the per-call-options path **even without 4a's binding**.

- [x] Verified: pre-Phase-4a, the seed agent's 2 LLM calls per run already produce non-NULL FK rows (provided ctx.invocationId is the freshly-created seed invocation UUID, which it is — Agent.run line 61 sets `extendedCtx.invocationId = invocationId` after createInvocation succeeds).
- [x] No code change required for the seed path. The ~196 NULL-FK rows observed in staging post-deploy are from `evolution_generation` and `evolution_ranking` call_sources, NOT `evolution_seed_*` — the seed path was never the problem. (Optional architectural cleanup: migrate `seedCtx` to carry `rawProvider`+`defaultModel` so the seed agent uses the same scoped-client mechanism as iteration agents — purely a consistency win, not a correctness fix. Defer.)

**4c. Kill switch for ops rollback** (revised post-review with explicit placement)

- [ ] Add env var `EVOLUTION_FK_THREADING_ENABLED` (default `'true'`). String-match check: `process.env.EVOLUTION_FK_THREADING_ENABLED !== 'false'` (consistent with existing kill switches per `evolution/docs/reference.md` § "Kill Switches / Feature Flags" — see `EVOLUTION_TOPUP_ENABLED` etc).
- [ ] **Placement**: gate in `Agent.ts:69` — wrap the `ctx.invocationId` argument so when disabled, the binding arg is `undefined`:
  ```typescript
  const fkThreadingEnabled = process.env.EVOLUTION_FK_THREADING_ENABLED !== 'false';
  const scopedLlm = createEvolutionLLMClient(
    ctx.rawProvider, costScope, ctx.defaultModel,
    ctx.logger, ctx.db, ctx.runId, ctx.generationTemperature,
    fkThreadingEnabled ? ctx.invocationId : undefined,
  );
  ```
  This is cleaner than gating inside `createEvolutionLLMClient` because (a) the env-var check is colocated with the scoped-client construction it gates, (b) it doesn't pollute the public function signature with kill-switch awareness.
- [ ] Document in `evolution/docs/reference.md` § "Kill Switches / Feature Flags" with the same row format as existing flags. Note: when disabled, returns to pre-Phase-4 behavior — agents that pass `options.invocationId` per-call (e.g., CreateSeedArticleAgent) will still get FK rows; agents that don't will write NULL FK again.
- [ ] **Note on coverage**: this kill switch ONLY gates the iteration-loop scoped-client construction in `Agent.ts:69`. The seed path's top-level `llm` (created at `claimAndExecuteRun.ts:290`) is NOT gated — but seed FK works via per-call `options.invocationId` from CreateSeedArticleAgent, which the kill switch doesn't affect. Net effect when kill switch is `'false'`: iteration agents return to NULL FK (the original buggy behavior), seed agents continue to write valid FK. This is the desired rollback semantics.

### Phase 5: Chain-level integration test

**5a. Extend the existing Agent.test.ts FK chain test** (NOT a new test file)

**MUST run AFTER 5c — Phase 5c updates the v2MockLlm signature; if 5a runs first, the captured `mock.calls[i][2]` will be undefined because the existing mock signature drops the 3rd arg.**

- [ ] At `evolution/src/lib/core/Agent.test.ts:407`, the `describe('run() - threads invocationId into ctx (Critical Fix H)')` block already covers `ctx.invocationId` propagation to `execute()`. Add a NEW `it()` inside this block: `'binds invocationId on the scoped EvolutionLLMClient — rawProvider receives it as options.invocationId on every complete() call'`. The test must:

  1. Use the existing `TestAgent` (line 29) — `usesLLM` already defaults to `true` via Agent base class (line 22), no override needed.
  2. Provide an `executeFn` that calls `input.llm.complete('test prompt', 'generation')` with NO options arg (this simulates how iteration-loop agents actually call complete).
  3. Mock `rawProvider.complete` as `jest.fn(async () => ({ text: 'response', usage: { promptTokens: 10, completionTokens: 5 } }))`.
  4. Extend `createMockContext({ rawProvider, defaultModel: 'gpt-4o' })` — these two fields are missing from the existing helper at `Agent.test.ts:50-80` AND likely missing from the `AgentContext` type (`evolution/src/lib/core/types.ts`). Verify the type includes `rawProvider?: RawLLMProvider` and `defaultModel?: string` as optional; if not, add them as part of Phase 4a (they're already used by `Agent.run()` line 68 — just need to be on the type). Then pass them through the overrides arg of `createMockContext`. (`createInvocation` is already mocked at file top to return `'inv-123'`.)
  5. Call `await agent.run('input', ctx)`.
  6. Assert: `expect(rawProvider.complete).toHaveBeenCalledWith('test prompt', 'generation', expect.objectContaining({ invocationId: 'inv-123' }))`. **This is the test that would have caught the FK bug before deploy.**

**5a-bis. Kill-switch coverage**
- [ ] In the same describe block, add an `it('omits invocationId binding when EVOLUTION_FK_THREADING_ENABLED=false')` test. Save/restore `process.env.EVOLUTION_FK_THREADING_ENABLED`. Set to `'false'`, run agent, assert `rawProvider.complete` was called with options where `invocationId === undefined` (or omitted). Restore env in `afterEach` to avoid leaking.

**5b. Strengthen `claimAndExecuteRun.test.ts:177-197`**
- [ ] Modify the existing test "creates provider that delegates to callLLM with evolution_ prefix" so the assertion is `expect(callLLM).toHaveBeenCalledWith(..., expect.objectContaining({ onUsage: expect.any(Function), trackingDb: expect.anything() }))`. Two new fields to assert: `trackingDb` (Phase 1-3 forward), `evolutionInvocationId` only when the test passes `opts.invocationId`.
- [ ] Add a new `it()` in the same describe block: `'forwards opts.invocationId as evolutionInvocationId to callLLM'`. Construct a provider, call `provider.complete('p', 'generation', { invocationId: 'test-inv-uuid' })`, assert callLLM was called with `expect.objectContaining({ evolutionInvocationId: 'test-inv-uuid' })`.

**5c. Patch v2MockLlm to capture options arg** ⚠ NEW (post-review)
- [ ] `evolution/src/testing/v2MockLlm.ts:37` declares `complete: jest.fn(async (prompt: string, label: string): Promise<string> => ...)`. The signature drops the 3rd `options` arg. Update to `complete: jest.fn(async (prompt: string, label: string, _options?: LLMCompletionOptions): Promise<string> => ...)`. Body doesn't need to use `_options`, but the signature must accept it so tests reading `mock.complete.mock.calls[i][2]` typecheck cleanly.
- [ ] Tests that need to assert on options can do so via `mock.complete.mock.calls[i][2]?.invocationId`.

**5d. Verify chain coverage exists somewhere** (revised post-review — scope clarified)

The original framing — adding a TestAgent run to `verifyAuditGapClosed.ts` — conflated unit-test infrastructure with a live verification script. After Phase 5a's chain test exists in `Agent.test.ts`, that's already CI-enforced and covers the full chain on every PR. The verification script's job is to confirm production data shape, not to re-test the chain.

- [ ] **Decision: do NOT add Check D as a chain-integration test in the script.** Phase 5a (CI unit test) covers chain integrity; the script focuses on production data shape (Checks A, B, C are the right scope).
- [ ] Add a comment block at the top of `evolution/scripts/verifyAuditGapClosed.ts` explaining: "Checks A/B/C verify the production data shape (rows exist, FK populated, per-run linkage). Chain integrity (rawProvider receives invocationId) is verified by `evolution/src/lib/core/Agent.test.ts:407` 'binds invocationId on the scoped EvolutionLLMClient'. If THAT test is missing or skipped, the verification script's PASS verdict could be falsely-green."
- [ ] **Phase 6 verification gate is therefore Checks A + B + C all PASS** (no Check D dependency). This is documented in Phase 6 below.

### Phase 6: Re-verify in staging after redeploy
- [ ] After Phase 4 lands and is deployed, **record the exact deploy timestamp** (e.g., from `git log` of the merge commit on main, or from the runner's startup log). All subsequent `--since` flags use this timestamp.
- [ ] Trigger a small evolution run on staging via `/admin/evolution/start-experiment` ($0.05 budget is enough). Wait for completion.
- [ ] Run `npx tsx evolution/scripts/verifyAuditGapClosed.ts --since=<deploy-ts>` — Checks A, B, C all PASS. (Chain integrity is verified by Phase 5a's unit test in CI; no Check D.)
- [ ] If Check B still shows NULLs, check if `EVOLUTION_FK_THREADING_ENABLED=false` is set anywhere on the runner — that env var (Phase 4c) would explain a NULL-FK regression even with code deployed.
- [ ] Confirm one specific run end-to-end: pick its run_id, query `llmCallTracking WHERE evolution_invocation_id IN (SELECT id FROM evolution_agent_invocations WHERE run_id = <run_id>)` — every successful invocation should have ≥1 linked tracking row.

### Phase 7: Backfill for the post-fix window

**7-prereq. Add CLI flags to the backfill script (precondition)** ⚠ NEW (post-Round-3)

`evolution/scripts/backfillInvocationCostFromTokens.ts` currently parses only `--apply`, `--run-id`, `--since` (lines 37-43). Phase 7 references two flags that DO NOT YET EXIST:

- [ ] Add `--allow-large-deltas` flag: when present, the script does NOT abort on >5× cost deltas, only logs them. Default behavior (without flag) aborts on the first >5× delta encountered.
- [ ] Add `--exclude-run-ids=<csv>` flag: comma-separated list of run UUIDs to skip during backfill. Useful for excluding specific anomalous runs after dry-run review.
- [ ] Add corresponding tests to whatever test file accompanies the script (or add `evolution/scripts/backfillInvocationCostFromTokens.test.ts` if none exists).

**Without these flags landed first, Phase 7's >5× hard gate has no escape hatch other than "abort entirely."** Add these as part of the same PR that does Phase 4-5 (or a precursor PR).

**7. Run the backfill (after 7-prereq)**

- [ ] **Only run after Phase 6 confirms Phases 4+5 work end-to-end.** Pre-Phase-4 data is permanently lost; this phase only repairs post-fix rows that hit Bug A inflation in the brief window when Phase 1-3 was deployed but Phase 4 wasn't.
- [ ] Run `evolution/scripts/backfillInvocationCostFromTokens.ts --since=<phase-4-deploy-ts> --dry-run`. Verify the preflight passes (NULL-FK rate <10% in the window).
- [ ] Inspect the dry-run output: review reported `cost / generation_cost / ranking_cost` deltas per run. **Hard gate**: if any run shows >5× cost change, do NOT apply. Investigate — that magnitude indicates something other than Bug A (e.g., a token-count anomaly, model-pricing-table mismatch, or duplicate `llmCallTracking` rows). Acceptable resolutions: (a) confirm via spot-check that the new value is correct and re-run with `--allow-large-deltas` flag (TBD if not yet supported — add to script if needed), (b) exclude the specific run via `--exclude-run-ids`, (c) abort backfill entirely.
- [ ] Run with `--apply` once the dry-run is clean (no >5× deltas, or all anomalies investigated and excluded). The script writes via `writeMetricReplace` (plain upsert, not GREATEST), so corrections that are LOWER than current values do land — this is the intended repair direction.
- [ ] **Backfill rollback note:** the script has no built-in revert. Backfill writes only to `cost_usd` on `evolution_agent_invocations` and run-level `cost`/`generation_cost`/`ranking_cost`/`seed_cost` in `evolution_metrics`. If a wrong value is written, re-running the script with corrected logic will overwrite again (idempotent on the same `--since` window). Worst-case is wrong cost numbers, not data loss; not a true rollback hazard.

### Phase 8: Document the historical caveat
- [ ] Add a 2-3 sentence note to `evolution/docs/cost_optimization.md` (top of the file, right after the intro paragraph) explaining: (a) pre-2026-02-22 cost numbers are reliable, (b) 2026-02-22 → 2026-04-30 was the audit-gap window where `llmCallTracking` was empty for evolution runs and per-call audit isn't possible, (c) pre-2026-04-20 rows for OpenRouter-routed models (gemini-flash-lite, qwen, gpt-oss-20b) may show ~3× inflated costs due to Bug A and these are not retroactively repairable.
- [ ] Surface the caveat in the admin UI. **Placement decision (post-Round-2 verification)**: `CostEstimatesTab.tsx` receives only `{ entityType, entityId }` props (verified at line 19-22) — it does not have `run.created_at`. The caveat banner must therefore live in the parent page `src/app/admin/evolution/runs/[runId]/page.tsx`, which fetches the full run row and CAN read `created_at`. Render a `<CostCaveatBanner>` component above `<CostEstimatesTab>` when `run.created_at < '2026-04-30T00:00:00Z'`. Component text: "Cost numbers for this run may be inflated up to 3× for OpenRouter-routed models due to a since-fixed token-count bug (Bug A). See evolution/docs/cost_optimization.md."
- [ ] Add the same banner to the strategy detail page's Cost Estimates tab IF the strategy includes any pre-2026-04-30 run. This requires the parent page to look at the strategy's run list. Defer if too invasive — the per-run banner is the highest-value surface.
- [ ] Defer entire Phase 8 if no current consumer relies on those numbers being accurate. Do not block Phase 4 on this. Phase 8 is documentation + UI polish, not a correctness fix.

## Review & Discussion
This was a debug-investigation project that pivoted into a code fix during execution. The PR (#1015) lands the primary fix (closes write-side audit gap) and CI passed on first attempt. The follow-up plan above (Phases 4-8) addresses the FK linkage gap that post-deploy verification surfaced. The fix follows the existing project patterns:
- Uses Zod schemas for validation (`llmCallTrackingSchema`)
- Uses `logger` from `server_utilities` (not `console.log`)
- Preserves the fire-and-forget guarantee in production (LLM calls don't fail on tracking failures)
- Adds a strict-mode env var for CI/dev catching of regressions
- All new behavior is unit-tested and verified end-to-end against staging
- Honest accounting of the testing gap is captured in research doc § 9 ("Why testing missed it")
