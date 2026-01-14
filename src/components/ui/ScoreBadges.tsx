/**
 * ScoreBadges - Displays similarity and diversity score badges for Related cards.
 * Shows percentage values with accessible labels and consistent styling.
 */
'use client';

interface ScoreBadgesProps {
  /** Similarity score from 0-1 (required) */
  similarity: number;
  /** Diversity score from 0-1, or null if unavailable */
  diversity?: number | null;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Formats a 0-1 score as a percentage string
 */
function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * ScoreBadges component for displaying match quality metrics.
 * Used in Related cards to show how well a match fits the current explanation.
 *
 * @example
 * <ScoreBadges similarity={0.95} diversity={0.8} />
 * // Renders: "95% Match" and "80% Diverse" badges
 *
 * @example
 * <ScoreBadges similarity={0.85} diversity={null} />
 * // Renders only "85% Match" badge when diversity is unavailable
 */
export default function ScoreBadges({
  similarity,
  diversity,
  className = '',
}: ScoreBadgesProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Similarity Badge */}
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] border border-[var(--accent-gold)]/20"
        title={`Similarity: ${formatScore(similarity)}`}
      >
        <svg
          className="w-3 h-3 mr-1"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        {formatScore(similarity)} Match
      </span>

      {/* Diversity Badge (only shown if score exists) */}
      {diversity !== null && diversity !== undefined && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-copper)]/10 text-[var(--accent-copper)] border border-[var(--accent-copper)]/20"
          title={`Diversity: ${formatScore(diversity)}`}
        >
          <svg
            className="w-3 h-3 mr-1"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
          </svg>
          {formatScore(diversity)} Diverse
        </span>
      )}
    </div>
  );
}
