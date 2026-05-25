/**
 * /login route — server-shell that does three things before rendering anything:
 *   1. If the visitor is already signed in AS THE GUEST USER, redirect to /
 *      (no point showing a login form when middleware auto-logs everyone in).
 *   2. If the GUEST_AUTOLOGIN_FAILED_RECENTLY cookie is present (set by middleware
 *      when sign-in failed), render <ServiceUnavailableNotice /> instead of the
 *      login form to avoid a redirect loop while the 60s window elapses.
 *   3. Otherwise, render the existing interactive <LoginForm /> client child.
 *
 * Pre-Phase-5 this file was a `'use client'` interactive component; that has
 * been moved verbatim into ./LoginForm.tsx.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { LoginForm } from './LoginForm';
import { ServiceUnavailableNotice } from './ServiceUnavailableNotice';

export default async function LoginPage() {
  // Check the GUEST_AUTOLOGIN_FAILED_RECENTLY cookie BEFORE attempting any
  // Supabase call — if middleware just hit an auth-provider hiccup, we don't
  // want to compound it.
  const cookieStore = await cookies();
  if (cookieStore.get('GUEST_AUTOLOGIN_FAILED_RECENTLY')?.value === '1') {
    return <ServiceUnavailableNotice />;
  }

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
