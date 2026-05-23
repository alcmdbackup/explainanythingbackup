// Mode B helper: parse the proposer's two-section response into rationale + rewrite.
// Anchored on `## Rationale` and `## Rewrite` headings; tolerates outer code-fence
// wrapping (e.g. ```markdown ... ```) and stray <output>/<source> tags.
//
// Per the plan's error-handling contract, this function does NOT throw. When the
// `## Rewrite` heading is absent we return parseFailed=true with the entire
// response as rewrite (the caller's `computeMarkupFromRewrite` will succeed if
// the response happens to parse as markdown, or fail with a typed error
// otherwise). LLM refusals are not heuristically classified; operators read
// `cycle.rewriteText` to disambiguate.

export interface SplitResult {
  rationale: string;
  rewrite: string;
  parseFailed: boolean;
}

const RATIONALE_HEADER = /^##\s+Rationale\s*$/im;
const REWRITE_HEADER = /^##\s+Rewrite\s*$/im;
const FENCE_WRAP = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/;

export function splitRationaleAndRewrite(response: string): SplitResult {
  let body = response.trim();

  // Strip an outer ```markdown ... ``` wrapper if present.
  const fenceMatch = body.match(FENCE_WRAP);
  if (fenceMatch && fenceMatch[1]) body = fenceMatch[1].trim();

  // Strip stray <output>/</output>/<source>/</source> tags some models leak from
  // the user prompt context. Only touches the start/end of the body.
  body = body.replace(/^\s*<output>\s*/i, '').replace(/\s*<\/output>\s*$/i, '');
  body = body.replace(/^\s*<source>\s*/i, '').replace(/\s*<\/source>\s*$/i, '');

  const rationaleMatch = RATIONALE_HEADER.exec(body);
  const rewriteMatch = REWRITE_HEADER.exec(body);

  if (!rewriteMatch || rewriteMatch.index === undefined) {
    // No `## Rewrite` heading — caller decides whether `body` is salvageable.
    return { rationale: '', rewrite: body, parseFailed: true };
  }

  const rewriteHeaderEnd = rewriteMatch.index + rewriteMatch[0].length;
  let rationale = '';
  if (rationaleMatch && rationaleMatch.index !== undefined && rationaleMatch.index < rewriteMatch.index) {
    const rationaleHeaderEnd = rationaleMatch.index + rationaleMatch[0].length;
    rationale = body.slice(rationaleHeaderEnd, rewriteMatch.index).trim();
  }

  // Rewrite content is everything after the "## Rewrite" line until end-of-body.
  // Skip a leading newline if present (from the heading line break).
  let rewrite = body.slice(rewriteHeaderEnd);
  if (rewrite.startsWith('\n')) rewrite = rewrite.slice(1);
  rewrite = rewrite.replace(/\s+$/, ''); // trim trailing whitespace only

  return { rationale, rewrite, parseFailed: false };
}
