/**
 * Mock for next/cache
 * Provides mock implementation of cache revalidation functions
 */

export const mockRevalidatePathCalls: Array<{ path: string; type?: 'layout' | 'page' }> = [];
export const mockRevalidateTagCalls: string[] = [];

/**
 * Mock revalidatePath function
 * Tracks calls for assertion in tests
 */
export const revalidatePath = jest.fn((path: string, type?: 'layout' | 'page') => {
  mockRevalidatePathCalls.push({ path, type });
});

/**
 * Mock revalidateTag function
 * Tracks calls for assertion in tests
 */
export const revalidateTag = jest.fn((tag: string) => {
  mockRevalidateTagCalls.push(tag);
});

/**
 * Helper to clear tracking between tests
 */
export function clearCacheCalls() {
  mockRevalidatePathCalls.length = 0;
  mockRevalidateTagCalls.length = 0;
  revalidatePath.mockClear();
  revalidateTag.mockClear();
}
