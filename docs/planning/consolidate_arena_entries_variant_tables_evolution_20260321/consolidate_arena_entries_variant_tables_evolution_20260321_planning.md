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
**Cons:** arena_entries is the secondary concept; variants are the primary entity. Would require renaming more code references (30+ elo_score refs vs 15-20 elo_rating refs).

### Option C: Keep separate tables, add FK (Rejected)
**Cons:** Doesn't eliminate content duplication, still requires dual queries, doesn't simplify data model.

**Decision:** Option A — merge arena_entries into variants. Both tables are empty on staging, so migration is zero-risk.

## CRITICAL Design Decisions

### prompt_id Semantics
`evolution_variants.prompt_id` means **"this variant is in the arena"** — NOT "this variant came from a prompt-based run." Set ONLY by `sync_to_arena` RPC, never by `finalize.ts`. This enables `loadArenaEntries()` to correctly filter arena-synced variants via `WHERE prompt_id = ? AND archived_at IS NULL`.

If finalize.ts set prompt_id, then loadArenaEntries would incorrectly return ALL variants from ALL runs targeting that prompt, not just arena-published ones. The in-memory `fromArena` flag on TextVariation handles pipeline filtering during execution.

### Dual match_count columns
- `match_count` — within-run comparisons (immutable after finalize, set by finalize.ts)
- `arena_match_count` — cross-run arena comparisons (incremented by sync_to_arena RPC)

### Column naming
- Keep `elo_score` (30+ refs, unified name for display Elo)
- Keep `variant_content` (27 refs, variant-centric naming)
- Drop `elo_rating` (arena name — replaced by elo_score)
- Drop `variant_id` (orphaned, never populated)

## Phased Execution Plan

### Phase 1: Migration SQL

Create `supabase/migrations/20260321000001_consolidate_arena_into_variants.sql`:

```sql
-- Consolidate evolution_arena_entries into evolution_variants.
-- Both tables are empty on staging — zero data migration risk.
-- Rollback: see Rollback Strategy section at end of this plan.

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
  elo_score = COALESCE(eae.elo_rating, ev.elo_score),
  arena_match_count = eae.match_count,
  generation_method = eae.generation_method,
  model = eae.model,
  cost_usd = eae.cost_usd,
  archived_at = eae.archived_at,
  evolution_explanation_id = eae.evolution_explanation_id
FROM evolution_arena_entries eae
WHERE ev.id = eae.id;

-- Insert non-pipeline arena entries (oneshot, manual) that have no matching variant
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
--    Uses INSERT ON CONFLICT to handle both new and existing variants.
--    New variants (from oneshot/manual) get full INSERT.
--    Existing variants (from pipeline finalize) get arena fields UPDATE.
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

  -- Upsert entries: INSERT for new variants, UPDATE arena fields for existing
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method
    )
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      p_run_id,
      COALESCE(entry->>'variant_content', ''),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'elo_score')::NUMERIC, 1200),
      0,
      COALESCE(entry->>'generation_method', 'pipeline')
    )
    ON CONFLICT (id) DO UPDATE SET
      prompt_id = p_prompt_id,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
  END LOOP;

  -- Insert match results.
  -- Note: plpgsql functions run in an implicit transaction — if any INSERT fails
  -- (e.g., FK violation from orphaned entry_a/entry_b), the entire function rolls back
  -- atomically. The caller receives an exception with the FK violation details.
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

-- ═══════════════════════════════════════════════════════════════
-- 10. VERIFY and ENFORCE RLS policies on evolution_variants
--     ALTER TABLE ADD COLUMN preserves existing RLS policies.
--     Explicitly recreate if missing (idempotent — CREATE IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_variants' AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON evolution_variants FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_variants' AND policyname = 'readonly_select') THEN
    CREATE POLICY readonly_select ON evolution_variants FOR SELECT TO service_role USING (true);
  END IF;
END $$;
```

### Phase 2: Update pipeline code (evolution/src/lib/pipeline/)

**finalize.ts — add mu/sigma to variant upsert (lines 148-165):**
```typescript
// BEFORE:
const variantRows = localPool.map((v) => {
  const mu = result.ratings.get(v.id)?.mu;
  return {
    id: v.id, run_id: runId, explanation_id: run.explanation_id ?? null,
    variant_content: v.text,
    elo_score: toEloScale(mu ?? DEFAULT_MU),
    generation: v.version, parent_variant_id: v.parentIds[0] ?? null,
    agent_name: v.strategy, match_count: result.matchCounts[v.id] ?? 0,
    is_winner: v.id === winnerId,
  };
});

// AFTER:
import { toEloScale, DEFAULT_MU, DEFAULT_SIGMA } from '../shared/rating';
// ...
const variantRows = localPool.map((v) => {
  const rating = result.ratings.get(v.id);
  const mu = rating?.mu ?? DEFAULT_MU;
  const sigma = rating?.sigma ?? DEFAULT_SIGMA;
  return {
    id: v.id, run_id: runId, explanation_id: run.explanation_id ?? null,
    variant_content: v.text,
    elo_score: toEloScale(mu),
    mu, sigma,
    generation: v.version, parent_variant_id: v.parentIds[0] ?? null,
    agent_name: v.strategy, match_count: result.matchCounts[v.id] ?? 0,
    is_winner: v.id === winnerId,
    // prompt_id deliberately NOT set here — sync_to_arena sets it
  };
});
```

**arena.ts — loadArenaEntries (lines 29-64):**
```typescript
// BEFORE:
const { data, error } = await supabase
  .from('evolution_arena_entries')
  .select('id, content, elo_rating, mu, sigma, match_count, generation_method')
  .eq('prompt_id', promptId)
  .is('archived_at', null);
// ... entry.content → v.text

// AFTER:
const { data, error } = await supabase
  .from('evolution_variants')
  .select('id, variant_content, mu, sigma, arena_match_count, generation_method')
  .eq('prompt_id', promptId)
  .is('archived_at', null);
// ... entry.variant_content → v.text
```

**arena.ts — syncToArena (lines 72-114):**
```typescript
// BEFORE:
const newEntries = pool.filter((v) => !isArenaEntry(v)).map((v) => {
  const r = ratings.get(v.id);
  return {
    id: v.id, content: v.text,
    elo_rating: r ? toEloScale(r.mu) : 1200,
    mu: r?.mu ?? 25, sigma: r?.sigma ?? 8.333,
    match_count: 0, generation_method: 'pipeline',
  };
});

// AFTER:
const newEntries = pool.filter((v) => !isArenaEntry(v)).map((v) => {
  const r = ratings.get(v.id);
  return {
    id: v.id, variant_content: v.text,
    elo_score: r ? toEloScale(r.mu) : 1200,
    mu: r?.mu ?? 25, sigma: r?.sigma ?? 8.333,
    arena_match_count: 0, generation_method: 'pipeline',
  };
});
```

### Phase 3: Update services (evolution/src/services/)

**arenaActions.ts — ArenaEntry interface (lines 20-35):**
```typescript
// BEFORE:
export interface ArenaEntry {
  id: string; prompt_id: string; run_id: string | null;
  variant_id: string | null; content: string;
  generation_method: string; model: string | null; cost_usd: number | null;
  elo_rating: number; mu: number; sigma: number;
  match_count: number; archived_at: string | null; created_at: string;
}

// AFTER:
export interface ArenaEntry {
  id: string; prompt_id: string; run_id: string | null;
  variant_content: string;
  generation_method: string; model: string | null; cost_usd: number | null;
  elo_score: number; mu: number; sigma: number;
  arena_match_count: number; archived_at: string | null; created_at: string;
}
```

**arenaActions.ts — getArenaEntriesAction (line 139):**
```typescript
// BEFORE: .from('evolution_arena_entries').select('*').eq('prompt_id', ...).order('elo_rating', ...)
// AFTER:  .from('evolution_variants').select('*').eq('prompt_id', ...).not('prompt_id', 'is', null).order('elo_score', ...)
```

**arenaActions.ts — getArenaEntryDetailAction (line 157):**
```typescript
// BEFORE: .from('evolution_arena_entries').select('*').eq('id', ...).single()
// AFTER:  .from('evolution_variants').select('*').eq('id', ...).single()
```

**arenaActions.ts — getArenaTopicsAction entry count (line 80):**
```typescript
// BEFORE: .from('evolution_arena_entries').select('prompt_id').in(...)
// AFTER:  .from('evolution_variants').select('prompt_id').not('prompt_id', 'is', null).in(...)
```

### Phase 4: Update UI pages (src/app/admin/evolution/)

**arena/[topicId]/page.tsx:**
- `entry.content` → `entry.variant_content`
- `entry.elo_rating` → `entry.elo_score`
- `entry.match_count` → `entry.arena_match_count`
- Link: `/arena/entries/${id}` → `/variants/${id}`
- Update comment at top of file

**arena/entries/[entryId]/page.tsx:**
- Replace with redirect: `redirect(\`/admin/evolution/variants/${params.entryId}\`)` using Next.js `redirect()` from `next/navigation`
- Remove fetch logic — variant detail page already displays all needed data

**arena/arenaBudgetFilter.ts:**
- Update `ArenaEntry` type reference (field renames propagate from interface)

### Phase 5: Update scripts (evolution/scripts/)

Check `evolution/scripts/deferred/` for any scripts inserting into `evolution_arena_entries`. Update to use `evolution_variants` with prompt_id + generation_method.

### Phase 6: Update tests

**arenaActions.test.ts (8 changes):**
- Update MOCK_ENTRY: `content` → `variant_content`, `elo_rating` → `elo_score`, `match_count` → `arena_match_count`, remove `variant_id`
- Update `.from('evolution_arena_entries')` mock chain references → `.from('evolution_variants')`
- Update assertions checking field values

**arena.test.ts (8 changes):**
- Update `.from('evolution_arena_entries')` → `.from('evolution_variants')` in mock chain assertions
- Update mock entry objects: `content` → `variant_content`, `elo_rating` → `elo_score`, `match_count` → `arena_match_count`
- Update RPC parameter assertions for sync_to_arena

**finalize.test.ts (3 changes):**
- Add assertions for mu and sigma in upsert payload:
  ```typescript
  expect(rows[0]).toHaveProperty('mu');
  expect(rows[0]).toHaveProperty('sigma');
  expect(rows[0].mu).toBe(DEFAULT_MU); // baseline variant
  expect(rows[0].sigma).toBe(DEFAULT_SIGMA);
  ```
- Verify prompt_id is NOT included in finalize upsert

**arenaBudgetFilter.test.ts (3 changes):**
- Update makeEntry() helper: `content` → `variant_content`, `elo_rating` → `elo_score`, `match_count` → `arena_match_count`, remove `variant_id`

**admin-arena.spec.ts (12 changes — HIGH):**
- Update all `.from('evolution_arena_entries')` → `.from('evolution_variants')`
- Update seedArenaData() inserts: `content` → `variant_content`, `elo_rating` → `elo_score`, `match_count` → `arena_match_count`, add `prompt_id` explicitly
- Update cleanup `.delete()` to target `evolution_variants` with prompt_id filter
- Remove `variant_id` from all seed data

**admin-strategy-budget.spec.ts (4 changes):**
- Same pattern as admin-arena.spec.ts

### Phase 7: Lint, tsc, build, test

```bash
npm run lint && npx tsc --noEmit && npm run build
npm run test && npm run test:integration
```

### Phase 8: Update documentation (10 docs)

- `evolution/docs/evolution/data_model.md` — remove arena_entries table, update variant schema with arena columns, update data flow
- `evolution/docs/evolution/arena.md` — update schema (2 tables instead of 3), update sync description to target variants
- `evolution/docs/evolution/entity_diagram.md` — remove arena_entries entity from ER diagram
- `evolution/docs/evolution/reference.md` — update DB schema table, update RPC signatures
- `evolution/docs/evolution/architecture.md` — update data flow (sync targets variants)
- `evolution/docs/evolution/visualization.md` — update arena page descriptions
- `evolution/docs/evolution/rating_and_comparison.md` — note mu/sigma now on variants
- `evolution/docs/evolution/experimental_framework.md` — update if arena_entries referenced
- `evolution/docs/evolution/README.md` — update if needed
- `docs/docs_overall/architecture.md` — remove arena_entries from Arena Tables section

## Testing

### Unit Tests (update existing)
- `arenaActions.test.ts` — update mock data: `variant_content`, `elo_score`, `arena_match_count`; update table mock chain
- `arena.test.ts` — verify loadArenaEntries queries `evolution_variants`; verify syncToArena uses new field names; update RPC mock assertions
- `finalize.test.ts` — add assertions: mu/sigma present in upsert payload; verify prompt_id NOT present
- `arenaBudgetFilter.test.ts` — update ArenaEntry mock helper fields

### E2E Tests (update existing)
- `admin-arena.spec.ts` — seed data into `evolution_variants` with prompt_id; update all field names; update cleanup queries
- `admin-strategy-budget.spec.ts` — same seeding changes

### Integration Tests
- `evolution-run-costs.integration.test.ts` — verify no arena_entries references remain

### Post-deploy Verification (stage)
1. `SELECT * FROM evolution_arena_entries` should fail (table dropped)
2. `SELECT mu, sigma, prompt_id FROM evolution_variants LIMIT 1` should succeed
3. `sync_to_arena` RPC should work with new INSERT ON CONFLICT
4. Arena leaderboard page should display data correctly

## Deploy Ordering

Code and migration deploy atomically (same merge to main). The migration applies via supabase-migrations.yml, Vercel deploys from the same push. Since E2E tests seed directly into DB tables, they will fail in CI until the migration is applied.

**Pre-merge migration trigger (exact command):**
```bash
gh workflow run "Deploy Supabase Migrations" \
  --ref feat/consolidate_arena_entries_variant_tables_evolution_20260321 \
  -f environment=staging
```

Wait for migration to succeed, then re-run failed CI checks:
```bash
gh run rerun <run-id> --failed
```

**E2E test seeding note:** After migration, E2E tests seed directly into `evolution_variants` with `prompt_id` set explicitly (for arena entries) or `prompt_id = NULL` (for run-only variants). Oneshot test entries set `prompt_id = topicId` since they simulate arena-published content.

## Rollback Strategy

**If migration fails mid-transaction:** PostgreSQL auto-rolls back. No manual intervention.

**If code deploy has issues after migration succeeds:** Create a rollback migration file and trigger deployment:
```bash
gh workflow run "Deploy Supabase Migrations" --ref <rollback-branch> -f environment=staging
```
Reverse migration SQL:
```sql
-- Recreate evolution_arena_entries from evolution_variants
CREATE TABLE evolution_arena_entries (
  id UUID PRIMARY KEY, prompt_id UUID NOT NULL REFERENCES evolution_prompts(id) ON DELETE CASCADE,
  run_id UUID REFERENCES evolution_runs(id) ON DELETE SET NULL, variant_id UUID,
  content TEXT NOT NULL, generation_method TEXT NOT NULL DEFAULT 'pipeline',
  model TEXT, cost_usd NUMERIC, elo_rating NUMERIC NOT NULL DEFAULT 1200,
  mu NUMERIC NOT NULL DEFAULT 25, sigma NUMERIC NOT NULL DEFAULT 8.333,
  match_count INT NOT NULL DEFAULT 0, archived_at TIMESTAMPTZ,
  evolution_explanation_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Backfill from variants WHERE prompt_id IS NOT NULL
INSERT INTO evolution_arena_entries (id, prompt_id, run_id, content, generation_method, model, cost_usd, elo_rating, mu, sigma, match_count, archived_at, evolution_explanation_id, created_at)
SELECT id, prompt_id, run_id, variant_content, generation_method, model, cost_usd, elo_score, mu, sigma, arena_match_count, archived_at, evolution_explanation_id, created_at
FROM evolution_variants WHERE prompt_id IS NOT NULL;
-- Retarget FKs back
ALTER TABLE evolution_arena_comparisons DROP CONSTRAINT evolution_arena_comparisons_entry_a_fkey, DROP CONSTRAINT evolution_arena_comparisons_entry_b_fkey;
ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey FOREIGN KEY (entry_a) REFERENCES evolution_arena_entries(id) ON DELETE CASCADE;
ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey FOREIGN KEY (entry_b) REFERENCES evolution_arena_entries(id) ON DELETE CASCADE;
-- Drop arena columns from variants
ALTER TABLE evolution_variants DROP COLUMN prompt_id, DROP COLUMN mu, DROP COLUMN sigma, DROP COLUMN arena_match_count, DROP COLUMN generation_method, DROP COLUMN model, DROP COLUMN cost_usd, DROP COLUMN archived_at, DROP COLUMN evolution_explanation_id;
-- Recreate sync_to_arena RPC targeting evolution_arena_entries (copy from 20260320000001)
```

**Note:** Both tables are empty on staging. Rollback data loss is zero.

## Documentation Updates
- `evolution/docs/evolution/data_model.md` — Remove arena_entries table, document consolidated variant schema
- `evolution/docs/evolution/arena.md` — Update schema (2 tables instead of 3), update sync flow
- `evolution/docs/evolution/entity_diagram.md` — Remove arena_entries from ER diagram
- `evolution/docs/evolution/reference.md` — Update DB schema listing, RPC description
- `evolution/docs/evolution/architecture.md` — Update data flow (sync targets variants)
- `evolution/docs/evolution/visualization.md` — Update arena page data sources
- `evolution/docs/evolution/rating_and_comparison.md` — Note mu/sigma on variants
- `evolution/docs/evolution/experimental_framework.md` — Update if referenced
- `evolution/docs/evolution/README.md` — Update if needed
- `docs/docs_overall/architecture.md` — Remove arena_entries from Arena Tables section
