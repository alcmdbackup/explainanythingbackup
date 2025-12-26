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
        it('should initialize with null userid and isLoading true', () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            expect(result.current.userid).toBeNull();
            expect(result.current.isLoading).toBe(true);
        });

        it('should expose fetchUserid function and isLoading state', () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            expect(typeof result.current.fetchUserid).toBe('function');
            expect(typeof result.current.isLoading).toBe('boolean');
        });

        it('should automatically fetch user on mount', async () => {
            const mockUserId = 'auto-fetched-user';
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

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.userid).toBe(mockUserId);
            expect(mockGetUser).toHaveBeenCalledTimes(1);
        });

        it('should set isLoading to false after fetch completes', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            expect(result.current.isLoading).toBe(true);

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });
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

        it('should call supabase_browser.auth.getUser on manual fetch', async () => {
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

            // Wait for auto-fetch on mount
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            // Call again manually
            await act(async () => {
                await result.current.fetchUserid();
            });

            // Called twice: once on mount, once manually
            expect(mockGetUser).toHaveBeenCalledTimes(2);
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

            // First mock for auto-fetch on mount
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

            // Wait for auto-fetch on mount
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
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
            // First, set a user (this mock is consumed by auto-fetch on mount)
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

            // Wait for auto-fetch on mount to complete
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
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
        it('should maintain stable fetchUserid reference across re-renders', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null
            } as any);

            const { result, rerender } = renderHook(() => useUserAuth());

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

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

            // Wait for auto-fetch on mount
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                const promises = [
                    result.current.fetchUserid(),
                    result.current.fetchUserid(),
                    result.current.fetchUserid()
                ];
                await Promise.all(promises);
            });

            expect(result.current.userid).toBe(mockUserId);
            // 1 from mount + 3 concurrent = 4
            expect(mockGetUser).toHaveBeenCalledTimes(4);
        });

        it('should handle rejected promises from manual getUser call', async () => {
            // First mock for auto-fetch on mount (success)
            mockGetUser.mockResolvedValueOnce({
                data: { user: null },
                error: null
            } as any);

            const { result } = renderHook(() => useUserAuth());

            // Wait for mount to complete
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            // Then mock rejection for manual call
            mockGetUser.mockRejectedValueOnce(new Error('Network error'));

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

            // Wait for mount
            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            // fetchUserid is called on mount, so check that it was logged
            expect(consoleSpy).toHaveBeenCalledWith('[useUserAuth] fetchUserid called');
        });
    });
});
