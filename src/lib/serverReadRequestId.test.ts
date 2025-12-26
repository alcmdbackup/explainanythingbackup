import { serverReadRequestId } from './serverReadRequestId';
import { RequestIdContext } from './requestIdContext';
import { randomUUID } from 'crypto';

jest.mock('./requestIdContext');
jest.mock('crypto');

describe('serverReadRequestId', () => {
  beforeEach(() => {
    (randomUUID as jest.Mock).mockReturnValue('generated-uuid-123');
    (RequestIdContext.run as jest.Mock).mockImplementation((data, callback) => callback());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('basic decorator behavior', () => {
    it('should wrap function and return same result', async () => {
      const mockFn = jest.fn().mockResolvedValue('expected-result');
      const wrapped = serverReadRequestId(mockFn);

      const result = await wrapped({});

      expect(result).toBe('expected-result');
    });

    it('should call wrapped function', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ someProp: 'value' });

      expect(mockFn).toHaveBeenCalled();
    });

    it('should run wrapped function within RequestIdContext.run', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({});

      expect(RequestIdContext.run).toHaveBeenCalled();
    });

    it('should work with synchronous return values', async () => {
      const mockFn = jest.fn().mockReturnValue('sync-result');
      const wrapped = serverReadRequestId(mockFn);

      const result = await wrapped({});

      expect(result).toBe('sync-result');
    });
  });

  describe('requestId extraction', () => {
    it('should extract requestId from first argument', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      const args = { __requestId: { requestId: 'custom-id', userId: 'user-123', sessionId: 'unknown' } };
      await wrapped(args);

      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'custom-id', userId: 'user-123', sessionId: 'unknown' },
        expect.any(Function)
      );
    });

    it('should use both requestId and userId from __requestId', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      const args = { __requestId: { requestId: 'req-456', userId: 'user-789', sessionId: 'unknown' } };
      await wrapped(args);

      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'req-456', userId: 'user-789', sessionId: 'unknown' },
        expect.any(Function)
      );
    });

    it('should generate UUID when no __requestId provided', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ someProp: 'value' });

      expect(randomUUID).toHaveBeenCalled();
      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'generated-uuid-123', userId: 'anonymous', sessionId: 'unknown' },
        expect.any(Function)
      );
    });

    it('should use anonymous userId when generating UUID', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({});

      const contextData = (RequestIdContext.run as jest.Mock).mock.calls[0][0];
      expect(contextData.userId).toBe('anonymous');
    });

    it('should generate valid UUID format', async () => {
      (randomUUID as jest.Mock).mockReturnValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({});

      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', userId: 'anonymous', sessionId: 'unknown' },
        expect.any(Function)
      );
    });
  });

  describe('argument cleaning', () => {
    it('should delete __requestId from first argument', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      const args = {
        __requestId: { requestId: 'custom-id', userId: 'user-123', sessionId: 'unknown' },
        otherProp: 'value',
      };
      await wrapped(args);

      expect(mockFn).toHaveBeenCalledWith({ otherProp: 'value' });
      expect(args).not.toHaveProperty('__requestId');
    });

    it('should preserve other properties in first argument', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      const args = {
        __requestId: { requestId: 'id', userId: 'user' },
        prop1: 'value1',
        prop2: 42,
        prop3: { nested: 'object' },
      };
      await wrapped(args);

      expect(mockFn).toHaveBeenCalledWith({
        prop1: 'value1',
        prop2: 42,
        prop3: { nested: 'object' },
      });
    });

    it('should handle first argument without __requestId', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      const args = { prop: 'value' };
      await wrapped(args);

      expect(mockFn).toHaveBeenCalledWith({ prop: 'value' });
    });

    it('should pass cleaned arguments to wrapped function', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ __requestId: { requestId: 'id', userId: 'user' }, data: 'test' });

      const callArgs = mockFn.mock.calls[0][0];
      expect(callArgs).toEqual({ data: 'test' });
      expect(callArgs.__requestId).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle no arguments', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped();

      expect(randomUUID).toHaveBeenCalled();
      expect(mockFn).toHaveBeenCalled();
    });

    it('should handle null first argument', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped(null);

      expect(randomUUID).toHaveBeenCalled();
      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'generated-uuid-123', userId: 'anonymous', sessionId: 'unknown' },
        expect.any(Function)
      );
    });

    it('should handle undefined first argument', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped(undefined);

      expect(randomUUID).toHaveBeenCalled();
    });

    it('should propagate errors from wrapped function', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = serverReadRequestId(mockFn);

      await expect(wrapped({})).rejects.toThrow('Test error');
    });

    it('should handle synchronous errors', async () => {
      const mockFn = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });
      const wrapped = serverReadRequestId(mockFn);

      await expect(wrapped({})).rejects.toThrow('Sync error');
    });

    it('should handle function returning promise', async () => {
      const mockFn = jest.fn().mockResolvedValue('async-result');
      const wrapped = serverReadRequestId(mockFn);

      const result = await wrapped({});

      expect(result).toBe('async-result');
    });

    it('should handle function returning non-promise value', async () => {
      const mockFn = jest.fn().mockReturnValue('sync-value');
      const wrapped = serverReadRequestId(mockFn);

      const result = await wrapped({});

      expect(result).toBe('sync-value');
    });
  });

  describe('multiple arguments', () => {
    it('should only check first argument for __requestId', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped(
        { __requestId: { requestId: 'id-1', userId: 'user-1', sessionId: 'unknown' } },
        { __requestId: { requestId: 'id-2', userId: 'user-2', sessionId: 'unknown' } }
      );

      expect(RequestIdContext.run).toHaveBeenCalledWith(
        { requestId: 'id-1', userId: 'user-1', sessionId: 'unknown' },
        expect.any(Function)
      );
    });

    it('should pass all arguments to wrapped function', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ __requestId: { requestId: 'id', userId: 'user' } }, 'arg2', 'arg3');

      expect(mockFn).toHaveBeenCalledWith({}, 'arg2', 'arg3');
    });

    it('should preserve order of arguments', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ data: 'first' }, { data: 'second' }, { data: 'third' });

      expect(mockFn).toHaveBeenCalledWith(
        { data: 'first' },
        { data: 'second' },
        { data: 'third' }
      );
    });
  });

  describe('context integration', () => {
    it('should run callback within RequestIdContext', async () => {
      let callbackExecuted = false;
      (RequestIdContext.run as jest.Mock).mockImplementation((data, callback) => {
        callbackExecuted = true;
        return callback();
      });

      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({});

      expect(callbackExecuted).toBe(true);
    });

    it('should pass correct data to RequestIdContext.run', async () => {
      // Clear previous mock calls
      jest.clearAllMocks();

      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({ __requestId: { requestId: 'test-id', userId: 'test-user', sessionId: 'unknown' } });

      const contextData = (RequestIdContext.run as jest.Mock).mock.calls[0][0];
      expect(contextData).toEqual({ requestId: 'test-id', userId: 'test-user', sessionId: 'unknown' });
    });

    it('should execute wrapped function inside context callback', async () => {
      const executionOrder: string[] = [];
      (RequestIdContext.run as jest.Mock).mockImplementation((data, callback) => {
        executionOrder.push('context-start');
        const result = callback();
        executionOrder.push('context-end');
        return result;
      });

      const mockFn = jest.fn().mockImplementation(() => {
        executionOrder.push('function-called');
        return 'result';
      });
      const wrapped = serverReadRequestId(mockFn);

      await wrapped({});

      expect(executionOrder).toEqual(['context-start', 'function-called', 'context-end']);
    });
  });

  describe('type preservation', () => {
    it('should maintain function signature', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = serverReadRequestId(mockFn);

      expect(typeof wrapped).toBe('function');
    });

    it('should work with functions of different signatures', async () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockResolvedValue('result2');

      const wrapped1 = serverReadRequestId(fn1);
      const wrapped2 = serverReadRequestId(fn2);

      await wrapped1({ data: 'test' });
      await wrapped2({ data: 'test' }, 'extra-arg');

      expect(fn1).toHaveBeenCalledWith({ data: 'test' });
      expect(fn2).toHaveBeenCalledWith({ data: 'test' }, 'extra-arg');
    });
  });
});
