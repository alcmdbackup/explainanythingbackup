# Authentication & RLS

## Overview

Authentication uses Supabase Auth with middleware-based route protection. Row Level Security (RLS) policies ensure users can only access their own data at the database level.

### Hostname assertion (post-split)

Since the explainanything/evolution website split (Option B — single Vercel project, two hostnames; see `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/`), `isUserAdmin()` and `requireAdmin()` in `src/lib/services/adminAuth.ts` both gate on the request hostname in addition to the `admin_users` lookup:

- A request from `public` host → returns `false` / throws `Unauthorized: Admin actions are not available from this hostname` (admin checks short-circuit before the DB query).
- A request from `evolution` host, `local`, or `preview` → passes through to the existing `admin_users` check.
- A request from `unknown` host → treated as `public` (fail-closed).
- Called outside a request context (e.g. the minicomputer batch runner, build-time static generation) → `headers()` throws and is caught; admin check passes through. The middleware is the perimeter; this assertion is the second wall.

The host is classified via `classifyHost()` in `src/config/hostnames.ts` using exact case-insensitive equality (no `startsWith` — suffix-extension attacks are not viable).

## Guest auto-login (demo mode)

For the public demo, `src/lib/utils/supabase/middleware.ts` runs auto-guest-login on every public-hostname request that has no session. It calls `supabase.auth.signInWithPassword({ email: GUEST_EMAIL, password: GUEST_PASSWORD })` and the existing `setAll()` cookie callback writes the session cookies onto the outgoing `NextResponse` — same mechanism `getUser()` uses for token refresh. No redirect, no second round-trip.

**Mechanism details**:
- Gated to `classifyHost() === 'public' | 'local' | 'preview'`. Never fires on `evolution` or `unknown`.
- Soft env-var check: missing `GUEST_EMAIL`/`GUEST_PASSWORD` is a no-op (NOT a failure), so deploy-ordering bugs degrade to the existing `/login` redirect path.
- Disabled by `E2E_TEST_MODE=true` so existing unauth-redirect tests still pass.
- Module-scope `inFlightGuestLogin` Map dedupes parallel cold-request sign-ins; `Promise.race` with 10s timeout prevents stall-poisoning.
- On `signInWithPassword` failure, sets `GUEST_AUTOLOGIN_FAILED_RECENTLY` cookie (`httpOnly: true`, `sameSite: 'lax'`, 60s); `/login` server component renders `<ServiceUnavailableNotice />` instead of the form for the cookie window — avoids the redirect loop when sign-out is hidden.

**Client-side**:
- `useIsGuest()` hook in `src/hooks/useUserAuth.ts` returns `email === process.env.NEXT_PUBLIC_GUEST_EMAIL`.
- `Navigation.tsx` hides the sign-out button when `useIsGuest()` is true.
- `/login` is a server component (`src/app/login/page.tsx`) that does `await getUser()` and redirects to `/` if the user is guest. Interactive form lives in `LoginForm.tsx`.

**Rollback levers** (no code revert needed): set `E2E_TEST_MODE=true` OR remove `GUEST_PASSWORD` from Vercel env vars; redeploy.

## Implementation

### Key Files
- `src/app/login/page.tsx` - Server-shell with guest redirect + cookie check
- `src/app/login/LoginForm.tsx` - Interactive client form
- `src/app/login/ServiceUnavailableNotice.tsx` - Server component for auth-failure window
- `src/app/login/actions.ts` - Auth server actions
- `src/middleware.ts` - Route protection
- `src/lib/utils/supabase/middleware.ts` - Session management + auto-guest-login
- `src/lib/utils/supabase/server.ts` - Client utilities
- `src/hooks/useUserAuth.ts` - useUserAuth + useIsGuest hooks

### Auth Flow

```
Login Form → login() action → Supabase Auth → Session Cookie → Redirect
                                    ↓
                           Password validation
                                    ↓
                           Cache revalidation
```

### Protected Routes

All routes are protected except:
- `/login` - Authentication page
- `/auth` - Auth callbacks
- `/debug-critic` - Debug page
- Static assets (`/_next/static`, `/_next/image`)
- Client logs (`/api/client-logs`)

### Middleware Flow

```
Request → updateSession() → Check auth → Protected?
                                            ├─ Yes + No user → Redirect /login
                                            ├─ Yes + User → Continue
                                            └─ No → Continue
```

## Usage

### Login Action

```typescript
import { login } from '@/app/login/actions';

// From form submission
const formData = new FormData();
formData.set('email', 'user@example.com');
formData.set('password', 'password123');
formData.set('rememberMe', 'true');

const result = await login(formData);

if (result?.error) {
  showError(result.error);
}
// Success: redirected to /
```

### Signup Action

```typescript
import { signup } from '@/app/login/actions';

const formData = new FormData();
formData.set('email', 'new@example.com');
formData.set('password', 'securePassword123');

const result = await signup(formData);

if (result?.error) {
  showError(result.error);
} else if (result?.success) {
  showMessage('Account created!');
}
```

### Sign Out

```typescript
import { signOut } from '@/app/login/actions';

await signOut();
// Redirects to /
```

### Getting Current User

```typescript
import { createClient } from '@/lib/utils/supabase/server';

const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  console.log('Logged in as:', user.email);
}
```

### Service Client (Bypass RLS)

```typescript
import { createServiceClient } from '@/lib/utils/supabase/server';

// For background operations without user context
const supabase = createServiceClient();

// Can access all data (use carefully)
const { data } = await supabase
  .from('explanationMetrics')
  .select('*');
```

### RLS Policy Patterns

**User owns resource:**
```sql
CREATE POLICY "Users can view own library"
ON userLibrary FOR SELECT
USING (auth.uid() = user_id);
```

**Public read, authenticated write:**
```sql
CREATE POLICY "Anyone can view explanations"
ON explanations FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create"
ON explanations FOR INSERT
WITH CHECK (auth.role() = 'authenticated');
```

### Validation Schema

```typescript
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});
```

### Error Messages

| Error | User Message |
|-------|--------------|
| Invalid credentials | "Invalid email or password" |
| Email exists (signup) | "An account with this email already exists" |
| Weak password | "Password must be at least 6 characters" |
| Other | "An unexpected error occurred" |

### Session Management

The middleware:
1. Extracts session cookies from request
2. Validates session with Supabase
3. Updates response cookies (refresh if needed)
4. Syncs browser/server state

```typescript
// In middleware.ts
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}
```

### Best Practices

1. **Always validate**: Use Zod schemas for auth input
2. **Mask errors**: Don't expose internal error details
3. **Use RLS**: Enforce access control at database level
4. **Service client sparingly**: Only for background/admin operations
5. **Revalidate paths**: Call `revalidatePath('/')` after auth changes
