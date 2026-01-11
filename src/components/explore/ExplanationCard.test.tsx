/**
 * Unit tests for ExplanationCard component.
 * Tests Link mode, onClick mode, accessibility, and content rendering.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import ExplanationCard from './ExplanationCard';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string }) {
    return <a href={href} {...props}>{children}</a>;
  };
});

const mockExplanation = {
  id: 123,
  explanation_title: 'Test Explanation Title',
  content: '# Heading\n\nThis is the content of the explanation with more details.',
  summary_teaser: 'This is a preview teaser for the explanation.',
};

describe('ExplanationCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console warnings in tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Link mode (href prop)', () => {
    it('should render as a Link when href is provided', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/results?explanation_id=123');
    });

    it('should render the title', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      expect(screen.getByText('Test Explanation Title')).toBeInTheDocument();
    });

    it('should prefer summary_teaser for preview', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      expect(screen.getByText('This is a preview teaser for the explanation.')).toBeInTheDocument();
    });

    it('should strip markdown title from content when no teaser', () => {
      const explanationWithoutTeaser = {
        ...mockExplanation,
        summary_teaser: null,
      };

      render(
        <ExplanationCard
          explanation={explanationWithoutTeaser}
          href="/results?explanation_id=123"
        />
      );

      // Should show stripped content without the "# Heading" title
      expect(screen.getByText(/This is the content of the explanation/)).toBeInTheDocument();
    });

    it('should have data-testid attribute', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      expect(screen.getByTestId('explanation-card')).toBeInTheDocument();
    });
  });

  describe('Button mode (onClick prop)', () => {
    it('should render as a button when onClick is provided', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should call onClick when clicked', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should handle Enter key press', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should handle Space key press', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not respond to other keys', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Tab' });
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should have tabIndex 0', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('tabindex', '0');
    });

    it('should have default aria-label', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'View explanation: Test Explanation Title');
    });

    it('should use custom ariaLabel when provided', () => {
      const handleClick = jest.fn();

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
          ariaLabel="Custom label"
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Custom label');
    });

    it('should catch onClick errors without throwing', () => {
      const handleClick = jest.fn(() => {
        throw new Error('Test error');
      });

      render(
        <ExplanationCard
          explanation={mockExplanation}
          onClick={handleClick}
        />
      );

      // Should not throw
      expect(() => {
        fireEvent.click(screen.getByRole('button'));
      }).not.toThrow();

      expect(handleClick).toHaveBeenCalled();
    });
  });

  describe('Footer prop', () => {
    it('should render footer content when provided', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
          footer={<span data-testid="custom-footer">Custom Footer</span>}
        />
      );

      expect(screen.getByTestId('custom-footer')).toBeInTheDocument();
    });

    it('should not render footer section when not provided', () => {
      const { container } = render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      // Footer section has px-5 pb-4 classes
      const footerSection = container.querySelector('.pb-4');
      expect(footerSection).not.toBeInTheDocument();
    });
  });

  describe('Animation control', () => {
    it('should include entrance animation class by default', () => {
      const { container } = render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
        />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('gallery-card-enter');
    });

    it('should not include entrance animation when disableEntrance is true', () => {
      const { container } = render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
          disableEntrance
        />
      );

      const article = container.querySelector('article');
      expect(article).not.toHaveClass('gallery-card-enter');
    });

    it('should set --card-index CSS variable from index prop', () => {
      const { container } = render(
        <ExplanationCard
          explanation={mockExplanation}
          href="/results?explanation_id=123"
          index={5}
        />
      );

      const article = container.querySelector('article');
      expect(article).toHaveStyle('--card-index: 5');
    });
  });

  describe('Fallback mode (no href or onClick)', () => {
    it('should render as non-interactive div when neither href nor onClick provided', () => {
      render(
        <ExplanationCard
          explanation={mockExplanation}
        />
      );

      // Should not have link or button role
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      // Should still render the card
      expect(screen.getByTestId('explanation-card')).toBeInTheDocument();
    });

    // Note: The warning only fires in NODE_ENV=development, which Jest doesn't use
    // The behavior is tested implicitly by the "should render as non-interactive div" test above
  });
});
