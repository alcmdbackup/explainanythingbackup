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
  savedDate?: string; // ISO timestamp for when user saved the article
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

/**
 * Formats a saved timestamp as relative time (e.g., "Saved 2 days ago")
 * Uses the most appropriate unit: seconds, minutes, hours, days, weeks, months, years.
 * Returns empty string if timestamp is invalid to avoid runtime errors.
 */
function formatRelativeTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Just now (< 60 seconds)
    if (diffSeconds < 60) return 'Saved just now';
    // Minutes (< 60 minutes)
    if (diffMinutes < 60) {
      return `Saved ${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    // Hours (< 24 hours)
    if (diffHours < 24) {
      return `Saved ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    }
    // Yesterday
    if (diffDays === 1) return 'Saved yesterday';
    // Days (< 7 days)
    if (diffDays < 7) return `Saved ${diffDays} days ago`;
    // Weeks (< 30 days)
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `Saved ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    // Months (< 365 days)
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `Saved ${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    // Years
    const years = Math.floor(diffDays / 365);
    return `Saved ${years} ${years === 1 ? 'year' : 'years'} ago`;
  } catch {
    return '';
  }
}

export default function FeedCard({ explanation, metrics, index = 0, savedDate }: FeedCardProps) {
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
        <time className="text-sm text-[var(--text-muted)] font-ui">
          {formatTimestamp(explanation.timestamp)}
        </time>
        <h2 className="mt-1 text-lg font-display font-semibold text-[var(--text-primary)] line-clamp-2">
          {explanation.explanation_title}
        </h2>
        <p className="mt-2 text-[var(--text-secondary)] font-body line-clamp-3">
          {preview}
        </p>
      </Link>

      {/* Engagement bar - not part of link */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] text-sm">
        <div className="flex items-center gap-4">
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
        {savedDate && (
          <span className="text-[var(--text-muted)] font-ui" data-testid="saved-date">
            {formatRelativeTime(savedDate)}
          </span>
        )}
      </div>
    </article>
  );
}
