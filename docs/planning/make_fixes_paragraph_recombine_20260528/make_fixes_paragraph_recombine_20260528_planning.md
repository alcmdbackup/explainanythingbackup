# Make Fixes Paragraph Recombine Plan

## Background
Two paragraph_recombine items. (1) Add the ability to select a top-N parent from the run pool for `paragraph_recombine` iterations in the strategy creation wizard, following the standard `sourceMode`/`qualityCutoff` pattern that the other variant-producing agents already use. (2) Diagnose and fix why run `3ec72a7c-1c5b-4b66-a75d-972b6fc889c1` reports that strategy `e8e55c08-2f03-48c5-b598-d83768a700d3` has an invalid config.

## Requirements (from GH Issue #1117)
- figure out how to add ability to select top N from pool for paragraph recombine. Follow standard pattern from other agents.
- Also figure out why run 3ec72a7c-1c5b-4b66-a75d-972b6fc889c1 is saying Strategy e8e55c08-2f03-48c5-b598-d83768a700d3 has invalid config

## Problem
**Task 1:** The schema, runtime (`resolveParent` → paragraph_recombine dispatch branch), and dispatch-preview already support `sourceMode: 'pool'` + `qualityCutoff` for `paragraph_recombine` (confirmed by schema parse-test + agent research). The only blocker is the wizard `src/app/admin/evolution/strategies/new/page.tsx`: `isVariantProducing()` (L159-167) lists `paragraph_recombine` in its return TYPE but omits it from the BODY, so the (already-generic) source/cutoff controls never render and `toIterationConfigsPayload` never emits `sourceMode`/`qualityCutoff`. A related inconsistency: the wizard's `canBeFirstIteration()` (L173-178) omits `paragraph_recombine` even though the SCHEMA's `canBeFirstIteration` (`evolution/src/lib/schemas.ts:549-556`) allows it.

**Task 3 (NEW — discovered 2026-05-28 from run `e26350f7`, prerequisite for Task 1):** After the runner was updated (Task 2 unblocked), a `paragraph_recombine` run now *parses* and `completed`, but the `paragraph_recombine` iteration is a **silent no-op** — it produces zero invocations and zero variants. Root cause: `evolution/src/lib/pipeline/loop/runIterationLoop.ts` routes iterations through an `if/else if` chain on `iterType` — generate-family (L345) → editing (L866) → debate (L1040) → swiss (L1176) → ends ~L1285. **There is no branch for `paragraph_recombine`.** The `paragraph_recombine` dispatch case at L527 lives inside the local `dispatchOneAgent` helper, which is defined inside the L345 generate-family branch and only reached when the L345 gate matches — but that gate omits `paragraph_recombine`. So #1116 shipped the enum, the agent class, the L527 dispatch case, and the cost/projector/UI plumbing, but never added `paragraph_recombine` to the L345 gate (its sibling `proposer_approver_criteria_generate` IS in the gate and works). Confirmed on dev: run `e26350f7` = 3 `generate` + 1 `merge` invocations (all iteration 1), iteration 2 (paragraph_recombine, 80% budget) did nothing, run finalized `completed` / `totalIterations: 2`. NOTE: this also corrects an earlier research claim that "the runtime already works" — it does not. Task 3 is the prerequisite that makes Task 1's pool-mode selection actually take effect (the L442-478 `resolveParent` call in that branch is what reads `sourceMode`/`qualityCutoff`).

**Task 2:** The stored config for `e8e55c08` is VALID against current code. `paragraph_recombine` entered the `agentType` enum in PR #1116 (`41cdbb9a`, origin/main HEAD). The wizard (Vercel, up-to-date) created the strategy, but the batch runner executing the run was on older code whose enum lacked `paragraph_recombine` → `strategyConfigSchema.safeParse` rejected it and `buildRunContext.ts:346-348` emitted a generic "has invalid config", discarding the real ZodError. The **operational** cause (runner behind origin/main) is now fixed by the user (runner updated). The remaining **code** deliverable is durable error legibility so any future schema/runner skew is diagnosable from the run's `error_message` + logs.

## Options Considered
- [x] **Option A (CHOSEN): dedicated dispatch branch + wizard fix (core + consistency) + error-legibility fix.** Task 3 (NEW, prerequisite): add a **dedicated `else if (iterType === 'paragraph_recombine')` branch** in `runIterationLoop.ts` (resolveParent → 1 agent → article-rank the variant), NOT the line-345 gate-fix (rejected in plan-review iteration 2 — see Phase 1 + Review). Task 1: add `paragraph_recombine` to `isVariantProducing()` body (the feature) AND `canBeFirstIteration()` body + fix the stale L543 message (consistency with schema). Task 2: surface the Zod issues at `buildRunContext.ts` in `error_message`. (Revised: Task 3 IS a runtime change — supersedes the earlier "no runtime change" assumption that rested on the incorrect belief that paragraph_recombine already dispatched. No DB/migration change; the only schema touch is additively extending the `MergeRatingsAgent.iterationType` TS/Zod union.)
- [ ] **Option B: Core-only wizard fix.** Just `isVariantProducing()`; leave the `canBeFirstIteration` mismatch for later. (Rejected — small extra scope, closes a real inconsistency in the same PR.)
- [ ] **Option C: Add a runner-side version guard for Task 2.** (Rejected — agent-type skew is intrinsically forward-incompatible; the existing `assertCostCalibrationPhaseEnumsMatch` covers DB-migration skew; legibility + ops discipline is the right fix.)

## Phased Execution Plan

### Phase 1: Task 3 — add a dedicated paragraph_recombine dispatch branch (PREREQUISITE)
**Approach decided by plan-review iteration 2: a DEDICATED top-level branch, NOT the line-345 gate-fix.** The gate-fix was rejected on three verified grounds: (i) **over-dispatch** — the generate-family `estPerAgent` (L411) calls `estimateAgentCost` (vanilla generate ~$0.002), not `estimateParagraphRecombineCost` (~$0.011+, ~336 LLM calls), so `maxAffordable` (L417) inflates ~5–36× and the parallel batch (L640) launches many concurrent recombine agents — overspend + LLM-API burst (the in-flight agents can't be aborted; `IterationBudgetExceededError` only blocks NEW reservations); (ii) **contradicts the single-source-of-truth** — `projectDispatchPlan.ts:485` hardcodes `dispatchCount=1` and architecture.md says "1 ParagraphRecombineAgent"; (iii) **the variant would never be article-ranked** — `ParagraphRecombineAgent.run()` returns `matches:[]` (verified L243), `MergeRatingsAgent` adds `newVariants` at default `createRating()`=1200 without ranking them (verified L176-178), and its `iterationType` enum doesn't include `paragraph_recombine` (verified L28).

- [x] Add a dedicated `else if (iterType === 'paragraph_recombine')` branch in `runIterationLoop.ts` (sibling to the swiss branch at L1176; **model it on the DEBATE branch at L1040-1174** — the closest single-dispatch precedent: the agent returns `matches`, the loop builds `newVariants: [variant]` + `matchBuffers` from those matches, then makes ONE `MergeRatingsAgent.run()` call). It must:
  - Resolve exactly ONE parent via the shared `resolveParent()` honoring `iterCfg.sourceMode`/`qualityCutoff` (seed default; pool draws from in-run, non-arena variants). **This is what makes Task 1's pool selection take effect at runtime.**
  - Dispatch exactly ONE `new ParagraphRecombineAgent().run({ parentText, parentVariantId, initialPool, initialRatings, initialMatchCounts, cache }, ctx)` under `iterTracker` (dispatchCount=1 — matches projectDispatchPlan + the doc).
  - **Article-rank the recombined variant INSIDE the agent, NOT the loop.** `rankNewVariant` requires an `EvolutionLLMClient` (`input.llm`), a per-invocation `AgentCostScope` (`ctx.costTracker`), and `invocationId` — all of which exist only inside `Agent.run()/execute()` (the loop has only `rawProvider`; L229 "no shared LLM client", and all 5 existing `rankNewVariant` callers are inside agents). So: (i) extend `ParagraphRecombineInput` with `initialPool`/`initialRatings`/`initialMatchCounts`/`cache` (as the editing/criteria agents already receive); (ii) have `ParagraphRecombineAgent` call `rankNewVariant()` on the surfaced recombined variant after Step 5 (it ALREADY imports `rankNewVariant` at L32 + has `input.llm` + the `AgentCostScope`), against a deep-cloned iteration-start pool/ratings; (iii) populate the returned `matches` in its output (currently `matches:[]` at L243); (iv) the loop branch feeds those `matches` + `newVariants:[recombined]` to `MergeRatingsAgent` exactly like the debate branch. (Resolves a doc conflict: architecture.md:173 says "None at article level" while paragraph_recombine.md:38 claims post-emit ranking flows through MergeRatingsAgent — neither is true today (`matches:[]` + MergeRatingsAgent adds at default Elo). Ranking it in-agent makes a `[generate, paragraph_recombine]` strategy yield a ranked winner instead of a baseline-Elo orphan.) IMPL NOTES: (1) the article-rank must use `input.llm` (the invocation-scoped client), NOT the per-slot `rankLlm` relabel proxy — so it emits the plain `'ranking'` label → `ranking_cost` (article-level), kept distinct from the per-slot `paragraph_recombine_cost`; no double-count (disjoint buckets of the run-total). (2) Place it at Step 6, AFTER the existing 0.9× pre-final-ranking budget gate (the gate exists precisely to reserve headroom for it). (3) Pass the loop's LIVE pool/ratings/matchCounts into the agent (the agent clones internally, as GFPA does) rather than constructing a separate snapshot.
  - Wrap dispatch+merge in a `try/catch` mapping `IterationBudgetExceededError` → `iterStopReason='iteration_budget_exceeded'` (mirror the debate branch L1139-1152) — the loop's top-level catch (L1286) only handles RUN-level `BudgetExceededError` and re-throws the rest, so an iteration-budget exhaustion during the in-agent rank would otherwise abort the whole run. ALSO set that stopReason from the agent's RETURNED `budgetExceeded` flag: `Agent.run()` catches an in-agent `IterationBudgetExceededError` and surfaces it as a flag (not a throw), so the budget path can arrive either way — mirror debate L1138 / editing L990 which check both.
  - Record the iteration snapshot + push BOTH `eloHistory` AND `uncertaintyHistory` (the editing branch omits the latter — don't copy that) with `iterType='paragraph_recombine'` (the snapshot enum already includes it); log iteration-complete.
  - Honor the `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` kill switch (skip/reject cleanly, as the L527 case does).
- [x] Extend `MergeRatingsAgent`'s `iterationType` **TS union (L28) only** to include `'paragraph_recombine'` (additive; `iterationType` is a passthrough label with no exhaustive switch). NOTE: the Zod execution-detail schema (`schemas.ts:2008`) AND the snapshot enum (`schemas.ts:2066`) ALREADY include `'paragraph_recombine'` — so this is a one-line TS change, not a schema change.
- [x] Move the L527 `paragraph_recombine` dispatch case OUT of `dispatchOneAgent` and into the new branch; delete it from `dispatchOneAgent` (it is dead + incorrectly placed there).
- [x] Verify against run `e26350f7`: a re-queued paragraph_recombine run now produces exactly 1 `paragraph_recombine` invocation in iteration 2 + a recombined variant carrying a non-baseline (actually-ranked) Elo (was zero invocations).

### Phase 2: Task 1 — expose top-N pool selection for paragraph_recombine in the wizard
- [x] In `src/app/admin/evolution/strategies/new/page.tsx`, add `|| agentType === 'paragraph_recombine'` to the `isVariantProducing()` BODY (L162-166) only — the return-TYPE annotation at L161 already includes `paragraph_recombine`, so no signature edit. This cascades to: the source-control render gate (L1215, `isVariantProducing && idx > 0`), `sourceMode`/`qualityCutoff` emission in `toIterationConfigsPayload` (L200-204), and the `hasVariantProducing` swiss-precedence count (L549). Key snippet:
  ```ts
  return agentType === 'generate'
    || agentType === 'reflect_and_generate'
    || agentType === 'criteria_and_generate'
    || agentType === 'single_pass_evaluate_criteria_and_generate'
    || agentType === 'proposer_approver_criteria_generate'
    || agentType === 'paragraph_recombine';   // ← add
  ```
- [x] Add `|| agentType === 'paragraph_recombine'` to the `canBeFirstIteration()` body (L174-177) to match `schemas.ts:549-556` (consistency).
- [x] Update the first-iteration validation message (L543) to reflect the actual allowed set (it currently says "generate or reflect_and_generate", already omitting the criteria types). Make it accurate, e.g. "First iteration must be a variant-producing type (generate, reflect_and_generate, a criteria agent, or paragraph_recombine)".
- [x] (Accuracy, per resolved decision #2) Update the stale `sourceMode`/`qualityCutoff` refine messages in `evolution/src/lib/schemas.ts` (~L673/L676) — they say "only valid for generate, reflect_and_generate, or criteria_and_generate" but the refines actually allow everything except `swiss`/`debate_and_generate` (incl. proposer_approver + paragraph_recombine). Reword to match the real rule so future "invalid config" debugging isn't misled. (No behavior change — message text only.)
- [x] Verify (read-only) no other change is needed: the `updateIteration` reducer already defaults `qualityCutoffMode='topN'`/`qualityCutoffValue` when sourceMode flips to pool; the source-control JSX (L1215-1265) is generic; dispatch preview (`projectDispatchPlan` / `estimateParagraphRecombineCost`) is sourceMode-independent. No schema change. Do NOT touch `evolution/src/lib/schemas.ts`'s `isVariantProducingAgentType` (L562-568) — it is unused dead code (zero call sites) and is independent of the wizard helper. (Context for reviewers: the schema's `canBeFirstIteration` at `schemas.ts:549-556` IS load-bearing — consumed by the first-iteration refine at ~L814 — which is exactly why the wizard mismatch is a real bug, not cosmetic.)

### Phase 3: Task 2 — make the "invalid config" error legible
- [x] In `evolution/src/lib/pipeline/setup/buildRunContext.ts` (L346-348), include the Zod issues in the returned error string (cap to first ~3 issues, `path: message`) so `error_message` shows e.g. "...invalid config: iterationConfigs.1.agentType: invalid_enum_value (...)". Key snippet:
  ```ts
  const configParsed = strategyConfigSchema.safeParse(strategyRow.config);
  if (!configParsed.success) {
    const issues = configParsed.error.issues
      .slice(0, 3)
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
      .slice(0, 1500); // self-bound the message (markRunFailed also caps at 2000)
    return { error: `Strategy ${claimedRun.strategy_id} has invalid config: ${issues}` };
  }
  ```
  Safe to surface: `error_message` is rendered as escaped React text on the admin-only run-detail surface, and `strategyConfigSchema` covers config fields only (agent types, model-name strings, budget %s, cutoffs) — no credentials. `path: message` (not the raw received-value object) is what's emitted.
- [x] (Decision point — see Review) Optionally also emit a structured warn log with the full issues. NOTE: the EntityLogger is created later (~L390), so this requires either moving logger creation earlier OR keeping it message-only. Lean: message-only enrichment is enough and lowest-risk; structured log is a stretch goal.
- [x] Confirm the runner is updated (DONE operationally by user) — no code action; documented as the unblock for the live failures.

## Testing

### Unit Tests
- [x] `src/app/admin/evolution/strategies/new/page.test.tsx` — add a test: add a non-first iteration, set agentType to `paragraph_recombine`, assert `source-mode-select-${idx}` renders; set source to `pool`, assert `cutoff-value-${idx}` + `cutoff-mode-${idx}` render; submit and assert the `createStrategyAction` payload's matching iteration includes `sourceMode: 'pool'` + `qualityCutoff: { mode, value }`.
- [x] `src/app/admin/evolution/strategies/new/page.test.tsx` — add a test: a strategy whose FIRST iteration is `paragraph_recombine` passes wizard validation (no "First iteration must be..." error).
- [x] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — add a NEW test case (do NOT reuse the existing `{ generationModel: null }` fixture at L121-131, which yields a `generationModel` path). Feed a config whose iteration has an UNKNOWN `agentType` (the actual #1117 failure mode) and assert the returned error string CONTAINS the field path `iterationConfigs.0.agentType` (or `.1.agentType`).

### Integration Tests
- [x] (Task 3 — REQUIRED regression guard) Add coverage that a `[generate, paragraph_recombine]` strategy actually DISPATCHES the agent and produces a recombined variant — i.e. the iteration is no longer a no-op (guards the run-`e26350f7` regression). Two viable harnesses (pick one):
  - **Lightest (recommended):** `jest.mock('.../paragraphRecombine/ParagraphRecombineAgent')` in the existing loop unit test `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` and assert the mocked `.run()` is called ≥1× (and 0× before the fix). Least setup, directly guards the new branch. ALSO assert the ranking wiring — that the branch feeds the agent's returned `matches` + `newVariants` into `MergeRatingsAgent` (mock it and assert `.run()` received a non-empty `newVariants`) — so the guard catches not just "dispatched" but "ranked" (the baseline-Elo-orphan failure mode), not only the e26350f7 zero-invocation symptom.
  - **Integration:** new `evolution/src/__tests__/integration/evolution-paragraph-recombine-dispatch.integration.test.ts` modeled on the existing `evolution/src/__tests__/integration/evolution-debate-agent.integration.test.ts` (generate→debate, in-process V2 mock, runs in the `integration-evolution` CI lane, no real DB/network). NOTE: `v2MockLlm.ts` routes `paragraph_rank` but NOT `paragraph_rewrite` — a real run would fail `validateParagraphRewrite`'s ±10% length cap unless a length-shaped `paragraph_rewrite` is supplied via `labelResponses` (see `ParagraphRecombineAgent.test.ts:65-84`), plus mock `slotTopicActions`/`loadArenaEntries`/`syncToArena`/`rankNewVariant`. Do NOT extend `evolution-paragraph-recombine-accumulation.integration.test.ts` — it bypasses `evolveArticle` and auto-skips without migrations, so it can't catch the no-op.
- [x] (Optional) `evolution/src/lib/schemas.test.ts` — assert `strategyConfigSchema.safeParse` rejects an unknown `agentType` with an issue whose `path` includes `['iterationConfigs', 0, 'agentType']` (locks the contract the Task-2 legibility fix relies on).

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — add a case: build a 2-iteration strategy (generate, then `paragraph_recombine`), set the paragraph_recombine row's `source-mode-select-1` to pool, set `cutoff-value-1`, submit, and assert the strategy is created (and, if practical, that its persisted config carries `sourceMode:'pool'`+`qualityCutoff`).

### Manual Verification
- [ ] (Task 3) Re-queue a `paragraph_recombine` run (e.g. strategy `0db50e05` / a fresh pool-mode strategy) and confirm iteration 2 now produces ≥1 `paragraph_recombine` invocation and a recombined variant — vs. run `e26350f7`'s zero. Query dev: `npm run query:staging -- "SELECT iteration, agent_name, count(*) FROM evolution_agent_invocations WHERE run_id='<new>' GROUP BY 1,2"`. **DEFERRED to post-merge ops** — the dispatch is verified by the automated regression guard (`runIterationLoop.test.ts`: agent dispatched + MergeRatingsAgent receives the variant + kill-switch) and the E2E; a live dev re-queue spends real LLM budget (~336 calls/invocation) and needs the dev runner.
- [x] (Task 1) On a local server, open `/admin/evolution/strategies/new`, add a paragraph_recombine non-first iteration, confirm the Source dropdown + "Take top N" controls appear and a pool-mode strategy saves.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run the new/updated wizard E2E case via the project's E2E harness (servers auto-managed): `npm run test:e2e:evolution` (or the targeted spec) — confirm the paragraph_recombine pool-mode flow passes.

### B) Automated Tests
- [x] `npm run test:integration` (or the targeted evolution-pipeline suite) — Task 3 dispatch regression guard
- [x] `npm run test -- src/app/admin/evolution/strategies/new/page.test.tsx` (wizard unit)
- [x] `npm run test -- evolution/src/lib/pipeline/setup/buildRunContext.test.ts` (legibility unit)
- [x] `npm run typecheck` && `npm run lint`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/paragraph_recombine.md` — Configuration knobs: note the wizard now exposes `sourceMode`/`qualityCutoff` (top-N pool) for paragraph_recombine.
- [x] `evolution/docs/multi_iteration_strategies.md` — Strategy Wizard Flow: source controls now cover paragraph_recombine.
- [x] `evolution/docs/strategies_and_experiments.md` — sourceMode + qualityCutoff section: paragraph_recombine included.
- [x] (Task 3) Correct the conflicting/incorrect ranking docs once the dedicated branch lands: `evolution/docs/architecture.md` (~L173, the iteration-type table says paragraph_recombine "Merge: None at article level" — now it DOES article-rank via the agent + MergeRatingsAgent) and `evolution/docs/paragraph_recombine.md` (~L38, claims "post-emit ranking ... via the standard MergeRatingsAgent path (iterationType added to the enum in Phase 1)" — the enum was never added and ranking didn't happen; make both accurate to the new in-agent rank + 1 MergeRatingsAgent call).
- [x] (Task 2) Consider a short note in `evolution/docs/minicomputer_deployment.md` or `reference.md`: a runner behind origin/main rejects newly-merged agent types with "invalid config" until updated; the error now surfaces the failing field.

## Rollback
- Task 1 (wizard): purely additive UI gating + a string. `git revert` is sufficient. Runtime-side safety valve already exists: `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` (`runIterationLoop.ts:528`) disables paragraph_recombine execution regardless of wizard state.
- Task 2 (buildRunContext): a one-statement error-string change; `git revert` is sufficient. No data migration, no flag.

## Review & Discussion

### Iteration 1 (/plan-review) — CONSENSUS REACHED
| Perspective | Score | Critical gaps |
|---|---|---|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

All reviewers verified the load-bearing claims against source (helper body-vs-type gap, the three cascade call sites, schema already permits pool for paragraph_recombine, Zod 3 `.issues`/`.path`/`.message` shape, the 2000-char `markRunFailed` cap, all four cited test files + testids exist). No blockers. Non-blocking minors were folded into the plan:
- Length-clamp the surfaced Zod string (`.slice(0,1500)`) + security note (admin-only escaped text, no credentials in config). [done — Phase 2]
- Task-2 unit test must use an UNKNOWN agentType fixture (not the existing `generationModel:null`), so the asserted path is `iterationConfigs.N.agentType`. [done — Testing]
- Note the type-annotation already includes paragraph_recombine (body-only edit); `isVariantProducingAgentType` is dead code (don't touch); schema `canBeFirstIteration` is load-bearing. [done — Phase 1]
- Added a Rollback section noting the existing `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill switch. [done]

### Resolved decisions
1. Task 2 legibility: **message-only enrichment** (the EntityLogger is created after the parse at ~L390; a structured log would need reordering — deferred as out of scope).
2. Stale schema messages at `schemas.ts:673/676` ("only valid for generate, reflect_and_generate, or criteria_and_generate" — omits proposer_approver AND paragraph_recombine): **update for accuracy** as part of the consistency scope, since they'd otherwise mislead future debugging. Add as a Phase 1 step.
3. Task 2 code deliverable = the legibility fix only; the runner update is already done operationally (confirmed by user), not a code change.

### Post-review addition (2026-05-28): Task 3 (dispatch wiring)
Discovered AFTER the iteration-1 consensus, from run `e26350f7` (runner now updated → config parses → but the paragraph_recombine iteration was a silent no-op). This is a NEW runtime change (`runIterationLoop.ts` line-345 gate) that the iteration-1 reviewers did NOT see. **The Task-3 section has not yet been plan-reviewed.** Recommend re-running `/plan-review` (or at least the Architecture + Testing perspectives) before executing Phase 1, focusing on: (a) gate-fix vs dedicated-branch, (b) the N-parallel-dispatch design decision, (c) that `estPerAgent` uses the paragraph cost. Also corrects the earlier (wrong) "runtime already supports paragraph_recombine" claim that informed the original iteration-1 review.

### Iteration 2 (/plan-review re-run, Task 3) — NOT consensus → fixed
| Perspective | Score | Critical gaps |
|---|---|---|
| Security & Technical | 3/5 | over-dispatch (gate-fix uses generate cost estimate → N concurrent recombine agents) |
| Architecture & Integration | 3/5 | (1) recombined variant never article-ranked under gate-fix (`matches:[]` + MergeRatingsAgent adds at default Elo); (2) gate-fix N-dispatch contradicts `projectDispatchPlan` `dispatchCount=1` + architecture.md |
| Testing & CI/CD | 4/5 | none (minors: wrong test-file name, partial v2 mock for `paragraph_rewrite`) |

All three critical gaps verified directly against source (MergeRatingsAgent L28/L176-178, ParagraphRecombineAgent L243) and FIXED by switching Task 3 from the gate-fix to a **dedicated `paragraph_recombine` branch** (dispatch=1, paragraph cost estimate, explicit `rankNewVariant` of the recombined variant, additive `MergeRatingsAgent.iterationType` extension). Testing minors fixed: named the real harnesses (`runIterationLoop.test.ts` class-mock or a debate-test-modeled integration test), flagged the `v2MockLlm` `paragraph_rewrite` length-cap trap, and warned off the accumulation test as the wrong home. Re-reviewed in iteration 3.

### Iteration 3 (/plan-review re-run, revised Task 3) — NOT consensus → fixed
| Perspective | Score | Critical gaps |
|---|---|---|
| Security & Technical | 5/5 | none (minors: article-rank cost not in estimator; explicit iter-budget catch; uncertaintyHistory) |
| Architecture & Integration | 4/5 | `rankNewVariant` placement — plan said call it in the LOOP, but the loop has no `EvolutionLLMClient`/`AgentCostScope`/`invocationId` (L229; all 5 callers are inside agents). Must rank INSIDE `ParagraphRecombineAgent` (it already imports `rankNewVariant`) and return `matches`; loop feeds them to `MergeRatingsAgent` (debate-branch pattern). |
| Testing & CI/CD | 5/5 | none (minors: integration mock needs per-call `paragraph_rewrite` callback not fixed `labelResponses`; also assert the ranking outcome, not just dispatch) |

Critical gap VERIFIED (debate branch L1100-1133 = agent matches → MergeRatingsAgent; loop L229 has no shared LLM client; ParagraphRecombineAgent L32/L120/L123 already has rankNewVariant + input.llm + AgentCostScope) and FIXED: ranking relocated into the agent (extend `ParagraphRecombineInput` + populate output `matches`), loop feeds the debate-branch merge; modeled on the debate branch (not editing); `MergeRatingsAgent` change reduced to the TS-union-only one-liner (Zod + snapshot enums already include it); added the explicit `IterationBudgetExceededError` catch + `uncertaintyHistory` push + the doc-correction (architecture.md:173 / paragraph_recombine.md:38) + a "assert ranking wiring not just dispatch" test note. Re-reviewed in iteration 4.

### Iteration 4 (/plan-review re-run) — ✅ CONSENSUS REACHED
| Perspective | Score | Critical gaps |
|---|---|---|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

All reviewers verified the revised Task 3 against source (debate branch L1100-1135 = agent-matches→MergeRatingsAgent; GFPA/editing in-agent `rankNewVariant` precedent; loop L229 has no shared LLM client; `ParagraphRecombineInput` L59-71 lacks the pool fields to add; output already carries `matches`; MergeRatings Zod+snapshot enums already include paragraph_recombine; chain ends L1285 confirming the no-op). Non-blocking impl notes folded in: article-rank uses `input.llm` (→ `ranking_cost`, not relabeled) at Step 6 after the 0.9× gate with live pool maps; budget path handled via BOTH the returned `budgetExceeded` flag AND the iter-budget try/catch. The plan is execution-ready.
