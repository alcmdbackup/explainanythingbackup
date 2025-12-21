# Revised Plan: Reddit-style Discovery Modes for Explore Tab

## Summary
Add "New" and "Top" discovery modes to `/explanations` page with time filtering. "Top" shows explanations with most views **during** the selected period (Option B semantics - like Reddit).

## Reference
- Reddit r/nfl screenshots in `/reference_images/`
- Existing metrics: `total_views`, `total_saves`, `save_rate` in `explanationMetrics` table

## Issues Addressed from Original Plan
1. **DB column name**: Use `explanationid` (not `explanation_id`)
2. **Sparse metrics**: LEFT JOIN + COALESCE for missing metrics (218 vs 1100 rows)
3. **Time semantics**: Option B - count views during period (requires migration)
4. **Code reuse**: Extend `getRecentExplanations()` instead of new function
5. **Correct sequence**: Server component first, then client component

---

## Phase 1: Database Migration

### Migration 1: Add timestamp to userExplanationEvents
```sql
ALTER TABLE "userExplanationEvents"
ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows with approximate timestamp based on ID
UPDATE "userExplanationEvents"
SET created_at = NOW() - (interval '1 minute' * (
  (SELECT MAX(id) FROM "userExplanationEvents") - id
));

CREATE INDEX idx_user_explanation_events_created_at
ON "userExplanationEvents" (created_at);

CREATE INDEX idx_user_explanation_events_name_created
ON "userExplanationEvents" (event_name, created_at);
```

---

## Phase 2: Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_events_timestamp.sql` | **NEW** - Add created_at column |
| `src/lib/schemas/schemas.ts` | Add `SortMode`, `TimePeriod` types; fix `explanation_id` → `explanationid` |
| `src/lib/services/explanations.ts` | Extend `getRecentExplanations()` with sort/period params |
| `src/app/explanations/page.tsx` | Read searchParams, pass to service |
| `src/components/ExploreTabs.tsx` | **NEW** - Tab bar + time dropdown |
| `src/components/ExplanationsTablePage.tsx` | Add ExploreTabs, receive sort/period props |

---

## Phase 3: Implementation Steps

### Step 1: Add Types (`schemas.ts`)
```typescript
export type SortMode = 'new' | 'top';
export type TimePeriod = 'today' | 'week' | 'month' | 'all';
```

Also fix existing schema:
```typescript
// Change explanation_id to explanationid in explanationMetricsSchema
explanationid: z.number().int().positive(),  // was explanation_id
```

### Step 2: Extend Service Function (`explanations.ts`)
Extend existing `getRecentExplanations()`:
```typescript
export async function getRecentExplanations(
  limit: number = 10,
  offset: number = 0,
  options?: {
    sort?: SortMode;      // 'new' | 'top', default 'new'
    period?: TimePeriod;  // 'today' | 'week' | 'month' | 'all'
  }
): Promise<ExplanationFullDbType[]>
```

**Query logic for sort='top':**
```sql
SELECT e.*, COALESCE(view_counts.views, 0) as period_views
FROM explanations e
LEFT JOIN (
  SELECT explanationid, COUNT(*) as views
  FROM "userExplanationEvents"
  WHERE event_name = 'explanation_viewed'
    AND created_at >= NOW() - INTERVAL '7 days'  -- varies by period
  GROUP BY explanationid
) view_counts ON view_counts.explanationid = e.id
WHERE e.status = 'published'
ORDER BY period_views DESC, e.timestamp DESC
LIMIT $limit OFFSET $offset
```

Time intervals:
- today: `INTERVAL '1 day'`
- week: `INTERVAL '7 days'`
- month: `INTERVAL '30 days'`
- all: no filter on created_at

### Step 3: Update Page Server Component (`explanations/page.tsx`)
```typescript
export default async function ExplanationsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; t?: string }>;
}) {
  const params = await searchParams;
  const sort = (params.sort as SortMode) || 'new';
  const period = (params.t as TimePeriod) || 'week';

  const explanations = await getRecentExplanations(20, 0, { sort, period });

  return (
    <ExplanationsTablePage
      explanations={explanations}
      error={null}
      sort={sort}
      period={period}
    />
  );
}
```

### Step 4: Create ExploreTabs Component
```
src/components/ExploreTabs.tsx
```
- Horizontal tabs: New | Top
- When Top selected: show period dropdown (Today/Week/Month/All)
- Use `useRouter` + `useSearchParams` for URL sync
- Use existing `Select` component from `src/components/ui/select.tsx`
- Match Midnight Scholar theme (`--accent-gold`, `--border-default`)

### Step 5: Update ExplanationsTablePage
- Accept `sort` and `period` props
- Render `ExploreTabs` above table header
- Remove client-side date sorting when server handles it

---

## URL Structure
```
/explanations              → Default: New
/explanations?sort=new     → New (chronological)
/explanations?sort=top     → Top this week (default period)
/explanations?sort=top&t=today   → Top today
/explanations?sort=top&t=week    → Top this week
/explanations?sort=top&t=month   → Top this month
/explanations?sort=top&t=all     → Top all time
```

---

## Hot Algorithm (Future Reference)

**Reddit's formula:**
```
score = log10(max(|ups - downs|, 1))
seconds = epoch_seconds - 1134028003
hot_score = order * score + seconds / 45000
```

**Proposed adaptation for ExplainAnything:**
```
hot_score = (
  (total_views * 1) +
  (total_saves * 5) +
  (save_rate * 100)
) * decay_factor

decay_factor = 1 / (hours_since_creation + 2)^1.5
```

**Future work:**
- Add `hot_score` column to `explanationMetrics`
- Create stored procedure to calculate/update scores
- Add "Hot" tab to UI

---

## Testing Plan
1. Migration test: Verify created_at column exists and indexes work
2. Unit test: `getRecentExplanations()` with sort='top' and various periods
3. Component test: ExploreTabs URL param handling
4. E2E: Navigate to `/explanations?sort=top&t=week`, verify order

---

## Implementation Sequence
1. Create and apply migration (add created_at to userExplanationEvents)
2. Update schemas.ts (add types, fix explanationid)
3. Extend getRecentExplanations() in explanations.ts + write tests
4. Update explanations/page.tsx to read searchParams
5. Create ExploreTabs.tsx component
6. Update ExplanationsTablePage.tsx to integrate tabs
7. Run lint, build, all tests
