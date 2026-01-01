'use client';

import Link from 'next/link';
import { EyeIcon } from '@heroicons/react/24/outline';
import { formatUserFriendlyDate } from '@/lib/utils/formatDate';
import { type ExplanationWithViewCount } from '@/lib/schemas/schemas';

interface ExplanationCardProps {
  explanation: ExplanationWithViewCount;
  index?: number;
  showViews?: boolean;
}

/**
 * Strips markdown title (# heading) from content for preview
 */
function stripTitleFromContent(content: string): string {
  return content.replace(/^#+\s.*(?:\r?\n|$)/, '').trim();
}

/**
 * ExplanationCard - Glassmorphism card with hover effects
 * Uses gallery-card CSS class for styling
 */
export default function ExplanationCard({
  explanation,
  index = 0,
  showViews = false,
}: ExplanationCardProps) {
  // Prefer AI-generated summary_teaser, fallback to stripped content
  const preview = explanation.summary_teaser
    ? explanation.summary_teaser
    : stripTitleFromContent(explanation.content);

  return (
    <Link
      href={`/results?explanation_id=${explanation.id}`}
      className="block break-inside-avoid mb-6"
      data-testid="explanation-card"
    >
      <article
        className="gallery-card gallery-card-enter group cursor-pointer"
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

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-between text-xs text-[var(--text-muted)] font-sans">
          <time dateTime={explanation.timestamp}>
            {formatUserFriendlyDate(explanation.timestamp)}
          </time>

          {showViews && explanation.viewCount !== undefined && (
            <span className="flex items-center gap-1 text-[var(--accent-gold)]">
              <EyeIcon className="w-3.5 h-3.5" />
              {explanation.viewCount.toLocaleString()}
            </span>
          )}
        </div>
      </article>
    </Link>
  );
}
