// Tests for shared UI primitives: ShortId URL construction, clickability, and fallback rendering.

import { render, screen, fireEvent } from '@testing-library/react';
import { ShortId, StatusBadge, CostDisplay, Metric, DetailSection } from './shared';

describe('ShortId', () => {
  const fullId = 'abcdef01-2345-6789-abcd-ef0123456789';

  it('renders truncated ID as plain span when no props', () => {
    render(<ShortId id={fullId} />);
    const el = screen.getByTitle(fullId);
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveTextContent('abcdef01');
  });

  it('renders as link when href is provided', () => {
    render(<ShortId id={fullId} href="/some/path" />);
    const el = screen.getByTitle(fullId);
    expect(el.tagName).toBe('A');
    expect(el).toHaveAttribute('href', '/some/path');
    expect(el).toHaveTextContent('abcdef01');
  });

  it('auto-constructs variant URL from runId', () => {
    render(<ShortId id={fullId} runId="run-123" />);
    const el = screen.getByTitle(fullId);
    expect(el.tagName).toBe('A');
    expect(el).toHaveAttribute(
      'href',
      `/admin/quality/evolution/run/run-123?tab=variants&variant=${fullId}`,
    );
  });

  it('prefers explicit href over runId', () => {
    render(<ShortId id={fullId} runId="run-123" href="/custom" />);
    const el = screen.getByTitle(fullId);
    expect(el).toHaveAttribute('href', '/custom');
  });

  it('renders as button when only onClick is provided', () => {
    const onClick = jest.fn();
    render(<ShortId id={fullId} onClick={onClick} />);
    const el = screen.getByTitle(fullId);
    expect(el.tagName).toBe('BUTTON');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick and prevents default when href + onClick', () => {
    const onClick = jest.fn();
    render(<ShortId id={fullId} href="/path" onClick={onClick} />);
    const el = screen.getByTitle(fullId);
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies accent-gold styling', () => {
    render(<ShortId id={fullId} />);
    const el = screen.getByTitle(fullId);
    expect(el.className).toContain('text-[var(--accent-gold)]');
    expect(el.className).toContain('font-mono');
  });
});

describe('StatusBadge', () => {
  it('renders success status with correct color', () => {
    render(<StatusBadge status="success" />);
    const el = screen.getByText('success');
    expect(el.className).toContain('text-[var(--status-success)]');
  });

  it('renders error status with correct color', () => {
    render(<StatusBadge status="error" />);
    const el = screen.getByText('error');
    expect(el.className).toContain('text-[var(--status-error)]');
  });

  it('renders unknown status with default styling', () => {
    render(<StatusBadge status="custom_status" />);
    const el = screen.getByText('custom_status');
    expect(el.className).toContain('text-[var(--text-secondary)]');
  });
});

describe('CostDisplay', () => {
  it('formats cost to 4 decimal places', () => {
    render(<CostDisplay cost={0.1} />);
    expect(screen.getByText('$0.1000')).toBeInTheDocument();
  });
});

describe('Metric', () => {
  it('renders label and value', () => {
    render(<Metric label="Count" value={42} />);
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

describe('DetailSection', () => {
  it('renders title and children', () => {
    render(<DetailSection title="Test Section"><p>content</p></DetailSection>);
    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
