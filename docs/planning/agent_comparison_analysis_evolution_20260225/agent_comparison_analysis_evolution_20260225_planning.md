# Agent Comparison Analysis Evolution Plan

## Background
Investigate and document how agent efficiency comparisons work in the evolution dashboard, specifically the Explorer > Agents average rating view and the Optimization > Agent Analysis ROI leaderboard. Clarify the methodology behind each metric (avg Elo per agent, Elo gain, Elo per dollar), identify any gaps or inconsistencies in how ratings are computed and attributed, and propose improvements to make agent comparison more actionable for optimizing pipeline configurations.

## Requirements (from GH Issue #564)
- [x] Explorer > Agents > average rating — understand what avg_elo means, how it's computed per agent
- [x] Optimization > Agent Analysis — understand the ROI leaderboard methodology
- [x] Document the data flow from pipeline execution → agent metrics → dashboard display
- [x] Identify gaps or improvements in agent comparison methodology
- [ ] Fix identified bugs and inconsistencies
- [ ] Add test coverage for previously untested code paths
- [ ] Backfill historical data with corrected values

## Problem
`persistAgentMetrics()` in `metricsWriter.ts` is the ONLY place in the entire codebase that uses raw OpenSkill `mu` for rating computation. Every other path (`persistVariants`, `computeFinalElo`, `getTopByRating`, Hall of Fame, tournament) uses `ordinalToEloScale(getOrdinal(rating))`. This causes `avg_elo` to store values on a ~0-50 scale (mu) instead of the 0-3000 Elo scale used everywhere else, inflating apparent skill by ~50% and creating an incompatible rating scale between the Explorer table view and the matrix/trend views. Additionally, `tree_search_*` strategies silently return `null` from the agent mapping, dropping all TreeSearch metrics with no error logged. Both bugs went undetected because `persistAgentMetrics()` has zero test coverage.

## Options Considered

### Option A: Fix Forward Only (code fix, no data migration)
- Fix `persistAgentMetrics()` to use ordinal-based Elo
- Add `tree_search_*` mapping
- Historical data remains incorrect
- **Pro**: Simplest change, zero migration risk
- **Con**: ROI leaderboard (30-day lookback) will mix old mu-scale and new Elo-scale data until old data ages out

### Option B: Fix + Data Backfill Migration (CHOSEN)
- Fix code bugs
- Add SQL migration to recalculate all existing rows from `content_evolution_variants.elo_score`
- **Pro**: Clean, consistent historical data immediately. Backfill is safe because `elo_score` in variants table is already correct (persisted by `persistVariants()` using the correct path)
- **Con**: Slightly more work, but precedent exists (`20260201000002_backfill_variants_generated.sql`)

### Option C: Replace `evolution_run_agent_metrics` with materialized view over `evolution_agent_invocations`
- Drop the pre-computed table, query invocations + variants on demand
- **Pro**: Single source of truth, supports all agents including non-generating
- **Con**: Large refactor, performance regression for ROI queries (hundreds of rows per run vs ~10), breaks 5 consumers. Overkill for this issue.

**Decision: Option B** — fixes bugs and backfills historical data with minimal risk. Leaves Option C as potential future optimization.

## Phased Execution Plan

### Phase 1: Core Bug Fixes (metricsWriter.ts)
Two bug fixes in a single file, independently testable.

#### 1a. Fix `persistAgentMetrics()` Elo computation

**File:** `evolution/src/lib/core/metricsWriter.ts:207-209`

**Before:**
```typescript
const eloSum = variants.reduce((s, v) => s + (ctx.state.ratings.get(v.id)?.mu ?? 25), 0);
const avgElo = eloSum / variants.length;
const eloGain = avgElo - 25;
```

**After:**
```typescript
const eloSum = variants.reduce((s, v) => {
  const rating = ctx.state.ratings.get(v.id) ?? createRating();
  return s + ordinalToEloScale(getOrdinal(rating));
}, 0);
const avgElo = eloSum / variants.length;
const eloGain = avgElo - 1200;
```

**Imports:** Already present at metricsWriter.ts line 5: `import { getOrdinal, ordinalToEloScale, createRating } from './rating'`. No import changes needed.

#### 1b. Add `tree_search_*` pattern match to `getAgentForStrategy()`

**File:** `evolution/src/lib/core/metricsWriter.ts:119-125`

**Before:**
```typescript
export function getAgentForStrategy(strategy: string): string | null {
  const direct = STRATEGY_TO_AGENT[strategy];
  if (direct) return direct;
  if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
  if (strategy.startsWith('section_decomposition_')) return 'sectionDecomposition';
  return null;
}
```

**After:**
```typescript
export function getAgentForStrategy(strategy: string): string | null {
  const direct = STRATEGY_TO_AGENT[strategy];
  if (direct) return direct;
  if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
  if (strategy.startsWith('section_decomposition_')) return 'sectionDecomposition';
  if (strategy.startsWith('tree_search_')) return 'treeSearch';
  return null;
}
```

**Verification:** After edit, run lint + tsc + existing tests:
```bash
cd evolution && npx eslint src/lib/core/metricsWriter.ts --fix
npx tsc --noEmit
npx jest src/lib/core/metricsWriter.test.ts --no-coverage
```

---

### Phase 2: Unit Tests for `persistAgentMetrics()`
Add comprehensive tests using existing test infrastructure (`ratingWithOrdinal`, `makeMockCostTracker`, `makeCtx`, `makeMockSupabase`).

**File:** `evolution/src/lib/core/metricsWriter.test.ts`

Add a new `describe('persistAgentMetrics')` block after the existing `describe('persistCostPrediction')` block. Tests will:

1. Mock `createSupabaseServiceClient` to return a chainable mock with `.from().upsert()` tracking
2. Create `PipelineStateImpl` with variants + known ratings
3. Call `persistAgentMetrics()` and assert the upsert payload

**Supabase mock setup pattern** (required since `persistAgentMetrics` calls `createSupabaseServiceClient()` internally):
```typescript
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
// The jest.mock at line 11 already mocks this module.
// Per-test setup:
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockSb = { from: jest.fn().mockReturnValue({ upsert: mockUpsert }) };
(createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSb);
```

**Additional imports needed** (update existing import at line 3):
```typescript
// Line 3: add persistAgentMetrics to existing import
import { computeFinalElo, getAgentForStrategy, STRATEGY_TO_AGENT, persistCostPrediction, persistAgentMetrics } from './metricsWriter';
// New import for rating functions used in assertions
import { ordinalToEloScale, createRating } from './rating';
```

**Helper for creating variants in state pool** (uses the same `TextVariation` shape as existing tests at line 71-73):
```typescript
let variantCounter = 0;
function addVariantToState(state: PipelineStateImpl, strategy: string, rating?: Rating) {
  const id = `test-v-${++variantCounter}`;
  state.addToPool({
    id, text: 'test variant', version: 1, parentIds: [],
    strategy, createdAt: Date.now() / 1000, iterationBorn: 0,
  });
  if (rating) state.ratings.set(id, rating);
  return id;
}
```

**Key test cases (10 tests):**

```typescript
describe('persistAgentMetrics', () => {
  let mockUpsert: jest.Mock;
  let mockSb: { from: jest.Mock };

  beforeEach(() => {
    mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockSb = { from: jest.fn().mockReturnValue({ upsert: mockUpsert }) };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSb);
  });

  // A: Elo Conversion
  it('computes avg_elo using ordinalToEloScale, not raw mu', async () => {
    const state = new PipelineStateImpl('text');
    const rating = ratingWithOrdinal(10); // mu=19, sigma=3, ordinal=10
    addVariantToState(state, 'structural_transform', rating);
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.25 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    expect(rows[0].avg_elo).toBeCloseTo(ordinalToEloScale(10)); // 1360, NOT 19
    expect(rows[0].elo_gain).toBeCloseTo(ordinalToEloScale(10) - 1200); // 160, NOT -6
  });

  it('computes elo_gain relative to baseline 1200', async () => {
    // Default rating: ordinal = 25 - 3*8.333 ≈ 0 → Elo 1200 → gain 0
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform'); // no explicit rating → default
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.10 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    expect(rows[0].elo_gain).toBeCloseTo(0); // default rating → Elo 1200 → gain 0
  });

  // B: TreeSearch
  it('maps tree_search_* strategies to treeSearch agent', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'tree_search_expand', ratingWithOrdinal(5));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ treeSearch: 0.30 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    expect(rows[0].agent_name).toBe('treeSearch');
  });

  // C: Filtering
  it('skips agents with zero matching variants', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(5));
    const ctx = makeCtx(state);
    // reflection has cost but no variants
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({
      generation: 0.25, reflection: 0.10
    });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_name).toBe('generation');
  });

  it('counts variants_generated correctly per agent', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(5));
    addVariantToState(state, 'lexical_simplify', ratingWithOrdinal(8));
    addVariantToState(state, 'grounding_enhance', ratingWithOrdinal(3));
    addVariantToState(state, 'mutate_clarity', ratingWithOrdinal(6));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({
      generation: 0.30, evolution: 0.15
    });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0] as Array<{ agent_name: string; variants_generated: number }>;
    const gen = rows.find(r => r.agent_name === 'generation');
    const evo = rows.find(r => r.agent_name === 'evolution');
    expect(gen?.variants_generated).toBe(3);
    expect(evo?.variants_generated).toBe(1);
  });

  // D: Ratings
  it('defaults to createRating() when variant has no rating in state', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform'); // no rating set
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.25 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    // createRating() → mu=25, sigma=8.333 → ordinal≈0 → Elo≈1200
    expect(rows[0].avg_elo).toBeCloseTo(1200, 0);
  });

  // E: Cost
  it('computes elo_per_dollar as elo_gain / cost_usd', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(10));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.50 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    const rows = mockUpsert.mock.calls[0][0];
    const expectedGain = ordinalToEloScale(10) - 1200;
    expect(rows[0].elo_per_dollar).toBeCloseTo(expectedGain / 0.50);
  });

  it('sets elo_per_dollar to null when cost is zero', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(10));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);
    // With cost=0, variants.length is > 0, so the agent IS included but elo_per_dollar = null
    // Actually: if cost is 0, the agent still has variants, so it's included
    // Wait — costTracker returns { generation: 0 }, so agentCosts has generation=0
    // variants.length > 0, so row is created. costUsd=0 → elo_per_dollar: null
    const rows = mockUpsert.mock.calls[0][0];
    expect(rows[0].elo_per_dollar).toBeNull();
  });

  // F: Upsert
  it('uses onConflict run_id,agent_name for idempotent upsert', async () => {
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(5));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.25 });

    await persistAgentMetrics('run-1', ctx, ctx.logger);

    expect(mockUpsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'run_id,agent_name' });
  });

  it('logs warning but does not throw on upsert error', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'DB error' } });
    const state = new PipelineStateImpl('text');
    addVariantToState(state, 'structural_transform', ratingWithOrdinal(5));
    const ctx = makeCtx(state);
    (ctx.costTracker.getAllAgentCosts as jest.Mock).mockReturnValue({ generation: 0.25 });

    await expect(persistAgentMetrics('run-1', ctx, ctx.logger)).resolves.not.toThrow();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Failed to batch persist agent metrics',
      expect.objectContaining({ error: 'DB error' })
    );
  });
});
```

**Also add tree_search test to existing `getAgentForStrategy` describe:**
```typescript
it('maps tree_search_expand to treeSearch', () => {
  expect(getAgentForStrategy('tree_search_expand')).toBe('treeSearch');
});
it('maps tree_search_restructure to treeSearch', () => {
  expect(getAgentForStrategy('tree_search_restructure')).toBe('treeSearch');
});
```

**Verification:**
```bash
cd evolution && npx jest src/lib/core/metricsWriter.test.ts --no-coverage --verbose
```

---

### ~~Phase 3: UI Threshold Fixes~~ — REMOVED

**No UI changes needed.** The `eloPerDollarColor()` thresholds (200/100) in `StrategyLeaderboard.tsx:112-117` and `strategies/page.tsx:84-89` display `avg_elo_per_dollar` from `evolution_strategy_configs`, NOT from `evolution_run_agent_metrics`. The strategy-level values are computed by the `update_strategy_aggregates` RPC (migration 20260215000003), which uses `computeFinalElo()` → `ordinalToEloScale(getOrdinal())` — the **already-correct** path. These thresholds were never affected by the mu-scale bug and should not be changed.

---

### Phase 4: Data Backfill Migration
Create SQL migration to recalculate all existing `evolution_run_agent_metrics` rows from the correct source data.

**File:** `supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql`

**Important column naming note:** The `evolution_variants` table has a column called `agent_name` that actually stores *strategy* names (e.g., `'structural_transform'`), not agent names. This is because `persistence.ts:77` does `agent_name: v.strategy`. The SQL below accounts for this by mapping the `agent_name` column values (which are strategies) to actual agent names via a CASE expression, mirroring `getAgentForStrategy()`.

```sql
-- Fix agent metrics Elo computation: avg_elo was stored as raw OpenSkill mu (~25 scale)
-- instead of ordinalToEloScale(getOrdinal()) (~1200 scale). Backfill from the correct
-- elo_score values already persisted in evolution_variants.
--
-- NOTE: evolution_variants.agent_name stores STRATEGY names (e.g., 'structural_transform'),
-- not agent names. See persistence.ts:77. The CASE expression below mirrors getAgentForStrategy().

-- Step 0: Snapshot current values for rollback capability
CREATE TABLE IF NOT EXISTS _backup_agent_metrics_pre_elo_fix AS
SELECT id, run_id, agent_name, avg_elo, elo_gain, elo_per_dollar
FROM evolution_run_agent_metrics;

-- Step 1: Derive correct Elo-scale values from evolution_variants
-- Using a CTE with the strategy-to-agent mapping to avoid repeating the CASE
WITH strategy_agent_map AS (
  SELECT
    v.run_id,
    CASE
      WHEN v.agent_name IN ('structural_transform', 'lexical_simplify', 'grounding_enhance')
        THEN 'generation'
      WHEN v.agent_name IN ('mutate_clarity', 'mutate_structure', 'crossover', 'creative_exploration')
        THEN 'evolution'
      WHEN v.agent_name = 'debate_synthesis' THEN 'debate'
      WHEN v.agent_name = 'original_baseline' THEN 'original'
      WHEN v.agent_name IN ('outline_generation', 'mutate_outline') THEN 'outlineGeneration'
      WHEN v.agent_name LIKE 'critique_edit_%' THEN 'iterativeEditing'
      WHEN v.agent_name LIKE 'section_decomposition_%' THEN 'sectionDecomposition'
      WHEN v.agent_name LIKE 'tree_search_%' THEN 'treeSearch'
      ELSE NULL
    END AS mapped_agent,
    v.elo_score
  FROM evolution_variants v
  WHERE v.agent_name IS NOT NULL
),
derived AS (
  SELECT
    run_id,
    mapped_agent AS agent_name,
    AVG(elo_score) AS avg_elo,
    AVG(elo_score) - 1200 AS elo_gain
  FROM strategy_agent_map
  WHERE mapped_agent IS NOT NULL
  GROUP BY run_id, mapped_agent
)
UPDATE evolution_run_agent_metrics m
SET
  avg_elo = d.avg_elo,
  elo_gain = d.elo_gain,
  elo_per_dollar = CASE
    WHEN m.cost_usd > 0 THEN d.elo_gain / m.cost_usd
    ELSE NULL
  END
FROM derived d
WHERE m.run_id = d.run_id
  AND m.agent_name = d.agent_name;

-- Step 2: Fix stale comment in column description
COMMENT ON COLUMN evolution_run_agent_metrics.elo_per_dollar IS
  'Elo points gained per dollar spent: (avg_elo - 1200) / cost_usd, where avg_elo is on the 0-3000 Elo scale';

-- Rollback:
-- SELECT count(*) FROM _backup_agent_metrics_pre_elo_fix; -- verify backup exists
-- UPDATE evolution_run_agent_metrics m
-- SET avg_elo = b.avg_elo, elo_gain = b.elo_gain, elo_per_dollar = b.elo_per_dollar
-- FROM _backup_agent_metrics_pre_elo_fix b WHERE m.id = b.id;
-- DROP TABLE _backup_agent_metrics_pre_elo_fix;
--
-- After confirming the migration is correct, clean up the backup table:
-- DROP TABLE IF EXISTS _backup_agent_metrics_pre_elo_fix;
```

**Verification:**
```bash
# Check migration file syntax
cat supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql
# Verify naming convention follows existing pattern
ls supabase/migrations/ | tail -5
```

---

### Phase 5: Stale Comment Fix + E2E Test Data Update

#### 5a. Fix stale DB migration comment (documentation-only)

**File:** `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql`

Fix the inline comment referencing the stale formula. **Note:** This migration has already been applied to production, so editing it has no runtime effect — it's purely for code-archaeology accuracy. The Phase 4 migration's `COMMENT ON COLUMN` already updates the live DB-level description.

#### 5b. Update E2E test seed data

**File:** `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts:97-101`

**Before:**
```typescript
{ run_id: run.id, agent_name: 'generation', cost_usd: 0.25, elo_gain: 50, elo_per_dollar: 200 },
{ run_id: run.id, agent_name: 'tournament', cost_usd: 0.15, elo_gain: 30, elo_per_dollar: 200 },
{ run_id: run.id, agent_name: 'evolution', cost_usd: 0.10, elo_gain: 20, elo_per_dollar: 200 },
```

**After** (Elo-scale values — elo_gain is now relative to 1200 baseline):
```typescript
{ run_id: run.id, agent_name: 'generation', cost_usd: 0.25, avg_elo: 1450, elo_gain: 250, elo_per_dollar: 1000 },
{ run_id: run.id, agent_name: 'evolution', cost_usd: 0.10, avg_elo: 1380, elo_gain: 180, elo_per_dollar: 1800 },
```

Note: Removed `tournament` row since tournament is a non-generating agent and shouldn't appear in `evolution_run_agent_metrics`. Added `avg_elo` values for completeness.

**Verification:**
```bash
npx tsc --noEmit
# E2E test is currently skipped, so just verify compilation
```

---

### Phase 6: Documentation Updates

Update evolution docs to reflect the corrected agent metrics computation:

| File | Update Needed |
|------|---------------|
| `evolution/docs/evolution/cost_optimization.md` | Clarify that agent ROI uses Elo-scale (0-3000) not raw mu. Document the `tree_search_*` mapping. |
| `evolution/docs/evolution/visualization.md` | Note that Explorer table and matrix views now use consistent Elo-scale rating. |
| `evolution/docs/evolution/data_model.md` | Update `evolution_run_agent_metrics` schema description to specify Elo-scale for `avg_elo`. |

---

## All Files Modified

### Code Changes
| File | Change | Phase |
|------|--------|-------|
| `evolution/src/lib/core/metricsWriter.ts` | Fix Elo computation (L207-209) + add tree_search mapping (L123) | 1 |
| `evolution/src/lib/core/metricsWriter.test.ts` | Add ~12 tests for `persistAgentMetrics()` + 2 for tree_search mapping | 2 |
| `supabase/migrations/20260225000001_fix_agent_metrics_elo_scale.sql` | New: data backfill migration + backup table + rollback SQL | 4 |
| `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` | Fix stale comment (documentation-only, already applied) | 5 |
| `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts` | Update seed data to Elo-scale | 5 |

### Documentation Changes
| File | Change | Phase |
|------|--------|-------|
| `evolution/docs/evolution/cost_optimization.md` | Agent ROI uses Elo-scale, tree_search mapping | 6 |
| `evolution/docs/evolution/visualization.md` | Consistent rating scales | 6 |
| `evolution/docs/evolution/data_model.md` | Schema description update | 6 |

## Testing

### Unit Tests (Phase 2)
- **File:** `evolution/src/lib/core/metricsWriter.test.ts`
- **New tests:** ~12 tests in `describe('persistAgentMetrics')` + 2 tree_search mapping tests
- **Run:** `cd evolution && npx jest src/lib/core/metricsWriter.test.ts --no-coverage --verbose`

### Existing Test Verification
- **Run all metricsWriter tests:** Ensure no regression in `computeFinalElo` and `getAgentForStrategy` tests
- **Run eloBudgetActions tests:** `npx jest src/services/eloBudgetActions.test.ts` (consumers of agent_metrics)
- **Run unifiedExplorerActions tests:** `npx jest src/services/unifiedExplorerActions.test.ts` (Explorer consumers)

### Build Verification
```bash
npx eslint . --fix
npx tsc --noEmit
npm run build
```

### Manual Verification on Stage
After deploying with the migration:
1. Navigate to **Optimization > Agent Analysis** — verify ROI leaderboard shows Elo-scale values (~1200+ avg_elo, not ~25)
2. Navigate to **Explorer > Agents** (task view) — verify avg_elo is on same scale as matrix/trend views
3. Compare **Explorer table** avgElo values with **Explorer matrix** avgElo values for same runs — should now be consistent
4. Verify **StrategyLeaderboard** color coding applies correctly (green for high EPD, gold for medium)
5. Check that **treeSearch** agent appears in agent metrics if any pipeline runs used TreeSearch

## Documentation Updates

The following docs need updates to reflect the corrected computation:
- `evolution/docs/evolution/cost_optimization.md` — Agent ROI computation uses Elo-scale, not raw mu; tree_search now mapped
- `evolution/docs/evolution/visualization.md` — Explorer table and matrix views now use consistent Elo-scale
- `evolution/docs/evolution/data_model.md` — `evolution_run_agent_metrics.avg_elo` is on 0-3000 Elo scale (was incorrectly stored as raw mu ~0-50)

## Out of Scope (Future Work)
- **Non-generating agent cost visibility** (Issue #10) — reflection/calibration costs already visible in Budget tab via `evolution_agent_invocations`. Adding to ROI leaderboard requires schema + type changes.
- **Weighted ROI aggregation** (Issue #11) — design decision on whether to weight by cost/run size. Current arithmetic mean is acceptable for now.
- **`original` agent name mismatch** (Issue #9) — baseline variants have ~zero cost and are rarely informative for ROI. Low priority.
- **Replace `evolution_run_agent_metrics` with materialized view** (Option C) — would be a larger architectural change.
