# Admin Panel

## Overview

The admin panel provides content moderation capabilities including user management, content visibility control, and audit logging.

## Key Files

- `src/lib/services/adminContent.ts` - Core admin content management actions
- `src/lib/services/adminAuth.ts` - Admin authentication and authorization
- `src/lib/services/contentReports.ts` - User-submitted content reports
- `src/lib/services/auditLog.ts` - Admin action audit logging
- `src/components/admin/` - Admin UI components

## Two-Stage Soft Delete System

The admin panel uses a two-stage soft delete system for content moderation:

### Delete Status Values

| Status | Meaning | Visibility |
|--------|---------|------------|
| `visible` | Normal, active content | Public |
| `hidden` | Soft-deleted, pending review | Admin only |
| `deleted` | Marked for permanent deletion | Admin only |

### Related Columns

```sql
delete_status          -- 'visible' | 'hidden' | 'deleted'
delete_status_changed_at -- Timestamp of last status change
delete_reason          -- Why the content was hidden/deleted
delete_source          -- 'manual' | 'automated' | 'report'
```

### Admin Actions

**Hide Explanation** (`hideExplanationAction`):
1. Sets `delete_status = 'hidden'`
2. Deletes Pinecone vectors (removes from search)
3. Logs audit action

**Restore Explanation** (`restoreExplanationAction`):
1. Sets `delete_status = 'visible'`
2. Re-creates Pinecone vectors (returns to search)
3. Logs audit action

**Bulk Hide** (`bulkHideExplanationsAction`):
- Hides up to 100 explanations at once
- Deletes vectors for all hidden items

### RLS Policy

Hidden content is protected at the database level:

```sql
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  delete_status = 'visible'
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```

Only admins can see hidden/deleted content.

## Content Reports

Users can report inappropriate content via `createContentReportAction`. Reports include:
- Reason (inappropriate, misinformation, spam, copyright, other)
- Optional details
- Status tracking (pending, reviewed, dismissed, actioned)

Admins resolve reports via `resolveContentReportAction`, optionally hiding the reported content.

## Implementation Notes

- Vector deletion/recreation is non-blocking (failures logged but don't block action)
- All admin actions are logged to the audit table
- Hidden content shows error/empty state when accessed via direct URL
