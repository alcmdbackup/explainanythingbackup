// Shared JSON extraction utility for parsing LLM responses that may contain
// JSON wrapped in markdown fences or surrounded by prose text.

/**
 * Extract the first JSON object from an LLM response string.
 * Handles responses where JSON is wrapped in markdown code fences or mixed with prose.
 * Returns null if no JSON object is found or parsing fails.
 */
export function extractJSON<T = unknown>(response: string): T | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
