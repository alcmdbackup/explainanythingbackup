/**
 * Tests for consoleInterceptor module
 *
 * Note: These tests use jest.isolateModules() to ensure fresh module state
 * between tests, since the interceptor maintains internal state.
 */

// Polyfill PromiseRejectionEvent for jsdom
class MockPromiseRejectionEvent extends Event {
  promise: Promise<unknown>;
  reason: unknown;
  constructor(type: string, init: { promise: Promise<unknown>; reason: unknown }) {
    super(type);
    this.promise = init.promise;
    this.reason = init.reason;
  }
}
(global as unknown as { PromiseRejectionEvent: typeof MockPromiseRejectionEvent }).PromiseRejectionEvent = MockPromiseRejectionEvent;

describe('consoleInterceptor', () => {
  let originalConsole: typeof console;
  let mockLocalStorage: { [key: string]: string };
  let localStorageMock: {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
  };
  let cleanupFns: Array<() => void> = [];

  beforeEach(() => {
    // Save original console
    originalConsole = { ...console };

    // Reset modules to clear internal state
    jest.resetModules();

    // Clear cleanup functions from previous test
    cleanupFns = [];

    // Mock localStorage - create fresh instance each test
    mockLocalStorage = {};
    localStorageMock = {
      getItem: jest.fn((key: string) => mockLocalStorage[key] || null),
      setItem: jest.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });

    // Initialize pre-hydration state
    (window as unknown as { __PRE_HYDRATION_LOGS__: unknown[] }).__PRE_HYDRATION_LOGS__ = [];
    (window as unknown as { __LOGGING_INITIALIZED__: boolean }).__LOGGING_INITIALIZED__ = false;
  });

  afterEach(() => {
    // Run all cleanup functions
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
    // Restore original console
    Object.assign(console, originalConsole);
  });

  describe('initConsoleInterceptor', () => {
    it('should set __LOGGING_INITIALIZED__ to true', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      expect(window.__LOGGING_INITIALIZED__).toBe(true);
    });

    it('should expose exportLogs and clearLogs on window', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      expect(typeof window.exportLogs).toBe('function');
      expect(typeof window.clearLogs).toBe('function');
    });

    it('should persist logs to localStorage', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      console.log('test message');

      const logs = JSON.parse(mockLocalStorage['client_logs'] || '[]');
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('test message');
      expect(logs[0].level).toBe('LOG');
    });

    it('should persist logs with correct level', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      console.info('info message');
      console.warn('warn message');
      console.error('error message');

      const logs = JSON.parse(mockLocalStorage['client_logs'] || '[]');
      expect(logs.length).toBe(3);
      expect(logs[0].level).toBe('INFO');
      expect(logs[1].level).toBe('WARN');
      expect(logs[2].level).toBe('ERROR');
    });

    it('should handle objects in log arguments', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      console.log('test', { foo: 'bar' }, 123);

      const logs = JSON.parse(mockLocalStorage['client_logs'] || '[]');
      expect(logs[0].message).toBe('test {"foo":"bar"} 123');
    });

    it('should flush pre-hydration logs', async () => {
      // Add pre-hydration logs before initializing
      (window as unknown as { __PRE_HYDRATION_LOGS__: unknown[] }).__PRE_HYDRATION_LOGS__ = [
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', args: ['pre-hydration message'] },
      ];

      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();

      const logs = JSON.parse(mockLocalStorage['client_logs'] || '[]');
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('pre-hydration message');
      expect(logs[0].preHydration).toBe(true);
    });

    it('should return cleanup function', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      const cleanup = initConsoleInterceptor();
      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });

    it('should not throw on circular references', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();

      const circular: { self?: unknown } = {};
      circular.self = circular;

      // Should not throw
      expect(() => console.log('circular', circular)).not.toThrow();
    });
  });

  describe('initErrorHandlers', () => {
    it('should return cleanup function', async () => {
      const { initErrorHandlers } = await import('../consoleInterceptor');
      const cleanup = initErrorHandlers();
      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });

    it('should persist uncaught errors', async () => {
      const { initConsoleInterceptor, initErrorHandlers } = await import('../consoleInterceptor');
      cleanupFns.push(initConsoleInterceptor());
      cleanupFns.push(initErrorHandlers());

      // Simulate error event
      const errorEvent = new ErrorEvent('error', {
        message: 'Test error',
        filename: 'test.js',
        lineno: 42,
        error: new Error('Test error'),
      });
      window.dispatchEvent(errorEvent);

      const errors = JSON.parse(mockLocalStorage['client_errors'] || '[]');
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Test error');
      expect(errors[0].type).toBe('uncaught');
    });

    it('should persist unhandled promise rejections', async () => {
      const { initConsoleInterceptor, initErrorHandlers } = await import('../consoleInterceptor');
      cleanupFns.push(initConsoleInterceptor());
      cleanupFns.push(initErrorHandlers());

      // Create a promise that we'll handle to avoid actual unhandled rejection
      const testPromise = Promise.resolve(); // Use resolved promise to avoid noise
      const testError = new Error('Rejected');

      // Simulate unhandled rejection event
      const rejectionEvent = new MockPromiseRejectionEvent('unhandledrejection', {
        promise: testPromise,
        reason: testError,
      });
      window.dispatchEvent(rejectionEvent);

      const errors = JSON.parse(mockLocalStorage['client_errors'] || '[]');
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Rejected');
      expect(errors[0].type).toBe('unhandledrejection');
    });

    it('should handle non-Error rejection reasons', async () => {
      const { initConsoleInterceptor, initErrorHandlers } = await import('../consoleInterceptor');
      cleanupFns.push(initConsoleInterceptor());
      cleanupFns.push(initErrorHandlers());

      // Use resolved promise to avoid actual unhandled rejection noise
      const testPromise = Promise.resolve();

      const rejectionEvent = new MockPromiseRejectionEvent('unhandledrejection', {
        promise: testPromise,
        reason: 'string reason',
      });
      window.dispatchEvent(rejectionEvent);

      const errors = JSON.parse(mockLocalStorage['client_errors'] || '[]');
      expect(errors[0].message).toBe('string reason');
    });

    it('should cleanup event listeners on unmount', async () => {
      const { initErrorHandlers } = await import('../consoleInterceptor');
      const cleanup = initErrorHandlers();
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      cleanup();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    });
  });

  describe('window utilities', () => {
    it('exportLogs should return logs as JSON string', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      console.log('test');

      const exported = window.exportLogs();
      const parsed = JSON.parse(exported);
      expect(parsed.length).toBe(1);
    });

    it('clearLogs should remove logs and errors', async () => {
      const { initConsoleInterceptor } = await import('../consoleInterceptor');
      initConsoleInterceptor();
      console.log('test');

      window.clearLogs();

      expect(mockLocalStorage['client_logs']).toBeUndefined();
      expect(mockLocalStorage['client_errors']).toBeUndefined();
    });
  });
});

describe('logConfig', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should export getLogConfig', async () => {
    const logConfig = await import('../logConfig');
    expect(typeof logConfig.getLogConfig).toBe('function');
  });

  it('should export shouldPersist', async () => {
    const logConfig = await import('../logConfig');
    expect(typeof logConfig.shouldPersist).toBe('function');
  });

  it('shouldPersist returns true for levels at or above minPersistLevel', async () => {
    const { shouldPersist } = await import('../logConfig');
    const config = {
      minPersistLevel: 'warn' as const,
      minRemoteLevel: 'error' as const,
      remoteEnabled: true,
      maxLocalLogs: 100,
    };

    expect(shouldPersist('debug', config)).toBe(false);
    expect(shouldPersist('log', config)).toBe(false);
    expect(shouldPersist('info', config)).toBe(false);
    expect(shouldPersist('warn', config)).toBe(true);
    expect(shouldPersist('error', config)).toBe(true);
  });

  it('shouldSendRemote respects remoteEnabled flag', async () => {
    const { shouldSendRemote } = await import('../logConfig');

    const configEnabled = {
      minPersistLevel: 'debug' as const,
      minRemoteLevel: 'error' as const,
      remoteEnabled: true,
      maxLocalLogs: 100,
    };

    const configDisabled = {
      minPersistLevel: 'debug' as const,
      minRemoteLevel: 'error' as const,
      remoteEnabled: false,
      maxLocalLogs: 100,
    };

    expect(shouldSendRemote('error', configEnabled)).toBe(true);
    expect(shouldSendRemote('error', configDisabled)).toBe(false);
  });
});
