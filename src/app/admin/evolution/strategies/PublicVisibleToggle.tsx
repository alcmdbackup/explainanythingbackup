'use client';
// Inline toggle for the evolution_strategies.public_visible column on the
// admin Strategies list + detail pages (Phase 3 of build_website_for_evolutiOn_20260626).
//
// Disabled when config.budgetUsd > $0.10 with a tooltip explaining why.
// Optimistic UI: flips immediately, calls updateStrategyAction, reverts on
// error with a toast showing the structured error message.

import { useState } from 'react';
import { toast } from 'sonner';
import { updateStrategyAction } from '@evolution/services/strategyRegistryActions';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

const PUBLIC_VISIBLE_BUDGET_CAP_USD = 0.10;

interface Props {
  strategyId: string;
  initialPublicVisible: boolean;
  config: StrategyConfig | null;
  onChange?: (newValue: boolean) => void;
}

export default function PublicVisibleToggle({ strategyId, initialPublicVisible, config, onChange }: Props): React.JSX.Element {
  const [value, setValue] = useState<boolean>(initialPublicVisible);
  const [busy, setBusy] = useState(false);

  const budgetUsd = typeof config?.budgetUsd === 'number' ? config.budgetUsd : null;
  const overBudget = budgetUsd === null || budgetUsd > PUBLIC_VISIBLE_BUDGET_CAP_USD;
  const tooltip = overBudget
    ? `Per-run budget ($${(budgetUsd ?? 0).toFixed(2)}) exceeds the $${PUBLIC_VISIBLE_BUDGET_CAP_USD.toFixed(2)} public cap. Lower budgetUsd first.`
    : value
      ? 'Visible on /edit. Click to hide.'
      : 'Hidden from /edit. Click to publish.';

  async function toggle(): Promise<void> {
    if (busy || overBudget) return;
    const next = !value;
    setValue(next); // optimistic
    setBusy(true);
    try {
      const result = await updateStrategyAction({ id: strategyId, publicVisible: next });
      if (!result?.success) {
        setValue(!next); // revert
        toast.error(result?.error?.message ?? 'Update failed');
        return;
      }
      onChange?.(next);
      toast.success(next ? 'Now visible on /edit' : 'Hidden from /edit');
    } catch (err) {
      setValue(!next); // revert
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="strategy-public-visible-toggle"
      data-public-visible={value ? 'true' : 'false'}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={value}
      disabled={overBudget || busy}
      onClick={toggle}
      className={`inline-flex items-center justify-center min-w-[44px] px-2 py-1 rounded-page border atlas-ui text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        value
          ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)] text-[var(--accent-copper)]'
          : 'border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-muted)]'
      }`}
    >
      {value ? 'Public' : 'Private'}
    </button>
  );
}
