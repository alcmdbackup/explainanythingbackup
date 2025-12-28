/**
 * @jest-environment node
 */

import { POST } from './route';
import { NextRequest } from 'next/server';
import { createMockNextRequest, collectStreamData, parseSSEMessages } from '@/testing/utils/test-helpers';

// Mock dependencies
jest.mock('@/lib/services/llms', () => ({
  callOpenAIModel: jest.fn(),
  default_model: 'gpt-4.1-mini',
}));

jest.mock('@/lib/requestIdContext', () => ({
  RequestIdContext: {
    run: jest.fn((data, callback) => callback()),
  },
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}));

jest.mock('@/lib/utils/supabase/validateApiAuth', () => ({
  validateApiAuth: jest.fn(() => Promise.resolve({
    data: { userId: 'user123', sessionId: 'test-session' },
    error: null
  })),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { callOpenAIModel } from '@/lib/services/llms';
import { RequestIdContext } from '@/lib/requestIdContext';

const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;
const mockRequestIdContextRun = RequestIdContext.run as jest.MockedFunction<typeof RequestIdContext.run>;

describe('POST /api/stream-chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: context run calls the callback immediately
    mockRequestIdContextRun.mockImplementation((data, callback) => callback());
  });

  it('should reject requests with missing prompt', async () => {
    // Use userid matching the mocked auth userId to avoid mismatch error
    const request = createMockNextRequest({ userid: 'user123' }) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toBe('Missing prompt');
  });

  it('should reject requests when not authenticated', async () => {
    // Mock auth to fail
    const { validateApiAuth } = require('@/lib/utils/supabase/validateApiAuth');
    validateApiAuth.mockResolvedValueOnce({ data: null, error: 'User not authenticated' });

    const request = createMockNextRequest({ prompt: 'Test prompt' }) as unknown as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Authentication required');
    expect(json.redirectTo).toBe('/login');
  });

  it('should handle requests with both prompt and userid', async () => {
    mockCallOpenAIModel.mockImplementation(async (prompt, context, userid, model, streaming, onStream) => {
      if (onStream) {
        onStream('Hello');
        onStream('Hello World');
      }
      return 'Hello World';
    });

    const request = createMockNextRequest({
      prompt: 'Test prompt',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('should call callOpenAIModel with correct parameters', async () => {
    mockCallOpenAIModel.mockResolvedValue('Response');

    const request = createMockNextRequest({
      prompt: 'Test prompt',
      userid: 'user123',
    }) as unknown as NextRequest;

    await POST(request);

    expect(mockCallOpenAIModel).toHaveBeenCalledWith(
      'Test prompt',
      'stream-chat-api',
      'user123',
      'gpt-4.1-mini',
      true,
      expect.any(Function),
      null,
      null
    );
  });

  it('should stream incremental updates', async () => {
    mockCallOpenAIModel.mockImplementation(async (prompt, context, userid, model, streaming, onStream) => {
      if (onStream) {
        onStream('Hello');
        onStream('Hello World');
        onStream('Hello World!');
      }
      return 'Hello World!';
    });

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const stream = response.body as ReadableStream;
    const chunks = await collectStreamData(stream);
    const messages = parseSSEMessages(chunks);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatchObject({ text: 'Hello', isComplete: false });
    expect(messages[1]).toMatchObject({ text: 'Hello World', isComplete: false });
    expect(messages[2]).toMatchObject({ text: 'Hello World!', isComplete: false });
  });

  it('should send completion signal', async () => {
    mockCallOpenAIModel.mockImplementation(async (prompt, context, userid, model, streaming, onStream) => {
      if (onStream) {
        onStream('Final');
      }
      return 'Final';
    });

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const stream = response.body as ReadableStream;
    const chunks = await collectStreamData(stream);
    const messages = parseSSEMessages(chunks);

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage).toMatchObject({ text: 'Final', isComplete: true });
  });

  it('should handle streaming errors', async () => {
    mockCallOpenAIModel.mockRejectedValue(new Error('API Error'));

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const stream = response.body as ReadableStream;
    const chunks = await collectStreamData(stream);
    const messages = parseSSEMessages(chunks);

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage).toMatchObject({
      error: 'API Error',
      isComplete: true,
    });
  });

  it('should use RequestIdContext with provided request ID and verified userId from auth', async () => {
    mockCallOpenAIModel.mockResolvedValue('Response');

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
      __requestId: { requestId: 'custom-id', userId: 'user123', sessionId: 'client-session' },
    }) as unknown as NextRequest;

    await POST(request);

    // Now uses verifiedUserId from auth (user123) and sessionId from auth result (test-session)
    expect(mockRequestIdContextRun).toHaveBeenCalledWith(
      { requestId: 'custom-id', userId: 'user123', sessionId: 'test-session' },
      expect.any(Function)
    );
  });

  it('should create fallback request ID when not provided', async () => {
    mockCallOpenAIModel.mockResolvedValue('Response');

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    await POST(request);

    // Now uses verifiedUserId from auth (user123) and sessionId from auth result (test-session)
    expect(mockRequestIdContextRun).toHaveBeenCalledWith(
      { requestId: 'api-test-uuid-123', userId: 'user123', sessionId: 'test-session' },
      expect.any(Function)
    );
  });

  it('should handle empty prompt string', async () => {
    const request = createMockNextRequest({
      prompt: '',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('should handle JSON parsing errors', async () => {
    const request = {
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe('Internal Server Error');
  });

  it('should format SSE messages correctly', async () => {
    mockCallOpenAIModel.mockImplementation(async (prompt, context, userid, model, streaming, onStream) => {
      if (onStream) {
        onStream('Test message');
      }
      return 'Test message';
    });

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const stream = response.body as ReadableStream;
    const chunks = await collectStreamData(stream);
    const fullText = chunks.join('');

    expect(fullText).toContain('data: ');
    expect(fullText).toMatch(/data: \{"text":"Test message","isComplete":false\}\n\n/);
  });

  it('should handle long streaming responses', async () => {
    mockCallOpenAIModel.mockImplementation(async (prompt, context, userid, model, streaming, onStream) => {
      if (onStream) {
        for (let i = 1; i <= 10; i++) {
          onStream(`Chunk ${i}`);
        }
      }
      return 'Chunk 10';
    });

    const request = createMockNextRequest({
      prompt: 'Test',
      userid: 'user123',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const stream = response.body as ReadableStream;
    const chunks = await collectStreamData(stream);
    const messages = parseSSEMessages(chunks);

    expect(messages.length).toBe(11); // 10 updates + 1 completion
    expect(messages[0]).toMatchObject({ text: 'Chunk 1', isComplete: false });
    expect(messages[9]).toMatchObject({ text: 'Chunk 10', isComplete: false });
    expect(messages[10]).toMatchObject({ text: 'Chunk 10', isComplete: true });
  });
});
