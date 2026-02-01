# List Small Bugs Research

## Problem Statement
Multiple small bugs and UX issues exist in the report submission flow and admin tool that need to be addressed for consistency and usability.

## Bug List

### Report Submission Flow (Items 1-4)
1. **Font/color inconsistency** - Report submitted screen styling doesn't follow design guidelines
2. **Missing field in queue** - Report submitted queue in admin should show "additional details" field
3. **No detail modal** - Report submitted queue needs pop-up modal showing all details (following design guidelines)
4. **404 on empty state** - Should not 404 when there are no reports

### Admin Tool Content Section (Items 5-8)
5. **Unreadable preview** - Clicking article in content section shows preview window with transparent background
6. **Redundant "view" link** - Remove "view" link under actions, move link icon into its place
7. **Unreadable content previews** - All content previews in admin tool should display readable text (on-screen and pop-ups)
8. **Design guideline compliance** - Admin tool should respect design guidelines throughout

---

## High Level Summary

Research identified the specific code locations for all 8 bugs. Key findings:

1. **Report submitted screen** uses hardcoded Tailwind colors (`bg-green-900/20`, `text-green-400`) instead of CSS variables
2. **Reports queue table** doesn't display the `details` field inline - only shows "(details)" button
3. **Report detail modal** already exists but opens only when clicking "(details)" button
4. **Empty state** handled gracefully with "No reports found" message (bug may be elsewhere)
5. **ExplanationDetailModal** uses `bg-[var(--bg-primary)]` but CSS variable may not be defined/transparent
6. **ExplanationTable** has both "View" text link AND link icon in separate columns
7. **Content preview** in modal uses `bg-[var(--bg-secondary)]` which may lack contrast
8. **Admin components** use inconsistent CSS variables (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`) vs design system (`--surface-primary`, `--surface-secondary`)

---

## Detailed Findings

### Bug #1: Report Submitted Screen Styling

**File:** `src/components/ReportContentButton.tsx:113-116`

**Current Code:**
```tsx
<div className="p-4 bg-green-900/20 border border-green-600 rounded-md text-green-400 text-center">
  Thank you for your report. We will review it shortly.
</div>
```

**Issues:**
- Uses hardcoded Tailwind colors: `bg-green-900/20`, `border-green-600`, `text-green-400`
- Should use design system variables: `--status-success` for success messages
- Font class missing - should use `font-ui` per design guidelines

**Design Guidelines Reference:**
- `--status-success`: `#2d7d4a` (light) / `#52b788` (dark) for success confirmations
- `font-ui` (DM Sans) for UI elements

---

### Bug #2: Reports Queue Missing "Additional Details" Field

**File:** `src/components/admin/ReportsTable.tsx:170-180`

**Current Code:**
```tsx
<td className="p-3">
  <span className="font-medium">{REASON_LABELS[report.reason] || report.reason}</span>
  {report.details && (
    <button onClick={() => setSelectedReport(report)} ...>
      (details)
    </button>
  )}
</td>
```

**Issue:** The `details` field is not displayed inline - only shows a "(details)" button to open modal. Users want to see the additional details directly in the table without clicking.

**Data Available:** `report.details` field contains user-provided additional context text.

---

### Bug #3: Report Detail Modal

**File:** `src/components/admin/ReportsTable.tsx:259-309`

**Current State:** A detail modal DOES exist (lines 259-309) that shows:
- Explanation title
- Reason
- Details (with `whitespace-pre-wrap`)
- Review notes (if present)

**However:**
- Modal only opens when clicking "(details)" button (line 174)
- No "view all details" action in Actions column
- Should be able to view full details for any report, not just those with additional details

---

### Bug #4: 404 on Empty Reports State

**File:** `src/components/admin/ReportsTable.tsx:145-150`

**Current Code:**
```tsx
reports.length === 0 ? (
  <tr>
    <td colSpan={6} className="p-8 text-center text-[var(--text-muted)]">
      No reports found
    </td>
  </tr>
)
```

**Finding:** The table component handles empty state gracefully. Additional investigation:

- **Server action** (`contentReports.ts:188-200`): Returns `{ reports: [], total: 0 }` correctly when no reports
- **Page routing** (`/admin/content/reports/page.tsx`): Properly renders ReportsTable
- **Dashboard links** (`/admin/page.tsx:133, 182`): Link to correct URL `/admin/content/reports`

**⚠️ CANNOT REPRODUCE:** No 404 found in code. Possible explanations:
1. Database table `content_reports` doesn't exist (migration not run)
2. User saw 404 from a different/incorrect URL
3. Bug already fixed in a previous commit
4. Intermittent auth/permission issue

**Action:** Verify during testing. If 404 occurs, check browser network tab for actual failing URL.

---

### Bug #5: Article Preview Transparent Background

**File:** `src/components/admin/ExplanationDetailModal.tsx:68`

**Current Code:**
```tsx
<div className="bg-[var(--bg-primary)] rounded-lg shadow-warm-xl max-w-4xl w-full ...">
```

**Issue:** Uses `--bg-primary` CSS variable which may not be defined in the admin context. Design system defines:
- `--background` for page background
- `--surface-primary` for primary surfaces
- `--surface-secondary` for cards/containers

The modal should use `--surface-secondary` per design guidelines for cards.

---

### Bug #6: Redundant "View" Link

**File:** `src/components/admin/ExplanationTable.tsx:307-318 & 339-347`

**Current Structure:**
1. **Link Column (lines 307-318):** Contains external link icon
   ```tsx
   <td className="p-3">
     <a href={`/explanations?id=${exp.id}`} ...>
       <svg className="w-4 h-4" ...> {/* external link icon */}
     </a>
   </td>
   ```

2. **Actions Column (lines 339-347):** Contains "View" text button
   ```tsx
   <button onClick={() => onSelectExplanation?.(exp)} ...>
     View
   </button>
   ```

**Note:** These serve different purposes:
- Link icon → opens public page in new tab
- "View" button → opens detail modal

Request says: remove "View" link, move link icon to Actions column.

---

### Bug #7: Unreadable Content Previews

**File:** `src/components/admin/ExplanationDetailModal.tsx:146-153`

**Current Code:**
```tsx
<div className="bg-[var(--bg-secondary)] rounded-lg p-4 max-h-96 overflow-y-auto">
  <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)] font-mono">
    {explanation.content}
  </pre>
</div>
```

**Issues:**
- `--bg-secondary` may not be defined/transparent
- Content is raw text, not rendered markdown/HTML
- Should use `--surface-secondary` for container
- Text should use `--text-primary` (this is correct but may not work if var undefined)

---

### Bug #8: Admin Tool Design Guideline Compliance

**Pattern Found Across Admin Components:**

| Component | Current Variables | Should Be |
|-----------|------------------|-----------|
| ExplanationTable | `--bg-secondary`, `--bg-tertiary`, `--border-color` | `--surface-secondary`, `--surface-elevated`, `--border-default` |
| ExplanationDetailModal | `--bg-primary`, `--bg-secondary` | `--surface-primary`, `--surface-secondary` |
| ReportsTable | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | `--surface-primary`, `--surface-secondary`, `--surface-elevated` |

**CSS Variable Mapping Needed:**
```
--bg-primary      → --surface-primary (or --background)
--bg-secondary    → --surface-secondary
--bg-tertiary     → --surface-elevated
--border-color    → --border-default
--accent-primary  → --accent-gold
```

**ROOT CAUSE CONFIRMED:** The `--bg-*` and `--border-color` and `--accent-primary` variables are **NOT DEFINED** in `globals.css`. They resolve to nothing, causing transparent backgrounds. This is why bugs #5, #7, and #8 manifest as unreadable/transparent content.

**Instance Counts by File:**
| File | Undefined Var Instances |
|------|-------------------------|
| `ExplanationDetailModal.tsx` | 6 |
| `ExplanationTable.tsx` | 14 |
| `ReportsTable.tsx` | 11 |
| `AdminSidebar.tsx` | 5 |
| `UserDetailModal.tsx` | 14 |
| **Total** | **50 instances** |

**Other Issues:**
- Status badges use hardcoded Tailwind colors: `bg-yellow-900/30`, `bg-green-800`, `bg-orange-800`
- Font classes inconsistently applied - should use `font-ui` for UI elements

---

## Documents Read
- `docs/docs_overall/design_style_guide.md` - Complete design system reference
- `docs/docs_overall/architecture.md` - System architecture overview
- `docs/docs_overall/project_workflow.md` - Project workflow guidelines

## Code Files Read
- `src/components/ReportContentButton.tsx` - User-facing report modal (195 lines)
- `src/components/admin/ReportsTable.tsx` - Admin reports queue table (313 lines)
- `src/components/admin/ExplanationTable.tsx` - Admin content table (406 lines)
- `src/components/admin/ExplanationDetailModal.tsx` - Article preview modal (201 lines)
- `src/app/admin/content/page.tsx` - Admin content management page (48 lines)
- `src/app/admin/content/reports/page.tsx` - Admin reports page (25 lines)
