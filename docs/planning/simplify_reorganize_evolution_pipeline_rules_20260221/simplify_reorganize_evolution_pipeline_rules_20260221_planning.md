# Simplify Reorganize Evolution Pipeline Rules Plan

## Background
The evolution pipeline's PoolSupervisor currently manages complex phase transitions (EXPANSION→COMPETITION), multi-layered config validation, and agent gating logic that has grown organically. This project simplifies and reorganizes the supervisor's phase management, config validation (`validateStrategyConfig`, `validateRunConfig`, `resolveConfig`), and the rules governing which agents run when. The goal is to reduce complexity while preserving correctness, making the pipeline easier to understand, test, and extend.

## Requirements (from GH Issue #503)
- Simplify how the supervisor works with COMPETITION and EXPANSION phases
- Simplify config validations (`validateStrategyConfig`, `validateRunConfig`, `resolveConfig`)
- Reorganize the rules governing agent gating and phase transitions

## Problem
Three research passes identified dead code, duplicated validation, and a design-reality gap in strategy rotation across the pipeline rules system. `PhaseConfig` returns 4 fields but only 2 are consumed. `expansion.minIterations` exists in the type system but was never wired into phase detection. Four identical constraint checks are duplicated between `validateRunConfig` and `PoolSupervisor.validateConfig`. The supervisor implements per-iteration strategy rotation in COMPETITION phase, but GenerationAgent always runs all 3 strategies in parallel regardless.

## Options Considered
1. **Bottom-up** — Remove dead code leaf-by-leaf first, then simplify structure. Each step smaller but more total churn.
2. **Top-down (chosen)** — Simplify PhaseConfig first (removes 3 dead concepts at once), then clean dead fields, then consolidate validation. Fewer total file touches, conceptually coherent phases.

## Phased Execution Plan

### Phase 1: Simplify PhaseConfig and Remove Strategy Rotation
- Simplify `PhaseConfig` to `{phase, activeAgents}` only
- Remove `generationPayload`, `calibrationPayload`, `_strategyRotationIndex`
- Remove rotation logic from `beginIteration()` and `transitionToCompetition()`
- Remove `strategyRotationIndex` from `SupervisorResumeState`
- Keep `GENERATION_STRATEGIES` constant (still used by GenerationAgent)
- Files: supervisor.ts, supervisor.test.ts, pipeline.ts, types.ts

### Phase 2: Remove Dead Config Fields
- Remove `expansion.minIterations` from types, defaults, and ~13 test configs
- Keep `generation.strategies` (CostEstimator reads it)
- Files: types.ts, config.ts, strategyConfig.ts, ~5 test files

### Phase 3: Consolidate Validation
- Remove 4 duplicated checks from `PoolSupervisor.validateConfig()`
- Keep `validateRunConfig` as single source of truth
- Keep `resolveConfig` auto-clamping
- Files: supervisor.ts, supervisor.test.ts, config.ts

### Phase 4: Update Tests and Documentation
- Verify all remaining tests pass
- Remove tests for deleted behavior (~20-25 tests)
- Update 3 evolution docs: architecture.md, reference.md, agents/overview.md

## Testing
- Run full test suite after each phase to catch regressions
- ~20-25 tests will be removed (assert deleted behavior)
- ~80-85 tests unchanged (cover surviving behavior)
- Add 1-2 tests confirming simplified PhaseConfig shape
- No integration/E2E tests needed (no behavioral changes)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Remove PhaseConfig payload references, strategy rotation
- `evolution/docs/evolution/reference.md` - Remove `expansion.minIterations` from config reference
- `evolution/docs/evolution/agents/overview.md` - Simplify agent gating description
- `docs/plans/2026-02-21-simplify-pipeline-rules-design.md` - Full design doc

---

## Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove dead code (PhaseConfig payloads, strategy rotation, `expansion.minIterations`) and consolidate duplicated validation in the evolution pipeline rules system.

**Architecture:** Top-down simplification: simplify the supervisor's `PhaseConfig` return type first (which cascades payload and rotation removal), then clean dead config fields, then remove duplicated validation. Zero behavioral changes — every change removes code that was already dead or duplicated.

**Tech Stack:** TypeScript (strict mode), Jest tests, evolution pipeline subsystem

---

### Task 1: Simplify PhaseConfig interface and supervisor methods

**Files:**
- Modify: `evolution/src/lib/core/supervisor.ts:18-25` (PhaseConfig interface)
- Modify: `evolution/src/lib/core/supervisor.ts:27-33` (SupervisorResumeState)
- Modify: `evolution/src/lib/core/supervisor.ts:107-224` (PoolSupervisor class)

**Step 1: Edit `PhaseConfig` interface — remove payload fields**

In `evolution/src/lib/core/supervisor.ts`, replace the `PhaseConfig` interface (lines 18-25) with:

```typescript
/** Phase configuration returned by getPhaseConfig(). */
export interface PhaseConfig {
  phase: PipelinePhase;
  /** Ordered list of agents to run this iteration. */
  activeAgents: ExecutableAgent[];
}
```

**Step 2: Remove `strategyRotationIndex` from `SupervisorResumeState`**

Replace `SupervisorResumeState` (lines 27-33) with:

```typescript
/** Serializable state for checkpoint resume. */
export interface SupervisorResumeState {
  phase: PipelinePhase;
  ordinalHistory: number[];
  diversityHistory: number[];
}
```

**Step 3: Remove `_strategyRotationIndex` field and rotation logic from `PoolSupervisor`**

- Remove `private _strategyRotationIndex = 0;` (line 110)
- In `beginIteration()` (lines 161-177): remove the `if (this._currentPhase === 'COMPETITION')` block that advances rotation (lines 174-176)
- In `transitionToCompetition()` (lines 189-194): remove `this._strategyRotationIndex = -1;`
- In `setPhaseFromResume()` (lines 278-291): remove the `rotationIndex` parameter and all rotation-related logic. New signature: `setPhaseFromResume(phase: PipelinePhase): void`
- In `getResumeState()` (lines 294-301): remove `strategyRotationIndex` from returned object

**Step 4: Simplify `getExpansionConfig` and `getCompetitionConfig`**

Replace `getExpansionConfig` (lines 202-214) with:
```typescript
private getExpansionConfig(): PhaseConfig {
  return {
    phase: 'EXPANSION',
    activeAgents: getActiveAgents('EXPANSION', this.cfg.enabledAgents, this.cfg.singleArticle),
  };
}
```

Replace `getCompetitionConfig` (lines 216-224) with:
```typescript
private getCompetitionConfig(): PhaseConfig {
  return {
    phase: 'COMPETITION',
    activeAgents: getActiveAgents('COMPETITION', this.cfg.enabledAgents, this.cfg.singleArticle),
  };
}
```

Update `getPhaseConfig` — `getExpansionConfig` no longer needs `state`:
```typescript
getPhaseConfig(state: PipelineState): PhaseConfig {
  return this._currentPhase === 'EXPANSION'
    ? this.getExpansionConfig()
    : this.getCompetitionConfig();
}
```

Note: Keep the `state` parameter in `getPhaseConfig` signature for now (callers pass it). It can be removed in a future cleanup.

**Step 5: Run tests to see what breaks**

Run: `npx jest evolution/src/lib/core/supervisor.test.ts --no-coverage 2>&1 | tail -30`
Expected: Several failures in tests that assert `generationPayload`, `calibrationPayload`, `strategyRotationIndex`

**Step 6: Commit production code changes**

```bash
git add evolution/src/lib/core/supervisor.ts
git commit -m "refactor: simplify PhaseConfig to {phase, activeAgents}, remove strategy rotation"
```

---

### Task 2: Update supervisor tests for simplified PhaseConfig

**Files:**
- Modify: `evolution/src/lib/core/supervisor.test.ts`

**Step 1: Remove/update tests that assert deleted behavior**

Tests to **remove entirely** (assert payload/rotation behavior):
- `'rotates strategy in COMPETITION'` (line 114)
- `'EXPANSION: all 3 strategies when diversity ok'` (line 142)
- `'EXPANSION: repeats structural_transform x3 when diversity low'` (line 159)
- `'COMPETITION: enables all agents, 5 opponents'` (line 170) — rewrite without payload assertions

Tests to **update** (assert PhaseConfig shape minus payloads):
- `'getPhaseConfig disables generation, outlineGeneration, and evolution'` (line 448)
- `'getPhaseConfig keeps improvement agents enabled'` (line 460)
- `'getPhaseConfig with singleArticle false keeps all COMPETITION flags true'` (line 476)
- Any test referencing `config.generationPayload` or `config.calibrationPayload`

Tests to **update** (resume state shape):
- `'restores COMPETITION phase and locks it'` (line 351) — remove `strategyRotationIndex` references
- `'round-trips through getResumeState + setPhaseFromResume'` (line 362) — update for new shape
- `'rejects invalid phase'` (line 382) — change `setPhaseFromResume('INVALID' as any, 0)` to `setPhaseFromResume('INVALID' as any)` (remove second argument)
- All other `setPhaseFromResume` calls — remove second argument (rotation index)

**Step 2: Add replacement test for COMPETITION agent list**

```typescript
it('COMPETITION: enables all agents in execution order', () => {
  const supervisor = createSupervisor({ expansionMaxIterations: 0 });
  supervisor.beginIteration(makeState({ iteration: 1, poolSize: 20, diversity: 0.5 }));
  const config = supervisor.getPhaseConfig(makeState({ iteration: 1, poolSize: 20, diversity: 0.5 }));
  expect(config.phase).toBe('COMPETITION');
  expect(config.activeAgents).toContain('ranking');
  expect(config.activeAgents).toContain('generation');
  expect(config.activeAgents.length).toBeGreaterThan(3);
});
```

**Step 3: Run tests**

Run: `npx jest evolution/src/lib/core/supervisor.test.ts --no-coverage 2>&1 | tail -20`
Expected: All pass

**Step 4: Commit**

```bash
git add evolution/src/lib/core/supervisor.test.ts
git commit -m "test: update supervisor tests for simplified PhaseConfig"
```

---

### Task 3: Update pipeline.ts checkpoint and persistence tests

**Files:**
- Modify: `evolution/src/lib/core/pipeline.ts:330-335` (supervisor resume)
- Modify: `evolution/src/lib/core/pipeline.test.ts` (~20 locations)
- Modify: `evolution/src/lib/core/persistence.continuation.test.ts` (~6 locations)
- Modify: `evolution/src/lib/core/hallOfFame.test.ts` (~1 location)

**Step 1: Update `pipeline.ts` supervisor resume call (production code)**

In `executeFullPipeline` (line 332), change:
```typescript
supervisor.setPhaseFromResume(r.phase, r.strategyRotationIndex);
```
to:
```typescript
supervisor.setPhaseFromResume(r.phase);
```

Commit production change separately:
```bash
git add evolution/src/lib/core/pipeline.ts
git commit -m "refactor: remove strategyRotationIndex from pipeline resume call"
```

**Step 2: Update `pipeline.test.ts` — remove `strategyRotationIndex` from all `supervisorResume` objects**

There are ~20 locations with this pattern:
```typescript
supervisorResume: { phase: 'COMPETITION', strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
```
Replace all with:
```typescript
supervisorResume: { phase: 'COMPETITION' as const, ordinalHistory: [], diversityHistory: [] },
```

Also find the `makePipelineOpts` helper (~line 1243) and update it.

**Step 3: Update `persistence.continuation.test.ts`**

~7 locations with `strategyRotationIndex` in mock supervisor state or assertions:
- The `mockSupervisor.getResumeState()` mock return value (lines 75-81) — update to return `{ phase, ordinalHistory, diversityHistory }` without `strategyRotationIndex`
- The `'includes supervisorState in snapshot'` assertion (lines 110-123) — update expected shape
- The `'returns deserialized state with supervisor and cost data'` mock data AND assertion (lines 202-232) — remove `strategyRotationIndex: 2` from both
- All other mock objects and `expect` assertions referencing `strategyRotationIndex`

**Step 4: Update `hallOfFame.test.ts`**

~1 location with `strategyRotationIndex`. Remove from mock.

**Step 5: Run all affected tests**

Run: `npx jest evolution/src/lib/core/pipeline.test.ts evolution/src/lib/core/persistence.continuation.test.ts evolution/src/lib/core/hallOfFame.test.ts --no-coverage 2>&1 | tail -30`
Expected: All pass

**Step 6: Commit test changes**

Note: `pipeline.ts` production change was already committed in Step 1 above.

```bash
git add evolution/src/lib/core/pipeline.test.ts evolution/src/lib/core/persistence.continuation.test.ts evolution/src/lib/core/hallOfFame.test.ts
git commit -m "test: remove strategyRotationIndex from pipeline and persistence tests"
```

---

### Task 4: Run full test suite — verify Phase 1 clean

**Step 1: Run lint and tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v '^\.next/' | head -30`
Run: `npx eslint evolution/src/lib/core/supervisor.ts evolution/src/lib/core/pipeline.ts --no-warn 2>&1 | head -20`

**Step 2: Run full evolution test suite**

Run: `npx jest evolution/ --no-coverage 2>&1 | tail -30`
Expected: All pass

**Step 3: Fix any remaining references**

If tsc or tests reveal any missed `strategyRotationIndex`, `generationPayload`, or `calibrationPayload` references, fix them.

---

### Task 5: Remove `expansion.minIterations` from types and defaults

**Files:**
- Modify: `evolution/src/lib/types.ts:499-504` (EvolutionRunConfig.expansion)
- Modify: `evolution/src/lib/config.ts:11-16` (DEFAULT_EVOLUTION_CONFIG.expansion)

**Step 1: Remove `minIterations` from `EvolutionRunConfig`**

In `evolution/src/lib/types.ts`, change the expansion shape (lines 499-504) from:
```typescript
expansion: {
  minPool: number;
  minIterations: number;
  diversityThreshold: number;
  maxIterations: number;
};
```
to:
```typescript
expansion: {
  minPool: number;
  diversityThreshold: number;
  maxIterations: number;
};
```

**Step 2: Remove from `DEFAULT_EVOLUTION_CONFIG`**

In `evolution/src/lib/config.ts`, change (lines 11-16) from:
```typescript
expansion: {
  minPool: 15,
  minIterations: 3,
  diversityThreshold: 0.25,
  maxIterations: 8,
},
```
to:
```typescript
expansion: {
  minPool: 15,
  diversityThreshold: 0.25,
  maxIterations: 8,
},
```

**Step 3: Run tsc to find broken references**

Run: `npx tsc --noEmit 2>&1 | grep -v '^\.next/' | grep minIterations`
Expected: Type errors in test files that include `minIterations` in config objects

**Step 4: Commit production changes**

```bash
git add evolution/src/lib/types.ts evolution/src/lib/config.ts
git commit -m "refactor: remove dead expansion.minIterations field"
```

---

### Task 6: Fix files referencing `minIterations` config field

**Files:**
- Modify: `evolution/src/lib/core/pipeline.test.ts` (~13 occurrences)
- Modify: `evolution/src/lib/core/hallOfFame.test.ts` (~1 occurrence)
- Modify: `evolution/scripts/run-evolution-local.ts` (1 config field occurrence — see warning below)
- Modify: `evolution/scripts/run-evolution-local.test.ts` (~2 occurrences)

**Step 1: Remove `minIterations` config field from all fixtures and config objects**

In test files, find lines like:
```typescript
expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
```
and remove the `minIterations` key:
```typescript
expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25 },
```

**WARNING for `run-evolution-local.ts`:** This is production code (CLI runner), not a test file.
- Line 609: `minIterations: 0` in the `configOverrides.expansion` object literal — **REMOVE this property** (it's the config field being deleted).
- Lines 617-618: `const minIterations = ...` — this is a **LOCAL VARIABLE** computing supervisor constraint minimums. It is **NOT** the config field and must **NOT** be removed or renamed.
- `DEFAULT_EVOLUTION_CONFIG.expansion` spread (lines 619-621) will naturally stop including `minIterations` after Task 5 — no code change needed here.

**Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v '^\.next/' | grep minIterations`
Expected: No errors

**Step 3: Run affected tests**

Run: `npx jest evolution/src/lib/core/pipeline.test.ts evolution/src/lib/core/hallOfFame.test.ts evolution/scripts/run-evolution-local.test.ts --no-coverage 2>&1 | tail -20`
Expected: All pass

**Step 4: Commit production and test changes**

```bash
git add evolution/scripts/run-evolution-local.ts
git commit -m "refactor: remove minIterations config field from run-evolution-local"
git add evolution/src/lib/core/pipeline.test.ts evolution/src/lib/core/hallOfFame.test.ts evolution/scripts/run-evolution-local.test.ts
git commit -m "test: remove minIterations from all test fixtures"
```

---

### Task 7: Update reference doc for removed field

**Files:**
- Modify: `evolution/docs/evolution/reference.md`

**Step 1: Remove `minIterations` from config reference**

Search for `minIterations` in `evolution/docs/evolution/reference.md` and remove the row/entry.

**Step 2: Remove `strategyRotationIndex` from supervisorResume description**

In `evolution/docs/evolution/reference.md` (line 68), the supervisorResume field description mentions "rotation index". Update to reflect the simplified `SupervisorResumeState` shape: `{ phase, ordinalHistory, diversityHistory }`.

Also check for any reference to `PoolSupervisor.validateConfig()` (line ~49) — note it for update in Task 10 after the method is removed in Task 8.

**Step 3: Commit**

```bash
git add evolution/docs/evolution/reference.md
git commit -m "docs: remove expansion.minIterations from config reference"
```

---

### Task 8: Remove duplicated supervisor validation

**Files:**
- Modify: `evolution/src/lib/core/supervisor.ts:120-140` (validateConfig method)
- Modify: `evolution/src/lib/core/supervisor.test.ts` (constructor validation tests)

**Step 1: Remove `validateConfig` method entirely**

- Remove the `this.validateConfig(cfg);` call from the constructor (line 117)
- Delete the entire `validateConfig` method body (lines 120-140)

All constraint validation is handled by `validateRunConfig()` in `configValidation.ts`, which runs before the supervisor is constructed. No duplicate checks needed.

**Step 2: Run tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v '^\.next/' | head -20`
Expected: Clean

**Step 3: Commit production change**

```bash
git add evolution/src/lib/core/supervisor.ts
git commit -m "refactor: remove duplicated validation from PoolSupervisor constructor"
```

---

### Task 9: Update supervisor validation tests

**Files:**
- Modify: `evolution/src/lib/core/supervisor.test.ts`

**Step 1: Remove or redirect validation tests**

Tests to **remove** from `describe('constructor validation')` (lines 388-412):
- `'rejects bad diversity threshold'` — covered by configValidation.test.ts
- `'rejects small min pool'` — covered by configValidation.test.ts
- `'rejects maxIterations <= expansionMaxIterations'` — covered by configValidation.test.ts

Test to **keep** (if the bypass guard remains):
- `'accepts expansion.maxIterations: 0 with small maxIterations (auto-clamped config)'` — keep if relevant

Tests in `describe('singleArticle mode')` to **remove** (validation-related):
- `'accepts expansionMinPool < 5 when expansionMaxIterations is 0'` (line 426)
- `'still rejects expansionMinPool < 5 when expansionMaxIterations > 0'` (line 430)
- `'accepts maxIterations: 1 when expansionMaxIterations is 0'` (line 434)
- `'still rejects maxIterations <= expansionMaxIterations when expansion enabled'` (line 438)

These all test validation logic that now lives solely in `validateRunConfig`.

**Step 2: Run tests**

Run: `npx jest evolution/src/lib/core/supervisor.test.ts --no-coverage 2>&1 | tail -20`
Expected: All pass

**Step 3: Commit**

```bash
git add evolution/src/lib/core/supervisor.test.ts
git commit -m "test: remove supervisor validation tests (covered by configValidation tests)"
```

---

### Task 10: Final verification and documentation

**Step 1: Run full test suite**

Run: `npx jest evolution/ --no-coverage 2>&1 | tail -30`
Expected: All pass

**Step 2: Run tsc and lint**

Run: `npx tsc --noEmit 2>&1 | grep -v '^\.next/' | head -20`
Run: `npx eslint evolution/src/lib/ --no-warn 2>&1 | head -20`

**Step 3: Update architecture docs**

In `evolution/docs/evolution/architecture.md`, update these specific locations:
- Lines 32-33: Remove "The supervisor prepares a strategy payload that collapses to a single strategy when diversity is low" (EXPANSION phase description)
- Line 41: Remove "The supervisor prepares a rotating single-strategy payload for COMPETITION" (COMPETITION phase description)
- Line 48: Update "Uses 5 opponents per entrant" — the value is still correct but remove any implication the supervisor controls it (CalibrationRanker reads from `config.calibration.opponents` directly)
- Line 117: Update "Supervisor resume state preserved (phase, strategy rotation index, ordinal/diversity history)" — remove "strategy rotation index"
- Line 134: Update "restoring supervisorState (phase, rotation index, history)" — remove "rotation index"
- Lines 286-288: **Known Implementation Gaps** section — remove gap #1 entirely ("supervisor strategy routing not consumed by GenerationAgent") since it is fully resolved by this refactor

In `evolution/docs/evolution/reference.md`:
- Update any reference to `PoolSupervisor.validateConfig()` (removed in Task 8)

In `evolution/docs/evolution/agents/overview.md`:
- Update if it references PhaseConfig payload or strategy rotation

**Step 4: Commit docs**

```bash
git add evolution/docs/evolution/architecture.md evolution/docs/evolution/agents/overview.md evolution/docs/evolution/reference.md
git commit -m "docs: update architecture docs for simplified pipeline rules"
```

**Step 5: Final full check**

Run: `npx jest --no-coverage 2>&1 | tail -10`
Run: `npm run build 2>&1 | tail -10`
Expected: Everything passes
