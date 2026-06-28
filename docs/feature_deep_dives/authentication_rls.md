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
- On `signInWithPassword` failure, logs `[middleware] guest-auto-login failed` and redirects to `/login`. Auto-login is suppressed on `/login` pathnames (the `onLoginPath` guard skips signIn when `request.nextUrl.pathname.startsWith('/login')`), so the redirect doesn't re-trigger sign-in (no loop). `/login` renders `<LoginForm />` so visitors can sign in manually with their own credentials during an outage. No client-side cool-down between failed attempts — per-instance `inFlightGuestLogin` dedupes concurrent requests on a single Node instance; sequential failures rely on Supabase's per-IP auth rate limit (~30/min) as the sole backstop. Acceptable at demo-tier traffic.

**Client-side**:
- `useIsGuest()` hook in `src/hooks/useUserAuth.ts` returns `email === process.env.NEXT_PUBLIC_GUEST_EMAIL`.
- `Navigation.tsx` hides the sign-out button when `useIsGuest()` is true.
- `/login` is a server component (`src/app/login/page.tsx`) that does `await getUser()` and redirects to `/` if the user is guest. Interactive form lives in `LoginForm.tsx`.

**Rollback levers** (no code revert needed): set `E2E_TEST_MODE=true` OR remove `GUEST_PASSWORD` from Vercel env vars; redeploy.

## Public `/edit` surface (Phase 2 of `build_website_for_evolutiOn_20260626`)

The `/edit` paste-and-run page is **fully unauthed** — no Supabase sign-in required.
Lives in `PUBLIC_PREFIXES`; the evolution host 404s it.

When `callLLM` fires from a `/edit` submission, the `userid` passed is
`process.env.GUEST_USER_ID` (NOT a custom sentinel; the per-user cap at
`llms.ts:986-989` only fires when `userid === GUEST_USER_ID`). This means
all `/edit` traffic shares the same $10/day pool as the existing guest
auto-login traffic — accepted trade-off documented in the planning doc Q7.

Cost / abuse defense is layered (NOT auth):
- Vercel BotID (`checkBotId()`) at the top of `submitPublicEditAction`
- Per-IP + per-region $ caps via `perIpSpendingGate` (Upstash)
- Per-user $ cap (the shared guest pool above)
- Per-run `evolution_runs.budget_cap_usd = $0.10`
- Global `evolution_daily_cap_usd` + `monthly_cap_usd`

See `docs/feature_deep_dives/llm_spending_gate.md` for the full cap stack +
the remaining kill switches (`LLM_GATE_PANIC_BYPASS`, `PUBLIC_EDIT_DISABLED`,
`PUBLIC_EDIT_RATE_LIMIT_DISABLED`, `BOT_PROTECTION_DISABLED`). The original
Phase-0 `LLM_GATE_FAIL_CLOSED_DISABLED` rollback flag was removed after the
staging soak — fail-CLOSED is unconditional.

Run-result pages (`/edit/runs/[runId]`) set `<meta robots="noindex,nofollow">`
+ `Referrer-Policy: no-referrer` + `Cache-Control: private, no-store` as
defense-in-depth against URL leak via browser-history sync to Google/iCloud
or URL-shortener caches.

## Implementation

### Key Files
- `src/app/login/page.tsx` - Server-shell with guest redirect; renders `<LoginForm />` by default
- `src/app/login/LoginForm.tsx` - Interactive client form
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

## Password reset flow

The Supabase email-OTP recovery flow, end-to-end. Lives in `src/app/forgot-password/`, `src/app/reset-password/`, and `src/app/login/actions.ts` (`requestPasswordReset`); the callback at `src/app/auth/confirm/route.ts` already handles `type=recovery` tokens generically.

### Four-step flow

```
User clicks "Forgot password?" on /login
    ↓
/forgot-password — types email, submits to requestPasswordReset action
    ↓
Supabase sends recovery email with link to /auth/confirm?token_hash=…&type=recovery&next=/reset-password
    ↓
User clicks link → /auth/confirm → supabase.auth.verifyOtp() sets recovery session cookie
    ↓
Redirect to /reset-password → form gates open (PASSWORD_RECOVERY event + non-guest check)
    ↓
User enters new password → supabase.auth.updateUser({ password }) → redirect to /
```

### Four-gate against guest-account password takeover

Because of guest auto-login on the public tier (a visitor with no session is signed in as the shared demo guest), a naive `/reset-password` page would let any visitor overwrite the guest's password. Four independent gates:

1. **Server-side** (`src/app/reset-password/page.tsx`): `await getUser()` is compared to `process.env.GUEST_USER_ID` (a server-only env var, no client bundle dependency). If the current user is the guest, `notFound()` returns 404 before the form renders.
2. **Client-side recovery event** (`src/app/reset-password/ResetPasswordForm.tsx`): the form is disabled until `supabase.auth.onAuthStateChange` fires `PASSWORD_RECOVERY`. This event only fires after a successful `verifyOtp({type: 'recovery'})`.
3. **Client-side guest email check**: `useIsGuest()` hook returns true when `user.email === NEXT_PUBLIC_GUEST_EMAIL`. Form stays disabled even if the recovery event somehow fires for the guest.
4. **Submit-time guard** (`ResetPasswordForm.onSubmit`): even after the form renders, `onSubmit` re-reads `getUser()` and refuses to call `updateUser` if the current user is the guest (or there is no session). This closes the race where guest auto-login displaces the recovery session *after* the render-time gates pass — the exact failure that let the nightly `password-reset.spec.ts` overwrite the shared guest on prod (incident `autologin_broken_3rd_night_after_fix_20260529`). Because it fires at the moment of mutation, it protects real users, not just tests.

Gates 1–3 prevent the form from rendering/enabling for the guest; gate 4 is the last line — it blocks the password write itself even if the session is swapped mid-flow. Any single gate failure is caught by the others.

### Middleware allowlist

The recovery flow requires three changes to `src/lib/utils/supabase/middleware.ts`:

| Block | Change | Why |
|---|---|---|
| Guest auto-login (~lines 70-77) | Skip when path starts with `/reset-password`, `/forgot-password`, or `/auth/confirm` | Prevents the cookie-propagation race: without this, a public-host visitor on `/reset-password` gets signed in as guest before the recovery session lands, swapping it away |
| Redirect-to-login (~lines 147-158) | Allowlist `/reset-password` and `/forgot-password` | These pages must be reachable when unauthenticated |
| Disabled-user check (~lines 161-167) | Allowlist `/reset-password` | A disabled user holding a pre-disable recovery link can still complete the password change; they get bounced on the next non-auth route. Disabled users CAN'T request a new reset link (no `/forgot-password` allowlist), but they CAN complete one in flight |

### Pre-authenticated user clicks recovery link

This is by-design behaviour, not a bug. `verifyOtp` swaps the cookie to the recovered account. Recovery emails are account-specific, so swapping matches user intent.

### Test pattern: `admin.generateLink`

Recovery flows can't easily be E2E tested via real email. Use Supabase's admin API to synthesize the email URL:

```typescript
const { data } = await serviceClient.auth.admin.generateLink({
  type: 'recovery',
  email: testUserEmail,
});
// data.properties.hashed_token  ← use this for verifyOtp (NOT a URL parse)
// data.properties.action_link   ← navigate to this in Playwright
```

**Important**: extract `hashed_token` from the structured response — the `action_link` URL uses `?token=` (raw GoTrue verify), not `?token_hash=`.

Test users in this flow MUST be dedicated (`admin.createUser` + `admin.deleteUser`), NOT the shared `TEST_USER_*` — password mutations would poison other parallel-worker tests' cached sessions.

### Email template

`supabase/config.toml` defines `[auth.email.template.recovery]` → `supabase/templates/recovery.html`. Local dev (`supabase db reset`) picks this up automatically. **Hosted Supabase projects (dev + prod) use the dashboard template — the repo file does NOT affect them.** Dashboard runbook is in the project planning doc; ops checklist must run after any template change in the repo.

The redirect URL allowlist in the Supabase dashboard must include `https://<site>/auth/confirm` (the actual `redirectTo` value), NOT `/reset-password` — the `next=` query string is not part of Supabase's URL match.

### Key files

| File | Purpose |
|---|---|
| `src/app/login/actions.ts` | `requestPasswordReset` server action (Sentry-wrapped, reads `origin` from headers, fails loudly if missing) |
| `src/app/login/validation.ts` | `forgotPasswordSchema` (email) + `resetPasswordSchema` (signup-grade complexity) |
| `src/app/forgot-password/` | Page + form for requesting a reset link |
| `src/app/reset-password/page.tsx` | Server-side guest gate via `GUEST_USER_ID` |
| `src/app/reset-password/ResetPasswordForm.tsx` | Client form with `PASSWORD_RECOVERY` + `useIsGuest()` gates |
| `src/app/auth/confirm/route.ts` | Generic `verifyOtp` callback — works for recovery without change |
| `supabase/templates/recovery.html` | Recovery email body (local dev only; hosted Supabase uses dashboard) |
| `src/__tests__/integration/password-reset.integration.test.ts` | Full SDK round-trip with dedicated test user |
| `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts` | E2E `@critical` + `@skip-prod` — the destructive recovery flow must NOT run against the live prod guest (guest auto-login can displace the recovery session and clobber the shared account); runs on dev / PR CI only |
