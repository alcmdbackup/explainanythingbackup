/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
'use client';
import { RequestIdContext } from '@/lib/requestIdContext';
import { supabase_browser } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

export function useClientPassRequestId(userId = 'anonymous') {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withRequestId = useCallback(<T extends Record<string, any> = {}>(data?: T) => {
    const requestId = generateRequestId(); // New ID for each action!

    // Set client requestId context persistently
    RequestIdContext.setClient({ requestId, userId });

    return {
      ...(data || {} as T),
      __requestId: { requestId, userId }
    } as T & { __requestId: { requestId: string; userId: string } };
  }, [userId, generateRequestId]);

  return { withRequestId };
}

/**
 * Hook that auto-fetches the authenticated user ID for request tracking
 *
 * • Automatically fetches user ID from Supabase auth on mount
 * • Falls back to 'anonymous' if not authenticated
 * • Provides withRequestId wrapper with actual user ID
 */
export function useAuthenticatedRequestId() {
  const [userId, setUserId] = useState<string>('anonymous');

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase_browser.auth.getUser();
      if (data?.user?.id) {
        setUserId(data.user.id);
      }
    }
    fetchUser();
  }, []);

  return useClientPassRequestId(userId);
}