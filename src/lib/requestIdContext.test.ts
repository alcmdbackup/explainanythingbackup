 
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @next/next/no-assign-module-variable */

// Mock async_hooks at the top level before any imports
const mockAsyncLocalStorage = {
  run: jest.fn((data, callback) => callback()),
  getStore: jest.fn(),
};

jest.mock('async_hooks', () => ({
  AsyncLocalStorage: jest.fn().mockImplementation(() => mockAsyncLocalStorage),
}));

// Save window before module is loaded
const originalWindow = global.window;

// Delete window BEFORE importing the module
delete (global as any).window;

// Import with window deleted
const { RequestIdContext: ServerRequestIdContext } = require('./requestIdContext');

// Restore window for client tests
(global as any).window = originalWindow;

describe('RequestIdContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Validation', () => {
    // Use client-side for validation tests (easier to test without mocks)
    let RequestIdContext: typeof ServerRequestIdContext;

    beforeEach(() => {
      (global as any).window = {};
      jest.resetModules();
      const module = require('./requestIdContext');
      RequestIdContext = module.RequestIdContext;
    });

    afterEach(() => {
      delete (global as any).window;
    });

    describe('run() validation', () => {
      it('should throw for null data', () => {
        expect(() => RequestIdContext.run(null as any, () => {}))
          .toThrow('RequestIdContext: data is required');
      });

      it('should throw for undefined data', () => {
        expect(() => RequestIdContext.run(undefined as any, () => {}))
          .toThrow('RequestIdContext: data is required');
      });

      it('should throw for empty requestId', () => {
        expect(() => RequestIdContext.run({ requestId: '', userId: 'user-123', sessionId: 'test-sess' }, () => {}))
          .toThrow('RequestIdContext: requestId must be a valid non-empty string');
      });

      it('should throw for "unknown" requestId', () => {
        expect(() => RequestIdContext.run({ requestId: 'unknown', userId: 'user-123', sessionId: 'test-sess' }, () => {}))
          .toThrow('RequestIdContext: requestId must be a valid non-empty string');
      });

      it('should accept valid requestId with any userId', () => {
        expect(() => RequestIdContext.run({ requestId: 'req-123', userId: 'user-456', sessionId: 'test-sess' }, () => {}))
          .not.toThrow();
        expect(() => RequestIdContext.run({ requestId: 'req-123', userId: 'anonymous', sessionId: 'test-sess' }, () => {}))
          .not.toThrow();
        expect(() => RequestIdContext.run({ requestId: 'req-123', userId: '', sessionId: 'test-sess' }, () => {}))
          .not.toThrow();
      });
    });

    describe('setClient() validation', () => {
      it('should throw for null data', () => {
        expect(() => RequestIdContext.setClient(null as any))
          .toThrow('RequestIdContext: data is required');
      });

      it('should throw for empty requestId', () => {
        expect(() => RequestIdContext.setClient({ requestId: '', userId: 'user-123', sessionId: 'test-sess' }))
          .toThrow('RequestIdContext: requestId must be a valid non-empty string');
      });

      it('should throw for "unknown" requestId', () => {
        expect(() => RequestIdContext.setClient({ requestId: 'unknown', userId: 'user-123', sessionId: 'test-sess' }))
          .toThrow('RequestIdContext: requestId must be a valid non-empty string');
      });

      it('should accept valid requestId with any userId', () => {
        expect(() => RequestIdContext.setClient({ requestId: 'req-123', userId: 'user-456', sessionId: 'test-sess' }))
          .not.toThrow();
        expect(() => RequestIdContext.setClient({ requestId: 'req-123', userId: 'anonymous', sessionId: 'test-sess' }))
          .not.toThrow();
        expect(() => RequestIdContext.setClient({ requestId: 'req-123', userId: '', sessionId: 'test-sess' }))
          .not.toThrow();
      });
    });
  });

  describe('Server-side behavior (typeof window === undefined)', () => {
    const RequestIdContext = ServerRequestIdContext;

    describe('run', () => {
      it('should execute callback and return result', () => {
        const data = { requestId: 'req-123', userId: 'user-456', sessionId: 'test-sess' };
        const callback = jest.fn(() => 'result');

        const result = RequestIdContext.run(data, callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe('result');
      });

      it('should execute callback with complex return values', () => {
        const data = { requestId: 'req-123', userId: 'user-456', sessionId: 'test-sess' };
        const expectedResult = { success: true, data: [1, 2, 3] };
        const callback = jest.fn(() => expectedResult);

        const result = RequestIdContext.run(data, callback);

        expect(result).toBe(expectedResult);
      });

      it('should handle nested run calls', () => {
        const outerData = { requestId: 'outer-req', userId: 'outer-user' };
        const innerData = { requestId: 'inner-req', userId: 'inner-user' };
        let executed = false;

        RequestIdContext.run(outerData, () => {
          RequestIdContext.run(innerData, () => {
            executed = true;
          });
        });

        expect(executed).toBe(true);
      });
    });

    describe('get', () => {
      it('should return default context when no context is set', () => {
        const result = RequestIdContext.get();

        // Server-side returns undefined or default values when not in a run block
        expect(result).toBeDefined();
      });
    });

    describe('getRequestId', () => {
      it('should return "unknown" when context is not set', () => {
        const result = RequestIdContext.getRequestId();

        expect(result).toBe('unknown');
      });
    });

    describe('getUserId', () => {
      it('should return "anonymous" when context is not set', () => {
        const result = RequestIdContext.getUserId();

        expect(result).toBe('anonymous');
      });
    });

    describe('setClient', () => {
      it('should be callable without errors', () => {
        const data = { requestId: 'req-123', userId: 'user-456', sessionId: 'test-sess' };

        // Should not throw on server-side
        expect(() => RequestIdContext.setClient(data)).not.toThrow();
      });
    });
  });

  describe('Client-side behavior (typeof window !== undefined)', () => {
    let RequestIdContext: any;

    beforeEach(() => {
      // Mock window to simulate client environment
      (global as any).window = {};

      // Import after setting window
      jest.resetModules();
      const module = require('./requestIdContext');
      RequestIdContext = module.RequestIdContext;
    });

    afterEach(() => {
      delete (global as any).window;
    });

    describe('run', () => {
      it('should execute callback with client context', () => {
        const data = { requestId: 'client-req', userId: 'client-user' };
        const callback = jest.fn(() => 'client-result');

        const result = RequestIdContext.run(data, callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe('client-result');
      });

      it('should set context during callback execution', () => {
        const data = { requestId: 'client-req', userId: 'client-user' };
        let capturedContext: any;

        RequestIdContext.run(data, () => {
          capturedContext = RequestIdContext.get();
        });

        expect(capturedContext).toEqual(data);
      });

      it('should restore previous context after callback', () => {
        const initialData = { requestId: 'initial-req', userId: 'initial-user' };
        const tempData = { requestId: 'temp-req', userId: 'temp-user' };

        RequestIdContext.setClient(initialData);

        RequestIdContext.run(tempData, () => {
          expect(RequestIdContext.get()).toEqual(tempData);
        });

        expect(RequestIdContext.get()).toEqual(initialData);
      });

      it('should handle nested run calls with context restoration', () => {
        const outerData = { requestId: 'outer-req', userId: 'outer-user' };
        const innerData = { requestId: 'inner-req', userId: 'inner-user' };

        RequestIdContext.run(outerData, () => {
          expect(RequestIdContext.get()).toEqual(outerData);

          RequestIdContext.run(innerData, () => {
            expect(RequestIdContext.get()).toEqual(innerData);
          });

          expect(RequestIdContext.get()).toEqual(outerData);
        });
      });

      it('should restore context even if callback throws error', () => {
        const initialData = { requestId: 'initial-req', userId: 'initial-user' };
        const tempData = { requestId: 'temp-req', userId: 'temp-user' };

        RequestIdContext.setClient(initialData);

        expect(() => {
          RequestIdContext.run(tempData, () => {
            throw new Error('Callback error');
          });
        }).toThrow('Callback error');

        // Context should be restored despite error
        expect(RequestIdContext.get()).toEqual(initialData);
      });

      it('should handle async callbacks', async () => {
        const data = { requestId: 'async-req', userId: 'async-user' };
        const asyncCallback = async () => {
          await Promise.resolve();
          return 'async-result';
        };

        const result = await RequestIdContext.run(data, asyncCallback);

        expect(result).toBe('async-result');
      });
    });

    describe('setClient', () => {
      it('should update client context', () => {
        const data = { requestId: 'new-req', userId: 'new-user' };

        RequestIdContext.setClient(data);

        expect(RequestIdContext.get()).toEqual(data);
      });

      it('should persist context across multiple get calls', () => {
        const data = { requestId: 'persist-req', userId: 'persist-user' };

        RequestIdContext.setClient(data);

        expect(RequestIdContext.get()).toEqual(data);
        expect(RequestIdContext.get()).toEqual(data);
        expect(RequestIdContext.getRequestId()).toBe('persist-req');
        expect(RequestIdContext.getUserId()).toBe('persist-user');
      });
    });

    describe('get', () => {
      it('should return client context', () => {
        const data = { requestId: 'client-req', userId: 'client-user' };
        RequestIdContext.setClient(data);

        const result = RequestIdContext.get();

        expect(result).toEqual(data);
      });

      it('should return default context when not set', () => {
        // Reset by reloading module
        jest.resetModules();
        (global as any).window = {};
        const module = require('./requestIdContext');
        const FreshRequestIdContext = module.RequestIdContext;

        const result = FreshRequestIdContext.get();

        expect(result).toEqual({ requestId: 'unknown', userId: 'anonymous', sessionId: 'unknown' });
      });
    });

    describe('getRequestId', () => {
      it('should return request ID from client context', () => {
        RequestIdContext.setClient({ requestId: 'client-req-id', userId: 'user-123', sessionId: 'test-sess' });

        const result = RequestIdContext.getRequestId();

        expect(result).toBe('client-req-id');
      });

      it('should return default "unknown" when not set', () => {
        jest.resetModules();
        (global as any).window = {};
        const module = require('./requestIdContext');
        const FreshRequestIdContext = module.RequestIdContext;

        const result = FreshRequestIdContext.getRequestId();

        expect(result).toBe('unknown');
      });
    });

    describe('getUserId', () => {
      it('should return user ID from client context', () => {
        RequestIdContext.setClient({ requestId: 'req-123', userId: 'client-user-id', sessionId: 'test-sess' });

        const result = RequestIdContext.getUserId();

        expect(result).toBe('client-user-id');
      });

      it('should return default "anonymous" when not set', () => {
        jest.resetModules();
        (global as any).window = {};
        const module = require('./requestIdContext');
        const FreshRequestIdContext = module.RequestIdContext;

        const result = FreshRequestIdContext.getUserId();

        expect(result).toBe('anonymous');
      });
    });
  });
});
