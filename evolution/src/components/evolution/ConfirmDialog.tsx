// Reusable confirmation dialog for destructive/important actions.
// Replaces 3+ inline confirm dialogs across Prompts, Strategies, Arena.

'use client';

import React, { useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  danger = false,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-book bg-[var(--surface-secondary)] p-6 shadow-warm">
        <h3 className="font-display text-xl font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-2 font-ui text-sm text-[var(--text-secondary)]">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-book px-4 py-2 font-ui text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`rounded-book px-4 py-2 font-ui text-sm font-medium text-white ${
              danger ? 'bg-[var(--status-error)] hover:opacity-90' : 'bg-[var(--accent-gold)] hover:opacity-90'
            }`}
          >
            {loading ? 'Loading...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
