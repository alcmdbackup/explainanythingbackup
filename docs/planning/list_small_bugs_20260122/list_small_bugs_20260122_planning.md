# List Small Bugs Plan

## Background
The ExplainAnything platform has a report submission feature allowing users to report issues with content, and an admin tool for managing content and reviewing reports. Several small bugs and UX inconsistencies have been identified that affect both the user-facing report flow and the admin tool's usability.

## Problem
Two main areas need fixes:

**Report Submission Flow:**
1. Font/color on report submitted screen inconsistent with design guidelines
2. Report queue in admin missing "additional details" field
3. Report queue lacks detail modal (should follow design guidelines)
4. 404 error when no reports exist (should show empty state)

**Admin Tool Content Section:**
5. Article preview has transparent/unreadable background
6. Redundant "view" link - should be replaced with link icon
7. Content previews generally unreadable (both on-screen and in pop-ups)
8. Admin tool not following design guidelines

## Options Considered

### Option A: Minimal Fixes (Selected)
Fix each bug individually with targeted CSS variable changes. Pros: Fast, low risk. Cons: May miss some inconsistencies.

### Option B: Full Admin Theme Overhaul
Create dedicated admin CSS with all design system variables. Pros: Comprehensive. Cons: Larger scope, more testing needed.

**Decision:** Option A - targeted fixes for the 8 specific bugs.

---

## Phased Execution Plan

### Phase 1: Report Submission Flow Fixes (4 items)

#### 1.1 Fix Report Submitted Screen Styling
**File:** `src/components/ReportContentButton.tsx:113-116`

Change:
```tsx
// FROM:
<div className="p-4 bg-green-900/20 border border-green-600 rounded-md text-green-400 text-center">

// TO:
<div className="p-4 bg-[var(--status-success)]/20 border border-[var(--status-success)] rounded-md text-[var(--status-success)] text-center font-ui">
```

#### 1.2 Add "Additional Details" Field to Reports Queue
**File:** `src/components/admin/ReportsTable.tsx`

- Add new column header "Details" after "Reason" column
- Display truncated `report.details` text (e.g., first 50 chars + "...")
- Keep "(details)" button for opening full modal

#### 1.3 Update Report Detail Modal
**File:** `src/components/admin/ReportsTable.tsx:259-309`

- Add "View" button to Actions column for all reports (not just those with details)
- Update modal styling to use design system variables:
  - `--surface-secondary` for modal background
  - `--border-default` for borders
  - `font-ui` for text

#### 1.4 Verify Empty State Handling (Bug #4 - Needs Live Testing)
**File:** `src/components/admin/ReportsTable.tsx:145-150`

**Code analysis shows no 404 source.** All paths handle empty state correctly:
- Page exists at correct location
- Server action returns `{ reports: [], total: 0 }`
- Component shows "No reports found" message
- Links use correct URL `/admin/content/reports`

**Live testing checklist:**
1. Ensure `content_reports` table exists (run migrations)
2. Navigate to `/admin/content/reports` with no reports in DB
3. If 404 occurs, check browser Network tab for actual failing URL
4. Check server logs for error messages

---

### Phase 2: Admin Content Section Fixes (4 items)

#### 2.1 Fix Article Preview Modal Background
**File:** `src/components/admin/ExplanationDetailModal.tsx:68`

Change:
```tsx
// FROM:
<div className="bg-[var(--bg-primary)] rounded-lg shadow-warm-xl ...">

// TO:
<div className="bg-[var(--surface-secondary)] rounded-lg shadow-warm-xl ...">
```

Also update content preview area (line 148):
```tsx
// FROM:
<div className="bg-[var(--bg-secondary)] rounded-lg p-4 ...">

// TO:
<div className="bg-[var(--surface-elevated)] rounded-lg p-4 ...">
```

#### 2.2 Remove "View" Link, Move Icon to Actions
**File:** `src/components/admin/ExplanationTable.tsx`

- Remove "Link" column header and data (lines 254, 307-318)
- Update "Actions" column to include:
  - External link icon (opens public page)
  - "Hide" / "Restore" button

New Actions column structure:
```tsx
<td className="p-3">
  <div className="flex gap-2 items-center">
    <a href={`/explanations?id=${exp.id}`} target="_blank" ...>
      <svg className="w-4 h-4" ...> {/* external link icon */}
    </a>
    {exp.delete_status !== 'visible' ? (
      <button onClick={() => handleRestore(exp.id)} ...>Restore</button>
    ) : (
      <button onClick={() => handleHide(exp.id)} ...>Hide</button>
    )}
  </div>
</td>
```

#### 2.3 Fix Content Preview Readability
**Files:**
- `src/components/admin/ExplanationDetailModal.tsx:149-151`
- `src/components/admin/ReportsTable.tsx:265, 287`

Ensure all text uses `text-[var(--text-primary)]` and backgrounds use `--surface-secondary` or `--surface-elevated`.

#### 2.4 Update Admin Components to Design System
**Root Cause:** The `--bg-*`, `--border-color`, and `--accent-primary` variables are NOT DEFINED in `globals.css`, causing transparent backgrounds.

**CSS variable mapping (50 total instances):**

| Old Variable | New Variable |
|--------------|--------------|
| `--bg-primary` | `--surface-secondary` (for modals/cards) |
| `--bg-secondary` | `--surface-secondary` or `--surface-elevated` |
| `--bg-tertiary` | `--surface-elevated` |
| `--border-color` | `--border-default` |
| `--accent-primary` | `--accent-gold` |

**Files to update:**
| File | Instances |
|------|-----------|
| `ExplanationTable.tsx` | 14 |
| `ExplanationDetailModal.tsx` | 6 |
| `ReportsTable.tsx` | 11 |
| `AdminSidebar.tsx` | 5 |
| `UserDetailModal.tsx` | 14 |

---

## Testing

### Unit Tests
- Verify `ReportContentButton.test.tsx` passes with styling changes
- No new unit tests needed (styling changes only)

### E2E Tests
- Run `report-content.spec.ts` - verify report submission flow
- Run `admin-reports.spec.ts` - verify admin reports queue
- Run `admin-content.spec.ts` - verify admin content section

### Manual Verification
1. Submit a report → verify success message styling
2. View reports queue → verify details column visible
3. Open report detail modal → verify readability
4. Test with no reports → verify no 404
5. Open content preview modal → verify background/text visible
6. Verify link icon in Actions column works
7. Test in both light and dark modes

---

---

### Phase 3: Additional UI Polish (3 items)

#### 3.1 Fix Status Badge Contrast (Readability)
**Problem:** Status badges use `bg-green-900/30 text-green-400` patterns - light green on gray is hard to read.

**Files to update:**
- `src/app/admin/users/page.tsx` (lines 157-165) - Active/Disabled badges
- `src/components/admin/ReportsTable.tsx` (lines 28-33) - STATUS_STYLES constant
- `src/components/admin/WhitelistContent.tsx` (lines 232-241) - Active/Inactive badges
- `src/components/admin/CandidatesContent.tsx` (lines 112-123) - getStatusBadge function

**New badge pattern using design system colors:**
```tsx
// Active/Success: solid green bg with white text
'bg-[var(--status-success)] text-white'

// Pending/Warning: solid warning bg with dark text
'bg-[var(--status-warning)] text-[var(--text-primary)]'

// Disabled/Error: solid error bg with white text
'bg-[var(--status-error)] text-white'

// Neutral/Inactive: muted bg with secondary text
'bg-[var(--surface-elevated)] text-[var(--text-secondary)]'

// Reviewed (blue): keep distinct
'bg-blue-600 text-white'
```

#### 3.2 Add "Reports Queue" to Sidebar
**Problem:** Reports are nested under Content (`/admin/content/reports`) but need their own sidebar link.

**File:** `src/components/admin/AdminSidebar.tsx` (line 19)

**Add after Content entry:**
```tsx
{ href: '/admin/content/reports', label: 'Reports Queue', icon: '🚨', testId: 'admin-sidebar-nav-reports' },
```

#### 3.3 Update isActive Logic for Reports
**File:** `src/components/admin/AdminSidebar.tsx` (lines 31-36)

Update `isActive` function to handle nested reports route properly so both Content and Reports Queue can show active state correctly.

---

## Documentation Updates

No documentation updates required - these are bug fixes to existing functionality.
