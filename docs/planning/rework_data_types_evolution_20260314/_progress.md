# Rework Data Types Evolution Progress

## Phase 1: Create `evolution_explanations` table + migration

### Work Done

1. **Migration file** (`supabase/migrations/20260314000001_create_evolution_explanations.sql`):
   - CREATE TABLE `evolution_explanations` with id, explanation_id, prompt_id, title, content, source, created_at
   - ADD COLUMN `evolution_explanation_id UUID` (NULLABLE) on `evolution_runs`, `evolution_experiments`, `evolution_arena_entries`
   - Backfill: explanation-based runs from `explanations` table, prompt-based runs from checkpoint `originalText`
   - Backfill FKs on runs, experiments, arena entries
   - Verify NULL counts = 0, then SET NOT NULL on runs and experiments (arena entries left nullable for oneshot entries)
   - Indexes on all 3 FK columns

2. **evolutionRunnerCore.ts** — Updated prompt-based runner path to update the placeholder `evolution_explanation` with actual seed article content after `generateSeedArticle()`.

3. **experimentActions.ts** — `createManualExperimentAction` creates `evolution_explanation` from prompt before experiment insert. `addRunToExperimentAction` creates `evolution_explanation` from explanation content before run insert.

4. **evolutionActions.ts** — `queueEvolutionRunAction` creates `evolution_explanation` row before run insert (explanation-based: from explanations table content; prompt-based: placeholder from prompt text).

5. **Test helpers** (`evolution-test-helpers.ts`):
   - Added `createTestEvolutionExplanation()` factory
   - Updated `createTestEvolutionRun()` to auto-create `evolution_explanation` and write both `explanation_id` and `evolution_explanation_id`
   - Updated `cleanupEvolutionData()` to collect and delete `evolution_explanations` rows after runs
   - Added `assertEvolutionExplanationSync()` for dual-column consistency checks

6. **Unit test fixes** — Updated mocks in:
   - `evolutionActions.test.ts` — changed `insert.mock.calls[0]` → `[1]` for runs assertions (evo_explanation insert is now `[0]`)
   - `experimentActions.test.ts` — added `evolution_explanations` table mock to `createManualExperimentAction` test
   - `runTriggerContract.test.ts` — added `explanations`, `evolution_arena_topics`, `evolution_explanations` queue entries

7. **Integration tests** (`evolution-explanations.integration.test.ts`):
   - Table/column existence checks
   - Factory helper verification
   - Run creation with dual columns
   - Variant creation
   - Sync assertion for explanation-based runs
   - Cleanup verification

### Verification
- `npx tsc --noEmit` — clean (0 errors)
- `npx eslint` on all changed files — clean (0 errors)
- `npm run build` — clean build
- `npm test` — 298 suites, 5441 passed, 0 failed
