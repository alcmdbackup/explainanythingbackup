// Reusable confirmation dialog for destructive/important actions.
// Uses Radix Dialog for accessible modal behavior (focus trap, Escape, aria-modal).

'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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

  const handleConfirm = async () => {
    if (loading) return; // Prevent double-submit
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="w-full max-w-md rounded-book bg-[var(--surface-secondary)] p-6 shadow-warm-lg border-[var(--border-default)]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-semibold text-[var(--text-primary)]">{title}</DialogTitle>
          <DialogDescription className="mt-2 font-ui text-sm text-[var(--text-secondary)]">{message}</DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
