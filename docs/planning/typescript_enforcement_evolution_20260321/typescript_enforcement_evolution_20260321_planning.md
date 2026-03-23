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
- Add ESLint rules: `no-explicit-any`, `no-unsafe-*`, `consistent-type-assertions`, `explicit-function-return-type` for evolution/
- Enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` in tsconfig
- Add pre-commit hook blocking `@ts-ignore`, `@ts-nocheck`, `as any` in evolution/

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
schemas.ts  (NEW — all Zod schemas; may import from main app e.g. AllowedLLMModelType from '@/lib/schemas/schemas'; zero imports from types.ts)
    ↓ exports schemas + z.infer types
types.ts    (re-exports from schemas.ts for backward compat; defines non-schema interfaces like ExecutionContext)
    ↓ re-exports
lib/index.ts (barrel — re-exports schemas, types, and schema values for runtime use)
    ↓ re-exports
pipeline/index.ts (barrel — re-exports pipeline-specific schemas)
```

**Key rules:**
- `schemas.ts` must NOT import from `types.ts`. `types.ts` imports from `schemas.ts`. This prevents circular dependencies.
- `schemas.ts` MAY import from the main app's `@/lib/schemas/schemas` (e.g., `AllowedLLMModelType` for model validation in `v2StrategyConfigSchema`). This is a one-way cross-boundary import and is safe.
- `schemas.ts` MAY define `ratingSchema` independently (re-deriving `{ mu: number, sigma: number }`) rather than importing from `shared/computeRatings.ts`, to keep the dependency graph clean.
- Move `EvolutionRunSummarySchema` (V1/V2/V3) from `types.ts` into `schemas.ts`.

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

Each phase is committed separately. Multi-file phases (3a, 3b, 4) use one commit per file. If a phase breaks CI:
1. For single-commit phases: `git revert <commit>` to restore last green state
2. For multi-commit phases (3a has 7 commits, 3b has 1, 4 has ~9): revert all phase commits in reverse order, or revert only the offending file's commit if the break is isolated
3. Fix the issue, re-commit

Phase 3a (type replacement) is highest risk. Mitigations:
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

### Phase 3a: Replace Service Type Definitions with Schema-Derived Types
Update service files to derive types from schemas instead of manual interfaces. Done **one service file at a time** with a separate commit per file.

**Files to update (in order):**
1. `evolution/src/lib/pipeline/infra/types.ts` — replace `V2Match`, `EvolutionConfig`, `V2StrategyConfig`, `EvolutionResult` with `z.infer`. This file is imported by 22 pipeline files, so do it first to flush out issues early.
2. `evolution/src/lib/types.ts` — replace `TextVariation`, `Critique`, `MetaFeedback` interfaces with `z.infer`
3. `evolution/src/services/evolutionActions.ts` — replace `EvolutionRun`, `EvolutionVariant`, `RunLogEntry`, `VariantListEntry`
4. `evolution/src/services/arenaActions.ts` — replace `ArenaTopic`, `ArenaEntry`, `ArenaComparison`, `PromptListItem`
5. `evolution/src/services/strategyRegistryActionsV2.ts` — replace `StrategyListItem`
6. `evolution/src/services/invocationActions.ts` — replace `InvocationListEntry`, `InvocationDetail`
7. `evolution/src/services/variantDetailActions.ts` — replace `VariantFullDetail`, `VariantRelative`, `LineageEntry`

**Barrel updates:**
- `evolution/src/lib/pipeline/index.ts` — update re-exports for renamed types from `infra/types.ts`

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
- Old type names are preserved as type aliases (e.g., `export type EvolutionRun = EvolutionRunRow & { ... }`), so existing test imports continue to work at compile time.
- **Runtime impact:** Phase 3a does NOT add `.parse()` calls — it only changes type definitions. Existing test mocks are unaffected at runtime. Runtime validation impact is deferred to Phases 4-5.
- Test files that construct mock data: verify field names still match after schema-derived types replace interfaces.
- After all 7 files updated and tests green, do a final pass removing any unused intermediate aliases.

**Validation per file:** lint, tsc, build, `npx jest --forceExit`. After all files: `npm run test:integration:evolution`.

### Phase 3b: Rename `TextVariation` → `Variant` (separate commit)
Rename the core in-memory variant type across the codebase. Done as a separate sub-phase from 3a so each can be reverted independently.

**Renames:**
- `TextVariation` → `Variant` (type name)
- `CreateTextVariationParams` → `CreateVariantParams`
- `createTextVariation` → `createVariant` (factory function)
- Schema already named `variantSchema` from Phase 2

**Scope:** 100 occurrences across 23 files:
- 17 source files in `evolution/src/` (pipeline, types, barrel exports)
- 6 doc files in `evolution/docs/` (reference.md, architecture.md, arena.md, agents/overview.md, cost_optimization.md, data_model.md)

**Backward compat re-exports in `types.ts`:**
```typescript
/** @deprecated Use Variant */ export type TextVariation = Variant;
/** @deprecated Use CreateVariantParams */ export type CreateTextVariationParams = CreateVariantParams;
/** @deprecated Use createVariant */ export const createTextVariation = createVariant;
```

**Test file impact inventory:**
- Files importing `TextVariation` type: compile-time safe via deprecated re-export
- Files calling `createTextVariation()`: runtime safe via re-exported function alias
- Files constructing `TextVariation` literal objects: unaffected (field names don't change, only the type name)
- Remove deprecated aliases after full test suite passes

**Validation:** lint, tsc, build, `npx jest --forceExit`, `npm run test:integration:evolution`.

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

**Test mock audit (critical):**
Adding `.parse()` to write paths means existing tests that mock Supabase and supply write payloads must now provide schema-conforming data. Before writing validation code:
1. Run `grep -r "\.insert\|\.upsert\|\.update" evolution/src --include="*.test.ts" -l` to inventory test files with write mocks
2. For each test file, verify mock payloads match the new InsertSchema
3. Update mocks to use `createValidRow()` factories from `evolution/src/testing/schema-fixtures.ts` (shared test utility, NOT imported from schemas.test.ts)
4. Do one write-path file at a time, run its tests immediately

**Test fixture location:** Create `evolution/src/testing/schema-fixtures.ts` with typed factories:
```typescript
export function createValidStrategyInsert(overrides?: Partial<EvolutionStrategyInsert>): EvolutionStrategyInsert { ... }
export function createValidRunInsert(overrides?: Partial<EvolutionRunInsert>): EvolutionRunInsert { ... }
// ... one per table
```
This avoids importing from test files (antipattern) and gives all test files a shared, typed fixture source.

**Validation:** lint, tsc, build. Run all unit tests. Run integration tests. Run E2E: `npm run test:e2e -- --grep "evolution"`.

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

**Null fallback consumer contract:** Every `.safeParse()` fallback-to-null site must have a documented code path for the null case. Callers must either: (a) return an error response to the client, (b) skip the operation with a log, or (c) use a safe default. Never allow null to propagate to code that assumes non-null (e.g., `config.iterations`).

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

### Phase 8: ESLint Rules for Evolution TypeScript Enforcement
Add strict TypeScript ESLint rules scoped to `evolution/` to prevent regression. Update `eslint.config.mjs`.

**New ESLint block for evolution production code:**
```javascript
// In eslint.config.mjs — after existing evolution boundary enforcement block
{
  files: ["evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
  ignores: ["**/*.test.ts", "**/*.test.tsx", "**/testing/**"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "warn",
    "@typescript-eslint/no-unsafe-return": "warn",
    "@typescript-eslint/no-unsafe-call": "warn",
    "@typescript-eslint/consistent-type-assertions": ["error", {
      assertionStyle: "never",  // ban all `as` assertions in evolution prod code
    }],
    "@typescript-eslint/explicit-function-return-type": ["warn", {
      allowExpressions: true,  // skip inline arrow functions
      allowTypedFunctionExpressions: true,
    }],
  },
},
```

**Rule severity strategy:**
- `no-explicit-any: error` — hard block. After Phase 7 cleanup, zero `any` should exist.
- `no-unsafe-assignment/return/call: warn` — start as warn, promote to error after stabilization. These catch indirect `any` propagation from third-party libs.
- `consistent-type-assertions: error` with `assertionStyle: "never"` — bans all `as` casts in evolution prod code. After Phases 3a-5 remove the 27+ DB casts, no legitimate `as` should remain. If edge cases arise, use `// eslint-disable-next-line` with justification.
- `explicit-function-return-type: warn` — evolution already has good coverage; this prevents drift.

**Note:** Test files already have `no-explicit-any: off` (line 35 of current config). The new block uses `ignores` to exclude tests, so test files keep their relaxed rules.

**Check for required dependency:** `@typescript-eslint/eslint-plugin` must be installed. Verify with `npm ls @typescript-eslint/eslint-plugin`. If the `no-unsafe-*` rules require type-aware linting, add `parserOptions.project` pointing to `tsconfig.json`.

**Validation:** `npm run lint`, fix any new violations (should be zero after Phases 1-7), tsc, build.

### Phase 9: Stricter tsconfig Options
Add stricter compiler options to `tsconfig.json`. These affect the entire codebase, not just evolution.

**Options to add:**
```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

**`noUncheckedIndexedAccess: true`:**
- `array[0]` returns `T | undefined` instead of `T`
- `record['key']` returns `V | undefined` instead of `V`
- Forces null checks on every indexed access — catches real bugs (empty arrays, missing map keys)
- **Impact:** Will surface errors across the entire codebase. Every `array[0].field` needs a null check.
- **Strategy:** Enable the flag, run `tsc --noEmit`, count errors. Fix evolution/ files first (our scope), then fix or suppress remaining files across the codebase.

**`exactOptionalPropertyTypes: true`:**
- `{ x?: string }` no longer accepts `{ x: undefined }` — must be `{ x: undefined } | { x?: string }`
- More pedantic. Useful for config objects where "not set" differs from "set to undefined".
- **Impact:** Lower than `noUncheckedIndexedAccess` but still codebase-wide.
- **Strategy:** Enable alongside `noUncheckedIndexedAccess`, fix errors together.

**Execution approach:**
1. Enable both flags in `tsconfig.json`
2. Run `npx tsc --noEmit 2>&1 | wc -l` to measure total errors
3. Fix all errors in `evolution/src/` first
4. Fix errors in `src/` (main app) — may require a second pass if count is high
5. If codebase-wide fix is too large, scope to evolution only via a `tsconfig.evolution.json` that extends root with the extra flags, and update `tsconfig.ci.json` to check evolution with the stricter config

**Validation:** tsc --noEmit (zero errors), lint, build, full test suite.

### Phase 10: Pre-commit Hook
Add a git pre-commit hook that blocks commits containing TypeScript anti-patterns in evolution/.

**Hook implementation (in `.husky/pre-commit` or equivalent):**
```bash
# Block @ts-ignore, @ts-nocheck, and 'as any' in evolution/ staged files
BLOCKED_PATTERNS="@ts-ignore|@ts-nocheck|as any"
EVOLUTION_STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep "^evolution/src/" | grep -v "\.test\." || true)

if [ -n "$EVOLUTION_STAGED" ]; then
  VIOLATIONS=$(echo "$EVOLUTION_STAGED" | xargs grep -n "$BLOCKED_PATTERNS" 2>/dev/null || true)
  if [ -n "$VIOLATIONS" ]; then
    echo "❌ Blocked: evolution/ production code must not contain:"
    echo "   - @ts-ignore"
    echo "   - @ts-nocheck"
    echo "   - as any"
    echo ""
    echo "Violations found:"
    echo "$VIOLATIONS"
    echo ""
    echo "Use proper types or // eslint-disable-next-line with justification."
    exit 1
  fi
fi
```

**Key details:**
- Only checks staged files (`--cached`) in `evolution/src/`
- Excludes test files (`grep -v "\.test\."`)
- Uses `--diff-filter=ACM` to skip deleted files
- Cheap grep — no tooling dependency
- Bypassable with `--no-verify` for emergencies (but ESLint in CI catches it anyway)

**Check if Husky is already set up:** `ls .husky/` — if not, install with `npx husky init`.

**Validation:** Stage a file with `as any` in evolution/src/, verify hook blocks. Stage a test file with `as any`, verify hook allows. Commit clean code, verify hook passes.

## Testing

### New Tests — `evolution/src/lib/schemas.test.ts`
Created in Phase 1, expanded in Phase 2.

**Test fixture factory (in schemas.test.ts — for schema tests only):**
```typescript
function createValidRow(table: string): Record<string, unknown> { ... }
```

**Shared test fixtures (in `evolution/src/testing/schema-fixtures.ts` — for all test files):**
```typescript
export function createValidStrategyInsert(overrides?: Partial<...>): EvolutionStrategyInsert { ... }
export function createValidRunFullDb(overrides?: Partial<...>): EvolutionRunFullDb { ... }
// one typed factory per table, used by Phase 4+ test mock updates
```

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

### Existing Test Migration
- **Phase 3a** (type replacement): compile-time only, no runtime changes. Type aliases preserve backward compat. Most of 76 test files need zero changes.
- **Phase 3b** (rename): deprecated re-exports for type + function. Test files constructing literal objects unaffected (field names unchanged).
- **Phase 4** (write validation): **highest test risk**. Adding `.parse()` to write paths means mock payloads must be schema-conforming. Audit all test files with `.insert`/`.upsert`/`.update` mocks. Update to use shared fixtures from `evolution/src/testing/schema-fixtures.ts`.
- **Phase 5** (read validation): `.safeParse()` with fallback. Lower risk — tests returning mock DB data may trigger warn logs but won't throw.

### CI Configuration
- No changes needed to `jest.config.js` — new files match existing `**/*.test.ts` pattern and `evolution/src/**` coverage include
- No changes needed to `tsconfig.ci.json` — already includes `evolution/src/**/*.ts`
- CI already runs `npx tsc --noEmit --project tsconfig.ci.json` (confirmed in `.github/workflows/ci.yml`) — Phase 9 tsconfig changes will be enforced automatically
- CI already runs `npm run lint` — Phase 8 ESLint rules will be enforced automatically
- New `schema-fixtures.ts` is in `evolution/src/testing/` which is already in the test infrastructure

### Test Commands Per Phase
| Phase | Command | Purpose |
|-------|---------|---------|
| 1-2 | `npx jest evolution/src/lib/schemas.test.ts` | New schema tests |
| 3a | `npx jest --forceExit` (after each file) | Catch import/type regressions |
| 3b | `npx jest --forceExit` | Rename doesn't break anything |
| 4 | `npx jest --forceExit` + `npm run test:integration:evolution` + `npm run test:e2e -- --grep "evolution"` | Write validation doesn't break pipeline or E2E |
| 5 | `npx jest --forceExit` + `npm run test:integration:evolution` | Read validation doesn't break services |
| 6 | `npx jest evolution/scripts/` | Script tests pass |
| 7 | `npx jest --forceExit` | Full suite clean |
| 8 | `npm run lint` | ESLint rules pass with zero violations |
| 9 | `npx tsc --noEmit` + `npx jest --forceExit` | Stricter tsconfig errors fixed |
| 10 | Manual test: stage `as any` in evolution/ | Pre-commit hook blocks |
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
