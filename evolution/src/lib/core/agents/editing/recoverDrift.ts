// Drift recovery LLM call. Fires when the strip-markup drift check finds drift
// AND the magnitude classifier rates it MINOR (≤ 3 regions, ≤ 200 chars, no
// region overlaps any markupRange). Per Decisions §11.
//
// Recovery LLM classifies each region as:
//   - 'benign': cosmetic substitution (smart quotes, dashes, whitespace,
//     Unicode normalization). Auto-patched: splice the proposer's markup at
//     the drifted region with the source text.
//   - 'intentional': meaningful unwrapped change. ABORT cycle (the proposer
//     was trying to slip in an unmarked edit).
//
// Feature flag: EVOLUTION_DRIFT_RECOVERY_ENABLED. When set to 'false', returns
// outcome 'skipped_major_drift' regardless of magnitude (caller treats this
// the same as major drift).

import { DRIFT_MAX_REGIONS, DRIFT_MAX_CHARS } from './constants';
import type { EditingDriftRegion, EditingGroup, RecoverDriftResult } from './types';

export type DriftMagnitude = 'minor' | 'major';

export function classifyDriftMagnitude(
  regions: EditingDriftRegion[],
  groups: EditingGroup[],
): DriftMagnitude {
  if (regions.length > DRIFT_MAX_REGIONS) return 'major';
  const totalChars = regions.reduce((sum, r) => sum + r.driftedText.length, 0);
  if (totalChars > DRIFT_MAX_CHARS) return 'major';
  // Overlap check: any region offset within any markupRange → major (proposer
  // mutated the source where its own markup was supposed to be — positions are
  // unrecoverable).
  for (const r of regions) {
    for (const g of groups) {
      for (const e of g.atomicEdits) {
        if (r.offset >= e.markupRange.start && r.offset < e.markupRange.end) return 'major';
      }
    }
  }
  return 'minor';
}

export interface RecoverDriftDeps {
  /** Async LLM call — used by the agent's wrapper EvolutionLLMClient.complete().
   *  Returns the model's raw text response (JSONL: one {offset, classification, patch} per region). */
  callLlm: (prompt: string, label: 'iterative_edit_drift_recovery') => Promise<string>;
  /** Cost delta for the recovery call (scope.getOwnSpent() after - before). */
  measureCost: () => number;
  env: Record<string, string | undefined>;
}

function buildRecoveryPrompt(regions: EditingDriftRegion[], currentText: string): string {
  const regionDescs = regions.map((r) => {
    const start = Math.max(0, r.offset - 30);
    const end = Math.min(currentText.length, r.offset + r.driftedText.length + 30);
    const sourceContext = currentText.slice(start, end);
    return `Region at offset ${r.offset}:\n  drifted text: "${r.driftedText}"\n  source context: "${sourceContext}"`;
  }).join('\n\n');

  return [
    'You are reviewing whitespace / cosmetic drift in an LLM-edited document.',
    'For each region below, classify whether the drifted text is:',
    '  - "benign": cosmetic-only substitution (smart quotes, dashes, whitespace, Unicode normalization). Provide a "patch" field with the source-text replacement.',
    '  - "intentional": a meaningful unwrapped change (the LLM tried to slip in an unmarked edit). No patch needed.',
    '',
    'Output ONE JSON line per region:',
    '  {"offset": N, "classification": "benign"|"intentional", "patch": "<source text>"|null}',
    '',
    'JSONL only. No preamble.',
    '',
    'Regions:',
    regionDescs,
  ].join('\n');
}

export async function recoverDrift(args: {
  regions: EditingDriftRegion[];
  proposedMarkup: string;
  currentText: string;
  groups: EditingGroup[];
  deps: RecoverDriftDeps;
}): Promise<RecoverDriftResult> {
  const { regions, proposedMarkup, currentText, groups, deps } = args;

  if (deps.env.EVOLUTION_DRIFT_RECOVERY_ENABLED === 'false') {
    return { outcome: 'skipped_major_drift', regions, costUsd: 0 };
  }

  const magnitude = classifyDriftMagnitude(regions, groups);
  if (magnitude === 'major') {
    return { outcome: 'skipped_major_drift', regions, costUsd: 0 };
  }

  const prompt = buildRecoveryPrompt(regions, currentText);
  const responseRaw = await deps.callLlm(prompt, 'iterative_edit_drift_recovery');
  const costUsd = deps.measureCost();

  // Parse JSONL line-by-line. Skip unparseable; default missing classifications
  // to 'intentional' (conservative).
  const classifications: EditingDriftRegion[] = regions.map((r) => ({
    offset: r.offset,
    driftedText: r.driftedText,
    classification: 'intentional',
  }));
  for (const line of responseRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const offset = Number(parsed.offset);
      if (!Number.isFinite(offset)) continue;
      const cls = parsed.classification === 'benign' || parsed.classification === 'intentional'
        ? parsed.classification : 'intentional';
      const patch = typeof parsed.patch === 'string' ? parsed.patch : undefined;
      const idx = classifications.findIndex((r) => r.offset === offset);
      if (idx === -1) continue;
      const prev = classifications[idx]!;
      classifications[idx] = {
        offset: prev.offset,
        driftedText: prev.driftedText,
        classification: cls,
        ...(patch !== undefined ? { patch } : {}),
      };
    } catch {
      // Skip unparseable line.
    }
  }

  // Any 'intentional' aborts the cycle.
  if (classifications.some((c) => c.classification === 'intentional')) {
    return { outcome: 'unrecoverable_intentional', regions, classifications, costUsd };
  }

  // Apply patches in reverse-offset order so positions don't shift.
  const sortedPatches = classifications
    .filter((c) => c.classification === 'benign' && typeof c.patch === 'string')
    .sort((a, b) => b.offset - a.offset);

  let patchedMarkup = proposedMarkup;
  for (const c of sortedPatches) {
    const patch = c.patch ?? '';
    patchedMarkup = patchedMarkup.slice(0, c.offset) + patch + patchedMarkup.slice(c.offset + c.driftedText.length);
  }

  return { outcome: 'recovered', patchedMarkup, regions, classifications, costUsd };
}
