# Arena System

The arena provides a unified cross-method comparison layer on top of the evolution pipeline. While individual runs produce variants within a single strategy or model, the arena aggregates results across runs into a persistent leaderboard using OpenSkill (Weng-Lin Bayesian) ratings. This lets you answer questions like "across all runs for this prompt, which variant is best?" regardless of which strategy or model produced it.

## How it works

```
  Pipeline Run N                        evolution_variants table
  +-----------------+                   +-------------------------+
  | Generate        |                   | WHERE synced_to_arena   |
  | variants        |  loadArenaEntries |   = true                |
  |                 | <-----------------+ AND prompt_id = X       |
  | + arena entries |                   |                         |
  |                 |                   |                         |
  | Rate & compare  |                   |                         |
  | all variants    |                   |                         |
  |                 |  syncToArena      |                         |
  | New variants +  | ----------------> | Upsert variants         |
  | match results   |                   | (synced_to_arena=true)  |
  +-----------------+                   | Insert comparisons      |
                                        +-------------------------+
                                                  |
                                        +-------------------------+
                                        | evolution_arena_        |
                                        | comparisons             |
                                        | (match history)         |
                                        +-------------------------+
```

Arena entries are not a separate table. They are rows in `evolution_variants` with `synced_to_arena = true`. Each run loads existing arena-synced variants into its pool, ranks everything together, then syncs new variants and match results back. Over time the arena accumulates a reliable leaderboard per prompt.

## Loading arena entries

`loadArenaEntries` pulls active entries from the database into the pipeline's working pool. Arena entries participate in ranking alongside freshly generated variants but are distinguished by a `fromArena` flag.

**File:** `evolution/src/lib/pipeline/arena.ts`

```typescript
export async function loadArenaEntries(
  promptId: string,
  supabase: SupabaseClient,
): Promise<{ variants: ArenaTextVariation[]; ratings: Map<string, Rating> }>
```

Key behaviors:

- Queries `evolution_variants` filtered by `synced_to_arena = true`, `prompt_id`, and `archived_at IS NULL`
- Sets `fromArena: true` on each returned variant
- Pre-seeds ratings from stored `mu`/`sigma` values rather than using defaults (mu=25, sigma=8.333). This preserves rating history so arena entries are not treated as brand-new
- Sets `strategy` to `arena_<generation_method>` for traceability
- Returns an empty set (no error thrown) if the query fails or returns no rows

> **Note:** Arena entries are regular `evolution_variants` rows distinguished by `synced_to_arena = true`. The `isArenaEntry()` type guard distinguishes them at runtime when loaded into a pipeline run.

## Syncing results back

After a run completes rating, `syncToArena` pushes new variants and match results into the arena tables via the `sync_to_arena` database RPC.

**File:** `evolution/src/lib/pipeline/arena.ts`

```typescript
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
): Promise<void>
```

Key behaviors:

- Filters out variants where `fromArena === true` (they already exist in the arena) for the new-entries array
- Builds a separate `arenaUpdates` array for existing arena entries, containing only mutable rating fields (`mu`, `sigma`, `elo_score`, `arena_match_count`). Immutable fields (content, generation_method, model, etc.) are preserved.
- Upserts each new variant into `evolution_variants` with `synced_to_arena = true` and its current `mu`, `sigma`, and Elo-scale rating
- Builds match records from the run's match history, including cross-pool comparisons between new variants and existing arena entries
- Calls `sync_to_arena` RPC with both `p_entries` (new variants) and `p_arena_updates` (existing arena entry rating updates), which handles upserting variants, updating arena ratings, and inserting comparisons atomically
- Limits enforced by the RPC: max **200 entries** and max **1000 matches** per sync call
- Logs a warning on failure but does not throw -- arena sync is non-critical to the run
- Migration `20260326000002_fix_sync_to_arena_match_count.sql` fixed the RPC to use `COALESCE((entry->>'arena_match_count')::INT, 0)` on INSERT instead of hardcoded `0`, so `arena_match_count` is now properly persisted when syncing entries that already have match history

### Elo scale conversion

Arena entries store both OpenSkill ratings (`mu`, `sigma`) and an Elo-scale rating for human readability. The conversion (from `evolution/src/lib/shared/rating.ts`):

```
elo_rating = clamp(0, 3000, 1200 + (mu - 25) * 16)
```

A fresh entry with default mu=25 maps to Elo 1200. See [Rating System](./rating_and_comparison.md) for the full rating model.

## Database schema

### evolution_prompts (prompt bank)

The prompt bank stores the prompts that arena entries are rated against. Originally named `evolution_arena_topics`, it was renamed in the 20260320 migration. Arena pages are filtered views of prompts — the `arena_topic` entity type has been removed from the entity registry and `evolution_metrics` CHECK constraint.

| Column       | Type        | Description                          |
|-------------|-------------|--------------------------------------|
| id          | uuid PK     | Auto-generated                       |
| prompt      | text        | The full prompt text                 |
| name        | varchar(200)| Short human-readable display name    |
| status      | text        | `active` or `archived`               |
| deleted_at  | timestamptz | Soft delete (null = active)          |
| archived_at | timestamptz | Archive timestamp                    |
| created_at  | timestamptz | Row creation time                    |

Soft delete via `deleted_at` keeps referential integrity intact. Archiving via `status` + `archived_at` hides prompts from the default list without removing them.

### Arena columns on evolution_variants

Arena entries are rows in `evolution_variants` with `synced_to_arena = true`. The following columns support arena functionality:

| Column             | Type        | Description                                      |
|--------------------|-------------|--------------------------------------------------|
| mu                 | float       | OpenSkill mu (skill estimate)                    |
| sigma              | float       | OpenSkill sigma (uncertainty)                    |
| prompt_id          | uuid FK     | References `evolution_prompts.id`                |
| synced_to_arena    | boolean     | `true` = this variant is an arena entry          |
| arena_match_count  | int         | Total comparisons this entry has participated in (computed from match history, not hardcoded) |
| generation_method  | text        | Strategy/model that produced the entry           |
| model              | text        | LLM model used (nullable)                        |
| cost_usd           | float       | Generation cost (nullable)                       |
| archived_at        | timestamptz | Archive timestamp (null = active)                |

The `generation_method` field tracks provenance: which strategy produced this entry (e.g., `pipeline`, `crossover`, `prompt_engineering`). Combined with `model` and `cost_usd`, this enables cost-efficiency analysis on the leaderboard.

### evolution_arena_comparisons

Stores pairwise comparison results from pipeline runs.

| Column     | Type             | Description                                |
|-----------|------------------|--------------------------------------------|
| id        | uuid PK          | Auto-generated                             |
| prompt_id | uuid FK           | References `evolution_prompts.id`          |
| entry_a   | uuid (app-enforced) | References `evolution_variants.id` (DB FK dropped in migration 20260409000001) |
| entry_b   | uuid (app-enforced) | References `evolution_variants.id` (DB FK dropped in migration 20260409000001) |
| winner    | text              | `a`, `b`, or `draw`                       |
| confidence| float             | Judge confidence in [0, 1]                |
| run_id    | uuid              | Pipeline run that produced this comparison |
| status    | text              | Comparison status                          |
| created_at| timestamptz       | Row creation time                          |

The `entry_a` and `entry_b` columns reference `evolution_variants.id` (previously `evolution_arena_entries.id`), but the DB foreign key constraints were dropped in migration `20260409000001` to allow in-run writes before variants are persisted. Referential integrity is enforced at the application layer via `VariantEntity.ts`. Comparisons link back to the originating run via `run_id`, allowing you to trace which runs contributed to an entry's rating.

## Arena entries vs evolution_variants

Arena entries and pipeline variants live in the **same table** (`evolution_variants`). The `synced_to_arena` boolean flag distinguishes them:

- **`synced_to_arena = false` (default)** -- regular pipeline variants, scoped to a single run. Deleted or archived with the run.
- **`synced_to_arena = true`** -- arena entries that persist across runs. Ratings (`mu`, `sigma`) and `arena_match_count` accumulate over time.

When arena entries are loaded into a run, they receive temporary `Variant` wrappers with `fromArena: true`. After rating completes, new variants are upserted with `synced_to_arena = true` and match results are recorded. The `isArenaEntry()` type guard in `evolution/src/lib/pipeline/arena.ts` distinguishes them at runtime:

```typescript
export function isArenaEntry(variant: Variant): variant is ArenaTextVariation {
  return 'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true;
}
```

## Admin UI

The arena admin pages provide leaderboard views and topic management.

### Pages

| Route                                      | Purpose                                              |
|-------------------------------------------|------------------------------------------------------|
| `/admin/evolution/arena`                  | List all arena topics with entry counts              |
| `/admin/evolution/arena/[topicId]`        | Leaderboard for a topic: sortable columns for Elo (rounded to integers), 95% CI (`formatEloCIRange(elo, sigma)`), Elo ± σ (`formatEloWithUncertainty(elo, sigma * ELO_SIGMA_SCALE)`), Matches, Method, Cost (shows "N/A" — cost data unavailable at variant level). Entries below the top 15% eligibility cutoff (mean + 1.04×stdDev of Elo scores) are dimmed. Markdown is stripped from content previews via `stripMarkdownTitle()`. |
| `/admin/evolution/arena/entries/[entryId]`| Entry detail: content, rating history, comparisons   |

**Source files:**
- `src/app/admin/evolution/arena/page.tsx` -- topics list
- `src/app/admin/evolution/arena/[topicId]/page.tsx` -- leaderboard
- `src/app/admin/evolution/arena/entries/[entryId]/page.tsx` -- entry detail

### Server actions

All data fetching and mutations go through server actions in `evolution/src/services/arenaActions.ts`:

| Action                        | Purpose                              |
|-------------------------------|--------------------------------------|
| `getArenaTopicsAction`        | List topics with entry counts        |
| `getArenaTopicDetailAction`   | Single topic detail                  |
| `createArenaTopicAction`      | Create a new prompt/topic            |
| `getArenaEntriesAction`       | Leaderboard entries for a topic      |
| `getArenaEntryDetailAction`   | Single entry detail                  |
| `getArenaComparisonsAction`   | Recent comparisons for a topic       |
| `archiveArenaTopicAction`     | Soft-archive a topic                 |

The prompt registry actions (`listPromptsAction`, `createPromptAction`, `updatePromptAction`, `archivePromptAction`, `deletePromptAction`) in the same file manage the underlying `evolution_prompts` table and are shared between the arena UI and the pipeline's prompt selection.

## Cross-references

- [Architecture](./architecture.md) -- where the arena fits in the overall pipeline
- [Rating System](./rating_and_comparison.md) -- OpenSkill rating mechanics, match scheduling, convergence
- [Data Model](./data_model.md) -- full database schema including arena tables
