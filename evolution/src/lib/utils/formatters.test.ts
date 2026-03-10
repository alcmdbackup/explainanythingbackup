// Tests for centralized number formatting utilities.

import {
  formatCost,
  formatCostDetailed,
  formatCostMicro,
  formatElo,
  formatEloDollar,
  formatPercent,
  formatDuration,
  formatScore,
  formatScore1,
  elo95CI,
  formatEloCIRange,
} from './formatters';

describe('formatters', () => {
  describe('formatCost (2dp)', () => {
    it('formats normal values', () => {
      expect(formatCost(0.5)).toBe('$0.50');
      expect(formatCost(1.234)).toBe('$1.23');
      expect(formatCost(0)).toBe('$0.00');
    });
    it('handles null/undefined/NaN', () => {
      expect(formatCost(null)).toBe('$0.00');
      expect(formatCost(undefined)).toBe('$0.00');
      expect(formatCost(NaN)).toBe('$0.00');
    });
  });

  describe('formatCostDetailed (3dp)', () => {
    it('formats with 3 decimals', () => {
      expect(formatCostDetailed(0.1234)).toBe('$0.123');
      expect(formatCostDetailed(0)).toBe('$0.000');
    });
    it('handles null', () => {
      expect(formatCostDetailed(null)).toBe('$0.000');
    });
  });

  describe('formatCostMicro (4dp)', () => {
    it('preserves sub-cent precision', () => {
      expect(formatCostMicro(0.0012)).toBe('$0.0012');
      expect(formatCostMicro(0.0018)).toBe('$0.0018');
    });
    it('handles null', () => {
      expect(formatCostMicro(null)).toBe('$0.0000');
    });
  });

  describe('formatElo', () => {
    it('rounds to integer', () => {
      expect(formatElo(1350.7)).toBe('1351');
      expect(formatElo(1200)).toBe('1200');
    });
    it('returns dash for null/undefined/NaN', () => {
      expect(formatElo(null)).toBe('—');
      expect(formatElo(undefined)).toBe('—');
      expect(formatElo(NaN)).toBe('—');
    });
  });

  describe('formatEloDollar', () => {
    it('formats with 1 decimal', () => {
      expect(formatEloDollar(150.3)).toBe('150.3');
      expect(formatEloDollar(0)).toBe('0.0');
    });
    it('handles null', () => {
      expect(formatEloDollar(null)).toBe('—');
    });
  });

  describe('formatPercent', () => {
    it('converts ratio to percentage', () => {
      expect(formatPercent(0.85)).toBe('85%');
      expect(formatPercent(1)).toBe('100%');
      expect(formatPercent(0)).toBe('0%');
    });
    it('handles null', () => {
      expect(formatPercent(null)).toBe('0%');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(45)).toBe('45s');
    });
    it('formats minutes', () => {
      expect(formatDuration(125)).toBe('2m 5s');
    });
    it('formats hours', () => {
      expect(formatDuration(3725)).toBe('1h 2m');
    });
    it('handles null', () => {
      expect(formatDuration(null)).toBe('—');
    });
  });

  describe('formatScore (2dp)', () => {
    it('formats with 2 decimals', () => {
      expect(formatScore(0.856)).toBe('0.86');
    });
    it('handles null', () => {
      expect(formatScore(null)).toBe('—');
    });
  });

  describe('formatScore1 (1dp)', () => {
    it('formats with 1 decimal', () => {
      expect(formatScore1(3.456)).toBe('3.5');
    });
    it('handles null', () => {
      expect(formatScore1(null)).toBe('—');
    });
  });

  describe('elo95CI', () => {
    it('computes 95% CI half-width', () => {
      expect(elo95CI(50)).toBe(98);
      expect(elo95CI(100)).toBe(196);
    });
    it('returns 0 for zero sigma', () => {
      expect(elo95CI(0)).toBe(0);
    });
  });

  describe('formatEloCIRange', () => {
    it('formats CI range for valid elo and sigma', () => {
      expect(formatEloCIRange(1500, 50)).toBe('[1402, 1598]');
    });
    it('returns null for null sigma', () => {
      expect(formatEloCIRange(1500, null)).toBeNull();
    });
    it('returns null for zero sigma', () => {
      expect(formatEloCIRange(1500, 0)).toBeNull();
    });
    it('returns null for undefined sigma', () => {
      expect(formatEloCIRange(1500, undefined)).toBeNull();
    });
  });
});
