'use client';

import { useState, useCallback, useEffect } from 'react';
import { supabase_browser } from '@/lib/supabase';
import { clearSession, getOrCreateAnonymousSessionId } from '@/lib/sessionId';

/**
 * Custom hook for managing user authentication state
 *
 * • Manages userid state from Supabase authentication
 * • Automatically fetches user on mount
 * • Provides method to manually refresh user if needed
 * • Handles authentication errors and missing user data
 * • Returns userid for use in other components
 *
 * Used by: Results page, other pages requiring user authentication
 * Calls: supabase_browser.auth.getUser
 */
export function useUserAuth() {
    const [userid, setUserid] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    /**
     * Fetches the current user's ID from authentication
     * 
     * • Retrieves user data from Supabase authentication
     * • Handles authentication errors and missing user data
     * • Updates component state with userid
     * • Returns the userid for immediate use in other functions
     * 
     * Used by: Components needing to fetch/verify user authentication
     * Calls: supabase_browser.auth.getUser
     */
    const fetchUserid = useCallback(async (): Promise<string | null> => {
        console.log('[useUserAuth] fetchUserid called');
        const { data: userData, error: userError } = await supabase_browser.auth.getUser();

        if (userError) {
            console.error('[useUserAuth] Authentication error:', userError);
            // Clear any stale auth session when auth fails
            clearSession();
            getOrCreateAnonymousSessionId();
            setUserid(null);
            return null;
        }

        if (!userData?.user?.id) {
            console.warn('[useUserAuth] No user data found');
            // Clear any stale auth session when user is not authenticated
            // This handles the case where server-side logout occurred
            clearSession();
            getOrCreateAnonymousSessionId();
            setUserid(null);
            return null;
        }

        console.log('[useUserAuth] User authenticated successfully:', userData.user.id);
        setUserid(userData.user.id);
        return userData.user.id;
    }, []);

    // Fetch user on mount
    useEffect(() => {
        void fetchUserid()
            .catch((err) => {
                console.error('[useUserAuth] Unexpected error fetching user:', err);
            })
            .finally(() => setIsLoading(false));
    }, [fetchUserid]);

    return {
        userid,
        isLoading,
        fetchUserid
    };
}

