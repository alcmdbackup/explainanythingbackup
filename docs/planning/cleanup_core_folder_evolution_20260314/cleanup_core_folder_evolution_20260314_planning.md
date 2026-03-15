# Cleanup Core Folder Evolution Plan

## Background
The evolution pipeline's core folder (`evolution/src/lib/core/`) contains 30 non-test source files (plus 36 test files) totaling ~17,000 LOC. While well-structured with no dead exports, it has accumulated legacy backward-compatibility code, deprecated fields, duplicated constants, and vestigial checkpoint fields that add noise and maintenance burden. This project reorganizes the folder into logical subfolders and removes dead/legacy code.

## Requirements (from GH Issue #704)

1. Remove legacy `eloRatings` deserialization code path from `state.ts` (keep optional type field for visualization backward compat)
2. Stop producing `debatesAdded` in `DiffMetrics` (keep field optional on type for backward-compatible reads by visualization/UI code)
3. Remove `ordinal: 0` dummy field in `arenaIntegration.ts` (after verifying migration status)
4. Remove unused `persistAgentInvocation()` function from `pipelineUtilities.ts`
5. Stop writing vestigial fields in `serializeState()` (keep optional type fields for visualization code that reads old checkpoints)
6. Consolidate duplicated `SINGLE_ARTICLE_DISABLED` / `SINGLE_ARTICLE_EXCLUDED` into one source
7. Remove `eloToRating()` backward compat helper from `rating.ts`
8. Reorganize `core/` into logical subfolders for navigability

## Problem
The 30-file flat `core/` folder is hard to navigate — a developer must read each file to understand its role. Files span very different concerns (pure state, DB persistence, LLM calls, rating math, config validation) but sit side by side. Legacy backward-compat code for formats that are no longer in use adds confusion. Duplicated constants between files create maintenance risk.

## Options Considered

### Option A: Cleanup Only (no folder restructure)
- Remove items 1-7 only
- Pros: minimal diff, low risk
- Cons: folder stays flat and hard to navigate

### Option B: Subfolder Restructure + Cleanup (chosen)
- Do items 1-7 in PR #1 (low risk), then restructure in PR #2
- Pros: clear separation of concerns, easier onboarding, dependency direction becomes obvious, each PR is independently revertable
- Cons: larger total diff, many import path updates

### Option C: Full Refactor (supervisor elimination, etc.)
- In addition to B, inline the supervisor into pipeline
- Pros: fewer abstractions
- Cons: scope creep, supervisor has 24 dedicated tests, no functional improvement

**Decision: Option B** — split into two PRs for safety.

## Phased Execution Plan

### PR #1: Dead Code Removal + Constant Consolidation (items 1-7)

#### Phase 1: Safe Removals

**1a. Remove legacy `eloRatings` deserialization code path**
- `state.ts`: Remove the `else if (snapshot.eloRatings ...)` branch in `deserializeState()` (~7 lines)
- `rating.ts`: Remove `eloToRating()` function, its export, and the `eloToRating` import in `state.ts` (~5 lines)
- `types.ts`: **Keep** `eloRatings?: Record<string, number>` on `SerializedPipelineState` as optional — visualization code (`evolutionVisualizationActions.ts` `buildEloLookup`/`buildEloLookupWithSigma`, `variantDetailActions.ts`) reads this field from stored checkpoint JSONB for historical run display
- Update tests: Remove `backward compat: eloRatings deserialization` describe block in `state.test.ts` (~50 lines), remove `eloToRating` tests in `rating.test.ts`

**1b. Stop producing `debatesAdded` in DiffMetrics**
- `pipelineUtilities.ts`: Remove `debatesAdded: 0` line from `computeDiffMetricsFromActions()`
- `types.ts`: Make `debatesAdded` **optional** on `DiffMetrics` (change from required to `debatesAdded?: number`) — consumers that read it must handle undefined
- Update consumers (read-side, keep backward compat):
  - `evolutionVisualizationActions.ts` (~line 374, 484, 508): Use optional chaining `diffMetrics?.debatesAdded ?? 0`
  - `TimelineTab.tsx` (~lines 432-444): Guard with `?? 0` or remove the debates row from timeline display
  - `evolutionVisualizationActions.test.ts`: Update assertions to expect `debatesAdded` absent
- `backfill-diff-metrics.ts`: Remove `debatesAdded` from its local DiffMetrics definition and computation (~lines 48-52, 86)
- `pipelineUtilities.test.ts` (lines 241, 469): Remove `debatesAdded: 0` from expected DiffMetrics literals
- `InvocationDetailContent.test.tsx` (`src/app/admin/evolution/invocations/[invocationId]/`): Remove required `debatesAdded: 0` from DiffMetrics literal (line 52) — field is now optional
- Note: `pipeline.test.ts` has NO `debatesAdded` assertions (verified via grep) — no changes needed there for this item

**1c. Remove `ordinal: 0` dummy**
- **Pre-check**: Verify migration `20260312000001` (drops `ordinal` column and rewrites `sync_to_arena` RPC) has been applied in production. Query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'evolution_arena_elo' AND column_name = 'ordinal'`
  - If column exists → **skip this item** (migration not applied yet; deploy-order dependency)
  - If column does NOT exist → safe to remove `ordinal: 0` from `arenaIntegration.ts` `syncToArena()` eloRows mapping
- Update `arenaIntegration.test.ts` if test assertions reference `ordinal`

**1d. Remove unused `persistAgentInvocation()`**
- `pipelineUtilities.ts`: Remove the function (~lines 85-117, ~35 lines)
- Verify no imports outside tests: confirmed only imported in `pipeline.test.ts`
- `pipeline.test.ts` (~lines 1617-1692): Remove the `persistAgentInvocation` test describe block and any imports

**1e. Stop writing vestigial serialization fields**
- `state.ts` `serializeState()`: Remove these lines:
  - `similarityMatrix: null`
  - `debateTranscripts: []`
  - `treeSearchResults: null`
  - `treeSearchStates: null`
  - `sectionState: null`
- `types.ts` `SerializedPipelineState`: **Keep** all 5 fields as **optional** (`similarityMatrix?: ...` etc.) — visualization code (`evolutionVisualizationActions.ts`) actively reads `treeSearchStates` and `treeSearchResults` from stored checkpoint JSONB for tree search visualization. Old checkpoints in the DB still have these fields.
- `state.test.ts`: Update ALL serialization assertions that expect vestigial fields. Affected locations:
  - Lines 201-213: Dedicated `serializes debateTranscripts/treeSearchResults` assertions — remove these test blocks
  - Lines 228-231: Snapshot expectation with `similarityMatrix: null` / `debateTranscripts: []` — remove these fields from expected output
  - Lines 256-259: Same pattern in round-trip test — remove
  - Lines 446-449: Same pattern in `lastSyncedMatchIndex` test — remove
- `persistence.continuation.test.ts`: Verify mock snapshots still work (they already omit vestigial fields, so should be fine)

**Checkpoint**: Run `npm run test:unit -- --testPathPattern=evolution/src/lib/core` and `npm run tsc` — all pass.

#### Phase 2: Consolidate Duplicated Constants (item 6)

**2a. Single source for SINGLE_ARTICLE_DISABLED**
- Keep `SINGLE_ARTICLE_DISABLED` as `readonly AgentName[]` in `budgetRedistribution.ts` (canonical agent classification file)
- `supervisor.ts`: Remove local `SINGLE_ARTICLE_EXCLUDED` Set, import `SINGLE_ARTICLE_DISABLED` from `budgetRedistribution.ts`
- `supervisor.ts` `getActiveAgents()`: Change `SINGLE_ARTICLE_EXCLUDED.has(name)` to `SINGLE_ARTICLE_DISABLED.includes(name as AgentName)` (or create a Set from the import at module level: `const SINGLE_ARTICLE_SET = new Set(SINGLE_ARTICLE_DISABLED)`)

**Checkpoint**: Run core + supervisor tests — all pass. Commit PR #1.

---

### PR #2: Subfolder Restructure (item 8)

Separate PR to isolate risk. Pure file moves + import path updates — no logic changes.

#### Phase 3: Subfolder Restructure

**Target structure (30 source files + 36 test files):**
```
core/
├── state/                  — Pure state model (4 files + 4 test files)
│   ├── actions.ts + actions.test.ts
│   ├── reducer.ts + reducer.test.ts
│   ├── state.ts + state.test.ts
│   └── validation.ts + validation.test.ts
├── ranking/                — Rating math, pool, diversity (6 files + 6 test files)
│   ├── rating.ts + rating.test.ts
│   ├── pool.ts + pool.test.ts
│   ├── comparisonCache.ts + comparisonCache.test.ts
│   ├── reversalComparison.ts + reversalComparison.test.ts
│   ├── eloAttribution.ts + eloAttribution.test.ts
│   └── diversityTracker.ts + diversityTracker.test.ts
├── persistence/            — All DB reads/writes (4 files + 6 test files)
│   ├── persistence.ts + persistence.test.ts + persistence.continuation.test.ts
│   ├── pipelineUtilities.ts + pipelineUtilities.test.ts
│   ├── metricsWriter.ts + metricsWriter.test.ts
│   └── arenaIntegration.ts + arenaIntegration.test.ts + arena.test.ts
├── budget/                 — Cost tracking and estimation (2 files + 2 test files)
│   ├── costTracker.ts + costTracker.test.ts
│   └── costEstimator.ts + costEstimator.test.ts
├── config/                 — Strategy/agent configuration (4 files + 5 test files)
│   ├── strategyConfig.ts + strategyConfig.test.ts
│   ├── configValidation.ts + configValidation.test.ts
│   ├── budgetRedistribution.ts + budgetRedistribution.test.ts + agentSelection.test.ts
│   └── agentToggle.ts + agentToggle.test.ts
├── infra/                  — LLM client, logging, errors (5 files + 5 test files)
│   ├── llmClient.ts + llmClient.test.ts
│   ├── logger.ts + logger.test.ts
│   ├── errorClassification.ts + errorClassification.test.ts
│   ├── jsonParser.ts + jsonParser.test.ts
│   └── critiqueBatch.ts + critiqueBatch.test.ts
├── content/                — Text generation helpers (3 files + 3 test files)
│   ├── seedArticle.ts + seedArticle.test.ts
│   ├── textVariationFactory.ts + textVariationFactory.test.ts
│   └── formatValidationRules.ts + formatValidationRules.test.ts
├── pipeline.ts             — Orchestrator (stays at root)
│   + pipeline.test.ts + pipelineFlow.test.ts + pruning.test.ts
├── supervisor.ts           — Phase supervisor (stays at root)
│   + supervisor.test.ts
└── config.test.ts          — Config defaults test (stays at root)
```

**File count verification**: 30 source + 36 test = 66 .ts files in core/.

**Circular dependency fix**: Move `EVOLUTION_DEFAULT_MODEL` constant to a new `config/constants.ts` file (avoids bloating `strategyConfig.ts` and keeps the constant easily findable). Update imports in `llmClient.ts`, `costEstimator.ts`, and all other consumers.

**Steps:**
1. Create 7 subdirectories (`state/`, `ranking/`, `persistence/`, `budget/`, `config/`, `infra/`, `content/`)
2. Create `config/constants.ts` with `EVOLUTION_DEFAULT_MODEL` and `EVOLUTION_SYSTEM_USERID`
3. `git mv` each source + test file to its new location
4. Update all imports across the codebase. Scope of changes:
   - `evolution/src/lib/core/` internal cross-references (~50 import statements)
   - `evolution/src/lib/` parent folder files (index.ts, types imports)
   - `evolution/src/services/` (~15 files with core/ imports)
   - `evolution/src/components/evolution/` (~10 files)
   - `evolution/scripts/` (~5 files)
   - `src/` main app (~5 files with core/ imports)
   - Test files (~36 in core/ + ~15 agent test files outside)
   - **Total: ~136 files needing import path updates**
   - Use IDE refactoring or `sed` for bulk path rewrites, then verify with `tsc`
5. Update `evolution/src/lib/index.ts` barrel file (~40 re-export lines)
6. Do NOT add subfolder barrel `index.ts` files — use direct imports to preserve tree-shaking and keep import paths explicit
7. Verify jest config (`jest.config.ts` `moduleNameMapper`, `roots`, `testMatch`) handles the new subfolder paths. Jest's default `**/*.test.ts` glob should find co-located test files automatically.

**Checkpoint**: Run full suite — `npm run tsc`, `npm run lint`, `npm run test:unit`, `npm run build`.

#### Phase 4: Verification & Docs
- Run full CI checks: lint, tsc, build, unit tests, integration tests
- Update evolution docs with new paths:
  - `evolution/docs/evolution/architecture.md` — "Pipeline Module Decomposition" section
  - `evolution/docs/evolution/reference.md` — "Key Files" section
  - `evolution/docs/evolution/data_model.md` — "Key Files" subsections
  - `evolution/docs/evolution/README.md` — "Code Layout" section

**Rollback plan**: If Phase 3 PR breaks CI or causes issues after merge:
1. `git revert <merge-commit>` — single revert undoes all file moves
2. PR #1 (dead code removal) remains independently valid and does not need revert
3. The two PRs have no logical dependency — PR #1 can ship even if PR #2 is reverted

## Testing

### Existing Tests to Update (PR #1)
- `state.test.ts`: Remove `backward compat: eloRatings deserialization` describe block (~50 lines); remove/update vestigial field assertions at lines 201-213, 228-231, 256-259, 446-449
- `rating.test.ts`: Remove `eloToRating (backward compat)` describe block
- `pipeline.test.ts`: Remove `persistAgentInvocation` test block (~lines 1617-1692) and its imports
- `pipelineUtilities.test.ts` (lines 241, 469): Remove `debatesAdded: 0` from DiffMetrics assertions
- `InvocationDetailContent.test.tsx` (line 52): Remove `debatesAdded: 0` from DiffMetrics literal
- `evolutionVisualizationActions.test.ts` (lines 402, 1010): Update `debatesAdded` assertions to handle optional field
- `arenaIntegration.test.ts`: Update if `ordinal` removal is executed (depends on migration check)
- `persistence.continuation.test.ts`: Verify still passes (mock snapshots already omit vestigial fields)

### Existing Tests to Update (PR #2)
- All 36 test files in `core/`: Update import paths to new subfolder locations
- ~15 agent/service test files outside `core/`: Update imports from `core/` paths
- `llmClient.test.ts`: Update `EVOLUTION_DEFAULT_MODEL` import to `config/constants`

### New Tests
- Add one unit test asserting `deserializeState()` handles a snapshot with no `eloRatings` field gracefully (regression guard against re-introduction)
- Add one unit test asserting `deserializeState()` handles a snapshot missing vestigial fields (`treeSearchResults`, etc.) gracefully

### Manual Verification
- Before 1a: Confirm no `continuation_pending` runs in DB use the old `eloRatings`-only checkpoint format
- Before 1c: Query `information_schema.columns` to verify `ordinal` column status on `evolution_arena_elo`
- After PR #2: Verify `npm run build` succeeds (catches any missed import paths)

## Documentation Updates
The following docs need updates after PR #2 (subfolder restructure):
- `evolution/docs/evolution/architecture.md` — Update "Pipeline Module Decomposition" section with new subfolder structure
- `evolution/docs/evolution/reference.md` — Update "Key Files" section with new paths
- `evolution/docs/evolution/data_model.md` — Update file paths in "Key Files" subsections
- `evolution/docs/evolution/README.md` — Update "Code Layout" section
- `evolution/docs/evolution/experimental_framework.md` — unlikely to need changes (no core/ paths referenced)
