# Reorganize Code Files Evolution Plan

## Background

Reorganize the codebase to cleanly separate evolution pipeline code from the main ExplainAnything application code. The goal is to enable two distinct top-level folders (e.g. src_evolution and src_explainanything) while avoiding a messy renaming exercise. This will improve maintainability and make it easier to reason about, develop, and potentially deploy the two systems independently.

## Requirements (from GH Issue #461)

- Separate evolution pipeline code from the rest of the ExplainAnything codebase
- Prefer two different top-level folders (e.g. `src_evolution` and `src_explainanything`) but open to other options
- Avoid creating a messy renaming exercise
- Maintain working builds, tests, and imports throughout the reorganization

## Problem

The evolution pipeline (~260 files) is scattered across 14 locations within `src/` — `src/lib/evolution/`, `src/components/evolution/`, `src/lib/services/evolution*.ts`, `src/app/admin/quality/`, `src/lib/experiments/evolution/`, plus scripts, docs, and config files. Despite being a fully isolated admin surface with zero user-facing dependencies, evolution code is interleaved with main app code, making it hard to reason about either system independently. The same applies to docs and scripts, where evolution files live alongside main app files.

## Chosen Approach: `evolution/` Sub-Project

Create a single top-level `evolution/` directory containing all evolution source code, docs, and scripts. The project root remains the ExplainAnything app. Admin pages and cron routes stay in `src/app/` (Next.js routing requirement) and import from `@evolution/*`.

### Target Structure

```
explainanything-base/
├── src/                              ← ExplainAnything source (Next.js root)
│   ├── app/
│   │   ├── admin/quality/            ← Evolution admin pages (MUST stay)
│   │   ├── admin/evolution-dashboard/← Evolution dashboard (MUST stay)
│   │   ├── api/cron/evolution*/      ← Cron routes (MUST stay)
│   │   └── ...                       ← All user-facing pages
│   ├── actions/
│   ├── components/                   ← Main app components (evolution/ removed)
│   ├── lib/
│   │   ├── services/                 ← Shared infra (llms.ts, adminAuth.ts, etc.)
│   │   └── ...                       ← No more lib/evolution/
│   └── testing/                      ← Main app test helpers
│
├── evolution/                        ← Everything evolution, one clear home
│   ├── src/
│   │   ├── lib/                      ← Core pipeline (from src/lib/evolution/)
│   │   │   ├── core/
│   │   │   ├── agents/
│   │   │   ├── section/
│   │   │   └── treeOfThought/
│   │   ├── components/               ← Dashboard UI (from src/components/evolution/)
│   │   ├── services/                 ← Server actions (from src/lib/services/evolution*.ts)
│   │   ├── config/                   ← promptBankConfig.ts
│   │   ├── experiments/              ← Factorial design experiments
│   │   └── testing/                  ← evolution-test-helpers, fixtures
│   ├── docs/                         ← From docs/evolution/
│   └── scripts/                      ← From scripts/ (evolution CLI tools)
│
├── docs/                             ← ExplainAnything docs (evolution/ removed)
├── scripts/                          ← Main app scripts
├── supabase/                         ← Shared (migrations interleaved, can't split)
├── .github/workflows/                ← Shared (GitHub requires this location)
├── package.json                      ← Single package, no workspaces
└── tsconfig.json                     ← Adds @evolution/* → ./evolution/src/*
```

### Import Pattern After Reorganization

```typescript
// Admin pages (in src/app/) import evolution code via @evolution/*
import { RunDetailView } from '@evolution/components/RunDetailView';
import { getEvolutionRuns } from '@evolution/services/evolutionActions';

// Evolution code imports shared infra via @/ (reaches into src/)
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { callLLM } from '@/lib/services/llms';

// Internal evolution imports — relative paths, no rewrites needed
import { type ExecutionContext } from '../types';
```

### Key Constraints

- **30 files MUST stay in `src/app/`**: admin pages, cron routes (Next.js routing)
- **Shared infra stays in `src/`**: llms.ts, adminAuth.ts, errorHandling.ts, etc.
- **Supabase migrations stay unified**: Supabase CLI requires all migrations in one dir
- **`.github/workflows/` stays unified**: GitHub requires this location
- **No monorepo tooling needed**: single package.json, no workspaces

## Options Considered

### Option A: Parallel top-level dirs (`src_evolution/`, `docs_evolution/`, `scripts_evolution/`)
Three new root-level directories mirroring the main app. Flatter nesting but adds 3 top-level dirs. Rejected in favor of a single `evolution/` directory that groups everything together.

### Option B: Consolidate within `src/` (`src/evolution/`)
Move all evolution code into `src/evolution/`. Lowest risk (0-1 config changes) but weak visual separation — `src/evolution/lib/` vs `src/lib/evolution/` is barely different. Does not achieve the "two distinct parts" goal.

### Option C: Internal package (`packages/evolution/`)
Create a proper npm workspace package. Strongest separation boundary but requires `transpilePackages` config, workspace hoisting changes, and monorepo tooling. Overkill for a 2-system split without independent deployment plans.

### Chosen: Single `evolution/` sub-project (variant of Option A)
One top-level `evolution/` directory containing `src/`, `docs/`, and `scripts/`. Clean "project within a project" feel. Requires 6 config file updates, ~200 import rewrites. No monorepo tooling. Moderate complexity, strong visual separation.

## Phased Execution Plan

Each phase produces a working build. Phases can be separate commits or grouped.

### Phase 0: Config Preparation

Update tooling configs to recognize the new `evolution/` directory BEFORE moving files. This ensures that once files move, everything still resolves.

**Files to modify:**

1. **`tsconfig.json`** — add path alias:
   ```json
   "paths": {
     "@/*": ["./src/*"],
     "@evolution/*": ["./evolution/src/*"]
   }
   ```

2. **`jest.config.js`** — add moduleNameMapper (before `@/`):
   ```js
   '^@evolution/(.*)$': '<rootDir>/evolution/src/$1',
   ```
   Also add `'evolution/src/**/*.{ts,tsx}'` to `collectCoverageFrom`.

3. **`jest.integration.config.js`** — same moduleNameMapper addition. Also add `'evolution/src/**/*.{ts,tsx}'` to `collectCoverageFrom` (must match jest.config.js update).

4. **`tailwind.config.ts`** — add content path:
   ```js
   './evolution/src/**/*.{js,ts,jsx,tsx,mdx}',
   ```

5. **`eslint.config.mjs`** — extend design-system rule `files` globs from `["src/**/*.ts", "src/**/*.tsx"]` to also include `["evolution/src/**/*.ts", "evolution/src/**/*.tsx"]`. This covers all 9 design-system rules (no-hardcoded-colors, no-arbitrary-text-sizes, prefer-warm-shadows, etc.) for evolution component files.

6. **`next.config.ts`** — Preemptively add `turbopack.resolveAlias` for `@evolution/*` → `./evolution/src/*`. Next.js 15.2.8 has a known Turbopack path alias bug (fixed in 15.3.3, GitHub #71886). Adding the fallback costs nothing and prevents silent dev-mode failures.

**Verification:**
1. `npm run lint && npx tsc --noEmit && npm run build` — should pass (new paths don't resolve to anything yet, which is fine since nothing imports `@evolution/*`)
2. `npm run test` — unit tests pass with the new moduleNameMapper
3. **Turbopack alias gate:** Create a temporary test file at `evolution/src/lib/__turbopack_test.ts` exporting a dummy value. Import it from a temporary file in `src/` using both a static `import` and a dynamic `await import('@evolution/lib/__turbopack_test')`. Run `next dev --turbopack` and verify both resolve. Delete both temp files after verification. This confirms the alias works for both static and dynamic imports BEFORE Phase 1 moves real files. If either fails, upgrade Next.js to 15.3+ before proceeding.

### Phase 1: Move Core Evolution Library

Move the largest, most self-contained piece first.

```
git mv src/lib/evolution/ evolution/src/lib/
```

**Import rewrites:**
- Evolution server actions importing `@/lib/evolution/...` → `@evolution/lib/...` (~12 statements)
- Evolution components importing `@/lib/evolution/...` → `@evolution/lib/...` (~25 statements)
- Admin pages importing `@/lib/evolution/...` → `@evolution/lib/...` (~8 statements, fewer than initially estimated — most admin page imports target services/components, not lib directly)
- Cron route dynamic imports: `route.ts` has **7 dynamic `import()` calls** referencing `@/lib/evolution` or `@/lib/evolution/*` — all must be rewritten to `@evolution/lib` / `@evolution/lib/*`. Additionally, `route.test.ts` has 2 static imports + 5 `jest.mock()` string paths from `@/lib/evolution` — all 7 references need rewriting (jest.mock paths are string literals that TypeScript does NOT validate).
- Integration tests → `@evolution/lib/...` (~18 statements across 7 test files, using both barrel `@/lib/evolution` and deep paths like `@/lib/evolution/core/costTracker`)

**Internal relative imports (468 occurrences) do NOT change** — files move together.

**Verification:** `npm run lint && npx tsc --noEmit && npm run test && npm run test:integration && npm run build`

### Phase 2: Move Evolution Components

```
git mv src/components/evolution/ evolution/src/components/
```

**Import rewrites:**
- Admin pages importing `@/components/evolution/...` → `@evolution/components/...` (~23 statements)
- Components importing each other — internal relative imports stay unchanged

**Verification:** `npm run lint && npx tsc --noEmit && npm run test && npm run test:integration && npm run build`

### Phase 3: Move Evolution Services, Config, and Experiments

```
git mv src/lib/services/evolutionActions.ts evolution/src/services/
git mv src/lib/services/evolutionActions.test.ts evolution/src/services/
git mv src/lib/services/evolutionVisualizationActions.ts evolution/src/services/
git mv src/lib/services/evolutionVisualizationActions.test.ts evolution/src/services/
git mv src/lib/services/evolutionBatchActions.ts evolution/src/services/
git mv src/lib/services/evolutionBatchActions.test.ts evolution/src/services/
git mv src/config/promptBankConfig.ts evolution/src/config/
git mv src/lib/experiments/evolution/ evolution/src/experiments/
```

Also move evolution-adjacent service files (with their colocated tests):
```
git mv src/lib/services/promptRegistryActions.ts evolution/src/services/
git mv src/lib/services/promptRegistryActions.test.ts evolution/src/services/
git mv src/lib/services/strategyRegistryActions.ts evolution/src/services/
git mv src/lib/services/strategyRegistryActions.test.ts evolution/src/services/
git mv src/lib/services/unifiedExplorerActions.ts evolution/src/services/
git mv src/lib/services/unifiedExplorerActions.test.ts evolution/src/services/
git mv src/lib/services/hallOfFameActions.ts evolution/src/services/
git mv src/lib/services/hallOfFameActions.test.ts evolution/src/services/
git mv src/lib/services/costAnalyticsActions.ts evolution/src/services/
git mv src/lib/services/costAnalyticsActions.test.ts evolution/src/services/
git mv src/lib/services/costAnalytics.ts evolution/src/services/
git mv src/lib/services/costAnalytics.test.ts evolution/src/services/
git mv src/lib/services/eloBudgetActions.ts evolution/src/services/
git mv src/lib/services/eloBudgetActions.test.ts evolution/src/services/
```

**Files that STAY in `src/lib/services/` (shared infrastructure, with their tests):**
- `contentQualityActions.ts` + `.test.ts` — imported by `src/app/admin/quality/page.tsx` (non-evolution)
- `contentQualityEval.ts` + `.test.ts` — imported by `src/app/api/cron/content-quality-eval/route.ts` (non-evolution cron)
- `contentQualityCompare.ts` + `.test.ts` — used by contentQualityEval
- `contentQualityCriteria.ts` + `.test.ts` — quality eval criteria definitions

These have zero imports from `@/lib/evolution/` and serve the content quality system which is shared infrastructure, not evolution-owned. The `content-quality-eval` cron route (`src/app/api/cron/content-quality-eval/route.ts`) stays in `src/` and is unaffected by the reorganization.

**`llmSemaphore.ts` also stays in `src/lib/services/`** — it is imported by the shared `llms.ts` module.

Move evolution-only utils:
```
git mv src/lib/utils/evolutionUrls.ts evolution/src/lib/utils/
git mv src/lib/utils/formatters.ts evolution/src/lib/utils/
```

**Import rewrites:**
- Admin pages importing these services → `@evolution/services/...`
- Evolution components importing services → `@evolution/services/...`
- Components importing formatters/urls → `@evolution/lib/utils/...`
- **Critical cross-boundary fix:** `evolutionActions.ts` has `await import('./contentQualityEval')` — a relative dynamic import to a file that stays in `src/lib/services/`. After the move, this must change to `await import('@/lib/services/contentQualityEval')`. TypeScript may not catch dynamic import path errors at compile time, so verify this manually.
- Integration tests for evolution-actions, evolution-visualization, and strategy-experiment also need import rewrites in this phase (they import from services/experiments that move here)

**Verification:** `npm run lint && npx tsc --noEmit && npm run test && npm run test:integration && npm run build`

### Phase 4: Move Test Helpers

```
git mv src/testing/utils/evolution-test-helpers.ts evolution/src/testing/
git mv src/testing/fixtures/executionDetailFixtures.ts evolution/src/testing/
```

**Import rewrites (two groups):**
- ~10 colocated unit tests already in `evolution/src/lib/` (moved in Phase 1): change `@/testing/utils/evolution-test-helpers` → `@evolution/testing/evolution-test-helpers`
- ~9 integration tests in `src/__tests__/integration/`: change `@/testing/utils/evolution-test-helpers` → `@evolution/testing/evolution-test-helpers`
- `@/testing/utils/integration-helpers` imports in integration tests do NOT change (stays in `src/`)

**Verification:** `npm run lint && npx tsc --noEmit && npm run test && npm run test:integration`

### Phase 5: Move Docs and Scripts

```
git mv docs/evolution/ evolution/docs/
git mv docs/sample_evolution_content/ evolution/docs/sample_content/
```

Move evolution scripts (identify and move individually):
```
git mv scripts/evolution-runner.ts evolution/scripts/
git mv scripts/run-evolution-local.ts evolution/scripts/
git mv scripts/hall-of-fame-generate.ts evolution/scripts/
git mv scripts/hall-of-fame-compare.ts evolution/scripts/
git mv scripts/prompt-bank-seed.ts evolution/scripts/
(... remaining evolution scripts)
git mv scripts/lib/hallOfFameUtils.ts evolution/scripts/lib/
git mv scripts/lib/oneshotGenerator.ts evolution/scripts/lib/
git mv scripts/lib/bankUtils.ts evolution/scripts/lib/
```

**Import rewrites for scripts:** Scripts move from `scripts/` to `evolution/scripts/`, changing the relative path depth by one level:
- Evolution-internal: `../src/lib/evolution/...` → `../src/lib/...` (same depth, evolution/ prefix absorbed)
- Shared infra: `../src/config/llmPricing` → `../../src/config/llmPricing` (one extra `../` to escape `evolution/`)
- Shared infra: `../src/lib/services/llms` → `../../src/lib/services/llms`
- Shared infra: `../src/lib/schemas/schemas` → `../../src/lib/schemas/schemas`

Note: Scripts run via `npx tsx` which does NOT resolve tsconfig path aliases. All script imports must use relative paths, not `@/` or `@evolution/` aliases. Run each script with `--help` or `--dry-run` after path updates to verify.

**Doc link fixes:**
- `docs/docs_overall/architecture.md` link `../evolution/README.md` → `../../evolution/docs/README.md`
- Internal evolution doc links use relative paths and move together — no rewrites.

**Verification:** `npm run lint && npx tsc --noEmit && npm run build`

### Phase 6: Cleanup and Verify

1. Remove empty directories left behind: `rmdir src/lib/evolution/ src/components/evolution/ src/lib/experiments/evolution/` (git mv leaves empty dirs; `rmdir` fails safely if not empty)
2. Barrel export `evolution/src/lib/index.ts`: internal relative paths remain valid since all files moved together. No changes needed now — clean up or remove in a follow-up PR.
3. Jest mocks for `d3`, `d3-dag`, `openskill`: **leave in root `jest.config.js`**. They are harmless no-op mocks that don't affect non-evolution tests. Removing them requires a local jest config override in `evolution/` which adds complexity for no benefit.
4. **Boundary enforcement**: Add ESLint `no-restricted-imports` rule to prevent evolution code from importing `@/components/*` or `@/actions/*` (only `@/lib/services/*` and `@/lib/utils/*` are allowed cross-boundary imports). This makes the separation enforceable, not just conventional.
5. **Dynamic import audit**: Run `grep -r "await import(" evolution/ --include='*.ts'` and verify every dynamic import path resolves to an existing file.
6. **Coverage check**: Run `npm run test -- --coverage` and confirm evolution files appear in the coverage report under `evolution/src/`.
7. **GitHub workflow check**: Verify `.github/workflows/evolution-batch.yml` does not reference any moved paths (e.g., `src/lib/evolution/`). Update if necessary.
8. Run full verification (matches CI pipeline):
   ```
   npm run lint
   npx tsc --noEmit
   npm run build
   npm run test
   npm run test:esm
   npm run test:integration
   npm run test:e2e:critical
   ```

## Testing

### Automated Verification (each phase)
- `npm run lint` — no import resolution errors
- `npx tsc --noEmit` — TypeScript compilation passes
- `npm run build` — Next.js production build succeeds
- `npm run test` — all ~3,900 unit tests pass
- `npm run test:integration` — all integration suites pass
- `grep -r "await import(" evolution/ --include='*.ts'` — audit dynamic imports resolve correctly

### Final Verification (Phase 6)
- `npm run test:esm` — ESM test passes (part of CI pipeline)
- `npm run test:e2e:critical` — E2E tests pass (admin pages still render, cron routes still respond)
- `npm run test -- --coverage` — verify `evolution/src/` files appear in coverage report
- Manual: open `/admin/quality/evolution` in browser, verify page loads
- Manual: open `/admin/evolution-dashboard`, verify page loads
- `git diff --stat main` — review total files moved vs modified

### What Should NOT Break
- Zero user-facing pages depend on evolution — no user-visible risk
- The `@/` alias for main app code is unchanged
- Shared infra modules are not moved
- Supabase migrations are not touched
- CI workflows are not modified (except possibly cache keys)

## Documentation Updates

The following docs need path reference updates after the move:

**Evolution docs (moving to `evolution/docs/`):**
- `evolution/docs/architecture.md` — Key files section, all paths
- `evolution/docs/reference.md` — Key files section with all file paths
- `evolution/docs/data_model.md` — Key files and server actions paths
- `evolution/docs/agents/overview.md` — Agent file references
- `evolution/docs/README.md` — Code layout section
- `evolution/docs/visualization.md` — Key files section
- `evolution/docs/agents/generation.md` — Key files section
- `evolution/docs/agents/editing.md` — Key files section
- `evolution/docs/agents/tree_search.md` — Key files section

**Main app docs:**
- `docs/docs_overall/architecture.md` — Update link to evolution docs, update directory structure appendix
- `docs/docs_overall/getting_started.md` — Update evolution doc link if present
- `docs/docs_overall/instructions_for_updating.md` — Add note about evolution docs location

## Rollback Plan

Each phase is a separate commit. If any phase fails verification:

1. `git reset --hard HEAD~1` — undo the last commit (the failing phase)
2. All previous phases remain intact and working
3. Investigate the failure, fix, and re-attempt the phase

If the entire reorganization needs to be abandoned after multiple phases:

1. `git reset --hard` to the pre-Phase-0 commit
2. All config and file changes are reverted atomically
3. The branch can be deleted with zero impact on main

The phased approach ensures there is never a "half-migrated" state that can't be cleanly reverted.

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Turbopack alias bug on Next.js 15.2.8 | Preemptively add `turbopack.resolveAlias` in Phase 0 + verify with temp file test before moving real files |
| Missed import rewrite | TypeScript will catch it — `tsc --noEmit` fails on unresolved imports |
| Git blame lost on moved files | `git mv` preserves history; use `git log --follow` to trace |
| Large PR noise from file moves | Phase commits separately so reviewers can see moves vs. rewrites |
| Scripts break (relative paths) | Run each script with `--help` or dry-run after path updates |
| Integration tests break silently | Every phase runs `npm run test:integration` (not just unit tests) |
| `llms.ts` behavioral coupling | Deferred cleanup — the `call_source.startsWith('evolution_')` semaphore branch stays in shared code. Works as-is but is a future refactoring target |
| Sentry source map paths change | Stack traces will show `evolution/src/lib/` instead of `src/lib/evolution/`. Old Sentry errors won't match new paths — cosmetic but may confuse debugging during transition |

## Migration Scope Summary

| Category | Files | Import Rewrites |
|----------|-------|-----------------|
| Evolution lib | 119 | ~0 internal (relative), ~30 external |
| Evolution components | 52 | ~0 internal, ~23 external |
| Evolution services (excl. contentQuality*) | 13 | ~24 external |
| Evolution config/experiments | 5 | ~5 |
| Test helpers/fixtures | 3 | ~19 |
| Scripts | ~19 | ~21 |
| Docs | ~17 | ~3 link fixes |
| Config files | 6 modified | — |
| **Total** | **~234 moved** | **~195 import rewrites** |

**Files that stay in `src/`:** contentQualityActions.ts, contentQualityEval.ts, contentQualityCompare.ts, contentQualityCriteria.ts (shared infra), llmSemaphore.ts (imported by shared llms.ts).

The 468 internal relative imports within `evolution/src/lib/` require zero changes.

## Execution Guidance

Each phase should start with a **grep audit** to find all imports that need rewriting, rather than relying on the estimated counts above. The counts are approximate guides, not exhaustive lists.

### Pre-Phase Audit Commands

Run these before each phase to generate the exact list of imports to rewrite:

```bash
# Phase 1: Find all imports from @/lib/evolution (the lib being moved)
grep -r "from '@/lib/evolution" src/ --include='*.ts' --include='*.tsx' -l
grep -r "import('@/lib/evolution" src/ --include='*.ts' --include='*.tsx' -l

# Phase 2: Find all imports from @/components/evolution
grep -r "from '@/components/evolution" src/ --include='*.ts' --include='*.tsx' -l

# Phase 3: Find all imports of services being moved
grep -r "from '@/lib/services/evolution" src/ --include='*.ts' --include='*.tsx' -l
grep -r "from '@/lib/services/promptRegistry" src/ --include='*.ts' --include='*.tsx' -l
# (repeat for each service file being moved)
# Also check for dynamic imports crossing the boundary:
grep -r "import('./" evolution/src/services/ --include='*.ts' -l

# Phase 4: Find all imports of test helpers being moved
grep -r "evolution-test-helpers\|executionDetailFixtures" src/ --include='*.ts' --include='*.tsx' -l

# Phase 5: Find all evolution-related script imports
grep -r "import\|require" scripts/ --include='*.ts' | grep -i evolution
```

### Post-Phase Verification

After each phase, the `tsc --noEmit` step catches all static import failures. For **dynamic imports** (which TypeScript may not validate), also run:

```bash
grep -r "await import(" evolution/ --include='*.ts' | grep -v node_modules
```

Verify each dynamic import path resolves to an existing file.

### Barrel Export Decision

The barrel export at `evolution/src/lib/index.ts` contains re-exports with internal relative paths. Since all internal files move together, the relative paths remain valid. The barrel itself needs no changes during migration. It can be cleaned up or removed in a follow-up PR since it has no external consumers (all imports use deep paths).
