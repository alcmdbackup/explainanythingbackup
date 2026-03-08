// Shared detail page header with title, status badge, cross-link badges, and actions slot.
// Pure presentational component safe for use in both server and client components.

import Link from 'next/link';
import type { ReactNode } from 'react';

export interface EntityLink {
  prefix: string;
  label: string;
  href: string;
}

export interface EntityDetailHeaderProps {
  title: string;
  entityId?: string;
  statusBadge?: ReactNode;
  links?: EntityLink[];
  actions?: ReactNode;
}

export function EntityDetailHeader({
  title,
  entityId,
  statusBadge,
  links,
  actions,
}: EntityDetailHeaderProps): JSX.Element {
  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg"
      data-testid="entity-detail-header"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display font-bold text-[var(--text-primary)] truncate">
              {title}
            </h1>
            {statusBadge}
          </div>
          {entityId && (
            <p
              className="text-xs font-mono text-[var(--text-muted)] mt-1 truncate"
              title={entityId}
              data-testid="entity-id"
            >
              {entityId.length > 12 ? `${entityId.substring(0, 12)}…` : entityId}
            </p>
          )}
        </div>
        {actions && <div className="flex-shrink-0" data-testid="header-actions">{actions}</div>}
      </div>
      {links && links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="cross-links">
          {links.map((link) => (
            <Link
              key={`${link.prefix}-${link.href}`}
              href={link.href}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] border border-[var(--border-default)] rounded-page px-2 py-0.5"
            >
              {link.prefix}: {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
