'use client';
// Inline popover for selecting criteria UUIDs for a criteria_and_generate iteration.
// Used by the strategy creation wizard. Extracted from page.tsx so the unit test can
// import without violating Next.js page-route export restrictions.

import { useState } from 'react';
import Link from 'next/link';
import type { CriteriaListItem } from '@evolution/services/criteriaActions';

export function CriteriaMultiSelect({
  availableCriteria,
  selected,
  onChange,
  onClose,
}: {
  availableCriteria: CriteriaListItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const filtered = availableCriteria.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const allFilteredIds = filtered.map((c) => c.id);
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.includes(c.id));
  const toggleAll = () => {
    if (allSelected) onChange(selected.filter((id) => !allFilteredIds.includes(id)));
    else onChange([...new Set([...selected, ...allFilteredIds])]);
  };

  return (
    <div className="mt-2 ml-8 p-3 border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] max-w-2xl" data-testid="criteria-multi-select">
      <div className="flex items-center justify-between gap-2 mb-2">
        <input
          type="text"
          placeholder="Search criteria..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-2 py-1 text-xs border border-[var(--border-default)] rounded bg-[var(--bg-input)]"
        />
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs px-2 py-1 border border-[var(--border-default)] rounded hover:bg-[var(--bg-elevated)]"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 border border-[var(--border-default)] rounded hover:bg-[var(--bg-elevated)]"
        >
          Done
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-2">
          {search
            ? `No criteria matching "${search}".`
            : <>No active criteria. <Link href="/admin/evolution/criteria" className="text-[var(--accent-gold)] underline">Create one →</Link></>}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.map((c) => (
            <label key={c.id} className="flex items-start gap-2 text-xs cursor-pointer p-1 hover:bg-[var(--bg-elevated)] rounded">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <span className="font-medium">{c.name}</span>
                <span className="text-[var(--text-muted)] ml-1">({c.min_rating}-{c.max_rating})</span>
                {c.description && <p className="text-[var(--text-muted)]">{c.description}</p>}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
