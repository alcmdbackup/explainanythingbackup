# Admin Panel

## Overview

The admin panel provides content moderation capabilities including user management, content visibility control, and audit logging.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/admin/layout.tsx` | Admin layout with auth check and sidebar |
| `src/app/admin/content/page.tsx` | Main content page, manages modal state |
| `src/components/admin/ExplanationTable.tsx` | Table with filtering, sorting, pagination, bulk actions |
| `src/components/admin/ExplanationDetailModal.tsx` | Modal for viewing/managing single explanation |
| `src/lib/services/adminContent.ts` | Server actions for admin CRUD operations |
| `src/lib/services/adminAuth.ts` | Admin authentication and authorization |
| `src/lib/services/contentReports.ts` | User-submitted content reports |
| `src/lib/services/auditLog.ts` | Admin action audit logging |

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

### RLS Policy

Hidden content is protected at the database level:

```sql
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  delete_status = 'visible'
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```

Only admins can see hidden/deleted content.

## Content Table UI

The `ExplanationTable` component displays explanations with:

**Columns:**
1. Checkbox (bulk selection)
2. ID (sortable)
3. Title (sortable, opens detail modal)
4. Link (external link to view explanation)
5. Status (published/draft badge)
6. Created (sortable date)
7. Delete Status (visible/hidden/deleted indicator)
8. Actions (View, Hide/Restore)

**Filters:**
- Search text (searches title and content)
- Status dropdown (All/Draft/Published)
- Show hidden checkbox (include/exclude hidden explanations)
- Filter test content checkbox (hides articles with [TEST] in title, default: checked)

**Server-Side Filtering:**

```typescript
interface AdminExplanationFilters {
  search?: string;
  status?: string;
  showHidden?: boolean;
  filterTestContent?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'title' | 'id';
  sortOrder?: 'asc' | 'desc';
}
```

### Detail Modal

The `ExplanationDetailModal` uses a light theme (white background) for readability:
- Header: Title, ID, status, delete status indicator
- Metadata grid: Created date, topic IDs, status changed info
- Summary section
- Content preview (monospace, scrollable)
- Footer: Public page link, Close, Hide/Restore buttons

### Status Badges

High-contrast badges for readability:
- Published: `bg-green-800 text-green-100`
- Draft: `bg-orange-800 text-orange-100`

## Admin Actions

| Action | Service Function | Description |
|--------|-----------------|-------------|
| Get list | `getAdminExplanationsAction` | Paginated list with filters |
| Get one | `getAdminExplanationByIdAction` | Single explanation by ID |
| Hide | `hideExplanationAction` | Sets `delete_status = 'hidden'`, removes from search |
| Restore | `restoreExplanationAction` | Sets `delete_status = 'visible'`, re-indexes for search |
| Bulk hide | `bulkHideExplanationsAction` | Hide multiple (max 100) |

All admin actions are logged to the audit log via `logAdminAction()`.

## Content Reports

Users can report inappropriate content via `createContentReportAction`. Reports include:
- Reason (inappropriate, misinformation, spam, copyright, other)
- Optional details
- Status tracking (pending, reviewed, dismissed, actioned)

Admins resolve reports via `resolveContentReportAction`, optionally hiding the reported content.

## Routes

- `/admin` - Dashboard (redirects to content)
- `/admin/content` - Content management table
- `/admin/users` - User management (if implemented)
- `/admin/settings` - System settings (if implemented)

## Implementation Notes

- Vector deletion/recreation is non-blocking (failures logged but don't block action)
- All admin actions are logged to the audit table
- Hidden content shows error/empty state when accessed via direct URL
