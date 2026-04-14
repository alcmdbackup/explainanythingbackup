'use client';
// Generic Gantt-style bar primitive — renders a single track with a positioned fill,
// independent of invocation-list data shapes. Owns only the track + fill + optional
// failed-indicator; flanking label/duration/cost columns remain the responsibility
// of the parent layout (e.g., TimelineTab's row chrome).
//
// Positioning math:
//   leftPct = (startMs / totalMs) * 100
//   widthPct = clamp((durationMs / totalMs) * 100, MIN_WIDTH_PCT, 100 - leftPct)

import Link from 'next/link';

const MIN_WIDTH_PCT = 0.5; // Ensure sub-second bars are visible

export interface GanttBarProps {
  /** Start offset in milliseconds, relative to the timeline origin. */
  startMs: number;
  /** Duration in milliseconds. Null/undefined/0 renders a minimum-width placeholder. */
  durationMs: number | null | undefined;
  /** Total timeline span in milliseconds; used to compute percentage positions. */
  totalMs: number;
  /** Fill color (hex or CSS color). */
  color: string;
  /** Optional text rendered inside the bar (only shown if widthPct > 6). */
  label?: string;
  /** If provided, the bar is wrapped in a Next.js Link. */
  href?: string;
  /** Multi-line tooltip. */
  tooltip?: string;
  /** If true, renders a red ✗ indicator immediately after the bar. */
  failed?: boolean;
  /** Error message for the failed indicator's title attribute. */
  errorMessage?: string;
  /** Optional data-testid for assertions. */
  testId?: string;
}

/** Compute the positioning percentages for a bar. Exported for reuse by callers
 *  that need to align overlay elements with the bar (e.g., sub-bars). */
export function computeBarPosition(
  startMs: number,
  durationMs: number | null | undefined,
  totalMs: number,
): { leftPct: number; widthPct: number } {
  const safeTotal = Math.max(totalMs, 1);
  const leftPct = Math.min(100, Math.max(0, (startMs / safeTotal) * 100));
  const width = durationMs ?? 0;
  const widthPct = Math.min(Math.max((width / safeTotal) * 100, MIN_WIDTH_PCT), 100 - leftPct);
  return { leftPct, widthPct };
}

export function GanttBar({
  startMs,
  durationMs,
  totalMs,
  color,
  label,
  href,
  tooltip,
  failed,
  errorMessage,
  testId,
}: GanttBarProps): JSX.Element {
  const { leftPct, widthPct } = computeBarPosition(startMs, durationMs, totalMs);

  const barStyle = { left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: color } as const;
  const barClass =
    'absolute inset-y-0 rounded hover:brightness-110 transition-[filter] flex items-center overflow-hidden z-10';

  const content = widthPct > 6 && label ? (
    <span className="pl-1.5 text-xs font-mono text-white/90 truncate pointer-events-none">
      {label}
    </span>
  ) : null;

  return (
    <div
      className="flex-1 relative h-5 rounded"
      style={{ backgroundColor: 'color-mix(in srgb, var(--surface-secondary) 80%, transparent)' }}
    >
      {href ? (
        <Link
          href={href}
          title={tooltip}
          style={barStyle}
          className={barClass}
          data-testid={testId}
        >
          {content}
        </Link>
      ) : (
        <div
          title={tooltip}
          style={barStyle}
          className={barClass}
          data-testid={testId}
        >
          {content}
        </div>
      )}
      {failed && (
        <span
          style={{ left: `${leftPct + widthPct + 0.5}%` }}
          className="absolute inset-y-0 flex items-center text-[var(--status-error)] text-xs"
          title={errorMessage ?? 'failed'}
        >✗</span>
      )}
    </div>
  );
}
