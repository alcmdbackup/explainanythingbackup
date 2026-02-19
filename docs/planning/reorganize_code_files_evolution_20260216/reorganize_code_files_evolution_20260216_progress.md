# Reorganize Code Files Evolution Progress

## Phase 0: Config Preparation
### Work Done
- Modified 6 config files: `tsconfig.json`, `jest.config.js`, `jest.integration.config.js`, `tailwind.config.ts`, `eslint.config.mjs`, `next.config.ts`
- Added `@evolution/*` → `./evolution/src/*` path alias in tsconfig and Jest
- Added Turbopack resolveAlias workaround in next.config.ts
- Extended Tailwind content scan and ESLint design-system rule to cover `evolution/src/`
- Created `evolution/src/lib/` directory structure

### Verification
- tsc clean, 4797 tests pass, build succeeds
- Commit: `518b5b8d`

## Phase 1: Move Core Evolution Library
### Work Done
- `git mv src/lib/evolution/ evolution/src/lib/`
- Rewrote ~35 files: `@/lib/evolution/` → `@evolution/lib/`
- Fixed cross-boundary imports: `configValidation.test.ts`, `diffComparison.ts`, `factorial.ts`, `eloBudgetActions.ts`
- Fixed script relative paths (6 scripts)

### Issues Encountered
- `src/lib/experiments/evolution/factorial.ts` had relative imports `../../evolution/core/pipeline` that broke. Converted to `@evolution/lib/core/pipeline`.
- `evolution/src/lib/core/pipeline.ts` kept `../../../../instrumentation` relative import (still resolves correctly 4 levels up).

### Verification
- tsc clean, 4797 tests pass, build succeeds
- Commit: `9e5d1780`

## Phase 2: Move Evolution Components
### Work Done
- `git mv src/components/evolution/ evolution/src/components/`
- Rewrote component imports in both `evolution/` and `src/` files
- Fixed barrel imports (`@evolution/components/evolution` vs deep imports)

### Issues Encountered
- sed initially stripped the `evolution/` subdirectory from paths. Used two-step approach: add `evolution/` everywhere, then deduplicate `evolution/evolution/`.
- Barrel import at `@evolution/components/evolution` (barrel index) needed separate handling from deep imports.

### Verification
- tsc clean, 4797 tests pass, build succeeds
- Commit: `a14caa7c`

## Phase 3-5: Move Services, Config, Experiments, Test Helpers, Docs, Scripts
### Work Done
- **Phase 3**: Moved 20 service files, `promptBankConfig.ts`, `experiments/evolution/`, `evolutionUrls.ts`, `formatters.ts`
- **Phase 4**: Moved `evolution-test-helpers.ts`, `executionDetailFixtures.ts`
- **Phase 5**: Moved `docs/evolution/`, `docs/sample_evolution_content/`, 22 script files

Import rewrites done by 4 parallel agents:
1. Admin page imports (18 files)
2. Evolution internal imports (18 files, incl. cross-boundary fix for `contentQualityEval`)
3. Integration test imports (2 files)
4. Script relative path fixes (6 files)

Additional manual fixes:
- Moved orphaned `evolutionUrls.test.ts`, `promptBankConfig.test.ts`, `formatters.test.ts` to `evolution/`
- Fixed `runTriggerContract.test.ts` import
- Fixed `strategy-experiment.integration.test.ts` import (missing `evolution/` subdirectory)
- Fixed `scripts/generate-article.ts` and `scripts/run-strategy-experiment.ts` relative paths

### Verification
- tsc clean, 4797 tests pass, build succeeds
- Commit: `9797e456`

## Phase 6: Cleanup and Verify
### Work Done
- Removed empty directories (already cleaned by git)
- Added ESLint `no-restricted-imports` boundary enforcement rule (evolution/ cannot import `@/components/*`, `@/app/*`, `@/actions/*`)
- Updated `.github/workflows/evolution-batch.yml` script path: `scripts/evolution-runner.ts` → `evolution/scripts/evolution-runner.ts`
- Dynamic import audit: all `await import(...)` in `evolution/` resolve correctly
- Updated path references in evolution docs (via background agent)

### Full Verification Suite
| Check | Result |
|-------|--------|
| `npm run lint` | Pass (only pre-existing design-system warnings) |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `npm run test` | 247 suites, 4797 tests, all pass |
| `npm run test:esm` | 156 tests, all pass |
| `npm run test:integration` | 28 suites, 245 tests, all pass |

## Summary

| Metric | Value |
|--------|-------|
| Files moved | ~120 |
| Import rewrites | ~160 |
| Total commits | 5 (one per phase, phases 3-5 combined) |
| Tests before | 4797 |
| Tests after | 4797 |
| New ESLint boundary rule | Yes |
| CI workflow updated | Yes |
