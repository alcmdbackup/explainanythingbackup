# Metrics & Analytics

## Overview

The metrics system tracks user interactions as raw events, then aggregates them into per-explanation metrics. Background processing ensures scalability without blocking user actions.

## Implementation

### Key Files
- `src/lib/services/metrics.ts` - Core metrics service

### Database Tables

| Table | Purpose |
|-------|---------|
| `userExplanationEvents` | Raw user events (views, interactions) |
| `explanationMetrics` | Aggregated metrics per explanation |
| `userLibrary` | Tracks saved explanations |

### Event Types

| Event | Trigger |
|-------|---------|
| `explanation_viewed` | User views an explanation |
| Custom events | Via `event_name` field |

### Metrics Calculated

| Metric | Calculation |
|--------|-------------|
| `view_count` | Count of view events |
| `save_count` | Count of saves in userLibrary |
| `save_rate` | saves / views ratio |

### Processing Flow

```
User Action → createUserExplanationEvent() → userExplanationEvents table
                        ↓
           (Fire-and-forget background)
                        ↓
           refreshExplanationMetrics() → explanationMetrics table
```

## Usage

### Tracking Events

```typescript
import { createUserExplanationEvent } from '@/lib/services/metrics';

await createUserExplanationEvent({
  explanation_id: explanationId,
  user_id: userId,
  event_name: 'explanation_viewed',
  event_data: { source: 'search' }
});
```

### Incrementing Counters

```typescript
import {
  incrementExplanationViews,
  incrementExplanationSaves
} from '@/lib/services/metrics';

// Increment view count
await incrementExplanationViews(explanationId);

// Increment save count
await incrementExplanationSaves(explanationId);
```

### Refreshing Metrics

```typescript
import { refreshExplanationMetrics } from '@/lib/services/metrics';

// Refresh single explanation
await refreshExplanationMetrics({ explanationId: 'abc-123' });

// Refresh all explanations (batch)
await refreshExplanationMetrics({});
```

### Fetching Metrics

```typescript
import { getMultipleExplanationMetrics } from '@/lib/services/metrics';

const metrics = await getMultipleExplanationMetrics([
  'explanation-1',
  'explanation-2'
]);

// Returns: { [explanationId]: { view_count, save_count, save_rate } }
```

### Server Actions

```typescript
import {
  getExplanationMetricsAction,
  getMultipleExplanationMetricsAction,
  refreshExplanationMetricsAction
} from '@/actions/actions';

// Get metrics for one explanation
const result = await getExplanationMetricsAction(explanationId);

// Get metrics for multiple
const results = await getMultipleExplanationMetricsAction(explanationIds);

// Force refresh
await refreshExplanationMetricsAction(explanationId);
```

### Service Client Usage

The metrics service uses a service client that bypasses RLS, allowing background metric updates without user context:

```typescript
// Internal to metrics.ts
const supabase = createServiceClient();

// Can write metrics for any explanation
await supabase
  .from('explanationMetrics')
  .upsert({ explanation_id, view_count, save_count, save_rate });
```

### Error Handling

```typescript
try {
  await createUserExplanationEvent(eventData);
} catch (error) {
  // Log error but don't block user action
  logger.error('Failed to track event', { error, eventData });
}
```

### Best Practices

1. **Fire-and-forget**: Don't await metric updates in user-facing flows
2. **Batch processing**: Use stored procedures for bulk recalculations
3. **Service client**: Bypass RLS for background operations
4. **Validation**: Use Zod schemas for event and metrics data
5. **Error isolation**: Log metric failures, don't propagate to user
