# Plan: Reddit-style Discovery Modes for Explore Tab

## Summary
Add "New" and "Top" discovery modes to the `/explanations` page with horizontal tabs UI, similar to Reddit. Include time period filtering for Top mode (Today/Week/Month/All). Document "Hot" algorithm for future implementation.

## Reference
- Reddit r/nfl screenshots in `/reference_images/`
- Existing metrics: `total_views`, `total_saves`, `save_rate` in `explanationMetrics` table

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/schemas/schemas.ts` | Add `SortMode`, `TimePeriod` types |
| `src/lib/services/explanations.ts` | Add `getExplanationsWithSort()` function |
| `src/app/explanations/page.tsx` | Read searchParams, pass to service |
| `src/components/ExplanationsTablePage.tsx` | Add ExploreTabs, handle URL sync |
| `src/components/ExploreTabs.tsx` | **NEW** - Tab bar + time dropdown |

---

## Implementation Steps

### Step 1: Add Types (`schemas.ts`)
```typescript
export type SortMode = 'new' | 'top';
export type TimePeriod = 'today' | 'week' | 'month' | 'all';
```

### Step 2: Add Service Function (`explanations.ts`)
```typescript
export async function getExplanationsWithSort(options: {
  sort: SortMode;
  period?: TimePeriod;
  limit?: number;
  offset?: number;
}): Promise<ExplanationFullDbType[]>
```

**Query logic:**
- **New**: `ORDER BY timestamp DESC`
- **Top**: JOIN with `explanationMetrics`, filter by time period, `ORDER BY total_views DESC`

Time period filters:
- today: `timestamp >= NOW() - INTERVAL '1 day'`
- week: `timestamp >= NOW() - INTERVAL '7 days'`
- month: `timestamp >= NOW() - INTERVAL '30 days'`
- all: no filter

### Step 3: Create ExploreTabs Component
```
src/components/ExploreTabs.tsx
```
- Horizontal tabs: New | Top
- When Top selected: show period dropdown (Today/Week/Month/All)
- Use existing `Select` component from `src/components/ui/select.tsx`
- Match Midnight Scholar theme (`--accent-gold`, `--border-default`)

### Step 4: Update Page (`explanations/page.tsx`)
```typescript
export default async function ExplanationsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; t?: string }>;
}) {
  const params = await searchParams;
  const sort = (params.sort as SortMode) || 'new';
  const period = (params.t as TimePeriod) || 'all';

  const explanations = await getExplanationsWithSort({ sort, period, limit: 20 });
  // ...
}
```

### Step 5: Update ExplanationsTablePage
- Accept `sort` and `period` props
- Render `ExploreTabs` above table
- Use `useRouter` + `useSearchParams` to update URL on tab change
- Remove client-side date sorting (server handles it now)

---

## URL Structure
```
/explanations              → Default: New
/explanations?sort=new     → New (chronological)
/explanations?sort=top     → Top (all time)
/explanations?sort=top&t=today   → Top today
/explanations?sort=top&t=week    → Top this week
/explanations?sort=top&t=month   → Top this month
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
1. Unit test `getExplanationsWithSort()` with various sort/period combos
2. Component test `ExploreTabs` for tab switching and URL params
3. E2E test: navigate to `/explanations?sort=top&t=week`, verify results

---

## Sequence
1. Add types to schemas.ts
2. Add `getExplanationsWithSort()` to explanations.ts + test
3. Create `ExploreTabs.tsx` component
4. Update `ExplanationsTablePage.tsx` to integrate tabs
5. Update `explanations/page.tsx` to read searchParams
6. Run lint, build, tests
