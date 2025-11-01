/**
 * Mock for next/headers
 * Provides mock implementation of cookies() function
 */

export const mockCookieStore = {
  getAll: jest.fn(() => []),
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
};

export const cookies = jest.fn(() => Promise.resolve(mockCookieStore));
