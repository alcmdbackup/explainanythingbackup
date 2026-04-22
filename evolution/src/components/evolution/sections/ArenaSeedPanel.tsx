// Top-of-arena-topic-page panel that prominently displays the topic's seed variant.
// The inline "Seed" badge in the leaderboard row is easy to miss; this panel makes
// the seed a first-class surface with content preview, Elo, match count, and a link
// to the seed variant's detail page.
//
// Data source: getArenaTopicDetailAction.seedVariant — NOT the paginated leaderboard
// entries array, so the panel is always present regardless of which leaderboard page
// the user is on. The call site renders nothing when seedVariant === null.

'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { MetricGrid } from '@evolution/components/evolution/primitives/MetricGrid';
import { formatEloWithUncertainty, formatEloCIRange } from '@evolution/lib/utils/formatters';
import { stripMarkdownTitle } from '@evolution/lib/shared/computeRatings';
import type { ArenaEntry } from '@evolution/services/arenaActions';

const CONTENT_PREVIEW_MAX_CHARS = 80;

export interface ArenaSeedPanelProps {
  seed: ArenaEntry;
}

export function ArenaSeedPanel({ seed }: ArenaSeedPanelProps): JSX.Element {
  // Inline copy-to-clipboard for the full variant UUID. Mirrors the handler in
  // EntityDetailHeader.tsx:37-54; a shared hook can be extracted once a third
  // call site appears (YAGNI for now).
  const [copied, setCopied] = useState(false);
  const handleCopyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(seed.id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = seed.id;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [seed.id]);

  const cleaned = stripMarkdownTitle(seed.variant_content);
  const preview = cleaned.length > CONTENT_PREVIEW_MAX_CHARS
    ? `${cleaned.substring(0, CONTENT_PREVIEW_MAX_CHARS)}…`
    : cleaned;

  const eloLabel = formatEloWithUncertainty(seed.elo_score, seed.uncertainty) ?? String(Math.round(seed.elo_score));
  const ciLabel = formatEloCIRange(seed.elo_score, seed.uncertainty) ?? '—';

  const shortId = seed.id.substring(0, 8);

  return (
    <section
      className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg"
      data-testid="arena-seed-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-2xl font-display text-[var(--text-primary)]">Seed Variant</h2>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-gold) 25%, transparent)',
            color: 'var(--accent-gold)',
          }}
        >
          Seed
        </span>
      </div>

      <p className="text-sm font-body text-[var(--text-secondary)] mb-3 italic">
        &ldquo;{preview}&rdquo;
      </p>

      <div className="flex items-center gap-3 mb-4 text-xs font-ui text-[var(--text-muted)]">
        <span>Variant ID:</span>
        <button
          type="button"
          onClick={handleCopyId}
          className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
          title={`${seed.id} (click to copy)`}
          data-testid="arena-seed-panel-id"
        >
          {shortId}
        </button>
        {copied && <span className="text-[var(--status-success)]">Copied!</span>}
      </div>

      <MetricGrid
        variant="card"
        columns={3}
        metrics={[
          { label: 'Elo', value: eloLabel },
          { label: '95% CI', value: ciLabel },
          { label: 'Matches', value: String(seed.arena_match_count) },
        ]}
      />

      <div className="mt-4">
        <Link
          href={`/admin/evolution/variants/${seed.id}`}
          className="text-sm font-ui text-[var(--accent-gold)] hover:underline"
          data-testid="arena-seed-panel-link"
        >
          View seed variant &rarr;
        </Link>
      </div>
    </section>
  );
}
