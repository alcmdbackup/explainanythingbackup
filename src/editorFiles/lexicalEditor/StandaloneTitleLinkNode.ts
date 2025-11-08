/* eslint-disable @typescript-eslint/no-explicit-any */
import { LinkNode } from '@lexical/link';
import { type EditorConfig, type LexicalNode } from 'lexical';

/**
 * Custom LinkNode that handles standalone title links with special click behavior
 *
 * • Extends the standard LinkNode from @lexical/link
 * • Detects /standalone-title?t= URLs and provides custom click handling
 * • Preserves standard link appearance but adds special behavior for standalone links
 * • Used to handle navigation or content generation for standalone title links
 */
export class StandaloneTitleLinkNode extends LinkNode {
  static getType(): string {
    return 'standalone-title-link';
  }

  static clone(node: StandaloneTitleLinkNode): StandaloneTitleLinkNode {
    return new StandaloneTitleLinkNode(
      node.__url,
      { rel: node.__rel, target: node.__target, title: node.__title },
      node.__key
    );
  }

  createDOM(config: EditorConfig): HTMLAnchorElement {
    const anchorElement = super.createDOM(config) as HTMLAnchorElement;

    // Apply consistent styling matching the theme
    anchorElement.className = 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer transition-colors';

    // Store the URL at DOM creation time when we're in editor context
    const url = this.getURL();

    // Add custom click handler for standalone title links
    anchorElement.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      this.handleStandaloneTitleClick(url);
    });

    return anchorElement;
  }

  private handleStandaloneTitleClick(href: string): void {
    console.log('🔗 StandaloneTitleLinkNode clicked:', href);

    if (href.startsWith('/standalone-title?t=')) {
      try {
        // Extract the standalone title from the URL parameter
        const url = new URL(href, window.location.origin);
        const standaloneTitle = url.searchParams.get('t') || '';

        if (standaloneTitle.trim()) {
          console.log('📝 Standalone title extracted:', standaloneTitle);
          console.log('🚀 Navigating to standalone title:', standaloneTitle);

          // Navigate to results page with the standalone title parameter
          const targetUrl = `/results?t=${encodeURIComponent(standaloneTitle)}`;
          window.location.href = targetUrl;

        } else {
          console.warn('⚠️ Empty standalone title parameter');
        }
      } catch (error) {
        console.error('❌ Error processing standalone title link:', error);
      }
    } else {
      // For non-standalone links, use default behavior
      console.log('🔗 Standard link, using default behavior:', href);
      window.open(href, this.getTarget() || '_self');
    }
  }

  static importJSON(serializedNode: any): StandaloneTitleLinkNode {
    const { url, rel, target, title } = serializedNode;
    const node = $createStandaloneTitleLinkNode(url, { rel, target, title });
    return node;
  }

  exportJSON(): any {
    return {
      ...super.exportJSON(),
      type: 'standalone-title-link',
    };
  }
}

/**
 * Helper function to create a StandaloneTitleLinkNode
 */
export function $createStandaloneTitleLinkNode(
  url: string,
  attributes?: { rel?: string; target?: string; title?: string }
): StandaloneTitleLinkNode {
  return new StandaloneTitleLinkNode(url, attributes);
}

/**
 * Type guard to check if a node is a StandaloneTitleLinkNode
 */
export function $isStandaloneTitleLinkNode(node: LexicalNode | null | undefined): node is StandaloneTitleLinkNode {
  return node instanceof StandaloneTitleLinkNode;
}