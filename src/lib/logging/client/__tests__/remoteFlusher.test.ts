/**
 * Tests for remoteFlusher module
 */

describe('remoteFlusher', () => {
  let mockLocalStorage: { [key: string]: string };
  let mockFetch: jest.Mock;
  let mockSendBeacon: jest.Mock;
  let cleanupFn: () => void;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    // Mock localStorage
    mockLocalStorage = {};
    const localStorageMock = {
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

    // Mock fetch
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    // Mock sendBeacon
    mockSendBeacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: mockSendBeacon,
      writable: true,
      configurable: true,
    });

    // Mock online status
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    // Mock requestIdleCallback
    (window as Window & { requestIdleCallback: (cb: IdleRequestCallback) => number }).requestIdleCallback = (cb) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 0;
    };
  });

  afterEach(() => {
    if (cleanupFn) {
      cleanupFn();
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initRemoteFlusher', () => {
    it('should return cleanup function', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher();
      expect(typeof cleanupFn).toBe('function');
    });

    it('should set up interval for flushing', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      // Add some logs
      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);

      // Advance timer
      jest.advanceTimersByTime(1000);

      // Wait for async operations
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should not flush when offline', async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      });

      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should clean up on unmount', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      // Call cleanup
      cleanupFn();

      // Add logs and advance timer
      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Should not have flushed after cleanup
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should batch logs according to batchSize', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000, batchSize: 2 });

      // Add more logs than batch size
      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test1' },
        { timestamp: '2024-01-01T00:00:01Z', level: 'LOG', message: 'test2' },
        { timestamp: '2024-01-01T00:00:02Z', level: 'LOG', message: 'test3' },
      ]);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Should only send batchSize logs
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.logs.length).toBe(2);
    });

    it('should track flushed index', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000, batchSize: 1 });

      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test1' },
        { timestamp: '2024-01-01T00:00:01Z', level: 'LOG', message: 'test2' },
      ]);

      // First flush
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockLocalStorage['client_logs_flushed_index']).toBe('1');

      // Second flush
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // After all logs flushed, storage should be cleared
      expect(mockLocalStorage['client_logs']).toBeUndefined();
      expect(mockLocalStorage['client_logs_flushed_index']).toBeUndefined();
    });

    it('should use sendBeacon on visibility change to hidden', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher();

      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);

      // Simulate visibility change
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(mockSendBeacon).toHaveBeenCalled();
    });

    it('should not flush empty logs', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      // No logs
      mockLocalStorage['client_logs'] = JSON.stringify([]);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);

      // Should not throw
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Logs should still be there (not cleared on error)
      expect(mockLocalStorage['client_logs']).toBeDefined();
    });

    it('should respond to online/offline events', async () => {
      const { initRemoteFlusher } = await import('../remoteFlusher');
      cleanupFn = initRemoteFlusher({ flushIntervalMs: 1000 });

      mockLocalStorage['client_logs'] = JSON.stringify([
        { timestamp: '2024-01-01T00:00:00Z', level: 'LOG', message: 'test' },
      ]);

      // Go offline
      window.dispatchEvent(new Event('offline'));

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFetch).not.toHaveBeenCalled();

      // Go online
      window.dispatchEvent(new Event('online'));

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
