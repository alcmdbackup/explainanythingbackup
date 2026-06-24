// Deterministic, LLM-free responses for the evolution pipeline under E2E_TEST_MODE
// (fix_test_isolation_issues_20260622, Phase 2). Lets evolution E2E specs (and a Node
// integration test) drive the REAL generate→edit→rank pipeline with zero real-AI calls, so
// they're deterministic + free instead of flaky/quota-bound. Wired into the single evolution
// llmProvider.complete chokepoint (claimAndExecuteRun.ts); returns null when disabled or when
// the label/prompt isn't recognized (caller then falls through to the real callLLM).
//
// Dispatch is by label + prompt shape, and outputs are validated against the REAL parsers
// (parseWinner / parseProposedEdits / parseReviewDecisions) in e2eTestLlm.test.ts. The ranking
// winner is chosen by a CONTENT signal (longer text wins) so it survives the 2-pass reversal
// (forward + reverse agree on the same underlying text → a real winner, not a position-bias TIE).

import type { AgentName } from '../../core/agentNames';

/** Enabled only under E2E_TEST_MODE; hard-guarded against a real production runtime
 *  (mirrors generateSeedArticle's seed mock — CI is trusted). */
export function isEvolutionE2EMockEnabled(): boolean {
  if (process.env.E2E_TEST_MODE !== 'true') return false;
  if (process.env.NODE_ENV === 'production' && !process.env.CI) {
    throw new Error('E2E_TEST_MODE evolution LLM mock cannot be enabled in production');
  }
  return true;
}

// Monotonic counter so each generated article differs in length → a total order the
// length-based ranking can rank without ties → editing-born variants get a non-default mu.
let genCounter = 0;

/** Test-only: reset the generation counter for deterministic unit tests. */
export function __resetEvolutionE2eTestLlm(): void {
  genCounter = 0;
}

const COMPARISON_LABELS = new Set<AgentName>(['ranking', 'paragraph_rank', 'debate_judge']);
const PROPOSER_LABELS = new Set<AgentName>(['iterative_edit_propose', 'paragraph_rewrite', 'coherence_pass_propose']);
const REVIEW_LABELS = new Set<AgentName>(['iterative_edit_review', 'coherence_pass_review']);

// Format contract (evolution/src/lib/shared/enforceVariantFormat.validateFormat): exactly ONE H1
// on the first line, ≥1 `##`/`###` section heading, NO bullets/numbered-lists/tables, and every
// paragraph has ≥2 sentences.
//
// REALISTIC LENGTH (~3.5KB) matters: completionTokens = text.length/4, and per-call cost gates how
// many variants the generate phase produces. A too-short article makes calls far cheaper than a real
// deepseek generation, so generate over-produces (~95 variants) and exhausts the budget before Swiss
// can rank them → editing variants stay at the default mu. A realistic length keeps the variant count
// (and thus Swiss coverage) close to a real run. Length also grows strictly with `n` (fixed-width
// padding sentences) so variants are length-distinguishable → the length-based ranking is a total
// order (no ties) → editing-born variants get a non-default mu after ranking.
function mockArticle(n: number): string {
  const para = (topic: string): string =>
    `${topic} is explored here with deterministic prose written for end-to-end testing. ` +
    `Each sentence is complete so the format validator counts at least two per paragraph. ` +
    `The wording is generic on purpose, since the pipeline only needs valid, rankable text, not real content. ` +
    `A fourth sentence adds body so the article approximates a realistic generation length.`;
  const pad = ' Additional deterministic sentence keeps lengths distinct across variants.'.repeat(n);
  return `# [E2E] Variant ${n}

## Overview

${para('The overview')}${pad}

## Background

${para('The background')}

## Mechanism

${para('The mechanism')}

## Implications

${para('The implications')}

## Summary

${para('The summary')} Variant ${n} concludes the article.`;
}

/** Extract the working article from a proposer prompt. The prompt is systemPrompt + userPrompt; the
 *  system prompt's HARD_CONSTRAINT references `<source>` (e.g. "Do NOT echo the <source>\nblock"), so
 *  a lazy regex from the first tag over-captures. `buildProposerUserPrompt` (the LAST, appended block)
 *  is exactly `<source>\n{article}\n</source>\n\n…`, so take the LAST `<source>\n` → next `\n</source>`. */
function extractSource(prompt: string): string | null {
  const START = '<source>\n';
  const start = prompt.lastIndexOf(START);
  if (start === -1) return null;
  const from = start + START.length;
  const end = prompt.indexOf('\n</source>', from);
  if (end === -1) return null;
  return prompt.slice(from, end);
}

/** Deterministic "quality" score for one side of a comparison: the `# [E2E] Variant N` number that
 *  mockArticle embeds (an edited variant echoes its parent's H1, so it inherits the parent's N).
 *  Robust to the article's own `##` section headings and to trailing prompt boilerplate (we read only
 *  the FIRST `Variant N` in each side's region; the seed / non-mock text scores 0). */
function variantScore(region: string): number {
  const m = /Variant (\d+)/.exec(region);
  return m ? Number(m[1]) : 0;
}

/** Pick the comparison winner ('A'|'B'|'TIE') by the higher variant score. Returns null if the
 *  prompt isn't a recognizable `## Text A`/`## Text B` comparison. Forward and reverse passes read the
 *  SAME underlying scores (just swapped positions) → a real, consistent winner, not a position tie. */
function comparisonWinner(prompt: string): string | null {
  const ia = prompt.indexOf('## Text A');
  const ib = ia >= 0 ? prompt.indexOf('## Text B', ia) : -1;
  if (ia < 0 || ib < 0) return null;
  const scoreA = variantScore(prompt.slice(ia, ib));   // A's region: between the two headings
  const scoreB = variantScore(prompt.slice(ib));        // B's region: first Variant N after `## Text B`
  if (scoreA === scoreB) return 'TIE';
  return scoreA > scoreB ? 'A' : 'B';
}

/**
 * Deterministic response for an evolution LLM call, or null to fall through to the real LLM.
 * Returns the raw text the agent's parser expects for the given label/prompt.
 */
export function evolutionE2EMockResponse(prompt: string, label: AgentName): string | null {
  if (!isEvolutionE2EMockEnabled()) return null;

  // Ranking / judge → a winner token by the higher variant score (consistent across the 2-pass
  // reversal → a real winner, not a position-bias tie). Default 'A' only when it's not a recognizable
  // comparison prompt (rare — keeps the call non-throwing).
  if (COMPARISON_LABELS.has(label) || /##\s*Text A/i.test(prompt)) {
    return comparisonWinner(prompt) ?? 'A';
  }

  // Proposer (CriticMarkup mode) → echo the source verbatim inside <output>, with ONE inserted
  // span appended (RULE 1: every byte outside markup matches the source). parseProposedEdits then
  // applies one insert edit → an edited variant is produced.
  if (PROPOSER_LABELS.has(label)) {
    const source = extractSource(prompt);
    if (source === null) return null; // unknown prompt shape → let the real path handle it
    return `<output>${source}{++ [#1]  One clarifying sentence added during E2E editing. ++}</output>`;
  }

  // Approver → accept the single proposed group (JSONL, one line per group).
  if (REVIEW_LABELS.has(label)) {
    return JSON.stringify({ groupNumber: 1, decision: 'accept', reason: 'e2e deterministic approve' });
  }

  // Everything else (generation, generate-from-previous, reflection, seed_article fallback, …) →
  // a fresh, length-distinct article.
  return mockArticle(++genCounter);
}
