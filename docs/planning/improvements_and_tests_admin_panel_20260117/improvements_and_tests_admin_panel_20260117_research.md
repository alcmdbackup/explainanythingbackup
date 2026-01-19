# Improvements and Tests Admin Panel Research

## Problem Statement
The admin panel at `/admin/content` has several UX issues:
1. No way to filter out test content (articles with [TEST] in title)
2. Status badges (green/yellow on dark background) are hard to read
3. Modal that appears when clicking titles has poor readability (dark theme issues)
4. No direct link to view the actual content from the table

## High Level Summary
The admin panel is well-structured with clear separation between page, table component, modal component, and server actions. Changes will primarily affect:
- `ExplanationTable.tsx` - for filter checkbox and link column
- `ExplanationDetailModal.tsx` - for modal styling
- `adminContent.ts` - for server-side test content filtering

## Documents Read
- `docs/docs_overall/architecture.md` - Server Actions pattern, schema-first development
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/docs_overall/project_workflow.md` - Workflow for projects

## Code Files Read

### Key Files for This Project

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/app/admin/content/page.tsx` | Main content page, manages modal state | None |
| `src/components/admin/ExplanationTable.tsx` | Table with filtering, sorting, pagination | Add filter checkbox, add link column, fix status colors |
| `src/components/admin/ExplanationDetailModal.tsx` | Modal for viewing/managing explanation | Fix background/text colors |
| `src/lib/services/adminContent.ts` | Server actions for admin operations | Add test content filter logic |

### Current Implementation Details

#### 1. ExplanationTable.tsx - Current Filter UI
```tsx
// Current filters in the component:
const [search, setSearch] = useState('');
const [statusFilter, setStatusFilter] = useState<'draft' | 'published' | ''>('');
const [showHidden, setShowHidden] = useState(true);
```

Filter UI is in a flex container with search input, status dropdown, and "Show hidden" checkbox.

#### 2. Status Badge Styling (Current - Hard to Read)
```tsx
<span className={`px-2 py-1 rounded text-xs ${
  exp.status === 'published'
    ? 'bg-green-900/30 text-green-400'    // Green on dark - low contrast
    : 'bg-yellow-900/30 text-yellow-400'  // Yellow on dark - low contrast
}`}>
  {exp.status}
</span>
```

#### 3. Table Columns (Current)
1. Checkbox (bulk selection)
2. ID - sortable, right-aligned
3. Title - sortable, clickable to open modal
4. Status - color-coded badge
5. Created - sortable date
6. Hidden - Yes/No indicator
7. Actions - View, Hide/Restore buttons

**Missing:** Link column to actual content page

#### 4. Modal Styling (Current - Dark Theme)
```tsx
// Modal container - uses dark overlay
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-gray-900 rounded-lg max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
```

The modal uses `bg-gray-900` which makes content hard to read.

#### 5. Server-Side Filtering (adminContent.ts)
```tsx
// Current query construction
let query = supabase
  .from('explanations')
  .select('...', { count: 'exact' });

if (search) {
  query = query.or(`explanation_title.ilike.%${search}%,content.ilike.%${search}%`);
}

if (status) {
  query = query.eq('status', status);
}

if (!showHidden) {
  query = query.or('is_hidden.eq.false,is_hidden.is.null');
}
```

### AdminExplanationFilters Type
```tsx
interface AdminExplanationFilters {
  search?: string;
  status?: 'draft' | 'published';
  showHidden?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'title' | 'id';
  sortOrder?: 'asc' | 'desc';
}
```

Will need to add: `filterTestContent?: boolean`

### URL Pattern for Explanation Pages
Based on the modal's "View Public Page" link:
```tsx
<a
  href={`/explanation/${explanation.id}`}
  target="_blank"
  rel="noopener noreferrer"
>
```

Route pattern: `/explanation/{id}`
