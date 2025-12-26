/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
'use client';
import { RequestIdContext } from '@/lib/requestIdContext';
import { clearSession, getOrCreateAnonymousSessionId, handleAuthTransition } from '@/lib/sessionId';
import { supabase_browser } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

/**
 * Base hook for passing request ID context to server actions.
 *
 * @param userId - User ID (defaults to 'anonymous')
 * @param sessionId - Session ID (optional, defaults to anonymous session)
 */
export function useClientPassRequestId(userId = 'anonymous', sessionId?: string) {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withRequestId = useCallback(<T extends Record<string, any> = {}>(data?: T) => {
    const requestId = generateRequestId(); // New ID for each action!
    const effectiveSessionId = sessionId ?? getOrCreateAnonymousSessionId();

    // Set client requestId context persistently
    RequestIdContext.setClient({ requestId, userId, sessionId: effectiveSessionId });

    return {
      ...(data || {} as T),
      __requestId: { requestId, userId, sessionId: effectiveSessionId }
    } as T & { __requestId: { requestId: string; userId: string; sessionId: string } };
  }, [userId, sessionId, generateRequestId]);

  return { withRequestId };
}

/**
 * Hook that auto-fetches the authenticated user ID for request tracking
 *
 * • Automatically fetches user ID from Supabase auth on mount
 * • Listens for auth state changes (login/logout)
 * • Falls back to 'anonymous' if not authenticated
 * • Generates session ID synchronously (no 'pending' state)
 * • Handles auth transition by linking anonymous → auth sessions
 * • Resets to anonymous session on logout
 * • Provides withRequestId wrapper with actual user ID and session ID
 */
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState<string>('anonymous');
  // SYNCHRONOUS initial value - no 'pending' state ever
  const [sessionId, setSessionId] = useState<string>(() =>
    getOrCreateAnonymousSessionId()
  );

  useEffect(() => {
    // Initial fetch
    async function fetchUser() {
      const { data } = await supabase_browser.auth.getUser();
      if (data?.user?.id) {
        // Call handleAuthTransition to link anonymous → auth session
        const transition = await handleAuthTransition(data.user.id);
        setUserId(data.user.id);
        setSessionId(transition.sessionId);
      } else {
        // Clear any stale auth session on page load when not authenticated
        clearSession();
        setUserId('anonymous');
        setSessionId(getOrCreateAnonymousSessionId());
      }
    }
    fetchUser();

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase_browser.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          // Reset to anonymous on logout
          clearSession();
          setUserId('anonymous');
          setSessionId(getOrCreateAnonymousSessionId());
        } else if (event === 'SIGNED_IN' && session?.user?.id) {
          // Handle login (including different account)
          const transition = await handleAuthTransition(session.user.id);
          setUserId(session.user.id);
          setSessionId(transition.sessionId);
        }
      }
    );

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return useClientPassRequestId(userId, sessionId);
}
