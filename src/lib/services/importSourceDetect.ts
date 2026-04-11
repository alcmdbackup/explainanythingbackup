/**
 * Client-safe AI source detection for imported content.
 * Pure regex scoring with no server-only dependencies — safe to import from client components.
 */

import { type ImportSource } from '@/lib/schemas/schemas';

const SOURCE_PATTERNS: Record<Exclude<ImportSource, 'generated'>, RegExp[]> = {
    chatgpt: [
        /^(Certainly!|Sure!|Of course!|Absolutely!)/i,
        /I'd be happy to help/i,
        /Here's (a|an|the|my)/i,
        /Let me (help|explain|break)/i,
        /Great question!/i,
    ],
    claude: [
        /I'll help you/i,
        /I can help with that/i,
        /Here's (a|an|my) (detailed|comprehensive|thorough)/i,
        /Let me (walk|guide) you through/i,
        /I'd be glad to/i,
    ],
    gemini: [
        /Here's (some information|what I found)/i,
        /Based on (my|the) (knowledge|information)/i,
        /I can provide/i,
    ],
    other: []
};

const CLOSING_PATTERNS: RegExp[] = [
    /Let me know if you (have|need|want)/i,
    /Hope this helps!/i,
    /Feel free to ask/i,
    /Would you like me to/i,
    /Is there anything else/i,
];

/**
 * Detects the likely source of AI-generated content using heuristic pattern matching.
 * Returns 'other' if no source scores high enough or there is no clear winner.
 */
export function detectSource(content: string): ImportSource {
    const scores: Record<Exclude<ImportSource, 'generated' | 'other'>, number> = {
        chatgpt: 0,
        claude: 0,
        gemini: 0,
    };

    const firstParagraph = content.slice(0, 500);

    for (const [source, patterns] of Object.entries(SOURCE_PATTERNS)) {
        if (source === 'other' || source === 'generated') continue;

        for (const pattern of patterns) {
            if (pattern.test(firstParagraph)) {
                scores[source as keyof typeof scores] += 2;
            }
            if (pattern.test(content)) {
                scores[source as keyof typeof scores] += 1;
            }
        }
    }

    const hasClosingPattern = CLOSING_PATTERNS.some(p => p.test(content));
    if (hasClosingPattern) {
        Object.keys(scores).forEach(key => {
            scores[key as keyof typeof scores] += 0.5;
        });
    }

    const entries = Object.entries(scores) as [keyof typeof scores, number][];
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const [topSource, topScore] = sorted[0]!;
    const [, secondScore] = sorted[1]!;

    if (topScore >= 2 && topScore > secondScore) {
        return topSource;
    }

    return 'other';
}
