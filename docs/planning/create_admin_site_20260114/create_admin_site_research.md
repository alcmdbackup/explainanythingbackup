# Create Admin Site Research

## Problem Statement
Build an administrative dashboard for ExplainAnything that provides authorized administrators with tools to manage content, users, and system settings. The admin panel needs to integrate with existing authentication, use established patterns, and provide content moderation, user management, and analytics dashboards.

## High Level Summary
The ExplainAnything codebase has robust foundations for building an admin panel:
- **Authentication**: Supabase Auth with middleware protection; existing admin route at `/admin` uses client-side email whitelist
- **Authorization**: Row Level Security (RLS) policies + service role client for bypassing RLS in admin operations
- **Patterns**: Well-established server action patterns with logging, error handling, and request tracing
- **Existing Admin**: Link whitelist management at `/admin/whitelist` provides a reference implementation
- **Database**: 18+ tables with RLS enabled; no dedicated admin roles table (uses email whitelist for now)

---

## Research Details

### 1. Authentication & Authorization

**Current Implementation:**
- Supabase Auth with email/password authentication
- Middleware-based route protection (`src/middleware.ts`)
- Session cookies with automatic refresh
- RLS policies at database level for all tables

**Admin Access Control:**
- Hardcoded email whitelist in `src/app/admin/layout.tsx`:
  ```typescript
  const ADMIN_EMAILS = ['abecha@gmail.com']
  ```
- Client-side check in layout component
- Unauthorized users redirected to home page

**Service Role Client:**
- Bypasses RLS for admin/background operations
- Created via `SUPABASE_SERVICE_ROLE_KEY` environment variable
- Used for metrics tracking and admin operations
- File: `src/lib/utils/supabase/server.ts:40-50`

**Key Files:**
- `src/middleware.ts` - Route protection
- `src/lib/utils/supabase/middleware.ts` - Session update logic
- `src/lib/utils/supabase/server.ts` - Supabase client creation
- `src/app/admin/layout.tsx` - Admin auth guard

### 2. Existing Admin Routes

**Route Structure:**
```
/admin                    → Redirects to /admin/whitelist
/admin/whitelist          → Link management with tabs
  ?tab=whitelist          → WhitelistContent component
  ?tab=candidates         → CandidatesContent component
```

**Admin Layout Pattern:**
```typescript
// src/app/admin/layout.tsx
export default function AdminLayout({ children }) {
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase_browser.auth.getUser()
      if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
        router.replace('/')
        return
      }
      setIsAuthorized(true)
    }
    checkAuth()
  }, [router])

  if (!isAuthorized) return null
  return <>{children}</>
}
```

**Key Files:**
- `src/app/admin/layout.tsx` - Auth guard layout
- `src/app/admin/page.tsx` - Redirect to whitelist
- `src/app/admin/whitelist/page.tsx` - Tab-based content management
- `src/components/admin/WhitelistContent.tsx` - Whitelist management UI
- `src/components/admin/CandidatesContent.tsx` - Candidate management UI

### 3. Database Schema

**Core Tables (Admin Relevant):**

| Table | Rows | Purpose |
|-------|------|---------|
| `explanations` | 1,742 | Main content storage |
| `topics` | 3,280 | Content categorization |
| `tags` | 16 | Preset tag definitions |
| `explanation_tags` | 5,115 | Tag-explanation junction |
| `userLibrary` | 207 | User bookmarks |
| `userQueries` | 1,654 | Search history |
| `userExplanationEvents` | 1,401 | User interactions |
| `explanationMetrics` | 352 | Aggregated metrics |
| `llmCallTracking` | 12,086 | LLM API usage |
| `link_whitelist` | 2 | Admin-approved links |
| `link_candidates` | 863 | Pending link suggestions |

**No Admin Roles Table:**
- Access control via email whitelist (not database roles)
- RLS policies use `auth.uid()` for user isolation
- Service role key for admin bypass

**Key Schema Files:**
- `src/lib/schemas/schemas.ts` - 1,082 lines of Zod schemas
- `supabase/migrations/` - SQL migration files

### 4. Server Action Patterns

**Standard Pattern (All 65+ Actions):**
```typescript
// Layer 1: Internal function with logging
const _functionName = withLogging(
    async function functionName(...) { /* impl */ },
    'functionName',
    { enabled: FILE_DEBUG }
);

// Layer 2: Request ID wrapper
export const functionName = serverReadRequestId(_functionName);
```

**Response Format:**
```typescript
{
  success: boolean;
  data?: T | null;
  error: ErrorResponse | null;
}
```

**Error Codes:**
- `INVALID_INPUT`, `VALIDATION_ERROR` - Input issues
- `DATABASE_ERROR`, `NOT_FOUND` - Data issues
- `LLM_API_ERROR`, `TIMEOUT_ERROR` - External services

**Existing Admin Actions:**
- Link Whitelist: `createWhitelistTermAction`, `updateWhitelistTermAction`, `deleteWhitelistTermAction`
- Candidates: `approveCandidateAction`, `rejectCandidateAction`, `deleteCandidateAction`
- Metrics: `refreshExplanationMetricsAction`, `getMultipleExplanationMetricsAction`

**Key Files:**
- `src/actions/actions.ts` - 2,244 lines, 50+ actions
- `src/actions/importActions.ts` - 215 lines, import pipeline
- `src/editorFiles/actions/actions.ts` - 659 lines, AI editing
- `src/lib/errorHandling.ts` - Error categorization

### 5. UI Component Patterns

**Design System:** "Midnight Scholar" theme
- Typography: Playfair Display (headings), Source Serif 4 (body), DM Sans (UI)
- Colors: Warm cream/gold/copper palette with dark mode
- Components: shadcn/ui-based with Radix primitives

**Key UI Patterns:**
- **Cards**: Composed structure (Card > CardHeader > CardContent > CardFooter)
- **Forms**: React Hook Form + Zod validation
- **Tables**: Sortable with ExplanationsTablePage pattern
- **Modals**: Radix Dialog with overlay
- **Tabs**: URL-param based (`?tab=whitelist`)

**Component Files:**
- `src/components/ui/` - Base components (button, card, dialog, form, input, etc.)
- `src/components/admin/` - Admin-specific components
- `src/components/explore/` - Gallery/list components

### 6. Page Routing Patterns

**Route Groups:**
- `(debug)` - Test pages (not in URL)
- `admin/` - Protected admin routes

**Layout Nesting:**
```
src/app/
├── layout.tsx (root - ThemeProvider)
├── admin/
│   ├── layout.tsx (auth guard)
│   ├── page.tsx (redirect)
│   └── whitelist/
│       └── page.tsx (content)
```

**Server vs Client Components:**
- Layouts: Server components with auth checks
- Pages: Client components when interactive
- API routes: Always server-side

---

## Documents Read
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/docs_overall/architecture.md` - System design
- `docs/docs_overall/project_workflow.md` - Project workflow
- `docs/feature_deep_dives/authentication_rls.md` - Auth patterns
- `docs/feature_deep_dives/server_action_patterns.md` - Action patterns
- `docs/feature_deep_dives/state_management.md` - State patterns
- `docs/feature_deep_dives/error_handling.md` - Error handling
- `docs/feature_deep_dives/tag_system.md` - Tag management
- `docs/feature_deep_dives/metrics_analytics.md` - Metrics patterns
- `docs/feature_deep_dives/link_whitelist_system.md` - Link whitelist documentation
- `docs/planning/import_sources/import_sources_brainstorm.md` - Import sources brainstorm
- `docs/planning/import_sources/import_sources_design.md` - Import sources design
- `docs/planning/import_sources/import_sources_tech_plan.md` - Import sources technical plan

## Code Files Read
- `src/middleware.ts` - Route protection
- `src/app/admin/layout.tsx` - Admin auth guard
- `src/app/admin/page.tsx` - Admin redirect
- `src/app/admin/whitelist/page.tsx` - Whitelist page
- `src/lib/utils/supabase/server.ts` - Supabase clients
- `src/lib/utils/supabase/middleware.ts` - Session handling
- `src/lib/utils/supabase/validateApiAuth.ts` - API auth
- `src/actions/actions.ts` - Server actions
- `src/lib/schemas/schemas.ts` - Zod schemas
- `src/lib/errorHandling.ts` - Error handling
- `src/components/ui/` - UI components
- `supabase/migrations/` - Database migrations
- `src/lib/services/linkWhitelist.ts` - Whitelist service (697 lines)
- `src/lib/services/linkCandidates.ts` - Candidate service (502 lines)
- `src/lib/services/linkResolver.ts` - Link resolution service (381 lines)
- `src/components/admin/WhitelistContent.tsx` - Whitelist admin UI (407 lines)
- `src/components/admin/CandidatesContent.tsx` - Candidates admin UI (284 lines)
- `src/__tests__/e2e/helpers/test-data-factory.ts` - Test cleanup patterns for deletion
- `src/__tests__/e2e/setup/global-teardown.ts` - User deletion reference implementation
- `supabase/migrations/20251221080336_link_whitelist_system.sql` - FK cascade definitions
- `supabase/migrations/20260104062824_fix_user_table_rls.sql` - User RLS policies

---

## Key Insights for Admin Site Implementation

### Authentication Strategy
1. **Current approach**: Client-side email whitelist in layout - works but not scalable
2. **Options to consider**:
   - Database `admin_users` table with RLS policies
   - Supabase Auth custom claims for roles
   - Keep email whitelist but move to environment variable

### Recommended Architecture
```
/admin                    → Dashboard overview
/admin/content            → Explanation management (CRUD)
/admin/users              → User management
/admin/analytics          → Metrics dashboards
/admin/settings           → System settings
/admin/whitelist          → (existing) Link management
```

### Patterns to Follow
- Server actions with `withLogging` + `serverReadRequestId`
- Service client for RLS bypass in admin operations
- React Hook Form + Zod for forms
- Tab-based navigation via URL params
- Consistent error handling with ErrorResponse type

### Database Considerations
- May need new tables: `admin_users`, `admin_audit_log`
- Service role client already available for admin operations
- RLS policies work with current auth system

---

## Complete Page & Route Inventory

### Main User-Facing Pages

| Route | File | Type | Purpose |
|-------|------|------|---------|
| `/` | `src/app/page.tsx` | Client | **Home page** - Search bar, import from AI modal |
| `/login` | `src/app/login/page.tsx` | Client | **Authentication** - Login/signup with email/password |
| `/results` | `src/app/results/page.tsx` | Client | **Main editor** - View/edit explanations, AI editing panel, tags, bibliography |
| `/explanations` | `src/app/explanations/page.tsx` | Server | **Explore gallery** - Browse recent explanations with sorting/filtering |
| `/userlibrary` | `src/app/userlibrary/page.tsx` | Client | **User library** - Saved explanations for logged-in user |
| `/settings` | `src/app/settings/page.tsx` | Client | **Settings** - Theme customization (dynamic import to avoid hydration) |
| `/error` | `src/app/error/page.tsx` | Client | **Error display** - User-friendly error page with recovery options |

### Admin Pages (Protected)

| Route | File | Type | Purpose |
|-------|------|------|---------|
| `/admin` | `src/app/admin/page.tsx` | Client | **Redirect** - Redirects to `/admin/whitelist` |
| `/admin/whitelist` | `src/app/admin/whitelist/page.tsx` | Client | **Link management** - Tab-based whitelist and candidates management |

**Admin Layout** (`src/app/admin/layout.tsx`):
- Client-side email whitelist check
- Redirects unauthorized users to home
- `ADMIN_EMAILS = ['abecha@gmail.com']`

### Debug & Test Pages (Route Group: `(debug)`)

All debug pages are accessible without the `(debug)` prefix in the URL.

| Route | File | Purpose |
|-------|------|---------|
| `/editorTest` | `src/app/(debug)/editorTest/page.tsx` | **AI Pipeline Testing** - Comprehensive 4-stage AI suggestion pipeline test with validation dashboard, session loading, fixture export |
| `/diffTest` | `src/app/(debug)/diffTest/page.tsx` | **Markdown Diff** - Test CriticMarkup generation from before/after markdown |
| `/mdASTdiff_demo` | `src/app/(debug)/mdASTdiff_demo/page.tsx` | **AST Diff Demo** - Interactive markdown AST diffing with test suite runner |
| `/resultsTest` | `src/app/(debug)/resultsTest/page.tsx` | **Diff Tag Hover** - Test accept/reject buttons on CriticMarkup diff tags |
| `/streaming-test` | `src/app/(debug)/streaming-test/page.tsx` | **SSE Streaming** - Test streaming responses from `/api/stream-chat` |
| `/latex-test` | `src/app/(debug)/latex-test/page.tsx` | **LaTeX Rendering** - Test KaTeX inline/block math rendering |
| `/tailwind-test` | `src/app/(debug)/tailwind-test/page.tsx` | **Tailwind CSS** - Visual test for colors, typography, prose plugin |
| `/typography-test` | `src/app/(debug)/typography-test/page.tsx` | **Typography** - Compare prose vs non-prose text styling |
| `/test-client-logging` | `src/app/(debug)/test-client-logging/page.tsx` | **Client Logging** - Test runtime interception, promises, fetch, DOM operations |
| `/test-global-error` | `src/app/(debug)/test-global-error/page.tsx` | **Error Boundary** - Intentionally throw errors to test global-error.tsx |

### API Routes

#### Core Application APIs

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/returnExplanation` | POST | **Generate explanations** - Streaming explanation generation with source resolution |
| `/api/stream-chat` | POST | **Chat streaming** - SSE streaming chat interface |
| `/api/runAISuggestionsPipeline` | POST | **AI suggestions** - Run full AI editing pipeline |
| `/api/fetchSourceMetadata` | POST | **Source metadata** - Fetch metadata for user-provided URLs |

#### Health & Monitoring

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/health` | GET | **Health check** - Database, environment, required tags validation (200/503) |
| `/api/monitoring` | GET, POST | **Sentry tunnel** - Bypass ad blockers for Sentry events |
| `/api/traces` | POST, OPTIONS | **OTLP proxy** - Forward browser traces to Honeycomb |
| `/api/client-logs` | POST | **Client logging** - Write client logs to file and OTLP |

#### Testing APIs

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/test-cases` | GET | **Load test cases** - Read `test_cases.txt` for markdown diff tests |
| `/api/test-responses` | GET | **Run tests** - Execute all tests and write `test_responses.txt` |

#### Authentication

| Route | Methods | Purpose |
|-------|---------|---------|
| `/auth/callback` | GET | **OAuth callback** - Exchange auth code for session |
| `/auth/confirm` | GET | **Email confirmation** - Verify OTP token for email signup |

### Page Usage Summary

**Production Pages (7):**
- Home, Login, Results, Explanations, User Library, Settings, Error

**Admin Pages (2):**
- Admin redirect, Whitelist management

**Debug/Test Pages (10):**
- Editor test, Diff test, AST demo, Results test, Streaming test, LaTeX test, Tailwind test, Typography test, Client logging test, Global error test

**API Routes (12):**
- Core: 4 (returnExplanation, stream-chat, runAISuggestionsPipeline, fetchSourceMetadata)
- Health/Monitoring: 4 (health, monitoring, traces, client-logs)
- Testing: 2 (test-cases, test-responses)
- Auth: 2 (callback, confirm)

---

## Link Whitelist System (Existing Admin Feature)

The link whitelist system is the primary existing admin feature. Understanding its architecture provides a template for building additional admin functionality.

### Purpose

Automatically links key terms and headings to related explanations. When a user reads an article, terms matching the whitelist become clickable links to explanatory content.

### 6-Table Database Architecture

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `link_whitelist` | Canonical terms with URLs | `canonical_term`, `standalone_title`, `is_active` |
| `link_whitelist_aliases` | Alternative names for terms | `whitelist_id`, `alias_term` |
| `link_whitelist_snapshot` | JSON cache (single row, id=1) | `version`, `data`, `updated_at` |
| `article_heading_links` | Per-article heading mappings | `explanation_id`, `heading_text`, `standalone_title` |
| `article_link_overrides` | Per-article customizations | `explanation_id`, `term`, `override_type`, `custom_standalone_title` |
| `link_candidates` | Pending terms for approval | `term`, `status`, `total_occurrences`, `article_count`, `source` |

### Service Layer Architecture

**Three main service files:**

1. **`src/lib/services/linkWhitelist.ts`** (697 lines)
   - Whitelist CRUD: `createWhitelistTerm`, `updateWhitelistTerm`, `deleteWhitelistTerm`
   - Alias management: `addAliases`, `removeAlias`, `getAliasesForTerm`
   - Snapshot cache: `rebuildSnapshot`, `getSnapshot`, `getActiveWhitelistAsMap`
   - Heading links: `saveHeadingLinks`, `getHeadingLinksForArticle`, `generateHeadingStandaloneTitles`

2. **`src/lib/services/linkCandidates.ts`** (502 lines)
   - Candidate CRUD: `upsertCandidate`, `getCandidateById`, `getAllCandidates`, `deleteCandidate`
   - Occurrence tracking: `upsertOccurrence`, `getOccurrencesForExplanation`, `countTermOccurrences`
   - Approval workflow: `approveCandidate` (creates whitelist entry), `rejectCandidate`
   - Aggregation: `recalculateCandidateAggregates`, `saveCandidatesFromLLM`

3. **`src/lib/services/linkResolver.ts`** (381 lines)
   - Link resolution: `resolveLinksForArticle` - the core render-time algorithm
   - Override management: `setOverride`, `removeOverride`, `getOverridesForArticle`
   - Content transformation: `applyLinksToContent` - injects markdown links

### Link Resolution Algorithm

The `resolveLinksForArticle` function follows this process:

1. **Headings First**: H2/H3 headings are always linked, with AI-generated standalone titles cached in `article_heading_links`
2. **Key Terms**: Matched from whitelist snapshot (longest-first to prioritize longer matches)
3. **First Occurrence Only**: Each term is linked only once per article
4. **Exclusion Zones**: Heading regions are excluded from term matching to prevent double-linking
5. **Word Boundaries**: Custom boundary checking (preserves hyphens in compound terms)
6. **Overlap Prevention**: No overlapping links allowed

### Caching Strategy

The snapshot cache is critical for performance:

```typescript
// Single-row snapshot table with version tracking
const snapshot = await getSnapshot();
// Returns: { id: 1, version: 42, data: { "term": { canonical_term, standalone_title }, ... }, updated_at }

// Rebuilt on ANY whitelist mutation (create, update, delete, add/remove alias)
await rebuildSnapshot();
```

- **Case-insensitive matching** via `_lower` columns on all term fields
- **Atomic version increment** prevents stale cache issues
- **Combines active terms + resolved aliases** at build time

### Admin UI Components

**`src/components/admin/WhitelistContent.tsx`** (407 lines):
- Table display of all whitelist terms
- Create/Edit modal for terms (canonical_term, standalone_title, description, is_active)
- Alias management modal (add/remove aliases for a term)
- Delete confirmation with cascade warning

**`src/components/admin/CandidatesContent.tsx`** (284 lines):
- Table display with status filtering (pending/approved/rejected/all)
- Sortable by `total_occurrences` (most common terms surface first)
- Approve modal with standalone title input (pre-fills "What is {term}?")
- Reject and Delete actions
- Displays: term, source, occurrences, article count, status, first seen date

### Candidate Workflow

1. **LLM Extraction**: During article generation, AI extracts potential link candidates
2. **Candidate Creation**: `saveCandidatesFromLLM` upserts candidates with occurrence counts
3. **Admin Review**: Admin reviews candidates in `/admin/whitelist?tab=candidates`
4. **Approval**: `approveCandidate` creates whitelist entry + updates candidate status
5. **Rejection**: `rejectCandidate` marks as rejected (kept for deduplication)

### Override Types

| Type | Behavior | Use Case |
|------|----------|----------|
| `disabled` | Term skipped entirely | Term inappropriate for specific article |
| `custom_title` | Uses custom standalone title | Better title for specific context |
| (none) | Uses whitelist default | Normal behavior |

### Server Actions for Admin

The admin actions follow the standard pattern:

```typescript
// From src/actions/actions.ts

// Whitelist Management
export const createWhitelistTermAction = serverReadRequestId(_createWhitelistTermAction);
export const updateWhitelistTermAction = serverReadRequestId(_updateWhitelistTermAction);
export const deleteWhitelistTermAction = serverReadRequestId(_deleteWhitelistTermAction);
export const getAllWhitelistTermsAction = serverReadRequestId(_getAllWhitelistTermsAction);
export const getAliasesForTermAction = serverReadRequestId(_getAliasesForTermAction);
export const addAliasesAction = serverReadRequestId(_addAliasesAction);
export const removeAliasAction = serverReadRequestId(_removeAliasAction);

// Candidate Management
export const getAllCandidatesAction = serverReadRequestId(_getAllCandidatesAction);
export const approveCandidateAction = serverReadRequestId(_approveCandidateAction);
export const rejectCandidateAction = serverReadRequestId(_rejectCandidateAction);
export const deleteCandidateAction = serverReadRequestId(_deleteCandidateAction);
```

### Key Patterns from Link Whitelist (For New Admin Features)

1. **Snapshot Caching**: Pre-compute expensive lookups, rebuild on mutations
2. **Aggregate Tracking**: Maintain counts (`total_occurrences`, `article_count`) for sorting/filtering
3. **Status Workflow**: Pending → Approved/Rejected flow for moderation
4. **Junction Tables**: `_lower` columns for case-insensitive matching
5. **Modal-Based CRUD**: Modals for create/edit, inline actions for delete
6. **Tab-Based Navigation**: URL params for tab state (`?tab=candidates`)
7. **Optimistic UI**: Update local state, then refresh from server

---

## Import Sources Feature (Related Planning)

The import sources feature (`docs/planning/import_sources/`) provides additional patterns for admin functionality:

### Source Caching System

```sql
source_cache:
  - url (unique)
  - title, favicon_url, domain
  - extracted_text
  - is_summarized (boolean)
  - fetch_status ('pending', 'success', 'failed')
  - expires_at (7-day TTL)
```

### Key Patterns

1. **Global Cache with Expiry**: Shared across users, auto-expires
2. **Fetch Status Tracking**: Pending/success/failed workflow
3. **Content Summarization**: Auto-summarize long content with cheaper LLM
4. **Junction Tables**: `article_sources` links explanations to cached sources

### Admin Implications

- Source cache could be viewable/manageable in admin panel
- Manual cache invalidation for specific URLs
- Failed fetch review and retry functionality

---

## Deletion Architecture

Understanding deletion dependencies is critical for admin operations. The codebase uses a mix of database cascades and manual cleanup.

### Explanation Deletion

#### Tables with ON DELETE CASCADE (Auto-deleted)

| Table | FK Column | Notes |
|-------|-----------|-------|
| `article_sources` | `explanation_id` | Sources linked to explanation |
| `article_heading_links` | `explanation_id` | Cached heading links |
| `article_link_overrides` | `explanation_id` | Per-article link customizations |
| `candidate_occurrences` | `explanation_id` | Link candidate occurrence tracking |

#### Tables with ON DELETE SET NULL

| Table | FK Column | Notes |
|-------|-----------|-------|
| `link_candidates` | `first_seen_explanation_id` | Preserves candidate, loses first-seen ref |

#### Tables Requiring Manual Cleanup (No FK or No CASCADE)

| Table | Column | Issue |
|-------|--------|-------|
| `explanation_tags` | `explanation_id` | **No FK constraint defined** |
| `explanationMetrics` | `explanationid` | **No FK constraint defined** |
| `userLibrary` | `explanationid` | No DELETE clause on FK |
| `userExplanationEvents` | `explanationid` | **No FK constraint defined** |
| `userQueries` | `explanation_id` | No DELETE clause on FK |

#### Correct Deletion Order for Explanations

```
1. Delete Pinecone vectors (external service)
2. Manual cleanup:
   - userLibrary (WHERE explanationid = ?)
   - explanationMetrics (WHERE explanationid = ?)
   - explanation_tags (WHERE explanation_id = ?)
   - link_candidates (WHERE first_seen_explanation_id = ?)
3. Delete explanations record
   └─ Database CASCADE auto-cleans:
      • article_sources
      • article_heading_links
      • article_link_overrides
      • candidate_occurrences
```

**Reference Implementation**: `src/__tests__/e2e/helpers/test-data-factory.ts:270-288`

#### Key Issues

- **No user-facing delete API** - Deletion only in test cleanup code
- **Hard delete only** - No soft delete (`is_deleted` flag) on explanations
- **Three tables missing FK constraints**: `explanation_tags`, `explanationMetrics`, `userExplanationEvents`

---

### User Deletion

#### User Identity Model

- Uses **Supabase Auth's native `auth.users` table** (not a custom users table)
- User IDs are **UUID format**
- Identified by `userid` column throughout application tables
- **No `created_by` column on `explanations`** - can't identify user's created content

#### Tables with User References

| Table | Column | RLS Policy | Notes |
|-------|--------|------------|-------|
| `userLibrary` | `userid` | User-isolated | Bookmarked explanations |
| `userQueries` | `userid` | User-isolated | Search history |
| `userExplanationEvents` | `userid` | User-isolated | User interactions |
| `llmCallTracking` | `userid` | User-isolated | LLM API usage |

**Important**: None of these have FK constraints to `auth.users` - just RLS policies using `auth.uid() = userid`.

#### User Deletion Strategies

**Option A: Soft Delete (Current Pattern)**
- Delete only user-specific records
- Explanations become orphaned (persist without owner)
- Order:
  1. `userLibrary` (WHERE userid = ?)
  2. `userQueries` (WHERE userid = ?)
  3. `userExplanationEvents` (WHERE userid = ?)
  4. `llmCallTracking` (WHERE userid = ?)
  5. `auth.users` via Supabase Auth admin API

**Option B: Hard Delete (Requires Schema Change)**
- Would require adding `created_by` column to `explanations`
- Delete all user-created content
- More complex cascade through explanation dependencies

**Reference Implementation**: `src/__tests__/e2e/setup/global-teardown.ts:139-178`

#### Missing Pieces for Production User Deletion

1. **No `created_by` tracking** - Can't identify user's authored explanations
2. **No delete server action** - No `deleteUserAccountAction` exists
3. **No UI** - Settings page lacks account deletion
4. **No audit logging** - No deletion event tracking

---

### Deletion Summary Table

| Entity | Strategy | Auto-Cascade | Manual Cleanup | External |
|--------|----------|--------------|----------------|----------|
| Explanation | Hard delete | 4 tables | 5 tables | Pinecone |
| User | Soft delete | None | 4 tables | auth.users |

### Admin Actions Needed

For a complete admin panel, implement:

```typescript
// Explanation management
deleteExplanationAction(explanationId: number)
bulkDeleteExplanationsAction(explanationIds: number[])

// User management
deleteUserAccountAction(userId: string)
getUserDataSummaryAction(userId: string) // For preview before delete
```

---

## Deep Dive: Admin UI Component Patterns

### Button Patterns

**File:** `src/components/ui/button.tsx` (Lines 1-62)

**Button Variants Available:**
| Variant | Style | Use Case |
|---------|-------|----------|
| `default` | Gold gradient with warm shadow | Primary actions |
| `destructive` | Terracotta/rust tones | Delete, dangerous actions |
| `outline` | Bordered with gold hover | Secondary actions |
| `secondary` | Muted scholarly look | Cancel, dismiss |
| `ghost` | Minimal text-like | Inline actions |
| `link` | Gold underline | Navigation |
| `scholar` | Animated gold gradient | Special emphasis |

**Button Sizes:** `default` (h-10), `sm` (h-8), `lg` (h-11), `icon` (h-10 w-10)

**Admin Implementation Pattern:**
```tsx
// Primary action (WhitelistContent.tsx:86-90)
<button className="px-4 py-2 bg-[var(--accent-gold)] text-[var(--text-on-primary)] rounded hover:opacity-90">
  Add Term
</button>

// Action buttons (CandidatesContent.tsx:150-155)
<button className="px-3 py-1 text-sm text-green-400 hover:text-green-300">Approve</button>
<button className="px-3 py-1 text-sm text-yellow-400 hover:text-yellow-300">Reject</button>
<button className="px-3 py-1 text-sm text-red-400 hover:text-red-300">Delete</button>
```

### Table Patterns

**WhitelistContent.tsx (Lines 126-180):**
- Basic HTML `<table>` with semantic markup
- Gold-accented headers: `bg-[var(--surface-elevated)]`
- Row hover: `hover:bg-[var(--surface-secondary)]`
- Status badges: `bg-green-500/20 text-green-400` (active) / `bg-gray-500/20 text-gray-400` (inactive)
- No pagination - renders all items

**CandidatesContent.tsx (Lines 119-192):**
- 7-column table with status filtering
- Date formatting helper function
- Conditional action buttons based on status

**ExplanationsTablePage.tsx (Lines 81-243):**
- **Sortable** with client-side sorting
- Click handlers on column headers with arrow indicators
- Sticky header: `sticky top-0 z-10`
- Row striping with alternating backgrounds
- Horizontal scroll: `overflow-x-auto max-h-[70vh]`

**Common Table Structure:**
```tsx
<div className="scholar-card overflow-hidden">
  <table className="w-full">
    <thead className="bg-[var(--surface-elevated)]">
      <tr>
        <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Header</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-[var(--border-default)]">
      <tr className="hover:bg-[var(--surface-secondary)]">
        <td className="px-4 py-3 text-[var(--text-primary)]">Data</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Form Patterns

**Current Admin Forms (WhitelistContent.tsx:155-197):**
- Manual `useState` for form data (NOT React Hook Form)
- Individual field updates via spread: `setFormData({ ...formData, field: value })`
- Custom input styling with focus states
- Checkbox pattern: `checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}`

**Available Form Components (ui/form.tsx):**
- `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`
- `FormDescription`, `FormMessage` for validation errors
- React Hook Form + Zod integration available but not used in current admin

### Modal Patterns

**Custom Modal (WhitelistContent.tsx:234-348):**
```tsx
{modalMode && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-[var(--surface-primary)] rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-display text-[var(--text-primary)]">Title</h2>
          <button onClick={closeModal}>×</button>
        </div>
        {/* Modal content based on modalMode */}
      </div>
    </div>
  </div>
)}
```

**Modal Modes:** `'create' | 'edit' | 'aliases' | null`

**Radix Dialog Components (ui/dialog.tsx):**
- DialogContent, DialogHeader, DialogTitle, DialogDescription
- Built-in animations with `data-[state=open]:animate-in`
- Overlay with backdrop fade

### Additional UI Patterns

**Loading States:**
```tsx
// Skeleton loader (WhitelistContent.tsx:117-125)
<div className="animate-pulse space-y-4">
  {[...Array(5)].map((_, i) => (
    <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded" />
  ))}
</div>
```

**Error Banner:**
```tsx
<div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded mb-4">
  {error}
  <button onClick={() => setError(null)} className="ml-2">&times;</button>
</div>
```

**Tab Navigation (whitelist/page.tsx:59-78):**
- URL query params: `router.push(?tab=${tab})`
- Active state styling with gold accent
- Dynamic imports with SSR disabled

---

## Deep Dive: Testing Patterns for Admin

### E2E Test Infrastructure

**Directory:** `src/__tests__/e2e/`

**Auth Setup (`setup/auth.setup.ts`):**
- Custom Playwright fixture with `authenticatedPage`
- API-based auth via Supabase (not UI login)
- Session caching per worker (1-hour expiry)
- Cookie injection: `sb-{projectRef}-auth-token` in base64url format
- Retry logic with exponential backoff (max 5 retries)

**Global Setup (`setup/global-setup.ts`):**
- Server readiness via `/api/health` endpoint
- Test fixture seeding: topics, explanations, tags
- Production safety verification (TEST_USER_ID/EMAIL cross-validation)

**Global Teardown (`setup/global-teardown.ts`):**
- Defense-in-depth cleanup with multiple strategies
- Cleans: userLibrary, userQueries, userExplanationEvents, llmCallTracking
- Pinecone vector cleanup
- Pattern-matched cleanup: `test-%` (legacy) and `[TEST]%` (current)

### Test Data Factory

**File:** `src/__tests__/e2e/helpers/test-data-factory.ts`

**Key Functions:**
| Function | Purpose |
|----------|---------|
| `createTestExplanation()` | Creates with `[TEST]` prefix |
| `createTestExplanationInLibrary()` | Creates and adds to user library |
| `createTestTag()` | Creates tag with `[TEST]` prefix |
| `getOrCreateTestTopic()` | Idempotent upsert for topics |
| `deleteExplanationById()` | Pinecone + cascading deletes |
| `trackExplanationForCleanup()` | File-based tracking for defense-in-depth |

**Test Prefix:** `TEST_CONTENT_PREFIX = '[TEST]'`

### No Dedicated Admin E2E Tests

**Important Finding:** No E2E test specs exist for admin pages in `src/__tests__/e2e/specs/`.

Admin functionality currently tested via:
- Unit tests for services (`linkWhitelist.test.ts`)
- Unit tests for schemas (`schemas.test.ts`)
- Server action exports with error handling

### Unit Test Patterns

**Mocking Strategy (`linkWhitelist.test.ts`):**
```typescript
// Jest with Node environment
const createMockSupabase = () => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
});
```

---

## Deep Dive: Analytics & Observability

### Metrics System

**Table:** `explanationMetrics`

| Column | Type | Purpose |
|--------|------|---------|
| `explanationid` | integer | FK to explanations |
| `total_saves` | integer | Count from userLibrary |
| `total_views` | integer | Sum from userExplanationEvents |
| `save_rate` | numeric(5,4) | saves/views ratio |
| `last_updated` | timestamptz | Last refresh time |

**Core Functions (`src/lib/services/metrics.ts`):**

| Function | Purpose |
|----------|---------|
| `createUserExplanationEvent()` | Insert event, auto-increment views |
| `refreshExplanationMetrics()` | Recalculate from source tables |
| `getMultipleExplanationMetrics()` | Bulk fetch metrics |
| `incrementExplanationViews()` | RPC call to increment |
| `incrementExplanationSaves()` | RPC call to increment |

**Stored Procedures:**
- `increment_explanation_saves(p_explanation_id)` - UPSERT with rate recalc
- `increment_explanation_views(p_explanation_id)` - UPSERT with rate recalc
- `refresh_explanation_metrics(explanation_ids[])` - Bulk refresh from source
- `refresh_all_explanation_metrics()` - Full table refresh

### LLM Call Tracking

**Table:** `llmCallTracking` (12,086 rows)

Tracks every OpenAI API call:
- `prompt`, `content`, `raw_api_response`
- Token counts: `prompt_tokens`, `completion_tokens`, `total_tokens`, `reasoning_tokens`
- `model`, `finish_reason`, `call_source`
- `userid` for per-user attribution

### Observability Stack

| Tool | Purpose | Configuration |
|------|---------|---------------|
| **Sentry** | Error tracking + Logs | `sentry.*.config.ts` |
| **Honeycomb** | Distributed tracing (OTLP) | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| **OpenTelemetry** | Custom tracers | LLM/DB/Vector/App spans |
| **server.log** | Local file logging | JSON lines with context |

**Custom Tracers (`instrumentation.ts`):**
- `explainanything-llm` - LLM API calls with token counts
- `explainanything-database` - Supabase operations
- `explainanything-vector` - Pinecone operations
- `explainanything-application` - Business logic

**Logging Flow:**
```
Logger → Console
      → File (server.log)
      → Sentry (breadcrumb + Logs)
      → Honeycomb (OTLP via emitLog)
```

### No Audit Logging System

**Current State:** No dedicated audit trail for admin actions.

**What exists:**
- `userExplanationEvents` - user-facing events only
- `llmCallTracking` - API usage (not admin actions)
- File/Sentry logging - function calls with context

**Missing for admin audit:**
- No `audit_log` table
- No tracking of: content edits, deletions, policy changes
- No immutable event log

---

## Deep Dive: User Management & RBAC

### Current Admin Auth Pattern

**File:** `src/app/admin/layout.tsx`

```typescript
const ADMIN_EMAILS = ['abecha@gmail.com'];  // Line 8

useEffect(() => {
  const { data: { user } } = await supabase_browser.auth.getUser();
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
    router.replace('/');
    return;
  }
  setIsAuthorized(true);
}, [router]);
```

**Characteristics:**
- Client-side only protection
- Hardcoded email list (not database-driven)
- No server-side enforcement on admin actions
- Single admin level (no roles)

### User Data Model

**User Tables (all use `userid: uuid`):**

| Table | Purpose | RLS Policy |
|-------|---------|------------|
| `userLibrary` | Saved explanations | User-isolated INSERT |
| `userQueries` | Search history | User-isolated INSERT |
| `userExplanationEvents` | Interaction events | User-isolated SELECT |
| `llmCallTracking` | LLM usage | User-isolated INSERT |

**RLS Pattern:**
```sql
CREATE POLICY "Enable insert for own user only" ON public."userLibrary"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = userid);
```

### Service Role Client

**File:** `src/lib/utils/supabase/server.ts:40-51`

```typescript
export function createServiceSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // Bypasses RLS
    { auth: { persistSession: false } }
  );
}
```

**Used for:**
- Metrics aggregation
- Bulk admin operations
- System-level data processing

### What's Missing for Full User Management

| Feature | Status |
|---------|--------|
| Roles table | ❌ Not implemented |
| Permission groups | ❌ Not implemented |
| User management UI | ❌ Not implemented |
| Role assignment | ❌ Not implemented |
| Permission middleware | ❌ Not implemented |
| Audit logging | ❌ Not implemented |
| User status/activation | ❌ Not implemented |

### RBAC Options to Consider

1. **Database `admin_users` table** - Store roles with RLS policies
2. **Supabase Auth custom claims** - JWT-based roles
3. **Environment variable whitelist** - Move from hardcoded to config
4. **Dedicated permission service** - Centralized permission checks

---

## Research Metadata

**Date:** 2026-01-15T06:45:28-0800
**Git Commit:** d925d1487e26204482ed2f36d266c07b5b4263d8
**Branch:** fix/create_admin_site_20260114
**Repository:** explainanything
