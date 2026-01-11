/**
 * Unit tests for otelLogger - verifies log level filtering logic.
 *
 * Note: Dynamic require() is used intentionally to get fresh module instances
 * with different environment variables. This is the standard Jest pattern for
 * testing modules with singleton state.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// These imports are unused but kept for type reference
// The actual imports happen dynamically via require() after jest.resetModules()
import type {} from './otelLogger';

// Helper to set NODE_ENV in tests (TypeScript types it as readonly)
const setNodeEnv = (value: string) => {
  (process.env as { NODE_ENV: string }).NODE_ENV = value;
};

// Mock all OpenTelemetry modules
jest.mock('@opentelemetry/api-logs', () => ({
  SeverityNumber: {
    DEBUG: 5,
    INFO: 9,
    WARN: 13,
    ERROR: 17,
  },
}));

jest.mock('@opentelemetry/sdk-logs', () => ({
  LoggerProvider: jest.fn().mockImplementation(() => ({
    getLogger: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
  })),
  SimpleLogRecordProcessor: jest.fn(),
  BatchLogRecordProcessor: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: jest.fn(),
}));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: jest.fn().mockReturnValue({}),
}));

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn().mockReturnValue(null),
  },
}));

describe('otelLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear singleton state
    jest.resetModules();
    // Clone original env
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isOTLPLoggingEnabled', () => {
    it('returns false when OTEL_EXPORTER_OTLP_ENDPOINT is not set', () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      // Re-import to get fresh module
      const { isOTLPLoggingEnabled: freshFn } = require('./otelLogger');
      expect(freshFn()).toBe(false);
    });

    it('returns true when OTEL_EXPORTER_OTLP_ENDPOINT is set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
      const { isOTLPLoggingEnabled: freshFn } = require('./otelLogger');
      expect(freshFn()).toBe(true);
    });
  });

  describe('emitLog - production filtering', () => {
    beforeEach(() => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
    });

    it('filters DEBUG by default in production', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'test message');

      // DEBUG should be filtered out in production by default
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('filters INFO by default in production', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('INFO', 'test message');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('sends WARN in production by default', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('WARN', 'test warning');

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          severityText: 'WARN',
          body: 'test warning',
        })
      );
    });

    it('sends ERROR in production by default', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('ERROR', 'test error');

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          severityText: 'ERROR',
          body: 'test error',
        })
      );
    });

    it('sends all levels when OTEL_SEND_ALL_LOG_LEVELS=true', () => {
      process.env.OTEL_SEND_ALL_LOG_LEVELS = 'true';
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'debug message');
      freshEmitLog('INFO', 'info message');

      expect(mockEmit).toHaveBeenCalledTimes(2);
    });
  });

  describe('emitLog - env var edge cases', () => {
    beforeEach(() => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
    });

    it('treats undefined as false', () => {
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'test');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('treats "false" string as false', () => {
      process.env.OTEL_SEND_ALL_LOG_LEVELS = 'false';
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'test');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('only "true" enables all levels', () => {
      process.env.OTEL_SEND_ALL_LOG_LEVELS = 'TRUE'; // uppercase
      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'test');

      // "TRUE" !== "true", so should be filtered
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('emitLog - development mode', () => {
    it('sends all levels in development', () => {
      setNodeEnv('development');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';
      delete process.env.OTEL_SEND_ALL_LOG_LEVELS;

      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('DEBUG', 'debug in dev');
      freshEmitLog('INFO', 'info in dev');

      expect(mockEmit).toHaveBeenCalledTimes(2);
    });
  });

  describe('emitLog - source parameter', () => {
    it('includes source attribute in log', () => {
      setNodeEnv('production');
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://mock.grafana.net';

      const { LoggerProvider } = require('@opentelemetry/sdk-logs');
      const mockEmit = jest.fn();
      LoggerProvider.mockImplementation(() => ({
        getLogger: () => ({ emit: mockEmit }),
      }));

      const { emitLog: freshEmitLog } = require('./otelLogger');
      freshEmitLog('ERROR', 'client error', {}, 'client');

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: expect.objectContaining({
            source: 'client',
          }),
        })
      );
    });
  });
});
