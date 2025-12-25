import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr'
import { clearSession } from './sessionId';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_URL');
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const supabase_browser =  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Session management on auth state changes (client-only)
if (typeof window !== 'undefined') {
  supabase_browser.auth.onAuthStateChange((event) => {
    // Clear anonymous session on logout
    if (event === 'SIGNED_OUT') {
      clearSession();
    }

    // Note: SIGNED_IN is handled by useAuthenticatedRequestId's useEffect
    // which calls handleAuthTransition(). We don't duplicate that logic here
    // because React components need to update their state anyway.
    //
    // Auth events reference (from Supabase docs):
    // - SIGNED_IN: User signed in (new session)
    // - SIGNED_OUT: User signed out (session cleared)
    // - TOKEN_REFRESHED: Token was refreshed (~hourly)
    // - USER_UPDATED: User profile updated
    // - PASSWORD_RECOVERY: Password recovery initiated
  });
}