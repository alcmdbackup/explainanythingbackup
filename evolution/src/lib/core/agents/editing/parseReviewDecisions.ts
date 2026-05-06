// Approver JSONL response parser. One JSON line per group: {groupNumber, decision, reason}.
// Adversarial handling per Decisions §11:
//   - unparseable lines → skipped silently
//   - missing decisions for any expected group → defaults to {decision: 'reject', reason: 'no decision returned'}
//   - decisions for unknown group numbers → ignored
//   - malformed JSON → skipped
//   - extra fields → passthrough (kept on the parsed object but not enforced)

import type { EditingReviewDecision } from './types';

export function parseReviewDecisions(
  jsonlOutput: string,
  expectedGroupNumbers: ReadonlyArray<number>,
): EditingReviewDecision[] {
  const seen = new Map<number, EditingReviewDecision>();

  for (const line of jsonlOutput.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    const groupNumber = Number(obj.groupNumber);
    if (!Number.isInteger(groupNumber) || groupNumber < 1) continue;
    const decision = obj.decision === 'accept' || obj.decision === 'reject' ? obj.decision : 'reject';
    const reason = typeof obj.reason === 'string' ? obj.reason : '';
    seen.set(groupNumber, { groupNumber, decision, reason });
  }

  // Default missing groups to reject.
  const expected = new Set(expectedGroupNumbers);
  for (const gn of expected) {
    if (!seen.has(gn)) {
      seen.set(gn, { groupNumber: gn, decision: 'reject', reason: 'no decision returned' });
    }
  }

  // Drop unknown group numbers + return sorted by groupNumber.
  return Array.from(seen.values())
    .filter((d) => expected.has(d.groupNumber))
    .sort((a, b) => a.groupNumber - b.groupNumber);
}
