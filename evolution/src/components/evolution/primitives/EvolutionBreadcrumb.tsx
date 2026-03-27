// Shared breadcrumb component for all evolution dashboard pages.
// Renders a consistent trail like "Evolution / Run abc123 / Logs".

import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface EvolutionBreadcrumbProps {
  items: BreadcrumbItem[];
}

export function EvolutionBreadcrumb({ items }: EvolutionBreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-xs text-[var(--text-muted)]" data-testid="evolution-breadcrumb">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1" aria-hidden="true">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-[var(--accent-gold)] hover:underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
