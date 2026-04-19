// Tests for InputArticleSection: preview, expand, metadata display.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputArticleSection } from './InputArticleSection';

describe('InputArticleSection', () => {
  const baseProps = {
    variantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tactic: 'generation',
    text: 'Some variant text content here',
    elo: 1350,
    runId: 'run-123',
  };

  it('renders variant ID, strategy, and Elo', () => {
    render(<InputArticleSection {...baseProps} />);
    expect(screen.getByTestId('input-article-section')).toBeInTheDocument();
    expect(screen.getByText('generation')).toBeInTheDocument();
    expect(screen.getByText('Elo 1350')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaaa')).toBeInTheDocument();
  });

  it('shows preview and expand toggle for long text', () => {
    const longText = 'a'.repeat(400);
    render(<InputArticleSection {...baseProps} text={longText} previewLength={100} />);
    expect(screen.getByTestId('input-expand-toggle')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('input-expand-toggle'));
    expect(screen.getByTestId('input-expand-toggle').textContent).toBe('Show less');
  });

  it('shows textMissing placeholder', () => {
    render(<InputArticleSection {...baseProps} text="" textMissing />);
    expect(screen.getByText('Variant text not available')).toBeInTheDocument();
  });

  it('does not show expand toggle for short text', () => {
    render(<InputArticleSection {...baseProps} text="short" />);
    expect(screen.queryByTestId('input-expand-toggle')).not.toBeInTheDocument();
  });
});
