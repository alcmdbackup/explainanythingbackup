// Tests for ConfigDrivenDetailRenderer: verifies all 7 field types, nested objects, and fallback.

import { render, screen } from '@testing-library/react';
import { ConfigDrivenDetailRenderer } from './ConfigDrivenDetailRenderer';
import type { DetailFieldDef } from '@evolution/lib/core/types';

describe('ConfigDrivenDetailRenderer', () => {
  it('renders table field with columns and rows', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'items', label: 'Items', type: 'table',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'value', label: 'Value' },
        ],
      },
    ];
    const data = {
      items: [
        { name: 'alpha', value: 10 },
        { name: 'beta', value: 20 },
      ],
    };

    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    expect(screen.getByTestId('detail-table')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('renders empty table with "No data" message', () => {
    const config: DetailFieldDef[] = [
      { key: 'items', label: 'Items', type: 'table', columns: [] },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ items: [] }} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders boolean field with indicator', () => {
    const config: DetailFieldDef[] = [
      { key: 'enabled', label: 'Enabled', type: 'boolean' },
      { key: 'disabled', label: 'Disabled', type: 'boolean' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ enabled: true, disabled: false }} />);
    const fields = screen.getAllByText('Yes');
    expect(fields.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('No').length).toBeGreaterThanOrEqual(1);
  });

  it('renders badge field with colored badge', () => {
    const config: DetailFieldDef[] = [
      { key: 'status', label: 'Status', type: 'badge' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ status: 'success' }} />);
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('renders number field with formatter', () => {
    const config: DetailFieldDef[] = [
      { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
      { key: 'count', label: 'Count', type: 'number' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ cost: 0.1234, count: 42 }} />);
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders text field', () => {
    const config: DetailFieldDef[] = [
      { key: 'name', label: 'Name', type: 'text' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ name: 'test-variant-123' }} />);
    expect(screen.getByText('test-variant-123')).toBeInTheDocument();
  });

  it('renders list field with bullet points', () => {
    const config: DetailFieldDef[] = [
      { key: 'tags', label: 'Tags', type: 'list' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ tags: ['alpha', 'beta', 'gamma'] }} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('gamma')).toBeInTheDocument();
  });

  it('renders empty list with "None" message', () => {
    const config: DetailFieldDef[] = [
      { key: 'tags', label: 'Tags', type: 'list' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ tags: [] }} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders object field with nested children', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'result', label: 'Result', type: 'object',
        children: [
          { key: 'rounds', label: 'Rounds', type: 'number' },
          { key: 'exitReason', label: 'Exit Reason', type: 'badge' },
        ],
      },
    ];
    const data = {
      result: { rounds: 5, exitReason: 'convergence' },
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('convergence')).toBeInTheDocument();
  });

  it('handles null/undefined values gracefully', () => {
    const config: DetailFieldDef[] = [
      { key: 'missing', label: 'Missing', type: 'text' },
      { key: 'nullVal', label: 'Null', type: 'number' },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ nullVal: null }} />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Empty-string + cellClassName (Issue 4 of fixes_to_evolution_admin_dashboard) ──

  // Wrapper-agent configs (reflect_and_generate, evaluate_criteria_then_generate)
  // surface nested execution_detail subtrees via dot-notation keys
  // (e.g. 'evaluateAndSuggest.suggestions'). The renderer must resolve the path
  // through nested objects rather than treating it as a flat key, otherwise the
  // table renders "No data" even when the data is present.
  it('resolves dot-notation field.key against nested data (wrapper-agent fix)', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'evaluateAndSuggest.suggestions',
        label: 'Suggestions',
        type: 'table',
        columns: [{ key: 'criteriaName', label: 'Criterion' }],
      },
    ];
    const data = {
      evaluateAndSuggest: {
        suggestions: [{ criteriaName: 'clarity' }],
      },
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    // If dot-notation didn't resolve, table would render "No data".
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
    expect(screen.getByText('clarity')).toBeInTheDocument();
  });

  it('falls back to undefined when dot-notation path is missing', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'a.b.c',
        label: 'Nested',
        type: 'table',
        columns: [{ key: 'k', label: 'K' }],
      },
    ];
    // a exists but b.c does not — should render "No data" (not crash).
    const data = { a: { x: 1 } };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders empty-string cell value as em-dash (parser fallback path)', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'items',
        label: 'Items',
        type: 'table',
        columns: [
          { key: 'criteriaName', label: 'Criterion' },
          { key: 'examplePassage', label: 'Example' },
        ],
      },
    ];
    // examplePassage = '' (parser permissive-mode output) should render as '—'.
    const data = {
      items: [{ criteriaName: 'clarity', examplePassage: '' }],
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    expect(screen.getByText('clarity')).toBeInTheDocument();
    // Em-dash visible — count: at least 1 occurrence in the table body.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('applies field.cellClassName to <td> cells when provided', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'items',
        label: 'Items',
        type: 'table',
        cellClassName: 'max-w-md break-words whitespace-pre-wrap custom-marker',
        columns: [{ key: 'name', label: 'Name' }],
      },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ items: [{ name: 'alpha' }] }} />);
    const table = screen.getByTestId('detail-table');
    const cells = table.querySelectorAll('td');
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => {
      expect(cell.className).toContain('max-w-md');
      expect(cell.className).toContain('break-words');
      expect(cell.className).toContain('custom-marker');
    });
  });

  it('falls back to default cell class when cellClassName is omitted (no global cascade)', () => {
    const config: DetailFieldDef[] = [
      {
        key: 'items',
        label: 'Items',
        type: 'table',
        columns: [{ key: 'name', label: 'Name' }],
      },
    ];
    render(<ConfigDrivenDetailRenderer config={config} data={{ items: [{ name: 'alpha' }] }} />);
    const table = screen.getByTestId('detail-table');
    const cells = table.querySelectorAll('td');
    cells.forEach((cell) => {
      // Default class includes basic padding but NOT the wrapping classes — guards
      // against the regression where a global-CSS approach leaks into other tables.
      expect(cell.className).not.toContain('max-w-md');
      expect(cell.className).not.toContain('break-words');
      expect(cell.className).toContain('py-1.5');
    });
  });

  it('renders all 7 field types together', () => {
    const config: DetailFieldDef[] = [
      { key: 'items', label: 'Items', type: 'table', columns: [{ key: 'k', label: 'K' }] },
      { key: 'flag', label: 'Flag', type: 'boolean' },
      { key: 'tier', label: 'Tier', type: 'badge' },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'tags', label: 'Tags', type: 'list' },
      { key: 'nested', label: 'Nested', type: 'object', children: [{ key: 'x', label: 'X', type: 'number' }] },
    ];
    const data = {
      items: [{ k: 'v' }],
      flag: true,
      tier: 'high',
      count: 99,
      name: 'test',
      tags: ['a'],
      nested: { x: 7 },
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    expect(screen.getByTestId('config-driven-detail')).toBeInTheDocument();
    expect(screen.getByTestId('field-items')).toBeInTheDocument();
    expect(screen.getByTestId('field-flag')).toBeInTheDocument();
    expect(screen.getByTestId('field-tier')).toBeInTheDocument();
    expect(screen.getByTestId('field-count')).toBeInTheDocument();
    expect(screen.getByTestId('field-name')).toBeInTheDocument();
    expect(screen.getByTestId('field-tags')).toBeInTheDocument();
    expect(screen.getByTestId('field-nested')).toBeInTheDocument();
  });

  it('annotated-edits resolves dotted-path keys (markupKey="cycles.0.proposedMarkup")', () => {
    // Regression: annotated-edits and text-diff branches previously used literal
    // bracket access on dotted keys (e.g. data['cycles.0.proposedMarkup']),
    // which JS evaluates as undefined for nested data — every editing
    // invocation rendered an empty Annotated Edits panel as a result.
    const config: DetailFieldDef[] = [
      {
        key: 'cycles.0', label: 'Annotated Edits', type: 'annotated-edits',
        markupKey: 'cycles.0.proposedMarkup',
        groupsKey: 'cycles.0.proposedGroupsRaw',
        decisionsKey: 'cycles.0.reviewDecisions',
        dropsPreKey: 'cycles.0.droppedPreApprover',
        dropsPostKey: 'cycles.0.droppedPostApprover',
      },
    ];
    const data = {
      cycles: [
        {
          proposedMarkup: 'Hello {++ cruel ++}world.',
          proposedGroupsRaw: [{
            groupNumber: 1,
            atomicEdits: [{
              groupNumber: 1, kind: 'insert',
              range: { start: 6, end: 6 }, markupRange: { start: 6, end: 19 },
              oldText: '', newText: 'cruel',
              contextBefore: 'Hello ', contextAfter: 'world.',
            }],
          }],
          reviewDecisions: [],
          droppedPreApprover: [],
          droppedPostApprover: [],
        },
      ],
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    // The dotted key is resolved → component renders the markup.
    expect(screen.getByTestId('annotated-content').textContent).toContain('Hello');
    expect(screen.getByTestId('annotated-content').textContent).toContain('cruel');
    // Group span is rendered (proves proposedGroupsRaw was resolved, not empty default).
    expect(screen.getByTestId('annotated-group-1')).toBeInTheDocument();
  });

  it('text-diff resolves dotted-path keys (sourceKey/targetKey)', () => {
    // Same regression class as the annotated-edits dotted-key bug — text-diff
    // also used literal bracket access. Defensive coverage: even though no
    // current field config uses dotted sourceKey/targetKey, the fix is in
    // place and a regression here would silently render empty diff panels.
    const config: DetailFieldDef[] = [
      {
        key: 'diff', label: 'Diff', type: 'text-diff',
        sourceKey: 'cycles.0.parentText',
        targetKey: 'cycles.0.proposedMarkup',
        previewLength: 500,
      },
    ];
    const data = {
      cycles: [
        { parentText: 'BEFORE_TEXT', proposedMarkup: 'AFTER_TEXT' },
      ],
    };
    render(<ConfigDrivenDetailRenderer config={config} data={data} />);
    const panel = screen.getByTestId('field-diff');
    expect(panel.textContent).toContain('BEFORE_TEXT');
    expect(panel.textContent).toContain('AFTER_TEXT');
  });
});
