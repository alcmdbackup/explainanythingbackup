// Validates the deterministic E2E LLM mock by feeding its outputs through the REAL parsers the
// pipeline uses (parseWinner / parseProposedEdits / parseReviewDecisions). This catches
// parser-incompatibility locally — the part most likely to break — without running the full E2E.

import { evolutionE2EMockResponse, __resetEvolutionE2eTestLlm } from './e2eTestLlm';
import { parseWinner } from '../../shared/computeRatings';
import { parseProposedEdits } from '../../core/agents/editing/parseProposedEdits';
import { parseReviewDecisions } from '../../core/agents/editing/parseReviewDecisions';
import { buildProposerSystemPrompt, buildProposerUserPrompt } from '../../core/agents/editing/proposerPrompt';
import { checkProposerDrift } from '../../core/agents/editing/checkProposerDrift';

const prevEnv = { E2E: process.env.E2E_TEST_MODE, NODE_ENV: process.env.NODE_ENV };
beforeEach(() => {
  process.env.E2E_TEST_MODE = 'true';
  __resetEvolutionE2eTestLlm();
});
afterAll(() => {
  if (prevEnv.E2E === undefined) delete process.env.E2E_TEST_MODE;
  else process.env.E2E_TEST_MODE = prevEnv.E2E;
});

describe('evolutionE2EMockResponse', () => {
  it('returns null when E2E_TEST_MODE is off (real path)', () => {
    delete process.env.E2E_TEST_MODE;
    expect(evolutionE2EMockResponse('anything', 'generation')).toBeNull();
  });

  it('generation → format-valid markdown, length-distinct across calls', () => {
    const a = evolutionE2EMockResponse('gen prompt', 'generation')!;
    const b = evolutionE2EMockResponse('gen prompt', 'generation')!;
    expect(a).toContain('## ');
    expect(b).toContain('## ');
    expect(a.length).not.toBe(b.length); // distinct → rankable without ties
  });

  it('proposer output is valid CriticMarkup the real parser applies (one insert, source preserved)', () => {
    const source = '## Overview\nThe carbon cycle moves carbon. It matters a lot.';
    const prompt = `instructions...\n<source>\n${source}\n</source>\n\nReturn the article inside <output>…</output>.`;
    const out = evolutionE2EMockResponse(prompt, 'iterative_edit_propose')!;
    expect(out.startsWith('<output>')).toBe(true);
    expect(out.endsWith('</output>')).toBe(true);
    const inner = out.replace(/^<output>/, '').replace(/<\/output>$/, '');
    const parsed = parseProposedEdits(inner, source);
    expect(parsed.groups.length).toBeGreaterThanOrEqual(1);
    // RULE 1: bytes outside markup match the source → recovered "before" equals the source.
    expect(parsed.recoveredSource).toBe(source);
  });

  it('proposer falls through (null) when the prompt has no <source> block', () => {
    expect(evolutionE2EMockResponse('no source here', 'iterative_edit_propose')).toBeNull();
  });

  it('proposer against the REAL prompt builders applies cleanly with NO drift (pipeline conditions)', () => {
    const article = '# Title\n\n## Overview\n\nThe carbon cycle moves carbon. It matters a lot to the climate.\n\n## Details\n\nPlants absorb it. Then they release it again over time.';
    // Exactly what runEditingCycle feeds the proposer: systemPrompt + "\n\n" + userPrompt.
    const fullPrompt = `${buildProposerSystemPrompt()}\n\n${buildProposerUserPrompt(article)}`;
    const out = evolutionE2EMockResponse(fullPrompt, 'iterative_edit_propose')!;
    const inner = out.replace(/^<output>/, '').replace(/<\/output>$/, '');
    const parsed = parseProposedEdits(inner, article);
    expect(parsed.groups.length).toBeGreaterThanOrEqual(1);
    // The reconstructed "before" must NOT drift from the working article (else the cycle rejects it).
    expect(checkProposerDrift(parsed.recoveredSource, article).drift).toBe(false);
  });

  it('approver output is valid JSONL the real parser reads as accept', () => {
    const out = evolutionE2EMockResponse('review prompt', 'iterative_edit_review')!;
    const decisions = parseReviewDecisions(out, [1]);
    expect(decisions.find((d) => d.groupNumber === 1)?.decision).toBe('accept');
  });

  it('ranking → higher-variant-number wins, consistently across the 2-pass reversal', () => {
    // Article bodies carry their own `## Overview` headings + trailing `## Evaluation Criteria`
    // boilerplate — the winner must come from the `# [E2E] Variant N` score, not slice length.
    const lo = '# [E2E] Variant 3\n\n## Overview\n\nLower-scored variant body.';
    const hi = '# [E2E] Variant 9\n\n## Overview\n\nHigher-scored variant body.';
    const tail = '\n\n## Evaluation Criteria\nclarity\n\n## Instructions\nRespond A/B/TIE.';
    const fwd = evolutionE2EMockResponse(`## Text A\n${lo}\n\n## Text B\n${hi}${tail}`, 'ranking')!;
    const rev = evolutionE2EMockResponse(`## Text A\n${hi}\n\n## Text B\n${lo}${tail}`, 'ranking')!;
    expect(parseWinner(fwd)).toBe('B'); // Variant 9 is B in forward
    expect(parseWinner(rev)).toBe('A'); // Variant 9 is A in reverse → same variant wins both
  });

  it('ranking → equal variant scores tie', () => {
    const v = '# [E2E] Variant 5\n\n## Overview\n\nSame score body.';
    const out = evolutionE2EMockResponse(`## Text A\n${v}\n\n## Text B\n${v}\n\n## Instructions\nx`, 'ranking')!;
    expect(parseWinner(out)).toBe('TIE');
  });
});
