'use client';

import { useEffect, useCallback, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { createPortal } from 'react-dom';

interface CitationSource {
  index: number;
  title: string;
  domain: string;
  url: string;
  favicon_url?: string | null;
}

interface CitationPluginProps {
  sources: CitationSource[];
  enabled?: boolean;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  source: CitationSource | null;
}

/**
 * CitationPlugin - Lexical plugin for citation [n] interactivity
 *
 * Detects [n] patterns in text content and:
 * - Adds hover tooltip showing source info
 * - Adds click handler to scroll to Bibliography
 */
export function CitationPlugin({ sources, enabled = true }: CitationPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    source: null
  });

  // Citation pattern: [1], [2], etc. - defined inside callbacks to avoid dependency issues

  // Find source by index
  const getSourceByIndex = useCallback((index: number): CitationSource | null => {
    return sources.find(s => s.index === index) || null;
  }, [sources]);

  // Handle click on citation - scroll to bibliography
  const handleCitationClick = useCallback((index: number) => {
    const element = document.getElementById(`source-${index}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight briefly
      element.classList.add('citation-highlight');
      setTimeout(() => {
        element.classList.remove('citation-highlight');
      }, 2000);
    }
  }, []);

  // Process DOM to add citation interactivity
  const processCitations = useCallback(() => {
    if (!enabled || sources.length === 0) return;

    const citationPattern = /\[(\d+)\]/g;

    // Get the editor DOM element
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    // Find all text nodes and process [n] patterns
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode.textContent?.match(citationPattern)) {
        textNodes.push(currentNode as Text);
      }
      currentNode = walker.nextNode();
    }

    // Process each text node
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const parent = textNode.parentNode;
      if (!parent) return;

      // Skip if already processed (has citation-link class ancestor)
      if ((textNode.parentElement as HTMLElement)?.closest('.citation-link')) {
        return;
      }

      // Split text by citation pattern and create elements
      const parts: (string | { type: 'citation'; index: number; text: string })[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      const regex = /\[(\d+)\]/g;
      while ((match = regex.exec(text)) !== null) {
        // Add text before citation
        if (match.index > lastIndex) {
          parts.push(text.slice(lastIndex, match.index));
        }
        // Add citation
        parts.push({
          type: 'citation',
          index: parseInt(match[1], 10),
          text: match[0]
        });
        lastIndex = regex.lastIndex;
      }
      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }

      // Only process if we found citations
      if (parts.length <= 1) return;

      // Create document fragment with processed content
      const fragment = document.createDocumentFragment();
      parts.forEach(part => {
        if (typeof part === 'string') {
          fragment.appendChild(document.createTextNode(part));
        } else {
          const source = getSourceByIndex(part.index);
          const span = document.createElement('span');
          span.className = 'citation-link';
          span.textContent = part.text;
          span.style.cssText = `
            color: var(--accent-gold);
            cursor: pointer;
            font-size: 0.875em;
            vertical-align: super;
            transition: color 0.2s;
          `;
          span.dataset.citationIndex = part.index.toString();

          // Hover effects
          span.addEventListener('mouseenter', () => {
            span.style.color = 'var(--accent-copper)';
            if (source) {
              const rect = span.getBoundingClientRect();
              setTooltip({
                visible: true,
                x: rect.left + rect.width / 2,
                y: rect.top,
                source
              });
            }
          });
          span.addEventListener('mouseleave', () => {
            span.style.color = 'var(--accent-gold)';
            setTooltip(prev => ({ ...prev, visible: false }));
          });

          // Click handler
          span.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCitationClick(part.index);
          });

          fragment.appendChild(span);
        }
      });

      // Replace text node with processed content
      parent.replaceChild(fragment, textNode);
    });
  }, [editor, sources, enabled, getSourceByIndex, handleCitationClick]);

  // Process citations when content changes
  useEffect(() => {
    if (!enabled || sources.length === 0) return;

    // Process on mount and after updates
    const timeoutId = setTimeout(processCitations, 100);

    // Also listen for content updates
    const unregister = editor.registerUpdateListener(() => {
      // Debounce processing
      setTimeout(processCitations, 100);
    });

    return () => {
      clearTimeout(timeoutId);
      unregister();
    };
  }, [editor, processCitations, enabled, sources]);

  // Tooltip component rendered via portal
  const tooltipElement = tooltip.visible && tooltip.source && typeof document !== 'undefined' ? (
    createPortal(
      <div
        style={{
          position: 'fixed',
          left: tooltip.x,
          top: tooltip.y - 8,
          transform: 'translate(-50%, -100%)',
          zIndex: 9999,
          pointerEvents: 'none'
        }}
        className="animate-in fade-in-0 zoom-in-95 duration-150"
      >
        <div className="px-3 py-2 min-w-[180px] max-w-[280px] bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-page shadow-warm-lg">
          {/* Arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 bottom-[-5px] w-2 h-2 rotate-45 bg-[var(--surface-elevated)] border-r border-b border-[var(--border-default)]"
          />

          {/* Content */}
          <div className="relative flex items-start gap-2">
            {/* Favicon - using img for dynamic external URLs */}
            {tooltip.source.favicon_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tooltip.source.favicon_url}
                alt=""
                className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-serif text-[var(--text-primary)] line-clamp-2">
                {tooltip.source.title || tooltip.source.domain}
              </p>
              {tooltip.source.title && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {tooltip.source.domain}
                </p>
              )}
              <p className="text-xs text-[var(--accent-gold)] mt-1 font-ui">
                Click to jump to source
              </p>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )
  ) : null;

  return <>{tooltipElement}</>;
}

// Add CSS for citation highlight animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    .citation-highlight {
      background-color: rgba(var(--accent-gold-rgb, 212, 175, 55), 0.15) !important;
      transition: background-color 0.3s ease-out;
    }
  `;
  if (!document.head.querySelector('#citation-plugin-styles')) {
    style.id = 'citation-plugin-styles';
    document.head.appendChild(style);
  }
}
