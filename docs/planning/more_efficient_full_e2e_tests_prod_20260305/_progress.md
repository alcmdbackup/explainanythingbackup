# More Efficient Full E2E Tests (Prod) — Progress

## Milestone 1: Fill Race + NetworkIdle — DONE
- Added blur() after 20 high-risk fill() calls across 8 spec files
- Replaced 6 networkidle with domcontentloaded + element waits in admin-experiment-detail and admin-arena

## Milestone 2: POM Wait Methods + Route Registration — DONE
- Added blur() after fill() in LoginPage, UserLibraryPage, ImportPage
- Added post-action waits to LoginPage, ResultsPage, UserLibraryPage, ImportPage, SearchPage
- Added waitForRouteReady in error-recovery.spec.ts

## Milestone 3: Admin Spec Robustness — DONE
- Added comments explaining controlled data for hardcoded row indices
- Added comments on exact count assertions
- Added error logging to cleanup functions in 8 admin specs
- Added comment on selectOption by index (dynamic entries)

## Milestone 4: Test Data Isolation + Fixture Hardening — DONE
- 4B: Switched tracked IDs to per-worker files (worker-N.txt pattern)
- 4C: Individual try/catch for each global teardown step
- 4D: Added tag upsert error check in global-setup
- 4E: trackExplanationForCleanup now throws on NaN
- 4A SKIPPED: Timestamp suffixes need per-spec cleanup refactoring

## Milestone 5: Integration Test Hygiene — DONE
- Changed silent `if (!tablesReady) return` to throw + sentinel test in 11 files
- Fixed manual-experiment silent skip (separate tablesReady from empty array)
- Relaxed timing: 10ms→100ms (logging), 5000ms→15000ms (tag-management)

## Milestone 6: CI Infrastructure — Evolution Split — DONE
- 6A: detect-changes outputs fast/evolution-only/non-evolution-only/full
- 6B: Tagged 7 evolution specs with @evolution (8 describe blocks total)
- 6C: Added 4 new package.json scripts
- 6D: Replaced e2e-full/integration-full with 4 split jobs
- 6D: Updated unit-tests if from `== 'full'` to `!= 'fast'`
- 6E: Added missing nightly env vars + admin seeding step

## Milestone 7: Low-Priority Cleanup — DONE
- Fixed `isProduction ? 2 : 2` dead code in playwright.config.ts
- Replaced deprecated waitForSelector in suggestions-test-helpers.ts
