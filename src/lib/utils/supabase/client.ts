import { createBrowserClient } from '@supabase/ssr';
import { getRememberMe } from './rememberMe';

/**
 * Creates a Supabase browser client with storage based on remember me preference.
 *
 * @param persistSession - If true, uses localStorage (survives browser restart).
 *                         If false, uses sessionStorage (cleared on browser close).
 *                         Defaults to the stored remember me preference.
 */
export function createClient(persistSession?: boolean) {
  const shouldPersist = persistSession ?? getRememberMe();

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: shouldPersist
          ? (typeof window !== 'undefined' ? localStorage : undefined)
          : (typeof window !== 'undefined' ? sessionStorage : undefined),
        persistSession: true,
      },
    }
  );
}