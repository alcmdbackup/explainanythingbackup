/**
 * FeedCard - Reddit-style card component for the Explore feed.
 * Features full-width layout with title, preview, and engagement bar.
 */
'use client';

import Link from 'next/link';
import { EyeIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import ShareButton from '@/components/ShareButton';

interface FeedCardProps {
  explanation: {
    id: number;
    explanation_title: string;
    content: string;
    summary_teaser?: string | null;
    timestamp: string;
  };
  metrics?: {
    total_views: number;
    total_saves: number;
  };
  index?: number;
}

/**
 * Formats numbers for display (e.g., 1000 → "1k")
 */
function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

/**
 * Formats ISO timestamp to readable date
 */
function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Strips markdown title heading from content for preview
 */
function stripTitleFromContent(content: string): string {
  return content.replace(/^#\s+.+\n?/, '').trim();
}

export default function FeedCard({ explanation, metrics, index = 0 }: FeedCardProps) {
  const preview = explanation.summary_teaser || stripTitleFromContent(explanation.content);
  const href = `/results?explanation_id=${explanation.id}`;
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${href}`
    : href;

  return (
    <article
      className="feed-card"
      style={{ '--card-index': index } as React.CSSProperties}
      data-testid="feed-card"
    >
      {/* Clickable content area */}
      <Link href={href} className="block p-5 hover:bg-[var(--surface-elevated)]/50 transition-colors">
        <time className="text-sm text-[var(--text-muted)] font-sans">
          {formatTimestamp(explanation.timestamp)}
        </time>
        <h2 className="mt-1 text-lg font-display font-semibold text-[var(--text-primary)] line-clamp-2">
          {explanation.explanation_title}
        </h2>
        <p className="mt-2 text-[var(--text-secondary)] font-serif line-clamp-3">
          {preview}
        </p>
      </Link>

      {/* Engagement bar - not part of link */}
      <div className="flex items-center gap-4 px-5 py-3 border-t border-[var(--border-default)] text-sm">
        <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
          <EyeIcon className="w-4 h-4" />
          {formatNumber(metrics?.total_views ?? 0)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
          <BookmarkIcon className="w-4 h-4" />
          {formatNumber(metrics?.total_saves ?? 0)}
        </span>
        <ShareButton url={shareUrl} variant="text" />
      </div>
    </article>
  );
}
