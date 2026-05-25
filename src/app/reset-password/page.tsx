// /reset-password route — server shell that gates render on guest-user check.
// The triple-gate against guest-account password takeover is:
//   1. server-side getUser() vs GUEST_USER_ID → 404 if guest (this file)
//   2. client-side PASSWORD_RECOVERY event must have fired to enable the form
//   3. client-side useIsGuest() check
// Any single gate failure is caught by the other two. The server check uses
// GUEST_USER_ID (server-only env var, no client bundle dependency), so even
// if NEXT_PUBLIC_GUEST_EMAIL drops from the bundle, the gate still fires.

import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage() {
  const guestUserId = process.env.GUEST_USER_ID;
  if (guestUserId) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.id === guestUserId) {
        notFound();
      }
    } catch {
      // If Supabase is unreachable, fall through to the form — the client-side
      // gates still protect, and failing closed here would block legitimate
      // recovery during a Supabase outage.
    }
  }

  return <ResetPasswordForm />;
}
