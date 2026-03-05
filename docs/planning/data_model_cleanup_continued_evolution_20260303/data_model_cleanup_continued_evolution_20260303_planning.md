# Data Model Cleanup Continued Evolution Plan

## Background
Continuation of evolution data model improvements, focusing on generating a clean data model diagram, ensuring every key entity has a detail page, understanding relationships between entities, and making sure every detail page links to related entity detail views in the evolution admin dashboard.

## Requirements (from GH Issue #611)
1. Generate a clean diagram of the updated data model
2. Ensure every key entity has a "details" page that can be viewed
3. Understand relationships between entities
4. In the evolution admin dashboard, every "details" page for an entity (e.g. experiment) should link to detail views for related entities

## Problem
The evolution admin dashboard has grown organically with 12+ tables and 6+ detail pages, but cross-linking between entities is inconsistent. Strategy has no dedicated detail page despite being a first-class entity. The Experiment→Prompt relationship uses a loose `TEXT[]` instead of a proper FK. Several detail pages don't link to related entities (e.g., Experiment detail has zero outbound cross-links). The Article detail page is unnecessary and should be removed.

## Options Considered

### Strategy Detail Page
- **Option A: Dedicated route** `/admin/quality/strategies/[strategyId]/page.tsx` — proper detail page. Consistent with Run, Variant, Experiment patterns.
- **Option B: Deep-link on list page** — scroll + expand on existing list page. Simpler but inconsistent.
- **Selected: Option A** — consistency matters; `getStrategyDetailAction` already exists.

### Experiment→Prompt FK
- **Option A: Single `prompt_id UUID FK`** — each experiment targets one prompt. Simple, clean.
- **Option B: Junction table** — M:N relationship. More flexible but unnecessary per user decision.
- **Selected: Option A** — user confirmed 1:1 relationship. Existing multi-prompt experiments (if any) will be audited; multi-prompt support deprecated.

### Prompt Detail Page
- **Option A: Dedicated prompt detail page** — separate from Arena Topic.
- **Option B: Link Prompt page → Arena Topic detail** — since they share the same table, just link to existing `/admin/quality/arena/[topicId]`.
- **Selected: Option B** — no need for a duplicate page; `buildPromptUrl` aliases to `buildArenaTopicUrl`.

## Phased Execution Plan

### Phase 1: Data Model — Experiment→Prompt FK
**Goal**: Replace `evolution_experiments.prompts TEXT[]` with `prompt_id UUID FK`.

**Important context**: The `prompts TEXT[]` column stores **resolved prompt text strings** (not UUIDs). The `resolvePromptIds()` function in `experimentActions.ts` takes UUIDs as input and resolves them to text before INSERT. The `StartExperimentInput.promptIds` is `string[]` of UUIDs. So backfill needs to reverse-match text → arena topic ID.

#### Step 1: Pre-flight audit (run before writing migration)
```sql
-- Check how many experiments exist and their prompt counts
SELECT id, name, array_length(prompts, 1) as prompt_count, prompts[1] as first_prompt
FROM evolution_experiments;

-- Check for multi-prompt experiments
SELECT id, name, array_length(prompts, 1)
FROM evolution_experiments
WHERE array_length(prompts, 1) > 1;

-- Check for unmatchable prompts (text not in arena_topics)
SELECT e.id, e.prompts[1]
FROM evolution_experiments e
WHERE NOT EXISTS (
  SELECT 1 FROM evolution_arena_topics t
  WHERE LOWER(TRIM(t.prompt)) = LOWER(TRIM(e.prompts[1]))
  AND t.deleted_at IS NULL
);
```

#### Step 2: Migration `YYYYMMDD000001_experiment_prompt_fk.sql`

**Duplicate-safety note**: `evolution_arena_topics.prompt` has a UNIQUE index (`idx_arena_topics_prompt_unique`), so duplicate prompt text is not possible. The subquery below still uses `ORDER BY created_at ASC LIMIT 1` as a defensive measure.

```sql
-- Add prompt_id column (nullable initially)
ALTER TABLE evolution_experiments ADD COLUMN prompt_id UUID;

-- GUARD: abort if any multi-prompt experiments exist (data loss prevention)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evolution_experiments
    WHERE array_length(prompts, 1) > 1
  ) THEN
    RAISE EXCEPTION 'Multi-prompt experiments found. Manually audit and resolve before migrating. Run: SELECT id, name, array_length(prompts, 1) FROM evolution_experiments WHERE array_length(prompts, 1) > 1;';
  END IF;
END $$;

-- Backfill: reverse-match prompts[1] text to arena_topics.id
-- Uses subquery with deterministic tie-breaking (oldest topic first) for safety
UPDATE evolution_experiments e
SET prompt_id = (
  SELECT t.id FROM evolution_arena_topics t
  WHERE LOWER(TRIM(t.prompt)) = LOWER(TRIM(e.prompts[1]))
    AND t.deleted_at IS NULL
  ORDER BY t.created_at ASC
  LIMIT 1
);

-- GUARD: abort if any rows have NULL prompt_id after backfill
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evolution_experiments WHERE prompt_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: some experiments have no matching arena topic. Run pre-flight audit.';
  END IF;
END $$;

-- Add NOT NULL + FK constraint
ALTER TABLE evolution_experiments ALTER COLUMN prompt_id SET NOT NULL;
ALTER TABLE evolution_experiments
  ADD CONSTRAINT fk_experiment_prompt
  FOREIGN KEY (prompt_id) REFERENCES evolution_arena_topics(id);

-- Keep prompts column as deprecated for one release cycle
-- Will be dropped in Phase 5 after verifying everything works
ALTER TABLE evolution_experiments RENAME COLUMN prompts TO _prompts_deprecated;
COMMENT ON COLUMN evolution_experiments._prompts_deprecated IS 'Deprecated: use prompt_id FK instead. Will be dropped in follow-up migration.';

-- Force PostgREST schema cache refresh
NOTIFY pgrst, 'reload schema';
```

**Deployment ordering**: This migration renames `prompts` → `_prompts_deprecated`, which will break the existing `startExperimentAction` INSERT (writes `prompts: resolvedPrompts`). **Deploy code changes (Step 3) in the same release as the migration.** Supabase runs migrations before the app redeploys, so the code must already reference `prompt_id` in the commit that includes this migration. The deprecated column rename means old code will fail immediately — this is intentional to prevent dual-write confusion.

**Rollback plan**: If backfill fails, the migration aborts via RAISE EXCEPTION (Supabase runs each migration file as a single transaction). No data is modified. If the migration succeeds but code breaks, rename `_prompts_deprecated` back to `prompts` and drop `prompt_id`:
```sql
ALTER TABLE evolution_experiments RENAME COLUMN _prompts_deprecated TO prompts;
ALTER TABLE evolution_experiments DROP COLUMN prompt_id;
ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS fk_experiment_prompt;
NOTIFY pgrst, 'reload schema';
```

#### Step 3: Update experiment actions (`evolution/src/services/experimentActions.ts`)
- Change `StartExperimentInput.promptIds: string[]` → `promptId: string`
- Change `ValidateExperimentInput.promptIds: string[]` → `promptId: string`
- Update `resolvePromptIds()` → `resolvePromptId()` (single UUID → single text)
- Update `startExperimentAction`: INSERT with `prompt_id` instead of `prompts` (change line ~206 from `prompts: resolvedPrompts` to `prompt_id: input.promptId`)
- Update run creation loop: currently `for (const prompt of resolvedPrompts)` at ~line 241 — change to single prompt resolved from `resolvePromptId(input.promptId)`
- Update `getExperimentStatusAction` (~line 340): change `exp.prompts` read to join `evolution_arena_topics` on `prompt_id` to get title. Return `promptId` and `promptTitle`.
- Update `ExperimentStatus` type (~line 294): replace `prompts: string[]` with `promptId: string; promptTitle: string`
- Update `regenerateExperimentReportAction` (~line 516): currently does `SELECT *` on experiments, then passes `exp` to `buildExperimentReportPrompt`. After migration, `SELECT *` will return `_prompts_deprecated` (renamed) and `prompt_id`. The `buildExperimentReportPrompt` in `experimentReportPrompt.ts` does NOT access `exp.prompts` directly (confirmed — it uses structured fields). However, the SELECT should be updated to join `evolution_arena_topics` on `prompt_id` to get prompt text for the report, replacing the old `exp.prompts[0]` read. Update `experimentReportPrompt.test.ts` mock data accordingly.
- Update `getExperimentRunsAction` (~line 487): add `strategy_config_id` to the SELECT clause (currently selects `id, status, run_summary, total_cost_usd, config, created_at, completed_at`). Update `ExperimentRun` type to include `strategyConfigId: string | null`.

#### Step 3a: Update experiment-driver cron route
- `src/app/api/cron/experiment-driver/route.ts` — line 307 explicitly SELECTs `prompts` from `evolution_experiments`, and `ExperimentRow` interface (line 33) types it as `prompts: string[]`. **Must be updated in the same release as the migration:**
  - Change SELECT from `prompts` to `prompt_id`
  - Update `ExperimentRow` interface: replace `prompts: string[]` with `prompt_id: string`
  - Update any downstream usage of `exp.prompts` in the cron logic
- `src/app/api/cron/experiment-driver/route.test.ts` — line 94 mocks `prompts: ['Explain photosynthesis']`. Update mock to use `prompt_id: '<uuid>'`.

**Note on experimentValidation.ts** (`evolution/src/experiments/evolution/experimentValidation.ts`): This is the CLI-side validation layer, NOT the server action. It takes `prompts: string[]` (resolved text) for cost estimation. This function stays accepting an array of text strings since the CLI resolves prompts independently. The `estimateBatchCost()` and `validateExperimentConfig()` functions multiply cost by `prompts.length` — update to always pass a single-element array `[resolvedPromptText]`. The multi-prompt validations (`prompts.length > 10`, `prompts.length === 0`) can be simplified but are not blocking.

#### Step 4: Update experiment UI
- `ExperimentOverviewCard.tsx`: show prompt title with link to arena topic via `buildArenaTopicUrl`
- `ExperimentForm.tsx` (or creation dialog): use prompt selector (dropdown of arena topics) instead of multi-select

#### Step 5: Update experiment CLI (`scripts/run-strategy-experiment.ts`)
- Note: This script does NOT use `experimentActions.ts` — it uses local JSON state files and `factorial.ts`/`analysis.ts`. The `--prompt` flag provides raw text.
- Update to resolve prompt text → arena topic ID at start, store ID in local state

#### Tests to update
- `evolution/src/services/experimentActions.test.ts` — 17+ tests using `promptIds: string[]`, update to `promptId: string`. Update `validInput()`, `validStartInput()`, `setupSupabaseMock()` helpers.
- `evolution/src/experiments/evolution/experimentValidation.test.ts` (NOTE: NOT in `services/`) — tests with arrays of prompt strings (e.g., `SAMPLE_PROMPTS = ['Explain photosynthesis', 'Explain gravity']`). Update multi-prompt tests to single-prompt. Tests like "rejects more than 10 prompts" and "scales linearly with number of prompts" should be updated to validate single-prompt behavior. The `estimateBatchCostDetailed()` and `validateExperimentConfig()` functions in `experimentValidation.ts` keep their `prompts: string[]` signature (CLI layer) but tests should pass `[singlePrompt]`.
- `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` — **structural seed change required** (currently `describe.skip`):
  - The seed function `seedExperimentData()` at line 53 inserts `prompts: ['Explain photosynthesis']` directly
  - After migration, `prompts` column no longer exists — seed must insert `prompt_id: UUID`
  - Seed must first create an `evolution_arena_topics` row and use its ID as `prompt_id`
  - Add to `seedExperimentData()`: INSERT into `evolution_arena_topics` with `{prompt: 'Explain photosynthesis', ...}`, then use returned `id` as `prompt_id` in the experiment INSERT
  - Update `SeededExperiment` interface to include `arenaTopicId: string`

### Phase 2: Strategy Detail Page
**Goal**: Create dedicated strategy detail page at `/admin/quality/strategies/[strategyId]/page.tsx`.

#### Step 1: Add URL builder to `evolution/src/lib/utils/evolutionUrls.ts`
```typescript
export function buildStrategyUrl(strategyId: string): string {
  return `/admin/quality/strategies/${strategyId}`;
}
```

#### Step 2: Create page `src/app/admin/quality/strategies/[strategyId]/page.tsx`
- Server component (matching experiment detail pattern)
- Fetch via `getStrategyDetailAction` from `strategyRegistryActions.ts`
- Breadcrumb: Strategies > [Strategy Name]
- Overview card: name, label, config hash, created_by, status, pipeline_type
- Config display: move `StrategyConfigDisplay` from `src/app/admin/quality/optimization/_components/` to `evolution/src/components/evolution/` for shared access. Update imports in: `StrategyDetail.tsx`, `StrategyLeaderboard.tsx`, and `StrategyConfigDisplay.test.tsx` (all in `src/app/admin/quality/optimization/_components/`)
- Stats: run_count, avg_final_elo, avg_elo_per_dollar, best/worst elo, stddev_final_elo
- Runs table: use `getStrategyRunsAction` from `eloBudgetActions.ts` (already exists there, NOT in strategyRegistryActions). Each run links to Run Detail via `buildRunUrl`.

#### Step 3: Update strategy list page (`src/app/admin/quality/strategies/page.tsx`)
- Link strategy names to detail page via `buildStrategyUrl`

#### Step 4: Update optimization `StrategyDetail` modal (`src/app/admin/quality/optimization/_components/StrategyDetail.tsx`)
- Add "Open full detail →" link using `buildStrategyUrl`

#### Tests
- `evolution/src/lib/utils/evolutionUrls.test.ts` — add test for `buildStrategyUrl`
- New unit test for strategy detail page rendering (colocated or in `__tests__/`)
- Build verification: `npm run lint && npx tsc --noEmit && npm run build`

### Phase 3: Cross-Linking All Detail Pages
**Goal**: Add all missing URL builders and wire up cross-links across every detail page.

#### Step 1: Add URL builders to `evolution/src/lib/utils/evolutionUrls.ts`
```typescript
export function buildArenaTopicUrl(topicId: string): string {
  return `/admin/quality/arena/${topicId}`;
}
/** Alias: prompts and arena topics share the same table. */
export const buildPromptUrl = buildArenaTopicUrl;
```

#### Step 2: Run Detail Page (`src/app/admin/quality/evolution/run/[runId]/page.tsx`)
- **Data availability**: `getEvolutionRunByIdAction` uses `SELECT *` and the `EvolutionRun` type (in `evolutionActions.ts:17-34`) includes `prompt_id` and `strategy_config_id` but does NOT include `experiment_id`. **Add `experiment_id: string | null` to the `EvolutionRun` interface** to expose it via TypeScript. The DB column exists (populated by experiment runs), but the type currently strips it during `data as EvolutionRun` cast.
- **Display text**: Run detail page needs prompt/strategy names for link labels. Two options:
  - **Option A (preferred)**: Add joins in `getEvolutionRunByIdAction` to return `prompt_title` (from `evolution_arena_topics`) and `strategy_label` (from `evolution_strategy_configs`). Update `EvolutionRun` type.
  - **Option B**: Make separate fetches in the page component.
- Add/update links:
  - Strategy → **replace** existing list-page link (`href='/admin/quality/strategies'` at ~line 210) with `buildStrategyUrl(strategyConfigId)` using `strategy_label` as link text
  - Prompt/Topic → `buildArenaTopicUrl(promptId)` with `prompt_title` as link text (new)
  - Experiment → `buildExperimentUrl(experimentId)` if `experiment_id` is set (new)

#### Step 3: Experiment Detail Page
- `ExperimentOverviewCard.tsx` (`src/app/admin/quality/optimization/experiment/[experimentId]/`): add prompt link via `buildArenaTopicUrl(promptId)` (available from Phase 1)
- `RunsTab.tsx`: add strategy link per run row via `buildStrategyUrl` (requires updating `ExperimentRun` type in `experimentActions.ts` to include `strategyConfigId`)

#### Step 4: Variant Detail Page (`src/app/admin/quality/evolution/variant/[variantId]/page.tsx`)
- Remove Article History link (page being deleted in Phase 4)
- Update breadcrumb: currently uses `buildArticleUrl` for the article name segment between "Evolution" and "Run". Replace with `buildExplanationUrl` or remove the article breadcrumb segment entirely (link directly to evolution list → run).

#### Step 5: Arena Topic Detail (`src/app/admin/quality/arena/[topicId]/page.tsx`)
- For evolution entries: add link to source Variant via `buildVariantDetailUrl(evolution_variant_id)` (if set)
- For evolution entries: add link to source Run via `buildRunUrl(evolution_run_id)` (if set)

#### Step 6: Prompt list page (`src/app/admin/quality/prompts/page.tsx`)
- Add "View Arena →" link per prompt → `buildArenaTopicUrl(id)`

#### Tests
- `evolution/src/lib/utils/evolutionUrls.test.ts` — add tests for `buildArenaTopicUrl`, `buildPromptUrl`
- Build verification after all changes
- Manual: navigate every cross-link in the admin dashboard

### Phase 4: Delete Article Detail Page
**Goal**: Remove the Article detail page and all supporting code.

#### Files to delete
- `src/app/admin/quality/evolution/article/[explanationId]/page.tsx`
- `src/app/admin/quality/evolution/article/[explanationId]/ArticleDetailTabs.tsx`
- `evolution/src/services/articleDetailActions.ts`
- `evolution/src/services/articleDetailActions.test.ts`
- `evolution/src/components/evolution/article/ArticleOverviewCard.tsx`
- `evolution/src/components/evolution/article/ArticleOverviewCard.test.tsx`
- `evolution/src/components/evolution/article/ArticleAgentAttribution.tsx`
- `evolution/src/components/evolution/article/ArticleAgentAttribution.test.tsx`
- `evolution/src/components/evolution/article/ArticleRunsTimeline.tsx`
- `evolution/src/components/evolution/article/ArticleRunsTimeline.test.tsx`
- `evolution/src/components/evolution/article/ArticleVariantsList.tsx`
- `evolution/src/components/evolution/article/ArticleVariantsList.test.tsx`
- `docs/feature_deep_dives/article_detail_view.md`

#### Files to edit (remove inbound references)
- `evolution/src/lib/utils/evolutionUrls.ts` — remove `buildArticleUrl`
- `evolution/src/lib/utils/evolutionUrls.test.ts` — remove `buildArticleUrl` test
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — remove "Article History" link
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — remove "Article History" link
- `evolution/src/components/evolution/variant/VariantOverviewCard.tsx` — remove article link
- `evolution/src/components/evolution/RunsTable.tsx` — remove article link
- `src/app/admin/quality/arena/[topicId]/page.tsx` — remove article history links
- `evolution/docs/evolution/reference.md` — remove articleDetailActions from key files
- `evolution/docs/evolution/visualization.md` — remove article detail references

#### E2E tests to update
- `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts`:
  - Remove/rewrite 2 @critical tests that navigate to Article detail page
  - Remove test: "breadcrumb navigates from variant to article to evolution"
  - Remove test: "Article History" link click assertions
  - Keep variant detail tests intact

#### Tests
- `npm run lint && npx tsc --noEmit && npm run build` — verify no broken imports
- Run unit tests: `npm test -- --testPathPattern="evolution"` to catch any remaining references
- Run E2E: verify admin-article-variant-detail.spec.ts still passes for variant-only tests

### Phase 5: Documentation + Diagram + Final Column Drop
**Goal**: Update all relevant evolution docs and drop deprecated column.

#### Step 1: Drop deprecated column (follow-up migration)
**WARNING: One-way migration — data is permanently lost once dropped. Only run after verifying ALL code paths use `prompt_id` FK exclusively.**
```sql
-- YYYYMMDD000002_drop_deprecated_prompts.sql
ALTER TABLE evolution_experiments DROP COLUMN _prompts_deprecated;
NOTIFY pgrst, 'reload schema';
```

#### Step 2: Update `evolution/docs/evolution/entity_diagram.md`
- Already created with Mermaid diagram + PNG
- Update to reflect final state (prompt_id FK on experiments)

#### Step 3: Update `evolution/docs/evolution/data_model.md`
- Add Experiment→Prompt FK (1:1 via `prompt_id`) to relationships section
- Add Strategy detail page to key files
- Remove Article detail page references
- Update migration list with new migrations

#### Step 4: Update `evolution/docs/evolution/reference.md`
- Add strategy detail page to key files
- Update experiment schema: `prompt_id UUID FK` replaces `prompts TEXT[]`
- Remove `articleDetailActions` from key files list
- Add new URL builders to key files

#### Step 5: Update `evolution/docs/evolution/arena.md`
- Add cross-link references for arena entries to variant/run detail

#### Step 6: Update `evolution/docs/evolution/architecture.md`
- Remove article detail page references from data flow section

## Testing
- **Unit tests** (specific files):
  - `evolution/src/services/experimentActions.test.ts` — update for single prompt_id. Also update `getExperimentStatusAction` test (~line 393) mock from `prompts: ['p1']` to `prompt_id: '<uuid>'` and assertion for `promptId`/`promptTitle`.
  - `evolution/src/experiments/evolution/experimentValidation.test.ts` — CLI validation layer keeps `prompts: string[]` signature. Existing tests remain valid since the function interface doesn't change. Only update tests if the function signature changes.
  - `evolution/src/lib/utils/evolutionUrls.test.ts` — add new builders (`buildStrategyUrl`, `buildArenaTopicUrl`, `buildPromptUrl`), remove `buildArticleUrl`
  - `evolution/src/services/experimentReportPrompt.test.ts` — update mock data if report prompt builder changes
  - Experiment detail component tests (update `ExperimentStatus` mock from `prompts: [...]` to `promptId`/`promptTitle`):
    - `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.test.tsx` (line 23: `prompts: ['test prompt']`)
    - `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.test.tsx` (line 15: `prompts: []`)
    - `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.test.tsx` (line 21: `prompts: []`)
  - `src/app/api/cron/experiment-driver/route.test.ts` — update mock from `prompts: [...]` to `prompt_id: '<uuid>'`
  - New: strategy detail page unit test at `src/app/admin/quality/strategies/[strategyId]/__tests__/page.test.tsx`
- **Integration tests**:
  - `src/__tests__/integration/evolution-actions.integration.test.ts` — this file only has run-queue tests (`queueEvolutionRunAction`), NOT experiment tests. No experiment-creation integration test exists. Add a new test case for experiment creation with `prompt_id` (net-new, not an update).
- **E2E tests**:
  - `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts` — remove article page tests, keep variant tests. Update variant breadcrumb test to not reference article page.
  - `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` — structural seed data change (create arena_topic row, use its ID as `prompt_id`). Currently `describe.skip` — keep skipped but fix the schema.
- **Build verification**: `npm run lint && npx tsc --noEmit && npm run build` after each phase
- **Full test suite**: Run `npm test` after each phase to catch import breakages from deleted/moved files
- **Manual**: Navigate all cross-links in admin dashboard to verify resolution

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` — update entity relationships, migration list, remove article detail refs
- `evolution/docs/evolution/architecture.md` — minor: update article detail page references in data flow
- `evolution/docs/evolution/arena.md` — add cross-link references for arena entries
- `evolution/docs/evolution/reference.md` — update key files, experiment schema, remove article detail actions
- `evolution/docs/evolution/entity_diagram.md` — update diagram with final FK state
- `docs/feature_deep_dives/article_detail_view.md` — DELETE (article detail page removed)
