# Typescript Enforcement Evolution Research

## Problem Statement
Add strict TS checks, remove @ts-nocheck, and fix type errors in evolution. Every entity in DB should have a corresponding entry in a schema.ts file for evolution which validates all reads and writes. Every function should have full TypeScript type annotations.

## Requirements (from GH Issue #776)
- Add strict TypeScript checks across the evolution pipeline
- Remove all @ts-nocheck directives
- Fix all type errors in evolution/
- Every DB entity must have a corresponding Zod schema entry in a schema.ts file for evolution
- All reads and writes to DB entities must be validated against their Zod schemas
- Every function must have full TypeScript type annotations (parameters, return types)

## High Level Summary

The evolution subsystem is already in **good TypeScript shape** — strict mode is enabled, no @ts-nocheck directives exist, and function annotations are thorough. The primary gap is **missing Zod schemas for DB entities**: only 1 of 11 tables has Zod validation (EvolutionRunSummary). There are 122 Supabase `.from()` calls across 24 files, with ~27 type assertions (`as SomeType`) on DB read results that should be replaced with schema validation. The main app's schema pattern (InsertSchema → FullDbSchema → z.infer) provides a clear template to follow.

## Key Findings

### 1. TypeScript Strictness: Already Enabled
- Root `tsconfig.json` has `strict: true`; evolution inherits it (no separate tsconfig)
- **0 @ts-nocheck, @ts-ignore, or @ts-expect-error** directives in evolution/
- Only **4 explicit `any` usages** in production code (all minor)
- Only **2 tsc errors** — both stale `.next/types/` artifacts, not source errors
- All exported functions have explicit return type annotations

### 2. Zod Schema Coverage: Major Gap
**What EXISTS (11 schemas):**
- `EvolutionRunSummaryV3Schema` / V2 / V1 + union (evolution/src/lib/types.ts) — validates run_summary JSONB
- `createTopicSchema`, `createPromptSchema`, `updatePromptSchema` (arenaActions.ts) — input validation
- `listVariantsInputSchema` (evolutionActions.ts) — pagination input
- `listInvocationsInputSchema` (invocationActions.ts) — pagination input
- `createStrategySchema`, `updateStrategySchema` (strategyRegistryActionsV2.ts) — CRUD input

**What's MISSING — DB row schemas for all 11 tables:**
| Table | TS Type Exists | Zod Schema | Read Validation | Write Validation |
|-------|---------------|------------|-----------------|------------------|
| evolution_strategies | StrategyListItem | ❌ | ❌ (5 `as` casts) | ❌ |
| evolution_prompts | ArenaTopic, PromptListItem | ❌ | ❌ (5 `as` casts) | ❌ |
| evolution_experiments | (generic Record) | ❌ | ❌ | ❌ |
| evolution_runs | EvolutionRun | ❌ | ❌ (4 `as` casts) | ❌ |
| evolution_variants | EvolutionVariant, ArenaEntry | ❌ | ❌ (4 `as` casts) | ❌ |
| evolution_agent_invocations | InvocationListEntry | ❌ | ❌ (2 `as` casts) | ❌ |
| evolution_run_logs | RunLogEntry | ❌ | ❌ (1 `as` cast) | ❌ |
| evolution_arena_comparisons | ArenaComparison | ❌ | ❌ (1 `as` cast) | ❌ |
| evolution_budget_events | BudgetEventLogger | ❌ | ❌ | ❌ |
| evolution_explanations | (none) | ❌ | ❌ | ❌ |

### 3. Type Assertions: 27 on DB Results + ~93 Internal
- **27 critical assertions** on Supabase query results need Zod replacement
- Heaviest files: evolutionActions.ts (7), arenaActions.ts (10), strategyRegistryActionsV2.ts (5)
- **~93 internal assertions** (config casts, map entries, etc.) — lower priority

### 4. Pipeline Type Definitions: No Schemas
Key pipeline types defined as interfaces only (no Zod equivalents):
- `TextVariation` — core in-memory variant (evolution/src/lib/types.ts)
- `V2StrategyConfig` — strategy config JSONB (evolution/src/lib/pipeline/infra/types.ts)
- `EvolutionConfig` — runtime config (evolution/src/lib/pipeline/infra/types.ts)
- `V2Match` — match history entry (evolution/src/lib/pipeline/infra/types.ts)
- `EvolutionResult` — pipeline return value
- 11 `*ExecutionDetail` discriminated union types — persisted as JSONB

### 5. Main App Schema Pattern to Follow
From `src/lib/schemas/schemas.ts`:
```typescript
// 1. Insert schema (input fields only)
export const entityInsertSchema = z.object({ ... });
// 2. Full DB schema (extends insert + auto-generated fields)
export const entityFullDbSchema = entityInsertSchema.extend({ id: z.string().uuid(), created_at: z.string() });
// 3. Types derived from schemas
export type EntityInsertType = z.infer<typeof entityInsertSchema>;
export type EntityFullDbType = z.infer<typeof entityFullDbSchema>;
```
- Writes: always `safeParse()` before insert/update
- Reads from RPCs: always `safeParse()` on result
- Simple table SELECTs: no runtime validation needed (trust Supabase types)

### 6. Codebase Scale
- **81 production files**, 76 test files (157 total)
- **210 exported functions** (services: 89, pipeline: 82, shared: 39)
- **122 Supabase `.from()` calls** in production code
- **120 type assertions** total in production code
- Test framework: Jest with ts-jest (not Vitest)

### 7. Script Issues
- evolution/scripts/ has 3 main scripts + 1 lib file
- No @ts-nocheck but some import resolution issues (processRunQueue.ts uses @/ aliases)
- Default import issues for dotenv/fs/path in run-evolution-local.ts and backfill-strategy-config-id.ts
- Iterator issues in some evolution/src files (Map iteration needs downlevelIteration or ES2015+ target)

### 8. Service Type Definitions (All Interfaces, No Schemas)
Types defined inline in service files, not in a central schema:
- `EvolutionRun` (evolutionActions.ts:16-36) — enriched with cost/names
- `EvolutionVariant` (evolutionActions.ts:38-49)
- `RunLogEntry` (evolutionActions.ts:57-66)
- `VariantListEntry` (evolutionActions.ts:77-88)
- `ArenaTopic` (arenaActions.ts:11-18) — enriched with entry_count
- `ArenaEntry` (arenaActions.ts:20-35)
- `ArenaComparison` (arenaActions.ts:37-47)
- `PromptListItem` (arenaActions.ts:203-211)
- `StrategyListItem` (strategyRegistryActionsV2.ts:13-29)
- `InvocationListEntry` / `InvocationDetail` (invocationActions.ts:11-35)
- `VariantFullDetail`, `VariantRelative`, `LineageEntry` (variantDetailActions.ts:10-49)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs
- evolution/docs/evolution/README.md — reading order, code layout
- evolution/docs/evolution/architecture.md — V2 pipeline, entry points, 3-op loop
- evolution/docs/evolution/data_model.md — 11 tables, RPCs, type hierarchy, migrations
- evolution/docs/evolution/reference.md — file inventory, CLI, config, testing, admin UI

## Code Files Read
- evolution/src/lib/types.ts — core types + only Zod schemas (RunSummary V1/V2/V3)
- evolution/src/lib/pipeline/infra/types.ts — V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig
- evolution/src/lib/pipeline/setup/buildRunContext.ts — DB reads for strategy, content, arena
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — DB writes for variants, run completion, arena sync
- evolution/src/lib/pipeline/infra/trackInvocations.ts — invocation create/update
- evolution/src/lib/pipeline/infra/createRunLogger.ts — log writes
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts — strategy upsert
- evolution/src/lib/pipeline/manageExperiments.ts — experiment CRUD
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — run claim, heartbeat, failure marking
- evolution/src/services/evolutionActions.ts — run/variant/log server actions + types
- evolution/src/services/arenaActions.ts — arena topic/entry/comparison actions + types
- evolution/src/services/strategyRegistryActionsV2.ts — strategy CRUD + types
- evolution/src/services/variantDetailActions.ts — variant detail/lineage + types
- evolution/src/services/invocationActions.ts — invocation list/detail + types
- evolution/src/services/experimentActionsV2.ts — experiment actions
- evolution/src/services/evolutionVisualizationActions.ts — visualization data
- evolution/src/services/costAnalytics.ts — cost breakdowns
- evolution/src/experiments/evolution/experimentMetrics.ts — metrics computation
- evolution/src/lib/shared/hashStrategyConfig.ts — strategy config types
- evolution/src/lib/shared/computeRatings.ts — rating types
- src/lib/schemas/schemas.ts — main app schema patterns
- src/lib/services/sourceCache.ts — write validation pattern
- src/lib/services/tags.ts — read/update validation pattern
- tsconfig.json, tsconfig.ci.json, jest.config.js — build/test config

## Open Questions
1. Should we validate simple table SELECTs at runtime (main app doesn't), or only writes and RPC results?
2. Should pipeline-internal types (TextVariation, EvolutionConfig) also get Zod schemas, or only DB-facing types?
3. Should the new schemas live in a single `evolution/src/lib/schemas.ts` or split per domain (e.g., `schemas/runs.ts`, `schemas/arena.ts`)?
4. The 11 ExecutionDetail discriminated union types are complex — validate on write only, or also on read?
5. Script import issues (processRunQueue.ts @/ aliases, default imports) — fix in this project or separate?
