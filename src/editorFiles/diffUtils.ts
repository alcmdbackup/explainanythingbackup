// npm i diff
import * as Diff from "diff";

/** Each atom is emitted in reading order. No external offsets needed. */
export type Atom =
  | { kind: "orig"; text: string; deleted?: boolean }   // from originalText
  | { kind: "insert"; text: string };                   // virtual addition (not in originalText)

/** Main entry: returns an atom stream that fully covers the original text with layered edits. */
export function createUnifiedDiff(originalText: string, modifiedText: string) {
  const SIMILARITY_THRESHOLD = 0.7;

  // 1) First pass: line-level diff
  const parts = Diff.diffLines(originalText, modifiedText);

  const atoms: Atom[] = [];

  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];

    if (!cur.added && !cur.removed) {
      // Equal block: emit as original
      if (cur.value) atoms.push({ kind: "orig", text: cur.value });
      continue;
    }

    // Try to pair neighbor remove/add (in either order) and refine
    const next = parts[i + 1];
    const isRemAdd = cur.removed && next?.added;
    const isAddRem = cur.added && next?.removed;

    if ((isRemAdd || isAddRem) && areSimilar(cur.value, next!.value, SIMILARITY_THRESHOLD)) {
      const removedText = isRemAdd ? cur.value : next!.value;
      const addedText   = isRemAdd ? next!.value : cur.value;

      // 2) Refinement at word-level: output a mixed stream of orig/insert atoms
      pushWordLevelAtoms(removedText, addedText, atoms);

      i++; // consume the paired neighbor
      continue;
    }

    // Unpaired blocks
    if (cur.removed) {
      // Entire span existed in original and is now deleted
      if (cur.value) atoms.push({ kind: "orig", text: cur.value, deleted: true });
      continue;
    }

    if (cur.added) {
      // Pure insertion between surrounding original spans
      if (cur.value) atoms.push({ kind: "insert", text: cur.value });
      continue;
    }
  }

  // 3) Normalize small neighbors for cleaner rendering
  const normalized = coalesceAtoms(atoms);
  return { atoms: normalized };
}

/* ---------------------------------------
   Refinement & utilities
----------------------------------------*/

/**
 * Word-level refinement using diffWordsWithSpace:
 * - equal => { kind: 'orig', text }
 * - removed => { kind: 'orig', text, deleted: true }
 * - added => { kind: 'insert', text }
 *
 * This keeps the original text slices intact while placing inserts inline.
 */
function pushWordLevelAtoms(removedText: string, addedText: string, out: Atom[]) {
  const inner = Diff.diffWordsWithSpace(removedText, addedText);
  for (const p of inner) {
    if (p.added) {
      if (p.value) out.push({ kind: "insert", text: p.value });
    } else if (p.removed) {
      if (p.value) out.push({ kind: "orig", text: p.value, deleted: true });
    } else {
      if (p.value) out.push({ kind: "orig", text: p.value });
    }
  }
}

/** Pairing heuristic: Sørensen–Dice similarity on word tokens. */
function areSimilar(a: string, b: string, threshold: number): boolean {
  return diceOnWords(a, b) >= threshold;
}

function diceOnWords(a: string, b: string): number {
  const wa = tokenizeWords(a);
  const wb = tokenizeWords(b);
  if (wa.length === 0 && wb.length === 0) return 1;

  const A = new Map<string, number>();
  const B = new Map<string, number>();
  for (const w of wa) A.set(w, (A.get(w) ?? 0) + 1);
  for (const w of wb) B.set(w, (B.get(w) ?? 0) + 1);

  let overlap = 0, countA = 0, countB = 0;
  for (const [, c] of A) countA += c;
  for (const [, c] of B) countB += c;
  for (const [w, ca] of A) overlap += Math.min(ca, B.get(w) ?? 0);

  return (2 * overlap) / (countA + countB);
}

function tokenizeWords(s: string): string[] {
  // Unicode-friendly word-ish tokens; tweak as needed.
  const m = s.toLowerCase().match(/\p{L}[\p{L}\p{N}_'-]*|\p{N}+/gu);
  return m ?? [];
}

/** Merge adjacent atoms of same kind to keep the stream compact. */
function coalesceAtoms(atoms: Atom[]): Atom[] {
  if (atoms.length === 0) return atoms;
  const out: Atom[] = [];
  let prev = atoms[0];

  for (let i = 1; i < atoms.length; i++) {
    const cur = atoms[i];

    // Merge adjacent 'orig' with same deleted flag
    if (
      prev.kind === "orig" &&
      cur.kind === "orig" &&
      !!prev.deleted === !!cur.deleted
    ) {
      prev = { ...prev, text: prev.text + cur.text };
      continue;
    }

    // Merge adjacent 'insert's
    if (prev.kind === "insert" && cur.kind === "insert") {
      prev = { kind: "insert", text: prev.text + cur.text };
      continue;
    }

    out.push(prev);
    prev = cur;
  }
  out.push(prev);
  return out;
}

/* ---------------------------------------
   Optional: HTML renderer (safe & minimal)
----------------------------------------*/

/**
 * Render atoms to HTML that preserves the original text exactly.
 * - Unchanged: plain text
 * - Deleted: <del class="diff-del">…</del>
 * - Inserted: <ins class="diff-ins">…</ins>
 * - Wrapped in a div to ensure proper inline rendering in Lexical
 */
export function renderAnnotatedHTML(
  atoms: Atom[],
  opt?: { delClass?: string; insClass?: string }
): string {
  const delClass = opt?.delClass ?? "diff-del";
  const insClass = opt?.insClass ?? "diff-ins";
  const content = atoms
    .map((a) => {
      if (a.kind === "orig" && !a.deleted) return escapeHTML(a.text);
      if (a.kind === "orig" && a.deleted)
        return `<del class="${delClass}">${escapeHTML(a.text)}</del>`;
      // insert
      return `<ins class="${insClass}">${escapeHTML(a.text)}</ins>`;
    })
    .join("");
  
  // Wrap in a div to ensure proper inline rendering when replacing entire editor content
  return `<div>${content}</div>`;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}