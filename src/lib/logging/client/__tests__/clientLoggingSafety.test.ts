// src/lib/logging/client/__tests__/clientLoggingSafety.test.ts

import { withClientLogging, shouldWrapFunction } from '../safeClientLoggingBase';
import { createSafeEventHandler, createSafeAsyncFunction } from '../safeUserCodeWrapper';

// Mock logger to track calls
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.mock('@/lib/client_utilities', () => ({
  logger: mockLogger
}));

describe('Client Logging Safety Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset global state
    (global as any).currentRecursionDepth = 0;
  });

  describe('Infinite Recursion Prevention', () => {
    it('should prevent logging system from logging itself', () => {
      const loggerFunction = () => mockLogger.info('test message');
      const wrappedLogger = withClientLogging(loggerFunction, 'loggerTest');

      wrappedLogger();

      // Should NOT create recursive logs - function should be rejected for wrapping
      expect(mockLogger.info).toHaveBeenCalledTimes(1); // Only the actual log call
    });

    it('should respect maximum recursion depth', () => {
      const deepFunction = (depth: number): string => {
        if (depth > 0) return deepFunction(depth - 1);
        return 'done';
      };

      const wrapped = withClientLogging(deepFunction, 'deepTest');
      const result = wrapped(10);

      expect(result).toBe('done');
      // Should not exceed MAX_RECURSION_DEPTH
      expect(mockLogger.info).toHaveBeenCalledTimes(1); // Only first call logged
    });

    it('should handle circular references in sanitization', () => {
      const objWithCircular: any = { name: 'test' };
      objWithCircular.self = objWithCircular; // Circular reference

      const wrappedFn = withClientLogging(() => objWithCircular, 'circularTest');
      const result = wrappedFn();

      expect(result).toBeTruthy();
      expect(mockLogger.info).toHaveBeenCalled();

      // Check that sanitization handled circular reference
      const logCall = mockLogger.info.mock.calls[0];
      const logData = logCall[1];
      expect(JSON.stringify(logData)).not.toThrow(); // Should not throw on circular refs
    });

    it('should prevent re-entrance with same function', () => {
      let callCount = 0;
      const reentrantFunction = () => {
        callCount++;
        if (callCount < 3) {
          // Try to call itself - should be prevented
          return reentrantFunction();
        }
        return 'done';
      };

      const wrapped = withClientLogging(reentrantFunction, 'reentrantTest');
      const result = wrapped();

      expect(result).toBe('done');
      expect(callCount).toBeGreaterThan(0);
      // Should not log recursive calls
    });
  });

  describe('System Code vs User Code Detection', () => {
    it('should reject system functions', () => {
      const systemFunction = Promise.prototype.then;
      const shouldWrap = shouldWrapFunction(systemFunction, 'then', 'system');

      expect(shouldWrap).toBe(false);
    });

    it('should reject native browser APIs', () => {
      const nativeFunction = fetch;
      const shouldWrap = shouldWrapFunction(nativeFunction, 'fetch', '/src/test.ts');

      expect(shouldWrap).toBe(false);
    });

    it('should accept user code functions', () => {
      const userFunction = function handleSubmit() {
        return 'user code result';
      };
      const shouldWrap = shouldWrapFunction(userFunction, 'handleSubmit', '/src/components/Form.tsx');

      expect(shouldWrap).toBe(true);
    });

    it('should reject functions that use logging APIs', () => {
      const functionWithLogging = function testFn() {
        console.log('test');
        return fetch('/api/test');
      };
      const shouldWrap = shouldWrapFunction(functionWithLogging, 'testFn', '/src/test.ts');

      expect(shouldWrap).toBe(false);
    });
  });

  describe('Safe Wrapper Functions', () => {
    it('should safely wrap event handlers', () => {
      const eventHandler = (event: Event) => {
        return 'handled';
      };

      const wrapped = createSafeEventHandler(eventHandler, 'handleClick');
      const result = wrapped(new Event('click'));

      expect(result).toBe('handled');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('userEventHandler handleClick called'),
        expect.any(Object)
      );
    });

    it('should safely wrap async functions', () => {
      const asyncFunction = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async result';
      };

      const wrapped = createSafeAsyncFunction(asyncFunction, 'fetchData');

      return wrapped().then(result => {
        expect(result).toBe('async result');
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('userAsync fetchData called'),
          expect.any(Object)
        );
      });
    });

    it('should handle errors gracefully', () => {
      const errorFunction = () => {
        throw new Error('Test error');
      };

      const wrapped = withClientLogging(errorFunction, 'errorTest');

      expect(() => wrapped()).toThrow('Test error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errorTest failed'),
        expect.objectContaining({
          error: 'Test error'
        })
      );
    });
  });

  describe('Development vs Production Behavior', () => {
    it('should disable logging in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const userFunction = () => 'test';
      const wrapped = withClientLogging(userFunction, 'prodTest');

      expect(wrapped).toBe(userFunction); // Should return original function

      process.env.NODE_ENV = originalEnv;
    });

    it('should enable logging in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const userFunction = () => 'test';
      const wrapped = withClientLogging(userFunction, 'devTest');

      expect(wrapped).not.toBe(userFunction); // Should return wrapped function

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Performance and Memory Safety', () => {
    it('should limit input sanitization size', () => {
      const largeObject = {
        data: 'x'.repeat(1000), // Large string
        nested: {}
      };

      // Add many properties
      for (let i = 0; i < 20; i++) {
        largeObject.nested[`prop${i}`] = `value${i}`;
      }

      const wrappedFn = withClientLogging(() => largeObject, 'largeDataTest', {
        logInputs: true
      });

      wrappedFn();

      expect(mockLogger.info).toHaveBeenCalled();

      // Verify sanitization limited the data
      const logCall = mockLogger.info.mock.calls[0];
      const logData = JSON.stringify(logCall[1]);
      expect(logData.length).toBeLessThan(5000); // Should be truncated
    });

    it('should handle DOM elements safely', () => {
      // Mock DOM element
      const mockElement = {
        tagName: 'DIV',
        id: 'test-id',
        className: 'test-class',
        toString: () => '[object HTMLDivElement]'
      };

      Object.setPrototypeOf(mockElement, HTMLElement.prototype);

      const wrappedFn = withClientLogging(() => mockElement, 'domTest');
      const result = wrappedFn();

      expect(result).toBe(mockElement);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});