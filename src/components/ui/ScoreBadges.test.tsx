/**
 * Unit tests for ScoreBadges component.
 * Tests score display, conditional rendering, and accessibility.
 */
import { render, screen } from '@testing-library/react';
import ScoreBadges from './ScoreBadges';

describe('ScoreBadges', () => {
  describe('Similarity badge', () => {
    it('should render similarity score as percentage', () => {
      render(<ScoreBadges similarity={0.95} />);

      expect(screen.getByText('95% Match')).toBeInTheDocument();
    });

    it('should round similarity score to nearest integer', () => {
      render(<ScoreBadges similarity={0.874} />);

      expect(screen.getByText('87% Match')).toBeInTheDocument();
    });

    it('should handle zero similarity', () => {
      render(<ScoreBadges similarity={0} />);

      expect(screen.getByText('0% Match')).toBeInTheDocument();
    });

    it('should handle 100% similarity', () => {
      render(<ScoreBadges similarity={1} />);

      expect(screen.getByText('100% Match')).toBeInTheDocument();
    });

    it('should have title tooltip for similarity', () => {
      render(<ScoreBadges similarity={0.85} />);

      const badge = screen.getByTitle('Similarity: 85%');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Diversity badge', () => {
    it('should render diversity score when provided', () => {
      render(<ScoreBadges similarity={0.9} diversity={0.75} />);

      expect(screen.getByText('75% Diverse')).toBeInTheDocument();
    });

    it('should not render diversity badge when diversity is null', () => {
      render(<ScoreBadges similarity={0.9} diversity={null} />);

      expect(screen.queryByText(/Diverse/)).not.toBeInTheDocument();
    });

    it('should not render diversity badge when diversity is undefined', () => {
      render(<ScoreBadges similarity={0.9} />);

      expect(screen.queryByText(/Diverse/)).not.toBeInTheDocument();
    });

    it('should handle zero diversity', () => {
      render(<ScoreBadges similarity={0.9} diversity={0} />);

      expect(screen.getByText('0% Diverse')).toBeInTheDocument();
    });

    it('should have title tooltip for diversity', () => {
      render(<ScoreBadges similarity={0.9} diversity={0.6} />);

      const badge = screen.getByTitle('Diversity: 60%');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should render both badges in a flex container', () => {
      const { container } = render(<ScoreBadges similarity={0.9} diversity={0.7} />);

      const flexContainer = container.firstChild;
      expect(flexContainer).toHaveClass('flex');
    });

    it('should apply custom className', () => {
      const { container } = render(
        <ScoreBadges similarity={0.9} className="custom-class" />
      );

      const flexContainer = container.firstChild;
      expect(flexContainer).toHaveClass('custom-class');
    });
  });

  describe('Accessibility', () => {
    it('should have aria-hidden icons', () => {
      render(<ScoreBadges similarity={0.9} diversity={0.8} />);

      const icons = document.querySelectorAll('svg');
      icons.forEach(icon => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });
});
