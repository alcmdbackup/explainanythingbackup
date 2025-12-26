# Authentication & RLS

## Overview

Authentication uses Supabase Auth with middleware-based route protection. Row Level Security (RLS) policies ensure users can only access their own data at the database level.

## Implementation

### Key Files
- `src/app/login/actions.ts` - Auth server actions
- `src/middleware.ts` - Route protection
- `src/lib/utils/supabase/middleware.ts` - Session management
- `src/lib/utils/supabase/server.ts` - Client utilities

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
