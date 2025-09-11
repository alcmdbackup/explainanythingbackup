// mdast-diff-with-critic.ts
// Requires: npm i diff
// ESM:
import { diffWordsWithSpace, diffChars } from 'diff';

// DEBUG USAGE:
// To enable debug logging for similarity calculations, pass debug: true in multipass options:
// 
// const options = {
//   multipass: {
//     debug: true,
//     paragraphAtomicDiffIfDiffAbove: 0.40,
//     sentenceAtomicDiffIfDiffAbove: 0.50
//   }
// };
// 
// const diffs = renderCriticMarkup(beforeNode, afterNode, options);
// 
// This will log detailed similarity calculations showing:
// - Paragraph-level similarity ratios and decisions
// - Sentence tokenization and alignment
// - Word-level diff operations
// - Threshold comparisons and atomic vs granular decisions

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
    // NEW: grouping & wrapper metadata for atomic format changes
    group?: string;
    wrapperFrom?: string;
    wrapperTo?: string;
  };
}

interface TextRun {
  t: 'eq' | 'ins' | 'del' | 'update';
  s: string;
  // For update operations, s represents the before text, sAfter represents the after text
  sAfter?: string;
}

// ADD: configurable thresholds for the multipass
interface MultiPassOptions {
  /**
   * If the *paragraph-level* before/after is > this diff ratio (0..1),
   * replace the entire paragraph atomically (delete+insert).
   * Default: 0.20 (i.e., >20% different → atomic paragraph).
   */
  paragraphAtomicDiffIfDiffAbove?: number;

  /**
   * If a matched *sentence pair* before/after is > this diff ratio (0..1),
   * replace that entire sentence atomically (as {--...--}{++...++} in the runs).
   * Default: 0.35.
   */
  sentenceAtomicDiffIfDiffAbove?: number;

  /** Locale hint for sentence segmentation (used if Intl.Segmenter is available). */
  sentenceLocale?: string;

  /** Enable debug logging for similarity calculations */
  debug?: boolean;
}

interface DiffOptions {
  keyer?: (node: MdastNode) => string;
  eqNode?: (a: MdastNode, b: MdastNode) => boolean;
  textGranularity?: 'char' | 'word';
  stringify?: (node: MdastNode) => string;

  // NEW: multipass thresholds/options
  multipass?: MultiPassOptions;
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
  // 👇 lists are atomic
  'list',
  // 👇 NEW: treat table parts as atomic too (we never want to recurse)
  'tableRow',
  'tableCell',
]);

// Inline nodes that are fragile; prefer atomic replacement
const ATOMIC_INLINE = new Set<string>([
  'inlineCode',
  'math',
  'inlineMath',
  'image',
  'imageReference',
  'linkReference',
  'footnoteReference',
  // 👇 make links atomic
  'link'
]);

function isAtomicNode(n: MdastNode): boolean {
  return ATOMIC_BLOCKS.has(n.type) || ATOMIC_INLINE.has(n.type);
}

// 👇 New: detect if a node contains any atomic descendant (e.g., link inside paragraph)
function containsAtomicDescendant(node: MdastNode): boolean {
  const stack: MdastNode[] = (node.children || []).slice();
  while (stack.length) {
    const n = stack.pop()!;
    if (isAtomicNode(n)) return true;
    if (n.children && n.children.length) stack.push(...n.children);
  }
  return false;
}

// NEW: detect if a node contains any wrapper descendant (emphasis/strong/inlineCode/link)
function containsWrapperDescendant(node: MdastNode): boolean {
  const stack: MdastNode[] = (node.children || []).slice();
  while (stack.length) {
    const n = stack.pop()!;
    if (WRAPPER_TYPES.has(n.type)) return true;
    if (n.children && n.children.length) stack.push(...n.children);
  }
  return false;
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
    case 'table': {
      // More robust: treat shape changes as structural (alignments, row/col counts)
      const aAlign = a.align || [];
      const bAlign = (b as any).align || [];
      if (JSON.stringify(aAlign) !== JSON.stringify(bAlign)) return true;

      const aRows = a.children || [];
      const bRows = (b as any).children || [];
      if (aRows.length !== bRows.length) return true;

      const aCols = aRows[0]?.children?.length ?? 0;
      const bCols = bRows[0]?.children?.length ?? 0;
      return aCols !== bCols;
    }
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

// ========= Wrapper-change detection (NEW) =========

// Inline wrappers we treat as format wrappers
const WRAPPER_TYPES = new Set<string>(['emphasis', 'strong', 'inlineCode', 'link']);

function isWrapperType(t: string): boolean {
  return WRAPPER_TYPES.has(t);
}

// plain text of a node, ignoring wrapper marks
function plainText(n?: MdastNode): string {
  if (!n) return '';
  switch (n.type) {
    case 'text':
      return n.value || '';
    case 'inlineCode':
      return n.value || '';
    default:
      return (n.children || []).map(plainText).join('');
  }
}

// NEW: detect pipe-table paragraphs (when remark-gfm isn't enabled)
function isPipeTableParagraph(n: MdastNode | undefined): boolean {
  if (!n || n.type !== 'paragraph') return false;
  const txt = plainText(n).trim();
  // Look for a header line: | a | b | and a separator line: | --- | --- |
  return /^\|.+\|\s*$/.test(txt) && /\n\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|/m.test(txt);
}

let __GROUP_COUNTER = 0;
function newGroupId(): string {
  __GROUP_COUNTER += 1;
  return 'g_' + __GROUP_COUNTER.toString(36);
}

// ========== Multi-pass helpers (paragraph → sentence → word) ==========

const MP_DEFAULTS: Required<MultiPassOptions> = {
  paragraphAtomicDiffIfDiffAbove: 0.10,
  sentenceAtomicDiffIfDiffAbove:  0.10,
  sentenceLocale:          'en',
  debug:                   true
};

// Align sentences by similarity instead of exact matching
function alignSentencesBySimilarity(
  sentencesA: string[], 
  sentencesB: string[], 
  threshold: number,
  debug = false
): LcsMatch[] {
  if (debug) {
    console.log(`    🔗 SIMILARITY-BASED SENTENCE ALIGNMENT:`);
  }
  
  const pairs: LcsMatch[] = [];
  const usedB = new Set<number>();
  
  // For each sentence in A, find the best match in B
  for (let i = 0; i < sentencesA.length; i++) {
    const sentenceA = sentencesA[i];
    let bestMatch = -1;
    let bestSimilarity = 0;
    
    for (let j = 0; j < sentencesB.length; j++) {
      if (usedB.has(j)) continue; // Skip already matched sentences
      
      const sentenceB = sentencesB[j];
      const similarity = 1 - diffRatioWords(sentenceA, sentenceB, false); // Get similarity (not diff ratio)
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = j;
      }
    }
    
    // If we found a good match (similarity > threshold), pair them
    if (bestMatch !== -1 && bestSimilarity > (1 - threshold)) {
      pairs.push({ i, j: bestMatch });
      usedB.add(bestMatch);
      
      if (debug) {
        console.log(`      ✅ PAIRED: A[${i}] ↔ B[${bestMatch}] (similarity: ${(bestSimilarity * 100).toFixed(1)}%)`);
        console.log(`        A: "${sentenceA}"`);
        console.log(`        B: "${sentencesB[bestMatch]}"`);
      }
    } else if (debug) {
      console.log(`      ❌ NO MATCH: A[${i}] (best similarity: ${(bestSimilarity * 100).toFixed(1)}%, threshold: ${((1 - threshold) * 100).toFixed(1)}%)`);
    }
  }
  
  if (debug) {
    console.log(`    📊 ALIGNMENT RESULT: ${pairs.length} sentence pairs found`);
  }
  
  return pairs;
}

// Sentence tokenize, preserving trailing whitespace for lossless re-join.
function sentenceTokens(text: string, locale = MP_DEFAULTS.sentenceLocale): string[] {
  if (!text) return [];
  const S: any = (globalThis as any).Intl?.Segmenter;
  if (S) {
    try {
      const seg = new S(locale, { granularity: 'sentence' });
      const segments = (seg as any).segment(text);
      const toks: string[] = [];
      let lastIndex = 0;
      for (const part of segments as any) {
        if (typeof part.segment === 'string') {
          toks.push(part.segment);
          lastIndex += part.segment.length;
        } else {
          const nextIndex = (part.index as number) ?? lastIndex;
          if (nextIndex > lastIndex) toks.push(text.slice(lastIndex, nextIndex));
          lastIndex = nextIndex;
        }
      }
      if (lastIndex < text.length) toks.push(text.slice(lastIndex));
      if (toks.length) return toks;
    } catch { /* fall back */ }
  }
  // Regex fallback: capture to ., !, ? followed by spaces/closing, or multiple newlines, or end.
  const out: string[] = [];
  const rx = /[\s\S]*?(?:[.!?](?=[\s'")\]]|\s*$)|\n{2,}|$)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const token = m[0];
    if (!token) break;
    out.push(token);
    if (rx.lastIndex >= text.length) break;
  }
  return mergeAbbrevSuffix(out);
}

function mergeAbbrevSuffix(tokens: string[]): string[] {
  const ABBREV = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|vs|etc|No|Fig|Eq|Ref|cf|al|e\.g|i\.e)\.\s*$/i;
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i + 1 < tokens.length && ABBREV.test(t)) {
      merged.push(t + tokens[i + 1]);
      i++;
    } else {
      merged.push(t);
    }
  }
  return merged;
}

// Compute a normalized "diff ratio" (0..1) using LCS similarity.
function diffRatioWords(aStr: string, bStr: string, debug = false): number {
  if (aStr === bStr) return 0;
  
  // Split into words for LCS comparison
  const aWords = aStr.split(/\s+/);
  const bWords = bStr.split(/\s+/);
  
  // Use existing LCS function to find matches
  const matches = lcsIndices(aWords, bWords);
  const lcsLength = matches.length;
  
  // Calculate similarity ratio: 1 - (LCS length / max length)
  const maxLength = Math.max(aWords.length, bWords.length);
  if (maxLength === 0) return 0;
  
  const similarity = lcsLength / maxLength;
  const diffRatio = 1 - similarity; // Convert to diff ratio (0 = identical, 1 = completely different)
  
  // DEBUG: Log similarity calculations
  if (debug) {
    console.log('🔍 DIFF RATIO CALCULATION:');
    console.log(`  Text A: "${aStr}"`);
    console.log(`  Text B: "${bStr}"`);
    console.log(`  Words A: [${aWords.join(', ')}] (${aWords.length} words)`);
    console.log(`  Words B: [${bWords.join(', ')}] (${bWords.length} words)`);
    console.log(`  LCS matches: ${lcsLength} words`);
    console.log(`  Max length: ${maxLength} words`);
    console.log(`  Similarity: ${similarity.toFixed(3)} (${(similarity * 100).toFixed(1)}%)`);
    console.log(`  Diff ratio: ${diffRatio.toFixed(3)} (${(diffRatio * 100).toFixed(1)}%)`);
    console.log('---');
  }
  
  return diffRatio;
}

// Convert a diffParts (from 'diff' lib) into TextRun[]
function wordRuns(aStr: string, bStr: string, debug = false): TextRun[] {
  if (debug) {
    console.log(`    🔤 WORD-LEVEL DIFF:`);
    console.log(`      A: "${aStr}"`);
    console.log(`      B: "${bStr}"`);
  }
  
  const parts = diffWordsWithSpace(aStr, bStr);
  if (debug) {
    console.log(`      Raw diff parts: ${parts.length} parts`);
  }
  
  const runs: TextRun[] = [];
  for (const p of parts) {
    const t: TextRun['t'] = p.added ? 'ins' : p.removed ? 'del' : 'eq';
    const s = p.value || '';
    if (!s) continue;
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.s += s; else runs.push({ t, s });
  }
  
  if (debug) {
    console.log(`      Generated runs: ${runs.length} runs`);
    runs.forEach((run, i) => {
      const type = run.t === 'eq' ? '=' : run.t === 'ins' ? '+' : '-';
      console.log(`        ${i + 1}. [${type}] "${run.s}"`);
    });
  }
  
  return runs;
}

// Append helper that merges adjacent same-type runs
function appendRun(target: TextRun[], t: TextRun['t'], s: string, sAfter?: string) {
  if (!s && !sAfter) return;
  const last = target[target.length - 1];
  if (last && last.t === t && t !== 'update') last.s += s;
  else target.push({ t, s, sAfter });
}


// Build TextRuns for a paragraph with sentence alignment and thresholds.
function buildParagraphMultiPassRuns(
  aText: string,
  bText: string,
  mp: Required<MultiPassOptions>
): { paragraphAtomic: boolean; runs?: TextRun[] } {
  if (mp.debug) {
    console.log('📝 PARAGRAPH MULTI-PASS ANALYSIS:');
    console.log(`  Paragraph A: "${aText}"`);
    console.log(`  Paragraph B: "${bText}"`);
    console.log(`  Thresholds: paragraph=${mp.paragraphAtomicDiffIfDiffAbove}, sentence=${mp.sentenceAtomicDiffIfDiffAbove}`);
  }
  
  // Pass 1: paragraph-level similarity
  const paraDiff = diffRatioWords(aText, bText, mp.debug);
  if (mp.debug) {
    console.log(`  📊 PARAGRAPH DECISION: diff=${paraDiff.toFixed(3)}, threshold=${mp.paragraphAtomicDiffIfDiffAbove}`);
  }
  
  if (paraDiff > mp.paragraphAtomicDiffIfDiffAbove) {
    if (mp.debug) {
      console.log(`  ✅ PARAGRAPH ATOMIC: ${(paraDiff * 100).toFixed(1)}% > ${(mp.paragraphAtomicDiffIfDiffAbove * 100).toFixed(1)}% threshold`);
    }
    return { paragraphAtomic: true };
  }
  
  if (mp.debug) {
    console.log(`  🔄 PARAGRAPH GRANULAR: ${(paraDiff * 100).toFixed(1)}% <= ${(mp.paragraphAtomicDiffIfDiffAbove * 100).toFixed(1)}% threshold, proceeding to sentence analysis`);
  }

  // Pass 2: sentence alignment + per-sentence decision
  const SA = sentenceTokens(aText, mp.sentenceLocale);
  const SB = sentenceTokens(bText, mp.sentenceLocale);
  const pairs = alignSentencesBySimilarity(SA, SB, mp.sentenceAtomicDiffIfDiffAbove, mp.debug); // similarity-based alignment
  
  if (mp.debug) {
    console.log(`  📝 SENTENCE ANALYSIS:`);
    console.log(`    Sentences A: [${SA.map(s => `"${s}"`).join(', ')}] (${SA.length} sentences)`);
    console.log(`    Sentences B: [${SB.map(s => `"${s}"`).join(', ')}] (${SB.length} sentences)`);
    console.log(`    LCS matches: ${pairs.length} sentence pairs`);
  }
  
  const runs: TextRun[] = [];

  let i = 0, j = 0, k = 0;
  while (i < SA.length || j < SB.length) {
    const next = k < pairs.length ? pairs[k] : null;
    const iMatch = next ? next.i : SA.length;
    const jMatch = next ? next.j : SB.length;

    while (i < iMatch) { 
      if (mp.debug) {
        console.log(`    🗑️  DELETED SENTENCE: "${SA[i]}"`);
      }
      appendRun(runs, 'del', SA[i]); 
      i++; 
    }
    while (j < jMatch) { 
      if (mp.debug) {
        console.log(`    ➕ INSERTED SENTENCE: "${SB[j]}"`);
      }
      appendRun(runs, 'ins', SB[j]); 
      j++; 
    }

    if (next) {
      const sA = SA[i], sB = SB[j];
      if (mp.debug) {
        console.log(`    🔍 COMPARING SENTENCE PAIR:`);
        console.log(`      A: "${sA}"`);
        console.log(`      B: "${sB}"`);
      }
      
      const sDiff = diffRatioWords(sA, sB, mp.debug);
      if (mp.debug) {
        console.log(`      📊 SENTENCE DECISION: diff=${sDiff.toFixed(3)}, threshold=${mp.sentenceAtomicDiffIfDiffAbove}`);
      }
      
      if (sDiff > mp.sentenceAtomicDiffIfDiffAbove) {
        if (mp.debug) {
          console.log(`      ✅ SENTENCE ATOMIC: ${(sDiff * 100).toFixed(1)}% > ${(mp.sentenceAtomicDiffIfDiffAbove * 100).toFixed(1)}% threshold`);
        }
        appendRun(runs, 'update', sA, sB);
      } else {
        if (mp.debug) {
          console.log(`      🔄 SENTENCE GRANULAR: ${(sDiff * 100).toFixed(1)}% <= ${(mp.sentenceAtomicDiffIfDiffAbove * 100).toFixed(1)}% threshold, doing word-level diff`);
        }
        const inner = wordRuns(sA, sB, mp.debug);
        for (const r of inner) appendRun(runs, r.t, r.s);
      }
      i++; j++; k++;
    }
  }
  
  if (mp.debug) {
    console.log(`  📋 FINAL RUNS: ${runs.length} text runs generated`);
    console.log('---');
  }
  return { paragraphAtomic: false, runs };
}

export function renderCriticMarkup(beforeRoot: MdastNode, afterRoot: MdastNode, options: DiffOptions = {}): string {
  const stringify = options.stringify || fallbackStringify;
  return emitCriticForPair(beforeRoot, afterRoot, options, stringify);
}

// ========= Core tree diff =========



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
    if (r.t === 'update') out += `{~~${r.s}~>${r.sAfter || ''}~~}`;
  }
  return out;
}

// ========= CriticMarkup rendering over the original =========

function emitCriticForPair(a: MdastNode | undefined, b: MdastNode | undefined, options: DiffOptions, stringify: (node: MdastNode) => string): string {
  if (a && !b) return wrapDel(stringify(a));
  if (!a && b) return wrapIns(stringify(b));
  if (a && b && a.type !== b.type) return wrapDel(stringify(a)) + wrapIns(stringify(b));

  if (!a || !b) return '';

  // 🔒 Real tables: never drill into children; replace whole thing on change
  if (a.type === 'table' && b.type === 'table') {
    if (!atomicEqual(a, b, stringify)) {
      return wrapDel(stringify(a)) + wrapIns(stringify(b));
    }
    return stringify(a); // identical
  }

  // 🔒 Fallback: pipe-table paragraph handled atomically
  if (isPipeTableParagraph(a) || isPipeTableParagraph(b)) {
    const aStr = stringify(a);
    const bStr = stringify(b);
    if (aStr !== bStr) return wrapDel(aStr) + wrapIns(bStr);
    return aStr;
  }

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
      if (a.type === 'paragraph' && b.type === 'paragraph') {
        const mp = { ...MP_DEFAULTS, ...(options.multipass || {}) };
        const decision = buildParagraphMultiPassRuns(aText, bText, mp);
        if (decision.paragraphAtomic) {
          return wrapUpdate(stringify(a), stringify(b));
        }
        if (decision.runs && decision.runs.length) {
          return decorateWithContainerMarkup(a, toCriticMarkup(decision.runs), stringify);
        }
      }
      // Fallback to original granular behavior
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
  return node.type === 'code' || node.type === 'table' || node.type === 'list' || node.type === 'tableRow' || node.type === 'tableCell';
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
      return `${bullet}${inner.replace(/\n+$/, '')}\n`;
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
function wrapUpdate(before: string, after: string): string { 
  return before && after ? `{~~${before}~>${after}~~}` : ''; 
}

// ========= Granular text diffing helpers =========

function shouldApplyGranularTextDiff(a: MdastNode, b: MdastNode, _options: DiffOptions): boolean {
  if (a.type !== b.type) return false;
  // NEW: avoid granularizing pipe-table paragraphs
  if (isPipeTableParagraph(a) || isPipeTableParagraph(b)) return false;
  // Do not granularize tables or their parts
  if (a.type === 'table' || a.type === 'tableRow' || a.type === 'tableCell') return false;

  // Exclude atomic blocks/inline from granular path for the node itself
  if (ATOMIC_BLOCKS.has(a.type) || ATOMIC_INLINE.has(a.type)) return false;

  // If either side contains atomic descendants (e.g., a link inside), don't flatten
  if (containsAtomicDescendant(a) || containsAtomicDescendant(b)) return false;

  // NEW: if either side contains wrapper descendants (emphasis/strong/inlineCode/link),
  // avoid flattening so wrapper changes render as atomic del+ins pairs.
  if (containsWrapperDescendant(a) || containsWrapperDescendant(b)) return false;

  const containerTypes = [
    'paragraph',
    // 'listItem',  // intentionally not granular
    'blockquote', // keep granular only if no wrappers/atomics inside
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
  } as const;
  const fields = (propsByType as any)[a.type] || [];
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
        .map((li: MdastNode) => `${bullet} ${fallbackStringify(li).replace(/\n+$/, '')}\n`)
        .join('') + '\n';
    }
    case 'listItem':
      return (node.children || []).map(fallbackStringify).join('').replace(/\n+$/, '');
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
    case 'table': {
      const rows: MdastNode[] = node.children || [];
      const cellsOf = (row: MdastNode) => (row.children || []).map(cell =>
        (cell.children || []).map(fallbackStringify).join('').replace(/\n+/g, ' ').trim()
      );

      if (rows.length === 0) return '\n\n';
      const header = cellsOf(rows[0]);
      const align = node.align || [];
      const sep = header.map((_, i) => {
        const a = align[i] || null;
        if (a === 'left') return ':---';
        if (a === 'right') return '---:';
        if (a === 'center') return ':---:';
        return '---';
      });

      const lines: string[] = [];
      lines.push('| ' + header.join(' | ') + ' |');
      lines.push('| ' + sep.join(' | ') + ' |');
      for (let r = 1; r < rows.length; r++) {
        const rowCells = cellsOf(rows[r]);
        lines.push('| ' + rowCells.join(' | ') + ' |');
      }
      return lines.join('\n') + '\n\n';
    }
    default:
      return (node.children || []).map(fallbackStringify).join('');
  }
}
