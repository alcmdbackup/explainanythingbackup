import { formatUserFriendlyDate } from './formatDate';

describe('formatUserFriendlyDate', () => {
  beforeEach(() => {
    // Mock Date.now() for consistent "today" tests
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T14:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('input type handling', () => {
    it('should accept Date object input', () => {
      const date = new Date('2025-01-15T13:50:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/10 minutes ago/);
    });

    it('should accept ISO string input', () => {
      const result = formatUserFriendlyDate('2025-01-15T13:50:00');
      expect(result).toMatch(/10 minutes ago/);
    });

    it('should return empty string for invalid date string', () => {
      expect(formatUserFriendlyDate('invalid-date')).toBe('');
    });

    it('should return empty string for invalid Date object', () => {
      const invalidDate = new Date('not a date');
      expect(formatUserFriendlyDate(invalidDate)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(formatUserFriendlyDate('')).toBe('');
    });
  });

  describe('today branch - recent dates', () => {
    it('should format 5 minutes ago as "X minutes ago"', () => {
      const date = new Date('2025-01-15T13:55:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/5 minutes ago/);
    });

    it('should format 30 seconds ago correctly', () => {
      const date = new Date('2025-01-15T13:59:30');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/minute ago/);
    });

    it('should format 1 minute ago correctly', () => {
      const date = new Date('2025-01-15T13:59:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/1 minute ago/);
    });

    it('should format 30 minutes ago as "X minutes ago"', () => {
      const date = new Date('2025-01-15T13:30:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/30 minutes ago/);
    });

    it('should format 59 minutes ago as relative time', () => {
      const date = new Date('2025-01-15T13:01:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/hour ago|minutes ago/);
    });
  });

  describe('today branch - older than 60 minutes', () => {
    it('should format exactly 60 minutes ago as "Today, h:mm a"', () => {
      const date = new Date('2025-01-15T13:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Today, 1:00 PM');
    });

    it('should format 2 hours ago as "Today, h:mm a"', () => {
      const date = new Date('2025-01-15T12:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Today, 12:00 PM');
    });

    it('should format morning time as "Today, h:mm a"', () => {
      const date = new Date('2025-01-15T09:30:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Today, 9:30 AM');
    });

    it('should format midnight as "Today, h:mm a"', () => {
      const date = new Date('2025-01-15T00:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Today, 12:00 AM');
    });

    it('should format earlier in the day as "Today, h:mm a"', () => {
      const date = new Date('2025-01-15T11:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Today, 11:00 AM');
    });
  });

  describe('yesterday branch', () => {
    it('should format yesterday at 3:00 PM', () => {
      const date = new Date('2025-01-14T15:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Yesterday, 3:00 PM');
    });

    it('should format yesterday at 11:59 PM', () => {
      const date = new Date('2025-01-14T23:59:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Yesterday, 11:59 PM');
    });

    it('should format yesterday morning', () => {
      const date = new Date('2025-01-14T09:30:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Yesterday, 9:30 AM');
    });

    it('should format yesterday at midnight', () => {
      const date = new Date('2025-01-14T00:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Yesterday, 12:00 AM');
    });
  });

  describe('older dates branch', () => {
    it('should format 2 days ago as "MMM d, yyyy, h:mm a"', () => {
      const date = new Date('2025-01-13T14:30:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Jan 13, 2025, 2:30 PM');
    });

    it('should format 1 week ago', () => {
      const date = new Date('2025-01-08T10:15:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Jan 8, 2025, 10:15 AM');
    });

    it('should format 1 month ago', () => {
      const date = new Date('2024-12-15T16:45:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Dec 15, 2024, 4:45 PM');
    });

    it('should format 1 year ago', () => {
      const date = new Date('2024-01-15T08:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Jan 15, 2024, 8:00 AM');
    });

    it('should format dates from multiple years ago', () => {
      const date = new Date('2020-06-20T12:00:00');
      const result = formatUserFriendlyDate(date);
      expect(result).toBe('Jun 20, 2020, 12:00 PM');
    });
  });

  describe('edge cases', () => {
    it('should handle future dates without crashing', () => {
      const futureDate = new Date('2025-01-16T14:00:00');
      const result = formatUserFriendlyDate(futureDate);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should handle leap year date', () => {
      const leapYearDate = new Date('2024-02-29T10:00:00');
      const result = formatUserFriendlyDate(leapYearDate);
      expect(result).toBe('Feb 29, 2024, 10:00 AM');
    });

    it('should handle date at midnight boundary', () => {
      jest.setSystemTime(new Date('2025-01-15T00:00:00'));
      const date = new Date('2025-01-14T23:59:59');
      const result = formatUserFriendlyDate(date);
      expect(result).toMatch(/Yesterday|less than a minute ago/);
    });

    it('should handle very old dates', () => {
      const oldDate = new Date('1990-01-01T12:00:00');
      const result = formatUserFriendlyDate(oldDate);
      expect(result).toBe('Jan 1, 1990, 12:00 PM');
    });
  });

  describe('boundary conditions', () => {
    it('should correctly distinguish between 59 and 60 minutes ago', () => {
      // 59 minutes ago - should use relative time
      const date59 = new Date('2025-01-15T13:01:00');
      const result59 = formatUserFriendlyDate(date59);
      expect(result59).toMatch(/ago/);

      // 60 minutes ago - should use "Today, h:mm a"
      const date60 = new Date('2025-01-15T13:00:00');
      const result60 = formatUserFriendlyDate(date60);
      expect(result60).toBe('Today, 1:00 PM');
    });

    it('should correctly identify date boundaries for yesterday', () => {
      jest.setSystemTime(new Date('2025-01-15T02:00:00'));

      // Yesterday evening should be yesterday
      const yesterdayEvening = new Date('2025-01-14T22:00:00');
      const result = formatUserFriendlyDate(yesterdayEvening);
      expect(result).toBe('Yesterday, 10:00 PM');
    });

    it('should handle timezone-aware dates', () => {
      const date = new Date('2025-01-15T13:00:00Z');
      const result = formatUserFriendlyDate(date);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });
});
