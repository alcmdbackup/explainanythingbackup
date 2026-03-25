# Improve Agent Template Evolution Plan

## Background
We want to ensure we have a well-thought-out and extensible template for future agents which extends Entity. It should handle metrics and logging, declare parent variant(s) and child variants as output. It should also have a well-structured detail view that can be shown on invocation detail.

## Requirements (from GH Issue #815)
- Create a well-thought-out and extensible agent template that extends Entity
- Handle metrics and logging within the agent template
- Declare parent variant(s) as input and child variants as output
- Provide a well-structured detail view for invocation detail pages

## Problem
The `Agent<TInput, TOutput>` base class has a clean template method pattern but 6 critical gaps: (1) `execution_detail` is never populated despite 11 Zod schemas being defined, which breaks invocation metrics that depend on it; (2) `duration_ms` is never tracked despite the DB column and UI support existing; (3) variant I/O is implicit — agents don't formally declare parent/child variants; (4) `executionDetailSchema` is declared as an abstract member but never used for validation; (5) the invocation detail UI renders raw JSON instead of agent-specific structured views; (6) agents cannot declare their own invocation-level metrics — InvocationEntity has 3 generic metrics that apply identically to all agent types.

## Options Considered

### Variant I/O Enforcement
1. **Compile-time via generics** (chosen) — Add `AgentOutput<TOutput, TDetail>` return type with optional `parentVariantIds`/`childVariantIds`. TypeScript catches missing fields at compile time.
2. Runtime via abstract declarations — Add abstract properties like `parentSelectionStrategy` and `outputVariantCount` checked by entity registry. More like Entity pattern but doesn't catch errors at compile time.
3. Both — Compile-time types + runtime declarations. Over-engineered for current needs.

### Execute Return Type
1. **execute() returns AgentOutput** (chosen) — Breaking change to `execute()` signature, but only 2 concrete agents + 1 TestAgent exist so migration is trivial. Clean data flow: agent builds detail + variant IDs, run() handles infrastructure.
2. Optional field on AgentResult — Backward compatible but loses type safety on detail shape. Relies on agents to populate correctly.
3. Separate detail assembly step — Requires passing intermediate state through multiple functions. Messy coupling.

### Detail View Rendering
1. Per-agent React components with dispatcher — One component switches on `detailType`, renders custom JSX per agent. Flexible but nothing enforces that new agents provide a view — they silently fall back to raw JSON.
2. Agent-registered React components — Each agent exports a React component via static property. Mixes server/client concerns since Agent classes are server-side.
3. **Config-driven rendering with compile-time enforcement** (chosen) — Each agent declares an abstract `detailViewConfig: DetailFieldDef[]` that describes how its execution_detail fields should be rendered. The UI dispatcher reads this config and renders generically (tables, badges, booleans, links). No per-agent React components needed. TypeScript enforces every agent declares a config (abstract member = compile-time error if missing). Adding an agent = adding a `detailViewConfig` and the UI works automatically. Requires Zod parsing of raw `Record<string, unknown>` from DB to safely narrow to typed detail before rendering.

### Agent-Level Metrics
1. Agent declares metrics independently, writes them in `run()` — **Rejected**: bypasses the entity registry entirely. UI, validation, and propagation all break because the registry doesn't know these metrics exist. Creates a shadow metric system.
2. InvocationEntity gets agent-specific metrics with `detailType` checks — **Rejected**: InvocationEntity becomes a god object. Every new agent adds code there. Violates open/closed principle — adding an agent means editing InvocationEntity.
3. **Agents declare `invocationMetrics`, merged into InvocationEntity at registry init** (chosen) — Each agent declares `invocationMetrics: FinalizationMetricDef[]`. At entity registry initialization, these are collected from a manual `AGENT_CLASSES` array (not automatic scanning) and merged into InvocationEntity's metric registry. The registry sees the full set, so validation works, UI displays them, and propagation to parent entities (strategy/experiment) works. Adding an agent = declaring metrics in the agent file + adding to `AGENT_CLASSES` array.

### Logging Integration
`Agent.run()` already logs start/complete via `ctx.logger` (EntityLogger). New additions: log `durationMs` in completion message, log warning if schema validation fails. No structural changes to logging architecture. Agents can also log within `execute()` via `ctx.logger` for domain-specific events (e.g., "Strategy X failed format validation").

### Relationship: Agent ↔ InvocationEntity
Every agent execution **is** an invocation row — there's a 1:1 mapping. `GenerationAgent.run()` creates an invocation row that InvocationEntity manages. This means agents are natural extensions of InvocationEntity for metrics purposes. An agent's `invocationMetrics` are invocation-level metrics scoped by `agent_name`. The wiring gap today is that InvocationEntity has a flat list of 3 metrics applying to all invocations regardless of agent type, and there's no mechanism to say "these metrics only apply when `agent_name = 'generation'`."

### Existing Metrics That Will Start Working
InvocationEntity's 3 finalization metrics (`best_variant_elo`, `avg_variant_elo`, `variant_count`) read `execution_detail.strategies[].variantId` to discover which variants an invocation produced. They return null today because execution_detail is never populated. Once we populate it, these metrics start working automatically — no changes needed to these specific compute functions.

## Phased Execution Plan

### Phase 1: Core Types + Infrastructure (atomic)
**Files:** `evolution/src/lib/types.ts`, `evolution/src/lib/core/types.ts`, `evolution/src/lib/core/Agent.ts`, `evolution/src/lib/pipeline/infra/trackInvocations.ts`

**Prerequisite fixes:**
- **Export `ExecutionDetailBase`** from `evolution/src/lib/types.ts` — currently a non-exported interface, needed for the `TDetail extends ExecutionDetailBase` generic constraint

**trackInvocations.ts changes (must happen atomically with Agent.ts):**
- Add `duration_ms?: number` to `updateInvocation()` updates param
- Include in `.update()` call: `duration_ms: updates.duration_ms ?? null`
- No DB migration needed — `duration_ms` column already exists in `evolutionAgentInvocationInsertSchema`

**types.ts changes:**
- Add `AgentOutput<TOutput, TDetail extends ExecutionDetailBase>` interface:
  ```typescript
  export interface AgentOutput<TOutput, TDetail extends ExecutionDetailBase> {
    result: TOutput;
    detail: TDetail;
    parentVariantIds?: string[];
    childVariantIds?: string[];
  }
  ```
- Add `durationMs: number` to `AgentResult<T>`

**Agent.ts changes:**
- Add 3rd generic: `Agent<TInput, TOutput, TDetail extends ExecutionDetailBase>`
- Change `execute()` return type to `Promise<AgentOutput<TOutput, TDetail>>`
- Add optional `invocationMetrics: FinalizationMetricDef[]` to Agent base class (default empty array)
- Add **abstract** `detailViewConfig: DetailFieldDef[]` — compile-time enforcement that every agent declares how its execution detail is rendered in the UI
- Add `DetailFieldDef` type to `evolution/src/lib/core/types.ts`:
  ```typescript
  export interface DetailFieldDef {
    key: string;           // field path in execution_detail (e.g., 'strategies', 'feedbackUsed', 'fineRanking.rounds')
    label: string;         // display label
    type: 'table' | 'boolean' | 'badge' | 'number' | 'text' | 'list' | 'object';
    columns?: string[];    // for type: 'table' — which sub-fields to show as columns
    children?: DetailFieldDef[]; // for type: 'object' — nested field definitions
    formatter?: string;    // optional formatter name ('cost', 'integer', 'percent', etc.)
  }
  ```
  Note: `formatter` is typed as `string` (not `MetricFormatter`) to avoid importing server-only types into UI-safe modules. The renderer maps formatter strings to format functions at runtime.
- In `run()`:
  - Add `const startMs = Date.now()` before execute()
  - Destructure: `const { result, detail, parentVariantIds, childVariantIds } = output`
  - Patch: `detail.totalCost = cost` (overwrite placeholder with actual — agents must return mutable detail objects)
  - Validate: `this.executionDetailSchema.safeParse(detail)` — log warning on failure. **Skip validation on error paths** where detail is null (do not call safeParse with null).
  - Compute: `const durationMs = Date.now() - startMs`
  - Pass `execution_detail: detail as Record<string, unknown>`, `duration_ms: durationMs` to `updateInvocation()`
  - Include `durationMs` in returned AgentResult
  - Error paths: still compute durationMs, pass to updateInvocation with `execution_detail: null`, include durationMs in AgentResult
- Log `durationMs` in completion message

### Phase 2: Agent-Level Metrics Registration
**Files:** `evolution/src/lib/core/agentRegistry.ts` (new), `evolution/src/lib/core/entityRegistry.ts`, `evolution/src/lib/core/metricCatalog.ts`

**Agent discovery mechanism — explicit `AGENT_CLASSES` array:**
- Create new file `evolution/src/lib/core/agentRegistry.ts` to avoid circular dependencies (entityRegistry imports entities; entities don't import agents; agentRegistry imports agents; entityRegistry imports agentRegistry):
  ```typescript
  // agentRegistry.ts — manual agent class registry for metric merging
  import { GenerationAgent } from './agents/GenerationAgent';
  import { RankingAgent } from './agents/RankingAgent';
  import type { Agent } from './Agent';

  export const AGENT_CLASSES: Agent<unknown, unknown, any>[] = [
    new GenerationAgent(),
    new RankingAgent(),
  ];
  ```
- In `entityRegistry.ts`, at init time after entity registration:
  - Import `AGENT_CLASSES` from `./agentRegistry` (no circular dep — agentRegistry only imports Agent subclasses, not entities)
  - Collect `invocationMetrics` from each agent class
  - Merge into InvocationEntity's `metrics.atFinalization` array
  - `validateEntityRegistry()` runs AFTER merge, so it sees the full set

**METRIC_CATALOG updates:**
- Add new agent metric entries to `METRIC_CATALOG` in `metricCatalog.ts`:
  - `format_rejection_rate` (category: count, formatter: percent)
  - `total_comparisons` (category: count, formatter: integer)
  - Any other agent-specific metrics
- This is required because `entities.test.ts` cross-references all metric names against METRIC_CATALOG

**Metric compute function safety:**
- All agent metric compute functions must guard `currentInvocationId` with a null check, NOT a non-null assertion:
  ```typescript
  compute: (ctx) => {
    if (!ctx.currentInvocationId || !ctx.invocationDetails) return null;
    const detail = ctx.invocationDetails.get(ctx.currentInvocationId);
    if (!detail || detail.detailType !== 'generation') return null;
    // ... compute ...
  }
  ```

### Phase 3: Concrete Agent Adaptation
**Files:** `generateVariants.ts`, `GenerationAgent.ts`, `rankVariants.ts`, `RankingAgent.ts`

**`generateVariants()` return type change:**
- Add `GenerationStrategyResult` type and `GenerationResult` interface
- Return `GenerationResult { variants: Variant[], strategyResults: GenerationStrategyResult[] }` instead of `Variant[]`
- Track per-strategy: name, promptLength, status, variantId, textLength, error, formatIssues
- **All callers must be updated:** `GenerationAgent.ts`, `compose.test.ts`, `generateVariants.test.ts`

**GenerationAgent:**
- `Agent<GenerationInput, Variant[], GenerationExecutionDetail>`
- `execute()` returns `AgentOutput` with detail built from `GenerationResult.strategyResults`
- Sets `childVariantIds` from produced variants, `parentVariantIds` as empty
- Declares `invocationMetrics` (e.g., `format_rejection_rate`)
- Declares `detailViewConfig`:
  ```typescript
  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'strategies', label: 'Strategies', type: 'table', columns: ['name', 'status', 'variantId', 'promptLength', 'textLength'] },
    { key: 'feedbackUsed', label: 'Feedback Used', type: 'boolean' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];
  ```

**`rankPool()` return type change:**
- Build `RankingExecutionDetail` from internal triage/fine-ranking state
- Return extended result including `executionDetail` alongside existing RankResult fields
- **All callers must be updated:** `RankingAgent.ts`, `rankVariants.test.ts`, `compose.test.ts`

**RankingAgent:**
- `Agent<RankingInput, RankResult, RankingExecutionDetail>`
- `execute()` returns `AgentOutput` with detail from rankPool's extended result
- Sets `parentVariantIds` from `input.pool`, no `childVariantIds`
- Declares `invocationMetrics` (e.g., `total_comparisons`)
- Declares `detailViewConfig`:
  ```typescript
  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'triage', label: 'Triage Results', type: 'table', columns: ['variantId', 'eliminated', 'opponents'] },
    { key: 'fineRanking', label: 'Fine Ranking', type: 'object', children: [
      { key: 'rounds', label: 'Rounds', type: 'number', formatter: 'integer' },
      { key: 'exitReason', label: 'Exit Reason', type: 'badge' },
      { key: 'convergenceStreak', label: 'Convergence Streak', type: 'number', formatter: 'integer' },
    ]},
    { key: 'budgetTier', label: 'Budget Tier', type: 'badge' },
    { key: 'totalComparisons', label: 'Total Comparisons', type: 'number', formatter: 'integer' },
    { key: 'eligibleContenders', label: 'Eligible Contenders', type: 'number', formatter: 'integer' },
  ];
  ```

**persistRunResults.ts update:**
- Ensure the invocation query for `invocationDetails` map includes ALL agent types (currently may filter to `agent_name = 'generation'` only). Remove agent_name filter so ranking and future agent details are available for metric computation.

### Phase 4: Caller Updates
**File:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts`

- Minimal changes — `AgentResult.result` types unchanged (`Variant[]` and `RankResult`)
- Access `durationMs` from result if needed for logging

### Phase 5: Tests (comprehensive file list)
**All test files affected by this change:**

| File | Reason |
|------|--------|
| `evolution/src/lib/core/Agent.test.ts` | TestAgent needs 3 type params, execute() returns AgentOutput, **must declare `detailViewConfig`** (abstract member), verify execution_detail + duration_ms passed to updateInvocation, schema validation warning test, durationMs in AgentResult |
| `evolution/src/lib/core/entities/entities.test.ts` | Hardcoded metric count for InvocationEntity will increase after agent metric merge. Update assertion. Verify agent metrics appear in registry. METRIC_CATALOG cross-reference test needs new entries. |
| `evolution/src/lib/pipeline/loop/generateVariants.test.ts` | All 7+ tests assert `Variant[]` return — update for `GenerationResult` |
| `evolution/src/lib/pipeline/loop/rankVariants.test.ts` | Update for extended return type including `executionDetail` |
| `evolution/src/lib/pipeline/loop/compose.test.ts` | Calls `generateVariants()` directly — update for `GenerationResult` return |
| `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` | Exercises full generate→rank loop via Agent.run() — verify new fields in mock DB update chain |
| `evolution/src/lib/pipeline/infra/trackInvocations.test.ts` | updateInvocation signature gains `duration_ms` — update mock assertions |
| `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` | Invocation metrics compute after agent merge — may need execution_detail in mock data |
| `evolution/src/lib/metrics/computations/finalizationInvocation.test.ts` | Verify compatibility after agent metric merge; test with populated execution_detail |

**New test cases to add:**
- Schema validation failure path: agent returns detail that doesn't match schema → verify `logger.warn` called
- `parentVariantIds`/`childVariantIds` flow through to updateInvocation
- Agent metrics in merged registry: `getEntity('invocation').metrics.atFinalization` includes agent-declared metrics
- durationMs > 0 in AgentResult on success, and also on budget error paths
- `detailViewConfig` declared on all agents: verify GenerationAgent and RankingAgent have non-empty configs
- `detailViewConfigs.ts` sync test: verify each agent's `detailViewConfig` matches its entry in `DETAIL_VIEW_CONFIGS`
- Config map lookup test: correct config returned for `'generation'`, `'ranking'`; undefined for unknown type
- `ConfigDrivenDetailRenderer.test.tsx` (new file): renders each field type correctly (table, boolean, badge, number, text, list, object with children)
- Fallback to raw JSON when detailType not found in config map or safeParse fails
- Nested object rendering: verify `fineRanking` children render correctly (rounds, exitReason, convergenceStreak)

### Phase 6: Config-Driven Detail View
**Files:** new `evolution/src/lib/core/detailViewConfigs.ts`, `InvocationExecutionDetail.tsx`, `InvocationEntity.ts`, new `ConfigDrivenDetailRenderer.tsx`, new `ConfigDrivenDetailRenderer.test.tsx`

**Server/client boundary solution:**
- Create a new file `evolution/src/lib/core/detailViewConfigs.ts` that exports a **plain data constant** `DETAIL_VIEW_CONFIGS: Record<string, DetailFieldDef[]>` — NO Agent class imports, NO Supabase/Zod imports. This file only imports `DetailFieldDef` from `./types` (which is a pure type import).
- The configs are duplicated from agent classes into this file (not dynamically extracted). This is intentional: the server-side Agent class has the abstract `detailViewConfig` for compile-time enforcement; the client-side `detailViewConfigs.ts` has the same data for rendering. Both are maintained in sync — if someone changes an agent's config, `tsc` will catch if they forget to update the shared file (because tests verify the configs match).
- React client components import `DETAIL_VIEW_CONFIGS` from this UI-safe module, never from `agentRegistry.ts`.

**How it works:**
1. `InvocationExecutionDetail` parses raw `Record<string, unknown>` with `agentExecutionDetailSchema.safeParse()` to get typed detail
2. Looks up `detailViewConfig` by `detail.detailType` from `DETAIL_VIEW_CONFIGS`
3. Passes `(detail, config)` to a generic `ConfigDrivenDetailRenderer` component that renders each field according to its `type`:
   - `table` → renders array data as a table with specified `columns`, status fields get colored badges
   - `boolean` → green/gray indicator
   - `badge` → colored badge (e.g., budget tier: low=green, medium=yellow, high=red)
   - `number` → formatted via formatter name string mapped to format functions at runtime
   - `text` → plain text display
   - `list` → bullet list of items
   - `object` → renders `children` DetailFieldDefs recursively for nested objects
4. Fallback: if `detailType` not found in config map or parsing fails → `RawJsonDetail` (existing collapsible JSON view)

**No per-agent React components.** The config drives all rendering. Adding a new agent with a `detailViewConfig` declaration automatically gets a structured UI.

**Enforcement:** Since `detailViewConfig` is abstract on Agent, TypeScript refuses to compile any agent subclass that doesn't declare it. No agent can accidentally ship without a config. A test verifies that every agent's `detailViewConfig` matches the corresponding entry in `DETAIL_VIEW_CONFIGS`.

- Update InvocationEntity `listFilters` agent_name options to include all names from `agentNameEnum`

**E2E test specifics:**
- Navigate to invocation detail page for a generation agent invocation
- Assert structured view renders (strategies table visible, not raw JSON)
- Verify status badges render for success/format_rejected/error strategies
- Navigate to ranking invocation — verify triage table and budget tier badge render

## Rollback Strategy
All changes are in the Agent class and its 2 concrete subclasses. Since both agents share the same base class, the change is atomic — either both work or neither does. Rollback is a single `git revert` of the commit(s). No DB migration is involved (columns already exist). No external API contracts change.

## Testing
- `cd evolution && npx vitest run` — all agent + pipeline tests pass
- `npx tsc --noEmit` — no type errors
- `npm run lint` — clean
- `npm run build` — succeeds
- `npm run test:e2e -- --grep "evolution"` — invocation detail page renders structured detail

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/agents/overview.md` — major updates: new Agent signature, AgentOutput type, variant I/O, execution detail population, duration tracking, invocationMetrics declaration, agentRegistry.ts
- `evolution/docs/architecture.md` — update agent architecture section, mention execution detail flow and agent-level metric registration
- `evolution/docs/reference.md` — update file inventory for modified/new files (agentRegistry.ts), add new types
- `evolution/docs/data_model.md` — document that duration_ms and execution_detail are now populated
- `evolution/docs/entities.md` — document agent metric merge into InvocationEntity via agentRegistry
- `evolution/docs/strategies_and_experiments.md` — no changes expected
- `evolution/docs/README.md` — no changes expected
- `evolution/docs/cost_optimization.md` — no changes expected (cost tracking unchanged)
- `evolution/docs/rating_and_comparison.md` — no changes expected
- `evolution/docs/arena.md` — no changes expected
