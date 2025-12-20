'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ParagraphNode } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode } from '@lexical/list';
import {
  TextRevealEffect,
  ANIMATION_CLASS_MAP,
  scrambleTextElement,
} from '@/lib/textRevealAnimations';

interface TextRevealPluginProps {
  isStreaming: boolean;
  animationEffect: TextRevealEffect;
}

/**
 * Lexical plugin that applies text reveal animations to new nodes during streaming
 * Uses mutation listeners to detect when new block-level nodes are created
 */
export function TextRevealPlugin({ isStreaming, animationEffect }: TextRevealPluginProps) {
  const [editor] = useLexicalComposerContext();
  const animatedKeysRef = useRef<Set<string>>(new Set());

  // Clear animated keys when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      animatedKeysRef.current.clear();
    }
  }, [isStreaming]);

  useEffect(() => {
    // Skip if no animation or not streaming
    if (animationEffect === 'none' || !isStreaming) {
      return;
    }

    // Check for reduced motion preference
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const animationClass = ANIMATION_CLASS_MAP[animationEffect];

    const applyAnimation = (nodeKey: string) => {
      // Get the DOM element for this node
      const element = editor.getElementByKey(nodeKey);
      if (!element || animatedKeysRef.current.has(nodeKey)) {
        return;
      }

      animatedKeysRef.current.add(nodeKey);
      element.classList.add(animationClass);

      // For scramble effect, also run JS animation
      if (animationEffect === 'scramble') {
        scrambleTextElement(element as HTMLElement, 600);
      }

      // Remove class after animation completes (optional cleanup)
      element.addEventListener('animationend', () => {
        element.classList.remove(animationClass);
      }, { once: true });
    };

    // Register mutation listeners for all block-level nodes
    const unregisterParagraph = editor.registerMutationListener(
      ParagraphNode,
      (mutations) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation === 'created') {
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => applyAnimation(nodeKey));
          }
        }
      }
    );

    const unregisterHeading = editor.registerMutationListener(
      HeadingNode,
      (mutations) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation === 'created') {
            requestAnimationFrame(() => applyAnimation(nodeKey));
          }
        }
      }
    );

    const unregisterQuote = editor.registerMutationListener(
      QuoteNode,
      (mutations) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation === 'created') {
            requestAnimationFrame(() => applyAnimation(nodeKey));
          }
        }
      }
    );

    const unregisterList = editor.registerMutationListener(
      ListNode,
      (mutations) => {
        for (const [nodeKey, mutation] of mutations) {
          if (mutation === 'created') {
            requestAnimationFrame(() => applyAnimation(nodeKey));
          }
        }
      }
    );

    return () => {
      unregisterParagraph();
      unregisterHeading();
      unregisterQuote();
      unregisterList();
    };
  }, [editor, isStreaming, animationEffect]);

  return null;
}
