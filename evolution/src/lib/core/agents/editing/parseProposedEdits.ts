// Parses Proposer-emitted CriticMarkup into structured EditGroup[] + recovered
// source text. Pure function; no LLM, no DB. Adversarial inputs (unbalanced tags,
// nested tags, missing numbers) are silently dropped rather than thrown — the
// agent's robustness contract per Decisions §11.
//
// Markup forms accepted:
//   {++ [#N] inserted ++}
//   {-- [#N] deleted --}
//   {~~ [#N] old ~> new ~~}
//
// Adjacent paired add+delete with same [#N] is normalized to one 'replace' edit.

import { CONTEXT_LEN } from './constants';
import type {
  EditingAtomicEdit,
  EditingDroppedGroup,
  EditingGroup,
  ParseResult,
} from './types';

const RE_INSERT = /\{\+\+\s*\[#(\d+)\]\s*([\s\S]*?)\s*\+\+\}/g;
const RE_DELETE = /\{--\s*\[#(\d+)\]\s*([\s\S]*?)\s*--\}/g;
const RE_REPLACE = /\{~~\s*\[#(\d+)\]\s*([\s\S]*?)\s*~>\s*([\s\S]*?)\s*~~\}/g;
const RE_ANY_MARKUP = /\{(\+\+|--|~~)/;

interface RawAtomic {
  groupNumber: number;
  kind: 'insert' | 'delete' | 'replace';
  markupStart: number;
  markupEnd: number;
  oldText: string;
  newText: string;
}

export function parseProposedEdits(
  proposedMarkup: string,
  currentText: string,
): ParseResult {
  const dropped: EditingDroppedGroup[] = [];
  const raw: RawAtomic[] = [];

  // Substitution form first — its content can include `~>` only as a separator,
  // not in nested form. Drop combined substitutions whose oldText/newText also
  // contain `~>` as that's ambiguous.
  for (const m of proposedMarkup.matchAll(RE_REPLACE)) {
    const groupNumber = Number(m[1]);
    const oldText = m[2] ?? '';
    const newText = m[3] ?? '';
    if (!Number.isFinite(groupNumber) || groupNumber < 1) {
      dropped.push({ groupNumber: 0, reason: 'invalid_group_number', detail: m[0].slice(0, 60) });
      continue;
    }
    if (oldText.includes('~>') || newText.includes('~>')) {
      dropped.push({ groupNumber, reason: 'combined_substitution_with_arrow', detail: 'use paired form' });
      continue;
    }
    raw.push({
      groupNumber, kind: 'replace',
      markupStart: m.index ?? 0, markupEnd: (m.index ?? 0) + (m[0]?.length ?? 0),
      oldText, newText,
    });
  }

  for (const m of proposedMarkup.matchAll(RE_INSERT)) {
    const groupNumber = Number(m[1]);
    if (!Number.isFinite(groupNumber) || groupNumber < 1) {
      dropped.push({ groupNumber: 0, reason: 'invalid_group_number' });
      continue;
    }
    raw.push({
      groupNumber, kind: 'insert',
      markupStart: m.index ?? 0, markupEnd: (m.index ?? 0) + (m[0]?.length ?? 0),
      oldText: '', newText: m[2] ?? '',
    });
  }

  for (const m of proposedMarkup.matchAll(RE_DELETE)) {
    const groupNumber = Number(m[1]);
    if (!Number.isFinite(groupNumber) || groupNumber < 1) {
      dropped.push({ groupNumber: 0, reason: 'invalid_group_number' });
      continue;
    }
    raw.push({
      groupNumber, kind: 'delete',
      markupStart: m.index ?? 0, markupEnd: (m.index ?? 0) + (m[0]?.length ?? 0),
      oldText: m[2] ?? '', newText: '',
    });
  }

  // Sort by markupStart so position math + paired-merging is left-to-right.
  raw.sort((a, b) => a.markupStart - b.markupStart);

  // Detect overlapping markup spans → drop the overlapping ones (suspect output).
  const filtered: RawAtomic[] = [];
  let lastEnd = 0;
  for (const r of raw) {
    if (r.markupStart < lastEnd) {
      dropped.push({ groupNumber: r.groupNumber, reason: 'overlapping_markup' });
      continue;
    }
    filtered.push(r);
    lastEnd = r.markupEnd;
  }

  // Merge adjacent paired add+delete with the same group number into one replace.
  const merged: RawAtomic[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    if (cur == null) continue;
    const next = filtered[i + 1];
    if (
      next != null
      && cur.groupNumber === next.groupNumber
      && cur.kind === 'delete' && next.kind === 'insert'
    ) {
      merged.push({
        groupNumber: cur.groupNumber,
        kind: 'replace',
        markupStart: cur.markupStart,
        markupEnd: next.markupEnd,
        oldText: cur.oldText,
        newText: next.newText,
      });
      i++;
    } else {
      merged.push(cur);
    }
  }

  // Strip markup → recoveredSource. For each markup span, replace it with the
  // "before" content (deleted text for delete/replace; nothing for insert).
  // Track markupPos→sourcePos map to translate ranges into currentText positions.
  let recoveredSource = '';
  let cursor = 0;
  const offsetMap: Array<{ markupStart: number; markupEnd: number; sourceStart: number; sourceEnd: number }> = [];
  for (const r of merged) {
    recoveredSource += proposedMarkup.slice(cursor, r.markupStart);
    const sourceStart = recoveredSource.length;
    if (r.kind === 'insert') {
      // No source content (insert adds new text only).
    } else {
      // delete or replace: keep oldText in recoveredSource (matches currentText).
      recoveredSource += r.oldText;
    }
    const sourceEnd = recoveredSource.length;
    offsetMap.push({
      markupStart: r.markupStart,
      markupEnd: r.markupEnd,
      sourceStart,
      sourceEnd,
    });
    cursor = r.markupEnd;
  }
  recoveredSource += proposedMarkup.slice(cursor);

  // Build atomic edits with currentText positions + context capture.
  const atomicByGroup = new Map<number, EditingAtomicEdit[]>();
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    const off = offsetMap[i];
    if (r == null || off == null) continue;
    const start = off.sourceStart;
    const end = off.sourceEnd;
    const contextBefore = currentText.slice(Math.max(0, start - CONTEXT_LEN), start);
    const contextAfter = currentText.slice(end, Math.min(currentText.length, end + CONTEXT_LEN));
    const edit: EditingAtomicEdit = {
      groupNumber: r.groupNumber,
      kind: r.kind,
      range: { start, end },
      markupRange: { start: r.markupStart, end: r.markupEnd },
      oldText: r.oldText,
      newText: r.newText,
      contextBefore,
      contextAfter,
    };
    const list = atomicByGroup.get(r.groupNumber) ?? [];
    list.push(edit);
    atomicByGroup.set(r.groupNumber, list);
  }

  const groups: EditingGroup[] = Array.from(atomicByGroup.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([groupNumber, atomicEdits]) => ({ groupNumber, atomicEdits }));

  return { groups, recoveredSource, dropped };
}

/** True if any CriticMarkup-shaped opener appears in the text. Used as a
 *  pre-cycle defense — the parser strips markup blindly, so a source article
 *  that already contains `{++` etc. would corrupt under strip-markup. */
export function sourceContainsMarkup(text: string): boolean {
  return RE_ANY_MARKUP.test(text);
}
