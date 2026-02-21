# Remove Test Prompts Strategies From Local Research

## Problem Statement
Filter out any prompts or strategies containing "test" from "pipeline runs" dropdowns.

## Requirements (from GH Issue #495)
Filter out any prompts or strategies containing "test" from "pipeline runs" dropdowns.

## High Level Summary

The `isTestEntry()` predicate already exists in `evolution/src/lib/core/configValidation.ts` (line 14) and is exported, tested (6 tests), and documented — but it is **never called** in the two UI components that render prompt/strategy dropdowns. The docs (README.md line 64) claim test filtering is active, but it's not wired up yet.

**Two locations need the filter applied:**

1. **Start Run Card** — `src/app/admin/quality/evolution/page.tsx` lines 167-180
2. **Explorer Filters** — `src/app/admin/quality/explorer/page.tsx` lines 530-543

Both fetch prompts/strategies via `getPromptsAction({ status: 'active' })` and `getStrategiesAction({ status: 'active' })`, then map them to `{ id, label }` without any name-based filtering.

The fix is purely client-side: add `.filter()` calls using `isTestEntry()` on the mapped arrays before setting state.

## Detailed Findings

### 1. isTestEntry() — Already Implemented

**File:** `evolution/src/lib/core/configValidation.ts:14-16`

```typescript
export function isTestEntry(name: string): boolean {
  return name.toLowerCase().includes('test');
}
```

- Pure function, no Node.js imports — safe for `'use client'` components
- Exported from barrel: `evolution/src/lib/index.ts:97`
- 6 unit tests in `configValidation.test.ts:10-34`
- Known false positive: "Contest" → `true` (accepted per design decision)

### 2. Start Run Card — Missing Filter

**File:** `src/app/admin/quality/evolution/page.tsx:167-180`

```typescript
useEffect(() => {
  (async () => {
    const [pRes, sRes] = await Promise.all([
      getPromptsAction({ status: 'active' }),
      getStrategiesAction({ status: 'active' }),
    ]);
    if (pRes.success && pRes.data) {
      setPrompts(pRes.data.map(p => ({ id: p.id, label: p.title })));  // ← no filter
    }
    if (sRes.success && sRes.data) {
      setStrategies(sRes.data.map(s => ({ id: s.id, label: s.name })));  // ← no filter
    }
  })();
}, []);
```

Dropdown renders at lines 249-262 using native `<select>` elements.

### 3. Explorer Page — Missing Filter

**File:** `src/app/admin/quality/explorer/page.tsx:530-543`

Same pattern — fetches with `{ status: 'active' }`, maps to `{ id, label }`, no name filtering. Uses a custom `SearchableMultiSelect` component (lines 225-325).

### 4. Admin Management Pages — Intentionally Unfiltered

Per design: admin prompt/strategy CRUD pages show all entries including test ones:
- `src/app/admin/quality/prompts/page.tsx` — Prompt registry (full CRUD)
- `src/app/admin/quality/strategies/page.tsx` — Strategy registry (full CRUD)

These should NOT be filtered (by design, per README.md line 64).

### 5. Server Actions — No Server-Side Filtering

Neither `getPromptsAction` nor `getStrategiesAction` has test-name filtering. This is by design — the filtering is client-side only, applied per the design decision in `docs/planning/invalid_config_still_present_stage_20260214/_planning.md:27`:

> `includes('test')` — Simplest approach. Applied client-side in StartRunCard only — admin management pages still show everything.

### 6. Audit Script — Already Uses isTestEntry

**File:** `evolution/scripts/audit-evolution-configs.ts:28,55-56`

The audit script imports `isTestEntry` to tag and count test-named strategies in its output, confirming the function is battle-tested beyond unit tests.

## Code References

| File | Lines | Description |
|------|-------|-------------|
| `evolution/src/lib/core/configValidation.ts` | 14-16 | `isTestEntry()` definition |
| `evolution/src/lib/core/configValidation.test.ts` | 10-34 | 6 unit tests for `isTestEntry()` |
| `evolution/src/lib/index.ts` | 97 | Barrel export |
| `src/app/admin/quality/evolution/page.tsx` | 167-180 | Start Run Card data fetch (needs filter) |
| `src/app/admin/quality/evolution/page.tsx` | 249-262 | Prompt/strategy `<select>` dropdowns |
| `src/app/admin/quality/explorer/page.tsx` | 530-543 | Explorer data fetch (needs filter) |
| `src/app/admin/quality/explorer/page.tsx` | 225-325 | `SearchableMultiSelect` component |
| `evolution/scripts/audit-evolution-configs.ts` | 28, 55-56 | Audit script usage of `isTestEntry` |
| `evolution/docs/evolution/README.md` | 64 | Doc claiming filter is active |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/testing_pipeline.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/ai_suggestions_overview.md

### Evolution Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- `evolution/src/lib/core/configValidation.ts` — isTestEntry definition
- `evolution/src/lib/core/configValidation.test.ts` — isTestEntry tests
- `src/app/admin/quality/evolution/page.tsx` — Start Run Card + dropdowns
- `src/app/admin/quality/explorer/page.tsx` — Explorer filters + SearchableMultiSelect
- `evolution/src/services/promptRegistryActions.ts` — getPromptsAction
- `evolution/src/services/strategyRegistryActions.ts` — getStrategiesAction

## Open Questions
None — the predicate exists, the locations are identified, the change is straightforward.
