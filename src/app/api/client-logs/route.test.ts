/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { createMockNextRequest } from '@/testing/utils/test-helpers';

// Mock fs module
jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
}));

// Mock otelLogger
jest.mock('@/lib/logging/server/otelLogger', () => ({
  emitLog: jest.fn(),
}));

// Mock server_utilities logger
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock RequestIdContext
jest.mock('@/lib/requestIdContext', () => ({
  RequestIdContext: {
    run: jest.fn((data, callback) => callback()),
    getRequestId: jest.fn(() => 'mock-request-id'),
    getUserId: jest.fn(() => 'mock-user-id'),
    getSessionId: jest.fn(() => 'mock-session-id'),
  },
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}));

describe('POST /api/client-logs', () => {
  let POST: typeof import('./route').POST;
  let mockAppendFileSync: jest.Mock;
  let mockEmitLog: jest.Mock;
  let mockRequestIdContextRun: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('in test environment (default)', () => {
    beforeEach(async () => {
      // Import fresh module
      const route = await import('./route');
      POST = route.POST;

      const fs = await import('fs');
      mockAppendFileSync = fs.appendFileSync as jest.Mock;

      const otelLogger = await import('@/lib/logging/server/otelLogger');
      mockEmitLog = otelLogger.emitLog as jest.Mock;

      const requestIdContext = await import('@/lib/requestIdContext');
      mockRequestIdContextRun = requestIdContext.RequestIdContext.run as jest.Mock;
    });

    it('should accept requests and send to OTLP', async () => {
      const logEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'error',
        message: 'Test error log',
      };

      const request = createMockNextRequest(logEntry) as unknown as NextRequest;
      const response = await POST(request);

      expect(response.constructor.name).toBe('NextResponse');
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({ success: true });

      // Should send to OTLP
      expect(mockEmitLog).toHaveBeenCalledWith(
        'error',
        'Test error log',
        expect.objectContaining({
          timestamp: '2024-01-01T00:00:00.000Z',
        }),
        'client'
      );
    });

    it('should handle complex log entries', async () => {
      const complexEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'error',
        message: 'Error occurred',
        stack: 'Error: Test\n  at fn (file.js:1:1)',
        data: { userId: '123', action: 'submit' },
      };

      const request = createMockNextRequest(complexEntry) as unknown as NextRequest;
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEmitLog).toHaveBeenCalledWith(
        'error',
        'Error occurred',
        expect.objectContaining({
          userId: '123',
          action: 'submit',
        }),
        'client'
      );
    });

    it('should handle invalid JSON in request', async () => {
      const request = {
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json).toEqual({ error: 'Failed to write log' });
    });

    it('should handle empty log entry', async () => {
      const request = createMockNextRequest({}) as unknown as NextRequest;
      const response = await POST(request);

      expect(response.status).toBe(200);
      // emitLog should be called with defaults
      expect(mockEmitLog).toHaveBeenCalledWith(
        'INFO',
        '{}',
        expect.any(Object),
        'client'
      );
    });

    it('should call emitLog with correct parameters', async () => {
      const logEntry = {
        level: 'WARN',
        message: 'Warning message',
        data: { extra: 'info' },
      };

      const request = createMockNextRequest(logEntry) as unknown as NextRequest;
      await POST(request);

      expect(mockEmitLog).toHaveBeenCalledWith(
        'WARN',
        'Warning message',
        expect.objectContaining({
          extra: 'info',
        }),
        'client'
      );
    });

    it('should succeed even if emitLog throws', async () => {
      mockEmitLog.mockImplementation(() => {
        throw new Error('OTLP failed');
      });

      const request = createMockNextRequest({ message: 'Test', level: 'error' }) as unknown as NextRequest;
      const response = await POST(request);

      // Should still succeed because error is caught
      expect(response.status).toBe(200);
    });

    describe('Batched logs', () => {
      it('should handle batched logs from remoteFlusher', async () => {
        const batchedLogs = {
          logs: [
            { level: 'info', message: 'Log 1' },
            { level: 'warn', message: 'Log 2' },
            { level: 'error', message: 'Log 3' },
          ],
        };

        const request = createMockNextRequest(batchedLogs) as unknown as NextRequest;
        const response = await POST(request);

        expect(response.status).toBe(200);

        // Should call emitLog for each log in batch
        expect(mockEmitLog).toHaveBeenCalledTimes(3);
        expect(mockEmitLog).toHaveBeenNthCalledWith(1, 'info', 'Log 1', expect.any(Object), 'client');
        expect(mockEmitLog).toHaveBeenNthCalledWith(2, 'warn', 'Log 2', expect.any(Object), 'client');
        expect(mockEmitLog).toHaveBeenNthCalledWith(3, 'error', 'Log 3', expect.any(Object), 'client');
      });
    });

    describe('RequestIdContext', () => {
      it('should call RequestIdContext.run with provided requestId and userId', async () => {
        const logEntry = {
          message: 'Test log',
          requestId: 'client-req-123',
          userId: 'user-456',
        };

        const request = createMockNextRequest(logEntry) as unknown as NextRequest;
        await POST(request);

        expect(mockRequestIdContextRun).toHaveBeenCalledTimes(1);
        expect(mockRequestIdContextRun).toHaveBeenCalledWith(
          { requestId: 'client-req-123', userId: 'user-456', sessionId: expect.any(String) },
          expect.any(Function)
        );
      });

      it('should generate UUID for missing requestId and userId', async () => {
        const logEntry = { message: 'Test log' };

        const request = createMockNextRequest(logEntry) as unknown as NextRequest;
        await POST(request);

        expect(mockRequestIdContextRun).toHaveBeenCalledTimes(1);
        expect(mockRequestIdContextRun).toHaveBeenCalledWith(
          { requestId: 'client-log-test-uuid-123', userId: 'client-log-test-uuid-123', sessionId: expect.any(String) },
          expect.any(Function)
        );
      });
    });
  });

  describe('in development environment', () => {
    beforeEach(async () => {
      // Set NODE_ENV before importing module
      const originalEnv = process.env.NODE_ENV;
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true });

      // Import fresh module with development env
      const route = await import('./route');
      POST = route.POST;

      const fs = await import('fs');
      mockAppendFileSync = fs.appendFileSync as jest.Mock;

      const otelLogger = await import('@/lib/logging/server/otelLogger');
      mockEmitLog = otelLogger.emitLog as jest.Mock;

      // Restore after module load
      Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, configurable: true });
    });

    it('should write to file in development', async () => {
      const logEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'Test log message',
      };

      const request = createMockNextRequest(logEntry) as unknown as NextRequest;
      const response = await POST(request);

      expect(response.status).toBe(200);

      // In development, should write to file
      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('client.log'),
        expect.stringContaining('"source":"client"')
      );
      // And send to OTLP
      expect(mockEmitLog).toHaveBeenCalled();
    });

    it('should add source field to log entry', async () => {
      const logEntry = { message: 'Test' };
      const request = createMockNextRequest(logEntry) as unknown as NextRequest;

      await POST(request);

      const callArg = mockAppendFileSync.mock.calls[0][1] as string;
      const loggedData = JSON.parse(callArg.trim());

      expect(loggedData).toMatchObject({
        ...logEntry,
        source: 'client',
      });
    });

    it('should append newline to log entry', async () => {
      const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
      await POST(request);

      const callArg = mockAppendFileSync.mock.calls[0][1] as string;
      expect(callArg).toMatch(/\n$/);
    });

    it('should log to correct file path', async () => {
      const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
      await POST(request);

      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('client.log'),
        expect.any(String)
      );

      const filePath = mockAppendFileSync.mock.calls[0][0] as string;
      expect(filePath).toMatch(/client\.log$/);
    });

    it('should handle batched logs writing to file', async () => {
      const batchedLogs = {
        logs: [
          { level: 'info', message: 'Log 1' },
          { level: 'warn', message: 'Log 2' },
        ],
      };

      const request = createMockNextRequest(batchedLogs) as unknown as NextRequest;
      await POST(request);

      // Should write to file for each log in batch
      expect(mockAppendFileSync).toHaveBeenCalledTimes(2);
    });
  });
});
