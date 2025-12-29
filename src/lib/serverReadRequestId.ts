/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';

export function serverReadRequestId<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const clientData = args[0]?.__requestId;
    const requestIdData = {
      requestId: clientData?.requestId || randomUUID(),
      userId: clientData?.userId || 'anonymous',
      sessionId: clientData?.sessionId || 'unknown'  // Fallback for migration
    };

    if (args[0]?.__requestId) {
      delete args[0].__requestId;
    }

    // Set Sentry context for this request - wraps entire execution
    return Sentry.withScope(async (scope) => {
      // Set user context for Sentry
      scope.setUser({ id: requestIdData.userId });

      // Set custom tags for filtering in Sentry dashboard
      scope.setTag('requestId', requestIdData.requestId);
      scope.setTag('sessionId', requestIdData.sessionId);

      // Set structured context for more details
      scope.setContext('request', {
        ...requestIdData,
        source: 'server-action',
      });

      // IMPORTANT: Use async callback and await the result to keep
      // AsyncLocalStorage context active through the entire Promise chain.
      // Without this, .then() callbacks in withLogging run outside the context.
      return RequestIdContext.run(requestIdData, async () => await fn(...args));
    });
  }) as T;
}