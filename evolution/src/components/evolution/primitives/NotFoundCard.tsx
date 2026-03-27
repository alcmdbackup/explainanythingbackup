// Shared 404 card for entity detail pages that can't use Next.js notFound() (client components).
'use client';

import Link from 'next/link';
import { EvolutionBreadcrumb, type BreadcrumbItem } from './EvolutionBreadcrumb';

export interface NotFoundCardProps {
  entityType: string;
  breadcrumbs?: BreadcrumbItem[];
}

export function NotFoundCard({ entityType, breadcrumbs }: NotFoundCardProps): JSX.Element {
  return (
    <div className="space-y-6">
      {breadcrumbs && <EvolutionBreadcrumb items={breadcrumbs} />}
      <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture p-8 text-center">
        <p className="font-display text-2xl font-semibold text-[var(--text-primary)] mb-2">
          {entityType} not found
        </p>
        <p className="font-ui text-sm text-[var(--text-muted)] mb-4">
          The requested {entityType.toLowerCase()} does not exist or has been deleted.
        </p>
        <Link
          href="/admin/evolution-dashboard"
          className="font-ui text-sm text-[var(--accent-gold)] hover:underline"
        >
          Back to Evolution Dashboard
        </Link>
      </div>
    </div>
  );
}
