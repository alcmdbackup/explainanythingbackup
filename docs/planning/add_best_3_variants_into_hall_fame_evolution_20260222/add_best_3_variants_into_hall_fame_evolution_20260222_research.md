# Add Best 2 Variants Into Hall of Fame Evolution Research

## Problem Statement
Currently, adding evolution pipeline variants to the Hall of Fame requires manual admin action — clicking "Add to Hall of Fame" on a completed run's detail page. This project will automate the process so the top 2 variants from each completed pipeline run are automatically added to the Hall of Fame under the corresponding prompt/topic, and automatically ranked against the existing Hall of Fame pool via pairwise comparisons, all without user intervention.

## Requirements (from GH Issue #529)
1. Automatically add top 2 variants (by ordinal) from each completed pipeline run to the Hall of Fame
2. Auto-link to the corresponding prompt/topic in the Hall of Fame
3. Automatically run pairwise comparisons against the existing Hall of Fame pool (no manual action needed)
4. All of this should happen at pipeline finalization (inside `finalizePipelineRun`)

## High Level Summary

**The feature is already ~95% implemented.** The `feedHallOfFame()` function in `hallOfFameIntegration.ts` already:
1. Inserts the **top 3** variants (by ordinal) into the Hall of Fame after each pipeline run
2. Auto-links to the prompt/topic (via `prompt_id` on the run, or explanation title fallback)
3. Auto re-ranks by calling `runHallOfFameComparisonInternal()` with 1 round of Swiss-style comparisons
4. Runs inside `finalizePipelineRun()` in `pipeline.ts`

**The only change needed is reducing from 3 → 2 variants.**

### Current Implementation Flow

```
finalizePipelineRun() (pipeline.ts:118)
  → autoLinkPrompt()    — resolves topic from config.prompt / bank entry / explanation title
  → feedHallOfFame()    — inserts top N variants + auto re-ranks
      1. ctx.state.getTopByRating(3)  ← hardcoded 3
      2. Resolve topic_id (prompt_id on run, or explanation title fallback)
      3. Batch upsert entries (onConflict: 'evolution_run_id,rank')
      4. Initialize OpenSkill ratings (mu=25, sigma=8.333)
      5. Auto re-rank: runHallOfFameComparisonInternal(topicId, SYSTEM_USERID, 'gpt-4.1-nano', 1)
```

### Key Constraint: DB Schema

The DB rank constraint allows 1-3 (`rank >= 1 AND rank <= 3`). With top 2, only ranks 1-2 are used — no migration needed.

The generation_method CHECK constraint allows: `oneshot`, `evolution_winner`, `evolution_baseline`, `evolution_top3`. The label `evolution_top3` is used for rank 2-3 entries. With top 2 we'd still use it for rank 2, which is semantically misleading but functionally fine.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/README.md

## Code Files Read

### Primary Files (the feature implementation)
- `evolution/src/lib/core/hallOfFameIntegration.ts` — `feedHallOfFame()`, `autoLinkPrompt()`, `findTopicByPrompt()`, `linkPromptToRun()`
- `evolution/src/lib/core/pipeline.ts` — `finalizePipelineRun()` calls `autoLinkPrompt` then `feedHallOfFame` at lines 168-170
- `evolution/src/services/hallOfFameActions.ts` — `runHallOfFameComparisonInternal()` (no auth gate, callable from pipeline)

### Supporting Files
- `evolution/src/lib/core/state.ts:76-89` — `getTopByRating(n)` sorts variants by ordinal descending, returns top N
- `evolution/src/lib/core/llmClient.ts:15` — `EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001'`
- `src/lib/schemas/schemas.ts:1178-1179` — `hallOfFameGenerationMethodSchema = z.enum(['oneshot', 'evolution_winner', 'evolution_baseline', 'evolution_top3'])`
- `supabase/migrations/20260207000005_hall_of_fame_rank.sql` — rank 1-3 CHECK constraint, `(evolution_run_id, rank)` unique index, `evolution_top3` generation_method

### Test Files
- `evolution/src/lib/core/hallOfFameIntegration.test.ts` — 8 tests: findTopicByPrompt, linkPromptToRun, autoLinkPrompt, feedHallOfFame (top 3 upsert, empty pool, missing topic, errors, auto re-rank with SYSTEM_USERID, explanation title fallback)
- `evolution/src/services/hallOfFameActions.test.ts` — 31 tests covering CRUD, Elo updates, comparison, soft-delete cascade
- `evolution/src/lib/core/hallOfFame.test.ts` — additional integration-style tests

## Detailed Findings

### 1. `feedHallOfFame()` (hallOfFameIntegration.ts:105-227)

The number 3 is hardcoded at line 113: `ctx.state.getTopByRating(3)`. No `HALL_OF_FAME_TOP_N` constant exists.

Generation method assignment (line 172):
```typescript
generation_method: i === 0 ? 'evolution_winner' : 'evolution_top3',
```
- Rank 1 → `evolution_winner`
- Rank 2-3 → `evolution_top3`

Cost attribution (line 166): splits total run cost evenly across all top entries:
```typescript
const perEntryCost = runCost / top3.length;
```

Auto re-ranking (lines 208-221): dynamically imports `runHallOfFameComparisonInternal` to avoid circular deps, runs 1 round with `gpt-4.1-nano`. Non-fatal on failure.

### 2. `runHallOfFameComparisonInternal()` (hallOfFameActions.ts:342-509)

Exported as a separate non-auth-gated function specifically to be called from `feedHallOfFame()`. Uses Swiss-style pairing (sort by ordinal, match adjacent, skip already-compared). Updates OpenSkill ratings in memory then persists to `evolution_hall_of_fame_elo`.

### 3. DB Schema Constraints

| Constraint | Value | Impact of top 2 change |
|-----------|-------|----------------------|
| Rank CHECK | `rank >= 1 AND rank <= 3` | Works with 1-2, no change needed |
| Unique index | `(evolution_run_id, rank)` | Works fine |
| generation_method CHECK | `oneshot, evolution_winner, evolution_baseline, evolution_top3` | `evolution_top3` used for rank 2, semantically odd but functional |
| Zod schema | Same 4 values | Same |

### 4. Call Sites

`feedHallOfFame()` has a single production caller: `finalizePipelineRun()` in `pipeline.ts:170`. This is called from both `executeMinimalPipeline` (line 249) and `executeFullPipeline` (line 501) when runs complete normally (not killed, not continuation_timeout).

### 5. Test Impact

The main test assertion that needs updating (`hallOfFameIntegration.test.ts:244`):
```typescript
expect(logger.info).toHaveBeenCalledWith(
  'Hall of fame updated',
  expect.objectContaining({ runId: 'run-1', topicId: 'topic-1', entriesInserted: 3 }),
);
```
This expects `entriesInserted: 3` → needs to change to `2`.

### 6. Documentation References to "top 3"

- `evolution/docs/evolution/data_model.md:18` — "Top 3 variants from each run"
- `evolution/docs/evolution/data_model.md:68` — "feedHallOfFame (top 3 → evolution_hall_of_fame_entries with rank)"
- `evolution/docs/evolution/architecture.md:471` — "top 3" in agent log
- `evolution/docs/evolution/hall_of_fame.md` — various references to top 3
- `supabase/migrations/20260207000005_hall_of_fame_rank.sql:2` — "top-3 hall of fame entries"
