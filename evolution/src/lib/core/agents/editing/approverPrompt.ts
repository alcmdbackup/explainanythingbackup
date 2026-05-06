// Approver system prompt + user prompt builder. The Approver receives the
// proposed marked-up article + a per-group summary table, and outputs JSONL —
// one {groupNumber, decision, reason} line per group.

import type { EditingGroup } from './types';

export function buildApproverSystemPrompt(): string {
  return [
    'You are reviewing edits to an article. Be CONSERVATIVE: only accept edits that demonstrably improve the article.',
    '',
    'For each numbered edit group, decide accept or reject and provide a one-sentence reason.',
    '',
    'Reject when ANY of these hold:',
    '  - The edit introduces or removes content that changes the article\'s meaning.',
    '  - The edit modifies a quote, citation, or URL.',
    '  - The edit alters a heading line.',
    '  - The edit\'s benefit is unclear or marginal.',
    '  - The edit reduces clarity or readability.',
    '',
    'Accept when ALL of these hold:',
    '  - The edit clearly improves clarity, structure, engagement, grammar, or overall effectiveness.',
    '  - The edit preserves the author\'s voice, tone, and reading level.',
    '  - The edit\'s benefit is greater than the risk of introducing a regression.',
    '',
    'Output ONE JSON line per group:',
    '  {"groupNumber": N, "decision": "accept"|"reject", "reason": "<one sentence>"}',
    '',
    'No commentary, no summary. JSONL only.',
  ].join('\n');
}

export function buildApproverUserPrompt(
  proposedMarkup: string,
  approverGroups: EditingGroup[],
): string {
  const summary = approverGroups.map((g) => {
    const edits = g.atomicEdits.map((e) => {
      if (e.kind === 'insert') return `  insert: "${truncate(e.newText, 80)}"`;
      if (e.kind === 'delete') return `  delete: "${truncate(e.oldText, 80)}"`;
      return `  replace: "${truncate(e.oldText, 60)}" → "${truncate(e.newText, 60)}"`;
    }).join('\n');
    return `[#${g.groupNumber}] ${g.atomicEdits.length} atomic edit${g.atomicEdits.length === 1 ? '' : 's'}:\n${edits}`;
  }).join('\n\n');

  return [
    'Marked-up article:',
    '',
    proposedMarkup,
    '',
    '─────────────────────────────────────',
    'Edit groups to review:',
    '',
    summary,
  ].join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
