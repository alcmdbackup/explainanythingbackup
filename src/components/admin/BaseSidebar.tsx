// Shared sidebar shell for admin dashboard variants. Renders nav items with optional group headers.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  testId: string;
  description?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface BaseSidebarProps {
  title: string;
  navItems: NavItem[] | NavGroup[];
  backLink: { label: string; href: string; testId: string };
  activeOverrides?: Record<string, (pathname: string) => boolean>;
}

function isNavGroupArray(items: NavItem[] | NavGroup[]): items is NavGroup[] {
  return items.length > 0 && 'items' in items[0]!;
}

export function BaseSidebar({ title, navItems, backLink, activeOverrides }: BaseSidebarProps): JSX.Element {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (activeOverrides?.[href]) {
      return activeOverrides[href](pathname);
    }
    return pathname.startsWith(href);
  };

  const renderItem = (item: NavItem) => (
    <li key={item.href}>
      <Link
        href={item.href}
        data-testid={item.testId}
        title={item.description}
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
  );

  return (
    <aside className="w-64 bg-[var(--surface-secondary)] border-r border-[var(--border-default)] min-h-screen flex flex-col">
      <div className="p-4 border-b border-[var(--border-default)]">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h1>
      </div>
      <nav className="p-2 flex-1 overflow-y-auto">
        {isNavGroupArray(navItems) ? (
          <div className="space-y-4">
            {navItems.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map(renderItem)}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-1">
            {navItems.map(renderItem)}
          </ul>
        )}
      </nav>
      <div className="p-4 border-t border-[var(--border-default)] mt-auto">
        <Link
          href={backLink.href}
          data-testid={backLink.testId}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {backLink.label}
        </Link>
      </div>
    </aside>
  );
}
