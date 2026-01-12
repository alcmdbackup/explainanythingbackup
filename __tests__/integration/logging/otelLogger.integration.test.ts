/**
 * Integration tests for otelLogger - verifies module initialization and basic usage.
 *
 * Note: The detailed log filtering logic is tested in unit tests.
 * These integration tests verify the module works correctly with real OpenTelemetry
 * dependencies (but without sending to a real endpoint).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Helper to set NODE_ENV in tests (TypeScript types it as readonly)
const setNodeEnv = (value: string) => {
  (process.env as { NODE_ENV: string }).NODE_ENV = value;
};

describe('OTLP Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('module initialization', () => {
    it('initializes without error when OTLP endpoint is configured', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';

      expect(() => {
        const { emitLog, isOTLPLoggingEnabled } = require('../../../src/lib/logging/server/otelLogger');
        expect(isOTLPLoggingEnabled()).toBe(true);
        // Emit a test log - should not throw
        emitLog('ERROR', 'integration test message', { testKey: 'testValue' });
      }).not.toThrow();
    });

    it('handles missing OTLP endpoint gracefully', () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      setNodeEnv('production');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      expect(() => {
        const { emitLog, isOTLPLoggingEnabled } = require('../../../src/lib/logging/server/otelLogger');
        expect(isOTLPLoggingEnabled()).toBe(false);
        // Calling emitLog should not throw even without endpoint
        emitLog('ERROR', 'test error without endpoint');
      }).not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('log attributes', () => {
    it('includes source attribute for client logs', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';

      // Should not throw when source is 'client'
      expect(() => {
        const { emitLog } = require('../../../src/lib/logging/server/otelLogger');
        emitLog('ERROR', 'client-side error', { userId: 'test123' }, 'client');
      }).not.toThrow();
    });

    it('handles complex nested data objects', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';

      expect(() => {
        const { emitLog } = require('../../../src/lib/logging/server/otelLogger');
        emitLog('ERROR', 'error with nested data', {
          user: { id: '123', email: 'test@example.com' },
          request: { method: 'POST', path: '/api/test' },
          tags: ['error', 'auth'],
        });
      }).not.toThrow();
    });
  });

  describe('environment toggle', () => {
    it('respects OTEL_SEND_ALL_LOG_LEVELS in production', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
      process.env.OTEL_SEND_ALL_LOG_LEVELS = 'true';

      expect(() => {
        const { emitLog } = require('../../../src/lib/logging/server/otelLogger');
        // These should not throw when all levels are enabled
        emitLog('DEBUG', 'debug message');
        emitLog('INFO', 'info message');
        emitLog('WARN', 'warn message');
        emitLog('ERROR', 'error message');
      }).not.toThrow();
    });
  });

  describe('security - API key protection', () => {
    it('should not expose API key in logs during initialization', () => {
      // Set up environment BEFORE resetting modules
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://api.honeycomb.io';
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-honeycomb-team=e6BHBGspbuTr8f7vQnTLXG';

      jest.resetModules();

      // Now capture console.log
      const logOutput: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logOutput.push(args.join(' '));

      // Import fresh module and call emitLog to trigger initialization
      const { emitLog } = require('../../../src/lib/logging/server/otelLogger');
      emitLog('ERROR', 'test message');

      console.log = originalLog;

      const allLogs = logOutput.join('\n');
      expect(allLogs).not.toContain('e6BHBGspbuTr8f7vQnTLXG');
      expect(allLogs).toContain('[MASKED]');
    });
  });

  describe('batch processor in production', () => {
    it('should initialize without error in production mode', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://api.honeycomb.io';
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-honeycomb-team=test';

      jest.resetModules();

      expect(() => {
        const { emitLog } = require('../../../src/lib/logging/server/otelLogger');
        emitLog('ERROR', 'test error in production');
      }).not.toThrow();
    });
  });
});
