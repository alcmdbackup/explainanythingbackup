// Tests for TextDiff component: tab switching, diff rendering, preview truncation.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextDiff } from './TextDiff';

describe('TextDiff', () => {
  it('renders diff tab by default with additions and removals', () => {
    render(<TextDiff original="hello world" modified="hello beautiful world" />);
    const diff = screen.getByTestId('diff-content');
    expect(diff).toBeInTheDocument();
    expect(diff.textContent).toContain('hello');
    expect(diff.textContent).toContain('beautiful');
  });

  it('highlights additions in green and removals in red', () => {
    render(<TextDiff original="old text" modified="new text" />);
    const diff = screen.getByTestId('diff-content');
    const spans = Array.from(diff.querySelectorAll('span'));
    const addedSpan = spans.find(s => s.className.includes('status-success'));
    const removedSpan = spans.find(s => s.className.includes('status-error'));
    expect(addedSpan).toBeDefined();
    expect(addedSpan!.textContent).toContain('new');
    expect(removedSpan).toBeDefined();
    expect(removedSpan!.textContent).toContain('old');
  });

  it('hides Before tab when original is empty', () => {
    render(<TextDiff original="" modified="new content" />);
    expect(screen.queryByTestId('tab-before')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-after')).toBeInTheDocument();
    expect(screen.getByTestId('tab-diff')).toBeInTheDocument();
  });

  it('shows Before tab when original is non-empty', () => {
    render(<TextDiff original="some text" modified="other text" />);
    expect(screen.getByTestId('tab-before')).toBeInTheDocument();
  });

  it('switches between tabs', () => {
    render(<TextDiff original="before text" modified="after text" />);

    fireEvent.click(screen.getByTestId('tab-after'));
    expect(screen.getByText(/after text/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tab-before'));
    expect(screen.getByText(/before text/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tab-diff'));
    expect(screen.getByTestId('diff-content')).toBeInTheDocument();
  });

  it('shows expand toggle when text exceeds previewLength', () => {
    const longText = 'a'.repeat(400);
    render(<TextDiff original="" modified={longText} previewLength={100} />);

    // Switch to After tab to see the preview
    fireEvent.click(screen.getByTestId('tab-after'));
    expect(screen.getByTestId('expand-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('expand-toggle').textContent).toBe('Show full');

    fireEvent.click(screen.getByTestId('expand-toggle'));
    expect(screen.getByTestId('expand-toggle').textContent).toBe('Show less');
  });

  it('does not show expand toggle when text is short', () => {
    render(<TextDiff original="" modified="short" previewLength={300} />);
    fireEvent.click(screen.getByTestId('tab-after'));
    expect(screen.queryByTestId('expand-toggle')).not.toBeInTheDocument();
  });
});
