'use client';

import { useState, useCallback } from 'react';
import { supabase_browser } from '@/lib/supabase';

/**
 * Custom hook for managing user authentication state
 *
 * • Manages userid state from Supabase authentication
 * • Provides method to fetch current authenticated user
 * • Handles authentication errors and missing user data
 * • Returns userid for use in other components
 *
 * Used by: Results page, other pages requiring user authentication
 * Calls: supabase_browser.auth.getUser
 */
export function useUserAuth() {
    const [userid, setUserid] = useState<string | null>(null);

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
            setUserid(null);
            return null;
        }
        
        if (!userData?.user?.id) {
            console.warn('[useUserAuth] No user data found');
            setUserid(null);
            return null;
        }

        console.log('[useUserAuth] User authenticated successfully:', userData.user.id);
        setUserid(userData.user.id);
        return userData.user.id;
    }, []);

    return {
        userid,
        fetchUserid
    };
}

