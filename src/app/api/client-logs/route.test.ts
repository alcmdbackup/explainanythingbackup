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

describe('POST /api/client-logs', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = process.env.NODE_ENV;
    // Reset mock implementation to default (no-op)
    mockAppendFileSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should reject requests in production', async () => {
    process.env.NODE_ENV = 'production';

    const request = createMockNextRequest({ message: 'Test log' }) as unknown as NextRequest;
    const response = await POST(request);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(403);

    const json = await response.json();
    expect(json).toEqual({ error: 'Client logging only available in development' });

    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it('should accept and log requests in development', async () => {
    process.env.NODE_ENV = 'development';

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
    process.env.NODE_ENV = 'development';

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
    process.env.NODE_ENV = 'development';

    const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
    await POST(request);

    const callArg = mockAppendFileSync.mock.calls[0][1] as string;
    expect(callArg).toMatch(/\n$/);
  });

  it('should handle complex log entries', async () => {
    process.env.NODE_ENV = 'development';

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
    process.env.NODE_ENV = 'development';

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
    process.env.NODE_ENV = 'development';

    const request = {
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to write log' });
  });

  it('should handle empty log entry', async () => {
    process.env.NODE_ENV = 'development';

    const request = createMockNextRequest({}) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(200);

    const callArg = mockAppendFileSync.mock.calls[0][1] as string;
    const loggedData = JSON.parse(callArg.trim());

    expect(loggedData).toEqual({ source: 'client' });
  });

  it('should log to correct file path', async () => {
    process.env.NODE_ENV = 'development';

    const request = createMockNextRequest({ message: 'Test' }) as unknown as NextRequest;
    await POST(request);

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('client.log'),
      expect.any(String)
    );

    const filePath = mockAppendFileSync.mock.calls[0][0] as string;
    expect(filePath).toMatch(/client\.log$/);
  });
});
