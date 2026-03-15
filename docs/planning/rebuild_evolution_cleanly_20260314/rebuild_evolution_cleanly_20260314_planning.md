# Rebuild Evolution Cleanly Plan

## Background
Rebuild the evolution pipeline into evolution V2. The goal is to do this incrementally using testable milestones, greatly simplifying the system and improving understanding of how it works.

## Requirements (from GH Issue #712)
Rebuild the evolution pipeline into evolution V2. Do this incrementally using testable milestones, so the system can be greatly simplified and better understood.

## Problem
The current evolution system is 123K LOC across 564 files with 14 agents (2 dead), 85 server actions, and 21 DB tables. The pipeline orchestrator alone is 904 LOC with 4-level nested try-catch. 56% of pipeline state fields are over-engineered (10/18 removable). The two-phase supervisor, hardcoded agent ordering, and dual in-place/immutable state API make the system hard to understand, debug, and extend. A V2 rebuild can reduce the core to ~1K LOC with a single function, local state, and helper functions.

## Key Design Decisions

### Decision 1: No Checkpointing (Short Runs)
V2 runs complete in one shot (<10 min). No checkpoint table, no serialization, no resume logic, no continuation_pending status. If a run crashes, re-run it — cost is <$1.

**What this eliminates:**
- `evolution_checkpoints` table writes
- `serializeState()` / `deserializeState()` (~150 LOC)
- `checkpoint_and_continue` RPC
- `continuation_pending` status + all continuation logic
- Watchdog checkpoint recovery path
- Resume logic in runner (~80 LOC)
- ComparisonCache persistence

**Constraint:** V2 runs must be fast enough to complete in one shot. Long runs (50 iterations) require the minicomputer runner (no timeout). Vercel cron (~13 min limit) works for V2's target of 3-10 iterations.

### Decision 2: One Function, Not Agent Classes
No AgentBase class, no ExecutionContext, no canExecute(), no estimateCost(), no PipelineAction union, no reducer. The pipeline is a single async function with helper functions for each phase (generate, rank, evolve). State is local variables in function scope.

**Cost tracking and timeline views are preserved** via labeled LLM calls and invocation rows:
```typescript
// Inside the evolve function body — no class needed:
const invId = await createInvocation(runId, iter, 'generation');
const variants = await generateVariants(topVariant, llm, 'generation');
await updateInvocation(invId, { cost: llm.lastCost, variantsAdded: variants.length });
```
The admin timeline tab reads from `evolution_agent_invocations` — it doesn't care whether a class or a function wrote those rows.

**What this eliminates:**
- `AgentBase` class, `canExecute()`, `estimateCost()`
- `ExecutionContext` type (14-field object passed to every agent)
- `PipelineAction` union (8 types), `reducer.ts`, `applyActions()`
- `PipelineStateImpl` class (18 fields, dual mutable/immutable API)
- Agent selection/toggling UI and budget redistribution
- `createDefaultAgents()` factory
- `AGENT_EXECUTION_ORDER` constant, `PoolSupervisor`

**What's preserved:**
- Per-phase cost tracking (via LLM call labels)
- Per-iteration timeline (via invocation rows with agent_name)
- Per-phase execution detail (via invocation execution_detail JSONB)
- Admin UI compatibility (same invocation table schema)

## Options Considered

### Option A: Refactor V1 In-Place
- **Cons**: High risk, can't simplify fundamental architecture

### Option B: V2 in Parallel Directory (CHOSEN)
- Build V2 in `evolution/src/lib/v2/`, V1 untouched
- Reuse proven modules (rating, comparison, format validation)
- **Pros**: Zero disruption, testable milestones, radical simplification

### Option C: Complete Rewrite
- **Cons**: Highest risk, loses battle-tested comparison/rating code

## Phased Execution Plan

### Milestone 1: Core Types + Reusable V1 Modules
**Goal**: Define minimal V2 types and verify V1 modules (rating, comparison, format validation) work standalone.

**Files to create**:
- `evolution/src/lib/v2/types.ts` (~120 LOC) — Minimal types: TextVariation (id, text, strategy, parentIds, iterationBorn, version), Rating, Match, EvolutionConfig (iterations, variantsPerRound, budgetUsd)

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/core/rating.ts` — createRating, updateRating, updateDraw, toEloScale (78 LOC)
- `evolution/src/lib/comparison.ts` — compareWithBiasMitigation, parseWinner (146 LOC)
- `evolution/src/lib/core/reversalComparison.ts` — run2PassReversal (40 LOC)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache (96 LOC)
- `evolution/src/lib/agents/formatValidator.ts` — validateFormat (89 LOC)
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES (15 LOC)
- `evolution/src/lib/core/textVariationFactory.ts` — createTextVariation (26 LOC)

**Test strategy**: Rerun V1 tests for all reused modules; write V2 type tests

**Done when**: V2 types defined; all reused V1 module tests pass; V2 can import and call compareWithBiasMitigation, updateRating, validateFormat, createTextVariation

**Depends on**: None

---

### Milestone 2: Helper Functions (Generate, Rank, Evolve)
**Goal**: Implement the three core helper functions as standalone, independently testable async functions.

**Files to create**:
- `evolution/src/lib/v2/generate.ts` (~100 LOC) — `generateVariants(text, llm, config): Promise<TextVariation[]>`
  - 3 strategies in parallel (structural_transform, lexical_simplify, grounding_enhance)
  - Calls validateFormat, createTextVariation
  - Prompt templates from V1 generationAgent.ts

- `evolution/src/lib/v2/rank.ts` (~200 LOC) — `rankPool(pool, ratings, matchCounts, llm, config): Promise<{matches, ratingUpdates}>`
  - Stratified opponent selection for new entrants (triage)
  - Swiss pairing for top contenders (fine-ranking)
  - Uses compareWithBiasMitigation from V1
  - Budget-aware: stops when cost limit approached

- `evolution/src/lib/v2/evolve.ts` (~120 LOC) — `evolveVariants(pool, ratings, llm, config): Promise<TextVariation[]>`
  - Select top-rated parents
  - Mutate (clarity, structure) + crossover
  - Optional creative exploration trigger
  - Calls validateFormat, createTextVariation

**Files to reuse from V1**: Prompt templates, Swiss pairing logic, opponent selection

**Test strategy**: Test each function independently with mock LLM. Test generate produces 3 variants. Test rank updates ratings correctly. Test evolve produces children from parents.

**Done when**: Each function works standalone with mocked LLM; unit tests pass; functions compose correctly (generate output feeds into rank)

**Depends on**: Milestone 1

---

### Milestone 3: The Main Function + Cost Tracking
**Goal**: Implement the single `evolveArticle()` function that orchestrates generate→rank→evolve in a flat loop, with per-phase cost tracking and invocation logging.

**Files to create**:
- `evolution/src/lib/v2/evolve-article.ts` (~200 LOC) — The core function:
  ```typescript
  async function evolveArticle(
    originalText: string,
    llm: EvolutionLLMClient,
    db: SupabaseClient,
    runId: string,
    config: { iterations: number; variantsPerRound: number; budgetUsd: number }
  ): Promise<{ winner: TextVariation; pool: TextVariation[]; totalCost: number }>
  ```
  - Local state: `pool` array, `ratings` Map, `matchHistory` array
  - Loop body: generate → rank → evolve (calling M2 helpers)
  - Per-phase invocation logging: `createInvocation()` / `updateInvocation()`
  - Budget check after each phase
  - Kill detection: check run status from DB at iteration boundary

- `evolution/src/lib/v2/cost-tracker.ts` (~60 LOC) — Simple cost accumulator
  - `recordCost(phase, amount)`, `getTotalCost()`, `getPhaseCosts()`
  - No reservations, no FIFO queue — just accumulate

- `evolution/src/lib/v2/invocations.ts` (~50 LOC) — Invocation row helpers
  - `createInvocation(runId, iteration, phaseName)` → UUID
  - `updateInvocation(id, { cost, variantsAdded, matchesPlayed, executionDetail })`

**Test strategy**: End-to-end smoke test with mock LLM: seed → 2 iterations → verify pool grows, ratings converge, cost tracked per phase, invocation rows created. Test budget exhaustion stops early. Test kill detection.

**Done when**: `evolveArticle()` completes a 3-iteration run with mocked LLM; invocation rows written correctly; cost tracking accurate per phase; budget exhaustion works

**Depends on**: Milestone 2

---

### Milestone 4: Runner Integration
**Goal**: Wire `evolveArticle()` into the run execution lifecycle (claim, execute, persist results).

**Files to create**:
- `evolution/src/lib/v2/runner.ts` (~150 LOC)
  - `executeV2Run(runId, supabase, llmClient)` — Claim → resolve content → call evolveArticle → persist results
  - Heartbeat (30s interval via setInterval, cleared in finally)
  - Error handling → markRunFailed with error message
  - On success: persist winner + pool to evolution_variants, update evolution_runs (completed, cost, summary)
  - No checkpointing, no resume logic

- `evolution/src/lib/v2/index.ts` (~60 LOC) — Barrel export:
  - `evolveArticle`, `executeV2Run`
  - Types: TextVariation, EvolutionConfig, etc.
  - Re-exports of V1 modules (rating, comparison, etc.)

**Files to reuse from V1**:
- `claim_evolution_run` RPC (unchanged)
- Heartbeat pattern from evolutionRunnerCore.ts
- `persistVariants()` from persistence.ts (or simplified version)

**Test strategy**: Mock claim RPC; mock LLM; test full lifecycle: claim → evolveArticle → persist variants → mark completed. Test error → markRunFailed. Test heartbeat fires.

**Done when**: V2 run claimed via RPC, executed, winner persisted to evolution_variants, run marked completed; watchdog compatible (heartbeat updates)

**Depends on**: Milestone 3

---

### Milestone 5: Admin UI Compatibility
**Goal**: V2 runs visible in existing admin pages without any UI changes.

**Files to create**:
- `evolution/src/lib/v2/finalize.ts` (~100 LOC) — Persist V2 results in V1-compatible format
  - Build `run_summary` JSONB matching V1 EvolutionRunSummary schema
  - Persist all variants with ratings to evolution_variants
  - Write per-agent cost metrics to evolution_run_agent_metrics (from invocation rows)

**Files to modify** (minimal):
- `evolution/src/services/evolutionRunnerCore.ts` — Add V2 routing: if `pipeline_version === 'v2'`, call `executeV2Run`

**Test strategy**: Create V2 run → execute → verify appears in admin runs list; verify run detail page loads; verify timeline tab shows per-phase invocations; E2E with real admin pages

**Done when**: V2 run appears in `/admin/evolution/runs`; detail page shows timeline with generation/ranking/evolution phases; cost breakdown visible; no UI code changes needed

**Depends on**: Milestone 4

---

### Milestone 6: Proximity + Reflection (Optional Phases)
**Goal**: Add diversity tracking and quality critique as optional helper functions called within the main loop.

**Files to create**:
- `evolution/src/lib/v2/proximity.ts` (~80 LOC) — `computeDiversity(pool): number`
  - Lexical trigram similarity across top-10 variants
  - Returns single diversity score (0-1)

- `evolution/src/lib/v2/reflect.ts` (~100 LOC) — `critiqueTopVariants(pool, ratings, llm): Promise<CritiqueResult>`
  - Critique top 3 variants on quality dimensions
  - Results stored in invocation execution_detail (not pipeline state)
  - Optional: feed critique into next generation prompt

**Test strategy**: Unit test proximity with known-similar texts. Unit test reflection with mock LLM critique response.

**Done when**: Main loop optionally calls proximity and reflect; diversity score logged; critique appears in invocation detail

**Depends on**: Milestone 3

## V2 File Structure (Final)

```
evolution/src/lib/v2/
├── types.ts              (120 LOC)  — Minimal types
├── generate.ts           (100 LOC)  — Generate variants helper
├── rank.ts               (200 LOC)  — Rank pool helper
├── evolve.ts             (120 LOC)  — Evolve/mutate helper
├── evolve-article.ts     (200 LOC)  — THE main function
├── cost-tracker.ts       (60 LOC)   — Simple cost accumulator
├── invocations.ts        (50 LOC)   — Invocation row helpers
├── runner.ts             (150 LOC)  — Claim/execute/persist lifecycle
├── finalize.ts           (100 LOC)  — V1-compatible result persistence
├── proximity.ts          (80 LOC)   — Diversity tracking (optional)
├── reflect.ts            (100 LOC)  — Quality critique (optional)
├── index.ts              (60 LOC)   — Barrel export
└── __tests__/
    ├── generate.test.ts
    ├── rank.test.ts
    ├── evolve.test.ts
    ├── evolve-article.test.ts  — Smoke test
    ├── runner.test.ts
    └── finalize.test.ts
Total: ~1,340 LOC production + ~1,000 LOC tests
```

## V1 Modules Reused Directly (No Changes)

| Module | LOC | Why reusable |
|--------|-----|-------------|
| rating.ts | 78 | Pure OpenSkill wrapper, zero coupling |
| comparison.ts | 146 | Takes callLLM callback, cache optional |
| reversalComparison.ts | 40 | Generic 2-pass framework |
| comparisonCache.ts | 96 | Standalone LRU cache |
| formatValidator.ts | 89 | Pure string validation |
| formatRules.ts | 15 | String constant |
| textVariationFactory.ts | 26 | UUID factory, no deps |
| **Total reused** | **~490** | |

## What V2 Eliminates vs V1

| V1 Concept | LOC | V2 Replacement |
|------------|-----|---------------|
| AgentBase class + 14 subclasses | 4,500 | Helper functions (~420 LOC) |
| PipelineStateImpl (18 fields) | 320 | Local variables in function scope |
| PipelineAction union + reducer | 160 | Direct mutations on local arrays/maps |
| PoolSupervisor + phase transitions | 213 | Flat for-loop |
| Pipeline orchestrator | 904 | evolve-article.ts (~200 LOC) |
| Checkpoint/resume/continuation | 350 | Eliminated (short runs, re-run on crash) |
| ExecutionContext | 100 | Function parameters |
| Agent invocation lifecycle | 200 | Simple createInvocation/updateInvocation |
| **Total eliminated** | **~6,750** | **~1,340 LOC total** |

## Coexistence Strategy

1. V2 code lives in `evolution/src/lib/v2/` — V1 completely untouched
2. Runner routes via `pipeline_version` field on evolution_runs (`'v1'` or `'v2'`)
3. Same DB tables — V2 writes to same evolution_runs, evolution_variants, evolution_agent_invocations
4. Admin UI shows both V1 and V2 runs without modification (same invocation schema)
5. Rollback: set `pipeline_version = 'v1'` for pending V2 runs

## Testing

### Reusable V1 Tests (~40%)
- rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts

### New V2 Tests (per milestone)
- M1: V2 types compile; reused V1 module tests pass
- M2: Each helper function tested independently with mock LLM
- M3: End-to-end smoke test (seed → 2 iterations → winner); cost tracking; invocations
- M4: Full lifecycle test (claim → execute → persist → complete)
- M5: V2 run appears in admin UI
- M6: Diversity + critique integration

### Smoke Test
2-iteration mini pipeline with mock LLM: seed article → generate 3 → rank → evolve 2 → generate 3 more → rank → verify winner identified, costs tracked, invocations logged

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| V1 run loss during migration | High | Pre-migration queue drain + runner tagging |
| No checkpointing = lost work on crash | Low | Runs are <$1 and <10 min; just re-run |
| Dual runner claiming | Medium | Runner ID prefixes (v1-*, v2-*) |
| Feature gaps (debate, editing, tree search) | Medium | Phase in as helpers after core V2 stable |
| Rollback needed | High | Keep V1 frozen; feature flag EVOLUTION_USE_V2 |
| Admin UI incompatibility | Low | Same invocation/variant tables; V1-compatible summary |

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Pipeline is now one function, not supervisor+agents
- `evolution/docs/evolution/data_model.md` - State is local variables, not PipelineStateImpl
- `evolution/docs/evolution/entity_diagram.md` - Same entities, simpler relationships
- `evolution/docs/evolution/reference.md` - Config is 3 fields, not 15+
- `evolution/docs/evolution/rating_and_comparison.md` - Reused as-is, doc unchanged
- `evolution/docs/evolution/README.md` - Needs V2 section
- `evolution/docs/evolution/arena.md` - Deferred to V2.1
- `evolution/docs/evolution/experimental_framework.md` - Deferred to V2.2
- `evolution/docs/evolution/curriculum.md` - V2 learning path (much simpler)
- `evolution/docs/evolution/visualization.md` - V2 runs use existing components
