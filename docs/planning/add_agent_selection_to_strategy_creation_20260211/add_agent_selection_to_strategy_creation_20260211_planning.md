# Add Agent Selection To Strategy Creation Plan

## Background
When creating a strategy, user should be able to click checkboxes to enable/disable different types of agents. We need to have safeguards in place though to make sure that agents that are absolutely necessary are not disabled. Agents that must be run together must also be enabled together. We should also add an option to enable full pipeline vs. single article pipeline.

## Requirements (from GH Issue #403)
When creating a strategy, user should be able to click checkboxes to enable/disable different types of agents. We need to have safeguards in place though to make sure that agents that are absolutely necessary are not disabled. Agents that must be run together must also be enabled together.

We should also add an option to enable full pipeline vs. single article pipeline.

## Problem

When creating a strategy, users have no control over which pipeline agents run. All 12 agents are either enabled/disabled via **global** feature flags — there's no per-strategy agent selection. The budget allocation for disabled agents becomes wasted headroom rather than being redistributed. Single-article mode (`singleArticle: true`) exists on `EvolutionRunConfig` but isn't exposed in the strategy creation UI.

**Goal**: Add agent selection checkboxes to the strategy form with dependency validation, add single-article toggle, and redistribute budget caps proportionally when agents are disabled.

## Architecture: What Changes

```
┌──────────────────────────────────────────────────────────┐
│ 1. TYPES                                                  │
│    + AgentName type union (from PipelineAgents keys)      │
│    + enabledAgents?: AgentName[] on StrategyConfig        │
│    + enabledAgents?: AgentName[] on EvolutionRunConfig    │
│    + singleArticle?: boolean on StrategyConfig            │
├──────────────────────────────────────────────────────────┤
│ 2. BUDGET REDISTRIBUTION (new utility)                   │
│    computeEffectiveBudgetCaps(caps, enabledAgents, mode) │
│    → removes disabled agents, scales up proportionally    │
│    + Zod validation for enabledAgents input               │
├──────────────────────────────────────────────────────────┤
│ 3. PIPELINE WIRING                                       │
│    supervisor: wire enabledAgents into getPhaseConfig()   │
│    queue: store in run.config + redistribute for estimate │
│    exec: redistribute budget before CostTracker creation  │
├──────────────────────────────────────────────────────────┤
│ 4. UI (strategy form)                                    │
│    + agent checkboxes w/ dependency validation            │
│    + single-article toggle                                │
│    + budget preview (shows redistributed caps & dollars)  │
└──────────────────────────────────────────────────────────┘
```

### Design Decisions (from review)

**Budget normalization**: Redistribute by scaling remaining agents proportionally to preserve the original cap sum (1.15). This maintains the existing >1.0 overallocation pattern. CostTracker enforces per-agent and total caps independently, so the math is safe.

**Hash backward compat**: Only include `enabledAgents`/`singleArticle` in hash when they have values. When undefined (existing strategies), the hash object is identical to the old format, preserving existing hashes.

**Agent gating**: Wire `enabledAgents` into `getPhaseConfig()` (supervisor) so PhaseConfig booleans reflect strategy settings. This covers standalone agents (generation, ranking, proximity, metaReview) that aren't in the `flagGatedAgents` array.

**Type safety**: Derive `AgentName` type from `keyof PipelineAgents` to constrain `enabledAgents` at compile time.

**FlowCritique**: Excluded from `enabledAgents` since it uses a different gating pattern (`=== true` opt-in, not a PipelineAgent class). It remains controlled by feature flags only. Its budget cap is passed through unchanged by `computeEffectiveBudgetCaps`.

**Generation in single-article mode**: Generation is a REQUIRED_AGENT in full pipeline mode (checkbox locked/checked). In single-article mode, it's auto-disabled by `SINGLE_ARTICLE_DISABLED`. The UI shows required agents as locked UNLESS singleArticle is active, in which case generation/outlineGeneration/evolution checkboxes show as disabled with "(auto-disabled in single-article mode)" tooltip. This is handled by the singleArticle filter running AFTER the required-agents filter in `computeEffectiveBudgetCaps`.

**Budget redistribution happens ONCE**: Only at execution time in `preparePipelineRun()`. The strategy config stores the original/default budget caps unchanged. The UI budget preview calls `computeEffectiveBudgetCaps()` for display-only purposes. This prevents double-redistribution.

## Phased Execution Plan

### Step 1: Type-safe Agent Names + StrategyConfig Extension

**File**: `src/lib/evolution/core/pipeline.ts` — derive AgentName type

```typescript
// Derive type-safe agent name union from PipelineAgents interface
export type AgentName = keyof PipelineAgents;
// = 'generation' | 'calibration' | 'tournament' | 'evolution' | 'reflection' | ...
```

**File**: `src/lib/evolution/core/strategyConfig.ts`

```typescript
import type { AgentName } from './pipeline';

export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;
  enabledAgents?: AgentName[];   // NEW — type-safe agent names
  singleArticle?: boolean;       // NEW — single-article pipeline mode
}
```

- Update `hashStrategyConfig()` — **backward-compatible**: only include new fields when present:
  ```typescript
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    agentModels: config.agentModels ? sortKeys(config.agentModels) : null,
    iterations: config.iterations,
    budgetCaps: sortKeys(config.budgetCaps),
    // Only include when set — preserves hash for existing strategies
    ...(config.enabledAgents ? { enabledAgents: config.enabledAgents.slice().sort() } : {}),
    ...(config.singleArticle ? { singleArticle: true } : {}),
  };
  ```
- Update `labelStrategyConfig()` to append agent count (e.g., `| 7 agents`)
- Update `extractStrategyConfig()` to pass through new fields — **critical**: this function explicitly
  enumerates return fields (no spread), so new fields would be silently dropped, breaking the
  auto-created strategy path in `linkStrategyConfig()`. Add enabledAgents + singleArticle:
  ```diff
   export function extractStrategyConfig(
     runConfig: {
       generationModel?: AllowedLLMModelType;
       judgeModel?: AllowedLLMModelType;
       maxIterations?: number;
       budgetCaps?: Record<string, number>;
       agentModels?: Record<string, AllowedLLMModelType>;
  +    enabledAgents?: AgentName[];
  +    singleArticle?: boolean;
     },
     defaultBudgetCaps: Record<string, number>
   ): StrategyConfig {
     return {
       generationModel: runConfig.generationModel ?? 'deepseek-chat',
       judgeModel: runConfig.judgeModel ?? 'gpt-4.1-nano',
       agentModels: runConfig.agentModels,
       iterations: runConfig.maxIterations ?? 15,
       budgetCaps: runConfig.budgetCaps ?? defaultBudgetCaps,
  +    enabledAgents: runConfig.enabledAgents,
  +    singleArticle: runConfig.singleArticle,
     };
   }
  ```
- Update `diffStrategyConfigs()` to diff new fields
- Update existing hash tests to verify old configs hash identically (backward compat)

**File**: `src/lib/evolution/types.ts`

- Add `enabledAgents?: AgentName[]` to `EvolutionRunConfig`

---

### Step 2: Budget Redistribution Utility

**File**: `src/lib/evolution/core/budgetRedistribution.ts` (new)
**Test**: `src/lib/evolution/core/budgetRedistribution.test.ts` (new — colocated)

```typescript
import type { AgentName } from './pipeline';
import { z } from 'zod';

/** Agent classification constants. */
export const REQUIRED_AGENTS: readonly AgentName[] = ['generation', 'calibration', 'tournament', 'proximity'];

export const OPTIONAL_AGENTS: readonly AgentName[] = [
  'reflection', 'iterativeEditing', 'treeSearch',
  'sectionDecomposition', 'debate', 'evolution',
  'outlineGeneration', 'metaReview',
];
// Note: flowCritique excluded — uses different gating pattern (opt-in, not PipelineAgent)

/** Agents auto-disabled in single-article mode (matches supervisor.ts getPhaseConfig). */
const SINGLE_ARTICLE_DISABLED: readonly AgentName[] = ['generation', 'outlineGeneration', 'evolution'];

/** Agent dependency rules — if key is enabled, deps must also be enabled. */
export const AGENT_DEPENDENCIES: Partial<Record<AgentName, AgentName[]>> = {
  iterativeEditing: ['reflection'],
  treeSearch: ['reflection'],
  sectionDecomposition: ['reflection'],
  evolution: ['tournament'],   // tournament is REQUIRED, so always satisfied
  metaReview: ['tournament'],  // tournament is REQUIRED, so always satisfied
};

/** Mutual exclusivity rules. */
export const MUTEX_AGENTS: [AgentName, AgentName][] = [
  ['treeSearch', 'iterativeEditing'],
];

/**
 * Zod schema for validating enabledAgents input from DB/API.
 *
 * enabledAgents contains ONLY the OPTIONAL agents the user chose to enable.
 * REQUIRED_AGENTS are implicit — always enabled by isEnabled() and computeEffectiveBudgetCaps().
 * The Zod enum accepts both required and optional names for forward compatibility,
 * but the UI only stores optional agent names.
 */
export const enabledAgentsSchema = z.array(
  z.enum([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS] as [string, ...string[]])
).max(20).optional();  // max(20) prevents oversized payloads

/** All agents managed by enabledAgents (REQUIRED + OPTIONAL). */
const MANAGED_AGENTS = new Set<string>([...REQUIRED_AGENTS, ...OPTIONAL_AGENTS]);

/**
 * Compute effective budget caps by removing disabled agents and
 * scaling up remaining agents proportionally to preserve the original cap sum.
 *
 * When enabledAgents is undefined (backward compat), returns defaultCaps unchanged.
 *
 * Agents NOT in MANAGED_AGENTS (e.g. flowCritique) are passed through unchanged —
 * they have their own gating pattern and shouldn't be affected by enabledAgents.
 */
export function computeEffectiveBudgetCaps(
  defaultCaps: Record<string, number>,
  enabledAgents: AgentName[] | undefined,
  singleArticle: boolean,
): Record<string, number> {
  // Backward compat: undefined = all agents enabled, no redistribution
  if (!enabledAgents && !singleArticle) return { ...defaultCaps };

  // Separate managed agents (subject to enabledAgents) from unmanaged (pass-through)
  const managedCaps: Record<string, number> = {};
  const unmanagedCaps: Record<string, number> = {};
  for (const [agent, cap] of Object.entries(defaultCaps)) {
    if (MANAGED_AGENTS.has(agent)) managedCaps[agent] = cap;
    else unmanagedCaps[agent] = cap;  // e.g. flowCritique — kept unchanged
  }

  const originalManagedSum = Object.values(managedCaps).reduce((a, b) => a + b, 0);

  // Determine active managed agents
  let activeAgents = Object.keys(managedCaps);

  if (enabledAgents) {
    const enabledSet = new Set(enabledAgents);
    activeAgents = activeAgents.filter(
      a => REQUIRED_AGENTS.includes(a as AgentName) || enabledSet.has(a as AgentName)
    );
  }

  if (singleArticle) {
    const disabled = new Set<string>(SINGLE_ARTICLE_DISABLED);
    activeAgents = activeAgents.filter(a => !disabled.has(a));
  }

  // Filter caps to active agents only
  const activeCaps: Record<string, number> = {};
  for (const agent of activeAgents) {
    if (agent in managedCaps) activeCaps[agent] = managedCaps[agent];
  }

  // Scale up proportionally to preserve original managed sum
  const remainingSum = Object.values(activeCaps).reduce((a, b) => a + b, 0);
  if (remainingSum === 0) return { ...activeCaps, ...unmanagedCaps };

  const scaleFactor = originalManagedSum / remainingSum;
  const result: Record<string, number> = {};
  for (const [agent, cap] of Object.entries(activeCaps)) {
    result[agent] = cap * scaleFactor;
  }
  // Merge back unmanaged agents (unchanged)
  return { ...result, ...unmanagedCaps };
}

/**
 * Validate agent dependencies and mutual exclusivity.
 * Returns list of validation errors (empty = valid).
 */
export function validateAgentSelection(enabledAgents: AgentName[]): string[] {
  const errors: string[] = [];
  const enabledSet = new Set(enabledAgents);

  // Check dependencies
  for (const agent of enabledAgents) {
    const deps = AGENT_DEPENDENCIES[agent];
    if (deps) {
      for (const dep of deps) {
        if (!enabledSet.has(dep) && !REQUIRED_AGENTS.includes(dep)) {
          errors.push(`${agent} requires ${dep} to be enabled`);
        }
      }
    }
  }

  // Check mutex
  for (const [a, b] of MUTEX_AGENTS) {
    if (enabledSet.has(a) && enabledSet.has(b)) {
      errors.push(`${a} and ${b} cannot both be enabled`);
    }
  }

  return errors;
}
```

---

### Step 3: Wire enabledAgents into Supervisor + Pipeline

**File**: `src/lib/evolution/core/supervisor.ts` — wire into getPhaseConfig()

Add `enabledAgents` to `SupervisorConfig`:

```diff
 export interface SupervisorConfig {
   maxIterations: number;
   minBudget: number;
   // ...existing fields...
   singleArticle: boolean;
+  enabledAgents?: AgentName[];
 }
```

Update `supervisorConfigFromRunConfig()`:

```diff
 export function supervisorConfigFromRunConfig(cfg: EvolutionRunConfig): SupervisorConfig {
   return {
     // ...existing fields...
     singleArticle: cfg.singleArticle ?? false,
+    enabledAgents: cfg.enabledAgents,
   };
 }
```

Add `isEnabled` helper as a private method on PoolSupervisor (used by both phases).
**Defense-in-depth**: Always return true for REQUIRED_AGENTS, even if corrupt DB data omits them.
This matches `computeEffectiveBudgetCaps` which also auto-includes required agents.

```typescript
import { REQUIRED_AGENTS } from './budgetRedistribution';

private isEnabled(name: AgentName): boolean {
  if (!this.cfg.enabledAgents) return true; // backward compat: all enabled
  if (REQUIRED_AGENTS.includes(name)) return true; // required agents can never be disabled
  return this.cfg.enabledAgents.includes(name);
}
```

Update `getPhaseConfig()` — BOTH EXPANSION and COMPETITION phases:

```diff
 // EXPANSION
 return {
   phase: 'EXPANSION',
-  runGeneration: true,
+  runGeneration: this.isEnabled('generation'),
   runOutlineGeneration: false,
   runReflection: false,
   runIterativeEditing: false,
   runTreeSearch: false,
   runSectionDecomposition: false,
   runDebate: false,
   runEvolution: false,
-  runCalibration: true,
-  runProximity: true,
+  runCalibration: this.isEnabled('calibration'),
+  runProximity: this.isEnabled('proximity'),
   runMetaReview: false,
   // ...
 };

 // COMPETITION
 return {
   phase: 'COMPETITION',
-  runGeneration: !this.cfg.singleArticle,
-  runOutlineGeneration: !this.cfg.singleArticle,
+  runGeneration: !this.cfg.singleArticle && this.isEnabled('generation'),
+  runOutlineGeneration: !this.cfg.singleArticle && this.isEnabled('outlineGeneration'),
-  runReflection: true,
+  runReflection: this.isEnabled('reflection'),
-  runIterativeEditing: true,
+  runIterativeEditing: this.isEnabled('iterativeEditing'),
-  runTreeSearch: true,
+  runTreeSearch: this.isEnabled('treeSearch'),
-  runSectionDecomposition: true,
+  runSectionDecomposition: this.isEnabled('sectionDecomposition'),
-  runDebate: true,
+  runDebate: this.isEnabled('debate'),
-  runEvolution: !this.cfg.singleArticle,
+  runEvolution: !this.cfg.singleArticle && this.isEnabled('evolution'),
   runCalibration: true,
-  runProximity: true,
-  runMetaReview: true,
+  runProximity: this.isEnabled('proximity'),
+  runMetaReview: this.isEnabled('metaReview'),
   // ...
 };
```

This ensures enabledAgents gates agents in BOTH phases, not just COMPETITION.

**File**: `src/lib/evolution/index.ts` — `preparePipelineRun()`

```diff
 export function preparePipelineRun(inputs: PipelineRunInputs): PreparedPipelineRun {
   const config = _resolveConfig(inputs.configOverrides ?? {});
+  // Redistribute budget caps based on enabled agents
+  const effectiveBudgetCaps = computeEffectiveBudgetCaps(
+    config.budgetCaps,
+    config.enabledAgents,
+    config.singleArticle ?? false,
+  );
+  config.budgetCaps = effectiveBudgetCaps;
   const costTracker = _createCostTracker(config);
   // ...rest unchanged
 }
```

No third gate needed in pipeline.ts — supervisor's PhaseConfig now handles it.

---

### Step 4: Wire Queue-Time Config Passthrough + Cost Estimation

**File**: `src/lib/services/evolutionActions.ts` — `queueEvolutionRunAction()`

Currently the run's `config` JSONB is empty. Store enabledAgents + singleArticle from strategy, and redistribute budget BEFORE cost estimation:

```diff
 if (input.strategyId) {
   const { data: strategy } = await supabase
-    .from('evolution_strategy_configs').select('id, config')
+    .from('evolution_strategy_configs').select('id, config, pipeline_type')
     .eq('id', input.strategyId).single();
   strategyConfig = strategy.config as QueueStrategyConfig;

+  // Validate enabledAgents from DB (defense against corrupt JSONB)
+  const { enabledAgentsSchema } = await import('@/lib/evolution/core/budgetRedistribution');
+  const parsed = enabledAgentsSchema.safeParse(strategyConfig.enabledAgents);
+  const validatedAgents = parsed.success ? parsed.data : undefined;
+
+  // Build run config overrides with agent enablement
+  const runConfigOverrides: Record<string, unknown> = {};
+  if (validatedAgents) runConfigOverrides.enabledAgents = validatedAgents;
+  if (strategyConfig.singleArticle || strategy.pipeline_type === 'single') {
+    runConfigOverrides.singleArticle = true;
+  }
+  if (Object.keys(runConfigOverrides).length > 0) {
+    insertRow.config = runConfigOverrides;
+  }
 }
```

**Note on cost estimation**: `RunCostConfig` (in `costEstimator.ts`) currently only accepts
`{ generationModel, judgeModel, maxIterations, agentModels }` — it does NOT have a `budgetCaps` field.
The current estimator uses fixed baseline costs, not budget cap proportions.

For this feature, cost estimation at queue time does NOT need modification. The existing estimator
provides a rough cost estimate based on model pricing + iteration count, which is independent of
budget cap distribution. The budget caps only control how the *total* budget is *allocated* per agent
at runtime, not the total estimated cost.

The existing estimation call remains unchanged:
```typescript
const est = await estimateRunCostWithAgentModels(
  { generationModel, judgeModel, maxIterations, agentModels },
  5000,
);
```

**Future enhancement**: If we want estimates that reflect fewer agents running, we'd extend
`RunCostConfig` with `enabledAgents` and multiply baseline costs by (active agents / total agents).
This is out of scope for this feature.

---

### Step 5: DB Migration — ~~Allow 'single' Pipeline Type~~ ALREADY EXISTS

**No migration needed.** The migration already exists at:
`supabase/migrations/20260210000001_add_single_pipeline_type.sql`

It adds `'single'` to both `evolution_runs` and `evolution_strategy_configs` CHECK constraints.
`PipelineType` in `types.ts` already includes `'single'`, and `StrategyConfigRow.pipeline_type`
in `strategyConfig.ts` already allows it.

**No action required for this step** — skip to Step 6.

---

### Step 6: Strategy Creation UI — Agent Checkboxes

**File**: `src/app/admin/quality/strategies/page.tsx`

#### 6a. Extend FormState

```diff
 interface FormState {
   name: string;
   description: string;
   pipelineType: PipelineType;
   generationModel: string;
   judgeModel: string;
   iterations: number;
   budgetCap: number;
+  enabledAgents: string[];      // optional agent names
+  singleArticle: boolean;       // single-article pipeline mode
 }
```

Add `'single'` to `PIPELINE_OPTIONS` array. When user selects 'single', auto-set `singleArticle: true`.

#### 6b. Add Agent Checkbox Section

Insert new form section between "Pipeline Type" and "Model Selectors". Structure:

```
┌─ Agent Selection ───────────────────────────────────────┐
│                                                          │
│  Required (always enabled):                              │
│  ☑ Generation  ☑ Calibration  ☑ Tournament  ☑ Proximity │
│  (locked/grayed out checkboxes)                         │
│                                                          │
│  Optional:                                               │
│  ☑ Reflection      ☑ Iterative Editing  ☐ Tree Search  │
│  ☑ Section Decomp  ☑ Debate             ☑ Evolution    │
│  ☐ Outline Gen     ☑ Meta Review                       │
│  (Flow Critique: controlled by feature flag, not shown) │
│                                                          │
│  Budget allocation:                                      │
│  ┌ generation: 24%  calibration: 18%  tournament: 24% ┐ │
│  │ reflection: 6%   iterEditing: 6%   debate: 6%      │ │
│  │ sectionDecomp: 12%  evolution: 12%  metaReview: —   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Features:
- Required agents: locked checkboxes, always checked
- Optional agents: toggleable, default values match `DEFAULT_EVOLUTION_FLAGS`
- When `singleArticle`: auto-uncheck & disable generation/outlineGeneration/evolution
- Dependency auto-enable: toggling iterativeEditing ON auto-enables reflection
- Dependency auto-disable: toggling reflection OFF auto-disables iterativeEditing/treeSearch/sectionDecomp
- Mutex enforcement: toggling treeSearch ON auto-disables iterativeEditing (and vice versa)
- Budget preview: read-only display showing redistributed % AND dollar amounts (recomputed on every toggle)
- **Submit-time validation**: call `validateAgentSelection()` on form submit, show toast with errors
- Validation errors also shown inline as user toggles (e.g., "Tree Search requires Reflection")
- Backward compat: when editing existing strategy without enabledAgents, default all optional agents to enabled

#### 6c. Update formToConfig()

**IMPORTANT**: Do NOT redistribute budget caps here. Store the DEFAULT caps unchanged.
Budget redistribution happens only at execution time in `preparePipelineRun()`.
Storing pre-redistributed caps would cause double-redistribution since the pipeline
also calls `computeEffectiveBudgetCaps()`.

```diff
 const formToConfig = (form: FormState): StrategyConfig => ({
   generationModel: form.generationModel,
   judgeModel: form.judgeModel,
   iterations: form.iterations,
-  budgetCaps: {
-    generation: form.budgetCap,
-    calibration: 0.15,
-    tournament: 0.20,
-  },
+  budgetCaps: DEFAULT_EVOLUTION_CONFIG.budgetCaps,  // Store ORIGINAL caps, not redistributed
+  enabledAgents: form.enabledAgents,
+  singleArticle: form.singleArticle || undefined,
 });
```

The UI budget preview calls `computeEffectiveBudgetCaps()` for display purposes only — it does NOT store the redistributed values in the strategy config.

#### 6d. Update Presets

```typescript
// Economy: minimal agents
{ enabledAgents: [], singleArticle: false }  // only required agents

// Balanced: default agents
{ enabledAgents: ['reflection','iterativeEditing','sectionDecomposition','debate','evolution','metaReview'], singleArticle: false }

// Quality: all agents
{ enabledAgents: ['reflection','iterativeEditing','sectionDecomposition','debate','evolution','metaReview','outlineGeneration'], singleArticle: false }
```

---

### Step 7: Update resolveConfig

**File**: `src/lib/evolution/config.ts`

Ensure `resolveConfig()` passes through `enabledAgents`:

```diff
 export function resolveConfig(overrides: Partial<EvolutionRunConfig>): EvolutionRunConfig {
   return {
     ...DEFAULT_EVOLUTION_CONFIG,
     ...overrides,
     // ...existing nested merges...
+    enabledAgents: overrides.enabledAgents,
+    singleArticle: overrides.singleArticle ?? DEFAULT_EVOLUTION_CONFIG.singleArticle,
   };
 }
```

---

### Step 8: Re-export from index.ts

**File**: `src/lib/evolution/index.ts`

```diff
+export { computeEffectiveBudgetCaps, validateAgentSelection, REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES, MUTEX_AGENTS } from './core/budgetRedistribution';
```

---

## Critical Files Summary

| File | Change |
|------|--------|
| `src/lib/evolution/core/pipeline.ts` | Export `AgentName` type from PipelineAgents |
| `src/lib/evolution/core/strategyConfig.ts` | Add `enabledAgents`, `singleArticle` to StrategyConfig + backward-compat hash |
| `src/lib/evolution/types.ts` | Add `enabledAgents` to EvolutionRunConfig |
| `src/lib/evolution/core/budgetRedistribution.ts` | **NEW** — redistribution, validation, Zod schema, constants |
| `src/lib/evolution/config.ts` | Pass through `enabledAgents` in resolveConfig() |
| `src/lib/evolution/index.ts` | Wire redistribution in preparePipelineRun(), re-export |
| `src/lib/evolution/core/supervisor.ts` | Wire enabledAgents into SupervisorConfig + getPhaseConfig() |
| `src/lib/services/evolutionActions.ts` | Validate + store enabledAgents, redistribute before cost estimate |
| `src/app/admin/quality/strategies/page.tsx` | Agent checkboxes, single-article toggle, budget preview |
| `src/lib/services/strategyRegistryActions.ts` | Update presets with enabledAgents |
| `supabase/migrations/20260210000001_add_single_pipeline_type.sql` | Already exists — no new migration needed |

## Testing

### Unit tests

**File**: `src/lib/evolution/core/budgetRedistribution.test.ts` (new — colocated, matches codebase convention)

1. `computeEffectiveBudgetCaps()`:
   - `undefined` enabledAgents + `false` singleArticle → returns defaultCaps unchanged (backward compat)
   - All optional agents enabled → scaled proportionally, sum preserves original (~1.15)
   - Some agents disabled → freed budget redistributed, sum preserves original
   - Single-article mode → generation/outline/evolution excluded, remaining scaled up
   - Empty enabledAgents array → only required agents get budget
   - Invalid agent names in enabledAgents → ignored (only filter known caps keys)
   - Single-article + custom enabledAgents → both filters applied
   - flowCritique cap passed through unchanged when enabledAgents is set (not in MANAGED_AGENTS)
   - Unmanaged agents (future agents not in REQUIRED/OPTIONAL) pass through unchanged

2. `validateAgentSelection()`:
   - IterativeEditing without Reflection → error
   - TreeSearch + IterativeEditing → mutex error
   - Valid selection (e.g., reflection + iterativeEditing) → empty errors
   - Empty array → empty errors (no optional agents = valid)
   - Agent with dependency on REQUIRED_AGENT (evolution→tournament) → no error (always satisfied)

3. `enabledAgentsSchema` (Zod):
   - Valid array → passes
   - Array with unknown agent name → fails
   - Non-array input → fails

**File**: `src/lib/evolution/core/strategyConfig.test.ts` (update existing — colocated)

4. `hashStrategyConfig()` backward compat:
   - Config WITHOUT enabledAgents/singleArticle → same hash as before (regression test with pinned hash value)
   - Config WITH enabledAgents → different hash from without
   - Same config, different enabledAgents order → same hash (sort stability)

4b. `extractStrategyConfig()` passthrough:
   - runConfig with enabledAgents → extracted config includes enabledAgents
   - runConfig without enabledAgents → extracted config has enabledAgents undefined
   - runConfig with singleArticle → extracted config includes singleArticle

**File**: `src/lib/evolution/core/supervisor.test.ts` (update existing — colocated)

5. `getPhaseConfig()` with enabledAgents:
   - COMPETITION with all agents → all runX booleans true
   - COMPETITION with enabledAgents excluding reflection → runReflection false
   - COMPETITION with singleArticle → runGeneration/runOutlineGeneration/runEvolution false
   - enabledAgents undefined → backward compat, all true
   - EXPANSION with enabledAgents excluding generation → runGeneration still true (generation is REQUIRED_AGENT)
   - EXPANSION with enabledAgents undefined → backward compat, runGeneration true
   - enabledAgents empty array → required agents (generation, calibration, tournament, proximity) still enabled via isEnabled() defense-in-depth
   - enabledAgents excluding reflection → runReflection false, but runCalibration still true (REQUIRED)

**File**: `src/lib/evolution/core/config.test.ts` (update existing — colocated)

5b. `resolveConfig()` passthrough:
   - overrides with enabledAgents → config.enabledAgents is set
   - overrides without enabledAgents → config.enabledAgents is undefined
   - overrides with singleArticle → config.singleArticle is set

### Contract tests (server actions)

**File**: `src/lib/services/evolutionActions.test.ts` (update existing — colocated, no `__tests__/` subdirectory)

6. `queueEvolutionRunAction()` with strategy:
   - Strategy with enabledAgents → run.config JSONB contains enabledAgents
   - Strategy without enabledAgents → run.config remains `{}`
   - Invalid enabledAgents in DB → gracefully falls back to undefined
   - Strategy with singleArticle → run.config contains `singleArticle: true`

### UI tests

**File**: `src/app/admin/quality/strategies/page.test.tsx` (new — colocated, contract/logic tests only)

7. Agent checkbox logic (test the toggle/validation functions, not DOM):
   - Toggling reflection OFF auto-disables dependents
   - Toggling treeSearch ON auto-disables iterativeEditing
   - Submit with invalid selection → returns validation errors
   - Preset application → correct enabledAgents set
   - Backward compat: editing strategy without enabledAgents → defaults all enabled

### Checks after each step

8. `tsc` (filter `.next/` artifacts), `eslint`, `next build`, run relevant test file

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/architecture.md` - Pipeline modes and agent lists may need updates for configurable agents
- `docs/evolution/data_model.md` - Strategy config schema changes for agent selection
- `docs/evolution/agents/overview.md` - Agent dependency rules and required/optional classification
- `docs/evolution/reference.md` - Feature flags and configuration updates
- `docs/evolution/cost_optimization.md` - Strategy config changes affecting cost estimation
- `docs/evolution/visualization.md` - Admin UI changes for strategy creation
- `docs/evolution/agents/generation.md` - Agent enablement via strategy config
- `docs/feature_deep_dives/admin_panel.md` - New UI components for agent selection
