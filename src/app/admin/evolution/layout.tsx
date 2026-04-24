/**
 * Shared layout for all /admin/evolution/* routes.
 * Ensures Next.js layout nesting so that not-found and error pages
 * render within the admin shell (sidebar stays visible).
 *
 * B092: re-verify admin on every render so a just-revoked admin drops out of
 * evolution routes without needing a hard reload. The parent /admin/layout.tsx
 * already does this check, but it caches across client-side navigations under
 * dynamic='force-dynamic'; duplicating the check here costs one extra DB round
 * trip but closes the revocation-latency hole for this subtree.
 */

import { redirect } from 'next/navigation';
import { isUserAdmin } from '@/lib/services/adminAuth';

export const dynamic = 'force-dynamic';

export default async function EvolutionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isUserAdmin();
  if (!isAdmin) {
    redirect('/');
  }
  return <>{children}</>;
}
