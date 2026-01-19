'use client';
/**
 * Client wrapper for admin layout.
 * Provides Toaster for success/error notifications across all admin pages.
 */

import { Toaster } from '@/components/ui/sonner';

interface AdminLayoutClientProps {
  children: React.ReactNode;
}

export function AdminLayoutClient({ children }: AdminLayoutClientProps) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
