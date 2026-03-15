# Rebuild Evolution Cleanly Plan

## Background
Rebuild the evolution pipeline into evolution V2. The goal is to do this incrementally using testable milestones, greatly simplifying the system and improving understanding of how it works.

## Requirements (from GH Issue #712)
Rebuild the evolution pipeline into evolution V2. Do this incrementally using testable milestones, so the system can be greatly simplified and better understood.

## Problem
The current evolution system is 123K LOC across 564 files with 14 agents (2 dead), 85 server actions, and 21 DB tables. The pipeline orchestrator alone is 904 LOC with 4-level nested try-catch. 56% of pipeline state fields are over-engineered (10/18 removable). The two-phase supervisor, hardcoded agent ordering, and dual in-place/immutable state API make the system hard to understand, debug, and extend. A V2 rebuild can reduce the core to ~2K LOC with 5 agents, 7 state fields, and a flat orchestration loop.

## Options Considered

### Option A: Refactor V1 In-Place
- Incrementally simplify pipeline.ts, remove dead code, clean up state
- **Pros**: No migration, no coexistence complexity
- **Cons**: High risk of breaking production runs, hard to test increments, can't simplify fundamental architecture (class-based agents, supervisor pattern)

### Option B: V2 in Parallel Directory (CHOSEN)
- Build V2 in `evolution/src/lib/v2/`, V1 untouched
- Reuse proven modules (rating, comparison, format validation)
- Route new runs to V2 via `pipeline_version` field
- **Pros**: Zero disruption, testable at each milestone, clean architecture
- **Cons**: Temporary code duplication, need coexistence adapter

### Option C: Complete Rewrite
- Start from scratch, new directory, new DB schema
- **Pros**: Cleanest architecture
- **Cons**: Highest risk, longest timeline, loses battle-tested comparison/rating code

## Phased Execution Plan

### Milestone 1: Types & Minimal State
**Goal**: Define V2 core types and minimal state container with 7 essential fields.

**Files to create**:
- `evolution/src/lib/v2/types.ts` (~200 LOC) — V2 types: TextVariation, Match, Rating, AgentFunction, ExecutionContext, AgentResult
- `evolution/src/lib/v2/state.ts` (~150 LOC) — PipelineStateV2 with pool, ratings, matchHistory, iteration, originalText, poolIds, matchCounts

**Files to reuse from V1**:
- `evolution/src/lib/core/rating.ts` — OpenSkill operations (78 LOC, pure functions)

**Test strategy**: Unit test state immutability, getTopByRating, serialization round-trip, checkpoint hydration

**Done when**:
- V2 state creates from scratch + from checkpoint JSON
- All getters pass unit tests
- State serialization/deserialization round-trip preserves all data

**Depends on**: None

---

### Milestone 2: Rating & Comparison (Reuse from V1)
**Goal**: Integrate proven rating and comparison modules wholesale.

**Files to create**:
- `evolution/src/lib/v2/comparison.ts` (~80 LOC) — Thin wrapper for V2 context

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/core/rating.ts` — createRating, updateRating, updateDraw, isConverged, toEloScale
- `evolution/src/lib/comparison.ts` — buildComparisonPrompt, parseWinner, compareWithBiasMitigation
- `evolution/src/lib/core/reversalComparison.ts` — run2PassReversal (2-pass bias mitigation)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache (SHA-256 LRU)

**Test strategy**: Rerun V1 rating + comparison tests (40% of test suite); verify integration with V2 state

**Done when**: All reused tests pass; V2 agents can call compareWithBiasMitigation and updateRating

**Depends on**: Milestone 1

---

### Milestone 3: Format Validation & Text Variation Factory (Reuse from V1)
**Goal**: Reuse proven format validation and variant creation.

**Files to create**:
- `evolution/src/lib/v2/textVariation.ts` (~40 LOC) — Wrapper for createTextVariation factory

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/agents/formatValidator.ts` — validateFormat (89 LOC, zero V1 coupling)
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES constant
- `evolution/src/lib/core/textVariationFactory.ts` — createTextVariation factory (26 LOC)

**Test strategy**: Rerun V1 format validator tests; test variant creation with parent tracking

**Done when**: Generation agent can validate text and create variants; all reused tests pass

**Depends on**: Milestone 1

---

### Milestone 4: Generation Agent (Function-based)
**Goal**: Implement generation as pure async function producing 3 variants per iteration.

**Files to create**:
- `evolution/src/lib/v2/agents/generation.ts` (~250 LOC)
  - Signature: `async (ctx: V2ExecutionContext) => AgentResult`
  - 3 strategies: structural_transform, lexical_simplify, grounding_enhance (parallel)
  - Calls validateFormat, createTextVariation
  - Returns ADD_TO_POOL actions

**Files to reuse from V1**: Prompt templates from generationAgent.ts, mock patterns from generationAgent.test.ts

**Test strategy**: Mock LLM (3 responses), test format validation rejection + retry, test budget exhaustion mid-stream

**Done when**: Generation function produces 3 valid variants; unit tests pass with mocked LLM

**Depends on**: Milestones 1–3

---

### Milestone 5: Ranking Agent (Function-based)
**Goal**: Implement unified ranking (triage + Swiss fine-ranking) as pure function.

**Files to create**:
- `evolution/src/lib/v2/agents/ranking.ts` (~600 LOC)
  - Triage: stratified opponent selection, adaptive early exit
  - Fine-ranking: Swiss pairing by outcome uncertainty × sigma
  - Budget pressure tiers (low/med/high → max comparison caps)
  - Draw detection (confidence < 0.3)
  - Returns RECORD_MATCHES actions with rating updates

**Files to reuse from V1**: Swiss pairing algorithm, budget pressure config, comparison calls

**Test strategy**: Mock comparisons (A/B/TIE), test Swiss pairing info value, test budget tiers, test convergence

**Done when**: Ranking function runs triage + fine-ranking, produces correct rating updates; integration test: 10 variants → converged ratings

**Depends on**: Milestones 1–3

---

### Milestone 6: Pipeline Orchestrator (Flat Loop + Checkpointing)
**Goal**: Implement minimal orchestration loop (~120 LOC) with checkpointing and resume.

**Files to create**:
- `evolution/src/lib/v2/pipeline.ts` (~150 LOC) — Flat for-loop, no supervisor
  - Loop: for each iteration → run agents sequentially → apply actions → checkpoint
  - Timeout checks at iteration and agent boundaries
  - Budget exhaustion → graceful stop
  - Kill detection via DB status check
- `evolution/src/lib/v2/reducer.ts` (~70 LOC) — Pure state reducer (3 action types: MUTATE_POOL, UPDATE_RANKINGS, RECORD_EXECUTION)
- `evolution/src/lib/v2/checkpoint.ts` (~100 LOC) — Serialize/deserialize, persist to DB, load for resume
- `evolution/src/lib/v2/costTracker.ts` (~80 LOC) — Reserve-before-spend, per-agent attribution
- `evolution/src/lib/v2/llmClient.ts` (~100 LOC) — EvolutionLLMClient wrapper with cost integration
- `evolution/src/lib/v2/logger.ts` (~50 LOC) — Structured logging

**Test strategy**: Mock agents returning actions; test 3-iteration loop; test checkpoint/resume round-trip; test budget exhaustion; smoke test (seed → generate → rank → checkpoint → resume → complete)

**Done when**: Full 3-iteration pipeline completes with mocked agents; checkpoint/resume works; budget tracking accurate

**Depends on**: Milestones 4, 5

---

### Milestone 7: Runner Integration (Claim, Execute, Heartbeat)
**Goal**: Integrate V2 pipeline with run execution lifecycle.

**Files to create**:
- `evolution/src/lib/v2/integration.ts` (~200 LOC)
  - claimV2Run → claim_evolution_run RPC
  - executeV2Run → wraps executeV2Pipeline
  - Heartbeat (30s interval)
  - Run completion → persist variants, summary

**Files to reuse from V1**: evolutionRunnerCore.ts patterns, persistence.ts (persistVariants), claim RPC

**Test strategy**: Mock claim RPC; test full lifecycle (claim → 3 iterations → complete → persist); test heartbeat; test error → markRunFailed

**Done when**: V2 run claimed, executed, completed, persisted; existing V1 watchdog compatible

**Depends on**: Milestone 6

---

### Milestone 8: Admin UI Compatibility
**Goal**: V2 runs visible in existing admin pages without UI changes.

**Files to create**:
- `evolution/src/lib/v2/uiAdapter.ts` (~100 LOC) — V2 state → V1-compatible summary projection

**Test strategy**: Test projection preserves top variants, cost, match count; E2E test V2 run appears in admin UI

**Done when**: V2 run appears in `/admin/evolution/runs` list; detail page loads V2 data; no schema changes needed

**Depends on**: Milestone 7

## V2 File Structure (Final)

```
evolution/src/lib/v2/
├── types.ts                (200 LOC)
├── state.ts                (150 LOC)
├── comparison.ts           (80 LOC)
├── textVariation.ts        (40 LOC)
├── reducer.ts              (70 LOC)
├── costTracker.ts          (80 LOC)
├── llmClient.ts            (100 LOC)
├── logger.ts               (50 LOC)
├── checkpoint.ts           (100 LOC)
├── pipeline.ts             (150 LOC)
├── integration.ts          (200 LOC)
├── uiAdapter.ts            (100 LOC)
├── agents/
│   ├── generation.ts       (250 LOC)
│   └── ranking.ts          (600 LOC)
├── index.ts                (130 LOC)
└── __tests__/
    ├── state.test.ts
    ├── generation.test.ts
    ├── ranking.test.ts
    ├── pipeline.test.ts
    ├── integration.test.ts
    └── smoke.test.ts
Total: ~2,300 LOC production + ~1,500 LOC tests
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

## Coexistence Strategy

1. V2 code lives in `evolution/src/lib/v2/` — V1 completely untouched
2. Runner routes via `pipeline_version` field on evolution_runs (`'v1'` or `'v2'`)
3. Same DB tables — V2 writes to same evolution_runs, evolution_variants, etc.
4. Admin UI shows both V1 and V2 runs without modification
5. Rollback: set `pipeline_version = 'v1'` for pending V2 runs

## Testing

### Reusable V1 Tests (~40%)
- rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts

### New V2 Tests (per milestone)
- M1: State immutability, hydration, serialization
- M2: Rating integration (reuse V1 tests)
- M3: Format validation integration (reuse V1 tests)
- M4: Generation agent mocks, budget exhaustion
- M5: Swiss pairing, budget tiers, draw handling
- M6: Pipeline loop, checkpoint/resume, convergence
- M7: Claim/execute/complete lifecycle
- M8: V1 projection, UI rendering

### Smoke Test
2-iteration mini pipeline: seed → generate 3 → rank → checkpoint → resume → generate 3 more → rank → verify winner identified

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| V1 run loss during migration | High | Pre-migration queue drain + runner tagging |
| Checkpoint incompatibility | Medium-High | Block cross-version resume; version marker in checkpoints |
| Dual runner claiming | Medium | Runner ID prefixes (v1-*, v2-*) |
| Mid-iteration data loss (per-iter checkpoint) | Medium | Accept ~5 min worst-case replay; add per-agent checkpoint later if needed |
| Feature gaps (debate, editing agents) | Medium | Phase in after core V2 stable; communicate to users |
| Rollback needed | High | Keep V1 frozen; feature flag EVOLUTION_USE_V2 |

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Pipeline orchestration changes significantly (flat loop replaces supervisor)
- `evolution/docs/evolution/data_model.md` - State model simplified (7 fields instead of 18)
- `evolution/docs/evolution/entity_diagram.md` - Same entities, simpler relationships
- `evolution/docs/evolution/reference.md` - Config, key files will change
- `evolution/docs/evolution/rating_and_comparison.md` - Reused as-is, doc unchanged
- `evolution/docs/evolution/README.md` - Overview and reading order will need V2 section
- `evolution/docs/evolution/arena.md` - Deferred to V2.1
- `evolution/docs/evolution/experimental_framework.md` - Deferred to V2.2
- `evolution/docs/evolution/curriculum.md` - Will need V2 learning path
- `evolution/docs/evolution/visualization.md` - V2 runs use existing components via uiAdapter
