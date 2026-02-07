/**
 * Unit tests for HomeTabs component - tab switching and ARIA accessibility.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import HomeTabs from '../HomeTabs';

describe('HomeTabs', () => {
  const mockOnTabChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render both Search and Import tabs', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      expect(screen.getByRole('tab', { name: 'Search' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Import' })).toBeInTheDocument();
    });

    it('should mark Search tab as selected when activeTab is search', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      const searchTab = screen.getByRole('tab', { name: 'Search' });
      const importTab = screen.getByRole('tab', { name: 'Import' });

      expect(searchTab).toHaveAttribute('aria-selected', 'true');
      expect(importTab).toHaveAttribute('aria-selected', 'false');
    });

    it('should mark Import tab as selected when activeTab is import', () => {
      render(
        <HomeTabs
          activeTab="import"
          onTabChange={mockOnTabChange}
        />
      );

      const searchTab = screen.getByRole('tab', { name: 'Search' });
      const importTab = screen.getByRole('tab', { name: 'Import' });

      expect(searchTab).toHaveAttribute('aria-selected', 'false');
      expect(importTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should have proper ARIA controls attributes', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-controls', 'search-panel');
      expect(screen.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-controls', 'import-panel');
    });

    it('should render tablist with proper label', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      expect(screen.getByRole('tablist', { name: 'Content creation modes' })).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('should call onTabChange with "search" when Search tab is clicked', () => {
      render(
        <HomeTabs
          activeTab="import"
          onTabChange={mockOnTabChange}
        />
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
      expect(mockOnTabChange).toHaveBeenCalledWith('search');
    });

    it('should call onTabChange with "import" when Import tab is clicked', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Import' }));
      expect(mockOnTabChange).toHaveBeenCalledWith('import');
    });

    it('should call onTabChange even when clicking already active tab', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
      expect(mockOnTabChange).toHaveBeenCalledWith('search');
    });
  });

  describe('Visual Indicator', () => {
    it('should show underline indicator on active Search tab', () => {
      render(
        <HomeTabs
          activeTab="search"
          onTabChange={mockOnTabChange}
        />
      );

      const searchTab = screen.getByRole('tab', { name: 'Search' });
      const indicator = searchTab.querySelector('span.absolute');
      expect(indicator).toBeInTheDocument();
    });

    it('should show underline indicator on active Import tab', () => {
      render(
        <HomeTabs
          activeTab="import"
          onTabChange={mockOnTabChange}
        />
      );

      const importTab = screen.getByRole('tab', { name: 'Import' });
      const indicator = importTab.querySelector('span.absolute');
      expect(indicator).toBeInTheDocument();
    });
  });
});
