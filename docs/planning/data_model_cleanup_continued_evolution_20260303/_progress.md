# Data Model Cleanup Continued Evolution — Progress

## Phase 1: Data Model — Experiment→Prompt FK ✅
- [x] Migration: `20260304000001_experiment_prompt_fk.sql`
- [x] Update experimentActions.ts (promptIds→promptId, single prompt model)
- [x] Update experiment-driver/route.ts (prompts→prompt_id)
- [x] Update ExperimentForm.tsx (radio instead of multi-select)
- [x] Update ExperimentOverviewCard.tsx (prompt link via buildArenaTopicUrl)
- [x] Update all tests (experimentActions, route, overview, form, detail tabs, analysis, e2e)

## Phase 2: Strategy Detail Page ✅
- [x] `buildStrategyUrl` in evolutionUrls.ts
- [x] Strategy detail page at `/admin/quality/strategies/[strategyId]/page.tsx`
- [x] Link strategy names on strategies list page
- [x] "Open full detail →" link in optimization StrategyDetail modal
- [x] Tests for new URL builders (buildExperimentUrl, buildArenaTopicUrl, buildPromptUrl, buildStrategyUrl)

## Phase 3: Cross-Linking All Detail Pages ✅
- [x] Run detail: strategy link uses `buildStrategyUrl(id)`, prompt/experiment links added, article link removed
- [x] RunsTab: strategy column added with `buildStrategyUrl` links
- [x] Variant detail: breadcrumb uses `buildExplanationUrl` instead of `buildArticleUrl`
- [x] VariantOverviewCard: "Article History" → "Explanation" link
- [x] Arena topic: hardcoded run URLs → `buildRunUrl`, `<a>` → `<Link>`, removed `buildArticleUrl`
- [x] RunsTable: removed `buildArticleUrl` reference
- [x] Prompts list page: "Arena →" link per prompt
- [x] `experiment_id` added to `EvolutionRun` type
- [x] VariantOverviewCard test updated

## Phase 4: Delete Article Detail Page ✅
- [x] Deleted 14 files (2 page files, 2 service files, 8 component+test files, 1 doc file)
- [x] Removed `buildArticleUrl` from evolutionUrls.ts and test
- [x] Removed all inbound references (RunsTable, VariantOverviewCard, variant detail, arena topic)
- [x] E2E test updated: removed article-specific tests, updated variant tests

## Phase 5: Documentation + Final Column Drop ✅
- [x] Migration: `20260304000002_drop_prompts_deprecated.sql`
- [x] entity_diagram.md: strategy now has dedicated page
- [x] data_model_diagram.md: `prompts TEXT[]` → `prompt_id UUID FK`
- [x] data_model.md: added migration entries 20/21
- [x] reference.md: removed articleDetailActions, updated URL builders list, updated e2e test description
