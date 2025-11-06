import { renderHook, act, waitFor } from '@testing-library/react';
import { useUserAuth } from './useUserAuth';
import { supabase_browser } from '@/lib/supabase';

// Mock Supabase
jest.mock('@/lib/supabase', () => ({
    supabase_browser: {
        auth: {
            getUser: jest.fn()
        }
    }
}));

const mockGetUser = supabase_browser.auth.getUser as jest.MockedFunction<typeof supabase_browser.auth.getUser>;

describe('useUserAuth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear console spies
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Initial State', () => {
        it('should initialize with null userid', () => {
            const { result } = renderHook(() => useUserAuth());

            expect(result.current.userid).toBeNull();
        });

        it('should expose fetchUserid function', () => {
            const { result } = renderHook(() => useUserAuth());

            expect(typeof result.current.fetchUserid).toBe('function');
        });
    });

    describe('fetchUserid - Success Cases', () => {
        it('should set userid when user is authenticated', async () => {
            const mockUserId = 'test-user-123';
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: mockUserId,
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            let returnedUserId: string | null = null;
            await act(async () => {
                returnedUserId = await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe(mockUserId);
            expect(returnedUserId).toBe(mockUserId);
        });

        it('should call supabase_browser.auth.getUser', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'user-123',
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(mockGetUser).toHaveBeenCalledTimes(1);
        });

        it('should extract userid from auth response correctly', async () => {
            const specificUserId = 'specific-user-id-456';
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: specificUserId,
                        email: 'specific@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe(specificUserId);
        });

        it('should log success message when user authenticated', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'user-123',
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(consoleSpy).toHaveBeenCalledWith('[useUserAuth] User authenticated successfully:', 'user-123');
        });
    });

    describe('fetchUserid - Error Cases', () => {
        it('should keep userid as null when user is not authenticated', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            let returnedUserId: string | null = null;
            await act(async () => {
                returnedUserId = await result.current.fetchUserid();
            });

            expect(result.current.userid).toBeNull();
            expect(returnedUserId).toBeNull();
        });

        it('should keep userid as null when getUser throws error', async () => {
            const mockError = { message: 'Authentication failed', status: 401 };
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: mockError
            } as any);

            const { result } = renderHook(() => useUserAuth());

            let returnedUserId: string | null = null;
            await act(async () => {
                returnedUserId = await result.current.fetchUserid();
            });

            expect(result.current.userid).toBeNull();
            expect(returnedUserId).toBeNull();
        });

        it('should log error when getUser fails', async () => {
            const consoleSpy = jest.spyOn(console, 'error');
            const mockError = { message: 'Auth error', status: 500 };
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: mockError
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(consoleSpy).toHaveBeenCalledWith('[useUserAuth] Authentication error:', mockError);
        });

        it('should log warning when user data is missing', async () => {
            const consoleSpy = jest.spyOn(console, 'warn');
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(consoleSpy).toHaveBeenCalledWith('[useUserAuth] No user data found');
        });

        it('should handle missing user.id gracefully', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: undefined,
                        email: 'test@example.com'
                    } as any
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBeNull();
        });

        it('should handle empty user object gracefully', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {} as any
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBeNull();
        });
    });

    describe('State Persistence', () => {
        it('should retain userid across re-renders', async () => {
            const mockUserId = 'persistent-user-123';
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: mockUserId,
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result, rerender } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe(mockUserId);

            // Rerender the hook
            rerender();

            // userid should persist
            expect(result.current.userid).toBe(mockUserId);
        });

        it('should allow userid to be updated on subsequent fetchUserid calls', async () => {
            const firstUserId = 'user-1';
            const secondUserId = 'user-2';

            // First call
            mockGetUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: firstUserId,
                        email: 'user1@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe(firstUserId);

            // Second call with different user
            mockGetUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: secondUserId,
                        email: 'user2@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe(secondUserId);
        });

        it('should allow userid to be cleared on logout', async () => {
            // First, set a user
            mockGetUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: 'user-123',
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBe('user-123');

            // Then simulate logout (no user)
            mockGetUser.mockResolvedValueOnce({
                data: { user: null },
                error: null
            } as any);

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(result.current.userid).toBeNull();
        });
    });

    describe('Callback Stability', () => {
        it('should maintain stable fetchUserid reference across re-renders', () => {
            const { result, rerender } = renderHook(() => useUserAuth());

            const firstFetchUserid = result.current.fetchUserid;

            rerender();

            const secondFetchUserid = result.current.fetchUserid;

            expect(firstFetchUserid).toBe(secondFetchUserid);
        });

        it('should maintain stable fetchUserid reference even after state changes', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'user-123',
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            const originalFetchUserid = result.current.fetchUserid;

            await act(async () => {
                await result.current.fetchUserid();
            });

            const fetchUseridAfterStateChange = result.current.fetchUserid;

            expect(originalFetchUserid).toBe(fetchUseridAfterStateChange);
        });
    });

    describe('Edge Cases', () => {
        it('should handle concurrent fetchUserid calls', async () => {
            const mockUserId = 'concurrent-user-123';
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: mockUserId,
                        email: 'test@example.com',
                        aud: 'authenticated',
                        role: 'authenticated',
                        created_at: new Date().toISOString(),
                        app_metadata: {},
                        user_metadata: {}
                    }
                },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                const promises = [
                    result.current.fetchUserid(),
                    result.current.fetchUserid(),
                    result.current.fetchUserid()
                ];
                await Promise.all(promises);
            });

            expect(result.current.userid).toBe(mockUserId);
            expect(mockGetUser).toHaveBeenCalledTimes(3);
        });

        it('should handle rejected promises from getUser', async () => {
            mockGetUser.mockRejectedValue(new Error('Network error'));

            const { result } = renderHook(() => useUserAuth());

            await expect(act(async () => {
                await result.current.fetchUserid();
            })).rejects.toThrow('Network error');
        });

        it('should log fetchUserid calls', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            await act(async () => {
                await result.current.fetchUserid();
            });

            expect(consoleSpy).toHaveBeenCalledWith('[useUserAuth] fetchUserid called');
        });
    });
});
