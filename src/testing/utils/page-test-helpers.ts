/**
 * Test utilities for page component testing
 * Provides mock factories for Next.js hooks, custom hooks, and common page dependencies
 */

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/**
 * Creates a mock Next.js router for testing
 */
export const createMockRouter = (overrides: Partial<AppRouterInstance> = {}): AppRouterInstance => {
  return {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    ...overrides,
  } as AppRouterInstance;
};

/**
 * Creates a mock URLSearchParams for testing search parameters
 */
export const createMockSearchParams = (params: Record<string, string> = {}): URLSearchParams => {
  return new URLSearchParams(params);
};

/**
 * Creates a mock Lexical editor ref with all required methods
 */
export const createMockLexicalEditorRef = (overrides = {}) => {
  return {
    current: {
      getContentAsMarkdown: jest.fn(() => ''),
      setContentFromMarkdown: jest.fn(),
      setEditMode: jest.fn(),
      focus: jest.fn(),
      ...overrides,
    },
  };
};

/**
 * Creates a mock return value for useExplanationLoader hook
 */
export const createMockUseExplanationLoader = (overrides = {}) => {
  return {
    explanationId: null,
    explanationTitle: '',
    content: '',
    explanationStatus: null,
    explanationVector: null,
    systemSavedId: null,
    userSaved: false,
    isLoading: false,
    error: null,
    setExplanationTitle: jest.fn(),
    setContent: jest.fn(),
    setExplanationStatus: jest.fn(),
    setExplanationVector: jest.fn(),
    setUserSaved: jest.fn(),
    setError: jest.fn(),
    loadExplanation: jest.fn(),
    clearSystemSavedId: jest.fn(),
    ...overrides,
  };
};

/**
 * Creates a mock return value for useUserAuth hook
 */
export const createMockUseUserAuth = (overrides = {}) => {
  return {
    userid: 'test-user-123',
    fetchUserid: jest.fn(),
    ...overrides,
  };
};

/**
 * Creates a mock streaming response for testing SSE/streaming endpoints
 */
export const createMockStreamingResponse = (events: any[]): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      events.forEach((event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

/**
 * Creates a mock Supabase auth response
 */
export const createMockSupabaseAuthResponse = (overrides = {}) => {
  return {
    data: {
      user: {
        id: 'test-user-123',
        email: 'test@example.com',
        ...overrides,
      },
    },
    error: null,
  };
};

/**
 * Creates a mock Supabase auth error response
 */
export const createMockSupabaseAuthError = (message = 'Authentication failed') => {
  return {
    data: { user: null },
    error: { message },
  };
};
