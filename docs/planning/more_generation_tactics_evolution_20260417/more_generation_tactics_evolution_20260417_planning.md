# More Generation Tactics Evolution Plan

## Background
Add 16 new generation tactics to the evolution pipeline beyond the current 3 implemented core tactics. Introduce `evolution_tactics` as an entity (thin DB table for identity + metrics, prompts in code). Rename the "generation strategy" concept to "tactic" across the codebase to disambiguate from the `evolution_strategies` entity. Wire up the existing but unused `generationGuidance` weighted random selection feature. Enable cross-run tactic performance comparison via the metrics system.

## Requirements (from GH Issue #991)

### New Generation Tactics (16 total)

**Depth & Knowledge Tactics:**
- analogy_bridge — Inject analogies and metaphors connecting unfamiliar concepts to everyday experience
- expert_deepdive — Add technical depth: mechanisms, edge cases, caveats, nuances
- historical_context — Weave in origin stories, key figures, timeline of discovery
- counterpoint_integrate — Identify strongest objections/misconceptions and address them

**Audience-Shift Tactics:**
- pedagogy_scaffold — Restructure using teaching techniques: prerequisites, sequencing, check-understanding transitions
- curiosity_hook — Maximize questions-before-answers: open loops, puzzles, delayed resolutions
- practitioner_orient — Shift from "what X is" to "how to use X": decision frameworks, pitfalls

**Structural Innovation Tactics:**
- zoom_lens — Alternate macro (big picture) and micro (specific detail) throughout
- progressive_disclosure — Layer information: complete-but-simple first, then deepen each section
- contrast_frame — Explain via comparison: what it is vs. isn't, before vs. after, alternatives

**Quality & Precision Tactics:**
- precision_tighten — Eliminate hedge words, vague quantifiers, weasel phrases; replace with specific claims
- coherence_thread — Ensure every paragraph's last sentence connects to next paragraph's first
- sensory_concretize — Replace abstract verbs/nouns with vivid, specific language (word-level, not examples)

**Meta/Experimental Tactics:**
- compression_distill — Produce shorter version preserving all key information
- expansion_elaborate — Triple depth of thinnest section while keeping others stable
- first_principles — Rewrite assuming zero domain knowledge; derive everything from basics

### 5 Extended Tactics (documented but never implemented — adding prompt definitions)
- engagement_amplify — Boost reader engagement through hooks, pacing, rhetorical devices
- style_polish — Refine prose style, improve flow, strengthen voice
- argument_fortify — Strengthen logical structure, evidence, persuasiveness
- narrative_weave — Weave narrative threads, improve coherence, add storytelling elements
- tone_transform — Shift or unify tone to match target audience and purpose

### Infrastructure Changes:
- Rename "generation strategy" → "tactic" across ~80 occurrences in ~20 source files
- Create `evolution_tactics` thin DB table (entity identity + metrics, no prompt columns)
- Tactic prompts defined in code only (git-controlled), pipeline reads from code imports
- Sync script creates/updates thin DB rows so metrics and admin UI have entity IDs
- Add `tactic TEXT` column to `evolution_agent_invocations` (string, no FK)
- Add `entity_type='tactic'` to `evolution_metrics` for cross-run tactic comparison
- Per-agent tactic groups: `generateTactics.ts`, future `evolveTactics.ts`, etc.
- Wire up `generationGuidance` weighted tactic selection

## Problem
The evolution pipeline currently has only 3 implemented generation tactics out of 8 documented. The concept is confusingly named "strategy" in the code — the same word used for the `evolution_strategies` entity. Tactic definitions are scattered across a local `Record<string, StrategyDef>` dict with no centralized registry, entity, or validation. There is no cross-run tactic comparison — each run's `strategyEffectiveness` lives in its own `run_summary` JSONB with no aggregation. The `generationGuidance` feature for weighted random tactic selection is fully schema-defined but never consumed.

## Options Considered
- [ ] **Option A: Code registry + virtual entity**: Tactics in code, metrics via deterministic UUIDs, no DB table. Simplest but no admin visibility or entity lifecycle.
- [ ] **Option B: Full DB entity + code-synced prompts**: Prompt columns in DB, pipeline reads from DB. Max flexibility but adds DB reads in pipeline hot path and two sources of truth.
- [x] **Option C: Thin DB entity + code-only prompts**: Thin DB table for entity identity/metrics. Prompts live exclusively in code. Sync script populates DB rows (name, label, category). Pipeline reads prompts from code imports. Admin UI detail page imports from code for display. **Selected approach.**

## Naming Convention
- **Strategy** = `evolution_strategies` entity (model + budget + iterations config). **KEEP unchanged.**
- **Tactic** = the specific text transformation applied per variant (structural_transform, lexical_simplify, etc.). **RENAME from "strategy" in all generation-concept contexts.** Thin entity in `evolution_tactics` for identity + metrics.

## Architecture: Tactic as Thin Entity

### Design principles
1. **Prompts live in code only** — git-controlled, PR-reviewed, type-safe. Pipeline always reads from code imports, never from DB.
2. **DB table is for entity identity** — provides UUIDs for metrics, admin list/detail pages, and future FK references. No `preamble`/`instructions` columns.
3. **Admin detail page imports from code** — server component calls `getTacticDef(name)` to render prompt text alongside DB-sourced metrics.
4. **Sync script keeps DB in sync** — creates thin rows so metrics have entity IDs. Runs on deploy.
5. **Custom tactics are a future extension** — when needed, add `preamble`/`instructions` columns and DB read path. Not in scope now.

### Per-agent tactic groups
Tactic definitions are scoped by agent type. Each agent declares which tactics it supports:

```
evolution/src/lib/core/tactics/
├── types.ts              — TacticDef interface
├── generateTactics.ts    — SYSTEM_GENERATE_TACTICS (24 entries, git-controlled)
├── evolveTactics.ts      — SYSTEM_EVOLVE_TACTICS (future)
├── index.ts              — ALL_SYSTEM_TACTICS union, getTacticDef(), isValidTactic(), TACTIC_PALETTE
└── syncTactics.ts        — Deploy-time upsert of thin DB rows
```

Agent subclasses reference their tactic group:
```typescript
class GenerateFromSeedArticleAgent extends Agent<...> {
  readonly name = 'generate_from_seed_article';
  readonly tactics = SYSTEM_GENERATE_TACTICS;
}
```

Input types are scoped:
```typescript
interface GenerateFromSeedInput {
  tactic: GenerateTacticName;  // compile-time: only generate tactics
}
```

### DB schema: `evolution_tactics` (thin — no prompt columns)
```sql
CREATE TABLE evolution_tactics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  agent_type TEXT NOT NULL,       -- 'generate_from_seed_article', 'evolve', etc.
  category TEXT,                  -- 'core', 'depth', 'audience', 'structural', etc.
  is_predefined BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS: deny-all + service_role_all + readonly_select (same as other evolution tables)
```

### Invocation → tactic link
```sql
ALTER TABLE evolution_agent_invocations
  ADD COLUMN tactic TEXT;  -- nullable string, no FK. Ranking/merge agents have NULL.
```
`Agent.run()` writes `tactic` to the invocation row when the agent declares tactics.

### Cross-run tactic metrics
Add `'tactic'` to `evolution_metrics.entity_type` CHECK constraint using non-blocking migration:
```sql
-- Drop old CHECK and re-add with 'tactic' included (NOT VALID avoids full-table lock)
-- NOTE: Must include ALL existing values from current constraint. Verify current values
-- via: SELECT conname, consrc FROM pg_constraint WHERE conrelid = 'evolution_metrics'::regclass;
-- Current values (as of 20260324000001 which removed arena_topic): run, invocation, variant, strategy, experiment, prompt
-- (arena_topic was removed by migration 20260324000001_entity_evolution_phase0.sql)
ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run','invocation','variant','strategy','experiment','prompt','tactic'))
  NOT VALID;
ALTER TABLE evolution_metrics VALIDATE CONSTRAINT evolution_metrics_entity_type_check;
```

**Tactic metrics are NOT run-child aggregations** — they aggregate per-variant stats grouped by tactic name. This is a different axis than strategy/experiment propagation (which aggregates child run metrics). Tactic metric computation:
1. Query `evolution_variants` joined to `evolution_runs` WHERE `run.status='completed'`
2. Group by `agent_name` (tactic name) → compute avg Elo from `mu`/`sigma` columns via `dbToRating()`
3. Write to `evolution_metrics` with `entity_type='tactic'`, `entity_id` from `evolution_tactics` table
4. This requires a **new `computeTacticMetrics()` function** — cannot reuse `propagateMetrics()` which is typed to `'strategy' | 'experiment'` and reads from child entity metric rows

**Stale trigger update:** The `mark_elo_metrics_stale()` trigger must be updated to also cascade staleness to `entity_type='tactic'` rows when variant `mu`/`sigma` change. Add to the trigger function:
```sql
-- Cascade to tactic metrics (look up tactic via agent_name → evolution_tactics.name)
UPDATE evolution_metrics SET stale = true, updated_at = now()
WHERE entity_type = 'tactic'
  AND entity_id IN (
    SELECT et.id FROM evolution_tactics et WHERE et.name = NEW.agent_name
  );
```

### TypeScript type changes required
- Add `'tactic'` to `CORE_ENTITY_TYPES` array in `evolution/src/lib/core/types.ts` (this derives the `EntityType` union)
- `propagateMetrics()` in `persistRunResults.ts` is typed to `entityType: 'strategy' | 'experiment'` — tactic uses a separate `computeTacticMetrics()` function, NOT this one
- `TacticEntity` registered in `entityRegistry.ts` requires `EntityType` to include `'tactic'` first

### Sync mechanism
`evolution/scripts/syncSystemTactics.ts` runs in two contexts:
- **CI deploy:** Added as a step in `.github/workflows/ci.yml` after `deploy-migrations`, before `typecheck`. Uses existing `SUPABASE_SERVICE_ROLE_KEY` secret (already available in CI for migration deployment).
- **Batch runner startup:** `processRunQueue.ts` calls `syncSystemTactics()` once at startup before entering the claim loop. This handles minicomputer deployments where CI doesn't run.
1. Reads all entries from `SYSTEM_GENERATE_TACTICS` (and future `SYSTEM_EVOLVE_TACTICS`)
2. Upserts to `evolution_tactics` via `ON CONFLICT (name) DO UPDATE` — updates `label`, `category`, `agent_type`
3. Idempotent — safe to run multiple times
4. Only touches `is_predefined=true` rows

### Collision prevention
A unit test asserts no key overlap between agent tactic groups:
```typescript
const allKeys = [...Object.keys(SYSTEM_GENERATE_TACTICS), ...Object.keys(SYSTEM_EVOLVE_TACTICS)];
expect(new Set(allKeys).size).toBe(allKeys.length);
```

## Rollback Plan
If the rename breaks production parsing of existing `run_summary` JSONB:
1. **Immediate:** The Zod preprocess migrations accept BOTH old and new field names on read. Rolling back code to pre-rename just means old field names are written again — both directions parse correctly.
2. **DB safe:** No DB columns are renamed. `evolution_variants.agent_name` keeps its name. The new `evolution_tactics` table and `tactic` column on invocations are additive — dropping them is safe.
3. **Feature flag (if needed):** Add `EVOLUTION_USE_TACTIC_NAMING=true` env var gating the new field names in write paths. Set to `false` to revert to old names without redeploying. Read paths always accept both.

## Zod Preprocess Migration Detail

The existing run_summary V3 schema uses `.strict()` (line 1088 in schemas.ts), which rejects unknown keys. The rename must:

1. **Add `renameKeys` preprocess** entries for each renamed field (same pattern as existing `avgMu → avgElo` rename at line 1044):
   ```typescript
   const tacticRenameKeys = renameKeys({
     strategyEffectiveness: 'tacticEffectiveness',
     strategyMus: 'tacticMus',
   });
   // Applied in the V3 schema's .preprocess() chain
   ```

2. **Inside `topVariants` array items**, rename `strategy → tactic`:
   ```typescript
   topVariants: z.array(z.preprocess(
     renameKeys({ strategy: 'tactic', isBaseline: 'isSeedVariant' }),
     z.object({ id: z.string(), tactic: z.string(), elo: z.number(), isSeedVariant: z.boolean() })
   ))
   ```

3. **generationGuidance entries** in `strategyConfigSchema`:
   ```typescript
   export const generationGuidanceEntrySchema = z.preprocess(
     renameKeys({ strategy: 'tactic' }),
     z.object({ tactic: z.string().min(1), percent: z.number().min(0).max(100) })
   );
   ```

4. **V2 and V1 transform chains** already map old shapes → V3. After rename, they map to V3-with-tactic-names. The existing `.transform()` calls (lines 1204, 1254) need updating to emit `tactic` instead of `strategy`.

5. **Write path**: New code writes `tacticEffectiveness`, `tacticMus`, `topVariants[].tactic`. Old code wrote `strategyEffectiveness`, etc. Read path accepts both via preprocess.

## Rename Inventory

### RENAME: "strategy" → "tactic" (~80 occurrences, ~20 files)

#### Core definitions
| Current | Proposed | File |
|---------|----------|------|
| `StrategyDef` type | `TacticDef` | `generateFromSeedArticle.ts` → `tactics/types.ts` |
| `STRATEGY_DEFS` dict | `SYSTEM_GENERATE_TACTICS` | `generateFromSeedArticle.ts` → `tactics/generateTactics.ts` |
| `buildPromptForStrategy()` | `buildPromptForTactic()` | `generateFromSeedArticle.ts` |
| `GenerateFromSeedInput.strategy` | `.tactic` | `generateFromSeedArticle.ts` |
| `DEFAULT_GENERATE_STRATEGIES` | `DEFAULT_TACTICS` (+ alias) | `schemas.ts` |
| `GENERATION_STRATEGIES` | import from `tactics/` | `strategies/page.tsx` |
| `STRATEGY_PALETTE` | `TACTIC_PALETTE` | `VariantCard.tsx` → `tactics/index.ts` |

#### Variant type & schema
| Current | Proposed | Files |
|---------|----------|-------|
| `Variant.strategy` | `Variant.tactic` | `types.ts`, `schemas.ts` (variantSchema) |
| `createVariant({strategy})` | `createVariant({tactic})` | `types.ts` |
| `v.strategy` (all pipeline refs) | `v.tactic` | `persistRunResults.ts`, `runIterationLoop.ts`, tests |

#### Run summary fields (requires Zod preprocess migration for legacy rows)
| Current | Proposed | Files |
|---------|----------|-------|
| `strategyEffectiveness` | `tacticEffectiveness` | `schemas.ts` (V3+V2+V1), `types.ts`, `persistRunResults.ts`, `MetricsTab.tsx` |
| `strategyMus` | `tacticMus` | `schemas.ts`, `types.ts`, fixtures |
| `topVariants[].strategy` | `topVariants[].tactic` | `schemas.ts` (V3+V2+V1 + migration transforms) |

#### Cost estimation
| Current | Proposed | File |
|---------|----------|------|
| `estimateGenerationCost(_, strategy, _)` param | `tactic` | `estimateCosts.ts` + call sites |
| `estimateAgentCost(_, strategy, _)` param | `tactic` | `estimateCosts.ts` + call sites |

#### UI components
| Current | Proposed | Files |
|---------|----------|-------|
| `strategy` prop on VariantCard | `tactic` | `VariantCard.tsx`, `LineageGraph.tsx`, `LineageTab.tsx`, `InputArticleSection.tsx` |
| "Strategy Effectiveness" heading | "Tactic Effectiveness" | `MetricsTab.tsx` |
| "Strategy" column header (variant tables) | "Tactic" | `MetricsTab.tsx`, `VariantsTab.tsx` |
| `GenerationGuidanceField` dropdown label | "Tactic" | `strategies/page.tsx` |

#### generationGuidance JSONB field
| Current | Proposed | Migration |
|---------|----------|-----------|
| `generationGuidance[].strategy` | `generationGuidance[].tactic` | Zod preprocess: accept both `strategy` and `tactic` keys on read, write `tactic` on new rows |

### KEEP as "strategy" (~16 occurrences)
- `strategy_id` — DB FK to `evolution_strategies`
- `strategyConfigSchema` / `StrategyConfig` — entity config type
- `propagateMetrics(db, 'strategy', id)` — entity type string
- `EntityType = 'strategy'` — entity registry
- Strategy CRUD pages/actions — entity management UI
- `run.strategy_id`, `run.strategy_name` — entity references on runs

### KEEP DB column (no rename)
- `evolution_variants.agent_name` — stores tactic names but column name is generic enough
- `evolution_cost_calibration.strategy` — stores tactic names but renaming a PK column is high-risk; add comment

## Phased Execution Plan

### Phase 0: Rename strategy → tactic (generation concept only)
- [x] Rename `StrategyDef` → `TacticDef` in `generateFromSeedArticle.ts`
- [x] Rename `STRATEGY_DEFS` → `TACTIC_DEFS` (temporary; moves to tactics/ in Phase 1)
- [x] Rename `buildPromptForStrategy()` → `buildPromptForTactic()`
- [x] Rename `GenerateFromSeedInput.strategy` → `.tactic`
- [x] Rename `Variant.strategy` → `Variant.tactic` in `types.ts` and `schemas.ts` (variantSchema)
- [x] Rename `createVariant({strategy})` → `createVariant({tactic})`
- [x] Rename `v.strategy` → `v.tactic` in all pipeline code (`persistRunResults.ts`, `runIterationLoop.ts`, etc.)
- [x] Rename `strategyEffectiveness` → `tacticEffectiveness` in run summary schemas (V3) with Zod preprocess migration for V2/V1 legacy rows
- [x] Rename `strategyMus` → `tacticMus` in schemas with preprocess migration
- [x] Rename `topVariants[].strategy` → `.tactic` with preprocess migration
- [x] Rename `STRATEGY_PALETTE` → `TACTIC_PALETTE` in `VariantCard.tsx`
- [x] Rename `GENERATION_STRATEGIES` → `GENERATION_TACTICS` in `strategies/page.tsx`
- [x] Rename `DEFAULT_GENERATE_STRATEGIES` → `DEFAULT_TACTICS` in `schemas.ts` (keep old name as re-export alias)
- [x] Update `generationGuidance` entry schema: accept both `{strategy, percent}` and `{tactic, percent}` via Zod preprocess; new writes use `tactic`
- [x] Rename `estimateGenerationCost(_, strategy)` → `(_, tactic)` and `estimateAgentCost(_, strategy)` → `(_, tactic)` params
- [x] Update VariantCard `strategy` prop → `tactic`; update LineageGraph, LineageTab, InputArticleSection, VariantsTab
- [x] Update UI labels: "Strategy Effectiveness" → "Tactic Effectiveness", column headers
- [x] Update all test files immediately in this phase (not deferred to Phase 6): fixtures, assertions, mock data, test helpers (e.g., `mkVariant()` uses `strategy: 'baseline'` → `tactic: 'baseline'`)
- [x] Add Zod preprocess migration tests: verify legacy run_summary rows with `strategyEffectiveness`, `strategyMus`, `topVariants[].strategy` parse correctly through the new preprocess chain
- [x] Add generationGuidance dual-key test: verify `{strategy: 'x', percent: 50}` and `{tactic: 'x', percent: 50}` both parse, and new writes serialize as `{tactic: ...}`
- [x] Run lint, tsc, build, unit tests — fix all breakage
- [x] Commit: "refactor: rename generation strategy → tactic across codebase"

### Phase 1: Tactic Code Registry + DB Entity
- [x] Create `evolution/src/lib/core/tactics/types.ts` — `TacticDef` interface (moved from generateFromSeedArticle.ts)
- [x] Create `evolution/src/lib/core/tactics/generateTactics.ts` — `SYSTEM_GENERATE_TACTICS` with all 24 entries (3 existing + 5 extended + 16 new prompt definitions)
  - Include format-violation mitigation for high-risk tactics (compression_distill, pedagogy_scaffold, practitioner_orient, counterpoint_integrate)
- [x] Create `evolution/src/lib/core/tactics/index.ts` — barrel with `ALL_SYSTEM_TACTICS`, `getTacticDef()`, `isValidTactic()`, `TACTIC_PALETTE`, `TACTICS_BY_CATEGORY`
- [x] Create migration: `evolution_tactics` thin table (no prompt columns) with RLS policies (REVOKE ALL FROM PUBLIC, anon, authenticated; service_role_all; readonly_select)
- [x] Create migration: add `'tactic'` to `evolution_metrics.entity_type` CHECK constraint using NOT VALID + VALIDATE pattern (non-blocking)
- [x] Create migration: add `tactic TEXT` column to `evolution_agent_invocations` + index `idx_invocations_tactic` on `(tactic)` for metrics grouping queries
- [x] ~~Create migration: update `mark_elo_metrics_stale()` trigger~~ — **deferred to Phase 3** so trigger and recompute handler deploy together (avoids stale rows accumulating without a handler)
- [x] Add `'tactic'` to `CORE_ENTITY_TYPES` array in `evolution/src/lib/core/types.ts` (this derives the `EntityType` union — must be done before TacticEntity registration)
- [x] Create `evolution/scripts/syncSystemTactics.ts` — deploy-time upsert of thin DB rows (name, label, category, agent_type, is_predefined=true)
- [x] Create `TacticEntity` in `evolution/src/lib/core/entities/TacticEntity.ts` — list, getById, delete, metrics, actions
- [x] Register `TacticEntity` in `entityRegistry.ts` with `entity_type='tactic'`
- [x] Create tactic server actions in `evolution/src/services/tacticActions.ts` — list, get detail (joins code-defined prompt via `getTacticDef()`)
- [x] Update `generateFromSeedArticle.ts` — import from `tactics/generateTactics.ts`, use `getTacticDef()` for prompt lookup
- [x] Update `Agent.run()` — write `tactic` to invocation row when agent declares tactics
- [x] Update `buildRunContext.ts` — validate tactic names in `generationGuidance` against code registry via `isValidTactic()`
- [x] Run lint, tsc, build; write unit tests for registry + entity + sync script + actions

### Phase 2: Tactic Admin UI + Per-Prompt Tactic Views
- [x] Create shared `TacticPromptPerformanceTable` component — reusable table showing tactic × prompt performance (Avg Elo with CI, Variants, Runs, Best Elo, Cost). Accepts either `tacticName` or `promptId` as filter prop.
- [x] Create `getTacticPromptPerformanceAction(filter: {tacticName?: string, promptId?: string})` server action — queries `evolution_variants` joined to `evolution_runs`, grouped by `(agent_name, prompt_id)`, returns per-group stats
- [x] Create `/admin/evolution/tactics` list page — columns: Name, Agent Type, Category, Status, is_predefined badge, plus metric columns (Avg Elo, Variants, Runs, Total Cost) from `createMetricColumns('tactic')`
- [x] Create `/admin/evolution/tactics/[tacticId]` detail page — tabs:
  - Overview: prompt text imported from code via `getTacticDef(tactic.name)` server-side, rendered read-only
  - Metrics: `EntityMetricsTab` with `entityType='tactic'` (data arrives in Phase 3)
  - Variants: all variants produced by this tactic across all runs
  - Runs: all runs that used this tactic
  - By Prompt: `TacticPromptPerformanceTable` filtered by `tacticName` — shows this tactic's Avg Elo, Variants, Best Elo per prompt
- [x] Add "Tactics" tab to prompt detail page (`/admin/evolution/prompts/[promptId]` or arena `[topicId]`) — `TacticPromptPerformanceTable` filtered by `promptId` — shows which tactics perform best for this prompt, sorted by Avg Elo descending, with `TACTIC_PALETTE` color indicators
- [x] Add "Tactic Breakdown" section to `ExperimentAnalysisCard` — aggregate variants across all runs in experiment grouped by tactic, show: Tactic, Variants, Avg Elo, Winner count (how many runs this tactic produced the `is_winner=true` variant)
- [x] Add "Tactic × Prompt" heatmap to evolution dashboard (`/admin/evolution-dashboard`) — matrix of all tactics × all prompts with avg Elo in each cell, color intensity by value. Cells with < 2 runs show "—". Dedicated server action for the pivot query.
- [x] Update `strategies/page.tsx` `GenerationGuidanceField` — load tactic names from code registry (`ALL_SYSTEM_TACTICS`) instead of hardcoded array
- [x] Update sidebar navigation in `evolution/layout.tsx` — add "Tactics" link
- [x] Run lint, tsc, build; verify UI renders correctly

### Phase 3: Cross-Run Tactic Metrics
- [x] Create `evolution/src/lib/metrics/computations/tacticMetrics.ts` — new `computeTacticMetrics(db, tacticId, tacticName)` function (NOT reusing `propagateMetrics()` which is typed to strategy/experiment and aggregates from child run metric rows):
  - Query `evolution_variants` WHERE `agent_name = tacticName` joined to `evolution_runs` WHERE `status='completed'`
  - Compute from variant DB columns directly: avg Elo via `dbToRating(mu, sigma)`, variant count, cost from `cost_usd`
  - Group by run for bootstrap CI computation (between-run + within-run uncertainty via `bootstrapPercentileCI`)
  - Write to `evolution_metrics` with `entity_type='tactic'`, `entity_id=tacticId`
- [x] Define tactic metric names in metrics registry: `avg_elo`, `best_elo`, `total_variants`, `total_cost`, `run_count`, `avg_cost_per_variant`
- [x] Call `computeTacticMetrics()` at run finalization after existing strategy/experiment propagation — for each tactic used in the completed run
- [x] Create migration: update `mark_elo_metrics_stale()` trigger to cascade staleness to `entity_type='tactic'` rows (deferred from Phase 1 so trigger and handler deploy together)
- [x] Add `recomputeStaleMetrics()` handler for `entity_type='tactic'` that calls `computeTacticMetrics()` — both trigger migration and handler code deploy in the same phase
- [x] Run lint, tsc, build; write unit tests for tactic metric computation

### Phase 4: Wire Up generationGuidance Weighted Selection
- [x] Create `selectTacticWeighted(guidance, rng): string` function:
  - Normalize percentages to sum to 1.0, build cumulative distribution
  - Use `SeededRandom` for reproducible selection
- [x] In `runIterationLoop.ts` line 481, replace round-robin with conditional:
  - When `config.generationGuidance` is present: use `selectTacticWeighted()` with `deriveSeed(randomSeed, 'tactic_selection', i)`
  - When absent: keep round-robin fallback
- [x] Log actual dispatch order showing weighted selection
- [x] Run lint, tsc, build; write unit tests for weighted selection

### Phase 5: Update Cost Estimation
- [x] Update `EMPIRICAL_OUTPUT_CHARS` in `estimateCosts.ts` — add entries for all new tactics (use DEFAULT_OUTPUT_CHARS=9197 initially; calibration table will refine over time)
- [x] Move `TACTIC_PALETTE` to `tactics/index.ts` — assign distinct colors for all tactics organized by category hue
- [x] Update `VariantCard.tsx` and `LineageGraph.tsx` to import `TACTIC_PALETTE` from new location
- [x] Run lint, tsc, build; verify UI renders new tactic colors

### Phase 6: Update Tests & Documentation
Note: rename-related fixture updates (strategy→tactic field names) are done in Phase 0, not here. This phase covers NEW tests and documentation only.
- [x] Add parametrized unit tests: `it.each(ALL_SYSTEM_TACTICS)` for prompt generation, format compliance
- [x] Add unit test: no key overlap between agent tactic groups (collision prevention)
- [x] Add integration test verifying a run with new tactics completes
- [x] Add integration test for sync script: upsert + idempotency
- [x] Update `evolution/docs/agents/overview.md` with all tactic descriptions, rename "strategy" references
- [x] Update `evolution/docs/architecture.md` — tactic count, rename terminology, document tactic entity
- [x] Update `evolution/docs/strategies_and_experiments.md` — rename "generation strategy" → "tactic", add generationGuidance weighted selection docs
- [x] Update `evolution/docs/data_model.md` — add `evolution_tactics` table schema, `tactic` column on invocations, `entity_type='tactic'` in metrics
- [x] Update `evolution/docs/entities.md` — add TacticEntity to entity diagram and relationships
- [x] Update `evolution/docs/cost_optimization.md` — update EMPIRICAL_OUTPUT_CHARS table with new tactics
- [x] Update `evolution/docs/reference.md` — update file references, add tactic admin pages, sync script
- [x] Update `evolution/docs/visualization.md` — document TACTIC_PALETTE, tactic admin pages
- [x] Update `evolution/docs/curriculum.md` — update glossary: add "tactic" definition
- [x] Update `evolution/docs/metrics.md` — document tactic-level metrics and propagation
- [x] Run full test suite: lint, tsc, build, unit, integration

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/tactics/generateTactics.test.ts` — all system tactics have valid TacticDef, no duplicates
- [x] `evolution/src/lib/core/tactics/index.test.ts` — getTacticDef(), isValidTactic(), collision prevention across groups
- [x] `evolution/src/lib/core/entities/TacticEntity.test.ts` — entity CRUD, metrics, actions
- [x] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — extend for new tactics, verify tactic field naming
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — weighted selection via generationGuidance, tactic on invocations
- [x] `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — cost estimation for new tactics
- [x] `evolution/scripts/syncSystemTactics.test.ts` — upsert idempotency

### Integration Tests
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.integration.test.ts` — mock run with new tactics, correct tactic names on variants and invocations
- [x] Sync script integration: seed DB, run sync, verify system tactics created, run again to verify idempotency
- [x] `evolution/src/lib/metrics/computations/tacticMetrics.integration.test.ts` — seed variants with known Elo/tactic, run computeTacticMetrics(), verify metric rows
- [x] `getTacticPromptPerformanceAction` integration test — seed variants across multiple prompts/tactics, verify grouping and stats

### Zod Preprocess Migration Tests (Phase 0 — critical)
- [x] Legacy V3 run_summary with `strategyEffectiveness` key → parses to `tacticEffectiveness`
- [x] Legacy V3 run_summary with `strategyMus` key → parses to `tacticMus`
- [x] Legacy V3 `topVariants[].strategy` → parses to `topVariants[].tactic`
- [x] Legacy V2 run_summary → transforms through V2→V3 pipeline with new field names
- [x] Legacy V1 run_summary → transforms through V1→V3 pipeline with new field names
- [x] New V3 run_summary with `tacticEffectiveness` → parses directly (no rename needed)
- [x] generationGuidance with `{strategy: 'x', percent: 50}` → parses to `{tactic: 'x', percent: 50}`
- [x] generationGuidance with `{tactic: 'x', percent: 50}` → parses directly
- [x] Write path emits `tacticEffectiveness`, not `strategyEffectiveness`

### E2E Tests
- [x] Existing `admin-evolution-run-pipeline.spec.ts` should continue passing (backward compat)
- [x] New: tactic list page renders, tactic detail page shows overview + By Prompt tab
- [x] New: prompt detail page shows Tactics tab with performance table

### Manual Verification
- [x] Create a strategy config with generationGuidance weighting new tactics via admin UI
- [x] Verify tactic list page shows all 24 system tactics with metric columns
- [x] Verify tactic detail page shows prompt text + cross-run metrics + By Prompt breakdown
- [x] Verify prompt detail page shows Tactics tab with per-tactic performance sorted by Elo
- [x] Verify experiment analysis card shows tactic breakdown with winner counts
- [x] Verify dashboard heatmap renders Tactic × Prompt matrix with color intensity
- [x] Verify lineage graph shows correct colors for new tactics
- [x] Verify tactic effectiveness table shows new tactic names on run detail

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Verify `/admin/evolution/tactics` list page renders with all 24 system tactics
- [x] Verify `/admin/evolution/tactics/[id]` detail page shows prompt text + metrics + By Prompt tab
- [x] Verify `/admin/evolution/tactics/[id]?tab=by-prompt` shows per-prompt performance table
- [x] Verify prompt detail page shows "Tactics" tab with `TacticPromptPerformanceTable`
- [x] Verify experiment analysis card shows "Tactic Breakdown" section
- [x] Verify dashboard heatmap renders (or shows empty state with no data)
- [x] Verify strategy creation form shows all tactics in generationGuidance dropdown
- [x] Verify lineage graph renders correct colors for new tactic variants
- [x] Verify "Tactic Effectiveness" label renders correctly on run detail Metrics tab

### B) Automated Tests
- [x] `npm run test:unit -- --grep "tactic"`
- [x] `npm run test:unit -- --grep "generateFromSeedArticle"`
- [x] `npm run test:unit -- --grep "runIterationLoop"`
- [x] `npm run test:unit -- --grep "estimateCosts"`
- [x] `npm run test:unit -- --grep "syncSystemTactics"`
- [x] `npm run test:integration`
- [x] `npm run test:e2e -- --grep "evolution"`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/agents/overview.md` — add descriptions for all 16 new + 5 extended tactics; rename "strategy" → "tactic"
- [x] `evolution/docs/architecture.md` — tactic entity, count update, terminology clarification
- [x] `evolution/docs/data_model.md` — `evolution_tactics` table, `tactic` column on invocations, `entity_type='tactic'` in metrics
- [x] `evolution/docs/entities.md` — TacticEntity in diagram, relationships, action matrix
- [x] `evolution/docs/strategies_and_experiments.md` — rename "generation strategy" → "tactic", generationGuidance weighted selection, per-prompt tactic analysis
- [x] `evolution/docs/metrics.md` — tactic-level metrics, propagation definitions, per-prompt breakdown
- [x] `evolution/docs/cost_optimization.md` — EMPIRICAL_OUTPUT_CHARS table with new tactics
- [x] `evolution/docs/reference.md` — file references for tactics/, admin pages, sync script, TacticPromptPerformanceTable
- [x] `evolution/docs/visualization.md` — TACTIC_PALETTE, tactic admin pages, By Prompt tab, dashboard heatmap
- [x] `evolution/docs/curriculum.md` — glossary: "tactic" definition, "strategy" clarification

## Review & Discussion

### Iteration 1 (all 3/5)
**Security:** CHECK constraint needs non-blocking pattern; stale trigger must cascade to tactic; Zod .strict() migration needs detail.
**Architecture:** CORE_ENTITY_TYPES needs 'tactic'; propagateMetrics() can't be reused (typed to strategy/experiment, variant-level aggregation needed); variant Elo in DB columns not metrics rows.
**Testing:** No rollback plan; no Zod preprocess migration tests; sync CI integration vague.
→ Fixed: Added NOT VALID+VALIDATE, trigger cascade SQL, rollback plan, renameKeys detail, computeTacticMetrics(), CORE_ENTITY_TYPES change, 9 preprocess test cases, CI sync step.

### Iteration 2 (Security 4/5, Architecture 3/5, Testing 4/5)
**Architecture:** CHECK SQL drops arena_topic; stale trigger deploys before recompute handler.
→ Fixed: Added verification comment; deferred trigger to Phase 3 (co-deploys with handler).

### Iteration 3 (Security 3/5, Architecture 5/5, Testing 5/5)
**Security:** arena_topic still missing from CHECK. Investigated: migration 20260324000001 already removed arena_topic. Plan's SQL is correct.
→ Fixed: Added clarifying comment referencing 20260324000001.

### Iteration 4 — ✅ CONSENSUS (all 5/5)
All reviewers confirmed fixes. Plan ready for execution.
