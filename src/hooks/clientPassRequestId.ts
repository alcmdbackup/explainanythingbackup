'use client';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useCallback } from 'react';

export function clientPassRequestId(userId = 'anonymous') {
  const generateRequestId = useCallback(() =>
    `client-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    []
  );

  const withRequestId = useCallback((data = {}) => {
    const requestId = generateRequestId(); // New ID for each action!

    // Set client requestId context persistently
    RequestIdContext.setClient({ requestId, userId });

    return {
      ...data,
      __requestId: { requestId, userId }
    };
  }, [userId, generateRequestId]);

  return { withRequestId };
}