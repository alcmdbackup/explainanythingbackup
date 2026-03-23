# Typescript Enforcement Evolution Plan

## Background
Add strict TS checks, remove @ts-nocheck, and fix type errors in evolution. Every entity in DB should have a corresponding entry in a schema.ts file for evolution which validates all reads and writes. Every function should have full TypeScript annotations. Additionally, internal pipeline types should have Zod schemas, and script import issues should be fixed.

## Requirements (from GH Issue #776)
- Add strict TypeScript checks across the evolution pipeline
- Remove all @ts-nocheck directives
- Fix all type errors in evolution/
- Every DB entity must have a corresponding Zod schema entry in a schema.ts file for evolution
- All reads and writes to DB entities must be validated against their Zod schemas
- Every function must have full TypeScript type annotations (parameters, return types)
- Internal pipeline types (TextVariation, EvolutionConfig, etc.) must also have Zod schemas
- ExecutionDetail discriminated union validated on both read and write
- Fix script import issues (processRunQueue.ts @/ aliases, default imports)

## Problem
The evolution subsystem has strong TypeScript discipline (strict mode enabled, 0 @ts-nocheck, only 4 `any` usages) but lacks runtime validation at trust boundaries. Only 1 of 11 DB tables has a Zod schema (EvolutionRunSummary). There are 27 type assertions (`as SomeType`) on DB read results across service files, 122 Supabase `.from()` calls with no write validation, and ~10 internal pipeline types defined as bare interfaces with no schema. JSONB columns (`config`, `execution_detail`, `run_summary`) are read with unsafe casts. Script files have import resolution issues.

## Design Decisions

| Question | Decision |
|----------|----------|
| Validate simple SELECTs at runtime? | No — validate writes, RPC results, and JSONB columns only. Replace `as` casts with `z.infer` derived types. |
| Schemas for internal types? | Yes — TextVariation, EvolutionConfig, V2Match, V2StrategyConfig, EvolutionResult, etc. |
| Schema file location? | New `evolution/src/lib/schemas.ts` for all DB + internal schemas. Keep RunSummary schemas in `types.ts`. |
| ExecutionDetail validation? | Both read and write — `.safeParse()` with fallback-to-null on read, `.parse()` on write. |
| Script import issues? | Fix in this project — processRunQueue.ts @/ aliases, default imports for dotenv/fs/path. |

## Options Considered

### Schema Organization
1. **Single `evolution/src/lib/schemas.ts`** (chosen) — one file for all entity schemas, consistent with main app's `src/lib/schemas/schemas.ts`. 11 tables + ~10 internal types is manageable in one file.
2. Split per domain (`schemas/runs.ts`, `schemas/arena.ts`) — more files, more imports, unnecessary at this scale.
3. Add to existing `types.ts` — already large (800+ lines), would bloat further.

### Validation Strategy
1. **Validate writes + JSONB reads + RPCs** (chosen) — matches main app pattern. Writes prevent bad data entering DB. JSONB reads validate untyped data. Simple SELECTs are typed by Supabase SDK.
2. Validate everything — adds runtime cost to every query for minimal safety gain.
3. Validate nothing (types only) — misses the point; `z.infer` without `.parse()` is just a type alias.

### Type Replacement Strategy
1. **Derive service types from schemas** (chosen) — replace interface definitions (EvolutionRun, ArenaEntry, etc.) with `z.infer<typeof schema>`. Service-specific enriched types extend the base schema.
2. Keep interfaces alongside schemas — duplicate definitions that can drift.

## Phased Execution Plan

### Phase 1: Create `evolution/src/lib/schemas.ts` — DB Entity Schemas
Create Zod schemas for all 11 evolution tables following the InsertSchema → FullDbSchema pattern.

**Schemas to create (one InsertSchema + one FullDbSchema per table):**
1. `evolutionStrategySchema` — config field is `V2StrategyConfig` (nested schema)
2. `evolutionPromptSchema` — simple fields, status enum
3. `evolutionExperimentSchema` — status enum, config JSONB
4. `evolutionRunSchema` — status enum, run_summary uses existing `EvolutionRunSummarySchema`
5. `evolutionVariantSchema` — includes arena fields (mu, sigma, synced_to_arena)
6. `evolutionAgentInvocationSchema` — execution_detail JSONB
7. `evolutionRunLogSchema` — level enum, context JSONB
8. `evolutionArenaComparisonSchema` — winner enum, confidence range
9. `evolutionBudgetEventSchema` — event_type enum, numeric precision
10. `evolutionExplanationSchema` — source enum

**Validation:** lint, tsc, build. Unit tests for each schema (parse valid data, reject invalid).

### Phase 2: Create Internal Pipeline Type Schemas
Add Zod schemas for internal types in `evolution/src/lib/schemas.ts`:

1. `textVariationSchema` — id, text, version, parentIds, strategy, timestamps, fromArena
2. `v2StrategyConfigSchema` — generationModel, judgeModel, iterations, budgetUsd
3. `evolutionConfigSchema` — iterations (1-100), budgetUsd (>0, ≤50), models, optional fields
4. `v2MatchSchema` — winnerId, loserId, result enum, confidence, judgeModel, reversed
5. `evolutionResultSchema` — winner, pool, ratings, matchHistory, cost, stopReason
6. `ratingSchema` — mu, sigma
7. `cachedMatchSchema` — winnerId, loserId, confidence, isDraw
8. `agentExecutionDetailSchema` — discriminated union of 11 variants by `detailType`

**Validation:** lint, tsc, build. Unit tests for schemas, especially the discriminated union.

### Phase 3: Replace Service Type Definitions with Schema-Derived Types
Update service files to derive types from schemas instead of manual interfaces.

**Files to update:**
- `evolution/src/services/evolutionActions.ts` — replace `EvolutionRun`, `EvolutionVariant`, `RunLogEntry`, `VariantListEntry` interfaces with `z.infer` + enriched extensions
- `evolution/src/services/arenaActions.ts` — replace `ArenaTopic`, `ArenaEntry`, `ArenaComparison`, `PromptListItem`
- `evolution/src/services/strategyRegistryActionsV2.ts` — replace `StrategyListItem`
- `evolution/src/services/invocationActions.ts` — replace `InvocationListEntry`, `InvocationDetail`
- `evolution/src/services/variantDetailActions.ts` — replace `VariantFullDetail`, `VariantRelative`, `LineageEntry`
- `evolution/src/lib/types.ts` — replace `TextVariation`, `Critique`, `MetaFeedback` interfaces with `z.infer`
- `evolution/src/lib/pipeline/infra/types.ts` — replace `V2Match`, `EvolutionConfig`, `V2StrategyConfig`, `EvolutionResult`

**Pattern for enriched service types:**
```typescript
// Base from schema
export type EvolutionRunRow = z.infer<typeof evolutionRunFullDbSchema>;
// Enriched for service layer
export type EvolutionRun = EvolutionRunRow & { total_cost_usd: number; strategy_name: string | null; };
```

Remove all 27 `as SomeType` assertions on DB results — replace with `z.infer` derived types.

**Validation:** lint, tsc, build. Run existing unit + integration tests to confirm no regressions.

### Phase 4: Add Write Validation
Add `.parse()` / `.safeParse()` calls before every DB write operation.

**Files to update:**
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — validate variant upserts, run completion update, arena sync payload
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — validate invocation create/update
- `evolution/src/lib/pipeline/infra/createRunLogger.ts` — validate log inserts
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — validate strategy upsert
- `evolution/src/lib/pipeline/manageExperiments.ts` — validate experiment create, run insert
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — validate run status updates
- `evolution/src/services/arenaActions.ts` — validate topic/prompt create/update (some already done)
- `evolution/src/services/strategyRegistryActionsV2.ts` — validate strategy create/update (some already done)
- `evolution/src/services/evolutionActions.ts` — validate run creation, archive

**Validation:** lint, tsc, build. Run all unit tests. Run integration tests.

### Phase 5: Add Read Validation for JSONB and RPC Results
Add `.safeParse()` with fallback on JSONB column reads and RPC results.

**Files to update:**
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — validate `strategy.config as V2StrategyConfig` with schema
- `evolution/src/services/evolutionActions.ts` — already validates run_summary; add for other JSONB
- `evolution/src/services/invocationActions.ts` — validate `execution_detail` JSONB on read
- `evolution/src/services/experimentActionsV2.ts` — validate experiment config JSONB
- `evolution/src/experiments/evolution/experimentMetrics.ts` — replace `as unknown as` casts with schema validation
- `evolution/src/lib/pipeline/manageExperiments.ts` — replace `as unknown as` casts
- `evolution/src/services/evolutionVisualizationActions.ts` — replace `as string` casts with proper typing

**Pattern:**
```typescript
const configParsed = v2StrategyConfigSchema.safeParse(strategyRow.config);
if (!configParsed.success) { /* log warning, return error */ }
const config = configParsed.data;
```

**Validation:** lint, tsc, build. Run all unit + integration tests.

### Phase 6: Fix Script Import Issues
Fix TypeScript issues in evolution/scripts/.

1. `evolution/scripts/processRunQueue.ts` — replace `@/` alias imports with relative paths (matching run-evolution-local.ts pattern)
2. `evolution/scripts/run-evolution-local.ts` and `backfill-strategy-config-id.ts` — fix default imports:
   - `import dotenv from 'dotenv'` → `import * as dotenv from 'dotenv'` (or use named import)
   - `import fs from 'fs'` → `import * as fs from 'fs'`
   - `import path from 'path'` → `import * as path from 'path'`
3. Fix any remaining iterator issues if they surface in tsc

**Validation:** lint, tsc, build. Run script test files. Verify scripts execute: `npx tsx evolution/scripts/run-evolution-local.ts --help`

### Phase 7: Remove Remaining `any` and Type Assertions
Clean up the 4 `any` usages in production code and reduce unsafe internal assertions.

1. `evolution/src/lib/shared/hashStrategyConfig.ts:56` — `[...agents].sort() as AgentName[]` → validate with schema
2. `evolution/src/lib/pipeline/claimAndExecuteRun.ts:140` — `as AllowedLLMModelType` → validate against enum
3. Remaining `as string` casts in visualization/cost analytics — derive from schema types
4. `as unknown as` patterns in experimentMetrics.ts and manageExperiments.ts — replaced by Phase 5

**Validation:** lint, tsc, build. Full test suite (unit + integration).

## Testing

### New Tests
- `evolution/src/lib/schemas.test.ts` — test every schema: valid data parses, invalid data rejects, edge cases (nulls, empty strings, out-of-range numbers)
- Test the discriminated union `agentExecutionDetailSchema` with all 11 variants
- Test InsertSchema vs FullDbSchema (insert should reject id/created_at; fullDb should require them)

### Existing Tests
- Run full unit suite after each phase: `cd evolution && npx jest --forceExit`
- Run integration tests after Phases 4-5: `npm run test:integration:evolution`
- Run E2E after Phase 5: `npm run test:e2e -- --grep "evolution"`
- Run script tests after Phase 6: `npx jest evolution/scripts/`

### Manual Verification
- Verify admin UI pages still load (runs, experiments, arena, strategies, variants, invocations)
- Verify evolution pipeline can execute a run on stage (claim → execute → finalize)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` — add schemas.ts to code layout section
- `evolution/docs/evolution/architecture.md` — add note about Zod validation at trust boundaries
- `evolution/docs/evolution/data_model.md` — add "Type Hierarchy" section referencing schemas.ts, document InsertSchema/FullDbSchema pattern
- `evolution/docs/evolution/reference.md` — add schemas.ts to Key Files table, update type definitions section
