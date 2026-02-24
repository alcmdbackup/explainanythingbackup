# Explain Experiment Setup Factor Selection Evolution Plan

## Background
When we have a range of factors in strategy experiments, we need to understand and improve how they are set. For example, how do we know which LLMs are cheaper vs more expensive? What if other factors are less ordinal? The current factor registry assigns Low/High levels to each factor, but the logic for determining this ordering — especially for models where cost data exists — needs to be audited and potentially improved.

## Requirements (from GH Issue #551)
1. Delete `estimateCostImpact()` from `FactorTypeDefinition` interface and all implementations — it is dead code with zero production consumers.
2. Fix judgeModel default ordering in `factorial.ts` — swap Low/High so Low = `gpt-5-nano` ($0.05) and High = `gpt-4.1-nano` ($0.10), consistent with the `orderValues()` convention.
3. Show input and output costs next to model names in the ExperimentForm UI dropdowns, sorted by cost.

## Problem
The factor registry has dead code (`estimateCostImpact()`) that gives the false impression of a cost estimation system that isn't actually used — the real estimation lives in `costEstimator.ts`. The judgeModel CLI defaults have Low/High inverted relative to the `orderValues()` convention, producing confusing analysis recommendations. The UI dropdowns show bare model names with no pricing context and in arbitrary order, making it hard for users to choose meaningful Low/High levels.

## Options Considered
These are straightforward fixes — no major architectural alternatives needed.

## Phased Execution Plan

### Phase 1: Remove `estimateCostImpact()` dead code
**Files to modify:**
- `evolution/src/experiments/evolution/factorRegistry.ts` — Remove `estimateCostImpact` from `FactorTypeDefinition` interface and all 4 implementations (model factor, iterations, agent set, editor). Remove `getCheapestInputPrice()` helper (private, only called by `estimateCostImpact`).
- `evolution/src/experiments/evolution/factorRegistry.test.ts` — Remove all `estimateCostImpact` test cases. Also update the generic interface validation test at line 26 (`expect(typeof def.estimateCostImpact).toBe('function')`) — remove `estimateCostImpact` from the checked methods.
- `src/app/api/cron/experiment-driver/route.test.ts` — Remove `estimateCostImpact` from mock factor definitions (lines 67, 74).

### Phase 2: Fix judgeModel default ordering and fallback
**Files to modify:**
- `evolution/src/experiments/evolution/factorial.ts:85` — Swap `DEFAULT_ROUND1_FACTORS.B` from `{ low: 'gpt-4.1-nano', high: 'gpt-5-nano' }` to `{ low: 'gpt-5-nano', high: 'gpt-4.1-nano' }` so Low = cheaper ($0.05) and High = more expensive ($0.10).
- `evolution/src/experiments/evolution/factorial.ts:164` — Update `mapFactorsToPipelineArgs()` fallback default from `'gpt-4.1-nano'` to `'gpt-5-nano'` (cheapest judge model, consistent with Low convention).

**Test files to update (hardcoded old ordering):**
- `evolution/src/experiments/evolution/factorial.test.ts:80,91` — Swap expected judgeModel values for rows 1 and 8 (these assert on resolved defaults and will break without change). Lines 121/127 pass explicit values to `mapFactorsToPipelineArgs` and are NOT affected by the default swap — do not change.
- `scripts/run-strategy-experiment.test.ts:92` — Swap Low/High in mock state factor definition. This is for forward-looking test consistency (old experiments carry their own factor definitions in state files).
- `src/app/api/cron/experiment-driver/route.test.ts:305,595` — Swap Low/High in factor definition objects.
- `src/__tests__/integration/strategy-experiment.integration.test.ts:110` — Update expected low-level assertion from `'gpt-4.1-nano'` to `'gpt-5-nano'`. This is an integration test — run explicitly with the integration test suite.

**Note on CLI state files:** The `analyze` command loads factors from the persisted state file (`experiments/strategy-experiment.json`), not from `DEFAULT_ROUND1_FACTORS`. Old experiments carry their own factor definitions and are unaffected by this change. No migration needed.

### Phase 3: Show model pricing in UI dropdowns, sorted by cost
**Interface change strategy — add parallel field, keep `validValues` unchanged:**

The current `FactorMetadata` interface has `validValues: (string | number)[]`. Keep this field as-is for backward compatibility. Add a new optional field `valuePricing` as a map from value to pricing:

```typescript
interface FactorMetadata {
  key: string;
  label: string;
  type: FactorType;
  validValues: (string | number)[];  // unchanged — now cost-sorted via orderValues()
  valuePricing?: Record<string, { inputPer1M: number; outputPer1M: number }>;  // NEW, model factors only
}
```

**Ordering change — `getValidValues()` → `orderValues(getValidValues())`:**

Switch from `def.getValidValues()` to `def.orderValues(def.getValidValues())` in `getFactorMetadataAction()`. This changes the order of `validValues` from schema enum order to cost-sorted order for model factors (ascending by input price). For iterations, editor, and agents, `orderValues()` already produces the current order (numeric ASC, cheap-first). This changes ExperimentForm's default Low/High initialization (line 99-103: `values[0]` / `values[values.length-1]`) — the default Low will now be the cheapest model and High the most expensive, which is the desired behavior.

**Files to modify:**
- `evolution/src/services/experimentActions.ts` — (1) Add `import { getModelPricing } from '@/config/llmPricing'`. (2) In `getFactorMetadataAction()`: change `def.getValidValues()` to `def.orderValues(def.getValidValues())`. (3) For model-type factors, call `getModelPricing()` per value and populate `valuePricing` map.
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — Add `valuePricing` prop to `FactorValueSelect` component signature. Thread `valuePricing` from `FactorMetadata` through both `<FactorValueSelect>` call sites (Low and High selects, ~lines 257-269). Render pricing alongside model names in dropdown options (e.g., `gpt-5-nano ($0.05/$0.40 per 1M)`). No changes to `values[0]`/`values[values.length-1]` init logic — cost-sorted ordering makes it produce correct defaults automatically.
- `evolution/src/services/experimentActions.test.ts` — Add assertion that model-type factors include `valuePricing` with correct keys. Verify `validValues` are returned in cost-sorted order.

## Testing
- **Phase 1**: Run `factorRegistry.test.ts` after removing dead tests and updating the interface check at line 26 — remaining tests pass. Run `experiment-driver/route.test.ts` after removing mock field.
- **Phase 2**: Update the 4 test files listed above (only the specific lines noted — do NOT change `factorial.test.ts:121,127`). Run unit tests for each file. Run the integration test explicitly: `npm test -- src/__tests__/integration/strategy-experiment.integration.test.ts`.
- **Phase 3**: Update `experimentActions.test.ts` to assert: (a) model-type factors include `valuePricing` with correct keys matching `validValues`, (b) `validValues` for model factors are returned in ascending input-price order. Manual verification: open `/admin/quality/optimization`, enable a model factor, confirm pricing shows in dropdowns sorted by cost with `/1M` units.
- **All phases**: Run lint, tsc, build, full unit test suite. Commit all source + test changes together to avoid red CI between commits.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` — Update Round 1 Factors table (line 28) to reflect corrected judgeModel Low/High (`gpt-5-nano` | `gpt-4.1-nano`). Remove any mention of `estimateCostImpact` if present.
- `evolution/docs/evolution/reference.md` — Remove `estimateCostImpact` from factor registry description if mentioned. Update `judgeModel` default in config section if referenced.
- `evolution/docs/evolution/architecture.md` — No changes expected.
- `evolution/docs/evolution/data_model.md` — No changes expected.
- `evolution/docs/evolution/cost_optimization.md` — No changes expected.
- `evolution/docs/evolution/hall_of_fame.md` — No changes expected.

## Non-Scope Items (noted from sweep, not fixing now)
- `analysis.ts:getFactorLevel()` assumes full-factorial levels are cost-ordered (low=first, high=last) but doesn't document this. Low risk since `orderValues()` upstream ensures cost ordering.
- `mapFactorsToPipelineArgs()` silently uses defaults for missing factors instead of erroring. Low risk since validation pipeline catches invalid configs upstream.
