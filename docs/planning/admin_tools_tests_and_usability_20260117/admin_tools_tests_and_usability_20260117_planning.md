# Admin Tools Tests and Usability Plan

## Background

The admin panel for ExplainAnything was implemented in January 2026 with comprehensive features: content management, user management, cost analytics, audit logging, and feature flags. The backend has 100% unit test coverage across 8 services. However, the frontend has zero test coverage and several usability gaps were identified during research including missing success feedback, accessibility violations, and no `data-testid` attributes for E2E testing.

## Problem

1. **Zero E2E tests** - No Playwright tests exist for any admin functionality, leaving critical admin workflows untested
2. **Zero data-testid attributes** - Completely blocks E2E test development; no stable selectors exist
3. **No success feedback** - Users receive no confirmation when admin actions succeed (only error states shown)
4. **Accessibility violations** - 5 modals lack `role="dialog"`, `aria-labelledby`, focus trap, and keyboard navigation
5. **Documentation gaps** - `docs/feature_deep_dives/admin_panel.md` is an empty stub

## Options Considered

### Sequencing Options

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| A | Feature-based (testids first, then Toast, then a11y) | Clear phases | Touch each file multiple times |
| B | Batch all changes together | Single pass per file | Large PRs, E2E blocked until end |
| **C** | **Component-based (complete one component at a time)** | **Incremental E2E, focused PRs** | **Longer before full coverage** |

**Decision**: Option C - Complete each component fully (testids + Toast + a11y + E2E) before moving to next.

### Implementation Options

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Toast timing | With first component vs. with first component that needs it | With ExplanationTable | AdminSidebar has no actions needing toasts |
| Focus trap | Custom hook vs. `focus-trap-react` vs. shadcn Dialog | `focus-trap-react` | Battle-tested, minimal effort, 2M+ weekly downloads |
| E2E auth | Temp admin in test vs. dedicated test account | Dedicated account | Consistent with existing E2E patterns |
| Test scope | Critical-only vs. comprehensive vs. tiered | Tiered | P0 comprehensive, P1/P2 minimal |
| Critical tests | 0 vs. 1 vs. 2 `@critical` | 1 smoke test | Keeps CI fast, catches auth/routing breaks |

---

## Phase 0: Prerequisites (Before Any Component Work)

**Goal**: Set up infrastructure required by all subsequent phases

### 0.1 Install Dependencies

```bash
npm install focus-trap-react
```

**Verification**: Run `npm ls focus-trap-react` to confirm installation.

### 0.2 Create Toast Component (shadcn)

Toast is a **shared dependency** used by Phases 2-6. Create it upfront to unblock component work.

**Files to create:**
```
src/components/ui/toast.tsx       # Toast UI component
src/components/ui/use-toast.tsx   # Toast hook (useToast)
src/components/ui/toaster.tsx     # Toaster provider component
```

**Implementation**: Use shadcn/ui toast pattern:
```bash
npx shadcn@latest add toast
```

**Verification**: Import `useToast` in a test file, confirm no TypeScript errors.

**Toast Provider Mounting**: `<Toaster />` will be added to `src/app/admin/layout.tsx` in Phase 2 (not root layout, to avoid affecting non-admin pages).

### 0.3 Admin Test User Setup

**Environment Variables** (add to `.env.local` and GitHub secrets):
```bash
# Add to .env.local for local development
ADMIN_TEST_EMAIL=admin-test@explainanything.com
ADMIN_TEST_PASSWORD=<secure-test-password-min-12-chars>
```

**Password Requirements**: Minimum 12 characters, mixed case, numbers required.

**Database Seeding Strategy**:

1. **For local development**: Add seed script `scripts/seed-admin-test-user.ts`:
```typescript
// scripts/seed-admin-test-user.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function seedAdminTestUser() {
  const email = process.env.ADMIN_TEST_EMAIL;
  const password = process.env.ADMIN_TEST_PASSWORD;

  // Validate password strength
  if (!password || password.length < 12) {
    throw new Error('ADMIN_TEST_PASSWORD must be at least 12 characters');
  }

  // Verify this is different from regular test user
  if (email === process.env.TEST_USER_EMAIL) {
    throw new Error('ADMIN_TEST_EMAIL must differ from TEST_USER_EMAIL');
  }

  // 1. Create auth user (or get existing)
  const { data: authUser } = await supabase.auth.admin.listUsers();
  let userId = authUser?.users.find(u => u.email === email)?.id;

  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error) throw new Error(`Failed to create admin user: ${error.message}`);
    userId = data.user?.id;
  }

  if (!userId) throw new Error('Failed to get admin user ID');

  // 2. Add to admin_users table
  const { error: upsertError } = await supabase.from('admin_users').upsert({
    user_id: userId,
    role: 'admin',
    created_by: userId
  }, { onConflict: 'user_id' });

  if (upsertError) throw new Error(`Failed to upsert admin_users: ${upsertError.message}`);

  console.log(`✓ Admin test user seeded: ${email} (${userId})`);
}

seedAdminTestUser().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
```

2. **For CI**: Add seed step to `.github/workflows/ci.yml` in BOTH E2E jobs:
```yaml
# Add to e2e-critical job (after "Install dependencies" step, before "Run E2E tests"):
- name: Seed admin test user
  run: npx tsx scripts/seed-admin-test-user.ts
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    ADMIN_TEST_EMAIL: ${{ secrets.ADMIN_TEST_EMAIL }}
    ADMIN_TEST_PASSWORD: ${{ secrets.ADMIN_TEST_PASSWORD }}
    TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}

# Add identical step to e2e-full job
```

3. **GitHub Secrets to add** (staging environment - matches existing CI):
   - `ADMIN_TEST_EMAIL` - e.g., `admin-test@explainanything.com`
   - `ADMIN_TEST_PASSWORD` - secure password (min 12 chars)

**Verification before tests**:
```bash
# Local: Run seed and verify
npx tsx scripts/seed-admin-test-user.ts
```

### 0.4 Verify TEST_USER is Not Admin

**Critical**: The non-admin redirect test uses existing `TEST_USER_EMAIL`. We must verify this user is NOT in `admin_users` table.

Add verification to seed script:
```typescript
// Add at end of seedAdminTestUser():
// Verify TEST_USER is not an admin (for non-admin redirect test)
const regularTestEmail = process.env.TEST_USER_EMAIL;
if (regularTestEmail) {
  const { data: regularUser } = await supabase.auth.admin.listUsers();
  const regularUserId = regularUser?.users.find(u => u.email === regularTestEmail)?.id;

  if (regularUserId) {
    const { data: adminCheck } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', regularUserId)
      .single();

    if (adminCheck) {
      throw new Error(`TEST_USER (${regularTestEmail}) is in admin_users! Remove before running tests.`);
    }
    console.log(`✓ Verified TEST_USER (${regularTestEmail}) is not an admin`);
  }
}
```

### 0.5 Admin Auth Fixture

**File**: `src/__tests__/e2e/fixtures/admin-auth.ts`

**IMPORTANT**: Must follow existing cookie pattern from `auth.ts` exactly:
- Cookie name: `sb-{projectRef}-auth-token` (NOT `sb-access-token`)
- Cookie value: `base64-{base64url-encoded-session}` (NOT plain token)

```typescript
// Admin authentication fixture - follows exact pattern from auth.ts
import { test as base, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { needsBypassCookie, loadBypassCookieState } from '../setup/vercel-bypass';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Cache admin session per worker
let cachedAdminSession: AdminSessionData | null = null;
let adminSessionExpiry = 0;

interface AdminSessionData {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

/**
 * Authenticates as admin user with retry logic.
 * Uses ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD env vars.
 */
async function authenticateAdmin(retries = 3): Promise<AdminSessionData> {
  const now = Date.now();
  if (cachedAdminSession && adminSessionExpiry > now + 5 * 60 * 1000) {
    console.log('   ✓ Using cached admin session');
    return cachedAdminSession;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.ADMIN_TEST_EMAIL!,
      password: process.env.ADMIN_TEST_PASSWORD!,
    });

    if (!error && data.session && data.user) {
      console.log(`   ✓ Admin auth succeeded: ${data.user.email}`);
      cachedAdminSession = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: { id: data.user.id, email: data.user.email! },
      };
      adminSessionExpiry = now + (data.session.expires_in || 3600) * 1000;
      return cachedAdminSession;
    }

    if (attempt < retries) {
      const delay = 2000 * Math.pow(1.5, attempt - 1);
      console.warn(`Admin auth attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error('Admin auth failed after retries');
}

type AdminFixtures = {
  adminPage: Page;
  adminUserId: string;
};

export const adminTest = base.extend<AdminFixtures>({
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const session = await authenticateAdmin();

    // Extract project ref from Supabase URL (matches auth.ts pattern)
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const projectRef = supabaseUrl.hostname.split('.')[0];

    // Cookie domain and secure flag from BASE_URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3008';
    const cookieDomain = new URL(baseUrl).hostname;
    const isSecure = baseUrl.startsWith('https');
    const cookieName = `sb-${projectRef}-auth-token`;

    // Create session object in Supabase SSR format
    const sessionData = {
      access_token: session.access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: session.refresh_token,
      user: session.user,
    };

    // Encode as base64url with 'base64-' prefix (Supabase SSR format)
    const base64 = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const cookieValue = `base64-${base64url}`;

    // Set auth cookie (exact pattern from auth.ts)
    await context.addCookies([{
      name: cookieName,
      value: cookieValue,
      domain: cookieDomain,
      path: '/',
      httpOnly: false,
      secure: isSecure,
      sameSite: isSecure ? 'None' : 'Lax',
    }]);

    // Add Vercel bypass cookie if needed
    if (needsBypassCookie()) {
      const bypassState = loadBypassCookieState();
      if (bypassState?.cookie) {
        await context.addCookies([bypassState.cookie]);
      }
    }

    await use(page);
    await context.close();
  },

  // Extract user ID from cached session (no DB query needed)
  adminUserId: async ({}, use) => {
    const session = await authenticateAdmin();
    await use(session.user.id);
  },
});

export { expect };
```

**Key differences from regular auth fixture**:
- Uses `ADMIN_TEST_EMAIL` / `ADMIN_TEST_PASSWORD` (not `TEST_USER_EMAIL`)
- Provides `adminPage` and `adminUserId` fixtures
- User ID extracted from JWT (no service role key needed in tests)

### 0.5 Test Data Factory Extensions

**File**: `src/__tests__/e2e/helpers/test-data-factory.ts` (add to existing)

```typescript
// Admin-specific test data helpers

/**
 * Create a test content report for E2E tests
 * Uses [TEST] prefix for cleanup
 */
export async function createTestReport(explanationId: string): Promise<string> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from('content_reports')
    .insert({
      explanation_id: explanationId,
      reason: 'spam',
      details: '[TEST] E2E test report',
      status: 'pending'
    })
    .select('id')
    .single();

  if (error) throw error;
  trackReportForCleanup(data.id);
  return data.id;
}

/**
 * Cleanup tracked test reports
 */
export async function cleanupTestReports(): Promise<void> {
  const supabase = getServiceRoleClient();
  await supabase
    .from('content_reports')
    .delete()
    .ilike('details', '[TEST]%');
}
```

---

## Phased Execution Plan (By Component)

### Phase 1: AdminSidebar + Auth Infrastructure
**Goal**: Quick win, establish patterns, create E2E infrastructure

**Changes:**
- Add `data-testid` to 8 nav links + back link (~9 attributes)
- No Toast needed (no actions)
- No modals (no a11y changes)

**E2E Tests** (in `src/__tests__/e2e/specs/09-admin/`):
- `admin-auth.spec.ts`: 2 tests
  - `@critical` "Admin dashboard loads for admin user"
  - "Non-admin user redirected to home page" ← **Critical auth flow**

**Files to create:**
```
src/__tests__/e2e/specs/09-admin/admin-auth.spec.ts
src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts
```

**data-testid attributes to add:**
```
admin-sidebar-nav-dashboard
admin-sidebar-nav-content
admin-sidebar-nav-reports
admin-sidebar-nav-users
admin-sidebar-nav-costs
admin-sidebar-nav-whitelist
admin-sidebar-nav-audit
admin-sidebar-nav-settings
admin-sidebar-back-to-app
```

### Phase 2: ExplanationTable + ExplanationDetailModal
**Goal**: Core content management workflow with full UX improvements

**Changes:**
- Add `data-testid` to search, filters, checkboxes, action buttons, pagination (~25 attributes)
- Add `data-testid` to modal close, hide, restore buttons (~5 attributes)
- Add `<Toaster />` to admin layout (uses Phase 0 Toast)
- Add Toast on hide/restore success
- Add `role="dialog"`, `aria-modal`, `aria-labelledby` to modal
- Wrap modal content with `<FocusTrap>` from `focus-trap-react`

**E2E Tests** (in `src/__tests__/e2e/specs/09-admin/`):
- `admin-content.spec.ts`: 5 tests (comprehensive - P0 component)
  - Content search works
  - Filter by status works
  - Hide content (verify toast + audit log)
  - Restore content (verify toast + audit log)
  - Bulk hide content

**Files to create:**
```
src/__tests__/e2e/specs/09-admin/admin-content.spec.ts
src/__tests__/e2e/helpers/pages/admin/ContentPage.ts
```

**Files to modify:**
```
src/app/admin/layout.tsx                          # Add <Toaster />
src/components/admin/ExplanationTable.tsx         # data-testid
src/components/admin/ExplanationDetailModal.tsx   # data-testid, Toast, a11y, FocusTrap
```

### Phase 3: ReportsTable
**Goal**: Report moderation workflow

**Changes:**
- Add `data-testid` to filter, action buttons, pagination (~8 attributes)
- Add Toast on resolve/dismiss success
- (No modal in this component)

**E2E Tests:**
- `admin-reports.spec.ts`: 2 tests (P1 component)
  - Reports list loads with pending reports
  - Resolve report (verify toast)

**Files to create:**
```
src/__tests__/e2e/specs/09-admin/admin-reports.spec.ts
```

### Phase 4: UserDetailModal
**Goal**: User management workflow

**Changes:**
- Add `data-testid` to notes textarea, save/enable/disable buttons (~5 attributes)
- Add Toast on save/enable/disable success
- Add `role="dialog"`, `aria-modal`, `aria-labelledby`
- Wrap with `<FocusTrap>`

**E2E Tests:**
- `admin-users.spec.ts`: 2 tests (P1 component)
  - View user details modal
  - Save admin notes (verify toast)

**Files to create:**
```
src/__tests__/e2e/specs/09-admin/admin-users.spec.ts
src/__tests__/e2e/helpers/pages/admin/UsersPage.ts
```

### Phase 5: WhitelistContent
**Goal**: Whitelist management (lower priority)

**Changes:**
- Add `data-testid` to add/edit/delete buttons, form inputs (~10 attributes)
- Add Toast on CRUD success
- Add a11y attributes to 2 modals
- Wrap both modals with `<FocusTrap>`

**E2E Tests:**
- `admin-whitelist.spec.ts`: 1 test (P2 component)
  - Add whitelist entry (verify toast)

### Phase 6: CandidatesContent
**Goal**: Candidate management (lowest priority)

**Changes:**
- Add `data-testid` to filter, approve/reject/delete buttons (~8 attributes)
- Add Toast on approve/reject success
- Add a11y attributes to 1 modal
- Wrap modal with `<FocusTrap>`

**E2E Tests:**
- `admin-candidates.spec.ts`: 1 test (P2 component)
  - Approve candidate (verify toast)

### Phase 7: Documentation
**Goal**: Complete admin panel documentation

**Files to update:**
- `docs/feature_deep_dives/admin_panel.md` - Full deep dive
  - Architecture overview
  - Authentication flow (layout guard + requireAdmin())
  - Each admin page explained
  - Server action patterns (withLogging, audit trail)
  - Testing approach (E2E with admin fixture)
- `docs/docs_overall/testing_overview.md` - Add admin E2E section

---

## Summary

### Execution Order

| Phase | Component(s) | data-testid | Toast | A11y | E2E Tests |
|-------|--------------|-------------|-------|------|-----------|
| 0 | Prerequisites | - | Create | - | - |
| 1 | AdminSidebar | ~9 | - | - | 2 (1 `@critical`) |
| 2 | ExplanationTable + Modal | ~30 | Use | ✅ | 5 |
| 3 | ReportsTable | ~8 | ✅ | - | 2 |
| 4 | UserDetailModal | ~5 | ✅ | ✅ | 2 |
| 5 | WhitelistContent | ~10 | ✅ | ✅ (2 modals) | 1 |
| 6 | CandidatesContent | ~8 | ✅ | ✅ | 1 |
| 7 | Documentation | - | - | - | - |

### Deliverables

- ~70 `data-testid` attributes across 7 components
- Toast component (3 files via shadcn) + integration in 5 components
- `focus-trap-react` in 5 modals
- ~13 E2E tests (1 `@critical`, rest full-suite only)
- Admin test user seeding script
- Complete `admin_panel.md` documentation

### Dependencies

```bash
npm install focus-trap-react
npx shadcn@latest add toast
```

---

## Testing

### Unit Tests
- No new unit tests needed (backend already 100%)

### E2E Tests
- 13 new Playwright tests in `src/__tests__/e2e/specs/09-admin/`
- 1 `@critical` smoke test (runs on all PRs to main)
- Rest run only on PRs to production (full suite)
- Admin auth fixture for test isolation
- Page Object Model for maintainability
- Test data uses `[TEST]` prefix for cleanup

### E2E Test File Structure
```
src/__tests__/e2e/
├── fixtures/
│   ├── auth.ts              # Existing user auth
│   └── admin-auth.ts        # NEW: Admin auth fixture
├── helpers/
│   ├── pages/
│   │   ├── admin/           # NEW: Admin POMs
│   │   │   ├── AdminBasePage.ts
│   │   │   ├── ContentPage.ts
│   │   │   └── UsersPage.ts
│   │   └── ...existing...
│   └── test-data-factory.ts # EXTEND: Add admin helpers
└── specs/
    ├── 01-auth/
    ├── ...existing...
    └── 09-admin/            # NEW: Admin specs
        ├── admin-auth.spec.ts
        ├── admin-content.spec.ts
        ├── admin-reports.spec.ts
        ├── admin-users.spec.ts
        ├── admin-whitelist.spec.ts
        └── admin-candidates.spec.ts
```

### Manual Verification (Staging)
1. Login as admin, verify all pages load
2. Hide content, verify toast appears in top-right
3. Tab through modal with keyboard, verify focus trap works
4. Use screen reader to verify aria-labels announced
5. Login as non-admin, verify redirect from /admin to home

---

## Documentation Updates

| File | Update |
|------|--------|
| `docs/feature_deep_dives/admin_panel.md` | Complete rewrite (currently empty stub) |
| `docs/docs_overall/testing_overview.md` | Add admin E2E test section |
| `.env.example` | Add ADMIN_TEST_EMAIL, ADMIN_TEST_PASSWORD placeholders |

---

## Success Criteria

- [ ] `focus-trap-react` installed and importable
- [ ] Toast component created via shadcn
- [ ] Admin test user seeded in dev/CI databases
- [ ] All 7 admin components have data-testid attributes (~70 attributes)
- [ ] Toast notifications appear on all successful admin actions
- [ ] All 5 modals have `role="dialog"`, `aria-modal`, `aria-labelledby`, and focus trap
- [ ] 13 E2E tests covering admin workflows
- [ ] 1 `@critical` smoke test passes on every PR to main
- [ ] All E2E tests pass in CI (production PRs)
- [ ] admin_panel.md documentation complete

---

## Rollback Plan

If changes cause regressions:

### Phase 0 (Dependencies)
- `focus-trap-react`: Remove from package.json, revert lock file
- Toast: Delete 3 toast files, remove `<Toaster />` from layout

### Phase 1-6 (Component Changes)
- **data-testid attributes**: No functional impact, can leave in place
- **Toast calls**: Remove `toast()` calls, users revert to no feedback (degraded but functional)
- **FocusTrap wrapper**: Remove `<FocusTrap>` component, modals work without focus trap (a11y degraded)
- **ARIA attributes**: Remove attributes, no functional impact (a11y degraded)

### E2E Tests
- Tests are additive, can be disabled via `test.skip()` if blocking CI
- Admin specs in separate `09-admin/` directory, easy to exclude from CI config

### Emergency Procedure
```bash
# Revert to pre-admin-tests state
git revert HEAD~N  # N = number of admin-related commits

# Or exclude admin tests from CI temporarily
# In playwright.config.ts:
testIgnore: ['**/09-admin/**']
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Focus trap breaks existing keyboard navigation | Use well-tested `focus-trap-react`, test manually before merge |
| Toast interferes with existing error banners | Position toast in top-right (errors are inline) |
| E2E tests flaky due to async operations | Use existing wait utilities (waitForNetworkIdle, safeClick) |
| Admin test user credentials in CI | Use GitHub environment secrets, never commit to repo |
| `focus-trap-react` bundle size | Check via `npm run build`, tree-shaking minimizes impact |
| Admin test user doesn't exist in DB | Seed script fails with clear error, CI step catches early |
| Toast component conflicts with existing UI | shadcn toast is isolated, uses portal rendering |
| Non-admin redirect test requires two users | Use existing TEST_USER for non-admin, ADMIN_TEST_USER for admin |
