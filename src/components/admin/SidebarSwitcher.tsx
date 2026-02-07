'use client';
// Conditionally renders AdminSidebar or EvolutionSidebar based on current pathname.

import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { EvolutionSidebar } from '@/components/admin/EvolutionSidebar';

export function SidebarSwitcher() {
  const pathname = usePathname();

  // URL-to-sidebar mapping:
  // Evolution sidebar: /admin/evolution-dashboard, /admin/quality, /admin/quality/*
  // Admin sidebar: everything else under /admin/*
  const isEvolutionPath =
    pathname.startsWith('/admin/evolution-dashboard') ||
    pathname === '/admin/quality' ||
    pathname.startsWith('/admin/quality/');

  return isEvolutionPath ? <EvolutionSidebar /> : <AdminSidebar />;
}
