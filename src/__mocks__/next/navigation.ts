/**
 * Mock for next/navigation
 * Provides mock implementation of navigation functions
 */

export const mockRedirectCalls: Array<{ url: string; type?: 'replace' | 'push' }> = [];

/**
 * Mock redirect function that throws (mimicking Next.js behavior)
 * In Next.js, redirect() throws a special error to stop execution
 */
export const redirect = jest.fn((url: string, type?: 'replace' | 'push') => {
  mockRedirectCalls.push({ url, type });
  throw new Error(`NEXT_REDIRECT: ${url}`);
});

/**
 * Mock unstable_rethrow function that re-throws redirect errors
 * In Next.js, this function checks if the error is a redirect/notFound and re-throws it
 */
export const unstable_rethrow = jest.fn((error: unknown) => {
  if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
    throw error;
  }
  // For non-redirect errors, do nothing (let the catch block handle it)
});

/**
 * Client-side hooks for component testing
 */
export const useRouter = jest.fn(() => ({
  push: jest.fn(),
  replace: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
}));

export const usePathname = jest.fn(() => '/test');

export const useSearchParams = jest.fn(() => new URLSearchParams());

export const useParams = jest.fn(() => ({}));

/**
 * Helper to clear redirect tracking between tests
 */
export function clearRedirectCalls() {
  mockRedirectCalls.length = 0;
  redirect.mockClear();
}
