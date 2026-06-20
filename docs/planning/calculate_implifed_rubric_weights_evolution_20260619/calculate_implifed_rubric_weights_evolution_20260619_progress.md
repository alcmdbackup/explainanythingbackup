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

## Phase 1: Migration + schemas + stats core — DONE (252233bda)
Migration `20260619000001` (5 tables + auto columns, RLS, is_test trigger, canonical CHECK, indexes) — idempotency-lint clean. Zod Insert/Row schemas. `evolution/src/lib/weightInference/` (verdicts/fit/ci/sampleSize/audit) with 32 unit tests incl. fast-check. lint+tsc+build green.

## Phase 2: Server actions + persistence — DONE (7703247bf)
`weightInferenceActions.ts` (create+seed+materialize, list, preview, getNextPair overall-first/criteria-gated, recordOverall/recordDimensionVerdicts canonical flip-on-save, getFit, exportRubric). rater_id server-derived; kill switch. Integration test (guard-skips until tables migrated; CI-verified).

## Phase 3: Human-mode admin UI + Tools nav — DONE (21e542b53)
Tools nav entry; `/admin/evolution/weight-inference` landing (new-session form + live preview) + `[sessionId]` detail (Judge overall→criteria, Results, export). Midnight Scholar tokens; testids. Both routes compile.

## Phase 4: Docs + E2E (human mode) — DONE (20df82334)
Filled `implicit_rubric_weights.md`; updated data_model/reference/visualization. E2E nav+form spec. tsc/lint/stale-specs green.

## Phase 5: Auto mode (LLM-as-judge) — DONE (9525676ef)
`autoJudge` (2-pass holistic + rubric via injected judge, foldRepeats), `autoCost` (cap + kill switch), `autoRun` (resumable idempotent chunk), API route `/api/evolution/weight-inference/auto-run`, mode-aware create + progress action, UI mode toggle + Run tab. CI env wiring + host-isolation 404. 11 auto unit tests + auto integration block (fake judge, zero real LLM, idempotent) + auto E2E toggle. lint+tsc+build+unit+integration+stale-specs green.

### Issues Encountered
- `noUncheckedIndexedAccess` is on — numeric inner loops needed non-null assertions.
- Generated `database.types.ts` lags the new migration → typed Supabase client returns `never` rows for the new tables; resolved with hand-written Zod row types + `as unknown as` casts at query sites until `db:types` regenerates post-deploy.
- `flipWinner`/`AllowedLLMModelType` not exported from their modules → inlined a local flip + used `Parameters<typeof callLLM>[3]`.
- Integration + E2E full create→judge→export flows are CI-verified (need the migration applied to the dev DB + the test-content filter hides UI-seeded topics); covered by the integration test's real-DB path. Local runs guard-skip cleanly.
