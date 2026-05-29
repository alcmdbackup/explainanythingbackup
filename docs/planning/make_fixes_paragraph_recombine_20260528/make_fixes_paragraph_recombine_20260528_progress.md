# Make Fixes Paragraph Recombine Progress

Plan reached 5/5 consensus (plan-review iteration 4). All three tasks implemented.

## Phase 1: Task 3 — dedicated paragraph_recombine dispatch branch (PREREQUISITE)
### Work Done
- Added a dedicated `else if (iterType === 'paragraph_recombine')` branch in
  `runIterationLoop.ts` (sibling to swiss, modeled on the debate branch): resolves ONE
  parent via `resolveParent()` (honoring `sourceMode`/`qualityCutoff`), dispatches ONE
  `ParagraphRecombineAgent`, feeds the agent's returned `matches` + `newVariants:[recombined]`
  to `MergeRatingsAgent`. Records snapshot pushing both `eloHistory` + `uncertaintyHistory`;
  honors the `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` kill switch; budget path handled
  via both the returned `budgetExceeded` flag and an `IterationBudgetExceededError` try/catch.
- `ParagraphRecombineAgent` now article-ranks the recombined variant in-agent via
  `rankNewVariant` (using `input.llm` → `ranking_cost`) at Step 6 and returns the `matches`;
  `ParagraphRecombineInput` extended with `initialPool`/`initialRatings`/`initialMatchCounts`/`cache`.
- `MergeRatingsAgent.iterationType` TS union extended with `'paragraph_recombine'`
  (Zod + snapshot enums already included it).
- Removed the dead/incorrectly-placed L527 dispatch case from `dispatchOneAgent`.
- Fixed the now-stale `ParagraphRecombineOutput.matches` JSDoc (it claimed matches are always
  empty and never flow through MergeRatingsAgent — both no longer true).

### Issues Encountered
- The dispatch branch + agent ranking + MergeRatings wiring + most tests were committed in
  `29a94e27` by the prior session, which hit API errors before finishing the test gaps,
  progress doc, and full verification. This session closed the remaining gaps.

## Phase 2: Task 1 — expose top-N pool selection in the wizard
### Work Done
- `isVariantProducing()` and `canBeFirstIteration()` bodies in
  `src/app/admin/evolution/strategies/new/page.tsx` now include `paragraph_recombine`;
  first-iteration validation message + stale `schemas.ts` sourceMode/qualityCutoff refine
  messages reworded for accuracy (committed in `29a94e27`).
- Doc updates (architecture, paragraph_recombine, multi_iteration_strategies,
  strategies_and_experiments) verified accurate; one stale "first iteration is generate"
  line in multi_iteration_strategies.md corrected this session.

## Phase 3: Task 2 — make the "invalid config" error legible
### Work Done
- `buildRunContext.ts` now surfaces the first ~3 Zod issues (`path: message`, length-capped)
  in the returned "...has invalid config: ..." string (committed in `29a94e27`).
- Operational unblock (runner behind origin/main) handled by user; no code action.

## Tests
- `runIterationLoop.test.ts` — dispatch+merge regression guard + kill-switch (committed).
- `page.test.tsx` — pool-mode controls+payload (committed) + NEW: first-iteration
  paragraph_recombine passes validation. 25/25 pass.
- `buildRunContext.test.ts` — legible-error field-path test (committed). Pass.
- `schemas.test.ts` — NEW (optional contract lock): unknown agentType rejected with
  `iterationConfigs.0.agentType` path. 195/195 pass.
- E2E `admin-strategy-wizard.spec.ts` — NEW: builds [generate, paragraph_recombine], sets
  the recombine row to pool + top-N cutoff, asserts persisted config carries
  `sourceMode:'pool'` + `qualityCutoff`. Passed (33s).

## Verification
- `npm run typecheck` — clean.
- `npm run lint` — clean (only pre-existing design-token/unused-disable warnings); `check:stale-specs` clean.
- Unit: wizard (25), schemas (195), loop+buildRunContext+agent (71) — all green.
- E2E: new paragraph_recombine pool-mode case — green.
- Remaining for /finalize: full unit suite + build + integration + E2E critical/evolution before PR.

## Tooling note
- `.claude/settings.json` PostToolUse matcher updated from `TodoWrite` to
  `TodoWrite|TaskCreate|TaskUpdate` so the prerequisite tracker (which already supported
  `TaskCreate`) fires under this harness's task tools. Takes effect on next session reload.
