/**
 * @jest-environment node
 */

import { POST } from './route';
import { appendFileSync } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { createMockNextRequest } from '@/testing/utils/test-helpers';

// Mock fs module
jest.mock('fs');
const mockAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>;

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

import { RequestIdContext } from '@/lib/requestIdContext';
const mockRequestIdContextRun = RequestIdContext.run as jest.MockedFunction<typeof RequestIdContext.run>;

describe('POST /api/client-logs', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = process.env.NODE_ENV;
    // Reset mock implementation to default (no-op)
    mockAppendFileSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv });
    }
  });

  it('should reject requests in production', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production' });

    const request = createMockNextRequest({ message: 'Test log' }) as unknown as NextRequest;
    const response = await POST(request);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(403);

    const json = await response.json();
    expect(json).toEqual({ error: 'Client logging only available in development' });

    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it('should accept and log requests in development', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const logEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      message: 'Test log message',
    };

    const request = createMockNextRequest(logEntry) as unknown as NextRequest;
    const response = await POST(request);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({ success: true });

    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('client.log'),
      expect.stringContaining('"source":"client"')
    );
  });

  it('should add source field to log entry', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

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
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
    await POST(request);

    const callArg = mockAppendFileSync.mock.calls[0][1] as string;
    expect(callArg).toMatch(/\n$/);
  });

  it('should handle complex log entries', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const complexEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'error',
      message: 'Error occurred',
      stack: 'Error: Test\n  at fn (file.js:1:1)',
      context: { userId: '123', action: 'submit' },
    };

    const request = createMockNextRequest(complexEntry) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(200);

    const callArg = mockAppendFileSync.mock.calls[0][1] as string;
    const loggedData = JSON.parse(callArg.trim());

    expect(loggedData).toMatchObject({
      ...complexEntry,
      source: 'client',
    });
  });

  it('should handle file write errors', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    mockAppendFileSync.mockImplementation(() => {
      throw new Error('Disk full');
    });

    const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to write log' });
  });

  it('should handle invalid JSON in request', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const request = {
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to write log' });
  });

  it('should handle empty log entry', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const request = createMockNextRequest({}) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(200);

    const callArg = mockAppendFileSync.mock.calls[0][1] as string;
    const loggedData = JSON.parse(callArg.trim());

    expect(loggedData).toEqual({ source: 'client' });
  });

  it('should log to correct file path', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

    const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
    await POST(request);

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('client.log'),
      expect.any(String)
    );

    const filePath = mockAppendFileSync.mock.calls[0][0] as string;
    expect(filePath).toMatch(/client\.log$/);
  });

  describe('RequestIdContext', () => {
    it('should call RequestIdContext.run with provided requestId and userId', async () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

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
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development' });

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
