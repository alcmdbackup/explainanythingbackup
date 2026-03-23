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
- Rename `TextVariation` → `Variant` everywhere (type, factory, schema)

## Problem
The evolution subsystem has strong TypeScript discipline (strict mode enabled, 0 @ts-nocheck, only 4 `any` usages) but lacks runtime validation at trust boundaries. Only 1 of 11 DB tables has a Zod schema (EvolutionRunSummary). There are 27 type assertions (`as SomeType`) on DB read results across service files, 122 Supabase `.from()` calls with no write validation, and ~10 internal pipeline types defined as bare interfaces with no schema. JSONB columns (`config`, `execution_detail`, `run_summary`) are read with unsafe casts. Script files have import resolution issues.

## Design Decisions

| Question | Decision |
|----------|----------|
| Validate simple SELECTs at runtime? | No — validate writes, RPC results, and JSONB columns only. Replace `as` casts with `z.infer` derived types. |
| Schemas for internal types? | Yes — TextVariation, EvolutionConfig, V2Match, V2StrategyConfig, EvolutionResult, etc. |
| Schema file location? | New `evolution/src/lib/schemas.ts` for ALL schemas including RunSummary (moved from `types.ts` to avoid circular deps). `types.ts` re-exports from `schemas.ts`. |
| ExecutionDetail validation? | Both read and write — `.safeParse()` with fallback-to-null on read, `.parse()` on write. |
| Script import issues? | Fix in this project — processRunQueue.ts @/ aliases, default imports for dotenv/fs/path. |

## Options Considered

### Schema Organization
1. **Single `evolution/src/lib/schemas.ts`** (chosen) — one file for all entity + internal schemas, consistent with main app's `src/lib/schemas/schemas.ts`. Move RunSummary schemas from `types.ts` into `schemas.ts` to avoid circular dependencies. `types.ts` re-exports the schemas and derived types for backward compatibility.
2. Split per domain (`schemas/runs.ts`, `schemas/arena.ts`) — more files, more imports, unnecessary at this scale.
3. Add to existing `types.ts` — already large (800+ lines), would bloat further and create circular deps when services import schemas.

### Validation Strategy
1. **Validate writes + JSONB reads + RPCs** (chosen) — matches main app pattern. Writes prevent bad data entering DB. JSONB reads validate untyped data. Simple SELECTs are typed by Supabase SDK.
2. Validate everything — adds runtime cost to every query for minimal safety gain.
3. Validate nothing (types only) — misses the point; `z.infer` without `.parse()` is just a type alias.

### Type Replacement Strategy
1. **Derive service types from schemas** (chosen) — replace interface definitions (EvolutionRun, ArenaEntry, etc.) with `z.infer<typeof schema>`. Service-specific enriched types extend the base schema.
2. Keep interfaces alongside schemas — duplicate definitions that can drift.

## Dependency Direction & Circular Dependency Prevention

```
schemas.ts  (NEW — all Zod schemas, zero imports from types.ts)
    ↓ exports schemas + z.infer types
types.ts    (re-exports from schemas.ts for backward compat; defines non-schema interfaces like ExecutionContext)
    ↓ re-exports
lib/index.ts (barrel — re-exports schemas, types, and schema values for runtime use)
    ↓ re-exports
pipeline/index.ts (barrel — re-exports pipeline-specific schemas)
```

**Key rule:** `schemas.ts` must NOT import from `types.ts`. `types.ts` imports from `schemas.ts`. This prevents circular dependencies. Move `EvolutionRunSummarySchema` (V1/V2/V3) from `types.ts` into `schemas.ts`.

## Enriched Service Type Strategy

Service files often return DB rows enriched with computed/joined data (e.g., `EvolutionRun` with `total_cost_usd`, `strategy_name`). Strategy:

```typescript
// In schemas.ts — base DB row schema
export const evolutionRunFullDbSchema = z.object({ ... });
export type EvolutionRunRow = z.infer<typeof evolutionRunFullDbSchema>;

// In service file — enriched type extends base (no separate schema needed)
export type EvolutionRun = EvolutionRunRow & {
  total_cost_usd: number;
  strategy_name: string | null;
  experiment_name: string | null;
};
```

For enriched types, the `as` cast is removed by typing the Supabase `.select()` return as the base `EvolutionRunRow` and then enriching in application logic with explicit field assignment. No runtime validation needed for the enrichment fields since they're computed in-code.

## Barrel File Update Plan

Phase 1-2 must include these barrel updates:
- `evolution/src/lib/index.ts` — add re-exports of all schema values (for runtime `.parse()`) and `z.infer` types
- `evolution/src/lib/pipeline/index.ts` — add re-exports of pipeline-specific schemas (EvolutionConfig, V2Match, etc.)
- `evolution/src/lib/types.ts` — add re-exports of RunSummary schemas from `schemas.ts` (backward compat)

## Rollback Strategy

Each phase is committed separately. If a phase breaks CI:
1. `git revert <phase-commit>` to restore last green state
2. Fix the issue on the reverted code
3. Re-commit with the fix

Phase 3 (type replacement) is highest risk. Mitigations:
- Do one service file at a time, run tests after each
- Keep old interfaces as deprecated type aliases during transition: `/** @deprecated Use EvolutionRunRow */ export type EvolutionRun = EvolutionRunRow & { ... };`
- Only remove deprecated aliases after all tests pass

## Phased Execution Plan

### Phase 1: Create `evolution/src/lib/schemas.ts` — DB Entity Schemas
Create Zod schemas for all 11 evolution tables following the InsertSchema → FullDbSchema pattern. Move RunSummary schemas from `types.ts` into `schemas.ts`. Create `evolution/src/lib/schemas.test.ts` with test fixtures.

**Schemas to create (one InsertSchema + one FullDbSchema per table):**
1. `evolutionStrategySchema` — config field uses `v2StrategyConfigSchema` (nested)
2. `evolutionPromptSchema` — simple fields, status enum `('active','archived')`
3. `evolutionExperimentSchema` — status enum, config JSONB optional
4. `evolutionRunSchema` — status enum, run_summary uses `EvolutionRunSummarySchema` (moved here)
5. `evolutionVariantSchema` — includes arena fields (mu, sigma, synced_to_arena)
6. `evolutionAgentInvocationSchema` — execution_detail JSONB
7. `evolutionRunLogSchema` — level enum `('info','warn','error','debug')`, context JSONB
8. `evolutionArenaComparisonSchema` — winner enum `('a','b','draw')`, confidence 0-1
9. `evolutionBudgetEventSchema` — event_type enum, numeric fields
10. `evolutionExplanationSchema` — source enum `('explanation','prompt_seed')`

**Test file:** `evolution/src/lib/schemas.test.ts`
- Test fixture factory: `createValidRow(table)` returns valid data for each table
- For each schema: test valid parse, test rejection of missing required fields, test rejection of invalid enums, test edge cases (null vs undefined for nullable fields)
- Use `@jest-environment node` docblock for faster execution

**Barrel updates:**
- `evolution/src/lib/index.ts` — re-export all schema values and types from `schemas.ts`
- `evolution/src/lib/types.ts` — re-export `EvolutionRunSummarySchema` from `schemas.ts` for backward compat

**Validation:** lint, tsc, build, `npx jest evolution/src/lib/schemas.test.ts`

### Phase 2: Create Internal Pipeline Type Schemas
Add Zod schemas for internal types in `evolution/src/lib/schemas.ts`:

1. `variantSchema` (renamed from TextVariation) — id, text, version, parentIds, strategy, timestamps, fromArena
2. `v2StrategyConfigSchema` — generationModel, judgeModel, iterations, budgetUsd
3. `evolutionConfigSchema` — iterations (1-100), budgetUsd (>0, ≤50), models, optional fields
4. `v2MatchSchema` — winnerId, loserId, result enum, confidence, judgeModel, reversed
5. `evolutionResultSchema` — winner, pool, ratings, matchHistory, cost, stopReason
6. `ratingSchema` — mu, sigma
7. `cachedMatchSchema` — winnerId, loserId, confidence, isDraw
8. `agentExecutionDetailSchema` — discriminated union of 11 variants by `detailType`

**Test additions to `schemas.test.ts`:**
- Test each internal schema with valid/invalid data
- Test discriminated union: one test per variant (11 tests), test rejection of unknown `detailType`

**Barrel updates:**
- `evolution/src/lib/pipeline/index.ts` — re-export pipeline-specific schemas (evolutionConfigSchema, v2MatchSchema, etc.)

**Validation:** lint, tsc, build, `npx jest evolution/src/lib/schemas.test.ts`

### Phase 3: Replace Service Type Definitions with Schema-Derived Types
Update service files to derive types from schemas instead of manual interfaces.

**Files to update:**
- `evolution/src/services/evolutionActions.ts` — replace `EvolutionRun`, `EvolutionVariant`, `RunLogEntry`, `VariantListEntry` interfaces with `z.infer` + enriched extensions
- `evolution/src/services/arenaActions.ts` — replace `ArenaTopic`, `ArenaEntry`, `ArenaComparison`, `PromptListItem`
- `evolution/src/services/strategyRegistryActionsV2.ts` — replace `StrategyListItem`
- `evolution/src/services/invocationActions.ts` — replace `InvocationListEntry`, `InvocationDetail`
- `evolution/src/services/variantDetailActions.ts` — replace `VariantFullDetail`, `VariantRelative`, `LineageEntry`
- `evolution/src/lib/types.ts` — replace `TextVariation`, `Critique`, `MetaFeedback` interfaces with `z.infer`; rename `TextVariation` → `Variant` (see rename sub-task below)
- `evolution/src/lib/pipeline/infra/types.ts` — replace `V2Match`, `EvolutionConfig`, `V2StrategyConfig`, `EvolutionResult`

**Pattern for enriched service types:**
```typescript
// Base from schema
export type EvolutionRunRow = z.infer<typeof evolutionRunFullDbSchema>;
// Enriched for service layer
export type EvolutionRun = EvolutionRunRow & { total_cost_usd: number; strategy_name: string | null; };
```

**Handling `as SomeType` assertions on DB results:**
- For simple SELECTs returning base rows: remove `as` cast, let Supabase SDK infer the type. The `z.infer` derived type from the FullDb schema ensures structural compatibility.
- For enriched types (EvolutionRun with joined fields): cast the Supabase result to the base `EvolutionRunRow`, then build the enriched type explicitly in application code.
- For aggregated/counted results: keep minimal `as` where Supabase SDK can't infer (e.g., `count` from `{ count: 'exact' }`).

**Test migration strategy (76 test files may import these types):**
- Phase 3 is done **one service file at a time**, running tests after each.
- Old type names are preserved as type aliases (e.g., `export type EvolutionRun = EvolutionRunRow & { ... }`), so existing test imports continue to work without changes.
- Test files that construct mock data matching these types: update to use `createValidRow()` factory from `schemas.test.ts` fixtures, or adjust field names if schema renames any.
- After all service files updated and tests green, do a final pass removing any unused intermediate aliases.

**Rename: `TextVariation` → `Variant` (done as part of Phase 3)**
Rename the core in-memory variant type across the codebase:
- `TextVariation` → `Variant` (type name)
- `CreateTextVariationParams` → `CreateVariantParams`
- `createTextVariation` → `createVariant` (factory function)
- `textVariationSchema` → `variantSchema` (in schemas.ts from Phase 2)
- Scope: 78 occurrences across 17 files (pipeline, shared, types, barrel exports)
- Add deprecated re-export in `types.ts`: `/** @deprecated Use Variant */ export type TextVariation = Variant;`
- Remove deprecated alias after all tests pass
- Run `npx jest --forceExit` after rename to catch any missed references

**Validation:** lint, tsc, build after EACH service file. Run full unit suite: `npx jest --forceExit`. Run integration tests: `npm run test:integration:evolution`.

### Phase 4: Add Write Validation
Add validation before every DB write operation.

**Error handling strategy for writes:**
- Pipeline writes (finalize, invocations, logs, strategy upsert): use `.parse()` — let errors propagate. Pipeline already has error handling that marks runs as failed. A validation error here indicates a bug, not bad user input.
- Service action writes (arena CRUD, strategy CRUD, run creation): use `.safeParse()` — return user-friendly error message. These are trust boundaries with admin UI input.
- Fire-and-forget writes (run logs): use `.safeParse()` — log warning on failure, don't throw. Logging should never crash the pipeline.

**Legacy data compatibility:** Schemas use `.passthrough()` on JSONB fields to tolerate extra fields from older pipeline versions. Required fields use `.default()` where a safe default exists, to avoid rejecting legacy data shapes.

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
if (!configParsed.success) {
  logger.warn('Invalid strategy config in DB', {
    strategyId: strategyRow.id,
    error: configParsed.error.message,
  });
  return { error: 'Strategy has invalid config' };
}
const config = configParsed.data;
```

**Read validation must always log** at warn/error level when data fails validation — this surfaces data corruption in production monitoring. Never silently swallow parse failures.

**Validation:** lint, tsc, build. Run all unit + integration tests.

### Phase 6: Fix Script Import Issues
Fix TypeScript issues in evolution/scripts/.

1. `evolution/scripts/processRunQueue.ts` — replace `@/` alias imports with relative paths (matching run-evolution-local.ts pattern). Scripts run via `tsx` which resolves tsconfig paths, but `tsc --noEmit` with `tsconfig.ci.json` also checks these files, so relative paths are the safe approach.
2. `evolution/scripts/run-evolution-local.ts` and `backfill-strategy-config-id.ts` — fix default imports. Root `tsconfig.json` has `esModuleInterop: true` (confirmed), so default imports should work. The tsc errors are likely a `moduleResolution: bundler` issue (bundler resolution doesn't auto-resolve .js extensions for CJS modules). Fix by investigating the actual tsc error during execution — if it's moduleResolution, use named imports: `import { config } from 'dotenv'` / `import { readFileSync } from 'fs'` / `import { join } from 'path'`.
3. Fix any remaining iterator issues if they surface in tsc

**Validation:** lint, tsc (including `npx tsc -p tsconfig.ci.json --noEmit` to cover scripts), build. Run script test files: `npx jest evolution/scripts/`. Verify scripts execute: `npx tsx evolution/scripts/run-evolution-local.ts --help` (expects no env vars for --help)

### Phase 7: Remove Remaining `any` and Type Assertions
Clean up the 4 `any` usages in production code and reduce unsafe internal assertions.

1. `evolution/src/lib/shared/hashStrategyConfig.ts:56` — `[...agents].sort() as AgentName[]` → validate with schema
2. `evolution/src/lib/pipeline/claimAndExecuteRun.ts:140` — `as AllowedLLMModelType` → validate against enum
3. Remaining `as string` casts in visualization/cost analytics — derive from schema types
4. `as unknown as` patterns in experimentMetrics.ts and manageExperiments.ts — replaced by Phase 5

**Validation:** lint, tsc, build. Full test suite (unit + integration).

## Testing

### New Tests — `evolution/src/lib/schemas.test.ts`
Created in Phase 1, expanded in Phase 2.

**Test fixture factory:**
```typescript
// Helper that returns valid data for any table schema
function createValidRow(schema: string): Record<string, unknown> { ... }
```
One factory per table, returning realistic mock data matching DB column types.

**Test structure (per schema):**
1. `it('parses valid [table] row')` — pass `createValidRow()` through `.parse()`
2. `it('rejects missing required fields')` — omit required field, expect ZodError
3. `it('rejects invalid enum values')` — e.g., status: 'bogus'
4. `it('handles nullable fields')` — null vs undefined vs missing
5. `it('InsertSchema rejects auto-generated fields')` — id, created_at should not be in insert schema
6. `it('FullDbSchema requires auto-generated fields')` — id, created_at required

**Discriminated union tests (11 variants):**
- One `it()` per ExecutionDetail variant with realistic mock data
- One `it('rejects unknown detailType')` test

**Estimated test count:** ~80-100 test cases.

### Existing Test Migration (Phase 3)
- 76 test files exist; most import types from service files
- Type aliases preserve backward compatibility, so most tests need zero changes
- Tests that construct mock objects matching old interfaces: verify field names still match
- Run full suite incrementally: after each service file update in Phase 3

### Test Commands Per Phase
| Phase | Command | Purpose |
|-------|---------|---------|
| 1-2 | `npx jest evolution/src/lib/schemas.test.ts` | New schema tests |
| 3 | `npx jest --forceExit` (after each file) | Catch import/type regressions |
| 4 | `npx jest --forceExit` + `npm run test:integration:evolution` | Write validation doesn't break pipeline |
| 5 | `npx jest --forceExit` + `npm run test:integration:evolution` | Read validation doesn't break services |
| 6 | `npx jest evolution/scripts/` | Script tests pass |
| 7 | `npx jest --forceExit` | Full suite clean |
| Final | `npm run test:e2e -- --grep "evolution"` | E2E still works end-to-end |

### Manual Verification (on stage after all phases)
- Verify admin UI pages still load (runs, experiments, arena, strategies, variants, invocations)
- Verify evolution pipeline can execute a run on stage (claim → execute → finalize)
- Check logs for any new Zod validation warnings (indicates data shape issues)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` — add schemas.ts to code layout section
- `evolution/docs/evolution/architecture.md` — add note about Zod validation at trust boundaries
- `evolution/docs/evolution/data_model.md` — add "Type Hierarchy" section referencing schemas.ts, document InsertSchema/FullDbSchema pattern
- `evolution/docs/evolution/reference.md` — add schemas.ts to Key Files table, update type definitions section
