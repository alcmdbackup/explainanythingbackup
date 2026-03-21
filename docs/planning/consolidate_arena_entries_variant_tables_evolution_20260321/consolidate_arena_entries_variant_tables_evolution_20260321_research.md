# Consolidate Arena Entries Variant Tables Evolution Research

## Problem Statement
Consolidate evolution_arena_entries into evolution_variants to eliminate content duplication and simplify the data model. Currently all variants are synced 1:1 to the arena, making the separate table redundant. The merged table will add arena-specific columns (prompt_id, mu, sigma, archived_at, generation_method) to evolution_variants and retarget evolution_arena_comparisons FK. This eliminates ~100% content duplication and removes the orphaned variant_id column on arena entries.

## Requirements (from GH Issue #755)
1. Migration: Add arena columns to evolution_variants (prompt_id, mu, sigma, archived_at, generation_method, model, cost_usd), migrate data from evolution_arena_entries, retarget evolution_arena_comparisons FK, drop evolution_arena_entries
2. Update sync_to_arena RPC to upsert into evolution_variants instead
3. Update all TypeScript code referencing evolution_arena_entries (arenaActions, pipeline/arena, finalize, test helpers)
4. Update UI pages (arena leaderboard, arena entries, arena detail)
5. Update variant detail/list pages to show arena-specific data
6. Remove orphaned variant_id column handling
7. Update all tests and documentation
8. Explore removing `elo_score` column from evolution_variants (no more in-run Elo — only OpenSkill mu/sigma used)
9. Explore removing `is_winner` column (winner info is in run_summary JSONB — column may be redundant)

## High Level Summary

4 rounds of 4 parallel research agents investigated the full scope. Key conclusions:

1. **Both tables are empty on staging** — zero data migration risk
2. **Pipeline entries share IDs** — `arena_entry.id === variant.id` for all pipeline-created entries; merge by ID is safe
3. **Non-pipeline entries are test-only** — no production oneshot/manual arena entries found; the `generation_method` schema supports them but no production code creates them
4. **elo_score: KEEP but add mu/sigma** — elo_score is read in 30+ locations, used for ordering and percentile stats; mu/sigma are available at finalize time and can be persisted alongside; `ORDER BY mu` is equivalent to `ORDER BY elo_score` (monotonic); elo_score can eventually become a GENERATED column
5. **is_winner: KEEP** — used in 8+ query locations, UI filter, and experiments.ts inner join; the partial index `idx_variants_winner` enables fast lookups; topVariants[0].id in run_summary is an alternative but slower (JSONB extraction)
6. **match_count semantics conflict** — within-run (variants) vs cross-run (arena) are different; need separate columns: keep `match_count` for within-run, add `arena_match_count` for cross-run
7. **elo_attribution is dead code** — column exists but never written or read in V2; can be dropped
8. **Content column naming** — keep `variant_content` (27 refs) over `content` (19 refs); rename arena references
9. **FK retargeting is safe** — no circular dependencies; comparisons.entry_a/entry_b → evolution_variants.id is straightforward
10. **Arena round-trip design** — `prompt_id IS NOT NULL` distinguishes arena variants from run-only variants; no need for explicit `from_arena` flag since the in-memory `fromArena` flag on TextVariation handles pipeline filtering

## Key Finding: elo_score Analysis

**elo_score is NOT removable without first adding mu/sigma to evolution_variants.** Currently mu/sigma are only persisted on arena entries, not on variants. The pipeline has the data at finalize time but doesn't persist it.

- **30+ active code locations** reference elo_score (8 SELECT, 2 ORDER BY, 5 interfaces, 15+ tests)
- `toEloScale(mu)` = `1200 + (mu - 25) * 16` — purely derived from mu
- `ORDER BY elo_score DESC` ≡ `ORDER BY mu DESC` (monotonic linear transform)
- SQL `PERCENTILE_CONT` on elo_score could use mu instead
- PostgreSQL GENERATED column possible: `GENERATED ALWAYS AS (GREATEST(0, LEAST(3000, 1200 + (mu - 25) * 16))) STORED`

**Recommendation:** Add mu/sigma columns, persist them at finalize, keep elo_score as GENERATED column for backward compat during transition. Eventually drop elo_score after all code migrates to mu.

## Key Finding: is_winner Analysis

**is_winner is a useful denormalization, not truly redundant.**

- Written once at finalize (highest mu variant gets `is_winner = true`)
- run_summary.topVariants[0].id contains the same info but requires JSONB extraction
- The partial index `idx_variants_winner ON evolution_variants (run_id) WHERE is_winner = true` enables fast winner lookups
- experiments.ts uses `.eq('evolution_variants.is_winner', true)` inner join — replacing with JSONB extraction would be slower and more complex
- UI variants page has winner/non-winner filter toggle

**Recommendation:** Keep is_winner.

## Key Finding: Arena Entry Data Relationship

**For pipeline entries:** `arena_entry.id === variant.id` always holds. The syncToArena function uses the same UUID that was persisted to evolution_variants. The sync_to_arena RPC uses `ON CONFLICT (id) DO UPDATE`.

**For non-pipeline entries:** Only exist in test data. No production code creates oneshot/manual arena entries. Query on staging confirmed 0 rows in both tables.

**variant_id column on arena_entries:** Orphaned — never populated by any code. Can be safely dropped.

## Key Finding: match_count Semantics

| Column | Table | Semantics | Updated By |
|--------|-------|-----------|------------|
| match_count | evolution_variants | Within-run comparisons | finalize.ts upsert |
| match_count | evolution_arena_entries | Cross-run arena comparisons | sync_to_arena RPC (ON CONFLICT preserves) |

After consolidation, need two columns: `match_count` (within-run, immutable after finalize) and `arena_match_count` (cross-run, incremented by arena comparisons).

## Key Finding: Arena Round-Trip Flow

```
loadArenaEntries() → SELECT FROM evolution_arena_entries WHERE prompt_id=? AND archived_at IS NULL
  → Convert to TextVariation with fromArena: true
  → Inject into initial pool

Pipeline runs: generate → rank → evolve (arena entries participate naturally)

finalizeRun() → Filter OUT fromArena variants → Upsert only local variants to evolution_variants
syncToArena() → Filter OUT fromArena variants → Upsert only NEW variants to evolution_arena_entries
```

**After consolidation:** loadArenaEntries queries `evolution_variants WHERE prompt_id IS NOT NULL AND archived_at IS NULL`. The `prompt_id IS NOT NULL` filter naturally distinguishes arena-synced variants from run-only variants.

## Proposed Merged Schema

```sql
CREATE TABLE evolution_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES evolution_runs(id) ON DELETE CASCADE,
  explanation_id INT,
  variant_content TEXT NOT NULL,
  -- Rating (OpenSkill primary, elo_score derived)
  mu NUMERIC NOT NULL DEFAULT 25,
  sigma NUMERIC NOT NULL DEFAULT 8.333,
  elo_score NUMERIC GENERATED ALWAYS AS (
    GREATEST(0, LEAST(3000, 1200 + (mu - 25) * 16))
  ) STORED,
  -- Lineage
  generation INT NOT NULL DEFAULT 0,
  parent_variant_id UUID,
  agent_name TEXT,
  -- Match counts (dual semantics)
  match_count INT NOT NULL DEFAULT 0,          -- within-run
  arena_match_count INT NOT NULL DEFAULT 0,    -- cross-run
  -- Winner flag
  is_winner BOOLEAN NOT NULL DEFAULT false,
  -- Arena columns (nullable — only set for arena-synced variants)
  prompt_id UUID REFERENCES evolution_prompts(id) ON DELETE SET NULL,
  generation_method TEXT DEFAULT 'pipeline',
  model TEXT,
  cost_usd NUMERIC,
  archived_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Dropped columns: `variant_id` (orphaned), `elo_attribution` (dead code), `elo_rating` (redundant with elo_score GENERATED).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/data_model.md — Variant vs Explanation distinction, arena sync flow
- evolution/docs/evolution/arena.md — Unified pool model, sync_to_arena RPC, generation methods
- evolution/docs/evolution/entity_diagram.md — ER diagram, FK relationships
- evolution/docs/evolution/reference.md — DB schema, RPCs, key files
- evolution/docs/evolution/architecture.md — Runner lifecycle, data flow
- evolution/docs/evolution/README.md — Doc map
- evolution/docs/evolution/visualization.md — Admin UI pages, variant/arena detail
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill system, toEloScale, attribution
- evolution/docs/evolution/experimental_framework.md — Experiment metrics

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql — V2 schema (variants, arena_entries, comparisons, RPCs)
- supabase/migrations/20260320000001_rename_evolution_tables.sql — Latest RPC definitions
- supabase/migrations/20260226000001_elo_attribution_columns.sql — elo_attribution column (dead code)
- supabase/migrations/20260306000002_compute_run_variant_stats.sql — Variant stats RPC using elo_score
- evolution/src/lib/pipeline/finalize.ts — Variant upsert, winner determination, run_summary building
- evolution/src/lib/pipeline/arena.ts — loadArenaEntries, syncToArena, isArenaEntry guard
- evolution/src/lib/pipeline/runner.ts — Run lifecycle, arena integration
- evolution/src/lib/pipeline/experiments.ts — computeExperimentMetrics (elo_score + is_winner query)
- evolution/src/lib/shared/rating.ts — toEloScale function definition
- evolution/src/lib/shared/textVariationFactory.ts — UUID generation for variants
- evolution/src/lib/types.ts — TextVariation, EvolutionRunSummary interfaces
- evolution/src/services/arenaActions.ts — ArenaEntry interface, arena CRUD actions
- evolution/src/services/evolutionActions.ts — EvolutionVariant, VariantListEntry interfaces
- evolution/src/services/variantDetailActions.ts — Variant detail/lineage queries
- evolution/src/services/evolutionVisualizationActions.ts — Lineage graph queries
- evolution/src/experiments/evolution/experimentMetrics.ts — Variant elo_score percentile stats
- evolution/src/testing/evolution-test-helpers.ts — Test factories
- evolution/src/components/evolution/tabs/VariantsTab.tsx — Variant table UI
- src/app/admin/evolution/variants/page.tsx — Variants list page (is_winner filter)
- src/app/admin/evolution/arena/[topicId]/page.tsx — Arena leaderboard page
- src/app/admin/evolution/arena/entries/[entryId]/page.tsx — Arena entry detail
- src/app/admin/evolution/arena/arenaBudgetFilter.ts — Budget tier filter
- src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts — E2E arena tests (oneshot seeding)
- src/lib/schemas/schemas.ts — arenaGenerationMethodSchema

## Additional Findings (Rounds 5-7)

### GENERATED Column Feasibility
- PostgreSQL 15 (Supabase) supports GENERATED columns
- Supabase JS client does NOT auto-exclude GENERATED columns from INSERT/UPSERT — must manually omit
- Only ONE code location writes elo_score: `finalize.ts:158` — easy to remove
- `compute_run_variant_stats` RPC only READs elo_score — works fine with GENERATED
- **Decision:** Keep elo_score as regular column initially, convert to GENERATED in follow-up after all code migrates to mu

### prompt_id Semantics (CRITICAL)
- `evolution_runs.prompt_id` = "what prompt does this run target"
- `evolution_variants.prompt_id` (after consolidation) MUST mean "this variant is in the arena" NOT "from a prompt-based run"
- Set ONLY by syncToArena RPC, NULL at finalize time
- If set at finalize, `loadArenaEntries()` would incorrectly return ALL variants from all runs for that prompt
- Filter `WHERE prompt_id = ? AND archived_at IS NULL` only works with arena-membership semantics

### Unified Column Naming
- `elo_score` (30+ active refs) wins over `elo_rating` (15-20 refs) as unified name
- `variant_content` (27 refs) wins over `content` (19 refs) — keep variant naming
- `match_count` stays for within-run; add `arena_match_count` for cross-run

### evolution_explanation_id
- Migration 20260314000002 added `evolution_explanation_id UUID` to `evolution_arena_entries`
- `evolution_variants` only has legacy `explanation_id INT`
- Must add `evolution_explanation_id UUID` to variants in consolidation migration

### RPC Rewrite
- sync_to_arena must upsert into evolution_variants instead of arena_entries
- ON CONFLICT (id) updates: prompt_id, mu, sigma, elo_score, arena_match_count, generation_method
- Preserves: parent_variant_id, agent_name, generation, match_count, is_winner, variant_content
- arena_match_count incremented after comparisons inserted

### Complete File Impact
- **5 test files** need updates (35 references total)
- **7 arena UI files** need updates (3 HIGH, 2 MEDIUM, 2 LOW)
- **13 functions in arenaActions.ts** (2 CRITICAL, 1 HIGH, 10 LOW)
- **arena/entries/[entryId] page** should redirect to variants/[variantId]

## Open Questions
1. Do we rename `evolution_arena_comparisons` to something shorter (e.g., `evolution_comparisons`)?
2. Should we keep the arena entry detail route as a redirect or remove it entirely?
3. Should elo_score become GENERATED in phase 1 or in a follow-up project?
