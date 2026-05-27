/**
 * /login route — server-shell that does two things before rendering anything:
 *   1. If the visitor is already signed in AS THE GUEST USER, redirect to /
 *      (no point showing a login form when middleware auto-logs everyone in).
 *   2. Otherwise, render the existing interactive <LoginForm /> client child.
 *
 * Middleware skips guest auto-login on /login (see src/lib/utils/supabase/middleware.ts
 * onLoginPath guard), so fresh visitors to /login see the form instead of being
 * silently turned into guests. During an auto-login outage on other paths, the
 * failure redirect lands here and renders the form rather than a static notice.
 */

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  // Redirect signed-in guests directly to /.
  const guestEmail = process.env.NEXT_PUBLIC_GUEST_EMAIL ?? process.env.GUEST_EMAIL;
  if (guestEmail) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.email === guestEmail) {
        redirect('/');
      }
    } catch {
      // If Supabase is unreachable, fall through to the form — better to let
      // a real user sign in manually than to render nothing.
    }
  }

  return <LoginForm />;
}
