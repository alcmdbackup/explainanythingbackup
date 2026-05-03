// Shared detail page header with title, optional inline rename, status badge, cross-links, and actions slot.
// Client component when onRename is used; all current consumers are already client components.

'use client';

import Link from 'next/link';
import { useState, useCallback, type ReactNode } from 'react';

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
  onRename?: (newName: string) => Promise<void>;
  /** Fix #27 (use_playwright_find_ux_issues_bugs_20260501): optional subtitle
   *  rendered below the title — used for completion timestamp on run detail
   *  ("Completed 2 hours ago") so the user doesn't need to bounce back to the
   *  list to learn how recent the run is. */
  subtitle?: ReactNode;
}

export function EntityDetailHeader({
  title,
  entityId,
  statusBadge,
  links,
  actions,
  onRename,
  subtitle,
}: EntityDetailHeaderProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyId = useCallback(async () => {
    if (!entityId) return;
    try {
      await navigator.clipboard.writeText(entityId);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = entityId;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [entityId]);

  const handleSave = async (): Promise<void> => {
    const trimmed = editValue.trim();
    if (!trimmed || !onRename) return;
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = (): void => {
    setEditValue(title);
    setEditing(false);
  };

  return (
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg"
      data-testid="entity-detail-header"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {editing ? (
              <div className="flex items-center gap-2" data-testid="rename-form">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') handleCancel();
                  }}
                  data-testid="rename-input"
                  className="px-2 py-1 text-xl font-display font-bold border border-[var(--border-default)] rounded-page bg-[var(--surface-input)] text-[var(--text-primary)]"
                  autoFocus
                  disabled={saving}
                />
                <button
                  onClick={handleSave}
                  disabled={saving || !editValue.trim()}
                  data-testid="rename-save"
                  className="px-2 py-1 text-xs font-ui bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  data-testid="rename-cancel"
                  className="px-2 py-1 text-xs font-ui text-[var(--text-secondary)] border border-[var(--border-default)] rounded-page disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h1
                  className="text-4xl font-display font-bold text-[var(--text-primary)] min-w-0 flex-shrink-0"
                  title={title}
                >
                  {title}
                </h1>
                {onRename && (
                  <button
                    onClick={() => { setEditValue(title); setEditing(true); }}
                    data-testid="rename-pencil"
                    className="text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
                    title="Rename"
                  >
                    ✏️
                  </button>
                )}
              </>
            )}
            {statusBadge}
          </div>
          {entityId && (
            <button
              onClick={handleCopyId}
              className="flex items-center gap-1 text-xs font-mono text-[var(--text-muted)] mt-1 truncate hover:text-[var(--accent-gold)] transition-colors cursor-pointer"
              title={`Click to copy: ${entityId}`}
              data-testid="entity-id"
            >
              <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="5" y="5" width="9" height="9" rx="1" />
                <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
              </svg>
              {copied ? 'Copied!' : (entityId.length > 12 ? `${entityId.substring(0, 12)}…` : entityId)}
            </button>
          )}
          {subtitle && (
            <div className="text-xs font-ui text-[var(--text-muted)] mt-1" data-testid="entity-subtitle">
              {subtitle}
            </div>
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
              // Fix #25 (use_playwright_find_ux_issues_bugs_20260501): drop the
              // visible "{prefix}: " repetition; the prefix becomes a small
              // muted tag rendered before the label so screen readers still
              // get context but the chip reads cleaner.
              className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] border border-[var(--border-default)] rounded-page px-2 py-0.5"
            >
              <span className="text-[var(--text-muted)] opacity-60 mr-1 uppercase tracking-wide" style={{ fontSize: '0.65rem' }}>{link.prefix}</span>
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
