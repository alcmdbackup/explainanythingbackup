# Admin Panel

## Overview

The admin panel provides content moderation capabilities including user management, content visibility control, audit logging, and link whitelist management. It features comprehensive E2E test coverage, accessibility support with focus traps and ARIA attributes, and toast notifications for user feedback.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/admin/layout.tsx` | Admin layout with auth check and sidebar |
| `src/app/admin/content/page.tsx` | Main content page, manages modal state |
| `src/components/admin/ExplanationTable.tsx` | Table with filtering, sorting, pagination, bulk actions |
| `src/components/admin/ExplanationDetailModal.tsx` | Modal for viewing/managing single explanation |
| `src/components/admin/AdminSidebar.tsx` | Navigation sidebar with links to all admin sections |
| `src/components/admin/AdminLayoutClient.tsx` | Client wrapper that provides Toaster component |
| `src/components/admin/ReportsTable.tsx` | User reports management table |
| `src/components/admin/UserDetailModal.tsx` | Modal for user details, notes, and account actions |
| `src/components/admin/WhitelistContent.tsx` | Whitelist terms management with aliases |
| `src/components/admin/CandidatesContent.tsx` | Link candidates approval workflow |
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
- `/admin/users` - User management
- `/admin/reports` - Content reports management
- `/admin/whitelist` - Whitelist and candidates tabs
- `/admin/settings` - System settings

## Implementation Notes

- Vector deletion/recreation is non-blocking (failures logged but don't block action)
- All admin actions are logged to the audit table
- Hidden content shows error/empty state when accessed via direct URL

## Accessibility Features

### Focus Trap
All modals use `focus-trap-react` to keep keyboard focus within the modal:
```tsx
import FocusTrap from 'focus-trap-react';

<FocusTrap>
  <div role="dialog" aria-modal="true" aria-labelledby={titleId}>
    {/* Modal content */}
  </div>
</FocusTrap>
```

### ARIA Attributes
Modals include proper ARIA attributes for screen readers:
- `role="dialog"` - Identifies as dialog
- `aria-modal="true"` - Indicates modal behavior
- `aria-labelledby={titleId}` - Links to title via `useId()` hook
- `aria-label="Close modal"` - Labels close buttons

## Toast Notifications

Uses Sonner for lightweight toast notifications:
```tsx
import { toast } from 'sonner';

// Success feedback
toast.success('User account disabled successfully');

// Included in AdminLayoutClient via <Toaster /> component
```

## data-testid Conventions

All interactive elements include `data-testid` attributes following this pattern:
```
admin-{section}-{element}[-{id}]
```

Examples:
- `admin-sidebar-nav-content` - Sidebar navigation links
- `admin-users-table` - Users table
- `admin-users-row-{userId}` - Row for specific user
- `admin-users-view-{userId}` - View button for user
- `admin-content-detail-modal` - Content detail modal
- `admin-whitelist-add-term` - Add term button
- `admin-candidates-approve-{id}` - Approve button for candidate

## E2E Testing

### Admin Auth Fixture
Located at `src/__tests__/e2e/fixtures/admin-auth.ts`:
```typescript
import { test as base } from '@playwright/test';

export const adminTest = base.extend<{ adminPage: Page }>({
  adminPage: async ({ browser }, use) => {
    // Creates pre-authenticated admin session
    const context = await browser.newContext({
      storageState: getAdminStorageState()
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  }
});
```

### Page Object Models
Each admin section has a corresponding POM in `src/__tests__/e2e/helpers/pages/admin/`:
- `AdminBasePage.ts` - Base class with sidebar navigation
- `AdminContentPage.ts` - Content management page
- `AdminUsersPage.ts` - User management page
- `AdminReportsPage.ts` - Reports management page
- `AdminWhitelistPage.ts` - Whitelist management page
- `AdminCandidatesPage.ts` - Candidates management page

### Running Admin Tests
```bash
# Run all admin tests
npm run test:e2e -- --grep "Admin"

# Run specific test file
npm run test:e2e -- src/__tests__/e2e/specs/09-admin/admin-users.spec.ts

# Run critical tests only
npm run test:e2e -- --grep "@critical"
```

### Test Categories
- `@critical` - Tests that run on every PR (basic load/render tests)
- Standard tests - Run in full E2E suite

## Adding New Tests

1. **Add data-testid to component**:
   ```tsx
   <button data-testid="admin-{section}-{action}">Action</button>
   ```

2. **Update Page Object Model**:
   ```typescript
   // In AdminXxxPage.ts
   readonly actionButton: Locator;

   constructor(page: Page) {
     this.actionButton = page.getByTestId('admin-section-action');
   }

   async performAction() {
     await this.actionButton.click();
     await this.page.waitForLoadState('networkidle');
   }
   ```

3. **Write test spec**:
   ```typescript
   adminTest('action works correctly', async ({ adminPage }) => {
     const xxxPage = new AdminXxxPage(adminPage);
     await xxxPage.gotoXxx();
     await xxxPage.performAction();
     // Assert expected results
   });
   ```

## CI/CD Integration

Admin tests require an admin test user seeded in the database. This is handled by:
1. `scripts/seed-admin-test-user.ts` - Seeds admin user before E2E tests
2. `.github/workflows/ci.yml` - Calls seeding script in CI pipeline

The admin test user credentials are:
- Email: From `ADMIN_TEST_EMAIL` environment variable
- Password: From `ADMIN_TEST_PASSWORD` environment variable
