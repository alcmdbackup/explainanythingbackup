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
| `src/components/admin/BaseSidebar.tsx` | Shared sidebar shell with activeOverrides for variant sidebars |
| `src/components/admin/AdminSidebar.tsx` | Admin sidebar (10 items), thin wrapper over BaseSidebar |
| `src/components/admin/EvolutionSidebar.tsx` | Evolution sidebar (6 items), thin wrapper over BaseSidebar |
| `src/components/admin/SidebarSwitcher.tsx` | Pathname-based conditional renderer (AdminSidebar vs EvolutionSidebar) |
| `src/components/admin/AdminLayoutClient.tsx` | Client wrapper that provides Toaster component |
| `src/components/admin/ReportsTable.tsx` | User reports management table |
| `src/components/admin/UserDetailModal.tsx` | Modal for user details, notes, and account actions |
| `src/components/admin/WhitelistContent.tsx` | Whitelist terms management with aliases |
| `src/components/admin/CandidatesContent.tsx` | Link candidates approval workflow |
| `src/lib/services/adminContent.ts` | Server actions for admin CRUD operations |
| `src/lib/services/adminAuth.ts` | Admin authentication and authorization |
| `src/lib/services/contentReports.ts` | User-submitted content reports |
| `src/lib/services/auditLog.ts` | Admin action audit logging |
| `src/lib/services/costAnalytics.ts` | LLM cost analytics and backfill |
| `src/config/llmPricing.ts` | Model pricing configuration |

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

High-contrast badges using design system variables for accessibility:

**Content Status:**
- Published: `bg-[var(--status-success)] text-white`
- Draft: `bg-[var(--status-warning)] text-[var(--text-primary)]`

**User Status:**
- Active: `bg-[var(--status-success)] text-white`
- Disabled: `bg-[var(--status-error)] text-white`

**Report Status:**
- Pending: `bg-[var(--status-warning)] text-[var(--text-primary)]`
- Reviewed: `bg-blue-600 text-white`
- Dismissed: `bg-[var(--surface-elevated)] text-[var(--text-secondary)]`
- Actioned: `bg-[var(--status-error)] text-white`

**Whitelist/Candidate Status:**
- Active/Approved: `bg-[var(--status-success)] text-white`
- Inactive/Rejected: `bg-[var(--surface-elevated)] text-[var(--text-secondary)]` or `bg-[var(--status-error)] text-white`

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

- `/admin` - Dashboard with stats and quick links (AdminSidebar)
- `/admin/content` - Content management table
- `/admin/content/reports` - Content reports management queue
- `/admin/users` - User management
- `/admin/whitelist` - Whitelist and candidates tabs
- `/admin/costs` - LLM cost analytics (see Cost Analytics section below)
- `/admin/evolution-dashboard` - Evolution overview with stat cards and quick links (EvolutionSidebar). See [Evolution Visualization](../../evolution/docs/evolution/visualization.md).
- `/admin/quality` - Content quality dashboard (EvolutionSidebar)
- `/admin/quality/evolution` - Evolution pipeline management (queue runs, apply winners, rollback). See [Evolution Architecture](../../evolution/docs/evolution/architecture.md).
- `/admin/quality/evolution/dashboard` - Evolution ops dashboard (stats, trends, auto-polling)
- `/admin/quality/evolution/run/[runId]` - Run detail with 6 tabs (Timeline, Rating, Lineage, Tree, Budget, Variants). See [Evolution Visualization](../../evolution/docs/evolution/visualization.md).
- `/admin/quality/evolution/run/[runId]/compare` - Before/after text diff and quality comparison
- `/admin/quality/optimization` - Rating optimization dashboard with experiment form (run preview table, budget enforcement, per-agent budget caps). See [Cost Optimization](../../evolution/docs/evolution/cost_optimization.md).
- `/admin/quality/hall-of-fame` - Hall of Fame topic list with cross-topic summary, prompt bank coverage grid, and method summary table. See [Hall of Fame](../../evolution/docs/evolution/hall_of_fame.md).
- `/admin/quality/hall-of-fame/[topicId]` - Topic detail with 4 tabs (Leaderboard, Cost vs Rating, Match History, Compare Text)
- `/admin/audit` - Audit log
- `/admin/settings` - System settings
- `/admin/dev-tools` - Development utilities

### Sidebar Switching

The admin layout uses `SidebarSwitcher` to conditionally render either `AdminSidebar` (10 items) or `EvolutionSidebar` (6 items) based on the current pathname. Evolution paths (`/admin/evolution-dashboard`, `/admin/quality`, `/admin/quality/*`) get the EvolutionSidebar; all other admin paths get the AdminSidebar. Both sidebars are thin wrappers over `BaseSidebar`, which provides shared rendering with an `activeOverrides` prop for per-sidebar active state logic.

## Cost Analytics

The `/admin/costs` page provides LLM usage and spending analytics.

### Key Files

| File | Purpose |
|------|---------|
| `src/app/admin/costs/page.tsx` | Cost analytics UI with charts and tables |
| `src/lib/services/costAnalytics.ts` | Server actions for cost data aggregation |
| `src/config/llmPricing.ts` | Model pricing configuration |

### Features

**Date Range Selector:**
- Last minute, hour, day (precise ISO timestamp filtering)
- Last 7, 30, 90 days (standard ranges)

**Summary Cards:**
- Total Cost, Total Calls, Total Tokens, Avg Cost/Call

**Daily Cost Chart:**
- CSS bar chart showing cost trends over time

**Cost by Model:**
- Breakdown of costs per LLM model with progress bars
- Model Details table with System Pricing column (input/output rates per 1M tokens)

**Missing Cost Warning:**
- Displays count of records with null `estimated_cost_usd`
- Prompts admin to run backfill

### Backfill Costs

The "Backfill Costs" button calculates and populates `estimated_cost_usd` for records that don't have it (e.g., data from before cost tracking was added):

```typescript
// Processes ALL records with null costs in batches
const _backfillCostsAction = async (options) => {
  while (hasMore) {
    // Fetch batch of records where estimated_cost_usd IS NULL
    // Calculate cost using calculateLLMCost(model, promptTokens, completionTokens, reasoningTokens)
    // Update each record
  }
};
```

### Cost Calculation

Costs are calculated per model using pricing from `llmPricing.ts`:

```typescript
const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
const reasoningCost = pricing.reasoningPer1M
  ? (reasoningTokens / 1_000_000) * pricing.reasoningPer1M
  : 0;
```

Output tokens typically cost 3-5x more than input tokens.

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
