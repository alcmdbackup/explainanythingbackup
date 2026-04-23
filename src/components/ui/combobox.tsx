// Generic searchable single-select combobox primitive.
//
// U4 (use_playwright_find_bugs_ux_issues_20260422): the planning doc called for
// extracting a primitive from SourceCombobox.tsx, but SourceCombobox is heavily
// coupled to source-discovery semantics (URL detection, favicon rendering,
// per-source frequency badges). Extracting cleanly would require disentangling
// those concerns first.
//
// This file is a smaller, purpose-built generic primitive — a typed
// {value, label} list with search filter, keyboard nav, and click-to-select.
// SourceCombobox stays as it is; it could be migrated onto this primitive
// in a follow-up project once its source-specific affordances are pulled apart.
//
// Used by:
//   - evolution/src/components/evolution/EntityListPage.tsx for the new
//     'combobox' FilterDef type (replaces the unsearchable <select> on the
//     runs Strategy filter when the option list grows past the threshold).
//
// Permanent E2E coverage of the existing SourceCombobox lives at
// src/__tests__/e2e/specs/08-sources/source-combobox-behavior.spec.ts so a
// future migration of SourceCombobox onto this primitive can verify no
// behavior regression.

'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Used as id prefix for the listbox + each option (a11y). */
  idPrefix?: string;
  /** Optional className override on the wrapping <div>. */
  className?: string;
  /** Test id on the input (the combobox button). */
  testId?: string;
  /** ARIA label for the input. */
  'aria-label'?: string;
}

/** Minimal searchable single-select combobox. Uses native focus management
 *  via React state — no Radix dependency for this primitive. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  idPrefix = 'combobox',
  className = '',
  testId,
  'aria-label': ariaLabel,
}: ComboboxProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Display the selected option's label in the input when not typing.
  const selectedLabel = useMemo(() => options.find(o => o.value === value)?.label ?? '', [options, value]);

  // When the input is focused but query is empty, fall back to selectedLabel.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setActiveIdx(-1);
  }, [query, open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (!inputRef.current?.contains(e.target as Node)
        && !listRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const select = useCallback((opt: ComboboxOption): void => {
    onChange(opt.value);
    setQuery('');
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }, [onChange]);

  const handleKey = useCallback((e: React.KeyboardEvent): void => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) {
      e.preventDefault();
      select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  }, [open, filtered, activeIdx, select]);

  const listboxId = `${idPrefix}-listbox`;
  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIdx >= 0 ? `${idPrefix}-opt-${activeIdx}` : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        className="px-2 py-1 text-xs font-ui bg-[var(--surface-input)] text-[var(--text-secondary)] border border-[var(--border-default)] rounded-page w-48"
      />
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-72 max-h-72 overflow-y-auto border border-[var(--border-default)] rounded-page bg-[var(--surface-elevated)] shadow-warm-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1 text-xs text-[var(--text-muted)]">No matches</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.value}
                id={`${idPrefix}-opt-${i}`}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                className={`px-2 py-1 text-xs cursor-pointer ${activeIdx === i
                  ? 'bg-[var(--accent-gold)]/20 text-[var(--accent-gold)]'
                  : opt.value === value
                    ? 'bg-[var(--surface-secondary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]'}`}
                data-testid={`${idPrefix}-opt-${i}`}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
