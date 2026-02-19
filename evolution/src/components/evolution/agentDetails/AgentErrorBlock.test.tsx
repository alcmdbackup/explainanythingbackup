// Tests for AgentErrorBlock component: error categorization, inline/block variants, format issues.

import { render, screen, fireEvent } from '@testing-library/react';
import { AgentErrorBlock } from './AgentErrorBlock';

describe('AgentErrorBlock', () => {
  describe('inline variant (default)', () => {
    it('renders inline error with category label', () => {
      render(<AgentErrorBlock error="API rate limit exceeded" />);
      expect(screen.getByTestId('agent-error-inline')).toBeInTheDocument();
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });

    it('categorizes timeout errors', () => {
      render(<AgentErrorBlock error="Request timed out after 30s" />);
      expect(screen.getByText('Timeout')).toBeInTheDocument();
    });

    it('categorizes format errors', () => {
      render(<AgentErrorBlock error="JSON parse failed: unexpected token" />);
      expect(screen.getByText('Format Error')).toBeInTheDocument();
    });

    it('categorizes unknown errors', () => {
      render(<AgentErrorBlock error="Something went wrong" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('shows short error text inline', () => {
      render(<AgentErrorBlock error="Bad input" />);
      expect(screen.getByText(/Bad input/)).toBeInTheDocument();
    });

    it('shows details toggle for long errors', () => {
      const longError = 'A'.repeat(100);
      render(<AgentErrorBlock error={longError} />);
      const detailsBtn = screen.getByText('details');
      expect(detailsBtn).toBeInTheDocument();
      fireEvent.click(detailsBtn);
      expect(screen.getByText(longError)).toBeInTheDocument();
    });
  });

  describe('block variant', () => {
    it('renders block error card', () => {
      render(<AgentErrorBlock error="Connection failed" variant="block" />);
      expect(screen.getByTestId('agent-error-block')).toBeInTheDocument();
    });

    it('renders format issues list when provided', () => {
      render(
        <AgentErrorBlock
          error="Format issues"
          formatIssues={['Missing title', 'Invalid heading level']}
          variant="block"
        />,
      );
      expect(screen.getByText('Missing title')).toBeInTheDocument();
      expect(screen.getByText('Invalid heading level')).toBeInTheDocument();
    });

    it('truncates long errors with more button', () => {
      const longError = 'B'.repeat(100);
      render(<AgentErrorBlock error={longError} variant="block" />);
      expect(screen.getByText('more')).toBeInTheDocument();
      fireEvent.click(screen.getByText('more'));
      expect(screen.getByText(longError)).toBeInTheDocument();
    });
  });
});
