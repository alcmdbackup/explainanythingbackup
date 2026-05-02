// Generic renderer for config-driven execution detail display.
// Renders detail fields based on DetailFieldDef config: table, boolean, badge, number, text, list, object.
'use client';

import type { DetailFieldDef } from '@evolution/lib/core/types';

interface Props {
  config: DetailFieldDef[];
  data: Record<string, unknown>;
}

const BADGE_COLORS: Record<string, string> = {
  success: 'bg-[var(--status-success)] text-white',
  error: 'bg-[var(--status-error)] text-white',
  format_rejected: 'bg-[var(--status-warning)] text-white',
  low: 'bg-green-800 text-green-200',
  medium: 'bg-yellow-800 text-yellow-200',
  high: 'bg-red-800 text-red-200',
  convergence: 'bg-green-800 text-green-200',
  budget: 'bg-yellow-800 text-yellow-200',
  stale: 'bg-gray-700 text-gray-300',
  maxRounds: 'bg-gray-700 text-gray-300',
};

function formatValue(value: unknown, formatter?: string): string {
  if (value == null) return '—';
  if (formatter === 'cost' && typeof value === 'number') {
    return `$${value.toFixed(4)}`;
  }
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderBadge(value: unknown): JSX.Element {
  const str = String(value ?? '');
  const color = BADGE_COLORS[str] ?? 'bg-gray-700 text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-ui ${color}`}>
      {str}
    </span>
  );
}

function renderTable(
  rows: unknown[],
  columns: Array<{ key: string; label: string }>,
): JSX.Element {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] font-ui">No data</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-ui" data-testid="detail-table">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            {columns.map(col => (
              <th key={col.key} className="text-left py-1.5 px-2 text-[var(--text-secondary)] font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const r = row as Record<string, unknown>;
            return (
              <tr key={i} className="border-b border-[var(--border-default)] last:border-0">
                {columns.map(col => (
                  <td key={col.key} className="py-1.5 px-2 text-[var(--text-primary)]">
                    {formatValue(r[col.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderField(field: DetailFieldDef, data: Record<string, unknown>): JSX.Element {
  const value = data[field.key];

  switch (field.type) {
    case 'table':
      return (
        <div key={field.key} className="mb-4" data-testid={`field-${field.key}`}>
          <h3 className="text-xl font-display font-semibold text-[var(--text-secondary)] mb-2">{field.label}</h3>
          {renderTable(value as unknown[], field.columns ?? [])}
        </div>
      );

    case 'boolean':
      return (
        <div key={field.key} className="flex items-center gap-2 mb-2" data-testid={`field-${field.key}`}>
          <span className="text-xs font-ui text-[var(--text-secondary)]">{field.label}:</span>
          <span className={`inline-block w-2 h-2 rounded-full ${value ? 'bg-[var(--status-success)]' : 'bg-gray-600'}`} />
          <span className="text-xs font-ui text-[var(--text-primary)]">{value ? 'Yes' : 'No'}</span>
        </div>
      );

    case 'badge':
      return (
        <div key={field.key} className="flex items-center gap-2 mb-2" data-testid={`field-${field.key}`}>
          <span className="text-xs font-ui text-[var(--text-secondary)]">{field.label}:</span>
          {renderBadge(value)}
        </div>
      );

    case 'number':
      return (
        <div key={field.key} className="flex items-center gap-2 mb-2" data-testid={`field-${field.key}`}>
          <span className="text-xs font-ui text-[var(--text-secondary)]">{field.label}:</span>
          <span className="text-xs font-ui text-[var(--text-primary)]">{formatValue(value, field.formatter)}</span>
        </div>
      );

    case 'text':
      return (
        <div key={field.key} className="flex items-center gap-2 mb-2" data-testid={`field-${field.key}`}>
          <span className="text-xs font-ui text-[var(--text-secondary)]">{field.label}:</span>
          <span className="text-xs font-mono text-[var(--text-primary)]">{String(value ?? '—')}</span>
        </div>
      );

    case 'list': {
      const items = Array.isArray(value) ? value : [];
      return (
        <div key={field.key} className="mb-4" data-testid={`field-${field.key}`}>
          <h3 className="text-xl font-display font-semibold text-[var(--text-secondary)] mb-1">{field.label}</h3>
          {items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] font-ui">None</p>
          ) : (
            <ul className="list-disc list-inside text-xs font-ui text-[var(--text-primary)]">
              {items.map((item, i) => <li key={i}>{String(item)}</li>)}
            </ul>
          )}
        </div>
      );
    }

    case 'object': {
      const objData = (value as Record<string, unknown>) ?? {};
      return (
        <div key={field.key} className="mb-4 pl-3 border-l-2 border-[var(--border-default)]" data-testid={`field-${field.key}`}>
          <h3 className="text-xl font-display font-semibold text-[var(--text-secondary)] mb-2">{field.label}</h3>
          {field.children?.map(child => renderField(child, objData))}
        </div>
      );
    }

    case 'text-diff': {
      const before = String(data[field.sourceKey ?? ''] ?? '');
      const after = String(data[field.targetKey ?? ''] ?? '');
      const max = field.previewLength ?? 300;
      return (
        <div key={field.key} className="mb-4" data-testid={`field-${field.key}`}>
          <h3 className="text-xl font-display font-semibold text-[var(--text-secondary)] mb-2">{field.label}</h3>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="border border-[var(--border-default)] rounded p-2">
              <div className="text-[var(--text-muted)] mb-1">Before ({before.length} chars)</div>
              <div className="whitespace-pre-wrap">{before.slice(0, max)}{before.length > max ? '…' : ''}</div>
            </div>
            <div className="border border-[var(--border-default)] rounded p-2">
              <div className="text-[var(--text-muted)] mb-1">After ({after.length} chars)</div>
              <div className="whitespace-pre-wrap">{after.slice(0, max)}{after.length > max ? '…' : ''}</div>
            </div>
          </div>
        </div>
      );
    }

    case 'annotated-edits': {
      const markup = String(data[field.markupKey ?? 'proposedMarkup'] ?? '');
      const decisions = (data[field.decisionsKey ?? 'reviewDecisions'] as Array<{ groupNumber: number; decision: string; reason: string }> | undefined) ?? [];
      return (
        <div key={field.key} className="mb-4" data-testid={`field-${field.key}`}>
          <h3 className="text-xl font-display font-semibold text-[var(--text-secondary)] mb-2">{field.label}</h3>
          <details className="mb-2">
            <summary className="text-xs font-ui text-[var(--text-secondary)] cursor-pointer">Marked-up text ({markup.length} chars)</summary>
            <pre className="text-xs font-mono whitespace-pre-wrap mt-1 p-2 border border-[var(--border-default)] rounded bg-[var(--surface-base)]">{markup}</pre>
          </details>
          <ul className="text-xs font-ui space-y-1">
            {decisions.map((d) => (
              <li key={d.groupNumber} className="flex gap-2">
                <span className={`inline-block w-12 text-center font-mono rounded ${d.decision === 'accept' ? 'bg-[var(--status-success)]/20 text-[var(--status-success)]' : 'bg-[var(--status-error)]/20 text-[var(--status-error)]'}`}>
                  #{d.groupNumber}
                </span>
                <span className="text-[var(--text-primary)]">{d.decision}: {d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    default:
      return (
        <div key={field.key} className="mb-2" data-testid={`field-${field.key}`}>
          <span className="text-xs font-ui text-[var(--text-secondary)]">{field.label}:</span>
          <span className="text-xs font-ui text-[var(--text-primary)] ml-2">{formatValue(value)}</span>
        </div>
      );
  }
}

export function ConfigDrivenDetailRenderer({ config, data }: Props): JSX.Element {
  return (
    <div className="space-y-1" data-testid="config-driven-detail">
      {config.map(field => renderField(field, data))}
    </div>
  );
}
