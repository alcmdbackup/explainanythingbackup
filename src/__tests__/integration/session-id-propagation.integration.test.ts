/**
 * Integration tests for Session ID propagation
 *
 * Tests the flow of sessionId from client through server actions and API routes.
 */

 

import { RequestIdContext } from '@/lib/requestIdContext';
import { serverReadRequestId } from '@/lib/serverReadRequestId';

describe('Session ID Propagation Integration', () => {
  describe('Client → Server propagation via serverReadRequestId', () => {
    it('should extract sessionId from __requestId payload', async () => {
      const payload = {
        data: 'test',
        __requestId: {
          requestId: 'req-123',
          userId: 'user-456',
          sessionId: 'sess-abc',
        },
      };

      let capturedSessionId: string | undefined;

      const testFn = async (_arg: any) => {
        capturedSessionId = RequestIdContext.getSessionId();
        return 'done';
      };

      const wrapped = serverReadRequestId(testFn);
      await wrapped(payload);

      expect(capturedSessionId).toBe('sess-abc');
    });

    it('should extract all context fields correctly', async () => {
      const payload = {
        __requestId: {
          requestId: 'req-test-123',
          userId: 'user-test-456',
          sessionId: 'auth-xyz789',
        },
      };

      let capturedContext: { requestId: string; userId: string; sessionId: string } | undefined;

      const testFn = async (_arg: any) => {
        capturedContext = {
          requestId: RequestIdContext.getRequestId(),
          userId: RequestIdContext.getUserId(),
          sessionId: RequestIdContext.getSessionId(),
        };
        return 'done';
      };

      const wrapped = serverReadRequestId(testFn);
      await wrapped(payload);

      expect(capturedContext).toEqual({
        requestId: 'req-test-123',
        userId: 'user-test-456',
        sessionId: 'auth-xyz789',
      });
    });

    it('should default to "unknown" if sessionId not provided (migration case)', async () => {
      const payload = {
        __requestId: { requestId: 'req-123', userId: 'user-456' },
        // sessionId omitted (migration case)
      };

      let capturedSessionId: string | undefined;

      const testFn = async (_arg: any) => {
        capturedSessionId = RequestIdContext.getSessionId();
        return 'done';
      };

      const wrapped = serverReadRequestId(testFn);
      await wrapped(payload);

      expect(capturedSessionId).toBe('unknown');
    });

    it('should remove __requestId from payload before passing to function', async () => {
      const payload = {
        data: 'test-data',
        __requestId: {
          requestId: 'req-123',
          userId: 'user-456',
          sessionId: 'sess-abc',
        },
      };

      let receivedPayload: Record<string, unknown> | undefined;

      const testFn = async (arg: Record<string, unknown>) => {
        receivedPayload = arg;
        return 'done';
      };

      const wrapped = serverReadRequestId(testFn);
      await wrapped(payload);

      expect(receivedPayload).toEqual({ data: 'test-data' });
      expect(receivedPayload?.__requestId).toBeUndefined();
    });
  });

  describe('Concurrent requests isolation', () => {
    it('should maintain separate sessionIds for concurrent requests', async () => {
      const results: { sessionId: string; order: number }[] = [];

      const testFn = async (order: number) => {
        // Random delay to interleave executions
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        results.push({
          sessionId: RequestIdContext.getSessionId(),
          order,
        });
      };

      const wrapped = serverReadRequestId(async (data: any) => testFn(data.order));

      await Promise.all([
        wrapped({
          order: 1,
          __requestId: { requestId: 'r1', userId: 'u1', sessionId: 'sess-1' },
        }),
        wrapped({
          order: 2,
          __requestId: { requestId: 'r2', userId: 'u2', sessionId: 'sess-2' },
        }),
        wrapped({
          order: 3,
          __requestId: { requestId: 'r3', userId: 'u3', sessionId: 'sess-3' },
        }),
      ]);

      const sess1 = results.find((r) => r.order === 1);
      const sess2 = results.find((r) => r.order === 2);
      const sess3 = results.find((r) => r.order === 3);

      expect(sess1?.sessionId).toBe('sess-1');
      expect(sess2?.sessionId).toBe('sess-2');
      expect(sess3?.sessionId).toBe('sess-3');
    });
  });

  describe('Context defaults', () => {
    it('should return "unknown" for sessionId outside context', () => {
      const sessionId = RequestIdContext.getSessionId();
      expect(sessionId).toBe('unknown');
    });

    it('should return default values for all fields outside context', () => {
      expect(RequestIdContext.getRequestId()).toBe('unknown');
      expect(RequestIdContext.getUserId()).toBe('anonymous');
      expect(RequestIdContext.getSessionId()).toBe('unknown');
    });
  });

  describe('RequestIdContext.run with sessionId', () => {
    it('should propagate sessionId through nested async calls', async () => {
      const capturedSessionIds: string[] = [];

      const nestedAsync = async () => {
        capturedSessionIds.push(RequestIdContext.getSessionId());
        await Promise.resolve();
        capturedSessionIds.push(RequestIdContext.getSessionId());
      };

      await RequestIdContext.run(
        { requestId: 'test-req', userId: 'test-user', sessionId: 'test-session' },
        async () => {
          capturedSessionIds.push(RequestIdContext.getSessionId());
          await nestedAsync();
          capturedSessionIds.push(RequestIdContext.getSessionId());
        }
      );

      // All captured values should be the same sessionId
      expect(capturedSessionIds).toEqual([
        'test-session',
        'test-session',
        'test-session',
        'test-session',
      ]);
    });

    it('should restore previous context after run completes', () => {
      // Get initial state
      const initialSessionId = RequestIdContext.getSessionId();

      RequestIdContext.run(
        { requestId: 'temp-req', userId: 'temp-user', sessionId: 'temp-session' },
        () => {
          expect(RequestIdContext.getSessionId()).toBe('temp-session');
        }
      );

      // Should restore to initial state
      expect(RequestIdContext.getSessionId()).toBe(initialSessionId);
    });
  });
});
