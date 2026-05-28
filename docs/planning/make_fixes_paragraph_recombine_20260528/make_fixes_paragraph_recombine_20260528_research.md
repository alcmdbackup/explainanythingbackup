# Make Fixes Paragraph Recombine Research

## Problem Statement
Two paragraph_recombine items. (1) Add the ability to select a top-N parent from the run pool for `paragraph_recombine` iterations in the strategy creation wizard, following the standard `sourceMode`/`qualityCutoff` pattern that the other variant-producing agents already use. (2) Diagnose and fix why run `3ec72a7c-1c5b-4b66-a75d-972b6fc889c1` reports that strategy `e8e55c08-2f03-48c5-b598-d83768a700d3` has an invalid config.

## Requirements (from GH Issue #1117)
- figure out how to add ability to select top N from pool for paragraph recombine. Follow standard pattern from other agents.
- Also figure out why run 3ec72a7c-1c5b-4b66-a75d-972b6fc889c1 is saying Strategy e8e55c08-2f03-48c5-b598-d83768a700d3 has invalid config

## High Level Summary
Research method: 3 rounds × 4 Explore agents (12 total) + direct staging DB queries (`npm run query:staging`) + 2 direct schema parse-tests. Both tasks are now fully root-caused and are **independent** (both touch `paragraph_recombine` but are unrelated fixes).

**Task 1 — top-N pool selection for paragraph_recombine: a WIZARD-ONLY UI gap. No schema/runtime change needed.**
- The Zod schema ALREADY accepts `sourceMode: 'pool'` + `qualityCutoff` on a non-first `paragraph_recombine` iteration (parse-test confirmed PARSE OK; the refinements at `evolution/src/lib/schemas.ts:672-676` reject these only on `swiss` and `debate_and_generate`). Missing-`qualityCutoff` and first-iteration-`pool` are correctly rejected. The line-673/676 message string ("only valid for generate, reflect_and_generate, or criteria_and_generate") is STALE wording — the code allows more than the message says.
- **CORRECTION (2026-05-28, after run `e26350f7`):** an earlier round of agents claimed "the runtime already dispatches paragraph_recombine" — that was WRONG (they misread the nesting). The `paragraph_recombine` case at `runIterationLoop.ts:527` lives INSIDE the local `dispatchOneAgent` helper, which is defined inside the generate-family branch gated at **line 345** (`iterType === 'generate' || 'reflect_and_generate' || 'criteria_and_generate' || 'single_pass…' || 'proposer_approver…'`). That gate does NOT include `paragraph_recombine`, and there is NO top-level `else if (iterType === 'paragraph_recombine')` branch (chain: 345 → 866 editing → 1040 debate → 1176 swiss → ends ~1285). So a `paragraph_recombine` iteration is a **silent no-op**: the chain is skipped, `iterStopReason` stays `'iteration_complete'`, the run finalizes as `completed`. The line-527 case is dead as currently wired. This is **Task 3** (below) — a prerequisite for the feature to work at all. The agent itself (`ParagraphRecombineAgent`) has no seed-only assumptions and per-slot topics are keyed by `parentVariantId`, so once dispatch is wired, seed AND pool both work — but dispatch must be wired first.
- The dispatch preview ALREADY handles it (`projectDispatchPlan` routes paragraph_recombine cost via `estimateParagraphRecombineCost`, which depends only on the paragraph knobs, not on sourceMode; dispatch count is 0/1).
- The ONLY blocker is `src/app/admin/evolution/strategies/new/page.tsx`: `isVariantProducing()` (line 159) has `paragraph_recombine` in its return-TYPE annotation but NOT in its BODY (lines 162-166). That gate controls (a) rendering the source/cutoff controls (`isVariantProducing(agentType) && idx > 0`, line ~1215/`iteration-source-controls-${idx}`), (b) emitting `sourceMode`/`qualityCutoff` in `toIterationConfigsPayload` (lines 200-204), and (c) the `hasVariantProducing` swiss-precedence count (line 549). So wizard-built paragraph_recombine iterations are silently pinned to `seed`.
- Secondary wizard↔schema mismatch: the wizard's `canBeFirstIteration()` (page.tsx:173-178) OMITS `paragraph_recombine`, but the SCHEMA's `canBeFirstIteration` (schemas.ts:549-556) INCLUDES it. The first-iteration validation message (page.tsx:543) also needs updating.
- The `updateIteration` reducer + the source-control JSX are already generic — no change. The schema's `isVariantProducingAgentType()` (schemas.ts:562-568, which excludes paragraph_recombine) is a DEAD export with **zero call sites** — irrelevant; do NOT touch it.

**Task 2 — "Strategy e8e55c08 has invalid config": runner version-skew + swallowed Zod error. The config is VALID; no config/schema change.**
- Confirmed via staging: run `3ec72a7c` failed at `2026-05-28T14:06:47` with `error_message = "Strategy e8e55c08-2f03-48c5-b598-d83768a700d3 has invalid config"`. The strategy ("Paragraph editing", created `14:04:42`) has a 2-iteration config: `generate` (seed, 20%) + `paragraph_recombine` (80%, paragraph knobs). It parses **OK against current origin/main's schema** (parse-test confirmed).
- `paragraph_recombine` entered the `agentType` enum in PR #1116 (commit `41cdbb9a`, the current HEAD of origin/main — just merged). Create-time (`createStrategyAction`) and run-time (`buildRunContext`) validation use the IDENTICAL `iterationConfigSchema`/enum. So a strategy created by the up-to-date Vercel wizard but executed by a RUNNER on older code (whose enum lacks `paragraph_recombine`) fails Zod enum validation (Zod REJECTS, does not strip) → generic "has invalid config".
- The real ZodError is swallowed at `evolution/src/lib/pipeline/setup/buildRunContext.ts:346-348` (`strategyConfigSchema.safeParse` → returns only the generic string; `configParsed.error` discarded). That string becomes `evolution_runs.error_message` via `claimAndExecuteRun.ts:303-306` → `markRunFailed` (truncates to 2000 chars). The EntityLogger is created at ~390, AFTER the parse. Only ONE such safeParse-swallow site exists in the pipeline.
- Fix = (a) DURABLE code fix: surface the Zod issues (`error.issues` mapped to `path: message`, capped) in the error string AND/OR a structured warn log at buildRunContext.ts; (b) OPERATIONAL: update the runner (`git pull origin main && npm ci && systemctl restart evolution-runner.timer`) so it gets the #1116 schema — then the SAME strategy re-runs fine. No code GUARD warranted (agent-type skew is intrinsically forward-incompatible — an old runner literally lacks the `ParagraphRecombineAgent` class; the existing `assertCostCalibrationPhaseEnumsMatch` guard covers DB-migration skew, not code skew).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Testing / Environment / Debugging (user-specified)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md (query:staging usage)

### Evolution Docs (all 21)
- README, architecture, data_model, agents/overview, paragraph_recombine, multi_iteration_strategies, strategies_and_experiments, arena, rating_and_comparison, cost_optimization, metrics, evolution_metrics, entities, variant_lineage, logging, visualization, criteria_agents, editing_agents, curriculum, minicomputer_deployment, reference

## Code Files Read
- `src/app/admin/evolution/strategies/new/page.tsx` — `isVariantProducing()` body/type mismatch (L159-167); `canBeFirstIteration()` omits paragraph_recombine (L173-178); first-iter validation message (L543); source-control JSX gated by `isVariantProducing && idx>0` (~L1215) with testids `source-mode-select-${idx}`/`cutoff-value-${idx}`/`cutoff-mode-${idx}`/`iteration-source-controls-${idx}`; `updateIteration` reducer already generic (L582-716); `toIterationConfigsPayload` (L200-204).
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema`; sourceMode/qualityCutoff refines (L672-679, reject only swiss/debate); first-iter pool lock (L~817); paragraph-knob refines (L751-761); `canBeFirstIteration` INCLUDES paragraph_recombine (L549-556); `isVariantProducingAgentType` EXCLUDES it and is unused (L562-568); agentType enum (L518-529, added paragraph_recombine in #1116).
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — L346-348 safeParse + swallowed ZodError (the legibility fix site); logger created ~L390.
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — L303-306 buildRunContext result → markRunFailed → error_message.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — resolveParent call site (L442-478) + paragraph_recombine dispatch branch (L527-540).
- `evolution/src/lib/pipeline/loop/resolveParent.ts` — topN/topPercent + seeded-random parent pick.
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` + `evolution/src/services/slotTopicActions.ts` — parentVariantId-keyed slot topics; no seed assumptions.
- `evolution/src/services/strategyRegistryActions.ts` — createStrategyAction uses the same iterationConfigSchema.
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` + `evolution/src/lib/pipeline/infra/estimateCosts.ts` — paragraph_recombine dispatch/cost projection (sourceMode-independent).
- `evolution/src/lib/core/startupAssertions.ts` — existing migration-skew guard (not applicable to code skew).
- Tests: `src/app/admin/evolution/strategies/new/page.test.tsx` (wizard unit; testids `source-mode-select-${idx}`, `cutoff-value-${idx}`, `cutoff-mode-${idx}`, `agent-type-select-${idx}`); `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` (E2E, pool-mode at idx 2); `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` (L121-131 asserts generic "invalid config"); `evolution/src/lib/schemas.test.ts` (no rejection-path test for unknown agentType yet).

## Key Findings
0. **Task 3 (NEW, prerequisite): `paragraph_recombine` never dispatches.** It's missing from the line-345 generate-family gate in `runIterationLoop.ts`, and there's no dedicated top-level branch — so the iteration is a silent no-op (confirmed by run `e26350f7`: 3 generate + 1 merge invocations, all iteration 1; iteration 2 produced zero invocations; run still `completed`). Fix = wire dispatch (recommended: add `paragraph_recombine` to the line-345 gate, the design-intended path proven by the existing `dispatchOneAgent` case at 527 + the working `proposer_approver_criteria_generate` analog). The shared `resolveParent()` in that branch (442-478) is ALSO what makes Task 1's sourceMode/qualityCutoff take effect at runtime — so Task 3 is the prerequisite that makes Task 1 actually do anything.
1. **Task 1 is wizard-only (UI gating), BUT only meaningful once Task 3 wires dispatch.** Schema + dispatch preview already accept pool-mode paragraph_recombine; the wizard blocker is `isVariantProducing()`'s body in `page.tsx`. The wizard fix lets users CHOOSE pool; Task 3's `resolveParent` call is what reads that choice at runtime.
2. **Minimal Task 1 change:** add `|| agentType === 'paragraph_recombine'` to `isVariantProducing()` body (L162-166) AND to `canBeFirstIteration()` body (L174-177); update first-iter message (L543). No schema change.
3. **Task 2 is NOT a bad config.** The config is valid on current code. Root cause = runner executing on pre-#1116 code; the run will succeed once the runner is updated. Confirmed by parse-test + git history (`41cdbb9a` = origin/main HEAD).
4. **Task 2 durable code fix = error legibility** at `buildRunContext.ts:346-348` (surface Zod issues + structured log). No guard, no schema change.
5. `isVariantProducingAgentType` (schema helper) is dead code; the wizard's `isVariantProducing` is independent (UI gating). Touching the wizard one is correct and safe.
6. Tests: extend `page.test.tsx` (paragraph_recombine renders source controls + emits sourceMode/qualityCutoff), `buildRunContext.test.ts` (legible error contains the field path), and optionally `schemas.test.ts` (lock the unknown-agentType issue-path contract). E2E: `admin-strategy-wizard.spec.ts`.

## Open Questions (mostly resolved)
- [x] Task 2 exact failing field → unknown `agentType` enum value (`paragraph_recombine`) on the OLD runner schema. Confirmed.
- [x] Task 2 emit site → `buildRunContext.ts:346-348`. Confirmed.
- [x] Task 1 wizard wiring → `isVariantProducing()` body (+ `canBeFirstIteration`). Confirmed.
- [x] Tasks 1 & 2 related? → Independent. Confirmed.
- [ ] DECISION for /planning: should the Task-2 legibility fix put the Zod issues in `error_message` (user-visible, capped) AND a structured log, or log-only? (Lean: both — concise message + structured log.)
- [ ] DECISION for /planning: Task 1 — also update the stale schema message at L673/676 to mention paragraph_recombine (accuracy), or leave it? (Lean: update for accuracy; trivial.)
- [ ] OPERATIONAL (out of band): the staging runner needs `git pull origin main && npm ci && restart` to clear the live invalid-config failures; can't be done from this repo — confirm with user / ops.
