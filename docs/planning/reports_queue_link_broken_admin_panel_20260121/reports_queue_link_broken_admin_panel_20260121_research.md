# Reports Queue Link Broken Admin Panel Research

## Problem Statement
The "Reports Queue" link in the admin panel dashboard is broken. When clicking the link, users are directed to a non-existent route causing a 404 error.

## High Level Summary
**Root Cause**: URL mismatch between dashboard links and actual page location.

- Dashboard links point to `/admin/reports` (lines 133, 182 in `page.tsx`)
- Actual reports page exists at `/admin/content/reports`
- No page exists at `/admin/reports` - the directory doesn't exist

This is a simple routing bug where the dashboard card and quick action link were created with incorrect URLs.

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read

### Dashboard Page (Source of Broken Links)
**File**: `src/app/admin/page.tsx`

| Line | Code | Issue |
|------|------|-------|
| 133 | `href="/admin/reports"` | Wrong URL - should be `/admin/content/reports` |
| 182 | `href="/admin/reports?status=pending"` | Wrong URL - should be `/admin/content/reports?status=pending` |

### Actual Reports Page Location
**File**: `src/app/admin/content/reports/page.tsx`
- Route: `/admin/content/reports`
- Renders `ReportsTable` component with `initialStatus="pending"`

### Admin Directory Structure
```
src/app/admin/
├── audit/
├── content/
│   └── reports/        ← Reports page is HERE
│       └── page.tsx
├── costs/
├── dev-tools/
├── layout.tsx
├── page.tsx            ← Dashboard with broken links
├── settings/
├── users/
└── whitelist/
```

Note: There is NO `reports/` directory directly under `admin/`.

### Admin Sidebar Navigation
**File**: `src/components/admin/AdminSidebar.tsx` (lines 17-26)

The sidebar does NOT include a direct link to reports. Navigation items are:
- `/admin` → Dashboard
- `/admin/content` → Content
- `/admin/users` → Users
- `/admin/costs` → Costs
- `/admin/whitelist` → Whitelist
- `/admin/audit` → Audit Log
- `/admin/settings` → Settings
- `/admin/dev-tools` → Dev Tools

### Reports Table Component
**File**: `src/components/admin/ReportsTable.tsx` (356 lines)
- Displays user-submitted content reports
- Supports filtering by status: pending, reviewed, dismissed, actioned
- Actions: Dismiss, Mark Reviewed, Hide Content

### Content Reports Service
**File**: `src/lib/services/contentReports.ts`
- `getReportCountsAction` - returns pending/total counts (used by dashboard)
- `getContentReportsAction` - fetches paginated reports
- `resolveContentReportAction` - handles report resolution

## Summary of the Bug

| What | Where | Problem |
|------|-------|---------|
| Dashboard "Reports Queue" card | `src/app/admin/page.tsx:133` | Links to `/admin/reports` |
| Quick Action "Review Pending Reports" | `src/app/admin/page.tsx:182` | Links to `/admin/reports?status=pending` |
| Actual page location | `src/app/admin/content/reports/page.tsx` | Route is `/admin/content/reports` |

**Fix Required**: Update both links from `/admin/reports` to `/admin/content/reports`.
