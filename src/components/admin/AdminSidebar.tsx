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
}

const navItems: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '📊' },
  { href: '/admin/content', label: 'Content', icon: '📝' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/costs', label: 'Costs', icon: '💰' },
  { href: '/admin/whitelist', label: 'Whitelist', icon: '🔗' },
  { href: '/admin/audit', label: 'Audit Log', icon: '📋' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
  { href: '/admin/dev-tools', label: 'Dev Tools', icon: '🛠️' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin';
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] min-h-screen">
      <div className="p-4 border-b border-[var(--border-color)]">
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
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-md text-sm
                  transition-colors duration-150
                  ${isActive(item.href)
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
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
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← Back to App
        </Link>
      </div>
    </aside>
  );
}
