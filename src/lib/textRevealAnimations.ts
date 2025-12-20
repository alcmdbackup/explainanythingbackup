/**
 * Text Reveal Animation utilities for streaming content
 * Provides types and helper functions for magical text reveal effects
 */

export type TextRevealEffect = 'none' | 'blur' | 'fade' | 'scramble' | 'ink';

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';

/**
 * Type guard for valid text reveal effects
 */
export function isValidTextRevealEffect(value: string): value is TextRevealEffect {
  return ['none', 'blur', 'fade', 'scramble', 'ink'].includes(value);
}

/**
 * Scramble animation for text elements.
 * Replaces characters with random chars, then morphs to actual text.
 * Works by directly manipulating textContent of the element.
 *
 * @param element - The DOM element containing text to scramble
 * @param duration - Total animation duration in ms (default: 600)
 */
export function scrambleTextElement(element: HTMLElement, duration = 600): void {
  // Store original content
  const originalText = element.textContent || '';
  if (!originalText.trim()) return;

  const chars = originalText.split('');
  const iterations = 12;
  const intervalTime = duration / iterations;

  let currentIteration = 0;

  const interval = setInterval(() => {
    currentIteration++;
    const progress = currentIteration / iterations;

    element.textContent = chars.map((char, index) => {
      // Reveal characters progressively from left to right
      if (index / chars.length < progress) {
        return char; // Original character (revealed)
      }
      // Keep whitespace as-is
      if (char === ' ' || char === '\n' || char === '\t') {
        return char;
      }
      // Random character for unrevealed positions
      return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }).join('');

    if (currentIteration >= iterations) {
      clearInterval(interval);
      element.textContent = originalText; // Ensure final state is correct
    }
  }, intervalTime);
}

/**
 * Animation effect display metadata
 */
export const TEXT_REVEAL_EFFECT_OPTIONS: {
  value: TextRevealEffect;
  label: string;
  description: string;
}[] = [
  { value: 'none', label: 'None', description: 'No animation effect' },
  { value: 'blur', label: 'Blur to Focus', description: 'Text materializes from blurry to sharp' },
  { value: 'fade', label: 'Fade & Rise', description: 'Words fade in while rising up' },
  { value: 'scramble', label: 'Decode', description: 'Random characters morph into text' },
  { value: 'ink', label: 'Ink Spread', description: 'Text appears like spreading ink' },
];

/**
 * CSS class mapping for each effect
 */
export const ANIMATION_CLASS_MAP: Record<TextRevealEffect, string> = {
  none: '',
  blur: 'text-reveal-blur',
  fade: 'text-reveal-fade',
  scramble: 'text-reveal-scramble',
  ink: 'text-reveal-ink',
};
