// Tests for ConfigDrivenDetailRenderer: verifies all 7 field types, nested objects, and fallback.

import { render, screen } from '@testing-library/react';
import { ConfigDrivenDetailRenderer } from './ConfigDrivenDetailRenderer';
import type { DetailFieldDef } from '@evolution/lib/shared/types';

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
});
