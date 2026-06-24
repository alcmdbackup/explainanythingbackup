// Parses Proposer-emitted CriticMarkup into structured EditGroup[] + recovered
// source text. Pure function; no LLM, no DB. Adversarial inputs (unbalanced
// tags, nested tags, invalid explicit numbers like `[#0]` or `[#-1]`) are
// silently dropped rather than thrown — the agent's robustness contract per
// Decisions §11. Unnumbered spans (no `[#N]` tag at all) are NOT dropped;
// each unnumbered span is its OWN group (one approver decision per span).
//
// Markup forms accepted:
//   {++ [#N] inserted ++}                — insert (numbered or unnumbered)
//   {-- [#N] deleted --}                 — delete (numbered or unnumbered)
//   {~~ [#N] old ~> new ~~}              — inline substitution
//   {~~ [#N] deleted ~~}{++ [#N] new ++} — paired-form substitution (standard CriticMarkup)
//
// `[#N]` is OPTIONAL. When absent, each span gets its own sequential auto-assigned
// group number — the reviewer sees one decision per atomic edit, maximizing
// approver granularity. Adjacency between unnumbered spans is NO LONGER used to
// bundle them. The standard CriticMarkup paired delete+insert form
// `{~~ X ~~}{++ Y ++}` is still treated as one substitution edit, but via a
// POSITION-ADJACENCY rule (delete-immediately-followed-by-insert, optional
// horizontal whitespace between, NO newlines) — not via shared group number.
// Explicit `[#N]` tags still honor explicit grouping across non-adjacent spans
// (escape hatch for callers that want bundling).

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

// Paired-substitution gap predicate: when a delete-kind span is IMMEDIATELY
// followed by an insert-kind span with ONLY horizontal whitespace between
// (no newlines), treat them as one substitution edit. This preserves the
// standard CriticMarkup paired form `{~~ X ~~}{++ Y ++}` as one edit.
const PAIRED_DELETE_INSERT_GAP = /^[ \t]*$/;

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

// Mode A user prompt wraps the source in <source>…</source> and asks for the
// reply inside <output>…</output>. Some weak models leak those wrappers into
// the response — strip them before parsing so the markup regexes match cleanly.
// Tolerates leading/trailing whitespace + optional code-fence wrap.
function stripOutputWrapper(markup: string): string {
  let s = markup;
  // Outer code fence (e.g. ```markdown\n...\n```)
  const fenceMatch = s.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (fenceMatch) s = fenceMatch[1]!;
  // <output>...</output> wrapper (case-insensitive, allows whitespace)
  const tagMatch = s.match(/^\s*<output>\s*\n?([\s\S]*?)\n?\s*<\/output>\s*$/i);
  if (tagMatch) s = tagMatch[1]!;
  // Some weak models (gemini-2.5-flash-lite observed) echo the entire
  // <source>…</source> block from the user prompt before emitting their
  // output. Drop the leading source block so the parser only sees the
  // proposer's actual response. Conservative match: must START with <source>
  // and contain a </source> within the first N chars to avoid clobbering an
  // edit that legitimately mentions <source> in its body.
  const leadingSourceMatch = s.match(/^\s*<source>\s*\n?[\s\S]*?<\/source>\s*\n?/i);
  if (leadingSourceMatch) s = s.slice(leadingSourceMatch[0].length);
  // Trailing </output> with no opening tag (model self-closed without echoing
  // the open tag — common with the same gemini quirk).
  s = s.replace(/\s*<\/output>\s*$/i, '');
  // Stray dangling <source>/</source> at the edges (left over after the block
  // strip if the model emitted partial wrappers).
  s = s.replace(/^\s*<\/?source>\s*/i, '').replace(/\s*<\/?source>\s*$/i, '');
  return s;
}

// Tolerate whitespace inside marker boundaries that some weak models emit
// (e.g. `{ ++`, `++ }`, `~~ }` — gemini-2.5-flash-lite quirks). Normalize the
// markup so the strict-regex bodies match. Only inside marker tokens; the
// body content's leading/trailing whitespace is captured separately.
function normalizeMarkerWhitespace(markup: string): string {
  return markup
    .replace(/\{\s+\+\+/g, '{++')
    .replace(/\+\+\s+\}/g, '++}')
    .replace(/\{\s+--/g, '{--')
    .replace(/--\s+\}/g, '--}')
    .replace(/\{\s+~~/g, '{~~')
    .replace(/~~\s+\}/g, '~~}');
}

export function parseProposedEdits(
  proposedMarkupRaw: string,
  currentText: string,
): ParseResult {
  const proposedMarkup = normalizeMarkerWhitespace(stripOutputWrapper(proposedMarkupRaw));
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

  // Per-span auto-group assignment: each originally-unnumbered edit gets its OWN
  // group number. The reviewer sees one approver decision per atomic edit. Explicit
  // `[#N]` tags still honor explicit grouping (escape hatch for callers that want
  // bundling — same explicit number across non-adjacent spans → one group).
  const explicitNumbers = filtered.map((r) => r.groupNumber).filter((n): n is number => n !== undefined);
  let nextAutoGroup = (explicitNumbers.length > 0 ? Math.max(...explicitNumbers) : 0) + 1;
  for (const r of filtered) {
    if (r.groupNumber === undefined) {
      r.groupNumber = nextAutoGroup++;
    }
  }

  // Every filtered.groupNumber is now a number. Tighten the type for downstream.
  const numbered: Array<RawAtomic & { groupNumber: number }> = filtered.map((r) => ({
    ...r,
    groupNumber: r.groupNumber as number,
  }));

  // Position-adjacency paired-merge: a delete-kind span IMMEDIATELY followed by an
  // insert-kind span (only optional horizontal whitespace between, NO newlines) is
  // ONE substitution edit. This handles standard CriticMarkup paired form
  // `{~~ X ~~}{++ Y ++}` and explicit `{-- X --}{++ Y ++}` regardless of group
  // numbering, so per-span groups don't accidentally split a structural substitution
  // into two unrelated decisions.
  const merged: Array<RawAtomic & { groupNumber: number }> = [];
  for (let i = 0; i < numbered.length; i++) {
    const cur = numbered[i];
    if (cur == null) continue;
    const next = numbered[i + 1];
    if (
      next != null
      && cur.kind === 'delete' && next.kind === 'insert'
      && PAIRED_DELETE_INSERT_GAP.test(proposedMarkup.slice(cur.markupEnd, next.markupStart))
    ) {
      merged.push({
        groupNumber: cur.groupNumber,  // collapse to the earlier-span's group number
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
