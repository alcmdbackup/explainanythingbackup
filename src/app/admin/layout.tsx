/**
 * Admin layout with database-backed authentication.
 * Redirects non-admin users to home page using server-side check.
 */

import { redirect } from 'next/navigation';
import { isUserAdmin } from '@/lib/services/adminAuth';
import { SidebarSwitcher } from '@/components/admin/SidebarSwitcher';
import { AdminLayoutClient } from '@/components/admin/AdminLayoutClient';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isUserAdmin();

  if (!isAdmin) {
    redirect('/');
  }

  return (
    <AdminLayoutClient>
      <div className="min-h-screen bg-background flex">
        <SidebarSwitcher />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </AdminLayoutClient>
  );
}
