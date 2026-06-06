// Unit tests for the Match Viewer re-judge sandbox additions to computeRatings:
// buildComparisonPrompt's customPromptOverride/explainReasoning path and the
// reasoning-tolerant parseVerdictFromReasoning scanner.
// (match_viewer_with_experimentation_procedures_20260605)

import {
  buildComparisonPrompt,
  parseVerdictFromReasoning,
} from './computeRatings';

describe('buildComparisonPrompt — sandbox override path', () => {
  it('default path (no override, no reasoning) is unchanged from the article template', () => {
    const a = buildComparisonPrompt('AAA', 'BBB');
    const b = buildComparisonPrompt('AAA', 'BBB', 'article');
    const c = buildComparisonPrompt('AAA', 'BBB', 'article', undefined, false);
    expect(a).toBe(b);
    expect(a).toBe(c);
    // Sentinel: the default keeps the original rubric heading, not the sandbox one.
    expect(a).toContain('## Evaluation Criteria');
  });

  it('uses the override rubric verbatim and never bakes in the texts', () => {
    const override = 'Judge ONLY on factual accuracy. Ignore style entirely.';
    const prompt = buildComparisonPrompt('ALPHA', 'BETA', 'article', override);
    expect(prompt).toContain(override);
    expect(prompt).toContain('## Text A\nALPHA');
    expect(prompt).toContain('## Text B\nBETA');
    expect(prompt.trimEnd().endsWith('Your answer:')).toBe(true);
    // Override is the rubric block — the default criteria heading must be gone.
    expect(prompt).not.toContain('## Evaluation Criteria');
  });

  it('renders texts in caller order so forward/reverse passes swap them', () => {
    const override = 'Pick the better one.';
    const forward = buildComparisonPrompt('ONE', 'TWO', 'article', override);
    const reverse = buildComparisonPrompt('TWO', 'ONE', 'article', override);
    expect(forward).toContain('## Text A\nONE');
    expect(forward).toContain('## Text B\nTWO');
    expect(reverse).toContain('## Text A\nTWO');
    expect(reverse).toContain('## Text B\nONE');
    expect(forward).not.toBe(reverse);
  });

  it('explainReasoning asks for a rationale then a strict final verdict line', () => {
    const prompt = buildComparisonPrompt('A', 'B', 'article', undefined, true);
    expect(prompt.toLowerCase()).toContain('explain your reasoning');
    expect(prompt).toContain('Your answer: A');
    expect(prompt).toContain('Your answer: B');
    expect(prompt).toContain('Your answer: TIE');
  });

  it('paragraph mode override still uses the paragraph preset when no override given', () => {
    const prompt = buildComparisonPrompt('A', 'B', 'paragraph', undefined, true);
    expect(prompt.toLowerCase()).toContain('paragraph');
  });
});

describe('parseVerdictFromReasoning', () => {
  it('extracts the verdict from a trailing "Your answer:" after reasoning', () => {
    const resp = 'Text B is clearer and better structured; Text A buries the key idea.\nYour answer: B';
    expect(parseVerdictFromReasoning(resp)).toBe('B');
  });

  it('takes the LAST verdict marker when several appear', () => {
    const resp = 'Initially Your answer: A seemed right, but on reflection Your answer: TIE.';
    expect(parseVerdictFromReasoning(resp)).toBe('TIE');
  });

  it('is NOT fooled by stray "equally"/"draw" in prose (the parseWinner failure mode)', () => {
    const resp = 'Both texts are equally clear and could be seen as a draw on style.\nVerdict: A';
    expect(parseVerdictFromReasoning(resp)).toBe('A');
  });

  it('handles markdown-bolded answers', () => {
    expect(parseVerdictFromReasoning('Reasoning...\nYour answer: **B**')).toBe('B');
  });

  it('returns null when no verdict marker is present', () => {
    expect(parseVerdictFromReasoning('Both are good. Hard to say which wins.')).toBeNull();
  });
});
