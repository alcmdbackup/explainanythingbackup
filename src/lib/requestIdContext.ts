// Context data interface including sessionId
interface ContextData {
  requestId: string;
  userId: string;
  sessionId: string;
}

// Conditionally import AsyncLocalStorage only on server
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const storage = typeof window === 'undefined'
    ? new (require('async_hooks').AsyncLocalStorage as any as new () => { run<T>(data: ContextData, callback: () => T): T; getStore(): ContextData | undefined })()
    : null;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// Client-side tracking
let clientRequestId: ContextData = { requestId: 'unknown', userId: 'anonymous', sessionId: 'unknown' };

// Validation for context data
function validateContextData(data: ContextData): void {
  if (!data) {
    throw new Error('RequestIdContext: data is required');
  }
  if (!data.requestId || data.requestId === '' || data.requestId === 'unknown') {
    throw new Error('RequestIdContext: requestId must be a valid non-empty string (not "unknown")');
  }
  // sessionId can be 'unknown' during migration phase
}

export class RequestIdContext {
  static run<T>(data: ContextData, callback: () => T): T {
    validateContextData(data);
    if (typeof window === 'undefined') {
      // Server: use AsyncLocalStorage
      return storage!.run(data, callback);
    } else {
      // Client: use module variable
      const prev = clientRequestId;
      clientRequestId = data;
      try {
        return callback();
      } finally {
        clientRequestId = prev;
      }
    }
  }

  static setClient(data: ContextData): void {
    validateContextData(data);
    if (typeof window !== 'undefined') {
      clientRequestId = data;
    }
  }

  static get(): ContextData | undefined {
    return typeof window === 'undefined'
      ? storage?.getStore()
      : clientRequestId;
  }

  static getRequestId(): string {
    return this.get()?.requestId || 'unknown';
  }

  static getUserId(): string {
    return this.get()?.userId || 'anonymous';
  }

  static getSessionId(): string {
    return this.get()?.sessionId || 'unknown';
  }
}