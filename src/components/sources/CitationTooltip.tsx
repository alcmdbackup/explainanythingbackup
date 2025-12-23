'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface CitationSource {
  index: number;
  title: string;
  domain: string;
  url: string;
  favicon_url?: string | null;
}

interface CitationTooltipProps {
  source: CitationSource;
  children: React.ReactNode;
  className?: string;
}

/**
 * CitationTooltip - Hover tooltip for inline [n] citations
 *
 * Shows source title + domain on hover
 * Clicking scrolls to Bibliography entry
 */
export default function CitationTooltip({ source, children, className = '' }: CitationTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Position tooltip based on available space
  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const tooltipHeight = 80; // Approximate tooltip height

      setPosition(spaceAbove > tooltipHeight ? 'top' : 'bottom');
    }
  }, [isVisible]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Scroll to the corresponding bibliography entry
    const element = document.getElementById(`source-${source.index}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight briefly
      element.classList.add('bg-[var(--accent-gold)]/10');
      setTimeout(() => {
        element.classList.remove('bg-[var(--accent-gold)]/10');
      }, 2000);
    }
  };

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-block', className)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {/* Citation trigger */}
      <span
        onClick={handleClick}
        className="cursor-pointer text-[var(--accent-gold)] hover:text-[var(--accent-copper)] transition-colors font-ui text-sm align-super"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
        aria-label={`Citation ${source.index}: ${source.title || source.domain}`}
      >
        {children}
      </span>

      {/* Tooltip */}
      {isVisible && (
        <div
          ref={tooltipRef}
          className={cn(
            'absolute z-50 left-1/2 -translate-x-1/2 px-3 py-2 min-w-[200px] max-w-[300px]',
            'bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-page shadow-warm-lg',
            'animate-in fade-in-0 zoom-in-95 duration-150',
            position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          )}
          role="tooltip"
        >
          {/* Arrow */}
          <div
            className={cn(
              'absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45',
              'bg-[var(--surface-elevated)] border-[var(--border-default)]',
              position === 'top'
                ? 'bottom-[-5px] border-r border-b'
                : 'top-[-5px] border-l border-t'
            )}
          />

          {/* Content */}
          <div className="relative flex items-start gap-2">
            {/* Favicon */}
            {source.favicon_url && (
              <img
                src={source.favicon_url}
                alt=""
                className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}

            <div className="flex-1 min-w-0">
              {/* Title */}
              <p className="text-sm font-serif text-[var(--text-primary)] line-clamp-2">
                {source.title || source.domain}
              </p>

              {/* Domain */}
              {source.title && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {source.domain}
                </p>
              )}

              {/* Click hint */}
              <p className="text-xs text-[var(--accent-gold)] mt-1 font-ui">
                Click to jump to source
              </p>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
