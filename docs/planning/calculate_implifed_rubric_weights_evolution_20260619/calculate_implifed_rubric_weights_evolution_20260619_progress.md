<!-- Execution tracking for the implied-rubric-weights inference project. -->

# Calculate Implied Rubric Weights (Evolution) Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/calculate_implifed_rubric_weights_evolution_20260619` off `origin/main`.
- Read all 7 core workflow/ops docs + all 21 evolution docs + Judge Lab deep dive + white paper + design style guide.
- Created project skeleton (`_research.md`, `_planning.md`, `_progress.md`, `_status.json`) and a new deep-dive skeleton `evolution/docs/implicit_rubric_weights.md` with a doc-mapping entry.

### Issues Encountered
- The `initialize` skill expects evolution docs under `evolution/docs/evolution/`; they actually live at `evolution/docs/*.md` (21 files). Located and read them there.

### User Clarifications
- Project params supplied via the `/initialize` invocation (type=feature; read all standard + all evolution docs; summary + description provided). Design clarifications deferred to `/research`.

## Research + Proposal
### Work Done
- Ran 5 parallel research agents over the code to confirm integration seams: rubric/criteria CRUD shapes, Judge-Lab data-collection spine + seed-from-topic, admin Tools nav + page/server-action patterns, stats/math inventory + weight-consumption semantics, and migration/RLS/Zod/type conventions. Findings recorded in `_research.md`.
- Resolved the two design forks with the user: article pool = **arena-topic variants**; infer scope = **weights for an admin-chosen criteria set** (near-zero ⇒ "barely matters").
- Wrote the full proposal into `_planning.md` (new `evolution_weight_inference_*` tables, hand-rolled non-negative logistic fit + bootstrap CIs + sample-size preview, `adminAction` server actions, Tools-nav admin UI, export via `createJudgeRubricAction`).

### Issues Encountered
- Generated `src/lib/database.types.ts` lags local migrations (regen from remote) — new tables typed via hand-written Zod `Row`/`Insert` until `npm run db:types` after apply.

### User Clarifications
- Tool lives under the evolution admin "Tools" nav group; final inferred rubric saved via the existing `createJudgeRubricAction` (real `evolution_judge_rubrics` row).

## Phase 1: Migration + schemas + statistics core
### Work Done
[pending]

### Issues Encountered
[pending]

### User Clarifications
[pending]

## Phase 2: Server actions + persistence
[pending]

## Phase 3: Admin UI
[pending]

## Phase 4: Integration + docs + rollout
[pending]
