 

import { act, renderHook, waitFor } from '@testing-library/react';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useClientPassRequestId, useAuthenticatedRequestId } from './clientPassRequestId';

// Mock RequestIdContext
jest.mock('@/lib/requestIdContext', () => ({
  RequestIdContext: {
    setClient: jest.fn(),
    getRequestId: jest.fn(),
  },
}));

// Mock sessionId functions
const mockClearSession = jest.fn();
const mockGetOrCreateAnonymousSessionId = jest.fn(() => 'sess-test-anonymous');
const mockHandleAuthTransition = jest.fn(async () => ({ sessionId: 'auth-test-hash' }));

jest.mock('@/lib/sessionId', () => ({
  clearSession: () => mockClearSession(),
  getOrCreateAnonymousSessionId: () => mockGetOrCreateAnonymousSessionId(),
  handleAuthTransition: (userId: string) => mockHandleAuthTransition(userId),
}));

// Mock Supabase browser client
const mockGetUser = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase_browser: {
    auth: {
      getUser: () => mockGetUser(),
      onAuthStateChange: (callback: (event: string, session: { user?: { id: string } } | null) => void) => {
        mockOnAuthStateChange(callback);
        return {
          data: {
            subscription: {
              unsubscribe: mockUnsubscribe,
            },
          },
        };
      },
    },
  },
}));

describe('clientPassRequestId', () => {
  let mockSetClient: jest.Mock;
  let originalDateNow: () => number;
  let originalMathRandom: () => number;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetClient = RequestIdContext.setClient as jest.Mock;

    // Save originals
    originalDateNow = Date.now;
    originalMathRandom = Math.random;
  });

  afterEach(() => {
    // Restore originals
    Date.now = originalDateNow;
    Math.random = originalMathRandom;
  });

  describe('Basic Functionality', () => {
    it('should return an object with withRequestId function', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      expect(result.current).toHaveProperty('withRequestId');
      expect(typeof result.current.withRequestId).toBe('function');
    });

    it('should use default userId "anonymous" when not provided', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      result.current.withRequestId();

      expect(mockSetClient).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'anonymous' })
      );
    });

    it('should use custom userId when provided', () => {
      const customUserId = 'user-12345';
      const { result } = renderHook(() => useClientPassRequestId(customUserId));

      result.current.withRequestId();

      expect(mockSetClient).toHaveBeenCalledWith(
        expect.objectContaining({ userId: customUserId })
      );
    });
  });

  describe('Request ID Generation', () => {
    it('should generate requestId in format client-{timestamp}-{random}', () => {
      // Mock Date.now for predictable timestamp
      const fixedTimestamp = 1234567890000;
      Date.now = jest.fn(() => fixedTimestamp);

      const { result } = renderHook(() => useClientPassRequestId());
      const data = result.current.withRequestId();

      // Verify format: client-{timestamp}-{6 alphanumeric chars}
      expect(data.__requestId.requestId).toMatch(/^client-\d+-[a-z0-9]{6}$/);
      expect(data.__requestId.requestId).toContain(`client-${fixedTimestamp}-`);

      // Verify random component is 6 characters
      const parts = data.__requestId.requestId.split('-');
      expect(parts[0]).toBe('client');
      expect(parts[1]).toBe(fixedTimestamp.toString());
      expect(parts[2]).toHaveLength(6);
    });

    it('should generate unique requestId for each call', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const data1 = result.current.withRequestId();
      const data2 = result.current.withRequestId();
      const data3 = result.current.withRequestId();

      expect(data1.__requestId.requestId).not.toBe(data2.__requestId.requestId);
      expect(data2.__requestId.requestId).not.toBe(data3.__requestId.requestId);
      expect(data1.__requestId.requestId).not.toBe(data3.__requestId.requestId);
    });

    it('should generate different IDs even with same timestamp', () => {
      // Fix timestamp but allow random to vary
      const fixedTimestamp = 1234567890000;
      Date.now = jest.fn(() => fixedTimestamp);

      const { result } = renderHook(() => useClientPassRequestId());

      const data1 = result.current.withRequestId();
      const data2 = result.current.withRequestId();

      // Same timestamp but different random component
      expect(data1.__requestId.requestId).toMatch(/^client-1234567890000-[a-z0-9]{6}$/);
      expect(data2.__requestId.requestId).toMatch(/^client-1234567890000-[a-z0-9]{6}$/);
      expect(data1.__requestId.requestId).not.toBe(data2.__requestId.requestId);
    });
  });

  describe('RequestIdContext Integration', () => {
    it('should call RequestIdContext.setClient with requestId and userId', () => {
      const userId = 'test-user';
      const { result } = renderHook(() => useClientPassRequestId(userId));

      result.current.withRequestId();

      expect(mockSetClient).toHaveBeenCalledTimes(1);
      expect(mockSetClient).toHaveBeenCalledWith({
        requestId: expect.stringMatching(/^client-\d+-[a-z0-9]{6}$/),
        userId: userId,
        sessionId: expect.any(String),
      });
    });

    it('should call setClient on every withRequestId call', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      result.current.withRequestId();
      result.current.withRequestId();
      result.current.withRequestId();

      expect(mockSetClient).toHaveBeenCalledTimes(3);
    });

    it('should call setClient with different requestIds each time', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      result.current.withRequestId();
      result.current.withRequestId();

      const call1Args = mockSetClient.mock.calls[0][0];
      const call2Args = mockSetClient.mock.calls[1][0];

      expect(call1Args.requestId).not.toBe(call2Args.requestId);
    });
  });

  describe('Data Merging', () => {
    it('should attach __requestId to empty data object', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const data = result.current.withRequestId({});

      expect(data).toHaveProperty('__requestId');
      expect(data.__requestId).toEqual({
        requestId: expect.stringMatching(/^client-\d+-[a-z0-9]{6}$/),
        userId: 'anonymous',
        sessionId: expect.any(String),
      });
    });

    it('should attach __requestId when no data provided', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const data = result.current.withRequestId();

      expect(data).toHaveProperty('__requestId');
      expect(data.__requestId).toEqual({
        requestId: expect.stringMatching(/^client-\d+-[a-z0-9]{6}$/),
        userId: 'anonymous',
        sessionId: expect.any(String),
      });
    });

    it('should preserve existing properties in data object', () => {
      const { result } = renderHook(() => useClientPassRequestId('user-123'));

      const originalData = {
        name: 'Test',
        value: 42,
        nested: { foo: 'bar' },
      };

      const data = result.current.withRequestId(originalData);

      expect(data).toEqual({
        name: 'Test',
        value: 42,
        nested: { foo: 'bar' },
        __requestId: {
          requestId: expect.stringMatching(/^client-\d+-[a-z0-9]{6}$/),
          userId: 'user-123',
          sessionId: expect.any(String),
        },
      });
    });

    it('should not mutate original data object', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const originalData = { foo: 'bar' };
      const returnedData = result.current.withRequestId(originalData);

      expect(originalData).not.toHaveProperty('__requestId');
      expect(returnedData).toHaveProperty('__requestId');
      expect(originalData).not.toBe(returnedData);
    });

    it('should overwrite existing __requestId if present', () => {
      const { result } = renderHook(() => useClientPassRequestId('new-user'));

      const dataWithOldId = {
        foo: 'bar',
        __requestId: { requestId: 'old-id', userId: 'old-user' },
      };

      const data = result.current.withRequestId(dataWithOldId as any);

      expect(data.__requestId.requestId).toMatch(/^client-\d+-[a-z0-9]{6}$/);
      expect(data.__requestId.requestId).not.toBe('old-id');
      expect(data.__requestId.userId).toBe('new-user');
    });
  });

  describe('Function Stability (useCallback)', () => {
    it('should return stable withRequestId reference when userId unchanged', () => {
      const { result, rerender } = renderHook(() => useClientPassRequestId('user-123'));

      const firstReference = result.current.withRequestId;

      rerender();

      const secondReference = result.current.withRequestId;

      expect(firstReference).toBe(secondReference);
    });

    it('should return new withRequestId reference when userId changes', () => {
      const { result, rerender } = renderHook(
        ({ userId }) => useClientPassRequestId(userId),
        { initialProps: { userId: 'user-1' } }
      );

      const firstReference = result.current.withRequestId;

      rerender({ userId: 'user-2' });

      const secondReference = result.current.withRequestId;

      expect(firstReference).not.toBe(secondReference);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined userId gracefully', () => {
      const { result } = renderHook(() => useClientPassRequestId(undefined));

      const data = result.current.withRequestId();

      expect(data.__requestId.userId).toBe('anonymous');
    });

    it('should handle empty string userId', () => {
      const { result } = renderHook(() => useClientPassRequestId(''));

      const data = result.current.withRequestId();

      expect(data.__requestId.userId).toBe('');
      expect(mockSetClient).toHaveBeenCalledWith(
        expect.objectContaining({ userId: '' })
      );
    });

    it('should handle special characters in userId', () => {
      const specialUserId = 'user@example.com!#$%';
      const { result } = renderHook(() => useClientPassRequestId(specialUserId));

      const data = result.current.withRequestId();

      expect(data.__requestId.userId).toBe(specialUserId);
    });

    it('should handle complex nested data structures', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const complexData = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
        array: [1, 2, { nested: true }],
        null: null,
        undefined: undefined,
      };

      const data = result.current.withRequestId(complexData);

      expect(data.level1.level2.level3.value).toBe('deep');
      expect(data.array).toEqual([1, 2, { nested: true }]);
      expect(data.__requestId).toBeDefined();
    });

    it('should handle data with function properties', () => {
      const { result } = renderHook(() => useClientPassRequestId());

      const callback = jest.fn();
      const dataWithFunction = {
        onClick: callback,
        value: 123,
      };

      const data = result.current.withRequestId(dataWithFunction as any);

      expect(data.onClick).toBe(callback);
      expect(data.value).toBe(123);
      expect(data.__requestId).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('should return correct __requestId structure', () => {
      const { result } = renderHook(() => useClientPassRequestId('user-123'));

      const data = result.current.withRequestId({ foo: 'bar' });

      expect(data.__requestId).toHaveProperty('requestId');
      expect(data.__requestId).toHaveProperty('userId');
      expect(typeof data.__requestId.requestId).toBe('string');
      expect(typeof data.__requestId.userId).toBe('string');
    });
  });

  describe('Multiple Hook Instances', () => {
    it('should work correctly with multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useClientPassRequestId('user-1'));
      const { result: result2 } = renderHook(() => useClientPassRequestId('user-2'));

      const data1 = result1.current.withRequestId({ source: 'hook1' });
      const data2 = result2.current.withRequestId({ source: 'hook2' });

      expect(data1.__requestId.userId).toBe('user-1');
      expect(data2.__requestId.userId).toBe('user-2');
      expect(data1.__requestId.requestId).not.toBe(data2.__requestId.requestId);
      expect(data1.source).toBe('hook1');
      expect(data2.source).toBe('hook2');
    });
  });
});

describe('useAuthenticatedRequestId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  describe('Logout Session Handling (Bug Fix)', () => {
    it('should call clearSession when user is not authenticated on mount', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
      });
    });

    it('should set userId to anonymous when user is not authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
        expect(mockGetOrCreateAnonymousSessionId).toHaveBeenCalled();
      });
    });

    it('should NOT call clearSession when user IS authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });

      renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockHandleAuthTransition).toHaveBeenCalledWith('user-123');
      });

      expect(mockClearSession).not.toHaveBeenCalled();
    });

    it('should call clearSession on SIGNED_OUT event', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
      let authCallback: (event: string, session: { user?: { id: string } } | null) => void;
      mockOnAuthStateChange.mockImplementation((cb) => {
        authCallback = cb;
      });

      renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockHandleAuthTransition).toHaveBeenCalled();
      });

      mockClearSession.mockClear();

      // Simulate logout event
      act(() => {
        authCallback('SIGNED_OUT', null);
      });

      expect(mockClearSession).toHaveBeenCalled();
      expect(mockGetOrCreateAnonymousSessionId).toHaveBeenCalled();
    });

    it('should handle auth transition on SIGNED_IN event', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      let authCallback: (event: string, session: { user?: { id: string } } | null) => void;
      mockOnAuthStateChange.mockImplementation((cb) => {
        authCallback = cb;
      });

      renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
      });

      mockHandleAuthTransition.mockClear();

      // Simulate login event
      await act(async () => {
        authCallback('SIGNED_IN', { user: { id: 'new-user-456' } });
      });

      await waitFor(() => {
        expect(mockHandleAuthTransition).toHaveBeenCalledWith('new-user-456');
      });
    });

    it('should unsubscribe from auth state changes on unmount', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const { unmount } = renderHook(() => useAuthenticatedRequestId());

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
