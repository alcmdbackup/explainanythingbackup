# Two-Stage Soft Delete Design

## Overview

A staged deletion system that balances speed (hide immediately) with safety (recover always). Designed for high-volume automated moderation with high cost of wrong deletions.

## Design Principles

1. **Hide fast, delete slow, recover always** - Content disappears from users immediately but remains recoverable
2. **Delete status separate from publish status** - Restoring preserves original draft/published state
3. **Single table, no archives** - Keep it simple until scale requires otherwise
4. **Audit everything** - Who, when, why for every state change

## State Model

```
Delete Status Lifecycle:

┌─────────┐
│ visible │ (normal state)
└────┬────┘
     ↓ flag/hide (immediate)
┌─────────┐
│ hidden  │ (soft delete, reversible, 1-click restore)
└────┬────┘
     ↓ 30 days OR manual confirm
┌─────────┐
│ deleted │ (archived state, admin restore only)
└────┬────┘
     ↓ 90 days (if no legal hold)
┌─────────┐
│ purged  │ (hard delete, no recovery)
└─────────┘
```

**Key:** `status` (draft/published) is independent of `delete_status`. Restoring content returns it to its original publish state.

## Database Schema

### New Columns on `explanations` Table

```sql
-- Delete lifecycle
ALTER TABLE explanations ADD COLUMN delete_status TEXT DEFAULT 'visible';
  -- Values: 'visible', 'hidden', 'deleted'
  -- Note: 'purged' = row deleted, no value needed

ALTER TABLE explanations ADD COLUMN delete_status_changed_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN delete_reason TEXT;
ALTER TABLE explanations ADD COLUMN delete_source TEXT DEFAULT 'manual';
  -- Values: 'manual', 'automated', 'user_request', 'legal'

-- Moderation review tracking
ALTER TABLE explanations ADD COLUMN moderation_reviewed BOOLEAN DEFAULT FALSE;
ALTER TABLE explanations ADD COLUMN moderation_reviewed_by UUID REFERENCES auth.users;
ALTER TABLE explanations ADD COLUMN moderation_reviewed_at TIMESTAMPTZ;

-- Legal holds
ALTER TABLE explanations ADD COLUMN legal_hold BOOLEAN DEFAULT FALSE;

-- Indexes
CREATE INDEX idx_explanations_delete_status ON explanations(delete_status);
CREATE INDEX idx_explanations_delete_status_changed_at ON explanations(delete_status_changed_at);
```

### Migration from `is_hidden`

```sql
-- Backfill existing data
UPDATE explanations
SET
  delete_status = CASE WHEN is_hidden = true THEN 'hidden' ELSE 'visible' END,
  delete_status_changed_at = COALESCE(hidden_at, NOW()),
  delete_source = 'manual',
  moderation_reviewed = true
WHERE true;

-- Drop old columns (after code migration complete)
ALTER TABLE explanations DROP COLUMN is_hidden;
ALTER TABLE explanations DROP COLUMN hidden_at;
ALTER TABLE explanations DROP COLUMN hidden_by;
```

### Updated RLS Policy

```sql
DROP POLICY IF EXISTS "explanations_select_policy" ON explanations;

CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  delete_status = 'visible'
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```

## Vector Lifecycle

| Transition | Pinecone Action |
|------------|-----------------|
| `visible → hidden` | Delete vectors immediately |
| `hidden → visible` | Re-create vectors |
| `hidden → deleted` | No action (already deleted) |
| `deleted → hidden` | No action (needs review before restore to visible) |

## Operational Workflow

### Permissions Matrix

| Action | Admin | Automated | User |
|--------|-------|-----------|------|
| `visible → hidden` | ✓ | ✓ | Request only |
| `hidden → visible` | ✓ | ✗ | ✗ |
| `hidden → deleted` | ✓ | ✓ (30d) | ✗ |
| `deleted → hidden` | ✓ | ✗ | ✗ |
| `deleted → purged` | ✗ | ✓ (90d) | ✗ |

### Automated Jobs

**1. Moderation Scanner (continuous)**
- AI evaluates content
- Flags violations: `delete_status = 'hidden'`, `delete_source = 'automated'`
- Deletes Pinecone vectors immediately

**2. Deletion Promoter (daily cron)**
```sql
UPDATE explanations
SET delete_status = 'deleted', delete_status_changed_at = NOW()
WHERE delete_status = 'hidden'
  AND delete_status_changed_at < NOW() - INTERVAL '30 days'
  AND legal_hold = false
  AND (delete_source != 'automated' OR moderation_reviewed = true);
```

**3. Purge Job (daily cron)**
```sql
DELETE FROM explanations
WHERE delete_status = 'deleted'
  AND delete_status_changed_at < NOW() - INTERVAL '90 days'
  AND legal_hold = false;
```

## Admin UI: Moderation Queue

```
┌─────────────────────────────────────────────────────────────────┐
│ Content Moderation                          [Filter: All ▾]     │
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ Pending Review (automated flags)                        (23) │
│ 👁️ Hidden (awaiting confirmation)                          (45) │
│ 🗑️ Deleted (in retention period)                           (12) │
├─────────────────────────────────────────────────────────────────┤
│ "Article Title"                                                 │
│ Flagged: 2h ago | Source: Automated | Reason: Policy violation  │
│ Original Status: Published                   ⏰ Auto-delete: 25d│
│ [👁️ Preview] [✅ Confirm Delete] [↩️ Restore] [⏸️ Legal Hold]   │
└─────────────────────────────────────────────────────────────────┘
```

### Key UX Elements

- **Countdown timer**: Days until auto-promotion
- **Original status badge**: Shows draft/published so admin knows restore impact
- **Bulk actions**: Select multiple for batch operations
- **Legal hold**: Prevents any further state changes

## End User Experience

- Hidden/deleted content: 404 page (as if it never existed)
- Optional: Email notification if user's saved content is hidden (with appeal info)

## Code Changes Required

| File | Change |
|------|--------|
| `src/lib/services/explanations.ts` | Filter by `delete_status = 'visible'` |
| `src/lib/services/adminContent.ts` | Use new `delete_status` fields |
| `src/lib/services/moderationQueue.ts` | New service for moderation queue |
| `src/lib/services/deletionJobs.ts` | New cron job handlers |
| `src/app/admin/moderation/` | New moderation queue UI |
| `supabase/migrations/` | Schema changes |

## Testing Strategy

### Unit Tests
- State transitions preserve `status` field
- Vector deletion on hide, re-creation on restore
- Query filtering by `delete_status`

### Integration Tests
- Full lifecycle: create → hide → restore → verify original status
- Direct URL to hidden content returns 404

### Cron Job Tests
- Promotion after 30 days
- Purge after 90 days
- Legal hold prevents both
