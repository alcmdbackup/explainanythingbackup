# Arena System

The arena provides a unified cross-method comparison layer on top of the evolution pipeline. While individual runs produce variants within a single strategy or model, the arena aggregates results across runs into a persistent leaderboard using OpenSkill (Weng-Lin Bayesian) ratings. This lets you answer questions like "across all runs for this prompt, which variant is best?" regardless of which strategy or model produced it.

## How it works

```
  Pipeline Run N                        Arena Tables
  +-----------------+                   +-------------------------+
  | Generate        |                   | evolution_arena_entries  |
  | variants        |  loadArenaEntries | (persistent pool)       |
  |                 | <-----------------+                         |
  | + arena entries |                   |                         |
  |                 |                   |                         |
  | Rate & compare  |                   |                         |
  | all variants    |                   |                         |
  |                 |  syncToArena      |                         |
  | New variants +  | ----------------> | Upsert entries          |
  | match results   |                   | Insert comparisons      |
  +-----------------+                   | Update ratings          |
                                        +-------------------------+
                                                  |
                                        +-------------------------+
                                        | evolution_arena_        |
                                        | comparisons             |
                                        | (match history)         |
                                        +-------------------------+
```

Each run loads existing arena entries into its pool, ranks everything together, then syncs new variants and match results back. Over time the arena accumulates a reliable leaderboard per prompt.

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

- Queries `evolution_arena_entries` filtered by `prompt_id` and `archived_at IS NULL`
- Sets `fromArena: true` on each returned variant
- Pre-seeds ratings from stored `mu`/`sigma` values rather than using defaults (mu=25, sigma=8.333). This preserves rating history so arena entries are not treated as brand-new
- Sets `strategy` to `arena_<generation_method>` for traceability
- Returns an empty set (no error thrown) if the query fails or returns no rows

> **Note:** Arena entries participate in ranking during runs but are NOT persisted to `evolution_variants`. They exist only in the arena tables. The `isArenaEntry()` type guard distinguishes them at runtime.

## Syncing results back

After a run completes rating, `syncToArena` pushes new variants and match results into the arena tables via the `sync_to_arena` database RPC.

**File:** `evolution/src/lib/pipeline/arena.ts`

```typescript
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
): Promise<void>
```

Key behaviors:

- Filters out variants where `fromArena === true` (they already exist in the arena)
- Converts each new variant to an arena entry with its current `mu`, `sigma`, and Elo-scale rating
- Builds match records from the run's match history, including cross-pool comparisons between new variants and existing arena entries
- Calls `sync_to_arena` RPC which handles upserting entries and inserting comparisons atomically
- Limits enforced by the RPC: max **200 entries** and max **1000 matches** per sync call
- Logs a warning on failure but does not throw -- arena sync is non-critical to the run

### Elo scale conversion

Arena entries store both OpenSkill ratings (`mu`, `sigma`) and an Elo-scale rating for human readability. The conversion (from `evolution/src/lib/shared/rating.ts`):

```
elo_rating = clamp(0, 3000, 1200 + (mu - 25) * 16)
```

A fresh entry with default mu=25 maps to Elo 1200. See [Rating System](./rating_and_comparison.md) for the full rating model.

## Database schema

### evolution_prompts (prompt bank)

The prompt bank stores the prompts that arena entries are rated against. Originally named `evolution_arena_topics`, it was renamed in the 20260320 migration.

| Column       | Type        | Description                          |
|-------------|-------------|--------------------------------------|
| id          | uuid PK     | Auto-generated                       |
| prompt      | text        | The full prompt text                 |
| title       | varchar(200)| Short human-readable label           |
| status      | text        | `active` or `archived`               |
| deleted_at  | timestamptz | Soft delete (null = active)          |
| archived_at | timestamptz | Archive timestamp                    |
| created_at  | timestamptz | Row creation time                    |

Soft delete via `deleted_at` keeps referential integrity intact. Archiving via `status` + `archived_at` hides prompts from the default list without removing them.

### evolution_arena_entries

Each entry is a single variant text stored with its current rating state.

| Column            | Type        | Description                                      |
|-------------------|-------------|--------------------------------------------------|
| id                | uuid PK     | Auto-generated                                   |
| prompt_id         | uuid FK     | References `evolution_prompts.id`                |
| content           | text        | The variant text                                 |
| mu                | float       | OpenSkill mu (skill estimate)                    |
| sigma             | float       | OpenSkill sigma (uncertainty)                    |
| elo_rating        | float       | Elo-scale conversion of mu                       |
| match_count       | int         | Total comparisons this entry has participated in |
| generation_method | text        | Strategy/model that produced the entry           |
| run_id            | uuid        | Originating pipeline run (nullable)              |
| variant_id        | uuid        | Source variant ID (nullable)                     |
| model             | text        | LLM model used (nullable)                        |
| cost_usd          | float       | Generation cost (nullable)                       |
| archived_at       | timestamptz | Archive timestamp (null = active)                |
| created_at        | timestamptz | Row creation time                                |

The `generation_method` field tracks provenance: which strategy produced this entry (e.g., `pipeline`, `crossover`, `prompt_engineering`). Combined with `model` and `cost_usd`, this enables cost-efficiency analysis on the leaderboard.

### evolution_arena_comparisons

Stores pairwise comparison results from pipeline runs.

| Column     | Type             | Description                                |
|-----------|------------------|--------------------------------------------|
| id        | uuid PK          | Auto-generated                             |
| prompt_id | uuid FK           | References `evolution_prompts.id`          |
| entry_a   | uuid FK           | References `evolution_arena_entries.id`    |
| entry_b   | uuid FK           | References `evolution_arena_entries.id`    |
| winner    | text              | `a`, `b`, or `draw`                       |
| confidence| float             | Judge confidence in [0, 1]                |
| run_id    | uuid              | Pipeline run that produced this comparison |
| status    | text              | Comparison status                          |
| created_at| timestamptz       | Row creation time                          |

Comparisons link back to the originating run via `run_id`, allowing you to trace which runs contributed to an entry's rating.

## Arena entries vs evolution_variants

The arena and the pipeline maintain separate storage:

- **`evolution_variants`** -- variants created during a pipeline run. Scoped to a single run. Deleted or archived with the run.
- **`evolution_arena_entries`** -- long-lived entries that persist across runs. Updated ratings accumulate over time.

When arena entries are loaded into a run, they receive temporary `TextVariation` wrappers with `fromArena: true`. After rating completes, only the match results (not the variant rows) flow back. The `isArenaEntry()` type guard in `evolution/src/lib/pipeline/arena.ts` enforces this boundary:

```typescript
export function isArenaEntry(variant: TextVariation): variant is ArenaTextVariation {
  return 'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true;
}
```

## Admin UI

The arena admin pages provide leaderboard views and topic management.

### Pages

| Route                                      | Purpose                                              |
|-------------------------------------------|------------------------------------------------------|
| `/admin/evolution/arena`                  | List all arena topics with entry counts              |
| `/admin/evolution/arena/[topicId]`        | Leaderboard for a topic: Elo, Mu, Sigma, Matches, Cost |
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
