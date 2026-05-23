// Mode B helper: take a source text + a proposer-emitted rewrite, normalize
// both via remark-stringify, run the diff engine, and return the resulting
// CriticMarkup string + the canonicalized source.
//
// The agent uses `normalizedBefore` (NOT the original `current.text`) as the
// anchor for downstream `parseProposedEdits` and `applyAcceptedGroups` so the
// strict-equals contextBefore/contextAfter checks line up.
//
// Error contract:
// - `RewriteParseError`: thrown when remark-parse fails on either text. Wraps
//   the original parser exception in `originalError` for forensic inspection.
// - `DiffEngineError`: thrown when `RenderCriticMarkupFromMDAstDiff` itself
//   throws (rare; defensive).
// - 100 KB hard cap on rewrite size: throws `RewriteTooLargeError`. Prevents
//   pathological / ReDoS inputs.

// Dynamic-import the ESM-only unified/remark stack and the diff engine to keep
// module-load time CJS-friendly (Jest's default jsdom env can't parse pure-ESM
// packages without explicit transformIgnorePatterns; this avoids that).
/* eslint-disable @typescript-eslint/no-explicit-any */
// Loose typing here on purpose — unified's generic processor type is awkward to
// thread through the cache shape. The deps are only consumed by computeMarkupFromRewrite,
// which we test end-to-end.
type RenderFn = (typeof import('../../../../../../src/editorFiles/markdownASTdiff/markdownASTdiff'))['RenderCriticMarkupFromMDAstDiff'];

let _cached:
  | { unified: any; remarkParse: any; remarkStringify: any; render: RenderFn; stringifier: any }
  | undefined;

type Deps = NonNullable<typeof _cached>;
async function loadDeps(): Promise<Deps> {
  if (_cached) return _cached;
  const [u, rp, rs, ast] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-stringify'),
    import('../../../../../../src/editorFiles/markdownASTdiff/markdownASTdiff'),
  ]);
  const stringifier = u.unified().use(rp.default).use(rs.default, {
    bullet: '-',
    emphasis: '*',
    strong: '*',
    fences: true,
    rule: '-',
  });
  const deps: Deps = {
    unified: u.unified,
    remarkParse: rp.default,
    remarkStringify: rs.default,
    render: ast.RenderCriticMarkupFromMDAstDiff,
    stringifier,
  };
  _cached = deps;
  return deps;
}

const REWRITE_HARD_CAP_BYTES = 100 * 1024; // 100 KB

export class RewriteParseError extends Error {
  constructor(message: string, public readonly originalError: unknown, public readonly side: 'before' | 'after') {
    super(message);
    this.name = 'RewriteParseError';
  }
}

export class DiffEngineError extends Error {
  constructor(message: string, public readonly originalError: unknown) {
    super(message);
    this.name = 'DiffEngineError';
  }
}

export class RewriteTooLargeError extends Error {
  constructor(public readonly observedBytes: number) {
    super(`Rewrite exceeds 100 KB hard cap (observed ${observedBytes} bytes)`);
    this.name = 'RewriteTooLargeError';
  }
}

/** Defensive serializer for forensic error context. Bounded message length;
 *  cyclic-safe; getter-throw-safe. Output is JSONB-friendly. */
export function serializeError(e: unknown): { type: string; message: string; line?: number; col?: number } {
  try {
    if (!e || typeof e !== 'object') return { type: 'Unknown', message: String(e).slice(0, 500) };
    const err = e as { name?: string; message?: string; line?: number; column?: number; position?: { start?: { line?: number; column?: number } } };
    let type = 'Error';
    try { type = String(err.name ?? 'Error').slice(0, 100); } catch { /* getter threw */ }
    let message = '';
    try { message = String(err.message ?? '').slice(0, 500); } catch { /* getter threw */ }
    let line: number | undefined;
    try { const l = err.line ?? err.position?.start?.line; if (typeof l === 'number' && Number.isFinite(l)) line = l; } catch { /* ignore */ }
    let col: number | undefined;
    try { const c = err.column ?? err.position?.start?.column; if (typeof c === 'number' && Number.isFinite(c)) col = c; } catch { /* ignore */ }
    return {
      type,
      message,
      ...(line !== undefined ? { line } : {}),
      ...(col !== undefined ? { col } : {}),
    };
  } catch {
    return { type: 'Error', message: 'Serialization failed' };
  }
}

/** Round-trip through remark-parse → remark-stringify to get a canonical form. */
export async function normalize(md: string): Promise<string> {
  const { stringifier } = await loadDeps();
  return String(stringifier.processSync(md));
}

export interface ComputeMarkupResult {
  /** The CriticMarkup string emitted by the diff engine. */
  markup: string;
  /** The source canonicalized via remark-stringify. The agent uses this as
   *  the anchor for downstream parseProposedEdits + applyAcceptedGroups. */
  normalizedBefore: string;
}

/**
 * Compute CriticMarkup describing the edits the proposer made. Uses
 * `paragraphAtomicDiffIfDiffAbove=0.25, sentenceAtomicDiffIfDiffAbove=0.10,
 * sentencesPairedIfDiffBelow=0.40` (Decision #18) and `linkGranular: true` so
 * paragraphs containing only link-level changes don't escalate to atomic.
 */
export async function computeMarkupFromRewrite(beforeText: string, afterText: string): Promise<ComputeMarkupResult> {
  if (afterText.length > REWRITE_HARD_CAP_BYTES) {
    throw new RewriteTooLargeError(afterText.length);
  }

  const deps = await loadDeps();
  const normalizedBefore = String(deps.stringifier.processSync(beforeText));
  let normalizedAfter: string;
  try {
    normalizedAfter = String(deps.stringifier.processSync(afterText));
  } catch (e) {
    throw new RewriteParseError('Failed to parse rewrite as markdown', e, 'after');
  }

  let beforeAst, afterAst;
  try {
    beforeAst = deps.unified().use(deps.remarkParse).parse(normalizedBefore);
  } catch (e) {
    throw new RewriteParseError('Failed to parse normalized source as markdown', e, 'before');
  }
  try {
    afterAst = deps.unified().use(deps.remarkParse).parse(normalizedAfter);
  } catch (e) {
    throw new RewriteParseError('Failed to parse normalized rewrite as markdown', e, 'after');
  }

  let markup: string;
  try {
    markup = deps.render(
      beforeAst as Parameters<RenderFn>[0],
      afterAst as Parameters<RenderFn>[1],
      {
        multipass: {
          paragraphAtomicDiffIfDiffAbove: 0.25,
          sentenceAtomicDiffIfDiffAbove: 0.10,
          sentencesPairedIfDiffBelow: 0.40,
          linkGranular: true,
          debug: false,
        },
      },
    );
  } catch (e) {
    throw new DiffEngineError('RenderCriticMarkupFromMDAstDiff threw', e);
  }

  return { markup, normalizedBefore };
}
