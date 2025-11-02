/**
 * Test utilities for Phase 9: Authentication & Middleware Testing
 * Provides helper functions for creating test data and assertions
 */

import { NextRequest, NextResponse } from '@/__mocks__/next/server';

/**
 * FormData Test Helpers
 */

export function createMockFormData(data: Record<string, string>): FormData {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    formData.append(key, value);
  });
  return formData;
}

export function createFormDataWithMissingField(
  data: Record<string, string>,
  missingField: string
): FormData {
  const filtered = Object.entries(data).filter(([key]) => key !== missingField);
  const formData = new FormData();
  filtered.forEach(([key, value]) => {
    formData.append(key, value);
  });
  return formData;
}

/**
 * Cookie Test Helpers
 */

export interface MockCookie {
  name: string;
  value: string;
}

export function createMockCookies(cookies: Record<string, string>): MockCookie[] {
  return Object.entries(cookies).map(([name, value]) => ({ name, value }));
}

export function createCookieGetAllMock(cookies: Record<string, string>) {
  return jest.fn(() => createMockCookies(cookies));
}

export function createCookieSetAllMock() {
  const setCalls: Array<{ name: string; value: string; options: any }> = [];

  return {
    mock: jest.fn((cookieArray: Array<{ name: string; value: string; options?: any }>) => {
      cookieArray.forEach(cookie => {
        setCalls.push({
          name: cookie.name,
          value: cookie.value,
          options: cookie.options,
        });
      });
    }),
    getCalls: () => setCalls,
    clear: () => { setCalls.length = 0; },
  };
}

/**
 * URL and Request Test Helpers
 */

export function createMockRequestWithParams(
  baseUrl: string,
  params: Record<string, string>,
  options?: {
    method?: string;
    cookies?: MockCookie[];
    headers?: Record<string, string>;
  }
): Request {
  const url = new URL(baseUrl, 'http://localhost:3000');
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url.toString(), {
    method: options?.method || 'GET',
    cookies: options?.cookies,
    headers: options?.headers,
  }) as unknown as Request;
}

export function createMockNextRequest(
  url: string,
  options?: {
    method?: string;
    cookies?: MockCookie[];
    headers?: Record<string, string>;
  }
): NextRequest {
  return new NextRequest(url, {
    method: options?.method || 'GET',
    cookies: options?.cookies,
    headers: options?.headers,
  });
}

/**
 * Redirect Test Helpers
 */

export function expectRedirectTo(url: string, response?: NextResponse) {
  if (response) {
    expect(response.headers.get('Location')).toBe(url);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  }
}

export function expectRedirectThrown(fn: () => void | Promise<void>, expectedUrl?: string) {
  if (expectedUrl) {
    expect(fn).toThrow(`NEXT_REDIRECT: ${expectedUrl}`);
  } else {
    expect(fn).toThrow(/NEXT_REDIRECT/);
  }
}

export async function expectAsyncRedirectThrown(
  fn: () => Promise<void>,
  expectedUrl?: string
) {
  try {
    await fn();
    throw new Error('Expected redirect to be thrown');
  } catch (error: any) {
    if (expectedUrl) {
      expect(error.message).toBe(`NEXT_REDIRECT: ${expectedUrl}`);
    } else {
      expect(error.message).toMatch(/NEXT_REDIRECT/);
    }
  }
}

/**
 * Redirect Validation Helpers
 */

export const MALICIOUS_URLS = {
  externalHttp: 'http://evil.com',
  externalHttps: 'https://evil.com',
  protocolRelative: '//evil.com',
  javascriptProtocol: 'javascript:alert(1)',
  dataProtocol: 'data:text/html,<script>alert(1)</script>',
  fileProtocol: 'file:///etc/passwd',
};

export function isRelativeUrl(url: string): boolean {
  try {
    new URL(url);
    return false;
  } catch {
    return url.startsWith('/');
  }
}

export function isSafeRedirect(url: string, allowedOrigin: string = 'http://localhost:3000'): boolean {
  // Relative URLs are safe
  if (isRelativeUrl(url)) {
    return true;
  }

  // Check if URL matches allowed origin
  try {
    const urlObj = new URL(url);
    const allowedObj = new URL(allowedOrigin);
    return urlObj.origin === allowedObj.origin;
  } catch {
    return false;
  }
}

/**
 * Supabase Error Helpers
 */

export function createSupabaseError(message: string, status: number = 400) {
  return {
    data: null,
    error: {
      message,
      status,
      name: 'AuthError',
    },
  };
}

export function createSupabaseAuthError(type: 'invalid_credentials' | 'user_not_found' | 'invalid_grant' | 'weak_password' | 'email_exists') {
  const messages = {
    invalid_credentials: 'Invalid login credentials',
    user_not_found: 'User not found',
    invalid_grant: 'Invalid grant',
    weak_password: 'Password should be at least 6 characters',
    email_exists: 'User already registered',
  };

  return createSupabaseError(messages[type], 400);
}

/**
 * Session Test Helpers
 */

export function createMockSession(overrides?: {
  userId?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
}) {
  return {
    access_token: overrides?.accessToken || 'test-access-token',
    refresh_token: overrides?.refreshToken || 'test-refresh-token',
    expires_at: Date.now() + 3600000,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: overrides?.userId || 'test-user-id',
      email: overrides?.email || 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export function createMockUser(overrides?: {
  userId?: string;
  email?: string;
}) {
  return {
    id: overrides?.userId || 'test-user-id',
    email: overrides?.email || 'test@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Console Error Spy Helpers
 */

export function createConsoleErrorSpy() {
  const originalError = console.error;
  const errorCalls: any[][] = [];

  const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    errorCalls.push(args);
  });

  return {
    spy,
    getCalls: () => errorCalls,
    restore: () => {
      spy.mockRestore();
      console.error = originalError;
    },
  };
}

/**
 * Mock Reset Helpers
 */

export function clearAllMocks() {
  jest.clearAllMocks();
}

/**
 * Assertion Helpers
 */

export function expectNoErrorsLogged(consoleErrorSpy: jest.SpyInstance) {
  expect(consoleErrorSpy).not.toHaveBeenCalled();
}

export function expectErrorLogged(consoleErrorSpy: jest.SpyInstance, messagePattern?: string | RegExp) {
  expect(consoleErrorSpy).toHaveBeenCalled();

  if (messagePattern) {
    const calls = consoleErrorSpy.mock.calls;
    const hasMatchingCall = calls.some((call) => {
      const firstArg = call[0];
      if (typeof messagePattern === 'string') {
        return firstArg.includes(messagePattern);
      } else {
        return messagePattern.test(firstArg);
      }
    });
    expect(hasMatchingCall).toBe(true);
  }
}
