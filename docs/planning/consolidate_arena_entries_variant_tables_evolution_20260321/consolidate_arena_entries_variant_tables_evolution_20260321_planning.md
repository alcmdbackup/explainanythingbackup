# Consolidate Arena Entries Variant Tables Evolution Plan

## Background
Consolidate evolution_arena_entries into evolution_variants to eliminate content duplication and simplify the data model. Currently all variants are synced 1:1 to the arena (same UUID), making the separate table redundant. Both tables are empty on staging — zero data migration risk. The merged table adds arena-specific columns to evolution_variants, retargets evolution_arena_comparisons FKs, and drops evolution_arena_entries. Also adds mu/sigma columns to enable future elo_score deprecation.

## Requirements (from GH Issue #755)
1. Migration: Add arena columns to evolution_variants (prompt_id, mu, sigma, arena_match_count, generation_method, model, cost_usd, archived_at, evolution_explanation_id), retarget evolution_arena_comparisons FK, drop evolution_arena_entries
2. Update sync_to_arena RPC to upsert into evolution_variants instead
3. Update all TypeScript code referencing evolution_arena_entries
4. Update UI pages (arena leaderboard, arena entries, arena detail)
5. Remove orphaned variant_id column handling
6. Update all tests and documentation
7. Add mu/sigma columns to evolution_variants; persist at finalize time
8. Drop elo_attribution column (dead code — never written/read in V2)
9. Keep is_winner and elo_score (both actively used, not redundant)

## Problem
The evolution pipeline stores variant data in two separate tables with ~100% content duplication: `evolution_variants` holds per-run variant data and `evolution_arena_entries` holds the same variants synced for cross-run comparison. Since all pipeline variants are synced to the arena (sharing the same UUID), the two tables are redundant. This duplication creates maintenance overhead, split query patterns, two different rating column names (`elo_score` vs `elo_rating`), and an orphaned `variant_id` FK that was never implemented. Additionally, `mu`/`sigma` (the primary OpenSkill ratings) are only persisted on arena entries, not on variants — despite being available at finalization time.

## Options Considered

### Option A: Merge arena_entries INTO variants (Chosen)
Add arena-specific columns to `evolution_variants`, migrate data, retarget comparisons FK, drop `evolution_arena_entries`.

**Pros:** Single source of truth, eliminates content duplication, enables mu/sigma on all variants, simpler query patterns.
**Cons:** Wider variant table (~8 new nullable columns), `prompt_id` semantics must be carefully managed.

### Option B: Merge variants INTO arena_entries (Rejected)
Rename arena_entries to become the primary table, add variant-specific columns.

**Cons:** arena_entries is the secondary concept; variants are the primary entity. Would require renaming more code references (30+ elo_score refs vs 15-20 elo_rating refs).

### Option C: Keep separate tables, add FK (Rejected)
Keep both tables, add proper `variant_id` FK on arena_entries.

**Cons:** Doesn't eliminate content duplication, still requires dual queries, doesn't simplify data model.

**Decision:** Option A — merge arena_entries into variants. Both tables are empty on staging, so migration is zero-risk.

## Phased Execution Plan

### Phase 1: Migration SQL

Create `supabase/migrations/YYYYMMDD000001_consolidate_arena_into_variants.sql`:

```sql
-- Consolidate evolution_arena_entries into evolution_variants.
-- Both tables are empty on staging — zero data migration risk.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP RPCs that reference evolution_arena_entries
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB);

-- ═══════════════════════════════════════════════════════════════
-- 2. DROP indexes on evolution_arena_entries (will be recreated on variants)
-- ═══════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS idx_arena_entries_prompt;
DROP INDEX IF EXISTS idx_arena_entries_active;
DROP INDEX IF EXISTS idx_arena_comparisons_prompt;

-- ═══════════════════════════════════════════════════════════════
-- 3. ADD arena columns to evolution_variants
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants
  ADD COLUMN mu NUMERIC NOT NULL DEFAULT 25,
  ADD COLUMN sigma NUMERIC NOT NULL DEFAULT 8.333,
  ADD COLUMN prompt_id UUID REFERENCES evolution_prompts(id) ON DELETE SET NULL,
  ADD COLUMN arena_match_count INT NOT NULL DEFAULT 0,
  ADD COLUMN generation_method TEXT DEFAULT 'pipeline',
  ADD COLUMN model TEXT,
  ADD COLUMN cost_usd NUMERIC,
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN evolution_explanation_id UUID REFERENCES evolution_explanations(id);

-- ═══════════════════════════════════════════════════════════════
-- 4. DROP dead columns from evolution_variants
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants DROP COLUMN IF EXISTS elo_attribution;

-- ═══════════════════════════════════════════════════════════════
-- 5. MIGRATE data (both tables empty on staging, but handle gracefully)
-- ═══════════════════════════════════════════════════════════════

-- Update existing variants that have matching arena entries (pipeline entries share IDs)
UPDATE evolution_variants ev
SET
  prompt_id = eae.prompt_id,
  mu = eae.mu,
  sigma = eae.sigma,
  elo_score = eae.elo_rating,
  arena_match_count = eae.match_count,
  generation_method = eae.generation_method,
  model = eae.model,
  cost_usd = eae.cost_usd,
  archived_at = eae.archived_at,
  evolution_explanation_id = eae.evolution_explanation_id
FROM evolution_arena_entries eae
WHERE ev.id = eae.id;

-- Insert any arena entries that have no matching variant (e.g., oneshot entries)
INSERT INTO evolution_variants (
  id, run_id, variant_content, mu, sigma, elo_score,
  prompt_id, arena_match_count, generation_method, model,
  cost_usd, archived_at, evolution_explanation_id, created_at
)
SELECT
  eae.id, eae.run_id, eae.content, eae.mu, eae.sigma, eae.elo_rating,
  eae.prompt_id, eae.match_count, eae.generation_method, eae.model,
  eae.cost_usd, eae.archived_at, eae.evolution_explanation_id, eae.created_at
FROM evolution_arena_entries eae
WHERE NOT EXISTS (SELECT 1 FROM evolution_variants ev WHERE ev.id = eae.id);

-- ═══════════════════════════════════════════════════════════════
-- 6. RETARGET evolution_arena_comparisons FKs
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_arena_comparisons
  DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_a_fkey,
  DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_b_fkey;

ALTER TABLE evolution_arena_comparisons
  ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey
    FOREIGN KEY (entry_a) REFERENCES evolution_variants(id) ON DELETE CASCADE,
  ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey
    FOREIGN KEY (entry_b) REFERENCES evolution_variants(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 7. DROP evolution_arena_entries table
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS evolution_arena_entries CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 8. CREATE indexes for arena queries on evolution_variants
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_variants_arena_prompt ON evolution_variants (prompt_id, mu DESC)
  WHERE prompt_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_variants_arena_active ON evolution_variants (prompt_id)
  WHERE prompt_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 9. RECREATE sync_to_arena RPC targeting evolution_variants
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  match JSONB;
BEGIN
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    UPDATE evolution_variants
    SET
      prompt_id = p_prompt_id,
      mu = COALESCE((entry->>'mu')::NUMERIC, mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', generation_method)
    WHERE id = (entry->>'id')::UUID;
  END LOOP;

  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (prompt_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_prompt_id,
      (match->>'entry_a')::UUID,
      (match->>'entry_b')::UUID,
      match->>'winner',
      COALESCE((match->>'confidence')::NUMERIC, 0),
      p_run_id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) TO service_role;
```

**CRITICAL semantic note:** `prompt_id` on `evolution_variants` means "this variant is in the arena" — set ONLY by `sync_to_arena` RPC, never by `finalize.ts`. This enables `loadArenaEntries()` to filter correctly.

### Phase 2: Update pipeline code (evolution/src/lib/pipeline/)

**arena.ts — loadArenaEntries:**
- Change `.from('evolution_arena_entries')` → `.from('evolution_variants')`
- Select: `id, variant_content, mu, sigma, arena_match_count, generation_method`
- Filter: `.eq('prompt_id', promptId).is('archived_at', null)`
- Map: `entry.variant_content` → `v.text` (was `entry.content`)

**arena.ts — syncToArena:**
- Change RPC payload field names: `content` → `variant_content`, `elo_rating` → `elo_score`, `match_count` → `arena_match_count`
- Remove `match_count: 0` (variants already have within-run match_count; arena_match_count handled by RPC)

**finalize.ts — variant upsert:**
- Add `mu` and `sigma` to upsert payload (from `result.ratings`)
- Import `DEFAULT_SIGMA` from `../shared/rating`
- Do NOT set `prompt_id` (syncToArena's job)

**experiments.ts:**
- Change `.select('evolution_variants!inner(elo_score)')` — keep as-is (elo_score stays)

### Phase 3: Update services (evolution/src/services/)

**arenaActions.ts:**
- `ArenaEntry` interface: rename `content` → `variant_content`, `match_count` → `arena_match_count`, drop `elo_rating` (use `elo_score`), drop `variant_id`
- `getArenaEntriesAction`: change `.from('evolution_arena_entries')` → `.from('evolution_variants')`, filter `.not('prompt_id', 'is', null)`, order by `elo_score`
- `getArenaEntryDetailAction`: same table change
- `getArenaTopicsAction`: entry count query changes from `evolution_arena_entries` → `evolution_variants` with `prompt_id IS NOT NULL`
- Topic/prompt actions: already renamed to `evolution_prompts` (done in prior project)

**Other services (no changes expected):**
- `evolutionActions.ts` — queries evolution_variants (already correct)
- `variantDetailActions.ts` — queries evolution_variants (already correct)
- `evolutionVisualizationActions.ts` — queries evolution_variants (already correct)

### Phase 4: Update UI pages (src/app/admin/evolution/)

**arena/[topicId]/page.tsx:**
- Update field references: `entry.content` → `entry.variant_content`, `entry.elo_rating` → `entry.elo_score`, `entry.match_count` → `entry.arena_match_count`
- Update leaderboard link: `/arena/entries/${id}` → `/variants/${id}`

**arena/entries/[entryId]/page.tsx:**
- Redirect to `/admin/evolution/variants/${entryId}` or rewrite to fetch from evolution_variants

**arena/arenaBudgetFilter.ts:**
- Update `ArenaEntry` import type (field renames)

**arena/page.tsx:**
- Entry count source changes (from arenaActions update)

### Phase 5: Update scripts (evolution/scripts/)

Check deferred scripts in `evolution/scripts/deferred/` — any that insert into `evolution_arena_entries` need updating to insert into `evolution_variants` with appropriate columns.

### Phase 6: Update tests

**5 test files, 35 references:**
- `arenaActions.test.ts` — update mock table name, field names, 8 changes
- `arena.test.ts` — update `.from()` calls, mock data fields, 8 changes
- `arenaBudgetFilter.test.ts` — update ArenaEntry type import, 3 changes
- `admin-arena.spec.ts` — update all seed/cleanup queries, 12 changes (HIGH)
- `admin-strategy-budget.spec.ts` — update seed/cleanup, 4 changes

### Phase 7: Lint, tsc, build, test

```bash
npm run lint && npx tsc --noEmit && npm run build
npm run test && npm run test:integration
```

### Phase 8: Update documentation (10 docs)

- `evolution/docs/evolution/data_model.md` — remove arena_entries as separate table, update variant schema, update data flow
- `evolution/docs/evolution/arena.md` — update schema section (3 tables → 2), update sync description
- `evolution/docs/evolution/entity_diagram.md` — remove arena_entries entity, update ER diagram
- `evolution/docs/evolution/reference.md` — update DB schema table, update RPC signatures
- `evolution/docs/evolution/architecture.md` — update data flow section
- `evolution/docs/evolution/visualization.md` — update arena page descriptions
- `evolution/docs/evolution/rating_and_comparison.md` — note mu/sigma now on variants
- `evolution/docs/evolution/experimental_framework.md` — update if arena_entries referenced
- `evolution/docs/evolution/README.md` — update if needed
- `docs/docs_overall/architecture.md` — update Arena Tables section

## Testing

### Unit Tests (update existing)
- `arenaActions.test.ts` — update mock data to use `variant_content`, `elo_score`, `arena_match_count`
- `arena.test.ts` — verify loadArenaEntries queries `evolution_variants`, syncToArena uses new field names
- `finalize.test.ts` — verify mu/sigma are included in upsert payload
- `arenaBudgetFilter.test.ts` — update ArenaEntry type

### E2E Tests (update existing)
- `admin-arena.spec.ts` — seed data into `evolution_variants` instead of `evolution_arena_entries`
- `admin-strategy-budget.spec.ts` — same

### Integration Tests
- `evolution-run-costs.integration.test.ts` — verify no arena_entries references remain

### Post-deploy Verification (stage)
1. `SELECT * FROM evolution_arena_entries` should fail (table dropped)
2. `SELECT mu, sigma, prompt_id FROM evolution_variants LIMIT 1` should succeed
3. `sync_to_arena` RPC should work with new column names
4. Arena leaderboard page should display data correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` — Remove arena_entries table, document consolidated variant schema with arena columns
- `evolution/docs/evolution/arena.md` — Update schema (2 tables instead of 3), update sync flow description
- `evolution/docs/evolution/entity_diagram.md` — Remove arena_entries entity from ER diagram
- `evolution/docs/evolution/reference.md` — Update DB schema listing, update RPC description
- `evolution/docs/evolution/architecture.md` — Update data flow (arena sync targets variants)
- `evolution/docs/evolution/visualization.md` — Update arena page data sources
- `evolution/docs/evolution/rating_and_comparison.md` — Note mu/sigma now persisted on variants
- `evolution/docs/evolution/experimental_framework.md` — Update if arena_entries referenced
- `evolution/docs/evolution/README.md` — Update if needed
- `docs/docs_overall/architecture.md` — Remove arena_entries from Arena Tables section
