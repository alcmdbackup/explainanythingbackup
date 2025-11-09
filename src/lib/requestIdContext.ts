// Conditionally import AsyncLocalStorage only on server
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const storage = typeof window === 'undefined'
    ? new (require('async_hooks').AsyncLocalStorage as any as new () => { run<T>(data: { requestId: string; userId: string }, callback: () => T): T; getStore(): { requestId: string; userId: string } | undefined })()
    : null;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// Client-side tracking
let clientRequestId = { requestId: 'unknown', userId: 'anonymous' };

export class RequestIdContext {
  static run<T>(data: { requestId: string; userId: string }, callback: () => T): T {
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

  static setClient(data: { requestId: string; userId: string }): void {
    if (typeof window !== 'undefined') {
      clientRequestId = data;
    }
  }

  static get() {
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
}