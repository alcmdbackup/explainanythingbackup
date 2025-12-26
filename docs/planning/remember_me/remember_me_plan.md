# Remember Me Feature Implementation Plan

## Requirement
- **Checked**: User stays logged in across browser restarts
- **Unchecked**: Session ends when browser closes (but persists across tabs in same session)

## Current State
- Checkbox exists in UI (`src/app/login/page.tsx:207-221`)
- Value collected, validated, passed to server action
- **Not functional**: `rememberMe` flag only logged, not used

## Approach: Storage Switching
Switch between `localStorage` and `sessionStorage` for Supabase auth tokens:
- `localStorage`: Persists until cleared → survives browser restart
- `sessionStorage`: Cleared on browser close → ends session

## Files to Modify

### 1. `src/lib/utils/supabase/client.ts`
Add storage-aware client factory:
```ts
export function createClient(persistSession = true) {
  return createBrowserClient(url, key, {
    auth: {
      storage: persistSession ? localStorage : sessionStorage,
      persistSession: true,
    }
  })
}
```

### 2. `src/lib/utils/supabase/rememberMe.ts` (new)
Helper to manage preference:
```ts
const KEY = 'supabase_remember_me'
export const getRememberMe = () => localStorage.getItem(KEY) !== 'false'
export const setRememberMe = (value: boolean) => localStorage.setItem(KEY, String(value))
export const clearRememberMe = () => localStorage.removeItem(KEY)
```

### 3. `src/app/login/page.tsx`
After successful login, store preference:
```ts
// After login action succeeds
setRememberMe(data.rememberMe)
```

### 4. Component that initializes Supabase client
Read preference and create appropriate client on app load

### 5. `src/app/login/actions.ts` (signOut)
Clear preference on logout

## Migration Strategy
When session already exists in `localStorage` but user logs in with `rememberMe=false`:
- Clear existing `localStorage` auth data
- New tokens go to `sessionStorage`

## Edge Cases
- **Default (no preference)**: Treat as `rememberMe=true` (localStorage)
- **Multiple tabs**: Same storage shared, consistent behavior
- **SSR**: Server uses cookies; storage only affects client token refresh

## Testing
1. Login + remember me → close browser → reopen → still logged in
2. Login - remember me → close browser → reopen → must re-login
3. Login - remember me → open new tab in same session → still logged in
