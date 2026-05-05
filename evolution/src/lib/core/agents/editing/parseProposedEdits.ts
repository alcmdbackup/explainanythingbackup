// Parses Proposer-emitted CriticMarkup into structured EditGroup[] + recovered
// source text. Pure function; no LLM, no DB. Adversarial inputs (unbalanced tags,
// nested tags, missing numbers) are silently dropped rather than thrown — the
// agent's robustness contract per Decisions §11.
//
// Markup forms accepted:
//   {++ [#N] inserted ++}                — insert (numbered or unnumbered)
//   {-- [#N] deleted --}                 — delete (numbered or unnumbered)
//   {~~ [#N] old ~> new ~~}              — inline substitution
//   {~~ [#N] deleted ~~}{++ [#N] new ++} — paired-form substitution (standard CriticMarkup)
//
// `[#N]` is OPTIONAL. When absent, the parser auto-assigns sequential group
// numbers via the adjacency rule (consecutive markup spans separated only by
// horizontal whitespace + at most one newline form one group). Adjacent paired
// delete+insert with the same group number is normalized to one 'replace' edit.

import { CONTEXT_LEN } from './constants';
import type {
  EditingAtomicEdit,
  EditingDroppedGroup,
  EditingGroup,
  ParseResult,
} from './types';

// Negative-lookahead bodies prevent cross-block matching. Without it, the lazy
// `[\s\S]*?` could span multiple `{~~ ~~}` blocks once `[#N]` is optional —
// e.g. `{~~ X ~~}{~~ Y ~> Z ~~}` would otherwise greedily match as one span.
const RE_INSERT = /\{\+\+\s*(?:\[#(\d+)\])?\s*((?:(?!\+\+\})[\s\S])*?)\s*\+\+\}/g;
const RE_DELETE = /\{--\s*(?:\[#(\d+)\])?\s*((?:(?!--\})[\s\S])*?)\s*--\}/g;
const RE_REPLACE = /\{~~\s*(?:\[#(\d+)\])?\s*((?:(?!~~\}|~>)[\s\S])*?)\s*~>\s*((?:(?!~~\})[\s\S])*?)\s*~~\}/g;
// Standard-CriticMarkup paired-form delete: `{~~ X ~~}` without `~>`. Negative
// lookahead on `~>` ensures this regex doesn't double-match RE_REPLACE spans.
const RE_DELETE_TILDE = /\{~~\s*(?:\[#(\d+)\])?\s*((?:(?!~~\}|~>)[\s\S])*?)\s*~~\}/g;
const RE_ANY_MARKUP = /\{(\+\+|--|~~)/;

// Adjacency predicate: consecutive markup spans separated only by horizontal
// whitespace + at most one newline form one group. Paragraph break (\n\n)
// signals semantic separation → different groups.
const ADJACENT_WHITESPACE = /^[ \t\r]*\n?[ \t\r]*$/;

interface RawAtomic {
  /** Explicit `[#N]` from the markup, or `undefined` when unnumbered (parser
   *  will auto-assign in the adjacency pass). */
  groupNumber: number | undefined;
  kind: 'insert' | 'delete' | 'replace';
  markupStart: number;
  markupEnd: number;
  oldText: string;
  newText: string;
}

function parseExplicitGroupNumber(
  raw: string | undefined,
): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  return { ok: true, value: n };
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
    const parsed = parseExplicitGroupNumber(m[1]);
    if (!parsed.ok) {
      dropped.push({ groupNumber: 0, reason: 'invalid_group_number', detail: m[0].slice(0, 60) });
      continue;
    }
    const oldText = m[2] ?? '';
    const newText = m[3] ?? '';
    if (oldText.includes('~>') || newText.includes('~>')) {
      dropped.push({ groupNumber: parsed.value ?? 0, reason: 'combined_substitution_with_arrow', detail: 'use paired form' });
      continue;
    }
    const start = m.index ?? 0;
    raw.push({
      groupNumber: parsed.value,
      kind: 'replace',
      markupStart: start,
      markupEnd: start + (m[0]?.length ?? 0),
      oldText,
      newText,
    });
  }

  // Insert + delete forms share identical extraction shape — the only thing
  // that varies is which capture group becomes oldText vs newText.
  // RE_DELETE_TILDE is the standard-CriticMarkup paired delete `{~~ X ~~}`
  // (no `~>`). Treated as a delete; the paired-merge step below promotes it
  // to a substitution if followed by an adjacent `{++ ++}` insert.
  const simpleForms: ReadonlyArray<{ regex: RegExp; kind: 'insert' | 'delete'; bodyIsOld: boolean }> = [
    { regex: RE_INSERT, kind: 'insert', bodyIsOld: false },
    { regex: RE_DELETE, kind: 'delete', bodyIsOld: true },
    { regex: RE_DELETE_TILDE, kind: 'delete', bodyIsOld: true },
  ];
  for (const { regex, kind, bodyIsOld } of simpleForms) {
    for (const m of proposedMarkup.matchAll(regex)) {
      const parsed = parseExplicitGroupNumber(m[1]);
      if (!parsed.ok) {
        dropped.push({ groupNumber: 0, reason: 'invalid_group_number' });
        continue;
      }
      const body = m[2] ?? '';
      const start = m.index ?? 0;
      raw.push({
        groupNumber: parsed.value,
        kind,
        markupStart: start,
        markupEnd: start + (m[0]?.length ?? 0),
        oldText: bodyIsOld ? body : '',
        newText: bodyIsOld ? '' : body,
      });
    }
  }

  // Sort by markupStart so position math + paired-merging is left-to-right.
  raw.sort((a, b) => a.markupStart - b.markupStart);

  // Detect overlapping markup spans → drop the overlapping ones (suspect output).
  const filtered: RawAtomic[] = [];
  let lastEnd = 0;
  for (const r of raw) {
    if (r.markupStart < lastEnd) {
      dropped.push({ groupNumber: r.groupNumber ?? 0, reason: 'overlapping_markup' });
      continue;
    }
    filtered.push(r);
    lastEnd = r.markupEnd;
  }

  // Adjacency-based auto-group assignment for unnumbered edits. Walk
  // left-to-right; consecutive originally-unnumbered edits separated only by
  // ADJACENT_WHITESPACE share an auto-assigned group. Explicit numbers are
  // honored as-is and break unnumbered runs.
  const wasUnnumbered = filtered.map((r) => r.groupNumber === undefined);
  const explicitNumbers = filtered.map((r) => r.groupNumber).filter((n): n is number => n !== undefined);
  let nextAutoGroup = (explicitNumbers.length > 0 ? Math.max(...explicitNumbers) : 0) + 1;
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i]!;
    if (!wasUnnumbered[i]) continue;
    const prev = i > 0 && wasUnnumbered[i - 1] ? filtered[i - 1]! : null;
    const isAdjacentToPrev = prev != null
      && ADJACENT_WHITESPACE.test(proposedMarkup.slice(prev.markupEnd, cur.markupStart));
    cur.groupNumber = isAdjacentToPrev ? prev.groupNumber : nextAutoGroup++;
  }

  // Every filtered.groupNumber is now a number. Tighten the type for downstream.
  const numbered: Array<RawAtomic & { groupNumber: number }> = filtered.map((r) => ({
    ...r,
    groupNumber: r.groupNumber as number,
  }));

  // Merge adjacent paired delete+insert with the same group number into one replace.
  // Auto-assigned groups for adjacent unnumbered delete+insert pairs naturally end
  // up with the same group number via the adjacency pass above, so this step
  // covers both explicit `{-- [#1] X --}{++ [#1] Y ++}` and standard
  // CriticMarkup `{~~ X ~~}{++ Y ++}` paired form transparently.
  const merged: Array<RawAtomic & { groupNumber: number }> = [];
  for (let i = 0; i < numbered.length; i++) {
    const cur = numbered[i];
    if (cur == null) continue;
    const next = numbered[i + 1];
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
    // delete/replace contribute oldText (matches currentText); insert contributes nothing.
    if (r.kind !== 'insert') recoveredSource += r.oldText;
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
