/**
 * ExplanationCard - Unified glassmorphism card component for both Explore and Related views.
 * Supports both Link navigation (href) and programmatic loading (onClick) modes.
 */
'use client';

import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';

/**
 * Minimal interface for explanation data - works with both ExplanationWithViewCount
 * and matchWithCurrentContentType after field mapping
 */
interface ExplanationData {
  id: number;
  explanation_title: string;
  content: string;
  summary_teaser?: string | null;
}

interface ExplanationCardProps {
  /** Explanation data with minimal required fields */
  explanation: ExplanationData;
  /** URL for navigation mode - renders as <Link> */
  href?: string;
  /** Click handler for programmatic mode - renders as clickable <div> */
  onClick?: () => void;
  /** Animation stagger index (default: 0) */
  index?: number;
  /** Custom footer content (timestamps, scores, etc.) */
  footer?: ReactNode;
  /** Skip entrance animation (default: false) */
  disableEntrance?: boolean;
  /** Accessible label for onClick variant (default: "View explanation: {title}") */
  ariaLabel?: string;
}

/**
 * Strips markdown title (# heading) from content for preview
 */
function stripTitleFromContent(content: string): string {
  return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
}

/**
 * ExplanationCard - Glassmorphism card with hover effects.
 * Uses gallery-card CSS class for styling.
 *
 * @example
 * // Link mode (Explore page)
 * <ExplanationCard
 *   explanation={exp}
 *   href={`/results?${new URLSearchParams({ explanation_id: exp.id.toString() })}`}
 *   footer={<time>{formatDate(exp.timestamp)}</time>}
 * />
 *
 * @example
 * // onClick mode (Related cards)
 * <ExplanationCard
 *   explanation={{ id: match.explanation_id, explanation_title: match.current_title, ... }}
 *   onClick={() => loadExplanation(match.explanation_id)}
 *   disableEntrance
 *   footer={<ScoreBadges similarity={0.95} diversity={0.8} />}
 * />
 */
export default function ExplanationCard({
  explanation,
  href,
  onClick,
  index = 0,
  footer,
  disableEntrance = false,
  ariaLabel,
}: ExplanationCardProps) {
  // Prefer AI-generated summary_teaser, fallback to stripped content
  const preview = explanation.summary_teaser
    ? explanation.summary_teaser
    : stripTitleFromContent(explanation.content);

  // Safe onClick wrapper with error handling
  const handleClick = useCallback(() => {
    try {
      onClick?.();
    } catch (error) {
      console.error('ExplanationCard onClick failed:', error);
      // Don't rethrow - user stays focused on card
    }
  }, [onClick]);

  // Keyboard handler for onClick variant (WCAG 2.1 AA)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);

  // Build class names
  const articleClasses = [
    'gallery-card',
    !disableEntrance && 'gallery-card-enter',
    'group cursor-pointer',
  ].filter(Boolean).join(' ');

  // Card content - shared between Link and div modes
  const cardContent = (
    <article
      className={articleClasses}
      style={{ '--card-index': index } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Title */}
        <h3 className="font-display text-lg font-semibold text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--accent-gold)] transition-colors duration-200">
          {explanation.explanation_title}
        </h3>

        {/* Preview */}
        <p className="font-serif text-sm text-[var(--text-secondary)] mt-3 line-clamp-4 leading-relaxed">
          {preview}
        </p>
      </div>

      {/* Footer - only render if provided */}
      {footer && (
        <div className="px-5 pb-4 flex items-center justify-between text-xs text-[var(--text-muted)] font-sans">
          {footer}
        </div>
      )}
    </article>
  );

  // Render as Link for navigation mode
  if (href) {
    return (
      <Link
        href={href}
        className="block break-inside-avoid mb-6"
        data-testid="explanation-card"
      >
        {cardContent}
      </Link>
    );
  }

  // Render as clickable div for onClick mode (WCAG 2.1 AA compliant)
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel ?? `View explanation: ${explanation.explanation_title}`}
        className="block break-inside-avoid mb-6"
        data-testid="explanation-card"
      >
        {cardContent}
      </div>
    );
  }

  // Dev-time warning if neither href nor onClick provided
  if (process.env.NODE_ENV === 'development') {
    console.warn('ExplanationCard requires either href or onClick prop');
  }

  // Fallback: render as non-interactive card
  return (
    <div className="block break-inside-avoid mb-6" data-testid="explanation-card">
      {cardContent}
    </div>
  );
}
