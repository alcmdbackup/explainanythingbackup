'use client';
/**
 * Admin sidebar navigation component.
 * Provides navigation links to all admin sections with active state highlighting.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  testId: string;
}

const navItems: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '📊', testId: 'admin-sidebar-nav-dashboard' },
  { href: '/admin/content', label: 'Content', icon: '📝', testId: 'admin-sidebar-nav-content' },
  { href: '/admin/content/reports', label: 'Reports Queue', icon: '🚨', testId: 'admin-sidebar-nav-reports' },
  { href: '/admin/users', label: 'Users', icon: '👥', testId: 'admin-sidebar-nav-users' },
  { href: '/admin/costs', label: 'Costs', icon: '💰', testId: 'admin-sidebar-nav-costs' },
  { href: '/admin/quality/evolution', label: 'Evolution', icon: '🧬', testId: 'admin-sidebar-nav-evolution' },
  { href: '/admin/quality/article-bank', label: 'Article Bank', icon: '🏦', testId: 'admin-sidebar-nav-article-bank' },
  { href: '/admin/quality', label: 'Quality Scores', icon: '📈', testId: 'admin-sidebar-nav-quality' },
  { href: '/admin/whitelist', label: 'Whitelist', icon: '🔗', testId: 'admin-sidebar-nav-whitelist' },
  { href: '/admin/audit', label: 'Audit Log', icon: '📋', testId: 'admin-sidebar-nav-audit' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️', testId: 'admin-sidebar-nav-settings' },
  { href: '/admin/dev-tools', label: 'Dev Tools', icon: '🛠️', testId: 'admin-sidebar-nav-dev-tools' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin';
    }
    // Reports Queue should only highlight for reports path
    if (href === '/admin/content/reports') {
      return pathname.startsWith('/admin/content/reports');
    }
    // Content should not highlight when on reports
    if (href === '/admin/content') {
      return pathname === '/admin/content' ||
        (pathname.startsWith('/admin/content') && !pathname.startsWith('/admin/content/reports'));
    }
    // Quality Scores should not highlight when on evolution sub-page
    if (href === '/admin/quality') {
      return pathname === '/admin/quality';
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 bg-[var(--surface-secondary)] border-r border-[var(--border-default)] min-h-screen">
      <div className="p-4 border-b border-[var(--border-default)]">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          Admin Dashboard
        </h1>
      </div>
      <nav className="p-2">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                data-testid={item.testId}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-md text-sm
                  transition-colors duration-150
                  ${isActive(item.href)
                    ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]'
                  }
                `}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="absolute bottom-4 left-4 right-4">
        <Link
          href="/"
          data-testid="admin-sidebar-back-to-app"
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← Back to App
        </Link>
      </div>
    </aside>
  );
}
