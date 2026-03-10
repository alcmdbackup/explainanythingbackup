# Progress: Eliminate Collapsible Pattern Evolution UI

## Completed Phases

### Phase 1: Remove collapsible from Prompts list ✅
- Removed expandedPromptId state, togglePromptRuns, expanded row rendering
- Rows now link to detail pages via `<Link>`
- Created `prompts/page.test.tsx`

### Phase 2: Remove collapsible from Experiments list ✅
- Removed expanded/detail/detailLoading state, loadDetail, chevron toggle, expanded content
- Updated ExperimentHistory.test.tsx

### Phase 3: Create Arena entry detail page + remove collapsible ✅
- Created `arena/entries/[entryId]/page.tsx` with EntityDetailHeader, MetricGrid, tabs
- Removed expandedId state, EntryDetail component from topic page
- Rows link to entry detail pages
- Created `arena/entries/[entryId]/page.test.tsx`

### Phase 4: Add rename capability ✅
- Added `renameExperimentAction` to experimentActions.ts
- Extended EntityDetailHeader with `onRename` prop (pencil icon, inline edit)
- Wired rename on ExperimentDetailContent and prompt detail page
- Tests for all new functionality

### Phase 5: Add source columns to Runs list ✅
- Extended EvolutionRun with experiment_name/strategy_name
- Post-fetch enrichment with batch lookups and empty array guards
- Added Experiment/Strategy columns as links
- Updated runs page test

### Phase 6: Add source columns to Invocations list ✅
- Extended InvocationListEntry with experiment_name/strategy_name
- Post-fetch enrichment via runs → experiments/strategies
- Added columns to invocations page
- Updated test

### Phase 7: Add source columns to Variants list ✅
- Extended VariantListEntry with strategy_name
- Post-fetch enrichment via runs → strategies
- Added Strategy column to variants page
- Updated test

## Verification
- All unit tests pass
- TypeScript compilation passes
- ESLint passes on modified files
- Next.js build compiles successfully
