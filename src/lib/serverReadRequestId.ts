/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';

export function serverReadRequestId<T extends (...args: any[]) => any>(fn: T): T {
  return (async (...args) => {
    const requestIdData = args[0]?.__requestId || {
      requestId: randomUUID(),
      userId: 'anonymous'
    };

    if (args[0]?.__requestId) {
      delete args[0].__requestId;
    }

    return RequestIdContext.run(requestIdData, () => fn(...args));
  }) as T;
}