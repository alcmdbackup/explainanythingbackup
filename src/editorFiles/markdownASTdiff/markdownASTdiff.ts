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

// ========= Public API =========

/**
 * Performs a minimal MDAST-aware diff between two markdown AST trees.
 * 
 * • Compares AST nodes recursively using configurable keyer and equality functions
 * • Produces granular text diffs for text nodes using word or character-level changes
 * • Returns array of diff operations with insert/delete/update operations and paths
 * • Used by diff rendering systems to track changes between markdown versions
 * • Calls walkNode for recursive tree traversal and walkChildren for child comparison
 */
export function diffMdast(before: MdastNode, after: MdastNode, options: DiffOptions = {}): DiffOperation[] {
  const k = options.keyer || defaultKeyer;
  const eq = options.eqNode || defaultNodeEqual;
  const diffs: DiffOperation[] = [];
  walkNode(before, after, [], k, eq, diffs, options);
  return diffs;
}

/**
 * Builds a CriticMarkup string overlayed on the original markdown.
 * 
 * • Uses granular text diffs for text updates with word or character-level precision
 * • Wraps whole-node inserts/deletes in CriticMarkup syntax {++ ++} and {-- --}
 * • Recursively processes AST nodes to generate human-readable diff markup
 * • Used by diff visualization systems to show changes in markdown format
 * • Calls emitCriticForPair for recursive node comparison and markup generation
 */
export function renderCriticMarkup(beforeRoot: MdastNode, afterRoot: MdastNode, options: DiffOptions = {}): string {
  const stringify = options.stringify || fallbackStringify;
  return emitCriticForPair(beforeRoot, afterRoot, options, stringify);
}

// ========= Core tree diff =========

/**
 * Recursively walks and compares two MDAST nodes to generate diff operations.
 * 
 * • Handles node deletions, insertions, and type changes at the current level
 * • Compares scalar properties between nodes of the same type
 * • Generates granular text diffs for text nodes using word or character-level changes
 * • Recursively processes child nodes to build complete diff operation tree
 * • Called by diffMdast to initiate the diff process and by walkChildren for child comparison
 */
function walkNode(
  a: MdastNode | undefined, 
  b: MdastNode | undefined, 
  path: (string | number)[], 
  keyer: (node: MdastNode) => string, 
  eqNode: (a: MdastNode, b: MdastNode) => boolean, 
  out: DiffOperation[], 
  options: DiffOptions
): void {
  // Node deleted
  if (a && !b) {
    out.push({ op: 'delete', path, before: a });
    return;
  }
  // Node inserted
  if (!a && b) {
    out.push({ op: 'insert', path, after: b });
    return;
  }
  // Type changed → replace
  if (a && b && a.type !== b.type) {
    out.push({ op: 'update', path, before: a, after: b });
    return;
  }

  // Same type: compare salient scalar props (excluding children)
  if (!a || !b) return;
  const { changed, beforeProps, afterProps } = compareProps(a, b);

  // Special case: text node granular delta via `diff` lib
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
          runs,            // [{ t:'eq'|'ins'|'del', s:'...' }]
          criticMarkup: critic
        }
      });
    } else if (changed) {
      out.push({ op: 'update', path, before: beforeProps, after: afterProps });
    }
    return; // text nodes have no children
  }

  // Non-text nodes: emit prop updates if any
  if (changed) {
    out.push({ op: 'update', path, before: beforeProps, after: afterProps });
  }

  // Recurse into children
  if (!a || !b) return;
  const aKids = a.children || [];
  const bKids = b.children || [];
  if (aKids.length || bKids.length) {
    // Container-level granular diff on concatenated inline markdown,
    // even if children include inline nodes (strong/emphasis/link/etc.)
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
        return; // Skip normal child processing (we already emitted the granular delta)
      }
    }
    
    walkChildren(aKids, bKids, path.concat('children'), keyer, eqNode, out, options);
  }
}

/**
 * Pairs and compares child nodes using Longest Common Subsequence (LCS) algorithm.
 * 
 * • Uses configurable keyer function to generate stable keys for child node pairing
 * • Applies LCS algorithm to find optimal matching between before and after child arrays
 * • Generates delete operations for unmatched nodes in the before array
 * • Generates insert operations for unmatched nodes in the after array
 * • Recursively calls walkNode for matched child pairs to process nested changes
 * • Called by walkNode when processing nodes with children
 */
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

/**
 * Performs granular text diffing using the 'diff' library with word or character precision.
 * 
 * • Uses jsdiff library to generate character or word-level differences between text strings
 * • Merges adjacent runs of the same operation type for cleaner output
 * • Returns array of text runs with operation type (equal, insert, delete) and content
 * • Used by walkNode for text node comparison and by emitCriticForPair for markup generation
 * • Calls diffChars or diffWordsWithSpace from the 'diff' library based on granularity setting
 */
function diffTextGranularWithLib(aStr: string, bStr: string, granularity: 'char' | 'word' = 'word'): TextRun[] {
  const parts = granularity === 'char'
    ? diffChars(aStr, bStr)
    : diffWordsWithSpace(aStr, bStr);

  // Merge adjacent same-type runs (jsdiff usually already coalesces, but be safe)
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

/**
 * Converts text diff runs into CriticMarkup syntax for human-readable diff display.
 * 
 * • Transforms text runs into CriticMarkup format with {--deleted--} and {++inserted++} syntax
 * • Preserves unchanged text as-is for clean diff visualization
 * • Used by walkNode and emitCriticForPair to generate markup for text changes
 * • Called by diffTextGranularWithLib consumers to format diff results
 */
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

/**
 * Recursively generates CriticMarkup by comparing node pairs for diff visualization.
 * 
 * • Handles deleted, inserted, and type-changed nodes with appropriate markup wrapping
 * • Generates inline text deltas for text nodes using granular diffing
 * • Recursively processes child nodes and stitches together the final markup
 * • Uses LCS algorithm for optimal child node pairing and ordering
 * • Called by renderCriticMarkup to generate the complete diff markup string
 */
function emitCriticForPair(a: MdastNode | undefined, b: MdastNode | undefined, options: DiffOptions, stringify: (node: MdastNode) => string): string {
  // Deleted subtree
  if (a && !b) return wrapDel(stringify(a));
  // Inserted subtree
  if (!a && b) return wrapIns(stringify(b));
  // Type replaced
  if (a && b && a.type !== b.type) return wrapDel(stringify(a)) + wrapIns(stringify(b));

  // Same type
  if (!a || !b) return '';
  if (a.type === 'text') {
    const beforeVal = a.value ?? '';
    const afterVal  = b.value ?? '';
    if (beforeVal === afterVal) return beforeVal;
    const gran = options?.textGranularity === 'char' ? 'char' : 'word';
    const runs = diffTextGranularWithLib(beforeVal, afterVal, gran);
    return toCriticMarkup(runs);
  }

  // Check if this is a container node that should have granular text diffing applied
  if (shouldApplyGranularTextDiff(a, b, options)) {
    const aKids = a.children || [];
    const bKids = b.children || [];
    const aText = extractTextFromChildren(aKids);
    const bText = extractTextFromChildren(bKids);
    
    if (aText !== bText) {
      const gran = options?.textGranularity === 'char' ? 'char' : 'word';
      const runs = diffTextGranularWithLib(aText, bText, gran);
      return toCriticMarkup(runs);
    }
  }

  // Nodes with/without children
  if (!a || !b) return '';
  const aKids = a.children || [];
  const bKids = b.children || [];
  if (!aKids.length && !bKids.length) {
    const { changed } = compareProps(a, b);
    return changed ? wrapDel(stringify(a)) + wrapIns(stringify(b)) : stringify(a);
  }

  // Pair children via keys and LCS, then recursively emit
  const keyer = options.keyer || defaultKeyer;
  const aKeys = aKids.map(keyer);
  const bKeys = bKids.map(keyer);
  const matches = lcsIndices(aKeys, bKeys);

  const matchedA = new Set(matches.map(m => m.i));
  const matchedB = new Set(matches.map(m => m.j));

  let out = '';

  // Deletions (unmatched aKids)
  for (let i = 0; i < aKids.length; i++) {
    if (!matchedA.has(i)) out += wrapDel(stringify(aKids[i]));
  }

  // Merged matched pairs and insertions in destination order
  let jCursor = 0;
  for (const { i, j } of matches) {
    while (jCursor < j) {
      if (!matchedB.has(jCursor)) out += wrapIns(stringify(bKids[jCursor]));
      jCursor++;
    }
    out += emitCriticForPair(aKids[i], bKids[j], options, stringify);
    jCursor++;
  }
  while (jCursor < bKids.length) {
    if (!matchedB.has(jCursor)) out += wrapIns(stringify(bKids[jCursor]));
    jCursor++;
  }

  if (a && requiresWholeNodeSerialize(a)) {
    const { changed } = compareProps(a, b);
    if (changed) return wrapDel(stringify(a)) + wrapIns(stringify(b));
  }
  return a ? decorateWithContainerMarkup(a, out, stringify) : out;
}

// Whether we should bail out to whole-node stringify (e.g., code blocks, tables)
function requiresWholeNodeSerialize(node: MdastNode): boolean {
  return node.type === 'code' || node.type === 'table';
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
      // naive unordered; extend for ordered/start as needed
      const bullet = '- ';
      return `${bullet}${inner.replace(/\n+$/,'')}\n`;
    }
    case 'blockquote':
      return inner.split('\n').map(l => (l ? `> ${l}` : l)).join('\n') + '\n\n';
    default:
      // Safe fallback: stringify full node (may ignore `inner`)
      return stringify({ ...node, children: undefined }) || inner;
  }
}

// Helpers for Critic braces
function wrapDel(s: string): string { return s ? `{--${s}--}` : ''; }
function wrapIns(s: string): string { return s ? `{++${s}++}` : ''; }

// ========= Granular text diffing helpers =========

/**
 * Determines if granular text diffing should be applied to children of container nodes.
 * 
 * • Checks if the node is a container type that typically contains text nodes
 * • Ensures both nodes have the same type and structure for meaningful comparison
 * • Used by walkNode to decide whether to apply granular text diffing to nested content
 * • Called before applyGranularTextDiffToChildren to determine diffing strategy
 */
function shouldApplyGranularTextDiff(a: MdastNode, b: MdastNode, _options: DiffOptions): boolean {
  const containerTypes = [
    'paragraph',
    'heading',
    'listItem',
    'blockquote',
    'strong',
    'emphasis',
    'inlineCode',
    'delete'
  ];
  if (a.type !== b.type) return false;
  if (!containerTypes.includes(a.type)) return false;

  // Must contain *some* text on both sides to be useful
  return hasTextContent(a) && hasTextContent(b);
}

/**
 * Checks if a node contains text content that could benefit from granular diffing.
 * 
 * • Recursively searches for text nodes within the given node
 * • Returns true if any text nodes are found with non-empty content
 * • Used by shouldApplyGranularTextDiff to determine if granular diffing is worthwhile
 * • Called recursively to traverse nested node structures
 */
function hasTextContent(node: MdastNode): boolean {
  if (node.type === 'text' && node.value && node.value.trim()) {
    return true;
  }
  if (node.children) {
    return node.children.some(child => hasTextContent(child));
  }
  return false;
}

/**
 * (Relaxed) Extract inline markdown for children by stringifying each child.
 * This preserves inline markers like **, *, ~~ and backticks.
 */
function extractTextFromChildren(children: MdastNode[]): string {
  let out = '';
  for (const child of children) {
    if (child.type === 'text') {
      out += child.value || '';
    } else {
      out += fallbackStringify(child);
    }
  }
  return out;
}

// ========= Helpers =========

// A conservative set of mdast props worth diffing for common nodes.
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

  // Only structural props, never text content.
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
      // paragraphs, blockquote, strong, emphasis, etc. → type only
      break;
  }

  // Text nodes: give a neutral marker so siblings don't all collapse
  if (type === 'text') parts.push('~');
  return parts.join('|');
}

/**
 * Implements Longest Common Subsequence algorithm to find optimal node pairings.
 * 
 * • Uses dynamic programming to find the longest common subsequence between two arrays
 * • Returns array of matched index pairs representing optimal alignment
 * • Used by walkChildren and emitCriticForPair for intelligent child node pairing
 * • Called with string keys generated by the keyer function for stable matching
 */
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

/**
 * Provides minimal markdown stringify fallback for MDAST nodes.
 * 
 * • Converts MDAST nodes back to markdown text using basic string concatenation
 * • Handles common node types like headings, paragraphs, lists, code blocks, and links
 * • Used as default stringify function when no custom stringify is provided
 * • Called by renderCriticMarkup and emitCriticForPair for node-to-text conversion
 * • For higher fidelity, pass custom stringify using unified/remark-stringify
 */
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
