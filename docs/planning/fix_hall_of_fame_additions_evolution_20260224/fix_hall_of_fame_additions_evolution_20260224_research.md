# Fix Hall of Fame Additions Evolution Research

## Problem Statement
After runs complete, top 2 variants aren't being auto-added to hall of fame in production for evolution pipeline.

## Requirements (from GH Issue #546)
- Investigate and fix feedHallOfFame() — The feedHallOfFame() function in pipeline finalization isn't persisting top 2 variants to hall_of_fame_entries

## High Level Summary

**Root cause: partial unique index incompatibility with Supabase upsert.**

The `feedHallOfFame()` function in `hallOfFameIntegration.ts` uses:
```typescript
.upsert(entryRows, { onConflict: 'evolution_run_id,rank' })
```

This translates via PostgREST to `ON CONFLICT (evolution_run_id, rank) DO UPDATE SET ...`.

However, the unique index on `(evolution_run_id, rank)` is a **partial** index:
```sql
CREATE UNIQUE INDEX idx_bank_entries_run_rank
  ON article_bank_entries(evolution_run_id, rank)
  WHERE evolution_run_id IS NOT NULL;
```

PostgreSQL requires `ON CONFLICT` to include a matching `WHERE` predicate to infer a partial unique index. Without it, PostgreSQL raises: "there is no unique or exclusion constraint matching the ON CONFLICT specification". Supabase's JS client `onConflict` parameter only accepts column names — it cannot specify a WHERE predicate.

The error is silently caught:
```typescript
if (entryErr || !entries || entries.length === 0) {
  logger.warn('Failed to batch upsert hall-of-fame entries', { runId, error: entryErr?.message });
  return;  // <-- silent bail
}
```

This bug has existed since the feature was first implemented — never caught because:
1. Unit tests mock Supabase (never hit real DB constraints)
2. Integration tests use plain `.insert()`, not `.upsert()` with `onConflict`
3. The error is silently caught and logged as a warning

### Secondary Potential Issues (lower likelihood)

1. **FK constraint on `evolution_variant_id`**: If `persistVariants()` fails (non-fatal, just warns), variants aren't in `evolution_variants`, causing FK violation when `feedHallOfFame` inserts entries. Less likely root cause since `persistVariants` runs in the same `Promise.all` and typically succeeds.

2. **Topic resolution failure for prompt-based runs**: For prompt-based runs with `explanationId = null`, if `prompt_id` isn't already set on the run, `resolveTopicId()` returns null and `feedHallOfFame` bails. However, `autoLinkPrompt()` runs sequentially before `feedHallOfFame()` specifically to handle this.

3. **`ilike` pattern matching in `findTopicByPrompt`**: Uses `ilike` which treats `%` and `_` as wildcards. If prompt text contains these characters, lookup could fail or match multiple rows (`.single()` errors on multiple matches). Edge case, not likely root cause for systematic failure.

## Key Findings

### 1. Partial Index Cannot Be Inferred by ON CONFLICT

PostgreSQL source code confirms: if an index is partial AND no predicate is specified in ON CONFLICT, the index is NOT inferred as an arbiter. This means every single upsert in `feedHallOfFame` fails.

References:
- [PostgreSQL INSERT docs](https://www.postgresql.org/docs/current/sql-insert.html) — index_predicate required for partial index inference
- [PostgREST issue #2123](https://github.com/PostgREST/postgrest/issues/2123) — open issue for constraint/expression support
- [postgrest-js issue #382](https://github.com/supabase/postgrest-js/issues/382) — open issue for custom index support in onConflict

### 2. The Partial Index Is Unnecessary

The partial index `WHERE evolution_run_id IS NOT NULL` was intended to allow multiple rows with NULL `evolution_run_id` to share the same `rank`. But in PostgreSQL, NULL != NULL for uniqueness by default — a non-partial unique index already allows this.

### 3. Safe to Replace with Non-Partial Index

- `oneshot` entries have NULL `evolution_run_id` and NULL `rank` — unaffected by either index type
- Evolution entries always have non-NULL `evolution_run_id` and `rank` — correctly enforced by either index type
- No behavioral difference between partial and non-partial index for this schema

### 4. The Bug Predates the Top 3 → Top 2 Refactor

Commit `b1efaba7` (reduce from top 3 to top 2) refactored `feedHallOfFame` but the `onConflict: 'evolution_run_id,rank'` was already there. The bug has existed since the original implementation in migration `20260207000005`.

### 5. Pipeline Finalization Flow

```
finalizePipelineRun() (pipeline.ts:119)
  → Promise.all([persistSummary, persistVariants, persistAgentMetrics, ...])
  → await autoLinkPrompt(runId, ctx, logger)   // sequential: ensures prompt_id set
  → await feedHallOfFame(runId, ctx, logger)    // sequential: depends on prompt_id
      1. getTopByRating(2) — bail if empty
      2. resolveTopicId() — bail if null
      3. .upsert(entryRows, { onConflict: 'evolution_run_id,rank' })  ← FAILS HERE
      4. upsertEloRatings() — never reached
      5. triggerAutoReRank() — never reached
```

`feedHallOfFame` is only called when `stopReason !== 'killed'` and `stopReason !== 'continuation_timeout'`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md

### Previous Project Research
- docs/planning/add_best_3_variants_into_hall_fame_evolution_20260222/ — noted index "Works fine" but missed the partial index nuance

## Code Files Read
- `evolution/src/lib/core/hallOfFameIntegration.ts` — `feedHallOfFame()`, `autoLinkPrompt()`, `resolveTopicId()`, `findOrCreateTopic()`, `findTopicByPrompt()`, `upsertEloRatings()`, `triggerAutoReRank()`
- `evolution/src/lib/core/pipeline.ts` — `finalizePipelineRun()` orchestrator, `executeMinimalPipeline`, `executeFullPipeline`
- `evolution/src/lib/core/persistence.ts` — `persistVariants()` (non-fatal on error)
- `evolution/src/services/evolutionRunnerCore.ts` — production runner that claims and executes runs
- `evolution/src/lib/index.ts` — `preparePipelineRun()` and `prepareResumedPipelineRun()` factories
- `evolution/src/lib/core/hallOfFameIntegration.test.ts` — 7 unit tests with mocked Supabase
- `src/__tests__/integration/hall-of-fame-actions.integration.test.ts` — 9 integration tests using plain `.insert()` not `.upsert()`
- `supabase/migrations/20260201000001_article_bank.sql` — original 4 tables, FK constraints
- `supabase/migrations/20260207000005_hall_of_fame_rank.sql` — **partial unique index** `WHERE evolution_run_id IS NOT NULL`
- `supabase/migrations/20260208000001_enforce_prompt_title_strategy_name.sql` — NOT NULL + CHECK on title
- `supabase/migrations/20260208000002_rename_article_bank_to_hall_of_fame.sql` — index renamed to `idx_hall_of_fame_entries_run_rank`
- `supabase/migrations/20260220000002_hall_of_fame_openskill.sql` — OpenSkill migration
- `supabase/migrations/20260221000002_evolution_table_rename.sql` — table renamed to `evolution_hall_of_fame_entries`
- `supabase/migrations/20260222000001_fix_claim_evolution_run_overload.sql` — claim function fix
- `src/lib/schemas/schemas.ts` — `hallOfFameGenerationMethodSchema`, `evolution_run_id` nullable

## Production Verification (2026-02-24)

Ran 4 queries against production Supabase to confirm the hypothesis:

### Query 1: Auto-inserted entries count
```sql
SELECT COUNT(*) AS auto_inserted_entries
FROM evolution_hall_of_fame_entries
WHERE evolution_run_id IS NOT NULL AND rank IS NOT NULL;
```
**Result: 0** — `feedHallOfFame` has never successfully persisted a single entry.

### Query 2: Completed runs with no hall-of-fame entries
```sql
SELECT r.id, r.status, r.completed_at, r.total_variants
FROM evolution_runs r
LEFT JOIN evolution_hall_of_fame_entries e ON e.evolution_run_id = r.id
WHERE r.status = 'completed' AND r.total_variants > 0 AND e.id IS NULL
ORDER BY r.completed_at DESC LIMIT 20;
```
**Result: 5 completed runs** (12–37 variants each), all missing hall-of-fame entries.

### Query 3: Reproduce the exact error
```sql
INSERT INTO evolution_hall_of_fame_entries (topic_id, content, generation_method, model, evolution_run_id, rank, metadata)
VALUES ('00000000-0000-0000-0000-000000000000', 'test', 'evolution_winner', 'test', '00000000-0000-0000-0000-000000000000', 1, '{}')
ON CONFLICT (evolution_run_id, rank) DO UPDATE SET content = EXCLUDED.content;
```
**Result: `ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`**

### Query 4: Verify the index is partial
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'evolution_hall_of_fame_entries' AND indexname LIKE '%run_rank%';
```
**Result:**
```
idx_hall_of_fame_entries_run_rank | CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
  ON public.evolution_hall_of_fame_entries USING btree (evolution_run_id, rank)
  WHERE (evolution_run_id IS NOT NULL)
```

**Conclusion:** Root cause confirmed. The partial unique index prevents ON CONFLICT inference, causing every upsert to fail with error 42P10.

## Open Questions
- None — root cause confirmed via production queries.
