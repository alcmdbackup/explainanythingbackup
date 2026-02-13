'use client';
// Admin sidebar navigation. Thin wrapper over BaseSidebar with admin-specific nav items.

import { BaseSidebar, NavItem } from '@/components/admin/BaseSidebar';

const navItems: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '📊', testId: 'admin-sidebar-nav-dashboard' },
  { href: '/admin/content', label: 'Content', icon: '📝', testId: 'admin-sidebar-nav-content' },
  { href: '/admin/content/reports', label: 'Reports Queue', icon: '🚨', testId: 'admin-sidebar-nav-reports' },
  { href: '/admin/users', label: 'Users', icon: '👥', testId: 'admin-sidebar-nav-users' },
  { href: '/admin/costs', label: 'Costs', icon: '💰', testId: 'admin-sidebar-nav-costs' },
  { href: '/admin/evolution-dashboard', label: 'Evolution', icon: '🧬', testId: 'admin-sidebar-nav-evolution' },
  { href: '/admin/whitelist', label: 'Whitelist', icon: '🔗', testId: 'admin-sidebar-nav-whitelist' },
  { href: '/admin/audit', label: 'Audit Log', icon: '📋', testId: 'admin-sidebar-nav-audit' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️', testId: 'admin-sidebar-nav-settings' },
  { href: '/admin/dev-tools', label: 'Dev Tools', icon: '🛠️', testId: 'admin-sidebar-nav-dev-tools' },
];

const activeOverrides: Record<string, (pathname: string) => boolean> = {
  '/admin': (p) => p === '/admin',
  '/admin/content/reports': (p) => p.startsWith('/admin/content/reports'),
  '/admin/content': (p) => p === '/admin/content' || (p.startsWith('/admin/content') && !p.startsWith('/admin/content/reports')),
};

export function AdminSidebar() {
  return (
    <BaseSidebar
      title="Admin Dashboard"
      navItems={navItems}
      backLink={{ label: '← Back to App', href: '/', testId: 'admin-sidebar-back-to-app' }}
      activeOverrides={activeOverrides}
    />
  );
}
