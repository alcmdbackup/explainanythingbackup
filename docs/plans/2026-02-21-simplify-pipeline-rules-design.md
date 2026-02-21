# Simplify Evolution Pipeline Rules — Design

**Date**: 2026-02-21
**Issue**: #503
**Branch**: `feat/simplify_reorganize_evolution_pipeline_rules_20260221`
**Scope**: Moderate — remove dead code, simplify PhaseConfig, consolidate validation. No behavioral changes.

## Problem

The evolution pipeline's rules system has accumulated dead code and duplication across 3 research passes:

1. **Dead PhaseConfig payloads** — supervisor computes `generationPayload` and `calibrationPayload` per-phase, but pipeline.ts only reads `.phase` and `.activeAgents`. Agents read config directly from `ctx.payload.config`.
2. **Dead strategy rotation** — supervisor rotates through 3 generation strategies in COMPETITION, but GenerationAgent always runs all 3 in parallel via `GENERATION_STRATEGIES.map(...)`.
3. **Dead config field** — `expansion.minIterations` is defined (types.ts) and defaulted (config.ts) but never read by any runtime code.
4. **Duplicated validation** — 4 identical constraint checks exist in both `validateRunConfig` (configValidation.ts) and `PoolSupervisor.validateConfig` (supervisor.ts).

## Approach

Top-down: simplify PhaseConfig first (removes 3 dead concepts at once), then clean dead fields, then consolidate validation. Each phase is independently committable with no behavioral change.

## Phase 1: Simplify PhaseConfig and Remove Strategy Rotation

Simplify `PhaseConfig` from `{phase, activeAgents, generationPayload, calibrationPayload}` to `{phase, activeAgents}`.

**Remove from supervisor.ts:**
- `generationPayload` and `calibrationPayload` from `PhaseConfig` interface
- Diversity-aware strategy selection in `getExpansionConfig()`
- Per-phase opponent count in `getCompetitionConfig()`
- `_strategyRotationIndex` field and rotation logic in `beginIteration()`
- Strategy rotation reset in `transitionToCompetition()`
- `strategyRotationIndex` from `SupervisorResumeState`

**Keep:** `GENERATION_STRATEGIES` constant (still imported by GenerationAgent).

**Files:** supervisor.ts, supervisor.test.ts (~15 tests removed/updated), pipeline.ts (checkpoint), types.ts (resume state)

## Phase 2: Remove Dead Config Fields

**Remove `expansion.minIterations`:**
- From `EvolutionRunConfig` interface (types.ts)
- From `DEFAULT_EVOLUTION_CONFIG` (config.ts)
- From `StrategyConfig` if present
- From ~13 test config fixtures

**Keep `generation.strategies`:** CostEstimator legitimately reads it. Agent ignores it but the field isn't harmful.

**Files:** types.ts, config.ts, strategyConfig.ts, ~5 test files

## Phase 3: Consolidate Validation

Remove 4 duplicated checks from `PoolSupervisor.validateConfig()`:
- `expansionDiversityThreshold` in [0,1]
- `expansionMinPool >= 5`
- `maxIterations > expansionMaxIterations`
- `maxIterations >= expansionMaxIterations + plateauWindow + 1`

These are already enforced by `validateRunConfig()` which runs first (in `preparePipelineRun`). Remove or gut the supervisor's `validateConfig` method entirely.

Keep `resolveConfig` auto-clamping (still prevents `validateRunConfig` failures for short runs).

**Files:** supervisor.ts, supervisor.test.ts (~8 tests removed), config.ts (comment update)

## Phase 4: Update Tests and Documentation

- Verify remaining tests pass with config fixture updates
- Remove tests asserting deleted behavior
- Update evolution docs: architecture.md, reference.md, agents/overview.md
- Update research doc to note completion

## Impact Summary

| Metric | Before | After |
|---|---|---|
| `PhaseConfig` fields | 4 | 2 |
| Supervisor private fields | 4 (`_phaseLocked`, `_currentPhase`, `_strategyRotationIndex`, `_currentIteration`) | 3 (remove rotation) |
| `SupervisorResumeState` fields | 4 | 3 (remove rotation index) |
| Config validation locations | 2 (duplicated) | 1 |
| Dead config fields | 1 (`expansion.minIterations`) | 0 |
| Net LOC removed (production) | — | ~80-100 |
| Net tests removed/simplified | — | ~20-25 |
| Behavioral changes | — | None |

## Risks

- **Checkpoint backward compatibility**: Old checkpoints with `strategyRotationIndex` and `generationPayload` in JSONB — harmless, deserialization ignores unknown fields.
- **DB rows with `minIterations`**: `deepMerge` ignores unknown keys in override objects — no migration needed.
- **CostEstimator**: Still reads `generation.strategies` and `expansion.maxIterations` — not affected by these changes.
