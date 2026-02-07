# Reports Queue Link Broken Admin Panel Plan

## Background
The admin dashboard provides quick access cards and action links to various admin sections. The "Reports Queue" card and "Review Pending Reports" quick action link were added to help admins quickly access pending content reports. However, these links point to an incorrect URL.

## Problem
The admin dashboard links to `/admin/reports` and `/admin/reports?status=pending`, but the actual reports page is located at `/admin/content/reports`. This is because reports are a sub-feature of content management in the app's routing hierarchy. When users click these links, they get a 404 error because no page exists at `/admin/reports`.

## Options Considered

1. **Fix the URLs in the dashboard** (Chosen)
   - Update the two incorrect hrefs to point to `/admin/content/reports`
   - Pros: Simple, minimal change, follows existing routing structure
   - Cons: None

2. **Create a redirect from /admin/reports to /admin/content/reports**
   - Add middleware or Next.js config redirect
   - Pros: Would fix any external links to the old URL
   - Cons: Over-engineered for this issue, no external links exist

3. **Move the reports page to /admin/reports**
   - Restructure the app directory
   - Pros: Shorter URL
   - Cons: Breaks existing routing convention where reports is under content

## Phased Execution Plan

### Phase 1: Fix URLs
1. Edit `src/app/admin/page.tsx`
2. Line 133: Change `href="/admin/reports"` to `href="/admin/content/reports"`
3. Line 182: Change `href="/admin/reports?status=pending"` to `href="/admin/content/reports?status=pending"`

### Phase 2: Verify
1. Run lint, tsc, build
2. Run unit tests
3. Run E2E tests (admin tests will verify navigation)

## Testing
- **Manual verification**: Click "Reports Queue" card and "Review Pending Reports" link on admin dashboard
- **E2E tests**: Existing admin E2E tests in `src/__tests__/e2e/specs/09-admin/` should pass
- No new tests needed - this is a URL typo fix

## Documentation Updates
None required - this is a bug fix with no architectural changes.
