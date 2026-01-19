# Improvements and Tests Admin Panel Plan

## Background
The admin panel at `/admin/content` was recently implemented to allow administrators to manage explanations. While functional, there are several UX issues that make it difficult to use effectively: status badges are hard to read, test content clutters the view, the detail modal has poor contrast, and there's no quick way to view actual content pages.

## Problem
1. **No test content filter**: Articles containing "[TEST]" in the title mix with real content, making it hard to review production content
2. **Poor status badge readability**: Green and yellow text on dark backgrounds have insufficient contrast
3. **Unreadable modal**: The detail modal uses dark gray background making text hard to read
4. **Missing link column**: No direct way to navigate to the actual explanation page from the table

## Options Considered

### Filter Test Content
- **Option A**: Client-side filtering (filter after fetch) - Simple but wastes bandwidth
- **Option B**: Server-side filtering via query parameter - Efficient, consistent with existing patterns ✓
- **Option C**: Hardcoded exclusion - Inflexible

**Choice**: Option B - Add `filterTestContent` to `AdminExplanationFilters` type and filter server-side

### Status Badge Colors
- **Option A**: Use solid dark backgrounds with light text - Higher contrast ✓
- **Option B**: Use inverted colors (light bg, dark text) - Inconsistent with dark theme
- **Option C**: Add borders for definition - Doesn't solve contrast issue

**Choice**: Option A - Use `bg-green-800 text-green-100` and `bg-orange-800 text-orange-100`

### Modal Styling
- **Option A**: White background with black text (as requested) ✓
- **Option B**: Lighter gray background - Still potentially hard to read
- **Option C**: Add high-contrast mode toggle - Over-engineered

**Choice**: Option A - Solid white background (`bg-white`) with black text (`text-gray-900`)

### Link Column
- **Option A**: Add as new column after Title ✓
- **Option B**: Make title itself a link - Conflicts with modal trigger
- **Option C**: Add to Actions column - Clutters existing actions

**Choice**: Option A - Add dedicated "Link" column with external link icon

## Phased Execution Plan

### Phase 1: Add "Filter Test Content" Checkbox
**Files Modified:**
- `src/lib/services/adminContent.ts` - Add `filterTestContent` to filters type and query logic
- `src/components/admin/ExplanationTable.tsx` - Add checkbox UI and state

**Implementation:**
1. Update `AdminExplanationFilters` interface:
```tsx
interface AdminExplanationFilters {
  // ... existing fields
  filterTestContent?: boolean;
}
```

2. Add server-side filter in `getAdminExplanations`:
```tsx
if (filterTestContent) {
  query = query.not('explanation_title', 'ilike', '%[TEST]%');
}
```

3. Add state and checkbox in ExplanationTable:
```tsx
const [filterTestContent, setFilterTestContent] = useState(true); // default checked

<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={filterTestContent}
    onChange={(e) => setFilterTestContent(e.target.checked)}
    className="rounded border-gray-600"
  />
  Filter test content
</label>
```

**Tests:**
- Unit test for `getAdminExplanations` with filterTestContent flag
- Component test for checkbox state management

---

### Phase 2: Fix Status Badge Colors
**Files Modified:**
- `src/components/admin/ExplanationTable.tsx` - Update badge class names

**Implementation:**
Change status badge classes from:
```tsx
exp.status === 'published'
  ? 'bg-green-900/30 text-green-400'
  : 'bg-yellow-900/30 text-yellow-400'
```

To:
```tsx
exp.status === 'published'
  ? 'bg-green-800 text-green-100'
  : 'bg-orange-800 text-orange-100'
```

**Tests:**
- Visual verification in browser
- Snapshot test update if exists

---

### Phase 3: Fix Modal Readability
**Files Modified:**
- `src/components/admin/ExplanationDetailModal.tsx` - Update background and text colors

**Implementation:**
1. Change modal container from `bg-gray-900` to `bg-white`
2. Update all text colors from light variants to dark variants:
   - Headers: `text-gray-900`
   - Body text: `text-gray-700`
   - Muted text: `text-gray-500`
3. Update borders and dividers for light theme
4. Update button styles to maintain contrast on white background

**Key Changes:**
```tsx
// Container
<div className="bg-white rounded-lg ...">

// Header
<h2 className="text-xl font-semibold text-gray-900">

// Content
<p className="text-gray-700">

// Close button
<button className="text-gray-500 hover:text-gray-700">
```

**Tests:**
- Visual verification in browser
- Component test for modal rendering

---

### Phase 4: Add Link Column
**Files Modified:**
- `src/components/admin/ExplanationTable.tsx` - Add Link column to table

**Implementation:**
1. Add "Link" header after "Title" column
2. Add link cell with external link icon:
```tsx
<td className="px-4 py-3">
  <a
    href={`/explanation/${exp.id}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-accent hover:underline inline-flex items-center gap-1"
  >
    <ExternalLinkIcon className="w-4 h-4" />
  </a>
</td>
```

**Tests:**
- Component test verifying link href format
- Visual verification

---

## Testing

### Unit Tests
| Test | File | Description |
|------|------|-------------|
| filterTestContent query | `adminContent.test.ts` | Verify [TEST] articles excluded when flag is true |
| filterTestContent default | `adminContent.test.ts` | Verify all articles returned when flag is false |

### Component Tests
| Test | File | Description |
|------|------|-------------|
| Filter checkbox state | `ExplanationTable.test.tsx` | Verify checkbox toggles filterTestContent |
| Link column render | `ExplanationTable.test.tsx` | Verify link href matches `/explanation/{id}` |
| Modal text colors | `ExplanationDetailModal.test.tsx` | Verify white bg and dark text classes |

### Manual Verification
1. Navigate to `/admin/content`
2. Verify "Filter test content" checkbox is checked by default
3. Uncheck - verify [TEST] articles appear
4. Check - verify [TEST] articles disappear
5. Verify status badges are readable (dark green/orange backgrounds)
6. Click a title - verify modal has white background with black text
7. Verify Link column shows external link icons
8. Click link - verify it opens correct explanation page in new tab

## Documentation Updates
- `docs/feature_deep_dives/admin_panel.md` - Update with new filtering capability and UI changes
