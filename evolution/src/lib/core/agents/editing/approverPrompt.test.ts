import { buildApproverSystemPrompt, buildApproverUserPrompt } from './approverPrompt';
import type { EditingGroup } from './types';

describe('buildApproverSystemPrompt', () => {
  let prompt: string;
  beforeAll(() => { prompt = buildApproverSystemPrompt(); });

  it('communicates conservative review posture', () => {
    expect(prompt.toLowerCase()).toMatch(/conservative/);
    expect(prompt).toMatch(/reject/i);
    expect(prompt).toMatch(/accept/i);
  });

  it('specifies the JSONL output format', () => {
    expect(prompt).toMatch(/JSON line per group/i);
    expect(prompt).toMatch(/groupNumber/);
    expect(prompt).toMatch(/decision/);
    expect(prompt).toMatch(/reason/);
  });

  it('lists explicit reject criteria (changes meaning, alters quote/citation/URL/heading)', () => {
    expect(prompt).toMatch(/quote/i);
    expect(prompt).toMatch(/heading/i);
  });
});

describe('buildApproverUserPrompt', () => {
  it('renders the marked-up article body and the per-group summary', () => {
    const groups: EditingGroup[] = [
      { groupNumber: 1, atomicEdits: [{
        groupNumber: 1, kind: 'replace',
        range: { start: 0, end: 0 }, markupRange: { start: 0, end: 0 },
        oldText: 'foo', newText: 'bar',
        contextBefore: '', contextAfter: '',
      }] },
    ];
    const p = buildApproverUserPrompt('marked-up text', groups);
    expect(p).toContain('marked-up text');
    expect(p).toMatch(/\[#1\]/);
    expect(p).toMatch(/replace/);
    expect(p).toMatch(/foo/);
    expect(p).toMatch(/bar/);
  });

  it('renders a group with multiple atomic edits as a multi-line summary', () => {
    const groups: EditingGroup[] = [
      { groupNumber: 1, atomicEdits: [
        { groupNumber: 1, kind: 'insert', range: { start: 0, end: 0 }, markupRange: { start: 0, end: 0 }, oldText: '', newText: 'a', contextBefore: '', contextAfter: '' },
        { groupNumber: 1, kind: 'delete', range: { start: 5, end: 8 }, markupRange: { start: 0, end: 0 }, oldText: 'old', newText: '', contextBefore: '', contextAfter: '' },
      ] },
    ];
    const p = buildApproverUserPrompt('text', groups);
    expect(p).toMatch(/2 atomic edits/);
  });

  it('truncates very long edit text in the summary', () => {
    const longText = 'x'.repeat(200);
    const groups: EditingGroup[] = [
      { groupNumber: 1, atomicEdits: [{
        groupNumber: 1, kind: 'insert',
        range: { start: 0, end: 0 }, markupRange: { start: 0, end: 0 },
        oldText: '', newText: longText,
        contextBefore: '', contextAfter: '',
      }] },
    ];
    const p = buildApproverUserPrompt('text', groups);
    // Truncation marker '…' should appear in the summary for very long text.
    expect(p).toMatch(/…/);
  });
});
