// Shared JSON extraction utility for parsing LLM responses that may contain
// JSON wrapped in markdown fences or surrounded by prose text.

/**
 * Extract the first balanced JSON object from an LLM response string.
 * Uses a depth-counting parser that respects string literals (including escaped quotes)
 * to find the first complete `{...}` block instead of greedy regex matching.
 * Returns null if no JSON object is found or parsing fails.
 */
export function extractJSON<T = unknown>(response: string): T | null {
  const start = response.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < response.length; i++) {
    const ch = response[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = response.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {
          // First balanced block wasn't valid JSON — continue scanning for next `{`
          return extractJSON(response.slice(i + 1));
        }
      }
    }
  }

  return null;
}
