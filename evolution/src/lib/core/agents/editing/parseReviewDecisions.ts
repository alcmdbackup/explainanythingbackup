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
    // Phase 4.0: extract optional guardrail violation flags. Populated by ProposerApproverCriteriaGenerateAgent's
    // approver only (legacy IterativeEditingAgent's approver doesn't emit these). Backward-compat:
    // missing fields stay undefined; the EditingReviewDecision schema's optional flags allow it.
    const decisionRecord: EditingReviewDecision = { groupNumber, decision, reason };
    if (typeof obj.redundancy_violation === 'boolean') decisionRecord.redundancy_violation = obj.redundancy_violation;
    if (typeof obj.flow_violation === 'boolean') decisionRecord.flow_violation = obj.flow_violation;
    if (typeof obj.length_violation === 'boolean') decisionRecord.length_violation = obj.length_violation;
    seen.set(groupNumber, decisionRecord);
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
