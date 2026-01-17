# Create Admin Site Plan

## Background

ExplainAnything needs a comprehensive administrative dashboard to manage content, users, costs, and system health. Currently, the only admin functionality is link whitelist management at `/admin/whitelist`. The codebase has robust foundations including Supabase Auth, RLS policies, service role client for admin operations, and established server action patterns. The existing admin route uses a hardcoded email whitelist for access control.

## Problem

The current admin capabilities are severely limited. Key pain points:
- **Can't manage bad content** - No way to hide/edit/delete problematic explanations
- **No cost visibility** - LLM spending is a black box (12K+ calls in `llmCallTracking`)
- **Can't handle user issues** - No way to view users, disable abusive accounts
- **No system visibility** - Health checks, errors, feature flags not accessible

The email whitelist approach doesn't scale and lacks server-side enforcement.

## Decisions Made

1. **Deletion policy:** **Soft delete** - Use `is_hidden`/`is_disabled` flags throughout
2. **Admin roles:** **Single "admin" role** - Binary: admin or not admin
3. **Audit logs:** **Retained forever** - Keep all logs for compliance
4. **Scope:** **Comprehensive** - Full admin suite addressing all pain points

---

## Options Considered

### Authentication Approach

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Keep email whitelist | Simple | Not scalable, client-side only | ❌ |
| Database `admin_users` table | Scalable, server-side | Requires migration | ✅ Selected |
| Supabase custom claims | JWT-based | Harder to debug | ❌ |
| Environment variable | Configurable | Requires redeploy | ❌ |

### Site Structure

**Selected:** Modular route-based pages with sidebar navigation
```
/admin                    → Dashboard (health + key metrics)
/admin/content            → Explanation management
/admin/content/reports    → User-reported content queue
/admin/users              → User management
/admin/costs              → LLM cost analytics
/admin/analytics          → Usage analytics (views, saves)
/admin/whitelist          → (existing) Link management
/admin/audit              → Audit log viewer
/admin/settings           → Feature flags, system config
/admin/dev-tools          → Developer tools (consolidated from (debug)/)
```

---

## Phased Execution Plan

### Phase 1: Foundation (Auth + Layout)
**Goal:** Secure admin access with database-backed roles and create shell

**Database Changes:**
```sql
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id)
);

-- RLS: Admins can only read their OWN record (prevents privilege escalation)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_users_select_own" ON admin_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());
```

**Code Changes:**
1. Create migration for `admin_users` table
2. Create `src/lib/services/adminAuth.ts` with `isUserAdmin()` and `requireAdmin()`
3. Update `src/app/admin/layout.tsx` to use database check
4. Create `AdminSidebar` component with navigation links
5. Seed initial admin: `abecha@gmail.com`

**Tests:** Unit: adminAuth.test.ts | E2E (non-critical): Non-admin redirected, admin can access

---

### Phase 2: Content Management (CRUD + Bulk)
**Goal:** View, edit, hide explanations with bulk operations

**Database Changes:**
```sql
ALTER TABLE explanations ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE explanations ADD COLUMN hidden_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN hidden_by UUID REFERENCES auth.users(id);

-- Update RLS: exclude hidden from non-admins
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  is_hidden = FALSE OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);
```

**Code Changes:**
1. Create `src/app/admin/content/page.tsx` - Sortable table, search, filters, bulk select
2. Create `ExplanationTable.tsx` and `ExplanationDetailModal.tsx` components
3. Server actions: `getAdminExplanationsAction`, `hideExplanationAction`, `restoreExplanationAction`, `bulkHideExplanationsAction`

**Tests:** Unit: `explanationAdmin.test.ts` | E2E (non-critical): Search, edit, hide, restore, bulk hide

---

### Phase 3: Content Reports Queue
**Goal:** Users can report content, admins review queue

**Database Changes:**
```sql
CREATE TABLE content_reports (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Users insert own reports, admins read/update all
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_insert" ON content_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports_select_admin" ON content_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "reports_update_admin" ON content_reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
```

**Code Changes:**
1. Add "Report" button to explanation view (user-facing)
2. Create `src/app/admin/content/reports/page.tsx` - Pending reports table
3. Server actions: `createContentReportAction`, `getContentReportsAction`, `resolveContentReportAction`

**Tests:** E2E (non-critical): User reports content, admin sees in queue, resolves

---

### Phase 4: Cost Analytics
**Goal:** Full visibility into LLM spending

**Database Changes:**
```sql
ALTER TABLE "llmCallTracking" ADD COLUMN estimated_cost_usd NUMERIC(10,6);

CREATE MATERIALIZED VIEW daily_llm_costs AS
SELECT DATE(created_at) as date, model, userid,
  COUNT(*) as call_count, SUM(total_tokens) as total_tokens,
  SUM(estimated_cost_usd) as total_cost_usd
FROM "llmCallTracking" GROUP BY DATE(created_at), model, userid;
```

**Code Changes:**
1. Create `src/app/admin/costs/page.tsx` - Summary cards, charts, breakdowns
2. Create `src/config/llmPricing.ts` - Token pricing config
3. Server actions: `getCostSummaryAction`, `getCostByModelAction`, `getCostByUserAction`
4. Backfill migration for existing records

**Tests:** Unit: Cost calculation accuracy | E2E (non-critical): Charts render, filters work

---

### Phase 5: User Management
**Goal:** View users, see activity, disable accounts

**Database Changes:**
```sql
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  is_disabled BOOLEAN DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES auth.users(id),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Users read own, admins read/update all
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON user_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "profiles_select_admin" ON user_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "profiles_update_admin" ON user_profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
```

**Code Changes:**
1. Create `src/app/admin/users/page.tsx` - User list with stats
2. Create `UserDetailModal.tsx` - Activity timeline, admin notes, disable button
3. Add disabled user check in `middleware.ts`
4. Server actions: `getAdminUsersAction`, `disableUserAction`, `enableUserAction`

**Tests:** Unit: `userAdmin.test.ts` | E2E (non-critical): View users, disable, re-enable

---

### Phase 6: Audit Logging
**Goal:** Track all admin actions

**Database Changes:**
```sql
CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_user_id);
CREATE INDEX idx_audit_log_entity ON admin_audit_log(entity_type, entity_id);

-- RLS: Admins can read, insert via service role only
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_admin" ON admin_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
```

**Code Changes:**
1. Create `src/lib/services/auditLog.ts` with `logAdminAction()` and `sanitizeAuditDetails()`
2. Add audit logging to ALL admin actions
3. Create `src/app/admin/audit/page.tsx` - Filter by admin, action, date; export CSV

**Tests:** Unit: Audit log creation, sanitization | Integration: All admin actions create entries

---

### Phase 7: System Health & Settings + Dev Tools
**Goal:** Health monitoring, feature flags, consolidate debug pages

**Database Changes:**
```sql
CREATE TABLE feature_flags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Anyone can read (for feature gating), admins can update
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flags_select" ON feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "flags_update_admin" ON feature_flags FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
```

**Code Changes:**
1. Create `src/app/admin/settings/page.tsx` - Feature flags table with toggles
2. Update dashboard (`/admin`) with health status, recent errors, quick stats
3. Server actions: `getFeatureFlagsAction`, `updateFeatureFlagAction`, `getSystemHealthAction`
4. **Consolidate debug pages** - Move from `src/app/(debug)/` to `src/app/admin/dev-tools/`:

   | Old Location | New Location |
   |--------------|--------------|
   | `(debug)/editorTest` | `admin/dev-tools/editor` |
   | `(debug)/diffTest` | `admin/dev-tools/diff` |
   | `(debug)/mdASTdiff_demo` | `admin/dev-tools/ast-diff` |
   | `(debug)/resultsTest` | `admin/dev-tools/results` |
   | `(debug)/streaming-test` | `admin/dev-tools/streaming` |
   | `(debug)/latex-test` | `admin/dev-tools/latex` |
   | `(debug)/tailwind-test` | `admin/dev-tools/tailwind` |
   | `(debug)/typography-test` | `admin/dev-tools/typography` |
   | `(debug)/test-client-logging` | `admin/dev-tools/logging` |
   | `(debug)/test-global-error` | `admin/dev-tools/error` |

5. Create index page at `src/app/admin/dev-tools/page.tsx`
6. Delete `src/app/(debug)/` route group after migration

**Tests:** Unit: `featureFlags.test.ts` | E2E (non-critical): Toggle feature flag, health shows green, dev tools accessible only to admins

---

## Testing Summary

### Unit Tests
| File | Coverage |
|------|----------|
| `adminAuth.test.ts` | Role checking, `requireAdmin()`, `isUserAdmin()` |
| `auditLog.test.ts` | Log creation, `sanitizeAuditDetails()` recursive |
| `costCalculation.test.ts` | Token → USD conversion, fallback pricing |
| `explanationAdmin.test.ts` | Soft delete logic, bulk hide validation |
| `adminRateLimiter.test.ts` | Rate limit enforcement, window reset |
| `userAdmin.test.ts` | Disable/enable logic, profile updates |
| `featureFlags.test.ts` | Flag toggle, default values |

### E2E Tests (Non-Critical)
| File | Flows |
|------|-------|
| `admin-auth.spec.ts` | Login, redirect non-admin |
| `admin-content.spec.ts` | CRUD, bulk ops, search |
| `admin-reports.spec.ts` | Report flow, resolve |
| `admin-costs.spec.ts` | Charts render, filters |
| `admin-users.spec.ts` | List, disable, enable |
| `admin-audit.spec.ts` | Log viewing, export |
| `admin-dev-tools.spec.ts` | Dev tools access |

*E2E tests are non-critical for this project. Unit and integration tests are required.*

### RLS Policy Tests
Integration tests in `src/__tests__/integration/rls-policies.test.ts`:
- admin_users: Own record only, no insert for non-admin
- explanations is_hidden: Non-admin can't see hidden
- content_reports: Reporter_id enforcement

---

## Security Patterns (CRITICAL)

### requireAdmin() - Server-Side Enforcement

All admin server actions MUST call `requireAdmin()` as the first line:

```typescript
// src/lib/services/adminAuth.ts
export async function requireAdmin(): Promise<string> {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized: Not authenticated');

  const { data: adminRecord } = await supabase
    .from('admin_users').select('id').eq('user_id', user.id).single();
  if (!adminRecord) throw new Error('Unauthorized: Not an admin');

  return user.id;
}
```

### sanitizeAuditDetails() - Recursive Data Sanitization

Prevent sensitive data in audit logs:

```typescript
// src/lib/services/auditSanitization.ts
const FORBIDDEN_FIELDS = ['password', 'token', 'secret', 'key', 'authorization', 'jwt', 'api_key'];

export function sanitizeAuditDetails(details: unknown, maxDepth = 10, depth = 0): unknown {
  if (depth >= maxDepth) return '[MAX_DEPTH]';
  if (Array.isArray(details)) return details.map(d => sanitizeAuditDetails(d, maxDepth, depth + 1));
  if (typeof details === 'object' && details !== null) {
    return Object.fromEntries(
      Object.entries(details).map(([k, v]) => [
        k, FORBIDDEN_FIELDS.some(f => k.toLowerCase().includes(f))
          ? '[REDACTED]' : sanitizeAuditDetails(v, maxDepth, depth + 1)
      ])
    );
  }
  if (typeof details === 'string' && details.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(details)) {
    return '[REDACTED_TOKEN]';
  }
  return details;
}
```

### Rate Limiting - Upstash Ratelimit

Bulk operations use `@upstash/ratelimit`:
- `bulkHide`: 50/min sliding window
- `bulkDisable`: 10/min sliding window
- `bulkRestore`: 50/min sliding window

Config: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars.

### Transaction Boundaries

Audit log writes use SQL `SECURITY DEFINER` functions for atomic operations:

```sql
CREATE OR REPLACE FUNCTION hide_explanation_with_audit(
  p_explanation_id INTEGER, p_admin_user_id UUID, p_details JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE explanations SET is_hidden = TRUE, hidden_at = NOW(), hidden_by = p_admin_user_id
  WHERE id = p_explanation_id;
  INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, details)
  VALUES (p_admin_user_id, 'hide_explanation', 'explanation', p_explanation_id::TEXT, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Admin Revocation

Immediate revocation via:
1. Delete from `admin_users` table (blocks new requests)
2. Call `supabase.auth.admin.signOut(userId)` (invalidates refresh token)

---

## Server Action Pattern

All admin actions follow existing codebase pattern:

```typescript
const _actionName = withLogging(async (params) => {
  try {
    const adminUserId = await requireAdmin(); // FIRST LINE
    if (isBulk) await checkBulkRateLimit('action', adminUserId);
    const result = await doOperation(params);
    await logAdminAction({ action: 'name', entityType, entityId, details: sanitizeAuditDetails(params), adminUserId });
    return { success: true, data: result, error: null };
  } catch (error) {
    return handleError(error, FILE_DEBUG);
  }
}, 'actionName');

export const actionName = serverReadRequestId(_actionName);
```

---

## Cost Calculation Config

```typescript
// src/config/llmPricing.ts
export const LLM_PRICING: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'o1': { prompt: 0.015, completion: 0.06 },
  'o1-mini': { prompt: 0.003, completion: 0.012 },
};

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = LLM_PRICING[model] ?? LLM_PRICING['o1']; // Fallback to expensive
  return (promptTokens / 1000 * pricing.prompt) + (completionTokens / 1000 * pricing.completion);
}
```

---

## Test Data Factory

Add to `src/__tests__/e2e/helpers/test-data-factory.ts`:
- `createTestAdminUser(supabase, userId)` - Create admin record
- `createTestContentReport(supabase, explanationId, reporterId, status)` - Create report
- `createTestFeatureFlag(supabase, name, enabled)` - Create flag
- `cleanupAdminTestData(supabase)` - Cleanup in afterAll

---

## Migration Rollback

**Pre-Migration:** Backup DB, test on staging, verify RLS, confirm rollback script exists.

**Rollback Scripts:** Each migration has corresponding `*_rollback.sql`:
```sql
-- Example: migrations/YYYYMMDD_admin_users_rollback.sql
DROP POLICY IF EXISTS "admin_users_select_own" ON admin_users;
DROP TABLE IF EXISTS admin_users;
```

**Emergency:** Identify failing migration → Run rollback → Verify app works → Document → Fix and retry

---

## CI/CD Modifications

**New Environment Variables:**
```yaml
env:
  TEST_ADMIN_EMAIL: ${{ secrets.TEST_ADMIN_EMAIL }}
  TEST_ADMIN_USER_ID: ${{ secrets.TEST_ADMIN_USER_ID }}
```

**Pre-E2E Seeding:**
```yaml
- name: Seed test admin user
  run: npx supabase db seed --file supabase/seed-test-admin.sql
```

**Migration Validation:**
```yaml
- name: Validate migrations
  run: npx supabase db diff --linked && npx supabase db lint
```

---

## Production Checklist

### Pre-Deployment
- [ ] Seed initial admin via service role
- [ ] Verify RLS policies as non-admin
- [ ] Test disabled user middleware flow
- [ ] Verify audit logging works
- [ ] Test bulk rate limits
- [ ] Backup database

### Post-Deployment
- [ ] Admin can access `/admin`
- [ ] Non-admin redirected
- [ ] Hidden explanations invisible to regular users
- [ ] Audit logs recording
- [ ] Cost dashboard accurate
- [ ] Feature flags work

### Rollback Triggers
- Admin auth blocking all users
- RLS policies too restrictive
- Audit logging causing performance issues
- Bulk operations not rate-limited

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data exposure | `requireAdmin()` server-side on all actions |
| Privilege escalation | RLS restricts admin_users to own record |
| Audit log gaps | Centralized `logAdminAction()` |
| Sensitive data in audit | `sanitizeAuditDetails()` recursive |
| Cost calculation drift | Pricing in config, backfill migration |
| Bulk operation abuse | `checkBulkRateLimit()` |
| Performance | Pagination, materialized views, indexes |
| Migration failure | Rollback scripts tested |
| Disabled user access | Middleware check |

---

## Documentation Updates

- `docs/docs_overall/architecture.md` - Add admin site architecture
- `docs/feature_deep_dives/admin_site.md` - Create full admin documentation
- `docs/feature_deep_dives/authentication_rls.md` - Update with admin roles

---

## Timeline Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| 1. Foundation | Auth + Layout | 1-2 days |
| 2. Content CRUD | Tables, modals, bulk ops | 2-3 days |
| 3. Reports Queue | User reporting flow | 1-2 days |
| 4. Cost Analytics | Charts, breakdowns | 2-3 days |
| 5. User Management | User admin | 2 days |
| 6. Audit Logging | Audit trail | 1-2 days |
| 7. Health, Settings & Dev Tools | Dashboard, flags, debug pages | 2-3 days |

**Total: ~12-17 days**

---

## Future Enhancements

### Version History
Track edit history and allow restore of previous explanation versions.
- `explanation_versions` table with snapshots
- History tab in detail modal
- Diff view between versions
- Restore functionality

**Effort:** 1-2 days when needed
