// Reusable form dialog with configurable field types for CRUD operations.
// Uses Radix Dialog for accessible modal behavior (focus trap, Escape, aria-modal).

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── Types ───────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'custom';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  render?: (value: unknown, onChange: (value: unknown) => void) => React.ReactNode;
}

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldDef[];
  initial?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  validate?: (values: Record<string, unknown>) => string | null;
  children?: React.ReactNode;
  onFormChange?: (values: Record<string, unknown>) => void;
}

// ─── Component ───────────────────────────────────────────────────

export function FormDialog({
  open,
  onClose,
  title,
  fields,
  initial = {},
  onSubmit,
  validate,
  children,
  onFormChange,
}: FormDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateField = useCallback(
    (name: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  // Notify parent of form changes via effect (avoids setState-in-render when
  // the parent's onFormChange triggers its own setState — which would fire
  // during FormDialog's render phase if called inside the setValues updater).
  useEffect(() => {
    onFormChange?.(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (validate) {
      const err = validate(values);
      if (err) {
        setError(err);
        return;
      }
    }

    setLoading(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const inputClasses = 'mt-1 w-full rounded-book border border-[var(--border-default)] bg-[var(--surface-input)] p-2 font-ui text-sm text-[var(--text-primary)]';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-book bg-[var(--surface-secondary)] p-6 shadow-warm-lg border-[var(--border-default)]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-semibold text-[var(--text-primary)]">{title}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="mt-2 rounded-book bg-[var(--status-error)]/10 p-2 font-ui text-sm text-[var(--status-error)]" role="alert">{error}</div>
        )}

        {children}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {fields.map((field) => {
            const fieldId = `form-dialog-${field.name}`;
            const errorId = `${fieldId}-error`;
            return (
              <div key={field.name}>
                <label htmlFor={fieldId} className="block font-ui text-sm font-medium text-[var(--text-secondary)]">
                  {field.label}
                  {field.required && <span className="text-[var(--status-error)]"> *</span>}
                </label>

                {field.type === 'text' && (
                  <input
                    id={fieldId}
                    type="text"
                    value={(values[field.name] as string) ?? ''}
                    onChange={(e) => updateField(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    className={inputClasses}
                    required={field.required}
                    aria-describedby={error ? errorId : undefined}
                  />
                )}

                {field.type === 'textarea' && (
                  <textarea
                    id={fieldId}
                    value={(values[field.name] as string) ?? ''}
                    onChange={(e) => updateField(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    className={inputClasses}
                    rows={4}
                    required={field.required}
                    aria-describedby={error ? errorId : undefined}
                  />
                )}

                {field.type === 'select' && (
                  <select
                    id={fieldId}
                    value={(values[field.name] as string) ?? ''}
                    onChange={(e) => updateField(field.name, e.target.value)}
                    className={inputClasses}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'number' && (
                  <input
                    id={fieldId}
                    type="number"
                    value={(values[field.name] as number) ?? ''}
                    onChange={(e) => updateField(field.name, parseFloat(e.target.value))}
                    className={inputClasses}
                    required={field.required}
                  />
                )}

                {field.type === 'checkbox' && (
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={(values[field.name] as boolean) ?? false}
                    onChange={(e) => updateField(field.name, e.target.checked)}
                    className="mt-1"
                  />
                )}

                {field.type === 'custom' && field.render?.(
                  values[field.name],
                  (v) => updateField(field.name, v),
                )}
              </div>
            );
          })}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-book px-4 py-2 font-ui text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-book bg-[var(--accent-gold)] px-4 py-2 font-ui text-sm font-medium text-white hover:opacity-90"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
