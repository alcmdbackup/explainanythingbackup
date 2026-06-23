# Debug LLM Spending Data Issues (Stage) Plan

## Background
Evolution spend is under-counted. Per-call tracking (`llmCallTracking`) shows $0.0000 for a date range, but agent invocations (`evolution_agent_invocations.cost_usd`) record $2.68 for the same range — an audit gap active since 2026-02-23. The admin dashboard cost section also shows an error message, and the spend displayed doesn't reconcile with what's actually being paid to providers.

## Requirements (from GH Issue #1246)
- error message shows on cost section of admin dashboard.
- Spending that shows up doesn't remotely reconcile with what I've been paying.
- Also, I want to make sure we have infrastructure in place to capture spending from adhoc tests and various tools like judge lab.

## CORE DIRECTIVE
**Cost tracking must be 100% accurate and FAIL-CLOSED** — any cost-tracking error throws immediately and blocks progression; never logged-and-swallowed. (memory: `feedback_cost_tracking_fail_closed`.) This reverses the current explicit "prod does NOT throw" tradeoff and drives the whole design.

## Locked Decisions (2026-06-21, after detailed discussion)
1. **Scope: evolution-only — ALL evolution `callLLM` entry points (not just the pipeline).** Evolution `callLLM` becomes fail-closed; the **main-app path is unchanged**. "Evolution `callLLM`" = every call site that passes an `evolution_*` `call_source`: the pipeline `rawProvider` (`claimAndExecuteRun.ts:204`), offline judge eval (`runJudgeEval.ts:302`), prompt-editor config (`runPromptEditorConfig.ts:79`), and arena rejudge (`arenaActions.ts:750`). Each must set `requireTracking: true` AND pass a working `trackingDb`. Accepted residual risk: a future main-app tracking regression would still be silent (main app is healthy today — 52k rows/$98 — and we avoid user-facing failure risk on the public path).
2. **Mechanism: throw immediately** on any evolution tracking failure — no retry/outbox. Tracking-down = evolution-LLM-down, full stop.
3. **No escape hatch.** Do NOT add `ALLOW_UNTRACKED_LLM` or similar. Retire `EVOLUTION_TRACKING_STRICT` as an opt-in flag — the evolution path throws unconditionally. (Rollback if needed = git revert + redeploy; see "Rollback & Sequencing".)
4. **Startup/preflight self-check** so a process (esp. the minicomputer CLI runner) that cannot write tracking fails at boot, not after spending.
5. **Mechanism:** the swallow lives in the *shared* `saveTrackingAndNotify` (`llms.ts:256-289`, called by both paths at 763/890). Gate it on an explicit `requireTracking?: boolean` on `CallLLMOptions` set by each evolution call site — NOT by string-matching `call_source` on `evolution_`.

## Fail-Closed Semantics (consistency contract)
The tracking write happens AFTER the provider call returns (we need token usage), so by the time it can fail, **money is already spent**. Throwing therefore does NOT retroactively capture that one call's row — it converts a *silent* under-count into a *loud* failure. The contract we commit to:

- **No silent loss, ever.** On a tracking-write failure under `requireTracking`, before throwing we emit a single structured `error`-level log carrying the FULL would-be row payload (model, prompt/completion/reasoning tokens, `estimated_cost_usd`, `call_source`, `evolution_invocation_id`). This is the dead-letter of last resort — the spent dollars are always recoverable from logs even when the DB row is absent. (This is logging, not a retry/outbox — consistent with Decision 2.)
- **The run fails, not silently completes.** The throw propagates through the evolution pipeline; the run is finalized `failed` with a dedicated `error_code` (new taxonomy entry in `classifyError.ts`, e.g. `llm_tracking_write_failed`), never silently `completed`/`arena_only`. A failed run's spend is thus accounted as failed, not hidden as "successful but untracked".
- **`onUsage` fires BEFORE the re-throw.** `onUsage` currently runs after the tracking save (`llms.ts:279-288`). Reorder so callers' usage/cost accounting (`capturedUsage` in the rawProvider; cost accumulation in judge eval / prompt editor) is populated with the real spend *before* we throw — so the in-memory accounting reflects what was actually billed even on a failing call.
- **Why this still satisfies "100% accurate":** for the systematic failure mode (broken CLI client), every call fails immediately → operator fixes it on run #1 → all subsequent calls capture 100%. For a transient blip, the affected call is dead-lettered to logs + the run fails loudly. There is no path where spend is both incurred and invisible.

## Problem (verified via staging + code)
Two cost stores diverge: `llmCallTracking` (per-call, what `/admin/costs` reads) and `evolution_agent_invocations.cost_usd` (per-invocation). Evolution per-call tracking captures **~0.02% of real evolution spend** (42 rows / $0.015 in 120d vs ~$63 of invocation cost Mar–Jun). Root cause is two-fold and mutually reinforcing:
1. **Silent swallow:** `saveTrackingAndNotify` (`llms.ts:256-289`) catches `saveLlmCallTracking`'s throw and only re-raises under `EVOLUTION_TRACKING_STRICT`, which is test-only. Every real environment loses tracking failures silently. ← the directive's direct target.
2. **Ops/deploy gap:** HEAD wires `trackingDb` correctly (`claimAndExecuteRun.ts:220`), but the minicomputer (bulk of runs) doesn't git-pull (`project_minicomputer_no_auto_pull`), so it runs pre-fix code where the write falls back to the Next.js-coupled client, fails, and is swallowed.

Secondary: the `/admin/costs` cost section shows an error (top suspect: unwrapped `getSpendingSummaryAction`); historical rows have NULL `evolution_invocation_id` (un-auditable); some offline/CLI tool paths (offline judge eval, prompt-editor config, oneshot) bypass the attributed chokepoint.

## Options Considered
- [ ] **Option A: Reconcile-only (display fix)**: Dashboard trusts `evolution_agent_invocations.cost_usd` for evolution totals, treats per-call gap as a known caveat. Fast, but does NOT satisfy the fail-closed directive nor restore per-call audit. **Rejected** by directive.
- [ ] **Option B: Fail-closed write path**: Make tracking failures throw by default (drop the strict gate / invert it), so any LLM call whose spend can't be recorded fails loudly. Restores accuracy going forward and surfaces the minicomputer gap immediately. Pair with the ops fix (pull + restart) and a startup self-check.
- [ ] **Option C (recommended): Fail-closed write path + dashboard error fix + full attribution coverage**: Option B, plus fix the cost-section error, ensure the dashboard surfaces (not hides) partial failures/unattributed/uncaptured spend, inventory every LLM-call path and route bypass paths through the attributed chokepoint, and add a CI coverage guard so a new uncaptured path fails. Directly satisfies all three requirements + the directive.

## Phased Execution Plan

### Phase 1: Make evolution cost tracking fail-closed (the directive)
- [ ] Add `requireTracking?: boolean` to `CallLLMOptions` (`llms.ts`).
- [ ] **Redesign the two strict branches.** `isStrictMode()` currently gates a throw in BOTH `saveLlmCallTracking` (no-client branch, `llms.ts:179`) and `saveTrackingAndNotify` (`:274`). Replace: `saveLlmCallTracking` always throws on any failure (it already does for DB/Zod errors — make the no-client case throw too, unconditionally). `saveTrackingAndNotify` catches and RE-THROWS iff `options.requireTracking`; else keep main-app swallow-and-log. Delete `isStrictMode()` and the "prod does NOT throw" comment.
- [ ] **Dead-letter before throw:** in `saveTrackingAndNotify`, when `requireTracking` and the save fails, emit one structured `error` log with the full would-be-row payload, then re-throw (see Fail-Closed Semantics).
- [ ] **Reorder `onUsage` to fire before the re-throw** (`llms.ts:279-288`) so caller usage accounting reflects real spend even on a failing call.
- [ ] **Set `requireTracking: true` + a working `trackingDb` at ALL evolution call sites:** `claimAndExecuteRun.ts:204` (already has `trackingDb`), `runJudgeEval.ts:302` (pass `params.trackingDb` through — make it required for evolution), `runPromptEditorConfig.ts:79` (currently NO `trackingDb` — add one), `arenaActions.ts:750` (server-action context; add `requireTracking`).
- [ ] **Error taxonomy:** add `llm_tracking_write_failed` (or similar) to `evolution/src/lib/pipeline/classifyError.ts` so the run finalizes `failed` with a clear `error_code`, not `unhandled_error`/silent `completed`.
- [ ] Unit tests (`src/lib/services/llms.test.ts`): evolution (`requireTracking`) path throws on tracking failure AND emits the dead-letter log AND fires `onUsage` first; main-app path still swallows. Rewrite the existing strict-mode cases at `:1710-1721` (they assert the old `EVOLUTION_TRACKING_STRICT` line-179 behavior).

### Phase 2: Restore evolution per-call writes + close the ops gap
- [ ] Confirm HEAD pipeline writes linked rows (`claimAndExecuteRun.ts:220/226`).
- [ ] **Startup self-check — concrete location:** in `evolution/scripts/processRunQueue.ts` `main()` (after `buildDbTargets()`, ~line 156), run a per-target check using THAT target's injected `target.client` (the same client runtime uses — NOT a `SUPABASE_SERVICE_ROLE_KEY`-presence probe, which would pass while the Next.js-coupled fallback still fails). The check must NOT insert a stray `llmCallTracking` row (use a permission/`select … limit 0` probe or an insert wrapped in a rolled-back transaction). On failure, fail that target loudly and skip it. Mirror the existing `ensureStartupAssertions` pattern (`agentRegistry.ts`, called from `claimAndExecuteRun.ts:131`).
- [ ] Unit/integration test for the self-check (inject a broken client → boot check throws/skips target).
- [ ] **Ops:** pull + restart the minicomputer evolution runner (memory `project_minicomputer_no_auto_pull`); verify new runs land tracking rows reconciling with invocation cost. See "Rollback & Sequencing" for ordering.

### Phase 3: Fix the dashboard cost-section error
- [ ] Reproduce via admin/Playwright; capture exact error string + stack. **Note:** `getSpendingSummaryAction` IS wrapped by `withLogging`/`serverReadRequestId` returning an `ActionResult` — verify whether that wrapper converts a thrown `getSpendingGate().getSpendingSummary()` error into a `failure()` result or re-throws to the page's bare catch (`page.tsx:159`). Fix accordingly (wrap the action body so it returns `failure()`).
- [ ] Make `page.tsx` (`:156-157`) surface EVERY action's failure (not only `summaryRes.success`) so partial failures aren't hidden. Assert NO client downgrade — the dashboard keeps using the service-role client (the `get_llm_spend_buckets` service_role-only grant must not be hit from a user-context client).
- [ ] Action/unit test (the action returns `failure()` not throw) + E2E assertion the error banner (`page.tsx:314-317`) is NOT visible.

### Phase 4: Capture ad-hoc / tool spend + coverage guard
- [ ] Inventory every LLM-calling entry point (server actions + `scripts/` + `evolution/scripts/`). Known: `oneshotGenerator.ts:88` (LOCAL `callLLM` → direct SDK + `trackLLMCall` bare `catch{}`, `is_test:true`, model-suffixed `oneshot_${model}` source), `pilot-mode-b.ts:111` (LOCAL `callLLM`, raw OpenRouter `fetch`, NO tracking at all). These are invisible to the `require-llm-call-source` ESLint rule (it skips local same-named helpers).
- [ ] **Add bounded `CALL_SOURCES` + `ENTITY_BY_SOURCE` entries** for the tools so they're branded into the chokepoint AND filterable by entity. **Normalize the unbounded `oneshot_${model}` source to a bounded `oneshot` (and `oneshot_outline`) / `pilot`** — mirror how `importArticle` dropped its URL suffix (model-suffixed sources break the closed registry + blow up entity cardinality). Update the `ENTITY_BY_SOURCE` exhaustiveness unit test. (Judge lab already uses `CALL_SOURCES.evolutionJudgeEval` → mapped; only oneshot/pilot need new registry work.)
- [ ] Route bypass/CLI paths through the attributed chokepoint with an injected `trackingDb` (or document legitimate self-trackers and make their `catch{}` loud).
- [ ] **Coverage guard — pick a mechanism that catches direct-SDK paths (lint alone cannot):** an AST/grep CI check that flags `chat.completions.create` / `messages.create` / `.from('llmCallTracking').insert` occurring OUTSIDE the approved chokepoints, plus extend `require-llm-call-source` for imported `callLLM`. Wire into the existing `lint` job in `ci.yml`; add a unit test for the guard itself.

### Phase 5: Reconciliation correctness
**DECISION (2026-06-21): offline-tool real spend COUNTS toward reconciliation.** `is_test` is redefined to mean **"test-purpose, i.e. NOT real operational spend"** — driven by test RUNTIME signals, NOT by userid.

> **Key finding (iter-3 review):** `EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001'` (real evolution runs, `claimAndExecuteRun.ts:28`) is in `TEST_USER_IDS` → **today every real evolution per-call row is mislabeled `is_test=true`**. That's a third reason evolution spend doesn't reconcile. The same `…001` userid is also used by the `prod-ai` E2E harness — so **userid cannot discriminate real-evolution from prod-ai-test; a runtime flag is mandatory**, and retaining `…001` in `TEST_USER_IDS` would (catastrophically) hide ALL real evolution spend.

- [ ] **Redefine `isTestLlmCall` (`llmCostAttribution.ts:72`)**: drive `is_test` off test-RUNTIME/mock signals only — `NODE_ENV=test`, `E2E_TEST_MODE`, a NEW dedicated prod-ai test-runtime flag (below), `integration_test`/factory-literal call_sources, mock fingerprint. **Remove `TEST_USER_IDS.has(userid)` as a trigger entirely** (it mislabels real evolution + real offline-tool spend).
- [ ] **prod-ai harness flag (fixes the false-negative gap):** the port-3010 `prod-ai` webServer (`playwright.config.ts` ~line 214) runs the REAL pipeline with NO `E2E_TEST_MODE` and NO `NODE_ENV=test`, emitting real cheap-model rows under `…001`. Add an explicit dedicated env flag (e.g. `LLM_TRACKING_TEST_RUNTIME=true`) to that webServer command and check it in `isTestLlmCall`, so prod-ai spend stays `is_test=true` while real evolution (no flag) becomes `is_test=false`. (The `editorTest` debug page real spend also correctly becomes `is_test=false` and is entity-filterable — note it.)
- [ ] **Stop offline tools force-tagging real spend test:** `oneshotGenerator.ts:79` must not hard-set `is_test:true` for real provider calls — derive it (ties to Phase 4 chokepoint routing). Real tool spend → `is_test=false` and counts.
- [ ] Keep tools **filterable via the entity/category axis** (By-Entity tab), NOT via `is_test` — experimentation separated analytically without hiding real spend.
- [ ] **Make the non-RPC tabs respect the include-test toggle.** `getCostSummaryAction`/`getCostByModelAction`/`getCostByUserAction`/`getDailyCostsAction` (+ the `daily_llm_costs` view) currently DON'T filter on `is_test`, so the headline Summary cards stay mock-polluted regardless of the toggle. Add `is_test` filtering to these (or migrate them onto the bucket RPC) so the headline total reconciles. (Otherwise "totals reconcile with provider bills" fails on the cards even after the rest is fixed.)
- [ ] Dashboard surfaces unattributed (`unattributed:*`), NULL-`estimated_cost_usd`, and uncaptured spend rather than hiding them.
- [ ] **Forward-only:** no historical `is_test` backfill (window already un-auditable). Update `scripts/backfillLlmIsTest.ts` header (stale "test userids are source of truth"). Document the change.
- [ ] Update tests: `llmCostAttribution.test.ts` (rewrite the `for (const uid of TEST_USER_IDS) … is_test=true` loop at `:57-61` — system userid in non-test env now → `is_test=false`); new cases (real offline `…000`/`…001` + non-test env → false; integration mock under `NODE_ENV=test` → true; prod-ai flag → true). Document that integration self-tagging relies on Jest's implicit `NODE_ENV=test`.
- [ ] Document the un-auditable historical window (NULL `evolution_invocation_id`, no join key — not backfillable).

## Rollback & Sequencing
- **Sequencing makes mass-failure unlikely.** Fail-closed only bites a runner once it runs the new code. HEAD runners already wire `trackingDb` correctly → their writes succeed → no new failures. The minicomputer only gets the throw when it git-pulls — and the SAME pull brings the correct `trackingDb` wiring + the Phase-2 startup self-check, so post-pull its calls succeed (or it skips an unwritable target at boot). So the throw never lands on a runner that lacks the fix. Land Phases 1+2 (code) together; the minicomputer pull is the deploy step.
- **Residual risk:** a transient evolution-DB blip now fails an in-flight run (provider already paid; reservation IS released via `reconcileAfterCall` finally at `llms.ts:988-1007`; spend dead-lettered to logs). Expect a small rise in `failed` runs with `error_code=llm_tracking_write_failed` — this is intended signal, not a regression. Document so ops doesn't misread it.
- **Rollback (no runtime flag, per Decision 3):** revert the Phase-1 commit + redeploy / re-pull. Capture the revert SHA in `_progress.md` at ship time so an incident revert is one command.

## Testing

### Unit Tests
- [ ] `src/lib/services/llms.test.ts` — (a) evolution (`requireTracking:true`) call throws on tracking-save failure; (b) it emits the dead-letter `error` log with the full payload; (c) `onUsage` fires before the throw; (d) main-app call (no `requireTracking`) still swallows-and-logs. Rewrite/replace the existing `EVOLUTION_TRACKING_STRICT` cases at `:1710-1721`.
- [ ] Extend existing `src/lib/services/llmCostAttribution.test.ts` (already exists) — `is_test` classification + `attributeCallSource` edge cases incl. `unattributed:*`.
- [ ] `src/lib/services/llmCostConfigActions` action test — `getSpendingSummaryAction` returns `failure()` (does NOT throw) when the gate errors.
- [ ] Coverage-guard unit test (Phase 4) — the guard flags a planted direct-SDK / out-of-chokepoint `.insert` call.
- [ ] Startup self-check test (Phase 2) — broken client → check throws/skips target; working client → passes.

### Integration Tests
- [ ] Extend `src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts` (the real June attribution+is_test+RPC suite — NOT the unrelated May `evolution-cost-attribution.integration.test.ts`): happy path — evolution `callLLM` lands a tracked row linked to the invocation.
- [ ] **Negative fail-closed test (highest priority):** with the tracking write forced to fail, an evolution call throws and the run finalizes `failed` with `error_code=llm_tracking_write_failed` — NOT silently `completed`. Reuse the evolution integration harness.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/` — new/sibling spec (`@evolution` tag; admin is host-gated, not `@critical`): `/admin/costs` loads with the cost-section error banner (`page.tsx:314-317`) NOT visible, all tabs render. (The cited `admin-evolution-cost-split.spec.ts` tests cost COLUMNS, not this banner — add a distinct assertion/spec.)

### Manual Verification
- [ ] Staging reconciliation, exact query: `npm run query:staging -- --json "SELECT i.run_id, round(SUM(i.cost_usd)::numeric,4) inv, round(SUM(l.estimated_cost_usd)::numeric,4) trk FROM evolution_agent_invocations i LEFT JOIN \"llmCallTracking\" l ON l.evolution_invocation_id=i.id WHERE i.run_id='<fresh-runId>' GROUP BY 1"` — assert `|inv-trk|` within rounding for a fresh post-fix run.

## Files to Modify (verified)
- `src/lib/services/llms.ts` — `CallLLMOptions.requireTracking`; redesign `saveLlmCallTracking`/`saveTrackingAndNotify`; dead-letter; `onUsage` reorder; delete `isStrictMode`.
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — `requireTracking:true` in rawProvider.
- `evolution/src/lib/judgeEval/runJudgeEval.ts` (~302) + `evolution/src/lib/promptEditor/runPromptEditorConfig.ts` (~79) + `evolution/src/services/arenaActions.ts` (~750) — set `requireTracking`/`trackingDb`.
- `evolution/src/lib/pipeline/classifyError.ts` — new `error_code`.
- `evolution/scripts/processRunQueue.ts` — per-target startup self-check.
- `src/app/admin/costs/page.tsx` + `src/lib/services/llmCostConfigActions.ts` — dashboard error fix + surface all failures.
- `eslint-rules/require-llm-call-source.js` (+ `.test.js`) and a new AST/grep CI guard — coverage.
- `src/lib/services/llmCallSource.ts` (+ `ENTITY_BY_SOURCE` in `llmCostAttribution.ts` + exhaustiveness test) — add bounded `oneshot`/`oneshot_outline`/`pilot` `CALL_SOURCES`.
- `src/lib/services/llmCostAttribution.ts` (`isTestLlmCall`, +`.test.ts`) — redefine `is_test` = test-runtime only; DROP `TEST_USER_IDS` trigger; add prod-ai flag check.
- `playwright.config.ts` — add dedicated test-runtime flag (e.g. `LLM_TRACKING_TEST_RUNTIME=true`) to the port-3010 `prod-ai` webServer.
- `evolution/src/services/costAnalytics.ts` + `src/lib/services/costAnalytics`-fed actions — make `getCostSummary/ByModel/ByUser/DailyCosts` respect `is_test`/the include-test toggle.
- `scripts/backfillLlmIsTest.ts` — correct stale "test userids = source of truth" header.
- `evolution/scripts/lib/oneshotGenerator.ts` (+ `pilot-mode-b.ts`) — route through chokepoint; stop hard-setting `is_test:true` for real spend; make `catch{}` loud.
- Tests: `src/lib/services/llms.test.ts`, `evolution/scripts/verifyLlmCallTrackingFix.ts` (retire/repurpose — it sets the removed flag), `src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts`, new E2E spec.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Load `/admin/costs` (evolution host) via local server; confirm Overview/By Entity/By Model/Controls render with NO error banner.

### B) Automated Tests
- [ ] `npm run test:unit -- llms` and `-- llmCostAttribution`
- [ ] `npm run test:integration -- --grep "cost|attribution"` (incl. the negative fail-closed test)
- [ ] `npm run test:e2e -- src/__tests__/e2e/specs/09-admin/` (new cost-section spec)
- [ ] `npm run lint` (coverage guard active)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — update the audit-gap caveat once root cause is fixed (the "REMAINS ACTIVE" window).
- [ ] `docs/feature_deep_dives/admin_panel.md` — Cost Analytics section: error-path + reconciliation behavior.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — confirm judge-lab spend capture.
- [ ] `evolution/docs/data_model.md` — `llmCallTracking` columns / FK if changed.
- [ ] `evolution/docs/evolution_metrics.md`, `evolution/docs/logging.md`, `evolution/docs/reference.md` — if attribution/coverage surfaces change.

## Review & Discussion

### Iteration 1 — Security 2/5, Architecture 3/5, Testing 2/5
Critical gaps raised + resolved:
- **Consistency contract** (Sec): throwing fires after money is spent → added "Fail-Closed Semantics" (dead-letter the full would-be-row payload to an `error` log before throwing; run finalizes `failed` with `error_code`; `onUsage` before throw).
- **Scope leak** (Sec + Arch): `requireTracking` only covered the pipeline rawProvider → Locked Decision #1 + Phase 1 now set it at ALL evolution call sites (`claimAndExecuteRun.ts:204`, `runJudgeEval.ts:302`, `runPromptEditorConfig.ts:79`, `arenaActions.ts:750`).
- **onUsage ordering** (Sec): reorder before the re-throw.
- **Self-check location** (Arch): named `processRunQueue.ts main()` after `buildDbTargets()`, per-target `target.client`, no stray insert, mirror `ensureStartupAssertions`.
- **Coverage guard** (Arch): lint alone is blind to local-`callLLM`/direct-SDK (`oneshotGenerator`); added an AST/grep CI guard over `chat.completions.create`/`messages.create`/`.from('llmCallTracking').insert` outside chokepoints.
- **Strict-mode consumers** (Test): both `isStrictMode()` branches (`llms.ts:179` + `:274`) redesigned; `llms.test.ts:1710-1721` + `verifyLlmCallTrackingFix.ts` slated for rewrite/retire.
- **Negative test + paths + rollback** (Test): added the highest-priority negative fail-closed integration test, disambiguated May-vs-June test files (extend, not create), added "Rollback & Sequencing".

### Iteration 2 — Security 5/5, Architecture 5/5, Testing 5/5 → CONSENSUS
Reviewers verified all fixes against code. Minor polish folded in below (no blockers remained).

### Iteration 3 (targeted re-review of the Phase 4/5 `is_test` decision) — Security 3/5, Architecture 3/5, Testing 5/5
Two NEW critical gaps found + fixed:
- **prod-ai false-negative** (Sec): real evolution runs AND the prod-ai E2E harness BOTH use userid `…001`; dropping the `TEST_USER_IDS` trigger would un-tag prod-ai's real cheap-model spend (and retaining `…001` would hide ALL real evolution spend). Fixed: discriminate by a dedicated test-runtime flag on the port-3010 webServer, not by userid. (Also surfaced: `…001` being in `TEST_USER_IDS` means real evolution per-call rows are mislabeled test TODAY — a third reconciliation root cause.)
- **Tool registry gap** (Arch): routing `oneshot`/`pilot` through the chokepoint requires new bounded `CALL_SOURCES` + `ENTITY_BY_SOURCE` entries + normalizing the unbounded `oneshot_${model}` source + updating the exhaustiveness test — none were captured. Fixed in Phase 4 + Files-to-Modify. (Judge lab already mapped.)
- Folded minors: non-RPC tabs (Summary/Model/User/Daily) don't filter `is_test` → headline stays mock-polluted (added Phase 5 bullet); `backfillLlmIsTest.ts` stale header; cite `llmCostAttribution.test.ts:57-61`; document implicit `NODE_ENV=test` reliance.

### Iteration 4 (verify iter-3 fixes) — Security 5/5, Architecture 5/5, Testing 5/5 → CONSENSUS
Both iter-3 gaps verified closed against code. Folded minors:
- `…001` is shared by THREE real-money paths: real evolution (`claimAndExecuteRun.ts:28`), **judge eval** (`JUDGE_EVAL_SYSTEM_USERID`, `runJudgeEval.ts:31`), and prod-ai. All land on the correct side (real → counted; prod-ai → flagged test). `…000` (ANONYMOUS, oneshot/local-run) = real CLI spend now counted; `…099` = test-only, still caught by `NODE_ENV=test`.
- **CI needs no extra wiring:** `e2e-real-ai-smoke.yml` spawns the 3010 server via `npx playwright test --project=prod-ai`, so the `LLM_TRACKING_TEST_RUNTIME` flag set in the webServer `env:` map propagates to the server process where `isTestLlmCall` runs. Add it via Playwright's `env:` map (independent of the `env -u E2E_TEST_MODE` strip). (Anchor: the 3010 `prod-ai` webServer block is ~`playwright.config.ts:228-240`, not 214.)
- **`getDailyCostsAction` is the exception** among the non-RPC tabs: it reads the `daily_llm_costs` VIEW, which doesn't project `is_test` → can't be filtered app-side. Either add `is_test` to the view (migration) or move it onto the bucket RPC. Summary/ByModel/ByUser query `llmCallTracking` directly and CAN be filtered app-side — reuse the existing-but-unused `CostFilters.includeTest` field (`costAnalytics.ts:95-96`) as the hook. oneshot/pilot resolve to `category:'non_evolution'` (intended).

### Execution clarifications (from iter-2 minor notes)
- **classifyError mapping:** `saveLlmCallTracking` throws a `ServiceError` with generic message ("Failed to save LLM call tracking"). To finalize with `llm_tracking_write_failed`, wire `classifyError.ts` to match on an `instanceof`/code or a distinctive message marker — declaring the union member alone is insufficient.
- **rawProvider on throw:** `capturedUsage` (`claimAndExecuteRun.ts:242`) is discarded when the call throws (control jumps to the outer catch `:251`); the dead-letter log — not `onUsage` — is the pipeline path's safety net. The `onUsage`-before-throw reorder mainly benefits the catch-and-continue callers (judge eval / prompt-editor cost accumulators).
- **arenaActions context:** `arenaActions.ts:750` runs in a Next.js server-action context where the `createSupabaseServiceClient()` fallback works → set `requireTracking` only; do NOT thread a `trackingDb` (none in scope).
- **runPromptEditorConfig trackingDb source:** pin which client it injects (the config runner has no pipeline supabase in scope) before execution.
- **Reservation release is async/best-effort:** `reconcileAfterCall` (`llms.ts:994`) is fire-and-forget (`.catch`, not awaited) — on a failing call the reservation release is async best-effort, not synchronously guaranteed.
- **Naming to pick at execution:** the new E2E spec filename in `09-admin/`, the coverage-guard script path + npm wiring, and a distinct grep handle for the negative fail-closed test.
