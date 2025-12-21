# Aggregate Metrics System

This document explains the aggregate metrics system that consolidates explanation saves and views into a performance tracking table.

## Overview

The system tracks per-explanation metrics including:
- **Total Saves**: Number of times users saved the explanation to their library
- **Total Views**: Number of times users viewed the explanation
- **Save Rate**: Ratio of saves to views (engagement metric)
- **Last Updated**: Timestamp of the last metrics update

## Database Setup

### 1. Run the SQL Setup Script

Execute the SQL commands in `supabase_aggregate_metrics.sql` in your Supabase SQL editor:

```sql
-- This will create:
-- ✅ explanationMetrics table
-- ✅ Stored procedures for efficient calculations
-- ✅ Optional triggers for automatic updates
```

### 2. Table Structure

```sql
CREATE TABLE "explanationMetrics" (
    id SERIAL PRIMARY KEY,
    explanationid INTEGER NOT NULL UNIQUE,
    total_saves INTEGER NOT NULL DEFAULT 0,
    total_views INTEGER NOT NULL DEFAULT 0,
    save_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Key Features

### ✅ Database-Side Calculations
- All metric calculations use PostgreSQL stored procedures
- Efficient batch processing for large datasets
- Handles edge cases (division by zero, missing data)

### ✅ Automatic Updates
- Metrics update automatically when saves/views occur
- Background processing doesn't block user operations
- Error handling with detailed logging

### ✅ Type Safety
- Full TypeScript integration with Zod schemas
- Type-safe database interactions
- Input validation on all operations

## API Reference

### Schema Types

```typescript
type ExplanationMetricsType = {
  id?: number;
  explanationid: number;
  total_saves: number;
  total_views: number;
  save_rate: number; // 0.0 to 1.0
  last_updated: string; // ISO 8601 datetime
}
```

### Service Functions

#### Get Metrics
```typescript
// Get metrics for one explanation
const metrics = await getExplanationMetrics(123);

// Get metrics for multiple explanations
const metrics = await getMultipleExplanationMetrics([1, 2, 3]);
```

#### Refresh Metrics
```typescript
// Refresh one explanation's metrics
const updated = await refreshExplanationMetrics(123);

// Refresh all explanations (batch operation)
const count = await refreshAllExplanationMetrics();
```

#### Increment Operations
```typescript
// These are called automatically by the system
await incrementExplanationViews(123);
await incrementExplanationSaves(123);
```

### Server Actions (for Client Use)

```typescript
// Client-side usage
import { 
  getExplanationMetricsAction,
  getMultipleExplanationMetricsAction,
  refreshExplanationMetricsAction,
  refreshAllExplanationMetricsAction 
} from '@/actions/actions';

// Get metrics in React component
const metrics = await getExplanationMetricsAction(explanationId);

// Refresh metrics (admin operation)
const result = await refreshExplanationMetricsAction(explanationId);
if (result.success) {
  console.log('Refreshed:', result.data);
}
```

## Automatic Integration

### View Tracking
The system automatically updates view metrics when:
- `createUserExplanationEvent()` is called with `event_name: 'explanation_viewed'`
- This happens in `src/app/results/page.tsx` when explanations are loaded

### Save Tracking  
The system automatically updates save metrics when:
- `saveExplanationToLibrary()` is called
- This happens when users save explanations to their personal library

## Usage Examples

### Display Metrics in UI
```typescript
function ExplanationMetrics({ explanationId }: { explanationId: number }) {
  const [metrics, setMetrics] = useState<ExplanationMetricsType | null>(null);

  useEffect(() => {
    getExplanationMetricsAction(explanationId).then(setMetrics);
  }, [explanationId]);

  if (!metrics) return <div>Loading metrics...</div>;

  return (
    <div className="metrics-display">
      <div>👁️ {metrics.total_views} views</div>
      <div>💾 {metrics.total_saves} saves</div>
      <div>📊 {(metrics.save_rate * 100).toFixed(1)}% save rate</div>
    </div>
  );
}
```

### Admin Dashboard Queries
```sql
-- Top performing explanations
SELECT 
    explanationid,
    total_saves,
    total_views,
    save_rate
FROM "explanationMetrics"
WHERE total_views > 10
ORDER BY save_rate DESC, total_saves DESC
LIMIT 10;

-- Engagement analysis
SELECT 
    CASE 
        WHEN save_rate >= 0.1 THEN 'High Engagement (10%+)'
        WHEN save_rate >= 0.05 THEN 'Medium Engagement (5-10%)'
        WHEN save_rate >= 0.01 THEN 'Low Engagement (1-5%)'
        ELSE 'Very Low Engagement (<1%)'
    END as engagement_tier,
    COUNT(*) as explanation_count,
    AVG(save_rate) as avg_save_rate
FROM "explanationMetrics"
WHERE total_views > 0
GROUP BY engagement_tier
ORDER BY avg_save_rate DESC;
```

## Stored Procedures

The system includes these PostgreSQL functions:

### `refresh_explanation_metrics(explanation_id)`
- Recalculates all metrics for a specific explanation
- Combines data from `userLibrary` and `userExplanationEvents` tables
- Returns updated metrics record

### `refresh_all_explanation_metrics()`
- Batch processes all explanations
- Returns count of processed explanations
- Use for maintenance or initial setup

### `increment_explanation_views(explanation_id)`
- Efficiently increments view count by 1
- Recalculates save rate with new view count
- Used by automatic view tracking

### `increment_explanation_saves(explanation_id)`
- Efficiently increments save count by 1
- Recalculates save rate with new save count
- Used by automatic save tracking

## Performance Considerations

### Efficient Updates
- Increment functions only update necessary fields
- Background processing prevents user interface blocking
- Database indexes on `explanationid` and `last_updated`

### Error Handling
- All operations include comprehensive error logging
- Failed metric updates don't affect primary operations
- Graceful degradation if metrics system is unavailable

### Scalability
- Stored procedures minimize round trips to database
- Batch operations for large datasets
- Optional triggers can be disabled for manual control

## Monitoring & Maintenance

### Health Checks
```typescript
// Check if metrics are up to date
const oldMetrics = await supabase
  .from('explanationMetrics')
  .select('explanationid, last_updated')
  .lt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

if (oldMetrics.data?.length > 0) {
  console.log('Stale metrics found:', oldMetrics.data.length);
  await refreshAllExplanationMetricsAction();
}
```

### Cleanup Orphaned Records
```sql
-- Remove metrics for deleted explanations
DELETE FROM "explanationMetrics" 
WHERE explanationid NOT IN (
  SELECT DISTINCT id FROM explanations
);
```

## Troubleshooting

### Common Issues

**Q: Metrics show 0 even though I know there are saves/views**
- Run `SELECT refresh_explanation_metrics(YOUR_ID);` to recalculate
- Check that the source tables (`userLibrary`, `userExplanationEvents`) have data

**Q: Save rate calculation seems wrong**
- Verify view events use `event_name = 'explanation_viewed'`
- Check for duplicate events that might inflate view counts

**Q: Automatic updates not working**
- Ensure the trigger functions are installed
- Check error logs in the metrics service functions
- Verify database permissions for the stored procedures

### Debug Queries
```sql
-- Check raw data for an explanation
SELECT 
  (SELECT COUNT(*) FROM "userLibrary" WHERE explanationid = 123) as saves,
  (SELECT SUM(value) FROM "userExplanationEvents" WHERE explanationid = 123 AND event_name = 'explanation_viewed') as views;

-- Verify stored procedure works
SELECT * FROM refresh_explanation_metrics(123);
```

## Future Enhancements

Potential additions to the metrics system:
- User-level aggregations (total saves per user)
- Time-based metrics (views per day/week/month)
- Topic-level aggregations
- Engagement trends over time
- A/B testing metrics integration