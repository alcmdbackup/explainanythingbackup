# Remove Test Prompts Strategies From Local Plan

## Background
Filter out any prompts or strategies containing "test" from "pipeline runs" dropdowns.

## Requirements (from GH Issue #495)
Filter out any prompts or strategies containing "test" from "pipeline runs" dropdowns.

## Problem
The evolution admin UI has two pages with prompt/strategy dropdowns — the Start Run Card (`/admin/quality/evolution`) and the Explorer filters (`/admin/quality/explorer`). Both currently show all active prompts and strategies, including test entries. The `isTestEntry()` predicate already exists in `evolution/src/lib/core/configValidation.ts` with 6 passing tests, and the docs already claim it's wired up (README.md line 64) — but it was never actually connected to the UI. Admin CRUD pages (`/admin/quality/prompts`, `/admin/quality/strategies`) should remain unfiltered by design.

## Options Considered

1. **Client-side filter (chosen)** — Add `.filter()` using `isTestEntry()` in the two `useEffect` blocks that populate dropdown state. Minimal change, matches the original design decision documented in the prior planning doc. No server-side changes needed.

2. **Server-side filter** — Add an `excludeTest?: boolean` param to `getPromptsAction`/`getStrategiesAction` and filter in the DB query. Heavier change, couples test-name logic to the server, and the admin pages would need to explicitly opt out.

3. **Database column (`is_test`)** — Add a boolean column and filter on it. Most robust but requires a migration, backfill, and UI for toggling the flag. Overkill for this use case.

**Decision**: Option 1. The predicate is already pure and client-safe. Two lines of `.filter()` per page is the simplest correct fix.

## Phased Execution Plan

### Phase 1: Wire up isTestEntry in both pages

**File 1: `src/app/admin/quality/evolution/page.tsx`**
- Add import: `import { isTestEntry } from '@evolution/lib/core/configValidation';`
- Lines 173-174: Change `setPrompts(pRes.data.map(...))` to filter first:
  ```typescript
  setPrompts(pRes.data.filter(p => !isTestEntry(p.title)).map(p => ({ id: p.id, label: p.title })));
  ```
- Lines 176-177: Same for strategies:
  ```typescript
  setStrategies(sRes.data.filter(s => !isTestEntry(s.name)).map(s => ({ id: s.id, label: s.name })));
  ```

**File 2: `src/app/admin/quality/explorer/page.tsx`**
- Add import: `import { isTestEntry } from '@evolution/lib/core/configValidation';`
- Lines 536-537: Filter prompts:
  ```typescript
  setPromptOptions(pRes.data.filter(p => !isTestEntry(p.title)).map(p => ({ id: p.id, label: p.title })));
  ```
- Lines 539-540: Filter strategies:
  ```typescript
  setStrategyOptions(sRes.data.filter(s => !isTestEntry(s.name)).map(s => ({ id: s.id, label: s.name })));
  ```

**Verify**: lint, tsc, build pass.

### Phase 2: Commit and verify

- Commit the two-file change
- Run unit tests to confirm no regressions

## Testing

### Existing tests (no changes needed)
- `evolution/src/lib/core/configValidation.test.ts` — 6 tests already cover `isTestEntry()` behavior

### Manual verification on stage
1. Go to `/admin/quality/evolution` → open Prompt dropdown → confirm no entries with "test" in the name appear
2. Same page → open Strategy dropdown → confirm no "test" strategies appear
3. Go to `/admin/quality/explorer` → open Prompt filter → confirm no "test" prompts
4. Same page → open Strategy filter → confirm no "test" strategies
5. Go to `/admin/quality/prompts` → confirm all prompts including test ones still visible (admin CRUD unfiltered)
6. Go to `/admin/quality/strategies` → confirm all strategies including test ones still visible

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` — Already documents this behavior at line 64. No update needed since the doc already claims the filter is active; this change makes reality match the docs.
- `docs/feature_deep_dives/testing_setup.md` — No update needed (describes test infrastructure, not dropdown filtering)
- `docs/feature_deep_dives/testing_pipeline.md` — No update needed (describes AI suggestion testing pipeline, unrelated)
- `docs/docs_overall/testing_overview.md` — No update needed (describes [TEST] prefix convention, unrelated)
- `docs/feature_deep_dives/ai_suggestions_overview.md` — No update needed (AI editor, not evolution dropdowns)
