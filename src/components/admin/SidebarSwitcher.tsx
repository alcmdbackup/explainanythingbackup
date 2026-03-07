'use client';
// Conditionally renders AdminSidebar or EvolutionSidebar based on current pathname.

import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { EvolutionSidebar } from '@/components/admin/EvolutionSidebar';

export function SidebarSwitcher(): JSX.Element {
  const pathname = usePathname();

  const isEvolutionPath =
    pathname.startsWith('/admin/evolution-dashboard') ||
    pathname.startsWith('/admin/evolution/') ||
    pathname === '/admin/quality' || pathname.startsWith('/admin/quality/');

  return isEvolutionPath ? <EvolutionSidebar /> : <AdminSidebar />;
}
