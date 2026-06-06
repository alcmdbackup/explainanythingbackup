# Tool Test Rewrite Prompts Evolution Progress

<!-- Execution tracking for the evolution admin rewrite-prompt playground. -->

## Phase 0: Initialization
### Work Done
- Created branch `feat/tool_test_rewrite_prompts_evolution_20260605` off `origin/main`.
- Read 7 core docs + all evolution docs.
- Scaffolded research / planning / progress docs and `_status.json`.
- Created `evolution/docs/prompt_playground.md` deep-dive skeleton + doc-mapping entry.

### Issues Encountered
[None]

### User Clarifications
- Rewrite prompt families in scope: **Generate tactics (24)** + **Paragraph recombine**.
- Create a new feature deep-dive doc: **Yes** (`evolution/docs/prompt_playground.md`).

## Research (multi-agent)
### Work Done
- Ran a 20-agent workflow (5 rounds × 4) on how to execute the tool. Findings folded into `_research.md` (Code Files Read + Workflow Research Findings) and `_planning.md` (file-by-file plan + design decisions + open questions).
- Verified key claims directly: sidebar nav is `src/components/admin/EvolutionSidebar.tsx` (Overview group); `createEvolutionLLMClient` `if (db && runId)` gate (line 233) ⇒ `db=null` skips analytics; GFPA `customPrompt:{preamble,instructions}` override (line 57/205).
- Chosen architecture: **ephemeral** (Option A) — `Agent.execute()` with `db=null`, standalone cost tracker, API route `maxDuration=300`, `Promise.allSettled`.

### Issues Encountered
- First workflow launch failed (`meta is not defined` — referenced `meta.phases` in the script body); fixed by using a local `PHASE_TITLES` array and re-ran.

## Plan Review
### Work Done
- `/plan-review`: 3 iterations → CONSENSUS 5/5/5 (Security/Architecture/Testing). Caught the false "no DB writes" premise, wrong `callLLM`/`calculateLLMCost` signatures, dead `LLMRefusalError` branch, redundant transport, and `setText=null`. All fixed + re-verified against source. See planning doc "Review & Discussion".

## Phase 1: Backend single-call harness
### Work Done
- `evolution/src/lib/playground/`: `types.ts`, `buildPlaygroundPrompt.ts`, `runPlaygroundConfig.ts`, `runPlayground.ts` + 3 unit test files (23 tests). Single `callLLM` per config; cost via `onUsage.estimatedCostUsd`; temperature clamp; display-only validation; error→status taxonomy; pre-flight $0.50 cap + `Promise.allSettled`.
- `src/app/api/evolution/playground/route.ts`: `maxDuration=300`, `EVOLUTION_PLAYGROUND_ENABLED` gate, `requireAdmin`, Zod (configs≤10, model∈getEvolutionModelIds, prompt-shape-matches-unit), 402/403/400 mapping.

### Issues Encountered
- callLLM takes `null` (not `undefined`) for setText/responseObj/responseObjName (validateStreamingArgs throws) — applied.

## Phase 2: Playground admin UI
### Work Done
- `src/app/admin/evolution/prompt-playground/page.tsx` + `loading.tsx`: unit toggle, shared source, editable config cards (preset/preamble+instructions or directive/model/temp), parallel Run all → fetch route, responsive results grid with status chips, per-config cost, format chips, `SideBySideWordDiff` vs source, copy.
- Linked from sidebar **Overview** group (`EvolutionSidebar.tsx`) + a card on `evolution-dashboard/page.tsx`.

### Issues Encountered
- design-system ESLint: replaced arbitrary `text-[10px]/[11px]` with `text-xs`, h1→text-4xl, non-heading label → div; tactic record indexing → `getTacticDef()`.

## Phase 3: Docs + tests + checks
### Work Done
- Integration test (real DB): ephemerality (zero evolution_* rows, scoped) + failure isolation — 2 passed.
- E2E `@evolution` (route-mocked): side-by-side outputs+cost, display-only format chip, temp disabled for o3-mini — 3 passed. Host-isolation 404 for page+route — 2 passed.
- Docs: filled `prompt_playground.md`; updated `visualization.md`, `reference.md`, `cost_optimization.md`.
- **Full check trio GREEN:** lint + typecheck + build all exit 0; build manifest includes the page + route; 23 playground unit + 2 integration pass.
