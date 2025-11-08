/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
'use client';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useCallback } from 'react';

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