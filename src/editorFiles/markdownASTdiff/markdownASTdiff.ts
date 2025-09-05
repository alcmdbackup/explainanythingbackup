// mdast-diff-with-critic.ts
// Requires: npm i diff
// ESM:
import { diffWordsWithSpace, diffChars } from 'diff';

// ========= Type Definitions =========

interface MdastNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  title?: string | null;
  alt?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  align?: string[] | null;
  children?: MdastNode[];
  [key: string]: any;
}

interface DiffOperation {
  op: 'insert' | 'delete' | 'update';
  path: (string | number)[];
  before?: MdastNode;
  after?: MdastNode;
  meta?: {
    kind?: string;
    granularity?: 'char' | 'word';
    runs?: TextRun[];
    criticMarkup?: string;
  };
}

interface TextRun {
  t: 'eq' | 'ins' | 'del';
  s: string;
}

interface DiffOptions {
  keyer?: (node: MdastNode) => string;
  eqNode?: (a: MdastNode, b: MdastNode) => boolean;
  textGranularity?: 'char' | 'word';
  stringify?: (node: MdastNode) => string;
}

interface LcsMatch {
  i: number;
  j: number;
}

interface PropsComparison {
  changed: boolean;
  beforeProps: MdastNode;
  afterProps: MdastNode;
}

// ========= Atomic diff policy =========

// Node types that should be treated as atomic blocks (delete+insert on any change)
const ATOMIC_BLOCKS = new Set<string>([
    'heading',
    'code',
    'table',
    'thematicBreak',
    'html',
    'yaml',
    'toml',
    // MDX / footnotes (if present in your tree)
    'mdxjsEsm',
    'mdxFlowExpression',
    'mdxJsxFlowElement',
    'footnoteDefinition',
    // 👇 NEW: lists are atomic
    'list'
  ]);

// Inline nodes that are fragile; prefer atomic replacement
const ATOMIC_INLINE = new Set<string>([
  'inlineCode',
  'math',
  'inlineMath',
  'image',
  'imageReference',
  'linkReference',
  'footnoteReference'
]);

function isAtomicNode(n: MdastNode): boolean {
  return ATOMIC_BLOCKS.has(n.type) || ATOMIC_INLINE.has(n.type);
}

// Structural changes that should flip otherwise-granular nodes to atomic
function structuralChange(a: MdastNode, b: MdastNode): boolean {
  if (a.type !== b.type) return true;
  switch (a.type) {
    case 'heading':
      return a.depth !== b.depth;
    case 'list':
      return a.ordered !== b.ordered || a.start !== b.start || a.spread !== b.spread;
    case 'listItem':
      return a.checked !== b.checked || a.spread !== b.spread;
    case 'code':
      return a.lang !== b.lang || a.meta !== b.meta;
    case 'table':
      return JSON.stringify(a.align || []) !== JSON.stringify((b as any).align || []);
    case 'link':
      return a.url !== b.url || a.title !== b.title;
    case 'image':
      return a.url !== b.url || a.alt !== b.alt || a.title !== b.title;
    default:
      return false;
  }
}

// 🔧 For atomic nodes, equality must consider full serialized content, not just props.
function atomicEqual(a: MdastNode, b: MdastNode, stringify: (n: MdastNode) => string): boolean {
  if (a.type !== b.type) return false;
  return stringify(a) === stringify(b);
}

// ========= Public API =========

export function diffMdast(before: MdastNode, after: MdastNode, options: DiffOptions = {}): DiffOperation[] {
  const k = options.keyer || defaultKeyer;
  const eq = options.eqNode || defaultNodeEqual;
  const diffs: DiffOperation[] = [];
  walkNode(before, after, [], k, eq, diffs, options);
  return diffs;
}

export function renderCriticMarkup(beforeRoot: MdastNode, afterRoot: MdastNode, options: DiffOptions = {}): string {
  const stringify = options.stringify || fallbackStringify;
  return emitCriticForPair(beforeRoot, afterRoot, options, stringify);
}

// ========= Core tree diff =========

function walkNode(
  a: MdastNode | undefined, 
  b: MdastNode | undefined, 
  path: (string | number)[], 
  keyer: (node: MdastNode) => string, 
  eqNode: (a: MdastNode, b: MdastNode) => boolean, 
  out: DiffOperation[], 
  options: DiffOptions
): void {
  if (a && !b) { out.push({ op: 'delete', path, before: a }); return; }
  if (!a && b) { out.push({ op: 'insert', path, after: b }); return; }
  if (a && b && a.type !== b.type) {
    // If either side is a list, force atomic replacement
    if (a.type === 'list' || b.type === 'list') {
      out.push({ op: 'delete', path, before: a });
      out.push({ op: 'insert', path, after: b });
    } else {
      out.push({ op: 'update', path, before: a, after: b });
    }
    return;
  }

  if (!a || !b) return;
  const { changed, beforeProps, afterProps } = compareProps(a, b);

  // 🔒 Atomic policy: if node is atomic or a structural change occurred, replace whole node
  if (a.type === b.type && (isAtomicNode(a) || structuralChange(a, b))) {
    const str = options.stringify || fallbackStringify;
    // If truly identical (by full serialization), skip; otherwise force delete+insert
    if (!atomicEqual(a, b, str)) {
      out.push({ op: 'delete', path, before: a });
      out.push({ op: 'insert', path, after: b });
      return;
    }
  }

  if (a.type === 'text') {
    const beforeVal = a.value ?? '';
    const afterVal  = b.value ?? '';
    if (beforeVal !== afterVal) {
      const gran = options?.textGranularity === 'char' ? 'char' : 'word';
      const runs = diffTextGranularWithLib(beforeVal, afterVal, gran);
      const critic = toCriticMarkup(runs);
      out.push({
        op: 'update',
        path,
        before: { type: 'text', value: beforeVal },
        after:  { type: 'text', value: afterVal },
        meta: {
          kind: 'text-delta',
          granularity: gran,
          runs,
          criticMarkup: critic
        }
      });
    } else if (changed) {
      out.push({ op: 'update', path, before: beforeProps, after: afterProps });
    }
    return;
  }

  if (changed) {
    out.push({ op: 'update', path, before: beforeProps, after: afterProps });
  }

  if (!a || !b) return;
  const aKids = a.children || [];
  const bKids = b.children || [];
  if (aKids.length || bKids.length) {
    if (shouldApplyGranularTextDiff(a, b, options)) {
      const aText = extractTextFromChildren(aKids);
      const bText = extractTextFromChildren(bKids);
      if (aText !== bText) {
        const gran = options?.textGranularity === 'char' ? 'char' : 'word';
        const runs = diffTextGranularWithLib(aText, bText, gran);
        out.push({
          op: 'update',
          path: path.concat('children'),
          before: { type: 'text', value: aText },
          after: { type: 'text', value: bText },
          meta: {
            kind: 'granular-text-delta',
            granularity: gran,
            runs,
            criticMarkup: toCriticMarkup(runs)
          }
        });
        return;
      }
    }
    walkChildren(aKids, bKids, path.concat('children'), keyer, eqNode, out, options);
  }
}

function walkChildren(
  aKids: MdastNode[], 
  bKids: MdastNode[], 
  path: (string | number)[], 
  keyer: (node: MdastNode) => string, 
  eqNode: (a: MdastNode, b: MdastNode) => boolean, 
  out: DiffOperation[], 
  options: DiffOptions
): void {
  const aKeys = aKids.map(keyer);
  const bKeys = bKids.map(keyer);
  const matches = lcsIndices(aKeys, bKeys);

  const matchedA = new Set(matches.map(m => m.i));
  const matchedB = new Set(matches.map(m => m.j));

  // Deletions (in order)
  for (let i = 0, jOffset = 0; i < aKids.length; i++) {
    if (!matchedA.has(i)) {
      out.push({ op: 'delete', path: path.concat(i - jOffset), before: aKids[i] });
      jOffset++;
    }
  }

  // Insertions (in order)
  for (let j = 0; j < bKids.length; j++) {
    if (!matchedB.has(j)) {
      out.push({ op: 'insert', path: path.concat(j), after: bKids[j] });
    }
  }

  // Updates (recurse on matched pairs, using destination index j)
  matches.forEach(({ i, j }) => {
    walkNode(aKids[i], bKids[j], path.concat(j), keyer, eqNode, out, options);
  });
}

// ========= Text granular diff using `diff` lib =========

function diffTextGranularWithLib(aStr: string, bStr: string, granularity: 'char' | 'word' = 'word'): TextRun[] {
  const parts = granularity === 'char'
    ? diffChars(aStr, bStr)
    : diffWordsWithSpace(aStr, bStr);

  const runs: TextRun[] = [];
  for (const p of parts) {
    const t: 'eq' | 'ins' | 'del' = p.added ? 'ins' : p.removed ? 'del' : 'eq';
    const s = p.value || '';
    if (!s) continue;
    const last: TextRun | undefined = runs[runs.length - 1];
    if (last && last.t === t) last.s += s; else runs.push({ t, s });
  }
  return runs;
}

function toCriticMarkup(runs: TextRun[]): string {
  let out = '';
  for (const r of runs) {
    if (r.t === 'eq')  out += r.s;
    if (r.t === 'del') out += `{--${r.s}--}`;
    if (r.t === 'ins') out += `{++${r.s}++}`;
  }
  return out;
}

// ========= CriticMarkup rendering over the original =========

function emitCriticForPair(a: MdastNode | undefined, b: MdastNode | undefined, options: DiffOptions, stringify: (node: MdastNode) => string): string {
  if (a && !b) return wrapDel(stringify(a));
  if (!a && b) return wrapIns(stringify(b));
  if (a && b && a.type !== b.type) return wrapDel(stringify(a)) + wrapIns(stringify(b));

  if (!a || !b) return '';

  // 🔒 Atomic policy in overlay: atomic nodes or structural change → whole replace
  if (a.type === b.type && (isAtomicNode(a) || structuralChange(a, b))) {
    if (!atomicEqual(a, b, stringify)) {
      return wrapDel(stringify(a)) + wrapIns(stringify(b));
    }
    return stringify(a);
  }

  if (a.type === 'text') {
    const beforeVal = a.value ?? '';
    const afterVal  = b.value ?? '';
    if (beforeVal === afterVal) return beforeVal;
    const gran = options?.textGranularity === 'char' ? 'char' : 'word';
    const runs = diffTextGranularWithLib(beforeVal, afterVal, gran);
    return toCriticMarkup(runs);
  }

  if (shouldApplyGranularTextDiff(a, b, options)) {
    const aKids = a.children || [];
    const bKids = b.children || [];
    const aText = extractTextFromChildren(aKids);
    const bText = extractTextFromChildren(bKids);
    if (aText !== bText) {
      const gran = options?.textGranularity === 'char' ? 'char' : 'word';
      const runs = diffTextGranularWithLib(aText, bText, gran);
      return decorateWithContainerMarkup(a, toCriticMarkup(runs), stringify);
    }
  }

  const aKids = a.children || [];
  const bKids = b.children || [];
  if (!aKids.length && !bKids.length) {
    const { changed } = compareProps(a, b);
    return changed ? wrapDel(stringify(a)) + wrapIns(stringify(b)) : stringify(a);
  }

  // Pair children via keys and LCS (interleave del/ins to keep replacements adjacent)
  const keyer = options.keyer || defaultKeyer;
  const aKeys = aKids.map(keyer);
  const bKeys = bKids.map(keyer);
  const matches = lcsIndices(aKeys, bKeys);

  const matchedA = new Set(matches.map(m => m.i));
  const matchedB = new Set(matches.map(m => m.j));

  let out = '';
  let iCursor = 0, jCursor = 0, k = 0;
  while (iCursor < aKids.length || jCursor < bKids.length) {
    const nextMatch = k < matches.length ? matches[k] : null;
    const iMatch = nextMatch ? nextMatch.i : aKids.length;
    const jMatch = nextMatch ? nextMatch.j : bKids.length;

    while (iCursor < iMatch) {
      if (!matchedA.has(iCursor)) out += wrapDel(stringify(aKids[iCursor]));
      iCursor++;
    }
    while (jCursor < jMatch) {
      if (!matchedB.has(jCursor)) out += wrapIns(stringify(bKids[jCursor]));
      jCursor++;
    }

    if (nextMatch) {
      out += emitCriticForPair(aKids[iMatch], bKids[jMatch], options, stringify);
      iCursor = iMatch + 1;
      jCursor = jMatch + 1;
      k++;
    } else {
      while (iCursor < aKids.length || jCursor < bKids.length) {
        if (iCursor < aKids.length && !matchedA.has(iCursor)) {
          out += wrapDel(stringify(aKids[iCursor])); iCursor++;
        }
        if (jCursor < bKids.length && !matchedB.has(jCursor)) {
          out += wrapIns(stringify(bKids[jCursor])); jCursor++;
        }
      }
    }
  }

  if (a && requiresWholeNodeSerialize(a)) {
    const { changed } = compareProps(a, b);
    if (changed) return wrapDel(stringify(a)) + wrapIns(stringify(b));
  }
  return a ? decorateWithContainerMarkup(a, out, stringify) : out;
}

// Whether we should bail out to whole-node stringify (e.g., code blocks, tables)
function requiresWholeNodeSerialize(node: MdastNode): boolean {
    return node.type === 'code' || node.type === 'table' || node.type === 'list'; // 👈 add 'list'
}

// Re-wrap child text back into the container’s markdown shell when needed.
function decorateWithContainerMarkup(node: MdastNode, inner: string, stringify: (node: MdastNode) => string): string {
  switch (node.type) {
    case 'heading': {
      const hashes = '#'.repeat(node.depth || 1);
      return `${hashes} ${inner}\n\n`;
    }
    case 'paragraph':
      return `${inner}\n\n`;
    case 'listItem': {
      const bullet = '- ';
      return `${bullet}${inner.replace(/\n+$/,'')}\n`;
    }
    case 'blockquote':
      return inner.split('\n').map(l => (l ? `> ${l}` : l)).join('\n') + '\n\n';
    default:
      return stringify({ ...node, children: undefined }) || inner;
  }
}

// Helpers for Critic braces
function wrapDel(s: string): string { return s ? `{--${s}--}` : ''; }
function wrapIns(s: string): string { return s ? `{++${s}++}` : ''; }

// ========= Granular text diffing helpers =========

function shouldApplyGranularTextDiff(a: MdastNode, b: MdastNode, _options: DiffOptions): boolean {
  if (a.type !== b.type) return false;
  // Exclude atomic blocks/inline from granular path
  if (ATOMIC_BLOCKS.has(a.type) || ATOMIC_INLINE.has(a.type)) return false;

  const containerTypes = [
    'paragraph',
    // 'listItem', ← remove this
    'blockquote', // optional: you may also remove blockquote for the same reason
    'strong',
    'emphasis',
    'inlineCode',
    'delete'
  ];
  if (!containerTypes.includes(a.type)) return false;
  return hasTextContent(a) && hasTextContent(b);
}

function hasTextContent(node: MdastNode): boolean {
  if (node.type === 'text' && node.value && node.value.trim()) return true;
  if (node.children) return node.children.some(child => hasTextContent(child));
  return false;
}

/**
 * (Relaxed) Extract inline markdown for children by stringifying each child.
 * This preserves inline markers like **, *, ~~ and backticks.
 */
function extractTextFromChildren(children: MdastNode[]): string {
  let out = '';
  for (const child of children) {
    if (child.type === 'text') out += child.value || '';
    else out += fallbackStringify(child);
  }
  return out;
}

// ========= Helpers =========

function compareProps(a: MdastNode, b: MdastNode): PropsComparison {
  const propsByType = {
    text: ['value'],
    heading: ['depth'],
    link: ['url', 'title'],
    image: ['url', 'alt', 'title'],
    list: ['ordered', 'start', 'spread'],
    listItem: ['checked', 'spread'],
    code: ['lang', 'meta', 'value'],
    inlineCode: ['value'],
    paragraph: [],
    strong: [],
    emphasis: [],
    delete: [],
    thematicBreak: [],
    blockquote: [],
    table: ['align'],
    tableRow: [],
    tableCell: [],
  };
  const fields = propsByType[a.type as keyof typeof propsByType] || [];
  const beforeProps: MdastNode = { type: a.type };
  const afterProps: MdastNode = { type: b.type };
  let changed = false;
  for (const f of fields) {
    const av = (a as any)[f], bv = (b as any)[f];
    (beforeProps as any)[f] = av; (afterProps as any)[f] = bv;
    if (!isEqualScalar(av, bv)) changed = true;
  }
  return { changed, beforeProps, afterProps };
}

function defaultNodeEqual(a: MdastNode, b: MdastNode): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  const { changed } = compareProps(a, b);
  return !changed && !!(a.children?.length) === !!(b.children?.length);
}

function isEqualScalar(a: any, b: any): boolean { return a === b || (a == null && b == null); }

// Build a content-agnostic identity for pairing in LCS
function defaultKeyer(node: MdastNode): string {
  const type = node?.type || '';
  const parts = [type];
  switch (type) {
    case 'heading':
      parts.push(String((node as any).depth ?? ''));
      if ((node as any)?.data?.id) parts.push(String((node as any).data.id));
      break;
    case 'list':
      parts.push(String(!!(node as any).ordered), String((node as any).start ?? ''));
      break;
    case 'listItem':
      parts.push(String(!!(node as any).checked));
      break;
    case 'code':
      parts.push(String((node as any).lang ?? ''));
      break;
    case 'link':
      parts.push(String((node as any).url ?? ''));
      break;
    case 'image':
      parts.push(String((node as any).url ?? ''), String((node as any).alt ?? ''));
      break;
    default:
      break;
  }
  if (type === 'text') parts.push('~');
  return parts.join('|');
}

function lcsIndices(a: string[], b: string[]): LcsMatch[] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: LcsMatch[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push({ i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { j++; }
  }
  return pairs;
}

function fallbackStringify(node: MdastNode): string {
  if (!node) return '';
  switch (node.type) {
    case 'root':
      return (node.children || []).map(fallbackStringify).join('');
    case 'paragraph':
      return (node.children || []).map(fallbackStringify).join('') + '\n\n';
    case 'text':
      return node.value || '';
    case 'heading':
      return '#'.repeat(node.depth || 1) + ' ' +
             (node.children || []).map(fallbackStringify).join('') + '\n\n';
    case 'list': {
      const bullet = node.ordered ? '1.' : '-';
      return (node.children || [])
        .map((li: MdastNode) => `${bullet} ${fallbackStringify(li).replace(/\n+$/,'')}\n`)
        .join('') + '\n';
    }
    case 'listItem':
      return (node.children || []).map(fallbackStringify).join('').replace(/\n+$/,'');
    case 'blockquote':
      return (node.children || []).map(fallbackStringify).join('')
        .split('\n').map((l: string) => (l ? `> ${l}` : l)).join('\n') + '\n\n';
    case 'code':
      return '```' + (node.lang || '') + '\n' + (node.value || '') + '\n```\n\n';
    case 'inlineCode':
      return '`' + (node.value || '') + '`';
    case 'strong':
      return `**${(node.children || []).map(fallbackStringify).join('')}**`;
    case 'emphasis':
      return `*${(node.children || []).map(fallbackStringify).join('')}*`;
    case 'delete':
      return `~~${(node.children || []).map(fallbackStringify).join('')}~~`;
    case 'link':
      return `[${(node.children || []).map(fallbackStringify).join('')}](${node.url || ''}${node.title ? ` "${node.title}"` : ''})`;
    case 'image':
      return `![${node.alt || ''}](${node.url || ''}${node.title ? ` "${node.title}"` : ''})`;
    case 'thematicBreak':
      return `\n---\n\n`;
    default:
      return (node.children || []).map(fallbackStringify).join('');
  }
}
