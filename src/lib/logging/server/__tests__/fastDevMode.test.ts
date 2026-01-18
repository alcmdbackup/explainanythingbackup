/**
 * Tests for FAST_DEV mode - verifies observability is skipped for faster local development
 *
 * These unit tests verify that withServerLogging and withServerTracing pass through
 * functions without wrapping when FAST_DEV=true, reducing overhead in local development.
 */

import { withServerLogging, withServerTracing } from '../automaticServerLoggingBase';

describe('FAST_DEV mode - Server Logging Wrappers', () => {
  const originalFastDev = process.env.FAST_DEV;

  afterEach(() => {
    // Restore original environment
    if (originalFastDev === undefined) {
      delete process.env.FAST_DEV;
    } else {
      process.env.FAST_DEV = originalFastDev;
    }
  });

  describe('withServerLogging', () => {
    it('should pass through without wrapping when FAST_DEV=true', () => {
      process.env.FAST_DEV = 'true';

      const originalFn = jest.fn((x: number) => x * 2);
      const wrappedFn = withServerLogging(originalFn, 'testFunction');

      // Should return the exact same function reference (no wrapping)
      expect(wrappedFn).toBe(originalFn);
    });

    it('should wrap function when FAST_DEV is not set', () => {
      delete process.env.FAST_DEV;

      const originalFn = jest.fn((x: number) => x * 2);
      const wrappedFn = withServerLogging(originalFn, 'testFunction');

      // Should return a different function (wrapped)
      expect(wrappedFn).not.toBe(originalFn);

      // But should still work correctly
      const result = wrappedFn(5);
      expect(result).toBe(10);
      expect(originalFn).toHaveBeenCalledWith(5);
    });

    it('should wrap function when FAST_DEV=false', () => {
      process.env.FAST_DEV = 'false';

      const originalFn = jest.fn((x: number) => x * 2);
      const wrappedFn = withServerLogging(originalFn, 'testFunction');

      // Should return a different function (wrapped)
      expect(wrappedFn).not.toBe(originalFn);
    });
  });

  describe('withServerTracing', () => {
    it('should pass through without wrapping when FAST_DEV=true', () => {
      process.env.FAST_DEV = 'true';

      const originalFn = jest.fn((x: number) => x * 2);
      const wrappedFn = withServerTracing(originalFn, 'testOperation');

      // Should return the exact same function reference (no wrapping)
      expect(wrappedFn).toBe(originalFn);
    });

    it('should wrap function when FAST_DEV is not set', () => {
      delete process.env.FAST_DEV;

      const originalFn = jest.fn((x: number) => x * 2);
      const wrappedFn = withServerTracing(originalFn, 'testOperation');

      // Should return a different function (wrapped)
      expect(wrappedFn).not.toBe(originalFn);

      // But should still work correctly
      const result = wrappedFn(5);
      expect(result).toBe(10);
      expect(originalFn).toHaveBeenCalledWith(5);
    });
  });
});

describe('FAST_DEV mode - Async Functions', () => {
  const originalFastDev = process.env.FAST_DEV;

  afterEach(() => {
    if (originalFastDev === undefined) {
      delete process.env.FAST_DEV;
    } else {
      process.env.FAST_DEV = originalFastDev;
    }
  });

  it('should pass through async functions when FAST_DEV=true', async () => {
    process.env.FAST_DEV = 'true';

    const originalFn = jest.fn(async (x: number) => x * 2);
    const wrappedFn = withServerLogging(originalFn, 'asyncTestFunction');

    // Should return the exact same function reference
    expect(wrappedFn).toBe(originalFn);

    // Should still work
    const result = await wrappedFn(5);
    expect(result).toBe(10);
  });
});
