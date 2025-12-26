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
    // Clear session on logout
    if (event === 'SIGNED_OUT') {
      clearSession();
    }
  });
}